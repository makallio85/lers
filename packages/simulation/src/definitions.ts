/** Static game data: goods, settler types, building types and their build menu groups. */

/** Gatherers whose work area the player can move; it must stay this close to the building. */
export const WORK_AREA_BUILDINGS = ['woodcutter', 'stonecutter', 'forester', 'fisher', 'farm', 'waterworks'] as const;
export const WORK_AREA_REACH = 22;
/** How far around its work area each gatherer works. */
export const WORK_AREA_RADIUS: Record<(typeof WORK_AREA_BUILDINGS)[number], number> = {
  woodcutter: 10, stonecutter: 10, forester: 6, fisher: 8, farm: 5, waterworks: 8
};

export const GOOD_TYPES = [
  'log', 'plank', 'stone',
  'grain', 'flour', 'water', 'bread', 'fish', 'pig', 'meat',
  'coal', 'iron_ore', 'iron', 'gold_ore', 'gold',
  'wine', 'beer', 'rice', 'rice_wine', 'honey', 'mead', 'sulfur', 'gems', 'gunpowder',
  'axe', 'saw', 'pick', 'scythe', 'shovel', 'hammer', 'rod',
  'sword', 'spear', 'bow'
] as const;
export type GoodType = (typeof GOOD_TYPES)[number];
export type GoodAmounts = Record<GoodType, number>;

export const TOOL_TYPES = ['axe', 'saw', 'pick', 'scythe', 'shovel', 'hammer', 'rod'] as const satisfies readonly GoodType[];
export type ToolType = (typeof TOOL_TYPES)[number];

export const WEAPON_TYPES = ['sword', 'spear', 'bow'] as const satisfies readonly GoodType[];
export type WeaponType = (typeof WEAPON_TYPES)[number];

/** Food a miner can eat. */
export const FOOD_TYPES = ['bread', 'fish', 'meat', 'rice', 'honey'] as const satisfies readonly GoodType[];
export type FoodType = (typeof FOOD_TYPES)[number];

/** Lower-case singular and plural names, for "2 planks", "Missing tool: saw". */
export const GOOD_NAMES: Record<GoodType, readonly [string, string]> = {
  log: ['log', 'logs'], plank: ['plank', 'planks'], stone: ['stone', 'stone'],
  grain: ['grain', 'grain'], flour: ['flour', 'flour'], water: ['water', 'water'], bread: ['bread', 'bread'],
  fish: ['fish', 'fish'], pig: ['pig', 'pigs'], meat: ['meat', 'meat'],
  coal: ['coal', 'coal'], iron_ore: ['iron ore', 'iron ore'], iron: ['iron bar', 'iron bars'],
  gold_ore: ['gold ore', 'gold ore'], gold: ['gold bar', 'gold bars'],
  wine: ['wine', 'wine'], beer: ['beer', 'beer'], rice: ['rice', 'rice'], rice_wine: ['rice wine', 'rice wine'], honey: ['honey', 'honey'],
  mead: ['mead', 'mead'], sulfur: ['sulfur', 'sulfur'], gems: ['gem', 'gems'], gunpowder: ['gunpowder', 'gunpowder'],
  axe: ['axe', 'axes'], saw: ['saw', 'saws'], pick: ['pick', 'picks'], scythe: ['scythe', 'scythes'],
  shovel: ['shovel', 'shovels'], hammer: ['hammer', 'hammers'], rod: ['fishing rod', 'fishing rods'],
  sword: ['sword', 'swords'], spear: ['spear', 'spears'], bow: ['bow', 'bows']
};

/** Title-case labels for lists and the goods bar. */
export const GOOD_LABELS: Record<GoodType, string> = {
  log: 'Logs', plank: 'Planks', stone: 'Stone',
  grain: 'Grain', flour: 'Flour', water: 'Water', bread: 'Bread', fish: 'Fish', pig: 'Pigs', meat: 'Meat',
  coal: 'Coal', iron_ore: 'Iron ore', iron: 'Iron', gold_ore: 'Gold ore', gold: 'Gold',
  wine: 'Wine', beer: 'Beer', rice: 'Rice', rice_wine: 'Rice wine', honey: 'Honey', mead: 'Mead', sulfur: 'Sulfur', gems: 'Gems', gunpowder: 'Gunpowder',
  axe: 'Axes', saw: 'Saws', pick: 'Picks', scythe: 'Scythes', shovel: 'Shovels', hammer: 'Hammers', rod: 'Fishing rods',
  sword: 'Swords', spear: 'Spears', bow: 'Bows'
};

export function goodCount(good: GoodType, count: number): string {
  return `${count} ${GOOD_NAMES[good][count === 1 ? 0 : 1]}`;
}

export function emptyGoods(): GoodAmounts {
  const amounts = {} as GoodAmounts;
  for (const good of GOOD_TYPES) amounts[good] = 0;
  return amounts;
}

export function totalGoods(amounts: GoodAmounts): number {
  let total = 0;
  for (const good of GOOD_TYPES) total += amounts[good];
  return total;
}

export const SOLDIER_TYPES = ['swordsman', 'spearman', 'bowman'] as const;
export type SoldierType = (typeof SOLDIER_TYPES)[number];

/** War machines are units like soldiers: selected, moved and given orders, but they fire at buildings, not people. */
export const WAR_MACHINE_TYPES = ['catapult', 'ballista', 'cannon', 'war_gong'] as const;
export type WarMachineType = (typeof WAR_MACHINE_TYPES)[number];

/** Ships sail the sea: transport ships carry soldiers and specialists, trade ships carry goods. */
export const SHIP_TYPES = ['transport_ship', 'trade_ship'] as const;
export type ShipType = (typeof SHIP_TYPES)[number];

export type SettlerType =
  | 'carrier' | 'digger' | 'builder' | SoldierType | WarMachineType | ShipType | 'machinist' | 'temple_servant' | 'priest' | 'breeder' | 'donkey' | 'shipbuilder'
  | 'woodcutter' | 'forester' | 'carpenter' | 'stonecutter'
  | 'farmer' | 'miller' | 'baker' | 'waterworker' | 'fisher' | 'pig_farmer' | 'butcher'
  | 'miner' | 'smelter' | 'smith' | 'healer'
  | 'wine_grower' | 'charcoal_maker' | 'brewer' | 'rice_farmer' | 'distiller' | 'gunpowder_maker' | 'beekeeper' | 'mead_maker' | 'alchemist'
  | SpecialistType;

