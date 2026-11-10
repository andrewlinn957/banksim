import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareScenarioSession } from './scenarioSession';
import { createPlayerSessionState } from './playerSession';
import { SimulationController } from './simulationController';
import { PLAYER_CONTROL_REGISTRY } from './playerControls';
import { buildPlayerReport } from './playerReports';
import { PLAYER_REPORT_REGISTRY } from '../presentation/reportRegistry';

const inventory = JSON.parse(readFileSync(new URL('../../docs/evaluation/gui-parity.json', import.meta.url), 'utf8')) as {
  actions: Array<{ id: string; category: string; operation?: string[]; availability: string; defaultSource: string; validationBehaviour: string }>;
  reports: Array<{ id: string; operation: string; availability: string; status: string; queryFields?: string[] }>;
};

describe('documented GUI/API parity inventory', () => {
  it('accounts for every registered player control and report', () => {
    const documentedControls = inventory.actions.filter((action) => action.category !== 'time-control' && action.category !== 'opening-mode').map((action) => action.id);
    expect(documentedControls).toEqual(PLAYER_CONTROL_REGISTRY.map((control) => control.id));
    expect(inventory.actions.map((action) => action.id)).toContain('time.advance');
    expect(inventory.actions.map((action) => action.id)).toContain('mode.scenario');
    expect(inventory.actions.map((action) => action.id)).toContain('mode.three_year_plan');
    expect(inventory.reports.map((report) => report.id)).toEqual(PLAYER_REPORT_REGISTRY.map((report) => report.id));
    for (const action of inventory.actions) {
      expect(action.operation?.length, `${action.id} operation`).toBeGreaterThan(0);
      expect(action.availability, `${action.id} availability`).toBeTruthy();
      expect(action.defaultSource, `${action.id} default source`).toBeTruthy();
      expect(action.validationBehaviour, `${action.id} validation`).toBeTruthy();
    }
    for (const [index, report] of inventory.reports.entries()) {
      expect(report.operation, `${report.id} operation`).toContain('/api/v1/runs/{runId}');
      expect(report.availability, `${report.id} availability`).toBeTruthy();
      expect(report.status, `${report.id} status`).toBe('shared-builder-and-player-api');
      expect(report.queryFields ?? [], `${report.id} query schema`).toEqual(PLAYER_REPORT_REGISTRY[index].queryFields ?? []);
    }
  });

  it('has a shared report builder for every registered player information surface', () => {
    const prepared = prepareScenarioSession(null, { seed: 884422 });
    const controller = new SimulationController(prepared.config);
    const session = createPlayerSessionState({ runId: 'parity-inventory-test', scenarioId: null, prepared, controller });
    for (const report of PLAYER_REPORT_REGISTRY) {
      expect(buildPlayerReport(session, controller, report.id), report.id).toBeDefined();
    }
  });
});
