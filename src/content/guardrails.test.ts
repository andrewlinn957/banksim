import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { cloneBankState } from '../engine/clone';
import { buildPreRunGuardrails } from './guardrails';

describe('buildPreRunGuardrails', () => {
  it('flags stress near-breach and payout clipping conditions', () => {
    const state = cloneBankState(initialState);
    state.risk.riskMetrics.maxPayoutRatio = 0.1;
    state.risk.riskMetrics.payoutBlockedByInternalTarget = true;

    const guardrails = buildPreRunGuardrails({
      state,
      config: baseConfig,
      parsedValues: { dividendPayoutRatio: 0.35 },
      hasValidationErrors: false,
      preview: {
        stressedCet1Ratio: baseConfig.riskLimits.minCet1Ratio * 0.98,
        stressedLcr: baseConfig.riskLimits.minLcr * 1.01,
        stressedNsfr: baseConfig.riskLimits.minNsfr * 1.02,
        breachProbability: 0.33,
      },
    });

    const ids = new Set(guardrails.map((item) => item.id));
    expect(ids.has('stress-near-breach')).toBe(true);
    expect(ids.has('payout-clipped')).toBe(true);
  });

  it('flags rollover wall and adverse selection setup', () => {
    const state = cloneBankState(initialState);
    state.risk.riskMetrics.fundingConfidenceState = 'watch';
    state.risk.riskMetrics.hqla = 55e9;
    state.risk.riskMetrics.fundingMaturing3m = 60e9;

    const corporateReference = state.market.baseRate + state.market.corporateLoanSpread;
    const guardrails = buildPreRunGuardrails({
      state,
      config: baseConfig,
      parsedValues: {
        corporateLoanRate: corporateReference + 0.02,
        corporateUnderwritingTightness: 0.1,
      },
      hasValidationErrors: false,
    });

    const ids = new Set(guardrails.map((item) => item.id));
    expect(ids.has('rollover-wall-confidence')).toBe(true);
    expect(ids.has('adverse-selection-risk')).toBe(true);
  });

  it('returns no guardrails while validation errors are unresolved', () => {
    const guardrails = buildPreRunGuardrails({
      state: cloneBankState(initialState),
      config: baseConfig,
      parsedValues: { retailDepositRate: 0.01 },
      hasValidationErrors: true,
    });
    expect(guardrails).toHaveLength(0);
  });
});
