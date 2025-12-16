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
import { BankState } from '../domain/bankState';
import { BalanceSheet, BalanceSheetItem } from '../domain/balanceSheet';
import {
  AssetProductType,
  BalanceSheetSide,
  LiabilityProductType,
  ProductType,
} from '../domain/enums';
import { ComplianceStatus, RiskMetrics } from '../domain/risks';
import { SimulationConfig } from '../domain/config';
import {
  PlayerAction,
  AdjustRateAction,
  BuySellAssetAction,
  IssueDebtAction,
  IssueEquityAction,
  EnterRepoAction,
} from '../domain/actions';
import {
  Shock,
  MacroDownturnShock,
  DepositCompetitionShock,
  MarketSpreadShock,
  IdiosyncraticRunShock,
  CounterpartyDefaultShock,
} from '../domain/shocks';
import { CashFlowStatement } from '../domain/cashflow';
import { Currency, MaturityBucket } from '../domain/enums';
import { PRODUCT_META } from '../domain/productMeta';
import { calculateRiskMetrics, evaluateCompliance } from './metrics';
import { checkInvariants } from './invariants';
import { cloneBankState } from './clone';
import { advanceUkMarketState } from './ukMarketModel';
import { applyExtraPrepayment, stepLoanCohorts, syncLoanBalancesFromCohorts, upsertOriginationCohort } from './loanCohorts';

// Tiny "by-reference" wrapper so shocks can compound multipliers in-place.
type Ref<T> = { value: T };

// Helper for mapping a discriminated-union member by its `type` field.
type ActionByType<T extends PlayerAction['type']> = Extract<PlayerAction, { type: T }>;

/**
 * Applies a single player action.
 *
 * Handlers mutate `state` in-place and push descriptive entries into `events`.
 */
export type ActionHandler<T extends PlayerAction = PlayerAction> = (
  state: BankState,
  config: SimulationConfig,
  action: T,
  events: SimulationEvent[]
) => void;

type ActionHandlerMap = {
  [K in PlayerAction['type']]: ActionHandler<ActionByType<K>>;
};

// Concrete implementations for each `PlayerAction` type.
const actionHandlers: ActionHandlerMap = {
  adjustRate: (state, _config, action: AdjustRateAction, events) => {
    adjustInterestRate(findItem(state.balanceSheet, action.productType), action.newRate);
    events.push({
      severity: 'info',
      message: `Adjusted rate for ${action.productType} to ${action.newRate.toFixed(4)}`,
    });
  },
  issueEquity: (state, _config, action: IssueEquityAction, events) => {
    applyIssueEquity(state, action.amount, events);
  },
  issueDebt: (state, config, action: IssueDebtAction, events) => {
    applyIssueDebt(state, config, action.productType, action.amount, action.rate, events);
  },
  buySellAsset: (state, _config, action: BuySellAssetAction, events) => {
    applyBuySellAsset(state, _config, action.productType, action.amountDelta, events);
  },
  enterRepo: (state, config, action: EnterRepoAction, events) => {
    applyEnterRepo(
      state,
      config,
      action.direction,
      action.collateralProduct,
      action.amount,
      action.haircut,
      action.rate ?? state.market.baseRate,
      events
    );
  },
};

// Runtime dispatcher (keeps the per-action switch in one place).
const handleAction = (
  state: BankState,
  config: SimulationConfig,
  action: PlayerAction,
  events: SimulationEvent[]
) => {
  switch (action.type) {
    case 'adjustRate':
      actionHandlers.adjustRate(state, config, action, events);
      break;
    case 'issueEquity':
      actionHandlers.issueEquity(state, config, action, events);
      break;
    case 'issueDebt':
      actionHandlers.issueDebt(state, config, action, events);
      break;
    case 'buySellAsset':
      actionHandlers.buySellAsset(state, config, action, events);
      break;
    case 'enterRepo':
      actionHandlers.enterRepo(state, config, action, events);
      break;
    default:
      events.push({ severity: 'warning', message: `No handler for action type ${(action as PlayerAction).type}` });
  }
};

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
  extraLosses: Partial<Record<ProductType, number>>;
}

