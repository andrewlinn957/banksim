import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { AssetProductType } from '../domain/enums';

export type GuardrailSeverity = 'danger' | 'warning' | 'info';

export interface PreRunGuardrail {
  id: string;
  severity: GuardrailSeverity;
  title: string;
  reason: string;
  mitigation: string;
  helpSectionId: string;
}

export interface GuardrailPreview {
  stressedCet1Ratio: number;
  stressedLcr: number;
  stressedNsfr: number;
  breachProbability: number;
}

export interface GuardrailInputs {
  state: BankState;
  config: SimulationConfig;
  parsedValues: Partial<Record<ActionNumericField, number>>;
  hasValidationErrors: boolean;
  preview?: GuardrailPreview | null;
}

type ActionNumericField =
  | 'retailDepositRate'
  | 'corporateDepositRate'
  | 'mortgageRate'
  | 'corporateLoanRate'
  | 'mortgageUnderwritingTightness'
  | 'corporateUnderwritingTightness'
  | 'issueLTDebtAmount'
  | 'issueEquityAmount'
  | 'dividendPayoutRatio'
  | 'hedgeNotional'
  | 'hedgeFixedRate'
  | 'hedgeMaturityMonths';

const severityRank = (severity: GuardrailSeverity): number => {
  if (severity === 'danger') return 3;
  if (severity === 'warning') return 2;
  return 1;
};

const maybePush = (bucket: PreRunGuardrail[], guardrail: PreRunGuardrail) => {
  if (bucket.some((existing) => existing.id === guardrail.id)) return;
  bucket.push(guardrail);
};

