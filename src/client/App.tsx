import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type {
  ClientMessage,
  ServerMessage,
  Strategy,
  TournamentState,
} from "../shared/types";

type Mode = "player" | "host";

function getInitialMode(): Mode {
  const params = new URLSearchParams(window.location.search);
  return params.get("mode") === "host" ? "host" : "player";
}

export function App() {
  const [mode, setMode] = useState<Mode>(getInitialMode);
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<TournamentState>({
    phase: "lobby",
    round: 1,
    players: [],
  });
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>({
    offenseRatio: 0.5,
    aggression: 0.5,
  });
  const [ready, setReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const joinUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("mode");
    return url.toString();
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      if (msg.type === "welcome" || msg.type === "state") {
        setState(msg.state);
      }
    };

    return () => ws.close();
  }, []);

  function send(msg: ClientMessage) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    send({ type: "join", name });
    setJoined(true);
  }

  function updateStrategy(next: Strategy, nextReady = ready) {
    setStrategy(next);
    setReady(nextReady);
    send({ type: "update_strategy", strategy: next, ready: nextReady });
  }

  return (
    <main className="container">
      <header className="header">
        <div>
          <h1>Hunger Royale</h1>
          <p className="subtitle">
            {connected ? "Connected" : "Reconnecting..."} · Round {state.round} ·{" "}
            {state.players.length} players
          </p>
        </div>
        <div className="mode-toggle">
          <button
            className={mode === "player" ? "active" : ""}
            onClick={() => setMode("player")}
          >
            Player
          </button>
          <button
            className={mode === "host" ? "active" : ""}
            onClick={() => setMode("host")}
          >
            Host / Projector
          </button>
        </div>
      </header>

      {mode === "host" ? (
        <section className="host-grid">
          <div className="card qr-card">
            <h2>Join the Tournament</h2>
            <div className="qr-box">
              <QRCodeSVG value={joinUrl} size={220} />
            </div>
            <p className="join-url">{joinUrl}</p>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>Lobby ({state.players.length})</h2>
              <div className="actions">
                <button
                  className="primary"
                  onClick={() => send({ type: "host_start" })}
                >
                  Start Round
                </button>
                <button onClick={() => send({ type: "host_reset" })}>
                  Reset
                </button>
              </div>
            </div>
            {state.players.length === 0 ? (
              <p className="muted">Waiting for students to scan and join...</p>
            ) : (
              <ul className="player-list">
                {state.players.map((p) => (
                  <li key={p.id}>
                    <span>{p.name}</span>
                    <span className="badge">
                      {p.ready ? "Ready" : "Tuning..."}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : !joined ? (
        <form className="card join-form" onSubmit={handleJoin}>
          <h2>Enter Your Name</h2>
          <input
            type="text"
            placeholder="e.g. Ada"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            autoFocus
          />
          <button className="primary" type="submit" disabled={!connected}>
            Join Tournament
          </button>
        </form>
      ) : (
        <section className="card sliders">
          <h2>Configure Strategy</h2>
          <label className="slider-row">
            <div className="slider-labels">
              <span>Health</span>
              <span>{Math.round(strategy.offenseRatio * 100)}% Damage</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={strategy.offenseRatio}
              onChange={(e) =>
                updateStrategy({
                  ...strategy,
                  offenseRatio: Number(e.target.value),
                })
              }
            />
          </label>

          <label className="slider-row">
            <div className="slider-labels">
              <span>Defensive</span>
              <span>{Math.round(strategy.aggression * 100)}% Aggressive</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={strategy.aggression}
              onChange={(e) =>
                updateStrategy({
                  ...strategy,
                  aggression: Number(e.target.value),
                })
              }
            />
          </label>

          <button
            className="primary"
            onClick={() => updateStrategy(strategy, !ready)}
          >
            {ready ? "Locked In (Click to Edit)" : "Lock In Strategy"}
          </button>
        </section>
      )}
    </main>
  );
}
