import { describe, expect, it } from 'vitest';
import { baseConfig } from '../../config/baseConfig';
import { initialState } from '../../config/initialState';
import { buildSharePriceReportData, SHARE_PRICE_SERIES_OPTIONS } from './sharePrice';

describe('share price report builder', () => {
  it('returns every selectable series and the exact driver values rendered by the UI', () => {
    const prior = structuredClone(initialState);
    prior.time.step = 0;
    const current = structuredClone(initialState);
    current.time.step = 1;
    current.equityMarket.sharePrice = 9.25;
    current.equityMarket.trailingEps = 0.37;
    const report = buildSharePriceReportData(current, [prior, current], baseConfig);

    expect(Object.keys(report.series).sort()).toEqual(SHARE_PRICE_SERIES_OPTIONS.map((option) => option.key).sort());
    expect(report.series.sharePrice.map((point) => point.value)).toEqual([prior.equityMarket.sharePrice, 9.25]);
    expect(report.drivers.trailingEps).toBe(0.37);
    expect(report.drivers.roeProxy).toBe(report.drivers.smoothedEps / report.drivers.bvps);
    expect(report.drivers.recordedEarningsMonths).toBe(current.equityMarket.trailingEarningsMonths ?? 0);
  });
});