/** Settlers the player makes from free carriers in the Settlers tab and sends out by hand. */
export const SPECIALIST_TYPES = ['geologist', 'pioneer', 'thief'] as const;
export type SpecialistType = (typeof SPECIALIST_TYPES)[number];
/** The tool a carrier takes from storage to become each specialist (none for a thief); it goes back when the specialist does. */
/** Specialists are converted from carriers without a tool, as in The Settlers III. */
export const SPECIALIST_TOOLS: Record<SpecialistType, ToolType | null> = { geologist: null, pioneer: null, thief: null };
/** A thief can take this many hits; soldiers who come close see through the disguise. */
export const THIEF_HEALTH = 30;

export function isShipType(type: SettlerType): type is ShipType {
  return (SHIP_TYPES as readonly string[]).includes(type);
}

export function isWarMachineType(type: SettlerType): type is WarMachineType {
  return (WAR_MACHINE_TYPES as readonly string[]).includes(type);
}

/** Units are what a player selects and moves on the map in groups: soldiers and war machines. */
export function isUnitType(type: SettlerType): type is SoldierType | WarMachineType | ShipType {
  return isSoldierType(type) || isWarMachineType(type) || isShipType(type);
}

export function isSpecialistType(type: SettlerType): type is SpecialistType {
  return (SPECIALIST_TYPES as readonly string[]).includes(type);
}

export const SETTLER_LABELS: Record<SettlerType, string> = {
  carrier: 'Carrier', digger: 'Digger', builder: 'Builder',
  swordsman: 'Swordsman', spearman: 'Spearman', bowman: 'Bowman',
  woodcutter: 'Woodcutter', forester: 'Forester', carpenter: 'Carpenter', stonecutter: 'Stonecutter',
  farmer: 'Farmer', miller: 'Miller', baker: 'Baker', waterworker: 'Waterworker', fisher: 'Fisher',
  pig_farmer: 'Pig farmer', butcher: 'Butcher', miner: 'Miner', smelter: 'Smelter', smith: 'Smith',
  healer: 'Healer', geologist: 'Geologist', pioneer: 'Pioneer', thief: 'Thief',
  wine_grower: 'Wine grower', charcoal_maker: 'Charcoal maker', brewer: 'Brewer', rice_farmer: 'Rice farmer', distiller: 'Distiller',
  gunpowder_maker: 'Gunpowder maker', beekeeper: 'Beekeeper', mead_maker: 'Mead maker', alchemist: 'Alchemist',
  machinist: 'Machinist', catapult: 'Catapult', ballista: 'Ballista', cannon: 'Cannon', war_gong: 'War gong',
  temple_servant: 'Temple servant', priest: 'Priest', breeder: 'Breeder', donkey: 'Donkey',
  transport_ship: 'Transport ship', trade_ship: 'Trade ship', shipbuilder: 'Shipbuilder'
};

export const SETTLER_PLURALS: Record<SettlerType, string> = {
  carrier: 'Carriers', digger: 'Diggers', builder: 'Builders',
  swordsman: 'Swordsmen', spearman: 'Spearmen', bowman: 'Bowmen',
  woodcutter: 'Woodcutters', forester: 'Foresters', carpenter: 'Carpenters', stonecutter: 'Stonecutters',
  farmer: 'Farmers', miller: 'Millers', baker: 'Bakers', waterworker: 'Waterworkers', fisher: 'Fishers',
  pig_farmer: 'Pig farmers', butcher: 'Butchers', miner: 'Miners', smelter: 'Smelters', smith: 'Smiths',
  healer: 'Healers', geologist: 'Geologists', pioneer: 'Pioneers', thief: 'Thieves',
  wine_grower: 'Wine growers', charcoal_maker: 'Charcoal makers', brewer: 'Brewers', rice_farmer: 'Rice farmers', distiller: 'Distillers',
  gunpowder_maker: 'Gunpowder makers', beekeeper: 'Beekeepers', mead_maker: 'Mead makers', alchemist: 'Alchemists',
  machinist: 'Machinists', catapult: 'Catapults', ballista: 'Ballistas', cannon: 'Cannons', war_gong: 'War gongs',
  temple_servant: 'Temple servants', priest: 'Priests', breeder: 'Breeders', donkey: 'Donkeys',
  transport_ship: 'Transport ships', trade_ship: 'Trade ships', shipbuilder: 'Shipbuilders'
};

export function isSoldierType(type: SettlerType): type is SoldierType {
  return (SOLDIER_TYPES as readonly string[]).includes(type);
}

export interface SoldierStats {
  health: number;
  damage: number;
  /** Reach in tiles. */
  range: number;
  /** Ticks between blows or shots. */
  cooldown: number;
  weapon: WeaponType;
}

/** Swordsmen hit hardest, spearmen last longest and reach further, bowmen shoot from behind. */
export const SOLDIER_STATS: Record<SoldierType, SoldierStats> = {
  swordsman: { health: 100, damage: 16, range: 1.5, cooldown: 10, weapon: 'sword' },
  spearman: { health: 130, damage: 11, range: 2, cooldown: 10, weapon: 'spear' },
  bowman: { health: 70, damage: 9, range: 6, cooldown: 14, weapon: 'bow' }
};

export const WEAPON_SOLDIERS: Record<WeaponType, SoldierType> = { sword: 'swordsman', spear: 'spearman', bow: 'bowman' };

export interface WarMachineStats {
  /** The hall that builds and reloads it. */
  hall: BuildingTypeId;
  /** Goods one machine is built from. */
  parts: Partial<GoodAmounts>;
  /** The good one shot uses, and how many shots it holds. */
  ammo: GoodType;
  shots: number;
  /** Reach in tiles, damage per hit and the share of shots that hit. */
  range: number;
  damage: number;
  accuracy: number;
  /** Ticks between shots. */
  cooldown: number;
  health: number;
  /** Ticks the machinist needs to build one. */
  buildTicks: number;
}

/**
 * One war machine per people, in the original's roles: the catapult misses most, the ballista reaches
 * furthest, the cannon hits hardest per shot, and the gong brings down a tower with one blow. Numbers are Lers' own.
 */
export const WAR_MACHINE_STATS: Record<WarMachineType, WarMachineStats> = {
  catapult: { hall: 'catapult_hall', parts: { iron: 2, plank: 3, stone: 2 }, ammo: 'stone', shots: 6, range: 7, damage: 40, accuracy: 0.55, cooldown: 50, health: 120, buildTicks: 1500 },
  ballista: { hall: 'ballista_hall', parts: { iron: 2, plank: 3, stone: 2 }, ammo: 'plank', shots: 6, range: 9, damage: 40, accuracy: 0.7, cooldown: 45, health: 100, buildTicks: 1500 },
  cannon: { hall: 'cannon_hall', parts: { iron: 3, coal: 2 }, ammo: 'gunpowder', shots: 4, range: 8, damage: 65, accuracy: 0.8, cooldown: 70, health: 140, buildTicks: 1500 },
  war_gong: { hall: 'gong_hall', parts: { iron: 2, plank: 2, gold: 1 }, ammo: 'gold', shots: 2, range: 5, damage: 130, accuracy: 0.9, cooldown: 120, health: 90, buildTicks: 1800 }
};
/** A hall keeps at most this many of its machines in the field. */
export const WAR_MACHINES_PER_HALL = 3;
/** War machines are slower than people. */
export const WAR_MACHINE_SPEED_SHARE = 0.6;
/** How much battering a building takes before war machines bring it down. Only military buildings can be shot at. */
export const BUILDING_STRUCTURE: Partial<Record<BuildingTypeId, number>> = {
  guard_tower_small: 120, lookout: 80, guard_tower_large: 240, castle: 480
};

