/**
 * tools/test-ecke.js — Prüfstand für src/interactive/corner.js (Paket 6)
 *
 * Aufruf:  node tools/test-ecke.js
 *
 * Geprüft wird:
 *   1. Vertrag        Exportform von `minigame`, DOM-Freiheit von `modell`,
 *                     kein Math.random / Date.now in der Datei
 *   2. Projektion     exakte Rückabbildung toWorld(toScreen(p)) == p,
 *                     Eckenschütze kleiner als die Spieler im Fünfmeterraum,
 *                     alle bedienbaren Punkte innerhalb der 960×600-Fläche
 *   3. Flugzeiten     kurze Ecke 0,9–1,3 s · lange Ecke 2,3–2,9 s
 *   4. Fallbeschleun. implizites g durchgehend 9,81 ± 0,05 m/s²
 *   5. Timingfenster  grünes Fenster in ABSOLUTEN Sekunden über alle Varianten
 *                     innerhalb ±15 % (die eigentliche Regression dieses Pakets)
 *   6. Effet          Ablage des Landepunkts über die lange Flanke 2–4 m
 *   7. Balance        4000 Ecken: Torquote 2,5–4,5 %, Kopfball kommt zustande
 *                     55–70 %, Torwart klärt 8–15 %
 *   8. Determinismus  gleicher Seed → bitgleiches Ergebnis; Zahl der RNG-Züge
 *                     hängt NICHT an der Bildrate (1/30 gegen 1/144)
 *   9. Nachspiel      das Bild widerspricht dem Banner nicht: bei Parade, Block
 *                     und Aluminium überquert der Ball die Linie nie, ein Tor
 *                     bleibt im Netz
 *  10. Timingbalken   der rote Torwartbereich über ALLE vier Varianten: nie
 *                     vollständig deckend, wer knapp davor abnimmt liegt im
 *                     Grünen — und wie viel Grün er jeweils übrig lässt
 *
 * ---------------------------------------------------------------------------
 * WER SPIELT DIESE 4000 ECKEN?
 * ---------------------------------------------------------------------------
 * Ein Korridor für die Torquote ist ohne ein Modell des Spielers wertlos. Der
 * Prüfstand spielt einen SOLIDEN, NICHT PERFEKTEN Menschen:
 *   • Zielpunkt: Sollzone der Variante + N(0; 1,2 m) quer, N(0; 1,0 m) tief.
 *   • Er liest die Flugvorschau: der Zielpunkt wird zweimal um den gemessenen
 *     Effetversatz nachkorrigiert (genau das zeigt ihm `drawAimPreview`).
 *   • Kraft: ideal + N(0; 0,07). Flugkurve: Sollwert + N(0; 0,15).
 *   • Kopfballtiming: N(0; 0,13 s) um den echten Kontaktzeitpunkt.
 *   • Er reagiert NICHT auf den herauslaufenden Torwart (der rote Bereich im
 *     Timingbalken bleibt ungenutzt) — die Quote eines Spielers, der ihn nutzt,
 *     wird zusätzlich ausgewiesen.
 * Spieler: alle Attribute N(62; 12), geklemmt 20…95, Schwierigkeit 1,0.
 */

import { createRng } from '../src/core/rng.js';
import { round } from '../src/core/util.js';
import { minigame, modell } from '../src/interactive/corner.js';

const { VARIANTS, VARIANT_ORDER, CORNER, KEEPER_FAIR_S } = modell.konstanten;

/* ------------------------------------------------------------------ *
 *  Prüfgerüst
 * ------------------------------------------------------------------ */

let bestanden = 0, gescheitert = 0;
const fehler = [];

function gruppe(titel) {
  console.log('\n' + '─'.repeat(66));
  console.log('  ' + titel);
  console.log('─'.repeat(66));
}
function ok(bedingung, text, zusatz) {
  if (bedingung) { bestanden++; console.log(`  ✓ ${text}${zusatz ? '   (' + zusatz + ')' : ''}`); }
  else { gescheitert++; fehler.push(text + (zusatz ? '   (' + zusatz + ')' : '')); console.log(`  ✗ ${text}${zusatz ? '   (' + zusatz + ')' : ''}`); }
}
function info(text) { console.log(`    · ${text}`); }
function imKorridor(v, lo, hi) { return v >= lo && v <= hi; }

const offeneZiele = [];
/**
 * Ein Ziel, das die heutige Fassung NICHT für jede Variante erreicht und das
 * bewusst offen bleibt. Der Unterschied zu `ok()` ist Absicht: die Zahl steht
 * bei jedem Lauf im Bericht, färbt die Suite aber nicht dauerhaft rot.
 * Wer das Ziel angeht, dreht den Aufruf auf `ok()` zurück.
 * Stand jetzt hat diese Datei kein offenes Ziel mehr — das letzte (das schmale
 * grüne Fenster am ersten Pfosten, Gruppe 10) ist erledigt und steht wieder auf
 * `ok()`. Der Helfer bleibt für den nächsten Fall stehen.
 */
function offen(bedingung, titel, zusatz) {
  if (bedingung) { bestanden++; console.log(`  ✓ ${titel}${zusatz ? '   (' + zusatz + ')' : ''}`); return; }
  offeneZiele.push(titel + (zusatz ? '   (' + zusatz + ')' : ''));
  console.log(`  ○ OFFEN: ${titel}${zusatz ? '   (' + zusatz + ')' : ''}`);
}

