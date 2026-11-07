import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import type { LoanCohort } from '../domain/loanCohorts';
import { cloneBankState } from './clone';
import { creditStageDiagnostics } from './creditStageDiagnostics';
import { cohortEcl } from './impairment';
import { generateSeasonedLoanCohorts, remainingLifetimeDefaultRisk, stepLoanCohorts, updateCohortStage, upsertOriginationCohort } from './loanCohorts';
import { createSimulationEngine } from './simulation';

const product = AssetProductType.Mortgages;
const borrower = (): LoanCohort => ({
  productType: product, cohortId: 1, originalPrincipal: 1e6, outstandingPrincipal: 1e6,
  annualInterestRate: .05, annualPd: .01, sicrReferenceAnnualPd: .01, effectiveAnnualPd: .02,
  lgd: .4, ageMonths: 0, termMonths: 120, stage: 'stage1', affordabilityIndex: 1,
});

describe('SICR across seasoning, deterioration, renewal and cure', () => {
  it('derives a mixed opening stage distribution from reproducible risk histories, without a Stage 2 quota', () => {
    const args = { productType: product, targetOutstanding: 7.2e9, baseAnnualInterestRate: .05, baseAnnualPd: .01, baseLgd: .25, config: baseConfig, seed: 1234 };
    const cohorts = generateSeasonedLoanCohorts(args);
    expect(cohorts).toEqual(generateSeasonedLoanCohorts(args));
    expect(cohorts.some(c => c.stage === 'stage1')).toBe(true);
    expect(cohorts.some(c => c.stage === 'stage2')).toBe(true);
    for (const c of cohorts.filter(c => c.stage === 'stage2')) {
      const remainingMonths = Math.max(1, c.termMonths - c.ageMonths);
      const reference = remainingLifetimeDefaultRisk(c.sicrReferenceAnnualPd!, remainingMonths);
      const current = remainingLifetimeDefaultRisk(c.effectiveAnnualPd!, remainingMonths);
      const increase = current - reference;
      const ratio = current / Math.max(1e-9, reference);
      expect(
        (ratio >= baseConfig.behaviour.ifrs9!.sicrPdMultiplierThreshold &&
          increase >= baseConfig.behaviour.ifrs9!.sicrMinLifetimeRiskIncrease!) ||
        increase >= baseConfig.behaviour.ifrs9!.sicrAbsoluteLifetimeRiskIncrease!
      ).toBe(true);
    }
    const noDispersion = structuredClone(baseConfig);
    noDispersion.behaviour.ifrs9!.initialAffordabilityLogSd = 0;
    expect(generateSeasonedLoanCohorts({ ...args, config: noDispersion }).every(c => c.stage === 'stage1')).toBe(true);
  });

  it('ignores small low-PD multiples but catches material relative and absolute lifetime risk increases', () => {
    const lowRisk = borrower();
    lowRisk.annualPd = .001;
    lowRisk.sicrReferenceAnnualPd = .001;
    lowRisk.effectiveAnnualPd = .0018;
    expect(updateCohortStage(lowRisk, baseConfig)).toBe('stage1');

    lowRisk.effectiveAnnualPd = .0022;
    expect(updateCohortStage(lowRisk, baseConfig)).toBe('stage2');

    const absoluteDeterioration = borrower();
    absoluteDeterioration.annualPd = .05;
    absoluteDeterioration.sicrReferenceAnnualPd = .05;
    absoluteDeterioration.effectiveAnnualPd = .07;
    expect(updateCohortStage(absoluteDeterioration, baseConfig)).toBe('stage2');
  });

  it('anchors a new loan to the risk conditions present at origination', () => {
    const state = cloneBankState(initialState);
    const cohortId = 999_999;
    const funded = upsertOriginationCohort({
      state, config: baseConfig, productType: product, cohortId,
      principal: 1_000_000, annualInterestRate: .05, annualPd: .005, lgd: .25,
    });
    expect(funded).toBe(1_000_000);

    stepLoanCohorts({ state, config: baseConfig, dtMonths: 1, pdMultiplier: 2, lgdMultiplier: 1 });
    const originated = state.loanCohorts[product]!.find(c => c.cohortId === cohortId);
    expect(originated).toBeTruthy();
    expect(originated?.sicrReferenceAnnualPd).toBeCloseTo(originated?.effectiveAnnualPd ?? 0, 10);
    expect(originated?.stage).toBe('stage1');
  });

  it('retains a visible Stage 2 portfolio over the first six monthly closes and reconciles gross stage exposures', () => {
    const engine = createSimulationEngine();
    let state = cloneBankState(initialState);
    for (let month = 0; month < 6; month++) {
      state = engine.step({ state, config: baseConfig, actions: [], shocks: [] }).nextState;
      expect(state.financial.provisionStock.stage2).toBeGreaterThan(0);
      const d = creditStageDiagnostics(state);
      const ledgerGross = Object.values(state.loanCohorts).flat().reduce((n, c) => n + c.outstandingPrincipal, 0)
        + Object.values(state.workoutPipelines ?? {}).flat().reduce((n, b) => n + b.defaultedPrincipal, 0);
      expect(d.stageGross.stage1 + d.stageGross.stage2 + d.stageGross.stage3).toBeCloseTo(ledgerGross, 4);
    }
  });

  it('requires three consecutive improved closes to cure and resets probation on relapse', () => {
    const c = borrower();
    c.stage = updateCohortStage(c, baseConfig);
    expect(c.stage).toBe('stage2');
    c.effectiveAnnualPd = .01;
    c.stage = updateCohortStage(c, baseConfig);
    expect(c.stage).toBe('stage2');
    c.effectiveAnnualPd = .015;
    c.stage = updateCohortStage(c, baseConfig);
    expect(c.sicrCureMonths).toBe(0);
    c.effectiveAnnualPd = .01;
    for (let month = 1; month <= 3; month++) {
      c.stage = updateCohortStage(c, baseConfig);
      expect(c.stage).toBe(month < 3 ? 'stage2' : 'stage1');
    }
  });

  it('anchors performing renewals to newly screened risk while retaining the old loan history', () => {
    const state = cloneBankState(initialState);
    const c = { ...borrower(), ageMonths: 115, stage: 'stage2' as const, affordabilityIndex: 2.5 };
    state.loanCohorts = { [product]: [c] };
    stepLoanCohorts({ state, config: baseConfig, dtMonths: 1, pdMultiplier: 1, lgdMultiplier: 1 });
    const renewed = state.loanCohorts[product]!.filter(c => c.renewalCount === 1);
    expect(renewed.length).toBeGreaterThan(0);
    for (const r of renewed) {
      expect(r.stage).toBe('stage1');
      expect(r.sicrReferenceAnnualPd).toBeCloseTo(r.effectiveAnnualPd ?? 0, 12);
      expect(r.effectiveAnnualPd).toBeGreaterThan(.01);
    }
    expect(c.sicrReferenceAnnualPd).toBe(.01);
  });

  it('does not renew credit-impaired, unlikely-to-pay or more-than-30-days-past-due loans', () => {
    for (const c of [
      { ...borrower(), ageMonths: 115, stage: 'stage3' as const },
      { ...borrower(), ageMonths: 115, unlikelyToPay: true },
      { ...borrower(), ageMonths: 115, daysPastDue: 31 },
    ]) {
      const state = cloneBankState(initialState);
      state.loanCohorts = { [product]: [c] };
      stepLoanCohorts({ state, config: baseConfig, dtMonths: 1, pdMultiplier: 1, lgdMultiplier: 1 });
      expect((state.loanCohorts[product] ?? []).some(r => r.renewalCount === 1)).toBe(false);
    }
  });

  it('uses amortising lifetime shortfalls for Stage 2 and a twelve-month horizon for Stage 1', () => {
    const c = borrower();
    const stage1 = cohortEcl(c, baseConfig);
    expect(cohortEcl({ ...c, stage: 'stage2' }, baseConfig)).toBeGreaterThan(stage1);
    expect(cohortEcl({ ...c, termMonths: 12, stage: 'stage2' }, baseConfig)).toBeCloseTo(cohortEcl({ ...c, termMonths: 12 }, baseConfig), 8);
    expect(cohortEcl({ ...c, termMonths: 60, stage: 'stage2' }, baseConfig)).toBeLessThan(cohortEcl({ ...c, stage: 'stage2' }, baseConfig));
  });
});
