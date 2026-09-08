import { hedgeExposures } from './hedgeValuation';
import { BankState } from '../domain/bankState';
import { BalanceSheetItem } from '../domain/balanceSheet';
import { SimulationConfig } from '../domain/config';
import { cohortEcl, workoutPresentValue, workoutRecoveryEstimator } from './impairment';
import { hasCapability } from '../products/capabilities';
import {
  defaultedRiskWeight,
  getCreditRiskRule,
  regulatoryRiskWeight,
} from '../products/regulatory';

// Simplified standardised credit RWA. Product definitions identify a reusable
// credit-risk class; the prudential rule table owns the actual risk weights.
// Mortgage eligibility remains a portfolio-level assumption: LTV affects
// economic PD/LGD and stress rather than claiming exact pre-2027 CRR LTV buckets.
export const assetCreditRwa = (state: BankState, config: SimulationConfig, item: BalanceSheetItem): number => {
  const p = item.productType;
  const rule = getCreditRiskRule(p);
  const performingWeight = regulatoryRiskWeight(p);

  if (rule.exposureBasis === 'derivativeCounterparty') {
    return hedgeExposures(state).credit * performingWeight;
  }

  if (!hasCapability(p, 'loan')) {
    return Math.max(0, item.balance) * performingWeight;
  }

  const recovery = workoutRecoveryEstimator(state, config, p);
  const exposures = [
    ...(state.loanCohorts[p] ?? []).map(c => ({
      gross: c.outstandingPrincipal,
      allowance: cohortEcl(c, config),
      defaulted: c.stage === 'stage3',
    })),
    ...(state.workoutPipelines[p] ?? []).map(w => ({
      gross: w.defaultedPrincipal,
      allowance:
        w.defaultedPrincipal - workoutPresentValue(state, config, p, w, recovery(w)),
      defaulted: true,
    })),
  ];

  if (!exposures.length) return Math.max(0, item.balance) * performingWeight;

  const target = exposures.reduce((sum, e) => sum + e.allowance, 0);
  const allowanceScale = target > 0 ? (item.lossAllowance ?? 0) / target : 0;
  let netTotal = 0;
  let rwa = 0;

  for (const e of exposures) {
    const allowance = Math.min(e.gross, Math.max(0, e.allowance * allowanceScale));
    const net = Math.max(0, e.gross - allowance);
    const riskWeight = e.defaulted
      ? defaultedRiskWeight(p, e.gross, allowance)
      : performingWeight;
    netTotal += net;
    rwa += net * riskWeight;
  }

  return netTotal > 0 ? (rwa * Math.max(0, item.balance)) / netTotal : 0;
};
