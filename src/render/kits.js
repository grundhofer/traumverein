/**
 * render/kits.js — Trikots, Wappen und Nationalflaggen.
 *
 * Alles prozedural auf Canvas 2D gezeichnet: kein einziges Bild-Asset, keine
 * Abhängigkeiten. Aus den Stammdaten eines Vereins (docs/CONTRACTS.md 5.2)
 * entsteht deterministisch ein Trikot-Icon, ein Vereinswappen und – für die
 * Spielerlisten – die Flagge der Nationalität.
 *
 * Zeichenkonventionen dieser Datei:
 *   drawKit(ctx, club, x, y, scale)   → (x,y) ist die MITTE des Trikots
 *   drawCrest(ctx, club, x, y, size)  → (x,y) ist die MITTE des Wappens
 *   drawFlag(ctx, code, x, y, w, h)   → (x,y) ist die LINKE OBERE ECKE (wie fillRect)
 *
 * Alle Zeichenroutinen stellen den Kontext exakt so wieder her, wie sie ihn
 * vorgefunden haben (save/restore-Paare). Kein Math.random(), kein Date.now().
 */

import { DEFAULT_COLORS, NATION_NAMES } from '../core/constants.js';
import { clamp } from '../core/util.js';

// ═══════════════════════════════════════════════════════════════════════════
// BALANCING / OPTIK — hier lässt sich das gesamte Erscheinungsbild justieren
// ═══════════════════════════════════════════════════════════════════════════

/** Basisbreite eines Trikot-Icons bei scale = 1 (Pixel). */
export const KIT_BASE_SIZE = 32;

/** Trikot: Anzahl Streifen bei pattern 'stripes' bzw. Ringe bei 'hoops'. */
const KIT_STRIPE_COUNT = 5;
const KIT_HOOP_COUNT = 5;

/** Strichstärke der Umrisse, relativ zur Trikotbreite. */
const KIT_OUTLINE = 0.055;

/** Ab welchem Kontrast (0..1) zwei Trikots als unterscheidbar gelten. */
export const KIT_CLASH_THRESHOLD = 0.30;

/** Gewichtung im Kontrastmaß: Helligkeit zählt mehr als der Farbton. */
const CONTRAST_LUM_WEIGHT = 0.66;
const CONTRAST_RGB_WEIGHT = 0.34;

/** Wappen: Anteil des Motivs an der Wappenbreite. */
const CREST_MOTIF_SCALE = 0.50;
/** Vertikale Lage des Motivs (0 = oben, 1 = unten). */
const CREST_MOTIF_Y = 0.44;
/** Höhe des Schriftbands mit dem Kürzel, relativ zur Wappenhöhe. */
const CREST_BAND_H = 0.20;
/** Ein Meisterstern je N Titel … */
const TITLES_PER_STAR = 3;
/** … aber höchstens so viele Sterne. */
const MAX_STARS = 5;
/** Wenn Sterne gezeichnet werden, schrumpft das Wappen auf diesen Anteil. */
const CREST_SHRINK_WITH_STARS = 0.84;

const CREST_FONT_STACK = "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";

/** Maximale Einträge im DataURL-Cache (Wappen sind klein, aber es sind 36 Vereine × n Größen). */
const CREST_CACHE_LIMIT = 400;

// ═══════════════════════════════════════════════════════════════════════════
// FARB-HILFSMITTEL
// ═══════════════════════════════════════════════════════════════════════════

/** '#rgb' | '#rrggbb' → {r,g,b} (0..255). Unlesbares fällt auf Grau zurück. */
export function hexToRgb(hex) {
  let s = String(hex || '').trim().replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return { r: 128, g: 128, b: 128 };
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16)
  };
}

export function rgbToHex(r, g, b) {
  const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/** Relative Helligkeit 0..1 (sRGB-gewichtet, ohne Gamma – reicht hier völlig). */
export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function isLight(hex) { return luminance(hex) > 0.58; }

/** Gut lesbare Schriftfarbe auf `hex`. */
export function readableOn(hex) { return isLight(hex) ? '#14100c' : '#ffffff'; }

/** Mischt zwei Farben, t = 0 → a, t = 1 → b. */
export function mixColors(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  return rgbToHex(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t);
}

/** amt > 0 hellt auf, amt < 0 dunkelt ab (jeweils 0..1). */
export function shade(hex, amt) {
  return amt >= 0 ? mixColors(hex, '#ffffff', amt) : mixColors(hex, '#000000', -amt);
}

/**
 * Wahrgenommener Farbabstand zweier Farben, 0 (identisch) .. 1 (maximal fern).
 * Für die Auswärtstrikot-Entscheidung: Helligkeitsunterschied zählt am meisten,
 * weil Zuschauer (und Spieler) Trikots vor allem über hell/dunkel trennen.
 */
export function colorContrast(a, b) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  const dl = Math.abs(luminance(a) - luminance(b));                 // 0..1
  const dr = Math.sqrt(
    (2 * (ca.r - cb.r) ** 2 + 4 * (ca.g - cb.g) ** 2 + 3 * (ca.b - cb.b) ** 2) / (9 * 255 * 255)
  );                                                                 // 0..1
  return clamp(dl * CONTRAST_LUM_WEIGHT + dr * CONTRAST_RGB_WEIGHT, 0, 1);
}

// ═══════════════════════════════════════════════════════════════════════════
// TRIKOTFARBEN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Liefert den kompletten Farbsatz eines Trikots.
 *
 * @param {object} club   Vereinsobjekt (darf lückenhaft sein)
 * @param {boolean} away  true → Auswärtstrikot
 * @returns {{shirt:string, shirt2:string, shorts:string, socks:string, number:string, pattern:string}}
 */
export function kitColors(club, away = false) {
  const c = (club && club.colors) || DEFAULT_COLORS;
  const primary = c.primary || DEFAULT_COLORS.primary;
  const secondary = c.secondary || DEFAULT_COLORS.secondary;
  const accent = c.accent || DEFAULT_COLORS.accent;

  if (away) {
    const a = (club && club.awayKit) || {};
    const shirt = a.primary || (isLight(primary) ? shade(primary, -0.65) : secondary);
    const shirt2 = a.secondary || primary;
    return {
      shirt,
      shirt2,
      // Auswärts sind Hose/Stutzen bewusst schlicht: Shirtfarbe bzw. deren Kontrast.
      shorts: a.shorts || shirt,
      socks: a.socks || shirt,
      number: readableOn(shirt),
      pattern: a.pattern || 'plain'
    };
  }

  const kit = (club && club.kit) || {};
  return {
    shirt: primary,
    shirt2: secondary,
    shorts: kit.shorts || (isLight(primary) ? secondary : primary),
    socks: kit.socks || primary,
    number: readableOn(kit.pattern === 'halves' || kit.pattern === 'stripes'
      ? mixColors(primary, secondary, 0.4) : primary),
    pattern: kit.pattern || 'plain',
    accent
  };
}

/**
 * Muss der Gast im Auswärtstrikot antreten? Verglichen wird das Heimtrikot des
 * Gastgebers gegen das Heimtrikot des Gastes – inklusive der Zweitfarbe, falls
 * gestreift/geteilt gespielt wird.
 */
export function needsAwayKit(homeClub, awayClub) {
  const h = kitColors(homeClub, false);
  const a = kitColors(awayClub, false);

  const homeTones = [h.shirt];
  if (h.pattern !== 'plain') homeTones.push(h.shirt2);
  const awayTones = [a.shirt];
  if (a.pattern !== 'plain') awayTones.push(a.shirt2);

  let worst = 1;
  for (const ht of homeTones) {
    for (const at of awayTones) worst = Math.min(worst, colorContrast(ht, at));
  }
  return worst < KIT_CLASH_THRESHOLD;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRIKOT ZEICHNEN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trikot-Silhouette in lokalen Koordinaten 0..100 (Breite) / 0..100 (Höhe).
 * Bewusst kantig-stilisiert im 90er-Jahre-Pixelstil.
 */
function shirtPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(28, 16);            // linke Schulter innen
  ctx.lineTo(8, 27);             // linker Ärmel oben außen
  ctx.lineTo(3, 50);             // Ärmelkante
  ctx.lineTo(23, 56);            // Ärmel unten innen
  ctx.lineTo(20, 95);            // Saum links
  ctx.quadraticCurveTo(50, 100, 80, 95);
  ctx.lineTo(77, 56);
  ctx.lineTo(97, 50);
  ctx.lineTo(92, 27);
  ctx.lineTo(72, 16);            // rechte Schulter innen
  ctx.quadraticCurveTo(61, 13, 58, 14);
  ctx.quadraticCurveTo(50, 25, 42, 14);   // Kragenausschnitt
  ctx.quadraticCurveTo(39, 13, 28, 16);
  ctx.closePath();
}

/** Nur der Rumpf (ohne Ärmel) – Grundlage für Streifen/Ringe/Schärpe. */
function torsoBox() { return { x0: 18, x1: 82, y0: 12, y1: 98 }; }

