import { BankState } from '../domain/bankState';
import { HQLALevel, ProductType } from '../domain/enums';
import { LiquidityTag } from '../domain/liquidity';
import {
  CapitalRegulatoryClass,
  CreditRiskRegulatoryClass,
  LeverageRegulatoryClass,
  LiquidityRegulatoryClass,
  PRODUCTS,
  ProductRegulatoryClassification,
} from './catalogue';

export type FundingMaturityTreatment = 'retailTerm' | 'contractual';

export interface RegulatoryLiquidityRule {
  hqlaLevel: HQLALevel;
  lcrOutflowRate?: number;
  lcrInflowRate?: number;
  nsfrAsfFactor?: number;
  nsfrRsfFactor?: number;
  dynamicRetailSight?: boolean;
  derivativeTreatment?: 'asset' | 'liability';
  fundingMaturityTreatment?: FundingMaturityTreatment;
  loanLongRsfFactor?: number;
  commitmentOutflowFactor?: number;
  commitmentRsfFactor?: number;
  centralBankReserveExcludable?: boolean;
}

export interface CreditRiskRule {
  performingRiskWeight: number;
  exposureBasis: 'balance' | 'derivativeCounterparty';
  defaultedTreatment?: 'mortgage' | 'provisionSensitive';
}

export interface CapitalRule {
  ownFundsTier?: 'tier2';
}

export const LIQUIDITY_RULES: Record<LiquidityRegulatoryClass, RegulatoryLiquidityRule> = {
  derivativeAsset: {
    hqlaLevel: HQLALevel.None,
    lcrInflowRate: 0,
    nsfrRsfFactor: 1,
    derivativeTreatment: 'asset',
  },
  derivativeLiability: {
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 0,
    nsfrAsfFactor: 0,
    derivativeTreatment: 'liability',
  },
  creditProvision: {
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 0,
    nsfrAsfFactor: 0,
  },
  centralBankReserve: {
    hqlaLevel: HQLALevel.Level1,
    lcrInflowRate: 0,
    nsfrRsfFactor: 0,
    centralBankReserveExcludable: true,
  },
  level1Sovereign: {
    hqlaLevel: HQLALevel.Level1,
    lcrInflowRate: 0,
    nsfrRsfFactor: 0,
  },
  residentialMortgage: {
    hqlaLevel: HQLALevel.None,
    lcrInflowRate: 0.05,
    nsfrRsfFactor: 0.65,
    loanLongRsfFactor: 0.65,
    commitmentOutflowFactor: 0.05,
    commitmentRsfFactor: 0.05,
  },
  consumerLoan: {
    hqlaLevel: HQLALevel.None,
    lcrInflowRate: 0.05,
    nsfrRsfFactor: 0.85,
    loanLongRsfFactor: 0.85,
    commitmentOutflowFactor: 0.10,
    commitmentRsfFactor: 0.05,
  },
  corporateLoan: {
    hqlaLevel: HQLALevel.None,
    lcrInflowRate: 0.05,
    nsfrRsfFactor: 0.85,
    loanLongRsfFactor: 0.85,
    commitmentOutflowFactor: 0.10,
    commitmentRsfFactor: 0.05,
  },
  retailSightDeposit: {
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 0.10,
    nsfrAsfFactor: 0.90,
    dynamicRetailSight: true,
  },
  retailTermDeposit: {
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 0,
    nsfrAsfFactor: 0.90,
    fundingMaturityTreatment: 'retailTerm',
  },
  corporateOperatingDeposit: {
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 0.25,
    nsfrAsfFactor: 0.50,
  },
  corporateNonOperatingDeposit: {
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 0.40,
    nsfrAsfFactor: 0.50,
  },
  wholesaleFundingShort: {
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 1,
    nsfrAsfFactor: 0,
    fundingMaturityTreatment: 'contractual',
  },
  wholesaleFundingLong: {
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 0,
    nsfrAsfFactor: 1,
    fundingMaturityTreatment: 'contractual',
  },
  centralBankSecuredFunding: {
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 0,
    nsfrAsfFactor: 0.50,
    fundingMaturityTreatment: 'contractual',
  },
  tier2Funding: {
    hqlaLevel: HQLALevel.None,
    lcrOutflowRate: 0,
    nsfrAsfFactor: 1,
    fundingMaturityTreatment: 'contractual',
  },
};

