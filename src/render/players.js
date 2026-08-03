/**
 * render/players.js — Ganzkörper-Sprites für Spielfeld, Minispiele und Menüs.
 *
 * Blickwinkel: leicht geneigte Draufsicht („von oben-schräg"). Man sieht das
 * komplette Trikot samt Rückennummer UND den Kopf mit Frisur/Hautton – der
 * klassische Manager-Look aus Anstoß 1/2.
 *
 * Alle Körperteile entstehen aus Canvas-Pfaden. Die Figur wird in
 * „Sprite-Einheiten" konstruiert:
 *   – (0,0) ist der Bodenpunkt (zwischen den Füßen), −y ist oben.
 *   – Ein normal gebauter Spieler ist rund 47 Einheiten hoch.
 *   – `scale` = 1 bedeutet also ca. 47 px Gesamthöhe.
 *
 * Haut-, Haar- und Trikotlogik wird NICHT dupliziert, sondern aus
 * render/portraits.js importiert (drawFace, Paletten, Muster, Farbmathematik).
 *
 * Öffentlicher Vertrag (docs/CONTRACTS.md §10 + Aufgabenstellung):
 *   drawPlayer(ctx, player, x, y, scale, opts)
 *   drawKeeper(ctx, player, x, y, scale, opts)
 *   drawReferee(ctx, x, y, scale, opts)
 *   drawBall(ctx, x, y, radius, opts)
 */

import { clamp } from '../core/util.js';
import {
  normalizeAppearance, skinPalette, resolveKitColors, fillJerseyPattern,
  ellipsePath, roundRectPath, shadeColor, mixHex, readableInk, luminance,
  drawFace, DETAIL
} from './portraits.js';

/* ══════════════════════════════════════════════════════════════════════════
   BALANCING / STIL
   ══════════════════════════════════════════════════════════════════════════ */

/** Körperpunkte in Sprite-Einheiten (Füße = 0, negativ = nach oben). */
const HIP_Y = -20.5;
const CHEST_Y = -31.5;
const HEAD_Y = -42;
const HEAD_H = 12.6;          // Kopfhöhe (Scheitel → Kinn)
/** Ruhende Handhöhe (Arme hängen etwa bis Mitte Oberschenkel). */
const HAND_Y = -16.5;

/** Ab dieser Skalierung wird vereinfacht gezeichnet (Feld-Performance). */
const SIMPLE_SCALE = 0.5;
/** Ab dieser Skalierung lohnen sich Nummern. */
const NUMBER_MIN_SCALE = 1.15;
/** Ab dieser Skalierung lohnt sich ein vollausgearbeitetes Gesicht. */
const FACE_FULL_SCALE = 2.0;
const FACE_MID_SCALE = 0.85;

/** Mindest-Linienstärke in Bildschirmpixeln. */
const MIN_PX_LINE = 0.7;

/** Neigung des Kopfes in der Draufsicht (1 = frontal, kleiner = mehr von oben). */
const HEAD_TILT = 0.52;

/** Körperbau: Schulter-/Taillenbreite und Gliedmaßenstärke. */
const BUILDS = {
  schlank: { shoulder: 8.8, waist: 6.2, leg: 2.8, arm: 1.9, head: 0.96 },
  normal: { shoulder: 10.2, waist: 7.5, leg: 3.3, arm: 2.2, head: 1.00 },
  kraeftig: { shoulder: 11.9, waist: 9.1, leg: 3.9, arm: 2.7, head: 1.04 }
};

/** Schuh- und Standardfarben. */
const SHOE_DARK = '#1d1a16';
const SHOE_LIGHT = '#f1ece0';
const GRASS_SHADOW = 'rgba(14,32,12,0.34)';

/** Torwart-Standardfarben (klassisch grell), Auswahl nach Kontrast zum Team. */
const KEEPER_PALETTE = ['#1fa84a', '#f2e400', '#e2600c', '#20232a', '#7a2bb5', '#12b3c8'];

/** Schiedsrichter-Ausrüstung. */
const REF_KIT = { primary: '#1e2026', secondary: '#f2c200', shorts: '#16181d', socks: '#16181d', pattern: 'plain' };

const FONT_STACK = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

/** Unterstützte Posen (Feldspieler + Torwart). */
export const PLAYER_POSES = ['stand', 'lauf', 'schuss', 'jubel', 'graetsche', 'parade', 'kopfball', 'liegend'];
export const KEEPER_POSES = ['stand', 'lauf', 'parade', 'abschlag', 'fangen', 'liegend'];

/** Schreibweisen mit Umlaut/Alias auf die internen Keys abbilden. */
const POSE_ALIAS = {
  'grätsche': 'graetsche', 'graetsche': 'graetsche', 'tackling': 'graetsche',
  'laufen': 'lauf', 'run': 'lauf', 'stehen': 'stand',
  'schiessen': 'schuss', 'schuß': 'schuss', 'kopfball': 'kopfball',
  'jubeln': 'jubel', 'save': 'parade', 'catch': 'fangen'
};