function paintKitPattern(ctx, cols) {
  const t = torsoBox();
  ctx.fillStyle = cols.shirt;
  ctx.fillRect(0, 0, 100, 100);

  switch (cols.pattern) {
    case 'stripes': {
      // Senkrechte Streifen über die gesamte Breite (Ärmel eingeschlossen).
      const n = KIT_STRIPE_COUNT * 2 + 1;
      const w = 100 / n;
      ctx.fillStyle = cols.shirt2;
      for (let i = 1; i < n; i += 2) ctx.fillRect(i * w, 0, w, 100);
      break;
    }
    case 'hoops': {
      const n = KIT_HOOP_COUNT * 2 + 1;
      const hgt = 100 / n;
      ctx.fillStyle = cols.shirt2;
      for (let i = 1; i < n; i += 2) ctx.fillRect(0, i * hgt, 100, hgt);
      break;
    }
    case 'sash': {
      ctx.fillStyle = cols.shirt2;
      ctx.beginPath();
      ctx.moveTo(2, 20); ctx.lineTo(30, 8); ctx.lineTo(100, 82); ctx.lineTo(78, 100); ctx.closePath();
      ctx.fill();
      break;
    }
    case 'halves': {
      ctx.fillStyle = cols.shirt2;
      ctx.fillRect(50, 0, 50, 100);
      break;
    }
    case 'chest': {
      ctx.fillStyle = cols.shirt2;
      ctx.fillRect(0, 30, 100, 22);
      break;
    }
    case 'plain':
    default: {
      // Schlicht – dafür Ärmel und Kragen leicht abgesetzt.
      ctx.fillStyle = mixColors(cols.shirt, cols.shirt2, 0.85);
      ctx.fillRect(0, 0, t.x0 - 4, 100);
      ctx.fillRect(t.x1 + 4, 0, 100 - t.x1 - 4, 100);
      break;
    }
  }
}

/**
 * Zeichnet ein Trikot-Icon.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} club
 * @param {number} x  Mitte X
 * @param {number} y  Mitte Y
 * @param {number} scale  1 = KIT_BASE_SIZE Pixel Breite
 * @param {object} [opts]
 *   away:boolean, number:number|string, shadow:boolean, outline:string|false,
 *   alpha:number, full:boolean (Hose + Stutzen mitzeichnen), colors:{…} (Override)
 */
