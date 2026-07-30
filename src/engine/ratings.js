/**
 * engine/ratings.js — Das Bewertungsherz von TRAUMVEREIN.
 * ============================================================================
 *
 * Hier wird entschieden, wie stark ein Spieler und wie stark eine Elf ist.
 * Alles, was der Manager beeinflussen kann – Formation, Spielstil, Aufstellung,
 * Motivation, Fähigkeiten, Training, Chemie – muss man im Ergebnis SPÜREN.
 *
 * Zielkorridore (gemessen von tools/test-ratings.js):
 *   • optimale vs. schlechte Aufstellung derselben Elf .... bis zu 25 %
 *   • Moral 20 vs. Moral 90 ............................... ca. 12 %
 *   • Fitness 60 vs. 100 .................................. ca. 10 %
 *   • Form 20 vs. 90 ...................................... ca. 10 %
 *   • passender vs. unpassender Spielstil ................. ca. 12 %
 *   • Spieler auf völlig fremder Position .................. bis 45 % Verlust
 *
 * KEINE DOM-Zugriffe, kein Math.random(), kein Date.now().
 * Alle Gewichte stehen als benannte Konstanten oben — Balancing an einer Stelle.
 *
 * WICHTIG zur Arbeitsteilung:
 *   effectiveRating() ist die PRO-SPIELER-Sicht (für engine/match.js).
 *   teamStrength()    ist die TEAM-Sicht und rechnet Kondition selbst aggregiert,
 *                     ruft also bewusst NICHT effectiveRating() auf — sonst würden
 *                     Form/Moral/Fitness doppelt gezählt. Beide benutzen dieselben
 *                     WEIGHTS, bleiben also konsistent.
 */

import {
  POSITION_WEIGHTS, POSITION_AFFINITY, POSITION_GROUP, POSITION_NAMES,
  NATION_NAMES, WEATHER
} from '../core/constants.js';
import { clamp, round, avg, sortBy } from '../core/util.js';

/* ==========================================================================
 * 1. GEWICHTE — hier wird gebalanced
 * ======================================================================== */

export const WEIGHTS = {
  /* --- Positions-Malus ---------------------------------------------------- */
  // Wie stark zählen die Attribute der ZIELposition gegenüber der Gesamtstärke?
  slotAttrBlend: 0.45,
  // Untergrenze von positionPenalty(): völlig fremde Position kostet ~42..45 %.
  penaltyFloor: 0.58,
  // Eine Nebenposition (altPositions) ist minimal schlechter als die Hauptposition.
  altPositionFactor: 0.96,
  // Feldspieler im Tor / Torwart im Feld: zusätzlicher Katastrophen-Faktor.
  keeperMismatch: 0.55,
  // Falscher Fuß auf der Außenbahn.
  wrongFoot: 0.035,

  /* --- Kondition (individuell, in effectiveRating) ------------------------- */
  formInd: 0.14,        // Bezug 50   → Form 20 vs 90 ≈ 10 %
  moralInd: 0.10,       // Bezug 60
  fitnessInd: 0.23,     // Bezug 100  → Fitness 60 vs 100 ≈ 10 %
  sharpnessInd: 0.07,   // Bezug 60   (Spielfrische / Wettkampfrhythmus)
  injured: 0.55,        // angeschlagener Spieler in der Startelf
  minuteFatigue: 0.09,  // Ermüdung über 90 Minuten, moduliert über Ausdauer
  awayInd: 0.025,       // Auswärtsnervosität, moduliert über Nervenstärke
  bigMatch: 0.06,       // Spannungsspiele: Nervenstärke entscheidet
  weatherTechnik: 0.30, // Technikertypen leiden bei Regen/Schnee
  weatherPhysis: 0.22,  // Kopfballer/Kanten profitieren

  /* --- Kondition (Team-Ebene, in teamStrength) ---------------------------- */
  moralTeam: 0.06,      // matchTeam.morale, Bezug 60  → zusammen mit moralInd ≈ 12 %
  tiredness: 0.10,      // matchTeam.tiredness 0..100, Bezug 0

  /* --- Mannschaftsgefüge --------------------------------------------------- */
  weakLink: 0.22,       // Anteil des schwächsten Mannes einer Kette am Kettenwert
  centerControl: 0.026, // je Zentrums-Zähler über/unter dem Ideal
  centerIdeal: 3,       // Soll-Zentrumskontrolle (4-4-2 flach trifft das exakt)
  centerWingShare: 0.5, // Außenmittelfeldspieler rücken zur Hälfte mit ein
  centerShortage: 1.9,  // Unterzahl im Zentrum tut überproportional weh
  lineImbalance: 0.02,  // zu wenige/zu viele Abwehrspieler
  loneStriker: 0.014,   // einzelne Spitze gegen zwei Innenverteidiger
  formationMax: 0.09,   // Deckel des Formations-Faktors

  /* --- Spielstil & Slider --------------------------------------------------- */
  styleGain: 0.62,      // Übersetzung „Kader passt zum Stil" → Faktor
  styleMax: 0.06,       // ±6 % ⇒ passend vs. unpassend ≈ 12 %
  sliderGain: 0.05,     // je Slider-Missverhältnis
  sliderMax: 0.045,

  /* --- Chemie, Führung, Umfeld --------------------------------------------- */
  chemie: 0.12,         // Chemie 0 vs 100 ⇒ ±6 %
  fuehrung: 0.035,      // volle Führungsriege auf dem Platz
  kapitaen: 0.012,
  home: 0.030,          // Heimvorteil
  away: 0.015,          // Auswärtsabschlag (Team-Ebene)
  coach: 0.05           // coachBonus 0..100, Bezug 50 ⇒ ±2,5 %
};

/** Gewichtung der Mannschaftsteile für die Gesamtstärke. Summe = 1. */
export const LINE_WEIGHTS = { TW: 0.16, ABW: 0.28, MIT: 0.32, STU: 0.24 };

/** Attributprofile der Spielstile: „Was braucht dieser Stil vom Kader?" */
export const STYLE_PROFILE = {
  ballbesitz:    { technik: .30, passspiel: .34, uebersicht: .24, positionsspiel: .12 },
  konter:        { tempo: .40, schuss: .20, dribbling: .20, uebersicht: .20 },
  pressing:      { ausdauer: .40, aggressivitaet: .24, zweikampf: .26, tempo: .10 },
  kick_and_rush: { kopfball: .34, koerper: .30, sprungkraft: .20, schuss: .16 },
  defensiv:      { positionsspiel: .30, zweikampf: .30, koerper: .20, ausdauer: .20 },
  offensiv:      { schuss: .30, dribbling: .25, technik: .25, tempo: .20 },
  ausgeglichen:  { passspiel: .20, zweikampf: .20, ausdauer: .20, technik: .20, positionsspiel: .20 }
};

export const STYLE_NAMES = {
  ballbesitz: 'Ballbesitzfußball', konter: 'Konterspiel', pressing: 'Pressing',
  kick_and_rush: 'Kick and Rush', defensiv: 'Defensive Grundordnung',
  offensiv: 'Offensivspiel', ausgeglichen: 'Ausgeglichen'
};

/**
 * Stil-gegen-Stil-Matrix. Wert = Modifikator für den Spieler, der links steht.
 * Bewusst NICHT symmetrisch: Konter schlägt Pressing, Pressing schlägt Ballbesitz,
 * Ballbesitz schlägt Kick-and-Rush — ein Stein-Schere-Papier mit Kanten.
 */
export const STYLE_MATCHUP = {
  konter:        { pressing: +.055, offensiv: +.045, ballbesitz: +.020, defensiv: -.045, kick_and_rush: 0, ausgeglichen: +.005 },
  pressing:      { ballbesitz: +.055, defensiv: +.030, kick_and_rush: -.020, konter: -.055, offensiv: +.010, ausgeglichen: +.005 },
  ballbesitz:    { kick_and_rush: +.045, defensiv: +.020, konter: -.020, pressing: -.055, offensiv: +.010, ausgeglichen: +.005 },
  kick_and_rush: { pressing: +.020, ballbesitz: -.045, defensiv: -.020, konter: 0, offensiv: +.005, ausgeglichen: 0 },
  defensiv:      { offensiv: +.045, konter: +.045, ballbesitz: -.020, pressing: -.030, kick_and_rush: +.020, ausgeglichen: 0 },
  offensiv:      { defensiv: -.045, kick_and_rush: +.005, konter: -.045, ballbesitz: -.010, pressing: -.010, ausgeglichen: 0 },
  ausgeglichen:  { konter: -.005, pressing: -.005, ballbesitz: -.005, kick_and_rush: 0, defensiv: 0, offensiv: 0 }
};

