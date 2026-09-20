import { INK_3, SURFACE } from '../lib/palette';

export interface SchematicSpaceProps {
  /** Eased alpha, so the steered point glides rather than jumping. */
  alpha: number;
  /** Exact alpha, used for the text that must never lag the state. */
  targetAlpha: number;
  /** Colour of the currently selected token, tying the schematic to the chart. */
  color: string;
  negativeLabel: string;
  positiveLabel: string;
}

// The direction line, in viewBox units. The steered point travels from one end to the other as
// alpha runs from -2 to +2; the origin sits at the midpoint.
const ORIGIN = { x: 180, y: 68 };
const REACH = { x: 124, y: -28 };
const ANGLE = (Math.atan2(REACH.y, REACH.x) * 180) / Math.PI;
// The drawn direction runs past the travel range, so at alpha +-2 the steered point sits on the
// line rather than on top of the arrowhead and its label.
const LINE_EXTENT = 1.2;
const LINE_END = { x: ORIGIN.x + REACH.x * LINE_EXTENT, y: ORIGIN.y + REACH.y * LINE_EXTENT };

export function SchematicSpace({
  alpha,
  targetAlpha,
  color,
  negativeLabel,
  positiveLabel,
}: SchematicSpaceProps) {
  const t = alpha / 2;
  const steered = { x: ORIGIN.x + t * REACH.x, y: ORIGIN.y + t * REACH.y };
  const atOrigin = Math.abs(alpha) < 0.001;
  // Negative alpha reverses the arrow; the arrowhead is drawn by hand so it can take the
  // token colour without a per-colour <marker> definition.
  const headAngle = alpha < 0 ? ANGLE + 180 : ANGLE;

  const description = atOrigin
    ? 'At alpha 0.0 the steered representation sits exactly on the original and no arrow is drawn.'
    : `At alpha ${targetAlpha < 0 ? 'minus ' : 'plus '}${Math.abs(targetAlpha).toFixed(1)}, an arrow runs from the original representation ${
        targetAlpha < 0 ? `toward ${negativeLabel}` : `toward ${positiveLabel}`
      }, and the steered representation sits at its tip.`;

  return (
    <figure className="m-0">
      <svg
        viewBox="0 0 360 128"
        role="img"
        aria-label={`Schematic representation space. ${description}`}
        style={{ display: 'block', width: '100%', height: 'auto', maxWidth: '100%' }}
      >
        <defs>
          <pattern id="steering-dot-grid" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1" fill="#2c2c28" />
          </pattern>
        </defs>

        <rect x="0.5" y="0.5" width="359" height="127" rx="10" fill="url(#steering-dot-grid)" stroke="#2a2a27" />

        {/* The steering direction v: a line through the origin, not a measured axis. */}
        <line
          x1={ORIGIN.x - REACH.x * LINE_EXTENT}
          y1={ORIGIN.y - REACH.y * LINE_EXTENT}
          x2={LINE_END.x}
          y2={LINE_END.y}
          stroke="#474741"
          strokeWidth="1.5"
          strokeDasharray="4 5"
        />
        <g transform={`translate(${LINE_END.x} ${LINE_END.y}) rotate(${ANGLE})`}>
          <polygon points="0,0 -7,-3.5 -7,3.5" fill="#474741" />
        </g>
        <text x={LINE_END.x - 2} y={LINE_END.y + 17} fontSize="13" fontStyle="italic" fontFamily="var(--font-mono)" fill={INK_3} textAnchor="middle">
          v
        </text>

        {/* The signed steering step, alpha times v. */}
        {!atOrigin && (
          <>
            <line
              x1={ORIGIN.x}
              y1={ORIGIN.y}
              x2={steered.x}
              y2={steered.y}
              stroke={color}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <g transform={`translate(${steered.x} ${steered.y}) rotate(${headAngle})`}>
              <polygon points="0,0 -9,-4.5 -9,4.5" fill={color} />
            </g>
          </>
        )}

        {/* Original representation h: fixed. */}
        <circle cx={ORIGIN.x} cy={ORIGIN.y} r="6" fill={SURFACE} />
        <circle cx={ORIGIN.x} cy={ORIGIN.y} r="4" fill={INK_3} />
        <text x={ORIGIN.x} y={ORIGIN.y + 22} fontSize="13" fontStyle="italic" fontFamily="var(--font-mono)" fill={INK_3} textAnchor="middle">
          h
        </text>

        {/* Steered representation h-prime: moves, and coincides with h at alpha 0. */}
        <circle cx={steered.x} cy={steered.y} r="7" fill={SURFACE} />
        <circle cx={steered.x} cy={steered.y} r="5" fill={color} />
        <text
          x={Math.min(344, Math.max(16, steered.x))}
          y={steered.y - 14}
          fontSize="13"
          fontStyle="italic"
          fontFamily="var(--font-mono)"
          fill="#f2f1ec"
          textAnchor="middle"
        >
          h&#8242;
        </text>
      </svg>
      <figcaption className="mt-2 text-[12px] leading-snug text-[var(--color-ink-3)]">
        Schematic representation space &mdash; a drawing of the idea, not a measured embedding
        projection.
      </figcaption>
    </figure>
  );
}
