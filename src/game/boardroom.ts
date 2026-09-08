import { BankState } from '../domain/bankState';
import { ActionFormState } from '../components/ActionsPanel';

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
      issueEquityAmount: String(
        Math.ceil(Math.max(25e6, -s.risk.riskMetrics.internalCet1Headroom * s.risk.riskMetrics.rwa + 25e6))
      ),
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
        issueLTDebtAmount: String(Math.round(Math.max(50e6, s.risk.riskMetrics.fundingMaturing3m * .5))),
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
  return proposals;
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