const ATTRIBUTE = ['schuss', 'technik', 'passspiel', 'dribbling', 'kopfball', 'standards',
  'tempo', 'ausdauer', 'koerper', 'sprungkraft', 'uebersicht', 'positionsspiel', 'zweikampf',
  'aggressivitaet', 'nervenstaerke', 'fuehrung', 'reflexe', 'stellungsspiel',
  'strafraumbeherrschung', 'abschlag'];

function spieler(rng, id) {
  const a = {};
  for (const k of ATTRIBUTE) a[k] = Math.max(20, Math.min(95, Math.round(rng.gauss(62, 12))));
  return { id, shortName: id, attributes: a, traits: [], fitness: 92, appearance: { height: 180 } };
}

/** Der Spieler liest die Vorschau: Zielpunkt um den gemessenen Effetversatz korrigieren. */
function zielen(variant, sollX, sollY, curve) {
  const spec = VARIANTS[variant];
  let ax = sollX, ay = sollY;
  for (let k = 0; k < 2; k++) {
    const p = modell.idealKraft(variant, ax, ay);
    const f = modell.flankenFlug(ax, ay, p, spec.hoehe, curve, 0, 0, 1);
    const l = f.landung();
    f.freigeben();
    if (!l) break;
    ax += (sollX - l.x); ay += (sollY - l.y);
  }
  return { aimX: ax, aimY: ay, power: modell.idealKraft(variant, ax, ay) };
}

/** Eine komplette Ecke wie oben beschrieben. `opt.frueh` = Torwart-Ausweichen. */
function eineEcke(seed, variant, opt = {}) {
  const rng = createRng(seed);
  const spec = VARIANTS[variant];
  const targets = [0, 1, 2, 3].map((j) => spieler(rng, 'a' + j));
  const defenders = [0, 1, 2, 3].map((j) => spieler(rng, 'd' + j));
  const taker = spieler(rng, 't');
  const keeper = spieler(rng, 'k');
  const curve = spec.idealCurve + rng.gauss(0, 0.15);
  const z = zielen(variant, spec.zone.X + rng.gauss(0, 1.2), spec.zone.Y + rng.gauss(0, 1.0), curve);
  const cfg = {
    rng, diff: 1, taker, keeper, targets, defenders,
    variant, aimX: z.aimX, aimY: z.aimY, curve,
    power: Math.max(0, Math.min(1, z.power + rng.gauss(0, 0.07))),
    timingFehlerS: rng.gauss(0, 0.13)
  };
  if (opt.dt) cfg.dt = opt.dt;
  if (opt.frueh) cfg.frueh = true;
  return modell.szene(cfg);
}

/* ================================================================== *
 *  1. Vertrag
 * ================================================================== */
gruppe('1. Vertrag (CONTRACTS §9)');
{
  ok(minigame && minigame.id === 'ecke' && minigame.kind === 'ecke', 'minigame.id/kind === "ecke"');
  ok(typeof minigame.title === 'string' && typeof minigame.instructions === 'string',
    'title und instructions vorhanden');
  ok(typeof minigame.play === 'function', 'play() vorhanden');
  ok(modell && typeof modell.szene === 'function' && typeof modell.flugzeit === 'function',
    'Prüfexport `modell` mit szene()/flugzeit()');
  ok(typeof globalThis.document === 'undefined',
    'Modul lädt in Node ohne DOM (kein document im Modulrumpf)');

  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const hier = dirname(fileURLToPath(import.meta.url));
  const quelle = readFileSync(resolve(hier, '../src/interactive/corner.js'), 'utf8');
  ok(!/Math\.random/.test(quelle), 'kein Math.random in corner.js');
  ok(!/Date\.now|performance\.now/.test(quelle), 'kein Date.now / performance.now in corner.js');
  ok(/from '\.\.\/core\/ballistik\.js'/.test(quelle), 'Physik kommt aus core/ballistik.js');
  ok(!/FLIGHT_S\s*=/.test(quelle), 'die feste Flugzeit FLIGHT_S ist weg');
  ok(!/BLOCK_BASE|SAVE_BASE|MISS_BASE|MIN_GOAL_P|CURVE_METERS/.test(quelle),
    'die alten Wahrscheinlichkeitskonstanten sind weg');
}

/* ================================================================== *
 *  2. Projektion
 * ================================================================== */
