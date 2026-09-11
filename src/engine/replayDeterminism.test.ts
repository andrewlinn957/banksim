import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { createDefaultThreeYearPlan, createDefaultThreeYearPlanTargets } from '../config/threeYearPlan';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { SimulationController } from '../ui/simulationController';

describe('Replay determinism', () => {
  it('replay reproduces final state metrics from saved timeline', () => {
    const controller = new SimulationController(baseConfig);
    const start = cloneBankState(initialState);

    const run = controller.runMonths({
      state: start,
      months: 5,
      actions: (_, idx) => [
        {
          type: 'adjustRate',
          productType: AssetProductType.Mortgages,
          newRate: 0.05 + idx * 0.0005,
        },
      ],
      shocks: (_, idx) =>
        idx === 2 ? [{ type: 'macroDownturn', pdMultiplier: 1.35, lgdMultiplier: 1.15 }] : [],
    });

    const replay = controller.replay(start, run.timeline);

    expect(replay.finalState.risk.riskMetrics.cet1Ratio).toBeCloseTo(run.finalState.risk.riskMetrics.cet1Ratio, 12);
    expect(replay.finalState.risk.riskMetrics.lcr).toBeCloseTo(run.finalState.risk.riskMetrics.lcr, 12);
    expect(replay.finalState.risk.riskMetrics.nsfr).toBeCloseTo(run.finalState.risk.riskMetrics.nsfr, 12);
    expect(replay.finalState.financial.capital.cet1).toBeCloseTo(run.finalState.financial.capital.cet1, 8);
  });

  it('replay reproduces a Three-Year Plan cycle renewal and its archived predecessor', () => {
    const config = { ...baseConfig, featureFlags: { ...baseConfig.featureFlags, threeYearPlan: true } };
    const controller = new SimulationController(config);
    const start = cloneBankState(initialState);
    start.threeYearPlan = createDefaultThreeYearPlan(start);
    start.time.step = 36;
    start.threeYearPlan.completed = true;
    start.threeYearPlan.boardConfidence = 79;
    start.threeYearPlan.currentEvaluation = {
      month: 36,
      score: 74,
      metrics: start.threeYearPlan.targets.map(target => ({
        metricId: target.metricId,
        actual: target.milestones[2].lower,
        targetLower: target.milestones[2].lower,
        targetUpper: target.milestones[2].upper,
        score: 74,
        weight: target.weight,
      })),
    };
    start.threeYearPlan.lastEvaluationStep = 36;
    start.threeYearPlan.reviewHistory = [{
      month: 36,
      evaluation: start.threeYearPlan.currentEvaluation,
      boardConfidenceBefore: 80,
      boardConfidenceAfter: 79,
    }];
    const targets = createDefaultThreeYearPlanTargets(start);

    const run = controller.runMonths({
      state: start,
      months: 1,
      actions: [{ type: 'renewThreeYearPlan', targets }],
      shocks: [],
    });
    const replay = controller.replay(start, run.timeline);

    expect(replay.finalState.threeYearPlan?.cycleNumber).toBe(2);
    expect(replay.finalState.threeYearPlan?.boardConfidence).toBe(run.finalState.threeYearPlan?.boardConfidence);
    expect(replay.finalState.threeYearPlan?.startStep).toBe(run.finalState.threeYearPlan?.startStep);
    expect(replay.finalState.threeYearPlan?.priorCycles).toEqual(run.finalState.threeYearPlan?.priorCycles);
    expect(replay.finalState.threeYearPlan?.targets).toEqual(run.finalState.threeYearPlan?.targets);
  });
});
