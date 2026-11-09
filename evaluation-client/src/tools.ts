import type { FunctionToolDefinition, JsonObject } from './types.js';

interface ControlDefinition {
  id: string;
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
interface ControlsResponse {
  controls: ControlDefinition[];
  currentValues: Record<string, unknown>;
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
  operationalLimits: { maxAdvanceMonths: number; maxPageSize: number };
}
interface ReportsResponse { reports: Array<{ id: string; title: string; available: boolean }> }

const objectSchema = (properties: Record<string, JsonObject>, required: string[] = []): JsonObject => ({
  type: 'object', properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false,
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
const functionTool = (name: string, description: string, parameters: JsonObject): FunctionToolDefinition => ({ type: 'function', function: { name, description, parameters } });

export const buildPlayerTools = (controls: ControlsResponse, reportCatalog: ReportsResponse): FunctionToolDefinition[] => {
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

  const reportIds = reportCatalog.reports.filter((report) => report.available).map((report) => report.id);
  const maxMonths = controls.operationalLimits.maxAdvanceMonths;
  const capitalMarketsVariants: JsonObject[] = [];
  for (const [area, instruments] of Object.entries(controls.transactionOptions?.capitalMarketsByArea ?? {})) {
    for (const instrument of instruments) {
      const properties: Record<string, JsonObject> = {
        kind: { type: 'string', const: 'capitalMarkets' },
        area: { type: 'string', const: area, description: `GUI area: ${area}.` },
        instrument: { type: 'string', const: instrument.instrument, description: instrument.label },
        targetAmountGbp: positiveNumberSchema('Positive target amount in GBP.'),
      };
      if (instrument.pricingKind === 'discount') {
        properties.maxDiscountRatio = numberSchema('Maximum discount ratio; GUI range 0 to 0.5. If omitted, the GUI ticket default is used.', 0, 0.5);
      } else {
        properties.maxSpreadBps = { ...numberSchema('Maximum spread in basis points; GUI range is strictly above 0 through 5000. If omitted, the GUI ticket default is used.', undefined, 5000), exclusiveMinimum: 0 };
      }
      if (instrument.permittedTenorMonths?.length) {
        properties.tenorMonths = {
          type: 'integer', enum: instrument.permittedTenorMonths,
          description: 'Choose a tenor offered by the GUI for this instrument.',
        };
      }
      capitalMarketsVariants.push(objectSchema(properties, ['kind', 'area', 'instrument', 'targetAmountGbp']));
    }
  }
  const transactionVariants: JsonObject[] = [...capitalMarketsVariants];
  transactionVariants.push(objectSchema({
    kind: { type: 'string', const: 'gilt' },
    direction: { type: 'string', const: 'buy' },
    amountGbp: positiveNumberSchema('Positive amount in GBP.'),
    tenorMonths: { type: 'integer', enum: [24, 60, 120], description: 'Buy tenor in months; the GUI offers 2, 5 or 10 years.' },
  }, ['kind', 'direction', 'amountGbp']));
  const maxGiltSaleGbp = controls.treasuryLimits?.maxGiltSaleGbp ?? 0;
  if (maxGiltSaleGbp > 0) {
    transactionVariants.push(objectSchema({
      kind: { type: 'string', const: 'gilt' },
      direction: { type: 'string', const: 'sell' },
      amountGbp: { ...positiveNumberSchema('Positive amount in GBP; proportional sale is bounded by current unencumbered gilts.'), maximum: maxGiltSaleGbp },
    }, ['kind', 'direction', 'amountGbp']));
  }
  const maxBoeFundingGbp = controls.treasuryLimits?.maxBoeFundingGbp ?? 0;
  if (maxBoeFundingGbp > 0) {
    transactionVariants.push(objectSchema({
      kind: { type: 'string', const: 'boeFunding' },
      facility: { type: 'string', enum: ['STR', 'ILTR'] },
      amountGbp: { ...positiveNumberSchema('Positive requested drawing in GBP; bounded by current GUI collateral/funding capacity.'), maximum: maxBoeFundingGbp },
    }, ['kind', 'facility', 'amountGbp']));
  }
  transactionVariants.push(objectSchema({
    kind: { type: 'string', const: 'hedge' },
    direction: { type: 'string', enum: ['payFixedReceiveFloat', 'receiveFixedPayFloat'] },
    notionalGbp: positiveNumberSchema('Positive notional in GBP.'),
    maturityMonths: { type: 'integer', enum: [12, 24, 60] },
  }, ['kind', 'direction', 'notionalGbp', 'maturityMonths']));
  const currentValues = controls.currentValues;
  const cancelKinds = [
    ...(currentValues.capitalMarketsInstrument && currentValues.capitalMarketsInstrument !== 'none' ? ['capitalMarkets'] : []),
    ...(currentValues.giltTradeDirection && currentValues.giltTradeDirection !== 'none' ? ['gilt'] : []),
    ...(currentValues.boeFacility && currentValues.boeFacility !== 'none' ? ['boeFunding'] : []),
    ...(currentValues.hedgeDirection && currentValues.hedgeDirection !== 'none' ? ['hedge'] : []),
  ];
  const reportQuery = objectSchema({
    offset: { type: 'integer', minimum: 0, description: 'History page offset.' },
    limit: { type: 'integer', minimum: 1, maximum: controls.operationalLimits.maxPageSize, description: 'History page size.' },
    department: { type: 'string', enum: ['Customers', 'Lending', 'Capital', 'Treasury'] },
    unit: { type: 'string', enum: ['ratio', 'money', 'headroom'] },
    selected: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 40 },
    years: { type: 'string', enum: ['all', '1', '3', '5'] },
    periodMonths: { type: 'integer', enum: [3, 12] },
    portfolio: { type: 'string', maxLength: 80 },
  });

  return [
    functionTool('get_overview', 'Read the current player overview, simulation step, revision, horizon and stop status.', objectSchema({})),
    functionTool('get_controls', 'Discover the current GUI-equivalent player controls, values, risk floors, Treasury limits, month boundaries and operational limits.', objectSchema({})),
    functionTool('list_reports', 'Discover every player report and whether it is currently available.', objectSchema({})),
    ...(reportIds.length > 0 ? [functionTool('get_report', `Request one available player-visible report. Available report IDs: ${reportIds.join(', ')}.`, objectSchema({
      report_id: stringSchema('Stable report ID from list_reports.', reportIds),
      query: { ...reportQuery, description: 'Optional GUI-supported history, portfolio or display query fields.' },
    }, ['report_id']))] : []),
    functionTool('get_help', 'Read a player help topic. Discover topic IDs through get_report with report_id report.help.', objectSchema({ topic_id: stringSchema('Player-visible help topic ID.') }, ['topic_id'])),
    functionTool('preview_next_close', 'Request the GUI-equivalent next-close preview for a management area. This does not change the simulation.', objectSchema({
      department: stringSchema('Management area.', ['Customers', 'Lending', 'Capital', 'Treasury']),
    }, ['department'])),
    functionTool('get_player_export', 'Read the existing player-accessible BankSim run extract. This is not the private administrator audit bundle.', objectSchema({})),
    functionTool('update_decisions', `Update standing GUI policies by stable IDs. Values are drafts/policies and do not close a month. Available IDs: ${standing.map((control) => control.id).join(', ')}.`, objectSchema({
      controls: { ...objectSchema(policyProperties), minProperties: 1, description: 'One or more registered standing policy IDs and their numeric values.' },
    }, ['controls'])),
    functionTool('queue_transaction', 'Create or replace one GUI-shaped transaction draft. It executes only during a valid monthly close.', {
      anyOf: transactionVariants,
    }),
    ...(cancelKinds.length > 0 ? [functionTool('cancel_transaction', 'Cancel the selected transaction draft while preserving standing policies and other transaction drafts.', objectSchema({
      kind: stringSchema('Transaction kind to cancel.', cancelKinds),
    }, ['kind']))] : []),
    functionTool('set_risk_appetite', 'Queue GUI-validated internal risk targets for the next close. Pass null to restore automatic targets.', objectSchema({
      targets: { anyOf: [riskTargets, { type: 'null' }] },
    }, ['targets'])),
    functionTool('set_safety_pause', 'Set the player safety-pause preference for automatic time advancement.', objectSchema({ enabled: { type: 'boolean' } }, ['enabled'])),
    functionTool('advance_time', `Advance by 1 to ${maxMonths} months. Each month closes separately; stop reasons, horizon, and safety pause apply. The controls report gives the next quarter/year boundary lengths.`, objectSchema({
      months: { type: 'integer', minimum: 1, maximum: maxMonths },
    }, ['months'])),
  ];
};
