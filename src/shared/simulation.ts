import type {
  CombatLine,
  LobbyPlayer,
  MatchState,
  RoundEvent,
  SimConfig,
  SimPlayer,
  Strategy,
  ZoneConfig,
  ZoneId,
} from "./types.js";

export const DEFAULT_CONFIG: SimConfig = {
  initialMapRadius: 100,
  minMapRadius: 22,
  shrinkPerRound: 2.2,
  maxRounds: 40,
  fightRadius: 18,
  maxHealth: 100,
  startingPoints: 20,
  survivalPoints: 10,
  eliminationDivisor: 2,
  baseAttack: 14,
  bonusAttack: 30,
  maxDefenseReduction: 0.55,
  minDamage: 4,
  minMoveFraction: 0.08,
  maxMoveFraction: 0.28,
  fleeStepFraction: 0.22,
  roundIntervalMs: 900,
  zones: [
    {
      id: "inner",
      label: "Inner Core",
      maxRadiusFraction: 0.35,
      payoffMultiplier: 2.0,
      healthRegen: 1,
    },
    {
      id: "middle",
      label: "Middle Ring",
      maxRadiusFraction: 0.7,
      payoffMultiplier: 1.4,
      healthRegen: 3,
    },
    {
      id: "outer",
      label: "Outer Ring",
      maxRadiusFraction: 1.0,
      payoffMultiplier: 1.0,
      healthRegen: 5,
    },
  ],
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

export function getAttackPower(strategy: Strategy, config: SimConfig): number {
  return config.baseAttack + clamp01(strategy.damageRatio) * config.bonusAttack;
}

export function getDefenseReduction(
  strategy: Strategy,
  config: SimConfig
): number {
  return (1 - clamp01(strategy.damageRatio)) * config.maxDefenseReduction;
}

export function computeDamage(
  attacker: Strategy,
  defender: Strategy,
  config: SimConfig
): number {
  const rawAttack = getAttackPower(attacker, config);
  const reduction = getDefenseReduction(defender, config);
  return Math.max(config.minDamage, Math.round(rawAttack * (1 - reduction)));
}

export function getZoneConfig(
  x: number,
  y: number,
  mapRadius: number,
  config: SimConfig
): ZoneConfig {
  const dist = Math.hypot(x, y);
  const fraction = mapRadius > 0 ? dist / mapRadius : 0;
  for (const zone of config.zones) {
    if (fraction <= zone.maxRadiusFraction) {
      return zone;
    }
  }
  return config.zones[config.zones.length - 1];
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
 * Sample a point inside the circular map weighted by each zone's payoff multiplier.
 * Uses exact rejection sampling over the playable disk.
 */
function sampleRewardWeightedPoint(
  mapRadius: number,
  config: SimConfig,
  rng: () => number
): { x: number; y: number } {
  const maxMultiplier = Math.max(
    ...config.zones.map((z) => z.payoffMultiplier)
  );

  for (let attempt = 0; attempt < 40; attempt++) {
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng()) * mapRadius;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const zone = getZoneConfig(x, y, mapRadius, config);
    if (rng() <= zone.payoffMultiplier / maxMultiplier) {
      return { x, y };
    }
  }
  return { x: 0, y: 0 };
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

  // Sample 24 candidate directions around the player (handles boundary sliding cleanly)
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

  // Spawn players evenly around the outer/middle area with light jitter
  const players: SimPlayer[] = lobbyPlayers.map((lp, index) => {
    const baseAngle = (index / count) * Math.PI * 2 + (rng() - 0.5) * 0.35;
    const spawnRadius =
      config.initialMapRadius * (0.55 + rng() * 0.38);
    const pos = clampToMap(
      Math.cos(baseAngle) * spawnRadius,
      Math.sin(baseAngle) * spawnRadius,
      config.initialMapRadius
    );
    const zone = getZoneConfig(pos.x, pos.y, config.initialMapRadius, config);

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
      hp: config.maxHealth,
      maxHp: config.maxHealth,
      points: config.startingPoints,
      kills: 0,
      alive: true,
      eliminatedRound: null,
      zone: zone.id,
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
    Number((config.initialMapRadius - config.shrinkPerRound * nextRound).toFixed(2))
  );

  // Clone players and record previous positions; pull inside shrunken map if needed
  const players: SimPlayer[] = prev.players.map((p) => {
    const clamped = p.alive ? clampToMap(p.x, p.y, nextRadius) : { x: p.x, y: p.y };
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

  // Snapshot points at the start of the round for simultaneous elimination payoffs
  const startPoints = new Map(alivePlayers.map((p) => [p.id, p.points]));

  // 2. Determine engagements: anyone within fightRadius of another alive player
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

  // 3. Decide simultaneous actions for every alive player
  const decisions = new Map<
    string,
    { kind: "move" | "fight" | "flee"; targetId: string | null }
  >();

  for (const p of alivePlayers) {
    const engaged = nearestOpponent.get(p.id);
    if (engaged) {
      // Fight with probability = aggression, otherwise Flee
      const willFight = rng() < p.strategy.aggression;
      decisions.set(p.id, {
        kind: willFight ? "fight" : "flee",
        targetId: engaged.id,
      });
    } else {
      decisions.set(p.id, { kind: "move", targetId: null });
    }
  }

  // 4. Resolve movements (for "move" and "flee") simultaneously from start positions
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
      // Semi-random greedy movement weighted by zone rewards
      const target = sampleRewardWeightedPoint(nextRadius, config, rng);
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const distToTarget = Math.hypot(dx, dy);
      const minStep = config.minMoveFraction * nextRadius;
      const maxStep = config.maxMoveFraction * nextRadius;
      const stepLen = minStep + rng() * (maxStep - minStep);

      if (distToTarget === 0) {
        nextPositions.set(p.id, pos);
      } else {
        const moveDist = Math.min(stepLen, distToTarget);
        const nx = pos.x + (dx / distToTarget) * moveDist;
        const ny = pos.y + (dy / distToTarget) * moveDist;
        nextPositions.set(p.id, clampToMap(nx, ny, nextRadius));
      }
    }
  }

  // 5. Resolve attacks & damage simultaneously
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
        const dmg = computeDamage(p.strategy, target.strategy, config);
        incomingDamage.set(target.id, (incomingDamage.get(target.id) ?? 0) + dmg);
        const list = attackersOf.get(target.id) ?? [];
        list.push(p.id);
        attackersOf.set(target.id, list);

        const targetPos = nextPositions.get(target.id) ?? { x: target.x, y: target.y };
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

        const targetDecision = decisions.get(target.id);
        if (targetDecision?.kind === "flee") {
          roundEvents.push({
            round: nextRound,
            text: `${p.name} struck fleeing ${target.name} for ${dmg} dmg`,
            kind: "fight",
          });
        } else {
          roundEvents.push({
            round: nextRound,
            text: `${p.name} hit ${target.name} for ${dmg} dmg`,
            kind: "fight",
          });
        }
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

  // Apply positions, zone updates, and damage
  for (const p of alivePlayers) {
    const pos = nextPositions.get(p.id)!;
    p.x = pos.x;
    p.y = pos.y;
    p.zone = getZoneConfig(p.x, p.y, nextRadius, config).id as ZoneId;

    const dmg = incomingDamage.get(p.id) ?? 0;
    if (dmg > 0) {
      p.hp = Math.max(0, p.hp - dmg);
      p.lastDamageTaken = dmg;
    }
  }

  // 6. Process eliminations & elimination payoffs (scaled by killer's zone multiplier)
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
        const killerZone = getZoneConfig(killer.x, killer.y, nextRadius, config);
        const award = Number((share * killerZone.payoffMultiplier).toFixed(1));
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
          text: `${killer.name} eliminated ${victim.name} (+${award} pts, ${killerZone.payoffMultiplier}x zone)`,
          kind: "elimination",
        });
      }
    }
  }

  // 7. Survival payoff + constant zone-based health regeneration for survivors
  const survivors = players.filter((p) => p.alive);
  for (const p of survivors) {
    const zone = getZoneConfig(p.x, p.y, nextRadius, config);
    const survivalAward = Number(
      (config.survivalPoints * zone.payoffMultiplier).toFixed(1)
    );
    p.points = Number((p.points + survivalAward).toFixed(1));
    p.lastPointsGained = Number((p.lastPointsGained + survivalAward).toFixed(1));
    p.hp = Math.min(p.maxHp, p.hp + zone.healthRegen);
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