export function drawKit(ctx, club, x, y, scale = 1, opts = {}) {
  const cols = opts.colors || kitColors(club, !!opts.away);
  const size = KIT_BASE_SIZE * (scale || 1);
  const h = size * (opts.full ? 1.72 : 1.0);

  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha *= clamp(opts.alpha, 0, 1);
  ctx.translate(x - size / 2, y - h / 2);
  ctx.scale(size / 100, size / 100);   // ab hier: lokale 0..100-Koordinaten

  if (opts.shadow !== false) {
    ctx.save();
    ctx.globalAlpha *= 0.28;
    ctx.fillStyle = '#000000';
    ctx.translate(4, 5);
    shirtPath(ctx);
    ctx.fill();
    ctx.restore();
  }

  // ── Rumpf + Muster
  ctx.save();
  shirtPath(ctx);
  ctx.clip();
  paintKitPattern(ctx, cols);

  // Plastik: sanfter Verlauf von oben hell nach unten dunkel
  const grd = ctx.createLinearGradient(0, 0, 0, 100);
  grd.addColorStop(0, 'rgba(255,255,255,0.22)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  grd.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 100, 100);
  ctx.restore();

  // ── Kragen
  ctx.save();
  shirtPath(ctx);
  ctx.clip();
  ctx.strokeStyle = cols.shirt2;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(40, 13);
  ctx.quadraticCurveTo(50, 27, 60, 13);
  ctx.stroke();
  ctx.restore();

  // ── Umriss
  if (opts.outline !== false) {
    ctx.strokeStyle = opts.outline || 'rgba(0,0,0,0.78)';
    ctx.lineWidth = KIT_OUTLINE * 100;
    ctx.lineJoin = 'round';
    shirtPath(ctx);
    ctx.stroke();
  }

  // ── Rückennummer
  if (opts.number !== undefined && opts.number !== null && opts.number !== '') {
    const label = String(opts.number);
    ctx.fillStyle = cols.number;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3.5;
    ctx.font = `700 ${label.length > 1 ? 38 : 44}px ${CREST_FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeText(label, 50, 62);
    ctx.fillText(label, 50, 62);
  }

  // ── Optional: Hose und Stutzen
  if (opts.full) {
    drawShortsAndSocks(ctx, cols);
  }

  ctx.restore();
}

/** Hose + Stutzen unterhalb des Trikots (lokale 0..100-Koordinaten, y ab 100). */
function drawShortsAndSocks(ctx, cols) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = KIT_OUTLINE * 100;
  ctx.strokeStyle = 'rgba(0,0,0,0.78)';

  // Hose
  ctx.beginPath();
  ctx.moveTo(24, 102);
  ctx.lineTo(76, 102);
  ctx.lineTo(72, 140);
  ctx.lineTo(54, 140);
  ctx.lineTo(50, 122);
  ctx.lineTo(46, 140);
  ctx.lineTo(28, 140);
  ctx.closePath();
  ctx.fillStyle = cols.shorts;
  ctx.fill();
  ctx.stroke();

  // Stutzen
  ctx.fillStyle = cols.socks;
  ctx.beginPath(); ctx.rect(29, 146, 17, 24); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.rect(54, 146, 17, 24); ctx.fill(); ctx.stroke();
  ctx.fillStyle = mixColors(cols.socks, cols.shirt2, 0.8);
  ctx.fillRect(29, 146, 17, 6);
  ctx.fillRect(54, 146, 17, 6);
}

// ═══════════════════════════════════════════════════════════════════════════
// WAPPEN — FORMEN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Legt den Pfad einer Wappenform an, zentriert um (0,0), Breite = Höhe = 1.
 * Wird von drawCrest sowohl zum Füllen als auch zum Clippen benutzt.
 */
function crestShapePath(ctx, shape) {
  ctx.beginPath();
  switch (shape) {
    case 'shield': {
      // Klassischer Wappenschild: gerade Schultern, spitz zulaufender Fuß.
      ctx.moveTo(-0.50, -0.46);
      ctx.lineTo(0.50, -0.46);
      ctx.lineTo(0.50, 0.06);
      ctx.quadraticCurveTo(0.50, 0.36, 0.00, 0.52);
      ctx.quadraticCurveTo(-0.50, 0.36, -0.50, 0.06);
      ctx.closePath();
      break;
    }
    case 'diamond': {
      // Raute mit leicht abgerundeten Spitzen.
      ctx.moveTo(0, -0.52);
      ctx.quadraticCurveTo(0.16, -0.36, 0.50, 0);
      ctx.quadraticCurveTo(0.16, 0.36, 0, 0.52);
      ctx.quadraticCurveTo(-0.16, 0.36, -0.50, 0);
      ctx.quadraticCurveTo(-0.16, -0.36, 0, -0.52);
      ctx.closePath();
      break;
    }
    case 'classic': {
      // Altdeutscher Schild: geschweifte Flanken, eingekerbter Kopf.
      ctx.moveTo(-0.46, -0.44);
      ctx.quadraticCurveTo(-0.20, -0.52, 0.00, -0.38);
      ctx.quadraticCurveTo(0.20, -0.52, 0.46, -0.44);
      ctx.quadraticCurveTo(0.54, -0.10, 0.40, 0.22);
      ctx.quadraticCurveTo(0.24, 0.46, 0.00, 0.53);
      ctx.quadraticCurveTo(-0.24, 0.46, -0.40, 0.22);
      ctx.quadraticCurveTo(-0.54, -0.10, -0.46, -0.44);
      ctx.closePath();
      break;
    }
    case 'round':
    default: {
      ctx.arc(0, 0, 0.5, 0, Math.PI * 2);
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WAPPEN — MOTIVE
// Jedes Motiv zeichnet in einem Einheitsquadrat von -1..1 um den Ursprung.
// Signatur: (ctx, fg, bg, text) – `text` ist das Vereinskürzel.
// ═══════════════════════════════════════════════════════════════════════════

function starPath(ctx, cx, cy, rOuter, rInner, points = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rot + (i * Math.PI) / points;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Standard-Finish eines Motivteils: füllen und dunkel umranden. */
function inkFill(ctx, fill, lw = 0.075) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = 'rgba(0,0,0,0.62)';
  ctx.stroke();
}

function motifStar(ctx, fg) {
  starPath(ctx, 0, 0, 1.0, 0.42);
  inkFill(ctx, fg, 0.09);
}

function motifBall(ctx, fg, bg) {
  // Bewusst reduziert wie ein 90er-Jahre-Icon: helles Leder, dunkles
  // Mittelfünfeck, fünf Nähte. Angeschnittene Randfünfecke wurden verworfen –
  // bei 16 px Wappengröße verschmelzen sie mit der Außenkontur zu einem Ring.
  const dark = mixColors(bg, '#000000', 0.3);
  ctx.beginPath();
  ctx.arc(0, 0, 0.95, 0, Math.PI * 2);
  inkFill(ctx, fg, 0.09);

  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, 0.92, 0, Math.PI * 2); ctx.clip();

  // Nähte über die Kantenmitten des Mittelfünfecks nach außen
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.1;
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + Math.PI / 5 + (i * 2 * Math.PI) / 5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 0.34, Math.sin(a) * 0.34);
    ctx.lineTo(Math.cos(a) * 0.94, Math.sin(a) * 0.94);
    ctx.stroke();
  }
  // Mittelfünfeck
  ctx.fillStyle = dark;
  starPath(ctx, 0, 0, 0.44, 0.44, 5, -Math.PI / 2);
  ctx.fill();
  ctx.restore();
}

function motifLion(ctx, fg, bg) {
  const dark = mixColors(bg, '#000000', 0.35);
  // Mähne: gezackter Kranz
  starPath(ctx, 0, 0.02, 1.0, 0.74, 13, -Math.PI / 2);
  inkFill(ctx, fg, 0.07);
  // Ohren
  ctx.beginPath(); ctx.arc(-0.52, -0.5, 0.19, 0, Math.PI * 2); inkFill(ctx, fg, 0.06);
  ctx.beginPath(); ctx.arc(0.52, -0.5, 0.19, 0, Math.PI * 2); inkFill(ctx, fg, 0.06);
  // Gesicht
  ctx.beginPath();
  ctx.moveTo(-0.46, -0.28);
  ctx.quadraticCurveTo(-0.50, 0.30, 0.00, 0.62);
  ctx.quadraticCurveTo(0.50, 0.30, 0.46, -0.28);
  ctx.quadraticCurveTo(0.00, -0.52, -0.46, -0.28);
  ctx.closePath();
  inkFill(ctx, mixColors(fg, '#ffffff', 0.18), 0.06);
  // Augen
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.ellipse(-0.20, -0.10, 0.10, 0.07, -0.25, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0.20, -0.10, 0.10, 0.07, 0.25, 0, Math.PI * 2); ctx.fill();
  // Schnauze + Maul
  ctx.beginPath();
  ctx.moveTo(-0.13, 0.14); ctx.lineTo(0.13, 0.14); ctx.lineTo(0, 0.28); ctx.closePath();
  ctx.fillStyle = dark; ctx.fill();
  ctx.strokeStyle = dark; ctx.lineWidth = 0.06; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0.28);
  ctx.quadraticCurveTo(-0.16, 0.46, -0.28, 0.32);
  ctx.moveTo(0, 0.28);
  ctx.quadraticCurveTo(0.16, 0.46, 0.28, 0.32);
  ctx.stroke();
}

function motifEagle(ctx, fg, bg) {
  const dark = mixColors(bg, '#000000', 0.3);
  // Aufgerissene Schwingen: Oberkante schwingt nach außen-oben, die Unterkante
  // kommt in drei Federstufen zurück. Danach Rumpf und gefächerter Stoß.
  ctx.beginPath();
  ctx.moveTo(0.14, -0.44);
  ctx.quadraticCurveTo(0.58, -0.60, 1.00, -0.94);   // rechte Schwinge, Spitze oben
  ctx.lineTo(0.78, -0.50);
  ctx.lineTo(0.88, -0.24);
  ctx.lineTo(0.60, -0.17);
  ctx.lineTo(0.68, 0.06);
  ctx.lineTo(0.40, 0.05);
  ctx.lineTo(0.30, 0.24);                            // Rumpf
  ctx.lineTo(0.36, 0.62);                            // Stoß, rechte Feder
  ctx.lineTo(0.17, 0.46);
  ctx.lineTo(0.00, 0.82);
  ctx.lineTo(-0.17, 0.46);
  ctx.lineTo(-0.36, 0.62);
  ctx.lineTo(-0.30, 0.24);
  ctx.lineTo(-0.40, 0.05);
  ctx.lineTo(-0.68, 0.06);
  ctx.lineTo(-0.60, -0.17);
  ctx.lineTo(-0.88, -0.24);
  ctx.lineTo(-0.78, -0.50);
  ctx.lineTo(-1.00, -0.94);
  ctx.quadraticCurveTo(-0.58, -0.60, -0.14, -0.44);  // linke Schwinge
  ctx.closePath();
  inkFill(ctx, fg, 0.07);
  // Kopf sitzt über dem Halsansatz und deckt die Naht ab
  ctx.beginPath();
  ctx.arc(0, -0.60, 0.25, 0, Math.PI * 2);
  inkFill(ctx, fg, 0.06);
  // Schnabel
  ctx.beginPath();
  ctx.moveTo(0.19, -0.68); ctx.lineTo(0.54, -0.58); ctx.lineTo(0.19, -0.48); ctx.closePath();
  inkFill(ctx, mixColors(fg, '#ffcc33', 0.5), 0.05);
  // Auge
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(0.05, -0.65, 0.065, 0, Math.PI * 2); ctx.fill();
}

function motifAnchor(ctx, fg) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = fg;
  // Ring
  ctx.lineWidth = 0.15;
  ctx.beginPath(); ctx.arc(0, -0.72, 0.20, 0, Math.PI * 2); ctx.stroke();
  // Schaft
  ctx.lineWidth = 0.17;
  ctx.beginPath(); ctx.moveTo(0, -0.52); ctx.lineTo(0, 0.68); ctx.stroke();
  // Querbalken
  ctx.lineWidth = 0.14;
  ctx.beginPath(); ctx.moveTo(-0.46, -0.28); ctx.lineTo(0.46, -0.28); ctx.stroke();
  // Arme
  ctx.lineWidth = 0.16;
  ctx.beginPath();
  ctx.moveTo(-0.74, 0.16);
  ctx.quadraticCurveTo(-0.62, 0.72, 0, 0.78);
  ctx.quadraticCurveTo(0.62, 0.72, 0.74, 0.16);
  ctx.stroke();
  // Flunken
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(-0.74, 0.30); ctx.lineTo(-0.92, 0.00); ctx.lineTo(-0.56, 0.06); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.74, 0.30); ctx.lineTo(0.92, 0.00); ctx.lineTo(0.56, 0.06); ctx.closePath();
  ctx.fill();
}

function motifWheel(ctx, fg, bg) {
  const dark = mixColors(bg, '#000000', 0.25);
  // Außenreif mit Nabe und sechs Speichen (klassisches Rad)
  ctx.beginPath();
  ctx.arc(0, 0, 0.95, 0, Math.PI * 2);
  inkFill(ctx, fg, 0.08);
  ctx.beginPath();
  ctx.arc(0, 0, 0.74, 0, Math.PI * 2);
  ctx.fillStyle = dark; ctx.fill();
  // Speichen
  ctx.strokeStyle = fg;
  ctx.lineWidth = 0.17;
  ctx.lineCap = 'butt';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 0.80, Math.sin(a) * 0.80);
    ctx.lineTo(-Math.cos(a) * 0.80, -Math.sin(a) * 0.80);
    ctx.stroke();
  }
  // Nabe
  ctx.beginPath();
  ctx.arc(0, 0, 0.26, 0, Math.PI * 2);
  inkFill(ctx, fg, 0.07);
}

/**
 * Kürzel als Motiv. `maxW` begrenzt die Breite in Motiv-Einheiten (die Grundform
 * gibt vor, wie viel Platz auf halber Höhe wirklich zur Verfügung steht) – die
 * Schrift wird notfalls gestaucht, damit nichts über den Schild hinausragt.
 */
function motifLetters(ctx, fg, bg, text, maxW = 1.7) {
  const label = String(text || '').toUpperCase().slice(0, 4) || '?';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const px = label.length >= 4 ? 0.9 : label.length === 3 ? 1.06 : 1.32;
  ctx.font = `900 ${px}px ${CREST_FONT_STACK}`;
  const breite = ctx.measureText(label).width;
  if (breite > maxW && breite > 0) ctx.scale(maxW / breite, 1);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.20 * (breite > maxW ? breite / maxW : 1);
  ctx.strokeStyle = mixColors(bg, '#000000', 0.35);
  ctx.strokeText(label, 0, 0.06);
  ctx.fillStyle = fg;
  ctx.fillText(label, 0, 0.06);
}

function motifGoat(ctx, fg, bg) {
  const dark = mixColors(bg, '#000000', 0.35);
  // Hörner – lang, nach hinten geschwungen
  ctx.strokeStyle = fg;
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.17;
  ctx.beginPath();
  ctx.moveTo(-0.18, -0.52);
  ctx.bezierCurveTo(-0.62, -0.86, -0.98, -0.50, -0.72, -0.06);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.16, -0.58);
  ctx.bezierCurveTo(-0.20, -1.00, -0.66, -0.80, -0.52, -0.30);
  ctx.stroke();
  // Kopf im Profil (nach rechts blickend)
  ctx.beginPath();
  ctx.moveTo(-0.34, -0.46);
  ctx.quadraticCurveTo(0.16, -0.52, 0.52, -0.14);
  ctx.quadraticCurveTo(0.86, 0.10, 0.62, 0.30);
  ctx.quadraticCurveTo(0.30, 0.44, 0.06, 0.34);
  ctx.quadraticCurveTo(-0.16, 0.62, -0.28, 0.86);   // Kinnbart
  ctx.quadraticCurveTo(-0.40, 0.42, -0.44, 0.10);
  ctx.closePath();
  inkFill(ctx, fg, 0.07);
  // Ohr
  ctx.beginPath();
  ctx.moveTo(-0.30, -0.24);
  ctx.quadraticCurveTo(-0.72, -0.14, -0.60, 0.14);
  ctx.quadraticCurveTo(-0.40, 0.06, -0.30, -0.04);
  ctx.closePath();
  inkFill(ctx, mixColors(fg, '#000000', 0.18), 0.05);
  // Auge und Nüster
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(0.06, -0.14, 0.08, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0.60, 0.06, 0.055, 0, Math.PI * 2); ctx.fill();
}

function motifHorse(ctx, fg, bg) {
  const dark = mixColors(bg, '#000000', 0.35);
  // Pferdekopf im Profil (Springer-Silhouette)
  ctx.beginPath();
  ctx.moveTo(-0.40, 0.90);                       // Halsansatz unten links
  ctx.quadraticCurveTo(-0.52, 0.10, -0.20, -0.40);
  ctx.lineTo(-0.30, -0.72);                      // linkes Ohr
  ctx.lineTo(-0.06, -0.52);
  ctx.lineTo(0.06, -0.80);                       // rechtes Ohr
  ctx.lineTo(0.22, -0.44);
  ctx.quadraticCurveTo(0.60, -0.30, 0.78, 0.04);
  ctx.quadraticCurveTo(0.92, 0.24, 0.66, 0.30);  // Maul
  ctx.quadraticCurveTo(0.40, 0.34, 0.20, 0.24);
  ctx.quadraticCurveTo(0.10, 0.62, 0.24, 0.92);  // Hals nach unten
  ctx.closePath();
  inkFill(ctx, fg, 0.07);
  // Mähne
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-0.20, -0.36);
  ctx.quadraticCurveTo(-0.44, 0.10, -0.32, 0.86);
  ctx.stroke();
  // Auge und Nüster
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.ellipse(0.16, -0.16, 0.09, 0.07, 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0.66, 0.12, 0.06, 0, Math.PI * 2); ctx.fill();
}

function motifBull(ctx, fg, bg) {
  const dark = mixColors(bg, '#000000', 0.35);
  // Hörner: weit nach außen und mit aufwärts gebogener Spitze – die
  // Silhouette muss den Schädel deutlich überragen, sonst wird kein Stier draus.
  ctx.strokeStyle = fg;
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.19;
  ctx.beginPath();
  ctx.moveTo(-0.34, -0.30);
  ctx.bezierCurveTo(-0.72, -0.40, -0.96, -0.50, -1.00, -0.86);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.34, -0.30);
  ctx.bezierCurveTo(0.72, -0.40, 0.96, -0.50, 1.00, -0.86);
  ctx.stroke();
  // Ohren, unterhalb der Hörner
  ctx.beginPath(); ctx.ellipse(-0.58, 0.02, 0.24, 0.13, -0.28, 0, Math.PI * 2); inkFill(ctx, fg, 0.05);
  ctx.beginPath(); ctx.ellipse(0.58, 0.02, 0.24, 0.13, 0.28, 0, Math.PI * 2); inkFill(ctx, fg, 0.05);
  // Schädel
  ctx.beginPath();
  ctx.moveTo(-0.44, -0.44);
  ctx.quadraticCurveTo(0.00, -0.62, 0.44, -0.44);
  ctx.quadraticCurveTo(0.50, 0.02, 0.28, 0.30);
  ctx.quadraticCurveTo(0.00, 0.56, -0.28, 0.30);
  ctx.quadraticCurveTo(-0.50, 0.02, -0.44, -0.44);
  ctx.closePath();
  inkFill(ctx, fg, 0.07);
  // Augen
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.ellipse(-0.20, -0.16, 0.09, 0.07, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0.20, -0.16, 0.09, 0.07, 0, 0, Math.PI * 2); ctx.fill();
  // Maulpartie mit Nüstern
  ctx.beginPath();
  ctx.ellipse(0, 0.26, 0.24, 0.17, 0, 0, Math.PI * 2);
  inkFill(ctx, mixColors(fg, '#000000', 0.2), 0.05);
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.arc(-0.10, 0.24, 0.055, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0.10, 0.24, 0.055, 0, Math.PI * 2); ctx.fill();
}

const MOTIFS = {
  star: motifStar,
  lion: motifLion,
  eagle: motifEagle,
  ball: motifBall,
  anchor: motifAnchor,
  wheel: motifWheel,
  letters: motifLetters,
  goat: motifGoat,
  horse: motifHorse,
  bull: motifBull
};

/** Namen aller verfügbaren Motive (für Editoren/Debug-Screens). */
export const CREST_MOTIFS = Object.keys(MOTIFS);
export const CREST_SHAPES = ['round', 'shield', 'diamond', 'classic'];

/**
 * Wie breit das Kürzel je Grundform werden darf (in Motiv-Einheiten).
 * Die Raute verjüngt sich zur Textzeile hin am stärksten, der Schild am wenigsten.
 */
const LETTER_WIDTH = { round: 1.68, shield: 1.76, diamond: 1.36, classic: 1.62 };

// ═══════════════════════════════════════════════════════════════════════════
// WAPPEN ZEICHNEN
// ═══════════════════════════════════════════════════════════════════════════

/** Meistersterne: 1 Stern je TITLES_PER_STAR Titel, gedeckelt bei MAX_STARS. */
export function titleStars(club) {
  const titles = (club && club.history && club.history.titles) || 0;
  if (titles < TITLES_PER_STAR) return 0;
  return Math.min(MAX_STARS, Math.floor(titles / TITLES_PER_STAR));
}

/**
 * Zeichnet das Vereinswappen.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} club
 * @param {number} x  Mitte X
 * @param {number} y  Mitte Y
 * @param {number} size  Kantenlänge des Gesamtbereichs (inkl. Sternenkranz)
 */
export function drawCrest(ctx, club, x, y, size) {
  const c = club || {};
  const crest = c.crest || {};
  const colors = c.colors || DEFAULT_COLORS;
  const bg = crest.bg || colors.primary || DEFAULT_COLORS.primary;
  const fg = crest.fg || colors.secondary || DEFAULT_COLORS.secondary;
  const shape = CREST_SHAPES.includes(crest.shape) ? crest.shape : 'round';
  const motif = MOTIFS[crest.motif] ? crest.motif : 'letters';
  const abbr = c.abbr || (c.shortName || '').slice(0, 3).toUpperCase() || '???';
  const stars = titleStars(c);

  // Wenn Sterne dazukommen, rückt der Schild nach unten und schrumpft leicht,
  // damit das Gesamtbild in der zugesagten size-Box bleibt.
  const shieldSize = stars > 0 ? size * CREST_SHRINK_WITH_STARS : size;
  const shieldY = stars > 0 ? y + size * (1 - CREST_SHRINK_WITH_STARS) * 0.5 : y;

  ctx.save();
  ctx.translate(x, shieldY);
  ctx.scale(shieldSize, shieldSize);   // ab hier: Einheitsmaß, Wappen = 1×1

  // ── Schlagschatten
  ctx.save();
  ctx.globalAlpha *= 0.3;
  ctx.translate(0.035, 0.045);
  crestShapePath(ctx, shape);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.restore();

  // ── Grundfläche mit leichtem Verlauf
  crestShapePath(ctx, shape);
  const grd = ctx.createLinearGradient(0, -0.55, 0, 0.55);
  grd.addColorStop(0, shade(bg, 0.20));
  grd.addColorStop(0.55, bg);
  grd.addColorStop(1, shade(bg, -0.24));
  ctx.fillStyle = grd;
  ctx.fill();

  // ── Innenring in Vereins-Zweitfarbe (leicht verkleinerte Kontur der Grundform)
  ctx.save();
  ctx.scale(0.90, 0.90);
  crestShapePath(ctx, shape);
  ctx.lineWidth = 0.055 / 0.90;
  ctx.strokeStyle = fg;
  ctx.globalAlpha *= 0.85;
  ctx.stroke();
  ctx.restore();

  // ── Motiv
  ctx.save();
  crestShapePath(ctx, shape);
  ctx.clip();
  ctx.save();
  const motifY = -0.5 + CREST_MOTIF_Y;
  if (motif === 'letters') {
    // Kürzel groß in der Mitte – dann entfällt das Schriftband.
    ctx.translate(0, -0.02);
    ctx.scale(CREST_MOTIF_SCALE * 0.98, CREST_MOTIF_SCALE * 0.98);
    motifLetters(ctx, fg, bg, abbr, LETTER_WIDTH[shape]);
  } else {
    ctx.translate(0, motifY - 0.06);
    ctx.scale(CREST_MOTIF_SCALE * 0.5, CREST_MOTIF_SCALE * 0.5);
    ctx.lineJoin = 'round';
    MOTIFS[motif](ctx, fg, bg, abbr);
  }
  ctx.restore();

  // ── Schriftband mit dem Kürzel (nicht bei 'letters')
  if (motif !== 'letters') {
    const bandTop = 0.5 - CREST_BAND_H - 0.04;
    ctx.fillStyle = fg;
    ctx.globalAlpha *= 0.92;
    ctx.fillRect(-0.5, bandTop, 1, CREST_BAND_H);
    ctx.globalAlpha /= 0.92;
    ctx.fillStyle = mixColors(bg, '#000000', 0.15);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${CREST_BAND_H * 0.82}px ${CREST_FONT_STACK}`;
    ctx.fillText(String(abbr).slice(0, 4), 0, bandTop + CREST_BAND_H * 0.54);
  }
  ctx.restore();

  // ── Außenkontur
  crestShapePath(ctx, shape);
  ctx.lineWidth = 0.045;
  ctx.strokeStyle = 'rgba(0,0,0,0.72)';
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.restore();

  // ── Meistersterne im Bogen über dem Wappen
  if (stars > 0) drawTitleStars(ctx, stars, x, y - size * 0.40, size);
}

/** Sternenkranz über dem Wappen (goldene Meistersterne). */
function drawTitleStars(ctx, count, cx, cy, size) {
  const r = size * 0.075;                 // Sternradius
  const gap = r * 2.35;
  const totalW = (count - 1) * gap;
  const arc = size * 0.05;                // leichte Wölbung nach oben
  ctx.save();
  ctx.lineJoin = 'round';
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;   // -1..1
    const px = cx - totalW / 2 + i * gap;
    const py = cy - arc * (1 - t * t);
    starPath(ctx, px, py, r, r * 0.42);
    ctx.fillStyle = '#f6c945';
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.012);
    ctx.strokeStyle = '#7a5407';
    ctx.stroke();
  }
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════════════════
// WAPPEN ALS DATA-URL (gecacht)
// ═══════════════════════════════════════════════════════════════════════════

