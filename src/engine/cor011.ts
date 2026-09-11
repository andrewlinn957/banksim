import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide } from '../domain/enums';
import { AssetProductType as A, LiabilityProductType as L, ProductType } from '../products/catalogue';
import {
  getLcrProductRule,
  LCR_HQLA_CATEGORIES,
  LCR_INFLOW_CATEGORIES,
  LCR_OUTFLOW_CATEGORIES,
  LcrHqlaCategory,
  LcrHqlaLevel,
  LcrInflowCapClass,
  LcrInflowCategory,
  LcrOutflowCategory,
} from '../products/lcr';

export interface LcrContribution {
  template: 'C72' | 'C73' | 'C74';
  corep: string;
  label: string;
  sourceLabel: string;
  amount: number;
  factor: number;
  weighted: number;
  capClass?: LcrInflowCapClass;
  hqlaLevel?: LcrHqlaLevel;
}

export interface Cor011C76 {
  unadjustedLevel1: number;
  unadjustedLevel2A: number;
  unadjustedLevel2B: number;
  level1Collateral30dOutflows: number;
  level1Collateral30dInflows: number;
  securedCash30dOutflows: number;
  securedCash30dInflows: number;
  adjustedLevel1: number;
  adjustedLevel2A: number;
  adjustedLevel2B: number;
  excessLiquidAssets: number;
  liquidityBuffer: number;
  totalOutflows: number;
  fullyExemptInflows: number;
  inflows90: number;
  inflows75: number;
  reductionFullyExempt: number;
  reduction90: number;
  reduction75: number;
  netLiquidityOutflow: number;
  lcr: number;
}

export interface Cor011Result {
  liquidAssets: LcrContribution[];
  outflows: LcrContribution[];
  inflows: LcrContribution[];
  c76: Cor011C76;
}

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

const derivativeCashFlows = (state: BankState, config: SimulationConfig): { receipts: number; payments: number; net: number } => {
  let receipts = 0;
  let payments = 0;
  for (const hedge of state.financial.hedges ?? []) {
    if (hedge.monthsRemaining <= 0) continue;
    const spread = hedge.direction === 'payFixedReceiveFloat'
      ? state.market.riskFreeShort - hedge.fixedRate
      : hedge.fixedRate - state.market.riskFreeShort;
    const coupon = (hedge.notional * (spread - Math.abs(config.behaviour.irrbb?.hedgeCarrySpread ?? 0))) / 12;
    receipts += Math.max(0, coupon);
    payments += Math.max(0, -coupon);
  }
  return { receipts, payments, net: receipts - payments };
};

const derivativeTargetProduct = (state: BankState, net: number): ProductType => {
  const hasAsset = state.financial.balanceSheet.items.some(item => item.productType === A.DerivativeAssets);
  const hasLiability = state.financial.balanceSheet.items.some(item => item.productType === L.DerivativeLiabilities);
  if (net >= 0) return hasAsset ? A.DerivativeAssets : L.DerivativeLiabilities;
  return hasLiability ? L.DerivativeLiabilities : A.DerivativeAssets;
};

