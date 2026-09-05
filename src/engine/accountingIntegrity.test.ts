import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { applyActions, applyShocks, recogniseLosses, createSimulationEngine } from './simulation';
import { calculateProvisionTargetFromCohorts, stepLoanCohorts, syncLoanBalancesFromCohorts } from './loanCohorts';
import { cohortEcl, workoutPresentValue } from './impairment';
import { checkInvariants } from './invariants';
const mortgage = AssetProductType.Mortgages;
const item = (s: typeof initialState, p = mortgage) => s.financial.balanceSheet.items.find(i => i.productType === p)!;
const recognize = (s: typeof initialState, config = baseConfig, losses = {}) => recogniseLosses(s, config, applyShocks(s, config, [], []), losses);

describe('Loan accounting identities', () => {
  it('books and releases allowance without changing contractual principal or cash', () => {
    const s = cloneBankState(initialState), gross = item(s).balance + (item(s).lossAllowance ?? 0), cash = item(s, AssetProductType.CashReserves).balance;
    const cohorts = JSON.stringify(s.loanCohorts);
    expect(recognize(s).provisionCharge).toBeCloseTo(0, 5);
    expect(JSON.stringify(s.loanCohorts)).toBe(cohorts);
    expect(item(s).balance + item(s).lossAllowance!).toBeCloseTo(gross, 4);
    expect(recognize(s).provisionCharge).toBeCloseTo(0, 5);
    Object.values(s.loanCohorts).flat().forEach(c => c.annualPd = 0);
    expect(recognize(s).provisionCharge).toBeLessThan(0);
    expect(item(s).balance).toBeCloseTo(gross, 4);
    expect(item(s, AssetProductType.CashReserves).balance).toBe(cash);
  });
  it('uses stressed PD, weighted scenarios, remaining life and discounting', () => {
    const c = { ...initialState.loanCohorts[mortgage]![0], outstandingPrincipal: 100, termMonths: 12, ageMonths: 11, stage: 'stage1' as const, annualInterestRate: .12, annualPd: .12, effectiveAnnualPd: .24, effectiveLgd: .8 };
    const expected = 100 * .8 / 1.01 * (.2 * (1 - .82 ** (1 / 12)) + .6 * (1 - .76 ** (1 / 12)) + .2 * (1 - .64 ** (1 / 12)));
    expect(cohortEcl(c, baseConfig)).toBeCloseTo(expected, 10);
    expect(cohortEcl({ ...c, ageMonths: 0, termMonths: 60, stage: 'stage2' }, baseConfig)).toBeGreaterThan(cohortEcl({ ...c, ageMonths: 0, termMonths: 60 }, baseConfig));
  });
  it('settles an already allowed workout without a second loss and identifies net interest', () => {
    const config = structuredClone(baseConfig);
    config.behaviour.creditRiskDynamics!.workoutPipeline!.macroRecoveryPenaltySensitivity = 0;
    config.behaviour.creditRiskDynamics!.workoutPipeline!.concentrationRecoveryPenaltySensitivity = 0;
    const s = cloneBankState(initialState);
    const bucket = { productType: mortgage, sourceCohortId: 1, stageAtDefault: 'stage3' as const, defaultedPrincipal: 100, expectedRecoveryRate: .6, effectiveInterestRate: .12, monthsToResolution: 1 };
    s.loanCohorts = { [mortgage]: [] }; s.workoutPipelines = { [mortgage]: [bucket] };
    s.financial.balanceSheet.items = s.financial.balanceSheet.items.filter(i => i.productType === mortgage || i.productType === AssetProductType.CashReserves);
    syncLoanBalancesFromCohorts(s); recognize(s, config);
    expect(item(s).balance).toBeCloseTo(60 / 1.01, 8);
    const stepped = stepLoanCohorts({ state: s, config, dtMonths: 1, pdMultiplier: 1, lgdMultiplier: 1 });
    expect(stepped.recoveryCash).toBeCloseTo(60);
    expect(stepped.nonCashInterest).toBeCloseTo(60 / 1.01 * .01);
    expect(recognize(s, config, stepped.recognizedLoanLosses).provisionCharge + stepped.nonCashInterest).toBeCloseTo(0, 8);
    expect(item(s).balance).toBe(0);
    expect(s.financial.provisionStock.total).toBe(0);
  });
  it('applies the same stressed recovery assumptions to allowance and resolution', () => {
    const s = cloneBankState(initialState), c = structuredClone(baseConfig);
    const b = { productType: mortgage, sourceCohortId: 1, stageAtDefault: 'stage3' as const, defaultedPrincipal: 100, expectedRecoveryRate: .6, monthsToResolution: 1 };
    s.loanCohorts = { [mortgage]: [] }; s.workoutPipelines = { [mortgage]: [b] };
    const expected = workoutPresentValue(s, c, mortgage, b);
    expect(calculateProvisionTargetFromCohorts({ state: s, config: c }).total).toBeCloseTo(100 - expected);
    expect(stepLoanCohorts({ state: s, config: c, dtMonths: 1, pdMultiplier: 1, lgdMultiplier: 1 }).recoveryCash).toBeCloseTo(expected);
  });
  it('keeps principal, net assets and the cash-flow statement reconciled through stress and recovery', () => {
    let s = cloneBankState(initialState); const engine = createSimulationEngine();
    for (let month = 0; month < 18; month++) {
      const out = engine.step({ state: s, config: baseConfig, actions: [{ type: 'setCapitalPolicy', dividendPayoutRatio: 0, at1CouponMode: 'skip' }], shocks: month === 3 ? [{ type: 'macroDownturn', pdMultiplier: 2, lgdMultiplier: 1.3 }] : [] });
      s = out.nextState; expect(checkInvariants(s)).toEqual([]);
      expect(out.events.filter(e => e.message.includes('Cash flow statement mismatch'))).toEqual([]);
      const cf = s.financial.cashFlowStatement;
      expect(Math.abs(cf.operatingCashFlow + cf.investingCashFlow + cf.financingCashFlow - cf.netChange)).toBeLessThan(1);
    }
  });
  it('rejects non-finite transactions and fails invariant checks on non-finite books', () => {
    const s = cloneBankState(initialState);
    applyActions(s, baseConfig, [{ type: 'issueEquity', amount: Infinity }], []);
    expect(s.financial.capital.cet1).toBe(initialState.financial.capital.cet1);
    item(s).balance = NaN;
    expect(checkInvariants(s).some(e => e.includes('Non-finite'))).toBe(true);
  });
  it('uses market-value haircut and prevents the sale of pledged collateral', () => {
    const s = cloneBankState(initialState), gilts = item(s, AssetProductType.Gilts);
    const available = gilts.balance - gilts.encumbrance.encumberedAmount;
    applyActions(s, baseConfig, [{ type: 'enterRepo', direction: 'borrow', collateralProduct: AssetProductType.Gilts, amount: available, haircut: .2, rate: .04 }], []);
    expect(gilts.encumbrance.encumberedAmount).toBeCloseTo(gilts.balance, 3);
    const before = gilts.balance;
    applyActions(s, baseConfig, [{ type: 'buySellAsset', productType: AssetProductType.Gilts, amountDelta: -before }], []);
    expect(gilts.balance).toBeCloseTo(before, 3);
  });
});
