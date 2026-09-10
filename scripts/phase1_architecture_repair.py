from pathlib import Path
import re

root = Path('.')


def read(path: str) -> str:
    return (root / path).read_text()


def write(path: str, text: str) -> None:
    p = root / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected exactly one match, found {count}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))


def regex_replace_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    new, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{path}: expected exactly one regex match, found {count}: {pattern[:100]!r}')
    write(path, new)


# Product capabilities: treasury mechanics are authored in the catalogue.
replace_once(
    'src/products/catalogue.ts',
    "export type WholesaleFundingTenorClass = 'short' | 'long';\n",
    "export type WholesaleFundingTenorClass = 'short' | 'long';\nexport type TreasuryAssetRateSource = 'bankRate' | 'giltCurve';\n",
)
replace_once(
    'src/products/catalogue.ts',
    "export interface WholesaleFundingCapability {\n  tenorClass: WholesaleFundingTenorClass;\n  issuable?: boolean;\n}\n\nexport interface ProductCapabilities {\n  customerDeposit?: CustomerDepositCapability;\n  loan?: LoanCapability;\n  wholesaleFunding?: WholesaleFundingCapability;\n}\n",
    "export interface WholesaleFundingCapability {\n  tenorClass: WholesaleFundingTenorClass;\n  issuable?: boolean;\n}\n\n/** Contractual/treasury behaviour authored once in the product catalogue. */\nexport interface TreasuryAssetCapability {\n  tradable?: boolean;\n  contractualMaturity?: boolean;\n  settlementAsset?: boolean;\n  rateSource?: TreasuryAssetRateSource;\n  permittedTenorMonths?: readonly number[];\n}\n\nexport interface ProductCapabilities {\n  customerDeposit?: CustomerDepositCapability;\n  loan?: LoanCapability;\n  wholesaleFunding?: WholesaleFundingCapability;\n  treasuryAsset?: TreasuryAssetCapability;\n}\n",
)
replace_once(
    'src/products/catalogue.ts',
    "  CashReserves: {\n    productType: 'CashReserves',\n    label: 'Cash & Reserves',\n    side: 'Asset',\n    capabilities: {},\n",
    "  CashReserves: {\n    productType: 'CashReserves',\n    label: 'Cash & Reserves',\n    side: 'Asset',\n    capabilities: {\n      treasuryAsset: { settlementAsset: true, rateSource: 'bankRate' },\n    },\n",
)
replace_once(
    'src/products/catalogue.ts',
    "  Gilts: {\n    productType: 'Gilts',\n    label: 'Gilts / Liquidity Portfolio',\n    side: 'Asset',\n    capabilities: {},\n",
    "  Gilts: {\n    productType: 'Gilts',\n    label: 'Gilts / Liquidity Portfolio',\n    side: 'Asset',\n    capabilities: {\n      treasuryAsset: {\n        tradable: true,\n        contractualMaturity: true,\n        rateSource: 'giltCurve',\n        permittedTenorMonths: [24, 60, 120],\n      },\n    },\n",
)
replace_once(
    'src/products/capabilities.ts',
    "export type WholesaleFundingProductType = ProductWithCapability<'wholesaleFunding'>;\n",
    "export type WholesaleFundingProductType = ProductWithCapability<'wholesaleFunding'>;\nexport type TreasuryAssetProductType = ProductWithCapability<'treasuryAsset'>;\n",
)

# Contractual asset ladders are separate from liability funding ladders.
replace_once(
    'src/domain/bankState.ts',
    "export interface FundingMaturityBucket {\n  tenorMonths: number;\n  monthsToMaturity: number;\n  notional: number;\n  rate: number;\n}\n\nexport type FundingLadderMap = Partial<Record<ProductType, FundingMaturityBucket[]>>;\n",
    "export interface ContractualMaturityBucket {\n  tenorMonths: number;\n  monthsToMaturity: number;\n  notional: number;\n  rate: number;\n}\n\n/** @deprecated Compatibility name for liability funding code and existing saves. */\nexport type FundingMaturityBucket = ContractualMaturityBucket;\nexport type FundingLadderMap = Partial<Record<ProductType, ContractualMaturityBucket[]>>;\nexport type AssetMaturityLadderMap = Partial<Record<ProductType, ContractualMaturityBucket[]>>;\n",
)
replace_once(
    'src/domain/bankState.ts',
    "export interface TreasuryPolicyState {\n  /** Target fraction of reserves + gilts held in gilts. */\n  giltShareOfHqla: number;\n  /** Target effective duration of the gilt portfolio. */\n  giltDurationYears: number;\n}\n",
    "export interface TreasuryPolicyState {\n  /** @deprecated Legacy descriptive target retained for save/replay compatibility. */\n  giltShareOfHqla: number;\n  /** @deprecated Legacy/default duration retained for old treasury-policy actions. */\n  giltDurationYears: number;\n}\n",
)
replace_once(
    'src/domain/bankState.ts',
    "  fundingLadders: FundingLadderMap;\n  status: SimulationStatus;\n",
    "  fundingLadders: FundingLadderMap;\n  /** Contractual maturity ladders for assets; separated from liability funding ladders. */\n  assetMaturityLadders?: AssetMaturityLadderMap;\n  status: SimulationStatus;\n",
)

