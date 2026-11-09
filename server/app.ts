import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { Type, TypeBoxTypeProvider, TypeBoxValidatorCompiler } from '@fastify/type-provider-typebox';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Static } from 'typebox';
import { baseConfig } from '../src/config/baseConfig';
import { scenarios } from '../src/config/scenarios';
import { createDefaultThreeYearPlan } from '../src/config/threeYearPlan';
import { cloneBankState } from '../src/engine/clone';
import { canonicalBankStateJson, decodePlayerSessionState, encodePlayerSessionState } from '../src/application/sessionCodec';
import { createActionFormState } from '../src/application/actionFormState';
import { prepareScenarioSession } from '../src/application/scenarioSession';
import {
  closePlayerSessionMonth,
  createPlayerSessionState,
  updatePlayerSessionRiskAppetite,
  updatePlayerSessionSafetyPause,
  type PlayerSessionState,
} from '../src/application/playerSession';
import { cancelPlayerSessionTransaction, queuePlayerSessionTransaction, updatePlayerSessionDecisions } from '../src/application/playerSessionCommands';
import { buildPendingActionLabels, capitalMarketsInstrumentsForArea, PLAYER_CONTROL_REGISTRY, parseActionFormInputs, riskAppetiteFloorsFor, type ActionFormField } from '../src/application/playerControls';
import { getCapitalMarketsInstrument } from '../src/capitalMarkets/catalogue';
import { buildPlayerNextClosePreview } from '../src/application/playerPreview';
import { buildPlayerReport, findPlayerHelpTopic, playerReportAvailability } from '../src/application/playerReports';
import { buildHelpCenterData } from '../src/presentation/help';
import { buildTreasuryTransactionLimits } from '../src/presentation/treasuryLimits';
import { monthsForPlayerAdvance } from '../src/application/playerTime';
import { PLAYER_REPORT_REGISTRY } from '../src/presentation/reportRegistry';
import { SimulationController } from '../src/application/simulationController';
import { canonicalJson, EvaluationStore, hashBankState, hashJson, type RunManifest, type StoredCommand } from './store';
import { createServerAuditIntegrity, type ServerAuditExport } from './auditBundle';
import {
  AdminCreateRunBody,
  ApiErrorResponse,
  CommandStatusParams,
  CredentialIssueBody,
  CredentialParams,
  HelpTopicParams,
  OpenApiSecurity,
  PlayerCommandBody,
  PlayerPreviewBody,
  PlayerReportQuery,
  ReplayBody,
  RunIdParams,
  StopRunBody,
} from '../src/contracts/playerApi';

export const DEFAULT_MAX_ADVANCE_MONTHS = 12;
export const DEFAULT_MAX_HORIZON_MONTHS = 120;
export const TOOL_CONTRACT_VERSION = 'banksim-player-tools-v2';
export const REPORT_CONTRACT_VERSION = 'banksim-player-reports-v1';

type CommandBody = Static<typeof PlayerCommandBody>;
type AuthRecord = { credentialId: string; runId: string; scopes: string[] };

export interface BankSimServerOptions {
  store: EvaluationStore;
  adminToken: string;
  engineVersion: string;
  buildDigest?: string;
  dependencyLockHash?: string;
  scenarioVersion?: string;
  maxAdvanceMonths?: number;
  maxHorizonMonths?: number;
  bodyLimitBytes?: number;
  requestRateLimitMax?: number;
  logger?: false | FastifyServerOptions['logger'];
  host?: string;
  testHooks?: { afterAdvanceMonthCommit?: (runId: string, completedMonths: number) => void };
}

export class SimulatedProcessInterruption extends Error {
  constructor() {
    super('Simulated process interruption after committed monthly checkpoint');
    this.name = 'SimulatedProcessInterruption';
  }
}

class ApiProblem extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string, readonly issues?: Array<{ field: string; message: string }>) {
    super(message);
    this.name = 'ApiProblem';
  }
}

const requestIdOf = (request: FastifyRequest) => request.id;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const tokenEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const bearer = (authorization: string | undefined): string | undefined => {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
  return match?.[1];
};

const sendProblem = (reply: FastifyReply, requestId: string, status: number, code: string, message: string, issues?: Array<{ field: string; message: string }>) =>
  reply.code(status).send({ requestId, error: { code, message, ...(issues ? { issues } : {}) } });

const sessionStatus = (session: PlayerSessionState) => ({
  revision: session.revision,
  simulationStep: session.bankState.time.step,
  status: session.status,
  stopReason: session.stopReason ?? null,
  horizonMonths: session.horizonMonths ?? null,
  monthsRemaining: session.horizonMonths === undefined ? null : Math.max(0, session.horizonMonths - (session.bankState.time.step - session.openingState.time.step)),
});

const playerOverview = (session: PlayerSessionState, controller: SimulationController) => {
  const report = buildPlayerReport(session, controller, 'report.overview');
  return { ...sessionStatus(session), overview: report?.data };
};

const controlValues = (session: PlayerSessionState) => {
  const parsed = parseActionFormInputs(session.actionForm, { capitalMarketsArea: session.capitalMarketsDraftArea ?? undefined });
  const fields = Object.keys(session.actionForm) as ActionFormField[];
  return Object.fromEntries(fields.map((field) => {
    if (field === 'capitalMarketsTargetAmount' || field === 'giltTradeAmount' || field === 'boeFundingAmount' || field === 'hedgeNotional') {
      const raw = session.actionForm[field];
      const number = Number(raw.replace(/,/g, ''));
      return [field, raw.trim() !== '' && Number.isFinite(number) ? number : null];
    }
    const numeric = parsed.values[field];
    if (numeric !== undefined) return [field, numeric];
    return [field, session.actionForm[field]];
  }));
};

