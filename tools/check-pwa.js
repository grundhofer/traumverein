#!/usr/bin/env node
/**
 * check-pwa.js — prüft, ob das Spiel wirklich offline lauffähig ist.
 *
 * Der teuerste Fehler dieser Bauart ist still: Ein neues Modul kommt dazu,
 * niemand erzeugt sw.js neu, und der Spieler merkt es erst, wenn er ohne Netz
 * einen Bildschirm öffnet, den er vorher nie besucht hat. Genau diese Lücke
 * sucht dieses Skript.
 *
 * Geprüft wird:
 *   1. sw.js und manifest.webmanifest existieren und sind lesbar.
 *   2. Die Dateiliste in sw.js deckt src/, styles/ und icons/ vollständig ab.
 *   3. Die Fassungsnummer in sw.js passt zum heutigen Inhalt.
 *   4. Jede Datei aus der Liste liegt auch wirklich da.
 *   5. Das Manifest nennt Symbole, die es gibt.
 *   6. index.html meldet den Service Worker an.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORDNER = ['src', 'styles', 'icons'];
const EINZELN = ['index.html', 'manifest.webmanifest'];

let fehler = 0;
const meckern = (text) => { fehler++; console.error('  ✘ ' + text); };
const loben = (text) => console.log('  ✔ ' + text);

function sammeln(ordner, gesammelt = []) {
  for (const eintrag of readdirSync(join(WURZEL, ordner)).sort()) {
    const rel = `${ordner}/${eintrag}`;
    if (statSync(join(WURZEL, rel)).isDirectory()) sammeln(rel, gesammelt);
    else gesammelt.push(rel);
  }
  return gesammelt;
}

console.log('\nTRAUMVEREIN – Prüfung der Offline-Fassung\n');

/* 1. Vorhanden? */
for (const datei of ['sw.js', 'manifest.webmanifest', 'index.html']) {
  if (!existsSync(join(WURZEL, datei))) meckern(`${datei} fehlt`);
}
if (fehler) { console.error('\nOhne diese Dateien geht es nicht weiter.\n'); process.exit(1); }
loben('sw.js, manifest.webmanifest und index.html sind da');

const sw = readFileSync(join(WURZEL, 'sw.js'), 'utf8');

/* 2. + 4. Liste gegen Verzeichnis */
const listeRoh = sw.match(/const DATEIEN = \[([\s\S]*?)\];/);
if (!listeRoh) { meckern('In sw.js steht keine Dateiliste'); process.exit(1); }
const gelistet = new Set(
  [...listeRoh[1].matchAll(/'([^']+)'/g)].map(m => m[1]).filter(p => p !== './')
);

const erwartet = [];
for (const f of EINZELN) erwartet.push(f);
for (const o of ORDNER) sammeln(o, erwartet);

const fehlend = erwartet.filter(f => !gelistet.has(f));
if (fehlend.length) {
  meckern(`${fehlend.length} Datei(en) fehlen in sw.js – „node tools/make-sw.js" läuft lassen:`);
  for (const f of fehlend.slice(0, 12)) console.error(`      ${f}`);
  if (fehlend.length > 12) console.error(`      … und ${fehlend.length - 12} weitere`);
} else {
  loben(`alle ${erwartet.length} Dateien stehen in sw.js`);
}

const gespenster = [...gelistet].filter(f => !existsSync(join(WURZEL, f)));
if (gespenster.length) {
  meckern(`sw.js nennt ${gespenster.length} Datei(en), die es nicht gibt:`);
  for (const f of gespenster.slice(0, 12)) console.error(`      ${f}`);
} else {
  loben('keine Karteileichen in der Liste');
}

/* 3. Fassungsnummer */
const streu = createHash('sha256');
for (const f of erwartet.slice().sort()) {
  streu.update(f);
  streu.update(readFileSync(join(WURZEL, f)));
}
const soll = streu.digest('hex').slice(0, 12);
const ist = (sw.match(/const FASSUNG = '([^']+)'/) || [])[1];
if (ist !== soll) {
  meckern(`Fassungsnummer veraltet (steht ${ist}, müsste ${soll} sein) – `
    + '„node tools/make-sw.js" läuft lassen');
} else {
  loben(`Fassungsnummer ${ist} passt zum Inhalt`);
}

/* 5. Manifest */
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(WURZEL, 'manifest.webmanifest'), 'utf8'));
} catch (e) {
  meckern('manifest.webmanifest ist kein gültiges JSON: ' + e.message);
}
if (manifest) {
  for (const feld of ['name', 'short_name', 'start_url', 'display', 'icons']) {
    if (!manifest[feld]) meckern(`Im Manifest fehlt „${feld}"`);
  }
  const ohneDatei = (manifest.icons || []).filter(i => !existsSync(join(WURZEL, i.src)));
  if (ohneDatei.length) meckern(`Manifest nennt fehlende Symbole: ${ohneDatei.map(i => i.src).join(', ')}`);
  else loben(`Manifest nennt ${(manifest.icons || []).length} vorhandene Symbole`);
  if (!(manifest.icons || []).some(i => (i.purpose || '').includes('maskable'))) {
    meckern('Kein maskable-Symbol – auf Android bekommt das Spiel dann einen weißen Rand');
  }
}

/* 6. Anmeldung */
const index = readFileSync(join(WURZEL, 'index.html'), 'utf8');
if (!/serviceWorker\s*\.\s*register/.test(index)) {
  meckern('index.html meldet den Service Worker nicht an');
} else {
  loben('index.html meldet den Service Worker an');
}
if (!/rel="manifest"/.test(index)) {
  meckern('index.html verweist nicht auf das Manifest');
} else {
  loben('index.html verweist auf das Manifest');
}

console.log('');
if (fehler) {
  console.error(`${fehler} Beanstandung(en). Die Offline-Fassung wäre unvollständig.\n`);
  process.exit(1);
}
console.log('Alles grün. Das Spiel läuft auch ohne Netz.\n');