/** Chemie-Stellschrauben. */
export const CHEMISTRY = {
  basis: 50,
  nationBlock: 14,        // größter Landsmann-Block, max. Bonus
  nationBabel: 2.2,       // je Nation über NATION_LIMIT
  nationLimit: 6,
  // Ab so vielen Spielern der Minderheits-Ära wird es teuer. Stand Stufe 3 war
  // das 3 — mit der Folge, dass die Standardelf (9 Legenden, 2 Moderne) vom
  // Ära-Abzug gar nicht erfasst wurde und die Eingespieltheit dort nichts zu
  // verkleinern hatte: Sie war Dekoration. Seit Stufe 4 staffelt der Abzug
  // stetig ab dem ERSTEN Spieler der Minderheit (tools/test-chemie.js Z04/Z08).
  eraMixMin: 1,
  eraPenaltyPerPlayer: 5, // Punkte je Spieler der Minderheits-Ära
  historyDefault: 30,     // matchTeam.chemistryHistory, wenn nicht gesetzt
  tenurePerSeason: 1.1,   // Vereinstreue je Saison, Summe über die Elf
  tenureMax: 14,
  leihspieler: 3.0,       // je vereinsfremdem Spieler in der Elf
  kapitaen: 5,
  leader: 2.5, leaderMax: 8,
  querulant: 6,
  fehlbesetzung: 2.2,     // je Spieler abseits seiner gelernten Position
  altersspreizung: 6      // Bonus für ausgewogene Altersstruktur
};

/** Slider-Anforderungen: welcher Regler verlangt welche Kader-Eigenschaft? */
const SLIDER_DEMAND = {
  tempo:         { attrs: ['tempo', 'technik'], label: 'Tempo' },
  pressinghoehe: { attrs: ['ausdauer', 'tempo'], label: 'Pressinghöhe' },
  breite:        { attrs: ['ausdauer', 'passspiel'], label: 'Spielfeldbreite' },
  risiko:        { attrs: ['nervenstaerke', 'technik'], label: 'Risiko' },
  haerte:        { attrs: ['koerper', 'aggressivitaet'], label: 'Härte' },
  offensivdrang: { attrs: ['schuss', 'ausdauer'], label: 'Offensivdrang' }
};

/** Kleine Trait-Boni auf bestimmten Slots (bewusst mild: max ±2 Punkte). */
const TRAIT_SLOT_BONUS = {
  kopfballungeheuer: { IV: 2, ST: 2, TW: 0 },
  torwartlegende:    { TW: 2 },
  tempodribbler:     { LA: 1.5, RA: 1.5, LM: 1, RM: 1 },
  knipser:           { ST: 2, OM: 1 },
  spielmacher_trait: { ZM: 1.5, OM: 1.5, DM: 1 },
  eisenfuss:         { IV: 1, DM: 1 },
  laufwunder:        { LM: 1, RM: 1, ZM: 1, LV: 1, RV: 1 },
  weltfussballer:    { TW: 2, IV: 2, LV: 2, RV: 2, DM: 2, ZM: 2, LM: 2, RM: 2, OM: 2, LA: 2, RA: 2, ST: 2 },
  glasknochen:       {},
  mimose:            {}
};

/** Marktwert-Kurve (formgleich zu data/squads/_helper.js, damit Werte konsistent bleiben). */
export const VALUE = {
  base: 210000, exponent: 3.35, floorOvr: 38,
  age: [[19, 1.35], [23, 1.45], [27, 1.25], [30, 0.95], [32, 0.60], [34, 0.34], [99, 0.15]],
  potYoung: 0.05, potOld: 0.018,
  form: 0.18, moral: 0.06,
  injuryLight: 0.95, injuryHeavy: 0.85, injuryHeavyDays: 60,
  contract: [[0, 0.55], [1, 0.78], [2, 0.95], [9, 1.0]],
  perf: 0.05, perfRef: 6.5,
  quantize: 50000, min: 50000
};

/**
 * Rollen-Keys. MUSS deckungsgleich mit den Keys von ROLES in engine/tactics.js sein.
 * Wird hier lokal geführt, damit ratings.js unabhängig von tactics.js lädt
 * (Vermeidung eines Zyklus; tactics.js importiert ratings.js).
 */
export const ROLE_KEYS = [
  'klassischer_torwart', 'mitspielender_torwart',
  'abwehrchef', 'libero', 'innenverteidiger',
  'defensiver_aussenverteidiger', 'offensiver_aussenverteidiger',
  'abraeumer', 'aufbauspieler', 'box_to_box', 'spielmacher', 'achter',
  'zehner', 'schattenstuermer',
  'fluegelflitzer', 'invertierter_fluegel', 'flankengeber',
  'zielspieler', 'knipser', 'falsche_neun', 'tiefenlaeufer'
];

/** Für Klartext-Meldungen: „Kein gelernter …" (Adjektive klein, damit die Grammatik stimmt). */
const POS_NOUN = {
  TW: 'Torwart', IV: 'Innenverteidiger', LV: 'Linksverteidiger', RV: 'Rechtsverteidiger',
  DM: 'Sechser', ZM: 'Achter', OM: 'Zehner',
  LM: 'linker Mittelfeldspieler', RM: 'rechter Mittelfeldspieler',
  LA: 'Linksaußen', RA: 'Rechtsaußen', ST: 'Mittelstürmer'
};

const CENTER_POS = ['DM', 'ZM', 'OM'];
const WING_POS = ['LM', 'RM', 'LA', 'RA', 'LV', 'RV'];
const LEFT_POS = ['LV', 'LM', 'LA'];
const RIGHT_POS = ['RV', 'RM', 'RA'];

/* ==========================================================================
 * 2. Kleine Helfer
 * ======================================================================== */

/** Gewichteter Attributschnitt; Gewichte werden normalisiert. */
function weightedAttr(attributes, weights) {
  if (!attributes) return 1;
  let wsum = 0, acc = 0;
  for (const k in weights) {
    const w = weights[k];
    if (!w) continue;
    wsum += w;
    acc += w * (attributes[k] || 0);
  }
  return wsum > 0 ? acc / wsum : 1;
}

/** Ungewichteter Schnitt über eine Attributliste. */
function attrAvg(attributes, keys) {
  if (!attributes || !keys.length) return 50;
  let s = 0;
  for (const k of keys) s += attributes[k] || 0;
  return s / keys.length;
}

function isKeeperPos(pos) { return pos === 'TW'; }

/** Rohe Positions-Verwandtschaft 0..1 (ohne Bodensatz). */
function rawAffinity(fromPos, toPos) {
  if (fromPos === toPos) return 1;
  const row = POSITION_AFFINITY[fromPos];
  if (!row) return 0;
  return row[toPos] || 0;
}

/** Beste Verwandtschaft eines Spielers zu `pos` über Haupt- und Nebenpositionen. */
export function bestAffinity(player, pos) {
  if (!player) return 0;
  let best = rawAffinity(player.position, pos);
  for (const alt of player.altPositions || []) {
    const a = rawAffinity(alt, pos) * WEIGHTS.altPositionFactor;
    if (a > best) best = a;
  }
  return clamp(best, 0, 1);
}

/** Malus für den falschen Fuß auf einer eindeutig linken/rechten Bahn. */
function footFactor(player, pos) {
  const foot = player.foot;
  if (!foot || foot === 'beidfüßig') return 1;
  if (LEFT_POS.includes(pos) && foot === 'rechts') return 1 - WEIGHTS.wrongFoot;
  // Rechtsbahn mit Linksfuß ist heute üblich (invertierter Flügel) -> halber Malus.
  if (RIGHT_POS.includes(pos) && foot === 'links') return 1 - WEIGHTS.wrongFoot * 0.5;
  return 1;
}

function traitBonusFor(player, pos) {
  let b = 0;
  for (const t of player.traits || []) {
    const map = TRAIT_SLOT_BONUS[t];
    if (map && map[pos]) b += map[pos];
  }
  return b;
}

/* ==========================================================================
 * 3. Spielerbewertung
 * ======================================================================== */

