import { BankState } from '../domain/bankState';
import { CashFlowStatement } from '../domain/cashflow';
import { SimulationConfig } from '../domain/config';
import {
  AssetProductType,
  BalanceSheetSide,
  LiabilityProductType,
  ProductType,
} from '../domain/enums';

/** Minimal loss data needed to reconcile balance-sheet movements to cash flows. */
export interface StatementLossInputs {
  recognizedLoanLosses: Partial<Record<ProductType, number>>;
  recognizedNonLoanLosses: Partial<Record<ProductType, number>>;
}

/** Minimal capital-close data needed to build the cash-flow statement. */
export interface StatementCapitalCloseInputs {
  netIncome: number;
  operatingCashDelta: number;
  nonCashAdjustmentsByProduct: Partial<Record<ProductType, number>>;
}

export interface BuildStatementsResult {
  cashFlowStatement: CashFlowStatement;
  cfMismatch: number;
}

interface BalanceFlowResult {
  operatingBalanceFlow: number;
  investingBalanceFlow: number;
  financingLiabilityFlow: number;
}

const advanceDateByMonths = (date: Date, months: number): Date => {
  const wholeMonths = Math.max(0, Math.round(months));
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + wholeMonths);
  const daysInMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, daysInMonth));
  return next;
};

const computeBalanceFlows = (
  inputState: BankState,
  state: BankState,
  losses: StatementLossInputs,
  capitalClose: StatementCapitalCloseInputs
): BalanceFlowResult => {
  const prevBalances: Partial<Record<ProductType, number>> = {};
  const prevSides: Partial<Record<ProductType, BalanceSheetSide>> = {};
  inputState.financial.balanceSheet.items.forEach((item) => {
    prevBalances[item.productType] = item.balance;
    prevSides[item.productType] = item.side;
  });
  const currBalances: Partial<Record<ProductType, number>> = {};
  const currSides: Partial<Record<ProductType, BalanceSheetSide>> = {};
  state.financial.balanceSheet.items.forEach((item) => {
    currBalances[item.productType] = item.balance;
    currSides[item.productType] = item.side;
  });
  const productTypes = new Set<ProductType>(
    [...Object.keys(prevBalances), ...Object.keys(currBalances)] as ProductType[]
  );

  const nonCashBalanceAdjustmentsByProduct: Partial<Record<ProductType, number>> = {};
  Object.entries(losses.recognizedLoanLosses).forEach(([product, loss]) => {
    const productType = product as ProductType;
    nonCashBalanceAdjustmentsByProduct[productType] =
      (nonCashBalanceAdjustmentsByProduct[productType] ?? 0) + (loss ?? 0);
  });
  Object.entries(losses.recognizedNonLoanLosses).forEach(([product, loss]) => {
    const productType = product as ProductType;
    nonCashBalanceAdjustmentsByProduct[productType] =
      (nonCashBalanceAdjustmentsByProduct[productType] ?? 0) + (loss ?? 0);
  });
  Object.entries(capitalClose.nonCashAdjustmentsByProduct ?? {}).forEach(([product, adjustment]) => {
    const productType = product as ProductType;
    nonCashBalanceAdjustmentsByProduct[productType] =
      (nonCashBalanceAdjustmentsByProduct[productType] ?? 0) + (adjustment ?? 0);
  });

  const operatingLiabilityProducts = new Set<ProductType>([
    LiabilityProductType.DerivativeLiabilities,
    LiabilityProductType.RetailCurrentAccounts,
    LiabilityProductType.CorporateOperatingDeposits,
    LiabilityProductType.CorporateNonOperatingDeposits,
    LiabilityProductType.WholesaleFundingST,
  ]);

  const investingAssetProducts = new Set<ProductType>([AssetProductType.Gilts]);

  let operatingBalanceFlow = 0;
  let investingBalanceFlow = 0;
  let financingLiabilityFlow = 0;

  productTypes.forEach((productType) => {
    const side = currSides[productType] ?? prevSides[productType];
    if (!side) return;
    const current = currBalances[productType] ?? 0;
    const previous = prevBalances[productType] ?? 0;

    if (side === BalanceSheetSide.Asset) {
      if (productType === AssetProductType.CashReserves) return;
      const delta = current - previous;
      const nonCashAdjustment = nonCashBalanceAdjustmentsByProduct[productType] ?? 0;
      const cashDrivenDelta = delta + nonCashAdjustment;
      const flow = -cashDrivenDelta;
      if (investingAssetProducts.has(productType)) investingBalanceFlow += flow;
      else operatingBalanceFlow += flow;
    } else {
      if (productType === LiabilityProductType.CreditProvisions) return;
      const delta = current - previous;
      const flow = delta + (nonCashBalanceAdjustmentsByProduct[productType] ?? 0);
      if (operatingLiabilityProducts.has(productType)) operatingBalanceFlow += flow;
      else financingLiabilityFlow += flow;
    }
  });

  return { operatingBalanceFlow, investingBalanceFlow, financingLiabilityFlow };
};

/**
 * Builds the period cash-flow statement and advances the simulation clock.
 * This phase deliberately contains no economic decisions: it only reconciles the already-closed
 * state to the opening state and records the derived statement.
 */
export const buildStatements = (
  inputState: BankState,
  state: BankState,
  config: SimulationConfig,
  cashStart: number,
  capitalClose: StatementCapitalCloseInputs,
  losses: StatementLossInputs
): BuildStatementsResult => {
  state.time = {
    step: state.time.step + 1,
    stepLengthMonths: state.time.stepLengthMonths,
    date: advanceDateByMonths(state.time.date, state.time.stepLengthMonths),
  };

  const cashEnd =
    state.financial.balanceSheet.items.find((item) => item.productType === AssetProductType.CashReserves)?.balance ?? 0;
  const netChange = cashEnd - cashStart;
  const { operatingBalanceFlow, investingBalanceFlow, financingLiabilityFlow } = computeBalanceFlows(
    inputState,
    state,
    losses,
    capitalClose
  );

  const investingCashFlow = investingBalanceFlow;
  const capitalDelta =
    state.financial.capital.cet1 +
    state.financial.capital.at1 -
    (inputState.financial.capital.cet1 + inputState.financial.capital.at1);
  const externalCapitalFlow = capitalDelta - capitalClose.netIncome;
  const financingCashFlow = financingLiabilityFlow + externalCapitalFlow;

  let operatingCashFlow = capitalClose.operatingCashDelta + operatingBalanceFlow;
  let cfMismatch = operatingCashFlow + investingCashFlow + financingCashFlow - netChange;

  if (Math.abs(cfMismatch) <= config.tolerances.cashFlowRoundingTolerance) {
    operatingCashFlow -= cfMismatch;
    cfMismatch = 0;
  }

  const cashFlowStatement: CashFlowStatement = {
    cashStart,
    cashEnd,
    netChange,
    operatingCashFlow,
    investingCashFlow,
    financingCashFlow,
  };
  state.financial.cashFlowStatement = cashFlowStatement;

  return { cashFlowStatement, cfMismatch };
};
