#!/usr/bin/env node
/**
 * make-icons.js — erzeugt die App-Symbole als PNG.
 *
 * Warum selbst schreiben: Dieses Projekt hat keine Abhängigkeiten und keine
 * Bilddateien; Portraits, Wappen und Trikots zeichnet das Spiel im Browser.
 * Ein Symbol aus einem Grafikprogramm wäre die erste Ausnahme. Node bringt
 * zlib mit, und ein PNG ist ohne Filterkunst nur: Kopf, gepackte Zeilen, Ende.
 *
 * Gezeichnet wird der Rasen des Spiels mit einem Ball darauf — dieselben
 * Farbmarken wie styles/main.css.
 *
 * Aufruf:  node tools/make-icons.js
 * Ergebnis: icons/icon-192.png, icons/icon-512.png, icons/icon-maskable-512.png
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZIEL = join(WURZEL, 'icons');

/* ---------------------------------------------------------------- PNG ---- */

const CRC_TABELLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(puffer) {
  let c = 0xffffffff;
  for (let i = 0; i < puffer.length; i++) c = CRC_TABELLE[(c ^ puffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Ein PNG-Abschnitt: Länge, Typ, Daten, Prüfsumme. */
function abschnitt(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const rumpf = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const pruef = Buffer.alloc(4);
  pruef.writeUInt32BE(crc32(rumpf));
  return Buffer.concat([laenge, rumpf, pruef]);
}

/**
 * @param {number} breite
 * @param {number} hoehe
 * @param {Uint8Array} rgba  breite*hoehe*4 Bytes
 */
function pngBauen(breite, hoehe, rgba) {
  const kopf = Buffer.alloc(13);
  kopf.writeUInt32BE(breite, 0);
  kopf.writeUInt32BE(hoehe, 4);
  kopf[8] = 8;    // 8 Bit je Kanal
  kopf[9] = 6;    // Farbtyp 6 = RGBA
  kopf[10] = 0;   // Deflate
  kopf[11] = 0;   // Standardfilter
  kopf[12] = 0;   // kein Interlace

  // Jede Bildzeile bekommt ein führendes Filterbyte (0 = ohne).
  const roh = Buffer.alloc(hoehe * (breite * 4 + 1));
  for (let y = 0; y < hoehe; y++) {
    const ziel = y * (breite * 4 + 1);
    roh[ziel] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * breite * 4, breite * 4).copy(roh, ziel + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    abschnitt('IHDR', kopf),
    abschnitt('IDAT', deflateSync(roh, { level: 9 })),
    abschnitt('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------ Zeichnen --- */

// Dieselben Marken wie styles/main.css
const GRUEN_DUNKEL = [0x1c, 0x4a, 0x22];
const GRUEN_HELL   = [0x27, 0x6b, 0x2a];
const PAPIER       = [0xf2, 0xe8, 0xcf];
const TINTE        = [0x24, 0x1c, 0x10];

/** Fünfeck-Ecken um einen Mittelpunkt, Spitze nach oben. */
function fuenfeck(mx, my, r) {
  const ecken = [];
  for (let i = 0; i < 5; i++) {
    const w = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    ecken.push([mx + Math.cos(w) * r, my + Math.sin(w) * r]);
  }
  return ecken;
}

function imVieleck(px, py, ecken) {
  let drin = false;
  for (let i = 0, j = ecken.length - 1; i < ecken.length; j = i++) {
    const [xi, yi] = ecken[i], [xj, yj] = ecken[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) drin = !drin;
  }
  return drin;
}

/** Abstand eines Punktes zur Strecke a–b. */
function abstandZurStrecke(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const laengeQ = dx * dx + dy * dy;
  let t = laengeQ ? ((px - ax) * dx + (py - ay) * dy) / laengeQ : 0;
  t = Math.max(0, Math.min(1, t));
  const nx = ax + t * dx, ny = ay + t * dy;
  return Math.hypot(px - nx, py - ny);
}

/**
 * Zeichnet Rasen + Ball.
 * @param {number} groesse Kantenlänge in Pixeln
 * @param {number} anteil  wie viel Platz der Ball einnimmt (maskable: kleiner)
 */
function symbolZeichnen(groesse, anteil) {
  const bild = new Uint8Array(groesse * groesse * 4);
  const mitte = groesse / 2;
  const radius = groesse * anteil;
  const kern = fuenfeck(mitte, mitte, radius * 0.42);
  const aussen = fuenfeck(mitte, mitte, radius * 0.95);
  const streifen = groesse / 7;
  // Kantenglättung: je Pixel vier Proben.
  const proben = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];

  for (let y = 0; y < groesse; y++) {
    for (let x = 0; x < groesse; x++) {
      let r = 0, g = 0, b = 0;
      for (const [ox, oy] of proben) {
        const px = x + ox, py = y + oy;
        const entfernung = Math.hypot(px - mitte, py - mitte);
        let farbe;
        if (entfernung > radius) {
          // Rasen mit Schnittbahnen
          farbe = (Math.floor(px / streifen) % 2 === 0) ? GRUEN_DUNKEL : GRUEN_HELL;
        } else {
          farbe = PAPIER;
          // Mittleres Fünfeck
          if (imVieleck(px, py, kern)) farbe = TINTE;
          else {
            // Nähte vom Kern nach außen
            for (let i = 0; i < 5; i++) {
              const dicke = radius * 0.075;
              if (abstandZurStrecke(px, py, kern[i][0], kern[i][1], aussen[i][0], aussen[i][1]) < dicke) {
                farbe = TINTE; break;
              }
            }
          }
          // Dunkler Rand, damit der Ball nicht im Rasen verschwimmt
          if (entfernung > radius * 0.94) farbe = TINTE;
        }
        r += farbe[0]; g += farbe[1]; b += farbe[2];
      }
      const p = (y * groesse + x) * 4;
      bild[p] = Math.round(r / 4);
      bild[p + 1] = Math.round(g / 4);
      bild[p + 2] = Math.round(b / 4);
      bild[p + 3] = 255;
    }
  }
  return pngBauen(groesse, groesse, bild);
}

mkdirSync(ZIEL, { recursive: true });
const dateien = [
  ['icon-192.png', symbolZeichnen(192, 0.36)],
  ['icon-512.png', symbolZeichnen(512, 0.36)],
  // Maskable: Das Betriebssystem darf bis zu 20 % ringsum wegschneiden,
  // deshalb sitzt der Ball hier deutlich kleiner in der Mitte.
  ['icon-maskable-512.png', symbolZeichnen(512, 0.26)]
];
for (const [name, inhalt] of dateien) {
  writeFileSync(join(ZIEL, name), inhalt);
  console.log(`${name}  ${(inhalt.length / 1024).toFixed(1)} KB`);
}
