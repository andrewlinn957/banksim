import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { buildPlayerRunExtract } from './playerExport';

describe('shared player run export', () => {
  it('builds the existing player extract without exposing hidden seed or scenario fields', () => {
    const state = structuredClone(initialState);
    state.market.macroModel.rngSeed = 7654321;
    const config = structuredClone(baseConfig) as typeof baseConfig & { privateMarker?: string };
    config.global.initialPortfolioSeed = 1234567;
    config.privateMarker = 'PRIVATE-CONFIG-MARKER';
    (config.behaviour.ifrs9 as unknown as Record<string, unknown>).privateMarker = 'PRIVATE-ECL-CONFIG-MARKER';
    (config.behaviour.sharePriceModel as unknown as Record<string, unknown>).privateMarker = 'PRIVATE-VALUATION-CONFIG-MARKER';

    const extract = buildPlayerRunExtract({
      bankState: state,
      stateHistory: [state],
      simConfig: config,
      timeline: [],
      events: [],
    });
    const serialized = JSON.stringify(extract);

    expect(extract.format).toBe('banksim-run-extract');
    expect(extract.formatVersion).toBe(6);
    expect(extract.run.decisions).toEqual([]);
    expect(serialized).not.toContain('PRIVATE-CONFIG-MARKER');
    expect(serialized).not.toContain('PRIVATE-ECL-CONFIG-MARKER');
    expect(serialized).not.toContain('PRIVATE-VALUATION-CONFIG-MARKER');
    expect(serialized).not.toContain('7654321');
    expect(serialized).not.toContain('1234567');
    expect(serialized).not.toContain('scheduledShocks');
    expect(serialized).not.toContain('arcStages');
  });
});
