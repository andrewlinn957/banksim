import { recogniseSecurityImpairment } from './securityImpairment';
import { hedgeFairValue, syncHedgeBalances, revalueHedges } from './hedgeValuation';
import { commitmentEcl } from './impairment';
/**
 * Core simulation step logic.
 *
 * The engine treats the input `BankState` as immutable: it clones the state and mutates the clone
 * through the step pipeline:
 * shocks -> player actions -> behavioural flows -> P&L accrual -> loss recognition -> capital close ->
 * risk metric/compliance evaluation -> statement building -> invariant checks -> market evolution.
 *
 * Most helpers in this file mutate `state` in-place and append human-readable `SimulationEvent`s.
 */
import { BankState, FundingMaturityBucket, InterestRateHedge } from '../domain/bankState';
import { BalanceSheet, BalanceSheetItem } from '../domain/balanceSheet';
import {
  AssetProductType,
  BalanceSheetSide,
  LiabilityProductType,
  ProductType,
} from '../domain/enums';
import { ComplianceStatus, FundingConfidenceState, RiskMetrics } from '../domain/risks';
import { SimulationConfig } from '../domain/config';
import {
  PlayerAction,
  AdjustRateAction,
  BuySellAssetAction,
  IssueDebtAction,
  IssueEquityAction,
  EnterRepoAction,
  SetUnderwritingAction,
  EnterHedgeAction,
  SetCapitalPolicyAction,
} from '../domain/actions';
import {
  Shock,
  MacroDownturnShock,
  DepositCompetitionShock,
  MarketSpreadShock,
  IdiosyncraticRunShock,
  CounterpartyDefaultShock,
  RolloverStressShock,
} from '../domain/shocks';
import { CashFlowStatement } from '../domain/cashflow';
import { Currency, MaturityBucket } from '../domain/enums';
import { PRODUCT_META } from '../domain/productMeta';
import { calculateRiskMetrics, classifyFundingConfidenceState, evaluateCompliance } from './metrics';
import { checkInvariants } from './invariants';
import { cloneBankState } from './clone';
import { advanceUkMarketState } from './ukMarketModel';
import {
  applyExtraPrepayment,
  calculateProvisionTargetFromCohorts,
  stepLoanCohorts,
  syncLoanBalancesFromCohorts,
  upsertOriginationCohort,
} from './loanCohorts';
import { buildStepAttribution } from './attribution';
import { StepAttribution } from '../domain/attribution';
import { applyFeatureFlagsToConfig, resolveFeatureFlags } from './featureFlags';

// Tiny "by-reference" wrapper so shocks can compound multipliers in-place.
type Ref<T> = { value: T };

type Handler<T, C> = (item: T, ctx: C) => void;

type HandlerMap<T extends { type: string }, C> = {
  [K in T['type']]: Handler<Extract<T, { type: K }>, C>;
};

const createDispatcher = <T extends { type: string }, C>(
  handlers: HandlerMap<T, C>,
  onMissing?: (item: T, ctx: C) => void
) => (item: T, ctx: C) => {
  const handler = handlers[item.type] as Handler<T, C> | undefined;
  if (handler) {
    handler(item, ctx);
  } else {
    onMissing?.(item, ctx);
  }
};

/**
 * Applies a single player action.
 *
 * Handlers mutate `state` in-place and push descriptive entries into `events`.
 */
interface ActionContext {
  state: BankState;
  config: SimulationConfig;
  events: SimulationEvent[];
}

export type ActionHandler<T extends PlayerAction = PlayerAction> = Handler<T, ActionContext>;

type ActionHandlerMap = HandlerMap<PlayerAction, ActionContext>;

// Concrete implementations for each `PlayerAction` type.
const actionHandlers: ActionHandlerMap = {
  adjustRate: (action: AdjustRateAction, ctx) => {
    const product = PRODUCT_META[action.productType];
    if (!product?.behaviour?.isLoan && !product?.behaviour?.isCustomerDeposit) { ctx.events.push(createEvent('warning', 'Only customer loan and deposit offer rates can be set directly.')); return; }
    adjustInterestRate(findItem(ctx.state.financial.balanceSheet, action.productType), action.newRate);
    ctx.events.push(createEvent('info', `Adjusted rate for ${action.productType} to ${action.newRate.toFixed(4)}`));
  },
  issueEquity: (action: IssueEquityAction, ctx) => {
    applyIssueEquity(ctx.state, ctx.config, action.amount, ctx.events);
  },
  issueDebt: (action: IssueDebtAction, ctx) => {
    applyIssueDebt(
      ctx.state,
      ctx.config,
      action.productType,
      action.amount,
      action.rate,
      action.maturityMonths,
      ctx.events
    );
  },
  buySellAsset: (action: BuySellAssetAction, ctx) => {
    applyBuySellAsset(ctx.state, ctx.config, action.productType, action.amountDelta, ctx.events);
  },
  enterRepo: (action: EnterRepoAction, ctx) => {
    applyEnterRepo(
      ctx.state,
      ctx.config,
      action.direction,
      action.collateralProduct,
      action.amount,
      action.haircut,
      action.rate ?? ctx.state.market.baseRate,
      ctx.events
    );
  },
  setUnderwriting: (action: SetUnderwritingAction, ctx) => {
    if (!ctx.state.behaviour.underwritingTightness) {
      ctx.state.behaviour.underwritingTightness = {};
    }
    const tightness = clamp(action.tightness, 0, 1);
    ctx.state.behaviour.underwritingTightness[action.productType] = tightness;
    ctx.events.push(
      createEvent(
        'info',
        `Updated underwriting tightness for ${action.productType} to ${(tightness * 100).toFixed(0)}%`
      )
    );
  },
  enterHedge: (action: EnterHedgeAction, ctx) => {
    applyEnterHedge(ctx.state, ctx.config, action, ctx.events);
  },
  setCapitalPolicy: (action: SetCapitalPolicyAction, ctx) => {
    applySetCapitalPolicy(ctx.state, action, ctx.events);
  },
};

// Runtime dispatcher for actions.
const dispatchAction = createDispatcher<PlayerAction, ActionContext>(actionHandlers, (action, ctx) => {
  ctx.events.push(createEvent('warning', `No handler for action type ${(action as PlayerAction).type}`));
});

/**
 * Mutable context shared by all shocks applied in a step.
 *
 * Multipliers are stored as `{ value }` so multiple shocks can compound their effects without
 * needing to return/merge intermediate results.
 *
 * `extraLosses` accumulates one-off losses by product (e.g. counterparty default).
 */
interface ShockContext {
  state: BankState;
  config: SimulationConfig;
  events: SimulationEvent[];
  pdMultiplier: Ref<number>;
  lgdMultiplier: Ref<number>;
  lcrOutflowMultiplier: Ref<number>;
  rolloverAccessMultiplier: Ref<number>;
  rolloverSpreadBps: Ref<number>;
  extraLosses: Partial<Record<ProductType, number>>;
}

export type ShockHandler<S extends Shock = Shock> = Handler<S, ShockContext>;

type ShockHandlerMap = HandlerMap<Shock, ShockContext>;

// Concrete implementations for each `Shock` type.
const shockHandlers: ShockHandlerMap = {
  depositCompetition: (shock: DepositCompetitionShock, ctx: ShockContext) => {
    // Competitor deposit rates move up, making it harder to retain/grow deposits without repricing.
    ctx.state.market.competitorRetailDepositRate += shock.retailRateIncrease;
    if (shock.corporateRateIncrease !== undefined) {
      ctx.state.market.competitorCorporateDepositRate =
        (ctx.state.market.competitorCorporateDepositRate ?? ctx.state.market.competitorRetailDepositRate) +
        shock.corporateRateIncrease;
    }
    ctx.events.push(createEvent('info', `Shock: deposit competition +${shock.retailRateIncrease}`));
  },
  marketSpreadShock: (shock: MarketSpreadShock, ctx: ShockContext) => {
    // Spreads widen: wholesale funding costs rise, loan spreads widen, and repo haircuts increase.
    const delta = shock.wholesaleSpreadBps / 10000;
    ctx.state.market.wholesaleFundingSpread += delta;
    ctx.state.market.seniorDebtSpread += delta;
    ctx.state.market.corporateLoanSpread += shock.loanSpreadBps / 10000;
    ctx.state.market.creditSpread += delta;
    ctx.state.market.giltRepoHaircut += shock.repoHaircutIncreasePct;
    ctx.events.push(createEvent('warning', `Shock: market spread widen +${shock.wholesaleSpreadBps}bps`));
  },
  idiosyncraticRun: (shock: IdiosyncraticRunShock, ctx: ShockContext) => {
    // A run increases LCR outflows and triggers an immediate one-off deposit withdrawal.
    ctx.lcrOutflowMultiplier.value *= shock.outflowRateMultiplier;
    const depositItems = ctx.state.financial.balanceSheet.items.filter(
      (item) => PRODUCT_META[item.productType]?.behaviour?.isCustomerDeposit
    );
    const runParams = ctx.config.shockParameters.idiosyncraticRun;
    const baseRunOff = runParams.baseRunOffRate;
    const incremental = Math.max(0, shock.outflowRateMultiplier - 1) * runParams.incrementalRate;
    const runOffRate = Math.min(runParams.maxRunOffRate, baseRunOff + incremental);
    const requestedByProduct = depositItems.map((item) => ({
      item,
      requested: Math.max(0, item.balance * runOffRate),
    }));
    const totalRequested = requestedByProduct.reduce((sum, entry) => sum + entry.requested, 0);

    const totalPaid = applyCashOutflowOrFail(ctx.state, totalRequested, ctx.events);
    const allocationBase = totalRequested > 0 ? totalRequested : 1;
    requestedByProduct.forEach(({ item, requested }) => {
      const paid = (totalPaid * requested) / allocationBase;
      const boundedPaid = Math.min(item.balance, Math.max(0, paid));
      item.balance -= boundedPaid;
      const label = PRODUCT_META[item.productType]?.label ?? item.productType;
      ctx.events.push(
        createEvent(
          'warning',
          `Idiosyncratic run reduced ${label} by ${boundedPaid.toFixed(2)} (${(runOffRate * 100).toFixed(1)}%)`
        )
      );
      if (boundedPaid + 1e-6 < requested) {
        ctx.events.push(
          createEvent(
            'error',
            `Unmet withdrawal demand for ${label}: ${(requested - boundedPaid).toFixed(2)}`
          )
        );
      }
    });
    ctx.events.push(createEvent('warning', `Shock: idiosyncratic run multiplier ${shock.outflowRateMultiplier}`));
  },
  macroDownturn: (shock: MacroDownturnShock, ctx: ShockContext) => {
    // Macro stress raises default probabilities and loss severities across the loan book.
    ctx.pdMultiplier.value *= shock.pdMultiplier;
    ctx.lgdMultiplier.value *= shock.lgdMultiplier;
    ctx.events.push(createEvent('warning', `Shock: macro downturn PDx${shock.pdMultiplier} LGDx${shock.lgdMultiplier}`));
  },
  counterpartyDefault: (shock: CounterpartyDefaultShock, ctx: ShockContext) => {
    // Records a product-specific one-off loss, recognised later during loss recognition.
    applyCounterpartyDefault(shock, ctx.extraLosses, ctx.events);
  },
  rolloverStress: (shock: RolloverStressShock, ctx: ShockContext) => {
    ctx.rolloverAccessMultiplier.value *= clamp(shock.accessMultiplier, 0, 1.5);
    ctx.rolloverSpreadBps.value += shock.spreadBps;
    ctx.events.push(
      createEvent(
        'warning',
        `Shock: rollover stress access x${shock.accessMultiplier.toFixed(2)}, spread +${shock.spreadBps.toFixed(0)}bps`
      )
    );
  },
};

// Runtime dispatcher for shocks.
const dispatchShock = createDispatcher<Shock, ShockContext>(shockHandlers, (shock, ctx) => {
  ctx.events.push(createEvent('warning', `No handler for shock type ${(shock as Shock).type}`));
});

/**
 * Inputs required to advance the simulation by one time step.
 *
 * `state` is treated as immutable by the engine (it is cloned before mutation).
 */
export interface SimulationStepInput {
  state: BankState;
  config: SimulationConfig;
  actions: PlayerAction[];
  shocks: Shock[];
}

// Used by the UI to present what happened during the step.
export type EventSeverity = 'info' | 'warning' | 'error';

export interface SimulationEvent {
  id: string;
  severity: EventSeverity;
  message: string;
  timestamp: number;
  tags?: string[];
}

/** Helper to create a SimulationEvent with current timestamp */
let eventSequence = 0;
const EVENT_TAG_RULES: Array<{ tag: string; pattern: RegExp }> = [
  { tag: 'capital', pattern: /\bcet1|at1|capital|equity|dividend|coupon|mda|oci\b/i },
  { tag: 'liquidity', pattern: /\blcr|nsfr|hqla|outflow|inflow|liquidity|run\b/i },
  { tag: 'funding', pattern: /\bfunding|rollover|debt|repo|maturity\b/i },
  { tag: 'deposits', pattern: /\bdeposit|withdrawal|churn|franchise\b/i },
  { tag: 'loans', pattern: /\bloan|mortgage|pipeline|underwriting|drawdown|origination\b/i },
  { tag: 'credit', pattern: /\bdefault|pd|lgd|impairment|provision|loss\b/i },
  { tag: 'conduct', pattern: /\bconduct|consumer duty|duty|fine|remediation\b/i },
  { tag: 'income', pattern: /\bp&l|profit|income|expense|cost|tax\b/i },
  { tag: 'market', pattern: /\bspread|rate|curve|macro|shock|gilt\b/i },
  { tag: 'hedges', pattern: /\bhedge|irrbb|duration|eve|nii\b/i },
];

const inferEventTags = (message: string, explicitTags: string[] = []): string[] => {
  const deduped = new Set<string>(explicitTags.map((tag) => tag.toLowerCase()));
  EVENT_TAG_RULES.forEach(({ tag, pattern }) => {
    if (pattern.test(message)) {
      deduped.add(tag);
    }
  });
  return [...deduped];
};

const createEvent = (severity: EventSeverity, message: string, tags: string[] = []): SimulationEvent => {
  const timestamp = Date.now();
  const id = `evt-${timestamp}-${eventSequence++}`;
  return {
    id,
    severity,
    message,
    timestamp,
    tags: inferEventTags(message, tags),
  };
};

export interface SimulationDiagnostics {
  attribution: StepAttribution;
}

export interface SimulationStepOutput {
  nextState: BankState;
  events: SimulationEvent[];
  diagnostics: SimulationDiagnostics;
}

export interface SimulationEngine {
  step(input: SimulationStepInput): SimulationStepOutput;
}

// Time conversion helper (the model uses months for behavioural dynamics, years for rates/PDs).
const MONTHS_IN_YEAR = 12;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const normaliseStepLengthMonths = (raw: number): number => {
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.round(raw));
};

const advanceDateByMonths = (date: Date, months: number): Date => {
  const wholeMonths = Math.max(0, Math.round(months));
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + wholeMonths);
  const daysInMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, daysInMonth));
  return next;
};

const CONFIDENCE_STATE_ORDER: FundingConfidenceState[] = ['strong', 'stable', 'watch', 'stressed'];

const confidenceStateRank = (state: FundingConfidenceState): number => {
  const idx = CONFIDENCE_STATE_ORDER.indexOf(state);
  return idx >= 0 ? idx : 1;
};

const getFundingConfidenceState = (state: BankState): FundingConfidenceState =>
  state.behaviour.fundingConfidenceState ?? 'stable';

interface ConfidenceStateImpactSet {
  state: FundingConfidenceState;
  spreadPenaltyBps: number;
  accessMultiplier: number;
  equityIssuanceMultiplier: number;
  equityIssuanceFeeRate: number;
}

const getConfidenceStateImpact = (state: BankState, config: SimulationConfig): ConfidenceStateImpactSet => {
  const confidenceState = getFundingConfidenceState(state);
  const impactMap = config.behaviour.confidenceStateMachine?.impacts;
  const perState = impactMap?.[confidenceState] ?? impactMap?.stable;
  return {
    state: confidenceState,
    spreadPenaltyBps: perState?.spreadPenaltyBps ?? 0,
    accessMultiplier: clamp(perState?.accessMultiplier ?? 1, 0.1, 1),
    equityIssuanceMultiplier: clamp(perState?.equityIssuanceMultiplier ?? 1, 0, 1),
    equityIssuanceFeeRate: clamp(perState?.equityIssuanceFeeRate ?? 0, 0, 0.5),
  };
};

