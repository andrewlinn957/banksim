import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide } from '../domain/enums';
import type {
  LcrCalculationSummary,
  LcrContribution,
  LcrEngineResult,
  LcrHqlaAdjustment,
  LcrInflowCapClass,
  LcrModel,
} from '../domain/lcr';
import { AssetProductType as A, LiabilityProductType as L, ProductType } from '../products/catalogue';
import {
  getLcrProductRule,
  LCR_HQLA_CATEGORIES,
  LCR_INFLOW_CATEGORIES,
  LCR_OUTFLOW_CATEGORIES,
  LcrHqlaCategory,
  LcrInflowCategory,
  LcrOutflowCategory,
} from '../products/lcr';
import { calculateLcr, calculateLcrNetOutflow } from './lcrEngine';

export type { LcrContribution } from '../domain/lcr';
export type Cor011C76 = LcrCalculationSummary;
export type Cor011Result = LcrEngineResult;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * BankSim currently uses insuredRetailDepositShare as a proxy for COR011
 * stable-retail eligibility. In regulation, DGS coverage alone is not sufficient:
 * the stable-deposit relationship / transactional-account conditions also apply.
 */
export const stableRetailDepositShare = (state: BankState): number =>
  clamp01(state.behaviour.insuredRetailDepositShare ?? 0);

export const contractualMonthlyPayment = (principal: number, annualRate: number, months: number): number => {
  const r = Math.max(0, annualRate) / 12;
  const n = Math.max(1, months);
  return r > 0 ? (principal * r) / (1 - (1 + r) ** -n) : principal / n;
};

const hqlaContribution = (
  category: LcrHqlaCategory,
  amount: number,
  sourceLabel: string
): LcrContribution => {
  const definition = LCR_HQLA_CATEGORIES[category];
  return {
    template: 'C72',
    corep: definition.corep,
    label: definition.label,
    sourceLabel,
    amount,
    factor: definition.factor,
    weighted: amount * definition.factor,
    hqlaLevel: definition.level,
  };
};

const outflowContribution = (
  category: LcrOutflowCategory,
  amount: number,
  sourceLabel: string
): LcrContribution => {
  const definition = LCR_OUTFLOW_CATEGORIES[category];
  return {
    template: 'C73',
    corep: definition.corep,
    label: definition.label,
    sourceLabel,
    amount,
    factor: definition.factor,
    weighted: amount * definition.factor,
  };
};

const inflowContribution = (
  category: LcrInflowCategory,
  amount: number,
  sourceLabel: string
): LcrContribution => {
  const definition = LCR_INFLOW_CATEGORIES[category];
  return {
    template: 'C74',
    corep: definition.corep,
    label: definition.label,
    sourceLabel,
    amount,
    factor: definition.factor,
    weighted: amount * definition.factor,
    capClass: definition.capClass,
  };
};

const retailDepositOutflows = (
  state: BankState,
  amount: number,
  sourceLabel: string
): LcrContribution[] => {
  const stableShare = stableRetailDepositShare(state);
  const otherShare = 1 - stableShare;
  return [
    outflowContribution('stableRetailDeposit', amount * stableShare, sourceLabel),
    outflowContribution('otherRetailDeposit', amount * otherShare, sourceLabel),
  ].filter(contribution => contribution.amount > 0);
};

const derivativeCashFlows = (
  state: BankState,
  config: SimulationConfig
): { receipts: number; payments: number; net: number } => {
  let receipts = 0;
  let payments = 0;
  for (const hedge of state.financial.hedges ?? []) {
    if (hedge.monthsRemaining <= 0) continue;
    const spread = hedge.direction === 'payFixedReceiveFloat'
      ? state.market.riskFreeShort - hedge.fixedRate
      : hedge.fixedRate - state.market.riskFreeShort;
    const coupon = (
      hedge.notional *
      (spread - Math.abs(config.behaviour.irrbb?.hedgeCarrySpread ?? 0))
    ) / 12;
    receipts += Math.max(0, coupon);
    payments += Math.max(0, -coupon);
  }
  return { receipts, payments, net: receipts - payments };
};

const derivativeTargetProduct = (state: BankState, net: number): ProductType => {
  const hasAsset = state.financial.balanceSheet.items.some(item => item.productType === A.DerivativeAssets);
  const hasLiability = state.financial.balanceSheet.items.some(item => item.productType === L.DerivativeLiabilities);
  if (net >= 0) return hasAsset || !hasLiability ? A.DerivativeAssets : L.DerivativeLiabilities;
  return hasLiability || !hasAsset ? L.DerivativeLiabilities : A.DerivativeAssets;
};