gruppe('2. Projektion (Nachtrag Abschnitt 2)');
{
  let maxE = 0;
  for (let X = -2; X <= 62; X += 2) {
    for (let Y = 0; Y <= 24; Y += 1) {
      const s = modell.toScreen(X, Y);
      const w = modell.toWorld(s.x, s.y);
      maxE = Math.max(maxE, Math.hypot(w.X - X, w.Y - Y));
    }
  }
  ok(maxE < 1e-9, 'toWorld ist die exakte Umkehrung von toScreen (Zielsteuerung intakt)',
    `max ${maxE.toExponential(2)} m`);

  const schuetze = modell.figurenSkala(0.9, 1.0);
  const fuenfer = [[38, 5.5], [31, 4.5], [34.5, 2.0], [34, 1.4]]
    .map(([X, Y]) => modell.figurenSkala(X, Y));
  const mittel = fuenfer.reduce((a, b) => a + b, 0) / fuenfer.length;
  ok(schuetze < Math.min(...fuenfer),
    'Eckenschütze ist kleiner als JEDER Spieler im Fünfmeterraum',
    `${round(schuetze, 3)} gegen ${fuenfer.map((v) => round(v, 3)).join(' / ')}`);
  info(`Eckenschütze ${round(100 * (1 - schuetze / mittel), 1)} % kleiner als der Strafraumdurchschnitt`);

  // Alles, was der Spieler mit der Maus erreichen kann, muss auf der Fläche liegen.
  let drin = true, schlimmster = '';
  for (const [X, Y] of [[8, 1.5], [8, 22], [58, 1.5], [58, 22], [34, 0], [30.34, 0], [37.66, 0],
  [13.84, 16.5], [54.16, 16.5], [0.9, 1.0]]) {
    const s = modell.toScreen(X, Y);
    if (!(s.x >= 0 && s.x <= 960 && s.y >= 0 && s.y <= 600)) { drin = false; schlimmster = `(${X},${Y}) -> ${round(s.x, 0)},${round(s.y, 0)}`; }
  }
  ok(drin, 'Zielbereich, Tor und Strafraum liegen vollständig auf der 960×600-Fläche', schlimmster);

  // Die Division muss überall positiv bleiben, sonst klappt das Bild um.
  let wMin = Infinity;
  for (let X = -14; X <= 82; X += 2) for (let Y = -26; Y <= 24; Y += 2) wMin = Math.min(wMin, modell.tiefe(X, Y));
  ok(wMin > 0.2, 'die homogene Koordinate w bleibt überall positiv', `min ${round(wMin, 3)}`);
}

/* ================================================================== *
 *  3. Flugzeiten
 * ================================================================== */
gruppe('3. Flugzeiten (Korridor: kurz 0,9–1,3 s · lang 2,3–2,9 s)');
const flugzeiten = {};
{
  for (const v of VARIANT_ORDER) {
    const spec = VARIANTS[v];
    const p = modell.idealKraft(v, spec.zone.X, spec.zone.Y);
    flugzeiten[v] = modell.flugzeit(p, v, spec.idealCurve);
    info(`${v.padEnd(8)} ideale Kraft ${round(p, 3)}  →  Flugzeit ${round(flugzeiten[v], 3)} s`);
  }
  ok(imKorridor(flugzeiten.kurz, 0.9, 1.3), 'kurze Ecke 0,9–1,3 s', `${round(flugzeiten.kurz, 3)} s`);
  ok(imKorridor(flugzeiten.lang, 2.3, 2.9), 'lange Ecke 2,3–2,9 s', `${round(flugzeiten.lang, 3)} s`);
  ok(flugzeiten.lang > flugzeiten.kurz * 2,
    'die lange Ecke hängt mehr als doppelt so lange in der Luft wie die kurze',
    `${round(flugzeiten.lang / flugzeiten.kurz, 2)}×`);
  // Die ideale Kraft muss auf dem Balken erreichbar und unterscheidbar sein.
  const kraefte = VARIANT_ORDER.map((v) => modell.idealKraft(v, VARIANTS[v].zone.X, VARIANTS[v].zone.Y));
  ok(Math.min(...kraefte) > 0.10 && Math.max(...kraefte) < 0.95,
    'die ideale Kraft liegt für jede Variante bedienbar im Balken',
    kraefte.map((k) => round(k, 2)).join(' / '));
}

/* ================================================================== *
 *  4. Implizite Fallbeschleunigung
 * ================================================================== */
gruppe('4. Implizite Fallbeschleunigung (Korridor 9,81 ± 0,05 m/s²)');
{
  let schlecht = 0, extrem = 0;
  for (const v of VARIANT_ORDER) {
    const spec = VARIANTS[v];
    const p = modell.idealKraft(v, spec.zone.X, spec.zone.Y);
    const f = modell.flankenFlug(spec.zone.X, spec.zone.Y, p, spec.hoehe, spec.idealCurve, 0, 0, 1);
    const ts = f.scheitel().t;
    const h = 0.10;
    const a = f.at(ts - h, {}), b = f.at(ts + h, {});
    const g = -(b.vz - a.vz) / (2 * h);
    f.freigeben();
    info(`${v.padEnd(8)} g = ${round(g, 4)} m/s²`);
    if (Math.abs(g - 9.81) > 0.05) schlecht++;
    extrem = Math.max(extrem, Math.abs(g - 9.81));
  }
  ok(schlecht === 0, 'alle vier Varianten fallen mit 9,81 ± 0,05 m/s²',
    `größte Abweichung ${round(extrem, 4)}`);
}

/* ================================================================== *
 *  5. Timingfenster in absoluten Sekunden — die eigentliche Regression
 * ================================================================== */
