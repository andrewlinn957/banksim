import type { BalanceSheetItem } from '../../domain/balanceSheet';
import type { LoanPipelineState } from '../../domain/bankState';
import type { LoanCohort, LoanWorkoutBucket } from '../../domain/loanCohorts';
import type { LoanGeography, LoanSector } from '../../domain/loanCohorts';
import type { ProductType } from '../../domain/enums';
import { MaturityBucket } from '../../domain/enums';
import { formatCurrency, formatInt, formatRate } from '../../utils/formatters';
import { getProduct } from '../../products/catalogue';
import { productTypesWithCapability, type LoanProductType } from '../../products/capabilities';
import { canonicalLoanGeography, UK_ITL1_LABELS, UK_ITL1_REGIONS } from '../../domain/ukItl1';

export const LOAN_REPORT_PORTFOLIOS = productTypesWithCapability('loan');
export const LOAN_REPORT_COLUMNS = [
  { key: 'cohortId', label: 'Cohort ID', placeholder: 'e.g. >= 0' },
  { key: 'stage', label: 'Stage', placeholder: 'e.g. Stage 2' },
  { key: 'sector', label: 'Sector', placeholder: 'e.g. SME' },
  { key: 'geography', label: 'Geography', placeholder: 'e.g. London' },
  { key: 'ageMonths', label: 'Age (m)', placeholder: 'e.g. > 12' },
  { key: 'remainingTermMonths', label: 'Remaining term (m)', placeholder: 'e.g. < 60' },
  { key: 'outstandingPrincipal', label: 'Outstanding', placeholder: 'bn (e.g. > 10)' },
  { key: 'annualInterestRate', label: 'Coupon', placeholder: '% (e.g. < 5)' },
  { key: 'annualPd', label: 'Current PD', placeholder: '% (e.g. > 2)' },
  { key: 'lgd', label: 'Current LGD', placeholder: '% (e.g. > 45)' },
  { key: 'pdxlgd', label: 'PD×LGD', placeholder: '% (e.g. > 0.8)' },
] as const;

export type LoanSortDirection = 'asc' | 'desc';
export type LoanSummaryColumnKey = 'product' | 'balance' | 'rate' | 'maturity';
export type LoanCohortColumnKey = typeof LOAN_REPORT_COLUMNS[number]['key'];
export interface LoanSummaryFilters { product: string; balance: string; rate: string; maturity: string }
export type LoanSummarySort = { key: LoanSummaryColumnKey; direction: LoanSortDirection } | null;
export type LoanCohortFilters = Record<LoanCohortColumnKey, string>;
export type LoanCohortSort = { key: LoanCohortColumnKey; direction: LoanSortDirection };

export const EMPTY_LOAN_SUMMARY_FILTERS: LoanSummaryFilters = { product: '', balance: '', rate: '', maturity: '' };
export const EMPTY_LOAN_COHORT_FILTERS: LoanCohortFilters = {
  cohortId: '', stage: '', sector: '', geography: '', ageMonths: '', remainingTermMonths: '',
  outstandingPrincipal: '', annualInterestRate: '', annualPd: '', lgd: '', pdxlgd: '',
};

type FilterUnit = 'raw' | 'percent' | 'billions';
type NumericFilter =
  | { kind: 'cmp'; op: '>' | '>=' | '<' | '<=' | '='; value: number }
  | { kind: 'range'; min: number; max: number };

const parseNumberToken = (token: string, unit: FilterUnit): number | null => {
  const raw = token.trim().toLowerCase().replace(/,/g, '');
  if (!raw) return null;
  const suffixMatch = raw.match(/^(.*?)(%|bn|m|k)$/);
  let numericPart = raw;
  let multiplier = 1;
  if (suffixMatch) {
    numericPart = suffixMatch[1];
    const suffix = suffixMatch[2];
    if (suffix === '%') multiplier = 0.01;
    if (suffix === 'bn') multiplier = 1e9;
    if (suffix === 'm') multiplier = 1e6;
    if (suffix === 'k') multiplier = 1e3;
  } else if (unit === 'percent') multiplier = 0.01;
  else if (unit === 'billions') multiplier = 1e9;
  const parsed = Number(numericPart);
  return Number.isFinite(parsed) ? parsed * multiplier : null;
};

