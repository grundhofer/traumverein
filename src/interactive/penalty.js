/**
 * ELFMETER – interaktives Minispiel.
 *
 * Vertrag: docs/CONTRACTS.md §9 (interactive/*.js) und §6.1 (KeyMoment / resolution).
 *
 * Ablauf (Anstoß-Stil, drei Eingaben):
 *   1. ZIELEN      – Zielkreuz folgt der Maus (Pfeiltasten gehen auch) und zittert,
 *                    je nach Nervenstärke des Schützen. Klick/Leertaste rastet das Ziel ein.
 *   2. KRAFT       – Balken läuft hoch und runter, solange gedrückt gehalten wird.
 *                    Loslassen bestimmt die Härte, aber nur bis zur markierten
 *                    Optimalzone: darüber wird der Ball nicht mehr schneller,
 *                    der Klickfehler wiegt schwerer und der Torwart liest den
 *                    Schuss besser. Zu viel Kraft ist also verschenkt.
 *   3. PRÄZISION   – Ein Läufer saust über einen Balken, das grüne Fenster ist der
 *                    Sweet Spot. Fenstergröße und Tempo hängen von Schuss/Technik/
 *                    Nervenstärke des Schützen und von difficulty.minigame ab.
 *   4. AUFLÖSUNG   – Anlauf, Schuss, Torwarthechte, Netzzappeln bzw. Lattenklirren.
 *
 * Kamera: perspektivische Sicht HINTER dem Schützen (kein Draufblick). Die gesamte
 * Szene wird über eine schlichte Lochkamera projiziert – Weltkoordinaten in Metern:
 *   u = seitlich (0 = Tormitte, + = rechts aus Schützensicht)
 *   v = Entfernung zur Torlinie (0 = Torlinie, 11 = Elfmeterpunkt)
 *   h = Höhe über dem Rasen
 * Dadurch stimmen Torgröße, Ballgröße und Torwartreichweite automatisch zusammen.
 * Die Projektionsmathematik ist unverändert; nur die KAMERAWAHL wurde von
 * Weitwinkel auf Fernsehoptik gestellt (CAM_BACK 13 → 18 m, CAM_FOCAL 1750 →
 * 2400, dazu HORIZON_Y und die Zielspannen).
 *
 * Physik: Ballbahn, Bodenkontakt und Torwartreichweite kommen aus
 * core/ballistik.js. Es gibt keine feste Flugzeit mehr — wie lange der Ball
 * unterwegs ist, entscheidet der Kraftbalken (0,35–0,50 s), und der Torwart
 * springt zu einem ABSOLUTEN Zeitpunkt ab (nicht bei einem Anteil des Flugs).
 * Daraus folgt: harte Schüsse sind schwer zu halten, weil dem Torwart die Zeit
 * fehlt — und nicht, weil eine Konstante das behauptet.
 *
 * Reine Zeichen-/Eingabeschicht: kein Math.random (immer host.rng), kein Date.now
 * (performance.now nur für die Animation, das ist laut Projektregeln erlaubt).
 *
 * Zusätzlich zum Vertragsobjekt `minigame` exportiert die Datei den additiven,
 * DOM-freien Prüfexport `modell` (Vertrag §9). Gemessen wird er von
 * tools/test-elfmeter.js; die Balancekorridore stehen dort im Dateikopf.
 */

import { clamp, lerp } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { DEFAULT_COLORS, TRAITS } from '../core/constants.js';
import { getClub } from '../data/clubs.js';
import {
  BALL_R, createFlug, loeseAbschuss, abschussVektor,
  twParameter, twReichweite, TW_T_ABSTOSS
} from '../core/ballistik.js';

/* ══════════════════════════════════════════════════════════════════════════
   BALANCING – alles Wichtige steht hier oben.
   ══════════════════════════════════════════════════════════════════════════ */

/** Canvas-Fallback, falls host.canvas keine Maße meldet. */
const CANVAS_W = 960, CANVAS_H = 600;

/* --- Geometrie (Meter) --- */
const GOAL_HALF_W = 3.66;      // halbe Torbreite (Innenkante Pfosten)
const GOAL_H = 2.44;           // Lattenhöhe (Unterkante)
const POST_R = 0.06;           // Pfostenradius (Trefferzone für „Pfosten"/„Latte")
const SPOT_V = 11.0;           // Elfmeterpunkt
const AIM_U_MAX = 4.60;        // so weit darf man daneben zielen
const AIM_H_MIN = -0.10, AIM_H_MAX = 3.05;

/* --- Kamera ---
 * Fernsehoptik statt Weitwinkel: die Kamera steht weiter hinten und hat eine
 * längere Brennweite. Die Projektion selbst (Lochkamera) bleibt unverändert —
 * sie war schon richtig; verändert wird nur die Kamerawahl. Weil das Tor damit
 * größer ins Bild wächst, wandern HORIZON_Y und die Zielspannen mit. */
const CAM_BACK = 18.0;         // Kamera steht so viele Meter hinter dem Ball
const CAM_H = 1.95;            // Kamerahöhe
const CAM_FOCAL = 2400;        // Brennweite in Pixeln
const HORIZON_Y = 232;         // Bildschirm-Y der Blickachse (= Horizont bei h = CAM_H)

/* --- Zeiten (ms) --- */
const INTRO_MS = 850;
const AIM_LIMIT_MS = 7000;     // danach schießt der Schütze von allein
const POWER_PERIOD_MS = 1150;  // volle Auf-und-ab-Periode des Kraftbalkens
const POWER_LIMIT_MS = 2600;   // wer ewig hält, verliert die Kontrolle
const PREC_PERIOD_MS = 980;
const PREC_LIMIT_MS = 2600;
const RUNUP_MS = 430;          // Anlauf vor dem Schuss
const FLIGHT_MS = 780;         // Rückfallwert, falls der Integrator keine Bahn liefert
const AFTER_MS = 620;          // Nachspiel (Netz zappelt, Torwart liegt)
const RESULT_MS = 1500;        // Ergebnisbanner
const HARD_TIMEOUT_MS = 20000; // Vertrag §9: niemals hängen bleiben

/* --- Ballflug (Physik) ---
 * Die Flugzeit kommt aus dem Integrator (core/ballistik.js), nicht mehr aus
 * einer Konstanten. Bei 11 m ergibt das je nach Kraft 0,35–0,60 s. */
const SHOT_V_MIN = 22.0;       // m/s bei Kraftbalken 0
const SHOT_V_MAX = 32.0;       // m/s bei Kraftbalken 1
const SHOT_V_SKILL_LO = 0.92;  // Schussattribut 0 …
const SHOT_V_SKILL_HI = 1.06;  // … bis 100
const SLOWMO = 1.20;           // Anzeige läuft etwas gedehnter als die Physik
const FLUG_T_MAX = 1.6;        // s, so lange wird die Bahn integriert
const SPIN_UPS_MIN = 2.5, SPIN_UPS_MAX = 6.5;   // Umdrehungen je Sekunde

/* --- Netz --- */
const NET_DEPTH_PER_V = 0.045; // Eindringtiefe je m/s Auftreffgeschwindigkeit
const NET_DEPTH_MIN = 0.35, NET_DEPTH_MAX = 1.55;
const NET_TAU = 0.09;          // s, Zeitkonstante des Abbremsens im Netz
const NET_FADE_S = 0.12;       // s, in denen die Beule voll sichtbar wird

/* --- Kraftbalken --- */
const POWER_IDEAL = 0.78;      // beste Härte
const POWER_TOL = 0.42;        // ab dieser Abweichung ist das Kraft-Timing wertlos
/* Neutarierung zur kürzeren Flugzeit: harte Schüsse sind durch die Physik von
 * selbst stark geworden. Damit der Präzisionsbalken die Könnens-Achse bleibt,
 * setzt der Kraftbalken ab OVERPOWER_FROM dagegen — und der Torwart verliert
 * durch pure Wucht kaum noch etwas (0,45 → 0,15).
 *
 * Drei Lehren aus dem Gitterlauf des Prüfstands (Schützen- × Ziel- × Torwart-
 * profile, tools/test-elfmeter.js), die hier festgeschrieben sind:
 *   a) Ein Malus, der nur den Klickfehler verstärkt, ist keiner. Wer den
 *      Präzisionsläufer sauber trifft — bei einem guten Schützen der Regelfall
 *      —, bliebe straffrei, und Vollkraft wäre die dominante Strategie.
 *   b) Ein systematisch HÖHERER Ball ist kein Malus. Gegen einen tief
 *      hechtenden Torwart ist er ein Vorteil; der frühere Höhenschub von
 *      +0,90 m hat Vollkraft in der Mitte sogar belohnt. Er ist ersatzlos weg.
 *   c) Auch reine Streuung ist kein Malus, sondern stellenweise ein Bonus. Wo
 *      der Torwart genau auf dem Zielpunkt steht (flacher Ball in die Mitte,
 *      Weltklasse-Reflexe), ist JEDE Abweichung eine Verbesserung — Streuung
 *      rettet dort den schlechten Zielpunkt, statt ihn zu bestrafen. Mit
 *      OVERPOWER_ERR = 3,4 hat genau diese Zone zwei Gitterzellen gekippt:
 *      gegen einen Weltklasse-Torwart war Vollkraft bei flachem Ball in die
 *      Mitte um 1,4 bzw. 0,2 Punkte BESSER. Der Klickfehler-Multiplikator steht
 *      deshalb nur noch bei 1,2, das Gewicht ist auf OVERPOWER_LESEN gewandert
 *      (0,35 → 0,50) — das hängt sehr viel weniger am Zielpunkt. „Kann daher
 *      nirgends zum Bonus werden" stand hier früher und ist zu stark: bei
 *      identischer Ballbahn (precMiss = 0) senkt das bessere Lesen die
 *      Haltewahrscheinlichkeit in bis zu 6,6 % der Schüsse, weil der Torwart
 *      mit `high` auch die Sprunghöhe korrigiert und sich auf der falschen
 *      Seite dadurch weiter vom Ball wegstreckt. In der Summe bleibt es ein
 *      klarer Malus (in der Zelle „Mitte flach / TW Weltklasse" Σ steigend 78,0
 *      gegen Σ fallend 17,8), aber eben nicht ausnahmslos.
 *
 * WORÜBER GEMESSEN WURDE (tools/test-elfmeter.js, Prüfungen 6a–6i): ein Gitter
 * aus 135 Zellen (3 Schützen × 3 Torhüter × 15 Zielzonen), 500 Schuss je Zelle
 * UND Kraftstufe, GEPAART — beide Kraftstufen sehen denselben Seed, also
 * denselben Zielwurf, dasselbe Zittern, denselben Klickfehler. Bewertet wird je
 * Zelle gegen den eigenen McNemar-Standardfehler (√(nurIdeal + nurVoll) / n,
 * Rauschband 2 σ, Prüfung 6a); dazu ein Teilgitter aus 45 Zellen à 400 Schuss
 * mit precMiss = 0 (6g/6h) und eine Nachmessung der engsten Zelle über
 * 3 Saatfamilien à 6000 Schuss je Kraftstufe (6f).
 *
 * Zwei Zusagen, die hier früher zu absolut standen, auf die Messung gezogen:
 *   • Der Gitterabstand beträgt NICHT 10,4 Punkte, sondern 8,6–8,8 (vier
 *     Saatfamilien: 8,60 / 8,64 / 8,69 / 8,82 Punkte; bei 3000 statt 500 Schuss
 *     je Zelle 8,68). Prüfung 6i meldet das bei jedem Lauf als offenes Ziel
 *     (zuletzt 8,756 Punkte). Woher die 10,4 stammten, ist nicht dokumentiert,
 *     und der Schnitt hängt vollständig am Zonenraster. Dass Vollkraft deutlich
 *     kostet, trägt davon unabhängig und wird unter 6e hart geprüft.
 *   • „Hält in allen 135 Zellen" ist keine Absolutaussage. Die engste Zelle ist
 *     „Mitte flach / Torwart Weltklasse" (schwacher Schütze) mit rund 0,5
 *     Punkten Marge: 3 Saatfamilien à 6000 Schuss ergeben Δ = -0,57 Punkte,
 *     eine Referenzmessung außerhalb der Suite über 12 Saatfamilien à 20 000
 *     Schuss Δ = -0,48 Punkte (Einzelwerte -1,00 bis -0,19). Das Vorzeichen
 *     hält, aber eine kleine Balanceänderung kann diese Zelle kippen — der
 *     Gitterlauf druckt Name und Größe des größten Δ deshalb bei jedem Lauf mit.
 * Das Übermaß kostet also dreifach, und ganz überwiegend zielpunktunabhängig:
 * es bringt kein Tempo mehr (siehe wirkKraft), es telegrafiert den Schuss
 * (OVERPOWER_LESEN), und es verstärkt einen schon vorhandenen Klickfehler —
 * maßvoll (OVERPOWER_ERR). */
