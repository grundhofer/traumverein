/**
 * Minispiel „Kombination im letzten Drittel"  —  KeyMoment.kind === 'kombination'
 * ---------------------------------------------------------------------------
 * Draufsicht auf das letzte Drittel. Die eigenen Spieler laufen sich frei, die
 * Gegner verschieben in Echtzeit und rücken auf den Ballführenden. Der Manager
 * entscheidet, WEN er anspielt und WIE:
 *
 *   [F] Flachpass    schnell und sicher, aber abfangbar
 *   [S] Steilpass    riskant – der Empfänger startet in die Tiefe (hoher Ertrag)
 *   [C] Chip         über die Abwehrkette hinweg, dafür langsam
 *   [D] Doppelpass   Wandspieler legt zurück, der Passgeber zieht selbst durch
 *
 * Die Passlinie färbt sich live grün/gelb/rot: sie zeigt die tatsächliche
 * Erfolgswahrscheinlichkeit aus Passspiel/Übersicht des Passgebers, Distanz,
 * Gegnern in der Linie und der Deckung des Empfängers.
 *
 * Bis zu 3 Stationen. Jede gelungene Station erhöht Qualität und xgDelta,
 * ein Fehlpass beendet die Szene sofort mit outcome 'abgefangen'.
 *
 * Steuerung:
 *   Maus / [1]-[5]   Mitspieler anwählen
 *   Klick            Pass spielen
 *   [Leertaste]      selbst abschließen  (outcome 'abgeschlossen')
 *   [ESC]            abbrechen -> null (Simulation übernimmt)
 *
 * Rückgabe: { outcome, quality, targetPlayerId, xgDelta } – siehe CONTRACTS 6.1.
 */

import { clamp, lerp } from '../core/util.js';

/* ========================================================================== *
 *  BALANCING-KONSTANTEN
 * ========================================================================== */

const CANVAS_W = 960;
const CANVAS_H = 600;
const HARD_TIMEOUT_S = 20;

/** Zeitbudget: Grundzeit + Bonus je gelungener Station (in Sekunden). */
const SCENE_BASE_S = 9.0;
const SCENE_STATION_BONUS_S = 2.6;
const SCENE_MAX_S = 17.0;

/** Maximale Anzahl Stationen laut Aufgabenstellung. */
const MAX_STATIONS = 3;

/* --- Weltkoordinaten: fx 0..68 (quer), fy 0..35 (Meter vor dem Tor) ------- */
const FIELD_W = 68;
const FIELD_D = 35;
const PPM = 12.9;                       // Pixel pro Meter
const ORIGIN = { x: 41, y: 86 };
const GOAL_CENTER = { fx: 34, fy: 0 };

/* --- Passmodell ----------------------------------------------------------- */
const PASS_BASE = 0.58;                 // Grundgenauigkeit (Passgeber ohne Können)
const PASS_SKILL_W = 0.40;              // Anteil aus den Attributen des Passgebers
const PASS_FREE_DIST = 10;              // m, die ohne Distanzabzug gehen
const PASS_MAX_DIST = 42;               // m – ab hier voller Distanzabzug
const PASS_DIST_PEN = 0.30;
const INTERCEPT_RADIUS = 3.8;           // m Abstand zur Passlinie
const INTERCEPT_W = 0.50;               // maximaler Abzug durch den nächsten Gegner
const INTERCEPT_EXP = 1.5;              // Kurvenform: nur wirklich nahe Gegner stören
const INTERCEPT_OTHERS = 0.35;          // weitere Gegner in der Linie zählen anteilig
const RECEIVER_COVER_R = 5.0;           // m – so dicht ist der Empfänger zugestellt
const RECEIVER_W = 0.24;
const PRESSURE_PEN = 0.06;              // Abzug bei maximalem Gegnerdruck
const DOPPEL_RANGE = 14;                // m, ab denen ein Doppelpass unsinnig wird
const DOPPEL_LONG_PEN = 0.022;          // Abzug je Meter darüber
const CHIP_OVER_FRAC = 0.68;            // Anteil der Passlinie, den ein Chip überfliegt
const PASS_MIN_P = 0.05;
const PASS_MAX_P = 0.96;

/** Farbschwellen für die Passlinie. */
const P_GOOD = 0.72;
const P_OK = 0.48;

/* --- Laufverhalten -------------------------------------------------------- */
const TEAM_SPEED_MIN = 3.0;             // m/s
const TEAM_SPEED_MAX = 6.2;
const DEF_SPEED_FACTOR = 0.88;          // Gegner sind einen Tick langsamer …
const DEF_GOALSIDE = 0.40;              // … stellen sich dafür immer torseitig
const DEF_BALL_BIAS = 0.18;             // Anteil, um den sie zum Ball einrücken
const DEF_REACT_S = 0.55;               // Reaktionszeit nach jedem Pass
const DEF_PRESS_BONUS = 1.15;           // der nächste Gegner attackiert den Ballführenden
const RUN_REPICK_S = 2.2;               // Intervall für neue Freilaufwege
const SUPPORT_DIST = 14;                // m: Wunschabstand zum Ballführenden
const CARRY_SPEED = 1.1;                // m/s, mit denen der Ballführende andribbelt
const CARRY_MIN_FY = 16;                // so weit kommt er allein – danach ist zu
const STEIL_LEAD = 7.5;                 // m Vorlage in den Lauf
const DOPPEL_RUN = 8.5;                 // m, die der Passgeber beim Doppelpass zieht

