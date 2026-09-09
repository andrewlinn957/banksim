from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


# Canonical ITL1 region domain and legacy mapper.
write("src/domain/ukItl1.ts", """export const UK_ITL1_REGIONS = [
  'northEast',
  'northWest',
  'yorkshireAndTheHumber',
  'eastMidlands',
  'westMidlands',
  'eastOfEngland',
  'london',
  'southEast',
  'southWest',
  'scotland',
  'wales',
  'northernIreland',
] as const;

export type UkItl1Region = typeof UK_ITL1_REGIONS[number];

export const UK_ITL1_LABELS: Record<UkItl1Region, string> = {
  northEast: 'North East (England)',
  northWest: 'North West (England)',
  yorkshireAndTheHumber: 'Yorkshire and The Humber',
  eastMidlands: 'East Midlands (England)',
  westMidlands: 'West Midlands (England)',
  eastOfEngland: 'East (England)',
  london: 'London',
  southEast: 'South East (England)',
  southWest: 'South West (England)',
  scotland: 'Scotland',
  wales: 'Wales',
  northernIreland: 'Northern Ireland',
};

export const isUkItl1Region = (value: string | undefined): value is UkItl1Region =>
  value !== undefined && (UK_ITL1_REGIONS as readonly string[]).includes(value);

/**
 * Converts pre-ITL1 BankSim geography buckets into a deterministic ITL1 region.
 * New cohorts are always created with an ITL1 value; this mapper keeps older
 * saved games usable without retaining the old buckets in new portfolio data.
 */
export const canonicalLoanGeography = (
  value: string | undefined,
  cohortId = 0
): UkItl1Region => {
  if (isUkItl1Region(value)) return value;
  const index = Math.abs(Math.floor(cohortId));
  if (value === 'south') return ['eastOfEngland', 'southEast', 'southWest'][index % 3] as UkItl1Region;
  if (value === 'midlands') return ['eastMidlands', 'westMidlands'][index % 2] as UkItl1Region;
  if (value === 'north') return ['northEast', 'northWest', 'yorkshireAndTheHumber'][index % 3] as UkItl1Region;
  if (value === 'other') return 'eastOfEngland';
  return UK_ITL1_REGIONS[index % UK_ITL1_REGIONS.length];
};
""")

replace_once(
    "src/domain/loanCohorts.ts",
    "import { ProductType } from './enums';\n",
    "import { ProductType } from './enums';\nimport { UkItl1Region } from './ukItl1';\n",
)
replace_once(
    "src/domain/loanCohorts.ts",
    """export type LoanGeography =
  | 'london'
  | 'south'
  | 'midlands'
  | 'north'
  | 'scotland'
  | 'wales'
  | 'northernIreland'
  | 'other';
""",
    """export type LegacyLoanGeography = 'south' | 'midlands' | 'north' | 'other';
export type LoanGeography = UkItl1Region | LegacyLoanGeography;
""",
)

