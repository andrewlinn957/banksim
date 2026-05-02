import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

describe('Concentration and large exposure risk', () => {
  it('concentrated portfolios underperform diversified portfolios in sector stress', () => {
    const concentrated = cloneBankState(initialState);
    const diversified = cloneBankState(initialState);

    const concentratedCohorts = concentrated.loanCohorts[AssetProductType.CorporateLoans] ?? [];
    concentratedCohorts.forEach((cohort) => {
      cohort.sector = 'commercialRealEstate';
      cohort.geography = 'london';
    });

    const diversifiedSectors: Array<'largeCorporate' | 'sme' | 'commercialRealEstate' | 'other'> = [
      'largeCorporate',
      'sme',
      'commercialRealEstate',
      'other',
    ];
    const diversifiedGeographies: Array<'london' | 'south' | 'midlands' | 'north'> = [
      'london',
      'south',
      'midlands',
      'north',
    ];
    const diversifiedCohorts = diversified.loanCohorts[AssetProductType.CorporateLoans] ?? [];
    diversifiedCohorts.forEach((cohort, idx) => {
      cohort.sector = diversifiedSectors[idx % diversifiedSectors.length];
      cohort.geography = diversifiedGeographies[idx % diversifiedGeographies.length];
    });

    const engine = createSimulationEngine();
    const stress = [{ type: 'macroDownturn' as const, pdMultiplier: 2.2, lgdMultiplier: 1.4 }];

    const concentratedAfter = engine.step({
      state: concentrated,
      config: baseConfig,
      actions: [],
      shocks: stress,
    }).nextState;
    const diversifiedAfter = engine.step({
      state: diversified,
      config: baseConfig,
      actions: [],
      shocks: stress,
    }).nextState;

    expect(concentratedAfter.risk.riskMetrics.sectorConcentration).toBeGreaterThan(
      diversifiedAfter.risk.riskMetrics.sectorConcentration
    );
    expect(concentratedAfter.financial.incomeStatement.creditLosses).toBeGreaterThan(
      diversifiedAfter.financial.incomeStatement.creditLosses
    );
    expect(concentratedAfter.risk.riskMetrics.cet1Ratio).toBeLessThan(
      diversifiedAfter.risk.riskMetrics.cet1Ratio
    );
  });
});
