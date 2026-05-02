import { createSimulationEngine, SimulationEvent, SimulationStepOutput } from '../engine/simulation';
import { cloneBankState } from '../engine/clone';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { PlayerAction } from '../domain/actions';
import { Shock } from '../domain/shocks';
import { evaluateScenarioGoals } from '../engine/scoring';
import { ScenarioGoals } from '../domain/scoring';
import { ActionTimelineEntry, RunRecord, RunSnapshot } from '../domain/runHistory';
import { buildRecommendations, Recommendation } from '../engine/recommendations';
import { StepAttribution } from '../domain/attribution';
import { isFeatureEnabled } from '../engine/featureFlags';

export type StopConditionKind = 'breach' | 'nearBreach' | 'scoreTarget';

export interface StopCondition {
  kind: StopConditionKind;
  // Used for near breach checks (e.g. 0.05 => stop when within 5% of limits).
  buffer?: number;
  // Used for score target checks (0..1).
  scoreTargetPct?: number;
}

export interface RunMonthsOptions {
  state: BankState;
  months: number;
  actions: PlayerAction[] | ((state: BankState, monthIndex: number) => PlayerAction[]);
  shocks?: Shock[] | ((state: BankState, monthIndex: number) => Shock[]);
  stopCondition?: StopCondition;
  scenarioGoals?: ScenarioGoals;
}

export interface RunStepRecord {
  step: number;
  actions: PlayerAction[];
  shocks: Shock[];
  events: SimulationEvent[];
  attribution: StepAttribution;
  state: BankState;
}

export interface RunMonthsResult {
  finalState: BankState;
  records: RunStepRecord[];
  snapshots: RunSnapshot[];
  timeline: ActionTimelineEntry[];
  stoppedReason?: string;
}

const stopForBreach = (state: BankState): boolean =>
  state.status.hasFailed ||
  state.risk.compliance.cet1Breached ||
  state.risk.compliance.leverageBreached ||
  state.risk.compliance.lcrBreached ||
  state.risk.compliance.nsfrBreached;

const stopForNearBreach = (state: BankState, config: SimulationConfig, buffer: number): boolean => {
  const b = Math.max(0, buffer);
  const m = state.risk.riskMetrics;
  const limits = config.riskLimits;
  return (
    stopForBreach(state) ||
    m.cet1Ratio <= limits.minCet1Ratio * (1 + b) ||
    m.leverageRatio <= limits.minLeverageRatio * (1 + b) ||
    m.lcr <= limits.minLcr * (1 + b) ||
    m.nsfr <= limits.minNsfr * (1 + b)
  );
};

const stopForScoreTarget = (
  state: BankState,
  goals: ScenarioGoals | undefined,
  scoreTargetPct: number,
  config: SimulationConfig
): boolean => {
  if (!goals) return false;
  const target = Math.max(0, Math.min(1, scoreTargetPct));
  const score = evaluateScenarioGoals(state, goals, {
    horizonRiskPenaltyWeight: config.behaviour.horizonRiskPenaltyWeight,
  });
  return score.completionPct >= target;
};

export class SimulationController {
  private engine = createSimulationEngine();
  private config: SimulationConfig;

  constructor(config: SimulationConfig) {
    this.config = config;
  }

  setConfig(config: SimulationConfig) {
    this.config = config;
  }

  step(state: BankState, actions: PlayerAction[], shocks: Shock[]): SimulationStepOutput {
    return this.engine.step({ state, config: this.config, actions, shocks });
  }

  runMonths(options: RunMonthsOptions): RunMonthsResult {
    const requestedMonths = Number.isFinite(options.months) ? Math.max(1, Math.floor(options.months)) : 1;
    let working = cloneBankState(options.state);

    const records: RunStepRecord[] = [];
    const snapshots: RunSnapshot[] = [this.createSnapshot(working)];
    const timeline: ActionTimelineEntry[] = [];
    let stoppedReason: string | undefined;

    for (let idx = 0; idx < requestedMonths; idx++) {
      const actions = (
        typeof options.actions === 'function' ? options.actions(working, idx) : options.actions
      ).map((a) => ({ ...a }));
      const shocks = (
        typeof options.shocks === 'function' ? options.shocks(working, idx) : options.shocks ?? []
      ).map((s) => ({ ...s }));

      const { nextState, events, diagnostics } = this.step(working, actions, shocks);
      const nextClone = cloneBankState(nextState);
      records.push({
        step: nextClone.time.step,
        actions,
        shocks,
        events,
        attribution: diagnostics.attribution,
        state: nextClone,
      });
      timeline.push({ step: nextClone.time.step, actions, shocks });
      snapshots.push(this.createSnapshot(nextClone));
      working = nextClone;

      const stopCondition = options.stopCondition;
      if (!stopCondition) continue;
      if (stopCondition.kind === 'breach' && stopForBreach(working)) {
        stoppedReason = 'breach';
        break;
      }
      if (
        stopCondition.kind === 'nearBreach' &&
        stopForNearBreach(working, this.config, stopCondition.buffer ?? 0.05)
      ) {
        stoppedReason = 'nearBreach';
        break;
      }
      if (
        stopCondition.kind === 'scoreTarget' &&
        stopForScoreTarget(working, options.scenarioGoals, stopCondition.scoreTargetPct ?? 1, this.config)
      ) {
        stoppedReason = 'scoreTarget';
        break;
      }
    }

    return {
      finalState: working,
      records,
      snapshots,
      timeline,
      stoppedReason,
    };
  }

