/**
 * FREISTOSS – interaktives Minispiel.
 *
 * Vertrag: docs/CONTRACTS.md §9 (interactive/*.js) und §6.1 (KeyMoment / resolution).
 *
 * Drei-Phasen-Eingabe, wie es sich für einen ruhenden Ball gehört:
 *   1. RICHTUNG – ein Marker wandert über die Torebene. Er zeigt die ABSCHUSSRICHTUNG
 *                 (nicht das Endziel!) – der Effet biegt den Ball später noch.
 *   2. HÖHE     – senkrechter Balken. Zu flach = die Mauer köpft ihn weg, zu hoch =
 *                 die Tribüne freut sich. Das sichere Fenster wird umso deutlicher
 *                 angezeigt, je besser die Standards des Schützen sind
 *                 (Freistoßspezialisten sehen es komplett).
 *   3. EFFET    – waagerechter Balken von „Innenrist links" bis „Außenrist rechts".
 *                 Der Effet krümmt die Bahn sichtbar um die Mauer herum; während der
 *                 ersten Flugphase darf man mit der Maus noch minimal nachziehen.
 *
 * Physik (bewusst einfach, dafür lesbar und gut zu balancieren):
 *   u(t) = lerp(ballU, aimU, t) + curve * t²        (Magnus-Effekt: Ablage wächst mit t²)
 *   h(t) = h0 + vz·(T·t) − ½g(T·t)² − dip·t³        (dip = Topspin, macht den Ball „fallend")
 *   Endpunkt auf der Torlinie = aimU + curve.
 * `dip` hängt an Technik/Standards/Schuss: Nur wer den Ball trifft, bekommt ihn über
 * die Mauer UND unter die Latte. Genau das ist der spürbare Skill-Unterschied.
 *
 * Kamera: schräg-seitliche Sicht hinter dem Schützen. Die Kamera steht auf der
 * Ball-Tor-Achse, dadurch erscheint das Tor perspektivisch gedreht (naher Pfosten
 * größer) – der klassische Freistoß-Blickwinkel.
 *
 * Kein Math.random (immer host.rng), kein Date.now (performance.now nur für Animation).
 */

import { clamp, lerp } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { DEFAULT_COLORS, TRAITS } from '../core/constants.js';
import { getClub } from '../data/clubs.js';

/* ══════════════════════════════════════════════════════════════════════════
   BALANCING – alles Wichtige steht hier oben.
   ══════════════════════════════════════════════════════════════════════════ */

const CANVAS_W = 960, CANVAS_H = 600;

/* --- Geometrie (Meter) --- */
const GOAL_HALF_W = 3.66;
const GOAL_H = 2.44;
const POST_R = 0.06;
const BALL_R = 0.11;
const BALL_H0 = 0.11;
const WALL_DIST = 9.15;        // Vorschriftsmäßiger Mauerabstand
const WALL_MAN_W = 0.52;       // Schulterbreite eines Mauerspielers
const WALL_MAN_H = 1.85;
const WALL_JUMP = 0.42;        // Sprunghöhe der Mauer
const WALL_ARM = 0.16;         // seitlicher Sicherheitszuschlag (Arme)
const DIST_MIN = 16, DIST_MAX = 32;
const BALL_SPEED = 21.0;       // m/s – ein Freistoß ist kein Vollspannschuss
const G = 9.81;

/* --- Kamera --- */
const CAM_BACK = 13.0;
const CAM_SIDE = 1.35;         // seitlicher Versatz → schräge Ansicht
const CAM_H = 2.30;
const CAM_FOCAL = 1750;
const HORIZON_Y = 182;

/* --- Eingabe-Balken --- */
const AIM_SPAN_NEAR = 5.0;     // seitliche Auslenkung des Richtungsmarkers bei 16 m
const AIM_SPAN_FAR = 8.2;      // … bei 32 m  (größere Distanz = kleineres Zielfenster)
const VZ_MIN = 4.0, VZ_MAX = 11.0;   // vertikale Abschussgeschwindigkeit m/s
const CURVE_MIN = 0.85, CURVE_MAX = 3.40;  // maximale Gesamtkrümmung in Metern
const STEER_MAX = 0.42;        // Nachziehen mit der Maus während des Flugs
const STEER_PER_PX = 0.0032;
const STEER_UNTIL = 0.34;      // nur in den ersten 34 % des Flugs

/* --- Dip (Topspin) --- */
const DIP_MIN = 0.55, DIP_MAX = 2.35;

/* --- Zeiten (ms) --- */
const INTRO_MS = 950;
const DIR_PERIOD_MS = 1500;
const DIR_LIMIT_MS = 4500;
const HGT_PERIOD_MS = 1250;
const HGT_LIMIT_MS = 3800;
const CRV_PERIOD_MS = 1350;
const CRV_LIMIT_MS = 3200;
const RUNUP_MS = 480;
const RESULT_MS = 1700;
const HARD_TIMEOUT_MS = 20000;

/* --- Torwart --- */
const KEEPER_START_U = 1.55;       // Startposition auf der offenen Torhälfte
const KEEPER_REACT_LATE = 0.56;    // Reaktionsbeginn (Anteil der Flugzeit) bei Reflexe 0
const KEEPER_REACT_EARLY = 0.33;   // … bei Reflexe 100
const KEEPER_SPEED_BASE = 3.1;     // m/s
const KEEPER_SPEED_PER = 2.7;      // + reflexe/100 * dieser Wert
const KEEPER_REACH = 1.05;         // Armreichweite um die Endposition
const KEEPER_HIGH_MALUS = 0.55;    // Reichweitenverlust in den oberen Ecken
const CURVE_CONFUSION = 0.62;      // wie stark Effet den Torwart täuscht
const KEEPER_NOISE = 0.30;
const KEEPER_SAVE_CEIL = 0.95;

/* --- Bewertung --- */
const Q_W_PLACEMENT = 0.40, Q_W_LOFT = 0.34, Q_W_CURVE = 0.26;
const XG_SPAN = 0.34;
const XG_MIN = -0.10, XG_MAX = 0.40;

/* --- Trait / Attribute --- */
const TRAIT_SPEC_SKILL = 0.14;     // 'freistossspezialist'
const TRAIT_SPEC_CURVE = 0.45;     // zusätzliche Meter Krümmung
const WINDOW_HINT_FROM = 45;       // ab diesem Standards-Wert wird das Fenster sichtbar
const WINDOW_HINT_FULL = 85;

/* --- Farben (Stil-Leitfaden §14) --- */
const C = {
  grassA: '#2f7d32', grassB: '#276b2a',
  line: '#f2f6ef', crowdBg: '#1b2430', banden: '#123a6b',
  wood: '#8b5a2b', beige: '#e8d9b0', paper: '#f2e8cf',
  red: '#c1272d', blue: '#1c4f8f', gold: '#f2c53d', green: '#3fa64a',
  ink: '#14181e', shadow: 'rgba(0,0,0,0.35)',
  net: 'rgba(245,248,255,0.55)', post: '#f4f6f8'
};

const SKIN_TONES = ['#f2d3b3', '#e6bd94', '#d09a66', '#b57a4b', '#8d5524', '#5c3317'];

/** Eigene Figuren-Routinen: Mauersprung/Hechte müssen exakt zur Projektion passen. */
const USE_HOST_PLAYER = false;
const HOST_PLAYER_SCALE_UNIT = 96;

