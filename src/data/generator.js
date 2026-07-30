/**
 * Prozedurale Erzeugung von Spielern, Kadern, Talenten und Betreuerstab.
 *
 * Alle Zufallsentscheidungen laufen über die übergebene Rng-Instanz
 * (core/rng.js) – kein Math.random(), kein Date.now().
 *
 * Die Spielerobjekte entstehen immer über mk() aus squads/_helper.js, damit
 * handgeschriebene und generierte Kader exakt dieselbe Struktur haben.
 * Aussehen und Charakterattribute werden hier explizit gesetzt, damit die
 * Spieler optisch und spielerisch spürbar unterschiedlich ausfallen.
 */

import { POSITION_AFFINITY, POSITION_WEIGHTS } from '../core/constants.js';
import { clamp, slug } from '../core/util.js';
import { mk, deriveValue, deriveSalary } from './squads/_helper.js';
import {
  NATION_POOL_YOUTH, NATION_POOL_TRANSFER, STAFF_NAMES, pickName, pickNation
} from './names.js';

/* ------------------------------------------------------------------ *
 * Aussehen
 * ------------------------------------------------------------------ */

/** Hautton-Tendenz nach Nation (0 = sehr hell … 5 = sehr dunkel). */
const SKIN_BY_NATION = {
  DE: [0, 1, 1, 1, 2], AT: [0, 1, 1], CH: [0, 1, 1], NL: [0, 1, 1, 2], BE: [0, 1, 2],
  DK: [0, 0, 1], SE: [0, 0, 1], NO: [0, 0, 1], FI: [0, 0, 1], PL: [0, 1], CZ: [0, 1],
  SK: [0, 1], SI: [0, 1], HU: [0, 1], RO: [1, 1, 2], BG: [1, 1], UA: [0, 1],
  EN: [0, 1, 2, 3], IE: [0, 1], FR: [1, 2, 3, 4], ES: [1, 2], PT: [1, 2, 3], IT: [1, 2],
  GR: [1, 2], HR: [0, 1], RS: [0, 1], BA: [0, 1], AL: [1, 2], XK: [1, 2], TR: [1, 2, 3],
  GE: [1, 2], BR: [1, 2, 3, 4], AR: [1, 1, 2], UY: [1, 2], CL: [1, 2], CO: [2, 3],
  PE: [2, 3], EC: [2, 3, 4], MX: [2, 3], US: [1, 2, 3, 4], JP: [1, 2], KR: [1, 2],
  EG: [2, 3], MA: [2, 3], DZ: [2, 3], TN: [2, 3], SN: [5, 5, 4], NG: [5, 5, 4],
  GH: [5, 4], CM: [5, 4], CI: [5, 4], ML: [5, 4], ZA: [3, 4, 5], AU: [0, 1, 2]
};

const HAIR_LIGHT = [
  ['kurz', 30], ['mittel', 17], ['undercut', 15], ['locken', 9], ['glatze', 7],
  ['lang', 7], ['zopf', 4], ['irokese', 3], ['vokuhila', 3], ['afro', 1]
];
const HAIR_DARK = [
  ['kurz', 24], ['afro', 20], ['zopf', 13], ['glatze', 11], ['undercut', 10],
  ['locken', 8], ['mittel', 7], ['irokese', 4], ['lang', 2], ['vokuhila', 1]
];
const BEARDS = [
  ['keiner', 24], ['stoppeln', 26], ['vollbart', 19], ['kinnbart', 17],
  ['koteletten', 8], ['schnauzer', 6]
];
const BUILDS = [['schlank', 30], ['normal', 46], ['kraeftig', 24]];

const HAIR_COLORS_LIGHT = ['#1b1310', '#2b1d14', '#4a3221', '#6b4a2a', '#8a6b3d', '#b58b4c', '#d9bb7a'];
const HAIR_COLORS_DARK = ['#120d0a', '#1b1310', '#241a12'];
const HAIR_COLORS_NORDIC = ['#8a6b3d', '#b58b4c', '#d9bb7a', '#e0c98a', '#6b4a2a', '#4a3221'];
const GREY_HAIR = ['#8f8f8f', '#a5a5a5', '#7a7a7a'];
const EYE_COLORS_LIGHT = ['#3a2a1a', '#2d1f14', '#4a3b23', '#3c5a72', '#4d6b4a', '#5a5a5a'];
const EYE_COLORS_DARK = ['#2d1f14', '#241a12', '#3a2a1a'];

