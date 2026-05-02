import { AssetProductType, LiabilityProductType } from '../../domain/enums';
import { CalibrationPack } from './types';
import { createCalibrationBase, rebalanceCash, refreshRiskState, setProductBalance } from './utils';

export const createRetailHeavyCalibration = (): CalibrationPack => {
  const { state, config } = createCalibrationBase();

  setProductBalance(state, AssetProductType.Mortgages, 6.2e9);
  setProductBalance(state, AssetProductType.CorporateLoans, 2.3e9);
  setProductBalance(state, LiabilityProductType.RetailSavingsDeposits, 6e9);
  setProductBalance(state, LiabilityProductType.CorporateNonOperatingDeposits, 0.15e9);
  setProductBalance(state, LiabilityProductType.WholesaleFundingST, 0.05e9);
  rebalanceCash(state);

  config.behaviour.depositBaselineGrowthMonthly = 0.0025;
  config.global.fixedOperatingCostPerMonth = 0.018e9;
  config.behaviour.costModel = {
    ...config.behaviour.costModel,
    fixedCostPerMonth: 0.018e9,
  };
  config.behaviour.loanPipelineByProduct = {
    ...(config.behaviour.loanPipelineByProduct ?? {}),
    [AssetProductType.Mortgages]: {
      ...(config.behaviour.loanPipelineByProduct?.[AssetProductType.Mortgages] ?? {
        baseDemandRateMonthly: 0.0075,
        pricingSensitivity: 2.4,
        macroSensitivity: 1.2,
        baseApprovalRate: 0.82,
        underwritingSensitivity: 0.5,
        drawdownRateMonthly: 0.45,
        cancellationRateMonthly: 0.08,
      }),
      baseDemandRateMonthly: 0.0083,
      baseApprovalRate: 0.85,
    },
  };

  refreshRiskState(state, config);
  return {
    id: 'retail-heavy',
    name: 'Retail-heavy bank',
    description: 'High share of mortgage lending and sticky retail deposit franchise.',
    config,
    initialState: state,
    envelope: {
      cet1Ratio: [0.085, 0.45],
      lcr: [0.95, 6.0],
      nsfr: [0.95, 3.0],
      roe: [-0.03, 0.3],
    },
  };
};
