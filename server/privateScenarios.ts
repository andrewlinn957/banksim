import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import type { BankState } from '../src/domain/bankState';
import type { PlayerAction } from '../src/domain/actions';
import { AssetProductType, Currency, LiabilityProductType, MaturityBucket } from '../src/domain/enums';
import { baseConfig } from '../src/config/baseConfig';
import { createSeededInitialState } from '../src/config/initialState';
import { scenarios as publicScenarios, type Scenario } from '../src/config/scenarios';

export interface LoadedScenarioRegistry {
  definitions: readonly Scenario[];
  privateScenarioIds: readonly string[];
  contentHash: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const fail = (path: string, message: string): never => {
  throw new Error(`Private scenario config ${path}: ${message}`);
};

const assertJsonValue = (value: unknown, path: string, depth = 0): void => {
  if (depth > 128) fail(path, 'maximum nesting depth exceeded');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'numbers must be finite');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(path, 'must contain JSON values only');
  Object.entries(value).forEach(([key, entry]) => assertJsonValue(entry, `${path}.${key}`, depth + 1));
};

const assertKeys = (value: Record<string, unknown>, allowed: readonly string[], path: string): void => {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) fail(path, `unsupported field '${unexpected}'`);
};

const assertCompatibleOverride = (base: unknown, override: unknown, path: string): void => {
  assertJsonValue(override, path);
  if (override === null) {
    if (base !== null) fail(path, 'must not be null');
    return;
  }
  if (Array.isArray(override)) {
    if (!Array.isArray(base)) fail(path, 'must match an array in the BankSim configuration');
    const example = base[0];
    if (example === undefined && override.length > 0) fail(path, 'has no runtime validation shape for array entries');
    if (example !== undefined) override.forEach((entry, index) => assertCompatibleOverride(example, entry, `${path}[${index}]`));
    return;
  }
  if (isRecord(override)) {
    if (!isRecord(base)) fail(path, 'has no runtime object schema in the BankSim configuration');
    const baseRecord = base as Record<string, unknown>;
    for (const [key, nested] of Object.entries(override)) {
      if (!Object.hasOwn(baseRecord, key)) fail(`${path}.${key}`, 'is not a supported configuration field');
      assertCompatibleOverride(baseRecord[key], nested, `${path}.${key}`);
    }
    return;
  }
  if (base === undefined) fail(path, 'has no runtime value schema in the BankSim configuration');
  if (base === null) fail(path, 'must remain null');
  if (typeof override !== typeof base) {
    fail(path, `must be a ${typeof base}`);
  }
};

const mergeValidationShape = (base: unknown, example: unknown): unknown => {
  if (isRecord(base) && isRecord(example)) {
    const result: Record<string, unknown> = structuredClone(base);
    for (const [key, value] of Object.entries(example)) {
      result[key] = Object.hasOwn(result, key) ? mergeValidationShape(result[key], value) : structuredClone(value);
    }
    return result;
  }
  if (Array.isArray(base) && Array.isArray(example)) {
    const entries = [...base, ...example];
    return entries.length > 0 ? [entries.reduce((shape, entry) => mergeValidationShape(shape, entry))] : [];
  }
  return base === undefined || base === null ? structuredClone(example) : base;
};

// Optional config branches are absent from baseConfig. Include the existing
// scenario override shapes as part of the runtime schema so private scenarios
// can use the same optional fields without accepting arbitrary JSON keys.
const scenarioConfigShape = publicScenarios.reduce(
  (shape, scenario) => scenario.configOverrides === undefined
    ? shape
    : mergeValidationShape(shape, scenario.configOverrides),
  structuredClone(baseConfig) as unknown,
);

