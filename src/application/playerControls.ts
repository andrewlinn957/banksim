import type { BankState } from '../domain/bankState';
import type { SimulationConfig } from '../domain/config';
import type { PlayerAction } from '../domain/actions';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { baseConfig } from '../config/baseConfig';
import { getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';
import { parseMoneyInput, parseRateInput } from '../utils/parsers';
import type { CapitalMarketsInstrument } from '../domain/capitalMarkets';
import type { PlayerOneOffTransactionAction } from './playerTransactions';

/**
 * Values represented by the existing player form. This type lives in the application layer so
 * the browser, HTTP API and evaluation client contracts do not depend on a React component.
 */
export interface ActionFormState {
  retailCurrentAccountRate: string;
  termDepositRate: string;
  termDepositTenorMonths: string;
  corporateDepositRate: string;
  mortgageRate: string;
  consumerLoanRate: string;
  corporateLoanRate: string;
  mortgageUnderwritingTightness: string;
  consumerUnderwritingTightness: string;
  corporateUnderwritingTightness: string;
  mortgageMaxLtv: string;
  mortgageFixedPeriodMonths: string;
  capitalMarketsInstrument: 'none' | CapitalMarketsInstrument;
  capitalMarketsTargetAmount: string;
  capitalMarketsMaxDiscount: string;
  capitalMarketsMaxSpreadBps: string;
  capitalMarketsTenorMonths: string;
  dividendPayoutRatio: string;
  at1CouponMode: 'auto' | 'pay' | 'skip';
  giltTradeDirection: 'none' | 'buy' | 'sell';
  giltTradeAmount: string;
  giltDurationYears: string;
  boeFacility: 'none' | 'STR' | 'ILTR';
  boeFundingAmount: string;
  hedgeDirection: 'none' | 'payFixedReceiveFloat' | 'receiveFixedPayFloat';
  hedgeNotional: string;
  hedgeFixedRate: string;
  hedgeMaturityMonths: string;
}

export type ActionFormField = keyof ActionFormState;

export interface PlayerControlDefinition {
  id: string;
  area: 'Customers' | 'Lending' | 'Capital' | 'Treasury';
  label: string;
  description: string;
  formFields: readonly ActionFormField[];
  category: 'standing-policy' | 'one-off-transaction' | 'pending-policy';
  guiLocation: string;
  units: string;
  choices?: readonly (string | number)[];
  fieldChoices?: Partial<Record<ActionFormField, readonly (string | number)[]>>;
  areaChoices?: Partial<Record<PlayerControlDefinition['area'], readonly string[]>>;
  minimum?: number;
  maximum?: number;
  increment?: number;
  persistent: boolean;
  engineActions: readonly PlayerAction['type'][];
}

/** Stable player IDs and GUI grouping. Raw engine action variants are intentionally not an API. */
export const PLAYER_CONTROL_REGISTRY: readonly PlayerControlDefinition[] = [
  { id: 'policy.deposit.retail_current', area: 'Customers', label: 'Retail current account rate', description: 'Offer for retail current account deposits.', formFields: ['retailCurrentAccountRate'], category: 'standing-policy', guiLocation: 'Deposits / Retail current accounts', units: 'annual rate, ratio from 0 to 1', minimum: 0, maximum: 1, persistent: true, engineActions: ['adjustRate'] },
  { id: 'policy.deposit.term_rate', area: 'Customers', label: 'Fixed-term savings rate', description: 'Offer for retail fixed-term savings.', formFields: ['termDepositRate'], category: 'standing-policy', guiLocation: 'Deposits / Fixed-term savings', units: 'annual rate, ratio from 0 to 1', minimum: 0, maximum: 1, persistent: true, engineActions: ['adjustRate'] },
  { id: 'policy.deposit.term_tenor', area: 'Customers', label: 'Fixed-term savings tenor', description: 'Contractual tenor for new fixed-term savings.', formFields: ['termDepositTenorMonths'], category: 'standing-policy', guiLocation: 'Deposits / Fixed-term savings / Term', units: 'months', choices: [12, 24, 36], persistent: true, engineActions: ['setTermDepositPolicy'] },
  { id: 'policy.deposit.corporate_rate', area: 'Customers', label: 'Business deposit rate', description: 'Single offer applied to both corporate operating and non-operating deposits.', formFields: ['corporateDepositRate'], category: 'standing-policy', guiLocation: 'Deposits / Business deposits', units: 'annual rate, ratio from 0 to 1', minimum: 0, maximum: 1, persistent: true, engineActions: ['adjustRate'] },
  { id: 'policy.loan.mortgage_rate', area: 'Lending', label: 'Mortgage new rate', description: 'Rate for new mortgage lending.', formFields: ['mortgageRate'], category: 'standing-policy', guiLocation: 'Lending / Mortgages / New rate', units: 'annual rate, ratio from 0 to 1', minimum: 0, maximum: 1, persistent: true, engineActions: ['adjustRate'] },
  { id: 'policy.loan.mortgage_selectivity', area: 'Lending', label: 'Mortgage selectivity', description: 'Selectivity for new mortgage lending.', formFields: ['mortgageUnderwritingTightness'], category: 'standing-policy', guiLocation: 'Lending / Mortgages / New lending selectivity', units: 'ratio', minimum: 0, maximum: 1, increment: 0.05, persistent: true, engineActions: ['setUnderwriting'] },
  { id: 'policy.loan.mortgage_ltv', area: 'Lending', label: 'Mortgage maximum LTV', description: 'Maximum LTV permitted for new mortgages.', formFields: ['mortgageMaxLtv'], category: 'standing-policy', guiLocation: 'Lending / Mortgages / Maximum LTV', units: 'ratio', choices: [0.6, 0.75, 0.85, 0.9, 0.95], persistent: true, engineActions: ['setMortgagePolicy'] },
  { id: 'policy.loan.mortgage_fixed_period', area: 'Lending', label: 'Mortgage initial fixed period', description: 'Initial fixed-rate period for new mortgages.', formFields: ['mortgageFixedPeriodMonths'], category: 'standing-policy', guiLocation: 'Lending / Mortgages / Initial fixed period', units: 'months', choices: [24, 36, 60], persistent: true, engineActions: ['setMortgagePolicy'] },
  { id: 'policy.loan.consumer_rate', area: 'Lending', label: 'Personal-credit new rate', description: 'Rate for new personal-credit lending.', formFields: ['consumerLoanRate'], category: 'standing-policy', guiLocation: 'Lending / Personal credit / New rate', units: 'annual rate, ratio from 0 to 1', minimum: 0, maximum: 1, persistent: true, engineActions: ['adjustRate'] },
  { id: 'policy.loan.consumer_selectivity', area: 'Lending', label: 'Personal-credit selectivity', description: 'Selectivity for new personal-credit lending.', formFields: ['consumerUnderwritingTightness'], category: 'standing-policy', guiLocation: 'Lending / Personal credit / New lending selectivity', units: 'ratio', minimum: 0, maximum: 1, increment: 0.05, persistent: true, engineActions: ['setUnderwriting'] },
  { id: 'policy.loan.corporate_rate', area: 'Lending', label: 'SME and business new rate', description: 'Rate for new SME and business lending.', formFields: ['corporateLoanRate'], category: 'standing-policy', guiLocation: 'Lending / SME and business / New rate', units: 'annual rate, ratio from 0 to 1', minimum: 0, maximum: 1, persistent: true, engineActions: ['adjustRate'] },
  { id: 'policy.loan.corporate_selectivity', area: 'Lending', label: 'SME and business selectivity', description: 'Selectivity for new SME and business lending.', formFields: ['corporateUnderwritingTightness'], category: 'standing-policy', guiLocation: 'Lending / SME and business / New lending selectivity', units: 'ratio', minimum: 0, maximum: 1, increment: 0.05, persistent: true, engineActions: ['setUnderwriting'] },
  { id: 'policy.capital.dividend_payout', area: 'Capital', label: 'Profit payout', description: 'Share of positive net income paid to shareholders.', formFields: ['dividendPayoutRatio'], category: 'standing-policy', guiLocation: 'Finance & Capital / Share of profit paid out', units: 'ratio from 0 to 1', minimum: 0, maximum: 1, persistent: true, engineActions: ['setCapitalPolicy'] },
  { id: 'policy.capital.risk_appetite', area: 'Capital', label: 'Board risk appetite', description: 'Internal capital, leverage, liquidity and IRRBB EVE targets. Targets apply on the next close and persist until changed.', formFields: [], category: 'pending-policy', guiLocation: 'Finance & Capital / Board risk appetite; Risk & Regulatory', units: 'ratios and GBP EVE limit', persistent: true, engineActions: ['setRiskAppetite'] },
  { id: 'transaction.capital_markets', area: 'Capital', label: 'Capital markets transaction', description: 'At most one capital or debt issue ticket may be drafted for the next close.', formFields: ['capitalMarketsInstrument', 'capitalMarketsTargetAmount', 'capitalMarketsMaxDiscount', 'capitalMarketsMaxSpreadBps', 'capitalMarketsTenorMonths'], category: 'one-off-transaction', guiLocation: 'Finance & Capital / Raise capital; Treasury & Funding / Wholesale funding markets', units: 'GBP, discount ratio, spread basis points, tenor months', areaChoices: { Capital: ['cet1', 'at1', 'tier2'], Treasury: ['senior'] }, persistent: false, engineActions: ['launchCapitalMarketsTransaction'] },
  { id: 'transaction.gilt', area: 'Treasury', label: 'Gilt transaction', description: 'Buy gilts at one selected tenor, or sell proportionally across maturities.', formFields: ['giltTradeDirection', 'giltTradeAmount', 'giltDurationYears'], category: 'one-off-transaction', guiLocation: 'Treasury & Funding / Gilt transaction', units: 'GBP and tenor years', fieldChoices: { giltTradeDirection: ['buy', 'sell'], giltDurationYears: [2, 5, 10] }, persistent: false, engineActions: ['buySellAsset'] },
  { id: 'transaction.boe_funding', area: 'Treasury', label: 'Bank of England funding', description: 'Draw STR or ILTR funding subject to current collateral and funding capacity.', formFields: ['boeFacility', 'boeFundingAmount'], category: 'one-off-transaction', guiLocation: 'Treasury & Funding / Central-bank funding', units: 'GBP', fieldChoices: { boeFacility: ['STR', 'ILTR'] }, persistent: false, engineActions: ['drawBoeFunding'] },
  { id: 'transaction.hedge', area: 'Treasury', label: 'Interest-rate swap', description: 'Enter a swap with a current-market fixed rate and a GUI-permitted maturity.', formFields: ['hedgeDirection', 'hedgeNotional', 'hedgeMaturityMonths'], category: 'one-off-transaction', guiLocation: 'Treasury & Funding / Interest-rate hedging', units: 'GBP notional and months', fieldChoices: { hedgeDirection: ['payFixedReceiveFloat', 'receiveFixedPayFloat'], hedgeMaturityMonths: [12, 24, 60] }, minimum: 0, persistent: false, engineActions: ['enterHedge'] },
] as const;

const fieldsByDepartment: Record<PlayerControlDefinition['area'], ActionFormField[]> = {
  Customers: [], Lending: [], Capital: [], Treasury: [],
};
PLAYER_CONTROL_REGISTRY.forEach((control) => {
  const areas: PlayerControlDefinition['area'][] = control.id === 'transaction.capital_markets'
    ? ['Capital', 'Treasury']
    : [control.area];
  areas.forEach((area) => control.formFields.forEach((field) => {
    if (!fieldsByDepartment[area].includes(field)) fieldsByDepartment[area].push(field);
  }));
});
export const FORM_FIELDS_BY_DEPARTMENT: Readonly<Record<PlayerControlDefinition['area'], readonly ActionFormField[]>> = fieldsByDepartment;

export const controlForFormField = (field: ActionFormField): PlayerControlDefinition | undefined =>
  PLAYER_CONTROL_REGISTRY.find((control) => control.formFields.includes(field));

export const choicesForFormField = (field: ActionFormField): readonly (string | number)[] => {
  const control = controlForFormField(field);
  return control?.fieldChoices?.[field] ?? control?.choices ?? [];
};

export const capitalMarketsInstrumentsForArea = (area: 'Capital' | 'Treasury'): CapitalMarketsInstrument[] => {
  const control = PLAYER_CONTROL_REGISTRY.find((candidate) => candidate.id === 'transaction.capital_markets');
  return [...(control?.areaChoices?.[area] ?? [])] as CapitalMarketsInstrument[];
};

/** Pending transaction and board-policy labels used in the GUI overview and API summary. */
export const buildDraftTransactionLabels = (form: ActionFormState): string[] => [
  form.capitalMarketsInstrument !== 'none' ? `${getCapitalMarketsInstrument(form.capitalMarketsInstrument).label}: ${form.capitalMarketsTargetAmount || 'amount required'}` : null,
  form.giltTradeDirection !== 'none' ? `${form.giltTradeDirection === 'buy' ? 'Buy' : 'Sell'} gilts: ${form.giltTradeAmount || 'amount required'}` : null,
  form.boeFacility !== 'none' ? `${form.boeFacility} drawing: ${form.boeFundingAmount || 'amount required'}` : null,
  form.hedgeDirection !== 'none' ? `${form.hedgeDirection === 'payFixedReceiveFloat' ? 'Pay fixed' : 'Receive fixed'} swap: ${form.hedgeNotional || 'notional required'}` : null,
].filter((item): item is string => item !== null);

export const buildPendingActionLabels = (
  form: ActionFormState,
  pendingRiskAppetite: PlayerRiskAppetite | null | undefined,
): string[] => [
  ...buildDraftTransactionLabels(form),
  pendingRiskAppetite !== undefined ? 'Update internal risk appetite' : null,
].filter((item): item is string => item !== null);

/** Apply a GUI field edit with the same side effects used when a player changes a control. */
export const updateActionFormFields = (
  current: ActionFormState,
  patch: Partial<ActionFormState>
): ActionFormState => {
  const next = { ...current, ...patch };

  // These are the selector side effects of the rendered GUI controls. Keep them
  // in the shared form update path so the HTTP session and React form behave alike.
  if (patch.capitalMarketsInstrument !== undefined && patch.capitalMarketsInstrument !== current.capitalMarketsInstrument) {
    if (patch.capitalMarketsInstrument === 'none') {
      next.capitalMarketsTargetAmount = '';
    } else {
      const definition = getCapitalMarketsInstrument(patch.capitalMarketsInstrument);
      const permitted = definition.permittedTenorMonths;
      const requestedTenor = Number(patch.capitalMarketsTenorMonths ?? current.capitalMarketsTenorMonths);
      if (permitted?.length && !permitted.includes(requestedTenor)) {
        next.capitalMarketsTenorMonths = String(definition.defaultTenorMonths ?? permitted[0]);
      }
    }
  }
  if (patch.giltTradeDirection === 'none') next.giltTradeAmount = '';
  if (patch.boeFacility === 'none') next.boeFundingAmount = '';
  if (patch.hedgeDirection === 'none') {
    next.hedgeNotional = '';
    next.hedgeFixedRate = '';
  }

  return next;
};

export type DraftTransactionKind = 'capitalMarkets' | 'gilt' | 'boeFunding' | 'hedge';

/** Cancel one GUI transaction draft, preserving policy values and the other draft types. */
export const cancelActionFormTransaction = (
  current: ActionFormState,
  kind: DraftTransactionKind
): ActionFormState => {
  switch (kind) {
    case 'capitalMarkets':
      return updateActionFormFields(current, { capitalMarketsInstrument: 'none', capitalMarketsTargetAmount: '' });
    case 'gilt':
      return updateActionFormFields(current, { giltTradeDirection: 'none', giltTradeAmount: '' });
    case 'boeFunding':
      return updateActionFormFields(current, { boeFacility: 'none', boeFundingAmount: '' });
    case 'hedge':
      return updateActionFormFields(current, { hedgeDirection: 'none', hedgeNotional: '', hedgeFixedRate: '' });
  }
};

export type PlayerRiskAppetite = NonNullable<BankState['behaviour']['riskAppetite']>;
export type RiskAppetiteFloors = Pick<PlayerRiskAppetite, 'cet1' | 'leverage' | 'lcr' | 'nsfr'>;

/** Current player-visible prudential floors used by both the GUI editor and session commands. */
export const riskAppetiteFloorsFor = (state: BankState, config: SimulationConfig): RiskAppetiteFloors => ({
  cet1: Math.max(config.riskLimits.minCet1Ratio, state.risk.riskMetrics.cet1Requirement),
  leverage: config.riskLimits.minLeverageRatio,
  lcr: config.riskLimits.minLcr,
  nsfr: config.riskLimits.minNsfr,
});

export interface PlayerControlIssue {
  field: string;
  message: string;
}

/** Shared GUI/API constraints for the Board risk appetite editor. */
export const validateRiskAppetiteTargets = (
  targets: PlayerRiskAppetite,
  floors: RiskAppetiteFloors
): PlayerControlIssue[] => {
  const issues: PlayerControlIssue[] = [];
  (['cet1', 'leverage', 'lcr', 'nsfr'] as const).forEach((key) => {
    const value = targets[key];
    const max = key === 'cet1' || key === 'leverage' ? 1 : 10;
    if (!Number.isFinite(value) || value < floors[key] || value > max) {
      issues.push({ field: key, message: `${key} target must be between its current floor and ${max * 100}%` });
    }
  });
  if (!Number.isFinite(targets.irrbbEveLimit) || (targets.irrbbEveLimit ?? 0) <= 0) {
    issues.push({ field: 'irrbbEveLimit', message: 'IRRBB EVE limit must be positive' });
  }
  return issues;
};

const rateFields: readonly ActionFormField[] = PLAYER_CONTROL_REGISTRY
  .filter((control) => control.units.startsWith('annual rate'))
  .flatMap((control) => control.formFields);
const underwritingFields: readonly ActionFormField[] = PLAYER_CONTROL_REGISTRY
  .filter((control) => control.id.endsWith('_selectivity'))
  .flatMap((control) => control.formFields);
const moneyFields: readonly ActionFormField[] = PLAYER_CONTROL_REGISTRY
  .filter((control) => control.category === 'one-off-transaction')
  .flatMap((control) => control.formFields)
  .filter((field) => ['capitalMarketsTargetAmount', 'giltTradeAmount', 'boeFundingAmount', 'hedgeNotional'].includes(field));

export interface ParsedActionFormInputs {
  values: Partial<Record<keyof ActionFormState, number>>;
  errors: Partial<Record<keyof ActionFormState, string>>;
  hasErrors: boolean;
}

export interface PlayerValidationContext {
  /** Restrict a capital-markets draft to the ticket catalogue shown in the active management area. */
  capitalMarketsArea?: 'Capital' | 'Treasury';
}

export interface StepPreview {
  baseline: BankState;
  stressed: BankState;
  breachProbability: number;
  pathCount: number;
  deltas: {
    cet1Ratio: number;
    lcr: number;
    nsfr: number;
    nim: number;
  };
}

export const parseActionFormInputs = (state: ActionFormState, context: PlayerValidationContext = {}): ParsedActionFormInputs => {
  const errors: Partial<Record<keyof ActionFormState, string>> = {};
  const values: Partial<Record<keyof ActionFormState, number>> = {};

  rateFields.forEach((field) => {
    const parsed = parseRateInput(state[field]);
    if (parsed.error) {
      errors[field] = parsed.error;
      return;
    }
    if (parsed.value !== undefined) {
      values[field] = parsed.value;
    }
  });

  underwritingFields.forEach((field) => {
    const parsed = parseRateInput(state[field]);
    if (parsed.error) {
      errors[field] = parsed.error;
      return;
    }
    if (parsed.value !== undefined) {
      if (parsed.value < 0 || parsed.value > 1) {
        errors[field] = 'Underwriting tightness must be between 0 and 1';
        return;
      }
      values[field] = parsed.value;
    }
  });

  moneyFields.forEach((field) => {
    const parsed = parseMoneyInput(state[field]);
    if (parsed.error) {
      errors[field] = parsed.error;
      return;
    }
    if (parsed.value !== undefined) {
      values[field] = parsed.value;
    }
  });

  for (const field of ['mortgageMaxLtv'] as Array<keyof ActionFormState>) { const parsed=parseRateInput(state[field]); if(parsed.error) errors[field]=parsed.error; else if(parsed.value!==undefined){ if(parsed.value<0||parsed.value>1) errors[field]='Must be between 0 and 1'; else values[field]=parsed.value; } }
  for (const field of ['mortgageFixedPeriodMonths','termDepositTenorMonths','giltDurationYears'] as Array<keyof ActionFormState>) { const raw=Number(state[field]); if(!Number.isFinite(raw)||raw<=0) errors[field]='Must be a positive number'; else values[field]=raw; }
  const checkChoice = (field: ActionFormField, value: string, options: readonly (string | number)[]) => {
    const numericValue = Number(value);
    if (!options.some((choice) => typeof choice === 'number' ? Number.isFinite(numericValue) && numericValue === choice : choice === value.trim())) {
      errors[field] = 'Select a permitted option';
    }
  };
  checkChoice('termDepositTenorMonths', state.termDepositTenorMonths, choicesForFormField('termDepositTenorMonths'));
  checkChoice('mortgageMaxLtv', state.mortgageMaxLtv, choicesForFormField('mortgageMaxLtv'));
  checkChoice('mortgageFixedPeriodMonths', state.mortgageFixedPeriodMonths, choicesForFormField('mortgageFixedPeriodMonths'));
  if (state.giltTradeDirection !== 'none') {
    checkChoice('giltTradeDirection', state.giltTradeDirection, choicesForFormField('giltTradeDirection'));
    if (state.giltTradeDirection === 'buy') checkChoice('giltDurationYears', state.giltDurationYears, choicesForFormField('giltDurationYears'));
  }
  if (state.boeFacility !== 'none') checkChoice('boeFacility', state.boeFacility, choicesForFormField('boeFacility'));
  if (state.hedgeDirection !== 'none') {
    checkChoice('hedgeDirection', state.hedgeDirection, choicesForFormField('hedgeDirection'));
    checkChoice('hedgeMaturityMonths', state.hedgeMaturityMonths, choicesForFormField('hedgeMaturityMonths'));
  }
  if (state.capitalMarketsInstrument !== 'none') {
    const capControl = PLAYER_CONTROL_REGISTRY.find((control) => control.id === 'transaction.capital_markets');
    const allowed = context.capitalMarketsArea
      ? capControl?.areaChoices?.[context.capitalMarketsArea] ?? []
      : Object.values(capControl?.areaChoices ?? {}).flat();
    checkChoice('capitalMarketsInstrument', state.capitalMarketsInstrument, allowed);
  }
  if(state.giltTradeDirection!=='none' && (values.giltTradeAmount??0)<=0) errors.giltTradeAmount='Enter an amount for the selected gilt transaction';
  if(state.boeFacility!=='none' && (values.boeFundingAmount??0)<=0) errors.boeFundingAmount='Enter an amount for the selected Bank of England facility';
  if(state.capitalMarketsInstrument!=='none') {
    if((values.capitalMarketsTargetAmount??0)<=0) errors.capitalMarketsTargetAmount='Enter a positive target size for the transaction';
    const capControl = PLAYER_CONTROL_REGISTRY.find((control) => control.id === 'transaction.capital_markets');
    const allowed = context.capitalMarketsArea
      ? capControl?.areaChoices?.[context.capitalMarketsArea] ?? []
      : Object.values(capControl?.areaChoices ?? {}).flat();
    const definition = allowed.includes(state.capitalMarketsInstrument)
      ? getCapitalMarketsInstrument(state.capitalMarketsInstrument)
      : undefined;
    if (!definition) {
      errors.capitalMarketsInstrument = 'Select a permitted capital markets instrument';
    } else {
    if(definition.pricingKind==='discount') {
      const parsed=parseRateInput(state.capitalMarketsMaxDiscount);
      if(parsed.error) errors.capitalMarketsMaxDiscount=parsed.error;
      else if(parsed.value===undefined||parsed.value<0||parsed.value>0.5) errors.capitalMarketsMaxDiscount='Maximum discount must be between 0% and 50%';
      else values.capitalMarketsMaxDiscount=parsed.value;
    } else {
      const spread=Number(state.capitalMarketsMaxSpreadBps);
      if(!Number.isFinite(spread)||spread<=0||spread>5000) errors.capitalMarketsMaxSpreadBps='Maximum spread must be between 1 and 5,000 bp';
      else values.capitalMarketsMaxSpreadBps=spread;
    }
    if(definition.permittedTenorMonths?.length) {
      const tenor=Math.round(Number(state.capitalMarketsTenorMonths));
      if(!Number.isFinite(tenor)||!definition.permittedTenorMonths.includes(tenor)) errors.capitalMarketsTenorMonths='Select a permitted debt tenor';
      else values.capitalMarketsTenorMonths=tenor;
    }
    }
  }

  const payoutParsed = parseRateInput(state.dividendPayoutRatio);
  if (payoutParsed.error) {
    errors.dividendPayoutRatio = payoutParsed.error;
  } else if (payoutParsed.value !== undefined) {
    if (payoutParsed.value < 0 || payoutParsed.value > 1) {
      errors.dividendPayoutRatio = 'Dividend payout ratio must be between 0 and 1';
    } else {
      values.dividendPayoutRatio = payoutParsed.value;
    }
  }

  const hedgeMaturityText = state.hedgeMaturityMonths.trim();
  if (hedgeMaturityText.length > 0) {
    const maturity = Number(hedgeMaturityText);
    if (!Number.isFinite(maturity) || maturity <= 0) {
      errors.hedgeMaturityMonths = 'Hedge maturity must be a positive number of months';
    } else {
      values.hedgeMaturityMonths = Math.round(maturity);
    }
  }

  if (state.hedgeDirection !== 'none' && (values.hedgeNotional ?? 0) <= 0) {
    errors.hedgeNotional = 'Hedge notional must be greater than zero';
  }

  return {
    values,
    errors,
    hasErrors: Object.keys(errors).length > 0,
  };
};

export const buildActionsFromParsed = (
  parsed: ParsedActionFormInputs,
  formState: ActionFormState,
  currentState: BankState,
  queuedTransactions?: readonly PlayerOneOffTransactionAction[],
): PlayerAction[] => {
  const actions: PlayerAction[] = [];
  const values = parsed.values;

  if (values.retailCurrentAccountRate !== undefined) {
    [LiabilityProductType.RetailCurrentAccounts].forEach(
      (productType) => {
        actions.push({
          type: 'adjustRate',
          productType,
          newRate: values.retailCurrentAccountRate!,
        });
      }
    );
  }
  if (values.termDepositRate !== undefined) actions.push({type:'adjustRate',productType:LiabilityProductType.RetailTermDeposits,newRate:values.termDepositRate});
  if (values.termDepositTenorMonths !== undefined) actions.push({type:'setTermDepositPolicy',tenorMonths:values.termDepositTenorMonths});
  if (values.corporateDepositRate !== undefined) {
    [
      LiabilityProductType.CorporateOperatingDeposits,
      LiabilityProductType.CorporateNonOperatingDeposits,
    ].forEach((productType) => {
      actions.push({
        type: 'adjustRate',
        productType,
        newRate: values.corporateDepositRate!,
      });
    });
  }
  if (values.mortgageRate !== undefined) {
    actions.push({
      type: 'adjustRate',
      productType: AssetProductType.Mortgages,
      newRate: values.mortgageRate,
    });
  }
  if (values.consumerLoanRate !== undefined) actions.push({type:'adjustRate',productType:AssetProductType.ConsumerLoans,newRate:values.consumerLoanRate});
  if (values.corporateLoanRate !== undefined) {
    actions.push({
      type: 'adjustRate',
      productType: AssetProductType.CorporateLoans,
      newRate: values.corporateLoanRate,
    });
  }
  if (values.mortgageUnderwritingTightness !== undefined) {
    actions.push({
      type: 'setUnderwriting',
      productType: AssetProductType.Mortgages,
      tightness: values.mortgageUnderwritingTightness,
    });
  }
  if (values.consumerUnderwritingTightness !== undefined) actions.push({type:'setUnderwriting',productType:AssetProductType.ConsumerLoans,tightness:values.consumerUnderwritingTightness});
  if (values.corporateUnderwritingTightness !== undefined) {
    actions.push({
      type: 'setUnderwriting',
      productType: AssetProductType.CorporateLoans,
      tightness: values.corporateUnderwritingTightness,
    });
  }
  if (values.mortgageMaxLtv!==undefined && values.mortgageFixedPeriodMonths!==undefined) actions.push({type:'setMortgagePolicy',maxLtv:values.mortgageMaxLtv,fixedPeriodMonths:values.mortgageFixedPeriodMonths});
  const queuedGiltTrade = queuedTransactions?.find((action): action is Extract<PlayerOneOffTransactionAction, { type: 'buySellAsset' }> => action.type === 'buySellAsset');
  if (queuedTransactions !== undefined) {
    if (queuedGiltTrade) actions.push(queuedGiltTrade);
  } else if (formState.giltTradeDirection!=='none' && values.giltTradeAmount!==undefined && values.giltTradeAmount>0) {
    actions.push({
      type:'buySellAsset',
      productType:AssetProductType.Gilts,
      amountDelta:formState.giltTradeDirection==='buy'?values.giltTradeAmount:-values.giltTradeAmount,
      tenorMonths:Math.round(values.giltDurationYears * 12),
    });
  }
  const queuedBoeFunding = queuedTransactions?.find((action): action is Extract<PlayerOneOffTransactionAction, { type: 'drawBoeFunding' }> => action.type === 'drawBoeFunding');
  if (queuedTransactions !== undefined) {
    if (queuedBoeFunding) actions.push(queuedBoeFunding);
  } else if (formState.boeFacility!=='none' && values.boeFundingAmount!==undefined && values.boeFundingAmount>0) actions.push({type:'drawBoeFunding',facility:formState.boeFacility,amount:values.boeFundingAmount});
  const queuedCapitalMarkets = queuedTransactions?.find((action): action is Extract<PlayerOneOffTransactionAction, { type: 'launchCapitalMarketsTransaction' }> => action.type === 'launchCapitalMarketsTransaction');
  if (queuedTransactions !== undefined) {
    if (queuedCapitalMarkets) actions.push(queuedCapitalMarkets);
  } else if (formState.capitalMarketsInstrument !== 'none' && values.capitalMarketsTargetAmount !== undefined && values.capitalMarketsTargetAmount > 0) {
    const definition=getCapitalMarketsInstrument(formState.capitalMarketsInstrument);
    actions.push({
      type: 'launchCapitalMarketsTransaction',
      instrument: formState.capitalMarketsInstrument,
      targetAmount: values.capitalMarketsTargetAmount,
      maxDiscount: definition.pricingKind === 'discount' ? values.capitalMarketsMaxDiscount : undefined,
      maxSpreadBps: definition.pricingKind === 'spread' ? values.capitalMarketsMaxSpreadBps : undefined,
      tenorMonths: definition.permittedTenorMonths?.length ? values.capitalMarketsTenorMonths : undefined,
    });
  }
  const fallbackPayout =
    currentState.behaviour.capitalPolicy?.dividendPayoutRatio ??
    baseConfig.riskLimits.capitalPolicy.defaultDividendPayoutRatio;
  const payoutRatio = values.dividendPayoutRatio ?? fallbackPayout;
  actions.push({
    type: 'setCapitalPolicy',
    dividendPayoutRatio: payoutRatio,
    at1CouponMode: 'auto',
  });
  const queuedHedge = queuedTransactions?.find((action): action is Extract<PlayerOneOffTransactionAction, { type: 'enterHedge' }> => action.type === 'enterHedge');
  if (queuedTransactions !== undefined) {
    if (queuedHedge) actions.push(queuedHedge);
  } else if (
    formState.hedgeDirection !== 'none' &&
    values.hedgeNotional !== undefined &&
    values.hedgeNotional > 0
  ) {
    actions.push({
      type: 'enterHedge',
      direction: formState.hedgeDirection,
      notional: values.hedgeNotional,
      fixedRate: currentState.market.riskFreeShort,
      maturityMonths: values.hedgeMaturityMonths ? Math.max(1, Math.round(values.hedgeMaturityMonths)) : undefined,
    });
  }
  return actions;
};