/**
 * Gesamtstärke auf der GELERNTEN Position, 1..99.
 * ACHTUNG: reiner gewichteter Attributschnitt — data/squads/_helper.js kalibriert
 * seine Spieler gegen genau diese Formel. Hier NIEMALS Boni addieren.
 */
export function playerOverall(player) {
  if (!player || !player.attributes) return 1;
  const w = POSITION_WEIGHTS[player.position] || POSITION_WEIGHTS.ZM;
  return clamp(Math.round(weightedAttr(player.attributes, w)), 1, 99);
}

/** Gesamtstärke, wenn man ihn mit der Brille einer anderen Position betrachtet. */
export function overallForPosition(player, pos) {
  if (!player || !player.attributes) return 1;
  const w = POSITION_WEIGHTS[pos] || POSITION_WEIGHTS.ZM;
  return clamp(weightedAttr(player.attributes, w), 1, 99);
}

/**
 * Positions-Malus: 1.0 = perfekt zu Hause, 0.55 = völlig fremd.
 * Basis ist POSITION_AFFINITY; dazu kommen Fuß und die Torwart-Sonderregel.
 */
export function positionPenalty(player, pos) {
  if (!player) return WEIGHTS.penaltyFloor;
  const aff = bestAffinity(player, pos);
  let f = WEIGHTS.penaltyFloor + (1 - WEIGHTS.penaltyFloor) * aff;

  // Torwart-Sonderregel: Feldspieler im Kasten (und umgekehrt) ist eine Katastrophe.
  const playerIsKeeper = isKeeperPos(player.position);
  if (playerIsKeeper !== isKeeperPos(pos)) f *= WEIGHTS.keeperMismatch;

  f *= footFactor(player, pos);
  return clamp(f, 0.2, 1);
}

/**
 * Stärke des Spielers AUF EINEM SLOT, 1..99 — ohne Tagesform, aber mit
 * Positions-Malus, Ziel-Positionsprofil und kleinen Trait-Boni.
 */
export function playerRatingForSlot(player, slotPos) {
  if (!player) return 1;
  const pos = POSITION_WEIGHTS[slotPos] ? slotPos : player.position;
  const own = playerOverall(player);
  const forPos = overallForPosition(player, pos);
  // Mischung: teils „was kann er dort?", teils „wie gut ist er überhaupt?"
  const base = WEIGHTS.slotAttrBlend * forPos + (1 - WEIGHTS.slotAttrBlend) * own;
  const v = base * positionPenalty(player, pos) + traitBonusFor(player, pos);
  return clamp(round(v, 1), 1, 99);
}

/**
 * Tagesaktuelle Stärke inkl. Form, Moral, Fitness, Frische, Verletzung,
 * Wetter, Auswärtsfahrt, Spielgröße und Spielminute.
 *
 * @param {object} ctx { weather, awayGame, bigMatch, minute }
 */
export function effectiveRating(player, slotPos, ctx = {}) {
  if (!player) return 1;
  const base = playerRatingForSlot(player, slotPos);
  const a = player.attributes || {};
  let f = 1;

  const form = player.form ?? 50;
  const morale = player.morale ?? 70;
  const fitness = player.fitness ?? 100;
  const sharpness = player.sharpness ?? 60;

  f *= 1 + ((form - 50) / 100) * WEIGHTS.formInd;
  f *= 1 + ((morale - 60) / 100) * WEIGHTS.moralInd;
  f *= 1 - ((100 - clamp(fitness, 0, 100)) / 100) * WEIGHTS.fitnessInd;
  f *= 1 + ((sharpness - 60) / 100) * WEIGHTS.sharpnessInd;

  if (player.injury) f *= WEIGHTS.injured;

  // Auswärts: nervenstarke Spieler stecken die Reise besser weg.
  if (ctx.awayGame) {
    f *= 1 - WEIGHTS.awayInd * (1.4 - (a.nervenstaerke || 50) / 100);
  }
  // Großes Spiel: Nervenstärke entscheidet, ob man wächst oder schrumpft.
  if (ctx.bigMatch) {
    f *= 1 + (((a.nervenstaerke || 50) - 55) / 100) * WEIGHTS.bigMatch;
  }
  // Wetter: Regen/Schnee bestrafen Filigrantechniker und belohnen Kanten.
  const w = WEATHER[ctx.weather];
  if (w && w.errorMod > 1) {
    const chaos = w.errorMod - 1;
    const tech = (attrAvg(a, ['technik', 'dribbling', 'passspiel']) - 50) / 100;
    const phys = (attrAvg(a, ['koerper', 'kopfball', 'zweikampf']) - 50) / 100;
    f *= 1 - chaos * tech * WEIGHTS.weatherTechnik + chaos * phys * WEIGHTS.weatherPhysis;
  }
  // Spielminute: Kondition zehrt, Laufwunder halten länger durch.
  if (ctx.minute) {
    const drain = clamp(ctx.minute, 0, 120) / 90;
    const stam = clamp(a.ausdauer || 50, 1, 99);
    const laufwunder = (player.traits || []).includes('laufwunder') ? 0.6 : 1;
    f *= 1 - drain * WEIGHTS.minuteFatigue * (1.35 - stam / 100) * laufwunder;
  }

  return clamp(round(base * f, 1), 1, 99);
}

/* ==========================================================================
 * 4. Formationen (lokale Herleitung, falls engine/tactics.js nicht mitliefert)
 * ======================================================================== */

/** Abwehrreihen nach Anzahl. */
const DEF_LINES = {
  3: ['IV', 'IV', 'IV'],
  4: ['LV', 'IV', 'IV', 'RV'],
  5: ['LV', 'IV', 'IV', 'IV', 'RV']
};
/** Angriffsreihen nach Anzahl. */
const ATT_LINES = {
  1: ['ST'], 2: ['ST', 'ST'], 3: ['LA', 'ST', 'RA'], 4: ['LA', 'ST', 'ST', 'RA']
};
/** Mittelfeldreihen (breite Variante – die Außen kommen aus dem Mittelfeld). */
const MID_LINES_SINGLE = {
  2: ['ZM', 'ZM'], 3: ['LM', 'ZM', 'RM'], 4: ['LM', 'ZM', 'ZM', 'RM'],
  5: ['LM', 'ZM', 'DM', 'ZM', 'RM'], 6: ['LM', 'DM', 'ZM', 'ZM', 'OM', 'RM']
};
/** Zentrale Variante – greift, wenn die Breite schon von Flügelstürmern und
 *  Außenverteidigern kommt (z. B. 4-3-3: Dreierzentrum hinter LA/ST/RA). */
const MID_LINES_CENTRAL = {
  2: ['DM', 'ZM'], 3: ['ZM', 'DM', 'ZM'], 4: ['DM', 'ZM', 'ZM', 'OM'],
  5: ['LM', 'DM', 'ZM', 'ZM', 'RM'], 6: ['LM', 'DM', 'ZM', 'ZM', 'OM', 'RM']
};
const MID_LINES_DEEP = { 1: ['DM'], 2: ['DM', 'DM'], 3: ['DM', 'DM', 'ZM'], 4: ['DM', 'ZM', 'ZM', 'DM'] };
const MID_LINES_HIGH = { 1: ['OM'], 2: ['OM', 'OM'], 3: ['LM', 'OM', 'RM'], 4: ['LM', 'OM', 'OM', 'RM'] };

/**
 * Leitet aus einer Formations-ID („4-4-2", „4-2-3-1", „3-5-2") elf Slots ab.
 * Fallback für den Fall, dass tactics keine Slot-Liste mitbringt.
 */
