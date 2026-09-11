import type { BankState } from '../domain/bankState';
import type { SimulationConfig } from '../domain/config';
import type { CapitalMarketsBookbuildResult, CapitalMarketsOrder } from '../domain/capitalMarkets';
import { BalanceSheetSide } from '../domain/enums';
import {
  getCapitalMarketsInstrument,
  type CapitalMarketsInstrumentDefinition,
  type CapitalMarketsReferenceSize,
} from '../capitalMarkets/catalogue';
import { nelsonSiegelYield } from './ukMarketModel';
import { calculateFundingMarket } from './fundingMarket';
import { buildFundingMarketFundamentals } from './fundingMarketAdapter';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const safeRatio = (num: number, den: number): number => den > 1e-9 ? num / den : 0;

const totalAssets = (state: BankState): number => state.financial.balanceSheet.items
  .filter(item => item.side === BalanceSheetSide.Asset)
  .reduce((sum, item) => sum + Math.max(0, item.balance), 0);

const ownFunds = (state: BankState): number =>
  Math.max(0, state.financial.capital.cet1) + Math.max(0, state.financial.capital.at1) + Math.max(0, state.financial.capital.tier2 ?? 0);

const referenceSize = (state: BankState, reference: CapitalMarketsReferenceSize): number => {
  if (reference === 'marketCap') return Math.max(1, state.equityMarket.marketCap);
  if (reference === 'cet1OrMarketCap') {
    return Math.max(1, state.financial.capital.cet1, state.equityMarket.marketCap * 0.6);
  }
  if (reference === 'ownFunds') return Math.max(1, ownFunds(state));
  return Math.max(1, totalAssets(state));
};

const recentIssuanceRatio = (state: BankState, instrument: CapitalMarketsOrder['instrument'], reference: number): number => {
  const currentStep = state.time.step;
  const recent = (state.capitalMarkets?.transactions ?? []).filter(
    tx => currentStep - tx.step >= 0 && currentStep - tx.step < 12
  );
  const weighted = recent.reduce(
    (sum, tx) => sum + tx.executedAmount * (tx.instrument === instrument ? 1 : 0.4),
    0
  );
  return clamp(safeRatio(weighted, reference), 0, 2);
};

const normaliseTenor = (
  definition: CapitalMarketsInstrumentDefinition,
  requested?: number
): number | undefined => {
  if (!definition.defaultTenorMonths && !definition.permittedTenorMonths) return undefined;
  const raw = Math.max(
    1,
    Math.round(requested ?? definition.defaultTenorMonths ?? definition.permittedTenorMonths?.[0] ?? 1)
  );
  const allowed = definition.permittedTenorMonths;
  if (!allowed?.length) return raw;
  return allowed.reduce(
    (best, tenor) => Math.abs(tenor - raw) < Math.abs(best - raw) ? tenor : best,
    allowed[0]
  );
};

const benchmarkRate = (
  state: BankState,
  definition: CapitalMarketsInstrumentDefinition,
  tenorMonths?: number
): number => {
  if (definition.benchmark === 'giltCurve' && tenorMonths !== undefined) {
    return nelsonSiegelYield(
      state.market.giltCurve.nelsonSiegel,
      Math.max(0.25, Math.min(30, tenorMonths / 12))
    );
  }
  return state.market.riskFreeLong;
};