const crestCache = new Map();

/**
 * Rendert das Wappen einmalig in ein Offscreen-Canvas und liefert eine
 * data:-URL – ideal für <img>-Tags in Tabellen (kein Canvas je Zeile).
 * Ohne DOM (z. B. im Test-Node) wird ein leerer String zurückgegeben.
 */
export function crestDataURL(club, size = 48) {
  if (typeof document === 'undefined') return '';
  const id = (club && club.id) || 'unbekannt';
  const key = `${id}|${size}`;
  const hit = crestCache.get(key);
  if (hit !== undefined) return hit;

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cv = document.createElement('canvas');
  cv.width = Math.round(size * dpr);
  cv.height = Math.round(size * dpr);
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  drawCrest(ctx, club, size / 2, size / 2, size * 0.94);
  const url = cv.toDataURL('image/png');

  if (crestCache.size >= CREST_CACHE_LIMIT) crestCache.clear();
  crestCache.set(key, url);
  return url;
}

/** Cache leeren (z. B. nach einem Wappen-Editor). */
export function clearCrestCache() { crestCache.clear(); }

// ═══════════════════════════════════════════════════════════════════════════
// FLAGGEN
// ═══════════════════════════════════════════════════════════════════════════

/*
 * Aufbau eines Flaggen-Eintrags:
 *   h: [farben]      → waagerechte Streifen (gleich hoch, sofern kein w:[…])
 *   v: [farben]      → senkrechte Streifen
 *   f: farbe         → einfarbiges Feld
 *   w: [gewichte]    → Streifenverhältnis
 *   ov: [overlays]   → Auflagen, in Reihenfolge gezeichnet
 *
 * Overlay-Koordinaten sind relativ: x/y in 0..1 der Flaggenfläche,
 * Radien/Stärken relativ zur HÖHE.
 */
