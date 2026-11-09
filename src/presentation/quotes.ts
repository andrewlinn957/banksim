import type { CapitalMarketsBookbuildResult, CapitalMarketsInstrument, CapitalMarketsOrder } from '../domain/capitalMarkets';
import type { BankState } from '../domain/bankState';
import type { SimulationConfig } from '../domain/config';
import { buildCapitalMarketsBook } from '../engine/capitalMarkets';
import { getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';
import { formatCurrency, formatPct } from '../utils/formatters';
import { parseMoneyInput } from '../utils/parsers';

const moneyMillions = (value: number): string => '£' + (value / 1e6).toFixed(2) + 'm';

/** Exact presentation strings rendered by the GUI ticket, excluding engine-only diagnostics. */
export interface PlayerCapitalMarketsQuote {
  instrument: CapitalMarketsInstrument;
  label: string;
  pricingKind: CapitalMarketsBookbuildResult['pricingKind'];
  status: CapitalMarketsBookbuildResult['status'];
  statusLabel: string;
  targetAmount: string;
  demandAmount: string;
  executedAmount: string;
  netProceeds: string;
  coverageRatio: string;
  clearingDiscount?: string;
  issuePrice?: string;
  ownershipDilution?: string;
  clearingSpreadBps?: string;
  allInYield?: string;
  annualCouponCost?: string;
  fees: string;
  equityPostIssueRoe?: string;
  equityPostIssueDps?: string;
  equityExpectedReturn?: string;
  equityCostOfEquity?: string;
  equityReturnDemandFactor?: string;
  recentIssuanceNotice: boolean;
}

export interface CapitalMarketsPlanImpact {
  cet1Before: number;
  cet1After: number;
  epsBefore: number;
  epsAfter: number;
}

/** Build the same bounded quote fields the player ticket renders; do not serialize the engine bookbuild. */
export const buildPlayerCapitalMarketsQuote = (
  state: BankState,
  config: SimulationConfig,
  order: CapitalMarketsOrder,
): PlayerCapitalMarketsQuote => {
  const { fundingMarketAssessment: _privateAssessment, ...quote } = buildCapitalMarketsBook(state, config, order);
  const definition = getCapitalMarketsInstrument(quote.instrument);
  const allInYield = quote.marketReferenceRate !== undefined && quote.clearingSpreadBps !== undefined
    ? quote.marketReferenceRate + quote.clearingSpreadBps / 10000
    : undefined;
  const newShares = quote.issuePrice && quote.issuePrice > 0 ? quote.grossProceeds / quote.issuePrice : 0;
  const dilution = newShares > 0 ? newShares / (state.equityMarket.sharesOutstanding + newShares) : 0;
  const statusLabel = quote.status === 'filled' ? 'Full fill projected'
    : quote.status === 'partial' ? 'Partial fill projected' : 'Execution would fail';
  return {
    instrument: quote.instrument,
    label: definition.label,
    pricingKind: quote.pricingKind,
    status: quote.status,
    statusLabel,
    targetAmount: moneyMillions(quote.targetAmount),
    demandAmount: moneyMillions(quote.demandAmount),
    executedAmount: moneyMillions(quote.executedAmount),
    netProceeds: moneyMillions(quote.netProceeds),
    coverageRatio: quote.coverageRatio.toFixed(2),
    clearingDiscount: quote.pricingKind === 'discount' ? formatPct(quote.clearingDiscount ?? 0) : undefined,
    issuePrice: quote.pricingKind === 'discount' ? '£' + (quote.issuePrice ?? 0).toFixed(3) : undefined,
    ownershipDilution: quote.pricingKind === 'discount' ? formatPct(dilution) : undefined,
    clearingSpreadBps: quote.pricingKind === 'spread' ? (quote.clearingSpreadBps ?? 0).toFixed(0) + 'bp' : undefined,
    allInYield: allInYield === undefined ? undefined : formatPct(allInYield),
    annualCouponCost: allInYield === undefined ? undefined : moneyMillions(quote.executedAmount * allInYield),
    fees: moneyMillions(quote.fees),
    equityPostIssueRoe: quote.equityPostIssueRoe === undefined ? undefined : formatPct(quote.equityPostIssueRoe),
    equityPostIssueDps: quote.equityPostIssueDps === undefined ? undefined : (quote.equityPostIssueDps * 100).toFixed(2) + 'p',
    equityExpectedReturn: quote.equityExpectedReturn === undefined ? undefined : formatPct(quote.equityExpectedReturn),
    equityCostOfEquity: quote.equityCostOfEquity === undefined ? undefined : formatPct(quote.equityCostOfEquity),
    equityReturnDemandFactor: quote.equityReturnDemandFactor === undefined ? undefined : Math.round(quote.equityReturnDemandFactor * 100) + '%',
    recentIssuanceNotice: quote.recentIssuanceRatio > 0,
  };
};

export interface PlayerCapitalMarketsReceipt {
  label: string;
  statusLabel: string;
  date: string;
  executedAmount: string;
  netProceeds: string;
  fees: string;
}

export const buildLatestCapitalMarketsReceipt = (
  state: BankState | undefined,
  allowedInstruments: readonly CapitalMarketsInstrument[],
): PlayerCapitalMarketsReceipt | undefined => {
  const transaction = state?.capitalMarkets?.transactions.filter((item) => allowedInstruments.includes(item.instrument)).at(-1);
  if (!transaction) return undefined;
  return {
    label: getCapitalMarketsInstrument(transaction.instrument).label,
    statusLabel: transaction.status === 'filled' ? 'Executed' : transaction.status === 'partial' ? 'Partially filled' : 'Failed',
    date: transaction.date,
    executedAmount: moneyMillions(transaction.executedAmount),
    netProceeds: moneyMillions(transaction.netProceeds),
    fees: moneyMillions(transaction.fees),
  };
};

export const buildCapitalMarketsPlanImpactText = (impact: CapitalMarketsPlanImpact): string => 'One-month preview: CET1 ' + formatPct(impact.cet1Before) + ' → ' + formatPct(impact.cet1After) + ' · EPS ' + (impact.epsBefore * 100).toFixed(1) + 'p → ' + (impact.epsAfter * 100).toFixed(1) + 'p.';

/** Match the ticket's amount text used for the operator's Max shortcut. */
export const clampPlayerMoneyDraft = (value: string, maximum: number): string => {
  if (!Number.isFinite(maximum)) return value;
  const parsed = parseMoneyInput(value).value;
  if (parsed === undefined || parsed <= maximum) return value;
  return formatPlayerMoneyLimit(maximum);
};

export const playerMoneyLimitDescription = (maximum: number): string => 'Maximum executable now: ' + formatCurrency(Math.max(0, maximum)) + '.';

export const formatPlayerMoneyLimit = (amount: number): string => amount >= 1e9
  ? (amount / 1e9).toFixed(2).replace(/\.00$/, '') + 'bn'
  : (amount / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
