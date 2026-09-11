import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialState } from '../config/initialState';
import { createDefaultThreeYearPlan } from '../config/threeYearPlan';
import Boardroom from '../components/Boardroom';

describe('Three-Year Plan board mandate', () => {
  it('shows normal bank management without any board proposal agenda when plan mode is off', () => {
    const noop = () => {};
    const markup = renderToStaticMarkup(
      <Boardroom state={initialState} history={[initialState]} department={null} hasErrors onDepartment={noop} onClose={noop} />
    );
    expect(markup).toContain('invalid policy input');
    expect(markup).toContain('Manage a department');
    expect(markup.match(/class="department-building/g)).toHaveLength(4);
    expect(markup).not.toContain('Board agenda');
    expect(markup).not.toContain('Back proposal');
    expect(markup).not.toContain('12-month mandate');
    expect(markup).not.toContain('Three-Year Plan');
  });

  it('shows the fixed quantitative mandate and live progress when plan mode is enabled', () => {
    const noop = () => {};
    const planned = structuredClone(initialState);
    planned.threeYearPlan = createDefaultThreeYearPlan(planned);
    const markup = renderToStaticMarkup(
      <Boardroom state={planned} history={[planned]} department={null} hasErrors={false} onDepartment={noop} onClose={noop} />
    );
    expect(markup).toContain('Three-Year Plan');
    expect(markup).toContain('Board mandate');
    expect(markup).toContain('Board Confidence');
    expect(markup).toContain('Live trajectory');
    expect(markup).toContain('Progress against mandate');
    expect(markup).toContain('No formal board review yet');
    expect(markup).toContain('Next annual milestone · FY1');
    expect(markup).toContain('FY1 / FY2 / FY3 mandate targets');
    expect(markup).toContain('70/100');
    expect(markup).not.toContain('Set opening board plan');
    expect(markup).not.toContain('Agree next Three-Year Plan');
    expect(markup).not.toContain('Back proposal');
  });

  it('shows a final scorecard at month 36 without offering a successor mandate', () => {
    const noop = () => {};
    const planned = structuredClone(initialState);
    planned.threeYearPlan = createDefaultThreeYearPlan(planned);
    planned.time.step = 36;
    planned.threeYearPlan.completed = true;
    planned.threeYearPlan.boardConfidence = 78;
    planned.threeYearPlan.currentEvaluation = {
      month: 36,
      score: 80,
      metrics: planned.threeYearPlan.targets.map(target => ({
        metricId: target.metricId,
        actual: target.milestones[2].lower,
        targetLower: target.milestones[2].lower,
        targetUpper: target.milestones[2].upper,
        score: 80,
        weight: target.weight,
      })),
    };
    const markup = renderToStaticMarkup(
      <Boardroom state={planned} history={[planned]} department={null} hasErrors={false} onDepartment={noop} onClose={noop} />
    );
    expect(markup).toContain('Final plan result');
    expect(markup).toContain('mandate complete');
    expect(markup).toContain('Final target');
    expect(markup).not.toContain('Agree next Three-Year Plan');
    expect(markup).not.toContain('Previous plan cycles');
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
});
