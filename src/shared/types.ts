export interface Strategy {
  /** 0 = purely defensive (always flee), 1 = purely aggressive (always fight) */
  aggression: number;
  /** 0 = max defense, 1 = max damage */
  damageRatio: number;
}

export type ZoneId = "inner" | "middle" | "outer";

export interface ZoneConfig {
  id: ZoneId;
  label: string;
  /** Outer radius as a fraction of current map radius (0..1] */
  maxRadiusFraction: number;
  /** Payoff multiplier applied to survival & elimination points */
  payoffMultiplier: number;
  /** Constant HP regenerated per round while surviving in this zone */
  healthRegen: number;
}

export interface SimConfig {
  initialMapRadius: number;
  minMapRadius: number;
  shrinkPerRound: number;
  maxRounds: number;
  fightRadius: number;
  maxHealth: number;
  startingPoints: number;
  survivalPoints: number;
  eliminationDivisor: number;
  baseAttack: number;
  bonusAttack: number;
  /** Defense reduces incoming damage by up to maxDefenseReduction (e.g. 0.55) */
  maxDefenseReduction: number;
  minDamage: number;
  minMoveFraction: number;
  maxMoveFraction: number;
  fleeStepFraction: number;
  roundIntervalMs: number;
  zones: [ZoneConfig, ZoneConfig, ZoneConfig];
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
  hp: number;
  maxHp: number;
  points: number;
  kills: number;
  alive: boolean;
  eliminatedRound: number | null;
  zone: ZoneId;
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
