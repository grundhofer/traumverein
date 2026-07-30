/**
 * render/portraits.js — Prozedurale Spielerköpfe im Anstoß-Comic-Look.
 *
 * Alles wird mit Canvas-Pfaden gezeichnet: keine Bilder, keine Emojis, keine
 * Weichzeichner, keine Verläufe. Flächen sind flach, Kanten haben eine dicke
 * dunkle Outline – so bleiben die Gesichter auch bei 32–48 px lesbar.
 *
 * WICHTIG: Die Darstellung ist **vollständig deterministisch**. Gleiches
 * `appearance`-Objekt + gleiches Alter ⇒ pixelgleiches Bild. Kleine
 * Detailvariationen (Ohrgröße, Afro-Beulen, Stoppelpunkte) kommen aus einem
 * Hash über das appearance-Objekt, nie aus einer Zufallsquelle.
 *
 * Koordinatensystem („Kopf-Einheiten"):
 *   Der Kopf wird in einem Einheitenraum gezeichnet, in dem er rund 100
 *   Einheiten hoch ist. (0,0) ist die Kopfmitte, −y = oben, +x = rechts
 *   (aus Betrachtersicht). Erst am Ende wird auf die gewünschte Pixelgröße
 *   skaliert. Alle Maße unten sind daher in Prozent der Kopfhöhe lesbar.
 *
 * Diese Datei ist außerdem die gemeinsame Werkzeugkiste für render/players.js
 * (Hautpaletten, Haarpaletten, Farbmathematik, Trikotmuster) – dort wird
 * NICHTS davon dupliziert.
 *
 * Öffentlicher Vertrag (docs/CONTRACTS.md §10):
 *   drawFace(ctx, appearance, x, y, size, opts)
 *   drawPortrait(ctx, player, x, y, size, opts)
 *   portraitDataURL(player, size)
 *   clearPortraitCache()
 */

import { hashString } from '../core/rng.js';
import { clamp } from '../core/util.js';
import { DEFAULT_COLORS } from '../core/constants.js';
import { kitColors } from './kits.js';

/* ══════════════════════════════════════════════════════════════════════════
   BALANCING / STIL – hier schrauben, nicht im Zeichencode
   ══════════════════════════════════════════════════════════════════════════ */

/** Detailstufen. Kleine Sprites zeichnen weniger, damit das Feld flüssig bleibt. */
export const DETAIL = { LOW: 0, MID: 1, FULL: 2 };

/** Ab welcher gezeichneten Kopfhöhe (px) welche Detailstufe greift. */
const DETAIL_PX_MID = 13;
const DETAIL_PX_FULL = 30;

/** Mindeststärke einer Outline in Bildschirm-Pixeln (gegen unsichtbare Linien). */
const MIN_PX_LINE = 0.85;

/** Linienstärken in Kopf-Einheiten (100 = Kopfhöhe). */
const LW_HEAD = 4.0;   // Kopfsilhouette, Haare
const LW_PART = 2.6;   // Ohren, Bart, Accessoires
const LW_FINE = 1.9;   // Augen, Nase, Mund
const LW_WRINKLE = 1.5;// Falten

/** Alterung. */
const AGE_WRINKLES = 30;   // Stirn- und Nasolabialfalten
const AGE_CROWSFEET = 34;  // Krähenfüße
const AGE_RECEDING = 33;   // Geheimratsecken + graue Schläfen
const AGE_GREY_LIGHT = 33;
const AGE_GREY_MID = 36;
const AGE_GREY_STRONG = 40;

/** Portrait-Kasten: Maße in Prozent der Kastenkante (100 = size). */
const P_HEAD_H = 62;       // Kopfhöhe im Portrait
const P_HEAD_CY = -11;     // Kopfmitte relativ zur Kastenmitte
const P_NECK_TOP = 12;
const P_SHOULDER_Y = 27;   // Oberkante Schultern
const P_BOTTOM = 50;       // Unterkante Kasten
const P_SHOULDER_W = 47;   // halbe Schulterbreite unten

/** Größe des Portrait-Caches (Anzahl DataURLs), danach wird geleert. */
const PORTRAIT_CACHE_MAX = 400;

/**
 * Sechs Hauttöne, realistisch abgestuft (hell → sehr dunkel).
 * base   = Grundton der Fläche
 * shade  = Schattenseite (Licht kommt von oben links)
 * light  = Glanzlicht auf Stirn/Wange
 * deep   = tiefer Schatten (unter Kinn, Augenhöhle)
 * line   = Outline-Farbe, dunkel aber nicht schwarz
 */
export const SKIN_TONES = [
  { base: '#f7dcc4', shade: '#e2bb9c', light: '#fdeee0', deep: '#c99a78', line: '#5e3a24' },
  { base: '#eec49c', shade: '#d5a175', light: '#fadfc2', deep: '#b8814f', line: '#553824' },
  { base: '#d9a166', shade: '#bc8046', light: '#eec294', deep: '#9c642f', line: '#48290f' },
  { base: '#b1743d', shade: '#925625', light: '#cd9a63', deep: '#7a4318', line: '#3a220c' },
  { base: '#7e4a25', shade: '#623312', light: '#9c6a3e', deep: '#4d2609', line: '#2a1607' },
  { base: '#5a3320', shade: '#42200f', light: '#78492f', deep: '#2f1508', line: '#1c0d05' }
];

/**
 * Acht Gesichtsformen. Alle Werte in Kopf-Einheiten, (0,0) = Kopfmitte.
 *   top    – Scheitelhöhe (negativ)
 *   chinY  – Kinnunterkante
 *   brow   – halbe Breite an der Stirn/Schläfe
 *   w      – halbe Breite an der breitesten Stelle (Wangenknochen)
 *   cheekY – Höhe der breitesten Stelle
 *   jaw    – halbe Breite am Kieferwinkel
 *   jawY   – Höhe des Kieferwinkels
 *   chinW  – halbe Breite des Kinns
 *   square – 0 = rund/weich, 1 = kantig/eckig
 *   Feature-Felder steuern Nase, Mund, Brauen und Augenhöhe.
 */
export const FACE_SHAPES = [
  { key: 'oval', name: 'Oval',
    top: -48, chinY: 48, brow: 34, w: 37, cheekY: 1, jaw: 30, jawY: 26, chinW: 15,
    square: 0.22, noseW: 7.0, noseLen: 19, mouthW: 15, browThick: 4.4, eyeY: -6, eyeW: 13, cheekbone: 0 },

  { key: 'rund', name: 'Rund',
    top: -46, chinY: 44, brow: 37, w: 42, cheekY: 4, jaw: 37, jawY: 24, chinW: 21,
    square: 0.12, noseW: 7.6, noseLen: 17, mouthW: 15, browThick: 4.2, eyeY: -5, eyeW: 13, cheekbone: 0 },

  { key: 'kantig', name: 'Kantig',
    top: -47, chinY: 46, brow: 39, w: 40, cheekY: -4, jaw: 38, jawY: 28, chinW: 27,
    square: 0.88, noseW: 8.2, noseLen: 20, mouthW: 17, browThick: 5.6, eyeY: -6, eyeW: 13, cheekbone: 0.5 },

  { key: 'schmal', name: 'Schmal',
    top: -50, chinY: 50, brow: 29, w: 32, cheekY: -1, jaw: 25, jawY: 26, chinW: 12,
    square: 0.30, noseW: 6.0, noseLen: 21, mouthW: 12, browThick: 3.8, eyeY: -7, eyeW: 12, cheekbone: 0.7 },

  { key: 'herz', name: 'Herzförmig',
    top: -47, chinY: 50, brow: 40, w: 39, cheekY: -9, jaw: 26, jawY: 22, chinW: 9,
    square: 0.15, noseW: 6.6, noseLen: 18, mouthW: 14, browThick: 4.0, eyeY: -6, eyeW: 13, cheekbone: 0.6 },

  { key: 'lang', name: 'Lang',
    top: -53, chinY: 55, brow: 32, w: 35, cheekY: 0, jaw: 30, jawY: 31, chinW: 16,
    square: 0.38, noseW: 6.8, noseLen: 23, mouthW: 14, browThick: 4.4, eyeY: -9, eyeW: 12, cheekbone: 0.3 },

  { key: 'breit', name: 'Breit',
    top: -44, chinY: 42, brow: 41, w: 46, cheekY: 5, jaw: 41, jawY: 24, chinW: 25,
    square: 0.45, noseW: 8.8, noseLen: 16, mouthW: 18, browThick: 5.0, eyeY: -5, eyeW: 14, cheekbone: 0.2 },

  { key: 'markant', name: 'Markant',
    top: -48, chinY: 49, brow: 38, w: 42, cheekY: -7, jaw: 39, jawY: 29, chinW: 23,
    square: 0.70, noseW: 8.0, noseLen: 21, mouthW: 16, browThick: 6.0, eyeY: -6, eyeW: 13, cheekbone: 1 }
];