const NORDIC = ['SE', 'NO', 'DK', 'FI', 'NL', 'DE', 'AT', 'CH', 'BE', 'PL', 'CZ', 'IE', 'EN'];

/** Körpergröße nach Position (Mittelwert, Streuung). */
const HEIGHT_BY_POS = {
  TW: [190, 4], IV: [187, 4], LV: [179, 4], RV: [179, 4], DM: [183, 5], ZM: [180, 5],
  LM: [178, 5], RM: [178, 5], OM: [177, 5], LA: [176, 5], RA: [176, 5], ST: [184, 6]
};

function pickw(rng, pairs) {
  return rng.pickWeighted(pairs, (p) => p[1])[0];
}

/** Erzeugt ein vielfältiges, zur Nation passendes Aussehen. */
function makeAppearance(rng, nat, age, pos, look) {
  const skinPool = SKIN_BY_NATION[nat] || [1, 2, 3];
  const skin = look && look.skin !== undefined ? look.skin : rng.pick(skinPool);
  const dark = skin >= 4;

  let hair = pickw(rng, dark ? HAIR_DARK : HAIR_LIGHT);
  if (age >= 32 && rng.chance(0.25)) hair = rng.chance(0.5) ? 'glatze' : 'kurz';
  if (age <= 19 && hair === 'glatze') hair = 'kurz';

  let hairColor;
  if (dark) hairColor = rng.pick(HAIR_COLORS_DARK);
  else if (age >= 33 && rng.chance(0.3)) hairColor = rng.pick(GREY_HAIR);
  else if (NORDIC.includes(nat) && rng.chance(0.45)) hairColor = rng.pick(HAIR_COLORS_NORDIC);
  else hairColor = rng.pick(HAIR_COLORS_LIGHT);
  if (rng.chance(0.03)) hairColor = '#c9c9c9'; // gebleicht

  let beard = pickw(rng, BEARDS);
  if (age <= 19 && rng.chance(0.6)) beard = rng.chance(0.5) ? 'keiner' : 'stoppeln';

  const build = pos === 'TW' && rng.chance(0.5) ? 'kraeftig' : pickw(rng, BUILDS);
  const [hMean, hSd] = HEIGHT_BY_POS[pos] || [180, 5];
  const heightBias = build === 'kraeftig' ? 2 : build === 'schlank' ? -1 : 0;
  const height = clamp(Math.round(rng.gauss(hMean + heightBias, hSd)), 165, 202);

  let accessory = 'keiner';
  if (pos === 'TW') accessory = 'handschuhe';
  else if (rng.chance(0.05)) accessory = 'stirnband';
  else if (rng.chance(0.015)) accessory = 'brille';

  const app = {
    skin,
    hair,
    hairColor,
    beard,
    build,
    height,
    eyes: dark ? rng.pick(EYE_COLORS_DARK) : rng.pick(EYE_COLORS_LIGHT),
    accessory,
    face: rng.int(0, 7)
  };
  return look ? Object.assign(app, look) : app;
}

/* ------------------------------------------------------------------ *
 * Attribute, Fuß, Nebenpositionen, Eigenschaften
 * ------------------------------------------------------------------ */

/** Wunschnummern je Position – aus dem Nummernpool wird die erste freie genommen. */
const PREFERRED_NUMBERS = {
  TW: [1, 12, 22, 30, 40],
  IV: [4, 5, 3, 6, 2, 15, 25, 35],
  LV: [3, 2, 18, 26, 34],
  RV: [2, 3, 24, 27, 36],
  DM: [6, 8, 16, 28, 38],
  ZM: [8, 6, 10, 14, 20, 31],
  LM: [7, 11, 17, 19, 29],
  RM: [7, 11, 17, 23, 27],
  OM: [10, 8, 21, 29, 37],
  LA: [11, 7, 19, 31, 33],
  RA: [7, 11, 17, 33, 39],
  ST: [9, 10, 11, 13, 19, 32, 39]
};

