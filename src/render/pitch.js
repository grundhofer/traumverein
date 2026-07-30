/**
 * render/pitch.js — Spielfeld in der Vogelperspektive („Anstoß"-Look, modern gerendert).
 *
 * Zeichnet das komplette Stadion in EINEM Canvas: Ränge mit animierter Zuschauermasse,
 * Bandenwerbung, Rasen mit Mähstreifen, alle Linien, Tore mit Netz, Eckfahnen,
 * 22 Spieler (Sprites aus ./players.js), Ball mit Schatten/Flugkurve, Anzeigetafel.
 *
 * Weltkoordinaten sind METER (Vertrag §1): x 0…105 (Heim greift Richtung +x an),
 * y 0…68, Mittelpunkt (52.5, 34). Alles wird über eine Kamera (Position + Zoom)
 * auf den Canvas abgebildet, damit cineastische Zooms möglich sind.
 *
 * ---------------------------------------------------------------------------
 * SELBSTTEST (im Browser, z. B. in der Konsole einer Seite mit einem <canvas>):
 *
 *   import { createPitchView } from './src/render/pitch.js';
 *   const view = createPitchView(document.querySelector('canvas'), { cinematic: true });
 *   view.setTeams(heimMatchTeam, gastMatchTeam);   // MatchTeam: { club, players, tactics, … }
 *   view.setFormationPositions();
 *   view.setClock(37, 0, [1, 0]);
 *   view.renderStatic();
 *   await view.playPhase({
 *     minute: 37, team: 'home', kind: 'angriff', duration: 3.5,
 *     ball: [{ x: 52, y: 34, t: 0 }, { x: 78, y: 20, t: 0.55 }, { x: 99, y: 35, t: 1 }],
 *     actors: [{ playerId: heimMatchTeam.players[9].id, x: 96, y: 33, action: 'schuss' }]
 *   });
 *   view.showBanner('T O O O R !', 2200);   // löst Konfetti + Blitzlichter aus
 *   view.setSpeed(4);
 *   view.destroy();
 *
 * Robustheit (bewusst getestet):
 *   • ohne setTeams()  → Stadion + Ball werden trotzdem gezeichnet
 *   • phase.actors fehlt oder enthält unbekannte playerIds → wird ignoriert, kein Absturz
 *   • phase.ball leer → Ball bleibt liegen, Promise löst trotzdem auf
 *   • setSpeed(8) → Animationen werden übersprungen (sofort Endzustand)
 *   • destroy() → rAF-Loop gestoppt, Listener entfernt, offene Promises aufgelöst
 *
 * Syntaxprüfung:  node --check src/render/pitch.js
 * (Ein Import-Test in Node ist nicht möglich – die Datei benutzt DOM/Canvas.)
 * ---------------------------------------------------------------------------
 */

import { drawPlayer, drawKeeper } from './players.js';
import { clamp, lerp } from '../core/util.js';
import { POSITION_AFFINITY, POSITION_GROUP, DEFAULT_COLORS } from '../core/constants.js';
import { createRng } from '../core/rng.js';

/* ===========================================================================
 * 1. KONSTANTEN — hier wird balanciert. Alle Längen in Metern.
 * ========================================================================= */

/* --- Feldmaße nach Regelwerk --- */
const PITCH_L = 105;              // Länge (Tor zu Tor)
const PITCH_W = 68;               // Breite
const PEN_DEPTH = 16.5;           // Strafraumtiefe
const PEN_HALF_W = 20.16;         // halbe Strafraumbreite → y 13.84 … 54.16
const BOX_DEPTH = 5.5;            // Fünfmeterraum (Torraum)
const BOX_HALF_W = 9.16;
const PENALTY_SPOT = 11;          // Elfmeterpunkt
const CIRCLE_R = 9.15;            // Mittelkreis / Teilkreisradius
const CORNER_R = 1;               // Eckviertel
const GOAL_HALF_W = 3.66;         // Tor 7.32 m breit
const GOAL_DEPTH = 2.3;           // Netztiefe (perspektivisch angedeutet)
const GOAL_BACK_INSET = 0.55;     // Verjüngung hinten → Pseudo-Perspektive

/* --- Stadion-Umgebung --- */
const GRASS_MARGIN = 4.5;         // Rasen außerhalb der Linien
const ADVERT_DEPTH = 1.3;         // Bandenwerbung
const STAND_DEPTH_X = 11;         // Ränge hinter den Toren
const STAND_DEPTH_Y = 8.5;        // Ränge an den Seitenlinien

const WX0 = -(GRASS_MARGIN + STAND_DEPTH_X);
const WX1 = PITCH_L + GRASS_MARGIN + STAND_DEPTH_X;
const WY0 = -(GRASS_MARGIN + STAND_DEPTH_Y);
const WY1 = PITCH_W + GRASS_MARGIN + STAND_DEPTH_Y;
const WORLD_W = WX1 - WX0;
const WORLD_H = WY1 - WY0;
const WORLD_CX = (WX0 + WX1) / 2;
const WORLD_CY = (WY0 + WY1) / 2;

/* --- Optik --- */
const LINE_W = 0.13;              // Linienbreite in Metern
const MOW_STRIPES = 14;           // Anzahl Mähstreifen
const NOISE_SIZE = 96;            // Kachelgröße des Rasenrauschens
const NOISE_ALPHA = 0.07;
const MAX_DPR = 2.5;              // devicePixelRatio deckeln (Performance)

const COL = {
  outside: '#0a0f0c',
  grassA: '#2f7d32',
  grassB: '#276b2a',
  grassEdge: '#1f5520',
  line: 'rgba(255,255,255,0.92)',
  net: 'rgba(235,255,235,0.5)',
  netFill: 'rgba(230,255,230,0.09)',
  post: '#f4f6f4',
  standBase: '#3b4149',
  standStep: '#2b3037',
  standDark: '#1a1e23',
  barrier: '#141719',
  advertDark: '#171a1e',
  hudBg: '#16240f',
  hudLight: '#5b7f43',
  hudDark: '#070d05',
  hudText: '#f2e8cf',
  hudAccent: '#e8d9b0',
  bannerBg: '#c1272d',
  bannerLight: '#f07a7f',
  bannerDark: '#5e0f13'
};

const FONT_FAMILY = 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

/* --- Zuschauer --- */
const CROWD_PX_PER_M = 6;         // Auflösung der vorgerenderten Rangebene
const CROWD_SPACING = 0.85;       // Abstand der „Köpfe" in Metern
const CROWD_JITTER = 0.3;
const CROWD_ANIM_COUNT = 260;     // wie viele Köpfe pro Frame neu getönt werden (Flimmern)
const CROWD_FLASH_BASE = 0.0009;  // Grundwahrscheinlichkeit für ein Blitzlicht je Kopf
const CROWD_FLASH_GOAL = 0.055;   // beim Torjubel
const CROWD_TIER_STEP = 2.6;      // Rangstufen-Abstand

/* --- Spielerbewegung (Meter/Sekunde bzw. Faktoren) --- */
const PLAYER_MAX_SPEED = 8.4;     // Sprinttempo
const PLAYER_SMOOTH = 3.2;        // Annäherungsrate an die Zielposition
const TEAM_SHIFT_X_ATT = 0.44;    // wie stark die Ballbesitz-Mannschaft dem Ball nachschiebt
const TEAM_SHIFT_X_DEF = 0.52;    // dito verteidigend (kompakter, tiefer)
const TEAM_SHIFT_Y = 0.34;        // seitliches Verschieben zur Ballseite
const COMPACT_ATT = 0.1;          // Sog zum Ball in Ballbesitz
const COMPACT_DEF = 0.2;          // Sog zum Ball beim Verteidigen
const COMPACT_RADIUS = 34;        // ab dieser Ballentfernung interessiert es keinen mehr
const OFFSIDE_GAP = 9;            // Abwehrkette hält diesen Abstand hinter dem Ball
const LINE_MIN_DEPTH = 6;         // Kette rückt nie näher als 6 m ans eigene Tor
const LINE_MAX_DEPTH_DEF = 46;    // … und nicht weiter als 46 m raus, wenn sie verteidigt
const LINE_MAX_DEPTH_ATT = 62;    // in Ballbesitz darf sie aufrücken
const LINE_BLEND = 0.6;           // Mischung Kettenlogik ↔ Grundordnung
const KEEPER_OUT_MAX = 13;        // maximaler Torwart-Auslauf
const WOBBLE_AMP = 0.32;          // Zappeln im Stand (Meter)
const WOBBLE_SPEED = 1.7;
const STRIDE_RATE = 0.16;         // Laufanimation: Schrittfrequenz je m/s
const RUN_POSE_SPEED = 0.9;       // ab dieser Geschwindigkeit gilt „Lauf"
const ACTION_POSE_AT = 0.58;      // ab welchem Phasenfortschritt die Aktionspose greift

/* Aktion aus phase.actors → Pose für drawPlayer() (Keys aus render/players.js) */
const ACTION_POSE = {
  pass: 'schuss',
  schuss: 'schuss',
  dribbling: 'lauf',
  tackling: 'graetsche',
  parade: 'parade',
  lauf: 'lauf',
  kopfball: 'kopfball'
};

