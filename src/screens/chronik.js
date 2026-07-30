/**
 * screens/chronik.js — Das Gedächtnis des Spiels (Roadmap-Stufe 6, Punkt 1 und 2).
 *
 * Der Bildschirm RECHNET NICHTS NACH, was der Spielstand schon weiß. Er liest:
 *
 *   state.history.seasons   Abschlusstabellen je Saison (core/loop.js:saisonAbschluss)
 *   state.history.titel     Meister, Pokalsieger, Auf-/Absteiger, Torschützenkönig,
 *                           Elf der Saison (club/karriere.js:titelChronik)
 *   state.history.rekorde   Rekordlisten (club/karriere.js)
 *   state.history.transfers Jeder vollzogene Wechsel (club/transfers.js)
 *   state.manager.karriere  Stationen (club/board.js)
 *   state.manager.titel     Titelsammlung (club/karriere.js:managerSaison)
 *   state.players[*].retired  Karriereenden (club/karriere.js:karriereenden)
 *   club/media.js:saisonRueckblick  fertiger deutscher Rückblickstext
 *
 * ZWEI LÜCKEN IM ARCHIV, die dieser Bildschirm nicht selbst schließen darf,
 * weil core/loop.js und club/karriere.js nicht zu seinen Dateien gehören:
 *
 *   1. `saisonAbschluss()` legt je Tabellenzeile nur { clubId, platz, punkte,
 *      diff } ab — Spiele, Siege, Unentschieden, Niederlagen und Tore fallen
 *      beim Archivieren weg. Die ewige Tabelle liest deshalb die erweiterten
 *      Felder OPTIONAL: Sind sie da, erscheinen die Spalten; sind sie es nicht,
 *      bleiben sie weg und eine Fußnote sagt, warum. Wer `saisonAbschluss()`
 *      eines Tages die vollen Zeilen schreiben lässt, füllt diesen Bildschirm
 *      ohne eine weitere Zeile Arbeit.
 *   2. Der Europapokalsieger steht nur für die laufende Spielzeit in
 *      `state.europa.sieger`; ältere Jahrgänge kennt nur die eigene
 *      Titelsammlung. Die Zeitleiste zeigt deshalb, was belegt ist.
 *
 * Grundsatz wie im Saisonabschluss: Fehlt etwas, steht dort ein Platzhalter —
 * und in Saison 1 eine trockene Bemerkung statt einer leeren Tabelle.
 */

import { POSITION_NAMES } from '../core/constants.js';
import { clamp, round, sortBy, nfmt, formatMoney } from '../core/util.js';
import { myClub } from '../core/state.js';
import { LEAGUES, LEAGUE_IDS } from '../data/leagues.js';
import { el, panel, subpanel, table, statBox, pill, tabs, bar } from '../render/ui.js';
import { crestDataURL } from '../render/kits.js';
import { portraitDataURL } from '../render/portraits.js';
import { playerOverall } from '../engine/ratings.js';
import { chronikText, elfDerSaison } from '../club/karriere.js';
import { saisonRueckblick } from '../club/media.js';

/* ================================================================== *
 *  1. Kleinkram
 * ================================================================== */

function sicher(fn, ersatz, label) {
  try {
    return fn();
  } catch (err) {
    if (label) console.warn(`[chronik] ${label} fehlgeschlagen:`, err);
    return ersatz;
  }
}

function leer(text) {
  return el('div.tv-leer', null, text);
}

/** Panelkopf mit rechtsbündigem Zusatz (die Kopfleiste ist ein Flexcontainer). */
function panelKopf(titel, extra) {
  if (!extra) return titel;
  return [
    el('span', null, titel),
    el('span.tv-panel__extra', null, extra)
  ];
}

function wappenBild(club, groesse = 20) {
  const box = el('span.tv-chronik__wappen', {
    style: { width: groesse + 'px', height: groesse + 'px', flex: `0 0 ${groesse}px` }
  });
  if (!club) return box;
  const url = sicher(() => crestDataURL(club, Math.max(32, groesse * 2)), '', 'crestDataURL');
  if (url) {
    box.appendChild(el('img', {
      src: url, alt: club.abbr || club.name,
      style: { width: groesse + 'px', height: groesse + 'px' }
    }));
  } else {
    box.appendChild(el('span.tv-mini', null, club.abbr || '?'));
  }
  return box;
}

function portraitBild(player, groesse, club) {
  const img = el('img.tv-portrait', {
    width: groesse, height: groesse,
    style: { width: groesse + 'px', height: groesse + 'px', flex: `0 0 ${groesse}px` },
    alt: ''
  });
  const url = sicher(() => portraitDataURL(player, groesse * 2, club ? { club } : {}), '', 'portraitDataURL');
  if (url) img.src = url;
  return img;
}

function vereinVon(state, ref) {
  if (!ref) return null;
  const id = typeof ref === 'string' ? ref : (ref.clubId || ref.id || null);
  if (!id) return null;
  return (state.clubs && state.clubs[id]) || null;
}

function spielerVon(state, ref) {
  if (!ref) return null;
  const id = typeof ref === 'string' ? ref : (ref.playerId || ref.id || null);
  if (!id) return null;
  return (state.players && state.players[id]) || null;
}

function spielerName(p, ersatz = 'Unbekannt') {
  if (!p) return ersatz;
  return p.shortName || p.lastName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || ersatz;
}

function vereinName(state, clubId, ersatz = 'unbekannt') {
  const c = vereinVon(state, clubId);
  return c ? (c.name || c.shortName || ersatz) : ersatz;
}

function vereinKurz(state, clubId, ersatz = '–') {
  const c = vereinVon(state, clubId);
  return c ? (c.shortName || c.abbr || c.name || ersatz) : ersatz;
}

function istLegende(p) {
  return !!(p && p.era === 'legend');
}

function ligaName(ligaId) {
  const l = LEAGUES[ligaId];
  return l ? l.name : (ligaId || 'Liga');
}

/** Note im Sportreporterformat: 7,84 statt 7.84. */
function noteText(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return '–';
  return round(v, 2).toFixed(2).replace('.', ',');
}

function komma(v, stellen = 2) {
  const n = Number(v);
  if (!isFinite(n)) return '–';
  return n.toFixed(stellen).replace('.', ',');
}