# Generic transaction tenor; old maturityYears is replay-only compatibility.
replace_once(
    'src/domain/actions.ts',
    "  rate?: number;\n  /** Optional contractual maturity for purchases such as gilts. */\n  maturityYears?: number;\n",
    "  rate?: number;\n  /** Optional contractual tenor for securities/other term assets. */\n  tenorMonths?: number;\n  /** @deprecated Replay compatibility; new callers should use tenorMonths. */\n  maturityYears?: number;\n",
)
replace_once(
    'src/domain/actions.ts',
    "export interface SetTreasuryPolicyAction {\n",
    "/** @deprecated Legacy replay action. Live management uses explicit asset trades. */\nexport interface SetTreasuryPolicyAction {\n",
)

write(
    'src/domain/execution.ts',
    """import type { AssetProductType } from './enums';

export interface AssetTradeExecution {
  kind: 'assetTrade';
  productType: AssetProductType;
  side: 'buy' | 'sell';
  requestedAmount: number;
  executedAmount: number;
  tenorMonths?: number;
  executionRate?: number;
}

export interface StepExecutionResult {
  assetTrades: AssetTradeExecution[];
}

export const createEmptyStepExecutionResult = (): StepExecutionResult => ({ assetTrades: [] });
""",
)

# Clone separated asset ladders.
replace_once(
    'src/engine/clone.ts',
    "  BankState,\n  BehaviouralState,\n",
    "  AssetMaturityLadderMap,\n  BankState,\n  BehaviouralState,\n",
)
replace_once(
    'src/engine/clone.ts',
    "const cloneDate = (raw: unknown): Date => raw instanceof Date ? new Date(raw.getTime()) : new Date(raw as any);\n",
    "const cloneAssetMaturityLadders = (raw: AssetMaturityLadderMap | undefined): AssetMaturityLadderMap => {\n  const out: AssetMaturityLadderMap = {};\n  const entries = Object.entries(raw ?? {}) as Array<[ProductType, Array<{ tenorMonths: number; monthsToMaturity: number; notional: number; rate: number }>] >;\n  entries.forEach(([productType, buckets]) => {\n    out[productType] = (buckets ?? []).map((bucket) => ({ ...bucket }));\n  });\n  return out;\n};\n\nconst cloneDate = (raw: unknown): Date => raw instanceof Date ? new Date(raw.getTime()) : new Date(raw as any);\n",
)
replace_once(
    'src/engine/clone.ts',
    "  fundingLadders: cloneFundingLadders(state.fundingLadders),\n  status: { ...state.status },\n",
    "  fundingLadders: cloneFundingLadders(state.fundingLadders),\n  assetMaturityLadders: cloneAssetMaturityLadders(state.assetMaturityLadders),\n  status: { ...state.status },\n",
)

# Seed gilt vintages in the asset ladder map.
gilt_block = """    // Reuse the generic contractual ladder map for the opening gilt vintages. The engine will
    // progressively mature these into reserves; no reinvestment is implied by the ladder itself.
    [AssetProductType.Gilts]: Array.from({ length: 120 }, (_, i) => ({
      tenorMonths: 120,
      monthsToMaturity: i + 1,
      notional: 10e6,
      rate: 0.041,
    })),
"""
replace_once('src/config/initialState.ts', gilt_block, '')
replace_once(
    'src/config/initialState.ts',
    "  fundingLadders: {\n",
    "  assetMaturityLadders: {\n    [AssetProductType.Gilts]: Array.from({ length: 120 }, (_, i) => ({\n      tenorMonths: 120,\n      monthsToMaturity: i + 1,\n      notional: 10e6,\n      rate: 0.041,\n    })),\n  },\n  fundingLadders: {\n",
)

