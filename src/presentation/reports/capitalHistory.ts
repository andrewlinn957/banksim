import type { BankState } from '../../domain/bankState';
import { formatCurrency, formatPct } from '../../utils/formatters';

export type CapitalHistoryUnit = 'ratio' | 'money' | 'headroom';
export interface CapitalHistoryMeasure { label: string; unit: CapitalHistoryUnit; dash?: number[]; value: (state: BankState) => number | undefined }

export const CAPITAL_HISTORY_MEASURES: readonly CapitalHistoryMeasure[] = [
  { label: 'CET1', unit: 'ratio', value: (s) => s.risk.riskMetrics.cet1Ratio },
  { label: 'Tier 1', unit: 'ratio', value: (s) => s.risk.riskMetrics.tier1Ratio },
  { label: 'Total capital', unit: 'ratio', value: (s) => s.risk.riskMetrics.totalCapitalRatio },
  { label: 'CET1 requirement', unit: 'ratio', value: (s) => s.risk.riskMetrics.cet1Requirement, dash: [6, 4] },
  { label: 'CET1 minimum', unit: 'ratio', value: (s) => s.risk.riskMetrics.minimumCet1Ratio, dash: [6, 4] },
  { label: 'Tier 1 requirement', unit: 'ratio', value: (s) => s.risk.riskMetrics.tier1Requirement, dash: [6, 4] },
  { label: 'Total capital requirement', unit: 'ratio', value: (s) => s.risk.riskMetrics.totalCapitalRequirement, dash: [6, 4] },
  { label: 'Tier 1 minimum', unit: 'ratio', value: (s) => s.risk.riskMetrics.minimumTier1Ratio, dash: [6, 4] },
  { label: 'Total capital minimum', unit: 'ratio', value: (s) => s.risk.riskMetrics.minimumTotalCapitalRatio, dash: [6, 4] },
  { label: 'PRA CET1 target', unit: 'ratio', value: (s) => s.risk.riskMetrics.praBufferTarget, dash: [8, 4] },
  { label: 'Internal CET1 target', unit: 'ratio', value: (s) => s.risk.riskMetrics.internalCet1TargetRatio, dash: [2, 4] },
  { label: 'Leverage', unit: 'ratio', value: (s) => s.risk.riskMetrics.leverageRatio },
  { label: 'LCR', unit: 'ratio', value: (s) => s.risk.riskMetrics.lcr },
  { label: 'NSFR', unit: 'ratio', value: (s) => s.risk.riskMetrics.nsfr },
  { label: 'Leverage target', unit: 'ratio', value: (s) => s.risk.riskMetrics.internalLeverageTargetRatio, dash: [2, 4] },
  { label: 'LCR target', unit: 'ratio', value: (s) => s.risk.riskMetrics.internalLcrTargetRatio, dash: [2, 4] },
  { label: 'NSFR target', unit: 'ratio', value: (s) => s.risk.riskMetrics.internalNsfrTargetRatio, dash: [2, 4] },
  { label: 'Policy payout cap', unit: 'ratio', value: (s) => s.risk.riskMetrics.maxPayoutRatio },
  { label: 'CET1 headroom', unit: 'headroom', value: (s) => s.risk.riskMetrics.cet1Headroom },
  { label: 'Internal CET1 headroom', unit: 'headroom', value: (s) => s.risk.riskMetrics.internalCet1Headroom },
  { label: 'CET1 held', unit: 'money', value: (s) => s.risk.riskMetrics.cet1Ratio * s.risk.riskMetrics.rwa },
  { label: 'AT1 held', unit: 'money', value: (s) => s.financial.capital.at1 },
  { label: 'Tier 1 held', unit: 'money', value: (s) => (s.risk.riskMetrics.tier1Ratio ?? Number.NaN) * s.risk.riskMetrics.rwa },
  { label: 'Total capital held', unit: 'money', value: (s) => (s.risk.riskMetrics.totalCapitalRatio ?? Number.NaN) * s.risk.riskMetrics.rwa },
  { label: 'RWA', unit: 'money', value: (s) => s.risk.riskMetrics.rwa },
  { label: 'CET1 required', unit: 'money', value: (s) => s.risk.riskMetrics.cet1Requirement * s.risk.riskMetrics.rwa, dash: [6, 4] },
  { label: 'Tier 1 required', unit: 'money', value: (s) => (s.risk.riskMetrics.tier1Requirement ?? Number.NaN) * s.risk.riskMetrics.rwa, dash: [6, 4] },
  { label: 'Total capital required', unit: 'money', value: (s) => (s.risk.riskMetrics.totalCapitalRequirement ?? Number.NaN) * s.risk.riskMetrics.rwa, dash: [6, 4] },
  { label: 'PRA target capital', unit: 'money', value: (s) => (s.risk.riskMetrics.praBufferTarget ?? Number.NaN) * s.risk.riskMetrics.rwa, dash: [8, 4] },
  { label: 'Internal target capital', unit: 'money', value: (s) => s.risk.riskMetrics.internalCet1TargetRatio * s.risk.riskMetrics.rwa, dash: [2, 4] },
];

export const CAPITAL_HISTORY_COLORS = ['#147db3','#7954b3','#198b72','#c14d35','#6b7280','#a66809','#b24b92','#415a77','#039aab','#b87925','#64732f','#8b507d','#578887','#a2515b'] as const;
export const CAPITAL_HISTORY_DEFAULTS: Record<CapitalHistoryUnit, string[]> = {
  ratio: ['CET1', 'CET1 requirement', 'Internal CET1 target'],
  money: ['CET1 held', 'CET1 required', 'Internal target capital'],
  headroom: ['CET1 headroom', 'Internal CET1 headroom'],
};
export const formatCapitalHistoryValue = (value: number, unit: CapitalHistoryUnit): string =>
  unit === 'money' ? formatCurrency(value) : unit === 'headroom' ? `${(value * 100).toFixed(2)}pp` : formatPct(value);

export const buildCapitalHistoryData = (history: BankState[], unit: CapitalHistoryUnit, selected: readonly string[], years: string) => {
  const visible = CAPITAL_HISTORY_MEASURES.filter((measure) => measure.unit === unit);
  const end = history.at(-1)?.time.step ?? 0;
  const points = history.filter((state) => years === 'all' || state.time.step >= end - Number(years) * 12);
  const startStep = history[0]?.time.step ?? 0;
  return {
    measures: visible.map(({ label, dash }) => ({ label, dash })),
    points: points.map((state) => ({ step: state.time.step, date: state.time.date.toISOString(), year: `Y${Math.floor((state.time.step - startStep) / 12) + 1}` })),
    historyStartStep: startStep,
    datasets: visible.filter((measure) => selected.includes(measure.label)).map((measure) => ({
      label: measure.label,
      color: CAPITAL_HISTORY_COLORS[CAPITAL_HISTORY_MEASURES.indexOf(measure) % CAPITAL_HISTORY_COLORS.length],
      dash: measure.dash,
      points: points.map((state) => {
        const value = measure.value(state);
        return { x: state.time.step, y: Number.isFinite(value) ? value! : null };
      }),
    })),
    axisTitle: unit === 'money' ? '£' : unit === 'headroom' ? 'Percentage points' : '%',
  };
};
