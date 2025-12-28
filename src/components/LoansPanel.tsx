import { useEffect, useMemo, useState } from 'react';

import { BalanceSheetItem } from '../domain/balanceSheet';
import { AssetProductType, ProductType } from '../domain/enums';
import { LoanCohort } from '../domain/loanCohorts';
import { formatCurrency, formatRate, formatInt } from '../utils/formatters';

interface Props {
  items: BalanceSheetItem[];
  loanCohorts?: Partial<Record<ProductType, LoanCohort[]>>;
}

const LOAN_PORTFOLIOS = [AssetProductType.Mortgages, AssetProductType.CorporateLoans] as const;
type LoanPortfolioType = (typeof LOAN_PORTFOLIOS)[number];

const PORTFOLIO_LABEL: Record<LoanPortfolioType, string> = {
  [AssetProductType.Mortgages]: 'Mortgages',
  [AssetProductType.CorporateLoans]: 'Corporate Loans',
};

const PD_THRESHOLDS = { greenMax: 0.005, amberMax: 0.02 };
const LGD_THRESHOLDS = { greenMax: 0.25, amberMax: 0.45 };
const PDXLGD_THRESHOLDS = { greenMax: 0.002, amberMax: 0.008 };
const REMAINING_TERM_THRESHOLDS = { greenMax: 120, amberMax: 300 };

type RagTone = 'rag-green' | 'rag-amber' | 'rag-red';
const ragClass = (value: number, thresholds: { greenMax: number; amberMax: number }): RagTone => {
  if (!Number.isFinite(value)) return 'rag-amber';
  if (value <= thresholds.greenMax) return 'rag-green';
  if (value <= thresholds.amberMax) return 'rag-amber';
  return 'rag-red';
};

const remainingTermMonths = (cohort: LoanCohort): number => Math.max(0, Math.floor(cohort.termMonths - cohort.ageMonths));

const weightedAverage = (cohorts: readonly LoanCohort[], valueFn: (cohort: LoanCohort) => number): number => {
  let weightSum = 0;
  let weightedSum = 0;

  cohorts.forEach((cohort) => {
    const weight = Math.max(0, cohort.outstandingPrincipal ?? 0);
    const value = valueFn(cohort);
    if (!Number.isFinite(weight) || weight <= 0) return;
    if (!Number.isFinite(value)) return;

    weightSum += weight;
    weightedSum += weight * value;
  });

  return weightSum > 0 ? weightedSum / weightSum : Number.NaN;
};

type SortDirection = 'asc' | 'desc';
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
  } else {
    if (unit === 'percent') multiplier = 0.01;
    if (unit === 'billions') multiplier = 1e9;
  }

  const parsed = Number(numericPart);
  if (!Number.isFinite(parsed)) return null;
  return parsed * multiplier;
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
  if (match) {
    const value = parseNumberToken(match[2], unit);
    if (value === null) return null;
    return { kind: 'cmp', op: match[1] as '>' | '>=' | '<' | '<=' | '=', value };
  }

  return null;
};

