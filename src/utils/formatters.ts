/**
 * Shared formatting utilities for displaying financial values.
 *
 * All formatters handle non-finite values (NaN, Infinity) gracefully
 * by returning a fallback string.
 */

/**
 * Format a number as currency in billions with £ symbol.
 * @param v - Value in raw units (e.g., 30000000000 for £30bn)
 * @param fallback - String to return if value is not finite
 */
export const formatCurrency = (v: number, fallback = 'N/A'): string =>
  Number.isFinite(v) ? `£${(v / 1e9).toFixed(2)}bn` : fallback;

/**
 * Format a decimal as a percentage.
 * @param v - Decimal value (e.g., 0.05 for 5%)
 * @param digits - Number of decimal places
 * @param fallback - String to return if value is not finite
 */
export const formatPct = (v: number, digits = 2, fallback = 'N/A'): string =>
  Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : fallback;

/**
 * Format a decimal as a percentage with +/- sign prefix.
 * @param v - Decimal value (e.g., 0.05 for +5%)
 * @param digits - Number of decimal places
 * @param fallback - String to return if value is not finite
 */
export const formatSignedPct = (v: number, digits = 2, fallback = 'N/A'): string => {
  if (!Number.isFinite(v)) return fallback;
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(digits)}%`;
};

/**
 * Format a percentage change value with +/- sign and dynamic precision.
 * Uses 0 decimals for large values (>=100), 1 decimal otherwise.
 * @param v - Percentage value (e.g., 5.5 for 5.5%)
 * @param fallback - String to return if value is not finite
 */
export const formatChange = (v: number | null, fallback = '—'): string => {
  if (v === null || !Number.isFinite(v)) return fallback;
  const fixed = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
  return `${v > 0 ? '+' : ''}${fixed}%`;
};

/**
 * Format a number as a multiplier with 'x' suffix.
 * @param v - Multiplier value (e.g., 1.5 for 1.50x)
 * @param digits - Number of decimal places
 * @param fallback - String to return if value is not finite
 */
export const formatMultiple = (v: number, digits = 2, fallback = 'N/A'): string =>
  Number.isFinite(v) ? `${v.toFixed(digits)}x` : fallback;

/**
 * Format a number as an integer.
 * @param v - Value to round
 * @param fallback - String to return if value is not finite
 */
export const formatInt = (v: number, fallback = '—'): string =>
  Number.isFinite(v) ? `${Math.round(v)}` : fallback;

/**
 * Format a number with custom precision.
 * @param v - Value to format
 * @param digits - Number of decimal places
 * @param fallback - String to return if value is not finite
 */
export const formatNumber = (v: number, digits = 2, fallback = 'N/A'): string =>
  Number.isFinite(v) ? v.toFixed(digits) : fallback;

/**
 * Format an interest rate (decimal) as a percentage, handling undefined values.
 * @param v - Rate as decimal (e.g., 0.05 for 5%)
 * @param fallback - String to return if value is undefined or not finite
 */
export const formatRate = (v: number | undefined, fallback = '—'): string =>
  v === undefined || !Number.isFinite(v) ? fallback : `${(v * 100).toFixed(2)}%`;

/**
 * Format a value for chart axis display with dynamic scaling (bn/m/k).
 * Automatically chooses appropriate scale and precision based on magnitude.
 * @param value - Raw numeric value
 * @param yLabel - Optional axis label to detect percentage formatting
 */
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

/**
 * Build "nice" tick values for chart axes.
 * Calculates evenly spaced tick marks at round numbers.
 * @param min - Minimum data value
 * @param max - Maximum data value
 * @param desired - Desired number of ticks (approximate)
 */
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
    if (!ticks.includes(rounded)) {
      ticks.push(rounded);
    }
  }

  if (ticks.length < 2) {
    ticks.push(Number((start + step).toFixed(10)));
  }

  return ticks;
};
