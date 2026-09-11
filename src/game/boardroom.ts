import { BankState } from '../domain/bankState';
import { ActionFormState } from '../components/ActionsPanel';
import { evaluateThreeYearPlan } from '../engine/threeYearPlan';
import { bankThreeYearPlanMetricRegistry, THREE_YEAR_PLAN_METRICS } from '../engine/threeYearPlanMetrics';

export interface BoardDecision {
  id: string;
  title: string;
  voice: string;
  pitch: string;
  benefit: string;
  tradeoff: string;
  changes: Partial<ActionFormState>;
}

const rate = (r: number) => `${(Math.max(0, r) * 100).toFixed(2)}%`;

interface PlanFocus {
  score: number;
  metricId: string;
  metricLabel: string;
  drag: number;
  proposalId?: string;
}

const planFocus = (state: BankState): PlanFocus | null => {
  const plan = state.threeYearPlan;
  if (!plan?.enabled || plan.completed) return null;
  const month = Math.min(plan.horizonMonths, Math.max(0, state.time.step - plan.startStep));
  const evaluation = evaluateThreeYearPlan({
    state,
    month,
    targets: plan.targets,
    registry: bankThreeYearPlanMetricRegistry,
  });
  const totalWeight = evaluation.metrics.reduce((sum, metric) => sum + Math.max(0, metric.weight), 0);
  const ranked = evaluation.metrics
    .map((metric) => ({
      metric,
      drag: totalWeight > 0 ? (100 - metric.score) * Math.max(0, metric.weight) / totalWeight : 0,
    }))
    .sort((a, b) => b.drag - a.drag);
  const top = ranked[0];
  if (!top || top.drag <= 0.05) return null;
  const proposalId =
    top.metric.metricId === THREE_YEAR_PLAN_METRICS.customerDeposits
      ? 'savers'
      : top.metric.metricId === THREE_YEAR_PLAN_METRICS.customerLending
        ? 'growth'
        : top.metric.metricId === THREE_YEAR_PLAN_METRICS.lcr || top.metric.metricId === THREE_YEAR_PLAN_METRICS.nsfr
          ? 'funding'
          : undefined;
  return {
    score: evaluation.score,
    metricId: top.metric.metricId,
    metricLabel: bankThreeYearPlanMetricRegistry.get(top.metric.metricId).label,
    drag: top.drag,
    proposalId,
  };
};

const prioritiseForPlan = (state: BankState, proposals: BoardDecision[]): BoardDecision[] => {
  const focus = planFocus(state);
  if (!focus?.proposalId) return proposals;
  const priority = proposals.find((proposal) => proposal.id === focus.proposalId);
  return priority ? [priority, ...proposals.filter((proposal) => proposal.id !== priority.id)] : proposals;
};

