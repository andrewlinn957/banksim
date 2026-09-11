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

    // Create a plausible retail-bank stress: reduced CET1 plus an encumbered liquidity portfolio.
    // Preserve the accounting identity by taking the capital reduction out of cash rather than
    // inventing a giant wholesale liability as the old universal-bank test did.
    const cash = line(stressed, AssetProductType.CashReserves);
    const gilts = line(stressed, AssetProductType.Gilts);
    if (!cash || !gilts) throw new Error('Missing liquidity lines for confidence-state test');
    const targetCet1 = 0.35e9;
    cash.balance += targetCet1 - stressed.financial.capital.cet1;
    stressed.financial.capital.cet1 = targetCet1;
    gilts.encumbrance.encumberedAmount = gilts.balance;
    gilts.encumbrance.remainingMonths = 12;

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
      actions: [{
        type: 'launchCapitalMarketsTransaction',
        instrument: 'senior',
        targetAmount: issueAmount,
        maxSpreadBps: 5000,
        tenorMonths: 36,
      }],
      shocks: [],
    });
    const issueFromTwo = engine.step({
      state: cloneBankState(afterTwo),
      config: baseConfig,
      actions: [{
        type: 'launchCapitalMarketsTransaction',
        instrument: 'senior',
        targetAmount: issueAmount,
        maxSpreadBps: 5000,
        tenorMonths: 36,
      }],
      shocks: [],
    });

    const executionOne = issueFromOne.executions.capitalMarkets[0];
    const executionTwo = issueFromTwo.executions.capitalMarkets[0];
    expect(executionTwo.executedAmount).toBeLessThanOrEqual(executionOne.executedAmount + 1e6);
    expect(executionTwo.clearingSpreadBps ?? 0).toBeGreaterThanOrEqual((executionOne.clearingSpreadBps ?? 0) - 1e-9);
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
    const ltFunding = line(recovering, LiabilityProductType.WholesaleFundingLT);
    if (!cash || !ltFunding) throw new Error('Missing lines for confidence-state recovery test');
    cash.balance = 120e9;
    ltFunding.balance = 12e9;

    const afterOne = engine.step({ state: recovering, config: baseConfig, actions: [], shocks: [] }).nextState;
    const afterTwo = engine.step({ state: afterOne, config: baseConfig, actions: [], shocks: [] }).nextState;
    const afterThree = engine.step({ state: afterTwo, config: baseConfig, actions: [], shocks: [] }).nextState;

    expect(afterOne.behaviour.fundingConfidenceState).toBe('watch');
    expect(afterTwo.behaviour.fundingConfidenceState).toBe('watch');
    expect(afterThree.behaviour.fundingConfidenceState).toBe('stable');
    expect(afterThree.behaviour.confidenceUpgradeProgressMonths ?? 0).toBe(0);
  });
});
