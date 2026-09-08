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

    expect(entries.length).toBeGreaterThanOrEqual(18);
    expect(new Set(ids).size).toBe(ids.length);

    entries.forEach((entry) => {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.plainDescription.trim().length).toBeGreaterThan(0);
      expect(entry.whyItMatters.trim().length).toBeGreaterThan(0);
      expect(entry.driverSummary.length).toBeGreaterThan(0);
    });
  });

  it('injects current thresholds in the same percentage format as the game', () => {
    const context = buildMechanicsDynamicContext({ config: baseConfig, state: initialState });
    const entries = buildMechanicsRegistry(context);

    const liquidity = entries.find((entry) => entry.id === 'liquidity-ratios');
    expect(liquidity?.thresholds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Minimum LCR', value: context.formatted.minLcr }),
        expect.objectContaining({ label: 'Minimum NSFR', value: context.formatted.minNsfr }),
        expect.objectContaining({ label: 'Current LCR', value: context.formatted.currentLcr }),
        expect.objectContaining({ label: 'Current NSFR', value: context.formatted.currentNsfr }),
      ])
    );

    const capital = entries.find((entry) => entry.id === 'risk-metrics-and-compliance');
    expect(capital?.thresholds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Minimum CET1 ratio', value: context.formatted.minCet1Ratio }),
        expect.objectContaining({ label: 'Minimum leverage ratio', value: context.formatted.minLeverageRatio }),
        expect.objectContaining({
          label: 'Combined CET1 requirement',
          value: context.formatted.combinedCet1Requirement,
        }),
      ])
    );
  });

  it('covers every control added for the small UK retail-bank model', () => {
    const context = buildMechanicsDynamicContext({ config: baseConfig, state: initialState });
    const entries = buildMechanicsRegistry(context);
    const ids = new Set(entries.map((entry) => entry.id));

    [
      'deposit-behaviour',
      'term-savings',
      'loan-pipeline',
      'mortgage-structure',
      'loan-cohorts-and-ifrs9',
      'treasury-liquidity-portfolio',
      'funding-ladder-and-rollover',
      'boe-secured-funding',
      'irrbb-and-swaps',
      'capital-policy-and-distributions',
      'tier2-and-equity',
      'risk-metrics-and-compliance',
      'liquidity-ratios',
      'confidence-state-machine',
    ].forEach((id) => expect(ids.has(id)).toBe(true));
  });

  it('keeps anchors that other tabs use for contextual help', () => {
    const context = buildMechanicsDynamicContext({ config: baseConfig, state: initialState });
    const ids = new Set(buildMechanicsRegistry(context).map((entry) => entry.id));

    [
      'core-monthly-loop',
      'actions-pricing-and-underwriting',
      'autopilot-and-run-history',
      'deposit-behaviour',
      'loan-pipeline',
      'loan-cohorts-and-ifrs9',
      'funding-ladder-and-rollover',
      'capital-policy-and-distributions',
      'risk-metrics-and-compliance',
      'liquidity-ratios',
      'confidence-state-machine',
      'conduct-risk',
      'market-and-curve-engine',
      'scenario-system',
      'board-pressure',
      'share-price-model',
      'preview-and-recommendations',
      'attribution-events-reconciliation',
    ].forEach((id) => expect(ids.has(id)).toBe(true));
  });

  it('does not describe obsolete default-bank mechanics', () => {
    const context = buildMechanicsDynamicContext({ config: baseConfig, state: initialState });
    const text = JSON.stringify(buildMechanicsRegistry(context));
    expect(text).not.toContain('Wholesale ST/LT funding');
    expect(text).not.toContain('Select a department on the bank screen for standing policies, one-off orders and a next-close estimate.');
    expect(text).not.toContain('generic repo');
  });
});
