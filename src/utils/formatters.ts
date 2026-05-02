export const formatCurrency = (v: number, fallback = 'N/A'): string =>
  Number.isFinite(v) ? `£${(v / 1e9).toFixed(2)}bn` : fallback;

export const formatPct = (v: number, digits = 2, fallback = 'N/A'): string =>
  Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : fallback;

export const formatSignedPct = (v: number, digits = 2, fallback = 'N/A'): string => {
  if (!Number.isFinite(v)) return fallback;
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(digits)}%`;
};

export const formatChange = (v: number | null, fallback = '-'): string => {
  if (v === null || !Number.isFinite(v)) return fallback;
  const fixed = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
  return `${v > 0 ? '+' : ''}${fixed}%`;
};

export const formatMultiple = (v: number, digits = 2, fallback = 'N/A'): string =>
  Number.isFinite(v) ? `${v.toFixed(digits)}x` : fallback;

export const formatInt = (v: number, fallback = '-'): string =>
  Number.isFinite(v) ? `${Math.round(v)}` : fallback;

export const formatNumber = (v: number, digits = 2, fallback = 'N/A'): string =>
  Number.isFinite(v) ? v.toFixed(digits) : fallback;

export const formatRate = (v: number | undefined, fallback = '-'): string =>
  v === undefined || !Number.isFinite(v) ? fallback : `${(v * 100).toFixed(2)}%`;

export const formatAxisValue = (value: number, yLabel?: string): string => {
  if (!Number.isFinite(value)) return '';

  const label = yLabel?.toLowerCase() ?? '';
  if (label.includes('%')) {
    const pct = value * 100;
    return `${pct.toFixed(Math.abs(pct) >= 10 ? 0 : 1)}%`;
  }

  const abs = Math.abs(value);
  if (abs >= 1e9) return `£${(value / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}bn`;
  if (abs >= 1e6) return `£${(value / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}m`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  if (abs >= 1) return value.toFixed(abs >= 10 ? 0 : 1);
  return value.toFixed(2);
};

export const buildValueTicks = (min: number, max: number, desired = 4): number[] => {
  let localMin = min;
  let localMax = max;

  if (localMin === localMax) {
    const pad = Math.max(Math.abs(localMin) * 0.25, 1);
    localMin -= pad;
    localMax += pad;
  }

  const span = localMax - localMin;
  const rawStep = span / Math.max(desired, 1);
  if (!Number.isFinite(rawStep) || rawStep === 0) return [localMin, localMax];

  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(rawStep)));
  const normalized = rawStep / magnitude;
  let niceNormalized = 1;
  if (normalized > 5) niceNormalized = 10;
  else if (normalized > 2) niceNormalized = 5;
  else if (normalized > 1) niceNormalized = 2;

  const step = niceNormalized * magnitude;
  const start = Math.floor(localMin / step) * step;
  const end = Math.ceil(localMax / step) * step;

  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) {
    const rounded = Number(v.toFixed(10));
    if (!ticks.includes(rounded)) ticks.push(rounded);
  }

  if (ticks.length < 2) {
    ticks.push(Number((start + step).toFixed(10)));
  }
  return ticks;
};