const OVERPOWER_FROM = 0.80;   // ab hier kostet das Übermaß
const OVERPOWER_ERR = 1.2;     // Multiplikator auf den Klickfehler bei Übermaß
const OVERPOWER_LESEN = 0.50;  // so viel besser liest der Torwart einen Vollkraftschuss
const POWER_SAVE_RELIEF = 0.15; // harte Schüsse sind etwas schwerer festzuhalten

/* --- Präzisionsbalken --- */
const PREC_WIN_MIN = 0.055;    // halbe Fensterbreite (0..0.5) bei miesem Schützen
const PREC_WIN_MAX = 0.230;    // … bei Weltklasse-Schützen
const PREC_MISS_M = 2.60;      // maximale seitliche Streuung in Metern (vor Können/Kraft)
const PREC_MISS_H = 1.30;      // maximale Höhenstreuung in Metern
const PREC_MISS_H_F = 0.50;    // Anteil der Höhenstreuung am Fehlklick
const JITTER_M = 0.24;         // Grundrauschen, damit nie zwei Elfmeter gleich sind

/* --- Zittern beim Zielen --- */
const WOBBLE_M = 0.62;         // Grundamplitude in Metern (bei Nervenstärke 0)
const WOBBLE_MIN = 0.06;

/* --- Torwart ---
 * Der Absprung liegt jetzt in ABSOLUTEN Millisekunden zum Ballkontakt: wer
 * wartet und wirklich reagiert, springt danach ab; wer rät, ist vorher in der
 * Luft. Die Reichweite ist nach dem Absprung linear in der Zeit (ballistisch —
 * in der Luft beschleunigt niemand seitlich) und kommt aus
 * ballistik.twReichweite(). */
const KEEPER_LATE_REFLEX = 85;  // ab hier: echte Reaktion statt Raten (Aufgabenstellung)
const KEEPER_REACT_MS = 220;    // echte Reaktion: so spät geht er runter
const KEEPER_GUESS_LEAD_MS = 180; // wer rät, ist so früh unterwegs
const KEEPER_REACT_REFLEX_LO = 1.10;  // Faktor auf KEEPER_REACT_MS bei Reflexe 0
const KEEPER_REACT_REFLEX_HI = 0.78;  // … bei Reflexe 99
const KEEPER_DIVE_U = 2.05;     // seitliche Ecke, in die der Torwart hechtet
const KEEPER_DIVE_H_LOW = 0.42;
const KEEPER_DIVE_H_HIGH = 1.68;
const KEEPER_STAY_H = 0.85;     // stehen bleiben: Mitte
const KEEPER_VERT_SCALE = 0.95; // hoch/tief kostet etwas weniger als seitlich
const KEEPER_WIRK = 1.48;       // Wirkradius um die Hand in Armlängen (Arm + Körper + Handschuh)
const KEEPER_DIFF_BASIS = 0.86; // Reichweitenfaktor: 1,0 bei difficulty.minigame = 1
const KEEPER_DIFF_SPANNE = 0.14;
const KEEPER_LATE_HIT_BASE = 0.52;     // Trefferquote der echten Reaktion
const KEEPER_GUESS_STAY = 0.07;        // wie oft er einfach stehen bleibt
const KEEPER_FEEL_U = 0.30;            // „aus dem Gefühl": richtige Ecke geahnt
const KEEPER_FEEL_H = 0.55;            // … richtige Höhe geahnt
const KEEPER_SAVE_BASIS = 0.75;        // Halteneigung bei Können 0 …
const KEEPER_SAVE_SKILL = 0.40;        // … Zuschlag bei Können 1
const KEEPER_SAVE_CEIL = 0.96;
const KEEPER_NACHSCHWUNG_S = 0.20;     // so lange hechtet er nach dem Balldurchgang weiter

/* --- Rahmentreffer --- */
const FRAME_IN_POST = 0.22;     // Innenpfosten → doch noch drin
const FRAME_IN_BAR = 0.12;      // Latte von unten → doch noch drin

/* --- Bewertung --- */
const Q_W_PLACEMENT = 0.28, Q_W_POWER = 0.28, Q_W_PRECISION = 0.44;
const XG_SPAN = 0.36;          // wie stark quality auf xgDelta durchschlägt
const XG_MIN = -0.10, XG_MAX = 0.40;

/* --- Trait-Boni --- */
const TRAIT_KILLER_SKILL = 0.13;   // 'elfmeterkiller'
const TRAIT_ICE_SKILL = 0.05;      // 'eisblock'
const TRAIT_KEEPER_LEGEND = 0.10;  // 'torwartlegende' – mehr Reichweite

/* --- Farben (Stil-Leitfaden §14) --- */
const C = {
  grassA: '#2f7d32', grassB: '#276b2a', grassDark: '#1e5320',
  line: '#f2f6ef', crowdBg: '#1b2430', banden: '#123a6b',
  wood: '#8b5a2b', beige: '#e8d9b0', paper: '#f2e8cf',
  red: '#c1272d', blue: '#1c4f8f', gold: '#f2c53d',
  ink: '#14181e', shadow: 'rgba(0,0,0,0.35)',
  net: 'rgba(245,248,255,0.55)', post: '#f4f6f8', postShade: '#b9c0c8'
};

/**
 * Eigene Zeichenroutinen statt host.drawPlayer:
 * Hecht-, Sprung- und Anlaufposen müssen exakt zur Kameraprojektion passen
 * (Größe = f(Tiefe)). Sobald render/players.js steht und die Skalierung geprüft
 * ist, kann der Schütze über host.drawPlayer laufen – dafür einfach umschalten.
 */
const USE_HOST_PLAYER = false;
const HOST_PLAYER_SCALE_UNIT = 96; // Annahme: scale 1 ≈ 96 px Körperhöhe

/* ══════════════════════════════════════════════════════════════════════════
   KLEINE HELFER
   ══════════════════════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;
const clamp01 = (v) => clamp(v, 0, 1);
const easeIn = (t) => t * t;

/** Attributzugriff mit Rückfallwert – Minispiele dürfen nie an fehlenden Daten sterben. */
function att(player, key, fallback = 50) {
  const a = player && player.attributes;
  const v = a ? a[key] : undefined;
  return typeof v === 'number' ? v : fallback;
}

function hasTrait(player, key) {
  return !!(player && Array.isArray(player.traits) && player.traits.includes(key));
}

/** Trikotfarben aus den Vereinsstammdaten, mit Fallback auf DEFAULT_COLORS. */
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

/** Torwart bekommt bewusst ein Kontrasttrikot – Grün/Gelb wie in den 90ern. */
function keeperKit(player) {
  const base = kitOf(player);
  return { primary: '#3aa04a', secondary: '#12331a', accent: base.accent, shorts: '#12331a', socks: '#3aa04a' };
}

/** Hauttöne passend zu appearance.skin (0..5). */
const SKIN_TONES = ['#f2d3b3', '#e6bd94', '#d09a66', '#b57a4b', '#8d5524', '#5c3317'];

/** Lochkamera: Weltpunkt (u,v,h) → Bildschirmpunkt. */
function makeCamera(w, h) {
  const cx = w / 2;
  const cy = HORIZON_Y * (h / CANVAS_H);
  const camV = SPOT_V + CAM_BACK;
  return {
    cx, cy, camV,
    scaleAt(v) { return CAM_FOCAL / Math.max(0.5, camV - v); },
    project(u, v, ht) {
      const k = CAM_FOCAL / Math.max(0.5, camV - v);
      return { x: cx + u * k, y: cy + (CAM_H - ht) * k, k };
    },
    /** Rückprojektion auf die Torebene (v = 0) – fürs Zielen mit der Maus. */
    unprojectGoal(sx, sy) {
      const k = CAM_FOCAL / camV;
      return { u: (sx - cx) / k, h: CAM_H - (sy - cy) / k };
    }
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   ZEICHENROUTINEN – Szene
   ══════════════════════════════════════════════════════════════════════════ */

function drawStands(ctx, cam, w, crowd, tSec) {
  const horizon = cam.cy;
  ctx.fillStyle = C.crowdBg;
  ctx.fillRect(0, 0, w, horizon + 6);

  // Ränge: drei Blöcke mit leicht unterschiedlicher Helligkeit
  ctx.fillStyle = '#232f3d';
  ctx.fillRect(0, horizon - 96, w, 96);
  ctx.fillStyle = '#1e2836';
  ctx.fillRect(0, horizon - 150, w, 54);

  // Zuschauer: deterministische Punktwolke, minimal wippend
  for (let i = 0; i < crowd.length; i++) {
    const p = crowd[i];
    const bob = Math.sin(tSec * 1.6 + p.ph) * 1.4;
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x, p.y + bob, p.s, p.s);
  }

  // Flutlicht-Schimmer
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, horizon);

  // Bandenwerbung
  ctx.fillStyle = C.banden;
  ctx.fillRect(0, horizon - 4, w, 18);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let x = 0; x < w; x += 96) ctx.fillRect(x + 8, horizon + 1, 46, 8);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 3;
  ctx.strokeRect(-2, horizon - 4, w + 4, 18);
}

