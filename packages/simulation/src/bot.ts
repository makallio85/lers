import { BUILDING_TYPES, GOOD_NAMES, TOOL_TYPES, isSoldierType } from './definitions.ts';
import type { BuildingTypeId, ToolType } from './definitions.ts';
import type { Command } from './commands.ts';
import type { Observation, OwnBuilding } from './vision.ts';

/** How often a built-in bot looks at the game and decides (2 seconds). */
export const BOT_DECISION_TICKS = 20;
/** Construction sites a bot keeps open at once. */
const PARALLEL_SITES = 3;
const MIN_FREE_CARRIERS = 4;
const ATTACK_ARMY = 6;

/** What a spot should be close to when the bot picks where to build. */
export type SpotNeed = 'trees' | 'rocks' | 'water' | 'deposit_coal' | 'deposit_iron' | 'free_land' | 'castle' | 'border' | 'ore';

/**
 * The bot's only access to the map besides its observation: finding a valid spot on its own land,
 * scored by what it can see there. The match supplies it; it never reveals hidden land.
 */
export interface BotSpotFinder {
  findSpot(typeId: BuildingTypeId, need: SpotNeed, towardX: number): { x: number; y: number } | null;
  /** The explored, walkable tile closest to the given side of the map, for scouting with the army. */
  frontTile(towardX: number): { x: number; y: number } | null;
}

/**
 * The bot's build order, inspired by how The Settlers III computer players grow: building materials first,
 * then food, then mining, metal and weapons. A type listed n times means "have n of these by now".
 */
const BUILD_PLAN: readonly BuildingTypeId[] = [
  'woodcutter', 'stonecutter', 'sawmill', 'forester', 'woodcutter',
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

export function decideBot(obs: Observation, spots: BotSpotFinder): Command[] {
  const commands: Command[] = [];
  const me = obs.playerId;
  const castle = obs.ownBuildings.find((b) => b.typeId === 'castle');
  if (!castle) return commands;
  const count = (t: BuildingTypeId) => obs.ownBuildings.filter((b) => b.typeId === t).length;
  const stored = (good: ToolType) => obs.ownBuildings.reduce((sum, b) => sum + (BUILDING_TYPES[b.typeId].storageCapacity > 0 ? b.stock[good] : 0), 0);
  const hasToolFor = (t: BuildingTypeId) => {
    const tool = BUILDING_TYPES[t].tool;
    return !tool || stored(tool) > 0 || count('toolsmith') > 0 && obs.ownBuildings.some((b) => b.typeId === 'toolsmith' && b.isComplete);
  };

  for (const b of obs.ownBuildings) {
    if (b.blockedReason && EXHAUSTED_REASONS.includes(b.blockedReason)) {
      commands.push({ type: 'demolishBuilding', playerId: me, buildingId: b.id });
    }
  }
  const sites = obs.ownBuildings.filter((b) => !b.isComplete);
  // The enemy is somewhere on the far side of the map until the bot sees it.
  const towardX = castle.x < obs.width / 2 ? obs.width : 0;

  const place = (typeId: BuildingTypeId, need: SpotNeed): boolean => {
    const spot = spots.findSpot(typeId, need, towardX);
    if (!spot) return false;
    commands.push({ type: 'placeBuilding', playerId: me, buildingType: typeId, x: spot.x, y: spot.y });
    return true;
  };

  // 1. Build: at most a few sites at once; settlers, then land, then the economy plan.
  if (sites.length < PARALLEL_SITES) {
    const isBuildingResidence = sites.some((b) => BUILDING_TYPES[b.typeId].residents > 0);
    const towers = obs.ownBuildings.filter((b) => b.typeId === 'guard_tower_small' || b.typeId === 'guard_tower_large');
    const areTowersSettled = towers.every((b) => b.isComplete && b.garrisonCount > 0);
    let isDone = false;
    if (obs.freeCarriers < MIN_FREE_CARRIERS && !isBuildingResidence) isDone = place('residence_small', 'castle');
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
    }
  }

  // 3. Army: attack the nearest enemy tower or castle in sight once the army is big enough; otherwise gather at the front.
  const free = obs.ownSoldiers.filter((s) => s.phase === 'idle' || s.phase === 'moving');
  const targets = obs.otherBuildings.filter((b) => b.isComplete && BUILDING_TYPES[b.typeId].garrisonCapacity > 0);
  const attacking = obs.ownSoldiers.filter((s) => s.phase === 'attacking').length;
  if (targets.length > 0 && free.length + attacking >= ATTACK_ARMY && free.length > 0) {
    const cx = free.reduce((sum, s) => sum + s.x, 0) / free.length;
    const cy = free.reduce((sum, s) => sum + s.y, 0) / free.length;
    // Near and weakly held first; a large army goes for the castle to end the match.
    const army = free.length + attacking;
    const cost = (t: (typeof targets)[number]) => Math.hypot(t.doorX - cx, t.doorY - cy) + t.garrisonCount * 6
      - (t.typeId === 'castle' && army >= 12 ? 40 : 0);
    targets.sort((a, b) => cost(a) - cost(b) || a.id - b.id);
    commands.push({ type: 'attackBuilding', playerId: me, soldierIds: free.map((s) => s.id), buildingId: targets[0].id });
  } else if (targets.length === 0 && free.length >= ATTACK_ARMY * 2 && obs.tick % (BOT_DECISION_TICKS * 5) === 0) {
    // A big army that sees nothing to attack advances into the unknown, toward the enemy side.
    const front = spots.frontTile(towardX);
    if (front) commands.push({ type: 'moveSoldiers', playerId: me, soldierIds: free.map((s) => s.id), x: front.x, y: front.y });
  } else if (free.length >= 3 && obs.tick % (BOT_DECISION_TICKS * 15) === 0) {
    const front = obs.ownBuildings
      .filter((b) => b.isComplete && BUILDING_TYPES[b.typeId].garrisonCapacity > 0)
      .sort((a, b) => Math.abs(a.doorX - towardX) - Math.abs(b.doorX - towardX))[0];
    if (front) commands.push({ type: 'moveSoldiers', playerId: me, soldierIds: free.map((s) => s.id), x: front.doorX, y: front.doorY + 2 });
  }
  return commands;
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
