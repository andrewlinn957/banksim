import type { BankState } from '../domain/bankState';
import type { PlayerSessionState } from './playerSession';
import { isPlayerOneOffTransactionAction, playerTransactionKindForAction } from './playerTransactions';
import { AssetProductType } from '../domain/enums';
import { getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';

const SESSION_CODEC_ID = 'banksim-player-session';
export const PLAYER_SESSION_CODEC_VERSION = 2;

type EncodedNode = ['null']
  | ['undefined']
  | ['string', string]
  | ['boolean', boolean]
  | ['number', string]
  | ['date', string]
  | ['array', EncodedNode[]]
  | ['object', Array<[string, EncodedNode]>];

const encodeNode = (
  value: unknown,
  ancestors = new Set<object>(),
  sortObjectKeys = false,
): EncodedNode => {
  if (value === null) return ['null'];
  if (value === undefined) return ['undefined'];
  if (typeof value === 'string') return ['string', value];
  if (typeof value === 'boolean') return ['boolean', value];
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Session codec rejects non-finite numbers');
    return ['number', Object.is(value, -0) ? '-0' : value.toString()];
  }
  if (typeof value !== 'object') throw new Error(`Session codec rejects ${typeof value} values`);

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('Session codec rejects invalid dates');
    return ['date', value.toISOString()];
  }
  if (ancestors.has(value)) throw new Error('Session codec rejects cyclic values');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error('Session codec supports only arrays, plain objects and Date values');
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) return ['array', value.map((entry) => encodeNode(entry, nextAncestors, sortObjectKeys))];
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (sortObjectKeys) keys.sort();
  return ['object', keys.map((key) => [key, encodeNode(record[key], nextAncestors, sortObjectKeys)])];
};

