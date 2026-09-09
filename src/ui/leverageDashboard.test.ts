import {describe,it,expect} from 'vitest';
import {leverageDashboardData} from '../components/LeverageDashboard';
import {initialState} from '../config/initialState';
import {baseConfig} from '../config/baseConfig';
import {calculateRiskMetrics} from '../engine/metrics';
import {cloneBankState} from '../engine/clone';

describe('leverage dashboard',()=>{
 it('reconciles exposure, ratio, expectation headroom and implied capacity to the engine',()=>{
  const state=cloneBankState(initialState);
  const d=leverageDashboardData(state,baseConfig),m=calculateRiskMetrics({state,config:baseConfig});
  expect(d.inScope).toBe(false);
  expect(d.exposure).toBeCloseTo(m.leverageExposure,4);
  expect(d.ratio).toBeCloseTo(m.leverageRatio,12);
  expect(d.exposureRows.reduce((n,r)=>n+r.value,0)).toBeCloseTo(d.exposure,4);
  expect(d.surplus).toBeCloseTo((m.leverageRatio-d.threshold)*m.leverageExposure,4);
  expect(d.limit*d.threshold).toBeCloseTo(d.tier1,4);
  expect(d.threshold).toBeCloseTo(.0325,12);
  expect(d.minimumCet1).toBeCloseTo(.024375,12);
  expect(d.minimumAt1Eligible).toBeCloseTo(.008125,12);
  expect(d.cclbIndicative).toBeCloseTo(.007,12);
  expect(d.indicativeThreshold).toBeCloseTo(.0395,12);
 });
 it('shows the chosen internal target while retaining the applicable framework threshold',()=>{
  const state=cloneBankState(initialState);
  state.behaviour.riskAppetite={leverage:.06,cet1:.12,lcr:1.1,nsfr:1.05};
  expect(leverageDashboardData(state,baseConfig).target).toBe(.06);
  state.behaviour.riskAppetite.leverage=.01;
  expect(leverageDashboardData(state,baseConfig).target).toBe(baseConfig.riskLimits.minLeverageRatio);
 });
 it('uses the full leverage stack once the bank is in scope',()=>{
  const state=cloneBankState(initialState);
  state.risk.leverageFramework={
    inScope:true,scopeRoute:'retailDeposits',assessmentStep:0,assessmentDate:new Date(state.time.date).toISOString(),nextAssessmentStep:12,
    averageRetailDeposits:80e9,averageNonUkAssets:0,
    accountingReferenceObservations:[-24,-12,0].map(step=>({step,date:new Date(state.time.date).toISOString(),retailDeposits:80e9,nonUkAssets:0})),
  };
  const d=leverageDashboardData(state,baseConfig);
  expect(d.inScope).toBe(true);
  expect(d.minimum).toBeCloseTo(.0325,12);
  expect(d.minimumCet1).toBeCloseTo(.024375,12);
  expect(d.minimumAt1Eligible).toBeCloseTo(.008125,12);
  expect(d.cclb).toBeCloseTo(.007,12);
  expect(d.threshold).toBeCloseTo(.0395,12);
  expect(d.cet1Threshold).toBeCloseTo(.031375,12);
 });
});
