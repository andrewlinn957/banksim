import type { BankState } from '../../domain/bankState';
import { periodHistory } from '../../game/management';

export const buildPerformanceReportData = (history: BankState[], periodMonths: 3 | 12) => {
  const periods = periodHistory(history, periodMonths);
  const visiblePeriods = periods.slice(-12);
  const latest = periods.at(-1);
  const prior = periods.at(-2);
  const maxVisibleAbsProfit = Math.max(1, ...visiblePeriods.map((item) => Math.abs(item.profit)));
  return {
    periodMonths,
    periods,
    visiblePeriods,
    latest,
    prior,
    maxVisibleAbsProfit,
    barHeightPx: (profit: number) => Math.max(4, Math.abs(profit) / maxVisibleAbsProfit * 60),
    periodStatus: !latest ? 'empty' as const
      : latest.months < periodMonths ? 'incomplete' as const
        : prior ? 'change' as const : 'baseline' as const,
    profitChange: latest && prior ? latest.profit - prior.profit : null,
  };
};