type ShockByType<T extends Shock['type']> = Extract<Shock, { type: T }>;

export type ShockHandler<S extends Shock = Shock> = (shock: S, ctx: ShockContext) => void;

type ShockHandlerMap = {
  [K in Shock['type']]: ShockHandler<ShockByType<K>>;
};

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
    ctx.events.push({ severity: 'info', message: `Shock: deposit competition +${shock.retailRateIncrease}` });
  },
  marketSpreadShock: (shock: MarketSpreadShock, ctx: ShockContext) => {
    // Spreads widen: wholesale funding costs rise, loan spreads widen, and repo haircuts increase.
    const delta = shock.wholesaleSpreadBps / 10000;
    ctx.state.market.wholesaleFundingSpread += delta;
    ctx.state.market.seniorDebtSpread += delta;
    ctx.state.market.corporateLoanSpread += shock.loanSpreadBps / 10000;
    ctx.state.market.creditSpread += delta;
    ctx.state.market.giltRepoHaircut += shock.repoHaircutIncreasePct;
    ctx.events.push({ severity: 'warning', message: `Shock: market spread widen +${shock.wholesaleSpreadBps}bps` });
  },
  idiosyncraticRun: (shock: IdiosyncraticRunShock, ctx: ShockContext) => {
    // A run increases LCR outflows and triggers an immediate one-off deposit withdrawal.
    ctx.lcrOutflowMultiplier.value *= shock.outflowRateMultiplier;
    const retail = findItem(ctx.state.balanceSheet, LiabilityProductType.RetailDeposits);
    const corporate = findItem(ctx.state.balanceSheet, LiabilityProductType.CorporateDeposits);
    const baseRunOff = 0.1; // 10% base one-off run-off
    const incremental = Math.max(0, shock.outflowRateMultiplier - 1) * 0.1;
    const runOffRate = Math.min(0.5, baseRunOff + incremental); // cap at 50%
    const retailRequested = retail ? retail.balance * runOffRate : 0;
    const corporateRequested = corporate ? corporate.balance * runOffRate : 0;
    const totalRequested = retailRequested + corporateRequested;

    const totalPaid = applyCashOutflowOrFail(ctx.state, totalRequested, ctx.events);
    const allocationBase = totalRequested > 0 ? totalRequested : 1;

    const rawRetailPaid = retail ? (totalPaid * retailRequested) / allocationBase : 0;
    const retailPaid = Math.min(totalPaid, Math.max(0, rawRetailPaid));
    const corporatePaid = corporate ? Math.max(0, totalPaid - retailPaid) : 0;

    if (retail) {
      retail.balance -= retailPaid;
      ctx.events.push({
        severity: 'warning',
        message: `Idiosyncratic run reduced retail deposits by ${retailPaid.toFixed(2)} (${(runOffRate * 100).toFixed(
          1
        )}%)`,
      });
      if (retailPaid < retailRequested) {
        ctx.events.push({
          severity: 'error',
          message: `Unmet retail withdrawal demand: ${(retailRequested - retailPaid).toFixed(2)}`,
        });
      }
    }

    if (corporate) {
      corporate.balance -= corporatePaid;
      ctx.events.push({
        severity: 'warning',
        message: `Idiosyncratic run reduced corporate deposits by ${corporatePaid.toFixed(2)} (${(
          runOffRate * 100
        ).toFixed(1)}%)`,
      });
      if (corporatePaid < corporateRequested) {
        ctx.events.push({
          severity: 'error',
          message: `Unmet corporate withdrawal demand: ${(corporateRequested - corporatePaid).toFixed(2)}`,
        });
      }
    }
    ctx.events.push({ severity: 'warning', message: `Shock: idiosyncratic run multiplier ${shock.outflowRateMultiplier}` });
  },
  macroDownturn: (shock: MacroDownturnShock, ctx: ShockContext) => {
    // Macro stress raises default probabilities and loss severities across the loan book.
    ctx.pdMultiplier.value *= shock.pdMultiplier;
    ctx.lgdMultiplier.value *= shock.lgdMultiplier;
    ctx.events.push({
      severity: 'warning',
      message: `Shock: macro downturn PDx${shock.pdMultiplier} LGDx${shock.lgdMultiplier}`,
    });
  },
  counterpartyDefault: (shock: CounterpartyDefaultShock, ctx: ShockContext) => {
    // Records a product-specific one-off loss, recognised later during loss recognition.
    applyCounterpartyDefault(shock, ctx.extraLosses, ctx.events);
  },
};

