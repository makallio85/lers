import { BUILDING_TYPES, DEPOSIT_COAL, DEPOSIT_GOLD, DEPOSIT_IRON, MAP_SIZE_SETTINGS, RACE_TYPES } from './definitions.ts';
import type { BuildingTypeId, MapSizeType, RaceType } from './definitions.ts';
import { BOT_DECISION_TICKS, decideBot } from './bot.ts';
import type { BotLogEntry, BotSpotFinder, BotType, SpotNeed } from './bot.ts';
import { groundProblem, placementProblem } from './commands.ts';
import { reachableFrom } from './pathfinding.ts';
import type { Command, CommandResult } from './commands.ts';
import { step } from './step.ts';
import { observe } from './vision.ts';
import {
  NO_FIELD, NO_TREE, TERRAIN_GRASS, TERRAIN_MOUNTAIN, TREE_MATURE, VISION_NONE, castleOf, createWorld, inBounds, isWalkable, tileIndex
} from './world.ts';
import type { World } from './world.ts';

/** How far a woodcutter or stonecutter walks for its work; spot scores count only what lies within it. */
const GATHER_REACH = 10;

/** A match: you (player 0) against one built-in computer player on a mirrored map. */
export function createMatch(seed: number, botType: BotType = 'aggressive', mapSize: MapSizeType = 'medium', playerRace: RaceType = 'romans', botRace?: RaceType): World {
  const { width, height } = MAP_SIZE_SETTINGS[mapSize];
  return createWorld({ seed, playerCount: 2, botType, width, height, raceTypes: [playerRace, botRace ?? computerRace(seed, playerRace)] });
}

/** The computer's people when none is chosen: another one than the player's, picked from the seed. */
export function computerRace(seed: number, playerRace: RaceType): RaceType {
  const others = RACE_TYPES.filter((r) => r !== playerRace);
  return others[seed % others.length];
}

/**
 * One tick of a match. Each bot decides every BOT_DECISION_TICKS, on its own tick, from its own observation and submit commands
 * through the same validation as the human player. Returns the results of the human's commands.
 * Pass `botLog` to collect what the bots decided and why.
 */
export function stepMatch(world: World, commands: readonly Command[] = [], botLog?: BotLogEntry[]): CommandResult[] {
  const botCommands: Command[] = [];
  if (world.winner === null) {
    for (const player of world.players) {
      if (!player.isBot || player.isEliminated) continue;
      // Each bot thinks on its own tick, so two bots never add up in one frame.
      const offset = Math.floor((player.id * BOT_DECISION_TICKS) / world.players.length);
      if ((world.tick + BOT_DECISION_TICKS - offset) % BOT_DECISION_TICKS !== 0) continue;
      const log = botLog && ((text: string) => { botLog.push({ tick: world.tick, playerId: player.id, text }); });
      botCommands.push(...decideBot(observe(world, player.id), spotFinder(world, player.id), log));
    }
  }
  return step(world, [...commands, ...botCommands]).slice(0, commands.length);
}

/**
 * Picks building spots on one player's own land. Scores read only tiles that player has explored, so a bot
 * gains nothing it could not see itself.
 */
