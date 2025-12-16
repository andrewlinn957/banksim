import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { describe, expect, it } from 'vitest';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';
import { advanceUkMarketState, fitNelsonSiegelFrom3Points, nelsonSiegelYield } from './ukMarketModel';

describe('UK market model', () => {
  it('advances macro variables and keeps curve coherent', () => {
    const state = cloneBankState(initialState);
    advanceUkMarketState(state.market, 1);

    expect(state.market.baseRate).toBeGreaterThanOrEqual(0);
    expect(state.market.baseRate).toBeLessThanOrEqual(0.12);
    expect(Number.isFinite(state.market.gdpGrowthMoM)).toBe(true);
    expect(Number.isFinite(state.market.inflationRate)).toBe(true);

    expect(state.market.unemploymentRate).toBeGreaterThanOrEqual(0.02);
    expect(state.market.unemploymentRate).toBeLessThanOrEqual(0.12);

    expect(state.market.riskFreeShort).toBe(state.market.giltCurve.yields.y1);
    expect(state.market.riskFreeLong).toBe(state.market.giltCurve.yields.y30);

    const ns = state.market.giltCurve.nelsonSiegel;
    expect(state.market.giltCurve.yields.y10).toBeCloseTo(nelsonSiegelYield(ns, 10), 12);
  });

  it('marketSpreadShock widens credit spread vs baseline', () => {
    const engine = createSimulationEngine();

    const baselineNext = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      actions: [],
      shocks: [],
    }).nextState;

    const shockedNext = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      actions: [],
      shocks: [
        {
          type: 'marketSpreadShock',
          wholesaleSpreadBps: 300,
          loanSpreadBps: 0,
          repoHaircutIncreasePct: 0,
        },
      ],
    }).nextState;

    expect(shockedNext.market.creditSpread).toBeGreaterThan(baselineNext.market.creditSpread);
  });

  it('keeps key variables in bounds over long horizon', () => {
    const state = cloneBankState(initialState);
    for (let i = 0; i < 240; i++) {
      advanceUkMarketState(state.market, 1);
      expect(state.market.unemploymentRate).toBeGreaterThanOrEqual(0.02);
      expect(state.market.unemploymentRate).toBeLessThanOrEqual(0.12);
      expect(state.market.creditSpread).toBeGreaterThanOrEqual(0);
      expect(state.market.creditSpread).toBeLessThanOrEqual(0.05);
      expect(Number.isFinite(state.market.giltCurve.yields.y30)).toBe(true);
    }
  });

  it('Nelson–Siegel fit reuses fallback factors when system is singular', () => {
    const fallback = { level: 0.05, slope: -0.01, curvature: 0.002 };
    const fitted = fitNelsonSiegelFrom3Points(
      0.7,
      [
        { mYears: 1, y: 0.03 },
        { mYears: 1, y: 0.04 },
        { mYears: 1, y: 0.05 },
      ],
      fallback
    );
    expect(fitted).toEqual(fallback);
  });

  it('Nelson–Siegel fit falls back to a flat (non-zero) level when no fallback is provided', () => {
    const fitted = fitNelsonSiegelFrom3Points(0.7, [
      { mYears: 1, y: 0.03 },
      { mYears: 1, y: 0.04 },
      { mYears: 1, y: 0.05 },
    ]);
    expect(fitted.level).toBeCloseTo(0.04, 12);
    expect(fitted.slope).toBe(0);
    expect(fitted.curvature).toBe(0);
  });
});
