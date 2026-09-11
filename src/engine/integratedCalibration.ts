import { baseConfig } from '../config/baseConfig';
import { createDefaultThreeYearPlan, createDefaultThreeYearPlanTargets } from '../config/threeYearPlan';
import { initialState } from '../config/initialState';
import type { PlayerAction } from '../domain/actions';
import type { BankState } from '../domain/bankState';
import { AssetProductType, BalanceSheetSide, LiabilityProductType } from '../domain/enums';
import type { ThreeYearPlanTarget } from '../domain/threeYearPlan';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';
import { THREE_YEAR_PLAN_METRICS as M } from './threeYearPlanMetrics';

export const INTEGRATED_CALIBRATION_SEEDS = [11, 101, 1001, 10001, 100001, 2026, 271828, 314159] as const;
export const INTEGRATED_CALIBRATION_HORIZON_MONTHS = 72;

export type CalibrationStrategyId =
  | 'unmanaged'
  | 'balanced'
  | 'growth'
  | 'profit'
  | 'fortress'
  | 'capital-markets-reliant'
  | 'levered-growth'
  | 'adaptive';

export const INTEGRATED_CALIBRATION_STRATEGIES: readonly CalibrationStrategyId[] = [
  'unmanaged',
  'balanced',
  'growth',
  'profit',
  'fortress',
  'capital-markets-reliant',
  'levered-growth',
  'adaptive',
];

export interface IntegratedCalibrationRun {
  strategy: CalibrationStrategyId;
  seed: number;
  monthsRun: number;
  failed: boolean;
  failureStep?: number;
  cumulativeNetIncome: number;
  loans: number;
  deposits: number;
  loanGrowth: number;
  depositGrowth: number;
  cash: number;
  gilts: number;
  liquidAssetShare: number;
  loanDepositRatio: number;
  cet1Ratio: number;
  leverageRatio: number;
  lcr: number;
  nsfr: number;
  minCet1Ratio: number;
  minLcr: number;
  minNsfr: number;
  eps: number;
  rote: number;
  sharePrice: number;
  sharePriceReturn: number;
  planScore?: number;
  boardConfidence?: number;
  cycle1Score?: number;
  cycle1Confidence?: number;
  completedPlanCycles: number;
  capitalMarketsAttempts: number;
  capitalMarketsExecutions: number;
  capitalRaised: number;
  cet1Raised: number;
  at1Raised: number;
  tier2Raised: number;
  seniorRaised: number;
}

export interface IntegratedCalibrationSummary {
  strategy: CalibrationStrategyId;
  runs: number;
  survivalRate: number;
  meanMonthsRun: number;
  meanCumulativeNetIncome: number;
  meanLoanGrowth: number;
  meanDepositGrowth: number;
  meanLiquidAssetShare: number;
  meanLoanDepositRatio: number;
  meanCet1Ratio: number;
  meanLcr: number;
  meanNsfr: number;
  meanEps: number;
  meanRote: number;
  meanSharePrice: number;
  meanSharePriceReturn: number;
  meanPlanScore?: number;
  meanBoardConfidence?: number;
  meanCycle1Score?: number;
  meanCycle1Confidence?: number;
  meanCapitalRaised: number;
  meanCapitalMarketsExecutions: number;
  confidenceRange?: [number, number];
}

const productBalance = (state: BankState, productType: AssetProductType | LiabilityProductType): number =>
  state.financial.balanceSheet.items.find(item => item.productType === productType)?.balance ?? 0;

const totalLoans = (state: BankState): number =>
  productBalance(state, AssetProductType.Mortgages) +
  productBalance(state, AssetProductType.ConsumerLoans) +
  productBalance(state, AssetProductType.CorporateLoans);

const totalDeposits = (state: BankState): number =>
  productBalance(state, LiabilityProductType.RetailCurrentAccounts) +
  productBalance(state, LiabilityProductType.RetailTermDeposits) +
  productBalance(state, LiabilityProductType.CorporateOperatingDeposits) +
  productBalance(state, LiabilityProductType.CorporateNonOperatingDeposits);

const totalAssets = (state: BankState): number =>
  state.financial.balanceSheet.items
    .filter(item => item.side === BalanceSheetSide.Asset)
    .reduce((sum, item) => sum + item.balance, 0);

const clampRate = (rate: number): number => Math.max(0, rate);

