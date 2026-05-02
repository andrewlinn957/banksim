export type ScenarioMetricKey =
  | 'cet1Ratio'
  | 'leverageRatio'
  | 'lcr'
  | 'nsfr'
  | 'roe'
  | 'nim'
  | 'netIncome'
  | 'equity'
  | 'assets';

export interface ScenarioObjective {
  label: string;
  metric: ScenarioMetricKey;
  direction: 'min' | 'max';
  target: number;
  weight: number;
}

export interface ScenarioGoals {
  horizonMonths: number;
  objectives: ScenarioObjective[];
}

export interface ScenarioObjectiveEvaluation {
  label: string;
  metric: ScenarioMetricKey;
  current: number;
  target: number;
  direction: 'min' | 'max';
  weight: number;
  completion: number;
  passed: boolean;
}

export interface ScenarioScore {
  horizonMonths: number;
  rawScore: number;
  score: number;
  maxScore: number;
  completionPct: number;
  qualityPenalty: number;
  qualityPenaltyBreakdown: {
    franchise: number;
    funding: number;
    liquidity: number;
  };
  passed: boolean;
  details: ScenarioObjectiveEvaluation[];
}
