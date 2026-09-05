// Simple scenario system with scheduled shocks and initial state overrides
import { BankState } from '../domain/bankState';
import { Shock } from '../domain/shocks';
import { initialState as baseInitialState } from './initialState';
import { BalanceSheetItem } from '../domain/balanceSheet';
import { LiabilityProductType, AssetProductType, ProductType } from '../domain/enums';
import { SimulationConfig } from '../domain/config';
import { baseConfig } from './baseConfig';
import { calculateRiskMetrics, evaluateCompliance } from '../engine/metrics';
import { cloneBankState } from '../engine/clone';
import { calculateProvisionTargetFromCohorts, generateSeasonedLoanCohorts, sumLoanOutstanding } from '../engine/loanCohorts';
import { ScenarioGoals } from '../domain/scoring';
import { PlayerAction } from '../domain/actions';

export interface ScheduledShock {
  stepNumber: number;
  shock: Shock;
}

export interface ScenarioMetricTrigger {
  metric: 'cet1Ratio' | 'leverageRatio' | 'lcr' | 'nsfr';
  operator: '<' | '<=' | '>' | '>=';
  value: number;
}

export interface ScenarioActionTrigger {
  actionType: PlayerAction['type'];
  minCount?: number;
}

export interface ScenarioArcTrigger {
  allMetrics?: ScenarioMetricTrigger[];
  anyMetrics?: ScenarioMetricTrigger[];
  actionRequirements?: ScenarioActionTrigger[];
}

export interface ScenarioArcStage {
  id: string;
  stepNumber: number;
  shocks: Shock[];
  trigger?: ScenarioArcTrigger;
  milestone?: string;
  severity?: 'info' | 'warning' | 'error';
}