// Runtime dispatcher for shocks (mirrors `handleAction`).
const handleShock = (shock: Shock, ctx: ShockContext) => {
  switch (shock.type) {
    case 'depositCompetition':
      shockHandlers.depositCompetition(shock, ctx);
      break;
    case 'marketSpreadShock':
      shockHandlers.marketSpreadShock(shock, ctx);
      break;
    case 'idiosyncraticRun':
      shockHandlers.idiosyncraticRun(shock, ctx);
      break;
    case 'macroDownturn':
      shockHandlers.macroDownturn(shock, ctx);
      break;
    case 'counterpartyDefault':
      shockHandlers.counterpartyDefault(shock, ctx);
      break;
    default:
      ctx.events.push({ severity: 'warning', message: `No handler for shock type ${(shock as Shock).type}` });
  }
};

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
  severity: EventSeverity;
  message: string;
}

export interface SimulationStepOutput {
  nextState: BankState;
  events: SimulationEvent[];
}

export interface SimulationEngine {
  step(input: SimulationStepInput): SimulationStepOutput;
}

// Time conversion helper (the model uses months for behavioural dynamics, years for rates/PDs).
const MONTHS_IN_YEAR = 12;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

// Convenience helper for balance-sheet lookups.
const findItem = (bs: BalanceSheet, productType: ProductType): BalanceSheetItem | undefined =>
  bs.items.find((i) => i.productType === productType);

/**
 * Applies a cash delta (positive=inflow, negative=outflow).
 *
 * If cash would go negative, the bank is marked as failed.
 */
const adjustCashOrFail = (state: BankState, delta: number, events: SimulationEvent[]): void => {
  const cash = findItem(state.balanceSheet, AssetProductType.CashReserves);
  if (!cash) return;

  cash.balance += delta;
  if (cash.balance >= 0) return;

  const shortfall = -cash.balance;
  cash.balance = 0;
  state.hasFailed = true;
  events.push({
    severity: 'error',
    message: `Cash balance breached: short by ${shortfall.toFixed(2)} after flow`,
  });
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
  const cash = findItem(state.balanceSheet, AssetProductType.CashReserves);
  if (!cash) return 0;

  const paid = Math.max(0, Math.min(outflow, cash.balance));
  cash.balance -= paid;
  const shortfall = outflow - paid;
  if (shortfall <= 0) return paid;

  state.hasFailed = true;
  events.push({
    severity: 'error',
    message: `Cash balance breached: short by ${shortfall.toFixed(2)} after outflow`,
  });
  return paid;
};

const adjustInterestRate = (item: BalanceSheetItem | undefined, newRate: number): void => {
  if (!item) return;
  item.interestRate = newRate;
};

const applyIssueEquity = (state: BankState, amount: number, events: SimulationEvent[]): void => {
  // New equity increases CET1 capital and provides fresh cash funding.
  state.capital.cet1 += amount;
  const cash = findItem(state.balanceSheet, AssetProductType.CashReserves);
  if (cash) {
    cash.balance += amount;
  }
  events.push({ severity: 'info', message: `Issued equity: +${amount.toFixed(2)} CET1 and cash` });
};

// Weighted-average rate when adding to an existing position.
const blendRate = (existingBalance: number, existingRate: number, newAmount: number, newRate: number): number => {
  if (existingBalance + newAmount === 0) return newRate;
  return (existingBalance * existingRate + newAmount * newRate) / (existingBalance + newAmount);
};

