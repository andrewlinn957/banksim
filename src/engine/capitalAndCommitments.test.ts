import { describe, it, expect } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { cloneBankState } from './clone';
import { ownFundsRequirements } from './prudential';
import { calculateRiskMetrics, evaluateCompliance } from './metrics';
import { commitmentEcl } from './impairment';
import { applyShocks, recogniseLosses, createSimulationEngine } from './simulation';
import { AssetProductType as A, LiabilityProductType as L } from '../domain/enums';
import { checkInvariants } from './invariants';
import { scenarios, getScenarioInitialState, applyScenarioConfig } from '../config/scenarios';

describe('Opening accounts, commitments and supervisory capital', () => {
  it('opens with allowance without inventing a first-month charge or changing net assets', () => {
    expect(initialState.financial.provisionStock.total).toBeGreaterThan(0);
    expect(checkInvariants(initialState)).toEqual([]);
    const s = cloneBankState(initialState);
    const loss = recogniseLosses(s, baseConfig, applyShocks(s, baseConfig, [], []), {});
    expect(loss.provisionCharge).toBeCloseTo(0, 5);
    expect(s.financial.balanceSheet).toEqual(initialState.financial.balanceSheet);
  });
  it('recognises and releases undrawn provisions without taking cash or principal', () => {
    const s = cloneBankState(initialState);
    s.loanPipelines[A.CorporateLoans] = { demandNotional: 0, approvedNotional: 0, committedNotional: 1e8 };
    const target = commitmentEcl(s, baseConfig), cash = s.financial.balanceSheet.items[0].balance;
    const close = () => recogniseLosses(s, baseConfig, applyShocks(s, baseConfig, [], []), {});
    expect(target).toBeGreaterThan(0);
    expect(close().provisionCharge).toBeCloseTo(target, 5);
    expect(s.financial.balanceSheet.items.find(i => i.productType === L.CreditProvisions)?.balance).toBeCloseTo(target, 5);
    expect(close().provisionCharge).toBeCloseTo(0, 5);
    s.loanPipelines = {};
    expect(close().provisionCharge).toBeCloseTo(-target, 5);
    expect(s.financial.balanceSheet.items[0].balance).toBe(cash);
  });
  it('closes with a provision liability and a reconciled cash flow', () => {
    const s = cloneBankState(initialState); s.loanPipelines[A.CorporateLoans] = { demandNotional:0, approvedNotional:0, committedNotional:1e8 };
    const next = createSimulationEngine().step({state:s,config:baseConfig,actions:[],shocks:[]}).nextState;
    expect(checkInvariants(next)).toEqual([]);
    const cf=next.financial.cashFlowStatement;
    expect(Math.abs(cf.operatingCashFlow+cf.investingCashFlow+cf.financingCashFlow-cf.netChange)).toBeLessThan(1);
  });
  it('applies P2A composition, fixed amounts and separates PRA buffer from MDA', () => {
    const c=structuredClone(baseConfig); c.riskLimits.pillar2A={totalRatio:.02,fixedAmount:1e6};
    expect(ownFundsRequirements(c.riskLimits,1e8)).toEqual({cet1:.045+.03*.5625,tier1:.06+.03*.75,total:.11});
    const m=calculateRiskMetrics({state:initialState,config:c});
    expect(m.cet1Requirement).toBeGreaterThan(initialState.risk.riskMetrics.cet1Requirement);
    c.riskLimits.praBufferRatio=.5;
    const buffer=calculateRiskMetrics({state:initialState,config:c});
    expect(buffer.cet1Requirement).toBe(m.cet1Requirement);
    expect(buffer.mdaTriggered).toBe(m.mdaTriggered);
    expect(buffer.praBufferBreached).toBe(true);
    expect(buffer.internalCet1TargetRatio).toBeGreaterThan(m.internalCet1TargetRatio);
    expect(evaluateCompliance({...m,cet1Ratio:.05},c.riskLimits).cet1Breached).toBe(true);
  });
  it('starts every scenario with reconciled net loans and funding ladders', () => {
    for(const scenario of scenarios){const c=applyScenarioConfig(baseConfig,scenario.id),s=getScenarioInitialState(scenario.id,c);expect(checkInvariants(s),scenario.id).toEqual([]);}
  });
});

import { assetCreditRwa } from './creditRwa';
it('risk weights defaulted mortgages at 100% and unsecured defaults by provision coverage', () => {
  const s=cloneBankState(initialState), c=structuredClone(baseConfig);
  c.behaviour.creditRiskDynamics!.workoutPipeline!.macroRecoveryPenaltySensitivity=0;
  c.behaviour.creditRiskDynamics!.workoutPipeline!.concentrationRecoveryPenaltySensitivity=0;
  for(const [p,allowance,expected] of [[A.Mortgages,10,90],[A.CorporateLoans,10,135],[A.CorporateLoans,20,80]] as const){
    const item=s.financial.balanceSheet.items.find(i=>i.productType===p)!;
    s.loanCohorts[p]=[];s.workoutPipelines[p]=[{productType:p,sourceCohortId:1,stageAtDefault:'stage3',defaultedPrincipal:100,expectedRecoveryRate:1-allowance/100,monthsToResolution:1}];
    item.lossAllowance=allowance;item.balance=100-allowance;
    expect(assetCreditRwa(s,c,item)).toBeCloseTo(expected,8);
  }
});
