import { StepAttribution, AttributionLine, AttributionMetricKey, MetricAttribution } from '../domain/attribution';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide } from '../domain/enums';
import type { SimulationEvent } from './simulation';

const toFinite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback);

const sumAssetBalances = (state: BankState): number =>
  state.financial.balanceSheet.items
    .filter((item) => item.side === BalanceSheetSide.Asset)
    .reduce((sum, item) => sum + item.balance, 0);

const calculateNim = (state: BankState): number => {
  const assets = sumAssetBalances(state);
  if (assets <= 0) return 0;
  return (state.financial.incomeStatement.netInterestIncome * 12) / assets;
};

const unique = (ids: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  ids.forEach((id) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
};

const severityRank = (severity: SimulationEvent['severity']): number => {
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  return 1;
};

const pickRelatedEventIds = (
  events: SimulationEvent[],
  tagHints: string[],
  keywordHints: string[]
): string[] => {
  if (events.length === 0) return [];
  const loweredKeywords = keywordHints.map((keyword) => keyword.toLowerCase());
  const loweredTags = tagHints.map((tag) => tag.toLowerCase());

  const direct = events
    .filter((event) => {
      const eventTags = (event.tags ?? []).map((tag) => tag.toLowerCase());
      const byTag = loweredTags.some((tag) => eventTags.includes(tag));
      if (byTag) return true;
      const message = event.message.toLowerCase();
      return loweredKeywords.some((keyword) => message.includes(keyword));
    })
    .map((event) => event.id);

  if (direct.length > 0) return unique(direct);

  const fallback = [...events]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.timestamp - a.timestamp)
    .slice(0, 5)
    .map((event) => event.id);
  return unique(fallback);
};

const buildMetric = (args: {
  metric: AttributionMetricKey;
  label: string;
  before: number;
  after: number;
  lineInputs: Array<{
    idSuffix: string;
    label: string;
    effect: number;
    tagHints: string[];
    keywordHints: string[];
    category: AttributionLine['category'];
  }>;
  events: SimulationEvent[];
}): MetricAttribution => {
  const before = toFinite(args.before);
  const after = toFinite(args.after);
  const delta = toFinite(after - before);

  const baseLines: AttributionLine[] = args.lineInputs.map((line) => ({
    id: `${args.metric}-${line.idSuffix}`,
    label: line.label,
    effect: toFinite(line.effect),
    eventIds: pickRelatedEventIds(args.events, line.tagHints, line.keywordHints),
    category: line.category,
  }));

  const baseSum = baseLines.reduce((sum, line) => sum + line.effect, 0);
  const residual = delta - baseSum;
  const residualLine: AttributionLine = {
    id: `${args.metric}-residual`,
    label: 'Cross-effects and rounding',
    effect: residual,
    eventIds: pickRelatedEventIds(args.events, ['other'], ['invariant', 'breach', 'rounding']),
    category: 'other',
  };

  const lines = [...baseLines, residualLine];
  const reconciledDelta = lines.reduce((sum, line) => sum + line.effect, 0);
  const positives = lines.filter((line) => line.effect > 0).sort((a, b) => b.effect - a.effect);
  const negatives = lines.filter((line) => line.effect < 0).sort((a, b) => a.effect - b.effect);

  return {
    metric: args.metric,
    label: args.label,
    unit: 'ratio',
    before,
    after,
    delta,
    lines,
    reconciledDelta,
    residual,
    topPositiveDriverId: positives[0]?.id,
    topNegativeDriverId: negatives[0]?.id,
  };
};

