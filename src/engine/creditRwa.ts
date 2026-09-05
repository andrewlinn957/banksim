import { hedgeExposures } from './hedgeValuation';
import { BankState } from '../domain/bankState';
import { BalanceSheetItem } from '../domain/balanceSheet';
import { SimulationConfig } from '../domain/config';
import { AssetProductType } from '../domain/enums';
import { cohortEcl, workoutPresentValue, workoutRecoveryEstimator } from './impairment';

// UK CRR 127. Corporate book is unsecured; mortgages meet Article 125 eligibility.
export const assetCreditRwa = (state: BankState, config: SimulationConfig, item: BalanceSheetItem): number => {
  const p = item.productType, performingWeight = config.productParameters[p]?.riskWeight ?? 0;
  if (p === AssetProductType.DerivativeAssets) return hedgeExposures(state).credit * performingWeight;
  if (p !== AssetProductType.Mortgages && p !== AssetProductType.CorporateLoans) return Math.max(0,item.balance) * performingWeight;
  const recovery = workoutRecoveryEstimator(state,config,p);
  const exposures = [
    ...(state.loanCohorts[p] ?? []).map(c => ({ gross: c.outstandingPrincipal, allowance: cohortEcl(c,config), defaulted: c.stage === 'stage3' })),
    ...(state.workoutPipelines[p] ?? []).map(w => ({ gross: w.defaultedPrincipal, allowance: w.defaultedPrincipal - workoutPresentValue(state,config,p,w,recovery(w)), defaulted: true })),
  ];
  if (!exposures.length) return Math.max(0,item.balance) * performingWeight;
  const target = exposures.reduce((sum,e)=>sum+e.allowance,0);
  const allowanceScale = target > 0 ? (item.lossAllowance ?? 0) / target : 0;
  let netTotal = 0, rwa = 0;
  for (const e of exposures) {
    const allowance = Math.min(e.gross,Math.max(0,e.allowance * allowanceScale));
    const net = Math.max(0,e.gross - allowance);
    const defaultWeight = p === AssetProductType.Mortgages ? 1 : allowance >= .2 * e.gross ? 1 : 1.5;
    netTotal += net; rwa += net * (e.defaulted ? defaultWeight : performingWeight);
  }
  return netTotal > 0 ? rwa * Math.max(0,item.balance) / netTotal : 0;
};