const matchesNumericFilter = (value: number, filter: NumericFilter): boolean => {
  if (!Number.isFinite(value)) return false;

  if (filter.kind === 'range') {
    return value >= filter.min && value <= filter.max;
  }

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

type LoanSummaryColumnKey = 'product' | 'balance' | 'rate' | 'maturity';
const EMPTY_LOAN_SUMMARY_FILTERS: Record<LoanSummaryColumnKey, string> = {
  product: '',
  balance: '',
  rate: '',
  maturity: '',
};

type CohortColumnKey =
  | 'cohortId'
  | 'ageMonths'
  | 'remainingTermMonths'
  | 'outstandingPrincipal'
  | 'annualInterestRate'
  | 'annualPd'
  | 'lgd'
  | 'pdxlgd';

const EMPTY_COHORT_FILTERS: Record<CohortColumnKey, string> = {
  cohortId: '',
  ageMonths: '',
  remainingTermMonths: '',
  outstandingPrincipal: '',
  annualInterestRate: '',
  annualPd: '',
  lgd: '',
  pdxlgd: '',
};

type CohortColumnConfig = {
  key: CohortColumnKey;
  label: string;
  filterUnit: FilterUnit;
  placeholder: string;
  value: (cohort: LoanCohort) => number;
  display: (cohort: LoanCohort) => string;
  cell: (cohort: LoanCohort) => JSX.Element | string;
};

const COHORT_COLUMNS: readonly CohortColumnConfig[] = [
  {
    key: 'cohortId',
    label: 'Cohort ID',
    filterUnit: 'raw',
    placeholder: 'e.g. >= 0',
    value: (cohort) => cohort.cohortId,
    display: (cohort) => formatInt(cohort.cohortId),
    cell: (cohort) => formatInt(cohort.cohortId),
  },
  {
    key: 'ageMonths',
    label: 'Age (m)',
    filterUnit: 'raw',
    placeholder: 'e.g. > 12',
    value: (cohort) => cohort.ageMonths,
    display: (cohort) => formatInt(cohort.ageMonths),
    cell: (cohort) => formatInt(cohort.ageMonths),
  },
  {
    key: 'remainingTermMonths',
    label: 'Remaining term (m)',
    filterUnit: 'raw',
    placeholder: 'e.g. < 60',
    value: (cohort) => remainingTermMonths(cohort),
    display: (cohort) => formatInt(remainingTermMonths(cohort)),
    cell: (cohort) => {
      const remaining = remainingTermMonths(cohort);
      return <span className={`rag-badge ${ragClass(remaining, REMAINING_TERM_THRESHOLDS)}`}>{formatInt(remaining)}</span>;
    },
  },
  {
    key: 'outstandingPrincipal',
    label: 'Outstanding',
    filterUnit: 'billions',
    placeholder: 'bn (e.g. > 10)',
    value: (cohort) => cohort.outstandingPrincipal,
    display: (cohort) => formatCurrency(cohort.outstandingPrincipal),
    cell: (cohort) => formatCurrency(cohort.outstandingPrincipal),
  },
  {
    key: 'annualInterestRate',
    label: 'Coupon',
    filterUnit: 'percent',
    placeholder: '% (e.g. < 5)',
    value: (cohort) => cohort.annualInterestRate,
    display: (cohort) => formatRate(cohort.annualInterestRate),
    cell: (cohort) => formatRate(cohort.annualInterestRate),
  },
  {
    key: 'annualPd',
    label: 'PD',
    filterUnit: 'percent',
    placeholder: '% (e.g. > 2)',
    value: (cohort) => cohort.annualPd,
    display: (cohort) => formatRate(cohort.annualPd),
    cell: (cohort) => (
      <span className={`rag-badge ${ragClass(cohort.annualPd, PD_THRESHOLDS)}`}>{formatRate(cohort.annualPd)}</span>
    ),
  },
  {
    key: 'lgd',
    label: 'LGD',
    filterUnit: 'percent',
    placeholder: '% (e.g. > 45)',
    value: (cohort) => cohort.lgd,
    display: (cohort) => formatRate(cohort.lgd),
    cell: (cohort) => <span className={`rag-badge ${ragClass(cohort.lgd, LGD_THRESHOLDS)}`}>{formatRate(cohort.lgd)}</span>,
  },
  {
    key: 'pdxlgd',
    label: 'PD×LGD',
    filterUnit: 'percent',
    placeholder: '% (e.g. > 0.8)',
    value: (cohort) => cohort.annualPd * cohort.lgd,
    display: (cohort) => formatRate(cohort.annualPd * cohort.lgd),
    cell: (cohort) => {
      const risk = cohort.annualPd * cohort.lgd;
      return <span className={`rag-badge ${ragClass(risk, PDXLGD_THRESHOLDS)}`}>{formatRate(risk)}</span>;
    },
  },
] as const;

const hasPortfolioData = (
  items: readonly BalanceSheetItem[],
  loanCohorts: Partial<Record<ProductType, LoanCohort[]>> | undefined,
  portfolio: LoanPortfolioType
): boolean => {
  const hasItem = items.some((item) => item.productType === portfolio);
  const cohortCount = loanCohorts?.[portfolio]?.length ?? 0;
  return hasItem || cohortCount > 0;
};

const getDefaultPortfolio = (
  items: readonly BalanceSheetItem[],
  loanCohorts: Partial<Record<ProductType, LoanCohort[]>> | undefined
): LoanPortfolioType => {
  if (hasPortfolioData(items, loanCohorts, AssetProductType.Mortgages)) return AssetProductType.Mortgages;
  if (hasPortfolioData(items, loanCohorts, AssetProductType.CorporateLoans)) return AssetProductType.CorporateLoans;
  return AssetProductType.Mortgages;
};

const isLoanPortfolioItem = (
  item: BalanceSheetItem
): item is BalanceSheetItem & { productType: LoanPortfolioType } =>
  item.productType === AssetProductType.Mortgages || item.productType === AssetProductType.CorporateLoans;

const LoansPanel = ({ items, loanCohorts }: Props) => {
  const loans = useMemo(() => items.filter(isLoanPortfolioItem), [items]);
  const totalLoans = useMemo(() => loans.reduce((sum, loan) => sum + loan.balance, 0), [loans]);

  const [selectedPortfolio, setSelectedPortfolio] = useState<LoanPortfolioType>(() => getDefaultPortfolio(items, loanCohorts));

  const mortgagesAvailable = useMemo(
    () => hasPortfolioData(items, loanCohorts, AssetProductType.Mortgages),
    [items, loanCohorts]
  );
  const corporateAvailable = useMemo(
    () => hasPortfolioData(items, loanCohorts, AssetProductType.CorporateLoans),
    [items, loanCohorts]
  );

  useEffect(() => {
    const isSelectedAvailable = selectedPortfolio === AssetProductType.Mortgages ? mortgagesAvailable : corporateAvailable;
    if (isSelectedAvailable) return;
    setSelectedPortfolio(getDefaultPortfolio(items, loanCohorts));
  }, [corporateAvailable, items, loanCohorts, mortgagesAvailable, selectedPortfolio]);

  const [loanSummarySort, setLoanSummarySort] = useState<{ key: LoanSummaryColumnKey; direction: SortDirection } | null>(null);
  const [loanSummaryFilters, setLoanSummaryFilters] = useState<Record<LoanSummaryColumnKey, string>>(() => ({
    ...EMPTY_LOAN_SUMMARY_FILTERS,
  }));

  const loanSummaryFiltersActive = useMemo(
    () => Object.values(loanSummaryFilters).some((value) => value.trim() !== ''),
    [loanSummaryFilters]
  );

  const filteredLoans = useMemo(() => {
    const productNeedle = loanSummaryFilters.product.trim().toLowerCase();
    const maturityNeedle = loanSummaryFilters.maturity.trim().toLowerCase();

    const balanceRaw = loanSummaryFilters.balance.trim();
    const rateRaw = loanSummaryFilters.rate.trim();

    const balanceFilter = balanceRaw ? parseNumericFilter(balanceRaw, 'billions') : null;
    const rateFilter = rateRaw ? parseNumericFilter(rateRaw, 'percent') : null;

    return loans.filter((loan) => {
      if (productNeedle && !loan.label.toLowerCase().includes(productNeedle)) return false;
      if (maturityNeedle && !String(loan.maturityBucket ?? '').toLowerCase().includes(maturityNeedle)) return false;

      if (balanceRaw) {
        if (balanceFilter) {
          if (!matchesNumericFilter(loan.balance, balanceFilter)) return false;
        } else if (!formatCurrency(loan.balance).toLowerCase().includes(balanceRaw.toLowerCase())) {
          return false;
        }
      }

      if (rateRaw) {
        if (rateFilter) {
          if (!matchesNumericFilter(loan.interestRate, rateFilter)) return false;
        } else if (!formatRate(loan.interestRate).toLowerCase().includes(rateRaw.toLowerCase())) {
          return false;
        }
      }

      return true;
    });
  }, [loanSummaryFilters, loans]);

  const visibleLoans = useMemo(() => {
    if (!loanSummarySort) return filteredLoans;

    const dir = loanSummarySort.direction === 'asc' ? 1 : -1;
    const sorted = filteredLoans.slice();

    sorted.sort((a, b) => {
      if (loanSummarySort.key === 'product') return compareStrings(a.label, b.label) * dir;
      if (loanSummarySort.key === 'maturity')
        return compareStrings(String(a.maturityBucket ?? ''), String(b.maturityBucket ?? '')) * dir;
      if (loanSummarySort.key === 'balance') return compareNumbers(a.balance, b.balance) * dir;
      if (loanSummarySort.key === 'rate') return compareNumbers(a.interestRate, b.interestRate) * dir;
      return 0;
    });

    return sorted;
  }, [filteredLoans, loanSummarySort]);

  const [cohortSort, setCohortSort] = useState<{ key: CohortColumnKey; direction: SortDirection }>(() => ({
    key: 'cohortId',
    direction: 'asc',
  }));
  const [cohortFilters, setCohortFilters] = useState<Record<CohortColumnKey, string>>(() => ({ ...EMPTY_COHORT_FILTERS }));

  const cohortFiltersActive = useMemo(
    () => Object.values(cohortFilters).some((value) => value.trim() !== ''),
    [cohortFilters]
  );

  const portfolioCohorts = useMemo(
    () => (loanCohorts?.[selectedPortfolio] ?? []).filter((cohort) => cohort.productType === selectedPortfolio),
    [loanCohorts, selectedPortfolio]
  );

  const filteredCohorts = useMemo(() => {
    if (!cohortFiltersActive) return portfolioCohorts;

    return portfolioCohorts.filter((cohort) => {
      for (const column of COHORT_COLUMNS) {
        const rawFilter = cohortFilters[column.key]?.trim() ?? '';
        if (!rawFilter) continue;

        const numericFilter = parseNumericFilter(rawFilter, column.filterUnit);
        if (numericFilter) {
          if (!matchesNumericFilter(column.value(cohort), numericFilter)) return false;
          continue;
        }

        if (!column.display(cohort).toLowerCase().includes(rawFilter.toLowerCase())) return false;
      }

      return true;
    });
  }, [cohortFilters, cohortFiltersActive, portfolioCohorts]);

  const visibleCohorts = useMemo(() => {
    const sortColumn = COHORT_COLUMNS.find((column) => column.key === cohortSort.key);
    if (!sortColumn) return filteredCohorts;

    const dir = cohortSort.direction === 'asc' ? 1 : -1;
    const sorted = filteredCohorts.slice();

    sorted.sort((a, b) => {
      const cmp = compareNumbers(sortColumn.value(a), sortColumn.value(b));
      if (cmp !== 0) return cmp * dir;
      return compareNumbers(a.cohortId, b.cohortId);
    });

    return sorted;
  }, [cohortSort, filteredCohorts]);

  const cohortSummary = useMemo(() => {
    const cohortCount = visibleCohorts.length;
    const totalOutstanding = visibleCohorts.reduce((sum, cohort) => sum + (cohort.outstandingPrincipal ?? 0), 0);
    const weightedCoupon = weightedAverage(visibleCohorts, (cohort) => cohort.annualInterestRate);
    const weightedPd = weightedAverage(visibleCohorts, (cohort) => cohort.annualPd);
    const weightedLgd = weightedAverage(visibleCohorts, (cohort) => cohort.lgd);
    const weightedRisk = weightedAverage(visibleCohorts, (cohort) => cohort.annualPd * cohort.lgd);

    return { cohortCount, totalOutstanding, weightedCoupon, weightedPd, weightedLgd, weightedRisk };
  }, [visibleCohorts]);

  return (
    <div className="card stack">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h3>Loan Portfolio</h3>
        <div className="tabs" role="tablist" aria-label="Loan portfolio selector">
          <button
            type="button"
            className={`tab-button ${selectedPortfolio === AssetProductType.Mortgages ? 'active' : ''}`}
            onClick={() => setSelectedPortfolio(AssetProductType.Mortgages)}
            role="tab"
            aria-selected={selectedPortfolio === AssetProductType.Mortgages}
            disabled={!mortgagesAvailable}
          >
            {PORTFOLIO_LABEL[AssetProductType.Mortgages]}
          </button>
          <button
            type="button"
            className={`tab-button ${selectedPortfolio === AssetProductType.CorporateLoans ? 'active' : ''}`}
            onClick={() => setSelectedPortfolio(AssetProductType.CorporateLoans)}
            role="tab"
            aria-selected={selectedPortfolio === AssetProductType.CorporateLoans}
            disabled={!corporateAvailable}
          >
            {PORTFOLIO_LABEL[AssetProductType.CorporateLoans]}
          </button>
        </div>
      </div>
      <div className="muted">
        Total loans: <strong>{formatCurrency(totalLoans)}</strong>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="button small"
          onClick={() => setLoanSummaryFilters({ ...EMPTY_LOAN_SUMMARY_FILTERS })}
          disabled={!loanSummaryFiltersActive}
        >
          Clear product filters
        </button>
      </div>
      <table className="data-table clickable">
        <thead>
          <tr>
            <th>
              <button
                type="button"
                className="table-sort-button"
                onClick={() =>
                  setLoanSummarySort((prev) => {
                    if (!prev || prev.key !== 'product') return { key: 'product', direction: 'asc' };
                    return { key: 'product', direction: prev.direction === 'asc' ? 'desc' : 'asc' };
                  })
                }
              >
                Product
                {loanSummarySort?.key === 'product' && (
                  <span className="table-sort-indicator">{loanSummarySort.direction === 'asc' ? '▲' : '▼'}</span>
                )}
              </button>
            </th>
            <th className="numeric">
              <button
                type="button"
                className="table-sort-button"
                onClick={() =>
                  setLoanSummarySort((prev) => {
                    if (!prev || prev.key !== 'balance') return { key: 'balance', direction: 'asc' };
                    return { key: 'balance', direction: prev.direction === 'asc' ? 'desc' : 'asc' };
                  })
                }
              >
                Balance
                {loanSummarySort?.key === 'balance' && (
                  <span className="table-sort-indicator">{loanSummarySort.direction === 'asc' ? '▲' : '▼'}</span>
                )}
              </button>
            </th>
            <th className="numeric">
              <button
                type="button"
                className="table-sort-button"
                onClick={() =>
                  setLoanSummarySort((prev) => {
                    if (!prev || prev.key !== 'rate') return { key: 'rate', direction: 'asc' };
                    return { key: 'rate', direction: prev.direction === 'asc' ? 'desc' : 'asc' };
                  })
                }
              >
                Rate
                {loanSummarySort?.key === 'rate' && (
                  <span className="table-sort-indicator">{loanSummarySort.direction === 'asc' ? '▲' : '▼'}</span>
                )}
              </button>
            </th>
            <th>
              <button
                type="button"
                className="table-sort-button"
                onClick={() =>
                  setLoanSummarySort((prev) => {
                    if (!prev || prev.key !== 'maturity') return { key: 'maturity', direction: 'asc' };
                    return { key: 'maturity', direction: prev.direction === 'asc' ? 'desc' : 'asc' };
                  })
                }
              >
                Maturity
                {loanSummarySort?.key === 'maturity' && (
                  <span className="table-sort-indicator">{loanSummarySort.direction === 'asc' ? '▲' : '▼'}</span>
                )}
              </button>
            </th>
          </tr>
          <tr className="table-filter-row">
            <th>
              <input
                className="table-filter-input"
                value={loanSummaryFilters.product}
                onChange={(e) => setLoanSummaryFilters((prev) => ({ ...prev, product: e.target.value }))}
                placeholder="Filter product"
                aria-label="Filter loan products"
              />
            </th>
            <th className="numeric">
              <input
                className="table-filter-input"
                value={loanSummaryFilters.balance}
                onChange={(e) => setLoanSummaryFilters((prev) => ({ ...prev, balance: e.target.value }))}
                placeholder="bn (e.g. > 10)"
                aria-label="Filter balance (billions)"
              />
            </th>
            <th className="numeric">
              <input
                className="table-filter-input"
                value={loanSummaryFilters.rate}
                onChange={(e) => setLoanSummaryFilters((prev) => ({ ...prev, rate: e.target.value }))}
                placeholder="% (e.g. < 5)"
                aria-label="Filter rate (percent)"
              />
            </th>
            <th>
              <input
                className="table-filter-input"
                value={loanSummaryFilters.maturity}
                onChange={(e) => setLoanSummaryFilters((prev) => ({ ...prev, maturity: e.target.value }))}
                placeholder="Filter maturity"
                aria-label="Filter maturity bucket"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleLoans.length === 0 ? (
            <tr>
              <td colSpan={4}>
                <span className="muted">No products match the current filters.</span>
              </td>
            </tr>
          ) : (
            visibleLoans.map((l) => (
              <tr
                key={l.productType}
                className={l.productType === selectedPortfolio ? 'active' : undefined}
                onClick={() => setSelectedPortfolio(l.productType)}
              >
                <td>{l.label}</td>
                <td className="numeric">{formatCurrency(l.balance)}</td>
                <td className="numeric">{formatRate(l.interestRate)}</td>
                <td>{l.maturityBucket}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="stack" style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Cohort breakdown — {PORTFOLIO_LABEL[selectedPortfolio]}</h3>
          <div className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="rag-badge rag-green">Green safer</span>
            <span className="rag-badge rag-amber">Amber middle</span>
            <span className="rag-badge rag-red">Red riskier</span>
          </div>
        </div>

        {portfolioCohorts.length === 0 ? (
          <div className="muted">No cohort data available for this portfolio.</div>
        ) : (
          <>
            <div className="grid-metrics">
              <div className="metric-card">
                <div className="metric-label">Cohorts</div>
                <div className="metric-value">{cohortSummary.cohortCount}</div>
                {cohortFiltersActive && (
                  <div className="metric-helper">
                    Showing {cohortSummary.cohortCount}/{portfolioCohorts.length}
                  </div>
                )}
              </div>
              <div className="metric-card">
                <div className="metric-label">Outstanding</div>
                <div className="metric-value">{formatCurrency(cohortSummary.totalOutstanding)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">WA coupon</div>
                <div className="metric-value">{formatRate(cohortSummary.weightedCoupon)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">WA PD</div>
                <div className="metric-value">{formatRate(cohortSummary.weightedPd)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">WA LGD</div>
                <div className="metric-value">{formatRate(cohortSummary.weightedLgd)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">WA PD×LGD</div>
                <div className="metric-value">{formatRate(cohortSummary.weightedRisk)}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div className="muted">
                Click column headers to sort. Filters support <code>&gt;</code>, <code>&lt;</code>, and ranges (<code>..</code>); rates in %, outstanding in £bn.
              </div>
              <button
                type="button"
                className="button small"
                onClick={() => setCohortFilters({ ...EMPTY_COHORT_FILTERS })}
                disabled={!cohortFiltersActive}
              >
                Clear cohort filters
              </button>
            </div>

            <table className="data-table">
              <thead>
                <tr>
                  {COHORT_COLUMNS.map((column) => (
                    <th key={column.key} className="numeric">
                      <button
                        type="button"
                        className="table-sort-button"
                        onClick={() =>
                          setCohortSort((prev) => {
                            if (prev.key !== column.key) return { key: column.key, direction: 'asc' };
                            return { key: column.key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
                          })
                        }
                      >
                        {column.label}
                        {cohortSort.key === column.key && (
                          <span className="table-sort-indicator">{cohortSort.direction === 'asc' ? '▲' : '▼'}</span>
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
                <tr className="table-filter-row">
                  {COHORT_COLUMNS.map((column) => (
                    <th key={column.key} className="numeric">
                      <input
                        className="table-filter-input"
                        value={cohortFilters[column.key]}
                        onChange={(e) => setCohortFilters((prev) => ({ ...prev, [column.key]: e.target.value }))}
                        placeholder={column.placeholder}
                        aria-label={`Filter ${column.label}`}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleCohorts.length === 0 ? (
                  <tr>
                    <td colSpan={COHORT_COLUMNS.length}>
                      <span className="muted">No cohorts match the current filters.</span>
                    </td>
                  </tr>
                ) : (
                  visibleCohorts.map((cohort) => (
                    <tr key={`${cohort.productType}-${cohort.cohortId}`}>
                      {COHORT_COLUMNS.map((column) => (
                        <td key={column.key} className="numeric">
                          {column.cell(cohort)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
};

export default LoansPanel;
