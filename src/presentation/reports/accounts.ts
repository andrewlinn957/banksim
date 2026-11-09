import type { BankState } from '../../domain/bankState';
import { BalanceSheetSide, LiabilityProductType, type ProductType } from '../../domain/enums';
import type { BalanceSheetItem } from '../../domain/balanceSheet';
import type { SeriesPoint, StatementRow } from '../../types/statements';

const buildStepChange = (series: SeriesPoint[]): number | null => {
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  const prior = [...series].reverse().find((p) => p.step < latest.step);
  if (!prior || !Number.isFinite(prior.value) || prior.value === 0) return null;
  return ((latest.value - prior.value) / Math.abs(prior.value)) * 100;
};

const balanceForProduct = (state: BankState, product: ProductType): number =>
  state.financial.balanceSheet.items.find((i) => i.productType === product)?.balance ?? 0;

const seriesFromHistory = (history: BankState[], selector: (state: BankState) => number): SeriesPoint[] =>
  history.map((s) => ({ step: s.time.step, value: selector(s) }));

const sumSide = (state: BankState, side: BalanceSheetSide): number =>
  state.financial.balanceSheet.items.filter((i) => i.side === side).reduce((sum, item) => sum + item.balance, 0);

const buildBalanceRow = (item: BalanceSheetItem, history: BankState[]): StatementRow => {
  const series = seriesFromHistory(history, (s) => balanceForProduct(s, item.productType));
  return {
    id: item.productType,
    label: item.security ? `${item.label} (${item.security.classification})` : item.label,
    value: item.balance,
    changePct: buildStepChange(series),
    series,
    rate: item.interestRate,
  };
};

export const buildAssetRows = (state: BankState, history: BankState[]): StatementRow[] => {
  const assets = state.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset);
  const rows = assets.map((item) => buildBalanceRow(item, history));
  const totalSeries = seriesFromHistory(history, (s) => sumSide(s, BalanceSheetSide.Asset));
  rows.push({
    id: 'total-assets',
    label: 'Total assets',
    value: sumSide(state, BalanceSheetSide.Asset),
    changePct: buildStepChange(totalSeries),
    series: totalSeries,
  });
  return rows;
};

export const buildLiabilityRows = (state: BankState, history: BankState[]): StatementRow[] => {
  const liabilities = state.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Liability && !(i.productType === LiabilityProductType.WholesaleFundingST && Math.abs(i.balance) < 1));
  const rows = liabilities.map((item) => buildBalanceRow(item, history));

  const cet1Series = seriesFromHistory(history, (s) => s.financial.capital.cet1);
  const at1Series = seriesFromHistory(history, (s) => s.financial.capital.at1);
  const ociSeries = seriesFromHistory(history, (s) => s.financial.capital.accumulatedOCI);
  const equitySeries = seriesFromHistory(
    history,
    (s) => s.financial.capital.cet1 + s.financial.capital.at1 + s.financial.capital.accumulatedOCI
  );
  const liabilitiesSeries = seriesFromHistory(history, (s) => sumSide(s, BalanceSheetSide.Liability));
  const balanceSheetSeries = seriesFromHistory(
    history,
    (s) =>
      sumSide(s, BalanceSheetSide.Liability) +
      s.financial.capital.cet1 +
      s.financial.capital.at1 +
      s.financial.capital.accumulatedOCI
  );

  rows.push(
    {
      id: 'capital-cet1',
      label: 'CET1 capital',
      value: state.financial.capital.cet1,
      changePct: buildStepChange(cet1Series),
      series: cet1Series,
    },
    {
      id: 'capital-at1',
      label: 'AT1 capital',
      value: state.financial.capital.at1,
      changePct: buildStepChange(at1Series),
      series: at1Series,
    },
    {
      id: 'capital-oci',
      label: 'Accumulated OCI',
      value: state.financial.capital.accumulatedOCI,
      changePct: buildStepChange(ociSeries),
      series: ociSeries,
    },
    {
      id: 'capital-total',
      label: 'Total equity',
      value:
        state.financial.capital.cet1 +
        state.financial.capital.at1 +
        state.financial.capital.accumulatedOCI,
      changePct: buildStepChange(equitySeries),
      series: equitySeries,
    },
    {
      id: 'total-liabilities',
      label: 'Total liabilities',
      value: sumSide(state, BalanceSheetSide.Liability),
      changePct: buildStepChange(liabilitiesSeries),
      series: liabilitiesSeries,
    },
    {
      id: 'liabilities-equity',
      label: 'Liabilities + equity',
      value:
        sumSide(state, BalanceSheetSide.Liability) +
        state.financial.capital.cet1 +
        state.financial.capital.at1 +
        state.financial.capital.accumulatedOCI,
      changePct: buildStepChange(balanceSheetSeries),
      series: balanceSheetSeries,
    }
  );

  return rows;
};

