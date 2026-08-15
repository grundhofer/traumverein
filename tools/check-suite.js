/**
 * tools/check-suite.js – Der Aufmarsch: alle Prüfskripte hintereinander.
 *
 * `npm run check` hat bis Roadmap-Stufe 6 genau EIN Skript gestartet
 * (check-all.js) und damit zwanzig weitere stillschweigend übersprungen —
 * inklusive derer, die in den Stufen 3 bis 5 die schwersten Funde gemacht
 * haben (ROADMAP S7). Diese Datei holt das nach.
 *
 * Grundsatz: Die Liste wird NICHT gepflegt, sondern gelesen. Wer morgen
 * tools/test-kabine.js anlegt, läuft ab dem nächsten `npm run check` mit,
 * ohne dass jemand hier eine Zeile ändert. Genau daran ist die alte Fassung
 * gescheitert — eine Aufzählung veraltet, ein Verzeichnis nicht.
 *
 * Ausgenommen sind nur zwei Dateien, beide aus zwingendem Grund:
 *   • server.js       – der Entwicklungsserver kehrt nie zurück.
 *   • check-suite.js  – diese Datei; sie würde sich selbst endlos aufrufen.
 *
 * Jedes Skript läuft in einem eigenen Node-Prozess. Das kostet ein paar
 * hundert Millisekunden pro Lauf und ist es wert: Ein Skript, das den Prozess
 * mit process.exit(1) verlässt (mehrere tun das), würde in-process die ganze
 * Suite mitnehmen.
 *
 * Aufruf:
 *   node tools/check-suite.js            alle Skripte, Ausgabe nur bei Rot
 *   node tools/check-suite.js --laut     Ausgabe aller Skripte durchreichen
 *   node tools/check-suite.js saison     nur Skripte mit "saison" im Namen
 *
 * Rückgabe: Exit-Code 1, sobald auch nur ein Skript rot ist.
 */

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const SELBST = basename(fileURLToPath(import.meta.url));

/** Was hier steht, läuft nicht mit – jeder Eintrag braucht eine Begründung. */
const AUSGENOMMEN = {
  'server.js': 'Entwicklungsserver, läuft endlos',
  'build-single.js': 'Erzeuger für das Download-Paket, prüft nichts',
  [SELBST]: 'diese Datei'
};

/** Geduldsgrenze je Skript. Der längste Lauf braucht heute rund 11 Sekunden. */
const ZEITGRENZE_MS = 300000;

/** So viele Zeilen Ausgabe zeigt der Bericht bei einem roten Skript. */
const FEHLER_ZEILEN = 45;

/* ------------------------------------------------------------------ *
 *  Aufrufparameter
 * ------------------------------------------------------------------ */

const argumente = process.argv.slice(2);
const laut = argumente.some(a => a === '--laut' || a === '-l');
const filter = argumente.filter(a => !a.startsWith('-'));

/* ------------------------------------------------------------------ *
 *  Kleinkram
 * ------------------------------------------------------------------ */

const sekunden = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' s';

/** Auf Breite auffüllen – ohne padEnd-Überraschung bei Umlauten. */
const fuellen = (text, breite) => (text.length >= breite ? text : text + ' '.repeat(breite - text.length));

/**
 * Die letzten n Zeilen einer Ausgabe. Leere Schlusszeilen fliegen vorher raus,
 * sonst besteht der halbe Bericht aus Leerraum.
 */
function schwanz(text, n) {
  const zeilen = String(text || '').replace(/\s+$/, '').split('\n');
  return zeilen.slice(Math.max(0, zeilen.length - n));
}

const linie = (zeichen = '─', breite = 64) => zeichen.repeat(breite);

/* ------------------------------------------------------------------ *
 *  Die Skripte finden
 * ------------------------------------------------------------------ */

const alle = readdirSync(HIER)
  .filter(f => f.endsWith('.js'))
  .sort();

const uebersprungen = alle.filter(f => AUSGENOMMEN[f]);
let skripte = alle.filter(f => !AUSGENOMMEN[f]);

if (filter.length) {
  skripte = skripte.filter(f => filter.some(m => f.includes(m)));
}

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  TRAUMVEREIN – Alle Prüfungen                                ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