/* ══════════════════════════════════════════════════════════════════════════
   HELFER
   ══════════════════════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;
const clamp01 = (v) => clamp(v, 0, 1);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;

function att(player, key, fallback = 50) {
  const a = player && player.attributes;
  const v = a ? a[key] : undefined;
  return typeof v === 'number' ? v : fallback;
}

function hasTrait(player, key) {
  return !!(player && Array.isArray(player.traits) && player.traits.includes(key));
}

function kitOf(player) {
  const club = player && player.clubId ? getClub(player.clubId) : null;
  const col = (club && club.colors) || DEFAULT_COLORS;
  return {
    primary: col.primary || DEFAULT_COLORS.primary,
    secondary: col.secondary || DEFAULT_COLORS.secondary,
    accent: col.accent || DEFAULT_COLORS.accent,
    shorts: (club && club.kit && club.kit.shorts) || col.secondary || '#ffffff',
    socks: (club && club.kit && club.kit.socks) || col.primary || '#222222'
  };
}

function keeperKit() {
  return { primary: '#3aa04a', secondary: '#12331a', accent: '#f2c53d', shorts: '#12331a', socks: '#3aa04a' };
}

/**
 * Kamera auf der Ball-Tor-Achse.
 * Welt: u = seitlich (0 = Tormitte), v = Entfernung zur Torlinie, h = Höhe.
 * Kameraframe: a = Tiefe entlang der Achse, b = seitlich dazu.
 */
function makeCamera(ballU, ballV, w, h) {
  const D = Math.max(6, Math.hypot(ballU, ballV));
  const cosP = ballV / D, sinP = ballU / D;
  const camA = D + CAM_BACK, camB = CAM_SIDE;
  const cx = w * 0.52;
  const cy = HORIZON_Y * (h / CANVAS_H);
  function toCam(u, v) { return { a: v * cosP + u * sinP, b: u * cosP - v * sinP }; }
  return {
    D, cosP, sinP, cx, cy, camA, camB, toCam,
    project(u, v, ht) {
      const c = toCam(u, v);
      const depth = Math.max(0.6, camA - c.a);
      const k = CAM_FOCAL / depth;
      return { x: cx + (c.b - camB) * k, y: cy + (CAM_H - ht) * k, k, depth };
    },
    scaleAt(u, v) {
      const c = toCam(u, v);
      return CAM_FOCAL / Math.max(0.6, camA - c.a);
    }
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   SZENE
   ══════════════════════════════════════════════════════════════════════════ */

function drawStands(ctx, cam, w, crowd, tSec) {
  const horizon = cam.cy;
  ctx.fillStyle = C.crowdBg;
  ctx.fillRect(0, 0, w, horizon + 6);
  ctx.fillStyle = '#232f3d';
  ctx.fillRect(0, horizon - 78, w, 78);
  ctx.fillStyle = '#1e2836';
  ctx.fillRect(0, horizon - 124, w, 46);
  for (let i = 0; i < crowd.length; i++) {
    const p = crowd[i];
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x, p.y + Math.sin(tSec * 1.7 + p.ph) * 1.3, p.s, p.s);
  }
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, horizon);
  ctx.fillStyle = C.banden;
  ctx.fillRect(0, horizon - 4, w, 16);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let x = 0; x < w; x += 104) ctx.fillRect(x + 10, horizon, 44, 7);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 3;
  ctx.strokeRect(-2, horizon - 4, w + 4, 16);
}

/** Polygon aus Weltpunkten [[u,v,h], …] füllen/zeichnen. */
function poly(ctx, cam, pts, fill, stroke, lw) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = cam.project(pts[i][0], pts[i][1], pts[i][2] || 0);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
}

function drawPitch(ctx, cam, w, h) {
  ctx.fillStyle = C.grassA;
  ctx.fillRect(0, cam.cy, w, h - cam.cy);
  // Rasenstreifen parallel zur Torlinie (perspektivisch verzerrt)
  for (let v = -4; v < 42; v += 4) {
    poly(ctx, cam, [[-46, v], [46, v], [46, v + 4], [-46, v + 4]],
      (Math.floor(v / 4) % 2 === 0) ? C.grassB : C.grassA, null, 0);
  }
  // Torlinie, Strafraum, Torraum
  poly(ctx, cam, [[-40, 0], [40, 0], [40, 0.12], [-40, 0.12]], C.line, null, 0);
  ctx.lineJoin = 'round';
  for (const [depth, half] of [[16.5, 20.16], [5.5, 9.16]]) {
    poly(ctx, cam, [[-half, 0], [-half, depth], [half, depth], [half, 0]], null, C.line, 3);
  }
  // Elfmeterpunkt
  const sp = cam.project(0, 11, 0);
  ctx.fillStyle = C.line;
  ctx.beginPath(); ctx.ellipse(sp.x, sp.y, 6, 2.5, 0, 0, TAU); ctx.fill();
}

function drawGoal(ctx, cam, netHit) {
  const backV = -2.1;
  const P = (u, v, hh) => cam.project(u, v, hh);
  const fl = P(-GOAL_HALF_W, 0, GOAL_H), fr = P(GOAL_HALF_W, 0, GOAL_H);
  const bl = P(-GOAL_HALF_W, 0, 0), br = P(GOAL_HALF_W, 0, 0);
  const kl = P(-GOAL_HALF_W, backV, GOAL_H), kr = P(GOAL_HALF_W, backV, GOAL_H);
  const nl = P(-GOAL_HALF_W, backV, 0), nr = P(GOAL_HALF_W, backV, 0);

  ctx.fillStyle = 'rgba(20,28,36,0.30)';
  ctx.beginPath();
  ctx.moveTo(kl.x, kl.y); ctx.lineTo(kr.x, kr.y); ctx.lineTo(nr.x, nr.y); ctx.lineTo(nl.x, nl.y);
  ctx.closePath(); ctx.fill();

  ctx.strokeStyle = C.net; ctx.lineWidth = 1;
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    ctx.beginPath();
    ctx.moveTo(lerp(kl.x, kr.x, t), lerp(kl.y, kr.y, t));
    ctx.lineTo(lerp(nl.x, nr.x, t), lerp(nl.y, nr.y, t));
    ctx.stroke();
  }
  for (let j = 0; j <= 8; j++) {
    const t = j / 8;
    ctx.beginPath();
    ctx.moveTo(lerp(kl.x, nl.x, t), lerp(kl.y, nl.y, t));
    ctx.lineTo(lerp(kr.x, nr.x, t), lerp(kr.y, nr.y, t));
    ctx.stroke();
  }
  if (netHit && netHit.a > 0) {
    const p = cam.project(clamp(netHit.u, -GOAL_HALF_W + 0.2, GOAL_HALF_W - 0.2), backV + 0.3,
      clamp(netHit.h, 0.15, GOAL_H - 0.15));
    ctx.save();
    ctx.globalAlpha = clamp01(netHit.a);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 30 * netHit.a, 21 * netHit.a, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
    for (let r = 1; r <= 3; r++) {
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 10 * r * netHit.a, 7 * r * netHit.a, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(245,248,255,0.35)';
  for (let j = 0; j <= 4; j++) {
    const t = j / 4;
    ctx.beginPath(); ctx.moveTo(fl.x, lerp(fl.y, bl.y, t)); ctx.lineTo(kl.x, lerp(kl.y, nl.y, t)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fr.x, lerp(fr.y, br.y, t)); ctx.lineTo(kr.x, lerp(kr.y, nr.y, t)); ctx.stroke();
  }

  const postW = Math.max(4, Math.abs(bl.x - cam.project(-GOAL_HALF_W - 0.10, 0, 0).x));
  const bar = (a, b) => {
    ctx.strokeStyle = C.ink; ctx.lineWidth = postW + 4;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = C.post; ctx.lineWidth = postW;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  };
  bar(kl, kr); bar(fl, kl); bar(fr, kr);
  bar(bl, fl); bar(br, fr); bar(fl, fr);
}

function drawBall(ctx, cam, u, v, h, spin) {
  const sh = cam.project(u, v, 0);
  const k = cam.scaleAt(u, v);
  ctx.fillStyle = C.shadow;
  ctx.beginPath(); ctx.ellipse(sh.x, sh.y, BALL_R * k * 1.5, BALL_R * k * 0.5, 0, 0, TAU); ctx.fill();
  const p = cam.project(u, v, h);
  const r = Math.max(3, BALL_R * k);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(spin);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.34, 0, TAU); ctx.fill();
  for (let i = 0; i < 5; i++) {
    const a = i * TAU / 5;
    ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72, r * 0.2, 0, TAU); ctx.fill();
  }
  ctx.lineWidth = Math.max(1.5, r * 0.18);
  ctx.strokeStyle = C.ink;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  ctx.restore();
}

