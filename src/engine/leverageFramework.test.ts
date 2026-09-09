import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { calculateRiskMetrics, evaluateCompliance } from './metrics';
import {
  UK_LEVERAGE_RULES,
  advanceLeverageFrameworkAssessmentAtClose,
  leverageScopeRoute,
  roundCclbRate,
} from './leverageFramework';

const retailDeposits = (state: ReturnType<typeof cloneBankState>) => {
  const current = state.financial.balanceSheet.items.find(i => i.productType === LiabilityProductType.RetailCurrentAccounts)!;
  const term = state.financial.balanceSheet.items.find(i => i.productType === LiabilityProductType.RetailTermDeposits)!;
  return { current, term };
};

const forceLeverageScope = (state: ReturnType<typeof cloneBankState>) => {
  state.risk.leverageFramework = {
    inScope: true,
    scopeRoute: 'retailDeposits',
    assessmentStep: state.time.step,
    assessmentDate: new Date(state.time.date).toISOString(),
    nextAssessmentStep: state.time.step + 12,
    averageRetailDeposits: 80e9,
    averageNonUkAssets: 0,
    accountingReferenceObservations: [-24, -12, 0].map(offset => ({
      step: state.time.step + offset,
      date: new Date(state.time.date).toISOString(),
      retailDeposits: 80e9,
      nonUkAssets: 0,
    })),
  };
};

describe('current UK leverage framework', () => {
  it('starts the model bank below scope with a 3.25% expectation rather than a hard requirement', () => {
    const state = cloneBankState(initialState);
    const metrics = calculateRiskMetrics({ state, config: baseConfig });

    expect(metrics.leverageFrameworkInScope).toBe(false);
    expect(metrics.leverageRetailDepositsThreeYearAverage).toBeCloseTo(8.5e9, 2);
    expect(metrics.leverageRetailDepositThreshold).toBe(75e9);
    expect(metrics.leverageNonUkAssetThreshold).toBe(10e9);
    expect(metrics.leverageBaseRate).toBeCloseTo(0.0325, 12);
    expect(metrics.leverageApplicableThresholdRate).toBeCloseTo(0.0325, 12);
    expect(metrics.leverageCclbRate).toBe(0);
    expect(metrics.leverageCclbIndicativeRate).toBeCloseTo(0.007, 12);
  });

  it('uses the three most recent accounting reference dates and changes scope only at explicit closes', () => {
    const state = cloneBankState(initialState);
    const original = structuredClone(state.risk.leverageFramework);
    const { current, term } = retailDeposits(state);
    current.balance = 90e9;
    term.balance = 10e9;

    calculateRiskMetrics({ state, config: baseConfig });
    calculateRiskMetrics({ state, config: baseConfig });
    expect(state.risk.leverageFramework).toEqual(original);

    for (const step of [11, 23, 35]) {
      state.time.step = step;
      advanceLeverageFrameworkAssessmentAtClose(state);
    }

    expect(state.risk.leverageFramework?.accountingReferenceObservations).toHaveLength(3);
    expect(state.risk.leverageFramework?.averageRetailDeposits).toBeCloseTo(100e9, 2);
    expect(state.risk.leverageFramework?.inScope).toBe(true);
    expect(state.risk.leverageFramework?.scopeRoute).toBe('retailDeposits');
  });

  it('supports either scope route and applies current CCLB rounding', () => {
    expect(leverageScopeRoute(75e9, 0)).toBe('retailDeposits');
    expect(leverageScopeRoute(0, 10e9)).toBe('nonUkAssets');
    expect(leverageScopeRoute(75e9, 10e9)).toBe('both');
    expect(roundCclbRate(0.02)).toBeCloseTo(0.007, 12);
    expect(roundCclbRate(0.015)).toBeCloseTo(0.005, 12);
  });

  it('applies CCLB and ALRB only once the bank is in scope', () => {
    const state = cloneBankState(initialState);
    forceLeverageScope(state);
    state.risk.osii = {
      ...state.risk.osii!,
      assessedRate: 0.01,
      inScopeAtAssessment: true,
    };
    const metrics = calculateRiskMetrics({ state, config: baseConfig });

    expect(metrics.leverageCclbRate).toBeCloseTo(0.007, 12);
    expect(metrics.leverageAlrbRate).toBeCloseTo(0.0035, 12);
    expect(metrics.leverageApplicableThresholdRate).toBeCloseTo(0.043, 12);
    expect(metrics.leverageCet1ThresholdRate).toBeCloseTo(0.024375 + 0.007 + 0.0035, 12);
  });

  it('treats a below-scope miss as an expectation miss, not a leverage requirement breach', () => {
    const state = cloneBankState(initialState);
    state.financial.capital.cet1 = 0.2e9;
    state.financial.capital.accumulatedOCI = 0;
    state.financial.capital.at1 = 0.1e9;
    const metrics = calculateRiskMetrics({ state, config: baseConfig });
    const compliance = evaluateCompliance(metrics, baseConfig.riskLimits);

    expect(metrics.leverageRatio).toBeLessThan(UK_LEVERAGE_RULES.baseRate);
    expect(compliance.leverageExpectationMissed).toBe(true);
    expect(compliance.leverageBreached).toBe(false);
  });

  it('requires CET1 to cover 75% of the binding leverage minimum', () => {
    const state = cloneBankState(initialState);
    forceLeverageScope(state);
    state.financial.capital.cet1 = 0.2e9;
    state.financial.capital.accumulatedOCI = 0;
    state.financial.capital.at1 = 0.7e9;
    const metrics = calculateRiskMetrics({ state, config: baseConfig });
    const compliance = evaluateCompliance(metrics, baseConfig.riskLimits);

    expect(metrics.leverageRatio).toBeGreaterThan(UK_LEVERAGE_RULES.baseRate);
    expect(metrics.leverageCet1Ratio).toBeLessThan(UK_LEVERAGE_RULES.baseRate * UK_LEVERAGE_RULES.minimumCet1Share);
    expect(compliance.leverageBreached).toBe(true);
  });

  it('makes the 3.25% minimum binding in scope and keeps leverage-buffer shortfall separate from MDA', () => {
    const hardBreach = cloneBankState(initialState);
    forceLeverageScope(hardBreach);
    hardBreach.financial.capital.cet1 = 0.2e9;
    hardBreach.financial.capital.accumulatedOCI = 0;
    hardBreach.financial.capital.at1 = 0.1e9;
    const hardMetrics = calculateRiskMetrics({ state: hardBreach, config: baseConfig });
    expect(evaluateCompliance(hardMetrics, baseConfig.riskLimits).leverageBreached).toBe(true);

    const bufferCase = cloneBankState(initialState);
    forceLeverageScope(bufferCase);
    const gilts = bufferCase.financial.balanceSheet.items.find(i => i.productType === AssetProductType.Gilts)!;
    gilts.balance += 15e9;
    const metrics = calculateRiskMetrics({ state: bufferCase, config: baseConfig });
    const compliance = evaluateCompliance(metrics, baseConfig.riskLimits);

    expect(metrics.leverageRatio).toBeGreaterThan(UK_LEVERAGE_RULES.baseRate);
    expect(metrics.leverageRatio).toBeLessThan(metrics.leverageApplicableThresholdRate!);
    expect(compliance.leverageBreached).toBe(false);
    expect(compliance.leverageBufferShortfall).toBe(true);
    expect(compliance.mdaTriggered).toBe(false);
  });
});