/** Wahrscheinlichkeit für den linken Fuß je Position. */
const LEFT_FOOT = { LV: 0.62, LM: 0.5, LA: 0.44, IV: 0.22, TW: 0.14, RV: 0.05, RM: 0.08, RA: 0.12 };

/**
 * Charakterprofil: 1–2 herausragende und 1 schwaches Positionsattribut,
 * dazu die nirgends gewichteten Attribute `fuehrung` und `standards`.
 * mk() gleicht die übrigen Werte wieder auf `ovr` aus.
 */
function characterAttributes(rng, pos, ovr, age, traits) {
  const weights = POSITION_WEIGHTS[pos] || POSITION_WEIGHTS.ZM;
  const keys = rng.shuffle(Object.keys(weights));
  const att = {};
  const strongCount = rng.int(1, 2);
  for (let i = 0; i < strongCount && i < keys.length; i++) {
    att[keys[i]] = clamp(Math.round(ovr + rng.int(4, 11)), 12, 99);
  }
  if (keys.length > strongCount + 1) {
    att[keys[strongCount]] = clamp(Math.round(ovr - rng.int(4, 10)), 8, 99);
  }
  const leader = traits.includes('leader') || traits.includes('kabinenleader');
  att.fuehrung = clamp(Math.round(
    rng.gauss(24 + Math.max(0, age - 20) * 2.1 + (ovr - 60) * 0.45 + (leader ? 22 : 0), 8)
  ), 5, 97);
  att.standards = clamp(Math.round(
    rng.gauss(ovr - 10 + (traits.includes('freistossspezialist') ? 22 : 0)
      + (traits.includes('eckenspezialist') ? 12 : 0), 9)
  ), 8, 97);
  return att;
}

/** 0–3 Nebenpositionen aus der Positions-Verwandtschaft. */
function makeAltPositions(rng, pos) {
  const aff = POSITION_AFFINITY[pos] || {};
  const cand = Object.keys(aff).filter((k) => k !== pos && aff[k] >= 0.7);
  if (!cand.length) return [];
  const n = rng.chance(0.28) ? 0 : rng.int(1, Math.min(3, cand.length));
  const out = [];
  const pool = cand.slice();
  for (let i = 0; i < n && pool.length; i++) {
    const p = rng.pickWeighted(pool, (k) => aff[k]);
    out.push(p);
    pool.splice(pool.indexOf(p), 1);
  }
  return out;
}

/** Würfelt 0–3 Eigenschaften aus TRAITS passend zu Position, Stärke und Alter. */
function rollTraits(rng, pos, ovr, pot, age) {
  const out = [];
  const add = (key, p) => { if (out.length < 3 && rng.chance(p)) out.push(key); };
  const elite = ovr >= 80, stark = ovr >= 72;

  if (pos === 'TW') {
    add('torwartlegende', elite ? 0.3 : stark ? 0.1 : 0.02);
    add('eisblock', 0.1);
  } else {
    add('weltfussballer', elite ? 0.18 : 0);
    if (pos === 'ST' || pos === 'LA' || pos === 'RA') {
      add('knipser', stark ? 0.24 : 0.1);
      add('tempodribbler', 0.16);
      add('kopfballungeheuer', pos === 'ST' ? 0.14 : 0.04);
    }
    if (pos === 'IV') {
      add('kopfballungeheuer', 0.22);
      add('eisenfuss', 0.16);
    }
    if (pos === 'DM' || pos === 'ZM' || pos === 'OM') {
      add('spielmacher_trait', stark ? 0.2 : 0.08);
      add('freistossspezialist', 0.12);
      add('eckenspezialist', 0.12);
    }
    if (pos === 'LV' || pos === 'RV' || pos === 'LM' || pos === 'RM') {
      add('laufwunder', 0.16);
      add('eckenspezialist', 0.08);
    }
    add('elfmeterkiller', 0.07);
  }
  if (age >= 29) add('leader', ovr >= 70 ? 0.3 : 0.12);
  if (age >= 27) add('kabinenleader', 0.1);
  if (age <= 21 && pot - ovr >= 14) add('wunderkind', 0.24);
  if (age >= 25 && pot - ovr >= 4) add('spaetzuender', 0.1);
  add('eisblock', 0.08);
  add('glasknochen', 0.06);
  add('mimose', 0.06);
  add('querulant', 0.05);
  add('fanliebling', ovr >= 74 ? 0.14 : 0.05);
  return out.slice(0, 3);
}

