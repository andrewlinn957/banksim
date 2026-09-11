import { describe,expect,it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { createDefaultThreeYearPlan } from '../config/threeYearPlan';
import { initialState } from '../config/initialState';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

describe('Three-Year Plan engine integration',()=>{
  it('reviews quarterly only when explicitly enabled and records the confidence movement',()=>{
    const state=cloneBankState(initialState); state.threeYearPlan=createDefaultThreeYearPlan(state);
    const config={...baseConfig,featureFlags:{...baseConfig.featureFlags,threeYearPlan:true}};
    const engine=createSimulationEngine(); let working=state;
    for(let i=0;i<2;i++) working=engine.step({state:working,config,actions:[],shocks:[]}).nextState;
    expect(working.threeYearPlan?.currentEvaluation).toBeUndefined();
    expect(working.threeYearPlan?.reviewHistory).toHaveLength(0);
    working=engine.step({state:working,config,actions:[],shocks:[]}).nextState;
    expect(working.threeYearPlan?.currentEvaluation?.month).toBe(3);
    expect(working.threeYearPlan?.lastEvaluationStep).toBe(3);
    expect(Number.isFinite(working.threeYearPlan?.boardConfidence)).toBe(true);
    expect(working.threeYearPlan?.reviewHistory).toHaveLength(1);
    const review=working.threeYearPlan?.reviewHistory?.[0];
    expect(review?.month).toBe(3);
    expect(review?.evaluation.month).toBe(3);
    expect(review?.boardConfidenceBefore).toBe(70);
    expect(review?.boardConfidenceAfter).toBe(working.threeYearPlan?.boardConfidence);
    expect(state.threeYearPlan?.reviewHistory).toHaveLength(0);
  });

  it('is inert with the feature flag off even if plan state is present',()=>{
    const state=cloneBankState(initialState); state.threeYearPlan=createDefaultThreeYearPlan(state);
    let working=state; const engine=createSimulationEngine();
    for(let i=0;i<3;i++) working=engine.step({state:working,config:baseConfig,actions:[],shocks:[]}).nextState;
    expect(working.threeYearPlan?.currentEvaluation).toBeUndefined();
    expect(working.threeYearPlan?.boardConfidence).toBe(70);
    expect(working.threeYearPlan?.reviewHistory).toHaveLength(0);
  });

  it('freezes the completed mandate after month 36',()=>{
    const state=cloneBankState(initialState); state.threeYearPlan=createDefaultThreeYearPlan(state);
    const config={...baseConfig,featureFlags:{...baseConfig.featureFlags,threeYearPlan:true}};
    const engine=createSimulationEngine(); let working=state;
    for(let i=0;i<36;i++) working=engine.step({state:working,config,actions:[],shocks:[]}).nextState;
    const finalEvaluation=working.threeYearPlan?.currentEvaluation;
    const finalConfidence=working.threeYearPlan?.boardConfidence;
    expect(working.threeYearPlan?.completed).toBe(true);
    expect(finalEvaluation?.month).toBe(36);
    working=engine.step({state:working,config,actions:[],shocks:[]}).nextState;
    expect(working.threeYearPlan?.completed).toBe(true);
    expect(working.threeYearPlan?.currentEvaluation).toEqual(finalEvaluation);
    expect(working.threeYearPlan?.boardConfidence).toBe(finalConfidence);
  });
});
