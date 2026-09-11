import { securityEcl } from '../engine/securityImpairment';
import {
  AssetProductType,
  LiabilityProductType,
  MaturityBucket,
} from '../domain/enums';
import { BalanceSheet } from '../domain/balanceSheet';
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
import { initializeOpeningSupervisoryAssessments } from '../engine/supervisoryAssessments';
import { fitNelsonSiegelFrom3Points } from '../engine/ukMarketModel';
import { calculateProvisionTargetFromCohorts, generateSeasonedLoanCohorts, sumLoanOutstanding } from '../engine/loanCohorts';
import { createPosition } from '../products/factory';
import { requireProductPosition } from '../products/selectors';

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const logit = (p: number): number => Math.log(p / (1 - p));

const unemploymentToLatent = (u: number, uMin: number, uMax: number): number => {
  const p = clamp01((u - uMin) / (uMax - uMin));
  const safeP = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return logit(safeP);
};

const OPENING_BANK_RATE = 0.0475;

const balanceSheet: BalanceSheet = {
  items: [
    createPosition(baseConfig, {
      productType: AssetProductType.CashReserves,
      balance: 1.2e9,
      // Uninvested sterling liquidity sits in the Bank of England reserve account.
      // The opening remuneration rate is therefore Bank Rate, not a treasury spread assumption.
      interestRate: OPENING_BANK_RATE,
      maturityBucket: MaturityBucket.Overnight,
    }),
    createPosition(baseConfig, {
      productType: AssetProductType.Gilts,
      balance: 1.2e9,
      interestRate: 0.041,
      maturityBucket: MaturityBucket.GreaterThan5Y,
    }),
    createPosition(baseConfig, {
      productType: AssetProductType.Mortgages,
      balance: 7.2e9,
      interestRate: 0.050,
      maturityBucket: MaturityBucket.GreaterThan5Y,
    }),
    createPosition(baseConfig, {
      productType: AssetProductType.ConsumerLoans,
      balance: 1.0e9,
      interestRate: 0.105,
      maturityBucket: MaturityBucket.ThreeToFiveY,
    }),
    createPosition(baseConfig, {
      productType: AssetProductType.CorporateLoans,
      balance: 2.961e9,
      interestRate: 0.068,
      maturityBucket: MaturityBucket.GreaterThan5Y,
    }),
    createPosition(baseConfig, {
      productType: LiabilityProductType.RetailCurrentAccounts,
      balance: 7.0e9,
      interestRate: 0.017,
      maturityBucket: MaturityBucket.LessThan1Y,
    }),
    createPosition(baseConfig, {
      productType: LiabilityProductType.RetailTermDeposits,
      balance: 1.5e9,
      interestRate: 0.038,
      maturityBucket: MaturityBucket.OneToThreeY,
    }),
    createPosition(baseConfig, {
      productType: LiabilityProductType.CorporateOperatingDeposits,
      balance: 3.0e9,
      interestRate: 0.0205,
      maturityBucket: MaturityBucket.LessThan1Y,
    }),
    createPosition(baseConfig, {
      productType: LiabilityProductType.CorporateNonOperatingDeposits,
      balance: 0.3e9,
      // Keep the opening non-operating offer close to the corporate market. The prior 3% rate
      // versus a 2.1% market rate mechanically attracted unstable balances in a no-action run.
      interestRate: 0.021,
      maturityBucket: MaturityBucket.LessThan1Y,
    }),
    createPosition(baseConfig, {
      productType: LiabilityProductType.WholesaleFundingLT,
      balance: 0.72e9,
      interestRate: 0.053,
      maturityBucket: MaturityBucket.GreaterThan5Y,
    }),
  ],
};

