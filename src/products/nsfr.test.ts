import { describe, expect, it } from 'vitest';
import { AssetProductType as A, LiabilityProductType as L, PRODUCTS } from './catalogue';
import {
  getNsfrProductRule,
  NSFR_ASF_CATEGORIES,
  NSFR_RSF_CATEGORIES,
  nsfrAsfFactor,
  nsfrRsfFactor,
} from './nsfr';
import { regulatoryRiskWeight } from './regulatory';

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
    expect(getNsfrProductRule(L.DerivativeLiabilities)).toEqual({ asf: 'derivativeLiability', rsf: 'derivativeLiability' });
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

    expect(nsfrAsfFactor('derivativeLiability', 24)).toBe(0);
    expect(nsfrAsfFactor('otherLiabilities', 5)).toBe(0);
    expect(nsfrAsfFactor('otherLiabilities', 6)).toBe(0.5);
    expect(nsfrAsfFactor('otherLiabilities', 12)).toBe(1);
  });

  it('represents C80 row hierarchy separately from exposure maturity columns', () => {
    const centralBank = NSFR_RSF_CATEGORIES.centralBankReserve;
    expect(centralBank).toMatchObject({
      corep: 'C80 1.1.1.1',
      parent: { corep: 'C80 1.1.1', label: 'Cash, reserves and HQLA exposures to central banks' },
    });
    expect(centralBank.encumberedSixTo12m).toMatchObject({ corep: 'C80 1.1.1.2' });
    expect(centralBank.encumberedOneYearPlus).toMatchObject({ corep: 'C80 1.1.1.3' });

    const level1 = NSFR_RSF_CATEGORIES.level1Sovereign;
    expect(level1).toMatchObject({
      corep: 'C80 1.2.1.1',
      parent: { corep: 'C80 1.2.1', label: 'Level 1 assets eligible for 0% LCR haircut' },
    });
    expect(level1.encumberedSixTo12m).toMatchObject({ corep: 'C80 1.2.1.2' });
    expect(level1.encumberedOneYearPlus).toMatchObject({ corep: 'C80 1.2.1.3' });

    const mortgage = NSFR_RSF_CATEGORIES.mortgage;
    expect(mortgage).toMatchObject({
      corep: 'C80 1.4.5.1',
      parent: { corep: 'C80 1.4.5' },
      ofWhich: { corep: 'C80 1.4.5.0.1', label: 'Of which, residential mortgages' },
    });
    expect(nsfrRsfFactor('mortgage', 'under6m')).toBe(0.5);
    expect(nsfrRsfFactor('mortgage', 'sixTo12m')).toBe(0.5);
    expect(nsfrRsfFactor('mortgage', 'oneYearPlus')).toBe(0.65);
    expect(mortgage.encumberedSixTo12m).toMatchObject({ corep: 'C80 1.4.5.2' });
    expect(mortgage.encumberedSixTo12m!.factors).toMatchObject({ under6m: 0.5, sixTo12m: 0.5, oneYearPlus: 0.65 });
    expect(mortgage.encumberedOneYearPlus).toMatchObject({ corep: 'C80 1.4.5.3' });
    expect(mortgage.encumberedOneYearPlus!.factors).toMatchObject({ under6m: 1, sixTo12m: 1, oneYearPlus: 1 });

    const otherLoan = NSFR_RSF_CATEGORIES.otherLoan;
    expect(otherLoan).toMatchObject({ corep: 'C80 1.4.6.1', parent: { corep: 'C80 1.4.6' } });
    expect(otherLoan.encumberedSixTo12m).toBeUndefined();
    expect(otherLoan.encumberedOneYearPlus).toMatchObject({ corep: 'C80 1.4.6.2' });
    expect(nsfrRsfFactor('otherLoan', 'under6m')).toBe(0.5);
    expect(nsfrRsfFactor('otherLoan', 'sixTo12m')).toBe(0.5);
    expect(nsfrRsfFactor('otherLoan', 'oneYearPlus')).toBe(0.85);
  });

  it('keeps C80 1.4.5 eligibility tied to the current credit-risk assumption', () => {
    expect(regulatoryRiskWeight(A.Mortgages)).toBe(0.35);
    expect(regulatoryRiskWeight(A.ConsumerLoans)).toBeGreaterThan(0.35);
    expect(regulatoryRiskWeight(A.CorporateLoans)).toBeGreaterThan(0.35);
    expect(getNsfrProductRule(A.Mortgages).rsf).toBe('mortgage');
    expect(getNsfrProductRule(A.ConsumerLoans).rsf).toBe('otherLoan');
    expect(getNsfrProductRule(A.CorporateLoans).rsf).toBe('otherLoan');
  });

  it('records the exact standalone C80 and C81 categories alongside factors', () => {
    expect(NSFR_ASF_CATEGORIES.stableRetail).toMatchObject({ corep: 'C81 2.2.1', label: 'Stable retail deposits' });
    expect(NSFR_ASF_CATEGORIES.tier2Capital).toMatchObject({ corep: 'C81 2.1.3' });
    expect(NSFR_ASF_CATEGORIES.derivativeLiability).toMatchObject({ corep: 'C81 2.7' });
    expect(NSFR_ASF_CATEGORIES.otherLiabilities).toMatchObject({ corep: 'C81 2.9.4' });
    expect(NSFR_RSF_CATEGORIES.nonPerforming).toMatchObject({ corep: 'C80 1.9.3' });
    expect(NSFR_RSF_CATEGORIES.derivativeLiability).toMatchObject({ corep: 'C80 1.7.1', factors: { none: 0.05 } });
    expect(NSFR_RSF_CATEGORIES.derivativeAsset).toMatchObject({ corep: 'C80 1.7.2', factors: { none: 1 } });
    expect(NSFR_RSF_CATEGORIES.undrawnCommitment).toMatchObject({ corep: 'C80 1.10.2', factors: { none: 0.05 } });
  });
});
