import { describe, expect, it } from 'vitest';
import { calibrationPacks } from '../config/calibration';
import { BankState } from '../domain/bankState';
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
  }
  return state;
};

const runMonthsWithPolicy = (
  months: number,
  args: {
    state: BankState;
    config: (typeof calibrationPacks)[number]['config'];
    actionsForMonth: (state: BankState, monthIndex: number) => Array<any>;
  }
) => {
  const engine = createSimulationEngine();
  let state = cloneBankState(args.state);
  for (let i = 0; i < months; i++) {
    const actions = args.actionsForMonth(state, i);
    state = engine.step({ state, config: args.config, actions, shocks: [] }).nextState;
  }
  return state;
};

const annualisedRoe = (state: BankState): number => {
  const equity =
    state.financial.capital.cet1 + state.financial.capital.at1 + state.financial.capital.accumulatedOCI;
  return equity > 0 ? (state.financial.incomeStatement.netIncome * 12) / equity : 0;
};

describe('Model regression harness', () => {
  it('archetype trajectories stay within configured KPI envelopes', () => {
    calibrationPacks.forEach((pack) => {
      const finalState = runMonths(24, { state: pack.initialState, config: pack.config });
      const roe = annualisedRoe(finalState);
      const metrics = finalState.risk.riskMetrics;

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

  it('anti-exploit horizon score penalises low-deposit/high-loan carry strategy', () => {
    const pack = calibrationPacks.find((candidate) => candidate.id === 'exploit-carry');
    if (!pack) throw new Error('Missing exploit-carry calibration pack');

    const balancedFinal = runMonths(120, { state: pack.initialState, config: pack.config });
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
