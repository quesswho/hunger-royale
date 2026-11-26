import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import type {
  ClientMessage,
  LobbyPlayer,
  MatchState,
  ServerMessage,
  TournamentPhase,
  TournamentState,
} from "../shared/types.js";
import {
  clamp01,
  createInitialMatch,
  DEFAULT_CONFIG,
  stepRound,
} from "../shared/simulation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS ?? 200);
const HOST_PIN =
  process.env.HOST_PIN?.trim() || String(crypto.randomInt(100000, 999999));

const PALETTE = [
  "#f97316",
  "#38bdf8",
  "#a78bfa",
  "#4ade80",
  "#f43f5e",
  "#facc15",
  "#2dd4bf",
  "#fb7185",
  "#60a5fa",
  "#c084fc",
  "#34d399",
  "#fbbf24",
];

const BOT_ARCHETYPES: Array<{
  name: string;
  aggression: number;
  damageRatio: number;
}> = [
  { name: "Berserker", aggression: 0.95, damageRatio: 0.9 },
  { name: "Turtle", aggression: 0.1, damageRatio: 0.15 },
  { name: "Glass Cannon", aggression: 0.85, damageRatio: 0.98 },
  { name: "Pacifist", aggression: 0.05, damageRatio: 0.35 },
  { name: "Balanced", aggression: 0.5, damageRatio: 0.5 },
  { name: "Bruiser", aggression: 0.75, damageRatio: 0.4 },
  { name: "Skirmisher", aggression: 0.35, damageRatio: 0.75 },
  { name: "Vanguard", aggression: 0.65, damageRatio: 0.25 },
];

let colorCursor = 0;
function nextColor(): string {
  const color = PALETTE[colorCursor % PALETTE.length];
  colorCursor += 1;
  return color;
}

function verifyPin(candidate: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(HOST_PIN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    phase,
    players: lobbyPlayers.size,
    lobbyLocked,
  });
});

