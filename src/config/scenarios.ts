// Simple scenario system with scheduled shocks and initial state overrides
import { BankState } from '../domain/bankState';
import { Shock } from '../domain/shocks';
import { initialState as baseInitialState } from './initialState';
import { BalanceSheetItem } from '../domain/balanceSheet';
import { LiabilityProductType, AssetProductType, ProductType } from '../domain/enums';
import { SimulationConfig } from '../domain/config';
import { baseConfig } from './baseConfig';
import { calculateRiskMetrics, evaluateCompliance } from '../engine/metrics';
import { LoanCohort } from '../domain/loanCohorts';
import { generateSeasonedLoanCohorts, sumLoanOutstanding } from '../engine/loanCohorts';

export interface ScheduledShock {
  stepNumber: number;
  shock: Shock;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  initialStateOverride?: Partial<BankState> & {
    financial?: {
      balanceSheet?: {
        items?: Array<Partial<BalanceSheetItem> & { productType: ProductType }>;
      };
    };
  };
  scheduledShocks: ScheduledShock[];
  configOverrides?: Partial<SimulationConfig>;
}

const cloneBankState = (state: BankState): BankState => ({
  ...state,
  time: { ...state.time, date: new Date(state.time.date.getTime()) },
  financial: {
    balanceSheet: {
      items: state.financial.balanceSheet.items.map((i) => ({
        ...i,
        encumbrance: i.encumbrance ? { ...i.encumbrance } : { encumberedAmount: 0 },
        liquidityTag: i.liquidityTag ? { ...i.liquidityTag } : undefined,
      })),
    },
    capital: { ...state.financial.capital },
    incomeStatement: { ...state.financial.incomeStatement },
    cashFlowStatement: { ...state.financial.cashFlowStatement },
  },
  risk: {
    riskMetrics: { ...state.risk.riskMetrics },
    compliance: { ...state.risk.compliance },
  },
  market: {
    ...state.market,
    giltCurve: {
      ...state.market.giltCurve,
      nelsonSiegel: { ...state.market.giltCurve.nelsonSiegel },
      yields: { ...state.market.giltCurve.yields },
    },
    macroModel: {
      ...state.market.macroModel,
      factors: { ...state.market.macroModel.factors },
    },
  },
  behaviour: { ...state.behaviour },
  status: { ...state.status },
  loanCohorts: Object.fromEntries(
    Object.entries(state.loanCohorts ?? {}).map(([productType, cohorts]) => [
      productType,
      (cohorts as LoanCohort[]).map((c) => ({ ...c })),
    ])
  ) as Partial<Record<ProductType, LoanCohort[]>>,
});

const applyInitialOverride = (
  override: Scenario['initialStateOverride'] | undefined,
  config: SimulationConfig
): BankState => {
  const state = cloneBankState(baseInitialState);
  if (override?.financial?.balanceSheet?.items) {
    state.financial.balanceSheet.items = state.financial.balanceSheet.items.map((item) => {
      const ov = override.financial?.balanceSheet?.items?.find((o) => o.productType === item.productType);
      if (!ov) return item;
      return {
        ...item,
        ...ov,
        encumbrance: ov.encumbrance ? { ...ov.encumbrance } : item.encumbrance,
      };
    });
  }
  if (override?.financial?.capital) {
    state.financial.capital = { ...state.financial.capital, ...override.financial.capital };
  }
  if (override?.financial?.incomeStatement) {
    state.financial.incomeStatement = {
      ...state.financial.incomeStatement,
      ...override.financial.incomeStatement,
    };
  }
  if (override?.financial?.cashFlowStatement) {
    state.financial.cashFlowStatement = {
      ...state.financial.cashFlowStatement,
      ...override.financial.cashFlowStatement,
    };
  }
  if (override?.market) {
    state.market = { ...state.market, ...override.market };
  }
  if (override?.behaviour) {
    state.behaviour = { ...state.behaviour, ...override.behaviour };
  }
  if (override?.status) {
    state.status = { ...state.status, ...override.status };
  }

  const initialSeed = config.global.initialPortfolioSeed ?? state.market.macroModel.rngSeed;
  const loanProducts = [AssetProductType.Mortgages, AssetProductType.CorporateLoans] as const;
  loanProducts.forEach((productType, idx) => {
    const item = state.financial.balanceSheet.items.find((i) => i.productType === productType);
    if (!item) return;
    if (item.balance <= 0) {
      state.loanCohorts[productType] = [];
      return;
    }

    const cohorts = state.loanCohorts[productType] ?? [];
    const sum = sumLoanOutstanding(cohorts);
    if (sum > 0) {
      const scale = item.balance / sum;
      cohorts.forEach((c) => {
        c.outstandingPrincipal *= scale;
        c.originalPrincipal *= scale;
      });
      state.loanCohorts[productType] = cohorts;
      item.balance = sumLoanOutstanding(cohorts);
      return;
    }

    const params = config.productParameters[productType];
    const seeded = generateSeasonedLoanCohorts({
      productType,
      targetOutstanding: item.balance,
      baseAnnualInterestRate: item.interestRate,
      baseAnnualPd: params.baseDefaultRate,
      baseLgd: params.lossGivenDefault,
      config,
      seed: initialSeed + idx,
    });
    state.loanCohorts[productType] = seeded;
    item.balance = sumLoanOutstanding(seeded);
  });

  state.risk.riskMetrics = calculateRiskMetrics({ state, config });
  state.risk.compliance = evaluateCompliance(state.risk.riskMetrics, config.riskLimits);
  return state;
};

