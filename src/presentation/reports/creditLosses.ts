import type { BankState } from '../../domain/bankState';
import { creditStageDiagnostics } from '../../engine/creditStageDiagnostics';
import { loanCarryingAmounts } from '../../products/loanBalances';

const STAGES = [
  { key: 'stage1', label: 'Stage 1', trigger: 'No significant increase in risk', measure: '12-month ECL', className: 'stage-one' },
  { key: 'stage2', label: 'Stage 2', trigger: 'Credit risk has increased significantly', measure: 'Lifetime ECL', className: 'stage-two' },
  { key: 'stage3', label: 'Stage 3', trigger: 'Credit-impaired', measure: 'Lifetime ECL', className: 'stage-three' },
] as const;

type StageKey = typeof STAGES[number]['key'];

interface StageRow {
  key: StageKey;
  label: string;
  trigger: string;
  measure: string;
  className: string;
  exposure: number;
  allowance: number | null;
  share: number;
  coverage: number | null;
}

interface MonthRow {
  date: string;
  openingEcl: number | null;
  provisionCharge: number | null;
  defaults: number;
  recoveries: number;
  realisedLosses: number;
  closingEcl: number | null;
  bridgeGap: number | null;
}

interface VintageRow {
  product: string;
  vintage: string;
  booked: number;
  defaults: number;
  recoveries: number;
  realisedLosses: number;
}

const sumValues = (record: object | undefined): number =>
  Object.values(record ?? {}).reduce<number>((total, value) => total + (typeof value === 'number' ? value : 0), 0);

const dateLabel = (date: Date): string =>
  date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

const vintageName = (step: number | null | undefined, history: readonly BankState[]): string => {
  const openingStep = history[0]?.time.step ?? 0;
  if (step == null || step <= openingStep) return 'Opening book';
  const snapshot = history.find((state) => state.time.step === step);
  return snapshot ? String(snapshot.time.date.getUTCFullYear()) : 'In-run';
};

const buildVintageRows = (history: readonly BankState[]): VintageRow[] => {
  const totals = new Map<string, VintageRow>();
  const rowFor = (product: string, vintage: string): VintageRow => {
    const key = `${product}|${vintage}`;
    let row = totals.get(key);
    if (!row) {
      row = { product, vintage, booked: 0, defaults: 0, recoveries: 0, realisedLosses: 0 };
      totals.set(key, row);
    }
    return row;
  };

  if (history.length > 0) {
    Object.entries(loanCarryingAmounts(history[0]).byProduct).forEach(([product, amounts]) => {
      if (amounts) rowFor(product, 'Opening book').booked = amounts.gross;
    });
  }

  history.slice(1).forEach((state) => {
    const flow = state.periodFlows;
    if (!flow) return;
    const year = String(state.time.date.getUTCFullYear());
    Object.entries(flow.newLendingByProduct).forEach(([product, amount]) => {
      rowFor(product, year).booked += amount ?? 0;
    });
    Object.entries(flow.renewalsByProduct).forEach(([product, amount]) => {
      rowFor(product, year).booked += amount ?? 0;
    });
    flow.defaultsByVintage.forEach((item) => {
      rowFor(item.productType, vintageName(item.originationStep, history)).defaults += item.amount;
    });
    flow.recoveriesByVintage.forEach((item) => {
      rowFor(item.productType, vintageName(item.originationStep, history)).recoveries += item.amount;
    });
    flow.realizedLossesByVintage.forEach((item) => {
      rowFor(item.productType, vintageName(item.originationStep, history)).realisedLosses += item.amount;
    });
  });

  return [...totals.values()].sort((a, b) => a.vintage.localeCompare(b.vintage) || a.product.localeCompare(b.product));
};

export const buildCreditLossesReportData = (history: BankState[]) => {
  const latest = history[history.length - 1];
  if (!latest) return null;
  const carrying = loanCarryingAmounts(latest).total;
  const bridge = latest.periodFlows?.provisionBridge;
  const diagnostic = creditStageDiagnostics(latest);
  const grossByStage = diagnostic.stageGross;
  const totalStageGross = Object.values(grossByStage).reduce((sum, value) => sum + value, 0);
  const allowances = bridge?.fundedAllowanceClosingByStage;
  const stages: StageRow[] = STAGES.map((stage) => {
    const exposure = grossByStage[stage.key];
    const allowance = allowances ? allowances[stage.key] : null;
    return {
      ...stage,
      exposure,
      allowance,
      share: totalStageGross > 0 ? exposure / totalStageGross : 0,
      coverage: allowance !== null && exposure > 0 ? allowance / exposure : null,
    };
  });
  const months: MonthRow[] = history.slice(1).flatMap((state) => {
    const flow = state.periodFlows;
    if (!flow) return [];
    const monthBridge = flow.provisionBridge;
    return [{
      date: dateLabel(state.time.date),
      openingEcl: monthBridge?.fundedAllowanceOpeningByStage.total ?? null,
      provisionCharge: monthBridge?.provisionCharge ?? null,
      defaults: sumValues(flow.defaultsByProduct),
      recoveries: sumValues(flow.recoveriesByProduct),
      realisedLosses: flow.realizedLossesByVintage.reduce((sum, item) => sum + item.amount, 0),
      closingEcl: monthBridge?.fundedAllowanceClosingByStage.total ?? null,
      bridgeGap: monthBridge?.reconciliationDifference ?? null,
    }];
  });
  const workouts = Object.values(latest.workoutPipelines ?? {}).flatMap((buckets) => buckets ?? []);
  const workoutStock = workouts.reduce((sum, bucket) => sum + Math.max(0, bucket.defaultedPrincipal), 0);
  const expectedRecoveries = workouts.reduce((sum, bucket) => sum + Math.max(0, bucket.defaultedPrincipal) * Math.max(0, Math.min(1, bucket.expectedRecoveryRate)), 0);

  return {
    carrying,
    stages,
    months,
    latestMonth: months[months.length - 1] ?? null,
    commitmentEcl: bridge?.commitmentAllowanceClosing ?? null,
    workoutStock,
    expectedRecoveries,
    expectedWorkoutLoss: Math.max(0, workoutStock - expectedRecoveries),
    vintages: buildVintageRows(history),
  };
};
