import { BankState, BehaviouralState } from '../domain/bankState';
import { BalanceSheet } from '../domain/balanceSheet';
import { CashFlowStatement } from '../domain/cashflow';
import { MarketState } from '../domain/market';
import { IncomeStatement } from '../domain/pnl';
import { ComplianceStatus, RiskMetrics } from '../domain/risks';
import { LoanCohort } from '../domain/loanCohorts';
import { ProductType } from '../domain/enums';

const cloneBalanceSheet = (bs: BalanceSheet): BalanceSheet => ({
  items: bs.items.map((item) => ({
    ...item,
    liquidityTag: { ...item.liquidityTag },
    encumbrance: item.encumbrance ? { ...item.encumbrance } : { encumberedAmount: 0 },
  })),
});

const cloneIncomeStatement = (p: IncomeStatement): IncomeStatement => ({ ...p });

const cloneCashFlowStatement = (c: CashFlowStatement): CashFlowStatement => ({ ...c });

const cloneRiskMetrics = (r: RiskMetrics): RiskMetrics => ({ ...r });

const cloneCompliance = (c: ComplianceStatus): ComplianceStatus => ({ ...c });

const cloneBehaviour = (b: BehaviouralState): BehaviouralState => ({ ...b });

const cloneMarket = (m: MarketState): MarketState => ({
  ...m,
  giltCurve: {
    ...m.giltCurve,
    nelsonSiegel: { ...m.giltCurve.nelsonSiegel },
    yields: { ...m.giltCurve.yields },
  },
  macroModel: {
    ...m.macroModel,
    factors: { ...m.macroModel.factors },
  },
});

const cloneLoanCohorts = (raw: BankState['loanCohorts']): BankState['loanCohorts'] => {
  const out: Partial<Record<ProductType, LoanCohort[]>> = {};
  const entries = Object.entries(raw ?? {}) as Array<[ProductType, LoanCohort[]]>;
  entries.forEach(([productType, cohorts]) => {
    out[productType] = (cohorts ?? []).map((c) => ({ ...c }));
  });
  return out;
};

const cloneDate = (raw: unknown): Date => {
  if (raw instanceof Date) return new Date(raw.getTime());
  return new Date(raw as any);
};

export const cloneBankState = (state: BankState): BankState => ({
  ...state,
  version: state.version ?? 'v1',
  time: {
    ...state.time,
    date: cloneDate(state.time.date),
  },
  balanceSheet: cloneBalanceSheet(state.balanceSheet),
  capital: { ...state.capital },
  incomeStatement: cloneIncomeStatement(state.incomeStatement),
  cashFlowStatement: cloneCashFlowStatement(state.cashFlowStatement),
  riskMetrics: cloneRiskMetrics(state.riskMetrics),
  compliance: cloneCompliance(state.compliance),
  market: cloneMarket(state.market),
  behaviour: cloneBehaviour(state.behaviour),
  loanCohorts: cloneLoanCohorts(state.loanCohorts),
});
