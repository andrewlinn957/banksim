import { describe, it, expect } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { createSimulationEngine } from './simulation';
import { cloneBankState } from './clone';
import { calculateRiskMetrics } from './metrics';
import { clockAfterStep } from '../game/management';
import { SimulationController } from '../ui/simulationController';
describe('Player risk appetite',()=>{
 it('persists targets through closes and replay, restrains dividends and leaves historic state unchanged',()=>{
  const controller=new SimulationController(baseConfig);
  const targets={cet1:.25,leverage:.05,lcr:1.4,nsfr:1.2};
  const result=controller.runMonths({state:initialState,months:2,actions:[{type:'setRiskAppetite',targets},{type:'setCapitalPolicy',dividendPayoutRatio:1}],shocks:[]});
  expect(result.finalState.behaviour.riskAppetite).toEqual(targets);
  expect(result.finalState.risk.riskMetrics.internalCet1TargetRatio).toBe(.25);
  expect(result.finalState.financial.incomeStatement.dividendsPaid).toBe(0);
  const replay=controller.replay(initialState,JSON.parse(JSON.stringify(result.timeline)));
  expect(replay.finalState.behaviour.riskAppetite).toEqual(targets);
  expect(replay.finalState.risk.riskMetrics.internalCet1TargetRatio).toBe(.25);
  expect(initialState.behaviour.riskAppetite).toBeUndefined();
  const cloned=cloneBankState(result.finalState);cloned.behaviour.riskAppetite!.cet1=.3;
  expect(result.finalState.behaviour.riskAppetite!.cet1).toBe(.25);
 });
 it('does not let targets relax prudential floors and restores automatic targets',()=>{
  const engine=createSimulationEngine();
  const next=engine.step({state:initialState,config:baseConfig,actions:[{type:'setRiskAppetite',targets:{cet1:.001,leverage:.001,lcr:.1,nsfr:.1}}],shocks:[]}).nextState;
  expect(next.risk.riskMetrics.internalCet1TargetRatio).toBeGreaterThanOrEqual(next.risk.riskMetrics.praBufferTarget!);
  expect(next.risk.riskMetrics.internalLcrTargetRatio).toBe(baseConfig.riskLimits.minLcr);
  expect(next.risk.riskMetrics.internalNsfrTargetRatio).toBe(baseConfig.riskLimits.minNsfr);
  const reset=engine.step({state:next,config:baseConfig,actions:[{type:'setRiskAppetite',targets:null}],shocks:[]}).nextState;
  expect(reset.behaviour.riskAppetite).toBeUndefined();
  expect(reset.risk.riskMetrics.internalCet1TargetRatio).toBeGreaterThan(reset.risk.riskMetrics.praBufferTarget!);
 });
 it('uses chosen liquidity targets for automatic pauses without changing regulatory metrics',()=>{
  const s=cloneBankState(initialState);
  const baseline=calculateRiskMetrics({state:s,config:baseConfig});
  s.behaviour.riskAppetite={cet1:.01,leverage:.001,lcr:Math.min(10,baseline.lcr+1),nsfr:Math.min(10,baseline.nsfr+1)};
  s.risk.riskMetrics=calculateRiskMetrics({state:s,config:baseConfig});
  expect(s.risk.riskMetrics.lcr).toBe(baseline.lcr);
  expect(s.risk.riskMetrics.cet1Requirement).toBe(baseline.cet1Requirement);
  expect(clockAfterStep(12,s,baseConfig,true).remaining).toBeNull();
  expect(clockAfterStep(12,s,baseConfig,false).remaining).toBe(11);
 });
 it('rejects non-finite targets',()=>{
  const result=createSimulationEngine().step({state:initialState,config:baseConfig,actions:[{type:'setRiskAppetite',targets:{cet1:NaN,leverage:.05,lcr:1.2,nsfr:1.1}}],shocks:[]});
  expect(result.nextState.behaviour.riskAppetite).toBeUndefined();
  expect(result.events.some(e=>e.message.includes('positive finite ratios'))).toBe(true);
 });
});