export function slotsForFormation(formationId) {
  const bands = String(formationId || '4-4-2').split(/[^0-9]+/).map(Number).filter(n => n > 0);
  const total = bands.reduce((s, n) => s + n, 0);
  const use = (total === 10 && bands.length >= 3) ? bands : [4, 4, 2];
  const out = [{ id: 's1', pos: 'TW', x: 50, y: 4 }];
  let idx = 2;

  const def = DEF_LINES[use[0]] || DEF_LINES[4];
  const att = ATT_LINES[use[use.length - 1]] || ATT_LINES[2];
  const midBands = use.slice(1, -1);

  const push = (list, y) => {
    const n = list.length;
    list.forEach((pos, i) => {
      const x = n === 1 ? 50 : 12 + (76 * i) / (n - 1);
      out.push({ id: 's' + idx++, pos, x: round(x, 1), y });
    });
  };

  // Breite Mittelfeldreihe nur, wenn nicht ohnehin Flügelstürmer UND
  // Außenverteidiger für die Breite sorgen.
  const breitVonAussen = att.includes('LA') && def.includes('LV');
  const midTable = breitVonAussen ? MID_LINES_CENTRAL : MID_LINES_SINGLE;

  push(def, 22);
  if (midBands.length === 1) {
    push(midTable[midBands[0]] || MID_LINES_SINGLE[4], 50);
  } else {
    const yStep = 34 / Math.max(1, midBands.length);
    midBands.forEach((n, i) => {
      const table = i === 0 ? MID_LINES_DEEP : (i === midBands.length - 1 ? MID_LINES_HIGH : MID_LINES_SINGLE);
      push(table[n] || MID_LINES_SINGLE[n] || ['ZM'], 40 + yStep * i);
    });
  }
  push(att, 84);
  return out.slice(0, 11);
}

/** Holt die Slot-Liste aus den Taktikdaten oder leitet sie her. */
function resolveSlots(tactics) {
  if (tactics) {
    if (Array.isArray(tactics.slots) && tactics.slots.length === 11) return tactics.slots;
    if (Array.isArray(tactics.formationSlots) && tactics.formationSlots.length === 11) return tactics.formationSlots;
    if (tactics.formation && typeof tactics.formation === 'object' && Array.isArray(tactics.formation.slots)) {
      return tactics.formation.slots;
    }
  }
  return slotsForFormation(tactics && tactics.formation);
}

function formationIdOf(tactics) {
  const f = tactics && tactics.formation;
  if (!f) return '4-4-2';
  return typeof f === 'object' ? (f.id || '4-4-2') : String(f);
}

/**
 * Ordnet Spieler den Slots zu. Nutzt tactics.lineup; fehlt sie, wird gierig
 * die beste Elf gesucht (echte Bestenermittlung macht tactics.autoLineup()).
 */
function resolveLineup(players, tactics) {
  const slots = resolveSlots(tactics);
  const byId = new Map((players || []).map(p => [p.id, p]));
  const assigned = [];
  const lineup = tactics && tactics.lineup;
  const used = new Set();
  let missing = 0;

  if (lineup && Object.keys(lineup).length) {
    for (const slot of slots) {
      const p = byId.get(lineup[slot.id]);
      if (p) { used.add(p.id); assigned.push({ slot, player: p }); }
      else { missing++; assigned.push({ slot, player: null }); }
    }
    if (missing < slots.length) return { slots, assigned, missing };
  }

  // Fallback: gierige Zuordnung, schwierigste Slots (Tor, Abwehr) zuerst.
  const pool = (players || []).filter(p => !p.injury);
  const order = sortBy(slots.map((s, i) => ({ s, i })), o => (o.s.pos === 'TW' ? 0 : 1), o => o.i);
  const res = new Map();
  for (const { s } of order) {
    let best = null, bestV = -1;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      const v = playerRatingForSlot(p, s.pos);
      if (v > bestV) { bestV = v; best = p; }
    }
    if (best) { used.add(best.id); res.set(s.id, best); }
  }
  const out = slots.map(slot => {
    const p = res.get(slot.id) || null;
    if (!p) missing++;
    return { slot, player: p };
  });
  return { slots, assigned: out, missing };
}

/* ==========================================================================
 * 5. Kadertiefe, Chemie, Form-Guide
 * ======================================================================== */

/**
 * Kadertiefe je Position.
 * @returns {{[pos:string]: { anzahl, bester, schnitt, luecke, bewertung, spieler }}}
 */
export function squadDepth(players) {
  const list = (players || []).filter(Boolean);
  const out = {};
  // Referenz: Schnitt der elf besten Spieler des Kaders.
  const tops = sortBy(list, p => ({ key: playerOverall(p), desc: true })).slice(0, 11);
  const ref = tops.length ? avg(tops, playerOverall) : 50;

  for (const pos of Object.keys(POSITION_WEIGHTS)) {
    const kandidaten = list
      .map(p => ({ p, aff: bestAffinity(p, pos), wert: playerRatingForSlot(p, pos) }))
      .filter(c => c.aff >= 0.7);
    const sorted = sortBy(kandidaten, c => ({ key: c.wert, desc: true }));
    const anzahl = sorted.length;
    const bester = anzahl ? round(sorted[0].wert, 1) : 0;
    const schnitt = anzahl ? round(avg(sorted.slice(0, 3), c => c.wert), 1) : 0;
    const luecke = anzahl === 0 || bester < ref - 10;
    let bewertung;
    if (anzahl === 0) bewertung = 'Kein gelernter Spieler';
    else if (anzahl === 1) bewertung = 'Nur eine Option – ein Ausfall und es wird eng';
    else if (bester < ref - 10) bewertung = 'Deutlich unter Kaderniveau';
    else if (anzahl >= 3 && bester >= ref) bewertung = 'Bestens besetzt';
    else bewertung = 'Solide besetzt';
    out[pos] = { anzahl, bester, schnitt, luecke, bewertung, spieler: sorted.map(c => c.p.id) };
  }
  return out;
}

/**
 * Team-Chemie 0..100 mit deutschen Begründungen.
 *
 * Die Besonderheit von TRAUMVEREIN: Legenden und moderne Profis müssen sich
 * erst finden. Je mehr Spielzeit die Mischung gemeinsam hat
 * (`tactics.chemistryHistory`, 0..100, Default 30), desto kleiner der Abzug.
 */