/* --- Ball --- */
const BALL_RADIUS_M = 0.42;       // optisch vergrößert (real 0.11 m wäre unsichtbar)
const BALL_LIFT = 0.62;           // Bildschirmversatz je Meter Flughöhe
const BALL_SHADOW_DX = 0.16;      // Schattenversatz je Meter Höhe (Sonne links oben)
const BALL_SHADOW_DY = 0.11;
const BALL_SPIN = 0.55;           // Umdrehungen je zurückgelegtem Meter
const BALL_TRAIL = 9;             // Länge der Flugspur
const LOFT_LONG_DIST = 24;        // ab dieser Passlänge fliegt der Ball hoch
const LOFT_MED_DIST = 13;
const LOFT_FACTOR = 0.15;         // Scheitelhöhe = Distanz × Faktor
const LOFT_MAX = 9.5;
const LOFT_SET_PIECE = 0.19;      // Standards fliegen höher
const LOFT_HEADER = 2.4;          // Mindesthöhe vor einem Kopfball

/* --- Spieler-Sprites --- */
const PLAYER_VIS_HEIGHT_M = 2.7;  // visuell überhöhte „Körpergröße" für Lesbarkeit
const PLAYER_SPRITE_REF_PX = 47;  // Sprite-Höhe bei scale = 1 (players.js: Scheitel −47, Füße 0)
const PLAYER_SCALE_MIN = 0.16;
const PLAYER_SCALE_MAX = 1.6;
const LABEL_MIN_PX = 6;           // darunter wird gar nicht beschriftet
const LABEL_NAME_MIN_PX = 8;      // darunter nur die Rückennummer
const CARRIER_RADIUS = 2.8;       // Ballnähe für die Ballführenden-Markierung

/* --- Kamera --- */
const CAM_SMOOTH = 2.8;
const CAM_ZOOM_ACTION = 1.55;
const CAM_ZOOM_GOAL = 2.1;
const CAM_HOLD_MS = 700;          // Nachlauf, damit der Zoom nicht zappelt
const FINAL_THIRD = 32;           // Meter vom Tor: ab hier wird cineastisch gezoomt

/* --- HUD / Banner --- */
const HUD_RESERVE = 58;           // reservierte Bildschirmhöhe oben
const HUD_BAR_H = 34;
const HUD_CLOCK_W = 78;
const HUD_CLOCK_H = 20;
const BANNER_DEFAULT_MS = 2000;
const BANNER_MAX_SPEEDUP = 4;     // Banner werden höchstens 4× schneller ausgeblendet
const CONFETTI_COUNT = 150;
const CONFETTI_GRAVITY = 640;     // px/s²
const CELEBRATE_MS = 2600;

/* --- Trikot-Konflikt --- */
const KIT_CONFLICT_DISTANCE = 95; // gewichteter RGB-Abstand, darunter gilt „zu ähnlich"
const KEEPER_COLORS = ['#26c281', '#f2c500', '#ff6b35', '#8e44ad', '#111418'];

/* Breitenraster je Anzahl Spieler einer Reihe (Taktikbrett-x, 0…100) */
const LINE_SPREAD = {
  1: [50, 50], 2: [33, 67], 3: [22, 78], 4: [13, 87], 5: [8, 92], 6: [6, 94]
};

const TAU = Math.PI * 2;
const D_ANGLE = Math.acos((PEN_DEPTH - PENALTY_SPOT) / CIRCLE_R); // Öffnungswinkel des Teilkreises

/* ===========================================================================
 * 2. KLEINE HELFER (rein funktional)
 * ========================================================================= */

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Deterministischer Pseudozufall aus zwei ganzen Zahlen – ersetzt Math.random() im Renderloop. */
function hash01(a, b) {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function hexToRgb(hex) {
  const s = String(hex || '').trim().replace('#', '');
  if (s.length === 3) {
    return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16) };
  }
  if (s.length >= 6) {
    const n = parseInt(s.slice(0, 6), 16);
    if (!isNaN(n)) return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  return { r: 128, g: 128, b: 128 };
}

const rgbStr = (r, g, b) => `rgb(${Math.round(clamp(r, 0, 255))},${Math.round(clamp(g, 0, 255))},${Math.round(clamp(b, 0, 255))})`;

/** amt > 0 = aufhellen, amt < 0 = abdunkeln (−1 … 1). */
function shade(hex, amt) {
  const c = hexToRgb(hex);
  const f = amt >= 0 ? (v) => v + (255 - v) * amt : (v) => v * (1 + amt);
  return rgbStr(f(c.r), f(c.g), f(c.b));
}

/** Gewichteter RGB-Abstand (grob wahrnehmungsnah) – für die Trikot-Konfliktprüfung. */
function colorDist(a, b) {
  const x = hexToRgb(a), y = hexToRgb(b);
  const rm = (x.r + y.r) / 2;
  const dr = x.r - y.r, dg = x.g - y.g, db = x.b - y.b;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/**
 * Text mit Sperrung (letter-spacing) – ctx.letterSpacing ist nicht überall verfügbar.
 * `stroke = true` zeichnet vorher die Outline mit dem aktuellen strokeStyle.
 */
function spacedText(ctx, text, x, y, spacing, align = 'center', stroke = false) {
  const str = String(text);
  let total = 0;
  for (const ch of str) total += ctx.measureText(ch).width + spacing;
  total -= spacing;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of str) {
    const w = ctx.measureText(ch).width;
    if (stroke) ctx.strokeText(ch, cx, y);
    ctx.fillText(ch, cx, y);
    cx += w + spacing;
  }
  ctx.textAlign = prev;
  return total;
}

/**
 * Erkennt ein Tor-Banner – auch gesperrt gesetzt („T O O O R !", „T-O-R").
 * „Torwart" o. Ä. löst bewusst KEINEN Jubel aus.
 */
function isGoalBanner(text) {
  const t = String(text == null ? '' : text).toUpperCase();
  const compact = t.replace(/[\s.\-–_!?]/g, '');
  return /\bTO+R\b/.test(t) || /^TO+R$/.test(compact);
}

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Anstoß-Panel: 2 px Outset-Bevel, hell oben/links, dunkel unten/rechts. */
function bevelBox(ctx, x, y, w, h, bg, light, dark, thickness = 2) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = light;
  ctx.fillRect(x, y, w, thickness);
  ctx.fillRect(x, y, thickness, h);
  ctx.fillStyle = dark;
  ctx.fillRect(x, y + h - thickness, w, thickness);
  ctx.fillRect(x + w - thickness, y, thickness, h);
}

/* ===========================================================================
 * 3. TRIKOTS
 * ========================================================================= */

function clubColors(club) {
  const c = (club && club.colors) || DEFAULT_COLORS;
  return {
    primary: c.primary || DEFAULT_COLORS.primary,
    secondary: c.secondary || DEFAULT_COLORS.secondary,
    accent: c.accent || DEFAULT_COLORS.accent
  };
}

/**
 * Ermittelt die Trikots beider Teams. Das Gastteam weicht bei Farbkonflikt auf
 * `awayKit` aus; hilft auch das nicht, wird auf Weiß/Anthrazit ausgewichen.
 */
function resolveKits(homeClub, awayClub) {
  const h = clubColors(homeClub);
  const a = clubColors(awayClub);

  const home = {
    primary: h.primary,
    secondary: h.secondary,
    accent: h.accent,
    pattern: (homeClub && homeClub.kit && homeClub.kit.pattern) || 'plain',
    shorts: (homeClub && homeClub.kit && homeClub.kit.shorts) || h.primary,
    socks: (homeClub && homeClub.kit && homeClub.kit.socks) || h.primary,
    isAway: false
  };

  let away = {
    primary: a.primary,
    secondary: a.secondary,
    accent: a.accent,
    pattern: (awayClub && awayClub.kit && awayClub.kit.pattern) || 'plain',
    shorts: (awayClub && awayClub.kit && awayClub.kit.shorts) || a.primary,
    socks: (awayClub && awayClub.kit && awayClub.kit.socks) || a.primary,
    isAway: false
  };

  if (colorDist(home.primary, away.primary) < KIT_CONFLICT_DISTANCE) {
    const ak = awayClub && awayClub.awayKit;
    away = {
      primary: (ak && ak.primary) || a.secondary,
      secondary: (ak && ak.secondary) || a.primary,
      accent: a.accent,
      pattern: (ak && ak.pattern) || 'plain',
      shorts: (ak && ak.primary) || a.secondary,
      socks: (ak && ak.primary) || a.secondary,
      isAway: true
    };
    // Immer noch zu ähnlich? Dann Notfarbe mit maximalem Kontrast.
    if (colorDist(home.primary, away.primary) < KIT_CONFLICT_DISTANCE) {
      const light = '#f2f2f2', dark = '#1b1e22';
      away.primary = colorDist(home.primary, light) > colorDist(home.primary, dark) ? light : dark;
      away.secondary = away.primary === light ? dark : light;
      away.pattern = 'plain';
      away.shorts = away.primary;
      away.socks = away.primary;
    }
  }

  // Torwarttrikots: möglichst weit weg von beiden Feldspieler-Trikots.
  const pick = (exclude) => {
    let best = KEEPER_COLORS[0], bestD = -1;
    for (const c of KEEPER_COLORS) {
      const d = Math.min(...exclude.map((e) => colorDist(c, e)));
      if (d > bestD) { bestD = d; best = c; }
    }
    return best;
  };
  home.keeper = pick([home.primary, away.primary]);
  away.keeper = pick([home.primary, away.primary, home.keeper]);

  return { home, away };
}

/* ===========================================================================
 * 4. FORMATIONEN
 *
 * Aus der Formations-ID („4-4-2", „4-2-3-1", …) wird eine Grundordnung im
 * Taktikbrett-Koordinatensystem erzeugt (x = 0 links … 100 rechts,
 * y = 0 eigenes Tor … 100 gegnerisches Tor, Vertrag §1) und anschließend in
 * Meter umgerechnet. Dadurch braucht render/pitch.js keine Abhängigkeit zu
 * engine/tactics.js; liegt eine echte Formation vor, passt die Reihenfolge der
 * Slots (s1 = Torwart, dann von hinten nach vorne) trotzdem zusammen.
 * ========================================================================= */

