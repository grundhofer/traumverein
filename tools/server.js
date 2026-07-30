#!/usr/bin/env node
/**
 * Entwicklungsserver für Traumverein.
 *
 * Warum nicht `python3 -m http.server`? Weil der weder `Cache-Control` noch
 * `ETag` sendet. Chrome rät dann selbst, wie lange eine Datei frisch bleibt
 * („heuristisches Caching"), und liefert nach einer Änderung munter den alten
 * Stand aus dem Zwischenspeicher weiter – bei ES-Modulen besonders tückisch,
 * weil ein einzelnes veraltetes Modul den Import eines frischen sprengt:
 *
 *     does not provide an export named 'RUNDEN_PRAEMIE'
 *
 * Genau das ist hier passiert, und es hat eine Weile wie ein Codefehler
 * ausgesehen. Dieser Server schickt `Cache-Control: no-store` – was auf der
 * Platte liegt, kommt auch im Browser an.
 *
 * Start:  node tools/server.js [Port]     (Vorgabe 8123)
 * Nur Node-Bordmittel, keine Abhängigkeiten.
 */

import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8123;

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

function fehler(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text + '\n');
}

const server = createServer(async (req, res) => {
  let pfad;
  try {
    pfad = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return fehler(res, 400, 'Ungültige Adresse.');
  }
  if (pfad.endsWith('/')) pfad += 'index.html';

  // Ausbruch aus dem Projektordner verhindern (../../etc/passwd und Verwandte).
  const ziel = resolve(join(WURZEL, normalize(pfad)));
  if (ziel !== WURZEL && !ziel.startsWith(WURZEL + sep)) {
    return fehler(res, 403, 'Außerhalb des Projektordners.');
  }

  let stat;
  try {
    stat = await fs.stat(ziel);
  } catch {
    return fehler(res, 404, `Nicht gefunden: ${pfad}`);
  }
  if (stat.isDirectory()) return fehler(res, 403, 'Kein Verzeichnislisting.');

  res.writeHead(200, {
    'Content-Type': TYPEN[extname(ziel).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    // Der eigentliche Zweck dieser Datei:
    'Cache-Control': 'no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  createReadStream(ziel).pipe(res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} ist belegt. Anderer Port: node tools/server.js 8124`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`Traumverein läuft auf http://localhost:${PORT}`);
  console.log('Zwischenspeicher ist abgeschaltet – Änderungen wirken nach dem Neuladen sofort.');
});
