import { motion, MotionValue } from "framer-motion";

type RaceCarProps = {
  color: string;
  driverCode: string;
  label?: string;
  x: number | MotionValue<number>;
  y: number | MotionValue<number>;
  accent?: "up" | "down" | false;
  muted?: boolean;
  /** True when another driver is focused and this car is drawn back. */
  dimmed?: boolean;
  caution?: boolean;
};

const CAR_WIDTH = 46;
const CAR_HEIGHT = 18;
/** Space between the car's dot on its line and the badge's left edge. */
const BADGE_GAP = 6;

export function RaceCar({
  color,
  driverCode,
  label,
  x,
  y,
  accent = false,
  muted = false,
  dimmed = false,
  caution = false,
}: RaceCarProps) {
  return (
    <motion.g
      // The handle the replay e2e uses to find a car and read whether it is
      // drawn back. Named state rather than a computed style: the dim has been
      // an `opacity` attribute, a Tailwind class and a motion value at
      // different points, and a test that reads the styling breaks on a
      // refactor that changes nothing a user can see.
      data-testid="race-car"
      data-dimmed={dimmed ? "true" : "false"}
      className="group"
      style={{
        x,
        y,
        opacity: muted ? 0.45 : 1,
      }}
    >
      {/* Drawn beside the car's position, not on it: `x`/`y` are the head
          of the line, and centring the badge there covered the line's last
          laps along with everyone else's. */}
      <g transform={`translate(${BADGE_GAP + CAR_WIDTH / 2} 0)`}>
      {/* Glow shadow behind badge on hover or caution */}
      <rect
        x={-CAR_WIDTH / 2}
        y={-CAR_HEIGHT / 2}
        width={CAR_WIDTH}
        height={CAR_HEIGHT}
        rx="5"
        fill="none"
        stroke={
          caution
            ? "rgba(234,179,8,0.4)"
            : accent === "up"
              ? "rgba(34,197,94,0.3)" // green-500
              : accent === "down"
                ? "rgba(225,6,0,0.3)" // F1 red
                : "rgba(255,255,255,0.05)"
        }
        strokeWidth="4"
        className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
      />

      {/* Main Telemetry Badge Capsule */}
      <rect
        x={-CAR_WIDTH / 2}
        y={-CAR_HEIGHT / 2}
        width={CAR_WIDTH}
        height={CAR_HEIGHT}
        rx="5"
        fill="var(--track)"
        stroke={
          caution
            ? "var(--flag-yellow)"
            : accent === "up"
              ? "var(--flag-green)"
              : accent === "down"
                ? "var(--flag-red)"
                : "rgba(255,255,255,0.12)"
        }
        strokeWidth={caution || accent ? "1.5" : "1"}
        className="transition-all duration-200"
      />

      {/* Livery Indicator Block (thick strip on the left edge) */}
      <path
        d={`M ${-CAR_WIDTH / 2} ${-CAR_HEIGHT / 2 + 1} 
            L ${-CAR_WIDTH / 2 + 4} ${-CAR_HEIGHT / 2 + 1} 
            L ${-CAR_WIDTH / 2 + 4} ${CAR_HEIGHT / 2 - 1} 
            L ${-CAR_WIDTH / 2} ${CAR_HEIGHT / 2 - 1} Z`}
        fill={color}
      />

      {/* Tiny forward chevron pointing right (signaling direction of travel) */}
      <path
        d={`M ${CAR_WIDTH / 2 - 6} -3 L ${CAR_WIDTH / 2 - 3} 0 L ${CAR_WIDTH / 2 - 6} 3`}
        fill="none"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Driver Code Text */}
      <text
        x="2"
        y="3"
        textAnchor="middle"
        fontSize="9"
        fontWeight="800"
        fill="#f8fafc"
        style={{ letterSpacing: "0.08em", fontFamily: "var(--font-numeric), monospace" }}
      >
        {driverCode}
      </text>

      {/* Optional Full Driver Name Label on hover */}
      {label ? (
        <g className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
          <rect
            x={CAR_WIDTH / 2 + 8}
            y={-CAR_HEIGHT / 2}
            width={72}
            height={CAR_HEIGHT}
            rx="4"
            fill="var(--track)"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="1"
          />
          <text
            x={CAR_WIDTH / 2 + 14}
            y="3"
            fontSize="8"
            fontWeight="700"
            fill="#f8fafc"
          >
            {label.split(" ").pop() || label}
          </text>
        </g>
      ) : null}
      </g>
    </motion.g>
  );
}