export function chemistry(players, tactics) {
  const gruende = [];
  let elf = (players || []).filter(Boolean);

  // Wenn eine Aufstellung mitgeliefert wird, zählt nur die Startelf.
  if (tactics && tactics.lineup && Object.keys(tactics.lineup).length) {
    const ids = new Set(Object.values(tactics.lineup));
    const sub = elf.filter(p => ids.has(p.id));
    if (sub.length) elf = sub;
  }
  elf = elf.slice(0, 11);
  if (!elf.length) return { wert: CHEMISTRY.basis, gruende: ['Keine Aufstellung – Chemie nicht bewertbar.'] };

  let wert = CHEMISTRY.basis;
  const history = clamp(
    (tactics && tactics.chemistryHistory != null) ? tactics.chemistryHistory : CHEMISTRY.historyDefault, 0, 100);

  /* --- Nationalitäten ---------------------------------------------------- */
  const nat = {};
  for (const p of elf) nat[p.nationality] = (nat[p.nationality] || 0) + 1;
  const natKeys = Object.keys(nat);
  const blockNat = sortBy(natKeys, k => ({ key: nat[k], desc: true }))[0];
  const blockSize = nat[blockNat] || 0;
  if (blockSize >= 4) {
    const bonus = CHEMISTRY.nationBlock * ((blockSize - 3) / 8);
    wert += bonus;
    gruende.push(`${blockSize} ${NATION_NAMES[blockNat] || blockNat}-Spieler bilden einen festen Block in der Kabine.`);
  }
  if (natKeys.length > CHEMISTRY.nationLimit) {
    const malus = (natKeys.length - CHEMISTRY.nationLimit) * CHEMISTRY.nationBabel;
    wert -= malus;
    gruende.push(`${natKeys.length} Nationen in der Startelf – auf dem Platz wird viel geredet und wenig verstanden.`);
  }

  /* --- Ären-Mischung (Legenden vs. Moderne) ------------------------------- */
  const legenden = elf.filter(p => p.era === 'legend').length;
  const moderne = elf.length - legenden;
  const minderheit = Math.min(legenden, moderne);
  if (minderheit >= CHEMISTRY.eraMixMin) {
    const roh = (minderheit - (CHEMISTRY.eraMixMin - 1)) * CHEMISTRY.eraPenaltyPerPlayer;
    const malus = roh * (1 - history / 100);
    wert -= malus;
    if (history < 55) {
      const l = legenden === 1 ? 'Eine Legende' : `${legenden} Legenden`;
      const m = moderne === 1 ? 'ein moderner Profi' : `${moderne} moderne Profis`;
      gruende.push(`${l} und ${m} – die Generationen müssen sich noch finden.`);
    } else {
      gruende.push(`Legenden und Moderne haben sich mittlerweile aneinander gewöhnt.`);
    }
  } else if (minderheit === 0 && elf.length >= 11) {
    wert += 4;
    gruende.push(legenden > 0
      ? 'Eine Elf aus einem Guss – lauter Spieler derselben Ära.'
      : 'Eine eingespielte Truppe aus der Gegenwart.');
  }

  /* --- Vereinstreue & Leihspieler ---------------------------------------- */
  const clubs = {};
  for (const p of elf) clubs[p.clubId] = (clubs[p.clubId] || 0) + 1;
  const hauptClub = sortBy(Object.keys(clubs), k => ({ key: clubs[k], desc: true }))[0];
  const fremde = elf.filter(p => p.clubId !== hauptClub).length;
  if (fremde > 0) {
    wert -= fremde * CHEMISTRY.leihspieler;
    gruende.push(`${fremde} Neuzugänge bzw. Leihspieler müssen sich erst einfügen.`);
  }
  const treue = Math.min(CHEMISTRY.tenureMax,
    elf.reduce((s, p) => s + Math.max(0, (p.seasonsAtClub || 0) - 1), 0) * CHEMISTRY.tenurePerSeason);
  if (treue >= 4) {
    wert += treue;
    gruende.push('Ein Stamm langjähriger Vereinsspieler kennt sich blind.');
  }

  /* --- Persönlichkeiten --------------------------------------------------- */
  const leaders = elf.filter(p => (p.traits || []).some(t => t === 'leader' || t === 'kabinenleader')).length;
  if (leaders > 0) {
    const bonus = Math.min(CHEMISTRY.leaderMax, leaders * CHEMISTRY.leader);
    wert += bonus;
    gruende.push(leaders === 1
      ? 'Ein Führungsspieler hält die Truppe zusammen.'
      : `${leaders} Führungsspieler halten die Truppe zusammen.`);
  } else {
    wert -= 4;
    gruende.push('Niemand auf dem Platz reißt die Mannschaft mit – es fehlt ein Leitwolf.');
  }
  const querulanten = elf.filter(p => (p.traits || []).includes('querulant')).length;
  if (querulanten > 0) {
    wert -= querulanten * CHEMISTRY.querulant;
    gruende.push(`${querulanten === 1 ? 'Ein Querulant sorgt' : querulanten + ' Querulanten sorgen'} für Unruhe in der Kabine.`);
  }

  const kapitaen = tactics && tactics.setPieces && tactics.setPieces.kapitaen;
  if (kapitaen && elf.some(p => p.id === kapitaen)) {
    wert += CHEMISTRY.kapitaen;
    const k = elf.find(p => p.id === kapitaen);
    gruende.push(`${k.shortName || k.lastName} trägt die Binde und führt die Elf.`);
  } else if (tactics) {
    wert -= 3;
    gruende.push('Kein Kapitän auf dem Platz – niemand übernimmt Verantwortung.');
  }

  /* --- Fehlbesetzungen ---------------------------------------------------- */
  if (tactics && tactics.lineup) {
    const slots = resolveSlots(tactics);
    let fehl = 0;
    for (const s of slots) {
      const p = elf.find(x => x.id === tactics.lineup[s.id]);
      if (p && bestAffinity(p, s.pos) < 0.8) fehl++;
    }
    if (fehl > 0) {
      wert -= fehl * CHEMISTRY.fehlbesetzung;
      gruende.push(`${fehl} Spieler stehen abseits ihrer gelernten Position – die Abstimmung leidet.`);
    }
  }

  /* --- Altersstruktur ----------------------------------------------------- */
  const ages = elf.map(p => p.age || 26);
  const jung = ages.filter(a => a <= 23).length;
  const alt = ages.filter(a => a >= 31).length;
  if (jung >= 2 && alt >= 2 && jung + alt <= 7) {
    wert += CHEMISTRY.altersspreizung;
    gruende.push('Erfahrung und Talent halten sich schön die Waage.');
  } else if (jung >= 6) {
    wert -= 4;
    gruende.push('Eine sehr junge Elf – begeisternd, aber unberechenbar.');
  } else if (alt >= 6) {
    wert -= 3;
    gruende.push('Ein sehr alter Kader – Routine ja, Beine nein.');
  }

  return { wert: clamp(Math.round(wert), 0, 100), gruende };
}

/** Formhinweis für die UI: Klartext + Auswirkung in Stärkepunkten. */
export function formGuide(player) {
  const form = clamp(player && player.form != null ? player.form : 50, 0, 100);
  const ovr = playerOverall(player);
  const faktor = 1 + ((form - 50) / 100) * WEIGHTS.formInd;
  const delta = round(ovr * (faktor - 1), 1);

  let text, stufe;
  if (form <= 15) { text = 'Katastrophal außer Form'; stufe = 0; }
  else if (form <= 30) { text = 'Schwere Formkrise'; stufe = 1; }
  else if (form <= 42) { text = 'Nicht in Form'; stufe = 2; }
  else if (form <= 58) { text = 'Normalform'; stufe = 3; }
  else if (form <= 70) { text = 'Gut drauf'; stufe = 4; }
  else if (form <= 84) { text = 'In bestechender Form'; stufe = 5; }
  else { text = 'Der Lauf seines Lebens'; stufe = 6; }

  return { text, delta, stufe, form };
}

/**
 * Marktwert-Neuberechnung. Berücksichtigt Stärke, Potenzial, Alter, Form,
 * Moral, Verletzung, Restvertrag (optional `player.contractSeasonsLeft`)
 * und die Saisonleistung (optional `player.stats.season.avgRating`, 1..10).
 */
export function marketValue(player) {
  if (!player) return VALUE.min;
  const ovr = playerOverall(player);
  const pot = clamp(player.potential || ovr, ovr, 99);
  const age = player.age || 26;

  let v = Math.pow(Math.max(1, ovr - VALUE.floorOvr) / 10, VALUE.exponent) * VALUE.base;

  let ageF = VALUE.age[VALUE.age.length - 1][1];
  for (const [max, f] of VALUE.age) { if (age <= max) { ageF = f; break; } }
  v *= ageF;
  v *= 1 + Math.max(0, pot - ovr) * (age <= 23 ? VALUE.potYoung : VALUE.potOld);

  const form = player.form ?? 50;
  const morale = player.morale ?? 70;
  v *= 1 + ((form - 50) / 100) * VALUE.form + ((morale - 60) / 100) * VALUE.moral;

  if (player.injury) {
    const days = player.injury.daysLeft ?? player.injury.days ?? 0;
    v *= days >= VALUE.injuryHeavyDays ? VALUE.injuryHeavy : VALUE.injuryLight;
  }

  if (player.contractSeasonsLeft != null) {
    let cf = 1;
    for (const [max, f] of VALUE.contract) { if (player.contractSeasonsLeft <= max) { cf = f; break; } }
    v *= cf;
  }

  const season = player.stats && player.stats.season;
  if (season && season.avgRating) v *= 1 + (season.avgRating - VALUE.perfRef) * VALUE.perf;

  return Math.max(VALUE.min, Math.round(v / VALUE.quantize) * VALUE.quantize);
}

/** Schlägt anhand des Attributprofils eine Rolle aus ROLE_KEYS vor. */
export function playerRole(player) {
  if (!player || !player.attributes) return 'achter';
  const a = player.attributes;
  const pos = player.position;

  switch (pos) {
    case 'TW':
      return (a.abschlag >= 70 && a.passspiel >= 55) ? 'mitspielender_torwart' : 'klassischer_torwart';
    case 'IV':
      if (a.tempo >= 74 && a.passspiel >= 66) return 'libero';
      if (a.koerper >= 76 || a.fuehrung >= 74) return 'abwehrchef';
      return 'innenverteidiger';
    case 'LV': case 'RV':
      return (a.tempo >= 70 && a.ausdauer >= 70 && a.dribbling >= 62)
        ? 'offensiver_aussenverteidiger' : 'defensiver_aussenverteidiger';
    case 'DM':
      return (a.passspiel >= 72 && a.uebersicht >= 70) ? 'aufbauspieler' : 'abraeumer';
    case 'ZM':
      if (a.uebersicht >= 76 && a.passspiel >= 76) return 'spielmacher';
      if (a.ausdauer >= 74 && (a.schuss >= 66 || a.zweikampf >= 70)) return 'box_to_box';
      return 'achter';
    case 'OM':
      if (a.schuss >= 76 && a.schuss > a.passspiel) return 'schattenstuermer';
      if (a.uebersicht >= 76 && a.passspiel >= 74) return 'spielmacher';
      return 'zehner';
    case 'LM': case 'RM': case 'LA': case 'RA': {
      const invers = (pos === 'RA' || pos === 'RM') ? player.foot === 'links'
        : (pos === 'LA' || pos === 'LM') ? player.foot === 'rechts' : false;
      if (invers && a.schuss >= 68) return 'invertierter_fluegel';
      if (a.tempo >= 78 && a.dribbling >= 72) return 'fluegelflitzer';
      if (a.passspiel >= 70 || a.standards >= 72) return 'flankengeber';
      return 'fluegelflitzer';
    }
    case 'ST':
      if (a.kopfball >= 76 && a.koerper >= 72) return 'zielspieler';
      if (a.uebersicht >= 72 && a.passspiel >= 70 && a.technik >= 74) return 'falsche_neun';
      if (a.tempo >= 78) return 'tiefenlaeufer';
      return 'knipser';
    default:
      return 'achter';
  }
}