const xorshiftUnit = (seed: number): number => {
  let x = seed | 0;
  if (x === 0) x = 0x6d2b79f5;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 0x1_0000_0000;
};

// Convenience helper for balance-sheet lookups.
const findItem = (bs: BalanceSheet, productType: ProductType): BalanceSheetItem | undefined =>
  bs.items.find((i) => i.productType === productType);

const ensureLoanPipelineState = (state: BankState, productType: AssetProductType) => {
  if (!state.loanPipelines) {
    state.loanPipelines = {};
  }
  const existing = state.loanPipelines[productType];
  if (existing) {
    return existing;
  }
  const created = { demandNotional: 0, approvedNotional: 0, committedNotional: 0 };
  state.loanPipelines[productType] = created;
  return created;
};

const getTotalEquity = (state: BankState): number =>
  state.financial.capital.cet1 + state.financial.capital.at1 + state.financial.capital.accumulatedOCI;

const getCommonEquity = (state: BankState): number =>
  state.financial.capital.cet1 + state.financial.capital.accumulatedOCI;

const ensureEquityMarketState = (state: BankState, config: SimulationConfig): void => {
  const model = config.behaviour.sharePriceModel;
  const priceFloor = Math.max(1e-4, model?.priceFloor ?? 0.05);
  const epsFloor = model?.epsFloor ?? 0.02;
  const peNeutral = model?.peNeutral ?? 8;
  const peMin = model?.peMin ?? 3;
  const peMax = model?.peMax ?? 16;

  const sharesOutstanding = Math.max(1, state.equityMarket?.sharesOutstanding ?? 1e9);
  const epsTtm = Number.isFinite(state.equityMarket?.epsTtm)
    ? (state.equityMarket?.epsTtm ?? epsFloor)
    : epsFloor;
  const peMultiple = clamp(state.equityMarket?.peMultiple ?? peNeutral, peMin, peMax);
  const fallbackPrice = Math.max(priceFloor, peNeutral * Math.max(epsFloor, epsTtm));
  const sharePrice = Math.max(priceFloor, state.equityMarket?.sharePrice ?? fallbackPrice);
  const marketCap = sharePrice * sharesOutstanding;
  const bookValuePerShare = getCommonEquity(state) / sharesOutstanding;
  const priceToBook = bookValuePerShare > 0 ? sharePrice / bookValuePerShare : 0;

  state.equityMarket = {
    sharesOutstanding,
    sharePrice,
    marketCap,
    epsTtm,
    peMultiple,
    bookValuePerShare,
    priceToBook,
    fairValuePerShare: Math.max(priceFloor, state.equityMarket?.fairValuePerShare ?? sharePrice),
  };
};

/**
 * Applies a cash delta (positive=inflow, negative=outflow).
 *
 * If cash would go negative, the bank is marked as failed.
 */
const adjustCashOrFail = (state: BankState, delta: number, events: SimulationEvent[]): void => {
  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  if (!cash) return;

  cash.balance += delta;
  if (cash.balance >= 0) return;

  const shortfall = -cash.balance;
  // Preserve the cash shortfall for the accounting identity; it ends the game.
  state.status.hasFailed = true;
  events.push(createEvent('error', `Cash balance breached: short by ${shortfall.toFixed(2)} after flow`));
};

/**
 * Applies an explicit cash outflow.
 *
 * Returns the amount actually paid out (capped at available cash).
 *
 * If the requested outflow cannot be met, cash is floored at 0 and the bank is marked as failed.
 */
const applyCashOutflowOrFail = (state: BankState, outflow: number, events: SimulationEvent[]): number => {
  if (outflow <= 0) return 0;
  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  if (!cash) return 0;

  const paid = Math.max(0, Math.min(outflow, cash.balance));
  cash.balance -= paid;
  const shortfall = outflow - paid;
  if (shortfall <= 0) return paid;

  state.status.hasFailed = true;
  events.push(createEvent('error', `Cash balance breached: short by ${shortfall.toFixed(2)} after outflow`));
  return paid;
};

const adjustInterestRate = (item: BalanceSheetItem | undefined, newRate: number): void => {
  if (!item) return;
  item.interestRate = newRate;
};

const applyIssueEquity = (
  state: BankState,
  config: SimulationConfig,
  amount: number,
  events: SimulationEvent[]
): void => {
  ensureEquityMarketState(state, config);
  const requested = Math.max(0, amount);
  if (requested <= 0) return;
  const confidenceImpact = getConfidenceStateImpact(state, config);
  const executable = requested * confidenceImpact.equityIssuanceMultiplier;
  const issuanceFee = executable * confidenceImpact.equityIssuanceFeeRate;
  const netProceeds = Math.max(0, executable - issuanceFee);
  if (netProceeds <= 0) {
    events.push(
      createEvent(
        'warning',
        `Equity issuance failed in ${confidenceImpact.state} confidence state: requested ${requested.toFixed(2)} but no executable proceeds`,
        ['capital', 'funding']
      )
    );
    return;
  }

  // New equity increases CET1 capital and provides fresh cash funding.
  state.financial.capital.cet1 += netProceeds;
  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  if (cash) {
    cash.balance += netProceeds;
  }
  const issuanceDiscount = clamp(config.behaviour.sharePriceModel?.equityIssuanceDiscount ?? 0.1, 0, 0.5);
  const issuePrice = Math.max(
    config.behaviour.sharePriceModel?.priceFloor ?? 0.05,
    state.equityMarket.sharePrice * (1 - issuanceDiscount)
  );
  const issuedShares = executable / Math.max(1e-6, issuePrice);
  state.equityMarket.sharesOutstanding += issuedShares;
  state.equityMarket.marketCap = state.equityMarket.sharePrice * state.equityMarket.sharesOutstanding;

  events.push(
    createEvent(
      'info',
      `Issued equity (${confidenceImpact.state}): requested ${requested.toFixed(2)}, raised ${netProceeds.toFixed(
        2
      )}, issuance costs ${issuanceFee.toFixed(2)}, new shares ${(issuedShares / 1e6).toFixed(2)}m`,
      ['capital', 'funding']
    )
  );
  if (netProceeds + 1e-9 < requested) {
    events.push(
      createEvent(
        'warning',
        `Equity issuance haircut due to confidence state: executable ${(confidenceImpact.equityIssuanceMultiplier * 100).toFixed(0)}%`,
        ['capital', 'funding']
      )
    );
  }
};

// Weighted-average rate when adding to an existing position.
const blendRate = (existingBalance: number, existingRate: number, newAmount: number, newRate: number): number => {
  if (existingBalance + newAmount === 0) return newRate;
  return (existingBalance * existingRate + newAmount * newRate) / (existingBalance + newAmount);
};

type FundingProduct =
  | LiabilityProductType.WholesaleFundingST
  | LiabilityProductType.WholesaleFundingLT;

const FUNDING_PRODUCTS: FundingProduct[] = [
  LiabilityProductType.WholesaleFundingST,
  LiabilityProductType.WholesaleFundingLT,
];

const getFundingLineLabel = (productType: FundingProduct): string =>
  productType === LiabilityProductType.WholesaleFundingST ? 'Wholesale Funding ST' : 'Wholesale Funding LT';

const getDefaultRefinanceTenorMonths = (
  config: SimulationConfig,
  productType: FundingProduct,
  maturityOverride?: number
): number => {
  const configured =
    productType === LiabilityProductType.WholesaleFundingST
      ? config.behaviour.fundingLadder?.stRefinanceTenorMonths
      : config.behaviour.fundingLadder?.ltRefinanceTenorMonths;
  const raw = maturityOverride ?? configured ?? (productType === LiabilityProductType.WholesaleFundingST ? 6 : 36);
  if (!Number.isFinite(raw)) {
    return productType === LiabilityProductType.WholesaleFundingST ? 6 : 36;
  }
  return Math.max(1, Math.round(raw));
};

const getFundingLadderBuckets = (state: BankState, productType: FundingProduct): FundingMaturityBucket[] => {
  if (!state.fundingLadders) {
    state.fundingLadders = {};
  }
  const existing = state.fundingLadders[productType];
  if (existing) return existing;
  const created: FundingMaturityBucket[] = [];
  state.fundingLadders[productType] = created;
  return created;
};

const sumFundingNotional = (buckets: FundingMaturityBucket[]): number =>
  buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);

const weightedFundingRateFromBuckets = (buckets: FundingMaturityBucket[], fallbackRate: number): number => {
  const total = sumFundingNotional(buckets);
  if (total <= 0) return fallbackRate;
  const weighted = buckets.reduce(
    (sum, bucket) => sum + Math.max(0, bucket.notional) * Math.max(0, bucket.rate),
    0
  );
  return weighted / total;
};

const addFundingBucket = (
  state: BankState,
  productType: FundingProduct,
  notional: number,
  rate: number,
  tenorMonths: number
): void => {
  if (notional <= 0) return;
  const buckets = getFundingLadderBuckets(state, productType);
  const tenor = Math.max(1, Math.round(tenorMonths));
  buckets.push({
    tenorMonths: tenor,
    monthsToMaturity: tenor,
    notional: Math.max(0, notional),
    rate: Math.max(0, rate),
  });
};

const syncFundingLineFromLadder = (
  state: BankState,
  config: SimulationConfig,
  productType: FundingProduct
): void => {
  const buckets = getFundingLadderBuckets(state, productType);
  const line = ensureLineItem(
    state,
    BalanceSheetSide.Liability,
    productType,
    getFundingLineLabel(productType),
    productType === LiabilityProductType.WholesaleFundingST
      ? state.market.riskFreeShort + state.market.wholesaleFundingSpread
      : state.market.riskFreeLong + state.market.seniorDebtSpread,
    config
  );
  line.balance = sumFundingNotional(buckets);
  line.interestRate = weightedFundingRateFromBuckets(buckets, line.interestRate);
};

const ensureFundingLadderCoverage = (
  state: BankState,
  config: SimulationConfig,
  productType: FundingProduct
): void => {
  const line = ensureLineItem(
    state,
    BalanceSheetSide.Liability,
    productType,
    getFundingLineLabel(productType),
    productType === LiabilityProductType.WholesaleFundingST
      ? state.market.riskFreeShort + state.market.wholesaleFundingSpread
      : state.market.riskFreeLong + state.market.seniorDebtSpread,
    config
  );
  const buckets = getFundingLadderBuckets(state, productType);
  const tenor = getDefaultRefinanceTenorMonths(config, productType);
  if (buckets.length === 0 && line.balance > 0) {
    addFundingBucket(state, productType, line.balance, line.interestRate, tenor);
    syncFundingLineFromLadder(state, config, productType);
    return;
  }

  const ladderTotal = sumFundingNotional(buckets);
  const gap = line.balance - ladderTotal;
  if (gap > 1e-6) {
    addFundingBucket(state, productType, gap, line.interestRate, tenor);
  } else if (gap < -1e-6 && ladderTotal > 0) {
    const scale = Math.max(0, line.balance / ladderTotal);
    buckets.forEach((bucket) => {
      bucket.notional = Math.max(0, bucket.notional * scale);
    });
  }

  syncFundingLineFromLadder(state, config, productType);
};

const ensureFundingLadders = (state: BankState, config: SimulationConfig): void => {
  FUNDING_PRODUCTS.forEach((productType) => ensureFundingLadderCoverage(state, config, productType));
};

const applyIssueDebt = (
  state: BankState,
  config: SimulationConfig,
  productType: FundingProduct,
  amount: number,
  rateOverride: number | undefined,
  maturityMonths: number | undefined,
  events: SimulationEvent[]
): void => {
  const requestedAmount = Math.max(0, amount);
  if (requestedAmount <= 0) return;
  ensureFundingLadders(state, config);
  const confidenceImpact = getConfidenceStateImpact(state, config);
  const issuedAmount = requestedAmount * confidenceImpact.accessMultiplier;
  if (issuedAmount <= 0) {
    events.push(
      createEvent(
        'warning',
        `Debt issuance blocked in ${confidenceImpact.state} confidence state: requested ${requestedAmount.toFixed(2)} but no executable size`,
        ['funding', 'capital']
      )
    );
    return;
  }

  // Issue unsecured wholesale funding. Pricing defaults to market risk-free + spread unless overridden.
  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  if (!cash) return;
  const explicitRate =
    rateOverride !== undefined && Number.isFinite(rateOverride) ? Math.max(0, rateOverride) : undefined;
  const pricingRateBase =
    explicitRate ??
    (productType === LiabilityProductType.WholesaleFundingST
      ? state.market.riskFreeShort + state.market.wholesaleFundingSpread
      : state.market.riskFreeLong + state.market.seniorDebtSpread);
  // Respect explicit deal pricing override; only apply endogenous confidence penalty on model-default pricing.
  const confidenceSpreadPenalty = explicitRate === undefined ? confidenceImpact.spreadPenaltyBps / 10000 : 0;
  const pricingRate = Math.max(0, pricingRateBase + confidenceSpreadPenalty);
  const tenorMonths = getDefaultRefinanceTenorMonths(config, productType, maturityMonths);

  addFundingBucket(state, productType, issuedAmount, pricingRate, tenorMonths);
  syncFundingLineFromLadder(state, config, productType);
  cash.balance += issuedAmount;
  const line = findItem(state.financial.balanceSheet, productType);
  events.push(
    createEvent(
      'info',
      `Issued debt ${productType} (${confidenceImpact.state}): requested ${requestedAmount.toFixed(
        2
      )}, executed ${issuedAmount.toFixed(2)} at ${pricingRate.toFixed(4)} for ${tenorMonths}m (blended ${line?.interestRate.toFixed(4) ?? pricingRate.toFixed(4)})`
    )
  );
  if (issuedAmount + 1e-9 < requestedAmount) {
    events.push(
      createEvent(
        'warning',
        `Debt issuance clipped by market confidence: access ${(confidenceImpact.accessMultiplier * 100).toFixed(0)}%`,
        ['funding']
      )
    );
  }
};

const applyEnterHedge = (
  state: BankState,
  config: SimulationConfig,
  action: EnterHedgeAction,
  events: SimulationEvent[]
): void => {
  const notional = Math.max(0, action.notional);
  if (notional <= 0) return;
  const maturityMonths = Math.max(1, Math.round(action.maturityMonths ?? 24));
  const fixedRate = Math.max(0, action.fixedRate);
  const nextIndex = (state.financial.hedges?.length ?? 0) + 1;
  const hedge: InterestRateHedge = {
    id: `hedge-${state.time.step}-${nextIndex}`,
    direction: action.direction,
    notional,
    fixedRate,
    maturityMonths,
    monthsRemaining: maturityMonths,
  };
  if (!state.financial.hedges) {
    state.financial.hedges = [];
  }
  // Off-market fixed rates require fair-value upfront payment, not a free asset.
  hedge.fairValue = hedgeFairValue(hedge, state.market.riskFreeShort);
  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  if (!cash || hedge.fairValue > cash.balance) { events.push(createEvent('warning', 'Hedge rejected: insufficient cash for its fair-value upfront payment.')); return; }
  cash.balance -= hedge.fairValue;
  state.financial.hedges.push(hedge);
  syncHedgeBalances(state, config);
  const carrySpread = Math.max(0, Math.abs(config.behaviour.irrbb?.hedgeCarrySpread ?? 0));
  events.push(
    createEvent(
      'info',
      `Entered hedge ${hedge.id}: ${hedge.direction}, ${notional.toFixed(2)} notional @ ${fixedRate.toFixed(4)} for ${maturityMonths}m (carry spread ${carrySpread.toFixed(4)})`
    )
  );
};

const applySetCapitalPolicy = (
  state: BankState,
  action: SetCapitalPolicyAction,
  events: SimulationEvent[]
): void => {
  if (!state.behaviour.capitalPolicy) {
    state.behaviour.capitalPolicy = {
      dividendPayoutRatio: 0,
      at1CouponMode: 'auto',
    };
  }
  const payout = clamp(action.dividendPayoutRatio, 0, 1);
  const mode = action.at1CouponMode ?? state.behaviour.capitalPolicy.at1CouponMode ?? 'auto';
  state.behaviour.capitalPolicy.dividendPayoutRatio = payout;
  state.behaviour.capitalPolicy.at1CouponMode = mode;
  events.push(
    createEvent(
      'info',
      `Capital policy updated: payout ${(payout * 100).toFixed(0)}%, AT1 coupon mode ${mode}`
    )
  );
};

