import type { FunctionToolDefinition, JsonObject } from './types.js';

interface ControlDefinition {
  id: string;
  area: string;
  category: string;
  label: string;
  description: string;
  guiLocation: string;
  units: string;
  inputFields: string[];
  choices?: Array<string | number>;
  fieldChoices?: Record<string, Array<string | number>>;
  areaChoices?: Record<string, string[]>;
  minimum?: number;
  maximum?: number;
  sliderStep?: number;
  exactInputAllowsIntermediateValues?: boolean;
  persistent?: boolean;
  available?: boolean;
}
type TransactionKind = 'capitalMarkets' | 'giltTrade' | 'boeFunding' | 'hedge';
interface ControlsResponse {
  controls: ControlDefinition[];
  currentValues: Record<string, unknown>;
  queuedTransactions?: Array<{ id: number; kind: TransactionKind; label: string }>;
  riskAppetite: { floors?: Record<string, number>; maximums?: Record<string, number | null>; effective?: Record<string, number> | null };
  treasuryLimits?: { maxGiltSaleGbp?: number; maxBoeFundingGbp?: number };
  transactionOptions?: {
    capitalMarketsByArea?: Record<string, Array<{
      instrument: string;
      label: string;
      pricingKind: 'discount' | 'spread';
      permittedTenorMonths?: number[];
    }>>;
  };
  time: { monthsUntilQuarterEnd?: number; monthsUntilYearEnd?: number; continuousRunLimitMonths?: number };
  monthsRemaining?: number | null;
  operationalLimits: { maxAdvanceMonths: number; maxPageSize: number };
}
interface ReportsResponse {
  reports: Array<{ id: string; title: string; available: boolean; queryFields?: string[]; querySchema?: JsonObject }>;
}

const objectSchema = (properties: Record<string, JsonObject>, required: string[] = []): JsonObject => ({
  type: 'object', properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false,
});
const partialObjectSchema = (properties: Record<string, JsonObject>): JsonObject => ({
  ...objectSchema(properties), minProperties: 1,
});
const stringSchema = (description: string, enumValues?: Array<string | number>): JsonObject => ({
  type: 'string', description, ...(enumValues ? { enum: enumValues } : {}),
});
const numberSchema = (description: string, minimum?: number, maximum?: number, enumValues?: Array<string | number>): JsonObject => ({
  type: 'number', description,
  ...(minimum !== undefined ? { minimum } : {}),
  ...(maximum !== undefined ? { maximum } : {}),
  ...(enumValues ? { enum: enumValues } : {}),
});
const positiveNumberSchema = (description: string): JsonObject => ({
  ...numberSchema(description), exclusiveMinimum: 0,
});
const draftAmountSchema = (description: string, maximum?: number): JsonObject => ({
  anyOf: [numberSchema(description, 0, maximum), { type: 'string', const: '', description: 'Use an empty string to clear this GUI text field.' }],
});
const functionTool = (name: string, description: string, parameters: JsonObject): FunctionToolDefinition => ({ type: 'function', function: { name, description, parameters } });

const draftPropertyByControlId = {
  'transaction.capital_markets': 'capitalMarkets',
  'transaction.gilt': 'gilt',
  'transaction.boe_funding': 'boeFunding',
  'transaction.hedge': 'hedge',
} as const;
const draftPropertyByTransactionKind: Record<TransactionKind, string> = {
  capitalMarkets: 'capitalMarkets', giltTrade: 'gilt', boeFunding: 'boeFunding', hedge: 'hedge',
};