const setLending = (
  state: BankState,
  discounts: { mortgage: number; consumer: number; corporate: number },
  tightness: { mortgage: number; consumer: number; corporate: number }
): PlayerAction[] => [
  {
    type: 'adjustRate',
    productType: AssetProductType.Mortgages,
    newRate: clampRate(state.market.competitorMortgageRate - discounts.mortgage),
  },
  {
    type: 'adjustRate',
    productType: AssetProductType.ConsumerLoans,
    newRate: clampRate(state.market.competitorConsumerLoanRate - discounts.consumer),
  },
  {
    type: 'adjustRate',
    productType: AssetProductType.CorporateLoans,
    newRate: clampRate(state.market.riskFreeLong + state.market.corporateLoanSpread - discounts.corporate),
  },
  { type: 'setUnderwriting', productType: AssetProductType.Mortgages, tightness: tightness.mortgage },
  { type: 'setUnderwriting', productType: AssetProductType.ConsumerLoans, tightness: tightness.consumer },
  { type: 'setUnderwriting', productType: AssetProductType.CorporateLoans, tightness: tightness.corporate },
];

const setDeposits = (state: BankState, offset: number): PlayerAction[] => {
  const corporateBenchmark = state.market.competitorCorporateDepositRate ?? state.market.competitorRetailCurrentAccountRate;
  return [
    {
      type: 'adjustRate',
      productType: LiabilityProductType.RetailCurrentAccounts,
      newRate: clampRate(state.market.competitorRetailCurrentAccountRate + offset),
    },
    {
      type: 'adjustRate',
      productType: LiabilityProductType.RetailTermDeposits,
      newRate: clampRate(state.market.competitorTermDepositRate + offset),
    },
    { type: 'setTermDepositPolicy', tenorMonths: 12 },
    {
      type: 'adjustRate',
      productType: LiabilityProductType.CorporateOperatingDeposits,
      newRate: clampRate(corporateBenchmark + offset),
    },
    {
      type: 'adjustRate',
      productType: LiabilityProductType.CorporateNonOperatingDeposits,
      newRate: clampRate(corporateBenchmark + offset),
    },
  ];
};

const seniorRaise = (amount: number, tenorMonths = 60): PlayerAction => ({
  type: 'launchCapitalMarketsTransaction',
  instrument: 'senior',
  targetAmount: amount,
  maxSpreadBps: 850,
  tenorMonths,
});

const tier2Raise = (amount: number, tenorMonths = 84): PlayerAction => ({
  type: 'launchCapitalMarketsTransaction',
  instrument: 'tier2',
  targetAmount: amount,
  maxSpreadBps: 1100,
  tenorMonths,
});

const cet1Raise = (amount: number): PlayerAction => ({
  type: 'launchCapitalMarketsTransaction',
  instrument: 'cet1',
  targetAmount: amount,
  maxDiscount: 0.22,
});

const at1Raise = (amount: number): PlayerAction => ({
  type: 'launchCapitalMarketsTransaction',
  instrument: 'at1',
  targetAmount: amount,
  maxSpreadBps: 1300,
});