gruppe('5. Grünes Kopfballfenster in ABSOLUTEN Sekunden (Korridor ±15 %)');
const fensterMittel = {};
{
  const N = 200;
  for (const v of VARIANT_ORDER) {
    let s = 0, n = 0;
    for (let i = 0; i < N; i++) {
      const r = eineEcke('fenster-' + v + '-' + i, v);
      s += r.diagnose.halfS; n++;
    }
    fensterMittel[v] = s / n;
    info(`${v.padEnd(8)} halbes Fenster ${round(fensterMittel[v] * 1000, 1)} ms  (Flugzeit ${round(flugzeiten[v], 2)} s)`);
  }
  const werte = VARIANT_ORDER.map((v) => fensterMittel[v]);
  const mittel = werte.reduce((a, b) => a + b, 0) / werte.length;
  const abw = Math.max(...werte.map((w) => Math.abs(w - mittel) / mittel));
  ok(abw <= 0.15, 'das grüne Fenster schwankt über alle Varianten um höchstens ±15 %',
    `${round(100 * abw, 2)} %`);

  // Gegenprobe: so hätte das ALTE, anteilige Fenster ausgesehen.
  const altBase = 0.16 + 0.13 * 0.5;   // HEAD_GREEN_BASE + HEAD_GREEN_SKILL·0,5
  const alt = VARIANT_ORDER.map((v) => altBase * flugzeiten[v]);
  const altMittel = alt.reduce((a, b) => a + b, 0) / alt.length;
  const altAbw = Math.max(...alt.map((w) => Math.abs(w - altMittel) / altMittel));
  info(`zum Vergleich: das alte ANTEILIGE Fenster hätte zwischen ${round(Math.min(...alt) * 1000, 0)} ms `
    + `und ${round(Math.max(...alt) * 1000, 0)} ms geschwankt (±${round(100 * altAbw, 0)} %)`);
  ok(altAbw > 0.15, 'die Regression wäre mit dem alten Anteilsfenster tatsächlich eingetreten',
    `±${round(100 * altAbw, 0)} %`);
}

/* ================================================================== *
 *  6. Effet verschiebt den Landepunkt
 * ================================================================== */
gruppe('6. Effet über die lange Flanke (Korridor 2–4 m Ablage)');
{
  const spec = VARIANTS.lang;
  const p = modell.idealKraft('lang', spec.zone.X, spec.zone.Y);
  const ohne = modell.flankenFlug(spec.zone.X, spec.zone.Y, p, spec.hoehe, 0, 0, 0, 1);
  const mit = modell.flankenFlug(spec.zone.X, spec.zone.Y, p, spec.hoehe, 1, 0, 0, 1);
  const gegen = modell.flankenFlug(spec.zone.X, spec.zone.Y, p, spec.hoehe, -1, 0, 0, 1);
  const lo = ohne.landung(), lm = mit.landung(), lg = gegen.landung();
  const dInnen = Math.hypot(lo.x - lm.x, lo.y - lm.y);
  const dAussen = Math.hypot(lo.x - lg.x, lo.y - lg.y);
  info(`ohne Effet (${round(lo.x, 2)}, ${round(lo.y, 2)}) · nach innen (${round(lm.x, 2)}, ${round(lm.y, 2)}) `
    + `· nach außen (${round(lg.x, 2)}, ${round(lg.y, 2)})`);
  ok(imKorridor(dInnen, 2, 4), 'voller Innenrist verschiebt den Landepunkt um 2–4 m', `${round(dInnen, 2)} m`);
  ok(imKorridor(dAussen, 2, 4), 'voller Außenrist verschiebt den Landepunkt um 2–4 m', `${round(dAussen, 2)} m`);
  ok(lm.y < lo.y && lg.y > lo.y, '„nach innen" zieht zum Tor, „nach außen" vom Tor weg');
  ohne.freigeben(); mit.freigeben(); gegen.freigeben();
}

/* ================================================================== *
 *  7. Balance über 4000 Ecken
 * ================================================================== */