export function spotFinder(world: World, playerId: number): BotSpotFinder {
  const owned = playerId + 1;
  const vision = world.vision[playerId];
  const prospect = world.prospect[playerId];
  const castle = castleOf(world, playerId);
  const around = (x: number, y: number, r: number, fn: (i: number) => void) => {
    for (let ty = y - r; ty <= y + r; ty++) {
      for (let tx = x - r; tx <= x + r; tx++) {
        if (!inBounds(world, tx, ty)) continue;
        const i = tileIndex(world, tx, ty);
        if (vision[i] !== VISION_NONE) fn(i);
      }
    }
  };
  // A player on the right half scans the map mirrored, so both players of a mirrored map see the same spots in
  // the same order and break ties the same way.
  const isRightSide = !!castle && castle.x + castle.size / 2 > world.width / 2;
  const mirrorX = (vx: number, size: number) => (isRightSide ? world.width - size - vx : vx);
  // Tiles the player's settlers can walk to from the castle, worked out once per decision.
  let reachable: ((tile: number) => boolean) | null = null;
  const isNearReachable = (x: number, y: number) => {
    if (!castle) return false;
    reachable ??= reachableFrom(world, tileIndex(world, castle.doorX, castle.doorY));
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (inBounds(world, x + dx, y + dy) && reachable(tileIndex(world, x + dx, y + dy))) return true;
    }
    return false;
  };
  /** What a gatherer at this door could work: unclaimed, on own land, within reach and walkable to. */
  const isWorkable = (i: number, doorX: number, doorY: number) => {
    const x = i % world.width, y = Math.floor(i / world.width);
    return world.territory[i] === owned && world.claim[i] === 0 && Math.hypot(x - doorX, y - doorY) <= GATHER_REACH && isNearReachable(x, y);
  };
  const militaryDoors = () => world.buildings
    .filter((b) => b.owner === playerId && BUILDING_TYPES[b.typeId].territoryRadius > 0)
    .map((b) => ({ x: b.doorX, y: b.doorY }));

  return {
    canReach(x: number, y: number) {
      return isNearReachable(x, y);
    },
    prospectTile() {
      // The nearest seen mountain without signs yet, on own land first.
      if (!castle) return null;
      let best: { x: number; y: number } | null = null, bestScore = Infinity;
      for (let y = 0; y < world.height; y++) {
        for (let vx = 0; vx < world.width; vx++) {
          const x = mirrorX(vx, 1);
          const i = tileIndex(world, x, y);
          if (vision[i] === VISION_NONE || world.terrain[i] !== TERRAIN_MOUNTAIN || prospect[i] === 1 || !isWalkable(world, i)) continue;
          const score = Math.hypot(x - castle.doorX, y - castle.doorY) + (world.territory[i] === owned ? 0 : 25);
          if (score >= bestScore) continue;
          reachable ??= reachableFrom(world, tileIndex(world, castle.doorX, castle.doorY));
          if (reachable(i)) { bestScore = score; best = { x, y }; }
        }
      }
      return best;
    },
    frontTile(towardX: number) {
      if (!castle) return null;
      const isReachable = reachableFrom(world, tileIndex(world, castle.doorX, castle.doorY));
      let best: { x: number; y: number } | null = null, bestScore = Infinity;
      for (let y = 0; y < world.height; y += 2) {
        for (let vx = 0; vx < world.width; vx += 2) {
          const x = mirrorX(vx, 1);
          const i = tileIndex(world, x, y);
          if (vision[i] === VISION_NONE || !isReachable(i)) continue;
          const score = Math.abs(x - towardX) + Math.abs(y - castle.doorY) * 0.3;
          if (score < bestScore) { bestScore = score; best = { x, y }; }
        }
      }
      return best;
    },
    findSpot(typeId: BuildingTypeId, need: SpotNeed, towardX: number) {
      if (!castle) return null;
      const size = BUILDING_TYPES[typeId].size;
      const stride = BUILDING_TYPES[typeId].placementType === 'mountain' ? 1 : 2;
      const military = need === 'border' ? militaryDoors() : [];
      const scored: { x: number; y: number; vx: number; score: number }[] = [];
      for (let y = 0; y < world.height; y += stride) {
        for (let vx = 0; vx < world.width; vx += stride) {
          const x = mirrorX(vx, size);
          if (x < 0) continue;
          if (world.territory[tileIndex(world, x, y)] !== owned) continue;
          if (groundProblem(world, playerId, typeId, x, y) !== null) continue;
          const doorX = x + Math.floor(size / 2), doorY = y + size;
          const toCastle = Math.hypot(doorX - castle.doorX, doorY - castle.doorY);
          let score = 0;
          switch (need) {
            case 'trees':
              // Only trees the woodcutter may fell: on own land, within its reach. A forester plants its own.
              around(doorX, doorY, GATHER_REACH, (i) => {
                if (world.tree[i] === NO_TREE || !isWorkable(i, doorX, doorY)) return;
                score += world.tree[i] === TREE_MATURE ? 3 : 1;
              });
              if (score === 0 && typeId !== 'forester') continue;
              score -= toCastle * 0.3;
              break;
            case 'rocks':
              around(doorX, doorY, GATHER_REACH, (i) => { if (world.rock[i] > 0 && isWorkable(i, doorX, doorY)) score += world.rock[i]; });
              if (score === 0) continue;
              score -= toCastle * 0.3;
              break;
            case 'water': score = -toCastle; break;
            case 'deposit_coal':
            case 'deposit_iron':
            case 'deposit_gold': {
              const deposit = need === 'deposit_coal' ? DEPOSIT_COAL : need === 'deposit_iron' ? DEPOSIT_IRON : DEPOSIT_GOLD;
              // Only ore the player's own geologists have marked.
              around(x + 1, y + 1, 3, (i) => { if (prospect[i] === 1 && world.deposit[i] === deposit) score += world.depositAmount[i]; });
              if (score === 0) continue;
              score -= toCastle * 0.5;
              break;
            }
            case 'free_land':
              around(doorX, doorY, 4, (i) => {
                if (world.terrain[i] === TERRAIN_GRASS && world.tree[i] === NO_TREE && world.rock[i] === 0
                  && world.field[i] === NO_FIELD && world.footprint[i] === 0 && world.territory[i] === owned) score += 1;
              });
              score -= toCastle * 0.4;
              break;
            case 'castle': score = -toCastle; break;
            case 'ore':
            case 'distant_rocks': {
              // Closest to ore (or rocks) on land the player has seen but does not own yet.
              let nearest = Infinity;
              // Ore: marked ore, or mountains nobody has looked at yet, which may hold some.
              const isWanted = need === 'ore'
                ? (i: number) => world.terrain[i] === TERRAIN_MOUNTAIN && (prospect[i] === 0 || (world.deposit[i] !== 0 && world.depositAmount[i] > 0))
                : (i: number) => world.rock[i] > 0;
              around(doorX, doorY, 14, (i) => {
                if (isWanted(i) && world.territory[i] !== owned) {
                  nearest = Math.min(nearest, Math.hypot((i % world.width) - doorX, Math.floor(i / world.width) - doorY));
                }
              });
              if (nearest === Infinity) continue;
              score = -nearest;
              break;
            }
            case 'border': {
              const spread = Math.min(...military.map((m) => Math.hypot(doorX - m.x, doorY - m.y)));
              score = Math.min(spread, 14) * 2 - Math.abs(doorX - towardX) * 0.4;
              // Unclaimed mountains with ore nearby make a tower spot more valuable.
              around(doorX, doorY, 12, (i) => { if (world.terrain[i] === TERRAIN_MOUNTAIN && world.territory[i] !== owned) score += 0.2; });
              break;
            }
          }
          scored.push({ x, y, vx, score });
        }
      }
      scored.sort((a, b) => b.score - a.score || a.y - b.y || a.vx - b.vx);
      for (const spot of scored.slice(0, 6)) {
        if (placementProblem(world, playerId, typeId, spot.x, spot.y) === null) return { x: spot.x, y: spot.y };
      }
      return null;
    }
  };
}
