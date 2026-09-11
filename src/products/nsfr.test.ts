import { describe, expect, it } from 'vitest';
import { AssetProductType as A, LiabilityProductType as L, PRODUCTS } from './catalogue';
import {
  getNsfrProductRule,
  NSFR_ASF_CATEGORIES,
  NSFR_PRODUCT_RULES,
  NSFR_RSF_CATEGORIES,
  nsfrAsfFactor,
} from './nsfr';

describe('PRA NSFR regulatory registry', () => {
  it('covers every liquidity regulatory class used by the product catalogue', () => {
    const classes = new Set(Object.values(PRODUCTS).map(product => product.regulatory.liquidity));
    classes.forEach(regulatoryClass => expect(NSFR_PRODUCT_RULES[regulatoryClass]).toBeDefined());
  });

  it('keeps product identity separate from NSFR treatment', () => {
    expect(getNsfrProductRule(L.WholesaleFundingST)).toEqual({ asf: 'counterpartyUnknown' });
    expect(getNsfrProductRule(L.WholesaleFundingLT)).toEqual({ asf: 'counterpartyUnknown' });
    expect(getNsfrProductRule(L.Tier2Debt)).toEqual({ asf: 'tier2Capital' });
    expect(getNsfrProductRule(A.Mortgages)).toEqual({ rsf: 'mortgage' });
    expect(getNsfrProductRule(A.ConsumerLoans)).toEqual({ rsf: 'otherLoan' });
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
