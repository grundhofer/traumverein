/**
 * Minispiel „Eckball"  —  KeyMoment.kind === 'ecke'
 * ---------------------------------------------------------------------------
 * Blick von der Eckfahne schräg auf den Strafraum. Drei Phasen:
 *
 *   1. VARIANTE   Hoch an den langen Pfosten · kurz ausgeführt ·
 *                 scharf an den ersten Pfosten · zurück an die Strafraumkante.
 *   2. FLANKE     Zielpunkt mit der Maus, Flugkurve mit [A]/[D] (Innen-/Außenrist),
 *                 Kraft über den pendelnden Balken (Maus gedrückt halten, loslassen).
 *   3. KOPFBALL   Timing-Klick, wenn der Ball ankommt. Der grüne Bereich wächst mit
 *                 Kopfball/Sprungkraft des Abnehmers, „Kopfballungeheuer" hilft extra.
 *
 * Verteidiger und Torwart bewegen sich in Echtzeit. Läuft der Keeper heraus,
 * muss früher abgenommen werden – sonst faustet er.
 *
 * Rückgabe: { outcome, quality, targetPlayerId, xgDelta } – siehe CONTRACTS 6.1.
 * outcomes: 'kopfball_tor' | 'tor' | 'parade' | 'daneben' | 'geblockt' | 'abgefangen'
 */

import { clamp, lerp } from '../core/util.js';

/* ========================================================================== *
 *  BALANCING-KONSTANTEN
 * ========================================================================== */

const CANVAS_W = 960;
const CANVAS_H = 600;
const HARD_TIMEOUT_S = 20;

/** Zeitfenster der einzelnen Phasen (Sekunden). */
const PHASE_VARIANT_S = 5.0;
const PHASE_AIM_S = 7.0;
const FLIGHT_S = 1.55;
const RESULT_S = 1.4;

/** Kraftbalken: Durchläufe pro Sekunde und Breite des optimalen Bereichs. */
const POWER_SPEED = 1.15;
const POWER_SWEET = 0.13;

/** Kopfball-Timing (Anteile der Flugzeit). */
const BAR_START = 0.30;          // ab hier läuft der Marker
const HEAD_MOMENT = 0.84;        // hier ist der Ball am Kopf
const HEAD_GREEN_BASE = 0.16;    // halbe Breite des grünen Bereichs bei Skill 50
const HEAD_GREEN_SKILL = 0.13;   // Zuschlag bei Skill 99
const HEAD_TRAIT_BONUS = 1.35;   // Trait 'kopfballungeheuer'
const HEAD_MISS_OFFSET = 2.2;    // ab diesem Vielfachen ist es ein Luftloch

/** Ausführungsgüte der Flanke. */
const DELIVERY_FAIL = 0.20;      // darunter kommt die Ecke gar nicht erst an
const AIM_TOLERANCE = 9.0;       // m Abweichung von der Variante = voller Abzug
const CURVE_METERS = 6.5;        // maximale seitliche Auslenkung der Flugkurve

/** Abschlusswahrscheinlichkeiten (werden mit der Gesamtgüte skaliert). */
const BLOCK_BASE = 0.18;
const SAVE_BASE = 0.34;
const MISS_BASE = 0.30;
const MIN_GOAL_P = 0.03;

/** Torwart läuft heraus. */
const KEEPER_OUT_BASE = 0.18;
const KEEPER_OUT_SKILL = 0.42;
const KEEPER_OUT_RANGE = 12;     // m vom Tor, bis wohin er sich traut
const KEEPER_ARRIVAL_BASE = 0.88;// Flug-Anteil, bei dem er am Ball ist

const XG_MIN = -0.10;
const XG_MAX = 0.40;

/** Eckenvarianten. zone = angepeilter Zielpunkt in Weltkoordinaten. */
const VARIANTS = {
  lang: {
    key: '1', name: 'Hoch an den langen Pfosten', short: 'LANGER PFOSTEN',
    zone: { X: 39.5, Y: 6.0 }, hoehe: 1.00, idealCurve: 0.75, kopf: true,
    desc: 'Der Klassiker: hoch und weit – Zielwasser für die Kopfballstarken.'
  },
  kurz: {
    key: '2', name: 'Kurz ausgeführt', short: 'KURZ',
    zone: { X: 12.0, Y: 8.0 }, hoehe: 0.30, idealCurve: 0.0, kopf: false,
    desc: 'Kurz ablegen, flach zurück – zieht die Abwehr auseinander.'
  },
  erster: {
    key: '3', name: 'Scharf an den ersten Pfosten', short: 'ERSTER PFOSTEN',
    zone: { X: 29.5, Y: 3.5 }, hoehe: 0.55, idealCurve: 1.0, kopf: true,
    desc: 'Scharf und schnell – schwer zu verteidigen, schwer zu treffen.'
  },
  zurueck: {
    key: '4', name: 'Zurück an die Strafraumkante', short: 'STRAFRAUMKANTE',
    zone: { X: 34.0, Y: 17.5 }, hoehe: 0.70, idealCurve: -0.4, kopf: false,
    desc: 'Für den Schuss aus der zweiten Reihe – sicher, aber weit weg.'
  }
};
const VARIANT_ORDER = ['lang', 'kurz', 'erster', 'zurueck'];

/* --- Projektion: schräge Draufsicht von der Eckfahne ---------------------- *
 *  X = 0..68 quer (Tormitte 34), Y = Meter von der Torlinie weg, Z = Höhe.   */
const P = { ox: 470, oy: 300, ax: 12.6, ay: -2.4, bx: 5.0, by: 9.6, zs: 11.0 };