export const CREDIT_RISK_RULES: Record<CreditRiskRegulatoryClass, CreditRiskRule> = {
  derivativeCounterparty: {
    performingRiskWeight: 1,
    exposureBasis: 'derivativeCounterparty',
  },
  centralBank: {
    performingRiskWeight: 0,
    exposureBasis: 'balance',
  },
  sovereign: {
    performingRiskWeight: 0,
    exposureBasis: 'balance',
  },
  residentialMortgage: {
    performingRiskWeight: 0.35,
    exposureBasis: 'balance',
    defaultedTreatment: 'mortgage',
  },
  retailUnsecured: {
    performingRiskWeight: 0.75,
    exposureBasis: 'balance',
    defaultedTreatment: 'provisionSensitive',
  },
  corporate: {
    performingRiskWeight: 1,
    exposureBasis: 'balance',
    defaultedTreatment: 'provisionSensitive',
  },
  none: {
    performingRiskWeight: 0,
    exposureBasis: 'balance',
  },
};

export const CAPITAL_RULES: Record<CapitalRegulatoryClass, CapitalRule> = {
  none: {},
  tier2OwnFunds: { ownFundsTier: 'tier2' },
};

export const getRegulatoryClassification = (productType: ProductType): ProductRegulatoryClassification =>
  PRODUCTS[productType].regulatory;

export const getLiquidityRule = (productType: ProductType): RegulatoryLiquidityRule =>
  LIQUIDITY_RULES[getRegulatoryClassification(productType).liquidity];

export const getCreditRiskRule = (productType: ProductType): CreditRiskRule =>
  CREDIT_RISK_RULES[getRegulatoryClassification(productType).creditRisk];

export const getCapitalRule = (productType: ProductType): CapitalRule =>
  CAPITAL_RULES[getRegulatoryClassification(productType).capital];

export const liquidityTagForProduct = (productType: ProductType): LiquidityTag => {
  const rule = getLiquidityRule(productType);
  return {
    productType,
    hqlaLevel: rule.hqlaLevel,
    lcrOutflowRate: rule.lcrOutflowRate,
    lcrInflowRate: rule.lcrInflowRate,
    nsfrAsfFactor: rule.nsfrAsfFactor,
    nsfrRsfFactor: rule.nsfrRsfFactor,
  };
};

export const regulatoryRiskWeight = (productType: ProductType): number =>
  getCreditRiskRule(productType).performingRiskWeight;

export const defaultedRiskWeight = (
  productType: ProductType,
  grossExposure: number,
  allowance: number
): number => {
  const rule = getCreditRiskRule(productType);
  if (rule.defaultedTreatment === 'mortgage') return 1;
  if (rule.defaultedTreatment === 'provisionSensitive') {
    return allowance >= 0.2 * Math.max(0, grossExposure) ? 1 : 1.5;
  }
  return rule.performingRiskWeight;
};

export const productTypesWithFundingMaturityTreatment = (): ProductType[] =>
  (Object.keys(PRODUCTS) as ProductType[]).filter(
    productType => getLiquidityRule(productType).fundingMaturityTreatment !== undefined
  );

export const productTypesWithLeverageTreatment = (treatment: LeverageRegulatoryClass): ProductType[] =>
  (Object.keys(PRODUCTS) as ProductType[]).filter(
    productType => getRegulatoryClassification(productType).leverage === treatment
  );

/**
 * Tier 2 is recorded separately in capital state for accounting continuity.
 * When a classified Tier 2 liability exists, prudential eligibility cannot
 * exceed its outstanding balance. Legacy states without a line retain their
 * recorded Tier 2 amount.
 */
export const eligibleTier2OwnFunds = (state: BankState): number => {
  const recorded = Math.max(0, state.financial.capital.tier2 ?? 0);
  let hasClassifiedLine = false;
  const classifiedBalance = state.financial.balanceSheet.items.reduce((sum, item) => {
    if (getCapitalRule(item.productType).ownFundsTier !== 'tier2') return sum;
    hasClassifiedLine = true;
    return sum + Math.max(0, item.balance);
  }, 0);
  return hasClassifiedLine ? Math.min(recorded, classifiedBalance) : recorded;
};
