import { useEffect, useMemo, useState } from 'react';

import { BalanceSheetItem } from '../domain/balanceSheet';
import { LoanPipelineState } from '../domain/bankState';
import { ProductType } from '../domain/enums';
import { LoanCohort, LoanWorkoutBucket } from '../domain/loanCohorts';
import { LoanProductType } from '../products/capabilities';
import {
  buildLoanPortfolioReportData,
  EMPTY_LOAN_COHORT_FILTERS,
  EMPTY_LOAN_SUMMARY_FILTERS,
  filterLoanCohorts,
  filterLoanProducts,
  LoanCohortColumnKey,
  LoanCohortFilters,
  LoanCohortSort,
  LoanSummaryFilters,
  LoanSummarySort,
  LOAN_REPORT_PORTFOLIOS,
  sortLoanCohorts,
  sortLoanProducts,
} from '../presentation/reports/loans';
import './LoanPortfolio.css';

interface Props {
  items: BalanceSheetItem[];
  loanCohorts?: Partial<Record<ProductType, LoanCohort[]>>;
  loanPipelines?: Partial<Record<ProductType, LoanPipelineState>>;
  workoutPipelines?: Partial<Record<ProductType, LoanWorkoutBucket[]>>;
}

type LoanPortfolioType = LoanProductType;
const LOAN_PORTFOLIOS = LOAN_REPORT_PORTFOLIOS;

const hasPortfolioData = (
  items: readonly BalanceSheetItem[],
  loanCohorts: Partial<Record<ProductType, LoanCohort[]>> | undefined,
  portfolio: LoanPortfolioType
): boolean => items.some((item) => item.productType === portfolio) || (loanCohorts?.[portfolio]?.length ?? 0) > 0;

const getDefaultPortfolio = (
  items: readonly BalanceSheetItem[],
  loanCohorts: Partial<Record<ProductType, LoanCohort[]>> | undefined
): LoanPortfolioType => {
  const available = LOAN_PORTFOLIOS.find((portfolio) => hasPortfolioData(items, loanCohorts, portfolio));
  const fallback = LOAN_PORTFOLIOS[0];
  if (!fallback) throw new Error('Product catalogue has no loan-capable products');
  return available ?? fallback;
};

