import { ProductType } from './enums';
import { LiquidityTag } from './liquidity';
import { RiskLimits } from './risks';

export interface LoanCohortParameters {
  defaultTermMonths: number;
  maxTermMonths: number;
  initialSeasoningEnabled?: boolean;
  initialCouponDispersionBps?: number;
  initialPdMultiplierRange?: { min: number; max: number };
  initialLgdMultiplierRange?: { min: number; max: number };
  initialMinBucketOutstanding?: number;
}

export interface ProductRiskParameters {
  productType: ProductType;
  riskWeight: number;
  baseDefaultRate: number;
  lossGivenDefault: number;
  volumeElasticityToRate: number;
  loan?: LoanCohortParameters;
}

export interface GlobalSimulationParameters {
  taxRate: number;
  operatingCostRatio: number;
  maxDepositGrowthPerStep: number;
  maxLoanGrowthPerStep: number;
  fixedOperatingCostPerMonth: number;
  initialPortfolioSeed?: number;
}

export interface SimulationConfig {
  version: string;
  productParameters: Record<ProductType, ProductRiskParameters>;
  liquidityTags: Record<ProductType, LiquidityTag>;
  global: GlobalSimulationParameters;
  riskLimits: RiskLimits;
}
