import { baseConfig } from '../baseConfig';
import { initialState } from '../initialState';
import { BankState } from '../../domain/bankState';
import { SimulationConfig } from '../../domain/config';
import { AssetProductType, BalanceSheetSide, ProductType } from '../../domain/enums';
import { calculateRiskMetrics, evaluateCompliance } from '../../engine/metrics';
import { cloneBankState } from '../../engine/clone';
import { PRODUCT_META } from '../../domain/productMeta';
import { sumLoanOutstanding } from '../../engine/loanCohorts';

const cloneConfig = (): SimulationConfig => JSON.parse(JSON.stringify(baseConfig)) as SimulationConfig;

export const createCalibrationBase = (): { state: BankState; config: SimulationConfig } => ({
  state: cloneBankState(initialState),
  config: cloneConfig(),
});

export const setProductBalance = (state: BankState, productType: ProductType, balance: number): void => {
  const item = state.financial.balanceSheet.items.find((line) => line.productType === productType);
  if (!item) throw new Error(`Missing balance-sheet line for ${productType}`);
  const nextBalance = Math.max(0, balance);
  item.balance = nextBalance;

  if (!PRODUCT_META[productType]?.behaviour?.isLoan) return;

  const cohorts = state.loanCohorts[productType] ?? [];
  const workoutBuckets = state.workoutPipelines[productType] ?? [];
  const workoutStock = workoutBuckets.reduce(
    (sum, bucket) => sum + Math.max(0, bucket.defaultedPrincipal ?? 0),
    0
  );
  const currentBalance = sumLoanOutstanding(cohorts) + workoutStock;
  if (currentBalance <= 0) return;

  const scale = nextBalance / currentBalance;
  cohorts.forEach((cohort) => {
    cohort.originalPrincipal = Math.max(0, cohort.originalPrincipal * scale);
    cohort.outstandingPrincipal = Math.max(0, cohort.outstandingPrincipal * scale);
  });
  workoutBuckets.forEach((bucket) => {
    bucket.defaultedPrincipal = Math.max(0, bucket.defaultedPrincipal * scale);
  });
};

export const rebalanceCash = (state: BankState): void => {
  const cash = state.financial.balanceSheet.items.find(
    (line) => line.productType === AssetProductType.CashReserves
  );
  if (!cash) throw new Error('Missing cash line while rebalancing calibration state');

  const assetsExCash = state.financial.balanceSheet.items
    .filter((line) => line.side === BalanceSheetSide.Asset && line.productType !== AssetProductType.CashReserves)
    .reduce((sum, line) => sum + line.balance, 0);
  const liabilities = state.financial.balanceSheet.items
    .filter((line) => line.side === BalanceSheetSide.Liability)
    .reduce((sum, line) => sum + line.balance, 0);
  const equity =
    state.financial.capital.cet1 + state.financial.capital.at1 + state.financial.capital.accumulatedOCI;
  cash.balance = Math.max(0, liabilities + equity - assetsExCash);
};

export const refreshRiskState = (state: BankState, config: SimulationConfig): void => {
  state.risk.riskMetrics = calculateRiskMetrics({ state, config });
  state.risk.compliance = evaluateCompliance(state.risk.riskMetrics, config.riskLimits);
};
