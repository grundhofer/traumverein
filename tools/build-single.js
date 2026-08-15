#!/usr/bin/env node
/**
 * build-single.js — packt das ganze Spiel in EINE HTML-Datei.
 *
 * Wozu: Ein Browser lädt ES-Module nicht über `file://`. Wer das Spiel
 * herunterlädt und die Datei doppelklickt, bekäme sonst nur einen Startfehler.
 * Diese Datei umgeht das, ohne dass ein einziger Modulinhalt angefasst wird:
 *
 *   1. Jedes Modul aus src/ landet als Zeichenkette in der HTML-Datei.
 *   2. Zur Laufzeit wird daraus je ein Blob mit eigener URL.
 *   3. Eine Import-Map verdrahtet die Module miteinander.
 *
 * Der Haken an Blob-URLs: Relative Angaben wie './finances.js' würden gegen
 * `blob:null/<uuid>` aufgelöst und liefen ins Leere. Deshalb schreibt dieses
 * Skript jede relative Angabe in einen absoluten Namen um — aus './finances.js'
 * in src/club/stadium.js wird 'tv:club/finances.js'. Bare specifier lösen
 * Import-Maps ohne Basis-URL auf, und das gilt auch für dynamische Importe.
 *
 * WICHTIG: Das ist ein Erzeuger für ein Download-Paket, kein Build-Schritt des
 * Projekts. Das Repository bleibt ohne Bauvorgang lauffähig — hier entsteht nur
 * ein zusätzliches Artefakt für Leute ohne Node.
 *
 * Aufruf:  node tools/build-single.js  [ziel.html]
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(WURZEL, 'src');
const ZIEL = resolve(process.argv[2] || join(WURZEL, 'dist', 'traumverein.html'));

/** Alle .js unter src/, als POSIX-Pfade relativ zu src/. */
function moduleSammeln(verzeichnis = SRC, gesammelt = []) {
  for (const eintrag of readdirSync(verzeichnis).sort()) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) moduleSammeln(voll, gesammelt);
    else if (eintrag.endsWith('.js')) gesammelt.push(relative(SRC, voll).split(/[\\/]/).join('/'));
  }
  return gesammelt;
}

/**
 * Schreibt relative Modulangaben in absolute `tv:`-Namen um.
 *
 * Erfasst `from './x.js'`, `import('./x.js')` und auch das Schrägmaß
 * ``import(`./screens/${id}.js`)`` — dort wird nur der feste Anfang ersetzt,
 * der Rest der Vorlage bleibt unangetastet.
 *
 * @param {string} quelltext Modulinhalt
 * @param {string} modulPfad z. B. 'club/stadium.js'
 * @param {Set<string>} bekannt alle vorhandenen Modulpfade – für die Gegenprobe
 * @returns {{text: string, treffer: number}}
 */