gruppe('7. Balance über 4000 Ecken');
const bilanz = { tor: 0, kopfball: 0, faust: 0, parade: 0, geklaert: 0, daneben: 0, geblockt: 0, holz: 0, niemand: 0, ungenau: 0 };
const proVariante = {};
{
  const N = 4000;
  for (const v of VARIANT_ORDER) proVariante[v] = { n: 0, tor: 0, faust: 0, parade: 0 };
  for (let i = 0; i < N; i++) {
    const v = VARIANT_ORDER[i % VARIANT_ORDER.length];
    const r = eineEcke('ecke-' + i, v);
    const o = r.resolution.outcome, b = r.diagnose.banner;
    const pv = proVariante[v]; pv.n++;
    if (o === 'tor' || o === 'kopfball_tor') { bilanz.tor++; pv.tor++; }
    if (o === 'parade') { bilanz.parade++; pv.parade++; }
    if (o === 'geblockt') bilanz.geblockt++;
    if (o === 'daneben') bilanz.daneben++;
    if (o === 'latte' || o === 'pfosten') bilanz.holz++;
    if (b === 'FAUSTABWEHR!') { bilanz.faust++; pv.faust++; }
    if (b === 'GEKLÄRT!') bilanz.geklaert++;
    if (b === 'NIEMAND GEHT HIN!') bilanz.niemand++;
    if (b === 'ZU UNGENAU!') bilanz.ungenau++;
    // „Kopfball kommt zustande": ein Angreifer bekommt den Ball an den Kopf/Fuß.
    if (r.diagnose.duell === 'att' && b !== 'FAUSTABWEHR!' && b !== 'NIEMAND GEHT HIN!'
      && b !== 'ZU UNGENAU!') bilanz.kopfball++;
  }
  const p = (x) => 100 * x / N;
  info(`Tor ${round(p(bilanz.tor), 2)} %  ·  Abnahme durch Angreifer ${round(p(bilanz.kopfball), 2)} %  ·  `
    + `Faustabwehr ${round(p(bilanz.faust), 2)} %  ·  Parade ${round(p(bilanz.parade), 2)} %`);
  info(`geklärt ${round(p(bilanz.geklaert), 2)} %  ·  geblockt ${round(p(bilanz.geblockt), 2)} %  ·  `
    + `daneben ${round(p(bilanz.daneben), 2)} %  ·  Aluminium ${round(p(bilanz.holz), 2)} %  ·  `
    + `niemand da ${round(p(bilanz.niemand), 2)} %  ·  zu ungenau ${round(p(bilanz.ungenau), 2)} %`);

  ok(imKorridor(p(bilanz.tor), 2.5, 4.5), 'Torquote 2,5–4,5 %', `${round(p(bilanz.tor), 2)} %`);
  ok(imKorridor(p(bilanz.kopfball), 55, 70), 'Kopfball kommt zustande in 55–70 %',
    `${round(p(bilanz.kopfball), 2)} %`);
  ok(imKorridor(p(bilanz.faust), 8, 15), 'Torwart klärt die Flanke in 8–15 %',
    `${round(p(bilanz.faust), 2)} %`);
  info('Lesart: „Torwart klärt" = der Keeper fängt/faustet die FLANKE ab. Paraden gegen den '
    + `Abschluss sind separat und liegen bei ${round(p(bilanz.parade), 2)} % `
    + `(Keeper insgesamt ${round(p(bilanz.faust + bilanz.parade), 2)} %).`);

  for (const v of VARIANT_ORDER) {
    const s = proVariante[v];
    info(`${v.padEnd(8)} Tor ${round(100 * s.tor / s.n, 1)} %  Faust ${round(100 * s.faust / s.n, 1)} %  Parade ${round(100 * s.parade / s.n, 1)} %`);
  }

  /* Gegenprobe: derselbe Spieler, aber er liest den roten Bereich im
   * Timingbalken und nimmt vor dem herauslaufenden Torwart ab. Belegt, dass die
   * angezeigte Entscheidung „früher abnehmen" wirklich etwas bewirkt. */
  let torFrueh = 0, faustFrueh = 0;
  const M = 1000;
  for (let i = 0; i < M; i++) {
    const v = VARIANT_ORDER[i % VARIANT_ORDER.length];
    const r = eineEcke('ecke-' + i, v, { frueh: true });
    const o = r.resolution.outcome;
    if (o === 'tor' || o === 'kopfball_tor') torFrueh++;
    if (r.diagnose.banner === 'FAUSTABWEHR!') faustFrueh++;
  }
  const basisTor = 100 * bilanz.tor / N, basisFaust = 100 * bilanz.faust / N;
  info(`Spieler, der den roten Bereich nutzt (1000 Ecken): Tor ${round(100 * torFrueh / M, 2)} % `
    + `statt ${round(basisTor, 2)} %, Faustabwehr ${round(100 * faustFrueh / M, 2)} % statt ${round(basisFaust, 2)} %`);
  ok(100 * faustFrueh / M < basisFaust,
    'früheres Abnehmen entzieht dem herauslaufenden Torwart Bälle (der rote Bereich ist bedienbar)',
    `${round(100 * faustFrueh / M, 2)} % gegen ${round(basisFaust, 2)} %`);
}

/* ================================================================== *
 *  8. Determinismus
 * ================================================================== */
gruppe('8. Determinismus und Bildratenunabhängigkeit');
{
  const a = eineEcke('det-1', 'lang');
  const b = eineEcke('det-1', 'lang');
  ok(JSON.stringify(a.resolution) === JSON.stringify(b.resolution),
    'gleicher Seed → bitgleiche resolution');
  ok(Math.abs(a.diagnose.tHead - b.diagnose.tHead) < 1e-12
    && Math.abs(a.diagnose.flightS - b.diagnose.flightS) < 1e-12,
    'gleicher Seed → bitgleiche Flug- und Kontaktzeit');

  // Die Zahl der RNG-Züge darf NICHT an der Bildrate hängen (Projektregel).
  function zuegeZaehlen(seed, variant, dt) {
    let n = 0;
    const echt = createRng(seed);
    const zaehler = {
      next() { n++; return echt.next(); },
      gauss(m, s) { return echt.gauss(m, s); },
      fork(l) { return echt.fork(l); }
    };
    const spec = VARIANTS[variant];
    const targets = [0, 1, 2, 3].map((j) => spieler(echt, 'a' + j));
    const defenders = [0, 1, 2, 3].map((j) => spieler(echt, 'd' + j));
    const taker = spieler(echt, 't'), keeper = spieler(echt, 'k');
    modell.szene({
      rng: zaehler, diff: 1, taker, keeper, targets, defenders,
      variant, aimX: spec.zone.X, aimY: spec.zone.Y, curve: spec.idealCurve,
      power: modell.idealKraft(variant, spec.zone.X, spec.zone.Y),
      timingFehlerS: 0.04, dt
    });
    return n;
  }
  let ungleich = 0, geprueft = 0;
  for (let i = 0; i < 60; i++) {
    const v = VARIANT_ORDER[i % 4];
    const grob = zuegeZaehlen('dt-' + i, v, 1 / 30);
    const fein = zuegeZaehlen('dt-' + i, v, 1 / 144);
    geprueft++;
    if (grob !== fein) ungleich++;
  }
  ok(ungleich === 0, 'die Zahl der RNG-Züge ist bei 1/30 und 1/144 identisch (kein Zug im Substep)',
    `${geprueft - ungleich}/${geprueft}`);
}