const isDerivativeProduct = (productType: ProductType): boolean =>
  productType === A.DerivativeAssets || productType === L.DerivativeLiabilities;

/**
 * BankSim adapter for one product. It translates simulation state into C73/C74
 * lines. The actual LCR arithmetic lives in lcrEngine.ts.
 */
export const lcrCashFlowContributionsForProduct = (
  state: BankState,
  config: SimulationConfig,
  productType: ProductType
): { outflows: LcrContribution[]; inflows: LcrContribution[] } => {
  const item = state.financial.balanceSheet.items.find(position => position.productType === productType);
  const derivativeProduct = isDerivativeProduct(productType);
  if (!item && !derivativeProduct) return { outflows: [], inflows: [] };

  const balance = Math.max(0, item?.balance ?? 0);
  const sourceLabel = item?.label ?? 'Derivative netting set';
  const rule = getLcrProductRule(productType);
  const outflows: LcrContribution[] = [];
  const inflows: LcrContribution[] = [];

  if (derivativeProduct) {
    const derivative = derivativeCashFlows(state, config);
    if (productType === derivativeTargetProduct(state, derivative.net)) {
      if (derivative.net < 0) {
        outflows.push(outflowContribution('derivativeOutflow', -derivative.net, 'Derivative netting set'));
      }
      if (derivative.net > 0) {
        inflows.push(inflowContribution('derivativeInflow', derivative.net, 'Derivative netting set'));
      }
    }
    return { outflows, inflows };
  }

  if (rule.outflow === 'retailSight') {
    outflows.push(...retailDepositOutflows(state, balance, sourceLabel));
  } else if (rule.outflow === 'retailTerm') {
    const buckets = state.fundingLadders?.[productType] ?? [];
    for (const bucket of buckets) {
      if (bucket.monthsToMaturity > 1) continue;
      outflows.push(...retailDepositOutflows(state, Math.max(0, bucket.notional), sourceLabel));
    }
  } else if (rule.outflow === 'debtSecurity') {
    const buckets = state.fundingLadders?.[productType] ?? [];
    if (buckets.length) {
      for (const bucket of buckets) {
        if (bucket.monthsToMaturity > 1) continue;
        const principal = Math.max(0, bucket.notional);
        const due = principal * (1 + Math.max(0, bucket.rate) / 12);
        outflows.push(outflowContribution('debtSecurity', due, sourceLabel));
      }
    } else if (productType === L.WholesaleFundingST && balance > 0) {
      outflows.push(outflowContribution('debtSecurity', balance, sourceLabel));
    }
  } else if (rule.outflow === 'centralBankSecuredLevel1') {
    const buckets = state.fundingLadders?.[productType] ?? [];
    for (const bucket of buckets) {
      if (bucket.monthsToMaturity > 1) continue;
      outflows.push(
        outflowContribution('centralBankSecuredLevel1', Math.max(0, bucket.notional), sourceLabel)
      );
    }
  } else if (rule.outflow) {
    outflows.push(outflowContribution(rule.outflow, balance, sourceLabel));
  }

  if (rule.inflow === 'retailLoan' || rule.inflow === 'corporateLoan') {
    const cohorts = state.loanCohorts?.[productType] ?? [];
    for (const loan of cohorts) {
      if (loan.stage === 'stage3' || loan.outstandingPrincipal <= 0) continue;
      const term = Math.max(1, loan.termMonths - loan.ageMonths);
      const payment = contractualMonthlyPayment(
        loan.outstandingPrincipal,
        loan.annualInterestRate,
        term
      );
      const interestDue = Math.min(
        payment,
        loan.outstandingPrincipal * Math.max(0, loan.annualInterestRate) / 12
      );
      const principalDue = Math.min(
        loan.outstandingPrincipal,
        Math.max(0, payment - interestDue)
      );
      if (interestDue > 0) {
        inflows.push(inflowContribution('loanInterest', interestDue, sourceLabel));
      }
      if (principalDue > 0) {
        inflows.push(inflowContribution(
          rule.inflow === 'retailLoan'
            ? 'retailLoanPrincipal'
            : 'nonFinancialCorporateLoanPrincipal',
          principalDue,
          sourceLabel
        ));
      }
    }
  }

  return { outflows, inflows };
};

