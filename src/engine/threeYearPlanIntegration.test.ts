import { describe,expect,it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { createDefaultThreeYearPlan, createDefaultThreeYearPlanTargets } from '../config/threeYearPlan';
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
    expect(working.threeYearPlan?.currentEvaluation).toBeUndefined(); expect(working.threeYearPlan?.boardConfidence).toBe(70);
    expect(working.threeYearPlan?.reviewHistory).toHaveLength(0);
  });

  it('executes renewal as a normal player action before the first month of the successor plan',()=>{
    const state=cloneBankState(initialState);
    state.threeYearPlan=createDefaultThreeYearPlan(state);
    state.time.step=36;
    state.threeYearPlan.completed=true;
    state.threeYearPlan.boardConfidence=81;
    state.threeYearPlan.currentEvaluation={
      month:36,
      score:76,
      metrics:state.threeYearPlan.targets.map(target=>({metricId:target.metricId,actual:target.milestones[2].lower,targetLower:target.milestones[2].lower,targetUpper:target.milestones[2].upper,score:76,weight:target.weight})),
    };
    state.threeYearPlan.lastEvaluationStep=36;
    state.threeYearPlan.reviewHistory=[{
      month:36,
      evaluation:state.threeYearPlan.currentEvaluation,
      boardConfidenceBefore:82,
      boardConfidenceAfter:81,
    }];
    const targets=createDefaultThreeYearPlanTargets(state);
    const config={...baseConfig,featureFlags:{...baseConfig.featureFlags,threeYearPlan:true}};
    const result=createSimulationEngine().step({
      state,
      config,
      actions:[{type:'renewThreeYearPlan',targets}],
      shocks:[],
    });

    expect(result.nextState.time.step).toBe(37);
    expect(result.nextState.threeYearPlan?.cycleNumber).toBe(2);
    expect(result.nextState.threeYearPlan?.startStep).toBe(36);
    expect(result.nextState.threeYearPlan?.boardConfidence).toBe(81);
    expect(result.nextState.threeYearPlan?.priorCycles).toHaveLength(1);
    expect(result.nextState.threeYearPlan?.priorCycles?.[0].finalBoardConfidence).toBe(81);
    expect(result.nextState.threeYearPlan?.currentEvaluation).toBeUndefined();
    expect(result.nextState.threeYearPlan?.reviewHistory).toHaveLength(0);
    expect(result.events.some(event=>event.message.includes('Cycle 2 agreed'))).toBe(true);
    expect(state.threeYearPlan?.cycleNumber).toBe(1);
    expect(state.threeYearPlan?.priorCycles).toHaveLength(0);
  });
});