# Loan cohort engine: new origination/seasoning uses the 12 ITL1 regions while
# legacy saved cohorts are canonicalised deterministically when normalised.
replace_once(
    "src/engine/loanCohorts.ts",
    "} from '../domain/loanCohorts';\nimport { PRODUCTS } from '../products/catalogue';",
    "} from '../domain/loanCohorts';\nimport { canonicalLoanGeography, UK_ITL1_REGIONS } from '../domain/ukItl1';\nimport { PRODUCTS } from '../products/catalogue';",
)
replace_once(
    "src/engine/loanCohorts.ts",
    """const LOAN_GEOGRAPHIES: LoanGeography[] = [
  'london',
  'south',
  'midlands',
  'north',
  'scotland',
  'wales',
  'northernIreland',
  'other',
];
""",
    """const LOAN_GEOGRAPHIES: LoanGeography[] = [
  ...UK_ITL1_REGIONS,
  // Legacy values are accepted during load/validation and canonicalised below.
  'south',
  'midlands',
  'north',
  'other',
];
""",
)
replace_once(
    "src/engine/loanCohorts.ts",
    """const fallbackGeographyForCohort = (cohortId: number): LoanGeography =>
  LOAN_GEOGRAPHIES[Math.abs(Math.floor(cohortId)) % LOAN_GEOGRAPHIES.length];
""",
    """const fallbackGeographyForCohort = (cohortId: number): LoanGeography =>
  UK_ITL1_REGIONS[Math.abs(Math.floor(cohortId)) % UK_ITL1_REGIONS.length];
""",
)
replace_once(
    "src/engine/loanCohorts.ts",
    """const normaliseGeography = (
  cohortId: number,
  geography: LoanGeography | undefined
): LoanGeography => (isValidGeography(geography) ? geography : fallbackGeographyForCohort(cohortId));
""",
    """const normaliseGeography = (
  cohortId: number,
  geography: LoanGeography | undefined
): LoanGeography => canonicalLoanGeography(geography, cohortId);
""",
)
engine_text = read("src/engine/loanCohorts.ts")
pattern = re.compile(r"const defaultGeographyMix = \(\): Array<\{ key: LoanGeography; weight: number \}> => \[\n.*?\n\];", re.S)
new_mix = """const defaultGeographyMix = (): Array<{ key: LoanGeography; weight: number }> => [
  { key: 'northEast', weight: 0.04 },
  { key: 'northWest', weight: 0.09 },
  { key: 'yorkshireAndTheHumber', weight: 0.07 },
  { key: 'eastMidlands', weight: 0.08 },
  { key: 'westMidlands', weight: 0.10 },
  { key: 'eastOfEngland', weight: 0.08 },
  { key: 'london', weight: 0.28 },
  { key: 'southEast', weight: 0.07 },
  { key: 'southWest', weight: 0.04 },
  { key: 'scotland', weight: 0.08 },
  { key: 'wales', weight: 0.05 },
  { key: 'northernIreland', weight: 0.02 },
];"""
engine_text, n = pattern.subn(new_mix, engine_text, count=1)
if n != 1:
    raise RuntimeError(f"Expected one defaultGeographyMix block, replaced {n}")
write("src/engine/loanCohorts.ts", engine_text)

# Geography stress calibration at ITL1 level, preserving the broad regional
# calibration that the old buckets represented.
base_config = read("src/config/baseConfig.ts")
old_geo_stress = """    geographyPdMultiplierByStress: {
      london: 1.08,
      south: 1.05,
      midlands: 1.12,
      north: 1.15,
      scotland: 1.1,
      wales: 1.1,
      northernIreland: 1.1,
      other: 1.1,
    },"""
new_geo_stress = """    geographyPdMultiplierByStress: {
      northEast: 1.15,
      northWest: 1.15,
      yorkshireAndTheHumber: 1.15,
      eastMidlands: 1.12,
      westMidlands: 1.12,
      eastOfEngland: 1.05,
      london: 1.08,
      southEast: 1.05,
      southWest: 1.05,
      scotland: 1.1,
      wales: 1.1,
      northernIreland: 1.1,
    },"""
if base_config.count(old_geo_stress) != 1:
    raise RuntimeError("Could not uniquely locate geography stress block")
write("src/config/baseConfig.ts", base_config.replace(old_geo_stress, new_geo_stress, 1))

