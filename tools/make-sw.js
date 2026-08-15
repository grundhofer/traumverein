#!/usr/bin/env node
/**
 * make-sw.js — schreibt sw.js mit der Liste aller Dateien, die offline
 * vorliegen müssen, und einer Fassungsnummer aus deren Inhalt.
 *
 * Warum erzeugt statt von Hand gepflegt: Das Spiel hat 78 Module, und ein
 * vergessener Eintrag fällt erst auf, wenn jemand ohne Netz einen Bildschirm
 * öffnet, den er vorher nie besucht hat. `tools/check-pwa.js` schlägt Alarm,
 * sobald Verzeichnis und Liste auseinanderlaufen.
 *
 * Die Fassungsnummer ist ein Streuwert über alle Inhalte. Ändert sich eine
 * Zeile, ändert sich der Speichername — der Browser holt alles neu und wirft
 * den alten Stand weg. Genau das, was tools/server.js im Kleinen tut.
 *
 * Aufruf:  node tools/make-sw.js
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Verzeichnisse, die vollständig mitmüssen. */
const ORDNER = ['src', 'styles', 'icons'];
/** Einzelne Dateien am Wurzelverzeichnis. */
const EINZELN = ['index.html', 'manifest.webmanifest'];

function sammeln(ordner, gesammelt = []) {
  for (const eintrag of readdirSync(join(WURZEL, ordner)).sort()) {
    const rel = `${ordner}/${eintrag}`;
    if (statSync(join(WURZEL, rel)).isDirectory()) sammeln(rel, gesammelt);
    else gesammelt.push(rel);
  }
  return gesammelt;
}

const dateien = [];
for (const f of EINZELN) dateien.push(f);
for (const o of ORDNER) sammeln(o, dateien);
dateien.sort();

const streu = createHash('sha256');
for (const f of dateien) {
  streu.update(f);
  streu.update(readFileSync(join(WURZEL, f)));
}
const fassung = streu.digest('hex').slice(0, 12);

// './' ist der Einstieg; er wird zusätzlich zu index.html gespeichert, weil
// der Browser die Seite unter dem Verzeichnisnamen anfordert.
const liste = ['./', ...dateien].map(f => `  '${f}'`).join(',\n');

const inhalt = `/**
 * sw.js — erzeugt von tools/make-sw.js. Nicht von Hand ändern.
 *
 * Macht das Spiel offline lauffähig und installierbar. Beim Einrichten wird
 * alles einmal weggelegt; danach kommt es aus dem Speicher, auch ohne Netz.
 *
 * Die Fassungsnummer ist ein Streuwert über alle Inhalte: Ändert sich eine
 * Zeile im Spiel, heißt der Speicher anders, alles wird neu geholt und der
 * alte Stand fliegt weg. Damit kann kein halb veralteter Satz Module entstehen —
 * genau der Fehler, gegen den auch tools/server.js gebaut ist.
 */

const FASSUNG = '${fassung}';
const SPEICHER = 'traumverein-' + FASSUNG;

const DATEIEN = [
${liste}
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SPEICHER)
      .then((c) => c.addAll(DATEIEN))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(
        namen.filter((n) => n !== SPEICHER && n.startsWith('traumverein-'))
             .map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const anfrage = e.request;
  if (anfrage.method !== 'GET') return;
  const url = new URL(anfrage.url);
  if (url.origin !== self.location.origin) return;

  // Die Seite selbst zuerst aus dem Netz: So merkt ein Spieler eine neue
  // Fassung sofort und nicht erst beim übernächsten Start.
  if (anfrage.mode === 'navigate') {
    e.respondWith(
      fetch(anfrage)
        .then((antwort) => {
          const kopie = antwort.clone();
          caches.open(SPEICHER).then((c) => c.put(anfrage, kopie));
          return antwort;
        })
        .catch(() => caches.match(anfrage).then((t) => t || caches.match('./')))
    );
    return;
  }

  // Alles andere aus dem Speicher – das ist der schnelle und der Offline-Fall.
  e.respondWith(
    caches.match(anfrage).then((treffer) => treffer || fetch(anfrage).then((antwort) => {
      if (antwort && antwort.status === 200 && antwort.type === 'basic') {
        const kopie = antwort.clone();
        caches.open(SPEICHER).then((c) => c.put(anfrage, kopie));
      }
      return antwort;
    }))
  );
});
`;

writeFileSync(join(WURZEL, 'sw.js'), inhalt);
console.log(`sw.js geschrieben – ${dateien.length} Dateien, Fassung ${fassung}`);
