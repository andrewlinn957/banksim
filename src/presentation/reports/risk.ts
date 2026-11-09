import type { BankState } from '../../domain/bankState';
import type { SimulationConfig } from '../../domain/config';
import type { StepAttribution } from '../../domain/attribution';
import { AssetProductType, BalanceSheetSide } from '../../domain/enums';
import { PRODUCTS } from '../../products/catalogue';
import { formatCurrency, formatPct, formatSignedPct } from '../../utils/formatters';

export type RiskMetricTone = 'default' | 'good' | 'watch' | 'bad' | 'info';
export interface RiskDisplayMetric { label: string; value: string; helper?: string; tone: RiskMetricTone }
export interface RiskSignal { label: 'CET1' | 'Leverage' | 'LCR' | 'NSFR'; value: number; limit: number; watch: number; state: 'good' | 'watch' | 'bad'; headroom: number; barWidthPct: number }

export interface RiskDashboardData {
  status: 'Critical' | 'Attention' | 'Within limits';
  signals: RiskSignal[];
  balanceSheet: RiskDisplayMetric[];
  structural: RiskDisplayMetric[];
  earnings: RiskDisplayMetric[];
  macroObserved: RiskDisplayMetric[];
  macroModel: RiskDisplayMetric[];
  curve: {
    yields: BankState['market']['giltCurve']['yields'];
    series: Array<{ label: string; value: number; unit: 'annual-rate' }>;
    diagnostics: RiskDisplayMetric[];
  };
  lastClose?: Array<{ label: string; value: string }>;
}

const UK_MACRO_DIAGNOSTICS = { inflationTarget: 0.02, neutralRealMean: 0.0125, neutralRealStd: 0.0045, inflationResponse: 1.5, demandResponse: 0.003 };
const LOAN_PRODUCTS = new Set<string>(Object.values(PRODUCTS).filter((product) => product.behaviour.isLoan).map((product) => product.productType));
const CUSTOMER_DEPOSIT_PRODUCTS = new Set<string>(Object.values(PRODUCTS).filter((product) => product.behaviour.isCustomerDeposit).map((product) => product.productType));
const LIQUID_ASSET_PRODUCTS = new Set<string>([AssetProductType.CashReserves, AssetProductType.Gilts]);
const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
const formatFactor = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : '—');
const formatOptionalPct = (value: number | null | undefined): string => value == null || !Number.isFinite(value) ? '—' : formatPct(value);
const signalState = (value: number, limit: number, watchBuffer: number): RiskSignal['state'] => value < limit ? 'bad' : value < limit + watchBuffer ? 'watch' : 'good';
const fundingTone = (state: string): RiskMetricTone => state === 'stressed' ? 'bad' : state === 'watch' ? 'watch' : state === 'strong' || state === 'stable' ? 'good' : 'default';
const limitTone = (value: number, limit: number): RiskMetricTone => value > limit ? 'bad' : value > limit * 0.9 ? 'watch' : 'good';
const metric = (label: string, value: string, helper?: string, tone: RiskMetricTone = 'default'): RiskDisplayMetric => ({ label, value, ...(helper ? { helper } : {}), tone });