# Exact regional decomposition of loan credit RWA. The regional values use the
# same allowance scaling and defaulted risk weights as assetCreditRwa, then
# reconcile to the accounting balance in the same way.
write("src/engine/creditRwa.ts", """import { hedgeExposures } from './hedgeValuation';
import { BankState } from '../domain/bankState';
import { BalanceSheetItem } from '../domain/balanceSheet';
import { SimulationConfig } from '../domain/config';
import { cohortEcl, workoutPresentValue, workoutRecoveryEstimator } from './impairment';
import { hasCapability } from '../products/capabilities';
import { canonicalLoanGeography, UK_ITL1_REGIONS, UkItl1Region } from '../domain/ukItl1';
import {
  defaultedRiskWeight,
  getCreditRiskRule,
  regulatoryRiskWeight,
} from '../products/regulatory';

const emptyRegionalRwa = (): Record<UkItl1Region, number> =>
  Object.fromEntries(UK_ITL1_REGIONS.map(region => [region, 0])) as Record<UkItl1Region, number>;

/**
 * Decompose a loan balance-sheet line's credit RWA across the 12 UK ITL1 regions.
 * The sum of this record equals assetCreditRwa for loan products with cohort data.
 */
export const loanCreditRwaByRegion = (
  state: BankState,
  config: SimulationConfig,
  item: BalanceSheetItem
): Record<UkItl1Region, number> => {
  const result = emptyRegionalRwa();
  const p = item.productType;
  if (!hasCapability(p, 'loan')) return result;

  const performingWeight = regulatoryRiskWeight(p);
  const recovery = workoutRecoveryEstimator(state, config, p);
  const exposures = [
    ...(state.loanCohorts[p] ?? []).map(c => ({
      gross: c.outstandingPrincipal,
      allowance: cohortEcl(c, config),
      defaulted: c.stage === 'stage3',
      region: canonicalLoanGeography(c.geography, c.cohortId),
    })),
    ...(state.workoutPipelines[p] ?? []).map(w => ({
      gross: w.defaultedPrincipal,
      allowance:
        w.defaultedPrincipal - workoutPresentValue(state, config, p, w, recovery(w)),
      defaulted: true,
      region: canonicalLoanGeography(w.geography, w.sourceCohortId),
    })),
  ];
  if (!exposures.length) return result;

  const target = exposures.reduce((sum, e) => sum + e.allowance, 0);
  const allowanceScale = target > 0 ? (item.lossAllowance ?? 0) / target : 0;
  let netTotal = 0;

  for (const e of exposures) {
    const allowance = Math.min(e.gross, Math.max(0, e.allowance * allowanceScale));
    const net = Math.max(0, e.gross - allowance);
    const riskWeight = e.defaulted
      ? defaultedRiskWeight(p, e.gross, allowance)
      : performingWeight;
    netTotal += net;
    result[e.region] += net * riskWeight;
  }

  if (netTotal <= 0) return emptyRegionalRwa();
  const accountingScale = Math.max(0, item.balance) / netTotal;
  UK_ITL1_REGIONS.forEach(region => {
    result[region] *= accountingScale;
  });
  return result;
};

// Simplified standardised credit RWA. Product definitions identify a reusable
// credit-risk class; the prudential rule table owns the actual risk weights.
// Mortgage eligibility remains a portfolio-level assumption: LTV affects
// economic PD/LGD and stress rather than claiming exact pre-2027 CRR LTV buckets.
export const assetCreditRwa = (state: BankState, config: SimulationConfig, item: BalanceSheetItem): number => {
  const p = item.productType;
  const rule = getCreditRiskRule(p);
  const performingWeight = regulatoryRiskWeight(p);

  if (rule.exposureBasis === 'derivativeCounterparty') {
    return hedgeExposures(state).credit * performingWeight;
  }

  if (!hasCapability(p, 'loan')) {
    return Math.max(0, item.balance) * performingWeight;
  }

  const regional = loanCreditRwaByRegion(state, config, item);
  const regionalTotal = UK_ITL1_REGIONS.reduce((sum, region) => sum + regional[region], 0);
  if (regionalTotal > 0 || (state.loanCohorts[p]?.length ?? 0) > 0 || (state.workoutPipelines[p]?.length ?? 0) > 0) {
    return regionalTotal;
  }

  return Math.max(0, item.balance) * performingWeight;
};
""")

