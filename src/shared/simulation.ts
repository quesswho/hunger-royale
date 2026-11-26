import type { Player } from "./types.js";

export interface RoundResult {
  playerId: string;
  score: number;
}

/**
 * Placeholder simulation entry point.
 * Will be replaced with the full game-theory mechanics once specified.
 */
export function runSimulation(players: Player[]): RoundResult[] {
  return players.map((player) => ({
    playerId: player.id,
    score: 0,
  }));
}
