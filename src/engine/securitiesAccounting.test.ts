import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const runWithClassification = (classification: 'HTM' | 'FVOCI' | 'FVTPL') => {
  const state = cloneBankState(initialState);
  const gilts = state.financial.balanceSheet.items.find((line) => line.productType === AssetProductType.Gilts);
  if (!gilts || !gilts.security) throw new Error('Missing gilt security metadata');

  gilts.security.classification = classification;
  gilts.security.effectiveDurationYears = 6;
  state.market.riskFreeLong += 0.01;

  const engine = createSimulationEngine();
  return engine.step({ state, config: baseConfig, actions: [], shocks: [] }).nextState;
};

describe('Securities accounting classification', () => {
  it('routes identical market moves through different accounting channels', () => {
    const htm = runWithClassification('HTM');
    const fvoci = runWithClassification('FVOCI');
    const fvtpl = runWithClassification('FVTPL');

    expect(Math.abs(htm.financial.incomeStatement.fvtplValuationImpact)).toBeLessThan(1e-6);
    expect(Math.abs(htm.financial.incomeStatement.fvociOciMovement)).toBeLessThan(1e-6);

    expect(Math.abs(fvoci.financial.incomeStatement.fvociOciMovement)).toBeGreaterThan(1);
    expect(Math.abs(fvoci.financial.incomeStatement.fvtplValuationImpact)).toBeLessThan(1e-6);
    expect(Math.abs(fvoci.financial.capital.accumulatedOCI)).toBeGreaterThan(1);

    expect(Math.abs(fvtpl.financial.incomeStatement.fvtplValuationImpact)).toBeGreaterThan(1);
    expect(Math.abs(fvtpl.financial.incomeStatement.fvociOciMovement)).toBeLessThan(1e-6);

    expect(fvtpl.financial.incomeStatement.netIncome).not.toBeCloseTo(
      fvoci.financial.incomeStatement.netIncome,
      6
    );
    expect(fvtpl.risk.riskMetrics.cet1Ratio).not.toBeCloseTo(fvoci.risk.riskMetrics.cet1Ratio, 8);
  });
});