const stepHedges = (
  state: BankState,
  config: SimulationConfig,
  dtMonths: number,
  dtYears: number,
  events: SimulationEvent[]
): number => {
  const hedges = state.financial.hedges ?? [];
  if (hedges.length === 0 || dtMonths <= 0 || dtYears <= 0) return 0;

  const floatRate = state.market.riskFreeShort;
  const carrySpread = Math.max(0, Math.abs(config.behaviour.irrbb?.hedgeCarrySpread ?? 0));
  let carry = 0;
  const active: InterestRateHedge[] = [];

  hedges.forEach((hedge) => {
    const signedRateDiff =
      hedge.direction === 'payFixedReceiveFloat'
        ? floatRate - hedge.fixedRate
        : hedge.fixedRate - floatRate;
    carry += hedge.notional * (signedRateDiff - carrySpread) * dtYears;

    const nextMonths = hedge.monthsRemaining - dtMonths;
    if (nextMonths > 0) {
      active.push({
        ...hedge,
        monthsRemaining: nextMonths,
      });
      return;
    }

    events.push(createEvent('info', `Hedge matured: ${hedge.id}`));
  });

  state.financial.hedges = active;
  return carry;
};

const applyBuySellAsset = (
  state: BankState,
  config: SimulationConfig,
  productType: AssetProductType,
  amountDelta: number,
  events: SimulationEvent[]
): void => {
  // Simple asset purchase/sale at par value (no mark-to-market).
  const asset = findItem(state.financial.balanceSheet, productType);
  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  if (!asset || !cash) return;

  if (PRODUCT_META[productType]?.behaviour?.isLoan) {
    const params = config.productParameters[productType];
    if (amountDelta >= 0) {
      const requested = amountDelta;
      const executed = upsertOriginationCohort({
        state,
        config,
        productType,
        cohortId: state.time.step,
        principal: requested,
        annualInterestRate: asset.interestRate,
        annualPd: params.baseDefaultRate,
        lgd: params.lossGivenDefault,
      });
      if (executed + 1e-6 < requested) {
        events.push(createEvent('warning', `Insufficient cash to buy ${productType}: requested ${requested.toFixed(2)}, executed ${executed.toFixed(2)}`));
      }
      events.push(createEvent('info', `Bought ${productType}: +${executed.toFixed(2)}, cash -${executed.toFixed(2)}`));
    } else {
      const requested = Math.abs(amountDelta);
      const executed = applyExtraPrepayment({ state, productType, amount: requested });
      events.push(createEvent('info', `Sold ${productType}: -${executed.toFixed(2)}, cash +${executed.toFixed(2)}`));
    }
    return;
  }
  if (productType === AssetProductType.DerivativeAssets) { events.push(createEvent('warning', 'Manage derivatives through hedge trades.')); return; }
  if (amountDelta >= 0) {
    // buying asset
    const buyAmount = Math.min(amountDelta, Math.max(0, cash.balance));
    if (asset.security) asset.security.amortisedCost = (asset.security.amortisedCost ?? asset.balance) + buyAmount;
    asset.balance += buyAmount;
    cash.balance -= buyAmount;
    if (buyAmount < amountDelta) {
      events.push(
        createEvent(
          'warning',
          `Insufficient cash to buy ${productType}: requested ${amountDelta.toFixed(2)}, executed ${buyAmount.toFixed(2)}`
        )
      );
    }
    events.push(
      createEvent('info', `Bought ${productType}: +${buyAmount.toFixed(2)}, cash -${buyAmount.toFixed(2)}`)
    );
  } else {
    const sellAmount = Math.min(Math.max(0, asset.balance - (asset.encumbrance?.encumberedAmount ?? 0)), Math.abs(amountDelta));
    if (asset.security && asset.balance > 0) {
      const security = asset.security, fraction = sellAmount / asset.balance;
      const cost = security.amortisedCost ?? asset.balance;
      if (security.classification === 'FVOCI') security.pendingRecycling = (security.pendingRecycling ?? 0) + (asset.balance - cost + (security.lossAllowance ?? 0)) * fraction;
      security.amortisedCost = cost * (1-fraction);
      security.lossAllowance = (security.lossAllowance ?? 0) * (1-fraction);
    }
    asset.balance -= sellAmount;
    adjustCashOrFail(state, sellAmount, events);
    events.push(
      createEvent('info', `Sold ${productType}: -${sellAmount.toFixed(2)}, cash +${sellAmount.toFixed(2)}`)
    );
  }
};

/**
 * Ensures a balance-sheet line exists for a product type.
 *
 * Used for actions that create positions not present in the initial balance sheet (e.g. repo,
 * wholesale funding). Liquidity metadata is sourced from the simulation config.
 */
const ensureLineItem = (
  state: BankState,
  side: BalanceSheetSide,
  productType: ProductType,
  label: string,
  rate: number,
  config: SimulationConfig
): BalanceSheetItem => {
  const existing = findItem(state.financial.balanceSheet, productType);
  if (existing) return existing;
  const newItem: BalanceSheetItem = {
    side,
    productType,
    label,
    currency: Currency.GBP,
    balance: 0,
    interestRate: rate,
    maturityBucket: MaturityBucket.LessThan1Y,
    liquidityTag: config.liquidityTags[productType],
    encumbrance: { encumberedAmount: 0 },
    security: config.behaviour.securitiesAccounting?.defaultClassificationByProduct?.[productType]
      ? {
          classification:
            config.behaviour.securitiesAccounting.defaultClassificationByProduct[productType] ?? 'FVOCI',
          effectiveDurationYears:
            config.behaviour.securitiesAccounting.effectiveDurationYearsByProduct?.[productType] ?? 0,
          valuationReferenceYield: state.market.riskFreeLong,
        }
      : undefined,
  };
  state.financial.balanceSheet.items.push(newItem);
  return newItem;
};

const applyRepoBorrow = (
  state: BankState,
  config: SimulationConfig,
  collateralProduct: AssetProductType,
  amount: number,
  haircut: number | undefined,
  rate: number,
  events: SimulationEvent[]
): void => {
  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  if (!cash) return;

  const collateral = findItem(state.financial.balanceSheet, collateralProduct);
  const effectiveHaircut = clamp(haircut ?? 0, 0, 1);
  const collateralRequirement = effectiveHaircut < 1 ? 1 / (1 - effectiveHaircut) : Infinity;
  const availableCollateral = collateral
    ? Math.max(0, collateral.balance - (collateral.encumbrance?.encumberedAmount ?? 0))
    : 0;
  const maxBorrow = collateralRequirement > 0 ? availableCollateral / collateralRequirement : 0;
  const borrowAmount = Math.min(amount, maxBorrow);

  if (borrowAmount <= 0) {
    events.push(
      createEvent('warning', `Repo borrow failed: insufficient unencumbered ${collateralProduct}`)
    );
    return;
  }

  const funding = ensureLineItem(
    state,
    BalanceSheetSide.Liability,
    LiabilityProductType.RepurchaseAgreements,
    'Repo Borrowing',
    rate,
    config
  );
  funding.interestRate = blendRate(funding.balance, funding.interestRate, borrowAmount, rate);
  funding.balance += borrowAmount;
  cash.balance += borrowAmount;
  if (collateral) {
    const encumbered = Math.min(collateral.balance, borrowAmount * collateralRequirement);
    if (!collateral.encumbrance) {
      collateral.encumbrance = { encumberedAmount: 0 };
    }
    collateral.encumbrance.remainingMonths = 1;
    collateral.encumbrance.encumberedAmount = clamp(
      (collateral.encumbrance.encumberedAmount ?? 0) + encumbered,
      0,
      collateral.balance
    );
  }
  const partial = borrowAmount + 1e-9 < amount;
  const amountText = partial
    ? `+${borrowAmount.toFixed(2)} funding (requested ${amount.toFixed(2)})`
    : `+${borrowAmount.toFixed(2)} funding`;
  events.push(createEvent('info', `Repo borrow: ${amountText}, collateral ${collateralProduct} encumbered`));
};

const applyRepoLend = (
  state: BankState,
  config: SimulationConfig,
  amount: number,
  rate: number,
  events: SimulationEvent[]
): void => {
  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  if (!cash) return;

  const reverseRepo = ensureLineItem(
    state,
    BalanceSheetSide.Asset,
    AssetProductType.ReverseRepo,
    'Reverse Repo',
    rate,
    config
  );
  const lendAmount = Math.min(Math.max(0, cash.balance), amount);
  reverseRepo.interestRate = blendRate(reverseRepo.balance, reverseRepo.interestRate, lendAmount, rate);
  reverseRepo.balance += lendAmount;
  cash.balance -= lendAmount;
  events.push(createEvent('info', `Repo lend: -${lendAmount.toFixed(2)} cash, +reverse repo asset`));
};

const applyEnterRepo = (
  state: BankState,
  config: SimulationConfig,
  direction: 'borrow' | 'lend',
  collateralProduct: AssetProductType,
  amount: number,
  haircut: number | undefined,
  rate: number,
  events: SimulationEvent[]
): void => {
  // Repo "borrow" = raise cash secured on collateral (creates a repo liability and encumbers assets).
  // Repo "lend"   = deploy cash into reverse repo (creates an asset).
  if (direction === 'borrow') {
    applyRepoBorrow(state, config, collateralProduct, amount, haircut, rate, events);
    return;
  }
  applyRepoLend(state, config, amount, rate, events);
};

const applyCounterpartyDefault = (
  shock: CounterpartyDefaultShock,
  extraLosses: Partial<Record<ProductType, number>>,
  events: SimulationEvent[]
): void => {
  // Accumulate losses so multiple defaults in a step add up.
  const existing = extraLosses[shock.productType] ?? 0;
  const loss = Math.max(0, shock.lossAmount);
  extraLosses[shock.productType] = existing + loss;
  events.push(
    createEvent('warning', `Counterparty default on ${shock.productType}: loss ${loss.toFixed(2)}`)
  );
};

export interface SecuritiesValuationResult {
  fvtplValuationImpact: number;
  fvociOciMovement: number;
  nonCashAdjustmentsByProduct: Partial<Record<ProductType, number>>;
}

const referenceSecurityYield = (state: BankState, item: BalanceSheetItem): number => {
  if (item.productType === AssetProductType.Gilts) return state.market.riskFreeLong;
  return state.market.riskFreeLong + state.market.creditSpread;
};

export const applySecuritiesValuation = (
  state: BankState,
  config: SimulationConfig,
  events: SimulationEvent[]
): SecuritiesValuationResult => {
  const result: SecuritiesValuationResult = {
    fvtplValuationImpact: 0,
    fvociOciMovement: 0,
    nonCashAdjustmentsByProduct: {},
  };
  const durationFallback = config.behaviour.securitiesAccounting?.effectiveDurationYearsByProduct ?? {};

  state.financial.balanceSheet.items
    .filter((item) => item.side === BalanceSheetSide.Asset && item.security !== undefined)
    .forEach((item) => {
      const security = item.security;
      if (!security) return;
      security.amortisedCost ??= item.balance;
      security.pendingRecycling = 0;

      const previousYield =
        Number.isFinite(security.valuationReferenceYield) && security.valuationReferenceYield > 0
          ? security.valuationReferenceYield
          : referenceSecurityYield(state, item);
      const currentYield = referenceSecurityYield(state, item);
      const duration = Math.max(
        0,
        security.effectiveDurationYears ??
          durationFallback[item.productType] ??
          0
      );
      const yieldDelta = currentYield - previousYield;
      const rawFairValueChange = -duration * yieldDelta * Math.max(0, item.balance);
      const nextBalance = Math.max(0, item.balance + rawFairValueChange);
      const recognizedFairValueChange = nextBalance - item.balance;

      if (security.classification === 'HTM') {
        security.valuationReferenceYield = currentYield;
        if (Math.abs(rawFairValueChange) > 1e-6) {
          events.push(
            createEvent(
              'info',
              `${item.label} (${security.classification}) latent fair value move ${rawFairValueChange.toFixed(2)}`
            )
          );
        }
        return;
      }

      item.balance = nextBalance;
      security.valuationReferenceYield = currentYield;
      if (security.classification === 'FVTPL') {
        result.fvtplValuationImpact += recognizedFairValueChange;
      } else if (security.classification === 'FVOCI') {
        result.fvociOciMovement += recognizedFairValueChange;
      }
      result.nonCashAdjustmentsByProduct[item.productType] =
        (result.nonCashAdjustmentsByProduct[item.productType] ?? 0) - recognizedFairValueChange;

      if (Math.abs(recognizedFairValueChange) > 1e-6) {
        events.push(
          createEvent(
            'info',
            `${item.label} (${security.classification}) fair value move ${recognizedFairValueChange.toFixed(2)}`
          )
        );
      }
    });

  return result;
};

export interface ShockApplicationResult {
  pdMultiplier: number;
  lgdMultiplier: number;
  lcrOutflowMultiplier: number;
  rolloverAccessMultiplier: number;
  rolloverSpreadBps: number;
  extraLosses: Partial<Record<ProductType, number>>;
}

/**
 * Applies a set of exogenous shocks to the state.
 *
 * Shocks can:
 * - move market prices/spreads,
 * - change risk multipliers (PD/LGD, LCR outflows),
 * - record one-off losses to be recognised later.
 */
export const applyShocks = (
  state: BankState,
  config: SimulationConfig,
  shocks: Shock[],
  events: SimulationEvent[]
): ShockApplicationResult => {
  const extraLosses: Partial<Record<ProductType, number>> = {};

  const pdMultiplier: Ref<number> = { value: 1 };
  const lgdMultiplier: Ref<number> = { value: 1 };
  const lcrOutflowMultiplier: Ref<number> = { value: 1 };
  const rolloverAccessMultiplier: Ref<number> = { value: 1 };
  const rolloverSpreadBps: Ref<number> = { value: 0 };

  const shockContext: ShockContext = {
    state,
    config,
    events,
    pdMultiplier,
    lgdMultiplier,
    lcrOutflowMultiplier,
    rolloverAccessMultiplier,
    rolloverSpreadBps,
    extraLosses,
  };

  shocks.forEach((shock) => dispatchShock(shock, shockContext));

  return {
    pdMultiplier: pdMultiplier.value,
    lgdMultiplier: lgdMultiplier.value,
    lcrOutflowMultiplier: lcrOutflowMultiplier.value,
    rolloverAccessMultiplier: rolloverAccessMultiplier.value,
    rolloverSpreadBps: rolloverSpreadBps.value,
    extraLosses,
  };
};

/**
 * Applies player actions after shocks.
 *
 * This is where the user actively manages the balance sheet (repricing, funding, asset trades).
 */
export const applyActions = (
  state: BankState,
  config: SimulationConfig,
  actions: PlayerAction[],
  events: SimulationEvent[]
): void => {
  ensureFundingLadders(state, config);
  const actionContext: ActionContext = { state, config, events };
  actions.forEach(action => {
    if (Object.values(action).some(v => typeof v === 'number' && !Number.isFinite(v)) || ('amount' in action && action.amount < 0) || ('notional' in action && action.notional < 0)) {
      events.push(createEvent('warning', 'Invalid transaction amount or rate. Action rejected.'));
      return;
    }
    if (action.type === 'enterRepo' && (action.collateralProduct !== AssetProductType.Gilts || (action.maturityMonths !== undefined && action.maturityMonths !== 1))) {
      events.push(createEvent('warning', 'This portfolio supports rolling one-month gilt repos only. Unsupported collateral or tenor rejected.'));
      return;
    }
    dispatchAction(action, actionContext);
  });
};

export interface FundingLifecycleResult {
  maturingNotional: number;
  refinancedNotional: number;
  shortfallNotional: number;
  weightedRefinanceRate: number;
  effectiveAccess: number;
}

