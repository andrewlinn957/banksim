import type { BankState } from '../domain/bankState';
import type { SimulationConfig } from '../domain/config';
import type { CapitalMarketsBookbuildResult, CapitalMarketsOrder } from '../domain/capitalMarkets';
import { AssetProductType, BalanceSheetSide } from '../domain/enums';
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
  if (reference === 'originalEquityMarketCap') return originalEquityMarketCap(state);
  if (reference === 'cet1OrMarketCap') {
    return Math.max(1, state.financial.capital.cet1, state.equityMarket.marketCap * 0.6);
  }
  if (reference === 'ownFunds') return Math.max(1, ownFunds(state));
  return Math.max(1, totalAssets(state));
};

const originalEquityMarketCap = (state: BankState): number => {
  const sharesIssued = (state.capitalMarkets?.transactions ?? []).reduce((sum, transaction) => {
    if (transaction.instrument !== 'cet1' || !transaction.issuePrice || transaction.issuePrice <= 0) return sum;
    return sum + transaction.grossProceeds / transaction.issuePrice;
  }, 0);
  const preIssueShares = Math.max(1, state.equityMarket.sharesOutstanding - sharesIssued);
  // New issuance increases market capitalisation mechanically. Do not let that alone
  // manufacture more underwriting capacity for the next CET1 raise.
  return Math.max(1, preIssueShares * state.equityMarket.sharePrice);
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

const estimatePostIssueReturn = (
  state: BankState,
  config: SimulationConfig,
  targetAmount: number,
  issuePrice: number,
  feeRate: number
): { roe: number; dps: number; expectedReturn: number; costOfEquity: number } => {
  const shares = Math.max(1, state.equityMarket.sharesOutstanding);
  const annualisedEps = state.equityMarket.smoothedAnnualisedEps ?? state.equityMarket.epsTtm;
  const commonEarnings = Number.isFinite(annualisedEps) ? annualisedEps * shares : 0;
  const commonEquity = state.financial.capital.cet1 + state.financial.capital.accumulatedOCI;
  const netProceeds = targetAmount * (1 - feeRate);
  const cashRate = state.financial.balanceSheet.items.find(
    item => item.productType === AssetProductType.CashReserves
  )?.interestRate ?? 0;
  const afterTaxCashYield = Math.max(0, cashRate) * (1 - clamp(config.global.taxRate, 0, 1));
  const postIssueEquity = Math.max(1, commonEquity + netProceeds);
  const postIssueEarnings = commonEarnings + netProceeds * afterTaxCashYield;
  const postIssueRoe = postIssueEarnings / postIssueEquity;
  const minimumPrice = config.behaviour.sharePriceModel?.priceFloor ?? 0.05;
  const offerPrice = Math.max(minimumPrice, issuePrice);
  const postIssueShares = shares + (offerPrice > 0 ? targetAmount / offerPrice : 0);
  const postIssueEps = postIssueEarnings / Math.max(1, postIssueShares);
  const payoutRatio = clamp(
    Math.min(
      state.behaviour.capitalPolicy?.dividendPayoutRatio ?? config.riskLimits.capitalPolicy.defaultDividendPayoutRatio,
      state.risk.riskMetrics.maxPayoutRatio ?? 1
    ),
    0,
    1
  );
  const postIssueDps = Math.max(0, postIssueEps * payoutRatio);
  const retainedEarningsGrowth = clamp(postIssueRoe * (1 - payoutRatio), -0.5, 0.5);
  const modelCostOfEquity = config.behaviour.sharePriceModel?.costOfEquity ?? 0.12;
  const recordedCostOfEquity = state.periodFlows?.shareValuation?.costOfEquity;
  const costOfEquity = Number.isFinite(recordedCostOfEquity)
    ? recordedCostOfEquity as number
    : modelCostOfEquity;

  return {
    roe: postIssueRoe,
    dps: postIssueDps,
    expectedReturn: postIssueDps / offerPrice + retainedEarningsGrowth,
    costOfEquity: Math.max(0.01, costOfEquity),
  };
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
  let equityPostIssueRoe: number | undefined;
  let equityPostIssueDps: number | undefined;
  let equityExpectedReturn: number | undefined;
  let equityCostOfEquity: number | undefined;
  let equityReturnDemandFactor: number | undefined;

  if (definition.pricingKind === 'discount') {
    const fairValue = Math.max(1e-6, state.equityMarket.fairValuePerShare ?? state.equityMarket.sharePrice);
    const valuationRatio = clamp(state.equityMarket.sharePrice / fairValue, 0.4, 1.4);
    const baseClearingDiscount = clamp(
      (definition.baseDiscount ?? 0.03)
      + 0.16 * Math.min(1, sizeRatio)
      + 0.06 * recentRatio
      + 0.05 * Math.max(0, 1 - valuationRatio),
      0,
      0.5
    );
    const baseIssuePrice = Math.max(
      config.behaviour.sharePriceModel?.priceFloor ?? 0.05,
      state.equityMarket.sharePrice * (1 - baseClearingDiscount)
    );
    let returnShortfall = 0;
    if (order.instrument === 'cet1') {
      const estimated = estimatePostIssueReturn(state, config, targetAmount, baseIssuePrice, definition.baseFeeRate);
      equityPostIssueRoe = estimated.roe;
      equityPostIssueDps = estimated.dps;
      equityExpectedReturn = estimated.expectedReturn;
      equityCostOfEquity = estimated.costOfEquity;
      returnShortfall = clamp((equityCostOfEquity - equityExpectedReturn) / equityCostOfEquity, 0, 1);
      equityReturnDemandFactor = 1 - (1 - (definition.equityReturnDemandFloor ?? 0.2)) * returnShortfall;
    }
    const returnShortfallDiscount = (definition.equityReturnMaxDiscount ?? 0) * returnShortfall;
    clearingDiscount = clamp(baseClearingDiscount + returnShortfallDiscount, 0, 0.5);
    issuePrice = Math.max(
      config.behaviour.sharePriceModel?.priceFloor ?? 0.05,
      state.equityMarket.sharePrice * (1 - clearingDiscount)
    );
    if (order.instrument === 'cet1' && equityCostOfEquity !== undefined) {
      const priced = estimatePostIssueReturn(state, config, targetAmount, issuePrice, definition.baseFeeRate);
      equityPostIssueRoe = priced.roe;
      equityPostIssueDps = priced.dps;
      equityExpectedReturn = priced.expectedReturn;
      const pricedReturnShortfall = clamp((equityCostOfEquity - priced.expectedReturn) / equityCostOfEquity, 0, 1);
      equityReturnDemandFactor = 1 - (1 - (definition.equityReturnDemandFloor ?? 0.2)) * pricedReturnShortfall;
    }
    const rawCapacity = reference * definition.baseCapacityMultiple * repeatCapacityFactor * (equityReturnDemandFactor ?? 1);
    demandAmount = Math.max(0, rawCapacity);
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
    equityPostIssueRoe,
    equityPostIssueDps,
    equityExpectedReturn,
    equityCostOfEquity,
    equityReturnDemandFactor,
    fundingMarketAssessment,
  };
};
