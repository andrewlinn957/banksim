import { describe, expect, it } from 'vitest';
import { getAttributionMechanicExplanation } from './attributionExplainers';

describe('getAttributionMechanicExplanation', () => {
  it('maps known line ids to targeted mechanic sections', () => {
    const explanation = getAttributionMechanicExplanation({
      metric: 'lcr',
      metricLabel: 'LCR',
      lineId: 'lcr-outflows',
      lineLabel: 'Net cash outflows',
      effect: -0.04,
      eventIds: ['e-1'],
    });

    expect(explanation.helpSectionId).toBe('deposit-behaviour');
    expect(explanation.title).toContain('outflow');
  });

  it('maps residual lines to reconciliation mechanics', () => {
    const explanation = getAttributionMechanicExplanation({
      metric: 'cet1Ratio',
      metricLabel: 'CET1 ratio',
      lineId: 'cet1Ratio-residual',
      lineLabel: 'Cross-effects and rounding',
      effect: 0.001,
      eventIds: ['e-2'],
    });

    expect(explanation.helpSectionId).toBe('attribution-events-reconciliation');
  });

  it('falls back to generic explanation for unknown line ids', () => {
    const explanation = getAttributionMechanicExplanation({
      metric: 'nim',
      metricLabel: 'NIM',
      lineId: 'nim-unknown-driver',
      lineLabel: 'Unknown driver',
      effect: 0,
      eventIds: [],
    });

    expect(explanation.helpSectionId).toBe('attribution-events-reconciliation');
    expect(explanation.title).toBe('Unknown driver');
  });
});
