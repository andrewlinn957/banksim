import { describe, it, expect } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { cloneBankState } from './clone';
import { AssetProductType as A, LiabilityProductType as L } from '../domain/enums';
import { applyActions, createSimulationEngine, accruePnL } from './simulation';
import { hedgeFairValue } from './hedgeValuation';
import { recogniseSecurityImpairment, securityEcl } from './securityImpairment';
import { checkInvariants } from './invariants';

describe('Treasury accounting without free profits', () => {
  it('prices an off-market swap upfront and leaves equity unchanged', () => {
    const s=cloneBankState(initialState), equity=s.financial.capital.cet1;
    const cash=s.financial.balanceSheet.items.find(i=>i.productType===A.CashReserves)!;
    const start=cash.balance;
    applyActions(s,baseConfig,[{type:'enterHedge',direction:'payFixedReceiveFloat',notional:1e8,fixedRate:0,maturityMonths:12}],[]);
    const fairValue=hedgeFairValue(s.financial.hedges[0],s.market.riskFreeShort);
    expect(fairValue).toBeGreaterThan(0);
    expect(start-cash.balance).toBeCloseTo(fairValue,5);
    expect(s.financial.capital.cet1).toBe(equity);
    expect(checkInvariants(s)).toEqual([]);
  });
  it('reconciles cash, value changes and maturity for both swap directions', () => {
    for(const direction of ['payFixedReceiveFloat','receiveFixedPayFloat'] as const){
      let s=cloneBankState(initialState);
      const engine=createSimulationEngine();
      for(let month=0;month<5;month++){
        s.market.riskFreeShort=month<2?.06:.01;
        const out=engine.step({state:s,config:baseConfig,actions:month===0?[{type:'enterHedge',direction,notional:1e8,fixedRate:.03,maturityMonths:3}]:[],shocks:[]});
        s=out.nextState;
        expect(checkInvariants(s)).toEqual([]);
        const cf=s.financial.cashFlowStatement;
        expect(Math.abs(cf.operatingCashFlow+cf.investingCashFlow+cf.financingCashFlow-cf.netChange)).toBeLessThan(1);
      }
      expect(s.financial.hedges).toHaveLength(0);
      expect(s.financial.balanceSheet.items.find(i=>i.productType===A.DerivativeAssets)?.balance ?? 0).toBe(0);
      expect(s.financial.balanceSheet.items.find(i=>i.productType===L.DerivativeLiabilities)?.balance ?? 0).toBe(0);
    }
  });
  it('keeps FVOCI assets at fair value while impairment offsets OCI, and deducts amortised-cost ECL', () => {
    for(const classification of ['FVOCI','HTM'] as const){
      const s=cloneBankState(initialState),g=s.financial.balanceSheet.items.find(i=>i.productType===A.Gilts)!;
      g.security={classification,effectiveDurationYears:5,valuationReferenceYield:.03,amortisedCost:100,lossAllowance:0};g.balance=100;
      const expected=securityEcl(g,baseConfig), before=accruePnL(s,1).interestIncome;
      const result=recogniseSecurityImpairment(s,baseConfig);
      expect(result.expense).toBeCloseTo(expected,10);
      expect(g.balance).toBeCloseTo(classification==='FVOCI'?100:100-expected,10);
      expect(result.oci).toBeCloseTo(classification==='FVOCI'?expected:0,10);
      expect(accruePnL(s,1).interestIncome).toBeCloseTo(before,8);
      expect(recogniseSecurityImpairment(s,baseConfig).expense).toBeCloseTo(0,10);
    }
  });
  it('recycles an FVOCI sale without creating cash-flow mismatches', () => {
    const s=cloneBankState(initialState), g=s.financial.balanceSheet.items.find(i=>i.productType===A.Gilts)!;
    s.market.riskFreeLong += .005;
    const out=createSimulationEngine().step({state:s,config:baseConfig,actions:[{type:'buySellAsset',productType:A.Gilts,amountDelta:-g.balance*.25}],shocks:[]});
    expect(out.nextState.financial.incomeStatement.fvtplValuationImpact).toBeLessThan(0);
    expect(checkInvariants(out.nextState)).toEqual([]);
    const cf=out.nextState.financial.cashFlowStatement;
    expect(Math.abs(cf.operatingCashFlow+cf.investingCashFlow+cf.financingCashFlow-cf.netChange)).toBeLessThan(1);
  });
});

import { prudentialLiquidityLines } from './prudential';
it('funds net derivative assets plus 5% negative fair values and counts due coupons', () => {
  const s=cloneBankState(initialState);
  applyActions(s,baseConfig,[{type:'enterHedge',direction:'payFixedReceiveFloat',notional:1e8,fixedRate:0,maturityMonths:12},{type:'enterHedge',direction:'receiveFixedPayFloat',notional:1e8,fixedRate:0,maturityMonths:12}],[]);
  const rows=prudentialLiquidityLines(s,baseConfig),a=rows.find(i=>i.productType===A.DerivativeAssets)!,l=rows.find(i=>i.productType===L.DerivativeLiabilities)!;
  expect(a.rsf).toBeCloseTo(0,6);expect(l.rsf).toBeCloseTo(l.balance*.05,6);
  expect(a.inflow).toBeGreaterThan(0);expect(l.outflow).toBeGreaterThan(0);
});

import { hedgeExposures } from './hedgeValuation';
it('retains future exposure for out-of-the-money swaps and fixes the leverage multiplier', () => {
  const s=cloneBankState(initialState);
  s.financial.hedges=[{id:'a',direction:'payFixedReceiveFloat',notional:1e8,fixedRate:.1,maturityMonths:24,monthsRemaining:24,fairValue:-1e7}];
  const e=hedgeExposures(s),addOn=1e8*(1-Math.exp(-.1))/.05*.005;
  expect(e.leverage).toBeCloseTo(1.4*addOn,6);
  expect(e.credit).toBeGreaterThan(0);
  expect(e.credit).toBeLessThan(e.leverage);
  s.financial.hedges[0].fairValue=1e6;
  expect(hedgeExposures(s).credit).toBeCloseTo(1.4*(1e6+addOn),6);
});
