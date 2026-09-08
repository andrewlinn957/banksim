import { GiltCurveYields } from '../domain/market';

interface Props {
  yields: GiltCurveYields;
}

type CurvePoint = {
  maturity: number;
  label: string;
  yield: number;
};

const WIDTH = 900;
const HEIGHT = 220;
const MARGIN = { top: 22, right: 24, bottom: 38, left: 58 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

const formatYield = (value: number): string => `${(value * 100).toFixed(2)}%`;

const GiltCurveChart = ({ yields }: Props) => {
  const points: CurvePoint[] = [
    { maturity: 1, label: '1Y', yield: yields.y1 },
    { maturity: 2, label: '2Y', yield: yields.y2 },
    { maturity: 3, label: '3Y', yield: yields.y3 },
    { maturity: 5, label: '5Y', yield: yields.y5 },
    { maturity: 10, label: '10Y', yield: yields.y10 },
    { maturity: 20, label: '20Y', yield: yields.y20 },
    { maturity: 30, label: '30Y', yield: yields.y30 },
  ];

  const values = points.map((point) => point.yield);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const range = Math.max(rawMax - rawMin, 0.002);
  const padding = Math.max(0.0015, range * 0.22);
  const yMin = Math.max(0, rawMin - padding);
  const yMax = rawMax + padding;

  const x = (maturity: number): number =>
    MARGIN.left + ((maturity - 1) / 29) * PLOT_WIDTH;
  const y = (value: number): number =>
    MARGIN.top + ((yMax - value) / Math.max(yMax - yMin, 0.0001)) * PLOT_HEIGHT;

  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.maturity).toFixed(1)} ${y(point.yield).toFixed(1)}`)
    .join(' ');
  const areaPath = `${path} L ${x(30).toFixed(1)} ${(MARGIN.top + PLOT_HEIGHT).toFixed(1)} L ${x(1).toFixed(1)} ${(MARGIN.top + PLOT_HEIGHT).toFixed(1)} Z`;

  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + ((yMax - yMin) * index) / 4).reverse();

  return (
    <div className="gilt-curve-chart">
      <div className="gilt-curve-chart-key" aria-hidden="true">
        <span className="gilt-curve-key-line" />
        <span>Current gilt curve</span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Current gilt yield curve line chart"
        preserveAspectRatio="xMidYMid meet"
      >
        <title>Current gilt yield curve</title>
        <desc>UK gilt yields from one to thirty years, with maturity spaced proportionally on the horizontal axis.</desc>

        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              className="gilt-curve-gridline"
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className="gilt-curve-y-label" x={MARGIN.left - 10} y={y(tick) + 4} textAnchor="end">
              {formatYield(tick)}
            </text>
          </g>
        ))}

        <line
          className="gilt-curve-axis"
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={MARGIN.top + PLOT_HEIGHT}
          y2={MARGIN.top + PLOT_HEIGHT}
        />

        <path className="gilt-curve-area" d={areaPath} />
        <path className="gilt-curve-line" d={path} />

        {points.map((point) => (
          <g key={point.label}>
            <circle className="gilt-curve-point" cx={x(point.maturity)} cy={y(point.yield)} r="4">
              <title>{`${point.label}: ${formatYield(point.yield)}`}</title>
            </circle>
            <text
              className="gilt-curve-x-label"
              x={x(point.maturity)}
              y={MARGIN.top + PLOT_HEIGHT + 22}
              textAnchor="middle"
            >
              {point.label}
            </text>
          </g>
        ))}

        <text className="gilt-curve-axis-title" x={WIDTH / 2} y={HEIGHT - 4} textAnchor="middle">
          Maturity
        </text>
      </svg>
    </div>
  );
};

export default GiltCurveChart;