# Dedicated RWA dashboard with ITL1 choropleth, detailed composition, and history.
write("src/components/RwaDashboard.tsx", """import { useMemo, useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide } from '../domain/enums';
import { UK_ITL1_LABELS, UK_ITL1_REGIONS, UkItl1Region } from '../domain/ukItl1';
import { assetCreditRwa, loanCreditRwaByRegion } from '../engine/creditRwa';
import { formatCurrency, formatPct } from '../utils/formatters';
import TimeSeriesChart from './TimeSeriesChart';
import './RwaDashboard.css';

interface AssetRwaRow {
  label: string;
  exposure: number;
  rwa: number;
  effectiveWeight?: number;
}

export const rwaDashboardData = (state: BankState, config: SimulationConfig) => {
  const assets = state.financial.balanceSheet.items.filter(item => item.side === BalanceSheetSide.Asset);
  const assetRows: AssetRwaRow[] = assets.map(item => {
    const rwa = assetCreditRwa(state, config, item);
    return {
      label: item.label,
      exposure: Math.max(0, item.balance),
      rwa,
      effectiveWeight: item.balance > 0 ? rwa / item.balance : undefined,
    };
  });

  const regionalRwa = Object.fromEntries(
    UK_ITL1_REGIONS.map(region => [region, 0])
  ) as Record<UkItl1Region, number>;
  assets.forEach(item => {
    const byRegion = loanCreditRwaByRegion(state, config, item);
    UK_ITL1_REGIONS.forEach(region => {
      regionalRwa[region] += byRegion[region];
    });
  });

  const creditRwa = assetRows.reduce((sum, row) => sum + row.rwa, 0);
  const loanRwa = UK_ITL1_REGIONS.reduce((sum, region) => sum + regionalRwa[region], 0);
  const totalRwa = state.risk.riskMetrics.rwa;
  const addOns = totalRwa - creditRwa;
  const creditExposure = assetRows.reduce((sum, row) => sum + row.exposure, 0);

  return {
    totalRwa,
    creditRwa,
    loanRwa,
    addOns,
    effectiveCreditWeight: creditExposure > 0 ? creditRwa / creditExposure : NaN,
    regionalRwa,
    assetRows,
  };
};

const MAP_PATHS: Record<UkItl1Region, string> = {
  northernIreland: 'M28 214 L65 200 L90 220 L84 255 L55 274 L28 260 Z',
  scotland: 'M135 20 L205 28 L228 68 L214 110 L236 140 L205 168 L155 162 L132 125 L110 103 L122 58 Z',
  northEast: 'M205 168 L236 140 L251 181 L241 217 L216 226 L201 203 Z',
  northWest: 'M155 162 L205 168 L201 203 L187 232 L147 230 L130 198 Z',
  yorkshireAndTheHumber: 'M187 232 L201 203 L216 226 L241 217 L246 254 L222 273 L187 267 Z',
  westMidlands: 'M147 230 L187 232 L187 267 L173 310 L140 300 L125 265 Z',
  eastMidlands: 'M187 267 L222 273 L231 314 L203 332 L173 310 Z',
  wales: 'M125 265 L140 300 L132 339 L102 358 L82 334 L91 297 Z',
  eastOfEngland: 'M222 273 L246 254 L263 298 L260 345 L232 359 L203 332 L231 314 Z',
  southWest: 'M132 339 L173 310 L203 332 L190 369 L169 405 L130 424 L88 416 L102 385 Z',
  southEast: 'M203 332 L232 359 L260 345 L276 386 L247 416 L213 402 L190 369 Z',
  london: 'M220 356 L233 359 L238 372 L225 378 L215 369 Z',
};

const SummaryCard = ({ label, value, sub }: { label: string; value: string; sub: string }) => (
  <article className="capital-card rwa-summary-card">
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{sub}</small>
  </article>
);

function RegionMap({ regionalRwa }: { regionalRwa: Record<UkItl1Region, number> }) {
  const [active, setActive] = useState<UkItl1Region | null>(null);
  const maxRwa = Math.max(1, ...UK_ITL1_REGIONS.map(region => regionalRwa[region]));
  const fill = (region: UkItl1Region) => {
    const share = Math.max(0, Math.min(1, regionalRwa[region] / maxRwa));
    return `hsl(207 72% ${92 - share * 48}%)`;
  };
  const selected = active ?? UK_ITL1_REGIONS.reduce(
    (best, region) => regionalRwa[region] > regionalRwa[best] ? region : best,
    UK_ITL1_REGIONS[0]
  );

  return (
    <div className="rwa-map-layout">
      <div className="rwa-map-wrap">
        <svg className="rwa-region-map" viewBox="0 0 320 450" role="img" aria-label="UK loan risk-weighted assets by ITL1 region">
          {UK_ITL1_REGIONS.map(region => (
            <path
              key={region}
              d={MAP_PATHS[region]}
              fill={fill(region)}
              stroke="var(--panel)"
              strokeWidth={region === active ? 4 : 2}
              tabIndex={0}
              data-itl1-region={region}
              aria-label={`${UK_ITL1_LABELS[region]}: ${formatCurrency(regionalRwa[region])} RWA`}
              onMouseEnter={() => setActive(region)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(region)}
              onBlur={() => setActive(null)}
            >
              <title>{UK_ITL1_LABELS[region]} · {formatCurrency(regionalRwa[region])} RWA</title>
            </path>
          ))}
        </svg>
        <div className="rwa-map-scale" aria-label={`Colour scale from £0 to ${formatCurrency(maxRwa)}`}>
          <span>£0</span><i /><span>{formatCurrency(maxRwa)}</span>
        </div>
      </div>
      <div className="rwa-map-detail" aria-live="polite">
        <span>{UK_ITL1_LABELS[selected]}</span>
        <strong>{formatCurrency(regionalRwa[selected])}</strong>
        <small>Loan RWA</small>
        <ol>
          {[...UK_ITL1_REGIONS]
            .sort((a, b) => regionalRwa[b] - regionalRwa[a])
            .map(region => (
              <li key={region} className={region === active ? 'active' : ''}>
                <span>{UK_ITL1_LABELS[region]}</span><b>{formatCurrency(regionalRwa[region])}</b>
              </li>
            ))}
        </ol>
      </div>
    </div>
  );
}

export default function RwaDashboard({ state, config, history }: { state: BankState; config: SimulationConfig; history: BankState[] }) {
  const d = useMemo(() => rwaDashboardData(state, config), [state, config]);
  const compositionRows = [
    ...d.assetRows,
    { label: 'Configured risk add-ons', exposure: 0, rwa: d.addOns, effectiveWeight: undefined },
  ];
  const maxComposition = Math.max(1, ...compositionRows.map(row => Math.max(0, row.rwa)));
  const historyWithCurrent = history.length === 0 || history[history.length - 1]?.time.step !== state.time.step
    ? [...history, state]
    : history;

  return (
    <div className="rwa-dashboard">
      <div className="rwa-summary-grid">
        <SummaryCard label="Total RWA" value={formatCurrency(d.totalRwa)} sub="All risk-weighted assets" />
        <SummaryCard label="Credit RWA" value={formatCurrency(d.creditRwa)} sub={d.totalRwa > 0 ? `${formatPct(d.creditRwa / d.totalRwa)} of total` : 'N/A'} />
        <SummaryCard label="Loan RWA" value={formatCurrency(d.loanRwa)} sub={d.creditRwa > 0 ? `${formatPct(d.loanRwa / d.creditRwa)} of credit RWA` : 'N/A'} />
        <SummaryCard label="Effective credit RW" value={formatPct(d.effectiveCreditWeight)} sub="RWA / on-balance-sheet assets" />
      </div>

      <div className="rwa-main-grid">
        <section className="capital-card rwa-map-card">
          <div className="rwa-card-heading"><div><h3>UK loan RWA by region</h3><p>12 UK ITL1 statistical regions</p></div><strong>{formatCurrency(d.loanRwa)}</strong></div>
          <RegionMap regionalRwa={d.regionalRwa} />
        </section>

        <section className="capital-card rwa-composition-card">
          <div className="rwa-card-heading"><div><h3>RWA composition</h3><p>Credit exposures and configured add-ons</p></div><strong>{formatCurrency(d.totalRwa)}</strong></div>
          <div className="rwa-bars">
            {compositionRows.map(row => (
              <div className="rwa-bar-row" key={row.label}>
                <div><span>{row.label}</span><strong>{formatCurrency(row.rwa)}</strong></div>
                <div className="rwa-bar-track"><i style={{ width: `${Math.max(0, row.rwa) / maxComposition * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="table-wrap rwa-detail-table">
            <table>
              <thead><tr><th>Exposure</th><th className="align-right">Balance</th><th className="align-right">RWA</th><th className="align-right">Effective RW</th></tr></thead>
              <tbody>
                {d.assetRows.map(row => (
                  <tr key={row.label}><td>{row.label}</td><td className="align-right">{formatCurrency(row.exposure)}</td><td className="align-right">{formatCurrency(row.rwa)}</td><td className="align-right">{row.effectiveWeight === undefined ? '·' : formatPct(row.effectiveWeight)}</td></tr>
                ))}
                <tr><td>Configured risk add-ons</td><td className="align-right">·</td><td className="align-right">{formatCurrency(d.addOns)}</td><td className="align-right">·</td></tr>
                <tr className="total-row"><td>Total RWA</td><td className="align-right">·</td><td className="align-right">{formatCurrency(d.totalRwa)}</td><td className="align-right">·</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="capital-card rwa-history-card">
        <div className="rwa-card-heading"><div><h3>Risk-weighted assets over time</h3><p>Total RWA trend</p></div><strong>{formatCurrency(d.totalRwa)}</strong></div>
        <div className="rwa-history-chart">
          <TimeSeriesChart
            data={historyWithCurrent.map(s => ({ step: s.time.step, value: s.risk.riskMetrics.rwa / 1e9 }))}
            xLabel="Month"
            yLabel="RWA (£bn)"
          />
        </div>
      </section>
    </div>
  );
}
""")