/** Potenzialaufschlag über der aktuellen Stärke, abhängig vom Alter. */
function potGap(rng, age) {
  if (age <= 18) return rng.int(9, 22);
  if (age <= 20) return rng.int(6, 17);
  if (age <= 22) return rng.int(4, 13);
  if (age <= 24) return rng.int(2, 9);
  if (age <= 26) return rng.int(0, 5);
  if (age <= 29) return rng.int(0, 2);
  return 0;
}

/** Kurzer ID-Zusatz aus der Rng (verhindert Namensdubletten im selben Verein). */
function makeSuffix(rng) {
  return rng.int(0, 46655).toString(36);
}

/* ------------------------------------------------------------------ *
 * Spieler
 * ------------------------------------------------------------------ */

/**
 * Erzeugt einen vollständigen Spieler (Datenteil ohne Laufzeitfelder).
 *
 * @param {object} rng   Rng-Instanz
 * @param {object} opts  { clubId, club, position, ovr, pot, age, nation, era,
 *                         numberPool, nationPool, until, salaryFactor,
 *                         traits, look, idClub, idSuffix, shortName }
 *
 * `club` (das Club-Objekt) bestimmt über die Gehaltsskala aus squads/_helper.js
 * das Gehaltsniveau. Ohne `club` entsteht ein Weltmarktgehalt – das ist für
 * Vertragslose und Jugendspieler richtig, für einen Kader nicht.
 */
export function generatePlayer(rng, opts = {}) {
  const o = opts || {};
  const clubId = o.clubId === undefined ? null : o.clubId;
  const nation = o.nation || pickNation(rng, o.nationPool || NATION_POOL_TRANSFER);
  const position = o.position || rng.pickWeighted(
    ['TW', 'IV', 'LV', 'RV', 'DM', 'ZM', 'LM', 'RM', 'OM', 'LA', 'RA', 'ST'],
    (p) => (p === 'TW' ? 8 : p === 'IV' ? 14 : p === 'ZM' ? 12 : 9)
  );
  const age = clamp(Math.round(o.age !== undefined ? o.age : rng.gauss(25, 4)), 15, 40);
  const ovr = clamp(Math.round(o.ovr !== undefined ? o.ovr : rng.gauss(62, 7)), 20, 99);
  const pot = clamp(Math.round(o.pot !== undefined ? o.pot : ovr + potGap(rng, age)), ovr, 99);

  const { firstName, lastName } = pickName(rng, nation);
  const traits = o.traits || rollTraits(rng, position, ovr, pot, age);
  const leftP = LEFT_FOOT[position] !== undefined ? LEFT_FOOT[position] : 0.2;
  const foot = rng.chance(0.05) ? 'beidfüßig' : (rng.chance(leftP) ? 'links' : 'rechts');

  let number = o.number;
  if (number === undefined && Array.isArray(o.numberPool) && o.numberPool.length) {
    // Wunschnummer der Position bevorzugen, sonst irgendeine freie Nummer.
    const wish = PREFERRED_NUMBERS[position] || [];
    let idx = -1;
    for (const w of wish) {
      const i = o.numberPool.indexOf(w);
      if (i >= 0 && rng.chance(0.92)) { idx = i; break; }
    }
    if (idx < 0) idx = rng.int(0, o.numberPool.length - 1);
    number = o.numberPool.splice(idx, 1)[0];
  }
  if (number === undefined) number = position === 'TW' ? rng.pick([1, 12, 22]) : rng.int(2, 39);

  const value = o.value !== undefined ? o.value : deriveValue(ovr, pot, age);
  const salary = o.salary !== undefined
    ? o.salary
    : Math.max(60000, Math.round(deriveSalary(ovr, value, age, o.club) * (o.salaryFactor || 1) / 10000) * 10000);

  // Brasilianer und Portugiesen laufen oft nur unter dem Vornamen auf.
  const shortName = o.shortName
    || ((nation === 'BR' && rng.chance(0.55)) ? firstName : lastName);

  const player = mk({
    club: o.idClub || clubId || 'frei',
    idSuffix: o.idSuffix || makeSuffix(rng),
    vn: firstName,
    nn: lastName,
    shortName,
    pos: position,
    alt: o.altPositions || makeAltPositions(rng, position),
    ovr,
    pot,
    age,
    nat: nation,
    era: o.era || 'modern',
    eraLabel: o.eraLabel || null,
    foot,
    traits,
    att: characterAttributes(rng, position, ovr, age, traits),
    look: makeAppearance(rng, nation, age, position, o.look),
    nr: number,
    until: o.until !== undefined ? o.until : rng.int(1, 4),
    value,
    salary
  });
  player.clubId = clubId;
  return player;
}

