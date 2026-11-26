import type { SimPlayer } from "../shared/types";

interface StrategyChartProps {
  players: SimPlayer[];
}

export function StrategyChart({ players }: StrategyChartProps) {
  const width = 320;
  const height = 220;
  const padL = 36;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxPoints = Math.max(1, ...players.map((p) => p.points));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="strategy-chart"
      role="img"
      aria-label="Strategy Space: Aggression vs Damage"
    >
      {/* Grid */}
      {[0, 0.5, 1].map((t) => {
        const x = padL + t * plotW;
        const y = padT + (1 - t) * plotH;
        return (
          <g key={t}>
            <line
              x1={x}
              y1={padT}
              x2={x}
              y2={padT + plotH}
              stroke="#1e293b"
              strokeWidth="1"
            />
            <line
              x1={padL}
              y1={y}
              x2={padL + plotW}
              y2={y}
              stroke="#1e293b"
              strokeWidth="1"
            />
          </g>
        );
      })}

      {/* Axes */}
      <line
        x1={padL}
        y1={padT + plotH}
        x2={padL + plotW}
        y2={padT + plotH}
        stroke="#475569"
      />
      <line
        x1={padL}
        y1={padT}
        x2={padL}
        y2={padT + plotH}
        stroke="#475569"
      />

      {/* Axis labels */}
      <text
        x={padL + plotW / 2}
        y={height - 6}
        textAnchor="middle"
        fill="#94a3b8"
        fontSize="10"
      >
        Aggression (Defensive → Aggressive)
      </text>
      <text
        x={12}
        y={padT + plotH / 2}
        textAnchor="middle"
        fill="#94a3b8"
        fontSize="10"
        transform={`rotate(-90 12 ${padT + plotH / 2})`}
      >
        Damage vs Defense
      </text>

      {/* Player bubbles */}
      {players.map((p) => {
        const cx = padL + p.strategy.aggression * plotW;
        const cy = padT + (1 - p.strategy.damageRatio) * plotH;
        const r = 4 + (p.points / maxPoints) * 8;
        return (
          <g key={p.id}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={p.color}
              fillOpacity={p.alive ? 0.85 : 0.35}
              stroke={p.alive ? "#f8fafc" : "#64748b"}
              strokeWidth="1"
            >
              <title>
                {`${p.name}: ${p.points.toFixed(1)} pts | Aggr ${Math.round(
                  p.strategy.aggression * 100
                )}% | Dmg ${Math.round(p.strategy.damageRatio * 100)}%`}
              </title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}