const applyIssueDebt = (
  state: BankState,
  config: SimulationConfig,
  productType: LiabilityProductType.WholesaleFundingST | LiabilityProductType.WholesaleFundingLT,
  amount: number,
  rateOverride: number | undefined,
  events: SimulationEvent[]
): void => {
  // Issue unsecured wholesale funding. Pricing defaults to market risk-free + spread unless overridden.
  const cash = findItem(state.balanceSheet, AssetProductType.CashReserves);
  if (!cash) return;
  const pricingRate =
    rateOverride ??
    (productType === LiabilityProductType.WholesaleFundingST
      ? state.market.riskFreeShort + state.market.wholesaleFundingSpread
      : state.market.riskFreeLong + state.market.seniorDebtSpread);
  const label =
    productType === LiabilityProductType.WholesaleFundingST ? 'Wholesale Funding ST' : 'Wholesale Funding LT';
  const line = ensureLineItem(
    state,
    BalanceSheetSide.Liability,
    productType,
    label,
    pricingRate,
    config
  );
  line.interestRate = blendRate(line.balance, line.interestRate, amount, pricingRate);
  line.balance += amount;
  cash.balance += amount;
  events.push({
    severity: 'info',
    message: `Issued debt ${productType}: +${amount.toFixed(2)} balance at rate ${line.interestRate.toFixed(4)}`,
  });
};

const applyBuySellAsset = (
  state: BankState,
  config: SimulationConfig,
  productType: AssetProductType,
  amountDelta: number,
  events: SimulationEvent[]
): void => {
  // Simple asset purchase/sale at par value (no mark-to-market).
  const asset = findItem(state.balanceSheet, productType);
  const cash = findItem(state.balanceSheet, AssetProductType.CashReserves);
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
        events.push({
          severity: 'warning',
          message: `Insufficient cash to buy ${productType}: requested ${requested.toFixed(2)}, executed ${executed.toFixed(
            2
          )}`,
        });
      }
      events.push({
        severity: 'info',
        message: `Bought ${productType}: +${executed.toFixed(2)}, cash -${executed.toFixed(2)}`,
      });
    } else {
      const requested = Math.abs(amountDelta);
      const executed = applyExtraPrepayment({ state, productType, amount: requested });
      events.push({
        severity: 'info',
        message: `Sold ${productType}: -${executed.toFixed(2)}, cash +${executed.toFixed(2)}`,
      });
    }
    return;
  }
  if (amountDelta >= 0) {
    // buying asset
    const buyAmount = Math.min(amountDelta, Math.max(0, cash.balance));
    asset.balance += buyAmount;
    cash.balance -= buyAmount;
    if (buyAmount < amountDelta) {
      events.push({
        severity: 'warning',
        message: `Insufficient cash to buy ${productType}: requested ${amountDelta.toFixed(2)}, executed ${buyAmount.toFixed(
          2
        )}`,
      });
    }
    events.push({
      severity: 'info',
      message: `Bought ${productType}: +${buyAmount.toFixed(2)}, cash -${buyAmount.toFixed(2)}`,
    });
  } else {
    const sellAmount = Math.min(asset.balance, Math.abs(amountDelta));
    asset.balance -= sellAmount;
    adjustCashOrFail(state, sellAmount, events);
    events.push({
      severity: 'info',
      message: `Sold ${productType}: -${sellAmount.toFixed(2)}, cash +${sellAmount.toFixed(2)}`,
    });
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
  const existing = findItem(state.balanceSheet, productType);
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
  };
  state.balanceSheet.items.push(newItem);
  return newItem;
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
  const cash = findItem(state.balanceSheet, AssetProductType.CashReserves);
  if (!cash) return;

  if (direction === 'borrow') {
    const collateral = findItem(state.balanceSheet, collateralProduct);
    const effectiveHaircut = Math.max(0, haircut ?? 0);
    const collateralRequirement = 1 + effectiveHaircut;
    const availableCollateral = collateral
      ? Math.max(0, collateral.balance - (collateral.encumbrance?.encumberedAmount ?? 0))
      : 0;
    const maxBorrow = collateralRequirement > 0 ? availableCollateral / collateralRequirement : 0;
    const borrowAmount = Math.min(amount, maxBorrow);

    if (borrowAmount <= 0) {
      events.push({
        severity: 'warning',
        message: `Repo borrow failed: insufficient unencumbered ${collateralProduct}`,
      });
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
    events.push({
      severity: 'info',
      message: `Repo borrow: ${amountText}, collateral ${collateralProduct} encumbered`,
    });
  } else {
    const reverseRepo = ensureLineItem(
      state,
      BalanceSheetSide.Asset,
      AssetProductType.ReverseRepo,
      'Reverse Repo',
      rate,
      config
    );
    const lendAmount = Math.min(cash.balance, amount);
    reverseRepo.interestRate = blendRate(reverseRepo.balance, reverseRepo.interestRate, lendAmount, rate);
    reverseRepo.balance += lendAmount;
    cash.balance -= lendAmount;
    events.push({ severity: 'info', message: `Repo lend: -${lendAmount.toFixed(2)} cash, +reverse repo asset` });
  }
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
  events.push({
    severity: 'warning',
    message: `Counterparty default on ${shock.productType}: loss ${loss.toFixed(2)}`,
  });
};

