import { BOARDING_RANGE, BUILDING_TYPES, GOOD_NAMES, GOOD_TYPES, TRANSPORT_CAPACITY, PROMOTION_COSTS, RACE_SPELLS, SOLDIER_TYPES, SPELL_RANGE, SPELL_STATS, TOOL_TYPES, WAR_MACHINE_STATS, WEAPON_TYPES, buildingCost, isBuildableBy, isSoldierType, isUnitType, isWarMachineType, mapSizeTypeOf } from './definitions.ts';
import type { BuildingTypeId, GoodType, MapSizeType, SettlerType, SpellType, ToolType } from './definitions.ts';
import { DEFAULT_MAX_CREW_PERCENT } from './world.ts';
import type { Command } from './commands.ts';
import type { ObservedBuilding, ObservedSoldier, Observation, OwnBuilding } from './vision.ts';

/** How often a built-in bot looks at the game and decides (2 seconds). */
export const BOT_DECISION_TICKS = 20;
const MIN_FREE_CARRIERS = 4;
/** Below this much stored stone, without a working stonecutter, the bot saves stone for getting more. */
const STONE_RESERVE = 8;
const TICKS_PER_MINUTE = 600;
const SCOUTS = 3;
/** Room a storage area should still have; with less in all of them the bot builds another, up to this many. */
const STORAGE_ROOM = 8;
const MAX_STORAGE_AREAS = 3;
/**
 * What the bot keeps in storage: building materials and valuables. Everything else (raw goods, food, drinks)
 * waits at its workplace until a workshop, mine or temple needs it, so storage keeps room for stone.
 */
const STORED_GOODS: readonly GoodType[] = ['plank', 'stone', 'gold', 'gems', 'gunpowder', ...TOOL_TYPES, ...WEAPON_TYPES];
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

/**
 * How well a built-in bot plays, apart from its style. All levels play by the same rules and see only what
 * their people see; an easier bot thinks less often, builds fewer sites at once, attacks later and with
 * smaller squads.
 */
export const BOT_DIFFICULTY_TYPES = ['easy', 'normal', 'hard'] as const;
export type BotDifficultyType = (typeof BOT_DIFFICULTY_TYPES)[number];

export interface BotDifficultySettings {
  label: string;
  summary: string;
  /** Decides on every n-th decision turn. */
  decisionEvery: number;
  /** Construction sites kept open at once. */
  parallelSites: number;
  /** First attack and castle attack: the style's minutes times this, plus `attackExtraMinutes`. */
  attackFactor: number;
  attackExtraMinutes: number;
  /** A squad attacking a building: three per defender inside, plus these. */
  squadExtra: number;
}

export const BOT_DIFFICULTY_SETTINGS: Record<BotDifficultyType, BotDifficultySettings> = {
  easy: { label: 'Easy', summary: 'Builds slowly, attacks late with small squads', decisionEvery: 2, parallelSites: 2, attackFactor: 1.5, attackExtraMinutes: 15, squadExtra: 2 },
  normal: { label: 'Normal', summary: 'The usual computer player', decisionEvery: 1, parallelSites: 3, attackFactor: 1, attackExtraMinutes: 0, squadExtra: 4 },
  hard: { label: 'Hard', summary: 'Builds more at once, attacks sooner with bigger squads', decisionEvery: 1, parallelSites: 4, attackFactor: 0.8, attackExtraMinutes: 0, squadExtra: 6 }
};

/** One line of what a bot decided and why; collected for tests and for tuning. */
export interface BotLogEntry {
  tick: number;
  playerId: number;
  text: string;
}

/** What a spot should be close to when the bot picks where to build. */
export type SpotNeed = 'trees' | 'rocks' | 'water' | 'deposit_coal' | 'deposit_iron' | 'deposit_gold' | 'free_land' | 'castle' | 'border' | 'ore' | 'distant_rocks' | 'shore';

/**
 * The bot's only access to the map besides its observation: finding a valid spot on its own land,
 * scored by what it can see there. The match supplies it; it never reveals hidden land.
 */
