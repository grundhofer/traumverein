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
 *   • setSpeed(8) → Phase läuft weiter, nur gerafft (siehe PHASE_MIN_SECONDS)
 *   • destroy() → rAF-Loop gestoppt, Listener entfernt, offene Promises aufgelöst
 *
 * ---------------------------------------------------------------------------
 * PHASEN-SCHEMA (CONTRACTS §6)
 * ---------------------------------------------------------------------------
 * Es gibt GENAU EINE Verzweigung, nämlich `nutzeSegmente` in prepPhase():
 *
 *   phase.v >= 2 && Array.isArray(phase.segments) && phase.segments.length
 *
 * Ist sie wahr, liefern die Segmente Typ, Zeitfenster und Scheitelhöhe des
 * Ballwegs sowie das Zeitfenster jedes Akteurs. Ist sie falsch, gilt exakt der
 * Altpfad: ball[]/actors[] sind die Wahrheit, der Segmenttyp wird aus Distanz,
 * Phasenart und einem folgenden Kopfball geraten, und skriptierte Akteure
 * werden weiterhin per lerp+easeInOut auf ihre Zielposition gezogen (die alte
 * Engine platziert Akteure bis 40 m entfernt – ein begrenzter Integrator
 * erzeugte dort einen sichtbaren Snap).
 *
 * ---------------------------------------------------------------------------
 * HÖHENKONVENTION (verbindlich, auch für die Schlüsselszenen)
 * ---------------------------------------------------------------------------
 *   DER SCHATTEN TRÄGT DIE HÖHE, DER BALL WÄCHST MIT z.
 *
 *   • Der Schatten liegt IMMER am Boden (x, y, 0) und wandert mit der Höhe
 *     seitlich weg (Sonne links oben): BALL_SHADOW_DX/DY je Meter Höhe.
 *   • Der Schattenradius ist konstant `ppm · BALL_RADIUS_M`; nur seine Form
 *     (breiter/flacher) und sein Alpha ändern sich mit z.
 *   • Der Ball wird um `ballLift(z)` Meter nach oben versetzt gezeichnet und
 *     wächst dabei leicht (Perspektive), er wird NICHT größer statt höher.
 *   • `ballLift()` sättigt (z/(1+z/12)), damit eine 25-m-Flanke nicht aus dem
 *     Bild fliegt. Flugspur und Ball benutzen dieselbe Funktion.
 *
 * Syntaxprüfung:  node --check src/render/pitch.js
 * Die reinen Helfer (kettenTiefe, abseitsBezug, breitenSkala, torwartZiel,
 * kameraZiel, kameraKlemme, notbremseAnteil, phaseNotbremse, ballLift, segmentTyp) sind DOM-frei
 * und werden von tools/test-buehne.js unter Node geprüft.
 * ---------------------------------------------------------------------------
 */

import { drawPlayer, drawKeeper } from './players.js';
import { clamp, lerp } from '../core/util.js';
import { POSITION_AFFINITY, POSITION_GROUP, DEFAULT_COLORS } from '../core/constants.js';
import { createRng } from '../core/rng.js';
import { segmentFlug, laufwerte, sprintSchritt, lenke, SEGMENT_TYPEN } from '../core/ballistik.js';

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

/* --- Spielerbewegung ---
 * Die Kinematik kommt aus core/ballistik.js: laufwerte() macht aus tempo/antritt/
 * koerper/fitness echte vmax/apeak/aBrems-Werte, sprintSchritt() ist die exakte
 * Exponentiallösung, lenke() erzeugt Laufbögen mit begrenzter Querbeschleunigung.
 * Es gibt hier KEINEN Positionsfilter mehr — jeder Spieler hat einen echten
 * Geschwindigkeitszustand (e.vx/e.vy). */
const PHYS_STEP = 1 / 60;         // fester Teilschritt der Spielerintegration
const PHYS_MAX_STEPS = 6;         // Obergrenze je Frame (Tempo 4 braucht 4)
const TURN_ARC_SPEED = 2.0;       // ab hier wird gelenkt statt neu beschleunigt
const TURN_ARC_MIN = 0.35;        // rad: darunter lohnt kein Bogen
const TURN_ARC_MAX = 1.90;        // rad: darüber wird gebremst und gewendet
const BRAKE_MARGIN = 0.35;        // m: Restweg, den der Bremsweg auslässt
const TEAM_SHIFT_Y = 0.34;        // seitliches Verschieben zur Ballseite
const COMPACT_ATT = 0.1;          // Sog zum Ball in Ballbesitz
const COMPACT_DEF = 0.2;          // Sog zum Ball beim Verteidigen
const COMPACT_RADIUS = 26;        // ab dieser Ballentfernung interessiert es keinen mehr

/* Abwehrkette: EINE Tiefe je Mannschaft und Frame (updateTeamLines). */
const LINE_PUSH_RATE = 5.5;       // m/s beim Aufrücken
const LINE_DROP_RATE = 12;        // m/s beim Zurückfallen (schneller, das ist Panik)
const BLOCK_DEPTH_DEF_LOW = 26;   // Blocktiefe verteidigend, Ball am eigenen Tor
const BLOCK_DEPTH_DEF_HIGH = 34;  // … Ball am gegnerischen Tor
const BLOCK_DEPTH_ATT_LOW = 34;   // Blocktiefe in Ballbesitz
const BLOCK_DEPTH_ATT_HIGH = 42;
const ABW_LINE_BIND = 0.35;       // Rest-Staffelung innerhalb der Kette
const OFFSIDE_TOLERANZ = 0.6;     // m, die ein Stürmer am letzten Mann klebt
/* Die Grundordnung aus buildFormationSlots() ist rund 55 m tief. So spielt
 * niemand: in Ballbesitz sind es etwa 40 m, beim Verteidigen etwa 30 m. Die
 * Staffelung wird deshalb gestaucht — die Mannschaft schiebt als Block. */
const BLOCK_STRETCH_ATT = 0.75;
const BLOCK_STRETCH_DEF = 0.55;

/* Breite entsteht durch SKALIERUNG um die Feldmitte, nicht durch Verschieben —
 * sonst laufen die Außen bei jedem Ballwechsel quer über die Seitenlinie. */
const WIDE_ATT = 0.95;
const WIDE_DEF_NEAR = 0.88;       // ballnahe Seite bleibt breit
const WIDE_DEF_FAR = 0.46;        // ballferne Seite rückt ein

const ROLE_INTERVAL = 0.25;       // s Spielzeit zwischen zwei Rollenvergaben
const KEEPER_OUT_MAX = 13;        // maximaler Torwart-Auslauf
const WOBBLE_AMP = 0.32;          // Zappeln im Stand (Meter)
const WOBBLE_SPEED = 1.7;
const RUN_POSE_SPEED = 0.9;       // ab dieser Geschwindigkeit gilt „Lauf"
const LOOK_RUN_SPEED = 4.6;       // ab hier schaut der Spieler in die Laufrichtung
const LOOK_DEADZONE = 0.35;       // m: darunter wird die Blickrichtung nicht gewechselt
const STRIDE_MIN = 1.5;           // m je Schrittzyklus
const STRIDE_MAX = 4.6;
const ACTION_POSE_LEN = 0.22;     // Anteil der Phase, den eine Aktionspose dauert
const ACTION_POSE_DIST = 2.6;     // m: Aktionsposen brauchen den Ball in Reichweite

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

/* --- Ball (Höhenkonvention siehe Dateikopf) --- */
const BALL_RADIUS_M = 0.30;       // optisch vergrößert (real 0.11 m wäre unsichtbar)
const BALL_LIFT = 0.62;           // Bildschirmversatz je Meter Flughöhe (gesättigt)
const BALL_LIFT_SAT = 12;         // Sättigungshöhe: lift = LIFT·z/(1+z/SAT)
const BALL_SHADOW_DX = 0.26;      // Schattenversatz je Meter Höhe (Sonne links oben)
const BALL_SHADOW_DY = 0.18;
const BALL_ROLL_SPIN = 1 / BALL_RADIUS_M;  // rad je zurückgelegtem Meter am Boden (3,33)
const BALL_AIR_SPIN = 0.40;       // rad je Meter in der Luft (Ball dreht sich träger)
const BALL_AIR_Z = 0.05;          // ab dieser Höhe gilt „in der Luft"
const TRAIL_SECONDS = 0.18;       // Lebensdauer eines Spurpunkts (Spielzeit)
const TRAIL_MIN_SPEED = 7;        // m/s: darunter gibt es keine Spur
const TRAIL_MAX = 24;             // Ringpuffergröße (keine Allokation im Frame)

/* Segmenttyp-Heuristik für den ALTPFAD (phase.v < 2): aus der Segmentlänge wird
 * ein Typ aus ballistik.SEGMENT_TYPEN geraten, die Scheitelhöhe kommt danach aus
 * der Ballistik. Die früheren LOFT_*-Faktoren (Scheitel = Distanz × Faktor, ohne
 * Kopplung an die Flugzeit) sind damit ersatzlos entfallen. */
const TYP_DIST_LANG = 24;         // ab dieser Länge ist es eine Flanke
const TYP_DIST_MITTEL = 13;       // ab dieser Länge ein Steilpass
const TYP_DIST_KURZ = 4;          // darunter Dribbling
/* Eine von der Engine GESETZTE Scheitelhöhe (seg.height) wird nur noch in ihren
 * Betrag geklemmt — es gibt keine Schwelle mehr, unterhalb derer sie als „nicht
 * gesetzt" durchgeht. `0` heißt laut Vertrag §6.2 flach und wird auch so
 * gezeichnet; nur ein FEHLENDES Feld überlässt die Höhe der Ballistik.
 * HOEHE_MIN ist ausdrücklich KEINE solche Schwelle, sondern die Untergrenze für
 * den Betrag einer bereits als positiv erkannten Höhe: unter 15 cm liefert der
 * Scheitel-Löser keine brauchbare Bahn mehr. Die Unterscheidung „gesetzt /
 * nicht gesetzt" fällt allein über `typeof`, nicht über eine Zahl — sonst wäre
 * eine ausdrückliche 0 wieder von einem fehlenden Feld ununterscheidbar.
 * Die kleinste positive Höhe, die die Engine heute schreibt, ist 0,6 m
 * (Schuss/Parade); HOEHE_MIN greift also nur gegen krumme Fremddaten. */
