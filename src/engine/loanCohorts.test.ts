import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { generateSeasonedLoanCohorts, stepLoanCohorts, sumLoanOutstanding } from './loanCohorts';
import { accruePnL, closeCapital, recogniseLosses, ShockApplicationResult } from './simulation';

describe('Loan cohort engine', () => {
  it('seeds seasoned cohorts that reconcile to initial loan balances', () => {
    const mortCohorts = initialState.loanCohorts[AssetProductType.Mortgages] ?? [];
    const corpCohorts = initialState.loanCohorts[AssetProductType.CorporateLoans] ?? [];

    expect(mortCohorts.length).toBeGreaterThan(10);
    expect(corpCohorts.length).toBeGreaterThan(10);

    const mortSum = sumLoanOutstanding(mortCohorts);
    const corpSum = sumLoanOutstanding(corpCohorts);

    expect(Math.abs(mortSum - 250e9)).toBeLessThan(1e6);
    expect(Math.abs(corpSum - 160e9)).toBeLessThan(1e6);

    const mortItem = initialState.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages);
    const corpItem = initialState.balanceSheet.items.find((i) => i.productType === AssetProductType.CorporateLoans);
    expect(mortItem).toBeTruthy();
    expect(corpItem).toBeTruthy();
    expect(Math.abs((mortItem?.balance ?? 0) - mortSum)).toBeLessThan(1e-3);
    expect(Math.abs((corpItem?.balance ?? 0) - corpSum)).toBeLessThan(1e-3);

    mortCohorts.forEach((c) => {
      expect(c.termMonths).toBeLessThanOrEqual(420);
      expect(c.ageMonths).toBeLessThan(c.termMonths);
    });
    corpCohorts.forEach((c) => {
      expect(c.termMonths).toBeLessThanOrEqual(420);
      expect(c.ageMonths).toBeLessThan(c.termMonths);
    });
  });

  it('seasoning generation is deterministic for a fixed seed', () => {
    const seed = baseConfig.global.initialPortfolioSeed ?? initialState.market.macroModel.rngSeed;
    const mort = initialState.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages);
    if (!mort) throw new Error('Missing mortgage line item');

    const params = baseConfig.productParameters[AssetProductType.Mortgages];
    const a = generateSeasonedLoanCohorts({
      productType: AssetProductType.Mortgages,
      targetOutstanding: 250e9,
      baseAnnualInterestRate: mort.interestRate,
      baseAnnualPd: params.baseDefaultRate,
      baseLgd: params.lossGivenDefault,
      config: baseConfig,
      seed,
    });
    const b = generateSeasonedLoanCohorts({
      productType: AssetProductType.Mortgages,
      targetOutstanding: 250e9,
      baseAnnualInterestRate: mort.interestRate,
      baseAnnualPd: params.baseDefaultRate,
      baseLgd: params.lossGivenDefault,
      config: baseConfig,
      seed,
    });

    expect(a.length).toBe(b.length);
    expect(a[0]).toEqual(b[0]);
    expect(a[a.length - 1]).toEqual(b[b.length - 1]);
    expect(sumLoanOutstanding(a)).toBe(sumLoanOutstanding(b));
  });

  it('amortises a cohort by one month with correct cashflow and interest split', () => {
    const state = cloneBankState(initialState);
    state.balanceSheet.items.forEach((i) => {
      i.balance = 0;
      i.interestRate = 0;
    });

    const cash = state.balanceSheet.items.find((i) => i.productType === AssetProductType.CashReserves);
    const mortgages = state.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages);
    if (!cash || !mortgages) throw new Error('Missing required line items for amortisation test');
    cash.balance = 0;

    state.loanCohorts = {
      [AssetProductType.Mortgages]: [
        {
          productType: AssetProductType.Mortgages,
          cohortId: 0,
          originalPrincipal: 100,
          outstandingPrincipal: 100,
          annualInterestRate: 0.12,
          termMonths: 12,
          ageMonths: 0,
          annualPd: 0,
          lgd: 0,
        },
      ],
    };
    mortgages.balance = 100;

    const res = stepLoanCohorts({
      state,
      config: baseConfig,
      dtMonths: 1,
      pdMultiplier: 1,
      lgdMultiplier: 1,
      extraLossesByProduct: {},
    });

    const r = 0.12 / 12;
    const n = 12;
    const pmt = (100 * r) / (1 - Math.pow(1 + r, -n));
    const interest = 100 * r;
    const principal = pmt - interest;
    const expectedOutstanding = 100 - principal;

    expect(res.loanInterestIncome).toBeCloseTo(interest, 12);
    expect(cash.balance).toBeCloseTo(pmt, 10);

    const cohort = state.loanCohorts[AssetProductType.Mortgages]?.[0];
    expect(cohort).toBeTruthy();
    expect(cohort?.ageMonths).toBe(1);
    expect(cohort?.outstandingPrincipal ?? 0).toBeCloseTo(expectedOutstanding, 10);
  });

  it('removes cohorts at maturity', () => {
    const state = cloneBankState(initialState);
    state.balanceSheet.items.forEach((i) => {
      i.balance = 0;
      i.interestRate = 0;
    });

    const cash = state.balanceSheet.items.find((i) => i.productType === AssetProductType.CashReserves);
    const mortgages = state.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages);
    if (!cash || !mortgages) throw new Error('Missing required line items for maturity test');
    cash.balance = 0;

    state.loanCohorts = {
      [AssetProductType.Mortgages]: [
        {
          productType: AssetProductType.Mortgages,
          cohortId: 0,
          originalPrincipal: 100,
          outstandingPrincipal: 100,
          annualInterestRate: 0.12,
          termMonths: 1,
          ageMonths: 0,
          annualPd: 0,
          lgd: 0,
        },
      ],
    };
    mortgages.balance = 100;

    stepLoanCohorts({
      state,
      config: baseConfig,
      dtMonths: 1,
      pdMultiplier: 1,
      lgdMultiplier: 1,
      extraLossesByProduct: {},
    });

    expect(state.loanCohorts[AssetProductType.Mortgages]?.length ?? 0).toBe(0);
    expect(mortgages.balance).toBeCloseTo(0, 10);
  });

  it('does not double-count loan interest in cash vs P&L', () => {
    const config = {
      ...baseConfig,
      global: {
        ...baseConfig.global,
        taxRate: 0,
        operatingCostRatio: 0,
        fixedOperatingCostPerMonth: 0,
      },
    };

    const state = cloneBankState(initialState);
    state.balanceSheet.items.forEach((i) => {
      i.balance = 0;
      i.interestRate = 0;
    });

    const cash = state.balanceSheet.items.find((i) => i.productType === AssetProductType.CashReserves);
    const mortgages = state.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages);
    if (!cash || !mortgages) throw new Error('Missing required line items for cash/P&L test');
    cash.balance = 0;

    state.loanCohorts = {
      [AssetProductType.Mortgages]: [
        {
          productType: AssetProductType.Mortgages,
          cohortId: 0,
          originalPrincipal: 100,
          outstandingPrincipal: 100,
          annualInterestRate: 0.12,
          termMonths: 12,
          ageMonths: 0,
          annualPd: 0,
          lgd: 0,
        },
      ],
    };
    mortgages.balance = 100;

    const cohortRes = stepLoanCohorts({
      state,
      config,
      dtMonths: 1,
      pdMultiplier: 1,
      lgdMultiplier: 1,
      extraLossesByProduct: {},
    });

    const cashAfterLoanCashflows = cash.balance;
    const dtYears = 1 / 12;

    const accruals = accruePnL(state, dtYears);
    const shockEffects: ShockApplicationResult = { pdMultiplier: 1, lgdMultiplier: 1, lcrOutflowMultiplier: 1, extraLosses: {} };
    const losses = recogniseLosses(state, config, shockEffects, cohortRes.recognizedLoanLosses);

    const cashBeforeClose = cash.balance;
    const capitalClose = closeCapital(state, config, 1, dtYears, accruals, losses, cohortRes.loanInterestIncome, []);

    expect(state.incomeStatement.interestIncome).toBeCloseTo(cohortRes.loanInterestIncome, 12);
    expect(capitalClose.operatingCashDeltaApplied).toBeCloseTo(
      capitalClose.operatingCashDelta - capitalClose.loanInterestIncome,
      12
    );

    const feeIncome = 0.001 * mortgages.balance;
    expect(capitalClose.operatingCashDeltaApplied).toBeCloseTo(feeIncome, 12);

    const cashAfterClose = cash.balance;
    expect(cashAfterClose - cashBeforeClose).toBeCloseTo(capitalClose.operatingCashDeltaApplied, 12);
    expect(cashAfterClose - cashAfterLoanCashflows).toBeCloseTo(feeIncome, 12);
  });
});