export interface ShockApplicationResult {
  pdMultiplier: number;
  lgdMultiplier: number;
  lcrOutflowMultiplier: number;
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

  const shockContext: ShockContext = {
    state,
    config,
    events,
    pdMultiplier,
    lgdMultiplier,
    lcrOutflowMultiplier,
    extraLosses,
  };

  shocks.forEach((shock) => handleShock(shock, shockContext));

  return {
    pdMultiplier: pdMultiplier.value,
    lgdMultiplier: lgdMultiplier.value,
    lcrOutflowMultiplier: lcrOutflowMultiplier.value,
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
  actions.forEach((action) => handleAction(state, config, action, events));
};

/**
 * Applies simple behavioural dynamics for deposits and loans.
 *
 * The idea is "pricing drives volumes":
 * - Customer deposits grow/shrink based on how attractive our rate is vs competitors.
 * - Loan demand grows/shrinks based on how expensive our loan rate is vs a market benchmark.
 *
 * Balance changes are translated into cash flows:
 * - Deposit inflow increases cash; deposit outflow decreases cash.
 * - Loan growth consumes cash; loan run-off releases cash.
 */
export const applyBehaviour = (
  state: BankState,
  config: SimulationConfig,
  dtMonths: number,
  events: SimulationEvent[]
): void => {
  const depositBaselineGrowth = 0.002; // ~0.2% monthly baseline (~2.4% p.a.) if rate = competitor
  const loanBaselineGrowth = 0; // simple v1, volume driven by rate competitiveness only

  state.balanceSheet.items
    .filter(
      (i) =>
        PRODUCT_META[i.productType]?.behaviour?.affectsBehaviouralDepositFlow &&
        PRODUCT_META[i.productType]?.behaviour?.isCustomerDeposit
    )
    .forEach((item) => {
      const meta = PRODUCT_META[item.productType];
      const competitor =
        meta.behaviour.depositSegment === 'corporate'
          ? state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate
          : state.market.competitorRetailDepositRate;
      const rel = item.interestRate - competitor;
      const elasticity = config.productParameters[item.productType].volumeElasticityToRate;
      let g = depositBaselineGrowth + elasticity * rel;
      g = clamp(g, -0.1, config.global.maxDepositGrowthPerStep);
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
          events.push({
            severity: 'error',
            message: `Unmet deposit withdrawal demand for ${meta.label}: ${(requestedOutflow - paidOutflow).toFixed(2)}`,
          });
        }
      }
      events.push({
        severity: 'info',
        message: `Behaviour: ${meta.label} growth ${(growthFactor - 1).toFixed(4)} this step`,
      });
    });

  state.balanceSheet.items
    .filter(
      (i) =>
        PRODUCT_META[i.productType]?.behaviour?.affectsBehaviouralLoanFlow &&
        PRODUCT_META[i.productType]?.behaviour?.isLoan
    )
    .forEach((item) => {
      const meta = PRODUCT_META[item.productType];
      const benchmark =
        meta.behaviour.loanBenchmark === 'mortgage'
          ? state.market.competitorMortgageRate
          : state.market.riskFreeLong + state.market.corporateLoanSpread;
      const rel = item.interestRate - benchmark;
      const elasticity = config.productParameters[item.productType].volumeElasticityToRate;
      let g = loanBaselineGrowth + elasticity * rel;
      g = clamp(g, -0.02, config.global.maxLoanGrowthPerStep);
      const growthFactor = Math.max(0, 1 + g * dtMonths);
      const before = item.balance;
      const desiredBalance = before * growthFactor;
      let delta = desiredBalance - before;

      const params = config.productParameters[item.productType];
      if (delta > 0) {
        const cash = findItem(state.balanceSheet, AssetProductType.CashReserves);
        const availableCash = Math.max(0, cash?.balance ?? 0);
        const requested = Math.min(delta, availableCash);
        const executed = upsertOriginationCohort({
          state,
          config,
          productType: item.productType,
          cohortId: state.time.step,
          principal: requested,
          annualInterestRate: item.interestRate,
          annualPd: params.baseDefaultRate,
          lgd: params.lossGivenDefault,
        });
        if (executed + 1e-6 < requested) {
          events.push({
            severity: 'warning',
            message: `Insufficient cash to originate ${meta.label}: requested ${requested.toFixed(2)}, executed ${executed.toFixed(
              2
            )}`,
          });
        }
      } else if (delta < 0) {
        applyExtraPrepayment({ state, productType: item.productType, amount: Math.abs(delta) });
      }
      events.push({
        severity: 'info',
        message: `Behaviour: ${meta.label} growth ${(growthFactor - 1).toFixed(4)} this step`,
      });
  });
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
  const assets = state.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset);
  const liabilities = state.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Liability);
  const interestIncome = assets
    .filter((a) => !PRODUCT_META[a.productType]?.behaviour?.isLoan)
    .reduce((sum, a) => sum + a.balance * a.interestRate * dtYears, 0);
  const interestExpense = liabilities.reduce((sum, l) => sum + l.balance * l.interestRate * dtYears, 0);

  return { assets, liabilities, interestIncome, interestExpense };
};