const buildDraftSchemas = (controls: ControlsResponse): Record<string, JsonObject> => {
  const availableDraftIds = new Set(controls.controls
    .filter((control) => control.category === 'one-off-transaction' && control.available !== false)
    .map((control) => control.id));
  const result: Record<string, JsonObject> = {};

  if (availableDraftIds.has('transaction.capital_markets') && draftPropertyByControlId['transaction.capital_markets'] === 'capitalMarkets') {
    const variants: JsonObject[] = [];
    const byArea = controls.transactionOptions?.capitalMarketsByArea ?? {};
    for (const [area, instruments] of Object.entries(byArea)) {
      for (const instrument of instruments) {
        const properties: Record<string, JsonObject> = {
          area: { type: 'string', const: area, description: `GUI ticket area: ${area}.` },
          instrument: { anyOf: [
            { type: 'string', const: instrument.instrument },
            { type: 'string', const: 'none', description: 'Discard the unqueued GUI ticket draft.' },
          ], description: `${instrument.label}; available under ${area}.` },
          targetAmountGbp: draftAmountSchema('Ticket target amount in GBP. Enter a number or an empty string to clear the field.'),
        };
        if (instrument.pricingKind === 'discount') {
          properties.maxDiscountRatio = {
            anyOf: [numberSchema('Maximum discount ratio from 0 to 0.5; 0.15 means 15%.', 0, 0.5), { type: 'string', const: '' }],
            description: 'GUI price limit. An empty string clears the text field and restores its ticket default.',
          };
        } else {
          properties.maxSpreadBps = {
            anyOf: [
              { ...numberSchema('Maximum spread in basis points; strictly above 0 through 5000.', undefined, 5000), exclusiveMinimum: 0 },
              { type: 'string', const: '' },
            ],
            description: 'GUI price limit. An empty string clears the text field and restores its ticket default.',
          };
        }
        if (instrument.permittedTenorMonths?.length) {
          properties.tenorMonths = {
            type: 'integer', enum: instrument.permittedTenorMonths,
            description: 'Select a tenor offered by the GUI for this instrument.',
          };
        }
        variants.push(partialObjectSchema(properties));
      }
    }
    result.capitalMarkets = {
      anyOf: variants,
      description: 'Partial GUI capital-market ticket draft. Use the area and instrument together; a mismatched pair is unavailable in the GUI.',
    };
  }

  const giltControl = controls.controls.find((control) => control.id === 'transaction.gilt');
  if (availableDraftIds.has('transaction.gilt') && giltControl && draftPropertyByControlId['transaction.gilt'] === 'gilt') {
    const directions = giltControl.fieldChoices?.giltTradeDirection?.map(String) ?? [];
    const tenorYears = giltControl.fieldChoices?.giltDurationYears?.map(Number).filter(Number.isFinite) ?? [];
    const tenorMonths = tenorYears.map((years) => years * 12);
    const variants: JsonObject[] = [];
    if (directions.includes('buy')) {
      variants.push(partialObjectSchema({
        direction: stringSchema('Buy gilts or select none to discard the draft.', ['buy', 'none']),
        amountGbp: draftAmountSchema('Gilt purchase amount in GBP.'),
        ...(tenorMonths.length > 0 ? { tenorMonths: { type: 'integer', enum: tenorMonths, description: `GUI maturity choices in months: ${tenorMonths.join(', ')}.` } } : {}),
      }));
    }
    if (directions.includes('sell')) {
      variants.push(partialObjectSchema({
        direction: stringSchema('Sell gilts proportionally across maturities or select none to discard the draft.', ['sell', 'none']),
        amountGbp: draftAmountSchema(`Proportional gilt sale in GBP; current GUI maximum is ${controls.treasuryLimits?.maxGiltSaleGbp ?? 0}.`, controls.treasuryLimits?.maxGiltSaleGbp ?? 0),
      }));
    }
    variants.push(partialObjectSchema({ amountGbp: draftAmountSchema('Gilt transaction amount in GBP.') }));
    result.gilt = {
      anyOf: variants,
      description: 'Partial GUI gilt ticket draft. Draft text fields can be empty; queueing applies the current GUI validation and limit.',
    };
  }

  const boeControl = controls.controls.find((control) => control.id === 'transaction.boe_funding');
  if (availableDraftIds.has('transaction.boe_funding') && boeControl && draftPropertyByControlId['transaction.boe_funding'] === 'boeFunding') {
    const facilities = boeControl.fieldChoices?.boeFacility?.map(String) ?? [];
    result.boeFunding = partialObjectSchema({
      facility: stringSchema('GUI facility choice; select none to discard the draft.', [...facilities, 'none']),
      amountGbp: draftAmountSchema(`Requested drawing in GBP; current GUI maximum is ${controls.treasuryLimits?.maxBoeFundingGbp ?? 0}.`, controls.treasuryLimits?.maxBoeFundingGbp ?? 0),
    });
  }

  const hedgeControl = controls.controls.find((control) => control.id === 'transaction.hedge');
  if (availableDraftIds.has('transaction.hedge') && hedgeControl && draftPropertyByControlId['transaction.hedge'] === 'hedge') {
    const directions = hedgeControl.fieldChoices?.hedgeDirection?.map(String) ?? [];
    const maturities = hedgeControl.fieldChoices?.hedgeMaturityMonths?.map(Number).filter(Number.isFinite) ?? [];
    result.hedge = partialObjectSchema({
      direction: stringSchema('GUI swap direction; select none to discard the draft.', [...directions, 'none']),
      notionalGbp: draftAmountSchema('Swap notional in GBP.'),
      ...(maturities.length > 0 ? { maturityMonths: { type: 'integer', enum: maturities, description: `GUI maturity choices in months: ${maturities.join(', ')}.` } } : {}),
    });
  }

  return result;
};