write("src/components/RwaDashboard.css", """.rwa-dashboard { display: grid; gap: 16px; }
.rwa-summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.rwa-summary-card { display: grid; gap: 5px; padding: 15px 16px; }
.rwa-summary-card > span, .rwa-summary-card small { color: var(--muted); font-size: 11px; }
.rwa-summary-card strong { font-size: clamp(22px, 2vw, 30px); line-height: 1.08; }
.rwa-main-grid { display: grid; grid-template-columns: minmax(0, .92fr) minmax(0, 1.08fr); gap: 16px; align-items: stretch; }
.rwa-map-card, .rwa-composition-card, .rwa-history-card { padding: 16px; }
.rwa-card-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
.rwa-card-heading h3 { margin: 0; }
.rwa-card-heading p { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
.rwa-card-heading > strong { font-size: 16px; white-space: nowrap; }
.rwa-map-layout { display: grid; grid-template-columns: minmax(240px, .9fr) minmax(220px, 1.1fr); gap: 14px; min-height: 420px; }
.rwa-map-wrap { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.rwa-region-map { display: block; width: 100%; max-height: 370px; }
.rwa-region-map path { cursor: pointer; transition: filter .12s ease, stroke-width .12s ease; outline: none; }
.rwa-region-map path:hover, .rwa-region-map path:focus { filter: brightness(.91) saturate(1.12); }
.rwa-map-scale { display: grid; grid-template-columns: auto minmax(80px, 1fr) auto; gap: 8px; align-items: center; margin: 4px 18px 0; color: var(--muted); font-size: 10px; }
.rwa-map-scale i { height: 8px; border-radius: 999px; background: linear-gradient(90deg, hsl(207 72% 92%), hsl(207 72% 44%)); }
.rwa-map-detail { display: flex; flex-direction: column; min-width: 0; padding: 10px 0; }
.rwa-map-detail > span { color: var(--muted); font-size: 11px; }
.rwa-map-detail > strong { margin-top: 3px; font-size: 25px; }
.rwa-map-detail > small { color: var(--muted); font-size: 10px; }
.rwa-map-detail ol { margin: 14px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--border); overflow: auto; }
.rwa-map-detail li { display: flex; justify-content: space-between; gap: 10px; padding: 6px 4px; border-bottom: 1px solid color-mix(in srgb, var(--border) 65%, transparent); font-size: 10px; }
.rwa-map-detail li.active { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.rwa-map-detail li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rwa-map-detail li b { white-space: nowrap; }
.rwa-bars { display: grid; gap: 9px; margin-bottom: 16px; }
.rwa-bar-row > div:first-child { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 4px; font-size: 11px; }
.rwa-bar-row > div:first-child strong { white-space: nowrap; }
.rwa-bar-track { height: 12px; overflow: hidden; border-radius: 4px; background: color-mix(in srgb, var(--border) 75%, var(--bg-2)); }
.rwa-bar-track i { display: block; height: 100%; min-width: 0; border-radius: inherit; background: #2185c5; }
.rwa-detail-table { max-height: 310px; overflow: auto; }
.rwa-detail-table table { font-size: 11px; }
.rwa-history-card { min-height: 285px; }
.rwa-history-chart { height: 225px; }
@media (max-width: 1100px) {
  .rwa-main-grid { grid-template-columns: 1fr; }
  .rwa-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .rwa-map-layout { grid-template-columns: 1fr; }
  .rwa-map-detail ol { max-height: 220px; }
}
@media (max-width: 520px) {
  .rwa-summary-grid { grid-template-columns: 1fr; }
  .rwa-card-heading { flex-direction: column; }
}
""")