export const stepFundingLadders = (
  state: BankState,
  config: SimulationConfig,
  dtMonths: number,
  shockEffects: Pick<ShockApplicationResult, 'rolloverAccessMultiplier' | 'rolloverSpreadBps'>,
  events: SimulationEvent[]
): FundingLifecycleResult => {
  ensureFundingLadders(state, config);

  const params = config.behaviour.fundingLadder;
  const rolloverAccessBase = params?.rolloverAccessBase ?? 0.95;
  const rolloverAccessMin = params?.rolloverAccessMin ?? 0.45;
  const spreadSensitivity = params?.spreadSensitivity ?? 0;
  const liquidityStressPenalty = params?.liquidityStressPenalty ?? 0;
  const franchiseSpreadSensitivity = params?.franchiseSpreadSensitivity ?? 0;
  const capitalSpreadSensitivity = params?.capitalSpreadSensitivity ?? 0;
  const confidenceSpreadSensitivity = params?.confidenceSpreadSensitivity ?? 0;
  const accessCliffMidpoint = params?.accessCliffMidpoint ?? 0.4;
  const accessCliffSlope = Math.max(0.1, params?.accessCliffSlope ?? 6.5);
  const accessFloorMultiplier = clamp(params?.accessFloorMultiplier ?? 0.55, 0.1, 1);
  const confidenceImpact = getConfidenceStateImpact(state, config);

  let maturingNotional = 0;
  let refinancedNotional = 0;
  let shortfallNotional = 0;
  let weightedRefinanceRateNumerator = 0;
  let weightedAccessNumerator = 0;

  FUNDING_PRODUCTS.forEach((productType) => {
    const buckets = getFundingLadderBuckets(state, productType);
    const surviving: FundingMaturityBucket[] = [];
    let productMaturing = 0;

    buckets.forEach((bucket) => {
      const nextMonths = bucket.monthsToMaturity - dtMonths;
      if (nextMonths <= 0) {
        productMaturing += Math.max(0, bucket.notional);
        return;
      }
      surviving.push({
        ...bucket,
        monthsToMaturity: nextMonths,
      });
    });
    state.fundingLadders[productType] = surviving;

    if (productMaturing <= 0) {
      syncFundingLineFromLadder(state, config, productType);
      return;
    }

    maturingNotional += productMaturing;

    const baseSpread =
      productType === LiabilityProductType.WholesaleFundingST
        ? state.market.wholesaleFundingSpread
        : state.market.seniorDebtSpread;
    const marketPenalty = Math.max(0, baseSpread) * spreadSensitivity;
    const liquidityPenalty =
      state.risk.riskMetrics.lcr < 1 ? liquidityStressPenalty * Math.max(0, 1 - state.risk.riskMetrics.lcr) : 0;
    const franchisePenalty = Math.max(0, 0.8 - clamp(state.behaviour.depositFranchiseStrength, 0, 1));
    const capitalPenalty = Math.max(0, config.riskLimits.minCet1Ratio - state.risk.riskMetrics.cet1Ratio);
    const confidenceStress =
      (state.risk.riskMetrics.fundingStressIndex ?? 0) +
      franchisePenalty +
      Math.max(0, 1 - (state.risk.riskMetrics.depositQualityIndex ?? 1)) +
      capitalPenalty * 8;
    const endogenousSpreadPenalty =
      franchisePenalty * franchiseSpreadSensitivity +
      capitalPenalty * capitalSpreadSensitivity +
      confidenceStress * confidenceSpreadSensitivity;
    const stressedAccess = rolloverAccessBase * clamp(shockEffects.rolloverAccessMultiplier, 0, 2);
    const preCliffAccess = clamp(
      stressedAccess - marketPenalty - liquidityPenalty - confidenceStress * (liquidityStressPenalty * 0.4),
      rolloverAccessMin,
      1
    );
    const cliffMultiplier = 1 / (1 + Math.exp(accessCliffSlope * (confidenceStress - accessCliffMidpoint)));
    const accessFloor = rolloverAccessMin * accessFloorMultiplier;
    const confidenceAdjustedAccess =
      (preCliffAccess * cliffMultiplier + accessFloor * (1 - cliffMultiplier)) * confidenceImpact.accessMultiplier;
    const confidenceAccessFloor = accessFloor * confidenceImpact.accessMultiplier;
    const access = clamp(confidenceAdjustedAccess, confidenceAccessFloor, 1);

    const refinanced = productMaturing * access;
    const shortfall = productMaturing - refinanced;
    refinancedNotional += refinanced;
    shortfallNotional += shortfall;
    weightedAccessNumerator += productMaturing * access;

    if (refinanced > 0) {
      const riskFree =
        productType === LiabilityProductType.WholesaleFundingST
          ? state.market.riskFreeShort
          : state.market.riskFreeLong;
      const spreadPenalty = Math.max(0, 1 - access) * 0.005;
      const stressedSpread = Math.max(0, shockEffects.rolloverSpreadBps / 10000);
      const confidenceSpreadPenalty = confidenceImpact.spreadPenaltyBps / 10000;
      const refinanceRate = Math.max(
        0,
        riskFree + baseSpread + stressedSpread + spreadPenalty + endogenousSpreadPenalty + confidenceSpreadPenalty
      );
      const tenorMonths = getDefaultRefinanceTenorMonths(config, productType);
      addFundingBucket(state, productType, refinanced, refinanceRate, tenorMonths);
      weightedRefinanceRateNumerator += refinanced * refinanceRate;
      adjustCashOrFail(state, refinanced, events);
      if (productType === LiabilityProductType.WholesaleFundingST) {
        state.market.wholesaleFundingSpread = Math.max(0, state.market.wholesaleFundingSpread + endogenousSpreadPenalty * 0.35);
      } else {
        state.market.seniorDebtSpread = Math.max(0, state.market.seniorDebtSpread + endogenousSpreadPenalty * 0.35);
      }
    }

    const paid = applyCashOutflowOrFail(state, productMaturing, events);
    const unpaid = Math.max(0, productMaturing - paid);
    if (unpaid > 0) {
      const overdueRate = Math.max(0, (productType === LiabilityProductType.WholesaleFundingST
        ? state.market.riskFreeShort
        : state.market.riskFreeLong) + baseSpread + 0.05);
      addFundingBucket(state, productType, unpaid, overdueRate, 1);
      events.push(
        createEvent('error', `${productType} maturity payment shortfall ${unpaid.toFixed(2)} (rolled as overdue)`)
      );
    }

    if (refinanced > 0) {
      events.push(
        createEvent(
          'warning',
          `${productType} rollover: matured ${productMaturing.toFixed(2)}, refinanced ${refinanced.toFixed(
            2
          )}, paid ${paid.toFixed(2)}, shortfall ${shortfall.toFixed(2)}, confidence stress ${confidenceStress.toFixed(
            2
          )}, state ${confidenceImpact.state}`,
          ['funding']
        )
      );
    } else {
      events.push(createEvent('warning', `${productType} rollover failed: matured ${productMaturing.toFixed(2)}, no market access`));
    }

    syncFundingLineFromLadder(state, config, productType);
  });

  const weightedRefinanceRate =
    refinancedNotional > 0 ? weightedRefinanceRateNumerator / refinancedNotional : 0;
  const effectiveAccess = maturingNotional > 0 ? weightedAccessNumerator / maturingNotional : 1;
  return {
    maturingNotional,
    refinancedNotional,
    shortfallNotional,
    weightedRefinanceRate,
    effectiveAccess,
  };
};

const RETAIL_DEPOSIT_PRODUCTS: LiabilityProductType[] = [
  LiabilityProductType.RetailTransactionalDeposits,
  LiabilityProductType.RetailSavingsDeposits,
];

const CORPORATE_DEPOSIT_PRODUCTS: LiabilityProductType[] = [
  LiabilityProductType.CorporateOperatingDeposits,
  LiabilityProductType.CorporateNonOperatingDeposits,
];

const weightedOfferedRate = (state: BankState, products: LiabilityProductType[]): number => {
  const rows = state.financial.balanceSheet.items.filter((item) =>
    products.includes(item.productType as LiabilityProductType)
  );
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.balance), 0);
  if (total <= 0) return 0;
  return rows.reduce((sum, row) => sum + Math.max(0, row.balance) * row.interestRate, 0) / total;
};

const stepCompetitorReaction = (
  state: BankState,
  config: SimulationConfig,
  dtMonths: number,
  events: SimulationEvent[]
): void => {
  if (dtMonths <= 0) return;
  const metrics = state.risk.riskMetrics;
  const global = config.global;

  const stressIndex =
    Math.max(0, 1 - Math.min(1, metrics.lcr)) +
    Math.max(0, 1 - Math.min(1, metrics.nsfr)) +
    Math.max(0, 1 - (metrics.fundingConfidenceScore ?? 1)) +
    Math.max(0, 0.8 - state.behaviour.depositFranchiseStrength);
  const stressBoost = 1 + stressIndex * Math.max(0, global.competitorReactionStressBoost ?? 0.9);
  const meanReversion = clamp((global.competitorReactionMeanReversion ?? 0.03) * dtMonths, 0, 1);

  const retailTarget = weightedOfferedRate(state, RETAIL_DEPOSIT_PRODUCTS);
  const corporateTarget = weightedOfferedRate(state, CORPORATE_DEPOSIT_PRODUCTS);
  const mortgageTarget =
    findItem(state.financial.balanceSheet, AssetProductType.Mortgages)?.interestRate ??
    state.market.competitorMortgageRate;
  const corporateLoanRate =
    findItem(state.financial.balanceSheet, AssetProductType.CorporateLoans)?.interestRate ??
    (state.market.riskFreeLong + state.market.corporateLoanSpread);
  const corporateSpreadTarget = Math.max(0, corporateLoanRate - state.market.riskFreeLong);

  const retailAnchor = clamp(state.market.baseRate * 0.42, 0, 0.2);
  const corporateAnchor = clamp(retailAnchor + 0.004, 0, 0.2);
  const mortgageAnchor = clamp(state.market.riskFreeLong + state.market.mortgageSpread, 0, 0.25);
  const corporateSpreadAnchor = clamp(state.market.creditSpread + 0.012, 0.003, 0.2);

  const update = (current: number, target: number, speed: number, anchor: number): number => {
    const reaction = clamp(speed * dtMonths * stressBoost, 0, 1);
    const reacted = current + reaction * (target - current);
    return clamp(reacted + meanReversion * (anchor - reacted), 0, 0.4);
  };

  const oldRetail = state.market.competitorRetailDepositRate;
  const oldCorporate =
    state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate;
  const oldMortgage = state.market.competitorMortgageRate;
  const oldCorporateSpread = state.market.corporateLoanSpread;

  state.market.competitorRetailDepositRate = update(
    oldRetail,
    retailTarget,
    global.competitorDepositReactionSpeed ?? 0.12,
    retailAnchor
  );
  state.market.competitorCorporateDepositRate = update(
    oldCorporate,
    corporateTarget,
    global.competitorCorporateDepositReactionSpeed ?? 0.16,
    corporateAnchor
  );
  state.market.competitorMortgageRate = update(
    oldMortgage,
    mortgageTarget,
    global.competitorMortgageReactionSpeed ?? 0.08,
    mortgageAnchor
  );
  state.market.corporateLoanSpread = update(
    oldCorporateSpread,
    corporateSpreadTarget,
    global.competitorCorporateLoanSpreadReactionSpeed ?? 0.1,
    corporateSpreadAnchor
  );

  const maxChange = Math.max(
    Math.abs(state.market.competitorRetailDepositRate - oldRetail),
    Math.abs((state.market.competitorCorporateDepositRate ?? oldCorporate) - oldCorporate),
    Math.abs(state.market.competitorMortgageRate - oldMortgage),
    Math.abs(state.market.corporateLoanSpread - oldCorporateSpread)
  );
  const catchUp =
    Math.abs(retailTarget - state.market.competitorRetailDepositRate) <
      Math.abs(retailTarget - oldRetail) ||
    Math.abs(corporateTarget - (state.market.competitorCorporateDepositRate ?? oldCorporate)) <
      Math.abs(corporateTarget - oldCorporate) ||
    Math.abs(mortgageTarget - state.market.competitorMortgageRate) <
      Math.abs(mortgageTarget - oldMortgage) ||
    Math.abs(corporateSpreadTarget - state.market.corporateLoanSpread) <
      Math.abs(corporateSpreadTarget - oldCorporateSpread);
  if (maxChange >= 1e-4) {
    events.push(
      createEvent(
        'info',
        `${catchUp ? 'Market catches up: ' : ''}competitor reaction retail dep ${oldRetail.toFixed(4)}->${state.market.competitorRetailDepositRate.toFixed(4)}, mortgage ${oldMortgage.toFixed(4)}->${state.market.competitorMortgageRate.toFixed(4)}`
      )
    );
  }
};

const stepFundingConfidenceState = (
  state: BankState,
  config: SimulationConfig,
  metrics: RiskMetrics,
  events: SimulationEvent[]
): void => {
  if (!config.behaviour.confidenceStateMachine) return;

  const current = getFundingConfidenceState(state);
  const target = classifyFundingConfidenceState({
    fundingConfidenceScore: metrics.fundingConfidenceScore,
    lcr: metrics.lcr,
    nsfr: metrics.nsfr,
    cet1Headroom: metrics.cet1Headroom,
    config,
  });
  const currentRank = confidenceStateRank(current);
  const targetRank = confidenceStateRank(target);
  const requiredUpgradeMonths = Math.max(
    1,
    Math.round(config.behaviour.confidenceStateMachine?.upgradeSustainMonths ?? 3)
  );
  const progress = Math.max(0, Math.round(state.behaviour.confidenceUpgradeProgressMonths ?? 0));

  let nextState = current;
  let nextProgress = progress;

  if (targetRank > currentRank) {
    // Downgrades are immediate and stepwise.
    nextState = CONFIDENCE_STATE_ORDER[Math.min(currentRank + 1, targetRank)];
    nextProgress = 0;
  } else if (targetRank < currentRank) {
    // Upgrades require sustained improvement for several months.
    nextProgress = progress + 1;
    if (nextProgress >= requiredUpgradeMonths) {
      nextState = CONFIDENCE_STATE_ORDER[Math.max(currentRank - 1, targetRank)];
      nextProgress = 0;
    }
  } else {
    nextProgress = 0;
  }

  state.behaviour.fundingConfidenceState = nextState;
  state.behaviour.confidenceUpgradeProgressMonths = nextProgress;
  const notchMap: Record<FundingConfidenceState, number> = {
    strong: -1,
    stable: 0,
    watch: 1,
    stressed: 2,
  };
  state.behaviour.ratingNotchOffset = notchMap[nextState];

  if (nextState !== current) {
    const severity: EventSeverity =
      confidenceStateRank(nextState) > confidenceStateRank(current) ? 'warning' : 'info';
    events.push(
      createEvent(
        severity,
        `Market confidence state moved ${current} -> ${nextState} (score ${(metrics.fundingConfidenceScore * 100).toFixed(
          0
        )}%, LCR ${(metrics.lcr * 100).toFixed(0)}%, NSFR ${(metrics.nsfr * 100).toFixed(0)}%)`,
        ['funding', 'capital']
      )
    );
  }
};

interface ConductRiskStepResult {
  conductCosts: number;
  eventProbability: number;
  eventTriggered: boolean;
  scoreBefore: number;
  scoreAfter: number;
  pricingSeverity: number;
}