const FLAGS = {
  // ── Mitteleuropa
  DE: { h: ['#000000', '#dd0000', '#ffce00'] },
  AT: { h: ['#ed2939', '#ffffff', '#ed2939'] },
  CH: { f: '#d52b1e', ov: [{ k: 'plus', c: '#ffffff', w: 0.2, len: 0.62 }] },
  LU: { h: ['#ed2939', '#ffffff', '#00a1de'] },
  NL: { h: ['#ae1c28', '#ffffff', '#21468b'] },
  BE: { v: ['#000000', '#fdda24', '#ef3340'] },
  FR: { v: ['#002395', '#ffffff', '#ed2939'] },
  PL: { h: ['#ffffff', '#dc143c'] },
  CZ: { h: ['#ffffff', '#d7141a'], ov: [{ k: 'tri', c: '#11457e', w: 0.5 }] },
  SK: {
    h: ['#ffffff', '#0b4ea2', '#ee1c25'],
    ov: [{ k: 'shield', x: 0.36, y: 0.5, r: 0.30, c: '#ee1c25', edge: '#ffffff', sym: 'kreuz' }]
  },
  HU: { h: ['#ce2939', '#ffffff', '#477050'] },
  SI: {
    h: ['#ffffff', '#0000ff', '#ff0000'],
    ov: [{ k: 'shield', x: 0.30, y: 0.36, r: 0.26, c: '#0000ff', edge: '#ff0000', sym: 'berg' }]
  },
  HR: {
    h: ['#ff0000', '#ffffff', '#171796'],
    ov: [{ k: 'checker', x: 0.5, y: 0.5, w: 0.30, h: 0.46 }]
  },
  RS: {
    h: ['#c6363c', '#0c4076', '#ffffff'],
    ov: [{ k: 'shield', x: 0.38, y: 0.5, r: 0.26, c: '#c6363c', edge: '#ffd700', sym: 'kreuz' }]
  },
  BA: {
    f: '#002395',
    ov: [
      { k: 'poly', c: '#fecb00', pts: [[0.28, 0], [0.98, 0], [0.28, 1]] },
      { k: 'diagstars', c: '#ffffff', n: 7 }
    ]
  },
  ME: { f: '#c40308', ov: [{ k: 'border', c: '#d4af37', w: 0.08 }, { k: 'eagle', x: 0.5, y: 0.5, r: 0.34, c: '#d4af37' }] },
  MK: { f: '#d20000', ov: [{ k: 'rays', c: '#ffe600', x: 0.5, y: 0.5, r: 0.28, n: 8 }] },
  AL: { f: '#e41e20', ov: [{ k: 'eagle', x: 0.5, y: 0.5, r: 0.36, c: '#000000' }] },
  XK: { f: '#244aa5', ov: [{ k: 'blob', x: 0.5, y: 0.58, r: 0.30, c: '#d0a650' }, { k: 'arcstars', c: '#ffffff', n: 6, y: 0.18, r: 0.06 }] },

  // ── Süd- und Westeuropa
  ES: { h: ['#aa151b', '#f1bf00', '#aa151b'], w: [1, 2, 1], ov: [{ k: 'blob', x: 0.34, y: 0.5, r: 0.16, c: '#ad1519' }] },
  PT: { v: ['#046a38', '#da291c'], w: [2, 3], ov: [{ k: 'disc', x: 0.40, y: 0.5, r: 0.22, c: '#ffe900', ring: '#da291c' }] },
  IT: { v: ['#008c45', '#f4f5f0', '#cd212a'] },
  GR: {
    h: ['#0d5eaf', '#ffffff', '#0d5eaf', '#ffffff', '#0d5eaf', '#ffffff', '#0d5eaf', '#ffffff', '#0d5eaf'],
    ov: [{ k: 'rect', x: 0, y: 0, w: 5 / 9, h: 5 / 9, c: '#0d5eaf' },
      { k: 'plus', c: '#ffffff', w: 0.11, len: 0.28, x: 5 / 18, y: 5 / 18 }]
  },
  EN: { f: '#ffffff', ov: [{ k: 'plus', c: '#ce1124', w: 0.20, len: 1 }] },
  SCO: { f: '#0065bf', ov: [{ k: 'saltire', c: '#ffffff', w: 0.20 }] },
  WAL: { h: ['#ffffff', '#00ab39'], ov: [{ k: 'dragon', c: '#d3202a' }] },
  IE: { v: ['#169b62', '#ffffff', '#ff883e'] },

  // ── Nordeuropa
  DK: { f: '#c8102e', ov: [{ k: 'nordic', c: '#ffffff', w: 0.22 }] },
  SE: { f: '#006aa7', ov: [{ k: 'nordic', c: '#fecc00', w: 0.22 }] },
  NO: { f: '#ba0c2f', ov: [{ k: 'nordic', c: '#ffffff', w: 0.30 }, { k: 'nordic', c: '#00205b', w: 0.13 }] },
  FI: { f: '#ffffff', ov: [{ k: 'nordic', c: '#003580', w: 0.24 }] },
  IS: { f: '#02529c', ov: [{ k: 'nordic', c: '#ffffff', w: 0.30 }, { k: 'nordic', c: '#dc1e35', w: 0.14 }] },

  // ── Osteuropa
  UA: { h: ['#0057b7', '#ffd700'] },
  RU: { h: ['#ffffff', '#0039a6', '#d52b1e'] },
  BG: { h: ['#ffffff', '#00966e', '#d62612'] },
  RO: { v: ['#002b7f', '#fcd116', '#ce1126'] },
  GE: {
    f: '#ffffff',
    ov: [{ k: 'plus', c: '#ff0000', w: 0.17, len: 1 },
      { k: 'minicross', c: '#ff0000' }]
  },
  AM: { h: ['#d90012', '#0033a0', '#f2a800'] },

  // ── Naher Osten / Afrika
  TR: { f: '#e30a17', ov: [{ k: 'crescent', x: 0.40, y: 0.5, r: 0.26, c: '#ffffff' }, { k: 'star', x: 0.60, y: 0.5, r: 0.13, c: '#ffffff' }] },
  IL: { f: '#ffffff', ov: [{ k: 'band', c: '#0038b8', y: 0.16, h: 0.10 }, { k: 'band', c: '#0038b8', y: 0.74, h: 0.10 }, { k: 'davidstern', x: 0.5, y: 0.5, r: 0.22, c: '#0038b8' }] },
  SY: { h: ['#ce1126', '#ffffff', '#000000'], ov: [{ k: 'star', x: 0.40, y: 0.5, r: 0.11, c: '#007a3d' }, { k: 'star', x: 0.60, y: 0.5, r: 0.11, c: '#007a3d' }] },
  SA: { f: '#006c35', ov: [{ k: 'band', c: '#ffffff', y: 0.34, h: 0.07 }, { k: 'sword', c: '#ffffff' }] },
  IR: { h: ['#239f40', '#ffffff', '#da0000'], ov: [{ k: 'blob', x: 0.5, y: 0.5, r: 0.13, c: '#da0000' }] },
  EG: { h: ['#ce1126', '#ffffff', '#000000'], ov: [{ k: 'eagle', x: 0.5, y: 0.5, r: 0.16, c: '#c09300' }] },
  MA: { f: '#c1272d', ov: [{ k: 'star', x: 0.5, y: 0.5, r: 0.28, c: null, stroke: '#006233', lw: 0.035, points: 5, pent: true }] },
  DZ: { v: ['#006233', '#ffffff'], ov: [{ k: 'crescent', x: 0.5, y: 0.5, r: 0.24, c: '#d21034' }, { k: 'star', x: 0.60, y: 0.5, r: 0.10, c: '#d21034' }] },
  TN: { f: '#e70013', ov: [{ k: 'disc', x: 0.5, y: 0.5, r: 0.30, c: '#ffffff' }, { k: 'crescent', x: 0.5, y: 0.5, r: 0.20, c: '#e70013' }, { k: 'star', x: 0.56, y: 0.5, r: 0.09, c: '#e70013' }] },
  SN: { v: ['#00853f', '#fdef42', '#e31b23'], ov: [{ k: 'star', x: 0.5, y: 0.5, r: 0.15, c: '#00853f' }] },
  NG: { v: ['#008751', '#ffffff', '#008751'] },
  GH: { h: ['#ce1126', '#fcd116', '#006b3f'], ov: [{ k: 'star', x: 0.5, y: 0.5, r: 0.14, c: '#000000' }] },
  CM: { v: ['#007a5e', '#ce1126', '#fcd116'], ov: [{ k: 'star', x: 0.5, y: 0.5, r: 0.14, c: '#fcd116' }] },
  CI: { v: ['#f77f00', '#ffffff', '#009e60'] },
  ML: { v: ['#14b53a', '#fcd116', '#ce1126'] },
  BF: { h: ['#ef2b2d', '#009e49'], ov: [{ k: 'star', x: 0.5, y: 0.5, r: 0.16, c: '#fcd116' }] },
  CD: {
    f: '#007fff',
    ov: [{ k: 'diag', c: '#ce1021', w: 0.30 }, { k: 'diag', c: '#f7d618', w: 0.17 },
      { k: 'star', x: 0.14, y: 0.20, r: 0.13, c: '#f7d618' }]
  },
  GN: { v: ['#ce1126', '#fcd116', '#009460'] },
  GA: { h: ['#009e60', '#fcd116', '#3a75c4'] },
  CV: {
    h: ['#003893', '#ffffff', '#cf2027', '#ffffff', '#003893'], w: [6, 1, 2, 1, 5],
    ov: [{ k: 'arcstars', c: '#f7d116', n: 10, x: 0.38, y: 0.5, ring: 0.30, r: 0.045 }]
  },
  AO: { h: ['#ce1126', '#000000'], ov: [{ k: 'star', x: 0.44, y: 0.5, r: 0.12, c: '#f9d616' }] },
  ZM: {
    f: '#198a00',
    ov: [{ k: 'rect', x: 0.55, y: 0.4, w: 0.13, h: 0.6, c: '#ce1126' },
      { k: 'rect', x: 0.68, y: 0.4, w: 0.13, h: 0.6, c: '#000000' },
      { k: 'rect', x: 0.81, y: 0.4, w: 0.13, h: 0.6, c: '#ef7d00' },
      { k: 'eagle', x: 0.75, y: 0.20, r: 0.16, c: '#ef7d00' }]
  },
  TG: {
    h: ['#006a4e', '#ffce00', '#006a4e', '#ffce00', '#006a4e'],
    ov: [{ k: 'rect', x: 0, y: 0, w: 0.4, h: 0.6, c: '#d21034' },
      { k: 'star', x: 0.2, y: 0.3, r: 0.16, c: '#ffffff' }]
  },
  BJ: {
    h: ['#fcd116', '#e8112d'],
    ov: [{ k: 'rect', x: 0, y: 0, w: 0.38, h: 1, c: '#008751' }]
  },
  ZA: { k: 'za' },

  // ── Amerika
  BR: {
    f: '#009c3b',
    ov: [{ k: 'raute', c: '#ffdf00', w: 0.86, h: 0.86 }, { k: 'disc', x: 0.5, y: 0.5, r: 0.24, c: '#002776' },
      { k: 'band', c: '#ffffff', y: 0.46, h: 0.055, clipDisc: { x: 0.5, y: 0.5, r: 0.24 } }]
  },
  AR: { h: ['#75aadb', '#ffffff', '#75aadb'], ov: [{ k: 'rays', c: '#f6b40e', x: 0.5, y: 0.5, r: 0.11, n: 12 }] },
  UY: {
    h: ['#ffffff', '#0038a8', '#ffffff', '#0038a8', '#ffffff', '#0038a8', '#ffffff', '#0038a8', '#ffffff'],
    ov: [{ k: 'rect', x: 0, y: 0, w: 0.36, h: 4 / 9, c: '#ffffff' },
      { k: 'rays', c: '#f6b40e', x: 0.18, y: 2 / 9, r: 0.09, n: 12 }]
  },
  CL: {
    h: ['#ffffff', '#d52b1e'],
    ov: [{ k: 'rect', x: 0, y: 0, w: 1 / 3, h: 0.5, c: '#0039a6' },
      { k: 'star', x: 1 / 6, y: 0.25, r: 0.16, c: '#ffffff' }]
  },
  PE: { v: ['#d91023', '#ffffff', '#d91023'] },
  CO: { h: ['#fcd116', '#003893', '#ce1126'], w: [2, 1, 1] },
  EC: { h: ['#fcd116', '#0033a0', '#ce1126'], w: [2, 1, 1], ov: [{ k: 'blob', x: 0.5, y: 0.5, r: 0.16, c: '#0033a0', edge: '#fcd116' }] },
  PY: { h: ['#d52b1e', '#ffffff', '#0038a8'], ov: [{ k: 'disc', x: 0.5, y: 0.5, r: 0.14, c: '#ffffff', ring: '#0038a8' }, { k: 'star', x: 0.5, y: 0.5, r: 0.08, c: '#009b3a' }] },
  VE: { h: ['#ffcc00', '#00247d', '#cf142b'], ov: [{ k: 'arcstars', c: '#ffffff', n: 8, x: 0.5, y: 0.5, ring: 0.16, r: 0.035 }] },
  US: { k: 'us' },
  CA: { v: ['#d80621', '#ffffff', '#d80621'], w: [1, 2, 1], ov: [{ k: 'ahorn', c: '#d80621' }] },
  MX: { v: ['#006847', '#ffffff', '#ce1126'], ov: [{ k: 'blob', x: 0.5, y: 0.5, r: 0.17, c: '#8b5a2b', edge: '#006847' }] },

  // ── Asien / Ozeanien
  JP: { f: '#ffffff', ov: [{ k: 'disc', x: 0.5, y: 0.5, r: 0.30, c: '#bc002d' }] },
  KR: { f: '#ffffff', ov: [{ k: 'taeguk', x: 0.5, y: 0.5, r: 0.24 }, { k: 'trigramme', c: '#000000' }] },
  CN: {
    f: '#de2910',
    ov: [{ k: 'star', x: 0.16, y: 0.30, r: 0.20, c: '#ffde00' },
      { k: 'star', x: 0.33, y: 0.13, r: 0.07, c: '#ffde00' },
      { k: 'star', x: 0.40, y: 0.26, r: 0.07, c: '#ffde00' },
      { k: 'star', x: 0.40, y: 0.44, r: 0.07, c: '#ffde00' },
      { k: 'star', x: 0.33, y: 0.57, r: 0.07, c: '#ffde00' }]
  },
  AU: { k: 'au' },
  NZ: { k: 'nz' }
};