/** Saison 1 → „2025/26". Die Spielzeit beginnt am 1. Juli (core/util.js). */
function jahrgang(state, saison) {
  const start = ((state.date && state.date.startYear) || 2025) + (Number(saison) || 1) - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Reiterleiste. styles/main.css formt `.tv-tabs` zu einer waagerechten Leiste –
 * das würde Reiterknöpfe und Reiterinhalt nebeneinanderstellen. Inline
 * zurückdrehen, genau wie in screens/tabelle.js und screens/europa.js.
 */
function reiter(items, opts = {}) {
  let t = null;
  t = tabs(items, Object.assign({}, opts, {
    onChange: (id) => {
      if (t) markiereAktiv(t);
      if (opts.onChange) opts.onChange(id);
    }
  }));
  t.style.display = 'block';
  t.style.background = 'none';
  t.style.padding = '0';
  t.style.border = '0';
  const leiste = t.querySelector('.tv-tab-leiste');
  if (leiste) {
    leiste.style.background = 'rgba(0,0,0,.18)';
    leiste.style.padding = '3px 6px 0';
    leiste.style.borderRadius = '3px 3px 0 0';
  }
  markiereAktiv(t);
  return t;
}

function markiereAktiv(t) {
  if (!t || !t.querySelectorAll) return;
  t.querySelectorAll('.tv-tab').forEach(b => b.classList.toggle('aktiv', b.classList.contains('tv-tab--aktiv')));
}

/* ================================================================== *
 *  2. Zugriff auf das Archiv
 * ================================================================== */

function archiv(state) {
  const h = (state && state.history) || {};
  return {
    seasons: Array.isArray(h.seasons) ? h.seasons.filter(Boolean) : [],
    titel: (h.titel && typeof h.titel === 'object') ? h.titel : {},
    rekorde: (h.rekorde && typeof h.rekorde === 'object') ? h.rekorde : {},
    transfers: Array.isArray(h.transfers) ? h.transfers.filter(Boolean) : []
  };
}

/** Die Saisonnummern der Titelchronik, aufsteigend. */
function titelSaisons(state) {
  return Object.keys(archiv(state).titel)
    .map(Number)
    .filter(n => isFinite(n))
    .sort((a, b) => a - b);
}

/** Wie viele Spielzeiten liegen abgeschlossen im Schrank? */
function abgeschlossen(state) {
  const a = archiv(state);
  return Math.max(a.seasons.length, titelSaisons(state).length);
}

/* ================================================================== *
 *  3. Ewige Tabelle
 * ================================================================== */

function neuesKonto(clubId) {
  return {
    id: clubId, clubId,
    saisons: 0, spiele: 0, punkte: 0, diff: 0,
    s: 0, u: 0, n: 0, tore: 0, gegentore: 0,
    detailErgebnisse: 0, detailTore: 0,
    beste: null, schlechteste: null,
    meister: 0, pokal: 0
  };
}

/**
 * Die ewige Tabelle einer Liga über alle abgeschlossenen Spielzeiten.
 *
 * Spiele: `saisonAbschluss()` archiviert sie nicht. Für eine abgeschlossene
 * Spielzeit sind sie aber eindeutig — jeder gegen jeden, hin und zurück —, also
 * (Vereine − 1) × 2. Steht in der Zeile doch eine Spielzahl, gilt die.
 * Siege, Unentschieden, Niederlagen und Tore werden NICHT geraten: Punkte und
 * Spielzahl lassen mehrere Kombinationen zu. Sie erscheinen nur, wenn sie im
 * Archiv stehen.
 */
function ewigeTabelle(state, ligaId) {
  const a = archiv(state);
  const konten = new Map();
  const konto = (clubId) => {
    let k = konten.get(clubId);
    if (!k) { k = neuesKonto(clubId); konten.set(clubId, k); }
    return k;
  };

  let saisons = 0;
  let mitErgebnissen = 0;
  let mitToren = 0;

  for (const b of a.seasons) {
    const zeilen = (b.tabellen && b.tabellen[ligaId]) || [];
    if (!zeilen.length) continue;
    saisons++;
    const spieleVoll = Math.max(0, (zeilen.length - 1) * 2);
    let hatErgebnisse = false;
    let hatTore = false;

    for (const z of zeilen) {
      if (!z || !z.clubId) continue;
      const k = konto(z.clubId);
      k.saisons++;
      k.punkte += Number(z.punkte) || 0;
      k.diff += Number(z.diff) || 0;
      k.spiele += Number.isFinite(z.spiele) ? z.spiele : spieleVoll;

      if (Number.isFinite(z.s) && Number.isFinite(z.u) && Number.isFinite(z.n)) {
        k.s += z.s; k.u += z.u; k.n += z.n; k.detailErgebnisse++;
        hatErgebnisse = true;
      }
      if (Number.isFinite(z.tore) && Number.isFinite(z.gegentore)) {
        k.tore += z.tore; k.gegentore += z.gegentore; k.detailTore++;
        hatTore = true;
      }

      const platz = Number(z.platz) || 0;
      if (platz > 0) {
        if (k.beste === null || platz < k.beste) k.beste = platz;
        if (k.schlechteste === null || platz > k.schlechteste) k.schlechteste = platz;
        if (platz === 1) k.meister++;
      }
    }
    if (hatErgebnisse) mitErgebnissen++;
    if (hatTore) mitToren++;
  }

  // Pokalsiege stehen in der Titelchronik, nicht in der Ligatabelle. Sie zählen
  // nur für Vereine, die in dieser Liga überhaupt vorkommen.
  for (const s of titelSaisons(state)) {
    const e = a.titel[s];
    if (e && e.pokalsieger && konten.has(e.pokalsieger)) konten.get(e.pokalsieger).pokal++;
  }

  const zeilen = sortBy(Array.from(konten.values()),
    k => ({ key: k.punkte, desc: true }),
    k => ({ key: k.diff, desc: true }),
    k => ({ key: k.tore, desc: true }),
    k => k.clubId);
  zeilen.forEach((k, i) => {
    k.rang = i + 1;
    k.schnitt = k.spiele > 0 ? k.punkte / k.spiele : 0;
  });

  return {
    zeilen, saisons,
    vollErgebnisse: saisons > 0 && mitErgebnissen === saisons,
    vollTore: saisons > 0 && mitToren === saisons
  };
}

function ewigeTabellePanel(ctx, ligaId) {
  const s = ctx.state;
  const club = sicher(() => myClub(s), null, 'myClub');
  const erg = ewigeTabelle(s, ligaId);

  if (!erg.saisons) {
    return panel(panelKopf(`Ewige Tabelle · ${ligaName(ligaId)}`, `Saison ${s.date.season}`),
      leer('Noch keine abgeschlossene Spielzeit. Eine ewige Tabelle, die eine Saison alt ist, ' +
        'wäre auch nur eine Tabelle mit größerer Schrift.'));
  }

  const spalten = [
    { key: 'rang', label: '#', numeric: true, width: 38 },
    {
      key: 'name', label: 'Verein', sortable: false,
      render: (row) => {
        const c = vereinVon(s, row.clubId);
        return el('span.tv-chronik__marke', null,
          wappenBild(c, 20),
          el('span', null, c ? (c.name || c.shortName) : row.clubId));
      }
    },
    { key: 'saisons', label: 'Sa.', numeric: true, width: 46, title: 'Spielzeiten in dieser Liga' },
    { key: 'spiele', label: 'Sp', numeric: true, width: 52 }
  ];

  if (erg.vollErgebnisse) {
    spalten.push(
      { key: 's', label: 'S', numeric: true, width: 46 },
      { key: 'u', label: 'U', numeric: true, width: 46 },
      { key: 'n', label: 'N', numeric: true, width: 46 });
  }
  if (erg.vollTore) {
    spalten.push({
      key: 'tore', label: 'Tore', numeric: true, width: 78,
      render: (row) => `${nfmt(row.tore)}:${nfmt(row.gegentore)}`
    });
  }

  spalten.push(
    { key: 'diff', label: 'Diff', numeric: true, width: 58, render: (row) => (row.diff > 0 ? '+' : '') + nfmt(row.diff) },
    { key: 'punkte', label: 'Punkte', numeric: true, width: 66, cellClass: () => 'tv-num' },
    { key: 'schnitt', label: 'Ø', numeric: true, width: 52, title: 'Punkte je Spiel', render: (row) => komma(row.schnitt) },
    { key: 'beste', label: 'Beste', numeric: true, width: 58, render: (row) => row.beste ? `${row.beste}.` : '–' },
    { key: 'schlechteste', label: 'Schl.', numeric: true, width: 58, title: 'schlechteste Platzierung', render: (row) => row.schlechteste ? `${row.schlechteste}.` : '–' },
    {
      key: 'meister', label: '🏆', numeric: true, width: 56,
      title: 'Meisterschaften in dieser Liga · Pokalsiege',
      render: (row) => (row.meister || row.pokal)
        ? el('span.tv-chronik__titelchen', null,
          row.meister ? `${row.meister}× M` : '',
          row.meister && row.pokal ? ' · ' : '',
          row.pokal ? `${row.pokal}× P` : '')
        : '–'
    });

  const fussnote = [];
  if (!erg.vollErgebnisse || !erg.vollTore) {
    fussnote.push('Das Archiv notiert je Spielzeit Platz, Punkte und Tordifferenz. ' +
      'Siege, Unentschieden und Tore stehen erst hier, wenn der Saisonabschluss sie mitschreibt — ' +
      'bis dahin muss die Differenz reichen. Erfunden wird an dieser Stelle nichts.');
  }
  fussnote.push(`Spiele je Spielzeit aus der Ligagröße gerechnet: jeder gegen jeden, hin und zurück.`);

  return panel(
    panelKopf(`Ewige Tabelle · ${ligaName(ligaId)}`,
      `${erg.saisons} abgeschlossene Spielzeit${erg.saisons === 1 ? '' : 'en'}`),
    el('div.tv-spalte',
      table(spalten, erg.zeilen, {
        compact: true,
        idKey: 'id',
        sort: { key: 'punkte', desc: true },
        rowClass: (row) => (club && row.clubId === club.id) ? 'eigen' : null,
        emptyText: 'Keine Vereine im Archiv.'
      }),
      el('div.tv-chronik__fussnote', null, fussnote.join(' '))));
}

function ewigTab(ctx) {
  const box = el('div.tv-spalte');
  for (const ligaId of LEAGUE_IDS) {
    box.appendChild(sicher(() => ewigeTabellePanel(ctx, ligaId),
      panel(`Ewige Tabelle · ${ligaName(ligaId)}`, leer('Diese Tabelle ließ sich nicht aufstellen.')),
      'ewigeTabelle ' + ligaId));
  }
  return box;
}

/* ================================================================== *
 *  4. Titelchronik als Zeitleiste
 * ================================================================== */

/**
 * Europapokalsiege, die belegt sind.
 *
 * Zwei Quellen, mehr gibt der Spielstand nicht her: `state.europa.sieger` gilt
 * ausschließlich für die laufende Spielzeit (club/europa.js setzt das Feld bei
 * jeder Auslosung zurück), und `manager.titel` hält die eigenen Erfolge auf
 * Dauer. Fremde Europapokalsieger vergangener Jahre stehen nirgends — deshalb
 * bleibt die Zeile leer, statt etwas zu behaupten.
 */
function europaSieger(state, saison) {
  const namen = { cl: 'Champions League', el: 'Europa League', conf: 'Conference League' };
  const gefunden = new Map();
  const eu = state.europa || {};
  if (eu.sieger && Number(eu.saison) === Number(saison)) {
    for (const wb of ['cl', 'el', 'conf']) {
      if (eu.sieger[wb]) gefunden.set(namen[wb], { wettbewerb: namen[wb], clubId: eu.sieger[wb] });
    }
  }
  const titel = (state.manager && Array.isArray(state.manager.titel)) ? state.manager.titel : [];
  for (const t of titel) {
    if (!t || typeof t !== 'object' || Number(t.season) !== Number(saison)) continue;
    const name = String(t.name || '');
    if (!/League-Sieger$/.test(name)) continue;
    const wb = name.replace('-Sieger', '').replace('-', ' ');
    gefunden.set(wb, { wettbewerb: wb, clubId: t.clubId || null });
  }
  return Array.from(gefunden.values());
}

/** Eine Zeile in der Jahreskarte: Etikett links, Inhalt rechts. */
function jahrZeile(etikett, inhalt, klasse) {
  return el('div.tv-chronik__zeile', { class: klasse || null },
    el('div.tv-chronik__etikett', null, etikett),
    el('div.tv-chronik__wert', null, inhalt));
}

function vereinsMarke(state, clubId, opts = {}) {
  const c = vereinVon(state, clubId);
  const marke = el('span.tv-chronik__marke', { class: opts.eigen ? 'eigen' : null },
    wappenBild(c, opts.groesse || 20),
    el('span', null, c ? (opts.lang ? c.name : c.shortName) : (clubId || '–')));
  return marke;
}

function jahresKarte(state, saison, club) {
  const a = archiv(state);
  const e = a.titel[saison] || {};
  const meineId = club ? club.id : null;
  const meineTitel = (state.manager && Array.isArray(state.manager.titel) ? state.manager.titel : [])
    .filter(t => t && typeof t === 'object' && Number(t.season) === Number(saison));

  const eigenerMeister = !!(meineId && e.meister === meineId);
  const eigenerPokal = !!(meineId && e.pokalsieger === meineId);

  const karte = el('div.tv-chronik__jahr', {
    class: (eigenerMeister || eigenerPokal || meineTitel.length) ? 'tv-chronik__jahr--eigen' : null
  });

  karte.appendChild(el('div.tv-chronik__jahrKopf', null,
    el('span.tv-chronik__jahrNr', null, `Saison ${saison}`),
    el('span.tv-chronik__jahrJahr', null, jahrgang(state, saison)),
    e.managerPlatz
      ? el('span.tv-chronik__jahrPlatz', null,
        `${vereinKurz(state, e.managerVerein)} · ${e.managerPlatz}. in der ${ligaName(e.managerLiga)}`)
      : null));

  karte.appendChild(jahrZeile('Meister',
    e.meister
      ? el('span.tv-zeile', { style: { gap: '7px', flexWrap: 'wrap' } },
        vereinsMarke(state, e.meister, { lang: true, groesse: 24, eigen: eigenerMeister }),
        eigenerMeister ? pill('Ihr Titel', 'legende') : null)
      : el('span.tv-mini', null, 'nicht vergeben'),
    eigenerMeister ? 'tv-chronik__zeile--gold' : null));

  karte.appendChild(jahrZeile('Pokalsieger',
    e.pokalsieger
      ? el('span.tv-zeile', { style: { gap: '7px', flexWrap: 'wrap' } },
        vereinsMarke(state, e.pokalsieger, { lang: true, groesse: 22, eigen: eigenerPokal }),
        eigenerPokal ? pill('Ihr Titel', 'legende') : null)
      : el('span.tv-mini', null, 'kein Endspiel entschieden'),
    eigenerPokal ? 'tv-chronik__zeile--gold' : null));

  const euro = europaSieger(state, saison);
  if (euro.length) {
    karte.appendChild(jahrZeile('Europapokal',
      el('div.tv-spalte', { style: { gap: '3px' } },
        ...euro.map(x => el('span.tv-zeile', { style: { gap: '6px' } },
          el('span.tv-mini', { style: { minWidth: '120px' } }, x.wettbewerb),
          x.clubId ? vereinsMarke(state, x.clubId, { eigen: x.clubId === meineId }) : el('span.tv-mini', null, '–')))),
      euro.some(x => x.clubId === meineId) ? 'tv-chronik__zeile--gold' : null));
  }

  const tk = e.torschuetzenkoenig;
  karte.appendChild(jahrZeile('Torschützenkrone',
    tk && tk.tore
      ? el('span.tv-zeile', { style: { gap: '7px', flexWrap: 'wrap' } },
        portraitBild(spielerVon(state, tk), 24, vereinVon(state, tk.clubId)),
        el('b', null, tk.name || spielerName(spielerVon(state, tk))),
        el('span.tv-mini', null, `${vereinKurz(state, tk.clubId)} · ${tk.tore} Tore in ${tk.spiele || '?'} Spielen`))
      : el('span.tv-mini', null, 'niemand hat getroffen')));

  const auf = Array.isArray(e.aufsteiger) ? e.aufsteiger : [];
  const ab = Array.isArray(e.absteiger) ? e.absteiger : [];
  karte.appendChild(jahrZeile('Aufsteiger',
    auf.length
      ? el('span.tv-zeile', { style: { gap: '9px', flexWrap: 'wrap' } },
        ...auf.map(id => vereinsMarke(state, id, { eigen: id === meineId })))
      : el('span.tv-mini', null, '–')));
  karte.appendChild(jahrZeile('Absteiger',
    ab.length
      ? el('span.tv-zeile', { style: { gap: '9px', flexWrap: 'wrap' } },
        ...ab.map(id => vereinsMarke(state, id, { eigen: id === meineId })))
      : el('span.tv-mini', null, '–')));

  if (meineTitel.length) {
    karte.appendChild(jahrZeile('Ihre Vitrine',
      el('span.tv-zeile', { style: { gap: '5px', flexWrap: 'wrap' } },
        ...meineTitel.map(t => pill(`🏆 ${t.name}`, 'legende'))),
      'tv-chronik__zeile--gold'));
  }

  const satz = sicher(() => chronikText(state, saison), '', 'chronikText');
  if (satz) karte.appendChild(el('div.tv-chronik__jahrText', null, satz));

  return karte;
}

function titelTab(ctx) {
  const s = ctx.state;
  const club = sicher(() => myClub(s), null, 'myClub');
  const saisons = titelSaisons(s);

  if (!saisons.length) {
    return panel(panelKopf('Titelchronik', `Saison ${s.date.season}`),
      leer('Die Chronik ist noch ein leeres Buch. Der erste Eintrag wird im Sommer geschrieben — ' +
        'wie er ausfällt, entscheiden Sie zwischen jetzt und dem 34. Spieltag.'));
  }

  const box = el('div.tv-chronik__zeitleiste');
  for (const saison of saisons.slice().reverse()) {
    box.appendChild(sicher(() => jahresKarte(s, saison, club),
      el('div.tv-chronik__jahr', null, leer(`Saison ${saison} ließ sich nicht aufschlagen.`)),
      'jahresKarte ' + saison));
  }

  const eigene = (s.manager && Array.isArray(s.manager.titel) ? s.manager.titel : []).length;

  return panel(
    panelKopf('Titelchronik', `${saisons.length} Spielzeit${saisons.length === 1 ? '' : 'en'} · ${eigene} eigene Titel`),
    el('div.tv-spalte',
      box,
      el('div.tv-chronik__fussnote', null,
        'Die Europapokalzeile erscheint nur, wo ein Sieger belegt ist: Der Verband führt die Endspiele ' +
        'fremder Vereine nicht über die Spielzeit hinaus, die eigenen Titel dagegen für immer.')));
}

/* ================================================================== *
 *  5. Rekorde
 * ================================================================== */

function rekordKarte(titel, wert, unterzeile, opts = {}) {
  return el('div.tv-chronik__rekord', { class: opts.gold ? 'tv-chronik__rekord--gold' : null },
    el('div.tv-chronik__rekordTitel', null, titel),
    el('div.tv-chronik__rekordWert', null, wert),
    el('div.tv-chronik__rekordSub', null, unterzeile || ''));
}

/** Teuerster Transfer, größte Ablösesumme über alle archivierten Wechsel. */
function teuersterTransfer(state) {
  const t = archiv(state).transfers;
  let best = null;
  for (const e of t) {
    const ablose = Number(e.ablose) || 0;
    if (ablose <= 0) continue;
    if (!best || ablose > best.ablose || (ablose === best.ablose && String(e.playerId) < String(best.playerId))) best = e;
  }
  return best;
}

/**
 * Der jüngste Debütant seit Spielbeginn.
 *
 * Ein Debütdatum steht nirgends im Spielstand — abzulesen ist es aber aus
 * `p.stats.history`: `loop.js:spielerFortschreiben` legt dort je Spielzeit
 * genau dann einen Eintrag ab, wenn der Mann gespielt hat. Der erste Eintrag
 * ist also die erste Saison mit Einsatz.
 *
 * ZWEI GRENZEN, die hier ernst genommen werden, statt sie zu überschreiben:
 * Die Liste wird bei 12 Einträgen vorne gekappt, und `karriere.js:verdichten`
 * kürzt sie beim Karriereende auf drei. In beiden Fällen wäre der erste Eintrag
 * nicht mehr der erste Einsatz — solche Spieler bleiben deshalb draußen.
 * Das Alter zum Zeitpunkt X ergibt sich aus dem heutigen Alter minus der
 * Anzahl Spielzeiten seither (`p.age` wächst genau einmal je Saisonwechsel).
 */
function juengsterDebuetant(state) {
  const heute = Number(state.date.season) || 1;
  let best = null;
  for (const pid of Object.keys(state.players || {}).sort()) {
    const p = state.players[pid];
    if (!p || p.retired || !p.stats) continue;
    const hist = Array.isArray(p.stats.history) ? p.stats.history : [];
    if (hist.length >= 12) continue;                 // vorne gekappt – nicht belegbar

    let saison = null;
    if (hist.length) saison = Number(hist[0].season);
    else if ((p.stats.season && p.stats.season.spiele) > 0) saison = heute;
    if (!isFinite(saison) || saison <= 0) continue;

    const alter = (Number(p.age) || 0) - (heute - saison);
    if (!isFinite(alter) || alter <= 12 || alter > 45) continue;
    const clubId = (hist.length ? hist[0].clubId : null) || p.clubId || null;
    if (!best || alter < best.alter || (alter === best.alter && saison < best.season)) {
      best = { player: p, alter, season: saison, clubId };
    }
  }
  return best;
}

/**
 * Längste Serie ohne Gegentor — die einzige Zahl auf dieser Seite, die nicht im
 * Archiv steht. `karriere.js:saisonRekordeMessen` misst nur Siegesserien, und
 * die Partien der Vorjahre räumt `loop.js:spielplaeneNeu` weg. Was hier zählbar
 * bleibt, ist die laufende Spielzeit — und genau so ist die Karte beschriftet.
 */
function serieOhneGegentor(state) {
  const saison = Number(state.date.season);
  const partien = (state.fixtures || []).filter(f =>
    f && f.played && f.season === saison && f.result && Array.isArray(f.result.score) &&
    typeof f.result.score[0] === 'number' && typeof f.result.score[1] === 'number');
  const nachTag = sortBy(partien, f => Number(f.dayIndex) || 0, f => String(f.id || ''));

  const stand = new Map();
  let best = null;
  for (const f of nachTag) {
    const [h, a] = f.result.score;
    for (const [clubId, kassiert] of [[f.homeId, a], [f.awayId, h]]) {
      if (!clubId) continue;
      const laenge = kassiert === 0 ? (stand.get(clubId) || 0) + 1 : 0;
      stand.set(clubId, laenge);
      if (laenge > 0 && (!best || laenge > best.laenge ||
        (laenge === best.laenge && String(clubId) < String(best.clubId)))) {
        best = { clubId, laenge, saison };
      }
    }
  }
  return best;
}

/** Meiste Spiele und meiste Tore über die gesamte Laufbahn — aus den Karrieredaten. */
function spielerBestenlisten(state) {
  const alle = [];
  for (const pid of Object.keys(state.players || {}).sort()) {
    const p = state.players[pid];
    const c = p && p.stats && p.stats.career;
    if (!c) continue;
    if (!(c.spiele > 0)) continue;
    alle.push({
      id: p.id, player: p, spiele: c.spiele || 0, tore: c.tore || 0,
      vorlagen: c.vorlagen || 0, zuNull: c.zuNull || 0,
      clubId: p.clubId || (p.retired && p.retired.clubId) || null,
      raus: !!p.retired
    });
  }
  return {
    spiele: sortBy(alle, e => ({ key: e.spiele, desc: true }), e => e.id).slice(0, 10),
    tore: sortBy(alle.filter(e => e.tore > 0), e => ({ key: e.tore, desc: true }), e => e.id).slice(0, 10)
  };
}

function bestenlistePanel(state, titel, liste, wertFn, einheit) {
  if (!liste.length) {
    return subpanel(titel, leer('Noch keine Zahlen, die diesen Namen verdienen.'));
  }
  return subpanel(titel, el('div.tv-spalte', { style: { gap: '2px' } },
    ...liste.map((e, i) => {
      const c = vereinVon(state, e.clubId);
      return el('div.tv-chronik__listenZeile', null,
        el('span.tv-chronik__listenRang', null, `${i + 1}.`),
        portraitBild(e.player, 24, c),
        el('span.tv-chronik__listenName', null,
          el('b', null, spielerName(e.player)),
          el('span.tv-mini', null,
            [c ? c.shortName : null, e.raus ? 'Karriere beendet' : null].filter(Boolean).join(' · '))),
        istLegende(e.player) ? el('span.tv-chronik__stern', null, '★') : null,
        el('b.tv-num', null, `${nfmt(wertFn(e))} ${einheit}`));
    })));
}

function rekordeTab(ctx) {
  const s = ctx.state;
  const a = archiv(s);
  const r = a.rekorde;
  const fertige = abgeschlossen(s);

  const karten = el('div.tv-chronik__rekorde');

  karten.appendChild(r.hoechsterSieg
    ? rekordKarte('Höchster Sieg', r.hoechsterSieg.text || '–',
      `Saison ${r.hoechsterSieg.season} · ${(LEAGUES[r.hoechsterSieg.wettbewerb] || {}).name || 'Pokal'} · ` +
      `${r.hoechsterSieg.differenz} Tore Unterschied`, { gold: true })
    : rekordKarte('Höchster Sieg', '–', 'Noch hat niemand jemanden vorgeführt.'));

  karten.appendChild(r.meisteToreSaison
    ? rekordKarte('Meiste Tore in einer Saison', `${r.meisteToreSaison.tore}`,
      `${r.meisteToreSaison.name || spielerName(spielerVon(s, r.meisteToreSaison))} · ` +
      `${vereinKurz(s, r.meisteToreSaison.clubId)} · Saison ${r.meisteToreSaison.season}`, { gold: true })
    : rekordKarte('Meiste Tore in einer Saison', '–', 'Die Torschützenkrone wartet noch auf ihren ersten Träger.'));

  karten.appendChild(r.meistePunkteSaison
    ? rekordKarte('Meiste Punkte in einer Saison', `${r.meistePunkteSaison.punkte}`,
      `${r.meistePunkteSaison.name || vereinName(s, r.meistePunkteSaison.clubId)} · Saison ${r.meistePunkteSaison.season}`)
    : rekordKarte('Meiste Punkte in einer Saison', '–', 'Noch keine Spielzeit abgerechnet.'));

  karten.appendChild(r.laengsteSerie
    ? rekordKarte('Längste Siegesserie', `${r.laengsteSerie.laenge} Siege`,
      `${r.laengsteSerie.name || vereinName(s, r.laengsteSerie.clubId)} · Saison ${r.laengsteSerie.season}`)
    : rekordKarte('Längste Siegesserie', '–', 'Zwei Siege hintereinander nennt hier noch niemand eine Serie.'));

  karten.appendChild(r.meisteTitel
    ? rekordKarte('Rekordtitelträger', `${r.meisteTitel.anzahl} Titel`,
      `${r.meisteTitel.name || vereinName(s, r.meisteTitel.clubId)} · ` +
      `${r.meisteTitel.meister || 0}× Meister, ${r.meisteTitel.pokal || 0}× Pokal`, { gold: true })
    : rekordKarte('Rekordtitelträger', '–', 'Die Vitrine der Liga ist noch abgeschlossen.'));

  const teuer = teuersterTransfer(s);
  karten.appendChild(teuer
    ? rekordKarte('Teuerster Transfer', formatMoney(teuer.ablose),
      `${teuer.name || spielerName(spielerVon(s, teuer))} · ` +
      `${teuer.vonId ? vereinKurz(s, teuer.vonId) : 'ablösefrei'} → ${vereinKurz(s, teuer.zuId)} · Saison ${teuer.season}`)
    : rekordKarte('Teuerster Transfer', '–', 'Bisher wurde nur geredet, nicht gezahlt.'));

  const debuet = juengsterDebuetant(s);
  karten.appendChild(debuet
    ? rekordKarte('Jüngster Debütant', `${komma(debuet.alter, 0)} Jahre`,
      `${spielerName(debuet.player)} · ${vereinKurz(s, debuet.clubId)}` +
      (debuet.season ? ` · Saison ${debuet.season}` : ''))
    : rekordKarte('Jüngster Debütant', '–',
      'Das Debütalter wird im Spielstand nicht mitgeschrieben — hier bleibt der Platz frei.'));

  const weiss = sicher(() => serieOhneGegentor(s), null, 'serieOhneGegentor');
  karten.appendChild(weiss
    ? rekordKarte('Längste Serie ohne Gegentor', `${weiss.laenge} Spiele`,
      `${vereinName(s, weiss.clubId)} · laufende Spielzeit ${weiss.saison}`)
    : rekordKarte('Längste Serie ohne Gegentor', '–',
      'In dieser Spielzeit hat noch jeder etwas kassiert.'));

  const listen = spielerBestenlisten(s);

  return el('div.tv-spalte',
    panel(panelKopf('Rekordbuch', fertige ? `Stand nach ${fertige} Spielzeit${fertige === 1 ? '' : 'en'}` : `Saison ${s.date.season}`),
      el('div.tv-spalte',
        karten,
        el('div.tv-chronik__fussnote', null,
          'Höchster Sieg, meiste Tore, meiste Punkte, längste Siegesserie und Rekordtitelträger führt das ' +
          'Archiv über alle Jahre. Die weiße Weste zählt nur die laufende Spielzeit: Die Spielberichte der ' +
          'Vorjahre werden im Sommer eingestampft, und diese eine Serie schreibt niemand mit.'))),
    panel('Bestenlisten',
      el('div.tv-grid.tv-grid--2',
        bestenlistePanel(s, 'Meiste Pflichtspiele', listen.spiele, e => e.spiele, 'Spiele'),
        bestenlistePanel(s, 'Meiste Tore', listen.tore, e => e.tore, 'Tore'))));
}

/* ================================================================== *
 *  6. Ruhmeshalle
 * ================================================================== */

/**
 * Der Abschiedsbrief, den club/karriere.js seinerzeit ins Postfach gelegt hat.
 * Er existiert nur für Spieler des eigenen Vereins — fremde Legenden liefen
 * über den Ticker. Fehlt er, steht unten der Grund aus `p.retired`.
 */
function abschiedsText(state, p) {
  const name = spielerName(p);
  const inbox = Array.isArray(state.inbox) ? state.inbox : [];
  for (const m of inbox) {
    if (!m || m.kind !== 'karriere' || !m.subject || !m.body) continue;
    // Betreff ist „Abschiedsspiel: Name" oder „Karriereende: Name". Exakt
    // vergleichen, sonst erwischt ein Teilstring den falschen Müller.
    const teile = String(m.subject).split(':');
    if (teile.length < 2) continue;
    if (teile[teile.length - 1].trim() !== name) continue;
    return m.body;
  }
  return null;
}

function ruhmKarte(state, p) {
  const c = vereinVon(state, (p.retired && p.retired.clubId) || p.clubId);
  const legende = istLegende(p);
  const st = (p.stats && p.stats.career) || {};
  const ovr = sicher(() => playerOverall(p), 0, 'playerOverall');
  const brief = abschiedsText(state, p);

  const zahl = (label, wert) => el('div.tv-chronik__zahl', null,
    el('b', null, wert), el('span', null, label));

  return el('div.tv-chronik__karte', { class: legende ? 'tv-chronik__karte--legende' : null },
    el('div.tv-zeile', { style: { gap: '9px', alignItems: 'flex-start' } },
      portraitBild(p, 64, c),
      el('div', { style: { minWidth: '0', flex: '1' } },
        el('div.tv-zeile', { style: { gap: '6px', flexWrap: 'wrap' } },
          el('b', { style: { fontSize: '15px' } }, `${p.firstName || ''} ${p.lastName || ''}`.trim() || spielerName(p)),
          legende ? pill(p.eraLabel || 'Vereinslegende', 'legende') : null),
        el('div.tv-mini', null,
          [POSITION_NAMES[p.position] || p.position || '?',
            c ? c.name : 'vereinslos',
            p.retired ? `Karriereende Saison ${p.retired.season} mit ${p.retired.alter} Jahren` : null
          ].filter(Boolean).join(' · ')),
        el('div.tv-mini', null, (p.retired && p.retired.grund) ? `Grund: ${p.retired.grund}` : ''))),
    el('div.tv-chronik__zahlen',
      zahl('Spiele', nfmt(st.spiele || 0)),
      zahl('Tore', nfmt(st.tore || 0)),
      zahl('Vorlagen', nfmt(st.vorlagen || 0)),
      zahl('Zu Null', nfmt(st.zuNull || 0)),
      zahl('Stärke', String(ovr || '–'))),
    el('div.tv-chronik__nachruf', null,
      brief || (legende
        ? 'Er hängt die Schuhe an den Nagel. Beim nächsten Anpfiff wird das Stadion eine Sekunde stiller sein.'
        : 'Ein Profileben, das niemand in der Sportschau zusammenfassen wird — aber eines, das sich gelohnt hat.')));
}

function ruhmTab(ctx) {
  const s = ctx.state;
  const club = sicher(() => myClub(s), null, 'myClub');

  const alle = [];
  for (const pid of Object.keys(s.players || {}).sort()) {
    const p = s.players[pid];
    if (p && p.retired) alle.push(p);
  }

  if (!alle.length) {
    return panel(panelKopf('Ruhmeshalle', `Saison ${s.date.season}`),
      leer('Noch hat niemand aufgehört. Die Halle ist gefegt, die Vitrinen sind geputzt, ' +
        'und der Hausmeister hofft, dass das noch eine Weile so bleibt.'));
  }

  const sortiert = sortBy(alle,
    p => ({ key: istLegende(p) ? 1 : 0, desc: true }),
    p => ({ key: (p.retired && p.retired.season) || 0, desc: true }),
    p => ({ key: (p.stats && p.stats.career && p.stats.career.spiele) || 0, desc: true }),
    p => p.id);

  const legenden = sortiert.filter(p => istLegende(p));
  const eigene = sortiert.filter(p => !istLegende(p) && club &&
    ((p.retired && p.retired.clubId) === club.id));
  const eigeneIds = new Set(eigene.map(p => p.id));
  const rest = sortiert.filter(p => !istLegende(p) && !eigeneIds.has(p.id));

  const box = el('div.tv-spalte');

  if (legenden.length) {
    box.appendChild(panel(
      panelKopf('Die Legenden treten ab', `${legenden.length} Vereinslegende${legenden.length === 1 ? '' : 'n'}`),
      el('div.tv-spalte',
        el('div.tv-chronik__fussnote', null,
          'Sie kamen aus einer anderen Zeit und haben trotzdem gespielt, als hätten sie nie aufgehört. ' +
          'Wer eine von ihnen in der Elf hatte, weiß, wovon hier die Rede ist.'),
        el('div.tv-chronik__halle', null, ...legenden.map(p =>
          sicher(() => ruhmKarte(s, p), el('div.tv-chronik__karte', null, spielerName(p)), 'ruhmKarte'))))));
  }

  if (eigene.length) {
    box.appendChild(panel(panelKopf('Aus dem eigenen Kader', `${eigene.length}`),
      el('div.tv-chronik__halle', null, ...eigene.map(p =>
        sicher(() => ruhmKarte(s, p), el('div.tv-chronik__karte', null, spielerName(p)), 'ruhmKarte')))));
  }

  if (rest.length) {
    const zeilen = rest.map(p => {
      const st = (p.stats && p.stats.career) || {};
      return {
        id: p.id,
        name: spielerName(p),
        verein: vereinKurz(s, (p.retired && p.retired.clubId) || p.clubId),
        saison: (p.retired && p.retired.season) || null,
        alter: (p.retired && p.retired.alter) || p.age || null,
        spiele: st.spiele || 0,
        tore: st.tore || 0,
        position: POSITION_NAMES[p.position] || p.position || '–'
      };
    });
    box.appendChild(panel(panelKopf('Weitere Karriereenden', `${rest.length}`),
      table([
        { key: 'name', label: 'Spieler' },
        { key: 'position', label: 'Position' },
        { key: 'verein', label: 'Zuletzt bei' },
        { key: 'saison', label: 'Saison', numeric: true, width: 62, render: r => r.saison || '–' },
        { key: 'alter', label: 'Alter', numeric: true, width: 56, render: r => r.alter || '–' },
        { key: 'spiele', label: 'Spiele', numeric: true, width: 62 },
        { key: 'tore', label: 'Tore', numeric: true, width: 56 }
      ], zeilen, { compact: true, maxHeight: 340, sort: { key: 'saison', desc: true } })));
  }

  return box;
}

/* ================================================================== *
 *  7. Meine Laufbahn
 * ================================================================== */

/** Platz und Punkte des eigenen Vereins je abgeschlossener Spielzeit. */
function laufbahnPunkte(state) {
  const a = archiv(state);
  const punkte = [];
  for (const b of a.seasons) {
    const saison = Number(b.season);
    if (!isFinite(saison)) continue;
    const e = a.titel[saison] || {};
    const clubId = e.managerVerein || state.managerClubId;
    const ligaId = e.managerLiga ||
      (LEAGUE_IDS.find(id => ((b.tabellen && b.tabellen[id]) || []).some(z => z && z.clubId === clubId)) || 'bl1');
    const zeile = ((b.tabellen && b.tabellen[ligaId]) || []).find(z => z && z.clubId === clubId) || null;
    const platz = Number(b.eigenerPlatz) || (zeile ? Number(zeile.platz) : 0) ||
      Number(e.managerPlatz) || 0;
    if (!platz) continue;
    punkte.push({
      saison, platz, ligaId, clubId,
      punkteZahl: zeile ? (Number(zeile.punkte) || 0) : 0,
      groesse: ((b.tabellen && b.tabellen[ligaId]) || []).length || 18,
      titel: (e.meister === clubId ? 1 : 0) + (e.pokalsieger === clubId ? 1 : 0)
    });
  }
  return sortBy(punkte, p => p.saison);
}

/**
 * Die Laufbahnkurve auf einer Leinwand: Platzierung als Linie (oben = Platz 1),
 * Punkte als Säulen dahinter, Titel als goldener Stern. Zeichnet in doppelter
 * Auflösung und skaliert über CSS — kein Date.now(), keine Animation, kein Zufall.
 */
function laufbahnCanvas(state, daten) {
  const B = 760, H = 240, R = 2;
  const cv = el('canvas.tv-chronik__kurve', { width: B * R, height: H * R });
  const ctx2d = sicher(() => cv.getContext('2d'), null, 'getContext');
  if (!ctx2d) return cv;
  ctx2d.scale(R, R);

  const links = 40, rechts = 46, oben = 22, unten = 30;
  const bx = B - links - rechts, by = H - oben - unten;

  ctx2d.fillStyle = '#f4ecd6';
  ctx2d.fillRect(0, 0, B, H);

  if (!daten.length) {
    ctx2d.fillStyle = '#4a3d28';
    ctx2d.font = '13px "Segoe UI", sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.fillText('Noch keine abgeschlossene Spielzeit — die Kurve beginnt im Sommer.', B / 2, H / 2);
    return cv;
  }

  const maxPlatz = Math.max(18, ...daten.map(d => d.groesse || 18));
  const maxPunkte = Math.max(40, ...daten.map(d => d.punkteZahl || 0));
  const n = daten.length;
  const xVon = (i) => links + (n === 1 ? bx / 2 : (bx * i) / (n - 1));
  const yVonPlatz = (p) => oben + (by * (clamp(p, 1, maxPlatz) - 1)) / Math.max(1, maxPlatz - 1);

  // Waagerechte Hilfslinien: Platz 1, Mitte, letzter Platz.
  ctx2d.strokeStyle = 'rgba(0,0,0,.16)';
  ctx2d.lineWidth = 1;
  ctx2d.font = '10px "Segoe UI", sans-serif';
  ctx2d.textBaseline = 'middle';
  for (const p of [1, Math.round(maxPlatz / 2), maxPlatz]) {
    const y = Math.round(yVonPlatz(p)) + 0.5;
    ctx2d.beginPath();
    ctx2d.moveTo(links, y);
    ctx2d.lineTo(links + bx, y);
    ctx2d.stroke();
    ctx2d.fillStyle = '#4a3d28';
    ctx2d.textAlign = 'right';
    ctx2d.fillText(`${p}.`, links - 6, y);
  }

  // Punktesäulen im Hintergrund.
  const breite = Math.max(6, Math.min(26, bx / (n * 1.7)));
  for (let i = 0; i < n; i++) {
    const d = daten[i];
    const h = (by * (d.punkteZahl || 0)) / maxPunkte;
    const x = xVon(i) - breite / 2;
    ctx2d.fillStyle = d.ligaId === 'bl1' ? 'rgba(28,79,143,.22)' : 'rgba(139,90,43,.26)';
    ctx2d.fillRect(x, oben + by - h, breite, h);
  }

  // Die Platzierungslinie.
  ctx2d.strokeStyle = '#c1272d';
  ctx2d.lineWidth = 2.4;
  ctx2d.beginPath();
  daten.forEach((d, i) => {
    const x = xVon(i), y = yVonPlatz(d.platz);
    if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
  });
  ctx2d.stroke();

  // Punkte, Titelsterne und Beschriftung der Spielzeiten.
  ctx2d.textAlign = 'center';
  daten.forEach((d, i) => {
    const x = xVon(i), y = yVonPlatz(d.platz);
    ctx2d.fillStyle = d.ligaId === 'bl1' ? '#1c4f8f' : '#8b5a2b';
    ctx2d.beginPath();
    ctx2d.arc(x, y, 4.2, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.strokeStyle = '#f4ecd6';
    ctx2d.lineWidth = 1.4;
    ctx2d.stroke();

    if (d.titel > 0) {
      ctx2d.fillStyle = '#d9a521';
      ctx2d.font = 'bold 14px "Segoe UI", sans-serif';
      ctx2d.textBaseline = 'bottom';
      ctx2d.fillText('★', x, y - 6);
    }

    ctx2d.fillStyle = '#4a3d28';
    ctx2d.font = '10px "Segoe UI", sans-serif';
    ctx2d.textBaseline = 'top';
    if (n <= 14 || i % 2 === 0) ctx2d.fillText(String(d.saison), x, oben + by + 6);
  });

  // Rechte Achse: die Punkteskala.
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'middle';
  ctx2d.fillStyle = '#4a3d28';
  ctx2d.fillText(`${maxPunkte} Pkt`, links + bx + 6, oben);
  ctx2d.fillText('0', links + bx + 6, oben + by);

  return cv;
}

const SKILL_NAMEN = {
  training: 'Trainingslehre', taktik: 'Taktik', motivation: 'Menschenführung',
  verhandlung: 'Verhandlung', jugend: 'Nachwuchsarbeit', medien: 'Medienarbeit'
};

/** Die sechs Fähigkeiten als Netz — ein zweites kleines Diagramm auf Leinwand. */
function faehigkeitenCanvas(manager) {
  const S = 220, R = 2;
  const cv = el('canvas.tv-chronik__netz', { width: S * R, height: S * R });
  const c = sicher(() => cv.getContext('2d'), null, 'getContext');
  if (!c) return cv;
  c.scale(R, R);

  const keys = Object.keys(SKILL_NAMEN);
  const mitte = S / 2, radius = S / 2 - 34;
  const skills = (manager && manager.skills) || {};

  c.fillStyle = '#f4ecd6';
  c.fillRect(0, 0, S, S);

  const punktAuf = (i, anteil) => {
    const w = (Math.PI * 2 * i) / keys.length - Math.PI / 2;
    return [mitte + Math.cos(w) * radius * anteil, mitte + Math.sin(w) * radius * anteil];
  };

  c.strokeStyle = 'rgba(0,0,0,.18)';
  c.lineWidth = 1;
  for (const ring of [0.25, 0.5, 0.75, 1]) {
    c.beginPath();
    keys.forEach((_, i) => {
      const [x, y] = punktAuf(i, ring);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    });
    c.closePath();
    c.stroke();
  }
  keys.forEach((_, i) => {
    const [x, y] = punktAuf(i, 1);
    c.beginPath();
    c.moveTo(mitte, mitte);
    c.lineTo(x, y);
    c.stroke();
  });

  c.beginPath();
  keys.forEach((k, i) => {
    const wert = clamp(Number(skills[k]) || 0, 0, 100) / 100;
    const [x, y] = punktAuf(i, wert);
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  });
  c.closePath();
  c.fillStyle = 'rgba(39,107,42,.42)';
  c.fill();
  c.strokeStyle = '#276b2a';
  c.lineWidth = 2;
  c.stroke();

  c.fillStyle = '#241c10';
  c.font = '9.5px "Segoe UI", sans-serif';
  keys.forEach((k, i) => {
    const [x, y] = punktAuf(i, 1.24);
    c.textAlign = x > mitte + 4 ? 'left' : x < mitte - 4 ? 'right' : 'center';
    c.textBaseline = y > mitte ? 'top' : 'bottom';
    c.fillText(SKILL_NAMEN[k], x, y);
  });

  return cv;
}

function stationenListe(state) {
  const m = state.manager || {};
  const stationen = Array.isArray(m.karriere) ? m.karriere.slice() : [];
  const club = sicher(() => myClub(state), null, 'myClub');

  const zeilen = stationen.slice().reverse().map(k => el('div.tv-chronik__station', null,
    wappenBild(vereinVon(state, k.clubId), 26),
    el('div', { style: { minWidth: '0', flex: '1' } },
      el('b', null, k.club || vereinName(state, k.clubId)),
      el('div.tv-mini', null,
        `Saison ${k.vonSeason}–${k.bisSeason}` +
        (k.platz ? ` · zuletzt ${k.platz}.` : '') +
        (k.spiele ? ` · ${k.spiele} Spiele` : ''))),
    el('div.tv-chronik__stationEnde', null,
      pill(k.ende === 'entlassen' ? 'entlassen' : k.ende === 'ruecktritt' ? 'zurückgetreten' : 'gewechselt',
        k.ende === 'entlassen' ? 'schlecht' : k.ende === 'ruecktritt' ? 'warn' : 'info'),
      el('div.tv-mini', null, k.grund || ''))));

  // Die laufende Station steht noch in keiner Karriereliste – sie läuft ja.
  if (club) {
    const b = club.board || {};
    const an = b.amtsantritt || { season: 1 };
    zeilen.unshift(el('div.tv-chronik__station.tv-chronik__station--jetzt', null,
      wappenBild(club, 26),
      el('div', { style: { minWidth: '0', flex: '1' } },
        el('b', null, club.name),
        el('div.tv-mini', null, `seit Saison ${an.season} · läuft`)),
      el('div.tv-chronik__stationEnde', null,
        pill('im Amt', 'gut'),
        el('div.tv-mini', null, b.saisonziel ? b.saisonziel.text : ''))));
  }

  if (!zeilen.length) return leer('Noch keine Station in der Akte.');
  return el('div.tv-spalte', { style: { gap: '4px' } }, ...zeilen);
}

function laufbahnTab(ctx) {
  const s = ctx.state;
  const m = s.manager || {};
  const bil = m.bilanz || { spiele: 0, siege: 0, unentschieden: 0, niederlagen: 0, tore: 0, gegentore: 0 };
  const quote = bil.spiele ? round((bil.siege / bil.spiele) * 100, 1) : 0;
  const schnitt = bil.spiele ? round((bil.siege * 3 + bil.unentschieden) / bil.spiele, 2) : 0;
  const daten = sicher(() => laufbahnPunkte(s), [], 'laufbahnPunkte');

  const titel = Array.isArray(m.titel) ? m.titel : [];
  const titelListe = titel.length
    ? el('div.tv-spalte', { style: { gap: '2px' } },
      ...titel.slice().reverse().map(t => el('div.tv-chronik__titelZeile', null,
        el('span', { style: { fontSize: '15px' } }, '🏆'),
        el('b', null, typeof t === 'string' ? t : (t.name || 'Titel')),
        typeof t === 'object'
          ? el('span.tv-mini', null, `${t.club ? t.club + ' · ' : ''}Saison ${t.season}`)
          : null)))
    : leer('Die Vitrine ist leer. Sie wird trotzdem jede Woche gewischt.');

  const kurveBox = el('div.tv-chronik__kurveBox', null,
    sicher(() => laufbahnCanvas(s, daten), leer('Die Kurve ließ sich nicht zeichnen.'), 'laufbahnCanvas'),
    el('div.tv-chronik__kurveLegende', null,
      el('span', null, '── Platzierung (oben ist besser)'),
      el('span', null, '▮ Punkte je Spielzeit'),
      el('span', null, '★ Titel')));

  const netzBox = el('div.tv-chronik__netzBox', null,
    sicher(() => faehigkeitenCanvas(m), leer('Kein Netz.'), 'faehigkeitenCanvas'),
    el('div.tv-spalte', { style: { gap: '3px', flex: '1', minWidth: '160px' } },
      ...Object.keys(SKILL_NAMEN).map(k =>
        bar(clamp(Math.round(Number(m.skills && m.skills[k]) || 0), 0, 100), 100, { label: SKILL_NAMEN[k] }))));

  return el('div.tv-spalte',
    panel(panelKopf('Meine Laufbahn', m.name || 'Der Trainer'),
      el('div.tv-spalte',
        el('div.tv-grid.tv-grid--4', { style: { gap: '6px' } },
          statBox('Spiele', String(bil.spiele || 0), { sub: `${bil.siege}S ${bil.unentschieden}U ${bil.niederlagen}N` }),
          statBox('Siegquote', `${komma(quote, 1)} %`, { sub: `${komma(schnitt)} Punkte je Spiel`, kind: quote >= 50 ? 'gut' : quote < 30 ? 'schlecht' : null }),
          statBox('Ruf', String(Math.round(m.reputation || 0)), { sub: `Stufe ${m.level || 1} · ${nfmt(m.erfahrung || 0)} Erfahrung` }),
          statBox('Lizenz', m.lizenz || '–', { sub: `Stufe ${m.lizenzStufe || 1}`, kind: 'gold' }),
          statBox('Titel', String(titel.length), { sub: 'in der eigenen Vitrine', kind: titel.length ? 'gold' : null }),
          statBox('Tore', `${bil.tore || 0}:${bil.gegentore || 0}`, { sub: 'geschossen : kassiert' }),
          statBox('Stationen', String((Array.isArray(m.karriere) ? m.karriere.length : 0) + 1), { sub: 'inklusive der laufenden' }),
          statBox('Spielzeiten', String(daten.length), { sub: 'abgeschlossen' })),
        subpanel('Laufbahnkurve', kurveBox),
        el('div.tv-chronik__fussnote', null,
          'Platz und Punkte je Spielzeit stehen im Archiv und werden hier nur aufgetragen. ' +
          'Die Fähigkeiten führt der Spielstand ausschließlich im Ist-Zustand — ihr Verlauf über die Jahre ' +
          'ließe sich erst zeichnen, wenn der Saisonabschluss ihn mitschriebe.'))),
    el('div.tv-grid.tv-grid--2',
      panel('Fähigkeiten heute', netzBox),
      panel(panelKopf('Titelsammlung', `${titel.length}`), titelListe)),
    panel('Stationen', stationenListe(s)));
}

/* ================================================================== *
 *  8. Der Saisonrückblick als Zeitung
 * ================================================================== */

/** Wie viele Ligaspiele hat der eigene Verein in der laufenden Spielzeit hinter sich? */
function spieltageGespielt(state) {
  const club = sicher(() => myClub(state), null, 'myClub');
  if (!club) return { gespielt: 0, gesamt: 34 };
  const ligaId = club.leagueId || 'bl1';
  const zeile = ((state.tables && state.tables[ligaId]) || []).find(z => z && z.clubId === club.id);
  return {
    gespielt: zeile ? (Number(zeile.spiele) || 0) : 0,
    gesamt: (LEAGUES[ligaId] && LEAGUES[ligaId].matchdays) || 34
  };
}

/**
 * Eine Ersatzausgabe für eine Spielzeit, deren Originaltext nicht mehr im
 * Postfach liegt. Das Postfach hält nur 300 Nachrichten – nach ein paar Jahren
 * ist die alte „Fußball-Woche" darin verschwunden, die Chronik aber nicht.
 * Gesetzt wird deshalb aus dem Archiv nach, in derselben Form: Schlagzeile,
 * Leerzeile, Absätze. Nichts davon ist erfunden, alles steht in history.titel.
 */
function archivAusgabe(state, saison) {
  const a = archiv(state);
  const e = a.titel[saison];
  if (!e) return null;
  const b = a.seasons.find(x => Number(x.season) === Number(saison)) || {};
  const clubId = e.managerVerein || state.managerClubId;
  const ligaId = e.managerLiga || 'bl1';
  const zeile = ((b.tabellen && b.tabellen[ligaId]) || []).find(z => z && z.clubId === clubId) || null;
  const platz = Number(e.managerPlatz) || Number(b.eigenerPlatz) || (zeile ? Number(zeile.platz) : 0);
  const meister = e.meister === clubId;
  const pokal = e.pokalsieger === clubId;
  const auf = Array.isArray(e.aufsteiger) && e.aufsteiger.indexOf(clubId) >= 0;
  const ab = Array.isArray(e.absteiger) && e.absteiger.indexOf(clubId) >= 0;

  const kopf = meister ? 'DIE SCHALE BLEIBT IN DER STADT'
    : pokal ? 'DER POKAL FÄHRT IM MANNSCHAFTSBUS NACH HAUSE'
      : auf ? 'AUFGESTIEGEN — UND NIEMAND GEHT NACH HAUSE'
        : ab ? 'ABGESTIEGEN. DER REST IST ARBEIT'
          : platz && platz <= 6 ? 'EIN JAHR, DAS SICH SEHEN LASSEN KANN'
            : platz && platz >= 15 ? 'EINE SPIELZEIT ZUM ABHAKEN'
              : 'EINE SAISON AUS DER MITTE DER TABELLE';

  const absaetze = [];
  absaetze.push(
    `${vereinName(state, clubId)} beendet die Spielzeit ${jahrgang(state, saison)} auf ` +
    `${platz ? `Platz ${platz}` : 'einem Platz, den niemand notiert hat'} der ${ligaName(ligaId)}` +
    (zeile ? ` mit ${zeile.punkte} Punkten und einer Tordifferenz von ${zeile.diff > 0 ? '+' : ''}${zeile.diff}.` : '.'));

  const satz = sicher(() => chronikText(state, saison), '', 'chronikText');
  if (satz) absaetze.push(satz);

  absaetze.push(meister || pokal
    ? 'In der Geschäftsstelle wird seither über einen zweiten Vitrinenschrank diskutiert. Der Hausmeister hält das für übertrieben — er hat den ersten aufgebaut.'
    : ab
      ? 'Die Kurve blieb nach dem letzten Spiel stehen und sang weiter. Das macht es nicht besser, aber ein bisschen erträglicher.'
      : 'Am Ende ist eine Saison das, was in der Tabelle steht. Alles andere erzählt man sich an der Theke — und dort wird sie jedes Jahr ein bisschen besser.');

  return {
    saison, blatt: 'Fußball-Woche',
    text: [kopf, ''].concat(absaetze).join('\n'),
    vorab: false, ausArchiv: true
  };
}

/**
 * Alle Ausgaben, die am Kiosk liegen — neueste zuerst.
 *
 * Erste Wahl ist der Originaltext aus dem Postfach: `club/media.js` legt ihn am
 * Saisonende als Nachricht der „Fußball-Woche" ab. Fehlt er, wird aus der
 * Chronik nachgesetzt (siehe archivAusgabe). Die laufende Spielzeit kommt als
 * Vorabdruck dazu, sobald mindestens die Hälfte der Spieltage gespielt ist —
 * vorher stünde in der Zeitung ein Rückblick über null Punkte aus null Spielen.
 */
function rueckblickAusgaben(state) {
  const ausgaben = [];
  const inbox = Array.isArray(state.inbox) ? state.inbox : [];
  for (const m of inbox) {
    if (!m || !m.body || !m.subject) continue;
    if (String(m.subject).indexOf('Saisonrückblick') !== 0) continue;
    const nr = Number(String(m.subject).replace(/[^0-9]/g, ''));
    ausgaben.push({
      saison: isFinite(nr) && nr > 0 ? nr : (Number(m.season) || state.date.season),
      blatt: m.from || 'Fußball-Woche',
      text: m.body,
      vorab: false, ausArchiv: false
    });
  }

  const gesehen = new Set(ausgaben.map(a => a.saison));
  for (const saison of titelSaisons(state)) {
    if (gesehen.has(saison)) continue;
    const ersatz = sicher(() => archivAusgabe(state, saison), null, 'archivAusgabe ' + saison);
    if (ersatz) { ausgaben.push(ersatz); gesehen.add(saison); }
  }

  const lauf = spieltageGespielt(state);
  if (!gesehen.has(state.date.season) && lauf.gespielt * 2 >= lauf.gesamt) {
    const text = sicher(() => saisonRueckblick(state, state.managerClubId), '', 'saisonRueckblick');
    if (text) {
      ausgaben.push({
        saison: state.date.season, blatt: 'Fußball-Woche', text,
        vorab: true, ausArchiv: false, spieltage: lauf
      });
    }
  }

  return sortBy(ausgaben, a => ({ key: a.saison, desc: true }));
}

/**
 * `saisonRueckblick()` liefert Schlagzeile, eine Reihe von Unterstrichen und
 * danach Absätze. Genau so wird das Blatt gesetzt.
 */
function textZerlegen(text) {
  const zeilen = String(text || '').split('\n').map(z => z.trim());
  let schlagzeile = '';
  const absaetze = [];
  for (const z of zeilen) {
    if (!z) continue;
    if (/^-+$/.test(z)) continue;
    if (!schlagzeile) { schlagzeile = z; continue; }
    absaetze.push(z);
  }
  return { schlagzeile: schlagzeile || 'Eine Spielzeit geht zu Ende', absaetze };
}

function elfKasten(state, saison) {
  const e = archiv(state).titel[saison];
  const club = sicher(() => myClub(state), null, 'myClub');
  let elf = (e && Array.isArray(e.elfDerSaison)) ? e.elfDerSaison : [];
  let titel = 'Elf der Saison';

  // Für die laufende Spielzeit steht noch nichts in der Chronik – die Auswahl
  // rechnet club/karriere.js aber jederzeit aus dem aktuellen Notenschnitt.
  if (!elf.length && Number(saison) === Number(state.date.season)) {
    const ligaId = (club && club.leagueId) || 'bl1';
    elf = sicher(() => elfDerSaison(state, ligaId), [], 'elfDerSaison') || [];
    if (elf.length) titel = 'Elf der bisherigen Spielzeit';
  }

  if (!elf.length) {
    return el('div.tv-zeitung__kasten', null,
      el('div.tv-zeitung__kastenTitel', null, 'Elf der Saison'),
      el('div.tv-mini', null, 'Die Redaktion konnte sich nicht einigen. Es blieb bei zehn Namen und einem Streit.'));
  }
  return el('div.tv-zeitung__kasten', null,
    el('div.tv-zeitung__kastenTitel', null, titel),
    el('div.tv-spalte', { style: { gap: '1px' } },
      ...elf.map(x => {
        const p = spielerVon(state, x);
        const c = vereinVon(state, (p && p.clubId) || x.clubId);
        const eigen = !!(club && p && p.clubId === club.id);
        return el('div.tv-zeitung__elfZeile', { class: eigen ? 'eigen' : null },
          el('span.tv-zeitung__elfPos', null, x.pos || '–'),
          el('span.tv-zeitung__elfName', null, spielerName(p, x.playerId || '?')),
          el('span.tv-mini', null, c ? c.abbr || c.shortName : '–'),
          el('b.tv-num', null, noteText(x.note)));
      })),
    (e && e.spielerDerSaison)
      ? el('div.tv-zeitung__fuss', null,
        `Spieler der Saison: ${spielerName(spielerVon(state, e.spielerDerSaison), 'nicht gekürt')}.`)
      : null);
}

function anekdotenKasten(state, saison, opts = {}) {
  const a = archiv(state);
  const e = a.titel[saison];
  const r = a.rekorde || {};
  const stuecke = [];

  // Beim Nachdruck steht der Chroniksatz schon im Aufmacher – nicht doppeln.
  if (!opts.ohneChronikSatz) {
    const satz = sicher(() => chronikText(state, saison), '', 'chronikText');
    if (satz && e) stuecke.push(satz);
  }

  if (r.hoechsterSieg && Number(r.hoechsterSieg.season) === Number(saison)) {
    stuecke.push(`Das Ergebnis des Jahres: ${r.hoechsterSieg.text}. Der Verlierer hat danach ` +
      `„die Analyse in Ruhe" angekündigt — das dauert erfahrungsgemäß bis zur Winterpause.`);
  }
  if (r.laengsteSerie && Number(r.laengsteSerie.season) === Number(saison)) {
    stuecke.push(`${r.laengsteSerie.name || vereinName(state, r.laengsteSerie.clubId)} gewann ` +
      `${r.laengsteSerie.laenge} Spiele hintereinander. Danach kam, was immer kommt.`);
  }

  const wechsel = sortBy(a.transfers.filter(t => Number(t.season) === Number(saison) && (Number(t.ablose) || 0) > 0),
    t => ({ key: Number(t.ablose) || 0, desc: true }), t => String(t.playerId)).slice(0, 3);
  if (wechsel.length) {
    stuecke.push('Die teuersten Wechsel: ' + wechsel.map(t =>
      `${t.name || 'ein Spieler'} (${t.vonId ? vereinKurz(state, t.vonId) : 'ablösefrei'} → ` +
      `${vereinKurz(state, t.zuId)}, ${formatMoney(t.ablose)})`).join('; ') + '.');
  }

  const ruecktritte = [];
  for (const pid of Object.keys(state.players || {}).sort()) {
    const p = state.players[pid];
    if (p && p.retired && Number(p.retired.season) === Number(saison)) ruecktritte.push(p);
  }
  if (ruecktritte.length) {
    const legenden = ruecktritte.filter(istLegende);
    stuecke.push(`${ruecktritte.length} Profi${ruecktritte.length === 1 ? '' : 's'} ` +
      `${ruecktritte.length === 1 ? 'hat' : 'haben'} aufgehört` +
      (legenden.length
        ? `, darunter ${legenden.slice(0, 3).map(p => spielerName(p)).join(', ')}. Es war eine dieser Sommerpausen, ` +
          `nach denen die Liga anders aussieht.`
        : '. Die Namen wird man in zehn Jahren nachschlagen müssen.'));
  }

  if (!stuecke.length) {
    stuecke.push('Über diese Spielzeit gibt es wenig zu erzählen, was nicht schon in der Tabelle steht. ' +
      'Auch das ist eine Nachricht.');
  }

  return el('div.tv-zeitung__kasten', null,
    el('div.tv-zeitung__kastenTitel', null, 'Notizen am Rande'),
    ...stuecke.map(t => el('div.tv-zeitung__notiz', null, t)));
}

function zeitungsSeite(state, ausgabe) {
  const club = sicher(() => myClub(state), null, 'myClub');
  const { schlagzeile, absaetze } = textZerlegen(ausgabe.text);
  const a = archiv(state);
  const e = a.titel[ausgabe.saison];

  const kopfzeile = [
    `Ausgabe zur Spielzeit ${jahrgang(state, ausgabe.saison)}`,
    ausgabe.vorab ? 'Vorabdruck' : `Saison ${ausgabe.saison}`,
    ausgabe.ausArchiv ? 'Nachdruck aus dem Archiv' : null,
    club ? club.city || club.name : null
  ].filter(Boolean).join(' · ');

  const aufmacher = el('div.tv-zeitung__aufmacher', null,
    el('div.tv-zeitung__schlagzeile', null, schlagzeile),
    el('div.tv-zeitung__meta', null,
      `Von unserem Redakteur${e && e.managerName ? ` · Trainer: ${e.managerName}` : ''}` +
      `${e && e.managerPlatz ? ` · Platz ${e.managerPlatz} in der ${ligaName(e.managerLiga)}` : ''}`),
    el('div.tv-zeitung__spalten', null,
      ...absaetze.map(t => el('p.tv-zeitung__text', null, t))));

  const blatt = el('div.tv-zeitung.tv-zeitung--blatt', null,
    el('div.tv-zeitung__kopf', null, ausgabe.blatt || 'Fußball-Woche'),
    el('div.tv-zeitung__zeile', null, kopfzeile),
    aufmacher,
    el('div.tv-zeitung__unterbau', null,
      elfKasten(state, ausgabe.saison),
      anekdotenKasten(state, ausgabe.saison, { ohneChronikSatz: !!ausgabe.ausArchiv })));

  if (ausgabe.vorab) {
    const sp = ausgabe.spieltage || { gespielt: 0, gesamt: 34 };
    blatt.appendChild(el('div.tv-zeitung__stempel', null,
      `Vorabdruck nach ${sp.gespielt} von ${sp.gesamt} Spieltagen: Die Spielzeit läuft noch. ` +
      'Die Redaktion behält sich vor, alles anders zu sehen, sobald der letzte Spieltag gespielt ist.'));
  } else if (ausgabe.ausArchiv) {
    blatt.appendChild(el('div.tv-zeitung__stempel', null,
      'Nachdruck: Die Originalausgabe liegt nicht mehr im Postfach — dort ist nach 300 Nachrichten Schluss. ' +
      'Diese Seite ist aus der Chronik nachgesetzt; die Zahlen stimmen, die Anekdoten sind kürzer.'));
  }

  return blatt;
}

function zeitungTab(ctx) {
  const s = ctx.state;
  const ausgaben = sicher(() => rueckblickAusgaben(s), [], 'rueckblickAusgaben');

  if (!ausgaben.length) {
    const sp = spieltageGespielt(s);
    return panel('Saisonrückblick',
      leer('Am Kiosk liegt noch nichts. Der Rückblick erscheint zum Saisonende — ' +
        `bis dahin sind noch ${Math.max(0, sp.gesamt - sp.gespielt)} Spieltage zu überstehen, ` +
        'und danach liest ihn ohnehin jeder zuerst von hinten.'));
  }

  if (ausgaben.length === 1) {
    return el('div.tv-spalte', zeitungsSeite(s, ausgaben[0]));
  }

  const box = el('div.tv-spalte');
  const blatt = el('div.tv-spalte');
  const zeige = (ausgabe) => {
    blatt.innerHTML = '';
    blatt.appendChild(sicher(() => zeitungsSeite(s, ausgabe),
      leer('Diese Ausgabe ist im Archiv verschollen.'), 'zeitungsSeite'));
  };

  const leiste = el('div.tv-chronik__ausgaben');
  ausgaben.forEach((ausgabe, i) => {
    const knopf = el('button.tv-chronik__ausgabe', {
      type: 'button',
      class: i === 0 ? 'aktiv' : null,
      onClick: () => {
        leiste.querySelectorAll('.tv-chronik__ausgabe').forEach(b => b.classList.remove('aktiv'));
        knopf.classList.add('aktiv');
        zeige(ausgabe);
      }
    }, el('b', null, jahrgang(s, ausgabe.saison)),
    el('span.tv-mini', null, ausgabe.vorab ? 'Vorabdruck' : `Saison ${ausgabe.saison}`));
    leiste.appendChild(knopf);
  });

  zeige(ausgaben[0]);
  box.appendChild(panel(panelKopf('Am Kiosk', `${ausgaben.length} Ausgaben`), leiste));
  box.appendChild(blatt);
  return box;
}

/* ================================================================== *
 *  9. Der Bildschirm
 * ================================================================== */

export const screen = {
  id: 'chronik',
  title: 'Chronik',
  icon: '📜',

  render(root, ctx) {
    const s = ctx && ctx.state;
    if (!s || !s.clubs || !s.managerClubId || !s.clubs[s.managerClubId]) {
      root.appendChild(panel('Chronik',
        leer('Kein gültiger Spielstand geladen – ohne Verein gibt es auch keine Vergangenheit.')));
      return;
    }

    const fertige = abgeschlossen(s);
    const seite = el('div.tv-seite.tv-chronik');

    seite.appendChild(el('div.tv-seite__kopf',
      el('h1.tv-seite__titel', null, 'Chronik'),
      el('div.tv-seite__unter', null,
        fertige
          ? `${fertige} abgeschlossene Spielzeit${fertige === 1 ? '' : 'en'} im Schrank. ` +
            'Ewige Tabelle, Titel, Rekorde, Ruhmeshalle und Ihre eigene Akte.'
          : 'Noch ist der Schrank leer. Das Archiv füllt sich mit jeder Spielzeit, die Sie überstehen.')));

    const bauen = (fn, titel) => () => {
      try {
        return fn(ctx);
      } catch (err) {
        console.error(`[chronik] ${titel} fehlgeschlagen:`, err);
        return panel(titel, el('div.tv-chronik__stoerung', null,
          `Dieser Bereich konnte nicht gezeichnet werden: ${err && err.message ? err.message : err}`));
      }
    };

    seite.appendChild(reiter([
      { id: 'ewig', label: 'Ewige Tabelle', render: bauen(ewigTab, 'Ewige Tabelle') },
      { id: 'titel', label: 'Titel', render: bauen(titelTab, 'Titelchronik') },
      { id: 'rekorde', label: 'Rekorde', render: bauen(rekordeTab, 'Rekorde') },
      { id: 'ruhm', label: 'Ruhmeshalle', render: bauen(ruhmTab, 'Ruhmeshalle') },
      { id: 'laufbahn', label: 'Meine Laufbahn', render: bauen(laufbahnTab, 'Meine Laufbahn') },
      { id: 'zeitung', label: 'Saisonrückblick', render: bauen(zeitungTab, 'Saisonrückblick') }
    ], { active: (ctx.params && ctx.params.reiter) || 'ewig' }));

    root.appendChild(seite);
  }
};

export default screen;
