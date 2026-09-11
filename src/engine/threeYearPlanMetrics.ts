import type { BankState } from '../domain/bankState';
import { PRODUCTS } from '../products/catalogue';
import { ThreeYearPlanMetricRegistry } from './threeYearPlan';

export const THREE_YEAR_PLAN_METRICS = { eps: 'eps', rote: 'rote', customerLending: 'customerLending', customerDeposits: 'customerDeposits', cet1: 'cet1', lcr: 'lcr', nsfr: 'nsfr' } as const;
const sumBalances = (state: BankState, predicate: (productType: keyof typeof PRODUCTS) => boolean): number => state.financial.balanceSheet.items.reduce((sum, item) => sum + (predicate(item.productType as keyof typeof PRODUCTS) ? item.balance : 0), 0);

export const bankThreeYearPlanMetricRegistry = new ThreeYearPlanMetricRegistry<BankState>()
  .register({ id: THREE_YEAR_PLAN_METRICS.eps, label: 'EPS', format: 'moneyPerShare', read: (s) => s.equityMarket.epsTtm })
  .register({ id: THREE_YEAR_PLAN_METRICS.rote, label: 'RoTE', format: 'ratio', read: (s) => (s.equityMarket.bookValuePerShare ?? 0) > 0 ? s.equityMarket.epsTtm / (s.equityMarket.bookValuePerShare ?? 1) : 0 })
  .register({ id: THREE_YEAR_PLAN_METRICS.customerLending, label: 'Customer lending', format: 'money', read: (s) => sumBalances(s, p => Boolean(PRODUCTS[p]?.behaviour?.isLoan)) })
  .register({ id: THREE_YEAR_PLAN_METRICS.customerDeposits, label: 'Customer deposits', format: 'money', read: (s) => sumBalances(s, p => Boolean(PRODUCTS[p]?.behaviour?.isCustomerDeposit)) })
  .register({ id: THREE_YEAR_PLAN_METRICS.cet1, label: 'CET1 ratio', format: 'ratio', read: (s) => s.risk.riskMetrics.cet1Ratio })
  .register({ id: THREE_YEAR_PLAN_METRICS.lcr, label: 'LCR', format: 'ratio', read: (s) => s.risk.riskMetrics.lcr })
  .register({ id: THREE_YEAR_PLAN_METRICS.nsfr, label: 'NSFR', format: 'ratio', read: (s) => s.risk.riskMetrics.nsfr });
