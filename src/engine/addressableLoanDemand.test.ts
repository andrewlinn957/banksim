import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { applyLoanBehaviour } from './simulation';

const item = (state: typeof initialState, product: AssetProductType) =>
  state.financial.balanceSheet.items.find((row) => row.productType === product)!;

describe('Addressable loan demand', () => {
  it('pins the calibrated neutral corporate replacement rate and pricing capture', () => {
    const corporate = baseConfig.behaviour.loanPipelineByProduct?.[AssetProductType.CorporateLoans];
    expect(corporate?.baseDemandRateMonthly).toBe(0.026);
    expect(corporate?.pricingSensitivity).toBe(65);
  });

  it('does not collapse just because the bank current corporate book is smaller', () => {
    const full = cloneBankState(initialState);
    const small = cloneBankState(initialState);
    item(small, AssetProductType.CorporateLoans).balance *= 0.2;

    const fullResult = applyLoanBehaviour(full, structuredClone(baseConfig), 1, []);
    const smallResult = applyLoanBehaviour(small, structuredClone(baseConfig), 1, []);

    const fullDemand = full.loanPipelines?.[AssetProductType.CorporateLoans]?.demandNotional ?? 0;
    const smallDemand = small.loanPipelines?.[AssetProductType.CorporateLoans]?.demandNotional ?? 0;
    expect(fullResult.demandNotional).toBeGreaterThan(0);
    expect(smallResult.demandNotional).toBeGreaterThan(0);
    expect(smallDemand / fullDemand).toBeGreaterThan(0.95);
  });

  it('contracts the opportunity in a weak macro environment', () => {
    const normal = cloneBankState(initialState);
    const weak = cloneBankState(initialState);
    weak.market.gdpGrowthMoM = -0.006;
    weak.market.unemploymentRate = 0.08;
    weak.market.creditSpread = 0.035;
    weak.market.competitorMortgageRate += 0.02;
    weak.market.corporateLoanSpread += 0.02;

    applyLoanBehaviour(normal, structuredClone(baseConfig), 1, []);
    applyLoanBehaviour(weak, structuredClone(baseConfig), 1, []);

    const normalMortgage = normal.loanPipelines?.[AssetProductType.Mortgages]?.demandNotional ?? 0;
    const weakMortgage = weak.loanPipelines?.[AssetProductType.Mortgages]?.demandNotional ?? 0;
    const normalCorporate = normal.loanPipelines?.[AssetProductType.CorporateLoans]?.demandNotional ?? 0;
    const weakCorporate = weak.loanPipelines?.[AssetProductType.CorporateLoans]?.demandNotional ?? 0;
    expect(weakMortgage).toBeLessThan(normalMortgage);
    expect(weakCorporate).toBeLessThan(normalCorporate);
  });
});