/* ================================================================== *
 *  9. Ehrliches Nachspiel — das BILD muss zum Banner passen
 *
 *  Vorher lief die Folgebahn im Ergebnisbild ungebremst weiter: bei 'parade'
 *  flog der Ball sichtbar ins Tor, während „GEHALTEN!" auf dem Banner stand,
 *  bei 'geblockt' durch das Bein, bei Aluminium durch den Pfosten. Gemessen
 *  betraf das 22,9 % aller Ecken. `modell.szene` spielt die Ergebnisphase
 *  deshalb mit und meldet, wo der Ball dabei war.
 * ================================================================== */
gruppe('9. Ehrliches Nachspiel (Bild gegen Banner)');
{
  const N = 1600;
  const HALT = ['parade', 'geblockt', 'latte', 'pfosten'];
  let gehalten = 0, imTor = 0, ungekappt = 0, hinterLinie = 0;
  let tore = 0, ausDemStadion = 0, tiefsteImNetz = 0;
  for (let i = 0; i < N; i++) {
    const v = VARIANT_ORDER[i % VARIANT_ORDER.length];
    const r = eineEcke('nachspiel-' + i, v);
    const o = r.resolution.outcome, d = r.diagnose;
    if (HALT.indexOf(o) >= 0) {
      gehalten++;
      if (d.ballImTor) imTor++;
      if (!isFinite(d.folgeStopS)) ungekappt++;
      if (d.ballMinY !== null && d.ballMinY < -0.02) hinterLinie++;
    } else if (o === 'tor' || o === 'kopfball_tor') {
      tore++;
      if (d.ballMinY !== null) {
        tiefsteImNetz = Math.min(tiefsteImNetz, d.ballMinY);
        if (d.ballMinY < -3.0) ausDemStadion++;
      }
    }
  }
  info(`${gehalten} Szenen mit Parade/Block/Aluminium, ${tore} Tore (von ${N} Ecken)`);
  ok(imTor === 0, 'bei Parade, Block und Aluminium überquert der Ball die Torlinie NIE',
    `${imTor} von ${gehalten}`);
  ok(ungekappt === 0, 'die Folgebahn ist in all diesen Fällen am Trefferzeitpunkt gekappt',
    `${gehalten - ungekappt}/${gehalten}`);
  ok(hinterLinie === 0, 'der Ball bleibt vor der Linie (kein Durchrutschen durch Hand, Bein, Pfosten)',
    `${hinterLinie} Ausreißer`);
  ok(ausDemStadion === 0, 'ein Tor bleibt im Netz hängen, statt hinter dem Stadion zu verschwinden',
    `tiefster Punkt ${round(tiefsteImNetz, 2)} m hinter der Linie`);
}

/* ================================================================== *
 *  10. Torwartbereich gegen grünes Fenster — über ALLE vier Varianten
 *
 *  Der rote Bereich im Timingbalken kam vorher aus der ANKUNFT des Torwarts am
 *  Kontaktpunkt — im Schnitt 0,34 s vor dem Kopfball. Damit überdeckte er bei
 *  46,5 % der langen Ecken mit herauslaufendem Torwart das GESAMTE grüne
 *  Fenster: „grün = klicken" und „ab hier rot" widersprachen sich. Maßstab ist
 *  jetzt sein BALLKONTAKT (Ankunft UND Ball auf Fausthöhe).
 *
 *  DIESE GRUPPE HAT BIS ZUR GEGENPRÜFUNG NUR DIE LANGE ECKE GEMESSEN, mit der
 *  Begründung, nur dort komme der Torwart überhaupt heraus. Das ist falsch, und
 *  widerlegt wird es von Gruppe 7 derselben Datei: Faustabwehr lang 28,7 %,
 *  erster 21,0 %. Gemessen läuft der Torwart bei 'lang' in 34,9 % und bei
 *  'erster' in 25,0 % der Ecken heraus, bei 'kurz' und 'zurueck' in 0 von 1500.
 *  Die Gruppe belegte also den GÜNSTIGSTEN Fall. Sie läuft jetzt über alle vier
 *  Varianten und weist den schlechtesten aus.
 *
 *  Verbindlich (`ok`) sind die drei Aussagen, die der Balken dem Spieler macht —
 *  sie halten für jede Variante:
 *    • das grüne Fenster ist nie vollständig rot überdeckt,
 *    • wer knapp vor dem Ballkontakt des Torwarts abnimmt, liegt im Grünen,
 *    • was grün bleibt, ist auch bedienbar (mindestens KEEPER_FAIR_S).
 *
 *  Die dritte Aussage war bis zur vierten Gegenprüfung nur für 'lang' zu halten
 *  und stand hier als offenes Ziel. URSACHE, gemessen und nicht geschätzt:
 *  `S.tFaust` war eine reine Höhenschwelle ohne Ortsbedingung. Zu diesem
 *  Zeitpunkt war der Ball bei 'lang' im Median 1,18 m vom Kontaktpunkt entfernt,
 *  bei 'erster' aber 3,27 m (p90 4,14 m) — der Torwart faustete dort einen Ball,
 *  der noch drei Meter weg war, und der rote Bereich fraß das grüne Fenster von
 *  267 auf 173 ms zusammen (15,7 % der Herauslauf-Fälle unter der Schwelle).
 *  `corner.js` gattert `tFaust` jetzt zusätzlich über die Faustreichweite
 *  (`trefferKugel` um den Kontaktpunkt auf Fausthöhe, Radius `TW_FAUST_R`).
 *  Der Radius ist gemessen, nicht geraten — er entscheidet allein, wie viel
 *  Balance das kostet (je Radius: 'erster' Anteil unter der Schwelle / Median
 *  des sauberen Grüns / Torquote und Faustabwehr aus Gruppe 7):
 *      ohne Gatter  15,7 % · 173 ms · 4,25 % · 12,83 %
 *      2,6 m         0,0 % · 190 ms · 4,25 % · 12,65 %
 *      2,0 m         0,0 % · 232 ms · 4,25 % · 12,43 %   ← eingebaut
 *      1,5 m         0,0 % · 280 ms · 4,50 % ·  9,63 %
 *  1,5 m (die Kopfreichweite HEAD_REACH_R) gattert zu scharf: der Torwart
 *  verliert ein Viertel seiner Faustabwehren und die Torquote landet auf exakt
 *  180/4000 = 4,500 %, also auf der Korridorkante von Gruppe 7. 2,0 m lässt
 *  beides unangetastet — die Faust greift ohnehin weiter als ein Kopf.
 * ================================================================== */
