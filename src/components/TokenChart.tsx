import { useRef } from 'react';
import { Bar, BarChart, LabelList, Rectangle, ResponsiveContainer, XAxis, YAxis } from 'recharts';

import { useElementWidth } from '../lib/hooks';
import { GRID, INK_2, INK_3, SURFACE } from '../lib/palette';

export interface ChartRow {
  key: string;
  /** Token text without its leading space, or "Other" for the aggregate row. */
  label: string;
  /** Eased value that drives the bar geometry. */
  value: number;
  /** Exact current value, shown as text and read by assistive technology. */
  displayValue: number;
  /** This row's probability at alpha = 0. */
  neutral: number;
  color: string;
  muted: boolean;
}

const ROW_HEIGHT = 34;
const BAR_SIZE = 18;
const Y_AXIS_WIDTH = 96;
const Y_AXIS_WIDTH_COMPACT = 74;
const MARGIN = { top: 6, right: 54, bottom: 4, left: 0 };
const MARGIN_COMPACT = { top: 6, right: 44, bottom: 4, left: 0 };
/** Below this container width the label gutter is trimmed to keep the plot area usable. */
const COMPACT_WIDTH = 430;
const X_AXIS_HEIGHT = 22;

interface RowShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: ChartRow;
  /** Geometry of the full 0-100% track; Recharts supplies it because `background` is set. */
  background?: { x: number; y: number; width: number; height: number };
  /** Fallback track width, computed from the measured container. */
  plotWidth?: number;
}

/**
 * One row: the probability bar plus a thin marker at that row's neutral (alpha = 0) value.
 *
 * The marker needs the pixel position of a percentage, which is the bar's own scale. Recharts
 * hands the full track geometry in `background`; the measured `plotWidth` is a fallback so the
 * marker never depends on an undocumented prop being present.
 */
function RowShape({ x = 0, y = 0, width = 0, height = 0, payload, background, plotWidth = 0 }: RowShapeProps) {
  if (!payload) return null;

  const trackX = background?.x ?? x;
  const trackWidth = background?.width ?? plotWidth;
  const neutralX = trackX + (Math.min(100, Math.max(0, payload.neutral)) / 100) * trackWidth;

  return (
    <g>
      {width > 0 && (
        <Rectangle
          x={x}
          y={y}
          width={width}
          height={height}
          radius={[0, 4, 4, 0]}
          fill={payload.color}
        />
      )}
      {/* A 2px marker inside a surface-coloured ring, so it stays legible over bar or track. */}
      <rect x={neutralX - 2} y={y - 4} width={4} height={height + 8} rx={2} fill={SURFACE} />
      <rect x={neutralX - 1} y={y - 3} width={2} height={height + 6} rx={1} fill={INK_2} opacity={0.85} />
    </g>
  );
}

/** Longest token that fits the label gutter at 13px monospace before it would be clipped. */
const MAX_LABEL_CHARS = 11;

function TokenTick({ x = 0, y = 0, payload, rows }: { x?: number; y?: number; payload?: { value?: string }; rows: ChartRow[] }) {
  const row = rows.find((r) => r.label === payload?.value);
  const full = payload?.value ?? '';
  // A visitor's own prompt can produce a long token. Truncating keeps the axis aligned; the exact
  // token is still available in full from the accessible table below the chart.
  const shown = full.length > MAX_LABEL_CHARS ? `${full.slice(0, MAX_LABEL_CHARS - 1)}\u2026` : full;
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fontSize={row?.muted ? 12 : 13}
      fontFamily={row?.muted ? 'var(--font-sans)' : 'var(--font-mono)'}
      fill={row?.muted ? INK_3 : INK_2}
    >
      <title>{full}</title>
      {shown}
    </text>
  );
}

export interface TokenChartProps {
  rows: ChartRow[];
  /** Used for the chart's accessible summary and the table caption. */
  summary: string;
  alphaLabel: string;
}

export function TokenChart({ rows, summary, alphaLabel }: TokenChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerWidth = useElementWidth(wrapperRef);
  const compact = containerWidth > 0 && containerWidth < COMPACT_WIDTH;
  const yAxisWidth = compact ? Y_AXIS_WIDTH_COMPACT : Y_AXIS_WIDTH;
  const margin = compact ? MARGIN_COMPACT : MARGIN;
  const plotWidth = Math.max(0, containerWidth - yAxisWidth - margin.left - margin.right);
  const height = rows.length * ROW_HEIGHT + margin.top + margin.bottom + X_AXIS_HEIGHT;

  return (
    <div>
      {/*
        The SVG is presentational: `role="img"` with a summary keeps assistive technology out of
        the chart internals, and the table below carries the exact values as text.
      */}
      <div ref={wrapperRef} role="img" aria-label={summary} style={{ width: '100%' }}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={rows}
            layout="vertical"
            margin={margin}
            barSize={BAR_SIZE}
            accessibilityLayer={false}
          >
            <XAxis
              type="number"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(value: number) => `${value}%`}
              height={X_AXIS_HEIGHT}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tick={{ fill: INK_3, fontSize: 11 }}
              interval={0}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={yAxisWidth}
              tickLine={false}
              axisLine={false}
              tick={<TokenTick rows={rows} />}
              interval={0}
            />
            <Bar
              dataKey="value"
              isAnimationActive={false}
              background={{ fill: '#21211f', radius: 3 }}
              shape={<RowShape plotWidth={plotWidth} />}
            >
              {/*
                The label shows the exact target value even while the bar is still easing, so
                the number never lags the state it describes.
              */}
              <LabelList
                dataKey="displayValue"
                position="right"
                offset={8}
                formatter={(value: unknown) => `${value}%`}
                fill={INK_2}
                fontSize={12}
                stroke={SURFACE}
                strokeWidth={3}
                paintOrder="stroke"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/*
        The wrapper, not the table, carries `sr-only`: a table's used width is at least its
        min-content width, so a 1px table still occupies ~1200px and scrolls the page sideways.
        Clipping from outside keeps it available to assistive technology and out of the layout.
      */}
      <div className="sr-only">
        <table>
          <caption>{summary}</caption>
          <thead>
            <tr>
              <th scope="col">Candidate</th>
              <th scope="col">Probability at {alphaLabel}</th>
              <th scope="col">Probability at the neutral reference, alpha 0.0</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.muted ? 'Other, aggregated remaining probability' : row.label}</th>
                <td>{row.displayValue}%</td>
                <td>{row.neutral}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