/* ------------------------------------------------------------------ *
 * Kaderstärke aus der Vereinsreputation
 * ------------------------------------------------------------------ */

/**
 * Ziel-Durchschnittsstärke eines Kaders aus club.reputation (1..100),
 * leicht nachjustiert über Liga-Ebene und Trainingsinfrastruktur.
 */
export function ovrForClub(club) {
  const c = club || {};
  const rep = clamp(c.reputation === undefined ? 50 : c.reputation, 1, 100);
  let base = 42 + rep * 0.38;                       // rep 95 -> 78,1  rep 66 -> 67,1  rep 34 -> 54,9
  const league = c.leagueId;
  // 'europa' sind die Gegner aus core/state.js:euroClub(). Ohne eigenen Fall
  // fielen sie in den Amateur-Zweig (−5) und Real Madrid käme mit Reputation 98
  // schwächer aus der Fabrik als der FC Bayern – der Zuschlag von +3,5 stellt
  // die Rangfolge wieder her (rep 98 -> 84,0, rep 57 -> 67,2).
  base += league === 'bl1' ? 2.5 : league === 'bl2' ? -2.5
    : league === 'europa' ? 3.5 : league ? -5 : 0;
  const fac = c.facilities || {};
  if (fac.training !== undefined) base += (clamp(fac.training, 1, 100) - 50) * 0.02;
  if (fac.youth !== undefined) base += (clamp(fac.youth, 1, 100) - 50) * 0.01;
  return clamp(Math.round(base * 10) / 10, 42, 86);
}

/* ------------------------------------------------------------------ *
 * Kader
 * ------------------------------------------------------------------ */

const GROUP_ORDER = ['TW', 'ABW', 'MIT', 'STU'];
const GROUP_POSITIONS = {
  TW: ['TW'],
  ABW: ['IV', 'LV', 'RV', 'IV', 'IV', 'RV', 'LV', 'IV', 'IV'],
  MIT: ['ZM', 'DM', 'LM', 'RM', 'ZM', 'OM', 'DM', 'ZM', 'OM'],
  STU: ['ST', 'ST', 'LA', 'RA', 'ST', 'LA', 'RA']
};
/** Stammelf-Anteil je Gruppe: 1 + 4 + 4 + 2 = 11. */
const GROUP_STARTERS = { TW: 1, ABW: 4, MIT: 4, STU: 2 };

/** Positionsverteilung für eine beliebige Kadergröße (Standard 3/8/8/5). */
function planForSize(size) {
  const s = clamp(Math.round(size), 14, 40);
  let tw = clamp(Math.round(s * 0.125), 2, 4);
  let abw = clamp(Math.round(s * 0.3333), 5, 12);
  let stu = clamp(Math.round(s * 0.2083), 3, 9);
  let mit = s - tw - abw - stu;
  while (mit < 4 && abw > 5) { abw--; mit++; }
  while (mit < 4 && stu > 3) { stu--; mit++; }
  while (mit > 10 && abw < 12) { abw++; mit--; }
  return { TW: tw, ABW: abw, MIT: mit, STU: stu };
}

function buildSlots(plan) {
  const slots = [];
  for (const g of GROUP_ORDER) {
    const n = plan[g];
    const positions = GROUP_POSITIONS[g];
    const starters = GROUP_STARTERS[g];
    const rotation = Math.max(1, Math.round((n - starters) * 0.5));
    for (let i = 0; i < n; i++) {
      slots.push({
        group: g,
        position: positions[i % positions.length],
        tier: i < starters ? 0 : (i < starters + rotation ? 1 : 2)
      });
    }
  }
  return slots;
}