# Wire the dedicated dashboard into the RWA tab.
replace_once(
    "src/components/RegMetricsPanel.tsx",
    "import LeverageDashboard from './LeverageDashboard';\n",
    "import LeverageDashboard from './LeverageDashboard';\nimport RwaDashboard from './RwaDashboard';\n",
)
replace_once(
    "src/components/RegMetricsPanel.tsx",
    "metric === 'leverage' ? <LeverageDashboard state={state} config={config} history={history}/> : <div className=\"regulatory-grid\">",
    "metric === 'leverage' ? <LeverageDashboard state={state} config={config} history={history}/> : metric === 'rwa' ? <RwaDashboard state={state} config={config} history={history}/> : <div className=\"regulatory-grid\">",
)

write("src/engine/itl1Geography.test.ts", """import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { canonicalLoanGeography, isUkItl1Region, UK_ITL1_REGIONS } from '../domain/ukItl1';

describe('ITL1 loan geographies', () => {
  it('uses exactly the 12 UK ITL1 regions', () => {
    expect(UK_ITL1_REGIONS).toHaveLength(12);
    expect(new Set(UK_ITL1_REGIONS).size).toBe(12);
  });

  it('seeds every opening loan cohort into a canonical ITL1 region', () => {
    const cohorts = Object.values(initialState.loanCohorts ?? {}).flatMap(value => value ?? []);
    expect(cohorts.length).toBeGreaterThan(0);
    cohorts.forEach(cohort => expect(isUkItl1Region(cohort.geography)).toBe(true));
  });

  it('maps legacy broad buckets deterministically into ITL1 regions', () => {
    expect(canonicalLoanGeography('south', 0)).toBe('eastOfEngland');
    expect(canonicalLoanGeography('south', 1)).toBe('southEast');
    expect(canonicalLoanGeography('midlands', 1)).toBe('westMidlands');
    expect(canonicalLoanGeography('north', 2)).toBe('yorkshireAndTheHumber');
    expect(canonicalLoanGeography('other', 99)).toBe('eastOfEngland');
  });
});
""")

