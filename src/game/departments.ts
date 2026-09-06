import { BankState } from '../domain/bankState';
import { AssetProductType as A, LiabilityProductType as L } from '../domain/enums';
import { PRODUCT_META } from '../domain/productMeta';
import { formatPct } from '../utils/formatters';
import { customerDeposits } from './management';

export type Department = 'Customers' | 'Lending' | 'Capital' | 'Treasury';
export interface DepartmentMetric {
  label: string;
  value: string;
  rawValue: number;
  unit: 'currency' | 'ratio' | 'percentagePoints';
}
export interface DepartmentSummary {
  title: Department;
  status: string;
  metrics: DepartmentMetric[];
  explanation: string;
  reportTab: 'Overview' | 'Loans' | 'Regulatory';
  reportLabel: string;
}

const money = (value: number) => !Number.isFinite(value) ? 'Unavailable'
  : `${value < 0 ? '−' : ''}£${(Math.abs(value) / (Math.abs(value) >= 1e9 ? 1e9 : 1e6)).toFixed(2)}${Math.abs(value) >= 1e9 ? 'bn' : 'm'}`;
const metric = (label: string, rawValue: number, unit: DepartmentMetric['unit'] = 'currency'): DepartmentMetric => ({
  label, rawValue, unit,
  value: unit === 'currency' ? money(rawValue) : unit === 'ratio' ? formatPct(rawValue)
    : Number.isFinite(rawValue) ? `${rawValue >= 0 ? '+' : '−'}${Math.abs(rawValue * 100).toFixed(2)} pp` : 'Unavailable',
});

// Game quarters start at the opening state. At a quarter close, show the quarter
// just completed. Require its actual opening snapshot rather than invent a delta.
function quarterStates(state: BankState, history: BankState[]) {
  const first = history[0] ?? state;
  const elapsed = Math.max(0, state.time.step - first.time.step);
  const openingStep = first.time.step + Math.floor(Math.max(0, elapsed - 1) / 3) * 3;
  const opening = history.find(s => s.time.step === openingStep) ?? (openingStep === state.time.step ? state : undefined);
  const recorded = new Map(history.filter(s => s.time.step > openingStep && s.time.step <= state.time.step).map(s => [s.time.step, s]));
  if (state.time.step > openingStep) recorded.set(state.time.step, state);
  return { opening, recorded: [...recorded.values()], complete: recorded.size === state.time.step - openingStep };
}

export function departmentSummary(department: Department, state: BankState, history: BankState[]): DepartmentSummary {
  const m = state.risk.riskMetrics;
  const quarter = quarterStates(state, history);
  const balance = (product: A | L) => state.financial.balanceSheet.items.filter(i => i.productType === product).reduce((n, i) => n + i.balance, 0);

  if (department === 'Customers') {
    const deposits = customerDeposits(state);
    const change = quarter.opening ? deposits - customerDeposits(quarter.opening) : NaN;
    const interest = state.financial.balanceSheet.items.filter(i => PRODUCT_META[i.productType]?.behaviour?.isCustomerDeposit)
      .reduce((n, i) => n + i.balance * i.interestRate, 0);
    return { title: department, status: change < 0 ? 'Deposit base contracting' : change > 0 ? 'Deposit base growing' : 'Customer funding',
      metrics: [metric('Customer deposits', deposits), metric('Deposit change this quarter', change), metric('Average annual deposit rate', deposits > 0 ? interest / deposits : NaN, 'ratio')],
      explanation: `${change < 0 ? 'Customer deposits have fallen this quarter. ' : ''}Your savings offer affects retention gradually. A higher rate also raises the interest bill, leaving less profit to support lending.`,
      reportTab: 'Overview', reportLabel: 'Read bank overview report' };
  }

  if (department === 'Lending') {
    const products = [A.Mortgages, A.CorporateLoans];
    const cohorts = products.flatMap(p => state.loanCohorts?.[p] ?? []);
    const workouts = products.flatMap(p => state.workoutPipelines?.[p] ?? []);
    const gross = cohorts.reduce((n, c) => n + c.outstandingPrincipal, 0) + workouts.reduce((n, w) => n + w.defaultedPrincipal, 0);
    const committed = products.reduce((n, p) => n + (state.loanPipelines?.[p]?.committedNotional ?? 0), 0);
    const approvals = quarter.complete ? quarter.recorded.reduce((n, s) => n + products.reduce((sum, p) => sum + (s.loanPipelines?.[p]?.approvedNotional ?? 0), 0), 0) : NaN;
    const stressed = cohorts.filter(c => c.stage !== 'stage1').reduce((n, c) => n + c.outstandingPrincipal, 0) + workouts.reduce((n, w) => n + w.defaultedPrincipal, 0);
    return { title: department, status: m.internalCet1Headroom < 0 ? 'Expansion strains capital' : committed > balance(A.CashReserves) ? 'Commitments exceed current cash' : 'Lending pipeline',
      metrics: [metric('Gross loan principal', gross), metric('Approvals this quarter', approvals), metric('Undrawn commitments', committed), metric('Stage 2 and 3 share', gross > 0 ? stressed / gross : 0, 'ratio')],
      explanation: 'Pricing and underwriting change new approvals. Customers draw approved loans over time, using cash and capital. Existing loans keep their terms and credit history; undrawn commitments are not all due immediately.',
      reportTab: 'Loans', reportLabel: 'Read loan portfolio report' };
  }

  if (department === 'Capital') {
    const profit = quarter.complete ? quarter.recorded.reduce((n, s) => n + s.financial.incomeStatement.netIncome, 0) : NaN;
    return { title: department, status: state.risk.compliance.cet1Breached || state.risk.compliance.ownFundsBreached || state.risk.compliance.leverageBreached ? 'Capital needs attention' : m.payoutBlockedByInternalTarget || m.mdaTriggered ? 'Distributions restricted' : m.internalCet1Headroom < 0 ? 'Below internal capital target' : 'Above internal capital target',
      metrics: [metric('CET1 ratio', m.cet1Ratio, 'ratio'), metric('Headroom above internal target', m.internalCet1Headroom, 'percentagePoints'), metric('Profit this quarter', profit), metric('Maximum dividend payout', m.maxPayoutRatio, 'ratio')],
      explanation: 'Retained profit replenishes capital; losses and dividends consume it. Share issuance can add capital but dilutes existing holders. Headroom measures the gap to the internal CET1 target, not a cash balance or a guaranteed lending allowance.',
      reportTab: 'Regulatory', reportLabel: 'Read capital and liquidity report' };
  }

  const due = [L.WholesaleFundingST, L.WholesaleFundingLT].reduce((n, p) => n + (state.fundingLadders?.[p] ?? []).filter(b => b.monthsToMaturity <= 3).reduce((sum, b) => sum + Math.max(0, b.notional), 0), 0);
  return { title: department, status: state.risk.compliance.lcrBreached || state.risk.compliance.nsfrBreached ? 'Funding needs attention' : due > 0 ? 'Refinancing ahead' : 'Treasury position',
    metrics: [metric('Cash reserves', balance(A.CashReserves)), metric('Wholesale funding due within 3 months', due), metric('Liquidity coverage', m.lcr, 'ratio'), metric('Stable funding ratio', m.nsfr, 'ratio')],
    explanation: 'Term borrowing buys time to fund lending and refinance maturities, at an interest cost. Hedge contracts change exposure to rates; they do not create spare capital. Funding shown due excludes deposits and repos.',
    reportTab: 'Regulatory', reportLabel: 'Read capital and liquidity report' };
}
