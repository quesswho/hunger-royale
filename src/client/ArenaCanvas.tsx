import { useEffect, useRef, useState } from "react";
import type { MatchState, SimConfig } from "../shared/types";

interface ArenaCanvasProps {
  match: MatchState;
  config: SimConfig;
  size?: number;
}

export function ArenaCanvas({ match, config, size = 480 }: ArenaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [autoZoom, setAutoZoom] = useState(false);
  const [manualZoom, setManualZoom] = useState(1);

  const effectiveZoom = autoZoom
    ? Math.min(4.5, config.initialMapRadius / Math.max(10, match.mapRadius))
    : manualZoom;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = size / 2;
    const cy = size / 2;
    const maxPxRadius = size * 0.44;
    const worldToPx = (maxPxRadius / config.initialMapRadius) * effectiveZoom;
    const currentPxRadius = match.mapRadius * worldToPx;

    // Clear background
    ctx.fillStyle = "#080d1a";
    ctx.fillRect(0, 0, size, size);

    // Draw initial map boundary (dashed reference ring)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, config.initialMapRadius * worldToPx, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.2)";
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Smooth radial payoff gradient inside R(t)
    const grad = ctx.createRadialGradient(
      cx,
      cy,
      0,
      cx,
      cy,
      Math.max(1, currentPxRadius)
    );
    grad.addColorStop(0, "rgba(225, 29, 72, 0.34)");
    grad.addColorStop(0.5, "rgba(217, 119, 6, 0.22)");
    grad.addColorStop(1, "rgba(30, 58, 138, 0.22)");

    ctx.beginPath();
    ctx.arc(cx, cy, currentPxRadius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(96, 165, 250, 0.7)";
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Contour rings at 33% and 66% of R(t)
    const contours = [
      {
        frac: 0.33,
        stroke: "rgba(251, 113, 133, 0.45)",
        labelColor: "rgba(253, 164, 175, 0.9)",
      },
      {
        frac: 0.66,
        stroke: "rgba(251, 191, 36, 0.35)",
        labelColor: "rgba(253, 224, 71, 0.85)",
      },
    ];
    for (const c of contours) {
      const rPx = currentPxRadius * c.frac;
      if (rPx < 14) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();

      const mult = (1 + config.zoneGradient * (1 - c.frac)).toFixed(2);
      ctx.fillStyle = c.labelColor;
      ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${mult}x`, cx, cy - rPx + 12);
    }

    if (currentPxRadius > 30) {
      ctx.fillStyle = "rgba(147, 197, 253, 0.85)";
      ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("1.00x", cx, cy - currentPxRadius + 13);

      ctx.fillStyle = "rgba(253, 164, 175, 0.95)";
      ctx.fillText(`${(1 + config.zoneGradient).toFixed(2)}x`, cx, cy + 4);
    }

    // Movement trails & flee indicators
    for (const p of match.players) {
      if (!p.alive && p.eliminatedRound !== match.round) continue;
      const x1 = cx + p.prevX * worldToPx;
      const y1 = cy + p.prevY * worldToPx;
      const x2 = cx + p.x * worldToPx;
      const y2 = cy + p.y * worldToPx;
      if (Math.hypot(x2 - x1, y2 - y1) > 1.5) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle =
          p.lastAction === "flee"
            ? "rgba(56, 189, 248, 0.75)"
            : "rgba(148, 163, 184, 0.35)";
        ctx.lineWidth = p.lastAction === "flee" ? 2 : 1.25;
        ctx.setLineDash(p.lastAction === "flee" ? [4, 3] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Combat attack lines
    for (const line of match.combatLines) {
      const x1 = cx + line.fromX * worldToPx;
      const y1 = cy + line.fromY * worldToPx;
      const x2 = cx + line.toX * worldToPx;
      const y2 = cy + line.toY * worldToPx;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = line.eliminated ? "#fb7185" : "#f97316";
      ctx.lineWidth = line.eliminated ? 3 : 2;
      ctx.stroke();
    }

    // Eliminated players (faded X)
    for (const p of match.players) {
      if (p.alive) continue;
      const px = cx + p.x * worldToPx;
      const py = cy + p.y * worldToPx;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - 4, py - 4);
      ctx.lineTo(px + 4, py + 4);
      ctx.moveTo(px + 4, py - 4);
      ctx.lineTo(px - 4, py + 4);
      ctx.stroke();
    }

    // Alive players
    for (const p of match.players) {
      if (!p.alive) continue;
      const px = cx + p.x * worldToPx;
      const py = cy + p.y * worldToPx;

      if (p.lastAction === "fight") {
        ctx.beginPath();
        ctx.arc(px, py, config.fightRadius * worldToPx * 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(249, 115, 22, 0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.strokeStyle = "#0b1120";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Normalized HP bar [0, 1]
      const barW = 26;
      const barH = 4;
      const hpPct = Math.max(0, Math.min(1, p.hp));
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(px - barW / 2, py - 15, barW, barH);
      ctx.fillStyle =
        hpPct > 0.5 ? "#4ade80" : hpPct > 0.25 ? "#facc15" : "#f43f5e";
      ctx.fillRect(px - barW / 2, py - 15, barW * hpPct, barH);

      ctx.fillStyle = "#f8fafc";
      ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(p.name.slice(0, 12), px, py + 18);
    }

    // HUD overlay
    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(
      `Round ${match.round} · Radius ${match.mapRadius.toFixed(0)} · Zoom ${effectiveZoom.toFixed(1)}x`,
      12,
      20
    );
  }, [match, config, size, effectiveZoom]);

  return (
    <div style={{ width: "100%", maxWidth: size }}>
      <div
        className="actions wrap"
        style={{ justifyContent: "flex-end", marginBottom: "8px" }}
      >
        <button
          type="button"
          className={autoZoom ? "primary small-btn" : "small-btn"}
          onClick={() => setAutoZoom((v) => !v)}
        >
          {autoZoom ? "Auto-Zoom: ON" : "Auto-Zoom"}
        </button>
        <button
          type="button"
          className="small-btn"
          onClick={() => {
            setAutoZoom(false);
            setManualZoom((z) => Math.max(1, Number((z - 0.5).toFixed(1))));
          }}
        >
          −
        </button>
        <button
          type="button"
          className="small-btn"
          onClick={() => {
            setAutoZoom(false);
            setManualZoom(1);
          }}
        >
          {effectiveZoom.toFixed(1)}x
        </button>
        <button
          type="button"
          className="small-btn"
          onClick={() => {
            setAutoZoom(false);
            setManualZoom((z) => Math.min(4.5, Number((z + 0.5).toFixed(1))));
          }}
        >
          +
        </button>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          maxWidth: size,
          height: "auto",
          aspectRatio: "1 / 1",
        }}
        className="arena-canvas"
      />
    </div>
  );
}