# Capability-driven lifecycle. It consumes structured executions, never event strings.
write(
    'src/engine/contractualAssetLifecycle.ts',
    """import type { BankState, ContractualMaturityBucket } from '../domain/bankState';
import type { ProductType } from '../domain/enums';
import type { AssetTradeExecution } from '../domain/execution';
import { PRODUCTS } from '../products/catalogue';
import { getCapability, productsWithCapability } from '../products/capabilities';
import { nelsonSiegelYield } from './ukMarketModel';
import type { SimulationEvent } from './simulation';

const EPS = 1e-9;
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const findPosition = (state: BankState, productType: ProductType) =>
  state.financial.balanceSheet.items.find((item) => item.productType === productType);

const settlementAssetType = (): ProductType | undefined =>
  productsWithCapability('treasuryAsset').find(
    (product) => product.capabilities.treasuryAsset?.settlementAsset
  )?.productType;

export const syncFloatingTreasuryAssetRates = (state: BankState): void => {
  productsWithCapability('treasuryAsset').forEach((product) => {
    const capability = product.capabilities.treasuryAsset;
    if (capability?.rateSource !== 'bankRate') return;
    const position = findPosition(state, product.productType);
    if (position) position.interestRate = Math.max(0, state.market.baseRate);
  });
};

const quotedRate = (state: BankState, productType: ProductType, tenorMonths: number): number => {
  const capability = getCapability(productType, 'treasuryAsset');
  if (capability?.rateSource === 'bankRate') return Math.max(0, state.market.baseRate);
  if (capability?.rateSource === 'giltCurve') {
    return Math.max(0, nelsonSiegelYield(state.market.giltCurve.nelsonSiegel, clamp(tenorMonths / 12, 0.25, 30)));
  }
  return Math.max(0, findPosition(state, productType)?.interestRate ?? 0);
};

const openingBuckets = (state: BankState, productType: ProductType): ContractualMaturityBucket[] => {
  const modern = state.assetMaturityLadders?.[productType];
  if (modern) return modern.map((bucket) => ({ ...bucket }));
  // Existing Phase-1 saves briefly stored asset maturities in fundingLadders.
  return (state.fundingLadders?.[productType] ?? []).map((bucket) => ({ ...bucket }));
};

const scaleBuckets = (buckets: ContractualMaturityBucket[], factor: number): ContractualMaturityBucket[] =>
  buckets
    .map((bucket) => ({ ...bucket, notional: Math.max(0, bucket.notional * factor) }))
    .filter((bucket) => bucket.notional > 1);

const weightedRate = (buckets: readonly ContractualMaturityBucket[], fallback: number): number => {
  const total = buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
  return total > 0
    ? buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.notional) * Math.max(0, bucket.rate), 0) / total
    : fallback;
};

const weightedRemainingYears = (buckets: readonly ContractualMaturityBucket[], fallback: number): number => {
  const total = buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
  return total > 0
    ? buckets.reduce((sum, bucket) => sum + Math.max(0, bucket.notional) * Math.max(1, bucket.monthsToMaturity), 0) / total / 12
    : fallback;
};

const lifecycleEvent = (productType: ProductType, message: string, step: number): SimulationEvent => ({
  id: `asset-maturity-${productType}-${step}-${Date.now()}`,
  severity: 'info',
  message,
  timestamp: Date.now(),
  tags: ['market', 'liquidity'],
});

export interface ContractualAssetLifecycleResult {
  maturedNotional: number;
  maturedCarryingValue: number;
}

/**
 * Month-end contractual asset stage in the authoritative engine pipeline.
 * Product capabilities decide which assets participate. Structured action executions provide the
 * actual settlement amount and tenor; human-readable events are output only and are never parsed.
 */
export const advanceContractualAssetLifecycle = (args: {
  openingState: BankState;
  closingState: BankState;
  executions: readonly AssetTradeExecution[];
  events: SimulationEvent[];
  dtMonths: number;
}): ContractualAssetLifecycleResult => {
  const { openingState, closingState, executions, events } = args;
  const dtMonths = Math.max(1, Math.round(args.dtMonths));
  const settlementType = settlementAssetType();
  const settlementPosition = settlementType ? findPosition(closingState, settlementType) : undefined;
  let maturedNotionalTotal = 0;
  let maturedCarryingValueTotal = 0;

  for (const product of productsWithCapability('treasuryAsset')) {
    const capability = product.capabilities.treasuryAsset;
    if (!capability?.contractualMaturity) continue;
    const productType = product.productType;
    const openingPosition = findPosition(openingState, productType);
    const closingPosition = findPosition(closingState, productType);
    if (!openingPosition || !closingPosition || !settlementPosition || !settlementType) continue;

    let buckets = openingBuckets(openingState, productType);
    const trades = executions.filter(
      (execution) => execution.productType === productType && execution.executedAmount > EPS
    );
    const netTrade = trades.reduce(
      (sum, trade) => sum + (trade.side === 'buy' ? trade.executedAmount : -trade.executedAmount),
      0
    );
    let carryingCursor = Math.max(0, closingPosition.balance - netTrade);
    const fallbackTenor = Math.max(3, Math.round(capability.permittedTenorMonths?.[0] ?? 60));

    for (const trade of trades) {
      if (trade.side === 'buy') {
        const requestedTenor = Math.max(3, Math.round(trade.tenorMonths ?? fallbackTenor));
        const permitted = capability.permittedTenorMonths;
        const tenorMonths = permitted?.length && !permitted.includes(requestedTenor)
          ? permitted.reduce(
              (best, tenor) => Math.abs(tenor - requestedTenor) < Math.abs(best - requestedTenor) ? tenor : best,
              permitted[0]
            )
          : requestedTenor;
        buckets.push({
          tenorMonths,
          monthsToMaturity: tenorMonths,
          notional: trade.executedAmount,
          rate: trade.executionRate ?? quotedRate(openingState, productType, tenorMonths),
        });
        carryingCursor += trade.executedAmount;
      } else {
        const saleFraction = carryingCursor > EPS ? clamp(trade.executedAmount / carryingCursor, 0, 1) : 1;
        buckets = scaleBuckets(buckets, 1 - saleFraction);
        carryingCursor = Math.max(0, carryingCursor - trade.executedAmount);
      }
    }

    const aged = buckets.map((bucket) => ({
      ...bucket,
      monthsToMaturity: bucket.monthsToMaturity - dtMonths,
    }));
    const matured = aged.filter((bucket) => bucket.monthsToMaturity <= 0);
    const survivors = aged.filter((bucket) => bucket.monthsToMaturity > 0);
    const maturedNotional = matured.reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
    const totalNotionalBeforeMaturity = aged.reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
    const maturityFraction = totalNotionalBeforeMaturity > EPS
      ? clamp(maturedNotional / totalNotionalBeforeMaturity, 0, 1)
      : 0;
    const beforeBalance = Math.max(0, closingPosition.balance);
    const maturedCarryingValue = Math.min(beforeBalance, beforeBalance * maturityFraction);

    closingState.assetMaturityLadders ??= {};
    closingState.assetMaturityLadders[productType] = survivors;
    if (closingState.fundingLadders?.[productType]) delete closingState.fundingLadders[productType];

    if (maturedCarryingValue > 0) {
      closingPosition.balance = Math.max(0, beforeBalance - maturedCarryingValue);
      settlementPosition.balance += maturedCarryingValue;
      if (closingPosition.security) {
        closingPosition.security.amortisedCost = Math.max(
          0,
          (closingPosition.security.amortisedCost ?? beforeBalance) * (1 - maturityFraction)
        );
        closingPosition.security.lossAllowance = Math.max(
          0,
          (closingPosition.security.lossAllowance ?? 0) * (1 - maturityFraction)
        );
        closingPosition.security.pendingRecycling = Math.max(
          0,
          (closingPosition.security.pendingRecycling ?? 0) * (1 - maturityFraction)
        );
      }
      if (closingPosition.encumbrance?.encumberedAmount) {
        closingPosition.encumbrance.encumberedAmount = Math.max(
          0,
          closingPosition.encumbrance.encumberedAmount * (1 - maturityFraction)
        );
      }
      events.push(lifecycleEvent(
        productType,
        `${PRODUCTS[productType].label} principal matured into ${PRODUCTS[settlementType].label}: £${(maturedCarryingValue / 1e6).toFixed(1)}m; proceeds left uninvested`,
        closingState.time.step
      ));
    }

    if (survivors.length > 0) {
      closingPosition.interestRate = weightedRate(survivors, closingPosition.interestRate);
      if (closingPosition.security) {
        closingPosition.security.effectiveDurationYears = weightedRemainingYears(
          survivors,
          closingPosition.security.effectiveDurationYears ?? fallbackTenor / 12
        );
      }
    } else if (closingPosition.balance <= EPS) {
      closingPosition.interestRate = 0;
      if (closingPosition.security) closingPosition.security.effectiveDurationYears = 0.25;
    }

    maturedNotionalTotal += maturedNotional;
    maturedCarryingValueTotal += maturedCarryingValue;
  }

  return { maturedNotional: maturedNotionalTotal, maturedCarryingValue: maturedCarryingValueTotal };
};
""",
)

