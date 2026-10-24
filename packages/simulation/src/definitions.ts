/** Static game data: goods, building types and their build menu groups. */

export const GOOD_TYPES = ['log', 'plank', 'stone'] as const;
export type GoodType = (typeof GOOD_TYPES)[number];
export type GoodAmounts = Record<GoodType, number>;

export const GOOD_LABELS: Record<GoodType, string> = { log: 'Logs', plank: 'Planks', stone: 'Stone' };

export function emptyGoods(): GoodAmounts {
  return { log: 0, plank: 0, stone: 0 };
}

export type SettlerType = 'carrier' | 'builder' | 'woodcutter' | 'forester' | 'carpenter' | 'stonecutter';

export const SETTLER_LABELS: Record<SettlerType, string> = {
  carrier: 'Carrier', builder: 'Builder', woodcutter: 'Woodcutter', forester: 'Forester',
  carpenter: 'Carpenter', stonecutter: 'Stonecutter'
};

export type BuildingGroupType = 'basic' | 'food' | 'metal' | 'military' | 'special';

export const BUILDING_GROUP_TYPES: readonly { id: BuildingGroupType; label: string }[] = [
  { id: 'basic', label: 'Basic' },
  { id: 'food', label: 'Food' },
  { id: 'metal', label: 'Mining & metal' },
  { id: 'military', label: 'Military' },
  { id: 'special', label: 'Special' }
];

export type BuildingTypeId =
  | 'castle'
  | 'woodcutter' | 'forester' | 'sawmill' | 'stonecutter' | 'warehouse'
  | 'farm' | 'mill' | 'bakery' | 'well' | 'fisher' | 'hunter'
  | 'coal_mine' | 'iron_mine' | 'smelter' | 'toolsmith' | 'weaponsmith'
  | 'guard_hut' | 'tower' | 'fort' | 'barracks'
  | 'donkey_farm' | 'lookout';

export interface BuildingType {
  id: BuildingTypeId;
  label: string;
  /** Null for buildings that cannot be placed from the build menu. */
  groupType: BuildingGroupType | null;
  /** Square footprint edge in tiles. */
  size: 2 | 3 | 4;
  cost: Partial<GoodAmounts>;
  worker: SettlerType | null;
  /** Shown in the build menu. */
  workerLabel: string;
  usesLabel: string;
  makesLabel: string;
  /** False for buildings shown in the menu but not playable yet. */
  isAvailable: boolean;
}

function building(
  id: BuildingTypeId, label: string, groupType: BuildingGroupType | null, size: 2 | 3 | 4,
  cost: Partial<GoodAmounts>, worker: SettlerType | null,
  workerLabel: string, usesLabel: string, makesLabel: string, isAvailable: boolean
): BuildingType {
  return { id, label, groupType, size, cost, worker, workerLabel, usesLabel, makesLabel, isAvailable };
}

export const BUILDING_TYPES: Record<BuildingTypeId, BuildingType> = {
  castle: building('castle', 'Castle', null, 4, {}, null, 'None', 'Any goods', 'Storage, new settlers', true),

  woodcutter: building('woodcutter', 'Woodcutter', 'basic', 2, { plank: 2 }, 'woodcutter', 'Woodcutter', 'Trees nearby', 'Logs', true),
  forester: building('forester', 'Forester', 'basic', 2, { plank: 2 }, 'forester', 'Forester', 'Free land nearby', 'New trees', true),
  sawmill: building('sawmill', 'Sawmill', 'basic', 3, { plank: 3, stone: 1 }, 'carpenter', 'Carpenter', 'Logs', 'Planks', true),
  stonecutter: building('stonecutter', 'Stonecutter', 'basic', 2, { plank: 2 }, 'stonecutter', 'Stonecutter', 'Rocks nearby', 'Stone', true),
  warehouse: building('warehouse', 'Warehouse', 'basic', 3, { plank: 4, stone: 4 }, null, 'None', 'Any goods', 'Storage', false),

  farm: building('farm', 'Grain farm', 'food', 3, { plank: 3, stone: 1 }, null, 'Farmer', 'Free fields', 'Grain', false),
  mill: building('mill', 'Mill', 'food', 3, { plank: 3, stone: 2 }, null, 'Miller', 'Grain', 'Flour', false),
  bakery: building('bakery', 'Bakery', 'food', 3, { plank: 2, stone: 2 }, null, 'Baker', 'Flour, water', 'Bread', false),
  well: building('well', 'Well', 'food', 2, { plank: 1, stone: 1 }, null, 'Water carrier', 'Ground water', 'Water', false),
  fisher: building('fisher', 'Fisher', 'food', 2, { plank: 2 }, null, 'Fisher', 'Water nearby', 'Fish', false),
  hunter: building('hunter', 'Hunter', 'food', 2, { plank: 2 }, null, 'Hunter', 'Game nearby', 'Meat', false),

  coal_mine: building('coal_mine', 'Coal mine', 'metal', 3, { plank: 3 }, null, 'Miner', 'Food', 'Coal', false),
  iron_mine: building('iron_mine', 'Iron mine', 'metal', 3, { plank: 3 }, null, 'Miner', 'Food', 'Iron ore', false),
  smelter: building('smelter', 'Smelter', 'metal', 3, { plank: 3, stone: 3 }, null, 'Smelter', 'Iron ore, coal', 'Iron', false),
  toolsmith: building('toolsmith', 'Toolsmith', 'metal', 3, { plank: 3, stone: 2 }, null, 'Smith', 'Iron, coal', 'Tools', false),
  weaponsmith: building('weaponsmith', 'Weaponsmith', 'metal', 3, { plank: 3, stone: 2 }, null, 'Smith', 'Iron, coal', 'Swords, bows', false),

  guard_hut: building('guard_hut', 'Guard hut', 'military', 2, { plank: 2, stone: 1 }, null, '1 soldier', 'Soldiers', 'Territory (small)', false),
  tower: building('tower', 'Tower', 'military', 3, { plank: 3, stone: 4 }, null, '3 soldiers', 'Soldiers', 'Territory (medium)', false),
  fort: building('fort', 'Fort', 'military', 4, { plank: 5, stone: 8 }, null, '6 soldiers', 'Soldiers', 'Territory (large)', false),
  barracks: building('barracks', 'Barracks', 'military', 4, { plank: 4, stone: 4 }, null, 'Trainer', 'Settlers, weapons', 'Soldiers', false),

  donkey_farm: building('donkey_farm', 'Donkey farm', 'special', 3, { plank: 3, stone: 1 }, null, 'Breeder', 'Grain, water', 'Pack donkeys', false),
  lookout: building('lookout', 'Lookout', 'special', 2, { plank: 2 }, null, 'Scout', 'Nothing', 'Vision (no territory)', false)
};

export function costTotal(cost: Partial<GoodAmounts>): number {
  let total = 0;
  for (const good of GOOD_TYPES) total += cost[good] ?? 0;
  return total;
}