const COL = {
  rasen: '#2f7d32', rasenDunkel: '#276b2a', linie: '#f4f4ec', outline: '#0d1116',
  beige: '#e8d9b0', papier: '#f2e8cf', holz: '#8b5a2b', dunkel: '#1a1f28',
  rot: '#c1272d', blau: '#1c4f8f', gelb: '#f5c518', gruen: '#3fae4a', hellblau: '#8fc4f0'
};

/* ========================================================================== *
 *  HELFER
 * ========================================================================== */

let warnedDraw = false;

const att = (p, key, fallback = 50) => {
  const v = p && p.attributes ? p.attributes[key] : undefined;
  return typeof v === 'number' ? v : fallback;
};
const hasTrait = (p, key) => !!(p && Array.isArray(p.traits) && p.traits.indexOf(key) >= 0);
const nameOf = (p, fallback = 'Spieler') => (p && (p.shortName || p.lastName)) || fallback;

function rFloat(rng, a, b) { return a + rng.next() * (b - a); }
function rChance(rng, p) { return rng.next() < p; }

/** Weltkoordinaten -> Bildschirm. */
function toScreen(X, Y, Z = 0) {
  return {
    x: P.ox + (X - 34) * P.ax + Y * P.bx,
    y: P.oy + (X - 34) * P.ay + Y * P.by - Z * P.zs
  };
}

/** Bildschirm -> Weltkoordinaten auf dem Boden (Umkehrung der Affinabbildung). */
function toWorld(sx, sy) {
  const dx = sx - P.ox, dy = sy - P.oy;
  const det = P.ax * P.by - P.ay * P.bx;
  const X = (dx * P.by - dy * P.bx) / det + 34;
  const Y = (P.ax * dy - P.ay * dx) / det;
  return { X, Y };
}

/* ========================================================================== *
 *  MINISPIEL
 * ========================================================================== */