const DEF_LINE_Y = 20;   // Tiefe der ersten Feldreihe (≈21 m vor dem eigenen Tor)
const ATT_LINE_Y = 72;   // Tiefe der vordersten Reihe (≈76 m, also 29 m vor dem Gegnertor)

/** Positionscodes für eine Reihe (Index 0 = links). */
function lineRoles(count, lineIdx, lineCount) {
  const isDefense = lineIdx === 0;
  const isAttack = lineIdx === lineCount - 1;
  if (isDefense) {
    if (count <= 3) return ['IV', 'IV', 'IV'].slice(0, count);
    if (count === 4) return ['LV', 'IV', 'IV', 'RV'];
    if (count === 5) return ['LV', 'IV', 'IV', 'IV', 'RV'];
    return ['LV', 'IV', 'IV', 'IV', 'IV', 'RV'].slice(0, count);
  }
  if (isAttack) {
    if (count === 1) return ['ST'];
    if (count === 2) return ['ST', 'ST'];
    if (count === 3) return ['LA', 'ST', 'RA'];
    return ['LA', 'ST', 'ST', 'RA'].slice(0, count);
  }
  // Mittelfeldreihen: nur bei 4+ Reihen gibt es ein echtes offensives Band
  // (4-2-3-1 → die „3" sind LA/OM/RA), bei 4-3-3 bleibt die Dreierreihe Mittelfeld.
  const advanced = lineCount >= 4 && lineIdx === lineCount - 2;
  if (count === 1) return [advanced ? 'OM' : 'DM'];
  if (count === 2) return advanced ? ['OM', 'OM'] : ['DM', 'DM'];
  if (count === 3) return advanced ? ['LA', 'OM', 'RA'] : ['LM', 'ZM', 'RM'];
  if (count === 4) return ['LM', 'ZM', 'ZM', 'RM'];
  if (count === 5) return ['LM', 'ZM', 'ZM', 'ZM', 'RM'];
  return new Array(count).fill('ZM');
}

/**
 * Baut 11 Slots (inkl. Torwart) aus einer Formations-ID.
 * @returns {Array<{id:string,pos:string,x:number,y:number}>}
 */
function buildFormationSlots(formationId) {
  const digits = String(formationId || '4-4-2').match(/\d+/g) || [];
  let lines = digits.map((d) => parseInt(d, 10)).filter((n) => n > 0 && n < 7);
  if (lines.reduce((a, b) => a + b, 0) !== 10 || lines.length < 2) lines = [4, 4, 2];

  const slots = [{ id: 's1', pos: 'TW', x: 50, y: 5 }];
  const n = lines.length;
  for (let i = 0; i < n; i++) {
    const count = lines[i];
    const y = n === 1 ? 50 : lerp(DEF_LINE_Y, ATT_LINE_Y, i / (n - 1));
    const spread = LINE_SPREAD[count] || [10, 90];
    const roles = lineRoles(count, i, n);
    for (let k = 0; k < count; k++) {
      const x = count === 1 ? 50 : lerp(spread[0], spread[1], k / (count - 1));
      // Leichte Staffelung: Außen etwas höher, Zentrum etwas tiefer – wirkt organischer.
      const mid = (count - 1) / 2;
      const stagger = count > 2 ? (Math.abs(k - mid) / mid) * 2.6 - 1.3 : 0;
      slots.push({
        id: 's' + (slots.length + 1),
        pos: roles[k] || 'ZM',
        x,
        y: clamp(y + stagger, 8, 94)
      });
    }
  }
  return slots.slice(0, 11);
}

/** Taktikbrett-Koordinaten → Meter. Heim spielt Richtung +x, Gast Richtung −x. */
function tacticToWorld(tx, ty, side) {
  if (side === 'away') {
    return { x: PITCH_L - (ty / 100) * PITCH_L, y: PITCH_W - (tx / 100) * PITCH_W };
  }
  return { x: (ty / 100) * PITCH_L, y: (tx / 100) * PITCH_W };
}

function affinity(playerPos, slotPos) {
  const row = POSITION_AFFINITY[playerPos];
  return (row && row[slotPos] !== undefined) ? row[slotPos] : 0.25;
}

/**
 * Ordnet 11 Spieler den Slots zu (gieriges Best-Pair-Matching über die
 * Positions-Affinität). Torhüter werden hart auf den TW-Slot gezogen.
 */