const decodeNode = (node: unknown, depth = 0): unknown => {
  if (depth > 256 || !Array.isArray(node) || typeof node[0] !== 'string') {
    throw new Error('Invalid session codec node');
  }
  const [tag, payload] = node;
  switch (tag) {
    case 'null':
      if (node.length !== 1) throw new Error('Invalid null node');
      return null;
    case 'undefined':
      if (node.length !== 1) throw new Error('Invalid undefined node');
      return undefined;
    case 'string':
      if (node.length !== 2 || typeof payload !== 'string') throw new Error('Invalid string node');
      return payload;
    case 'boolean':
      if (node.length !== 2 || typeof payload !== 'boolean') throw new Error('Invalid boolean node');
      return payload;
    case 'number':
      if (node.length !== 2 || typeof payload !== 'string') throw new Error('Invalid number node');
      if (payload === '-0') return -0;
      if (payload.trim() === '') throw new Error('Invalid number node');
      {
        const number = Number(payload);
        if (!Number.isFinite(number) || number.toString() !== payload) throw new Error('Invalid number node');
        return number;
      }
    case 'date': {
      if (node.length !== 2 || typeof payload !== 'string') throw new Error('Invalid date node');
      const date = new Date(payload);
      if (!Number.isFinite(date.getTime()) || date.toISOString() !== payload) throw new Error('Invalid encoded date');
      return date;
    }
    case 'array':
      if (node.length !== 2 || !Array.isArray(payload)) throw new Error('Invalid array node');
      return payload.map((entry) => decodeNode(entry, depth + 1));
    case 'object': {
      if (node.length !== 2 || !Array.isArray(payload)) throw new Error('Invalid object node');
      const result: Record<string, unknown> = {};
      for (const entry of payload) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || Object.hasOwn(result, entry[0])) {
          throw new Error('Invalid or repeated session object key');
        }
        Object.defineProperty(result, entry[0], {
          value: decodeNode(entry[1], depth + 1),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return result;
    }
    default:
      throw new Error(`Unknown session codec tag: ${tag}`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const assertSimulationConfig: (value: unknown) => void = (value) => {
  if (!isRecord(value) || typeof value.version !== 'string' || value.version.length === 0 ||
      !isRecord(value.global) || !isRecord(value.productParameters) ||
      !isRecord(value.riskLimits) || !isRecord(value.behaviour) ||
      !isRecord(value.shockParameters) || !isRecord(value.shockParameters.idiosyncraticRun) ||
      !isRecord(value.tolerances)) {
    throw new Error('Invalid simulation config in player session');
  }
  if (value.featureFlags !== undefined && (!isRecord(value.featureFlags) ||
      Object.values(value.featureFlags).some((flag) => typeof flag !== 'boolean'))) {
    throw new Error('Invalid simulation feature flags in player session');
  }
  const limits = value.riskLimits;
  if (!isFiniteNumber(limits.minCet1Ratio) || !isFiniteNumber(limits.minLeverageRatio) ||
      !isFiniteNumber(limits.minLcr) || !isFiniteNumber(limits.minNsfr) ||
      !isRecord(limits.capitalBufferStack) || !isRecord(limits.capitalPolicy) || !isRecord(limits.concentration)) {
    throw new Error('Invalid risk limits in player session config');
  }
  for (const [product, parameters] of Object.entries(value.productParameters)) {
    if (!product || !isRecord(parameters) || parameters.productType !== product ||
        !isFiniteNumber(parameters.baseDefaultRate) || !isFiniteNumber(parameters.lossGivenDefault) ||
        !isFiniteNumber(parameters.volumeElasticityToRate)) {
      throw new Error(`Invalid product parameters for ${product || 'unknown product'}`);
    }
  }
};

const assertActionForm: (value: unknown) => void = (value) => {
  const stringFields = [
    'retailCurrentAccountRate', 'termDepositRate', 'termDepositTenorMonths', 'corporateDepositRate',
    'mortgageRate', 'consumerLoanRate', 'corporateLoanRate', 'mortgageUnderwritingTightness',
    'consumerUnderwritingTightness', 'corporateUnderwritingTightness', 'mortgageMaxLtv',
    'mortgageFixedPeriodMonths', 'capitalMarketsTargetAmount', 'capitalMarketsMaxDiscount',
    'capitalMarketsMaxSpreadBps', 'capitalMarketsTenorMonths', 'dividendPayoutRatio',
    'giltTradeAmount', 'giltDurationYears', 'boeFundingAmount', 'hedgeNotional',
    'hedgeFixedRate', 'hedgeMaturityMonths',
  ];
  if (!isRecord(value) || stringFields.some((field) => typeof value[field] !== 'string') ||
      !['auto', 'pay', 'skip'].includes(String(value.at1CouponMode)) ||
      !['none', 'cet1', 'at1', 'tier2', 'senior'].includes(String(value.capitalMarketsInstrument)) ||
      !['none', 'buy', 'sell'].includes(String(value.giltTradeDirection)) ||
      !['none', 'STR', 'ILTR'].includes(String(value.boeFacility)) ||
      !['none', 'payFixedReceiveFloat', 'receiveFixedPayFloat'].includes(String(value.hedgeDirection))) {
    throw new Error('Invalid player action form in session');
  }
};

const SUPPORTED_ACTION_TYPES = new Set([
  'setRiskAppetite', 'adjustRate', 'buySellAsset', 'launchCapitalMarketsTransaction', 'drawBoeFunding',
  'setUnderwriting', 'setMortgagePolicy', 'setTermDepositPolicy', 'enterHedge', 'setCapitalPolicy',
  'modifyLoanCohort', 'purchasePociLoan', 'revisePociLoan', 'originateBorrowerLoan',
  'setBorrowerPayment', 'derecognizeLoanCohort',
]);

const assertTimeline: (value: unknown) => void = (value) => {
  if (!Array.isArray(value)) throw new Error('Invalid player timeline');
  value.forEach((entry) => {
    if (!isRecord(entry) || !Number.isSafeInteger(entry.step) || !Array.isArray(entry.actions) || !Array.isArray(entry.shocks) ||
        entry.actions.some((action) => !isRecord(action) || typeof action.type !== 'string' || !SUPPORTED_ACTION_TYPES.has(action.type)) ||
        entry.shocks.some((shock) => !isRecord(shock) || typeof shock.type !== 'string')) {
      throw new Error('Invalid player timeline entry');
    }
  });
};

const assertEventLog: (value: unknown) => void = (value) => {
  if (!Array.isArray(value) || value.some((event) => !isRecord(event) || typeof event.id !== 'string' ||
      !['info', 'warning', 'error'].includes(String(event.severity)) || typeof event.message !== 'string' ||
      !isFiniteNumber(event.timestamp) || (event.tags !== undefined &&
        (!Array.isArray(event.tags) || event.tags.some((tag) => typeof tag !== 'string'))))) {
    throw new Error('Invalid player event log');
  }
};

const assertSnapshots: (value: unknown) => void = (value) => {
  const numericFields = ['cet1Ratio', 'lcr', 'nsfr', 'roe', 'nim', 'netIncome', 'sharePrice', 'marketCap'];
  if (!Array.isArray(value) || value.some((snapshot) => !isRecord(snapshot) || !Number.isSafeInteger(snapshot.step) ||
      numericFields.some((field) => !isFiniteNumber(snapshot[field])))) {
    throw new Error('Invalid player snapshots');
  }
};

const assertQueuedAction = (action: unknown): void => {
  if (!isRecord(action) || typeof action.type !== 'string' || !isPlayerOneOffTransactionAction(action as never)) {
    throw new Error('Invalid queued player transaction action');
  }
  const optionalFinite = (key: string) => action[key] === undefined || isFiniteNumber(action[key]);
  switch (action.type) {
    case 'buySellAsset':
      if (action.productType !== AssetProductType.Gilts || !isFiniteNumber(action.amountDelta) || action.amountDelta === 0 ||
          !optionalFinite('rate') || !optionalFinite('tenorMonths') ||
          (action.tenorMonths !== undefined && ![24, 60, 120].includes(Number(action.tenorMonths)))) {
        throw new Error('Invalid queued gilt transaction');
      }
      break;
    case 'launchCapitalMarketsTransaction': {
      if (!['cet1', 'at1', 'tier2', 'senior'].includes(String(action.instrument)) ||
          !isFiniteNumber(action.targetAmount) || action.targetAmount <= 0 ||
          !optionalFinite('maxDiscount') || !optionalFinite('maxSpreadBps') || !optionalFinite('tenorMonths')) {
        throw new Error('Invalid queued capital-markets transaction');
      }
      const definition = getCapitalMarketsInstrument(action.instrument as 'cet1' | 'at1' | 'tier2' | 'senior');
      if (definition.pricingKind === 'discount') {
        if (!isFiniteNumber(action.maxDiscount) || action.maxDiscount < 0 || action.maxDiscount > 0.5 || action.maxSpreadBps !== undefined) {
          throw new Error('Invalid queued equity pricing');
        }
      } else if (!isFiniteNumber(action.maxSpreadBps) || action.maxSpreadBps <= 0 || action.maxSpreadBps > 5000 || action.maxDiscount !== undefined) {
        throw new Error('Invalid queued debt pricing');
      }
      if (definition.permittedTenorMonths?.length) {
        if (!isFiniteNumber(action.tenorMonths) || !definition.permittedTenorMonths.includes(action.tenorMonths)) {
          throw new Error('Invalid queued capital-markets tenor');
        }
      } else if (action.tenorMonths !== undefined) {
        throw new Error('Unexpected queued capital-markets tenor');
      }
      break;
    }
    case 'drawBoeFunding':
      if (!['STR', 'ILTR'].includes(String(action.facility)) || !isFiniteNumber(action.amount) || action.amount <= 0) {
        throw new Error('Invalid queued central-bank funding transaction');
      }
      break;
    case 'enterHedge':
      if (!['payFixedReceiveFloat', 'receiveFixedPayFloat'].includes(String(action.direction)) ||
          !isFiniteNumber(action.notional) || action.notional <= 0 || !isFiniteNumber(action.fixedRate) ||
          !optionalFinite('maturityMonths') ||
          (action.maturityMonths !== undefined && ![12, 24, 60].includes(Number(action.maturityMonths)))) {
        throw new Error('Invalid queued hedge transaction');
      }
      break;
  }
};

const assertQueuedTransactions: (value: unknown, nextId: unknown) => void = (value, nextId) => {
  if (!Array.isArray(value) || !Number.isSafeInteger(nextId) || Number(nextId) < 1) {
    throw new Error('Invalid queued player transactions');
  }
  const seenIds = new Set<number>();
  const seenKinds = new Set<string>();
  let largestId = 0;
  for (const entry of value) {
    if (!isRecord(entry) || !Number.isSafeInteger(entry.id) || Number(entry.id) < 1 || !isRecord(entry.action) ||
        typeof entry.action.type !== 'string' || !isPlayerOneOffTransactionAction(entry.action as never)) {
      throw new Error('Invalid queued player transaction');
    }
    assertQueuedAction(entry.action);
    const id = Number(entry.id);
    const kind = playerTransactionKindForAction(entry.action as never);
    if (seenIds.has(id) || seenKinds.has(kind)) throw new Error('Duplicate queued transaction ID or kind');
    seenIds.add(id);
    seenKinds.add(kind);
    largestId = Math.max(largestId, id);
  }
  if (Number(nextId) <= largestId) throw new Error('Next transaction ID must exceed queued IDs');
};

const assertBankState: (value: unknown, label: string) => asserts value is BankState = (value, label) => {
  if (!isRecord(value) || !isRecord(value.time) || !(value.time.date instanceof Date) ||
      !Number.isSafeInteger(value.time.step) || !Number.isFinite(value.time.stepLengthMonths) ||
      !isRecord(value.financial) || !isRecord(value.risk) || !isRecord(value.market) ||
      !isRecord(value.market.giltCurve) || !isRecord(value.market.giltCurve.yields) ||
      !isRecord(value.equityMarket) || !isRecord(value.behaviour) || !isRecord(value.status) ||
      !isRecord(value.financial.balanceSheet) || !Array.isArray(value.financial.balanceSheet.items) || !Array.isArray(value.financial.hedges) ||
      !isRecord(value.financial.incomeStatement) || !isRecord(value.financial.cashFlowStatement) ||
      !isRecord(value.risk.riskMetrics) || !isRecord(value.risk.compliance)) {
    throw new Error(`Invalid ${label} in player session`);
  }
};

const assertPlayerSession: (value: unknown) => asserts value is PlayerSessionState = (value) => {
  if (!isRecord(value) || typeof value.runId !== 'string' || value.runId.length === 0 ||
      !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 ||
      !Number.isSafeInteger(value.seed) || Number(value.seed) < 0 ||
      typeof value.seedSchemeVersion !== 'string' || value.seedSchemeVersion.length === 0 ||
      !(value.scenarioId === null || typeof value.scenarioId === 'string') ||
      !Array.isArray(value.stateHistory) || !Array.isArray(value.eventLog) ||
      !Array.isArray(value.timeline) || !Array.isArray(value.snapshots) ||
      typeof value.safetyPause !== 'boolean' ||
      !['active', 'bank_failure', 'horizon_reached', 'owner_stopped', 'server_error', 'interrupted'].includes(String(value.status))) {
    throw new Error('Invalid player session envelope');
  }
  if (value.horizonMonths !== undefined && (!Number.isSafeInteger(value.horizonMonths) || Number(value.horizonMonths) < 0)) {
    throw new Error('Invalid player session horizon');
  }
  assertSimulationConfig(value.config);
  assertActionForm(value.actionForm);
  assertQueuedTransactions(value.queuedTransactions, value.nextTransactionId);
  assertTimeline(value.timeline);
  assertEventLog(value.eventLog);
  assertSnapshots(value.snapshots);
  if (value.capitalMarketsDraftArea !== undefined && value.capitalMarketsDraftArea !== null &&
      !['Capital', 'Treasury'].includes(String(value.capitalMarketsDraftArea))) {
    throw new Error('Invalid capital markets draft area in player session');
  }
  assertBankState(value.openingState, 'opening state');
  assertBankState(value.bankState, 'current state');
  value.stateHistory.forEach((state, index) => assertBankState(state, `history state ${index}`));
  if (value.stateHistory.length !== value.timeline.length + 1 || value.snapshots.length !== value.stateHistory.length ||
      value.stateHistory[0]?.time.step !== value.openingState.time.step ||
      value.stateHistory[value.stateHistory.length - 1]?.time.step !== value.bankState.time.step) {
    throw new Error('Player session history, timeline and snapshots are inconsistent');
  }
  value.timeline.forEach((entry, index) => {
    if (entry.step !== value.stateHistory[index + 1]?.time.step || value.snapshots[index + 1]?.step !== entry.step) {
      throw new Error(`Player session close ${index + 1} has inconsistent step numbers`);
    }
  });
};

/** Explicit versioned codec. Date, undefined, array and object values have distinct tags. */
export const encodePlayerSessionState = (session: PlayerSessionState): string => {
  assertPlayerSession(session);
  return JSON.stringify({
    codec: SESSION_CODEC_ID,
    version: PLAYER_SESSION_CODEC_VERSION,
    payload: encodeNode(session),
  });
};

export const decodePlayerSessionState = (encoded: string): PlayerSessionState => {
  let envelope: unknown;
  try {
    envelope = JSON.parse(encoded);
  } catch {
    throw new Error('Player session is not valid JSON');
  }
  if (!isRecord(envelope) || envelope.codec !== SESSION_CODEC_ID || envelope.version !== PLAYER_SESSION_CODEC_VERSION ||
      !Array.isArray(envelope.payload)) {
    throw new Error('Unsupported player session codec or version');
  }
  const decoded = decodeNode(envelope.payload);
  assertPlayerSession(decoded);
  return decoded;
};

/** Canonical BankState bytes intentionally exclude run/request/provider metadata. */
export const canonicalBankStateJson = (state: BankState): string => JSON.stringify(encodeNode(state, new Set(), true));

export const canonicalBankStateHash = async (state: BankState): Promise<string> => {
  const cryptoProvider = globalThis.crypto;
  if (!cryptoProvider?.subtle) throw new Error('SHA-256 requires Web Crypto support');
  const bytes = new TextEncoder().encode(canonicalBankStateJson(state));
  const digest = await cryptoProvider.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
