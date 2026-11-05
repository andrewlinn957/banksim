import type { BankState } from '../domain/bankState';
import { BalanceSheetSide, type ProductType } from '../domain/enums';
import { PRODUCTS } from './catalogue';

export interface LoanCarryingAmounts {
  gross: number;
  fundedAllowance: number;
  net: number;
  /** Gross less allowance less recorded net; zero for reconciled books. */
  reconciliationDifference: number;
}

/** Accounting loan amounts, including unresolved workouts in gross exposure. */
export const loanCarryingAmounts = (state: BankState) => {
  const byProduct: Partial<Record<ProductType, LoanCarryingAmounts>> = {};
  const products = new Set<ProductType>([
    ...state.financial.balanceSheet.items.map(item => item.productType),
    ...Object.keys(state.loanCohorts ?? {}) as ProductType[],
    ...Object.keys(state.workoutPipelines ?? {}) as ProductType[],
  ]);
  for (const product of products) {
    if (!PRODUCTS[product]?.behaviour?.isLoan) continue;
    const positions = state.financial.balanceSheet.items.filter(item => item.side === BalanceSheetSide.Asset && item.productType === product);
    const net = positions.reduce((sum, item) => sum + item.balance, 0);
    const fundedAllowance = positions.reduce((sum, item) => sum + (item.lossAllowance ?? 0), 0);
    const hasLedger = state.loanCohorts?.[product] !== undefined || state.workoutPipelines?.[product] !== undefined;
    const gross = hasLedger
      ? (state.loanCohorts?.[product] ?? []).reduce((sum, cohort) => sum + cohort.outstandingPrincipal, 0) +
        (state.workoutPipelines?.[product] ?? []).reduce((sum, workout) => sum + workout.defaultedPrincipal, 0)
      : net + fundedAllowance;
    byProduct[product] = { gross, fundedAllowance, net, reconciliationDifference: gross - fundedAllowance - net };
  }
  const total = Object.values(byProduct).reduce<LoanCarryingAmounts>((sum, row) => ({
    gross: sum.gross + row.gross,
    fundedAllowance: sum.fundedAllowance + row.fundedAllowance,
    net: sum.net + row.net,
    reconciliationDifference: sum.reconciliationDifference + row.reconciliationDifference,
  }), { gross: 0, fundedAllowance: 0, net: 0, reconciliationDifference: 0 });
  return { total, byProduct };
};
