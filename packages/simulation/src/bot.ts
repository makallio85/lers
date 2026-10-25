import { BUILDING_TYPES, GOOD_NAMES, TOOL_TYPES, isSoldierType, mapSizeTypeOf } from './definitions.ts';
import type { BuildingTypeId, GoodType, MapSizeType, ToolType } from './definitions.ts';
import type { Command } from './commands.ts';
import type { ObservedBuilding, Observation, OwnBuilding } from './vision.ts';

/** How often a built-in bot looks at the game and decides (2 seconds). */
export const BOT_DECISION_TICKS = 20;
/** Construction sites a bot keeps open at once. */
const PARALLEL_SITES = 3;
const MIN_FREE_CARRIERS = 4;
/** Below this much stored stone, without a working stonecutter, the bot saves stone for getting more. */
const STONE_RESERVE = 8;
const TICKS_PER_MINUTE = 600;
/** A squad attacking a building: three per defender inside, plus these. */
const SQUAD_EXTRA = 4;
const SCOUTS = 3;

/** How a built-in bot plays. Calm follows the original game's computer players, which build for a long time before attacking. */
export const BOT_TYPES = ['calm', 'aggressive'] as const;
export type BotType = (typeof BOT_TYPES)[number];

export interface BotTypeSettings {
  label: string;
  /** No attacks or scouting before this game minute, per map size. */
  firstAttackMinutes: Record<MapSizeType, number>;
  /** Soldiers outside buildings needed before an attack. */
  attackArmy: number;
  /** The castle becomes a target once the army has this many soldiers and this minute has passed. */
  castleArmy: number;
  castleMinutes: Record<MapSizeType, number>;
  /** Sends the whole free army at once; otherwise a squad sized to the target, and a small scouting party. */
  isSendingWholeArmy: boolean;
}

export const BOT_TYPE_SETTINGS: Record<BotType, BotTypeSettings> = {
  calm: {
    label: 'Calm', firstAttackMinutes: { small: 20, medium: 45, large: 60 }, attackArmy: 10,
    castleArmy: 20, castleMinutes: { small: 35, medium: 75, large: 95 }, isSendingWholeArmy: false
  },
  aggressive: {
    label: 'Aggressive', firstAttackMinutes: { small: 0, medium: 0, large: 0 }, attackArmy: 6,
    castleArmy: 12, castleMinutes: { small: 0, medium: 0, large: 0 }, isSendingWholeArmy: true
  }
};

/** One line of what a bot decided and why; collected for tests and for tuning. */
export interface BotLogEntry {
  tick: number;
  playerId: number;
  text: string;
}

/** What a spot should be close to when the bot picks where to build. */
export type SpotNeed = 'trees' | 'rocks' | 'water' | 'deposit_coal' | 'deposit_iron' | 'free_land' | 'castle' | 'border' | 'ore' | 'distant_rocks';

/**
 * The bot's only access to the map besides its observation: finding a valid spot on its own land,
 * scored by what it can see there. The match supplies it; it never reveals hidden land.
 */
export interface BotSpotFinder {
  findSpot(typeId: BuildingTypeId, need: SpotNeed, towardX: number): { x: number; y: number } | null;
  /** Whether the bot's settlers can walk from the castle to this tile (or next to it). */
  canReach(x: number, y: number): boolean;
  /** The explored, walkable tile closest to the given side of the map, for scouting with the army. */
  frontTile(towardX: number): { x: number; y: number } | null;
}

/**
 * The bot's build order, inspired by how The Settlers III computer players grow: building materials first,
 * then food, then mining, metal and weapons. A type listed n times means "have n of these by now".
 */
const BUILD_PLAN: readonly BuildingTypeId[] = [
  'woodcutter', 'stonecutter', 'sawmill', 'forester', 'woodcutter', 'stonecutter',
  'farm', 'waterworks', 'mill', 'bakery', 'fisher',
  'coal_mine', 'iron_mine', 'smelter', 'pig_farm', 'slaughterhouse',
  'weaponsmith', 'barracks', 'toolsmith', 'storage',
  'woodcutter', 'forester', 'coal_mine', 'farm', 'bakery', 'mill', 'fisher', 'iron_mine', 'coal_mine',
  'weaponsmith', 'sawmill', 'farm', 'stonecutter'
];

const NEEDS: Partial<Record<BuildingTypeId, SpotNeed>> = {
  woodcutter: 'trees', forester: 'trees', stonecutter: 'rocks', waterworks: 'water', fisher: 'water',
  coal_mine: 'deposit_coal', iron_mine: 'deposit_iron', farm: 'free_land', pig_farm: 'free_land'
};

