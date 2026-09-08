// Deterministic PRNG (mulberry32) with Box–Muller normals. Serializable state.
export function createRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  let spare = null;
  const rng = {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    normal() {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0, v = 0;
      while (u === 0) u = rng.next();
      v = rng.next();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    },
    int(lo, hi) { return lo + Math.floor(rng.next() * (hi - lo + 1)); },
    pick(arr) { return arr[Math.floor(rng.next() * arr.length)]; },
    chance(p) { return rng.next() < p; },
    // Serialization
    state() { return [a, spare === null ? 0 : 1, spare ?? 0]; },
    setState(s) { a = s[0] >>> 0; spare = s[1] ? s[2] : null; },
    fork() { return createRng(Math.floor(rng.next() * 4294967295)); },
  };
  return rng;
}
export function rngFromState(s) { const r = createRng(1); r.setState(s); return r; }
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