function drawPitch(ctx, cam, w, h) {
  const horizon = cam.cy;
  ctx.fillStyle = C.grassA;
  ctx.fillRect(0, horizon + 12, w, h - horizon);

  // Rasenstreifen: quer, nach hinten zusammengestaucht (perspektivisch)
  for (let v = -3; v < 19; v += 2) {
    const y0 = cam.project(0, v + 2, 0).y;
    const y1 = cam.project(0, v, 0).y;
    if (y1 < horizon + 10) continue;
    ctx.fillStyle = (Math.floor(v / 2) % 2 === 0) ? C.grassB : C.grassA;
    ctx.fillRect(0, Math.max(horizon + 12, y0), w, Math.max(1, y1 - y0));
  }

  ctx.strokeStyle = C.line;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';

  // Torlinie
  const gl0 = cam.project(-34, 0, 0), gl1 = cam.project(34, 0, 0);
  ctx.beginPath(); ctx.moveTo(gl0.x, gl0.y); ctx.lineTo(gl1.x, gl1.y); ctx.stroke();

  // Strafraum (16,5 m tief, 40,32 m breit) + Torraum
  const boxes = [[16.5, 20.16], [5.5, 9.16]];
  for (const [depth, half] of boxes) {
    const a = cam.project(-half, 0, 0), b = cam.project(-half, depth, 0);
    const c2 = cam.project(half, depth, 0), d = cam.project(half, 0, 0);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }

  // Elfmeterpunkt
  const sp = cam.project(0, SPOT_V, 0);
  ctx.fillStyle = C.line;
  ctx.beginPath(); ctx.ellipse(sp.x, sp.y, 7, 3, 0, 0, TAU); ctx.fill();
}

/** Tor mit Tiefe: vorderer Rahmen, hinterer Rahmen, Netz dazwischen. */
function drawGoal(ctx, cam, netHit) {
  const backV = -2.1;
  const fl = cam.project(-GOAL_HALF_W, 0, GOAL_H), fr = cam.project(GOAL_HALF_W, 0, GOAL_H);
  const bl = cam.project(-GOAL_HALF_W, 0, 0), br = cam.project(GOAL_HALF_W, 0, 0);
  const kl = cam.project(-GOAL_HALF_W, backV, GOAL_H), kr = cam.project(GOAL_HALF_W, backV, GOAL_H);
  const nl = cam.project(-GOAL_HALF_W, backV, 0), nr = cam.project(GOAL_HALF_W, backV, 0);

  // Netzflächen (Rückwand + Seiten + Dach) leicht abdunkeln
  ctx.fillStyle = 'rgba(20,28,36,0.30)';
  ctx.beginPath();
  ctx.moveTo(kl.x, kl.y); ctx.lineTo(kr.x, kr.y); ctx.lineTo(nr.x, nr.y); ctx.lineTo(nl.x, nl.y);
  ctx.closePath(); ctx.fill();

  // Netzmaschen der Rückwand
  ctx.strokeStyle = C.net;
  ctx.lineWidth = 1;
  const cols = 20, rows = 9;
  for (let i = 0; i <= cols; i++) {
    const t = i / cols;
    const x0 = lerp(kl.x, kr.x, t), x1 = lerp(nl.x, nr.x, t);
    ctx.beginPath(); ctx.moveTo(x0, lerp(kl.y, kr.y, t)); ctx.lineTo(x1, lerp(nl.y, nr.y, t)); ctx.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    ctx.beginPath();
    ctx.moveTo(lerp(kl.x, nl.x, t), lerp(kl.y, nl.y, t));
    ctx.lineTo(lerp(kr.x, nr.x, t), lerp(kr.y, nr.y, t));
    ctx.stroke();
  }

  // Netzbeule nach dem Einschlag – Radius und Alpha wachsen mit der Wucht
  if (netHit && netHit.a > 0) {
    const p = cam.project(clamp(netHit.u, -GOAL_HALF_W + 0.2, GOAL_HALF_W - 0.2), backV + 0.3, clamp(netHit.h, 0.15, GOAL_H - 0.15));
    const wf = 0.55 + 0.75 * clamp01((netHit.wucht || 0.8) / NET_DEPTH_MAX);
    const a = clamp01(netHit.a);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 34 * wf * a, 24 * wf * a, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    for (let r = 1; r <= 3; r++) {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 12 * r * wf * a, 8 * r * wf * a, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Seitennetze
  ctx.strokeStyle = 'rgba(245,248,255,0.35)';
  for (let j = 0; j <= 5; j++) {
    const t = j / 5;
    ctx.beginPath();
    ctx.moveTo(fl.x, lerp(fl.y, bl.y, t)); ctx.lineTo(kl.x, lerp(kl.y, nl.y, t)); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fr.x, lerp(fr.y, br.y, t)); ctx.lineTo(kr.x, lerp(kr.y, nr.y, t)); ctx.stroke();
  }

  // Rahmen: dicke Outlines, Anstoß-Look
  const postW = Math.max(5, (bl.x - cam.project(-GOAL_HALF_W - 0.09, 0, 0).x));
  ctx.lineJoin = 'round';
  const bar = (x0, y0, x1, y1) => {
    ctx.strokeStyle = C.ink; ctx.lineWidth = postW + 4;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = C.post; ctx.lineWidth = postW;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  };
  bar(kl.x, kl.y, kr.x, kr.y);   // hintere Querstange
  bar(fl.x, fl.y, kl.x, kl.y);   // Dachholme
  bar(fr.x, fr.y, kr.x, kr.y);
  bar(bl.x, bl.y, fl.x, fl.y);   // linker Pfosten
  bar(br.x, br.y, fr.x, fr.y);   // rechter Pfosten
  bar(fl.x, fl.y, fr.x, fr.y);   // Latte
}

/** Ball mit Schatten. Rotation gibt dem Flug Tempo. */
function drawBall(ctx, cam, u, v, h, spin) {
  const sh = cam.project(u, v, 0);
  const k = cam.scaleAt(v);
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(sh.x, sh.y, BALL_R * k * 1.5, BALL_R * k * 0.55, 0, 0, TAU);
  ctx.fill();

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
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72, r * 0.2, 0, TAU);
    ctx.fill();
  }
  ctx.lineWidth = Math.max(1.5, r * 0.18);
  ctx.strokeStyle = C.ink;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  ctx.restore();
}

/**
 * Feldspieler von hinten (Schütze). pose: 'stand' | 'lauf' | 'schuss'
 * Retro-Look: dicke schwarze Outlines, flache Farbflächen.
 */