/**
 * Retro-Figur (Feldspieler). pose: 'stand' | 'lauf' | 'schuss' | 'mauer'
 * jump = zusätzliche Höhe in Metern (Mauersprung).
 */
function drawFigure(ctx, host, player, cam, u, v, opts) {
  const o = opts || {};
  if (USE_HOST_PLAYER && typeof host.drawPlayer === 'function' && (o.pose === 'stand' || o.pose === 'lauf')) {
    try {
      const k = cam.scaleAt(u, v);
      const p = cam.project(u, v, 0);
      host.drawPlayer(ctx, player, p.x, p.y, (1.82 * k) / HOST_PLAYER_SCALE_UNIT,
        { pose: o.pose, dir: o.dir || 1, frame: o.frame || 0 });
      return;
    } catch (e) { /* Fallback unten */ }
  }
  const kit = o.kit || kitOf(player);
  const k = cam.scaleAt(u, v);
  const jump = o.jump || 0;
  const foot = cam.project(u, v, jump);
  const bodyH = (o.height || 1.82) * k;
  const w = bodyH * 0.30;
  const swing = o.pose === 'lauf' ? Math.sin((o.frame || 0) * TAU) : (o.pose === 'schuss' ? 1 : 0);
  const armUp = o.pose === 'mauer' ? 1 : 0;

  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  const gr = cam.project(u, v, 0);
  ctx.fillStyle = C.shadow;
  ctx.beginPath(); ctx.ellipse(gr.x, gr.y, w * 0.85, w * 0.26, 0, 0, TAU); ctx.fill();

  ctx.translate(foot.x, foot.y);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.6, bodyH * 0.028);
  ctx.strokeStyle = C.ink;

  const legH = bodyH * 0.46, legW = w * 0.34;
  const leg = (dx, rot) => {
    ctx.save(); ctx.translate(dx, -legH); ctx.rotate(rot);
    ctx.fillStyle = kit.socks;
    ctx.beginPath(); ctx.rect(-legW / 2, 0, legW, legH); ctx.fill(); ctx.stroke();
    ctx.restore();
  };
  leg(-w * 0.28, -swing * 0.5); leg(w * 0.28, swing * 0.7);

  ctx.fillStyle = kit.shorts;
  ctx.beginPath(); ctx.rect(-w * 0.55, -legH - bodyH * 0.17, w * 1.1, bodyH * 0.19); ctx.fill(); ctx.stroke();

  const torsoY = -legH - bodyH * 0.17;
  ctx.fillStyle = kit.primary;
  ctx.beginPath(); ctx.rect(-w * 0.58, torsoY - bodyH * 0.34, w * 1.16, bodyH * 0.35); ctx.fill(); ctx.stroke();
  if (o.stripe) {
    ctx.fillStyle = kit.secondary;
    ctx.beginPath(); ctx.rect(-w * 0.16, torsoY - bodyH * 0.34, w * 0.3, bodyH * 0.35); ctx.fill();
  }

  const armH = bodyH * 0.30, armW = w * 0.24;
  const arm = (dx, rot) => {
    ctx.save(); ctx.translate(dx, torsoY - bodyH * 0.31); ctx.rotate(rot);
    ctx.fillStyle = kit.primary;
    ctx.beginPath(); ctx.rect(-armW / 2, 0, armW, armH); ctx.fill(); ctx.stroke();
    ctx.restore();
  };
  // In der Mauer: Arme vor dem Schritt bzw. schützend vors Gesicht
  arm(-w * 0.68, armUp ? 2.5 : swing * 0.6 - 0.15);
  arm(w * 0.68, armUp ? -2.5 : -swing * 0.6 + 0.15);

  const headR = bodyH * 0.105;
  const app = (player && player.appearance) || {};
  ctx.fillStyle = SKIN_TONES[clamp(app.skin | 0, 0, 5)] || '#e6bd94';
  ctx.beginPath(); ctx.arc(0, torsoY - bodyH * 0.36 - headR * 0.6, headR, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = app.hairColor || '#2b1d14';
  ctx.beginPath();
  ctx.arc(0, torsoY - bodyH * 0.36 - headR * 0.75, headR * 0.98, Math.PI, TAU);
  ctx.fill();
  ctx.restore();
}