/* --- Bewertung ------------------------------------------------------------ */
const XG_MIN = -0.10;
const XG_MAX = 0.40;
const DANGER_XG_W = 0.46;
const STATION_XG_BONUS = 0.04;

/** Passarten. */
const PASS_TYPES = {
  flach: {
    key: 'F', name: 'Flachpass', desc: 'schnell, abfangbar',
    base: 1.00, distPen: 1.00, intercept: 1.00, cover: 1.00,
    speed: 24, lead: 0, reward: 1.00, chip: false
  },
  steil: {
    key: 'S', name: 'Steilpass', desc: 'in die Tiefe – riskant',
    base: 0.92, distPen: 1.25, intercept: 1.15, cover: 0.80,
    speed: 27, lead: STEIL_LEAD, reward: 1.45, chip: false
  },
  chip: {
    key: 'C', name: 'Chip', desc: 'über die Kette',
    base: 0.95, distPen: 0.85, intercept: 0.28, cover: 1.60,
    speed: 15, lead: 2.0, reward: 1.20, chip: true
  },
  doppelpass: {
    key: 'D', name: 'Doppelpass', desc: 'Wand + Rückpass, nur kurz',
    base: 1.00, distPen: 1.40, intercept: 0.90, cover: 0.70,
    speed: 26, lead: 0, reward: 1.35, chip: false
  }
};
const TYPE_ORDER = ['flach', 'steil', 'chip', 'doppelpass'];

const COL = {
  rasen: '#2f7d32', rasenDunkel: '#276b2a', linie: '#f4f4ec', outline: '#0d1116',
  beige: '#e8d9b0', papier: '#f2e8cf', holz: '#8b5a2b',
  rot: '#c1272d', blau: '#1c4f8f', gelb: '#f5c518', gruen: '#3fae4a',
  dunkel: '#1a1f28', hellblau: '#8fc4f0'
};

/* ========================================================================== *
 *  HELFER
 * ========================================================================== */

const att = (p, key, fallback = 50) => {
  const v = p && p.attributes ? p.attributes[key] : undefined;
  return typeof v === 'number' ? v : fallback;
};
const hasTrait = (p, key) => !!(p && Array.isArray(p.traits) && p.traits.indexOf(key) >= 0);
const nameOf = (p, fallback = 'Mitspieler') => (p && (p.shortName || p.lastName)) || fallback;

function rFloat(rng, a, b) { return a + rng.next() * (b - a); }
function rChance(rng, p) { return rng.next() < p; }

const toX = (fx) => ORIGIN.x + fx * PPM;
const toY = (fy) => ORIGIN.y + fy * PPM;

function dist(a, b) { return Math.hypot(a.fx - b.fx, a.fy - b.fy); }

/** Abstand eines Punktes zur Strecke a→b plus Lage auf der Strecke (0..1). */
function segmentInfo(p, a, b) {
  const vx = b.fx - a.fx, vy = b.fy - a.fy;
  const len2 = vx * vx + vy * vy;
  if (len2 < 0.0001) return { d: dist(p, a), t: 0 };
  let t = ((p.fx - a.fx) * vx + (p.fy - a.fy) * vy) / len2;
  t = clamp(t, 0, 1);
  return { d: Math.hypot(a.fx + vx * t - p.fx, a.fy + vy * t - p.fy), t };
}

/* ========================================================================== *
 *  MINISPIEL
 * ========================================================================== */

