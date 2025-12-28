import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, LinearScale, PointElement, LineElement, LineController, Filler, Tooltip } from 'chart.js';
import type { TooltipItem } from 'chart.js';
import { SeriesPoint } from '../types/statements';
import { formatAxisValue } from '../utils/formatters';

ChartJS.register(LineController, LinearScale, PointElement, LineElement, Filler, Tooltip);

type Props = {
  data: SeriesPoint[];
  xLabel?: string;
  yLabel?: string;
  xTickInterval?: number;
};

type ChartColors = {
  accent: string;
  accentFill: string;
  border: string;
  borderStrong: string;
  dim: string;
};

const readCssVar = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const toRgba = (color: string, alpha: number, fallback: string): string => {
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    const isShort = hex.length === 3;
    const isLong = hex.length === 6;
    if (isShort || isLong) {
      const hexValue = isShort
        ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
        : hex;
      const r = parseInt(hexValue.slice(0, 2), 16);
      const g = parseInt(hexValue.slice(2, 4), 16);
      const b = parseInt(hexValue.slice(4, 6), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    }
  }

  const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((part) => part.trim());
    if (parts.length >= 3) {
      const r = Number(parts[0]);
      const g = Number(parts[1]);
      const b = Number(parts[2]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    }
  }

  return fallback;
};

const useChartColors = (): ChartColors =>
  useMemo(() => {
    const accent = readCssVar('--accent', '#007fa6');
    const border = readCssVar('--border', '#d6d6d6');
    const borderStrong = readCssVar('--border-strong', '#bdbdbd');
    const dim = readCssVar('--dim', '#6b6b6b');
    return {
      accent,
      accentFill: toRgba(accent, 0.18, 'rgba(0, 127, 166, 0.18)'),
      border,
      borderStrong,
      dim,
    };
  }, []);

const TimeSeriesChart = ({ data, xLabel = 'Simulation step', yLabel = 'Value', xTickInterval = 12 }: Props) => {
  const colors = useChartColors();
  const sorted = useMemo(
    () =>
      data
        .filter((point) => Number.isFinite(point.step) && Number.isFinite(point.value))
        .sort((a, b) => a.step - b.step),
    [data]
  );

  const chartData = useMemo(
    () => ({
      datasets: [
        {
          data: sorted.map((point) => ({ x: point.step, y: point.value })),
          borderColor: colors.accent,
          backgroundColor: colors.accentFill,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHitRadius: 10,
          tension: 0.25,
          fill: 'start',
          spanGaps: true,
        },
      ],
    }),
    [colors, sorted]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items: TooltipItem<'line'>[]) => (items.length ? `Step ${items[0].parsed.x}` : ''),
            label: (context: TooltipItem<'line'>) => formatAxisValue(context.parsed.y, yLabel),
          },
        },
      },
      scales: {
        x: {
          type: 'linear' as const,
          title: { display: true, text: xLabel, color: colors.dim, font: { size: 10 } },
          grid: { color: colors.border },
          border: { color: colors.borderStrong },
          ticks: {
            color: colors.dim,
            maxTicksLimit: 6,
            stepSize: xTickInterval > 0 ? xTickInterval : undefined,
            callback: (value: string | number) =>
              Number.isFinite(Number(value)) ? `${Math.round(Number(value))}` : '',
          },
        },
        y: {
          title: { display: true, text: yLabel, color: colors.dim, font: { size: 10 } },
          grid: { color: colors.border },
          border: { color: colors.borderStrong },
          ticks: {
            color: colors.dim,
            maxTicksLimit: 5,
            callback: (value: string | number) => formatAxisValue(Number(value), yLabel),
          },
        },
      },
    }),
    [colors, xLabel, xTickInterval, yLabel]
  );

  if (!sorted.length) {
    return (
      <div className="series-chart empty">
        <div className="muted">No history yet - run the simulation to build a trend.</div>
      </div>
    );
  }

  return (
    <div className="series-chart">
      <div className="series-canvas">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
};

export default TimeSeriesChart;
