import {describe,it,expect} from 'vitest';
import {leverageDashboardData} from '../components/LeverageDashboard';
import {initialState} from '../config/initialState';
import {baseConfig} from '../config/baseConfig';
import {calculateRiskMetrics} from '../engine/metrics';
import {cloneBankState} from '../engine/clone';
describe('leverage dashboard',()=>{
 it('reconciles exposure, ratio, capital headroom and implied capacity to the engine',()=>{
  const state=cloneBankState(initialState);
  const d=leverageDashboardData(state,baseConfig),m=calculateRiskMetrics({state,config:baseConfig});
  expect(d.exposure).toBeCloseTo(m.leverageExposure,4);
  expect(d.ratio).toBeCloseTo(m.leverageRatio,12);
  expect(d.exposureRows.reduce((n,r)=>n+r.value,0)).toBeCloseTo(d.exposure,4);
  expect(d.surplus).toBeCloseTo((m.leverageRatio-d.minimum)*m.leverageExposure,4);
  expect(d.limit*d.minimum).toBeCloseTo(d.tier1,4);
 });
 it('shows the chosen internal target while retaining the requirement floor',()=>{
  const state=cloneBankState(initialState);
  state.behaviour.riskAppetite={leverage:.06};
  expect(leverageDashboardData(state,baseConfig).target).toBe(.06);
  state.behaviour.riskAppetite.leverage=.01;
  expect(leverageDashboardData(state,baseConfig).target).toBe(baseConfig.riskLimits.minLeverageRatio);
 });
});