/* ==========================================================================
 * 6. Mannschaftsstärke
 * ======================================================================== */

/** Kettenwert: Durchschnitt, aber der schwächste Mann zieht spürbar runter. */
function lineValue(ratings) {
  if (!ratings.length) return 0;
  const mittel = avg(ratings);
  const min = Math.min(...ratings);
  return WEIGHTS.weakLink * min + (1 - WEIGHTS.weakLink) * mittel;
}

/** Kondition einer Spielergruppe als Multiplikator (Form/Moral/Fitness/Verletzung). */
function conditionFactors(players) {
  if (!players.length) return { form: 1, moral: 1, fitness: 1, verletzt: 1, gesamt: 1 };
  const f = avg(players, p => p.form ?? 50);
  const m = avg(players, p => p.morale ?? 70);
  const fit = avg(players, p => p.fitness ?? 100);
  const angeschlagen = players.filter(p => p.injury).length;

  const form = 1 + ((f - 50) / 100) * WEIGHTS.formInd;
  const moral = 1 + ((m - 60) / 100) * WEIGHTS.moralInd;
  const fitness = 1 - ((100 - clamp(fit, 0, 100)) / 100) * WEIGHTS.fitnessInd;
  const verletzt = Math.pow(WEIGHTS.injured, angeschlagen / Math.max(1, players.length));
  return { form, moral, fitness, verletzt, gesamt: form * moral * fitness * verletzt };
}

/** Wie gut passt der Kader zum gewählten Spielstil? */
function styleFit(elf, style) {
  const profile = STYLE_PROFILE[style] || STYLE_PROFILE.ausgeglichen;
  const feld = elf.filter(p => p && p.position !== 'TW');
  if (!feld.length) return { faktor: 1, rel: 1, eignung: 50, referenz: 50 };
  const eignung = avg(feld, p => weightedAttr(p.attributes, profile));
  // Referenz = allgemeines Niveau des Kaders. So misst der Faktor wirklich
  // „passt der Stil zu DIESEN Spielern?" und nicht „ist der Kader gut?".
  const referenz = avg(feld, p => playerOverall(p));
  const rel = referenz > 0 ? eignung / referenz : 1;
  const faktor = clamp(1 + (rel - 1) * WEIGHTS.styleGain, 1 - WEIGHTS.styleMax, 1 + WEIGHTS.styleMax);
  return { faktor, rel, eignung: round(eignung, 1), referenz: round(referenz, 1) };
}

/** Passen die Regler zum Personal? Übertriebene Einstellungen kosten Substanz. */
function sliderFit(elf, sliders) {
  const s = sliders || {};
  const feld = elf.filter(p => p && p.position !== 'TW');
  if (!feld.length) return { faktor: 1, hinweise: [] };
  const hinweise = [];
  let mod = 0;

  for (const key in SLIDER_DEMAND) {
    const val = s[key];
    if (val == null) continue;
    const d = SLIDER_DEMAND[key];
    const koennen = avg(feld, p => attrAvg(p.attributes, d.attrs));
    // Anspruch = Regler; Angebot = Kaderwert (auf 0..100 gedacht).
    const anspruch = clamp(val, 0, 100);
    const luecke = (koennen - anspruch) / 100;      // >0 = Kader kann mehr als gefordert
    // Nur Übersteuerung bestraft, Untersteuerung wird kaum belohnt.
    mod += (luecke >= 0 ? luecke * 0.35 : luecke) * WEIGHTS.sliderGain;
    if (luecke < -0.18) hinweise.push(`${d.label} ${anspruch} überfordert die Mannschaft.`);
  }
  return { faktor: clamp(1 + mod, 1 - WEIGHTS.sliderMax, 1 + WEIGHTS.sliderMax), hinweise };
}

/** Formationsbalance: Zentrum, Abwehrkette, Breite. */
function formationFit(slots, style) {
  const pos = slots.map(s => s.pos);
  const zentrum = pos.filter(p => CENTER_POS.includes(p)).length;
  const abwehr = pos.filter(p => ['IV', 'LV', 'RV'].includes(p)).length;
  const angriff = pos.filter(p => ['LA', 'RA', 'ST'].includes(p)).length;
  const breite = pos.filter(p => WING_POS.includes(p)).length;
  const aussenMitte = pos.filter(p => p === 'LM' || p === 'RM').length;
  const hinweise = [];
  let mod = 0;

  // Zentrumskontrolle: echte Zentralspieler voll, Außenmittelfeldspieler zur Hälfte
  // (sie rücken bei gegnerischem Ballbesitz ein). 4-4-2 flach trifft damit das Ideal.
  const kontrolle = zentrum + aussenMitte * WEIGHTS.centerWingShare;
  const dz = kontrolle - WEIGHTS.centerIdeal;
  mod += WEIGHTS.centerControl * (dz < 0 ? dz * WEIGHTS.centerShortage : dz);
  if (kontrolle <= 2) hinweise.push('Nur ' + zentrum + ' Spieler im Zentrum – das Mittelfeld wird überrannt.');
  if (zentrum >= 5) hinweise.push('Das Zentrum ist mit ' + zentrum + ' Mann überbesetzt, die Flügel verwaisen.');

  if (abwehr < 3) { mod -= WEIGHTS.lineImbalance * 2; hinweise.push('Eine Abwehr mit nur ' + abwehr + ' Mann ist ein Selbstmordkommando.'); }
  if (abwehr > 5) { mod -= WEIGHTS.lineImbalance; hinweise.push('Zu viele Verteidiger – nach vorne passiert zu wenig.'); }
  if (breite <= 1) { mod -= WEIGHTS.lineImbalance; hinweise.push('Kaum Breite im Spiel – alles läuft durch die Mitte.'); }
  if (angriff === 0) { mod -= WEIGHTS.lineImbalance * 2; hinweise.push('Ohne echte Spitze fehlt der Abnehmer.'); }
  else if (angriff === 1) { mod -= WEIGHTS.loneStriker; hinweise.push('Ein einzelner Stürmer wird von zwei Innenverteidigern leicht abgemeldet.'); }

  // Stil-/Formations-Kohärenz
  if (style === 'kick_and_rush' && angriff < 2) { mod -= 0.02; hinweise.push('Kick and Rush ohne zwei Spitzen verpufft.'); }
  if (style === 'ballbesitz' && kontrolle < 3) { mod -= 0.02; hinweise.push('Ballbesitzfußball braucht Überzahl im Zentrum.'); }
  if (style === 'konter' && angriff < 2 && breite < 3) { mod -= 0.015; hinweise.push('Für Konter fehlen die schnellen Anspielstationen.'); }
  if (style === 'pressing' && zentrum >= 3 && breite >= 3) mod += 0.01;

  return {
    faktor: clamp(1 + mod, 1 - WEIGHTS.formationMax, 1 + WEIGHTS.formationMax),
    zentrum, kontrolle, abwehr, angriff, breite, hinweise
  };
}

/**
 * Mannschaftsstärke einer aufgestellten Elf.
 *
 * @param {object} matchTeam { club, players, tactics, morale, tiredness, coachBonus,
 *                             isHome?, chemistryHistory? }
 * @returns {{ tw, abwehr, mittelfeld, angriff, gesamt, chemie, taktikBonus,
 *             breakdown, schwaechen, staerken }}
 *   breakdown.basis = Rohstärke in Punkten, alle anderen Werte sind Multiplikatoren (1.0 = neutral).
 */