const shockFields: Record<string, { required: string[]; optional?: string[] }> = {
  depositCompetition: { required: ['retailRateIncrease'], optional: ['corporateRateIncrease'] },
  marketSpreadShock: { required: ['wholesaleSpreadBps', 'loanSpreadBps', 'repoHaircutIncreasePct'] },
  idiosyncraticRun: { required: ['outflowRateMultiplier'] },
  macroDownturn: { required: ['pdMultiplier', 'lgdMultiplier'] },
  counterpartyDefault: { required: ['productType', 'lossAmount'] },
  rolloverStress: { required: ['accessMultiplier', 'spreadBps'] },
};

const assertShock = (value: unknown, path: string): void => {
  if (!isRecord(value) || typeof value.type !== 'string' || !Object.hasOwn(shockFields, value.type)) {
    fail(path, 'has an unsupported shock type');
  }
  const shock = value as Record<string, unknown>;
  const fields = shockFields[shock.type as string]!;
  assertKeys(shock, ['type', ...fields.required, ...(fields.optional ?? [])], path);
  for (const key of fields.required) {
    if (!Object.hasOwn(shock, key)) fail(`${path}.${key}`, 'is required');
  }
  for (const key of [...fields.required, ...(fields.optional ?? [])]) {
    if (key === 'productType') {
      const products = [...Object.values(AssetProductType)];
      if (typeof shock[key] !== 'string' || !products.includes(shock[key] as never)) fail(`${path}.${key}`, 'must be an asset product type');
    } else if (shock[key] !== undefined && (typeof shock[key] !== 'number' || !Number.isFinite(shock[key]))) {
      fail(`${path}.${key}`, 'must be a finite number');
    }
  }
};

const metrics = ['cet1Ratio', 'leverageRatio', 'lcr', 'nsfr'] as const;
const metricOperators = ['<', '<=', '>', '>='] as const;
const actionTypes: readonly PlayerAction['type'][] = [
  'setRiskAppetite', 'adjustRate', 'buySellAsset', 'launchCapitalMarketsTransaction', 'drawBoeFunding',
  'setUnderwriting', 'setMortgagePolicy', 'setTermDepositPolicy', 'enterHedge', 'setCapitalPolicy',
  'modifyLoanCohort', 'purchasePociLoan', 'revisePociLoan', 'originateBorrowerLoan',
  'setBorrowerPayment', 'derecognizeLoanCohort',
];

const assertMetricTriggers = (value: unknown, path: string): void => {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  (value as unknown[]).forEach((condition, index) => {
    const at = `${path}[${index}]`;
    if (!isRecord(condition)) fail(at, 'must be an object');
    const metricCondition = condition as Record<string, unknown>;
    assertKeys(metricCondition, ['metric', 'operator', 'value'], at);
    if (!(metrics as readonly unknown[]).includes(metricCondition.metric)) fail(`${at}.metric`, 'is unsupported');
    if (!(metricOperators as readonly unknown[]).includes(metricCondition.operator)) fail(`${at}.operator`, 'is unsupported');
    if (typeof metricCondition.value !== 'number' || !Number.isFinite(metricCondition.value)) fail(`${at}.value`, 'must be finite');
  });
};

const assertArcTrigger = (value: unknown, path: string): void => {
  if (!isRecord(value)) fail(path, 'must be an object');
  const trigger = value as Record<string, unknown>;
  assertKeys(trigger, ['allMetrics', 'anyMetrics', 'actionRequirements'], path);
  if (trigger.allMetrics !== undefined) assertMetricTriggers(trigger.allMetrics, `${path}.allMetrics`);
  if (trigger.anyMetrics !== undefined) assertMetricTriggers(trigger.anyMetrics, `${path}.anyMetrics`);
  if (trigger.actionRequirements !== undefined) {
    if (!Array.isArray(trigger.actionRequirements)) fail(`${path}.actionRequirements`, 'must be an array');
    (trigger.actionRequirements as unknown[]).forEach((requirement, index) => {
      const at = `${path}.actionRequirements[${index}]`;
      if (!isRecord(requirement)) fail(at, 'must be an object');
      const actionRequirement = requirement as Record<string, unknown>;
      assertKeys(actionRequirement, ['actionType', 'minCount'], at);
      if (!(actionTypes as readonly unknown[]).includes(actionRequirement.actionType)) fail(`${at}.actionType`, 'is unsupported');
      if (actionRequirement.minCount !== undefined && (!Number.isSafeInteger(actionRequirement.minCount) || Number(actionRequirement.minCount) < 1)) {
        fail(`${at}.minCount`, 'must be a positive integer');
      }
    });
  }
};

