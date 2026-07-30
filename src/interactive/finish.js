/**
 * Minispiel „Torabschluss"  —  KeyMoment.kind === 'abschluss'
 * ---------------------------------------------------------------------------
 * Schräge Ansicht Richtung Tor. Der Ball wird angenommen (Anlauf-Phase), dann
 * öffnet sich ein kurzes Schussfenster. Alles bewegt sich in Echtzeit:
 *
 *   • Der Torwart verkürzt den Winkel (läuft heraus) und folgt dem Zielkreuz
 *     mit Verzögerung  ->  die freie Torfläche schrumpft von Frame zu Frame.
 *   • Verteidiger rücken heran  ->  je später der Schuss, desto größer die
 *     Blockgefahr.
 *   • Ganz früh geschossen ist der Spieler noch nicht ausbalanciert
 *     ->  deutlich größere Streuung.
 *
 * Daraus entsteht die eigentliche Abwägung: früh = ungenau, spät = riskant.
 * Wer wartet, kann den Torwart aber auch aus der Reserve locken und ihn per
 * Heber überwinden.
 *
 * Steuerung:
 *   Maus          zielen (Zielkreuz wandert über die Torfläche)
 *   Klick / [1]   Flachschuss  – schnell, nur untere Torhälfte, blockbar
 *   [2]           Heber        – fliegt über die Verteidiger, langsam
 *   [3]           Platziert    – genau, aber langsam (Torwart hat mehr Zeit)
 *   ESC           abbrechen (Simulation übernimmt, Rückgabe null)
 *
 * Kopfball-Variante (moment.high === true): statt Zielen ein Timing-Balken.
 *
 * Rückgabe: { outcome, quality, targetPlayerId, xgDelta } – siehe CONTRACTS 6.1.
 */

import { clamp, lerp } from '../core/util.js';

/* ========================================================================== *
 *  BALANCING-KONSTANTEN  (alles an einem Ort, damit Feintuning leichtfällt)
 * ========================================================================== */

const CANVAS_W = 960;
const CANVAS_H = 600;

/** Notbremse laut Vertrag: nach 20 s wird auf jeden Fall aufgelöst. */
const HARD_TIMEOUT_S = 20;

/** Ballannahme/Anlauf, bevor das Schussfenster aufgeht. */
const APPROACH_S = 0.85;

/** Länge des Schussfensters (Sekunden) – wird über Nervenstärke interpoliert. */
const WINDOW_MIN_S = 1.2;
const WINDOW_MAX_S = 2.5;
/** Harte Grenzen nach der Schwierigkeitsskalierung. */
const WINDOW_CLAMP = [0.85, 3.2];

/** Anteil des Fensters, in dem der Schütze noch nicht sauber steht. */
const SETTLE_FRAC = 0.34;
const EARLY_SPREAD_MULT = 1.95;   // Streuungsfaktor ganz zu Beginn
const LATE_SPREAD_MULT = 0.88;    // …und am Ende des Fensters (voll ausbalanciert)

/** Grundstreuung in Tor-Einheiten (1.0 = ganze Torbreite) bei Skill 50. */
const AIM_SPREAD_BASE = 0.125;
/** Vertikale Streuung relativ zur horizontalen (Tor ist hoch schmaler). */
const VERT_SPREAD_RATIO = 1.60;
/** Druck des Gegners erhöht die Streuung um bis zu diesen Faktor. */
const PRESSURE_SPREAD = 0.35;

/** Torwart-Reichweite in Tor-Einheiten (u): Basis + Anteil aus Reflexen.
 *  0.16 entspricht rund 1,2 m Hechtweite zu jeder Seite. */
const KEEPER_REACH_BASE = 0.062;
const KEEPER_REACH_SKILL = 0.072;
/** Herauslaufen verkürzt den Winkel: bis zu +x auf die Reichweite. */
const KEEPER_ADVANCE_GAIN = 0.35;
/** Relativer Abstand (Vielfaches der Reichweite), ab dem gar nichts mehr geht.
 *  Am Rand der Reichweite hält er also nur noch selten – kein harter Schnitt. */
const KEEPER_SAVE_EDGE = 1.15;
/** Um so viel senkt ein Ball unters Lattenkreuz die Haltewahrscheinlichkeit. */
const KEEPER_HEIGHT_FALLOFF = 0.60;
/** Zufällige Tagesform des Keepers pro Schuss. */
const KEEPER_LUCK = [0.86, 1.16];
/** Wie schnell der Torwart dem Zielkreuz folgt (Tor-Einheiten pro Sekunde). */
const KEEPER_TRACK_SPEED = 0.26;
/** So dicht kommt er dem Zielkreuz höchstens – er stellt den Winkel, er rät nicht. */
const KEEPER_TRACK_DEADZONE = 0.05;
/** Weiter als das darf er sich nicht aus der Tormitte ziehen lassen. */
const KEEPER_MAX_OFFSET = 0.22;
/** Wie weit der Torwart im Verlauf des Fensters herausläuft (0..1). */
const KEEPER_ADVANCE_PER_S = 0.42;
/** Ab diesem Herauslauf-Wert ist der Heber richtig stark. */
const KEEPER_CHIP_EXPOSED = 0.45;
const KEEPER_CHIP_PENALTY = 0.55;
/** Zusätzlicher Faktor, wenn der Heber wirklich über ihn hinweg segelt. */
const KEEPER_CHIP_OVER = 0.30;
const KEEPER_CHIP_OVER_V = 0.50;

/** Verteidiger: maximale Blockwahrscheinlichkeit direkt vor dem Schützen. */
const BLOCK_MAX = 0.72;
/** Je größer, desto später wird der Block gefährlich (Kurvenform über die Nähe). */
const BLOCK_PROX_EXP = 1.8;
/** Breite des Blockkorridors in Tor-Einheiten. */
const BLOCK_CORRIDOR = 0.30;
/** Wie stark Verteidiger dem Zielkreuz nachschieben (0 = gar nicht). */
const BLOCK_TRACK = 0.30;

/** Pfosten-/Lattenband außerhalb des Tors (in Tor-Einheiten). */
const WOOD_BAND_U = 0.045;
const WOOD_BAND_V = 0.05;

/** xgDelta-Grenzen laut Vertrag. */
const XG_MIN = -0.10;
const XG_MAX = 0.40;

