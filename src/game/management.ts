import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { PRODUCT_META } from '../domain/productMeta';

export function attentionReason(s: BankState, config: SimulationConfig): string | null {
  const m = s.risk.riskMetrics;
  if (s.status.hasFailed) return 'The bank has failed. Review the final position.';
  if (m.cet1Ratio <= m.cet1Requirement || m.internalCet1Headroom < 0 || m.praBufferBreached) return 'Capital is below its buffer or internal target. Review distributions and capital before expanding.';
  if (s.risk.compliance.ownFundsBreached || m.leverageRatio <= config.riskLimits.minLeverageRatio * 1.05) return 'Own funds or leverage need attention. Review capital.';
  if (m.lcr <= config.riskLimits.minLcr * 1.1 || m.nsfr <= config.riskLimits.minNsfr * 1.05) return 'Liquidity or stable funding is running low. Review deposits and term funding.';
  return null;
}
export const customerDeposits = (s: BankState) => s.financial.balanceSheet.items.filter(i => PRODUCT_META[i.productType]?.behaviour?.isCustomerDeposit).reduce((n,i) => n+i.balance,0);
// Flows are summed over a period; stocks are always the actual closing balance.
export function periodHistory(history: BankState[], months: number) {
  const first = history[0];
  const groups: { label: string; months: number; profit: number; deposits: number; cet1: number; sharePrice: number }[] = [];
  for (let start = first.time.step; start < history[history.length-1].time.step; start += months) {
    const states = history.filter(s => s.time.step > start && s.time.step <= start+months);
    const close = states.at(-1);
    if (!close) continue;
    groups.push({ label: months === 12 ? `Year ${Math.floor((start-first.time.step)/12)+1}` : `Y${Math.floor((start-first.time.step)/12)+1} Q${Math.floor((start-first.time.step)%12/3)+1}`, months: states.length, profit: states.reduce((n,s)=>n+s.financial.incomeStatement.netIncome,0), deposits: customerDeposits(close), cet1: close.risk.riskMetrics.cet1Ratio, sharePrice: close.equityMarket.sharePrice });
  }
  return groups;
}

export const monthsToPeriodEnd = (elapsed: number, months: number) => months - elapsed % months;
export function clockAfterStep(remaining: number | null, state: BankState, config: SimulationConfig, safetyPause: boolean) {
  if (remaining === null) return { remaining: null, reason: 'Paused.' };
  const attention = attentionReason(state, config);
  if (state.status.hasFailed || (safetyPause && attention)) return { remaining: null, reason: attention ?? 'The bank has failed.' };
  if (remaining <= 1) return { remaining: null, reason: 'Period complete. Review how your strategy is developing.' };
  return { remaining: remaining - 1, reason: '' };
}
