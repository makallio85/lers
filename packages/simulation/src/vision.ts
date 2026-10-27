import { BUILDING_TYPES, SPELL_STATS, isSpecialistType, isUnitType } from './definitions.ts';
import type { BuildingTypeId, GoodAmounts, MapLayoutType, SettlerType, VictoryType } from './definitions.ts';
import { VISION_EXPLORED, VISION_NONE, VISION_VISIBLE, inBounds, isEnemy, isMilitaryBuilding, siteCost, tileIndex } from './world.ts';
import type { PlayerState, World } from './world.ts';

const BUILDING_SIGHT = 7;
const MILITARY_EXTRA_SIGHT = 3;
const SOLDIER_SIGHT = 8;
const SETTLER_SIGHT = 5;

function reveal(world: World, vision: Uint8Array, cx: number, cy: number, r: number): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (inBounds(world, x, y) && Math.hypot(x - cx, y - cy) <= r) vision[tileIndex(world, x, y)] = VISION_VISIBLE;
    }
  }
}

/** Recomputes what every player sees: buildings and settlers reveal land around them; seen land stays explored. */
export function updateVision(world: World): void {
  for (const player of world.players) {
    const vision = world.vision[player.id];
    for (let i = 0; i < vision.length; i++) if (vision[i] === VISION_VISIBLE) vision[i] = VISION_EXPLORED;
    for (const b of world.buildings) {
      if (b.owner !== player.id) continue;
      const type = BUILDING_TYPES[b.typeId];
      const r = type.visionRadius > 0 && b.isComplete ? type.visionRadius
        : type.territoryRadius > 0 ? type.territoryRadius + MILITARY_EXTRA_SIGHT : BUILDING_SIGHT;
      reveal(world, vision, b.x + b.size / 2, b.y + b.size / 2, r);
    }
    for (const s of world.settlers) {
      if (s.owner !== player.id || s.isInside) continue;
      reveal(world, vision, s.x, s.y, isUnitType(s.settlerType) ? SOLDIER_SIGHT : SETTLER_SIGHT);
    }
    for (const f of world.farSights) if (f.playerId === player.id) reveal(world, vision, f.x, f.y, SPELL_STATS.far_sight.radius);
  }
  // Allies share what they see and what they have explored.
  for (const player of world.players) {
    const allies = world.players.filter((p) => p.id !== player.id && p.teamId === player.teamId);
    if (allies.length === 0 || allies[0].id < player.id) continue;
    const team = [player, ...allies].map((p) => world.vision[p.id]);
    const n = team[0].length;
    for (let i = 0; i < n; i++) {
      let best = 0;
      for (const v of team) if (v[i] > best) best = v[i];
      if (best !== 0) for (const v of team) v[i] = best;
    }
  }
}

export function canSee(world: World, playerId: number, x: number, y: number): boolean {
  const tx = Math.round(x), ty = Math.round(y);
  return inBounds(world, tx, ty) && world.vision[playerId][tileIndex(world, tx, ty)] === VISION_VISIBLE;
}

export function hasExplored(world: World, playerId: number, x: number, y: number): boolean {
  const tx = Math.round(x), ty = Math.round(y);
  return inBounds(world, tx, ty) && world.vision[playerId][tileIndex(world, tx, ty)] !== VISION_NONE;
}

/** A building counts as found once its door or its middle has been explored, the same test the observation uses. */
export function hasExploredBuilding(world: World, playerId: number, b: { x: number; y: number; size: number; doorX: number; doorY: number }): boolean {
  return hasExplored(world, playerId, b.doorX, b.doorY) || hasExplored(world, playerId, b.x + b.size / 2, b.y + b.size / 2);
}

export interface ObservedBuilding {
  id: number;
  typeId: BuildingTypeId;
  owner: number;
  x: number;
  y: number;
  size: number;
  doorX: number;
  doorY: number;
  isComplete: boolean;
  garrisonCount: number;
  /** Out of sight now: remembered from land explored earlier, its garrison unknown. */
  isRemembered?: boolean;
}

export interface OwnBuilding extends ObservedBuilding {
  stock: GoodAmounts;
  input: GoodAmounts;
  blockedReason: string | null;
  workerId: number | null;
  garrisonWanted: number;
  residentsLeft: number;
  /** Construction sites only: building materials still to be delivered. */
  materialsOwed: { plank: number; stone: number };
}

export interface ObservedSoldier {
  id: number;
  owner: number;
  settlerType: SettlerType;
  x: number;
  y: number;
  health: number;
  /** Own soldiers only: what the soldier is doing. */
  phase?: string;
  /** Own priests only: whether he can cast now, or still rests from the last spell. */
  isReady?: boolean;
  /** Own units only: the ship carrying them, or null on land. */
  shipId?: number | null;
  /** Own units only: whether it is fighting an enemy right now. */
  isFighting?: boolean;
}

