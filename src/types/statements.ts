export interface SeriesPoint {
  step: number;
  value: number;
}

export interface StatementRow {
  id: string;
  label: string;
  value: number;
  changePct: number | null;
  series: SeriesPoint[];
  rate?: number;
  display?: 'currency' | 'percent';
  meta?: Record<string, string | number | undefined>;
}