export const buildPreRunGuardrails = (inputs: GuardrailInputs): PreRunGuardrail[] => {
  const { state, config, parsedValues, hasValidationErrors, preview } = inputs;
  if (hasValidationErrors) return [];

  const guardrails: PreRunGuardrail[] = [];
  const metrics = state.risk.riskMetrics;
  const payoutFallback =
    state.behaviour.capitalPolicy?.dividendPayoutRatio ??
    config.riskLimits.capitalPolicy.defaultDividendPayoutRatio;
  const requestedPayout = parsedValues.dividendPayoutRatio ?? payoutFallback;

  if (preview) {
    const nearOrBelowCet1 = preview.stressedCet1Ratio <= config.riskLimits.minCet1Ratio * 1.03;
    const nearOrBelowLcr = preview.stressedLcr <= config.riskLimits.minLcr * 1.03;
    const nearOrBelowNsfr = preview.stressedNsfr <= config.riskLimits.minNsfr * 1.03;
    const highBreachProbability = preview.breachProbability >= 0.25;
    if (nearOrBelowCet1 || nearOrBelowLcr || nearOrBelowNsfr || highBreachProbability) {
      maybePush(guardrails, {
        id: 'stress-near-breach',
        severity:
          preview.breachProbability >= 0.4 ||
          preview.stressedLcr <= config.riskLimits.minLcr ||
          preview.stressedNsfr <= config.riskLimits.minNsfr ||
          preview.stressedCet1Ratio <= config.riskLimits.minCet1Ratio
            ? 'danger'
            : 'warning',
        title: 'Stress path is near a hard breach',
        reason:
          `Preview stress metrics are tight (CET1 ${(preview.stressedCet1Ratio * 100).toFixed(1)}%, ` +
          `LCR ${preview.stressedLcr.toFixed(2)}x, NSFR ${preview.stressedNsfr.toFixed(2)}x; ` +
          `stress paths breaching limits ${(preview.breachProbability * 100).toFixed(0)}%).`,
        mitigation:
          'Raise capital/funding headroom or reduce risk growth before running the month.',
        helpSectionId: 'preview-and-recommendations',
      });
    }
  }

  if (
    requestedPayout > metrics.maxPayoutRatio + 1e-4 ||
    (metrics.payoutBlockedByInternalTarget && requestedPayout > 0.05)
  ) {
    maybePush(guardrails, {
      id: 'payout-clipped',
      severity: 'warning',
      title: 'Requested payout is likely to be clipped',
      reason:
        `Requested payout ${(requestedPayout * 100).toFixed(1)}% exceeds current effective cap ` +
        `${(metrics.maxPayoutRatio * 100).toFixed(1)}% or internal target restraint is active.`,
      mitigation: 'Lower payout ratio and retain earnings until internal CET1 headroom improves.',
      helpSectionId: 'capital-policy-and-distributions',
    });
  }

  const confidenceWeak = metrics.fundingConfidenceState === 'watch' || metrics.fundingConfidenceState === 'stressed';
  const shortFundingToHqla = metrics.fundingMaturing3m / Math.max(1e-9, metrics.hqla);
  if (confidenceWeak && shortFundingToHqla >= 0.8) {
    maybePush(guardrails, {
      id: 'rollover-wall-confidence',
      severity: shortFundingToHqla >= 1 ? 'danger' : 'warning',
      title: 'Rollover wall with weak confidence',
      reason:
        `Funding maturing <=3m is ${(shortFundingToHqla * 100).toFixed(0)}% of HQLA while confidence is ` +
        `${metrics.fundingConfidenceState}. Market access can tighten abruptly.`,
      mitigation:
        'Term out liabilities (issue LT debt/equity), rebuild confidence, and avoid optional payouts.',
      helpSectionId: 'funding-ladder-and-rollover',
    });
  }

  const mortgageRate = parsedValues.mortgageRate;
  const corpLoanRate = parsedValues.corporateLoanRate;
  const mortgageTightness =
    parsedValues.mortgageUnderwritingTightness ??
    state.behaviour.underwritingTightness?.[AssetProductType.Mortgages] ??
    0;
  const corpTightness =
    parsedValues.corporateUnderwritingTightness ??
    state.behaviour.underwritingTightness?.[AssetProductType.CorporateLoans] ??
    0;
  const corporateReferenceRate = state.market.baseRate + state.market.corporateLoanSpread;

  const aggressiveMortgage = mortgageRate !== undefined && mortgageRate - state.market.competitorMortgageRate >= 0.01;
  const aggressiveCorporate = corpLoanRate !== undefined && corpLoanRate - corporateReferenceRate >= 0.012;
  const looseUnderwriting = mortgageTightness <= 0.25 || corpTightness <= 0.25;
  if ((aggressiveMortgage || aggressiveCorporate) && looseUnderwriting) {
    maybePush(guardrails, {
      id: 'adverse-selection-risk',
      severity: 'warning',
      title: 'Adverse selection pressure is rising',
      reason:
        'Loan pricing appears materially above market while underwriting remains loose, which can worsen future PD/LGD mix.',
      mitigation:
        'Tighten underwriting and/or reduce pricing gap to market until pipeline quality stabilizes.',
      helpSectionId: 'loan-pipeline',
    });
  }

  const retailDepositRate = parsedValues.retailDepositRate;
  const corpDepositRate = parsedValues.corporateDepositRate;
  const competitorCorpDeposit =
    state.market.competitorCorporateDepositRate ?? state.market.competitorRetailDepositRate;
  const retailUnderpricing =
    retailDepositRate !== undefined &&
    state.market.competitorRetailDepositRate - retailDepositRate >= 0.0075;
  const corpUnderpricing =
    corpDepositRate !== undefined &&
    competitorCorpDeposit - corpDepositRate >= 0.009;
  if (
    (retailUnderpricing || corpUnderpricing) &&
    (metrics.depositQualityIndex < 0.95 || metrics.fundingConfidenceScore < 0.62)
  ) {
    maybePush(guardrails, {
      id: 'deposit-runoff-risk',
      severity: 'warning',
      title: 'Deposit runoff risk from underpricing',
      reason:
        'Deposit rates appear below competitor levels while deposit quality/confidence is soft, which can accelerate churn and runoff.',
      mitigation:
        'Close rate gaps selectively (especially stickier books first) and stabilize franchise before pushing margins.',
      helpSectionId: 'deposit-behaviour',
    });
  }

  return guardrails
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || left.id.localeCompare(right.id))
    .slice(0, 4);
};
