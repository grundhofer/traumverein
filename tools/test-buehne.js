/**
 * tools/test-buehne.js — Prüfstand für die Vogelperspektive (render/pitch.js).
 *
 * Zwei Ebenen:
 *
 *   A) DIE REINEN HELFER. `render/pitch.js` exportiert alles, was die Bühne an
 *      Spiellogik rechnet, als seiteneffektfreie Funktion: Kettentiefe,
 *      Abseitsbezug, Breitenskalierung, Torwartposition, Kameraziel,
 *      Kamera-Anschläge, Wanduhr-Notbremse, Ballhöhe, Segmenttyp. Sie werden
 *      hier gegen Sollwerte geprüft — ohne Canvas, ohne DOM.
 *
 *   B) DIE GANZE BÜHNE. Für den Rest wird eine minimale DOM-Attrappe gestellt
 *      (Canvas, 2D-Kontext, requestAnimationFrame). Damit läuft `createPitchView`
 *      unter Node vollständig durch, und die beiden Zusagen, an denen das ganze
 *      Spiel hängt, werden tatsächlich gefahren:
 *        • playPhase() löst IMMER auf — auch wenn die Bildrate zusammenbricht
 *          (Wanduhr-Notbremse; screens/spieltag.js wartet ohne Timeout-Race).
 *        • Der Ball geht nie unter den Boden und liegt am Phasenende exakt auf
 *          dem letzten Wegpunkt.
 *
 * Aufruf:  node tools/test-buehne.js
 * Rückgabe: Exit-Code 1, wenn eine Prüfung fehlschlägt.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');

/* ------------------------------------------------------------------ *
 *  Prüfgerüst
 * ------------------------------------------------------------------ */

let gruen = 0;
const fehler = [];
let gruppe = '';

const kopf = (titel) => {
  gruppe = titel;
  console.log(`\n${'─'.repeat(66)}\n  ${titel}\n${'─'.repeat(66)}`);
};

function ok(bedingung, text, zusatz) {
  if (bedingung) { gruen++; return true; }
  const z = zusatz === undefined ? '' : `  (${zusatz})`;
  fehler.push(`${gruppe}: ${text}${z}`);
  console.log(`    FEHLER  ${text}${z}`);
  return false;
}

function nahe(ist, soll, tol, text) {
  const d = Math.abs(ist - soll);
  return ok(d <= tol, text, `ist ${fmt(ist)}, soll ${fmt(soll)} ± ${tol}`);
}

/**
 * Ein Ziel, dessen Ursache in einer FREMDEN Datei liegt. Es wird bei jedem Lauf
 * mit seiner Zahl gemeldet, färbt die Suite aber nicht rot — sonst müsste man
 * entweder den Korridor frisieren oder eine Datei anfassen, die einem nicht
 * gehört. Muster aus tools/test-kombination.js (`offen()`).
 * Sobald die fremde Datei repariert ist, wird das Ziel auf `ok()` zurückgedreht.
 * Stand jetzt ist kein Ziel mehr offen — der Helfer bleibt für den nächsten Fall
 * stehen, damit niemand ihn beim nächsten Mal neu erfinden muss.
 */
const offeneZiele = [];
function offen(bedingung, text, zusatz) {
  const z = zusatz === undefined ? '' : `  (${zusatz})`;
  if (bedingung) { gruen++; return true; }
  offeneZiele.push(`${gruppe}: ${text}${z}`);
  console.log(`    OFFEN   ${text}${z}`);
  return false;
}

