import { useEffect, useRef } from "react";
import type { MatchState, SimConfig } from "../shared/types";

interface ArenaCanvasProps {
  match: MatchState;
  config: SimConfig;
  size?: number;
}

export function ArenaCanvas({ match, config, size = 480 }: ArenaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
    const worldToPx = maxPxRadius / config.initialMapRadius;

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

    // Draw shrinking circular zones (outer -> middle -> inner)
    const zoneStyles: Record<
      string,
      { fill: string; stroke: string; labelColor: string }
    > = {
      outer: {
        fill: "rgba(30, 58, 138, 0.25)",
        stroke: "rgba(96, 165, 250, 0.55)",
        labelColor: "rgba(147, 197, 253, 0.85)",
      },
      middle: {
        fill: "rgba(180, 83, 9, 0.24)",
        stroke: "rgba(251, 191, 36, 0.55)",
        labelColor: "rgba(253, 224, 71, 0.9)",
      },
      inner: {
        fill: "rgba(190, 18, 60, 0.28)",
        stroke: "rgba(251, 113, 133, 0.7)",
        labelColor: "rgba(253, 164, 175, 0.95)",
      },
    };

    const zonesDesc = [...config.zones].reverse();
    for (const z of zonesDesc) {
      const rPx = match.mapRadius * z.maxRadiusFraction * worldToPx;
      const style = zoneStyles[z.id];
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.fillStyle = style.fill;
      ctx.fill();
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = z.id === "outer" ? 2.2 : 1.3;
      ctx.stroke();

      // Zone multiplier label at top of ring
      if (rPx > 20) {
        ctx.fillStyle = style.labelColor;
        ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${z.payoffMultiplier}x`, cx, cy - rPx + 14);
      }
    }

    // Draw movement trails & flee indicators
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
            ? "rgba(56, 189, 248, 0.7)"
            : "rgba(148, 163, 184, 0.35)";
        ctx.lineWidth = p.lastAction === "flee" ? 2 : 1.25;
        ctx.setLineDash(p.lastAction === "flee" ? [4, 3] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Draw combat attack lines
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

    // Draw eliminated players (faded X)
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

    // Draw alive players
    for (const p of match.players) {
      if (!p.alive) continue;
      const px = cx + p.x * worldToPx;
      const py = cy + p.y * worldToPx;

      // Subtle fight radius halo for fighting players
      if (p.lastAction === "fight") {
        ctx.beginPath();
        ctx.arc(px, py, config.fightRadius * worldToPx * 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(249, 115, 22, 0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Player dot
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.strokeStyle = "#0b1120";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Mini health bar above dot
      const barW = 26;
      const barH = 4;
      const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp));
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(px - barW / 2, py - 15, barW, barH);
      ctx.fillStyle =
        hpPct > 0.5 ? "#4ade80" : hpPct > 0.25 ? "#facc15" : "#f43f5e";
      ctx.fillRect(px - barW / 2, py - 15, barW * hpPct, barH);

      // Name label
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
      `Round ${match.round}/${config.maxRounds} · Radius ${match.mapRadius.toFixed(0)}`,
      12,
      20
    );
  }, [match, config, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", maxWidth: size, height: "auto", aspectRatio: "1 / 1" }}
      className="arena-canvas"
    />
  );
}