export const minigame = {
  id: 'kombination',
  kind: 'kombination',
  title: 'Kombination',
  instructions:
    'Maus oder [1]-[5] wählt den Mitspieler · [F] flach · [S] steil · [C] Chip · [D] Doppelpass · ' +
    'Klick = Pass · [Leertaste] = selbst abschließen · [ESC] Simulation entscheiden lassen',

  async play(host, moment) {
    const canvas = host && host.canvas;
    const ctx = (host && host.ctx) || (canvas && canvas.getContext && canvas.getContext('2d'));
    if (!canvas || !ctx) {
      console.warn('[kombination] Kein Canvas/Kontext übergeben – Minispiel wird übersprungen.');
      return null;
    }

    const m = moment || {};
    const actor = m.actor || null;
    const context = m.context || {};
    const score = Array.isArray(context.score) ? context.score : [0, 0];
    const minute = typeof m.minute === 'number' ? m.minute : (context.minute || 0);
    const pressure = clamp(typeof m.pressure === 'number' ? m.pressure : 45, 0, 100);

    // Eigene RNG – fork() lässt den Zustand der Eltern-RNG unangetastet, damit
    // die Simulation trotz variabler Frame-Zahl deterministisch bleibt.
    const rng = (host.rng && typeof host.rng.fork === 'function')
      ? host.rng.fork('minigame:kombination:' + (actor && actor.id ? actor.id : '?'))
      : (host.rng || { next: () => 0.5 });

    const diff = clamp((host.difficulty && host.difficulty.minigame) || 1, 0.4, 2);
    // Klangnamen aus dem Vertrag von render/sound.js. Der zweite Parameter geht
    // unverändert an die Klangbank durch ({ lautstaerke, hoehe, panorama }).
    const sfx = (n, o) => { try { if (typeof host.sound === 'function') host.sound(n, o); } catch (e) { /* egal */ } };

    /* ---- Akteure aufbauen -------------------------------------------------- */
    let idSeq = 0;
    function makeMate(player, fx, fy) {
      return {
        player, fx, fy, vx: 0, vy: 0,
        speed: lerp(TEAM_SPEED_MIN, TEAM_SPEED_MAX, clamp(att(player, 'tempo') / 99, 0, 1)),
        wp: { fx, fy }, wpT: rFloat(rng, 0, RUN_REPICK_S),
        idx: ++idSeq, boost: 0
      };
    }
    function makeOpp(player, fx, fy) {
      return {
        player, fx, fy,
        speed: lerp(TEAM_SPEED_MIN, TEAM_SPEED_MAX, clamp(att(player, 'tempo') / 99, 0, 1))
          * DEF_SPEED_FACTOR * (0.86 + 0.22 * diff),
        mark: null, react: 0,
        skill: clamp((att(player, 'positionsspiel') * 0.5 + att(player, 'zweikampf') * 0.5) / 99, 0, 1)
      };
    }

    // Ballführender startet zentral am Rand des letzten Drittels.
    const carrierStart = { fx: clamp(34 + rFloat(rng, -9, 9), 8, 60), fy: rFloat(rng, 25, 30) };
    let carrier = makeMate(actor, carrierStart.fx, carrierStart.fy);

    const rawTargets = (Array.isArray(m.targets) ? m.targets : []).filter(Boolean).slice(0, 5);
    const mates = [];
    const STARTS = [
      { fx: 15, fy: 19 }, { fx: 53, fy: 18 }, { fx: 34, fy: 13 },
      { fx: 24, fy: 25 }, { fx: 46, fy: 26 }
    ];
    const mateCount = Math.max(3, Math.min(5, rawTargets.length || 3));
    for (let i = 0; i < mateCount; i++) {
      const s = STARTS[i % STARTS.length];
      mates.push(makeMate(rawTargets[i] || null,
        clamp(s.fx + rFloat(rng, -3, 3), 4, 64), clamp(s.fy + rFloat(rng, -2.5, 2.5), 5, 33)));
    }

    const rawDefs = (Array.isArray(m.defenders) ? m.defenders : []).filter(Boolean).slice(0, 5);
    const opps = [];
    const oppCount = Math.max(3, Math.min(5, rawDefs.length || 4));
    for (let i = 0; i < oppCount; i++) {
      const target = mates[i % mates.length];
      opps.push(makeOpp(rawDefs[i] || null,
        clamp(target.fx + rFloat(rng, -4, 4), 3, 65),
        clamp(target.fy - rFloat(rng, 3, 7), 3, 32)));
      opps[i].mark = target;
    }
    const keeperPos = { fx: 34, fy: 2.6 };

    /* ---- Zustand ----------------------------------------------------------- */
    const S = {
      phase: 'spiel',              // spiel | pass | ergebnis
      t: 0, phaseT: 0,
      budget: SCENE_BASE_S,
      stations: 0,
      qualities: [],
      dangerBefore: 0,
      type: 'flach',
      selected: mates[0],
      mouse: { x: CANVAS_W / 2, y: CANVAS_H / 2 },
      pass: null,                  // { from, to, mid, dur, ok, type, receiver, interceptor }
      resolution: null,
      banner: '',
      bannerColor: COL.gelb
    };

    let settle = () => { };

    /* ====================================================================== *
     *  BEWERTUNG
     * ====================================================================== */

    function nearestOppDist(pt, ignore) {
      let best = 99;
      for (const o of opps) {
        if (o === ignore) continue;
        const d = dist(o, pt);
        if (d < best) best = d;
      }
      return best;
    }

    /** Gefahrengrad der aktuellen Position: 0 = harmlos, 1 = Riesenchance. */
    function chanceValue(pt) {
      const d = Math.hypot(pt.fx - GOAL_CENTER.fx, pt.fy - GOAL_CENTER.fy);
      const distF = clamp(1 - (d - 6) / 24, 0, 1);
      const angleF = clamp(1 - Math.abs(pt.fx - 34) / 26, 0.22, 1);
      const freeF = clamp(nearestOppDist(pt) / 7, 0, 1);
      return clamp(distF * angleF * (0.35 + 0.65 * freeF), 0, 1);
    }

    /** Erfolgswahrscheinlichkeit eines Passes inkl. Detailgründen (für die Anzeige). */
    function passChance(from, to, typeKey) {
      const spec = PASS_TYPES[typeKey] || PASS_TYPES.flach;
      const passer = from.player;
      const skill = clamp(
        (att(passer, 'passspiel') * 0.58 + att(passer, 'uebersicht') * 0.27 + att(passer, 'technik') * 0.15) / 99,
        0, 1);

      const aim = { fx: to.fx, fy: Math.max(1.5, to.fy - spec.lead) };
      const d = dist(from, aim);

      let p = (PASS_BASE + PASS_SKILL_W * skill) * spec.base;
      p -= clamp((d - PASS_FREE_DIST) / (PASS_MAX_DIST - PASS_FREE_DIST), 0, 1)
        * PASS_DIST_PEN * spec.distPen;

      // Gegner in der Passlinie: der nächste zählt voll, alle weiteren anteilig.
      let worst = null, worstPen = 0, rest = 0;
      const radius = INTERCEPT_RADIUS * (0.85 + 0.3 * diff);
      for (const o of opps) {
        const info = segmentInfo(o, from, aim);
        if (spec.chip && info.t < CHIP_OVER_FRAC) continue;   // fliegt über ihn hinweg
        const pen = Math.pow(clamp(1 - info.d / radius, 0, 1), INTERCEPT_EXP)
          * INTERCEPT_W * spec.intercept * (0.7 + 0.6 * o.skill);
        if (pen > worstPen) { rest += worstPen; worstPen = pen; worst = o; }
        else rest += pen;
      }
      p -= worstPen + rest * INTERCEPT_OTHERS;

      // Deckung des Empfängers (ein hoher Ball ist unter Druck schwerer zu verarbeiten)
      const cover = clamp(1 - nearestOppDist(aim) / RECEIVER_COVER_R, 0, 1);
      p -= cover * RECEIVER_W * spec.cover;

      // Druck und Schwierigkeitsgrad
      p -= (pressure / 100) * PRESSURE_PEN;
      p *= (1.12 - 0.12 * diff);
      if (hasTrait(passer, 'spielmacher_trait')) p += 0.05;
      // Der Doppelpass lebt von der kurzen Distanz.
      if (typeKey === 'doppelpass' && d > DOPPEL_RANGE) p -= (d - DOPPEL_RANGE) * DOPPEL_LONG_PEN;

      return { p: clamp(p, PASS_MIN_P, PASS_MAX_P), aim, interceptor: worst, d };
    }

    /* ====================================================================== *
     *  BEWEGUNG
     * ====================================================================== */

    /**
     * Freilaufziel: frei stehen, anspielbar bleiben (Unterstützungsabstand),
     * Richtung Tor arbeiten und den Mitspielern nicht in die Füße laufen.
     */
    function pickWaypoint(mate) {
      let best = null, bestScore = -99;
      for (let i = 0; i < 7; i++) {
        const cand = {
          fx: clamp(mate.fx + rFloat(rng, -16, 16), 5, 63),
          fy: clamp(mate.fy + rFloat(rng, -12, 12), 4, 33)
        };
        const free = clamp(nearestOppDist(cand) / 8, 0, 1);
        const support = clamp(1 - Math.abs(dist(cand, carrier) - SUPPORT_DIST) / SUPPORT_DIST, 0, 1);
        const forward = clamp(1 - cand.fy / 32, 0, 1);
        const spread = clamp(Math.min(...mates.map(o =>
          o === mate ? 99 : dist(o, cand))) / 12, 0, 1);
        const sc = free * 1.55 + support * 1.05 + forward * 0.5 + spread * 0.40
          - Math.abs(cand.fx - 34) / 110;
        if (sc > bestScore) { bestScore = sc; best = cand; }
      }
      mate.wp = best;
      mate.wpT = RUN_REPICK_S * rFloat(rng, 0.7, 1.3);
    }

    function moveTowards(a, tx, ty, speed, dt) {
      const dx = tx - a.fx, dy = ty - a.fy;
      const d = Math.hypot(dx, dy);
      if (d < 0.05) return;
      const step = Math.min(d, speed * dt);
      a.fx = clamp(a.fx + dx / d * step, 2, FIELD_W - 2);
      a.fy = clamp(a.fy + dy / d * step, 1.5, FIELD_D - 1);
    }

    function stepActors(dt) {
      // Mitspieler laufen sich frei – der angespielte Mann startet dem Ball entgegen.
      const running = (S.phase === 'pass' && S.pass && S.pass.ok) ? S.pass.receiver : null;
      for (const mate of mates) {
        const boost = mate.boost > 0 ? 1.55 : 1;
        if (mate.boost > 0) mate.boost -= dt;
        if (mate === running) {
          moveTowards(mate, S.pass.aim.fx, S.pass.aim.fy, mate.speed * 1.4, dt);
          continue;
        }
        mate.wpT -= dt;
        if (mate.wpT <= 0 || dist(mate, mate.wp) < 1.2) pickWaypoint(mate);
        moveTowards(mate, mate.wp.fx, mate.wp.fy, mate.speed * boost, dt);
      }
      // Ballführender dribbelt nur zaghaft an – allein kommt hier keiner durch.
      if (S.phase === 'spiel') {
        const boost = carrier.boost > 0 ? 1.5 : 1;
        if (carrier.boost > 0) carrier.boost -= dt;
        moveTowards(carrier, carrier.fx, Math.max(CARRY_MIN_FY, carrier.fy - 3),
          CARRY_SPEED * boost, dt);
      }

      // Gegner: der nächste attackiert den Ball, die übrigen decken torseitig.
      let presser = null, pressD = 1e9;
      for (const o of opps) {
        const d = dist(o, carrier);
        if (d < pressD) { pressD = d; presser = o; }
      }
      for (const o of opps) {
        if (o.react > 0) { o.react -= dt; continue; }
        if (o === presser) {
          moveTowards(o, carrier.fx, carrier.fy, o.speed * DEF_PRESS_BONUS, dt);
          continue;
        }
        const mark = o.mark && mates.indexOf(o.mark) >= 0 ? o.mark : carrier;
        const tx = lerp(mark.fx, carrier.fx, DEF_BALL_BIAS);
        const ty = lerp(mark.fy, carrier.fy, DEF_BALL_BIAS) - DEF_GOALSIDE * 4;
        moveTowards(o, tx, clamp(ty, 2, FIELD_D - 2), o.speed, dt);
      }
    }

    /* ====================================================================== *
     *  AKTIONEN
     * ====================================================================== */

    function finishScene(outcome, quality, targetPlayerId, xgDelta, banner, color) {
      S.resolution = {
        outcome,
        quality: clamp(quality, 0, 1),
        targetPlayerId: targetPlayerId || null,
        xgDelta: clamp(xgDelta, XG_MIN, XG_MAX)
      };
      S.banner = banner;
      S.bannerColor = color || COL.gelb;
      S.phase = 'ergebnis';
      S.phaseT = 0;
    }

    /** Abschluss aus der aktuellen Situation heraus. */
    function shoot() {
      if (S.phase !== 'spiel') return;
      const danger = chanceValue(carrier);
      const avgQ = S.qualities.length
        ? S.qualities.reduce((a, b) => a + b, 0) / S.qualities.length : 0.35;
      const quality = clamp(0.22 + 0.45 * avgQ + 0.38 * danger, 0, 1);
      const xg = XG_MIN + danger * DANGER_XG_W + S.stations * STATION_XG_BONUS + quality * 0.14;
      sfx('schuss');
      finishScene('abgeschlossen', quality,
        carrier.player && carrier.player.id ? carrier.player.id : null, xg,
        danger > 0.6 ? 'HERAUSGESPIELT!' : danger > 0.3 ? 'ABSCHLUSS!' : 'AUS DER DISTANZ …',
        danger > 0.5 ? COL.gruen : COL.gelb);
    }

    /** Pass auf den angewählten Mitspieler. */
    function playPass() {
      if (S.phase !== 'spiel' || !S.selected) return;
      const target = S.selected;
      const spec = PASS_TYPES[S.type];
      const info = passChance(carrier, target, S.type);
      const ok = rChance(rng, info.p);

      S.dangerBefore = chanceValue(carrier);
      S.pass = {
        from: { fx: carrier.fx, fy: carrier.fy },
        aim: info.aim,
        receiver: target,
        type: S.type,
        p: info.p,
        ok,
        interceptor: info.interceptor,
        dur: clamp(info.d / spec.speed, 0.18, 1.1),
        back: S.type === 'doppelpass',
        leg: 0
      };
      S.phase = 'pass';
      S.phaseT = 0;
      // Ein Pass ist ein kurzer, hoher Schuss – dieselbe Kante, weniger Wucht.
      sfx('schuss', { lautstaerke: 0.45, hoehe: 1.45 });

      // Gegner brauchen einen Moment, um auf den neuen Ballbesitzer zu reagieren.
      const react = DEF_REACT_S * (spec.chip ? 0.55 : 1) * (S.type === 'steil' ? 1.35 : 1) / diff;
      for (const o of opps) o.react = react;
    }

    /** Ende der Ballflugphase auswerten. */
    function completePass() {
      const pass = S.pass;
      if (!pass) return;
      const spec = PASS_TYPES[pass.type];

      if (!pass.ok) {
        const q = clamp(0.10 + 0.22 * (S.qualities.length
          ? S.qualities.reduce((a, b) => a + b, 0) / S.qualities.length : 0.3), 0, 0.45);
        // Abgefangen ist kein Foul: Es wird nicht gepfiffen, es wird gestöhnt.
        sfx('raunen', { lautstaerke: 0.8 });
        finishScene('abgefangen', q,
          pass.receiver.player && pass.receiver.player.id ? pass.receiver.player.id : null,
          XG_MIN + q * 0.08, 'ABGEFANGEN!', COL.rot);
        return;
      }

      // Erfolg: der Empfänger übernimmt (beim Doppelpass bleibt der Passgeber am Ball).
      const oldCarrier = carrier;
      if (pass.back) {
        // Wand gespielt – der Passgeber zieht den Rest des Weges in den freien Raum
        // (die ersten 60 % hat er schon während des Hinspiels zurückgelegt).
        carrier.fy = clamp(carrier.fy - DOPPEL_RUN * 0.4, 3, FIELD_D - 2);
        carrier.boost = 0.9;
      } else {
        pass.receiver.fx = pass.aim.fx;
        pass.receiver.fy = pass.aim.fy;
        pass.receiver.boost = pass.type === 'steil' ? 1.1 : 0.5;
        const idxNew = mates.indexOf(pass.receiver);
        if (idxNew >= 0) mates.splice(idxNew, 1);
        mates.push(oldCarrier);
        oldCarrier.wpT = 0;
        carrier = pass.receiver;
        // Deckungszuordnung nachziehen
        for (const o of opps) if (o.mark === carrier) o.mark = oldCarrier;
      }

      const dangerAfter = chanceValue(carrier);
      const gain = clamp((dangerAfter - S.dangerBefore) * 2.5 + 0.30, 0, 1);
      const q = clamp(0.20 + 0.45 * pass.p + 0.35 * gain, 0, 1)
        * clamp(0.85 + 0.15 * spec.reward, 0, 1.2);
      S.qualities.push(clamp(q, 0, 1));
      S.stations++;
      S.budget = Math.min(SCENE_MAX_S, S.budget + SCENE_STATION_BONUS_S);
      // Station gewonnen: ein Trommelschlag aus der Kurve. Voller Jubel wäre
      // für einen gelungenen Pass eine Spur zu viel Oper.
      sfx('trommel', { lautstaerke: 0.6 });

      if (S.stations >= MAX_STATIONS) {
        // Nach der dritten Station wird abgeschlossen – die Szene ist auserzählt.
        S.phase = 'spiel';
        shoot();
        return;
      }
      // Alle Mitspieler orientieren sich sofort neu am neuen Ballbesitzer.
      for (const mate of mates) mate.wpT = 0;
      S.phase = 'spiel';
      S.phaseT = 0;
      S.selected = mates[0];
    }

    /** Zeit abgelaufen: freistehend wird noch abgeschlossen, sonst ist der Ball weg. */
    function timeUp() {
      const danger = chanceValue(carrier);
      const free = nearestOppDist(carrier);
      if (free > 5.5 && danger > 0.32) { shoot(); return; }
      const avgQ = S.qualities.length
        ? S.qualities.reduce((a, b) => a + b, 0) / S.qualities.length : 0.25;
      // Zu lange gezögert – die Kurve kommentiert das mit dem Ton, den sie
      // dafür seit hundert Jahren bereithält.
      sfx('raunen', { lautstaerke: 0.9 });
      finishScene('abgefangen', clamp(0.08 + 0.2 * avgQ, 0, 0.4),
        carrier.player && carrier.player.id ? carrier.player.id : null,
        XG_MIN, 'ZU LANGE GEZÖGERT!', COL.rot);
    }

    /* ====================================================================== *
     *  ZEICHNEN
     * ====================================================================== */

    function drawPitch() {
      const x0 = toX(0), y0 = toY(0), w = FIELD_W * PPM, h = FIELD_D * PPM;
      // Rasen mit Streifen
      ctx.fillStyle = COL.rasen;
      ctx.fillRect(0, 40, CANVAS_W, CANVAS_H - 40);
      for (let i = 0; i < 8; i++) {
        if (i % 2 === 0) continue;
        ctx.fillStyle = COL.rasenDunkel;
        ctx.fillRect(0, y0 + i * (h / 8), CANVAS_W, h / 8);
      }
      ctx.strokeStyle = COL.linie;
      ctx.lineWidth = 3;
      // Torlinie + Seitenlinien + Drittel-Grenze
      ctx.strokeRect(x0, y0, w, h);
      // Strafraum
      ctx.strokeRect(toX(13.84), y0, (54.16 - 13.84) * PPM, 16.5 * PPM);
      // Fünfmeterraum
      ctx.strokeRect(toX(24.84), y0, (43.16 - 24.84) * PPM, 5.5 * PPM);
      // Elfmeterpunkt
      ctx.fillStyle = COL.linie;
      ctx.beginPath(); ctx.arc(toX(34), toY(11), 4, 0, Math.PI * 2); ctx.fill();
      // Strafraumbogen
      ctx.beginPath();
      ctx.arc(toX(34), toY(11), 9.15 * PPM, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
      // Tor mit Netz
      const gx0 = toX(30.34), gx1 = toX(37.66), gy = y0, gd = 2.2 * PPM;
      ctx.fillStyle = 'rgba(12,20,26,0.5)';
      ctx.fillRect(gx0, gy - gd, gx1 - gx0, gd);
      ctx.strokeStyle = 'rgba(240,245,246,0.5)'; ctx.lineWidth = 1.4;
      for (let i = 0; i <= 8; i++) {
        const x = lerp(gx0, gx1, i / 8);
        ctx.beginPath(); ctx.moveTo(x, gy - gd); ctx.lineTo(x, gy); ctx.stroke();
      }
      for (let j = 0; j <= 3; j++) {
        const y = lerp(gy - gd, gy, j / 3);
        ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); ctx.stroke();
      }
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(gx0, gy); ctx.lineTo(gx0, gy - gd);
      ctx.moveTo(gx1, gy); ctx.lineTo(gx1, gy - gd);
      ctx.moveTo(gx0, gy - gd); ctx.lineTo(gx1, gy - gd); ctx.stroke();
      ctx.strokeStyle = COL.linie; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(gx0, gy); ctx.lineTo(gx0, gy - gd);
      ctx.moveTo(gx1, gy); ctx.lineTo(gx1, gy - gd);
      ctx.moveTo(gx0, gy - gd); ctx.lineTo(gx1, gy - gd); ctx.stroke();
    }

    function disc(x, y, r, fill, ring) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = COL.outline; ctx.stroke();
      if (ring) {
        ctx.lineWidth = 3.5; ctx.strokeStyle = ring;
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke();
      }
    }

    function label(str, x, y, color, size = 12) {
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
      ctx.strokeStyle = COL.outline; ctx.strokeText(str, x, y);
      ctx.fillStyle = color; ctx.fillText(str, x, y);
    }

    function drawOpponents() {
      for (const o of opps) {
        const x = toX(o.fx), y = toY(o.fy);
        // Deckungsschatten = Abfangradius
        ctx.beginPath();
        ctx.arc(x, y, INTERCEPT_RADIUS * (0.85 + 0.3 * diff) * PPM, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(193,39,45,0.10)'; ctx.fill();
        ctx.strokeStyle = 'rgba(193,39,45,0.30)'; ctx.lineWidth = 1.5; ctx.stroke();
        disc(x, y, 11, COL.rot, null);
        if (o.player && o.player.number) label(String(o.player.number), x, y + 4, COL.papier, 12);
      }
      // Torwart
      const kx = toX(keeperPos.fx), ky = toY(keeperPos.fy);
      disc(kx, ky, 11, '#f0a020', null);
      label('TW', kx, ky + 4, COL.outline, 11);
    }

    function drawMates() {
      for (let i = 0; i < mates.length; i++) {
        const mate = mates[i];
        const x = toX(mate.fx), y = toY(mate.fy);
        const sel = mate === S.selected;
        disc(x, y, 12, COL.blau, sel ? COL.gelb : null);
        label(String(i + 1), x, y + 4, COL.papier, 13);
        label(nameOf(mate.player, 'Mitspieler'), x, y + 27, sel ? COL.gelb : COL.papier, 11);
        // Laufrichtung
        const dx = mate.wp.fx - mate.fx, dy = mate.wp.fy - mate.fy;
        const d = Math.hypot(dx, dy);
        if (d > 1) {
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x, y);
          ctx.lineTo(x + dx / d * 22, y + dy / d * 22); ctx.stroke();
        }
      }
      // Ballführender
      const cx = toX(carrier.fx), cy = toY(carrier.fy);
      disc(cx, cy, 13, COL.blau, COL.papier);
      label(nameOf(carrier.player, 'Ballführend'), cx, cy + 29, COL.papier, 12);
      if (S.phase !== 'pass') {
        ctx.beginPath(); ctx.arc(cx + 12, cy + 10, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = COL.papier; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = COL.outline; ctx.stroke();
      }
    }

    function drawPassLine() {
      if (S.phase !== 'spiel' || !S.selected) return;
      const info = passChance(carrier, S.selected, S.type);
      const spec = PASS_TYPES[S.type];
      const a = { x: toX(carrier.fx), y: toY(carrier.fy) };
      const b = { x: toX(info.aim.fx), y: toY(info.aim.fy) };
      const col = info.p >= P_GOOD ? COL.gruen : info.p >= P_OK ? COL.gelb : COL.rot;

      ctx.save();
      ctx.lineCap = 'round';
      if (spec.chip) ctx.setLineDash([12, 8]);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);

      // Pfeilspitze
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - Math.cos(ang - 0.4) * 18, b.y - Math.sin(ang - 0.4) * 18);
      ctx.lineTo(b.x - Math.cos(ang + 0.4) * 18, b.y - Math.sin(ang + 0.4) * 18);
      ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = COL.outline; ctx.stroke();

      // Prozentanzeige
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const txt = Math.round(info.p * 100) + ' %';
      ctx.font = 'bold 15px system-ui, sans-serif';
      const w = ctx.measureText(txt).width + 14;
      ctx.fillStyle = COL.dunkel; ctx.fillRect(mx - w / 2, my - 12, w, 22);
      ctx.lineWidth = 2; ctx.strokeStyle = COL.outline;
      ctx.strokeRect(mx - w / 2, my - 12, w, 22);
      label(txt, mx, my + 4, col, 15);
      ctx.restore();
    }

    function drawBall() {
      if (S.phase !== 'pass' || !S.pass) return;
      const pass = S.pass;
      const k = clamp(S.phaseT / pass.dur, 0, 1);
      const spec = PASS_TYPES[pass.type];
      let from = pass.from, to = pass.aim;
      if (pass.back && pass.leg === 1) { from = pass.aim; to = { fx: carrier.fx, fy: carrier.fy }; }
      let fx = lerp(from.fx, to.fx, k), fy = lerp(from.fy, to.fy, k);
      if (!pass.ok && pass.interceptor && k > 0.55) {
        // Der Ball wird auf halber Strecke abgefangen
        fx = lerp(fx, pass.interceptor.fx, (k - 0.55) / 0.45);
        fy = lerp(fy, pass.interceptor.fy, (k - 0.55) / 0.45);
      }
      const x = toX(fx), y = toY(fy);
      const lift = spec.chip ? Math.sin(Math.PI * k) * 26 : 0;
      ctx.save();
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(x, y, 7, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(x, y - lift, 7, 0, Math.PI * 2);
      ctx.fillStyle = COL.papier; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = COL.outline; ctx.stroke();
    }

    function drawHud() {
      // Kopfzeile
      ctx.fillStyle = COL.dunkel; ctx.fillRect(0, 0, CANVAS_W, 40);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 38, CANVAS_W, 2);
      label(nameOf(carrier.player, 'Ballführend').toUpperCase(), 90, 27, COL.gelb, 18);
      label(`${minute}. MINUTE`, 400, 27, COL.papier, 16);
      label(`STAND  ${score[0]} : ${score[1]}`, 570, 27, COL.papier, 16);
      label(String(context.competition || ''), 830, 27, COL.hellblau, 14);

      // Stationen + Gefahr
      const danger = chanceValue(carrier);
      ctx.fillStyle = COL.dunkel; ctx.fillRect(CANVAS_W - 232, 46, 220, 46);
      ctx.lineWidth = 2; ctx.strokeStyle = COL.outline;
      ctx.strokeRect(CANVAS_W - 232, 46, 220, 46);
      label(`STATION ${S.stations} / ${MAX_STATIONS}`, CANVAS_W - 122, 64, COL.papier, 14);
      const bw = 190;
      ctx.fillStyle = '#2b3543'; ctx.fillRect(CANVAS_W - 217, 70, bw, 14);
      ctx.fillStyle = danger > 0.6 ? COL.gruen : danger > 0.32 ? COL.gelb : COL.rot;
      ctx.fillRect(CANVAS_W - 217, 70, bw * danger, 14);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 2;
      ctx.strokeRect(CANVAS_W - 217, 70, bw, 14);
      label('GEFAHR', CANVAS_W - 122, 82, COL.outline, 11);

      // Restzeit
      const rest = clamp(1 - S.t / S.budget, 0, 1);
      ctx.fillStyle = COL.dunkel; ctx.fillRect(12, 46, 220, 30);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 2; ctx.strokeRect(12, 46, 220, 30);
      ctx.fillStyle = '#2b3543'; ctx.fillRect(20, 54, 204, 14);
      ctx.fillStyle = rest > 0.4 ? COL.gruen : rest > 0.18 ? COL.gelb : COL.rot;
      ctx.fillRect(20, 54, 204 * rest, 14);
      ctx.strokeStyle = COL.outline; ctx.strokeRect(20, 54, 204, 14);
      label('ZEIT', 122, 66, COL.outline, 11);

      // Fußzeile: Passarten
      ctx.fillStyle = COL.dunkel; ctx.fillRect(0, CANVAS_H - 58, CANVAS_W, 58);
      let x = 14;
      for (const key of TYPE_ORDER) {
        const spec = PASS_TYPES[key];
        const active = S.type === key;
        const w = 210;
        ctx.fillStyle = active ? COL.beige : '#2b3543';
        ctx.fillRect(x, CANVAS_H - 50, w, 26);
        ctx.strokeStyle = active ? COL.gelb : COL.outline;
        ctx.lineWidth = active ? 3 : 2;
        ctx.strokeRect(x, CANVAS_H - 50, w, 26);
        label(`[${spec.key}] ${spec.name}`, x + 66, CANVAS_H - 32,
          active ? COL.outline : COL.papier, 14);
        label(spec.desc, x + 150, CANVAS_H - 32, active ? '#5a4a2a' : '#9fb0c2', 11);
        x += w + 12;
      }
      label('Maus/[1]-[5] wählen · Klick = Pass · [Leertaste] abschließen · [ESC] Simulation',
        CANVAS_W / 2, CANVAS_H - 8, '#b9c4d2', 12);
    }

    function drawBanner() {
      if (!S.banner) return;
      const w = 560, h = 76, x = (CANVAS_W - w) / 2, y = 210;
      ctx.fillStyle = COL.beige; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h);
      ctx.lineWidth = 3; ctx.strokeStyle = COL.outline;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.font = 'bold 34px "Arial Black", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.strokeStyle = COL.outline;
      ctx.strokeText(S.banner, CANVAS_W / 2, y + 50);
      ctx.fillStyle = S.bannerColor;
      ctx.fillText(S.banner, CANVAS_W / 2, y + 50);
    }

    function render() {
      ctx.save();
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawPitch();
      drawOpponents();
      drawPassLine();
      drawMates();
      drawBall();
      drawHud();
      drawBanner();
      ctx.restore();
    }

    /* ====================================================================== *
     *  SCHRITT
     * ====================================================================== */

    function step(dt) {
      S.t += dt;
      S.phaseT += dt;
      stepActors(dt);

      if (S.phase === 'spiel') {
        if (S.t >= S.budget) { timeUp(); return; }
      } else if (S.phase === 'pass' && S.pass) {
        if (S.phaseT >= S.pass.dur) {
          if (S.pass.back && S.pass.leg === 0 && S.pass.ok) {
            // Rückpass beim Doppelpass: zweite Etappe
            S.pass.leg = 1; S.phaseT = 0;
            carrier.fy = clamp(carrier.fy - DOPPEL_RUN * 0.6, 3, FIELD_D - 2);
          } else {
            completePass();
          }
        }
      } else if (S.phase === 'ergebnis' && S.phaseT >= 1.2) {
        settle(S.resolution);
      }
    }

    /* ====================================================================== *
     *  EINGABE / SCHLEIFE
     * ====================================================================== */

    return new Promise((resolve) => {
      let done = false, rafId = 0, watchdog = 0, lastTs = 0;
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
      settle = settleInner;

      function pointerPos(ev) {
        const r = canvas.getBoundingClientRect();
        const sx = canvas.width / (r.width || canvas.width);
        const sy = canvas.height / (r.height || canvas.height);
        return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
      }

      on(canvas, 'mousemove', (ev) => {
        const p = pointerPos(ev);
        S.mouse = p;
        // Nächstgelegenen Mitspieler anwählen
        let best = null, bestD = 1e9;
        for (const mate of mates) {
          const d = Math.hypot(toX(mate.fx) - p.x, toY(mate.fy) - p.y);
          if (d < bestD) { bestD = d; best = mate; }
        }
        if (best) S.selected = best;
      });

      on(canvas, 'mousedown', (ev) => { ev.preventDefault(); playPass(); });

      on(window, 'keydown', (ev) => {
        const k = ev.key;
        if (k === 'Escape') { settleInner(null); return; }
        if (S.phase !== 'spiel') return;
        const lower = typeof k === 'string' ? k.toLowerCase() : '';
        if (lower === 'f') { S.type = 'flach'; ev.preventDefault(); }
        else if (lower === 's') { S.type = 'steil'; ev.preventDefault(); }
        else if (lower === 'c') { S.type = 'chip'; ev.preventDefault(); }
        else if (lower === 'd') { S.type = 'doppelpass'; ev.preventDefault(); }
        else if (k === ' ' || k === 'Enter') { ev.preventDefault(); shoot(); }
        else if (k >= '1' && k <= '5') {
          const i = Number(k) - 1;
          if (mates[i]) { S.selected = mates[i]; ev.preventDefault(); }
        }
      });

      canvas.style.cursor = 'pointer';

      watchdog = setTimeout(() => {
        settleInner(S.resolution || {
          outcome: 'abgefangen', quality: 0.2,
          targetPlayerId: carrier.player && carrier.player.id ? carrier.player.id : null,
          xgDelta: -0.05
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