/** Torwart mit Hechtsprung: dive = 0..1, side = -1|1. */
function drawKeeper(ctx, player, cam, u, dive, side, high) {
  const kit = keeperKit();
  const v = 0.4;
  const k = cam.scaleAt(u, v);
  const bodyH = 1.88 * k, w = bodyH * 0.32;
  const foot = cam.project(u, v, 0);
  const rot = side * dive * 1.1;
  const lift = dive * (high ? 0.8 : 0.28) * k;

  ctx.save();
  ctx.fillStyle = C.shadow;
  ctx.beginPath(); ctx.ellipse(foot.x, foot.y, w * 1.05, w * 0.28, 0, 0, TAU); ctx.fill();
  ctx.translate(foot.x, foot.y - lift);
  ctx.rotate(rot);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.8, bodyH * 0.03);
  ctx.strokeStyle = C.ink;

  const legH = bodyH * 0.45, legW = w * 0.32;
  for (const s of [-1, 1]) {
    ctx.save(); ctx.translate(s * w * 0.28, -legH); ctx.rotate(s * dive * 0.45);
    ctx.fillStyle = kit.socks;
    ctx.beginPath(); ctx.rect(-legW / 2, 0, legW, legH); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = kit.shorts;
  ctx.beginPath(); ctx.rect(-w * 0.55, -legH - bodyH * 0.18, w * 1.1, bodyH * 0.2); ctx.fill(); ctx.stroke();
  const torsoY = -legH - bodyH * 0.18;
  ctx.fillStyle = kit.primary;
  ctx.beginPath(); ctx.rect(-w * 0.6, torsoY - bodyH * 0.33, w * 1.2, bodyH * 0.34); ctx.fill(); ctx.stroke();

  const armH = bodyH * (0.30 + dive * 0.16), armW = w * 0.26;
  for (const a of [{ dx: -w * 0.72, r: -0.3 - dive * 1.0 }, { dx: w * 0.72, r: 0.3 + dive * 1.0 }]) {
    ctx.save(); ctx.translate(a.dx, torsoY - bodyH * 0.29); ctx.rotate(a.r);
    ctx.fillStyle = kit.primary;
    ctx.beginPath(); ctx.rect(-armW / 2, 0, armW, armH); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.gold;
    ctx.beginPath(); ctx.rect(-armW * 0.7, armH - armW * 0.55, armW * 1.4, armW); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  const headR = bodyH * 0.105;
  const app = (player && player.appearance) || {};
  ctx.fillStyle = SKIN_TONES[clamp(app.skin | 0, 0, 5)] || '#e6bd94';
  ctx.beginPath(); ctx.arc(0, torsoY - bodyH * 0.35 - headR * 0.55, headR, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════════════════
   HUD
   ══════════════════════════════════════════════════════════════════════════ */

function panel(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill || C.beige;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + 1, y + h - 1); ctx.lineTo(x + 1, y + 1); ctx.lineTo(x + w - 1, y + 1); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.moveTo(x + w - 1, y + 1); ctx.lineTo(x + w - 1, y + h - 1); ctx.lineTo(x + 1, y + h - 1); ctx.stroke();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

function text(ctx, s, x, y, opts = {}) {
  ctx.save();
  ctx.font = `${opts.bold ? 'bold ' : ''}${opts.size || 14}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = opts.align || 'left';
  ctx.textBaseline = opts.baseline || 'middle';
  if (opts.shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(s, x + (opts.shadowOff || 2), y + (opts.shadowOff || 2));
  }
  ctx.fillStyle = opts.color || C.ink;
  ctx.fillText(s, x, y);
  ctx.restore();
}

function drawHud(ctx, w, info) {
  panel(ctx, 0, 0, w, 64, C.paper);
  const nr = info.actor.number ? `#${info.actor.number} ` : '';
  text(ctx, `${nr}${info.actor.shortName || info.actor.lastName || 'Schütze'}`, 14, 20, { bold: true, size: 19 });
  text(ctx, `${info.posName} · ${info.footName} · Standards ${info.std} · Technik ${info.tec}`, 14, 44,
    { size: 13, color: '#4a4034' });
  text(ctx, `${info.minute}. Minute · ${info.score}`, w / 2, 20, { bold: true, size: 19, align: 'center' });
  text(ctx, `${info.competition} · ${info.dist} m · Mauer: ${info.wall}`, w / 2, 44,
    { size: 13, align: 'center', color: '#4a4034' });
  text(ctx, `Schwierigkeit: ${info.difficultyName}`, w - 14, 20, { bold: true, size: 15, align: 'right', color: C.red });
  text(ctx, `Torwart: ${info.keeperName} (Reflexe ${info.keeperReflex})`, w - 14, 44,
    { size: 13, align: 'right', color: '#4a4034' });

  panel(ctx, 0, 64, w, 30, C.wood);
  text(ctx, info.hint, w / 2, 79, { bold: true, size: 15, align: 'center', color: C.beige });
  if (info.badge) text(ctx, info.badge, 14, 79, { bold: true, size: 14, color: C.gold });
  if (info.timer !== null && info.timer !== undefined) {
    const bw = 120;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(w - bw - 14, 72, bw, 14);
    ctx.fillStyle = info.timer < 0.3 ? C.red : C.gold;
    ctx.fillRect(w - bw - 14, 72, bw * clamp01(info.timer), 14);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
    ctx.strokeRect(w - bw - 14, 72, bw, 14);
  }
}

/** Waagerechter Balken mit Marker (Richtung / Effet). */
function drawHBar(ctx, x, y, w, h, marker, label, opts = {}) {
  panel(ctx, x - 8, y - 28, w + 16, h + 40, C.wood);
  text(ctx, label, x + w / 2, y - 15, { bold: true, size: 13, align: 'center', color: C.gold });
  ctx.fillStyle = '#2a2118';
  ctx.fillRect(x, y, w, h);
  if (opts.center) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + w / 2 - 2, y, 4, h);
  }
  if (opts.zone) {
    ctx.save();
    ctx.globalAlpha = opts.zoneAlpha === undefined ? 1 : opts.zoneAlpha;
    ctx.fillStyle = C.green;
    ctx.fillRect(x + w * opts.zone[0], y, w * (opts.zone[1] - opts.zone[0]), h);
    ctx.restore();
  }
  const mx = x + w * clamp01(marker);
  ctx.fillStyle = C.red;
  ctx.fillRect(mx - 3, y - 6, 6, h + 12);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  ctx.strokeRect(mx - 3, y - 6, 6, h + 12);
  ctx.strokeRect(x, y, w, h);
  if (opts.left) text(ctx, opts.left, x + 2, y + h + 14, { size: 12, color: C.beige });
  if (opts.right) text(ctx, opts.right, x + w - 2, y + h + 14, { size: 12, color: C.beige, align: 'right' });
}

/** Senkrechter Höhenbalken. */
function drawVBar(ctx, x, y, w, h, value, label, zone, zoneAlpha) {
  panel(ctx, x - 8, y - 28, w + 16, h + 38, C.wood);
  text(ctx, label, x + w / 2, y - 15, { bold: true, size: 13, align: 'center', color: C.gold });
  ctx.fillStyle = '#2a2118';
  ctx.fillRect(x, y, w, h);
  if (zone && zoneAlpha > 0.02) {
    ctx.save();
    ctx.globalAlpha = zoneAlpha;
    ctx.fillStyle = C.green;
    ctx.fillRect(x, y + h * (1 - zone[1]), w, h * (zone[1] - zone[0]));
    ctx.restore();
  }
  const my = y + h * (1 - clamp01(value));
  ctx.fillStyle = C.red;
  ctx.fillRect(x - 6, my - 3, w + 12, 6);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  ctx.strokeRect(x - 6, my - 3, w + 12, 6);
  ctx.strokeRect(x, y, w, h);
  text(ctx, 'LATTE', x + w / 2, y - 2, { size: 11, align: 'center', color: C.beige });
  text(ctx, 'MAUER', x + w / 2, y + h + 12, { size: 11, align: 'center', color: C.beige });
}

function drawBanner(ctx, w, h, title, sub, color) {
  const bw = 600, bh = 120;
  const x = (w - bw) / 2, y = h * 0.33;
  ctx.save(); ctx.globalAlpha = 0.92;
  panel(ctx, x, y, bw, bh, color);
  ctx.restore();
  text(ctx, title, w / 2, y + 44, { bold: true, size: 44, align: 'center', color: '#ffffff', shadow: true, shadowOff: 3 });
  text(ctx, sub, w / 2, y + 92, { bold: true, size: 17, align: 'center', color: '#ffffff', shadow: true });
}

/* ══════════════════════════════════════════════════════════════════════════
   FLUGBAHN & AUFLÖSUNG
   ══════════════════════════════════════════════════════════════════════════ */

/** Fähigkeit des Schützen 0..1 – steuert Krümmung, Dip und Balkentempo. */
function shooterSkill(actor) {
  const s = (att(actor, 'standards') * 0.42 + att(actor, 'technik') * 0.30
    + att(actor, 'schuss') * 0.18 + att(actor, 'nervenstaerke') * 0.10) / 100;
  return clamp01(s + (hasTrait(actor, 'freistossspezialist') ? TRAIT_SPEC_SKILL : 0));
}

/**
 * Baut das komplette Flugmodell für diesen Freistoß.
 * Alles, was die Physik braucht, hängt hier an einem Objekt – das macht
 * Balancing und Debugging einfach.
 */
function makeFlight(ballU, ballV, D, skill) {
  const T = D / BALL_SPEED;                    // Flugzeit in Sekunden
  const tWall = clamp(WALL_DIST / D, 0.12, 0.72);
  const dip = lerp(DIP_MIN, DIP_MAX, skill);
  return {
    T, tWall, dip, D, ballU, ballV,
    /** Höhe zum Zeitpunkt t (0..1) bei vertikaler Abschussgeschwindigkeit vz. */
    heightAt(t, vz) {
      const s = T * t;
      return BALL_H0 + vz * s - 0.5 * G * s * s - dip * t * t * t;
    },
    /** Seitliche Position: Abschussrichtung + Effet (wächst quadratisch). */
    sideAt(t, aimU, curve) {
      return lerp(ballU, aimU, t) + curve * t * t;
    },
    vAt(t) { return ballV * (1 - t); }
  };
}

/** Mauergeometrie in Weltkoordinaten. */
function makeWall(ballU, ballV, D, count, foot) {
  const fw = clamp(WALL_DIST / D, 0.12, 0.72);
  // Nächstgelegener Pfosten: der auf der Ballseite. Bei zentralen Freistößen
  // stellt der Torwart die Mauer auf die „natürliche" Schussseite des Schützen.
  let sign = ballU > 0.8 ? 1 : ballU < -0.8 ? -1 : (foot === 'links' ? -1 : 1);
  const nearPostU = sign * GOAL_HALF_W;
  const edge = ballU + (nearPostU - ballU) * fw;      // äußere Kante der Mauer
  const width = count * WALL_MAN_W;
  const inner = edge - sign * width;
  return {
    v: ballV * (1 - fw), t: fw, sign, count,
    uMin: Math.min(edge, inner), uMax: Math.max(edge, inner),
    /** Mittelpunkt des i-ten Mauerspielers. */
    manU(i) { return edge - sign * (WALL_MAN_W * (i + 0.5)); }
  };
}

/**
 * Sicheres Höhenfenster (über die Mauer, unter die Latte) als normierter
 * Bereich 0..1 des Höhenbalkens – Grundlage für den Skill-Hinweis im HUD.
 */
function safeLoftWindow(flight, wallTopH) {
  let lo = null, hi = null;
  const STEPS = 80;
  for (let i = 0; i <= STEPS; i++) {
    const n = i / STEPS;
    const vz = lerp(VZ_MIN, VZ_MAX, n);
    const hWall = flight.heightAt(flight.tWall, vz);
    const hGoal = flight.heightAt(1, vz);
    const ok = hWall > wallTopH + 0.12 && hGoal < GOAL_H - 0.14 && hGoal > 0.12;
    if (ok) { if (lo === null) lo = n; hi = n; }
  }
  return lo === null ? null : [lo, hi];
}

/**
 * Torwart-Plan: Wann setzt er sich in Bewegung, wohin, wie weit kommt er?
 * Effet täuscht ihn – je stärker die Krümmung, desto größer sein Fehler.
 */
function keeperPlan(rng, keeper, flight, endU, curve, startU, diff) {
  const reflex = att(keeper, 'reflexe', 55);
  const skill = clamp01((reflex * 0.6 + att(keeper, 'stellungsspiel', 55) * 0.25
    + att(keeper, 'sprungkraft', 55) * 0.15) / 100
    + (hasTrait(keeper, 'torwartlegende') ? 0.08 : 0));
  const reactT = lerp(KEEPER_REACT_LATE, KEEPER_REACT_EARLY, reflex / 100);
  const travelTime = flight.T * (1 - reactT);
  const speed = (KEEPER_SPEED_BASE + (reflex / 100) * KEEPER_SPEED_PER) * (0.85 + 0.25 * diff);
  const maxTravel = speed * travelTime;

  const predErr = curve * CURVE_CONFUSION * (1 - skill * 0.75) + rng.gauss(0, KEEPER_NOISE);
  const predU = endU + predErr;
  const targetU = clamp(predU, startU - maxTravel, startU + maxTravel);
  return { reactT, targetU, maxTravel, skill, side: targetU >= startU ? 1 : -1 };
}

/** Ausführungsgüte 0..1 aus Platzierung, Höhenfenster und Effet-Nutzung. */
function computeQuality(endU, endH, curve, hWall, wallTopH, blocked) {
  // Platzierung: Ecken zählen, Mitte nicht.
  const cU = clamp01((Math.abs(endU) - 0.7) / (GOAL_HALF_W - 1.0));
  const cH = clamp01((endH - 0.25) / 1.7);
  let placement = clamp01(cU * 0.62 + cH * 0.38);
  if (Math.abs(endU) > GOAL_HALF_W + 0.35 || endH > GOAL_H + 0.35) placement *= 0.30;

  // Höhe: knapp über die Mauer ist die Kunst, weit drüber ist Glück.
  let loft;
  if (blocked) loft = 0.05;
  else {
    const over = hWall - wallTopH;
    loft = clamp01(1 - Math.abs(over - 0.35) / 1.1);
    if (endH > GOAL_H) loft *= 0.35;
  }

  // Effet: belohnt wird, wer den Ball um die Mauer herum zieht.
  const passedOutside = hWall <= wallTopH && !blocked;   // seitlich vorbei
  const curveUse = clamp01(Math.abs(curve) / CURVE_MAX);
  const curveQ = blocked ? 0.05 : clamp01((passedOutside ? 0.55 : 0.30) + curveUse * 0.55);

  return clamp(Q_W_PLACEMENT * placement + Q_W_LOFT * loft + Q_W_CURVE * curveQ, 0.02, 1);
}

const RESULT_TEXT = {
  tor: { title: 'TOR!', color: '#2f7d32', sub: 'Traumtor! Der Ball senkt sich unhaltbar ins Netz.' },
  parade: { title: 'GEHALTEN!', color: '#1c4f8f', sub: 'Der Keeper fliegt und kratzt ihn aus dem Winkel.' },
  geblockt: { title: 'MAUER!', color: '#8b5a2b', sub: 'Abgeblockt – die Mauer stand goldrichtig.' },
  daneben: { title: 'DANEBEN!', color: '#c1272d', sub: 'Drüber und vorbei. Die Kurve war zu großzügig.' },
  latte: { title: 'LATTE!', color: '#8b5a2b', sub: 'Aluminium! Ein Zentimeter tiefer und er wäre drin.' },
  pfosten: { title: 'PFOSTEN!', color: '#8b5a2b', sub: 'An den Innenpfosten und zurück ins Feld!' }
};

/* ══════════════════════════════════════════════════════════════════════════
   MINIGAME
   ══════════════════════════════════════════════════════════════════════════ */

export const minigame = {
  id: 'freistoss',
  kind: 'freistoss',
  title: 'Freistoß',
  instructions: 'Drei Klicks (oder [Leertaste]): erst die Abschussrichtung, dann die Höhe '
    + 'über die Mauer, zuletzt den Effet. Während des Flugs darfst du mit der Maus oder '
    + '[←]/[→] noch nachziehen. [ESC] überlässt der Simulation den Schuss.',

  async play(host, moment) {
    const canvas = host && host.canvas;
    const ctx = host && host.ctx;
    if (!canvas || !ctx) return null;

    const rng = host.rng || createRng(19740707);
    const W = canvas.width || CANVAS_W;
    const H = canvas.height || CANVAS_H;
    const diff = (host.difficulty && typeof host.difficulty.minigame === 'number') ? host.difficulty.minigame : 1;
    const diffName = (host.difficulty && host.difficulty.name) || 'Profi';
    const actor = moment.actor || { shortName: 'Schütze', attributes: {} };
    const keeper = moment.keeper || { shortName: 'Torwart', attributes: { reflexe: 60, stellungsspiel: 58, sprungkraft: 58 } };
    const defenders = Array.isArray(moment.defenders) ? moment.defenders : [];
    // Klangnamen aus dem Vertrag von render/sound.js. Der zweite Parameter geht
    // unverändert an die Klangbank durch ({ lautstaerke, hoehe, panorama }).
    const sound = (n, o) => { try { if (typeof host.sound === 'function') host.sound(n, o); } catch (e) { /* egal */ } };

    /** Was am Ende des Fluges zu hören ist – je Ausgang genau ein Klang. */
    const AUSGANG_KLANG = {
      tor: ['tor', null],
      parade: ['parade', null],
      latte: ['pfosten', { hoehe: 1.12 }],
      pfosten: ['pfosten', null],
      daneben: ['raunen', { lautstaerke: 0.9 }]
    };

    /* ---- Position des Freistoßes aus moment.at ableiten -------------------- */
    // Heim greift Richtung +x an (Tor bei x=105), Gäste Richtung -x (Tor bei x=0).
    const at = moment.at || { x: 85, y: 30 };
    const isHome = moment.team !== 'away';
    const goalX = isHome ? 105 : 0;
    const rawV = Math.abs(goalX - (typeof at.x === 'number' ? at.x : 85));
    const rawU = isHome ? (34 - (typeof at.y === 'number' ? at.y : 30))
      : ((typeof at.y === 'number' ? at.y : 30) - 34);
    // Auf einen spielbaren Bereich stauchen – dabei Winkel beibehalten, damit
    // Mauer, Torwart und Flugbahn zueinander passen.
    let ballU = clamp(rawU, -16, 16);
    let ballV = clamp(rawV, 6, DIST_MAX);
    let D = Math.hypot(ballU, ballV);
    if (D < DIST_MIN) { const f = DIST_MIN / D; ballU *= f; ballV *= f; D = DIST_MIN; }
    else if (D > DIST_MAX) { const f = DIST_MAX / D; ballU *= f; ballV *= f; D = DIST_MAX; }

    const cam = makeCamera(ballU, ballV, W, H);
    const skill = shooterSkill(actor);
    const isSpecialist = hasTrait(actor, 'freistossspezialist');
    const flight = makeFlight(ballU, ballV, D, skill);
    const wallCount = clamp(defenders.length || 4, 2, 6);
    const wall = makeWall(ballU, ballV, D, wallCount, actor.foot);
    const wallTopH = WALL_MAN_H + WALL_JUMP;
    const safeWin = safeLoftWindow(flight, wallTopH);

    /* ---- Skill-abhängige Fenster & Tempi ---------------------------------- */
    const aimSpan = lerp(AIM_SPAN_NEAR, AIM_SPAN_FAR, clamp01((D - DIST_MIN) / (DIST_MAX - DIST_MIN)));
    const curveMax = lerp(CURVE_MIN, CURVE_MAX, skill) + (isSpecialist ? TRAIT_SPEC_CURVE : 0);
    const speedF = (base) => base * lerp(0.74, 1.30, skill) / clamp(diff, 0.6, 1.7);
    const dirPeriod = speedF(DIR_PERIOD_MS);
    const hgtPeriod = speedF(HGT_PERIOD_MS);
    const crvPeriod = speedF(CRV_PERIOD_MS);
    // Sichtbarkeit des sicheren Höhenfensters – der eigentliche „Standards"-Bonus.
    const hintAlpha = isSpecialist ? 1
      : clamp01((att(actor, 'standards') - WINDOW_HINT_FROM) / (WINDOW_HINT_FULL - WINDOW_HINT_FROM)) * 0.85;
    // Länge der Flugbahn-Vorschau (0..1): schlechte Schützen sehen fast nichts.
    const previewLen = clamp01(0.22 + skill * 0.55 + (isSpecialist ? 0.22 : 0));
    const animMs = clamp(flight.T * 1000 * 1.45, 1150, 2100);

    const crowd = [];
    const kit = kitOf(actor);
    const oppKit = kitOf(defenders[0] || keeper);
    const crowdColors = [kit.primary, kit.secondary, '#e8d9b0', '#8b5a2b', '#404a58', '#c9ced6'];
    for (let i = 0; i < 380; i++) {
      crowd.push({
        x: rng.int(0, W), y: cam.cy - rng.int(6, 124), s: rng.int(3, 5),
        c: crowdColors[rng.int(0, crowdColors.length - 1)], ph: rng.float(0, TAU)
      });
    }
    const wallPhase = [];
    for (let i = 0; i < wallCount; i++) wallPhase.push(rng.float(-0.05, 0.05));
    const dirPhase = rng.float(0, 1), hgtPhase = rng.float(0, 1), crvPhase = rng.float(0, 1);

    const hudBase = {
      actor,
      posName: actor.position || 'ZM',
      footName: actor.foot === 'links' ? 'linker Fuß' : actor.foot === 'beidfüßig' ? 'beidfüßig' : 'rechter Fuß',
      std: att(actor, 'standards'), tec: att(actor, 'technik'),
      minute: moment.minute != null ? moment.minute : (moment.context && moment.context.minute) || 0,
      score: (moment.context && moment.context.score) ? `${moment.context.score[0]}:${moment.context.score[1]}` : '0:0',
      competition: (moment.context && moment.context.competition) || 'Freundschaftsspiel',
      dist: Math.round(D), wall: `${wallCount} Mann`,
      difficultyName: diffName,
      keeperName: keeper.shortName || keeper.lastName || 'Torwart',
      keeperReflex: att(keeper, 'reflexe'),
      badge: isSpecialist
        ? `${TRAITS.freistossspezialist.icon} ${TRAITS.freistossspezialist.name}: mehr Effet, klares Zielfenster`
        : (att(actor, 'standards') < 55 ? '⚠ Kein Standardspezialist – das Fenster bleibt im Dunkeln' : '')
    };

    return new Promise((resolve) => {
      /* ---- Zustand -------------------------------------------------------- */
      let finished = false, raf = 0;
      const tStart = performance.now();
      let phase = 'intro';
      let phaseStart = tStart;
      let dirMark = 0.5, hgtMark = 0.5, crvMark = 0.5;
      let aimU = 0, vz = 7.0, curve = 0, steer = 0;
      let lastPointerX = null;
      let flightT = 0, ballSpin = 0;
      let result = null;                 // { outcome, quality, xgDelta, endU, endH }
      let plan = null;                   // Torwartplan
      let blockedAt = null;              // Weltpunkt des Mauertreffers
      let netHit = { u: 0, h: 0, a: 0 };
      const prevCursor = canvas.style.cursor;

      function detach() {
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerdown', onDown);
        window.removeEventListener('keydown', onKey);
        canvas.style.cursor = prevCursor;
      }
      function done(res) {
        if (finished) return;
        finished = true;
        if (raf) cancelAnimationFrame(raf);
        detach();
        resolve(res);
      }
      function bailout() {
        const r = result || { outcome: 'geblockt', quality: 0.30, xgDelta: -0.05 };
        done({ outcome: r.outcome, quality: r.quality, targetPlayerId: null, xgDelta: r.xgDelta });
      }

      /* ---- Eingabe -------------------------------------------------------- */
      function onMove(ev) {
        const r = canvas.getBoundingClientRect();
        const sx = (ev.clientX - r.left) * (W / Math.max(1, r.width));
        if (phase === 'flug' && flightT < STEER_UNTIL && flightT > 0) {
          if (lastPointerX !== null) {
            steer = clamp(steer + (sx - lastPointerX) * STEER_PER_PX, -STEER_MAX, STEER_MAX);
          }
        }
        lastPointerX = sx;
      }
      function press() {
        if (phase === 'richtung') {
          aimU = (dirMark - 0.5) * 2 * aimSpan;
          setPhase('hoehe');
          sound('klick');
        } else if (phase === 'hoehe') {
          vz = lerp(VZ_MIN, VZ_MAX, hgtMark);
          setPhase('effet');
          sound('klick');
        } else if (phase === 'effet') {
          curve = (crvMark - 0.5) * 2 * curveMax;
          setPhase('flug');
          sound('schuss');
        }
      }
      function onDown(ev) { ev.preventDefault(); press(); }
      function onKey(ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); done(null); return; }
        if ((ev.key === ' ' || ev.key === 'Enter') && !ev.repeat) { ev.preventDefault(); press(); }
        if (phase === 'flug' && flightT < STEER_UNTIL) {
          if (ev.key === 'ArrowLeft') { steer = clamp(steer - 0.08, -STEER_MAX, STEER_MAX); ev.preventDefault(); }
          if (ev.key === 'ArrowRight') { steer = clamp(steer + 0.08, -STEER_MAX, STEER_MAX); ev.preventDefault(); }
        }
      }
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerdown', onDown);
      window.addEventListener('keydown', onKey);
      canvas.style.cursor = 'crosshair';

      function setPhase(p) {
        phase = p;
        phaseStart = performance.now();
        if (p === 'flug') { flightT = 0; blockedAt = null; plan = null; }
      }

      /* ---- Auflösung ------------------------------------------------------- */
      function totalCurve() { return curve + steer; }

      function ballState(t) {
        const c = totalCurve();
        return {
          u: flight.sideAt(t, aimU, c),
          v: flight.vAt(t),
          h: flight.heightAt(t, vz)
        };
      }

      /** Mauercheck exakt an der Mauerebene. */
      function checkWall() {
        const b = ballState(wall.t);
        const jumpNow = WALL_JUMP;   // die Mauer springt genau im richtigen Moment
        const top = WALL_MAN_H + jumpNow;
        const inX = b.u > wall.uMin - WALL_ARM - BALL_R && b.u < wall.uMax + WALL_ARM + BALL_R;
        // Unter der springenden Mauer durchgerutscht? Flach und niedrig genug.
        const underneath = b.h < 0.34;
        if (inX && b.h < top && !underneath) { blockedAt = b; return true; }
        return false;
      }

      /** Endabrechnung an der Torlinie. */
      function finishFlight() {
        const c = totalCurve();
        const endU = aimU + c;
        const endH = flight.heightAt(1, vz);
        const hWall = flight.heightAt(wall.t, vz);

        let outcome;
        const overBar = endH > GOAL_H + POST_R + BALL_R;
        const wide = Math.abs(endU) > GOAL_HALF_W + POST_R + BALL_R;
        const hitPost = Math.abs(Math.abs(endU) - GOAL_HALF_W) <= POST_R + BALL_R && endH < GOAL_H + POST_R;
        const hitBar = Math.abs(endH - GOAL_H) <= POST_R + BALL_R && Math.abs(endU) < GOAL_HALF_W + POST_R;

        // Torwart
        const startU = -wall.sign * KEEPER_START_U;
        plan = keeperPlan(rng, keeper, flight, endU, c, startU, diff);
        let reach = KEEPER_REACH * (0.85 + 0.30 * diff);
        if (endH > 1.7) reach *= (1 - KEEPER_HIGH_MALUS * clamp01((endH - 1.7) / 0.75));
        if (endH < 0.4) reach *= 0.9;
        const dist = Math.abs(endU - plan.targetU);
        const pSave = clamp((1 - dist / Math.max(0.4, reach)) * (0.62 + 0.55 * plan.skill), 0, KEEPER_SAVE_CEIL);
        const saved = dist < reach && rng.chance(pSave);

        if (overBar || wide) outcome = 'daneben';
        else if (hitBar) outcome = 'latte';
        else if (hitPost) outcome = 'pfosten';
        else if (saved) outcome = 'parade';
        else outcome = 'tor';

        const quality = computeQuality(endU, endH, c, hWall, wallTopH, false);
        let xg = (quality - 0.5) * XG_SPAN;
        if (outcome === 'tor') xg += 0.10;
        else if (outcome === 'parade') xg -= 0.03;
        else if (outcome === 'latte' || outcome === 'pfosten') xg -= 0.05;
        else if (outcome === 'daneben') xg -= 0.12;

        result = {
          outcome,
          quality: Math.round(quality * 1000) / 1000,
          xgDelta: Math.round(clamp(xg, XG_MIN, XG_MAX) * 1000) / 1000,
          endU, endH, keeperU: plan.targetU
        };
        netHit = { u: endU, h: endH, a: 0 };
        // Vorher klang ein Ball, der zehn Meter über die Latte segelte, nach
        // Aluminium. Jetzt klingt jeder Ausgang nach dem, was er ist.
        const klang = AUSGANG_KLANG[outcome];
        if (klang) sound(klang[0], klang[1]);
        if (outcome === 'latte' || outcome === 'pfosten') {
          sound('raunen', { lautstaerke: 0.85, verzoegerung: 0.3 });
        }
      }

      function resolveBlocked() {
        const c = totalCurve();
        const hWall = flight.heightAt(wall.t, vz);
        const quality = computeQuality(aimU + c, flight.heightAt(1, vz), c, hWall, wallTopH, true);
        result = {
          outcome: 'geblockt',
          quality: Math.round(quality * 1000) / 1000,
          xgDelta: Math.round(clamp((quality - 0.5) * XG_SPAN - 0.10, XG_MIN, XG_MAX) * 1000) / 1000,
          endU: blockedAt.u, endH: blockedAt.h, keeperU: 0
        };
        sound('block');
      }

      /* ---- Vorschau der Flugbahn (Skill-abhängig lang) ---------------------- */
      function drawPreview(ctx2, previewCurve, previewAim, previewVz, maxT) {
        ctx2.save();
        ctx2.setLineDash([6, 6]);
        ctx2.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx2.lineWidth = 2.5;
        ctx2.beginPath();
        const steps = 26;
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * maxT;
          const u = flight.sideAt(t, previewAim, previewCurve);
          const hh = flight.heightAt(t, previewVz);
          const p = cam.project(u, flight.vAt(t), Math.max(0, hh));
          if (i === 0) ctx2.moveTo(p.x, p.y); else ctx2.lineTo(p.x, p.y);
        }
        ctx2.stroke();
        ctx2.restore();
      }

      /* ---- Hauptschleife ---------------------------------------------------- */
      function frame(now) {
        raf = requestAnimationFrame(frame);
        if (finished) return;
        if (now - tStart > HARD_TIMEOUT_MS) { bailout(); return; }

        const tSec = (now - tStart) / 1000;
        const pt = now - phaseStart;
        let timer = null;

        /* --- Phasenlogik --- */
        if (phase === 'intro') {
          if (pt > INTRO_MS) setPhase('richtung');
        } else if (phase === 'richtung') {
          const tri = ((pt / dirPeriod) + dirPhase) % 1;
          dirMark = tri < 0.5 ? tri * 2 : 2 - tri * 2;
          timer = 1 - pt / DIR_LIMIT_MS;
          if (pt > DIR_LIMIT_MS) { aimU = (dirMark - 0.5) * 2 * aimSpan; setPhase('hoehe'); }
        } else if (phase === 'hoehe') {
          const tri = ((pt / hgtPeriod) + hgtPhase) % 1;
          hgtMark = tri < 0.5 ? tri * 2 : 2 - tri * 2;
          timer = 1 - pt / HGT_LIMIT_MS;
          if (pt > HGT_LIMIT_MS) { vz = lerp(VZ_MIN, VZ_MAX, hgtMark); setPhase('effet'); }
        } else if (phase === 'effet') {
          const tri = ((pt / crvPeriod) + crvPhase) % 1;
          crvMark = tri < 0.5 ? tri * 2 : 2 - tri * 2;
          timer = 1 - pt / CRV_LIMIT_MS;
          if (pt > CRV_LIMIT_MS) { curve = (crvMark - 0.5) * 2 * curveMax; setPhase('flug'); }
        } else if (phase === 'flug') {
          const prev = flightT;
          flightT = clamp01((pt - RUNUP_MS) / animMs);
          if (!blockedAt && !result && prev < wall.t && flightT >= wall.t) {
            if (checkWall()) resolveBlocked();
          }
          if (!result && flightT >= 1) finishFlight();
          if (pt > RUNUP_MS + animMs + 700) setPhase('ergebnis');
        } else if (phase === 'ergebnis') {
          if (!result) { bailout(); return; }
          if (pt > RESULT_MS) {
            done({
              outcome: result.outcome,
              quality: result.quality,
              targetPlayerId: null,
              xgDelta: result.xgDelta
            });
            return;
          }
        }

        /* --- Zeichnen --- */
        ctx.save();
        ctx.clearRect(0, 0, W, H);
        drawStands(ctx, cam, W, crowd, tSec);
        drawPitch(ctx, cam, W, H);
        drawGoal(ctx, cam, netHit);

        // Torwart
        let kU = -wall.sign * KEEPER_START_U + Math.sin(tSec * 2.0) * 0.22;
        let kDive = 0, kSide = 1, kHigh = false;
        if (result && plan) {
          const startU = -wall.sign * KEEPER_START_U;
          const p2 = phase === 'ergebnis' ? 1 : clamp01((flightT - plan.reactT) / Math.max(0.1, 1 - plan.reactT));
          kU = lerp(startU, plan.targetU, easeOut(p2));
          kDive = easeOut(p2);
          kSide = plan.targetU >= startU ? 1 : -1;
          kHigh = result.endH > 1.4;
        } else if (phase === 'flug' && flightT > 0.35) {
          // Er ahnt schon etwas und geht in die Schrittstellung
          kDive = clamp01((flightT - 0.35) * 0.8);
        }
        drawKeeper(ctx, keeper, cam, kU, kDive, kSide, kHigh);

        // Ball vor oder hinter der Mauer? Korrekte Tiefensortierung.
        const b = (phase === 'flug' || phase === 'ergebnis') ? ballState(clamp01(flightT)) : null;
        const ballBehindWall = b && b.v < wall.v;

        if (b && ballBehindWall) drawBallNow(b);
        drawWall();
        if (b && !ballBehindWall) drawBallNow(b);
        if (!b) drawBall(ctx, cam, ballU, ballV, BALL_H0, 0);

        function drawWall() {
          const jt = phase === 'flug' ? clamp01((flightT - wall.t + 0.22) / 0.30) : 0;
          const jump = Math.sin(clamp01(jt) * Math.PI) * WALL_JUMP;
          for (let i = 0; i < wallCount; i++) {
            const p = defenders[i] || null;
            drawFigure(ctx, host, p, cam, wall.manU(i), wall.v, {
              pose: 'mauer', kit: oppKit, height: WALL_MAN_H,
              jump: Math.max(0, jump + wallPhase[i] * 0.3), stripe: true
            });
          }
        }
        function drawBallNow(bb) {
          ballSpin += 0.4 + Math.abs(totalCurve()) * 0.25;
          if (result && result.outcome === 'geblockt' && blockedAt) {
            // Abpraller von der Mauer zurück ins Feld
            const a = clamp01((flightT - wall.t) * 2.2);
            drawBall(ctx, cam, blockedAt.u - wall.sign * 1.2 * a,
              blockedAt.v + 5.5 * a, Math.max(0.14, blockedAt.h + 0.4 * a - 1.6 * a * a), ballSpin);
          } else if (flightT >= 1 && result) {
            const a = phase === 'ergebnis' ? 1 : clamp01((pt - RUNUP_MS - animMs) / 700);
            if (result.outcome === 'tor') {
              netHit.a = Math.min(1, netHit.a + 0.10);
              drawBall(ctx, cam, result.endU * 0.92, lerp(0, -1.7, easeOut(a)),
                Math.max(0.12, result.endH * (1 - easeIn(a) * 0.8)), ballSpin);
            } else if (result.outcome === 'parade') {
              const s = result.endU >= 0 ? 1 : -1;
              drawBall(ctx, cam, result.endU + s * 3.6 * a, lerp(0, 5.0, a),
                Math.max(0.15, result.endH + 0.4 * a - 1.3 * a * a), ballSpin);
            } else if (result.outcome === 'latte' || result.outcome === 'pfosten') {
              drawBall(ctx, cam, result.endU * (1 - a * 0.4), lerp(0, 6.0, a),
                Math.max(0.15, result.endH + 0.35 * a - 1.8 * a * a), ballSpin);
            } else {
              drawBall(ctx, cam, result.endU * (1 + a * 0.2), lerp(0, -4.0, a),
                Math.max(0.1, result.endH + 0.3 * a - 0.8 * a * a), ballSpin);
            }
          } else {
            drawBall(ctx, cam, bb.u, bb.v, Math.max(0.05, bb.h), ballSpin);
          }
        }

        // Schütze
        const runT = (phase === 'flug' || phase === 'ergebnis')
          ? (phase === 'ergebnis' ? 1 : clamp01(pt / RUNUP_MS)) : 0;
        const shooterSide = ballU >= 0 ? -1 : 1;
        const sU = ballU + shooterSide * lerp(1.9, 0.55, easeIn(runT));
        const sV = ballV + lerp(2.4, 0.5, easeIn(runT));
        drawFigure(ctx, host, actor, cam, sU, sV, {
          pose: runT === 0 ? 'stand' : (runT < 1 ? 'lauf' : 'schuss'),
          frame: runT * 2.5, kit, alpha: flightT > 0.12 ? 0.5 : 1
        });

        /* --- Zielhilfen --- */
        if (phase === 'richtung') {
          const u = (dirMark - 0.5) * 2 * aimSpan;
          const top = cam.project(u, 0, 2.9), bot = cam.project(u, 0, 0);
          ctx.save();
          ctx.strokeStyle = C.red; ctx.lineWidth = 4;
          ctx.setLineDash([9, 7]);
          ctx.beginPath(); ctx.moveTo(bot.x, bot.y); ctx.lineTo(top.x, top.y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = C.gold;
          ctx.beginPath();
          ctx.moveTo(top.x, top.y - 16); ctx.lineTo(top.x - 11, top.y - 34); ctx.lineTo(top.x + 11, top.y - 34);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5; ctx.stroke();
          ctx.restore();
        } else if (phase === 'hoehe') {
          drawPreview(ctx, 0, aimU, lerp(VZ_MIN, VZ_MAX, hgtMark), previewLen);
        } else if (phase === 'effet') {
          drawPreview(ctx, (crvMark - 0.5) * 2 * curveMax, aimU, vz, previewLen);
        }

        /* --- Balken --- */
        if (phase === 'richtung') {
          drawHBar(ctx, 250, H - 46, 460, 24, dirMark, 'RICHTUNG – Abschusswinkel',
            { center: true, left: 'links', right: 'rechts' });
        } else if (phase === 'hoehe') {
          drawVBar(ctx, W - 68, 190, 38, 250, hgtMark, 'HÖHE', safeWin, hintAlpha);
        } else if (phase === 'effet') {
          drawHBar(ctx, 250, H - 46, 460, 24, crvMark, 'EFFET – Krümmung um die Mauer',
            { center: true, left: '↶ links', right: 'rechts ↷' });
        } else if (phase === 'flug' && flightT < STEER_UNTIL) {
          drawHBar(ctx, 330, H - 46, 300, 20, 0.5 + steer / (STEER_MAX * 2), 'NACHZIEHEN – Maus bewegen!',
            { center: true });
        }

        // Statusleiste mit den bereits gesetzten Werten
        if (phase !== 'intro') {
          panel(ctx, 12, H - 76, 210, 62, C.paper);
          text(ctx, `Richtung: ${phase === 'richtung' ? '…' : (aimU >= 0 ? '+' : '') + aimU.toFixed(1) + ' m'}`,
            22, H - 60, { size: 13, bold: true });
          text(ctx, `Höhe: ${phase === 'richtung' || phase === 'hoehe' ? '…' : vz.toFixed(1) + ' m/s'}`,
            22, H - 42, { size: 13, bold: true });
          text(ctx, `Effet: ${phase === 'flug' || phase === 'ergebnis'
            ? (totalCurve() >= 0 ? '+' : '') + totalCurve().toFixed(2) + ' m' : '…'}`,
            22, H - 24, { size: 13, bold: true });
        }

        /* --- HUD --- */
        const hints = {
          intro: `Freistoß aus ${Math.round(D)} Metern – ${wallCount} Mann in der Mauer.`,
          richtung: 'KLICK/LEERTASTE: Abschussrichtung festlegen (der Effet biegt ihn noch!)',
          hoehe: 'KLICK: Höhe wählen – über die Mauer, aber unter die Latte!',
          effet: 'KLICK: Effet festlegen – die gestrichelte Linie zeigt die Bahn',
          flug: flightT < STEER_UNTIL ? 'Maus bewegen: den Ball noch ein wenig nachziehen!' : 'Der Ball fliegt …',
          ergebnis: ''
        };
        drawHud(ctx, W, Object.assign({}, hudBase, { hint: hints[phase] || '', timer }));

        if (phase === 'ergebnis' && result) {
          const r = RESULT_TEXT[result.outcome] || RESULT_TEXT.daneben;
          drawBanner(ctx, W, H, r.title, r.sub, r.color);
          text(ctx, `Ausführung: ${Math.round(result.quality * 100)} %`, W / 2, H * 0.33 + 138,
            { bold: true, size: 16, align: 'center', color: '#ffffff', shadow: true });
        }
        ctx.restore();
      }

      raf = requestAnimationFrame(frame);
    });
  }
};

export default minigame;
