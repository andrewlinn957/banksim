import type { CapitalMarketsInstrument, CapitalMarketsPricingKind } from '../domain/capitalMarkets';

export type CapitalMarketsSettlementClass = 'cet1' | 'at1' | 'tier2' | 'senior';

export interface CapitalMarketsInstrumentDefinition {
  instrument: CapitalMarketsInstrument;
  label: string;
  pricingKind: CapitalMarketsPricingKind;
  settlement: CapitalMarketsSettlementClass;
  defaultTenorMonths?: number;
  permittedTenorMonths?: readonly number[];
  baseCapacityMultiple: number;
  basePremiumBps?: number;
  baseDiscount?: number;
  baseFeeRate: number;
}

export const CAPITAL_MARKETS_INSTRUMENTS: Record<CapitalMarketsInstrument, CapitalMarketsInstrumentDefinition> = {
  cet1: {
    instrument: 'cet1',
    label: 'CET1 equity',
    pricingKind: 'discount',
    settlement: 'cet1',
    baseCapacityMultiple: 0.35,
    baseDiscount: 0.03,
    baseFeeRate: 0.01,
  },
  at1: {
    instrument: 'at1',
    label: 'AT1',
    pricingKind: 'spread',
    settlement: 'at1',
    baseCapacityMultiple: 0.22,
    basePremiumBps: 350,
    baseFeeRate: 0,
  },
  tier2: {
    instrument: 'tier2',
    label: 'Tier 2',
    pricingKind: 'spread',
    settlement: 'tier2',
    defaultTenorMonths: 60,
    permittedTenorMonths: [60, 84, 120],
    baseCapacityMultiple: 0.35,
    basePremiumBps: 175,
    baseFeeRate: 0,
  },
  senior: {
    instrument: 'senior',
    label: 'Senior unsecured',
    pricingKind: 'spread',
    settlement: 'senior',
    defaultTenorMonths: 36,
    permittedTenorMonths: [24, 36, 60],
    baseCapacityMultiple: 0.08,
    basePremiumBps: 0,
    baseFeeRate: 0,
  },
};

export const getCapitalMarketsInstrument = (instrument: CapitalMarketsInstrument): CapitalMarketsInstrumentDefinition =>
  CAPITAL_MARKETS_INSTRUMENTS[instrument];
