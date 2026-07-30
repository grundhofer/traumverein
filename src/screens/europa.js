/**
 * screens/europa.js — Der Europapokal (ROADMAP-Stufe 3, Punkt 7).
 *
 * Drei Wettbewerbe unter einem Dach, je ein Reiter: Champions League, Europa
 * League, Conference League. Je Wettbewerb gibt es
 *   · die Ligaphasentabelle über das ganze Feld, mit Wappen und Landesflagge,
 *   · „Ihr Weg" — die acht Ligaphasenspiele des eigenen Vereins und danach die
 *     K.-o.-Runden,
 *   · den K.-o.-Baum mit Hin- und Rückspiel je Paarung,
 *   · das Gegnerporträt vor der nächsten Partie,
 *   · die Prämienübersicht.
 *
 * Der Bildschirm RECHNET NICHTS NACH und ändert nichts am Spielstand. Alles
 * Sportliche kommt aus `club/europa.js:europaStand()`, alles Wirtschaftliche aus
 * `EURO.competitions[*].prizeMoney` in `data/leagues.js`. Was hier entsteht, sind
 * ausschließlich Sätze — die Einschätzung des Co-Trainers wird aus sichtbaren
 * Zahlen abgeleitet (Ruf, Kaderstärke, Heimrecht), ohne einen einzigen Würfel.
 * Deshalb steht hier auch kein `ensureSquad()`: Der Kader eines europäischen
 * Gegners entsteht beim Anpfiff (core/loop.js:advanceDay), nicht beim Hinsehen —
 * ein Bildschirm, der 66 Kader anlegt, sprengt den Spielstand (ROADMAP S3).
 *
 * Ersetzt den Dauersatz aus screens/tabelle.js; der dortige Reiter verweist
 * seither hierher.
 */

import { POSITION_NAMES, POSITION_GROUP } from '../core/constants.js';
import { clamp, round, nfmt, formatMoney, formatDateShort } from '../core/util.js';
import { myClub } from '../core/state.js';
import { EURO } from '../data/leagues.js';
import { el, panel, subpanel, button, table, tabs, pill, statBox } from '../render/ui.js';
import { crestDataURL, drawFlag, nationName } from '../render/kits.js';
import { portraitDataURL } from '../render/portraits.js';
import { playerOverall } from '../engine/ratings.js';
import { rolleVon, qualitaetVon } from '../club/staff.js';
import { englischeWoche } from '../club/media.js';
import { europaStand, europaTeilnehmer, RUNDEN_PRAEMIE } from '../club/europa.js';

/* ================================================================== *
 *  Modulzustand (überlebt ctx.refresh())
 * ================================================================== */

const zustand = {
  reiter: null        // zuletzt gewählter Wettbewerb
};

/**
 * Wie viele Vereine überspringen die Play-off-Runde?
 *
 * Nicht geraten und nicht doppelt gepflegt: Die Hälfte des Achtelfinales kommt
 * direkt aus der Ligaphase, die andere Hälfte aus dem Play-off. `EURO.knockout`
 * nennt die Feldgrößen, also rechnet dieser Bildschirm damit — und stimmt auch
 * dann noch, wenn jemand in data/leagues.js an den Zahlen dreht.
 */
const AF = EURO.knockout.find(r => r.id === 'af');
const DIREKT_PLAETZE = AF && AF.teams ? Math.max(1, Math.floor(AF.teams / 2)) : 8;

const ZONEN_NAMEN = {
  direkt: 'Direkt in die K.-o.-Runde',
  playoff: 'Play-off-Runde',
  raus: 'Ausgeschieden'
};

/* ================================================================== *
 *  Kleinkram
 * ================================================================== */

function sicher(fn, ersatz, label) {
  try {
    return fn();
  } catch (err) {
    if (label) console.warn(`[europa] ${label} fehlgeschlagen:`, err);
    return ersatz;
  }
}

function leer(text) {
  return el('div.tv-leer', null, text);
}

/**
 * Panelkopf mit rechtsbündigem Zusatz.
 *
 * Die Kopfleiste aus render/ui.js ist ein Flexcontainer und schiebt ihr letztes
 * Kind nach rechts; alles Weitere steht inline, weil die Regel für
 * `.tv-panel__extra` in styles/main.css an einem Elternselektor hängt, den es
 * nicht (mehr) gibt. Genau so machen es screens/tabelle.js und screens/saison.js.
 */
function panelKopf(titel, extra) {
  if (!extra) return titel;
  return [
    el('span', null, titel),
    el('span.tv-panel__extra', {
      style: { marginLeft: 'auto', fontWeight: '400', letterSpacing: '.3px', textTransform: 'none', opacity: '.9' }
    }, extra)
  ];
}

function vereinVon(state, clubId) {
  return (clubId && state.clubs) ? (state.clubs[clubId] || null) : null;
}

function kurzName(state, clubId) {
  const c = vereinVon(state, clubId);
  return c ? (c.shortName || c.name) : String(clubId || '–');
}

function abbrVon(state, clubId) {
  const c = vereinVon(state, clubId);
  return c ? (c.abbr || (c.shortName || c.name || '').slice(0, 3).toUpperCase()) : '???';
}