const controlDefinitions = (session: PlayerSessionState, maxAdvanceMonths: number, maxPageSize: number) => {
  const limits = buildTreasuryTransactionLimits(session.bankState, baseConfig, session.actionForm);
  const floors = riskAppetiteFloorsFor(session.bankState, session.config);
  const currentRiskTargets = session.pendingRiskAppetite ?? session.bankState.behaviour.riskAppetite;
  return {
    controls: PLAYER_CONTROL_REGISTRY.map(({ id, area, label, description, formFields, category, guiLocation, units, choices, fieldChoices, areaChoices, minimum, maximum, increment, persistent }) => ({
      id, area, label, description, inputFields: [...formFields], category, guiLocation, units,
      ...(choices ? { choices: [...choices] } : {}),
      ...(fieldChoices ? { fieldChoices } : {}),
      ...(areaChoices ? { areaChoices } : {}),
      ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}),
      ...(increment !== undefined ? { sliderStep: increment, exactInputAllowsIntermediateValues: true } : {}), persistent,
      available: session.status === 'active' && !session.bankState.status.hasFailed,
    })),
    currentValues: controlValues(session),
    transactionOptions: {
      capitalMarketsByArea: Object.fromEntries((['Capital', 'Treasury'] as const).map((area) => [
        area,
        capitalMarketsInstrumentsForArea(area).map((instrument) => {
          const definition = getCapitalMarketsInstrument(instrument);
          return {
            instrument,
            label: definition.label,
            pricingKind: definition.pricingKind,
            permittedTenorMonths: definition.permittedTenorMonths ? [...definition.permittedTenorMonths] : [],
          };
        }),
      ])),
    },
    riskAppetite: {
      floors,
      maximums: { cet1: 1, leverage: 1, lcr: 10, nsfr: 10, irrbbEveLimit: null },
      pending: session.pendingRiskAppetite === undefined ? null : session.pendingRiskAppetite,
      effective: currentRiskTargets ?? null,
    },
    treasuryLimits: {
      unencumberedGiltsGbp: limits.unencumberedGilts,
      maxGiltSaleGbp: limits.maxGiltSaleAmount,
      maxBoeFundingGbp: limits.maxBoeFundingAmount,
      calculationConfig: 'baseConfig, matching the current GUI Treasury ticket calculation',
    },
    time: {
      safetyPause: session.safetyPause,
      safetyPauseDisableArmed: session.safetyPauseDisableArmed ?? false,
      monthsUntilQuarterEnd: monthsForPlayerAdvance(session.openingState.time.step, session.bankState.time.step, 'quarter'),
      monthsUntilYearEnd: monthsForPlayerAdvance(session.openingState.time.step, session.bankState.time.step, 'year'),
      continuousRunLimitMonths: maxAdvanceMonths,
    },
    operationalLimits: { maxAdvanceMonths, maxPageSize },
  };
};

const getAdminId = (request: FastifyRequest) => (request.params as { runId: string }).runId;
const getPlayerId = (request: FastifyRequest) => (request.params as { runId: string }).runId;

const manifestFrom = (session: PlayerSessionState, args: {
  engineVersion: string;
  buildDigest: string;
  dependencyLockHash: string;
  scenarioVersion: string;
  mode: { threeYearPlan: boolean };
  evaluationLimits: { maxModelTurns: number; maxToolCalls: number };
}): RunManifest => ({
  schemaVersion: 1,
  engineVersion: args.engineVersion,
  buildDigest: args.buildDigest,
  dependencyLockHash: args.dependencyLockHash,
  nodeVersion: process.version,
  scenarioId: session.scenarioId,
  scenarioVersion: args.scenarioVersion,
  configSnapshot: session.config,
  configHash: hashJson(session.config),
  seed: session.seed,
  seedSchemeVersion: session.seedSchemeVersion,
  startDate: session.openingState.time.date.toISOString(),
  horizonMonths: session.horizonMonths ?? DEFAULT_MAX_HORIZON_MONTHS,
  featureFlags: { ...(session.config.featureFlags ?? {}) },
  mode: args.mode,
  scoreVersion: 'banksim-scenario-score-v1',
  controlContractVersion: TOOL_CONTRACT_VERSION,
  reportContractVersion: REPORT_CONTRACT_VERSION,
  evaluationLimits: args.evaluationLimits,
});

const routeSecurity = OpenApiSecurity;