/**
 * On their own land soldiers always fight at full strength. Outside it, as in the original game, strength
 * depends on the gold bars the player has in storage: this share with none, full strength from this many bars.
 */
export const OUTSIDE_MIN_STRENGTH = 0.6;
export const GOLD_FOR_FULL_STRENGTH = 20;
/** A healer's hut heals the owner's soldiers within this many tiles who are not fighting. */
export const HEAL_RADIUS = 8;
export const HEAL_PER_ROUND = 4;

export type BuildingGroupType = 'resources' | 'food' | 'military' | 'misc';

export const BUILDING_GROUP_TYPES: readonly { id: BuildingGroupType; label: string; key: string }[] = [
  { id: 'resources', label: 'Resources', key: 'q' },
  { id: 'food', label: 'Food', key: 'w' },
  { id: 'military', label: 'Military', key: 'e' },
  { id: 'misc', label: 'Misc.', key: 'r' }
];

export type BuildingTypeId =
  | 'woodcutter' | 'forester' | 'sawmill' | 'stonecutter'
  | 'coal_mine' | 'iron_mine' | 'gold_mine' | 'gem_mine' | 'sulfur_mine' | 'smelter' | 'gold_smelter' | 'toolsmith' | 'charcoal_maker' | 'alchemist'
  | 'farm' | 'mill' | 'bakery' | 'waterworks' | 'fisher' | 'pig_farm' | 'slaughterhouse' | 'donkey_ranch'
  | 'winery' | 'brewery' | 'rice_farm' | 'distillery' | 'beekeeper' | 'mead_maker'
  | 'guard_tower_small' | 'guard_tower_large' | 'castle' | 'lookout' | 'barracks' | 'weaponsmith' | 'gunpowder_maker'
  | 'catapult_hall' | 'ballista_hall' | 'cannon_hall' | 'gong_hall' | 'small_temple' | 'large_temple' | 'shipyard' | 'landing_dock'
  | 'residence_small' | 'residence_medium' | 'residence_large' | 'storage' | 'healer' | 'marketplace';

/**
 * A workshop turns inputs into one output inside the building. A smith picks its output from
 * `outputChoices` by the owner's orders and shares; a mine uses food and the deposit under it.
 */
export interface Recipe {
  inputs: Partial<GoodAmounts>;
  output: GoodType;
  outputChoices?: readonly GoodType[];
  ticks: number;
}

/** Ore a mine digs; 0 is no deposit. */
export const DEPOSIT_NONE = 0;
export const DEPOSIT_COAL = 1;
export const DEPOSIT_IRON = 2;
export const DEPOSIT_GOLD = 3;
export const DEPOSIT_GEMS = 4;
export const DEPOSIT_SULFUR = 5;

export interface MineRule {
  deposit: number;
  favouriteFood: FoodType;
  /** What the miners eat; the favourite lasts five times as long. */
  foods: readonly FoodType[];
  /** A different favourite for some races, as with the original's sulfur miners. */
  favouriteByRace?: Partial<Record<RaceType, FoodType>>;
}

/** On its favourite food a miner works five times as long per meal, as in the original game. */
export const FAVOURITE_FOOD_MEALS = 5;
export const OTHER_FOOD_MEALS = 1;

/** Where a building may stand beyond flat land in your territory. */
/** Where a building may stand: any land, near water, on a shore of the open sea (not a lake), or on mountains. */
export type PlacementType = 'land' | 'near_water' | 'shore' | 'mountain';

export interface BuildingType {
  id: BuildingTypeId;
  label: string;
  groupType: BuildingGroupType;
  /** Square footprint edge in tiles. */
  size: 2 | 3 | 4;
  cost: Partial<GoodAmounts>;
  worker: SettlerType | null;
  tool: ToolType | null;
  recipe: Recipe | null;
  /** Goods carriers bring and how many may wait at the building. */
  inputLimits: Partial<GoodAmounts>;
  mine: MineRule | null;
  placementType: PlacementType;
  /** Territory radius in tiles while occupied by a soldier; 0 for civilian buildings. */
  territoryRadius: number;
  /** Soldiers a military building holds. */
  garrisonCapacity: number;
  /** Settlers a residence adds once finished. */
  residents: number;
  /** How far a building lets its owner see, beyond the usual sight of buildings. 0 for the usual sight. */
  visionRadius: number;
  /** Goods a storage building holds; 0 when it stores nothing, Infinity for the castle. */
  storageCapacity: number;
  /** Shown in the build menu. */
  workerLabel: string;
  usesLabel: string;
  makesLabel: string;
  /** False for buildings shown in the menu but not playable yet. */
  isAvailable: boolean;
  /** Only these races can build it; undefined for every race. */
  races?: readonly RaceType[];
  /** War machine halls: the machine they build. */
  warMachine: WarMachineType | null;
  /** The building's name for each people where it differs, such as the Egyptians' sphinx for the small temple. */
  raceLabels: Partial<Record<RaceType, string>>;
}

interface BuildingOptions {
  warMachine?: WarMachineType;
  raceLabels?: Partial<Record<RaceType, string>>;
  worker?: SettlerType;
  tool?: ToolType;
  recipe?: Recipe;
  inputLimits?: Partial<GoodAmounts>;
  mine?: MineRule;
  placementType?: PlacementType;
  territoryRadius?: number;
  garrisonCapacity?: number;
  residents?: number;
  visionRadius?: number;
  storageCapacity?: number;
  isAvailable?: boolean;
  races?: readonly RaceType[];
}

/** A workshop keeps up to one pile (8) of each good it uses, as in The Settlers III, unless its type says otherwise. */
export const INPUT_PILE = 8;

