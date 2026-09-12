import { describe, expect, it } from 'vitest';
import { scenarios } from '../config/scenarios';
import { calculateRiskMetrics, evaluateCompliance } from '../engine/metrics';
import { prepareScenarioSession } from './scenarioSession';

describe('scenario session preparation', () => {
  it('prepares a clean sandbox session with recalculated prudential state', () => {
    const prepared = prepareScenarioSession(null);
    const metrics = calculateRiskMetrics({ state: prepared.state, config: prepared.config });
    expect(prepared.state.risk.riskMetrics).toEqual(metrics);
    expect(prepared.state.risk.compliance).toEqual(evaluateCompliance(metrics, prepared.config.riskLimits));
    expect(prepared.actionForm.capitalMarketsInstrument).toBe('none');
    expect(prepared.actionForm.giltTradeDirection).toBe('none');
    expect(prepared.actionForm.hedgeDirection).toBe('none');
  });

  it('prepares a selected scenario independently of the previous session', () => {
    const scenarioId = scenarios[0]?.id;
    expect(scenarioId).toBeTruthy();
    const first = prepareScenarioSession(scenarioId!);
    first.actionForm.retailCurrentAccountRate = '99%';
    first.state.time.step += 10;
    const second = prepareScenarioSession(scenarioId!);
    expect(second.actionForm.retailCurrentAccountRate).not.toBe('99%');
    expect(second.state.time.step).not.toBe(first.state.time.step);
  });
});
