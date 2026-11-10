import type { PlayerSessionState } from './playerSession';
import {
  PLAYER_CONTROL_REGISTRY,
  capitalMarketsInstrumentsForArea,
  parseActionFormInputs,
  updateActionFormFields,
  type ActionFormField,
  type ActionFormState,
  type PlayerControlIssue,
} from './playerControls';
import { clearTransactionDraft } from './actionFormState';
import { buildActionsFromParsed } from './playerControls';
import { getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';
import { baseConfig } from '../config/baseConfig';
import { buildTreasuryTransactionLimits } from '../presentation/treasuryLimits';
import {
  isPlayerOneOffTransactionAction,
  playerTransactionKindForAction,
  type PlayerOneOffTransactionAction,
  type PlayerTransactionKind,
} from './playerTransactions';

export type PlayerDraftResult =
  | { accepted: true; session: PlayerSessionState }
  | { accepted: false; session: PlayerSessionState; issues: PlayerControlIssue[] };

type ScalarDraftValue = number | string;

export interface PlayerTransactionDraftUpdates {
  capitalMarkets?: Partial<{
    area: 'Capital' | 'Treasury';
    instrument: 'none' | 'cet1' | 'at1' | 'tier2' | 'senior';
    targetAmountGbp: ScalarDraftValue;
    maxDiscountRatio: ScalarDraftValue;
    maxSpreadBps: ScalarDraftValue;
    tenorMonths: ScalarDraftValue;
  }>;
  gilt?: Partial<{ direction: 'none' | 'buy' | 'sell'; amountGbp: ScalarDraftValue; tenorMonths: ScalarDraftValue }>;
  boeFunding?: Partial<{ facility: 'none' | 'STR' | 'ILTR'; amountGbp: ScalarDraftValue }>;
  hedge?: Partial<{
    direction: 'none' | 'payFixedReceiveFloat' | 'receiveFixedPayFloat';
    notionalGbp: ScalarDraftValue;
    maturityMonths: ScalarDraftValue;
  }>;
}

const failure = (session: PlayerSessionState, field: string, message: string): PlayerDraftResult => ({
  accepted: false,
  session,
  issues: [{ field, message }],
});

const isActive = (session: PlayerSessionState): boolean => session.status === 'active' && !session.bankState.status.hasFailed;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const fieldValue = (value: ScalarDraftValue): string => String(value);

const DRAFT_FIELDS: Record<keyof PlayerTransactionDraftUpdates, readonly ActionFormField[]> = {
  capitalMarkets: ['capitalMarketsInstrument', 'capitalMarketsTargetAmount', 'capitalMarketsMaxDiscount', 'capitalMarketsMaxSpreadBps', 'capitalMarketsTenorMonths'],
  gilt: ['giltTradeDirection', 'giltTradeAmount', 'giltDurationYears'],
  boeFunding: ['boeFacility', 'boeFundingAmount'],
  hedge: ['hedgeDirection', 'hedgeNotional', 'hedgeMaturityMonths', 'hedgeFixedRate'],
};

const KIND_FOR_DRAFT: Record<keyof PlayerTransactionDraftUpdates, PlayerTransactionKind> = {
  capitalMarkets: 'capitalMarkets',
  gilt: 'giltTrade',
  boeFunding: 'boeFunding',
  hedge: 'hedge',
};

const ALLOWED_DRAFT_KEYS: Record<keyof PlayerTransactionDraftUpdates, readonly string[]> = {
  capitalMarkets: ['area', 'instrument', 'targetAmountGbp', 'maxDiscountRatio', 'maxSpreadBps', 'tenorMonths'],
  gilt: ['direction', 'amountGbp', 'tenorMonths'],
  boeFunding: ['facility', 'amountGbp'],
  hedge: ['direction', 'notionalGbp', 'maturityMonths'],
};

const applyDraftUpdates = (
  current: PlayerSessionState,
  drafts: PlayerTransactionDraftUpdates,
): { patch: Partial<ActionFormState>; capitalMarketsDraftArea: PlayerSessionState['capitalMarketsDraftArea']; issues: PlayerControlIssue[] } => {
  const patch: Partial<ActionFormState> = {};
  let capitalMarketsDraftArea = current.capitalMarketsDraftArea;
  const issues: PlayerControlIssue[] = [];
  const seenGroups = Object.keys(drafts) as Array<keyof PlayerTransactionDraftUpdates>;

  for (const group of seenGroups) {
    if (!Object.hasOwn(KIND_FOR_DRAFT, group)) {
      issues.push({ field: String(group), message: 'Unknown transaction draft group' });
      continue;
    }
    const values = drafts[group] as Record<string, unknown> | undefined;
    if (!values || !isRecord(values) || Object.keys(values).length === 0) {
      issues.push({ field: group, message: 'Provide at least one draft field to update' });
      continue;
    }
    for (const key of Object.keys(values)) {
      if (!ALLOWED_DRAFT_KEYS[group]?.includes(key)) {
        issues.push({ field: `${group}.${key}`, message: 'This field is not part of the GUI transaction form' });
      }
    }
    const kind = KIND_FOR_DRAFT[group];
    if (current.queuedTransactions.some((transaction) => playerTransactionKindForAction(transaction.action) === kind)) {
      issues.push({ field: group, message: 'This transaction kind is already queued and its GUI fields are disabled' });
      continue;
    }

    const allowScalar = (key: string, target: ActionFormField) => {
      const value = values[key];
      if (value === undefined) return;
      if (typeof value !== 'number' && typeof value !== 'string') {
        issues.push({ field: `${group}.${key}`, message: 'Draft value must be a number or string' });
        return;
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        issues.push({ field: `${group}.${key}`, message: 'Draft value must be finite' });
        return;
      }
      (patch as Record<ActionFormField, string>)[target] = fieldValue(value);
    };

    switch (group) {
      case 'capitalMarkets': {
        const area = values.area;
        if (area !== undefined) {
          if (area !== 'Capital' && area !== 'Treasury') issues.push({ field: 'capitalMarkets.area', message: 'Choose Capital or Treasury' });
          else if (current.capitalMarketsDraftArea && current.capitalMarketsDraftArea !== area && current.actionForm.capitalMarketsInstrument !== 'none') {
            issues.push({ field: 'capitalMarkets.area', message: 'Clear the current capital-markets draft before switching GUI areas' });
          }
          else capitalMarketsDraftArea = area;
        }
        const allowed = capitalMarketsDraftArea ? capitalMarketsInstrumentsForArea(capitalMarketsDraftArea) : [];
        const instrument = values.instrument;
        if (instrument !== undefined) {
          if (instrument !== 'none' && (typeof instrument !== 'string' || !allowed.includes(instrument as never))) {
            issues.push({ field: 'capitalMarkets.instrument', message: 'Instrument is not available in the selected GUI area' });
          } else {
            patch.capitalMarketsInstrument = instrument as ActionFormState['capitalMarketsInstrument'];
          }
        }
        allowScalar('targetAmountGbp', 'capitalMarketsTargetAmount');
        allowScalar('maxDiscountRatio', 'capitalMarketsMaxDiscount');
        allowScalar('maxSpreadBps', 'capitalMarketsMaxSpreadBps');
        allowScalar('tenorMonths', 'capitalMarketsTenorMonths');
        const selectedInstrument = patch.capitalMarketsInstrument ?? current.actionForm.capitalMarketsInstrument;
        const hasTicketFields = ['targetAmountGbp', 'maxDiscountRatio', 'maxSpreadBps', 'tenorMonths'].some((key) => Object.hasOwn(values, key));
        if (selectedInstrument === 'none' && hasTicketFields) {
          issues.push({ field: 'capitalMarkets.instrument', message: 'Select an instrument before editing its ticket fields' });
        } else if (selectedInstrument !== 'none') {
          const definition = getCapitalMarketsInstrument(selectedInstrument);
          if (definition.pricingKind === 'discount' && Object.hasOwn(values, 'maxSpreadBps')) issues.push({ field: 'capitalMarkets.maxSpreadBps', message: 'This instrument uses a discount control, not a spread control' });
          if (definition.pricingKind === 'spread' && Object.hasOwn(values, 'maxDiscountRatio')) issues.push({ field: 'capitalMarkets.maxDiscountRatio', message: 'This instrument uses a spread control, not a discount control' });
          if (!definition.permittedTenorMonths?.length && Object.hasOwn(values, 'tenorMonths')) issues.push({ field: 'capitalMarkets.tenorMonths', message: 'The GUI does not offer a tenor control for this instrument' });
          if (definition.permittedTenorMonths?.length && values.tenorMonths !== undefined &&
              !definition.permittedTenorMonths.includes(Number(values.tenorMonths))) {
            issues.push({ field: 'capitalMarkets.tenorMonths', message: 'Choose a tenor offered by the GUI for this instrument' });
          }
        }
        if (selectedInstrument === 'none') {
          patch.capitalMarketsTargetAmount = '';
          capitalMarketsDraftArea = null;
        }
        break;
      }
      case 'gilt': {
        if (values.direction !== undefined) {
          if (!['none', 'buy', 'sell'].includes(String(values.direction))) issues.push({ field: 'gilt.direction', message: 'Choose none, buy or sell' });
          else patch.giltTradeDirection = values.direction as ActionFormState['giltTradeDirection'];
        }
        allowScalar('amountGbp', 'giltTradeAmount');
        if (values.tenorMonths !== undefined) {
          if (![24, 60, 120, '24', '60', '120'].includes(values.tenorMonths as never)) issues.push({ field: 'gilt.tenorMonths', message: 'Choose a GUI gilt tenor of 24, 60 or 120 months' });
          else patch.giltDurationYears = String(Number(values.tenorMonths) / 12);
        }
        const direction = patch.giltTradeDirection ?? current.actionForm.giltTradeDirection;
        if (direction === 'none' && (Object.hasOwn(values, 'amountGbp') || Object.hasOwn(values, 'tenorMonths'))) issues.push({ field: 'gilt.direction', message: 'Select a gilt direction before editing its ticket fields' });
        if (direction === 'sell' && Object.hasOwn(values, 'tenorMonths')) issues.push({ field: 'gilt.tenorMonths', message: 'The GUI does not offer a tenor for proportional gilt sales' });
        if (direction === 'none') patch.giltTradeAmount = '';
        break;
      }
      case 'boeFunding': {
        if (values.facility !== undefined) {
          if (!['none', 'STR', 'ILTR'].includes(String(values.facility))) issues.push({ field: 'boeFunding.facility', message: 'Choose none, STR or ILTR' });
          else patch.boeFacility = values.facility as ActionFormState['boeFacility'];
        }
        allowScalar('amountGbp', 'boeFundingAmount');
        const facility = patch.boeFacility ?? current.actionForm.boeFacility;
        if (facility === 'none' && Object.hasOwn(values, 'amountGbp')) issues.push({ field: 'boeFunding.facility', message: 'Select a Bank of England facility before editing the drawing amount' });
        if (facility === 'none') patch.boeFundingAmount = '';
        break;
      }
      case 'hedge': {
        if (values.direction !== undefined) {
          if (!['none', 'payFixedReceiveFloat', 'receiveFixedPayFloat'].includes(String(values.direction))) issues.push({ field: 'hedge.direction', message: 'Choose a GUI-supported swap direction or none' });
          else patch.hedgeDirection = values.direction as ActionFormState['hedgeDirection'];
        }
        allowScalar('notionalGbp', 'hedgeNotional');
        if (values.maturityMonths !== undefined) {
          if (![12, 24, 60, '12', '24', '60'].includes(values.maturityMonths as never)) issues.push({ field: 'hedge.maturityMonths', message: 'Choose a GUI hedge maturity of 12, 24 or 60 months' });
          else patch.hedgeMaturityMonths = String(values.maturityMonths);
        }
        const direction = patch.hedgeDirection ?? current.actionForm.hedgeDirection;
        if (direction === 'none' && (Object.hasOwn(values, 'notionalGbp') || Object.hasOwn(values, 'maturityMonths'))) issues.push({ field: 'hedge.direction', message: 'Select a swap direction before editing the ticket fields' });
        if (direction === 'none') {
          patch.hedgeNotional = '';
          patch.hedgeFixedRate = '';
        }
        break;
      }
    }
  }

  return { patch, capitalMarketsDraftArea, issues };
};

/** Apply registered standing controls and optional GUI-shaped transaction draft fields. */
export const updatePlayerSessionDecisions = (
  current: PlayerSessionState,
  controls: Record<string, number | string>,
  drafts: PlayerTransactionDraftUpdates = {},
): PlayerDraftResult => {
  if (!isActive(current)) return failure(current, 'status', 'Run is not active');
  const patch: Partial<ActionFormState> = {};
  const issues: PlayerControlIssue[] = [];
  for (const [id, value] of Object.entries(controls)) {
    const control = PLAYER_CONTROL_REGISTRY.find((candidate) => candidate.id === id);
    if (!control || control.category !== 'standing-policy' || control.formFields.length !== 1) {
      issues.push({ field: id, message: 'Unknown or unavailable standing player control' });
      continue;
    }
    const field = control.formFields[0];
    if (typeof value !== 'number' && typeof value !== 'string') {
      issues.push({ field: id, message: 'Control value must be a number or permitted choice' });
      continue;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      issues.push({ field: id, message: 'Control value must be finite' });
      continue;
    }
    const choices = control.fieldChoices?.[field] ?? control.choices;
    if (choices?.length && !choices.some((choice) => String(choice) === String(value))) {
      issues.push({ field: id, message: `Choose one of: ${choices.join(', ')}` });
      continue;
    }
    if (typeof value === 'number' && control.minimum !== undefined && value < control.minimum) {
      issues.push({ field: id, message: `Value must be at least ${control.minimum}` });
      continue;
    }
    if (typeof value === 'number' && control.maximum !== undefined && value > control.maximum) {
      issues.push({ field: id, message: `Value must be no more than ${control.maximum}` });
      continue;
    }
    (patch as Record<ActionFormField, string>)[field] = String(value);
  }
  if (!isRecord(drafts)) issues.push({ field: 'drafts', message: 'Draft updates must be an object' });
  else {
    const draftResult = applyDraftUpdates(current, drafts);
    Object.assign(patch, draftResult.patch);
    if (Object.hasOwn(drafts, 'capitalMarkets')) {
      // The capital-market ticket is scoped to the GUI department that opened it.
      const area = (drafts as PlayerTransactionDraftUpdates).capitalMarkets?.area;
      if (area !== undefined && (area === 'Capital' || area === 'Treasury')) {
        draftResult.capitalMarketsDraftArea = area;
      }
    }
    if (draftResult.issues.length > 0) issues.push(...draftResult.issues);
    if (issues.length === 0) {
      return {
        accepted: true,
        session: {
          ...current,
          revision: current.revision + 1,
          actionForm: updateActionFormFields(current.actionForm, patch),
          capitalMarketsDraftArea: draftResult.capitalMarketsDraftArea,
        },
      };
    }
  }
  if (issues.length > 0) return { accepted: false, session: current, issues };
  return {
    accepted: true,
    session: { ...current, revision: current.revision + 1, actionForm: updateActionFormFields(current.actionForm, patch) },
  };
};

/** Submit the current validated GUI ticket into the next-close queue. */
export const queuePlayerSessionTransaction = (
  current: PlayerSessionState,
  kind: PlayerTransactionKind,
): PlayerDraftResult => {
  if (!isActive(current)) return failure(current, 'status', 'Run is not active');
  if (current.queuedTransactions.some((transaction) => playerTransactionKindForAction(transaction.action) === kind)) {
    return failure(current, 'kind', 'A transaction of this kind is already queued for the next close');
  }

  const parsed = parseActionFormInputs(current.actionForm, { capitalMarketsArea: current.capitalMarketsDraftArea ?? undefined });
  const relevantFields = DRAFT_FIELDS[kind === 'giltTrade' ? 'gilt' : kind];
  const issues = relevantFields.flatMap((field) => parsed.errors[field]
    ? [{ field, message: parsed.errors[field]! }]
    : []);
  if (issues.length > 0) return { accepted: false, session: current, issues };

  const action = buildActionsFromParsed(parsed, current.actionForm, current.bankState)
    .find((candidate): candidate is PlayerOneOffTransactionAction =>
      isPlayerOneOffTransactionAction(candidate) && playerTransactionKindForAction(candidate) === kind,
    );
  if (!action) return failure(current, kind, 'Complete this GUI transaction draft before queueing it');

  const limits = buildTreasuryTransactionLimits(current.bankState, baseConfig, current.actionForm);
  if (action.type === 'buySellAsset' && action.amountDelta < 0 && Math.abs(action.amountDelta) > limits.maxGiltSaleAmount) {
    return failure(current, 'giltTradeAmount', `Maximum gilt sale now is ${limits.maxGiltSaleAmount} GBP`);
  }
  if (action.type === 'drawBoeFunding' && action.amount > limits.maxBoeFundingAmount) {
    return failure(current, 'boeFundingAmount', `Maximum Bank of England drawing now is ${limits.maxBoeFundingAmount} GBP`);
  }

  return {
    accepted: true,
    session: {
      ...current,
      revision: current.revision + 1,
      actionForm: clearTransactionDraft(current.actionForm, kind),
      capitalMarketsDraftArea: kind === 'capitalMarkets' ? null : current.capitalMarketsDraftArea,
      queuedTransactions: [...current.queuedTransactions, { id: current.nextTransactionId, action }],
      nextTransactionId: current.nextTransactionId + 1,
    },
  };
};

/** Remove one queued transaction by its stable session ID. */
export const cancelPlayerSessionTransaction = (
  current: PlayerSessionState,
  transactionId: number,
): PlayerDraftResult => {
  if (!isActive(current)) return failure(current, 'status', 'Run is not active');
  if (!Number.isSafeInteger(transactionId) || transactionId < 1) return failure(current, 'transaction_id', 'Transaction ID must be a positive integer');
  if (!current.queuedTransactions.some((transaction) => transaction.id === transactionId)) {
    return failure(current, 'transaction_id', 'Queued transaction was not found');
  }
  return {
    accepted: true,
    session: {
      ...current,
      revision: current.revision + 1,
      queuedTransactions: current.queuedTransactions.filter((transaction) => transaction.id !== transactionId),
    },
  };
};