/** Frisuren-Grundformen: Volumen (puff), seitliche Länge (sideY), Breite (sideX),
 *  Stirnbedeckung (fringe, größer = tiefer in die Stirn). */
const HAIR_CAPS = {
  kurz: { puff: 4, sideY: -12, sideX: 1.02, fringe: 2 },
  mittel: { puff: 7, sideY: 4, sideX: 1.07, fringe: 5 },
  lang: { puff: 8, sideY: 18, sideX: 1.10, fringe: 6 },
  afro: { puff: 21, sideY: -3, sideX: 1.22, fringe: 3 },
  vokuhila: { puff: 6, sideY: -9, sideX: 1.03, fringe: 3 },
  zopf: { puff: 5, sideY: -16, sideX: 0.99, fringe: -3 },
  undercut: { puff: 11, sideY: -19, sideX: 0.97, fringe: 2 },
  locken: { puff: 12, sideY: 2, sideX: 1.13, fringe: 4 },
  irokese: { puff: 3, sideY: -21, sideX: 0.93, fringe: -5 }
};

export const HAIR_STYLES = Object.keys(HAIR_CAPS).concat('glatze');
export const BEARD_STYLES = ['keiner', 'stoppeln', 'schnauzer', 'vollbart', 'kinnbart', 'koteletten'];

/** Standard-Aussehen, falls ein Objekt unvollständig ist (z. B. Schiedsrichter). */
const DEFAULT_APPEARANCE = {
  skin: 1, hair: 'kurz', hairColor: '#2b1d14', beard: 'keiner',
  build: 'normal', height: 180, eyes: '#3a2a1a', accessory: 'keiner', face: 0
};

/* ══════════════════════════════════════════════════════════════════════════
   FARB-WERKZEUGE (auch von players.js benutzt)
   ══════════════════════════════════════════════════════════════════════════ */

