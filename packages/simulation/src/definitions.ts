/** Static game data: goods, settler types, building types and their build menu groups. */

export const GOOD_TYPES = [
  'log', 'plank', 'stone',
  'grain', 'flour', 'water', 'bread', 'fish',
  'axe', 'saw', 'pick', 'scythe', 'shovel', 'hammer', 'rod'
] as const;
export type GoodType = (typeof GOOD_TYPES)[number];
export type GoodAmounts = Record<GoodType, number>;

export const TOOL_TYPES = ['axe', 'saw', 'pick', 'scythe', 'shovel', 'hammer', 'rod'] as const satisfies readonly GoodType[];
export type ToolType = (typeof TOOL_TYPES)[number];

/** Lower-case singular and plural names, for "2 planks", "Missing tool: saw". */
export const GOOD_NAMES: Record<GoodType, readonly [string, string]> = {
  log: ['log', 'logs'], plank: ['plank', 'planks'], stone: ['stone', 'stone'],
  grain: ['grain', 'grain'], flour: ['flour', 'flour'], water: ['water', 'water'], bread: ['bread', 'bread'], fish: ['fish', 'fish'],
  axe: ['axe', 'axes'], saw: ['saw', 'saws'], pick: ['pick', 'picks'], scythe: ['scythe', 'scythes'],
  shovel: ['shovel', 'shovels'], hammer: ['hammer', 'hammers'], rod: ['fishing rod', 'fishing rods']
};

/** Title-case labels for lists and the goods bar. */
export const GOOD_LABELS: Record<GoodType, string> = {
  log: 'Logs', plank: 'Planks', stone: 'Stone',
  grain: 'Grain', flour: 'Flour', water: 'Water', bread: 'Bread', fish: 'Fish',
  axe: 'Axes', saw: 'Saws', pick: 'Picks', scythe: 'Scythes', shovel: 'Shovels', hammer: 'Hammers', rod: 'Fishing rods'
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

export type SettlerType =
  | 'carrier' | 'digger' | 'builder' | 'soldier'
  | 'woodcutter' | 'forester' | 'carpenter' | 'stonecutter'
  | 'farmer' | 'miller' | 'baker' | 'waterworker' | 'fisher';

export const SETTLER_LABELS: Record<SettlerType, string> = {
  carrier: 'Carrier', digger: 'Digger', builder: 'Builder', soldier: 'Soldier',
  woodcutter: 'Woodcutter', forester: 'Forester', carpenter: 'Carpenter', stonecutter: 'Stonecutter',
  farmer: 'Farmer', miller: 'Miller', baker: 'Baker', waterworker: 'Waterworker', fisher: 'Fisher'
};

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

/** A workshop turns inputs into one output inside the building. */
export interface Recipe {
  inputs: Partial<GoodAmounts>;
  output: GoodType;
  ticks: number;
}

/** Where a building may stand beyond flat grassland in your territory. */
export type PlacementType = 'land' | 'near_water';

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
  placementType: PlacementType;
  /** Territory radius in tiles once occupied by a soldier; 0 for civilian buildings. */
  territoryRadius: number;
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
  placementType?: PlacementType;
  territoryRadius?: number;
  residents?: number;
  storageCapacity?: number;
  isAvailable?: boolean;
}

function building(
  id: BuildingTypeId, label: string, groupType: BuildingGroupType, size: 2 | 3 | 4, plank: number, stone: number,
  workerLabel: string, usesLabel: string, makesLabel: string, options: BuildingOptions = {}
): BuildingType {
  return {
    id, label, groupType, size, cost: { plank, stone },
    worker: options.worker ?? null, tool: options.tool ?? null, recipe: options.recipe ?? null,
    placementType: options.placementType ?? 'land', territoryRadius: options.territoryRadius ?? 0,
    residents: options.residents ?? 0, storageCapacity: options.storageCapacity ?? 0,
    workerLabel, usesLabel, makesLabel, isAvailable: options.isAvailable ?? true
  };
}

const LATER = { isAvailable: false };