export const lcrCommitmentContributions = (state: BankState): LcrContribution[] => {
  const contributions: LcrContribution[] = [];
  for (const [rawProductType, pipeline] of Object.entries(state.loanPipelines ?? {})) {
    const productType = rawProductType as ProductType;
    const category = getLcrProductRule(productType).commitment;
    const amount = Math.max(0, pipeline?.committedNotional ?? 0);
    if (!category || amount <= 0) continue;
    contributions.push(
      outflowContribution(category, amount, `${productType} undrawn commitments`)
    );
  }
  return contributions;
};

export const lcrLiquidAssetContributions = (state: BankState): LcrContribution[] => {
  const contributions: LcrContribution[] = [];
  for (const item of state.financial.balanceSheet.items) {
    if (item.side !== BalanceSheetSide.Asset) continue;
    const category = getLcrProductRule(item.productType).hqla;
    if (!category) continue;
    const amount = Math.max(
      0,
      item.balance - Math.max(0, item.encumbrance?.encumberedAmount ?? 0)
    );
    contributions.push(hqlaContribution(category, amount, item.label));
  }
  return contributions;
};

export const cor011NetOutflow = (
  totalOutflows: number,
  inflows: { capClass: LcrInflowCapClass; amount: number }[]
) => calculateLcrNetOutflow(totalOutflows, inflows);

const shortTermBoeUnwind = (state: BankState) => {
  const buckets = state.fundingLadders?.[L.BankOfEnglandFunding] ?? [];
  const totalNotional = buckets.reduce(
    (sum, bucket) => sum + Math.max(0, bucket.notional),
    0
  );
  const maturingNotional = buckets
    .filter(bucket => bucket.monthsToMaturity <= 1)
    .reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
  const gilt = state.financial.balanceSheet.items.find(item => item.productType === A.Gilts);
  const encumberedGilts = Math.max(0, gilt?.encumbrance?.encumberedAmount ?? 0);
  const collateralInflow = totalNotional > 0
    ? encumberedGilts * Math.min(1, maturingNotional / totalNotional)
    : 0;
  return {
    securedCashOutflow: maturingNotional,
    level1CollateralInflow: collateralInflow,
  };
};

/**
 * Build the regulatory LCR model from the richer BankSim state.
 *
 * This is intentionally the integration boundary. Balance-sheet positions,
 * contractual funding ladders, loan cohorts and hedge cash flows are translated
 * here into 30-day regulatory lines. The LCR engine itself has no dependency on
 * any of those simulation concepts.
 */
export const buildCor011Model = (
  state: BankState,
  config: SimulationConfig
): LcrModel => {
  const liquidAssets = lcrLiquidAssetContributions(state);
  const outflows: LcrContribution[] = [...lcrCommitmentContributions(state)];
  const inflows: LcrContribution[] = [];

  for (const item of state.financial.balanceSheet.items) {
    if (isDerivativeProduct(item.productType)) continue;
    const line = lcrCashFlowContributionsForProduct(state, config, item.productType);
    outflows.push(...line.outflows);
    inflows.push(...line.inflows);
  }

  // Current BankSim hedges form one modelled netting set. Keeping this outside
  // the balance-sheet loop avoids tying regulatory derivative cash flows to the
  // accounting sign of the derivative fair-value position.
  if ((state.financial.hedges ?? []).length > 0) {
    const derivative = derivativeCashFlows(state, config);
    const target = derivativeTargetProduct(state, derivative.net);
    const line = lcrCashFlowContributionsForProduct(state, config, target);
    outflows.push(...line.outflows);
    inflows.push(...line.inflows);
  }

  const unwind = shortTermBoeUnwind(state);
  const hqlaAdjustments: LcrHqlaAdjustment[] = [];
  if (unwind.level1CollateralInflow > 0) {
    hqlaAdjustments.push({
      id: 'boe-level1-collateral-return',
      label: 'Level 1 collateral returned on central-bank secured funding unwind',
      level: 'level1',
      kind: 'collateral',
      direction: 'inflow',
      amount: unwind.level1CollateralInflow,
    });
  }
  if (unwind.securedCashOutflow > 0) {
    hqlaAdjustments.push({
      id: 'boe-secured-cash-repayment',
      label: 'Cash repayment on central-bank secured funding unwind',
      level: 'level1',
      kind: 'securedCash',
      direction: 'outflow',
      amount: unwind.securedCashOutflow,
    });
  }

  return {
    liquidAssets,
    outflows,
    inflows,
    hqlaAdjustments,
  };
};

export const calculateCor011 = (
  state: BankState,
  config: SimulationConfig
): Cor011Result => calculateLcr(buildCor011Model(state, config));