const assertScenario = (value: unknown, index: number, opening: BankState): Scenario => {
  const path = `scenarios[${index}]`;
  if (!isRecord(value)) fail(path, 'must be an object');
  const scenario = value as Record<string, unknown>;
  assertKeys(scenario, ['id', 'name', 'description', 'briefing', 'goals', 'initialStateOverride', 'scheduledShocks', 'arcStages', 'configOverrides'], path);
  if (typeof scenario.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(scenario.id)) fail(`${path}.id`, 'must be a stable lowercase identifier');
  if (typeof scenario.name !== 'string' || scenario.name.trim().length === 0 || scenario.name.length > 200) fail(`${path}.name`, 'must be a non-empty string of at most 200 characters');
  if (typeof scenario.description !== 'string' || scenario.description.trim().length === 0 || scenario.description.length > 5000) fail(`${path}.description`, 'must be a non-empty string of at most 5000 characters');

  if (scenario.briefing !== undefined) {
    if (!isRecord(scenario.briefing)) fail(`${path}.briefing`, 'must be an object');
    const briefing = scenario.briefing as Record<string, unknown>;
    assertKeys(briefing, ['openingPressure', 'firstDecision'], `${path}.briefing`);
    if (typeof briefing.openingPressure !== 'string' || typeof briefing.firstDecision !== 'string') fail(`${path}.briefing`, 'must define openingPressure and firstDecision strings');
  }
  if (scenario.goals !== undefined) {
    if (!isRecord(scenario.goals)) fail(`${path}.goals`, 'must be an object');
    const goals = scenario.goals as Record<string, unknown>;
    if (!Number.isSafeInteger(goals.horizonMonths) || Number(goals.horizonMonths) < 1 || Number(goals.horizonMonths) > 120 ||
        !Array.isArray(goals.objectives) || goals.objectives.length === 0) {
      fail(`${path}.goals`, 'must define a horizonMonths from 1 to 120 and a non-empty objectives array');
    }
    assertKeys(goals, ['horizonMonths', 'objectives'], `${path}.goals`);
    const goalMetrics = ['cet1Ratio', 'leverageRatio', 'lcr', 'nsfr', 'roe', 'nim', 'netIncome', 'equity', 'assets'];
    (goals.objectives as unknown[]).forEach((objective, objectiveIndex) => {
      const at = `${path}.goals.objectives[${objectiveIndex}]`;
      if (!isRecord(objective)) fail(at, 'must be an object');
      const row = objective as Record<string, unknown>;
      assertKeys(row, ['label', 'metric', 'direction', 'target', 'weight'], at);
      if (typeof row.label !== 'string' || row.label.trim().length === 0 || !goalMetrics.includes(String(row.metric)) ||
          !['min', 'max'].includes(String(row.direction)) || typeof row.target !== 'number' || !Number.isFinite(row.target) ||
          typeof row.weight !== 'number' || !Number.isFinite(row.weight) || row.weight < 0) fail(at, 'has invalid objective fields');
    });
    if ((goals.objectives as Array<Record<string, unknown>>).reduce((total, objective) => total + Number(objective.weight), 0) <= 0) {
      fail(`${path}.goals.objectives`, 'must have a positive total weight');
    }
  }

  if (scenario.configOverrides !== undefined) {
    if (!isRecord(scenario.configOverrides)) fail(`${path}.configOverrides`, 'must be an object');
    assertCompatibleOverride(scenarioConfigShape, scenario.configOverrides, `${path}.configOverrides`);
  }
  if (scenario.initialStateOverride !== undefined) {
    if (!isRecord(scenario.initialStateOverride)) fail(`${path}.initialStateOverride`, 'must be an object');
    const initial = scenario.initialStateOverride as Record<string, unknown>;
    assertKeys(initial, ['financial', 'market', 'behaviour', 'status'], `${path}.initialStateOverride`);
    for (const key of ['market', 'behaviour', 'status'] as const) {
      if (initial[key] !== undefined) assertCompatibleOverride(opening[key], initial[key], `${path}.initialStateOverride.${key}`);
    }
    if (initial.financial !== undefined) {
      const financial = initial.financial;
      if (!isRecord(financial)) fail(`${path}.initialStateOverride.financial`, 'must be an object');
      const financialRecord = financial as Record<string, unknown>;
      assertKeys(financialRecord, ['balanceSheet', 'capital', 'incomeStatement', 'cashFlowStatement'], `${path}.initialStateOverride.financial`);
      for (const key of ['capital', 'incomeStatement', 'cashFlowStatement'] as const) {
        if (financialRecord[key] !== undefined) assertCompatibleOverride(opening.financial[key], financialRecord[key], `${path}.initialStateOverride.financial.${key}`);
      }
      if (financialRecord.balanceSheet !== undefined) {
        if (!isRecord(financialRecord.balanceSheet)) fail(`${path}.initialStateOverride.financial.balanceSheet`, 'must be an object');
        const balanceSheet = financialRecord.balanceSheet as Record<string, unknown>;
        assertKeys(balanceSheet, ['items'], `${path}.initialStateOverride.financial.balanceSheet`);
        if (balanceSheet.items !== undefined) {
          if (!Array.isArray(balanceSheet.items)) fail(`${path}.initialStateOverride.financial.balanceSheet.items`, 'must be an array');
          const productTypes = new Set([...Object.values(AssetProductType), ...Object.values(LiabilityProductType)]);
          (balanceSheet.items as unknown[]).forEach((item, itemIndex) => {
            const at = `${path}.initialStateOverride.financial.balanceSheet.items[${itemIndex}]`;
            if (!isRecord(item) || typeof item.productType !== 'string' || !productTypes.has(item.productType as never)) fail(at, 'must identify a supported productType');
            const position = item as Record<string, unknown>;
            assertKeys(position, ['productType', 'balance', 'interestRate', 'maturityBucket', 'currency', 'encumbrance'], at);
            for (const key of ['balance', 'interestRate'] as const) {
              if (position[key] !== undefined && (typeof position[key] !== 'number' || !Number.isFinite(position[key]))) fail(`${at}.${key}`, 'must be finite');
            }
            if (position.balance !== undefined && Number(position.balance) < 0) fail(`${at}.balance`, 'must be non-negative');
            if (position.maturityBucket !== undefined && !Object.values(MaturityBucket).includes(position.maturityBucket as MaturityBucket)) fail(`${at}.maturityBucket`, 'must be a supported maturity bucket');
            if (position.currency !== undefined && !Object.values(Currency).includes(position.currency as Currency)) fail(`${at}.currency`, 'must be a supported currency');
            if (position.encumbrance !== undefined) {
              if (!isRecord(position.encumbrance)) fail(`${at}.encumbrance`, 'must be an object');
              const encumbrance = position.encumbrance as Record<string, unknown>;
              assertKeys(encumbrance, ['encumberedAmount', 'remainingMonths'], `${at}.encumbrance`);
              if (typeof encumbrance.encumberedAmount !== 'number' || !Number.isFinite(encumbrance.encumberedAmount) || encumbrance.encumberedAmount < 0) fail(`${at}.encumbrance.encumberedAmount`, 'must be a non-negative finite number');
              if (encumbrance.remainingMonths !== undefined && (!Number.isSafeInteger(encumbrance.remainingMonths) || Number(encumbrance.remainingMonths) < 0)) fail(`${at}.encumbrance.remainingMonths`, 'must be a non-negative integer');
            }
            assertJsonValue(position, at);
          });
        }
      }
    }
  }

  if (!Array.isArray(scenario.scheduledShocks)) fail(`${path}.scheduledShocks`, 'must be an array');
  (scenario.scheduledShocks as unknown[]).forEach((entry, shockIndex) => {
    const at = `${path}.scheduledShocks[${shockIndex}]`;
    if (!isRecord(entry) || !Number.isSafeInteger(entry.stepNumber) || Number(entry.stepNumber) < 0 || Number(entry.stepNumber) > 120) fail(at, 'must include a valid simulation stepNumber');
    const scheduled = entry as Record<string, unknown>;
    assertKeys(scheduled, ['stepNumber', 'shock'], at);
    assertShock(scheduled.shock, `${at}.shock`);
  });

  if (scenario.arcStages !== undefined) {
    if (!Array.isArray(scenario.arcStages)) fail(`${path}.arcStages`, 'must be an array');
    (scenario.arcStages as unknown[]).forEach((stage, stageIndex) => {
      const at = `${path}.arcStages[${stageIndex}]`;
      if (!isRecord(stage) || typeof stage.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(stage.id) ||
          !Number.isSafeInteger(stage.stepNumber) || Number(stage.stepNumber) < 0 || Number(stage.stepNumber) > 120 || !Array.isArray(stage.shocks)) fail(at, 'must define a valid id, stepNumber and shocks array');
      const arc = stage as Record<string, unknown>;
      assertKeys(arc, ['id', 'stepNumber', 'shocks', 'trigger', 'milestone', 'severity'], at);
      (arc.shocks as unknown[]).forEach((shock, shockIndex) => assertShock(shock, `${at}.shocks[${shockIndex}]`));
      if (arc.trigger !== undefined) assertArcTrigger(arc.trigger, `${at}.trigger`);
      if (arc.milestone !== undefined && typeof arc.milestone !== 'string') fail(`${at}.milestone`, 'must be a string');
      if (arc.severity !== undefined && !['info', 'warning', 'error'].includes(String(arc.severity))) fail(`${at}.severity`, 'is unsupported');
    });
  }

  assertJsonValue(scenario, path);
  return structuredClone(scenario) as unknown as Scenario;
};