const stepConductRisk = (
  state: BankState,
  config: SimulationConfig,
  dtMonths: number,
  events: SimulationEvent[]
): ConductRiskStepResult => {
  const params = config.behaviour.conductRisk;
  const scoreBefore = clamp(state.behaviour.conductRiskScore ?? 0, 0, 2);
  if (!params || dtMonths <= 0) {
    state.behaviour.conductRiskScore = scoreBefore;
    return {
      conductCosts: 0,
      eventProbability: 0,
      eventTriggered: false,
      scoreBefore,
      scoreAfter: scoreBefore,
      pricingSeverity: 0,
    };
  }

  const depositThreshold = Math.max(1e-4, params.depositUnderpricingThreshold);
  const lendingThreshold = Math.max(1e-4, params.lendingOverpricingThreshold);

  const retailOffered = weightedOfferedRate(state, RETAIL_DEPOSIT_PRODUCTS);
  const corporateOffered = weightedOfferedRate(state, CORPORATE_DEPOSIT_PRODUCTS);
  const corporateCompetitor =
    state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate;

  const retailDepositSeverity = Math.max(0, state.market.competitorRetailDepositRate - retailOffered - depositThreshold) /
    depositThreshold;
  const corporateDepositSeverity = Math.max(0, corporateCompetitor - corporateOffered - depositThreshold) /
    depositThreshold;
  const depositSeverity = (retailDepositSeverity + corporateDepositSeverity) / 2;

  const mortgageRate = findItem(state.financial.balanceSheet, AssetProductType.Mortgages)?.interestRate ?? 0;
  const corporateLoanRate =
    findItem(state.financial.balanceSheet, AssetProductType.CorporateLoans)?.interestRate ??
    (state.market.riskFreeLong + state.market.corporateLoanSpread);
  const mortgageSeverity = Math.max(0, mortgageRate - state.market.competitorMortgageRate - lendingThreshold) /
    lendingThreshold;
  const corporateSeverity = Math.max(
    0,
    corporateLoanRate - (state.market.riskFreeLong + state.market.corporateLoanSpread) - lendingThreshold
  ) / lendingThreshold;
  const lendingSeverity = (mortgageSeverity + corporateSeverity) / 2;

  const avgUnderwritingTightness =
    ((state.behaviour.underwritingTightness?.[AssetProductType.Mortgages] ?? 0) +
      (state.behaviour.underwritingTightness?.[AssetProductType.CorporateLoans] ?? 0)) /
    2;
  const underwritingLooseness = clamp(1 - avgUnderwritingTightness, 0, 1);
  const pricingSeverityRaw =
    Math.max(0, params.depositWeight) * depositSeverity + Math.max(0, params.lendingWeight) * lendingSeverity;
  const pricingSeverity = pricingSeverityRaw * (1 + Math.max(0, params.underwritingAmplifier) * underwritingLooseness);

  const build = Math.max(0, params.scoreBuildRate) * pricingSeverity * dtMonths;
  const decay = Math.max(0, params.scoreDecayRate) * dtMonths * (1 + Math.max(0, 1 - pricingSeverity));
  const scoreAfter = clamp(scoreBefore + build - decay, 0, 2);
  state.behaviour.conductRiskScore = scoreAfter;

  const cooldownBefore = Math.max(0, state.behaviour.conductEventCooldownMonths ?? 0);
  const cooldownAfter = Math.max(0, cooldownBefore - dtMonths);
  state.behaviour.conductEventCooldownMonths = cooldownAfter;

  const eventProbabilityRaw =
    Math.max(0, params.eventProbabilityBase) + Math.max(0, params.eventProbabilitySlope) * scoreAfter;
  const eventProbability = clamp(eventProbabilityRaw * dtMonths, 0, Math.max(0, params.eventProbabilityCap));

  const drawSeed =
    ((state.market.macroModel.rngSeed >>> 0) ^
      ((Math.floor(state.time.step * 2654435761) >>> 0) + Math.floor(scoreAfter * 1e6))) >>>
    0;
  const draw = xorshiftUnit(drawSeed);
  const eventTriggered = cooldownAfter <= 0 && draw < eventProbability;

  let conductCosts = 0;
  if (eventTriggered) {
    const rwa = Math.max(0, state.risk.riskMetrics.rwa);
    const mortgageBal = Math.max(0, findItem(state.financial.balanceSheet, AssetProductType.Mortgages)?.balance ?? 0);
    const corporateBal = Math.max(0, findItem(state.financial.balanceSheet, AssetProductType.CorporateLoans)?.balance ?? 0);
    const monthlyIncomeProxy =
      (mortgageBal * Math.max(0, mortgageRate) + corporateBal * Math.max(0, corporateLoanRate)) /
      Math.max(1, MONTHS_IN_YEAR);
    const fine = Math.max(Math.max(0, params.minEventCost), rwa * Math.max(0, params.fineRateOnRwa));
    const remediation = Math.max(0, params.remediationRateOnIncome) * Math.max(0, monthlyIncomeProxy);
    conductCosts = fine + remediation;

    const stressAmplifier = 1 + scoreAfter * 0.2;
    state.behaviour.depositFranchiseStrength = clamp(
      state.behaviour.depositFranchiseStrength - Math.max(0, params.franchiseHit) * stressAmplifier,
      0,
      1
    );
    state.behaviour.reputation = clamp(
      state.behaviour.reputation - Math.max(0, params.reputationHit) * stressAmplifier,
      0,
      1
    );
    state.behaviour.conductEventCooldownMonths = Math.max(0, params.eventCooldownMonths);
    state.behaviour.conductEventCount = Math.max(0, state.behaviour.conductEventCount ?? 0) + 1;
    state.behaviour.cumulativeConductCosts =
      Math.max(0, state.behaviour.cumulativeConductCosts ?? 0) + conductCosts;

    events.push(
      createEvent(
        'warning',
        `Conduct event triggered: score ${scoreAfter.toFixed(2)}, fine ${fine.toFixed(2)}, remediation ${remediation.toFixed(
          2
        )}, franchise ${(state.behaviour.depositFranchiseStrength * 100).toFixed(1)}%`,
        ['conduct', 'deposits', 'capital']
      )
    );
  } else if (scoreAfter >= 0.8 && scoreBefore < 0.8) {
    events.push(
      createEvent(
        'warning',
        `Conduct risk elevated: score ${scoreAfter.toFixed(2)}, event probability ${(eventProbability * 100).toFixed(
          1
        )}%`,
        ['conduct']
      )
    );
  }

  return {
    conductCosts,
    eventProbability,
    eventTriggered,
    scoreBefore,
    scoreAfter,
    pricingSeverity,
  };
};

const applyDepositMixMigration = (
  state: BankState,
  config: SimulationConfig,
  dtMonths: number,
  events: SimulationEvent[]
): void => {
  const segments: Array<{
    name: string;
    stable: LiabilityProductType;
    unstable: LiabilityProductType;
    competitorRate: number;
  }> = [
    {
      name: 'retail',
      stable: LiabilityProductType.RetailSavingsDeposits,
      unstable: LiabilityProductType.RetailTransactionalDeposits,
      competitorRate: state.market.competitorRetailDepositRate,
    },
    {
      name: 'corporate',
      stable: LiabilityProductType.CorporateOperatingDeposits,
      unstable: LiabilityProductType.CorporateNonOperatingDeposits,
      competitorRate:
        state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate,
    },
  ];

  segments.forEach((segment) => {
    const stableItem = findItem(state.financial.balanceSheet, segment.stable);
    const unstableItem = findItem(state.financial.balanceSheet, segment.unstable);
    if (!stableItem || !unstableItem) return;

    const offered =
      (stableItem.interestRate * Math.max(0, stableItem.balance) +
        unstableItem.interestRate * Math.max(0, unstableItem.balance)) /
      Math.max(1, Math.max(0, stableItem.balance) + Math.max(0, unstableItem.balance));
    const pressure = Math.max(0, segment.competitorRate - offered);
    if (pressure <= 0) return;

    const underpricingMonths =
      ((state.behaviour.depositUnderpricingMonths?.[segment.stable] ?? 0) +
        (state.behaviour.depositUnderpricingMonths?.[segment.unstable] ?? 0)) /
      2;
    const params = config.behaviour.depositByProduct?.[segment.stable];
    const migrationRate = params?.mixMigrationRate ?? 0.05;
    const durationSensitivity = params?.mixMigrationDurationSensitivity ?? 0.08;
    const shiftShare = clamp(
      migrationRate * pressure * (1 + durationSensitivity * underpricingMonths) * dtMonths,
      0,
      0.25
    );
    const amount = Math.max(0, stableItem.balance) * shiftShare;
    if (amount <= 0) return;

    stableItem.balance = Math.max(0, stableItem.balance - amount);
    unstableItem.balance += amount;

    if (!state.behaviour.depositStabilityIndex) {
      state.behaviour.depositStabilityIndex = {};
    }
    const stableIndex = state.behaviour.depositStabilityIndex[segment.stable] ?? 1;
    const unstableIndex = state.behaviour.depositStabilityIndex[segment.unstable] ?? 1;
    state.behaviour.depositStabilityIndex[segment.stable] = clamp(stableIndex - shiftShare * 0.15, 0.45, 1.05);
    state.behaviour.depositStabilityIndex[segment.unstable] = clamp(
      unstableIndex - shiftShare * 0.25,
      0.45,
      1.05
    );

    events.push(
      createEvent(
        'warning',
        `Deposit mix migration (${segment.name}): shifted ${amount.toFixed(2)} from stable to less-stable balances`
      )
    );
  });
};

export const applyDepositBehaviour = (
  state: BankState,
  config: SimulationConfig,
  dtMonths: number,
  events: SimulationEvent[]
): void => {
  if (!state.behaviour.depositRateLagMemory) {
    state.behaviour.depositRateLagMemory = {};
  }
  if (!state.behaviour.depositUnderpricingMonths) {
    state.behaviour.depositUnderpricingMonths = {};
  }
  if (!state.behaviour.depositStabilityIndex) {
    state.behaviour.depositStabilityIndex = {};
  }

  let franchiseDelta = 0;

  const depositItems = state.financial.balanceSheet.items
    .filter(
      (i) =>
        PRODUCT_META[i.productType]?.behaviour?.affectsBehaviouralDepositFlow &&
        PRODUCT_META[i.productType]?.behaviour?.isCustomerDeposit
    );
  // Franchise is one bank-wide index. Weight by opening balances so adding a
  // product line cannot multiply the speed of reputation damage or recovery.
  const totalOpeningDeposits = depositItems.reduce((sum, item) => sum + Math.max(0, item.balance), 0);
  depositItems.forEach((item) => {
      const meta = PRODUCT_META[item.productType];
      const byProduct = config.behaviour.depositByProduct?.[item.productType];
      const competitor =
        meta.behaviour.depositSegment === 'corporate'
          ? state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate
          : state.market.competitorRetailDepositRate;
      const passThroughLag = clamp(byProduct?.passThroughLag ?? 1, 0, 1);
      const laggedRateBefore = state.behaviour.depositRateLagMemory?.[item.productType] ?? item.interestRate;
      const laggedRate = laggedRateBefore + passThroughLag * (item.interestRate - laggedRateBefore);
      state.behaviour.depositRateLagMemory![item.productType] = laggedRate;

      const rel = laggedRate - competitor;
      const rateGap = Math.max(0, competitor - laggedRate);
      const underpricingBefore = state.behaviour.depositUnderpricingMonths?.[item.productType] ?? 0;
      const underpricingMonths =
        rateGap > 1e-9 ? underpricingBefore + dtMonths : Math.max(0, underpricingBefore - dtMonths * 0.5);
      state.behaviour.depositUnderpricingMonths![item.productType] = underpricingMonths;
      const policyGap = state.market.baseRate - competitor;
      const elasticity = config.productParameters[item.productType].volumeElasticityToRate;
      const baselineGrowth = byProduct?.baselineGrowthMonthly ?? config.behaviour.depositBaselineGrowthMonthly;
      const baseChurn = byProduct?.baseChurnMonthly ?? 0;
      const policyBeta = byProduct?.policyRateBeta ?? 0;
      const competitorSensitivity = byProduct?.competitorSensitivity ?? elasticity;
      const durationMultiplier = 1 + (byProduct?.underpricingDurationSensitivity ?? 0.08) * underpricingMonths;
      const convexPenalty = (byProduct?.underpricingConvexity ?? 18) * rateGap * rateGap * durationMultiplier;
      const reacquisitionDrag =
        1 -
        Math.max(0, 1 - clamp(state.behaviour.depositFranchiseStrength, 0, 1)) * (byProduct?.reacquisitionDrag ?? 0.35);

      let g = baselineGrowth - baseChurn + policyBeta * policyGap + competitorSensitivity * rel - convexPenalty;
      if (g > 0) {
        g *= clamp(reacquisitionDrag, 0.25, 1);
      }
      g = clamp(g, config.behaviour.minDepositGrowthPerStep, config.global.maxDepositGrowthPerStep);
      const growthFactor = Math.max(0, 1 + g * dtMonths);
      const before = item.balance;
      const desiredBalance = before * growthFactor;
      const desiredDelta = desiredBalance - before;
      if (desiredDelta >= 0) {
        item.balance = desiredBalance;
        adjustCashOrFail(state, desiredDelta, events);
      } else {
        const requestedOutflow = -desiredDelta;
        const paidOutflow = applyCashOutflowOrFail(state, requestedOutflow, events);
        item.balance = before - paidOutflow;
        if (paidOutflow < requestedOutflow) {
          events.push(
            createEvent(
              'error',
              `Unmet deposit withdrawal demand for ${meta.label}: ${(requestedOutflow - paidOutflow).toFixed(2)}`
            )
          );
        }
      }

      const stabilityBefore = state.behaviour.depositStabilityIndex?.[item.productType] ?? 1;
      const stabilityDecay = (byProduct?.stabilityDecayRate ?? 0.5) * rateGap * durationMultiplier * dtMonths;
      const stabilityRecovery =
        (byProduct?.stabilityRecoveryRate ?? 0.05) * Math.max(0, laggedRate - competitor) * dtMonths;
      state.behaviour.depositStabilityIndex![item.productType] = clamp(
        stabilityBefore - stabilityDecay + stabilityRecovery,
        0.45,
        1.05
      );

      franchiseDelta += (totalOpeningDeposits > 0 ? Math.max(0, before) / totalOpeningDeposits : 0) * (
        -1 * (byProduct?.franchiseDecayRate ?? 0.5) * rateGap * durationMultiplier * dtMonths +
        (byProduct?.franchiseRecoveryRate ?? 0.03) * Math.max(0, laggedRate - competitor) * dtMonths);

      events.push(
        createEvent(
          'info',
          `Behaviour: ${meta.label} growth ${(growthFactor - 1).toFixed(4)} this step (lagged rate ${laggedRate.toFixed(
            4
          )}, underpricing ${underpricingMonths.toFixed(1)}m)`
        )
      );
    });

  applyDepositMixMigration(state, config, dtMonths, events);
  const franchiseBefore = state.behaviour.depositFranchiseStrength;
  state.behaviour.depositFranchiseStrength = clamp(franchiseBefore + franchiseDelta, 0, 1);
  if (Math.abs(state.behaviour.depositFranchiseStrength - franchiseBefore) >= 0.002) {
    events.push(
      createEvent(
        'warning',
        `Deposit franchise moved ${franchiseBefore.toFixed(3)} -> ${state.behaviour.depositFranchiseStrength.toFixed(3)}`
      )
    );
  }
};

export interface LoanBehaviourResult {
  demandNotional: number;
  approvedNotional: number;
  requestedDrawdown: number;
  originatedNotional: number;
  cancelledNotional: number;
  selectionPressureNotional: number;
  selectionPressureIndex: number;
}

interface AdverseSelectionResult {
  annualPd: number;
  multiplier: number;
  ratePremium: number;
}

const calculateOriginationAdverseSelection = (args: {
  baseAnnualPd: number;
  offeredRate: number;
  benchmarkRate: number;
  adverseSelectionRatePremiumThreshold?: number;
  adverseSelectionPdSlope?: number;
  adverseSelectionMaxMultiplier?: number;
  underwritingTightness?: number;
  underwritingInteractionWeight?: number;
}): AdverseSelectionResult => {
  const baseAnnualPd = clamp(args.baseAnnualPd, 0, 0.999999);
  const ratePremium = Math.max(0, args.offeredRate - args.benchmarkRate);
  const threshold = Math.max(0, args.adverseSelectionRatePremiumThreshold ?? 0.005);
  const slope = Math.max(0, args.adverseSelectionPdSlope ?? 15);
  const maxMultiplier = Math.max(1, args.adverseSelectionMaxMultiplier ?? 2.5);
  const effectivePremium = Math.max(0, ratePremium - threshold);
  const baseMultiplier = 1 + slope * effectivePremium;
  const looseUnderwriting = 1 - clamp(args.underwritingTightness ?? 0, 0, 1);
  const interactionBoost =
    1 + Math.max(0, args.underwritingInteractionWeight ?? 1) * effectivePremium * 10 * looseUnderwriting;
  const multiplier = clamp(baseMultiplier * interactionBoost, 1, maxMultiplier);
  return {
    annualPd: clamp(baseAnnualPd * multiplier, 0, 0.999999),
    multiplier,
    ratePremium,
  };
};

