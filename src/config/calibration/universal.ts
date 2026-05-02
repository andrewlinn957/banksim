import { AssetProductType, LiabilityProductType } from '../../domain/enums';
import { CalibrationPack } from './types';
import { createCalibrationBase, rebalanceCash, refreshRiskState, setProductBalance } from './utils';

export const createUniversalCalibration = (): CalibrationPack => {
  const { state, config } = createCalibrationBase();

  setProductBalance(state, AssetProductType.Mortgages, 5.1e9);
  setProductBalance(state, AssetProductType.CorporateLoans, 3.6e9);
  setProductBalance(state, LiabilityProductType.WholesaleFundingST, 1e9);
  setProductBalance(state, LiabilityProductType.WholesaleFundingLT, 2e9);
  rebalanceCash(state);

  config.behaviour.depositBaselineGrowthMonthly = 0.002;
  config.behaviour.loanBaselineGrowthMonthly = 0;
  config.global.fixedOperatingCostPerMonth = 0.018e9;
  config.behaviour.costModel = {
    ...config.behaviour.costModel,
    fixedCostPerMonth: 0.018e9,
  };

  refreshRiskState(state, config);
  return {
    id: 'universal',
    name: 'Universal bank',
    description: 'Balanced retail and corporate franchise with diversified funding.',
    config,
    initialState: state,
    envelope: {
      cet1Ratio: [0.08, 0.45],
      lcr: [0.9, 6.0],
      nsfr: [0.9, 3.0],
      roe: [-0.05, 0.3],
    },
  };
};