# Structured settlements + core lifecycle stage.
replace_once(
    'src/engine/simulation.ts',
    "import { StepAttribution } from '../domain/attribution';\nimport { applyFeatureFlagsToConfig, resolveFeatureFlags } from './featureFlags';\n",
    "import { StepAttribution } from '../domain/attribution';\nimport { createEmptyStepExecutionResult, type AssetTradeExecution, type StepExecutionResult } from '../domain/execution';\nimport { applyFeatureFlagsToConfig, resolveFeatureFlags } from './featureFlags';\nimport { advanceContractualAssetLifecycle, syncFloatingTreasuryAssetRates } from './contractualAssetLifecycle';\n",
)
replace_once(
    'src/engine/simulation.ts',
    "interface ActionContext {\n  state: BankState;\n  config: SimulationConfig;\n  events: SimulationEvent[];\n}\n",
    "interface ActionContext {\n  state: BankState;\n  config: SimulationConfig;\n  events: SimulationEvent[];\n  executions: StepExecutionResult;\n}\n",
)
replace_once(
    'src/engine/simulation.ts',
    "  buySellAsset: (action: BuySellAssetAction, ctx) => {\n    applyBuySellAsset(ctx.state, ctx.config, action.productType, action.amountDelta, ctx.events);\n  },\n",
    "  buySellAsset: (action: BuySellAssetAction, ctx) => {\n    const tenorMonths = action.tenorMonths ?? (action.maturityYears !== undefined ? Math.round(action.maturityYears * 12) : undefined);\n    const execution = applyBuySellAsset(ctx.state, ctx.config, action.productType, action.amountDelta, ctx.events, tenorMonths);\n    if (execution) ctx.executions.assetTrades.push(execution);\n  },\n",
)
replace_once(
    'src/engine/simulation.ts',
    "    if (changed) applyTreasuryPolicy(ctx.state, ctx.config, ctx.events);\n",
    "    if (changed) {\n      const execution = applyTreasuryPolicy(ctx.state, ctx.config, ctx.events);\n      if (execution) ctx.executions.assetTrades.push(execution);\n    }\n",
)
replace_once(
    'src/engine/simulation.ts',
    "export interface SimulationStepOutput {\n  nextState: BankState;\n  events: SimulationEvent[];\n  diagnostics: SimulationDiagnostics;\n}\n",
    "export interface SimulationStepOutput {\n  nextState: BankState;\n  events: SimulationEvent[];\n  diagnostics: SimulationDiagnostics;\n  /** Structured settlements/results. Events remain presentation only. */\n  executions: StepExecutionResult;\n}\n",
)
replace_once(
    'src/engine/simulation.ts',
    "export const applyActions = (\n  state: BankState,\n  config: SimulationConfig,\n  actions: PlayerAction[],\n  events: SimulationEvent[]\n): void => {\n  ensureFundingLadders(state, config);\n  const actionContext: ActionContext = { state, config, events };\n",
    "export const applyActions = (\n  state: BankState,\n  config: SimulationConfig,\n  actions: PlayerAction[],\n  events: SimulationEvent[]\n): StepExecutionResult => {\n  ensureFundingLadders(state, config);\n  const executions = createEmptyStepExecutionResult();\n  const actionContext: ActionContext = { state, config, events, executions };\n",
)
replace_once(
    'src/engine/simulation.ts',
    "    dispatchAction(action, actionContext);\n  });\n};\n\nexport interface FundingLifecycleResult {\n",
    "    dispatchAction(action, actionContext);\n  });\n  return executions;\n};\n\nexport interface FundingLifecycleResult {\n",
)