const fmt = (v) => (typeof v === 'number' && isFinite(v) ? (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')) : String(v));
const info = (text) => console.log(`    ·  ${text}`);

/* ------------------------------------------------------------------ *
 *  DOM-Attrappe: gerade genug Canvas, damit pitch.js läuft
 * ------------------------------------------------------------------ */

function fakeCtx() {
  const zahl = { globalAlpha: 1, lineWidth: 1, imageSmoothingEnabled: true, letterSpacing: '' };
  const ziel = {
    measureText: () => ({ width: 6 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData() {}
  };
  return new Proxy(ziel, {
    get(t, k) {
      if (k in t) return t[k];
      if (k in zahl) return zahl[k];
      return () => {};
    },
    set(t, k, v) { zahl[k] = v; return true; }
  });
}

function fakeCanvas(w = 960, h = 600) {
  const c = {
    width: w, height: h,
    getContext: () => c._ctx,
    getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
    addEventListener() {}, removeEventListener() {},
    style: {}
  };
  c._ctx = fakeCtx();
  return c;
}

/** Handgesteuerte rAF-Uhr: der Test bestimmt, wie die Zeit vergeht. */
const uhr = { rueckrufe: [], id: 1 };

function domAufbauen() {
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? fakeCanvas(400, 300) : { style: {} })
  };
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {}
  };
  globalThis.requestAnimationFrame = (fn) => { uhr.rueckrufe.push(fn); return uhr.id++; };
  globalThis.cancelAnimationFrame = () => {};
}

/** Genau ein Frame mit dem Zeitstempel ts abarbeiten. */
function frame(ts) {
  const liste = uhr.rueckrufe;
  uhr.rueckrufe = [];
  for (const fn of liste) fn(ts);
}

/** n Frames mit fester Schrittweite laufen lassen; Promise nebenher auflösen. */
async function frames(n, startTs, schrittMs) {
  let t = startTs;
  for (let i = 0; i < n; i++) {
    t += schrittMs;
    frame(t);
    if (i % 8 === 7) await Promise.resolve();
  }
  await Promise.resolve();
  return t;
}

/* ------------------------------------------------------------------ *
 *  Testdaten
 * ------------------------------------------------------------------ */

function attr(tempo, antritt) {
  return {
    schuss: 60, technik: 60, passspiel: 60, dribbling: antritt, kopfball: 55, standards: 50,
    tempo, ausdauer: 70, koerper: 60, sprungkraft: 60,
    uebersicht: 60, positionsspiel: 60, zweikampf: 60, aggressivitaet: 55, nervenstaerke: 60, fuehrung: 50,
    reflexe: 15, stellungsspiel: 15, strafraumbeherrschung: 15, abschlag: 15
  };
}

function spieler(i, prefix, pos, tempo) {
  return {
    id: `${prefix}${i}`, firstName: 'A', lastName: `B${i}`, shortName: `B${i}`,
    clubId: prefix, nationality: 'DE', age: 25, era: 'modern', position: pos,
    altPositions: [], attributes: attr(tempo, tempo), potential: 80, foot: 'rechts', traits: [],
    appearance: { skin: 2, hair: 'kurz', hairColor: '#2b1d14', beard: 'keiner', build: 'normal', height: 180, eyes: '#3a2a1a', accessory: 'keiner', face: 1 },
    number: i + 1, fitness: 100
  };
}

function matchTeam(prefix, farbe) {
  const posen = ['TW', 'LV', 'IV', 'IV', 'RV', 'LM', 'ZM', 'ZM', 'RM', 'ST', 'ST'];
  const players = posen.map((p, i) => spieler(i, prefix, p, i === 0 ? 40 : 20 + i * 8));
  const lineup = {};
  players.forEach((p, i) => { lineup['s' + (i + 1)] = p.id; });
  return {
    club: {
      id: prefix, name: prefix, shortName: prefix, abbr: prefix.slice(0, 3).toUpperCase(), city: 'X',
      colors: { primary: farbe, secondary: '#ffffff', accent: '#000000' },
      kit: { pattern: 'plain', shorts: farbe, socks: farbe },
      awayKit: { primary: '#ffffff', secondary: farbe, pattern: 'plain' }
    },
    players, tactics: { formation: '4-4-2', lineup }, morale: 70, tiredness: 10, coachBonus: 50
  };
}

/** Phase nach Schema v2 (CONTRACTS §6.2). */
function phaseV2() {
  return {
    minute: 12, team: 'home', kind: 'angriff',
    ball: [{ x: 30, y: 20, t: 0 }, { x: 62, y: 18, t: 0.45 }, { x: 92, y: 30, t: 1 }],
    actors: [
      { playerId: 'h6', x: 30, y: 20, action: 'pass', role: 'passgeber', from: { x: 26, y: 22 }, t0: 0, t1: 0.45 },
      { playerId: 'h9', x: 62, y: 18, action: 'pass', role: 'empfaenger', from: { x: 52, y: 16 }, t0: 0, t1: 0.45 },
      { playerId: 'h10', x: 90, y: 30, action: 'schuss', role: 'schuetze', from: { x: 74, y: 26 }, t0: 0.45, t1: 1 }
    ],
    duration: 4.0, eventIndex: null,
    v: 2, startedFrom: 'ballgewinn', possessionStart: { x: 30, y: 20 }, lane: 'halblinks', formationId: '4-4-2',
    segments: [
      { type: 'steilpass', from: { x: 30, y: 20 }, to: { x: 62, y: 18 }, t0: 0, t1: 0.45, speed: 18, height: 0, by: 'h6', target: 'h9', against: null, outcome: 'angekommen', zone: 1, lane: 'halblinks' },
      { type: 'flanke', from: { x: 62, y: 18 }, to: { x: 92, y: 30 }, t0: 0.45, t1: 1, speed: 22, height: 6.5, by: 'h9', target: 'h10', against: null, outcome: 'angekommen', zone: 2, lane: 'halblinks' }
    ]
  };
}

/** Alte Phase ohne `v` — der Altpfad muss unverändert weiterlaufen. */
function phaseAlt() {
  return {
    minute: 30, team: 'away', kind: 'aufbau',
    ball: [{ x: 70, y: 40, t: 0 }, { x: 45, y: 30, t: 0.5 }, { x: 20, y: 34, t: 1 }],
    actors: [{ playerId: 'a7', x: 45, y: 30, action: 'pass' }],
    duration: 3.0, eventIndex: null
  };
}

/* ================================================================== *
 *  Los
 * ================================================================== */

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  TRAUMVEREIN – Prüfstand Bühne (Vogelperspektive)            ║');
console.log('╚══════════════════════════════════════════════════════════════╝');

domAufbauen();

const pitch = await import(pathToFileURL(resolve(WURZEL, 'src/render/pitch.js')).href);
const ballistik = await import(pathToFileURL(resolve(WURZEL, 'src/core/ballistik.js')).href);
const {
  kettenTiefe, abseitsBezug, breitenSkala, torwartZiel,
  kameraZiel, kameraKlemme, notbremseAnteil, phaseNotbremse, ballLift, segmentTyp, createPitchView
} = pitch;

/* ------------------------------------------------------------------ *
 *  1. Kettentiefe
 * ------------------------------------------------------------------ */

kopf('1. Kettentiefe — eine Linie je Mannschaft');

nahe(kettenTiefe(0, false), 26, 1e-9, 'verteidigend, Ball am eigenen Tor → BLOCK_DEPTH_DEF_LOW');
nahe(kettenTiefe(105, false), 34, 1e-9, 'verteidigend, Ball am Gegnertor → BLOCK_DEPTH_DEF_HIGH');
nahe(kettenTiefe(0, true), 34, 1e-9, 'in Ballbesitz, Ball am eigenen Tor → BLOCK_DEPTH_ATT_LOW');
nahe(kettenTiefe(105, true), 42, 1e-9, 'in Ballbesitz, Ball am Gegnertor → BLOCK_DEPTH_ATT_HIGH');
nahe(kettenTiefe(52.5, false), 30, 1e-9, 'Ball auf Höhe der Mittellinie → Mitte des Korridors');

let monoton = true;
for (let d = 0; d <= 105; d += 5) {
  if (kettenTiefe(d, false) < kettenTiefe(Math.max(0, d - 5), false) - 1e-12) monoton = false;
}
ok(monoton, 'Kettentiefe wächst monoton mit der Balltiefe');
ok(kettenTiefe(-40, false) === 26 && kettenTiefe(400, false) === 34, 'Werte außerhalb des Feldes werden geklemmt');
ok(kettenTiefe(NaN, false) === 26, 'NaN fällt auf die untere Grenze zurück');

let attImmerHoeher = true;
for (let d = 0; d <= 105; d += 7) {
  if (kettenTiefe(d, true) <= kettenTiefe(d, false)) attImmerHoeher = false;
}
ok(attImmerHoeher, 'in Ballbesitz steht die Kette immer höher als beim Verteidigen');

/* ------------------------------------------------------------------ *
 *  2. Abseitsbezug
 * ------------------------------------------------------------------ */

kopf('2. Abseitsbezug — der Stürmer klebt am letzten Mann');

nahe(abseitsBezug(80, 1), 80.6, 1e-9, 'Heim greift Richtung +x an: letzter Mann + 0,6 m');
nahe(abseitsBezug(25, -1), 24.4, 1e-9, 'Gast greift Richtung −x an: letzter Mann − 0,6 m');
nahe(abseitsBezug(104.9, 1), 103.8, 1e-9, 'nie hinter der Torlinie (obere Klemme)');
nahe(abseitsBezug(0.2, -1), 1.2, 1e-9, 'nie hinter der Torlinie (untere Klemme)');
ok(abseitsBezug(NaN, 1) === 53.1, 'ohne Gegner: Mittellinie + Toleranz', abseitsBezug(NaN, 1));

/* ------------------------------------------------------------------ *
 *  3. Breitenskalierung
 * ------------------------------------------------------------------ */

kopf('3. Breitenskalierung — die ballferne Seite rückt ein');

nahe(breitenSkala(true, 10, 54), 0.95, 1e-9, 'in Ballbesitz immer breit (WIDE_ATT)');
nahe(breitenSkala(true, 58, 10), 0.95, 1e-9, 'in Ballbesitz unabhängig von der Ballseite');
nahe(breitenSkala(false, 10, 54), 0.46, 1e-9, 'verteidigend, Ball auf der Gegenseite → WIDE_DEF_FAR');
nahe(breitenSkala(false, 10, 14), 0.88, 1e-9, 'verteidigend, Ball auf der eigenen Seite → WIDE_DEF_NEAR');
nahe(breitenSkala(false, 58, 54), 0.88, 1e-9, 'spiegelbildlich auf der anderen Feldhälfte');
nahe(breitenSkala(false, 10, 34), (0.46 + 0.88) / 2, 1e-9, 'Ball in der Mitte → genau dazwischen');

let stetig = true, groesster = 0, letzte = breitenSkala(false, 10, 0);
for (let y = 0.1; y <= 68; y += 0.1) {
  const v = breitenSkala(false, 10, y);
  groesster = Math.max(groesster, Math.abs(v - letzte));
  if (Math.abs(v - letzte) > 0.01) stetig = false;
  letzte = v;
}
ok(stetig, 'stetig über die ganze Feldbreite (kein Umklappen an der Mittelachse)',
  `größter Sprung je 10 cm: ${groesster.toFixed(4)}`);

/* ------------------------------------------------------------------ *
 *  4. Torwart
 * ------------------------------------------------------------------ */

kopf('4. Torwart — Ball-Tor-Achse statt x-Tiefe');

{
  const a = torwartZiel(52.5, 34, 0);
  nahe(a.y, 34, 1e-9, 'Ball zentral → Torwart auf der Torlinienmitte');
  ok(a.x > 0 && a.x < 13.5, 'Torwart läuft heraus, aber nicht ins Mittelfeld', a.x);

  // Ball von der Seite: der Keeper deckt den kurzen Pfosten ab, steht aber nie
  // außerhalb der Torbreite ± 0,4 m.
  let maxAbw = 0, maxWeg = 0, hinterLinie = false;
  for (let bx = 0; bx <= 105; bx += 3) {
    for (let by = 0; by <= 68; by += 4) {
      for (const tor of [0, 105]) {
        const p = torwartZiel(bx, by, tor);
        maxAbw = Math.max(maxAbw, Math.abs(p.y - 34));
        maxWeg = Math.max(maxWeg, Math.hypot(p.x - tor, p.y - 34));
        if (p.x < 0.4 - 1e-9 || p.x > 104.6 + 1e-9) hinterLinie = true;
      }
    }
  }
  nahe(maxAbw, 4.06, 1e-6, 'y bleibt in der Torbreite ± 0,4 m (3,66 + 0,4)');
  ok(maxWeg <= 13 + 1e-6, 'Auslauf nie über KEEPER_OUT_MAX', maxWeg.toFixed(2));
  ok(!hinterLinie, 'Torwart steht nie hinter der Torlinie');

  const seit = torwartZiel(20, 8, 0);
  ok(seit.y < 34 - 0.5, 'Ball links außen → Keeper rückt zum kurzen Pfosten', seit.y.toFixed(2));
  const seitRe = torwartZiel(20, 60, 0);
  nahe(seitRe.y - 34, -(seit.y - 34), 1e-9, 'spiegelbildlich auf der anderen Seite');
}

/* ------------------------------------------------------------------ *
 *  5. Kamera
 * ------------------------------------------------------------------ */

kopf('5. Kamera — Hysterese, Vorhalt, Brennweite');

{
  const basis = { cinematic: true, tempo: 1, aktiv: true, hot: false, jubel: false, ballX: 52.5, ballY: 34, ballVx: 0, ballVy: 0 };
  const z = (extra) => kameraZiel(Object.assign({}, basis, extra));

  nahe(z({ kind: 'aufbau' }).zoom, 1.0, 1e-9, 'aufbau → Brennweite 1,0');
  nahe(z({ kind: 'konter' }).zoom, 1.3, 1e-9, 'konter → Brennweite 1,3');
  nahe(z({ kind: 'angriff' }).zoom, 2.3, 1e-9, 'angriff → Brennweite 2,3 (CAM_ZOOM_ACTION)');
  nahe(z({ kind: 'standard' }).zoom, 2.3, 1e-9, 'standard → Brennweite 2,3');
  nahe(z({ kind: 'abwehr' }).zoom, 1.0, 1e-9, 'unbekannte Phasenart verhält sich wie aufbau');

  // Vorhalt: 1/CAM_SMOOTH = 0,357 s
  const vor = z({ kind: 'angriff', ballX: 60, ballVx: 14, ballVy: -7 });
  nahe(vor.x, 60 + 14 / 2.8, 1e-9, 'Vorhalt in x = ball.x + vx/CAM_SMOOTH');
  nahe(vor.y, 34 - 7 / 2.8, 1e-9, 'Vorhalt in y = ball.y + vy/CAM_SMOOTH');

  // Aufbau zielt zwischen Ball und Feldmitte
  const auf = z({ kind: 'aufbau', ballX: 20, ballY: 10 });
  nahe(auf.x, (20 + 52.5) / 2, 1e-9, 'aufbau zielt auf die Mitte zwischen Ball und Feldmitte (x)');
  nahe(auf.y, (10 + 34) / 2, 1e-9, 'aufbau zielt auf die Mitte zwischen Ball und Feldmitte (y)');

  // Konter: 8 m Vorhalt in Laufrichtung, +50 % Glättung
  const kon = z({ kind: 'konter', ballX: 40, ballY: 34, ballVx: 12, ballVy: 0 });
  nahe(kon.x, 48, 1e-9, 'konter: 8 m Vorhalt in Laufrichtung');
  nahe(kon.smooth, 2.8 * 1.5, 1e-9, 'konter: CAM_SMOOTH um 50 % erhöht');

  // Standard steht auf dem Ausführungsort
  const std = z({ kind: 'standard', standX: 88, standY: 12, ballX: 3, ballY: 60 });
  ok(std.x === 88 && std.y === 12, 'standard zielt auf den Ausführungsort, nicht auf den Ball');

  // Jubel
  const jub = z({ kind: 'angriff', jubel: true, jubelX: 103, jubelY: 30 });
  ok(jub.x === 103 && jub.y === 30 && Math.abs(jub.zoom - 2.1) < 1e-9, 'Jubel zoomt auf den Torort');

  // Tempo 6: Totale
  const schnell = z({ kind: 'angriff', tempo: 6 });
  nahe(schnell.zoom, 1, 1e-9, 'ab Tempo 6 bleibt die Kamera auf Totale');
  const schnell8 = z({ kind: 'angriff', tempo: 8, ballX: 100 });
  ok(Math.abs(schnell8.x - kameraZiel({ cinematic: true, tempo: 8 }).x) < 1e-9, 'Tempo 8 ebenso');

  // Keine Phase + kalt = Totale, keine Phase + heiß = am Ball
  const kalt = z({ aktiv: false, kind: null, ballX: 96, ballY: 20 });
  nahe(kalt.zoom, 1, 1e-9, 'ohne Phase und ohne Hysterese: Totale');
  const heiss = z({ aktiv: false, kind: null, hot: true, ballX: 96, ballY: 20 });
  nahe(heiss.zoom, 2.3, 1e-9, 'ohne Phase, aber heiß: Nachlauf am Ball');

  // cinematic aus
  nahe(kameraZiel({ cinematic: false, kind: 'angriff', aktiv: true, ballX: 99 }).zoom, 1, 1e-9,
    'ohne cinematic bleibt die Kamera fest');

  // Kein neues Objekt, wenn out übergeben wird (keine Allokation im Frame)
  const out = { x: 0, y: 0, zoom: 1, smooth: 0 };
  ok(kameraZiel(basis, out) === out, 'kameraZiel schreibt in das übergebene out-Objekt');
}

kopf('5b. Kamera-Anschläge — ein Tor muss zentrierbar sein');

{
  // Sichtfeld bei Brennweite 2,3 auf 960×600: Weltbreite ≈ 136 m ⇒ halbW ≈ 26 m.
  const halbW = 26, halbH = 16;
  const p = kameraKlemme(105, 34, halbW, halbH);
  nahe(p.x, 105, 1e-9, 'Gästetor (x = 105) lässt sich zentrieren');
  const q = kameraKlemme(0, 34, halbW, halbH);
  nahe(q.x, 0, 1e-9, 'Heimtor (x = 0) lässt sich zentrieren');
  const weit = kameraKlemme(400, 400, halbW, halbH);
  ok(weit.x < 200 && weit.y < 200, 'absurde Ziele werden geklemmt', `${weit.x.toFixed(1)}/${weit.y.toFixed(1)}`);
  const total = kameraKlemme(80, 50, 400, 300);
  ok(Math.abs(total.x - 52.5) < 1e-9, 'passt die ganze Welt ins Bild, steht die Kamera in der Mitte');
}

/* ------------------------------------------------------------------ *
 *  6. Wanduhr-Notbremse
 * ------------------------------------------------------------------ */

kopf('6. Wanduhr-Notbremse — playPhase() darf nie hängen');

{
  const dur = 3.0;

  /** Wanduhrzeit in Sekunden, in Schritten von `schritt` verbraucht. */
  const laufen = (sek, tempo, schritt = 1 / 60, start = 0) => {
    let a = start;
    for (let t = 0; t + 1e-12 < sek; t += schritt) {
      a = notbremseAnteil(a, Math.min(schritt, sek - t), dur, tempo);
    }
    return a;
  };

  const g1 = (dur / 1) * 2 + 2;                      // 8 s Wanduhr bei Tempo 1
  ok(!phaseNotbremse(laufen(g1 - 0.1, 1)), 'kurz vor der Grenze greift sie nicht');
  ok(phaseNotbremse(laufen(g1 + 0.1, 1)), 'kurz nach der Grenze greift sie');
  ok(!phaseNotbremse(0), 'zum Startzeitpunkt greift sie nicht');

  const g4 = (dur / 4) * 2 + 2;                      // 3,5 s bei Tempo 4
  ok(phaseNotbremse(laufen(g4 + 0.1, 4)), 'bei Tempo 4 greift sie entsprechend früher');
  ok(!phaseNotbremse(laufen(g4 - 0.1, 4)), '… und vorher nicht');
  ok(!phaseNotbremse(notbremseAnteil(NaN, NaN, dur, 1)), 'unbrauchbare Eingaben lösen sie nicht aus');
  ok(notbremseAnteil(0.5, -3, dur, 1) === 0.5, 'eine rückwärts laufende Uhr verbraucht nichts');
  ok(notbremseAnteil(0.5, 1, 0, 1) === 0.5, 'ohne Dauer wird nichts verbraucht');

  // Die Grenze ist unabhängig von der Bildrate: 0,2 s je Frame kommt auf denselben
  // Verbrauch wie 1/60 s je Frame.
  nahe(laufen(g1, 1, 0.2), laufen(g1, 1, 1 / 60), 1e-9, 'die Grenze hängt nicht an der Bildrate');

  /* --- BEFUND 1: ein Tempowechsel darf die Phase nicht abreißen -------- */
  // 4 s bei Tempo 1 verbrauchen die Hälfte des 8-s-Budgets. Wer danach auf
  // Tempo 8 stellt, liegt mit 4 s Wanduhr weit über der dortigen Grenze von
  // (3/8)·2+2 = 2,75 s — absolut gerechnet risse die Phase sofort ab.
  const halb = laufen(4, 1);
  nahe(halb, 0.5, 1e-6, 'vier Sekunden bei Tempo 1 verbrauchen das halbe Budget');
  ok(!phaseNotbremse(notbremseAnteil(halb, 1 / 60, dur, 8)),
    'Tempowechsel 1 → 8 mitten in der Phase reißt sie NICHT ab');
  ok(!phaseNotbremse(laufen(1.3, 8, 1 / 60, halb)),
    '… und auch 1,3 s später läuft sie noch (halbes Budget bei Tempo 8 = 1,375 s)');
  ok(phaseNotbremse(laufen(1.5, 8, 1 / 60, halb)),
    '… sie greift aber, sobald auch der Rest des Budgets weg ist');

  // Gegenprobe: langsamer stellen schenkt Zeit, aber verwirft nichts Verbrauchtes.
  // Budget bei Tempo 0,5 = (3/0,5)·2+2 = 14 s; das halbe Restbudget sind 7 s.
  ok(!phaseNotbremse(laufen(6.9, 0.5, 1 / 60, halb)),
    'Tempo 0,5 verlängert das Budget spürbar');
  ok(phaseNotbremse(laufen(7.1, 0.5, 1 / 60, halb)),
    '… hebt den bereits verbrauchten Anteil aber nicht auf');
}

/* ------------------------------------------------------------------ *
 *  7. Ballhöhe (Konvention: Schatten trägt die Höhe)
 * ------------------------------------------------------------------ */

kopf('7. Ballhöhe — Lift sättigt, Schatten bleibt am Boden');

{
  nahe(ballLift(0), 0, 1e-12, 'ein liegender Ball hat keinen Versatz');
  ok(ballLift(-3) === 0, 'negative Höhen sind kein Versatz');
  let mono = true, letzt = 0;
  for (let z = 0; z <= 30; z += 0.25) { const v = ballLift(z); if (v < letzt - 1e-12) mono = false; letzt = v; }
  ok(mono, 'monoton steigend');
  nahe(ballLift(1), 0.62 / (1 + 1 / 12), 1e-9, 'BALL_LIFT · z/(1 + z/12) bei 1 m');
  ok(ballLift(24) / 24 < ballLift(2) / 2 * 0.65, 'sättigt: hohe Bälle wachsen unterproportional',
    `${(ballLift(24) / 24).toFixed(3)} vs ${(ballLift(2) / 2).toFixed(3)}`);
  ok(ballLift(30) < 12, 'auch ein 30-m-Ball bleibt im Bild', ballLift(30).toFixed(2));
}

/* ------------------------------------------------------------------ *
 *  8. Segmenttyp (Altpfad)
 * ------------------------------------------------------------------ */

kopf('8. Segmenttyp — Heuristik nur für den Altpfad');

{
  ok(segmentTyp(2, 'aufbau', false, false) === 'dribbling', 'unter 4 m: Dribbling');
  ok(segmentTyp(8, 'aufbau', false, false) === 'pass_flach', '4–13 m: flacher Pass');
  ok(segmentTyp(18, 'aufbau', false, false) === 'steilpass', '13–24 m: Steilpass');
  ok(segmentTyp(40, 'aufbau', false, false) === 'flanke', 'ab 24 m: Flanke');
  ok(segmentTyp(6, 'aufbau', false, true) === 'flanke', 'vor einem Kopfball immer Flanke');
  ok(segmentTyp(12, 'standard', true, false) === 'freistoss', 'erster Ball eines Standards: Freistoß');
  ok(segmentTyp(30, 'standard', true, false) === 'flanke', 'langer Standard: Flanke');
  let alleBekannt = true;
  for (const d of [0, 1, 3.9, 4, 12.9, 13, 23.9, 24, 60]) {
    for (const k of ['aufbau', 'angriff', 'konter', 'standard', undefined]) {
      for (const erst of [true, false]) {
        for (const kb of [true, false]) {
          if (!ballistik.SEGMENT_TYPEN[segmentTyp(d, k, erst, kb)]) alleBekannt = false;
        }
      }
    }
  }
  ok(alleBekannt, 'jeder gelieferte Typ existiert in ballistik.SEGMENT_TYPEN');
}

/* ------------------------------------------------------------------ *
 *  9. Ballistik der Bühne: ein langer Ball setzt mehrfach auf
 * ------------------------------------------------------------------ */

kopf('9. Ballbahn — Aufsetzer und Ausrollen');

{
  const lang = ballistik.segmentFlug({ x: 0, y: 0, z: 0 }, { x: 48, y: 0, z: 0 }, 'abstoss', { tMax: 4 });
  const auf = lang.aufsetzer();
  ok(auf.length >= 2, 'ein 48-m-Abstoß setzt mindestens zweimal auf', `${auf.length} Aufsetzer`);
  ok(lang.scheitel().z > 2, 'und fliegt dabei sichtbar hoch', `${lang.scheitel().z.toFixed(2)} m`);
  lang.freigeben();

  const flach = ballistik.segmentFlug({ x: 0, y: 0, z: 0 }, { x: 14, y: 0, z: 0 }, 'pass_flach', { tMax: 4 });
  ok(flach.scheitel().z < 0.6, 'ein flacher Pass bleibt flach', `${flach.scheitel().z.toFixed(2)} m`);
  const t0 = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
  const t1 = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
  flach.at(0.05, t0); flach.at(flach.dauer, t1);
  ok(Math.hypot(t1.vx, t1.vy) < Math.hypot(t0.vx, t0.vy) * 0.6, 'und rollt sichtbar aus',
    `${Math.hypot(t0.vx, t0.vy).toFixed(1)} → ${Math.hypot(t1.vx, t1.vy).toFixed(1)} m/s`);
  flach.freigeben();

  const flanke = ballistik.segmentFlug({ x: 62, y: 18, z: 0 }, { x: 92, y: 30, z: 0 }, 'flanke', { tMax: 4, hoehe: 6.5 });
  nahe(flanke.scheitel().z, 6.5, 0.35, 'eine Flanke mit vorgegebener Scheitelhöhe erreicht sie auch');
  flanke.freigeben();
}

kopf('9b. Ballbahn — ein getretener Bodenball hoppelt bis zum Ziel');

{
  /* Ohne Vorgabe legt segmentFlug den ERSTEN Bodenkontakt genau auf den
   * Zielpunkt: ein 32-m-Steilpass käme ohne einen einzigen Aufsetzer an.
   * pitch.js gibt getretenen Bodenbällen deshalb eine flache Scheitelhöhe vor
   * (HUEPF_*). Diese Prüfung hält genau das fest. */
  const view = createPitchView(fakeCanvas(), { cinematic: false, crowd: false, noise: false, hud: false });
  view.setTeams(matchTeam('h', '#c1272d'), matchTeam('a', '#1c4f8f'));
  view.setFormationPositions();
  view.setSpeed(1);

  const ph = {
    minute: 5, team: 'home', kind: 'aufbau',
    ball: [{ x: 20, y: 34, t: 0 }, { x: 52, y: 34, t: 1 }],
    actors: [], duration: 2.2, eventIndex: null, v: 2,
    segments: [{
      type: 'steilpass', from: { x: 20, y: 34 }, to: { x: 52, y: 34 },
      t0: 0, t1: 1, speed: 21, height: 0, by: 'h6', target: 'h9',
      against: null, outcome: 'angekommen', zone: 1, lane: 'zentrum'
    }]
  };

  let fertig = false;
  const p = view.playPhase(ph).then(() => { fertig = true; });
  let kontakte = 0, inLuft = false, scheitel = 0;
  let ts = 1000;
  for (let i = 0; i < 400 && !fertig; i++) {
    ts += 16.7; frame(ts);
    const z = view.zustand().ball.z;
    scheitel = Math.max(scheitel, z);
    if (z > 0.10 && !inLuft) inLuft = true;
    else if (z <= 0.02 && inLuft) { inLuft = false; kontakte++; }
    await Promise.resolve();
  }
  await p;
  ok(kontakte >= 2, 'ein 32-m-Steilpass setzt zwei- oder dreimal sichtbar auf', `${kontakte} Kontakte`);
  ok(scheitel <= 0.75, 'und bleibt dabei flach (kein Bogenlampe)', `Scheitel ${scheitel.toFixed(2)} m`);
  view.destroy();
}

kopf('9c. Segmenthöhe — „0 = flach", fehlendes Feld = Physik (Vertrag §6.2)');

{
  /* BEFUND 2. Der Vertrag ist wörtlich: `height: 0` heißt flach. Vorher galt
   * alles unter 0,05 m als „nicht gesetzt" — damit war die Aussage der Engine
   * nicht mehr von ihrem Schweigen zu unterscheiden. Jetzt zählt nur noch, ob
   * das Feld DA ist. */
  const scheitelVon = async (hoehe, typ = 'flanke') => {
    const view = createPitchView(fakeCanvas(), { cinematic: false, crowd: false, noise: false, hud: false });
    view.setTeams(matchTeam('h', '#c1272d'), matchTeam('a', '#1c4f8f'));
    view.setFormationPositions();
    view.setSpeed(1);
    const seg = {
      type: typ, from: { x: 62, y: 8 }, to: { x: 92, y: 30 },
      t0: 0, t1: 1, speed: 22, by: 'h9', target: 'h10',
      against: null, outcome: 'angekommen', zone: 2, lane: 'rechts'
    };
    if (hoehe !== 'fehlt') seg.height = hoehe;
    const ph = {
      minute: 5, team: 'home', kind: 'angriff',
      ball: [{ x: 62, y: 8, t: 0 }, { x: 92, y: 30, t: 1 }],
      actors: [], duration: 2.4, eventIndex: null, v: 2, segments: [seg]
    };
    let fertig = false;
    const p = view.playPhase(ph).then(() => { fertig = true; });
    let zMax = 0, ts = 1000;
    for (let i = 0; i < 400 && !fertig; i++) {
      ts += 16.7; frame(ts);
      zMax = Math.max(zMax, view.zustand().ball.z);
      await Promise.resolve();
    }
    await p;
    view.destroy();
    return zMax;
  };

  const zNull = await scheitelVon(0);
  const zFehlt = await scheitelVon('fehlt');
  const zNullwert = await scheitelVon(null);
  const zKlein = await scheitelVon(0.04);
  const zHoch = await scheitelVon(6.5);

  ok(zNull < 0.5, 'height: 0 wird flach gezeichnet — auch bei einer Flanke',
    `Scheitel ${zNull.toFixed(2)} m`);
  ok(zFehlt > 1.5, 'fehlt das Feld, entscheidet die Ballistik des Typs (Flanke fliegt)',
    `Scheitel ${zFehlt.toFixed(2)} m`);
  ok(zNullwert > 1.5, 'height: null ist ebenfalls „nicht gesetzt" (isFinite(null) wäre true!)',
    `Scheitel ${zNullwert.toFixed(2)} m`);
  ok(zKlein > 0 && zKlein < 0.5, 'eine kleine gesetzte Höhe wird nicht mehr stillschweigend verworfen',
    `Scheitel ${zKlein.toFixed(2)} m`);
  ok(zHoch > 3, 'eine gesetzte Flankenhöhe fliegt wie bestellt', `Scheitel ${zHoch.toFixed(2)} m`);

  // Die Hüpfhöhe der getretenen Bodenbälle (9b) ist die DARSTELLUNG von flach,
  // keine Loft-Vorgabe — sie darf durch die neue Lesart nicht verschwinden.
  const zPass = await scheitelVon(0, 'steilpass');
  ok(zPass > 0.1 && zPass <= 0.75, 'ein flacher Steilpass hoppelt weiterhin sichtbar',
    `Scheitel ${zPass.toFixed(2)} m`);
}

/* ------------------------------------------------------------------ *
 *  10. Ganze Bühne unter Node
 * ------------------------------------------------------------------ */

kopf('10. Bühne — Phase v2 läuft, löst auf und endet am Ziel');

{
  const view = createPitchView(fakeCanvas(), { cinematic: true, crowd: false, noise: false });
  view.setTeams(matchTeam('h', '#c1272d'), matchTeam('a', '#1c4f8f'));
  view.setFormationPositions();
  view.setSpeed(1);

  const z0 = view.zustand();
  ok(z0.ents.length === 22, '22 Entities auf dem Platz', z0.ents.length);
  const vmaxe = z0.ents.map((e) => e.vmax);
  const spanne = Math.max(...vmaxe) - Math.min(...vmaxe);
  ok(spanne > 1.5, 'die Spieler sind unterschiedlich schnell (attributes.tempo wird gelesen)',
    `${Math.min(...vmaxe).toFixed(2)} … ${Math.max(...vmaxe).toFixed(2)} m/s`);
  ok(Math.min(...vmaxe) >= 7.2 * 0.85 - 1e-6 && Math.max(...vmaxe) <= 10.4 + 1e-6,
    'vmax liegt im Korridor von ballistik.laufwerte()');

  let fertig = false;
  const p = view.playPhase(phaseV2()).then(() => { fertig = true; });

  let zMax = -Infinity, tiefer = false;
  const posen = new Set();
  let ballspielerNah = Infinity;   // Abstand h9 ↔ Ball, wenn h9 den Ball spielt (t = 0,45)
  let ts = 1000;
  for (let i = 0; i < 400 && !fertig; i++) {
    ts += 16.7;
    frame(ts);
    const s = view.zustand();
    if (s.aktiv) zMax = Math.max(zMax, s.ball.z);
    if (s.ball.z < -1e-9) tiefer = true;
    for (const e of s.ents) posen.add(e.pose);
    if (s.aktiv && Math.abs(s.phaseT - 0.45) < 0.03) {
      const h9 = s.ents.find((e) => e.id === 'h9');
      if (h9) ballspielerNah = Math.min(ballspielerNah, Math.hypot(h9.x - s.ball.x, h9.y - s.ball.y));
    }
    await Promise.resolve();
  }
  await p;
  ok(fertig, 'playPhase() löst bei normaler Bildrate auf');
  ok(!tiefer, 'der Ball geht nie unter den Boden');
  ok(zMax > 3, 'die Flanke fliegt sichtbar hoch', `Scheitel ${zMax.toFixed(2)} m`);
  // Der Flankengeber hat laut Vertrag das Fenster t0 = 0 … t1 = 0,45, spielt den
  // Ball aber zu Beginn SEINES Segments (t = 0,45). Er muss also dann dort sein.
  ok(ballspielerNah < 2.6, 'wer den Ball spielt, ist zum Segmentbeginn auch am Ball',
    `${ballspielerNah === Infinity ? 'nie gemessen' : ballspielerNah.toFixed(2) + ' m'}`);
  ok(posen.has('schuss'), 'die Abschluss-/Passpose läuft sichtbar ab',
    `gesehene Posen: ${[...posen].join(', ')}`);
  const ende = view.zustand();
  nahe(ende.ball.x, 92, 0.2, 'am Phasenende liegt der Ball auf dem letzten Wegpunkt (x)');
  nahe(ende.ball.y, 30, 0.2, 'am Phasenende liegt der Ball auf dem letzten Wegpunkt (y)');
  nahe(ende.ball.z, 0, 1e-9, 'und er liegt auf dem Boden');

  view.destroy();
}

kopf('11. Bühne — Altpfad (phase.v fehlt) unverändert');

{
  const view = createPitchView(fakeCanvas(), { cinematic: true, crowd: false, noise: false });
  view.setTeams(matchTeam('h', '#c1272d'), matchTeam('a', '#1c4f8f'));
  view.setFormationPositions();
  view.setSpeed(1);

  let fertig = false;
  const p = view.playPhase(phaseAlt()).then(() => { fertig = true; });
  let ts = 1000;
  for (let i = 0; i < 400 && !fertig; i++) { ts += 16.7; frame(ts); await Promise.resolve(); }
  await p;
  ok(fertig, 'eine alte Phase ohne segments läuft und löst auf');
  const s = view.zustand();
  nahe(s.ball.x, 20, 0.2, 'Ball endet auf dem letzten Punkt von ball[] (x)');
  nahe(s.ball.y, 34, 0.2, 'Ball endet auf dem letzten Punkt von ball[] (y)');

  // Der skriptierte Akteur muss GENAU auf seiner Zielposition stehen (Altpfad!).
  const a7 = s.ents.find((e) => e.id === 'a7');
  ok(a7 && Math.hypot(a7.x - 45, a7.y - 30) < 0.05,
    'skriptierter Akteur kommt im Altpfad exakt an (lerp + easeInOut)',
    a7 ? `${a7.x.toFixed(2)}/${a7.y.toFixed(2)}` : 'fehlt');

  view.destroy();
}

kopf('12. Bühne — Wanduhr-Notbremse im laufenden Betrieb');

{
  const view = createPitchView(fakeCanvas(), { cinematic: true, crowd: false, noise: false });
  view.setTeams(matchTeam('h', '#c1272d'), matchTeam('a', '#1c4f8f'));
  view.setFormationPositions();
  view.setSpeed(1);

  // Eine sehr lange Phase, dazu eine Bildrate von 0,2 fps: dt wird auf 0,12 s
  // gedeckelt, der Phasenfortschritt kriecht — genau der Fall, in dem
  // spieltag.js ohne Notbremse ewig auf das Promise warten würde.
  const lang = phaseV2();
  lang.duration = 60;

  let fertig = false;
  const p = view.playPhase(lang).then(() => { fertig = true; });
  const grenze = 60 * 2 * 1000 + 2000;   // 122 s Wanduhr
  let ts = 1000;
  let frames0 = 0;
  while (!fertig && frames0 < 200) {
    ts += 5000;                          // 5 Sekunden Wanduhr je Frame
    frame(ts);
    frames0++;
    await Promise.resolve();
  }
  await p;
  ok(fertig, 'die Phase löst trotz eingebrochener Bildrate auf');
  // Die Wanduhr beginnt beim ERSTEN Frame nach playPhase(); dazu kommt die
  // Rasterung von 5 s je Frame. Zwei Frames Zuschlag sind also die exakte Grenze.
  const verbraucht = ts - 1000;
  ok(verbraucht <= grenze + 2 * 5000 + 1e-6,
    'und zwar spätestens nach dur·2 + 2 s Wanduhr',
    `${(verbraucht / 1000).toFixed(1)} s (Grenze ${(grenze / 1000).toFixed(1)} s + 2 Frames)`);
  ok(verbraucht > grenze - 5000, 'nicht vorzeitig — der Fortschritt war real noch nicht durch');

  view.destroy();
}

kopf('12b. Bühne — ein Tempowechsel mitten in der Phase reißt sie nicht ab');

{
  /* BEFUND 1 im laufenden Betrieb. Phase mit 6 s Dauer bei Tempo 1: nach 4 s
   * Wanduhr liegt der Fortschritt bei ≈ 0,67. Die Grenze bei Tempo 8 wäre
   * (6/8)·2+2 = 3,5 s — absolut gerechnet also längst überschritten. Die Phase
   * darf trotzdem weiterlaufen und ihre restlichen 0,33 sauber abspielen. */
  const view = createPitchView(fakeCanvas(), { cinematic: true, crowd: false, noise: false });
  view.setTeams(matchTeam('h', '#c1272d'), matchTeam('a', '#1c4f8f'));
  view.setFormationPositions();
  view.setSpeed(1);

  const lang = phaseV2();
  lang.duration = 6;

  let fertig = false;
  const p = view.playPhase(lang).then(() => { fertig = true; });
  let ts = 1000;
  for (let i = 0; i < 240 && !fertig; i++) { ts += 16.7; frame(ts); await Promise.resolve(); }
  const tVorher = view.zustand().phaseT;
  ok(!fertig, 'nach 4 s Wanduhr bei Tempo 1 läuft die Phase noch');
  ok(tVorher > 0.6 && tVorher < 0.75, 'und steht bei rund zwei Dritteln', tVorher.toFixed(3));

  view.setSpeed(8);
  ts += 16.7; frame(ts); await Promise.resolve();
  const tNachher = view.zustand().phaseT;
  ok(!fertig, 'der Sprung auf Tempo 8 beendet sie NICHT im selben Frame');
  ok(tNachher < 0.95, 'der Fortschritt springt auch nicht auf 1', tNachher.toFixed(3));

  let restFrames = 1;
  for (let i = 0; i < 120 && !fertig; i++) { ts += 16.7; frame(ts); restFrames++; await Promise.resolve(); }
  await p;
  ok(fertig, 'sie läuft danach normal aus');
  ok(restFrames >= 8, 'der Rest wird gerafft abgespielt, nicht weggeschnitten',
    `${restFrames} Frames für die restlichen ${((1 - tVorher) * 6 / 8).toFixed(2)} s`);

  view.destroy();
}

kopf('13. Bühne — Tempo 8 zeigt weiterhin Ballbewegung');

{
  const view = createPitchView(fakeCanvas(), { cinematic: true, crowd: false, noise: false });
  view.setTeams(matchTeam('h', '#c1272d'), matchTeam('a', '#1c4f8f'));
  view.setFormationPositions();
  view.setSpeed(8);

  let fertig = false;
  const p = view.playPhase(phaseV2()).then(() => { fertig = true; });
  let bewegt = 0, letztX = view.zustand().ball.x, frames1 = 0;
  let ts = 1000;
  for (let i = 0; i < 200 && !fertig; i++) {
    ts += 16.7; frame(ts); frames1++;
    const b = view.zustand().ball;
    if (Math.abs(b.x - letztX) > 0.01) bewegt++;
    letztX = b.x;
    await Promise.resolve();
  }
  await p;
  ok(fertig, 'auch bei Tempo 8 löst die Phase auf');
  ok(bewegt >= 3, 'der Ball bewegt sich dabei über mehrere Frames sichtbar',
    `${bewegt} Frames mit Ballbewegung in ${frames1} Frames`);
  const dauerS = frames1 * 16.7 / 1000;
  ok(dauerS >= 0.28, 'die Phase dauert mindestens PHASE_MIN_SECONDS', `${dauerS.toFixed(2)} s`);
  view.destroy();
}

kopf('14. Bühne — Kinematik: beschleunigen, bremsen, nicht auf der Stelle wenden');

{
  const view = createPitchView(fakeCanvas(), { cinematic: false, crowd: false, noise: false, hud: false });
  view.setTeams(matchTeam('h', '#c1272d'), matchTeam('a', '#1c4f8f'));
  view.setFormationPositions();
  view.setSpeed(1);

  // 180 Frames Formationsspiel: niemand darf teleportieren, alle bleiben im Feld.
  // ACHTUNG: zustand().ents ist nach y sortiert (Maler-Reihenfolge), deshalb wird
  // über die playerId zugeordnet und nicht über den Index.
  const nachId = (liste) => { const m = new Map(); for (const e of liste) m.set(e.id, e); return m; };
  let ts = 1000;
  let maxSprung = 0, maxTempo = 0, ausserhalb = false, wer = '';
  let vor = nachId(view.zustand().ents);
  let ersterFrame = true;
  for (let i = 0; i < 180; i++) {
    ts += 16.7; frame(ts);
    const jetzt = nachId(view.zustand().ents);
    for (const [id, e] of jetzt) {
      const a = vor.get(id);
      // Der allererste Frame hat ein aufgelaufenes dt (lastTs = 0) und zählt nicht.
      if (a && !ersterFrame) {
        const d = Math.hypot(e.x - a.x, e.y - a.y);
        if (d > maxSprung) { maxSprung = d; wer = id; }
      }
      maxTempo = Math.max(maxTempo, e.speedNow);
      if (e.x < -1.01 || e.x > 106.01 || e.y < -1.01 || e.y > 69.01) ausserhalb = true;
    }
    vor = jetzt;
    ersterFrame = false;
    await Promise.resolve();
  }
  const maxProSek = maxSprung / (16.7 / 1000);
  ok(maxProSek <= 11, 'niemand bewegt sich schneller als menschenmöglich',
    `Spitze ${maxProSek.toFixed(2)} m/s (${wer})`);
  ok(!ausserhalb, 'niemand verlässt das Feld');
  ok(maxTempo <= 10.4 + 1e-6, 'niemand überschreitet sein vmax', `${maxTempo.toFixed(2)} m/s`);
  info(`höchstes gemessenes Lauftempo: ${maxTempo.toFixed(2)} m/s`);

  // Kette: die Innenverteidiger einer Mannschaft stehen auf einer Linie.
  const s = view.zustand();
  const abwH = s.ents.filter((e) => e.side === 'home' && e.group === 'ABW');
  const spanneX = Math.max(...abwH.map((e) => e.x)) - Math.min(...abwH.map((e) => e.x));
  ok(abwH.length >= 3, 'es gibt eine Abwehrreihe', abwH.length);
  ok(spanneX < 9, 'die Kette steht auf einer Linie (x-Spanne)', `${spanneX.toFixed(2)} m`);
  info(`Kettentiefe home ${s.linien.home.toFixed(1)} m, away ${s.linien.away.toFixed(1)} m`);
  info(`Abseitsbezug home ${s.abseits.home.toFixed(1)}, away ${s.abseits.away.toFixed(1)}`);

  view.destroy();
}

kopf('15. Bildbudget — tick() bei 22 Entities');

{
  const view = createPitchView(fakeCanvas(), { cinematic: true, crowd: false, noise: false });
  view.setTeams(matchTeam('h', '#c1272d'), matchTeam('a', '#1c4f8f'));
  view.setFormationPositions();
  view.setSpeed(1);

  const ph = phaseV2();
  ph.duration = 30;
  const p = view.playPhase(ph);
  let ts = 1000;
  for (let i = 0; i < 60; i++) { ts += 16.7; frame(ts); }   // aufwärmen

  const t0 = process.hrtime.bigint();
  const N = 300;
  for (let i = 0; i < N; i++) { ts += 16.7; frame(ts); }
  const msJeFrame = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  info(`tick() im Mittel ${msJeFrame.toFixed(3)} ms (Node + Canvas-Attrappe, ohne echtes Zeichnen)`);
  ok(msJeFrame < 4, 'tick() bleibt unter 4 ms je Frame', `${msJeFrame.toFixed(3)} ms`);

  // Ein Phasenwechsel darf nicht teurer sein als ein paar Frames.
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) view.playPhase(phaseV2());
  const msJePhase = Number(process.hrtime.bigint() - t1) / 1e6 / 20;
  info(`playPhase() (inkl. segmentFlug je Segment) ${msJePhase.toFixed(3)} ms`);
  ok(msJePhase < 12, 'ein Phasenaufbau bleibt unter 12 ms', `${msJePhase.toFixed(3)} ms`);

  view.destroy();
  await p.catch(() => {});
}

