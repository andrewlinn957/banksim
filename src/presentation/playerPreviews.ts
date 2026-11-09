import type { BankState } from '../domain/bankState';
import type { Department } from '../game/departments';
import { AssetProductType } from '../domain/enums';
import { customerDeposits } from '../game/management';
import { formatCurrency, formatPct } from '../utils/formatters';
import { buildCapitalMarketsPlanImpactText } from './quotes';

export interface DepartmentPreviewMetric {
  label: string;
  before: string;
  after: string;
}

/** The fields the GUI actually displays from its private full-state next-close preview. */
export interface DepartmentPreview {
  projectedBreach: boolean;
  ratios: Array<{ label: 'CET1' | 'Leverage' | 'LCR' | 'NSFR'; before: string; after: string }>;
  impactHeading: 'Funding & earnings' | 'Portfolio & credit' | 'Earnings & capital' | 'Cash & funding';
  commercialImpact: DepartmentPreviewMetric[];
  capitalMarketsPlanImpactText?: string;
}

const grossLoans = (state: BankState): number =>
  Object.values(state.loanCohorts ?? {}).flat().reduce((sum, cohort) => sum + cohort.outstandingPrincipal, 0) +
  Object.values(state.workoutPipelines ?? {}).flat().reduce((sum, workout) => sum + workout.defaultedPrincipal, 0);

const cashReserves = (state: BankState): number =>
  state.financial.balanceSheet.items
    .filter((item) => item.productType === AssetProductType.CashReserves)
    .reduce((sum, item) => sum + item.balance, 0);

const moneyMillions = (value: number): string =>
  `${value < 0 ? '−' : ''}£${(Math.abs(value) / 1e6).toFixed(1)}m`;

/**
 * Project the GUI's next-close preview into the exact values it renders. The API must use this
 * instead of returning the baseline/stressed BankState objects produced by SimulationController.
 */
export const buildDepartmentPreview = (
  department: Department,
  current: BankState,
  nextClose: BankState,
  currentFundingDue: number,
  threeYearPlanEnabled: boolean,
  hasCapitalMarketsDraft: boolean
): DepartmentPreview => {
  const breached = nextClose.status.hasFailed || nextClose.risk.compliance.cet1Breached ||
    Boolean(nextClose.risk.compliance.ownFundsBreached) || nextClose.risk.compliance.leverageBreached ||
    nextClose.risk.compliance.lcrBreached || nextClose.risk.compliance.nsfrBreached;
  const values: Record<Department, DepartmentPreviewMetric[]> = {
    Customers: [
      { label: 'Customer deposits', before: customerDeposits(current), after: customerDeposits(nextClose) },
      { label: 'Net interest income', before: current.financial.incomeStatement.netInterestIncome, after: nextClose.financial.incomeStatement.netInterestIncome },
    ].map((row) => ({ ...row, before: moneyMillions(row.before), after: moneyMillions(row.after) })),
    Lending: [
      { label: 'Gross loans', before: grossLoans(current), after: grossLoans(nextClose) },
      { label: 'Credit losses', before: current.financial.incomeStatement.creditLosses, after: nextClose.financial.incomeStatement.creditLosses },
    ].map((row) => ({ ...row, before: moneyMillions(row.before), after: moneyMillions(row.after) })),
    Capital: [
      { label: 'Net profit', before: current.financial.incomeStatement.netIncome, after: nextClose.financial.incomeStatement.netIncome },
      { label: 'CET1 capital', before: current.financial.capital.cet1, after: nextClose.financial.capital.cet1 },
    ].map((row) => ({ ...row, before: moneyMillions(row.before), after: moneyMillions(row.after) })),
    Treasury: [
      { label: 'Cash reserves', before: cashReserves(current), after: cashReserves(nextClose) },
      { label: 'Funding due', before: currentFundingDue, after: currentFundingDue },
    ].map((row) => ({ ...row, before: moneyMillions(row.before), after: moneyMillions(row.after) })),
  };
  const impactHeading: DepartmentPreview['impactHeading'] = department === 'Customers' ? 'Funding & earnings'
    : department === 'Lending' ? 'Portfolio & credit'
      : department === 'Capital' ? 'Earnings & capital' : 'Cash & funding';

  return {
    projectedBreach: Boolean(breached),
    ratios: (['CET1', 'Leverage', 'LCR', 'NSFR'] as const).map((label) => {
      const key = label === 'CET1' ? 'cet1Ratio' : label === 'Leverage' ? 'leverageRatio' : label.toLowerCase();
      return {
        label,
        before: formatPct(current.risk.riskMetrics[key]),
        after: formatPct(nextClose.risk.riskMetrics[key]),
      };
    }),
    impactHeading,
    commercialImpact: values[department],
    ...((department === 'Capital' || department === 'Treasury') && threeYearPlanEnabled && hasCapitalMarketsDraft ? {
      capitalMarketsPlanImpactText: buildCapitalMarketsPlanImpactText({
        cet1Before: current.risk.riskMetrics.cet1Ratio,
        cet1After: nextClose.risk.riskMetrics.cet1Ratio,
        epsBefore: current.equityMarket.epsTtm,
        epsAfter: nextClose.equityMarket.epsTtm,
      }),
    } : {}),
  };
};
