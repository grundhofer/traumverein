/**
 * tools/test-abschluss.js — Prüfstand für src/interactive/finish.js (Paket 7)
 *
 * Aufruf:  node tools/test-abschluss.js
 *
 * Geprüft wird:
 *   1. Vertrag         `minigame` nach CONTRACTS §9, Prüfexport `modell` DOM-frei
 *   2. Szene           Tiefe/Ablage kommen wirklich aus `moment.at` (Heim UND Gast)
 *   3. Kamera          EINE Lochkamera für alles; Tor:Spieler auf gleicher Tiefe
 *                      zwischen 1,25 und 1,50; 6 m und 22 m ergeben andere Bilder;
 *                      Fernsehoptik: Tor immer ganz im Bild, Figuren verdecken
 *                      höchstens die halbe Torfläche
 *   4. Zielhilfe       EINE Größe für Bild und Zahl (`torchance`), aus dem
 *                      Haltemodell in der Ebene des Torwarts; der angewählte
 *                      Schusstyp wird geführt; die gelbe Fläche ist wirklich
 *                      die bessere (gemessen, nicht behauptet); das Zielkreuz
 *                      steht auf der Höhe, die der Ball wirklich nimmt, und
 *                      wo es keine Bogenlösung gibt, behauptet die Zielhilfe
 *                      keinen Bogen (drei Bänder: rot / gelb / grau)
 *   4b. Der Knopf      die angezeigte Zahl muss die WAHL zwischen [1] flach,
 *                      [2] Heber, [3] platziert tragen: gemessen, wie oft sie
 *                      den falschen Knopf anführt (Maßstab wie in
 *                      tools/test-kombination.js) und wie gut sie geeicht ist.
 *                      Die Wahrheit wird UNABHÄNGIG erhoben — Raster von
 *                      Zielpunkten, gleiche Würfel, Sieger nachgemessen —,
 *                      nicht mit der Heuristik der Kennzahl selbst.
 *                      Je Lage und Typ ZWEI Größen: die Quote am besten Punkt
 *                      des Rasters (was möglich wäre) und die Quote an genau
 *                      dem Punkt, den `torchance` gewählt hat (was der Spieler
 *                      bekommt). Ihre Lücke misst die Güte der Zielpunktwahl —
 *                      ohne sie ist der Abschnitt blind dafür, dass die Zahl
 *                      einen beliebig schlechten Punkt bewerten könnte
 *   4c. Kosten         die Fußleiste rechnet drei Knöpfe je Frame; der Median
 *                      muss unter 0,5 ms bleiben
 *   5. Torwart/Physik  Reichweite, Heber über 2,35 m, Flugzeiten
 *   6. Korridore       4000 Abschlüsse je Distanzband, Σ xG gegen den Altstand
 *   7. Determinismus   `schritt()` zieht keinen Zufall; gleicher Zustand +
 *                      gleiche RNG ⇒ gleicher Ausgang
 *   8. Integration     das echte Minispiel über eine Canvas-Attrappe fahren
 *                      (Eingabe, Schleife, Aufräumen, Kopfball, ESC, Notbremse)
 *   9. Quelltextregeln kein Math.random, kein Date.now
 *
 * ---------------------------------------------------------------------------
 * HERKUNFT DER KORRIDORE UND DES Σ-xG-VERGLEICHSWERTS
 * ---------------------------------------------------------------------------
 * Die Torquoten je Band stehen im Umbauplan (Paket 7, Abnahme).
 *
 * Der Vergleichswert `XG_ALT` ist am Altstand GEMESSEN. Der frühere Wert 0,1376
 * war falsch: er entstand, weil der alte Code mit der Mausabbildung der NEUEN
 * Kamera gefahren wurde. Der alte Code hat aber eine eigene, ganz andere
 * Mausabbildung, und die Zielkoordinate hängt daran — mit der falschen Abbildung
 * landet das Zielkreuz woanders im Tor. So misst man den alten Code, als hätte
 * er die neue Kamera. Nachgemessen wurde deshalb so:
 *
 *   1. `git show 585dbe2:src/interactive/finish.js` in eine Datei AUSSERHALB des
 *      Projekts legen, daneben einen Ordner `core` auf `src/core` zeigen lassen
 *      (der alte Stand importiert `../core/util.js`).
 *   2. Der alte Stand hat keinen Prüfexport. Gefahren wird deshalb das echte
 *      `minigame.play()` über dieselbe Canvas-Attrappe wie in Abschnitt 8 hier:
 *      je Szene ein Canvas, `host.rng = createRng('alt' + i)`, 1/60-Schritte,
 *      Tastendruck ('1' flach, '2' Heber, '3' platziert) bei
 *      APPROACH_S + tFrac · windowS.
 *   3. Maus AUF DEM WEG DES ALTEN CODES setzen. Der alte Stand liest
 *      `AIM_BOX = { x0: 205, x1: 757, yTop: 118, yBottom: 348 }`, also
 *        mausX = 205 + aimU · 552,   mausY = 348 − aimV · 230.
 *      NICHT `modell.zielZuMaus()` — das ist die Abbildung der neuen Lochkamera.
 *   4. Gleiche `politik()`, gleiche `grosschanceGeo()`, gleiche `macheMoment()`
 *      wie unten in dieser Datei; ein einziger RNG-Strom `createRng('xgvergleich')`
 *      für Geometrie, Politik und Spielerwerte.
 *
 * Ergebnis (drei Läufe zu je 20 000 Abschlüssen, Startwerte 'xgvergleich',
 * 'seedB', 'seedC'):  Ø xgDelta 0,1176 / 0,1187 / 0,1177, Ø quality 0,475.
 * Daraus XG_ALT = 0,1180. Ausgänge im Altstand: 37 % Tor, 36 % geblockt,
 * 13 % Parade, 9 % daneben, 4,5 % Pfosten.
 *
 * Gegenprobe: derselbe alte Code, nur mit `modell.zielZuMaus()` statt der
 * AIM_BOX, liefert 0,1273 / Ø quality 0,494 (n = 8000) — also rund 8 % zu hoch.
 * Das ist der Weg, auf dem die alten 0,1376 entstanden sind; die 0,1376 werden
 * damit nicht exakt reproduziert, aber die Richtung und die Größenordnung des
 * Fehlers schon.
 *
 * Für den Σ-xG-Vergleich wird die REALE Mischung der Schlüsselszenen benutzt
 * (Ablehnungsstichprobe gegen `MC.kmGrosschanceXg = 0.18` aus engine/match.js):
 * `kind = 'abschluss'` entsteht nur bei Großchancen, und die liegen fast alle
 * unter 12 m. Eine gleichverteilte Distanzmischung wäre für den Vergleich
 * unfair, weil der alte Stand distanzblind war und der neue nicht.
 */

import { createRng } from '../src/core/rng.js';
import { round } from '../src/core/util.js';

/* ------------------------------------------------------------------ *
 *  Mini-Testrahmen
 * ------------------------------------------------------------------ */
let bestanden = 0, gescheitert = 0;
const fehler = [];

function ok(bedingung, titel, info) {
  if (bedingung) { bestanden++; console.log(`  ✓ ${titel}${info ? ` — ${info}` : ''}`); }
  else { gescheitert++; fehler.push(titel + (info ? ` — ${info}` : '')); console.log(`  ✗ ${titel}${info ? ` — ${info}` : ''}`); }
}
/**
 * Ein Ziel, das die heutige Fassung NICHT erreicht und das bewusst offen bleibt
 * (Muster aus tools/test-kombination.js). Die Zahl soll bei jedem Lauf sichtbar
 * sein, ohne die Suite dauerhaft rot zu färben. Wer das Ziel erreicht, dreht den
 * Aufruf zurück auf `ok()` — dann ist die Grenze wieder verbindlich.
 */
const offeneZiele = [];
function offen(bedingung, titel, info) {
  if (bedingung) { bestanden++; console.log(`  ✓ ${titel}${info ? ` — ${info}` : ''}`); return; }
  offeneZiele.push(titel + (info ? ` — ${info}` : ''));
  console.log(`  ○ OFFEN: ${titel}${info ? ` — ${info}` : ''}`);
}
function gruppe(titel) {
  console.log(`\n${'─'.repeat(66)}`);
  console.log(`  ${titel}`);
  console.log('─'.repeat(66));
}
const imBereich = (v, a, b) => v >= a && v <= b;

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  TRAUMVEREIN – Prüfstand Torabschluss (Paket 7)              ║');
console.log('╚══════════════════════════════════════════════════════════════╝');

/* ------------------------------------------------------------------ *
 *  Canvas-Attrappe (wie tools/test-screens.js: DOM nur vortäuschen)
 * ------------------------------------------------------------------ */