export const buildCapitalMarketsBook = (
  state: BankState,
  config: SimulationConfig,
  order: CapitalMarketsOrder
): CapitalMarketsBookbuildResult => {
  const definition = getCapitalMarketsInstrument(order.instrument);
  const targetAmount = Number.isFinite(order.targetAmount) ? Math.max(0, order.targetAmount) : 0;
  const reference = referenceSize(state, definition.referenceSize);
  const recentRatio = recentIssuanceRatio(state, order.instrument, reference);
  const sizeRatio = clamp(safeRatio(targetAmount, reference), 0, 2);
  const repeatCapacityFactor = 1 / (1 + recentRatio * 1.75);
  const tenorMonths = normaliseTenor(definition, order.tenorMonths);

  let demandAmount = 0;
  let clearingDiscount: number | undefined;
  let clearingSpreadBps: number | undefined;
  let marketReferenceRate: number | undefined;
  let issuePrice: number | undefined;
  let failedPrice = false;
  let failedDemand = false;
  let fundingMarketAssessment: CapitalMarketsBookbuildResult['fundingMarketAssessment'];

  if (definition.pricingKind === 'discount') {
    // Equity capacity already falls when the bank's market capitalisation falls. Keep the
    // bookbuild tied to observable valuation and recent issuance rather than a confidence state.
    const rawCapacity = reference * definition.baseCapacityMultiple * repeatCapacityFactor;
    demandAmount = Math.max(0, rawCapacity);
    const fairValue = Math.max(1e-6, state.equityMarket.fairValuePerShare ?? state.equityMarket.sharePrice);
    const valuationRatio = clamp(state.equityMarket.sharePrice / fairValue, 0.4, 1.4);
    clearingDiscount = clamp(
      (definition.baseDiscount ?? 0.03)
      + 0.16 * Math.min(1, sizeRatio)
      + 0.06 * recentRatio
      + 0.05 * Math.max(0, 1 - valuationRatio),
      0,
      0.5
    );
    issuePrice = Math.max(
      config.behaviour.sharePriceModel?.priceFloor ?? 0.05,
      state.equityMarket.sharePrice * (1 - clearingDiscount)
    );
    failedPrice = order.maxDiscount !== undefined && clearingDiscount > Math.max(0, order.maxDiscount) + 1e-12;
  } else {
    const marketTerms = definition.fundingMarket;
    if (!marketTerms) {
      throw new Error(`Missing funding-market calibration for ${definition.instrument}`);
    }
    fundingMarketAssessment = calculateFundingMarket({
      referenceAmount: reference,
      targetAmount,
      maxSpreadBps: order.maxSpreadBps,
      requestedTenorMonths: tenorMonths,
      recentIssuanceRatio: recentRatio,
      fundamentals: buildFundingMarketFundamentals(state, config),
      instrument: {
        basePremiumBps: definition.basePremiumBps ?? 0,
        spreadSensitivity: definition.spreadSensitivity ?? 1,
        baseCapacityMultiple: definition.baseCapacityMultiple,
        newIssueConcessionBps: marketTerms.newIssueConcessionBps,
        demandSlopeBps: marketTerms.demandSlopeBps,
        hardCapacityMultiple: marketTerms.hardCapacityMultiple,
        tenorSpreadBpsPerYear: marketTerms.tenorSpreadBpsPerYear,
        defaultTenorMonths: definition.defaultTenorMonths,
        permittedTenorMonths: definition.permittedTenorMonths,
      },
    });
    demandAmount = fundingMarketAssessment.demandAtPrice;
    clearingSpreadBps = fundingMarketAssessment.clearingSpreadBps;
    marketReferenceRate = benchmarkRate(state, definition, tenorMonths);
    failedPrice =
      order.maxSpreadBps !== undefined &&
      order.maxSpreadBps + 1e-9 < fundingMarketAssessment.fairSpreadBps;
    failedDemand = !fundingMarketAssessment.tenorAvailable || fundingMarketAssessment.hardCapacity <= 1e-6;
  }

  const executable = failedPrice || failedDemand ? 0 : Math.min(targetAmount, demandAmount);
  const coverageRatio = targetAmount > 0 ? demandAmount / targetAmount : 0;
  const status: CapitalMarketsBookbuildResult['status'] = failedPrice
    ? 'failed-price'
    : failedDemand || executable <= 1e-6
      ? 'failed-demand'
      : executable + 1e-6 < targetAmount
        ? 'partial'
        : 'filled';
  const fees = executable * definition.baseFeeRate;

  return {
    instrument: order.instrument,
    pricingKind: definition.pricingKind,
    status,
    targetAmount,
    demandAmount,
    executedAmount: executable,
    coverageRatio,
    tenorMonths,
    marketReferenceRate,
    clearingSpreadBps,
    clearingDiscount,
    issuePrice,
    grossProceeds: executable,
    fees,
    netProceeds: Math.max(0, executable - fees),
    recentIssuanceRatio: recentRatio,
    fundingMarketAssessment,
  };
};
