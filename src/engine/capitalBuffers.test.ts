import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import {
  calculateCapitalBufferFramework,
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
  });

  it('growth above the domestic scope and UK LEM thresholds produces an O-SII buffer at an assessment', () => {
    const s = makeLargeDomesticBank();
    const opening = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(opening.osiiInScope).toBe(true);
    expect(opening.osiiScopeRoute).toBe('largeDomesticBank');
    expect(opening.osiiRate).toBeCloseTo(0.01);
    expect(s.risk.osii?.effectiveYear).toBe(2026);
  });

  it('freezes O-SII between annual reviews and resets from the trailing quarter-end average', () => {
    const s = cloneBankState(initialState);
    s.risk.osii = undefined;
    const first = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(first.osiiRate).toBe(0);

    const retail = s.financial.balanceSheet.items.find((i) => i.productType === LiabilityProductType.RetailCurrentAccounts)!;
    const mortgages = s.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)!;
    retail.balance = 40e9;
    mortgages.balance = 230e9;

    for (const step of [2, 5, 8]) {
      s.time.step = step;
      const mid = calculateCapitalBufferFramework({ state: s, config: baseConfig });
      expect(mid.osiiRate).toBe(0);
    }

    s.time.step = 11;
    const reviewed = calculateCapitalBufferFramework({ state: s, config: baseConfig });
    expect(reviewed.osiiRate).toBeGreaterThan(0);
    expect(s.risk.osii?.assessmentStep).toBe(12);
    expect(s.risk.osii?.nextAssessmentStep).toBe(24);
    expect(s.risk.osii?.quarterEndObservations.map((x) => x.step)).toEqual([3, 6, 9, 12]);
  });
});
