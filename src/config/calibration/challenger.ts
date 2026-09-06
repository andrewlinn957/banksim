import { AssetProductType, LiabilityProductType } from '../../domain/enums';
import { CalibrationPack } from './types';
import { createCalibrationBase, rebalanceCash, refreshRiskState, setProductBalance } from './utils';

export const createChallengerCalibration = (): CalibrationPack => {
  const { state, config } = createCalibrationBase();

  setProductBalance(state, AssetProductType.Mortgages, 1.9e9);
  setProductBalance(state, AssetProductType.CorporateLoans, 2.2e9);
  setProductBalance(state, AssetProductType.Gilts, 0.4e9);
  setProductBalance(state, LiabilityProductType.RetailSavingsDeposits, 1.1e9);
  setProductBalance(state, LiabilityProductType.CorporateOperatingDeposits, 0.3e9);
  setProductBalance(state, LiabilityProductType.WholesaleFundingST, 0.7e9);
  setProductBalance(state, LiabilityProductType.WholesaleFundingLT, 0.9e9);
  rebalanceCash(state);

  config.behaviour.depositBaselineGrowthMonthly = 0.0014;
  config.global.fixedOperatingCostPerMonth = 0.01e9;
  config.behaviour.costModel = {
    ...config.behaviour.costModel,
    fixedCostPerMonth: 0.01e9,
  };
  config.behaviour.fundingLadder = {
    ...(config.behaviour.fundingLadder ?? {
      stRefinanceTenorMonths: 6,
      ltRefinanceTenorMonths: 36,
      rolloverAccessBase: 0.95,
      rolloverAccessMin: 0.45,
      spreadSensitivity: 12,
      liquidityStressPenalty: 0.18,
    }),
    rolloverAccessBase: 0.9,
    spreadSensitivity: 14,
  };

  refreshRiskState(state, config);
  return {
    id: 'challenger',
    name: 'Challenger bank',
    description: 'Higher growth and wholesale reliance with tighter capital/liquidity tolerance.',
    config,
    initialState: state,
    envelope: {
      cet1Ratio: [0.07, 0.45],
      lcr: [0.85, 8.0],
      // Prescribed ASF/RSF; 24m trajectory is 2.814 after franchise aggregation
      // correction. The upper envelope is a calibration guard, not a prudential limit.
      nsfr: [0.85, 2.9],
      roe: [-0.08, 0.3],
    },
  };
};
