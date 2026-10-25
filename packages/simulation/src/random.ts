/** Small deterministic generator (mulberry32). The state is a uint32 so it can live in saves. */
export interface Random {
  state: number;
  next(): number;
}

export function createRandom(seed: number): Random {
  const random: Random = {
    state: seed >>> 0,
    next() {
      random.state = (random.state + 0x6d2b79f5) >>> 0;
      let t = random.state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };
  return random;
}