function building(
  id: BuildingTypeId, label: string, groupType: BuildingGroupType, size: 2 | 3 | 4, plank: number, stone: number,
  workerLabel: string, usesLabel: string, makesLabel: string, options: BuildingOptions = {}
): BuildingType {
  const inputLimits: Partial<GoodAmounts> = options.inputLimits ?? {};
  if (!options.inputLimits && options.recipe) {
    for (const good of GOOD_TYPES) if (options.recipe.inputs[good]) inputLimits[good] = INPUT_PILE;
  }
  return {
    id, label, groupType, size, cost: { plank, stone },
    worker: options.worker ?? null, tool: options.tool ?? null, recipe: options.recipe ?? null, inputLimits,
    mine: options.mine ?? null, placementType: options.placementType ?? 'land', territoryRadius: options.territoryRadius ?? 0,
    garrisonCapacity: options.garrisonCapacity ?? 0, residents: options.residents ?? 0, visionRadius: options.visionRadius ?? 0,
    storageCapacity: options.storageCapacity ?? 0, workerLabel, usesLabel, makesLabel, isAvailable: options.isAvailable ?? true,
    races: options.races, warMachine: options.warMachine ?? null, raceLabels: options.raceLabels ?? {}
  };
}

const LATER = { isAvailable: false };

/** A people's war machine hall: a machinist builds machines from parts and reloads them with ammunition. */
function warMachineHall(id: BuildingTypeId, label: string, race: RaceType, machine: WarMachineType, plank: number, stone: number): BuildingType {
  const stats = WAR_MACHINE_STATS[machine];
  const inputLimits: Partial<GoodAmounts> = {};
  for (const good of GOOD_TYPES) if (stats.parts[good]) inputLimits[good] = stats.parts[good]! * 2;
  inputLimits[stats.ammo] = (inputLimits[stats.ammo] ?? 0) + 8;
  const uses = GOOD_TYPES.filter((g) => stats.parts[g] || g === stats.ammo).map((g) => GOOD_NAMES[g][1]);
  return building(id, label, 'military', 3, plank, stone, 'Machinist + hammer', uses.join(', '), `${SETTLER_PLURALS[machine]}, ammunition`,
    { worker: 'machinist', tool: 'hammer', races: [race], warMachine: machine, inputLimits });
}
const MINERS_FOOD = ['bread', 'fish', 'meat'] as const satisfies readonly FoodType[];
const MINE_FOOD: Partial<GoodAmounts> = { bread: 2, fish: 2, meat: 2 };
const SULFUR_MINE_FOOD: Partial<GoodAmounts> = { bread: 2, rice: 2, honey: 2 };