export const buildPlayerTools = (controls: ControlsResponse, reportCatalog: ReportsResponse): FunctionToolDefinition[] => {
  const active = controls.controls.some((control) => control.available !== false);
  const departments = [...new Set(controls.controls.map((control) => control.area))];
  const standing = controls.controls.filter((control) => control.category === 'standing-policy' && control.available !== false);
  const policyProperties: Record<string, JsonObject> = {};
  for (const control of standing) {
    const field = control.inputFields[0];
    const currentValue = field ? controls.currentValues[field] : undefined;
    const choices = field ? control.fieldChoices?.[field] ?? control.choices : control.choices;
    const schema = choices?.length
      ? (typeof choices[0] === 'number'
          ? numberSchema(`${control.label}. ${control.description} Units: ${control.units}. GUI: ${control.guiLocation}. Current value: ${String(currentValue)}.`, control.minimum, control.maximum, choices)
          : stringSchema(`${control.label}. ${control.description} Units: ${control.units}. GUI: ${control.guiLocation}. Current value: ${String(currentValue)}.`, choices))
      : numberSchema(`${control.label}. ${control.description} Units: ${control.units}. GUI: ${control.guiLocation}. Current value: ${String(currentValue)}.${control.sliderStep !== undefined ? ` GUI slider step ${control.sliderStep}; intermediate numeric input values are accepted.` : ''}`, control.minimum, control.maximum);
    policyProperties[control.id] = schema;
  }

  const riskFloors = controls.riskAppetite.floors ?? {};
  const riskMaximums = controls.riskAppetite.maximums ?? {};
  const riskTargets = objectSchema({
    cet1: numberSchema('Internal CET1 ratio target; ratio, minimum is the current GUI floor.', riskFloors.cet1, riskMaximums.cet1 ?? undefined),
    leverage: numberSchema('Internal leverage ratio target; ratio.', riskFloors.leverage, riskMaximums.leverage ?? undefined),
    lcr: numberSchema('Internal LCR target; ratio (1.10 means 110%).', riskFloors.lcr, riskMaximums.lcr ?? undefined),
    nsfr: numberSchema('Internal NSFR target; ratio.', riskFloors.nsfr, riskMaximums.nsfr ?? undefined),
    irrbbEveLimit: { ...positiveNumberSchema('Internal IRRBB EVE loss limit in GBP; must be positive.') },
  }, ['cet1', 'leverage', 'lcr', 'nsfr', 'irrbbEveLimit']);

  const availableReports = reportCatalog.reports.filter((report) => report.available);
  const reportIds = availableReports.map((report) => report.id);
  const maxMonths = typeof controls.monthsRemaining === 'number'
    ? Math.min(controls.operationalLimits.maxAdvanceMonths, controls.monthsRemaining)
    : controls.operationalLimits.maxAdvanceMonths;
  const queuedTransactions = controls.queuedTransactions ?? [];
  const queuedKinds = new Set(queuedTransactions.map((transaction) => transaction.kind));
  const activeDrafts = buildDraftSchemas(controls);
  const queueableKinds = (['capitalMarkets', 'giltTrade', 'boeFunding', 'hedge'] as const)
    .filter((kind) => !queuedKinds.has(kind) && activeDrafts[draftPropertyByTransactionKind[kind]] !== undefined);
  const queuedIds = queuedTransactions.map(({ id }) => id);

  const reportToolParameters: JsonObject = {
    type: 'object',
    anyOf: availableReports.map((report) => {
      const properties: Record<string, JsonObject> = {
        report_id: { type: 'string', const: report.id, description: `${report.title} (${report.id}).` },
      };
      const queryProperties = report.querySchema?.properties as Record<string, JsonObject> | undefined;
      if (queryProperties && Object.keys(queryProperties).length > 0) {
        properties.query = {
          ...report.querySchema!,
          description: `Optional query fields for ${report.id}; these are the fields and limits returned by the shared BankSim report registry.`,
        };
      }
      return objectSchema(properties, ['report_id']);
    }),
    description: 'Select one available report. Query fields are specific to the selected report.',
  };

  const tools = [
    functionTool('get_overview', 'Read the current player overview, simulation step, revision, horizon and stop status.', objectSchema({})),
    functionTool('get_controls', 'Discover current GUI policies, draft form values, queued transactions, risk floors, Treasury limits, month boundaries and operational limits.', objectSchema({})),
    functionTool('list_reports', 'Discover every player report and whether it is currently available.', objectSchema({})),
    ...(reportIds.length > 0 ? [functionTool('get_report', `Request one available player-visible report. Available report IDs: ${reportIds.join(', ')}. Query fields and limits come from the report registry.`, reportToolParameters)] : []),
    functionTool('get_help', 'Read a player help topic. Discover topic IDs through get_report with report_id report.help.', objectSchema({ topic_id: stringSchema('Player-visible help topic ID.') }, ['topic_id'])),
    functionTool('preview_next_close', 'Request the GUI-equivalent next-close preview for a management area. This does not change the simulation.', objectSchema({
      department: stringSchema('Management area from the shared player control registry.', departments),
    }, ['department'])),
    functionTool('get_player_export', 'Read the existing player-accessible BankSim run extract. This is not the private administrator audit bundle.', objectSchema({})),
  ];

  if (active) {
    const updateProperties: Record<string, JsonObject> = {};
    if (Object.keys(policyProperties).length > 0) {
      updateProperties.controls = { ...objectSchema(policyProperties), minProperties: 1, description: 'Optional standing policy changes keyed by registered control ID.' };
    }
    if (Object.keys(activeDrafts).length > 0) {
      updateProperties.drafts = {
        ...partialObjectSchema(activeDrafts),
        description: 'Optional partial GUI-shaped transaction draft edits. Omitted fields keep current values; enter an empty string to clear an amount/price text field, and none to clear a transaction selection.',
      };
    }
    const updateAlternatives = Object.keys(updateProperties).map((key) => ({ required: [key] }));
    if (updateAlternatives.length > 0) {
      tools.push(functionTool('update_decisions', `Update standing GUI policies and/or partial transaction form drafts. Draft edits stay unqueued and do not execute until submitted through queue_transaction and a later valid monthly close. Policy IDs: ${standing.map((control) => control.id).join(', ')}.`, {
        ...objectSchema(updateProperties),
        anyOf: updateAlternatives,
      }));
    }
    if (queueableKinds.length > 0) {
      tools.push(functionTool('queue_transaction', 'Submit the selected current GUI-shaped transaction draft to the queue for the next close. Queueing clears that draft form and does not execute it; a later valid monthly close executes the queued item. The queued item remains visible in get_controls.', objectSchema({
        kind: stringSchema('GUI transaction draft to submit.', queueableKinds),
      }, ['kind'])));
    }
    if (queuedIds.length > 0) {
      tools.push(functionTool('cancel_transaction', 'Remove a transaction already queued for the next close. This does not restore the draft form cleared when it was queued; re-enter the form fields to submit another transaction.', objectSchema({
        transaction_id: { type: 'integer', enum: queuedIds, description: 'Stable queued item ID from get_controls.' },
      }, ['transaction_id'])));
    }
    tools.push(
      functionTool('set_risk_appetite', 'Queue GUI-validated internal risk targets for the next close. Pass null to restore automatic targets.', objectSchema({
        targets: { anyOf: [riskTargets, { type: 'null' }] },
      }, ['targets'])),
      functionTool('set_safety_pause', 'Set the player safety-pause preference for automatic time advancement.', objectSchema({ enabled: { type: 'boolean' } }, ['enabled'])),
      functionTool('advance_time', `Advance by 1 to ${maxMonths} months. Each month closes separately; stop reasons, horizon, and safety pause apply. The controls report gives the next quarter/year boundary lengths.`, objectSchema({
        months: { type: 'integer', minimum: 1, maximum: maxMonths },
      }, ['months'])));
  }

  return tools;
};