  replay(initialState: BankState, timeline: ActionTimelineEntry[]) {
    let state = cloneBankState(initialState);
    const snapshots: RunSnapshot[] = [this.createSnapshot(state)];
    timeline.forEach((entry) => {
      const { nextState } = this.step(
        state,
        (entry.actions ?? []).map((a) => ({ ...a })),
        (entry.shocks ?? []).map((s) => ({ ...s }))
      );
      state = cloneBankState(nextState);
      snapshots.push(this.createSnapshot(state));
    });
    return { finalState: state, snapshots };
  }

  toRunRecord(args: {
    id: string;
    label: string;
    initialState: BankState;
    finalState: BankState;
    timeline: ActionTimelineEntry[];
    snapshots: RunSnapshot[];
  }): RunRecord {
    return {
      id: args.id,
      label: args.label,
      createdAt: Date.now(),
      initialState: cloneBankState(args.initialState),
      finalState: cloneBankState(args.finalState),
      timeline: args.timeline.map((entry) => ({
        step: entry.step,
        actions: entry.actions.map((action) => ({ ...action })),
        shocks: entry.shocks.map((shock) => ({ ...shock })),
      })),
      snapshots: args.snapshots.map((snapshot) => ({ ...snapshot })),
    };
  }

  preview(state: BankState, actions: PlayerAction[], shocks: Shock[]) {
    const scenarios: Array<{ id: string; extraShocks: Shock[] }> = [
      { id: 'baseline', extraShocks: [] },
      { id: 'macro-mild', extraShocks: [{ type: 'macroDownturn', pdMultiplier: 1.2, lgdMultiplier: 1.1 }] },
      { id: 'macro-severe', extraShocks: [{ type: 'macroDownturn', pdMultiplier: 1.45, lgdMultiplier: 1.25 }] },
      {
        id: 'funding-stress',
        extraShocks: [
          { type: 'marketSpreadShock', wholesaleSpreadBps: 80, loanSpreadBps: 25, repoHaircutIncreasePct: 0.01 },
          { type: 'rolloverStress', accessMultiplier: 0.75, spreadBps: 80 },
        ],
      },
      { id: 'run-stress', extraShocks: [{ type: 'idiosyncraticRun', outflowRateMultiplier: 1.4 }] },
    ];

    const pathResults = scenarios.map((scenario) => {
      const result = this.step(state, actions, [...shocks, ...scenario.extraShocks]).nextState;
      const breached =
        result.risk.compliance.cet1Breached ||
        result.risk.compliance.leverageBreached ||
        result.risk.compliance.lcrBreached ||
        result.risk.compliance.nsfrBreached ||
        result.status.hasFailed;
      return {
        id: scenario.id,
        state: result,
        breached,
      };
    });

    const breachCount = pathResults.filter((path) => path.breached).length;
    return {
      baseline: pathResults[0].state,
      stressed: pathResults[pathResults.length - 1].state,
      pathCount: pathResults.length,
      breachProbability: breachCount / pathResults.length,
      paths: pathResults,
    };
  }

  recommend(state: BankState): Recommendation[] {
    if (!isFeatureEnabled(this.config, 'recommendations')) {
      return [];
    }
    return buildRecommendations(state, this.config);
  }

  createSnapshot(state: BankState): RunSnapshot {
    const equity =
      state.financial.capital.cet1 +
      state.financial.capital.at1 +
      state.financial.capital.accumulatedOCI;
    const assets = state.financial.balanceSheet.items
      .filter((item) => item.side === 'Asset')
      .reduce((sum, item) => sum + item.balance, 0);
    const netIncome = state.financial.incomeStatement.netIncome;
    const roe = equity > 0 ? (netIncome * 12) / equity : 0;
    const nim = assets > 0 ? (state.financial.incomeStatement.netInterestIncome * 12) / assets : 0;

    return {
      step: state.time.step,
      cet1Ratio: state.risk.riskMetrics.cet1Ratio,
      lcr: state.risk.riskMetrics.lcr,
      nsfr: state.risk.riskMetrics.nsfr,
      roe,
      nim,
      netIncome,
      sharePrice: state.equityMarket.sharePrice,
      marketCap: state.equityMarket.marketCap,
    };
  }
}