export interface LossRecognitionResult {
  loanItems: BalanceSheetItem[];
  recognizedLoanLosses: Partial<Record<ProductType, number>>;
  recognizedNonLoanLosses: Partial<Record<ProductType, number>>;
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
  const loanItems = state.balanceSheet.items.filter((i) => PRODUCT_META[i.productType]?.behaviour?.isLoan);

  const recognizedNonLoanLosses: Partial<Record<ProductType, number>> = {};
  const recognizedLoanLosses: Partial<Record<ProductType, number>> = { ...recognizedLoanLossesInput };
  let creditLosses = Object.values(recognizedLoanLosses).reduce((s, v) => s + (v ?? 0), 0);

  Object.entries(shockEffects.extraLosses).forEach(([product, loss]) => {
    const meta = PRODUCT_META[product as ProductType];
    if (meta?.behaviour?.isLoan) return;
    const item = findItem(state.balanceSheet, product as ProductType);
    const recognized = item ? Math.min(item.balance, loss) : 0;
    if (recognized > 0) {
      recognizedNonLoanLosses[product as ProductType] = recognized;
    }
    creditLosses += recognized;
  });

  Object.entries(shockEffects.extraLosses).forEach(([product]) => {
    const meta = PRODUCT_META[product as ProductType];
    if (meta?.behaviour?.isLoan) return;
    const item = findItem(state.balanceSheet, product as ProductType);
    if (item) {
      const recognized = recognizedNonLoanLosses[product as ProductType] ?? 0;
      item.balance = Math.max(0, item.balance - recognized);
    }
  });

  return { loanItems, recognizedLoanLosses, recognizedNonLoanLosses, creditLosses };
};