export interface BotSpotFinder {
  findSpot(typeId: BuildingTypeId, need: SpotNeed, toward: { x: number; y: number }): { x: number; y: number } | null;
  /** Where the enemy lies: with two players the far side of the map, with more the nearest enemy castle's start. */
  towardEnemy(): { x: number; y: number };
  /** A seen mountain tile its geologists have not marked yet, own land first. */
  prospectTile(): { x: number; y: number } | null;
  /** Whether the bot's settlers can walk from the castle (or from a given point) to this tile, or next to it. */
  canReach(x: number, y: number, from?: { x: number; y: number }): boolean;
  /** Land of the castle's own island where soldiers can wait to board a ship lying here, or null. */
  boardingTile(shipX: number, shipY: number): { x: number; y: number } | null;
  /**
   * Where a ship sails next on the water it is on. Loaded: a seen shore of another island on the enemy side
   * (isLanding), or else the seen water farthest that way, to look further. Empty: the home shore nearest the castle.
   */
  sailTarget(shipX: number, shipY: number, toward: { x: number; y: number }, isLoaded: boolean): { x: number; y: number; isLanding: boolean } | null;
  /** Whether a war machine standing here can roll to open ground within `range` tiles of a point. */
  canFireAt(fromX: number, fromY: number, x: number, y: number, range: number): boolean;
  /** The explored tile closest to the given side of the map that the castle's settlers (or those at a point) can walk to, for scouting with the army. */
  frontTile(toward: { x: number; y: number }, from?: { x: number; y: number }): { x: number; y: number } | null;
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

/** What turns iron into soldiers; the bot makes room for these when its land is full. */
const ARMY_BUILDINGS: readonly BuildingTypeId[] = ['smelter', 'weaponsmith', 'barracks', 'toolsmith'];

/**
 * A building the bot can do without, to make room: a spare storage area, a residence while carriers are plenty,
 * or a second workplace of a kind that stands idle with a full pile.
 */
function sparableBuilding(obs: Observation, count: (t: BuildingTypeId) => number): OwnBuilding | undefined {
  const done = obs.ownBuildings.filter((b) => b.isComplete);
  const idle = (b: OwnBuilding) => b.blockedReason === 'Output full: goods wait until needed';
  return done.find((b) => b.typeId === 'storage' && count('storage') > 1)
    ?? (obs.freeCarriers > 12 ? done.find((b) => BUILDING_TYPES[b.typeId].residents > 0 && b.residentsLeft === 0) : undefined)
    ?? done.find((b) => idle(b) && count(b.typeId) > 1 && ['sawmill', 'stonecutter', 'woodcutter', 'fisher', 'farm', 'mill', 'bakery', 'coal_mine'].includes(b.typeId));
}

/** Buildings each tool must be saved for until they stand: without them the settlement cannot make more tools. */
const KEY_TOOL_USERS: Partial<Record<ToolType, readonly BuildingTypeId[]>> = {
  pick: ['coal_mine', 'iron_mine'], axe: ['slaughterhouse'], hammer: ['shipyard', 'toolsmith', 'weaponsmith'], saw: ['sawmill'], scythe: ['farm'], rod: ['fisher']
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

/** How far behind the army an idle priest follows, and how often the bot reconsiders magic. */
const PRIEST_FOLLOW_DISTANCE = 3;

/**
 * The computer's priests. Fights come first: Shield or Fury on own soldiers fighting near a priest, Freeze or
 * Persuade on enemies there. With all ranks bought, spare manna goes to Harvest at home, Blight on enemy mines
 * in sight and Far sight toward the enemy. Idle priests follow the army.
 */
function decideSpells(obs: Observation, castle: OwnBuilding, toward: { x: number; y: number }, turn: number, note: (text: string) => void): Command[] {
  const me = obs.playerId;
  const priests = obs.ownSpecialists.filter((s) => s.settlerType === 'priest');
  if (priests.length === 0) return [];
  const known = RACE_SPELLS[obs.player.raceType];
  let manna = obs.player.manna;
  const commands: Command[] = [];
  const cast = (priest: ObservedSoldier, spell: SpellType, x: number, y: number) => {
    commands.push({ type: 'castSpell', playerId: me, priestId: priest.id, spell, x: Math.round(x), y: Math.round(y) });
    manna -= SPELL_STATS[spell].cost;
    note(`cast ${spell} at ${Math.round(x)},${Math.round(y)}`);
  };
  const can = (spell: SpellType) => known.includes(spell) && manna >= SPELL_STATS[spell].cost;
  const soldiers = obs.ownSoldiers.filter((s) => isSoldierType(s.settlerType) && s.phase !== 'inside');
  const near = (list: readonly ObservedSoldier[], x: number, y: number, r: number) => list.filter((s) => Math.hypot(s.x - x, s.y - y) <= r);
  for (const priest of priests.filter((p) => p.isReady)) {
    // Enemies close to the priest: hold them or win them over, then strengthen own soldiers there.
    const enemies = near(obs.enemySoldiers.filter((s) => isSoldierType(s.settlerType)), priest.x, priest.y, SPELL_RANGE);
    if (enemies.length > 0) {
      const cx = enemies.reduce((sum, s) => sum + s.x, 0) / enemies.length, cy = enemies.reduce((sum, s) => sum + s.y, 0) / enemies.length;
      const friends = near(soldiers, cx, cy, SPELL_STATS.shield.radius);
      if (enemies.length >= 3 && can('persuade')) { cast(priest, 'persuade', cx, cy); continue; }
      if (enemies.length >= 2 && can('freeze')) { cast(priest, 'freeze', cx, cy); continue; }
      if (friends.length >= 2 && can('fury')) { cast(priest, 'fury', cx, cy); continue; }
      if (friends.length >= 2 && can('shield')) { cast(priest, 'shield', cx, cy); continue; }
    }
  }
  if (commands.length > 0) return commands;
  // Peace: only once every soldier type is a captain does manna go to the economy and scouting.
  const isRanked = SOLDIER_TYPES.every((t) => obs.player.soldierRanks[t] >= PROMOTION_COSTS.length);
  const ready = priests.find((p) => p.isReady);
  if (isRanked && ready && turn % 6 === 0) {
    const mine = obs.enemyBuildings.find((b) => BUILDING_TYPES[b.typeId].mine);
    const farm = obs.ownBuildings.find((b) => b.typeId === 'farm' && b.isComplete);
    if (mine && can('blight')) cast(ready, 'blight', mine.doorX, mine.doorY);
    else if (farm && can('harvest') && Math.hypot(farm.doorX - ready.x, farm.doorY - ready.y) <= SPELL_RANGE) cast(ready, 'harvest', farm.doorX, farm.doorY);
    else if (obs.enemyBuildings.length === 0 && can('far_sight')) {
      // Look 20 tiles short of where the enemy lies, inside the map.
      const d = Math.hypot(toward.x - castle.doorX, toward.y - castle.doorY) || 1, back = Math.min(20, d);
      cast(ready, 'far_sight', Math.max(0, Math.min(obs.width - 1, toward.x - ((toward.x - castle.doorX) / d) * back)),
        Math.max(0, Math.min(obs.height - 1, toward.y - ((toward.y - castle.doorY) / d) * back)));
    }
  }
  // Idle priests walk to the army, a little behind it, so they are at hand when it fights.
  const army = soldiers.filter((s) => s.phase === 'attacking' || s.phase === 'moving' || s.phase === 'defending');
  const idle = priests.filter((p) => p.phase === 'idle');
  if (idle.length > 0 && turn % 4 === 0) {
    const group = army.length > 0 ? army : soldiers;
    if (group.length > 0) {
      const gx = group.reduce((sum, s) => sum + s.x, 0) / group.length, gy = group.reduce((sum, s) => sum + s.y, 0) / group.length;
      const dx = castle.doorX - gx, dy = castle.doorY - gy, d = Math.hypot(dx, dy) || 1;
      const tx = Math.round(gx + (dx / d) * PRIEST_FOLLOW_DISTANCE), ty = Math.round(gy + (dy / d) * PRIEST_FOLLOW_DISTANCE);
      const far = idle.filter((p) => Math.hypot(p.x - tx, p.y - ty) > 4);
      if (far.length > 0) commands.push({ type: 'moveSpecialists', playerId: me, settlerIds: far.map((p) => p.id), x: tx, y: ty });
    }
  }
  return commands;
}

/** Workplaces whose resource is gone for good; the bot clears them, as the manual advises players to. */
const EXHAUSTED_REASONS = ['The deposit is used up', 'No rocks nearby'];

export function decideBot(obs: Observation, spots: BotSpotFinder, log?: (text: string) => void): Command[] {
  const commands: Command[] = [];
  const note = log ?? (() => {});
  const me = obs.playerId;
  const settings = BOT_TYPE_SETTINGS[obs.player.botType];
  const level = BOT_DIFFICULTY_SETTINGS[obs.player.difficultyType];
  const PARALLEL_SITES = level.parallelSites;
  // Which decision this is; periodic actions count decisions, so bots on staggered ticks still run them.
  const turn = Math.floor(obs.tick / BOT_DECISION_TICKS);
  const castle = obs.ownBuildings.find((b) => b.typeId === 'castle');
  if (!castle) return commands;
  const count = (t: BuildingTypeId) => obs.ownBuildings.filter((b) => b.typeId === t).length;
  // On an islands map the enemy lives across the sea: the army needs a shipyard and a transport ship.
  const isIslands = obs.mapLayout === 'islands';
  // What can be fetched: storage, and finished goods waiting at workplaces (towers hold none).
  const canSupply = (b: OwnBuilding) => BUILDING_TYPES[b.typeId].storageCapacity > 0 || BUILDING_TYPES[b.typeId].garrisonCapacity === 0;
  const storedGood = (good: GoodType) => obs.ownBuildings.reduce((sum, b) => sum + (canSupply(b) ? b.stock[good] : 0), 0);
  const stored = (good: ToolType) => obs.ownBuildings.reduce((sum, b) => sum + (canSupply(b) ? b.stock[good] : 0), 0);
  // Keep back one of each tool for every key building that still has to come, so extra gatherers do not
  // take the picks the mines need (and with them the iron that would make new tools).
  // Key buildings themselves need just one tool in storage.
  const reserveOf = (tool: ToolType, forType: BuildingTypeId) => (KEY_TOOL_USERS[tool] ?? []).includes(forType) ? 0
    : (KEY_TOOL_USERS[tool] ?? []).filter((k) => count(k) === 0 && isBuildableBy(k, obs.player.raceType) && (k !== 'shipyard' || isIslands)).length;
  const hasToolFor = (t: BuildingTypeId) => {
    const tool = BUILDING_TYPES[t].tool;
    if (!tool) return true;
    const hasToolsmith = obs.ownBuildings.some((b) => b.typeId === 'toolsmith' && b.isComplete);
    return stored(tool) > reserveOf(tool, t) || hasToolsmith;
  };

  // Crews keep their tools for good, so hammers for the smiths still to come are kept from new builders: while
  // they are short, the bot makes no new crew (as a player would by lowering the share).
  const civilians = Object.entries(obs.settlerCounts).reduce((n, [t, k]) => n + (isUnitType(t as SettlerType) ? 0 : k ?? 0), 0);
  const crewNow = (obs.settlerCounts.digger ?? 0) + (obs.settlerCounts.builder ?? 0);
  const smithsToCome = (KEY_TOOL_USERS.hammer ?? []).filter((k) => count(k) === 0 && isBuildableBy(k, obs.player.raceType) && (k !== 'shipyard' || isIslands)).length;
  const crewShare = stored('hammer') <= smithsToCome && civilians > 0 ? Math.min(DEFAULT_MAX_CREW_PERCENT, Math.floor((crewNow * 100) / civilians)) : DEFAULT_MAX_CREW_PERCENT;
  if (obs.player.maxCrewPercent !== crewShare) {
    commands.push({ type: 'setOccupations', playerId: me, minCarrierPercent: obs.player.minCarrierPercent, maxCrewPercent: crewShare });
  }
  // Only materials and valuables go to storage; the rest waits at its workplace until needed.
  for (const good of GOOD_TYPES) {
    const isWanted = STORED_GOODS.includes(good);
    if (obs.player.isStored[good] !== isWanted) commands.push({ type: 'setGoodStored', playerId: me, good, isStored: isWanted });
  }
  // A mine waiting for its pick while a stonecutter stands idle with a full pile: the stonecutter's pick is worth
  // more in the mine, since the iron it brings makes new tools.
  const isMineShortOfPick = obs.ownBuildings.some((b) => (b.typeId === 'iron_mine' || b.typeId === 'coal_mine') && b.blockedReason === 'Missing tool: pick');
  const idleCutter = obs.ownBuildings.find((b) => b.typeId === 'stonecutter' && b.blockedReason === 'Output full: goods wait until needed');
  if (isMineShortOfPick && idleCutter && stored('pick') === 0 && storedGood('stone') >= STONE_RESERVE * 2) {
    commands.push({ type: 'demolishBuilding', playerId: me, buildingId: idleCutter.id });
    note(`demolish stonecutter #${idleCutter.id}: its pick goes to a mine`);
  }
  for (const b of obs.ownBuildings) {
    if (b.blockedReason && EXHAUSTED_REASONS.includes(b.blockedReason)) {
      commands.push({ type: 'demolishBuilding', playerId: me, buildingId: b.id });
      note(`demolish ${b.typeId} #${b.id}: ${b.blockedReason}`);
    }
  }
  const sites = obs.ownBuildings.filter((b) => !b.isComplete);
  // The enemy is somewhere on the far side of the map until the bot sees it.
  const toward = spots.towardEnemy();
  // How far along the line toward the enemy a point lies, from the castle.
  const ahead = (x: number, y: number) => {
    const d = Math.hypot(toward.x - castle.doorX, toward.y - castle.doorY) || 1;
    return ((x - castle.doorX) * (toward.x - castle.doorX) + (y - castle.doorY) * (toward.y - castle.doorY)) / d;
  };

  // Materials not yet promised to a site; a new site must be covered by them, or it would wait forever.
  const spare = (good: 'plank' | 'stone') => storedGood(good) - sites.reduce((sum, b) => sum + b.materialsOwed[good], 0);
  /** Planned buildings that found no room on the bot's land this turn. */
  const noRoomFor: BuildingTypeId[] = [];
  const place = (typeId: BuildingTypeId, need: SpotNeed): boolean => {
    const cost = buildingCost(typeId, obs.player.raceType);
    if ((cost.plank ?? 0) > spare('plank') || (cost.stone ?? 0) > spare('stone')) return false;
    const spot = spots.findSpot(typeId, need, toward);
    if (!spot) { noRoomFor.push(typeId); return false; }
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
    if (workingStonecutters < 2 && !isTowerComing && !spots.findSpot('stonecutter', 'rocks', toward)) {
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
    // Spare goods only go to storage areas: when workplaces wait with full piles and every storage area is
    // nearly full, another one comes, so production goes on.
    // Only goods it stores count: raw goods wait at their workplace on purpose.
    const isOutputWaiting = obs.ownBuildings.some((b) => b.blockedReason === 'Output full: goods wait until needed'
      && STORED_GOODS.some((g) => b.stock[g] > 0));
    const areas = obs.ownBuildings.filter((b) => b.typeId === 'storage');
    const hasStoreRoom = areas.some((b) => !b.isComplete
      || GOOD_TYPES.reduce((sum, g) => sum + b.stock[g], 0) < BUILDING_TYPES.storage.storageCapacity - STORAGE_ROOM);
    if (!isDone && isOutputWaiting && !hasStoreRoom && areas.length < MAX_STORAGE_AREAS) {
      isDone = place('storage', 'castle');
      if (isDone) note('storage areas full');
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
    // On islands the shipyard comes early, right after the first sawmill: while the coast is still free and a
    // starting hammer is in stock. Later the shore fills up with other buildings and the hammers go to smiths.
    if (!isDone && isIslands && count('shipyard') === 0 && count('sawmill') > 0) {
      if (hasToolFor('shipyard')) isDone = place('shipyard', 'shore');
      else if ((obs.player.productionOrders.hammer ?? 0) === 0 && turn % 10 === 0) {
        commands.push({ type: 'setProductionOrder', playerId: me, good: 'hammer', count: 1 });
        note('order hammer for shipyard');
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
    // Land full (an island taken up, or no soldier free to man a new tower): without room for the smiths and the
    // barracks that make soldiers, the bot would stand still for good. It clears a building it can spare.
    const blocksArmy = noRoomFor.some((t) => ARMY_BUILDINGS.includes(t) && count(t) === 0);
    if (!isDone && sites.length === 0 && blocksArmy) {
      const spare = sparableBuilding(obs, count);
      if (spare) {
        commands.push({ type: 'demolishBuilding', playerId: me, buildingId: spare.id });
        note(`demolish ${spare.typeId} #${spare.id}: room for ${noRoomFor.filter((t) => ARMY_BUILDINGS.includes(t)).join(', ')}`);
      }
    }
  }

  // 2. Geologists: keep two (a carrier converts with no tool), and send idle ones to mountains nobody has marked yet.
  const geologists = obs.ownSpecialists.filter((s) => s.settlerType === 'geologist');
  if (geologists.length < GEOLOGISTS && obs.freeCarriers > MIN_FREE_CARRIERS && turn % 10 === 0) {
    commands.push({ type: 'setSpecialists', playerId: me, specialistType: 'geologist', count: GEOLOGISTS });
  }
  const idleGeologists = geologists.filter((s) => s.phase === 'idle');
  if (idleGeologists.length > 0 && turn % 5 === 0) {
    const tile = spots.prospectTile();
    if (tile) {
      commands.push({ type: 'moveSpecialists', playerId: me, settlerIds: idleGeologists.map((s) => s.id), x: tile.x, y: tile.y, isWorking: true });
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

  // 4. Priests and promotions. In a fight near a priest, manna goes to spells first; otherwise into ranks.
  const spells = decideSpells(obs, castle, toward, turn, note);
  commands.push(...spells);
  for (const soldierType of spells.length > 0 ? [] : SOLDIER_TYPES) {
    const rank = obs.player.soldierRanks[soldierType];
    if (rank < PROMOTION_COSTS.length && obs.player.manna >= PROMOTION_COSTS[rank]) {
      commands.push({ type: 'promoteSoldiers', playerId: me, soldierType });
      note(`promote ${soldierType} to rank ${rank + 1}`);
      break;
    }
  }

  // 5. Army. Intruders on own land are driven out at once, whatever the bot type.
  const machines = obs.ownSoldiers.filter((s) => isWarMachineType(s.settlerType));
  // Soldiers already fighting are left to it: a move order would pull them out of the fight.
  const onField = obs.ownSoldiers.filter((s) => isSoldierType(s.settlerType) && (s.phase === 'idle' || s.phase === 'moving') && !s.isFighting);
  // On islands, soldiers on the castle's island defend it and wait for the ship; those landed elsewhere fight there.
  const isAtHome = (s: ObservedSoldier) => !isIslands || spots.canReach(Math.round(s.x), Math.round(s.y));
  let free = onField.filter(isAtHome);
  const landed = onField.filter((s) => !isAtHome(s));
  const intruders = obs.enemySoldiers.filter((s) => isOnOwnLand(obs, s.x, s.y));
  if (intruders.length > 0 && free.length > 0) {
    const target = intruders[0];
    const defenders = nearest(free, target.x, target.y, Math.max(3, intruders.length * 2));
    commands.push({ type: 'moveSoldiers', playerId: me, soldierIds: defenders.map((s) => s.id), x: Math.round(target.x), y: Math.round(target.y) });
    note(`defend: ${defenders.length} soldiers against ${intruders.length} intruders at ${Math.round(target.x)},${Math.round(target.y)}`);
    const sent = new Set(defenders.map((s) => s.id));
    free = free.filter((s) => !sent.has(s.id));
  }

  // Home soldiers left after defending: on islands they wait for the ship, and the landed army is the one that attacks.
  const waiting = isIslands ? free : [];
  if (isIslands) free = landed;
  const from = isIslands && landed.length > 0 ? { x: Math.round(landed[0].x), y: Math.round(landed[0].y) } : undefined;

  // Then attack the nearest weakly held building in sight once the army is big enough; otherwise gather at the front.
  const mapSize = mapSizeTypeOf(obs.width);
  // In the economic mode soldiers are too weak away from home to win anything there: the bot only defends.
  const mayAttack = obs.victoryType !== 'economy' && obs.tick >= (settings.firstAttackMinutes[mapSize] * level.attackFactor + level.attackExtraMinutes) * TICKS_PER_MINUTE;
  const attacking = obs.ownSoldiers.filter((s) => isSoldierType(s.settlerType) && s.phase === 'attacking').length;
  const army = free.length + attacking;
  const mayTakeCastle = army >= settings.castleArmy && obs.tick >= (settings.castleMinutes[mapSize] * level.attackFactor + level.attackExtraMinutes) * TICKS_PER_MINUTE;
  // A building another visible tower of its owner covers cannot be taken yet; attacking it still thins out
  // its defenders, so it is a target, but a later one.
  const isCovered = (t: ObservedBuilding) => obs.enemyBuildings.some((o) => o.id !== t.id && o.owner === t.owner && o.isComplete
    && (o.typeId === 'castle' || o.garrisonCount > 0) && BUILDING_TYPES[o.typeId].territoryRadius > 0
    && Math.hypot(o.x + o.size / 2 - (t.x + t.size / 2), o.y + o.size / 2 - (t.y + t.size / 2)) <= BUILDING_TYPES[o.typeId].territoryRadius);
  const targets = obs.enemyBuildings.filter((b) => b.isComplete && BUILDING_TYPES[b.typeId].garrisonCapacity > 0 && spots.canReach(b.doorX, b.doorY, from)
    && (b.typeId !== 'castle' || mayTakeCastle || obs.enemyBuildings.every((o) => o.typeId === 'castle' || BUILDING_TYPES[o.typeId].garrisonCapacity === 0)));
  // A landed army attacks whatever it has; it cannot wait for reinforcements the way a home army can.
  if (mayAttack && targets.length > 0 && (army >= settings.attackArmy || landed.length > 0) && free.length > 0) {
    const cx = free.reduce((sum, s) => sum + s.x, 0) / free.length;
    const cy = free.reduce((sum, s) => sum + s.y, 0) / free.length;
    // Near and weakly held first; a large army goes for the castle to end the match.
    const cost = (t: (typeof targets)[number]) => Math.hypot(t.doorX - cx, t.doorY - cy) + t.garrisonCount * 6 + (isCovered(t) ? 30 : 0)
      - (t.typeId === 'castle' && mayTakeCastle ? 40 : 0);
    targets.sort((a, b) => cost(a) - cost(b) || a.id - b.id);
    const target = targets[0];
    // Once the castle may be taken, a calm bot commits its whole army too, so long matches reach an end.
    const isAllIn = settings.isSendingWholeArmy || mayTakeCastle;
    const squad = isAllIn ? free : nearest(free, target.doorX, target.doorY, target.garrisonCount * 3 + level.squadExtra);
    const isAlreadyAttacked = !isAllIn && attacking >= target.garrisonCount * 3 + level.squadExtra;
    if (!isAlreadyAttacked) {
      commands.push({ type: 'attackBuilding', playerId: me, soldierIds: squad.map((s) => s.id), buildingId: target.id });
      note(`attack ${target.typeId} #${target.id} with ${squad.length} (army ${army})`);
    }
  } else if (mayAttack && targets.length === 0 && (free.length >= settings.attackArmy * 2 || landed.length > 0) && turn % 5 === 0) {
    // A big army that sees nothing to attack advances into the unknown, toward the enemy side; so does a landed one.
    const front = spots.frontTile(toward, from);
    if (front) {
      const party = settings.isSendingWholeArmy ? free : nearest(free, front.x, front.y, SCOUTS);
      commands.push({ type: 'moveSoldiers', playerId: me, soldierIds: party.map((s) => s.id), x: front.x, y: front.y });
      note(`scout toward ${front.x},${front.y} with ${party.length}`);
    }
  } else if (!isIslands && free.length >= 3 && turn % 15 === 0) {
    // An aggressive bot gathers at its front tower; a calm one at home, so its army does not provoke a border battle.
    const front = !settings.isSendingWholeArmy ? castle : obs.ownBuildings
      .filter((b) => b.isComplete && BUILDING_TYPES[b.typeId].garrisonCapacity > 0)
      .sort((a, b) => ahead(b.doorX, b.doorY) - ahead(a.doorX, a.doorY))[0];
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
  commands.push(...decideFerry(obs, spots, waiting, mayAttack, toward, turn, note));
  return commands;
}

/**
 * The transport ship on an islands map. At the home shore it takes soldiers aboard until it holds an attack's worth,
 * sails toward the enemy side (looking further while no enemy shore is in sight), puts them ashore, and comes back.
 */
function decideFerry(obs: Observation, spots: BotSpotFinder, waiting: readonly ObservedSoldier[], mayAttack: boolean, toward: { x: number; y: number },
  turn: number, note: (text: string) => void): Command[] {
  const me = obs.playerId;
  const commands: Command[] = [];
  if (obs.mapLayout !== 'islands') return commands;
  const ship = obs.ownSoldiers.find((s) => s.settlerType === 'transport_ship');
  const shipyard = obs.ownBuildings.find((b) => b.typeId === 'shipyard' && b.isComplete);
  if (!ship) {
    if (shipyard && turn % 20 === 0) {
      commands.push({ type: 'setShipOrder', playerId: me, buildingId: shipyard.id, shipType: 'transport_ship', count: 1 });
      note('order a transport ship');
    }
    return commands;
  }
  if (ship.phase !== 'idle' || turn % 2 !== 0) return commands;
  const aboard = obs.ownSoldiers.filter((s) => s.shipId === ship.id);
  const capacity = TRANSPORT_CAPACITY[obs.player.raceType];
  const wanted = Math.min(capacity, BOT_TYPE_SETTINGS[obs.player.botType].attackArmy);
  const sail = (isLoaded: boolean) => {
    const target = spots.sailTarget(ship.x, ship.y, toward, isLoaded);
    if (!target) return;
    if (isLoaded && target.isLanding && Math.hypot(target.x - ship.x, target.y - ship.y) <= 1.5) {
      commands.push({ type: 'unloadShip', playerId: me, shipId: ship.id });
      note(`land ${aboard.length} at ${Math.round(ship.x)},${Math.round(ship.y)}`);
    } else if (Math.hypot(target.x - ship.x, target.y - ship.y) > 1.5) {
      commands.push({ type: 'moveSoldiers', playerId: me, soldierIds: [ship.id], x: target.x, y: target.y });
      note(`sail ${isLoaded ? `with ${aboard.length}` : 'home'} to ${target.x},${target.y}${target.isLanding ? '' : ' (looking)'}`);
    }
  };
  const shore = spots.boardingTile(ship.x, ship.y);
  if (!shore) { sail(aboard.length > 0); return commands; }
  // At the home shore: board who is close, call the rest, and sail once an attack's worth is aboard.
  if (!mayAttack) return commands;
  const close = waiting.filter((s) => Math.hypot(s.x - ship.x, s.y - ship.y) <= BOARDING_RANGE + 0.5).slice(0, capacity - aboard.length);
  if (close.length > 0) commands.push({ type: 'boardShip', playerId: me, shipId: ship.id, unitIds: close.map((s) => s.id) });
  const loaded = aboard.length + close.length;
  if (loaded >= wanted || (loaded > 0 && waiting.length === close.length)) {
    if (close.length === 0) sail(true);
    return commands;
  }
  const boarded = new Set(close.map((s) => s.id));
  const called = nearest(waiting.filter((s) => !boarded.has(s.id) && s.phase === 'idle'), ship.x, ship.y, capacity - loaded);
  if (called.length > 0 && waiting.length + aboard.length >= wanted) {
    commands.push({ type: 'moveSoldiers', playerId: me, soldierIds: called.map((s) => s.id), x: shore.x, y: shore.y });
    note(`call ${called.length} to the ship`);
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
  return own < Infinity && own < Math.min(Infinity, ...obs.enemyBuildings.map(claim), ...obs.allyBuildings.map(claim));
}

function missingTool(b: OwnBuilding): ToolType | null {
  if (!b.blockedReason?.startsWith('Missing tool: ')) return null;
  const name = b.blockedReason.slice('Missing tool: '.length);
  return TOOL_TYPES.find((t) => GOOD_NAMES[t][0] === name) ?? null;
}

function hasOre(obs: Observation, spots: BotSpotFinder): boolean {
  const has = (t: BuildingTypeId) => obs.ownBuildings.some((b) => b.typeId === t);
  return (has('coal_mine') || !!spots.findSpot('coal_mine', 'deposit_coal', { x: 0, y: 0 }))
    && (has('iron_mine') || !!spots.findSpot('iron_mine', 'deposit_iron', { x: 0, y: 0 }));
}

/** More land when there is no ore to mine, or regularly to push toward the enemy. */
function wantsMoreLand(obs: Observation, towers: number, spots: BotSpotFinder): boolean {
  if (towers < 2) return true;
  if (!hasOre(obs, spots)) return true;
  const soldiers = obs.ownSoldiers.filter((s) => isSoldierType(s.settlerType)).length;
  return towers < 3 + Math.floor(obs.tick / 6000) && soldiers > towers;
}