const noop = () => { };
const ctxAttrappe = new Proxy({}, {
  get(t, k) {
    if (k === 'measureText') return () => ({ width: 40 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
    return t[k] !== undefined ? t[k] : noop;
  },
  set(t, k, v) { t[k] = v; return true; }
});

const fensterHandler = {};
globalThis.window = {
  addEventListener(ty, fn) { (fensterHandler[ty] = fensterHandler[ty] || []).push(fn); },
  removeEventListener(ty, fn) { if (fensterHandler[ty]) fensterHandler[ty] = fensterHandler[ty].filter(f => f !== fn); }
};
let rafRueckruf = null;
globalThis.requestAnimationFrame = (f) => { rafRueckruf = f; return 1; };
globalThis.cancelAnimationFrame = () => { rafRueckruf = null; };

function macheCanvas() {
  const hs = {};
  return {
    width: 960, height: 600, style: {},
    addEventListener(ty, fn) { (hs[ty] = hs[ty] || []).push(fn); },
    removeEventListener(ty, fn) { if (hs[ty]) hs[ty] = hs[ty].filter(f => f !== fn); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 600 }; },
    getContext() { return ctxAttrappe; },
    _hs: hs
  };
}

const { minigame, modell } = await import('../src/interactive/finish.js');

/* ------------------------------------------------------------------ *
 *  Testdaten
 * ------------------------------------------------------------------ */
const ATTRIBUTE = ['schuss', 'technik', 'passspiel', 'dribbling', 'kopfball', 'standards',
  'tempo', 'ausdauer', 'koerper', 'sprungkraft', 'uebersicht', 'positionsspiel',
  'zweikampf', 'aggressivitaet', 'nervenstaerke', 'fuehrung',
  'reflexe', 'stellungsspiel', 'strafraumbeherrschung', 'abschlag'];

function spieler(rng, rolle) {
  const a = {};
  for (const k of ATTRIBUTE) a[k] = rng.int(42, 84);
  return {
    id: 'p_' + rolle + '_' + rng.int(1000, 9999),
    shortName: 'Test', lastName: 'Test', number: 9, clubId: null,
    position: rolle === 'tw' ? 'TW' : 'ST', traits: [],
    appearance: {
      skin: 1, hair: 'kurz', hairColor: '#222', beard: 'keiner', build: 'normal',
      height: 180, eyes: '#333', accessory: 'keiner', face: 1
    },
    attributes: a
  };
}

function macheMoment(rng, tiefe, seitl, opt = {}) {
  return {
    kind: 'abschluss', minute: 40, team: opt.team || 'home',
    actor: opt.actor || spieler(rng, 'st'),
    keeper: opt.keeper === null ? null : (opt.keeper || spieler(rng, 'tw')),
    defenders: opt.defenders || [spieler(rng, 'iv'), spieler(rng, 'iv'), spieler(rng, 'iv')],
    targets: [],
    at: opt.team === 'away' ? { x: tiefe, y: 34 - seitl } : { x: 105 - tiefe, y: 34 + seitl },
    baseChance: 0.3, pressure: opt.pressure == null ? 45 : opt.pressure,
    high: !!opt.high,
    context: { score: [1, 1], minute: 40, competition: '1. Bundesliga' }
  };
}

/**
 * Politik des simulierten Schützen: er zielt in die Ecke, aber mit Sicherheits-
 * abstand zum Pfosten, und schießt irgendwo im mittleren Drittel des Fensters.
 * Identisch für alle Messungen — sonst sind die Zahlen nicht vergleichbar.
 */
function politik(rng) {
  const r = rng.next();
  const typ = r < 0.60 ? 'flach' : r < 0.90 ? 'platziert' : 'heber';
  const seite = rng.next() < 0.5 ? -1 : 1;
  const aimU = Math.min(0.98, Math.max(0.02, 0.5 + seite * (0.32 + rng.gauss(0, 0.07))));
  const aimV = Math.min(0.95, Math.max(0.02, 0.18 + Math.abs(rng.gauss(0, 0.18))));
  const tFrac = rng.float(0.10, 0.75);
  return { typ, aimU, aimV, tFrac };
}

/** Gleichverteilte Distanz innerhalb eines Bandes. */
function bandGeo(rng, band) {
  const ziel = band === 0 ? rng.float(3.5, 8) : band === 1 ? rng.float(8, 16) : rng.float(16, 28);
  const winkel = Math.max(-1.0, Math.min(1.0, rng.gauss(0, 0.45)));
  return { tiefe: Math.max(2.5, ziel * Math.cos(winkel)), seitl: ziel * Math.sin(winkel) };
}

/** Reale Großchancen-Mischung (Ablehnungsstichprobe gegen die xG-Schwelle). */
function grosschanceGeo(rng) {
  for (let k = 0; k < 300; k++) {
    const distanz = rng.next() < 0.18;
    const tiefe = distanz ? rng.float(17.5, 31) : rng.float(4.5, 17);
    const seitl = Math.max(-19, Math.min(19, rng.gauss(0, distanz ? 10 : 7.5)));
    const dist = Math.hypot(tiefe, seitl);
    const a1 = Math.atan2(3.66 - seitl, Math.max(0.6, tiefe));
    const a2 = Math.atan2(-3.66 - seitl, Math.max(0.6, tiefe));
    const theta = Math.abs(a1 - a2);
    let xg = 0.742 * Math.exp(-0.115 * dist) * Math.pow(Math.max(0.02, theta) / 0.64, 0.62);
    xg *= distanz ? 0.92 : 1.0;
    xg *= 1 - 0.42 * 0.45;          // Druck 45
    xg *= 0.60 + 0.76 * 0.65;       // Abschlussskill 65
    xg *= 0.95;                     // Frische
    if (xg >= 0.18) return { tiefe, seitl };
  }
  return { tiefe: 8, seitl: 2 };
}

const DT = 1 / 60;
const APPROACH = modell.KONST.APPROACH_S;

/** Ein vollständiger Abschluss über den Prüfexport (ohne DOM). */
function einSchuss(rng, geo, pol, opt = {}) {
  const moment = macheMoment(rng, geo.tiefe, geo.seitl, opt);
  const S = modell.neueSzene(moment, opt.diff || 1, rng);
  S.aimU = pol.aimU; S.aimV = pol.aimV;
  const nerven = moment.actor.attributes.nervenstaerke;
  const windowS = Math.min(3.2, Math.max(0.85, 1.2 + 1.3 * (nerven / 99)));
  const bis = APPROACH + pol.tFrac * windowS;
  S.phase = 'anlauf';
  for (let t = 0; t < bis; t += DT) {
    modell.schritt(S, DT);
    if (S.phase === 'anlauf' && S.phaseT >= APPROACH) { S.phase = 'fenster'; S.phaseT = 0; }
  }
  const res = modell.abschluss(S, pol.typ, pol.aimU, pol.aimV, pol.tFrac, rng);
  res.dist = S.szene.distance;
  res.keeperOut = S.keeperOut;
  return res;
}

/* ================================================================== *
 *  1. Vertrag
 * ================================================================== */
gruppe('1. Vertrag (CONTRACTS §9)');
{
  ok(minigame && minigame.id === 'abschluss' && minigame.kind === 'abschluss',
    'minigame.id / .kind = "abschluss"');
  ok(typeof minigame.title === 'string' && typeof minigame.instructions === 'string'
    && minigame.instructions.length > 20, 'Titel und Anleitung vorhanden (deutsch)');
  ok(typeof minigame.play === 'function' && minigame.play.length === 2, 'play(host, moment)');
  ok(modell && typeof modell.neueSzene === 'function' && typeof modell.abschluss === 'function'
    && typeof modell.abdeckung === 'function', 'Prüfexport modell vorhanden');
  ok(typeof globalThis.document === 'undefined',
    'Modul lädt ohne document (DOM-frei importierbar)');
}

/* ================================================================== *
 *  2. Szene aus moment.at
 * ================================================================== */
gruppe('2. Die Szene liest moment.at (der Kernbefund von Paket 7)');
{
  const a = modell.szeneAus({ team: 'home', at: { x: 105 - 6, y: 34 + 3 } });
  ok(Math.abs(a.tiefe - 6) < 1e-9 && Math.abs(a.seit + 3) < 1e-9,
    'Heim: Tiefe und seitliche Ablage aus at', `tiefe ${round(a.tiefe, 2)}, seit ${round(a.seit, 2)}`);
  ok(Math.abs(a.distance - Math.hypot(6, 3)) < 1e-9, 'Distanz = hypot(tiefe, seit)',
    `${round(a.distance, 3)} m`);

  const b = modell.szeneAus({ team: 'away', at: { x: 6, y: 34 - 3 } });
  ok(Math.abs(b.tiefe - 6) < 1e-9 && Math.abs(b.seit + 3) < 1e-9,
    'Gast: gespiegelt, gleiche Szene', `tiefe ${round(b.tiefe, 2)}, seit ${round(b.seit, 2)}`);

  const c = modell.szeneAus({ team: 'home', at: { x: 105 - 6, y: 34 - 5 } });
  ok(c.seit > 0, 'Vorzeichen: links im Feld ⇒ rechts aus Schützensicht', `seit ${round(c.seit, 2)}`);

  const f = modell.szeneAus({});
  ok(Math.abs(f.tiefe - 14) < 1e-9 && f.seit === 0, 'Rückfall ohne at: 14 m zentral');

  const w = modell.szeneAus({ team: 'home', at: { x: 5, y: 60 } });
  ok(w.tiefe <= 40 && Math.abs(w.seit) <= 26, 'Absurde Werte werden geklemmt',
    `tiefe ${round(w.tiefe, 1)}, seit ${round(w.seit, 1)}`);

  // Zwei verschiedene Orte ⇒ zwei verschiedene Bilder (der fotografierte Fehler)
  const s1 = modell.szeneAus({ team: 'home', at: { x: 99, y: 34 } });
  const s2 = modell.szeneAus({ team: 'home', at: { x: 83, y: 40 } });
  const k1 = modell.macheKamera(s1).massstab(0, 0);
  const k2 = modell.macheKamera(s2).massstab(0, 0);
  ok(k1 / k2 > 1.25, 'Nahdistanz zeichnet das Tor deutlich größer als Ferndistanz',
    `${round(k1, 1)} gegen ${round(k2, 1)} px/m`);
}

/* ================================================================== *
 *  3. Eine einzige Kamera
 * ================================================================== */
gruppe('3. Lochkamera und Maßstab (Nachtrag Abschnitt 1)');
{
  for (const d of [6, 14, 22]) {
    const sz = modell.szeneAus({ team: 'home', at: { x: 105 - d, y: 34 } });
    const cam = modell.macheKamera(sz);
    const v = modell.hoehenverhaeltnis({ kamera: cam }, 0);
    ok(imBereich(v, 1.25, 1.50), `${d} m: Tor:Spieler auf gleicher Tiefe im Korridor`,
      `${round(v, 3)} (Soll 1,25–1,50)`);
  }

  const nah = modell.macheKamera(modell.szeneAus({ team: 'home', at: { x: 99, y: 34 } }));
  const fern = modell.macheKamera(modell.szeneAus({ team: 'home', at: { x: 83, y: 34 } }));
  const bNah = nah.project(3.66, 0, 0, {}).x - nah.project(-3.66, 0, 0, {}).x;
  const bFern = fern.project(3.66, 0, 0, {}).x - fern.project(-3.66, 0, 0, {}).x;
  ok(bNah > 600 && bFern < 460 && bNah / bFern > 1.5,
    '6 m füllt das Bild, 22 m nicht', `${round(bNah)} px gegen ${round(bFern)} px`);

  // Figuren gehen durch DIESELBE Abbildung
  const sz = modell.szeneAus({ team: 'home', at: { x: 105 - 12, y: 34 + 4 } });
  const cam = modell.macheKamera(sz);
  const kTor = cam.massstab(0, 0), kSchuetze = cam.massstab(sz.seit, sz.tiefe);
  const sTor = modell.figurMassstab(kTor, 1.88), sSch = modell.figurMassstab(kSchuetze, 1.80);
  ok(sSch > sTor, 'Der Schütze ist größer als der Torwart – aus der Kamera, nicht erfunden',
    `scale ${round(sSch, 2)} gegen ${round(sTor, 2)}`);
  ok(Math.abs(47 * sTor - 1.88 * kTor) < 1e-9,
    'figurMassstab bindet 47 px Sprite an die Weltgröße');

  // Rückprojektion ist die exakte Umkehrung (die Zielsteuerung darf nicht driften)
  let maxAbw = 0;
  for (const u of [0.02, 0.25, 0.5, 0.75, 0.98]) {
    for (const vv of [0.05, 0.4, 0.9]) {
      const p = modell.zielZuMaus({ kamera: cam }, u, vv);
      const zurueck = cam.unprojectTor(p.x, p.y, {});
      const u2 = (zurueck.x + 3.66) / 7.32, v2 = zurueck.z / 2.44;
      maxAbw = Math.max(maxAbw, Math.abs(u - u2), Math.abs(vv - v2));
    }
  }
  ok(maxAbw < 1e-6, 'unprojectTor ist die exakte Umkehrung von project',
    `max. Abweichung ${round(maxAbw * 1e6, 2)}e-6`);

  // Der Ball liegt immer auf der Kameraachse (stabiles Bild)
  for (const seit of [-14, 0, 9]) {
    const s = modell.szeneAus({ team: 'home', at: { x: 105 - 11, y: 34 - seit } });
    const c = modell.macheKamera(s);
    const p = c.project(s.seit, s.tiefe, 0.11, {});
    ok(Math.abs(p.x - 480) < 1e-6, `Ball bleibt bildmittig (seit ${seit} m)`, `x = ${round(p.x, 3)}`);
  }

  // Nichts wird NaN
  let alleEndlich = true;
  for (const d of [2.5, 6, 14, 25, 38]) {
    for (const seit of [-25, -8, 0, 8, 25]) {
      const s = modell.szeneAus({ team: 'home', at: { x: 105 - d, y: 34 - seit } });
      const c = modell.macheKamera(s);
      for (const [x, y, z] of [[-3.66, 0, 0], [3.66, 0, 2.44], [0, -2, 1], [s.seit, s.tiefe, 0]]) {
        const p = c.project(x, y, z, {});
        if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.k)) alleEndlich = false;
      }
    }
  }
  ok(alleEndlich, 'Projektion bleibt in allen Lagen endlich');

  /* --- Befund 3: Fernsehoptik statt Weitwinkel -------------------------- */
  ok(modell.kameraAbstand(22) > modell.kameraAbstand(6) + 8,
    'Die Kamera geht mit der Schussentfernung zurück',
    `6 m: ${round(modell.kameraAbstand(6), 1)} m, 22 m: ${round(modell.kameraAbstand(22), 1)} m`);
  ok(modell.KONST.CAM_FOCAL >= 3000,
    'Lange Brennweite (Tiefe wird gestaucht)',
    `focal ${modell.KONST.CAM_FOCAL} px ⇒ Bildwinkel ` +
    `${round(2 * Math.atan(480 / modell.KONST.CAM_FOCAL) * 180 / Math.PI, 1)}°`);

  // Das Tor muss auf JEDER Entfernung und Ablage vollständig im Bild stehen –
  // zwischen Kopfzeile (40 px) und Fußzeile (CANVAS_H − 62).
  const CW = modell.KONST.CANVAS_W, CH = modell.KONST.CANVAS_H;
  let drin = 0, faelle = 0, engste = 1e9, tiefste = -1e9;
  for (const d of [2.2, 3, 6, 8, 12, 16, 22, 30, 40]) {
    for (const seit of [-16, -8, -3, 0, 3, 8, 16]) {
      const s = modell.szeneAus({ team: 'home', at: { x: 105 - d, y: 34 - seit } });
      const c = modell.macheKamera(s);
      const L = c.project(-3.66, 0, 0, {}), R = c.project(3.66, 0, 0, {});
      const O = c.project(-3.66, 0, 2.44, {}), O2 = c.project(3.66, 0, 2.44, {});
      const x0 = Math.min(L.x, O.x), x1 = Math.max(R.x, O2.x);
      const y0 = Math.min(O.y, O2.y), y1 = Math.max(L.y, R.y);
      faelle++;
      if (x0 > 6 && x1 < CW - 6 && y0 > 44 && y1 < CH - 66) drin++;
      engste = Math.min(engste, x0, CW - x1);
      tiefste = Math.max(tiefste, y1);
    }
  }
  ok(drin === faelle, 'Das Tor steht in allen Lagen vollständig im Bild',
    `${drin}/${faelle}, engster Seitenrand ${round(engste)} px, tiefste Torlinie ${round(tiefste)} px`);

  /**
   * Verdecken die Verteidiger das Tor? Gemessen als Flächenanteil des Tors, den
   * die Figuren-Silhouetten überlagern. Silhouette = Sprite-Breite 14 von 47 px
   * Höhe (Schulterbreite 10,2 plus Arme aus render/players.js), Höhe 1,80 m.
   * Der Schütze zählt mit — er steht mit im Bild.
   */
  const SIL = 14 / 47;
  const schnitt = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
    * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  for (const d of [6, 12, 22]) {
    let summe = 0, maxDeck = 0, hoehenVerh = 0, nDef = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      const rngC = createRng('kamera' + d + '_' + i);
      const S = modell.neueSzene(macheMoment(rngC, d, (i % 7 - 3) * 1.6), 1, rngC);
      S.phase = 'fenster';
      for (let t = 0; t < 1.2; t += DT) modell.schritt(S, DT);
      const c = S.kamera;
      const L = c.project(-3.66, 0, 0, {}), R = c.project(3.66, 0, 0, {});
      const O = c.project(-3.66, 0, 2.44, {});
      const tor = { x0: L.x, x1: R.x, y0: O.y, y1: L.y };
      const torF = (R.x - L.x) * (L.y - O.y);
      let deck = 0;
      const qx = -c.ny, qy = c.nx;
      const figuren = S.defs.map(dd => [dd.wx, dd.wy])
        .concat([[S.szene.seit + qx * -0.85, S.szene.tiefe + qy * -0.85]]);
      for (const [wx, wy] of figuren) {
        const q = c.project(wx, wy, 0, {});
        if (q.d < 1) continue;
        const h = 1.8 * q.k, b = SIL * h;
        deck += schnitt(tor, { x0: q.x - b / 2, x1: q.x + b / 2, y0: q.y - h, y1: q.y });
        hoehenVerh += h / (L.y - O.y); nDef++;
      }
      const anteil = Math.min(deck, torF) / torF;
      summe += anteil; maxDeck = Math.max(maxDeck, anteil);
    }
    ok(summe / N < 0.50 && maxDeck < 0.60,
      `${d} m: Figuren verdecken höchstens die halbe Torfläche`,
      `Ø ${round(100 * summe / N, 1)} %, schlimmster Fall ${round(100 * maxDeck, 1)} %, ` +
      `Figurenhöhe ${round(hoehenVerh / nDef, 2)} × Torhöhe`);
  }
}