/** Costs start from the Settlers III manual's figures (planks/stone); sizes and times are Lers' own. */
export const BUILDING_TYPES: Record<BuildingTypeId, BuildingType> = {
  woodcutter: building('woodcutter', 'Woodcutter', 'resources', 2, 2, 2, 'Woodcutter + axe', 'Trees nearby', 'Logs', { worker: 'woodcutter', tool: 'axe' }),
  forester: building('forester', 'Forester', 'resources', 2, 3, 1, 'Forester', 'Free land nearby', 'New trees', { worker: 'forester' }),
  sawmill: building('sawmill', 'Sawmill', 'resources', 3, 3, 4, 'Carpenter + saw', 'Logs', 'Planks',
    { worker: 'carpenter', tool: 'saw', recipe: { inputs: { log: 1 }, output: 'plank', ticks: 155 } }),
  stonecutter: building('stonecutter', 'Stonecutter', 'resources', 2, 2, 3, 'Stonecutter + pick', 'Rocks nearby', 'Stone', { worker: 'stonecutter', tool: 'pick' }),
  coal_mine: building('coal_mine', 'Coal mine', 'resources', 2, 4, 1, 'Miner + pick', 'Bread (best), fish or meat', 'Coal',
    { worker: 'miner', tool: 'pick', placementType: 'mountain', inputLimits: MINE_FOOD,
      recipe: { inputs: {}, output: 'coal', ticks: 210 }, mine: { deposit: DEPOSIT_COAL, favouriteFood: 'bread', foods: MINERS_FOOD } }),
  iron_mine: building('iron_mine', 'Iron mine', 'resources', 2, 4, 1, 'Miner + pick', 'Meat (best), bread or fish', 'Iron ore',
    { worker: 'miner', tool: 'pick', placementType: 'mountain', inputLimits: MINE_FOOD,
      recipe: { inputs: {}, output: 'iron_ore', ticks: 240 }, mine: { deposit: DEPOSIT_IRON, favouriteFood: 'meat', foods: MINERS_FOOD } }),
  gold_mine: building('gold_mine', 'Gold mine', 'resources', 2, 5, 1, 'Miner + pick', 'Fish (best), bread or meat', 'Gold ore',
    { worker: 'miner', tool: 'pick', placementType: 'mountain', inputLimits: MINE_FOOD,
      recipe: { inputs: {}, output: 'gold_ore', ticks: 270 }, mine: { deposit: DEPOSIT_GOLD, favouriteFood: 'fish', foods: MINERS_FOOD } }),
  smelter: building('smelter', 'Iron smelter', 'resources', 3, 4, 6, 'Smelter', 'Iron ore, coal', 'Iron',
    { worker: 'smelter', recipe: { inputs: { iron_ore: 1, coal: 1 }, output: 'iron', ticks: 210 } }),
  gold_smelter: building('gold_smelter', 'Gold smelter', 'resources', 3, 4, 6, 'Smelter', 'Gold ore, coal', 'Gold',
    { worker: 'smelter', recipe: { inputs: { gold_ore: 1, coal: 1 }, output: 'gold', ticks: 210 } }),
  gem_mine: building('gem_mine', 'Gem mine', 'resources', 2, 5, 3, 'Miner + pick', 'Fish (best), bread or meat', 'Gems',
    { worker: 'miner', tool: 'pick', placementType: 'mountain', inputLimits: MINE_FOOD, races: ['egyptians', 'amazons'],
      recipe: { inputs: {}, output: 'gems', ticks: 300 }, mine: { deposit: DEPOSIT_GEMS, favouriteFood: 'fish', foods: MINERS_FOOD } }),
  sulfur_mine: building('sulfur_mine', 'Sulfur mine', 'resources', 2, 5, 1, 'Miner + pick', 'Rice or honey (best), or bread', 'Sulfur',
    { worker: 'miner', tool: 'pick', placementType: 'mountain', inputLimits: SULFUR_MINE_FOOD, races: ['asians', 'amazons'],
      recipe: { inputs: {}, output: 'sulfur', ticks: 270 },
      mine: { deposit: DEPOSIT_SULFUR, favouriteFood: 'rice', foods: ['rice', 'honey', 'bread'], favouriteByRace: { amazons: 'honey' } } }),
  charcoal_maker: building('charcoal_maker', 'Charcoal maker', 'resources', 2, 3, 4, 'Charcoal maker', 'Planks', 'Coal',
    { worker: 'charcoal_maker', races: ['romans'], recipe: { inputs: { plank: 5 }, output: 'coal', ticks: 240 }, inputLimits: { plank: 10 } }),
  alchemist: building('alchemist', 'Alchemist', 'resources', 2, 5, 1, 'Alchemist', 'Sulfur, gems', 'Gold',
    { worker: 'alchemist', races: ['amazons'], recipe: { inputs: { sulfur: 1, gems: 1 }, output: 'gold', ticks: 300 } }),
  toolsmith: building('toolsmith', 'Toolsmith', 'resources', 3, 3, 5, 'Smith + hammer', 'Iron, coal', 'Tools',
    { worker: 'smith', tool: 'hammer', recipe: { inputs: { iron: 1, coal: 1 }, output: 'axe', outputChoices: TOOL_TYPES, ticks: 210 } }),

  farm: building('farm', 'Grain farm', 'food', 3, 6, 6, 'Farmer + scythe', 'Free fields nearby', 'Grain', { worker: 'farmer', tool: 'scythe' }),
  mill: building('mill', 'Mill', 'food', 3, 3, 3, 'Miller', 'Grain', 'Flour',
    { worker: 'miller', recipe: { inputs: { grain: 1 }, output: 'flour', ticks: 180 } }),
  bakery: building('bakery', 'Bakery', 'food', 3, 4, 5, 'Baker', 'Flour, water', 'Bread',
    { worker: 'baker', recipe: { inputs: { flour: 1, water: 1 }, output: 'bread', ticks: 210 } }),
  waterworks: building('waterworks', 'Waterworks', 'food', 2, 3, 4, 'Waterworker', 'Water nearby', 'Water',
    { worker: 'waterworker', placementType: 'near_water' }),
  fisher: building('fisher', 'Fisher', 'food', 2, 3, 2, 'Fisher + fishing rod', 'Water nearby', 'Fish',
    { worker: 'fisher', tool: 'rod', placementType: 'near_water' }),
  pig_farm: building('pig_farm', 'Pig farm', 'food', 3, 6, 6, 'Pig farmer', 'Grain, water', 'Pigs',
    { worker: 'pig_farmer', recipe: { inputs: { grain: 1, water: 1 }, output: 'pig', ticks: 270 } }),
  slaughterhouse: building('slaughterhouse', 'Slaughterhouse', 'food', 3, 4, 4, 'Butcher + axe', 'Pigs', 'Meat',
    { worker: 'butcher', tool: 'axe', recipe: { inputs: { pig: 1 }, output: 'meat', ticks: 150 } }),
  winery: building('winery', 'Winery', 'food', 3, 4, 4, 'Wine grower', 'Vineyard around it', 'Wine',
    { worker: 'wine_grower', races: ['romans'], recipe: { inputs: {}, output: 'wine', ticks: 300 } }),
  brewery: building('brewery', 'Brewery', 'food', 3, 2, 5, 'Brewer', 'Grain, water', 'Beer',
    { worker: 'brewer', races: ['egyptians'], recipe: { inputs: { grain: 1, water: 1 }, output: 'beer', ticks: 240 } }),
  rice_farm: building('rice_farm', 'Rice farm', 'food', 3, 9, 3, 'Rice farmer', 'Wet land by the water', 'Rice',
    { worker: 'rice_farmer', races: ['asians'], placementType: 'near_water', recipe: { inputs: {}, output: 'rice', ticks: 270 } }),
  distillery: building('distillery', 'Distillery', 'food', 3, 4, 3, 'Distiller', 'Rice, water', 'Rice wine',
    { worker: 'distiller', races: ['asians'], recipe: { inputs: { rice: 1, water: 1 }, output: 'rice_wine', ticks: 240 } }),
  beekeeper: building('beekeeper', 'Beekeeper', 'food', 2, 6, 1, 'Beekeeper', 'Flowers and trees around it', 'Honey',
    { worker: 'beekeeper', races: ['amazons'], recipe: { inputs: {}, output: 'honey', ticks: 270 } }),
  mead_maker: building('mead_maker', 'Mead maker', 'food', 3, 6, 4, 'Mead maker', 'Honey, water', 'Mead',
    { worker: 'mead_maker', races: ['amazons'], recipe: { inputs: { honey: 1, water: 1 }, output: 'mead', ticks: 240 } }),
  donkey_ranch: building('donkey_ranch', 'Donkey ranch', 'food', 3, 4, 4, 'Breeder', 'Grain, water', 'Donkeys for marketplaces',
    { worker: 'breeder', inputLimits: { grain: 4, water: 4 } }),

  guard_tower_small: building('guard_tower_small', 'Small tower', 'military', 2, 2, 3, 'Up to 3 soldiers', 'Soldiers', 'Territory (small)',
    { territoryRadius: 11, garrisonCapacity: 3 }),
  guard_tower_large: building('guard_tower_large', 'Large tower', 'military', 3, 5, 5, 'Up to 6 soldiers', 'Soldiers', 'Territory (large)',
    { territoryRadius: 16, garrisonCapacity: 6 }),
  castle: building('castle', 'Castle', 'military', 4, 8, 12, 'Up to 10 soldiers', 'Any goods', 'Territory, storage',
    { territoryRadius: 15, garrisonCapacity: 10, storageCapacity: Infinity, isAvailable: false }),
  lookout: building('lookout', 'Lookout tower', 'military', 2, 2, 4, 'None', 'Nothing', 'A long view, no land', { visionRadius: 22 }),
  barracks: building('barracks', 'Barracks', 'military', 3, 4, 5, 'None', 'Weapons, free settlers', 'Soldiers',
    { inputLimits: { sword: 2, spear: 2, bow: 2 } }),
  weaponsmith: building('weaponsmith', 'Weaponsmith', 'military', 3, 5, 7, 'Smith + hammer', 'Iron, coal', 'Weapons',
    { worker: 'smith', tool: 'hammer', recipe: { inputs: { iron: 1, coal: 1 }, output: 'sword', outputChoices: WEAPON_TYPES, ticks: 240 } }),

  gunpowder_maker: building('gunpowder_maker', 'Gunpowder maker', 'military', 3, 5, 3, 'Gunpowder maker', 'Coal, sulfur', 'Gunpowder',
    { worker: 'gunpowder_maker', races: ['asians'], recipe: { inputs: { coal: 1, sulfur: 1 }, output: 'gunpowder', ticks: 240 } }),

  catapult_hall: warMachineHall('catapult_hall', 'Catapult hall', 'romans', 'catapult', 5, 7),
  ballista_hall: warMachineHall('ballista_hall', 'Ballista hall', 'egyptians', 'ballista', 3, 9),
  cannon_hall: warMachineHall('cannon_hall', 'Cannon hall', 'asians', 'cannon', 9, 3),
  gong_hall: warMachineHall('gong_hall', 'Gong hall', 'amazons', 'war_gong', 8, 10),

  small_temple: building('small_temple', 'Small temple', 'misc', 2, 5, 8, 'Temple servant', 'Your people\'s drink', 'Manna',
    { worker: 'temple_servant', inputLimits: { wine: 4, beer: 4, rice_wine: 4, mead: 4 },
      raceLabels: { egyptians: 'Sphinx', asians: 'Small pagoda' } }),
  large_temple: building('large_temple', 'Large temple', 'misc', 3, 8, 14, 'None', 'Free settlers', 'A priest every 5 minutes',
    { raceLabels: { egyptians: 'Pyramid', asians: 'Large pagoda' } }),

  residence_small: building('residence_small', 'Small residence', 'misc', 2, 2, 3, 'None', 'Nothing', '10 settlers', { residents: 10 }),
  residence_medium: building('residence_medium', 'Medium residence', 'misc', 3, 5, 8, 'None', 'Nothing', '20 settlers', { residents: 20 }),
  residence_large: building('residence_large', 'Large residence', 'misc', 4, 15, 24, 'None', 'Nothing', '40 settlers', { residents: 40 }),
  storage: building('storage', 'Storage area', 'misc', 3, 2, 2, 'None', 'Goods marked for storage', 'Holds 48 goods', { storageCapacity: 48 }),
  healer: building('healer', 'Healer', 'misc', 2, 3, 3, 'Healer', 'Nothing', 'Heals soldiers nearby', { worker: 'healer' }),
  shipyard: building('shipyard', 'Shipyard', 'misc', 3, 3, 5, 'Shipbuilder + hammer', 'Planks, iron', 'Ships',
    { worker: 'shipbuilder', tool: 'hammer', placementType: 'shore', inputLimits: { plank: 8, iron: 2 } }),
  landing_dock: building('landing_dock', 'Landing dock', 'misc', 2, 2, 4, 'None', 'Goods for its sea route', 'Trade ships to a far storage',
    { placementType: 'shore' }),
  marketplace: building('marketplace', 'Marketplace', 'misc', 3, 1, 5, 'Donkeys', 'Goods for its route', 'Caravans to a far storage')
};

