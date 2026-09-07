import { expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { calculateRiskMetrics } from '../engine/metrics';
import { capitalDashboardData } from '../components/CapitalDashboard';

it('reconciles displayed CET1 requirements and nominal headroom to the engine across capital mixes',()=>{
  for(const at1 of [0, 100e6, 2e9]) {
    const state=structuredClone(initialState);
    state.financial.capital.at1=at1;
    const metrics=calculateRiskMetrics({state,config:baseConfig});
    state.risk.riskMetrics=metrics;
    const d=capitalDashboardData(state,baseConfig);
    expect(d.rows.reduce((s,r)=>s+r.ratio,0)).toBeCloseTo(metrics.cet1Requirement,12);
    expect(d.cards[0].requirement).toBeCloseTo(metrics.cet1Requirement,12);
    expect(d.cards[0].amount-d.cards[0].requiredAmount).toBeCloseTo(metrics.cet1Headroom*metrics.rwa,4);
    expect(d.cards[1].amount).toBe(d.cards[2].amount);
  }
});