/** A building may only be added once the ones that feed it exist (ratios as in a balanced settlement). */
function isUseful(typeId: BuildingTypeId, count: (t: BuildingTypeId) => number): boolean {
  switch (typeId) {
    case 'sawmill': return count('woodcutter') >= count('sawmill') + 1;
    case 'mill': case 'pig_farm': return count('farm') > count('mill') + count('pig_farm') - 1;
    case 'bakery': return count('mill') > count('bakery') && count('waterworks') > 0;
    case 'slaughterhouse': return count('pig_farm') > count('slaughterhouse');
    case 'iron_mine': return count('coal_mine') > count('iron_mine');
    case 'smelter': return count('iron_mine') > count('smelter') && count('coal_mine') > 0;
    case 'weaponsmith': case 'toolsmith': return count('smelter') > 0;
    case 'barracks': return count('weaponsmith') > count('barracks');
    default: return true;
  }
}

/** Workplaces whose resource is gone for good; the bot clears them, as the manual advises players to. */
const EXHAUSTED_REASONS = ['The deposit is used up', 'No rocks nearby'];

export function decideBot(obs: Observation, spots: BotSpotFinder, log?: (text: string) => void): Command[] {
  const commands: Command[] = [];
  const note = log ?? (() => {});
  const me = obs.playerId;
  const settings = BOT_TYPE_SETTINGS[obs.player.botType];
  const castle = obs.ownBuildings.find((b) => b.typeId === 'castle');
  if (!castle) return commands;
  const count = (t: BuildingTypeId) => obs.ownBuildings.filter((b) => b.typeId === t).length;
  const storedGood = (good: GoodType) => obs.ownBuildings.reduce((sum, b) => sum + (BUILDING_TYPES[b.typeId].storageCapacity > 0 ? b.stock[good] : 0), 0);
  const stored = (good: ToolType) => obs.ownBuildings.reduce((sum, b) => sum + (BUILDING_TYPES[b.typeId].storageCapacity > 0 ? b.stock[good] : 0), 0);
  const hasToolFor = (t: BuildingTypeId) => {
    const tool = BUILDING_TYPES[t].tool;
    return !tool || stored(tool) > 0 || count('toolsmith') > 0 && obs.ownBuildings.some((b) => b.typeId === 'toolsmith' && b.isComplete);
  };

  for (const b of obs.ownBuildings) {
    if (b.blockedReason && EXHAUSTED_REASONS.includes(b.blockedReason)) {
      commands.push({ type: 'demolishBuilding', playerId: me, buildingId: b.id });
      note(`demolish ${b.typeId} #${b.id}: ${b.blockedReason}`);
    }
  }
  const sites = obs.ownBuildings.filter((b) => !b.isComplete);
  // The enemy is somewhere on the far side of the map until the bot sees it.
  const towardX = castle.x < obs.width / 2 ? obs.width : 0;

  // Materials not yet promised to a site; a new site must be covered by them, or it would wait forever.
  const spare = (good: 'plank' | 'stone') => storedGood(good) - sites.reduce((sum, b) => sum + b.materialsOwed[good], 0);
  const place = (typeId: BuildingTypeId, need: SpotNeed): boolean => {
    const cost = BUILDING_TYPES[typeId].cost;
    if ((cost.plank ?? 0) > spare('plank') || (cost.stone ?? 0) > spare('stone')) return false;
    const spot = spots.findSpot(typeId, need, towardX);
    if (!spot) return false;
    commands.push({ type: 'placeBuilding', playerId: me, buildingType: typeId, x: spot.x, y: spot.y });
    note(`place ${typeId} at ${spot.x},${spot.y} (${need})`);
    return true;
  };

  // 1. Build: at most a few sites at once; settlers, then land, then the economy plan.
  const workingStonecutters = obs.ownBuildings.filter((b) => b.typeId === 'stonecutter' && b.isComplete && b.blockedReason === null).length;
  const isStoneShort = storedGood('stone') < STONE_RESERVE && workingStonecutters === 0;
  // A tower still being built or still without a soldier has not claimed its land yet.
  const isTowerComing = obs.ownBuildings.some((b) => b.typeId !== 'castle' && BUILDING_TYPES[b.typeId].territoryRadius > 0
    && (!b.isComplete || b.garrisonCount === 0));
  if (isStoneShort && sites.length <= PARALLEL_SITES) {
    // Low on stone with no stonecutter at work: the remaining stone goes to a stonecutter, or a tower toward rocks.
    const isDone = sites.some((b) => b.typeId === 'stonecutter') || place('stonecutter', 'rocks')
      || (!isTowerComing && place('guard_tower_small', 'distant_rocks'));
    if (!isDone && obs.tick % (BOT_DECISION_TICKS * 15) === 0) note('short of stone and no rocks in reach');
  } else if (sites.length < PARALLEL_SITES) {
    const isBuildingResidence = sites.some((b) => BUILDING_TYPES[b.typeId].residents > 0);
    const towers = obs.ownBuildings.filter((b) => b.typeId === 'guard_tower_small' || b.typeId === 'guard_tower_large');
    const areTowersSettled = towers.every((b) => b.isComplete && b.garrisonCount > 0);
    let isDone = false;
    // Rocks about to run out on own land: claim land toward rocks before the stone is gone.
    if (workingStonecutters < 2 && !isTowerComing && !spots.findSpot('stonecutter', 'rocks', towardX)) {
      isDone = place('guard_tower_small', 'distant_rocks');
    }
    // Weapons waiting at the barracks need settlers to become soldiers.
    const isBarracksShort = obs.ownBuildings.some((b) => b.typeId === 'barracks' && b.blockedReason === 'Waiting for a free settler');
    if (!isDone && (obs.freeCarriers < MIN_FREE_CARRIERS || isBarracksShort) && !isBuildingResidence) isDone = place('residence_small', 'castle');
    if (!isDone && areTowersSettled && wantsMoreLand(obs, towers.length, spots)) {
      const tower = towers.length % 3 === 2 ? 'guard_tower_large' : 'guard_tower_small';
      // Without ore of its own, the bot expands toward the mountains it has seen.
      isDone = (!hasOre(obs, spots) && place(tower, 'ore')) || place(tower, 'border');
    }
    if (!isDone) {
      const planned = new Map<BuildingTypeId, number>();
      for (const typeId of BUILD_PLAN) {
        planned.set(typeId, (planned.get(typeId) ?? 0) + 1);
        if (count(typeId) >= planned.get(typeId)! || !isUseful(typeId, count) || !hasToolFor(typeId)) continue;
        if (place(typeId, NEEDS[typeId] ?? 'castle')) break;
      }
    }
  }

  // 2. Tools: order the one a finished workplace is missing.
  for (const b of obs.ownBuildings) {
    const tool = missingTool(b);
    if (tool && (obs.player.productionOrders[tool] ?? 0) === 0) {
      commands.push({ type: 'setProductionOrder', playerId: me, good: tool, count: 1 });
      note(`order ${tool} for ${b.typeId} #${b.id}`);
    }
  }

  // 3. Army. Intruders on own land are driven out at once, whatever the bot type.
  let free = obs.ownSoldiers.filter((s) => s.phase === 'idle' || s.phase === 'moving');
  const intruders = obs.otherSoldiers.filter((s) => isOnOwnLand(obs, s.x, s.y));
  if (intruders.length > 0 && free.length > 0) {
    const target = intruders[0];
    const defenders = nearest(free, target.x, target.y, Math.max(3, intruders.length * 2));
    commands.push({ type: 'moveSoldiers', playerId: me, soldierIds: defenders.map((s) => s.id), x: Math.round(target.x), y: Math.round(target.y) });
    note(`defend: ${defenders.length} soldiers against ${intruders.length} intruders at ${Math.round(target.x)},${Math.round(target.y)}`);
    const sent = new Set(defenders.map((s) => s.id));
    free = free.filter((s) => !sent.has(s.id));
  }

  // Then attack the nearest weakly held building in sight once the army is big enough; otherwise gather at the front.
  const mapSize = mapSizeTypeOf(obs.width);
  const mayAttack = obs.tick >= settings.firstAttackMinutes[mapSize] * TICKS_PER_MINUTE;
  const attacking = obs.ownSoldiers.filter((s) => s.phase === 'attacking').length;
  const army = free.length + attacking;
  const mayTakeCastle = army >= settings.castleArmy && obs.tick >= settings.castleMinutes[mapSize] * TICKS_PER_MINUTE;
  const targets = obs.otherBuildings.filter((b) => b.isComplete && BUILDING_TYPES[b.typeId].garrisonCapacity > 0 && spots.canReach(b.doorX, b.doorY)
    && (b.typeId !== 'castle' || mayTakeCastle || obs.otherBuildings.every((o) => o.typeId === 'castle' || BUILDING_TYPES[o.typeId].garrisonCapacity === 0)));
  if (mayAttack && targets.length > 0 && army >= settings.attackArmy && free.length > 0) {
    const cx = free.reduce((sum, s) => sum + s.x, 0) / free.length;
    const cy = free.reduce((sum, s) => sum + s.y, 0) / free.length;
    // Near and weakly held first; a large army goes for the castle to end the match.
    const cost = (t: (typeof targets)[number]) => Math.hypot(t.doorX - cx, t.doorY - cy) + t.garrisonCount * 6
      - (t.typeId === 'castle' && mayTakeCastle ? 40 : 0);
    targets.sort((a, b) => cost(a) - cost(b) || a.id - b.id);
    const target = targets[0];
    const squad = settings.isSendingWholeArmy ? free : nearest(free, target.doorX, target.doorY, target.garrisonCount * 3 + SQUAD_EXTRA);
    const isAlreadyAttacked = !settings.isSendingWholeArmy && attacking >= target.garrisonCount * 3 + SQUAD_EXTRA;
    if (!isAlreadyAttacked) {
      commands.push({ type: 'attackBuilding', playerId: me, soldierIds: squad.map((s) => s.id), buildingId: target.id });
      note(`attack ${target.typeId} #${target.id} with ${squad.length} (army ${army})`);
    }
  } else if (mayAttack && targets.length === 0 && free.length >= settings.attackArmy * 2 && obs.tick % (BOT_DECISION_TICKS * 5) === 0) {
    // A big army that sees nothing to attack advances into the unknown, toward the enemy side.
    const front = spots.frontTile(towardX);
    if (front) {
      const party = settings.isSendingWholeArmy ? free : nearest(free, front.x, front.y, SCOUTS);
      commands.push({ type: 'moveSoldiers', playerId: me, soldierIds: party.map((s) => s.id), x: front.x, y: front.y });
      note(`scout toward ${front.x},${front.y} with ${party.length}`);
    }
  } else if (free.length >= 3 && obs.tick % (BOT_DECISION_TICKS * 15) === 0) {
    // An aggressive bot gathers at its front tower; a calm one at home, so its army does not provoke a border battle.
    const front = !settings.isSendingWholeArmy ? castle : obs.ownBuildings
      .filter((b) => b.isComplete && BUILDING_TYPES[b.typeId].garrisonCapacity > 0)
      .sort((a, b) => Math.abs(a.doorX - towardX) - Math.abs(b.doorX - towardX))[0];
    if (front) commands.push({ type: 'moveSoldiers', playerId: me, soldierIds: free.map((s) => s.id), x: front.doorX, y: front.doorY + 2 });
  }
  return commands;
}

