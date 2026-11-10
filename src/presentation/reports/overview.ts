import type { BankState } from '../../domain/bankState';
import type { StepAttribution } from '../../domain/attribution';
import type { SimulationConfig } from '../../domain/config';
import type { Department } from '../../game/departments';
import { departmentSummary } from '../../game/departments';
import { customerDeposits, periodHistory } from '../../game/management';
import { AssetProductType, BalanceSheetSide } from '../../domain/enums';
import { formatCurrency, formatPct } from '../../utils/formatters';

const areas: Array<{ department: Department; label: string }> = [
  { department: 'Customers', label: 'Deposits' }, { department: 'Lending', label: 'Lending' },
  { department: 'Treasury', label: 'Treasury & Funding' }, { department: 'Capital', label: 'Finance & Capital' },
];
const moneyMillions = (value: number) => Number.isFinite(value) ? `${value < 0 ? '−' : ''}£${(Math.abs(value) / 1e6).toFixed(2)}m` : 'Unavailable';
const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${moneyMillions(value)}`;
const monthLabel = (date: Date) => new Date(date).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const dateMonthYear = (date: Date) => new Date(date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const grossLoans = (state: BankState) => departmentSummary('Lending', state, [state]).metrics[0].rawValue;

const buildTrend = (label: string, rows: BankState[], select: (state: BankState) => number, format: (value: number) => string) => {
  const values = rows.map((state) => ({ date: state.time.date, value: select(state) })).filter((point) => Number.isFinite(point.value));
  if (values.length < 2) return { label, waiting: true, message: 'Awaiting two months', points: [] as string[], ariaLabel: `${label}, awaiting two months` };
  const min = Math.min(...values.map((point) => point.value)), max = Math.max(...values.map((point) => point.value)), range = max - min;
  const coordinates = values.map(({ value }, index) => `${4 + index / (values.length - 1) * 172},${range ? 38 - (value - min) / range * 32 : 22}`);
  const first = values[0], last = values.at(-1)!;
  return {
    label,
    waiting: false,
    message: '',
    points: coordinates,
    first: `${format(first.value)} (${monthLabel(first.date)})`,
    last: `${format(last.value)} (${monthLabel(last.date)})`,
    ariaLabel: `${label}, ${monthLabel(first.date)} to ${monthLabel(last.date)}: ${values.map((point) => format(point.value)).join(', ')}`,
  };
};

/** Exact player-visible overview metrics, notices, chart annotations and transaction receipt. */
export const buildBoardroomOverviewData = (
  state: BankState,
  history: BankState[],
  pendingActions: string[] = [],
  attribution?: StepAttribution | null,
  config?: SimulationConfig,
  draftTransactions: string[] = [],
) => {
  const recorded = history.length ? history : [state];
  const quarter = periodHistory(recorded, 3).at(-1);
  const previous = recorded.filter((item) => item.time.step < state.time.step).at(-1);
  const opening = recorded[0];
  const hasClosed = state.time.step > opening.time.step;
  const summaries = Object.fromEntries(areas.map(({ department }) => [department, departmentSummary(department, state, recorded)])) as Record<Department, ReturnType<typeof departmentSummary>>;
  const assets = state.financial.balanceSheet.items.filter((item) => item.side === BalanceSheetSide.Asset).reduce((sum, item) => sum + item.balance, 0);
  const equity = state.financial.capital.cet1 + state.financial.capital.at1 + state.financial.capital.accumulatedOCI;
  const shareReturn = opening.equityMarket.sharePrice > 0 ? state.equityMarket.sharePrice / opening.equityMarket.sharePrice - 1 : 0;
  const loanChange = previous ? grossLoans(state) - grossLoans(previous) : 0;
  const depositChange = previous ? customerDeposits(state) - customerDeposits(previous) : 0;
  const recent = recorded.slice(-12);
  const risk = state.risk.riskMetrics;
  const compliance = state.risk.compliance;
  const riskNeedsAttention = compliance.cet1Breached || compliance.ownFundsBreached || compliance.leverageBreached || compliance.lcrBreached || compliance.nsfrBreached;
  const riskStatus = riskNeedsAttention ? 'Breach needs attention' : 'Buffers within limits';
  const cfg = config;
  const ratioRows = [
    { label: 'CET1' as const, value: risk.cet1Ratio, target: risk.internalCet1TargetRatio, max: 0.3 },
    { label: 'Leverage' as const, value: risk.leverageRatio, target: risk.internalLeverageTargetRatio ?? state.behaviour.riskAppetite?.leverage ?? (cfg?.riskLimits.minLeverageRatio ?? 0.0325) * 1.05, max: 0.15 },
    { label: 'LCR' as const, value: risk.lcr, target: risk.internalLcrTargetRatio ?? state.behaviour.riskAppetite?.lcr ?? (cfg?.riskLimits.minLcr ?? 1) * 1.1, max: 3 },
    { label: 'NSFR' as const, value: risk.nsfr, target: risk.internalNsfrTargetRatio ?? state.behaviour.riskAppetite?.nsfr ?? (cfg?.riskLimits.minNsfr ?? 1) * 1.05, max: 2.5 },
  ].map((row) => ({
    label: row.label, current: formatPct(row.value), targetDisplay: formatPct(row.target),
    currentWidth: Math.min(100, row.value / row.max * 100), targetLeft: Math.min(100, row.target / row.max * 100),
    needsAttention: row.value < row.target,
    headroom: `${row.value >= row.target ? '+' : ''}${((row.value - row.target) * 100).toFixed(2)} pp`,
    ariaLabel: `${row.label}: current ${formatPct(row.value)}, target ${formatPct(row.target)}`,
  }));
  const departments = areas.map(({ department, label }) => {
    const metrics = summaries[department].metrics;
    const primary = department === 'Capital' ? metrics[2] : metrics[0];
    const detail = department === 'Customers' ? `${signedMoney(depositChange)} last month`
      : department === 'Lending' ? `${signedMoney(loanChange)} last month`
        : department === 'Treasury' ? `${moneyMillions(metrics[2].rawValue)} due within 3 months` : `${metrics[1].value} CET1 target headroom`;
    return { department, label, primary: department === 'Capital' ? moneyMillions(primary.rawValue) : primary.value, primaryLabel: primary.label, detail };
  });
  const trends = [
    buildTrend('Monthly profit', recent.slice(1), (item) => item.financial.incomeStatement.netIncome, moneyMillions),
    buildTrend('Customer deposits', recent, customerDeposits, formatCurrency),
    buildTrend('Gross loans', recent, grossLoans, formatCurrency),
    buildTrend('CET1', recent, (item) => item.risk.riskMetrics.cet1Ratio, formatPct),
    buildTrend('LCR', recent, (item) => item.risk.riskMetrics.lcr, formatPct),
  ];
  const latest = hasClosed ? {
    date: dateMonthYear(state.time.date),
    metrics: [
      { label: 'Net interest income', value: moneyMillions(state.financial.incomeStatement.netInterestIncome) },
      { label: 'Operating expenses', value: moneyMillions(state.financial.incomeStatement.operatingExpenses) },
      { label: 'Provision charge', value: moneyMillions(state.financial.incomeStatement.provisionCharge) },
      { label: 'Net profit', value: moneyMillions(state.financial.incomeStatement.netIncome) },
    ],
    drivers: attribution ? (['nim', 'cet1Ratio', 'lcr', 'nsfr'] as const).flatMap((key) => {
      const metric = attribution.metrics[key];
      const driver = metric.lines.slice().sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))[0];
      return driver ? [{ label: metric.label, driver: driver.label, effect: `${driver.effect >= 0 ? '+' : ''}${(driver.effect * 100).toFixed(2)} pp` }] : [];
    }) : [],
  } : null;
  const lastTransaction = state.capitalMarkets?.transactions.at(-1);
  const transaction = lastTransaction ? {
    instrument: ({ cet1: 'CET1 equity', at1: 'AT1', tier2: 'Tier 2', senior: 'Senior debt' } as const)[lastTransaction.instrument],
    status: lastTransaction.status.replaceAll('-', ' '),
    date: new Date(lastTransaction.date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
    requested: moneyMillions(lastTransaction.targetAmount), executed: moneyMillions(lastTransaction.executedAmount),
    fees: moneyMillions(lastTransaction.fees), netProceeds: moneyMillions(lastTransaction.netProceeds),
  } : null;
  const attention = {
    riskNeedsAttention,
    depositsHeadline: hasClosed ? `Deposits ${depositChange < 0 ? 'fell' : 'changed'} ${moneyMillions(Math.abs(depositChange))} last month` : 'Compare your deposit offers with the market',
    depositsDetail: `${summaries.Customers.metrics[2].value} fixed-term savings · ${summaries.Customers.metrics[3].value} largest depositor/group`,
    fundingHeadline: `${moneyMillions(summaries.Treasury.metrics[2].rawValue)} funding matures within 3 months`,
    fundingDetail: `${summaries.Treasury.metrics[0].value} cash reserves available`,
    lendingHeadline: `${summaries.Lending.metrics[3].value} of loans in Stage 2 or 3`,
    lendingDetail: `${moneyMillions(summaries.Lending.metrics[2].rawValue)} undrawn commitments`,
  };
  return {
    quarter: quarter ? { label: quarter.label, months: quarter.months, periodLabel: `${quarter.label} · ${quarter.months}/3 months closed`, profit: moneyMillions(quarter.profit), detail: `${quarter.label}${quarter.months < 3 ? ' to date' : ''}` } : null,
    hasClosed,
    financialPerformance: [
      { label: 'Quarter profit', value: moneyMillions(quarter?.profit ?? 0), detail: quarter ? `${quarter.label}${quarter.months < 3 ? ' to date' : ''}` : 'No months closed' },
      { label: 'Net interest margin', value: hasClosed && assets > 0 ? formatPct(state.financial.incomeStatement.netInterestIncome * 12 / assets) : '—', detail: 'Latest month, annualised / total assets' },
      { label: 'Return on equity', value: hasClosed && equity > 0 ? formatPct(state.financial.incomeStatement.netIncome * 12 / equity) : '—', detail: 'Latest month, annualised' },
      { label: 'Share price', value: `£${state.equityMarket.sharePrice.toFixed(3)}`, detail: `${shareReturn >= 0 ? '+' : ''}${formatPct(shareReturn)} since opening · excludes dividends` },
    ],
    riskStatus,
    departments,
    ratios: ratioRows,
    attention,
    trends,
    latest,
    pendingActions: [...pendingActions],
    draftTransactions: [...draftTransactions],
    transaction,
  };
};
