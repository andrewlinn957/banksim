import { hedgeExposures } from './hedgeValuation';
import { BankState } from '../domain/bankState';
import { BalanceSheetItem } from '../domain/balanceSheet';
import { SimulationConfig } from '../domain/config';
import { cohortEcl, workoutPresentValue, workoutRecoveryEstimator } from './impairment';
import { hasCapability } from '../products/capabilities';
import { canonicalLoanGeography, UK_ITL1_REGIONS, UkItl1Region } from '../domain/ukItl1';
import {
  defaultedRiskWeight,
  getCreditRiskRule,
  regulatoryRiskWeight,
} from '../products/regulatory';

const emptyRegionalRwa = (): Record<UkItl1Region, number> =>
  Object.fromEntries(UK_ITL1_REGIONS.map(region => [region, 0])) as Record<UkItl1Region, number>;

/**
 * Decompose a loan balance-sheet line's credit RWA across the 12 UK ITL1 regions.
 * The sum of this record equals assetCreditRwa for loan products with cohort data.
 */
export const loanCreditRwaByRegion = (
  state: BankState,
  config: SimulationConfig,
  item: BalanceSheetItem
): Record<UkItl1Region, number> => {
  const result = emptyRegionalRwa();
  const p = item.productType;
  if (!hasCapability(p, 'loan')) return result;

  const performingWeight = regulatoryRiskWeight(p);
  const recovery = workoutRecoveryEstimator(state, config, p);
  const exposures = [
    ...(state.loanCohorts[p] ?? []).map(c => ({
      gross: c.outstandingPrincipal,
      allowance: cohortEcl(c, config),
      defaulted: c.stage === 'stage3',
      region: canonicalLoanGeography(c.geography, c.cohortId),
    })),
    ...(state.workoutPipelines[p] ?? []).map(w => ({
      gross: w.defaultedPrincipal,
      allowance:
        w.defaultedPrincipal - workoutPresentValue(state, config, p, w, recovery(w)),
      defaulted: true,
      region: canonicalLoanGeography(w.geography, w.sourceCohortId),
    })),
  ];
  if (!exposures.length) return result;

  const target = exposures.reduce((sum, e) => sum + e.allowance, 0);
  const allowanceScale = target > 0 ? (item.lossAllowance ?? 0) / target : 0;
  let netTotal = 0;

  for (const e of exposures) {
    const allowance = Math.min(e.gross, Math.max(0, e.allowance * allowanceScale));
    const net = Math.max(0, e.gross - allowance);
    const riskWeight = e.defaulted
      ? defaultedRiskWeight(p, e.gross, allowance)
      : performingWeight;
    netTotal += net;
    result[e.region] += net * riskWeight;
  }

  if (netTotal <= 0) return emptyRegionalRwa();
  const accountingScale = Math.max(0, item.balance) / netTotal;
  UK_ITL1_REGIONS.forEach(region => {
    result[region] *= accountingScale;
  });
  return result;
};

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

  const regional = loanCreditRwaByRegion(state, config, item);
  const regionalTotal = UK_ITL1_REGIONS.reduce((sum, region) => sum + regional[region], 0);
  if (regionalTotal > 0 || (state.loanCohorts[p]?.length ?? 0) > 0 || (state.workoutPipelines[p]?.length ?? 0) > 0) {
    return regionalTotal;
  }

  return Math.max(0, item.balance) * performingWeight;
};