regex_replace_once(
    'src/engine/simulation.ts',
    r"const applyTreasuryPolicy = \(state: BankState, config: SimulationConfig, events: SimulationEvent\[\]\): void => \{.*?\n\};\n\nconst stepContractualRetailFunding",
    """const applyTreasuryPolicy = (state: BankState, config: SimulationConfig, events: SimulationEvent[]): AssetTradeExecution | undefined => {
  const policy = state.behaviour.treasuryPolicy;
  if (!policy) return undefined;
  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  const gilts = findItem(state.financial.balanceSheet, AssetProductType.Gilts);
  if (!cash || !gilts) return undefined;
  const total = Math.max(0, cash.balance) + Math.max(0, gilts.balance);
  const targetShare = clamp(policy.giltShareOfHqla, 0, 1);
  const currentShare = total > 0 ? Math.max(0, gilts.balance) / total : 0;
  const tolerance = 0.05;
  let desiredShare = currentShare;
  if (currentShare < targetShare - tolerance) desiredShare = targetShare - tolerance;
  if (currentShare > targetShare + tolerance) desiredShare = targetShare + tolerance;
  const delta = total * desiredShare - gilts.balance;
  const execution = Math.abs(delta) > 1e4
    ? applyBuySellAsset(state, config, AssetProductType.Gilts, delta, events, Math.round(policy.giltDurationYears * 12))
    : undefined;
  if (gilts.security) gilts.security.effectiveDurationYears = clamp(policy.giltDurationYears, .25, 15);
  return execution;
};

const stepContractualRetailFunding""",
)