/** Rückennummern: 1/12/22 für Torhüter, 2–11 für die Stammelf, Rest darüber. */
function makeNumberPools(rng) {
  const rest = [];
  for (let n = 13; n <= 45; n++) if (n !== 22 && n !== 30 && n !== 40) rest.push(n);
  return {
    tw: rng.shuffle([1, 12, 22, 30, 40]),
    starter: rng.shuffle([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    rest: rng.shuffle(rest)
  };
}

const AGE_MEAN = { jung: 23.2, ausgeglichen: 25.4, erfahren: 27.4 };

/**
 * Erzeugt einen kompletten Kader.
 *
 * @param {object} rng   Rng-Instanz
 * @param {object} club  Club-Objekt (id, reputation, leagueId, facilities …)
 * @param {object} opts  { size=24, avgOvr, ageProfile, nationPool, talents, veterans }
 * @returns {Array} Spieler in Kaderreihenfolge (Tor, Abwehr, Mittelfeld, Sturm)
 */
export function generateSquad(rng, club, opts = {}) {
  const o = opts || {};
  const c = club || {};
  const clubId = c.id || o.clubId || 'verein';
  const size = clamp(Math.round(o.size === undefined ? 24 : o.size), 14, 40);
  const avgOvr = clamp(o.avgOvr === undefined ? ovrForClub(c) : o.avgOvr, 38, 88);
  const rep = clamp(c.reputation === undefined ? 50 : c.reputation, 1, 100);
  const ageMean = AGE_MEAN[o.ageProfile] || AGE_MEAN.ausgeglichen;

  const slots = buildSlots(planForSize(size));

  // --- Zielstärken: Stammelf deutlich über der Bank, Schnitt trifft avgOvr ---
  let acc = 0;
  for (const s of slots) {
    s.ovr = avgOvr + (s.tier === 0 ? rng.float(3, 8) : s.tier === 1 ? rng.float(-2.5, 3) : rng.float(-12, -4));
    acc += s.ovr;
  }
  const shift = avgOvr - acc / slots.length;
  for (const s of slots) s.ovr = clamp(Math.round(s.ovr + shift), 30, 93);

  // --- Altersstruktur ------------------------------------------------------
  for (const s of slots) {
    const m = s.tier === 0 ? ageMean + 1.2 : s.tier === 1 ? ageMean - 0.4 : ageMean - 2.8;
    s.age = clamp(Math.round(rng.gauss(m, 3.3)), 17, 37);
  }

  // --- Ex-Bundesliga-Routiniers (je nach Tradition/Reputation) -------------
  const vetMax = o.veterans !== undefined ? o.veterans : (rep >= 60 ? 3 : rep >= 45 ? 2 : 1);
  const vetCount = rng.int(rep >= 60 ? 2 : rep >= 45 ? 1 : 0, Math.max(0, vetMax));
  const vetPool = rng.shuffle(slots.filter((s) => s.tier <= 1));
  for (let i = 0; i < vetCount && i < vetPool.length; i++) {
    const s = vetPool[i];
    s.age = rng.int(31, 35);
    const damp = Math.max(0, 66 - avgOvr) * 0.55;
    s.ovr = Math.max(s.ovr, Math.min(82, Math.round(rng.int(71, 78) - damp)));
    s.pot = s.ovr;
    s.veteran = true;
  }

  // --- Toptalente ----------------------------------------------------------
  const talentCount = o.talents !== undefined ? o.talents : rng.int(2, 4);
  const talentPool = rng.shuffle(slots.filter((s) => !s.veteran && s.tier >= 1));
  for (let i = 0; i < talentCount && i < talentPool.length; i++) {
    const s = talentPool[i];
    s.age = rng.int(17, 20);
    s.ovr = clamp(s.ovr - rng.int(1, 5), 32, 76);
    const top = i === 0 && rep >= 45;
    let pot = s.ovr + rng.int(top ? 18 : 10, top ? 28 : 20);
    if (top) pot = Math.max(pot, rng.int(80, 88));
    s.pot = clamp(pot, s.ovr + 6, 93);
    s.talent = true;
  }

  for (const s of slots) if (s.pot === undefined) s.pot = clamp(s.ovr + potGap(rng, s.age), s.ovr, 95);

  // --- Spieler bauen -------------------------------------------------------
  const numbers = makeNumberPools(rng);
  const intl = clamp(0.16 + (rep - 35) * 0.006, 0.12, 0.55);
  // Das Gehaltsniveau steckt in der Gehaltsskala von squads/_helper.js
  // (wirtschaftskraft → gehaltsSpitze) und wird über `club` weitergereicht.
  // Ein eigener Liga- und Reputationsfaktor wäre eine zweite, widersprüchliche
  // Skala; `salaryFactor` bleibt nur als ausdrücklicher Regler für Aufrufer.
  const salaryFactor = o.salaryFactor;
  const used = new Set();
  const players = [];

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const pool = s.position === 'TW' ? numbers.tw : (s.tier === 0 ? numbers.starter : numbers.rest);
    const nationPool = o.nationPool || (rng.chance(intl) ? NATION_POOL_TRANSFER : NATION_POOL_YOUTH);
    const p = generatePlayer(rng, {
      clubId,
      club: c,
      idSuffix: i.toString(36) + rng.int(0, 1295).toString(36),
      position: s.position,
      ovr: s.ovr,
      pot: s.pot,
      age: s.age,
      nationPool,
      numberPool: pool.length ? pool : numbers.rest,
      until: contractUntil(rng, s.tier, s.age),
      salaryFactor
    });
    if (used.has(p.id)) p.id = `${p.id}${i}`;
    used.add(p.id);
    players.push(p);
  }

  // Kapitän: erfahrenster Leistungsträger bekommt Binde und Führungsrolle.
  let cap = null;
  for (const p of players) {
    if (p.age < 25 || p.position === 'TW') continue;
    if (!cap || p.attributes.fuehrung + p.age > cap.attributes.fuehrung + cap.age) cap = p;
  }
  if (cap) {
    if (!cap.traits.includes('leader')) cap.traits = ['leader'].concat(cap.traits).slice(0, 3);
    cap.appearance.accessory = 'kapitaensbinde';
  }
  return players;
}

/** Vertragslaufzeit (Saisonnummer) – gestaffelt nach Rolle und Alter. */
function contractUntil(rng, tier, age) {
  if (age >= 33) return rng.int(1, 2);
  if (age <= 20) return rng.int(2, 5);
  if (tier === 0) return rng.int(2, 4);
  if (tier === 1) return rng.int(1, 4);
  return rng.int(1, 3);
}

/* ------------------------------------------------------------------ *
 * Nachwuchs, vertragslose Spieler, Betreuerstab
 * ------------------------------------------------------------------ */

/**
 * Nachwuchsspieler: 15–18 Jahre, niedrige Stärke, dafür großes Potenzial.
 * Die Jugendabteilung (club.facilities.youth) bestimmt das Niveau.
 */
export function generateYouthProspect(rng, club, opts = {}) {
  const o = opts || {};
  const c = club || {};
  const youth = clamp((c.facilities && c.facilities.youth) || 50, 1, 100);
  const age = clamp(o.age === undefined ? rng.int(15, 18) : o.age, 15, 19);
  const ovr = clamp(Math.round(o.ovr === undefined
    ? rng.gauss(29 + youth * 0.11 + (age - 15) * 2.6, 3.5)
    : o.ovr), 22, 58);
  const pot = clamp(Math.round(o.pot === undefined
    ? rng.gauss(46 + youth * 0.36, 10)
    : o.pot), ovr + 6, 94);

  const p = generatePlayer(rng, {
    clubId: c.id || o.clubId || 'verein',
    nationPool: o.nationPool || NATION_POOL_YOUTH,
    position: o.position,
    age,
    ovr,
    pot,
    number: o.number === undefined ? rng.int(30, 49) : o.number,
    until: o.until === undefined ? rng.int(2, 4) : o.until,
    salary: o.salary === undefined ? rng.int(2, 9) * 10000 : o.salary,
    value: o.value
  });
  if (pot - ovr >= 25 && !p.traits.includes('wunderkind')) {
    p.traits = ['wunderkind'].concat(p.traits).slice(0, 3);
  }
  return p;
}

/**
 * Vertragsloser Spieler: clubId = null, contract.until = 0.
 * `salary` ist die Gehaltsforderung, `signOn` das geforderte Handgeld.
 */
export function generateFreeAgent(rng, opts = {}) {
  const o = opts || {};
  const age = o.age === undefined
    ? (rng.chance(0.62) ? rng.int(29, 36) : rng.int(19, 27))
    : o.age;
  const ovr = clamp(Math.round(o.ovr === undefined
    ? rng.gauss(age >= 30 ? 61 : 54, 7)
    : o.ovr), 32, 80);

  const p = generatePlayer(rng, Object.assign({}, o, {
    clubId: null,
    idClub: 'frei',
    age,
    ovr,
    pot: o.pot,
    nationPool: o.nationPool || NATION_POOL_TRANSFER,
    number: o.number === undefined ? 0 : o.number
  }));
  const demand = Math.max(60000, Math.round(deriveSalary(ovr, p.value, age) * 0.85 / 10000) * 10000);
  p.contract = {
    salary: demand,
    until: 0,
    signOn: Math.round(demand * rng.float(0.1, 0.4) / 10000) * 10000,
    releaseClause: null
  };
  return p;
}

/** Rollen im Betreuerstab. */
export const STAFF_ROLES = {
  cotrainer: {
    name: 'Co-Trainer', baseSalary: 120000,
    traits: ['motivator', 'taktiktueftler', 'kumpeltyp', 'schleifer', 'jugendfoerderer']
  },
  torwarttrainer: {
    name: 'Torwarttrainer', baseSalary: 90000,
    traits: ['reflexschule', 'strafraumcoach', 'altmeister', 'geduldig']
  },
  athletiktrainer: {
    name: 'Athletiktrainer', baseSalary: 95000,
    traits: ['laufwunder_coach', 'schleifer', 'regenerationsprofi', 'datenfreund']
  },
  arzt: {
    name: 'Mannschaftsarzt', baseSalary: 140000,
    traits: ['diagnosetalent', 'vorsichtig', 'schnelldiagnose', 'operationsprofi']
  },
  physio: {
    name: 'Physiotherapeut', baseSalary: 70000,
    traits: ['handaufleger', 'regenerationsprofi', 'geduldig', 'vorsichtig']
  },
  scout: {
    name: 'Scout', baseSalary: 85000,
    traits: ['talentspuerer', 'auslandskenner', 'netzwerker', 'datenfreund']
  },
  jugendtrainer: {
    name: 'Jugendtrainer', baseSalary: 65000,
    traits: ['jugendfoerderer', 'geduldig', 'motivator', 'talentspuerer']
  },
  analyst: {
    name: 'Spielanalyst', baseSalary: 80000,
    traits: ['datenfreund', 'taktiktueftler', 'gegnerkenner', 'netzwerker']
  },
  zeugwart: {
    name: 'Zeugwart', baseSalary: 45000,
    traits: ['kumpeltyp', 'ordnungsfanatiker', 'urgestein']
  }
};

/**
 * Erzeugt ein Stabmitglied.
 * @returns {{id,name,role,roleName,quality,salary,traits,age}}
 */
export function generateStaff(rng, role = 'cotrainer', quality) {
  const key = STAFF_ROLES[role] ? role : 'cotrainer';
  const def = STAFF_ROLES[key];
  const q = clamp(Math.round(quality === undefined ? rng.gauss(56, 14) : quality), 20, 99);
  const firstName = rng.pick(STAFF_NAMES.first);
  const lastName = rng.pick(STAFF_NAMES.last);
  const name = `${firstName} ${lastName}`;
  const salary = Math.max(20000,
    Math.round(def.baseSalary * (0.4 + Math.pow(q / 62, 2.2)) / 5000) * 5000);
  const traits = rng.shuffle(def.traits).slice(0, rng.int(1, 2));
  return {
    id: `st_${key}_${slug(lastName)}_${makeSuffix(rng)}`,
    name,
    firstName,
    lastName,
    role: key,
    roleName: def.name,
    quality: q,
    salary,
    traits,
    age: rng.int(31, 63)
  };
}
