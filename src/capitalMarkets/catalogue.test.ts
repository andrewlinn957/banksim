import { describe, expect, it } from 'vitest';
import { LiabilityProductType, getProduct } from '../products/catalogue';
import { getCapability } from '../products/capabilities';
import { CAPITAL_MARKETS_INSTRUMENT_ORDER, getCapitalMarketsInstrument } from './catalogue';

describe('capital-markets catalogue layering', () => {
  it('derives product-backed instrument identity and tenors from product capabilities', () => {
    const tier2 = getCapitalMarketsInstrument('tier2');
    const senior = getCapitalMarketsInstrument('senior');
    expect(tier2.label).toBe(getProduct(LiabilityProductType.Tier2Debt).label);
    expect(tier2.permittedTenorMonths).toEqual(
      getCapability(LiabilityProductType.Tier2Debt, 'capitalMarketsFunding')?.permittedTenorMonths
    );
    expect(tier2.settlement).toEqual({ kind: 'fundingProduct', productType: LiabilityProductType.Tier2Debt });
    expect(senior.label).toBe(getProduct(LiabilityProductType.WholesaleFundingLT).label);
    expect(senior.permittedTenorMonths).toEqual(
      getCapability(LiabilityProductType.WholesaleFundingLT, 'capitalMarketsFunding')?.permittedTenorMonths
    );
    expect(senior.settlement).toEqual({ kind: 'fundingProduct', productType: LiabilityProductType.WholesaleFundingLT });
  });

  it('keeps demand-curve calibration on the instrument definition', () => {
    expect(getCapitalMarketsInstrument('at1').fundingMarket).toEqual(
      expect.objectContaining({ demandSlopeBps: 175, hardCapacityMultiple: 1.5 })
    );
    expect(getCapitalMarketsInstrument('tier2').fundingMarket).toEqual(
      expect.objectContaining({ demandSlopeBps: 120, hardCapacityMultiple: 1.8 })
    );
    expect(getCapitalMarketsInstrument('senior').fundingMarket).toEqual(
      expect.objectContaining({ demandSlopeBps: 75, hardCapacityMultiple: 2.5 })
    );
    expect(getCapitalMarketsInstrument('cet1').fundingMarket).toBeUndefined();
  });

  it('exposes a single ordered registry for the management UI', () => {
    expect(CAPITAL_MARKETS_INSTRUMENT_ORDER).toEqual(['cet1', 'at1', 'tier2', 'senior']);
    expect(CAPITAL_MARKETS_INSTRUMENT_ORDER.map(key => getCapitalMarketsInstrument(key).label)).toEqual([
      'CET1 equity', 'AT1', 'Tier 2 subordinated debt', 'Long-Term Debt',
    ]);
  });
});
