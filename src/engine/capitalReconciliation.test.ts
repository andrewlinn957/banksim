import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { cloneBankState } from './clone';
import { calculateRiskMetrics } from './metrics';
import { capitalReconciliation } from './capitalReconciliation';
import { createSimulationEngine } from './simulation';

describe('capital and common book reconciliation', () => {
  it('derives opening BVPS and quoted P/B from the accounting balance sheet', () => {
    const bridge = capitalReconciliation(initialState, baseConfig);
    expect(bridge.accountingEquity).toBeCloseTo(1.041e9, 3);
    expect(bridge.commonBookEquity).toBeCloseTo(1.017e9, 3);
    expect(initialState.equityMarket.bookValuePerShare).toBeCloseTo(1.017, 9);
    expect(initialState.equityMarket.priceToBook).toBeCloseTo(0.74 / 1.017, 9);
    expect(Math.abs(bridge.bookEquityDifference)).toBeLessThan(0.01);
    expect(bridge.bvpsDifference).toBeCloseTo(0, 9);
  });

  it('reproduces CET1 ratios with either sign of OCI and with partial prudential inclusion', () => {
    for (const oci of [17e6, -57.01e6]) {
      const state = cloneBankState(initialState);
      state.financial.capital.accumulatedOCI = oci;
      state.risk.riskMetrics = calculateRiskMetrics({ state, config: baseConfig });
      const bridge = capitalReconciliation(state, baseConfig);
      expect(bridge.includedOCI).toBeCloseTo(oci * 0.85, 6);
      expect(bridge.regulatoryCet1).toBeCloseTo(bridge.coreCet1 + oci * 0.85, 6);
      expect(bridge.cet1RatioDifference).toBeCloseTo(0, 12);
      expect(bridge.rwa).toBeCloseTo(bridge.creditRwa! + bridge.commitmentRwa! + bridge.operationalRiskRwa! + bridge.counterpartyRiskRwa! + bridge.otherRwa!, 4);
    }
  });

  it('retains close inputs after market advancement and reconciles monthly capital and book values', () => {
    let state = cloneBankState(initialState);
    const engine = createSimulationEngine();
    for (let month = 0; month < 3; month++) {
      state = engine.step({ state, config: baseConfig, actions: [], shocks: [] }).nextState;
      const bridge = capitalReconciliation(state, baseConfig);
      expect(bridge.captured).toBe(true);
      expect(bridge.cet1RatioDifference).toBeCloseTo(0, 12);
      expect(bridge.rwa).toBe(state.risk.riskMetrics.rwa);
      expect(Math.abs(bridge.bookEquityDifference)).toBeLessThan(0.01);
      expect(bridge.bvpsDifference).toBeCloseTo(0, 9);
      // The recorded close remains authoritative even if the current config changes.
      const config = structuredClone(baseConfig);
      config.behaviour.securitiesAccounting.fvociCet1InclusionRate = 0;
      expect(capitalReconciliation(state, config).regulatoryCet1).toBe(bridge.regulatoryCet1);
    }
  });

  it('marks legacy reconstruction and does not fabricate missing RWA component history', () => {
    const state = cloneBankState(initialState);
    delete state.risk.riskMetrics.capitalReconciliation;
    const bridge = capitalReconciliation(state, baseConfig);
    expect(bridge.captured).toBe(false);
    expect(bridge.creditRwa).toBeNull();
    expect(bridge.cet1RatioDifference).toBeCloseTo(0, 12);
    state.equityMarket.bookValuePerShare = 0.825;
    expect(capitalReconciliation(state, baseConfig).bvpsDifference).toBeCloseTo(0.825 - 1.017, 9);
  });
});
