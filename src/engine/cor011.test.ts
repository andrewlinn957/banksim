import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { AssetProductType as A, LiabilityProductType as L } from '../domain/enums';
import { cloneBankState } from './clone';
import {
  calculateCor011,
  cor011NetOutflow,
  lcrCashFlowContributionsForProduct,
  lcrCommitmentContributions,
  lcrLiquidAssetContributions,
} from './cor011';

const position = (state: typeof initialState, productType: A | L) =>
  state.financial.balanceSheet.items.find(item => item.productType === productType)!;

describe('COR011 LCR engine', () => {
  it('maps reserves and gilts to the current C72 Level 1 rows after encumbrance', () => {
    const state = cloneBankState(initialState);
    position(state, A.CashReserves).balance = 100;
    position(state, A.CashReserves).encumbrance = { encumberedAmount: 20 };
    position(state, A.Gilts).balance = 200;
    position(state, A.Gilts).encumbrance = { encumberedAmount: 50 };
    const contributions = lcrLiquidAssetContributions(state);
    expect(contributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ corep: 'C72 1.1.1.2', amount: 80, factor: 1, weighted: 80 }),
      expect.objectContaining({ corep: 'C72 1.1.1.4', amount: 150, factor: 1, weighted: 150 }),
    ]));
  });

  it('splits sight and <=30-day term retail deposits between stable 5% and other 10%', () => {
    const state = cloneBankState(initialState);
    state.behaviour.insuredRetailDepositShare = 0.8;
    position(state, L.RetailCurrentAccounts).balance = 100;
    let flows = lcrCashFlowContributionsForProduct(state, baseConfig, L.RetailCurrentAccounts);
    expect(flows.outflows).toEqual(expect.arrayContaining([
      expect.objectContaining({ corep: 'C73 1.1.1.4', amount: 80, factor: 0.05, weighted: 4 }),
      expect.objectContaining({ corep: 'C73 1.1.1.7', amount: 20, factor: 0.10, weighted: 2 }),
    ]));

    state.fundingLadders[L.RetailTermDeposits] = [
      { tenorMonths: 12, monthsToMaturity: 1, notional: 100, rate: 0.04 },
      { tenorMonths: 12, monthsToMaturity: 2, notional: 100, rate: 0.04 },
    ];
    position(state, L.RetailTermDeposits).balance = 200;
    flows = lcrCashFlowContributionsForProduct(state, baseConfig, L.RetailTermDeposits);
    expect(flows.outflows.reduce((sum, contribution) => sum + contribution.weighted, 0)).toBeCloseTo(6);
    expect(flows.outflows.reduce((sum, contribution) => sum + contribution.amount, 0)).toBeCloseTo(100);
  });

  it('uses the COR011 corporate deposit rows and factors', () => {
    const state = cloneBankState(initialState);
    position(state, L.CorporateOperatingDeposits).balance = 100;
    position(state, L.CorporateNonOperatingDeposits).balance = 100;
    const operating = lcrCashFlowContributionsForProduct(state, baseConfig, L.CorporateOperatingDeposits).outflows[0];
    const nonOperating = lcrCashFlowContributionsForProduct(state, baseConfig, L.CorporateNonOperatingDeposits).outflows[0];
    expect(operating).toMatchObject({ corep: 'C73 1.1.2.3', factor: 0.25, weighted: 25 });
    expect(nonOperating).toMatchObject({ corep: 'C73 1.1.4.3.2', factor: 0.40, weighted: 40 });
  });

  it('reports central-bank secured funding in C73 at 0% rather than as a 100% maturity outflow', () => {
    const state = cloneBankState(initialState);
    position(state, L.BankOfEnglandFunding).balance = 100;
    state.fundingLadders[L.BankOfEnglandFunding] = [
      { tenorMonths: 1, monthsToMaturity: 1, notional: 100, rate: 0.05 },
    ];
    const flows = lcrCashFlowContributionsForProduct(state, baseConfig, L.BankOfEnglandFunding);
    expect(flows.outflows).toHaveLength(1);
    expect(flows.outflows[0]).toMatchObject({ corep: 'C73 1.2.1.1', amount: 100, factor: 0, weighted: 0 });
  });

  it('uses 5% for retail credit facilities and 10% for non-financial corporate facilities', () => {
    const state = cloneBankState(initialState);
    state.loanPipelines = {
      [A.Mortgages]: { demandNotional: 0, approvedNotional: 0, committedNotional: 100 },
      [A.ConsumerLoans]: { demandNotional: 0, approvedNotional: 0, committedNotional: 100 },
      [A.CorporateLoans]: { demandNotional: 0, approvedNotional: 0, committedNotional: 100 },
    };
    const contributions = lcrCommitmentContributions(state);
    expect(contributions.filter(c => c.corep === 'C73 1.1.6.1.1').reduce((sum, c) => sum + c.weighted, 0)).toBeCloseTo(10);
    expect(contributions.filter(c => c.corep === 'C73 1.1.6.1.2').reduce((sum, c) => sum + c.weighted, 0)).toBeCloseTo(10);
  });

  it('recognises 100% of next-month loan interest and 50% of principal', () => {
    const state = cloneBankState(initialState);
    const cohort = state.loanCohorts[A.Mortgages]![0];
    state.loanCohorts[A.Mortgages] = [{
      ...cohort,
      outstandingPrincipal: 100,
      annualInterestRate: 0.12,
      termMonths: 12,
      ageMonths: 0,
      stage: 'stage1',
    }];
    state.workoutPipelines[A.Mortgages] = [];
    position(state, A.Mortgages).balance = 100;
    const flows = lcrCashFlowContributionsForProduct(state, baseConfig, A.Mortgages);
    const interest = flows.inflows.find(c => c.corep === 'C74 1.1.1.1')!;
    const principal = flows.inflows.find(c => c.corep === 'C74 1.1.1.2.1')!;
    expect(interest.amount).toBeCloseTo(1);
    expect(interest.factor).toBe(1);
    expect(principal.factor).toBe(0.5);
    expect(flows.inflows.reduce((sum, c) => sum + c.weighted, 0)).toBeCloseTo(interest.amount + principal.amount * 0.5);
  });

  it('nets derivative cash flows before reporting C73/C74', () => {
    const state = cloneBankState(initialState);
    state.market.riskFreeShort = 0.05;
    state.financial.hedges = [{
      id: 'lcr-test', direction: 'payFixedReceiveFloat', notional: 120, fixedRate: 0.04,
      maturityMonths: 12, monthsRemaining: 12,
    }];
    let assetFlows = lcrCashFlowContributionsForProduct(state, baseConfig, A.DerivativeAssets);
    let liabilityFlows = lcrCashFlowContributionsForProduct(state, baseConfig, L.DerivativeLiabilities);
    expect(assetFlows.inflows[0]).toMatchObject({ corep: 'C74 1.1.9', factor: 1 });
    expect(liabilityFlows.outflows).toHaveLength(0);

    state.financial.hedges[0].fixedRate = 0.06;
    assetFlows = lcrCashFlowContributionsForProduct(state, baseConfig, A.DerivativeAssets);
    liabilityFlows = lcrCashFlowContributionsForProduct(state, baseConfig, L.DerivativeLiabilities);
    expect(assetFlows.inflows).toHaveLength(0);
    expect(liabilityFlows.outflows[0]).toMatchObject({ corep: 'C73 1.1.5.5', factor: 1 });
  });

  it('implements the exact C76 75%, 90% and fully-exempt inflow reductions', () => {
    const result = cor011NetOutflow(100, [
      { capClass: 'exempt', amount: 10 },
      { capClass: '90', amount: 100 },
      { capClass: '75', amount: 100 },
    ]);
    expect(result.reductionFullyExempt).toBe(10);
    expect(result.reduction90).toBe(81);
    expect(result.reduction75).toBe(0);
    expect(result.netLiquidityOutflow).toBe(9);
  });

  it('applies the C76 short-term secured-funding unwind to adjusted Level 1 without inventing a C73 outflow', () => {
    const state = cloneBankState(initialState);
    position(state, A.CashReserves).balance = 97;
    position(state, A.CashReserves).encumbrance = { encumberedAmount: 0 };
    position(state, A.Gilts).balance = 100;
    position(state, A.Gilts).encumbrance = { encumberedAmount: 100, remainingMonths: 1 };
    position(state, L.BankOfEnglandFunding).balance = 97;
    state.fundingLadders[L.BankOfEnglandFunding] = [
      { tenorMonths: 1, monthsToMaturity: 1, notional: 97, rate: 0.05 },
    ];
    const result = calculateCor011(state, baseConfig);
    expect(result.c76.unadjustedLevel1).toBeCloseTo(97);
    expect(result.c76.level1Collateral30dInflows).toBeCloseTo(100);
    expect(result.c76.securedCash30dOutflows).toBeCloseTo(97);
    expect(result.c76.adjustedLevel1).toBeCloseTo(100);
    expect(result.outflows.find(c => c.corep === 'C73 1.2.1.1')).toMatchObject({ factor: 0, weighted: 0 });
  });
});
