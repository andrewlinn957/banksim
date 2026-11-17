import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetProductType } from '../src/domain/enums';
import { scenarios } from '../src/config/scenarios';
import { loadPrivateScenarioRegistry } from './privateScenarios';
import { prepareScenarioSession } from '../src/application/scenarioSession';
import { createPlayerSessionState, closePlayerSessionMonth } from '../src/application/playerSession';
import { encodePlayerSessionState, decodePlayerSessionState } from '../src/application/sessionCodec';
import { SimulationController } from '../src/application/simulationController';

const directories: string[] = [];
const writeScenarioFile = (value: unknown) => {
  const directory = mkdtempSync(join(tmpdir(), 'banksim-private-scenarios-'));
  directories.push(directory);
  const path = join(directory, 'scenarios.json');
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  return path;
};

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('server-only private scenario loader', () => {
  it('keeps the default registry public and loads validated definitions from a mounted JSON file', () => {
    const empty = loadPrivateScenarioRegistry();
    expect(empty.privateScenarioIds).toEqual([]);
    expect(empty.definitions.map((scenario) => scenario.id)).toEqual(scenarios.map((scenario) => scenario.id));

    const privateScenario = {
      id: 'private-credit-review',
      name: 'Private credit review',
      description: 'Manage a severe but bounded credit shock.',
      briefing: { openingPressure: 'Credit quality is under review.', firstDecision: 'Check credit and capital headroom.' },
      goals: { horizonMonths: 12, objectives: [{ label: 'Protect CET1', metric: 'cet1Ratio', direction: 'min', target: 0.1, weight: 100 }] },
      configOverrides: { riskLimits: { praBufferRatio: 0.015 } },
      initialStateOverride: { financial: { balanceSheet: { items: [{ productType: AssetProductType.CorporateLoans, balance: 4_000_000_000 }] } } },
      scheduledShocks: [{ stepNumber: 3, shock: { type: 'macroDownturn', pdMultiplier: 1.7, lgdMultiplier: 1.3 } }],
      arcStages: [{ id: 'follow-up', stepNumber: 5, trigger: { allMetrics: [{ metric: 'cet1Ratio', operator: '<', value: 0.12 }] }, shocks: [{ type: 'marketSpreadShock', wholesaleSpreadBps: 50, loanSpreadBps: 30, repoHaircutIncreasePct: 0.01 }] }],
    };
    const loaded = loadPrivateScenarioRegistry(writeScenarioFile([privateScenario]));
    expect(loaded.privateScenarioIds).toEqual(['private-credit-review']);
    expect(loaded.definitions.at(-1)).toEqual(privateScenario);
    expect(loaded.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects public ID collisions, unknown shock types and unsupported config fields', () => {
    const validBase = { id: 'private-case', name: 'Private case', description: 'Private case.', scheduledShocks: [] };
    expect(() => loadPrivateScenarioRegistry(writeScenarioFile([{ ...validBase, id: scenarios[0]!.id }]))).toThrow(/duplicate scenario ID/);
    expect(() => loadPrivateScenarioRegistry(writeScenarioFile([{ ...validBase, scheduledShocks: [{ stepNumber: 1, shock: { type: 'surprise', amount: 2 } }] }]))).toThrow(/unsupported shock type/);
    expect(() => loadPrivateScenarioRegistry(writeScenarioFile([{ ...validBase, configOverrides: { hiddenSwitch: true } }]))).toThrow(/not a supported configuration field/);
    expect(() => loadPrivateScenarioRegistry(writeScenarioFile([{ ...validBase, configOverrides: { riskLimits: { praBufferRatio: 'high' } } }]))).toThrow(/must be a number/);
    expect(() => loadPrivateScenarioRegistry(writeScenarioFile([{ ...validBase, configOverrides: { riskLimits: null } }]))).toThrow(/must not be null/);
    expect(() => loadPrivateScenarioRegistry(writeScenarioFile([{ ...validBase, configOverrides: { riskLimits: { pillar2A: { undocumentedSwitch: true } } } }]))).toThrow(/not a supported configuration field/);
    expect(() => loadPrivateScenarioRegistry(writeScenarioFile([{ ...validBase, goals: { horizonMonths: 12, objectives: [] } }]))).toThrow(/non-empty objectives/);
    expect(() => loadPrivateScenarioRegistry(writeScenarioFile([{
      ...validBase,
      initialStateOverride: {
        financial: {
          balanceSheet: {
            items: [{ productType: AssetProductType.CorporateLoans, balance: 1, maturityBucket: 'next-year' }],
          },
        },
      },
    }]))).toThrow(/supported maturity bucket/);
  });

  it('retains a private definition across session encoding and resumes its scheduled shock deterministically', () => {
    const privateScenario = {
      id: 'private-seeded-run',
      name: 'Private seeded run',
      description: 'A private fixture for session resume.',
      scheduledShocks: [{ stepNumber: 0, shock: { type: 'macroDownturn', pdMultiplier: 1.15, lgdMultiplier: 1.05 } }],
    };
    const registry = loadPrivateScenarioRegistry(writeScenarioFile([privateScenario]));
    const prepared = prepareScenarioSession(privateScenario.id, { seed: 118899, startDate: '2025-12-31T00:00:00.000Z' }, registry.definitions);
    const controller = new SimulationController(prepared.config);
    const opening = createPlayerSessionState({ runId: 'private-seeded-run', scenarioId: privateScenario.id, prepared, controller, horizonMonths: 3 });
    const restored = decodePlayerSessionState(encodePlayerSessionState(opening));
    expect(restored.scenarioDefinition).toEqual(privateScenario);

    const uninterrupted = closePlayerSessionMonth(opening, controller);
    const resumed = closePlayerSessionMonth(restored, new SimulationController(restored.config));
    expect(uninterrupted.accepted).toBe(true);
    expect(resumed.accepted).toBe(true);
    if (!uninterrupted.accepted || !resumed.accepted) return;
    expect(uninterrupted.shocks).toEqual([{ type: 'macroDownturn', pdMultiplier: 1.15, lgdMultiplier: 1.05 }]);
    expect(resumed.session.bankState).toEqual(uninterrupted.session.bankState);
    expect(resumed.session.timeline).toEqual(uninterrupted.session.timeline);
  });
});
