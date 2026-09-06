import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { cloneBankState } from '../engine/clone';
import { clockAfterStep, monthsToPeriodEnd, periodHistory, customerDeposits } from './management';

describe('Long-view management', () => {
 it('sums period flows, keeps closing stocks and labels partial periods', () => {
  const first=cloneBankState(initialState); first.time.step=7;
  const history=[first];
  for(let i=1;i<=14;i++){const s=cloneBankState(first);s.time.step=7+i;s.financial.incomeStatement.netIncome=i*1e6;s.risk.riskMetrics.cet1Ratio=i/100;history.push(s);}
  const q=periodHistory(history,3),y=periodHistory(history,12);
  expect(q[0].profit).toBe(6e6);expect(q[0].cet1).toBe(.03);expect(q[0].deposits).toBe(customerDeposits(history[3]));
  expect(q.at(-1)).toMatchObject({label:'Y2 Q1',months:2,profit:27e6});
  expect(y[0]).toMatchObject({label:'Year 1',months:12,profit:78e6});
  expect(y[1].months).toBe(2);expect(periodHistory([first],3)).toEqual([]);
 });
 it('stops on period boundaries, including when resuming midway through a quarter', () => {
  expect(monthsToPeriodEnd(0,3)).toBe(3);expect(monthsToPeriodEnd(2,3)).toBe(1);expect(monthsToPeriodEnd(3,3)).toBe(3);expect(monthsToPeriodEnd(14,12)).toBe(10);
  expect(clockAfterStep(1,initialState,baseConfig,false).remaining).toBeNull();
  expect(clockAfterStep(12,initialState,baseConfig,false).remaining).toBe(11);
  expect(clockAfterStep(Infinity,initialState,baseConfig,false).remaining).toBe(Infinity);
 });
 it('interrupts auto on actual risk even before the period ends, and always stops on failure', () => {
  const s=cloneBankState(initialState);s.risk.riskMetrics.lcr=1.09;
  expect(clockAfterStep(12,s,baseConfig,true).remaining).toBeNull();expect(clockAfterStep(12,s,baseConfig,true).reason).toContain('Liquidity');
  expect(clockAfterStep(12,s,baseConfig,false).remaining).toBe(11);
  s.status.hasFailed=true;expect(clockAfterStep(Infinity,s,baseConfig,false).remaining).toBeNull();
  s.status.hasFailed=false;s.risk.riskMetrics.lcr=2;s.risk.riskMetrics.internalCet1Headroom=-.001;
  expect(clockAfterStep(Infinity,s,baseConfig,true).reason).toContain('Capital');
 });
});
