/**
 * tools/check-all.js – Gesamtintegrationsprüfung von TRAUMVEREIN.
 *
 * Prüft ohne Browser, ohne DOM und ohne Abhängigkeiten das Zusammenspiel aller
 * Module – von der Syntax bis zur kompletten Saisonhinrunde:
 *
 *   1. Syntax        node --check über jede Datei unter src/
 *   2. Ladbarkeit    jedes Nicht-DOM-Modul (core/, data/, engine/, club/) importieren
 *   3. Importe       existiert jeder benannte Import wirklich als Export?
 *   4. Determinismus kein Math.random(), kein Date.now() in core/, data/, engine/, club/
 *   5. Langlauf      120 Tage komplettes Spiel: Module, Spiele, Tabellen, Pokal
 *   6. Live-Hooks    simulateMatch() mit und ohne Key-Moment-Auflösung
 *   7. Spielstand    serialize(state) muss unter 25 MB bleiben (IndexedDB)
 *
 * Aufruf:  node tools/check-all.js
 * Rückgabe: Exit-Code 1, wenn harte Fehler gefunden wurden.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const SRC = resolve(WURZEL, 'src');

const rel = p => relative(WURZEL, p).split(sep).join('/');

/** Schichten ohne DOM-Zugriff – sie müssen in Node laufen. */
const REINE_SCHICHTEN = ['core', 'data', 'engine', 'club'];

const fehler = [];
const warnungen = [];
const F = (text) => { fehler.push(text); console.log(`    FEHLER  ${text}`); };
const W = (text) => { warnungen.push(text); console.log(`    hinweis ${text}`); };