const actionsForStrategy = (strategy: CalibrationStrategyId, state: BankState, month: number): PlayerAction[] => {
  if (strategy === 'unmanaged') return [];

  const cash = productBalance(state, AssetProductType.CashReserves);
  const { cet1Ratio, cet1Requirement, internalCet1Headroom, lcr, nsfr } = state.risk.riskMetrics;
  const actions: PlayerAction[] = [];

  if (strategy === 'balanced') {
    actions.push(...setLending(state, { mortgage: 0.0025, consumer: 0.005, corporate: 0.0035 }, { mortgage: 0.2, consumer: 0.3, corporate: 0.2 }));
    actions.push({ type: 'setCapitalPolicy', dividendPayoutRatio: 0.2, at1CouponMode: 'auto' });
    if (month % 3 === 0) {
      const offset = cash < 0.8e9 || lcr < 1.25 ? 0.0025 : cash > 3.5e9 && lcr > 2 ? -0.001 : 0.0005;
      actions.push(...setDeposits(state, offset));
    }
    if ((cash < 0.3e9 || lcr < 1.12) && month % 3 === 0) actions.push(seniorRaise(250e6, 36));
    if ((cet1Ratio < Math.max(0.115, cet1Requirement + 0.008) || internalCet1Headroom < 0) && month % 6 === 0) actions.push(cet1Raise(100e6));
    return actions;
  }

  if (strategy === 'growth') {
    actions.push(...setLending(state, { mortgage: 0.006, consumer: 0.012, corporate: 0.009 }, { mortgage: 0.05, consumer: 0.1, corporate: 0.05 }));
    actions.push({ type: 'setCapitalPolicy', dividendPayoutRatio: 0.1, at1CouponMode: 'auto' });
    if (month % 3 === 0) actions.push(...setDeposits(state, 0.0025));
    if ((cash < 1.2e9 || lcr < 1.3) && month % 3 === 0) actions.push(seniorRaise(350e6, 60));
    if (cet1Ratio < Math.max(0.12, cet1Requirement + 0.006) && month % 6 === 0) actions.push(cet1Raise(125e6));
    return actions;
  }

  if (strategy === 'profit') {
    actions.push(...setLending(state, { mortgage: -0.003, consumer: -0.005, corporate: -0.003 }, { mortgage: 0.35, consumer: 0.45, corporate: 0.35 }));
    actions.push({ type: 'setCapitalPolicy', dividendPayoutRatio: 0.35, at1CouponMode: 'auto' });
    if (month % 3 === 0) actions.push(...setDeposits(state, lcr > 1.35 && cash > 1.5e9 ? -0.0015 : 0));
    if (lcr < 1.1 && month % 6 === 0) actions.push(seniorRaise(200e6, 36));
    return actions;
  }

  if (strategy === 'fortress') {
    actions.push(...setLending(state, { mortgage: -0.006, consumer: -0.01, corporate: -0.006 }, { mortgage: 0.8, consumer: 0.85, corporate: 0.8 }));
    actions.push({ type: 'setCapitalPolicy', dividendPayoutRatio: 0, at1CouponMode: 'auto' });
    if (month % 3 === 0) actions.push(...setDeposits(state, 0.004));
    return actions;
  }

  if (strategy === 'capital-markets-reliant') {
    actions.push(...setLending(state, { mortgage: 0.004, consumer: 0.008, corporate: 0.006 }, { mortgage: 0.15, consumer: 0.2, corporate: 0.15 }));
    actions.push({ type: 'setCapitalPolicy', dividendPayoutRatio: 0.35, at1CouponMode: 'auto' });
    if (month % 6 === 0) actions.push(...setDeposits(state, -0.001));
    if (month % 12 === 0) actions.push(seniorRaise(400e6, 60));
    if (month % 18 === 0) actions.push(cet1Raise(125e6));
    if (month % 24 === 6) actions.push(tier2Raise(100e6, 84));
    if (month % 24 === 12) actions.push(at1Raise(75e6));
    return actions;
  }

  if (strategy === 'levered-growth') {
    actions.push(...setLending(state, { mortgage: 0.007, consumer: 0.013, corporate: 0.01 }, { mortgage: 0.02, consumer: 0.08, corporate: 0.02 }));
    actions.push({ type: 'setCapitalPolicy', dividendPayoutRatio: 0.35, at1CouponMode: 'auto' });
    if (month % 3 === 0) actions.push(...setDeposits(state, 0.0015));
    if ((cash < 0.8e9 || lcr < 1.2 || nsfr < 1.08) && month % 3 === 0) actions.push(seniorRaise(400e6, 60));
    if (cet1Ratio < Math.max(0.105, cet1Requirement + 0.002) && month % 3 === 0) actions.push(cet1Raise(150e6));
    return actions;
  }

  const comfortableCapital = internalCet1Headroom > 0.015 && cet1Ratio > Math.max(0.125, cet1Requirement + 0.012);
  const comfortableLiquidity = lcr > 1.35 && nsfr > 1.18 && cash > 1e9;
  actions.push(...setLending(
    state,
    comfortableCapital && comfortableLiquidity
      ? { mortgage: 0.004, consumer: 0.0075, corporate: 0.0055 }
      : { mortgage: 0.001, consumer: 0.002, corporate: 0.0015 },
    comfortableCapital && comfortableLiquidity
      ? { mortgage: 0.12, consumer: 0.22, corporate: 0.12 }
      : { mortgage: 0.4, consumer: 0.5, corporate: 0.4 }
  ));
  actions.push({
    type: 'setCapitalPolicy',
    dividendPayoutRatio: comfortableCapital ? 0.22 : 0.05,
    at1CouponMode: 'auto',
  });
  if (month % 3 === 0) {
    const depositOffset = lcr < 1.3 || cash < 0.8e9 ? 0.003 : lcr > 2.25 && cash > 3.5e9 ? -0.0015 : 0.0005;
    actions.push(...setDeposits(state, depositOffset));
  }
  if ((lcr < 1.18 || nsfr < 1.08 || cash < 0.35e9) && month % 3 === 0) actions.push(seniorRaise(300e6, 60));
  if ((cet1Ratio < Math.max(0.115, cet1Requirement + 0.006) || internalCet1Headroom < 0) && month % 3 === 0) actions.push(cet1Raise(100e6));
  if (state.risk.riskMetrics.totalCapitalRatio < state.risk.riskMetrics.totalCapitalRequirement + 0.01 && month % 6 === 0) actions.push(tier2Raise(75e6, 84));
  return actions;
};