function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim();
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function toHex(r, g, b) {
  const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/** amt > 0 hellt auf, amt < 0 dunkelt ab (−1 … 1). */
export function shadeColor(hex, amt) {
  const c = parseHex(hex);
  if (!c) return hex;
  if (amt >= 0) return toHex(c.r + (255 - c.r) * amt, c.g + (255 - c.g) * amt, c.b + (255 - c.b) * amt);
  const f = 1 + amt;
  return toHex(c.r * f, c.g * f, c.b * f);
}

/** Lineare Mischung zweier Farben, t = 0 → a, t = 1 → b. */
export function mixHex(a, b, t) {
  const ca = parseHex(a), cb = parseHex(b);
  if (!ca || !cb) return a;
  return toHex(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t);
}

/** Wahrgenommene Helligkeit 0..1. */
export function luminance(hex) {
  const c = parseHex(hex);
  if (!c) return 0.5;
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

/** Gut lesbare Schrift-/Zeichenfarbe auf dem übergebenen Untergrund. */
export function readableInk(hex, dark = '#15100b', light = '#ffffff') {
  return luminance(hex) > 0.56 ? dark : light;
}

/** Hautpalette zu einem skin-Index (0..5). */
export function skinPalette(skin) {
  return SKIN_TONES[clamp(Math.round(skin) || 0, 0, SKIN_TONES.length - 1)];
}

/**
 * Haarpalette inkl. Ergrauen nach Alter.
 * `temple` ist der Ton für die grauen Schläfen ab 33.
 */
export function hairPalette(hairColor, age = 26) {
  const raw = hairColor || DEFAULT_APPEARANCE.hairColor;
  const grey = age >= AGE_GREY_STRONG ? 0.5 : age >= AGE_GREY_MID ? 0.32 : age >= AGE_GREY_LIGHT ? 0.16 : 0;
  const base = grey ? mixHex(raw, '#b8b3ab', grey) : raw;
  return {
    raw,
    base,
    shade: shadeColor(base, -0.34),
    light: shadeColor(base, 0.26),
    line: shadeColor(base, -0.62),
    temple: mixHex(base, '#dedad2', age >= AGE_RECEDING ? 0.6 : 0)
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   DETERMINISTISCHE MIKROVARIATION (kein Zufall!)
   ══════════════════════════════════════════════════════════════════════════ */

/** Stabiler Seed aus dem appearance-Objekt. */
function appearanceSeed(app) {
  return hashString([app.skin, app.hair, app.hairColor, app.beard, app.build,
    app.height, app.eyes, app.accessory, app.face].join('|'));
}

/**
 * Deterministischer Pseudowert [0,1) aus Seed + Kanal.
 * Voll durchmischend (murmur-artige Finalisierung) – benachbarte Kanäle
 * müssen unabhängig streuen, sonst klumpen z. B. die Bartstoppeln.
 */
function det(seed, channel) {
  let x = (seed + Math.imul(channel, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
}

/** Fehlende Felder auffüllen, damit nie etwas undefined ist. */
export function normalizeAppearance(app) {
  const a = app || {};
  return {
    skin: a.skin === undefined ? DEFAULT_APPEARANCE.skin : clamp(a.skin | 0, 0, 5),
    hair: (HAIR_CAPS[a.hair] || a.hair === 'glatze') ? a.hair : DEFAULT_APPEARANCE.hair,
    hairColor: a.hairColor || DEFAULT_APPEARANCE.hairColor,
    beard: BEARD_STYLES.indexOf(a.beard) >= 0 ? a.beard : 'keiner',
    build: a.build || DEFAULT_APPEARANCE.build,
    height: a.height || DEFAULT_APPEARANCE.height,
    eyes: a.eyes || DEFAULT_APPEARANCE.eyes,
    accessory: a.accessory || 'keiner',
    face: clamp((a.face | 0), 0, FACE_SHAPES.length - 1)
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   TRIKOTFARBEN (gemeinsam mit players.js)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Holt die Trikotfarben aus render/kits.js und normalisiert sie auf
 * { primary, secondary, shorts, socks, pattern }. Fällt notfalls auf die
 * Rohdaten des Vereins zurück, damit ein einzelnes fehlendes Feld nie das
 * ganze Rendering kippt.
 */
export function resolveKitColors(club, away = false) {
  const c = (club && club.colors) || DEFAULT_COLORS;
  const kit = (club && club.kit) || {};
  const ak = (club && club.awayKit) || {};
  const fb = away
    ? {
      primary: ak.primary || c.secondary || '#ffffff',
      secondary: ak.secondary || c.primary || '#222222',
      shorts: ak.shorts || ak.secondary || c.primary || '#222222',
      socks: ak.socks || ak.primary || c.secondary || '#ffffff',
      pattern: ak.pattern || 'plain'
    }
    : {
      primary: c.primary || DEFAULT_COLORS.primary,
      secondary: c.secondary || DEFAULT_COLORS.secondary,
      shorts: kit.shorts || c.primary || DEFAULT_COLORS.primary,
      socks: kit.socks || c.primary || DEFAULT_COLORS.primary,
      pattern: kit.pattern || 'plain'
    };
  let k = null;
  try { k = typeof kitColors === 'function' ? kitColors(club, away) : null; } catch (e) { k = null; }
  if (!k || typeof k !== 'object') return fb;
  return {
    primary: k.primary || k.shirt || fb.primary,
    secondary: k.secondary || k.trim || fb.secondary,
    shorts: k.shorts || fb.shorts,
    socks: k.socks || fb.socks,
    pattern: k.pattern || fb.pattern
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   PFAD-HILFEN
   ══════════════════════════════════════════════════════════════════════════ */

/** Rechteck mit runden Ecken als Pfad (ohne fill/stroke). */
export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
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

/** Ellipse als Pfad – ohne ctx.ellipse (breitere Kompatibilität). */
export function ellipsePath(ctx, cx, cy, rx, ry) {
  const k = 0.5522847498;
  ctx.beginPath();
  ctx.moveTo(cx, cy - ry);
  ctx.bezierCurveTo(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy);
  ctx.bezierCurveTo(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry);
  ctx.bezierCurveTo(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy);
  ctx.bezierCurveTo(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry);
  ctx.closePath();
}

/** Fläche füllen und (optional) mit dicker Outline umranden. */
function paint(ctx, fill, line, lw, o) {
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (line && o.outline) { ctx.strokeStyle = line; ctx.lineWidth = o.lw(lw); ctx.stroke(); }
}

/**
 * Trikotmuster in eine bereits geclippte und grundierte Fläche zeichnen.
 * Wird von drawPortrait (Schultern) UND players.js (Oberkörper) benutzt.
 *
 * @param {object} box  { x, y, w, h } Bounding-Box der Fläche im aktuellen Raum
 */
export function fillJerseyPattern(ctx, pattern, colors, box) {
  const { x, y, w, h } = box;
  const sec = colors.secondary || '#ffffff';
  ctx.save();
  ctx.fillStyle = sec;
  switch (pattern) {
    case 'stripes': {
      const n = 7;                       // 7 Bahnen ⇒ 3 Kontraststreifen
      const bw = w / n;
      for (let i = 1; i < n; i += 2) ctx.fillRect(x + i * bw, y, bw, h);
      break;
    }
    case 'hoops': {
      const n = 5;
      const bh = h / n;
      for (let i = 1; i < n; i += 2) ctx.fillRect(x, y + i * bh, w, bh);
      break;
    }
    case 'sash': {
      const bw = w * 0.42;
      ctx.beginPath();
      ctx.moveTo(x - bw * 0.2, y + h * 0.05);
      ctx.lineTo(x + bw * 0.8, y - h * 0.1);
      ctx.lineTo(x + w + bw * 0.2, y + h);
      ctx.lineTo(x + w - bw * 0.6, y + h);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'halves':
      ctx.fillRect(x + w / 2, y, w / 2, h);
      break;
    case 'chest':
      ctx.fillRect(x, y + h * 0.34, w, h * 0.26);
      break;
    default: /* plain */ break;
  }
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════════════════
   KOPFFORM
   ══════════════════════════════════════════════════════════════════════════ */

export function faceGeometry(faceIndex) {
  return FACE_SHAPES[clamp(Math.round(faceIndex) || 0, 0, FACE_SHAPES.length - 1)];
}

/**
 * Linke Kopfhälfte als Bezier-Kette (Scheitel → Kinnmitte).
 * Die rechte Hälfte wird daraus gespiegelt – so ist der Kopf garantiert
 * symmetrisch und jede Formänderung wirkt auf beiden Seiten.
 */
function headSegments(f) {
  const sq = f.square;
  const chinDrop = (1 - sq) * 5 + 1;     // wie stark das Kinn nach unten rundet
  return [
    // Scheitel → Schläfe
    { c1: [-f.brow * 0.72, f.top - 1], c2: [-f.brow * 1.06, f.top + (-20 - f.top) * 0.42], to: [-f.brow, -20] },
    // Schläfe → Wangenknochen (breiteste Stelle)
    { c1: [-f.w * (0.98 + f.cheekbone * 0.04), -20 + (f.cheekY + 20) * 0.35], c2: [-f.w, f.cheekY - 7], to: [-f.w, f.cheekY] },
    // Wange → Kieferwinkel
    {
      c1: [-f.w, f.cheekY + (f.jawY - f.cheekY) * (0.3 + sq * 0.5)],
      c2: [-f.jaw - (f.w - f.jaw) * (0.15 + sq * 0.6), f.jawY - (f.jawY - f.cheekY) * 0.22],
      to: [-f.jaw, f.jawY]
    },
    // Kieferwinkel → Kinnansatz
    {
      c1: [-f.jaw + (f.jaw - f.chinW) * 0.04, f.jawY + (f.chinY - f.jawY) * (0.42 + sq * 0.4)],
      c2: [-f.chinW - (f.jaw - f.chinW) * (0.1 + sq * 0.62), f.chinY - chinDrop * 1.4],
      to: [-f.chinW, f.chinY - chinDrop * 0.35]
    },
    // Kinnansatz → Kinnmitte
    {
      c1: [-f.chinW * (0.9 - sq * 0.45), f.chinY + (1 - sq) * 1.5],
      c2: [-f.chinW * 0.4 * (1 - sq * 0.6), f.chinY],
      to: [0, f.chinY]
    }
  ];
}

function headPath(ctx, f) {
  const segs = headSegments(f);
  ctx.beginPath();
  ctx.moveTo(0, f.top);
  for (const s of segs) ctx.bezierCurveTo(s.c1[0], s.c1[1], s.c2[0], s.c2[1], s.to[0], s.to[1]);
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    const from = i === 0 ? [0, f.top] : segs[i - 1].to;
    ctx.bezierCurveTo(-s.c2[0], s.c2[1], -s.c1[0], s.c1[1], -from[0], from[1]);
  }
  ctx.closePath();
}

/* ══════════════════════════════════════════════════════════════════════════
   FRISUREN
   ══════════════════════════════════════════════════════════════════════════ */

/** Basis-Haaransatz (y der Stirn-Grenze) für eine Kopfform. */
function hairlineY(f) { return f.top + 15; }

/**
 * Gemeinsame „Kappe": Volumen über dem Schädel + Haaransatz an der Stirn.
 * Jede Frisur benutzt sie als Grundkörper und ergänzt ihre Eigenheiten.
 */
function capPath(ctx, f, cap, o) {
  const HL = hairlineY(f);
  const rec = o.receding ? 9 : 0;
  const sx = f.w * cap.sideX;
  const templeY = HL + cap.fringe + 4 - rec;
  const peakY = HL + cap.fringe + (o.receding ? 3 : 0);

  ctx.beginPath();
  ctx.moveTo(-sx, cap.sideY);
  ctx.bezierCurveTo(-sx - cap.puff * 0.35, f.top + 12, -f.brow - cap.puff * 0.95, f.top - cap.puff, 0, f.top - cap.puff);
  ctx.bezierCurveTo(f.brow + cap.puff * 0.95, f.top - cap.puff, sx + cap.puff * 0.35, f.top + 12, sx, cap.sideY);
  ctx.lineTo(sx * 0.9, templeY);
  ctx.quadraticCurveTo(f.brow * 0.82, templeY - 2, f.brow * 0.34, peakY);
  ctx.quadraticCurveTo(0, peakY + (o.receding ? 5 : 1.5), -f.brow * 0.34, peakY);
  ctx.quadraticCurveTo(-f.brow * 0.82, templeY - 2, -sx * 0.9, templeY);
  ctx.closePath();
}

/** Glanzlicht + Schattenseite auf der Haarkappe (flach, kein Verlauf). */
function capShading(ctx, f, cap, hp, o) {
  ctx.save();
  capPath(ctx, f, cap, o);
  ctx.clip();
  // Schattenseite rechts
  ctx.fillStyle = hp.shade;
  ctx.beginPath();
  ctx.moveTo(f.w * 0.3, f.top - cap.puff - 4);
  ctx.lineTo(f.w * 2, f.top - cap.puff - 4);
  ctx.lineTo(f.w * 2, cap.sideY + 30);
  ctx.lineTo(f.w * 0.62, cap.sideY + 30);
  ctx.closePath();
  ctx.fill();
  // Glanzlicht oben links – schmaler Streifen, kein großer Fleck
  ctx.fillStyle = hp.light;
  ctx.globalAlpha = 0.6;
  ellipsePath(ctx, -f.brow * 0.5, f.top + 2 - cap.puff * 0.55, f.brow * 0.3, 3.4 + cap.puff * 0.12);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Volumen HINTER dem Kopf (wird vor dem Kopf gezeichnet). */
function drawHairBack(ctx, app, f, hp, o) {
  const style = app.hair;
  if (style === 'glatze') return;
  const seed = o.seed;
  ctx.lineJoin = 'round';

  switch (style) {
    case 'lang': {
      ellipsePath(ctx, 0, 4, f.w * 1.3, (f.chinY - f.top) * 0.62);
      paint(ctx, hp.shade, hp.line, LW_HEAD, o);
      break;
    }
    case 'locken': {
      // Lockenkranz hinter dem Kopf: überlappende Kreise
      for (let i = 0; i < 11; i++) {
        const a = Math.PI * (0.08 + 0.84 * (i / 10));
        const r = f.w * 1.12;
        const cx = -Math.cos(a) * r;
        const cy = f.top + 18 - Math.sin(a) * (f.w * 0.95);
        ellipsePath(ctx, cx, cy, 10 + det(seed, 60 + i) * 4, 10 + det(seed, 70 + i) * 4);
        paint(ctx, hp.shade, hp.line, LW_PART, o);
      }
      break;
    }
    case 'afro': {
      ellipsePath(ctx, 0, f.top + 20, f.w * 1.34, f.w * 1.24);
      paint(ctx, hp.shade, hp.line, LW_HEAD, o);
      break;
    }
    case 'vokuhila': {
      // Nackenmähne: hängt seitlich und hinten deutlich unter das Kinn
      ctx.beginPath();
      ctx.moveTo(-f.w * 1.0, f.cheekY - 6);
      ctx.bezierCurveTo(-f.w * 1.25, f.chinY * 0.6, -f.w * 1.1, f.chinY + 16, -f.w * 0.55, f.chinY + 22);
      ctx.lineTo(f.w * 0.55, f.chinY + 22);
      ctx.bezierCurveTo(f.w * 1.1, f.chinY + 16, f.w * 1.25, f.chinY * 0.6, f.w * 1.0, f.cheekY - 6);
      ctx.closePath();
      paint(ctx, hp.shade, hp.line, LW_HEAD, o);
      break;
    }
    case 'zopf': {
      // Dutt/Zopf hinter dem Kopf – Seite deterministisch aus dem Seed
      const side = det(seed, 41) < 0.5 ? -1 : 1;
      ellipsePath(ctx, side * f.w * 0.98, f.top + 14, 12, 12);
      paint(ctx, hp.base, hp.line, LW_PART, o);
      ctx.beginPath();
      ctx.moveTo(side * f.w * 0.9, f.top + 22);
      ctx.quadraticCurveTo(side * f.w * 1.35, f.cheekY + 4, side * f.w * 1.05, f.jawY + 10);
      ctx.quadraticCurveTo(side * f.w * 0.86, f.cheekY, side * f.w * 0.7, f.top + 24);
      ctx.closePath();
      paint(ctx, hp.shade, hp.line, LW_PART, o);
      break;
    }
    case 'mittel': {
      ellipsePath(ctx, 0, f.top + 26, f.w * 1.1, (f.chinY - f.top) * 0.44);
      paint(ctx, hp.shade, hp.line, LW_HEAD, o);
      break;
    }
    default:
      break;
  }
}

/** Frisur VOR/AUF dem Kopf. */
function drawHairFront(ctx, app, f, hp, o) {
  const style = app.hair;
  const seed = o.seed;
  ctx.lineJoin = 'round';

  // Glatze: nur Schädelglanz und – bei Alter – ein Haarkranz.
  if (style === 'glatze') {
    ctx.save();
    headPath(ctx, f);
    ctx.clip();
    ctx.fillStyle = o.pal.light;
    ellipsePath(ctx, -f.brow * 0.35, f.top + 12, f.brow * 0.34, 7);
    ctx.fill();
    ctx.restore();
    if (o.age >= AGE_RECEDING) {
      // Haarkranz über den Ohren
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * f.w * 0.98, f.cheekY - 16);
        ctx.quadraticCurveTo(s * f.w * 1.06, f.cheekY - 2, s * f.w * 0.9, f.cheekY + 8);
        ctx.quadraticCurveTo(s * f.w * 0.82, f.cheekY - 4, s * f.w * 0.86, f.cheekY - 16);
        ctx.closePath();
        paint(ctx, hp.temple, hp.line, LW_PART, o);
      }
    }
    return;
  }

  const cap = HAIR_CAPS[style] || HAIR_CAPS.kurz;

  // Rasierte Seiten (Undercut/Irokese): NUR die Schläfenzone, niemals über
  // die Augenpartie – sonst „frisst" die Rasur das halbe Gesicht.
  if (style === 'undercut' || style === 'irokese') {
    const y0 = style === 'irokese' ? f.top + 4 : hairlineY(f) + 1;
    const h = style === 'irokese' ? 26 : 20;
    ctx.save();
    headPath(ctx, f);
    ctx.clip();
    ctx.fillStyle = mixHex(o.pal.shade, hp.base, 0.5);
    ctx.fillRect(-f.w * 1.2, y0, f.w * 0.46, h);
    ctx.fillRect(f.w * 0.74, y0, f.w * 0.46, h);
    ctx.restore();
  }

  // Afro: wolkiger Rand aus Kreisen, damit die Silhouette nicht glatt wirkt
  if (style === 'afro') {
    for (let i = 0; i < 13; i++) {
      const a = Math.PI * (0.02 + 0.96 * (i / 12));
      const r = f.w * 1.2;
      const cx = -Math.cos(a) * r;
      const cy = f.top + 16 - Math.sin(a) * (f.w * 1.02);
      ellipsePath(ctx, cx, cy, 9 + det(seed, 80 + i) * 5, 9 + det(seed, 90 + i) * 5);
      paint(ctx, hp.base, hp.line, LW_PART, o);
    }
  }

  // Grundkappe
  capPath(ctx, f, cap, o);
  paint(ctx, hp.base, hp.line, LW_HEAD, o);
  if (o.detail >= DETAIL.MID) capShading(ctx, f, cap, hp, o);

  // Stil-Extras
  switch (style) {
    case 'kurz': {
      // Schmale Koteletten vor den Ohren
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * f.w * 0.99, cap.sideY + 1);
        ctx.lineTo(s * f.w * 0.94, cap.sideY + 11);
        ctx.lineTo(s * f.w * 0.86, cap.sideY + 9);
        ctx.lineTo(s * f.w * 0.88, cap.sideY);
        ctx.closePath();
        paint(ctx, hp.base, hp.line, LW_PART, o);
      }
      break;
    }
    case 'mittel': {
      // Seitliche Lobe über den Ohren + Scheitel
      for (const s of [-1, 1]) {
        ellipsePath(ctx, s * f.w * 0.94, f.cheekY - 12, 9, 13);
        paint(ctx, hp.base, hp.line, LW_PART, o);
      }
      if (o.detail >= DETAIL.FULL) {
        ctx.beginPath();
        ctx.moveTo(-f.brow * 0.2, f.top + 2);
        ctx.quadraticCurveTo(f.brow * 0.2, hairlineY(f) - 4, f.brow * 0.55, hairlineY(f) + cap.fringe);
        ctx.strokeStyle = hp.line; ctx.lineWidth = o.lw(LW_FINE); ctx.stroke();
      }
      break;
    }
    case 'lang': {
      // Vordere Strähnen links und rechts am Gesicht vorbei
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * f.w * 0.98, hairlineY(f) + 2);
        ctx.bezierCurveTo(s * f.w * 1.16, f.cheekY, s * f.w * 1.02, f.jawY + 8, s * f.w * 0.86, f.chinY + 4);
        ctx.lineTo(s * f.w * 0.62, f.chinY);
        ctx.bezierCurveTo(s * f.w * 0.8, f.jawY, s * f.w * 0.86, f.cheekY - 4, s * f.w * 0.8, hairlineY(f) + 6);
        ctx.closePath();
        paint(ctx, hp.base, hp.line, LW_PART, o);
      }
      break;
    }
    case 'vokuhila': {
      // Vorne kurz: harte Kante am Haaransatz
      ctx.beginPath();
      ctx.moveTo(-f.brow * 0.9, hairlineY(f) + cap.fringe);
      ctx.lineTo(f.brow * 0.9, hairlineY(f) + cap.fringe);
      ctx.strokeStyle = hp.line; ctx.lineWidth = o.lw(LW_FINE); ctx.stroke();
      break;
    }
    case 'zopf': {
      // Streng nach hinten gekämmt: Strähnenlinien
      if (o.detail >= DETAIL.MID) {
        ctx.strokeStyle = hp.line; ctx.lineWidth = o.lw(LW_FINE);
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * f.brow * 0.3, hairlineY(f) - 2);
          ctx.quadraticCurveTo(i * f.brow * 0.45, f.top + 4, i * f.brow * 0.36, f.top - 2);
          ctx.stroke();
        }
      }
      break;
    }
    case 'undercut': {
      // Volumen zur Seite gekämmt
      const s = det(seed, 42) < 0.5 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(-s * f.brow * 0.95, hairlineY(f) + 1);
      ctx.bezierCurveTo(-s * f.brow * 0.4, f.top - cap.puff - 4, s * f.brow * 0.9, f.top - cap.puff - 2, s * f.w * 0.99, hairlineY(f) - 4);
      ctx.lineTo(s * f.w * 0.95, hairlineY(f) + 5);
      ctx.bezierCurveTo(s * f.brow * 0.5, f.top + 6, -s * f.brow * 0.4, f.top + 10, -s * f.brow * 0.95, hairlineY(f) + 4);
      ctx.closePath();
      paint(ctx, hp.base, hp.line, LW_PART, o);
      break;
    }
    case 'locken': {
      // Locken am Haaransatz und an den Seiten
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const a = Math.PI * (0.06 + 0.88 * t);
        const cx = -Math.cos(a) * f.w * 1.04;
        const cy = f.top + 14 - Math.sin(a) * (f.w * 0.86);
        ellipsePath(ctx, cx, cy, 7.5 + det(seed, 100 + i) * 3.5, 7.5 + det(seed, 110 + i) * 3.5);
        paint(ctx, hp.base, hp.line, LW_PART, o);
      }
      break;
    }
    case 'irokese': {
      // Hoher Kamm in der Mitte
      const baseY = f.top + 2;
      const tipY = f.top - 26;
      ctx.beginPath();
      ctx.moveTo(-8, baseY + 6);
      for (let i = 0; i <= 4; i++) {
        const x = -8 + (16 * i) / 4;
        const peak = tipY + (i === 0 || i === 4 ? 12 : det(seed, 120 + i) * 7);
        ctx.lineTo(x - 1.5, peak);
        ctx.lineTo(x + 1.6, peak + 5);
      }
      ctx.lineTo(8, baseY + 6);
      ctx.closePath();
      paint(ctx, hp.base, hp.line, LW_PART, o);
      break;
    }
    default:
      break;
  }

  // Graue Schläfen ab 33 – exakt auf die Haarfläche geclippt
  if (o.age >= AGE_RECEDING && o.detail >= DETAIL.MID) {
    ctx.save();
    capPath(ctx, f, cap, o);
    ctx.clip();
    ctx.fillStyle = hp.temple;
    for (const s of [-1, 1]) {
      ellipsePath(ctx, s * f.w * 0.92, hairlineY(f) + 6, 7, 11);
      ctx.fill();
    }
    ctx.restore();
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   BÄRTE
   ══════════════════════════════════════════════════════════════════════════ */

function beardColor(hp, age) {
  // Bärte ergrauen früher als Kopfhaar
  return age >= AGE_GREY_MID ? mixHex(hp.base, '#cfcac2', 0.28) : shadeColor(hp.base, -0.08);
}

function drawBeard(ctx, app, f, hp, o) {
  const style = app.beard;
  if (!style || style === 'keiner') return;
  const col = beardColor(hp, o.age);
  const line = shadeColor(col, -0.55);
  const mouthY = o.FY(f.eyeY + f.noseLen + 12);
  const seed = o.seed;

  switch (style) {
    case 'stoppeln': {
      ctx.save();
      headPath(ctx, f);
      ctx.clip();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = shadeColor(col, -0.2);
      ctx.beginPath();
      ctx.moveTo(-f.w * 0.98, o.FY(f.cheekY + 6));
      ctx.quadraticCurveTo(-f.jaw, f.jawY + 6, 0, f.chinY + 2);
      ctx.quadraticCurveTo(f.jaw, f.jawY + 6, f.w * 0.98, o.FY(f.cheekY + 6));
      ctx.lineTo(f.w * 0.98, f.chinY + 6);
      ctx.lineTo(-f.w * 0.98, f.chinY + 6);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      if (o.detail >= DETAIL.FULL) {
        // Stoppelpunkte gleichmäßig über Wangen, Kinn und Oberlippe streuen
        ctx.fillStyle = line;
        const y0 = mouthY - 9, y1 = f.chinY + 3;
        for (let i = 0; i < 60; i++) {
          const u = det(seed, 200 + i * 3), v = det(seed, 201 + i * 3);
          const py = y0 + v * (y1 - y0);
          // Breite folgt der Kieferlinie (oben breit, am Kinn schmal)
          const span = f.jaw * (1.02 - 0.45 * ((py - y0) / (y1 - y0)) ** 2);
          const px = (u * 2 - 1) * span;
          if (py < mouthY + 4 && Math.abs(px) < f.mouthW * 0.75) continue; // Mund frei lassen
          ctx.fillRect(px, py, 1.3, 1.3);
        }
      }
      ctx.restore();
      break;
    }
    case 'schnauzer': {
      const w = f.mouthW * 1.25;
      ctx.beginPath();
      ctx.moveTo(-w, mouthY - 8);
      ctx.quadraticCurveTo(0, mouthY - 12, w, mouthY - 8);
      ctx.quadraticCurveTo(w * 0.95, mouthY - 1, w * 0.55, mouthY - 2.5);
      ctx.quadraticCurveTo(0, mouthY - 5.5, -w * 0.55, mouthY - 2.5);
      ctx.quadraticCurveTo(-w * 0.95, mouthY - 1, -w, mouthY - 8);
      ctx.closePath();
      paint(ctx, col, line, LW_PART, o);
      break;
    }
    case 'vollbart': {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-f.w * 1.0, o.FY(f.cheekY + 2));
      ctx.bezierCurveTo(-f.w * 1.02, f.jawY + 4, -f.jaw * 0.9, f.chinY + 12, 0, f.chinY + 14);
      ctx.bezierCurveTo(f.jaw * 0.9, f.chinY + 12, f.w * 1.02, f.jawY + 4, f.w * 1.0, o.FY(f.cheekY + 2));
      ctx.bezierCurveTo(f.w * 0.7, mouthY - 4, f.mouthW * 1.1, mouthY - 9, 0, mouthY - 6);
      ctx.bezierCurveTo(-f.mouthW * 1.1, mouthY - 9, -f.w * 0.7, mouthY - 4, -f.w * 1.0, o.FY(f.cheekY + 2));
      ctx.closePath();
      paint(ctx, col, line, LW_HEAD, o);
      // Mundöffnung freihalten
      ctx.fillStyle = shadeColor(col, -0.45);
      ellipsePath(ctx, 0, mouthY + 1, f.mouthW * 0.7, 3.2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'kinnbart': {
      // Kinnbart + schmaler Schnauzer
      ctx.beginPath();
      ctx.moveTo(-f.chinW * 1.25, mouthY + 6);
      ctx.quadraticCurveTo(-f.chinW * 1.35, f.chinY + 6, 0, f.chinY + 8);
      ctx.quadraticCurveTo(f.chinW * 1.35, f.chinY + 6, f.chinW * 1.25, mouthY + 6);
      ctx.quadraticCurveTo(0, mouthY + 2, -f.chinW * 1.25, mouthY + 6);
      ctx.closePath();
      paint(ctx, col, line, LW_PART, o);
      ctx.beginPath();
      ctx.moveTo(-f.mouthW * 1.05, mouthY - 7);
      ctx.quadraticCurveTo(0, mouthY - 10, f.mouthW * 1.05, mouthY - 7);
      ctx.quadraticCurveTo(0, mouthY - 4.5, -f.mouthW * 1.05, mouthY - 7);
      ctx.closePath();
      paint(ctx, col, line, LW_PART, o);
      break;
    }
    case 'koteletten': {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * f.w * 0.99, o.FY(f.cheekY - 14));
        ctx.lineTo(s * f.w * 0.99, f.jawY + 2);
        ctx.lineTo(s * f.w * 0.74, f.jawY - 4);
        ctx.lineTo(s * f.w * 0.8, o.FY(f.cheekY - 12));
        ctx.closePath();
        paint(ctx, col, line, LW_PART, o);
      }
      break;
    }
    default:
      break;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   GESICHTSZÜGE
   ══════════════════════════════════════════════════════════════════════════ */

function drawEars(ctx, f, o) {
  const pal = o.pal;
  const earY = o.FY(f.cheekY + 2);
  const rx = 5 + o.earSize, ry = 9 + o.earSize * 1.4;
  for (const s of [-1, 1]) {
    ellipsePath(ctx, s * (f.w * 0.99), earY, rx, ry);
    paint(ctx, pal.base, pal.line, LW_PART, o);
    if (o.detail >= DETAIL.FULL) {
      ctx.beginPath();
      ctx.moveTo(s * (f.w * 0.99 + rx * 0.15), earY - ry * 0.45);
      ctx.quadraticCurveTo(s * (f.w * 0.99 - rx * 0.5), earY, s * (f.w * 0.99 + rx * 0.1), earY + ry * 0.45);
      ctx.strokeStyle = pal.deep; ctx.lineWidth = o.lw(LW_FINE * 0.8); ctx.stroke();
    }
  }
}

function drawEyes(ctx, f, app, o) {
  const pal = o.pal;
  const eyeY = o.FY(f.eyeY);
  const dx = f.brow * 0.47;
  const ew = f.eyeW * 0.5;
  const eh = (o.mood === 'jubel' ? 3.6 : 4.6) * (0.55 + 0.45 * o.tilt);
  const browY = o.FY(f.eyeY - 12) + (o.mood === 'jubel' ? -2 : 0);
  const iris = app.eyes || '#3a2a1a';

  for (const s of [-1, 1]) {
    const cx = s * dx;

    // Augenhöhlen-Schatten (dezent – sonst wirken die Augen wie Löcher)
    if (o.detail >= DETAIL.FULL) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = pal.shade;
      ellipsePath(ctx, cx, eyeY - 1, ew * 1.2, eh * 1.35);
      ctx.fill();
      ctx.restore();
    }

    // Augapfel
    ellipsePath(ctx, cx, eyeY, ew, eh);
    paint(ctx, '#fbf7ef', pal.line, LW_FINE, o);

    // Iris + Pupille
    const irisR = Math.min(ew * 0.62, eh * 0.92);
    ctx.save();
    ellipsePath(ctx, cx, eyeY, ew, eh);
    ctx.clip();
    ellipsePath(ctx, cx + s * ew * 0.08, eyeY + eh * 0.05, irisR, irisR);
    ctx.fillStyle = iris; ctx.fill();
    ctx.strokeStyle = shadeColor(iris, -0.5); ctx.lineWidth = o.lw(1.1); ctx.stroke();
    ellipsePath(ctx, cx + s * ew * 0.08, eyeY + eh * 0.05, irisR * 0.45, irisR * 0.45);
    ctx.fillStyle = '#160f0a'; ctx.fill();
    if (o.detail >= DETAIL.FULL) {
      ctx.fillStyle = '#ffffff';
      ellipsePath(ctx, cx - s * irisR * 0.3, eyeY - irisR * 0.4, irisR * 0.26, irisR * 0.26);
      ctx.fill();
    }
    ctx.restore();

    // Oberlid (dicke Comic-Linie) + Lidfalte
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = o.lw(LW_FINE * 1.35);
    ctx.beginPath();
    ctx.moveTo(cx - ew, eyeY - eh * 0.15);
    ctx.quadraticCurveTo(cx, eyeY - eh * 1.35, cx + ew, eyeY - eh * 0.15);
    ctx.stroke();
    if (o.detail >= DETAIL.FULL) {
      ctx.lineWidth = o.lw(LW_WRINKLE);
      ctx.strokeStyle = pal.deep;
      ctx.beginPath();
      ctx.moveTo(cx - ew * 0.92, eyeY - eh * 1.5);
      ctx.quadraticCurveTo(cx, eyeY - eh * 2.4, cx + ew * 0.92, eyeY - eh * 1.5);
      ctx.stroke();
    }

    // Braue – Winkel nach Stimmung
    const innerLift = o.mood === 'frust' ? 3.5 : o.mood === 'jubel' ? -2.5 : 0;
    const th = f.browThick * (o.detail >= DETAIL.FULL ? 1 : 0.85);
    ctx.save();
    ctx.beginPath();
    const innerX = cx - s * ew * 1.1;
    const outerX = cx + s * ew * 1.25;
    ctx.moveTo(innerX, browY + innerLift);
    ctx.quadraticCurveTo(cx, browY - 3.2 - (o.mood === 'jubel' ? 2 : 0), outerX, browY + 1.5);
    ctx.lineTo(outerX, browY + 1.5 + th);
    ctx.quadraticCurveTo(cx, browY - 3.2 + th + 1, innerX, browY + innerLift + th);
    ctx.closePath();
    paint(ctx, o.hp.shade, o.hp.line, LW_FINE * 0.8, o);
    ctx.restore();

    // Krähenfüße
    if (o.age >= AGE_CROWSFEET && o.detail >= DETAIL.FULL) {
      ctx.strokeStyle = pal.deep; ctx.lineWidth = o.lw(LW_WRINKLE);
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + s * ew * 1.1, eyeY + i * 3 - 1);
        ctx.lineTo(cx + s * ew * 1.6, eyeY + i * 4 - 3);
        ctx.stroke();
      }
    }
  }
}

function drawNose(ctx, f, o) {
  const pal = o.pal;
  const top = o.FY(f.eyeY + 1);
  const tip = o.FY(f.eyeY + f.noseLen);
  const w = f.noseW;

  // Nur die untere Hälfte des Nasenrückens zeichnen – ein durchgezogenes „V"
  // von den Brauen bis zur Spitze sieht wie ein Schnabel aus.
  const bridge = top + (tip - top) * 0.5;
  ctx.beginPath();
  ctx.moveTo(-w * 0.34, bridge);
  ctx.bezierCurveTo(-w * 0.55, tip - 4, -w * 0.98, tip - 2.5, -w * 0.78, tip);
  ctx.quadraticCurveTo(0, tip + 3.4, w * 0.78, tip);
  ctx.bezierCurveTo(w * 0.98, tip - 2.5, w * 0.55, tip - 4, w * 0.34, bridge);
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = o.lw(LW_FINE);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.lineCap = 'butt';

  if (o.detail >= DETAIL.FULL) {
    ctx.fillStyle = pal.deep;
    ellipsePath(ctx, -w * 0.52, tip - 0.6, 1.5, 1.1);
    ctx.fill();
    ellipsePath(ctx, w * 0.52, tip - 0.6, 1.5, 1.1);
    ctx.fill();
    // Glanzlicht auf dem Nasenrücken
    ctx.fillStyle = pal.light;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(-w * 0.18, bridge - 4, 1.6, (tip - bridge) + 3);
    ctx.globalAlpha = 1;
  }
}

function drawMouth(ctx, f, o) {
  const pal = o.pal;
  const y = o.FY(f.eyeY + f.noseLen + 12);
  const w = f.mouthW;

  if (o.mood === 'jubel') {
    // Weit offener Jubelmund
    ctx.beginPath();
    ctx.moveTo(-w * 0.8, y - 2);
    ctx.quadraticCurveTo(0, y - 6, w * 0.8, y - 2);
    ctx.quadraticCurveTo(w * 0.7, y + 11, 0, y + 12);
    ctx.quadraticCurveTo(-w * 0.7, y + 11, -w * 0.8, y - 2);
    ctx.closePath();
    paint(ctx, '#5c2320', shadeColor(pal.line, -0.2), LW_FINE * 1.2, o);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-w * 0.8, y - 2);
    ctx.quadraticCurveTo(0, y - 6, w * 0.8, y - 2);
    ctx.quadraticCurveTo(w * 0.7, y + 11, 0, y + 12);
    ctx.quadraticCurveTo(-w * 0.7, y + 11, -w * 0.8, y - 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#fdf7ec';
    ctx.fillRect(-w, y - 3, w * 2, 3.4);
    ctx.fillStyle = '#a63c3c';
    ellipsePath(ctx, 0, y + 11, w * 0.5, 4);
    ctx.fill();
    ctx.restore();
    return;
  }

  const droop = o.mood === 'frust' ? -4.5 : 2.4;
  ctx.beginPath();
  ctx.moveTo(-w, y);
  ctx.quadraticCurveTo(0, y + droop, w, y);
  ctx.strokeStyle = shadeColor(pal.line, 0.02);
  ctx.lineWidth = o.lw(LW_FINE * 2.0);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.lineCap = 'butt';

  if (o.detail >= DETAIL.FULL) {
    // Unterlippen-Schatten
    ctx.strokeStyle = pal.shade;
    ctx.lineWidth = o.lw(LW_WRINKLE);
    ctx.beginPath();
    ctx.moveTo(-w * 0.6, y + 4.5 + droop * 0.3);
    ctx.quadraticCurveTo(0, y + 6.5 + droop * 0.3, w * 0.6, y + 4.5 + droop * 0.3);
    ctx.stroke();
    if (o.mood === 'frust') {
      // Mundwinkel betonen
      ctx.strokeStyle = pal.line;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * w, y);
        ctx.lineTo(s * w * 0.94, y + 3.5);
        ctx.stroke();
      }
    }
  }
}

/** Falten ab 30, Nasolabial ab 30, Stirnfalten ab 30. */
function drawWrinkles(ctx, f, o) {
  if (o.age < AGE_WRINKLES || o.detail < DETAIL.FULL) return;
  const pal = o.pal;
  const strength = clamp((o.age - AGE_WRINKLES) / 10, 0.25, 1);
  ctx.strokeStyle = pal.deep;
  ctx.lineWidth = o.lw(LW_WRINKLE);
  ctx.globalAlpha = 0.5 + strength * 0.5;

  // Stirnfalten
  const browTop = o.FY(f.eyeY - 16);
  const lines = o.age >= 36 ? 3 : 2;
  for (let i = 0; i < lines; i++) {
    const yy = browTop - 4 - i * 5;
    ctx.beginPath();
    ctx.moveTo(-f.brow * 0.62, yy + 1.5);
    ctx.quadraticCurveTo(0, yy - 2.5, f.brow * 0.62, yy + 1.5);
    ctx.stroke();
  }

  // Nasolabialfalten
  const nx = f.noseW * 0.8, ny = o.FY(f.eyeY + f.noseLen);
  const my = o.FY(f.eyeY + f.noseLen + 14);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * nx, ny + 1);
    ctx.quadraticCurveTo(s * (nx + 6 + strength * 3), (ny + my) / 2, s * (f.mouthW * 1.02), my + 1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* ══════════════════════════════════════════════════════════════════════════
   ACCESSOIRES AM KOPF
   ══════════════════════════════════════════════════════════════════════════ */

function drawHeadAccessory(ctx, app, f, o) {
  const acc = app.accessory;
  if (acc === 'stirnband') {
    const y = hairlineY(f) + 1;
    const col = o.bandColor;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-f.w * 1.03, y - 6);
    ctx.quadraticCurveTo(0, y - 13, f.w * 1.03, y - 6);
    ctx.lineTo(f.w * 1.03, y + 4);
    ctx.quadraticCurveTo(0, y - 3, -f.w * 1.03, y + 4);
    ctx.closePath();
    paint(ctx, col, shadeColor(col, -0.55), LW_PART, o);
    // Knoten seitlich
    ellipsePath(ctx, -f.w * 1.02, y - 2, 4, 4);
    paint(ctx, shadeColor(col, -0.18), shadeColor(col, -0.55), LW_FINE, o);
    ctx.restore();
  } else if (acc === 'brille') {
    const eyeY = o.FY(f.eyeY);
    const dx = f.brow * 0.47;
    const rw = f.eyeW * 0.72, rh = f.eyeW * 0.56;
    ctx.save();
    ctx.strokeStyle = '#241a12';
    ctx.lineWidth = o.lw(LW_FINE * 1.3);
    for (const s of [-1, 1]) {
      roundRectPath(ctx, s * dx - rw, eyeY - rh, rw * 2, rh * 2, rh * 0.55);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-dx + rw, eyeY - 1);
    ctx.lineTo(dx - rw, eyeY - 1);
    ctx.stroke();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * (dx + rw), eyeY - rh * 0.5);
      ctx.lineTo(s * f.w * 0.98, o.FY(f.cheekY - 4));
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   drawFace – der Kopf
   ══════════════════════════════════════════════════════════════════════════ */

function pickDetail(optDetail, px) {
  if (optDetail !== undefined && optDetail !== null) return clamp(optDetail | 0, 0, 2);
  if (px < DETAIL_PX_MID) return DETAIL.LOW;
  if (px < DETAIL_PX_FULL) return DETAIL.MID;
  return DETAIL.FULL;
}

/**
 * Zeichnet einen Kopf (ohne Hals/Schultern).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} appearance  siehe data/squads/_helper.js
 * @param {number} x  Mittelpunkt des Kopfes (X)
 * @param {number} y  Mittelpunkt des Kopfes (Y)
 * @param {number} size  Kopfhöhe in Pixeln (Scheitel → Kinn)
 * @param {object} [opts]
 *   age      – Alter für Falten/Ergrauen (Standard 26)
 *   mood     – 'normal' | 'jubel' | 'frust'
 *   club     – Verein (nur für die Stirnbandfarbe)
 *   away     – Auswärtstrikot
 *   scale    – zusätzlicher Faktor auf size
 *   outline  – dicke Konturen (Standard true)
 *   tilt     – 1 = frontal, < 1 = von schräg oben gesehen (players.js nutzt ~0.55)
 *   detail   – DETAIL.LOW | MID | FULL, sonst automatisch nach Größe
 */
export function drawFace(ctx, appearance, x, y, size, opts = {}) {
  const app = normalizeAppearance(appearance);
  const f = faceGeometry(app.face);
  const px = Math.abs(size * (opts.scale || 1));
  if (!(px > 0.5)) return;

  const k = px / (f.chinY - f.top);
  const cy = (f.top + f.chinY) / 2;
  const age = opts.age === undefined ? 26 : opts.age;
  const seed = appearanceSeed(app);
  const tilt = opts.tilt === undefined ? 1 : clamp(opts.tilt, 0.25, 1);
  const detail = pickDetail(opts.detail, px);

  // gemeinsamer Zustand für alle Teilroutinen
  const o = {
    age, seed, tilt, detail,
    mood: opts.mood || 'normal',
    outline: opts.outline !== false,
    pal: skinPalette(app.skin),
    hp: hairPalette(app.hairColor, age),
    receding: age >= AGE_RECEDING && app.hair !== 'glatze' && app.hair !== 'irokese',
    earSize: det(seed, 7) * 1.8 - 0.6,
    bandColor: resolveKitColors(opts.club, opts.away).primary,
    lw: (units) => Math.max(units, MIN_PX_LINE / k),
    // Feature-Y bei Neigung: Gesichtszüge rutschen nach unten und stauchen –
    // aber nur milde, sonst kleben Braue, Auge und Nase aufeinander.
    FY: (v) => v * (0.62 + 0.38 * tilt) + (1 - tilt) * 20
  };

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.translate(0, -cy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';

  if (detail === DETAIL.LOW) {
    // Winzige Darstellung: nur Silhouette, Haarfarbe, zwei Augenpunkte
    headPath(ctx, f);
    paint(ctx, o.pal.base, o.pal.line, LW_HEAD * 1.2, o);
    if (app.hair !== 'glatze') {
      const cap = HAIR_CAPS[app.hair] || HAIR_CAPS.kurz;
      capPath(ctx, f, cap, o);
      paint(ctx, o.hp.base, o.hp.line, LW_HEAD * 1.2, o);
    }
    if (px >= 8) {
      ctx.fillStyle = '#1b120b';
      for (const s of [-1, 1]) {
        ellipsePath(ctx, s * f.brow * 0.45, o.FY(f.eyeY), 3, 3.4);
        ctx.fill();
      }
    }
    ctx.restore();
    return;
  }

  drawHairBack(ctx, app, f, o.hp, o);
  drawEars(ctx, f, o);

  // Kopfform mit flacher Schattierung
  headPath(ctx, f);
  paint(ctx, o.pal.base, o.pal.line, LW_HEAD, o);
  ctx.save();
  headPath(ctx, f);
  ctx.clip();
  // Schattenseite rechts – bewusst weit außen, damit das Gesicht nicht
  // optisch in zwei Hälften zerfällt
  ctx.fillStyle = o.pal.shade;
  ctx.globalAlpha = 0.65;
  ctx.beginPath();
  ctx.moveTo(f.w * 0.58, f.top - 4);
  ctx.bezierCurveTo(f.w * 0.9, f.cheekY - 8, f.w * 0.84, f.jawY, f.chinW * 0.8, f.chinY + 4);
  ctx.lineTo(f.w * 1.4, f.chinY + 6);
  ctx.lineTo(f.w * 1.4, f.top - 4);
  ctx.closePath();
  ctx.fill();
  // Schatten unter dem Kinn
  ctx.fillStyle = o.pal.deep;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(-f.jaw, f.chinY - 2);
  ctx.quadraticCurveTo(0, f.chinY + 8, f.jaw, f.chinY - 2);
  ctx.lineTo(f.jaw, f.chinY + 10);
  ctx.lineTo(-f.jaw, f.chinY + 10);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  // Wangenknochen betonen (nur markante/kantige Formen)
  if (f.cheekbone > 0.4 && detail >= DETAIL.FULL) {
    ctx.strokeStyle = o.pal.shade;
    ctx.lineWidth = o.lw(2.2);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * f.w * 0.82, o.FY(f.cheekY - 2));
      ctx.quadraticCurveTo(s * f.w * 0.66, o.FY(f.cheekY + 12), s * f.w * 0.42, o.FY(f.cheekY + 16));
      ctx.stroke();
    }
  }
  // Stirn-Glanzlicht
  ctx.fillStyle = o.pal.light;
  ctx.globalAlpha = 0.75;
  ellipsePath(ctx, -f.brow * 0.42, o.FY(f.eyeY - 20), f.brow * 0.3, 6);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  drawEyes(ctx, f, app, o);
  drawNose(ctx, f, o);
  drawMouth(ctx, f, o);
  drawWrinkles(ctx, f, o);
  drawHairFront(ctx, app, f, o.hp, o);
  drawBeard(ctx, app, f, o.hp, o);
  drawHeadAccessory(ctx, app, f, o);

  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════════════════
   drawPortrait – Kopf + Schultern im Vereinstrikot
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Zeichnet ein quadratisches Portrait (Kopf + Schultern) mittig um (x,y).
 *
 * @param {number} size Kantenlänge des Portraits in Pixeln
 * @param {object} [opts] { age, club, away, mood, scale, outline, bg }
 */
export function drawPortrait(ctx, player, x, y, size, opts = {}) {
  const p = player || {};
  const app = normalizeAppearance(p.appearance);
  const age = opts.age === undefined ? (p.age === undefined ? 26 : p.age) : opts.age;
  const s = size * (opts.scale || 1);
  if (!(s > 1)) return;
  const k = s / 100;
  const kit = resolveKitColors(opts.club, opts.away);
  const outline = opts.outline !== false;
  const detail = pickDetail(opts.detail, s * (P_HEAD_H / 100));
  const lw = (units) => Math.max(units, MIN_PX_LINE / k);
  const ink = shadeColor(kit.primary, -0.7);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.lineJoin = 'round';

  // ── Hintergrund: flache Farbflächen, kein Verlauf
  if (opts.bg !== false) {
    const bgDark = mixHex(kit.primary, '#161d28', 0.66);
    const bgLight = mixHex(kit.primary, '#2c3648', 0.5);
    ctx.save();
    roundRectPath(ctx, -50, -50, 100, 100, 7);
    ctx.clip();
    ctx.fillStyle = bgDark;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.fillStyle = bgLight;
    ellipsePath(ctx, 0, -6, 40, 40);
    ctx.fill();
    ctx.restore();
  }

  // ── Schultern + Trikot
  const shoulderPath = () => {
    ctx.beginPath();
    ctx.moveTo(-P_SHOULDER_W, P_BOTTOM);
    ctx.lineTo(-P_SHOULDER_W, P_SHOULDER_Y + 12);
    ctx.bezierCurveTo(-P_SHOULDER_W + 3, P_SHOULDER_Y + 1, -24, P_SHOULDER_Y - 3, -13, P_SHOULDER_Y - 4);
    ctx.lineTo(13, P_SHOULDER_Y - 4);
    ctx.bezierCurveTo(24, P_SHOULDER_Y - 3, P_SHOULDER_W - 3, P_SHOULDER_Y + 1, P_SHOULDER_W, P_SHOULDER_Y + 12);
    ctx.lineTo(P_SHOULDER_W, P_BOTTOM);
    ctx.closePath();
  };

  // Hals
  const pal = skinPalette(app.skin);
  ctx.beginPath();
  ctx.moveTo(-9.5, P_NECK_TOP - 6);
  ctx.lineTo(-10.5, P_SHOULDER_Y + 3);
  ctx.lineTo(10.5, P_SHOULDER_Y + 3);
  ctx.lineTo(9.5, P_NECK_TOP - 6);
  ctx.closePath();
  ctx.fillStyle = pal.shade;
  ctx.fill();
  if (outline) { ctx.strokeStyle = pal.line; ctx.lineWidth = lw(3.4); ctx.stroke(); }

  // Trikot
  shoulderPath();
  ctx.fillStyle = kit.primary;
  ctx.fill();
  ctx.save();
  shoulderPath();
  ctx.clip();
  fillJerseyPattern(ctx, kit.pattern, kit, { x: -P_SHOULDER_W, y: P_SHOULDER_Y - 6, w: P_SHOULDER_W * 2, h: P_BOTTOM - P_SHOULDER_Y + 6 });
  // Schulterschatten links/rechts für Plastizität
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(P_SHOULDER_W - 14, P_SHOULDER_Y - 6, 14, 60);
  ctx.restore();
  if (outline) {
    shoulderPath();
    ctx.strokeStyle = ink; ctx.lineWidth = lw(3.6); ctx.stroke();
  }

  // Kragen
  ctx.beginPath();
  ctx.moveTo(-13.5, P_SHOULDER_Y - 4);
  ctx.quadraticCurveTo(0, P_SHOULDER_Y + 9, 13.5, P_SHOULDER_Y - 4);
  ctx.quadraticCurveTo(0, P_SHOULDER_Y + 4, -13.5, P_SHOULDER_Y - 4);
  ctx.closePath();
  ctx.fillStyle = kit.secondary;
  ctx.fill();
  if (outline) { ctx.strokeStyle = ink; ctx.lineWidth = lw(2.4); ctx.stroke(); }

  // Kapitänsbinde am linken Oberarm (aus Betrachtersicht)
  if (app.accessory === 'kapitaensbinde') {
    ctx.save();
    ctx.translate(-P_SHOULDER_W + 7, P_SHOULDER_Y + 20);
    ctx.rotate(-0.18);
    roundRectPath(ctx, -8, -6, 16, 12, 2);
    ctx.fillStyle = '#f2e8cf'; ctx.fill();
    if (outline) { ctx.strokeStyle = '#2a1d12'; ctx.lineWidth = lw(2.2); ctx.stroke(); }
    ctx.fillStyle = '#c1272d';
    ctx.fillRect(-8, -2.2, 16, 4.4);
    ctx.restore();
  }

  // Torwarthandschuh nur andeuten: Stulpe am unteren Bildrand
  if (app.accessory === 'handschuhe') {
    ctx.save();
    ctx.translate(P_SHOULDER_W - 12, P_BOTTOM - 6);
    ctx.rotate(0.22);
    roundRectPath(ctx, -9, -8, 18, 16, 4);
    ctx.fillStyle = mixHex(kit.secondary, '#f5f2ea', 0.4); ctx.fill();
    if (outline) { ctx.strokeStyle = '#2a1d12'; ctx.lineWidth = lw(2.4); ctx.stroke(); }
    ctx.strokeStyle = shadeColor(kit.primary, -0.2); ctx.lineWidth = lw(1.8);
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 5, -7);
      ctx.lineTo(i * 5, 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Kopf
  drawFace(ctx, app, 0, P_HEAD_CY, P_HEAD_H, {
    age, mood: opts.mood, club: opts.club, away: opts.away,
    outline, detail, tilt: opts.tilt
  });

  // Rahmen
  if (opts.bg !== false && outline) {
    roundRectPath(ctx, -50, -50, 100, 100, 7);
    ctx.strokeStyle = '#13181f';
    ctx.lineWidth = lw(3);
    ctx.stroke();
  }

  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════════════════
   CACHE / DATA-URL
   ══════════════════════════════════════════════════════════════════════════ */

const portraitCache = new Map();

function cacheKey(player, size, opts) {
  const p = player || {};
  const a = normalizeAppearance(p.appearance);
  return [
    p.id || 'anon', size, p.age === undefined ? 26 : p.age,
    opts.club ? opts.club.id || opts.club.abbr || '' : '',
    opts.away ? 'a' : 'h', opts.mood || 'n', opts.bg === false ? 'nobg' : 'bg',
    appearanceSeed(a)
  ].join(':');
}

/**
 * Portrait als PNG-DataURL – gecacht, für <img src="…">.
 * Nur im Browser sinnvoll; ohne document liefert die Funktion ''.
 *
 * @param {object} player
 * @param {number} [size=96]
 * @param {object} [opts] wie drawPortrait
 */
export function portraitDataURL(player, size = 96, opts = {}) {
  const key = cacheKey(player, size, opts);
  const hit = portraitCache.get(key);
  if (hit !== undefined) return hit;

  let url = '';
  if (typeof document !== 'undefined' && document.createElement) {
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const c = cv.getContext('2d');
    if (c) {
      drawPortrait(c, player, size / 2, size / 2, size, opts);
      url = cv.toDataURL('image/png');
    }
  }
  if (portraitCache.size >= PORTRAIT_CACHE_MAX) portraitCache.clear();
  portraitCache.set(key, url);
  return url;
}

/** Leert den Portrait-Cache (z. B. bei Saisonwechsel/Alterung). */
export function clearPortraitCache() {
  portraitCache.clear();
}
