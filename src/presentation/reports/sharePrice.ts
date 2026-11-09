import type { BankState } from '../../domain/bankState';
import { BalanceSheetSide } from '../../domain/enums';
import type { SimulationConfig } from '../../domain/config';
import type { SeriesPoint } from '../../types/statements';

export type SharePriceSeriesKey = 'sharePrice' | 'marketCap' | 'epsTtm' | 'trailingEps' | 'peMultiple' | 'quotedPeSmoothed' | 'quotedPeTtm' | 'priceToBook';

export interface SharePriceSeriesOption {
  key: SharePriceSeriesKey;
  label: string;
  yLabel: string;
}

export const SHARE_PRICE_SERIES_OPTIONS: SharePriceSeriesOption[] = [
  { key: 'sharePrice', label: 'Share Price', yLabel: 'Share price (GBP)' },
  { key: 'marketCap', label: 'Market Cap', yLabel: 'Market cap' },
  { key: 'epsTtm', label: 'Smoothed annualised EPS', yLabel: 'Smoothed annualised EPS (GBP)' },
  { key: 'trailingEps', label: 'TTM EPS', yLabel: 'TTM EPS (GBP)' },
  { key: 'peMultiple', label: 'Model P/E', yLabel: 'Model P/E multiple' },
  { key: 'quotedPeSmoothed', label: 'Quoted P/E (smoothed)', yLabel: 'Quoted P/E (smoothed EPS)' },
  { key: 'quotedPeTtm', label: 'Quoted P/E (TTM)', yLabel: 'Quoted P/E (TTM EPS)' },
  { key: 'priceToBook', label: 'P/B', yLabel: 'Price / book' },
];

const seriesFromHistory = (history: BankState[], selector: (state: BankState) => number): SeriesPoint[] =>
  history.map((snapshot) => ({ step: snapshot.time.step, value: selector(snapshot) }));

export const buildMonthChange = (series: SeriesPoint[]): number | null => {
  if (series.length < 2) return null;
  const ordered = [...series].sort((a, b) => a.step - b.step);
  const latest = ordered[ordered.length - 1];
  const prior = [...ordered].reverse().find((point) => point.step < latest.step);
  if (!prior || !Number.isFinite(prior.value) || prior.value === 0 || !Number.isFinite(latest.value)) return null;
  return (latest.value - prior.value) / Math.abs(prior.value);
};

export const quotedPe = (price: number, eps: number | null | undefined): number =>
  eps != null && eps > 0 ? price / eps : Number.NaN;

export const buildSharePriceReportData = (state: BankState, history: BankState[], config: SimulationConfig) => {
  const smoothedEps = state.equityMarket.smoothedAnnualisedEps ?? state.equityMarket.epsTtm;
  const trailingEps = state.equityMarket.trailingEps;
  const valuation = state.periodFlows?.shareValuation;
  const sharesOutstanding = Math.max(1, state.equityMarket.sharesOutstanding);
  const commonEquity = state.financial.balanceSheet.items.reduce(
    (sum, item) => sum + (item.side === BalanceSheetSide.Asset ? item.balance : -item.balance), 0
  ) - state.financial.capital.at1;
  const bvps = state.equityMarket.bookValuePerShare ?? commonEquity / sharesOutstanding;
  const roeProxy = bvps > 0 ? smoothedEps / bvps : Number.NaN;
  const cet1Headroom = state.risk.riskMetrics.cet1Ratio - state.risk.riskMetrics.cet1Requirement;
  const leverageHeadroom = state.risk.riskMetrics.leverageRatio - config.riskLimits.minLeverageRatio;
  const priceToBook = state.equityMarket.priceToBook ?? (bvps > 0 ? state.equityMarket.sharePrice / bvps : Number.NaN);
  const marketToBook = commonEquity > 0 ? state.equityMarket.marketCap / commonEquity : Number.NaN;

  return {
    series: {
      sharePrice: seriesFromHistory(history, (snapshot) => snapshot.equityMarket.sharePrice),
      marketCap: seriesFromHistory(history, (snapshot) => snapshot.equityMarket.marketCap),
      epsTtm: seriesFromHistory(history, (snapshot) => snapshot.equityMarket.smoothedAnnualisedEps ?? snapshot.equityMarket.epsTtm),
      trailingEps: seriesFromHistory(history, (snapshot) => snapshot.equityMarket.trailingEps ?? Number.NaN),
      quotedPeSmoothed: seriesFromHistory(history, (snapshot) => quotedPe(snapshot.equityMarket.sharePrice, snapshot.equityMarket.smoothedAnnualisedEps ?? snapshot.equityMarket.epsTtm)),
      quotedPeTtm: seriesFromHistory(history, (snapshot) => quotedPe(snapshot.equityMarket.sharePrice, snapshot.equityMarket.trailingEps)),
      peMultiple: seriesFromHistory(history, (snapshot) => snapshot.equityMarket.peMultiple),
      priceToBook: seriesFromHistory(history, (snapshot) => snapshot.equityMarket.priceToBook ?? 0),
    },
    drivers: {
      commonEquity,
      smoothedEps,
      trailingEps,
      bvps,
      roeProxy,
      cet1Headroom,
      leverageHeadroom,
      priceToBook,
      marketToBook,
      gdpGrowthMoM: valuation?.gdpGrowthMoM ?? state.market.gdpGrowthMoM,
      unemploymentRate: valuation?.unemploymentRate ?? state.market.unemploymentRate,
      creditSpread: valuation?.creditSpread ?? state.market.creditSpread,
      costOfEquity: valuation?.costOfEquity,
      earningsReliability: valuation?.earningsReliability,
      depositFranchiseStrength: state.behaviour.depositFranchiseStrength,
      recordedEarningsMonths: state.equityMarket.trailingEarningsMonths ?? 0,
      sharesOutstanding: state.equityMarket.sharesOutstanding,
      sharePrice: state.equityMarket.sharePrice,
      marketCap: state.equityMarket.marketCap,
      modelPe: state.equityMarket.peMultiple,
      fairValuePerShare: state.equityMarket.fairValuePerShare ?? state.equityMarket.sharePrice,
    },
    hasLatestValuation: valuation !== undefined,
  };
};
