export type GdpRegime = 'normal' | 'recession';

export interface UkMacroFactors {
  D: number;
  S: number;
  F: number;
  R: number;
}

export interface UkMacroModelState {
  factors: UkMacroFactors;
  gdpRegime: GdpRegime;
  unemploymentLatent: number;
  termPremium: number;
  rngSeed: number;
}

export interface NelsonSiegelFactors {
  level: number;
  slope: number;
  curvature: number;
  lambda: number;
}

export interface GiltCurveYields {
  y1: number;
  y2: number;
  y3: number;
  y5: number;
  y10: number;
  y20: number;
  y30: number;
}

export interface GiltCurveState {
  nelsonSiegel: NelsonSiegelFactors;
  yields: GiltCurveYields;
}

export interface MarketState {
  baseRate: number;
  riskFreeShort: number;
  riskFreeLong: number;
  mortgageSpread: number;
  corporateLoanSpread: number;
  wholesaleFundingSpread: number;
  seniorDebtSpread: number;
  giltRepoHaircut: number;
  corpBondRepoHaircut: number;
  competitorRetailDepositRate: number;
  competitorMortgageRate: number;
  competitorCorporateDepositRate?: number;

  gdpGrowthMoM: number;
  unemploymentRate: number;
  inflationRate: number;

  creditSpread: number;
  giltCurve: GiltCurveState;
  macroModel: UkMacroModelState;
}
