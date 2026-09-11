import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialState } from '../config/initialState';
import { createDefaultThreeYearPlan } from '../config/threeYearPlan';
import { boardDecisions, monthlyBrief } from './boardroom';
import { parseRateInput } from '../utils/parsers';
import Boardroom from '../components/Boardroom';

describe('board management', () => {
  it('provides executable proposal inputs with explicit cost and benefit', () => {
    for (const decision of boardDecisions(initialState)) {
      expect(decision.benefit.length).toBeGreaterThan(0);
      expect(decision.tradeoff.length).toBeGreaterThan(0);
      for (const [key, value] of Object.entries(decision.changes)) {
        if (key.endsWith('Rate')) expect(parseRateInput(value).error).toBeUndefined();
      }
    }
  });

  it('renders an optional board agenda with no forced monthly action', () => {
    const noop = () => {};
    const markup = renderToStaticMarkup(
      <Boardroom state={initialState} history={[initialState]} department={null} hasErrors onDepartment={noop} onClose={noop} onDecision={noop} />
    );
    expect(markup).toContain('invalid policy input');
    expect(markup).toContain('Manage a department');
    expect(markup.match(/class="department-building/g)).toHaveLength(4);
    expect(markup).toContain('Board agenda');
    expect(markup).toContain('Back proposal');
    expect(markup).toContain('Nothing executes until you run the next month');
    expect(markup).not.toContain('Three-Year Plan');
  });

  it('separates live trajectory, formal reviews and annual milestones when the plan is enabled', () => {
    const noop = () => {};
    const planned = structuredClone(initialState);
    planned.threeYearPlan = createDefaultThreeYearPlan(planned);
    const markup = renderToStaticMarkup(
      <Boardroom state={planned} history={[planned]} department={null} hasErrors={false} onDepartment={noop} onClose={noop} />
    );
    expect(markup).toContain('Three-Year Plan');
    expect(markup).toContain('Board Confidence');
    expect(markup).toContain('Live trajectory');
    expect(markup).toContain('No formal board review yet');
    expect(markup).toContain('Next annual milestone · FY1');
    expect(markup).toContain('Annual plan milestones');
    expect(markup).toContain('70/100');
  });

  it('explains the latest Board Confidence movement using reviewed plan metrics', () => {
    const noop = () => {};
    const planned = structuredClone(initialState);
    planned.time.step = 3;
    planned.threeYearPlan = createDefaultThreeYearPlan(planned);
    planned.threeYearPlan.boardConfidence = 68;
    planned.threeYearPlan.reviewHistory = [{
      month: 3,
      boardConfidenceBefore: 70,
      boardConfidenceAfter: 68,
      evaluation: {
        month: 3,
        score: 62,
        metrics: [{ metricId: 'eps', actual: .04, targetLower: .08, score: 20, weight: 25 }],
      },
    }];
    const markup = renderToStaticMarkup(
      <Boardroom state={planned} history={[planned]} department={null} hasErrors={false} onDepartment={noop} onClose={noop} />
    );
    expect(markup).toContain('Latest formal board review · month 3');
    expect(markup).toContain('fell 2.0 points');
    expect(markup).toContain('Largest plan-score drag');
    expect(markup).toContain('EPS (80.0 pts)');
  });

  it('prioritises an existing management proposal when it addresses the largest plan miss', () => {
    const planned = structuredClone(initialState);
    planned.time.step = 6;
    planned.threeYearPlan = createDefaultThreeYearPlan(planned);
    planned.threeYearPlan.targets = planned.threeYearPlan.targets.map(target =>
      target.metricId === 'customerDeposits'
        ? {
            ...target,
            weight: 60,
            milestones: target.milestones.map(milestone => ({ ...milestone, lower: target.baseline * 1.5 })),
          }
        : { ...target, weight: 1 }
    );
    expect(boardDecisions(planned)[0].id).toBe('savers');
    expect(monthlyBrief(planned).focus).toBe('Three-Year Plan');
    expect(monthlyBrief(planned).title).toContain('Customer deposits');
  });

  it('offers real equity recovery when internal capital headroom is negative', () => {
    const stressed = structuredClone(initialState);
    stressed.risk.riskMetrics.internalCet1Headroom = -.01;
    const rescue = boardDecisions(stressed).find((decision) => decision.id === 'capital');
    expect(rescue?.changes.capitalMarketsInstrument).toBe('cet1');
    expect(Number(rescue?.changes.capitalMarketsTargetAmount)).toBeGreaterThan(0);
    expect(boardDecisions(stressed).some((decision) => decision.id === 'growth')).toBe(false);
  });
});
