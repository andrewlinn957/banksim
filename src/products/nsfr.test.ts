import { describe, expect, it } from 'vitest';
import { AssetProductType as A, LiabilityProductType as L, PRODUCTS } from './catalogue';
import {
  getNsfrProductRule,
  NSFR_ASF_CATEGORIES,
  NSFR_RSF_CATEGORIES,
  nsfrAsfFactor,
} from './nsfr';

describe('PRA NSFR regulatory registry', () => {
  it('gives every catalogue product explicit ASF and RSF classifications', () => {
    Object.values(PRODUCTS).forEach(product => {
      expect(product.regulatory.nsfrAsf).toBeDefined();
      expect(product.regulatory.nsfrRsf).toBeDefined();
    });
  });

  it('keeps product identity and LCR treatment separate from NSFR treatment', () => {
    expect(getNsfrProductRule(L.WholesaleFundingST)).toEqual({ asf: 'counterpartyUnknown', rsf: undefined });
    expect(getNsfrProductRule(L.WholesaleFundingLT)).toEqual({ asf: 'counterpartyUnknown', rsf: undefined });
    expect(getNsfrProductRule(L.Tier2Debt)).toEqual({ asf: 'tier2Capital', rsf: undefined });
    expect(getNsfrProductRule(A.Mortgages)).toEqual({ asf: undefined, rsf: 'mortgage' });
    expect(getNsfrProductRule(A.ConsumerLoans)).toEqual({ asf: undefined, rsf: 'otherLoan' });
    expect(PRODUCTS[L.WholesaleFundingLT].regulatory.liquidity).toBe('wholesaleFundingLong');
    expect(PRODUCTS[L.WholesaleFundingLT].regulatory.nsfrAsf).toBe('counterpartyUnknown');
  });

  it('implements the PRA C81 maturity schedules centrally', () => {
    expect(nsfrAsfFactor('counterpartyUnknown', 5)).toBe(0);
    expect(nsfrAsfFactor('counterpartyUnknown', 6)).toBe(0.5);
    expect(nsfrAsfFactor('counterpartyUnknown', 12)).toBe(1);

    expect(nsfrAsfFactor('tier2Capital', 11)).toBe(0);
    expect(nsfrAsfFactor('tier2Capital', 12)).toBe(1);

    expect(nsfrAsfFactor('stableRetail', 1)).toBe(0.95);
    expect(nsfrAsfFactor('otherRetail', 1)).toBe(0.90);
    expect(nsfrAsfFactor('stableRetail', 12)).toBe(1);
    expect(nsfrAsfFactor('otherRetail', 12)).toBe(1);
  });

  it('records the COREP C80 and C81 categories alongside factors', () => {
    expect(NSFR_ASF_CATEGORIES.stableRetail).toMatchObject({ corep: 'C81 2.2.1', label: 'Stable retail deposits' });
    expect(NSFR_ASF_CATEGORIES.tier2Capital).toMatchObject({ corep: 'C81 2.1.3' });
    expect(NSFR_RSF_CATEGORIES.mortgageLong).toMatchObject({ corep: 'C80 1.4.5' });
    expect(NSFR_RSF_CATEGORIES.nonPerforming).toMatchObject({ corep: 'C80 1.9.3' });
    expect(NSFR_RSF_CATEGORIES.undrawnCommitment).toMatchObject({ corep: 'C80 1.10.2' });
  });
});
