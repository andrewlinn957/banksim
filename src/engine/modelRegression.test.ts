import { describe, expect, it } from 'vitest';
import { calibrationPacks } from '../config/calibration';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { BankState } from '../domain/bankState';
import { PlayerAction } from '../domain/actions';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { cloneBankState } from './clone';
import { evaluateScenarioGoals } from './scoring';
import { createSimulationEngine } from './simulation';

const runMonths = (
  months: number,
  args: { state: BankState; config: (typeof calibrationPacks)[number]['config'] }
) => {
  const engine = createSimulationEngine();
  let state = cloneBankState(args.state);
  for (let i = 0; i < months; i++) {
    state = engine.step({ state, config: args.config, actions: [], shocks: [] }).nextState;
    if (state.status.hasFailed) break;
  }
  return state;
};

const runMonthsWithPolicy = (
  months: number,
  args: {
    state: BankState;
    config: (typeof calibrationPacks)[number]['config'];
    actionsForMonth: (state: BankState, monthIndex: number) => PlayerAction[];
  }
) => {
  const engine = createSimulationEngine();
  let state = cloneBankState(args.state);
  for (let i = 0; i < months; i++) {
    const actions = args.actionsForMonth(state, i);
    state = engine.step({ state, config: args.config, actions, shocks: [] }).nextState;
    if (state.status.hasFailed) break;
  }
  return state;
};

const annualisedRoe = (state: BankState): number => {
  const equity =
    state.financial.capital.cet1 + state.financial.capital.at1 + state.financial.capital.accumulatedOCI;
  return equity > 0 ? (state.financial.incomeStatement.netIncome * 12) / equity : 0;
};

const productBalance = (state: BankState, productType: AssetProductType | LiabilityProductType): number =>
  state.financial.balanceSheet.items.find((line) => line.productType === productType)?.balance ?? 0;

const totalLoans = (state: BankState): number =>
  productBalance(state, AssetProductType.Mortgages) + productBalance(state, AssetProductType.CorporateLoans);

const totalCustomerDeposits = (state: BankState): number =>
  productBalance(state, LiabilityProductType.RetailTransactionalDeposits) +
  productBalance(state, LiabilityProductType.RetailSavingsDeposits) +
  productBalance(state, LiabilityProductType.CorporateOperatingDeposits) +
  productBalance(state, LiabilityProductType.CorporateNonOperatingDeposits);

const totalLoanStateBuckets = (state: BankState): number =>
  Object.values(state.loanCohorts ?? {}).reduce((sum, cohorts) => sum + (cohorts?.length ?? 0), 0) +
  Object.values(state.workoutPipelines ?? {}).reduce((sum, buckets) => sum + (buckets?.length ?? 0), 0);

const managementPolicy = (
  state: BankState,
  monthIndex: number,
  pricing: { mortgageDiscount?: number; corporateDiscount?: number } = {}
): PlayerAction[] => {
  const mortgageDiscount = pricing.mortgageDiscount ?? 0.004;
  const corporateDiscount = pricing.corporateDiscount ?? 0.006;
  const actions: PlayerAction[] = [
    {
      type: 'adjustRate',
      productType: AssetProductType.Mortgages,
      newRate: Math.max(0, state.market.competitorMortgageRate - mortgageDiscount),
    },
    {
      type: 'adjustRate',
      productType: AssetProductType.CorporateLoans,
      newRate: Math.max(0, state.market.riskFreeLong + state.market.corporateLoanSpread - corporateDiscount),
    },
    { type: 'setUnderwriting', productType: AssetProductType.Mortgages, tightness: 0.15 },
    { type: 'setUnderwriting', productType: AssetProductType.CorporateLoans, tightness: 0.15 },
    { type: 'setCapitalPolicy', dividendPayoutRatio: 0, at1CouponMode: 'auto' },
  ];

  // Reprice deposits annually. When cash is scarce, pay a small premium; when cash is abundant, accept some runoff.
  if (monthIndex % 12 === 0) {
    const cash = productBalance(state, AssetProductType.CashReserves);
    const offset = cash < 1.5e9 ? 0.0025 : cash > 3.5e9 ? -0.0025 : 0;
    const retailRate = Math.max(0, state.market.competitorRetailDepositRate + offset);
    const corporateRate = Math.max(
      0,
      (state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate) + offset
    );
    actions.push(
      { type: 'adjustRate', productType: LiabilityProductType.RetailTransactionalDeposits, newRate: retailRate },
      { type: 'adjustRate', productType: LiabilityProductType.RetailSavingsDeposits, newRate: retailRate },
      { type: 'adjustRate', productType: LiabilityProductType.CorporateOperatingDeposits, newRate: corporateRate },
      { type: 'adjustRate', productType: LiabilityProductType.CorporateNonOperatingDeposits, newRate: corporateRate },
    );
  }
  return actions;
};

