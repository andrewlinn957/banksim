export type AttributionMetricKey = 'cet1Ratio' | 'lcr' | 'nsfr' | 'nim';

export type AttributionLineCategory =
  | 'capital'
  | 'liquidity'
  | 'funding'
  | 'profitability'
  | 'assets'
  | 'operations'
  | 'other';

export interface AttributionLine {
  id: string;
  label: string;
  effect: number;
  eventIds: string[];
  category: AttributionLineCategory;
}

export interface MetricAttribution {
  metric: AttributionMetricKey;
  label: string;
  unit: 'ratio';
  before: number;
  after: number;
  delta: number;
  lines: AttributionLine[];
  reconciledDelta: number;
  residual: number;
  topPositiveDriverId?: string;
  topNegativeDriverId?: string;
}

export interface StepAttribution {
  generatedAt: number;
  metrics: Record<AttributionMetricKey, MetricAttribution>;
  eventIndex: Record<string, string[]>;
}

export interface AttributionLineSelection {
  metric: AttributionMetricKey;
  metricLabel: string;
  lineId: string;
  lineLabel: string;
  effect: number;
  eventIds: string[];
}