export interface CapitalCloseResult {
  feeIncome: number;
  operatingExpenses: number;
  tax: number;
  netIncome: number;
  operatingCashDelta: number;
  operatingCashDeltaApplied: number;
  loanInterestIncome: number;
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
  events: SimulationEvent[]
): CapitalCloseResult => {
  const FEE_RATE = 0.001; // simple v1 assumption: 0.1% per month on loan book
  const loanBookBalance = losses.loanItems.reduce((sum, item) => sum + item.balance, 0);
  const totalAssetBalance = accruals.assets.reduce((sum, a) => sum + a.balance, 0);
  const feeIncome = FEE_RATE * dtMonths * loanBookBalance;
  const operatingExpenses =
    config.global.operatingCostRatio * totalAssetBalance * dtYears +
    (config.global.fixedOperatingCostPerMonth ?? 0) * dtMonths;

  const totalInterestIncome = accruals.interestIncome + loanInterestIncome;
  const netInterestIncome = totalInterestIncome - accruals.interestExpense;
  const preTaxProfit = netInterestIncome + feeIncome - losses.creditLosses - operatingExpenses;
  const tax = preTaxProfit > 0 ? preTaxProfit * config.global.taxRate : 0;
  const netIncome = preTaxProfit - tax;

  state.incomeStatement = {
    interestIncome: totalInterestIncome,
    interestExpense: accruals.interestExpense,
    netInterestIncome,
    feeIncome,
    creditLosses: losses.creditLosses,
    operatingExpenses,
    preTaxProfit,
    tax,
    netIncome,
  };

  state.capital.cet1 += netIncome;

  const operatingCashDelta =
    totalInterestIncome - accruals.interestExpense + feeIncome - operatingExpenses - tax;
  const operatingCashDeltaApplied = operatingCashDelta - loanInterestIncome;
  adjustCashOrFail(state, operatingCashDeltaApplied, events);

  return { feeIncome, operatingExpenses, tax, netIncome, operatingCashDelta, operatingCashDeltaApplied, loanInterestIncome };
};

/**
 * Computes risk metrics (RWA/leverage/liquidity) and evaluates regulatory compliance.
 *
 * If any limit is breached, the bank is flagged as failed for the step.
 */
export const computeMetrics = (
  state: BankState,
  config: SimulationConfig,
  lcrOutflowMultiplier: number,
  events: SimulationEvent[]
): void => {
  const metrics = calculateRiskMetrics({ state, config, lcrOutflowMultiplier });
  state.riskMetrics = metrics;
  state.compliance = evaluateCompliance(metrics, config.riskLimits);

  state.hasFailed =
    state.hasFailed ||
    state.compliance.cet1Breached ||
    state.compliance.leverageBreached ||
    state.compliance.lcrBreached ||
    state.compliance.nsfrBreached;

  if (state.hasFailed) {
    events.push({ severity: 'error', message: 'Regulatory breach: your bank has failed!' });
  }
};

export interface BuildStatementsResult {
  cashFlowStatement: CashFlowStatement;
  cfMismatch: number;
}

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
  cashStart: number,
  capitalClose: CapitalCloseResult,
  losses: LossRecognitionResult
): BuildStatementsResult => {
  state.time = {
    step: state.time.step + 1,
    stepLengthMonths: state.time.stepLengthMonths,
    date: new Date(state.time.date.getTime() + state.time.stepLengthMonths * 30 * 24 * 60 * 60 * 1000),
  };

  const cashEnd = findItem(state.balanceSheet, AssetProductType.CashReserves)?.balance ?? 0;
  const netChange = cashEnd - cashStart;
  const prevBalances: Partial<Record<ProductType, number>> = {};
  const prevSides: Partial<Record<ProductType, BalanceSheetSide>> = {};
  inputState.balanceSheet.items.forEach((item) => {
    prevBalances[item.productType] = item.balance;
    prevSides[item.productType] = item.side;
  });
  const currBalances: Partial<Record<ProductType, number>> = {};
  const currSides: Partial<Record<ProductType, BalanceSheetSide>> = {};
  state.balanceSheet.items.forEach((item) => {
    currBalances[item.productType] = item.balance;
    currSides[item.productType] = item.side;
  });
  const productTypes = new Set<ProductType>([...Object.keys(prevBalances), ...Object.keys(currBalances)] as ProductType[]);

  const nonCashLossByProduct: Partial<Record<ProductType, number>> = {};
  Object.entries(losses.recognizedLoanLosses).forEach(([product, loss]) => {
    const productType = product as ProductType;
    nonCashLossByProduct[productType] = (nonCashLossByProduct[productType] ?? 0) + (loss ?? 0);
  });
  Object.entries(losses.recognizedNonLoanLosses).forEach(([product, loss]) => {
    const productType = product as ProductType;
    nonCashLossByProduct[productType] = (nonCashLossByProduct[productType] ?? 0) + (loss ?? 0);
  });

  const operatingLiabilityProducts = new Set<ProductType>([
    LiabilityProductType.RetailDeposits,
    LiabilityProductType.CorporateDeposits,
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
      const nonCashLoss = nonCashLossByProduct[productType] ?? 0;
      const cashDrivenDelta = delta + nonCashLoss;
      const flow = -cashDrivenDelta; // asset increase = outflow
      if (investingAssetProducts.has(productType)) {
        investingBalanceFlow += flow;
      } else {
        operatingBalanceFlow += flow;
      }
    } else {
      const delta = current - previous;
      const flow = delta; // liability increase = inflow
      if (operatingLiabilityProducts.has(productType)) {
        operatingBalanceFlow += flow;
      } else {
        financingLiabilityFlow += flow;
      }
    }
  });

  const investingCashFlow = investingBalanceFlow;

  const capitalDelta =
    state.capital.cet1 + state.capital.at1 - (inputState.capital.cet1 + inputState.capital.at1);
  const externalCapitalFlow = capitalDelta - capitalClose.netIncome;
  const financingCashFlow = financingLiabilityFlow + externalCapitalFlow;

  let operatingCashFlow = capitalClose.operatingCashDelta + operatingBalanceFlow;
  let cfMismatch = operatingCashFlow + investingCashFlow + financingCashFlow - netChange;

  const ROUNDING_EPS = 1e-2; // allow sub-penny floating noise in statement roll-ups
  if (Math.abs(cfMismatch) <= ROUNDING_EPS) {
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
  state.cashFlowStatement = cashFlowStatement;

  return { cashFlowStatement, cfMismatch };
};

