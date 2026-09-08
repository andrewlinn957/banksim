import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { LiabilityProductType, MaturityBucket } from '../domain/enums';
import { capitalDashboardData } from '../components/CapitalDashboard';
import { eligibleTier2OwnFunds } from '../products/regulatory';
import { createPosition } from '../products/factory';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const quietConfig = {
  ...baseConfig,
  featureFlags: {
    ...baseConfig.featureFlags,
    depositSegmentation: false,
    loanPipeline: false,
    conductRisk: false,
    irrbbHedges: false,
    securitiesAccounting: false,
    capitalPolicy: false,
  },
};

const expectedTier1Requirement = (state: typeof initialState): number => {
  const metrics = state.risk.riskMetrics;
  const rwa = metrics.rwa;
  const minimumTier1 = metrics.minimumTier1Ratio ?? quietConfig.riskLimits.minTier1Ratio;
  const minimumTotal = metrics.minimumTotalCapitalRatio ?? quietConfig.riskLimits.minTotalCapitalRatio;
  const buffer = metrics.combinedBufferRate ?? 0;
  const eligibleTier2 = eligibleTier2OwnFunds(state);
  const effectiveMinimum = rwa > 0
    ? Math.max(minimumTier1, minimumTotal - eligibleTier2 / rwa)
    : Math.max(minimumTier1, minimumTotal);
  return effectiveMinimum + buffer;
};

const dashboardTier1Requirement = (state: typeof initialState): number => {
  const card = capitalDashboardData(state, quietConfig).cards.find((entry) => entry.name === 'Tier 1');
  if (!card) throw new Error('Missing Tier 1 dashboard card');
  return card.requirement;
};

describe('Tier 2 substitution in effective Tier 1 requirement', () => {
  it('reduces the effective Tier 1 requirement after Tier 2 issuance and keeps dashboard aligned', () => {
    const engine = createSimulationEngine();
    const amount = 500e6;

    const result = engine.step({
      state: cloneBankState(initialState),
      config: quietConfig,
      actions: [{ type: 'issueTier2', amount, maturityMonths: 60 }],
      shocks: [],
    }).nextState;

    const metrics = result.risk.riskMetrics;
    const eligibleTier2 = eligibleTier2OwnFunds(result);
    const oldWrongRequirement = Math.max(
      metrics.minimumTier1Ratio ?? quietConfig.riskLimits.minTier1Ratio,
      metrics.minimumTotalCapitalRatio ?? quietConfig.riskLimits.minTotalCapitalRatio
    ) + (metrics.combinedBufferRate ?? 0);

    expect(eligibleTier2).toBeCloseTo(amount, 2);
    expect(metrics.tier1Requirement).toBeCloseTo(expectedTier1Requirement(result), 12);
    expect(metrics.tier1Requirement ?? Infinity).toBeLessThan(oldWrongRequirement);
    expect(dashboardTier1Requirement(result)).toBeCloseTo(metrics.tier1Requirement ?? NaN, 12);
  });

  it('caps recorded Tier 2 at zero when a classified line exists but is empty', () => {
    const s = cloneBankState(initialState);
    s.financial.capital.tier2 = 100;
    const line = createPosition(baseConfig, {
      productType: LiabilityProductType.Tier2Debt,
      balance: 1,
      interestRate: 0.05,
      maturityBucket: MaturityBucket.GreaterThan5Y,
    });
    s.financial.balanceSheet.items.push(line);
    expect(eligibleTier2OwnFunds(s)).toBe(1);

    line.balance = 0;
    expect(eligibleTier2OwnFunds(s)).toBe(0);

    s.financial.balanceSheet.items = s.financial.balanceSheet.items.filter(
      (item) => item.productType !== LiabilityProductType.Tier2Debt
    );
    expect(eligibleTier2OwnFunds(s)).toBe(100);
  });

  it('restores the Tier 1 requirement when Tier 2 matures and keeps dashboard aligned', () => {
    const engine = createSimulationEngine();
    const issued = engine.step({
      state: cloneBankState(initialState),
      config: quietConfig,
      actions: [{ type: 'issueTier2', amount: 500e6, maturityMonths: 60 }],
      shocks: [],
    }).nextState;

    const maturing = cloneBankState(issued);
    const buckets = maturing.fundingLadders[LiabilityProductType.Tier2Debt] ?? [];
    expect(buckets.length).toBeGreaterThan(0);
    buckets.forEach((bucket) => { bucket.monthsToMaturity = 1; });

    const matured = engine.step({
      state: maturing,
      config: quietConfig,
      actions: [],
      shocks: [],
    }).nextState;

    expect(eligibleTier2OwnFunds(matured)).toBeCloseTo(0, 2);
    expect(matured.risk.riskMetrics.tier1Requirement).toBeCloseTo(expectedTier1Requirement(matured), 12);
    expect(matured.risk.riskMetrics.tier1Requirement ?? -Infinity)
      .toBeGreaterThan(issued.risk.riskMetrics.tier1Requirement ?? Infinity);
    expect(dashboardTier1Requirement(matured)).toBeCloseTo(matured.risk.riskMetrics.tier1Requirement ?? NaN, 12);
  });
});