export const boardDecisions = (s: BankState): BoardDecision[] => {
  const m = s.market;
  const capitalTight = s.risk.riskMetrics.internalCet1Headroom < 0;
  const recovery: BoardDecision = {
    id: 'capital',
    voice: 'Finance director',
    title: 'Bring in fresh capital',
    pitch: 'Debt cannot repair a capital shortfall. Ask shareholders to fund the recovery.',
    benefit: 'Restore capacity to absorb losses',
    tradeoff: 'Existing shareholders are diluted; issuance carries a fee',
    changes: {
      capitalMarketsInstrument: 'cet1',
      capitalMarketsTargetAmount: String(
        Math.ceil(Math.max(25e6, -s.risk.riskMetrics.internalCet1Headroom * s.risk.riskMetrics.rwa + 25e6))
      ),
      capitalMarketsMaxDiscount: '20%',
      dividendPayoutRatio: '0',
    },
  };

  const proposals: BoardDecision[] = [
    {
      id: 'savers',
      voice: 'Head of retail',
      title: 'Win back savers',
      pitch: 'Give customers a reason to stay. Offer a little more than the competition.',
      benefit: 'Protect deposits and the franchise',
      tradeoff: 'Higher interest expense squeezes the margin',
      changes: {
        retailCurrentAccountRate: rate(m.competitorRetailCurrentAccountRate + .0025),
        corporateDepositRate: rate((m.competitorCorporateDepositRate ?? m.competitorRetailCurrentAccountRate) + .002),
      },
    },
    {
      id: 'growth',
      voice: 'Commercial director',
      title: 'Go after new business',
      pitch: 'Price new loans keenly and open the door to more borrowers.',
      benefit: 'Build the lending pipeline',
      tradeoff: 'More capital use and risk in the next vintage',
      changes: {
        mortgageRate: rate(m.competitorMortgageRate - .0025),
        corporateLoanRate: rate(m.riskFreeLong + m.corporateLoanSpread - .002),
        mortgageUnderwritingTightness: '.15',
        corporateUnderwritingTightness: '.15',
      },
    },
    {
      id: 'quality',
      voice: 'Chief risk officer',
      title: 'Be choosy on credit',
      pitch: 'Ask for a better margin and tighten approval standards.',
      benefit: 'Improve the quality of new lending',
      tradeoff: 'Fewer approvals; old loans retain their risk',
      changes: {
        mortgageRate: rate(m.competitorMortgageRate + .0015),
        corporateLoanRate: rate(m.riskFreeLong + m.corporateLoanSpread + .002),
        mortgageUnderwritingTightness: '.75',
        corporateUnderwritingTightness: '.75',
      },
    },
    {
      id: 'funding',
      voice: 'Treasurer',
      title: 'Buy breathing room',
      pitch: 'Raise term funding and keep this month’s earnings in the bank.',
      benefit: 'More cash and stable funding',
      tradeoff: 'An interest bill for years; debt is not capital',
      changes: {
        capitalMarketsInstrument: 'senior',
        capitalMarketsTargetAmount: String(Math.round(Math.max(50e6, s.risk.riskMetrics.fundingMaturing3m * .5))),
        capitalMarketsMaxSpreadBps: '750',
        capitalMarketsTenorMonths: '36',
        dividendPayoutRatio: '0',
      },
    },
  ];

  if (capitalTight) return [recovery, ...proposals.filter((proposal) => proposal.id !== 'growth')];

  const tier1 = s.financial.capital.cet1 + s.financial.capital.at1 + s.financial.capital.accumulatedOCI;
  if (
    Math.abs(s.risk.riskMetrics.eveSensitivity100bp) > tier1 * .15 &&
    s.risk.riskMetrics.lcr > 1.2 &&
    s.risk.riskMetrics.nsfr > 1.1
  ) {
    const direction = s.risk.riskMetrics.niiSensitivity100bp > 0
      ? 'receiveFixedPayFloat'
      : 'payFixedReceiveFloat';
    proposals[3] = {
      id: 'hedge',
      voice: 'Treasurer',
      title: 'Take some rate risk off',
      pitch: 'Trade some upside for less exposure to the next interest-rate move.',
      benefit: 'Offset part of the bank’s interest-rate sensitivity',
      tradeoff: 'Carry costs and fair-value changes still hit earnings',
      changes: {
        hedgeDirection: direction,
        hedgeNotional: String(
          Math.round(
            Math.min(
              Math.abs(s.risk.riskMetrics.niiSensitivity100bp) / .01,
              s.risk.riskMetrics.leverageExposure * .1
            )
          )
        ),
        hedgeMaturityMonths: '24',
      },
    };
  }
  return prioritiseForPlan(s, proposals);
};

export const monthlyBrief = (s: BankState) => {
  if (s.risk.riskMetrics.lcr < 1 || s.risk.riskMetrics.nsfr < 1) {
    return {
      title: 'Time to restore the buffer.',
      detail: 'Protect deposits and refinance before a ratio shortfall becomes a cash problem.',
      focus: 'Liquidity recovery',
    };
  }
  if (s.risk.riskMetrics.praBufferBreached && !s.risk.riskMetrics.mdaTriggered) {
    return {
      title: 'The supervisor wants a recovery plan.',
      detail: 'Your PRA buffer is being used. Rebuild headroom through earnings, less risk or new equity. Buffer use alone does not end the game.',
      focus: 'Capital recovery',
    };
  }
  const plan = planFocus(s);
  if (plan) {
    return {
      title: `${plan.metricLabel} is furthest behind plan.`,
      detail: `Live plan score ${plan.score.toFixed(0)}/100. This measure is the largest weighted drag (${plan.drag.toFixed(1)} points). Board Confidence changes only at the next formal quarterly review.`,
      focus: 'Three-Year Plan',
    };
  }
  if (s.time.step === 0) {
    return {
      title: 'Your first year in the chair.',
      detail: 'Build shareholder value, earn consistently and keep your customers. Every month, weigh the proposals, set your terms and close the books.',
      focus: '12-month mandate',
    };
  }
  if (s.market.gdpGrowthMoM < 0) {
    return {
      title: 'The economy is losing ground.',
      detail: 'New business still matters, but this vintage could prove expensive. Watch credit quality and the provision charge.',
      focus: 'Credit quality',
    };
  }
  if (s.behaviour.depositFranchiseStrength < .68) {
    return {
      title: 'Your customers have other options.',
      detail: 'Cheap deposits are only cheap while they stay. A better offer can slow the erosion, at a cost to earnings.',
      focus: 'Customer retention',
    };
  }
  return {
    title: 'What will you back this month?',
    detail: 'Decide whether the next pound should support growth, better funding or stronger margins. Your choices carry into future months.',
    focus: 'Commercial judgement',
  };
};