const parseNumericFilter = (input: string, unit: FilterUnit): NumericFilter | null => {
  const text = input.trim();
  if (!text) return null;
  if (text.includes('..')) {
    const [minRaw, maxRaw] = text.split('..', 2);
    const min = parseNumberToken(minRaw, unit);
    const max = parseNumberToken(maxRaw, unit);
    if (min === null || max === null) return null;
    return { kind: 'range', min: Math.min(min, max), max: Math.max(min, max) };
  }
  const match = text.match(/^(<=|>=|<|>|=)\s*(.+)$/);
  if (!match) return null;
  const value = parseNumberToken(match[2], unit);
  return value === null ? null : { kind: 'cmp', op: match[1] as '>' | '>=' | '<' | '<=' | '=', value };
};

const matchesNumericFilter = (value: number, filter: NumericFilter): boolean => {
  if (!Number.isFinite(value)) return false;
  if (filter.kind === 'range') return value >= filter.min && value <= filter.max;
  if (filter.op === '>') return value > filter.value;
  if (filter.op === '>=') return value >= filter.value;
  if (filter.op === '<') return value < filter.value;
  if (filter.op === '<=') return value <= filter.value;
  return value === filter.value;
};

const compareNumbers = (a: number, b: number): number => {
  const aFinite = Number.isFinite(a);
  const bFinite = Number.isFinite(b);
  if (!aFinite && !bFinite) return 0;
  if (!aFinite) return 1;
  if (!bFinite) return -1;
  return a - b;
};
const compareStrings = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const loanMaturityLabel = (bucket: MaturityBucket | undefined): string => {
  if (!bucket) return '—';
  const labels: Record<MaturityBucket, string> = {
    [MaturityBucket.Overnight]: 'Overnight', [MaturityBucket.LessThan1Y]: '<1 year',
    [MaturityBucket.OneToThreeY]: '1–3 years', [MaturityBucket.ThreeToFiveY]: '3–5 years',
    [MaturityBucket.GreaterThan5Y]: '>5 years', [MaturityBucket.Perpetual]: 'Perpetual',
  };
  return labels[bucket];
};

/** Shared GUI/API product summary filtering and sorting. Invalid numeric syntax falls back to displayed-text matching, as in the GUI. */
export type LoanProductBalanceItem = BalanceSheetItem & { productType: LoanProductType };
export const filterLoanProducts = (items: readonly BalanceSheetItem[], filters: LoanSummaryFilters): LoanProductBalanceItem[] => {
  const products = items.filter((item): item is LoanProductBalanceItem => LOAN_REPORT_PORTFOLIOS.includes(item.productType as LoanProductType));
  const productNeedle = filters.product.trim().toLowerCase();
  const maturityNeedle = filters.maturity.trim().toLowerCase();
  const balanceRaw = filters.balance.trim();
  const rateRaw = filters.rate.trim();
  const balanceFilter = balanceRaw ? parseNumericFilter(balanceRaw, 'billions') : null;
  const rateFilter = rateRaw ? parseNumericFilter(rateRaw, 'percent') : null;
  return products.filter((product) => {
    if (productNeedle && !product.label.toLowerCase().includes(productNeedle)) return false;
    if (maturityNeedle && !loanMaturityLabel(product.maturityBucket).toLowerCase().includes(maturityNeedle)) return false;
    if (balanceRaw && (balanceFilter
      ? !matchesNumericFilter(product.balance, balanceFilter)
      : !formatCurrency(product.balance).toLowerCase().includes(balanceRaw))) return false;
    if (rateRaw && (rateFilter
      ? !matchesNumericFilter(product.interestRate, rateFilter)
      : !formatRate(product.interestRate).toLowerCase().includes(rateRaw))) return false;
    return true;
  });
};

