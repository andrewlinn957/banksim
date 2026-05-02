import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { buildMechanicsDynamicContext } from './mechanicsContext';
import { buildMechanicsRegistry } from './mechanicsRegistry';

describe('buildMechanicsRegistry', () => {
  it('returns a comprehensive, uniquely keyed registry', () => {
    const context = buildMechanicsDynamicContext({ config: baseConfig, state: initialState });
    const entries = buildMechanicsRegistry(context);
    const ids = entries.map((entry) => entry.id);

    expect(entries.length).toBeGreaterThanOrEqual(10);
    expect(new Set(ids).size).toBe(ids.length);

    entries.forEach((entry) => {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.plainDescription.trim().length).toBeGreaterThan(0);
      expect(entry.whyItMatters.trim().length).toBeGreaterThan(0);
      expect(entry.driverSummary.length).toBeGreaterThan(0);
    });
  });

  it('injects dynamic threshold values from active config/state context', () => {
    const context = buildMechanicsDynamicContext({ config: baseConfig, state: initialState });
    const entries = buildMechanicsRegistry(context);

    const liquidity = entries.find((entry) => entry.id === 'liquidity-ratios');
    expect(liquidity).toBeDefined();
    expect(liquidity?.thresholds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Min LCR', value: context.formatted.minLcr }),
        expect.objectContaining({ label: 'Min NSFR', value: context.formatted.minNsfr }),
        expect.objectContaining({ label: 'Current LCR', value: context.formatted.currentLcr }),
        expect.objectContaining({ label: 'Current NSFR', value: context.formatted.currentNsfr }),
      ])
    );

    const capital = entries.find((entry) => entry.id === 'risk-metrics-and-compliance');
    expect(capital).toBeDefined();
    expect(capital?.thresholds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Min CET1 ratio', value: context.formatted.minCet1Ratio }),
        expect.objectContaining({ label: 'Min leverage ratio', value: context.formatted.minLeverageRatio }),
        expect.objectContaining({
          label: 'Combined CET1 requirement (MDA line)',
          value: context.formatted.combinedCet1Requirement,
        }),
      ])
    );
  });

  it('contains anchors referenced by contextual help controls', () => {
    const context = buildMechanicsDynamicContext({ config: baseConfig, state: initialState });
    const entries = buildMechanicsRegistry(context);
    const ids = new Set(entries.map((entry) => entry.id));

    [
      'actions-pricing-and-underwriting',
      'deposit-behaviour',
      'loan-pipeline',
      'loan-cohorts-and-ifrs9',
      'funding-ladder-and-rollover',
      'capital-policy-and-distributions',
      'risk-metrics-and-compliance',
      'liquidity-ratios',
      'confidence-state-machine',
      'attribution-events-reconciliation',
      'board-pressure',
    ].forEach((id) => {
      expect(ids.has(id)).toBe(true);
    });
  });
});
