import { BankState } from '../domain/bankState';
import { ActionFormState } from '../components/ActionsPanel';
export const MANDATE_MONTHS = 12;
export interface BoardDecision { id: string; title: string; voice: string; pitch: string; benefit: string; tradeoff: string; changes: Partial<ActionFormState>; }
const rate = (r: number) => `${(Math.max(0, r) * 100).toFixed(2)}%`;
export const boardDecisions = (s: BankState): BoardDecision[] => {
  const m = s.market;
  return [
    { id: 'savers', voice: 'Head of retail', title: 'Win back savers', pitch: 'Give customers a reason to stay. Offer a little more than the competition.', benefit: 'Protect deposits and the franchise', tradeoff: 'Higher interest expense squeezes the margin', changes: { retailDepositRate: rate(m.competitorRetailDepositRate + .0025), corporateDepositRate: rate((m.competitorCorporateDepositRate ?? m.competitorRetailDepositRate) + .002) } },
    { id: 'growth', voice: 'Commercial director', title: 'Go after new business', pitch: 'Price new loans keenly and open the door to more borrowers.', benefit: 'Build the lending pipeline', tradeoff: 'More capital use and risk in the next vintage', changes: { mortgageRate: rate(m.competitorMortgageRate - .0025), corporateLoanRate: rate(m.riskFreeLong + m.corporateLoanSpread - .002), mortgageUnderwritingTightness: '.15', corporateUnderwritingTightness: '.15' } },
    { id: 'quality', voice: 'Chief risk officer', title: 'Be choosy on credit', pitch: 'Ask for a better margin and tighten approval standards.', benefit: 'Improve the quality of new lending', tradeoff: 'Fewer approvals; old loans retain their risk', changes: { mortgageRate: rate(m.competitorMortgageRate + .0015), corporateLoanRate: rate(m.riskFreeLong + m.corporateLoanSpread + .002), mortgageUnderwritingTightness: '.75', corporateUnderwritingTightness: '.75' } },
    { id: 'funding', voice: 'Treasurer', title: 'Buy breathing room', pitch: 'Raise term funding and keep this month’s earnings in the bank.', benefit: 'More cash and stable funding', tradeoff: 'An interest bill for years; debt is not capital', changes: { issueLTDebtAmount: String(Math.round(Math.max(50e6, s.risk.riskMetrics.fundingMaturing3m * .5))), dividendPayoutRatio: '0', at1CouponMode: 'auto' } },
  ];
};
export const mandateProgress = (history: BankState[]) => {
  const first = history[0];
  const run = history.filter(s => s.time.step > first.time.step && s.time.step <= first.time.step + MANDATE_MONTHS);
  const latest = run.at(-1) ?? first;
  const elapsed = Math.max(0, Math.min(12, latest.time.step - first.time.step));
  const dividends = run.reduce((sum, s) => sum + s.financial.incomeStatement.dividendsPaid / Math.max(1, s.equityMarket.sharesOutstanding), 0);
  const shareholderReturn = (latest.equityMarket.sharePrice + dividends) / first.equityMarket.sharePrice - 1;
  const profitable = run.filter(s => s.financial.incomeStatement.netIncome > 0).length;
  const franchise = latest.behaviour.depositFranchiseStrength / Math.max(.01, first.behaviour.depositFranchiseStrength);
  const objectives = [
    { label: 'Reward your shareholders', detail: '8% total return, including dividends', progress: Math.max(0, Math.min(1, shareholderReturn / .08)), achieved: shareholderReturn >= .08 },
    { label: 'Make the bank earn its keep', detail: 'At least 9 profitable months', progress: Math.min(1, profitable / 9), achieved: profitable >= 9 },
    { label: 'Keep your customers', detail: 'Finish with franchise strength at or above its start', progress: Math.max(0, Math.min(1, franchise)), achieved: franchise >= 1 - 1e-9 },
  ];
  const c = latest.risk.compliance;
  const sound = !latest.status.hasFailed && !c.cet1Breached && !c.ownFundsBreached && !c.leverageBreached && !c.lcrBreached && !c.nsfrBreached;
  return { elapsed, objectives, sound, stars: sound ? objectives.filter(o => o.achieved).length : 0, shareholderReturn, profitable, finished: elapsed >= 12 || latest.status.hasFailed };
};
export const monthlyBrief = (s: BankState) => {
  if (s.risk.riskMetrics.lcr < 1 || s.risk.riskMetrics.nsfr < 1) return { title: 'Time to restore the buffer.', detail: 'Protect deposits and refinance before a ratio shortfall becomes a cash problem.', focus: 'Liquidity recovery' };
  if (s.time.step === 0) return { title: 'Your first year in the chair.', detail: 'Build shareholder value, earn consistently and keep your customers. Every month, weigh the proposals, set your terms and close the books.', focus: '12-month mandate' };
  if (s.market.gdpGrowthMoM < 0) return { title: 'The economy is losing ground.', detail: 'New business still matters, but this vintage could prove expensive. Watch credit quality and the provision charge.', focus: 'Credit quality' };
  if (s.behaviour.depositFranchiseStrength < .68) return { title: 'Your customers have other options.', detail: 'Cheap deposits are only cheap while they stay. A better offer can slow the erosion, at a cost to earnings.', focus: 'Customer retention' };
  return { title: 'What will you back this month?', detail: 'Decide whether the next pound should support growth, better funding or stronger margins. Your choices carry into future months.', focus: 'Commercial judgement' };
};