function drawShooter(ctx, host, player, cam, u, v, pose, frame, alpha) {
  if (USE_HOST_PLAYER && typeof host.drawPlayer === 'function' && pose !== 'schuss') {
    try {
      const k = cam.scaleAt(v);
      const p = cam.project(u, v, 0);
      host.drawPlayer(ctx, player, p.x, p.y, (1.82 * k) / HOST_PLAYER_SCALE_UNIT, { pose, dir: 1, frame });
      return;
    } catch (e) { /* Fallback unten */ }
  }
  const kit = kitOf(player);
  const k = cam.scaleAt(v);
  const foot = cam.project(u, v, 0);
  const bodyH = 1.82 * k;
  const w = bodyH * 0.30;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(foot.x, foot.y);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, bodyH * 0.028);
  ctx.strokeStyle = C.ink;

  const swing = pose === 'lauf' ? Math.sin(frame * TAU) : (pose === 'schuss' ? 1 : 0);

  // Schatten
  ctx.fillStyle = C.shadow;
  ctx.beginPath(); ctx.ellipse(0, 0, w * 0.9, w * 0.28, 0, 0, TAU); ctx.fill();

  // Beine
  const legH = bodyH * 0.46;
  const legW = w * 0.34;
  const drawLeg = (dx, kick) => {
    ctx.save();
    ctx.translate(dx, -legH);
    ctx.rotate(kick * 0.5);
    ctx.fillStyle = kit.socks;
    ctx.beginPath(); ctx.rect(-legW / 2, 0, legW, legH); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.beginPath(); ctx.rect(-legW / 2 - 1, legH - legH * 0.16, legW + 3, legH * 0.16); ctx.fill();
    ctx.restore();
  };
  drawLeg(-w * 0.28, -swing * 0.55);
  drawLeg(w * 0.28, swing * 0.75);

  // Hose
  ctx.fillStyle = kit.shorts;
  ctx.beginPath(); ctx.rect(-w * 0.55, -legH - bodyH * 0.17, w * 1.1, bodyH * 0.19); ctx.fill(); ctx.stroke();

  // Trikot (Rückenansicht)
  const torsoY = -legH - bodyH * 0.17;
  ctx.fillStyle = kit.primary;
  ctx.beginPath(); ctx.rect(-w * 0.58, torsoY - bodyH * 0.34, w * 1.16, bodyH * 0.35); ctx.fill(); ctx.stroke();

  // Rückennummer
  const num = player && player.number ? String(player.number) : '';
  if (num) {
    ctx.fillStyle = kit.secondary;
    ctx.font = `bold ${Math.round(bodyH * 0.19)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(num, 0, torsoY - bodyH * 0.16);
  }

  // Arme
  ctx.fillStyle = kit.primary;
  const armH = bodyH * 0.30, armW = w * 0.24;
  const arm = (dx, rot) => {
    ctx.save();
    ctx.translate(dx, torsoY - bodyH * 0.31);
    ctx.rotate(rot);
    ctx.beginPath(); ctx.rect(-armW / 2, 0, armW, armH); ctx.fill(); ctx.stroke();
    ctx.restore();
  };
  arm(-w * 0.68, swing * 0.6 - 0.15);
  arm(w * 0.68, -swing * 0.6 + 0.15);

  // Kopf von hinten (Haare)
  const headR = bodyH * 0.105;
  const app = (player && player.appearance) || {};
  ctx.fillStyle = SKIN_TONES[clamp(app.skin | 0, 0, 5)] || '#e6bd94';
  ctx.beginPath(); ctx.arc(0, torsoY - bodyH * 0.36 - headR * 0.6, headR, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = app.hairColor || '#2b1d14';
  ctx.beginPath();
  ctx.arc(0, torsoY - bodyH * 0.36 - headR * 0.75, headR * 0.98, Math.PI * 0.05, Math.PI * 0.95, true);
  ctx.fill();
  ctx.restore();
}

/**
 * Torwart, frontal. dive = 0..1 (Hechtfortschritt), side = -1|0|1, high = bool.
 * Eigene Routine, weil Rotation + Reichweite exakt zur Physik passen müssen.
 */
function drawKeeper(ctx, player, cam, uNow, high, dive, side) {
  const kit = keeperKit(player);
  const v = 0.35;
  const k = cam.scaleAt(v);
  const bodyH = 1.88 * k;
  const w = bodyH * 0.32;
  const foot = cam.project(uNow, v, 0);
  const rot = side * dive * 1.15;           // bis ~66° Neigung
  const lift = dive * (high ? 0.85 : 0.30) * k;

  ctx.save();
  ctx.fillStyle = C.shadow;
  ctx.beginPath(); ctx.ellipse(foot.x, foot.y, w * 1.1, w * 0.3, 0, 0, TAU); ctx.fill();

  ctx.translate(foot.x, foot.y - lift);
  ctx.rotate(rot);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, bodyH * 0.03);
  ctx.strokeStyle = C.ink;

  const legH = bodyH * 0.45, legW = w * 0.32;
  const spread = dive * 0.5;
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(s * w * 0.28, -legH);
    ctx.rotate(s * spread);
    ctx.fillStyle = kit.socks;
    ctx.beginPath(); ctx.rect(-legW / 2, 0, legW, legH); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = kit.shorts;
  ctx.beginPath(); ctx.rect(-w * 0.55, -legH - bodyH * 0.18, w * 1.1, bodyH * 0.2); ctx.fill(); ctx.stroke();

  const torsoY = -legH - bodyH * 0.18;
  ctx.fillStyle = kit.primary;
  ctx.beginPath(); ctx.rect(-w * 0.6, torsoY - bodyH * 0.33, w * 1.2, bodyH * 0.34); ctx.fill(); ctx.stroke();
  ctx.fillStyle = kit.secondary;
  ctx.beginPath(); ctx.rect(-w * 0.6, torsoY - bodyH * 0.12, w * 1.2, bodyH * 0.06); ctx.fill();

  // Arme: im Hecht weit gestreckt
  const armH = bodyH * (0.30 + dive * 0.16), armW = w * 0.26;
  const arms = [
    { dx: -w * 0.72, rot: -0.35 - dive * 1.05 },
    { dx: w * 0.72, rot: 0.35 + dive * 1.05 }
  ];
  for (const a of arms) {
    ctx.save();
    ctx.translate(a.dx, torsoY - bodyH * 0.29);
    ctx.rotate(a.rot);
    ctx.fillStyle = kit.primary;
    ctx.beginPath(); ctx.rect(-armW / 2, 0, armW, armH); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.gold;                         // Handschuhe
    ctx.beginPath(); ctx.rect(-armW * 0.72, armH - armW * 0.6, armW * 1.44, armW * 1.0); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  const headR = bodyH * 0.105;
  const app = (player && player.appearance) || {};
  ctx.fillStyle = SKIN_TONES[clamp(app.skin | 0, 0, 5)] || '#e6bd94';
  ctx.beginPath(); ctx.arc(0, torsoY - bodyH * 0.35 - headR * 0.55, headR, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = app.hairColor || '#2b1d14';
  ctx.beginPath();
  ctx.arc(0, torsoY - bodyH * 0.35 - headR * 0.72, headR * 0.98, Math.PI, TAU);
  ctx.fill();
  ctx.restore();
}

/** Zielkreuz im Anstoß-Stil. */
function drawCrosshair(ctx, cam, u, h, locked, pulse) {
  const p = cam.project(u, 0, h);
  const r = 26 + (locked ? 0 : Math.sin(pulse * 4) * 3);
  ctx.save();
  ctx.lineWidth = 5;
  ctx.strokeStyle = C.ink;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
  ctx.strokeStyle = locked ? C.gold : C.red;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - r - 10, p.y); ctx.lineTo(p.x - 6, p.y);
  ctx.moveTo(p.x + 6, p.y); ctx.lineTo(p.x + r + 10, p.y);
  ctx.moveTo(p.x, p.y - r - 10); ctx.lineTo(p.x, p.y - 6);
  ctx.moveTo(p.x, p.y + 6); ctx.lineTo(p.x, p.y + r + 10);
  ctx.stroke();
  ctx.fillStyle = locked ? C.gold : C.red;
  ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, TAU); ctx.fill();
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════════════════
   ZEICHENROUTINEN – HUD & Balken
   ══════════════════════════════════════════════════════════════════════════ */

/** Anstoß-Panel mit 2px-Outset-Bevel. */
function panel(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill || C.beige;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + 1, y + h - 1); ctx.lineTo(x + 1, y + 1); ctx.lineTo(x + w - 1, y + 1); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.moveTo(x + w - 1, y + 1); ctx.lineTo(x + w - 1, y + h - 1); ctx.lineTo(x + 1, y + h - 1); ctx.stroke();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 2;
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
  text(ctx, `${info.posName} · ${info.footName} · Schuss ${info.shot} · Nerven ${info.nerve}`, 14, 44, { size: 13, color: '#4a4034' });

  text(ctx, `${info.minute}. Minute · ${info.score}`, w / 2, 20, { bold: true, size: 19, align: 'center' });
  text(ctx, info.competition, w / 2, 44, { size: 13, align: 'center', color: '#4a4034' });

  text(ctx, `Schwierigkeit: ${info.difficultyName}`, w - 14, 20, { bold: true, size: 15, align: 'right', color: C.red });
  text(ctx, `Torwart: ${info.keeperName} (Reflexe ${info.keeperReflex})`, w - 14, 44, { size: 13, align: 'right', color: '#4a4034' });

  // Hinweiszeile
  panel(ctx, 0, 64, w, 30, C.wood);
  text(ctx, info.hint, w / 2, 79, { bold: true, size: 15, align: 'center', color: C.beige });
  if (info.badge) text(ctx, info.badge, 14, 79, { bold: true, size: 14, color: C.gold });
  if (info.timer !== null && info.timer !== undefined) {
    const bw = 130;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(w - bw - 14, 72, bw, 14);
    ctx.fillStyle = info.timer < 0.3 ? C.red : C.gold;
    ctx.fillRect(w - bw - 14, 72, bw * clamp01(info.timer), 14);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
    ctx.strokeRect(w - bw - 14, 72, bw, 14);
  }
}

/** Senkrechter Kraftbalken links. */
function drawPowerBar(ctx, x, y, w, h, value, active, label) {
  panel(ctx, x - 6, y - 26, w + 12, h + 34, C.wood);
  text(ctx, label, x + w / 2, y - 14, { bold: true, size: 13, align: 'center', color: C.beige });
  ctx.fillStyle = '#2a2118';
  ctx.fillRect(x, y, w, h);
  const fh = h * clamp01(value);
  const g = ctx.createLinearGradient(0, y + h, 0, y);
  g.addColorStop(0, '#3fa64a'); g.addColorStop(0.55, C.gold); g.addColorStop(1, C.red);
  ctx.fillStyle = g;
  ctx.fillRect(x, y + h - fh, w, fh);
  // Optimalzone
  const oy = y + h - h * POWER_IDEAL;
  ctx.strokeStyle = active ? '#ffffff' : 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x - 4, oy); ctx.lineTo(x + w + 4, oy); ctx.stroke();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

/** Waagerechter Präzisionsbalken unten. */
function drawPrecisionBar(ctx, x, y, w, h, marker, win, active) {
  panel(ctx, x - 8, y - 28, w + 16, h + 38, C.wood);
  text(ctx, 'PRÄZISION – im grünen Fenster klicken!', x + w / 2, y - 15,
    { bold: true, size: 13, align: 'center', color: active ? C.gold : C.beige });
  ctx.fillStyle = '#2a2118';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(x, y, w, h * 0.4);
  // Sweet Spot
  const cxp = x + w * 0.5;
  ctx.fillStyle = '#3fa64a';
  ctx.fillRect(cxp - w * win, y, w * win * 2, h);
  ctx.fillStyle = '#7fd48a';
  ctx.fillRect(cxp - w * win * 0.35, y, w * win * 0.7, h);
  // Läufer
  const mx = x + w * clamp01(marker);
  ctx.fillStyle = C.red;
  ctx.fillRect(mx - 3, y - 6, 6, h + 12);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  ctx.strokeRect(mx - 3, y - 6, 6, h + 12);
  ctx.strokeRect(x, y, w, h);
}

function drawBanner(ctx, w, h, title, sub, color) {
  const bw = 560, bh = 120;
  const x = (w - bw) / 2, y = h * 0.34;
  ctx.save();
  ctx.globalAlpha = 0.92;
  panel(ctx, x, y, bw, bh, color);
  ctx.restore();
  text(ctx, title, w / 2, y + 44, { bold: true, size: 46, align: 'center', color: '#ffffff', shadow: true, shadowOff: 3 });
  text(ctx, sub, w / 2, y + 92, { bold: true, size: 17, align: 'center', color: '#ffffff', shadow: true });
}

/* ══════════════════════════════════════════════════════════════════════════
   SPIELLOGIK
   ══════════════════════════════════════════════════════════════════════════ */

/** Schützen-Können 0..1 – bestimmt Zielfenster, Zittern und Balkentempo. */
function shooterSkill(actor) {
  const s = (att(actor, 'schuss') * 0.32 + att(actor, 'technik') * 0.22
    + att(actor, 'nervenstaerke') * 0.30 + att(actor, 'standards') * 0.16) / 100;
  let bonus = 0;
  if (hasTrait(actor, 'elfmeterkiller')) bonus += TRAIT_KILLER_SKILL;
  if (hasTrait(actor, 'eisblock')) bonus += TRAIT_ICE_SKILL;
  return clamp01(s + bonus);
}

/** Torwart-Können 0..1. */
function keeperSkill(keeper) {
  const s = (att(keeper, 'reflexe') * 0.55 + att(keeper, 'stellungsspiel') * 0.28
    + att(keeper, 'sprungkraft') * 0.17) / 100;
  return clamp01(s + (hasTrait(keeper, 'torwartlegende') ? TRAIT_KEEPER_LEGEND : 0));
}

/**
 * Torwart-Entscheidung.
 * Schwache Torhüter raten früh (gewichtet nach Schützenfuß), starke warten und
 * reagieren wirklich – dafür sind sie später in der Luft.
 *
 * `over` ist das Kraft-Übermaß 0..1 (siehe OVERPOWER_*). Wer voll durchzieht,
 * telegrafiert den Schuss über Anlauftempo und Standbein: der Torwart trifft
 * die Ecke häufiger. Das ist der Teil des Vollkraft-Malus, der NICHT am
 * Zielpunkt hängt — und damit der einzige, der auch dann noch beißt, wenn der
 * Torwart ohnehin genau auf dem Zielpunkt steht.
 */
function keeperDecision(rng, keeper, actor, diff, trueSide, trueHigh, over) {
  const reflex = att(keeper, 'reflexe');
  const late = reflex > KEEPER_LATE_REFLEX;
  const skill = keeperSkill(keeper);
  const gelesen = clamp01(over || 0) * OVERPOWER_LESEN;

  // Priors: Rechtsfüßer legen den Ball am liebsten mit dem Innenrist in die
  // Ecke links von sich – das ist die rechte Hand des Torwarts (u < 0).
  const foot = (actor && actor.foot) || 'rechts';
  const natural = foot === 'links' ? 1 : -1;
  const sides = [
    { side: natural, w: 0.42 },
    { side: -natural, w: 0.34 },
    { side: 0, w: KEEPER_GUESS_STAY }
  ];

  let side = rng.pickWeighted(sides, (s) => s.w).side;
  let high = rng.chance(0.30 + skill * 0.12);

  if (late) {
    // Echte Reaktion: Trefferquote steigt mit Reflexen und Schwierigkeitsgrad.
    const hit = clamp((KEEPER_LATE_HIT_BASE + (reflex - KEEPER_LATE_REFLEX) / 110) * (0.75 + 0.35 * diff) + gelesen, 0.2, 0.94);
    if (rng.chance(hit)) { side = trueSide; high = trueHigh; }
  } else {
    // Auch wer rät, liest den Schützen mit: Standbein, Blick, Anlaufwinkel.
    if (rng.chance(clamp(KEEPER_FEEL_U * diff * skill + gelesen, 0, 0.45 + gelesen))) side = trueSide;
    if (rng.chance(clamp(KEEPER_FEEL_H * skill + gelesen, 0, 0.60 + gelesen))) high = trueHigh;
  }

  return { side, high, late, skill };
}

/**
 * Torwartkennwerte inklusive Absprungzeitpunkt.
 *
 * `absprung` ist der Zeitpunkt des Absprungs RELATIV ZUM BALLKONTAKT in
 * Sekunden: positiv = danach (echte Reaktion), negativ = davor (geraten).
 * `tReakt` schiebt zusätzlich die Abstoßdauer TW_T_ABSTOSS dazu — erst danach
 * ist der Torwart wirklich unterwegs. Genau dieses Feld liest
 * ballistik.twReichweite().
 */
function twPlanParameter(keeper, late) {
  const groesse = (keeper && keeper.appearance && keeper.appearance.height)
    ? keeper.appearance.height / 100 : 1.88;
  const roh = twParameter({
    reflexe: att(keeper, 'reflexe', 45),
    antizipation: att(keeper, 'stellungsspiel', 45),
    sprungkraft: att(keeper, 'sprungkraft', 45),
    groesse
  });
  const reflex = clamp01(att(keeper, 'reflexe', 45) / 99);
  const absprung = late
    ? (KEEPER_REACT_MS / 1000) * lerp(KEEPER_REACT_REFLEX_LO, KEEPER_REACT_REFLEX_HI, reflex)
    : -KEEPER_GUESS_LEAD_MS / 1000;
  return {
    absprung,
    tReakt: absprung + TW_T_ABSTOSS,
    vHecht: roh.vHecht,
    arm: roh.arm
  };
}

/**
 * Wie weit die Hand des Torwarts in tFlug Sekunden vom Stand aus kommt.
 * Prüfschnittstelle (modell) und Anzeige benutzen dieselbe Funktion — Bild und
 * Modell dürfen nicht auseinanderdriften.
 */
function twReichweiteBei(tFlug, hoehe, keeper, late) {
  const l = (late === undefined) ? att(keeper, 'reflexe', 45) > KEEPER_LATE_REFLEX : !!late;
  return twReichweite(twPlanParameter(keeper, l), tFlug, hoehe);
}

/** Zielpunkt des Hechts (Ecke), in der gestauchten Höhenmetrik. */
function hechtRichtung(plan) {
  const zu = plan.side === 0 ? KEEPER_STAY_H : (plan.high ? KEEPER_DIVE_H_HIGH : KEEPER_DIVE_H_LOW);
  const du = plan.side * KEEPER_DIVE_U;
  const dh = (zu - KEEPER_STAY_H) * KEEPER_VERT_SCALE;
  const len = Math.hypot(du, dh);
  return { du, dh, len, eu: len > 1e-6 ? du / len : 0, eh: len > 1e-6 ? dh / len : 0 };
}

/** Wo die Hand nach `weg` Metern Hechtstrecke steht (Weltmeter). */
function handPunkt(plan, weg) {
  const r = hechtRichtung(plan);
  return {
    u: r.eu * weg,
    h: KEEPER_STAY_H + (r.eh * weg) / KEEPER_VERT_SCALE
  };
}

/**
 * Parade-Prüfung — reine Funktion, DOM-frei, rng nur als Parameter.
 *
 * schuss = { aimU, aimH, power, tFlug, actor?, diff? }
 * Rückgabe: { gehalten, p, d, handU, handH, weite, plan }
 *
 * Der Torwart springt zu einem festen Zeitpunkt ab und fliegt danach LINEAR
 * (ballistisch). Seine Hand liegt also nach tFlug Sekunden an genau einem Ort;
 * gehalten wird, was innerhalb einer Armlänge davon einschlägt.
 */
function parade(schuss, keeper, rng) {
  const diff = typeof schuss.diff === 'number' ? schuss.diff : 1;
  const aimU = schuss.aimU, aimH = schuss.aimH;
  const trueSide = aimU < -0.55 ? -1 : aimU > 0.55 ? 1 : 0;
  const trueHigh = aimH > 1.15;
  const power = typeof schuss.power === 'number' ? schuss.power : POWER_IDEAL;
  const over = Math.max(0, power - OVERPOWER_FROM) / (1 - OVERPOWER_FROM);
  const plan = keeperDecision(rng, keeper, schuss.actor || null, diff, trueSide, trueHigh, over);
  const par = twPlanParameter(keeper, plan.late);

  const weite = twReichweite(par, schuss.tFlug, aimH) * (KEEPER_DIFF_BASIS + KEEPER_DIFF_SPANNE * diff);
  const weg = Math.max(0, weite - par.arm);
  const hand = handPunkt(plan, weg);
  const abstand = Math.hypot(aimU - hand.u, (aimH - hand.h) * KEEPER_VERT_SCALE);
  const d = abstand / Math.max(0.25, par.arm * KEEPER_WIRK);

  // Auch der Halte-Malus hängt an der WIRKSAMEN Wucht — Übermaß macht den Ball
  // nicht härter, also darf es dem Torwart auch nicht das Festhalten erschweren.
  const powerRelief = lerp(1, 1 - POWER_SAVE_RELIEF, wirkKraft(power));
  const p = clamp((1 - d) * powerRelief * (KEEPER_SAVE_BASIS + KEEPER_SAVE_SKILL * plan.skill), 0, KEEPER_SAVE_CEIL);
  const gehalten = d < 1 && rng.chance(p);

  return { gehalten, p, d, handU: hand.u, handH: hand.h, weite, weg, plan, twpar: par };
}

/* ---------------------------------------------------------------------- *
 *  Ballflug
 * ---------------------------------------------------------------------- */

/**
 * Wucht, die wirklich in den Ball geht.
 *
 * Über dem Optimum wird der Ball nicht mehr härter: die zusätzliche Kraft geht
 * in den schlechten Kontakt, nicht ins Tempo. Ohne diese Deckelung wäre
 * Vollkraft allein durch die kürzere Flugzeit die bessere Wahl — der Torwart
 * hat schlicht weniger Zeit —, und zwar in JEDER Torecke und gegen jeden
 * Torwart. Der Kraftbalken hätte dann ein Optimum, das keines ist. Genau das
 * misst der Prüfstand über sein Gitter. Die Optimalzone ist im Balken markiert,
 * der Spieler wird also nicht getäuscht.
 */
function wirkKraft(power) {
  return Math.min(clamp01(power), POWER_IDEAL);
}

/** Abschussgeschwindigkeit in m/s aus Kraftbalken und Schussattribut. */
function schussTempo(power, schuss) {
  return lerp(SHOT_V_MIN, SHOT_V_MAX, wirkKraft(power))
    * lerp(SHOT_V_SKILL_LO, SHOT_V_SKILL_HI, clamp01((schuss === undefined ? 50 : schuss) / 100));
}

/**
 * Echte Bahn vom Elfmeterpunkt zum Zielpunkt (u = seitlich, v = Tiefe zur
 * Torlinie, h = Höhe). Der Aufrufer besitzt den Flug und gibt ihn frei.
 */
function baueFlug(aimU, aimH, tempo) {
  const von = { x: 0, y: SPOT_V, z: BALL_R };
  const nach = { x: aimU, y: 0, z: Math.max(BALL_R, aimH) };
  const l = loeseAbschuss(von, nach, tempo, { tMax: FLUG_T_MAX });
  let v;
  if (l) {
    v = abschussVektor(tempo, l.gier, l.neigung, { x: 0, y: 0, z: 0 });
  } else {
    // Notlösung ohne Luft, damit nie eine Szene ohne Ball dasteht.
    const dx = nach.x - von.x, dy = nach.y - von.y, dz = nach.z - von.z;
    const D = Math.hypot(dx, dy);
    const t = D / Math.max(1, tempo);
    v = { x: dx / t, y: dy / t, z: dz / t + 0.5 * 9.81 * t };
  }
  const flug = createFlug({ p: von, v, boden: BALL_R, tMax: FLUG_T_MAX });
  const tr = flug.trefferEbene('y', 0);
  const tFlug = tr ? tr.t : SPOT_V / Math.max(1, tempo);
  return {
    flug, tFlug,
    trefferU: tr ? tr.x : aimU,
    trefferH: tr ? tr.z : aimH,
    vx: tr ? tr.vx : 0, vy: tr ? tr.vy : -tempo, vz: tr ? tr.vz : 0,
    vEnd: tr ? Math.hypot(tr.vx, tr.vy, tr.vz) : tempo
  };
}

/** Flugzeit in Sekunden für Kraftbalken und Schussattribut (Prüfschnittstelle). */
function flugzeit(power, schuss, aimU, aimH) {
  const b = baueFlug(aimU === undefined ? 0 : aimU, aimH === undefined ? 0.6 : aimH,
    schussTempo(power, schuss));
  const t = b.tFlug;
  b.flug.freigeben();
  return t;
}

/**
 * Auflösung: Wohin geht der Ball, hält der Torwart?
 *
 * kontext = { actor, keeper, diff }, input = { aimU, aimH, power, precMiss, precDir }
 * Der zurückgegebene `flug` gehört dem Aufrufer (freigeben() nicht vergessen).
 */
function resolveShot(rng, kontext, input) {
  const actor = kontext.actor || {};
  const keeper = kontext.keeper || null;
  const diff = (typeof kontext.diff === 'number') ? kontext.diff : 1;
  const skill = shooterSkill(actor);

  // ---- Streuung aus Präzisions-Timing, Kraft und Können -------------------
  const over = Math.max(0, input.power - OVERPOWER_FROM) / (1 - OVERPOWER_FROM);
  const powerErr = 1 + over * OVERPOWER_ERR;
  const skillErr = lerp(1.35, 0.5, skill);
  const missNorm = clamp01(input.precMiss);          // 0 = perfekt, 1 = voll daneben
  const dirSign = input.precDir >= 0 ? 1 : -1;

  let aimU = input.aimU + dirSign * missNorm * PREC_MISS_M * skillErr * powerErr
    + rng.gauss(0, JITTER_M) * skillErr;
  let aimH = input.aimH + missNorm * PREC_MISS_H * PREC_MISS_H_F * skillErr
    + rng.gauss(0, JITTER_M * 0.7) * skillErr;

  aimU = clamp(aimU, -6.5, 6.5);
  aimH = clamp(aimH, -0.4, 4.2);

  // ---- Echte Bahn ---------------------------------------------------------
  const shotSpeed = schussTempo(input.power, att(actor, 'schuss'));
  const bahn = baueFlug(aimU, aimH, shotSpeed);
  const hU = bahn.trefferU, hH = bahn.trefferH;

  // ---- Rahmen: Pfosten über den echten Zylinder, Latte über die Höhe ------
  const rahmenR = POST_R + BALL_R;
  const lattenMitte = GOAL_H + POST_R;
  let frame = null, frameInnen = false;
  const pfL = bahn.flug.trefferZylinder('z', -(GOAL_HALF_W + POST_R), 0, rahmenR, 0, lattenMitte + POST_R);
  const pfR = pfL ? null : bahn.flug.trefferZylinder('z', GOAL_HALF_W + POST_R, 0, rahmenR, 0, lattenMitte + POST_R);
  const pf = pfL || pfR;
  if (pf) {
    frame = 'pfosten';
    frameInnen = Math.abs(hU) < GOAL_HALF_W;     // von innen dagegen = kann noch reinspringen
  } else if (Math.abs(hH - lattenMitte) <= rahmenR && Math.abs(hU) < GOAL_HALF_W + POST_R) {
    frame = 'latte';
    frameInnen = hH < lattenMitte;               // von unten dagegen
  }

  const inH = hH > BALL_R * 0.4 && hH < GOAL_H - POST_R - BALL_R * 0.5;
  const inU = Math.abs(hU) < GOAL_HALF_W - POST_R - BALL_R * 0.5;

  // ---- Torwart ------------------------------------------------------------
  const pd = parade({ aimU: hU, aimH: hH, power: input.power, tFlug: bahn.tFlug, actor, diff }, keeper, rng);
  const plan = pd.plan;
  const d = pd.d;
  const saved = pd.gehalten;

  // Rahmentreffer von innen springen manchmal doch noch hinein.
  const frameTor = frame
    ? rng.chance(frameInnen ? (frame === 'pfosten' ? FRAME_IN_POST : FRAME_IN_BAR) : 0)
    : false;

  let outcome;
  if (frame) {
    if (saved && d < 0.55) outcome = 'parade';
    else if (frameTor) outcome = 'tor';
    else outcome = frame;
  } else if (!inU || !inH) outcome = 'daneben';
  else if (saved) outcome = 'parade';
  else outcome = 'tor';

  // ---- Ausführungsgüte ----------------------------------------------------
  // Platzierung: Ecken sind gut, Mitte und Vorbeischüsse schlecht.
  const cornerU = clamp01((Math.abs(input.aimU) - 0.6) / (GOAL_HALF_W - 1.0));
  const cornerH = clamp01((input.aimH - 0.25) / 1.6) * 0.8;
  let placement = clamp01(cornerU * 0.62 + cornerH * 0.38);
  if (Math.abs(input.aimU) > GOAL_HALF_W - 0.15 || input.aimH > GOAL_H - 0.12) placement *= 0.55;
  const powerQ = clamp01(1 - Math.abs(input.power - POWER_IDEAL) / POWER_TOL);
  const precQ = clamp01(1 - missNorm);
  const quality = clamp(Q_W_PLACEMENT * placement + Q_W_POWER * powerQ + Q_W_PRECISION * precQ, 0.02, 1);

  let xg = (quality - 0.5) * XG_SPAN;
  if (outcome === 'tor') xg += 0.10;
  else if (outcome === 'parade') xg -= 0.04;
  else if (outcome === 'latte' || outcome === 'pfosten') xg -= 0.06;
  else if (outcome === 'daneben') xg -= 0.12;

  return {
    outcome,
    quality: Math.round(quality * 1000) / 1000,
    xgDelta: Math.round(clamp(xg, XG_MIN, XG_MAX) * 1000) / 1000,
    aimU, aimH, plan, saved,
    pSave: Math.round(pd.p * 100) / 100,
    d, parade: pd,
    flug: bahn.flug, tFlug: bahn.tFlug, shotSpeed,
    trefferU: hU, trefferH: hH, vEnd: bahn.vEnd,
    vx: bahn.vx, vy: bahn.vy, vz: bahn.vz
  };
}

/**
 * Nachspiel-Bahn: was mit dem Ball nach dem Kontakt passiert.
 *
 * Parade:  Spiegelung des einlaufenden Vektors an der Handnormalen, Betrag aus
 *          der Knappheit der Parade (Punkt 5 des Umbauplans).
 * Rahmen:  Reflexion am Pfosten (x) bzw. an der Latte (z).
 * Daneben: der Hauptflug läuft einfach weiter, es braucht keine zweite Bahn.
 * Tor:     das Netz bremst; das rechnet netzTiefe() analytisch.
 *
 * Rückgabe: Flug oder null. Der Aufrufer besitzt ihn.
 */
function baueNachspiel(result) {
  const o = result.outcome;
  if (o === 'daneben' || o === 'tor') return null;
  const px = result.trefferU, pz = Math.max(BALL_R, result.trefferH);
  const py = 0.30;                       // Kontakt kurz vor der Linie
  let vx = result.vx, vy = result.vy, vz = result.vz;

  if (o === 'parade') {
    let nx = px - result.parade.handU;
    let ny = 0.85;
    let nz = pz - result.parade.handH;
    const nn = Math.hypot(nx, ny, nz);
    if (nn < 1e-6) { nx = 0; ny = 1; nz = 0; } else { nx /= nn; ny /= nn; nz /= nn; }
    const vd = vx * nx + vy * ny + vz * nz;
    vx -= 2 * vd * nx; vy -= 2 * vd * ny; vz -= 2 * vd * nz;
    const betrag = result.shotSpeed * lerp(0.15, 0.45, 1 - clamp01(result.d));
    const s = Math.hypot(vx, vy, vz);
    const f = s > 1e-6 ? betrag / s : 0;
    vx *= f; vy *= f; vz *= f;
    if (vy < 1.0) vy = 1.0;              // der Ball muss vom Tor weg
  } else if (o === 'pfosten') {
    vx = -vx * 0.62; vy = -vy * 0.55; vz *= 0.62;
  } else {
    vy = -vy * 0.55; vz = -Math.abs(vz) * 0.45 - 1.2; vx *= 0.62;
  }
  return createFlug({
    p: { x: px, y: py, z: pz }, v: { x: vx, y: vy, z: vz },
    boden: BALL_R, tMax: 1.2
  });
}

/** Eindringtiefe ins Netz (Meter) nach `tau` Sekunden, Punkt 7 des Umbauplans. */
function netzTiefe(vEnd, tau) {
  const depth = clamp(vEnd * NET_DEPTH_PER_V, NET_DEPTH_MIN, NET_DEPTH_MAX);
  return depth * (1 - Math.exp(-Math.max(0, tau) / NET_TAU));
}

const RESULT_TEXT = {
  tor: { title: 'TOR!', color: '#2f7d32', sub: 'Der Ball zappelt im Netz – die Hütte bebt!' },
  parade: { title: 'GEHALTEN!', color: '#1c4f8f', sub: 'Der Keeper ist in der Ecke – was für eine Parade!' },
  daneben: { title: 'DANEBEN!', color: '#c1272d', sub: 'Vorbei! Das gibt Ärger auf den Rängen.' },
  latte: { title: 'LATTE!', color: '#8b5a2b', sub: 'Aluminium! Der Ball klirrt gegen die Querlatte.' },
  pfosten: { title: 'PFOSTEN!', color: '#8b5a2b', sub: 'Millimeter! Der Pfosten rettet den Gegner.' }
};

/* ══════════════════════════════════════════════════════════════════════════
   MINIGAME
   ══════════════════════════════════════════════════════════════════════════ */

export const minigame = {
  id: 'elfmeter',
  kind: 'elfmeter',
  title: 'Elfmeter',
  instructions: 'Zielen mit der Maus (oder Pfeiltasten), gedrückt halten für die Kraft, '
    + 'loslassen und im grünen Fenster nachklicken. ESC überlässt der Simulation den Schuss.',

  async play(host, moment) {
    const canvas = host && host.canvas;
    const ctx = host && host.ctx;
    if (!canvas || !ctx) return null;

    const rng = host.rng || createRng(20250711);
    const W = canvas.width || CANVAS_W;
    const H = canvas.height || CANVAS_H;
    const diff = (host.difficulty && typeof host.difficulty.minigame === 'number') ? host.difficulty.minigame : 1;
    const diffName = (host.difficulty && host.difficulty.name) || 'Profi';
    const actor = moment.actor || { shortName: 'Schütze', attributes: {} };
    const keeper = moment.keeper || { shortName: 'Torwart', attributes: { reflexe: 60, stellungsspiel: 58, sprungkraft: 58 } };
    const cam = makeCamera(W, H);
    const skill = shooterSkill(actor);
    // Klangnamen aus dem Vertrag von render/sound.js. Der zweite Parameter geht
    // unverändert an die Klangbank durch ({ lautstaerke, hoehe, panorama }).
    const sound = (n, o) => { try { if (typeof host.sound === 'function') host.sound(n, o); } catch (e) { /* egal */ } };

    /** Was am Ende zu hören ist – je Ausgang genau ein Klang. */
    const AUSGANG_KLANG = {
      tor: ['tor', null],
      parade: ['parade', null],
      latte: ['pfosten', { hoehe: 1.12 }],
      pfosten: ['pfosten', null],
      daneben: ['raunen', { lautstaerke: 0.9 }]
    };

    // Deterministische Zuschauerwolke (einmalig, danach nur noch gezeichnet).
    // Die Vereinsfarben liefert – falls vorhanden – der Stadionkontext aus
    // matchday.js; ohne ihn bleibt es beim Trikot des Schützen.
    const crowd = [];
    const kit = kitOf(actor);
    const farben = (moment.context && moment.context.farben) || null;
    const crowdColors = [
      (farben && farben.heim) || kit.primary,
      (farben && farben.gast) || kit.secondary,
      '#e8d9b0', '#8b5a2b', '#404a58', '#c9ced6'
    ];
    for (let i = 0; i < 420; i++) {
      crowd.push({
        x: rng.int(0, W), y: cam.cy - rng.int(8, 152), s: rng.int(3, 5),
        c: crowdColors[rng.int(0, crowdColors.length - 1)], ph: rng.float(0, TAU)
      });
    }
    // Zitter-Phasen einmal ziehen: gleicher Elfmeter = gleiches Zittern.
    const wob = { p1: rng.float(0, TAU), p2: rng.float(0, TAU), p3: rng.float(0, TAU) };
    // Der Präzisionsläufer startet zufällig – sonst könnte man blind im Takt klicken.
    const precPhase = rng.float(0, 1);

    /* ---- Ableitungen aus Können & Schwierigkeit --------------------------- */
    const precWin = clamp(lerp(PREC_WIN_MIN, PREC_WIN_MAX, skill) / clamp(diff, 0.5, 1.8), 0.035, 0.30);
    const precPeriod = PREC_PERIOD_MS * lerp(0.72, 1.35, skill) / clamp(diff, 0.6, 1.7);
    const powerPeriod = POWER_PERIOD_MS * lerp(0.78, 1.25, skill) / clamp(diff, 0.6, 1.7);
    const wobbleAmp = Math.max(WOBBLE_MIN,
      WOBBLE_M * (1 - att(actor, 'nervenstaerke') / 100) * clamp(diff, 0.5, 1.8)
      * (hasTrait(actor, 'elfmeterkiller') ? 0.55 : 1));

    const hudBase = {
      actor,
      posName: actor.position || 'ST',
      footName: actor.foot === 'links' ? 'linker Fuß' : actor.foot === 'beidfüßig' ? 'beidfüßig' : 'rechter Fuß',
      shot: att(actor, 'schuss'),
      nerve: att(actor, 'nervenstaerke'),
      minute: moment.minute != null ? moment.minute : (moment.context && moment.context.minute) || 0,
      score: (moment.context && moment.context.score) ? `${moment.context.score[0]}:${moment.context.score[1]}` : '0:0',
      competition: (moment.context && moment.context.competition) || 'Freundschaftsspiel',
      difficultyName: diffName,
      keeperName: keeper.shortName || keeper.lastName || 'Torwart',
      keeperReflex: att(keeper, 'reflexe'),
      badge: hasTrait(actor, 'elfmeterkiller')
        ? `${TRAITS.elfmeterkiller.icon} ${TRAITS.elfmeterkiller.name}: ruhige Hand`
        : (hasTrait(keeper, 'torwartlegende') ? `${TRAITS.torwartlegende.icon} Achtung: ${TRAITS.torwartlegende.name} im Tor` : '')
    };

    return new Promise((resolve) => {
      /* ---- Zustand -------------------------------------------------------- */
      let finished = false;
      let raf = 0;
      const tStart = performance.now();
      let phase = 'intro';
      let phaseStart = tStart;
      let pointerU = 0, pointerH = 1.0;     // rohes Mausziel (Meter)
      let aimU = 0, aimH = 1.0;             // eingerastetes Ziel inkl. Zittern
      let power = 0, powerLocked = 0;
      let precMarker = 0.5, precMiss = 1, precDir = 1;
      let result = null;                    // Ergebnis von resolveShot
      let nachspiel = null;                  // zweiter Flug (Abpraller/Aluminium)
      let flightMs = FLIGHT_MS;              // aus der echten Flugzeit, s. setPhase('flug')
      let netHit = { u: 0, h: 0, a: 0, ziel: 0, wucht: 0 };
      let ballSpin = 0, ballOmega = 0;
      const aufsetzer = [];                  // Bodenkontakte aus dem Integrator, für den Ton
      let naechsterAufsetzer = 0;
      let letzterFrame = 0;                  // für dt (performance.now, laut Dateikopf erlaubt)
      const kontext = { actor, keeper, diff };
      const ballWelt = { u: 0, v: SPOT_V, h: BALL_R };
      const prevCursor = canvas.style.cursor;

      /* ---- Aufräumen & Abschluss ------------------------------------------ */
      function fluegeFreigeben() {
        if (result && result.flug) { result.flug.freigeben(); result.flug = null; }
        if (nachspiel) { nachspiel.freigeben(); nachspiel = null; }
      }
      function detach() {
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        canvas.style.cursor = prevCursor;
      }
      function done(res) {
        if (finished) return;
        finished = true;
        if (raf) cancelAnimationFrame(raf);
        detach();
        fluegeFreigeben();
        resolve(res);
      }
      /** Notausgang: plausibles Ergebnis ohne weitere Animation (Vertrag §9). */
      function bailout() {
        let r = result;
        if (!r) {
          r = resolveShot(rng, kontext, {
            aimU: rng.float(-2.6, 2.6), aimH: rng.float(0.3, 1.5),
            power: 0.7, precMiss: 0.55, precDir: rng.chance(0.5) ? 1 : -1
          });
          if (r.flug) r.flug.freigeben();
          r.flug = null;
        }
        done({ outcome: r.outcome, quality: r.quality, targetPlayerId: null, xgDelta: r.xgDelta });
      }

      /* ---- Eingabe -------------------------------------------------------- */
      function toWorld(ev) {
        const r = canvas.getBoundingClientRect();
        const sx = (ev.clientX - r.left) * (W / Math.max(1, r.width));
        const sy = (ev.clientY - r.top) * (H / Math.max(1, r.height));
        const p = cam.unprojectGoal(sx, sy);
        return { u: clamp(p.u, -AIM_U_MAX, AIM_U_MAX), h: clamp(p.h, AIM_H_MIN, AIM_H_MAX) };
      }
      function onMove(ev) {
        if (phase !== 'zielen') return;
        const p = toWorld(ev);
        pointerU = p.u; pointerH = p.h;
      }
      function press() {
        if (phase === 'zielen') {
          const w = wobbleNow();
          aimU = clamp(pointerU + w.u, -AIM_U_MAX, AIM_U_MAX);
          aimH = clamp(pointerH + w.h, AIM_H_MIN, AIM_H_MAX);
          setPhase('kraft');
          sound('klick');
        } else if (phase === 'praezision') {
          lockPrecision();
        }
      }
      function release() {
        if (phase === 'kraft') {
          powerLocked = power;
          setPhase('praezision');
          sound('klick');
        }
      }
      function onDown(ev) { ev.preventDefault(); press(); }
      function onUp() { release(); }
      function onBlur() { if (phase === 'kraft') release(); }
      function onKeyDown(ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); done(null); return; }
        if (phase === 'zielen') {
          const step = 0.22;
          if (ev.key === 'ArrowLeft') { pointerU = clamp(pointerU - step, -AIM_U_MAX, AIM_U_MAX); ev.preventDefault(); }
          else if (ev.key === 'ArrowRight') { pointerU = clamp(pointerU + step, -AIM_U_MAX, AIM_U_MAX); ev.preventDefault(); }
          else if (ev.key === 'ArrowUp') { pointerH = clamp(pointerH + step, AIM_H_MIN, AIM_H_MAX); ev.preventDefault(); }
          else if (ev.key === 'ArrowDown') { pointerH = clamp(pointerH - step, AIM_H_MIN, AIM_H_MAX); ev.preventDefault(); }
        }
        if ((ev.key === ' ' || ev.key === 'Enter') && !ev.repeat) { ev.preventDefault(); press(); }
      }
      function onKeyUp(ev) {
        if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); release(); }
      }

      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerdown', onDown);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      canvas.style.cursor = 'crosshair';

      /* ---- Phasenwechsel --------------------------------------------------- */
      function setPhase(p) {
        phase = p;
        phaseStart = performance.now();
        if (p === 'flug') {
          result = resolveShot(rng, kontext, {
            aimU, aimH, power: powerLocked, precMiss, precDir
          });
          // Eine Uhr für alles: die Anzeige dehnt die echte Flugzeit um SLOWMO.
          flightMs = result.tFlug > 0 ? result.tFlug * 1000 * SLOWMO : FLIGHT_MS;
          nachspiel = baueNachspiel(result);
          netHit = {
            u: result.trefferU, h: result.trefferH, a: 0,
            ziel: clamp01(result.vEnd / 26),
            wucht: clamp(result.vEnd * NET_DEPTH_PER_V, NET_DEPTH_MIN, NET_DEPTH_MAX)
          };
          ballOmega = TAU * lerp(SPIN_UPS_MIN, SPIN_UPS_MAX, clamp01(powerLocked));
          // Bodenkontakte einsammeln: der Integrator kennt sie, der Ton soll
          // sie hören. Zeiten sind Physikzeiten seit dem Kontakt.
          aufsetzer.length = 0;
          for (const a of result.flug.aufsetzer()) {
            if (a.t <= result.tFlug) aufsetzer.push({ t: a.t, wucht: clamp01(Math.abs(a.vz) / 9) });
          }
          if (nachspiel) {
            for (const a of nachspiel.aufsetzer()) {
              aufsetzer.push({ t: result.tFlug + a.t, wucht: clamp01(Math.abs(a.vz) / 9) });
            }
          }
          naechsterAufsetzer = 0;
          sound('schuss');
        }
      }

      function wobbleNow() {
        const t = (performance.now() - tStart) / 1000;
        return {
          u: wobbleAmp * (Math.sin(t * 2.1 + wob.p1) * 0.62 + Math.sin(t * 3.7 + wob.p2) * 0.38),
          h: wobbleAmp * 0.55 * Math.sin(t * 2.9 + wob.p3)
        };
      }

      function lockPrecision() {
        const off = (precMarker - 0.5) * 2;          // -1..1
        precDir = off >= 0 ? 1 : -1;
        precMiss = clamp01((Math.abs(off) - precWin * 2) / Math.max(0.08, 1 - precWin * 2));
        setPhase('flug');
      }

      /* ---- Ballbahn: kein Bogen mehr von Hand, alles aus dem Integrator ----- */
      const _bs = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
      /**
       * Ballort zur Physikzeit t (Sekunden seit dem Kontakt). Bis zur Torlinie
       * liefert der Hauptflug; danach je nach Ausgang das Netz, der Abpraller
       * oder – bei „daneben" – weiter der Hauptflug.
       */
      function ballBei(t) {
        if (!result || !result.flug) {
          ballWelt.u = 0; ballWelt.v = SPOT_V; ballWelt.h = BALL_R;
          return ballWelt;
        }
        if (t <= result.tFlug || result.outcome === 'daneben') {
          const s = result.flug.at(clamp(t, 0, result.flug.dauer), _bs);
          ballWelt.u = s.x; ballWelt.v = s.y; ballWelt.h = Math.max(BALL_R, s.z);
          return ballWelt;
        }
        const tau = t - result.tFlug;
        if (result.outcome === 'tor') {
          const fall = Math.max(0, tau - NET_TAU * 2.5);
          ballWelt.u = result.trefferU;
          ballWelt.v = -netzTiefe(result.vEnd, tau);
          ballWelt.h = Math.max(BALL_R, result.trefferH - 0.5 * 9.81 * fall * fall);
          return ballWelt;
        }
        if (nachspiel) {
          const s = nachspiel.at(clamp(tau, 0, nachspiel.dauer), _bs);
          ballWelt.u = s.x; ballWelt.v = s.y; ballWelt.h = Math.max(BALL_R, s.z);
          return ballWelt;
        }
        ballWelt.u = result.trefferU; ballWelt.v = 0;
        ballWelt.h = Math.max(BALL_R, result.trefferH);
        return ballWelt;
      }

      /** Physikzeit seit dem Kontakt (negativ = Anlauf). */
      function physZeit(pt) {
        const ms = phase === 'ergebnis' ? flightMs + AFTER_MS + pt : pt - RUNUP_MS;
        return ms / 1000 / SLOWMO;
      }

      /* ---- Hauptschleife --------------------------------------------------- */
      function frame(now) {
        raf = requestAnimationFrame(frame);
        if (finished) return;
        if (now - tStart > HARD_TIMEOUT_MS) { bailout(); return; }

        const tSec = (now - tStart) / 1000;
        const pt = now - phaseStart;
        // Alles Zeitabhängige läuft über dt, nicht über „pro Bild" — sonst
        // hängen Drall und Netzbeule an der Bildrate.
        const dt = letzterFrame ? Math.min(0.05, (now - letzterFrame) / 1000) : 1 / 60;
        letzterFrame = now;

        /* --- Zustandsfortschritt --- */
        let timer = null;
        if (phase === 'intro') {
          if (pt > INTRO_MS) setPhase('zielen');
        } else if (phase === 'zielen') {
          timer = 1 - pt / AIM_LIMIT_MS;
          if (pt > AIM_LIMIT_MS) { const w = wobbleNow(); aimU = pointerU + w.u; aimH = pointerH + w.h; powerLocked = 0.55; setPhase('praezision'); }
        } else if (phase === 'kraft') {
          const tri = (pt % powerPeriod) / powerPeriod;
          power = tri < 0.5 ? tri * 2 : 2 - tri * 2;
          timer = 1 - pt / POWER_LIMIT_MS;
          if (pt > POWER_LIMIT_MS) { powerLocked = power; setPhase('praezision'); }
        } else if (phase === 'praezision') {
          const tri = ((pt / precPeriod) + precPhase) % 1;
          precMarker = tri < 0.5 ? tri * 2 : 2 - tri * 2;
          timer = 1 - pt / PREC_LIMIT_MS;
          if (pt > PREC_LIMIT_MS) lockPrecision();
        } else if (phase === 'flug') {
          if (pt > RUNUP_MS + flightMs + AFTER_MS) {
            setPhase('ergebnis');
            // Ein Elfmeter, der ins Nirgendwo geht, klang bisher nach
            // Aluminium. Jetzt bekommt jeder Ausgang seinen eigenen Ton.
            const klang = AUSGANG_KLANG[result.outcome];
            if (klang) sound(klang[0], klang[1]);
            if (result.outcome === 'latte' || result.outcome === 'pfosten') {
              sound('raunen', { lautstaerke: 0.85, verzoegerung: 0.3 });
            }
          }
        } else if (phase === 'ergebnis') {
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

        /* --- Szene zeichnen --- */
        ctx.save();
        ctx.clearRect(0, 0, W, H);
        drawStands(ctx, cam, W, crowd, tSec);
        drawPitch(ctx, cam, W, H);

        // Torwart-Position & Hechtfortschritt — aus DERSELBEN Funktion wie das
        // Modell (ballistik.twReichweite), nicht aus einem easeOut. Nach dem
        // Balldurchgang hechtet er KEEPER_NACHSCHWUNG_S weiter, statt in der
        // Luft einzufrieren.
        const tPhys = physZeit(pt);
        let kSide = 0, kHigh = false, kDive = 0, kU = Math.sin(tSec * 2.2) * 0.28;
        if (result && (phase === 'flug' || phase === 'ergebnis')) {
          const p = result.plan;
          kSide = p.side; kHigh = p.high;
          const richtung = hechtRichtung(p);
          if (richtung.len > 1e-6) {
            const tw = Math.max(0, Math.min(tPhys, result.tFlug + KEEPER_NACHSCHWUNG_S));
            const weg = Math.min(richtung.len,
              Math.max(0, twReichweite(result.parade.twpar, tw, result.aimH) - result.parade.twpar.arm));
            kDive = clamp01(weg / richtung.len);
            kU = handPunkt(p, weg).u;
          }
        }

        drawGoal(ctx, cam, netHit);
        drawKeeper(ctx, keeper, cam, kU, kHigh, kDive, kSide);

        // Ball & Schütze
        if (phase === 'flug' || phase === 'ergebnis') {
          const runT = phase === 'ergebnis' ? 1 : clamp01(pt / RUNUP_MS);
          const su = lerp(-2.0, -0.62, easeIn(runT));
          const sv = lerp(SPOT_V + 3.1, SPOT_V + 0.75, easeIn(runT));
          drawShooter(ctx, host, actor, cam, su, sv,
            runT < 1 ? 'lauf' : 'schuss', runT * 2.5, tPhys > 0.04 ? 0.45 : 1);

          if (tPhys <= 0) {
            drawBall(ctx, cam, 0, SPOT_V, BALL_R, 0);
          } else {
            ballSpin += ballOmega * dt;
            const b = ballBei(tPhys);
            drawBall(ctx, cam, b.u, b.v, Math.max(BALL_R, b.h), ballSpin);
            if (result.outcome === 'tor' && tPhys > result.tFlug) {
              netHit.a = Math.min(netHit.ziel, netHit.a + dt / NET_FADE_S);
            }
            // Bodenkontakte vertonen (die Klangbank kennt 'aufsetzer' erst mit
            // Paket 10 – der sound()-Wrapper verschluckt unbekannte Namen).
            while (naechsterAufsetzer < aufsetzer.length && tPhys >= aufsetzer[naechsterAufsetzer].t) {
              sound('aufsetzer', { lautstaerke: 0.35 + 0.65 * aufsetzer[naechsterAufsetzer].wucht });
              naechsterAufsetzer++;
            }
          }
        } else {
          drawShooter(ctx, host, actor, cam, -2.0, SPOT_V + 3.1, 'stand', 0, 1);
          drawBall(ctx, cam, 0, SPOT_V, BALL_R, 0);
        }

        /* --- Zielhilfe & Balken --- */
        if (phase === 'zielen') {
          const w = wobbleNow();
          drawCrosshair(ctx, cam, clamp(pointerU + w.u, -AIM_U_MAX, AIM_U_MAX),
            clamp(pointerH + w.h, AIM_H_MIN, AIM_H_MAX), false, tSec);
        } else if (phase === 'kraft' || phase === 'praezision') {
          drawCrosshair(ctx, cam, aimU, aimH, true, tSec);
        }
        if (phase === 'kraft' || phase === 'praezision' || phase === 'flug') {
          drawPowerBar(ctx, 42, H - 300, 40, 236,
            phase === 'kraft' ? power : powerLocked, phase === 'kraft', 'KRAFT');
        }
        if (phase === 'praezision') {
          drawPrecisionBar(ctx, W / 2 - 190, H - 62, 380, 26, precMarker, precWin, true);
        }

        /* --- HUD --- */
        const hints = {
          intro: 'Elfmeter! Gleich geht es los …',
          zielen: 'MAUS/PFEILTASTEN: zielen  ·  KLICK oder LEERTASTE halten: Kraft aufladen',
          kraft: 'HALTEN … im weißen Bereich LOSLASSEN für maximale Härte',
          praezision: 'JETZT: im grünen Fenster klicken – das entscheidet über die Genauigkeit!',
          flug: 'Der Ball ist unterwegs …',
          ergebnis: ''
        };
        drawHud(ctx, W, Object.assign({}, hudBase, { hint: hints[phase] || '', timer }));

        if (phase === 'ergebnis' && result) {
          const r = RESULT_TEXT[result.outcome] || RESULT_TEXT.daneben;
          drawBanner(ctx, W, H, r.title, r.sub, r.color);
          text(ctx, `Ausführung: ${Math.round(result.quality * 100)} %`, W / 2, H * 0.34 + 138,
            { bold: true, size: 16, align: 'center', color: '#ffffff', shadow: true });
        }
        ctx.restore();
      }

      raf = requestAnimationFrame(frame);
    });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   PRÜFSCHNITTSTELLE (Vertrag §9, additiv)

   Rein funktional, DOM-frei, rng ausschließlich als Parameter. Damit lässt
   sich die Elfmeterbalance in Node messen (tools/test-elfmeter.js), ohne das
   Minispiel zu starten. Weder Signatur noch Verhalten von `minigame` hängen
   daran.
   ══════════════════════════════════════════════════════════════════════════ */

export const modell = {
  /** Abschussgeschwindigkeit in m/s. */
  schussTempo,
  /** Flugzeit in Sekunden (power 0..1, schuss 0..100, optional Zielpunkt). */
  flugzeit,
  /** Vollständige Bahn; der Aufrufer besitzt sie und ruft flug.freigeben(). */
  bahn: baueFlug,
  /** Reichweite der Torwarthand nach tFlug Sekunden, in Metern. */
  twReichweiteBei,
  /** Parade-Entscheidung; zieht rng. */
  parade,
  /** Kompletter Elfmeter: kontext = { actor, keeper, diff }. */
  aufloesen: resolveShot,
  /** Balancewerte, damit der Prüfstand nicht doppelt pflegen muss. */
  KONSTANTEN: {
    POWER_IDEAL, OVERPOWER_FROM, OVERPOWER_ERR, OVERPOWER_LESEN, POWER_SAVE_RELIEF,
    PREC_WIN_MIN, PREC_WIN_MAX, PREC_PERIOD_MS,
    GOAL_HALF_W, GOAL_H, SPOT_V, BALL_R,
    SHOT_V_MIN, SHOT_V_MAX, SLOWMO,
    KEEPER_REACT_MS, KEEPER_GUESS_LEAD_MS, KEEPER_LATE_REFLEX
  }
};

export default minigame;
