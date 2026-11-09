import type { BankState } from '../../domain/bankState';
import type { SimulationConfig } from '../../domain/config';
import { BalanceSheetSide, HQLALevel } from '../../domain/enums';
import { hedgeExposures } from '../../engine/hedgeValuation';
import { assetCreditRwa } from '../../engine/creditRwa';
import { computeHqla, HQLA_FACTORS } from '../../engine/metrics';
import { centralBankExclusion, committedExposure, commitmentLiquidity, eligibleCet1, prudentialLiquidityLines } from '../../engine/prudential';
import { liquidityTagForProduct, productTypesWithLeverageTreatment } from '../../products/regulatory';
export type RegulatoryMetric = 'capital' | 'rwa' | 'leverage' | 'lcr' | 'nsfr';
interface Row { label: string; value: number; factor?: number; ratio?: boolean; total?: boolean; }
const DERIVATIVE_LEVERAGE_PRODUCTS = new Set(productTypesWithLeverageTreatment('derivativeAssetReplacement'));

export const regulatoryRows = (s: BankState, c: SimulationConfig, metric: RegulatoryMetric): Row[] => {
  const m = s.risk.riskMetrics, assets = s.financial.balanceSheet.items.filter(i => i.side === BalanceSheetSide.Asset);
  const lines = prudentialLiquidityLines(s, c), undrawn = commitmentLiquidity(s);
  if (metric === 'capital') return [
    { label: 'CET1 including eligible OCI', value: eligibleCet1(s, c) }, { label: 'AT1', value: s.financial.capital.at1 },
    { label: 'CET1 ratio', value: m.cet1Ratio, ratio: true }, { label: 'Tier 1 ratio', value: m.tier1Ratio ?? 0, ratio: true },
    { label: 'Total capital ratio', value: m.totalCapitalRatio ?? 0, ratio: true },
    { label: 'CET1 needed for own-funds minima and combined buffers', value: m.cet1Requirement, ratio: true },
    { label: 'Minimum CET1 including Pillar 2A', value: m.minimumCet1Ratio ?? c.riskLimits.minCet1Ratio, ratio: true },
    { label: 'CET1 including PRA buffer', value: m.praBufferTarget ?? m.cet1Requirement, ratio: true },
    { label: 'Internal CET1 target', value: m.internalCet1TargetRatio, ratio: true },
    { label: 'Bank policy payout cap', value: m.maxPayoutRatio, ratio: true },
  ];
  if (metric === 'rwa') {
    const rows: Row[] = assets.map(i => ({ label: i.label, value: assetCreditRwa(s,c,i), factor: i.balance > 0 ? assetCreditRwa(s,c,i)/i.balance : undefined }));
    rows.push({ label: 'Undrawn commitments and configured risk add-ons', value: m.rwa - rows.reduce((sum, r) => sum + r.value, 0) });
    return [...rows, { label: 'Total risk-weighted assets', value: m.rwa, total: true }];
  }
  if (metric === 'leverage') {
    const derivativeBook = assets.reduce(
      (sum, item) => sum + (DERIVATIVE_LEVERAGE_PRODUCTS.has(item.productType) ? Math.max(0, item.balance) : 0),
      0
    );
    return [
      ...assets.map(i => ({ label: i.label, value: i.balance })),
      { label: 'Replace derivative book value with prudential exposure', value: hedgeExposures(s).leverage - derivativeBook },
      { label: 'Eligible central bank reserves exclusion', value: -centralBankExclusion(s) },
      { label: 'Undrawn commitments × 20% CCF', value: committedExposure(s) * .2, factor: .2 },
      { label: 'Total exposure measure', value: m.leverageExposure, total: true },
      { label: 'Eligible Tier 1 capital', value: eligibleCet1(s, c) + s.financial.capital.at1 },
      { label: 'Leverage ratio', value: m.leverageRatio, ratio: true, total: true },
    ];
  }
  if (metric === 'nsfr') return [
    { label: 'ASF · eligible capital', value: eligibleCet1(s, c) + s.financial.capital.at1, factor: 1 },
    ...lines.filter(l => !l.asset).map(l => ({ label: `ASF · ${l.label}`, value: l.asf, factor: l.balance > 0 ? l.asf / l.balance : 0 })),
    { label: 'Total available stable funding', value: m.asf, total: true },
    ...lines.filter(l => l.asset || l.rsf > 0).map(l => ({ label: `RSF · ${l.label}`, value: l.rsf, factor: l.balance > 0 ? l.rsf / l.balance : 0 })),
    { label: 'RSF · undrawn commitments', value: undrawn.rsf, factor: .05 },
    { label: 'Total required stable funding', value: m.rsf, total: true },
    { label: 'NSFR', value: m.nsfr, ratio: true, total: true },
  ];
  const hqlaRows = assets
    .map(i => ({ item: i, tag: liquidityTagForProduct(i.productType) }))
    .filter(({ tag }) => tag.hqlaLevel !== HQLALevel.None)
    .map(({ item, tag }) => ({
      label: `HQLA · ${item.label}`,
      value: Math.max(0, item.balance - Math.max(0, item.encumbrance?.encumberedAmount ?? 0)) * (HQLA_FACTORS[tag.hqlaLevel] ?? 0),
      factor: HQLA_FACTORS[tag.hqlaLevel] ?? 0,
    }));
  const out = lines.reduce((sum, l) => sum + l.outflow, undrawn.outflow), incoming = lines.reduce((sum, l) => sum + l.inflow, 0);
  return [
    ...hqlaRows, { label: 'HQLA composition cap adjustment', value: computeHqla(assets) - hqlaRows.reduce((sum, r) => sum + r.value, 0) },
    { label: 'Total HQLA', value: m.hqla, total: true },
    ...lines.filter(l => !l.asset).map(l => ({ label: `Outflow · ${l.label}`, value: l.outflow, factor: l.balance > 0 ? l.outflow / l.balance : 0 })),
    { label: 'Outflow · undrawn commitments', value: undrawn.outflow },
    { label: 'Total outflows', value: out, total: true },
    ...lines.filter(l => l.inflow > 0).map(l => ({ label: `Inflow · ${l.label}`, value: l.inflow })),
    { label: 'Eligible inflows after 75% cap', value: Math.min(incoming, out * .75), total: true },
    { label: 'Net outflows', value: out - Math.min(incoming, out * .75), total: true },
    { label: 'LCR', value: m.lcr, ratio: true, total: true },
  ];
};
