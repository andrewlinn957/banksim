import type { CapitalMarketsInstrument, CapitalMarketsPricingKind } from '../domain/capitalMarkets';
import type { CapitalMarketsFundingInstrument } from '../products/catalogue';
import {
  getCapability,
  productsWithCapability,
  type CapitalMarketsFundingProductType,
} from '../products/capabilities';

export type CapitalMarketsReferenceSize = 'marketCap' | 'cet1OrMarketCap' | 'ownFunds' | 'totalAssets';
export type CapitalMarketsConfidenceChannel = 'equity' | 'debt';
export type CapitalMarketsBenchmark = 'riskFreeLong' | 'giltCurve';

export type CapitalMarketsSettlement =
  | { kind: 'cet1' }
  | { kind: 'at1' }
  | { kind: 'fundingProduct'; productType: CapitalMarketsFundingProductType };

export interface CapitalMarketsInstrumentDefinition {
  instrument: CapitalMarketsInstrument;
  label: string;
  pricingKind: CapitalMarketsPricingKind;
  settlement: CapitalMarketsSettlement;
  referenceSize: CapitalMarketsReferenceSize;
  confidenceChannel: CapitalMarketsConfidenceChannel;
  applyCapitalCondition: boolean;
  benchmark?: CapitalMarketsBenchmark;
  spreadSensitivity?: number;
  defaultTenorMonths?: number;
  permittedTenorMonths?: readonly number[];
  baseCapacityMultiple: number;
  basePremiumBps?: number;
  baseDiscount?: number;
  baseFeeRate: number;
}

const CET1_DEFINITION: CapitalMarketsInstrumentDefinition = {
  instrument: 'cet1',
  label: 'CET1 equity',
  pricingKind: 'discount',
  settlement: { kind: 'cet1' },
  referenceSize: 'marketCap',
  confidenceChannel: 'equity',
  applyCapitalCondition: false,
  baseCapacityMultiple: 0.35,
  baseDiscount: 0.03,
  baseFeeRate: 0.01,
};

const AT1_DEFINITION: CapitalMarketsInstrumentDefinition = {
  instrument: 'at1',
  label: 'AT1',
  pricingKind: 'spread',
  settlement: { kind: 'at1' },
  referenceSize: 'cet1OrMarketCap',
  confidenceChannel: 'debt',
  applyCapitalCondition: true,
  benchmark: 'riskFreeLong',
  spreadSensitivity: 1.45,
  baseCapacityMultiple: 0.22,
  basePremiumBps: 350,
  baseFeeRate: 0,
};

interface FundingMarketCalibration {
  referenceSize: CapitalMarketsReferenceSize;
  baseCapacityMultiple: number;
  basePremiumBps: number;
  spreadSensitivity: number;
}

const FUNDING_MARKET_CALIBRATION: Record<CapitalMarketsFundingInstrument, FundingMarketCalibration> = {
  tier2: {
    referenceSize: 'ownFunds',
    baseCapacityMultiple: 0.35,
    basePremiumBps: 175,
    spreadSensitivity: 1.2,
  },
  senior: {
    referenceSize: 'totalAssets',
    baseCapacityMultiple: 0.08,
    basePremiumBps: 0,
    spreadSensitivity: 1,
  },
};

const fundingDefinitions = Object.fromEntries(
  productsWithCapability('capitalMarketsFunding').map(product => {
    const capability = getCapability(product.productType, 'capitalMarketsFunding');
    if (!capability) throw new Error(`Missing capital-markets funding capability for ${product.productType}`);
    const calibration = FUNDING_MARKET_CALIBRATION[capability.instrument];
    const definition: CapitalMarketsInstrumentDefinition = {
      instrument: capability.instrument,
      label: product.label,
      pricingKind: 'spread',
      settlement: {
        kind: 'fundingProduct',
        productType: product.productType as CapitalMarketsFundingProductType,
      },
      referenceSize: calibration.referenceSize,
      confidenceChannel: 'debt',
      applyCapitalCondition: true,
      benchmark: 'giltCurve',
      spreadSensitivity: calibration.spreadSensitivity,
      defaultTenorMonths: capability.defaultTenorMonths,
      permittedTenorMonths: capability.permittedTenorMonths,
      baseCapacityMultiple: calibration.baseCapacityMultiple,
      basePremiumBps: calibration.basePremiumBps,
      baseFeeRate: 0,
    };
    return [capability.instrument, definition];
  })
) as Record<CapitalMarketsFundingInstrument, CapitalMarketsInstrumentDefinition>;

export const CAPITAL_MARKETS_INSTRUMENTS: Record<CapitalMarketsInstrument, CapitalMarketsInstrumentDefinition> = {
  cet1: CET1_DEFINITION,
  at1: AT1_DEFINITION,
  tier2: fundingDefinitions.tier2,
  senior: fundingDefinitions.senior,
};

export const CAPITAL_MARKETS_INSTRUMENT_ORDER: readonly CapitalMarketsInstrument[] = [
  'cet1',
  'at1',
  'tier2',
  'senior',
];

export const getCapitalMarketsInstrument = (
  instrument: CapitalMarketsInstrument
): CapitalMarketsInstrumentDefinition => CAPITAL_MARKETS_INSTRUMENTS[instrument];
