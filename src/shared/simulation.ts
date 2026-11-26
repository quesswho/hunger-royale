import type {
  CombatLine,
  LobbyPlayer,
  MatchState,
  RoundEvent,
  SimConfig,
  SimPlayer,
  Strategy,
} from "./types.js";

export const DEFAULT_CONFIG: SimConfig = {
  initialMapRadius: 100,
  minMapRadius: 22,
  shrinkPerRound: 2.2,
  maxRounds: 40,
  fightRadius: 18,
  zoneGradient: 1.0,
  lethality: 0.25,
  fleeDamageFactor: 0.5,
  healthRegen: 0,
  startingPoints: 20,
  survivalPoints: 10,
  eliminationDivisor: 2,
  minMoveFraction: 0.05,
  maxMoveFraction: 0.15,
  fleeStepFraction: 0.22,
  roundIntervalMs: 900,
};

/** Simple deterministic Mulberry32 PRNG */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/**
 * Single dimensionless combat formula on normalized HP in [0, 1]:
 *   dmg(i -> j) = lambda * (1 + d_i) / (1 + (1 - d_j))
 */
export function computeDamage(
  attacker: Strategy,
  defender: Strategy,
  config: SimConfig
): number {
  const dAtt = clamp01(attacker.damageRatio);
  const dDef = clamp01(defender.damageRatio);
  return config.lethality * ((1 + dAtt) / (1 + (1 - dDef)));
}

/**
 * Smooth radial payoff multiplier:
 *   m(r, t) = 1 + gamma * (1 - r / R(t))
 */
export function getPayoffMultiplier(
  x: number,
  y: number,
  mapRadius: number,
  config: SimConfig
): number {
  if (mapRadius <= 0) return 1 + config.zoneGradient;
  const r = Math.min(mapRadius, Math.hypot(x, y));
  return Number(
    (1 + config.zoneGradient * (1 - r / mapRadius)).toFixed(2)
  );
}

export function clampToMap(
  x: number,
  y: number,
  mapRadius: number
): { x: number; y: number } {
  const dist = Math.hypot(x, y);
  if (dist <= mapRadius || dist === 0) {
    return { x, y };
  }
  const scale = (mapRadius * 0.995) / dist;
  return { x: x * scale, y: y * scale };
}

/**
 * Compute flee destination that maximizes distance from the opponent while
 * remaining strictly inside the circular map of radius `mapRadius`.
 */
