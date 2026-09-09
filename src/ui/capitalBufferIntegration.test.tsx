import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CapitalDashboard, { capitalDashboardData } from '../components/CapitalDashboard';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { advanceOsiiAssessmentAtClose } from '../engine/capitalBuffers';
import { cloneBankState } from '../engine/clone';
import { calculateRiskMetrics } from '../engine/metrics';
import { formatPct } from '../utils/formatters';

it('applies an O-SII increase consistently to requirements, payout restrictions and the capital dashboard', () => {
  const state = cloneBankState(initialState);
  const retail = state.financial.balanceSheet.items.find((i) => i.productType === LiabilityProductType.RetailCurrentAccounts)!;
  const mortgages = state.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)!;
  retail.balance = 40e9;
  mortgages.balance = 230e9;
  state.time.step = 11;
  state.time.date = new Date('2026-11-30T00:00:00Z');
  state.risk.osii = {
    assessedRate: 0,
    assessmentStep: 0,
    nextAssessmentStep: 12,
    effectiveYear: 2026,
    averageQuarterEndUkLeverageExposure: 0,
    inScopeAtAssessment: false,
    scopeRouteAtAssessment: 'belowCoreDepositThreshold',
    quarterEndObservations: [3, 6, 9].map((step) => ({
      step,
      date: `2026-${String(step).padStart(2, '0')}-01T00:00:00.000Z`,
      ukLeverageExposure: 230e9,
    })),
  };

  let before = calculateRiskMetrics({ state, config: baseConfig });
  state.financial.capital.accumulatedOCI = 0;
  state.financial.capital.cet1 = (before.cet1Requirement + 0.005) * before.rwa;
  before = calculateRiskMetrics({ state, config: baseConfig });
  state.risk.riskMetrics = before;

  expect(before.osiiBufferRate).toBe(0);
  expect(before.mdaTriggered).toBe(false);
  expect(before.maxPayoutRatio).toBeGreaterThan(0);
  const beforeDashboard = capitalDashboardData(state, baseConfig);
  expect(beforeDashboard.cards[0].requirement).toBeCloseTo(before.cet1Requirement, 12);

  advanceOsiiAssessmentAtClose(state, baseConfig);
  const after = calculateRiskMetrics({ state, config: baseConfig });
  state.risk.riskMetrics = after;

  expect(after.osiiBufferRate).toBeCloseTo(0.01);
  expect(after.combinedBufferRate).toBeCloseTo((before.combinedBufferRate ?? 0) + 0.01);
  expect(after.cet1Requirement).toBeCloseTo(before.cet1Requirement + 0.01, 12);
  expect(after.tier1Requirement).toBeCloseTo((before.tier1Requirement ?? 0) + 0.01, 12);
  expect(after.totalCapitalRequirement).toBeCloseTo((before.totalCapitalRequirement ?? 0) + 0.01, 12);
  expect(after.mdaTriggered).toBe(true);
  expect(after.maxPayoutRatio).toBe(0);

  const dashboard = capitalDashboardData(state, baseConfig);
  expect(dashboard.cards[0].requirement).toBeCloseTo(after.cet1Requirement, 12);
  expect(dashboard.cards[1].requirement).toBeCloseTo(after.tier1Requirement ?? NaN, 12);
  expect(dashboard.cards[2].requirement).toBeCloseTo(after.totalCapitalRequirement ?? NaN, 12);

  const html = renderToStaticMarkup(<CapitalDashboard state={state} config={baseConfig} />);
  expect(html).toContain(`O-SII buffer</th><td>${formatPct(after.osiiBufferRate ?? 0)}`);
  expect(html).toContain(`Bank policy payout cap: ${formatPct(after.maxPayoutRatio)}`);
  expect(html).toContain(`requirement ${formatPct(after.cet1Requirement)}`);
});