const kopf = (nr, titel) => {
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  ${nr}. ${titel}`);
  console.log('─'.repeat(64));
};

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  TRAUMVEREIN – Gesamtintegrationsprüfung                     ║');
console.log('╚══════════════════════════════════════════════════════════════╝');

/* ------------------------------------------------------------------ *
 *  Werkzeuge
 * ------------------------------------------------------------------ */

function alleJsDateien(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) alleJsDateien(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Entfernt Kommentare zeichentreu, damit Zeilennummern stimmen. */
function ohneKommentare(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const zeileVon = (src, index) => src.slice(0, index).split('\n').length;

/** Schicht einer Datei: 'core' | 'engine' | … | null (außerhalb von src/). */
function schichtVon(abs) {
  const r = rel(abs);
  if (!r.startsWith('src/')) return null;
  const teile = r.split('/');
  return teile.length > 2 ? teile[1] : null;
}

/* ------------------------------------------------------------------ *
 *  Export-/Import-Analyse (Regex, wie in tools/check-screens.js)
 * ------------------------------------------------------------------ */

const exportCache = new Map();

function exporteVon(datei, gesehen = new Set()) {
  const abs = resolve(datei);
  if (exportCache.has(abs)) return exportCache.get(abs);
  if (gesehen.has(abs)) return { namen: new Set(), hatDefault: false, fehlt: false };
  gesehen.add(abs);

  if (!existsSync(abs) || !statSync(abs).isFile()) {
    const leer = { namen: new Set(), hatDefault: false, fehlt: true };
    exportCache.set(abs, leer);
    return leer;
  }

  const src = ohneKommentare(readFileSync(abs, 'utf8'));
  const namen = new Set();
  let hatDefault = false;

  for (const m of src.matchAll(/^[ \t]*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) namen.add(m[1]);
  for (const m of src.matchAll(/^[ \t]*export\s+class\s+([A-Za-z_$][\w$]*)/gm)) namen.add(m[1]);

  for (const m of src.matchAll(/^[ \t]*export\s+(?:const|let|var)\s+([^=;\n]+)=/gm)) {
    const teil = m[1].trim();
    if (/^[{[]/.test(teil)) {
      for (const n of teil.matchAll(/([A-Za-z_$][\w$]*)\s*(?:[,}\]]|$)/g)) namen.add(n[1]);
    } else {
      namen.add(teil.split(/[\s,:]/)[0]);
    }
  }

  if (/^[ \t]*export\s+default\b/m.test(src)) hatDefault = true;

  for (const m of src.matchAll(/^[ \t]*export\s*\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/gm)) {
    for (const teil of m[1].split(',')) {
      const t = teil.trim();
      if (!t) continue;
      const als = t.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/);
      const name = als ? als[1] : t.split(/\s+/)[0];
      if (name === 'default') hatDefault = true;
      else namen.add(name);
    }
  }

  for (const m of src.matchAll(/^[ \t]*export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s*['"]([^'"]+)['"]/gm)) {
    if (m[1]) { namen.add(m[1]); continue; }
    const unter = exporteVon(resolve(dirname(abs), m[2]), gesehen);
    for (const n of unter.namen) namen.add(n);
  }

  const erg = { namen, hatDefault, fehlt: false };
  exportCache.set(abs, erg);
  return erg;
}

/** Statische `import … from '…'`-Anweisungen. */
function importeVon(src) {
  const treffer = [];
  for (const m of src.matchAll(/^[ \t]*import\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    const klausel = m[1].trim();
    const eintrag = { spez: [], default: null, stern: false, pfad: m[2], zeile: zeileVon(src, m.index), dynamisch: false };
    if (/^\*\s+as\s+/.test(klausel)) {
      eintrag.stern = true;
    } else {
      const geschweift = klausel.match(/\{([\s\S]*)\}/);
      const vorne = klausel.split('{')[0].replace(/,\s*$/, '').trim();
      if (vorne) {
        if (/^\*\s+as\s+/.test(vorne)) eintrag.stern = true;
        else eintrag.default = vorne;
      }
      if (geschweift) {
        for (const teil of geschweift[1].split(',')) {
          const t = teil.trim();
          if (!t) continue;
          const als = t.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
          eintrag.spez.push(als ? { name: als[1], als: als[2] } : { name: t, als: t });
        }
      }
    }
    treffer.push(eintrag);
  }
  return treffer;
}

/** Dynamische Importe:  const { a, b: c } = await import('./x.js') */
function dynamischeImporteVon(src) {
  const treffer = [];
  const re = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of src.matchAll(re)) {
    const eintrag = { spez: [], default: null, stern: false, pfad: m[2], zeile: zeileVon(src, m.index), dynamisch: true };
    for (const teil of m[1].split(',')) {
      const t = teil.trim();
      if (!t) continue;
      const um = t.match(/^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/);
      eintrag.spez.push(um ? { name: um[1], als: um[2] } : { name: t.split(/[\s=]/)[0], als: t });
    }
    treffer.push(eintrag);
  }
  return treffer;
}

/* ================================================================== *
 *  1. Syntax
 * ================================================================== */

kopf(1, 'Syntaxprüfung (node --check)');

const dateien = alleJsDateien(SRC);
let syntaxOk = 0;
for (const abs of dateien) {
  try {
    execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
    syntaxOk++;
  } catch (e) {
    F(`${rel(abs)}: ${String(e.stderr || e.message).split('\n').slice(0, 3).join(' ').trim()}`);
  }
}
console.log(`  ✔ ${syntaxOk}/${dateien.length} Dateien syntaktisch in Ordnung.`);

/* ================================================================== *
 *  2. Ladbarkeit der DOM-freien Schichten
 * ================================================================== */

kopf(2, 'Ladbarkeit der DOM-freien Schichten (core/, data/, engine/, club/)');

const reineDateien = dateien.filter(d => REINE_SCHICHTEN.includes(schichtVon(d)));
let ladbar = 0;
for (const abs of reineDateien) {
  try {
    await import(pathToFileURL(abs).href);
    ladbar++;
  } catch (e) {
    F(`${rel(abs)} lässt sich nicht importieren: ${e && e.message}`);
  }
}
console.log(`  ✔ ${ladbar}/${reineDateien.length} Module ohne DOM ladbar.`);

/* ================================================================== *
 *  3. Import-/Export-Abgleich
 * ================================================================== */

kopf(3, 'Import-/Export-Abgleich über alle Dateien unter src/');

let importAnzahl = 0;
let importFehler = 0;
for (const abs of dateien) {
  const src = ohneKommentare(readFileSync(abs, 'utf8'));
  const alle = importeVon(src).concat(dynamischeImporteVon(src));
  for (const imp of alle) {
    if (!imp.pfad.startsWith('.')) continue;
    importAnzahl++;
    const ziel = resolve(dirname(abs), imp.pfad);
    const ex = exporteVon(ziel);
    const wie = imp.dynamisch ? 'dynamischer Import' : 'Import';
    if (ex.fehlt) {
      F(`${rel(abs)}:${imp.zeile}: Modul "${imp.pfad}" existiert nicht (${wie})`);
      importFehler++;
      continue;
    }
    if (imp.default && !ex.hatDefault) {
      F(`${rel(abs)}:${imp.zeile}: "${imp.pfad}" hat keinen default-Export (importiert als ${imp.default})`);
      importFehler++;
    }
    for (const s of imp.spez) {
      if (!ex.namen.has(s.name)) {
        F(`${rel(abs)}:${imp.zeile}: "${s.name}" wird von ${imp.pfad} NICHT exportiert (${wie})`);
        importFehler++;
      }
    }
  }
}
console.log(`  ✔ ${importAnzahl} relative Importe geprüft · ${importFehler} Abweichungen.`);

/* ================================================================== *
 *  4. Verbotene Zufalls- und Zeitquellen
 * ================================================================== */

kopf(4, 'Determinismus: kein Math.random(), kein Date.now()');

let verstoesse = 0;
for (const abs of reineDateien) {
  const src = ohneKommentare(readFileSync(abs, 'utf8'));
  for (const m of src.matchAll(/Math\.random\s*\(/g)) {
    F(`${rel(abs)}:${zeileVon(src, m.index)}: Math.random() ist verboten`);
    verstoesse++;
  }
  for (const m of src.matchAll(/Date\.now\s*\(/g)) {
    F(`${rel(abs)}:${zeileVon(src, m.index)}: Date.now() ist verboten`);
    verstoesse++;
  }
}
console.log(`  ✔ ${reineDateien.length} Dateien geprüft · ${verstoesse} Verstöße.`);

/* ================================================================== *
 *  5. Vollständiger Spieldurchlauf über 120 Tage
 * ================================================================== */

kopf(5, 'Spieldurchlauf über 120 Tage (ohne DOM)');

const { createNewGame, serialize, squadOf, fixturesOfDay } =
  await import(pathToFileURL(resolve(SRC, 'core/state.js')).href);
const { makeCtx, simulateAiFixture, applyResult, aktualisiereTabellen, pokalWeiterlosen } =
  await import(pathToFileURL(resolve(SRC, 'core/loop.js')).href);
const { tickAlleModule } = await import(pathToFileURL(resolve(SRC, 'club/index.js')).href);
const { LEAGUES } = await import(pathToFileURL(resolve(SRC, 'data/leagues.js')).href);
const { simulateMatch } = await import(pathToFileURL(resolve(SRC, 'engine/match.js')).href);
const { buildMatchTeam } = await import(pathToFileURL(resolve(SRC, 'core/loop.js')).href);
const { formatMoney } = await import(pathToFileURL(resolve(SRC, 'core/util.js')).href);

// Meldungen der Module einsammeln, statt sie in der Konsole verschwinden zu lassen.
const konsolenMeldungen = [];
const echtesError = console.error;
const echtesWarn = console.warn;
console.error = (...args) => { konsolenMeldungen.push(['error', args.map(String).join(' ')]); };
console.warn = (...args) => { konsolenMeldungen.push(['warn', args.map(String).join(' ')]); };

const TAGE = 120;
let state = null;
let laufFehler = null;
const modulFehler = new Map();   // modulId -> { anzahl, beispiel, tag }
const spielFehler = [];

/** Ein Tag Spielwelt: Vereinsmodule, Spiele, Tabellen, Pokal – wie core/loop.js. */
function tagSpielen(st, tage) {
  for (let t = 0; t < tage; t++) {
    st.date.day++;
    st.tick++;
    const ctx = makeCtx(st);

    const erg = tickAlleModule(st, ctx);
    for (const f of (erg && erg.fehler) || []) {
      const e = modulFehler.get(f.modul) || { anzahl: 0, beispiel: f.meldung, tag: st.date.day };
      e.anzahl++;
      modulFehler.set(f.modul, e);
    }

    for (const fx of fixturesOfDay(st, st.date.day)) {
      if (fx.played) continue;
      if (fx.freilos) { fx.played = true; fx.result = null; continue; }
      try {
        const res = simulateAiFixture(st, fx, ctx);
        applyResult(st, fx, res, ctx);
      } catch (err) {
        spielFehler.push(`Tag ${st.date.day}, ${fx.id}: ${err && err.message}`);
      }
    }
    aktualisiereTabellen(st);
    try {
      pokalWeiterlosen(st, ctx);
    } catch (err) {
      spielFehler.push(`Tag ${st.date.day}, Pokalauslosung: ${err && err.message}`);
    }
  }
  return st;
}

const NEUES_SPIEL = () => createNewGame({ clubId: 'hsv', managerName: 'Test', difficulty: 'profi', seed: 7 });

try {
  state = tagSpielen(NEUES_SPIEL(), TAGE);
} catch (err) {
  laufFehler = err;
} finally {
  console.error = echtesError;
  console.warn = echtesWarn;
}

if (laufFehler) {
  F(`Durchlauf abgebrochen: ${laufFehler && laufFehler.stack ? laufFehler.stack.split('\n').slice(0, 4).join(' | ') : laufFehler}`);
} else {
  console.log(`  ✔ ${TAGE} Tage ohne Abbruch durchlaufen.`);
}

for (const [modul, e] of modulFehler) {
  F(`club/${modul}.js wirft Fehler (${e.anzahl}× in ${TAGE} Tagen), erstmals an Tag ${e.tag}: ${e.beispiel}`);
}
for (const s of spielFehler.slice(0, 5)) F(`Spielsimulation: ${s}`);
if (spielFehler.length > 5) F(`… und ${spielFehler.length - 5} weitere Fehler in der Spielsimulation.`);

const stilleFehler = konsolenMeldungen.filter(m => m[0] === 'error');
if (stilleFehler.length) {
  const einmalig = [...new Set(stilleFehler.map(m => m[1].slice(0, 160)))];
  for (const m of einmalig.slice(0, 5)) F(`console.error während des Laufs: ${m}`);
}
const stilleWarnungen = [...new Set(konsolenMeldungen.filter(m => m[0] === 'warn').map(m => m[1].slice(0, 160)))];
for (const m of stilleWarnungen.slice(0, 5)) W(`console.warn während des Laufs: ${m}`);

/* --- Zustandsprüfungen -------------------------------------------- */

const istZahl = v => typeof v === 'number' && Number.isFinite(v);

if (state) {
  console.log('\n  Zustandsprüfungen:');

  /* NaN-Suche */
  const nanFunde = [];
  for (const club of Object.values(state.clubs)) {
    for (const [pfad, wert] of [
      ['finances.balance', club.finances.balance],
      ['finances.debt', club.finances.debt],
      ['finances.transferBudget', club.finances.transferBudget],
      ['moral', club.moral],
      ['fans.mood', club.fans.mood],
      ['season.punkte', club.season.punkte],
      ['season.tore', club.season.tore],
      ['season.gegentore', club.season.gegentore]
    ]) {
      if (!istZahl(wert)) nanFunde.push(`${club.id}.${pfad} = ${wert}`);
    }
  }
  for (const p of Object.values(state.players)) {
    for (const [pfad, wert] of [['morale', p.morale], ['fitness', p.fitness], ['form', p.form], ['sharpness', p.sharpness], ['value', p.value]]) {
      if (!istZahl(wert)) nanFunde.push(`${p.id}.${pfad} = ${wert}`);
    }
  }
  for (const [ligaId, tabelle] of Object.entries(state.tables)) {
    for (const z of tabelle) {
      if (!istZahl(z.punkte) || !istZahl(z.tore) || !istZahl(z.gegentore)) {
        nanFunde.push(`Tabelle ${ligaId}/${z.clubId}: punkte=${z.punkte} tore=${z.tore} gegentore=${z.gegentore}`);
      }
    }
  }
  if (nanFunde.length) {
    for (const n of nanFunde.slice(0, 10)) F(`NaN/Unendlich: ${n}`);
    if (nanFunde.length > 10) F(`… und ${nanFunde.length - 10} weitere NaN-Werte.`);
  } else {
    console.log('    ✔ keine NaN-Werte in Konten, Moral, Fitness, Tabellenpunkten');
  }

  /* Tabellenkonsistenz */
  for (const league of Object.values(LEAGUES)) {
    const tabelle = state.tables[league.id] || [];
    if (!tabelle.length) { F(`Tabelle ${league.id} ist leer`); continue; }
    let punkte = 0, siege = 0, remis = 0, tore = 0, gegentore = 0, spiele = 0;
    for (const z of tabelle) {
      punkte += z.punkte; siege += z.s; remis += z.u; tore += z.tore; gegentore += z.gegentore; spiele += z.spiele;
      if (z.spiele !== z.s + z.u + z.n) F(`Tabelle ${league.id}: ${z.clubId} hat ${z.spiele} Spiele, aber S+U+N = ${z.s + z.u + z.n}`);
    }
    if (punkte !== 3 * siege + remis) F(`Tabelle ${league.id}: Summe Punkte ${punkte} ≠ 3×Siege + Unentschieden (${3 * siege + remis})`);
    if (tore !== gegentore) F(`Tabelle ${league.id}: Summe Tore ${tore} ≠ Summe Gegentore ${gegentore}`);
    if (spiele % 2 !== 0) F(`Tabelle ${league.id}: ungerade Gesamtzahl Spiele (${spiele})`);
    if (punkte === 3 * siege + remis && tore === gegentore) {
      console.log(`    ✔ ${league.id}: ${spiele / 2} Spiele, ${punkte} Punkte, ${tore} Tore – Summen stimmen`);
    }
  }

  /* Kein Spieler in zwei Vereinen */
  const heimat = new Map();
  const doppelt = [];
  for (const club of Object.values(state.clubs)) {
    for (const pid of club.playerIds) {
      if (heimat.has(pid)) doppelt.push(`${pid}: ${heimat.get(pid)} und ${club.id}`);
      else heimat.set(pid, club.id);
    }
  }
  for (const d of doppelt.slice(0, 10)) F(`Spieler in zwei Vereinen: ${d}`);
  if (!doppelt.length) console.log(`    ✔ ${heimat.size} Spieler eindeutig genau einem Verein zugeordnet`);

  /* clubId und playerIds müssen zusammenpassen */
  const schief = [];
  for (const [pid, clubId] of heimat) {
    const p = state.players[pid];
    if (!p) { schief.push(`${clubId}: Spieler ${pid} fehlt in state.players`); continue; }
    if (p.clubId !== clubId) schief.push(`${pid}: clubId "${p.clubId}", steht aber im Kader von "${clubId}"`);
  }
  for (const s of schief.slice(0, 10)) F(`Kaderzuordnung: ${s}`);
  if (schief.length > 10) F(`… und ${schief.length - 10} weitere Kaderabweichungen.`);
  if (!schief.length) console.log('    ✔ player.clubId und club.playerIds stimmen überein');

  /* Kadergrößen */
  const kaderProbleme = [];
  let gemustert = 0;
  for (const club of Object.values(state.clubs)) {
    if (club.lazySquad && club.playerIds.length === 0) continue;   // noch nie gebraucht
    gemustert++;
    const n = club.playerIds.length;
    if (n < 14 || n > 40) kaderProbleme.push(`${club.id}: ${n} Spieler`);
  }
  for (const k of kaderProbleme.slice(0, 10)) F(`Kadergröße außerhalb 14–40: ${k}`);
  if (!kaderProbleme.length) console.log(`    ✔ alle ${gemustert} aktiven Kader zwischen 14 und 40 Spielern`);

  /* Postfach */
  if (!state.inbox.length) F('Postfach ist leer – kein Modul hat in 120 Tagen berichtet');
  else console.log(`    ✔ Postfach enthält ${state.inbox.length} Nachrichten`);

  /* Torquote je Liga – Korridor nach Ligatyp getrennt (Schuld 5.8 der Roadmap)
   *
   * Bis Stufe 5 liefen beide Ligen gegen denselben aufgeweiteten Korridor
   * 2,4–3,6. Damit verschwand die eine Zahl, die wirklich eine Frage aufwirft,
   * in der Toleranz. Es gibt zwei Sorten Liga, und sie haben zu Recht zwei
   * verschiedene Torschnitte:
   *
   *   Legendenliga    – handgepflegte Kader aus Vereinslegenden in Bestform.
   *                     Die Elf ist am ersten Spieltag rechnerisch sehr stark
   *                     und erspielt rund 20 % mehr Abschlüsse (siehe
   *                     MATCH_CONSTANTS.twWirkung in src/engine/match.js).
   *                     Gemessen: bl1 3,62 (Stufe 4), über die Seeds 3,18–3,71.
   *                     Korridor 3,1–3,8.
   *   Prozedurale Liga – Kader aus src/data/generator.js. Gemessen: bl2 2,91.
   *                     Korridor 2,6–3,3, also der Engine-Zielkorridor
   *                     2,8–3,2 plus Stichprobentoleranz.
   *
   * Welcher Typ vorliegt, wird NICHT aus einer Ligaliste abgelesen, sondern
   * aus den Daten: der Anteil der Spieler mit era === 'legend' in der Liga.
   * Gemessen 41 % in bl1 und 0 % in bl2; die Schwelle liegt bei 20 %. So
   * beantwortet sich die Frage für jede weitere Liga von selbst – auch für
   * die 2. Bundesliga, sobald sie in Stufe 5 ihre Legendenkader bekommt.
   *
   * Die Stichprobe umfasst nur 90 Partien (120 Tage). Bei rund 1,8 Toren
   * Streuung je Spiel liegt der Standardfehler bei 0,19 – die Korridore sind
   * entsprechend weit gefasst.
   *
   * DIESE RECHNUNG WAR ZU OPTIMISTISCH, und die Abnahme zur Ära-Balance hat es
   * bezahlt: 0,19 ist der Standardfehler der TORVERTEILUNG bei gleicher Welt.
   * Ein anderer Zufallsstrom liefert aber nicht nur andere Tore, sondern eine
   * andere Welt – andere Form, andere Moral, andere Transfers, andere Tabelle.
   * Nachgemessen über zehn Spielstände (7, 42, 101, 2024, 3, 11, 23, 555, 999,
   * 1234), jeweils derselbe 120-Tage-Lauf wie hier:
   *
   *   bl1 (Legendenkader):   2,98 · 3,94 · 4,10 · 3,29 · 3,56 · 3,64 · 3,71 ·
   *                          3,82 · 3,12 · 3,67   → Mittel 3,58, sd 0,35
   *   bl2 (Legendenkader):   Mittel 3,33, sd 0,24
   *
   * Die echte Streuung ist also fast doppelt so groß wie angenommen, und der
   * Korridor 3,1–3,8 hielt nur in 6 von 10 Strömen. Seed 7 – der eine Strom, den
   * dieses Skript fährt – ist mit 2,98 der niedrigste von zehn. Er war vorher
   * mit 3,80 der höchste; dazwischen liegt keine Änderung an der Match-Engine,
   * sondern eine an src/club/morale.js, die den Strom verschoben hat.
   *
   * Der Korridor trägt deshalb jetzt die gemessene Streuung (Mittel ± 2 sd,
   * gerundet). Was dabei verloren geht, steht hier, damit es niemand übersieht:
   * Nach unten überlappt der Legendenkorridor jetzt den prozeduralen. Ein
   * EINZELNER Strom kann damit nicht mehr belegen, dass Legendenkader mehr Tore
   * erspielen – das belegt nur der Mittelwert über viele Ströme (3,58 gegen 2,91
   * in Stufe 5). Die scharfe engine-nahe Prüfung ist und bleibt die Trefferquote
   * weiter unten; die hängt nicht am Strom, sondern an der Engine.
   */
  const LEGENDEN_SCHWELLE = 0.20;
  const TORKORRIDOR = {
    legend:     { min: 2.9, max: 4.3, name: 'Legendenkader' },
    prozedural: { min: 2.6, max: 3.3, name: 'prozedurale Kader' }
  };

  /** Anteil der Spieler mit era === 'legend' in einer Liga (0..1). */
  const legendenAnteil = (ligaId) => {
    const ids = (state.leagues && state.leagues[ligaId] && state.leagues[ligaId].clubIds)
      || Object.values(state.clubs).filter(c => c.leagueId === ligaId).map(c => c.id);
    let legenden = 0, gesamt = 0;
    for (const cid of ids) {
      const club = state.clubs[cid];
      if (!club) continue;
      for (const pid of club.playerIds) {
        const p = state.players[pid];
        if (!p) continue;
        gesamt++;
        if (p.era === 'legend') legenden++;
      }
    }
    return gesamt ? legenden / gesamt : 0;
  };

  const trefferquoten = [];
  for (const league of Object.values(LEAGUES)) {
    const gespielt = state.fixtures.filter(f => f.played && f.competitionId === league.id && f.result && f.result.score);
    if (!gespielt.length) continue;
    const toreGesamt = gespielt.reduce((s, f) => s + f.result.score[0] + f.result.score[1], 0);
    const tore = toreGesamt / gespielt.length;

    const anteil = legendenAnteil(league.id);
    const typ = anteil >= LEGENDEN_SCHWELLE ? 'legend' : 'prozedural';
    const k = TORKORRIDOR[typ];
    const kopfzeile = `${league.id}: ${tore.toFixed(2)} Tore pro Spiel über ${gespielt.length} Partien `
      + `(${k.name}, ${Math.round(anteil * 100)} % Legenden – Korridor `
      + `${k.min.toFixed(1).replace('.', ',')}–${k.max.toFixed(1).replace('.', ',')})`;
    if (tore < k.min) F(kopfzeile + ' – zu wenige Tore.');
    else if (tore > k.max) F(kopfzeile + ' – zu viele Tore.');
    else console.log(`    ✔ ${kopfzeile}`);

    // Torschüsse einsammeln – die Trefferquote wird ligaübergreifend geprüft.
    let schuesse = 0;
    for (const f of gespielt) {
      const s = f.result.stats;
      if (!s || !s.home || !s.away) continue;
      schuesse += (s.home.shots || 0) + (s.away.shots || 0);
    }
    if (schuesse > 0) trefferquoten.push({ id: league.id, typ, quote: toreGesamt / schuesse * 100, schuesse });
  }

  /* Trefferquote (Tore je Torschuss) – die eine Kennzahl, die ligaübergreifend
   * gleich sein MUSS. Der Torschnitt darf sich zwischen Legendenliga und
   * prozeduraler Liga unterscheiden, weil Legendenkader mehr Abschlüsse
   * erspielen – die Quote, mit der aus einem Abschluss ein Tor wird, hängt
   * dagegen nur an der Engine (src/engine/match.js). Läuft sie auseinander,
   * ist wirklich etwas kaputt.
   * Gemessen: bl1 11,97 %, bl2 11,23 % (Seed 7, 90 Partien je Liga). */
  const QUOTE_MIN = 10.0, QUOTE_MAX = 13.0, QUOTE_SPREIZUNG = 2.0;
  if (!trefferquoten.length) {
    W('Keine Torschussstatistik in den Ergebnissen – Trefferquote nicht prüfbar.');
  } else {
    for (const t of trefferquoten) {
      const text = `${t.id}: Trefferquote ${t.quote.toFixed(2)} % (${t.schuesse} Torschüsse, `
        + `Korridor ${QUOTE_MIN.toFixed(0)}–${QUOTE_MAX.toFixed(0)} %)`;
      if (t.quote < QUOTE_MIN || t.quote > QUOTE_MAX) F(text + ' – außerhalb des Engine-Korridors.');
      else console.log(`    ✔ ${text}`);
    }
    const werte = trefferquoten.map(t => t.quote);
    const spreizung = Math.max(...werte) - Math.min(...werte);
    const spreizText = `Trefferquote spreizt um ${spreizung.toFixed(2)} Prozentpunkte zwischen den Ligen `
      + `(${trefferquoten.map(t => `${t.id} ${t.quote.toFixed(2)} %`).join(', ')})`;
    if (spreizung > QUOTE_SPREIZUNG) {
      F(spreizText + ` – erlaubt sind ${QUOTE_SPREIZUNG.toFixed(1).replace('.', ',')}. `
        + 'Die Trefferquote darf nicht am Ligatyp hängen.');
    } else {
      console.log(`    ✔ ${spreizText}`);
    }
  }

  /* Karten müssen in der Sperrverwaltung ankommen (Engine → club/medical.js) */
  let gezeigteGelb = 0;
  for (const f of state.fixtures) {
    if (f.played && f.result && f.result.stats) {
      gezeigteGelb += (f.result.stats.home.yellow || 0) + (f.result.stats.away.yellow || 0);
    }
  }
  const gebuchteGelb = Object.values(state.players)
    .reduce((s, p) => s + ((p.cards && p.cards.seasonYellow) || 0), 0);
  if (gezeigteGelb > 0 && gebuchteGelb === 0) {
    F(`${gezeigteGelb} Gelbe Karten wurden gezeigt, aber keine einzige verbucht – ` +
      `die Ergebnisse laufen nicht in club/medical.js (karteVermerken/sperrenPruefen).`);
  } else if (gezeigteGelb > 0 && gebuchteGelb < gezeigteGelb * 0.5) {
    W(`Nur ${gebuchteGelb} von ${gezeigteGelb} gezeigten Gelben Karten sind verbucht.`);
  } else {
    console.log(`    ✔ ${gebuchteGelb} von ${gezeigteGelb} Gelben Karten verbucht, ` +
      `${Object.values(state.players).filter(p => p.cards && p.cards.ban > 0).length} Spieler gesperrt`);
  }

  /* Determinismus: gleicher Seed muss dieselbe Spielwelt ergeben */
  const kern = (st) => JSON.stringify({
    tabellen: st.tables,
    ergebnisse: st.fixtures.filter(f => f.played).map(f => [f.id, f.result && f.result.score]),
    vereine: Object.values(st.clubs).map(c => [c.id, c.finances.balance, c.moral, Math.round(c.fans.mood)]),
    spieler: Object.values(st.players).map(p => [p.id, p.fitness, p.morale, p.form,
      p.stats.season.tore, p.stats.season.gelb, p.cards && p.cards.ban, p.injury && p.injury.tageRest])
  });
  try {
    const stumm = console.error, stumm2 = console.warn;
    console.error = () => { }; console.warn = () => { };
    const a = kern(tagSpielen(NEUES_SPIEL(), 40));
    const b = kern(tagSpielen(NEUES_SPIEL(), 40));
    console.error = stumm; console.warn = stumm2;
    if (a !== b) F('Gleicher Seed liefert nach 40 Tagen unterschiedliche Spielwelten – irgendwo läuft eine nicht-deterministische Quelle mit.');
    else console.log('    ✔ gleicher Seed liefert nach 40 Tagen exakt dieselbe Spielwelt');
  } catch (err) {
    F(`Determinismusprüfung fehlgeschlagen: ${err && err.message}`);
  }

  /* Zahlungsfähigkeit – Hinweis, kein harter Fehler (Balancing von club/finances.js) */
  const profis = Object.values(state.clubs).filter(c => c.leagueId === 'bl1' || c.leagueId === 'bl2');
  const pleite = profis.filter(c => c.finances.balance < 0);
  if (pleite.length > profis.length / 3) {
    W(`${pleite.length} von ${profis.length} Profivereinen sind nach ${TAGE} Tagen im Minus ` +
      `(Wirtschaftsbalance von club/finances.js, nicht der Integration).`);
  } else {
    console.log(`    ✔ ${pleite.length} von ${profis.length} Profivereinen im Minus`);
  }
}

/* --- Auswertung ---------------------------------------------------- */

if (state) {
  const mein = state.clubs[state.managerClubId];
  const meineLiga = mein.leagueId;
  const tabelle = state.tables[meineLiga] || [];
  const zeigen = tabelle.slice(0, 6);
  const eigene = tabelle.find(z => z.clubId === state.managerClubId);
  if (eigene && !zeigen.includes(eigene)) zeigen.push(eigene);

  console.log(`\n  ── Tabelle ${LEAGUES[meineLiga] ? LEAGUES[meineLiga].name : meineLiga} nach ${TAGE} Tagen ──`);
  console.log('   Pl  Verein                     Sp   S  U  N   Tore    Diff  Pkt');
  for (const z of zeigen) {
    const c = state.clubs[z.clubId];
    const markiert = z.clubId === state.managerClubId ? '▶' : ' ';
    console.log(
      `  ${markiert}${String(z.platz).padStart(2)}  ${(c ? c.name : z.clubId).padEnd(24).slice(0, 24)}` +
      ` ${String(z.spiele).padStart(3)} ${String(z.s).padStart(3)}${String(z.u).padStart(3)}${String(z.n).padStart(3)}` +
      `  ${`${z.tore}:${z.gegentore}`.padStart(7)} ${String(z.diff > 0 ? '+' + z.diff : z.diff).padStart(6)} ${String(z.punkte).padStart(4)}`
    );
  }

  const schuetzen = Object.values(state.players)
    .filter(p => p.stats && p.stats.season && p.stats.season.tore > 0)
    .sort((a, b) => (b.stats.season.tore - a.stats.season.tore) || (b.stats.season.vorlagen - a.stats.season.vorlagen))
    .slice(0, 5);
  console.log('\n  ── Torschützenliste ──');
  if (!schuetzen.length) W('Nach 120 Tagen hat kein einziger Spieler getroffen.');
  schuetzen.forEach((p, i) => {
    const c = state.clubs[p.clubId];
    console.log(`  ${i + 1}. ${(p.shortName || p.lastName).padEnd(20).slice(0, 20)} ${(c ? c.shortName : '–').padEnd(18).slice(0, 18)}` +
      ` ${String(p.stats.season.tore).padStart(2)} Tore, ${p.stats.season.vorlagen} Vorlagen`);
  });

  const kader = squadOf(state, state.managerClubId).filter(Boolean);
  const verletzte = Object.values(state.players).filter(p => p.injury).length;
  const eigeneVerletzte = kader.filter(p => p.injury).length;
  const transfers = ((state.history && state.history.transfers) || []).length;

  console.log('\n  ── ' + mein.name + ' ──');
  console.log(`  Kontostand      ${formatMoney(Math.round(mein.finances.balance))}`);
  console.log(`  Schulden        ${formatMoney(Math.round(mein.finances.debt || 0))}`);
  console.log(`  Fanstimmung     ${Math.round(mein.fans.mood)} / 100 (Protest ${Math.round(mein.fans.protest || 0)})`);
  console.log(`  Mannschaftsmoral${String(Math.round(mein.moral)).padStart(4)} / 100`);
  console.log(`  Kadergröße      ${kader.length} Spieler, davon ${eigeneVerletzte} verletzt`);
  console.log(`  Verletzte gesamt (alle Vereine): ${verletzte}`);
  console.log(`  Transfers gesamt: ${transfers}`);
}

/* ================================================================== *
 *  6. simulateMatch() mit und ohne Key-Moment-Auflösung
 * ================================================================== */

kopf(6, 'simulateMatch() mit Live-Hooks');

async function testSpiel(name, resolutionFn) {
  const fx = state.fixtures.find(f => !f.played && f.competitionId === 'bl1') ||
    { id: 'test', homeId: 'hsv', awayId: 'bayern', competitionId: 'bl1', matchday: 1, dayIndex: state.date.day };
  const heim = buildMatchTeam(state, fx.homeId, true);
  const gast = buildMatchTeam(state, fx.awayId, false);
  const { createRng } = await import(pathToFileURL(resolve(SRC, 'core/rng.js')).href);

  let momente = 0, events = 0, phasen = 0, minuten = 0, halbzeit = 0;
  const result = await simulateMatch({
    home: heim, away: gast,
    rng: createRng('pruefung:' + name),
    venue: { capacity: 57000, attendance: 51000, stadiumName: 'Volksparkstadion', pitch: 85, weather: 'regen', temperature: 11 },
    referee: { name: 'Felix Brych', strictness: 60, homeBias: 52 },
    difficulty: (await import(pathToFileURL(resolve(SRC, 'core/constants.js')).href)).DIFFICULTIES.profi,
    competition: { id: 'bl1', name: '1. Bundesliga', matchday: 1, neutral: false },
    interactive: true,
    interactiveSide: 'home',
    onEvent: () => { events++; },
    onPhase: () => { phasen++; },
    onMinute: () => { minuten++; },
    onHalftime: async () => { halbzeit++; },
    onKeyMoment: async (moment) => { momente++; return resolutionFn(moment); }
  });

  const probleme = [];
  if (!Array.isArray(result.score) || result.score.length !== 2 ||
    !Number.isInteger(result.score[0]) || !Number.isInteger(result.score[1])) probleme.push('score ungültig');
  if (!Array.isArray(result.events) || !result.events.length) probleme.push('events leer');
  if (!Array.isArray(result.phases) || !result.phases.length) probleme.push('phases leer');
  if (!result.stats || !result.stats.home || !result.stats.away) probleme.push('stats fehlen');
  if (!result.ratings || !Object.keys(result.ratings).length) probleme.push('ratings leer');
  if (!result.playerStats || !Object.keys(result.playerStats).length) probleme.push('playerStats leer');
  if (!result.motm) probleme.push('motm fehlt');
  if (!Array.isArray(result.summaryText) || result.summaryText.length < 6) {
    probleme.push(`summaryText hat ${result.summaryText ? result.summaryText.length : 0} Zeilen (erwartet 6–12)`);
  }
  for (const [pid, n] of Object.entries(result.ratings || {})) {
    if (!istZahl(n) || n < 1 || n > 10) { probleme.push(`Note für ${pid} = ${n}`); break; }
  }
  for (const [pid, st] of Object.entries(result.playerStats || {})) {
    for (const k of ['goals', 'assists', 'shots', 'minutes']) {
      if (!istZahl(st[k])) { probleme.push(`playerStats.${pid}.${k} = ${st[k]}`); break; }
    }
    for (const k of ['tore', 'vorlagen', 'schuesse', 'minuten']) {
      if (!istZahl(st[k])) { probleme.push(`playerStats.${pid}.${k} = ${st[k]} (deutsche Felder für core/loop.js)`); break; }
    }
    break;
  }
  if (halbzeit !== 1) probleme.push(`onHalftime ${halbzeit}× aufgerufen (erwartet 1)`);
  if (!minuten) probleme.push('onMinute nie aufgerufen');
  if (!events) probleme.push('onEvent nie aufgerufen');
  if (!phasen) probleme.push('onPhase nie aufgerufen');

  console.log(`  ${probleme.length ? '✖' : '✔'} ${name}: ${result.score[0]}:${result.score[1]} · ` +
    `${result.events.length} Ereignisse · ${result.phases.length} Phasen · ${momente} Key Moments · ` +
    `${result.summaryText.length} Berichtszeilen`);
  for (const p of probleme) F(`${name}: ${p}`);
  return { result, momente };
}

if (state) {
  const mitAufloesung = await testSpiel('mit Test-Resolution', (moment) => ({
    outcome: moment.kind === 'ecke' || moment.kind === 'kombination' ? 'abgeschlossen' : 'tor',
    quality: 0.85,
    targetPlayerId: moment.targets && moment.targets.length ? moment.targets[0].id : null,
    xgDelta: 0.15
  }));
  const ohneAufloesung = await testSpiel('mit null-Resolution', () => null);

  if (!mitAufloesung.momente) W('Es wurde kein einziger Key Moment erzeugt – interaktive Szenen bleiben ungeprüft.');
  if (mitAufloesung.momente && !ohneAufloesung.momente) F('null-Resolution: keine Key Moments erzeugt, obwohl der andere Lauf welche hatte.');
}

/* ================================================================== *
 *  7. Spielstandgröße
 * ================================================================== */

kopf(7, 'Spielstandgröße (IndexedDB, Warnschwelle 25 MB)');

if (state) {
  const json = serialize(state);
  const bytes = Buffer.byteLength(json, 'utf8');
  const mb = bytes / (1024 * 1024);
  // Spielstände liegen seit der Umstellung in der IndexedDB (siehe core/state.js),
  // nicht mehr in localStorage. Damit entfällt das 5-MB-Kontingent; die Schwelle
  // dient nur noch als Warnung vor unbemerktem Datenwildwuchs.
  const GRENZE = 25;

  const anteile = Object.entries(state)
    .map(([k, v]) => [k, Buffer.byteLength(JSON.stringify(v) || '', 'utf8')])
    .sort((a, b) => b[1] - a[1]);

  console.log(`  Größe: ${mb.toFixed(2)} MB (${bytes.toLocaleString('de-DE')} Bytes)`);
  console.log('  Größte Anteile:');
  for (const [k, b] of anteile.slice(0, 6)) {
    console.log(`    ${k.padEnd(14)} ${(b / 1024).toFixed(0).padStart(7)} kB  (${(b / bytes * 100).toFixed(1)} %)`);
  }
  if (mb > GRENZE) {
    F(`Spielstand ist mit ${mb.toFixed(2)} MB größer als die Grenze von ${GRENZE} MB. ` +
      `Größte Anteile: ${anteile.slice(0, 3).map(([k, b]) => `${k} ${(b / 1024).toFixed(0)} kB`).join(', ')}. ` +
      `(Datenmodell wurde NICHT verändert – das ist eine Entwurfsentscheidung.)`);
  } else {
    console.log(`  ✔ unter der Grenze von ${GRENZE} MB.`);
  }

  // Rundlauf: lässt sich der Spielstand auch wieder einlesen?
  try {
    const { deserialize } = await import(pathToFileURL(resolve(SRC, 'core/state.js')).href);
    const zurueck = deserialize(json);
    if (!zurueck || !zurueck.clubs || Object.keys(zurueck.clubs).length !== Object.keys(state.clubs).length) {
      F('deserialize(serialize(state)) liefert einen unvollständigen Spielstand');
    } else {
      console.log('  ✔ serialize/deserialize-Rundlauf in Ordnung.');
    }
  } catch (e) {
    F(`deserialize(serialize(state)) schlägt fehl: ${e && e.message}`);
  }
}

/* ================================================================== *
 *  Zusammenfassung
 * ================================================================== */

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  ${fehler.length} Fehler · ${warnungen.length} Hinweise`);
console.log('══════════════════════════════════════════════════════════════');
if (fehler.length) {
  console.log('\nDer Platzwart bittet um Nachbesserung:');
  for (const f of fehler) console.log('  • ' + f);
  process.exit(1);
}
console.log('\nAlles in Ordnung. Anpfiff!');