gruppe(`10. Roter Torwartbereich gegen grünes Fenster (Korridor: ≤ 10 % unter ${round(KEEPER_FAIR_S * 1000, 0)} ms)`);
{
  const N = 1500;
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  for (const v of VARIANT_ORDER) {
    const sauber = [], offsets = [];
    let raus = 0, unterFair = 0, ganzRot = 0, imGruenen = 0;
    for (let i = 0; i < N; i++) {
      const d = eineEcke('rot-' + i, v).diagnose;
      if (!d.keeperOut) continue;
      raus++;
      sauber.push(d.sauberGruenS);
      // Unterhalb KEEPER_FAIR_S schaltet die Kopfzeile des Balkens auf
      // „TORWART IST ZUERST AM BALL!" um — dieselbe Schwelle, gegen die hier
      // gemessen wird.
      if (d.sauberGruenS < KEEPER_FAIR_S) unterFair++;
      if (d.sauberGruenS <= 1e-9) ganzRot++;
      // Wer den roten Bereich liest und knapp davor abnimmt: liegt er im Grünen?
      const off = (Math.max(0, d.keeperKontaktS - 0.05) - d.tHead) / d.halfS;
      offsets.push(off);
      if (Math.abs(off) <= 1) imGruenen++;
    }
    if (!raus) {
      info(`${v.padEnd(8)} der Torwart bleibt auf der Linie (0 von ${N}) — der rote Bereich `
        + 'wird hier gar nicht gezeichnet');
      continue;
    }
    sauber.sort((a, b) => a - b);
    offsets.sort((a, b) => a - b);
    info(`${v.padEnd(8)} Torwart läuft in ${round(100 * raus / N, 1)} % heraus · sauberes Grün `
      + `min ${round(1000 * sauber[0], 0)} · p10 ${round(1000 * q(sauber, 0.1), 0)} · `
      + `median ${round(1000 * q(sauber, 0.5), 0)} · p90 ${round(1000 * q(sauber, 0.9), 0)} ms`);
    info(`${' '.repeat(8)} Warnzeile „TORWART IST ZUERST AM BALL!" in `
      + `${round(100 * unterFair / raus, 1)} % der Herauslauf-Fälle `
      + `(${round(100 * unterFair / N, 1)} % aller ${v}-Ecken)`);

    ok(ganzRot === 0, `${v}: das grüne Fenster ist nie vollständig rot überdeckt`,
      `${ganzRot} Fälle von ${raus}`);
    ok(100 * imGruenen / raus >= 90,
      `${v}: wer rechtzeitig vor dem Torwart abnimmt, liegt dabei im GRÜNEN Bereich`,
      `${round(100 * imGruenen / raus, 1)} % · headOffset median ${round(q(offsets, 0.5), 2)}, `
      + `p10 ${round(q(offsets, 0.1), 2)}`);
    ok(100 * unterFair / raus <= 10,
      `${v}: höchstens 10 % der Herauslauf-Fälle behalten weniger als `
      + `${round(KEEPER_FAIR_S * 1000, 0)} ms sauberes Grün`,
      `${round(100 * unterFair / raus, 1)} % (${unterFair} von ${raus})`);
  }
}

/* ================================================================== *
 *  11. Zeichenpfad — Rauchtest mit Attrappen-Canvas
 *
 *  `modell` ist DOM-frei, `play()` ist es nicht. Damit ein Tippfehler in der
 *  Zeichenschicht nicht erst im Browser auffällt, läuft hier eine komplette
 *  Szene über eine Canvas-Attrappe und eine handgetaktete rAF-Schleife.
 * ================================================================== */