/** Costs start from the Settlers III manual's figures (planks/stone); sizes and times are Lers' own. */
export const BUILDING_TYPES: Record<BuildingTypeId, BuildingType> = {
  woodcutter: building('woodcutter', 'Woodcutter', 'resources', 2, 2, 2, 'Woodcutter + axe', 'Trees nearby', 'Logs', { worker: 'woodcutter', tool: 'axe' }),
  forester: building('forester', 'Forester', 'resources', 2, 3, 1, 'Forester', 'Free land nearby', 'New trees', { worker: 'forester' }),
  sawmill: building('sawmill', 'Sawmill', 'resources', 3, 3, 4, 'Carpenter + saw', 'Logs', 'Planks',
    { worker: 'carpenter', tool: 'saw', recipe: { inputs: { log: 1 }, output: 'plank', ticks: 50 } }),
  stonecutter: building('stonecutter', 'Stonecutter', 'resources', 2, 2, 3, 'Stonecutter + pick', 'Rocks nearby', 'Stone', { worker: 'stonecutter', tool: 'pick' }),
  coal_mine: building('coal_mine', 'Coal mine', 'resources', 3, 4, 1, 'Miner + pick', 'Food', 'Coal', LATER),
  iron_mine: building('iron_mine', 'Iron mine', 'resources', 3, 4, 1, 'Miner + pick', 'Food', 'Iron ore', LATER),
  gold_mine: building('gold_mine', 'Gold mine', 'resources', 3, 5, 1, 'Miner + pick', 'Food', 'Gold ore', LATER),
  smelter: building('smelter', 'Iron smelter', 'resources', 3, 4, 6, 'Smelter', 'Iron ore, coal', 'Iron', LATER),
  toolsmith: building('toolsmith', 'Toolsmith', 'resources', 3, 3, 5, 'Smith + hammer', 'Iron, coal', 'Tools', LATER),

  farm: building('farm', 'Grain farm', 'food', 3, 6, 6, 'Farmer + scythe', 'Free fields nearby', 'Grain', { worker: 'farmer', tool: 'scythe' }),
  mill: building('mill', 'Mill', 'food', 3, 3, 3, 'Miller', 'Grain', 'Flour',
    { worker: 'miller', recipe: { inputs: { grain: 1 }, output: 'flour', ticks: 60 } }),
  bakery: building('bakery', 'Bakery', 'food', 3, 4, 5, 'Baker', 'Flour, water', 'Bread',
    { worker: 'baker', recipe: { inputs: { flour: 1, water: 1 }, output: 'bread', ticks: 70 } }),
  waterworks: building('waterworks', 'Waterworks', 'food', 2, 3, 4, 'Waterworker', 'Water nearby', 'Water',
    { worker: 'waterworker', placementType: 'near_water', recipe: { inputs: {}, output: 'water', ticks: 60 } }),
  fisher: building('fisher', 'Fisher', 'food', 2, 3, 2, 'Fisher + fishing rod', 'Water nearby', 'Fish',
    { worker: 'fisher', tool: 'rod', placementType: 'near_water' }),
  pig_farm: building('pig_farm', 'Pig farm', 'food', 3, 6, 6, 'Pig farmer', 'Grain, water', 'Pigs', LATER),
  slaughterhouse: building('slaughterhouse', 'Slaughterhouse', 'food', 3, 4, 4, 'Butcher + axe', 'Pigs', 'Meat', LATER),
  donkey_ranch: building('donkey_ranch', 'Donkey ranch', 'food', 3, 4, 4, 'Breeder', 'Grain, water', 'Donkeys', LATER),

  guard_tower_small: building('guard_tower_small', 'Small tower', 'military', 2, 2, 3, '1 soldier', 'A soldier', 'Territory (small)', { territoryRadius: 9 }),
  guard_tower_large: building('guard_tower_large', 'Large tower', 'military', 3, 5, 5, '1 soldier', 'A soldier', 'Territory (large)', { territoryRadius: 16 }),
  castle: building('castle', 'Castle', 'military', 4, 8, 12, 'Soldiers', 'Any goods', 'Territory, storage',
    { territoryRadius: 15, storageCapacity: Infinity, isAvailable: false }),
  lookout: building('lookout', 'Lookout tower', 'military', 2, 2, 4, 'Scout', 'Nothing', 'Vision', LATER),
  barracks: building('barracks', 'Barracks', 'military', 3, 4, 5, 'Trainer', 'Settlers, weapons', 'Soldiers', LATER),
  weaponsmith: building('weaponsmith', 'Weaponsmith', 'military', 3, 5, 7, 'Smith + hammer', 'Iron, coal', 'Weapons', LATER),

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