/** All values, labels, precision and annotations rendered by RiskDashboard. */
export const buildRiskDashboardData = (state: BankState, config: SimulationConfig, attribution?: StepAttribution | null): RiskDashboardData => {
  const risk = state.risk.riskMetrics;
  const items = state.financial.balanceSheet.items;
  const sumItems = (predicate: (item: (typeof items)[number]) => boolean) => items.filter(predicate).reduce((sum, item) => sum + item.balance, 0);
  const assets = sumItems((item) => item.side === BalanceSheetSide.Asset);
  const loans = sumItems((item) => item.side === BalanceSheetSide.Asset && LOAN_PRODUCTS.has(item.productType));
  const deposits = sumItems((item) => item.side === BalanceSheetSide.Liability && CUSTOMER_DEPOSIT_PRODUCTS.has(item.productType));
  const liquidAssets = sumItems((item) => item.side === BalanceSheetSide.Asset && LIQUID_ASSET_PRODUCTS.has(item.productType));
  const equity = state.financial.capital.cet1 + state.financial.capital.at1 + state.financial.capital.accumulatedOCI;
  const roe = equity > 0 ? state.financial.incomeStatement.netIncome * 12 / equity : 0;
  const nim = assets > 0 ? state.financial.incomeStatement.netInterestIncome * 12 / assets : 0;
  const cohorts = Object.values(state.loanCohorts ?? {}).flatMap((rows) => rows ?? []);
  const grossCohortLoans = cohorts.reduce((sum, cohort) => sum + cohort.outstandingPrincipal, 0);
  const stage23Loans = cohorts.filter((cohort) => cohort.stage === 'stage2' || cohort.stage === 'stage3').reduce((sum, cohort) => sum + cohort.outstandingPrincipal, 0);
  const stage3Loans = cohorts.filter((cohort) => cohort.stage === 'stage3').reduce((sum, cohort) => sum + cohort.outstandingPrincipal, 0);
  const macro = state.market.macroModel;
  const factors = macro.factors;
  const rStarReal = UK_MACRO_DIAGNOSTICS.neutralRealMean + UK_MACRO_DIAGNOSTICS.neutralRealStd * factors.R;
  const neutralNominal = rStarReal + UK_MACRO_DIAGNOSTICS.inflationTarget;
  const policyTarget = rStarReal + state.market.inflationRate + UK_MACRO_DIAGNOSTICS.inflationResponse * (state.market.inflationRate - UK_MACRO_DIAGNOSTICS.inflationTarget) + UK_MACRO_DIAGNOSTICS.demandResponse * factors.D;
  const { yields, nelsonSiegel } = state.market.giltCurve;
  const signals = [
    { label: 'CET1' as const, value: risk.cet1Ratio, limit: risk.cet1Requirement, watch: 0.015 },
    { label: 'Leverage' as const, value: risk.leverageRatio, limit: config.riskLimits.minLeverageRatio, watch: 0.0075 },
    { label: 'LCR' as const, value: risk.lcr, limit: config.riskLimits.minLcr, watch: 0.15 },
    { label: 'NSFR' as const, value: risk.nsfr, limit: config.riskLimits.minNsfr, watch: 0.12 },
  ].map((signal) => ({
    ...signal,
    state: signalState(signal.value, signal.limit, signal.watch),
    headroom: signal.value - signal.limit,
    barWidthPct: Math.max(0, Math.min(100, signal.value / Math.max(signal.limit * 1.5, 0.0001) * 100)),
  }));
  const hasBad = signals.some((signal) => signal.state === 'bad');
  const hasWatch = signals.some((signal) => signal.state === 'watch');
  const status = state.status.hasFailed || hasBad ? 'Critical' : hasWatch || risk.internalCet1Headroom < 0 ? 'Attention' : 'Within limits';
  const insuredRetailShare = risk.insuredRetailDepositShare ?? state.behaviour.insuredRetailDepositShare;
  const largeDepositorShare = risk.largeDepositorShare ?? state.behaviour.largeDepositorShare;
  const twoTenSlope = yields.y10 - yields.y2;
  const fiveThirtySlope = yields.y30 - yields.y5;
  const lastClose = attribution ? (['nim', 'cet1Ratio', 'lcr', 'nsfr'] as const).map((key) => {
    const item = attribution.metrics[key];
    const driver = item.lines.find((line) => line.id === item.topPositiveDriverId)?.label ?? 'None';
    return [{ label: item.label, value: formatSignedPct(item.delta) }, ...(key === 'cet1Ratio' ? [{ label: 'Top CET1 driver', value: driver }] : [])];
  }).flat() : undefined;

  return {
    status,
    signals,
    balanceSheet: [
      metric('NII +100bp', formatCurrency(risk.niiSensitivity100bp), undefined, 'info'),
      metric('EVE +100bp', formatCurrency(risk.eveSensitivity100bp), undefined, 'info'),
      metric('Funding ≤3m', formatCurrency(risk.fundingMaturing3m)),
      metric('Funding ≤12m', formatCurrency(risk.fundingMaturing12m)),
      metric('Deposit quality', formatPct(risk.depositQualityIndex)),
      metric('Funding confidence', formatPct(risk.fundingConfidenceScore), titleCase(risk.fundingConfidenceState), fundingTone(risk.fundingConfidenceState)),
      metric('Largest sector', formatPct(risk.sectorConcentration), undefined, limitTone(risk.sectorConcentration, config.riskLimits.concentration.maxSingleSectorShare)),
      metric('Largest geography', formatPct(risk.geographyConcentration), undefined, limitTone(risk.geographyConcentration, config.riskLimits.concentration.maxSingleGeographyShare)),
    ],
    structural: [
      metric('Loan / deposit', formatPct(deposits > 0 ? loans / deposits : 0), 'Net loans ÷ customer deposits', 'info'),
      metric('Liquid assets / assets', formatPct(assets > 0 ? liquidAssets / assets : 0), 'Reserves + gilts', 'info'),
      metric('RWA density', formatPct(assets > 0 ? risk.rwa / assets : 0), 'RWA ÷ total assets', 'info'),
      metric('Stage 2 + 3 loans', formatPct(grossCohortLoans > 0 ? stage23Loans / grossCohortLoans : 0), 'Share of cohort principal'),
      metric('Stage 3 loans', formatPct(grossCohortLoans > 0 ? stage3Loans / grossCohortLoans : 0), 'Share of cohort principal'),
      metric('Provision / Stage 3', formatOptionalPct(stage3Loans > 0 ? state.financial.provisionStock.total / stage3Loans : null), 'Total provisions ÷ Stage 3'),
      metric('Largest depositor', formatOptionalPct(largeDepositorShare), 'Share of total deposits'),
      metric('Retail deposits insured', formatOptionalPct(insuredRetailShare), 'Approx. FSCS-protected share'),
    ],
    earnings: [
      metric('ROE annualised', formatPct(roe), undefined, roe < 0 ? 'bad' : 'default'),
      metric('NIM annualised', formatPct(nim), undefined, nim < 0 ? 'bad' : 'default'),
      metric('Deposit franchise', formatPct(state.behaviour.depositFranchiseStrength)),
      metric('Share price', `£${state.equityMarket.sharePrice.toFixed(2)}`),
      metric('Market cap', formatCurrency(state.equityMarket.marketCap)),
      metric('Total assets', formatCurrency(assets)),
    ],
    macroObserved: [
      metric('Regime', titleCase(macro.gdpRegime), undefined, macro.gdpRegime === 'recession' ? 'bad' : 'good'),
      metric('GDP MoM', formatSignedPct(state.market.gdpGrowthMoM), undefined, 'info'),
      metric('Inflation YoY', formatPct(state.market.inflationRate), undefined, 'info'),
      metric('Unemployment', formatPct(state.market.unemploymentRate), undefined, 'info'),
      metric('Bank Rate', formatPct(state.market.baseRate), undefined, 'info'),
      metric('Credit spread', formatPct(state.market.creditSpread), undefined, 'info'),
    ],
    macroModel: [
      metric('R* real', formatPct(rStarReal), 'Neutral real rate', 'info'),
      metric('Neutral nominal', formatPct(neutralNominal), undefined, 'info'),
      metric('Policy target', formatPct(policyTarget), 'Before smoothing', 'info'),
      metric('Term premium', formatPct(macro.termPremium), undefined, 'info'),
      metric('Demand (D)', formatFactor(factors.D)),
      metric('Supply (S)', formatFactor(factors.S)),
      metric('Financial stress (F)', formatFactor(factors.F)),
      metric('Neutral-rate factor (R)', formatFactor(factors.R)),
    ],
    curve: {
      yields,
      series: Object.entries(yields).map(([label, value]) => ({ label, value, unit: 'annual-rate' as const })),
      diagnostics: [
        metric('1Y', formatPct(yields.y1), undefined, 'info'), metric('10Y', formatPct(yields.y10), undefined, 'info'),
        metric('30Y', formatPct(yields.y30), undefined, 'info'), metric('2s10s', formatSignedPct(twoTenSlope)),
        metric('5s30s', formatSignedPct(fiveThirtySlope)), metric('NS level β0', formatPct(nelsonSiegel.level), undefined, 'info'),
        metric('NS slope β1', formatSignedPct(nelsonSiegel.slope), undefined, 'info'), metric('NS curvature β2', formatSignedPct(nelsonSiegel.curvature), undefined, 'info'),
        metric('NS λ', nelsonSiegel.lambda.toFixed(2)),
      ],
    },
    ...(lastClose ? { lastClose } : {}),
  };
};
