import { PlayerAction } from '../domain/actions';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { AssetProductType, LiabilityProductType } from '../domain/enums';
import { createSimulationEngine } from './simulation';

type Confidence = 'high' | 'medium' | 'low';

export interface Recommendation {
  id: string;
  title: string;
  rationale: string;
  caveat: string;
  confidence: Confidence;
  actions: PlayerAction[];
  projected: {
    cet1RatioDelta: number;
    lcrDelta: number;
    nsfrDelta: number;
    netIncomeDelta: number;
    boardPressureDelta: number;
  };
  score: number;
}

interface RecommendationCandidate {
  id: string;
  title: string;
  rationale: string;
  caveat: string;
  actions: PlayerAction[];
}

const complianceHardBreach = (state: BankState): boolean =>
  state.status.hasFailed ||
  state.risk.compliance.cet1Breached ||
  state.risk.compliance.leverageBreached ||
  state.risk.compliance.lcrBreached ||
  state.risk.compliance.nsfrBreached;

const deficit = (value: number, floor: number): number => Math.max(0, floor - value);

const recommendationConfidence = (score: number): Confidence => {
  if (score >= 0.06) return 'high';
  if (score >= 0.02) return 'medium';
  return 'low';
};

const candidateSet = (state: BankState, config: SimulationConfig): RecommendationCandidate[] => {
  const candidates: RecommendationCandidate[] = [];
  const metrics = state.risk.riskMetrics;
  const policy = state.behaviour.capitalPolicy ?? {
    dividendPayoutRatio: config.riskLimits.capitalPolicy.defaultDividendPayoutRatio,
    at1CouponMode: 'auto' as const,
  };

  if (metrics.cet1Headroom < 0.015) {
    candidates.push({
      id: 'raise-equity',
      title: 'Raise fresh equity',
      rationale: 'Direct CET1 uplift creates immediate headroom over requirements.',
      caveat: 'Dilution pressure and weaker ROE in the short run.',
      actions: [{ type: 'issueEquity', amount: 2e9 }],
    });
  }

  if (metrics.lcr < 1.15 || metrics.nsfr < 1.05) {
    candidates.push({
      id: 'term-out-funding',
      title: 'Issue long-term wholesale debt',
      rationale: 'Terming out funding supports NSFR and rollover resilience.',
      caveat: 'Funding cost rises and can compress NIM.',
      actions: [
        {
          type: 'issueDebt',
          productType: LiabilityProductType.WholesaleFundingLT,
          amount: 5e9,
          maturityMonths: 36,
        },
      ],
    });
  }

  if (metrics.mdaTriggered || policy.dividendPayoutRatio > 0.1) {
    candidates.push({
      id: 'cut-payouts',
      title: 'Reduce distribution policy',
      rationale: 'Retained earnings rebuild CET1 and reduce MDA risk.',
      caveat: 'Lower payout may increase board pressure from investors.',
      actions: [
        {
          type: 'setCapitalPolicy',
          dividendPayoutRatio: 0.05,
          at1CouponMode: 'auto',
        },
      ],
    });
  }

  if (metrics.sectorConcentration > config.riskLimits.concentration.maxSingleSectorShare * 0.9) {
    const currentTightness = state.behaviour.underwritingTightness?.[AssetProductType.CorporateLoans] ?? 0;
    candidates.push({
      id: 'tighten-corporate-underwriting',
      title: 'Tighten corporate underwriting',
      rationale: 'Slows concentration build-up and lowers future credit stress sensitivity.',
      caveat: 'Origination volumes and fee income can soften.',
      actions: [
        {
          type: 'setUnderwriting',
          productType: AssetProductType.CorporateLoans,
          tightness: Math.min(1, currentTightness + 0.2),
        },
      ],
    });
  }

  if (Math.abs(metrics.niiSensitivity100bp) > 0.5e9) {
    const direction =
      metrics.niiSensitivity100bp > 0 ? 'receiveFixedPayFloat' : 'payFixedReceiveFloat';
    candidates.push({
      id: 'hedge-rates',
      title: 'Add IRRBB hedge',
      rationale: 'Offsets NII sensitivity and reduces rate-risk volatility.',
      caveat: 'Carry cost can drag earnings if the rate path is benign.',
      actions: [
        {
          type: 'enterHedge',
          direction,
          notional: 10e9,
          fixedRate: state.market.riskFreeLong,
          maturityMonths: 24,
        },
      ],
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      id: 'retain-earnings-baseline',
      title: 'Trim payout modestly',
      rationale: 'Builds incremental resilience while preserving strategy flexibility.',
      caveat: 'Lower distributions can weigh on shareholder sentiment.',
      actions: [
        {
          type: 'setCapitalPolicy',
          dividendPayoutRatio: Math.max(0, policy.dividendPayoutRatio - 0.1),
          at1CouponMode: policy.at1CouponMode,
        },
      ],
    });
  }

  return candidates;
};

export const buildRecommendations = (state: BankState, config: SimulationConfig): Recommendation[] => {
  const engine = createSimulationEngine();
  const candidates = candidateSet(state, config);
  if (candidates.length === 0) return [];

  const limits = config.riskLimits;
  const baseline = state.risk.riskMetrics;
  const baseDeficitCet1 = deficit(baseline.cet1Ratio, limits.minCet1Ratio);
  const baseDeficitLcr = deficit(baseline.lcr, limits.minLcr);
  const baseDeficitNsfr = deficit(baseline.nsfr, limits.minNsfr);

  const ranked = candidates
    .map((candidate) => {
      const projectedState = engine.step({
        state,
        config,
        actions: candidate.actions,
        shocks: [],
      }).nextState;
      if (complianceHardBreach(projectedState)) return null;

      const after = projectedState.risk.riskMetrics;
      const projected = {
        cet1RatioDelta: after.cet1Ratio - baseline.cet1Ratio,
        lcrDelta: after.lcr - baseline.lcr,
        nsfrDelta: after.nsfr - baseline.nsfr,
        netIncomeDelta:
          projectedState.financial.incomeStatement.netIncome - state.financial.incomeStatement.netIncome,
        boardPressureDelta: after.boardPressureScore - baseline.boardPressureScore,
      };

      const improvementCet1 = baseDeficitCet1 - deficit(after.cet1Ratio, limits.minCet1Ratio);
      const improvementLcr = baseDeficitLcr - deficit(after.lcr, limits.minLcr);
      const improvementNsfr = baseDeficitNsfr - deficit(after.nsfr, limits.minNsfr);
      const boardBenefit = Math.max(0, -projected.boardPressureDelta) / 100;
      const earningsPenalty = Math.max(0, -projected.netIncomeDelta) / 1e9;

      const score =
        improvementCet1 * 4 +
        improvementLcr * 3 +
        improvementNsfr * 3 +
        boardBenefit * 0.5 -
        earningsPenalty * 0.15;

      return {
        id: candidate.id,
        title: candidate.title,
        rationale: candidate.rationale,
        caveat: candidate.caveat,
        actions: candidate.actions,
        projected,
        score,
        confidence: recommendationConfidence(score),
      } satisfies Recommendation;
    })
    .filter((candidate): candidate is Recommendation => candidate !== null)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, 3);
};