/** Kopfball-Timing: Breite des grünen Bereichs (Balkenanteil) bei Skill 50. */
const HEAD_GREEN_BASE = 0.13;
const HEAD_GREEN_SKILL = 0.11;
/** Geschwindigkeit des Timing-Markers (Durchläufe pro Sekunde) bei Skill 50. */
const HEAD_BAR_SPEED = 0.62;
/** Flugzeit der Flanke, bevor das Timing-Fenster endet. */
const HEAD_WINDOW_S = 2.4;

/** Schusstypen. vScale/vLift begrenzen, wohin der Typ überhaupt zielen kann. */
const SHOT_TYPES = {
  flach: {
    name: 'Flachschuss', hint: 'schnell, flach, blockbar',
    spread: 1.00, speed: 1.00, vScale: 0.55, vLift: 0.02, block: 1.00, flight: 0.42, xg: 0.02
  },
  heber: {
    name: 'Heber', hint: 'über alles hinweg, aber langsam',
    spread: 1.28, speed: 0.60, vScale: 0.55, vLift: 0.42, block: 0.12, flight: 0.80, xg: 0.00
  },
  platziert: {
    name: 'Platziert', hint: 'genau – der Keeper hat mehr Zeit',
    spread: 0.75, speed: 0.74, vScale: 1.00, vLift: 0.00, block: 0.78, flight: 0.62, xg: 0.01
  },
  kopfball: {
    name: 'Kopfball', hint: 'Timing entscheidet',
    spread: 1.00, speed: 0.80, vScale: 1.00, vLift: 0.00, block: 0.50, flight: 0.55, xg: 0.00
  }
};

/** Retro-Palette (siehe Stil-Leitfaden im Vertrag). */
const COL = {
  himmel: '#16283f', rangDunkel: '#22344c', rangHell: '#37506e',
  rasen: '#2f7d32', rasenDunkel: '#276b2a', rasenHell: '#3b8f3e',
  linie: '#f4f4ec', netz: '#e3eaec', outline: '#0d1116',
  holz: '#8b5a2b', beige: '#e8d9b0', papier: '#f2e8cf',
  rot: '#c1272d', blau: '#1c4f8f', gelb: '#f5c518', gruen: '#3fae4a', schwarz: '#0d1116'
};

/** Tor-Viereck in Bildschirmkoordinaten (linker Pfosten näher = größer). */
const GOAL = {
  lx: 250, rx: 712,          // Pfosten-x
  lBottom: 330, lTop: 142,   // linker Pfosten (nah, hoch)
  rBottom: 292, rTop: 168    // rechter Pfosten (fern, kleiner)
};

/** Bildschirmband, über das die Maus die Torfläche abtastet. */
const AIM_BOX = { x0: 205, x1: 757, yTop: 118, yBottom: 348 };

/** Position von Ball und Schütze. */
const BALL_HOME = { x: 470, y: 512 };

/* ========================================================================== *
 *  KLEINE HELFER  (bewusst lokal – interactive/-Module bleiben eigenständig)
 * ========================================================================== */

let warnedDraw = false;

const att = (p, key, fallback = 50) => {
  const v = p && p.attributes ? p.attributes[key] : undefined;
  return typeof v === 'number' ? v : fallback;
};

const hasTrait = (p, key) => !!(p && Array.isArray(p.traits) && p.traits.indexOf(key) >= 0);

const nameOf = (p, fallback = 'Spieler') =>
  (p && (p.shortName || p.lastName)) || fallback;