const cloneTargets = (targets: readonly ThreeYearPlanTarget[]): ThreeYearPlanTarget[] => targets.map(target => ({
  ...target,
  milestones: target.milestones.map(milestone => ({ ...milestone })),
}));

export const createTrivialThreeYearPlanTargets = (state: BankState): ThreeYearPlanTarget[] => {
  const defaults = createDefaultThreeYearPlanTargets(state);
  return defaults.map(target => {
    const lower = target.metricId === M.eps || target.metricId === M.rote
      ? -1
      : target.metricId === M.customerLending || target.metricId === M.customerDeposits
        ? Math.max(1, target.baseline * 0.1)
        : 0.01;
    return {
      ...target,
      weight: target.metricId === M.lcr ? 70 : 5,
      milestones: target.milestones.map(milestone => ({ ...milestone, lower })),
    };
  });
};

export const runIntegratedCalibration = (args: {
  strategy: CalibrationStrategyId;
  seed: number;
  horizonMonths?: number;
  planTargets?: 'default' | 'trivial';
}): IntegratedCalibrationRun => {
  const horizonMonths = args.horizonMonths ?? INTEGRATED_CALIBRATION_HORIZON_MONTHS;
  const config = { ...baseConfig, featureFlags: { ...baseConfig.featureFlags, threeYearPlan: true } };
  const engine = createSimulationEngine();
  let state = cloneBankState(initialState);
  state.market.macroModel.rngSeed = args.seed;
  state.threeYearPlan = createDefaultThreeYearPlan(state);
  if (args.planTargets === 'trivial') state.threeYearPlan.targets = createTrivialThreeYearPlanTargets(state);

  const openingLoans = totalLoans(state);
  const openingDeposits = totalDeposits(state);
  const openingSharePrice = state.equityMarket.sharePrice;
  let cumulativeNetIncome = 0;
  let minCet1Ratio = state.risk.riskMetrics.cet1Ratio;
  let minLcr = state.risk.riskMetrics.lcr;
  let minNsfr = state.risk.riskMetrics.nsfr;

  for (let month = 0; month < horizonMonths; month++) {
    const actions: PlayerAction[] = [];
    if (state.threeYearPlan?.enabled && state.threeYearPlan.completed) {
      const targets = args.planTargets === 'trivial'
        ? createTrivialThreeYearPlanTargets(state)
        : createDefaultThreeYearPlanTargets(state);
      actions.push({ type: 'renewThreeYearPlan', targets: cloneTargets(targets) });
    }
    actions.push(...actionsForStrategy(args.strategy, state, month));
    state = engine.step({ state, config, actions, shocks: [] }).nextState;
    cumulativeNetIncome += state.financial.incomeStatement.netIncome;
    minCet1Ratio = Math.min(minCet1Ratio, state.risk.riskMetrics.cet1Ratio);
    minLcr = Math.min(minLcr, state.risk.riskMetrics.lcr);
    minNsfr = Math.min(minNsfr, state.risk.riskMetrics.nsfr);
    if (state.status.hasFailed) break;
  }

  const loans = totalLoans(state);
  const deposits = totalDeposits(state);
  const assets = totalAssets(state);
  const cash = productBalance(state, AssetProductType.CashReserves);
  const gilts = productBalance(state, AssetProductType.Gilts);
  const transactions = state.capitalMarkets?.transactions ?? [];
  const executed = transactions.filter(transaction => transaction.executedAmount > 0);
  const raised = (instrument: 'cet1' | 'at1' | 'tier2' | 'senior') =>
    executed.filter(transaction => transaction.instrument === instrument).reduce((sum, transaction) => sum + transaction.executedAmount, 0);
  const priorCycles = state.threeYearPlan?.priorCycles ?? [];
  const cycle1 = priorCycles.find(cycle => cycle.cycleNumber === 1);
  const completedPlanCycles = priorCycles.length + (state.threeYearPlan?.completed ? 1 : 0);
  const bookValuePerShare = state.equityMarket.bookValuePerShare ?? 0;
  const rote = bookValuePerShare > 0 ? state.equityMarket.epsTtm / bookValuePerShare : 0;

  return {
    strategy: args.strategy,
    seed: args.seed,
    monthsRun: state.time.step - initialState.time.step,
    failed: state.status.hasFailed,
    failureStep: state.status.hasFailed ? state.time.step : undefined,
    cumulativeNetIncome,
    loans,
    deposits,
    loanGrowth: openingLoans > 0 ? loans / openingLoans - 1 : 0,
    depositGrowth: openingDeposits > 0 ? deposits / openingDeposits - 1 : 0,
    cash,
    gilts,
    liquidAssetShare: assets > 0 ? (cash + gilts) / assets : 0,
    loanDepositRatio: deposits > 0 ? loans / deposits : 0,
    cet1Ratio: state.risk.riskMetrics.cet1Ratio,
    leverageRatio: state.risk.riskMetrics.leverageRatio,
    lcr: state.risk.riskMetrics.lcr,
    nsfr: state.risk.riskMetrics.nsfr,
    minCet1Ratio,
    minLcr,
    minNsfr,
    eps: state.equityMarket.epsTtm,
    rote,
    sharePrice: state.equityMarket.sharePrice,
    sharePriceReturn: openingSharePrice > 0 ? state.equityMarket.sharePrice / openingSharePrice - 1 : 0,
    planScore: state.threeYearPlan?.currentEvaluation?.score,
    boardConfidence: state.threeYearPlan?.boardConfidence,
    cycle1Score: cycle1?.finalEvaluation.score,
    cycle1Confidence: cycle1?.finalBoardConfidence,
    completedPlanCycles,
    capitalMarketsAttempts: transactions.length,
    capitalMarketsExecutions: executed.length,
    capitalRaised: executed.reduce((sum, transaction) => sum + transaction.executedAmount, 0),
    cet1Raised: raised('cet1'),
    at1Raised: raised('at1'),
    tier2Raised: raised('tier2'),
    seniorRaised: raised('senior'),
  };
};

