export interface Strategy {
  /** 0 = max health, 1 = max damage (placeholder until rules are finalized) */
  offenseRatio: number;
  /** 0 = defensive, 1 = aggressive (placeholder until rules are finalized) */
  aggression: number;
}

export interface Player {
  id: string;
  name: string;
  strategy: Strategy;
  ready: boolean;
}

export type TournamentPhase = "lobby" | "running" | "results";

export interface TournamentState {
  phase: TournamentPhase;
  round: number;
  players: Player[];
}

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "update_strategy"; strategy: Strategy; ready?: boolean }
  | { type: "host_start" }
  | { type: "host_reset" };

export type ServerMessage =
  | { type: "welcome"; playerId: string; state: TournamentState }
  | { type: "state"; state: TournamentState };