function computeFleePosition(
  selfX: number,
  selfY: number,
  oppX: number,
  oppY: number,
  stepLen: number,
  mapRadius: number
): { x: number; y: number } {
  const awayDx = selfX - oppX;
  const awayDy = selfY - oppY;
  const awayBaseAngle =
    awayDx === 0 && awayDy === 0 ? 0 : Math.atan2(awayDy, awayDx);

  let best = clampToMap(
    selfX + Math.cos(awayBaseAngle) * stepLen,
    selfY + Math.sin(awayBaseAngle) * stepLen,
    mapRadius
  );
  let bestDist = Math.hypot(best.x - oppX, best.y - oppY);

  const samples = 24;
  for (let i = 0; i < samples; i++) {
    const angle = awayBaseAngle + (i / samples) * Math.PI * 2;
    const candidate = clampToMap(
      selfX + Math.cos(angle) * stepLen,
      selfY + Math.sin(angle) * stepLen,
      mapRadius
    );
    const dist = Math.hypot(candidate.x - oppX, candidate.y - oppY);
    if (dist > bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }

  return best;
}

export function createInitialMatch(
  lobbyPlayers: LobbyPlayer[],
  config: SimConfig = DEFAULT_CONFIG,
  seed: number = Math.floor(Math.random() * 1_000_000_000)
): MatchState {
  const rng = createRng(seed);
  const count = Math.max(1, lobbyPlayers.length);

  const players: SimPlayer[] = lobbyPlayers.map((lp, index) => {
    const baseAngle = (index / count) * Math.PI * 2 + (rng() - 0.5) * 0.35;
    const spawnRadius = config.initialMapRadius * (0.55 + rng() * 0.38);
    const pos = clampToMap(
      Math.cos(baseAngle) * spawnRadius,
      Math.sin(baseAngle) * spawnRadius,
      config.initialMapRadius
    );

    return {
      id: lp.id,
      name: lp.name,
      color: lp.color,
      isBot: Boolean(lp.isBot),
      strategy: {
        aggression: clamp01(lp.strategy.aggression),
        damageRatio: clamp01(lp.strategy.damageRatio),
      },
      x: pos.x,
      y: pos.y,
      prevX: pos.x,
      prevY: pos.y,
      hp: 1,
      points: config.startingPoints,
      kills: 0,
      alive: true,
      eliminatedRound: null,
      multiplier: getPayoffMultiplier(
        pos.x,
        pos.y,
        config.initialMapRadius,
        config
      ),
      lastAction: "move",
      targetId: null,
      lastDamageTaken: 0,
      lastPointsGained: 0,
    };
  });

  return {
    round: 0,
    mapRadius: config.initialMapRadius,
    players,
    combatLines: [],
    events: [
      {
        round: 0,
        text: `Tournament started with ${players.length} players.`,
        kind: "info",
      },
    ],
    finished: players.length <= 1,
    seed,
  };
}

export function stepRound(
  prev: MatchState,
  config: SimConfig = DEFAULT_CONFIG
): MatchState {
  if (prev.finished) return prev;

  const nextRound = prev.round + 1;
  const rng = createRng(prev.seed + nextRound * 7919);

  // 1. Shrink map radius
  const nextRadius = Math.max(
    config.minMapRadius,
    Number(
      (config.initialMapRadius - config.shrinkPerRound * nextRound).toFixed(2)
    )
  );

  const players: SimPlayer[] = prev.players.map((p) => {
    const clamped = p.alive
      ? clampToMap(p.x, p.y, nextRadius)
      : { x: p.x, y: p.y };
    return {
      ...p,
      prevX: p.x,
      prevY: p.y,
      x: clamped.x,
      y: clamped.y,
      lastDamageTaken: 0,
      lastPointsGained: 0,
      targetId: null,
    };
  });

  const byId = new Map(players.map((p) => [p.id, p]));
  const alivePlayers = players.filter((p) => p.alive);
  const startPoints = new Map(alivePlayers.map((p) => [p.id, p.points]));

  // 2. Detect engagements within fightRadius
  const nearestOpponent = new Map<string, { id: string; dist: number }>();
  for (const p of alivePlayers) {
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const other of alivePlayers) {
      if (other.id === p.id) continue;
      const dist = Math.hypot(p.x - other.x, p.y - other.y);
      if (dist <= config.fightRadius && dist < bestDist) {
        bestDist = dist;
        bestId = other.id;
      }
    }
    if (bestId) {
      nearestOpponent.set(p.id, { id: bestId, dist: bestDist });
    }
  }

  // 3. Simultaneous decisions
  const decisions = new Map<
    string,
    { kind: "move" | "fight" | "flee"; targetId: string | null }
  >();

  for (const p of alivePlayers) {
    const engaged = nearestOpponent.get(p.id);
    if (engaged) {
      const willFight = rng() < p.strategy.aggression;
      decisions.set(p.id, {
        kind: willFight ? "fight" : "flee",
        targetId: engaged.id,
      });
    } else {
      decisions.set(p.id, { kind: "move", targetId: null });
    }
  }

  // 4. Resolve movements simultaneously (radial inward drift + uniform disk noise)
  const startPos = new Map(alivePlayers.map((p) => [p.id, { x: p.x, y: p.y }]));
  const nextPositions = new Map<string, { x: number; y: number }>();

  for (const p of alivePlayers) {
    const decision = decisions.get(p.id)!;
    const pos = startPos.get(p.id)!;

    if (decision.kind === "fight") {
      nextPositions.set(p.id, pos);
    } else if (decision.kind === "flee" && decision.targetId) {
      const oppPos = startPos.get(decision.targetId)!;
      const stepLen = config.fleeStepFraction * nextRadius;
      nextPositions.set(
        p.id,
        computeFleePosition(pos.x, pos.y, oppPos.x, oppPos.y, stepLen, nextRadius)
      );
    } else {
      const angle = rng() * Math.PI * 2;
      const stepLen =
        (config.minMoveFraction +
          rng() * (config.maxMoveFraction - config.minMoveFraction)) *
        nextRadius;
      const nx = pos.x + Math.cos(angle) * stepLen;
      const ny = pos.y + Math.sin(angle) * stepLen;
      nextPositions.set(p.id, clampToMap(nx, ny, nextRadius));
    }
  }

  // 5. Resolve combat simultaneously
  const incomingDamage = new Map<string, number>();
  const attackersOf = new Map<string, string[]>();
  const combatLines: CombatLine[] = [];
  const roundEvents: RoundEvent[] = [];

  for (const p of alivePlayers) {
    const decision = decisions.get(p.id)!;
    p.lastAction = decision.kind;
    p.targetId = decision.targetId;

    if (decision.kind === "fight" && decision.targetId) {
      const target = byId.get(decision.targetId);
      if (target && target.alive) {
        const targetDecision = decisions.get(target.id);
        const baseDmg = computeDamage(p.strategy, target.strategy, config);
        const dmg =
          targetDecision?.kind === "flee"
            ? baseDmg * clamp01(config.fleeDamageFactor)
            : baseDmg;
        if (dmg > 0) {
          incomingDamage.set(
            target.id,
            (incomingDamage.get(target.id) ?? 0) + dmg
          );
          const list = attackersOf.get(target.id) ?? [];
          list.push(p.id);
          attackersOf.set(target.id, list);
        }

        const targetPos = nextPositions.get(target.id) ?? {
          x: target.x,
          y: target.y,
        };
        const selfPos = nextPositions.get(p.id) ?? { x: p.x, y: p.y };
        combatLines.push({
          fromId: p.id,
          toId: target.id,
          fromX: selfPos.x,
          fromY: selfPos.y,
          toX: targetPos.x,
          toY: targetPos.y,
          damage: dmg,
          eliminated: false,
        });

        const dmgPct = Math.round(dmg * 100);
        roundEvents.push({
          round: nextRound,
          text:
            targetDecision?.kind === "flee"
              ? `${p.name} struck fleeing ${target.name} (-${dmgPct}% HP)`
              : `${p.name} hit ${target.name} (-${dmgPct}% HP)`,
          kind: "fight",
        });
      }
    } else if (decision.kind === "flee" && decision.targetId) {
      const opp = byId.get(decision.targetId);
      const oppDecision = opp ? decisions.get(opp.id) : undefined;
      if (opp && oppDecision?.kind === "flee" && p.id < opp.id) {
        roundEvents.push({
          round: nextRound,
          text: `${p.name} and ${opp.name} both fled from each other`,
          kind: "flee",
        });
      }
    }
  }

  // Apply positions, multipliers, and damage
  for (const p of alivePlayers) {
    const pos = nextPositions.get(p.id)!;
    p.x = pos.x;
    p.y = pos.y;
    p.multiplier = getPayoffMultiplier(p.x, p.y, nextRadius, config);

    const dmg = incomingDamage.get(p.id) ?? 0;
    if (dmg > 0) {
      p.hp = Math.max(0, Number((p.hp - dmg).toFixed(4)));
      p.lastDamageTaken = dmg;
    }
  }

  // 6. Process eliminations & bounty payoffs scaled by killer's multiplier
  const eliminatedThisRound = alivePlayers.filter((p) => p.hp <= 0);
  for (const victim of eliminatedThisRound) {
    victim.alive = false;
    victim.eliminatedRound = nextRound;
    victim.lastAction = "eliminated";

    const killers = attackersOf.get(victim.id) ?? [];
    const victimBasePoints = startPoints.get(victim.id) ?? 0;
    const baseBounty = victimBasePoints / config.eliminationDivisor;

    if (killers.length > 0) {
      const share = baseBounty / killers.length;
      for (const killerId of killers) {
        const killer = byId.get(killerId);
        if (!killer) continue;
        const award = Number((share * killer.multiplier).toFixed(1));
        killer.points = Number((killer.points + award).toFixed(1));
        killer.lastPointsGained = Number((killer.lastPointsGained + award).toFixed(1));
        killer.kills += 1;

        for (const line of combatLines) {
          if (line.fromId === killerId && line.toId === victim.id) {
            line.eliminated = true;
          }
        }

        roundEvents.push({
          round: nextRound,
          text: `${killer.name} eliminated ${victim.name} (+${award} pts at ${killer.multiplier.toFixed(2)}x)`,
          kind: "elimination",
        });
      }
    }
  }

  // 7. Survival payoff + constant health regeneration (0 in base model)
  const survivors = players.filter((p) => p.alive);
  for (const p of survivors) {
    const survivalAward = Number(
      (config.survivalPoints * p.multiplier).toFixed(1)
    );
    p.points = Number((p.points + survivalAward).toFixed(1));
    p.lastPointsGained = Number((p.lastPointsGained + survivalAward).toFixed(1));
    if (config.healthRegen > 0) {
      p.hp = Math.min(1, Number((p.hp + config.healthRegen).toFixed(4)));
    }
  }

  const finished = survivors.length <= 1 || nextRound >= config.maxRounds;
  if (finished) {
    const sorted = [...players].sort((a, b) => b.points - a.points);
    const winner = sorted[0];
    roundEvents.push({
      round: nextRound,
      text: winner
        ? `Tournament finished! ${winner.name} leads with ${winner.points.toFixed(1)} pts.`
        : "Tournament finished!",
      kind: "info",
    });
  }

  const combinedEvents = [...roundEvents, ...prev.events].slice(0, 40);

  return {
    round: nextRound,
    mapRadius: nextRadius,
    players,
    combatLines,
    events: combinedEvents,
    finished,
    seed: prev.seed,
  };
}
