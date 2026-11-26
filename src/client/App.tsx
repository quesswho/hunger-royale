import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type {
  ClientMessage,
  ServerMessage,
  SimPlayer,
  Strategy,
  TournamentState,
} from "../shared/types";
import { computeDamage, DEFAULT_CONFIG } from "../shared/simulation";
import { ArenaCanvas } from "./ArenaCanvas";
import { StrategyChart } from "./StrategyChart";

type Route = "player" | "projector" | "host";

const HOST_PIN_STORAGE_KEY = "hunger_royale_host_pin";

function getRoute(): Route {
  const pathname = window.location.pathname.replace(/\/+$/, "");
  if (pathname === "/host") return "host";
  if (pathname === "/projector") return "projector";
  return "player";
}

function sortLeaderboard(players: SimPlayer[]): SimPlayer[] {
  return [...players].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return b.kills - a.kills;
  });
}

export function App() {
  const route = useMemo(getRoute, []);
  const [connected, setConnected] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [state, setState] = useState<TournamentState>({
    phase: "lobby",
    lobbyLocked: false,
    config: DEFAULT_CONFIG,
    lobbyPlayers: [],
    match: null,
  });
  const [error, setError] = useState<string | null>(null);

  // Player state
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>({
    aggression: 0.5,
    damageRatio: 0.5,
  });
  const [ready, setReady] = useState(false);

  // Host state
  const [pinInput, setPinInput] = useState("");
  const [hostAuthed, setHostAuthed] = useState(false);
  const [hostAuthError, setHostAuthError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  const joinUrl = useMemo(() => window.location.origin, []);
  const projectorUrl = useMemo(() => `${window.location.origin}/projector`, []);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (route === "host") {
        const savedPin = sessionStorage.getItem(HOST_PIN_STORAGE_KEY);
        if (savedPin) {
          ws.send(JSON.stringify({ type: "host_auth", pin: savedPin }));
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setHostAuthed(false);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      if (msg.type === "welcome") {
        setMyPlayerId(msg.playerId);
        setState(msg.state);
      } else if (msg.type === "state") {
        setState(msg.state);
      } else if (msg.type === "host_auth_result") {
        if (msg.ok) {
          setHostAuthed(true);
          setHostAuthError(null);
        } else {
          setHostAuthed(false);
          sessionStorage.removeItem(HOST_PIN_STORAGE_KEY);
          setHostAuthError(msg.error ?? "Invalid host PIN.");
        }
      } else if (msg.type === "kicked") {
        setJoined(false);
        setReady(false);
        setError(msg.message);
      } else if (msg.type === "error") {
        setError(msg.message);
      }
    };

    return () => ws.close();
  }, [route]);

  function send(msg: ClientMessage) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    send({ type: "join", name });
    setJoined(true);
  }

  function updateStrategy(next: Strategy, nextReady = ready) {
    setStrategy(next);
    setReady(nextReady);
    send({ type: "update_strategy", strategy: next, ready: nextReady });
  }

  function handleHostLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!pinInput.trim()) return;
    setHostAuthError(null);
    sessionStorage.setItem(HOST_PIN_STORAGE_KEY, pinInput.trim());
    send({ type: "host_auth", pin: pinInput.trim() });
    setPinInput("");
  }

  function handleHostLogout() {
    sessionStorage.removeItem(HOST_PIN_STORAGE_KEY);
    setHostAuthed(false);
    wsRef.current?.close();
  }

  const readyCount = state.lobbyPlayers.filter((p) => p.ready).length;
  const leaderboard = useMemo(
    () => (state.match ? sortLeaderboard(state.match.players) : []),
    [state.match]
  );
  const mySimPlayer = useMemo(
    () =>
      state.match && myPlayerId
        ? state.match.players.find((p) => p.id === myPlayerId) ?? null
        : null,
    [state.match, myPlayerId]
  );
  const myRank = useMemo(() => {
    if (!mySimPlayer) return null;
    const idx = leaderboard.findIndex((p) => p.id === mySimPlayer.id);
    return idx >= 0 ? idx + 1 : null;
  }, [leaderboard, mySimPlayer]);

  // Preview combat exchange against a balanced (0.5) opponent
  const balancedOpp: Strategy = { aggression: 0.5, damageRatio: 0.5 };
  const previewDealPct = Math.round(
    computeDamage(strategy, balancedOpp, state.config) * 100
  );
  const previewTakePct = Math.round(
    computeDamage(balancedOpp, strategy, state.config) * 100
  );
  const maxMultiplier = (1 + state.config.zoneGradient).toFixed(1);

  return (
    <main className={`container ${route !== "player" ? "wide" : ""}`}>
      <header className="header">
        <div>
          <h1>Hunger Royale</h1>
          <p className="subtitle">
            {connected ? "Connected" : "Reconnecting..."} ·{" "}
            {state.match
              ? `Round ${state.match.round}/${state.config.maxRounds}`
              : "Lobby"}{" "}
            · {state.lobbyPlayers.length} players ({readyCount} ready)
            {state.lobbyLocked ? " · Lobby Locked" : ""}
          </p>
        </div>
        {route === "host" && hostAuthed && (
          <div className="actions">
            <a
              className="button-link"
              href={projectorUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open Projector
            </a>
            <button onClick={handleHostLogout}>Log Out</button>
          </div>
        )}
      </header>

      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button className="ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* PROJECTOR VIEW (READ-ONLY) */}
      {route === "projector" && (
        <>
          {!state.match ? (
            <section className="host-grid">
              <div className="card qr-card">
                <h2>Scan to Join</h2>
                <div className="qr-box">
                  <QRCodeSVG value={joinUrl} size={240} />
                </div>
                <p className="join-url">{joinUrl}</p>
                {state.lobbyLocked && (
                  <p className="status-pill locked">Lobby Locked</p>
                )}
              </div>

              <div className="card">
                <div className="card-header">
                  <h2>Lobby ({state.lobbyPlayers.length})</h2>
                  <span className="status-pill">WAITING FOR HOST</span>
                </div>
                <div className="zone-legend">
                  <div className="zone-chip inner">
                    <strong>Center</strong>
                    <span>{maxMultiplier}x payoff</span>
                  </div>
                  <div className="zone-chip middle">
                    <strong>Mid-Radius</strong>
                    <span>
                      {(1 + state.config.zoneGradient * 0.5).toFixed(1)}x payoff
                    </span>
                  </div>
                  <div className="zone-chip outer">
                    <strong>Edge</strong>
                    <span>1.0x payoff</span>
                  </div>
                </div>
                {state.lobbyPlayers.length === 0 ? (
                  <p className="muted">
                    Waiting for students to scan and join...
                  </p>
                ) : (
                  <ul className="player-list">
                    {state.lobbyPlayers.map((p) => (
                      <li key={p.id}>
                        <span className="player-name">
                          <span
                            className="color-dot"
                            style={{ background: p.color }}
                          />
                          {p.name}
                          {p.isBot && <span className="bot-tag">BOT</span>}
                        </span>
                        <span className={`badge ${p.ready ? "ready" : ""}`}>
                          {p.ready ? "Ready" : "Tuning..."}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ) : (
            <section className="arena-layout">
              <div className="card arena-card">
                <div className="card-header">
                  <h2>Live Arena</h2>
                  <span className="status-pill">
                    {state.phase.toUpperCase()}
                  </span>
                </div>
                <ArenaCanvas
                  match={state.match}
                  config={state.config}
                  size={500}
                />
                <p className="muted small">
                  Payoff multiplier scales smoothly from <strong>1.0x</strong>{" "}
                  at the edge to <strong>{maxMultiplier}x</strong> at the
                  center.
                </p>
              </div>

              <div className="side-column">
                <div className="card">
                  <h2>Leaderboard</h2>
                  <div className="table-wrap">
                    <table className="leaderboard">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Player</th>
                          <th>Pts</th>
                          <th>HP</th>
                          <th>K</th>
                          <th>Aggr / Dmg</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leaderboard.map((p, idx) => (
                          <tr
                            key={p.id}
                            className={p.alive ? "" : "eliminated"}
                          >
                            <td>{idx + 1}</td>
                            <td>
                              <span className="player-name">
                                <span
                                  className="color-dot"
                                  style={{ background: p.color }}
                                />
                                {p.name}
                              </span>
                            </td>
                            <td>
                              <strong>{p.points.toFixed(1)}</strong>
                            </td>
                            <td>{p.alive ? `${Math.round(p.hp * 100)}%` : "KO"}</td>
                            <td>{p.kills}</td>
                            <td className="mono">
                              {Math.round(p.strategy.aggression * 100)}/
                              {Math.round(p.strategy.damageRatio * 100)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="card">
                  <h2>Strategy Space (Size = Points)</h2>
                  <StrategyChart players={state.match.players} />
                </div>

                <div className="card">
                  <h2>Round Log</h2>
                  <ul className="event-feed">
                    {state.match.events.slice(0, 10).map((ev, i) => (
                      <li key={i} className={`event-${ev.kind}`}>
                        <span className="round-tag">R{ev.round}</span> {ev.text}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* HOST VIEW (PIN-PROTECTED) */}
      {route === "host" && !hostAuthed && (
        <form className="card join-form" onSubmit={handleHostLogin}>
          <h2>Host Authentication</h2>
          <p className="muted">
            Enter the Host PIN shown in your server terminal (or{" "}
            <code>HOST_PIN</code> env var).
          </p>
          <input
            type="password"
            inputMode="numeric"
            placeholder="Host PIN"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            autoFocus
          />
          {hostAuthError && <p className="error-text">{hostAuthError}</p>}
          <button className="primary" type="submit" disabled={!connected}>
            Unlock Host Panel
          </button>
        </form>
      )}

      {route === "host" && hostAuthed && (
        <>
          <section className="card control-bar">
            <div className="actions wrap">
              {state.phase === "lobby" || state.phase === "results" ? (
                <button
                  className="primary"
                  onClick={() => send({ type: "host_start" })}
                >
                  {state.phase === "results" ? "Run Again" : "Start Tournament"}
                </button>
              ) : state.phase === "running" ? (
                <button
                  className="primary"
                  onClick={() => send({ type: "host_pause" })}
                >
                  Pause
                </button>
              ) : (
                <button
                  className="primary"
                  onClick={() => send({ type: "host_resume" })}
                >
                  Resume
                </button>
              )}

              <button
                onClick={() => send({ type: "host_step" })}
                disabled={state.phase === "results"}
              >
                Step 1 Round
              </button>

              <button
                onClick={() =>
                  send({
                    type: "host_toggle_lock",
                    locked: !state.lobbyLocked,
                  })
                }
              >
                {state.lobbyLocked ? "Unlock Lobby" : "Lock Lobby"}
              </button>

              <button
                onClick={() => send({ type: "host_add_bots", count: 6 })}
              >
                +6 Bots
              </button>

              <button onClick={() => send({ type: "host_clear_bots" })}>
                Clear Bots
              </button>

              <button onClick={() => send({ type: "host_reset" })}>
                Reset to Lobby
              </button>
            </div>
          </section>

          <section className="arena-layout">
            <div className="card arena-card">
              {state.match ? (
                <>
                  <div className="card-header">
                    <h2>Live Arena</h2>
                    <span className="status-pill">
                      {state.phase.toUpperCase()}
                    </span>
                  </div>
                  <ArenaCanvas
                    match={state.match}
                    config={state.config}
                    size={460}
                  />
                </>
              ) : (
                <div className="qr-card">
                  <h2>Student Join QR</h2>
                  <div className="qr-box">
                    <QRCodeSVG value={joinUrl} size={200} />
                  </div>
                  <p className="join-url">{joinUrl}</p>
                  <p className="muted small">
                    Open <code>/projector</code> on the classroom screen to keep
                    this admin panel private.
                  </p>
                </div>
              )}
            </div>

            <div className="side-column">
              {state.match && (
                <>
                  <div className="card">
                    <h2>Leaderboard</h2>
                    <div className="table-wrap">
                      <table className="leaderboard">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Player</th>
                            <th>Pts</th>
                            <th>HP</th>
                            <th>K</th>
                            <th>Aggr/Dmg</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leaderboard.map((p, idx) => (
                            <tr
                              key={p.id}
                              className={p.alive ? "" : "eliminated"}
                            >
                              <td>{idx + 1}</td>
                              <td>
                                <span className="player-name">
                                  <span
                                    className="color-dot"
                                    style={{ background: p.color }}
                                  />
                                  {p.name}
                                </span>
                              </td>
                              <td>
                                <strong>{p.points.toFixed(1)}</strong>
                              </td>
                              <td>
                                {p.alive ? `${Math.round(p.hp * 100)}%` : "KO"}
                              </td>
                              <td>{p.kills}</td>
                              <td className="mono">
                                {Math.round(p.strategy.aggression * 100)}/
                                {Math.round(p.strategy.damageRatio * 100)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="card">
                    <h2>Strategy Space</h2>
                    <StrategyChart players={state.match.players} />
                  </div>
                </>
              )}

              <div className="card">
                <h2>Lobby Roster ({state.lobbyPlayers.length})</h2>
                {state.lobbyPlayers.length === 0 ? (
                  <p className="muted">
                    No players yet. Have students scan the QR or click{" "}
                    <strong>+6 Bots</strong> to test.
                  </p>
                ) : (
                  <ul className="player-list">
                    {state.lobbyPlayers.map((p) => (
                      <li key={p.id}>
                        <span className="player-name">
                          <span
                            className="color-dot"
                            style={{ background: p.color }}
                          />
                          {p.name}
                          {p.isBot && <span className="bot-tag">BOT</span>}
                        </span>
                        <div className="player-actions">
                          <span className={`badge ${p.ready ? "ready" : ""}`}>
                            {p.ready ? "Ready" : "Tuning..."}
                          </span>
                          <button
                            className="danger small-btn"
                            onClick={() =>
                              send({ type: "host_kick", playerId: p.id })
                            }
                          >
                            Kick
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {/* PLAYER VIEW */}
      {route === "player" && !joined && (
        <form className="card join-form" onSubmit={handleJoin}>
          <h2>Join Tournament</h2>
          {state.lobbyLocked ? (
            <p className="muted">
              The lobby is currently locked by the host. Please wait for the
              next round.
            </p>
          ) : (
            <>
              <input
                type="text"
                placeholder="Your name (e.g. Ada)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={24}
                autoFocus
              />
              <button className="primary" type="submit" disabled={!connected}>
                Join Tournament
              </button>
            </>
          )}
        </form>
      )}

      {route === "player" && joined && (
        <div className="player-stack">
          {mySimPlayer && state.match && (
            <section className="card my-status">
              <div className="card-header">
                <h2>
                  {mySimPlayer.alive ? "In Arena" : "Eliminated"} · Rank #
                  {myRank ?? "-"}
                </h2>
                <span className="status-pill">
                  {mySimPlayer.points.toFixed(1)} pts
                </span>
              </div>
              <div className="stat-grid">
                <div className="stat-box">
                  <span className="stat-label">Health</span>
                  <strong>{Math.round(mySimPlayer.hp * 100)}%</strong>
                </div>
                <div className="stat-box">
                  <span className="stat-label">Zone Multiplier</span>
                  <strong>{mySimPlayer.multiplier.toFixed(2)}x</strong>
                </div>
                <div className="stat-box">
                  <span className="stat-label">Kills</span>
                  <strong>{mySimPlayer.kills}</strong>
                </div>
                <div className="stat-box">
                  <span className="stat-label">Last Action</span>
                  <strong className="capitalize">
                    {mySimPlayer.lastAction}
                  </strong>
                </div>
              </div>
            </section>
          )}

          <section className="card sliders">
            <h2>Configure Strategy</h2>
            <label className="slider-row">
              <div className="slider-labels">
                <span>Defensive (Flee)</span>
                <strong>
                  {Math.round(strategy.aggression * 100)}% Fight Chance
                </strong>
                <span>Aggressive (Fight)</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={strategy.aggression}
                disabled={state.phase === "running"}
                onChange={(e) =>
                  updateStrategy({
                    ...strategy,
                    aggression: Number(e.target.value),
                  })
                }
              />
            </label>

            <label className="slider-row">
              <div className="slider-labels">
                <span>Max Defense</span>
                <strong>
                  Deal {previewDealPct}% · Take {previewTakePct}% (vs 50/50)
                </strong>
                <span>Max Damage</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={strategy.damageRatio}
                disabled={state.phase === "running"}
                onChange={(e) =>
                  updateStrategy({
                    ...strategy,
                    damageRatio: Number(e.target.value),
                  })
                }
              />
            </label>

            <button
              className="primary"
              disabled={state.phase === "running"}
              onClick={() => updateStrategy(strategy, !ready)}
            >
              {state.phase === "running"
                ? "Match in Progress..."
                : ready
                ? "Locked In (Click to Edit)"
                : "Lock In Strategy"}
            </button>

            <div className="rules-box">
              <p>
                <strong>Payoff Gradient:</strong> Scales smoothly from{" "}
                <strong>1.0x</strong> at the edge to{" "}
                <strong>{maxMultiplier}x</strong> at the center as the arena
                shrinks.
              </p>
              <p>
                <strong>Duels:</strong> When two players enter fight range, each
                fights with probability = Aggression or flees away. A fleeing
                player hit by an attacker takes{" "}
                <strong>
                  {Math.round(state.config.fleeDamageFactor * 100)}%
                </strong>{" "}
                combat damage while escaping.
              </p>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
