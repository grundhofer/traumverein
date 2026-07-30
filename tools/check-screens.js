/**
 * tools/check-screens.js – Querprüfung aller Bildschirme.
 *
 * Prüft ohne Browser und ohne Abhängigkeiten:
 *   1. Syntax  – jede Datei wird per `node --check` geprüft.
 *   2. Vertrag – exportiert jede Datei ein `screen`-Objekt mit id/title/icon/render?
 *                Stimmt die id mit Dateiname und SCREEN_ORDER überein?
 *   3. Importe – importiert ein Screen etwas, das das Zielmodul gar nicht exportiert?
 *   4. Extras  – CSS-Klassen ohne Definition, Math.random(), Date.now().
 *
 * Aufruf:  node tools/check-screens.js
 * Rückgabe: Exit-Code 1, wenn harte Fehler gefunden wurden.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const SCREEN_DIR = resolve(WURZEL, 'src/screens');
const STYLE_DIR = resolve(WURZEL, 'styles');

const rel = p => relative(WURZEL, p);

/* ------------------------------------------------------------------ *
 *  Quelltext-Vorbereitung
 * ------------------------------------------------------------------ */

/** Entfernt Block- und Zeilenkommentare, damit Regex nicht in Kommentaren wildert. */
function ohneKommentare(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/* ------------------------------------------------------------------ *
 *  Export-Analyse
 * ------------------------------------------------------------------ */

const exportCache = new Map();

/**
 * Liefert { namen:Set, hatDefault:bool, sterne:[pfade] } eines Moduls.
 * `export * from` wird aufgelöst (mit Zyklusschutz).
 */
function exporteVon(datei, gesehen = new Set()) {
  const abs = resolve(datei);
  if (exportCache.has(abs)) return exportCache.get(abs);
  if (gesehen.has(abs)) return { namen: new Set(), hatDefault: false, fehlt: false };
  gesehen.add(abs);

  if (!existsSync(abs)) {
    const leer = { namen: new Set(), hatDefault: false, fehlt: true };
    exportCache.set(abs, leer);
    return leer;
  }

  const src = ohneKommentare(readFileSync(abs, 'utf8'));
  const namen = new Set();
  let hatDefault = false;

  // export function foo / export async function foo / export class Foo
  for (const m of src.matchAll(/^[ \t]*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) namen.add(m[1]);
  for (const m of src.matchAll(/^[ \t]*export\s+class\s+([A-Za-z_$][\w$]*)/gm)) namen.add(m[1]);

  // export const a = 1, b = 2;  /  export let x  /  export var y
  for (const m of src.matchAll(/^[ \t]*export\s+(?:const|let|var)\s+([^=;\n]+)=/gm)) {
    const kopf = m[1].trim();
    if (/^[{[]/.test(kopf)) {
      // Destrukturierung: export const { a, b } = ...
      for (const n of kopf.matchAll(/([A-Za-z_$][\w$]*)\s*(?:[,}\]]|$)/g)) namen.add(n[1]);
    } else {
      namen.add(kopf.split(/[\s,]/)[0]);
    }
  }

  // export default
  if (/^[ \t]*export\s+default\b/m.test(src)) hatDefault = true;

  // export { a, b as c }  (optional mit from '...')
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

  // export * from './x.js'   und   export * as ns from './x.js'
  for (const m of src.matchAll(/^[ \t]*export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s+)?from\s*['"]([^'"]+)['"]/gm)) {
    if (m[1]) { namen.add(m[1]); continue; }
    const ziel = resolve(dirname(abs), m[2]);
    const unter = exporteVon(ziel, gesehen);
    for (const n of unter.namen) namen.add(n);
  }

  const erg = { namen, hatDefault, fehlt: false };
  exportCache.set(abs, erg);
  return erg;
}

/* ------------------------------------------------------------------ *
 *  Import-Analyse
 * ------------------------------------------------------------------ */

/** Liefert [{ spez:[{name, als}], default:string|null, stern:bool, pfad, zeile }] */
function importeVon(src) {
  const treffer = [];
  const re = /^[ \t]*import\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm;
  for (const m of src.matchAll(re)) {
    const zeile = src.slice(0, m.index).split('\n').length;
    const klausel = m[1].trim();
    const eintrag = { spez: [], default: null, stern: false, pfad: m[2], zeile };
    if (/^\*\s+as\s+/.test(klausel)) {
      eintrag.stern = true;
    } else {
      const geschweift = klausel.match(/\{([\s\S]*)\}/);
      const vorne = klausel.split('{')[0].replace(/,\s*$/, '').trim();
      if (vorne && vorne !== '') {
        if (/^\*\s+as\s+/.test(vorne)) eintrag.stern = true;
        else eintrag.default = vorne;
      }
      if (geschweift) {
        for (const teil of geschweift[1].split(',')) {
          const t = teil.trim();
          if (!t) continue;
          const als = t.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
          if (als) eintrag.spez.push({ name: als[1], als: als[2] });
          else eintrag.spez.push({ name: t, als: t });
        }
      }
    }
    treffer.push(eintrag);
  }
  return treffer;
}

/* ------------------------------------------------------------------ *
 *  Screen-Vertrag
 * ------------------------------------------------------------------ */

function screenVertrag(src) {
  const erg = { hatScreen: false, id: null, title: null, icon: null, hatRender: false, hatOnLeave: false };
  const block = src.match(/export\s+const\s+screen\s*=\s*\{([\s\S]*)/);
  if (!block) return erg;
  erg.hatScreen = true;
  // Nur den ersten ~4000 Zeichen des Objekts betrachten – reicht für die Kopf-Felder.
  const kopf = block[1].slice(0, 4000);
  const id = kopf.match(/\bid\s*:\s*['"]([^'"]+)['"]/);
  const title = kopf.match(/\btitle\s*:\s*['"]([^'"]+)['"]/);
  const icon = kopf.match(/\bicon\s*:\s*['"]([^'"]+)['"]/);
  if (id) erg.id = id[1];
  if (title) erg.title = title[1];
  if (icon) erg.icon = icon[1];
  erg.hatRender = /(^|[\s,{])(async\s+)?render\s*\(/.test(kopf) || /(^|[\s,{])render\s*:\s*(async\s*)?(\(|function)/.test(kopf);
  erg.hatOnLeave = /(^|[\s,{])(async\s+)?onLeave\s*[(:]/.test(kopf);
  return erg;
}

/* ------------------------------------------------------------------ *
 *  CSS-Klassen
 * ------------------------------------------------------------------ */

/** Zieht Klassennamen aus einem CSS-Text. */
function klassenAusCss(css, set) {
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) set.add(m[1]);
}

/**
 * Erkennt CSS, das als Template-Literal in einer JS-Datei steckt
 * (render/ui.js und screens/taktik.js spielen ihr Stylesheet selbst ein).
 */
function klassenAusJsStil(src, set) {
  for (const m of src.matchAll(/`([^`]*)`/g)) {
    const t = m[1];
    if (t.length < 120) continue;
    if (!/[.#][\w-]+[^{}]*\{[^{}]*:[^{}]*;/.test(t)) continue;
    klassenAusCss(t, set);
  }
}

function bekannteKlassen(extraJs = []) {
  const set = new Set();
  for (const d of readdirSync(STYLE_DIR)) {
    if (!d.endsWith('.css')) continue;
    klassenAusCss(readFileSync(resolve(STYLE_DIR, d), 'utf8'), set);
  }
  for (const f of extraJs) if (existsSync(f)) klassenAusJsStil(readFileSync(f, 'utf8'), set);
  return set;
}

/**
 * Sammelt tv-Klassen aus:
 *   el('div.tv-foo#id', …)      – Kurzschreibweise im ersten Argument
 *   { class: 'tv-foo tv-bar' }  – class/className-Eigenschaft
 *   classList.add('tv-foo')     – Klassenlisten-Aufrufe
 * Abgeschnittene Teilnamen aus Verkettungen ('tv-pos--' + gruppe) werden ignoriert.
 */
function benutzteKlassen(src, nurTv = true) {
  const map = new Map(); // klasse -> zeile
  const merke = (k, idx) => {
    if (!k) return;
    if (nurTv && !k.startsWith('tv-')) return;
    if (/[-_]$/.test(k)) return;              // 'tv-pos--' + x → unvollständig
    if (map.has(k)) return;
    map.set(k, src.slice(0, idx).split('\n').length);
  };
  const zerlegen = (text, idx) => {
    for (const k of text.split(/[\s'"`+${}()?:,]+/)) merke(k, idx);
  };
  // el('tag.klasse.klasse2#id', …)
  for (const m of src.matchAll(/\bel\(\s*(['"])([^'"]+)\1/g)) {
    for (const teil of m[2].split('#')[0].split('.').slice(1)) merke(teil, m.index);
  }
  for (const m of src.matchAll(/\bclass(?:Name)?\s*[:=]\s*(['"`])([\s\S]{0,400}?)\1/g)) zerlegen(m[2], m.index);
  for (const m of src.matchAll(/classList\.(?:add|remove|toggle|contains)\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/(['"])([^'"]+)\1/g)) zerlegen(s[2], m.index);
  }
  return map;
}

/** Klassen, auf die per querySelector(All) gezielt wird. */
function selektierteKlassen(src) {
  const map = new Map();
  for (const m of src.matchAll(/querySelector(?:All)?\(\s*(['"`])([^'"`]+)\1/g)) {
    for (const s of m[2].matchAll(/\.([A-Za-z_][\w-]*)/g)) {
      if (!map.has(s[1])) map.set(s[1], src.slice(0, m.index).split('\n').length);
    }
  }
  return map;
}

/** Alle Klassen, die irgendwo unter src/ per el()/class:/classList erzeugt werden. */
function erzeugteKlassenGesamt(dir, set = new Set()) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) { erzeugteKlassenGesamt(p, set); continue; }
    if (!e.name.endsWith('.js')) continue;
    for (const k of benutzteKlassen(ohneKommentare(readFileSync(p, 'utf8')), false).keys()) set.add(k);
  }
  return set;
}

/* ------------------------------------------------------------------ *
 *  Hauptlauf
 * ------------------------------------------------------------------ */

const { SCREEN_ORDER } = await import(resolve(WURZEL, 'src/core/constants.js'));

/**
 * Bildschirme ohne Reiter in der Navigation. Sie stehen bewusst nicht in
 * SCREEN_ORDER, sind aber in main.js:SCREENS eingetragen und werden gezielt
 * angesteuert – der Saisonabschluss kommt einmal im Jahr von selbst und hat
 * zwischen „Presse" und „Verein" nichts verloren, und der Editor
 * (Roadmap-Stufe 6) steht hinter einem Tastenkürzel, weil er den Spielstand
 * umschreibt.
 */
const OHNE_NAVIGATION = ['saison', 'editor'];

const fehler = [];
const warnungen = [];
const dateien = readdirSync(SCREEN_DIR).filter(f => f.endsWith('.js')).sort();
const RENDER_DIR = resolve(WURZEL, 'src/render');
const cssBekannt = bekannteKlassen(readdirSync(RENDER_DIR).filter(f => f.endsWith('.js')).map(f => resolve(RENDER_DIR, f)));
const erzeugtGesamt = erzeugteKlassenGesamt(resolve(WURZEL, 'src'));
const gefundeneIds = [];

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  TRAUMVEREIN – Bildschirm-Querprüfung                        ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

for (const datei of dateien) {
  const abs = resolve(SCREEN_DIR, datei);
  const name = basename(datei, '.js');
  const roh = readFileSync(abs, 'utf8');
  const src = ohneKommentare(roh);
  const zeilenFehler = [];
  const zeilenWarn = [];

  /* 1. Syntax ----------------------------------------------------- */
  try {
    execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
  } catch (e) {
    zeilenFehler.push(`Syntaxfehler: ${String(e.stderr || e.message).split('\n').slice(0, 3).join(' ')}`);
  }

  /* 2. Screen-Vertrag --------------------------------------------- */
  const v = screenVertrag(src);
  if (!v.hatScreen) zeilenFehler.push('kein "export const screen = { … }" gefunden');
  else {
    if (!v.id) zeilenFehler.push('screen.id fehlt');
    else {
      gefundeneIds.push(v.id);
      if (v.id !== name) zeilenFehler.push(`screen.id "${v.id}" ≠ Dateiname "${name}"`);
      if (!SCREEN_ORDER.includes(v.id) && !OHNE_NAVIGATION.includes(v.id)) {
        zeilenFehler.push(`screen.id "${v.id}" steht nicht in SCREEN_ORDER`);
      }
    }
    if (!v.title) zeilenFehler.push('screen.title fehlt');
    if (!v.icon) zeilenFehler.push('screen.icon fehlt');
    if (!v.hatRender) zeilenFehler.push('screen.render(root, ctx) fehlt');
  }

  /* 3. Importe ----------------------------------------------------- */
  for (const imp of importeVon(src)) {
    if (!imp.pfad.startsWith('.')) continue;
    const ziel = resolve(dirname(abs), imp.pfad);
    const ex = exporteVon(ziel);
    if (ex.fehlt) {
      zeilenFehler.push(`Zeile ${imp.zeile}: Modul "${imp.pfad}" existiert nicht`);
      continue;
    }
    if (imp.default && !ex.hatDefault) {
      zeilenFehler.push(`Zeile ${imp.zeile}: "${imp.pfad}" hat keinen default-Export (importiert als ${imp.default})`);
    }
    for (const s of imp.spez) {
      if (!ex.namen.has(s.name)) {
        zeilenFehler.push(`Zeile ${imp.zeile}: "${s.name}" wird von ${imp.pfad} NICHT exportiert`);
      }
    }
  }

  /* 4a. CSS-Klassen ------------------------------------------------ */
  // Manche Screens (z. B. taktik.js) bringen ihr Stylesheet selbst mit.
  const eigen = new Set(cssBekannt);
  klassenAusJsStil(roh, eigen);
  const fehlendeKlassen = [];
  for (const [k, z] of benutzteKlassen(src)) {
    if (!eigen.has(k)) fehlendeKlassen.push(`${k} (Z. ${z})`);
  }
  if (fehlendeKlassen.length) zeilenWarn.push(`CSS-Klasse ohne Definition: ${fehlendeKlassen.join(', ')}`);

  // querySelector auf eine Klasse, die nirgends erzeugt und nirgends definiert wird → greift ins Leere
  const tote = [];
  for (const [k, z] of selektierteKlassen(src)) {
    if (!eigen.has(k) && !erzeugtGesamt.has(k)) tote.push(`${k} (Z. ${z})`);
  }
  if (tote.length) zeilenFehler.push(`Selektor greift ins Leere – Klasse wird nirgends erzeugt: ${tote.join(', ')}`);

  /* 4b. Verbotene Zufalls-/Zeitquellen ----------------------------- */
  for (const m of src.matchAll(/Math\.random\s*\(/g)) {
    zeilenFehler.push(`Zeile ${src.slice(0, m.index).split('\n').length}: Math.random() ist verboten`);
  }
  for (const m of src.matchAll(/Date\.now\s*\(/g)) {
    zeilenWarn.push(`Zeile ${src.slice(0, m.index).split('\n').length}: Date.now() – nur für reine Anzeige/Animation zulässig`);
  }

  /* Ausgabe -------------------------------------------------------- */
  const status = zeilenFehler.length ? '✖' : zeilenWarn.length ? '!' : '✔';
  console.log(`${status} ${rel(abs)}${v.id ? `  [${v.id}] ${v.icon || ''} ${v.title || ''}` : ''}`);
  for (const f of zeilenFehler) { console.log(`    FEHLER  ${f}`); fehler.push(`${datei}: ${f}`); }
  for (const w of zeilenWarn) { console.log(`    hinweis ${w}`); warnungen.push(`${datei}: ${w}`); }
}

/* 5. Abgleich SCREEN_ORDER ↔ Dateien ------------------------------- */
console.log('\n── SCREEN_ORDER ──────────────────────────────────────────────');
for (const id of SCREEN_ORDER) {
  if (!gefundeneIds.includes(id)) {
    const t = `SCREEN_ORDER enthält "${id}", aber kein Screen meldet diese id`;
    console.log(`  FEHLER  ${t}`);
    fehler.push(t);
  }
}
const ueberzaehlig = gefundeneIds.filter(
  id => !SCREEN_ORDER.includes(id) && !OHNE_NAVIGATION.includes(id));
if (!ueberzaehlig.length && gefundeneIds.length === SCREEN_ORDER.length + OHNE_NAVIGATION.length) {
  console.log(`  ✔ ${SCREEN_ORDER.length} Bildschirme in der Navigation` +
    (OHNE_NAVIGATION.length ? ` + ${OHNE_NAVIGATION.length} ohne Reiter (${OHNE_NAVIGATION.join(', ')})` : '') +
    `, alle Ids passen zu Datei und Reihenfolge.`);
}

/* Zusammenfassung --------------------------------------------------- */
console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  ${dateien.length} Dateien geprüft · ${fehler.length} Fehler · ${warnungen.length} Hinweise`);
console.log('══════════════════════════════════════════════════════════════');
if (fehler.length) {
  console.log('\nDer Platzwart bittet um Nachbesserung:');
  for (const f of fehler) console.log('  • ' + f);
  process.exit(1);
}
console.log('\nAlles in Ordnung. Der Rasen ist gemäht.');