export const minigame = {
  id: 'ecke',
  kind: 'ecke',
  title: 'Eckball',
  instructions:
    '1) Variante mit [1]-[4] wählen · 2) Maus = Zielpunkt, [A]/[D] = Flugkurve, ' +
    'Maustaste halten = Kraft, loslassen = Flanke · 3) [Leertaste]/Klick zum Kopfball · [ESC] Simulation',

  async play(host, moment) {
    const canvas = host && host.canvas;
    const ctx = (host && host.ctx) || (canvas && canvas.getContext && canvas.getContext('2d'));
    if (!canvas || !ctx) {
      console.warn('[ecke] Kein Canvas/Kontext übergeben – Minispiel wird übersprungen.');
      return null;
    }

    const m = moment || {};
    const taker = m.actor || null;
    const keeper = m.keeper || null;
    const context = m.context || {};
    const score = Array.isArray(context.score) ? context.score : [0, 0];
    const minute = typeof m.minute === 'number' ? m.minute : (context.minute || 0);

    // Eigene RNG (fork lässt den Zustand der Eltern-RNG unberührt).
    const rng = (host.rng && typeof host.rng.fork === 'function')
      ? host.rng.fork('minigame:ecke:' + (taker && taker.id ? taker.id : '?'))
      : (host.rng || { next: () => 0.5 });

    const diff = clamp((host.difficulty && host.difficulty.minigame) || 1, 0.4, 2);
    // Klangnamen aus dem Vertrag von render/sound.js. Der zweite Parameter geht
    // unverändert an die Klangbank durch ({ lautstaerke, hoehe, panorama }).
    const sfx = (n, o) => { try { if (typeof host.sound === 'function') host.sound(n, o); } catch (e) { /* egal */ } };

    /** Was am Ende der Szene zu hören ist – je Ausgang genau ein Klang. */
    const AUSGANG_KLANG = {
      tor: ['tor', null],
      kopfball_tor: ['tor', null],
      parade: ['parade', null],
      geblockt: ['block', null],
      daneben: ['raunen', { lautstaerke: 0.85 }],
      abgefangen: ['raunen', { lautstaerke: 0.7 }]
    };

    /* ---- Personal ---------------------------------------------------------- */
    const rawTargets = (Array.isArray(m.targets) ? m.targets : []).filter(Boolean).slice(0, 4);
    const rawDefs = (Array.isArray(m.defenders) ? m.defenders : []).filter(Boolean).slice(0, 4);

    const ATT_SPOTS = [{ X: 38, Y: 5.5 }, { X: 31, Y: 4.5 }, { X: 34.5, Y: 9.5 }, { X: 26, Y: 8.0 }];
    const DEF_SPOTS = [{ X: 36.5, Y: 4.0 }, { X: 29.5, Y: 3.0 }, { X: 33, Y: 7.5 }, { X: 24, Y: 6.0 }];

    const attackers = [];
    for (let i = 0; i < Math.max(3, rawTargets.length); i++) {
      const s = ATT_SPOTS[i % ATT_SPOTS.length];
      attackers.push({
        player: rawTargets[i] || null,
        X: clamp(s.X + rFloat(rng, -1.5, 1.5), 15, 53),
        Y: clamp(s.Y + rFloat(rng, -1.2, 1.2), 2, 18),
        kopf: clamp((att(rawTargets[i], 'kopfball') * 0.62 + att(rawTargets[i], 'sprungkraft') * 0.38) / 99, 0, 1),
        speed: 4.2 + att(rawTargets[i], 'tempo') / 40
      });
    }
    const defenders = [];
    for (let i = 0; i < Math.max(3, rawDefs.length); i++) {
      const s = DEF_SPOTS[i % DEF_SPOTS.length];
      defenders.push({
        player: rawDefs[i] || null,
        X: clamp(s.X + rFloat(rng, -1.5, 1.5), 15, 53),
        Y: clamp(s.Y + rFloat(rng, -1.2, 1.2), 1.5, 18),
        kopf: clamp((att(rawDefs[i], 'kopfball') * 0.6 + att(rawDefs[i], 'sprungkraft') * 0.4) / 99, 0, 1),
        speed: (3.8 + att(rawDefs[i], 'tempo') / 44) * (0.9 + 0.2 * diff)
      });
    }
    const kp = { X: 34, Y: 1.4, out: false, t: 0 };

    /* ---- Kennwerte des Schützen -------------------------------------------- */
    const takerSkill = clamp(
      (att(taker, 'standards') * 0.50 + att(taker, 'technik') * 0.25 + att(taker, 'uebersicht') * 0.25) / 99, 0, 1)
      * (hasTrait(taker, 'eckenspezialist') ? 1.12 : 1);
    const keeperSkill = clamp(
      (att(keeper, 'strafraumbeherrschung', 55) * 0.55 + att(keeper, 'reflexe', 55) * 0.45) / 99, 0, 1);

    /* ---- Zustand ----------------------------------------------------------- */
    const S = {
      phase: 'variante',        // variante | zielen | flug | ergebnis
      t: 0, phaseT: 0,
      variant: 'lang',
      aim: { X: VARIANTS.lang.zone.X, Y: VARIANTS.lang.zone.Y },
      curve: VARIANTS.lang.idealCurve,
      power: 0, powerDir: 1, charging: false, lockedPower: 0,
      deliveryQ: 0,
      receiver: null,
      headOffset: null,         // Timing-Abweichung (Vielfache des grünen Bereichs)
      headTime: null,
      keeperOut: false, keeperArrival: 1,
      resolution: null,
      banner: '', bannerColor: COL.gelb,
      hoverVariant: null
    };

    let settle = () => { };

    const greenHalf = (player) => clamp(
      (HEAD_GREEN_BASE + HEAD_GREEN_SKILL * (player ? player.kopf : 0.5))
      * (player && hasTrait(player.player, 'kopfballungeheuer') ? HEAD_TRAIT_BONUS : 1) / diff,
      0.05, 0.40);

    /* ====================================================================== *
     *  ABLAUF
     * ====================================================================== */

    function chooseVariant(key) {
      if (S.phase !== 'variante' || !VARIANTS[key]) return;
      S.variant = key;
      S.aim = { X: VARIANTS[key].zone.X, Y: VARIANTS[key].zone.Y };
      S.curve = VARIANTS[key].idealCurve;
      S.phase = 'zielen';
      S.phaseT = 0;
      sfx('klick');
    }

    /** Optimale Kraft für die aktuelle Zieldistanz (0..1). */
    function idealPower() {
      const d = Math.hypot(S.aim.X - 0.6, S.aim.Y - 0.6);
      return clamp(0.28 + d / 42, 0.25, 0.95);
    }

    /** Flanke abgeben: Ausführungsgüte berechnen und den Ball auf die Reise schicken. */
    function deliver(power) {
      const spec = VARIANTS[S.variant];
      S.lockedPower = clamp(power, 0, 1);

      // Abweichung vom Zielbild der gewählten Variante
      const aimDev = clamp(Math.hypot(S.aim.X - spec.zone.X, S.aim.Y - spec.zone.Y) / AIM_TOLERANCE, 0, 1);
      const powDev = clamp(Math.abs(S.lockedPower - idealPower()) / 0.30, 0, 1);
      const curveFit = clamp(1 - Math.abs(S.curve - spec.idealCurve) / 1.6, 0, 1);

      let q = 0.10
        + 0.34 * takerSkill
        + 0.26 * (1 - aimDev)
        + 0.20 * (1 - powDev)
        + 0.14 * curveFit;
      q *= (1.14 - 0.14 * diff);
      q = clamp(q + rFloat(rng, -0.06, 0.06), 0, 1);
      S.deliveryQ = q;

      // Wo landet der Ball wirklich? Schlechte Ausführung streut.
      const err = (1 - q) * 6.5;
      S.landing = {
        X: clamp(S.aim.X + rFloat(rng, -err, err), 8, 58),
        Y: clamp(S.aim.Y + rFloat(rng, -err * 0.8, err * 0.8), 1.5, 22)
      };

      // Abnehmer: der beste Kopfballspieler in der Nähe des Landepunkts.
      let best = null, bestScore = -99;
      for (const a of attackers) {
        const d = Math.hypot(a.X - S.landing.X, a.Y - S.landing.Y);
        const sc = a.kopf * 1.2 - d / 14;
        if (sc > bestScore) { bestScore = sc; best = a; }
      }
      S.receiver = best;

      // Läuft der Torwart heraus?
      const distToGoal = Math.hypot(S.landing.X - 34, S.landing.Y);
      S.keeperOut = distToGoal < KEEPER_OUT_RANGE
        && rChance(rng, KEEPER_OUT_BASE + KEEPER_OUT_SKILL * keeperSkill);
      S.keeperArrival = clamp(KEEPER_ARRIVAL_BASE - 0.10 * keeperSkill + distToGoal / 90, 0.55, 1.1);

      S.phase = 'flug';
      S.phaseT = 0;
      // Die Flanke: derselbe Schlag wie ein Schuss, nur höher und weicher.
      sfx('schuss', { lautstaerke: 0.7, hoehe: 1.25 });

      if (q < DELIVERY_FAIL) {
        // Die Ecke kommt gar nicht erst an – wird noch im Flug geklärt.
        S.failedDelivery = true;
      }
    }

    /** Kopfball-/Abschlusstiming des Spielers. */
    function headAttempt() {
      if (S.phase !== 'flug' || S.headOffset !== null) return;
      const tFrac = clamp(S.phaseT / FLIGHT_S, 0, 1);
      const half = greenHalf(S.receiver);
      S.headTime = tFrac;
      S.headOffset = Math.abs(tFrac - HEAD_MOMENT) / half;
      // Stirn am Ball: dumpf und kurz wie ein Block, nur eine Spur heller.
      sfx('block', { hoehe: 1.35 });
    }

    /** Endauswertung nach dem Flug. */
    function resolveScene() {
      const spec = VARIANTS[S.variant];
      const receiverPlayer = S.receiver && S.receiver.player ? S.receiver.player : null;
      const targetId = receiverPlayer && receiverPlayer.id ? receiverPlayer.id : null;

      const finish = (outcome, quality, banner, color) => {
        const q = clamp(quality, 0, 1);
        // Der Ton hängt am Ausgang, nicht am Aufrufer – so bleibt keiner der
        // sechs Wege aus dieser Funktion stumm.
        const klang = AUSGANG_KLANG[outcome];
        if (klang) sfx(klang[0], klang[1]);
        S.resolution = {
          outcome,
          quality: q,
          targetPlayerId: targetId,
          xgDelta: clamp(XG_MIN + Math.pow(q, 1.15) * 0.50, XG_MIN, XG_MAX)
        };
        S.banner = banner;
        S.bannerColor = color;
        S.phase = 'ergebnis';
        S.phaseT = 0;
      };

      // 1) Flanke war Murks
      if (S.failedDelivery) {
        finish('abgefangen', clamp(S.deliveryQ * 0.6, 0, 0.35),
          'ZU UNGENAU!', COL.rot);
        return;
      }
      // 2) Gar nicht abgenommen
      if (S.headOffset === null) {
        finish('abgefangen', clamp(S.deliveryQ * 0.35, 0, 0.3),
          'NIEMAND GEHT HIN!', COL.rot);
        return;
      }
      // 3) Luftloch
      if (S.headOffset > HEAD_MISS_OFFSET) {
        finish('daneben', clamp(S.deliveryQ * 0.25, 0, 0.25),
          'LUFTLOCH!', COL.rot);
        return;
      }
      // 4) Der Keeper war eher am Ball
      if (S.keeperOut && S.headTime > S.keeperArrival) {
        finish('abgefangen', clamp(0.2 + S.deliveryQ * 0.3, 0, 0.5),
          'FAUSTABWEHR!', COL.hellblau);
        return;
      }

      const timing = clamp(1 - S.headOffset * 0.55, 0, 1);
      const total = clamp(0.45 * S.deliveryQ + 0.55 * timing, 0, 1);

      // Wahrscheinlichkeiten aus der Gesamtgüte ableiten
      const keeperF = (0.70 + 0.60 * keeperSkill) * (S.keeperOut ? 0.55 : 1) * (0.85 + 0.15 * diff);
      const nearDef = Math.min(...defenders.map(d =>
        Math.hypot(d.X - S.landing.X, d.Y - S.landing.Y)));
      const defF = clamp(1.35 - nearDef / 8, 0.35, 1.35);

      let pBlock = BLOCK_BASE * (1.25 - 0.5 * total) * defF;
      let pSave = SAVE_BASE * (1.35 - 0.7 * total) * keeperF;
      let pMiss = MISS_BASE * (1.50 - total) * (1.25 - 0.5 * (S.receiver ? S.receiver.kopf : 0.5));
      const sum = pBlock + pSave + pMiss;
      if (sum > 1 - MIN_GOAL_P) {
        const f = (1 - MIN_GOAL_P) / sum;
        pBlock *= f; pSave *= f; pMiss *= f;
      }

      const roll = rng.next();
      const kopfball = spec.kopf;
      if (roll < pBlock) {
        finish('geblockt', clamp(total * 0.55, 0, 1), 'GEBLOCKT!', COL.gelb);
      } else if (roll < pBlock + pSave) {
        finish('parade', clamp(total * 0.8, 0, 1), 'GEHALTEN!', COL.hellblau);
      } else if (roll < pBlock + pSave + pMiss) {
        finish('daneben', clamp(total * 0.5, 0, 1), 'DANEBEN!', COL.gelb);
      } else {
        finish(kopfball ? 'kopfball_tor' : 'tor', clamp(0.45 + total * 0.55, 0, 1),
          kopfball ? 'KOPFBALL – TOR!' : 'TOR!!!', COL.gruen);
      }
    }

    /* ====================================================================== *
     *  BEWEGUNG
     * ====================================================================== */

    function moveTo(a, tx, ty, speed, dt) {
      const dx = tx - a.X, dy = ty - a.Y;
      const d = Math.hypot(dx, dy);
      if (d < 0.08) return;
      const step = Math.min(d, speed * dt);
      a.X += dx / d * step; a.Y += dy / d * step;
    }

    function stepActors(dt) {
      if (S.phase === 'flug' && S.landing) {
        // Alles strömt zum Landepunkt
        for (const a of attackers) {
          const lead = a === S.receiver ? 0 : 1.6;
          moveTo(a, S.landing.X + lead, S.landing.Y + lead * 0.6, a.speed, dt);
        }
        for (let i = 0; i < defenders.length; i++) {
          const d = defenders[i];
          moveTo(d, S.landing.X - 1.2 - i * 0.7, Math.max(1.2, S.landing.Y - 1.0), d.speed, dt);
        }
        if (S.keeperOut) moveTo(kp, S.landing.X, Math.max(1.2, S.landing.Y - 0.6), 4.6, dt);
        else moveTo(kp, clamp(S.landing.X * 0.25 + 34 * 0.75, 31, 37), 1.4, 2.4, dt);
      } else {
        // Vor der Flanke: leichtes Positionsgeschiebe im Strafraum
        for (let i = 0; i < attackers.length; i++) {
          const a = attackers[i];
          const sway = Math.sin(S.t * (1.1 + i * 0.17) + i) * 1.4;
          moveTo(a, ATT_SPOTS[i % ATT_SPOTS.length].X + sway,
            ATT_SPOTS[i % ATT_SPOTS.length].Y + Math.cos(S.t * 0.9 + i) * 1.0, 2.2, dt);
        }
        for (let i = 0; i < defenders.length; i++) {
          const d = defenders[i];
          const mark = attackers[i % attackers.length];
          moveTo(d, mark.X - 1.0, Math.max(1.3, mark.Y - 1.1), 2.6, dt);
        }
        moveTo(kp, clamp(S.aim.X * 0.2 + 34 * 0.8, 31.5, 36.5), 1.4, 1.8, dt);
      }
    }

    /* ====================================================================== *
     *  ZEICHNEN
     * ====================================================================== */

    function poly(pts, fill, stroke, lw) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
    }

    function line(a, b, color, lw) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
    }

    function label(str, x, y, color, size = 12, align = 'center') {
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = Math.max(3, size * 0.28); ctx.lineJoin = 'round';
      ctx.strokeStyle = COL.outline; ctx.strokeText(str, x, y);
      ctx.fillStyle = color; ctx.fillText(str, x, y);
    }

    function drawPitch() {
      ctx.fillStyle = COL.rasen;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      // Rasenstreifen entlang der Torlinie
      for (let i = 0; i < 9; i++) {
        if (i % 2) continue;
        const a = toScreen(-6, i * 3), b = toScreen(74, i * 3);
        const c = toScreen(74, i * 3 + 3), d = toScreen(-6, i * 3 + 3);
        poly([a, b, c, d], COL.rasenDunkel, null);
      }
      // Torlinie und Strafraum
      line(toScreen(0, 0), toScreen(68, 0), COL.linie, 4);
      poly([toScreen(13.84, 0), toScreen(13.84, 16.5), toScreen(54.16, 16.5), toScreen(54.16, 0)],
        null, COL.linie, 4);
      poly([toScreen(24.84, 0), toScreen(24.84, 5.5), toScreen(43.16, 5.5), toScreen(43.16, 0)],
        null, COL.linie, 3);
      // Elfmeterpunkt
      const pen = toScreen(34, 11);
      ctx.beginPath(); ctx.arc(pen.x, pen.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = COL.linie; ctx.fill();
      // Eckfahne
      const flag = toScreen(0.4, 0.4);
      line(flag, { x: flag.x, y: flag.y - 34 }, COL.papier, 4);
      poly([{ x: flag.x, y: flag.y - 34 }, { x: flag.x + 18, y: flag.y - 28 },
      { x: flag.x, y: flag.y - 22 }], COL.rot, COL.outline, 2);
    }

    function drawGoal() {
      const lp = toScreen(30.34, 0), rp = toScreen(37.66, 0);
      const lpT = toScreen(30.34, 0, 2.44), rpT = toScreen(37.66, 0, 2.44);
      const back = 1.9;
      const lb = toScreen(30.34, -back), rb = toScreen(37.66, -back);
      const lbT = toScreen(30.34, -back, 2.44), rbT = toScreen(37.66, -back, 2.44);
      // Netz
      poly([lpT, rpT, rbT, lbT], 'rgba(14,22,28,0.45)', null);
      poly([lpT, lbT, lb, lp], 'rgba(14,22,28,0.35)', null);
      poly([rpT, rbT, rb, rp], 'rgba(14,22,28,0.35)', null);
      ctx.strokeStyle = 'rgba(240,245,246,0.5)'; ctx.lineWidth = 1.3;
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        line({ x: lerp(lpT.x, rpT.x, t), y: lerp(lpT.y, rpT.y, t) },
          { x: lerp(lbT.x, rbT.x, t), y: lerp(lbT.y, rbT.y, t) }, 'rgba(240,245,246,0.45)', 1.3);
        line({ x: lerp(lp.x, rp.x, t), y: lerp(lp.y, rp.y, t) },
          { x: lerp(lpT.x, rpT.x, t), y: lerp(lpT.y, rpT.y, t) }, 'rgba(240,245,246,0.25)', 1);
      }
      // Rahmen dick
      for (const [a, b] of [[lp, lpT], [rp, rpT], [lpT, rpT]]) {
        line(a, b, COL.outline, 11);
        line(a, b, COL.linie, 7);
      }
    }

    /** Spielerfigur über host.drawPlayer oder Notdarstellung. */
    function figure(player, x, y, scale, opts, colA) {
      if (typeof host.drawPlayer === 'function' && player) {
        try { host.drawPlayer(ctx, player, x, y, scale, opts || {}); return; }
        catch (e) {
          if (!warnedDraw) { warnedDraw = true; console.warn('[ecke] host.drawPlayer fehlgeschlagen, nutze Notdarstellung:', e); }
        }
      }
      const s = scale * 30;
      ctx.lineWidth = 2.5; ctx.strokeStyle = COL.outline;
      ctx.fillStyle = '#20202a';
      ctx.fillRect(x - s * 0.20, y - s * 0.42, s * 0.16, s * 0.42);
      ctx.fillRect(x + s * 0.04, y - s * 0.42, s * 0.16, s * 0.42);
      ctx.strokeRect(x - s * 0.20, y - s * 0.42, s * 0.16, s * 0.42);
      ctx.strokeRect(x + s * 0.04, y - s * 0.42, s * 0.16, s * 0.42);
      ctx.fillStyle = colA;
      ctx.fillRect(x - s * 0.28, y - s * 1.00, s * 0.56, s * 0.58);
      ctx.strokeRect(x - s * 0.28, y - s * 1.00, s * 0.56, s * 0.58);
      ctx.fillStyle = '#d9a273';
      ctx.beginPath(); ctx.arc(x, y - s * 1.16, s * 0.19, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    function drawActors() {
      const list = [];
      for (const a of attackers) list.push({ a, col: COL.blau, tag: 'A' });
      for (const d of defenders) list.push({ a: d, col: COL.rot, tag: 'D' });
      list.push({ a: kp, col: '#f0a020', tag: 'K' });
      list.sort((p, q) => toScreen(p.a.X, p.a.Y).y - toScreen(q.a.X, q.a.Y).y);
      for (const item of list) {
        const s = toScreen(item.a.X, item.a.Y);
        ctx.save();
        ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(s.x, s.y + 2, 15, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        const pose = S.phase === 'flug' ? 'lauf' : 'stand';
        figure(item.a.player, s.x, s.y, 0.95,
          { pose, dir: 1, frame: (S.t * 3) % 1, club: null }, item.col);
        if (item.a === S.receiver && S.phase === 'flug') {
          ctx.beginPath(); ctx.arc(s.x, s.y + 2, 20, 0, Math.PI * 2);
          ctx.strokeStyle = COL.gelb; ctx.lineWidth = 3.5; ctx.stroke();
          label(nameOf(item.a.player, 'Abnehmer'), s.x, s.y + 24, COL.gelb, 13);
        }
      }
      // Schütze an der Eckfahne
      const tk = toScreen(0.9, 1.0);
      figure(taker, tk.x, tk.y, 1.0, { pose: S.phase === 'flug' ? 'schuss' : 'stand', dir: 1 }, COL.blau);
      label(nameOf(taker, 'Schütze'), tk.x, tk.y + 22, COL.papier, 13);
    }

    /** Position des Balls im Flug (Weltkoordinaten inkl. Höhe). */
    function ballAt(tFrac) {
      const spec = VARIANTS[S.variant];
      const from = { X: 0.6, Y: 0.6 };
      const to = S.landing;
      const t = clamp(tFrac, 0, 1);
      // Seitliche Auslenkung senkrecht zur Flugrichtung
      const dx = to.X - from.X, dy = to.Y - from.Y;
      const len = Math.max(0.5, Math.hypot(dx, dy));
      const nx = -dy / len, ny = dx / len;
      const bend = Math.sin(Math.PI * t) * S.curve * CURVE_METERS;
      const h = spec.hoehe * (4.5 + S.lockedPower * 6.5);
      return {
        X: lerp(from.X, to.X, t) + nx * bend,
        Y: lerp(from.Y, to.Y, t) + ny * bend,
        Z: 4 * h * t * (1 - t)
      };
    }

    function drawBall() {
      if (S.phase !== 'flug' || !S.landing) return;
      const b = ballAt(S.phaseT / FLIGHT_S);
      const ground = toScreen(b.X, b.Y);
      const air = toScreen(b.X, b.Y, b.Z);
      ctx.save();
      ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(ground.x, ground.y, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(air.x, air.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = COL.papier; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = COL.outline; ctx.stroke();
    }

    function drawAimPreview() {
      if (S.phase !== 'zielen') return;
      // Vorschau der Flugkurve
      const saveLanding = S.landing, savePower = S.lockedPower;
      S.landing = { X: S.aim.X, Y: S.aim.Y };
      S.lockedPower = S.charging ? S.power : idealPower();
      ctx.save();
      ctx.setLineDash([9, 7]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(245,197,24,0.85)';
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const b = ballAt(i / 24);
        const p = toScreen(b.X, b.Y, b.Z);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      S.landing = saveLanding; S.lockedPower = savePower;

      // Zielkreuz
      const s = toScreen(S.aim.X, S.aim.Y);
      const spec = VARIANTS[S.variant];
      const dev = Math.hypot(S.aim.X - spec.zone.X, S.aim.Y - spec.zone.Y) / AIM_TOLERANCE;
      const col = dev < 0.35 ? COL.gruen : dev < 0.75 ? COL.gelb : COL.rot;
      ctx.lineWidth = 5; ctx.strokeStyle = COL.outline;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, 26, 11, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, 26, 11, 0, 0, Math.PI * 2); ctx.stroke();
      // Sollbereich der Variante
      const z = toScreen(spec.zone.X, spec.zone.Y);
      ctx.setLineDash([6, 6]); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.ellipse(z.x, z.y, 40, 17, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    function drawVariantMenu() {
      if (S.phase !== 'variante') return;
      ctx.fillStyle = 'rgba(10,14,20,0.72)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      label('ECKBALL – WIE SOLL SIE KOMMEN?', CANVAS_W / 2, 120, COL.gelb, 30);
      for (let i = 0; i < VARIANT_ORDER.length; i++) {
        const spec = VARIANTS[VARIANT_ORDER[i]];
        const y = 168 + i * 74;
        const hover = S.hoverVariant === VARIANT_ORDER[i];
        ctx.fillStyle = hover ? COL.beige : '#2b3543';
        ctx.fillRect(180, y, 600, 60);
        ctx.strokeStyle = hover ? COL.gelb : COL.outline;
        ctx.lineWidth = hover ? 4 : 3;
        ctx.strokeRect(180, y, 600, 60);
        label(`[${spec.key}]`, 214, y + 38, hover ? COL.rot : COL.gelb, 22);
        label(spec.name, 258, y + 27, hover ? COL.outline : COL.papier, 19, 'left');
        label(spec.desc, 258, y + 48, hover ? '#5a4a2a' : '#9fb0c2', 13, 'left');
      }
      const rest = Math.max(0, PHASE_VARIANT_S - S.phaseT);
      label(`Entscheidung in ${rest.toFixed(1)} s – sonst kommt sie an den langen Pfosten`,
        CANVAS_W / 2, 500, COL.papier, 15);
    }

    function drawPowerBar() {
      if (S.phase !== 'zielen') return;
      const w = 300, h = 26, x = 40, y = CANVAS_H - 108;
      ctx.fillStyle = COL.dunkel; ctx.fillRect(x - 6, y - 24, w + 12, h + 32);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 2; ctx.strokeRect(x - 6, y - 24, w + 12, h + 32);
      label('KRAFT (Maustaste halten)', x + w / 2, y - 6, COL.papier, 13);
      ctx.fillStyle = '#2b3543'; ctx.fillRect(x, y, w, h);
      // optimaler Bereich
      const ideal = idealPower();
      ctx.fillStyle = 'rgba(63,174,74,0.75)';
      ctx.fillRect(x + (ideal - POWER_SWEET) * w, y, POWER_SWEET * 2 * w, h);
      ctx.fillStyle = COL.gelb;
      ctx.fillRect(x, y, S.power * w, h);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);

      // Flugkurve
      const cx = 400, cw = 200;
      ctx.fillStyle = COL.dunkel; ctx.fillRect(cx - 6, y - 24, cw + 12, h + 32);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 2; ctx.strokeRect(cx - 6, y - 24, cw + 12, h + 32);
      label('FLUGKURVE  [A] / [D]', cx + cw / 2, y - 6, COL.papier, 13);
      ctx.fillStyle = '#2b3543'; ctx.fillRect(cx, y, cw, h);
      const mid = cx + cw / 2;
      ctx.fillStyle = COL.hellblau;
      const cv = clamp(S.curve, -1, 1);
      ctx.fillRect(Math.min(mid, mid + cv * cw / 2), y, Math.abs(cv) * cw / 2, h);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(cx, y, cw, h);
      label(cv > 0.15 ? 'nach innen' : cv < -0.15 ? 'nach außen' : 'gerade',
        mid, y + 18, COL.papier, 13);

      const rest = Math.max(0, PHASE_AIM_S - S.phaseT);
      label(`noch ${rest.toFixed(1)} s`, 700, y + 18, rest < 2 ? COL.rot : COL.papier, 16);
    }

    function drawTimingBar() {
      if (S.phase !== 'flug' || S.failedDelivery) return;
      const tFrac = clamp(S.phaseT / FLIGHT_S, 0, 1);
      if (tFrac < BAR_START * 0.6) return;
      const w = 520, h = 32, x = (CANVAS_W - w) / 2, y = CANVAS_H - 112;
      ctx.fillStyle = COL.dunkel; ctx.fillRect(x - 6, y - 26, w + 12, h + 34);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 2; ctx.strokeRect(x - 6, y - 26, w + 12, h + 34);
      label(S.keeperOut ? 'TORWART KOMMT – FRÜHER ABNEHMEN!' : 'ABNEHMEN!',
        x + w / 2, y - 8, S.keeperOut ? COL.rot : COL.papier, 15);
      ctx.fillStyle = '#2b3543'; ctx.fillRect(x, y, w, h);

      const half = greenHalf(S.receiver);
      const toBar = (t) => clamp((t - BAR_START) / (1 - BAR_START), 0, 1);
      const g0 = toBar(HEAD_MOMENT - half), g1 = toBar(HEAD_MOMENT + half);
      ctx.fillStyle = 'rgba(245,197,24,0.45)';
      ctx.fillRect(x + toBar(HEAD_MOMENT - half * 2) * w, y,
        (g0 - toBar(HEAD_MOMENT - half * 2)) * w, h);
      ctx.fillRect(x + g1 * w, y, (toBar(HEAD_MOMENT + half * 2) - g1) * w, h);
      ctx.fillStyle = COL.gruen;
      ctx.fillRect(x + g0 * w, y, (g1 - g0) * w, h);
      if (S.keeperOut) {
        const ka = toBar(S.keeperArrival);
        ctx.fillStyle = 'rgba(193,39,45,0.55)';
        ctx.fillRect(x + ka * w, y, w - ka * w, h);
      }
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
      const mx = x + toBar(tFrac) * w;
      ctx.fillStyle = COL.papier; ctx.fillRect(mx - 4, y - 8, 8, h + 16);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(mx - 4, y - 8, 8, h + 16);
      if (S.headOffset !== null) {
        label(S.headOffset < 1 ? 'PERFEKT!' : S.headOffset < 2 ? 'unsauber' : 'daneben',
          x + w / 2, y + 23, S.headOffset < 1 ? COL.outline : COL.rot, 16);
      }
    }

    function drawHud() {
      ctx.fillStyle = COL.dunkel; ctx.fillRect(0, 0, CANVAS_W, 40);
      label(nameOf(taker, 'Schütze').toUpperCase(), 100, 27, COL.gelb, 18);
      label(`${minute}. MINUTE`, 400, 27, COL.papier, 16);
      label(`STAND  ${score[0]} : ${score[1]}`, 570, 27, COL.papier, 16);
      label(String(context.competition || ''), 850, 27, COL.hellblau, 14);

      const spec = VARIANTS[S.variant];
      if (S.phase !== 'variante') {
        ctx.fillStyle = COL.dunkel; ctx.fillRect(CANVAS_W - 268, 48, 256, 28);
        ctx.strokeStyle = COL.outline; ctx.lineWidth = 2; ctx.strokeRect(CANVAS_W - 268, 48, 256, 28);
        label('VARIANTE: ' + spec.short, CANVAS_W - 140, 68, COL.gelb, 14);
      }

      ctx.fillStyle = COL.dunkel; ctx.fillRect(0, CANVAS_H - 54, CANVAS_W, 54);
      if (S.phase === 'zielen') {
        label('Maus = Zielpunkt · [A]/[D] = Flugkurve · Maustaste halten und im grünen Bereich loslassen',
          CANVAS_W / 2, CANVAS_H - 32, COL.papier, 14);
      } else if (S.phase === 'flug') {
        label('[Leertaste] oder Klick, wenn der Marker im grünen Bereich steht',
          CANVAS_W / 2, CANVAS_H - 32, COL.papier, 14);
      } else if (S.phase === 'variante') {
        label('Variante mit [1]-[4] oder Mausklick wählen', CANVAS_W / 2, CANVAS_H - 32, COL.papier, 14);
      }
      label('[ESC] = Simulation entscheiden lassen', CANVAS_W / 2, CANVAS_H - 12, '#b9c4d2', 12);
    }

    function drawBanner() {
      if (!S.banner) return;
      const w = 560, h = 78, x = (CANVAS_W - w) / 2, y = 190;
      ctx.fillStyle = COL.beige; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.font = 'bold 36px "Arial Black", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.strokeStyle = COL.outline;
      ctx.strokeText(S.banner, CANVAS_W / 2, y + 52);
      ctx.fillStyle = S.bannerColor;
      ctx.fillText(S.banner, CANVAS_W / 2, y + 52);
    }

    function render() {
      ctx.save();
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawPitch();
      drawGoal();
      drawAimPreview();
      drawActors();
      drawBall();
      drawPowerBar();
      drawTimingBar();
      drawHud();
      drawVariantMenu();
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

      if (S.phase === 'variante') {
        if (S.phaseT >= PHASE_VARIANT_S) chooseVariant('lang');
      } else if (S.phase === 'zielen') {
        if (S.charging) {
          S.power += S.powerDir * POWER_SPEED * dt;
          if (S.power >= 1) { S.power = 1; S.powerDir = -1; }
          if (S.power <= 0) { S.power = 0; S.powerDir = 1; }
        }
        if (S.phaseT >= PHASE_AIM_S) deliver(S.charging ? S.power : idealPower() * 0.8);
      } else if (S.phase === 'flug') {
        if (S.phaseT >= FLIGHT_S) resolveScene();
      } else if (S.phase === 'ergebnis') {
        if (S.phaseT >= RESULT_S) settle(S.resolution);
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
        if (S.phase === 'variante') {
          S.hoverVariant = null;
          for (let i = 0; i < VARIANT_ORDER.length; i++) {
            const y = 168 + i * 74;
            if (p.x >= 180 && p.x <= 780 && p.y >= y && p.y <= y + 60) S.hoverVariant = VARIANT_ORDER[i];
          }
        } else if (S.phase === 'zielen') {
          const w = toWorld(p.x, p.y);
          S.aim = { X: clamp(w.X, 8, 58), Y: clamp(w.Y, 1.5, 22) };
        }
      });

      on(canvas, 'mousedown', (ev) => {
        ev.preventDefault();
        if (S.phase === 'variante') {
          if (S.hoverVariant) chooseVariant(S.hoverVariant);
        } else if (S.phase === 'zielen') {
          S.charging = true; S.power = 0; S.powerDir = 1;
        } else if (S.phase === 'flug') {
          headAttempt();
        }
      });

      on(window, 'mouseup', () => {
        if (S.phase === 'zielen' && S.charging) {
          S.charging = false;
          deliver(S.power);
        }
      });

      on(window, 'keydown', (ev) => {
        const k = ev.key;
        if (k === 'Escape') { settleInner(null); return; }
        if (S.phase === 'variante') {
          const idx = VARIANT_ORDER.find((id) => VARIANTS[id].key === k);
          if (idx) { ev.preventDefault(); chooseVariant(idx); }
        } else if (S.phase === 'zielen') {
          const lower = typeof k === 'string' ? k.toLowerCase() : '';
          if (lower === 'a' || k === 'ArrowLeft') { S.curve = clamp(S.curve - 0.18, -1, 1); ev.preventDefault(); }
          else if (lower === 'd' || k === 'ArrowRight') { S.curve = clamp(S.curve + 0.18, -1, 1); ev.preventDefault(); }
          else if (k === ' ') {
            // Tastatur-Alternative zum Kraftbalken
            ev.preventDefault();
            if (!S.charging) { S.charging = true; S.power = 0; S.powerDir = 1; }
            else { S.charging = false; deliver(S.power); }
          }
        } else if (S.phase === 'flug' && (k === ' ' || k === 'Enter')) {
          ev.preventDefault();
          headAttempt();
        }
      });

      canvas.style.cursor = 'crosshair';

      watchdog = setTimeout(() => {
        settleInner(S.resolution || {
          outcome: 'abgefangen', quality: 0.2,
          targetPlayerId: null, xgDelta: -0.05
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
