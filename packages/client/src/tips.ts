import { BUILDING_TYPES, TICKS_PER_SECOND, VISION_VISIBLE, isMilitaryBuilding, isSoldierType, isEnemy } from '../../simulation/src/index.ts';
import type { World } from '../../simulation/src/index.ts';

/**
 * Practice tips: short hints for a new player's first match, each shown once, when the game reaches the moment it
 * is about. They can be turned off in Settings.
 */
export interface Tip {
  id: string;
  text: string;
  detail: string;
  /** Whether the moment for this tip has come. */
  isDue: (world: World, owner: number) => boolean;
}

const MINUTE = 60 * TICKS_PER_SECOND;
const own = (world: World, owner: number) => world.buildings.filter((b) => b.owner === owner);

export const TIPS: readonly Tip[] = [
  {
    id: 'materials', text: 'Start with wood and stone',
    detail: 'Woodcutters near trees, a sawmill for planks and a stonecutter by the rocks: planks and stone build everything else.',
    isDue: (world) => world.tick > 3 * TICKS_PER_SECOND
  },
  {
    id: 'carriers', text: 'Carriers do the hauling',
    detail: 'Diggers level a site, carriers bring its planks and stone, builders put it up. Idle carriers mean there is room to build more.',
    isDue: (world, owner) => own(world, owner).some((b) => !b.isComplete && b.typeId !== 'castle')
  },
  {
    id: 'tools', text: 'Every job needs its tool',
    detail: 'A building waits until a worker with the right tool comes. The toolsmith makes them; order more under Goods › Tools.',
    isDue: (world, owner) => own(world, owner).some((b) => b.blockedReason?.startsWith('Missing tool') && b.blockedSince !== null && world.tick - b.blockedSince > 30 * TICKS_PER_SECOND)
  },
  {
    id: 'towers', text: 'Towers bring more land',
    detail: 'A small tower at your border claims the land around it once a soldier moves in. Build one when space runs short.',
    isDue: (world, owner) => world.tick > 4 * MINUTE && !own(world, owner).some((b) => isMilitaryBuilding(b) && b.typeId !== 'castle')
  },
  {
    id: 'food', text: 'Miners need food',
    detail: 'Mines work only while they get fish, bread or meat. Without food they stop.',
    isDue: (world, owner) => own(world, owner).some((b) => b.isComplete && BUILDING_TYPES[b.typeId].mine !== null)
  },
  {
    id: 'attack', text: 'Taking an enemy tower',
    detail: 'Select your soldiers (drag a box around them), then right-click an enemy tower, or press Attack and tap it. Beat the soldiers inside and it is yours.',
    isDue: (world, owner) => world.settlers.some((s) => isEnemy(world, owner, s.owner) && isSoldierType(s.settlerType) && !s.isInside
      && world.vision[owner]?.[Math.round(s.y) * world.width + Math.round(s.x)] === VISION_VISIBLE)
  }
];

/** The next tip due that has not been shown yet in this match, if any. */
export function nextTip(world: World, owner: number, shown: ReadonlySet<string>): Tip | null {
  return TIPS.find((t) => !shown.has(t.id) && t.isDue(world, owner)) ?? null;
}
