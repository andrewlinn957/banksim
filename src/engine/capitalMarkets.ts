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

const confidenceImpact = (state: BankState, config: SimulationConfig) => {
  const confidenceState = state.behaviour.fundingConfidenceState ?? state.risk.riskMetrics.fundingConfidenceState ?? 'stable';
  const fallback = { spreadPenaltyBps: 0, accessMultiplier: 1, equityIssuanceMultiplier: 1, equityIssuanceFeeRate: 0 };
  return config.behaviour.confidenceStateMachine?.impacts?.[confidenceState] ?? fallback;
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
  const targetAmount = Math.max(0, order.targetAmount);
  const reference = referenceSize(state, definition.referenceSize);
  const recentRatio = recentIssuanceRatio(state, order.instrument, reference);
  const confidence = clamp(
    state.risk.riskMetrics.fundingConfidenceScore ?? state.behaviour.fundingConfidenceScore ?? 0.75,
    0,
    1
  );
  const impact = confidenceImpact(state, config);
  const sizeRatio = clamp(safeRatio(targetAmount, reference), 0, 2);
  const repeatCapacityFactor = 1 / (1 + recentRatio * 1.75);
  const confidenceCapacity = definition.confidenceChannel === 'equity'
    ? clamp(impact.equityIssuanceMultiplier, 0, 1)
    : clamp(impact.accessMultiplier, 0, 1);
  const capitalCondition = definition.applyCapitalCondition
    ? clamp(0.65 + Math.max(-0.15, state.risk.riskMetrics.internalCet1Headroom ?? 0) * 7, 0.25, 1.15)
    : 1;
  const rawCapacity =
    reference *
    definition.baseCapacityMultiple *
    confidenceCapacity *
    repeatCapacityFactor *
    capitalCondition;
  const demandAmount = Math.max(0, rawCapacity);
  const coverageRatio = targetAmount > 0 ? demandAmount / targetAmount : 0;
  const tenorMonths = normaliseTenor(definition, order.tenorMonths);

  let clearingDiscount: number | undefined;
  let clearingSpreadBps: number | undefined;
  let marketReferenceRate: number | undefined;
  let issuePrice: number | undefined;
  let failedPrice = false;

  if (definition.pricingKind === 'discount') {
    const fairValue = Math.max(1e-6, state.equityMarket.fairValuePerShare ?? state.equityMarket.sharePrice);
    const valuationRatio = clamp(state.equityMarket.sharePrice / fairValue, 0.4, 1.4);
    clearingDiscount = clamp(
      (definition.baseDiscount ?? 0.03)
      + 0.16 * Math.min(1, sizeRatio)
      + 0.08 * (1 - confidence)
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
    const sensitivity = definition.spreadSensitivity ?? 1;
    const seniorMarketSpreadBps = Math.max(0, state.market.seniorDebtSpread * 10000);
    const capitalPenaltyBps =
      Math.max(0, -(state.risk.riskMetrics.internalCet1Headroom ?? 0)) * 10000 * 1.5 * sensitivity;
    clearingSpreadBps = Math.max(
      0,
      seniorMarketSpreadBps
        + (definition.basePremiumBps ?? 0)
        + impact.spreadPenaltyBps * sensitivity
        + 140 * Math.min(1.5, sizeRatio) * sensitivity
        + 180 * recentRatio * sensitivity
        + capitalPenaltyBps
    );
    marketReferenceRate = benchmarkRate(state, definition, tenorMonths);
    failedPrice = order.maxSpreadBps !== undefined && clearingSpreadBps > Math.max(0, order.maxSpreadBps) + 1e-9;
  }

  const executable = failedPrice ? 0 : Math.min(targetAmount, demandAmount);
  const status: CapitalMarketsBookbuildResult['status'] = failedPrice
    ? 'failed-price'
    : executable <= 1e-6
      ? 'failed-demand'
      : executable + 1e-6 < targetAmount
        ? 'partial'
        : 'filled';
  const feeRate = definition.confidenceChannel === 'equity'
    ? clamp(definition.baseFeeRate + impact.equityIssuanceFeeRate, 0, 0.5)
    : definition.baseFeeRate;
  const fees = executable * feeRate;

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
  };
};