function nearest<T extends { id: number; x: number; y: number }>(soldiers: readonly T[], x: number, y: number, n: number): T[] {
  const d = (s: T) => Math.hypot(s.x - x, s.y - y);
  return [...soldiers].sort((a, b) => d(a) - d(b) || a.id - b.id).slice(0, n);
}

/**
 * Inside the land the bot's own military buildings claim. The observation has no territory map, so this applies the
 * territory rule (the nearest claiming building wins) to its own buildings and the enemy buildings it can see.
 */
function isOnOwnLand(obs: Observation, x: number, y: number): boolean {
  const claim = (b: ObservedBuilding) => {
    const radius = BUILDING_TYPES[b.typeId].territoryRadius;
    if (radius === 0 || !b.isComplete || (b.typeId !== 'castle' && b.garrisonCount === 0)) return Infinity;
    const d = Math.hypot(x - (b.x + b.size / 2), y - (b.y + b.size / 2));
    return d <= radius ? d : Infinity;
  };
  const own = Math.min(...obs.ownBuildings.map(claim));
  return own < Infinity && own < Math.min(Infinity, ...obs.otherBuildings.map(claim));
}

function missingTool(b: OwnBuilding): ToolType | null {
  if (!b.blockedReason?.startsWith('Missing tool: ')) return null;
  const name = b.blockedReason.slice('Missing tool: '.length);
  return TOOL_TYPES.find((t) => GOOD_NAMES[t][0] === name) ?? null;
}

function hasOre(obs: Observation, spots: BotSpotFinder): boolean {
  const has = (t: BuildingTypeId) => obs.ownBuildings.some((b) => b.typeId === t);
  return (has('coal_mine') || !!spots.findSpot('coal_mine', 'deposit_coal', 0))
    && (has('iron_mine') || !!spots.findSpot('iron_mine', 'deposit_iron', 0));
}

/** More land when there is no ore to mine, or regularly to push toward the enemy. */
function wantsMoreLand(obs: Observation, towers: number, spots: BotSpotFinder): boolean {
  if (towers < 2) return true;
  if (!hasOre(obs, spots)) return true;
  const soldiers = obs.ownSoldiers.filter((s) => isSoldierType(s.settlerType)).length;
  return towers < 3 + Math.floor(obs.tick / 6000) && soldiers > towers;
}
