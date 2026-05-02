import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { FundingConfidenceState } from '../domain/risks';
import { cloneBankState } from './clone';
import { createSimulationEngine } from './simulation';

const rank = (state: FundingConfidenceState): number => {
  if (state === 'strong') return 0;
  if (state === 'stable') return 1;
  if (state === 'watch') return 2;
  return 3;
};

const line = (state: typeof initialState, productType: LiabilityProductType | AssetProductType) =>
  state.financial.balanceSheet.items.find((item) => item.productType === productType);

describe('Confidence state machine', () => {
  it('applies stepwise confidence downgrades and tighter funding terms as confidence weakens', () => {
    const engine = createSimulationEngine();
    const stressed = cloneBankState(initialState);
    stressed.behaviour.fundingConfidenceState = 'strong';
    stressed.behaviour.depositFranchiseStrength = 0.3;
    stressed.behaviour.reputation = 0.35;
    stressed.financial.capital.cet1 = 30e9;
    const cash = line(stressed, AssetProductType.CashReserves);
    const stFunding = line(stressed, LiabilityProductType.WholesaleFundingST);
    if (!cash || !stFunding) throw new Error('Missing lines for confidence-state test');
    cash.balance = 4e9;
    stFunding.balance = 120e9;

    const afterOne = engine.step({ state: stressed, config: baseConfig, actions: [], shocks: [] }).nextState;
    const afterTwo = engine.step({ state: afterOne, config: baseConfig, actions: [], shocks: [] }).nextState;

    expect(rank(afterOne.behaviour.fundingConfidenceState ?? 'stable')).toBeGreaterThan(rank('strong'));
    expect(rank(afterTwo.behaviour.fundingConfidenceState ?? 'stable')).toBeGreaterThanOrEqual(
      rank(afterOne.behaviour.fundingConfidenceState ?? 'stable')
    );

    const issueAmount = 10e9;
    const issueFromOne = engine.step({
      state: cloneBankState(afterOne),
      config: baseConfig,
      actions: [{ type: 'issueDebt', productType: LiabilityProductType.WholesaleFundingLT, amount: issueAmount }],
      shocks: [],
    }).nextState;
    const issueFromTwo = engine.step({
      state: cloneBankState(afterTwo),
      config: baseConfig,
      actions: [{ type: 'issueDebt', productType: LiabilityProductType.WholesaleFundingLT, amount: issueAmount }],
      shocks: [],
    }).nextState;

    const beforeOneLt = line(afterOne, LiabilityProductType.WholesaleFundingLT)?.balance ?? 0;
    const beforeTwoLt = line(afterTwo, LiabilityProductType.WholesaleFundingLT)?.balance ?? 0;
    const deltaOne = (line(issueFromOne, LiabilityProductType.WholesaleFundingLT)?.balance ?? 0) - beforeOneLt;
    const deltaTwo = (line(issueFromTwo, LiabilityProductType.WholesaleFundingLT)?.balance ?? 0) - beforeTwoLt;
    const rateOne = line(issueFromOne, LiabilityProductType.WholesaleFundingLT)?.interestRate ?? 0;
    const rateTwo = line(issueFromTwo, LiabilityProductType.WholesaleFundingLT)?.interestRate ?? 0;

    expect(deltaTwo).toBeLessThanOrEqual(deltaOne + 1e6);
    expect(rateTwo).toBeGreaterThanOrEqual(rateOne - 1e-9);
  });

  it('requires sustained improvement before upgrading confidence state', () => {
    const engine = createSimulationEngine();
    const recovering = cloneBankState(initialState);
    recovering.behaviour.fundingConfidenceState = 'watch';
    recovering.behaviour.confidenceUpgradeProgressMonths = 0;
    recovering.behaviour.depositFranchiseStrength = 0.96;
    recovering.behaviour.reputation = 0.96;
    recovering.financial.capital.cet1 = 65e9;
    const cash = line(recovering, AssetProductType.CashReserves);
    const stFunding = line(recovering, LiabilityProductType.WholesaleFundingST);
    if (!cash || !stFunding) throw new Error('Missing lines for confidence-state recovery test');
    cash.balance = 120e9;
    stFunding.balance = 12e9;

    const afterOne = engine.step({ state: recovering, config: baseConfig, actions: [], shocks: [] }).nextState;
    const afterTwo = engine.step({ state: afterOne, config: baseConfig, actions: [], shocks: [] }).nextState;
    const afterThree = engine.step({ state: afterTwo, config: baseConfig, actions: [], shocks: [] }).nextState;

    expect(afterOne.behaviour.fundingConfidenceState).toBe('watch');
    expect(afterTwo.behaviour.fundingConfidenceState).toBe('watch');
    expect(afterThree.behaviour.fundingConfidenceState).toBe('stable');
    expect(afterThree.behaviour.confidenceUpgradeProgressMonths ?? 0).toBe(0);
  });
});

