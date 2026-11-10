import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ThreeYearPlanPanel from '../components/ThreeYearPlanPanel';
import { createDefaultThreeYearPlan } from '../config/threeYearPlan';
import { prepareScenarioSession } from './scenarioSession';
import { createPlayerSessionState } from './playerSession';
import { SimulationController } from './simulationController';
import { playerReportAvailability, buildPlayerReport } from './playerReports';
import { buildThreeYearPlanPresentation } from '../presentation/reports/threeYearPlan';
import { evaluateThreeYearPlan } from '../engine/threeYearPlan';
import { bankThreeYearPlanMetricRegistry } from '../engine/threeYearPlanMetrics';

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#x27;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const displayedStrings = (value: unknown, key?: string): string[] => {
  if (typeof value === 'string') return key === 'id' ? [] : [value];
  if (Array.isArray(value)) return value.flatMap((item) => displayedStrings(item));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([childKey, item]) => displayedStrings(item, childKey));
  return [];
};

describe('Three-Year Plan Boardroom and player report parity', () => {
  it('makes the conditional report unavailable when the mode is not assigned', () => {
    const prepared = prepareScenarioSession(null, { seed: 440044 });
    const controller = new SimulationController(prepared.config);
    const session = createPlayerSessionState({ runId: 'plan-disabled', scenarioId: null, prepared, controller });

    expect(playerReportAvailability(session).find((report) => report.id === 'report.three_year_plan')?.available).toBe(false);
    expect(buildPlayerReport(session, controller, 'report.three_year_plan')?.data).toEqual({ available: false });
    expect(buildThreeYearPlanPresentation(session.bankState)).toBeNull();
    expect(renderToStaticMarkup(<ThreeYearPlanPanel state={session.bankState} />)).toBe('');
  });

  it('renders every shared mandate value and formal-review driver exposed by the player report', () => {
    const prepared = prepareScenarioSession(null, { seed: 440045 });
    const controller = new SimulationController(prepared.config);
    const session = createPlayerSessionState({ runId: 'plan-report', scenarioId: null, prepared, controller });
    session.bankState.threeYearPlan = createDefaultThreeYearPlan(session.bankState);
    session.bankState.time.step = session.bankState.threeYearPlan.startStep + 6;
    const plan = session.bankState.threeYearPlan;
    const evaluation = evaluateThreeYearPlan({
      state: session.bankState,
      month: 6,
      targets: plan.targets,
      registry: bankThreeYearPlanMetricRegistry,
    });
    const reviewedEvaluation = {
      ...evaluation,
      score: 55,
      metrics: evaluation.metrics.map((metric, index) => index === 0 ? { ...metric, score: 20 } : metric),
    };
    plan.reviewHistory = [{ month: 6, evaluation: reviewedEvaluation, boardConfidenceBefore: 70, boardConfidenceAfter: 64 }];
    plan.boardConfidence = 64;

    const report = buildPlayerReport(session, controller, 'report.three_year_plan');
    const display = buildThreeYearPlanPresentation(session.bankState);
    expect(report?.data).toEqual({ available: true, ...display });
    expect(playerReportAvailability(session).find((item) => item.id === 'report.three_year_plan')?.available).toBe(true);
    expect(display?.reviewDrivers).toContain('Largest plan-score drag:');

    const markup = renderToStaticMarkup(<ThreeYearPlanPanel state={session.bankState} />);
    for (const value of displayedStrings(display)) expect(markup).toContain(escapeHtml(value));
    expect(markup).toContain('Latest formal board review · month 6');
    expect(markup).toContain('Progress against mandate');
  });

  it('uses the same final target and result display when the plan is complete', () => {
    const prepared = prepareScenarioSession(null, { seed: 440046 });
    const controller = new SimulationController(prepared.config);
    const session = createPlayerSessionState({ runId: 'plan-complete', scenarioId: null, prepared, controller });
    session.bankState.threeYearPlan = createDefaultThreeYearPlan(session.bankState);
    const plan = session.bankState.threeYearPlan;
    session.bankState.time.step = plan.startStep + plan.horizonMonths;
    plan.completed = true;
    plan.currentEvaluation = evaluateThreeYearPlan({
      state: session.bankState,
      month: plan.horizonMonths,
      targets: plan.targets,
      registry: bankThreeYearPlanMetricRegistry,
    });

    const display = buildThreeYearPlanPresentation(session.bankState);
    const report = buildPlayerReport(session, controller, 'report.three_year_plan');
    const markup = renderToStaticMarkup(<ThreeYearPlanPanel state={session.bankState} />);
    expect(display?.progress).toBeNull();
    expect(display?.finalResult?.targetColumn).toBe('Final target');
    expect(report?.data).toEqual({ available: true, ...display });
    for (const value of displayedStrings(display)) expect(markup).toContain(escapeHtml(value));
  });
});