export const applyLoanBehaviour = (
  state: BankState,
  config: SimulationConfig,
  dtMonths: number,
  events: SimulationEvent[]
): LoanBehaviourResult => {
  const result: LoanBehaviourResult = {
    demandNotional: 0,
    approvedNotional: 0,
    requestedDrawdown: 0,
    originatedNotional: 0,
    cancelledNotional: 0,
    selectionPressureNotional: 0,
    selectionPressureIndex: 0,
  };
  const loanBaselineGrowth = config.behaviour.loanBaselineGrowthMonthly;

  state.financial.balanceSheet.items
    .filter(
      (i) =>
        PRODUCT_META[i.productType]?.behaviour?.affectsBehaviouralLoanFlow &&
        PRODUCT_META[i.productType]?.behaviour?.isLoan
    )
    .forEach((item) => {
      const productType = item.productType as AssetProductType;
      const meta = PRODUCT_META[item.productType];
      const benchmark =
        meta.behaviour.loanBenchmark === 'mortgage'
          ? state.market.competitorMortgageRate
          : state.market.riskFreeLong + state.market.corporateLoanSpread;
      const rel = item.interestRate - benchmark;
      const pricingGap = benchmark - item.interestRate;
      const elasticity = config.productParameters[item.productType].volumeElasticityToRate;
      const params = config.productParameters[item.productType];
      const underwritingTightness = clamp(state.behaviour.underwritingTightness?.[productType] ?? 0, 0, 1);
      const adverseSelection = calculateOriginationAdverseSelection({
        baseAnnualPd: params.baseDefaultRate,
        offeredRate: item.interestRate,
        benchmarkRate: benchmark,
        adverseSelectionRatePremiumThreshold: params.adverseSelectionRatePremiumThreshold,
        adverseSelectionPdSlope: params.adverseSelectionPdSlope,
        adverseSelectionMaxMultiplier: params.adverseSelectionMaxMultiplier,
        underwritingTightness,
        underwritingInteractionWeight:
          config.behaviour.creditRiskDynamics?.adverseSelection?.underwritingInteractionWeight,
      });
      const pipelineParams = config.behaviour.loanPipelineByProduct?.[productType];

      if (pipelineParams) {
        const pipeline = ensureLoanPipelineState(state, productType);
        const macroSignal =
          state.market.gdpGrowthMoM -
          0.6 * Math.max(0, state.market.unemploymentRate - 0.05) -
          0.4 * Math.max(0, state.market.creditSpread - 0.01);
        const demandScalar = Math.max(
          0,
          1 + pipelineParams.pricingSensitivity * pricingGap + pipelineParams.macroSensitivity * macroSignal
        );
        const demand = Math.max(0, item.balance) * pipelineParams.baseDemandRateMonthly * dtMonths * demandScalar;

        const approvalRate = clamp(
          pipelineParams.baseApprovalRate +
            0.2 * pricingGap -
            pipelineParams.underwritingSensitivity * underwritingTightness,
          0,
          1
        );
        const approved = demand * approvalRate;

        const cancelled = pipeline.committedNotional * clamp(pipelineParams.cancellationRateMonthly * dtMonths, 0, 1);
        const committedAfterCancellation = Math.max(0, pipeline.committedNotional - cancelled);
        const availableToDraw = committedAfterCancellation + approved;
        const requestedDrawdown = availableToDraw * clamp(pipelineParams.drawdownRateMonthly * dtMonths, 0, 1);
        const availableCash = Math.max(
          0,
          findItem(state.financial.balanceSheet, AssetProductType.CashReserves)?.balance ?? 0
        );
        const cashBoundedRequest = Math.min(requestedDrawdown, availableCash);
        const originated = upsertOriginationCohort({
          state,
          config,
          productType,
          cohortId: state.time.step,
          principal: cashBoundedRequest,
          annualInterestRate: item.interestRate,
          annualPd: adverseSelection.annualPd,
          lgd: params.lossGivenDefault,
        });

        pipeline.demandNotional = demand;
        pipeline.approvedNotional = approved;
        pipeline.committedNotional = Math.max(0, availableToDraw - originated);

        result.demandNotional += demand;
        result.approvedNotional += approved;
        result.requestedDrawdown += requestedDrawdown;
        result.originatedNotional += originated;
        result.cancelledNotional += cancelled;
        result.selectionPressureNotional +=
          originated * Math.max(0, adverseSelection.multiplier - 1);

        if (originated + 1e-6 < cashBoundedRequest) {
          events.push(
            createEvent(
              'warning',
              `Pipeline drawdown constrained for ${meta.label}: requested ${cashBoundedRequest.toFixed(2)}, executed ${originated.toFixed(2)}`
            )
          );
        }
        if (originated > 0 && adverseSelection.multiplier > 1 + 1e-9) {
          events.push(
            createEvent(
              'warning',
              `Adverse selection ${meta.label}: pricing premium ${(adverseSelection.ratePremium * 10000).toFixed(0)}bps and underwriting ${(underwritingTightness * 100).toFixed(0)}% drive PD x${adverseSelection.multiplier.toFixed(2)} on new originations`
            )
          );
        }

        events.push(
          createEvent(
            'info',
            `Pipeline ${meta.label}: demand ${demand.toFixed(2)}, approved ${approved.toFixed(2)}, drawdown ${originated.toFixed(2)}, committed ${pipeline.committedNotional.toFixed(2)}`
          )
        );
        return;
      }

      // Fallback to legacy direct balance growth if no pipeline parameters are configured.
      let g = loanBaselineGrowth + elasticity * rel;
      g = clamp(g, config.behaviour.minLoanGrowthPerStep, config.global.maxLoanGrowthPerStep);
      const growthFactor = Math.max(0, 1 + g * dtMonths);
      const before = item.balance;
      const desiredBalance = before * growthFactor;
      const delta = desiredBalance - before;

      if (delta > 0) {
        const availableCash = Math.max(
          0,
          findItem(state.financial.balanceSheet, AssetProductType.CashReserves)?.balance ?? 0
        );
        const requested = Math.min(delta, availableCash);
        const executed = upsertOriginationCohort({
          state,
          config,
          productType,
          cohortId: state.time.step,
          principal: requested,
          annualInterestRate: item.interestRate,
          annualPd: adverseSelection.annualPd,
          lgd: params.lossGivenDefault,
        });
        result.originatedNotional += executed;
        result.selectionPressureNotional +=
          executed * Math.max(0, adverseSelection.multiplier - 1);
        if (executed + 1e-6 < requested) {
          events.push(
            createEvent(
              'warning',
              `Insufficient cash to originate ${meta.label}: requested ${requested.toFixed(2)}, executed ${executed.toFixed(2)}`
            )
          );
        }
        if (executed > 0 && adverseSelection.multiplier > 1 + 1e-9) {
          events.push(
            createEvent(
              'warning',
              `Adverse selection ${meta.label}: pricing premium ${(adverseSelection.ratePremium * 10000).toFixed(0)}bps and underwriting ${(underwritingTightness * 100).toFixed(0)}% drive PD x${adverseSelection.multiplier.toFixed(2)} on new originations`
            )
          );
        }
      } else if (delta < 0) {
        applyExtraPrepayment({ state, productType: item.productType, amount: Math.abs(delta) });
      }
      events.push(
        createEvent('info', `Behaviour: ${meta.label} growth ${(growthFactor - 1).toFixed(4)} this step`)
      );
    });

  result.selectionPressureIndex =
    result.originatedNotional > 0 ? result.selectionPressureNotional / result.originatedNotional : 0;
  const selectionPressureEventThreshold =
    config.behaviour.creditRiskDynamics?.adverseSelection?.selectionPressureEventThreshold ?? 0.03;
  if (result.selectionPressureIndex >= selectionPressureEventThreshold) {
    events.push(
      createEvent(
        'warning',
        `Selection pressure elevated: ${result.selectionPressureIndex.toFixed(3)} excess PD load on new production`,
        ['loans', 'credit']
      )
    );
  }

  return result;
};

export interface PnLAccrualResult {
  assets: BalanceSheetItem[];
  liabilities: BalanceSheetItem[];
  interestIncome: number;
  interestExpense: number;
}

/**
 * Accrues interest income/expense for the period using simple interest.
 *
 * This is a deliberately simplified P&L model: there is no compounding, amortisation,
 * payment timing, or mark-to-market.
 */
export const accruePnL = (state: BankState, dtYears: number): PnLAccrualResult => {
  const assets = state.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset);
  const liabilities = state.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Liability);
  const interestIncome = assets
    .filter((a) => !PRODUCT_META[a.productType]?.behaviour?.isLoan)
    .reduce((sum, a) => sum + (a.security?.amortisedCost ?? a.balance) * a.interestRate * dtYears, 0);
  const interestExpense = liabilities.reduce((sum, l) => sum + l.balance * l.interestRate * dtYears, 0);

  return { assets, liabilities, interestIncome, interestExpense };
};

export interface LossRecognitionResult {
  loanItems: BalanceSheetItem[];
  recognizedLoanLosses: Partial<Record<ProductType, number>>;
  recognizedNonLoanLosses: Partial<Record<ProductType, number>>;
  realizedLoanLosses: number;
  realizedNonLoanLosses: number;
  openingProvisionStock: number;
  provisionCharge: number;
  creditLosses: number;
}

/**
 * Recognises credit/non-credit losses and writes them down against asset balances.
 *
 * For loans, losses are an expected-loss approximation:
 * - Convert annual PD to a period PD using a survival model.
 * - Multiply by LGD.
 * - Add any one-off losses recorded by shocks (e.g. counterparty default).
 *
 * Losses reduce asset balances (a non-cash write-down in this simplified model) and flow through
 * the income statement via `closeCapital`.
 */
export const recogniseLosses = (
  state: BankState,
  config: SimulationConfig,
  shockEffects: ShockApplicationResult,
  recognizedLoanLossesInput: Partial<Record<ProductType, number>>
): LossRecognitionResult => {
  const loanItems = state.financial.balanceSheet.items.filter((i) => PRODUCT_META[i.productType]?.behaviour?.isLoan);

  const recognizedNonLoanLosses: Partial<Record<ProductType, number>> = {};
  const recognizedLoanLosses: Partial<Record<ProductType, number>> = { ...recognizedLoanLossesInput };
  const realizedLoanLosses = Object.values(recognizedLoanLosses).reduce((s, v) => s + (v ?? 0), 0);

  Object.entries(shockEffects.extraLosses).forEach(([product, loss]) => {
    const meta = PRODUCT_META[product as ProductType];
    if (meta?.behaviour?.isLoan) return;
    const item = findItem(state.financial.balanceSheet, product as ProductType);
    const recognized = item ? Math.min(item.balance, loss) : 0;
    if (recognized > 0) {
      recognizedNonLoanLosses[product as ProductType] = recognized;
    }
  });

  Object.entries(shockEffects.extraLosses).forEach(([product]) => {
    const meta = PRODUCT_META[product as ProductType];
    if (meta?.behaviour?.isLoan) return;
    const item = findItem(state.financial.balanceSheet, product as ProductType);
    if (item) {
      const recognized = recognizedNonLoanLosses[product as ProductType] ?? 0;
      item.balance = Math.max(0, item.balance - recognized);
    }
  });

  const realizedNonLoanLosses = Object.values(recognizedNonLoanLosses).reduce((sum, loss) => sum + (loss ?? 0), 0);
  const openingProvisionStock = Math.max(0, state.financial.provisionStock.total ?? 0);
  const provisionTarget = { stage1: 0, stage2: 0, stage3: 0, total: 0 };
  let allowanceMovement = 0;
  loanItems.forEach(item => {
    const target = calculateProvisionTargetFromCohorts({ state, config, productType: item.productType });
    const delta = target.total - (item.lossAllowance ?? 0);
    item.lossAllowance = target.total;
    allowanceMovement += delta;
    recognizedLoanLosses[item.productType] = (recognizedLoanLosses[item.productType] ?? 0) + delta;
    for (const stage of ['stage1', 'stage2', 'stage3', 'total'] as const) provisionTarget[stage] += target[stage];
  });
  syncLoanBalancesFromCohorts(state);
  const commitmentTarget = commitmentEcl(state, config);
  let creditProvision = findItem(state.financial.balanceSheet, LiabilityProductType.CreditProvisions);
  const commitmentMovement = commitmentTarget - (creditProvision?.balance ?? 0);
  if (!creditProvision && commitmentTarget > 0) {
    creditProvision = { ...loanItems[0], productType: LiabilityProductType.CreditProvisions, label: 'Undrawn credit provisions', side: BalanceSheetSide.Liability, balance: 0, interestRate: 0, lossAllowance: undefined, security: undefined, encumbrance: { encumberedAmount: 0 }, liquidityTag: config.liquidityTags[LiabilityProductType.CreditProvisions] };
    state.financial.balanceSheet.items.push(creditProvision);
  }
  if (creditProvision) creditProvision.balance = commitmentTarget;
  const provisionCharge = realizedLoanLosses + allowanceMovement + commitmentMovement;
  state.financial.provisionStock = provisionTarget;
  const creditLosses = provisionCharge + realizedNonLoanLosses;

  return {
    loanItems,
    recognizedLoanLosses,
    recognizedNonLoanLosses,
    realizedLoanLosses,
    realizedNonLoanLosses,
    openingProvisionStock,
    provisionCharge,
    creditLosses,
  };
};

export interface CapitalCloseResult {
  feeIncome: number;
  hedgeCarry: number;
  fvtplValuationImpact: number;
  fvociOciMovement: number;
  operatingExpenses: number;
  fixedOperatingCosts: number;
  servicingCosts: number;
  originationCosts: number;
  workoutCosts: number;
  conductCosts: number;
  provisionCharge: number;
  realizedLoanLosses: number;
  realizedNonLoanLosses: number;
  tax: number;
  netIncome: number;
  totalComprehensiveIncome: number;
  operatingCashDelta: number;
  operatingCashDeltaApplied: number;
  loanInterestIncome: number;
  nonCashAdjustmentsByProduct: Partial<Record<ProductType, number>>;
}

/**
 * Closes the period's P&L into capital and applies a simplified cash conversion.
 *
 * Net income is added to CET1. We also apply an "operating cash delta" to cash which approximates
 * interest/fee receipts less operating costs and tax.
 */
