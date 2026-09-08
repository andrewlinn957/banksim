from pathlib import Path

metrics = Path('src/engine/metrics.ts')
text = metrics.read_text()
old = """    minimumCet1Ratio: minima.cet1, minimumTier1Ratio: minima.tier1, minimumTotalCapitalRatio: minima.total,\n    tier1Requirement: Math.max(minima.tier1,minima.total) + capitalBuffers.combinedBufferRate,\n    totalCapitalRequirement: minima.total + capitalBuffers.combinedBufferRate,\n"""
new = """    minimumCet1Ratio: minima.cet1, minimumTier1Ratio: minima.tier1, minimumTotalCapitalRatio: minima.total,\n    tier1Requirement:\n      (rwa > 0\n        ? Math.max(minima.tier1, minima.total - tier2 / rwa)\n        : Math.max(minima.tier1, minima.total)) + capitalBuffers.combinedBufferRate,\n    totalCapitalRequirement: minima.total + capitalBuffers.combinedBufferRate,\n"""
if old not in text:
    raise SystemExit('metrics Tier 1 requirement anchor not found')
metrics.write_text(text.replace(old, new, 1))

dash = Path('src/components/CapitalDashboard.tsx')
text = dash.read_text()
old_import = "import { eligibleCet1, ownFundsRequirements } from '../engine/prudential';\n"
new_import = old_import + "import { eligibleTier2OwnFunds } from '../products/regulatory';\n"
if old_import not in text:
    raise SystemExit('dashboard import anchor not found')
text = text.replace(old_import, new_import, 1)
old_capital = "  const cet1 = eligibleCet1(state, config), at1 = state.financial.capital.at1, tier2 = Math.max(0, state.financial.capital.tier2 ?? 0);\n"
new_capital = "  const cet1 = eligibleCet1(state, config), at1 = state.financial.capital.at1, tier2 = eligibleTier2OwnFunds(state);\n"
if old_capital not in text:
    raise SystemExit('dashboard capital anchor not found')
text = text.replace(old_capital, new_capital, 1)
old_buffer = "  const buffer = metrics.combinedBufferRate ?? conservationBuffer + countercyclicalBuffer + osiiBuffer;\n  const substitution = rwa > 0 ? Math.max(0, minima.tier1 - at1 / rwa - minima.cet1, minima.total - (at1 + tier2) / rwa - minima.cet1) : 0;\n"
new_buffer = "  const buffer = metrics.combinedBufferRate ?? conservationBuffer + countercyclicalBuffer + osiiBuffer;\n  const effectiveTier1Minimum = rwa > 0\n    ? Math.max(minima.tier1, minima.total - tier2 / rwa)\n    : Math.max(minima.tier1, minima.total);\n  const substitution = rwa > 0 ? Math.max(0, minima.tier1 - at1 / rwa - minima.cet1, minima.total - (at1 + tier2) / rwa - minima.cet1) : 0;\n"
if old_buffer not in text:
    raise SystemExit('dashboard buffer anchor not found')
text = text.replace(old_buffer, new_buffer, 1)
old_card = "    { name: 'Tier 1', amount: cet1 + at1, minimum: minima.tier1, requirement: Math.max(minima.tier1, minima.total) + buffer },\n"
new_card = "    { name: 'Tier 1', amount: cet1 + at1, minimum: minima.tier1, requirement: effectiveTier1Minimum + buffer },\n"
if old_card not in text:
    raise SystemExit('dashboard Tier 1 card anchor not found')
text = text.replace(old_card, new_card, 1)
dash.write_text(text)

test = Path('src/engine/tier2Requirement.test.ts')
test.write_text(r'''import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { LiabilityProductType } from '../domain/enums';
import { capitalDashboardData } from '../components/CapitalDashboard';
import { eligibleTier2OwnFunds } from '../products/regulatory';
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
''')
