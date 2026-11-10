import { Type } from '@fastify/type-provider-typebox';
import { capitalMarketsInstrumentsForArea } from '../application/playerControls';
import { getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';
import type { PlayerReportQueryField } from '../presentation/reportRegistry';
import { LOAN_REPORT_PORTFOLIOS } from '../presentation/reports/loans';

export const RunIdParams = Type.Object({ runId: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false });

export const AdminCreateRunBody = Type.Object({
  engineVersion: Type.String({ minLength: 1, maxLength: 160 }),
  scenarioId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  seed: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  startDate: Type.Optional(Type.String({ minLength: 10, maxLength: 40 })),
  horizonMonths: Type.Integer({ minimum: 1, maximum: 120 }),
  mode: Type.Optional(Type.Object({ threeYearPlan: Type.Boolean() }, { additionalProperties: false })),
  limits: Type.Optional(Type.Object({ maxModelTurns: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })), maxToolCalls: Type.Optional(Type.Integer({ minimum: 1, maximum: 500000 })) }, { additionalProperties: false })),
}, { additionalProperties: false });

const Controls = Type.Record(Type.String({ minLength: 1, maxLength: 100 }), Type.Union([Type.Number(), Type.String({ maxLength: 256 })]), { maxProperties: 32 });
const DraftValue = Type.Union([Type.Number(), Type.String({ maxLength: 256 })]);
const DraftFields = Type.Object({
  capitalMarkets: Type.Optional(Type.Object({
    area: Type.Optional(Type.Union([Type.Literal('Capital'), Type.Literal('Treasury')])),
    instrument: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('cet1'), Type.Literal('at1'), Type.Literal('tier2'), Type.Literal('senior')])),
    targetAmountGbp: Type.Optional(DraftValue),
    maxDiscountRatio: Type.Optional(DraftValue),
    maxSpreadBps: Type.Optional(DraftValue),
    tenorMonths: Type.Optional(DraftValue),
  }, { additionalProperties: false, minProperties: 1 })),
  gilt: Type.Optional(Type.Object({
    direction: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('buy'), Type.Literal('sell')])),
    amountGbp: Type.Optional(DraftValue),
    tenorMonths: Type.Optional(Type.Union([Type.Literal(24), Type.Literal(60), Type.Literal(120)])),
  }, { additionalProperties: false, minProperties: 1 })),
  boeFunding: Type.Optional(Type.Object({
    facility: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('STR'), Type.Literal('ILTR')])),
    amountGbp: Type.Optional(DraftValue),
  }, { additionalProperties: false, minProperties: 1 })),
  hedge: Type.Optional(Type.Object({
    direction: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('payFixedReceiveFloat'), Type.Literal('receiveFixedPayFloat')])),
    notionalGbp: Type.Optional(DraftValue),
    maturityMonths: Type.Optional(Type.Union([Type.Literal(12), Type.Literal(24), Type.Literal(60)])),
  }, { additionalProperties: false, minProperties: 1 })),
}, { additionalProperties: false, minProperties: 1 });
const DecisionUpdates = Type.Object({
  controls: Type.Optional(Controls),
  drafts: Type.Optional(DraftFields),
}, { additionalProperties: false, minProperties: 1 });
const RiskAppetiteTargets = Type.Object({
  cet1: Type.Number(), leverage: Type.Number(), lcr: Type.Number(), nsfr: Type.Number(), irrbbEveLimit: Type.Number(),
}, { additionalProperties: false });

const CommandEnvelope = {
  commandId: Type.String({ minLength: 1, maxLength: 128 }),
  expectedRevision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
};