const capital: CapitalState = {
  // Start with a modest management cushion above the automatic internal CET1 target. The extra
  // CET1 replaces long-term wholesale funding rather than increasing the opening balance sheet.
  cet1: 1.000e9,
  at1: 0.024e9,
  tier2: 0,
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
  baseRate: OPENING_BANK_RATE,
  riskFreeShort: giltYields.y1,
  riskFreeLong: giltYields.y30,
  mortgageSpread: 0.013,
  consumerLoanSpread: 0.057,
  corporateLoanSpread: 0.021,
  wholesaleFundingSpread: 0.012,
  seniorDebtSpread: 0.014,
  giltRepoHaircut: 0.02,
  corpBondRepoHaircut: 0.05,
  competitorRetailCurrentAccountRate: 0.019,
  competitorTermDepositRate: 0.038,
  competitorMortgageRate: 0.049,
  competitorConsumerLoanRate: 0.105,
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
    [LiabilityProductType.RetailCurrentAccounts]: 0.017,
    [LiabilityProductType.RetailTermDeposits]: 0.038,
    [LiabilityProductType.CorporateOperatingDeposits]: 0.0205,
    [LiabilityProductType.CorporateNonOperatingDeposits]: 0.021,
  },
  depositUnderpricingMonths: {
    [LiabilityProductType.RetailCurrentAccounts]: 0,
    [LiabilityProductType.RetailTermDeposits]: 0,
    [LiabilityProductType.CorporateOperatingDeposits]: 0,
    [LiabilityProductType.CorporateNonOperatingDeposits]: 0,
  },
  depositStabilityIndex: {
    [LiabilityProductType.RetailCurrentAccounts]: 1.0,
    [LiabilityProductType.RetailTermDeposits]: 1.1,
    [LiabilityProductType.CorporateOperatingDeposits]: 0.92,
    [LiabilityProductType.CorporateNonOperatingDeposits]: 0.667,
  },
  underwritingTightness: {
    [AssetProductType.Mortgages]: 0,
    [AssetProductType.ConsumerLoans]: 0.35,
    [AssetProductType.CorporateLoans]: 0.25,
  },
  mortgagePolicy: { maxLtv: 0.85, fixedPeriodMonths: 24 },
  // This is descriptive legacy UI state, not an instruction to rebalance every month. It matches
  // the physical opening 50/50 reserves/gilt mix so the first no-change UI step does not trade.
  treasuryPolicy: { giltShareOfHqla: 0.5, giltDurationYears: 5 },
  termDepositTenorMonths: 12,
  insuredRetailDepositShare: 0.9,
  largeDepositorShare: 0.04,
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
  date: new Date('2025-12-31T00:00:00Z'),
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
    [AssetProductType.ConsumerLoans]: { demandNotional: 0, approvedNotional: 0, committedNotional: 0 },
    [AssetProductType.CorporateLoans]: {
      demandNotional: 0,
      approvedNotional: 0,
      committedNotional: 0,
    },
  },
  workoutPipelines: {
    [AssetProductType.Mortgages]: [],
    [AssetProductType.ConsumerLoans]: [],
    [AssetProductType.CorporateLoans]: [],
  },
  assetMaturityLadders: {
    [AssetProductType.Gilts]: Array.from({ length: 120 }, (_, i) => ({
      tenorMonths: 120,
      monthsToMaturity: i + 1,
      notional: 10e6,
      rate: 0.041,
    })),
  },
  fundingLadders: {
    [LiabilityProductType.RetailTermDeposits]: Array.from({ length: 12 }, (_, i) => ({ tenorMonths: 12, monthsToMaturity: i + 1, notional: 125e6, rate: 0.038 })),
    [LiabilityProductType.WholesaleFundingLT]: [
      { tenorMonths: 24, monthsToMaturity: 24, notional: 0.72e9 / 3, rate: 0.053 },
      { tenorMonths: 36, monthsToMaturity: 36, notional: 0.72e9 / 3, rate: 0.053 },
      { tenorMonths: 60, monthsToMaturity: 60, notional: 0.72e9 / 3, rate: 0.053 },
    ],
    [LiabilityProductType.BankOfEnglandFunding]: [],
    [LiabilityProductType.Tier2Debt]: [],
  },
  status,
};

const initialPortfolioSeed = baseConfig.global.initialPortfolioSeed ?? seedState.market.macroModel.rngSeed;

const seedLoanCohorts = (productType: AssetProductType): void => {
  const item = requireProductPosition(
    seedState.financial.balanceSheet,
    productType,
    `Missing balance sheet item for ${productType} while seeding loan cohorts`
  );
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
  const net = sumLoanOutstanding(cohorts);
  const unitAllowance = calculateProvisionTargetFromCohorts({ state: seedState, config: baseConfig, productType }).total;
  const scale = net / Math.max(1, net - unitAllowance);
  cohorts.forEach(c => { c.outstandingPrincipal *= scale; c.originalPrincipal *= scale; });
  const allowance = calculateProvisionTargetFromCohorts({ state: seedState, config: baseConfig, productType });
  item.lossAllowance = allowance.total;
  item.balance = sumLoanOutstanding(cohorts) - allowance.total;
  for (const stage of ['stage1', 'stage2', 'stage3', 'total'] as const) seedState.financial.provisionStock[stage] += allowance[stage];
};

seedLoanCohorts(AssetProductType.Mortgages);
seedLoanCohorts(AssetProductType.ConsumerLoans);
seedLoanCohorts(AssetProductType.CorporateLoans);

seedState.financial.balanceSheet.items.forEach((item) => {
  if (!item.security) return;
  item.security.valuationReferenceYield =
    item.productType === AssetProductType.Gilts ? giltYields.y5 : seedState.market.riskFreeLong;
  item.security.amortisedCost = item.balance;
  item.security.lossAllowance = securityEcl(item, baseConfig);
  if (item.security.classification === 'FVOCI') {
    seedState.financial.capital.cet1 -= item.security.lossAllowance;
    seedState.financial.capital.accumulatedOCI += item.security.lossAllowance;
  }
});

initializeOpeningSupervisoryAssessments(seedState, baseConfig);
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