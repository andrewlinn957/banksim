import {
  AssetProductType,
  BalanceSheetSide,
  Currency,
  LiabilityProductType,
  MaturityBucket,
  ProductType,
} from '../domain/enums';
import { BalanceSheet, BalanceSheetItem } from '../domain/balanceSheet';
import {
  BankState,
  BehaviouralState,
  BoardPressureState,
  EquityMarketState,
  FinancialState,
  RiskState,
  SimulationStatus,
  SimulationTime,
} from '../domain/bankState';
import { CapitalState, ComplianceStatus, RiskMetrics } from '../domain/risks';
import { IncomeStatement } from '../domain/pnl';
import { baseConfig } from './baseConfig';
import { MarketState } from '../domain/market';
import { CashFlowStatement } from '../domain/cashflow';
import { calculateRiskMetrics, evaluateCompliance } from '../engine/metrics';
import { fitNelsonSiegelFrom3Points } from '../engine/ukMarketModel';
import { generateSeasonedLoanCohorts, sumLoanOutstanding } from '../engine/loanCohorts';

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const logit = (p: number): number => Math.log(p / (1 - p));

const unemploymentToLatent = (u: number, uMin: number, uMax: number): number => {
  const p = clamp01((u - uMin) / (uMax - uMin));
  const safeP = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return logit(safeP);
};

const makeItem = (
  side: BalanceSheetSide,
  productType: ProductType,
  label: string,
  balance: number,
  interestRate: number,
  maturityBucket: MaturityBucket
): BalanceSheetItem => ({
  side,
  productType,
  label,
  currency: Currency.GBP,
  balance,
  interestRate,
  maturityBucket,
  liquidityTag: baseConfig.liquidityTags[productType],
  encumbrance: { encumberedAmount: 0 },
  security: baseConfig.behaviour.securitiesAccounting?.defaultClassificationByProduct?.[productType]
    ? {
        classification:
          baseConfig.behaviour.securitiesAccounting.defaultClassificationByProduct[productType] ?? 'FVOCI',
        effectiveDurationYears:
          baseConfig.behaviour.securitiesAccounting.effectiveDurationYearsByProduct?.[productType] ?? 0,
        valuationReferenceYield: 0,
      }
    : undefined,
});

const balanceSheet: BalanceSheet = {
  items: [
    makeItem(
      BalanceSheetSide.Asset,
      AssetProductType.CashReserves,
      'Cash & Reserves',
      2.811e9,
      0.031,
      MaturityBucket.Overnight
    ),
    makeItem(
      BalanceSheetSide.Asset,
      AssetProductType.Gilts,
      'Gilts',
      5.758e9,
      0.029,
      MaturityBucket.GreaterThan5Y
    ),
    makeItem(
      BalanceSheetSide.Asset,
      AssetProductType.Mortgages,
      'Mortgages',
      5.145e9,
      0.05,
      MaturityBucket.GreaterThan5Y
    ),
    makeItem(
      BalanceSheetSide.Asset,
      AssetProductType.CorporateLoans,
      'Corporate Loans',
      3.868e9,
      0.058,
      MaturityBucket.ThreeToFiveY
    ),
    makeItem(
      BalanceSheetSide.Asset,
      AssetProductType.ReverseRepo,
      'Reverse Repo',
      0,
      0.047,
      MaturityBucket.LessThan1Y
    ),
    makeItem(
      BalanceSheetSide.Liability,
      LiabilityProductType.RetailTransactionalDeposits,
      'Retail Transactional Deposits',
      1.646e9,
      0.007,
      MaturityBucket.LessThan1Y
    ),
    makeItem(
      BalanceSheetSide.Liability,
      LiabilityProductType.RetailSavingsDeposits,
      'Retail Savings Deposits',
      6.107e9,
      0.0215,
      MaturityBucket.LessThan1Y
    ),
    makeItem(
      BalanceSheetSide.Liability,
      LiabilityProductType.CorporateOperatingDeposits,
      'Corporate Operating Deposits',
      6.505e9,
      0.0205,
      MaturityBucket.LessThan1Y
    ),
    makeItem(
      BalanceSheetSide.Liability,
      LiabilityProductType.CorporateNonOperatingDeposits,
      'Corporate Non-Operating Deposits',
      0.2e9,
      0.03,
      MaturityBucket.LessThan1Y
    ),
    makeItem(
      BalanceSheetSide.Liability,
      LiabilityProductType.WholesaleFundingST,
      'Wholesale Funding ST',
      0.4e9,
      0.05,
      MaturityBucket.LessThan1Y
    ),
    makeItem(
      BalanceSheetSide.Liability,
      LiabilityProductType.WholesaleFundingLT,
      'Wholesale Funding LT',
      1.372e9,
      0.053,
      MaturityBucket.GreaterThan5Y
    ),
    makeItem(
      BalanceSheetSide.Liability,
      LiabilityProductType.RepurchaseAgreements,
      'Repo Borrowing',
      0.391e9,
      0.048,
      MaturityBucket.LessThan1Y
    ),
  ],
};