const HOEHE_MIN = 0.15;           // m: Untergrenze einer positiv gesetzten Höhe
const HOEHE_MAX = 24;             // m: Obergrenze (darüber ist es kein Fußball mehr)

/* Getretene Flachbälle: `segmentFlug` legt die Bahn so, dass der ERSTE
 * Bodenkontakt genau auf dem Zielpunkt liegt — ein 30-m-Ball käme damit ohne
 * einen einzigen Aufsetzer an. Für die getretenen Bodenbälle wird deshalb eine
 * flache Scheitelhöhe vorgegeben; dann setzt der Ball früh auf und hoppelt
 * sichtbar bis zum Ziel. Das gilt für „height fehlt" wie für „height = 0" —
 * beides ist ein flacher Ball, und 18–65 cm Wellenhöhe SIND flach. Nur eine
 * ausdrücklich POSITIVE Höhe der Engine hat Vorrang. */
const HUEPF_TYPEN = { pass_flach: 1, steilpass: 1 };
const HUEPF_MIN_DIST = 8;         // m: darunter lohnt kein Hoppeln
const HUEPF_FAKTOR = 0.014;       // Scheitel = 1,4 % der Länge …
const HUEPF_MIN = 0.18;           // … mindestens 18 cm …
const HUEPF_MAX = 0.65;           // … höchstens 65 cm

/* --- Spieler-Sprites --- */
const PLAYER_VIS_HEIGHT_M = 2.7;  // visuell überhöhte „Körpergröße" für Lesbarkeit
const PLAYER_SPRITE_REF_PX = 47;  // Sprite-Höhe bei scale = 1 (players.js: Scheitel −47, Füße 0)
const PLAYER_SCALE_MIN = 0.16;
const PLAYER_SCALE_MAX = 1.6;
const LABEL_MIN_PX = 6;           // darunter wird gar nicht beschriftet
const LABEL_NAME_MIN_PX = 8;      // darunter nur die Rückennummer
const CARRIER_RADIUS = 1.6;       // Ballnähe für die Ballführenden-Markierung
const CARRIER_MAX_Z = 0.8;        // darüber führt niemand den Ball, er fliegt

/* --- Kamera ---
 * Hysterese statt Schwelle (sonst pumpt der Zoom im Sekundentakt), Vorhalt statt
 * Nachlaufen, Glättung auf SPIELZEIT (sonst zieht Tempo 4 die Kamera hinterher).
 * Die Anschläge greifen am ZIEL, nicht an cam.* — nur so lässt sich ein Tor
 * zentrieren, ohne dass der Glätter gegen den Anschlag arbeitet. */
const CAM_SMOOTH = 2.8;
const CAM_LEAD = 1 / CAM_SMOOTH;  // s Vorhalt (0,357) — passt zur Glättungszeit
const CAM_ZOOM_AUFBAU = 1.0;
const CAM_ZOOM_KONTER = 1.3;
const CAM_ZOOM_ACTION = 2.3;      // Angriff und Standard
const CAM_ZOOM_GOAL = 2.1;
const CAM_KONTER_LEAD = 8;        // m Vorhalt in Laufrichtung
const CAM_KONTER_SMOOTH = 1.5;    // Faktor auf CAM_SMOOTH
const CAM_HOLD_MS = 1400;         // Nachlauf, damit der Zoom nicht zappelt
const CAM_OVERSCAN = 24;          // m, die die Kamera über das Stadion hinausdarf
const CAM_TOTALE_SPEED = 6;       // ab diesem Tempo bleibt die Kamera auf Totale
const FINAL_THIRD_IN = 30;        // Meter vom Tor: ab hier wird cineastisch gezoomt
const FINAL_THIRD_OUT = 40;       // … und erst hier wieder aufgezogen

/* --- Ablauf --- */
const PHASE_MIN_SECONDS = 0.30;   // kürzeste Realzeit einer Phase (statt Überspringen)
const DETAIL_OFF_SPEED = 6;       // ab hier: keine Spur, kein Flimmern, kein Rauschen

/* --- HUD / Banner --- */
const HUD_RESERVE = 58;           // reservierte Bildschirmhöhe oben
const HUD_BAR_H = 34;
const HUD_CLOCK_W = 78;
const HUD_CLOCK_H = 20;
const BANNER_DEFAULT_MS = 2000;
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

/* ===========================================================================
 * 2b. REINE HELFER — exportiert, DOM-frei, von tools/test-buehne.js geprüft
 *
 * Alles, was die Bühne an Spiellogik rechnet (Kettentiefe, Abseitsbezug,
 * Breitenskalierung, Torwartposition, Kameraziel, Notbremse), steht hier als
 * seiteneffektfreie Funktion. Der Renderer ruft sie nur noch auf.
 * ========================================================================= */

/**
 * Ziel-Tiefe der Abwehrkette in Metern vom EIGENEN Tor.
 * @param {number} ballTiefe  Abstand des Balls vom eigenen Tor in Angriffsrichtung (0…105)
 * @param {boolean} inBallbesitz
 */
export function kettenTiefe(ballTiefe, inBallbesitz) {
  const lo = inBallbesitz ? BLOCK_DEPTH_ATT_LOW : BLOCK_DEPTH_DEF_LOW;
  const hi = inBallbesitz ? BLOCK_DEPTH_ATT_HIGH : BLOCK_DEPTH_DEF_HIGH;
  const u = clamp(isFinite(ballTiefe) ? ballTiefe / PITCH_L : 0, 0, 1);
  return lerp(lo, hi, u);
}

/**
 * Abseitsbezug der angreifenden Seite: die x-Koordinate, an der ihre Stürmer
 * kleben dürfen — letzter gegnerischer FELDspieler plus OFFSIDE_TOLERANZ in
 * Angriffsrichtung.
 * @param {number} tiefsteGegnerX  x des letzten gegnerischen Feldspielers
 * @param {number} dir             Angriffsrichtung, +1 (Heim) oder −1 (Gast)
 */
export function abseitsBezug(tiefsteGegnerX, dir) {
  const d = dir < 0 ? -1 : 1;
  const x = isFinite(tiefsteGegnerX) ? tiefsteGegnerX : PITCH_L / 2;
  return clamp(x + d * OFFSIDE_TOLERANZ, 1.2, PITCH_L - 1.2);
}

/**
 * Breitenskalierung um die Feldmitte. In Ballbesitz bleibt die Mannschaft breit,
 * beim Verteidigen rückt die BALLFERNE Seite ein — deshalb eine Skalierung und
 * keine Verschiebung: sonst wandert die ganze Reihe über die Seitenlinie.
 */
export function breitenSkala(inBallbesitz, baseY, ballY) {
  if (inBallbesitz) return WIDE_ATT;
  const my = PITCH_W / 2;
  const b = isFinite(baseY) ? baseY : my;
  const q = isFinite(ballY) ? ballY : my;
  const nah = clamp(0.5 + ((b - my) * (q - my)) / 240, 0, 1);
  return lerp(WIDE_DEF_FAR, WIDE_DEF_NEAR, nah);
}

/**
 * Torwartposition auf der Ball-Tor-Achse (nicht auf der x-Tiefe: sonst steht der
 * Keeper bei einem Ball von der Seite neben dem Pfosten). y bleibt immer
 * innerhalb der Torbreite ± 0,4 m.
 */
export function torwartZiel(ballX, ballY, eigenesTorX, out) {
  const r = out || { x: 0, y: 0 };
  const my = PITCH_W / 2;
  const gx = eigenesTorX > PITCH_L / 2 ? PITCH_L : 0;
  let dx = (isFinite(ballX) ? ballX : PITCH_L / 2) - gx;
  let dy = (isFinite(ballY) ? ballY : my) - my;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) { dx = gx > 0 ? -1 : 1; dy = 0; }
  else { dx /= d; dy /= d; }
  const auslauf = clamp(1.8 + d * 0.10, 1.2, KEEPER_OUT_MAX);
  r.x = clamp(gx + dx * auslauf, 0.4, PITCH_L - 0.4);
  r.y = clamp(my + dy * auslauf, my - (GOAL_HALF_W + 0.4), my + (GOAL_HALF_W + 0.4));
  return r;
}

/** Zoomstufe je Phasenart. Unbekannte Arten ('abwehr', 'uebergang') = Aufbau. */
const ZOOM_JE_ART = {
  aufbau: CAM_ZOOM_AUFBAU,
  konter: CAM_ZOOM_KONTER,
  angriff: CAM_ZOOM_ACTION,
  standard: CAM_ZOOM_ACTION
};

/**
 * Kameraziel und Brennweite — rein geometrisch, OHNE Anschläge (die macht
 * kameraKlemme, und zwar am Ziel statt an der Kameraposition).
 *
 * @param {object} o {cinematic, tempo, aktiv, kind, hot, jubel, jubelX, jubelY,
 *                    standX, standY, ballX, ballY, ballVx, ballVy}
 * @param {object} [out] wiederverwendetes Ergebnisobjekt (keine Allokation im Frame)
 * @returns {{x:number,y:number,zoom:number,smooth:number}}
 */