regex_replace_once(
    'src/engine/simulation.ts',
    r"const applyBuySellAsset = \(\n  state: BankState,\n  config: SimulationConfig,\n  productType: AssetProductType,\n  amountDelta: number,\n  events: SimulationEvent\[\]\n\): void => \{.*?\n\};\n\n/\*\*\n \* Ensures a balance-sheet line exists",
    """const applyBuySellAsset = (
  state: BankState,
  config: SimulationConfig,
  productType: AssetProductType,
  amountDelta: number,
  events: SimulationEvent[],
  tenorMonths?: number
): AssetTradeExecution | undefined => {
  const asset = findItem(state.financial.balanceSheet, productType);
  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  if (!asset || !cash) return undefined;

  const product = PRODUCTS[productType];
  const requestedAmount = Math.abs(amountDelta);
  const side: 'buy' | 'sell' = amountDelta >= 0 ? 'buy' : 'sell';

  if (product?.behaviour?.isLoan) {
    const params = config.productParameters[productType];
    if (amountDelta >= 0) {
      const executed = upsertOriginationCohort({
        state,
        config,
        productType,
        cohortId: state.time.step,
        principal: requestedAmount,
        annualInterestRate: asset.interestRate,
        annualPd: params.baseDefaultRate,
        lgd: params.lossGivenDefault,
      });
      if (executed + 1e-6 < requestedAmount) {
        events.push(createEvent('warning', `Insufficient cash to buy ${productType}: requested ${requestedAmount.toFixed(2)}, executed ${executed.toFixed(2)}`));
      }
      events.push(createEvent('info', `Bought ${productType}: +${executed.toFixed(2)}, cash -${executed.toFixed(2)}`));
      return { kind: 'assetTrade', productType, side, requestedAmount, executedAmount: executed, tenorMonths, executionRate: asset.interestRate };
    }
    const executed = applyExtraPrepayment({ state, productType, amount: requestedAmount });
    events.push(createEvent('info', `Sold ${productType}: -${executed.toFixed(2)}, cash +${executed.toFixed(2)}`));
    return { kind: 'assetTrade', productType, side, requestedAmount, executedAmount: executed, tenorMonths, executionRate: asset.interestRate };
  }

  const treasuryCapability = product?.capabilities.treasuryAsset;
  if (!treasuryCapability?.tradable) {
    events.push(createEvent('warning', `${product?.label ?? productType} is not directly tradable.`));
    return undefined;
  }

  if (amountDelta >= 0) {
    const executed = Math.min(requestedAmount, Math.max(0, cash.balance));
    if (asset.security) asset.security.amortisedCost = (asset.security.amortisedCost ?? asset.balance) + executed;
    asset.balance += executed;
    cash.balance -= executed;
    if (executed + 1e-6 < requestedAmount) {
      events.push(createEvent('warning', `Insufficient cash to buy ${productType}: requested ${requestedAmount.toFixed(2)}, executed ${executed.toFixed(2)}`));
    }
    events.push(createEvent('info', `Bought ${productType}: +${executed.toFixed(2)}, cash -${executed.toFixed(2)}`));
    return { kind: 'assetTrade', productType, side, requestedAmount, executedAmount: executed, tenorMonths };
  }

  const executed = Math.min(
    Math.max(0, asset.balance - (asset.encumbrance?.encumberedAmount ?? 0)),
    requestedAmount
  );
  if (asset.security && asset.balance > 0) {
    const security = asset.security;
    const fraction = executed / asset.balance;
    const cost = security.amortisedCost ?? asset.balance;
    if (security.classification === 'FVOCI') {
      security.pendingRecycling = (security.pendingRecycling ?? 0) + (asset.balance - cost + (security.lossAllowance ?? 0)) * fraction;
    }
    security.amortisedCost = cost * (1 - fraction);
    security.lossAllowance = (security.lossAllowance ?? 0) * (1 - fraction);
  }
  asset.balance -= executed;
  adjustCashOrFail(state, executed, events);
  events.push(createEvent('info', `Sold ${productType}: -${executed.toFixed(2)}, cash +${executed.toFixed(2)}`));
  return { kind: 'assetTrade', productType, side, requestedAmount, executedAmount: executed, tenorMonths };
};

/**
 * Ensures a balance-sheet line exists""",
)