export const closeCapital = (
  state: BankState,
  config: SimulationConfig,
  dtMonths: number,
  dtYears: number,
  accruals: PnLAccrualResult,
  losses: LossRecognitionResult,
  loanInterestIncome: number,
  hedgeCarry: number,
  securitiesValuation: SecuritiesValuationResult,
  loanOriginations: number,
  defaultedPrincipal: number,
  conductCosts: number,
  events: SimulationEvent[]
): CapitalCloseResult => {
  const loanBookBalance = losses.loanItems.reduce((sum, item) => sum + item.balance, 0);
  const feeIncome = config.behaviour.loanFeeRateMonthly * dtMonths * loanBookBalance;
  const mortgagesBalance = findItem(state.financial.balanceSheet, AssetProductType.Mortgages)?.balance ?? 0;
  const corporateLoansBalance = findItem(state.financial.balanceSheet, AssetProductType.CorporateLoans)?.balance ?? 0;
  const servicingBase = mortgagesBalance * 0.85 + corporateLoansBalance * 1.15;
  const costModel = config.behaviour.costModel;
  const fixedOperatingCosts = (costModel?.fixedCostPerMonth ?? config.global.fixedOperatingCostPerMonth ?? 0) * dtMonths;
  const servicingCosts =
    (costModel?.servicingCostRateAnnual ?? config.global.operatingCostRatio) * servicingBase * dtYears;
  const originationCosts = (costModel?.originationCostRate ?? 0) * Math.max(0, loanOriginations);

  const impliedNplStock = losses.loanItems.reduce((sum, item) => {
    const basePd = config.productParameters[item.productType]?.baseDefaultRate ?? 0;
    return sum + item.balance * clamp(basePd, 0, 1);
  }, 0);
  const workoutPipelineStock = Object.values(state.workoutPipelines ?? {}).reduce(
    (sum, buckets) =>
      sum +
      (buckets ?? []).reduce(
        (inner, bucket) => inner + Math.max(0, bucket.defaultedPrincipal ?? 0),
        0
      ),
    0
  );
  const workoutBase = Math.max(
    0,
    defaultedPrincipal + impliedNplStock * 0.2 + workoutPipelineStock * 0.45
  );
  const workoutCosts = (costModel?.workoutCostRateOnDefaults ?? 0) * workoutBase;
  const effectiveConductCosts = Math.max(0, conductCosts);
  const operatingExpenses = fixedOperatingCosts + servicingCosts + originationCosts + workoutCosts + effectiveConductCosts;

  const totalInterestIncome = accruals.interestIncome + loanInterestIncome;
  const netInterestIncome = totalInterestIncome - accruals.interestExpense + hedgeCarry;
  const preTaxProfit =
    netInterestIncome + feeIncome + securitiesValuation.fvtplValuationImpact - losses.creditLosses - operatingExpenses;
  const tax = preTaxProfit > 0 ? preTaxProfit * config.global.taxRate : 0;
  const netIncome = preTaxProfit - tax;
  const totalComprehensiveIncome = netIncome + securitiesValuation.fvociOciMovement;

  state.financial.incomeStatement = {
    interestIncome: totalInterestIncome,
    interestExpense: accruals.interestExpense,
    netInterestIncome,
    fvtplValuationImpact: securitiesValuation.fvtplValuationImpact,
    fvociOciMovement: securitiesValuation.fvociOciMovement,
    hedgeCarry,
    feeIncome,
    creditLosses: losses.creditLosses,
    provisionCharge: losses.provisionCharge,
    realizedLoanLosses: losses.realizedLoanLosses,
    realizedNonLoanLosses: losses.realizedNonLoanLosses,
    operatingExpenses,
    fixedOperatingCosts,
    servicingCosts,
    originationCosts,
    workoutCosts,
    conductCosts: effectiveConductCosts,
    at1CouponExpense: 0,
    dividendsPaid: 0,
    preTaxProfit,
    tax,
    netIncome,
    totalComprehensiveIncome,
  };

  state.financial.capital.cet1 += netIncome;
  state.financial.capital.accumulatedOCI += securitiesValuation.fvociOciMovement;

  const smoothing = clamp(config.behaviour.boardPressure?.earningsVolatilitySmoothing ?? 0.75, 0, 0.99);
  const previousNetIncome = state.behaviour.previousNetIncome ?? netIncome;
  const incomeDelta = Math.abs(netIncome - previousNetIncome);
  const priorVol = state.behaviour.earningsVolatility ?? incomeDelta;
  state.behaviour.earningsVolatility = priorVol * smoothing + incomeDelta * (1 - smoothing);
  state.behaviour.previousNetIncome = netIncome;

  const operatingCashDelta =
    totalInterestIncome - accruals.interestExpense + hedgeCarry + feeIncome - operatingExpenses - tax;
  const operatingCashDeltaApplied = operatingCashDelta - loanInterestIncome;
  adjustCashOrFail(state, operatingCashDeltaApplied, events);

  events.push(
    createEvent(
      'info',
      `Cost split: fixed ${fixedOperatingCosts.toFixed(2)}, servicing ${servicingCosts.toFixed(
        2
      )}, origination ${originationCosts.toFixed(2)}, workout ${workoutCosts.toFixed(2)}, conduct ${effectiveConductCosts.toFixed(2)}`
    )
  );
  events.push(
    createEvent(
      'info',
      `Impairment: provision ${losses.provisionCharge.toFixed(2)}, realized loan losses ${losses.realizedLoanLosses.toFixed(2)}, realized non-loan losses ${losses.realizedNonLoanLosses.toFixed(2)}`
    )
  );

  return {
    feeIncome,
    hedgeCarry,
    fvtplValuationImpact: securitiesValuation.fvtplValuationImpact,
    fvociOciMovement: securitiesValuation.fvociOciMovement,
    operatingExpenses,
    fixedOperatingCosts,
    servicingCosts,
    originationCosts,
    workoutCosts,
    conductCosts: effectiveConductCosts,
    provisionCharge: losses.provisionCharge,
    realizedLoanLosses: losses.realizedLoanLosses,
    realizedNonLoanLosses: losses.realizedNonLoanLosses,
    tax,
    netIncome,
    totalComprehensiveIncome,
    operatingCashDelta,
    operatingCashDeltaApplied,
    loanInterestIncome,
    nonCashAdjustmentsByProduct: { ...securitiesValuation.nonCashAdjustmentsByProduct },
  };
};

export interface CapitalDistributionResult {
  dividendsPaid: number;
  at1CouponsPaid: number;
  requestedDividendRatio: number;
  effectiveDividendRatio: number;
}

export const applyCapitalPolicyDistributions = (
  state: BankState,
  config: SimulationConfig,
  dtYears: number,
  events: SimulationEvent[]
): CapitalDistributionResult => {
  const policy = state.behaviour.capitalPolicy ?? {
    dividendPayoutRatio: config.riskLimits.capitalPolicy.defaultDividendPayoutRatio,
    at1CouponMode: 'auto' as const,
  };
  state.behaviour.capitalPolicy = { ...policy };

  const metrics = state.risk.riskMetrics;
  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  const availableCash = Math.max(0, cash?.balance ?? 0);
  const requestedDividendRatio = clamp(policy.dividendPayoutRatio, 0, 1);
  const effectiveDividendRatio = Math.min(requestedDividendRatio, metrics.maxPayoutRatio);
  const positiveIncome = Math.max(0, state.financial.incomeStatement.netIncome);
  const requestedDividend = positiveIncome * effectiveDividendRatio;

  const rwa = Math.max(0, metrics.rwa);
  const minimumCET1 = config.riskLimits.minCet1Ratio * rwa;
  const internalTargetCapital = Math.max(minimumCET1, Math.max(0, metrics.internalCet1TargetRatio) * rwa);
  const regulatoryCet1 = state.financial.capital.cet1 + state.financial.capital.accumulatedOCI * clamp(config.behaviour.securitiesAccounting?.fvociCet1InclusionRate ?? 1, 0, 1);
  let distributableCapital = state.status.hasFailed ? 0 : Math.max(0, Math.min(regulatoryCet1 - internalTargetCapital, regulatoryCet1 + state.financial.capital.at1 - config.riskLimits.minLeverageRatio * metrics.leverageExposure));

  const dividendsPaid = Math.min(requestedDividend, distributableCapital, availableCash);
  distributableCapital = Math.max(0, distributableCapital - dividendsPaid);

  const at1CouponDue = Math.max(
    0,
    state.financial.capital.at1 * config.riskLimits.capitalPolicy.at1CouponRateAnnual * dtYears
  );
  const autoAllowsAt1 =
    !metrics.mdaTriggered &&
    metrics.cet1Ratio >= config.riskLimits.capitalPolicy.at1DiscretionaryCet1Threshold &&
    metrics.internalCet1Headroom >= (config.riskLimits.capitalPolicy.at1InternalTargetHeadroom ?? 0);
  const payAt1 =
    !metrics.mdaTriggered && (policy.at1CouponMode === 'pay' || (policy.at1CouponMode === 'auto' && autoAllowsAt1));

  const at1CouponsPaid = payAt1
    ? Math.min(at1CouponDue, Math.max(0, availableCash - dividendsPaid), distributableCapital)
    : 0;

  const totalDistribution = dividendsPaid + at1CouponsPaid;
  if (totalDistribution > 0) {
    state.financial.capital.cet1 -= totalDistribution;
    adjustCashOrFail(state, -totalDistribution, events);
  }

  state.financial.incomeStatement.dividendsPaid = dividendsPaid;
  state.financial.incomeStatement.at1CouponExpense = at1CouponsPaid;

  if (effectiveDividendRatio + 1e-9 < requestedDividendRatio) {
    events.push(
      createEvent(
        'warning',
        `Dividend payout clipped by capital buffers: requested ${(requestedDividendRatio * 100).toFixed(0)}%, allowed ${(effectiveDividendRatio * 100).toFixed(0)}%`
      )
    );
  }
  if (metrics.payoutBlockedByInternalTarget && requestedDividendRatio > 0) {
    events.push(
      createEvent(
        'warning',
        `Distribution blocked by internal target: CET1 ${(metrics.cet1Ratio * 100).toFixed(2)}% vs internal target ${(metrics.internalCet1TargetRatio * 100).toFixed(2)}%`,
        ['capital']
      )
    );
  }
  if (policy.at1CouponMode === 'auto' && !autoAllowsAt1 && at1CouponDue > 0) {
    events.push(
      createEvent(
        'warning',
        'AT1 coupon skipped in auto mode due to MDA trigger or internal capital target'
      )
    );
  }
  if (policy.at1CouponMode === 'skip' && at1CouponDue > 0) {
    events.push(createEvent('warning', 'AT1 coupon skipped by policy'));
  }

  if (totalDistribution > 0) {
    events.push(
      createEvent(
        'info',
        `Capital distributions: dividends ${dividendsPaid.toFixed(2)}, AT1 coupon ${at1CouponsPaid.toFixed(2)}`
      )
    );
  }

  return {
    dividendsPaid,
    at1CouponsPaid,
    requestedDividendRatio,
    effectiveDividendRatio,
  };
};

/**
 * Computes risk metrics (RWA/leverage/liquidity) and evaluates regulatory compliance.
 *
 * Capital minima end the game. Liquidity ratio breaches initiate recovery warnings.
 */
export const computeMetrics = (
  state: BankState,
  config: SimulationConfig,
  lcrOutflowMultiplier: number,
  events: SimulationEvent[],
  advanceConfidenceState = true,
  emitRegulatoryEvents = true
): void => {
  let metrics = calculateRiskMetrics({ state, config, lcrOutflowMultiplier });
  if (config.behaviour.confidenceStateMachine && advanceConfidenceState) {
    stepFundingConfidenceState(state, config, metrics, events);
    metrics = calculateRiskMetrics({ state, config, lcrOutflowMultiplier });
  }

  state.risk.riskMetrics = metrics;
  state.risk.compliance = evaluateCompliance(metrics, config.riskLimits);
  state.board = {
    score: metrics.boardPressureScore,
    earningsVolatility: metrics.boardPressureVolatility,
    franchiseGap: metrics.boardPressureFranchiseGap,
    riskGap: metrics.boardPressureRiskGap,
    payoutRestraint: metrics.boardPressurePayoutRestraint,
  };
  state.behaviour.fundingConfidenceScore = metrics.fundingConfidenceScore;
  state.behaviour.fundingConfidenceState = metrics.fundingConfidenceState;
  state.behaviour.conductRiskScore = metrics.conductRiskScore;

  state.status.hasFailed =
    state.status.hasFailed ||
    state.risk.compliance.cet1Breached ||
    Boolean(state.risk.compliance.ownFundsBreached) ||
    state.risk.compliance.leverageBreached;

  if (!emitRegulatoryEvents) {
    return;
  }

  if (state.risk.compliance.mdaTriggered) {
    events.push(createEvent('warning', 'CET1 has entered the combined buffer stack (MDA restrictions active)'));
  }
  if (metrics.praBufferBreached) events.push(createEvent('warning', 'PRA buffer in use: prepare a capital recovery plan. This supervisory target is separate from automatic combined-buffer distribution restrictions.', ['capital']));
  if (metrics.payoutBlockedByInternalTarget) {
    events.push(
      createEvent(
        'warning',
        `Internal capital target active: payout cap ${(metrics.maxPayoutRatio * 100).toFixed(0)}%`,
        ['capital']
      )
    );
  }
  if (state.risk.compliance.concentrationBreached) {
    events.push(
      createEvent(
        'warning',
        `Concentration limit breached (sector ${(metrics.sectorConcentration * 100).toFixed(1)}%, geography ${(metrics.geographyConcentration * 100).toFixed(1)}%)`
      )
    );
  }

  if (state.risk.compliance.lcrBreached || state.risk.compliance.nsfrBreached) {
    events.push(createEvent('warning', 'Liquidity recovery required: restore the buffer and protect funding access. A ratio breach alone does not end the game.'));
  }
  if (state.status.hasFailed) {
    events.push(createEvent('error', 'Mandate ended: a capital minimum or cash obligation was breached. This is a game rule, not a legal resolution determination.'));
  }
};

export const updateSharePrice = (
  state: BankState,
  config: SimulationConfig,
  dtMonths: number
): void => {
  ensureEquityMarketState(state, config);
  const model = config.behaviour.sharePriceModel;
  if (!model) return;

  const months = Math.max(1, Math.round(dtMonths));
  const epsSmoothing = clamp(model.epsSmoothingMonthly, 0, 1);
  const meanReversion = clamp(model.meanReversionSpeedMonthly, 0, 1);
  const maxMonthlyMove = clamp(model.maxMonthlyMove ?? 0.18, 0.02, 0.6);
  const epsAlpha = 1 - Math.pow(1 - epsSmoothing, months);
  const kappa = 1 - Math.pow(1 - meanReversion, months);

  const shares = Math.max(1, state.equityMarket.sharesOutstanding);
  const commonEquity = getCommonEquity(state);
  const bvps = commonEquity / shares;
  const annualisedEps = (state.financial.incomeStatement.netIncome * MONTHS_IN_YEAR) / shares;
  const epsTtm = state.equityMarket.epsTtm * (1 - epsAlpha) + annualisedEps * epsAlpha;

  const roeProxy = bvps > 0 ? epsTtm / bvps : -1;
  const profitabilityScore = clamp((roeProxy - model.costOfEquity) / Math.max(1e-6, model.roeScale), -1, 1);

  const cet1Headroom = state.risk.riskMetrics.cet1Ratio - state.risk.riskMetrics.cet1Requirement;
  const leverageHeadroom = state.risk.riskMetrics.leverageRatio - config.riskLimits.minLeverageRatio;
  const capitalScore = clamp(
    0.7 * (cet1Headroom / Math.max(1e-6, model.capitalCet1Scale)) +
      0.3 * (leverageHeadroom / Math.max(1e-6, model.capitalLeverageScale)),
    -1,
    1
  );

  const macroScore = clamp(
    0.5 * (state.market.gdpGrowthMoM / Math.max(1e-6, model.macroGdpScale)) -
      0.3 *
        ((state.market.unemploymentRate - model.macroUnemploymentNeutral) /
          Math.max(1e-6, model.macroUnemploymentScale)) -
      0.2 *
        ((state.market.creditSpread - model.macroCreditSpreadNeutral) /
          Math.max(1e-6, model.macroCreditSpreadScale)),
    -1,
    1
  );

  const franchiseScore = clamp(
    (state.behaviour.depositFranchiseStrength - model.franchiseNeutral) / Math.max(1e-6, model.franchiseScale),
    -1,
    1
  );

  const rawScore =
    model.profitabilityWeight * profitabilityScore +
    model.capitalWeight * capitalScore +
    model.macroWeight * macroScore +
    model.franchiseWeight * franchiseScore;
  const weightDenom = Math.max(
    1e-9,
    Math.abs(model.profitabilityWeight) +
      Math.abs(model.capitalWeight) +
      Math.abs(model.macroWeight) +
      Math.abs(model.franchiseWeight)
  );
  const normalizedScore = rawScore / weightDenom;

  const peMultiple = clamp(
    model.peNeutral * Math.exp(model.peScoreSensitivity * normalizedScore),
    model.peMin,
    model.peMax
  );
  const pbMultiple = clamp(
    model.pbNeutral * Math.exp((model.pbScoreSensitivity ?? model.peScoreSensitivity) * normalizedScore),
    model.pbMin ?? 0.2,
    model.pbMax ?? 1.8
  );
  const stressedEarningsBase =
    epsTtm >= model.epsFloor
      ? epsTtm
      : model.epsFloor * clamp(0.4 + epsTtm / Math.max(1e-6, model.epsFloor), 0.05, 0.4);
  const earningsValue = peMultiple * stressedEarningsBase;
  const bookValue = bvps > 0 ? pbMultiple * bvps : model.priceFloor;
  const earningsWeightBase = Math.max(0, model.earningsValuationWeight ?? 0.45);
  const bookWeightBase = Math.max(0, model.bookValuationWeight ?? 0.55);
  const earningsReliability = clamp((epsTtm + model.epsFloor) / Math.max(1e-6, model.epsFloor * 2), 0.2, 1);
  const earningsWeight = earningsWeightBase * earningsReliability;
  const bookWeight = bookWeightBase + earningsWeightBase * (1 - earningsReliability);
  const fairValueBeforeStress =
    (earningsValue * earningsWeight + bookValue * bookWeight) / Math.max(1e-9, earningsWeight + bookWeight);
  const hardCapitalBreach =
    state.risk.compliance.cet1Breached ||
    state.risk.compliance.leverageBreached ||
    state.risk.riskMetrics.cet1Ratio < config.riskLimits.minCet1Ratio;
  const capitalDiscount = hardCapitalBreach ? clamp(1 - (model.capitalBreachDiscount ?? 0.35), 0.25, 1) : 1;
  const failureDiscount = state.status.hasFailed ? clamp(model.failurePriceFactor ?? 0.25, 0.05, 1) : 1;
  const fairPrice = Math.max(model.priceFloor, fairValueBeforeStress * capitalDiscount * failureDiscount);
  const prevPrice = Math.max(model.priceFloor, state.equityMarket.sharePrice);
  const unconstrainedPrice = Math.max(
    model.priceFloor,
    prevPrice * Math.exp(kappa * Math.log(Math.max(model.priceFloor, fairPrice) / prevPrice))
  );
  const moveLimit = Math.pow(1 + maxMonthlyMove, months);
  const sharePrice = Math.max(
    model.priceFloor,
    clamp(unconstrainedPrice, prevPrice / moveLimit, prevPrice * moveLimit)
  );

  state.equityMarket = {
    ...state.equityMarket,
    epsTtm,
    peMultiple,
    bookValuePerShare: bvps,
    priceToBook: bvps > 0 ? sharePrice / bvps : 0,
    fairValuePerShare: fairPrice,
    sharePrice,
    marketCap: sharePrice * shares,
  };
};