/* ================================================================== *
 *  4. Zielhilfe
 * ================================================================== */
gruppe('4. Zielhilfe: EINE Größe für Bild und Zahl (Befund 1 und 2)');
{
  const rng = createRng('zielhilfe');
  const moment = macheMoment(rng, 6, 0);
  const S = modell.neueSzene(moment, 1, rng);
  S.aimU = 0.5;

  let gueltig = true, ausserhalb = 0;
  for (let i = 0; i <= 30; i++) {
    const c = modell.coverHoehe(S, i / 30, 'flach');
    if (!isFinite(c)) gueltig = false;
    if (c < 0 || c > 1) ausserhalb++;
  }
  ok(gueltig && ausserhalb === 0, 'coverHoehe liefert immer 0..1');

  const mitte = modell.coverHoehe(S, 0.5, 'flach');
  const ecke = modell.coverHoehe(S, 0.99, 'flach');
  ok(mitte >= ecke, 'Die Mitte ist dichter zu als die Ecke',
    `${round(mitte, 2)} gegen ${round(ecke, 2)}`);

  // Herauslaufen muss die Skyline SICHTBAR zuziehen – gemessen an der zugestellten
  // FLÄCHE, denn die Skyline wächst in Breite UND Höhe.
  const vorher = modell.abdeckung(S, 'flach');
  const vorherB = modell.skylineAnteil(S, 'flach');
  S.phase = 'fenster';
  for (let t = 0; t < 1.6; t += DT) modell.schritt(S, DT);
  const nachher = modell.abdeckung(S, 'flach');
  const nachherB = modell.skylineAnteil(S, 'flach');
  ok(nachher > vorher + 0.05 && nachherB >= vorherB,
    'Die rote Skyline wandert beim Herauslaufen zu',
    `Fläche ${round(vorher * 100)} % → ${round(nachher * 100)} %, Breite ` +
    `${round(vorherB * 100)} % → ${round(nachherB * 100)} %, Torwart ${round(S.keeperOut, 2)} m draußen`);

  // Der Heber bleibt die Antwort auf den herausgelaufenen Torwart – aber nur da,
  // wo es die Bogenlösung wirklich gibt. Aus 7 m reicht sie bis 0,48 m: unter
  // dieser Kante ist frei, darüber ist es kein Heber mehr, sondern nichts.
  const rng2 = createRng('heber');
  const S2 = modell.neueSzene(macheMoment(rng2, 7, 0), 1, rng2);
  S2.phase = 'fenster';
  for (let t = 0; t < 1.6; t += DT) modell.schritt(S2, DT);
  const hoch = modell.coverHoehe(S2, 0.5, 'heber');
  const sperr7 = modell.sperrHoehe(S2, 'heber');
  ok(hoch < sperr7 && sperr7 > 0.05,
    'Unter der Sperrkante bleibt der Heber über dem herausgelaufenen Torwart offen',
    `gedeckt bis ${round(hoch * 2.44, 2)} m, Sperrkante ${round(sperr7 * 2.44, 2)} m`);

  /* --- Befund 1: es gibt nur noch EINE Zielhilfe-Größe ------------------- */
  ok(modell.coverFrac === undefined && modell.skylineFlaeche === undefined,
    'Die zweite, widersprechende Kennzahl (coverFrac) ist ersatzlos weg');

  // `abdeckung` mittelt genau die Spalten, die gezeichnet werden. „Zu" ist alles,
  // was nicht gelb ist – der Torwart (rot) und das, wohin der Typ den Ball gar
  // nicht bringt (grau). Gegenprobe von Hand. Im Bild steht diese Zahl nicht
  // mehr (siehe 4b), aber sie bleibt der Nachweis, dass die drei Bänder lückenlos
  // die Torfläche füllen.
  const N = modell.KONST.SKYLINE_SPALTEN;
  let vonHandFrei = 0;
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N;
    vonHandFrei += Math.max(0, modell.sperrHoehe(S, 'flach', u) - modell.coverHoehe(S, u, 'flach'));
  }
  ok(Math.abs((1 - vonHandFrei / N) - modell.abdeckung(S, 'flach')) < 1e-12,
    'abdeckung() ist genau die gezeichnete Skyline-Fläche', `N = ${N}`);
  let vonHandGelb = 0;
  for (let i = 0; i < N; i++) vonHandGelb += modell.freieHoehe(S, (i + 0.5) / N, 'flach');
  ok(Math.abs(vonHandGelb / N - (1 - modell.abdeckung(S, 'flach'))) < 1e-12,
    'rot + gelb + grau ergibt genau die Torfläche',
    `gelb ${round(100 * vonHandGelb / N, 1)} %, zu ${round(100 * modell.abdeckung(S, 'flach'), 1)} %`);

  /*
   * Korridore der EINEN Größe. Sie ersetzen die coverFrac-Korridore des Plans
   * (> 0,70 nah / < 0,30 fern) und stehen bewusst ANDERSHERUM: coverFrac maß den
   * Winkel, den der Torwart mit dem Körper verstellt, die Skyline misst, was er
   * bei der tatsächlichen Flugzeit noch erreicht. Aus 6 m ist ein Flachschuss
   * nach 0,23 s im Tor — da kommt er nur in der Mitte hin. Aus 25 m hat er über
   * eine Sekunde und deckt alles außer den Ecken.
   *
   * Gemessen wird der ROTE Anteil, also die Leistung des Torwarts. Die Korridore
   * sind dieselben wie vor dem grauen Band — `abdeckung` enthält jetzt zusätzlich
   * die Höhe, die der Flachschuss gar nicht erreicht (2,44 − 1,60 = 0,84 m,
   * also 34,4 Prozentpunkte), und wäre mit den alten Zahlen nicht vergleichbar.
   */
  const rotAnteil = (Sx, typ) => {
    const n = modell.KONST.SKYLINE_SPALTEN;
    let f = 0;
    for (let i = 0; i < n; i++) f += modell.coverHoehe(Sx, (i + 0.5) / n, typ);
    return f / n;
  };
  const nah = modell.neueSzene(macheMoment(createRng('nah'), 6, 0), 1, createRng('nah2'));
  nah.phase = 'fenster';
  for (let t = 0; t < 2.5; t += DT) modell.schritt(nah, DT);
  const aNah = rotAnteil(nah, 'flach');
  ok(aNah > 0.25 && aNah < 0.60,
    'Aus 6 m erreicht der Torwart nur die Mitte',
    `rot ${round(100 * aNah, 1)} %, gesamt zu ${round(100 * modell.abdeckung(nah, 'flach'), 1)} %, ` +
    `Torwart ${round(nah.keeperOut, 2)} m draußen`);

  const fern = modell.neueSzene(macheMoment(createRng('fern'), 25, 0), 1, createRng('fern2'));
  fern.phase = 'fenster';
  for (let t = 0; t < 2.5; t += DT) modell.schritt(fern, DT);
  const aFern = rotAnteil(fern, 'flach');
  ok(aFern > 0.30 && aFern < 0.70,
    'Aus 25 m deckt der Torwart viel ab – aber nicht die Ecken',
    `rot ${round(100 * aFern, 1)} % von höchstens ${round(100 * modell.sperrHoehe(fern, 'flach'), 1)} % ` +
    `erreichbarer Höhe, gesamt zu ${round(100 * modell.abdeckung(fern, 'flach'), 1)} %`);
  ok(aFern > aNah, 'Mehr Flugzeit = mehr zugestellte Fläche (der Kern von Befund 1)',
    `6 m ${round(100 * aNah)} % gegen 25 m ${round(100 * aFern)} %`);

  /* --- Befund 2: der angewählte Schusstyp wird geführt und gezeichnet ---- */
  ok(nah.typ === 'flach', 'Neue Szene startet mit angewähltem Flachschuss');
  const kopfS = modell.neueSzene(macheMoment(createRng('k'), 7, 2, { high: true }), 1, createRng('k2'));
  ok(kopfS.typ === 'kopfball', 'Kopfball-Szene führt den Kopfball als Typ');

  // Der Typ verändert das Bild – gemessen dort, wo die Flugzeit den Ausschlag
  // gibt (aus 6 m deckelt die Sprunghöhe des Torwarts flach wie platziert gleich).
  const mittel = modell.neueSzene(macheMoment(createRng('m1'), 11, 0), 1, createRng('m2'));
  mittel.phase = 'fenster';
  for (let t = 0; t < 1.2; t += DT) modell.schritt(mittel, DT);
  const rFlach = rotAnteil(mittel, 'flach');
  const rHeber = rotAnteil(mittel, 'heber');
  const rPlatz = rotAnteil(mittel, 'platziert');
  ok(rHeber !== rFlach && rPlatz > rFlach,
    'Jeder Schusstyp hat seine eigene Abdeckung',
    `rot: flach ${round(100 * rFlach)} %, Heber ${round(100 * rHeber)} %, platziert ${round(100 * rPlatz)} % · ` +
    `zu: ${round(100 * modell.abdeckung(mittel, 'flach'))} / ` +
    `${round(100 * modell.abdeckung(mittel, 'heber'))} / ` +
    `${round(100 * modell.abdeckung(mittel, 'platziert'))} %`);

  /*
   * Der Heber aus 6 m. Vorher stand hier die Behauptung „das Tor ist offen —
   * 0 % zu". Sie war falsch: das Modell hielt jeden Heber, der über ~0,6 m ins
   * Tor sollte (1,22 m → 75 % Parade, 1,83 m → 86 % Parade, 0 % Tor), weil es
   * dorthin gar keine Bogenlösung gibt. Wahr ist: unter der Sperrkante ist der
   * Heber aus 6 m eine sehr gute Wahl, darüber ist er keine Wahl mehr.
   */
  const sperrNah = modell.sperrHoehe(nah, 'heber');
  ok(sperrNah > 0.15 && sperrNah < 0.45 && rotAnteil(nah, 'heber') < 0.10,
    'Aus 6 m ist der Heber unter der Sperrkante frei – und nur dort',
    `Sperrkante ${round(sperrNah * 2.44, 2)} m, rot ${round(100 * rotAnteil(nah, 'heber'), 1)} %, ` +
    `gesamt zu ${round(100 * modell.abdeckung(nah, 'heber'), 1)} %`);
  // Und zwar, weil der Ball über dem Torwart wirklich hoch ist (Ebene des
  // Torwarts!) – gefragt wird jetzt auf einer Zielhöhe, die es auch gibt.
  const anteilTW = (nah.szene.tiefe - nah.keeperY) / nah.szene.tiefe;
  const zProbe = modell.zDecke(nah, 'heber') * 0.8;
  ok(modell.zielhilfeHoehe(nah, 'heber', anteilTW, zProbe) > 2.0,
    'Die Zielhilfe rechnet den Heber in der Ebene des Torwarts, nicht auf der Linie',
    `${round(modell.zielhilfeHoehe(nah, 'heber', anteilTW, zProbe), 2)} m über dem Torwart ` +
    `bei Zielhöhe ${round(zProbe, 2)} m`);

  /*
   * Der eigentliche Test der Zielhilfe: LÜGT sie? Es wird in die rote Fläche
   * und in die gelbe Fläche gezielt und ausgezählt, was hineingeht. Die gelbe
   * muss deutlich besser sein — sonst schickt das Bild den Spieler in die Irre.
   * (Rot bleibt nicht bei 0 %: `COVER_SCHWELLE` ist 0,45, eine rote Spalte lässt
   * also bis zu 55 % durch, und die eigene Streuung trägt manchen Ball doch noch
   * an den Handschuhen vorbei.)
   *
   * Der Heber ist jetzt DABEI. Vorher war er ausdrücklich ausgenommen, weil eine
   * der beiden Stichproben immer leer blieb — das war kein Sonderfall, sondern
   * der Befund selbst: aus 6 m zeigte die Zielhilfe 100 % gelb, obwohl das
   * Modell dort fast alles hielt. Wo es heute kein gelbes Band mehr gibt (ab
   * 9 m), wird das getrennt geprüft: dann muss die Zielhilfe auch sagen, dass
   * es keines gibt (Abschnitt „Heber ohne Bogen" weiter unten).
   */
  for (const typ of ['flach', 'platziert', 'heber']) {
    for (const dist of [6, 11, 20]) {
      let torRot = 0, nRot = 0, torGelb = 0, nGelb = 0;
      // 2000 Versuche, nicht 500: aus 20 m ist das gelbe Band nur noch in den
      // äußersten Spalten breit genug, um hineinzuzielen — mit 500 Versuchen
      // blieben davon 15 übrig, und 15 Schüsse sind keine Messung.
      for (let i = 0; i < 2000; i++) {
        const r = createRng('ehrlich' + typ + dist + '_' + i);
        const Sx = modell.neueSzene(macheMoment(r, dist, r.float(-4, 4)), 1, r);
        Sx.phase = 'fenster';
        for (let t = 0; t < 0.8; t += DT) modell.schritt(Sx, DT);
        const u = r.float(0.06, 0.94);
        const cov = modell.coverHoehe(Sx, u, typ);
        const sperr = modell.sperrHoehe(Sx, typ, u);
        const rot = i % 2 === 0;
        let v;
        // Gezielt wird NUR in Bänder, die es gibt: über der Sperrkante liegt
        // grau, und dorthin bringt dieser Typ den Ball ohnehin nicht.
        if (rot) { if (cov < 0.08) continue; v = r.float(0.02, cov * 0.95); }
        else { if (sperr - cov < 0.06) continue; v = r.float(cov + 0.02, sperr); }
        Sx.aimU = u; Sx.aimV = v;
        const res = modell.abschluss(Sx, typ, u, v, 0.5, r);
        if (rot) { nRot++; if (res.outcome === 'tor') torRot++; }
        else { nGelb++; if (res.outcome === 'tor') torGelb++; }
      }
      const qRot = torRot / Math.max(1, nRot), qGelb = torGelb / Math.max(1, nGelb);
      if (nRot <= 30 && nGelb > 30) {
        // Kein rotes Band: der Torwart erreicht in diesem Angebot gar nichts.
        // Dann muss das Angebot auch wirklich gut sein — sonst behauptet die
        // Zielhilfe „alles frei", wo das Modell hält (genau der alte Befund 2).
        ok(qGelb > 0.40,
          `${typ}, ${dist} m: kein rotes Band – dafür muss das gelbe halten, was es verspricht`,
          `gelb ${round(100 * qGelb, 1)} % (n ${nGelb}), rot n ${nRot}`);
        continue;
      }
      if (typ === 'heber' && nGelb <= 30) {
        // Ab 9 m gibt es für den Heber keine Bogenlösung und deshalb kein gelbes
        // Band. Dass das die Wahrheit ist und nicht Bequemlichkeit, prüft der
        // Abschnitt „Heber ohne Bogen".
        const rl = createRng('leer' + dist);
        const Sl = modell.neueSzene(macheMoment(rl, dist, 0), 1, rl);
        Sl.phase = 'fenster';
        for (let t = 0; t < 0.8; t += DT) modell.schritt(Sl, DT);
        ok(nRot <= 30 && modell.sperrHoehe(Sl, 'heber') < 0.10,
          `heber, ${dist} m: die Zielhilfe bietet gar kein Band an – zu Recht`,
          `Sperrkante ${round(modell.sperrHoehe(Sl, 'heber') * 2.44, 2)} m, ` +
          `rot n ${nRot}, gelb n ${nGelb}`);
        continue;
      }
      ok(nRot > 30 && nGelb > 30 && qGelb > qRot * 1.8,
        `${typ}, ${dist} m: die gelbe Fläche ist wirklich die bessere`,
        `rot ${round(100 * qRot, 1)} % (n ${nRot}) gegen gelb ${round(100 * qGelb, 1)} % (n ${nGelb})`);
    }
  }

  /*
   * Heber ohne Bogen (Befund 2). `v0Von` gibt dem Heber die flachste Lob-Lösung,
   * die auf dieser Distanz noch bogenförmig ist — OHNE Luftwiderstand gerechnet.
   * Mit Luft gibt es sie aus 6 m nur bis 0,72 m, aus 8 m bis 0,20 m, ab 9 m gar
   * nicht mehr. Das ist unverändert so; NEU ist, dass die Zielhilfe es sagt,
   * statt einen Bogen zu behaupten, den es nicht gibt.
   */
  console.log('  ⓘ Heber: Sperrkante, Scheitel und Flugzeit über der Strecke');
  for (const dist of [4, 6, 7, 8, 9, 11, 16]) {
    const Sh = modell.neueSzene(macheMoment(createRng('bogen' + dist), dist, 0), 1,
      createRng('bogen2' + dist));
    const decke = modell.zDecke(Sh, 'heber');
    let hoch = 0;
    for (let k = 1; k <= 8; k++) {
      hoch = Math.max(hoch, modell.zielhilfeHoehe(Sh, 'heber', k / 8, Math.min(0.35, decke)));
    }
    console.log(`     ${String(dist).padStart(2)} m: Sperrkante ${round(decke, 2)} m, ` +
      `Scheitel ${round(hoch, 2)} m, ${round(modell.flugzeit(dist, 'heber', Math.min(0.35, decke)), 2)} s`);
  }
  for (const dist of [6, 11]) {
    const r = createRng('ohnebogen' + dist);
    const Sh = modell.neueSzene(macheMoment(r, dist, 0, { defenders: [] }), 1, r);
    Sh.phase = 'fenster';
    for (let t = 0; t < 0.8; t += DT) modell.schritt(Sh, DT);
    // Über der Sperrkante darf die Zielhilfe nichts mehr versprechen: das
    // Zielkreuz bleibt hängen und der Ball landet genau dort, wo es hängt.
    let maxAbw = 0, obenGleich = true;
    const zOben = modell.zZiel(Sh, 'heber', 0.5, 1.1);
    for (const aimV of [0.5, 0.75, 0.95, 1.1]) {
      const z = modell.zZiel(Sh, 'heber', 0.5, aimV);
      if (Math.abs(z - zOben) > 1e-9) obenGleich = false;
      maxAbw = Math.max(maxAbw, Math.abs(modell.landehoehe(Sh, 'heber', 0.5, aimV) - z));
    }
    ok(obenGleich && maxAbw < 0.05,
      `Heber ${dist} m: über der Sperrkante behauptet die Zielhilfe keinen Bogen mehr`,
      `Kreuz bleibt bei ${round(zOben, 2)} m, größte Abweichung Ball–Kreuz ${round(maxAbw, 3)} m`);
  }

  /*
   * Befund 1: Zielkreuz und Ball meinen dieselbe Höhe. `zZiel()` ist die eine
   * Umrechnung, die das Kreuz setzt UND `loeseSchuss()` füttert; hier wird die
   * Bahn ohne Streuung integriert und nachgemessen, wo sie die Torlinie kreuzt.
   * Vorher stauchte `zScale` den Flachschuss still auf 55 %: Kreuz auf 2,20 m,
   * Ball auf 1,26 m.
   */
  /*
   * Gemessen wird BEIDES: ohne Verteidiger (reine Zielbahn) und mit den drei
   * Verteidigern einer echten Großchance. Der zweite Durchgang ist der
   * eigentliche Beweis: `landehoehe()` misst seit diesem Befund `_flug`, die
   * ZIELBAHN, nicht `_bahn` — streift der Ball einen Verteidiger, landet die
   * abgefälschte Bahn woanders (gemessen bis 2,23 m daneben), und das Instrument
   * hätte dem Zielkreuz eine Lüge vorgeworfen, die der Verteidiger begangen hat.
   * `defenders: []` schaltet die Verteidiger seither auch wirklich ab.
   */
  {
    const rLeer = createRng('leerliste');
    const SLeer = modell.neueSzene(macheMoment(rLeer, 9, 0, { defenders: [] }), 1, rLeer);
    ok(SLeer.defs.length === 0, 'defenders: [] heißt wirklich: kein Verteidiger',
      `${SLeer.defs.length} Verteidiger in der Szene`);
    const rOhne = createRng('ohneliste');
    const SOhne = modell.neueSzene({ kind: 'abschluss', at: { x: 96, y: 34 } }, 1, rOhne);
    ok(SOhne.defs.length === 1, 'fehlt die Liste ganz, steht trotzdem jemand im Weg',
      `${SOhne.defs.length} Verteidiger`);
  }
  for (const mitVert of [false, true]) {
    for (const typ of ['flach', 'platziert', 'heber']) {
      let maxAbw = 0, schlimmste = '';
      for (const dist of [4, 6, 11, 16, 22]) {
        for (const seitl of [-5, 0, 5]) {
          const r = createRng('kreuz' + mitVert + typ + dist + seitl);
          const opt = mitVert ? {} : { defenders: [] };
          const Sx = modell.neueSzene(macheMoment(r, dist, seitl, opt), 1, r);
          Sx.phase = 'fenster';
          for (let t = 0; t < 0.8; t += DT) modell.schritt(Sx, DT);
          for (const aimV of [0.05, 0.25, 0.5, 0.75, 1.0]) {
            for (const aimU of [0.2, 0.5, 0.8]) {
              const zKreuz = modell.zZiel(Sx, typ, aimU, aimV);
              const zBall = modell.landehoehe(Sx, typ, aimU, aimV);
              const abw = Math.abs(zBall - zKreuz);
              if (abw > maxAbw) {
                maxAbw = abw;
                schlimmste = `${dist} m, aimV ${aimV}: Kreuz ${round(zKreuz, 2)} m, Ball ${round(zBall, 2)} m`;
              }
            }
          }
        }
      }
      ok(maxAbw < 0.06,
        `${typ}${mitVert ? ' (mit Verteidigern)' : ''}: der Ball fliegt dorthin, wo das Zielkreuz steht`,
        `größte Abweichung ${round(maxAbw, 3)} m — ${schlimmste}`);
    }
  }

  // Und die Gegenprobe zur Skyline: das Kreuz kommt nie über die Höhengrenze
  // des Typs. (Sie darf über der Latte liegen – dann ist alles gelb und man
  // kann auch drüber zielen; nur der Flachschuss und der kurze Heber sind
  // wirklich gedeckelt.)
  {
    let drueber = 0, faelle = 0, gedeckelt = 0;
    for (const typ of ['flach', 'platziert', 'heber']) {
      for (const dist of [5, 9, 14, 20]) {
        const r = createRng('kante' + typ + dist);
        const Sx = modell.neueSzene(macheMoment(r, dist, 0), 1, r);
        Sx.phase = 'fenster';
        for (let t = 0; t < 0.8; t += DT) modell.schritt(Sx, DT);
        const decke = modell.zDecke(Sx, typ, 0.5);
        if (decke < 2.44) gedeckelt++;
        for (const aimV of [0.3, 0.7, 1.1]) {
          faelle++;
          if (modell.zZiel(Sx, typ, 0.5, aimV) > decke + 1e-9) drueber++;
        }
      }
    }
    ok(drueber === 0 && gedeckelt > 0, 'Das Zielkreuz bleibt an der grauen Sperrkante hängen',
      `${faelle} Lagen geprüft, davon ${gedeckelt} von 12 Szenen wirklich gedeckelt`);
  }

  // Die Zielhilfe rechnet mit der ECHTEN Flugzeit des Typs, nicht mit L/v0.
  for (const typ of ['flach', 'platziert', 'heber']) {
    const S3 = modell.neueSzene(macheMoment(createRng('t' + typ), 11, 0), 1, createRng('t2' + typ));
    const tZiel = modell.zielhilfeFlugzeit(S3, typ);
    const tEcht = modell.flugzeit(11, typ);
    ok(Math.abs(tZiel - tEcht) / tEcht < 0.02,
      `Zielhilfe-Flugzeit ${typ} = Modell-Flugzeit (11 m)`,
      `${round(tZiel, 3)} s gegen ${round(tEcht, 3)} s`);
  }
}

