import { BankState } from '../domain/bankState';
import { BalanceSheetItem } from '../domain/balanceSheet';
import { BalanceSheetSide, HQLALevel, LiabilityProductType, ProductType } from '../domain/enums';
import { SimulationConfig } from '../domain/config';
import { ComplianceStatus, RiskLimits, RiskMetrics } from '../domain/risks';
import { LiquidityTag } from '../domain/liquidity';

const HQLA_FACTORS: Record<HQLALevel, number> = {
  [HQLALevel.Level1]: 1.0,
  [HQLALevel.Level2A]: 0.85,
  [HQLALevel.Level2B]: 0.5,
  [HQLALevel.None]: 0,
};

const computeHqla = (items: BalanceSheetItem[]): number => {
  return items.reduce((sum, item) => {
    if (!item.liquidityTag) return sum;
    const factor = HQLA_FACTORS[item.liquidityTag.hqlaLevel] ?? 0;
    const enc = item.encumbrance?.encumberedAmount ?? 0;
    const unencumbered = Math.max(0, item.balance - enc);
    return sum + unencumbered * factor;
  }, 0);
};

const computeLcr = (
  items: BalanceSheetItem[],
  hqla: number,
  lcrOutflowMultiplier: number
): { lcr: number; netOutflows: number } => {
  let outflows = 0;
  let inflows = 0;
  items.forEach((item) => {
    const tag: LiquidityTag | undefined = item.liquidityTag;
    if (!tag) return;
    if (tag.lcrOutflowRate !== undefined) {
      const multiplier =
        item.productType === LiabilityProductType.RetailDeposits ||
        item.productType === LiabilityProductType.CorporateDeposits
          ? lcrOutflowMultiplier
          : 1;
      outflows += item.balance * tag.lcrOutflowRate * multiplier;
    }
    if (tag.lcrInflowRate !== undefined) {
      inflows += item.balance * tag.lcrInflowRate;
    }
  });
  const inflowsCapped = Math.min(inflows, 0.75 * outflows);
  const netOutflows = Math.max(0, outflows - inflowsCapped);
  const lcr = netOutflows > 0 ? hqla / netOutflows : Infinity;
  return { lcr, netOutflows };
};

const computeNsfr = (
  items: BalanceSheetItem[],
  cet1: number,
  at1: number
): { asf: number; rsf: number; nsfr: number } => {
  let asf = cet1 + at1;
  let rsf = 0;
  items.forEach((item) => {
    const tag = item.liquidityTag;
    if (!tag) return;
    if (tag.nsfrAsfFactor !== undefined) {
      asf += item.balance * tag.nsfrAsfFactor;
    }
    if (tag.nsfrRsfFactor !== undefined) {
      rsf += item.balance * tag.nsfrRsfFactor;
    }
  });
  const nsfr = rsf > 0 ? asf / rsf : Infinity;
  return { asf, rsf, nsfr };
};

export interface MetricsInput {
  state: BankState;
  config: SimulationConfig;
  lcrOutflowMultiplier?: number;
}

export const calculateRiskMetrics = ({ state, config, lcrOutflowMultiplier = 1 }: MetricsInput): RiskMetrics => {
  const assets = state.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset);
  const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);
  const rwa = assets.reduce((sum, a) => {
    const params = config.productParameters[a.productType];
    return sum + a.balance * (params?.riskWeight ?? 0);
  }, 0);
  const leverageExposure = totalAssets;
  const cet1Ratio = rwa > 0 ? state.capital.cet1 / rwa : Infinity;
  const leverageRatio = leverageExposure > 0 ? (state.capital.cet1 + state.capital.at1) / leverageExposure : Infinity;

  const hqla = computeHqla(assets);
  const { lcr } = computeLcr(state.balanceSheet.items, hqla, lcrOutflowMultiplier);
  const { asf, rsf, nsfr } = computeNsfr(state.balanceSheet.items, state.capital.cet1, state.capital.at1);

  return {
    rwa,
    leverageExposure,
    cet1Ratio,
    leverageRatio,
    hqla,
    lcr,
    lcrOutflowMultiplier,
    asf,
    rsf,
    nsfr,
  };
};

export const evaluateCompliance = (metrics: RiskMetrics, limits: RiskLimits): ComplianceStatus => ({
  cet1Breached: metrics.cet1Ratio < limits.minCet1Ratio,
  leverageBreached: metrics.leverageRatio < limits.minLeverageRatio,
  lcrBreached: metrics.lcr < limits.minLcr,
  nsfrBreached: metrics.nsfr < limits.minNsfr,
});
