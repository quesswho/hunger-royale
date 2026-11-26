export interface Strategy {
  /** 0 = purely defensive (always flee), 1 = purely aggressive (always fight) */
  aggression: number;
  /** 0 = max defense, 1 = max damage */
  damageRatio: number;
}

export interface SimConfig {
  initialMapRadius: number;
  minMapRadius: number;
  shrinkPerRound: number;
  maxRounds: number;
  fightRadius: number;
  /** Smooth radial payoff gradient gamma: m(r,t) = 1 + gamma * (1 - r / R(t)) */
  zoneGradient: number;
  /** Single combat lethality constant lambda on normalized HP in [0, 1] */
  lethality: number;
  /** Constant HP regenerated per round (0 in base model; normalized to [0, 1]) */
  healthRegen: number;
  startingPoints: number;
  survivalPoints: number;
  eliminationDivisor: number;
  /** Inward radial drift per round as a fraction of current map radius R(t) */
  inwardDriftFraction: number;
  /** Random movement noise radius per round as a fraction of R(t) */
  moveNoiseFraction: number;
  /** Flee step length as a fraction of R(t) */
  fleeStepFraction: number;
  roundIntervalMs: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  strategy: Strategy;
  ready: boolean;
  isBot?: boolean;
  color: string;
}

export type PlayerActionKind = "move" | "fight" | "flee" | "eliminated";

export interface SimPlayer {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  strategy: Strategy;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  /** Normalized health in [0, 1] */
  hp: number;
  points: number;
  kills: number;
  alive: boolean;
  eliminatedRound: number | null;
  /** Current radial payoff multiplier m(r, t) */
  multiplier: number;
  lastAction: PlayerActionKind;
  targetId: string | null;
  lastDamageTaken: number;
  lastPointsGained: number;
}

export interface CombatLine {
  fromId: string;
  toId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  damage: number;
  eliminated: boolean;
}

export interface RoundEvent {
  round: number;
  text: string;
  kind: "fight" | "flee" | "elimination" | "info";
}

export interface MatchState {
  round: number;
  mapRadius: number;
  players: SimPlayer[];
  combatLines: CombatLine[];
  events: RoundEvent[];
  finished: boolean;
  seed: number;
}

export type TournamentPhase = "lobby" | "running" | "paused" | "results";

export interface TournamentState {
  phase: TournamentPhase;
  lobbyLocked: boolean;
  config: SimConfig;
  lobbyPlayers: LobbyPlayer[];
  match: MatchState | null;
}

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "update_strategy"; strategy: Strategy; ready?: boolean }
  | { type: "host_auth"; pin: string }
  | { type: "host_start" }
  | { type: "host_pause" }
  | { type: "host_resume" }
  | { type: "host_step" }
  | { type: "host_reset" }
  | { type: "host_toggle_lock"; locked: boolean }
  | { type: "host_kick"; playerId: string }
  | { type: "host_add_bots"; count: number }
  | { type: "host_clear_bots" };

export type ServerMessage =
  | { type: "welcome"; playerId: string; state: TournamentState }
  | { type: "state"; state: TournamentState }
  | { type: "host_auth_result"; ok: boolean; error?: string }
  | { type: "kicked"; message: string }
  | { type: "error"; message: string };