export const sortLoanProducts = (items: readonly LoanProductBalanceItem[], sort: LoanSummarySort): LoanProductBalanceItem[] => {
  if (!sort) return [...items];
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (sort.key === 'product') return compareStrings(a.label, b.label) * direction;
    if (sort.key === 'maturity') return compareStrings(loanMaturityLabel(a.maturityBucket), loanMaturityLabel(b.maturityBucket)) * direction;
    if (sort.key === 'balance') return compareNumbers(a.balance, b.balance) * direction;
    return compareNumbers(a.interestRate, b.interestRate) * direction;
  });
};

type CohortColumnConfig = {
  key: LoanCohortColumnKey;
  filterUnit: FilterUnit;
  value: (cohort: LoanCohort) => number;
  display: (cohort: LoanCohort) => string;
};
const COHORT_FILTER_COLUMNS: readonly CohortColumnConfig[] = [
  { key: 'cohortId', filterUnit: 'raw', value: (c) => c.cohortId, display: (c) => formatInt(c.cohortId) },
  { key: 'stage', filterUnit: 'raw', value: (c) => c.stage === 'stage3' ? 3 : c.stage === 'stage2' ? 2 : 1, display: (c) => c.stage === 'stage3' ? 'Stage 3' : c.stage === 'stage2' ? 'Stage 2' : 'Stage 1' },
  { key: 'sector', filterUnit: 'raw', value: (c) => Math.max(0, ['retailMortgage','consumer','commercialRealEstate','sme','largeCorporate','other'].indexOf(c.sector ?? 'other')), display: (c) => sectorLabel[c.sector ?? 'other'] },
  { key: 'geography', filterUnit: 'raw', value: (c) => Math.max(0, UK_ITL1_REGIONS.indexOf(canonicalLoanGeography(c.geography, c.cohortId) as typeof UK_ITL1_REGIONS[number])), display: (c) => geographyLabel[canonicalLoanGeography(c.geography, c.cohortId)] },
  { key: 'ageMonths', filterUnit: 'raw', value: (c) => c.ageMonths, display: (c) => formatInt(c.ageMonths) },
  { key: 'remainingTermMonths', filterUnit: 'raw', value: (c) => Math.max(0, Math.floor(c.termMonths - c.ageMonths)), display: (c) => formatInt(Math.max(0, Math.floor(c.termMonths - c.ageMonths))) },
  { key: 'outstandingPrincipal', filterUnit: 'billions', value: (c) => c.outstandingPrincipal, display: (c) => formatCurrency(c.outstandingPrincipal) },
  { key: 'annualInterestRate', filterUnit: 'percent', value: (c) => c.annualInterestRate, display: (c) => formatRate(c.annualInterestRate) },
  { key: 'annualPd', filterUnit: 'percent', value: (c) => currentPd(c), display: (c) => formatRate(currentPd(c)) },
  { key: 'lgd', filterUnit: 'percent', value: (c) => currentLgd(c), display: (c) => formatRate(currentLgd(c)) },
  { key: 'pdxlgd', filterUnit: 'percent', value: (c) => currentPd(c) * currentLgd(c), display: (c) => formatRate(currentPd(c) * currentLgd(c)) },
];

export const filterLoanCohorts = (cohorts: readonly LoanCohort[], filters: LoanCohortFilters): LoanCohort[] => {
  const active = Object.values(filters).some((value) => value.trim() !== '');
  if (!active) return [...cohorts];
  return cohorts.filter((cohort) => COHORT_FILTER_COLUMNS.every((column) => {
    const raw = filters[column.key]?.trim() ?? '';
    if (!raw) return true;
    const numericFilter = parseNumericFilter(raw, column.filterUnit);
    return numericFilter
      ? matchesNumericFilter(column.value(cohort), numericFilter)
      : column.display(cohort).toLowerCase().includes(raw.toLowerCase());
  }));
};

