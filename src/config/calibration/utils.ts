import { baseConfig } from '../baseConfig';
import { initialState } from '../initialState';
import { BankState } from '../../domain/bankState';
import { SimulationConfig } from '../../domain/config';
import { AssetProductType, ProductType } from '../../domain/enums';
import { calculateRiskMetrics, evaluateCompliance } from '../../engine/metrics';
import { cloneBankState } from '../../engine/clone';
import { PRODUCTS } from '../../products/catalogue';
import {
  assetPositions,
  findProductPosition,
  liabilityPositions,
  requireProductPosition,
} from '../../products/selectors';
import { calculateProvisionTargetFromCohorts, sumLoanOutstanding } from '../../engine/loanCohorts';

const cloneConfig = (): SimulationConfig => JSON.parse(JSON.stringify(baseConfig)) as SimulationConfig;

export const createCalibrationBase = (): { state: BankState; config: SimulationConfig } => ({
  state: cloneBankState(initialState),
  config: cloneConfig(),
});

export const setProductBalance = (state: BankState, productType: ProductType, balance: number): void => {
  const item = requireProductPosition(state.financial.balanceSheet, productType);
  const nextBalance = Math.max(0, balance);
  if (item.security && item.balance > 0) {
    item.security.amortisedCost = (item.security.amortisedCost ?? item.balance) * nextBalance / item.balance;
    item.security.lossAllowance = (item.security.lossAllowance ?? 0) * nextBalance / item.balance;
  }
  item.balance = nextBalance;

  // Contractual funding balances and their maturity buckets are one economic position.
  // Calibration packs often resize fixed-term savings or long-term debt, so keep the
  // ladder aligned instead of leaving a hidden maturity amount from the base state.
  const fundingBuckets = state.fundingLadders?.[productType];
  if (fundingBuckets?.length) {
    const total = fundingBuckets.reduce((sum, bucket) => sum + Math.max(0, bucket.notional), 0);
    if (total > 0) {
      const fundingScale = nextBalance / total;
      fundingBuckets.forEach((bucket) => {
        bucket.notional = Math.max(0, bucket.notional * fundingScale);
      });
    }
  }

  if (!PRODUCTS[productType]?.behaviour?.isLoan) return;

  const cohorts = state.loanCohorts[productType] ?? [];
  const workoutBuckets = state.workoutPipelines[productType] ?? [];
  const workoutStock = workoutBuckets.reduce(
    (sum, bucket) => sum + Math.max(0, bucket.defaultedPrincipal ?? 0),
    0
  );
  const currentBalance = sumLoanOutstanding(cohorts) + workoutStock;
  if (currentBalance <= 0) return;

  const scale = nextBalance / Math.max(1, currentBalance - (item.lossAllowance ?? 0));
  item.lossAllowance = (item.lossAllowance ?? 0) * scale;
  cohorts.forEach((cohort) => {
    cohort.originalPrincipal = Math.max(0, cohort.originalPrincipal * scale);
    cohort.outstandingPrincipal = Math.max(0, cohort.outstandingPrincipal * scale);
  });
  workoutBuckets.forEach((bucket) => {
    bucket.defaultedPrincipal = Math.max(0, bucket.defaultedPrincipal * scale);
  });
};

export const rebalanceCash = (state: BankState): void => {
  const cash = requireProductPosition(
    state.financial.balanceSheet,
    AssetProductType.CashReserves,
    'Missing cash line while rebalancing calibration state'
  );

  const assetsExCash = assetPositions(state.financial.balanceSheet)
    .filter((line) => line.productType !== AssetProductType.CashReserves)
    .reduce((sum, line) => sum + line.balance, 0);
  const liabilities = liabilityPositions(state.financial.balanceSheet)
    .reduce((sum, line) => sum + line.balance, 0);
  const equity =
    state.financial.capital.cet1 + state.financial.capital.at1 + state.financial.capital.accumulatedOCI;
  cash.balance = Math.max(0, liabilities + equity - assetsExCash);
};

const calibrateAddressableMarketShares = (state: BankState, config: SimulationConfig): void => {
  [AssetProductType.Mortgages, AssetProductType.ConsumerLoans, AssetProductType.CorporateLoans].forEach((productType) => {
    const pipeline = config.behaviour.loanPipelineByProduct?.[productType];
    const marketSize = pipeline?.referenceMarketSize;
    if (!pipeline || !marketSize || marketSize <= 0) return;
    const openingBook = findProductPosition(state.financial.balanceSheet, productType)?.balance ?? 0;
    pipeline.referenceBankShare = Math.max(0, Math.min(1, openingBook / marketSize));
  });
};

export const refreshRiskState = (state: BankState, config: SimulationConfig): void => {
  calibrateAddressableMarketShares(state, config);
  state.financial.provisionStock = calculateProvisionTargetFromCohorts({ state, config });
  state.risk.riskMetrics = calculateRiskMetrics({ state, config });
  state.risk.compliance = evaluateCompliance(state.risk.riskMetrics, config.riskLimits);
};
