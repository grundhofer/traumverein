/**
 * Deterministischer Zufallsgenerator (sfc32) mit Fork-Fähigkeit.
 * Math.random() ist im gesamten Projekt verboten – alles läuft hierüber,
 * damit Savegames und Spielverläufe reproduzierbar bleiben.
 */

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function seedToParts(seed) {
  const n = typeof seed === 'string' ? hashString(seed) : (seed >>> 0) || 1;
  let x = n;
  const parts = [];
  for (let i = 0; i < 4; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    parts.push((x + 0x9e3779b9 * (i + 1)) >>> 0);
  }
  return parts;
}

export function createRng(seed = 12345) {
  let [a, b, c, d] = seedToParts(seed);
  let counter = 0;

  function next() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    d = (d + 1) >>> 0;
    t = (t + d) >>> 0;
    counter++;
    return (t >>> 0) / 4294967296;
  }

  let spare = null;

  const rng = {
    next,
    int(min, max) {
      if (max === undefined) { max = min; min = 0; }
      if (max < min) return min;
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min = 0, max = 1) { return min + next() * (max - min); },
    chance(p) { return next() < p; },
    pick(arr) { return arr.length ? arr[Math.floor(next() * arr.length)] : undefined; },
    pickWeighted(items, weightFn) {
      let total = 0;
      const weights = items.map((it, i) => {
        const w = Math.max(0, weightFn(it, i) || 0);
        total += w;
        return w;
      });
      if (total <= 0) return rng.pick(items);
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    },
    pickMany(arr, n) {
      return rng.shuffle(arr).slice(0, n);
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    gauss(mean = 0, sd = 1) {
      if (spare !== null) { const v = spare; spare = null; return mean + sd * v; }
      let u = 0, v = 0, s = 0;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const mul = Math.sqrt(-2 * Math.log(s) / s);
      spare = v * mul;
      return mean + sd * (u * mul);
    },
    /** Wert um `mean`, geklemmt auf [min,max] – für Attributgenerierung. */
    around(mean, spread, min = 1, max = 99) {
      const v = Math.round(rng.gauss(mean, spread));
      return v < min ? min : v > max ? max : v;
    },
    fork(label = '') {
      return createRng(hashString(String(label) + ':' + a + ':' + b + ':' + c + ':' + d + ':' + counter));
    },
    state() { return { a, b, c, d, counter }; },
    setState(s) { a = s.a >>> 0; b = s.b >>> 0; c = s.c >>> 0; d = s.d >>> 0; counter = s.counter | 0; spare = null; }
  };

  return rng;
}

export { hashString };