export const PlayerCommandBody = Type.Union([
  Type.Object({ ...CommandEnvelope, type: Type.Literal('update_decisions'), payload: DecisionUpdates }, { additionalProperties: false }),
  Type.Object({ ...CommandEnvelope, type: Type.Literal('queue_transaction'), payload: Type.Object({ kind: Type.Union([Type.Literal('capitalMarkets'), Type.Literal('giltTrade'), Type.Literal('boeFunding'), Type.Literal('hedge')]) }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ ...CommandEnvelope, type: Type.Literal('cancel_transaction'), payload: Type.Object({ transaction_id: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }) }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ ...CommandEnvelope, type: Type.Literal('set_risk_appetite'), payload: Type.Object({ targets: Type.Union([RiskAppetiteTargets, Type.Null()]) }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ ...CommandEnvelope, type: Type.Literal('set_safety_pause'), payload: Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ ...CommandEnvelope, type: Type.Literal('advance_time'), payload: Type.Object({ months: Type.Integer({ minimum: 1, maximum: 12 }) }, { additionalProperties: false }) }, { additionalProperties: false }),
]);

const reportQueryField = (field: PlayerReportQueryField, maxPageSize: number) => {
  switch (field) {
    case 'offset': return Type.Optional(Type.Integer({ minimum: 0, maximum: 100000, description: 'History page offset.' }));
    case 'limit': return Type.Optional(Type.Integer({ minimum: 1, maximum: Math.min(500, maxPageSize), description: 'History page size.' }));
    case 'department': return Type.Optional(Type.Union([
      Type.Literal('Customers'), Type.Literal('Lending'), Type.Literal('Capital'), Type.Literal('Treasury'),
    ], { description: 'GUI management area.' }));
    case 'unit': return Type.Optional(Type.Union([
      Type.Literal('ratio'), Type.Literal('money'), Type.Literal('headroom'),
    ], { description: 'History series display unit.' }));
    case 'selected': return Type.Optional(Type.Array(Type.String({ maxLength: 100 }), {
      maxItems: 40, description: 'Selected GUI history series.',
    }));
    case 'years': return Type.Optional(Type.Union([
      Type.Literal('all'), Type.Literal('1'), Type.Literal('3'), Type.Literal('5'),
    ], { description: 'History range displayed by the GUI.' }));
    case 'periodMonths': return Type.Optional(Type.Union([
      Type.Literal(3), Type.Literal(12),
    ], { description: 'Performance-report period shown by the GUI.' }));
    case 'portfolio': return Type.Optional(Type.Union(
      LOAN_REPORT_PORTFOLIOS.map((portfolio) => Type.Literal(portfolio)),
      { description: 'Loan portfolio selector shown by the GUI.' },
    ));
  }
};

export const playerReportQuerySchemaFor = (fields: readonly PlayerReportQueryField[], maxPageSize = 500) => Type.Object(
  Object.fromEntries(fields.map((field) => [field, reportQueryField(field, maxPageSize)])),
  { additionalProperties: false },
);

export const PlayerReportQuery = playerReportQuerySchemaFor([
  'offset', 'limit', 'department', 'unit', 'selected', 'years', 'periodMonths', 'portfolio',
]);

export const PlayerPreviewBody = Type.Object({
  department: Type.Optional(Type.Union([Type.Literal('Customers'), Type.Literal('Lending'), Type.Literal('Capital'), Type.Literal('Treasury')])),
}, { additionalProperties: false });

export const HelpTopicParams = Type.Object({ runId: Type.String({ minLength: 1, maxLength: 128 }), topicId: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false });
export const CommandStatusParams = Type.Object({ runId: Type.String({ minLength: 1, maxLength: 128 }), commandId: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false });
export const CredentialParams = Type.Object({ runId: Type.String({ minLength: 1, maxLength: 128 }), credentialId: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false });
export const StopRunBody = Type.Object({ reason: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false });
export const ReplayBody = Type.Object({ runId: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false });
export const CredentialIssueBody = Type.Object({ scopes: Type.Optional(Type.Array(Type.Union([Type.Literal('player:read'), Type.Literal('player:write'), Type.Literal('player:export')]), { uniqueItems: true, minItems: 1, maxItems: 3 })) }, { additionalProperties: false });

export const ApiObjectResponse = Type.Object({
  requestId: Type.String(),
  data: Type.Unknown(),
}, { additionalProperties: false });

export const ApiErrorResponse = Type.Object({
  requestId: Type.String(),
  error: Type.Object({ code: Type.String(), message: Type.String(), issues: Type.Optional(Type.Array(Type.Object({ field: Type.String(), message: Type.String() }, { additionalProperties: false }))) }, { additionalProperties: false }),
}, { additionalProperties: false });

export const OpenApiSecurity = [{ bearerAuth: [] }];
