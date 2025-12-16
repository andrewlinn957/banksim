import {
  AssetProductType,
  BalanceSheetSide,
  Currency,
  LiabilityProductType,
  MaturityBucket,
  ProductType,
} from '../domain/enums';
import { BalanceSheet, BalanceSheetItem } from '../domain/balanceSheet';
import { BankState, BehaviouralState, SimulationTime } from '../domain/bankState';
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
});

const balanceSheet: BalanceSheet = {
  items: [
    makeItem(
      BalanceSheetSide.Asset,
      AssetProductType.CashReserves,
      'Cash & Reserves',
      30e9,
      0.045,
      MaturityBucket.Overnight
    ),
    makeItem(
      BalanceSheetSide.Asset,
      AssetProductType.Gilts,
      'Gilts',
      60e9,
      0.04,
      MaturityBucket.GreaterThan5Y
    ),
    makeItem(
      BalanceSheetSide.Asset,
      AssetProductType.Mortgages,
      'Mortgages',
      250e9,
      0.055,
      MaturityBucket.GreaterThan5Y
    ),
    makeItem(
      BalanceSheetSide.Asset,
      AssetProductType.CorporateLoans,
      'Corporate Loans',
      160e9,
      0.065,
      MaturityBucket.ThreeToFiveY
    ),
    makeItem(
      BalanceSheetSide.Asset,
      AssetProductType.ReverseRepo,
      'Reverse Repo',
      0,
      0.04,
      MaturityBucket.LessThan1Y
    ),
    makeItem(
      BalanceSheetSide.Liability,
      LiabilityProductType.RetailDeposits,
      'Retail Deposits',
      260e9,
      0.02,
      MaturityBucket.LessThan1Y
    ),
    makeItem(
      BalanceSheetSide.Liability,
      LiabilityProductType.CorporateDeposits,
      'Corporate Deposits',
      90e9,
      0.03,
      MaturityBucket.LessThan1Y
    ),
    makeItem(
      BalanceSheetSide.Liability,
      LiabilityProductType.WholesaleFundingST,
      'Wholesale Funding ST',
      30e9,
      0.055,
      MaturityBucket.LessThan1Y
    ),
    makeItem(
      BalanceSheetSide.Liability,
      LiabilityProductType.WholesaleFundingLT,
      'Wholesale Funding LT',
      70e9,
      0.06,
      MaturityBucket.GreaterThan5Y
    ),
    makeItem(
      BalanceSheetSide.Liability,
      LiabilityProductType.RepurchaseAgreements,
      'Repo Borrowing',
      0,
      0.05,
      MaturityBucket.LessThan1Y
    ),
  ],
};

const capital: CapitalState = {
  cet1: 40e9,
  at1: 10e9,
};

const incomeStatement: IncomeStatement = {
  interestIncome: 0,
  interestExpense: 0,
  netInterestIncome: 0,
  feeIncome: 0,
  creditLosses: 0,
  operatingExpenses: 0,
  preTaxProfit: 0,
  tax: 0,
  netIncome: 0,
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
  leverageRatio: 0,
  hqla: 0,
  lcr: 0,
  lcrOutflowMultiplier: 1,
  asf: 0,
  rsf: 0,
  nsfr: 0,
};

const placeholderCompliance: ComplianceStatus = {
  cet1Breached: false,
  leverageBreached: false,
  lcrBreached: false,
  nsfrBreached: false,
};

const UK_U_MIN = 0.02;
const UK_U_MAX = 0.12;
const NS_LAMBDA = 0.7;

const giltYields = {
  y1: 0.0378,
  y2: 0.0378,
  y3: 0.0382,
  y5: 0.0397,
  y10: 0.0449,
  y20: 0.0511,
  y30: 0.0521,
};

const nsFactors = fitNelsonSiegelFrom3Points(NS_LAMBDA, [
  { mYears: 1, y: giltYields.y1 },
  { mYears: 5, y: giltYields.y5 },
  { mYears: 20, y: giltYields.y20 },
]);

const market: MarketState = {
  baseRate: 0.04,
  riskFreeShort: giltYields.y1,
  riskFreeLong: giltYields.y5,
  mortgageSpread: 0.015,
  corporateLoanSpread: 0.025,
  wholesaleFundingSpread: 0.01,
  seniorDebtSpread: 0.01,
  giltRepoHaircut: 0.02,
  corpBondRepoHaircut: 0.05,
  competitorRetailDepositRate: 0.015,
  competitorMortgageRate: 0.05,
  competitorCorporateDepositRate: 0.02,

  gdpGrowthMoM: 0.001,
  unemploymentRate: 0.051,
  inflationRate: 0.038,

  creditSpread: 0.011,
  giltCurve: {
    nelsonSiegel: { ...nsFactors, lambda: NS_LAMBDA },
    yields: giltYields,
  },
  macroModel: {
    factors: { D: 0, S: 0, F: 0, R: 0 },
    gdpRegime: 'normal',
    unemploymentLatent: unemploymentToLatent(0.051, UK_U_MIN, UK_U_MAX),
    termPremium: 0.0185,
    rngSeed: 123456789,
  },
};

const behaviour: BehaviouralState = {
  depositFranchiseStrength: 0.7,
  reputation: 0.8,
  ratingNotchOffset: 0,
};

const time: SimulationTime = {
  step: 0,
  date: new Date('2024-01-01T00:00:00Z'),
  stepLengthMonths: 1,
};

const seedState: BankState = {
  version: 'v1',
  time,
  balanceSheet,
  capital,
  incomeStatement,
  cashFlowStatement,
  riskMetrics: placeholderRiskMetrics,
  compliance: placeholderCompliance,
  market,
  behaviour,
  loanCohorts: {},
  isInResolution: false,
  hasFailed: false,
};

const initialPortfolioSeed = baseConfig.global.initialPortfolioSeed ?? seedState.market.macroModel.rngSeed;

const seedLoanCohorts = (productType: AssetProductType): void => {
  const item = seedState.balanceSheet.items.find((i) => i.productType === productType);
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

const riskMetrics = calculateRiskMetrics({ state: seedState, config: baseConfig });
const compliance = evaluateCompliance(riskMetrics, baseConfig.riskLimits);

export const initialState: BankState = {
  ...seedState,
  riskMetrics,
  compliance,
};