export function teamStrength(matchTeam) {
  const mt = matchTeam || {};
  const players = mt.players || [];
  const tactics = mt.tactics || {};
  const style = tactics.style || 'ausgeglichen';
  const { slots, assigned, missing } = resolveLineup(players, tactics);
  const elf = assigned.map(a => a.player).filter(Boolean);
  const schwaechen = [];
  const staerken = [];

  if (!elf.length) {
    return {
      tw: 1, abwehr: 1, mittelfeld: 1, angriff: 1, gesamt: 1, chemie: 0, taktikBonus: 1,
      breakdown: { basis: 1, formation: 1, stil: 1, moral: 1, fitness: 1, form: 1, chemie: 1, fuehrung: 1, heimvorteil: 1, trainer: 1 },
      schwaechen: ['Keine Aufstellung vorhanden.'], staerken: []
    };
  }
  if (missing > 0) schwaechen.push(`${missing} Position${missing > 1 ? 'en' : ''} nicht besetzt – dort spielt niemand.`);

  /* --- 1. Mannschaftsteile ------------------------------------------------ */
  const groups = { TW: [], ABW: [], MIT: [], STU: [] };
  const groupPlayers = { TW: [], ABW: [], MIT: [], STU: [] };
  for (const { slot, player } of assigned) {
    const g = POSITION_GROUP[slot.pos] || 'MIT';
    if (!player) { groups[g].push(1); continue; }
    groups[g].push(playerRatingForSlot(player, slot.pos));
    groupPlayers[g].push(player);
  }

  const teilwerte = {};
  const teilBasis = {};
  for (const g of ['TW', 'ABW', 'MIT', 'STU']) {
    const basis = groups[g].length ? lineValue(groups[g]) : 1;
    const cond = conditionFactors(groupPlayers[g]);
    teilBasis[g] = basis;
    teilwerte[g] = clamp(basis * cond.gesamt, 1, 99);
  }

  const basisGesamt =
    teilBasis.TW * LINE_WEIGHTS.TW + teilBasis.ABW * LINE_WEIGHTS.ABW +
    teilBasis.MIT * LINE_WEIGHTS.MIT + teilBasis.STU * LINE_WEIGHTS.STU;

  /* --- 2. Kondition (Elf-weit) -------------------------------------------- */
  const cond = conditionFactors(elf);
  const teamMoral = mt.morale != null ? mt.morale : avg(elf, p => p.morale ?? 70);
  const moralTeamF = 1 + ((clamp(teamMoral, 0, 100) - 60) / 100) * WEIGHTS.moralTeam;
  const muedigkeit = clamp(mt.tiredness || 0, 0, 100);
  const fitnessTeamF = 1 - (muedigkeit / 100) * WEIGHTS.tiredness;

  const moralF = cond.moral * moralTeamF;
  const formF = cond.form;
  const fitnessF = cond.fitness * fitnessTeamF;
  const verletztF = cond.verletzt;

  /* --- 3. Formation, Stil, Slider ----------------------------------------- */
  const fFit = formationFit(slots, style);
  const sFit = styleFit(elf, style);
  const slFit = sliderFit(elf, tactics.sliders);
  const stilF = sFit.faktor * slFit.faktor;

  /* --- 4. Chemie ----------------------------------------------------------- */
  const chem = chemistry(players, {
    ...tactics,
    chemistryHistory: mt.chemistryHistory != null ? mt.chemistryHistory : tactics.chemistryHistory
  });
  const chemieF = 1 + ((chem.wert - 50) / 100) * WEIGHTS.chemie;

  /* --- 5. Führung ---------------------------------------------------------- */
  const leaders = elf.filter(p => (p.traits || []).some(t => t === 'leader' || t === 'kabinenleader')).length;
  const fuehrungSchnitt = avg(elf, p => (p.attributes && p.attributes.fuehrung) || 40);
  const kapitaenDa = !!(tactics.setPieces && tactics.setPieces.kapitaen &&
    elf.some(p => p.id === tactics.setPieces.kapitaen));
  const fuehrungF = 1
    + WEIGHTS.fuehrung * clamp((fuehrungSchnitt - 50) / 50, -1, 1) * 0.6
    + WEIGHTS.fuehrung * clamp(leaders / 3, 0, 1) * 0.4
    + (kapitaenDa ? WEIGHTS.kapitaen : -WEIGHTS.kapitaen);

  /* --- 6. Heimvorteil & Trainer -------------------------------------------- */
  let heimF = 1;
  if (mt.isHome === true) heimF = 1 + WEIGHTS.home;
  else if (mt.isHome === false) heimF = 1 - WEIGHTS.away;
  const coachBonus = mt.coachBonus != null ? mt.coachBonus : 50;
  const trainerF = 1 + ((clamp(coachBonus, 0, 100) - 50) / 100) * WEIGHTS.coach;

  /* --- 7. Gesamt ----------------------------------------------------------- */
  const teamF = moralF * formF * fitnessF * verletztF * fFit.faktor * stilF * chemieF * fuehrungF * heimF * trainerF;
  const gesamt = clamp(round(basisGesamt * teamF, 1), 1, 99);

  /* --- 8. Klartext: Stärken & Schwächen ------------------------------------ */
  for (const { slot, player } of assigned) {
    if (!player) continue;
    const aff = bestAffinity(player, slot.pos);
    if (aff < 0.55) schwaechen.push(`Kein gelernter ${POS_NOUN[slot.pos] || POSITION_NAMES[slot.pos]} – ${player.shortName || player.lastName} spielt dort fremd.`);
    else if (aff < 0.8) schwaechen.push(`${player.shortName || player.lastName} ist als ${POS_NOUN[slot.pos] || POSITION_NAMES[slot.pos]} nur zweite Wahl.`);
  }
  for (const h of fFit.hinweise) schwaechen.push(h);
  for (const h of slFit.hinweise) schwaechen.push(h);

  const verletzte = elf.filter(p => p.injury);
  if (verletzte.length) schwaechen.push(`${verletzte.length} angeschlagene${verletzte.length > 1 ? ' Spieler' : 'r Spieler'} in der Startelf.`);
  if (teamMoral < 35) schwaechen.push('Die Stimmung in der Kabine ist im Keller.');
  if (cond.fitness < 0.94) schwaechen.push('Die Mannschaft wirkt körperlich ausgelaugt.');
  if (cond.form < 0.97) schwaechen.push('Halbe Elf außer Form.');
  if (sFit.rel < 0.95) schwaechen.push(`${STYLE_NAMES[style] || style} passt nicht zu diesem Personal.`);
  if (chem.wert < 40) schwaechen.push('Die Mannschaft ist noch keine Einheit.');
  if (teilwerte.TW < basisGesamt - 8) schwaechen.push('Der Torwart ist die Schwachstelle dieser Elf.');
  if (leaders === 0) schwaechen.push('Kein Führungsspieler auf dem Platz.');

  if (sFit.rel > 1.05) staerken.push(`${STYLE_NAMES[style] || style} ist diesem Kader auf den Leib geschneidert.`);
  if (teilwerte.ABW >= basisGesamt + 5) staerken.push('Eine bärenstarke Defensive.');
  if (teilwerte.MIT >= basisGesamt + 5) staerken.push('Das Mittelfeld gibt den Takt vor.');
  if (teilwerte.STU >= basisGesamt + 5) staerken.push('Ein Angriff, der jede Abwehr beschäftigt.');
  if (teilwerte.TW >= basisGesamt + 6) staerken.push('Ein Rückhalt, der Punkte im Alleingang holt.');
  if (chem.wert >= 70) staerken.push('Die Elf harmoniert blendend.');
  if (cond.form > 1.03) staerken.push('Die halbe Mannschaft ist in Topform.');
  if (teamMoral >= 80) staerken.push('Die Mannschaft brennt auf dieses Spiel.');
  if (fFit.kontrolle >= 4) staerken.push('Überzahl im Zentrum – hier läuft das Spiel.');
  if (leaders >= 3) staerken.push('Mehrere Leitwölfe reißen die Truppe mit.');
  if (coachBonus >= 75) staerken.push('Die Trainerbank ist erstklassig besetzt.');

  return {
    tw: round(teilwerte.TW, 1),
    abwehr: round(teilwerte.ABW, 1),
    mittelfeld: round(teilwerte.MIT, 1),
    angriff: round(teilwerte.STU, 1),
    gesamt,
    chemie: chem.wert,
    taktikBonus: round(fFit.faktor * stilF, 4),
    breakdown: {
      basis: round(basisGesamt, 1),
      formation: round(fFit.faktor, 4),
      stil: round(stilF, 4),
      moral: round(moralF, 4),
      fitness: round(fitnessF * verletztF, 4),
      form: round(formF, 4),
      chemie: round(chemieF, 4),
      fuehrung: round(fuehrungF, 4),
      heimvorteil: round(heimF, 4),
      trainer: round(trainerF, 4)
    },
    schwaechen: schwaechen.slice(0, 6),
    staerken: staerken.slice(0, 6),
    chemieGruende: chem.gruende
  };
}

