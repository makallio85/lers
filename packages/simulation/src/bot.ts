import { BUILDING_TYPES, GOOD_NAMES, PROMOTION_COSTS, SOLDIER_TYPES, TOOL_TYPES, WAR_MACHINE_STATS, buildingCost, isBuildableBy, isSoldierType, isWarMachineType, mapSizeTypeOf } from './definitions.ts';
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
const GEOLOGISTS = 2;

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
export type SpotNeed = 'trees' | 'rocks' | 'water' | 'deposit_coal' | 'deposit_iron' | 'deposit_gold' | 'free_land' | 'castle' | 'border' | 'ore' | 'distant_rocks';

/**
 * The bot's only access to the map besides its observation: finding a valid spot on its own land,
 * scored by what it can see there. The match supplies it; it never reveals hidden land.
 */
export interface BotSpotFinder {
  findSpot(typeId: BuildingTypeId, need: SpotNeed, towardX: number): { x: number; y: number } | null;
  /** A seen mountain tile its geologists have not marked yet, own land first. */
  prospectTile(): { x: number; y: number } | null;
  /** Whether the bot's settlers can walk from the castle to this tile (or next to it). */
  canReach(x: number, y: number): boolean;
  /** Whether a war machine standing here can roll to open ground within `range` tiles of a point. */
  canFireAt(fromX: number, fromY: number, x: number, y: number, range: number): boolean;
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
  'weaponsmith', 'barracks', 'toolsmith', 'storage', 'gold_mine', 'gold_smelter', 'healer',
  // Each people's war machine hall (only its own is built), and the Asians' gunpowder for the cannon.
  'catapult_hall', 'ballista_hall', 'cannon_hall', 'gunpowder_maker', 'gong_hall',
  // Each people's drink, the small temple that turns it into manna for promotions, and later the large temple.
  'winery', 'brewery', 'rice_farm', 'distillery', 'beekeeper', 'mead_maker', 'small_temple',
  'woodcutter', 'forester', 'coal_mine', 'farm', 'bakery', 'mill', 'fisher', 'iron_mine', 'coal_mine',
  'weaponsmith', 'sawmill', 'farm', 'stonecutter', 'large_temple'
];

/** Buildings each tool must be saved for until they stand: without them the settlement cannot make more tools. */
const KEY_TOOL_USERS: Partial<Record<ToolType, readonly BuildingTypeId[]>> = {
  pick: ['coal_mine', 'iron_mine'], axe: ['slaughterhouse'], hammer: ['toolsmith', 'weaponsmith'], saw: ['sawmill'], scythe: ['farm'], rod: ['fisher']
};

const NEEDS: Partial<Record<BuildingTypeId, SpotNeed>> = {
  woodcutter: 'trees', forester: 'trees', stonecutter: 'rocks', waterworks: 'water', fisher: 'water',
  coal_mine: 'deposit_coal', iron_mine: 'deposit_iron', gold_mine: 'deposit_gold', farm: 'free_land', pig_farm: 'free_land',
  rice_farm: 'water', beekeeper: 'trees', winery: 'free_land'
};

/** Buildings that feed miners, in the order the bot adds them when mines go hungry. */
const FOOD_CHAIN: readonly BuildingTypeId[] = ['fisher', 'farm', 'mill', 'bakery', 'waterworks', 'pig_farm', 'slaughterhouse'];

/** A building may only be added once the ones that feed it exist (ratios as in a balanced settlement). */
function isUseful(typeId: BuildingTypeId, count: (t: BuildingTypeId) => number): boolean {
  switch (typeId) {
    case 'sawmill': return count('woodcutter') >= count('sawmill') + 1;
    case 'mill': case 'pig_farm': return count('farm') > count('mill') + count('pig_farm') - 1;
    case 'bakery': return count('mill') > count('bakery') && count('waterworks') > 0;
    case 'slaughterhouse': return count('pig_farm') > count('slaughterhouse');
    case 'iron_mine': return count('coal_mine') > count('iron_mine');
    case 'smelter': return count('iron_mine') > count('smelter') && count('coal_mine') > 0;
    case 'gold_smelter': return count('gold_mine') > count('gold_smelter') && count('coal_mine') > 1;
    case 'weaponsmith': case 'toolsmith': return count('smelter') > 0;
    case 'barracks': return count('weaponsmith') > count('barracks');
    case 'catapult_hall': case 'ballista_hall': case 'cannon_hall': case 'gong_hall': return count('barracks') > 0 && count('smelter') > 0;
    case 'gunpowder_maker': return count('cannon_hall') > 0;
    case 'winery': case 'brewery': case 'rice_farm': case 'beekeeper': return count('barracks') > 0;
    case 'distillery': return count('rice_farm') > 0;
    case 'mead_maker': return count('beekeeper') > 0;
    case 'small_temple': return count('winery') + count('brewery') + count('distillery') + count('mead_maker') > 0;
    case 'large_temple': return count('small_temple') > 0;
    default: return true;
  }
}