/** The tool a kind of workplace worker holds, if any: the same for every building that worker works in. */
export function workerToolOf(type: SettlerType): ToolType | null {
  for (const t of Object.values(BUILDING_TYPES)) if (t.worker === type && t.tool) return t.tool;
  return null;
}

/** Whether a settler type is a workplace worker (miner, farmer, baker, …), as opposed to carriers, crews, soldiers and specialists. */
export function isWorkplaceWorkerType(type: SettlerType): boolean {
  return Object.values(BUILDING_TYPES).some((t) => t.worker === type);
}

export function costTotal(cost: Partial<GoodAmounts>): number {
  let total = 0;
  for (const good of GOOD_TYPES) total += cost[good] ?? 0;
  return total;
}

/** Building types that take a good as input, for goods shared between several consumers. */
export function consumersOf(good: GoodType): BuildingTypeId[] {
  return (Object.keys(BUILDING_TYPES) as BuildingTypeId[])
    .filter((id) => BUILDING_TYPES[id].isAvailable && (BUILDING_TYPES[id].inputLimits[good] ?? 0) > 0);
}

/** Goods with more than one kind of consumer get a Distribution setting. */
export function distributedGoods(): GoodType[] {
  return GOOD_TYPES.filter((g) => consumersOf(g).length > 1);
}

/** How much each player starts with: as in the original's game setup, few, normal or many goods and settlers. */
export const STARTING_GOODS_TYPES = ['few', 'default', 'many'] as const;
export type StartingGoodsType = (typeof STARTING_GOODS_TYPES)[number];
export const STARTING_GOODS_LABELS: Record<StartingGoodsType, string> = { few: 'Few', default: 'Normal', many: 'Many' };
/** Factors on the normal start: materials and food, tools, civilians, and soldiers. Every kind keeps at least one of each. */
export const STARTING_GOODS_SETTINGS: Record<StartingGoodsType, { goods: number; tools: number; settlers: number; soldiers: number }> = {
  few: { goods: 0.5, tools: 0.5, settlers: 0.75, soldiers: 0.5 },
  default: { goods: 1, tools: 1, settlers: 1, soldiers: 1 },
  many: { goods: 2, tools: 2, settlers: 1.5, soldiers: 2 }
};

/** How a match is won: by taking every enemy castle, or, in the economic mode, by making the goods targets first. */
export const VICTORY_TYPES = ['conquest', 'economy'] as const;
export type VictoryType = (typeof VICTORY_TYPES)[number];
export const VICTORY_LABELS: Record<VictoryType, string> = { conquest: 'Conquest', economy: 'Economy' };
/** Economic mode: how hard soldiers hit outside their own land, whatever gold their owner has. */
export const ECONOMY_OUTSIDE_STRENGTH = 0.25;

/** Map layouts: one continent, or each player on an island across the sea, with a neutral island between. */
export const MAP_LAYOUT_TYPES = ['continent', 'islands'] as const;
export type MapLayoutType = (typeof MAP_LAYOUT_TYPES)[number];
export const MAP_LAYOUT_LABELS: Record<MapLayoutType, string> = { continent: 'Continent', islands: 'Islands' };

export const MAP_SIZE_TYPES = ['small', 'medium', 'large'] as const;
export type MapSizeType = (typeof MAP_SIZE_TYPES)[number];
/** Economic mode: goods each player's workshops must make over the match, per map size; the first to make them all wins. */
export const ECONOMY_TARGETS: Record<MapSizeType, Partial<Record<GoodType, number>>> = {
  small: { plank: 160, bread: 40, meat: 30, iron: 30, gold: 15 },
  medium: { plank: 240, bread: 65, meat: 50, iron: 45, gold: 25 },
  large: { plank: 320, bread: 90, meat: 70, iron: 60, gold: 35 }
};

/**
 * Each map size and how many players fit on it, every one with room for a castle and its first towers; on islands
 * fewer, as each island must hold a castle's land and its ore mountain.
 */
export const MAP_SIZE_SETTINGS: Record<MapSizeType, { label: string; width: number; height: number; maxPlayers: number; maxIslandPlayers: number }> = {
  small: { label: 'Small', width: 96, height: 64, maxPlayers: 4, maxIslandPlayers: 2 },
  medium: { label: 'Medium', width: 144, height: 96, maxPlayers: 6, maxIslandPlayers: 4 },
  large: { label: 'Large', width: 192, height: 128, maxPlayers: 8, maxIslandPlayers: 5 }
};

/** The size a map was made with, found from its width; maps of other widths count as medium. */
export function mapSizeTypeOf(width: number): MapSizeType {
  return MAP_SIZE_TYPES.find((t) => MAP_SIZE_SETTINGS[t].width === width) ?? 'medium';
}

