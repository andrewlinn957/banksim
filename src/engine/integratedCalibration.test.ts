import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { validateThreeYearPlanAgreement } from '../config/threeYearPlan';
import { cloneBankState } from './clone';
import {
  INTEGRATED_CALIBRATION_SEEDS,
  INTEGRATED_CALIBRATION_STRATEGIES,
  type CalibrationStrategyId,
  type IntegratedCalibrationSummary,
  createTrivialThreeYearPlanTargets,
  runIntegratedCalibration,
  summarizeIntegratedCalibration,
} from './integratedCalibration';

const requestedStrategy = process.env.CALIBRATION_STRATEGY as CalibrationStrategyId | undefined;
const selectedStrategies: readonly CalibrationStrategyId[] = requestedStrategy ? [requestedStrategy] : INTEGRATED_CALIBRATION_STRATEGIES;
const onlyExploit = process.env.CALIBRATION_ONLY_EXPLOIT === '1';
const skipExploit = process.env.CALIBRATION_SKIP_EXPLOIT === '1';

const assertBroadCalibrationEnvelope = (summary: IntegratedCalibrationSummary) => {
  if (summary.strategy === 'unmanaged') {
    expect(summary.survivalRate).toBeLessThanOrEqual(0.75);
    expect(summary.meanSharePriceReturn).toBeLessThan(0.75);
    expect(summary.meanBoardConfidence ?? 100).toBeLessThan(90);
    return;
  }

  expect(summary.survivalRate).toBe(1);

  if (summary.strategy === 'balanced' || summary.strategy === 'adaptive') {
    expect(summary.meanSharePriceReturn).toBeGreaterThan(1);
    expect(summary.meanBoardConfidence ?? 0).toBeGreaterThan(80);
    expect(summary.meanCapitalRaised).toBeLessThan(0.5e9);
    return;
  }

  if (summary.strategy === 'growth' || summary.strategy === 'levered-growth') {
    expect(summary.meanSharePriceReturn).toBeGreaterThan(0.8);
    expect(summary.meanBoardConfidence ?? 0).toBeGreaterThan(85);
    return;
  }

  if (summary.strategy === 'profit') {
    expect(summary.meanLoanGrowth).toBeLessThan(-0.2);
    expect(summary.meanSharePriceReturn).toBeGreaterThan(1);
    expect(summary.meanBoardConfidence ?? 100).toBeLessThan(85);
    return;
  }

  if (summary.strategy === 'fortress') {
    expect(summary.meanLoanGrowth).toBeLessThan(-0.35);
    expect(summary.meanLiquidAssetShare).toBeGreaterThan(0.45);
    expect(summary.meanSharePriceReturn).toBeLessThan(1.1);
    expect(summary.meanBoardConfidence ?? 100).toBeLessThan(90);
    return;
  }

  if (summary.strategy === 'capital-markets-reliant') {
    expect(summary.meanCapitalRaised).toBeGreaterThan(2e9);
    expect(summary.meanCapitalMarketsExecutions).toBeGreaterThan(8);
    expect(summary.meanSharePriceReturn).toBeLessThan(0.5);
    expect(summary.meanBoardConfidence ?? 100).toBeLessThan(85);
  }
};

describe('integrated 72-month game calibration', () => {
  if (!onlyExploit) {
    it('runs the selected multi-seed strategy paths through two plan cycles', () => {
      const runs = selectedStrategies.flatMap(strategy =>
        INTEGRATED_CALIBRATION_SEEDS.map(seed => runIntegratedCalibration({ strategy, seed }))
      );
      const summary = summarizeIntegratedCalibration(runs).filter(item => selectedStrategies.includes(item.strategy));

      expect(runs).toHaveLength(INTEGRATED_CALIBRATION_SEEDS.length * selectedStrategies.length);
      expect(summary).toHaveLength(selectedStrategies.length);
      for (const run of runs) {
        expect(Number.isFinite(run.cet1Ratio)).toBe(true);
        expect(Number.isFinite(run.lcr)).toBe(true);
        expect(Number.isFinite(run.nsfr)).toBe(true);
        expect(Number.isFinite(run.sharePrice)).toBe(true);
        expect(run.monthsRun).toBeGreaterThan(0);
        if (!run.failed) expect(run.monthsRun).toBe(72);
      }
      summary.forEach(assertBroadCalibrationEnvelope);

      console.log('INTEGRATED_CALIBRATION_RUNS=' + JSON.stringify(runs));
      console.log('INTEGRATED_CALIBRATION_SUMMARY=' + JSON.stringify(summary));
    });
  }

  if (!skipExploit) {
    it('rejects the self-set trivial-plan exploit at the board-agreement boundary', () => {
      const state = cloneBankState(initialState);
      const proposal = createTrivialThreeYearPlanTargets(state);
      const issues = validateThreeYearPlanAgreement(state, proposal);

      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(issue => issue.includes('Profitability measures'))).toBe(true);
      expect(issues.some(issue => issue.includes('minimum ambition'))).toBe(true);
      console.log('TRIVIAL_PLAN_REJECTED=' + JSON.stringify(issues));
    });
  }
});