// ── Overlay-Zeichner ───────────────────────────────────────────────────────

function fStripes(ctx, x, y, w, h, colors, weights, vertical) {
  const ws = weights && weights.length === colors.length ? weights : colors.map(() => 1);
  const total = ws.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < colors.length; i++) {
    const frac = ws[i] / total;
    ctx.fillStyle = colors[i];
    if (vertical) ctx.fillRect(x + acc * w, y, frac * w + 0.6, h);
    else ctx.fillRect(x, y + acc * h, w, frac * h + 0.6);
    acc += frac;
  }
}

function fStar(ctx, x, y, w, h, ov) {
  const cx = x + (ov.x !== undefined ? ov.x : 0.5) * w;
  const cy = y + (ov.y !== undefined ? ov.y : 0.5) * h;
  const r = (ov.r || 0.15) * h;
  const pts = ov.points || 5;
  if (ov.pent) {
    // Marokkanisches Pentagramm: durchgezogener Linienstern
    ctx.save();
    ctx.strokeStyle = ov.stroke || '#000000';
    ctx.lineWidth = (ov.lw || 0.03) * h;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + ((i * 2) % 5) * (2 * Math.PI / 5);
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    return;
  }
  starPath(ctx, cx, cy, r, r * 0.42, pts, ov.rot !== undefined ? ov.rot : -Math.PI / 2);
  ctx.fillStyle = ov.c || '#ffffff';
  ctx.fill();
}