const clientDistPath = path.resolve(process.cwd(), "dist/client");
app.use(express.static(clientDistPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const lobbyPlayers = new Map<string, LobbyPlayer>();
const playerSockets = new Map<string, WebSocket>();
const config = { ...DEFAULT_CONFIG };
let phase: TournamentPhase = "lobby";
let lobbyLocked = false;
let match: MatchState | null = null;
let tickTimer: NodeJS.Timeout | null = null;
let botCounter = 0;

function stopTimer() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function getState(): TournamentState {
  return {
    phase,
    lobbyLocked,
    config,
    lobbyPlayers: Array.from(lobbyPlayers.values()),
    match,
  };
}

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(message: ServerMessage) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function broadcastState() {
  broadcast({ type: "state", state: getState() });
}

function advanceOneRound() {
  if (!match) return;
  match = stepRound(match, config);
  if (match.finished) {
    stopTimer();
    phase = "results";
  }
  broadcastState();
}

function startTickLoop() {
  stopTimer();
  tickTimer = setInterval(() => {
    if (phase !== "running" || !match) {
      stopTimer();
      return;
    }
    advanceOneRound();
  }, config.roundIntervalMs);
}

wss.on("connection", (ws) => {
  const playerId = crypto.randomUUID().slice(0, 8);
  let isHost = false;
  let windowStart = Date.now();
  let messagesInWindow = 0;

  send(ws, {
    type: "welcome",
    playerId,
    state: getState(),
  });

  ws.on("message", (raw) => {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      messagesInWindow = 0;
    }
    messagesInWindow += 1;
    if (messagesInWindow > 30) return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return;
    }

    if (msg.type === "host_auth") {
      const ok = typeof msg.pin === "string" && verifyPin(msg.pin.trim());
      if (ok) {
        isHost = true;
        send(ws, { type: "host_auth_result", ok: true });
      } else {
        send(ws, {
          type: "host_auth_result",
          ok: false,
          error: "Invalid host PIN.",
        });
      }
      return;
    }

    if (msg.type === "join") {
      if (lobbyLocked && !lobbyPlayers.has(playerId)) {
        send(ws, {
          type: "error",
          message: "The lobby is locked by the host.",
        });
        return;
      }
      if (!lobbyPlayers.has(playerId) && lobbyPlayers.size >= MAX_PLAYERS) {
        send(ws, { type: "error", message: "Tournament lobby is full." });
        return;
      }
      const name =
        String(msg.name ?? "").trim().slice(0, 24) ||
        `Player ${lobbyPlayers.size + 1}`;
      lobbyPlayers.set(playerId, {
        id: playerId,
        name,
        strategy: { aggression: 0.5, damageRatio: 0.5 },
        ready: false,
        isBot: false,
        color: nextColor(),
      });
      playerSockets.set(playerId, ws);
      broadcastState();
      return;
    }

    if (msg.type === "update_strategy") {
      const existing = lobbyPlayers.get(playerId);
      if (!existing) return;
      existing.strategy = {
        aggression: clamp01(Number(msg.strategy.aggression)),
        damageRatio: clamp01(Number(msg.strategy.damageRatio)),
      };
      if (typeof msg.ready === "boolean") {
        existing.ready = msg.ready;
      }
      broadcastState();
      return;
    }

    // Host-only commands
    if (
      msg.type === "host_start" ||
      msg.type === "host_pause" ||
      msg.type === "host_resume" ||
      msg.type === "host_step" ||
      msg.type === "host_reset" ||
      msg.type === "host_toggle_lock" ||
      msg.type === "host_kick" ||
      msg.type === "host_add_bots" ||
      msg.type === "host_clear_bots"
    ) {
      if (!isHost) {
        send(ws, { type: "error", message: "Host authentication required." });
        return;
      }

      if (msg.type === "host_start") {
        const roster = Array.from(lobbyPlayers.values());
        if (roster.length < 2) {
          send(ws, {
            type: "error",
            message: "Need at least 2 players (or bots) to start.",
          });
          return;
        }
        match = createInitialMatch(roster, config);
        phase = "running";
        broadcastState();
        startTickLoop();
      } else if (msg.type === "host_pause") {
        if (phase === "running") {
          stopTimer();
          phase = "paused";
          broadcastState();
        }
      } else if (msg.type === "host_resume") {
        if (phase === "paused" && match && !match.finished) {
          phase = "running";
          broadcastState();
          startTickLoop();
        }
      } else if (msg.type === "host_step") {
        if (!match) {
          const roster = Array.from(lobbyPlayers.values());
          if (roster.length < 2) {
            send(ws, {
              type: "error",
              message: "Need at least 2 players (or bots) to step.",
            });
            return;
          }
          match = createInitialMatch(roster, config);
          phase = "paused";
        }
        if (phase === "running") {
          stopTimer();
          phase = "paused";
        }
        advanceOneRound();
      } else if (msg.type === "host_reset") {
        stopTimer();
        match = null;
        phase = "lobby";
        lobbyLocked = false;
        for (const p of lobbyPlayers.values()) {
          if (!p.isBot) p.ready = false;
        }
        broadcastState();
      } else if (msg.type === "host_toggle_lock") {
        lobbyLocked = Boolean(msg.locked);
        broadcastState();
      } else if (msg.type === "host_kick") {
        const targetSocket = playerSockets.get(msg.playerId);
        if (lobbyPlayers.delete(msg.playerId)) {
          playerSockets.delete(msg.playerId);
          if (targetSocket) {
            send(targetSocket, {
              type: "kicked",
              message: "You were removed from the lobby by the host.",
            });
          }
          broadcastState();
        }
      } else if (msg.type === "host_add_bots") {
        const count = Math.min(20, Math.max(1, Number(msg.count) || 1));
        for (let i = 0; i < count; i++) {
          if (lobbyPlayers.size >= MAX_PLAYERS) break;
          const idx = botCounter;
          botCounter += 1;
          const preset = BOT_ARCHETYPES[idx % BOT_ARCHETYPES.length];
          const suffix =
            idx >= BOT_ARCHETYPES.length
              ? ` ${Math.floor(idx / BOT_ARCHETYPES.length) + 1}`
              : "";
          const jitter = idx >= BOT_ARCHETYPES.length ? 0.15 : 0;
          const aggression = clamp01(
            preset.aggression + (Math.random() * 2 - 1) * jitter
          );
          const damageRatio = clamp01(
            preset.damageRatio + (Math.random() * 2 - 1) * jitter
          );
          const botId = `bot-${crypto.randomUUID().slice(0, 6)}`;
          lobbyPlayers.set(botId, {
            id: botId,
            name: `${preset.name}${suffix}`,
            strategy: {
              aggression: Number(aggression.toFixed(2)),
              damageRatio: Number(damageRatio.toFixed(2)),
            },
            ready: true,
            isBot: true,
            color: nextColor(),
          });
        }
        broadcastState();
      } else if (msg.type === "host_clear_bots") {
        for (const [id, p] of lobbyPlayers.entries()) {
          if (p.isBot) lobbyPlayers.delete(id);
        }
        broadcastState();
      }
    }
  });

  ws.on("close", () => {
    playerSockets.delete(playerId);
    if (lobbyPlayers.delete(playerId)) {
      broadcastState();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Hunger Royale server listening on http://localhost:${PORT}`);
  console.log(`Host PIN: ${HOST_PIN} (set HOST_PIN env var to customize)`);
  console.log(`Routes: / (player), /projector (read-only), /host (admin)`);
});