export const createBankSimServer = async (options: BankSimServerOptions): Promise<FastifyInstance> => {
  if (!options.adminToken || options.adminToken.length < 32) throw new Error('BANKSIM_ADMIN_TOKEN must be at least 32 characters');
  const maxAdvanceMonths = options.maxAdvanceMonths ?? DEFAULT_MAX_ADVANCE_MONTHS;
  const maxHorizonMonths = options.maxHorizonMonths ?? DEFAULT_MAX_HORIZON_MONTHS;
  const bodyLimitBytes = options.bodyLimitBytes ?? 1_000_000;
  const requestRateLimitMax = options.requestRateLimitMax ?? 120;
  if (!Number.isInteger(maxAdvanceMonths) || maxAdvanceMonths < 1 || maxAdvanceMonths > 12) throw new Error('maxAdvanceMonths must be an integer from 1 to 12');
  if (!Number.isInteger(maxHorizonMonths) || maxHorizonMonths < 1 || maxHorizonMonths > DEFAULT_MAX_HORIZON_MONTHS) throw new Error('maxHorizonMonths must be an integer from 1 to 120');
  if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes < 1024 || bodyLimitBytes > 10_000_000) throw new Error('bodyLimitBytes must be an integer from 1024 to 10000000');
  if (!Number.isInteger(requestRateLimitMax) || requestRateLimitMax < 1 || requestRateLimitMax > 100_000) throw new Error('requestRateLimitMax must be an integer from 1 to 100000');
  const buildInfo = serverBuildInfo();
  const buildDigest = options.buildDigest ?? process.env.BANKSIM_BUILD_DIGEST ?? buildInfo.buildDigest;
  const dependencyLockHash = options.dependencyLockHash ?? process.env.BANKSIM_LOCKFILE_HASH ?? buildInfo.lockfileHash;
  const scenarioVersion = options.scenarioVersion ?? process.env.BANKSIM_SCENARIO_VERSION ?? 'public-catalogue-v1';
  if (options.store.hasActiveRunsOnOtherBuild(options.engineVersion, buildDigest, dependencyLockHash)) {
    throw new Error('The database contains active runs pinned to another engine release or build digest; stop or finish them before starting this build');
  }
  const adminTokenHash = hashToken(options.adminToken);
  const authByRequest = new WeakMap<object, AuthRecord>();
  const runLocks = new Map<string, Promise<void>>();
  const app = Fastify({
    logger: options.logger ?? { level: process.env.LOG_LEVEL ?? 'info', redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: '[REDACTED]' } },
    bodyLimit: bodyLimitBytes,
    requestIdHeader: false,
  }).withTypeProvider<TypeBoxTypeProvider>();
  app.setValidatorCompiler(TypeBoxValidatorCompiler);
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: { title: 'BankSim Evaluation API', version: '1.0.0' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque token' } } },
      tags: [
        { name: 'health' }, { name: 'player' }, { name: 'admin' },
      ],
    },
  });
  await app.register(rateLimit, { max: requestRateLimitMax, timeWindow: '1 minute' });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiProblem) return sendProblem(reply, request.id, error.statusCode, error.code, error.message, error.issues);
    if (error.validation) {
      const issues = error.validation.map((item) => ({ field: String(item.instancePath || item.params?.missingProperty || 'request'), message: 'Value does not match the API schema' }));
      return sendProblem(reply, request.id, 400, 'INVALID_REQUEST', 'Request failed schema validation', issues);
    }
    if (error.statusCode === 413) return sendProblem(reply, request.id, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the configured limit');
    request.log.error({ requestId: request.id }, 'BankSim API request failed');
    return sendProblem(reply, request.id, 500, 'INTERNAL_ERROR', 'The request could not be completed');
  });

  app.get('/health', { schema: { tags: ['health'], response: { 200: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'], additionalProperties: false } } } }, async () => ({ status: 'ok' }));
  app.get('/openapi.json', { schema: { tags: ['health'] } }, async () => app.swagger());
  let recoverPendingCommands: () => Promise<void> = async () => {};

  const withRunLock = async <T>(runId: string, action: () => T | Promise<T>): Promise<T> => {
    const previous = runLocks.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    const queued = previous.then(() => current);
    runLocks.set(runId, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (runLocks.get(runId) === queued) runLocks.delete(runId);
    }
  };

  const checkBuild = (runId: string) => {
    const run = options.store.getRun(runId);
    if (!run) throw new ApiProblem(404, 'RUN_NOT_FOUND', 'Run not found');
    if (run.engineVersion !== options.engineVersion || run.manifest.buildDigest !== buildDigest || run.manifest.dependencyLockHash !== dependencyLockHash) {
      throw new ApiProblem(409, 'INCOMPATIBLE_ENGINE', 'This run is pinned to a different engine release');
    }
    return run;
  };

  const sendAuth = (reply: FastifyReply, request: FastifyRequest, status: number, code: string, message: string) =>
    sendProblem(reply, request.id, status, code, message);

  await app.register(async (adminApi) => {
    adminApi.addHook('preHandler', async (request, reply) => {
      const supplied = bearer(request.headers.authorization);
      if (!supplied || !tokenEqual(hashToken(supplied), adminTokenHash)) return sendAuth(reply, request, 401, 'ADMIN_AUTH_REQUIRED', 'Administrator authentication required');
    });

    adminApi.post('/runs', { schema: { tags: ['admin'], body: AdminCreateRunBody, security: routeSecurity, response: { 201: Type.Unknown(), 400: ApiErrorResponse, 401: ApiErrorResponse, 409: ApiErrorResponse } } }, async (request, reply) => {
      const body = request.body as Static<typeof AdminCreateRunBody>;
      if (body.engineVersion !== options.engineVersion) return sendProblem(reply, request.id, 409, 'ENGINE_VERSION_MISMATCH', 'Requested engine release is not served by this process');
      if (body.horizonMonths > maxHorizonMonths) return sendProblem(reply, request.id, 400, 'HORIZON_LIMIT', `Maximum configured horizon is ${maxHorizonMonths} months`);
      if (options.store.hasActiveRunsOnOtherBuild(options.engineVersion, buildDigest, dependencyLockHash)) return sendProblem(reply, request.id, 409, 'ACTIVE_RUNS_PINNED', 'Complete or terminate active runs before changing the served engine release');
      if (body.scenarioId !== null && !scenarios.some((scenario) => scenario.id === body.scenarioId)) return sendProblem(reply, request.id, 400, 'UNKNOWN_SCENARIO', 'Selected scenario is not available to the GUI');
      const threeYearPlan = body.mode?.threeYearPlan ?? false;
      if (threeYearPlan && body.scenarioId !== null) return sendProblem(reply, request.id, 400, 'MODE_UNAVAILABLE', 'Three-year plan mode can only be selected for a sandbox opening');
      let startDate: Date | undefined;
      if (body.startDate !== undefined) {
        startDate = new Date(body.startDate);
        if (!Number.isFinite(startDate.getTime())) return sendProblem(reply, request.id, 400, 'INVALID_START_DATE', 'Start date must be a valid ISO date');
      }
      const preparedOriginal = prepareScenarioSession(body.scenarioId, { seed: body.seed, startDate });
      const config = structuredClone(preparedOriginal.config);
      config.featureFlags = { ...(config.featureFlags ?? {}), threeYearPlan };
      const state = cloneBankState(preparedOriginal.state);
      if (threeYearPlan) state.threeYearPlan = createDefaultThreeYearPlan(state);
      else state.threeYearPlan = undefined;
      const prepared = { ...preparedOriginal, config, state, actionForm: createActionFormState(state, config) };
      const runId = randomUUID();
      const controller = new SimulationController(config);
      const session = createPlayerSessionState({ runId, scenarioId: body.scenarioId, prepared, controller, horizonMonths: body.horizonMonths });
      const evaluationLimits = {
        maxModelTurns: body.limits?.maxModelTurns ?? 1000,
        maxToolCalls: body.limits?.maxToolCalls ?? 5000,
      };
      const manifest = manifestFrom(session, { engineVersion: options.engineVersion, buildDigest, dependencyLockHash, scenarioVersion, mode: { threeYearPlan }, evaluationLimits });
      options.store.createRun(runId, session, manifest);
      return reply.code(201).send({ requestId: request.id, runId, status: session.status, revision: session.revision, simulationStep: session.bankState.time.step, manifest });
    });

    adminApi.get('/runs/:runId', { schema: { tags: ['admin'], params: RunIdParams, security: routeSecurity, response: { 401: ApiErrorResponse } } }, async (request, reply) => {
      const runId = getAdminId(request);
      const run = options.store.getRun(runId);
      if (!run) return sendProblem(reply, request.id, 404, 'RUN_NOT_FOUND', 'Run not found');
      const session = decodePlayerSessionState(run.sessionJson);
      return { requestId: request.id, runId, status: run.status, revision: run.revision, simulationStep: session.bankState.time.step, stopReason: run.stopReason, createdAt: run.createdAt, updatedAt: run.updatedAt, manifest: run.manifest, credentials: options.store.listCredentials(runId) };
    });

    adminApi.post('/runs/:runId/credentials', { schema: { tags: ['admin'], params: RunIdParams, body: CredentialIssueBody, security: routeSecurity, response: { 201: Type.Unknown(), 401: ApiErrorResponse } } }, async (request, reply) => {
      const runId = getAdminId(request);
      if (!options.store.getRun(runId)) return sendProblem(reply, request.id, 404, 'RUN_NOT_FOUND', 'Run not found');
      const body = request.body as Static<typeof CredentialIssueBody>;
      const scopes = body.scopes ?? ['player:read', 'player:write', 'player:export'];
      const credentialId = randomUUID();
      const token = randomBytes(32).toString('base64url');
      options.store.createCredential(credentialId, runId, hashToken(token), scopes);
      return reply.code(201).send({ requestId: request.id, credentialId, runId, scopes, token, tokenFormat: 'opaque bearer; shown once' });
    });

    adminApi.delete('/runs/:runId/credentials/:credentialId', { schema: { tags: ['admin'], params: CredentialParams, security: routeSecurity, response: { 401: ApiErrorResponse } } }, async (request, reply) => {
      const { runId, credentialId } = request.params as Static<typeof CredentialParams>;
      if (!options.store.getRun(runId)) return sendProblem(reply, request.id, 404, 'RUN_NOT_FOUND', 'Run not found');
      const revoked = options.store.revokeCredential(runId, credentialId);
      if (!revoked) return sendProblem(reply, request.id, 404, 'CREDENTIAL_NOT_FOUND', 'Active credential not found for this run');
      return { requestId: request.id, credentialId, revoked: true };
    });

    adminApi.post('/runs/:runId/stop', { schema: { tags: ['admin'], params: RunIdParams, body: StopRunBody, security: routeSecurity, response: { 401: ApiErrorResponse } } }, async (request, reply) => {
      const runId = getAdminId(request);
      const body = request.body as Static<typeof StopRunBody>;
      return withRunLock(runId, () => {
        const run = options.store.getRun(runId);
        if (!run) return sendProblem(reply, request.id, 404, 'RUN_NOT_FOUND', 'Run not found');
        const session = decodePlayerSessionState(run.sessionJson);
        if (session.status !== 'active') return sendProblem(reply, request.id, 409, 'RUN_TERMINAL', 'Run is already terminal');
        const stopped: PlayerSessionState = { ...session, revision: session.revision + 1, status: 'owner_stopped', stopReason: body.reason };
        options.store.markOwnerStopped(runId, stopped, body.reason);
        return { requestId: request.id, runId, status: stopped.status, revision: stopped.revision, simulationStep: stopped.bankState.time.step, stopReason: stopped.stopReason };
      });
    });

    adminApi.get('/runs/:runId/export', { schema: { tags: ['admin'], params: RunIdParams, security: routeSecurity, response: { 401: ApiErrorResponse } } }, async (request, reply) => {
      const runId = getAdminId(request);
      const run = options.store.getRun(runId);
      if (!run) return sendProblem(reply, request.id, 404, 'RUN_NOT_FOUND', 'Run not found');
      const checkpoints = options.store.listCheckpoints(runId).map((row) => ({
        step: Number(row.step), revision: Number(row.revision), stateHash: String(row.state_hash),
        sessionCodec: String(row.session_json), session: decodePlayerSessionState(String(row.session_json)), createdAt: String(row.created_at),
      }));
      const finalSession = decodePlayerSessionState(run.sessionJson);
      const openingSession = checkpoints[0]?.session;
      if (!openingSession || !checkpoints[0]) return sendProblem(reply, request.id, 500, 'AUDIT_INCOMPLETE', 'Run opening checkpoint is missing');
      const checkpointsWithHashes = checkpoints.map((checkpoint) => ({
        ...checkpoint,
        sessionHash: hashJson(JSON.parse(JSON.stringify(checkpoint.session)) as unknown),
      }));
      const runDetails = { runId, status: run.status, revision: run.revision, stopReason: run.stopReason, createdAt: run.createdAt, updatedAt: run.updatedAt };
      const commands = options.store.listCommands(runId);
      const serverAudit = options.store.listAuditRecords(runId);
      const payload = {
        requestId: request.id,
        bundleVersion: 2,
        manifest: run.manifest,
        run: runDetails,
        openingSession,
        openingSessionCodec: checkpoints[0].sessionCodec,
        currentSession: finalSession,
        currentSessionCodec: run.sessionJson,
        checkpoints: checkpointsWithHashes,
        commands,
        serverAudit,
        clientTranscript: { completeness: 'not-collected-by-server', records: [], note: 'Provider transcript is client-reported provenance and must be joined by the owner collection workflow.' },
      };
      const integrity = createServerAuditIntegrity({
        manifest: payload.manifest,
        run: payload.run,
        openingSession: payload.openingSession,
        currentSession: payload.currentSession,
        checkpoints: checkpointsWithHashes,
        commands,
        serverAudit,
        finalStateHash: hashBankState(finalSession.bankState),
      });
      return { ...payload, integrity } satisfies ServerAuditExport;
    });

    adminApi.post('/replays', { schema: { tags: ['admin'], body: ReplayBody, security: routeSecurity, response: { 401: ApiErrorResponse } } }, async (request, reply) => {
      const { runId } = request.body as Static<typeof ReplayBody>;
      const run = options.store.getRun(runId);
      if (!run) return sendProblem(reply, request.id, 404, 'RUN_NOT_FOUND', 'Run not found');
      if (run.engineVersion !== options.engineVersion || run.manifest.buildDigest !== buildDigest || run.manifest.dependencyLockHash !== dependencyLockHash) {
        return sendProblem(reply, request.id, 409, 'INCOMPATIBLE_ENGINE', 'Replay requires the recorded engine release');
      }
      const session = decodePlayerSessionState(run.sessionJson);
      const checkpoints = options.store.listCheckpoints(runId);
      const expectedByStep = new Map(checkpoints.map((row) => [Number(row.step), String(row.state_hash)]));
      const controller = new SimulationController(session.config);
      let state = session.openingState;
      let firstDivergence: { step: number; expected: string | null; actual: string } | null = null;
      let matchedSteps = 0;
      const openingHash = hashBankState(state);
      if (expectedByStep.get(state.time.step) !== openingHash) firstDivergence = { step: state.time.step, expected: expectedByStep.get(state.time.step) ?? null, actual: openingHash };
      else matchedSteps += 1;
      for (const entry of session.timeline) {
        if (firstDivergence) break;
        state = cloneBankState(controller.step(state, entry.actions, entry.shocks, runId).nextState);
        const actual = hashBankState(state);
        const expected = expectedByStep.get(entry.step) ?? null;
        if (actual !== expected) firstDivergence = { step: entry.step, expected, actual };
        else matchedSteps += 1;
      }
      const result = { requestId: request.id, runId, replayed: firstDivergence === null, matchedSteps, firstDivergence, finalStateHash: hashBankState(state) };
      options.store.recordAudit(runId, 'admin_replay', result);
      return result;
    });
  }, { prefix: '/admin/v1' });

  await app.register(async (playerApi) => {
    playerApi.addHook('preHandler', async (request, reply) => {
      const runId = getPlayerId(request);
      const supplied = bearer(request.headers.authorization);
      if (!supplied) return sendAuth(reply, request, 401, 'PLAYER_AUTH_REQUIRED', 'Player run token required');
      const auth = options.store.resolveCredential(hashToken(supplied));
      if (!auth || auth.runId !== runId) return sendAuth(reply, request, 403, 'PLAYER_SCOPE_DENIED', 'Credential is not authorised for this run');
      const run = options.store.getRun(runId);
      if (!run) return sendAuth(reply, request, 404, 'RUN_NOT_FOUND', 'Run not found');
      if (run.engineVersion !== options.engineVersion || run.manifest.buildDigest !== buildDigest || run.manifest.dependencyLockHash !== dependencyLockHash) {
        return sendAuth(reply, request, 409, 'INCOMPATIBLE_ENGINE', 'This run is pinned to a different engine release');
      }
      authByRequest.set(request, auth);
    });

    const requireScope = (request: FastifyRequest, scope: string) => {
      const auth = authByRequest.get(request);
      if (!auth || !auth.scopes.includes(scope)) throw new ApiProblem(403, 'PLAYER_SCOPE_DENIED', `Credential does not include ${scope}`);
    };
    const loadSession = (runId: string) => {
      const run = checkBuild(runId);
      return { run, session: decodePlayerSessionState(run.sessionJson) };
    };
    const recordRead = (runId: string, request: FastifyRequest, response: unknown) => {
      options.store.appendReadAudit(runId, { requestId: request.id, method: request.method, route: request.routeOptions.url, params: request.params, query: request.query }, response);
    };

    playerApi.get('/runs/:runId/overview', { schema: { tags: ['player'], params: RunIdParams, security: routeSecurity } }, async (request) => {
      requireScope(request, 'player:read');
      const runId = getPlayerId(request);
      const { run, session } = loadSession(runId);
      const data = {
        requestId: request.id, runId,
        ...playerOverview(session, new SimulationController(session.config)),
        evaluationLimits: run.manifest.evaluationLimits,
      };
      recordRead(runId, request, data);
      return data;
    });

    playerApi.get('/runs/:runId/controls', { schema: { tags: ['player'], params: RunIdParams, security: routeSecurity } }, async (request) => {
      requireScope(request, 'player:read');
      const runId = getPlayerId(request);
      const { session } = loadSession(runId);
      const data = { requestId: request.id, runId, ...sessionStatus(session), ...controlDefinitions(session, maxAdvanceMonths, 500) };
      recordRead(runId, request, data);
      return data;
    });

    playerApi.get('/runs/:runId/reports', { schema: { tags: ['player'], params: RunIdParams, security: routeSecurity } }, async (request) => {
      requireScope(request, 'player:read');
      const runId = getPlayerId(request);
      const { session } = loadSession(runId);
      const data = { requestId: request.id, runId, reports: playerReportAvailability(session) };
      recordRead(runId, request, data);
      return data;
    });

    playerApi.get('/runs/:runId/reports/:reportId', { schema: { tags: ['player'], params: Type.Object({ runId: Type.String({ minLength: 1, maxLength: 128 }), reportId: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }), querystring: PlayerReportQuery, security: routeSecurity } }, async (request, reply) => {
      requireScope(request, 'player:read');
      const { runId, reportId } = request.params as { runId: string; reportId: string };
      const { session } = loadSession(runId);
      const definition = PLAYER_REPORT_REGISTRY.find((report) => report.id === reportId);
      if (!definition) return sendProblem(reply, request.id, 404, 'REPORT_NOT_FOUND', 'Report not found');
      const available = playerReportAvailability(session).find((report) => report.id === reportId)?.available ?? false;
      if (!available) return sendProblem(reply, request.id, 409, 'REPORT_UNAVAILABLE', 'Report is not currently available');
      const report = buildPlayerReport(session, new SimulationController(session.config), reportId, request.query as Static<typeof PlayerReportQuery>);
      if (!report) return sendProblem(reply, request.id, 404, 'REPORT_NOT_FOUND', 'Report not found');
      const data = { requestId: request.id, runId, revision: session.revision, simulationStep: session.bankState.time.step, ...report };
      recordRead(runId, request, data);
      return data;
    });

    playerApi.get('/runs/:runId/help/:topicId', { schema: { tags: ['player'], params: HelpTopicParams, security: routeSecurity } }, async (request, reply) => {
      requireScope(request, 'player:read');
      const { runId, topicId } = request.params as Static<typeof HelpTopicParams>;
      const { session } = loadSession(runId);
      const topic = findPlayerHelpTopic(session, topicId);
      if (!topic) return sendProblem(reply, request.id, 404, 'HELP_TOPIC_NOT_FOUND', 'Help topic not found');
      const data = { requestId: request.id, runId, topic };
      recordRead(runId, request, data);
      return data;
    });

    playerApi.post('/runs/:runId/preview', { schema: { tags: ['player'], params: RunIdParams, body: PlayerPreviewBody, security: routeSecurity } }, async (request, reply) => {
      requireScope(request, 'player:read');
      const runId = getPlayerId(request);
      const { session } = loadSession(runId);
      const body = request.body as Static<typeof PlayerPreviewBody>;
      const result = buildPlayerNextClosePreview(session, new SimulationController(session.config), body.department ?? 'Customers');
      if (result.accepted === false) return sendProblem(reply, request.id, 422, 'INVALID_DRAFT', 'Current decisions cannot be previewed', result.issues);
      const data = { requestId: request.id, runId, revision: session.revision, simulationStep: session.bankState.time.step, ...result };
      recordRead(runId, request, data);
      return data;
    });

    playerApi.get('/runs/:runId/export', { schema: { tags: ['player'], params: RunIdParams, security: routeSecurity } }, async (request) => {
      requireScope(request, 'player:export');
      const runId = getPlayerId(request);
      const { session } = loadSession(runId);
      const report = buildPlayerReport(session, new SimulationController(session.config), 'report.player_export');
      const data = { requestId: request.id, runId, extract: report?.data };
      recordRead(runId, request, data);
      return data;
    });

    const buildCommandResponse = (requestId: string, commandId: string, accepted: boolean, session: PlayerSessionState, controller: SimulationController, details: Record<string, unknown> = {}) => ({
      requestId, commandId, accepted, ...sessionStatus(session), ...details,
      ...(accepted ? { overview: buildPlayerReport(session, controller, 'report.overview')?.data } : {}),
    });

    const executeAdvance = (runId: string, command: StoredCommand, request: CommandBody) => {
      const months = (request as Extract<CommandBody, { type: 'advance_time' }>).payload.months;
      let session = options.store.getSession(runId);
      if (!session) throw new ApiProblem(404, 'RUN_NOT_FOUND', 'Run not found');
      const controller = new SimulationController(session.config);
      let completed = command.completedMonths;
      let latestEvents: unknown[] = [];
      let lastCloseDetails: Record<string, unknown> = {};
      try {
        while (completed < months && session.status === 'active') {
          if (session.horizonMonths !== undefined && session.bankState.time.step - session.openingState.time.step >= session.horizonMonths) break;
          const closed = closePlayerSessionMonth(session, controller);
          if (closed.accepted === false) {
            const response = buildCommandResponse(command.requestId, command.commandId, false, session, controller, { issues: closed.issues, errorCode: 'INVALID_DECISIONS' });
            options.store.finishAdvanceCommand({ runId, commandId: command.commandId, response, commandStatus: 'rejected' });
            return response;
          }
          const nextSession = closed.session;
          completed += 1;
          latestEvents = closed.events;
          lastCloseDetails = { attribution: closed.attribution, executions: closed.executions, pausedForAttention: closed.pausedForAttention };
          options.store.commitMonth({
            runId,
            session: nextSession,
            commandId: command.commandId,
            completedMonths: completed,
            audit: {
              commandId: command.commandId,
              requestId: command.requestId,
              monthIndex: completed,
              acceptedActions: closed.actions,
              shocks: closed.shocks,
              events: closed.events,
              executions: closed.executions,
              attribution: closed.attribution,
              stateHash: hashBankState(nextSession.bankState),
              status: nextSession.status,
              stopReason: nextSession.stopReason ?? null,
            },
          });
          session = nextSession;
          options.testHooks?.afterAdvanceMonthCommit?.(runId, completed);
          if (closed.pausedForAttention) break;
        }
        const response = buildCommandResponse(command.requestId, command.commandId, true, session, controller, {
          monthsRequested: months,
          monthsClosed: completed,
          events: latestEvents,
          lastClose: lastCloseDetails,
          progress: { completedMonths: completed, totalMonths: months, status: 'completed' },
        });
        options.store.finishAdvanceCommand({ runId, commandId: command.commandId, response, commandStatus: 'completed' });
        return response;
      } catch (error) {
        if (error instanceof SimulatedProcessInterruption) throw error;
        const committedSession = options.store.getSession(runId) ?? session;
        const failedSession: PlayerSessionState = { ...committedSession, revision: committedSession.revision + 1, status: 'server_error', stopReason: 'server_error' };
        const failureResponse = { requestId: command.requestId, commandId: command.commandId, accepted: false, ...sessionStatus(failedSession), errorCode: 'SERVER_ERROR', message: 'The monthly close could not be completed' };
        options.store.failAdvanceCommand(runId, command.commandId, failedSession, failureResponse);
        return failureResponse;
      }
    };

    const resumeRunningCommand = (stored: StoredCommand) => {
      if (stored.status !== 'running') return stored.responseJson ? JSON.parse(stored.responseJson) as unknown : null;
      const command = JSON.parse(stored.requestJson) as CommandBody;
      if (command.type !== 'advance_time') throw new ApiProblem(500, 'COMMAND_RECOVERY_ERROR', 'Only a time-advance command can be pending after restart');
      return executeAdvance(stored.runId, stored, command);
    };
    recoverPendingCommands = async () => {
      for (const pending of options.store.pendingAdvanceCommands()) {
        await withRunLock(pending.runId, () => resumeRunningCommand(pending));
      }
    };

    playerApi.get('/runs/:runId/commands/:commandId', { schema: { tags: ['player'], params: CommandStatusParams, security: routeSecurity } }, async (request, reply) => {
      requireScope(request, 'player:read');
      const { runId, commandId } = request.params as Static<typeof CommandStatusParams>;
      checkBuild(runId);
      const command = options.store.getCommand(runId, commandId);
      if (!command) return sendProblem(reply, request.id, 404, 'COMMAND_NOT_FOUND', 'Command not found');
      const data = command.status === 'running' ? await withRunLock(runId, () => resumeRunningCommand(command)) : command.responseJson ? JSON.parse(command.responseJson) as unknown : { commandId, status: command.status };
      const resolved = options.store.getCommand(runId, commandId);
      if (resolved && resolved.responseStatus !== 200) return reply.code(resolved.responseStatus).send(data);
      recordRead(runId, request, data);
      return data;
    });

    playerApi.post('/runs/:runId/commands', { schema: { tags: ['player'], params: RunIdParams, body: PlayerCommandBody, security: routeSecurity } }, async (request, reply) => {
      requireScope(request, 'player:write');
      const runId = getPlayerId(request);
      const body = request.body as CommandBody;
      const commandId = body.commandId;
      const bodyHash = hashJson(body);
      return withRunLock(runId, async () => {
        checkBuild(runId);
        const existing = options.store.getCommand(runId, commandId);
        if (existing) {
          if (existing.bodyHash !== bodyHash) return sendProblem(reply, request.id, 409, 'COMMAND_ID_REUSE', 'Command ID was already used with a different payload');
          if (existing.status === 'running') {
            const result = resumeRunningCommand(existing);
            const resolved = options.store.getCommand(runId, commandId);
            return reply.code(resolved?.responseStatus ?? 200).send(result);
          }
          const result = existing.responseJson ? JSON.parse(existing.responseJson) as unknown : { requestId: existing.requestId, commandId, accepted: false, errorCode: 'COMMAND_RESULT_MISSING' };
          return reply.code(existing.responseStatus).send(result);
        }
        const run = checkBuild(runId);
        const session = decodePlayerSessionState(run.sessionJson);
        if (body.expectedRevision !== session.revision) {
          const response = { requestId: request.id, commandId, accepted: false, ...sessionStatus(session), errorCode: 'STALE_REVISION', issues: [{ field: 'expectedRevision', message: `Expected revision ${session.revision}` }] };
          options.store.commitNewMutation({ runId, commandId, bodyHash, requestJson: jsonForCommand(body), requestId: request.id, response, responseStatus: 409, commandStatus: 'rejected', request: body });
          return reply.code(409).send(response);
        }
        if (session.status !== 'active') {
          const response = { requestId: request.id, commandId, accepted: false, ...sessionStatus(session), errorCode: 'RUN_TERMINAL', issues: [{ field: 'status', message: 'Run is terminal' }] };
          options.store.commitNewMutation({ runId, commandId, bodyHash, requestJson: jsonForCommand(body), requestId: request.id, response, responseStatus: 409, commandStatus: 'rejected', request: body });
          return reply.code(409).send(response);
        }
        if (body.type === 'advance_time' && body.payload.months > maxAdvanceMonths) {
          const response = { requestId: request.id, commandId, accepted: false, ...sessionStatus(session), errorCode: 'ADVANCE_LIMIT', issues: [{ field: 'months', message: `Maximum advance is ${maxAdvanceMonths} months` }] };
          options.store.commitNewMutation({ runId, commandId, bodyHash, requestJson: jsonForCommand(body), requestId: request.id, response, responseStatus: 400, commandStatus: 'rejected', request: body });
          return reply.code(400).send(response);
        }
        if (body.type === 'advance_time') {
          options.store.startCommand({ runId, commandId, bodyHash, requestJson: jsonForCommand(body), requestId: request.id, totalMonths: body.payload.months });
          const started = options.store.getCommand(runId, commandId)!;
          const result = executeAdvance(runId, started, body);
          if ((result as { errorCode?: string }).errorCode === 'SERVER_ERROR') return reply.code(500).send(result);
          return result;
        }

        const controller = new SimulationController(session.config);
        let next: PlayerSessionState | undefined;
        let issues: Array<{ field: string; message: string }> = [];
        let details: Record<string, unknown> = {};
        switch (body.type) {
          case 'update_decisions': {
            const result = updatePlayerSessionDecisions(session, body.payload.controls);
            if (result.accepted === true) next = result.session; else issues = result.issues;
            break;
          }
          case 'queue_transaction': {
            const result = queuePlayerSessionTransaction(session, body.payload);
            if (result.accepted === true) next = result.session; else issues = result.issues;
            break;
          }
          case 'cancel_transaction': {
            const result = cancelPlayerSessionTransaction(session, body.payload.kind);
            if (result.accepted === true) next = result.session; else issues = result.issues;
            break;
          }
          case 'set_risk_appetite': {
            const result = updatePlayerSessionRiskAppetite(session, body.payload.targets);
            if (result.accepted === true) next = result.session; else issues = result.issues;
            break;
          }
          case 'set_safety_pause': {
            const result = updatePlayerSessionSafetyPause(session, body.payload.enabled);
            next = result.session;
            details = { settingMessage: result.message, stopAutomaticRun: result.stopAutomaticRun };
            break;
          }
        }
        const accepted = Boolean(next);
        const resultSession = next ?? session;
        const response = buildCommandResponse(request.id, commandId, accepted, resultSession, controller, {
          ...(issues.length > 0 ? { errorCode: 'INVALID_COMMAND', issues } : {}),
          ...details,
          ...(body.type === 'set_safety_pause' ? { safetyPause: resultSession.safetyPause, safetyPauseDisableArmed: resultSession.safetyPauseDisableArmed ?? false } : {}),
        });
        options.store.commitNewMutation({ runId, session: next, commandId, bodyHash, requestJson: jsonForCommand(body), requestId: request.id, response, responseStatus: accepted ? 200 : 422, commandStatus: accepted ? 'completed' : 'rejected', request: body });
        return reply.code(accepted ? 200 : 422).send(response);
      });
    });
  }, { prefix: '/api/v1' });

  app.addHook('onReady', () => recoverPendingCommands());
  return app;
};

const jsonForCommand = (command: CommandBody) => JSON.stringify(command);

export const startBankSimServer = async (options: BankSimServerOptions & { host?: string; port?: number }) => {
  const app = await createBankSimServer(options);
  await app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 3000 });
  return app;
};

export const serverBuildInfo = () => ({
  nodeVersion: process.version,
  lockfileHash: createHash('sha256').update(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../package-lock.json'))).digest('hex'),
  buildDigest: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
});