const LoansPanel = ({ items, loanCohorts, loanPipelines, workoutPipelines }: Props) => {
  const [selectedPortfolio, setSelectedPortfolio] = useState<LoanPortfolioType>(() => getDefaultPortfolio(items, loanCohorts));
  const selectedPortfolioAvailable = useMemo(
    () => hasPortfolioData(items, loanCohorts, selectedPortfolio),
    [items, loanCohorts, selectedPortfolio]
  );
  useEffect(() => {
    if (!selectedPortfolioAvailable) setSelectedPortfolio(getDefaultPortfolio(items, loanCohorts));
  }, [items, loanCohorts, selectedPortfolioAvailable]);

  const [loanSummarySort, setLoanSummarySort] = useState<LoanSummarySort>(null);
  const [loanSummaryFilters, setLoanSummaryFilters] = useState<LoanSummaryFilters>(() => ({ ...EMPTY_LOAN_SUMMARY_FILTERS }));
  const loanSummaryFiltersActive = Object.values(loanSummaryFilters).some((value) => value.trim() !== '');
  const visibleLoans = useMemo(
    () => sortLoanProducts(filterLoanProducts(items, loanSummaryFilters), loanSummarySort),
    [items, loanSummaryFilters, loanSummarySort]
  );

  const [cohortSort, setCohortSort] = useState<LoanCohortSort>(() => ({ key: 'cohortId', direction: 'asc' }));
  const [cohortFilters, setCohortFilters] = useState<LoanCohortFilters>(() => ({ ...EMPTY_LOAN_COHORT_FILTERS }));
  const cohortFiltersActive = Object.values(cohortFilters).some((value) => value.trim() !== '');
  const portfolioCohorts = useMemo(
    () => (loanCohorts?.[selectedPortfolio] ?? []).filter((cohort) => cohort.productType === selectedPortfolio),
    [loanCohorts, selectedPortfolio]
  );
  const visibleCohorts = useMemo(
    () => sortLoanCohorts(filterLoanCohorts(portfolioCohorts, cohortFilters), cohortSort),
    [cohortFilters, cohortSort, portfolioCohorts]
  );
  const reportData = useMemo(() => buildLoanPortfolioReportData({
    items,
    loanCohorts,
    loanPipelines,
    workoutPipelines,
    selectedPortfolio,
    visibleCohorts,
    portfolioCohortCount: portfolioCohorts.length,
    cohortFiltersActive,
  }), [items, loanCohorts, loanPipelines, workoutPipelines, selectedPortfolio, visibleCohorts, portfolioCohorts.length, cohortFiltersActive]);

  return (
    <div className="card stack">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h3>Loan Portfolio</h3>
        <div className="tabs" role="tablist" aria-label="Loan portfolio selector">
          {reportData.productChoices.map(({ productType, label, available }) => (
  <button
    key={productType}
    type="button"
    className={`tab-button ${selectedPortfolio === productType ? 'active' : ''}`}
    onClick={() => setSelectedPortfolio(productType)}
    role="tab"
    aria-selected={selectedPortfolio === productType}
    disabled={!available}
  >
    {label}
  </button>
))}
        </div>
      </div>
      <div className="muted">
        Net loans: <strong>{reportData.netLoans}</strong>
      </div>
      {reportData.pipeline.length > 0 && (
        <div className="grid-metrics">
          {reportData.pipeline.map((item) => <div className="metric-card" key={item.label}><div className="metric-label">{item.label}</div><div className="metric-value">{item.value}</div></div>)}
        </div>
      )}
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
                Net carrying amount
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
                Offer rate
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
                Maturity bucket
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
                placeholder="Filter bucket"
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
                <td className="numeric">{reportData.products.find((item) => item.productType === l.productType)?.balance}</td>
                <td className="numeric">{reportData.products.find((item) => item.productType === l.productType)?.rate}</td>
                <td>{reportData.products.find((item) => item.productType === l.productType)?.maturity}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="stack" style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Cohort breakdown — {reportData.selectedPortfolioLabel}</h3>
        </div>

        {portfolioCohorts.length === 0 ? (
          <div className="muted">No cohort data available for this portfolio.</div>
        ) : (
          <>
            <div className="grid-metrics cohort-summary-grid">
              {[...reportData.summary, ...reportData.workout].map((item) => (
                <div className="metric-card" key={item.label}>
                  <div className="metric-label">{item.label}</div>
                  <div className="metric-value">{item.value}</div>
                  {item.helper && <div className="metric-helper">{item.helper}</div>}
                </div>
              ))}
            </div>

            <details className="loan-cohort-explorer">
            <summary>Explore {portfolioCohorts.length} loan cohorts</summary>
            <div className="loan-cohort-explorer-content">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div className="muted">
                Click column headers to sort. Filters support <code>&gt;</code>, <code>&lt;</code>, and ranges (<code>..</code>); rates in %, outstanding in £bn.
              </div>
              <button
                type="button"
                className="button small"
                onClick={() => setCohortFilters({ ...EMPTY_LOAN_COHORT_FILTERS })}
                disabled={!cohortFiltersActive}
              >
                Clear cohort filters
              </button>
            </div>

            <table className="data-table">
              <thead>
                <tr>
                  {reportData.columns.map(({ key, label }) => {
                    const columnKey = key as LoanCohortColumnKey;
                    return <th key={key} className={['stage', 'sector', 'geography'].includes(key) ? undefined : 'numeric'}>
                      <button
                        type="button"
                        className="table-sort-button"
                        onClick={() =>
                          setCohortSort((prev) => {
                            if (prev.key !== columnKey) return { key: columnKey, direction: 'asc' };
                            return { key: columnKey, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
                          })
                        }
                      >
                        {label}
                        {cohortSort.key === columnKey && (
                          <span className="table-sort-indicator">{cohortSort.direction === 'asc' ? '▲' : '▼'}</span>
                        )}
                      </button>
                    </th>;
                  })}
                </tr>
                <tr className="table-filter-row">
                  {reportData.columns.map(({ key, label, placeholder }) => {
                    const columnKey = key as LoanCohortColumnKey;
                    return <th key={key} className={['stage', 'sector', 'geography'].includes(key) ? undefined : 'numeric'}>
                      <input
                        className="table-filter-input"
                        value={cohortFilters[columnKey]}
                        onChange={(e) => setCohortFilters((prev) => ({ ...prev, [columnKey]: e.target.value }))}
                        placeholder={placeholder}
                        aria-label={`Filter ${label}`}
                      />
                    </th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleCohorts.length === 0 ? (
                  <tr>
                    <td colSpan={reportData.columns.length}>
                      <span className="muted">No cohorts match the current filters.</span>
                    </td>
                  </tr>
                ) : (
                  reportData.cohortRows.map((row) => (
                    <tr key={row.key}>
                      {reportData.columns.map(({ key }) => (
                        <td key={key} className={['stage', 'sector', 'geography'].includes(key) ? undefined : 'numeric'}>
                          {row.cells[key as LoanCohortColumnKey]}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
};

export default LoansPanel;
