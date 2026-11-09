import type { BankState } from '../../domain/bankState';
import { formatCurrency } from '../../utils/formatters';

export interface ReconciliationResult {
  name: string;
  passed: boolean;
  detail: string;
}

export const buildReconciliationReportData = (state: BankState): ReconciliationResult[] => {
  const results: ReconciliationResult[] = [];
  const totalAssets = state.financial.balanceSheet.items
    .filter((item) => item.side === 'Asset')
    .reduce((sum, item) => sum + item.balance, 0);
  const totalLiabilities = state.financial.balanceSheet.items
    .filter((item) => item.side === 'Liability')
    .reduce((sum, item) => sum + item.balance, 0);
  const totalCapital = state.financial.capital.cet1 + state.financial.capital.at1 + state.financial.capital.accumulatedOCI;
  const balanceGap = totalAssets - (totalLiabilities + totalCapital);
  results.push({
    name: 'Balance sheet balances',
    passed: Math.abs(balanceGap) < 1,
    detail: `Assets ${formatCurrency(totalAssets)} vs Liabilities+Equity ${formatCurrency(totalLiabilities + totalCapital)} (gap ${balanceGap.toFixed(2)})`,
  });

  const cashFlow = state.financial.cashFlowStatement;
  results.push({
    name: 'Cash rollforward',
    passed: Math.abs(cashFlow.cashStart + cashFlow.netChange - cashFlow.cashEnd) < 1,
    detail: `Start ${formatCurrency(cashFlow.cashStart)} + net change ${formatCurrency(cashFlow.netChange)} = end ${formatCurrency(cashFlow.cashEnd)}`,
  });
  const cashComponents = cashFlow.operatingCashFlow + cashFlow.investingCashFlow + cashFlow.financingCashFlow;
  results.push({
    name: 'Cash flow components sum',
    passed: Math.abs(cashComponents - cashFlow.netChange) < 1,
    detail: `Op ${formatCurrency(cashFlow.operatingCashFlow)} + Inv ${formatCurrency(cashFlow.investingCashFlow)} + Fin ${formatCurrency(cashFlow.financingCashFlow)} = ${formatCurrency(cashComponents)} vs net change ${formatCurrency(cashFlow.netChange)}`,
  });
  return results;
};