export const scenarios: Scenario[] = [
  {
    id: 'wholesale-funding-reliance',
    name: 'Wholesale Funding Reliance',
    description:
      'Bank leans on short-term wholesale funding with weaker deposits. Early market spread shock and liquidity run stress funding resilience.',
    initialStateOverride: {
      financial: {
        balanceSheet: {
          items: [
            { productType: LiabilityProductType.WholesaleFundingST, balance: 80e9 },
            { productType: LiabilityProductType.RetailDeposits, balance: 200e9 },
          ],
        },
      },
    },
    scheduledShocks: [
      {
        stepNumber: 0,
        shock: {
          type: 'marketSpreadShock',
          wholesaleSpreadBps: 120,
          loanSpreadBps: 40,
          repoHaircutIncreasePct: 0.02,
        },
      },
      {
        stepNumber: 0,
        shock: {
          type: 'idiosyncraticRun',
          outflowRateMultiplier: 1.8,
        },
      },
    ],
  },
  {
    id: 'corporate-credit-boom',
    name: 'Corporate Credit Boom',
    description:
      'Aggressive growth in corporate lending sets the stage for a downturn that hits PD/LGD hard.',
    initialStateOverride: {
      financial: {
        balanceSheet: {
          items: [
            { productType: AssetProductType.CorporateLoans, balance: 240e9 },
            { productType: AssetProductType.Mortgages, balance: 170e9 },
          ],
        },
      },
    },
    scheduledShocks: [
      {
        stepNumber: 3,
        shock: {
          type: 'macroDownturn',
          pdMultiplier: 3.5,
          lgdMultiplier: 2,
        },
      },
    ],
  },
];

// Helpers to use scenarios externally
export const applyScenarioConfig = (
  base: SimulationConfig,
  scenarioId: string | null | undefined
): SimulationConfig => {
  const scenario = scenarios.find((s) => s.id === scenarioId);
  if (!scenario?.configOverrides) return base;
  const overrides = scenario.configOverrides;
  return {
    version: overrides.version ?? base.version,
    productParameters: {
      ...base.productParameters,
      ...(overrides.productParameters ?? {}),
    },
    liquidityTags: {
      ...base.liquidityTags,
      ...(overrides.liquidityTags ?? {}),
    },
    global: {
      ...base.global,
      ...(overrides.global ?? {}),
    },
    riskLimits: {
      ...base.riskLimits,
      ...(overrides.riskLimits ?? {}),
    },
  };
};

export const getScenarioInitialState = (
  scenarioId: string | null | undefined,
  config: SimulationConfig = baseConfig
): BankState => {
  const scenario = scenarios.find((s) => s.id === scenarioId);
  return applyInitialOverride(scenario?.initialStateOverride, config);
};

export const getScheduledShocksForStep = (scenarioId: string | null | undefined, stepNumber: number): Shock[] => {
  const scenario = scenarios.find((s) => s.id === scenarioId);
  if (!scenario) return [];
  return scenario.scheduledShocks.filter((s) => s.stepNumber === stepNumber).map((s) => s.shock);
};
