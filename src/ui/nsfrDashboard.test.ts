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
 it('uses actual remaining wholesale maturities and PRA C81 factors',()=>{
  const state=cloneBankState(initialState);
  const line=state.financial.balanceSheet.items.find(i=>i.productType===L.WholesaleFundingLT)!;
  line.balance=300e6;
  state.fundingLadders[L.WholesaleFundingLT]=[{notional:100e6,rate:.04,tenorMonths:12,monthsToMaturity:3},{notional:100e6,rate:.04,tenorMonths:12,monthsToMaturity:9},{notional:100e6,rate:.04,tenorMonths:60,monthsToMaturity:48}];
  const d=nsfrDashboardData(state,baseConfig);
  const wholesale=d.asfRows.filter(r=>r.label.includes('C81 2.6'));
  const under6=wholesale.find(r=>r.label.includes('<6m'))!;
  const sixTo12=wholesale.find(r=>r.label.includes('6–12m'))!;
  const oneYearPlus=wholesale.find(r=>r.label.includes('≥1y'))!;
  expect(under6.factor).toBe(0);expect(under6.weighted).toBe(0);
  expect(sixTo12.factor).toBe(.5);expect(sixTo12.weighted).toBe(50e6);
  expect(oneYearPlus.factor).toBe(1);expect(oneYearPlus.weighted).toBe(100e6);
  expect(wholesale.reduce((n,r)=>n+r.weighted,0)).toBe(150e6);
  expect(Object.values(d.maturities).reduce((n,p)=>n+p.asf,0)).toBeCloseTo(d.asf,4);
 });
});