/** The bot builds its war machine hall from this minute of the match. */
const WAR_MACHINE_HALL_MINUTES = 40;

/** Workplaces whose resource is gone for good; the bot clears them, as the manual advises players to. */
const EXHAUSTED_REASONS = ['The deposit is used up', 'No rocks nearby'];

export function decideBot(obs: Observation, spots: BotSpotFinder, log?: (text: string) => void): Command[] {
  const commands: Command[] = [];
  const note = log ?? (() => {});
  const me = obs.playerId;
  const settings = BOT_TYPE_SETTINGS[obs.player.botType];
  // Which decision this is; periodic actions count decisions, so bots on staggered ticks still run them.
  const turn = Math.floor(obs.tick / BOT_DECISION_TICKS);
  const castle = obs.ownBuildings.find((b) => b.typeId === 'castle');
  if (!castle) return commands;
  const count = (t: BuildingTypeId) => obs.ownBuildings.filter((b) => b.typeId === t).length;
  const storedGood = (good: GoodType) => obs.ownBuildings.reduce((sum, b) => sum + (BUILDING_TYPES[b.typeId].storageCapacity > 0 ? b.stock[good] : 0), 0);
  const stored = (good: ToolType) => obs.ownBuildings.reduce((sum, b) => sum + (BUILDING_TYPES[b.typeId].storageCapacity > 0 ? b.stock[good] : 0), 0);
  // Keep back one of each tool for every key building that still has to come, so extra gatherers do not
  // take the picks the mines need (and with them the iron that would make new tools).
  // Key buildings themselves need just one tool in storage.
  const reserveOf = (tool: ToolType, forType: BuildingTypeId) => (KEY_TOOL_USERS[tool] ?? []).includes(forType) ? 0
    : (KEY_TOOL_USERS[tool] ?? []).filter((k) => count(k) === 0 && isBuildableBy(k, obs.player.raceType)).length;
  const hasToolFor = (t: BuildingTypeId) => {
    const tool = BUILDING_TYPES[t].tool;
    if (!tool) return true;
    const hasToolsmith = obs.ownBuildings.some((b) => b.typeId === 'toolsmith' && b.isComplete);
    return stored(tool) > reserveOf(tool, t) || hasToolsmith;
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
    const cost = buildingCost(typeId, obs.player.raceType);
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
    if (!isDone && turn % 15 === 0) note('short of stone and no rocks in reach');
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
    // Mines waiting for food get more of the food chain first, up to a few food buildings per mine.
    const hungryMines = obs.ownBuildings.filter((b) => BUILDING_TYPES[b.typeId].mine && b.blockedReason === 'Waiting: no food').length;
    const isFoodComing = sites.some((b) => FOOD_CHAIN.includes(b.typeId));
    const foodBuildings = obs.ownBuildings.filter((b) => FOOD_CHAIN.includes(b.typeId)).length;
    const mines = obs.ownBuildings.filter((b) => BUILDING_TYPES[b.typeId].mine).length;
    if (!isDone && hungryMines > 0 && !isFoodComing && foodBuildings < mines * 3 + 4) {
      for (const typeId of FOOD_CHAIN) {
        if (!isBuildableBy(typeId, obs.player.raceType) || !isUseful(typeId, count) || !hasToolFor(typeId)) continue;
        if (place(typeId, NEEDS[typeId] ?? 'castle')) { isDone = true; note(`feed ${hungryMines} hungry mines`); break; }
      }
    }
    if (!isDone) {
      const planned = new Map<BuildingTypeId, number>();
      for (const typeId of BUILD_PLAN) {
        planned.set(typeId, (planned.get(typeId) ?? 0) + 1);
        if (!isBuildableBy(typeId, obs.player.raceType) || count(typeId) >= planned.get(typeId)! || !isUseful(typeId, count) || !hasToolFor(typeId)) continue;
        // A hall without its machinist would only soak up the iron the smiths need: order a hammer and wait for it.
        // War machines are a late tool: before that, iron goes to weapons.
        if (BUILDING_TYPES[typeId].warMachine && obs.tick < WAR_MACHINE_HALL_MINUTES * TICKS_PER_MINUTE) continue;
        if (BUILDING_TYPES[typeId].warMachine && stored('hammer') === 0) {
          if ((obs.player.productionOrders.hammer ?? 0) === 0 && turn % 10 === 0) {
            commands.push({ type: 'setProductionOrder', playerId: me, good: 'hammer', count: 1 });
            note(`order hammer for ${typeId}`);
          }
          continue;
        }
        if (place(typeId, NEEDS[typeId] ?? 'castle')) break;
      }
    }
  }

  // 2. Geologists: keep two, and send idle ones to mountains nobody has marked yet.
  // Geologists carry a hammer. A toolsmith or machinist waiting for one gets a geologist's back (otherwise
  // no new hammers can ever be made), and new geologists are only taken on while hammers are spare.
  const geologists = obs.ownSpecialists.filter((s) => s.settlerType === 'geologist');
  const isHammerWanted = obs.ownBuildings.some((b) => b.isComplete && missingTool(b) === 'hammer');
  if (isHammerWanted && geologists.length > 0 && turn % 5 === 0) {
    commands.push({ type: 'setSpecialists', playerId: me, specialistType: 'geologist', count: geologists.length - 1 });
    note('a geologist gives back his hammer');
  } else if (!isHammerWanted && geologists.length < GEOLOGISTS && stored('hammer') > reserveOf('hammer', 'woodcutter') && turn % 10 === 0) {
    commands.push({ type: 'setSpecialists', playerId: me, specialistType: 'geologist', count: GEOLOGISTS });
  }
  const idleGeologists = geologists.filter((s) => s.phase === 'idle');
  if (idleGeologists.length > 0 && turn % 5 === 0) {
    const tile = spots.prospectTile();
    if (tile) {
      commands.push({ type: 'moveSpecialists', playerId: me, settlerIds: idleGeologists.map((s) => s.id), x: tile.x, y: tile.y });
      note(`prospect at ${tile.x},${tile.y} with ${idleGeologists.length}`);
    }
  }

  // 3. Tools: order the one a finished workplace is missing.
  for (const b of obs.ownBuildings) {
    const tool = missingTool(b);
    if (tool && (obs.player.productionOrders[tool] ?? 0) === 0) {
      commands.push({ type: 'setProductionOrder', playerId: me, good: tool, count: 1 });
      note(`order ${tool} for ${b.typeId} #${b.id}`);
    }
  }

  // 4. Promotions: manna goes into ranks, swordsmen first, one step per decision.
  for (const soldierType of SOLDIER_TYPES) {
    const rank = obs.player.soldierRanks[soldierType];
    if (rank < PROMOTION_COSTS.length && obs.player.manna >= PROMOTION_COSTS[rank]) {
      commands.push({ type: 'promoteSoldiers', playerId: me, soldierType });
      note(`promote ${soldierType} to rank ${rank + 1}`);
      break;
    }
  }

  // 5. Army. Intruders on own land are driven out at once, whatever the bot type.
  const machines = obs.ownSoldiers.filter((s) => isWarMachineType(s.settlerType));
  let free = obs.ownSoldiers.filter((s) => isSoldierType(s.settlerType) && (s.phase === 'idle' || s.phase === 'moving'));
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
  const attacking = obs.ownSoldiers.filter((s) => isSoldierType(s.settlerType) && s.phase === 'attacking').length;
  const army = free.length + attacking;
  const mayTakeCastle = army >= settings.castleArmy && obs.tick >= settings.castleMinutes[mapSize] * TICKS_PER_MINUTE;
  // A building another visible tower of its owner covers cannot be taken yet; attacking it still thins out
  // its defenders, so it is a target, but a later one.
  const isCovered = (t: ObservedBuilding) => obs.otherBuildings.some((o) => o.id !== t.id && o.owner === t.owner && o.isComplete
    && (o.typeId === 'castle' || o.garrisonCount > 0) && BUILDING_TYPES[o.typeId].territoryRadius > 0
    && Math.hypot(o.x + o.size / 2 - (t.x + t.size / 2), o.y + o.size / 2 - (t.y + t.size / 2)) <= BUILDING_TYPES[o.typeId].territoryRadius);
  const targets = obs.otherBuildings.filter((b) => b.isComplete && BUILDING_TYPES[b.typeId].garrisonCapacity > 0 && spots.canReach(b.doorX, b.doorY)
    && (b.typeId !== 'castle' || mayTakeCastle || obs.otherBuildings.every((o) => o.typeId === 'castle' || BUILDING_TYPES[o.typeId].garrisonCapacity === 0)));
  if (mayAttack && targets.length > 0 && army >= settings.attackArmy && free.length > 0) {
    const cx = free.reduce((sum, s) => sum + s.x, 0) / free.length;
    const cy = free.reduce((sum, s) => sum + s.y, 0) / free.length;
    // Near and weakly held first; a large army goes for the castle to end the match.
    const cost = (t: (typeof targets)[number]) => Math.hypot(t.doorX - cx, t.doorY - cy) + t.garrisonCount * 6 + (isCovered(t) ? 30 : 0)
      - (t.typeId === 'castle' && mayTakeCastle ? 40 : 0);
    targets.sort((a, b) => cost(a) - cost(b) || a.id - b.id);
    const target = targets[0];
    // Once the castle may be taken, a calm bot commits its whole army too, so long matches reach an end.
    const isAllIn = settings.isSendingWholeArmy || mayTakeCastle;
    const squad = isAllIn ? free : nearest(free, target.doorX, target.doorY, target.garrisonCount * 3 + SQUAD_EXTRA);
    const isAlreadyAttacked = !isAllIn && attacking >= target.garrisonCount * 3 + SQUAD_EXTRA;
    if (!isAlreadyAttacked) {
      commands.push({ type: 'attackBuilding', playerId: me, soldierIds: squad.map((s) => s.id), buildingId: target.id });
      note(`attack ${target.typeId} #${target.id} with ${squad.length} (army ${army})`);
    }
  } else if (mayAttack && targets.length === 0 && free.length >= settings.attackArmy * 2 && turn % 5 === 0) {
    // A big army that sees nothing to attack advances into the unknown, toward the enemy side.
    const front = spots.frontTile(towardX);
    if (front) {
      const party = settings.isSendingWholeArmy ? free : nearest(free, front.x, front.y, SCOUTS);
      commands.push({ type: 'moveSoldiers', playerId: me, soldierIds: party.map((s) => s.id), x: front.x, y: front.y });
      note(`scout toward ${front.x},${front.y} with ${party.length}`);
    }
  } else if (free.length >= 3 && turn % 15 === 0) {
    // An aggressive bot gathers at its front tower; a calm one at home, so its army does not provoke a border battle.
    const front = !settings.isSendingWholeArmy ? castle : obs.ownBuildings
      .filter((b) => b.isComplete && BUILDING_TYPES[b.typeId].garrisonCapacity > 0)
      .sort((a, b) => Math.abs(a.doorX - towardX) - Math.abs(b.doorX - towardX))[0];
    if (front) commands.push({ type: 'moveSoldiers', playerId: me, soldierIds: free.map((s) => s.id), x: front.doorX, y: front.doorY + 2 });
  }
  // War machines join once attacks are allowed: idle ones go for the most strongly held tower in reach,
  // which soldiers would find hardest, the castle only once it may be taken.
  const idleMachines = machines.filter((m) => m.phase === 'idle');
  const first = idleMachines[0];
  const range = first && isWarMachineType(first.settlerType) ? WAR_MACHINE_STATS[first.settlerType].range : 0;
  const machineTargets = !first ? [] : targets.filter((t) => (t.typeId !== 'castle' || mayTakeCastle)
    && spots.canFireAt(Math.round(first.x), Math.round(first.y), t.x + (t.size - 1) / 2, t.y + (t.size - 1) / 2, range));
  if (mayAttack && idleMachines.length > 0 && machineTargets.length > 0 && turn % 3 === 0) {
    const mx = first.x, my = first.y;
    machineTargets.sort((a, b) => (b.garrisonCount * 8 - Math.hypot(b.doorX - mx, b.doorY - my)) - (a.garrisonCount * 8 - Math.hypot(a.doorX - mx, a.doorY - my)) || a.id - b.id);
    commands.push({ type: 'attackBuilding', playerId: me, soldierIds: idleMachines.map((m) => m.id), buildingId: machineTargets[0].id });
    note(`machines: ${idleMachines.length} against ${machineTargets[0].typeId} #${machineTargets[0].id}`);
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
