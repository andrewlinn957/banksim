import type { PlayerSessionState } from './playerSession';
import {
  PLAYER_CONTROL_REGISTRY,
  parseActionFormInputs,
  updateActionFormFields,
  cancelActionFormTransaction,
  type ActionFormField,
  type ActionFormState,
  type DraftTransactionKind,
  type PlayerControlIssue,
} from './playerControls';
import { capitalMarketsInstrumentsForArea } from './playerControls';
import { getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';
import { baseConfig } from '../config/baseConfig';
import { buildTreasuryTransactionLimits } from '../presentation/treasuryLimits';

export type PlayerDraftResult =
  | { accepted: true; session: PlayerSessionState }
  | { accepted: false; session: PlayerSessionState; issues: PlayerControlIssue[] };

export type PlayerTransactionDraft =
  | { kind: 'capitalMarkets'; area: 'Capital' | 'Treasury'; instrument: 'cet1' | 'at1' | 'tier2' | 'senior'; targetAmountGbp: number; maxDiscountRatio?: number; maxSpreadBps?: number; tenorMonths?: number }
  | { kind: 'gilt'; direction: 'buy' | 'sell'; amountGbp: number; tenorMonths?: 24 | 60 | 120 }
  | { kind: 'boeFunding'; facility: 'STR' | 'ILTR'; amountGbp: number }
  | { kind: 'hedge'; direction: 'payFixedReceiveFloat' | 'receiveFixedPayFloat'; notionalGbp: number; maturityMonths: 12 | 24 | 60 };

const failure = (session: PlayerSessionState, field: string, message: string): PlayerDraftResult => ({
  accepted: false,
  session,
  issues: [{ field, message }],
});

const isActive = (session: PlayerSessionState): boolean => session.status === 'active' && !session.bankState.status.hasFailed;

const validateAndApply = (
  current: PlayerSessionState,
  patch: Partial<ActionFormState>,
  capitalMarketsArea = current.capitalMarketsDraftArea ?? undefined,
): PlayerDraftResult => {
  const actionForm = updateActionFormFields(current.actionForm, patch);
  const parsed = parseActionFormInputs(actionForm, { capitalMarketsArea });
  if (parsed.hasErrors) {
    return {
      accepted: false,
      session: current,
      issues: Object.entries(parsed.errors)
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([field, message]) => ({ field, message })),
    };
  }
  return { accepted: true, session: { ...current, revision: current.revision + 1, actionForm, capitalMarketsDraftArea: capitalMarketsArea ?? null } };
};

/** Apply standing decisions by stable player control IDs; raw form fields are not accepted. */
export const updatePlayerSessionDecisions = (
  current: PlayerSessionState,
  controls: Record<string, number | string>,
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
  if (issues.length > 0) return { accepted: false, session: current, issues };
  return validateAndApply(current, patch);
};

/** Queue exactly one GUI-shaped draft for each transaction kind. */
export const queuePlayerSessionTransaction = (
  current: PlayerSessionState,
  transaction: PlayerTransactionDraft,
): PlayerDraftResult => {
  if (!isActive(current)) return failure(current, 'status', 'Run is not active');
  let patch: Partial<ActionFormState>;
  let area = current.capitalMarketsDraftArea ?? undefined;
  switch (transaction.kind) {
    case 'capitalMarkets': {
      area = transaction.area;
      const permitted = capitalMarketsInstrumentsForArea(transaction.area);
      if (!permitted.includes(transaction.instrument)) return failure(current, 'instrument', 'Instrument is not available in the selected GUI area');
      if (!Number.isFinite(transaction.targetAmountGbp) || transaction.targetAmountGbp <= 0) return failure(current, 'targetAmountGbp', 'Enter a positive transaction amount');
      const instrument = getCapitalMarketsInstrument(transaction.instrument);
      patch = {
        capitalMarketsInstrument: transaction.instrument,
        capitalMarketsTargetAmount: String(transaction.targetAmountGbp),
        ...(instrument.pricingKind === 'discount' ? { capitalMarketsMaxDiscount: `${(transaction.maxDiscountRatio ?? 0.15) * 100}%` } : {}),
        ...(instrument.pricingKind === 'spread' ? { capitalMarketsMaxSpreadBps: String(transaction.maxSpreadBps ?? 1000) } : {}),
        ...(instrument.permittedTenorMonths?.length ? { capitalMarketsTenorMonths: String(transaction.tenorMonths ?? 60) } : {}),
      };
      break;
    }
    case 'gilt': {
      if (!Number.isFinite(transaction.amountGbp) || transaction.amountGbp <= 0) return failure(current, 'amountGbp', 'Enter a positive gilt transaction amount');
      patch = {
        giltTradeDirection: transaction.direction,
        giltTradeAmount: String(transaction.amountGbp),
        ...(transaction.direction === 'buy' ? { giltDurationYears: String((transaction.tenorMonths ?? 60) / 12) } : {}),
      };
      if (transaction.direction === 'sell') {
        const limits = buildTreasuryTransactionLimits(current.bankState, baseConfig, { ...current.actionForm, ...patch });
        if (transaction.amountGbp > limits.maxGiltSaleAmount) {
          return failure(current, 'amountGbp', `Maximum gilt sale now is ${limits.maxGiltSaleAmount} GBP`);
        }
      }
      break;
    }
    case 'boeFunding': {
      if (!Number.isFinite(transaction.amountGbp) || transaction.amountGbp <= 0) return failure(current, 'amountGbp', 'Enter a positive Bank of England drawing');
      patch = { boeFacility: transaction.facility, boeFundingAmount: String(transaction.amountGbp) };
      const limits = buildTreasuryTransactionLimits(current.bankState, baseConfig, { ...current.actionForm, ...patch });
      if (transaction.amountGbp > limits.maxBoeFundingAmount) {
        return failure(current, 'amountGbp', `Maximum Bank of England drawing now is ${limits.maxBoeFundingAmount} GBP`);
      }
      break;
    }
    case 'hedge': {
      if (!Number.isFinite(transaction.notionalGbp) || transaction.notionalGbp <= 0) return failure(current, 'notionalGbp', 'Enter a positive hedge notional');
      patch = {
        hedgeDirection: transaction.direction,
        hedgeNotional: String(transaction.notionalGbp),
        hedgeMaturityMonths: String(transaction.maturityMonths),
        hedgeFixedRate: '',
      };
      break;
    }
  }
  return validateAndApply(current, patch, area);
};

/** Cancel the selected one-off draft while retaining all other drafts and standing policies. */
export const cancelPlayerSessionTransaction = (
  current: PlayerSessionState,
  kind: DraftTransactionKind,
): PlayerDraftResult => {
  if (!isActive(current)) return failure(current, 'status', 'Run is not active');
  const actionForm = cancelActionFormTransaction(current.actionForm, kind);
  const capitalMarketsDraftArea = kind === 'capitalMarkets' ? null : current.capitalMarketsDraftArea;
  return { accepted: true, session: { ...current, revision: current.revision + 1, actionForm, capitalMarketsDraftArea } };
};
