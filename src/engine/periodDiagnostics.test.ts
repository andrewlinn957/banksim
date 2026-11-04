import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { cloneBankState } from './clone';
import { AssetProductType as A, LiabilityProductType as L } from '../domain/enums';
import { createSimulationEngine } from './simulation';

describe('period provision and valuation diagnostics', () => {
  it('reconciles the allowance bridge and records valuation inputs before the market advances', () => {
    const state = cloneBankState(initialState);
    state.equityMarket.epsTtm = 0.1;
    state.equityMarket.sharePrice = 2;
    state.equityMarket.marketCap = state.equityMarket.sharesOutstanding * 2;
    const next = createSimulationEngine().step({ state, config: baseConfig, actions: [], shocks: [] }).nextState;
    const bridge = next.periodFlows?.provisionBridge;
    const valuation = next.periodFlows?.shareValuation;

    if (!bridge || !valuation) throw new Error('Missing period diagnostics');
    expect(bridge.provisionCharge).toBeCloseTo(next.financial.incomeStatement.provisionCharge, 5);
    expect(bridge.reconciliationDifference).toBeCloseTo(0, 5);
    expect(bridge.fundedAllowanceClosingByStage.total).toBeCloseTo(
      bridge.fundedAllowanceClosingByStage.stage1 +
        bridge.fundedAllowanceClosingByStage.stage2 +
        bridge.fundedAllowanceClosingByStage.stage3,
      5
    );

    expect(valuation.gdpGrowthMoM).toBe(state.market.gdpGrowthMoM);
    expect(valuation.unemploymentRate).toBe(state.market.unemploymentRate);
    expect(valuation.creditSpread).toBe(state.market.creditSpread);
    expect(valuation.modelPe).toBe(next.equityMarket.peMultiple);
    expect(valuation.quotedPe).toBeCloseTo(next.equityMarket.sharePrice / next.equityMarket.epsTtm, 8);
  });

  it('keeps newly defaulted principal separate from realised workout write-offs', () => {
    const config = structuredClone(baseConfig);
    config.featureFlags = { ...(config.featureFlags ?? {}), loanPipeline: false };
    const state = cloneBankState(initialState);
    const mortgage = state.financial.balanceSheet.items.find((item) => item.productType === A.Mortgages);
    if (!mortgage) throw new Error('Missing mortgage line');

    state.loanCohorts = {
      [A.Mortgages]: [{
        productType: A.Mortgages,
        cohortId: 1,
        originationStep: state.time.step,
        originalPrincipal: 100_000_000,
        outstandingPrincipal: 100_000_000,
        annualInterestRate: 0.05,
        termMonths: 360,
        ageMonths: 0,
        annualPd: 0.99,
        lgd: 0.5,
        stage: 'stage1',
      }],
    };
    state.workoutPipelines = {};
    state.loanPipelines = {};
    state.financial.provisionStock = { stage1: 0, stage2: 0, stage3: 0, total: 0 };
    state.financial.balanceSheet.items.forEach((item) => {
      if ([A.Mortgages, A.ConsumerLoans, A.CorporateLoans].includes(item.productType as A)) {
        item.lossAllowance = 0;
        item.balance = item.productType === A.Mortgages ? 100_000_000 : 0;
      }
      if (item.productType === L.CreditProvisions) item.balance = 0;
    });

    const next = createSimulationEngine().step({ state, config, actions: [], shocks: [] }).nextState;
    expect(next.periodFlows?.defaultsByProduct[A.Mortgages]).toBeGreaterThan(0);
    expect(next.periodFlows?.provisionBridge?.workoutWriteoffsByProduct[A.Mortgages] ?? 0).toBe(0);
    expect(next.periodFlows?.realizedLossesByVintage).toHaveLength(0);
  });
});
