/** Allgemeine Hilfsfunktionen – keine DOM-Abhängigkeiten. */

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inverseLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

export function round(v, decimals = 0) {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

export function sum(arr, fn) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += fn ? fn(arr[i], i) : arr[i];
  return s;
}

export function avg(arr, fn) {
  return arr.length ? sum(arr, fn) / arr.length : 0;
}

export function groupBy(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = keyFn(item);
    (out[k] || (out[k] = [])).push(item);
  }
  return out;
}

/**
 * sortBy(arr, p => p.age, p => ({ key: p.value, desc: true }))
 * Sortiert stabil, aufsteigend; ein Key kann als {key, desc:true} absteigend markiert werden.
 */
export function sortBy(arr, ...keyFns) {
  return arr.slice().sort((a, b) => {
    for (const fn of keyFns) {
      let ka = fn(a), kb = fn(b), desc = false;
      if (ka && typeof ka === 'object' && 'key' in ka) { desc = !!ka.desc; ka = ka.key; }
      if (kb && typeof kb === 'object' && 'key' in kb) { kb = kb.key; }
      if (ka === kb) continue;
      if (ka === undefined || ka === null) return 1;
      if (kb === undefined || kb === null) return -1;
      const cmp = ka < kb ? -1 : 1;
      return desc ? -cmp : cmp;
    }
    return 0;
  });
}

export function formatMoney(v) {
  const neg = v < 0;
  const a = Math.abs(Math.round(v));
  let s;
  if (a >= 1e9) s = (a / 1e9).toFixed(2).replace('.', ',') + ' Mrd €';
  else if (a >= 1e6) s = (a / 1e6).toFixed(2).replace('.', ',') + ' Mio €';
  else if (a >= 1e5) s = Math.round(a / 1e3) + ' Tsd €';
  else s = a.toLocaleString('de-DE') + ' €';
  return (neg ? '-' : '') + s;
}

export function formatMoneyShort(v) {
  const neg = v < 0;
  const a = Math.abs(Math.round(v));
  let s;
  if (a >= 1e9) s = (a / 1e9).toFixed(1).replace('.', ',') + 'Mrd';
  else if (a >= 1e6) s = (a / 1e6).toFixed(1).replace('.', ',') + 'M';
  else if (a >= 1e3) s = Math.round(a / 1e3) + 'T';
  else s = String(a);
  return (neg ? '-' : '') + s;
}

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Saison beginnt am 1. Juli. dayIndex 0 = 1. Juli des Saison-Startjahres. */
export function dateFromDayIndex(dayIndex, season = 1, startYear = 2025) {
  let d = ((dayIndex % 365) + 365) % 365;
  let month = 6; // Juli
  let year = startYear + (season - 1) + (dayIndex >= 184 ? 1 : 0);
  let day = d;
  let m = 6;
  let y = startYear + (season - 1);
  while (day >= MONTH_DAYS[m]) {
    day -= MONTH_DAYS[m];
    m++;
    if (m > 11) { m = 0; y++; }
  }
  month = m; year = y;
  return { day: day + 1, month, year, weekday: (dayIndex + 1) % 7 };
}

export function formatDate(dayIndex, season = 1, startYear = 2025) {
  const d = dateFromDayIndex(dayIndex, season, startYear);
  return `${WEEKDAYS[d.weekday]}, ${d.day}. ${MONTHS[d.month]} ${d.year}`;
}

export function formatDateShort(dayIndex, season = 1, startYear = 2025) {
  const d = dateFromDayIndex(dayIndex, season, startYear);
  return `${String(d.day).padStart(2, '0')}.${String(d.month + 1).padStart(2, '0')}.${d.year}`;
}

export function slug(str) {
  return String(str).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const out = {};
  for (const k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = deepClone(obj[k]);
  return out;
}

let uidCounter = 0;
export function uid(prefix = 'id', rng = null) {
  uidCounter++;
  const r = rng ? rng.int(0, 46655).toString(36) : (uidCounter * 7919 % 46656).toString(36);
  return `${prefix}_${uidCounter.toString(36)}${r}`;
}

export function pad(n, len = 2) { return String(n).padStart(len, '0'); }

export function percent(v, decimals = 0) { return round(v, decimals).toString().replace('.', ',') + ' %'; }

/** Ordnet einen 1..99-Wert einer Farbklasse zu (für Attributbalken). */
export function ratingClass(v) {
  if (v >= 85) return 'rat-elite';
  if (v >= 75) return 'rat-stark';
  if (v >= 65) return 'rat-gut';
  if (v >= 52) return 'rat-ok';
  if (v >= 40) return 'rat-schwach';
  return 'rat-mies';
}

export function nfmt(v, decimals = 0) {
  return round(v, decimals).toLocaleString('de-DE', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals
  });
}
