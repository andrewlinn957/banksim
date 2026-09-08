import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { calculateRiskMetrics } from './metrics';
import {
  advancePillar2AAssessmentAtClose,
  applyPs1520Offset,
  calculatePillar2AConcentration,
  concentrationAddOnRate,
  pillar2ACreditBenchmarkRiskWeight,
} from './pillar2A';

describe('24-month Pillar 2A SREP assessment', () => {
  it('implements the published PRA concentration HHI bucket midpoints', () => {
    expect(concentrationAddOnRate('singleName', 0.002)).toBeCloseTo(0.0025);
    expect(concentrationAddOnRate('singleName', 0.01)).toBeCloseTo(0.015);
    expect(concentrationAddOnRate('sector', 0.10)).toBe(0);
    expect(concentrationAddOnRate('sector', 0.30)).toBeCloseTo(0.0075);
    expect(concentrationAddOnRate('sector', 0.80, 'commercialRealEstate')).toBeCloseTo(0.0215);
    expect(concentrationAddOnRate('geographic', 0.20)).toBeCloseTo(0.001);
    expect(concentrationAddOnRate('geographic', 1)).toBeCloseTo(0.01325);
  });

  it('uses the PRA Table A2 benchmark for the modelled SA credit portfolios', () => {
    const mortgage = initialState.loanCohorts[AssetProductType.Mortgages]![0];
    const consumer = initialState.loanCohorts[AssetProductType.ConsumerLoans]![0];
    const corporate = initialState.loanCohorts[AssetProductType.CorporateLoans]![0];
    expect(pillar2ACreditBenchmarkRiskWeight(AssetProductType.Mortgages, { ...mortgage, ltv: 0.85 }, initialState)).toBeCloseTo(0.187);
    expect(pillar2ACreditBenchmarkRiskWeight(AssetProductType.ConsumerLoans, consumer, initialState)).toBeCloseTo(0.775);
    expect(pillar2ACreditBenchmarkRiskWeight(AssetProductType.CorporateLoans, { ...corporate, sector: 'sme' }, initialState)).toBeCloseTo(0.598);
    expect(pillar2ACreditBenchmarkRiskWeight(AssetProductType.CorporateLoans, { ...corporate, sector: 'largeCorporate' }, initialState)).toBeCloseTo(0.463);
  });

  it('applies the PS15/20 initial reduction and additional 1% floor mechanics', () => {
    const common = { ukPassThroughRate: 1, lowRiskEligible: true, mrelEqualsTcr: true };
    expect(applyPs1520Offset({ grossRate: 0.031, ...common }).finalRate).toBeCloseTo(0.021);
    expect(applyPs1520Offset({ grossRate: 0.019, ...common }).finalRate).toBeCloseTo(0.010);
    expect(applyPs1520Offset({ grossRate: 0.011, ...common }).finalRate).toBeCloseTo(0.006);
    const ineligible = applyPs1520Offset({ grossRate: 0.031, ukPassThroughRate: 1, lowRiskEligible: false, mrelEqualsTcr: true });
    expect(ineligible.initialOffsetRate).toBeCloseTo(0.005);
    expect(ineligible.additionalOffsetRate).toBe(0);
    expect(ineligible.finalRate).toBeCloseTo(0.026);
  });

  it('uses RWA-weighted wholesale and non-mortgage geographic concentration', () => {
    const s = cloneBankState(initialState);
    const result = calculatePillar2AConcentration(s, baseConfig);
    expect(result.wholesaleRwa).toBeGreaterThan(0);
    expect(result.sectorHhi).toBeGreaterThan(0);
    expect(result.geographicHhi).toBeCloseTo(1, 10);
    expect(result.geographicRate).toBeCloseTo(0.01325);
  });

  it('does not advance a due SREP during an ordinary metric refresh; month close advances it explicitly', () => {
    const s = cloneBankState(initialState);
    const opening = structuredClone(s.risk.pillar2A!);
    const openingRate = s.risk.riskMetrics.pillar2ARate!;
    expect(opening.assessmentStep).toBe(0);
    expect(opening.nextAssessmentStep).toBe(24);

    s.behaviour.riskAppetite = { cet1: 0.2, leverage: 0.05, lcr: 1.2, nsfr: 1.1, irrbbEveLimit: 2e9 };
    s.time.step = 23;
    const refreshed = calculateRiskMetrics({ state: s, config: baseConfig });

    expect(s.risk.pillar2A).toEqual(opening);
    expect(refreshed.pillar2ARate).toBeCloseTo(openingRate, 12);

    advancePillar2AAssessmentAtClose({
      state: s,
      config: baseConfig,
      rwa: refreshed.rwa,
      eveSensitivity100bp: refreshed.eveSensitivity100bp,
    });
    const afterClose = calculateRiskMetrics({ state: s, config: baseConfig });
    expect(s.risk.pillar2A!.assessmentStep).toBe(24);
    expect(s.risk.pillar2A!.nextAssessmentStep).toBe(48);
    expect(afterClose.pillar2ARate).toBeGreaterThan(openingRate);
  });

  it('holds the assessed rate but lets the nominal requirement scale with live RWA', () => {
    const s = cloneBankState(initialState);
    const rate = s.risk.riskMetrics.pillar2ARate!;
    const before = s.risk.riskMetrics.pillar2AAmount!;
    expect(before).toBeCloseTo(rate * s.risk.riskMetrics.rwa, 4);

    const corporate = s.financial.balanceSheet.items.find(i => i.productType === AssetProductType.CorporateLoans)!;
    corporate.balance += 100e6;
    s.time.step = 3;
    const after = calculateRiskMetrics({ state: s, config: baseConfig });
    expect(after.pillar2ARate).toBeCloseTo(rate, 12);
    expect(after.pillar2AAmount).toBeCloseTo(rate * after.rwa, 4);
    expect(after.pillar2AAmount).not.toBe(before);
  });
});