replace_once(
    'src/engine/simulation.ts',
    "    const dtYears = dtMonths / MONTHS_IN_YEAR;\n    const cashStart = findItem(inputState.financial.balanceSheet, AssetProductType.CashReserves)?.balance ?? 0;\n\n    syncLoanBalancesFromCohorts(state);\n",
    "    const dtYears = dtMonths / MONTHS_IN_YEAR;\n    const cashStart = findItem(inputState.financial.balanceSheet, AssetProductType.CashReserves)?.balance ?? 0;\n\n    // Floating treasury assets reprice at the start of the accrual period.\n    syncFloatingTreasuryAssetRates(state);\n    syncLoanBalancesFromCohorts(state);\n",
)
replace_once(
    'src/engine/simulation.ts',
    "    applyActions(state, activeConfig, actions, events);\n",
    "    const actionExecutions = applyActions(state, activeConfig, actions, events);\n",
)
replace_once(
    'src/engine/simulation.ts',
    "        };\n\n    const supervisoryCloseMetrics = calculateRiskMetrics({\n",
    "        };\n\n    // Contractual asset maturity is part of the month-end close, before final metrics/statements.\n    advanceContractualAssetLifecycle({\n      openingState: inputState,\n      closingState: state,\n      executions: actionExecutions.assetTrades,\n      events,\n      dtMonths,\n    });\n\n    const supervisoryCloseMetrics = calculateRiskMetrics({\n",
)
replace_once(
    'src/engine/simulation.ts',
    "    advanceUkMarketState(state.market, dtMonths);\n\n    if (fundingLifecycle.maturingNotional > 0) {\n",
    "    advanceUkMarketState(state.market, dtMonths);\n    // Expose the newly prevailing Bank Rate without changing the closed period's P&L.\n    syncFloatingTreasuryAssetRates(state);\n\n    if (fundingLifecycle.maturingNotional > 0) {\n",
)
replace_once(
    'src/engine/simulation.ts',
    "    return { nextState: state, events, diagnostics };\n",
    "    return { nextState: state, events, diagnostics, executions: actionExecutions };\n",
)

# All callers use the authoritative engine; remove parallel wrapper and old lifecycle implementation.
for p in root.rglob('*'):
    if not p.is_file() or p.suffix not in {'.ts', '.tsx', '.md'}:
        continue
    text = p.read_text()
    updated = text.replace('createSimulationEngineWithTreasuryLifecycle', 'createSimulationEngine')
    updated = updated.replace("'./simulationFacade'", "'./simulation'")
    updated = updated.replace("'../engine/simulationFacade'", "'../engine/simulation'")
    if updated != text:
        p.write_text(updated)

for obsolete in ['src/engine/simulationFacade.ts', 'src/engine/treasuryLifecycle.ts']:
    p = root / obsolete
    if p.exists():
        p.unlink()

# New management callers use tenorMonths; old replay payloads still accept maturityYears.
app = root / 'src/App.tsx'
text = app.read_text()
text = re.sub(
    r'maturityYears:\s*values\.giltDurationYears',
    'tenorMonths:Math.round(values.giltDurationYears * 12)',
    text,
)
app.write_text(text)