describe('Model regression harness', () => {
  it('archetype trajectories stay within configured KPI envelopes', () => {
    calibrationPacks.forEach((pack) => {
      const finalState = runMonths(24, { state: pack.initialState, config: pack.config });
      const roe = annualisedRoe(finalState);
      const metrics = finalState.risk.riskMetrics;

      expect(finalState.status.hasFailed, `${pack.id} failed before the 24-month calibration horizon`).toBe(false);
      expect(metrics.cet1Ratio).toBeGreaterThanOrEqual(pack.envelope.cet1Ratio[0]);
      expect(metrics.cet1Ratio).toBeLessThanOrEqual(pack.envelope.cet1Ratio[1]);
      expect(metrics.lcr).toBeGreaterThanOrEqual(pack.envelope.lcr[0]);
      expect(metrics.lcr).toBeLessThanOrEqual(pack.envelope.lcr[1]);
      expect(metrics.nsfr).toBeGreaterThanOrEqual(pack.envelope.nsfr[0]);
      expect(metrics.nsfr).toBeLessThanOrEqual(pack.envelope.nsfr[1]);
      expect(roe).toBeGreaterThanOrEqual(pack.envelope.roe[0]);
      expect(roe).toBeLessThanOrEqual(pack.envelope.roe[1]);
    });
  });

  it('seed sweeps avoid unstable or implausible outputs', () => {
    const universalPack = calibrationPacks.find((pack) => pack.id === 'universal');
    if (!universalPack) throw new Error('Missing universal calibration pack');

    [11, 101, 1001, 10001, 100001].forEach((seed) => {
      const state = cloneBankState(universalPack.initialState);
      state.market.macroModel.rngSeed = seed;
      const finalState = runMonths(18, { state, config: universalPack.config });
      const metrics = finalState.risk.riskMetrics;

      expect(Number.isFinite(metrics.cet1Ratio)).toBe(true);
      expect(Number.isFinite(metrics.lcr)).toBe(true);
      expect(Number.isFinite(metrics.nsfr)).toBe(true);
      expect(Number.isFinite(metrics.eveSensitivity100bp)).toBe(true);
      expect(metrics.cet1Ratio).toBeGreaterThan(-0.2);
      expect(metrics.cet1Ratio).toBeLessThan(1.2);
      expect(metrics.lcr).toBeGreaterThan(0);
      expect(metrics.nsfr).toBeGreaterThan(0);
      expect(finalState.financial.capital.cet1).toBeGreaterThan(-200e9);
      expect(finalState.financial.balanceSheet.items.every((line) => Number.isFinite(line.balance))).toBe(true);
    });
  });

  it('a managed ten-year run remains a recognisable lending bank without runaway deposits or state', () => {
    const openingLoans = totalLoans(initialState);
    const openingCorporateLoans = productBalance(initialState, AssetProductType.CorporateLoans);
    const openingDeposits = totalCustomerDeposits(initialState);
    const finalState = runMonthsWithPolicy(120, {
      state: initialState,
      config: baseConfig,
      actionsForMonth: (state, monthIndex) =>
        managementPolicy(state, monthIndex, { corporateDiscount: 0.015 }),
    });
    const finalLoans = totalLoans(finalState);
    const finalCorporateLoans = productBalance(finalState, AssetProductType.CorporateLoans);
    const finalDeposits = totalCustomerDeposits(finalState);
    const loanDepositRatio = finalDeposits > 0 ? finalLoans / finalDeposits : 0;

    expect(finalState.status.hasFailed).toBe(false);
    expect(finalState.time.step).toBeGreaterThanOrEqual(initialState.time.step + 120);
    expect(finalLoans).toBeGreaterThan(openingLoans * 0.65);
    expect(finalLoans).toBeLessThan(openingLoans * 2);
    expect(finalCorporateLoans).toBeGreaterThan(openingCorporateLoans * 0.7);
    expect(finalCorporateLoans).toBeLessThan(openingCorporateLoans * 1.3);
    expect(finalDeposits).toBeGreaterThan(openingDeposits * 0.6);
    expect(finalDeposits).toBeLessThan(openingDeposits * 1.75);
    expect(loanDepositRatio).toBeGreaterThan(0.3);
    expect(totalLoanStateBuckets(finalState)).toBeLessThan(6000);
    expect(baseConfig.riskLimits.concentration.maxSingleSectorShare).toBe(1);
    expect(baseConfig.riskLimits.concentration.maxSingleGeographyShare).toBe(1);
  });

  it('competitive lending prices materially increase loan volumes', () => {
    const neutralFinal = runMonthsWithPolicy(60, {
      state: initialState,
      config: baseConfig,
      actionsForMonth: (state, monthIndex) =>
        managementPolicy(state, monthIndex, { mortgageDiscount: 0, corporateDiscount: 0 }),
    });
    const competitiveFinal = runMonthsWithPolicy(60, {
      state: initialState,
      config: baseConfig,
      actionsForMonth: (state, monthIndex) =>
        managementPolicy(state, monthIndex, { mortgageDiscount: 0.005, corporateDiscount: 0.0075 }),
    });

    expect(neutralFinal.status.hasFailed).toBe(false);
    expect(competitiveFinal.status.hasFailed).toBe(false);
    expect(totalLoans(competitiveFinal)).toBeGreaterThan(totalLoans(neutralFinal) * 1.04);
  });

  it('anti-exploit horizon score penalises low-deposit/high-loan carry strategy', () => {
    const pack = calibrationPacks.find((candidate) => candidate.id === 'exploit-carry');
    if (!pack) throw new Error('Missing exploit-carry calibration pack');

    const balancedFinal = runMonthsWithPolicy(120, {
      state: pack.initialState,
      config: pack.config,
      actionsForMonth: (state, monthIndex) => managementPolicy(state, monthIndex),
    });
    const exploitFinal = runMonthsWithPolicy(120, {
      state: pack.initialState,
      config: pack.config,
      actionsForMonth: (state) => {
        const competitorCorporate =
          state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate;
        return [
          {
            type: 'adjustRate',
            productType: LiabilityProductType.RetailTransactionalDeposits,
            newRate: Math.max(0, state.market.competitorRetailDepositRate - 0.02),
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.RetailSavingsDeposits,
            newRate: Math.max(0, state.market.competitorRetailDepositRate - 0.02),
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.CorporateOperatingDeposits,
            newRate: Math.max(0, competitorCorporate - 0.025),
          },
          {
            type: 'adjustRate',
            productType: LiabilityProductType.CorporateNonOperatingDeposits,
            newRate: Math.max(0, competitorCorporate - 0.025),
          },
          {
            type: 'adjustRate',
            productType: AssetProductType.Mortgages,
            newRate: state.market.competitorMortgageRate + 0.025,
          },
          {
            type: 'adjustRate',
            productType: AssetProductType.CorporateLoans,
            newRate: state.market.riskFreeLong + state.market.corporateLoanSpread + 0.03,
          },
        ];
      },
    });

    const goals = {
      horizonMonths: 120,
      objectives: [
        { label: 'CET1', metric: 'cet1Ratio' as const, direction: 'min' as const, target: 0.11, weight: 30 },
        { label: 'LCR', metric: 'lcr' as const, direction: 'min' as const, target: 1.05, weight: 25 },
        { label: 'NSFR', metric: 'nsfr' as const, direction: 'min' as const, target: 1.05, weight: 25 },
        { label: 'ROE', metric: 'roe' as const, direction: 'min' as const, target: 0.08, weight: 20 },
      ],
    };

    const balancedScore = evaluateScenarioGoals(balancedFinal, goals);
    const exploitScore = evaluateScenarioGoals(exploitFinal, goals);

    expect(exploitFinal.behaviour.depositFranchiseStrength).toBeLessThan(balancedFinal.behaviour.depositFranchiseStrength);
    expect(exploitScore.completionPct).toBeLessThan(balancedScore.completionPct);
  });
});