/* ══════════════════════════════════════════════════════════════════════════
   HILFEN
   ══════════════════════════════════════════════════════════════════════════ */

function normalizePose(pose, isKeeper) {
  let p = String(pose || 'stand').toLowerCase();
  p = POSE_ALIAS[p] || p;
  const list = isKeeper ? KEEPER_POSES.concat('schuss', 'jubel', 'graetsche', 'kopfball') : PLAYER_POSES.concat('abschlag', 'fangen');
  return list.indexOf(p) >= 0 ? p : 'stand';
}

function metricsFor(app) {
  const b = BUILDS[app.build] || BUILDS.normal;
  const hs = clamp(1 + ((app.height || 180) - 180) * 0.0042, 0.9, 1.1);
  return {
    shoulder: b.shoulder, waist: b.waist, leg: b.leg, arm: b.arm,
    hs, headH: HEAD_H * b.head
  };
}

/** Abstand zweier Farben (0..1) – für die Torwart-Farbwahl. */
function colorDist(a, b) {
  const pa = hexTriple(a), pb = hexTriple(b);
  if (!pa || !pb) return 1;
  const d = Math.sqrt((pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2);
  return d / 441.67;
}

function hexTriple(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Torwart-Trikotfarben: möglichst weit weg von den Feldspielerfarben.
 * Deterministisch – gleicher Verein ⇒ immer dieselbe Torwartfarbe.
 */
export function keeperColors(club, away = false) {
  const team = resolveKitColors(club, away);
  let best = KEEPER_PALETTE[0], bestScore = -1;
  for (const cand of KEEPER_PALETTE) {
    const score = Math.min(colorDist(cand, team.primary), colorDist(cand, team.secondary) * 0.8);
    if (score > bestScore + 1e-6) { bestScore = score; best = cand; }
  }
  return {
    primary: best,
    secondary: luminance(best) > 0.5 ? '#20232a' : '#f0ede4',
    shorts: shadeColor(best, -0.45),
    socks: shadeColor(best, -0.3),
    pattern: 'plain'
  };
}

/* ── Gliedmaßen ───────────────────────────────────────────────────────────
   Arme und Beine sind Quadratkurven mit runden Enden: ein dicker dunkler
   Strich als Outline, darüber der eigentliche Farbstrich. Das liest sich
   auch bei 12 px Höhe noch als Gliedmaße.                                  */

function limbControl(ax, ay, bx, by, bend) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  return { cx: (ax + bx) / 2 - (dy / len) * bend, cy: (ay + by) / 2 + (dx / len) * bend };
}

function qPoint(ax, ay, cx, cy, bx, by, t) {
  const u = 1 - t;
  return [u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by];
}

function strokeLimb(ctx, ax, ay, c, bx, by, w, color, o, t0) {
  let sx = ax, sy = ay, ccx = c.cx, ccy = c.cy;
  if (t0 > 0) {
    // Teilstück [t0,1] einer Quadratkurve exakt abspalten (de Casteljau)
    const p = qPoint(ax, ay, c.cx, c.cy, bx, by, t0);
    sx = p[0]; sy = p[1];
    ccx = c.cx + (bx - c.cx) * t0;
    ccy = c.cy + (by - c.cy) * t0;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (o.outline) {
    ctx.strokeStyle = o.ink;
    ctx.lineWidth = w + o.lw(1.6);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(ccx, ccy, bx, by);
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(ccx, ccy, bx, by);
  ctx.stroke();
}

/** Fußballschuh am Fußpunkt, in Laufrichtung ausgerichtet. */
function drawShoe(ctx, fx, fy, ang, w, o) {
  ctx.save();
  ctx.translate(fx, fy);
  ctx.rotate(ang);
  roundRectPath(ctx, -w * 0.55, -w * 0.5, w * 2.5, w * 1.0, w * 0.42);
  ctx.fillStyle = SHOE_DARK;
  ctx.fill();
  if (o.outline) { ctx.strokeStyle = o.ink; ctx.lineWidth = o.lw(1.2); ctx.stroke(); }
  ctx.fillStyle = SHOE_LIGHT;
  ctx.fillRect(-w * 0.5, w * 0.22, w * 2.35, w * 0.28);
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════════════════
   POSEN – Skelett-Rig
   ══════════════════════════════════════════════════════════════════════════

   Ein Rig besteht aus drei Ankern (hip, chest, head) und den Zielpunkten
   von Beinen und Armen. Der Oberkörper wird entlang hip→chest gedreht, damit
   Neigungen (Grätsche, Hechtsprung, Liegend) automatisch stimmen.            */

/**
 * @param {number} [gait=1] Schrittamplitude der Laufpose (0,45 = Trab, 1,25 = Sprint).
 *   Rein additiv: ohne Angabe verhält sich das Rig wie bisher.
 */
function buildRig(pose, frame, m, isKeeper, gait) {
  const f = clamp(frame || 0, 0, 1);
  const g = clamp(isFinite(gait) ? gait : 1, 0.3, 1.6);
  const rig = {
    hip: [0, HIP_Y], chest: [0, CHEST_Y], head: [0, HEAD_Y],
    headRot: 0, mood: 'normal', airborne: 0, grounded: false,
    legs: [{ foot: [-2.2, 0], bend: 1.0 }, { foot: [2.6, 0], bend: -1.0 }],
    arms: [{ hand: [-5.0, HAND_Y], bend: 1.8 }, { hand: [5.3, HAND_Y + 0.5], bend: -1.8 }]
  };

  switch (pose) {
    case 'lauf': {
      // gait skaliert Schrittweite, Kniehub, Armschwung und das Auf und Ab:
      // ein Trab sieht damit anders aus als ein Sprint.
      const ph = f * Math.PI * 2;
      const s = Math.sin(ph);
      const bob = -Math.abs(Math.sin(ph * 2)) * 1.1 * g;
      rig.hip = [0.5 * g, HIP_Y + bob];
      rig.chest = [1.6 * g, CHEST_Y + bob];
      rig.head = [2.4 * g, HEAD_Y + bob];
      rig.legs = [
        { foot: [-s * 6.8 * g, -Math.max(0, -s) * 4.2 * g], bend: -1.2 - s * 1.6 * g },
        { foot: [s * 6.8 * g, -Math.max(0, s) * 4.2 * g], bend: -1.2 + s * 1.6 * g }
      ];
      rig.arms = [
        { hand: [s * 6.0 * g, HAND_Y + 1.5 + bob], bend: 1.8 },
        { hand: [-s * 6.0 * g, HAND_Y + 1.0 + bob], bend: -1.8 }
      ];
      break;
    }
    case 'schuss': {
      // frame steuert Ausholen (0) → Durchziehen (1)
      const kp = f === 0 ? 0.6 : f;
      rig.hip = [-1, HIP_Y];
      rig.chest = [-2.4, CHEST_Y];
      rig.head = [-3.4, HEAD_Y + 0.5];
      rig.legs = [
        { foot: [-3.6, 0], bend: 1.4 },
        { foot: [-6 + 18 * kp, -1.5 - 6.5 * kp], bend: -1.5 - 2 * kp }
      ];
      rig.arms = [
        { hand: [-9.5, -26 - 2 * kp], bend: 2.4 },
        { hand: [6.5 + 2 * kp, -31], bend: -2.4 }
      ];
      break;
    }
    case 'jubel': {
      const lift = 2.6;
      rig.airborne = lift;
      rig.hip = [0, HIP_Y - lift];
      rig.chest = [0, CHEST_Y - lift];
      rig.head = [0, HEAD_Y - lift - 0.5];
      rig.mood = 'jubel';
      rig.legs = [
        { foot: [-3.4, -lift * 0.4], bend: 1.2 },
        { foot: [3.4, -lift * 0.4], bend: -1.2 }
      ];
      rig.arms = [
        { hand: [-10.5, -46], bend: -2.2 },
        { hand: [10.5, -46], bend: 2.2 }
      ];
      break;
    }
    case 'graetsche': {
      rig.grounded = true;
      rig.hip = [-2, -8];
      rig.chest = [-8.5, -13];
      rig.head = [-14.5, -16.5];
      rig.headRot = -0.5;
      rig.legs = [
        { foot: [12.5, -2.5], bend: -1.6 },
        { foot: [4.5, -1.5], bend: -3.2 }
      ];
      rig.arms = [
        { hand: [-19, -3.5], bend: 1.8 },
        { hand: [-9, -20], bend: -2.2 }
      ];
      break;
    }
    case 'liegend': {
      rig.grounded = true;
      rig.hip = [-1, -4.2];
      rig.chest = [-8.5, -4.8];
      rig.head = [-16, -6];
      rig.headRot = -1.35;
      rig.mood = 'frust';
      rig.legs = [
        { foot: [9.5, -2], bend: -2.2 },
        { foot: [8.5, -5.5], bend: -3.2 }
      ];
      rig.arms = [
        { hand: [-18, -2], bend: 2.2 },
        { hand: [-12, -9.5], bend: -2.4 }
      ];
      break;
    }
    case 'kopfball': {
      const lift = 9;
      rig.airborne = lift;
      rig.hip = [0, HIP_Y - lift];
      rig.chest = [1.2, CHEST_Y - lift];
      rig.head = [2.6, HEAD_Y - lift - 0.8];
      rig.headRot = -0.22;
      rig.legs = [
        { foot: [-7, -lift - 4], bend: -3.4 },
        { foot: [-2.5, -lift - 2], bend: -3.0 }
      ];
      rig.arms = [
        { hand: [-11, -34 - lift * 0.5], bend: 2.2 },
        { hand: [9.5, -36 - lift * 0.5], bend: -2.2 }
      ];
      break;
    }
    case 'parade': {
      // Hechtsprung: kompletter Körper in der Luft, diagonal nach vorn oben
      const lift = 14;
      rig.airborne = lift;
      rig.hip = [-3, -24];
      rig.chest = [3.5, -29];
      rig.head = [9.5, -32.5];
      rig.headRot = 0.5;
      rig.legs = [
        { foot: [-15, -17], bend: -2.4 },
        { foot: [-13, -23], bend: -3.2 }
      ];
      rig.arms = [
        { hand: [18, -41], bend: -1.8 },
        { hand: [15, -34], bend: -2.4 }
      ];
      break;
    }
    case 'abschlag': {
      rig.hip = [-1, HIP_Y];
      rig.chest = [-2, CHEST_Y];
      rig.head = [-3, HEAD_Y];
      rig.legs = [
        { foot: [-3.5, 0], bend: 1.3 },
        { foot: [9.5, -6.5], bend: -2.6 }
      ];
      rig.arms = [
        { hand: [-7, -40], bend: 2.2 },
        { hand: [5.5, -38], bend: -2.2 }
      ];
      break;
    }
    case 'fangen': {
      rig.hip = [0.5, HIP_Y + 1];
      rig.chest = [1.5, CHEST_Y + 0.6];
      rig.head = [2.2, HEAD_Y + 0.6];
      rig.legs = [
        { foot: [-3.2, 0], bend: 1.6 },
        { foot: [3.8, 0], bend: -1.6 }
      ];
      rig.arms = [
        { hand: [13, -30], bend: -1.2 },
        { hand: [12.5, -34.5], bend: -1.8 }
      ];
      break;
    }
    default: /* stand */ {
      if (isKeeper) {
        // Torwart steht breit und mit angehobenen Händen
        rig.legs = [{ foot: [-4.2, 0], bend: 1.2 }, { foot: [4.6, 0], bend: -1.2 }];
        rig.arms = [{ hand: [-9.5, -24], bend: 2.2 }, { hand: [9.8, -24], bend: -2.2 }];
      }
      break;
    }
  }

  // Körpergröße wirkt auf alle Höhen
  const hs = m.hs;
  const sy = (p) => { p[1] *= hs; return p; };
  sy(rig.hip); sy(rig.chest); sy(rig.head);
  for (const l of rig.legs) sy(l.foot);
  for (const a of rig.arms) sy(a.hand);
  rig.airborne *= hs;

  return rig;
}

/** Lokales Oberkörper-Koordinatensystem (Hüfte = Ursprung, −y = Richtung Brust). */
function torsoFrame(rig) {
  const [hx, hy] = rig.hip, [cx, cy] = rig.chest;
  const dx = cx - hx, dy = cy - hy;
  const ang = Math.atan2(dx, -dy);
  const len = Math.hypot(dx, dy) || 1;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  return {
    ang, len,
    to: (lx, ly) => [hx + lx * cos - ly * sin, hy + lx * sin + ly * cos]
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   FIGUR
   ══════════════════════════════════════════════════════════════════════════ */

/** Vereinfachte Figur für kleine Skalierungen (Spielfeld-Übersicht). */
function drawSimpleFigure(ctx, app, rig, m, kit, o) {
  const pal = skinPalette(app.skin);
  const w = m.shoulder;

  // Beine als zwei kurze Striche
  ctx.lineCap = 'round';
  ctx.strokeStyle = kit.socks;
  ctx.lineWidth = m.leg * 1.5;
  for (const l of rig.legs) {
    ctx.beginPath();
    ctx.moveTo(rig.hip[0] * 0.5, rig.hip[1] + 2);
    ctx.lineTo(l.foot[0], l.foot[1]);
    ctx.stroke();
  }

  // Rumpf
  roundRectPath(ctx, rig.chest[0] - w * 0.5, rig.chest[1] - 4, w, Math.abs(rig.hip[1] - rig.chest[1]) + 8, 2.5);
  ctx.fillStyle = kit.primary;
  ctx.fill();
  if (kit.pattern === 'stripes' || kit.pattern === 'halves') {
    ctx.fillStyle = kit.secondary;
    ctx.fillRect(rig.chest[0] - w * 0.16, rig.chest[1] - 4, w * 0.32, Math.abs(rig.hip[1] - rig.chest[1]) + 8);
  } else if (kit.pattern === 'hoops' || kit.pattern === 'chest') {
    ctx.fillStyle = kit.secondary;
    ctx.fillRect(rig.chest[0] - w * 0.5, rig.chest[1] + 1, w, 3);
  }
  if (o.outline) {
    ctx.strokeStyle = o.ink;
    ctx.lineWidth = o.lw(1.1);
    roundRectPath(ctx, rig.chest[0] - w * 0.5, rig.chest[1] - 4, w, Math.abs(rig.hip[1] - rig.chest[1]) + 8, 2.5);
    ctx.stroke();
  }

  // Kopf: Hautkreis + Haarkappe
  const hr = m.headH * 0.5;
  ellipsePath(ctx, rig.head[0], rig.head[1], hr * 0.92, hr);
  ctx.fillStyle = pal.base;
  ctx.fill();
  if (o.outline) { ctx.strokeStyle = pal.line; ctx.lineWidth = o.lw(1.1); ctx.stroke(); }
  if (app.hair !== 'glatze') {
    ctx.save();
    ellipsePath(ctx, rig.head[0], rig.head[1], hr * 0.92, hr);
    ctx.clip();
    ctx.fillStyle = app.hairColor;
    ctx.fillRect(rig.head[0] - hr, rig.head[1] - hr, hr * 2, hr * 1.15);
    ctx.restore();
  }
}

/**
 * Zeichnet eine komplette Figur. Gemeinsamer Kern für Feldspieler, Torwart
 * und Schiedsrichter.
 */
function drawFigure(ctx, player, x, y, scale, opts, kit, kind) {
  const s = Math.abs(scale) || 1;
  const app = normalizeAppearance(player && player.appearance);
  const isKeeper = kind === 'tw';
  const m = metricsFor(app);
  const pose = normalizePose(opts.pose, isKeeper);
  const rig = buildRig(pose, opts.frame, m, isKeeper, opts.gait);
  const dir = opts.dir === -1 ? -1 : 1;
  /* Blickrichtung in der Draufsicht: wer zur Kamera oder von ihr weg läuft, wird
   * schmaler. `opts.yaw` ist der Weltwinkel (0 = +x). Ohne yaw bleibt alles wie
   * bisher — rein additiv. */
  const yawSqueeze = isFinite(opts.yaw) ? clamp(Math.abs(Math.cos(opts.yaw)), 0.5, 1) : 1;
  const age = opts.age === undefined ? (player && player.age) || 26 : opts.age;
  const pal = skinPalette(app.skin);
  const outline = opts.outline !== false;
  const sleeveLong = isKeeper || kind === 'schiri';

  const o = {
    outline,
    ink: shadeColor(kit.primary, -0.72),
    legSkin: pal.base,
    lw: (units) => Math.max(units, MIN_PX_LINE / s)
  };

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';

  // ── Bodenschatten (nie gespiegelt, nie mit dem Körper gedreht)
  if (opts.shadow !== false) {
    const air = clamp(rig.airborne / 18, 0, 1);
    ctx.fillStyle = GRASS_SHADOW;
    ctx.globalAlpha = 1 - air * 0.45;
    const sw = rig.grounded ? 13 : 8.5 - air * 2.2;
    ellipsePath(ctx, dir * (rig.grounded ? -3 : 0), 0.6, sw, rig.grounded ? 3.6 : 3.1 - air * 0.7);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ── Auswahlring
  if (opts.highlight) {
    ctx.strokeStyle = opts.teamColor || '#ffd400';
    ctx.lineWidth = o.lw(1.6);
    ellipsePath(ctx, 0, 0.6, 10.5, 4.2);
    ctx.stroke();
  }

  if (s < SIMPLE_SCALE) {
    ctx.save();
    ctx.scale(dir * yawSqueeze, 1);
    drawSimpleFigure(ctx, app, rig, m, kit, o);
    ctx.restore();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.scale(dir * yawSqueeze, 1);

  const fr = torsoFrame(rig);
  const shoulderL = fr.to(-m.shoulder * 0.5, -(fr.len + 2.2));
  const shoulderR = fr.to(m.shoulder * 0.5, -(fr.len + 2.2));
  const hipL = fr.to(-m.waist * 0.42, 1.5);
  const hipR = fr.to(m.waist * 0.42, 1.5);

  // Zeichenreihenfolge von hinten nach vorn: hinteres Bein/Arm (leicht
  // abgedunkelt), vorderes Bein, Trikot, Hose (liegt über dem Trikotsaum
  // und den Oberschenkeln), vorderer Arm.
  drawLeg(ctx, hipL, rig.legs[0], m, kit, o, 0.82);
  drawArm(ctx, shoulderL, rig.arms[0], m, kit, pal, o, 0.84, sleeveLong, isKeeper);
  drawLeg(ctx, hipR, rig.legs[1], m, kit, o, 1);
  drawTorso(ctx, fr, m, kit, o);
  drawShorts(ctx, fr, m, kit, o);
  drawArm(ctx, shoulderR, rig.arms[1], m, kit, pal, o, 1, sleeveLong, isKeeper);

  // ── Hals
  const neck = fr.to(0, -(fr.len + 3.4));
  ctx.strokeStyle = pal.shade;
  ctx.lineCap = 'round';
  ctx.lineWidth = m.waist * 0.42;
  ctx.beginPath();
  ctx.moveTo(neck[0], neck[1]);
  ctx.lineTo(rig.head[0], rig.head[1] + m.headH * 0.32);
  ctx.stroke();

  // ── Kopf
  const faceDetail = s >= FACE_FULL_SCALE ? DETAIL.FULL : s >= FACE_MID_SCALE ? DETAIL.MID : DETAIL.LOW;
  ctx.save();
  ctx.translate(rig.head[0], rig.head[1]);
  if (rig.headRot) ctx.rotate(rig.headRot);
  drawFace(ctx, app, 0, 0, m.headH, {
    age,
    mood: opts.mood || rig.mood,
    club: opts.club,
    away: opts.away,
    tilt: HEAD_TILT,
    detail: faceDetail,
    outline
  });
  ctx.restore();

  ctx.restore(); // Spiegelung aufheben

  // ── Rückennummer (nie gespiegelt)
  const showNumber = opts.showNumber === undefined ? s >= NUMBER_MIN_SCALE : opts.showNumber;
  if (showNumber && player && player.number) {
    const c = fr.to(0, -(fr.len * 0.72 + 2.5));
    ctx.save();
    ctx.font = `bold ${(m.shoulder * 0.56).toFixed(1)}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const inkNum = readableInk(kit.pattern === 'plain' ? kit.primary : mixHex(kit.primary, kit.secondary, 0.4));
    ctx.lineWidth = o.lw(1.4);
    ctx.strokeStyle = inkNum === '#ffffff' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.5)';
    ctx.strokeText(String(player.number), dir * c[0], c[1]);
    ctx.fillStyle = inkNum;
    ctx.fillText(String(player.number), dir * c[0], c[1]);
    ctx.restore();
  }

  // ── Namensschild unter den Füßen
  if (opts.showName && player) {
    const label = player.shortName || player.lastName || '';
    if (label) {
      ctx.save();
      ctx.font = `bold ${Math.max(5.2, m.shoulder * 0.62)}px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = o.lw(2.4);
      ctx.strokeStyle = 'rgba(10,16,10,0.85)';
      ctx.strokeText(label, 0, 3.5);
      ctx.fillStyle = '#f4f0e2';
      ctx.fillText(label, 0, 3.5);
      ctx.restore();
    }
  }

  ctx.restore();
}

/** Ein Bein: Oberschenkel/Unterschenkel als Kurve, Stutzen, Schuh. */
function drawLeg(ctx, hip, leg, m, kit, o, dim) {
  const [ax, ay] = hip;
  const [bx, by] = leg.foot;
  const c = limbControl(ax, ay, bx, by, leg.bend);
  const skin = o.legSkin;
  const w = m.leg;

  // Bein (Haut)
  strokeLimb(ctx, ax, ay, c, bx, by, w, dimColor(skin, dim), o, 0);
  // Stutzen ab ca. 55 % der Beinlänge
  strokeLimb(ctx, ax, ay, c, bx, by, w * 1.06, dimColor(kit.socks, dim), o, 0.55);
  // Schuh
  const heel = qPoint(ax, ay, c.cx, c.cy, bx, by, 0.92);
  const ang = Math.atan2(by - heel[1], bx - heel[0]) * 0.35;
  drawShoe(ctx, bx, by, ang, w * 0.95, o);
}

/** Ein Arm: Ärmel (kurz/lang), Haut, Hand bzw. Handschuh. */
function drawArm(ctx, shoulder, arm, m, kit, pal, o, dim, longSleeve, gloves) {
  const [ax, ay] = shoulder;
  const [bx, by] = arm.hand;
  const c = limbControl(ax, ay, bx, by, arm.bend);
  const w = m.arm;

  strokeLimb(ctx, ax, ay, c, bx, by, w, dimColor(pal.base, dim), o, 0);
  // Ärmel vom Schulterpunkt aus
  strokeLimb(ctx, ax, ay, c, bx, by, w * 1.25, dimColor(kit.primary, dim), o, 0);
  // Ärmelende: kurzer Ärmel endet bei 35 %, langer bei 92 %
  const cut = longSleeve ? 0.9 : 0.34;
  const p = qPoint(ax, ay, c.cx, c.cy, bx, by, cut);
  ctx.save();
  ctx.beginPath();
  ctx.arc(p[0], p[1], w * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = dimColor(kit.secondary, dim);
  ctx.fill();
  ctx.restore();
  // ab hier wieder Haut
  strokeLimb(ctx, ax, ay, c, bx, by, w * 0.86, dimColor(pal.base, dim), o, Math.min(0.97, cut + 0.02));

  // Hand / Handschuh
  if (gloves) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, w * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = dimColor(mixHex(kit.secondary, '#f6f3ea', 0.35), dim);
    ctx.fill();
    if (o.outline) { ctx.strokeStyle = o.ink; ctx.lineWidth = o.lw(1.2); ctx.stroke(); }
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(bx, by, w * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = dimColor(pal.base, dim);
    ctx.fill();
    if (o.outline) { ctx.strokeStyle = pal.line; ctx.lineWidth = o.lw(1.0); ctx.stroke(); }
  }
}

/** Farbe für hintere Gliedmaßen leicht abdunkeln (Tiefenwirkung). */
function dimColor(hex, dim) {
  return dim >= 1 ? hex : shadeColor(hex, -(1 - dim));
}

function shortsPath(ctx, fr, m) {
  const w = m.waist;
  const p = [
    fr.to(-w * 0.62, -3.5), fr.to(w * 0.62, -3.5),
    fr.to(w * 0.78, 6.5), fr.to(w * 0.3, 6.0),
    fr.to(0, 2.5),
    fr.to(-w * 0.3, 6.0), fr.to(-w * 0.78, 6.5)
  ];
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
  ctx.closePath();
}

function drawShorts(ctx, fr, m, kit, o) {
  shortsPath(ctx, fr, m);
  ctx.fillStyle = kit.shorts;
  ctx.fill();
  if (o.outline) { ctx.strokeStyle = o.ink; ctx.lineWidth = o.lw(1.5); ctx.stroke(); }
  // Seitenstreifen
  ctx.save();
  shortsPath(ctx, fr, m);
  ctx.clip();
  const a = fr.to(-m.waist * 0.58, -3.5), b = fr.to(-m.waist * 0.7, 6.5);
  ctx.strokeStyle = kit.secondary;
  ctx.lineWidth = o.lw(1.3);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.restore();
}

function torsoPath(ctx, fr, m) {
  const sw = m.shoulder * 0.5, ww = m.waist * 0.5;
  const top = -(fr.len + 3.0);
  ctx.beginPath();
  ctx.moveTo(...fr.to(-ww, 2.5));
  ctx.lineTo(...fr.to(-ww * 1.02, -fr.len * 0.45));
  ctx.lineTo(...fr.to(-sw, top + 1.5));
  ctx.quadraticCurveTo(...fr.to(-sw * 0.92, top - 1.2), ...fr.to(-sw * 0.34, top - 1.6));
  ctx.lineTo(...fr.to(sw * 0.34, top - 1.6));
  ctx.quadraticCurveTo(...fr.to(sw * 0.92, top - 1.2), ...fr.to(sw, top + 1.5));
  ctx.lineTo(...fr.to(ww * 1.02, -fr.len * 0.45));
  ctx.lineTo(...fr.to(ww, 2.5));
  ctx.closePath();
}

function drawTorso(ctx, fr, m, kit, o) {
  torsoPath(ctx, fr, m);
  ctx.fillStyle = kit.primary;
  ctx.fill();

  // Muster in der Trikotfläche
  ctx.save();
  torsoPath(ctx, fr, m);
  ctx.clip();
  ctx.save();
  // In das Oberkörper-System drehen, damit Streifen mitkippen
  const [ox, oy] = fr.to(0, 0);
  ctx.translate(ox, oy);
  ctx.rotate(fr.ang);
  fillJerseyPattern(ctx, kit.pattern, kit, {
    x: -m.shoulder * 0.6, y: -(fr.len + 5), w: m.shoulder * 1.2, h: fr.len + 8
  });
  ctx.restore();
  // Schattenkante an der rechten Rumpfseite
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  const s1 = fr.to(m.shoulder * 0.22, -(fr.len + 4));
  const s2 = fr.to(m.waist * 0.7, 3.5);
  ctx.beginPath();
  ctx.moveTo(s1[0], s1[1]);
  ctx.lineTo(...fr.to(m.shoulder * 0.6, -(fr.len + 4)));
  ctx.lineTo(...fr.to(m.waist * 0.7, 3.5));
  ctx.lineTo(s2[0], s2[1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (o.outline) {
    torsoPath(ctx, fr, m);
    ctx.strokeStyle = o.ink;
    ctx.lineWidth = o.lw(1.7);
    ctx.stroke();
  }

  // Kragen
  const top = -(fr.len + 3.0);
  ctx.beginPath();
  ctx.moveTo(...fr.to(-m.shoulder * 0.3, top - 1.4));
  ctx.quadraticCurveTo(...fr.to(0, top + 2.4), ...fr.to(m.shoulder * 0.3, top - 1.4));
  ctx.strokeStyle = kit.secondary;
  ctx.lineWidth = o.lw(1.6);
  ctx.stroke();
}

/* ══════════════════════════════════════════════════════════════════════════
   ÖFFENTLICHE ZEICHENFUNKTIONEN
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Feldspieler im Vereinstrikot.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} player  Player-Objekt (appearance, number, shortName, age)
 * @param {number} x  Bodenpunkt X (zwischen den Füßen)
 * @param {number} y  Bodenpunkt Y
 * @param {number} scale  1 ≈ 47 px Gesamthöhe
 * @param {object} [opts]
 *   club       – Club-Objekt für die Trikotfarben
 *   away       – Auswärtstrikot
 *   pose       – 'stand'|'lauf'|'schuss'|'jubel'|'graetsche'|'parade'|'kopfball'|'liegend'
 *   dir        – 1 = nach rechts, −1 = nach links
 *   frame      – 0..1, animiert 'lauf' (und die Schussbewegung)
 *   highlight  – Auswahlring auf dem Rasen
 *   showNumber – Rückennummer (Standard ab scale ≥ 1.15)
 *   showName   – Kurzname unter der Figur
 *   teamColor  – Ersatzfarbe/Ringfarbe, falls kein club übergeben wird
 *   mood       – überschreibt den Gesichtsausdruck der Pose
 *   shadow     – false schaltet den Bodenschatten ab
 *   gait       – 0,3..1,6: Schrittamplitude der Laufpose (1 = wie bisher).
 *                Aus dem tatsächlichen Lauftempo gespeist sieht ein Trab anders
 *                aus als ein Sprint.
 *   yaw        – Blickrichtung als Weltwinkel in Radiant (0 = nach rechts). In
 *                der Draufsicht wird die Figur quer zur Kamera gestaucht
 *                (Faktor |cos(yaw)|, mindestens 0,5). Ohne yaw: keine Stauchung.
 */
export function drawPlayer(ctx, player, x, y, scale = 1, opts = {}) {
  drawFigure(ctx, player, x, y, scale, opts, kitFor(opts), 'feld');
}

/**
 * Torwart: eigene (kontrastreiche) Trikotfarbe, Handschuhe, lange Ärmel.
 * Zusätzliche Posen: 'parade', 'abschlag', 'fangen'.
 */
export function drawKeeper(ctx, player, x, y, scale = 1, opts = {}) {
  const kit = opts.kit || keeperColors(opts.club, opts.away);
  drawFigure(ctx, player, x, y, scale, opts, kit, 'tw');
}

/**
 * Schiedsrichter in Schwarz-Gelb. Ohne Player-Objekt – das Aussehen ist fest,
 * damit der Unparteiische immer gleich aussieht.
 *
 * @param {object} [opts] wie drawPlayer, zusätzlich card: 'gelb'|'rot'|null
 */
export function drawReferee(ctx, x, y, scale = 1, opts = {}) {
  const ref = {
    id: 'schiri', number: 0, shortName: 'Schiri', age: 42,
    appearance: {
      skin: 1, hair: 'kurz', hairColor: '#4a4a4a', beard: 'stoppeln',
      build: 'normal', height: 181, eyes: '#3a3a3a', accessory: 'keiner', face: 2
    }
  };
  const o2 = Object.assign({}, opts, { showNumber: false });
  drawFigure(ctx, ref, x, y, scale, o2, REF_KIT, 'schiri');

  // Karte hochhalten
  if (opts.card === 'gelb' || opts.card === 'rot') {
    const s = Math.abs(scale) || 1;
    const dir = opts.dir === -1 ? -1 : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.translate(dir * 8, -46);
    ctx.rotate(dir * 0.16);
    roundRectPath(ctx, -3.2, -5, 6.4, 9, 1);
    ctx.fillStyle = opts.card === 'gelb' ? '#f5cc12' : '#cc2222';
    ctx.fill();
    ctx.strokeStyle = '#1b1712';
    ctx.lineWidth = Math.max(0.7 / s, 0.9);
    ctx.stroke();
    ctx.restore();
  }
}

/** Trikotfarben aus opts (club/away/teamColor). */
function kitFor(opts) {
  if (opts.kit) return opts.kit;
  const kit = resolveKitColors(opts.club, opts.away);
  if (!opts.club && opts.teamColor) {
    return {
      primary: opts.teamColor,
      secondary: readableInk(opts.teamColor) === '#ffffff' ? '#f2efe6' : '#20242c',
      shorts: shadeColor(opts.teamColor, -0.35),
      socks: opts.teamColor,
      pattern: 'plain'
    };
  }
  return kit;
}

/* ══════════════════════════════════════════════════════════════════════════
   BALL
   ══════════════════════════════════════════════════════════════════════════ */

function pentagonPath(ctx, cx, cy, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i / 5) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * Klassischer Telstar-Ball mit Schatten.
 *
 * @param {number} radius Ballradius in Pixeln
 * @param {object} [opts]
 *   rotation – Drehwinkel des Musters (rad)
 *   shadowY  – Y-Koordinate des Bodens; nur dann wird ein Schatten gezeichnet
 *   height   – Höhe des Balls über dem Boden in Pixeln (skaliert den Schatten)
 */
export function drawBall(ctx, x, y, radius = 5, opts = {}) {
  const r = Math.max(0.8, radius);
  const rot = opts.rotation || 0;
  const h = Math.max(0, opts.height || 0);

  if (opts.shadowY !== undefined && opts.shadowY !== null) {
    const t = clamp(h / (r * 14), 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.34 * (1 - t * 0.55);
    ctx.fillStyle = '#0e200c';
    ellipsePath(ctx, x, opts.shadowY, r * (1.15 - t * 0.35), r * (0.52 - t * 0.16));
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fbfaf5';
  ctx.fill();

  if (r >= 2.6) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#1b1a18';
    // Mittleres Fünfeck
    pentagonPath(ctx, x, y, r * 0.42, rot);
    ctx.fill();
    // Fünf Randflecken
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * Math.PI * 2 + Math.PI / 5;
      const px = x + Math.cos(a) * r * 0.95;
      const py = y + Math.sin(a) * r * 0.95;
      pentagonPath(ctx, px, py, r * 0.36, rot + a);
      ctx.fill();
    }
    // Nähte
    ctx.strokeStyle = 'rgba(30,28,25,0.55)';
    ctx.lineWidth = Math.max(0.5, r * 0.08);
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.42, y + Math.sin(a) * r * 0.42);
      ctx.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92);
      ctx.stroke();
    }
    ctx.restore();
    // Glanzlicht
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ellipsePath(ctx, x - r * 0.34, y - r * 0.38, r * 0.22, r * 0.16);
    ctx.fill();
  }

  ctx.strokeStyle = '#1a1815';
  ctx.lineWidth = Math.max(0.7, r * 0.16);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