/** Land eines Vereins. Die Bundesliga steht in data/clubs.js ohne Länderkennung. */
function landVon(club) {
  return (club && club.country) || 'DE';
}

function wappen(club, groesse = 22) {
  const box = el('span', {
    style: {
      display: 'inline-flex', width: groesse + 'px', height: groesse + 'px',
      flex: `0 0 ${groesse}px`, alignItems: 'center', justifyContent: 'center'
    }
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

/** Flaggen werden einmal je Land gezeichnet und danach als Bild wiederverwendet. */
const flaggenCache = new Map();

function flaggeURL(code) {
  const key = String(code || '').toUpperCase();
  if (flaggenCache.has(key)) return flaggenCache.get(key);
  let url = '';
  try {
    const cv = document.createElement('canvas');
    cv.width = 36; cv.height = 24;
    drawFlag(cv.getContext('2d'), key, 0, 0, 36, 24);
    url = cv.toDataURL('image/png');
  } catch (err) {
    url = '';
  }
  flaggenCache.set(key, url);
  return url;
}

function flagge(code, breite = 20) {
  const name = sicher(() => nationName(code), code, 'nationName');
  const url = flaggeURL(code);
  if (!url) return el('span.tv-mini', { title: name }, String(code || '–'));
  return el('img.tv-euro__flagge', {
    src: url, width: breite, height: Math.round(breite * 2 / 3), alt: String(code || ''), title: name,
    style: { width: breite + 'px', height: Math.round(breite * 2 / 3) + 'px' }
  });
}

/** Flagge + Wappen + Name — die Standardzelle dieses Bildschirms. */
function vereinsZelle(state, clubId, opts = {}) {
  const c = vereinVon(state, clubId);
  const groesse = opts.groesse || 20;
  return el('span.tv-zeile', { style: { gap: '6px', minWidth: '0' } },
    flagge(landVon(c), Math.round(groesse * 0.95)),
    wappen(c, groesse),
    el('span', { style: { minWidth: '0' } },
      el('div', null, c ? (opts.lang ? c.name : (c.shortName || c.name)) : String(clubId || '?')),
      opts.unter ? el('div.tv-mini', null, opts.unter) : null));
}

function formStreifen(form) {
  const arr = (form || []).slice(-5);
  if (!arr.length) return el('span.tv-mini', null, '–');
  return el('span.tv-form', null, ...arr.map(z => el('span', { class: z }, z)));
}

function tore(score) {
  return Array.isArray(score) ? `${score[0]}:${score[1]}` : '–:–';
}

function mio(betrag) {
  const v = Number(betrag) || 0;
  return (v / 1e6).toFixed(1).replace('.', ',') + ' Mio €';
}

/** In welche Zone der Ligaphasentabelle fällt dieser Platz? */
function zoneVon(platz, feldGroesse) {
  if (platz <= DIREKT_PLAETZE) return 'direkt';
  if (platz <= feldGroesse) return 'playoff';
  return 'raus';
}

/** Der Wettbewerb, in dem der eigene Verein steht (oder null). */
function eigenerWettbewerb(state) {
  return sicher(() => europaTeilnehmer(state, state.managerClubId), null, 'europaTeilnehmer');
}

/**
 * Reiterleiste. styles/main.css formt `.tv-tabs` zu einer waagerechten Leiste –
 * das würde Reiterknöpfe und Reiterinhalt nebeneinander stellen. Inline
 * zurückdrehen, genau wie in screens/tabelle.js.
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
 *  Partien des eigenen Vereins
 * ================================================================== */

/** Alle Partien eines Wettbewerbs in dieser Saison, nach Termin sortiert. */
function partienVon(state, wbId, clubId) {
  return state.fixtures
    .filter(f => f && f.competitionId === wbId && f.season === state.date.season &&
      (!clubId || f.homeId === clubId || f.awayId === clubId))
    .sort((a, b) => (a.dayIndex - b.dayIndex) || String(a.id).localeCompare(String(b.id)));
}

/** Nachschlagewerk für Zusatzangaben, die europaStand() nicht mitliefert. */
function fixtureIndex(state) {
  const map = new Map();
  for (const f of state.fixtures) if (f && f.id) map.set(f.id, f);
  return map;
}

/**
 * Kennzeichen einer Partie: neutraler Boden, Verlängerung, Elfmeterschießen.
 *
 * Beides lässt sich abschalten, damit nichts doppelt dasteht: Im K.-o.-Baum
 * steht das Elfmeterschießen ohnehin als eigene Zeile unter der Paarung, und in
 * „Ihr Weg" sagt schon die Ortsangabe, dass auf neutralem Boden gespielt wird.
 */
function merkmale(fx, opts = {}) {
  const out = [];
  if (!fx) return out;
  if (!opts.ohneNeutral && fx.neutral) out.push(pill('neutraler Boden', 'neutral'));
  if (fx.verlaengerung) out.push(pill('n. V.', 'info'));
  if (!opts.ohneElfmeter && Array.isArray(fx.elfmeter)) {
    out.push(pill(`i. E. ${fx.elfmeter[0]}:${fx.elfmeter[1]}`, 'warn'));
  }
  return out;
}

/* ================================================================== *
 *  1. Kopf des Wettbewerbs
 * ================================================================== */

function kopfPanel(state, w, club) {
  const def = EURO.competitions[w.id] || {};
  const sieger = vereinVon(state, w.sieger);
  const dabei = w.teilnehmer.filter(id => vereinVon(state, id));
  const eigen = w.teilnehmer.includes(club.id);

  const zeile = w.tabelle.find(z => z.clubId === club.id) || null;
  const lage = !eigen
    ? 'Wir sind in diesem Wettbewerb nicht vertreten.'
    : zeile && zeile.spiele
      ? `${club.shortName || club.name}: Platz ${zeile.platz} nach ${zeile.spiele} Spielen, ` +
        `${zeile.punkte} Punkte, ${zeile.tore}:${zeile.gegentore} Tore.`
      : `${club.shortName || club.name} ist dabei. Gespielt wurde noch nicht.`;

  return panel(panelKopf(def.name || w.id.toUpperCase(), `Saison ${state.date.season}`),
    el('div.tv-spalte',
      el('div.tv-zeile', { style: { gap: '8px', flexWrap: 'wrap' } },
        pill(w.rundeName || 'Ligaphase', w.sieger ? 'gut' : 'info'),
        pill(`${w.feld.length} Vereine`, 'neutral'),
        eigen ? pill('Wir sind dabei', 'gut') : pill('Ohne uns', 'neutral'),
        sieger ? pill(`Sieger: ${sieger.shortName || sieger.name}`, 'warn') : null),
      el('div', { style: { fontSize: '12.5px' } }, lage),
      dabei.length
        ? el('div.tv-zeile', { style: { gap: '6px', flexWrap: 'wrap' } },
          el('span.tv-mini', null, 'Deutsche Starter:'),
          ...dabei.map(id => el('span.tv-zeile', {
            style: {
              gap: '5px', fontSize: '11.5px', padding: '2px 6px', borderRadius: '2px',
              border: '1px solid var(--linie)',
              background: id === club.id ? 'rgba(217,165,33,.3)' : 'rgba(255,255,255,.24)'
            }
          }, wappen(vereinVon(state, id), 16), el('span', null, kurzName(state, id)))))
        : el('div.tv-mini', null, 'Kein deutscher Verein in diesem Wettbewerb. Man muss das nicht kommentieren.')));
}

/* ================================================================== *
 *  2. Ligaphasentabelle
 * ================================================================== */

function tabellenPanel(state, w, club) {
  const feldGroesse = w.feld.length || w.tabelle.length;
  const zeilen = w.tabelle;
  const fertig = zeilen.length && zeilen.every(z => z.spiele >= EURO.leaguePhase.matchdays);

  if (!zeilen.length) {
    return panel(panelKopf('Ligaphase', `${EURO.leaguePhase.matchdays} Spieltage`),
      leer('Für diesen Wettbewerb steht noch kein Feld. Die Auslosung ist im Sommer.'));
  }

  const t = table([
    {
      key: 'platz', label: '#', width: 32, numeric: true, sortable: false,
      render: z => el('b.tv-num', null, String(z.platz))
    },
    {
      key: 'verein', label: 'Verein', sortable: false,
      render: z => {
        const c = vereinVon(state, z.clubId);
        return vereinsZelle(state, z.clubId, {
          groesse: 22, lang: true,
          unter: c ? `${sicher(() => nationName(landVon(c)), landVon(c), 'nationName')} · Ruf ${c.reputation || '?'}` : ''
        });
      }
    },
    { key: 'spiele', label: 'Sp', width: 32, numeric: true, sortable: false },
    { key: 's', label: 'S', width: 28, numeric: true, sortable: false },
    { key: 'u', label: 'U', width: 28, numeric: true, sortable: false },
    { key: 'n', label: 'N', width: 28, numeric: true, sortable: false },
    {
      key: 'tore', label: 'Tore', width: 58, align: 'center', sortable: false,
      render: z => el('span.tv-num', null, `${z.tore}:${z.gegentore}`)
    },
    {
      key: 'diff', label: 'Diff', width: 42, numeric: true, sortable: false,
      render: z => el('span.tv-num', { class: z.diff > 0 ? 'tv-gut' : z.diff < 0 ? 'tv-schlecht' : null },
        (z.diff > 0 ? '+' : '') + z.diff)
    },
    {
      key: 'punkte', label: 'Pkt', width: 38, numeric: true, sortable: false,
      render: z => el('b.tv-num', { style: { fontSize: '13.5px' } }, String(z.punkte))
    },
    { key: 'form', label: 'Form', width: 88, sortable: false, render: z => formStreifen(z.form) }
  ], zeilen, {
    compact: true,
    emptyText: 'Noch kein Spiel gewertet.',
    rowClass: z => {
      const k = ['euro-' + zoneVon(z.platz, feldGroesse)];
      if (z.clubId === club.id) k.push('eigen');
      return k.join(' ');
    }
  });
  t.classList.add('tv-liga');

  const legende = el('div.tv-euro__legende',
    ...['direkt', 'playoff', 'raus'].map(zone => el('span.tv-zeile', { style: { gap: '5px' } },
      el('span.tv-euro__farbe', { class: 'euro-' + zone }),
      el('span.tv-mini', null, ZONEN_NAMEN[zone]))));

  const hinweis = feldGroesse <= DIREKT_PLAETZE * 2
    ? `Bei ${feldGroesse} Teilnehmern überwintert jeder — die Ligaphase entscheidet nur, wer die ` +
      `Play-off-Runde geschenkt bekommt. Ausgeschieden wird danach, und zwar endgültig.`
    : `Die besten ${DIREKT_PLAETZE} überspringen die Play-off-Runde. Wer hinter Platz ${feldGroesse} landet, ` +
      `fährt nach Hause und darf sich das im Fernsehen ansehen.`;

  return panel(panelKopf('Ligaphase', fertig ? 'abgeschlossen' : `${EURO.leaguePhase.matchdays} Spieltage`),
    el('div', null, t, legende, el('div.tv-mini', { style: { marginTop: '6px' } }, hinweis)));
}

/* ================================================================== *
 *  3. Ihr Weg
 * ================================================================== */

function wegZeile(state, f, club, index) {
  const heim = f.homeId === club.id;
  const gegnerId = heim ? f.awayId : f.homeId;
  const gespielt = f.played && f.result && Array.isArray(f.result.score);
  const eigene = gespielt ? (heim ? f.result.score[0] : f.result.score[1]) : null;
  const fremde = gespielt ? (heim ? f.result.score[1] : f.result.score[0]) : null;
  const art = !gespielt ? 'neutral' : eigene > fremde ? 'gut' : eigene === fremde ? 'warn' : 'schlecht';

  // Das Endspiel hat nur ein Spiel – „Finale · Hinspiel" wäre schlicht falsch.
  const runde = f.round ? EURO.knockout.find(r => r.id === f.round) : null;
  const zweiSpiele = !runde || (runde.legs || 1) > 1;
  const marke = f.round
    ? `${f.roundName || (runde && runde.name) || f.round}` +
      (zweiSpiele && f.leg ? (f.leg === 1 ? ' · Hinspiel' : ' · Rückspiel') : '')
    : `${f.matchday || index + 1}. Spieltag`;

  return el('div.tv-euro__weg', { class: gespielt ? null : 'tv-euro__weg--offen' },
    el('span.tv-mini', { style: { flex: '0 0 150px' } }, marke),
    el('span', { style: { flex: '0 0 84px' } },
      pill(f.neutral ? 'neutraler Ort' : heim ? 'Heim' : 'Auswärts',
        f.neutral ? 'neutral' : heim ? 'info' : 'neutral')),
    el('span', { style: { flex: '1', minWidth: '0' } }, vereinsZelle(state, gegnerId, { groesse: 20 })),
    el('span.tv-zeile', { style: { gap: '6px', flex: '0 0 auto', justifyContent: 'flex-end' } },
      ...merkmale(f, { ohneNeutral: true }),
      gespielt
        ? pill(`${eigene}:${fremde}`, art)
        : el('span.tv-mini', null, formatDateShort(f.dayIndex, f.season || state.date.season))));
}

function wegPanel(state, w, club) {
  const partien = partienVon(state, w.id, club.id);
  if (!partien.length) {
    return panel(panelKopf('Ihr Weg', EURO.competitions[w.id] ? EURO.competitions[w.id].short : ''),
      leer('In diesem Wettbewerb spielen wir nicht mit. Die Reisekosten spart der Verein trotzdem nicht ein.'));
  }

  const liga = partien.filter(f => !f.round);
  const ko = partien.filter(f => f.round);

  let s = 0, u = 0, n = 0, tf = 0, tg = 0;
  for (const f of partien) {
    if (!f.played || !f.result || !Array.isArray(f.result.score)) continue;
    const heim = f.homeId === club.id;
    const e = heim ? f.result.score[0] : f.result.score[1];
    const g = heim ? f.result.score[1] : f.result.score[0];
    tf += e; tg += g;
    if (e > g) s++; else if (e === g) u++; else n++;
  }

  const woche = sicher(() => englischeWoche(state, club.id), null, 'englischeWoche');

  return panel(panelKopf('Ihr Weg', `${s}S ${u}U ${n}N · ${tf}:${tg} Tore`),
    el('div.tv-spalte',
      woche && woche.englisch && woche.akut ? englischHinweis(woche) : null,
      liga.length
        ? subpanel('Ligaphase',
          el('div.tv-spalte', { style: { gap: '2px' } },
            ...liga.map((f, i) => wegZeile(state, f, club, i))))
        : null,
      ko.length
        ? subpanel('K.-o.-Runden',
          el('div.tv-spalte', { style: { gap: '2px' } },
            ...ko.map((f, i) => wegZeile(state, f, club, i))))
        : el('div.tv-mini', null,
          'Die K.-o.-Runden stehen noch aus. Erst muss die Ligaphase überstanden werden.')));
}

/**
 * Der Hinweis auf die englische Woche (ROADMAP Stufe 3, Punkt 6).
 * Dieselbe Formulierung wie auf dem Büroplan und im Spieltags-Vorbericht.
 */
function englischHinweis(woche) {
  return el('div.tv-englisch',
    el('b', null, `${woche.spiele} Spiele in acht Tagen`),
    el('span', null, woche.laufend
      ? ' — der Physio schaut schon skeptisch. Wer jetzt nicht rotiert, rotiert im Mai die Reha-Pläne.'
      : ` — es geht in ${woche.tageBisStart} Tagen los. Der Physio schaut schon skeptisch.`));
}

/* ================================================================== *
 *  4. K.-o.-Baum
 * ================================================================== */

function duellKarte(state, p, club, index) {
  const seite = (id, treffer, sieger) => el('div.tv-euro__seite', { class: sieger ? 'sieger' : null },
    wappen(vereinVon(state, id), 18),
    el('span.tv-euro__name', null, kurzName(state, id)),
    el('b.tv-num', null, String(treffer)));

  const entschieden = !!p.sieger;
  const legs = el('div.tv-euro__legs', ...p.spiele.map(sp => {
    const fx = index.get(sp.id) || null;
    const marken = merkmale(fx, { ohneElfmeter: true });
    return el('div.tv-zeile', { style: { gap: '5px', flexWrap: 'wrap' } },
      el('span.tv-mini', { style: { flex: '0 0 30px' } },
        p.spiele.length === 1 ? 'Endsp.' : sp.leg === 2 ? 'Rück' : 'Hin'),
      el('span.tv-num', { style: { flex: '1', minWidth: '0' } },
        `${abbrVon(state, sp.homeId)} ${sp.played ? tore(sp.score) : '–:–'} ${abbrVon(state, sp.awayId)}`),
      sp.played ? null : el('span.tv-mini', null, formatDateShort(sp.dayIndex, state.date.season)),
      ...marken);
  }));

  const eigen = p.a === club.id || p.b === club.id;
  return el('div.tv-euro__duell', { class: eigen ? 'eigen' : null },
    seite(p.a, p.aggregat[0], entschieden && p.sieger === p.a),
    seite(p.b, p.aggregat[1], entschieden && p.sieger === p.b),
    legs,
    Array.isArray(p.elfmeter)
      ? el('div.tv-euro__elfer', null, `Elfmeterschießen ${p.elfmeter[0]}:${p.elfmeter[1]}`)
      : null);
}

function baumPanel(state, w, club) {
  if (!w.baum.length) {
    return panel(panelKopf('K.-o.-Baum', 'Hin- und Rückspiel'),
      leer('Noch ist nichts ausgelost. Der Baum wächst erst, wenn die Ligaphase durch ist.'));
  }
  const index = fixtureIndex(state);

  const spalten = w.baum.map(runde => el('div.tv-euro__runde',
    el('div.tv-euro__rundenkopf', null, runde.name),
    ...runde.paarungen.map(p => duellKarte(state, p, club, index))));

  return panel(panelKopf('K.-o.-Baum',
    'Hin- und Rückspiel, kein Auswärtstor zählt doppelt'),
  el('div', null,
    el('div.tv-euro__baum', ...spalten),
    el('div.tv-mini', { style: { marginTop: '6px' } },
      'Bei Gleichstand nach zwei Spielen gibt es Verlängerung, danach Elfmeterschießen. ' +
        'Die Auswärtstorregel ist abgeschafft — man musste sie ohnehin nie jemandem erklären können, ' +
        'weil es niemand verstanden hat.')));
}

/* ================================================================== *
 *  5. Gegnerporträt
 * ================================================================== */

function coTrainerVon(state, clubId) {
  const club = vereinVon(state, clubId);
  if (!club || !club.staffIds) return null;
  for (const id of club.staffIds) {
    const s = state.staff ? state.staff[id] : null;
    if (s && sicher(() => rolleVon(s), null, 'rolleVon') === 'cotrainer') return s;
  }
  return null;
}

/** Stärke der elf besten gesunden Spieler — oder null, wenn es keinen Kader gibt. */
function elferStaerke(state, club) {
  const ids = (club && club.playerIds) || [];
  if (ids.length < 11) return null;
  const werte = ids.map(id => state.players[id])
    .filter(p => p && !p.injury)
    .map(playerOverall)
    .sort((a, b) => b - a)
    .slice(0, 11);
  if (werte.length < 11) return null;
  return round(werte.reduce((s, v) => s + v, 0) / werte.length, 1);
}

/**
 * Die Einschätzung des Co-Trainers.
 *
 * Kein Zufall, kein Eingriff: Die Sätze entstehen aus dem, was auf demselben
 * Bildschirm ohnehin zu sehen ist — Ruf, Kaderstärke (sofern der Gegner schon
 * einen Kader hat), Heimrecht und Land. Ein guter Co-Trainer traut sich eine
 * Zahl zu, ein schlechter redet um den heißen Brei; die Schwelle ist seine
 * Qualität, nicht ein Würfel.
 */
function einschaetzung(state, club, gegner, heim) {
  const co = coTrainerVon(state, club.id);
  const q = co ? sicher(() => qualitaetVon(co), 50, 'qualitaetVon') : 0;
  const name = co ? (co.name || 'Der Co-Trainer') : null;

  const wir = clamp(club.reputation || 50, 1, 100);
  const die = clamp(gegner.reputation || 50, 1, 100);
  const diff = die - wir;

  const kaderWir = elferStaerke(state, club);
  const kaderDie = elferStaerke(state, gegner);

  let urteil;
  if (diff > 14) {
    urteil = 'Das ist eine Nummer zu groß, und das weiß hier jeder. Tief stehen, kompakt bleiben, ' +
      'auf den einen Konter warten — und beten, dass er kommt.';
  } else if (diff > 5) {
    urteil = 'Die sind besser als wir. Nicht doppelt so gut, aber besser. Ball überlassen, schnell ' +
      'umschalten, und bloß nicht früh in Rückstand geraten.';
  } else if (diff > -6) {
    urteil = 'Auf dem Papier sind das zwei gleich starke Mannschaften. Das heißt: Es entscheidet ' +
      'eine Standardsituation oder ein Fehler. Meistens der eigene.';
  } else if (diff > -15) {
    urteil = 'Da ist etwas drin. Früh draufgehen, die sind im Aufbau nervös. Aber Vorsicht: ' +
      'Europapokalabende haben ihre eigene Statik.';
  } else {
    urteil = 'Mit Verlaub: Wenn wir das nicht gewinnen, brauchen wir über die Runde nicht zu reden. ' +
      'Von der ersten Minute an drücken, sonst wird es zäh.';
  }

  const zahlen = (kaderWir !== null && kaderDie !== null)
    ? `Die Videoauswertung sagt: Ihre besten Elf kommen auf ${nfmt(kaderDie, 1)}, unsere auf ${nfmt(kaderWir, 1)}.`
    : 'Einen Kader hat uns bisher niemand geschickt. Was wir haben, ist der Name — und der ist ' +
      'schon mal auf dem Platz gestanden und hat nichts gehalten.';

  const reise = heim
    ? `Immerhin daheim. Am Wochenende steht die Liga auf dem Zettel, das Flutlicht kostet trotzdem Beine.`
    : `Auswärts in ${sicher(() => nationName(landVon(gegner)), landVon(gegner), 'nationName')}: ` +
      `Abflug am Vortag, Rückflug in der Nacht, Samstag wieder Liga. Der Physio hat schon angerufen.`;

  const vertrauen = co
    ? (q >= 70 ? 'Er hat meistens recht.' : q >= 45 ? 'Er hat manchmal recht.' : 'Er hat selten recht, aber immer eine Meinung.')
    : null;

  return { name, urteil, zahlen, reise, vertrauen, vertrauenWert: q };
}

function kaderZeile(state, p, gegner) {
  const url = sicher(() => portraitDataURL(p, 44, { club: gegner }), '', 'portraitDataURL');
  return el('div.tv-zeile', {
    style: { gap: '6px', fontSize: '12px', padding: '3px 0', borderBottom: '1px dotted rgba(0,0,0,.16)' }
  },
  url ? el('img.tv-portrait', { src: url, alt: '', style: { width: '22px', height: '22px', flex: '0 0 22px' } }) : null,
  el('span.tv-pos', { class: 'tv-pos--' + (POSITION_GROUP[p.position] || 'MIT'), title: POSITION_NAMES[p.position] || p.position }, p.position),
  el('span', { style: { flex: '1', minWidth: '0' } },
    el('b', null, p.shortName || p.lastName || '?'),
    el('div.tv-mini', null, `${p.age || '?'} Jahre · ${p.nationality || '??'}`)),
  el('b.tv-num', null, String(Math.round(playerOverall(p)))));
}

function gegnerPanel(state, w, club, stand) {
  const eigen = stand.eigener;
  const naechste = (eigen && eigen.wettbewerb === w.id) ? eigen.naechste : null;

  if (!naechste) {
    return panel(panelKopf('Gegnerporträt', 'nächste Partie'),
      leer(w.teilnehmer.includes(club.id)
        ? 'Kein Europapokalspiel mehr angesetzt. Entweder ist es vorbei oder es wird noch gelost.'
        : 'Ohne Teilnahme kein Gegner. Man kann sich die anderen trotzdem ansehen.'));
  }

  const heim = naechste.homeId === club.id;
  const gegner = vereinVon(state, heim ? naechste.awayId : naechste.homeId);
  if (!gegner) {
    return panel(panelKopf('Gegnerporträt', 'nächste Partie'),
      leer('Zu diesem Gegner fehlen die Vereinsdaten. Sehr mysteriös.'));
  }

  const tage = naechste.dayIndex - state.date.day;
  const rat = einschaetzung(state, club, gegner, heim);
  const kader = (gegner.playerIds || []).map(id => state.players[id]).filter(Boolean)
    .sort((a, b) => playerOverall(b) - playerOverall(a))
    .slice(0, 6);

  const kopf = el('div.tv-euro__portrait',
    wappen(gegner, 62),
    el('div', { style: { minWidth: '0', flex: '1' } },
      el('div.tv-zeile', { style: { gap: '7px', flexWrap: 'wrap' } },
        flagge(landVon(gegner), 24),
        el('div', { style: { fontFamily: 'var(--font-titel)', fontSize: '21px', letterSpacing: '.8px', lineHeight: '1.05' } },
          gegner.name)),
      el('div.tv-mini', { style: { marginTop: '3px' } },
        `${sicher(() => nationName(landVon(gegner)), landVon(gegner), 'nationName')} · ` +
        `gegründet ${gegner.founded || '?'} · ` +
        `${(gegner.history && gegner.history.honours && gegner.history.honours[0]) || 'ohne Titelakte'}`),
      el('div.tv-zeile', { style: { gap: '7px', marginTop: '7px', flexWrap: 'wrap' } },
        statBox('Ruf', String(gegner.reputation || '?'), { sub: `wir: ${club.reputation || '?'}` }),
        statBox('Stadion', gegner.stadium ? nfmt(gegner.stadium.capacity || 0) : '–',
          { sub: gegner.stadium ? gegner.stadium.name : 'unbekannt' }),
        statBox(heim ? 'Heimspiel' : 'Auswärtsspiel',
          tage <= 0 ? 'HEUTE' : tage === 1 ? 'morgen' : `in ${tage} T.`,
          { kind: heim ? 'gut' : null, sub: formatDateShort(naechste.dayIndex, state.date.season) }))));

  const stimme = el('div.tv-spalte', { style: { gap: '5px' } },
    el('div.tv-euro__zitat', null, `„${rat.urteil}"`),
    el('div.tv-mini', null, rat.zahlen),
    el('div.tv-mini', null, rat.reise),
    rat.name
      ? el('div.tv-mini', { style: { fontStyle: 'italic' } }, `${rat.name}, Co-Trainer. ${rat.vertrauen}`)
      : el('div.tv-mini', { style: { fontStyle: 'italic' } },
        'Sie haben keinen Co-Trainer. Die Einschätzung stammt vom Zeugwart, der hat aber Fernsehen.'));

  const kaderTeil = kader.length
    ? subpanel(`Der Kader in Auszügen (${(gegner.playerIds || []).length} Mann)`,
      el('div.tv-spalte', { style: { gap: '0' } }, ...kader.map(p => kaderZeile(state, p, gegner))))
    : subpanel('Der Kader',
      el('div.tv-mini', null,
        'Über diesen Verein liegt uns keine Aufstellung vor — die Namen kennen wir erst, wenn sie ' +
        'am Spieltag aus dem Bus steigen. Das ist im Europapokal so, und 1997 war es auch nicht anders.'));

  return panel(panelKopf('Gegnerporträt', EURO.competitions[w.id] ? EURO.competitions[w.id].short : ''),
    el('div.tv-spalte', kopf, subpanel('Die Einschätzung des Co-Trainers', stimme), kaderTeil));
}

/* ================================================================== *
 *  6. Prämien
 * ================================================================== */

/** Die nächste Runde, die es noch zu erreichen gibt (oder null). */
function naechsteRunde(w) {
  if (w.sieger) return null;
  if (w.runde < 0) return EURO.knockout[0] || null;
  return EURO.knockout[w.runde + 1] || null;
}

function praemienPanel(state, w, club, stand) {
  const def = EURO.competitions[w.id] || {};
  const p = def.prizeMoney || {};
  const dabei = w.teilnehmer.includes(club.id);
  const eingespielt = (stand.eigener && stand.eigener.wettbewerb === w.id) ? (stand.eigener.praemien || 0) : 0;

  const zeile = (was, betrag, hell) => el('div.tv-bilanz__zeile', { class: hell ? 'tv-euro__praemie--jetzt' : null },
    el('span', null, was),
    el('b.tv-num', null, formatMoney(betrag)));

  const ligaTeil = el('div', null,
    zeile('Startgeld', p.start || 0),
    zeile('je Sieg in der Ligaphase', p.sieg || 0),
    zeile('je Remis', p.remis || 0),
    zeile('Platzprämie je Rang', p.platzPraemie || 0));

  const naechst = naechsteRunde(w);
  const koTeil = el('div', null,
    ...EURO.knockout.map(r => {
      const schluessel = RUNDEN_PRAEMIE[r.id];
      const betrag = (schluessel && p[schluessel]) || 0;
      return zeile(r.name, betrag, !!(naechst && naechst.id === r.id));
    }),
    zeile('Titelprämie obendrauf', p.titel || 0, !!(w.runde >= 0 && EURO.knockout[w.runde] && EURO.knockout[w.runde].id === 'fin')));

  const winkt = !dabei
    ? 'Ohne Teilnahme fließt hier nichts. Die Zahlen stehen trotzdem da — als Erinnerung, worum es geht.'
    : naechst
      ? `Die nächste Stufe ist ${naechst.name}: ${mio((RUNDEN_PRAEMIE[naechst.id] && p[RUNDEN_PRAEMIE[naechst.id]]) || 0)} ` +
        `allein fürs Dabeisein. Der Schatzmeister hat das Geld gedanklich schon ausgegeben.`
      : w.sieger === club.id
        ? 'Mehr geht nicht. Der Scheck ist unterschrieben, der Pokal steht in der Kabine.'
        : 'In diesem Wettbewerb ist für uns nichts mehr zu holen. Die Reisekosten bleiben.';

  return panel(panelKopf('Prämien', def.short || w.id.toUpperCase()),
    el('div.tv-spalte',
      el('div.tv-zeile', { style: { gap: '7px', flexWrap: 'wrap' } },
        statBox('Bisher eingespielt', dabei ? formatMoney(eingespielt) : '–',
          { kind: eingespielt > 0 ? 'gold' : null, sub: dabei ? 'diese Saison' : 'nicht dabei' }),
        statBox('Startgeld', mio(p.start || 0), { sub: 'einmalig' }),
        statBox('Titelprämie', mio(p.titel || 0), { sub: 'zusätzlich zum Finale' })),
      dabei && eingespielt === 0
        ? el('div.tv-mini', null,
          'Noch ist nichts geflossen: Die UEFA zahlt in Abschlägen und rechnet erst nach der Ligaphase ab. ' +
          'Bis dahin steht das Geld nur auf dem Papier — wie so vieles in diesem Geschäft.')
        : null,
      el('div.tv-grid.tv-grid--2',
        subpanel('Ligaphase', ligaTeil),
        subpanel('K.-o.-Runden', koTeil)),
      el('div.tv-mini', null, winkt)));
}

/* ================================================================== *
 *  Eine Wettbewerbsansicht
 * ================================================================== */

function wettbewerbAnsicht(ctx, w, stand) {
  const state = ctx.state;
  const club = myClub(state);
  const wrap = el('div.tv-spalte');

  const bauen = (fn, titel) => {
    try {
      return fn(state, w, club, stand);
    } catch (err) {
      console.error(`[europa] ${titel} fehlgeschlagen:`, err);
      return panel(titel, el('div.tv-leer', { style: { color: 'var(--rot)', fontStyle: 'normal' } },
        `Dieser Abschnitt konnte nicht gezeichnet werden: ${(err && err.message) || err}`));
    }
  };

  wrap.appendChild(bauen(kopfPanel, 'Wettbewerb'));
  wrap.appendChild(bauen(tabellenPanel, 'Ligaphase'));
  wrap.appendChild(el('div.tv-grid.tv-grid--haupt',
    bauen(wegPanel, 'Ihr Weg'),
    el('div.tv-spalte',
      bauen(gegnerPanel, 'Gegnerporträt'),
      bauen(praemienPanel, 'Prämien'))));
  wrap.appendChild(bauen(baumPanel, 'K.-o.-Baum'));
  return wrap;
}

/* ================================================================== *
 *  Bildschirm
 * ================================================================== */

export const screen = {
  id: 'europa',
  title: 'Europapokal',
  icon: '🌍',

  render(root, ctx) {
    const state = ctx && ctx.state;
    const club = state ? myClub(state) : null;
    if (!club) {
      root.appendChild(panel('Europapokal', leer('Kein Verein geladen.')));
      return;
    }

    const stand = sicher(() => europaStand(state), { saison: state.date.season, wettbewerbe: [], eigener: null }, 'europaStand');
    const meiner = eigenerWettbewerb(state);

    const seite = el('div.tv-seite');
    seite.appendChild(el('div.tv-seite__kopf',
      el('h1.tv-seite__titel', null, 'Europapokal'),
      el('div.tv-seite__unter', null,
        meiner && EURO.competitions[meiner]
          ? `${club.name} spielt in der ${EURO.competitions[meiner].name}. ` +
            `Donnerstags oder dienstags, je nachdem, wie gut das Vorjahr war.`
          : `${club.name} ist in dieser Saison nicht international vertreten. ` +
            `Man kann sich das auch von außen ansehen — es kostet weniger Nerven und deutlich weniger Geld.`)));

    if (!stand.wettbewerbe.length) {
      seite.appendChild(panel('Europapokal',
        el('div.tv-spalte',
          el('p', { style: { margin: '0', fontSize: '13px', lineHeight: '1.5' } },
            'Für diese Saison ist kein Feld ausgelost. Die Startplätze vergibt die Abschlusstabelle der ' +
            '1. Bundesliga — vier für die Champions League, zwei für die Europa League, einer für die ' +
            'Conference League. Der Pokalsieger fährt ebenfalls mit; ist er über die Liga schon dabei, ' +
            'rückt der nächstbeste Verein nach.'),
          el('div.tv-zeile',
            button('Zur Tabelle', () => ctx.navigate('tabelle'), { kind: 'blau', size: 'klein' })))));
      root.appendChild(seite);
      return;
    }

    if (!zustand.reiter || !stand.wettbewerbe.some(w => w.id === zustand.reiter)) {
      zustand.reiter = meiner || stand.wettbewerbe[0].id;
    }

    const items = stand.wettbewerbe.map(w => ({
      id: w.id,
      label: (EURO.competitions[w.id] && EURO.competitions[w.id].name) || w.id.toUpperCase(),
      badge: w.teilnehmer.includes(club.id) ? '★' : null,
      render: () => wettbewerbAnsicht(ctx, w, stand)
    }));

    seite.appendChild(reiter(items, {
      active: zustand.reiter,
      onChange: (id) => { zustand.reiter = id; }
    }));

    root.appendChild(seite);
  }
};

export default screen;