function assignToSlots(players, slots) {
  const pairs = [];
  for (let pi = 0; pi < players.length; pi++) {
    const p = players[pi];
    for (let si = 0; si < slots.length; si++) {
      const s = slots[si];
      let score = affinity(p.position, s.pos);
      if (Array.isArray(p.altPositions) && p.altPositions.includes(s.pos)) score += 0.15;
      if (p.position === 'TW' && s.pos === 'TW') score = 10;
      else if (p.position === 'TW' || s.pos === 'TW') score = -10;
      pairs.push({ pi, si, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const outByslot = new Array(slots.length).fill(null);
  const usedP = new Set(), usedS = new Set();
  for (const pr of pairs) {
    if (usedP.has(pr.pi) || usedS.has(pr.si)) continue;
    outByslot[pr.si] = players[pr.pi];
    usedP.add(pr.pi); usedS.add(pr.si);
  }
  return outByslot;
}

/** Die Elf aus tactics.lineup (Slot-Reihenfolge), aufgefüllt aus dem restlichen Kader. */
function pickEleven(matchTeam) {
  const players = (matchTeam && Array.isArray(matchTeam.players) ? matchTeam.players : []).filter(Boolean);
  const byId = new Map();
  for (const p of players) if (p && p.id) byId.set(p.id, p);

  const chosen = [];
  const used = new Set();
  const lineup = matchTeam && matchTeam.tactics && matchTeam.tactics.lineup;
  if (lineup && typeof lineup === 'object') {
    const keys = Object.keys(lineup).sort((a, b) => {
      const na = parseInt(String(a).replace(/\D/g, ''), 10) || 0;
      const nb = parseInt(String(b).replace(/\D/g, ''), 10) || 0;
      return na - nb;
    });
    for (const k of keys) {
      const p = byId.get(lineup[k]);
      if (p && !used.has(p.id)) { chosen.push(p); used.add(p.id); }
      if (chosen.length >= 11) break;
    }
  }
  for (const p of players) {
    if (chosen.length >= 11) break;
    if (!used.has(p.id)) { chosen.push(p); used.add(p.id); }
  }
  return chosen.slice(0, 11);
}

/* ===========================================================================
 * 5. BALLWEG
 * ========================================================================= */

/** Scheitelhöhe eines Ballwegsegments in Metern (Flanken/Standards fliegen hoch). */
function segmentHeight(a, b, phase, index, lastIndex, headerNext) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  let h = 0;
  if (d >= LOFT_LONG_DIST) h = clamp(d * LOFT_FACTOR, 2, LOFT_MAX);
  else if (d >= LOFT_MED_DIST && index === lastIndex) h = d * 0.1;
  if (phase && phase.kind === 'standard' && index === 0 && d >= 7) {
    h = Math.max(h, Math.min(LOFT_MAX, d * LOFT_SET_PIECE));
  }
  if (headerNext) h = Math.max(h, LOFT_HEADER);
  // Flache Abschlüsse: der letzte Meter vor dem Tor bekommt einen kleinen Hüpfer.
  if (index === lastIndex && h < 0.4 && d > 6) h = 0.5;
  return h;
}

/**
 * Normalisiert phase.ball zu einem auswertbaren Pfad.
 * @returns {{pts:Array<{x,y,t}>, heights:number[]}|null}
 */
function buildBallPath(phase, fromX, fromY) {
  const raw = (phase && Array.isArray(phase.ball) ? phase.ball : [])
    .filter((p) => p && isFinite(p.x) && isFinite(p.y))
    .map((p) => ({
      x: clamp(p.x, -3, PITCH_L + 3),
      y: clamp(p.y, -3, PITCH_W + 3),
      t: clamp(isFinite(p.t) ? p.t : 0, 0, 1)
    }))
    .sort((a, b) => a.t - b.t);

  if (!raw.length) return null;
  if (raw[0].t > 0.001) raw.unshift({ x: fromX, y: fromY, t: 0 });
  const last = raw[raw.length - 1];
  if (last.t < 0.999) raw.push({ x: last.x, y: last.y, t: 1 });

  const headerIdx = (phase && Array.isArray(phase.actors))
    ? phase.actors.findIndex((a) => a && a.action === 'kopfball')
    : -1;

  const heights = [];
  for (let i = 0; i < raw.length - 1; i++) {
    // Kopfball ⇒ das letzte Segment davor ist eine Flanke.
    const headerNext = headerIdx >= 0 && i === raw.length - 2;
    heights.push(segmentHeight(raw[i], raw[i + 1], phase, i, raw.length - 2, headerNext));
  }
  return { pts: raw, heights };
}

/** Catmull-Rom für weiche Ballwege. */
function catmull(p0, p1, p2, p3, u) {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/** Ballposition + Flughöhe zum relativen Zeitpunkt t (0…1). */
function samplePath(path, t) {
  const pts = path.pts;
  const tt = clamp(t, 0, 1);
  let i = 0;
  while (i < pts.length - 2 && tt > pts[i + 1].t) i++;
  const a = pts[i], b = pts[i + 1] || pts[i];
  const span = Math.max(1e-6, b.t - a.t);
  const u = clamp((tt - a.t) / span, 0, 1);
  const p0 = pts[i - 1] || a;
  const p3 = pts[i + 2] || b;
  const x = catmull(p0.x, a.x, b.x, p3.x, u);
  const y = catmull(p0.y, a.y, b.y, p3.y, u);
  const h = path.heights[i] || 0;
  return {
    x: clamp(x, -3, PITCH_L + 3),
    y: clamp(y, -3, PITCH_W + 3),
    z: 4 * h * u * (1 - u)
  };
}

/* ===========================================================================
 * 6. DIE VIEW
 * ========================================================================= */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opts] { cinematic, labels, hud, crowd, noise, seed, background }
 */
export function createPitchView(canvas, opts = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new Error('createPitchView: Es wird ein <canvas>-Element benötigt.');
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('createPitchView: 2D-Kontext nicht verfügbar.');

  const o = {
    cinematic: opts.cinematic !== false,
    labels: opts.labels !== false,
    hud: opts.hud !== false,
    crowd: opts.crowd !== false,
    noise: opts.noise !== false,
    seed: opts.seed !== undefined ? opts.seed : 'traumverein-pitch',
    background: opts.background || COL.outside
  };
  const rng = createRng(o.seed);

  /* --- Zustand --------------------------------------------------------- */
  let destroyed = false;
  let raf = 0;
  let lastTs = 0;
  let nowMs = 0;          // interne Uhr (performance.now-Basis, nur Optik)
  let speed = 1;

  const initialW = canvas.width || 960;
  const initialH = canvas.height || 600;
  let cssW = initialW, cssH = initialH, dpr = 1;
  let viewX = 0, viewY = 0, viewW = initialW, viewH = initialH;
  let baseScale = 1;

  const cam = { x: WORLD_CX, y: WORLD_CY, zoom: 1, holdUntil: 0 };

  const teams = {
    home: { matchTeam: null, club: null, kit: null, ents: [], abbr: 'HEI' },
    away: { matchTeam: null, club: null, kit: null, ents: [], abbr: 'GAS' }
  };
  let kits = resolveKits(null, null);

  const ball = { x: PITCH_L / 2, y: PITCH_W / 2, z: 0, rot: 0, trail: [] };
  let possession = 'home';

  let active = null;      // { phase, path, t, dur, resolve }
  let banner = null;      // { text, t0, dur }
  let confetti = [];
  let celebrateUntil = 0;
  let celebrateAt = { x: PITCH_L / 2, y: PITCH_W / 2 };
  let flashBoost = 0;

  let clock = { minute: 0, addedTime: 0, score: [0, 0] };

  let crowdDots = [];
  let crowdLayer = null;
  let crowdCursor = 0;
  let noiseCanvas = null;
  let noisePattern = null;
  let spriteBroken = false;   // drawPlayer() hat geworfen → interner Notfall-Sprite

  /* --- Maße & Transform ------------------------------------------------ */

  function measure() {
    dpr = clamp(typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1, 1, MAX_DPR);
    let w = initialW, h = initialH;
    if (typeof canvas.getBoundingClientRect === 'function') {
      const r = canvas.getBoundingClientRect();
      if (r && r.width >= 2 && r.height >= 2) { w = r.width; h = r.height; }
    }
    cssW = Math.max(2, Math.round(w));
    cssH = Math.max(2, Math.round(h));
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;

    const top = o.hud ? HUD_RESERVE : 6;
    viewX = 0;
    viewY = top;
    viewW = cssW;
    viewH = Math.max(20, cssH - top - 6);
    baseScale = Math.min(viewW / WORLD_W, viewH / WORLD_H);
  }

  const pxPerM = () => baseScale * cam.zoom;
  const centerX = () => viewX + viewW / 2;
  const centerY = () => viewY + viewH / 2;
  const w2sX = (x) => centerX() + (x - cam.x) * pxPerM();
  const w2sY = (y) => centerY() + (y - cam.y) * pxPerM();

  /** Weltkoordinaten-Transform aktivieren (Zeichnen in Metern). */
  function applyWorld() {
    const s = pxPerM();
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (centerX() - cam.x * s), dpr * (centerY() - cam.y * s));
  }
  /** Zurück auf Bildschirmkoordinaten (CSS-Pixel). */
  function applyScreen() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* --- Zuschauerränge -------------------------------------------------- */

  /** Erzeugt die Zuschauerpunkte einmalig (deterministisch über die RNG). */
  function buildCrowd() {
    crowdDots = [];
    if (!o.crowd) { crowdLayer = null; return; }

    const homeCol = kits.home.primary;
    const awayCol = kits.away.primary;
    const neutral = ['#2a2f36', '#3c3f45', '#1e2126', '#4a4f57'];
    const skin = ['#e8b98f', '#c98d61', '#8d5a34', '#5b3620', '#f0cba6'];

    const bands = [
      { x0: WX0, x1: WX1, y0: WY0, y1: -GRASS_MARGIN, side: 'top' },
      { x0: WX0, x1: WX1, y0: PITCH_W + GRASS_MARGIN, y1: WY1, side: 'bottom' },
      { x0: WX0, x1: -GRASS_MARGIN, y0: -GRASS_MARGIN, y1: PITCH_W + GRASS_MARGIN, side: 'left' },
      { x0: PITCH_L + GRASS_MARGIN, x1: WX1, y0: -GRASS_MARGIN, y1: PITCH_W + GRASS_MARGIN, side: 'right' }
    ];

    for (const band of bands) {
      for (let y = band.y0 + 0.6; y < band.y1 - 0.4; y += CROWD_SPACING) {
        for (let x = band.x0 + 0.6; x < band.x1 - 0.4; x += CROWD_SPACING) {
          // Gästeblock: hinter dem Gästetor (rechts) plus angrenzende Ecke.
          const isAway = band.side === 'right'
            || (band.side !== 'left' && x > PITCH_L + GRASS_MARGIN - 1);
          const base = isAway ? awayCol : homeCol;
          const roll = rng.next();
          let col;
          if (roll < 0.52) col = shade(base, rng.float(-0.35, 0.28));
          else if (roll < 0.78) col = neutral[rng.int(0, neutral.length - 1)];
          else col = skin[rng.int(0, skin.length - 1)];
          crowdDots.push({
            x: x + rng.float(-CROWD_JITTER, CROWD_JITTER),
            y: y + rng.float(-CROWD_JITTER, CROWD_JITTER),
            c: col,
            base,
            away: isAway,
            ph: rng.float(0, TAU)
          });
        }
      }
    }
    buildCrowdLayer(bands);
  }

  /** Rendert Ränge + Grundmasse einmalig in ein Offscreen-Canvas (Pixel-Look). */
  function buildCrowdLayer(bands) {
    if (typeof document === 'undefined') { crowdLayer = null; return; }
    const lw = Math.round(WORLD_W * CROWD_PX_PER_M);
    const lh = Math.round(WORLD_H * CROWD_PX_PER_M);
    const c = document.createElement('canvas');
    c.width = lw; c.height = lh;
    const g = c.getContext('2d');
    if (!g) { crowdLayer = null; return; }
    const LX = (wx) => (wx - WX0) * CROWD_PX_PER_M;
    const LY = (wy) => (wy - WY0) * CROWD_PX_PER_M;

    for (const band of bands) {
      const x = LX(band.x0), y = LY(band.y0);
      const w = (band.x1 - band.x0) * CROWD_PX_PER_M;
      const h = (band.y1 - band.y0) * CROWD_PX_PER_M;
      g.fillStyle = COL.standBase;
      g.fillRect(x, y, w, h);

      // Rangstufen: Streifen parallel zum Feld, nach außen dunkler (Tribünendach).
      const horizontal = band.side === 'top' || band.side === 'bottom';
      const steps = Math.floor((horizontal ? (band.y1 - band.y0) : (band.x1 - band.x0)) / CROWD_TIER_STEP);
      for (let s = 0; s < steps; s++) {
        const outward = band.side === 'top' || band.side === 'left'
          ? (steps - 1 - s) / Math.max(1, steps - 1)
          : s / Math.max(1, steps - 1);
        g.fillStyle = s % 2 ? COL.standStep : COL.standBase;
        if (horizontal) {
          g.fillRect(x, y + s * CROWD_TIER_STEP * CROWD_PX_PER_M, w, CROWD_TIER_STEP * CROWD_PX_PER_M * 0.55);
        } else {
          g.fillRect(x + s * CROWD_TIER_STEP * CROWD_PX_PER_M, y, CROWD_TIER_STEP * CROWD_PX_PER_M * 0.55, h);
        }
        // Dachschatten nach außen
        g.fillStyle = `rgba(0,0,0,${(0.42 * outward).toFixed(3)})`;
        if (horizontal) {
          g.fillRect(x, y + s * CROWD_TIER_STEP * CROWD_PX_PER_M, w, CROWD_TIER_STEP * CROWD_PX_PER_M);
        } else {
          g.fillRect(x + s * CROWD_TIER_STEP * CROWD_PX_PER_M, y, CROWD_TIER_STEP * CROWD_PX_PER_M, h);
        }
      }
      // Umlaufende Brüstung zum Spielfeld hin
      g.fillStyle = COL.barrier;
      if (band.side === 'top') g.fillRect(x, LY(band.y1) - 3, w, 3);
      else if (band.side === 'bottom') g.fillRect(x, LY(band.y0), w, 3);
      else if (band.side === 'left') g.fillRect(LX(band.x1) - 3, y, 3, h);
      else g.fillRect(LX(band.x0), y, 3, h);
    }

    const dotPx = Math.max(2, Math.round(CROWD_SPACING * CROWD_PX_PER_M * 0.55));
    for (const d of crowdDots) {
      g.fillStyle = d.c;
      g.fillRect(LX(d.x) - dotPx / 2, LY(d.y) - dotPx / 2, dotPx, dotPx);
    }
    crowdLayer = c;
  }

  function buildNoise() {
    if (!o.noise || typeof document === 'undefined') return;
    const c = document.createElement('canvas');
    c.width = NOISE_SIZE; c.height = NOISE_SIZE;
    const g = c.getContext('2d');
    if (!g) return;
    const img = g.createImageData(NOISE_SIZE, NOISE_SIZE);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 104 + Math.floor(rng.next() * 76);
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    noiseCanvas = c;
  }

  /* --- Teams & Aufstellung --------------------------------------------- */

  function buildEntities(side) {
    const t = teams[side];
    t.ents = [];
    if (!t.matchTeam) return;
    const eleven = pickEleven(t.matchTeam);
    if (!eleven.length) return;
    const slots = buildFormationSlots(t.matchTeam.tactics && t.matchTeam.tactics.formation);
    const bySlot = assignToSlots(eleven, slots.slice(0, eleven.length));

    for (let i = 0; i < bySlot.length; i++) {
      const p = bySlot[i];
      if (!p) continue;
      const slot = slots[i];
      const w = tacticToWorld(slot.x, slot.y, side);
      t.ents.push({
        p,
        side,
        role: slot.pos,
        group: POSITION_GROUP[slot.pos] || 'MIT',
        isKeeper: slot.pos === 'TW' || p.position === 'TW',
        baseX: w.x, baseY: w.y,
        x: w.x, y: w.y,
        startX: w.x, startY: w.y,
        lastX0: w.x,
        actorTarget: null,
        actorAction: null,
        dir: side === 'home' ? 1 : -1,
        frame: hash01(i, side === 'home' ? 1 : 2),
        pose: 'stand',
        speedNow: 0,
        wobble: i * 1.31 + (side === 'home' ? 0 : 0.77)
      });
    }
  }

  function allEnts() {
    return teams.home.ents.concat(teams.away.ents);
  }

  function findEnt(playerId) {
    if (!playerId) return null;
    for (const e of teams.home.ents) if (e.p && e.p.id === playerId) return e;
    for (const e of teams.away.ents) if (e.p && e.p.id === playerId) return e;
    return null;
  }

  /* --- Spielerbewegung -------------------------------------------------- */

  /**
   * Zielposition eines Spielers aus Grundordnung + Ballposition:
   * Mannschaftsverschiebung, Kompaktheit, Abwehrkette/Abseitslinie, Torwartauslauf.
   */
  function formationTarget(e) {
    const attackDir = e.side === 'home' ? 1 : -1;
    const ownGoalX = e.side === 'home' ? 0 : PITCH_L;
    const inPoss = possession === e.side;

    if (e.isKeeper) {
      const ballDepth = clamp((ball.x - ownGoalX) * attackDir, 0, PITCH_L);
      const out = 2.4 + clamp(ballDepth * 0.09, 0, KEEPER_OUT_MAX);
      return {
        x: ownGoalX + attackDir * out,
        y: clamp(PITCH_W / 2 + (ball.y - PITCH_W / 2) * 0.3, PITCH_W / 2 - 7, PITCH_W / 2 + 7)
      };
    }

    const shiftX = (ball.x - PITCH_L / 2) * (inPoss ? TEAM_SHIFT_X_ATT : TEAM_SHIFT_X_DEF);
    const shiftY = (ball.y - PITCH_W / 2) * TEAM_SHIFT_Y;
    let tx = e.baseX + shiftX;
    let ty = e.baseY + shiftY;

    // Sog zum Ball – wer nah dran ist, rückt stärker heran.
    const dist = Math.hypot(ball.x - e.baseX, ball.y - e.baseY);
    const near = clamp(1 - dist / COMPACT_RADIUS, 0, 1);
    const pull = (inPoss ? COMPACT_ATT : COMPACT_DEF) * near;
    tx = lerp(tx, ball.x, pull);
    ty = lerp(ty, ball.y, pull);

    // Abwehrkette / Abseitslinie
    if (e.group === 'ABW') {
      const ballDepth = (ball.x - ownGoalX) * attackDir;
      const maxDepth = inPoss ? LINE_MAX_DEPTH_ATT : LINE_MAX_DEPTH_DEF;
      const lineDepth = clamp(ballDepth - OFFSIDE_GAP, LINE_MIN_DEPTH, maxDepth);
      const lineX = ownGoalX + attackDir * lineDepth;
      tx = lerp(tx, lineX, LINE_BLEND);
    }

    // Stürmer bleiben vorne, laufen aber nicht ins Abseits-Nirwana.
    if (e.group === 'STU' && !inPoss) {
      tx = lerp(tx, PITCH_L / 2 + attackDir * 12, 0.25);
    }

    return {
      x: clamp(tx, 1.2, PITCH_L - 1.2),
      y: clamp(ty, 1.2, PITCH_W - 1.2)
    };
  }

  function updatePlayers(dt, phaseT) {
    const move = dt * speed;
    for (const e of allEnts()) {
      let tgt;
      if (e.actorTarget) {
        // Skriptierte Aktion: garantierte Ankunft bis zum Phasenende.
        const k = easeInOut(clamp(phaseT, 0, 1));
        tgt = { x: lerp(e.startX, e.actorTarget.x, k), y: lerp(e.startY, e.actorTarget.y, k) };
        const dx = tgt.x - e.x, dy = tgt.y - e.y;
        e.speedNow = move > 0 ? Math.hypot(dx, dy) / move : 0;
        e.x = tgt.x; e.y = tgt.y;
      } else {
        tgt = formationTarget(e);
        // Leichtes Zappeln, damit niemand wie angewurzelt steht.
        tgt.x += Math.sin(nowMs / 1000 * WOBBLE_SPEED + e.wobble) * WOBBLE_AMP;
        tgt.y += Math.cos(nowMs / 1000 * WOBBLE_SPEED * 0.83 + e.wobble * 1.7) * WOBBLE_AMP;
        const dx = tgt.x - e.x, dy = tgt.y - e.y;
        const d = Math.hypot(dx, dy);
        if (d > 1e-4) {
          let step = d * (1 - Math.exp(-PLAYER_SMOOTH * move));
          const maxStep = PLAYER_MAX_SPEED * move;
          if (step > maxStep) step = maxStep;
          e.x += (dx / d) * step;
          e.y += (dy / d) * step;
          e.speedNow = move > 0 ? step / move : 0;
        } else {
          e.speedNow = 0;
        }
      }

      // Blickrichtung
      if (Math.abs(e.x - e.lastX0) > 0.05) e.dir = e.x > e.lastX0 ? 1 : -1;
      e.lastX0 = e.x;

      // Pose & Laufanimation
      let pose = e.speedNow > RUN_POSE_SPEED ? 'lauf' : 'stand';
      if (e.actorAction && phaseT >= ACTION_POSE_AT) pose = ACTION_POSE[e.actorAction] || pose;
      if (celebrateUntil > nowMs && e.side === possession && !e.isKeeper) pose = 'jubel';
      e.pose = pose;
      e.frame = (e.frame + e.speedNow * move * STRIDE_RATE * 6) % 1;
    }
  }

  /* --- Phasen ----------------------------------------------------------- */

  function applyPhaseEnd() {
    if (!active) return;
    if (active.path) {
      const s = samplePath(active.path, 1);
      ball.x = s.x; ball.y = s.y; ball.z = 0;
      ball.trail.length = 0;
    }
    for (const e of allEnts()) {
      if (e.actorTarget) { e.x = e.actorTarget.x; e.y = e.actorTarget.y; }
      e.actorTarget = null;
      e.actorAction = null;
    }
  }

  function finishPhase() {
    if (!active) return;
    const res = active.resolve;
    applyPhaseEnd();
    active = null;
    if (res) res();
  }

  function prepPhase(phase) {
    possession = phase && phase.team === 'away' ? 'away' : 'home';
    for (const e of allEnts()) {
      e.startX = e.x; e.startY = e.y;
      e.actorTarget = null;
      e.actorAction = null;
    }
    const actors = phase && Array.isArray(phase.actors) ? phase.actors : [];
    for (const a of actors) {
      if (!a) continue;
      const e = findEnt(a.playerId);       // unbekannte Spieler werden still ignoriert
      if (!e) continue;
      if (!isFinite(a.x) || !isFinite(a.y)) continue;
      e.actorTarget = { x: clamp(a.x, 0.5, PITCH_L - 0.5), y: clamp(a.y, 0.5, PITCH_W - 0.5) };
      e.actorAction = a.action || null;
    }
    return buildBallPath(phase, ball.x, ball.y);
  }

  /* --- Kamera & Effekte -------------------------------------------------- */

  function updateCamera(dt) {
    let tx = WORLD_CX, ty = WORLD_CY, tz = 1;
    if (o.cinematic) {
      if (celebrateUntil > nowMs) {
        tx = celebrateAt.x; ty = celebrateAt.y; tz = CAM_ZOOM_GOAL;
        cam.holdUntil = nowMs + CAM_HOLD_MS;
      } else {
        const hot = ball.x < FINAL_THIRD || ball.x > PITCH_L - FINAL_THIRD
          || (active && active.phase && active.phase.kind === 'standard');
        if (active && hot) {
          tx = ball.x; ty = ball.y; tz = CAM_ZOOM_ACTION;
          cam.holdUntil = nowMs + CAM_HOLD_MS;
        } else if (cam.holdUntil > nowMs) {
          tx = ball.x; ty = ball.y; tz = CAM_ZOOM_ACTION;
        }
      }
    }
    const k = 1 - Math.exp(-CAM_SMOOTH * dt);
    cam.zoom += (tz - cam.zoom) * k;
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;

    // Nie über den Stadionrand hinausschwenken.
    const s = pxPerM();
    const halfW = viewW / (2 * s), halfH = viewH / (2 * s);
    cam.x = WORLD_W <= halfW * 2 ? WORLD_CX : clamp(cam.x, WX0 + halfW, WX1 - halfW);
    cam.y = WORLD_H <= halfH * 2 ? WORLD_CY : clamp(cam.y, WY0 + halfH, WY1 - halfH);
  }

  function updateEffects(dt) {
    if (flashBoost > 0) flashBoost = Math.max(0, flashBoost - dt * 0.55);
    if (!confetti.length) return;
    const alive = [];
    for (const c of confetti) {
      c.life -= dt;
      if (c.life <= 0) continue;
      c.vy += CONFETTI_GRAVITY * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.spin * dt;
      if (c.y < cssH + 40) alive.push(c);
    }
    confetti = alive;
  }

  function spawnConfetti() {
    const cols = [kits.home.primary, kits.home.secondary, kits.away.primary, '#f2e8cf', '#f2c500', '#ffffff'];
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      confetti.push({
        x: rng.float(0, cssW),
        y: rng.float(-cssH * 0.4, 0),
        vx: rng.float(-70, 70),
        vy: rng.float(30, 210),
        rot: rng.float(0, TAU),
        spin: rng.float(-7, 7),
        w: rng.float(3, 8),
        h: rng.float(5, 12),
        c: cols[rng.int(0, cols.length - 1)],
        life: rng.float(2.2, 4.5)
      });
    }
  }

  /* --- Zeichnen: Stadion ------------------------------------------------- */

  function drawStands() {
    if (crowdLayer) {
      const prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(crowdLayer, WX0, WY0, WORLD_W, WORLD_H);
      ctx.imageSmoothingEnabled = prev;
    } else {
      ctx.fillStyle = COL.standDark;
      ctx.fillRect(WX0, WY0, WORLD_W, WORLD_H);
    }
    if (!crowdDots.length) return;

    // Flimmernde Masse: pro Frame nur ein Ausschnitt wird neu getönt.
    const dot = CROWD_SPACING * 0.62;
    const bucket = Math.floor(nowMs / 90);
    const n = Math.min(CROWD_ANIM_COUNT, crowdDots.length);
    for (let i = 0; i < n; i++) {
      const idx = (crowdCursor + i) % crowdDots.length;
      const d = crowdDots[idx];
      const wave = 0.5 + 0.5 * Math.sin(nowMs / 380 + d.ph + d.x * 0.12);
      ctx.fillStyle = shade(d.base, -0.34 + wave * 0.5);
      ctx.fillRect(d.x - dot / 2, d.y - dot / 2, dot, dot);
    }
    crowdCursor = (crowdCursor + n) % crowdDots.length;

    // Blitzlichtgewitter (immer ein bisschen, beim Tor sehr viel)
    const p = CROWD_FLASH_BASE + flashBoost * CROWD_FLASH_GOAL;
    if (p > 0.0005) {
      const stride = p > 0.01 ? 1 : 3;
      for (let i = 0; i < crowdDots.length; i += stride) {
        if (hash01(i, bucket) >= p * stride) continue;
        const d = crowdDots[i];
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(d.x - dot * 0.6, d.y - dot * 0.6, dot * 1.2, dot * 1.2);
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(d.x - dot * 1.6, d.y - dot * 1.6, dot * 3.2, dot * 3.2);
      }
    }
  }

  function drawAdverts() {
    const x0 = -GRASS_MARGIN - ADVERT_DEPTH, y0 = -GRASS_MARGIN - ADVERT_DEPTH;
    const w = PITCH_L + 2 * (GRASS_MARGIN + ADVERT_DEPTH);
    const h = PITCH_W + 2 * (GRASS_MARGIN + ADVERT_DEPTH);
    ctx.fillStyle = COL.advertDark;
    ctx.fillRect(x0, y0, w, h);

    const cols = [kits.home.primary, COL.hudAccent, kits.away.primary, '#1c4f8f', '#8b5a2b'];
    const seg = 5.2;
    let i = 0;
    for (let x = x0; x < x0 + w; x += seg, i++) {
      ctx.fillStyle = shade(cols[i % cols.length], -0.12);
      ctx.fillRect(x, y0, seg - 0.18, ADVERT_DEPTH);
      ctx.fillStyle = shade(cols[(i + 2) % cols.length], -0.12);
      ctx.fillRect(x, y0 + h - ADVERT_DEPTH, seg - 0.18, ADVERT_DEPTH);
    }
    i = 0;
    for (let y = y0 + ADVERT_DEPTH; y < y0 + h - ADVERT_DEPTH; y += seg, i++) {
      ctx.fillStyle = shade(cols[(i + 1) % cols.length], -0.12);
      ctx.fillRect(x0, y, ADVERT_DEPTH, seg - 0.18);
      ctx.fillStyle = shade(cols[(i + 3) % cols.length], -0.12);
      ctx.fillRect(x0 + w - ADVERT_DEPTH, y, ADVERT_DEPTH, seg - 0.18);
    }
  }

  function drawGrass() {
    const gx = -GRASS_MARGIN, gy = -GRASS_MARGIN;
    const gw = PITCH_L + 2 * GRASS_MARGIN, gh = PITCH_W + 2 * GRASS_MARGIN;

    ctx.fillStyle = COL.grassEdge;
    ctx.fillRect(gx, gy, gw, gh);

    // Mähstreifen quer zur Spielrichtung
    const sw = gw / MOW_STRIPES;
    for (let i = 0; i < MOW_STRIPES; i++) {
      ctx.fillStyle = i % 2 ? COL.grassA : COL.grassB;
      ctx.fillRect(gx + i * sw, gy, sw + 0.03, gh);
    }

    // Lichtverlauf (Sonne links oben) + Vignette
    const lg = ctx.createLinearGradient(gx, gy, gx + gw, gy + gh);
    lg.addColorStop(0, 'rgba(255,255,255,0.11)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.02)');
    lg.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = lg;
    ctx.fillRect(gx, gy, gw, gh);

    const rg = ctx.createRadialGradient(PITCH_L / 2, PITCH_W / 2, 8, PITCH_L / 2, PITCH_W / 2, 74);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = rg;
    ctx.fillRect(gx, gy, gw, gh);
  }

  function drawLines() {
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = LINE_W;
    ctx.lineCap = 'butt';

    ctx.strokeRect(0, 0, PITCH_L, PITCH_W);

    ctx.beginPath();
    ctx.moveTo(PITCH_L / 2, 0);
    ctx.lineTo(PITCH_L / 2, PITCH_W);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(PITCH_L / 2, PITCH_W / 2, CIRCLE_R, 0, TAU);
    ctx.stroke();

    ctx.fillStyle = COL.line;
    ctx.beginPath();
    ctx.arc(PITCH_L / 2, PITCH_W / 2, 0.22, 0, TAU);
    ctx.fill();

    for (const side of [0, 1]) {
      const gx = side ? PITCH_L : 0;
      const dir = side ? -1 : 1;   // ins Feld hinein
      const my = PITCH_W / 2;

      ctx.strokeRect(gx, my - PEN_HALF_W, dir * PEN_DEPTH, PEN_HALF_W * 2);
      ctx.strokeRect(gx, my - BOX_HALF_W, dir * BOX_DEPTH, BOX_HALF_W * 2);

      const spot = gx + dir * PENALTY_SPOT;
      ctx.beginPath();
      ctx.arc(spot, my, 0.22, 0, TAU);
      ctx.fill();

      ctx.beginPath();
      if (side === 0) ctx.arc(spot, my, CIRCLE_R, -D_ANGLE, D_ANGLE);
      else ctx.arc(spot, my, CIRCLE_R, Math.PI - D_ANGLE, Math.PI + D_ANGLE);
      ctx.stroke();
    }

    // Eckviertel (jeder Bogen beginnt an seinem eigenen Startpunkt – sonst Sehnen)
    ctx.beginPath();
    ctx.moveTo(CORNER_R, 0);
    ctx.arc(0, 0, CORNER_R, 0, Math.PI / 2);
    ctx.moveTo(PITCH_L, CORNER_R);
    ctx.arc(PITCH_L, 0, CORNER_R, Math.PI / 2, Math.PI);
    ctx.moveTo(PITCH_L - CORNER_R, PITCH_W);
    ctx.arc(PITCH_L, PITCH_W, CORNER_R, Math.PI, Math.PI * 1.5);
    ctx.moveTo(0, PITCH_W - CORNER_R);
    ctx.arc(0, PITCH_W, CORNER_R, Math.PI * 1.5, TAU);
    ctx.stroke();
  }

  function drawGoal(side) {
    const gx = side ? PITCH_L : 0;
    const dir = side ? 1 : -1;              // Netz zeigt nach außen
    const y0 = PITCH_W / 2 - GOAL_HALF_W;
    const y1 = PITCH_W / 2 + GOAL_HALF_W;
    const bx = gx + dir * GOAL_DEPTH;
    const ins = GOAL_BACK_INSET;

    // Netzfläche
    ctx.beginPath();
    ctx.moveTo(gx, y0);
    ctx.lineTo(bx, y0 + ins);
    ctx.lineTo(bx, y1 - ins);
    ctx.lineTo(gx, y1);
    ctx.closePath();
    ctx.fillStyle = COL.netFill;
    ctx.fill();

    // Maschen
    ctx.strokeStyle = COL.net;
    ctx.lineWidth = 0.045;
    ctx.beginPath();
    const N = 7, M = 13;
    for (let k = 0; k <= N; k++) {
      const u = k / N;
      const x = lerp(gx, bx, u);
      ctx.moveTo(x, lerp(y0, y0 + ins, u));
      ctx.lineTo(x, lerp(y1, y1 - ins, u));
    }
    for (let k = 0; k <= M; k++) {
      const v = k / M;
      ctx.moveTo(gx, lerp(y0, y1, v));
      ctx.lineTo(bx, lerp(y0 + ins, y1 - ins, v));
    }
    ctx.stroke();

    // Latte (von oben nur als kräftige Linie sichtbar) + Pfosten
    ctx.strokeStyle = COL.post;
    ctx.lineWidth = 0.24;
    ctx.beginPath();
    ctx.moveTo(gx, y0);
    ctx.lineTo(gx, y1);
    ctx.stroke();
    ctx.fillStyle = COL.post;
    for (const y of [y0, y1]) {
      ctx.beginPath();
      ctx.arc(gx, y, 0.16, 0, TAU);
      ctx.fill();
    }
    // Schatten des Gestänges
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    ctx.moveTo(gx + dir * 0.25, y0 + 0.28);
    ctx.lineTo(gx + dir * 0.25, y1 + 0.28);
    ctx.stroke();
  }

  function drawCornerFlags() {
    const t = nowMs / 1000;
    const corners = [[0, 0], [PITCH_L, 0], [PITCH_L, PITCH_W], [0, PITCH_W]];
    for (let i = 0; i < corners.length; i++) {
      const [x, y] = corners[i];
      const out = x < PITCH_L / 2 ? -1 : 1;
      const wav = Math.sin(t * 2.6 + i * 1.4) * 0.3;

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(x + 0.25, y + 0.2, 0.5, 0.25, 0, 0, TAU);
      ctx.fill();

      ctx.fillStyle = kits.home.primary;
      ctx.beginPath();
      ctx.moveTo(x, y - 0.05);
      ctx.lineTo(x + out * 1.15, y - 0.5 + wav);
      ctx.lineTo(x + out * 1.05, y + 0.3 + wav * 0.6);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#f4f4f4';
      ctx.beginPath();
      ctx.arc(x, y, 0.17, 0, TAU);
      ctx.fill();
    }
  }

  function drawNoise() {
    if (!o.noise) return;
    if (!noiseCanvas) buildNoise();
    if (!noiseCanvas) return;
    if (!noisePattern) {
      try { noisePattern = ctx.createPattern(noiseCanvas, 'repeat'); } catch (err) { noisePattern = null; }
      if (!noisePattern) { o.noise = false; return; }
    }
    const x0 = w2sX(-GRASS_MARGIN), y0 = w2sY(-GRASS_MARGIN);
    const x1 = w2sX(PITCH_L + GRASS_MARGIN), y1 = w2sY(PITCH_W + GRASS_MARGIN);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = NOISE_ALPHA;
    ctx.fillStyle = noisePattern;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  }

  /* --- Zeichnen: Spieler & Ball ------------------------------------------ */

  /** Wer führt den Ball? (Nur wenn der Ball flach genug ist.) */
  function findCarrier() {
    if (ball.z > 1.6) return null;
    let best = null, bestD = CARRIER_RADIUS;
    for (const e of allEnts()) {
      const d = Math.hypot(e.x - ball.x, e.y - ball.y);
      const bonus = e.actorAction ? 0.9 : (e.side === possession ? 0.4 : 0);
      if (d - bonus < bestD) { bestD = d - bonus; best = e; }
    }
    return best;
  }

  /** Notfall-Sprite, falls drawPlayer() nicht verfügbar ist oder wirft. */
  function fallbackSprite(e, sx, sy, scale) {
    const kit = teams[e.side].kit;
    const body = e.isKeeper ? kit.keeper : kit.primary;
    const r = Math.max(2, PLAYER_SPRITE_REF_PX * scale * 0.16);
    ctx.fillStyle = shade(body, -0.45);
    ctx.beginPath();
    ctx.ellipse(sx, sy + r * 0.6, r * 1.05, r * 1.4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(sx, sy - r * 0.2, r, r * 1.25, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#d9a877';
    ctx.beginPath();
    ctx.arc(sx, sy - r * 1.5, r * 0.62, 0, TAU);
    ctx.fill();
  }

  function drawEntities() {
    const list = allEnts();
    if (!list.length) return;
    list.sort((a, b) => a.y - b.y);

    const ppm = pxPerM();
    const scale = clamp(ppm * PLAYER_VIS_HEIGHT_M / PLAYER_SPRITE_REF_PX, PLAYER_SCALE_MIN, PLAYER_SCALE_MAX);
    const carrier = findCarrier();
    const labelPx = Math.round(clamp(ppm * 1.35, 5, 15));

    for (const e of list) {
      const sx = w2sX(e.x), sy = w2sY(e.y);
      if (sx < -80 || sx > cssW + 80 || sy < -100 || sy > cssH + 100) continue;
      // Der Bodenschatten kommt aus players.js (posenabhängig) – hier bewusst keiner.

      // Ballführender: Ring unter den Füßen
      if (e === carrier) {
        const kit = teams[e.side].kit;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = Math.max(1.2, ppm * 0.12);
        ctx.beginPath();
        ctx.ellipse(sx, sy + ppm * 0.15, ppm * 1.05, ppm * 0.5, 0, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = kit.primary;
        ctx.lineWidth = Math.max(0.8, ppm * 0.07);
        ctx.beginPath();
        ctx.ellipse(sx, sy + ppm * 0.15, ppm * 1.32, ppm * 0.63, 0, 0, TAU);
        ctx.stroke();
      }

      // Sprite: Torhüter bekommen ihr eigenes Kontrasttrikot (drawKeeper),
      // Feldspieler das hier aufgelöste Vereinstrikot – so passen Ring,
      // Anzeigetafel und Trikot garantiert zusammen.
      if (!spriteBroken) {
        try {
          const drawOpts = {
            club: teams[e.side].club,
            away: teams[e.side].kit.isAway,
            pose: e.pose,
            dir: e.dir,
            frame: e.frame
          };
          if (e.isKeeper && typeof drawKeeper === 'function') {
            drawKeeper(ctx, e.p, sx, sy, scale, drawOpts);
          } else {
            drawOpts.kit = teams[e.side].kit;
            drawPlayer(ctx, e.p, sx, sy, scale, drawOpts);
          }
        } catch (err) {
          spriteBroken = true;
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('render/pitch.js: drawPlayer() nicht nutzbar, Notfall-Sprites aktiv.', err);
          }
        }
      }
      if (spriteBroken) fallbackSprite(e, sx, sy, scale);

      // Beschriftung
      if (o.labels && labelPx >= LABEL_MIN_PX) {
        const name = labelPx >= LABEL_NAME_MIN_PX ? (e.p.shortName || e.p.lastName || '') : '';
        const num = e.p.number ? String(e.p.number) : '';
        const txt = name ? `${num} ${name}`.trim() : num;
        if (txt) {
          const ly = sy + ppm * 1.15 + labelPx;
          ctx.font = `700 ${labelPx}px ${FONT_FAMILY}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(2, labelPx * 0.4);
          ctx.strokeStyle = 'rgba(0,0,0,0.85)';
          ctx.strokeText(txt, sx, ly);
          ctx.fillStyle = e.side === 'home' ? '#ffffff' : '#ffe9a8';
          ctx.fillText(txt, sx, ly);
        }
      }
    }
  }

  function drawBall() {
    const ppm = pxPerM();
    const gx = w2sX(ball.x), gy = w2sY(ball.y);
    const sx = gx, sy = gy - ball.z * ppm * BALL_LIFT;
    const r = Math.max(2.2, ppm * BALL_RADIUS_M * (1 + ball.z * 0.05));

    // Flugspur
    for (let i = 0; i < ball.trail.length; i++) {
      const t = ball.trail[i];
      const a = (i + 1) / (ball.trail.length + 1) * 0.35;
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(w2sX(t.x), w2sY(t.y) - t.z * ppm * BALL_LIFT, r * 0.55 * a * 2.4, 0, TAU);
      ctx.fill();
    }

    // Schatten am Boden
    const shX = gx + ball.z * ppm * BALL_SHADOW_DX;
    const shY = gy + ball.z * ppm * BALL_SHADOW_DY;
    ctx.fillStyle = `rgba(0,0,0,${(0.34 / (1 + ball.z * 0.22)).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(shX, shY, r * 0.95, r * 0.5, 0, 0, TAU);
    ctx.fill();

    // Ball mit rotierendem Muster
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ball.rot);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#1d1f22';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.34, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, r * 0.2, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(0.6, r * 0.12);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  /* --- Zeichnen: HUD, Banner, Konfetti ----------------------------------- */

  function drawHud() {
    const barW = clamp(cssW * 0.52, 250, 470);
    const barH = HUD_BAR_H;
    const x = Math.round((cssW - barW) / 2);
    const y = 8;

    bevelBox(ctx, x - 3, y - 3, barW + 6, barH + 6, COL.hudDark, 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.6)', 2);
    bevelBox(ctx, x, y, barW, barH, COL.hudBg, COL.hudLight, COL.hudDark, 2);

    ctx.textBaseline = 'middle';
    const my = y + barH / 2;

    // Farbchips + Kürzel
    const chip = 16;
    ctx.fillStyle = kits.home.primary;
    ctx.fillRect(x + 8, my - chip / 2, chip, chip);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 8.5, my - chip / 2 + 0.5, chip - 1, chip - 1);

    ctx.fillStyle = kits.away.primary;
    ctx.fillRect(x + barW - 8 - chip, my - chip / 2, chip, chip);
    ctx.strokeRect(x + barW - 8 - chip + 0.5, my - chip / 2 + 0.5, chip - 1, chip - 1);

    ctx.font = `800 15px ${FONT_FAMILY}`;
    ctx.fillStyle = COL.hudText;
    spacedText(ctx, teams.home.abbr, x + 30, my, 1.6, 'left');
    spacedText(ctx, teams.away.abbr, x + barW - 30, my, 1.6, 'right');

    ctx.font = `800 20px ${FONT_FAMILY}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    spacedText(ctx, `${clock.score[0]} : ${clock.score[1]}`, x + barW / 2, my + 1, 2, 'center');

    // Uhr darunter
    const cw = HUD_CLOCK_W, ch = HUD_CLOCK_H;
    const cx = Math.round((cssW - cw) / 2), cy = y + barH + 4;
    bevelBox(ctx, cx, cy, cw, ch, COL.hudDark, COL.hudLight, '#000000', 2);
    const mins = Math.max(0, Math.round(clock.minute));
    const add = Math.max(0, Math.round(clock.addedTime));
    ctx.font = `700 12px ${FONT_FAMILY}`;
    ctx.fillStyle = COL.hudAccent;
    ctx.textAlign = 'center';
    spacedText(ctx, add > 0 ? `${mins}'+${add}` : `${mins}'`, cx + cw / 2, cy + ch / 2, 1.4, 'center');
  }

  function drawBanner() {
    if (!banner) return;
    const p = (nowMs - banner.t0) / banner.dur;
    if (p >= 1) { banner = null; return; }
    const inS = clamp(p / 0.16, 0, 1);
    const outS = clamp((1 - p) / 0.22, 0, 1);
    const sc = 0.7 + easeOutBack(inS) * 0.3;

    ctx.save();
    ctx.globalAlpha = outS;
    ctx.translate(cssW / 2, cssH * 0.42);
    ctx.scale(sc, sc);

    ctx.font = `900 40px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const txt = String(banner.text).toUpperCase();
    let tw = 0;
    for (const chx of txt) tw += ctx.measureText(chx).width + 5;
    const bw = Math.max(180, tw + 56), bh = 74;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundedRect(ctx, -bw / 2 + 6, -bh / 2 + 7, bw, bh, 8);
    ctx.fill();
    bevelBox(ctx, -bw / 2, -bh / 2, bw, bh, COL.bannerBg, COL.bannerLight, COL.bannerDark, 3);

    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.fillStyle = '#fff3c4';
    spacedText(ctx, txt, 0, 2, 5, 'center', true);
    ctx.restore();
  }

  function drawConfetti() {
    for (const c of confetti) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.c;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }
  }

  /* --- Frame ------------------------------------------------------------- */

  function draw() {
    if (destroyed) return;
    measure();

    applyScreen();
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, cssW, cssH);

    applyWorld();
    drawStands();
    drawAdverts();
    drawGrass();
    drawLines();
    drawGoal(0);
    drawGoal(1);
    drawCornerFlags();

    applyScreen();
    drawNoise();
    drawEntities();
    drawBall();
    if (o.hud) drawHud();
    drawBanner();
    drawConfetti();
  }

  function tick(ts) {
    if (destroyed) return;
    raf = requestAnimationFrame(tick);
    if (!lastTs) lastTs = ts;
    // Echte vergangene Zeit für den Phasenfortschritt, gedeckeltes dt für die
    // Bewegung: Ein auf 60 ms gedeckeltes dt würde bei niedriger Bildrate (Timer-
    // Ersatz, ausgebremster Tab, schwaches Gerät) die Phase beliebig verlangsamen –
    // playPhase() käme dann nie ans Ende und das Promise bliebe offen.
    const elapsed = clamp((ts - lastTs) / 1000, 0, 5);
    const dt = clamp(elapsed, 0, 0.06);
    lastTs = ts;
    nowMs = ts;

    // Phasenfortschritt
    let phaseT = 1;
    if (active) {
      active.t += (elapsed * speed) / active.dur;
      phaseT = clamp(active.t, 0, 1);
      if (active.path) {
        const s = samplePath(active.path, phaseT);
        const moved = Math.hypot(s.x - ball.x, s.y - ball.y);
        ball.rot += moved * BALL_SPIN;
        ball.trail.push({ x: ball.x, y: ball.y, z: ball.z });
        while (ball.trail.length > BALL_TRAIL) ball.trail.shift();
        ball.x = s.x; ball.y = s.y; ball.z = s.z;
      }
    } else if (ball.trail.length) {
      ball.trail.shift();
    }

    updatePlayers(dt, phaseT);
    updateCamera(dt);
    updateEffects(dt);
    draw();

    if (active && active.t >= 1) finishPhase();
  }

  /* --- Öffentliche API ---------------------------------------------------- */

  const view = {
    /** MatchTeam-Objekte übernehmen: Trikots klären, Ränge einfärben, Elf aufstellen. */
    setTeams(homeTeam, awayTeam) {
      if (destroyed) return view;
      teams.home.matchTeam = homeTeam || null;
      teams.away.matchTeam = awayTeam || null;
      teams.home.club = (homeTeam && homeTeam.club) || null;
      teams.away.club = (awayTeam && awayTeam.club) || null;
      kits = resolveKits(teams.home.club, teams.away.club);
      teams.home.kit = kits.home;
      teams.away.kit = kits.away;
      teams.home.abbr = (teams.home.club && (teams.home.club.abbr || teams.home.club.shortName)) || 'HEI';
      teams.away.abbr = (teams.away.club && (teams.away.club.abbr || teams.away.club.shortName)) || 'GAS';
      buildEntities('home');
      buildEntities('away');
      buildCrowd();
      return view;
    },

    /** Grundordnung aus tactics.formation aufstellen (Spieler springen auf ihre Position). */
    setFormationPositions() {
      if (destroyed) return view;
      buildEntities('home');
      buildEntities('away');
      ball.x = PITCH_L / 2; ball.y = PITCH_W / 2; ball.z = 0; ball.trail.length = 0;
      return view;
    },

    /**
     * Animiert eine Phase (Ballweg + Spielerbewegung).
     * @returns {Promise<void>} – löst am Ende der Phase auf, nie hängend.
     */
    playPhase(phase) {
      if (destroyed || !phase) return Promise.resolve();
      finishPhase();                       // eine noch laufende Phase sofort abschließen
      const path = prepPhase(phase);
      const dur = Math.max(0.2, isFinite(phase.duration) ? phase.duration : 3);

      if (speed >= 8) {
        // Bei Höchstgeschwindigkeit direkt in den Endzustand springen.
        active = { phase, path, t: 1, dur, resolve: null };
        applyPhaseEnd();
        active = null;
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        active = { phase, path, t: 0, dur, resolve };
      });
    },

    /** Ein Standbild zeichnen (z. B. vor dem Anpfiff). */
    renderStatic() {
      if (destroyed) return view;
      draw();
      return view;
    },

    /** Geschwindigkeit: 0.5 | 1 | 2 | 4 | 8 (ab 8 werden Animationen übersprungen). */
    setSpeed(mult) {
      const m = Number(mult);
      speed = clamp(isFinite(m) && m > 0 ? m : 1, 0.25, 16);
      if (speed >= 8) finishPhase();
      return view;
    },

    /** Großes Banner einblenden. Enthält der Text „TOR", gibt es Jubel dazu. */
    showBanner(text, ms = BANNER_DEFAULT_MS) {
      if (destroyed) return view;
      const dur = Math.max(250, (isFinite(ms) ? ms : BANNER_DEFAULT_MS) / clamp(speed, 1, BANNER_MAX_SPEEDUP));
      banner = { text: String(text == null ? '' : text), t0: nowMs, dur };
      if (isGoalBanner(text)) view.celebrate();
      return view;
    },

    /** Uhr, Nachspielzeit und Spielstand für die Anzeigetafel setzen. */
    setClock(minute, addedTime, score) {
      clock = {
        minute: isFinite(minute) ? minute : 0,
        addedTime: isFinite(addedTime) ? addedTime : 0,
        score: Array.isArray(score) && score.length >= 2 ? [score[0] | 0, score[1] | 0] : clock.score
      };
      return view;
    },

    /** Torjubel: Konfetti, Blitzlichtgewitter und (bei cinematic) Kamerazoom. */
    celebrate(at) {
      if (destroyed) return view;
      celebrateUntil = nowMs + CELEBRATE_MS;
      celebrateAt = {
        x: clamp(at && isFinite(at.x) ? at.x : ball.x, 12, PITCH_L - 12),
        y: clamp(at && isFinite(at.y) ? at.y : ball.y, 10, PITCH_W - 10)
      };
      flashBoost = 1;
      spawnConfetti();
      return view;
    },

    /** Nach Layout-Änderungen; wird sonst automatisch pro Frame erledigt. */
    resize() {
      if (!destroyed) { measure(); draw(); }
      return view;
    },

    /** Loop stoppen, Listener entfernen, offene playPhase-Promises auflösen. */
    destroy() {
      if (destroyed) return;
      finishPhase();
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
      if (ro) { try { ro.disconnect(); } catch (err) { /* egal */ } }
      crowdDots = [];
      crowdLayer = null;
      noiseCanvas = null;
      noisePattern = null;
      confetti = [];
      banner = null;
    }
  };

  /* --- Initialisierung ---------------------------------------------------- */

  function onResize() { if (!destroyed) measure(); }

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    try {
      ro = new ResizeObserver(onResize);
      ro.observe(canvas);
    } catch (err) { ro = null; }
  }
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize);

  teams.home.kit = kits.home;
  teams.away.kit = kits.away;
  measure();
  buildNoise();
  buildCrowd();
  raf = requestAnimationFrame(tick);

  return view;
}
