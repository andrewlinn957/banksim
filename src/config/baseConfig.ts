import {
  AssetProductType,
  HQLALevel,
  LiabilityProductType,
  ProductType,
} from '../domain/enums';
import { SimulationConfig, ProductRiskParameters, GlobalSimulationParameters } from '../domain/config';
import { LiquidityTag } from '../domain/liquidity';

const productParameters: Record<ProductType, ProductRiskParameters> = {
  [AssetProductType.CashReserves]: {
    productType: AssetProductType.CashReserves,
    riskWeight: 0,
    baseDefaultRate: 0.0,
    lossGivenDefault: 0,
    volumeElasticityToRate: 0,
  },
  [AssetProductType.Gilts]: {
    productType: AssetProductType.Gilts,
    riskWeight: 0,
    baseDefaultRate: 0.0005,
    lossGivenDefault: 0.1,
    volumeElasticityToRate: 0,
  },
  [AssetProductType.Mortgages]: {
    productType: AssetProductType.Mortgages,
    riskWeight: 0.35,
    baseDefaultRate: 0.004,
    lossGivenDefault: 0.25,
    volumeElasticityToRate: -4.0,
    loan: {
      defaultTermMonths: 360,
      maxTermMonths: 420,
      initialSeasoningEnabled: true,
      initialCouponDispersionBps: 50,
      initialPdMultiplierRange: { min: 0.8, max: 1.25 },
      initialLgdMultiplierRange: { min: 0.9, max: 1.1 },
      initialMinBucketOutstanding: 1e6,
    },
  },
  [AssetProductType.CorporateLoans]: {
    productType: AssetProductType.CorporateLoans,
    riskWeight: 1.0,
    baseDefaultRate: 0.015,
    lossGivenDefault: 0.45,
    volumeElasticityToRate: -3.0,
    loan: {
      defaultTermMonths: 60,
      maxTermMonths: 420,
      initialSeasoningEnabled: true,
      initialCouponDispersionBps: 75,
      initialPdMultiplierRange: { min: 0.85, max: 1.4 },
      initialLgdMultiplierRange: { min: 0.9, max: 1.15 },
      initialMinBucketOutstanding: 1e6,
    },
  },
  [AssetProductType.ReverseRepo]: {
    productType: AssetProductType.ReverseRepo,
    riskWeight: 0,
    baseDefaultRate: 0.0,
    lossGivenDefault: 0,
    volumeElasticityToRate: 0,
  },
  [LiabilityProductType.RetailDeposits]: {
    productType: LiabilityProductType.RetailDeposits,
    riskWeight: 0,
    baseDefaultRate: 0.0,
    lossGivenDefault: 0,
    volumeElasticityToRate: 5.0,
  },
  [LiabilityProductType.CorporateDeposits]: {
    productType: LiabilityProductType.CorporateDeposits,
    riskWeight: 0,
    baseDefaultRate: 0.0,
    lossGivenDefault: 0,
    volumeElasticityToRate: 8.0,
  },
  [LiabilityProductType.WholesaleFundingST]: {
    productType: LiabilityProductType.WholesaleFundingST,
    riskWeight: 0,
    baseDefaultRate: 0.0,
    lossGivenDefault: 0,
    volumeElasticityToRate: 0,
  },
  [LiabilityProductType.WholesaleFundingLT]: {
    productType: LiabilityProductType.WholesaleFundingLT,
    riskWeight: 0,
    baseDefaultRate: 0.0,
    lossGivenDefault: 0,
    volumeElasticityToRate: 0,
  },
  [LiabilityProductType.RepurchaseAgreements]: {
    productType: LiabilityProductType.RepurchaseAgreements,
    riskWeight: 0,
    baseDefaultRate: 0.0,
    lossGivenDefault: 0,
    volumeElasticityToRate: 0,
  },
};

const liquidityTags: Record<ProductType, LiquidityTag> = {
  [AssetProductType.CashReserves]: {
    productType: AssetProductType.CashReserves,
    hqlaLevel: HQLALevel.Level1,
    lcrInflowRate: 0,
    nsfrRsfFactor: 0,
  },
  [AssetProductType.Gilts]: {
    productType: AssetProductType.Gilts,
    hqlaLevel: HQLALevel.Level1,
    lcrInflowRate: 0,
    nsfrRsfFactor: 0.05,
  },
  [AssetProductType.Mortgages]: {
    productType: AssetProductType.Mortgages,
    hqlaLevel: HQLALevel.None,
    lcrInflowRate: 0.05,
    nsfrRsfFactor: 0.85,
  },
  [AssetProductType.CorporateLoans]: {
    productType: AssetProductType.CorporateLoans,
    hqlaLevel: HQLALevel.None,
    lcrInflowRate: 0.05,
    nsfrRsfFactor: 1.0,
  },
  [AssetProductType.ReverseRepo]: {
    productType: AssetProductType.ReverseRepo,
    hqlaLevel: HQLALevel.None,
    lcrInflowRate: 1.0,
    nsfrRsfFactor: 0.1,
  },
  [LiabilityProductType.RetailDeposits]: {
    productType: LiabilityProductType.RetailDeposits,
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 0.05,
    nsfrAsfFactor: 0.95,
  },
  [LiabilityProductType.CorporateDeposits]: {
    productType: LiabilityProductType.CorporateDeposits,
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 0.4,
    nsfrAsfFactor: 0.5,
  },
  [LiabilityProductType.WholesaleFundingST]: {
    productType: LiabilityProductType.WholesaleFundingST,
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 1.0,
    nsfrAsfFactor: 0.0,
  },
  [LiabilityProductType.WholesaleFundingLT]: {
    productType: LiabilityProductType.WholesaleFundingLT,
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 0.0,
    nsfrAsfFactor: 1.0,
  },
  [LiabilityProductType.RepurchaseAgreements]: {
    productType: LiabilityProductType.RepurchaseAgreements,
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 1.0,
    nsfrAsfFactor: 0.0,
  },
};

const global: GlobalSimulationParameters = {
  taxRate: 0.25,
  operatingCostRatio: 0.02,
  maxDepositGrowthPerStep: 0.08,
  maxLoanGrowthPerStep: 0.05,
  fixedOperatingCostPerMonth: 0.05e9, // £50m per month baseline
  initialPortfolioSeed: 123456789,
};

const riskLimits = {
  minCet1Ratio: 0.105,
  minLeverageRatio: 0.035,
  minLcr: 1.0,
  minNsfr: 1.0,
};

export const baseConfig: SimulationConfig = {
  version: 'v1',
  productParameters,
  liquidityTags,
  global,
  riskLimits,
};
