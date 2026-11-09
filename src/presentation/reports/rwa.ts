import type { BankState } from '../../domain/bankState';
import type { SimulationConfig } from '../../domain/config';
import { BalanceSheetSide } from '../../domain/enums';
import { UK_ITL1_REGIONS, type UkItl1Region } from '../../domain/ukItl1';
import { assetCreditRwa, loanCreditRwaByRegion } from '../../engine/creditRwa';

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
  const operationalRiskRwa = Math.max(0, config.riskLimits.rwaAddOns?.operationalRisk ?? 0);
  const totalRwa = state.risk.riskMetrics.rwa;
  const addOns = totalRwa - creditRwa;
  const creditExposure = assetRows.reduce((sum, row) => sum + row.exposure, 0);

  return {
    totalRwa,
    creditRwa,
    loanRwa,
    operationalRiskRwa,
    addOns,
    effectiveCreditWeight: creditExposure > 0 ? creditRwa / creditExposure : NaN,
    regionalRwa,
    assetRows,
  };
};
