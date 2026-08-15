/**
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

const FASSUNG = '133601b1e6af';
const SPEICHER = 'traumverein-' + FASSUNG;

const DATEIEN = [
  './',
  'geschichte.html',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'index.html',
  'manifest.webmanifest',
  'src/club/board.js',
  'src/club/chemie.js',
  'src/club/europa.js',
  'src/club/fans.js',
  'src/club/finances.js',
  'src/club/index.js',
  'src/club/karriere.js',
  'src/club/media.js',
  'src/club/medical.js',
  'src/club/morale.js',
  'src/club/national.js',
  'src/club/sponsors.js',
  'src/club/stadium.js',
  'src/club/staff.js',
  'src/club/training.js',
  'src/club/transfers.js',
  'src/club/youth.js',
  'src/core/ballistik.js',
  'src/core/constants.js',
  'src/core/events.js',
  'src/core/loop.js',
  'src/core/rng.js',
  'src/core/state.js',
  'src/core/util.js',
  'src/data/clubs.js',
  'src/data/generator.js',
  'src/data/leagues.js',
  'src/data/names.js',
  'src/data/squads/_helper.js',
  'src/data/squads/gruppe1.js',
  'src/data/squads/gruppe10.js',
  'src/data/squads/gruppe11.js',
  'src/data/squads/gruppe12.js',
  'src/data/squads/gruppe2.js',
  'src/data/squads/gruppe3.js',
  'src/data/squads/gruppe4.js',
  'src/data/squads/gruppe5.js',
  'src/data/squads/gruppe6.js',
  'src/data/squads/gruppe7.js',
  'src/data/squads/gruppe8.js',
  'src/data/squads/gruppe9.js',
  'src/data/squads/index.js',
  'src/engine/match.js',
  'src/engine/ratings.js',
  'src/engine/shootout.js',
  'src/engine/tactics.js',
  'src/game/matchday.js',
  'src/interactive/combination.js',
  'src/interactive/corner.js',
  'src/interactive/finish.js',
  'src/interactive/freekick.js',
  'src/interactive/penalty.js',
  'src/main.js',
  'src/render/kits.js',
  'src/render/pitch.js',
  'src/render/players.js',
  'src/render/portraits.js',
  'src/render/sound.js',
  'src/render/ui.js',
  'src/screens/buero.js',
  'src/screens/chronik.js',
  'src/screens/editor.js',
  'src/screens/einstellungen.js',
  'src/screens/europa.js',
  'src/screens/finanzen.js',
  'src/screens/jugend.js',
  'src/screens/kader.js',
  'src/screens/medizin.js',
  'src/screens/presse.js',
  'src/screens/saison.js',
  'src/screens/spieltag.js',
  'src/screens/stab.js',
  'src/screens/stadion.js',
  'src/screens/tabelle.js',
  'src/screens/taktik.js',
  'src/screens/training.js',
  'src/screens/transfer.js',
  'src/screens/verein.js',
  'styles/main.css',
  'styles/screens.css'
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