/* ------------------------------------------------------------------ *
 *  16. Echtlauf gegen die Engine
 * ------------------------------------------------------------------ */

kopf('16. Echtlauf — was die Engine liefert, zeichnet die Bühne wie?');

{
  /* Abschnitt 9c prüft die LESART an gebauten Segmenten. Hier läuft die echte
   * Engine, weil nur so sichtbar wird, was die Lesart im Bild bedeutet.
   *
   * Sichtprüfung des Umbauplans: „Eine Flanke hängt hoch in der Luft und kommt
   * genau einmal auf." Erfüllen kann die Bühne das nur, wenn ein hochfliegendes
   * Segment auch eine Höhe mitbringt — `height: 0` heißt laut Vertrag §6.2
   * flach, und dem folgt der Renderer seit Abschnitt 9c wörtlich. */
  const { createRng } = await import(pathToFileURL(resolve(WURZEL, 'src/core/rng.js')).href);
  const { DIFFICULTIES } = await import(pathToFileURL(resolve(WURZEL, 'src/core/constants.js')).href);
  const { generateSquad } = await import(pathToFileURL(resolve(WURZEL, 'src/data/generator.js')).href);
  const { autoLineup } = await import(pathToFileURL(resolve(WURZEL, 'src/engine/tactics.js')).href);
  const { simulateMatch } = await import(pathToFileURL(resolve(WURZEL, 'src/engine/match.js')).href);

  const KLUB = (id, ruf) => ({
    id, name: id, shortName: id, abbr: id.slice(0, 3).toUpperCase(), city: 'X',
    reputation: ruf, leagueId: 'bl1',
    facilities: { training: ruf, medical: ruf, youth: ruf, scouting: ruf },
    colors: { primary: '#c1272d', secondary: '#ffffff', accent: '#000000' },
    kit: { pattern: 'plain', shorts: '#c1272d', socks: '#c1272d' },
    awayKit: { primary: '#ffffff', secondary: '#c1272d', pattern: 'plain' }
  });

  const echtTeam = (club, seed, stil) => {
    const rng = createRng('buehne:kader:' + club.id + ':' + seed);
    const players = generateSquad(rng, club, { size: 22 }).map((p) => {
      p.form = 50; p.morale = 68; p.fitness = 95; p.sharpness = 60;
      p.injury = null; p.cards = { yellow: 0, red: 0, ban: 0 };
      p.stats = { season: {}, career: {} };
      return p;
    });
    const tactics = autoLineup(players, {
      formation: '4-4-2', style: stil,
      sliders: { tempo: 50, breite: 60, pressinghoehe: 50, risiko: 50, haerte: 50, offensivdrang: 55 },
      instructions: {}
    }, { respectFitness: true });
    return { club, players, tactics, morale: 65, tiredness: 6, coachBonus: 70, chemistryHistory: 45 };
  };

  const phasen = [];
  const stile = ['ausgeglichen', 'kick_and_rush', 'offensiv'];
  for (let s = 0; s < 3; s++) {
    await simulateMatch({
      home: echtTeam(KLUB('heim', 80), s, stile[s]),
      away: echtTeam(KLUB('gast', 66), s + 50, stile[(s + 1) % 3]),
      rng: createRng('buehne:spiel:' + s),
      venue: { capacity: 50000, attendance: 42000, stadiumName: 'X', pitch: 85, weather: 'sonnig', temperature: 18 },
      referee: { name: 'R', strictness: 55, homeBias: 50 },
      difficulty: DIFFICULTIES.profi,
      competition: { id: 'bl1', name: 'BL', matchday: 5, neutral: false },
      interactive: false,
      onEvent: () => {},
      onPhase: (ph) => phasen.push(ph)
    });
  }

  /* --- (a) Was steht in den Segmenten? --------------------------------- */
  const HOCH = { flanke: 1, klaerung: 1, kopfball: 1, abstoss: 1, einwurf: 1, freistoss: 1 };
  const HOEHE_MAX_TEST = 24;   // pitch.js klemmt eine gesetzte Höhe auf HOEHE_MAX
  let segGes = 0, mitFeld = 0, hochGes = 0;
  const hochOhneFeld = [];          // Feld fehlt ⇒ der Typ-Loft der Ballistik entscheidet
  const hochAusdruecklichFlach = [];// height = 0 ⇒ die Engine sagt flach, der Renderer folgt
  const flanken = [];    // jede einzelne Flanke — die Sichtprüfung hängt an ihnen
  const klaerungen = []; // und jede Klärung: beide haben ein Scheitelprofil in der Engine
  for (const ph of phasen) {
    if (!ph || !Array.isArray(ph.segments)) continue;
    for (const s of ph.segments) {
      if (!s || !s.from || !s.to) continue;
      segGes++;
      const gesetzt = typeof s.height === 'number' && isFinite(s.height);
      if (gesetzt) mitFeld++;
      const dist = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y);
      if (dist > 0.2 && s.type === 'flanke') flanken.push({ typ: 'flanke', height: s.height, dist });
      if (dist > 0.2 && s.type === 'klaerung') klaerungen.push({ typ: 'klaerung', height: s.height, dist });
      if (!HOCH[s.type]) continue;
      hochGes++;
      if (!gesetzt) hochOhneFeld.push(s);
      else if (s.height <= 0) hochAusdruecklichFlach.push(s);
    }
  }
  ok(segGes > 500, 'der Echtlauf liefert genug Segmente zum Messen', segGes);
  info(`${phasen.length} Phasen, ${segGes} Segmente, davon ${hochGes} von hochfliegender Art`);
  // Seit der Engine-Reparatur schreibt `match.js segment()` das height-Feld nur
  // noch, wenn `scheitelHoehe()` eine Aussage hat — das FEHLENDE Feld ist damit
  // der Normalfall und nicht mehr unerreichbar.
  info(`Segmente mit height-Feld: ${mitFeld} von ${segGes}, ohne Feld ${segGes - mitFeld}`);
  info(`hochfliegende Segmente: ${hochOhneFeld.length} ohne height-Feld (Typ-Loft entscheidet), `
    + `${hochAusdruecklichFlach.length} ausdrücklich flach (height = 0), `
    + `${hochGes - hochOhneFeld.length - hochAusdruecklichFlach.length} mit positiver Höhe`);

  /* --- (b) Und wie zeichnet die Bühne sie? ----------------------------- */
  // Die echten Segmente werden zu Sammelphasen verkettet und durch den echten
  // Renderer geschickt; gemessen wird der Scheitel je Segmentfenster.
  const probe = [];
  const schritt = Math.max(1, Math.floor(hochGes / 48));
  let zaehl = 0;
  for (const ph of phasen) {
    if (!ph || !Array.isArray(ph.segments)) continue;
    for (const s of ph.segments) {
      if (!s || !s.from || !s.to || !HOCH[s.type]) continue;
      if (zaehl++ % schritt === 0 && probe.length < 48) probe.push(s);
    }
  }

  const scheitelListe = [];
  for (let i = 0; i < probe.length; i += 6) {
    const teil = probe.slice(i, i + 6);
    const view = createPitchView(fakeCanvas(), { cinematic: false, crowd: false, noise: false, hud: false });
    view.setTeams(matchTeam('h', '#c1272d'), matchTeam('a', '#1c4f8f'));
    view.setFormationPositions();
    view.setSpeed(1);
    const segs = teil.map((s, k) => Object.assign({}, s, {
      t0: k / teil.length, t1: (k + 1) / teil.length
    }));
    const ph = {
      minute: 5, team: 'home', kind: 'angriff',
      ball: [{ x: segs[0].from.x, y: segs[0].from.y, t: 0 }],
      actors: [], duration: 1.2 * teil.length, eventIndex: null, v: 2, segments: segs
    };
    const zMax = teil.map(() => 0);
    let fertig = false;
    const p = view.playPhase(ph).then(() => { fertig = true; });
    let ts = 1000;
    for (let f = 0; f < 900 && !fertig; f++) {
      ts += 16.7; frame(ts);
      const z = view.zustand();
      const idx = Math.min(teil.length - 1, Math.floor(z.phaseT * teil.length));
      if (z.ball.z > zMax[idx]) zMax[idx] = z.ball.z;
      await Promise.resolve();
    }
    await p;
    view.destroy();
    teil.forEach((s, k) => scheitelListe.push({
      typ: s.type, height: s.height, z: zMax[k],
      dist: Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y)
    }));
  }

  const flach = scheitelListe.filter((e) => e.z < 1.0);
  const anteilFlach = scheitelListe.length ? flach.length / scheitelListe.length : 0;
  ok(scheitelListe.length >= 24, 'genug hochfliegende Segmente durch den Renderer geschickt', scheitelListe.length);

  /* Wofür die Bühne geradesteht: sie muss die bestellte Höhe unverfälscht an
   * `ballistik.segmentFlug()` durchreichen und zeichnen, was zurückkommt.
   * Verglichen wird deshalb gegen den Physikkern selbst — nicht gegen die
   * Bestellung. Denn ob der Kern eine Bestellung überhaupt erfüllen KANN, hängt
   * an der Segmentlänge: eine 2,5-m-Flanke über 2 m Distanz erreicht ihren
   * Scheitel erst hinter dem Zielpunkt, und pitch.js schneidet den Flug dort ab.
   * Das ist eine Bestellung, die die Engine so nicht aufgeben sollte — für die
   * Bühne ist es kein Fehler, sondern die Wahrheit des Kerns. */
  const kernScheitel = (e) => {
    // GENAU die Lesart aus `pitch.js buildBallPath()`, sonst misst der Prüfstand
    // etwas anderes als die Bühne zeichnet:
    //   positive Höhe ⇒ auf [HOEHE_MIN, HOEHE_MAX] geklemmt,
    //   height = 0    ⇒ ausdrücklich flach,
    //   Feld fehlt    ⇒ GAR KEINE Vorgabe — der Typ-Loft der Ballistik legt die Bahn.
    // Der dritte Fall kommt seit der Engine-Reparatur wirklich vor; ihn wie
    // früher auf 0 abzubilden machte aus „Physik entscheidet" wieder „flach"
    // und verfälschte genau die Messung, die hier unten steht.
    const opt = { tMax: 4.0 };
    if (typeof e.height === 'number' && isFinite(e.height)) {
      opt.hoehe = e.height > 0 ? Math.min(Math.max(e.height, 0.15), HOEHE_MAX_TEST) : 0;
    }
    const f = ballistik.segmentFlug({ x: 0, y: 0, z: 0 }, { x: e.dist, y: 0, z: 0 }, e.typ, opt);
    const zu = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
    const schritt = 1 / 60;
    let tEnde = f.dauer, sPrev = 0, tPrev = 0;
    for (let t = schritt; t <= f.dauer + 1e-9; t += schritt) {
      f.at(t, zu);
      const s = Math.hypot(zu.x, zu.y);
      if (s >= e.dist) { tEnde = tPrev + (t - tPrev) * ((e.dist - sPrev) / Math.max(1e-9, s - sPrev)); break; }
      tPrev = t; sPrev = s;
    }
    let sch = 0;
    for (let t = 0; t <= tEnde + 1e-9; t += schritt) { f.at(t, zu); if (zu.z > sch) sch = zu.z; }
    f.freigeben();
    return sch;
  };

  const abweichung = scheitelListe.map((e) => Object.assign({ soll: kernScheitel(e) }, e));
  const daneben = abweichung.filter((e) => Math.abs(e.z - e.soll) > Math.max(0.25, e.soll * 0.15));
  ok(daneben.length === 0,
    'die Bühne zeichnet genau den Scheitel, den der Physikkern liefert',
    daneben.length
      ? daneben.slice(0, 3).map((e) => `${e.typ} ${e.dist.toFixed(1)} m: Kern ${e.soll.toFixed(2)} m, Bühne ${e.z.toFixed(2)} m`).join(' · ')
      : `${abweichung.length} Segmente geprüft`);

  const typenListe = (liste) => Object.entries(liste.reduce((a, e) => {
    a[e.typ] = (a[e.typ] || 0) + 1; return a;
  }, {})).map(([t, n]) => `${n}× ${t}`).join(', ');
  info(`in der Stichprobe flach gezeichnet (Scheitel < 1,0 m): ${flach.length} von ${scheitelListe.length}`
    + (flach.length ? ` — ${typenListe(flach)}` : ''));

  /* --- (c) Und jetzt Flanken und Klärungen, jede einzelne -------------- *
   * Die Sichtprüfung des Umbauplans nennt ausdrücklich die Flanke („hängt hoch
   * in der Luft und kommt genau einmal auf"), und die Klärung ist der zweite
   * Typ, für den die Engine ein Scheitelprofil führt. Die Stichprobe oben mischt
   * alle hochfliegenden Arten; hier wird stattdessen JEDES Segment dieser beiden
   * Arten aus dem Echtlauf bewertet. Gerechnet wird über `kernScheitel()`, also
   * über denselben Physikkern — dass die Bühne genau dessen Scheitel zeichnet,
   * hat (b) gerade an der Stichprobe nachgewiesen. */
  const mitHoehe = (e) => typeof e.height === 'number' && isFinite(e.height) && e.height > 0;
  const schnitt = (liste) => (liste.length ? liste.reduce((a, b) => a + b.z, 0) / liste.length : 0);
  const arten = [
    { einzahl: 'Flanke', mehrzahl: 'Flanken', roh: flanken },
    { einzahl: 'Klärung', mehrzahl: 'Klärungen', roh: klaerungen }
  ];
  const anteilJeArt = {};
  for (const art of arten) {
    const bewertet = art.roh.map((e) => ({ hoch: mitHoehe(e), z: kernScheitel(e) }));
    const mit = bewertet.filter((e) => e.hoch);
    const flachA = bewertet.filter((e) => e.z < 1.0);
    anteilJeArt[art.einzahl] = art.roh.length ? flachA.length / art.roh.length : 0;
    info(`${art.mehrzahl} im Echtlauf: ${art.roh.length}, davon mit Höhenvorgabe ${mit.length}`
      + ` (mittlerer Scheitel ${schnitt(mit).toFixed(2)} m)`);
    info(`${art.mehrzahl} flach gezeichnet (Scheitel < 1,0 m): ${flachA.length} von ${art.roh.length}`
      + ` — mittlerer Scheitel aller ${art.mehrzahl} ${schnitt(bewertet).toFixed(2)} m`);
    // Wofür die Bühne geradesteht: ein Segment MIT Höhenvorgabe darf nie flach
    // herauskommen. Was ohne Vorgabe passiert, entscheidet der Typ-Loft des Kerns.
    ok(flachA.every((e) => !e.hoch),
      `keine ${art.einzahl} mit Höhenvorgabe wird flach gezeichnet`,
      `${flachA.filter((e) => e.hoch).length} von ${mit.length}`);
  }
  const flankeAnteil = anteilJeArt['Flanke'];
  const klaerungAnteil = anteilJeArt['Klärung'];

  /* Diese drei Ziele hingen an einer FREMDEN Datei und standen deshalb auf
   * `offen()`. Die Ursache ist behoben: `match.js segment()` schreibt das
   * height-Feld nur noch, wenn `scheitelHoehe()` eine Aussage hat, und Flanke
   * wie Klärung haben ein Scheitelprofil (Flanke 3,0–9,0 m je nach Distanz).
   * Damit ist der Vertragszweig „Feld fehlt ⇒ die Ballistik entscheidet"
   * (§6.2) aus der Engine erreichbar, und die Ziele sind erreicht — also
   * `ok()`, so wie es die Doku von `offen()` vorsieht.
   *
   * Gemessen wurde der Sprung mit dem Lineal dieses Abschnitts über 8
   * Saatfolgen à 3 Spiele (10 743 Segmente, 1 183 Flanken, 259 Klärungen);
   * der Altstand über eine Messkopie mit dem alten `height: o.height || 0`:
   *   Flanken flach   vorher 59,8 % (je Saatfolge 53,1–71,2 %) → nachher 0,0 %
   *                                                    (0,0 % in allen 8)
   *   Klärungen flach vorher 100 %                     → nachher 0,0 %
   *   alle hochfliegenden Arten  vorher 68,3 %         → nachher  9,2 %
   * Was von den 9,2 % übrig bleibt, sind fast nur Kopfbälle: 'kopfball' hat
   * kein Scheitelprofil, und der Typ-Loft trägt gemessen 0,72 m im Mittel —
   * ein Kopfball fliegt eben niedrig. Die 1,0-m-Marke ist für ihn das falsche
   * Lineal, nicht die Bahn das falsche Ergebnis. */
  ok(anteilFlach <= 0.15,
    'höchstens 15 % der hochfliegenden Segmente werden flach gezeichnet',
    `${(anteilFlach * 100).toFixed(1)} % (${flach.length}/${scheitelListe.length})`);
  ok(flankeAnteil <= 0.15,
    'höchstens 15 % der Flanken werden flach gezeichnet',
    `${(flankeAnteil * 100).toFixed(1)} % von ${flanken.length}`);
  ok(klaerungAnteil <= 0.15,
    'höchstens 15 % der Klärungen werden flach gezeichnet',
    `${(klaerungAnteil * 100).toFixed(1)} % von ${klaerungen.length}`);
}

/* ------------------------------------------------------------------ *
 *  Abschluss
 * ------------------------------------------------------------------ */

console.log(`\n${'═'.repeat(66)}`);
if (fehler.length) {
  console.log(`  ${gruen} Prüfungen grün, ${fehler.length} FEHLER:`);
  for (const f of fehler) console.log(`    ✖ ${f}`);
  if (offeneZiele.length) {
    console.log(`  ${offeneZiele.length} offene(s) Ziel(e) in fremden Dateien:`);
    for (const o of offeneZiele) console.log(`    ○ ${o}`);
  }
  console.log('═'.repeat(66));
  process.exit(1);
}
console.log(`  ✔ Alle ${gruen} Prüfungen grün.`);
if (offeneZiele.length) {
  console.log(`  ○ ${offeneZiele.length} offene(s) Ziel(e) — Ursache liegt in einer fremden Datei:`);
  for (const o of offeneZiele) console.log(`    ○ ${o}`);
}
console.log('═'.repeat(66));
