import { AttributionLineSelection } from '../domain/attribution';

export interface AttributionMechanicExplanation {
  title: string;
  mechanismPath: string;
  whyItMoved: string;
  mitigation: string;
  helpSectionId: string;
}

const suffixFromLineId = (lineId: string): string => {
  const idx = lineId.indexOf('-');
  if (idx < 0 || idx + 1 >= lineId.length) return lineId;
  return lineId.slice(idx + 1);
};

export const getAttributionMechanicExplanation = (
  selection: AttributionLineSelection
): AttributionMechanicExplanation => {
  const suffix = suffixFromLineId(selection.lineId);
  const key = `${selection.metric}:${suffix}`;

  if (key === 'cet1Ratio:capital') {
    return {
      title: 'Capital stack transmission',
      mechanismPath:
        'Net income, provisions, dividends/coupons, and OCI revaluation flow into adjusted CET1, then into CET1 ratio.',
      whyItMoved:
        'Capital-side balance changes altered the numerator faster than risk-weighted assets changed.',
      mitigation:
        'Retain earnings, reduce distributions, or raise equity while preserving loss-absorbing buffers.',
      helpSectionId: 'capital-policy-and-distributions',
    };
  }
  if (key === 'cet1Ratio:rwa') {
    return {
      title: 'RWA denominator pressure',
      mechanismPath: 'Loan and asset mix changes move RWA, which directly scales CET1 ratio.',
      whyItMoved: 'Risk-weighted asset growth/shift diluted capital efficiency per unit of CET1.',
      mitigation: 'Slow high-RW growth, rebalance mix, or add CET1 to maintain headroom.',
      helpSectionId: 'risk-metrics-and-compliance',
    };
  }
  if (key === 'cet1Ratio:selection') {
    return {
      title: 'Selection pressure and credit quality',
      mechanismPath:
        'New-vintage risk quality and renewal mix affect provisions and losses, then feed through CET1 and ratios.',
      whyItMoved: 'Pipeline quality likely deteriorated relative to pricing/underwriting stance.',
      mitigation: 'Tighten underwriting and recalibrate pricing to improve incoming cohort quality.',
      helpSectionId: 'loan-cohorts-and-ifrs9',
    };
  }
  if (key === 'lcr:hqla') {
    return {
      title: 'HQLA stock effect',
      mechanismPath: 'Eligible unencumbered liquid assets determine the LCR numerator.',
      whyItMoved: 'Changes in liquid-asset stock or encumbrance altered available HQLA.',
      mitigation: 'Rebuild high-quality liquid assets or reduce encumbrance intensity.',
      helpSectionId: 'liquidity-ratios',
    };
  }
  if (key === 'lcr:outflows') {
    return {
      title: 'Net outflow dynamics',
      mechanismPath:
        'Deposit and funding runoff assumptions set stressed outflows/inflows, which determine LCR denominator.',
      whyItMoved: 'Behavioral runoff and funding conditions moved stressed net outflows.',
      mitigation: 'Improve deposit resilience and term out vulnerable funding maturities.',
      helpSectionId: 'deposit-behaviour',
    };
  }
  if (key === 'nsfr:asf') {
    return {
      title: 'Available stable funding (ASF)',
      mechanismPath: 'Funding mix and capital legs determine ASF contribution in the NSFR numerator.',
      whyItMoved: 'Shifts in stable liabilities/capital changed one-year funding durability.',
      mitigation: 'Issue longer tenor liabilities and preserve capital retention.',
      helpSectionId: 'funding-ladder-and-rollover',
    };
  }
  if (key === 'nsfr:rsf') {
    return {
      title: 'Required stable funding (RSF)',
      mechanismPath: 'Asset mix and liquidity factors determine RSF demand in the NSFR denominator.',
      whyItMoved: 'Balance-sheet asset composition required more or less stable funding support.',
      mitigation: 'Slow unstable asset growth or rebalance into lower RSF intensity exposures.',
      helpSectionId: 'liquidity-ratios',
    };
  }
  if (key === 'nim:nii') {
    return {
      title: 'Net interest income transmission',
      mechanismPath: 'Pricing, funding spread, and hedge carry shape monthly NII which drives NIM.',
      whyItMoved: 'Earnings on assets versus liabilities/hedges shifted within the step.',
      mitigation: 'Adjust pricing and hedges to protect margin while avoiding franchise/credit deterioration.',
      helpSectionId: 'actions-pricing-and-underwriting',
    };
  }
  if (key === 'nim:assets') {
    return {
      title: 'Earning-asset base effect',
      mechanismPath: 'NIM is NII over earning assets, so denominator expansion/compression changes the ratio.',
      whyItMoved: 'Asset base moved faster than interest income accrual.',
      mitigation: 'Balance growth pace and pricing to avoid denominator dilution.',
      helpSectionId: 'loan-pipeline',
    };
  }
  if (key === 'nim:creditmix') {
    return {
      title: 'Refinance and credit-mix effect',
      mechanismPath:
        'Prepay/renewal/workout mix changes realized credit drag and effective yield composition for NIM.',
      whyItMoved: 'Credit lifecycle composition shifted the earnings quality of the book.',
      mitigation: 'Improve cohort quality and workout outcomes before expanding origination risk.',
      helpSectionId: 'loan-cohorts-and-ifrs9',
    };
  }
  if (suffix === 'residual') {
    return {
      title: 'Cross-effects and rounding residual',
      mechanismPath:
        'Not all nonlinear interactions are isolated in first-order lines, so remaining movement is captured as residual.',
      whyItMoved: 'Multiple drivers interacted simultaneously within a single step.',
      mitigation: 'Use linked events and section breakdowns to inspect interacting mechanisms.',
      helpSectionId: 'attribution-events-reconciliation',
    };
  }

  return {
    title: selection.lineLabel,
    mechanismPath:
      'This driver captures a modeled effect feeding into the selected metric through the monthly simulation pipeline.',
    whyItMoved: 'The linked events and state transitions indicate this channel was active in the selected step.',
    mitigation: 'Review linked events, then tune related levers before replaying the month.',
    helpSectionId: 'attribution-events-reconciliation',
  };
};