gruppe('11. Zeichenpfad (Rauchtest mit Attrappen-Canvas)');
{
  const gemalt = { aufrufe: 0 };
  const ctxAttrappe = new Proxy({}, {
    get(_, k) {
      if (k === 'measureText') return () => ({ width: 40 });
      if (typeof k === 'string' && k.startsWith('@@')) return undefined;
      return (...a) => { gemalt.aufrufe++; return undefined; };
    },
    set() { return true; }
  });
  const hoerer = [];
  const canvasAttrappe = {
    width: 960, height: 600, style: {},
    getContext: () => ctxAttrappe,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 600 }),
    addEventListener: (t, f) => hoerer.push(['canvas', t, f]),
    removeEventListener: (t, f) => {
      const i = hoerer.findIndex((h) => h[1] === t && h[2] === f);
      if (i >= 0) hoerer.splice(i, 1);
    }
  };
  const altWindow = globalThis.window, altRaf = globalThis.requestAnimationFrame;
  const altCancel = globalThis.cancelAnimationFrame;
  globalThis.window = {
    addEventListener: (t, f) => hoerer.push(['window', t, f]),
    removeEventListener: (t, f) => {
      const i = hoerer.findIndex((h) => h[0] === 'window' && h[1] === t && h[2] === f);
      if (i >= 0) hoerer.splice(i, 1);
    }
  };
  let naechster = null;
  globalThis.requestAnimationFrame = (f) => { naechster = f; return 1; };
  globalThis.cancelAnimationFrame = () => { naechster = null; };

  const rng = createRng('rauch');
  const host = {
    canvas: canvasAttrappe, ctx: ctxAttrappe, rng,
    difficulty: { minigame: 1 },
    drawPlayer: () => { gemalt.aufrufe++; },
    sound: () => { }
  };
  const moment = {
    kind: 'ecke', minute: 71, team: 'home',
    actor: spieler(rng, 'schuetze'), keeper: spieler(rng, 'keeper'),
    defenders: [0, 1, 2, 3].map((j) => spieler(rng, 'v' + j)),
    targets: [0, 1, 2, 3].map((j) => spieler(rng, 'z' + j)),
    at: { x: 105, y: 68 }, baseChance: 0.05, pressure: 60,
    context: { score: [1, 1], minute: 71, competition: '1. Bundesliga', farben: { heim: '#c1272d', gast: '#1c4f8f' } }
  };

  let ergebnis = null, fehlerImBild = null;
  try {
    const p = minigame.play(host, moment).then((r) => { ergebnis = r; });
    const feuere = (art, typ, ev) => {
      for (const [q, t, f] of hoerer.slice()) if (q === art && t === typ) f(ev);
    };
    let ts = 0, frames = 0;
    const evStumm = { preventDefault() { }, clientX: 500, clientY: 330, key: '' };
    while (naechster && frames < 2000) {
      const f = naechster; naechster = null;
      ts += 16.7; frames++;
      if (frames === 5) feuere('canvas', 'mousemove', evStumm);
      if (frames === 10) feuere('window', 'keydown', { preventDefault() { }, key: '1' });
      if (frames === 20) feuere('canvas', 'mousemove', { preventDefault() { }, clientX: 560, clientY: 350 });
      if (frames === 25) feuere('window', 'keydown', { preventDefault() { }, key: 'd' });
      if (frames === 30) feuere('canvas', 'mousedown', evStumm);
      if (frames === 44) feuere('window', 'mouseup', evStumm);
      // Kopfball ungefähr am Ende des Fluges
      if (frames === 190) feuere('window', 'keydown', { preventDefault() { }, key: ' ' });
      f(ts);
    }
    await p;
  } catch (e) {
    fehlerImBild = e;
  } finally {
    globalThis.window = altWindow;
    globalThis.requestAnimationFrame = altRaf;
    globalThis.cancelAnimationFrame = altCancel;
  }

  ok(!fehlerImBild, 'play() läuft eine komplette Szene ohne Ausnahme durch',
    fehlerImBild ? String(fehlerImBild && fehlerImBild.stack || fehlerImBild).split('\n').slice(0, 3).join(' | ') : '');
  ok(gemalt.aufrufe > 5000, 'die Zeichenschicht hat tatsächlich gezeichnet', `${gemalt.aufrufe} Zeichenbefehle`);
  ok(ergebnis && typeof ergebnis.outcome === 'string' && typeof ergebnis.quality === 'number'
    && 'targetPlayerId' in ergebnis && typeof ergebnis.xgDelta === 'number',
    'play() liefert eine vertragskonforme resolution',
    ergebnis ? `${ergebnis.outcome}, quality ${round(ergebnis.quality, 2)}, xgDelta ${round(ergebnis.xgDelta, 3)}` : 'keine');
  ok(hoerer.length === 0, 'alle Ereignisempfänger wurden wieder abgemeldet', `${hoerer.length} übrig`);
}

/* ------------------------------------------------------------------ */
console.log('\n' + '═'.repeat(66));
console.log(`  ${bestanden} bestanden, ${gescheitert} gescheitert`
  + (offeneZiele.length ? `, ${offeneZiele.length} offen` : ''));
if (offeneZiele.length) {
  console.log('\n  Offen (bewusst, nicht rot — Begründung im Kopf von Gruppe 10):');
  for (const o of offeneZiele) console.log('   ○ ' + o);
}
if (gescheitert) {
  console.log('\n  Fehlgeschlagen:');
  for (const f of fehler) console.log('   • ' + f);
  process.exit(1);
}
console.log('  Die Ecke fliegt.');
console.log('═'.repeat(66));
