import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { LoanStage } from '../domain/loanCohorts';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const stageOutstanding = (state: typeof initialState, productType: AssetProductType, stage: LoanStage): number =>
  (state.loanCohorts[productType] ?? [])
    .filter((cohort) => cohort.stage === stage)
    .reduce((sum, cohort) => sum + cohort.outstandingPrincipal, 0);

describe('IFRS9 staging and provision stock', () => {
  it('builds provisions before realized losses under severe macro stress', () => {
    const engine = createSimulationEngine();

    const baseline = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      actions: [],
      shocks: [],
    }).nextState;

    const stressed = engine.step({
      state: cloneBankState(initialState),
      config: baseConfig,
      actions: [],
      shocks: [{ type: 'macroDownturn', pdMultiplier: 3.5, lgdMultiplier: 2.0 }],
    }).nextState;

    expect(stressed.financial.provisionStock.total).toBeGreaterThan(baseline.financial.provisionStock.total);
    expect(stressed.financial.incomeStatement.provisionCharge).toBeGreaterThan(0);
    const workoutStock = Object.values(stressed.workoutPipelines ?? {}).reduce(
      (sum, buckets) =>
        sum +
        (buckets ?? []).reduce(
          (inner, bucket) => inner + Math.max(0, bucket.defaultedPrincipal ?? 0),
          0
        ),
      0
    );
    expect(workoutStock).toBeGreaterThan(0);
    expect(stressed.financial.incomeStatement.realizedLoanLosses).toBeGreaterThanOrEqual(0);

    const stage2plusBaseline =
      stageOutstanding(baseline, AssetProductType.Mortgages, 'stage2') +
      stageOutstanding(baseline, AssetProductType.Mortgages, 'stage3') +
      stageOutstanding(baseline, AssetProductType.CorporateLoans, 'stage2') +
      stageOutstanding(baseline, AssetProductType.CorporateLoans, 'stage3');

    const stage2plusStressed =
      stageOutstanding(stressed, AssetProductType.Mortgages, 'stage2') +
      stageOutstanding(stressed, AssetProductType.Mortgages, 'stage3') +
      stageOutstanding(stressed, AssetProductType.CorporateLoans, 'stage2') +
      stageOutstanding(stressed, AssetProductType.CorporateLoans, 'stage3');

    expect(stage2plusStressed).toBeGreaterThan(stage2plusBaseline);
  });
});