# Focused lifecycle regression asserts structured settlement and separated asset ladders.
write(
    'src/engine/treasuryLifecycle.test.ts',
    """import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { nelsonSiegelYield } from './ukMarketModel';
import { createSimulationEngine } from './simulation';

const item = (state: typeof initialState, product: AssetProductType) =>
  state.financial.balanceSheet.items.find((row) => row.productType === product)!;

describe('Contractual treasury asset lifecycle', () => {
  it('reprices the settlement asset to Bank Rate without making an investment decision', () => {
    const state = cloneBankState(initialState);
    state.market.baseRate = 0.031;
    item(state, AssetProductType.CashReserves).interestRate = 0.09;
    const { nextState, events } = createSimulationEngine().step({ state, config: baseConfig, actions: [], shocks: [] });
    expect(item(nextState, AssetProductType.CashReserves).interestRate).toBeCloseTo(nextState.market.baseRate, 12);
    expect(events.some((event) => /^Bought Gilts:|^Sold Gilts:/i.test(event.message))).toBe(false);
  });

  it('matures an opening gilt vintage into reserves inside the authoritative close', () => {
    const state = cloneBankState(initialState);
    const openingGilts = item(state, AssetProductType.Gilts).balance;
    const { nextState, events } = createSimulationEngine().step({ state, config: baseConfig, actions: [], shocks: [] });
    const giltBuckets = nextState.assetMaturityLadders?.[AssetProductType.Gilts] ?? [];
    expect(giltBuckets).toHaveLength(119);
    expect(giltBuckets.every((bucket) => bucket.monthsToMaturity > 0)).toBe(true);
    expect(nextState.fundingLadders[AssetProductType.Gilts]).toBeUndefined();
    expect(item(nextState, AssetProductType.Gilts).balance).toBeLessThan(openingGilts);
    expect(events.some((event) => event.message.includes('principal matured into Cash & Reserves'))).toBe(true);
    expect(nextState.financial.cashFlowStatement.cashEnd).toBeCloseTo(item(nextState, AssetProductType.CashReserves).balance, 2);
  });

  it('records an explicit gilt purchase at its selected curve tenor', () => {
    const state = cloneBankState(initialState);
    const expectedYield = nelsonSiegelYield(state.market.giltCurve.nelsonSiegel, 2);
    const { nextState, executions } = createSimulationEngine().step({
      state,
      config: baseConfig,
      actions: [{ type: 'buySellAsset', productType: AssetProductType.Gilts, amountDelta: 100e6, tenorMonths: 24 }],
      shocks: [],
    });
    const execution = executions.assetTrades.find((trade) => trade.productType === AssetProductType.Gilts);
    const purchased = (nextState.assetMaturityLadders?.[AssetProductType.Gilts] ?? []).find((bucket) => bucket.tenorMonths === 24);
    expect(execution?.executedAmount).toBeCloseTo(100e6, 2);
    expect(purchased).toBeDefined();
    expect(purchased?.notional).toBeCloseTo(execution!.executedAmount, 2);
    expect(purchased?.rate).toBeCloseTo(expectedYield, 10);
  });

  it('uses the structured settlement amount when a purchase is clipped by reserves', () => {
    const state = cloneBankState(initialState);
    const { nextState, executions, events } = createSimulationEngine().step({
      state,
      config: baseConfig,
      actions: [{ type: 'buySellAsset', productType: AssetProductType.Gilts, amountDelta: 10e9, tenorMonths: 60 }],
      shocks: [],
    });
    const execution = executions.assetTrades.find((trade) => trade.productType === AssetProductType.Gilts);
    const purchased = (nextState.assetMaturityLadders?.[AssetProductType.Gilts] ?? []).find((bucket) => bucket.tenorMonths === 60);
    expect(events.some((event) => event.message.includes('Insufficient cash to buy Gilts'))).toBe(true);
    expect(execution?.requestedAmount).toBe(10e9);
    expect(execution?.executedAmount ?? 0).toBeGreaterThan(0);
    expect(execution?.executedAmount ?? 0).toBeLessThan(10e9);
    expect(purchased?.notional).toBeCloseTo(execution!.executedAmount, 2);
  });
});
""",
)

old_readme = root / 'src/engine/README_treasury_lifecycle.md'
if old_readme.exists():
    old_readme.unlink()
write(
    'src/engine/README_contractual_asset_lifecycle.md',
    """# Contractual asset lifecycle

Contractual treasury-asset mechanics run inside `createSimulationEngine().step()` as part of the authoritative month-end close. There is no wrapper simulation path.

The product catalogue owns the behaviour flags that determine whether an asset is a floating settlement asset, tradable, or contractually maturing. `applyActions()` emits structured execution records containing requested and actually-settled notionals plus tenor; lifecycle code consumes those records directly. Human-readable events are presentation output only and are never parsed back into economic state.

Asset maturity ladders live in `BankState.assetMaturityLadders`; `fundingLadders` is reserved for liabilities. Existing Phase-1 saves that stored asset ladders under `fundingLadders` are migrated on the first lifecycle close.

The legacy `setTreasuryPolicy` action remains only for replay/backward compatibility. The live management surface uses explicit one-off asset trades.
""",
)

# Fail if the old architectural shortcuts survive anywhere in TypeScript.
stale = []
for p in root.rglob('*.ts*'):
    text = p.read_text()
    if 'simulationFacade' in text or 'parseGiltTradeEvents' in text or 'match(/^Bought Gilts' in text:
        stale.append(str(p))
if stale:
    raise RuntimeError(f'stale facade/event parsing references: {stale}')
