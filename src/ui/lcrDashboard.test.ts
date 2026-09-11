import { describe,it,expect } from 'vitest';
import { lcrDashboardData } from '../components/LcrDashboard';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { calculateRiskMetrics } from '../engine/metrics';
import { cloneBankState } from '../engine/clone';
import { HQLALevel,AssetProductType,BalanceSheetSide } from '../domain/enums';
describe('LCR dashboard reconciliation',()=>{
 it('reconciles driver stacks and the reported ratio',()=>{
  const d=lcrDashboardData(initialState,baseConfig);
  const m=calculateRiskMetrics({state:initialState,config:baseConfig});
  expect(d.hqlaParts.reduce((s,p)=>s+p.value,0)).toBeCloseTo(m.hqla,5);
  expect(d.outParts.reduce((s,p)=>s+p.value,0)).toBeCloseTo(d.outgoing,5);
  expect(d.inParts.reduce((s,p)=>s+p.value,0)).toBeCloseTo(d.incoming,5);
  expect(d.ratio).toBeCloseTo(m.lcr,12);
  expect(d.surplus).toBeCloseTo(m.hqla-d.net*baseConfig.riskLimits.minLcr,5);
 });
 it('uses COR011 product classification rather than mutable balance-sheet liquidity tags',()=>{
  const state=cloneBankState(initialState),template=state.financial.balanceSheet.items.find(i=>i.productType===AssetProductType.CashReserves)!;
  state.financial.balanceSheet.items=[
   {...template,balance:100,encumbrance:{encumberedAmount:20},liquidityTag:{...template.liquidityTag,hqlaLevel:HQLALevel.Level1}},
   {...template,balance:300,liquidityTag:{...template.liquidityTag,hqlaLevel:HQLALevel.Level2A}},
   {...template,balance:300,liquidityTag:{...template.liquidityTag,hqlaLevel:HQLALevel.Level2B}},
  ];
  const d=lcrDashboardData(state,baseConfig);
  expect(d.hqla.level1).toBe(680);
  expect(d.hqla.level2a).toBe(0);
  expect(d.hqla.level2b).toBe(0);
  expect(d.hqla.capDeduction).toBe(0);
  expect(d.hqla.total).toBe(680);
  expect(d.hqlaParts.reduce((s,p)=>s+p.value,0)).toBe(d.hqla.total);
 });
 it('shows binding inflow caps and handles zero outflows',()=>{
  const state=cloneBankState(initialState);
  state.financial.balanceSheet.items=state.financial.balanceSheet.items.filter(i=>i.side===BalanceSheetSide.Asset);
  state.loanPipelines={};
  const d=lcrDashboardData(state,baseConfig);
  expect(d.outgoing).toBe(0);expect(d.recognised).toBe(0);expect(d.net).toBe(0);expect(d.ratio).toBe(Infinity);
 });
});