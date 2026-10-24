/** Movement-only experiment. World units are abstract; ticks are fixed at 100 ms. */
export const TICK_MS = 100;
export const STEP_DISTANCE = 0.5;

export function createWorld({ unitCount = 10_000, mapSize = 4096, seed = 1 } = {}) {
  if (!Number.isInteger(unitCount) || unitCount < 0 || unitCount > 100_000) {
    throw new RangeError('unitCount must be an integer between 0 and 100000');
  }
  if (!Number.isFinite(mapSize) || mapSize <= 0 || mapSize > 1_000_000) {
    throw new RangeError('mapSize must be between 0 (exclusive) and 1000000');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('seed must be a uint32');
  }
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const x = new Float64Array(unitCount);
  const y = new Float64Array(unitCount);
  const owner = new Uint8Array(unitCount);
  for (let i = 0; i < unitCount; i++) {
    x[i] = random() * mapSize;
    y[i] = random() * mapSize;
    owner[i] = i % 2;
  }
  return { tick: 0, mapSize, x, y, owner, targetX: x.slice(), targetY: y.slice() };
}

/** Validates the whole order before mutating any target. Two owners in this spike. */
export function orderMove(world, playerId, unitIds, target) {
  if (!Number.isInteger(playerId) || playerId < 0 || playerId > 1) {
    throw new RangeError('Invalid player');
  }
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)
      || target.x < 0 || target.y < 0 || target.x > world.mapSize || target.y > world.mapSize) {
    throw new RangeError('Target must be inside the map');
  }
  if (!Array.isArray(unitIds) || unitIds.length > world.x.length) {
    throw new RangeError('Invalid unit selection');
  }
  for (const id of unitIds) {
    if (!Number.isInteger(id) || id < 0 || id >= world.x.length || world.owner[id] !== playerId) {
      throw new RangeError('Invalid unit selection');
    }
  }
  for (const id of unitIds) {
    world.targetX[id] = target.x;
    world.targetY[id] = target.y;
  }
}

export function step(world) {
  for (let i = 0; i < world.x.length; i++) {
    const dx = world.targetX[i] - world.x[i];
    const dy = world.targetY[i] - world.y[i];
    const distance = Math.hypot(dx, dy);
    if (distance === 0) continue;
    const ratio = Math.min(1, STEP_DISTANCE / distance);
    world.x[i] += dx * ratio;
    world.y[i] += dy * ratio;
  }
  world.tick++;
}

/** JSON-compatible baseline save. Validate before restoring untrusted input. */
export function save(world) {
  return {
    version: 1, tick: world.tick, mapSize: world.mapSize,
    ...Object.fromEntries(['x', 'y', 'owner', 'targetX', 'targetY'].map(key => [key, Array.from(world[key])]))
  };
}

export function restore(data) {
  if (!data || data.version !== 1 || !Number.isSafeInteger(data.tick) || data.tick < 0
      || !Array.isArray(data.x)) throw new RangeError('Invalid save');
  const world = createWorld({ unitCount: data.x.length, mapSize: data.mapSize });
  for (const key of ['x', 'y', 'owner', 'targetX', 'targetY']) {
    const values = data[key];
    if (!Array.isArray(values) || values.length !== world.x.length
        || values.some(value => key === 'owner'
          ? !Number.isInteger(value) || value < 0 || value > 1
          : !Number.isFinite(value) || value < 0 || value > world.mapSize)) {
      throw new RangeError('Invalid save');
    }
    world[key].set(values);
  }
  world.tick = data.tick;
  return world;
}