/** The four peoples, with the roles they have in the original game. */
export const RACE_TYPES = ['romans', 'egyptians', 'asians', 'amazons'] as const;
export type RaceType = (typeof RACE_TYPES)[number];

export const RACE_SETTINGS: Record<RaceType, { label: string; summary: string }> = {
  romans: { label: 'Romans', summary: 'Even planks and stone. Wine, charcoal.' },
  egyptians: { label: 'Egyptians', summary: 'Mostly stone. Beer; gems count double for strength.' },
  asians: { label: 'Asians', summary: 'Mostly planks. Rice, sulfur, gunpowder.' },
  amazons: { label: 'Amazons', summary: 'Planks first. Honey, mead, alchemy.' }
};

/** Building costs per race (planks, stone), from the original manual's table; other buildings cost the same for all. */
const RACE_COSTS: Partial<Record<BuildingTypeId, Record<RaceType, readonly [number, number]>>> = {
  woodcutter: { romans: [2, 2], egyptians: [2, 2], asians: [3, 0], amazons: [3, 1] },
  forester: { romans: [3, 1], egyptians: [1, 3], asians: [2, 0], amazons: [3, 1] },
  sawmill: { romans: [3, 4], egyptians: [2, 5], asians: [4, 1], amazons: [4, 3] },
  stonecutter: { romans: [2, 3], egyptians: [1, 3], asians: [3, 0], amazons: [3, 2] },
  storage: { romans: [2, 2], egyptians: [2, 2], asians: [2, 2], amazons: [2, 2] },
  residence_small: { romans: [2, 3], egyptians: [2, 3], asians: [3, 1], amazons: [4, 2] },
  residence_medium: { romans: [5, 8], egyptians: [4, 9], asians: [8, 3], amazons: [8, 5] },
  residence_large: { romans: [15, 24], egyptians: [12, 27], asians: [24, 9], amazons: [18, 9] },
  coal_mine: { romans: [4, 1], egyptians: [3, 2], asians: [4, 1], amazons: [4, 3] },
  iron_mine: { romans: [4, 1], egyptians: [3, 2], asians: [4, 1], amazons: [4, 3] },
  gold_mine: { romans: [5, 1], egyptians: [4, 2], asians: [5, 1], amazons: [4, 3] },
  smelter: { romans: [4, 6], egyptians: [3, 7], asians: [6, 4], amazons: [4, 5] },
  gold_smelter: { romans: [4, 6], egyptians: [3, 7], asians: [6, 4], amazons: [4, 5] },
  toolsmith: { romans: [3, 5], egyptians: [2, 6], asians: [5, 3], amazons: [4, 4] },
  weaponsmith: { romans: [5, 7], egyptians: [3, 8], asians: [7, 5], amazons: [5, 3] },
  farm: { romans: [6, 6], egyptians: [3, 9], asians: [9, 3], amazons: [7, 3] },
  pig_farm: { romans: [6, 6], egyptians: [3, 9], asians: [9, 3], amazons: [7, 2] },
  mill: { romans: [3, 3], egyptians: [2, 5], asians: [5, 1], amazons: [5, 2] },
  bakery: { romans: [4, 5], egyptians: [3, 6], asians: [6, 3], amazons: [5, 2] },
  slaughterhouse: { romans: [4, 4], egyptians: [2, 6], asians: [6, 2], amazons: [5, 3] },
  waterworks: { romans: [3, 4], egyptians: [2, 6], asians: [5, 1], amazons: [4, 2] },
  fisher: { romans: [3, 2], egyptians: [2, 3], asians: [4, 1], amazons: [3, 1] },
  guard_tower_small: { romans: [2, 3], egyptians: [2, 3], asians: [3, 2], amazons: [2, 3] },
  guard_tower_large: { romans: [5, 5], egyptians: [4, 6], asians: [6, 4], amazons: [3, 5] },
  lookout: { romans: [2, 4], egyptians: [2, 4], asians: [4, 2], amazons: [2, 2] },
  barracks: { romans: [4, 5], egyptians: [3, 6], asians: [6, 3], amazons: [6, 4] },
  healer: { romans: [3, 3], egyptians: [2, 4], asians: [4, 2], amazons: [5, 2] },
  gem_mine: { romans: [5, 3], egyptians: [5, 3], asians: [5, 3], amazons: [3, 2] },
  sulfur_mine: { romans: [5, 1], egyptians: [5, 1], asians: [5, 1], amazons: [3, 2] },
  small_temple: { romans: [5, 8], egyptians: [2, 10], asians: [9, 4], amazons: [7, 6] },
  large_temple: { romans: [8, 14], egyptians: [6, 20], asians: [15, 6], amazons: [13, 11] },
  shipyard: { romans: [3, 5], egyptians: [1, 6], asians: [5, 2], amazons: [5, 2] },
  landing_dock: { romans: [2, 4], egyptians: [1, 4], asians: [4, 1], amazons: [4, 3] }
};

/** What a building costs for a player of this race. */
export function buildingCost(typeId: BuildingTypeId, race: RaceType): Partial<GoodAmounts> {
  const pair = RACE_COSTS[typeId]?.[race];
  return pair ? { plank: pair[0], stone: pair[1] } : BUILDING_TYPES[typeId].cost;
}

/** Whether a player of this race can build the type at all (it may still be marked "coming later"). */
export function isBuildableBy(typeId: BuildingTypeId, race: RaceType): boolean {
  const races = BUILDING_TYPES[typeId].races;
  return !races || races.includes(race);
}

/** A mine's favourite food for this race. */
export function favouriteFoodOf(mine: MineRule, race: RaceType): FoodType {
  return mine.favouriteByRace?.[race] ?? mine.favouriteFood;
}


/** A building's name for a player of this people. */
export function buildingLabel(typeId: BuildingTypeId, race: RaceType): string {
  return BUILDING_TYPES[typeId].raceLabels[race] ?? BUILDING_TYPES[typeId].label;
}

// ---------------------------------------------------------------- temples, priests, spells and ranks

/** The drink each people offers at its small temple. */
export const RACE_DRINKS: Record<RaceType, GoodType> = { romans: 'wine', egyptians: 'beer', asians: 'rice_wine', amazons: 'mead' };
/** Ticks one offering takes; each gives the player one manna. */
export const OFFERING_TICKS = 200;
/** A large temple turns a free carrier into a priest this often (5 minutes). */
export const PRIEST_TICKS = 3000;
/** A priest casts on a spot this close, apart from the spells that work at any distance. */
export const SPELL_RANGE = 6;
/** Ticks a priest rests after casting. */
export const PRIEST_REST_TICKS = 100;

