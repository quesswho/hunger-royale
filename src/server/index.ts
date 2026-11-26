import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import type {
  ClientMessage,
  Player,
  ServerMessage,
  TournamentState,
} from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, players: players.size });
});

const clientDistPath = path.resolve(__dirname, "../../client");
app.use(express.static(clientDistPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const players = new Map<string, Player>();
let phase: TournamentState["phase"] = "lobby";
let round = 1;

function getState(): TournamentState {
  return {
    phase,
    round,
    players: Array.from(players.values()),
  };
}

function broadcast(message: ServerMessage) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

wss.on("connection", (ws) => {
  const playerId = crypto.randomUUID().slice(0, 8);

  const welcome: ServerMessage = {
    type: "welcome",
    playerId,
    state: getState(),
  };
  ws.send(JSON.stringify(welcome));

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return;
    }

    if (msg.type === "join") {
      const name = msg.name.trim().slice(0, 24) || `Player ${players.size + 1}`;
      players.set(playerId, {
        id: playerId,
        name,
        strategy: { offenseRatio: 0.5, aggression: 0.5 },
        ready: false,
      });
      broadcast({ type: "state", state: getState() });
    } else if (msg.type === "update_strategy") {
      const existing = players.get(playerId);
      if (!existing) return;
      existing.strategy = {
        offenseRatio: Math.min(1, Math.max(0, Number(msg.strategy.offenseRatio) || 0)),
        aggression: Math.min(1, Math.max(0, Number(msg.strategy.aggression) || 0)),
      };
      if (typeof msg.ready === "boolean") {
        existing.ready = msg.ready;
      }
      broadcast({ type: "state", state: getState() });
    } else if (msg.type === "host_start") {
      phase = "running";
      broadcast({ type: "state", state: getState() });
    } else if (msg.type === "host_reset") {
      phase = "lobby";
      round = 1;
      for (const p of players.values()) {
        p.ready = false;
      }
      broadcast({ type: "state", state: getState() });
    }
  });

  ws.on("close", () => {
    if (players.delete(playerId)) {
      broadcast({ type: "state", state: getState() });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Hunger Royale server listening on http://localhost:${PORT}`);
});
