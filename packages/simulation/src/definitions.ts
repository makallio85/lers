/** Static game data: goods, settler types, building types and their build menu groups. */

export const GOOD_TYPES = [
  'log', 'plank', 'stone',
  'grain', 'flour', 'water', 'bread', 'fish', 'pig', 'meat',
  'coal', 'iron_ore', 'iron',
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
export const FOOD_TYPES = ['bread', 'fish', 'meat'] as const satisfies readonly GoodType[];
export type FoodType = (typeof FOOD_TYPES)[number];

/** Lower-case singular and plural names, for "2 planks", "Missing tool: saw". */
export const GOOD_NAMES: Record<GoodType, readonly [string, string]> = {
  log: ['log', 'logs'], plank: ['plank', 'planks'], stone: ['stone', 'stone'],
  grain: ['grain', 'grain'], flour: ['flour', 'flour'], water: ['water', 'water'], bread: ['bread', 'bread'],
  fish: ['fish', 'fish'], pig: ['pig', 'pigs'], meat: ['meat', 'meat'],
  coal: ['coal', 'coal'], iron_ore: ['iron ore', 'iron ore'], iron: ['iron bar', 'iron bars'],
  axe: ['axe', 'axes'], saw: ['saw', 'saws'], pick: ['pick', 'picks'], scythe: ['scythe', 'scythes'],
  shovel: ['shovel', 'shovels'], hammer: ['hammer', 'hammers'], rod: ['fishing rod', 'fishing rods'],
  sword: ['sword', 'swords'], spear: ['spear', 'spears'], bow: ['bow', 'bows']
};

/** Title-case labels for lists and the goods bar. */
export const GOOD_LABELS: Record<GoodType, string> = {
  log: 'Logs', plank: 'Planks', stone: 'Stone',
  grain: 'Grain', flour: 'Flour', water: 'Water', bread: 'Bread', fish: 'Fish', pig: 'Pigs', meat: 'Meat',
  coal: 'Coal', iron_ore: 'Iron ore', iron: 'Iron',
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

export type SettlerType =
  | 'carrier' | 'digger' | 'builder' | SoldierType
  | 'woodcutter' | 'forester' | 'carpenter' | 'stonecutter'
  | 'farmer' | 'miller' | 'baker' | 'waterworker' | 'fisher' | 'pig_farmer' | 'butcher'
  | 'miner' | 'smelter' | 'smith';

export const SETTLER_LABELS: Record<SettlerType, string> = {
  carrier: 'Carrier', digger: 'Digger', builder: 'Builder',
  swordsman: 'Swordsman', spearman: 'Spearman', bowman: 'Bowman',
  woodcutter: 'Woodcutter', forester: 'Forester', carpenter: 'Carpenter', stonecutter: 'Stonecutter',
  farmer: 'Farmer', miller: 'Miller', baker: 'Baker', waterworker: 'Waterworker', fisher: 'Fisher',
  pig_farmer: 'Pig farmer', butcher: 'Butcher', miner: 'Miner', smelter: 'Smelter', smith: 'Smith'
};

export const SETTLER_PLURALS: Record<SettlerType, string> = {
  carrier: 'Carriers', digger: 'Diggers', builder: 'Builders',
  swordsman: 'Swordsmen', spearman: 'Spearmen', bowman: 'Bowmen',
  woodcutter: 'Woodcutters', forester: 'Foresters', carpenter: 'Carpenters', stonecutter: 'Stonecutters',
  farmer: 'Farmers', miller: 'Millers', baker: 'Bakers', waterworker: 'Waterworkers', fisher: 'Fishers',
  pig_farmer: 'Pig farmers', butcher: 'Butchers', miner: 'Miners', smelter: 'Smelters', smith: 'Smiths'
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

export type BuildingGroupType = 'resources' | 'food' | 'military' | 'misc';

export const BUILDING_GROUP_TYPES: readonly { id: BuildingGroupType; label: string; key: string }[] = [
  { id: 'resources', label: 'Resources', key: 'q' },
  { id: 'food', label: 'Food', key: 'w' },
  { id: 'military', label: 'Military', key: 'e' },
  { id: 'misc', label: 'Misc.', key: 'r' }
];

export type BuildingTypeId =
  | 'woodcutter' | 'forester' | 'sawmill' | 'stonecutter'
  | 'coal_mine' | 'iron_mine' | 'gold_mine' | 'smelter' | 'toolsmith'
  | 'farm' | 'mill' | 'bakery' | 'waterworks' | 'fisher' | 'pig_farm' | 'slaughterhouse' | 'donkey_ranch'
  | 'guard_tower_small' | 'guard_tower_large' | 'castle' | 'lookout' | 'barracks' | 'weaponsmith'
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

export interface MineRule {
  deposit: number;
  favouriteFood: FoodType;
}

/** On its favourite food a miner works five times as long per meal, as in the original game. */
export const FAVOURITE_FOOD_MEALS = 5;
export const OTHER_FOOD_MEALS = 1;

/** Where a building may stand beyond flat land in your territory. */
export type PlacementType = 'land' | 'near_water' | 'mountain';

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
  /** Goods a storage building holds; 0 when it stores nothing, Infinity for the castle. */
  storageCapacity: number;
  /** Shown in the build menu. */
  workerLabel: string;
  usesLabel: string;
  makesLabel: string;
  /** False for buildings shown in the menu but not playable yet. */
  isAvailable: boolean;
}

interface BuildingOptions {
  worker?: SettlerType;
  tool?: ToolType;
  recipe?: Recipe;
  inputLimits?: Partial<GoodAmounts>;
  mine?: MineRule;
  placementType?: PlacementType;
  territoryRadius?: number;
  garrisonCapacity?: number;
  residents?: number;
  storageCapacity?: number;
  isAvailable?: boolean;
}

function building(
  id: BuildingTypeId, label: string, groupType: BuildingGroupType, size: 2 | 3 | 4, plank: number, stone: number,
  workerLabel: string, usesLabel: string, makesLabel: string, options: BuildingOptions = {}
): BuildingType {
  const inputLimits: Partial<GoodAmounts> = options.inputLimits ?? {};
  if (!options.inputLimits && options.recipe) {
    for (const good of GOOD_TYPES) if (options.recipe.inputs[good]) inputLimits[good] = 4;
  }
  return {
    id, label, groupType, size, cost: { plank, stone },
    worker: options.worker ?? null, tool: options.tool ?? null, recipe: options.recipe ?? null, inputLimits,
    mine: options.mine ?? null, placementType: options.placementType ?? 'land', territoryRadius: options.territoryRadius ?? 0,
    garrisonCapacity: options.garrisonCapacity ?? 0, residents: options.residents ?? 0,
    storageCapacity: options.storageCapacity ?? 0, workerLabel, usesLabel, makesLabel, isAvailable: options.isAvailable ?? true
  };
}

const LATER = { isAvailable: false };
const MINE_FOOD: Partial<GoodAmounts> = { bread: 2, fish: 2, meat: 2 };

/** Costs start from the Settlers III manual's figures (planks/stone); sizes and times are Lers' own. */
export const BUILDING_TYPES: Record<BuildingTypeId, BuildingType> = {
  woodcutter: building('woodcutter', 'Woodcutter', 'resources', 2, 2, 2, 'Woodcutter + axe', 'Trees nearby', 'Logs', { worker: 'woodcutter', tool: 'axe' }),
  forester: building('forester', 'Forester', 'resources', 2, 3, 1, 'Forester', 'Free land nearby', 'New trees', { worker: 'forester' }),
  sawmill: building('sawmill', 'Sawmill', 'resources', 3, 3, 4, 'Carpenter + saw', 'Logs', 'Planks',
    { worker: 'carpenter', tool: 'saw', recipe: { inputs: { log: 1 }, output: 'plank', ticks: 50 } }),
  stonecutter: building('stonecutter', 'Stonecutter', 'resources', 2, 2, 3, 'Stonecutter + pick', 'Rocks nearby', 'Stone', { worker: 'stonecutter', tool: 'pick' }),
  coal_mine: building('coal_mine', 'Coal mine', 'resources', 2, 4, 1, 'Miner + pick', 'Bread (best), fish or meat', 'Coal',
    { worker: 'miner', tool: 'pick', placementType: 'mountain', inputLimits: MINE_FOOD,
      recipe: { inputs: {}, output: 'coal', ticks: 70 }, mine: { deposit: DEPOSIT_COAL, favouriteFood: 'bread' } }),
  iron_mine: building('iron_mine', 'Iron mine', 'resources', 2, 4, 1, 'Miner + pick', 'Meat (best), bread or fish', 'Iron ore',
    { worker: 'miner', tool: 'pick', placementType: 'mountain', inputLimits: MINE_FOOD,
      recipe: { inputs: {}, output: 'iron_ore', ticks: 80 }, mine: { deposit: DEPOSIT_IRON, favouriteFood: 'meat' } }),
  gold_mine: building('gold_mine', 'Gold mine', 'resources', 2, 5, 1, 'Miner + pick', 'Fish (best)', 'Gold ore', LATER),
  smelter: building('smelter', 'Iron smelter', 'resources', 3, 4, 6, 'Smelter', 'Iron ore, coal', 'Iron',
    { worker: 'smelter', recipe: { inputs: { iron_ore: 1, coal: 1 }, output: 'iron', ticks: 70 } }),
  toolsmith: building('toolsmith', 'Toolsmith', 'resources', 3, 3, 5, 'Smith + hammer', 'Iron, coal', 'Tools',
    { worker: 'smith', tool: 'hammer', recipe: { inputs: { iron: 1, coal: 1 }, output: 'axe', outputChoices: TOOL_TYPES, ticks: 70 } }),

  farm: building('farm', 'Grain farm', 'food', 3, 6, 6, 'Farmer + scythe', 'Free fields nearby', 'Grain', { worker: 'farmer', tool: 'scythe' }),
  mill: building('mill', 'Mill', 'food', 3, 3, 3, 'Miller', 'Grain', 'Flour',
    { worker: 'miller', recipe: { inputs: { grain: 1 }, output: 'flour', ticks: 60 } }),
  bakery: building('bakery', 'Bakery', 'food', 3, 4, 5, 'Baker', 'Flour, water', 'Bread',
    { worker: 'baker', recipe: { inputs: { flour: 1, water: 1 }, output: 'bread', ticks: 70 } }),
  waterworks: building('waterworks', 'Waterworks', 'food', 2, 3, 4, 'Waterworker', 'Water nearby', 'Water',
    { worker: 'waterworker', placementType: 'near_water', recipe: { inputs: {}, output: 'water', ticks: 60 } }),
  fisher: building('fisher', 'Fisher', 'food', 2, 3, 2, 'Fisher + fishing rod', 'Water nearby', 'Fish',
    { worker: 'fisher', tool: 'rod', placementType: 'near_water' }),
  pig_farm: building('pig_farm', 'Pig farm', 'food', 3, 6, 6, 'Pig farmer', 'Grain, water', 'Pigs',
    { worker: 'pig_farmer', recipe: { inputs: { grain: 1, water: 1 }, output: 'pig', ticks: 90 } }),
  slaughterhouse: building('slaughterhouse', 'Slaughterhouse', 'food', 3, 4, 4, 'Butcher + axe', 'Pigs', 'Meat',
    { worker: 'butcher', tool: 'axe', recipe: { inputs: { pig: 1 }, output: 'meat', ticks: 50 } }),
  donkey_ranch: building('donkey_ranch', 'Donkey ranch', 'food', 3, 4, 4, 'Breeder', 'Grain, water', 'Donkeys', LATER),

  guard_tower_small: building('guard_tower_small', 'Small tower', 'military', 2, 2, 3, 'Up to 3 soldiers', 'Soldiers', 'Territory (small)',
    { territoryRadius: 9, garrisonCapacity: 3 }),
  guard_tower_large: building('guard_tower_large', 'Large tower', 'military', 3, 5, 5, 'Up to 6 soldiers', 'Soldiers', 'Territory (large)',
    { territoryRadius: 16, garrisonCapacity: 6 }),
  castle: building('castle', 'Castle', 'military', 4, 8, 12, 'Up to 10 soldiers', 'Any goods', 'Territory, storage',
    { territoryRadius: 15, garrisonCapacity: 10, storageCapacity: Infinity, isAvailable: false }),
  lookout: building('lookout', 'Lookout tower', 'military', 2, 2, 4, 'Scout', 'Nothing', 'Vision', LATER),
  barracks: building('barracks', 'Barracks', 'military', 3, 4, 5, 'None', 'Weapons, free settlers', 'Soldiers',
    { inputLimits: { sword: 2, spear: 2, bow: 2 } }),
  weaponsmith: building('weaponsmith', 'Weaponsmith', 'military', 3, 5, 7, 'Smith + hammer', 'Iron, coal', 'Weapons',
    { worker: 'smith', tool: 'hammer', recipe: { inputs: { iron: 1, coal: 1 }, output: 'sword', outputChoices: WEAPON_TYPES, ticks: 80 } }),

  residence_small: building('residence_small', 'Small residence', 'misc', 2, 2, 3, 'None', 'Nothing', '10 settlers', { residents: 10 }),
  residence_medium: building('residence_medium', 'Medium residence', 'misc', 3, 5, 8, 'None', 'Nothing', '20 settlers', { residents: 20 }),
  residence_large: building('residence_large', 'Large residence', 'misc', 4, 15, 24, 'None', 'Nothing', '40 settlers', { residents: 40 }),
  storage: building('storage', 'Storage area', 'misc', 3, 2, 2, 'None', 'Goods marked for storage', 'Holds 48 goods', { storageCapacity: 48 }),
  healer: building('healer', 'Healer', 'misc', 2, 3, 3, 'Healer', 'Nothing', 'Heals soldiers', LATER),
  marketplace: building('marketplace', 'Marketplace', 'misc', 3, 1, 5, 'Donkeys', 'Goods', 'Trade', LATER)
};

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