export const sortLoanCohorts = (cohorts: readonly LoanCohort[], sort: LoanCohortSort): LoanCohort[] => {
  const column = COHORT_FILTER_COLUMNS.find((candidate) => candidate.key === sort.key);
  if (!column) return [...cohorts];
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...cohorts].sort((a, b) => {
    const comparison = compareNumbers(column.value(a), column.value(b));
    return comparison !== 0 ? comparison * direction : compareNumbers(a.cohortId, b.cohortId);
  });
};

const maturity = (bucket: MaturityBucket | undefined): string => {
  if (!bucket) return '—';
  const labels: Record<MaturityBucket, string> = {
    [MaturityBucket.Overnight]: 'Overnight', [MaturityBucket.LessThan1Y]: '<1 year',
    [MaturityBucket.OneToThreeY]: '1–3 years', [MaturityBucket.ThreeToFiveY]: '3–5 years',
    [MaturityBucket.GreaterThan5Y]: '>5 years', [MaturityBucket.Perpetual]: 'Perpetual',
  };
  return labels[bucket];
};
const currentPd = (cohort: LoanCohort) => cohort.effectiveAnnualPd ?? cohort.annualPd;
const currentLgd = (cohort: LoanCohort) => cohort.effectiveLgd ?? cohort.lgd;
const sectorLabel: Record<LoanSector, string> = { retailMortgage: 'Residential mortgage', consumer: 'Consumer', commercialRealEstate: 'Commercial real estate', sme: 'SME', largeCorporate: 'Large corporate', other: 'Other' };
const geographyLabel: Record<LoanGeography, string> = { ...UK_ITL1_LABELS, south: 'South', midlands: 'Midlands', north: 'North', other: 'Other' };
const weightedAverage = (rows: readonly LoanCohort[], select: (row: LoanCohort) => number) => {
  const valid = rows.filter((row) => Number.isFinite(row.outstandingPrincipal) && row.outstandingPrincipal > 0 && Number.isFinite(select(row)));
  const weight = valid.reduce((sum, row) => sum + row.outstandingPrincipal, 0);
  return weight ? valid.reduce((sum, row) => sum + row.outstandingPrincipal * select(row), 0) / weight : Number.NaN;
};
const maxShare = (rows: readonly LoanCohort[], select: (row: LoanCohort) => string | undefined) => {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.outstandingPrincipal ?? 0), 0);
  const totals = new Map<string, number>();
  rows.forEach((row) => totals.set(select(row) ?? 'other', (totals.get(select(row) ?? 'other') ?? 0) + Math.max(0, row.outstandingPrincipal ?? 0)));
  return total ? Math.max(0, ...Array.from(totals.values(), (value) => value / total)) : 0;
};