const capital: CapitalState = {
  // Calibrated toward Metro 2024 year-end mix (higher CET1, lower AT1),
  // while keeping total opening equity unchanged for balance-sheet consistency.
  cet1: 0.808e9,
  at1: 0.136e9,
  accumulatedOCI: 0.017e9,
};

const incomeStatement: IncomeStatement = {
  interestIncome: 0,
  interestExpense: 0,
  netInterestIncome: 0,
  fvtplValuationImpact: 0,
  fvociOciMovement: 0,
  hedgeCarry: 0,
  feeIncome: 0,
  creditLosses: 0,
  provisionCharge: 0,
  realizedLoanLosses: 0,
  realizedNonLoanLosses: 0,
  operatingExpenses: 0,
  fixedOperatingCosts: 0,
  servicingCosts: 0,
  originationCosts: 0,
  workoutCosts: 0,
  conductCosts: 0,
  at1CouponExpense: 0,
  dividendsPaid: 0,
  preTaxProfit: 0,
  tax: 0,
  netIncome: 0,
  totalComprehensiveIncome: 0,
};

const cashFlowStatement: CashFlowStatement = {
  cashStart: 0,
  cashEnd: 0,
  netChange: 0,
  operatingCashFlow: 0,
  investingCashFlow: 0,
  financingCashFlow: 0,
};

const placeholderRiskMetrics: RiskMetrics = {
  rwa: 0,
  leverageExposure: 0,
  cet1Ratio: 0,
  cet1Requirement: 0,
  cet1Headroom: 0,
  leverageRatio: 0,
  hqla: 0,
  lcr: 0,
  lcrOutflowMultiplier: 1,
  depositQualityIndex: 1,
  asf: 0,
  rsf: 0,
  nsfr: 0,
  fundingStressIndex: 0,
  fundingConfidenceScore: 1,
  fundingConfidenceState: 'stable',
  internalCet1TargetRatio: 0,
  internalCet1Headroom: 0,
  payoutBlockedByInternalTarget: false,
  conductRiskScore: 0,
  niiSensitivity100bp: 0,
  eveSensitivity100bp: 0,
  fundingMaturing3m: 0,
  fundingMaturing12m: 0,
  mdaTriggered: false,
  maxPayoutRatio: 0,
  sectorConcentration: 0,
  geographyConcentration: 0,
  concentrationHhi: 0,
  boardPressureScore: 0,
  boardPressureVolatility: 0,
  boardPressureFranchiseGap: 0,
  boardPressureRiskGap: 0,
  boardPressurePayoutRestraint: 0,
};

const placeholderCompliance: ComplianceStatus = {
  cet1Breached: false,
  leverageBreached: false,
  lcrBreached: false,
  nsfrBreached: false,
  concentrationBreached: false,
  mdaTriggered: false,
};

const UK_U_MIN = 0.02;
const UK_U_MAX = 0.12;
const NS_LAMBDA = 0.7;

const giltYields = {
  y1: 0.041,
  y2: 0.0415,
  y3: 0.0418,
  y5: 0.0405,
  y10: 0.0417,
  y20: 0.045,
  y30: 0.0465,
};