/**
 * Everything one player is allowed to know: its own state in full, other players only where it can see.
 * Built-in bots and external agents decide from this, never from the world itself.
 */
export interface Observation {
  tick: number;
  playerId: number;
  player: PlayerState;
  width: number;
  height: number;
  ownBuildings: OwnBuilding[];
  /** Enemy players' buildings this player can see right now. */
  enemyBuildings: ObservedBuilding[];
  /** Allies' buildings this player can see right now. */
  allyBuildings: ObservedBuilding[];
  ownSoldiers: ObservedSoldier[];
  /** Own geologists, pioneers, thieves and priests, with what they are doing. */
  ownSpecialists: ObservedSoldier[];
  /** Enemy soldiers in view right now, outside buildings. */
  enemySoldiers: ObservedSoldier[];
  settlerCounts: Partial<Record<SettlerType, number>>;
  freeCarriers: number;
  /** The kind of map, chosen in the open when the match was set up. */
  mapLayout: MapLayoutType;
  /** How the match is won, also chosen in the open. */
  victoryType: VictoryType;
}

export function observe(world: World, playerId: number): Observation {
  const player = world.players[playerId];
  const ownBuildings: OwnBuilding[] = [];
  const enemyBuildings: ObservedBuilding[] = [];
  const allyBuildings: ObservedBuilding[] = [];
  for (const b of world.buildings) {
    const seen: ObservedBuilding = {
      id: b.id, typeId: b.typeId, owner: b.owner, x: b.x, y: b.y, size: b.size, doorX: b.doorX, doorY: b.doorY,
      isComplete: b.isComplete, garrisonCount: b.garrison.length
    };
    if (b.owner === playerId) {
      ownBuildings.push({
        ...seen, stock: { ...b.stock }, input: { ...b.input }, blockedReason: b.blockedReason, workerId: b.workerId,
        garrisonWanted: b.garrisonWanted, residentsLeft: b.residentsLeft,
        materialsOwed: b.isComplete ? { plank: 0, stone: 0 } : {
          plank: Math.max(0, (siteCost(world, b).plank ?? 0) - b.delivered.plank - b.built.plank),
          stone: Math.max(0, (siteCost(world, b).stone ?? 0) - b.delivered.stone - b.built.stone)
        }
      });
    } else if (canSee(world, playerId, b.doorX, b.doorY) || canSee(world, playerId, b.x + b.size / 2, b.y + b.size / 2)) {
      (isEnemy(world, playerId, b.owner) ? enemyBuildings : allyBuildings).push(seen);
    } else if (isEnemy(world, playerId, b.owner) && isMilitaryBuilding(b) && hasExploredBuilding(world, playerId, b)) {
      // An enemy tower or castle on explored land is remembered, as a player sees it on the map, but not who is inside.
      enemyBuildings.push({ ...seen, garrisonCount: 0, isRemembered: true });
    }
  }
  const ownSoldiers: ObservedSoldier[] = [];
  const ownSpecialists: ObservedSoldier[] = [];
  const enemySoldiers: ObservedSoldier[] = [];
  const settlerCounts: Partial<Record<SettlerType, number>> = {};
  let freeCarriers = 0;
  for (const s of world.settlers) {
    if (s.owner === playerId) {
      settlerCounts[s.settlerType] = (settlerCounts[s.settlerType] ?? 0) + 1;
      // Carriers still coming out of a building at the start count as free: they are on their way to wait for work.
      if (s.settlerType === 'carrier' && (s.phase === 'idle' || s.phase === 'leaving') && !s.carrying) freeCarriers++;
      if (isSpecialistType(s.settlerType) || s.settlerType === 'priest') {
        ownSpecialists.push({ id: s.id, owner: s.owner, settlerType: s.settlerType, x: s.x, y: s.y, health: s.health, phase: s.phase,
          ...(s.settlerType === 'priest' ? { isReady: s.timer === 0 && !s.isInside } : {}) });
      }
      if (isUnitType(s.settlerType)) {
        ownSoldiers.push({ id: s.id, owner: s.owner, settlerType: s.settlerType, x: s.x, y: s.y, health: s.health, phase: s.isInside ? 'inside' : s.phase, shipId: s.shipId, isFighting: s.enemyId !== null });
      }
    } else if (isUnitType(s.settlerType) && !s.isInside && canSee(world, playerId, s.x, s.y)) {
      if (isEnemy(world, playerId, s.owner)) enemySoldiers.push({ id: s.id, owner: s.owner, settlerType: s.settlerType, x: s.x, y: s.y, health: s.health });
    }
  }
  return {
    tick: world.tick, playerId, player: structuredClone(player), width: world.width, height: world.height,
    ownBuildings, enemyBuildings, allyBuildings, ownSoldiers, ownSpecialists, enemySoldiers, settlerCounts, freeCarriers, mapLayout: world.mapLayout, victoryType: world.victoryType
  };
}