export const buildIncomeRows = (state: BankState, history: BankState[]): StatementRow[] => {
  const fields: Array<{ id: string; label: string; selector: (s: BankState) => number }> = [
    { id: 'interestIncome', label: 'Interest income', selector: (s) => s.financial.incomeStatement.interestIncome },
    { id: 'interestExpense', label: 'Interest expense', selector: (s) => s.financial.incomeStatement.interestExpense },
    { id: 'netInterestIncome', label: 'Net interest income', selector: (s) => s.financial.incomeStatement.netInterestIncome },
    { id: 'fvtplValuationImpact', label: 'FVTPL valuation impact', selector: (s) => s.financial.incomeStatement.fvtplValuationImpact },
    { id: 'fvociOciMovement', label: 'FVOCI OCI movement', selector: (s) => s.financial.incomeStatement.fvociOciMovement },
    { id: 'hedgeCarry', label: 'Hedge carry', selector: (s) => s.financial.incomeStatement.hedgeCarry },
    { id: 'feeIncome', label: 'Fee income', selector: (s) => s.financial.incomeStatement.feeIncome },
    { id: 'creditLosses', label: 'Credit losses', selector: (s) => s.financial.incomeStatement.creditLosses },
    { id: 'provisionCharge', label: 'Provision charge', selector: (s) => s.financial.incomeStatement.provisionCharge },
    { id: 'realizedLoanLosses', label: 'Realized loan losses', selector: (s) => s.financial.incomeStatement.realizedLoanLosses },
    { id: 'realizedNonLoanLosses', label: 'Realized non-loan losses', selector: (s) => s.financial.incomeStatement.realizedNonLoanLosses },
    { id: 'fixedOperatingCosts', label: 'Fixed operating costs', selector: (s) => s.financial.incomeStatement.fixedOperatingCosts },
    { id: 'servicingCosts', label: 'Servicing costs', selector: (s) => s.financial.incomeStatement.servicingCosts },
    { id: 'originationCosts', label: 'Origination costs', selector: (s) => s.financial.incomeStatement.originationCosts },
    { id: 'workoutCosts', label: 'Workout costs', selector: (s) => s.financial.incomeStatement.workoutCosts },
    { id: 'at1CouponExpense', label: 'AT1 coupon paid', selector: (s) => s.financial.incomeStatement.at1CouponExpense },
    { id: 'dividendsPaid', label: 'Dividends paid', selector: (s) => s.financial.incomeStatement.dividendsPaid },
    { id: 'operatingExpenses', label: 'Operating expenses', selector: (s) => s.financial.incomeStatement.operatingExpenses },
    { id: 'preTaxProfit', label: 'Pre-tax profit', selector: (s) => s.financial.incomeStatement.preTaxProfit },
    { id: 'tax', label: 'Tax', selector: (s) => s.financial.incomeStatement.tax },
    { id: 'netIncome', label: 'Net income', selector: (s) => s.financial.incomeStatement.netIncome },
    { id: 'totalComprehensiveIncome', label: 'Total comprehensive income', selector: (s) => s.financial.incomeStatement.totalComprehensiveIncome },
  ];

  return fields.map((field) => {
    const series = seriesFromHistory(history, field.selector);
    return {
      id: field.id,
      label: field.label,
      value: field.selector(state),
      changePct: buildStepChange(series),
      series,
    };
  });
};

export const buildCashRows = (state: BankState, history: BankState[]): StatementRow[] => {
  const fields: Array<{ id: string; label: string; selector: (s: BankState) => number }> = [
    { id: 'cashStart', label: 'Cash at start', selector: (s) => s.financial.cashFlowStatement.cashStart },
    { id: 'operatingCashFlow', label: 'Operating cash flow', selector: (s) => s.financial.cashFlowStatement.operatingCashFlow },
    { id: 'investingCashFlow', label: 'Investing cash flow', selector: (s) => s.financial.cashFlowStatement.investingCashFlow },
    { id: 'financingCashFlow', label: 'Financing cash flow', selector: (s) => s.financial.cashFlowStatement.financingCashFlow },
    { id: 'netChange', label: 'Net change in cash', selector: (s) => s.financial.cashFlowStatement.netChange },
    { id: 'cashEnd', label: 'Cash at end', selector: (s) => s.financial.cashFlowStatement.cashEnd },
  ];

  return fields.map((field) => {
    const series = seriesFromHistory(history, field.selector);
    return {
      id: field.id,
      label: field.label,
      value: field.selector(state),
      changePct: buildStepChange(series),
      series,
    };
  });
};

export const buildAccountsReportData = (state: BankState, history: BankState[]) => ({
  assets: buildAssetRows(state, history),
  liabilities: buildLiabilityRows(state, history),
  income: buildIncomeRows(state, history),
  cashflow: buildCashRows(state, history),
});
