import {describe,it,expect} from 'vitest';
import {nsfrDashboardData} from '../components/NsfrDashboard';
import {initialState} from '../config/initialState';
import {baseConfig} from '../config/baseConfig';
import {calculateRiskMetrics} from '../engine/metrics';
import {cloneBankState} from '../engine/clone';
import {LiabilityProductType as L} from '../domain/enums';
describe('NSFR dashboard',()=>{
 it('reconciles tables, stacks and maturity allocation to the reported ratio',()=>{
  const state=cloneBankState(initialState);
  const d=nsfrDashboardData(state,baseConfig),m=calculateRiskMetrics({state,config:baseConfig});
  expect(d.asf).toBeCloseTo(m.asf,4);expect(d.rsf).toBeCloseTo(m.rsf,4);expect(d.ratio).toBeCloseTo(m.nsfr,12);
  expect(d.asfParts.reduce((n,p)=>n+p.value,0)).toBeCloseTo(m.asf,4);
  expect(d.rsfParts.reduce((n,p)=>n+p.value,0)).toBeCloseTo(m.rsf,4);
  expect(Object.values(d.maturities).reduce((n,p)=>n+p.asf,0)).toBeCloseTo(m.asf,4);
  expect(Object.values(d.maturities).reduce((n,p)=>n+p.rsf,0)).toBeCloseTo(m.rsf,4);
 });
 it('uses actual remaining wholesale maturities and blended factors',()=>{
  const state=cloneBankState(initialState);
  const line=state.financial.balanceSheet.items.find(i=>i.productType===L.WholesaleFundingLT)!;
  line.balance=300e6;
  state.fundingLadders[L.WholesaleFundingLT]=[{notional:100e6,rate:.04,tenorMonths:12,monthsToMaturity:3},{notional:100e6,rate:.04,tenorMonths:12,monthsToMaturity:9},{notional:100e6,rate:.04,tenorMonths:60,monthsToMaturity:48}];
  const d=nsfrDashboardData(state,baseConfig);
  const row=d.asfRows.find(r=>r.label===line.label)!;
  expect(row.factor).toBe(.5);expect(row.weighted).toBe(150e6);
  expect(Object.values(d.maturities).reduce((n,p)=>n+p.asf,0)).toBeCloseTo(d.asf,4);
 });
});
