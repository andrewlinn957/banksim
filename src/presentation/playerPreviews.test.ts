import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import type { BankState } from '../domain/bankState';
import { buildDepartmentPreview } from './playerPreviews';
import { buildCapitalMarketsPlanImpactText } from './quotes';

describe('GUI-equivalent player preview projection', () => {
  it('returns only the displayed department forecast and omits hidden state fields', () => {
    const current = initialState;
    const next = {
      ...initialState,
      financial: {
        ...initialState.financial,
        incomeStatement: {
          ...initialState.financial.incomeStatement,
          netInterestIncome: 12_345_678,
        },
      },
      privateFutureShockMarker: 'PRIVATE-FUTURE-SHOCK-3819',
    } as BankState & { privateFutureShockMarker: string };

    const result = buildDepartmentPreview('Customers', current, next, 0, false, false);
    const serialized = JSON.stringify(result);

    expect(result.commercialImpact.map((item) => item.label)).toEqual(['Customer deposits', 'Net interest income']);
    expect(result.commercialImpact[1].after).toBe('£12.3m');
    expect(result.ratios.map((item) => item.label)).toEqual(['CET1', 'Leverage', 'LCR', 'NSFR']);
    expect(serialized).not.toContain('PRIVATE-FUTURE-SHOCK-3819');
    expect(Object.keys(result)).toEqual(['projectedBreach', 'ratios', 'impactHeading', 'commercialImpact']);
  });

  it('matches the capital forecast fields shown for an enabled Three-Year Plan issue', () => {
    const next = {
      ...initialState,
      equityMarket: { ...initialState.equityMarket, epsTtm: 0.42 },
    };
    const result = buildDepartmentPreview('Capital', initialState, next, 0, true, true);

    expect(result.capitalMarketsPlanImpactText).toBe(buildCapitalMarketsPlanImpactText({
      cet1Before: initialState.risk.riskMetrics.cet1Ratio,
      cet1After: next.risk.riskMetrics.cet1Ratio,
      epsBefore: initialState.equityMarket.epsTtm,
      epsAfter: 0.42,
    }));
    expect(JSON.stringify(result)).not.toContain(String(initialState.risk.riskMetrics.cet1Ratio));
  });
});