if (!skripte.length) {
  console.log(filter.length
    ? `  Kein Prüfskript passt auf: ${filter.join(', ')}`
    : '  In tools/ liegt kein einziges Prüfskript. Das kann nicht stimmen.');
  process.exit(1);
}

console.log(`  ${skripte.length} Prüfskript${skripte.length === 1 ? '' : 'e'} in tools/ gefunden` +
  (filter.length ? ` (Filter: ${filter.join(', ')})` : '') + '.');
if (uebersprungen.length) {
  console.log(`  Nicht dabei: ${uebersprungen.map(f => `${f} (${AUSGENOMMEN[f]})`).join(', ')}`);
}
console.log('');

/* ------------------------------------------------------------------ *
 *  Der Aufmarsch
 * ------------------------------------------------------------------ */

const breite = Math.max(...skripte.map(f => f.length)) + 2;
const ergebnisse = [];
const gesamtStart = process.hrtime.bigint();

for (const datei of skripte) {
  // Der Name steht VOR dem Lauf da, das Ergebnis dahinter: So sieht man auch
  // bei einem zehn Sekunden langen Skript, woran es gerade hängt. Kein
  // Zeilenrücklauf – der bleibt in einer umgeleiteten Ausgabe als Müll stehen.
  if (!laut) process.stdout.write('  ' + fuellen(datei, breite));
  else console.log(`\n${linie('═')}\n  ▶ ${datei}\n${linie('═')}`);

  const start = process.hrtime.bigint();
  const lauf = spawnSync(process.execPath, [resolve(HIER, datei)], {
    cwd: WURZEL,
    encoding: 'utf8',
    timeout: ZEITGRENZE_MS,
    maxBuffer: 32 * 1024 * 1024,
    stdio: laut ? 'inherit' : 'pipe'
  });
  const dauer = Number(process.hrtime.bigint() - start) / 1e6;

  let grund = null;
  if (lauf.error && lauf.error.code === 'ETIMEDOUT') grund = `Zeitüberschreitung nach ${sekunden(ZEITGRENZE_MS)}`;
  else if (lauf.error) grund = `Start fehlgeschlagen: ${lauf.error.message}`;
  else if (lauf.signal) grund = `abgebrochen durch Signal ${lauf.signal}`;
  else if (lauf.status !== 0) grund = `Exitcode ${lauf.status}`;

  const ausgabe = laut ? '' : `${lauf.stdout || ''}${lauf.stderr || ''}`;
  ergebnisse.push({ datei, dauer, grund, ausgabe });

  if (!laut) {
    process.stdout.write(`${grund ? '✖' : '✔'} ${fuellen(sekunden(dauer), 8)}${grund || ''}`.replace(/\s+$/, '') + '\n');
  } else if (grund) {
    console.log(`\n  ✖ ${datei}: ${grund}`);
  }
}

const gesamt = Number(process.hrtime.bigint() - gesamtStart) / 1e6;

/* ------------------------------------------------------------------ *
 *  Bericht
 * ------------------------------------------------------------------ */

const rot = ergebnisse.filter(e => e.grund);
const gruen = ergebnisse.length - rot.length;

// Die Ausgabe der roten Skripte – aber nur die, sonst ertrinkt der Bericht.
if (!laut) {
  for (const e of rot) {
    console.log(`\n${linie()}`);
    console.log(`  Ausgabe von ${e.datei} (letzte ${FEHLER_ZEILEN} Zeilen)`);
    console.log(linie());
    for (const z of schwanz(e.ausgabe, FEHLER_ZEILEN)) console.log('  ' + z);
  }
}

const langsamste = ergebnisse.slice().sort((a, b) => b.dauer - a.dauer).slice(0, 3);

console.log(`\n${linie('═')}`);
console.log(`  ${ergebnisse.length} Skripte · ${gruen} grün · ${rot.length} rot · ${sekunden(gesamt)} gesamt`);
console.log(linie('═'));
console.log(`  Längste Läufe: ${langsamste.map(e => `${e.datei} ${sekunden(e.dauer)}`).join(' · ')}`);

if (rot.length) {
  console.log('\n  Rot sind:');
  for (const e of rot) console.log(`    • ${e.datei} – ${e.grund}`);
  console.log('\nDer Platzwart bittet um Nachbesserung.');
  process.exit(1);
}

console.log('\nAlles grün. Der Rasen ist gemäht, die Linien sind gezogen, das Netz hängt.');