write("src/ui/rwaDashboard.test.tsx", """import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RwaDashboard, { rwaDashboardData } from '../components/RwaDashboard';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { UK_ITL1_LABELS, UK_ITL1_REGIONS } from '../domain/ukItl1';

it('reconciles the regional RWA map to loan credit RWA across all 12 ITL1 regions', () => {
  const data = rwaDashboardData(initialState, baseConfig);
  expect(Object.keys(data.regionalRwa)).toHaveLength(12);
  const regionalTotal = UK_ITL1_REGIONS.reduce((sum, region) => sum + data.regionalRwa[region], 0);
  expect(regionalTotal).toBeCloseTo(data.loanRwa, 4);
  expect(data.creditRwa + data.addOns).toBeCloseTo(data.totalRwa, 4);
});

it('renders a focusable coloured map with hover detail titles for every ITL1 region', () => {
  const html = renderToStaticMarkup(
    <RwaDashboard state={initialState} config={baseConfig} history={[initialState]} />
  );
  expect(html).toContain('UK loan RWA by region');
  expect(html).toContain('RWA composition');
  expect(html).toContain('Risk-weighted assets over time');
  expect((html.match(/data-itl1-region=/g) ?? []).length).toBe(12);
  expect((html.match(/tabindex=\"0\"/g) ?? []).length).toBeGreaterThanOrEqual(12);
  UK_ITL1_REGIONS.forEach(region => {
    expect(html).toContain(`data-itl1-region=\"${region}\"`);
    expect(html).toContain(UK_ITL1_LABELS[region]);
  });
});
""")

# Remove temporary scaffolding from the final commit.
(ROOT / "scripts/apply_itl1_rwa_map.py").unlink(missing_ok=True)
(ROOT / ".github/workflows/apply-itl1-rwa-map.yml").unlink(missing_ok=True)