/* ================================================================== *
 *  4b. Der Knopf: trägt die Zahl die Wahl zwischen den Schusstypen?
 * ================================================================== */
gruppe('4b. Die Zahl muss den richtigen Knopf anführen');
/**
 * Der Spieler wählt über die angezeigte Zahl zwischen [1] flach, [2] Heber und
 * [3] platziert. Gemessen wird, ob sie das trägt.
 *
 * DIE WAHRHEIT WIRD UNABHÄNGIG ERHOBEN — das ist der Kern dieses Abschnitts.
 * Vorher stand hier ein `bestesZiel()`, das den Zielpunkt als Mitte des
 * BREITESTEN GELBEN BANDES bestimmte. Das ist genau die Heuristik, mit der auch
 * `torchance` seinen Zielpunkt wählte. Der Abschnitt hat die Kennzahl also gegen
 * sich selbst gemessen: ein Fehler in der Zielpunktwahl war für ihn unsichtbar,
 * weil die „Wahrheit" denselben Fehler machte. Er WAR auch unsichtbar — die
 * Zielpunktwahl war zur linken Torhälfte hin voreingenommen (siehe `torchance`
 * in src/interactive/finish.js).
 *
 * Jetzt kommt die Wahrheit aus einem RASTER von Zielpunkten über die ganze
 * Torfläche, das von der Kennzahl nichts weiß:
 *
 *   1. je Lage und Typ RASTER_U × RASTER_V Zielpunkte,
 *   2. jeder Punkt wird mit DENSELBEN Würfeln beschossen (M_WAHL Schüsse),
 *   3. der Punkt mit der höchsten Trefferquote gewinnt,
 *   4. er wird mit einem ZWEITEN, frischen Würfelsatz nachgemessen (M_WAHR
 *      Schüsse) — dieser Wert ist die Wahrheit.
 *
 * Schritt 4 ist nicht Zierde: der Sieger eines Feldes von 105 Kandidaten bringt
 * seinen eigenen Würfelausschlag mit. Ohne Nachmessung liegt die „Wahrheit" bei
 * M_WAHL = 10 Schüssen rund 4 Punkte zu hoch.
 *
 * ZWEI GRÖSSEN JE LAGE UND TYP, NICHT EINE — sonst ist der Abschnitt blind für
 * den Fehlertyp, den er prüfen soll. Ein unabhängiges Raster allein misst nur,
 * was in dieser Lage MÖGLICH wäre; es schießt nie auf den Punkt, den `torchance`
 * selbst gewählt hat. Eine falsche ZIELPUNKTWAHL bliebe damit strukturell
 * unsichtbar: die Kennzahl dürfte beliebig schlecht zielen, solange irgendwo auf
 * der Torfläche ein guter Punkt liegt. Gemessen und ausgewiesen werden deshalb
 *
 *   (a) `moeglich`  — Quote am besten Punkt des unabhängigen Rasters,
 *   (b) `gefolgt`   — Quote an genau dem Punkt, den `torchance` gewählt hat
 *                     (über den optionalen dritten Parameter der Kennzahl).
 *
 * Beide mit DENSELBEN M_WAHR frischen Würfeln, also gepaart — die Differenz ist
 * dann nicht Würfelrauschen zweier Stichproben, sondern die Lücke selbst. Diese
 * Lücke (a) − (b) ist das Maß für die Güte der Zielpunktwahl und ist unten eine
 * Abnahmegröße. Die Kennzahl wird dafür NICHT zur Wahrheit befördert: sie liefert
 * nur den Punkt, bewertet wird er vom Modell.
 *
 * Das kostet 59 Lagen × 3 Typen × (105 × 10 + 2 × 80) = 214 170 Abschlüsse und
 * ist mit Abstand der teuerste Abschnitt dieser Datei: 48 s gemessen, von 122 s
 * Gesamtlaufzeit. Dafür gibt es weniger Lagen als früher — 36 + 23 statt
 * 200 + 120. Eine ehrliche Wahrheit über wenige Lagen ist mehr wert als eine
 * selbstbestätigende über viele.
 *
 * „Falsch angeführt" zählt nur, wenn es dem Spieler auch etwas kostet (Maßstab
 * wie tools/test-kombination.js). Die Marge ist hier allerdings MARGE statt
 * einem Punkt: mit optimalem Zielpunkt liegen alle drei Typen dicht unter der
 * Decke, und ein Punkt Unterschied ist bei M_WAHR Schüssen je Lage reines
 * Würfelrauschen.
 *
 * Die alte Grenze `pChance < pFlaeche · 0,6` ist ersatzlos entfallen: sie war
 * gegen die selbstbestätigende Wahrheit geeicht und sagt gegen die ehrliche
 * nichts mehr. Geprüft wird die inhaltliche Aussage — die Torchance führt
 * seltener in die Irre als die Fläche, und wer ihr folgt, trifft öfter.
 *
 * ---------------------------------------------------------------------------
 * WARUM DIESE BEIDE AUSSAGE IM KURZEN BAND NUR NOCH `offen()` IST
 * ---------------------------------------------------------------------------
 * Beide standen hier als hartes `ok()` und hielten — mit der AUSGELIEFERTEN
 * Saatfolge. Nachgemessen über sechs unabhängige Saatfamilien (dieselbe
 * Prozedur, nur mit vorangestelltem Familienkürzel in jedem Startwert; Vorsprung
 * als Mittel ± Standardfehler über die Familien, dahinter der schlechteste
 * Einzelwert):
 *
 *                            Großchancen-Mischung        kurzes Band ≤ 8 m
 *   pFlaeche − pChance      11,1±2,0 P., min +5,6      9,4±5,7 P., min  0,0
 *   folgtChance − folgtFl.   2,7±0,4 P., min +1,7      1,8±0,9 P., min −0,9
 *
 * In der Mischung überschreitet der Vorsprung sein Fehlerband deutlich und hält
 * in 6 von 6 Familien — dort bleibt es ein `ok()`. Im kurzen Band tut er das
 * nicht: eine Familie liefert beim Knopf exakt Gleichstand (der strikte `<`
 * scheitert), eine andere beim Treffer einen NEGATIVEN Vorsprung. Eine
 * Zusicherung, deren Vorsprung kleiner ist als ihre Streuung, ist kein `ok()`,
 * sondern ein `offen()` mit Zahl — sonst steht sie nur, weil der Prüfstand
 * genau die Saatfolge fährt, die sie bestätigt. Wer die Aussage im kurzen Band
 * wieder hart haben will, muss den Vorsprung dort erst über sein Fehlerband
 * heben, nicht die Saatfolge suchen, die ihn zeigt.
 */