const nsFactors = fitNelsonSiegelFrom3Points(NS_LAMBDA, [
  { mYears: 1, y: giltYields.y1 },
  { mYears: 5, y: giltYields.y5 },
  { mYears: 20, y: giltYields.y20 },
]);

const market: MarketState = {
  baseRate: 0.0475,
  riskFreeShort: giltYields.y1,
  riskFreeLong: giltYields.y30,
  mortgageSpread: 0.013,
  corporateLoanSpread: 0.021,
  wholesaleFundingSpread: 0.012,
  seniorDebtSpread: 0.014,
  giltRepoHaircut: 0.02,
  corpBondRepoHaircut: 0.05,
  competitorRetailDepositRate: 0.019,
  competitorMortgageRate: 0.049,
  competitorCorporateDepositRate: 0.021,

  gdpGrowthMoM: 0.0002,
  unemploymentRate: 0.045,
  inflationRate: 0.028,

  creditSpread: 0.012,
  giltCurve: {
    nelsonSiegel: { ...nsFactors, lambda: NS_LAMBDA },
    yields: giltYields,
  },
  macroModel: {
    factors: { D: 0, S: 0, F: 0, R: 0 },
    gdpRegime: 'normal',
    unemploymentLatent: unemploymentToLatent(0.045, UK_U_MIN, UK_U_MAX),
    termPremium: 0.0155,
    rngSeed: 123456789,
  },
};

const behaviour: BehaviouralState = {
  depositFranchiseStrength: 0.7,
  reputation: 0.84,
  ratingNotchOffset: 0,
  depositRateLagMemory: {
    [LiabilityProductType.RetailTransactionalDeposits]: 0.007,
    [LiabilityProductType.RetailSavingsDeposits]: 0.0215,
    [LiabilityProductType.CorporateOperatingDeposits]: 0.0205,
    [LiabilityProductType.CorporateNonOperatingDeposits]: 0.03,
  },
  depositUnderpricingMonths: {
    [LiabilityProductType.RetailTransactionalDeposits]: 0,
    [LiabilityProductType.RetailSavingsDeposits]: 0,
    [LiabilityProductType.CorporateOperatingDeposits]: 0,
    [LiabilityProductType.CorporateNonOperatingDeposits]: 0,
  },
  depositStabilityIndex: {
    [LiabilityProductType.RetailTransactionalDeposits]: 1.035,
    [LiabilityProductType.RetailSavingsDeposits]: 1.0925,
    [LiabilityProductType.CorporateOperatingDeposits]: 0.92,
    [LiabilityProductType.CorporateNonOperatingDeposits]: 0.667,
  },
  underwritingTightness: {
    [AssetProductType.Mortgages]: 0,
    [AssetProductType.CorporateLoans]: 0,
  },
  capitalPolicy: {
    dividendPayoutRatio: baseConfig.riskLimits.capitalPolicy.defaultDividendPayoutRatio,
    at1CouponMode: 'auto',
  },
  previousNetIncome: 0,
  earningsVolatility: 0,
  fundingConfidenceScore: 1,
  fundingConfidenceState: 'stable',
  confidenceUpgradeProgressMonths: 0,
  conductRiskScore: 0,
  conductEventCooldownMonths: 0,
  conductEventCount: 0,
  cumulativeConductCosts: 0,
};

const financial: FinancialState = {
  balanceSheet,
  capital,
  provisionStock: {
    stage1: 0,
    stage2: 0,
    stage3: 0,
    total: 0,
  },
  hedges: [],
  incomeStatement,
  cashFlowStatement,
};

const risk: RiskState = {
  riskMetrics: placeholderRiskMetrics,
  compliance: placeholderCompliance,
};

const board: BoardPressureState = {
  score: 0,
  earningsVolatility: 0,
  franchiseGap: 0,
  riskGap: 0,
  payoutRestraint: 0,
};

const equityMarket: EquityMarketState = {
  sharesOutstanding: 1e9,
  sharePrice: 0.74,
  marketCap: 0.74e9,
  epsTtm: 0.085,
  peMultiple: 8.7,
  bookValuePerShare: 0.825,
  priceToBook: 0.897,
  fairValuePerShare: 0.74,
};

