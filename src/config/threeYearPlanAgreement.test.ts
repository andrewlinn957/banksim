import { describe, expect, it } from 'vitest';
import { initialState } from './initialState';
import {
  createDefaultThreeYearPlan,
  createDefaultThreeYearPlanTargets,
  validateThreeYearPlanAgreement,
} from './threeYearPlan';
import { AssetProductType } from '../domain/enums';
import { THREE_YEAR_PLAN_METRICS as M } from '../engine/threeYearPlanMetrics';

const clone = () => structuredClone(initialState);

describe('Three-Year Plan board agreement', () => {
  it('accepts the calibrated board reference plan', () => {
    const state = clone();
    expect(validateThreeYearPlanAgreement(state, createDefaultThreeYearPlanTargets(state))).toEqual([]);
  });

  it('allows management to change emphasis while retaining balanced board accountability', () => {
    const state = clone();
    const weights: Record<string, number> = {
      [M.eps]: 20,
      [M.rote]: 20,
      [M.customerLending]: 20,
      [M.customerDeposits]: 10,
      [M.cet1]: 10,
      [M.lcr]: 10,
      [M.nsfr]: 10,
    };
    const proposal = createDefaultThreeYearPlanTargets(state).map(target => ({ ...target, weight: weights[target.metricId] }));
    expect(validateThreeYearPlanAgreement(state, proposal)).toEqual([]);
  });

  it('rejects trivial targets and concentration of almost all weight in an easy resilience metric', () => {
    const state = clone();
    const proposal = createDefaultThreeYearPlanTargets(state).map(target => ({
      ...target,
      weight: target.metricId === M.lcr ? 70 : 5,
      milestones: target.milestones.map(milestone => ({
        ...milestone,
        lower: target.metricId === M.eps || target.metricId === M.rote ? -1 : 0.01,
      })),
    }));
    const issues = validateThreeYearPlanAgreement(state, proposal);
    expect(issues.some(issue => issue.includes('Profitability measures'))).toBe(true);
    expect(issues.some(issue => issue.includes('Customer lending'))).toBe(true);
    expect(issues.some(issue => issue.includes('minimum ambition'))).toBe(true);
  });

  it('does not ratchet successor commercial targets down after management shrinks the bank', () => {
    const state = clone();
    state.threeYearPlan = createDefaultThreeYearPlan(state);
    const openingLending = state.threeYearPlan.targets.find(target => target.metricId === M.customerLending)!.baseline;
    const openingDeposits = state.threeYearPlan.targets.find(target => target.metricId === M.customerDeposits)!.baseline;
    for (const item of state.financial.balanceSheet.items) {
      if ([AssetProductType.Mortgages, AssetProductType.ConsumerLoans, AssetProductType.CorporateLoans].includes(item.productType as AssetProductType)) {
        item.balance *= 0.6;
      }
    }
    state.threeYearPlan.completed = true;
    const successor = createDefaultThreeYearPlanTargets(state);
    const lending = successor.find(target => target.metricId === M.customerLending)!;
    const deposits = successor.find(target => target.metricId === M.customerDeposits)!;

    expect(lending.baseline).toBeLessThan(openingLending * 0.7);
    expect(lending.milestones[2].lower).toBeCloseTo(openingLending * 0.97, 2);
    expect(deposits.milestones[2].lower).toBeCloseTo(openingDeposits * 0.95, 2);
  });
});