export interface ScenarioMilestone {
  id: string;
  stepNumber: number;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface ScenarioStepPayload {
  shocks: Shock[];
  milestones: ScenarioMilestone[];
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  goals?: ScenarioGoals;
  initialStateOverride?: Omit<Partial<BankState>, 'financial'> & {
    financial?: Omit<Partial<BankState['financial']>, 'balanceSheet'> & {
      balanceSheet?: {
        items?: Array<Partial<BalanceSheetItem> & { productType: ProductType }>;
      };
    };
  };
  scheduledShocks: ScheduledShock[];
  arcStages?: ScenarioArcStage[];
  configOverrides?: Partial<SimulationConfig>;
}

const applyInitialOverride = (
  override: Scenario['initialStateOverride'] | undefined,
  config: SimulationConfig
): BankState => {
  const state = cloneBankState(baseInitialState);
  if (override?.financial?.balanceSheet?.items) {
    state.financial.balanceSheet.items = state.financial.balanceSheet.items.map((item) => {
      const ov = override.financial?.balanceSheet?.items?.find((o) => o.productType === item.productType);
      if (!ov) return item;
      return {
        ...item,
        ...ov,
        encumbrance: ov.encumbrance ? { ...ov.encumbrance } : item.encumbrance,
      };
    });
  }
  if (override?.financial?.capital) {
    state.financial.capital = { ...state.financial.capital, ...override.financial.capital };
  }
  if (override?.financial?.incomeStatement) {
    state.financial.incomeStatement = {
      ...state.financial.incomeStatement,
      ...override.financial.incomeStatement,
    };
  }
  if (override?.financial?.cashFlowStatement) {
    state.financial.cashFlowStatement = {
      ...state.financial.cashFlowStatement,
      ...override.financial.cashFlowStatement,
    };
  }
  if (override?.market) {
    state.market = { ...state.market, ...override.market };
  }
  if (override?.behaviour) {
    state.behaviour = { ...state.behaviour, ...override.behaviour };
  }
  if (override?.status) {
    state.status = { ...state.status, ...override.status };
  }
  if (override?.board) {
    state.board = { ...state.board, ...override.board };
  }

  const initialSeed = config.global.initialPortfolioSeed ?? state.market.macroModel.rngSeed;
  const loanProducts = [AssetProductType.Mortgages, AssetProductType.CorporateLoans] as const;
  loanProducts.forEach((productType, idx) => {
    const item = state.financial.balanceSheet.items.find((i) => i.productType === productType);
    if (!item) return;
    if (item.balance <= 0) {
      state.loanCohorts[productType] = [];
      return;
    }

    const cohorts = state.loanCohorts[productType] ?? [];
    const sum = sumLoanOutstanding(cohorts);
    if (sum > 0) {
      const scale = item.balance / sum;
      cohorts.forEach((c) => {
        c.outstandingPrincipal *= scale;
        c.originalPrincipal *= scale;
      });
      state.loanCohorts[productType] = cohorts;
      item.balance = sumLoanOutstanding(cohorts);
      return;
    }

    const params = config.productParameters[productType];
    const seeded = generateSeasonedLoanCohorts({
      productType,
      targetOutstanding: item.balance,
      baseAnnualInterestRate: item.interestRate,
      baseAnnualPd: params.baseDefaultRate,
      baseLgd: params.lossGivenDefault,
      config,
      seed: initialSeed + idx,
    });
    state.loanCohorts[productType] = seeded;
    item.balance = sumLoanOutstanding(seeded);
  });

  // Overrides specify net balances; initialise a matching gross book and opening allowance.
  state.financial.provisionStock = { stage1: 0, stage2: 0, stage3: 0, total: 0 };
  for (const productType of loanProducts) {
    const item = state.financial.balanceSheet.items.find(i => i.productType === productType)!;
    const target = calculateProvisionTargetFromCohorts({ state, config, productType });
    const gross = sumLoanOutstanding(state.loanCohorts[productType] ?? []);
    const scale = gross > 0 ? item.balance / Math.max(1, gross - target.total) : 0;
    (state.loanCohorts[productType] ?? []).forEach(c => { c.outstandingPrincipal *= scale; c.originalPrincipal *= scale; });
    const allowance = calculateProvisionTargetFromCohorts({ state, config, productType });
    item.lossAllowance = allowance.total;
    item.balance = sumLoanOutstanding(state.loanCohorts[productType] ?? []) - allowance.total;
    for (const stage of ['stage1','stage2','stage3','total'] as const) state.financial.provisionStock[stage] += allowance[stage];
  }
  // Keep contractual maturity ladders consistent when a scenario changes funding stock.
  for (const p of [LiabilityProductType.WholesaleFundingST, LiabilityProductType.WholesaleFundingLT]) {
    const buckets = state.fundingLadders[p] ?? [];
    const total = buckets.reduce((sum, b) => sum + b.notional, 0);
    const balance = state.financial.balanceSheet.items.find(i => i.productType === p)?.balance ?? 0;
    if (total > 0) buckets.forEach(b => b.notional *= balance / total);
  }
  const cash = state.financial.balanceSheet.items.find(i => i.productType === AssetProductType.CashReserves)!;
  const netOther = state.financial.balanceSheet.items.filter(i => i !== cash).reduce((sum, i) => sum + (i.side === 'Asset' ? i.balance : -i.balance), 0);
  cash.balance = state.financial.capital.cet1 + state.financial.capital.at1 + state.financial.capital.accumulatedOCI - netOther;
  state.risk.riskMetrics = calculateRiskMetrics({ state, config });
  state.risk.compliance = evaluateCompliance(state.risk.riskMetrics, config.riskLimits);
  state.board = {
    score: state.risk.riskMetrics.boardPressureScore,
    earningsVolatility: state.risk.riskMetrics.boardPressureVolatility,
    franchiseGap: state.risk.riskMetrics.boardPressureFranchiseGap,
    riskGap: state.risk.riskMetrics.boardPressureRiskGap,
  };
  return state;
};

export const scenarios: Scenario[] = [
  {
    id: 'supervisory-review', name: 'The supervisory review',
    description: 'A fictional bank-specific capital decision raises the stakes: absorb a 1.5% Pillar 2A requirement and 1% PRA buffer while keeping the business profitable.',
    configOverrides: { riskLimits: { ...baseConfig.riskLimits, pillar2A: { totalRatio: .015 }, praBufferRatio: .01 } },
    goals: { horizonMonths: 12, objectives: [
      { label: 'Finish with CET1 above 14%', metric: 'cet1Ratio', direction: 'min', target: .14, weight: 40 },
      { label: 'Keep liquidity available', metric: 'lcr', direction: 'min', target: 1.1, weight: 30 },
      { label: 'Keep stable funding', metric: 'nsfr', direction: 'min', target: 1.05, weight: 30 },
    ] },
    scheduledShocks: [{ stepNumber: 4, shock: { type: 'depositCompetition', retailRateIncrease: .0025 } }, { stepNumber: 7, shock: { type: 'macroDownturn', pdMultiplier: 1.3, lgdMultiplier: 1.1 } }],
  },
  {
    id: 'wholesale-funding-reliance',
    name: 'Wholesale Funding Reliance',
    description:
      'Bank leans on short-term wholesale funding with weaker deposits. Early market spread shock and liquidity run stress funding resilience.',
    goals: {
      horizonMonths: 12,
      objectives: [
        { label: 'Keep LCR above 110%', metric: 'lcr', direction: 'min', target: 1.1, weight: 35 },
        { label: 'Keep NSFR above 102%', metric: 'nsfr', direction: 'min', target: 1.02, weight: 30 },
        { label: 'Keep CET1 above 11.5%', metric: 'cet1Ratio', direction: 'min', target: 0.115, weight: 35 },
      ],
    },
    initialStateOverride: {
      financial: {
        balanceSheet: {
          items: [
            { productType: LiabilityProductType.WholesaleFundingST, balance: 2.4e9 },
            { productType: LiabilityProductType.RetailTransactionalDeposits, balance: 3.5e9 },
            { productType: LiabilityProductType.RetailSavingsDeposits, balance: 4.5e9 },
            { productType: LiabilityProductType.CorporateOperatingDeposits, balance: 1.3e9 },
            { productType: LiabilityProductType.CorporateNonOperatingDeposits, balance: 0.7e9 },
          ],
        },
      },
    },
    scheduledShocks: [
      {
        stepNumber: 0,
        shock: {
          type: 'marketSpreadShock',
          wholesaleSpreadBps: 120,
          loanSpreadBps: 40,
          repoHaircutIncreasePct: 0.02,
        },
      },
      {
        stepNumber: 0,
        shock: {
          type: 'idiosyncraticRun',
          outflowRateMultiplier: 1.8,
        },
      },
    ],
    arcStages: [
      {
        id: 'funding-cliff',
        stepNumber: 2,
        trigger: {
          allMetrics: [{ metric: 'lcr', operator: '<', value: 1.15 }],
        },
        shocks: [
          { type: 'rolloverStress', accessMultiplier: 0.75, spreadBps: 90 },
          { type: 'idiosyncraticRun', outflowRateMultiplier: 1.2 },
        ],
        milestone: 'Funding markets tighten as confidence in your liquidity position fades.',
        severity: 'warning',
      },
      {
        id: 'funding-stabilises',
        stepNumber: 2,
        trigger: {
          allMetrics: [{ metric: 'lcr', operator: '>=', value: 1.15 }],
        },
        shocks: [{ type: 'rolloverStress', accessMultiplier: 0.9, spreadBps: 35 }],
        milestone: 'Stronger liquidity keeps market access open despite wider spreads.',
        severity: 'info',
      },
    ],
  },
  {
    id: 'corporate-credit-boom',
    name: 'Corporate Credit Boom',
    description:
      'Aggressive growth in corporate lending sets the stage for a downturn that hits PD/LGD hard.',
    goals: {
      horizonMonths: 18,
      objectives: [
        { label: 'Maintain CET1 above 11%', metric: 'cet1Ratio', direction: 'min', target: 0.11, weight: 30 },
        { label: 'Hold leverage above 4%', metric: 'leverageRatio', direction: 'min', target: 0.04, weight: 20 },
        { label: 'Deliver ROE >= 7%', metric: 'roe', direction: 'min', target: 0.07, weight: 25 },
        { label: 'Keep monthly net income >= £0', metric: 'netIncome', direction: 'min', target: 0, weight: 25 },
      ],
    },
    initialStateOverride: {
      financial: {
        balanceSheet: {
          items: [
            { productType: AssetProductType.CorporateLoans, balance: 4.0e9 },
            { productType: AssetProductType.Mortgages, balance: 5.5e9 },
          ],
        },
      },
    },
    scheduledShocks: [
      {
        stepNumber: 3,
        shock: {
          type: 'macroDownturn',
          pdMultiplier: 3.5,
          lgdMultiplier: 2,
        },
      },
    ],
    arcStages: [
      {
        id: 'credit-crunch',
        stepNumber: 6,
        trigger: {
          anyMetrics: [
            { metric: 'cet1Ratio', operator: '<', value: 0.12 },
            { metric: 'leverageRatio', operator: '<', value: 0.045 },
          ],
          actionRequirements: [{ actionType: 'setUnderwriting', minCount: 1 }],
        },
        shocks: [
          { type: 'macroDownturn', pdMultiplier: 1.6, lgdMultiplier: 1.25 },
          { type: 'marketSpreadShock', wholesaleSpreadBps: 55, loanSpreadBps: 45, repoHaircutIncreasePct: 0.01 },
        ],
        milestone: 'Credit markets deteriorate as weaker borrowers miss covenants.',
        severity: 'warning',
      },
      {
        id: 'soft-landing',
        stepNumber: 6,
        trigger: {
          allMetrics: [{ metric: 'cet1Ratio', operator: '>=', value: 0.12 }],
        },
        shocks: [{ type: 'macroDownturn', pdMultiplier: 1.2, lgdMultiplier: 1.05 }],
        milestone: 'Prudent balance-sheet management softens the downturn.',
        severity: 'info',
      },
    ],
  },
];

// Helpers to use scenarios externally
export const applyScenarioConfig = (
  base: SimulationConfig,
  scenarioId: string | null | undefined
): SimulationConfig => {
  const scenario = scenarios.find((s) => s.id === scenarioId);
  if (!scenario?.configOverrides) return base;
  const overrides = scenario.configOverrides;

  const mergeRecord = <T extends Record<string, any>>(baseRecord: T, overrideRecord?: Partial<T>): T => {
    if (!overrideRecord) return { ...baseRecord };
    const merged = { ...baseRecord } as T;
    (Object.keys(overrideRecord) as Array<keyof T>).forEach((key) => {
      const overrideValue = overrideRecord[key];
      if (overrideValue === undefined) return;
      const baseValue = baseRecord[key];
      if (
        baseValue !== null &&
        typeof baseValue === 'object' &&
        !Array.isArray(baseValue) &&
        overrideValue !== null &&
        typeof overrideValue === 'object' &&
        !Array.isArray(overrideValue)
      ) {
        merged[key] = mergeRecord(baseValue, overrideValue);
        return;
      }
      merged[key] = overrideValue as T[keyof T];
    });
    return merged;
  };

  return mergeRecord(base, overrides);
};

export const getScenarioInitialState = (
  scenarioId: string | null | undefined,
  config: SimulationConfig = baseConfig
): BankState => {
  const scenario = scenarios.find((s) => s.id === scenarioId);
  return applyInitialOverride(scenario?.initialStateOverride, config);
};

const readMetric = (state: BankState, metric: ScenarioMetricTrigger['metric']): number => {
  const metrics = state.risk.riskMetrics;
  if (metric === 'cet1Ratio') return metrics.cet1Ratio;
  if (metric === 'leverageRatio') return metrics.leverageRatio;
  if (metric === 'lcr') return metrics.lcr;
  return metrics.nsfr;
};

const compareMetric = (left: number, operator: ScenarioMetricTrigger['operator'], right: number): boolean => {
  if (operator === '<') return left < right;
  if (operator === '<=') return left <= right;
  if (operator === '>') return left > right;
  return left >= right;
};

const triggerSatisfied = (
  trigger: ScenarioArcTrigger | undefined,
  state: BankState | undefined,
  actions: PlayerAction[] | undefined
): boolean => {
  if (!trigger) return true;
  if (!state) return false;

  const allMetricsOk =
    (trigger.allMetrics ?? []).length === 0 ||
    (trigger.allMetrics ?? []).every((condition) =>
      compareMetric(readMetric(state, condition.metric), condition.operator, condition.value)
    );
  if (!allMetricsOk) return false;

  const anyMetrics = trigger.anyMetrics ?? [];
  const anyMetricsOk =
    anyMetrics.length === 0 ||
    anyMetrics.some((condition) =>
      compareMetric(readMetric(state, condition.metric), condition.operator, condition.value)
    );
  if (!anyMetricsOk) return false;

  const requirements = trigger.actionRequirements ?? [];
  if (requirements.length === 0) return true;
  const actionCounts = new Map<PlayerAction['type'], number>();
  (actions ?? []).forEach((action) => {
    actionCounts.set(action.type, (actionCounts.get(action.type) ?? 0) + 1);
  });
  return requirements.every((requirement) => {
    const count = actionCounts.get(requirement.actionType) ?? 0;
    return count >= (requirement.minCount ?? 1);
  });
};

export const getScenarioStepPayload = (args: {
  scenarioId: string | null | undefined;
  stepNumber: number;
  state?: BankState;
  actions?: PlayerAction[];
}): ScenarioStepPayload => {
  const { scenarioId, stepNumber, state, actions } = args;
  const scenario = scenarios.find((s) => s.id === scenarioId);
  if (!scenario) return { shocks: [], milestones: [] };

  const scheduled = scenario.scheduledShocks.filter((s) => s.stepNumber === stepNumber).map((s) => s.shock);
  const arcMatches = (scenario.arcStages ?? []).filter(
    (stage) => stage.stepNumber === stepNumber && triggerSatisfied(stage.trigger, state, actions)
  );

  const arcShocks = arcMatches.flatMap((stage) => stage.shocks);
  const milestones = arcMatches
    .filter((stage) => stage.milestone)
    .map((stage) => ({
      id: `${scenario.id}-${stage.id}-${stepNumber}`,
      stepNumber,
      message: stage.milestone ?? '',
      severity: stage.severity ?? 'info',
    }));

  return {
    shocks: [...scheduled, ...arcShocks],
    milestones,
  };
};

export const getScheduledShocksForStep = (
  scenarioId: string | null | undefined,
  stepNumber: number,
  state?: BankState,
  actions?: PlayerAction[]
): Shock[] => getScenarioStepPayload({ scenarioId, stepNumber, state, actions }).shocks;

export const getScenarioMilestonesForStep = (
  scenarioId: string | null | undefined,
  stepNumber: number,
  state?: BankState,
  actions?: PlayerAction[]
): ScenarioMilestone[] => getScenarioStepPayload({ scenarioId, stepNumber, state, actions }).milestones;