function fEagleSilhouette(ctx, x, y, w, h, ov) {
  const cx = x + (ov.x !== undefined ? ov.x : 0.5) * w;
  const cy = y + (ov.y !== undefined ? ov.y : 0.5) * h;
  const r = (ov.r || 0.3) * h;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(r, r);
  ctx.fillStyle = ov.c || '#000000';
  // grob vereinfachter Doppeladler / Adler
  ctx.beginPath();
  ctx.moveTo(0, -0.95);
  ctx.lineTo(0.35, -0.55); ctx.lineTo(1.0, -0.5); ctx.lineTo(0.55, 0.05);
  ctx.lineTo(0.9, 0.3); ctx.lineTo(0.3, 0.35);
  ctx.lineTo(0.35, 0.95); ctx.lineTo(0, 0.55); ctx.lineTo(-0.35, 0.95);
  ctx.lineTo(-0.3, 0.35); ctx.lineTo(-0.9, 0.3); ctx.lineTo(-0.55, 0.05);
  ctx.lineTo(-1.0, -0.5); ctx.lineTo(-0.35, -0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFlagOverlay(ctx, ov, x, y, w, h) {
  const px = (v) => x + v * w;
  const py = (v) => y + v * h;

  switch (ov.k) {
    case 'rect':
      ctx.fillStyle = ov.c;
      ctx.fillRect(px(ov.x), py(ov.y), ov.w * w, ov.h * h);
      break;

    case 'band':
      // Waagerechtes Band; mit clipDisc nur innerhalb einer Kreisfläche
      // (z. B. das Spruchband auf der brasilianischen Weltkugel).
      ctx.save();
      if (ov.clipDisc) {
        ctx.beginPath();
        ctx.arc(px(ov.clipDisc.x), py(ov.clipDisc.y), ov.clipDisc.r * h, 0, Math.PI * 2);
        ctx.clip();
      }
      ctx.fillStyle = ov.c;
      ctx.fillRect(x, py(ov.y), w, ov.h * h);
      ctx.restore();
      break;

    case 'disc': {
      ctx.beginPath();
      ctx.arc(px(ov.x), py(ov.y), ov.r * h, 0, Math.PI * 2);
      ctx.fillStyle = ov.c; ctx.fill();
      if (ov.ring) { ctx.lineWidth = Math.max(1, ov.r * h * 0.16); ctx.strokeStyle = ov.ring; ctx.stroke(); }
      break;
    }

    case 'blob': {   // vereinfachtes Wappen/Emblem
      ctx.beginPath();
      ctx.ellipse(px(ov.x), py(ov.y), ov.r * h * 0.8, ov.r * h, 0, 0, Math.PI * 2);
      ctx.fillStyle = ov.c; ctx.fill();
      if (ov.edge) { ctx.lineWidth = Math.max(1, ov.r * h * 0.15); ctx.strokeStyle = ov.edge; ctx.stroke(); }
      break;
    }

    case 'shield': {   // Miniaturschild (SK, SI, RS)
      const cx = px(ov.x), cy = py(ov.y), r = ov.r * h;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.8, cy - r);
      ctx.lineTo(cx + r * 0.8, cy - r);
      ctx.lineTo(cx + r * 0.8, cy + r * 0.2);
      ctx.quadraticCurveTo(cx + r * 0.8, cy + r * 0.8, cx, cy + r);
      ctx.quadraticCurveTo(cx - r * 0.8, cy + r * 0.8, cx - r * 0.8, cy + r * 0.2);
      ctx.closePath();
      ctx.fillStyle = ov.c; ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.16); ctx.strokeStyle = ov.edge || '#ffffff'; ctx.stroke();
      if (ov.sym === 'kreuz') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, r * 0.2);
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.6); ctx.lineTo(cx, cy + r * 0.5);
        ctx.moveTo(cx - r * 0.45, cy - r * 0.2); ctx.lineTo(cx + r * 0.45, cy - r * 0.2);
        ctx.stroke();
      } else if (ov.sym === 'berg') {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.55, cy + r * 0.4);
        ctx.lineTo(cx - r * 0.15, cy - r * 0.35);
        ctx.lineTo(cx + r * 0.15, cy - r * 0.35);
        ctx.lineTo(cx + r * 0.55, cy + r * 0.4);
        ctx.closePath(); ctx.fill();
      }
      break;
    }

    case 'plus': {    // durchgehendes Kreuz (mittig oder versetzt)
      const cx = px(ov.x !== undefined ? ov.x : 0.5);
      const cy = py(ov.y !== undefined ? ov.y : 0.5);
      const t = ov.w * h;
      const len = (ov.len === undefined ? 1 : ov.len);
      const lw = len >= 1 ? w : len * w;
      const lh = len >= 1 ? h : len * h;
      ctx.fillStyle = ov.c;
      ctx.fillRect(cx - lw / 2, cy - t / 2, lw, t);
      ctx.fillRect(cx - t / 2, cy - lh / 2, t, lh);
      break;
    }

    case 'minicross': {   // die vier kleinen Bolnisi-Kreuze der georgischen Flagge
      ctx.fillStyle = ov.c;
      const t = h * 0.05, arm = h * 0.13;
      for (const [qx, qy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const cx = px(qx), cy = py(qy);
        ctx.fillRect(cx - arm, cy - t / 2, arm * 2, t);
        ctx.fillRect(cx - t / 2, cy - arm, t, arm * 2);
      }
      break;
    }

    case 'nordic': {   // skandinavisches Kreuz, aus der Mitte nach links versetzt
      const t = ov.w * h;
      const cx = x + w * 0.36;
      ctx.fillStyle = ov.c;
      ctx.fillRect(x, y + h / 2 - t / 2, w, t);
      ctx.fillRect(cx - t / 2, y, t, h);
      break;
    }

    case 'saltire': {
      const t = ov.w * h;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.strokeStyle = ov.c;
      ctx.lineWidth = t;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
      ctx.moveTo(x + w, y); ctx.lineTo(x, y + h);
      ctx.stroke();
      ctx.restore();
      break;
    }

    case 'tri': {     // Keil vom Mast (Tschechien)
      ctx.fillStyle = ov.c;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + ov.w * w, y + h / 2); ctx.lineTo(x, y + h);
      ctx.closePath(); ctx.fill();
      break;
    }

    case 'poly': {
      ctx.fillStyle = ov.c;
      ctx.beginPath();
      ov.pts.forEach((p, i) => (i ? ctx.lineTo(px(p[0]), py(p[1])) : ctx.moveTo(px(p[0]), py(p[1]))));
      ctx.closePath(); ctx.fill();
      break;
    }

    case 'border': {
      ctx.strokeStyle = ov.c;
      ctx.lineWidth = ov.w * h;
      ctx.strokeRect(x + ov.w * h / 2, y + ov.w * h / 2, w - ov.w * h, h - ov.w * h);
      break;
    }

    case 'raute': {   // Rhombus (Brasilien)
      ctx.fillStyle = ov.c;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + h * (1 - ov.h) / 2);
      ctx.lineTo(x + w * (1 + ov.w) / 2, y + h / 2);
      ctx.lineTo(x + w / 2, y + h * (1 + ov.h) / 2);
      ctx.lineTo(x + w * (1 - ov.w) / 2, y + h / 2);
      ctx.closePath(); ctx.fill();
      break;
    }

    case 'crescent': {
      const cx = px(ov.x), cy = py(ov.y), r = ov.r * h;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.34, cy, r * 0.80, 0, Math.PI * 2, true);
      ctx.fillStyle = ov.c;
      ctx.fill('evenodd');
      ctx.restore();
      break;
    }

    case 'star':
      fStar(ctx, x, y, w, h, ov);
      break;

    case 'stars':
      for (const s of ov.list) fStar(ctx, x, y, w, h, { ...s, c: s.c || ov.c });
      break;

    case 'arcstars': {   // Sternenbogen/-kranz
      const cx = px(ov.x !== undefined ? ov.x : 0.5);
      const cy = py(ov.y !== undefined ? ov.y : 0.5);
      const ring = (ov.ring !== undefined ? ov.ring : 0.3) * h;
      for (let i = 0; i < ov.n; i++) {
        const a = ov.ring === undefined
          ? Math.PI * (0.15 + 0.7 * (ov.n === 1 ? 0.5 : i / (ov.n - 1)))
          : (i / ov.n) * Math.PI * 2 - Math.PI / 2;
        starPath(ctx, cx + Math.cos(a) * ring, cy + Math.sin(a) * ring, (ov.r || 0.05) * h, (ov.r || 0.05) * h * 0.42);
        ctx.fillStyle = ov.c; ctx.fill();
      }
      break;
    }

    case 'diagstars': {   // Sternenreihe entlang der Diagonale (Bosnien)
      for (let i = 0; i < ov.n; i++) {
        const t = (i + 0.5) / ov.n;
        starPath(ctx, px(0.14 + t * 0.68), py(0.04 + t * 0.92), h * 0.075, h * 0.032);
        ctx.fillStyle = ov.c; ctx.fill();
      }
      break;
    }

    case 'rays': {   // Sonne mit Strahlen (Argentinien, Uruguay, Nordmazedonien)
      const cx = px(ov.x), cy = py(ov.y), r = ov.r * h;
      ctx.save();
      ctx.strokeStyle = ov.c;
      ctx.lineWidth = Math.max(1, r * 0.42);
      for (let i = 0; i < ov.n; i++) {
        const a = (i / ov.n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a) * r * 2.6, cy + Math.sin(a) * r * 2.6);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = ov.c; ctx.fill();
      ctx.restore();
      break;
    }

    case 'checker': {   // kroatisches Schachbrett
      const bw = ov.w * w, bh = ov.h * h;
      const bx = px(ov.x) - bw / 2, by = py(ov.y) - bh / 2;
      const n = 5;
      ctx.save();
      ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#ff0000';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if ((r + c) % 2 === 0) ctx.fillRect(bx + (c * bw) / n, by + (r * bh) / n, bw / n + 0.5, bh / n + 0.5);
        }
      }
      ctx.restore();
      break;
    }

    case 'eagle':
      fEagleSilhouette(ctx, x, y, w, h, ov);
      break;

    case 'davidstern': {
      const cx = px(ov.x), cy = py(ov.y), r = ov.r * h;
      ctx.strokeStyle = ov.c;
      ctx.lineWidth = Math.max(1, r * 0.2);
      for (const rot of [-Math.PI / 2, Math.PI / 2]) {
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = rot + (i * 2 * Math.PI) / 3;
          const pxx = cx + Math.cos(a) * r, pyy = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(pxx, pyy); else ctx.lineTo(pxx, pyy);
        }
        ctx.closePath(); ctx.stroke();
      }
      break;
    }

    case 'sword': {   // stark vereinfachtes Schwert (Saudi-Arabien)
      ctx.fillStyle = ov.c;
      ctx.fillRect(px(0.16), py(0.62), w * 0.6, h * 0.06);
      ctx.beginPath();
      ctx.moveTo(px(0.76), py(0.60)); ctx.lineTo(px(0.88), py(0.65)); ctx.lineTo(px(0.76), py(0.70));
      ctx.closePath(); ctx.fill();
      break;
    }

    case 'ahorn': {   // stilisiertes Ahornblatt (Kanada)
      ctx.save();
      ctx.translate(px(0.5), py(0.52));
      ctx.scale(h * 0.42, h * 0.42);
      ctx.fillStyle = ov.c;
      ctx.beginPath();
      ctx.moveTo(0, -1.0);
      ctx.lineTo(0.18, -0.5); ctx.lineTo(0.55, -0.6); ctx.lineTo(0.44, -0.22);
      ctx.lineTo(0.95, 0.1); ctx.lineTo(0.62, 0.28); ctx.lineTo(0.72, 0.62);
      ctx.lineTo(0.22, 0.5); ctx.lineTo(0.12, 1.0);
      ctx.lineTo(-0.12, 1.0); ctx.lineTo(-0.22, 0.5); ctx.lineTo(-0.72, 0.62);
      ctx.lineTo(-0.62, 0.28); ctx.lineTo(-0.95, 0.1); ctx.lineTo(-0.44, -0.22);
      ctx.lineTo(-0.55, -0.6); ctx.lineTo(-0.18, -0.5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      break;
    }

    case 'dragon': {   // walisischer Drache, sehr stilisiert
      ctx.save();
      ctx.translate(px(0.5), py(0.52));
      ctx.scale(h * 0.5, h * 0.5);
      ctx.fillStyle = ov.c;
      ctx.beginPath();
      ctx.moveTo(-1.15, 0.55); ctx.lineTo(-0.75, 0.05); ctx.lineTo(-0.35, 0.35);
      ctx.lineTo(-0.05, -0.15); ctx.lineTo(0.35, 0.2); ctx.lineTo(0.6, -0.35);
      ctx.lineTo(0.95, -0.5); ctx.lineTo(1.2, -0.62); ctx.lineTo(0.95, -0.72);
      ctx.lineTo(0.55, -0.7); ctx.lineTo(0.2, -0.5); ctx.lineTo(-0.2, -0.62);
      ctx.lineTo(-0.6, -0.42); ctx.lineTo(-1.0, -0.6); ctx.lineTo(-0.85, -0.2);
      ctx.lineTo(-1.25, 0.1);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      break;
    }

    case 'taeguk': {   // koreanisches Yin-Yang
      const cx = px(ov.x), cy = py(ov.y), r = ov.r * h;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 4, (3 * Math.PI) / 4);
      ctx.fillStyle = '#cd2e3a'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, r, (3 * Math.PI) / 4, (7 * Math.PI) / 4);
      ctx.fillStyle = '#0047a0'; ctx.fill();
      const dx = Math.cos(-Math.PI / 4) * r / 2, dy = Math.sin(-Math.PI / 4) * r / 2;
      ctx.beginPath(); ctx.arc(cx + dx, cy + dy, r / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#cd2e3a'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx - dx, cy - dy, r / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#0047a0'; ctx.fill();
      ctx.restore();
      break;
    }

    case 'trigramme': {   // die vier Trigramme als Balkengruppen
      ctx.fillStyle = ov.c;
      const bl = h * 0.20, bh = h * 0.035, gap = h * 0.05;
      const spots = [[0.20, 0.22, -Math.PI / 4], [0.80, 0.22, Math.PI / 4],
        [0.20, 0.78, Math.PI / 4], [0.80, 0.78, -Math.PI / 4]];
      spots.forEach(([sx, sy, rot]) => {
        ctx.save();
        ctx.translate(px(sx), py(sy));
        ctx.rotate(rot);
        for (let i = -1; i <= 1; i++) ctx.fillRect(-bl / 2, i * gap - bh / 2, bl, bh);
        ctx.restore();
      });
      break;
    }

    default:
      break;
  }
}