/* ==========================================================================
 * 7. Taktisches Duell
 * ======================================================================== */

/** Formationskennzahlen für den Vergleich. */
function shapeOf(tactics) {
  const slots = resolveSlots(tactics);
  const pos = slots.map(s => s.pos);
  return {
    id: formationIdOf(tactics),
    zentrum: pos.filter(p => CENTER_POS.includes(p)).length,
    abwehr: pos.filter(p => ['IV', 'LV', 'RV'].includes(p)).length,
    innen: pos.filter(p => p === 'IV').length,
    fluegel: pos.filter(p => ['LM', 'RM', 'LA', 'RA'].includes(p)).length,
    aussenverteidiger: pos.filter(p => ['LV', 'RV'].includes(p)).length,
    spitzen: pos.filter(p => p === 'ST').length,
    angriff: pos.filter(p => ['LA', 'RA', 'ST'].includes(p)).length,
    hoch: pos.filter(p => p === 'OM').length
  };
}

const MATCHUP = {
  zentrum: 0.026,      // je Mann Überzahl im Zentrum
  fluegel: 0.020,      // Flügelüberzahl gegen zu wenige Außenverteidiger
  spitzenUeberzahl: 0.022, // Stürmer gegen Innenverteidiger
  pressingTief: 0.035, // hohes Pressing gegen tiefen Ballbesitz
  abseitsfalle: 0.030, // Abseitsfalle gegen Tempokonter
  tempoDruck: 0.018,
  max: 0.15
};

/**
 * Taktisches Duell zweier Aufstellungen.
 * @returns {{ homeMod: number, awayMod: number, reasons: string[] }} je 0.85..1.15
 */
export function tacticMatchup(aTactics, bTactics) {
  const a = aTactics || {}, b = bTactics || {};
  const sa = shapeOf(a), sb = shapeOf(b);
  const styleA = a.style || 'ausgeglichen', styleB = b.style || 'ausgeglichen';
  const slA = a.sliders || {}, slB = b.sliders || {};
  const reasons = [];
  let home = 0, away = 0;

  /* --- Zentrum ------------------------------------------------------------- */
  const dz = sa.zentrum - sb.zentrum;
  if (dz !== 0) {
    home += MATCHUP.zentrum * dz;
    away -= MATCHUP.zentrum * dz;
    const sieger = dz > 0 ? sa : sb;
    const verlierer = dz > 0 ? sb : sa;
    reasons.push(`${sieger.id} dominiert mit ${sieger.zentrum} gegen ${verlierer.zentrum} Mann das Zentrum gegen ${verlierer.id}.`);
  }

  /* --- Flügel gegen Außenverteidiger --------------------------------------- */
  const flA = sa.fluegel - sb.aussenverteidiger;
  if (flA >= 1) {
    home += MATCHUP.fluegel * Math.min(2, flA);
    reasons.push(`Die Außen von ${sa.id} finden gegen nur ${sb.aussenverteidiger} Außenverteidiger reihenweise Räume.`);
  }
  const flB = sb.fluegel - sa.aussenverteidiger;
  if (flB >= 1) {
    away += MATCHUP.fluegel * Math.min(2, flB);
    reasons.push(`${sb.id} überlädt die Flügel – die Abwehrkette von ${sa.id} muss weit auseinanderziehen.`);
  }

  /* --- Spitzen gegen Innenverteidiger --------------------------------------- */
  if (sa.angriff > sb.innen) {
    home += MATCHUP.spitzenUeberzahl * (sa.angriff - sb.innen);
    reasons.push(`${sa.angriff} Angreifer gegen ${sb.innen} Innenverteidiger – Überzahl vor dem Tor.`);
  }
  if (sb.angriff > sa.innen) {
    away += MATCHUP.spitzenUeberzahl * (sb.angriff - sa.innen);
    reasons.push(`${sb.id} greift mit ${sb.angriff} Mann an, ${sa.id} hat nur ${sa.innen} Innenverteidiger dagegen.`);
  }

  /* --- Stilduell ------------------------------------------------------------ */
  const mA = (STYLE_MATCHUP[styleA] || {})[styleB] || 0;
  const mB = (STYLE_MATCHUP[styleB] || {})[styleA] || 0;
  home += mA; away += mB;
  if (Math.abs(mA) >= 0.03 || Math.abs(mB) >= 0.03) {
    if (mA > mB) reasons.push(`${STYLE_NAMES[styleA]} ist das perfekte Gegenmittel gegen ${STYLE_NAMES[styleB]}.`);
    else if (mB > mA) reasons.push(`${STYLE_NAMES[styleB]} nimmt ${STYLE_NAMES[styleA]} den Zahn.`);
  }

  /* --- Pressinghöhe gegen tiefen Aufbau -------------------------------------- */
  const pA = slA.pressinghoehe ?? 50, pB = slB.pressinghoehe ?? 50;
  if (pA >= 65 && pB <= 42 && (styleB === 'ballbesitz' || styleB === 'defensiv')) {
    home += MATCHUP.pressingTief;
    reasons.push('Das hohe Pressing erstickt den tiefen Spielaufbau des Gegners im Keim.');
  }
  if (pB >= 65 && pA <= 42 && (styleA === 'ballbesitz' || styleA === 'defensiv')) {
    away += MATCHUP.pressingTief;
    reasons.push('Der Gegner presst hoch – der eigene tiefe Aufbau wird zum Vabanquespiel.');
  }

  /* --- Abseitsfalle gegen Tempokonter ---------------------------------------- */
  const trapA = a.offsideTrap || (a.instructions && a.instructions.abseitsfalle);
  const trapB = b.offsideTrap || (b.instructions && b.instructions.abseitsfalle);
  if (trapA && styleB === 'konter' && (slB.tempo ?? 50) >= 60) {
    home -= MATCHUP.abseitsfalle;
    away += MATCHUP.abseitsfalle * 0.6;
    reasons.push('Die Abseitsfalle gegen ein Tempokonter-Team ist ein gefährliches Spiel.');
  }
  if (trapB && styleA === 'konter' && (slA.tempo ?? 50) >= 60) {
    away -= MATCHUP.abseitsfalle;
    home += MATCHUP.abseitsfalle * 0.6;
    reasons.push('Der Gegner stellt die Abseitsfalle – Tempoläufe können sie zerreißen.');
  }

  /* --- Tempoduell ------------------------------------------------------------ */
  const dt = (slA.tempo ?? 50) - (slB.tempo ?? 50);
  if (Math.abs(dt) >= 25) {
    home += MATCHUP.tempoDruck * (dt / 100) * 2;
    away -= MATCHUP.tempoDruck * (dt / 100) * 2;
    reasons.push(dt > 0
      ? 'Das deutlich höhere Tempo setzt den Gegner permanent unter Druck.'
      : 'Der Gegner spielt spürbar schneller und diktiert den Rhythmus.');
  }

  /* --- Lange Bälle gegen hohe Kette -------------------------------------------- */
  if (a.instructions && a.instructions.langeBaelle && pB >= 62) {
    home += 0.015;
    reasons.push('Lange Bälle hinter die hoch stehende Abwehrkette des Gegners.');
  }
  if (b.instructions && b.instructions.langeBaelle && pA >= 62) {
    away += 0.015;
    reasons.push('Der Gegner schlägt lange Bälle hinter die eigene hohe Kette.');
  }

  if (!reasons.length) reasons.push('Taktisch ausgeglichen – kein Team hat einen echten Hebel.');

  return {
    homeMod: round(clamp(1 + home, 1 - MATCHUP.max, 1 + MATCHUP.max), 4),
    awayMod: round(clamp(1 + away, 1 - MATCHUP.max, 1 + MATCHUP.max), 4),
    reasons: reasons.slice(0, 6)
  };
}