export function kameraZiel(o, out) {
  const r = out || { x: 0, y: 0, zoom: 1, smooth: CAM_SMOOTH };
  r.smooth = CAM_SMOOTH;
  const tempo = clamp(isFinite(o.tempo) ? o.tempo : 1, 0.25, 16);
  const bx = isFinite(o.ballX) ? o.ballX : PITCH_L / 2;
  const by = isFinite(o.ballY) ? o.ballY : PITCH_W / 2;

  // Ab Tempo 6 gibt es keine Kamerafahrt mehr — sie wäre nur noch Zucken.
  if (o.cinematic === false || tempo >= CAM_TOTALE_SPEED) {
    r.x = WORLD_CX; r.y = WORLD_CY; r.zoom = 1;
    return r;
  }
  if (o.jubel) {
    r.x = isFinite(o.jubelX) ? o.jubelX : bx;
    r.y = isFinite(o.jubelY) ? o.jubelY : by;
    r.zoom = CAM_ZOOM_GOAL;
    return r;
  }

  const art = o.aktiv ? (ZOOM_JE_ART[o.kind] !== undefined ? o.kind : 'aufbau') : null;

  // Standard: die Kamera steht auf dem Ausführungsort, nicht auf dem rollenden Ball.
  if (art === 'standard') {
    r.x = isFinite(o.standX) ? o.standX : bx;
    r.y = isFinite(o.standY) ? o.standY : by;
    r.zoom = CAM_ZOOM_ACTION;
    return r;
  }

  const vx = isFinite(o.ballVx) ? o.ballVx : 0;
  const vy = isFinite(o.ballVy) ? o.ballVy : 0;
  let tx = bx + vx * CAM_LEAD;
  let ty = by + vy * CAM_LEAD;

  if (art === 'konter') {
    const s = Math.hypot(vx, vy);
    if (s > 0.5) { tx = bx + (vx / s) * CAM_KONTER_LEAD; ty = by + (vy / s) * CAM_KONTER_LEAD; }
    r.x = tx; r.y = ty;
    r.zoom = o.hot ? CAM_ZOOM_ACTION : CAM_ZOOM_KONTER;
    r.smooth = CAM_SMOOTH * CAM_KONTER_SMOOTH;
    return r;
  }
  if (art === 'angriff') {
    r.x = tx; r.y = ty; r.zoom = CAM_ZOOM_ACTION;
    return r;
  }
  if (art === 'aufbau') {
    if (o.hot) { r.x = tx; r.y = ty; r.zoom = CAM_ZOOM_ACTION; return r; }
    // Aufbau: halb Ball, halb Feldmitte — man sieht, wohin gespielt werden kann.
    r.x = (tx + PITCH_L / 2) / 2;
    r.y = (ty + PITCH_W / 2) / 2;
    r.zoom = CAM_ZOOM_AUFBAU;
    return r;
  }
  // Keine Phase: solange die Hysterese heiß ist, bleibt die Kamera am Ball.
  if (o.hot) { r.x = tx; r.y = ty; r.zoom = CAM_ZOOM_ACTION; return r; }
  r.x = WORLD_CX; r.y = WORLD_CY; r.zoom = 1;
  return r;
}

/**
 * Anschläge am KAMERAZIEL. halbW/halbH sind die halbe Sichtbreite/-höhe in Metern
 * bei der ZIEL-Brennweite. CAM_OVERSCAN erlaubt es, ein Tor zu zentrieren.
 */
export function kameraKlemme(x, y, halbW, halbH, out) {
  const r = out || { x: 0, y: 0 };
  const minX = WX0 - CAM_OVERSCAN + halbW, maxX = WX1 + CAM_OVERSCAN - halbW;
  const minY = WY0 - CAM_OVERSCAN + halbH, maxY = WY1 + CAM_OVERSCAN - halbH;
  r.x = minX > maxX ? WORLD_CX : clamp(x, minX, maxX);
  r.y = minY > maxY ? WORLD_CY : clamp(y, minY, maxY);
  return r;
}

/**
 * WANDUHR-NOTBREMSE (Pflicht), Teil 1: das Budget fortschreiben.
 *
 * `screens/spieltag.js` wartet ohne Timeout-Race auf das Promise von playPhase();
 * bliebe eine Phase hängen (Tab im Hintergrund, ausgebremster Timer, Bildrate im
 * Keller), hinge das ganze Spiel. Grenze: doppelte erwartete Dauer plus 2 s.
 *
 * Gezählt wird aber NICHT die absolute Wanduhrzeit seit Phasenbeginn, sondern der
 * ANTEIL des Budgets, den jeder Frame beim GERADE eingestellten Tempo verbraucht.
 * Der Grund ist ein Fehlauslöser: die Grenze schrumpft mit steigendem Tempo
 * (dur/tempo), die bereits aufgelaufene Zeit tut das nicht. Wer mitten in einer
 * langsam laufenden Phase auf Tempo 8 stellt, risse sie sonst schlagartig ab —
 * die Notbremse ist sicherheitskritisch, darf aber kein normales Bedienen
 * bestrafen. Tempo-normiert bleibt Verbrauchtes verbraucht, und nur der Rest
 * läuft ab jetzt schneller ab.
 *
 * `dtWanduhr` ist die ECHTE, ungedeckelte Framezeit — dt wird in tick() auf 0,12 s
 * geklemmt, die Notbremse darf davon nichts mitbekommen.
 *
 * @param {number} verbraucht  bisheriger Budgetanteil (0 beim ersten Frame)
 * @param {number} dtWanduhr   Sekunden Wanduhr seit dem letzten Frame
 * @param {number} dur         Phasendauer in Spielsekunden
 * @param {number} tempo       gerade eingestelltes Tempo
 * @returns {number} neuer Budgetanteil
 */
export function notbremseAnteil(verbraucht, dtWanduhr, dur, tempo) {
  const v = isFinite(verbraucht) && verbraucht > 0 ? verbraucht : 0;
  if (!isFinite(dtWanduhr) || dtWanduhr <= 0 || !isFinite(dur) || dur <= 0) return v;
  const s = clamp(isFinite(tempo) && tempo > 0 ? tempo : 1, 0.25, 16);
  const grenze = (dur / s) * 2 + 2;   // Sekunden Wanduhr, die BEI DIESEM Tempo erlaubt sind
  return v + dtWanduhr / grenze;
}

/**
 * WANDUHR-NOTBREMSE, Teil 2: ist das Budget aufgebraucht? Bei gleichbleibendem
 * Tempo ist das exakt nach `dur/tempo · 2 + 2` Sekunden Wanduhr der Fall.
 */
export function phaseNotbremse(verbraucht) {
  return isFinite(verbraucht) && verbraucht >= 1;
}

/**
 * Bildschirmversatz des Balls in METERN je Flughöhe (siehe Höhenkonvention im
 * Dateikopf). Sättigt, damit eine hohe Flanke nicht aus dem Bild wandert.
 */
export function ballLift(z) {
  const h = isFinite(z) && z > 0 ? z : 0;
  return BALL_LIFT * h / (1 + h / BALL_LIFT_SAT);
}

/**
 * Segmenttyp aus der Geometrie — nur für den ALTPFAD (phase.v < 2). Bei v2
 * kommt der Typ aus seg.type.
 * @returns {string} Schlüssel aus ballistik.SEGMENT_TYPEN
 */