/** Load mounted JSON definitions without importing them into the browser application graph. */
export const loadPrivateScenarioRegistry = (filePath?: string): LoadedScenarioRegistry => {
  let privateDefinitions: Scenario[] = [];
  if (filePath) {
    let size: number;
    try { size = statSync(filePath).size; }
    catch (error) { fail(filePath, error instanceof Error ? error.message : 'could not be read'); }
    if (size! > 5_000_000) fail(filePath, 'file exceeds the 5 MB limit');
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown; }
    catch (error) { fail(filePath, error instanceof Error ? error.message : 'is not valid JSON'); }
    if (!Array.isArray(raw)) fail(filePath, 'top-level value must be an array of scenarios');
    const opening = createSeededInitialState({ seed: 77123, config: baseConfig });
    privateDefinitions = (raw as unknown[]).map((scenario, index) => assertScenario(scenario, index, opening));
  }

  if (privateDefinitions.length > 200) fail(filePath ?? 'scenario registry', 'may contain at most 200 private scenarios');
  const publicIds = new Set(publicScenarios.map((scenario) => scenario.id));
  const seen = new Set<string>(publicIds);
  for (const scenario of privateDefinitions) {
    if (seen.has(scenario.id)) fail(filePath ?? 'scenario registry', `duplicate scenario ID '${scenario.id}'`);
    seen.add(scenario.id);
  }
  const definitions = [...publicScenarios.map((scenario) => structuredClone(scenario)), ...privateDefinitions];
  const contentHash = createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
  return { definitions, privateScenarioIds: privateDefinitions.map((scenario) => scenario.id), contentHash };
};