export interface BuildStatementsResult {
  cashFlowStatement: CashFlowStatement;
  cfMismatch: number;
}

interface BalanceFlowResult {
  operatingBalanceFlow: number;
  investingBalanceFlow: number;
  financingLiabilityFlow: number;
}

const computeBalanceFlows = (
  inputState: BankState,
  state: BankState,
  losses: LossRecognitionResult,
  capitalClose: CapitalCloseResult
): BalanceFlowResult => {
  const prevBalances: Partial<Record<ProductType, number>> = {};
  const prevSides: Partial<Record<ProductType, BalanceSheetSide>> = {};
  inputState.financial.balanceSheet.items.forEach((item) => {
    prevBalances[item.productType] = item.balance;
    prevSides[item.productType] = item.side;
  });
  const currBalances: Partial<Record<ProductType, number>> = {};
  const currSides: Partial<Record<ProductType, BalanceSheetSide>> = {};
  state.financial.balanceSheet.items.forEach((item) => {
    currBalances[item.productType] = item.balance;
    currSides[item.productType] = item.side;
  });
  const productTypes = new Set<ProductType>(
    [...Object.keys(prevBalances), ...Object.keys(currBalances)] as ProductType[]
  );

  const nonCashBalanceAdjustmentsByProduct: Partial<Record<ProductType, number>> = {};
  Object.entries(losses.recognizedLoanLosses).forEach(([product, loss]) => {
    const productType = product as ProductType;
    nonCashBalanceAdjustmentsByProduct[productType] =
      (nonCashBalanceAdjustmentsByProduct[productType] ?? 0) + (loss ?? 0);
  });
  Object.entries(losses.recognizedNonLoanLosses).forEach(([product, loss]) => {
    const productType = product as ProductType;
    nonCashBalanceAdjustmentsByProduct[productType] =
      (nonCashBalanceAdjustmentsByProduct[productType] ?? 0) + (loss ?? 0);
  });
  Object.entries(capitalClose.nonCashAdjustmentsByProduct ?? {}).forEach(([product, adjustment]) => {
    const productType = product as ProductType;
    nonCashBalanceAdjustmentsByProduct[productType] =
      (nonCashBalanceAdjustmentsByProduct[productType] ?? 0) + (adjustment ?? 0);
  });

  const operatingLiabilityProducts = new Set<ProductType>([
    LiabilityProductType.DerivativeLiabilities,
    LiabilityProductType.RetailDeposits,
    LiabilityProductType.CorporateDeposits,
    LiabilityProductType.RetailTransactionalDeposits,
    LiabilityProductType.RetailSavingsDeposits,
    LiabilityProductType.CorporateOperatingDeposits,
    LiabilityProductType.CorporateNonOperatingDeposits,
    LiabilityProductType.WholesaleFundingST,
    LiabilityProductType.RepurchaseAgreements,
  ]);

  const investingAssetProducts = new Set<ProductType>([AssetProductType.Gilts]);

  let operatingBalanceFlow = 0;
  let investingBalanceFlow = 0;
  let financingLiabilityFlow = 0;

  productTypes.forEach((productType) => {
    const side = currSides[productType] ?? prevSides[productType];
    if (!side) return;
    const current = currBalances[productType] ?? 0;
    const previous = prevBalances[productType] ?? 0;

    if (side === BalanceSheetSide.Asset) {
      if (productType === AssetProductType.CashReserves) return;
      const delta = current - previous;
      const nonCashAdjustment = nonCashBalanceAdjustmentsByProduct[productType] ?? 0;
      const cashDrivenDelta = delta + nonCashAdjustment;
      const flow = -cashDrivenDelta; // asset increase = outflow
      if (investingAssetProducts.has(productType)) {
        investingBalanceFlow += flow;
      } else {
        operatingBalanceFlow += flow;
      }
    } else {
      if (productType === LiabilityProductType.CreditProvisions) return; // entirely non-cash ECL movement
      const delta = current - previous;
      const flow = delta + (nonCashBalanceAdjustmentsByProduct[productType] ?? 0); // exclude non-cash marks
      if (operatingLiabilityProducts.has(productType)) {
        operatingBalanceFlow += flow;
      } else {
        financingLiabilityFlow += flow;
      }
    }
  });

  return { operatingBalanceFlow, investingBalanceFlow, financingLiabilityFlow };
};

/**
 * Builds derived statements and advances the simulation clock.
 *
 * The cash flow statement is constructed as:
 * - Operating cash flows: P&L cash + balance-sheet operating flows
 * - Investing cash flows: changes in investing assets (e.g. gilts)
 * - Financing cash flows: changes in financing liabilities + external capital flows
 *
 * To avoid treating write-downs as cash inflows, recognised losses are added back when turning
 * asset balance changes into cash flows.
 */
export const buildStatements = (
  inputState: BankState,
  state: BankState,
  config: SimulationConfig,
  cashStart: number,
  capitalClose: CapitalCloseResult,
  losses: LossRecognitionResult
): BuildStatementsResult => {
  state.time = {
    step: state.time.step + 1,
    stepLengthMonths: state.time.stepLengthMonths,
    date: advanceDateByMonths(state.time.date, state.time.stepLengthMonths),
  };

  const cashEnd = findItem(state.financial.balanceSheet, AssetProductType.CashReserves)?.balance ?? 0;
  const netChange = cashEnd - cashStart;
  const { operatingBalanceFlow, investingBalanceFlow, financingLiabilityFlow } = computeBalanceFlows(
    inputState,
    state,
    losses,
    capitalClose
  );

  const investingCashFlow = investingBalanceFlow;

  const capitalDelta =
    state.financial.capital.cet1 +
    state.financial.capital.at1 -
    (inputState.financial.capital.cet1 + inputState.financial.capital.at1);
  const externalCapitalFlow = capitalDelta - capitalClose.netIncome;
  const financingCashFlow = financingLiabilityFlow + externalCapitalFlow;

  let operatingCashFlow = capitalClose.operatingCashDelta + operatingBalanceFlow;
  let cfMismatch = operatingCashFlow + investingCashFlow + financingCashFlow - netChange;

  if (Math.abs(cfMismatch) <= config.tolerances.cashFlowRoundingTolerance) {
    operatingCashFlow -= cfMismatch;
    cfMismatch = 0;
  }

  const cashFlowStatement: CashFlowStatement = {
    cashStart,
    cashEnd,
    netChange,
    operatingCashFlow,
    investingCashFlow,
    financingCashFlow,
  };
  state.financial.cashFlowStatement = cashFlowStatement;

  return { cashFlowStatement, cfMismatch };
};

/**
 * Validates post-step invariants and flags the bank as failed if they are violated.
 *
 * Invariants include both domain/accounting checks and a cash flow tie-out check.
 */
export const invariants = (
  state: BankState,
  config: SimulationConfig,
  events: SimulationEvent[],
  statements: BuildStatementsResult
): void => {
  checkInvariants(state).forEach((msg) => {
    events.push(createEvent('error', `Invariant violated: ${msg}`));
    state.status.hasFailed = true;
  });

  if (Math.abs(statements.cfMismatch) > config.tolerances.cashFlowBreachThreshold) {
    events.push(
      createEvent(
        'error',
        `Cash flow statement mismatch: operating ${statements.cashFlowStatement.operatingCashFlow.toFixed(2)} + investing ${statements.cashFlowStatement.investingCashFlow.toFixed(2)} + financing ${statements.cashFlowStatement.financingCashFlow.toFixed(2)} != net change ${statements.cashFlowStatement.netChange.toFixed(2)} (diff ${statements.cfMismatch.toFixed(6)})`
      )
    );
    state.status.hasFailed = true;
  }
};

/**
 * Factory for the simulation engine.
 *
 * The returned `step` method:
 * - clones the input state,
 * - applies shocks/actions/behaviour,
 * - accrues P&L and recognises losses,
 * - closes capital and computes risk metrics,
 * - builds statements, runs invariants, and advances the market model.
 */
export const createSimulationEngine = (): SimulationEngine => {
  const step = (input: SimulationStepInput): SimulationStepOutput => {
    const { state: inputState, config, actions, shocks } = input;
    const state = cloneBankState(inputState);
    const events: SimulationEvent[] = [];
    const featureFlags = resolveFeatureFlags(config);
    const activeConfig = applyFeatureFlagsToConfig(config, featureFlags);
    const rawDtMonths = state.time.stepLengthMonths;
    const dtMonths = normaliseStepLengthMonths(rawDtMonths);
    if (Math.abs(rawDtMonths - dtMonths) > 1e-9) {
      events.push(
        createEvent(
          'warning',
          `Non-integer step length ${rawDtMonths} normalised to ${dtMonths} month(s) for consistent accruals`
        )
      );
    }
    state.time.stepLengthMonths = dtMonths;
    const dtYears = dtMonths / MONTHS_IN_YEAR;
    const cashStart = findItem(inputState.financial.balanceSheet, AssetProductType.CashReserves)?.balance ?? 0;

    syncLoanBalancesFromCohorts(state);
    ensureFundingLadders(state, activeConfig);
    const shockEffects = applyShocks(state, activeConfig, shocks, events);
    const securitiesValuation = featureFlags.securitiesAccounting
      ? applySecuritiesValuation(state, activeConfig, events)
      : {
          fvtplValuationImpact: 0,
          fvociOciMovement: 0,
          nonCashAdjustmentsByProduct: {},
        };
    applyActions(state, activeConfig, actions, events);
    stepCompetitorReaction(state, activeConfig, dtMonths, events);
    const fundingLifecycle = featureFlags.fundingLadder
      ? stepFundingLadders(state, activeConfig, dtMonths, shockEffects, events)
      : {
          maturingNotional: 0,
          refinancedNotional: 0,
          shortfallNotional: 0,
          weightedRefinanceRate: 0,
          effectiveAccess: 1,
        };
    if (featureFlags.depositSegmentation) {
      applyDepositBehaviour(state, activeConfig, dtMonths, events);
    }
    const loanBehaviour = featureFlags.loanPipeline
      ? applyLoanBehaviour(state, activeConfig, dtMonths, events)
      : {
          demandNotional: 0,
          approvedNotional: 0,
          requestedDrawdown: 0,
          originatedNotional: 0,
          cancelledNotional: 0,
          selectionPressureNotional: 0,
          selectionPressureIndex: 0,
        };
    const cohortStep = featureFlags.ifrs9Staging
      ? stepLoanCohorts({
          state,
          config: activeConfig,
          dtMonths,
          pdMultiplier: shockEffects.pdMultiplier,
          lgdMultiplier: shockEffects.lgdMultiplier,
          extraLossesByProduct: shockEffects.extraLosses,
        })
      : {
          loanInterestIncome: 0,
          nonCashInterest: 0,
          recognizedLoanLosses: {},
          defaultedPrincipal: 0,
          renewedPrincipal: 0,
          prepaidPrincipal: 0,
          recoveryCash: 0,
          resolvedWorkoutPrincipal: 0,
          selectionPressureNotional: 0,
          selectionPressureIndex: 0,
        };
    if (cohortStep.renewedPrincipal > 0) {
      events.push(
        createEvent(
          'info',
          `Loan renewals/refi: rolled ${cohortStep.renewedPrincipal.toFixed(2)} with selection pressure ${cohortStep.selectionPressureIndex.toFixed(3)}`
        )
      );
    }
    if (cohortStep.prepaidPrincipal > 0) {
      events.push(
        createEvent(
          'info',
          `Selective prepayments/refi runoff: ${cohortStep.prepaidPrincipal.toFixed(2)} exited this step`
        )
      );
    }
    if (cohortStep.resolvedWorkoutPrincipal > 0 || cohortStep.recoveryCash > 0) {
      events.push(
        createEvent(
          'info',
          `Workout resolution: resolved ${cohortStep.resolvedWorkoutPrincipal.toFixed(2)}, recoveries ${cohortStep.recoveryCash.toFixed(2)}`
        )
      );
    }
    const conductStep = featureFlags.conductRisk
      ? stepConductRisk(state, activeConfig, dtMonths, events)
      : {
          conductCosts: 0,
          eventProbability: 0,
          eventTriggered: false,
          scoreBefore: state.behaviour.conductRiskScore ?? 0,
          scoreAfter: state.behaviour.conductRiskScore ?? 0,
          pricingSeverity: 0,
        };
    if (conductStep.conductCosts > 0) {
      events.push(
        createEvent(
          'warning',
          `Conduct remediation costs recognised this step: ${conductStep.conductCosts.toFixed(2)}`,
          ['conduct', 'income']
        )
      );
    }
    const accruals = accruePnL(state, dtYears);
    const hedgeCarry = featureFlags.irrbbHedges ? stepHedges(state, activeConfig, dtMonths, dtYears, events) : 0;
    if (featureFlags.irrbbHedges) {
      const valuation = revalueHedges(state, activeConfig);
      securitiesValuation.fvtplValuationImpact += valuation.pnl;
      Object.assign(securitiesValuation.nonCashAdjustmentsByProduct, valuation.adjustments);
    }
    const losses = recogniseLosses(state, activeConfig, shockEffects, cohortStep.recognizedLoanLosses);
    if (featureFlags.securitiesAccounting) {
      const impairment = recogniseSecurityImpairment(state, activeConfig);
      losses.creditLosses += impairment.expense;
      losses.provisionCharge += impairment.expense;
      securitiesValuation.fvociOciMovement += impairment.oci;
      for (const [p, adjustment] of Object.entries(impairment.adjustments)) securitiesValuation.nonCashAdjustmentsByProduct[p as ProductType] = (securitiesValuation.nonCashAdjustmentsByProduct[p as ProductType] ?? 0) + adjustment;
      const recycling = state.financial.balanceSheet.items.reduce((sum,i)=>sum+(i.security?.pendingRecycling ?? 0),0);
      securitiesValuation.fvtplValuationImpact += recycling;
      securitiesValuation.fvociOciMovement -= recycling;
      state.financial.balanceSheet.items.forEach(i=>{if(i.security)i.security.pendingRecycling=0;});
    }
    // Reclassify discount unwinding on net credit-impaired assets as interest.
    losses.creditLosses += cohortStep.nonCashInterest;
    losses.provisionCharge += cohortStep.nonCashInterest;
    const capitalClose = closeCapital(
      state,
      activeConfig,
      dtMonths,
      dtYears,
      accruals,
      losses,
      cohortStep.loanInterestIncome + cohortStep.nonCashInterest,
      hedgeCarry,
      securitiesValuation,
      loanBehaviour.originatedNotional,
      cohortStep.defaultedPrincipal,
      conductStep.conductCosts,
      events
    );
    capitalClose.operatingCashDelta -= cohortStep.nonCashInterest;
    computeMetrics(state, activeConfig, shockEffects.lcrOutflowMultiplier, events, true, false);
    if (featureFlags.capitalPolicy) {
      applyCapitalPolicyDistributions(state, activeConfig, dtYears, events);
    }
    computeMetrics(state, activeConfig, shockEffects.lcrOutflowMultiplier, events, false, true);
    updateSharePrice(state, activeConfig, dtMonths);
    const statements = buildStatements(inputState, state, activeConfig, cashStart, capitalClose, losses);
    invariants(state, activeConfig, events, statements);
    advanceUkMarketState(state.market, dtMonths);

    if (fundingLifecycle.maturingNotional > 0) {
      events.push(
        createEvent(
          'info',
          `Funding ladder: matured ${fundingLifecycle.maturingNotional.toFixed(2)}, refinanced ${fundingLifecycle.refinancedNotional.toFixed(
            2
          )}, shortfall ${fundingLifecycle.shortfallNotional.toFixed(2)}, access ${(fundingLifecycle.effectiveAccess * 100).toFixed(1)}%`
        )
      );
    }

    const diagnostics: SimulationDiagnostics = {
      attribution: featureFlags.stepDiagnosticsAttribution
        ? buildStepAttribution({
            before: inputState,
            after: state,
            config: activeConfig,
            events,
          })
        : buildStepAttribution({
            before: inputState,
            after: state,
            config: activeConfig,
            events: [],
          }),
    };

    return { nextState: state, events, diagnostics };
  };

  return { step };
};