export function segmentTyp(dist, phaseKind, istErstes, kopfballFolgt) {
  const d = isFinite(dist) ? dist : 0;
  if (kopfballFolgt) return 'flanke';
  if (phaseKind === 'standard' && istErstes && d >= 7) return d >= TYP_DIST_LANG ? 'flanke' : 'freistoss';
  if (d < TYP_DIST_KURZ) return 'dribbling';
  if (d >= TYP_DIST_LANG) return 'flanke';
  if (d >= TYP_DIST_MITTEL) return 'steilpass';
  return 'pass_flach';
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
 * 5. BALLWEG — echte Ballistik statt geratener Loft-Kurven
 *
 * Je Segment wird EINMAL beim Anlegen der Phase `ballistik.segmentFlug()`
 * gerufen; der fertige Flug (inkl. Aufsetzern und Rollphase) wird gespeichert.
 * Im Frame wird nur noch `flug.at()` ausgewertet — kein Integrator in der
 * rAF-Schleife, keine Allokation.
 *
 * Zeitabbildung: Die Simulation gibt jedem Segment ein Zeitfenster [t0, t1]
 * (Vertrag §6.2: „der Renderer rechnet mit t0/t1"). Der Flug hat seine eigene,
 * physikalische Dauer bis zum Zielpunkt (`tEnde`). Der lokale Fortschritt u des
 * Segments wird deshalb auf `u · tEnde` abgebildet: die FORM der Bahn (Aufsetzer,
 * Ausrollen, Scheitel) ist physikalisch, die DAUER kommt aus der Simulation.
 * Die zurückgelegte Strecke wird auf die Segmentlänge normiert, damit der Ball
 * am Segmentende exakt auf `to` liegt.
 * ========================================================================= */

/**
 * Baut den Ballweg einer Phase als Liste fertiger Flüge.
 *
 * @param {object} phase
 * @param {boolean} nutzeSegmente  DIE eine Verzweigung (Vertrag §6.2)
 * @param {number} fromX  aktuelle Ballposition (Startpunkt, falls die Phase keinen nennt)
 * @param {number} fromY
 * @returns {{segs:Array,akustik:Array}|null}
 */
function buildBallPath(phase, nutzeSegmente, fromX, fromY) {
  const roh = [];

  if (nutzeSegmente) {
    const segs = phase.segments;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      // Unvollständige Segmente werden übersprungen, nicht geworfen (Vertrag §6.2/3).
      if (!s || !s.from || !s.to) continue;
      if (!isFinite(s.from.x) || !isFinite(s.from.y) || !isFinite(s.to.x) || !isFinite(s.to.y)) continue;
      const t0 = clamp(isFinite(s.t0) ? s.t0 : 0, 0, 1);
      const t1 = clamp(isFinite(s.t1) ? s.t1 : 1, 0, 1);
      roh.push({
        von: { x: clamp(s.from.x, -3, PITCH_L + 3), y: clamp(s.from.y, -3, PITCH_W + 3) },
        nach: { x: clamp(s.to.x, -3, PITCH_L + 3), y: clamp(s.to.y, -3, PITCH_W + 3) },
        t0, t1: Math.max(t1, t0),
        typ: SEGMENT_TYPEN[s.type] ? s.type : (s.type === 'ruecklage' ? 'pass_flach' : null),
        // seg.height ist die Scheitelhöhe. Der Vertrag (§6.2) ist wörtlich:
        // „0 = flach". Unterschieden wird deshalb ausschließlich zwischen
        //   FELD FEHLT  (undefined/null/NaN) ⇒ null ⇒ die Ballistik des
        //               Segmenttyps entscheidet, und
        //   FELD GESETZT (jede endliche Zahl, 0 eingeschlossen) ⇒ die Engine hat
        //               entschieden, der Renderer folgt.
        // Es gibt keine Schwelle mehr, unterhalb derer eine gesetzte Höhe
        // stillschweigend verworfen wird.
        // (typeof-Prüfung mit Absicht: isFinite(null) ist true, und genau `null`
        //  ist hier die Aussage „nicht gesetzt".)
        //
        // Die Engine trifft inzwischen alle drei Aussagen: `engine/match.js`
        // schreibt in `segment()` das Feld nur noch, wenn `scheitelHoehe()`
        // eine hat — Flanke und Klärung bekommen ein Scheitelprofil, alle
        // übrigen Typen gar keins. Der Zweig „Feld fehlt" ist damit erreichbar
        // und der Normalfall.
        // Messung (8 Saatfolgen à 3 Spiele, 10 743 Segmente, Scheitel je Segment
        // gegen `ballistik.segmentFlug()`, „flach" = Scheitel < 1,0 m): 3 121
        // Segmente tragen ein height-Feld, 7 622 keins; flach gezeichnet werden
        // 0,0 % der 1 183 Flanken (0,0 % in jeder einzelnen Saatfolge) und 0,0 %
        // der 259 Klärungen — gegen 59,8 % (53,1–71,2 % je Saatfolge) bzw. 100 %
        // im Altstand, als die Engine `height: o.height || 0` schrieb.
        // Nachgemessen wird das bei jedem Lauf in `tools/test-buehne.js`,
        // Abschnitt 16 (dort eine Saatfolge, sonst dasselbe Lineal).
        hoehe: (typeof s.height === 'number' && isFinite(s.height)) ? Math.max(0, s.height) : null,
        outcome: s.outcome || null
      });
    }
    if (roh.length && roh[0].t0 > 0.001) roh[0].t0 = 0;
  } else {
    /* ---- ALTPFAD: ball[] ist die Wahrheit ------------------------------- */
    const pts = (phase && Array.isArray(phase.ball) ? phase.ball : [])
      .filter((p) => p && isFinite(p.x) && isFinite(p.y))
      .map((p) => ({
        x: clamp(p.x, -3, PITCH_L + 3),
        y: clamp(p.y, -3, PITCH_W + 3),
        t: clamp(isFinite(p.t) ? p.t : 0, 0, 1)
      }))
      .sort((a, b) => a.t - b.t);
    if (!pts.length) return null;
    if (pts[0].t > 0.001) pts.unshift({ x: fromX, y: fromY, t: 0 });
    const letzt = pts[pts.length - 1];
    if (letzt.t < 0.999) pts.push({ x: letzt.x, y: letzt.y, t: 1 });

    const kopfIdx = (phase && Array.isArray(phase.actors))
      ? phase.actors.findIndex((a) => a && a.action === 'kopfball')
      : -1;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      // Kopfball ⇒ das letzte Segment davor ist eine Flanke.
      const kopfballFolgt = kopfIdx >= 0 && i === pts.length - 2;
      roh.push({
        von: { x: a.x, y: a.y }, nach: { x: b.x, y: b.y },
        t0: a.t, t1: b.t,
        typ: segmentTyp(d, phase && phase.kind, i === 0, kopfballFolgt),
        hoehe: null, outcome: null
      });
    }
  }

  if (!roh.length) return null;

  const segs = [];
  const akustik = [];
  for (const r of roh) {
    const dx = r.nach.x - r.von.x, dy = r.nach.y - r.von.y;
    const dist = Math.hypot(dx, dy);
    const seg = {
      von: r.von, nach: r.nach, t0: r.t0, t1: r.t1,
      dist, dirX: dist > 1e-6 ? dx / dist : 1, dirY: dist > 1e-6 ? dy / dist : 0,
      flug: null, tEnde: 0, sEnde: 0, outcome: r.outcome
    };
    const typ = r.typ && SEGMENT_TYPEN[r.typ] ? r.typ : null;
    if (typ && dist > 0.2) {
      try {
        let hoehe = null;
        let hoeheGeraten = false;   // vom Renderer abgeleitet ⇒ darf notfalls fallen
        if (r.hoehe !== null && r.hoehe > 0) hoehe = clamp(r.hoehe, HOEHE_MIN, HOEHE_MAX);
        else if (HUEPF_TYPEN[typ] && dist >= HUEPF_MIN_DIST) {
          // „0 = flach" heißt bei einem GETRETENEN Bodenball nicht „schwebt über
          // dem Rasen": ein flacher Ball springt auf kurzen Wellen (≤ 65 cm,
          // ≤ 1,4 % der Länge). Das Hüpfen IST die Darstellung von flach — ohne
          // es glitte ein 30-m-Pass ohne einen einzigen Bodenkontakt durch.
          hoehe = clamp(dist * HUEPF_FAKTOR, HUEPF_MIN, HUEPF_MAX);
          hoeheGeraten = true;
        } else if (r.hoehe !== null) {
          hoehe = 0;   // ausdrücklich flach (Vertrag §6.2)
        }
        let flug = bauFlug(r.von, r.nach, typ, hoehe);
        let treffer = zeitBeiStrecke(flug, r.von.x, r.von.y, dist);
        // Erreicht der Ball das Ziel gar nicht (sehr weite Bodenbälle), gilt die
        // ungezwungene Bahn des Typs — sie kommt an, auch wenn sie höher fliegt.
        // Nur für die GERATENE Hüpfhöhe: eine von der Engine gesetzte Höhe steht.
        if (treffer.s < dist - 0.05 && hoeheGeraten) {
          flug.freigeben();
          flug = bauFlug(r.von, r.nach, typ, null);
          treffer = zeitBeiStrecke(flug, r.von.x, r.von.y, dist);
        }
        if (treffer.t > 1e-4 && treffer.s > 1e-4) {
          seg.flug = flug; seg.tEnde = treffer.t; seg.sEnde = treffer.s;
          for (const a of flug.aufsetzer()) {
            if (a.t > treffer.t) break;
            const pt = seg.t0 + (a.t / treffer.t) * (seg.t1 - seg.t0);
            akustik.push({ t: pt, art: 'aufsetzer', wucht: clamp(Math.abs(a.vz) / 9, 0, 1) });
          }
        } else {
          flug.freigeben();
        }
      } catch (err) {
        seg.flug = null;   // Ballistik verweigert ⇒ geradliniger Rückfall
      }
    }
    segs.push(seg);
  }
  if (segs.length) { segs[0].t0 = 0; segs[segs.length - 1].t1 = 1; }
  akustik.sort((a, b) => a.t - b.t);
  return { segs, akustik };
}

/** Wiederverwendeter Zustandspuffer für flug.at() — keine Allokation im Frame. */
const _flugZustand = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };

/** Ein Segmentflug; `hoehe` null = die Ballistik des Typs entscheidet. */
function bauFlug(von, nach, typ, hoehe) {
  const opt = { tMax: 4.0 };
  if (hoehe !== null) opt.hoehe = hoehe;
  return segmentFlug({ x: von.x, y: von.y, z: 0 }, { x: nach.x, y: nach.y, z: 0 }, typ, opt);
}

/**
 * Erster Zeitpunkt, zu dem der Flug `dist` Meter horizontal zurückgelegt hat.
 * Wird der Punkt nie erreicht (Ball bleibt vorher liegen), zählt das Flugende.
 * @returns {{t:number,s:number}}
 */
function zeitBeiStrecke(flug, vonX, vonY, dist) {
  const schritt = 1 / 60;
  let tPrev = 0, sPrev = 0;
  for (let t = schritt; t <= flug.dauer + 1e-9; t += schritt) {
    flug.at(t, _flugZustand);
    const s = Math.hypot(_flugZustand.x - vonX, _flugZustand.y - vonY);
    if (s >= dist) {
      const span = Math.max(1e-9, s - sPrev);
      const u = clamp((dist - sPrev) / span, 0, 1);
      return { t: tPrev + (t - tPrev) * u, s: dist };
    }
    tPrev = t; sPrev = s;
  }
  return { t: flug.dauer, s: sPrev };
}

/** Gibt alle Flüge eines Pfades an den Pool zurück. Doppelaufruf ist abgesichert. */
function pfadFreigeben(path) {
  if (!path || !path.segs) return;
  for (const s of path.segs) {
    if (s.flug) { s.flug.freigeben(); s.flug = null; }
  }
}

/**
 * Ballposition und Flughöhe zum relativen Phasenzeitpunkt t (0…1).
 * Schreibt in `out` (kein neues Objekt je Frame).
 */
