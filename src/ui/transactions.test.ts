import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { cloneBankState } from '../engine/clone';
import { SimulationController } from './simulationController';
import { PlayerAction } from '../domain/actions';
describe('One-off transactions during autopilot', () => {
  it('issues equity and hedges once while carrying rate and capital policy forward', () => {
    const ctl=new SimulationController(baseConfig);
    const actions:PlayerAction[]=[{type:'issueEquity',amount:10e6},{type:'enterHedge',direction:'payFixedReceiveFloat',notional:10e6,fixedRate:.03,maturityMonths:24},{type:'setCapitalPolicy',dividendPayoutRatio:0,at1CouponMode:'skip'}];
    const result=ctl.runMonths({state:initialState,months:3,actions});
    let manual=ctl.step(initialState,actions,[]).nextState;
    for(let n=1;n<3;n++)manual=ctl.step(manual,[actions[2]],[]).nextState;
    expect(result.timeline.flatMap(t=>t.actions).filter(a=>a.type==='issueEquity')).toHaveLength(1);
    expect(result.timeline.flatMap(t=>t.actions).filter(a=>a.type==='enterHedge')).toHaveLength(1);
    expect(result.finalState.equityMarket.sharesOutstanding).toBe(manual.equityMarket.sharesOutstanding);
    expect(result.finalState.financial.capital.cet1).toBeCloseTo(manual.financial.capital.cet1,5);
  });
  it('does not advance a failed bank even without an explicit stop condition', () => {
    const s=cloneBankState(initialState);s.status.hasFailed=true;
    const result=new SimulationController(baseConfig).runMonths({state:s,months:12,actions:[]});
    expect(result.records).toHaveLength(0);expect(result.stoppedReason).toBe('failure');
  });
});