/** Sonderfälle, die sich nicht sinnvoll als Streifen-Spec ausdrücken lassen. */
function drawSpecialFlag(ctx, kind, x, y, w, h) {
  switch (kind) {
    case 'us': {
      const stripes = 13;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#b22234' : '#ffffff';
        ctx.fillRect(x, y + (i * h) / stripes, w, h / stripes + 0.6);
      }
      ctx.fillStyle = '#3c3b6e';
      ctx.fillRect(x, y, w * 0.42, (h * 7) / stripes);
      ctx.fillStyle = '#ffffff';
      const r = Math.max(0.6, h * 0.022);
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 6; col++) {
          const cx = x + w * 0.42 * ((col + 0.5 + (row % 2) * 0.5) / 6.2);
          const cy = y + (h * 7 / stripes) * ((row + 0.7) / 5.4);
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        }
      }
      break;
    }
    case 'au':
    case 'nz': {
      ctx.fillStyle = kind === 'au' ? '#00008b' : '#00247d';
      ctx.fillRect(x, y, w, h);
      // Union Jack im Obereck, stark vereinfacht
      const uw = w * 0.5, uh = h * 0.5;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, uw, uh); ctx.clip();
      ctx.fillStyle = '#00247d'; ctx.fillRect(x, y, uw, uh);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = uh * 0.22;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + uw, y + uh);
      ctx.moveTo(x + uw, y); ctx.lineTo(x, y + uh);
      ctx.stroke();
      ctx.strokeStyle = '#cf142b'; ctx.lineWidth = uh * 0.1;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + uw, y + uh);
      ctx.moveTo(x + uw, y); ctx.lineTo(x, y + uh);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = uh * 0.3;
      ctx.beginPath();
      ctx.moveTo(x, y + uh / 2); ctx.lineTo(x + uw, y + uh / 2);
      ctx.moveTo(x + uw / 2, y); ctx.lineTo(x + uw / 2, y + uh);
      ctx.stroke();
      ctx.strokeStyle = '#cf142b'; ctx.lineWidth = uh * 0.17;
      ctx.beginPath();
      ctx.moveTo(x, y + uh / 2); ctx.lineTo(x + uw, y + uh / 2);
      ctx.moveTo(x + uw / 2, y); ctx.lineTo(x + uw / 2, y + uh);
      ctx.stroke();
      ctx.restore();
      // Kreuz des Südens
      const starC = kind === 'au' ? '#ffffff' : '#cf142b';
      const pts = [[0.74, 0.24], [0.86, 0.5], [0.74, 0.76], [0.62, 0.55], [0.80, 0.40]];
      pts.forEach((p, i) => {
        const rr = h * (i === 4 ? 0.045 : 0.075);
        starPath(ctx, x + p[0] * w, y + p[1] * h, rr, rr * 0.42, kind === 'au' ? 7 : 5);
        ctx.fillStyle = starC; ctx.fill();
        if (kind === 'nz') { ctx.lineWidth = Math.max(1, h * 0.012); ctx.strokeStyle = '#ffffff'; ctx.stroke(); }
      });
      if (kind === 'au') {
        const rr = h * 0.11;
        starPath(ctx, x + w * 0.25, y + h * 0.76, rr, rr * 0.42, 7);
        ctx.fillStyle = '#ffffff'; ctx.fill();
      }
      break;
    }
    case 'za': {
      // Südafrika: rot oben, blau unten, grünes Y mit weiß/gold gesäumt, schwarzes Dreieck
      ctx.fillStyle = '#e03c31'; ctx.fillRect(x, y, w, h / 2);
      ctx.fillStyle = '#001489'; ctx.fillRect(x, y + h / 2, w, h / 2);
      const yBand = (col, t) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x, y + h * (0.5 - t));
        ctx.lineTo(x + w * 0.33, y + h * 0.5);
        ctx.lineTo(x + w, y + h * (0.5 - t * 1.6));
        ctx.lineTo(x + w, y + h * (0.5 + t * 1.6));
        ctx.lineTo(x + w * 0.33, y + h * 0.5);
        ctx.lineTo(x, y + h * (0.5 + t));
        ctx.closePath(); ctx.fill();
      };
      yBand('#ffffff', 0.26);
      yBand('#007a4d', 0.17);
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.moveTo(x, y + h * 0.16); ctx.lineTo(x + w * 0.24, y + h * 0.5); ctx.lineTo(x, y + h * 0.84);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffb81c';
      ctx.beginPath();
      ctx.moveTo(x, y + h * 0.10); ctx.lineTo(x + w * 0.30, y + h * 0.5); ctx.lineTo(x, y + h * 0.90);
      ctx.lineTo(x, y + h * 0.84); ctx.lineTo(x + w * 0.24, y + h * 0.5); ctx.lineTo(x, y + h * 0.16);
      ctx.closePath(); ctx.fill();
      break;
    }
    default:
      break;
  }
}

/**
 * Zeichnet eine Nationalflagge.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} nationCode  ISO-2-Kürzel wie in NATION_NAMES (z. B. 'DE', 'SCO')
 * @param {number} x  linke obere Ecke
 * @param {number} y  linke obere Ecke
 * @param {number} w  Breite
 * @param {number} h  Höhe
 */
export function drawFlag(ctx, nationCode, x, y, w, h) {
  const code = String(nationCode || '').toUpperCase();
  const spec = FLAGS[code];

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  if (!spec) {
    // Unbekannte Nation: neutrales Feld mit Kürzel – fällt beim Testen sofort auf.
    ctx.fillStyle = '#8b8f96';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${h * 0.6}px ${CREST_FONT_STACK}`;
    ctx.fillText(code.slice(0, 3) || '?', x + w / 2, y + h / 2 + h * 0.04);
  } else if (spec.k) {
    drawSpecialFlag(ctx, spec.k, x, y, w, h);
  } else {
    if (spec.f) { ctx.fillStyle = spec.f; ctx.fillRect(x, y, w, h); }
    else if (spec.h) fStripes(ctx, x, y, w, h, spec.h, spec.w, false);
    else if (spec.v) fStripes(ctx, x, y, w, h, spec.v, spec.w, true);
    if (spec.ov) for (const ov of spec.ov) drawFlagOverlay(ctx, ov, x, y, w, h);
  }

  ctx.restore();

  // Umriss – hebt weiße Flaggen vom hellen Panel ab.
  ctx.save();
  const lw = Math.max(1, Math.min(w, h) * 0.05);
  ctx.lineWidth = lw;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
  ctx.restore();
}

/** Wird eine Flagge für diesen Code gezeichnet (oder nur der Platzhalter)? */
export function hasFlag(nationCode) {
  return Object.prototype.hasOwnProperty.call(FLAGS, String(nationCode || '').toUpperCase());
}

/** Deutscher Nationenname mit Fallback auf das Kürzel. */
export function nationName(code) {
  return NATION_NAMES[String(code || '').toUpperCase()] || String(code || '—');
}

/** Alle Codes, für die eine echte Flagge existiert (Debug/Übersicht). */
export const FLAG_CODES = Object.keys(FLAGS);