function samplePath(path, t, out) {
  const segs = path.segs;
  const tt = clamp(t, 0, 1);
  let i = 0;
  while (i < segs.length - 1 && tt > segs[i].t1) i++;
  const s = segs[i];
  const u = clamp((tt - s.t0) / Math.max(1e-6, s.t1 - s.t0), 0, 1);

  if (!s.flug) {
    out.x = lerp(s.von.x, s.nach.x, u);
    out.y = lerp(s.von.y, s.nach.y, u);
    out.z = 0;
    return out;
  }
  s.flug.at(u * s.tEnde, _flugZustand);
  const gefahren = Math.hypot(_flugZustand.x - s.von.x, _flugZustand.y - s.von.y);
  const norm = s.sEnde > 1e-6 ? s.dist / s.sEnde : 1;
  out.x = clamp(s.von.x + s.dirX * gefahren * norm, -3, PITCH_L + 3);
  out.y = clamp(s.von.y + s.dirY * gefahren * norm, -3, PITCH_W + 3);
  out.z = _flugZustand.z > 0 ? _flugZustand.z : 0;
  return out;
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
  let nowMs = 0;          // Wanduhr (performance.now-Basis): Notbremse, Konfetti, Ränge
  let gameMs = 0;         // SPIELZEIT: Banner, Jubel, Blitzlicht, Rollenvergabe
  let speed = 1;
  let effSpeed = 1;       // tatsächlich benutztes Tempo (PHASE_MIN_SECONDS)
  let bank = opts.bank || opts.sound || null;     // Klangbank (P10), rein optional

  const initialW = canvas.width || 960;
  const initialH = canvas.height || 600;
  let cssW = initialW, cssH = initialH, dpr = 1;
  let viewX = 0, viewY = 0, viewW = initialW, viewH = initialH;
  let baseScale = 1;

  const cam = { x: WORLD_CX, y: WORLD_CY, zoom: 1, holdUntil: 0, hot: false };
  const camZiel = { x: WORLD_CX, y: WORLD_CY, zoom: 1, smooth: CAM_SMOOTH };
  const camKlemm = { x: WORLD_CX, y: WORLD_CY };
  const camArg = {
    cinematic: true, tempo: 1, aktiv: false, kind: null, hot: false,
    jubel: false, jubelX: 0, jubelY: 0, standX: NaN, standY: NaN,
    ballX: 0, ballY: 0, ballVx: 0, ballVy: 0
  };

  const teams = {
    home: {
      matchTeam: null, club: null, kit: null, ents: [], abbr: 'HEI',
      lineDepth: BLOCK_DEPTH_DEF_LOW, baseLineDepth: 20, offsideRef: PITCH_L / 2
    },
    away: {
      matchTeam: null, club: null, kit: null, ents: [], abbr: 'GAS',
      lineDepth: BLOCK_DEPTH_DEF_LOW, baseLineDepth: 20, offsideRef: PITCH_L / 2
    }
  };
  let kits = resolveKits(null, null);

  /** Persistente Gesamtliste beider Mannschaften — allEnts() allokierte 3×/Frame. */
  const entsAll = [];

  const ball = { x: PITCH_L / 2, y: PITCH_W / 2, z: 0, vx: 0, vy: 0, rot: 0 };
  /* Flugspur als Ringpuffer fester Größe: kein push/shift, keine Allokation. */
  const trail = [];
  for (let i = 0; i < TRAIL_MAX; i++) trail.push({ x: 0, y: 0, z: 0, alter: Infinity });
  let trailKopf = 0;
  const ballAbtast = { x: PITCH_L / 2, y: PITCH_W / 2, z: 0 };
  let possession = 'home';

  let active = null;      // { phase, path, t, dur, resolve, wallAnteil, akIdx, standAt }
  let banner = null;      // { text, t0, dur }  — t0/dur auf SPIELZEIT
  let confetti = [];
  let celebrateUntil = 0;
  let celebrateAt = { x: PITCH_L / 2, y: PITCH_W / 2 };
  let flashBoost = 0;
  let rollenUhr = 0;      // s Spielzeit bis zur nächsten Rollenvergabe
  let rollenBucket = 0;   // Streuungseimer für hash01 (kein rng im Frame)

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
    if (!t.matchTeam) { rebuildEntsAll(); return; }
    const eleven = pickEleven(t.matchTeam);
    if (!eleven.length) { rebuildEntsAll(); return; }
    const slots = buildFormationSlots(t.matchTeam.tactics && t.matchTeam.tactics.formation);
    const bySlot = assignToSlots(eleven, slots.slice(0, eleven.length));
    const attackDir = side === 'home' ? 1 : -1;
    const ownGoalX = side === 'home' ? 0 : PITCH_L;
    let abwSumme = 0, abwZahl = 0;

    for (let i = 0; i < bySlot.length; i++) {
      const p = bySlot[i];
      if (!p) continue;
      const slot = slots[i];
      const w = tacticToWorld(slot.x, slot.y, side);
      const group = POSITION_GROUP[slot.pos] || 'MIT';
      if (group === 'ABW') { abwSumme += (w.x - ownGoalX) * attackDir; abwZahl++; }
      t.ents.push({
        p,
        side,
        role: slot.pos,
        group,
        isKeeper: slot.pos === 'TW' || p.position === 'TW',
        baseX: w.x, baseY: w.y,
        baseTiefe: (w.x - ownGoalX) * attackDir,
        x: w.x, y: w.y,
        // Echter Geschwindigkeitszustand statt Positionsfilter (Punkt 8).
        vx: 0, vy: 0,
        // Kennwerte EINMAL aus den Attributen — nicht pro Frame. Hier wird
        // attributes.tempo endlich gelesen: 22 unterschiedlich schnelle Menschen.
        kin: laufwerte(p && p.attributes ? {
          tempo: p.attributes.tempo,
          antritt: p.attributes.antritt !== undefined ? p.attributes.antritt
            : Math.round(((p.attributes.tempo || 50) + (p.attributes.dribbling || 50)) / 2),
          koerper: p.attributes.koerper,
          fitness: p.fitness
        } : null),
        startX: w.x, startY: w.y,
        lookX: w.x + (side === 'home' ? 1 : -1), lookY: w.y,
        actorTarget: null,
        actorAction: null,
        actorSkript: false,   // true = Altpfad (lerp+easeInOut, kein Integrator)
        actorT0: 0, actorT1: 1,
        aktionStart: null,    // Phasenfortschritt, bei dem die Aktionspose ansetzte
        ballMoment: Infinity, // Phasenfortschritt, zu dem dieser Akteur den Ball spielt
        rolle: null,
        markX: 0, markY: 0,   // Zielpunkt der Rolle (Gegenspieler, Raum, …)
        dir: side === 'home' ? 1 : -1,
        yaw: side === 'home' ? 0 : Math.PI,
        frame: hash01(i, side === 'home' ? 1 : 2),
        pose: 'stand',
        speedNow: 0,
        idx: i,
        wobble: i * 1.31 + (side === 'home' ? 0 : 0.77)
      });
    }
    t.baseLineDepth = abwZahl ? abwSumme / abwZahl : 20;
    t.lineDepth = t.baseLineDepth;
    rebuildEntsAll();
  }

  /** Gesamtliste neu füllen — nur bei setTeams/setFormationPositions, nie im Frame. */
  function rebuildEntsAll() {
    entsAll.length = 0;
    for (const e of teams.home.ents) entsAll.push(e);
    for (const e of teams.away.ents) entsAll.push(e);
  }

  function findEnt(playerId) {
    if (!playerId) return null;
    for (const e of teams.home.ents) if (e.p && e.p.id === playerId) return e;
    for (const e of teams.away.ents) if (e.p && e.p.id === playerId) return e;
    return null;
  }

  /* --- Mannschaftsverhalten --------------------------------------------- */

  /**
   * EINE Kettentiefe und EIN Abseitsbezug je Mannschaft und Frame — nicht je
   * Spieler. Nur so steht die Abwehr auf einer Linie und schiebt geschlossen.
   */
  function updateTeamLines(dtSpiel) {
    for (const side of ['home', 'away']) {
      const t = teams[side];
      if (!t.ents.length) continue;
      const attackDir = side === 'home' ? 1 : -1;
      const ownGoalX = side === 'home' ? 0 : PITCH_L;
      const inPoss = possession === side;

      const ziel = kettenTiefe(clamp((ball.x - ownGoalX) * attackDir, 0, PITCH_L), inPoss);
      const rate = ziel > t.lineDepth ? LINE_PUSH_RATE : LINE_DROP_RATE;
      const d = clamp(ziel - t.lineDepth, -rate * dtSpiel, rate * dtSpiel);
      t.lineDepth += d;

      // Abseitsbezug: letzter Feldspieler der ANDEREN Mannschaft.
      const gegner = teams[side === 'home' ? 'away' : 'home'];
      let tiefste = ownGoalX + attackDir * 8;
      let gefunden = false;
      for (const g of gegner.ents) {
        if (g.isKeeper) continue;
        if (!gefunden || (g.x - tiefste) * attackDir > 0) { tiefste = g.x; gefunden = true; }
      }
      t.offsideRef = abseitsBezug(tiefste, attackDir);
    }
  }

  /**
   * Rollen alle ROLE_INTERVAL Sekunden Spielzeit neu vergeben. Streuung
   * ausschließlich über hash01(index, bucket) — KEIN rng.next() im Frame, sonst
   * hängt die Zahl der Züge an der Bildrate.
   */
  function updateRollen() {
    rollenBucket++;
    for (const side of ['home', 'away']) {
      const t = teams[side];
      if (!t.ents.length) continue;
      const inPoss = possession === side;
      const gegner = teams[side === 'home' ? 'away' : 'home'];

      // Nach Ballnähe sortieren, ohne zu allokieren: zwei Durchgänge reichen.
      let n1 = null, n2 = null, d1 = Infinity, d2 = Infinity;
      for (const e of t.ents) {
        if (e.isKeeper) { e.rolle = 'torwart'; continue; }
        const d = Math.hypot(e.x - ball.x, e.y - ball.y);
        if (d < d1) { d2 = d1; n2 = n1; d1 = d; n1 = e; }
        else if (d < d2) { d2 = d; n2 = e; }
      }
      for (const e of t.ents) {
        if (e.isKeeper) continue;
        if (inPoss) {
          if (e === n1) e.rolle = (d1 < 8 && ball.z < 2.2) ? 'carrier' : 'option';
          else if (e === n2) e.rolle = 'option';
          else if (e.group === 'ABW') e.rolle = 'absichern';
          else e.rolle = hash01(e.idx, rollenBucket) < 0.35 ? 'overlap' : 'option';
        } else {
          if (e === n1) e.rolle = 'presser';
          else if (e === n2 && d2 < 22) e.rolle = 'doppeln';
          else if (e.group === 'ABW') e.rolle = 'block';
          else e.rolle = 'mark';
        }
        // Manndeckung: nächster Gegner, aber nur alle 0,25 s neu bestimmt.
        if (e.rolle === 'mark') {
          let best = null, bd = 26;
          for (const g of gegner.ents) {
            if (g.isKeeper) continue;
            const d = Math.hypot(g.x - e.x, g.y - e.y);
            if (d < bd) { bd = d; best = g; }
          }
          if (best) { e.markX = best.x; e.markY = best.y; }
          else e.rolle = 'block';
        }
      }
    }
  }

  /* --- Spielerbewegung -------------------------------------------------- */

  const _tgt = { x: 0, y: 0 };

  /**
   * Zielposition eines Spielers: Kette (eine Linie je Team), Breitenskalierung
   * (ballferne Seite rückt ein), Kompaktheit, Abseitsbezug, Rolle.
   * Schreibt in `out` — keine Allokation im Frame.
   */
  function formationTarget(e, out) {
    const attackDir = e.side === 'home' ? 1 : -1;
    const ownGoalX = e.side === 'home' ? 0 : PITCH_L;
    const inPoss = possession === e.side;
    const t = teams[e.side];

    if (e.isKeeper) return torwartZiel(ball.x, ball.y, ownGoalX, out);

    // Tiefe: alle hängen an DERSELBEN Kettentiefe. Die Kette selbst hält ihren
    // Abstand strenger (ABW_LINE_BIND), die Reihen davor behalten ihre Staffelung.
    const stretch = inPoss ? BLOCK_STRETCH_ATT : BLOCK_STRETCH_DEF;
    const versatz = (e.baseTiefe - t.baseLineDepth) * stretch;
    const tiefe = t.lineDepth + (e.group === 'ABW' ? versatz * ABW_LINE_BIND : versatz);
    let tx = ownGoalX + attackDir * tiefe;

    // Breite: Skalierung um die Feldmitte plus Verschiebung zur Ballseite.
    const skala = breitenSkala(inPoss, e.baseY, ball.y);
    let ty = PITCH_W / 2 + (e.baseY - PITCH_W / 2) * skala + (ball.y - PITCH_W / 2) * TEAM_SHIFT_Y;

    // Sog zum Ball — an der TATSÄCHLICHEN Position gemessen, nicht an baseX/baseY.
    const dist = Math.hypot(ball.x - e.x, ball.y - e.y);
    const near = clamp(1 - dist / COMPACT_RADIUS, 0, 1);
    const pull = (inPoss ? COMPACT_ATT : COMPACT_DEF) * near;
    tx = lerp(tx, ball.x, pull);
    ty = lerp(ty, ball.y, pull);

    // Rolle
    const streu = hash01(e.idx + (e.side === 'home' ? 0 : 32), rollenBucket) - 0.5;
    switch (e.rolle) {
      case 'presser':
        tx = ball.x - attackDir * 0.9; ty = ball.y; break;
      case 'doppeln':
        tx = lerp(tx, ball.x - attackDir * 2.8, 0.75);
        ty = lerp(ty, ball.y + streu * 5, 0.75); break;
      case 'mark':
        tx = lerp(tx, e.markX - attackDir * 1.4, 0.7);
        ty = lerp(ty, e.markY, 0.7); break;
      case 'carrier':
        tx = ball.x; ty = ball.y; break;
      case 'option':
        tx = lerp(tx, ball.x + attackDir * (7 + streu * 6), 0.45);
        ty = lerp(ty, ball.y + streu * 18, 0.45); break;
      case 'overlap':
        tx = lerp(tx, ball.x + attackDir * 5, 0.5);
        ty = lerp(ty, PITCH_W / 2 + (e.baseY - PITCH_W / 2 > 0 ? 27 : -27), 0.55); break;
      case 'absichern':
        tx = lerp(tx, ball.x - attackDir * 14, 0.35); break;
      default: break;   // 'block': reine Grundordnung
    }

    // Abseitsbezug: die Spitzen der ballbesitzenden Seite kleben am letzten Mann.
    if (inPoss && e.group === 'STU' && (tx - t.offsideRef) * attackDir > 0) tx = t.offsideRef;

    out.x = clamp(tx, 1.2, PITCH_L - 1.2);
    out.y = clamp(ty, 1.2, PITCH_W - 1.2);
    return out;
  }

  /**
   * Ein Teilschritt der Spielerkinematik über core/ballistik.js.
   * `lenke()` und `sprintSchritt()` sind BEIDE vollständige Zeitschritte — es
   * darf pro Teilschritt genau einer laufen, sonst wird der Ort doppelt integriert.
   */
  function steer(e, tx, ty, dtStep) {
    const dx = tx - e.x, dy = ty - e.y;
    const d = Math.hypot(dx, dy);
    const k = e.kin;
    if (d < 1e-4) {
      sprintSchritt(e, 0, 0, k, dtStep);
    } else {
      // Ankunftsgeschwindigkeit aus dem Bremsweg: wer ankommt, steht auch.
      const vWish = Math.min(k.vmax, Math.sqrt(2 * k.aBrems * Math.max(0, d - BRAKE_MARGIN)));
      const v = Math.hypot(e.vx, e.vy);
      const zielRi = Math.atan2(dy, dx);
      let dw = zielRi - Math.atan2(e.vy, e.vx);
      while (dw > Math.PI) dw -= TAU;
      while (dw < -Math.PI) dw += TAU;
      const bogen = v > TURN_ARC_SPEED && Math.abs(dw) > TURN_ARC_MIN && Math.abs(dw) < TURN_ARC_MAX;
      if (bogen) lenke(e, zielRi, k, dtStep);            // Laufbogen statt Wende auf der Stelle
      else sprintSchritt(e, (dx / d) * vWish, (dy / d) * vWish, k, dtStep);
    }
    // Feldgrenzen: die betroffene Geschwindigkeitskomponente wird null.
    if (e.x < -1) { e.x = -1; if (e.vx < 0) e.vx = 0; }
    else if (e.x > PITCH_L + 1) { e.x = PITCH_L + 1; if (e.vx > 0) e.vx = 0; }
    if (e.y < -1) { e.y = -1; if (e.vy < 0) e.vy = 0; }
    else if (e.y > PITCH_W + 1) { e.y = PITCH_W + 1; if (e.vy > 0) e.vy = 0; }
  }

  function updatePlayers(dtSpiel, phaseT) {
    const schritte = clamp(Math.ceil(dtSpiel / PHYS_STEP), 1, PHYS_MAX_STEPS);
    const dtStep = dtSpiel / schritte;
    const jubelt = celebrateUntil > gameMs;

    for (const e of entsAll) {
      if (e.actorTarget && e.actorSkript) {
        /* ---- ALTPFAD (phase.v < 2): unverändert lerp + easeInOut ---------
         * Die alte Engine platziert Akteure bis zu 40 m entfernt; ein
         * begrenzter Integrator erzeugte hier einen sichtbaren Snap. */
        const k = easeInOut(clamp(phaseT, 0, 1));
        const nx = lerp(e.startX, e.actorTarget.x, k);
        const ny = lerp(e.startY, e.actorTarget.y, k);
        const vx = dtSpiel > 0 ? (nx - e.x) / dtSpiel : 0;
        const vy = dtSpiel > 0 ? (ny - e.y) / dtSpiel : 0;
        e.speedNow = Math.hypot(vx, vy);
        // Die gemerkte Geschwindigkeit wird auf vmax gedeckelt: nach der Phase
        // übernimmt der Integrator, und der würde ein skriptiertes 40-m/s-Tempo
        // erst über zwei Sekunden abbauen — der Spieler flöge vom Platz.
        const f = e.speedNow > e.kin.vmax ? e.kin.vmax / e.speedNow : 1;
        e.vx = vx * f; e.vy = vy * f;
        e.x = nx; e.y = ny;
      } else {
        let tx, ty;
        if (e.actorTarget) {
          /* ---- v2: geführter Zielpunkt durch DENSELBEN Integrator -------- */
          const span = Math.max(1e-3, e.actorT1 - e.actorT0);
          const lp = easeInOut(clamp((phaseT - e.actorT0) / span, 0, 1));
          tx = lerp(e.startX, e.actorTarget.x, lp);
          ty = lerp(e.startY, e.actorTarget.y, lp);
        } else {
          formationTarget(e, _tgt);
          // Leichtes Zappeln, damit niemand wie angewurzelt steht.
          tx = _tgt.x + Math.sin(nowMs / 1000 * WOBBLE_SPEED + e.wobble) * WOBBLE_AMP;
          ty = _tgt.y + Math.cos(nowMs / 1000 * WOBBLE_SPEED * 0.83 + e.wobble * 1.7) * WOBBLE_AMP;
        }
        for (let s = 0; s < schritte; s++) steer(e, tx, ty, dtStep);
        e.speedNow = Math.hypot(e.vx, e.vy);
      }

      /* --- Blick: im Sprint die Laufrichtung, sonst der Ball ---------------
       * Die Totzone von 0,35 m sitzt am BLICKZIEL und noch einmal am Wechsel
       * der Spiegelung. Damit ist auch das alte Flackern im Stand erledigt:
       * bisher schob das Zappeln (WOBBLE_AMP) e.x über die 0,05-Schwelle und
       * die Figuren klappten im Stehen mehrmals je Sekunde um. */
      const zielX = e.speedNow > LOOK_RUN_SPEED ? e.x + e.vx : ball.x;
      const zielY = e.speedNow > LOOK_RUN_SPEED ? e.y + e.vy : ball.y;
      if (Math.hypot(zielX - e.lookX, zielY - e.lookY) > LOOK_DEADZONE) {
        e.lookX = zielX; e.lookY = zielY;
      }
      if (Math.abs(e.lookX - e.x) > LOOK_DEADZONE) e.dir = e.lookX > e.x ? 1 : -1;
      e.yaw = Math.atan2(e.lookY - e.y, e.lookX - e.x);

      /* --- Pose ------------------------------------------------------------
       * Die Aktionspose läuft EINMAL ab (frame aus dem Phasenfortschritt) statt
       * zyklisch, und sie wird ausgelöst, wenn der Ball tatsächlich in Reichweite
       * ist — nicht ab einem festen Fortschritt. Sonst schießt jemand ins Leere,
       * während der Ball 30 m weiter liegt. */
      if (e.actorAction && e.aktionStart === null && phaseT >= e.actorT0
        && (phaseT >= e.ballMoment || Math.hypot(ball.x - e.x, ball.y - e.y) < ACTION_POSE_DIST)) {
        e.aktionStart = phaseT;
      }
      let pose = e.speedNow > RUN_POSE_SPEED ? 'lauf' : 'stand';
      if (e.aktionStart !== null && phaseT >= e.aktionStart && phaseT <= e.aktionStart + ACTION_POSE_LEN) {
        pose = ACTION_POSE[e.actorAction] || pose;
        e.frame = clamp((phaseT - e.aktionStart) / ACTION_POSE_LEN, 0, 1);
      } else {
        // Schrittlänge in Metern je Zyklus: schnelle Läufer machen weite Schritte.
        const stride = clamp(1.35 + 0.38 * e.speedNow, STRIDE_MIN, STRIDE_MAX);
        e.frame = (e.frame + (e.speedNow * dtSpiel) / stride) % 1;
      }
      if (jubelt && e.side === possession && !e.isKeeper) pose = 'jubel';
      e.pose = pose;
      e.gait = clamp(e.speedNow / 6.5, 0.45, 1.25);
    }
  }

  /* --- Phasen ----------------------------------------------------------- */

  function applyPhaseEnd() {
    if (!active) return;
    if (active.path) {
      samplePath(active.path, 1, ballAbtast);
      ball.x = ballAbtast.x; ball.y = ballAbtast.y; ball.z = 0;
      ball.vx = 0; ball.vy = 0;
      trailLeeren();
      pfadFreigeben(active.path);
      active.path = null;
    }
    for (const e of entsAll) {
      // Altpfad: harter Endzustand (die alte Engine erwartet ihn).
      // v2: der Integrator ist bereits dort — kein Teleport, das wäre sichtbar.
      if (e.actorTarget && e.actorSkript) { e.x = e.actorTarget.x; e.y = e.actorTarget.y; }
      e.actorTarget = null;
      e.actorAction = null;
      e.actorSkript = false;
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

    /* DIE eine Verzweigung (CONTRACTS §6.2). */
    const nutzeSegmente = !!(phase && phase.v >= 2 && Array.isArray(phase.segments) && phase.segments.length);

    for (const e of entsAll) {
      e.startX = e.x; e.startY = e.y;
      e.actorTarget = null;
      e.actorAction = null;
      e.actorSkript = false;
      e.actorT0 = 0; e.actorT1 = 1;
      e.aktionStart = null;
      e.ballMoment = Infinity;
    }
    /* Wann berührt wer den Ball? Ein Segment beginnt (t0) damit, dass `by` den
     * Ball spielt. Der Ballspieler muss also zu SEINEM t0 am Ball sein — nicht
     * erst am Ende seines Akteursfensters, das laut Vertrag die ganze Phase
     * umspannen darf. Sonst schießt er, wenn der Ball längst weg ist. */
    const ballMoment = new Map();
    if (nutzeSegmente) {
      for (const s of phase.segments) {
        if (!s || !s.by || !s.from || !s.to) continue;
        const t = clamp(isFinite(s.t0) ? s.t0 : 0, 0, 1);
        if (!ballMoment.has(s.by) || t < ballMoment.get(s.by)) ballMoment.set(s.by, t);
      }
    }

    const actors = phase && Array.isArray(phase.actors) ? phase.actors : [];
    for (const a of actors) {
      if (!a) continue;
      const e = findEnt(a.playerId);       // unbekannte Spieler werden still ignoriert
      if (!e) continue;
      if (!isFinite(a.x) || !isFinite(a.y)) continue;
      e.actorTarget = { x: clamp(a.x, 0.5, PITCH_L - 0.5), y: clamp(a.y, 0.5, PITCH_W - 0.5) };
      e.actorAction = a.action || null;
      e.actorSkript = !nutzeSegmente;
      if (nutzeSegmente) {
        e.actorT0 = clamp(isFinite(a.t0) ? a.t0 : 0, 0, 1);
        e.actorT1 = Math.max(e.actorT0 + 1e-3, clamp(isFinite(a.t1) ? a.t1 : 1, 0, 1));
        if (ballMoment.has(a.playerId)) {
          e.ballMoment = ballMoment.get(a.playerId);
          e.actorT1 = Math.max(1e-3, e.ballMoment);
          e.actorT0 = clamp(Math.min(e.actorT0, e.actorT1 - 0.25), 0, e.actorT1 - 1e-3);
        }
        if (a.from && isFinite(a.from.x) && isFinite(a.from.y)) {
          e.startX = clamp(a.from.x, 0.5, PITCH_L - 0.5);
          e.startY = clamp(a.from.y, 0.5, PITCH_W - 0.5);
        }
      }
    }
    return buildBallPath(phase, nutzeSegmente, ball.x, ball.y);
  }

  /* --- Kamera & Effekte -------------------------------------------------- */

  /**
   * Hysterese: heiß wird es bei FINAL_THIRD_IN, kalt erst bei FINAL_THIRD_OUT.
   * Eine einzelne Schwelle lässt den Zoom im Sekundentakt pumpen.
   */
  function updateCamHot() {
    const zumTor = Math.min(ball.x, PITCH_L - ball.x);
    const standard = !!(active && active.phase && active.phase.kind === 'standard');
    if (standard) cam.hot = true;
    else if (zumTor <= FINAL_THIRD_IN) cam.hot = true;
    else if (zumTor >= FINAL_THIRD_OUT) cam.hot = false;
    if (cam.hot && (active || standard)) {
      cam.holdUntil = nowMs + CAM_HOLD_MS / clamp(effSpeed, 0.25, 16);
    }
    return cam.hot && (active || cam.holdUntil > nowMs);
  }

  function updateCamera(dt) {
    const jubel = celebrateUntil > gameMs;
    camArg.cinematic = !!o.cinematic;
    camArg.tempo = effSpeed;
    camArg.aktiv = !!active;
    camArg.kind = active && active.phase ? active.phase.kind : null;
    camArg.hot = updateCamHot();
    camArg.jubel = jubel;
    camArg.jubelX = celebrateAt.x; camArg.jubelY = celebrateAt.y;
    camArg.standX = active && active.standAt ? active.standAt.x : NaN;
    camArg.standY = active && active.standAt ? active.standAt.y : NaN;
    camArg.ballX = ball.x; camArg.ballY = ball.y;
    camArg.ballVx = ball.vx; camArg.ballVy = ball.vy;
    if (jubel) cam.holdUntil = nowMs + CAM_HOLD_MS / clamp(effSpeed, 0.25, 16);

    kameraZiel(camArg, camZiel);

    // Anschläge am ZIEL (mit Overscan), nicht an cam.* — sonst kann ein Tor nie
    // zentriert werden und der Glätter arbeitet gegen den Anschlag.
    const sZiel = baseScale * camZiel.zoom;
    kameraKlemme(camZiel.x, camZiel.y, viewW / (2 * sZiel), viewH / (2 * sZiel), camKlemm);

    // Glättung auf SPIELZEIT: bei Tempo 4 muss die Kamera 4× schneller ziehen.
    const camDt = dt * clamp(effSpeed, 1, 4);
    const k = 1 - Math.exp(-camZiel.smooth * camDt);
    cam.x += (camKlemm.x - cam.x) * k;
    cam.y += (camKlemm.y - cam.y) * k;
    // Zoom logarithmisch: 1 → 2 dauert so lang wie 2 → 4.
    if (cam.zoom > 1e-6 && camZiel.zoom > 1e-6) {
      cam.zoom *= Math.exp(Math.log(camZiel.zoom / cam.zoom) * k);
    }
  }

  function updateEffects(dt, dtSpiel) {
    // Blitzlichtgewitter hängt am Jubel, also an der Spielzeit.
    if (flashBoost > 0) flashBoost = Math.max(0, flashBoost - dtSpiel * 0.55);
    if (!confetti.length) return;
    // Konfetti bleibt in REALZEIT (es ist Bildschirmschmuck, kein Spielgeschehen),
    // nur seine Lebensdauer wird bei hohem Tempo gekürzt.
    const teiler = clamp(effSpeed, 1, 3);
    const alive = [];
    for (const c of confetti) {
      c.life -= dt * teiler;
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

  /* --- Flugspur (Ringpuffer, zeitbasiert) -------------------------------- */

  function trailLeeren() {
    for (const t of trail) t.alter = Infinity;
  }

  function trailAltern(dtSpiel) {
    for (const t of trail) if (t.alter < Infinity) t.alter += dtSpiel;
  }

  function trailSetzen(x, y, z) {
    const t = trail[trailKopf];
    t.x = x; t.y = y; t.z = z; t.alter = 0;
    trailKopf = (trailKopf + 1) % TRAIL_MAX;
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
    // Ab Tempo 6 kostet das Flimmern nur noch Rechenzeit — man sieht es nicht.
    if (effSpeed >= DETAIL_OFF_SPEED) return;

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
    if (!o.noise || effSpeed >= DETAIL_OFF_SPEED) return;
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

  /** Wer führt den Ball? Nur solange der Ball wirklich am Fuß ist (< 0,8 m). */
  function findCarrier() {
    if (ball.z >= CARRIER_MAX_Z) return null;
    let best = null, bestD = CARRIER_RADIUS;
    for (const e of entsAll) {
      const d = Math.hypot(e.x - ball.x, e.y - ball.y);
      const bonus = e.actorAction ? 0.5 : (e.side === possession ? 0.25 : 0);
      if (d - bonus < bestD) { bestD = d - bonus; best = e; }
    }
    return best;
  }

  /**
   * Abseitslinie der verteidigenden Seite — eine dünne gestrichelte Linie am
   * letzten Mann. Nur während einer laufenden Phase und nur im cineastischen
   * Modus, sonst stört sie das Standbild.
   */
  function drawOffsideLine() {
    if (!o.cinematic || !active) return;
    if (!teams[possession === 'home' ? 'away' : 'home'].ents.length) return;
    const x = teams[possession].offsideRef;
    if (!isFinite(x) || x < 8 || x > PITCH_L - 8) return;
    const sx = w2sX(x);
    if (sx < -20 || sx > cssW + 20) return;
    ctx.save();
    ctx.setLineDash([6, 7]);
    ctx.strokeStyle = 'rgba(255,235,120,0.45)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(sx, w2sY(0));
    ctx.lineTo(sx, w2sY(PITCH_W));
    ctx.stroke();
    ctx.restore();
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
    const list = entsAll;                    // persistent, keine Allokation
    if (!list.length) return;
    list.sort((a, b) => a.y - b.y);          // Maler-Reihenfolge, in place

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
            frame: e.frame,
            gait: e.gait,   // Schrittamplitude aus dem echten Tempo
            yaw: e.yaw      // Blickrichtung → Stauchung quer zur Kamera
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
    const z = ball.z;
    const gx = w2sX(ball.x), gy = w2sY(ball.y);
    // HÖHENKONVENTION (Dateikopf): der Schatten trägt die Höhe, der Ball wächst nur leicht.
    const sx = gx, sy = gy - ballLift(z) * ppm;
    const r = Math.max(2.8, ppm * BALL_RADIUS_M * (1 + z * 0.028));
    const shR = ppm * BALL_RADIUS_M;          // Schattenradius OHNE z

    // Flugspur (zeitbasiert; ab Tempo 6 aus)
    if (effSpeed < DETAIL_OFF_SPEED) {
      for (const t of trail) {
        if (t.alter >= TRAIL_SECONDS) continue;
        const a = (1 - t.alter / TRAIL_SECONDS) * 0.34;
        if (a <= 0.01) continue;
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(w2sX(t.x), w2sY(t.y) - ballLift(t.z) * ppm, r * 0.5 * (0.4 + a), 0, TAU);
        ctx.fill();
      }
    }

    // Schatten am Boden: Position (x, y, 0), Versatz und Form aus der Höhe.
    const shX = gx + z * ppm * BALL_SHADOW_DX;
    const shY = gy + z * ppm * BALL_SHADOW_DY;
    ctx.fillStyle = `rgba(0,0,0,${(0.38 / (1 + z * 0.30)).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(shX, shY, shR * (0.95 + z * 0.10), shR * (0.50 + z * 0.055), 0, 0, TAU);
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
    // Banner läuft auf SPIELZEIT: bei Tempo 4 verschwindet es 4× schneller,
    // ohne dass es dafür eine eigene Deckelung (BANNER_MAX_SPEEDUP) braucht.
    const p = (gameMs - banner.t0) / banner.dur;
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
    drawOffsideLine();
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

    /* ---------------------------------------------------------------------
     * EINE Zeitbasis für Ball, Spieler und Kamera.
     *
     * `dt` ist auf 0,12 s gedeckelt: bei niedriger Bildrate (Hintergrundtab,
     * Timer-Ersatz, schwaches Gerät) sollen weder Integrator noch Kamera in
     * einem Frame springen. Die Deckelung verlangsamt aber den Phasenfortschritt
     * — deshalb steht dahinter die WANDUHR-NOTBREMSE (Punkt 1): Nach der
     * doppelten erwarteten Dauer plus 2 s wird die Phase in jedem Fall
     * abgeschlossen. `screens/spieltag.js:1591` wartet ohne Timeout-Race auf das
     * Promise; ohne diese Notbremse hinge dort das ganze Spiel.
     * Das Budget wird TEMPO-NORMIERT geführt (notbremseAnteil): ein Tempowechsel
     * mitten in der Phase darf sie nicht abreißen, siehe dort.
     * ------------------------------------------------------------------- */
    const rohElapsed = (ts - lastTs) / 1000;   // ungedeckelt: nur für die Notbremse
    const elapsed = clamp(rohElapsed, 0, 5);
    const dt = Math.min(elapsed, 0.12);
    lastTs = ts;
    nowMs = ts;

    // Tempo 8 ohne Blackout: statt die Phase zu überspringen, wird sie gerafft —
    // aber nie kürzer als PHASE_MIN_SECONDS, damit man den Ball noch sieht.
    effSpeed = active ? Math.min(speed, active.dur / PHASE_MIN_SECONDS) : speed;
    const dtSpiel = dt * effSpeed;
    gameMs += dtSpiel * 1000;

    // Rollenvergabe auf Spielzeit, nicht je Frame (22 Distanzen alle 0,25 s).
    rollenUhr -= dtSpiel;
    if (rollenUhr <= 0) { rollenUhr = ROLE_INTERVAL; updateRollen(); }

    /* --- Phasenfortschritt + Ball ---------------------------------------- */
    let phaseT = 1;
    trailAltern(dtSpiel);
    if (active) {
      // Die Wanduhr läuft erst ab dem ERSTEN Frame nach playPhase() — der Frame
      // davor gehört noch der vorigen Phase (oder der Pause).
      if (active.wallAnteil === null) active.wallAnteil = 0;
      else active.wallAnteil = notbremseAnteil(active.wallAnteil, rohElapsed, active.dur, speed);
      active.t += dtSpiel / active.dur;
      if (phaseNotbremse(active.wallAnteil)) active.t = 1;
      phaseT = clamp(active.t, 0, 1);
      if (active.path) {
        samplePath(active.path, phaseT, ballAbtast);
        const dx = ballAbtast.x - ball.x, dy = ballAbtast.y - ball.y;
        const moved = Math.hypot(dx, dy);
        // Rotation je METER: am Boden rollt der Ball (1/r), in der Luft dreht er träger.
        ball.rot += moved * (ball.z > BALL_AIR_Z ? BALL_AIR_SPIN : BALL_ROLL_SPIN);
        if (dtSpiel > 1e-5) {
          const a = clamp(dtSpiel * 12, 0, 1);
          ball.vx += (dx / dtSpiel - ball.vx) * a;
          ball.vy += (dy / dtSpiel - ball.vy) * a;
        }
        const v = Math.hypot(ball.vx, ball.vy);
        if (v >= TRAIL_MIN_SPEED) trailSetzen(ball.x, ball.y, ball.z);
        ball.x = ballAbtast.x; ball.y = ballAbtast.y; ball.z = ballAbtast.z;
        akustikPruefen(phaseT);
      }
    } else {
      // Ein liegender Ball hat keine Spur.
      ball.vx *= Math.max(0, 1 - dt * 6);
      ball.vy *= Math.max(0, 1 - dt * 6);
    }

    updateTeamLines(dtSpiel);
    updatePlayers(dtSpiel, phaseT);
    updateCamera(dt);
    updateEffects(dt, dtSpiel);
    draw();

    if (active && active.t >= 1) finishPhase();
  }

  /**
   * Ton an den Ballweg hängen (Punkt 14). Die Klangbank gehört P10 — hier wird
   * ausschließlich defensiv aufgerufen, damit beide Pakete unabhängig ausrollen.
   */
  function akustikPruefen(phaseT) {
    if (!bank || !active || !active.path) return;
    const liste = active.path.akustik;
    while (active.akIdx < liste.length && liste[active.akIdx].t <= phaseT) {
      const a = liste[active.akIdx++];
      if (a.art === 'aufsetzer' && typeof bank.aufsetzer === 'function') {
        try { bank.aufsetzer(a.wucht); } catch (err) { /* Ton ist nie kritisch */ }
      }
    }
    if (phaseT >= 1 && !active.akEnde) {
      active.akEnde = true;
      const letztes = active.path.segs[active.path.segs.length - 1];
      const art = letztes && letztes.outcome;
      try {
        if (art === 'tor' && typeof bank.netz === 'function') bank.netz(0.8);
        else if ((art === 'latte' || art === 'pfosten') && typeof bank.pfosten === 'function') bank.pfosten();
        else if (art === 'geblockt' && typeof bank.mauer === 'function') bank.mauer();
      } catch (err) { /* Ton ist nie kritisch */ }
    }
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
      ball.x = PITCH_L / 2; ball.y = PITCH_W / 2; ball.z = 0;
      ball.vx = 0; ball.vy = 0;
      trailLeeren();
      return view;
    },

    /**
     * Animiert eine Phase (Ballweg + Spielerbewegung).
     * @returns {Promise<void>} – löst am Ende der Phase auf, nie hängend
     *   (Wanduhr-Notbremse in tick(), siehe phaseNotbremse()).
     */
    playPhase(phase) {
      if (destroyed || !phase) return Promise.resolve();
      finishPhase();                       // eine noch laufende Phase sofort abschließen
      const path = prepPhase(phase);
      const dur = Math.max(0.2, isFinite(phase.duration) ? phase.duration : 3);
      // Ausführungsort eines Standards: die Kamera steht darauf, nicht auf dem Ball.
      const standAt = (phase.kind === 'standard' && phase.possessionStart
        && isFinite(phase.possessionStart.x) && isFinite(phase.possessionStart.y))
        ? { x: phase.possessionStart.x, y: phase.possessionStart.y }
        : (path && path.segs.length ? { x: path.segs[0].von.x, y: path.segs[0].von.y } : null);

      return new Promise((resolve) => {
        // wallAnteil bleibt null, bis der erste Frame läuft: die Framezeit dieses
        // Frames ist noch beim Aufrufer aufgelaufen und darf der Phase nicht
        // angelastet werden — sonst risse die Notbremse die erste Phase sofort ab.
        active = { phase, path, t: 0, dur, resolve, wallAnteil: null, akIdx: 0, akEnde: false, standAt };
      });
    },

    /** Ein Standbild zeichnen (z. B. vor dem Anpfiff). */
    renderStatic() {
      if (destroyed) return view;
      draw();
      return view;
    },

    /**
     * Geschwindigkeit: 0.5 | 1 | 2 | 4 | 8. Auch bei 8 läuft die Phase weiter,
     * nur gerafft — sie wird nie kürzer als PHASE_MIN_SECONDS und nie
     * übersprungen (früher riss `setSpeed(8)` laufende Phasen ab).
     */
    setSpeed(mult) {
      const m = Number(mult);
      speed = clamp(isFinite(m) && m > 0 ? m : 1, 0.25, 16);
      return view;
    },

    /**
     * Großes Banner einblenden. Enthält der Text „TOR", gibt es Jubel dazu —
     * dann zählt der optionale Ort `at` (Paket 2 ruft showBanner so auf).
     */
    showBanner(text, ms = BANNER_DEFAULT_MS, at) {
      if (destroyed) return view;
      const dur = Math.max(250, isFinite(ms) ? ms : BANNER_DEFAULT_MS);
      banner = { text: String(text == null ? '' : text), t0: gameMs, dur };
      if (isGoalBanner(text)) view.celebrate(at);
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

    /**
     * Torjubel: Konfetti, Blitzlichtgewitter und (bei cinematic) Kamerazoom.
     * `at` ist der TATSÄCHLICHE Torort; ohne ihn zoomt die Kamera auf den Ball
     * der gerade gezeigten Phase. Läuft auf Spielzeit (CELEBRATE_MS).
     */
    celebrate(at) {
      if (destroyed) return view;
      celebrateUntil = gameMs + CELEBRATE_MS;
      celebrateAt = {
        x: clamp(at && isFinite(at.x) ? at.x : ball.x, 12, PITCH_L - 12),
        y: clamp(at && isFinite(at.y) ? at.y : ball.y, 10, PITCH_W - 10)
      };
      flashBoost = 1;
      spawnConfetti();
      return view;
    },

    /** Klangbank (P10) nachträglich anschließen. Rein additiv, immer optional. */
    setSoundBank(neu) {
      if (!destroyed && neu && typeof neu === 'object') bank = neu;
      return view;
    },

    /**
     * Momentaufnahme des inneren Zustands — ausschließlich für tools/test-buehne.js.
     * Legt ein neues Objekt an und darf deshalb NIE pro Frame gerufen werden.
     */
    zustand() {
      return {
        ball: { x: ball.x, y: ball.y, z: ball.z, vx: ball.vx, vy: ball.vy },
        cam: { x: cam.x, y: cam.y, zoom: cam.zoom, hot: cam.hot },
        aktiv: !!active,
        phaseT: active ? clamp(active.t, 0, 1) : 1,
        effSpeed,
        gameMs,
        linien: { home: teams.home.lineDepth, away: teams.away.lineDepth },
        abseits: { home: teams.home.offsideRef, away: teams.away.offsideRef },
        ents: entsAll.map((e) => ({
          id: e.p && e.p.id, side: e.side, group: e.group, rolle: e.rolle,
          x: e.x, y: e.y, vx: e.vx, vy: e.vy, speedNow: e.speedNow,
          vmax: e.kin.vmax, apeak: e.kin.apeak, pose: e.pose, dir: e.dir
        }))
      };
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
      if (active && active.path) { pfadFreigeben(active.path); active.path = null; }
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