/** Zufalls-Helfer, die nur rng.next() voraussetzen. */
function rFloat(rng, a, b) { return a + rng.next() * (b - a); }
function rChance(rng, p) { return rng.next() < p; }
function rGauss(rng, mean, sd) {
  if (typeof rng.gauss === 'function') return rng.gauss(mean, sd);
  let u = 0, v = 0, s = 0;
  do { u = rng.next() * 2 - 1; v = rng.next() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  return mean + sd * (u * Math.sqrt(-2 * Math.log(s) / s));
}

/** Projiziert Tor-Koordinaten (u = 0..1 quer, v = 0..1 hoch) auf den Bildschirm. */
function project(u, v) {
  const x = lerp(GOAL.lx, GOAL.rx, u);
  const yBottom = lerp(GOAL.lBottom, GOAL.rBottom, u);
  const yTop = lerp(GOAL.lTop, GOAL.rTop, u);
  return { x, y: lerp(yBottom, yTop, v) };
}

/* ========================================================================== *
 *  ZEICHEN-BAUSTEINE
 * ========================================================================== */

function fillRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Anstoß-Panel mit 2px-Bevel (hell oben/links, dunkel unten/rechts). */
function panel(ctx, x, y, w, h, bg = COL.beige) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h);
  ctx.strokeStyle = COL.outline; ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function text(ctx, str, x, y, opts = {}) {
  const size = opts.size || 16;
  const weight = opts.weight || 'bold';
  ctx.font = `${weight} ${size}px "Arial Black", "Arial", system-ui, sans-serif`;
  ctx.textAlign = opts.align || 'left';
  ctx.textBaseline = opts.baseline || 'alphabetic';
  if (opts.outline !== false) {
    ctx.lineWidth = opts.outlineWidth || Math.max(3, size * 0.22);
    ctx.strokeStyle = opts.outlineColor || COL.outline;
    ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = opts.color || COL.papier;
  ctx.fillText(str, x, y);
}

/** Fallback-Spielerfigur, falls host.drawPlayer fehlt oder wirft. */
function figureFallback(ctx, x, y, scale, colorA, colorB) {
  const s = scale * 34;
  ctx.save();
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.strokeStyle = COL.outline;
  // Beine
  ctx.strokeStyle = COL.outline; ctx.fillStyle = '#1c1c22';
  ctx.fillRect(x - s * 0.22, y - s * 0.45, s * 0.18, s * 0.45);
  ctx.fillRect(x + s * 0.04, y - s * 0.45, s * 0.18, s * 0.45);
  ctx.strokeRect(x - s * 0.22, y - s * 0.45, s * 0.18, s * 0.45);
  ctx.strokeRect(x + s * 0.04, y - s * 0.45, s * 0.18, s * 0.45);
  // Rumpf
  ctx.fillStyle = colorA;
  ctx.fillRect(x - s * 0.30, y - s * 1.05, s * 0.60, s * 0.62);
  ctx.strokeRect(x - s * 0.30, y - s * 1.05, s * 0.60, s * 0.62);
  ctx.fillStyle = colorB;
  ctx.fillRect(x - s * 0.30, y - s * 1.05, s * 0.60, s * 0.16);
  // Kopf
  ctx.fillStyle = '#d9a273';
  ctx.beginPath(); ctx.arc(x, y - s * 1.22, s * 0.20, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

/* ========================================================================== *
 *  MINISPIEL
 * ========================================================================== */

export const minigame = {
  id: 'abschluss',
  kind: 'abschluss',
  title: 'Torabschluss',
  instructions:
    'Maus zielen · Klick oder [1] Flachschuss · [2] Heber · [3] platziert · ' +
    'bei Flanken: [Leertaste] im grünen Bereich · [ESC] Simulation entscheiden lassen',

  async play(host, moment) {
    const canvas = host && host.canvas;
    const ctx = (host && host.ctx) || (canvas && canvas.getContext && canvas.getContext('2d'));
    if (!canvas || !ctx) {
      console.warn('[abschluss] Kein Canvas/Kontext übergeben – Minispiel wird übersprungen.');
      return null;
    }

    /* ---- Kontext auspacken ------------------------------------------------ */
    const m = moment || {};
    const actor = m.actor || null;
    const keeper = m.keeper || null;
    const defenders = Array.isArray(m.defenders) ? m.defenders.slice(0, 3) : [];
    const context = m.context || {};
    const score = Array.isArray(context.score) ? context.score : [0, 0];
    const minute = typeof m.minute === 'number' ? m.minute : (context.minute || 0);
    const pressure = clamp(typeof m.pressure === 'number' ? m.pressure : 45, 0, 100);
    const isHeader = m.high === true;

    // Eigene, abgezweigte RNG: fork() verändert den Zustand der Eltern-RNG NICHT,
    // dadurch bleibt die Match-Simulation trotz variabler Frame-Zahl deterministisch.
    const rng = (host.rng && typeof host.rng.fork === 'function')
      ? host.rng.fork('minigame:abschluss:' + (actor && actor.id ? actor.id : '?'))
      : (host.rng || { next: () => 0.5 });

    const diff = clamp((host.difficulty && host.difficulty.minigame) || 1, 0.4, 2);
    // Klangnamen aus dem Vertrag von render/sound.js. Der zweite Parameter geht
    // unverändert an die Klangbank durch ({ lautstaerke, hoehe, panorama }).
    const sfx = (n, o) => { try { if (typeof host.sound === 'function') host.sound(n, o); } catch (e) { /* egal */ } };

    /** Was am Ende des Fluges zu hören ist – je Ausgang genau ein Klang. */
    const AUSGANG_KLANG = {
      tor: ['tor', null],
      parade: ['parade', null],
      geblockt: ['block', null],
      latte: ['pfosten', { hoehe: 1.12 }],
      pfosten: ['pfosten', null],
      daneben: ['raunen', { lautstaerke: 0.9 }]
    };

    /* ---- Spielerabhängige Kennzahlen -------------------------------------- */
    const nerven = att(actor, 'nervenstaerke');
    const skill01 = clamp(
      (att(actor, 'schuss') * 0.50 + att(actor, 'technik') * 0.28 + nerven * 0.22) / 99, 0, 1);
    const headSkill01 = clamp(
      (att(actor, 'kopfball') * 0.60 + att(actor, 'sprungkraft') * 0.40) / 99, 0, 1);
    const keeperSkill01 = clamp(
      (att(keeper, 'reflexe', 55) * 0.62 + att(keeper, 'stellungsspiel', 55) * 0.38) / 99, 0, 1);

    // Ein nervenstarker Spieler behält länger die Übersicht -> größeres Fenster.
    const windowS = clamp(
      lerp(WINDOW_MIN_S, WINDOW_MAX_S, clamp(nerven / 99, 0, 1)) / diff,
      WINDOW_CLAMP[0], WINDOW_CLAMP[1]);

    const spreadSkillMult = (1.50 - 1.00 * skill01)
      * (0.75 + 0.35 * diff)
      * (1 + (pressure / 100) * PRESSURE_SPREAD)
      * (hasTrait(actor, 'knipser') ? 0.88 : 1)
      * (hasTrait(actor, 'weltfussballer') ? 0.92 : 1);

    /* ---- Szenen-Zustand ---------------------------------------------------- */
    const S = {
      phase: isHeader ? 'flanke' : 'anlauf',  // anlauf|fenster|flanke|flug|ergebnis
      t: 0, phaseT: 0,
      mouse: { x: BALL_HOME.x, y: 300 },
      aimU: 0.5, aimV: 0.45,
      keeperU: 0.5, keeperAdvance: 0.06,
      barPos: 0, barDir: 1,
      shot: null,            // { type, u, v, res }
      flight: null,          // { from, to, dur, arc }
      resolution: null,
      banner: ''
    };

    /** Wird weiter unten (in der Promise) mit der echten Auflösung belegt. */
    let settle = () => { };

    // Verteidiger als kleine Zustandsobjekte (Position in Tor-Einheiten + Nähe).
    const defs = defenders.map((p, i) => ({
      player: p,
      u: clamp(0.30 + i * 0.20 + rFloat(rng, -0.07, 0.07), 0.05, 0.95),
      prox: rFloat(rng, 0.10, 0.24),                 // 0 = weit weg, 1 = direkt davor
      speed: rFloat(rng, 0.36, 0.55) * (0.7 + att(p, 'tempo') / 160),
      lane: rFloat(rng, -1, 1)
    }));
    if (defs.length === 0) {
      defs.push({ player: null, u: 0.5, prox: 0.15, speed: 0.6, lane: 0 });
    }

    /* ---- Kopfball-Kennwerte ------------------------------------------------ */
    const greenHalf = clamp(
      (HEAD_GREEN_BASE + HEAD_GREEN_SKILL * headSkill01)
      * (hasTrait(actor, 'kopfballungeheuer') ? 1.35 : 1) / diff, 0.045, 0.34);
    const barSpeed = HEAD_BAR_SPEED * (0.75 + 0.45 * diff) / (0.8 + 0.4 * headSkill01);
    const greenCenter = 0.62;   // etwas rechts der Mitte – man muss aktiv treffen

    /* ====================================================================== *
     *  AUFLÖSUNG
     * ====================================================================== */

    /** Aktuelle Torwart-Reichweite (halbe Breite in Tor-Einheiten) für einen Schusstyp. */
    function keeperReach(typeKey) {
      const spec = SHOT_TYPES[typeKey] || SHOT_TYPES.flach;
      let reach = (KEEPER_REACH_BASE + KEEPER_REACH_SKILL * keeperSkill01);
      reach *= Math.pow(1 / spec.speed, 0.55);                  // langsamer Ball = mehr Zeit
      reach *= (1 + S.keeperAdvance * KEEPER_ADVANCE_GAIN);     // Winkel verkürzt
      reach *= (0.82 + 0.30 * diff);
      if (hasTrait(keeper, 'torwartlegende')) reach *= 1.12;
      // Heber gegen weit herausgelaufenen Keeper: der kommt nicht mehr zurück.
      if (typeKey === 'heber' && S.keeperAdvance > KEEPER_CHIP_EXPOSED) reach *= KEEPER_CHIP_PENALTY;
      return reach;
    }

    /**
     * Haltewahrscheinlichkeit: sinkt linear mit dem relativen Abstand und
     * zusätzlich, je höher der Ball einschlägt.
     */
    function saveProbability(du, reach, v) {
      if (reach <= 0) return 0;
      const rel = Math.abs(du) / reach;
      const base = clamp(KEEPER_SAVE_EDGE - rel, 0, 1);
      const hoch = clamp((v - 0.40) / 0.60, 0, 1);
      return base * (1 - KEEPER_HEIGHT_FALLOFF * hoch);
    }

    /**
     * Für die Darstellung: bis zu welcher Höhe ist der Torwart in dieser Spalte
     * eine echte Bedrohung (Haltewahrscheinlichkeit ≥ 45 %)?
     */
    function coverHeight(du, reach) {
      if (reach <= 0) return 0;
      const base = clamp(KEEPER_SAVE_EDGE - Math.abs(du) / reach, 0, 1);
      if (base <= 0.45) return 0;
      const x = (1 - 0.45 / base) / KEEPER_HEIGHT_FALLOFF;
      return clamp(0.40 + 0.60 * x, 0, 1);
    }

    /**
     * Bewertet einen abgegebenen Schuss vollständig geometrisch:
     * Block -> Rahmen -> Torwart -> Tor.
     */
    function resolveShot(typeKey, aimU, aimV, tFrac) {
      const spec = SHOT_TYPES[typeKey] || SHOT_TYPES.flach;

      // 1) Streuung: früh = wacklig, spät = sauber gestanden.
      const settleMult = tFrac < SETTLE_FRAC
        ? lerp(EARLY_SPREAD_MULT, 1, clamp(tFrac / SETTLE_FRAC, 0, 1))
        : lerp(1, LATE_SPREAD_MULT, clamp((tFrac - SETTLE_FRAC) / (1 - SETTLE_FRAC), 0, 1));
      const spreadU = AIM_SPREAD_BASE * spreadSkillMult * settleMult * spec.spread;

      const targetV = clamp(aimV * spec.vScale + spec.vLift, -0.15, 1.30);
      const u = aimU + rGauss(rng, 0, spreadU);
      // Nach unten wird geklemmt: ein Ball kann nicht „unter" das Tor gehen,
      // ein zu flacher Schuss rollt eben am Boden entlang.
      const v = Math.max(0.012, targetV + rGauss(rng, 0, spreadU * VERT_SPREAD_RATIO));

      // 2) Block durch heranrückende Verteidiger.
      let blockP = 0, blocker = null;
      for (const d of defs) {
        const corridor = clamp(1 - Math.abs(u - d.u) / BLOCK_CORRIDOR, 0, 1);
        const p = BLOCK_MAX * Math.pow(clamp(d.prox, 0, 1), BLOCK_PROX_EXP) * corridor * spec.block;
        if (p > blockP) { blockP = p; blocker = d; }
      }
      const blocked = blockP > 0 && rChance(rng, blockP);

      // 3) Rahmen: innerhalb 0..1 ist das Tor, das schmale Band daneben Alu.
      const insideU = u >= 0 && u <= 1;
      const insideV = v >= 0 && v <= 1;
      const woodU = !insideU && (u > -WOOD_BAND_U && u < 1 + WOOD_BAND_U);
      const woodV = !insideV && (v > -WOOD_BAND_V && v < 1 + WOOD_BAND_V);

      // 4) Torwart. Ein echter Heber über den herausgelaufenen Keeper ist durch.
      let reach = keeperReach(typeKey);
      if (typeKey === 'heber' && S.keeperAdvance > KEEPER_CHIP_EXPOSED && v > KEEPER_CHIP_OVER_V) {
        reach *= KEEPER_CHIP_OVER;
      }
      const du = u - S.keeperU;
      const luck = rFloat(rng, KEEPER_LUCK[0], KEEPER_LUCK[1]);
      const saved = insideU && insideV
        && rChance(rng, saveProbability(du, reach, v) * luck);

      // 5) Ausführungsgüte (das ist die Leistung des Menschen am Schirm).
      const placement = clamp(Math.abs(du) / 0.42, 0, 1);
      const cornerV = clamp(Math.abs(v - 0.42) / 0.48, 0, 1);
      const timingBonus = clamp(1 - Math.abs(tFrac - 0.55) / 0.55, 0, 1);
      const offTarget = (insideU && insideV) ? 0 : (woodU || woodV ? 0.45 : 1);
      let quality = 0.20
        + 0.40 * placement
        + 0.16 * cornerV
        + 0.16 * timingBonus
        - 0.42 * offTarget
        - 0.18 * (blocked ? 1 : 0);
      quality = clamp(quality * (0.82 + 0.24 * skill01), 0, 1);

      let outcome;
      if (blocked) outcome = 'geblockt';
      else if (!insideU || !insideV) {
        if (woodV && insideU) outcome = 'latte';
        else if (woodU && (insideV || woodV)) outcome = 'pfosten';
        else outcome = 'daneben';
      } else if (saved) outcome = 'parade';
      else outcome = 'tor';

      if (outcome === 'tor') quality = clamp(quality + 0.12, 0, 1);
      if (outcome === 'latte' || outcome === 'pfosten') quality = clamp(quality + 0.10, 0, 1);

      // Zielpunkt für die Flugbahn-Animation
      let hit = project(clamp(u, -0.14, 1.14), clamp(v, -0.12, 1.2));
      if (outcome === 'geblockt' && blocker) {
        const bp = project(blocker.u, 0.12);
        hit = { x: lerp(BALL_HOME.x, bp.x, 0.78), y: lerp(BALL_HOME.y, bp.y, 0.78) };
      } else if (outcome === 'parade') {
        const kp = project(S.keeperU, clamp(v, 0, 1));
        hit = { x: lerp(kp.x, hit.x, 0.35), y: lerp(kp.y, hit.y, 0.35) };
      }

      const xgDelta = clamp(
        XG_MIN + (XG_MAX - XG_MIN) * Math.pow(quality, 1.25) + spec.xg
        + (outcome === 'tor' ? 0.05 : 0) + (outcome === 'geblockt' ? -0.05 : 0),
        XG_MIN, XG_MAX);

      return {
        outcome,
        quality,
        targetPlayerId: actor && actor.id ? actor.id : null,
        xgDelta,
        _hit: hit,
        _u: u, _v: v
      };
    }

    /* ====================================================================== *
     *  ZEICHNEN
     * ====================================================================== */

    function drawBackground() {
      // Himmel + Ränge
      fillRect(ctx, 0, 0, CANVAS_W, 90, COL.himmel);
      for (let i = 0; i < 5; i++) {
        fillRect(ctx, 0, 18 + i * 12, CANVAS_W, 9, i % 2 ? COL.rangDunkel : COL.rangHell);
      }
      // Zuschauer-Pixel (deterministisch aus dem Index, kein Zufall pro Frame)
      for (let i = 0; i < 260; i++) {
        const x = (i * 97) % CANVAS_W;
        const y = 16 + ((i * 53) % 62);
        const c = ['#d9d2c2', '#c1272d', '#1c4f8f', '#f5c518', '#8b5a2b'][i % 5];
        fillRect(ctx, x, y, 4, 4, c);
      }
      fillRect(ctx, 0, 84, CANVAS_W, 8, COL.holz);

      // Rasen mit Perspektivstreifen
      fillRect(ctx, 0, 92, CANVAS_W, CANVAS_H - 92, COL.rasen);
      let y = 92, band = 16;
      let idx = 0;
      while (y < CANVAS_H) {
        if (idx % 2 === 0) fillRect(ctx, 0, y, CANVAS_W, band, COL.rasenDunkel);
        y += band; band *= 1.14; idx++;
      }
      // Strafraum-Andeutung
      ctx.strokeStyle = COL.linie; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(60, 470); ctx.lineTo(196, 300); ctx.lineTo(772, 268); ctx.lineTo(910, 424);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(180, 352); ctx.lineTo(252, 300); ctx.lineTo(716, 282); ctx.lineTo(800, 330);
      ctx.stroke();
    }

    function drawGoalAndCoverage(typeKey) {
      const tl = project(0, 1), tr = project(1, 1);
      const bl = project(0, 0), br = project(1, 0);

      // Netz (hinter der Torfläche)
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(bl.x, bl.y); ctx.lineTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(br.x, br.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(12,20,26,0.55)';
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = 'rgba(227,234,236,0.45)'; ctx.lineWidth = 1.5;
      for (let i = 0; i <= 18; i++) {
        const a = project(i / 18, 0), b = project(i / 18, 1);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (let j = 0; j <= 9; j++) {
        const a = project(0, j / 9), b = project(1, j / 9);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();

      // Freie Torfläche / Torwart-Abdeckung als „Skyline"
      const reach = keeperReach(typeKey);
      const cols = 30;
      for (let i = 0; i < cols; i++) {
        const u0 = i / cols, u1 = (i + 1) / cols;
        const um = (u0 + u1) / 2;
        const cov = coverHeight(um - S.keeperU, reach);
        const p00 = project(u0, 0), p10 = project(u1, 0);
        const pc0 = project(u0, cov), pc1 = project(u1, cov);
        const pt0 = project(u0, 1), pt1 = project(u1, 1);
        if (cov > 0.01) {
          ctx.fillStyle = 'rgba(193,39,45,0.42)';
          ctx.beginPath();
          ctx.moveTo(p00.x, p00.y); ctx.lineTo(pc0.x, pc0.y);
          ctx.lineTo(pc1.x, pc1.y); ctx.lineTo(p10.x, p10.y);
          ctx.closePath(); ctx.fill();
        }
        if (cov < 0.99) {
          ctx.fillStyle = 'rgba(245,197,24,0.22)';
          ctx.beginPath();
          ctx.moveTo(pc0.x, pc0.y); ctx.lineTo(pt0.x, pt0.y);
          ctx.lineTo(pt1.x, pt1.y); ctx.lineTo(pc1.x, pc1.y);
          ctx.closePath(); ctx.fill();
        }
      }

      // Rahmen: dicke weiße Balken mit schwarzer Outline
      ctx.lineCap = 'round';
      const bars = [
        [bl, tl], [br, tr], [tl, tr]
      ];
      for (const [a, b] of bars) {
        ctx.strokeStyle = COL.outline; ctx.lineWidth = 14;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = COL.linie; ctx.lineWidth = 9;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      // Torlinie
      ctx.strokeStyle = COL.linie; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(br.x, br.y); ctx.stroke();
    }

    function drawFigure(player, x, y, scale, opts, colA, colB) {
      if (typeof host.drawPlayer === 'function' && player) {
        try { host.drawPlayer(ctx, player, x, y, scale, opts || {}); return; }
        catch (e) {
          if (!warnedDraw) { warnedDraw = true; console.warn('[abschluss] host.drawPlayer fehlgeschlagen, nutze Notdarstellung:', e); }
        }
      }
      figureFallback(ctx, x, y, scale, colA || COL.blau, colB || COL.papier);
    }

    function drawKeeper() {
      const base = project(S.keeperU, 0);
      // Herauslaufen: näher an den Schützen = weiter unten und größer
      const x = lerp(base.x, BALL_HOME.x, S.keeperAdvance * 0.20);
      const y = lerp(base.y, BALL_HOME.y, S.keeperAdvance * 0.34);
      const scale = 0.86 + S.keeperAdvance * 0.42;
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(x, y + 4, 26 * scale, 8 * scale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      drawFigure(keeper, x, y, scale, { pose: 'parade', dir: 1, frame: (S.t * 2) % 1 }, COL.gruen, COL.gelb);
    }

    function drawDefenders() {
      const sorted = defs.slice().sort((a, b) => a.prox - b.prox);
      for (const d of sorted) {
        const goalPt = project(d.u, 0);
        const x = lerp(goalPt.x, BALL_HOME.x, d.prox * 0.55);
        const y = lerp(goalPt.y + 26, BALL_HOME.y - 20, d.prox);
        const scale = 0.80 + d.prox * 0.62;
        ctx.save();
        ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(x, y + 4, 24 * scale, 7 * scale, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        drawFigure(d.player, x, y, scale, { pose: 'lauf', dir: -1, frame: (S.t * 3.2) % 1 }, COL.rot, COL.papier);
      }
    }

    function drawShooter() {
      const pose = S.phase === 'flug' || S.phase === 'ergebnis' ? 'schuss' : 'lauf';
      ctx.save();
      ctx.globalAlpha = 0.34; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(BALL_HOME.x - 6, BALL_HOME.y + 6, 30, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      drawFigure(actor, BALL_HOME.x - 22, BALL_HOME.y + 6, 1.32,
        { pose, dir: 1, frame: (S.t * 3) % 1 }, COL.blau, COL.papier);
    }

    function drawBall(x, y, r = 9, groundY = BALL_HOME.y + 8) {
      ctx.save();
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(x, groundY, r * 1.1, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = COL.papier; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = COL.outline; ctx.stroke();
      ctx.fillStyle = COL.outline;
      ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.2, r * 0.28, 0, Math.PI * 2); ctx.fill();
    }

    function drawCrosshair() {
      const p = project(S.aimU, S.aimV);
      const t = S.t * 6;
      const r = 16 + Math.sin(t) * 2.5;
      ctx.save();
      ctx.lineWidth = 5; ctx.strokeStyle = COL.outline;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = COL.gelb;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - r - 8, p.y); ctx.lineTo(p.x - 5, p.y);
      ctx.moveTo(p.x + 5, p.y); ctx.lineTo(p.x + r + 8, p.y);
      ctx.moveTo(p.x, p.y - r - 8); ctx.lineTo(p.x, p.y - 5);
      ctx.moveTo(p.x, p.y + 5); ctx.lineTo(p.x, p.y + r + 8);
      ctx.lineWidth = 5; ctx.strokeStyle = COL.outline; ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = COL.gelb; ctx.stroke();
      // Schussstrahl vom Ball zum Ziel
      ctx.setLineDash([9, 7]);
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(245,197,24,0.6)';
      ctx.beginPath(); ctx.moveTo(BALL_HOME.x, BALL_HOME.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    function drawHud() {
      // Kopfzeile
      panel(ctx, 0, 0, CANVAS_W, 40, '#1a1f28');
      const teamLabel = m.team === 'away' ? 'Auswärts' : 'Heim';
      text(ctx, nameOf(actor, 'Unbekannt').toUpperCase(), 14, 27, { size: 19, color: COL.gelb });
      text(ctx, `${minute}.` + ' MINUTE', CANVAS_W / 2 - 110, 27, { size: 17, color: COL.papier, align: 'center' });
      text(ctx, `STAND  ${score[0]} : ${score[1]}`, CANVAS_W / 2 + 60, 27, { size: 17, color: COL.papier, align: 'center' });
      text(ctx, (context.competition || teamLabel) + '', CANVAS_W - 14, 27,
        { size: 15, color: '#b9c4d2', align: 'right' });

      // Fußzeile mit Kurzanleitung
      panel(ctx, 0, CANVAS_H - 62, CANVAS_W, 62, '#1a1f28');
      if (isHeader) {
        text(ctx, '[LEERTASTE] / KLICK im grünen Bereich = Kopfball', 14, CANVAS_H - 36,
          { size: 16, color: COL.papier });
        text(ctx, 'Zu früh: drüber.  Zu spät: der Keeper pflückt ihn runter.  [ESC] = Simulation',
          14, CANVAS_H - 14, { size: 13, color: '#b9c4d2' });
      } else {
        const items = [
          ['1', 'Flach', COL.gelb], ['2', 'Heber', COL.gruen], ['3', 'Platziert', '#8fc4f0']
        ];
        let x = 14;
        for (const [key, label, col] of items) {
          panel(ctx, x, CANVAS_H - 52, 26, 24, COL.beige);
          text(ctx, key, x + 13, CANVAS_H - 34, { size: 15, color: COL.outline, align: 'center', outline: false });
          text(ctx, label, x + 33, CANVAS_H - 34, { size: 15, color: col });
          x += 34 + label.length * 11;
        }
        text(ctx, 'Maus zielen · Klick = Flachschuss · früh = ungenau, spät = Blockgefahr · [ESC] Simulation',
          14, CANVAS_H - 12, { size: 13, color: '#b9c4d2' });
      }
    }

    function drawWindowBar() {
      if (S.phase !== 'fenster') return;
      const frac = clamp(1 - S.phaseT / windowS, 0, 1);
      const w = 320, x = (CANVAS_W - w) / 2, y = 48;
      panel(ctx, x - 4, y - 4, w + 8, 26, '#1a1f28');
      const col = frac > 0.55 ? COL.gruen : frac > 0.25 ? COL.gelb : COL.rot;
      fillRect(ctx, x, y, w * frac, 18, col);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, 18);
      text(ctx, 'SCHIESSEN!', CANVAS_W / 2, y + 15,
        { size: 14, color: COL.outline, align: 'center', outline: false });
    }

    function drawApproachHint() {
      if (S.phase !== 'anlauf') return;
      const pulse = 0.55 + 0.45 * Math.sin(S.t * 9);
      ctx.save();
      ctx.globalAlpha = pulse;
      text(ctx, 'BALL KOMMT …', CANVAS_W / 2, 78, { size: 24, color: COL.gelb, align: 'center' });
      ctx.restore();
    }

    function drawHeaderBar() {
      if (S.phase !== 'flanke') return;
      const w = 560, h = 34, x = (CANVAS_W - w) / 2, y = CANVAS_H - 122;
      panel(ctx, x - 6, y - 6, w + 12, h + 12, '#1a1f28');
      fillRect(ctx, x, y, w, h, '#2b3543');
      // Grüner Bereich
      const g0 = clamp(greenCenter - greenHalf, 0, 1), g1 = clamp(greenCenter + greenHalf, 0, 1);
      fillRect(ctx, x + g0 * w, y, (g1 - g0) * w, h, COL.gruen);
      // Gelbe Randzone (schwacher Kopfball)
      ctx.globalAlpha = 0.4;
      fillRect(ctx, x + clamp(g0 - greenHalf * 0.8, 0, 1) * w, y, greenHalf * 0.8 * w, h, COL.gelb);
      fillRect(ctx, x + g1 * w, y, greenHalf * 0.8 * w, h, COL.gelb);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
      // Marker
      const mx = x + clamp(S.barPos, 0, 1) * w;
      fillRect(ctx, mx - 4, y - 8, 8, h + 16, COL.papier);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(mx - 4, y - 8, 8, h + 16);
      text(ctx, 'ABSPRUNG', CANVAS_W / 2, y - 14, { size: 15, color: COL.papier, align: 'center' });
    }

    function drawBanner() {
      if (!S.banner) return;
      const w = 520, h = 74, x = (CANVAS_W - w) / 2, y = 200;
      panel(ctx, x, y, w, h, COL.beige);
      text(ctx, S.banner, CANVAS_W / 2, y + 50,
        { size: 38, color: COL.rot, align: 'center', outlineColor: COL.outline });
    }

    function render() {
      ctx.save();
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawBackground();
      const typeKey = S.shot ? S.shot.type : (isHeader ? 'kopfball' : 'flach');
      drawGoalAndCoverage(typeKey);
      drawKeeper();
      drawDefenders();
      drawShooter();

      if (S.phase === 'fenster') { drawCrosshair(); drawBall(BALL_HOME.x, BALL_HOME.y); }
      else if (S.phase === 'anlauf') {
        // Ball rollt dem Schützen entgegen
        const k = clamp(S.phaseT / APPROACH_S, 0, 1);
        drawBall(lerp(760, BALL_HOME.x, k), lerp(430, BALL_HOME.y, k));
      } else if (S.phase === 'flanke') {
        // Flanke segelt heran
        const k = clamp(S.phaseT / HEAD_WINDOW_S, 0, 1);
        const bx = lerp(860, BALL_HOME.x + 10, k);
        const by = lerp(300, BALL_HOME.y - 96, k) - Math.sin(Math.PI * k) * 90;
        drawBall(bx, by, 10, lerp(430, BALL_HOME.y, k) + 8);
      } else if (S.flight) {
        const k = clamp(S.phaseT / S.flight.dur, 0, 1);
        const bx = lerp(S.flight.from.x, S.flight.to.x, k);
        const by = lerp(S.flight.from.y, S.flight.to.y, k) - Math.sin(Math.PI * k) * S.flight.arc;
        drawBall(bx, by, 9 - k * 2, lerp(S.flight.from.y, S.flight.to.y, k) + 8);
      }

      drawApproachHint();
      drawWindowBar();
      drawHeaderBar();
      drawHud();
      drawBanner();
      ctx.restore();
    }

    /* ====================================================================== *
     *  SIMULATIONS-SCHRITT
     * ====================================================================== */

    function step(dt) {
      S.t += dt;
      S.phaseT += dt;

      if (S.phase === 'anlauf' || S.phase === 'fenster' || S.phase === 'flanke') {
        // Der Torwart stellt den Winkel: er zieht in Richtung Zielkreuz, bleibt
        // aber in einem Korridor um die Tormitte und rückt nie ganz heran –
        // die Ecken bleiben offen, wer spät umzielt, hat ihn auf dem falschen Fuß.
        const wish = clamp(S.aimU, 0.5 - KEEPER_MAX_OFFSET, 0.5 + KEEPER_MAX_OFFSET);
        const gap = wish - S.keeperU;
        if (Math.abs(gap) > KEEPER_TRACK_DEADZONE) {
          const maxStep = KEEPER_TRACK_SPEED * (0.65 + 0.6 * keeperSkill01) * dt;
          S.keeperU += clamp(gap - Math.sign(gap) * KEEPER_TRACK_DEADZONE, -maxStep, maxStep);
        }
        S.keeperU = clamp(S.keeperU, 0.5 - KEEPER_MAX_OFFSET, 0.5 + KEEPER_MAX_OFFSET);
        // … und läuft heraus, sobald der Ball beim Schützen ist.
        if (S.phase !== 'anlauf') {
          S.keeperAdvance = clamp(S.keeperAdvance + KEEPER_ADVANCE_PER_S * dt * (0.7 + 0.5 * diff), 0, 1);
        }
        // Verteidiger rücken heran und schieben leicht in die Schussrichtung nach.
        for (const d of defs) {
          d.prox = clamp(d.prox + d.speed * dt * (0.65 + 0.45 * diff), 0, 1);
          d.u += (S.aimU - d.u) * BLOCK_TRACK * dt;
        }
      }

      if (S.phase === 'anlauf' && S.phaseT >= APPROACH_S) {
        // Das Schussfenster geht auf. Ein Pfiff wäre hier falsch – niemand
        // unterbricht diese Szene, sie ist nur plötzlich Ihre.
        S.phase = 'fenster'; S.phaseT = 0; sfx('klick', { hoehe: 0.8, lautstaerke: 1.2 });
      } else if (S.phase === 'fenster' && S.phaseT >= windowS) {
        // Zu lange gezögert – der Verteidiger ist da.
        fireLate();
      } else if (S.phase === 'flanke') {
        // Timing-Marker läuft einmal quer und wieder zurück
        S.barPos += S.barDir * barSpeed * dt;
        if (S.barPos > 1) { S.barPos = 1; S.barDir = -1; }
        if (S.barPos < 0) { S.barPos = 0; S.barDir = 1; }
        if (S.phaseT >= HEAD_WINDOW_S) headerShot(null);
      } else if (S.phase === 'flug' && S.flight && S.phaseT >= S.flight.dur) {
        S.phase = 'ergebnis'; S.phaseT = 0;
        S.banner = BANNER[S.resolution.outcome] || '';
        // Aluminium, Handschuh, Bein oder Netz – jeder Ausgang klingt anders.
        const klang = AUSGANG_KLANG[S.resolution.outcome];
        if (klang) sfx(klang[0], klang[1]);
        if (S.resolution.outcome === 'latte' || S.resolution.outcome === 'pfosten') {
          sfx('raunen', { lautstaerke: 0.8, verzoegerung: 0.3 });
        }
      } else if (S.phase === 'ergebnis' && S.phaseT >= 1.1) {
        settle(S.resolution);
      }
    }

    const BANNER = {
      tor: 'TOR!!!', parade: 'GEHALTEN!', daneben: 'VORBEI!',
      geblockt: 'GEBLOCKT!', latte: 'LATTE!', pfosten: 'PFOSTEN!'
    };

    /* ====================================================================== *
     *  AKTIONEN
     * ====================================================================== */

    function launch(res, typeKey) {
      const spec = SHOT_TYPES[typeKey] || SHOT_TYPES.flach;
      S.resolution = {
        outcome: res.outcome, quality: res.quality,
        targetPlayerId: res.targetPlayerId, xgDelta: res.xgDelta
      };
      S.shot = { type: typeKey };
      S.flight = {
        from: { x: BALL_HOME.x, y: BALL_HOME.y },
        to: res._hit,
        dur: spec.flight,
        arc: typeKey === 'heber' ? 120 : typeKey === 'kopfball' ? 40 : 16
      };
      S.phase = 'flug'; S.phaseT = 0;
      // Der Kopfball hat keinen Spann: heller, kürzer, weniger Wucht.
      sfx('schuss', typeKey === 'kopfball' ? { hoehe: 1.3, lautstaerke: 0.8 } : null);
    }

    function shoot(typeKey) {
      if (S.phase !== 'fenster') return;
      const tFrac = clamp(S.phaseT / windowS, 0, 1);
      launch(resolveShot(typeKey, S.aimU, S.aimV, tFrac), typeKey);
    }

    /** Kein Schuss im Fenster: der herangerückte Verteidiger macht ihn zu. */
    function fireLate() {
      if (S.phase !== 'fenster') return;
      const res = resolveShot('flach', S.aimU, S.aimV, 1);
      // Erzwungen: viel zu spät, das wird bestenfalls noch abgefälscht.
      const forced = rChance(rng, 0.72) ? 'geblockt' : 'daneben';
      res.outcome = forced;
      res.quality = clamp(res.quality * 0.35, 0, 0.3);
      res.xgDelta = clamp(XG_MIN + res.quality * 0.2, XG_MIN, 0.05);
      launch(res, 'flach');
    }

    /** Kopfball nach Flanke: Timing statt Zielen. */
    function headerShot(clicked) {
      if (S.phase !== 'flanke') return;
      const pos = clicked === null ? -1 : clamp(S.barPos, 0, 1);
      const offset = pos < 0 ? 99 : Math.abs(pos - greenCenter) / greenHalf;
      // 0 = perfekt getimt, 1 = Rand des grünen Bereichs, >2 = Luftloch
      const timing = clamp(1 - offset * 0.62, 0, 1);

      if (offset > 2.1) {
        // Übersprungen / zu spät angesetzt
        const res = {
          outcome: rChance(rng, 0.55) ? 'daneben' : 'parade',
          quality: 0.08,
          targetPlayerId: actor && actor.id ? actor.id : null,
          xgDelta: XG_MIN,
          _hit: project(rFloat(rng, -0.2, 1.2), rFloat(rng, 0.6, 1.3))
        };
        launch(res, 'kopfball');
        return;
      }

      // Gutes Timing => bewusst in die vom Torwart entfernte Ecke.
      const side = S.keeperU > 0.5 ? -1 : 1;
      const aimU = clamp(S.keeperU + side * (0.22 + 0.24 * timing), 0.02, 0.98);
      const aimV = clamp(0.44 - 0.26 * timing + (1 - timing) * 0.5, 0.05, 1.15);
      const res = resolveShot('kopfball', aimU, aimV, 0.5 + timing * 0.4);
      res.quality = clamp(res.quality * (0.45 + 0.65 * timing), 0, 1);
      res.xgDelta = clamp(XG_MIN + (XG_MAX - XG_MIN) * Math.pow(res.quality, 1.2), XG_MIN, XG_MAX);
      launch(res, 'kopfball');
    }

    /* ====================================================================== *
     *  EINGABE, SCHLEIFE, AUFRÄUMEN
     * ====================================================================== */

    return new Promise((resolve) => {
      let done = false;
      let rafId = 0;
      let watchdog = 0;
      let lastTs = 0;
      const bound = [];
      const prevCursor = canvas.style.cursor;

      function on(target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        bound.push([target, type, fn, opts]);
      }

      function cleanup() {
        if (rafId) cancelAnimationFrame(rafId);
        if (watchdog) clearTimeout(watchdog);
        for (const [t, ty, fn, o] of bound) t.removeEventListener(ty, fn, o);
        bound.length = 0;
        canvas.style.cursor = prevCursor;
      }

      function settleInner(res) {
        if (done) return;
        done = true;
        cleanup();
        resolve(res);
      }
      settle = settleInner;   // ab jetzt kann auch step() auflösen

      function pointerPos(ev) {
        const r = canvas.getBoundingClientRect();
        const sx = canvas.width / (r.width || canvas.width);
        const sy = canvas.height / (r.height || canvas.height);
        return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
      }

      on(canvas, 'mousemove', (ev) => {
        const p = pointerPos(ev);
        S.mouse = p;
        S.aimU = clamp((p.x - AIM_BOX.x0) / (AIM_BOX.x1 - AIM_BOX.x0), -0.12, 1.12);
        S.aimV = clamp((AIM_BOX.yBottom - p.y) / (AIM_BOX.yBottom - AIM_BOX.yTop), 0.02, 1.15);
      });

      on(canvas, 'mousedown', (ev) => {
        ev.preventDefault();
        if (S.phase === 'fenster') shoot('flach');
        else if (S.phase === 'flanke') headerShot(true);
      });

      on(window, 'keydown', (ev) => {
        if (ev.key === 'Escape') { settleInner(null); return; }
        if (S.phase === 'fenster') {
          if (ev.key === '1') { ev.preventDefault(); shoot('flach'); }
          else if (ev.key === '2') { ev.preventDefault(); shoot('heber'); }
          else if (ev.key === '3') { ev.preventDefault(); shoot('platziert'); }
          else if (ev.key === ' ') { ev.preventDefault(); shoot('flach'); }
        } else if (S.phase === 'flanke' && (ev.key === ' ' || ev.key === 'Enter')) {
          ev.preventDefault(); headerShot(true);
        }
      });

      canvas.style.cursor = 'crosshair';

      // Absicherung: rAF pausiert in Hintergrund-Tabs – deshalb zusätzlich ein Timer.
      watchdog = setTimeout(() => {
        settleInner(S.resolution || {
          outcome: 'daneben', quality: 0.2,
          targetPlayerId: actor && actor.id ? actor.id : null, xgDelta: -0.02
        });
      }, HARD_TIMEOUT_S * 1000);

      function frame(ts) {
        if (done) return;
        if (!lastTs) lastTs = ts;
        const dt = clamp((ts - lastTs) / 1000, 0, 0.05);
        lastTs = ts;
        step(dt);
        if (done) return;
        render();
        rafId = requestAnimationFrame(frame);
      }
      rafId = requestAnimationFrame(frame);
    });
  }
};

export default minigame;
