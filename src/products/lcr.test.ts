import { describe, expect, it } from 'vitest';
import { AssetProductType as A, LiabilityProductType as L, PRODUCTS } from './catalogue';
import {
  getLcrProductRule,
  LCR_HQLA_CATEGORIES,
  LCR_INFLOW_CATEGORIES,
  LCR_OUTFLOW_CATEGORIES,
  LCR_PRODUCT_RULES,
} from './lcr';

describe('COR011 LCR regulatory registry', () => {
  it('gives every typed catalogue product an explicit LCR mapping', () => {
    expect(Object.keys(LCR_PRODUCT_RULES).sort()).toEqual(Object.keys(PRODUCTS).sort());
  });

  it('maps current products independently of the broader liquidity class', () => {
    expect(getLcrProductRule(A.CashReserves)).toEqual({ hqla: 'withdrawableCentralBankReserve' });
    expect(getLcrProductRule(A.Gilts)).toEqual({ hqla: 'centralGovernmentLevel1' });
    expect(getLcrProductRule(A.Mortgages)).toEqual({ inflow: 'retailLoan', commitment: 'retailCreditFacility' });
    expect(getLcrProductRule(A.ConsumerLoans)).toEqual({ inflow: 'retailLoan', commitment: 'retailCreditFacility' });
    expect(getLcrProductRule(A.CorporateLoans)).toEqual({ inflow: 'corporateLoan', commitment: 'nonFinancialCorporateCreditFacility' });
    expect(getLcrProductRule(L.BankOfEnglandFunding)).toEqual({ outflow: 'centralBankSecuredLevel1' });
    expect(getLcrProductRule(L.Tier2Debt)).toEqual({ outflow: 'debtSecurity' });
  });

  it('records the COR011 C72 rows used by the BankSim liquidity buffer', () => {
    expect(LCR_HQLA_CATEGORIES.withdrawableCentralBankReserve).toMatchObject({
      corep: 'C72 1.1.1.2', factor: 1, level: 'level1',
    });
    expect(LCR_HQLA_CATEGORIES.centralGovernmentLevel1).toMatchObject({
      corep: 'C72 1.1.1.4', factor: 1, level: 'level1',
    });
  });

  it('records the relevant C73 outflow rows and standard factors', () => {
    expect(LCR_OUTFLOW_CATEGORIES.stableRetailDeposit).toMatchObject({ corep: 'C73 1.1.1.4', factor: 0.05 });
    expect(LCR_OUTFLOW_CATEGORIES.otherRetailDeposit).toMatchObject({ corep: 'C73 1.1.1.7', factor: 0.10 });
    expect(LCR_OUTFLOW_CATEGORIES.nonFinancialOperationalDeposit).toMatchObject({ corep: 'C73 1.1.2.3', factor: 0.25 });
    expect(LCR_OUTFLOW_CATEGORIES.nonFinancialNonOperationalDeposit).toMatchObject({ corep: 'C73 1.1.4.3.2', factor: 0.40 });
    expect(LCR_OUTFLOW_CATEGORIES.debtSecurity).toMatchObject({ corep: 'C73 1.1.8.2', factor: 1 });
    expect(LCR_OUTFLOW_CATEGORIES.centralBankSecuredLevel1).toMatchObject({ corep: 'C73 1.2.1.1', factor: 0 });
    expect(LCR_OUTFLOW_CATEGORIES.derivativeOutflow).toMatchObject({ corep: 'C73 1.1.5.5', factor: 1 });
    expect(LCR_OUTFLOW_CATEGORIES.retailCreditFacility).toMatchObject({ corep: 'C73 1.1.6.1.1', factor: 0.05 });
    expect(LCR_OUTFLOW_CATEGORIES.nonFinancialCorporateCreditFacility).toMatchObject({ corep: 'C73 1.1.6.1.2', factor: 0.10 });
  });

  it('records the relevant C74 inflow rows, factors and cap class', () => {
    expect(LCR_INFLOW_CATEGORIES.loanInterest).toMatchObject({ corep: 'C74 1.1.1.1', factor: 1, capClass: '75' });
    expect(LCR_INFLOW_CATEGORIES.retailLoanPrincipal).toMatchObject({ corep: 'C74 1.1.1.2.1', factor: 0.50, capClass: '75' });
    expect(LCR_INFLOW_CATEGORIES.nonFinancialCorporateLoanPrincipal).toMatchObject({ corep: 'C74 1.1.1.2.2', factor: 0.50, capClass: '75' });
    expect(LCR_INFLOW_CATEGORIES.derivativeInflow).toMatchObject({ corep: 'C74 1.1.9', factor: 1, capClass: '75' });
  });
});