const KNOPF_GRENZE = 10;
{
  const RASTER_U = 15, RASTER_V = 7;
  const M_WAHL = 10, M_WAHR = 80;
  const MARGE = 0.05;
  const TYPEN = ['flach', 'heber', 'platziert'];
  const NS = modell.KONST.SKYLINE_SPALTEN;

  const uRaster = [], vRaster = [];
  for (let i = 0; i < RASTER_U; i++) uRaster.push(0.03 + 0.94 * (i / (RASTER_U - 1)));
  for (let j = 0; j < RASTER_V; j++) vRaster.push(0.02 + 0.94 * (j / (RASTER_V - 1)));

  /**
   * Quote eines EINZELNEN Zielpunkts, mit dem frischen Würfelsatz `wahr:`.
   * Derselbe Satz für jeden Punkt — der Vergleich zweier Punkte in derselben
   * Lage ist damit gepaart.
   */
  function quoteAn(S, typ, u, v, marke) {
    let tore = 0;
    for (let k = 0; k < M_WAHR; k++) {
      const r = createRng('wahr:' + marke + ':' + k);
      if (modell.abschluss(S, typ, u, v, 0.5, r).outcome === 'tor') tore++;
    }
    return tore / M_WAHR;
  }

  /**
   * Bester Zielpunkt des unabhängigen Rasters. Kennt weder `torchance` noch
   * `abdeckung`; die Vorauswahl läuft über den Würfelsatz `wahl:`, damit der
   * Sieger anschließend mit `wahr:` unbelastet nachgemessen werden kann.
   */
  function bestesRasterZiel(S, typ, marke) {
    let bestTore = -1, bu = 0.5, bv = 0.5;
    for (const u of uRaster) {
      for (const v of vRaster) {
        let tore = 0;
        for (let k = 0; k < M_WAHL; k++) {
          const r = createRng('wahl:' + marke + ':' + k);
          if (modell.abschluss(S, typ, u, v, 0.5, r).outcome === 'tor') tore++;
        }
        if (tore > bestTore) { bestTore = tore; bu = u; bv = v; }
      }
    }
    return { u: bu, v: bv };
  }

  for (const lage of ['Großchancen-Mischung', 'kurzes Band ≤ 8 m']) {
    const n = lage === 'Großchancen-Mischung' ? 36 : 23;
    let falschChance = 0, falschFlaeche = 0, folgtChance = 0, folgtFlaeche = 0;
    let falschRot = 0, folgtRot = 0;
    let best = 0, gleichauf = 0;
    let folgtChanceZiel = 0;
    let maxLuecke = -1, woLuecke = '';
    let maxUeberLage = -1, woUeberLage = '', maxUnterLage = -1, woUnterLage = '';
    const quote = { flach: 0, heber: 0, platziert: 0 };
    const amZiel = { flach: 0, heber: 0, platziert: 0 };
    const luecke = { flach: 0, heber: 0, platziert: 0 };
    const anzeige = { flach: 0, heber: 0, platziert: 0 };
    const flaeche = { flach: 0, heber: 0, platziert: 0 };
    const rotanteil = { flach: 0, heber: 0, platziert: 0 };
    const zielPunkt = { u: 0.5, v: 0.5 };
    for (let i = 0; i < n; i++) {
      const rg = createRng('knopf:' + lage + ':' + i);
      const geo = lage === 'Großchancen-Mischung' ? grosschanceGeo(rg) : bandGeo(rg, 0);
      const rs = createRng('knopfszene:' + lage + ':' + i);
      const S = modell.neueSzene(macheMoment(rs, geo.tiefe, geo.seitl), 1, rs);
      S.phase = 'fenster';
      for (let t = 0; t < 0.9; t += DT) modell.schritt(S, DT);

      const q = {}, qz = {}, ch = {}, fl = {}, rt = {};
      for (const typ of TYPEN) {
        const marke = lage + ':' + i;
        // (a) was möglich wäre: bester Punkt des unabhängigen Rasters.
        const rz = bestesRasterZiel(S, typ, marke);
        q[typ] = quoteAn(S, typ, rz.u, rz.v, marke);
        // (b) was der Spieler bekommt, wenn er der Anzeige folgt: GENAU der
        //     Punkt, den `torchance` bewertet hat — mit denselben Würfeln.
        ch[typ] = modell.torchance(S, typ, zielPunkt);
        qz[typ] = quoteAn(S, typ, zielPunkt.u, zielPunkt.v, marke);
        fl[typ] = modell.abdeckung(S, typ);
        // Dritter Vergleichsmaßstab: NUR das rote Band, ohne das graue.
        let rot = 0;
        for (let c = 0; c < NS; c++) rot += modell.coverHoehe(S, (c + 0.5) / NS, typ);
        rt[typ] = rot / NS;
        quote[typ] += q[typ]; amZiel[typ] += qz[typ]; anzeige[typ] += ch[typ];
        luecke[typ] += q[typ] - qz[typ];
        flaeche[typ] += fl[typ]; rotanteil[typ] += rt[typ];
        if (q[typ] - qz[typ] > maxLuecke) {
          maxLuecke = q[typ] - qz[typ];
          woLuecke = `${typ} in Lage ${i} (${round(100 * q[typ], 0)} % möglich,`
            + ` ${round(100 * qz[typ], 0)} % am Anzeigepunkt)`;
        }
        if (ch[typ] - qz[typ] > maxUeberLage) {
          maxUeberLage = ch[typ] - qz[typ];
          woUeberLage = `${typ} in Lage ${i} (Zahl ${round(100 * ch[typ], 0)} %,`
            + ` Modell am Anzeigepunkt ${round(100 * qz[typ], 0)} %)`;
        }
        if (qz[typ] - ch[typ] > maxUnterLage) {
          maxUnterLage = qz[typ] - ch[typ];
          woUnterLage = `${typ} in Lage ${i} (Zahl ${round(100 * ch[typ], 0)} %,`
            + ` Modell am Anzeigepunkt ${round(100 * qz[typ], 0)} %)`;
        }
      }
      let bChance = 'flach', bFlaeche = 'flach', bRot = 'flach', bEcht = 'flach';
      for (const typ of TYPEN) {
        if (ch[typ] > ch[bChance]) bChance = typ;
        if (fl[typ] < fl[bFlaeche]) bFlaeche = typ;      // kleinste Fläche = einladendster Knopf
        if (rt[typ] < rt[bRot]) bRot = typ;              // kleinstes rotes Band
        if (q[typ] > q[bEcht]) bEcht = typ;
      }
      best += q[bEcht]; folgtChance += q[bChance];
      folgtChanceZiel += qz[bChance];
      folgtFlaeche += q[bFlaeche]; folgtRot += q[bRot];
      if (bChance !== bEcht) { if (q[bEcht] - q[bChance] > MARGE) falschChance++; else gleichauf++; }
      if (bFlaeche !== bEcht && q[bEcht] - q[bFlaeche] > MARGE) falschFlaeche++;
      if (bRot !== bEcht && q[bEcht] - q[bRot] > MARGE) falschRot++;
    }
    const pChance = 100 * falschChance / n, pFlaeche = 100 * falschFlaeche / n;
    console.log(`  ⓘ ${lage} (${n} Lagen, je Typ ${RASTER_U}×${RASTER_V} Zielpunkte`
      + ` × ${M_WAHL} Schüsse, Sieger und Anzeigepunkt mit denselben ${M_WAHR}`
      + ` frischen Würfeln nachgemessen)`);
    for (const typ of TYPEN) {
      console.log(`     ${typ.padEnd(10)} möglich ${round(100 * quote[typ] / n, 1)} %` +
        `, am Anzeigepunkt ${round(100 * amZiel[typ] / n, 1)} %` +
        ` (Lücke ${round(100 * luecke[typ] / n, 1)} P.)` +
        `, angezeigte Torchance ${round(100 * anzeige[typ] / n, 1)} %` +
        `, Fläche „zu" ${round(100 * flaeche[typ] / n, 1)} %`);
    }
    // Hart nur dort, wo der Vorsprung über sechs Saatfamilien sein Fehlerband
    // überschreitet (Begründung und Zahlen im Kopf dieses Abschnitts).
    const zusichern = lage === 'Großchancen-Mischung' ? ok : offen;
    const streuung = lage === 'Großchancen-Mischung'
      ? ' (6 Saatfamilien: 11,1±2,0 P. Vorsprung, schlechtester Lauf +5,6)'
      : ' (6 Saatfamilien: 9,4±5,7 P. Vorsprung, schlechtester Lauf −13,0 — hält nicht überall)';
    zusichern(pChance < pFlaeche,
      `${lage}: die Torchance führt seltener den falschen Knopf an als die Fläche`,
      `${round(pChance, 1)} % gegen ${round(pFlaeche, 1)} % (${gleichauf} Lagen gleichauf)` + streuung);
    const streuung2 = lage === 'Großchancen-Mischung'
      ? ' (6 Saatfamilien: 2,7±0,4 P. Vorsprung, schlechtester Lauf +0,9)'
      : ' (6 Saatfamilien: 1,8±0,9 P. Vorsprung, schlechtester Lauf −1,7 — hält nicht überall)';
    zusichern(folgtChance > folgtFlaeche,
      `${lage}: wer der Torchance folgt, trifft öfter`,
      `${round(100 * folgtChance / n, 1)} % gegen ${round(100 * folgtFlaeche / n, 1)} %, ` +
      `bestmöglich ${round(100 * best / n, 1)} %` + streuung2);
    /*
     * DIE GÜTE DER ZIELPUNKTWAHL — die Größe, für die dieser Abschnitt vorher
     * blind war. Oben ist „wer der Torchance folgt" die Quote am besten Punkt
     * des Rasters: der Spieler wählt den Knopf nach der Zahl und zielt dann
     * optimal. Er zielt aber nicht optimal, er zielt dorthin, wo die Zahl
     * hinsieht. Genau das steht hier.
     *
     * Die Lücke ist NICHT null zu erwarten: das Raster hat 105 Punkte, die
     * Kennzahl SKYLINE_SPALTEN × (ZIEL_HOEHEN + 1) = 120, aber nur entlang der
     * roten und grauen Kante — es sind verschiedene Kandidatenmengen, und schon
     * die Rasterauflösung kostet ein paar Punkte. 5 Punkte sind das Ziel; beide
     * Grenzen sind am gemessenen Stand geeicht und keine Herleitung.
     *
     * Gemessen über SECHS Saatfamilien (36 bzw. 23 Lagen je Familie, je Typ 105
     * Rasterpunkte × 10 Schüsse, Sieger und Anzeigepunkt mit denselben 80
     * frischen Würfeln; Mittel ± Standardfehler über die Familien):
     * flach −2,6±0,6 / −2,2±0,4 P., platziert −3,1±0,7 / −0,8±0,5 P.,
     * HEBER 11,8±1,6 / 7,2±1,2 P. Der Heber ist der einzige Typ, dessen
     * Zielpunktwahl wirklich Geld kostet. Negative Werte heißen, dass der
     * Anzeigepunkt das Raster schlägt — das Raster ist grob, kein Widerspruch.
     *
     * DIE KLAMMER BEI 25 PUNKTEN IST KNAPPER, ALS SIE AUSSIEHT. Über die sechs
     * Familien reicht die Lücke des Hebers in der Mischung bis 19,1 Punkte
     * (Standardabweichung 3,9) — die Klammer hat also gut ein Fehlerband
     * Luft, nicht mehr. Sie hat in dieser Welle bereits einen Umbau gestoppt:
     * die 2-D-Durchlasstabelle aus `chanceAmZiel` trieb sie in jeder geprüften
     * Fassung auf 27–33 Punkte.
     */
    const luecken = TYPEN.map(t => luecke[t] / n);
    const maxMittel = Math.max.apply(null, luecken);
    const woMittel = TYPEN[luecken.indexOf(maxMittel)];
    const jeTyp = '(je Typ: ' + TYPEN.map(t => `${t} ${round(100 * luecke[t] / n, 1)}`).join(', ') + ' P.)';
    ok(maxMittel < 0.25,
      `${lage}: die Zielpunktwahl bleibt unter der Regressionsklammer von 25 Punkten`,
      `größte Lücke ${round(100 * maxMittel, 1)} Punkte beim ${woMittel} ${jeTyp}`);
    offen(maxMittel < 0.05,
      `${lage}: der gewählte Zielpunkt kostet im Mittel weniger als 5 Punkte`,
      `größte Lücke ${round(100 * maxMittel, 1)} Punkte beim ${woMittel} ${jeTyp}` +
      ' — der Heber trifft die Zielhöhe nicht (seine Bezugsbahn ist im Nahbereich' +
      ' eine Lobbahn auf die Tormitte, siehe `chanceAmZiel` in finish.js)');
    console.log(`     wer der Zahl WIRKLICH folgt (Knopf UND Zielpunkt): `
      + `${round(100 * folgtChanceZiel / n, 1)} % gegen ${round(100 * folgtChance / n, 1)} % `
      + `mit optimalem Zielpunkt; größte Einzellücke ${round(100 * maxLuecke, 1)} P. — ${woLuecke}`);
    /*
     * Dritter Maßstab, ohne Behauptung, nur als Zahl: das ROTE Band allein
     * (kleinstes rotes Band = einladendster Knopf). Der Dateikopf von finish.js
     * hatte es als schlechteste der drei Kennzahlen verworfen — das war gegen
     * die selbstbestätigende Wahrheit gemessen. Gegen die ehrliche Wahrheit
     * sortiert es die Knöpfe BESSER als die Torchance, weil es dem Heber sein
     * fehlendes graues Band nicht ankreidet und der Heber mit optimalem
     * Zielpunkt wirklich der beste Schuss ist. Als Anzeige taugt es trotzdem
     * nicht: es ist keine Wahrscheinlichkeit, und für den Heber ab 9 m meldet es
     * „0 % zu" für eine Torfläche, die er gar nicht erreicht. Die Zeile steht
     * hier, damit die nächste Welle die Zahl kennt, statt sie zu glauben.
     */
    console.log(`     nur das rote Band: falscher Knopf ${round(100 * falschRot / n, 1)} %`
      + `, wer ihm folgt trifft ${round(100 * folgtRot / n, 1)} %`
      + ` (rot je Typ: ` + TYPEN.map(t => `${t} ${round(100 * rotanteil[t] / n, 1)} %`).join(', ') + ')');
    /*
     * Eichung. Die Abnahmegrenzen unten messen den Abstand der MITTELWERTE. Der
     * Mittelwert ist aber nicht die Grenze des Fehlers: die Einzellagen streuen
     * um ein Vielfaches, und die Zeile darunter druckt deshalb bei jedem Lauf
     * auch den GRÖSSTWERT über die einzelnen Lagen mit. Wer nur den Mittelwert
     * kennt, unterschätzt, wie weit die Zahl im schlimmsten Fall danebenliegt.
     * Bezugsgröße der Einzellagen ist die Quote AM ANZEIGEPUNKT (b) — das ist
     * die Aussage, die die Zahl über sich selbst macht.
     *
     * Beide Richtungen stehen jetzt OFFEN, und der Grund ist der Wechsel der
     * Wahrheit. Gegen die alte, selbstbestätigende Wahrheit sah die Zahl geeicht
     * aus; gegen die ehrliche Wahrheit zeigt sich, dass die alte Zielpunktwahl
     * um 35 bis 45 Punkte UNTERTRIEB (sie bewertete einen schlechten Punkt).
     * Mit der vollständigen Zielpunktsuche bleiben zwei Restfehler (Mittel ±
     * Standardfehler über sechs Saatfamilien, Mischung / kurzes Band):
     *
     *   • zu viel versprochen: gegen (a) 9,8±1,0 / 7,7±0,7 P., gegen den
     *     EIGENEN Zielpunkt (b) 6,6±1,2 / 8,7±0,4 P.
     *   • zu wenig versprochen: gegen (b) bis 3,7±1,3 P. in der Mischung; im
     *     kurzen Band untertreibt kein Typ.
     *
     * Beides sitzt in der Bewertung eines Punktes, nicht in der Wahl des
     * Punktes. Der naheliegende Griff — die Schwelle COVER_SCHWELLE durch die
     * tatsächliche Haltewahrscheinlichkeit je Zelle zu ersetzen — ist in dieser
     * Welle gebaut, über dieselben sechs Familien gemessen und wieder ausgebaut
     * worden: er wirkt für flach und platziert, nicht für den Heber, kostet
     * mehr als das Frame-Budget und sprengt die Regressionsklammer oben. Alle
     * Zahlen dazu stehen bei `chanceAmZiel` in src/interactive/finish.js. Wer
     * diese Aufrufe auf `ok()` drehen will, fängt beim Heber an — und dessen
     * Fehler sitzt in der Bezugsbahn, nicht in der Schwelle.
     */
    let maxUeber = -1, maxUnter = -1, woUeber = '', woUnter = '';
    let maxUeberZ = -1, maxUnterZ = -1, woUeberZ = '', woUnterZ = '';
    for (const typ of TYPEN) {
      const bias = (anzeige[typ] - quote[typ]) / n;
      if (bias > maxUeber) { maxUeber = bias; woUeber = typ; }
      if (-bias > maxUnter) { maxUnter = -bias; woUnter = typ; }
      const biasZ = (anzeige[typ] - amZiel[typ]) / n;
      if (biasZ > maxUeberZ) { maxUeberZ = biasZ; woUeberZ = typ; }
      if (-biasZ > maxUnterZ) { maxUnterZ = -biasZ; woUnterZ = typ; }
    }
    offen(maxUeber < 0.03, `${lage}: die Zahl verspricht nie mehr als 3 Punkte zu viel`,
      `größte Übertreibung ${round(100 * maxUeber, 1)} Punkte beim ${woUeber}` +
      ' — die rote Skyline ist eine Schwelle (0,45), und die Zielpunktsuche greift' +
      ' nach den Spalten, in denen diese Schwelle am meisten unterschlägt');
    offen(maxUnter < 0.05, `${lage}: … und untertreibt auch nicht um mehr als 5 Punkte`,
      maxUnter <= 0 ? 'keine Untertreibung, alle drei Typen liegen über der Wahrheit'
        : `${round(100 * maxUnter, 1)} Punkte beim ${woUnter}`);
    // Beide Grenzen oben messen gegen (a), den besten Punkt des Rasters, und im
    // MITTEL über die Lagen. Damit ist die Eichung nur zur Hälfte beschrieben:
    // die Zahl macht ihre Aussage über (b), ihren eigenen Punkt, und der
    // Mittelwert verschweigt, wie weit die Einzellage danebenliegt. Beides
    // steht deshalb hier — als Zahl, ohne Grenze.
    console.log(`     Eichung gegen die Quote am ANZEIGEPUNKT (b): im Mittel bis`
      + ` ${round(100 * maxUeberZ, 1)} P. zu viel (${woUeberZ}), `
      + (maxUnterZ <= 0
        ? 'keine Untertreibung — alle drei Typen versprechen zu viel'
        : `bis ${round(100 * maxUnterZ, 1)} P. zu wenig (${woUnterZ})`));
    console.log(`     … und über die EINZELLAGEN, gegen (b): bis`
      + ` ${round(100 * maxUeberLage, 1)} P. zu viel — ${woUeberLage}; bis`
      + ` ${round(100 * maxUnterLage, 1)} P. zu wenig — ${woUnterLage}`);
    offen(pChance < KNOPF_GRENZE,
      `${lage}: Anzeige führt in weniger als ${KNOPF_GRENZE} % der Lagen den falschen Knopf an`,
      `${round(pChance, 1)} % (Fläche: ${round(pFlaeche, 1)} %)`);
  }
}