const status: SimulationStatus = {
  isInResolution: false,
  hasFailed: false,
};

const time: SimulationTime = {
  step: 0,
  date: new Date('2024-12-31T00:00:00Z'),
  stepLengthMonths: 1,
};

const seedState: BankState = {
  version: 'v1',
  time,
  financial,
  risk,
  board,
  equityMarket,
  market,
  behaviour,
  loanCohorts: {},
  loanPipelines: {
    [AssetProductType.Mortgages]: {
      demandNotional: 0,
      approvedNotional: 0,
      committedNotional: 0,
    },
    [AssetProductType.CorporateLoans]: {
      demandNotional: 0,
      approvedNotional: 0,
      committedNotional: 0,
    },
  },
  workoutPipelines: {
    [AssetProductType.Mortgages]: [],
    [AssetProductType.CorporateLoans]: [],
  },
  fundingLadders: {
    [LiabilityProductType.WholesaleFundingST]: [
      { tenorMonths: 1, monthsToMaturity: 1, notional: 133e6, rate: 0.05 },
      { tenorMonths: 3, monthsToMaturity: 3, notional: 133e6, rate: 0.05 },
      { tenorMonths: 6, monthsToMaturity: 6, notional: 134e6, rate: 0.05 },
    ],
    [LiabilityProductType.WholesaleFundingLT]: [
      { tenorMonths: 24, monthsToMaturity: 24, notional: 450e6, rate: 0.053 },
      { tenorMonths: 36, monthsToMaturity: 36, notional: 450e6, rate: 0.053 },
      { tenorMonths: 60, monthsToMaturity: 60, notional: 472e6, rate: 0.053 },
    ],
  },
  status,
};

const initialPortfolioSeed = baseConfig.global.initialPortfolioSeed ?? seedState.market.macroModel.rngSeed;

const seedLoanCohorts = (productType: AssetProductType): void => {
  const item = seedState.financial.balanceSheet.items.find((i) => i.productType === productType);
  if (!item) {
    throw new Error(`Missing balance sheet item for ${productType} while seeding loan cohorts`);
  }
  if (item.balance <= 0) return;

  const params = baseConfig.productParameters[productType];
  const cohorts = generateSeasonedLoanCohorts({
    productType,
    targetOutstanding: item.balance,
    baseAnnualInterestRate: item.interestRate,
    baseAnnualPd: params.baseDefaultRate,
    baseLgd: params.lossGivenDefault,
    config: baseConfig,
    seed: initialPortfolioSeed + (productType === AssetProductType.Mortgages ? 0 : 1),
  });
  seedState.loanCohorts[productType] = cohorts;
  item.balance = sumLoanOutstanding(cohorts);
};

seedLoanCohorts(AssetProductType.Mortgages);
seedLoanCohorts(AssetProductType.CorporateLoans);

seedState.financial.balanceSheet.items.forEach((item) => {
  if (!item.security) return;
  item.security.valuationReferenceYield = seedState.market.riskFreeLong;
});

const riskMetrics = calculateRiskMetrics({ state: seedState, config: baseConfig });
const compliance = evaluateCompliance(riskMetrics, baseConfig.riskLimits);

export const initialState: BankState = {
  ...seedState,
  behaviour: {
    ...seedState.behaviour,
    fundingConfidenceScore: riskMetrics.fundingConfidenceScore,
    fundingConfidenceState: riskMetrics.fundingConfidenceState,
    confidenceUpgradeProgressMonths: 0,
    conductRiskScore: riskMetrics.conductRiskScore,
    conductEventCooldownMonths: 0,
    conductEventCount: 0,
    cumulativeConductCosts: 0,
  },
  board: {
    score: riskMetrics.boardPressureScore,
    earningsVolatility: riskMetrics.boardPressureVolatility,
    franchiseGap: riskMetrics.boardPressureFranchiseGap,
    riskGap: riskMetrics.boardPressureRiskGap,
    payoutRestraint: riskMetrics.boardPressurePayoutRestraint,
  },
  risk: {
    ...seedState.risk,
    riskMetrics,
    compliance,
  },
};
