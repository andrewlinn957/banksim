import { Type } from '@fastify/type-provider-typebox';
import { capitalMarketsInstrumentsForArea } from '../application/playerControls';
import { getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';

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
const RiskAppetiteTargets = Type.Object({
  cet1: Type.Number(), leverage: Type.Number(), lcr: Type.Number(), nsfr: Type.Number(), irrbbEveLimit: Type.Number(),
}, { additionalProperties: false });

const capitalMarketsDrafts = (['Capital', 'Treasury'] as const).flatMap((area) =>
  capitalMarketsInstrumentsForArea(area).map((instrument) => {
    const definition = getCapitalMarketsInstrument(instrument);
    const pricing = definition.pricingKind === 'discount'
      ? { maxDiscountRatio: Type.Optional(Type.Number({ minimum: 0, maximum: 0.5 })) }
      : { maxSpreadBps: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 5000 })) };
    const tenor = definition.permittedTenorMonths?.length
      ? { tenorMonths: Type.Optional(Type.Union(definition.permittedTenorMonths.map((months) => Type.Literal(months)))) }
      : {};
    return Type.Object({
      kind: Type.Literal('capitalMarkets'), area: Type.Literal(area), instrument: Type.Literal(instrument),
      targetAmountGbp: Type.Number({ exclusiveMinimum: 0 }), ...pricing, ...tenor,
    }, { additionalProperties: false });
  }),
);

const TransactionDraft = Type.Union([
  ...capitalMarketsDrafts,
  Type.Object({ kind: Type.Literal('gilt'), direction: Type.Literal('buy'), amountGbp: Type.Number({ exclusiveMinimum: 0 }), tenorMonths: Type.Optional(Type.Union([Type.Literal(24), Type.Literal(60), Type.Literal(120)])) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('gilt'), direction: Type.Literal('sell'), amountGbp: Type.Number({ exclusiveMinimum: 0 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('boeFunding'), facility: Type.Union([Type.Literal('STR'), Type.Literal('ILTR')]), amountGbp: Type.Number({ exclusiveMinimum: 0 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('hedge'), direction: Type.Union([Type.Literal('payFixedReceiveFloat'), Type.Literal('receiveFixedPayFloat')]), notionalGbp: Type.Number({ exclusiveMinimum: 0 }), maturityMonths: Type.Union([Type.Literal(12), Type.Literal(24), Type.Literal(60)]) }, { additionalProperties: false }),
]);

const CommandEnvelope = {
  commandId: Type.String({ minLength: 1, maxLength: 128 }),
  expectedRevision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
};

export const PlayerCommandBody = Type.Union([
  Type.Object({ ...CommandEnvelope, type: Type.Literal('update_decisions'), payload: Type.Object({ controls: Controls }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ ...CommandEnvelope, type: Type.Literal('queue_transaction'), payload: TransactionDraft }, { additionalProperties: false }),
  Type.Object({ ...CommandEnvelope, type: Type.Literal('cancel_transaction'), payload: Type.Object({ kind: Type.Union([Type.Literal('capitalMarkets'), Type.Literal('gilt'), Type.Literal('boeFunding'), Type.Literal('hedge')]) }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ ...CommandEnvelope, type: Type.Literal('set_risk_appetite'), payload: Type.Object({ targets: Type.Union([RiskAppetiteTargets, Type.Null()]) }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ ...CommandEnvelope, type: Type.Literal('set_safety_pause'), payload: Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ ...CommandEnvelope, type: Type.Literal('advance_time'), payload: Type.Object({ months: Type.Integer({ minimum: 1, maximum: 12 }) }, { additionalProperties: false }) }, { additionalProperties: false }),
]);

export const PlayerReportQuery = Type.Object({
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  department: Type.Optional(Type.Union([Type.Literal('Customers'), Type.Literal('Lending'), Type.Literal('Capital'), Type.Literal('Treasury')])),
  unit: Type.Optional(Type.Union([Type.Literal('ratio'), Type.Literal('money'), Type.Literal('headroom')])),
  selected: Type.Optional(Type.Array(Type.String({ maxLength: 100 }), { maxItems: 40 })),
  years: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('1'), Type.Literal('3'), Type.Literal('5')])),
  periodMonths: Type.Optional(Type.Union([Type.Literal(3), Type.Literal(12)])),
  portfolio: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
}, { additionalProperties: false });

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
