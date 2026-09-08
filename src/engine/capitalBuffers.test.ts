import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import {
  advanceOsiiAssessmentAtClose,
  calculateCapitalBufferFramework,
  initializeOpeningOsiiAssessment,
  osiiRateForAverageLem,
  osiiThresholdsForYear,
} from './capitalBuffers';

const makeLargeDomesticBank = () => {
  const s = cloneBankState(initialState);
  const retail = s.financial.balanceSheet.items.find((i) => i.productType === LiabilityProductType.RetailCurrentAccounts)!;
  retail.balance = 40e9;
  const mortgages = s.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)!;
  mortgages.balance = 220e9;
  s.risk.osii = undefined;
  return s;
};

describe('UK capital buffer framework', () => {
  it('uses the published O-SII threshold schedules', () => {
    expect(osiiThresholdsForYear(2026).buckets.map((x) => x.lowerBound / 1e9)).toEqual([190, 365, 540, 715, 890]);
    expect(osiiThresholdsForYear(2027).buckets.map((x) => x.lowerBound / 1e9)).toEqual([205, 390, 575, 760, 945]);
    expect(osiiRateForAverageLem(189e9, 2026)).toBe(0);
    expect(osiiRateForAverageLem(190e9, 2026)).toBeCloseTo(0.01);
    expect(osiiRateForAverageLem(575e9, 2027)).toBeCloseTo(0.02);
    expect(osiiRateForAverageLem(1e12, 2027)).toBeCloseTo(0.03);
  });

  it('starts the domestic sandbox with a 2.5% CCoB, 2% institution-specific CCyB and no O-SII buffer', () => {
    const s = cloneBankState(initialState);
    s.risk.osii = undefined;
    const b = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(b.conservationRate).toBeCloseTo(0.025);
    expect(b.ukCcybRate).toBeCloseTo(0.02);
    expect(b.ukRelevantCreditRwaShare).toBeCloseTo(1);
    expect(b.ccybRate).toBeCloseTo(0.02);
    expect(b.osiiRate).toBe(0);
    expect(b.combinedBufferRate).toBeCloseTo(0.045);
    expect(b.osiiInScope).toBe(false);
    expect(s.risk.osii).toBeUndefined();
  });

  it('growth above the domestic scope and UK LEM thresholds produces an O-SII buffer at opening assessment', () => {
    const s = makeLargeDomesticBank();
    initializeOpeningOsiiAssessment(s, baseConfig);
    const opening = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(opening.osiiInScope).toBe(true);
    expect(opening.osiiScopeRoute).toBe('largeDomesticBank');
    expect(opening.osiiRate).toBeCloseTo(0.01);
    expect(s.risk.osii?.effectiveYear).toBe(2026);
  });

  it('only mutates quarter-end history and the frozen O-SII rate at explicit closes', () => {
    const s = cloneBankState(initialState);
    s.risk.osii = undefined;
    initializeOpeningOsiiAssessment(s, baseConfig);
    expect(calculateCapitalBufferFramework({ state: s, config: baseConfig }).osiiRate).toBe(0);

    const retail = s.financial.balanceSheet.items.find((i) => i.productType === LiabilityProductType.RetailCurrentAccounts)!;
    const mortgages = s.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)!;
    retail.balance = 40e9;
    mortgages.balance = 230e9;

    for (const step of [2, 5, 8]) {
      s.time.step = step;
      const beforeRefresh = structuredClone(s.risk.osii!);
      const refreshed = calculateCapitalBufferFramework({ state: s, config: baseConfig });
      expect(refreshed.osiiRate).toBe(0);
      expect(s.risk.osii).toEqual(beforeRefresh);
      advanceOsiiAssessmentAtClose(s, baseConfig);
    }

    s.time.step = 11;
    const preClose = structuredClone(s.risk.osii!);
    const refresh = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(refresh.osiiRate).toBe(0);
    expect(s.risk.osii).toEqual(preClose);

    advanceOsiiAssessmentAtClose(s, baseConfig);
    const reviewed = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(reviewed.osiiRate).toBeGreaterThan(0);
    expect(s.risk.osii?.assessmentStep).toBe(12);
    expect(s.risk.osii?.nextAssessmentStep).toBe(24);
    expect(s.risk.osii?.quarterEndObservations.map((x) => x.step)).toEqual([3, 6, 9, 12]);
  });
});