export const lcrCashFlowContributionsForProduct = (
  state: BankState,
  config: SimulationConfig,
  productType: ProductType
): { outflows: LcrContribution[]; inflows: LcrContribution[] } => {
  const item = state.financial.balanceSheet.items.find(position => position.productType === productType);
  if (!item) return { outflows: [], inflows: [] };
  const balance = Math.max(0, item.balance);
  const rule = getLcrProductRule(productType);
  const outflows: LcrContribution[] = [];
  const inflows: LcrContribution[] = [];

  if (rule.outflow === 'retailSight') {
    outflows.push(...retailDepositOutflows(state, balance, item.label));
  } else if (rule.outflow === 'retailTerm') {
    const buckets = state.fundingLadders?.[productType] ?? [];
    for (const bucket of buckets) {
      if (bucket.monthsToMaturity > 1) continue;
      outflows.push(...retailDepositOutflows(state, Math.max(0, bucket.notional), item.label));
    }
  } else if (rule.outflow === 'debtSecurity') {
    const buckets = state.fundingLadders?.[productType] ?? [];
    if (buckets.length) {
      for (const bucket of buckets) {
        if (bucket.monthsToMaturity > 1) continue;
        const principal = Math.max(0, bucket.notional);
        const due = principal * (1 + Math.max(0, bucket.rate) / 12);
        outflows.push(outflowContribution('debtSecurity', due, item.label));
      }
    } else if (productType === L.WholesaleFundingST && balance > 0) {
      outflows.push(outflowContribution('debtSecurity', balance, item.label));
    }
  } else if (rule.outflow === 'centralBankSecuredLevel1') {
    const buckets = state.fundingLadders?.[productType] ?? [];
    for (const bucket of buckets) {
      if (bucket.monthsToMaturity > 1) continue;
      outflows.push(outflowContribution('centralBankSecuredLevel1', Math.max(0, bucket.notional), item.label));
    }
  } else if (rule.outflow && rule.outflow !== 'derivativeOutflow') {
    outflows.push(outflowContribution(rule.outflow, balance, item.label));
  }

  if (rule.inflow === 'retailLoan' || rule.inflow === 'corporateLoan') {
    const cohorts = state.loanCohorts?.[productType] ?? [];
    for (const loan of cohorts) {
      if (loan.stage === 'stage3' || loan.outstandingPrincipal <= 0) continue;
      const term = Math.max(1, loan.termMonths - loan.ageMonths);
      const payment = contractualMonthlyPayment(loan.outstandingPrincipal, loan.annualInterestRate, term);
      const interestDue = Math.min(payment, loan.outstandingPrincipal * Math.max(0, loan.annualInterestRate) / 12);
      const principalDue = Math.min(loan.outstandingPrincipal, Math.max(0, payment - interestDue));
      if (interestDue > 0) inflows.push(inflowContribution('loanInterest', interestDue, item.label));
      if (principalDue > 0) {
        inflows.push(inflowContribution(
          rule.inflow === 'retailLoan' ? 'retailLoanPrincipal' : 'nonFinancialCorporateLoanPrincipal',
          principalDue,
          item.label
        ));
      }
    }
  }

  if (rule.outflow === 'derivativeOutflow' || rule.inflow === 'derivativeInflow') {
    const derivative = derivativeCashFlows(state, config);
    if (productType === derivativeTargetProduct(state, derivative.net)) {
      if (derivative.net < 0) outflows.push(outflowContribution('derivativeOutflow', -derivative.net, 'Net derivative cash flows'));
      if (derivative.net > 0) inflows.push(inflowContribution('derivativeInflow', derivative.net, 'Net derivative cash flows'));
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
    contributions.push(outflowContribution(category, amount, `${productType} undrawn commitments`));
  }
  return contributions;
};

export const lcrLiquidAssetContributions = (state: BankState): LcrContribution[] => {
  const contributions: LcrContribution[] = [];
  for (const item of state.financial.balanceSheet.items) {
    if (item.side !== BalanceSheetSide.Asset) continue;
    const category = getLcrProductRule(item.productType).hqla;
    if (!category) continue;
    const amount = Math.max(0, item.balance - Math.max(0, item.encumbrance?.encumberedAmount ?? 0));
    contributions.push(hqlaContribution(category, amount, item.label));
  }
  return contributions;
};

export const cor011NetOutflow = (
  totalOutflows: number,
  inflows: { capClass: LcrInflowCapClass; amount: number }[]
) => {
  const fullyExemptInflows = inflows.filter(i => i.capClass === 'exempt').reduce((sum, i) => sum + Math.max(0, i.amount), 0);
  const inflows90 = inflows.filter(i => i.capClass === '90').reduce((sum, i) => sum + Math.max(0, i.amount), 0);
  const inflows75 = inflows.filter(i => i.capClass === '75').reduce((sum, i) => sum + Math.max(0, i.amount), 0);
  const reductionFullyExempt = Math.min(fullyExemptInflows, totalOutflows);
  const reduction90 = Math.min(inflows90, 0.90 * Math.max(totalOutflows - fullyExemptInflows, 0));
  const reduction75 = Math.min(inflows75, 0.75 * Math.max(totalOutflows - fullyExemptInflows - inflows90 / 0.90, 0));
  const netLiquidityOutflow = Math.max(0, totalOutflows - reductionFullyExempt - reduction90 - reduction75);
  return {
    fullyExemptInflows,
    inflows90,
    inflows75,
    reductionFullyExempt,
    reduction90,
    reduction75,
    netLiquidityOutflow,
  };
};

const shortTermBoeUnwind = (state: BankState) => {
  const buckets = state.fundingLadders?.[L.BankOfEnglandFunding] ?? [];
  const totalNotional = buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
  const maturingNotional = buckets
    .filter(bucket => bucket.monthsToMaturity <= 1)
    .reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
  const gilt = state.financial.balanceSheet.items.find(item => item.productType === A.Gilts);
  const encumberedGilts = Math.max(0, gilt?.encumbrance?.encumberedAmount ?? 0);
  const collateralInflow = totalNotional > 0
    ? encumberedGilts * Math.min(1, maturingNotional / totalNotional)
    : 0;
  return { securedCashOutflow: maturingNotional, level1CollateralInflow: collateralInflow };
};

export const calculateCor011 = (state: BankState, config: SimulationConfig): Cor011Result => {
  const liquidAssets = lcrLiquidAssetContributions(state);
  const outflows: LcrContribution[] = [...lcrCommitmentContributions(state)];
  const inflows: LcrContribution[] = [];
  for (const item of state.financial.balanceSheet.items) {
    const line = lcrCashFlowContributionsForProduct(state, config, item.productType);
    outflows.push(...line.outflows);
    inflows.push(...line.inflows);
  }

  const unadjustedLevel1 = liquidAssets.filter(c => c.hqlaLevel === 'level1').reduce((sum, c) => sum + c.weighted, 0);
  const unadjustedLevel2A = liquidAssets.filter(c => c.hqlaLevel === 'level2a').reduce((sum, c) => sum + c.weighted, 0);
  const unadjustedLevel2B = liquidAssets.filter(c => c.hqlaLevel === 'level2b').reduce((sum, c) => sum + c.weighted, 0);
  const unwind = shortTermBoeUnwind(state);
  const level1Collateral30dOutflows = 0;
  const level1Collateral30dInflows = unwind.level1CollateralInflow;
  const securedCash30dOutflows = unwind.securedCashOutflow;
  const securedCash30dInflows = 0;
  const adjustedLevel1 = Math.max(0,
    unadjustedLevel1 - level1Collateral30dOutflows + level1Collateral30dInflows - securedCash30dOutflows + securedCash30dInflows
  );
  const adjustedLevel2A = unadjustedLevel2A;
  const adjustedLevel2B = unadjustedLevel2B;
  const adjustedTotal = adjustedLevel1 + adjustedLevel2A + adjustedLevel2B;
  const capBase = Math.min(
    adjustedTotal,
    (100 / 30) * adjustedLevel1,
    (100 / 60) * adjustedLevel1,
    (100 / 85) * (adjustedLevel1 + adjustedLevel2A)
  );
  const excessLiquidAssets = Math.max(0, adjustedTotal - capBase);
  const unadjustedTotal = unadjustedLevel1 + unadjustedLevel2A + unadjustedLevel2B;
  const liquidityBuffer = Math.max(0, unadjustedTotal - Math.min(unadjustedTotal, excessLiquidAssets));

  const totalOutflows = outflows.reduce((sum, contribution) => sum + contribution.weighted, 0);
  const net = cor011NetOutflow(totalOutflows, inflows.map(contribution => ({
    capClass: contribution.capClass ?? '75',
    amount: contribution.weighted,
  })));
  const lcr = net.netLiquidityOutflow > 0 ? liquidityBuffer / net.netLiquidityOutflow : Infinity;

  return {
    liquidAssets,
    outflows,
    inflows,
    c76: {
      unadjustedLevel1,
      unadjustedLevel2A,
      unadjustedLevel2B,
      level1Collateral30dOutflows,
      level1Collateral30dInflows,
      securedCash30dOutflows,
      securedCash30dInflows,
      adjustedLevel1,
      adjustedLevel2A,
      adjustedLevel2B,
      excessLiquidAssets,
      liquidityBuffer,
      totalOutflows,
      ...net,
      lcr,
    },
  };
};
