import { BUILDING_TYPES, DEPOSIT_COAL, DEPOSIT_IRON } from './definitions.ts';
import type { BuildingTypeId } from './definitions.ts';
import { BOT_DECISION_TICKS, decideBot } from './bot.ts';
import type { BotSpotFinder, SpotNeed } from './bot.ts';
import { groundProblem, placementProblem } from './commands.ts';
import { reachableFrom } from './pathfinding.ts';
import type { Command, CommandResult } from './commands.ts';
import { step } from './step.ts';
import { observe } from './vision.ts';
import {
  NO_FIELD, NO_TREE, TERRAIN_GRASS, TERRAIN_MOUNTAIN, TREE_MATURE, VISION_NONE, castleOf, createWorld, inBounds, tileIndex
} from './world.ts';
import type { World } from './world.ts';

/** A match: you (player 0) against one built-in computer player on a mirrored map. */
export function createMatch(seed: number): World {
  return createWorld({ seed, playerCount: 2 });
}

/**
 * One tick of a match. Bots decide every BOT_DECISION_TICKS from their own observation and submit commands
 * through the same validation as the human player. Returns the results of the human's commands.
 */
export function stepMatch(world: World, commands: readonly Command[] = []): CommandResult[] {
  const botCommands: Command[] = [];
  if (world.tick % BOT_DECISION_TICKS === 0 && world.winner === null) {
    for (const player of world.players) {
      if (!player.isBot || player.isEliminated) continue;
      botCommands.push(...decideBot(observe(world, player.id), spotFinder(world, player.id)));
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
  const militaryDoors = () => world.buildings
    .filter((b) => b.owner === playerId && BUILDING_TYPES[b.typeId].territoryRadius > 0)
    .map((b) => ({ x: b.doorX, y: b.doorY }));

  return {
    frontTile(towardX: number) {
      if (!castle) return null;
      const isReachable = reachableFrom(world, tileIndex(world, castle.doorX, castle.doorY));
      let best: { x: number; y: number } | null = null, bestScore = Infinity;
      for (let y = 0; y < world.height; y += 2) {
        for (let x = 0; x < world.width; x += 2) {
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
      const scored: { x: number; y: number; score: number }[] = [];
      for (let y = 0; y < world.height; y += stride) {
        for (let x = 0; x < world.width; x += stride) {
          if (world.territory[tileIndex(world, x, y)] !== owned) continue;
          if (groundProblem(world, playerId, typeId, x, y) !== null) continue;
          const doorX = x + Math.floor(size / 2), doorY = y + size;
          const toCastle = Math.hypot(doorX - castle.doorX, doorY - castle.doorY);
          let score = 0;
          switch (need) {
            case 'trees': around(doorX, doorY, 7, (i) => { if (world.tree[i] === TREE_MATURE) score += 3; else if (world.tree[i] >= 0) score += 1; }); score -= toCastle * 0.3; break;
            case 'rocks': around(doorX, doorY, 8, (i) => { score += world.rock[i]; }); score -= toCastle * 0.3; break;
            case 'water': score = -toCastle; break;
            case 'deposit_coal':
            case 'deposit_iron': {
              const deposit = need === 'deposit_coal' ? DEPOSIT_COAL : DEPOSIT_IRON;
              around(x + 1, y + 1, 3, (i) => { if (world.deposit[i] === deposit) score += world.depositAmount[i]; });
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
            case 'ore': {
              // Closest to ore on land the player has seen but does not own yet.
              let nearest = Infinity;
              around(doorX, doorY, 14, (i) => {
                if (world.deposit[i] !== 0 && world.depositAmount[i] > 0 && world.territory[i] !== owned) {
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
              around(doorX, doorY, 12, (i) => { if (world.terrain[i] === TERRAIN_MOUNTAIN && world.deposit[i] !== 0 && world.territory[i] !== owned) score += 0.2; });
              break;
            }
          }
          scored.push({ x, y, score });
        }
      }
      scored.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
      for (const spot of scored.slice(0, 6)) {
        if (placementProblem(world, playerId, typeId, spot.x, spot.y) === null) return { x: spot.x, y: spot.y };
      }
      return null;
    }
  };
}