function angabenUmschreiben(quelltext, modulPfad, bekannt) {
  const ordner = posix.dirname(modulPfad) === '.' ? '' : posix.dirname(modulPfad);
  let treffer = 0;
  const vorlagen = [];
  const uebersprungen = [];
  const muster = /(\bfrom\s*|\bimport\s*\(\s*)(['"`])(\.{1,2}\/[^'"`$]*)/g;
  const text = quelltext.replace(muster, (ganz, davor, anfuehrung, angabe) => {
    const istOrdner = angabe.endsWith('/');
    const aufgeloest = posix.normalize(posix.join(ordner, angabe));
    const name = istOrdner ? aufgeloest.replace(/\/?$/, '/') : aufgeloest;

    // Der Ausdruck trifft auch Beispiele in Kommentaren. Was auf kein Modul
    // zeigt, bleibt unangetastet und wird gemeldet — lieber ein Kommentar zu
    // viel im Bericht als eine stillschweigend verbogene Zeile.
    if (!istOrdner && !bekannt.has(name)) {
      uebersprungen.push(angabe);
      return ganz;
    }
    if (istOrdner) vorlagen.push(`${angabe} → tv:${name}`);
    treffer++;
    return `${davor}${anfuehrung}tv:${name}`;
  });
  return { text, treffer, vorlagen, uebersprungen };
}

/** Macht eine Zeichenkette sicher für die Einbettung in <script>. */
function fuerSkript(wert) {
  return JSON.stringify(wert)
    .replace(/<\//g, '<\\/')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const modulPfade = moduleSammeln();
const bekannt = new Set(modulPfade);
if (!bekannt.has('main.js')) throw new Error('src/main.js fehlt – ohne Einstiegspunkt kein Paket');

const quellen = {};
let umschreibungen = 0;
const alleVorlagen = [];
const alleUebersprungen = [];
for (const pfad of modulPfade) {
  const roh = readFileSync(join(SRC, pfad), 'utf8');
  const { text, treffer, vorlagen, uebersprungen } = angabenUmschreiben(roh, pfad, bekannt);
  quellen[pfad] = text;
  umschreibungen += treffer;
  for (const v of vorlagen) alleVorlagen.push(`${pfad}: ${v}`);
  for (const u of uebersprungen) alleUebersprungen.push(`${pfad}: ${u}`);
}

const css = ['styles/main.css', 'styles/screens.css']
  .map((p) => `/* ${p} */\n${readFileSync(join(WURZEL, p), 'utf8')}`)
  .join('\n\n');

const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TRAUMVEREIN – Der Fußballmanager</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>⚽</text></svg>">
  <style>
${css}
  </style>
</head>
<body>
  <div id="app">
    <div class="tv-lade" id="tv-boot">TRAUMVEREIN wird geladen …</div>
  </div>
  <div id="tv-toasts"></div>

  <script>
  // Erzeugt von tools/build-single.js — eine Datei, kein Server, kein Node.
  (function () {
    var quellen = ${fuerSkript(quellen)};
    var karte = { imports: {} };
    for (var pfad in quellen) {
      karte.imports['tv:' + pfad] = URL.createObjectURL(
        new Blob([quellen[pfad]], { type: 'text/javascript' }));
    }
    // Die Import-Map muss stehen, bevor das erste Modul geladen wird.
    var kartenTag = document.createElement('script');
    kartenTag.type = 'importmap';
    kartenTag.textContent = JSON.stringify(karte);
    document.head.appendChild(kartenTag);

    import('tv:main.js').then(function (m) {
      return m.boot(document.getElementById('app'));
    }).catch(function (err) {
      console.error(err);
      var app = document.getElementById('app');
      app.innerHTML = '';
      var box = document.createElement('div');
      box.style.cssText = 'padding:32px;color:#f2e8cf;font-family:sans-serif;line-height:1.6';
      box.innerHTML = '<h1 style="color:#e04b4b">Startfehler</h1>' +
        '<p>Das Spiel konnte nicht geladen werden.</p>' +
        '<pre style="background:rgba(0,0,0,.4);padding:12px;overflow:auto;white-space:pre-wrap">' +
        String(err && err.stack || err).replace(/</g, '&lt;') + '</pre>' +
        '<p style="opacity:.7">Diese Fassung braucht einen Browser, der Import-Maps kennt: ' +
        'Chrome/Edge ab 89, Firefox ab 108, Safari ab 16.4. Ältere Browser scheitern hier.<br>' +
        'Es geht auch ohne Download: ' +
        '<a style="color:#e8c33a" href="https://grundhofer.github.io/traumverein/">grundhofer.github.io/traumverein</a></p>';
      app.appendChild(box);
    });
  })();
  </script>
</body>
</html>
`;

mkdirSync(dirname(ZIEL), { recursive: true });
writeFileSync(ZIEL, html);

const mb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2);
console.log(`${modulPfade.length} Module, ${umschreibungen} Angaben umgeschrieben`);
if (alleVorlagen.length) {
  console.log(`\nDynamische Vorlagen (zur Laufzeit aufgelöst, bitte im Blick behalten):`);
  for (const v of alleVorlagen) console.log(`  ${v}`);
}
if (alleUebersprungen.length) {
  console.log(`\nUnangetastet, weil kein Modul dahinter liegt (erwartet: Beispiele in Kommentaren):`);
  for (const u of alleUebersprungen) console.log(`  ${u}`);
}
console.log(`\n${ZIEL}  (${mb} MB)`);
