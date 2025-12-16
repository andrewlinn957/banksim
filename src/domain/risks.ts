export interface CapitalState {
  cet1: number;
  at1: number;
}

export interface RiskMetrics {
  rwa: number;
  leverageExposure: number;
  cet1Ratio: number;
  leverageRatio: number;
  hqla: number;
  lcr: number;
  lcrOutflowMultiplier: number;
  asf: number;
  rsf: number;
  nsfr: number;
}

export interface RiskLimits {
  minCet1Ratio: number;
  minLeverageRatio: number;
  minLcr: number;
  minNsfr: number;
}

export interface ComplianceStatus {
  cet1Breached: boolean;
  leverageBreached: boolean;
  lcrBreached: boolean;
  nsfrBreached: boolean;
}