/**
 * Validates post-step invariants and flags the bank as failed if they are violated.
 *
 * Invariants include both domain/accounting checks and a cash flow tie-out check.
 */
export const invariants = (
  state: BankState,
  events: SimulationEvent[],
  statements: BuildStatementsResult
): void => {
  checkInvariants(state).forEach((msg) => {
    events.push({ severity: 'error', message: `Invariant violated: ${msg}` });
    state.hasFailed = true;
  });

  const CF_TOLERANCE = 1;
  if (Math.abs(statements.cfMismatch) > CF_TOLERANCE) {
    events.push({
      severity: 'error',
      message: `Cash flow statement mismatch: operating ${statements.cashFlowStatement.operatingCashFlow.toFixed(
        2
      )} + investing ${statements.cashFlowStatement.investingCashFlow.toFixed(
        2
      )} + financing ${statements.cashFlowStatement.financingCashFlow.toFixed(
        2
      )} != net change ${statements.cashFlowStatement.netChange.toFixed(2)} (diff ${statements.cfMismatch.toFixed(6)})`,
    });
    state.hasFailed = true;
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
    const dtMonths = state.time.stepLengthMonths;
    const dtYears = dtMonths / MONTHS_IN_YEAR;
    const cashStart = findItem(inputState.balanceSheet, AssetProductType.CashReserves)?.balance ?? 0;

    syncLoanBalancesFromCohorts(state);
    const shockEffects = applyShocks(state, config, shocks, events);
    applyActions(state, config, actions, events);
    applyBehaviour(state, config, dtMonths, events);
    const cohortStep = stepLoanCohorts({
      state,
      config,
      dtMonths,
      pdMultiplier: shockEffects.pdMultiplier,
      lgdMultiplier: shockEffects.lgdMultiplier,
      extraLossesByProduct: shockEffects.extraLosses,
    });
    const accruals = accruePnL(state, dtYears);
    const losses = recogniseLosses(state, config, shockEffects, cohortStep.recognizedLoanLosses);
    const capitalClose = closeCapital(state, config, dtMonths, dtYears, accruals, losses, cohortStep.loanInterestIncome, events);
    computeMetrics(state, config, shockEffects.lcrOutflowMultiplier, events);
    const statements = buildStatements(inputState, state, cashStart, capitalClose, losses);
    invariants(state, events, statements);
    advanceUkMarketState(state.market, dtMonths);

    return { nextState: state, events };
  };

  return { step };
};