export const SPELL_TYPES = [
  'far_sight', 'grow_forest', 'raise_stones', 'harvest', 'transmute', 'gift', 'shield', 'fury', 'freeze', 'persuade', 'blight'
] as const;
export type SpellType = (typeof SPELL_TYPES)[number];

export interface SpellStats {
  label: string;
  /** What it does, for the spell bar. */
  summary: string;
  cost: number;
  /** Tiles around the spot it works on. */
  radius: number;
  /** Ticks it lasts, for spells with a lasting effect. */
  duration: number;
  /** Works at any distance from the priest. */
  isRanged: boolean;
}

export const SPELL_STATS: Record<SpellType, SpellStats> = {
  far_sight: { label: 'Far sight', summary: 'Shows the land around the spot for a minute', cost: 5, radius: 15, duration: 600, isRanged: true },
  grow_forest: { label: 'Grow forest', summary: 'Grown trees on free grass around the spot', cost: 6, radius: 3, duration: 0, isRanged: false },
  raise_stones: { label: 'Raise stones', summary: 'Rocks for stonecutters on free grass around the spot', cost: 6, radius: 2, duration: 0, isRanged: false },
  harvest: { label: 'Harvest', summary: 'Fields ripen and young trees grow up at once', cost: 8, radius: 8, duration: 0, isRanged: false },
  transmute: { label: 'Transmute', summary: 'Turns goods in your nearest storage into others', cost: 10, radius: 0, duration: 0, isRanged: false },
  gift: { label: 'Gift', summary: 'Goods appear in your nearest storage', cost: 8, radius: 0, duration: 0, isRanged: false },
  shield: { label: 'Shield', summary: 'Your soldiers here take half damage for a minute', cost: 12, radius: 6, duration: 600, isRanged: false },
  fury: { label: 'Fury', summary: 'Your soldiers here hit twice as hard for a minute', cost: 15, radius: 6, duration: 600, isRanged: false },
  freeze: { label: 'Freeze', summary: 'Enemy soldiers here cannot act for 15 seconds', cost: 12, radius: 5, duration: 150, isRanged: false },
  persuade: { label: 'Persuade', summary: 'Up to 3 enemy soldiers here change sides', cost: 25, radius: 4, duration: 0, isRanged: false },
  blight: { label: 'Blight', summary: 'Enemy mines here produce half as much for 5 minutes', cost: 15, radius: 6, duration: 3000, isRanged: true }
};

/** Each people's eight spells, in the original's families. */
export const RACE_SPELLS: Record<RaceType, readonly SpellType[]> = {
  romans: ['far_sight', 'grow_forest', 'harvest', 'transmute', 'gift', 'shield', 'fury', 'persuade'],
  egyptians: ['far_sight', 'raise_stones', 'harvest', 'transmute', 'gift', 'shield', 'freeze', 'persuade'],
  asians: ['far_sight', 'grow_forest', 'harvest', 'transmute', 'gift', 'fury', 'freeze', 'blight'],
  amazons: ['far_sight', 'grow_forest', 'raise_stones', 'transmute', 'gift', 'shield', 'freeze', 'blight']
};
/** What Transmute turns into what, and how much at most, by people. */
export const RACE_TRANSMUTES: Record<RaceType, { from: GoodType; to: GoodType; amount: number }> = {
  romans: { from: 'fish', to: 'meat', amount: 10 },
  egyptians: { from: 'stone', to: 'iron', amount: 6 },
  asians: { from: 'iron', to: 'gold', amount: 4 },
  amazons: { from: 'stone', to: 'gold', amount: 3 }
};
/** What Gift brings, by people. */
export const RACE_GIFTS: Record<RaceType, Partial<GoodAmounts>> = {
  romans: { plank: 12 }, egyptians: { gems: 4 }, asians: { rice: 10 }, amazons: { honey: 10 }
};

export const RANK_LABELS = ['Private', 'Sergeant', 'Captain'] as const;
/** Manna to raise a soldier type from rank n to n + 1. */
export const PROMOTION_COSTS = [10, 20] as const;
/** Each rank adds this share to a soldier's health and damage. */
export const RANK_BONUS = 0.25;


// ---------------------------------------------------------------- trade

/** How a marketplace collects goods for its route, as in the original's three trade route settings. */
export const TRADE_MODE_TYPES = ['surplus', 'construction', 'suspended'] as const;
export type TradeModeType = (typeof TRADE_MODE_TYPES)[number];
export const TRADE_MODE_LABELS: Record<TradeModeType, string> = {
  surplus: 'Only surplus', construction: 'Ahead of construction sites', suspended: 'Suspended'
};
/** A trade route amount meaning "as much as there is". */
export const TRADE_UNLIMITED = -1;
/** Goods one donkey carries per trip, all of one kind. */
export const DONKEY_LOAD = 8;
/** Donkeys a marketplace works with. */
export const DONKEYS_PER_MARKETPLACE = 4;
/** Ticks a breeder needs to raise one donkey, from one grain and one water. */
export const DONKEY_TICKS = 600;
/** A caravan unloads at the player's storage within this many tiles of the route's end. */
export const TRADE_UNLOAD_RADIUS = 12;
/** In "only surplus" mode a storage keeps this many of each good for the settlement. */
export const TRADE_SURPLUS_RESERVE = 8;
/** At most this many waypoints before the route's end. */
export const MAX_TRADE_WAYPOINTS = 3;


// ---------------------------------------------------------------- sea

/** Each people's ships, from the manual: planks and iron to build one, settlers a transport ship carries, and
 * piles of 8 goods a trade ship carries. */
export const SHIP_COSTS: Record<ShipType, Record<RaceType, { plank: number; iron: number }>> = {
  transport_ship: { romans: { plank: 4, iron: 1 }, egyptians: { plank: 7, iron: 0 }, asians: { plank: 5, iron: 0 }, amazons: { plank: 4, iron: 1 } },
  trade_ship: { romans: { plank: 6, iron: 1 }, egyptians: { plank: 8, iron: 2 }, asians: { plank: 4, iron: 0 }, amazons: { plank: 6, iron: 1 } }
};
export const TRANSPORT_CAPACITY: Record<RaceType, number> = { romans: 7, egyptians: 9, asians: 6, amazons: 8 };
export const TRADE_SHIP_PILES: Record<RaceType, number> = { romans: 3, egyptians: 4, asians: 2, amazons: 3 };
/** Ticks a shipbuilder needs for one ship. */
export const SHIP_TICKS = 1800;
/** Ships sail a little faster than people walk. */
export const SHIP_SPEED_SHARE = 1.3;
/** A ship's health: soldiers on the shore can shoot at it later; for now ships are not attacked. */
export const SHIP_HEALTH = 200;
/** Units board a ship from the shore within this many tiles, and land within this many tiles of it. */
export const BOARDING_RANGE = 3;