const mean = (values: number[]): number => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const meanDefined = (values: Array<number | undefined>): number | undefined => {
  const defined = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return defined.length ? mean(defined) : undefined;
};

export const summarizeIntegratedCalibration = (runs: readonly IntegratedCalibrationRun[]): IntegratedCalibrationSummary[] =>
  INTEGRATED_CALIBRATION_STRATEGIES.map(strategy => {
    const group = runs.filter(run => run.strategy === strategy);
    const confidences = group.map(run => run.boardConfidence).filter((value): value is number => value !== undefined && Number.isFinite(value));
    return {
      strategy,
      runs: group.length,
      survivalRate: group.length ? group.filter(run => !run.failed).length / group.length : 0,
      meanMonthsRun: mean(group.map(run => run.monthsRun)),
      meanCumulativeNetIncome: mean(group.map(run => run.cumulativeNetIncome)),
      meanLoanGrowth: mean(group.map(run => run.loanGrowth)),
      meanDepositGrowth: mean(group.map(run => run.depositGrowth)),
      meanLiquidAssetShare: mean(group.map(run => run.liquidAssetShare)),
      meanLoanDepositRatio: mean(group.map(run => run.loanDepositRatio)),
      meanCet1Ratio: mean(group.map(run => run.cet1Ratio)),
      meanLcr: mean(group.map(run => run.lcr)),
      meanNsfr: mean(group.map(run => run.nsfr)),
      meanEps: mean(group.map(run => run.eps)),
      meanRote: mean(group.map(run => run.rote)),
      meanSharePrice: mean(group.map(run => run.sharePrice)),
      meanSharePriceReturn: mean(group.map(run => run.sharePriceReturn)),
      meanPlanScore: meanDefined(group.map(run => run.planScore)),
      meanBoardConfidence: meanDefined(group.map(run => run.boardConfidence)),
      meanCycle1Score: meanDefined(group.map(run => run.cycle1Score)),
      meanCycle1Confidence: meanDefined(group.map(run => run.cycle1Confidence)),
      meanCapitalRaised: mean(group.map(run => run.capitalRaised)),
      meanCapitalMarketsExecutions: mean(group.map(run => run.capitalMarketsExecutions)),
      confidenceRange: confidences.length ? [Math.min(...confidences), Math.max(...confidences)] : undefined,
    };
  });

export const runIntegratedCalibrationMatrix = (seeds: readonly number[] = INTEGRATED_CALIBRATION_SEEDS): IntegratedCalibrationRun[] =>
  INTEGRATED_CALIBRATION_STRATEGIES.flatMap(strategy => seeds.map(seed => runIntegratedCalibration({ strategy, seed })));