/** GUI shared report projection. It returns labels and formatted cell values only, never mutable state objects. */
export const buildLoanPortfolioReportData = (args: {
  items: readonly BalanceSheetItem[];
  loanCohorts?: Partial<Record<ProductType, LoanCohort[]>>;
  loanPipelines?: Partial<Record<ProductType, LoanPipelineState>>;
  workoutPipelines?: Partial<Record<ProductType, LoanWorkoutBucket[]>>;
  selectedPortfolio: LoanProductType;
  visibleCohorts: readonly LoanCohort[];
  portfolioCohortCount: number;
  cohortFiltersActive?: boolean;
}) => {
  const products = args.items.filter((item) => LOAN_REPORT_PORTFOLIOS.includes(item.productType as LoanProductType));
  const totalLoans = products.reduce((sum, item) => sum + item.balance, 0);
  const cohorts = args.visibleCohorts;
  const totalExposure = cohorts.reduce((sum, row) => sum + (row.outstandingPrincipal ?? 0), 0);
  const workouts = args.workoutPipelines?.[args.selectedPortfolio] ?? [];
  const workoutStock = workouts.reduce((sum, bucket) => sum + Math.max(0, bucket.defaultedPrincipal ?? 0), 0);
  const recoveries = workouts.reduce((sum, bucket) => sum + Math.max(0, bucket.defaultedPrincipal ?? 0) * Math.max(0, Math.min(1, bucket.expectedRecoveryRate ?? 0)), 0);
  const weightedLag = workoutStock ? workouts.reduce((sum, bucket) => sum + Math.max(0, bucket.defaultedPrincipal ?? 0) * Math.max(0, bucket.monthsToResolution ?? 0), 0) / workoutStock : 0;
  const pipeline = args.loanPipelines?.[args.selectedPortfolio];
  const text = (value: number) => Number.isFinite(value) ? value.toFixed(2) : '—';
  const columns = LOAN_REPORT_COLUMNS.map(({ key, label, placeholder }) => ({ key, label, placeholder }));
  const cohortRows = cohorts.map((row) => ({
    key: `${row.productType}-${row.cohortId}`,
    cells: {
      cohortId: formatInt(row.cohortId), stage: row.stage === 'stage3' ? 'Stage 3' : row.stage === 'stage2' ? 'Stage 2' : 'Stage 1',
      sector: sectorLabel[row.sector ?? 'other'],
      geography: geographyLabel[canonicalLoanGeography(row.geography, row.cohortId)], ageMonths: formatInt(row.ageMonths),
      remainingTermMonths: formatInt(Math.max(0, Math.floor(row.termMonths - row.ageMonths))),
      outstandingPrincipal: formatCurrency(row.outstandingPrincipal), annualInterestRate: formatRate(row.annualInterestRate),
      annualPd: formatRate(currentPd(row)), lgd: formatRate(currentLgd(row)), pdxlgd: formatRate(currentPd(row) * currentLgd(row)),
    },
  }));
  const sectors = maxShare(cohorts, (row) => row.sector);
  const geographies = maxShare(cohorts, (row) => row.geography);
  const summary = [
    { label: 'Cohorts', value: formatInt(cohorts.length), helper: args.cohortFiltersActive ? `Showing ${cohorts.length}/${args.portfolioCohortCount}` : undefined },
    { label: 'Performing cohort exposure', value: formatCurrency(totalExposure) },
    { label: 'WA coupon', value: formatRate(weightedAverage(cohorts, (row) => row.annualInterestRate)) },
    { label: 'WA PD', value: formatRate(weightedAverage(cohorts, currentPd)) },
    { label: 'WA LGD', value: formatRate(weightedAverage(cohorts, currentLgd)) },
    { label: 'WA PD×LGD', value: formatRate(weightedAverage(cohorts, (row) => currentPd(row) * currentLgd(row))) },
    { label: 'Largest sector share', value: formatRate(sectors) },
    { label: 'Largest geography share', value: formatRate(geographies) },
    { label: 'WA affordability index', value: text(weightedAverage(cohorts, (row) => row.affordabilityIndex ?? 1)) },
  ];
  const workout = [
    { label: 'NPL workout stock', value: formatCurrency(workoutStock), helper: `${workouts.length} buckets pending` },
    { label: 'Expected recoveries', value: formatCurrency(recoveries), helper: `Expected charge-off ${formatCurrency(Math.max(0, workoutStock - recoveries))}` },
    { label: 'WA workout lag', value: `${weightedLag.toFixed(1)}m` },
  ];
  return {
    netLoans: formatCurrency(totalLoans),
    selectedPortfolioLabel: getProduct(args.selectedPortfolio).label,
    productChoices: LOAN_REPORT_PORTFOLIOS.map((productType) => ({ productType, label: getProduct(productType).label, available: products.some((item) => item.productType === productType) || (args.loanCohorts?.[productType]?.length ?? 0) > 0 })),
    products: products.map((item) => ({ productType: item.productType, label: item.label, balance: formatCurrency(item.balance), rate: formatRate(item.interestRate), maturity: maturity(item.maturityBucket) })),
    pipeline: pipeline ? [
      { label: 'Demand this month', value: formatCurrency(pipeline.demandNotional) },
      { label: 'Approved this month', value: formatCurrency(pipeline.approvedNotional) },
      { label: 'Approved, not yet drawn', value: formatCurrency(pipeline.committedNotional) },
    ] : [],
    columns, cohortRows, summary, workout,
  };
};