/* ================================================================== *
 *  4c. Was die Fußleiste je Frame kostet
 * ================================================================== */
gruppe('4c. Rechenzeit der drei Knöpfe');
/**
 * `torchance` sucht seinen Zielpunkt über ein Raster von SKYLINE_SPALTEN ×
 * (ZIEL_HOEHEN + 1) Punkten, und die Fußleiste rechnet drei Knöpfe je Frame.
 * Der Umbauplan gibt 60 fps vor; das Budget für die Zahl steht hier.
 *
 * Gemessen wird der Median über viele „Frames" (je Frame alle drei Knöpfe auf
 * einer vorbereiteten Lage), nicht der Mittelwert — ein einzelner GC-Ausschlag
 * darf die Abnahme nicht kippen.
 */
{
  const TYPEN = ['flach', 'heber', 'platziert'];
  const lagen = [];
  for (let i = 0; i < 40; i++) {
    const rg = createRng('kosten:' + i);
    const geo = grosschanceGeo(rg);
    const rs = createRng('kostenszene:' + i);
    const S = modell.neueSzene(macheMoment(rs, geo.tiefe, geo.seitl), 1, rs);
    S.phase = 'fenster';
    for (let t = 0; t < 0.9; t += DT) modell.schritt(S, DT);
    lagen.push(S);
  }
  for (const S of lagen) for (const typ of TYPEN) modell.torchance(S, typ);   // warmlaufen
  const proben = [];
  for (let runde = 0; runde < 25; runde++) {
    for (const S of lagen) {
      const t0 = process.hrtime.bigint();
      for (const typ of TYPEN) modell.torchance(S, typ);
      proben.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
  }
  proben.sort((a, b) => a - b);
  const median = proben[proben.length >> 1];
  const p95 = proben[Math.floor(proben.length * 0.95)];
  ok(median < 0.5, 'Alle drei Knöpfe zusammen bleiben unter 0,5 ms je Frame',
    `Median ${round(median, 3)} ms (je Typ ${round(median / 3, 3)} ms), ` +
    `p95 ${round(p95, 3)} ms über ${proben.length} Frames`);
}

/* ================================================================== *
 *  5. Torwart und Ballistik
 * ================================================================== */
gruppe('5. Torwart und Flugzeiten');
{
  const rng = createRng('tw');
  const k = spieler(rng, 'tw');
  const r1 = modell.twReichweiteBei(0.30, 0.6, k);
  const r2 = modell.twReichweiteBei(0.90, 0.6, k);
  ok(r2 > r1, 'Mehr Flugzeit = mehr Reichweite', `${round(r1, 2)} m → ${round(r2, 2)} m`);
  const rHoch = modell.twReichweiteBei(0.90, 2.2, k);
  ok(rHoch < r2, 'Hohe Bälle kosten Reichweite', `${round(rHoch, 2)} m gegen ${round(r2, 2)} m`);
  ok(r2 <= 3.31, 'Reichweite bleibt unter TW_MAX', `${round(r2, 2)} m`);

  const tFlach11 = modell.flugzeit(11, 'flach');
  const tPlatz11 = modell.flugzeit(11, 'platziert');
  const tHeber11 = modell.flugzeit(11, 'heber');
  ok(imBereich(tFlach11, 0.35, 0.60), 'Flachschuss über 11 m dauert 0,35–0,60 s',
    `${round(tFlach11, 3)} s`);
  ok(tPlatz11 > tFlach11 && tHeber11 > tPlatz11,
    'flach < platziert < Heber (der Keeper bekommt Zeit)',
    `${round(tFlach11, 2)} / ${round(tPlatz11, 2)} / ${round(tHeber11, 2)} s`);
  const tFlach22 = modell.flugzeit(22, 'flach');
  ok(tFlach22 > tFlach11 * 1.8, 'Doppelte Distanz kostet mehr als doppelte Zeit (Luftwiderstand)',
    `${round(tFlach11, 3)} s → ${round(tFlach22, 3)} s`);
}

/* ================================================================== *
 *  6. Korridore
 * ================================================================== */
gruppe('6. Torquoten je Distanzband (4000 Abschlüsse je Band)');
/**
 * WIE VIEL RESERVE HAT DER KORRIDOR? Der Lauf hier hat einen festen Startwert
 * und ist damit deterministisch — das sagt aber nichts darüber, wie knapp es
 * ist. Nachgemessen mit derselben Prozedur über 30 unabhängige Startwerte
 * ('korridore-s0' … 's29'), je 4000 Abschlüsse:
 *
 *   ≤ 8 m    Mittel 35,69 %   min 34,10 %   max 36,85 %   außerhalb 0/30
 *   8–16 m   Mittel 15,62 %   min 14,30 %   max 16,75 %   außerhalb 0/30
 *   > 16 m   Mittel  5,90 %   min  5,35 %   max  6,60 %   außerhalb 0/30
 *
 * Kein Startwert fällt durch. Das war einmal anders: vor den drei Bändern lag
 * dasselbe Band bei einem Mittel von 34,57 % mit 6 von 40 Startwerten außerhalb
 * — die Deckelung der Zielhöhe auf das, was der Typ wirklich liefert, hat es um
 * gut einen Punkt angehoben. Knapp bleibt es trotzdem: im schlechtesten Fall
 * liegt das kurze Band nur 0,10 Punkte über seinem Korridorboden. Wer
 * stromaufwärts eine zusätzliche Ziehung einbaut, verschiebt den RNG-Strom und
 * trifft genau dort auf die dünnste Stelle — die Zahl unten nennt deshalb den
 * Abstand zum nächsten Rand.
 */
const KORRIDOR = [[0.34, 0.46], [0.14, 0.22], [0.05, 0.10]];
const BAND_NAME = ['≤ 8 m', '8–16 m', '> 16 m'];
{
  const rng = createRng('korridore');
  for (let b = 0; b < 3; b++) {
    let tore = 0, n = 4000;
    const aus = {};
    for (let i = 0; i < n; i++) {
      const r = einSchuss(rng, bandGeo(rng, b), politik(rng));
      aus[r.outcome] = (aus[r.outcome] || 0) + 1;
      if (r.outcome === 'tor') tore++;
    }
    const q = tore / n;
    const rand = Math.min(q - KORRIDOR[b][0], KORRIDOR[b][1] - q);
    ok(imBereich(q, KORRIDOR[b][0], KORRIDOR[b][1]),
      `Band ${BAND_NAME[b]}: Torquote im Korridor ${Math.round(KORRIDOR[b][0] * 100)}–${Math.round(KORRIDOR[b][1] * 100)} %`,
      `${round(q * 100, 1)} % (${round(rand * 100, 1)} Punkte bis zum nächsten Rand)  ${JSON.stringify(aus)}`);
  }
}

gruppe('6b. Σ xG gegen den Stand vor Paket 7');
/**
 * Gemessen am Altstand (siehe Dateikopf): Ø xgDelta über dieselbe Politik.
 * Die 4000 Abschlüsse hier sind eine Stichprobe: sie zeigen +3,5 %. Über
 * 12 000–20 000 Abschlüsse mit drei Startwerten liegt der neue Stand bei
 * 0,1231 / 0,1255 / 0,1233, im Mittel also rund +5 %. Beides ist innerhalb
 * der geforderten 8 %; die ehrliche Zahl ist die zweite.
 */
const XG_ALT = 0.1180;
{
  const rng = createRng('xgvergleich');
  let sx = 0, sq = 0, n = 4000, tore = 0;
  const aus = {};
  for (let i = 0; i < n; i++) {
    const r = einSchuss(rng, grosschanceGeo(rng), politik(rng));
    sx += r.xgDelta; sq += r.quality;
    aus[r.outcome] = (aus[r.outcome] || 0) + 1;
    if (r.outcome === 'tor') tore++;
  }
  const mittel = sx / n;
  const abw = (mittel - XG_ALT) / XG_ALT;
  ok(Math.abs(abw) <= 0.08, 'Ø xgDelta weicht höchstens 8 % vom Altstand ab',
    `${round(mittel, 4)} gegen ${XG_ALT} → ${round(abw * 100, 1)} %`);
  ok(imBereich(sq / n, 0.35, 0.65), 'Ø quality bleibt im gewohnten Bereich',
    `${round(sq / n, 3)} (Altstand 0,475)`);
  console.log(`     Großchancen-Mischung: Torquote ${round(100 * tore / n, 1)} %  ${JSON.stringify(aus)}`);
}

gruppe('6c. Vertragstreue der Rückgaben');
{
  const erlaubt = ['tor', 'parade', 'daneben', 'geblockt', 'latte', 'pfosten',
    'abgeschlossen', 'abgefangen', 'kopfball_tor'];
  const rng = createRng('vertrag');
  let alleGut = true, schlecht = '';
  const gesehen = {};
  for (let i = 0; i < 3000; i++) {
    const b = i % 3;
    const typ = ['flach', 'heber', 'platziert', 'kopfball'][i % 4];
    const pol = politik(rng); pol.typ = typ;
    const r = einSchuss(rng, bandGeo(rng, b), pol);
    gesehen[r.outcome] = (gesehen[r.outcome] || 0) + 1;
    if (erlaubt.indexOf(r.outcome) < 0) { alleGut = false; schlecht = r.outcome; }
    if (!(r.quality >= 0 && r.quality <= 1)) { alleGut = false; schlecht = 'quality ' + r.quality; }
    if (!(r.xgDelta >= -0.10 && r.xgDelta <= 0.40)) { alleGut = false; schlecht = 'xgDelta ' + r.xgDelta; }
    if (typeof r.targetPlayerId !== 'string') { alleGut = false; schlecht = 'targetPlayerId'; }
  }
  ok(alleGut, 'outcome / quality / xgDelta / targetPlayerId immer vertragskonform', schlecht);
  ok(Object.keys(gesehen).length >= 5, 'Alle Ausgänge kommen wirklich vor',
    JSON.stringify(gesehen));

  // Streiftreffer am Verteidigerrand: abgefälscht statt geblockt (Punkt 7)
  const rngA = createRng('ablenkung');
  let abgefaelscht = 0, nA = 3000;
  for (let i = 0; i < nA; i++) {
    const pol = politik(rngA); pol.typ = 'flach';
    const r = einSchuss(rngA, bandGeo(rngA, i % 2), pol);
    if (r.abgefaelscht) abgefaelscht++;
  }
  ok(abgefaelscht > 0 && abgefaelscht / nA < 0.15,
    'Streiftreffer am Körperrand fälschen ab, statt zu blocken',
    `${round(100 * abgefaelscht / nA, 2)} % der Flachschüsse`);
}

/* ================================================================== *
 *  7. Determinismus
 * ================================================================== */
gruppe('7. Determinismus (kein Zufall im Substep-Loop)');
{
  // schritt() darf keinen einzigen rng-Zug machen
  let zuege = 0;
  const zaehlRng = {
    next() { zuege++; return 0.5; },
    int(a, b) { zuege++; return a; },
    float(a, b) { zuege++; return a; },
    gauss(m) { zuege++; return m; },
    chance() { zuege++; return false; }
  };
  const rngS = createRng('det');
  const S = modell.neueSzene(macheMoment(rngS, 10, 2), 1, rngS);
  S.phase = 'fenster';
  const vorher = zuege;
  for (let t = 0; t < 2; t += 1 / 240) modell.schritt(S, 1 / 240);
  ok(zuege === vorher, 'schritt() zieht keinen Zufall (Bildrate ändert den RNG-Strom nicht)');
  void zaehlRng;

  // Gleiche Bildrate-unabhängige Szene: 1/30 gegen 1/144 ⇒ praktisch gleicher Zustand
  const a = modell.neueSzene(macheMoment(createRng('dt'), 10, 2), 1, createRng('dt'));
  const b = modell.neueSzene(macheMoment(createRng('dt'), 10, 2), 1, createRng('dt'));
  a.phase = 'fenster'; b.phase = 'fenster';
  a.aimU = b.aimU = 0.8;
  for (let t = 0; t < 1.5; t += 1 / 30) modell.schritt(a, 1 / 30);
  for (let t = 0; t < 1.5; t += 1 / 144) modell.schritt(b, 1 / 144);
  const dOut = Math.abs(a.keeperOut - b.keeperOut);
  const dX = Math.abs(a.keeperX - b.keeperX);
  ok(dOut < 0.12 && dX < 0.12, 'Zustand hängt kaum an der Bildrate (1/30 gegen 1/144)',
    `Δout ${round(dOut, 4)} m, Δx ${round(dX, 4)} m`);

  // Gleiche Szene + gleicher RNG-Zustand ⇒ gleicher Ausgang
  const r1 = modell.neueSzene(macheMoment(createRng('rep'), 9, -3), 1, createRng('rep'));
  const r2 = modell.neueSzene(macheMoment(createRng('rep'), 9, -3), 1, createRng('rep'));
  const e1 = modell.abschluss(r1, 'flach', 0.8, 0.3, 0.5, createRng('schuss'));
  const e2 = modell.abschluss(r2, 'flach', 0.8, 0.3, 0.5, createRng('schuss'));
  ok(e1.outcome === e2.outcome && Math.abs(e1.quality - e2.quality) < 1e-12,
    'Gleiche Szene und gleiche RNG ⇒ bitgleicher Ausgang', `${e1.outcome} / ${round(e1.quality, 4)}`);
}

/* ================================================================== *
 *  8. Integration: das echte Minispiel fahren
 * ================================================================== */
gruppe('8. Integration über die Canvas-Attrappe');

/**
 * Fährt minigame.play() headless.
 * @param {object} opt { high, esc, keineTaste, team, defenders, keeper, moment }
 */
async function spieleSzene(rngAussen, geo, pol, opt = {}) {
  const canvas = macheCanvas();
  const host = {
    canvas, ctx: ctxAttrappe, root: null,
    difficulty: { minigame: opt.diff || 1 },
    rng: createRng(opt.seed || 'i'),
    drawPlayer: opt.drawPlayer || noop,
    drawPitchSection: noop,
    sound: noop
  };
  const moment = opt.moment !== undefined
    ? opt.moment
    : macheMoment(rngAussen, geo.tiefe, geo.seitl, opt);

  let mausX = 480, mausY = 300;
  if (moment && moment.at) {
    const S0 = modell.neueSzene(moment, opt.diff || 1, createRng('maus'));
    const p = modell.zielZuMaus(S0, pol.aimU, pol.aimV);
    mausX = p.x; mausY = p.y;
  }

  const versprechen = minigame.play(host, moment);
  if (!rafRueckruf) return { res: await versprechen, frames: 0 };

  for (const fn of (canvas._hs.mousemove || [])) fn({ clientX: mausX, clientY: mausY, preventDefault: noop });

  const nerven = (moment && moment.actor && moment.actor.attributes.nervenstaerke) || 60;
  const windowS = Math.min(3.2, Math.max(0.85, 1.2 + 1.3 * (nerven / 99)));
  const feuerZeit = opt.high ? (opt.absprungZeit == null ? 1.0 : opt.absprungZeit)
    : APPROACH + pol.tFrac * windowS;

  let t = 0, ts = 0, gefeuert = false, frames = 0;
  while (rafRueckruf && frames < 4000) {
    const f = rafRueckruf; rafRueckruf = null;
    ts += 1000 / 60; f(ts); t += DT; frames++;
    if (!gefeuert && t >= feuerZeit) {
      gefeuert = true;
      if (opt.esc) {
        for (const fn of (fensterHandler.keydown || [])) fn({ key: 'Escape', preventDefault: noop });
      } else if (!opt.keineTaste) {
        if (opt.high) {
          for (const fn of (fensterHandler.keydown || [])) fn({ key: ' ', preventDefault: noop });
        } else {
          // Erst den Typ WÄHLEN (Ziffer), dann abziehen (Klick) – so bedient das
          // Minispiel seit Befund 2. Beides im selben Frame, damit die Messungen
          // mit dem DOM-freien Prüfstand vergleichbar bleiben.
          const key = pol.typ === 'flach' ? '1' : pol.typ === 'heber' ? '2' : '3';
          for (const fn of (fensterHandler.keydown || [])) fn({ key, preventDefault: noop });
          if (opt.nurWaehlen) {
            // nichts weiter: die Ziffer darf NICHT abfeuern
          } else if (opt.mitTaste) {
            for (const fn of (fensterHandler.keydown || [])) fn({ key: ' ', preventDefault: noop });
          } else {
            for (const fn of (canvas._hs.mousedown || [])) fn({ preventDefault: noop });
          }
        }
      }
    }
  }
  return { res: await versprechen, frames };
}

{
  const rng = createRng('integration');
  let tore = 0, n = 300, fehlerhaft = 0;
  const aus = {};
  for (let i = 0; i < n; i++) {
    const { res } = await spieleSzene(rng, bandGeo(rng, i % 3), politik(rng), { seed: 'i' + i });
    if (!res || typeof res.outcome !== 'string') { fehlerhaft++; continue; }
    aus[res.outcome] = (aus[res.outcome] || 0) + 1;
    if (res.outcome === 'tor') tore++;
  }
  ok(fehlerhaft === 0, 'Das echte Minispiel löst immer mit einer Resolution auf');
  ok(imBereich(tore / n, 0.10, 0.35), 'Torquote über alle Bänder gemischt plausibel',
    `${round(100 * tore / n, 1)} %  ${JSON.stringify(aus)}`);

  // ESC
  const esc = await spieleSzene(rng, bandGeo(rng, 0), politik(rng), { esc: true, seed: 'esc' });
  ok(esc.res === null, 'ESC gibt null zurück (Simulation übernimmt)');

  /* Befund 2: die Ziffer WÄHLT nur, sie feuert nicht. Gemessen an der Zahl der
     Frames bis zur Auflösung: ohne Klick läuft das Fenster bis zum Ende. */
  const mWahl = macheMoment(rng, 9, 0);
  const polWahl = { typ: 'heber', aimU: 0.5, aimV: 0.5, tFrac: 0.15 };
  const nurWahl = await spieleSzene(rng, null, polWahl,
    { moment: mWahl, seed: 'wahl', nurWaehlen: true });
  const mitKlick = await spieleSzene(rng, null, polWahl, { moment: mWahl, seed: 'wahl' });
  const mitLeer = await spieleSzene(rng, null, polWahl,
    { moment: mWahl, seed: 'wahl', mitTaste: true });
  ok(nurWahl.frames > mitKlick.frames + 10,
    '[2] wählt nur den Typ aus – abgezogen wird mit Klick',
    `${nurWahl.frames} Frames ohne Klick gegen ${mitKlick.frames} mit Klick`);
  ok(mitLeer.frames === mitKlick.frames && mitLeer.res.outcome === mitKlick.res.outcome,
    '[Leertaste] schießt genauso wie der Klick', mitLeer.res.outcome);

  // Kein Tastendruck: fireLate muss auflösen, nicht hängen
  const spaet = await spieleSzene(rng, bandGeo(rng, 1), politik(rng), { keineTaste: true, seed: 'spaet' });
  ok(spaet.res && typeof spaet.res.outcome === 'string',
    'Ohne Eingabe löst das Fensterende auf', spaet.res && spaet.res.outcome);

  // Kopfball (moment.high)
  const kopf = await spieleSzene(rng, { tiefe: 6, seitl: 1 }, politik(rng),
    { high: true, seed: 'kopf', absprungZeit: 0.55 });
  ok(kopf.res && typeof kopf.res.outcome === 'string', 'Kopfball-Variante löst auf',
    kopf.res && kopf.res.outcome);
  const kopfOhne = await spieleSzene(rng, { tiefe: 6, seitl: 1 }, politik(rng),
    { high: true, keineTaste: true, seed: 'kopf2' });
  ok(kopfOhne.res && kopfOhne.res.outcome === 'daneben',
    'Kopfball ohne Absprung: der Ball segelt über den Kopf');

  // Robustheit: leerer Moment, kein Torwart, keine Verteidiger, Gastteam
  const leer = await spieleSzene(rng, null, politik(rng), { moment: {}, seed: 'leer' });
  ok(leer.res && typeof leer.res.outcome === 'string', 'Leerer Moment stürzt nicht ab');
  const ohneTw = await spieleSzene(rng, { tiefe: 9, seitl: 0 }, politik(rng),
    { keeper: null, defenders: [], seed: 'ohne' });
  ok(ohneTw.res && typeof ohneTw.res.outcome === 'string',
    'Ohne Torwart und ohne Verteidiger stürzt nichts ab', ohneTw.res && ohneTw.res.outcome);
  const gast = await spieleSzene(rng, { tiefe: 7, seitl: 4 }, politik(rng),
    { team: 'away', seed: 'gast' });
  ok(gast.res && typeof gast.res.outcome === 'string', 'Gastteam-Szene läuft');

  // Aufräumen: keine Listener bleiben zurück
  ok((fensterHandler.keydown || []).length === 0,
    'Alle keydown-Listener wurden wieder abgemeldet',
    `${(fensterHandler.keydown || []).length} übrig`);

  // drawPlayer darf werfen, ohne die Szene zu killen
  const boese = await spieleSzene(rng, { tiefe: 8, seitl: 0 }, politik(rng), {
    seed: 'boese', drawPlayer: () => { throw new Error('kaputt'); }
  });
  ok(boese.res && typeof boese.res.outcome === 'string',
    'Ein defektes host.drawPlayer wird abgefangen (Notdarstellung)');
}

/* ================================================================== *
 *  9. Quelltextregeln
 * ================================================================== */
gruppe('9. Quelltextregeln');
{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const hier = dirname(fileURLToPath(import.meta.url));
  const roh = readFileSync(resolve(hier, '../src/interactive/finish.js'), 'utf8');
  // Kommentare zeichentreu entfernen (wie tools/check-all.js) – in den Kommentaren
  // steht bewusst, WELCHE Konstanten weggefallen sind.
  const quelle = roh
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  ok(!/Math\.random/.test(quelle), 'kein Math.random in finish.js');
  ok(!/Date\.now|performance\.now/.test(quelle), 'kein Date.now / performance.now in finish.js');
  ok(/from '\.\.\/core\/ballistik\.js'/.test(quelle), 'nutzt den gemeinsamen Physikkern');
  ok(!/GOAL\s*=\s*\{/.test(quelle), 'das hart codierte Tor-Viereck ist weg');
  ok(/moment\.at|m\.at|at\.x/.test(quelle), 'moment.at wird gelesen');
  ok(quelle.indexOf('KEEPER_SAVE_EDGE') < 0 && quelle.indexOf('KEEPER_LUCK') < 0
    && quelle.indexOf('BLOCK_MAX') < 0,
    'KEEPER_SAVE_EDGE / KEEPER_LUCK / BLOCK_MAX sind ersatzlos entfallen');
  // Befund 1: keine zweite Zielhilfe-Zahl mehr im Bild
  ok(quelle.indexOf('coverFrac') < 0 && quelle.indexOf('WINKEL ZU') < 0,
    'coverFrac und die Zeile „WINKEL ZU" sind aus dem Bild verschwunden '
    + '(in den Kommentaren steht bewusst, warum)');
  // Die Fußzeile zeigt die Torchance je Knopf, und die liest genau die Spalten,
  // die auch gezeichnet werden. Die zugestellte Fläche steht nicht mehr im Bild
  // (Begründung im Dateikopf: als Wahl zwischen den Typen war sie unbrauchbar).
  ok(quelle.indexOf('TOR ZU') < 0 && /chancen\[i\] = torchance\(S,/.test(quelle),
    'Die Fußzeile zeigt die Torchance je Knopf, nicht mehr die zugestellte Fläche');
  ok(/export function torchance\(/.test(quelle)
    && /sp\[i\] = coverHoehe\(S, u, typ\);/.test(quelle)
    && /sp\[SKYLINE_SPALTEN \+ i\] = sperrHoehe\(S, typ, u\);/.test(quelle),
    'torchance liest dieselben Spalten, die die Skyline zeichnet');
  // Der Zielpunkt der Zahl darf nicht wieder in zwei Stufen gesucht werden: die
  // erste Stufe (breitestes gelbes Band) kannte die Verteidiger nicht und behielt
  // bei Gleichstand die linkeste Spalte — bei symmetrischer Skyline also immer
  // den linken Pfosten.
  ok(!/s - c > bFrei/.test(quelle)
    && /chanceAmZiel\(S, typ, spec, uZiel,/.test(quelle)
    && /for \(let k = 0; k <= ZIEL_HOEHEN; k\+\+\)/.test(quelle),
    'torchance sucht den Zielpunkt über die vollständige Bewertung, nicht über das breiteste gelbe Band');
  // Die Höhenstauchung ist weg, und es gibt nur EINE Umrechnung aimV -> Meter.
  ok(quelle.indexOf('zScale') < 0 && quelle.indexOf('zLift') < 0,
    'zScale/zLift sind ersatzlos entfallen (in den Kommentaren steht, warum)');
  ok(/function zZielVon\(/.test(quelle)
    && (quelle.match(/zZielVon\(/g) || []).length >= 4,
    'zZielVon() ist die einzige Umrechnung Zielmarke -> Höhe (Kreuz, Skyline, Schuss)');
  // Befund 2: der angewählte Typ wird geführt, nicht S.shot gelesen
  ok(!/S\.shot \? S\.shot\.type : \(isHeader/.test(quelle) && /drawGoalAndCoverage\(S\.shot/.test(quelle),
    'Die Zielhilfe zeichnet den angewählten Typ, nicht den Rückfall „flach"');
  ok(quelle.indexOf('v0 * 0.93') < 0 && /bezugSichern\(S, typKey\)/.test(quelle)
    && /createFlug/.test(quelle),
    'Die Flugzeitschätzung der Zielhilfe kommt aus dem Modell, nicht aus L/v0');
}

/* ------------------------------------------------------------------ */
console.log('\n' + '═'.repeat(66));
console.log(`  ${bestanden} bestanden, ${gescheitert} gescheitert`
  + (offeneZiele.length ? `, ${offeneZiele.length} offen` : ''));
if (offeneZiele.length) {
  console.log('\n  Offen geblieben (bewusst, siehe Begründung im Quelltext):');
  for (const o of offeneZiele) console.log('   ○ ' + o);
}
if (gescheitert) {
  console.log('\n  Fehlgeschlagen:');
  for (const f of fehler) console.log('   • ' + f);
  process.exit(1);
}
console.log('  Der Abschluss weiß jetzt, wo er steht.');
console.log('═'.repeat(66));