export const buildStepAttribution = (args: {
  before: BankState;
  after: BankState;
  config: SimulationConfig;
  events: SimulationEvent[];
}): StepAttribution => {
  const { before, after, config, events } = args;
  const fvociInclusionRate = toFinite(config.behaviour.securitiesAccounting?.fvociCet1InclusionRate, 1);

  const cet1Before =
    before.financial.capital.cet1 + before.financial.capital.accumulatedOCI * fvociInclusionRate;
  const cet1After = after.financial.capital.cet1 + after.financial.capital.accumulatedOCI * fvociInclusionRate;
  const rwaBefore = toFinite(before.risk.riskMetrics.rwa);
  const rwaAfter = toFinite(after.risk.riskMetrics.rwa);
  const avgRwa = Math.max(1e-9, (rwaBefore + rwaAfter) / 2);
  const avgCet1 = (cet1Before + cet1After) / 2;
  const cet1CapitalEffect = toFinite((cet1After - cet1Before) / avgRwa);
  const cet1RwaEffect = toFinite((-avgCet1 * (rwaAfter - rwaBefore)) / (avgRwa * avgRwa));

  const hqlaBefore = toFinite(before.risk.riskMetrics.hqla);
  const hqlaAfter = toFinite(after.risk.riskMetrics.hqla);
  const lcrBefore = toFinite(before.risk.riskMetrics.lcr);
  const lcrAfter = toFinite(after.risk.riskMetrics.lcr);
  const netOutflowBefore = lcrBefore > 0 ? hqlaBefore / lcrBefore : 0;
  const netOutflowAfter = lcrAfter > 0 ? hqlaAfter / lcrAfter : 0;
  const avgNetOutflow = Math.max(1e-9, (netOutflowBefore + netOutflowAfter) / 2);
  const avgHqla = (hqlaBefore + hqlaAfter) / 2;
  const lcrHqlaEffect = toFinite((hqlaAfter - hqlaBefore) / avgNetOutflow);
  const lcrOutflowEffect = toFinite(
    (-avgHqla * (netOutflowAfter - netOutflowBefore)) / (avgNetOutflow * avgNetOutflow)
  );

  const asfBefore = toFinite(before.risk.riskMetrics.asf);
  const asfAfter = toFinite(after.risk.riskMetrics.asf);
  const rsfBefore = toFinite(before.risk.riskMetrics.rsf);
  const rsfAfter = toFinite(after.risk.riskMetrics.rsf);
  const avgRsf = Math.max(1e-9, (rsfBefore + rsfAfter) / 2);
  const avgAsf = (asfBefore + asfAfter) / 2;
  const nsfrAsfEffect = toFinite((asfAfter - asfBefore) / avgRsf);
  const nsfrRsfEffect = toFinite((-avgAsf * (rsfAfter - rsfBefore)) / (avgRsf * avgRsf));

  const nimBefore = calculateNim(before);
  const nimAfter = calculateNim(after);
  const niiBefore = toFinite(before.financial.incomeStatement.netInterestIncome);
  const niiAfter = toFinite(after.financial.incomeStatement.netInterestIncome);
  const assetsBefore = Math.max(1e-9, sumAssetBalances(before));
  const assetsAfter = Math.max(1e-9, sumAssetBalances(after));
  const avgAssets = Math.max(1e-9, (assetsBefore + assetsAfter) / 2);
  const avgNii = (niiBefore + niiAfter) / 2;
  const nimNiiEffect = toFinite((12 * (niiAfter - niiBefore)) / avgAssets);
  const nimAssetEffect = toFinite((-12 * avgNii * (assetsAfter - assetsBefore)) / (avgAssets * avgAssets));

  const metrics: Record<AttributionMetricKey, MetricAttribution> = {
    cet1Ratio: buildMetric({
      metric: 'cet1Ratio',
      label: 'CET1 ratio',
      before: before.risk.riskMetrics.cet1Ratio,
      after: after.risk.riskMetrics.cet1Ratio,
      lineInputs: [
        {
          idSuffix: 'capital',
          label: 'Adjusted CET1 capital',
          effect: cet1CapitalEffect,
          tagHints: ['capital', 'income', 'securities'],
          keywordHints: ['cet1', 'capital', 'equity', 'dividend', 'coupon', 'impairment', 'oci', 'internal target', 'conduct', 'fine', 'remediation'],
          category: 'capital',
        },
        {
          idSuffix: 'rwa',
          label: 'Risk-weighted assets',
          effect: cet1RwaEffect,
          tagHints: ['loans', 'assets', 'credit'],
          keywordHints: ['rwa', 'loan', 'origination', 'default', 'underwriting'],
          category: 'assets',
        },
        {
          idSuffix: 'selection',
          label: 'Selection pressure and renewals',
          effect: toFinite((after.financial.incomeStatement.provisionCharge - before.financial.incomeStatement.provisionCharge) / Math.max(1e-9, avgRwa)),
          tagHints: ['loans', 'credit'],
          keywordHints: ['selection pressure', 'renewal', 'refi', 'adverse selection'],
          category: 'assets',
        },
      ],
      events,
    }),
    lcr: buildMetric({
      metric: 'lcr',
      label: 'LCR',
      before: before.risk.riskMetrics.lcr,
      after: after.risk.riskMetrics.lcr,
      lineInputs: [
        {
          idSuffix: 'hqla',
          label: 'HQLA stock',
          effect: lcrHqlaEffect,
          tagHints: ['liquidity', 'assets', 'funding'],
          keywordHints: ['hqla', 'gilt', 'liquidity', 'repo'],
          category: 'liquidity',
        },
        {
          idSuffix: 'outflows',
          label: 'Net cash outflows',
          effect: lcrOutflowEffect,
          tagHints: ['liquidity', 'funding', 'deposits'],
          keywordHints: ['outflow', 'inflow', 'run', 'withdrawal', 'rollover', 'funding', 'confidence state'],
          category: 'funding',
        },
      ],
      events,
    }),
    nsfr: buildMetric({
      metric: 'nsfr',
      label: 'NSFR',
      before: before.risk.riskMetrics.nsfr,
      after: after.risk.riskMetrics.nsfr,
      lineInputs: [
        {
          idSuffix: 'asf',
          label: 'Available stable funding (ASF)',
          effect: nsfrAsfEffect,
          tagHints: ['funding', 'capital', 'deposits'],
          keywordHints: ['asf', 'funding', 'deposit', 'capital', 'debt', 'confidence state', 'internal target'],
          category: 'funding',
        },
        {
          idSuffix: 'rsf',
          label: 'Required stable funding (RSF)',
          effect: nsfrRsfEffect,
          tagHints: ['assets', 'loans', 'liquidity'],
          keywordHints: ['rsf', 'loan', 'asset', 'origination'],
          category: 'assets',
        },
      ],
      events,
    }),
    nim: buildMetric({
      metric: 'nim',
      label: 'NIM',
      before: nimBefore,
      after: nimAfter,
      lineInputs: [
        {
          idSuffix: 'nii',
          label: 'Net interest income',
          effect: nimNiiEffect,
          tagHints: ['income', 'rates', 'hedges'],
          keywordHints: ['net interest', 'pricing', 'hedge', 'coupon', 'conduct', 'remediation'],
          category: 'profitability',
        },
        {
          idSuffix: 'assets',
          label: 'Earning asset base',
          effect: nimAssetEffect,
          tagHints: ['assets', 'loans', 'liquidity'],
          keywordHints: ['loan', 'asset', 'balance'],
          category: 'assets',
        },
        {
          idSuffix: 'creditmix',
          label: 'Refinance/prepay mix',
          effect: toFinite(
            (after.financial.incomeStatement.realizedLoanLosses - before.financial.incomeStatement.realizedLoanLosses) /
              Math.max(1e-9, avgAssets)
          ),
          tagHints: ['loans', 'credit'],
          keywordHints: ['prepayment', 'refi', 'workout', 'recovery'],
          category: 'profitability',
        },
      ],
      events,
    }),
  };

  const eventIndex = Object.values(metrics).reduce<Record<string, string[]>>((acc, metric) => {
    metric.lines.forEach((line) => {
      acc[line.id] = [...line.eventIds];
    });
    return acc;
  }, {});

  return {
    generatedAt: Date.now(),
    metrics,
    eventIndex,
  };
};
