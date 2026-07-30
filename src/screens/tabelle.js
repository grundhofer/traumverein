/**
 * screens/tabelle.js — Tabellen, Spielpläne, Torjäger, Bestenlisten, Pokal.
 *
 * Reiter: 1. Bundesliga, 2. Bundesliga, DFB-Pokal, Europapokal.
 *
 * Der Bildschirm liest ausschließlich: `state.tables` (von core/loop.js gepflegt),
 * `state.fixtures` und die Spielerstatistiken. Die Gesamttabelle kommt aus
 * data/leagues.js (computeTable) – nur die Teiltabellen Heim/Auswärts/Letzte 5
 * werden hier aus bereits gespeicherten Ergebnissen zusammengezählt. Das ist
 * reine Anzeige, kein Eingriff in den Spielzustand.
 */

import { POSITION_NAMES, POSITION_GROUP } from '../core/constants.js';
import { clamp, round, nfmt, formatMoney, formatDateShort } from '../core/util.js';
import { myClub } from '../core/state.js';
import { LEAGUES, CUP, EURO, computeTable, qualificationFor } from '../data/leagues.js';
import { europaStand, europaTeilnehmer } from '../club/europa.js';
import { el, panel, button, table, tabs, pill } from '../render/ui.js';
import { crestDataURL } from '../render/kits.js';
import { portraitDataURL } from '../render/portraits.js';

/* ================================================================== *
 *  Modulzustand (überlebt ctx.refresh())
 * ================================================================== */

const zustand = {
  reiter: null,
  modus: 'gesamt',
  spieltag: {}          // { [ligaId]: number }
};

const MODI = [
  { id: 'gesamt', label: 'Gesamt' },
  { id: 'heim', label: 'Heim' },
  { id: 'auswaerts', label: 'Auswärts' },
  { id: 'letzte5', label: 'Letzte 5' }
];

/* ================================================================== *
 *  Bausteine
 * ================================================================== */

function wappen(club, size = 22) {
  const box = el('span', {
    style: {
      display: 'inline-flex', width: size + 'px', height: size + 'px',
      flex: `0 0 ${size}px`, alignItems: 'center', justifyContent: 'center'
    }
  });
  if (!club) return box;
  try {
    box.appendChild(el('img', {
      src: crestDataURL(club, Math.max(32, size * 2)),
      alt: club.abbr || club.name,
      style: { width: size + 'px', height: size + 'px' }
    }));
  } catch (err) {
    box.appendChild(el('span', { class: 'tv-mini' }, club.abbr || '?'));
  }
  return box;
}

function portrait(player, size = 26) {
  try {
    return el('img', {
      class: 'tv-portrait',
      src: portraitDataURL(player, Math.max(48, size * 2)),
      alt: player.shortName || '',
      style: { width: size + 'px', height: size + 'px', flex: `0 0 ${size}px` }
    });
  } catch (err) {
    return el('div', { class: 'tv-portrait', style: { width: size + 'px', height: size + 'px', flex: `0 0 ${size}px` } });
  }
}

function formStreifen(form, anzahl = 5) {
  const arr = (form || []).slice(-anzahl);
  if (!arr.length) return el('span', { class: 'tv-mini' }, '–');
  return el('span', { class: 'tv-form' }, ...arr.map(z => el('span', { class: z }, z)));
}

function posPille(pos) {
  return el('span', { class: 'tv-pos tv-pos--' + (POSITION_GROUP[pos] || 'MIT'), title: POSITION_NAMES[pos] || pos }, pos);
}

function spielerZelle(p, eigenerVerein) {
  return el('span', { class: 'tv-zeile', style: { gap: '6px', minWidth: 0 } },
    portrait(p, 28),
    posPille(p.position),
    el('span', { style: { minWidth: 0 } },
      el('div', { class: 'tv-zeile', style: { gap: '5px' } },
        el('b', {}, p.shortName || p.lastName || '?'),
        p.era === 'legend' ? pill(p.eraLabel || 'Legende', 'legende') : null,
        eigenerVerein ? pill('eigen', 'gut') : null),
      el('div', { class: 'tv-mini' },
        `${POSITION_NAMES[p.position] || p.position} · ${p.age} Jahre · ${p.nationality || '??'}`)));
}

function vereinsZelle(state, clubId) {
  const c = clubId ? state.clubs[clubId] : null;
  return el('span', { class: 'tv-zeile', style: { gap: '6px', minWidth: 0 } },
    wappen(c, 20), el('span', {}, c ? c.shortName : 'vereinslos'));
}

function panelKopf(titel, extra) {
  return [
    el('span', {}, titel),
    extra ? el('span', {
      class: 'tv-panel__extra',
      style: { marginLeft: 'auto', fontWeight: 400, letterSpacing: '.3px', textTransform: 'none', opacity: .9 }
    }, extra) : null
  ];
}

/**
 * styles/main.css formt `.tv-tabs` zu einer waagerechten Leiste – das würde
 * Reiterknöpfe und Reiterinhalt nebeneinander stellen. Inline zurückdrehen,
 * und zusätzlich die von main.css erwartete Klasse `aktiv` mitpflegen.
 */
function reiter(items, opts = {}) {
  // tabs() ruft onChange bereits beim ersten waehle() auf – `t` existiert dann
  // noch nicht. Deshalb vorab deklarieren statt const im selben Ausdruck.
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

function versuche(fn, fallback = null, kontext = '') {
  try {
    return fn();
  } catch (err) {
    if (kontext) console.warn(`[tabelle] ${kontext}:`, err);
    return fallback;
  }
}

function leer(text) {
  return el('div', { class: 'tv-leer' }, text);
}

/* ================================================================== *
 *  Bildschirm
 * ================================================================== */

export const screen = {
  id: 'tabelle',
  title: 'Tabelle',
  icon: '📊',

  render(root, ctx) {
    const state = ctx.state;
    const club = myClub(state);
    if (!club) {
      root.appendChild(panel('Tabelle', leer('Kein Verein geladen.')));
      return;
    }
    if (!zustand.reiter) zustand.reiter = club.leagueId || 'bl1';

    const seite = el('div', { class: 'tv-seite' });
    const zeile = (state.tables[club.leagueId] || []).find(z => z.clubId === club.id);

    seite.appendChild(el('div', { class: 'tv-seite__kopf' },
      el('h1', { class: 'tv-seite__titel' }, 'Tabellen & Statistik'),
      el('div', { class: 'tv-seite__unter' },
        zeile
          ? `${club.name} steht auf Platz ${zeile.platz} mit ${zeile.punkte} Punkten ` +
            `(${zeile.tore}:${zeile.gegentore} Tore).`
          : `${club.name} · noch kein Spiel gewertet.`)));

    const items = [
      { id: 'bl1', label: '1. Bundesliga', render: () => ligaAnsicht(ctx, 'bl1') },
      { id: 'bl2', label: '2. Bundesliga', render: () => ligaAnsicht(ctx, 'bl2') },
      { id: 'pokal', label: 'DFB-Pokal', render: () => pokalAnsicht(ctx) },
      { id: 'europa', label: 'Europapokal', render: () => europaAnsicht(ctx) }
    ];

    seite.appendChild(reiter(items, {
      active: zustand.reiter,
      onChange: (id) => { zustand.reiter = id; }
    }));

    root.appendChild(seite);
  }
};

/* ================================================================== *
 *  Ligaansicht
 * ================================================================== */

function ligaAnsicht(ctx, ligaId) {
  const state = ctx.state;
  const liga = LEAGUES[ligaId];
  if (!liga) return panel('Liga', leer('Diese Liga gibt es nicht.'));

  const wrap = el('div', { class: 'tv-spalte' });
  const tabellenHost = el('div');

  const knoepfe = MODI.map(m => {
    const b = button(m.label, () => {
      zustand.modus = m.id;
      knoepfe.forEach(x => x.classList.toggle('tv-btn--primary', x.dataset.modus === m.id));
      zeichneTabelle();
    }, { size: 'klein' });
    b.dataset.modus = m.id;
    if (zustand.modus === m.id) b.classList.add('tv-btn--primary');
    return b;
  });

  function zeichneTabelle() {
    tabellenHost.replaceChildren(ligaTabellenPanel(ctx, liga, zustand.modus, knoepfe));
  }
  zeichneTabelle();

  wrap.appendChild(tabellenHost);
  wrap.appendChild(el('div', { class: 'tv-grid tv-grid--haupt' },
    el('div', { class: 'tv-spalte' },
      spielplanPanel(ctx, liga),
      torjaegerPanel(ctx, liga)),
    el('div', { class: 'tv-spalte' },
      bestenlistenPanel(ctx, liga))));

  return wrap;
}

/* ---------- Die eigentliche Tabelle ---------------------------------- */

function ligaTabellenPanel(ctx, liga, modus, knoepfe) {
  const state = ctx.state;
  const club = myClub(state);
  const zeilen = tabelleFuer(state, liga, modus);
  const zonen = modus === 'gesamt';

  const t = table([
    {
      key: 'platz', label: '#', width: 34, numeric: true, sortable: false,
      render: z => el('b', { class: 'tv-num' }, String(z.platz))
    },
    {
      key: 'verein', label: 'Verein', sortable: false,
      render: z => {
        const c = state.clubs[z.clubId];
        return el('span', { class: 'tv-zeile', style: { gap: '7px', minWidth: 0 } },
          wappen(c, 22),
          el('span', { style: { minWidth: 0 } },
            el('div', {}, c ? c.name : z.clubId),
            el('div', { class: 'tv-mini' }, c ? `${c.city} · ${c.stadium ? c.stadium.name : ''}` : '')));
      }
    },
    { key: 'spiele', label: 'Sp', width: 34, numeric: true, sortable: false },
    { key: 's', label: 'S', width: 30, numeric: true, sortable: false },
    { key: 'u', label: 'U', width: 30, numeric: true, sortable: false },
    { key: 'n', label: 'N', width: 30, numeric: true, sortable: false },
    {
      key: 'tore', label: 'Tore', width: 62, align: 'center', sortable: false,
      render: z => el('span', { class: 'tv-num' }, `${z.tore}:${z.gegentore}`)
    },
    {
      key: 'diff', label: 'Diff', width: 44, numeric: true, sortable: false,
      render: z => el('span', { class: 'tv-num ' + (z.diff > 0 ? 'tv-gut' : z.diff < 0 ? 'tv-schlecht' : '') },
        (z.diff > 0 ? '+' : '') + z.diff)
    },
    {
      key: 'punkte', label: 'Pkt', width: 40, numeric: true, sortable: false,
      render: z => el('b', { class: 'tv-num', style: { fontSize: '13.5px' } }, String(z.punkte))
    },
    { key: 'form', label: 'Form', width: 92, sortable: false, render: z => formStreifen(z.form) },
    {
      key: 'zuschauer', label: 'Ø Zuschauer', width: 92, numeric: true, sortable: false,
      render: z => {
        const s = zuschauerSchnitt(state, z.clubId);
        return s ? nfmt(s) : '–';
      }
    },
    {
      key: 'kaderwert', label: 'Kaderwert', width: 96, numeric: true, sortable: false,
      render: z => formatMoney(kaderwert(state, z.clubId))
    }
  ], zeilen, {
    compact: true,
    emptyText: 'Es wurde noch kein Spiel ausgetragen. Die Tabelle ist so leer wie die Vitrine.',
    rowClass: z => {
      const klassen = [];
      if (zonen) {
        const k = zonenKlasse(liga.id, z.platz);
        if (k) klassen.push(k);
      }
      if (z.clubId === club.id) klassen.push('eigen');
      return klassen.join(' ') || null;
    }
  });
  t.classList.add('tv-liga');

  const untertitel = {
    gesamt: 'Alle Spiele',
    heim: 'Nur Heimspiele',
    auswaerts: 'Nur Auswärtsspiele',
    letzte5: 'Nur die jeweils letzten fünf Spiele'
  }[modus];

  return panel(panelKopf(liga.name, untertitel),
    el('div', {},
      el('div', { class: 'tv-zeile', style: { marginBottom: '8px', flexWrap: 'wrap', gap: '5px' } },
        el('span', { class: 'tv-mini' }, 'Ansicht:'), ...knoepfe),
      t,
      zonen ? zonenLegende(liga) : el('div', { class: 'tv-mini', style: { marginTop: '6px' } },
        'Platzierungszonen gelten nur für die Gesamttabelle.')));
}

function zonenKlasse(ligaId, platz) {
  const q = versuche(() => qualificationFor(ligaId, platz), null, 'qualificationFor');
  switch (q) {
    case 'meister': return 'platz-meister';
    case 'aufstieg': return 'platz-cl';
    case 'cl': return 'platz-cl';
    case 'el': return 'platz-el';
    case 'conf': return 'platz-conf';
    case 'relegation': return 'platz-relegation';
    case 'abstieg': return 'platz-abstieg';
    default: return null;
  }
}

function zonenLegende(liga) {
  const eintrag = (klasse, text) => el('span', { class: 'tv-zeile', style: { gap: '5px' } },
    el('span', {
      style: {
        width: '13px', height: '13px', display: 'inline-block', borderRadius: '2px',
        border: '1px solid rgba(0,0,0,.4)',
        background: {
          'platz-meister': 'var(--gold)',
          'platz-cl': 'var(--blau)',
          'platz-el': 'var(--tuerkis)',
          'platz-conf': '#7bc043',
          'platz-relegation': 'var(--orange)',
          'platz-abstieg': 'var(--rot)'
        }[klasse]
      }
    }),
    el('span', { class: 'tv-mini' }, text));

  const teile = liga.tier === 1
    ? [
      eintrag('platz-meister', 'Deutscher Meister'),
      eintrag('platz-cl', 'Champions League'),
      eintrag('platz-el', 'Europa League'),
      eintrag('platz-conf', 'Conference League'),
      eintrag('platz-relegation', 'Relegation'),
      eintrag('platz-abstieg', 'Abstieg')
    ]
    : [
      eintrag('platz-meister', 'Meister und Aufstieg'),
      eintrag('platz-cl', 'Direkter Aufstieg'),
      eintrag('platz-relegation', 'Relegation'),
      eintrag('platz-abstieg', 'Abstieg')
    ];

  return el('div', {
    class: 'tv-zeile',
    style: { flexWrap: 'wrap', gap: '12px', marginTop: '8px', paddingTop: '6px', borderTop: '1px solid var(--linie)' }
  }, ...teile);
}

/* ---------- Tabellenberechnung --------------------------------------- */

function ligaSpiele(state, ligaId) {
  return state.fixtures.filter(f =>
    f.competitionId === ligaId &&
    f.season === state.date.season &&
    f.played && f.result && Array.isArray(f.result.score));
}

function tabelleFuer(state, liga, modus) {
  const spiele = ligaSpiele(state, liga.id);

  if (modus === 'gesamt') {
    const fertig = state.tables[liga.id];
    if (fertig && fertig.length) return fertig;
    return versuche(() => computeTable(spiele, liga.clubIds, { season: state.date.season }), [], 'computeTable');
  }

  const chrono = spiele.slice().sort((a, b) => (a.dayIndex - b.dayIndex) || (a.matchday - b.matchday));
  const proVerein = new Map(liga.clubIds.map(id => [id, []]));
  for (const f of chrono) {
    const [h, a] = f.result.score;
    if (proVerein.has(f.homeId)) proVerein.get(f.homeId).push({ tore: h, gegentore: a, heim: true });
    if (proVerein.has(f.awayId)) proVerein.get(f.awayId).push({ tore: a, gegentore: h, heim: false });
  }

  const zeilen = liga.clubIds.map(id => {
    let liste = proVerein.get(id) || [];
    if (modus === 'heim') liste = liste.filter(e => e.heim);
    else if (modus === 'auswaerts') liste = liste.filter(e => !e.heim);
    else if (modus === 'letzte5') liste = liste.slice(-5);

    const z = {
      clubId: id, spiele: liste.length, s: 0, u: 0, n: 0,
      tore: 0, gegentore: 0, diff: 0, punkte: 0, platz: 0, form: []
    };
    for (const e of liste) {
      z.tore += e.tore;
      z.gegentore += e.gegentore;
      if (e.tore > e.gegentore) { z.s++; z.punkte += 3; z.form.push('S'); }
      else if (e.tore === e.gegentore) { z.u++; z.punkte += 1; z.form.push('U'); }
      else { z.n++; z.form.push('N'); }
    }
    z.diff = z.tore - z.gegentore;
    z.form = z.form.slice(-5);
    return z;
  });

  const reihenfolge = new Map(liga.clubIds.map((id, i) => [id, i]));
  zeilen.sort((a, b) =>
    (b.punkte - a.punkte) || (b.diff - a.diff) || (b.tore - a.tore) ||
    (reihenfolge.get(a.clubId) - reihenfolge.get(b.clubId)));
  zeilen.forEach((z, i) => { z.platz = i + 1; });
  return zeilen;
}

function zuschauerSchnitt(state, clubId) {
  const c = state.clubs[clubId];
  const s = c && c.stadiumState;
  if (!s) return null;
  if (s.heimspiele > 0 && s.zuschauerSumme > 0) return Math.round(s.zuschauerSumme / s.heimspiele);
  if (s.letzteZuschauer) return s.letzteZuschauer;
  return null;
}

function kaderwert(state, clubId) {
  const c = state.clubs[clubId];
  if (!c || !c.playerIds || !c.playerIds.length) return 0;
  let summe = 0;
  for (const id of c.playerIds) {
    const p = state.players[id];
    if (p && p.value) summe += p.value;
  }
  return summe;
}

/* ---------- Spielplan -------------------------------------------------- */

function spielplanPanel(ctx, liga) {
  const state = ctx.state;
  const club = myClub(state);
  const alle = state.fixtures.filter(f => f.competitionId === liga.id && f.season === state.date.season);
  const maxSpieltag = alle.reduce((m, f) => Math.max(m, f.matchday || 0), 0) || liga.matchdays || 34;

  if (zustand.spieltag[liga.id] === undefined || zustand.spieltag[liga.id] === null) {
    const gespielt = alle.filter(f => f.played).reduce((m, f) => Math.max(m, f.matchday || 0), 0);
    zustand.spieltag[liga.id] = clamp(gespielt || 1, 1, maxSpieltag);
  }

  const host = el('div');
  const anzeige = el('b', { style: { minWidth: '110px', textAlign: 'center' } });

  const zurueck = button('◀', () => wechsle(-1), { size: 'klein' });
  const vor = button('▶', () => wechsle(1), { size: 'klein' });
  const auswahl = el('select', {
    style: { padding: '3px 6px' },
    onchange: e => { zustand.spieltag[liga.id] = Number(e.target.value); zeichne(); }
  });
  for (let i = 1; i <= maxSpieltag; i++) {
    auswahl.appendChild(el('option', { value: String(i) }, `${i}. Spieltag`));
  }

  function wechsle(delta) {
    zustand.spieltag[liga.id] = clamp(zustand.spieltag[liga.id] + delta, 1, maxSpieltag);
    zeichne();
  }

  function zeichne() {
    const st = zustand.spieltag[liga.id];
    anzeige.textContent = `${st}. Spieltag`;
    auswahl.value = String(st);
    zurueck.disabled = st <= 1;
    vor.disabled = st >= maxSpieltag;

    const partien = alle.filter(f => f.matchday === st)
      .sort((a, b) => (a.dayIndex - b.dayIndex) || String(a.homeId).localeCompare(String(b.homeId)));

    if (!partien.length) {
      host.replaceChildren(leer('Für diesen Spieltag ist nichts angesetzt.'));
      return;
    }

    host.replaceChildren(el('div', { class: 'tv-spalte', style: { gap: '3px' } },
      ...partien.map(f => spielZeile(state, f, club))));
  }

  zeichne();

  return panel(panelKopf('Spielplan', liga.name),
    el('div', {},
      el('div', { class: 'tv-zeile', style: { marginBottom: '8px', gap: '6px' } },
        zurueck, anzeige, vor, auswahl),
      host));
}

function spielZeile(state, f, club) {
  const h = state.clubs[f.homeId];
  const a = state.clubs[f.awayId];
  const eigen = f.homeId === club.id || f.awayId === club.id;
  const gespielt = f.played && f.result && Array.isArray(f.result.score);

  return el('div', {
    style: {
      display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 74px minmax(0,1fr) 96px',
      gap: '7px', alignItems: 'center', padding: '4px 6px', fontSize: '12px',
      background: eigen ? 'rgba(217,165,33,.3)' : 'rgba(255,255,255,.22)',
      border: '1px solid ' + (eigen ? 'var(--gold)' : 'var(--linie)'),
      borderRadius: '2px',
      fontWeight: eigen ? 700 : 400
    }
  },
  el('span', { class: 'tv-zeile', style: { gap: '6px', minWidth: 0 } },
    wappen(h, 20), el('span', {}, h ? h.shortName : '?')),
  el('span', {
    class: 'tv-num tv-mittig',
    style: { fontWeight: 700, fontSize: gespielt ? '14px' : '12px' }
  }, gespielt ? `${f.result.score[0]} : ${f.result.score[1]}` : '– : –'),
  el('span', { class: 'tv-zeile', style: { gap: '6px', minWidth: 0, justifyContent: 'flex-end' } },
    el('span', {}, a ? a.shortName : '?'), wappen(a, 20)),
  el('span', { class: 'tv-mini tv-rechts' }, formatDateShort(f.dayIndex, f.season)));
}

/* ---------- Torjägerliste ---------------------------------------------- */

function ligaSpieler(state, liga) {
  const out = [];
  for (const clubId of liga.clubIds) {
    const c = state.clubs[clubId];
    if (!c || !c.playerIds) continue;
    for (const id of c.playerIds) {
      const p = state.players[id];
      if (p && !p.jugend) out.push(p);
    }
  }
  return out;
}

function schnitt(p) {
  const s = p.stats && p.stats.season;
  if (!s || !s.notenAnzahl) return 0;
  return s.notenSumme / s.notenAnzahl;
}

function noteText(n) {
  return n > 0 ? round(n, 2).toFixed(2).replace('.', ',') : '–';
}

function torjaegerPanel(ctx, liga) {
  const state = ctx.state;
  const club = myClub(state);
  const liste = ligaSpieler(state, liga)
    .filter(p => p.stats && p.stats.season && p.stats.season.tore > 0)
    .sort((a, b) =>
      (b.stats.season.tore - a.stats.season.tore) ||
      (b.stats.season.vorlagen - a.stats.season.vorlagen) ||
      (a.stats.season.spiele - b.stats.season.spiele))
    .slice(0, 20)
    .map((p, i) => ({ id: p.id, rang: i + 1, player: p }));

  if (!liste.length) {
    return panel(panelKopf('Torjägerliste', liga.name),
      leer('Noch kein Tor gefallen. Die Torhüter dieser Liga sind in Topform – oder die Stürmer nicht.'));
  }

  const t = table([
    { key: 'rang', label: '#', width: 30, numeric: true, sortable: false },
    {
      key: 'name', label: 'Spieler', sortable: false,
      render: r => spielerZelle(r.player, r.player.clubId === club.id)
    },
    { key: 'verein', label: 'Verein', width: 132, sortable: false, render: r => vereinsZelle(state, r.player.clubId) },
    { key: 'spiele', label: 'Sp', width: 34, numeric: true, sortable: false, render: r => String(r.player.stats.season.spiele || 0) },
    {
      key: 'tore', label: 'Tore', width: 44, numeric: true, sortable: false,
      render: r => el('b', { class: 'tv-num', style: { fontSize: '13.5px' } }, String(r.player.stats.season.tore || 0))
    },
    { key: 'vorlagen', label: 'Vorl.', width: 44, numeric: true, sortable: false, render: r => String(r.player.stats.season.vorlagen || 0) },
    {
      key: 'quote', label: 'Tore/Sp', width: 60, numeric: true, sortable: false,
      render: r => {
        const s = r.player.stats.season;
        return s.spiele ? round(s.tore / s.spiele, 2).toFixed(2).replace('.', ',') : '–';
      }
    },
    { key: 'note', label: 'Note', width: 48, numeric: true, sortable: false, render: r => noteText(schnitt(r.player)) }
  ], liste, {
    compact: true,
    rowClass: r => [
      r.player.era === 'legend' ? 'zeile--legende' : null,
      r.player.clubId === club.id ? 'gewaehlt' : null
    ].filter(Boolean).join(' ') || null
  });
  t.style.maxHeight = '520px';

  return panel(panelKopf('Torjägerliste', `${liga.name} · Top 20`), t);
}

/* ---------- Bestenlisten ------------------------------------------------ */

function bestenlistenPanel(ctx, liga) {
  const state = ctx.state;
  const club = myClub(state);
  const alle = ligaSpieler(state, liga);

  const miniListe = (titel, hinweis, eintraege, wertFn) => {
    if (!eintraege.length) {
      return el('div', { class: 'tv-subpanel' },
        el('div', { class: 'tv-subpanel__titel' }, titel),
        el('div', { class: 'tv-mini' }, hinweis));
    }
    return el('div', { class: 'tv-subpanel' },
      el('div', { class: 'tv-subpanel__titel' }, titel),
      ...eintraege.map((p, i) => {
        const c = p.clubId ? state.clubs[p.clubId] : null;
        return el('div', {
          class: 'tv-zeile tv-zeile--verteilt',
          style: {
            gap: '7px', padding: '3px 2px', fontSize: '12px',
            borderBottom: '1px dotted rgba(0,0,0,.16)',
            background: p.clubId === club.id ? 'rgba(217,165,33,.28)' : (p.era === 'legend' ? 'rgba(217,165,33,.12)' : 'none')
          }
        },
        el('span', { class: 'tv-zeile', style: { gap: '6px', minWidth: 0 } },
          el('span', { class: 'tv-num tv-mini', style: { width: '16px' } }, String(i + 1)),
          portrait(p, 22),
          el('span', { style: { minWidth: 0 } },
            el('div', { class: 'tv-zeile', style: { gap: '4px' } },
              el('b', {}, p.shortName || p.lastName),
              p.era === 'legend' ? pill('★', 'legende') : null),
            el('div', { class: 'tv-mini' }, c ? c.shortName : '–'))),
        el('b', { class: 'tv-num' }, wertFn(p)));
      }));
  };

  const mitSpielen = alle.filter(p => p.stats && p.stats.season && p.stats.season.spiele >= 5);

  const noten = mitSpielen.slice()
    .filter(p => schnitt(p) > 0)
    .sort((a, b) => schnitt(b) - schnitt(a)).slice(0, 5);

  const vorlagen = alle.slice()
    .filter(p => p.stats && p.stats.season && p.stats.season.vorlagen > 0)
    .sort((a, b) => b.stats.season.vorlagen - a.stats.season.vorlagen).slice(0, 5);

  const zuNull = alle.slice()
    .filter(p => p.position === 'TW' && p.stats && p.stats.season && p.stats.season.zuNull > 0)
    .sort((a, b) => b.stats.season.zuNull - a.stats.season.zuNull).slice(0, 5);

  const gelb = alle.slice()
    .filter(p => p.stats && p.stats.season && p.stats.season.gelb > 0)
    .sort((a, b) => b.stats.season.gelb - a.stats.season.gelb).slice(0, 5);

  const teuerste = alle.slice()
    .sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 5);

  return panel(panelKopf('Bestenlisten', liga.name),
    el('div', { class: 'tv-spalte' },
      miniListe('Beste Durchschnittsnote', 'Noch niemand hat fünf Spiele beisammen.', noten, p => noteText(schnitt(p))),
      miniListe('Meiste Vorlagen', 'Es wird gedribbelt, nicht abgespielt.', vorlagen, p => String(p.stats.season.vorlagen)),
      miniListe('Meiste Spiele zu Null', 'Noch hat jeder Torhüter etwas kassiert.', zuNull, p => String(p.stats.season.zuNull)),
      miniListe('Meiste gelbe Karten', 'Eine friedliche Liga. Noch.', gelb, p => String(p.stats.season.gelb)),
      miniListe('Teuerste Spieler', 'Keine Marktwerte hinterlegt.', teuerste, p => formatMoney(p.value || 0))));
}

/* ================================================================== *
 *  Pokalansicht
 * ================================================================== */

function pokalAnsicht(ctx) {
  const state = ctx.state;
  const club = myClub(state);
  const partien = state.fixtures.filter(f => f.competitionId === CUP.id && f.season === state.date.season);

  const wrap = el('div', { class: 'tv-spalte' });

  const eigene = partien.filter(f => f.homeId === club.id || f.awayId === club.id)
    .sort((a, b) => a.dayIndex - b.dayIndex);
  const aktuelleRunde = CUP.rounds[clamp(state.pokal ? state.pokal.runde : 0, 0, CUP.rounds.length - 1)];

  wrap.appendChild(panel(panelKopf(CUP.name, `Saison ${state.date.season} · Finale in ${CUP.finalOrt}`),
    el('div', { class: 'tv-spalte' },
      el('div', { class: 'tv-zeile', style: { gap: '10px', flexWrap: 'wrap' } },
        pill(`Aktuell: ${aktuelleRunde ? aktuelleRunde.name : '–'}`, 'info'),
        pill(`${partien.filter(f => f.played).length} von ${partien.length} Partien gespielt`, 'neutral'),
        state.pokal && state.pokal.ausgeschieden && state.pokal.ausgeschieden.includes(state.date.season)
          ? pill('Ihr Verein ist raus', 'schlecht')
          : pill('Ihr Verein ist noch dabei', 'gut')),
      eigene.length
        ? el('div', {},
          el('div', { class: 'tv-subpanel__titel' }, 'Ihr Weg durch den Pokal'),
          el('div', { class: 'tv-spalte', style: { gap: '3px' } },
            ...eigene.map(f => el('div', { class: 'tv-zeile tv-zeile--verteilt', style: { fontSize: '12px', padding: '3px 0', borderBottom: '1px dotted rgba(0,0,0,.16)' } },
              el('span', { class: 'tv-zeile', style: { gap: '6px' } },
                pill(f.roundName || '?', 'info'),
                wappen(state.clubs[f.homeId], 18),
                el('span', {}, (state.clubs[f.homeId] || {}).shortName || '?'),
                el('span', { class: 'tv-mini' }, '–'),
                el('span', {}, f.freilos ? 'Freilos' : ((state.clubs[f.awayId] || {}).shortName || '?')),
                f.awayId ? wappen(state.clubs[f.awayId], 18) : null),
              f.freilos
                ? pill('kampflos weiter', 'gut')
                : (f.played && f.result
                  ? el('b', { class: 'tv-num' }, `${f.result.score[0]}:${f.result.score[1]}`)
                  : el('span', { class: 'tv-mini' }, formatDateShort(f.dayIndex, f.season)))))))
        : leer('Ihr Verein ist in diesem Wettbewerb (noch) nicht vertreten.'))));

  for (const rd of CUP.rounds) {
    const rundenSpiele = partien.filter(f => f.round === rd.id)
      .sort((a, b) => (a.dayIndex - b.dayIndex) || String(a.homeId).localeCompare(String(b.homeId)));
    if (!rundenSpiele.length) continue;

    const gitter = el('div', { class: 'tv-konferenz' }, ...rundenSpiele.map(f => {
      const h = state.clubs[f.homeId];
      const a = f.awayId ? state.clubs[f.awayId] : null;
      const eigen = f.homeId === club.id || f.awayId === club.id;
      return el('div', { class: 'tv-konferenz__spiel' + (eigen ? ' eigen' : '') },
        el('span', { class: 'tv-zeile', style: { gap: '5px', minWidth: 0 } },
          wappen(h, 18), el('span', {}, h ? h.shortName : '?')),
        el('span', { class: 'tv-konferenz__stand' },
          f.freilos ? 'frei' : (f.played && f.result ? `${f.result.score[0]}:${f.result.score[1]}` : '–:–')),
        el('span', { class: 'tv-konferenz__gast tv-zeile', style: { gap: '5px', justifyContent: 'flex-end', minWidth: 0 } },
          el('span', {}, a ? a.shortName : (f.freilos ? '(Freilos)' : '?')), a ? wappen(a, 18) : null));
    }));

    wrap.appendChild(panel(panelKopf(rd.name,
      `${rundenSpiele.length} Partien · Prämie ${formatMoney(rd.prize)}`), gitter));
  }

  if (!partien.length) {
    wrap.appendChild(panel('Pokal', leer('Für diese Saison ist noch keine Runde ausgelost.')));
  }

  return wrap;
}

/* ================================================================== *
 *  Europapokal
 * ================================================================== */

/**
 * Der Europapokal-Reiter.
 *
 * Er zeigt hier NUR noch, was zur Bundesligatabelle gehört: den Stand der
 * Qualifikation und eine Kurzfassung des eigenen Abschneidens. Alles Weitere —
 * Ligaphasentabelle über das ganze Feld, K.-o.-Baum, Gegnerporträt, Prämien —
 * steht seit ROADMAP-Stufe 3 auf einem eigenen Bildschirm (screens/europa.js).
 *
 * Der frühere Dauersatz („In dieser Saison läuft für uns noch kein Europapokal")
 * ist damit erledigt; die vollständige Partienliste ebenfalls: Drei Wettbewerbe
 * mit je 24 Vereinen und acht Spieltagen sind 288 Begegnungen, und die als eine
 * Kachelwand zu zeigen war schon als Platzhalter grenzwertig.
 */
function europaAnsicht(ctx) {
  const state = ctx.state;
  const club = myClub(state);
  const wettbewerbe = ['cl', 'el', 'conf'];

  const wrap = el('div', { class: 'tv-spalte' });

  const stand = versuche(() => europaStand(state), { wettbewerbe: [], eigener: null }, 'europaStand');
  const meiner = versuche(() => europaTeilnehmer(state, club.id), null, 'europaTeilnehmer');
  const partien = state.fixtures.filter(f =>
    wettbewerbe.includes(f.competitionId) && f.season === state.date.season &&
    (f.homeId === club.id || f.awayId === club.id));
  const gespielt = partien.filter(f => f.played && f.result && Array.isArray(f.result.score));

  const zumBildschirm = button('Zum Europapokal ▶', () => ctx.navigate('europa'),
    { kind: 'primary', size: 'klein' });

  if (meiner && EURO.competitions[meiner]) {
    const meta = EURO.competitions[meiner];
    const w = (stand.wettbewerbe || []).find(x => x.id === meiner) || null;
    const zeile = w ? (w.tabelle || []).find(z => z.clubId === club.id) : null;
    wrap.appendChild(panel(panelKopf(meta.name, w ? w.rundeName : 'Ligaphase'),
      el('div', { class: 'tv-spalte' },
        el('div', { class: 'tv-zeile', style: { gap: '10px', flexWrap: 'wrap' } },
          pill(`${club.shortName} ist dabei`, 'gut'),
          zeile ? pill(`Ligaphase: Platz ${zeile.platz} · ${zeile.punkte} Pkt`, 'info') : null,
          pill(`${gespielt.length} von ${partien.length} Partien gespielt`, 'neutral'),
          stand.eigener && stand.eigener.praemien
            ? pill(`Prämien ${formatMoney(stand.eigener.praemien)}`, 'warn') : null),
        el('div', { class: 'tv-mini' },
          'Ligaphasentabelle, K.-o.-Baum, Gegnerporträt und die Prämienrechnung stehen auf dem ' +
          'Europapokal-Bildschirm. Hier bleibt die Bundesliga — und die Frage, ob wir nächstes Jahr ' +
          'wieder dabei sind.'),
        el('div', { class: 'tv-zeile' }, zumBildschirm))));
  } else {
    wrap.appendChild(panel(panelKopf('Europapokal', `Saison ${state.date.season}`),
      el('div', { class: 'tv-spalte' },
        el('div', { class: 'tv-zeile', style: { gap: '10px', flexWrap: 'wrap' } },
          pill('Ohne uns', 'neutral'),
          ...(stand.wettbewerbe || []).map(w => pill(
            `${(EURO.competitions[w.id] || {}).short || w.id}: ${w.rundeName}`, 'info'))),
        el('div', { class: 'tv-mini' },
          'Wir spielen in dieser Saison nicht international. Zusehen darf man trotzdem — auf dem ' +
          'Europapokal-Bildschirm laufen alle drei Wettbewerbe, mit Tabelle, Baum und den Beträgen, ' +
          'die dort verteilt werden. Das ist entweder Ansporn oder Selbstkasteiung.'),
        el('div', { class: 'tv-zeile' }, zumBildschirm))));
  }

  // Immer sichtbar: Wer stünde heute wo?
  const bl1 = state.tables.bl1 || [];
  const qualiZeilen = bl1.slice(0, 8).map(z => {
    const q = versuche(() => qualificationFor('bl1', z.platz), null, 'qualificationFor');
    return { z, q };
  }).filter(e => e.q && e.q !== 'abstieg' && e.q !== 'relegation');

  const QUALI_NAMEN = {
    meister: 'Meister · Champions League',
    cl: 'Champions League',
    el: 'Europa League',
    conf: 'Conference League'
  };

  wrap.appendChild(panel(panelKopf('Stand der Qualifikation', '1. Bundesliga'),
    qualiZeilen.length
      ? el('div', { class: 'tv-spalte', style: { gap: '3px' } },
        ...qualiZeilen.map(({ z, q }) => {
          const c = state.clubs[z.clubId];
          return el('div', {
            class: 'tv-zeile tv-zeile--verteilt',
            style: {
              fontSize: '12px', padding: '4px 6px', borderRadius: '2px',
              background: z.clubId === club.id ? 'rgba(217,165,33,.3)' : 'rgba(255,255,255,.22)',
              border: '1px solid var(--linie)'
            }
          },
          el('span', { class: 'tv-zeile', style: { gap: '7px' } },
            el('b', { class: 'tv-num', style: { width: '20px' } }, `${z.platz}.`),
            wappen(c, 20),
            el('span', {}, c ? c.name : z.clubId)),
          el('span', { class: 'tv-zeile', style: { gap: '8px' } },
            el('span', { class: 'tv-num tv-mini' }, `${z.punkte} Pkt`),
            pill(QUALI_NAMEN[q] || q, q === 'meister' ? 'gold' : q === 'cl' ? 'info' : 'gut')));
        }))
      : leer('Die Tabelle gibt noch nichts her – gespielt wird ab August.')));

  // Wer fährt in diesem Jahr wohin? Die Meldeliste steht hier, weil sie aus der
  // Abschlusstabelle der Vorsaison stammt – der Rest gehört auf screens/europa.js.
  const teilnehmer = (state.europa && Array.isArray(state.europa.teilnehmer))
    ? state.europa.teilnehmer : [];
  wrap.appendChild(panel(panelKopf('Die deutschen Starter', `Saison ${state.date.season}`),
    teilnehmer.length
      ? el('div', { class: 'tv-spalte', style: { gap: '3px' } },
        ...teilnehmer.map(t => {
          const id = t.clubId || t;
          const c = state.clubs[id];
          const meta = EURO.competitions[t.competition] || null;
          return el('div', {
            class: 'tv-zeile tv-zeile--verteilt',
            style: {
              fontSize: '12px', padding: '4px 6px', borderRadius: '2px',
              background: id === club.id ? 'rgba(217,165,33,.3)' : 'rgba(255,255,255,.22)',
              border: '1px solid var(--linie)'
            }
          },
          el('span', { class: 'tv-zeile', style: { gap: '7px' } },
            wappen(c, 20), el('span', {}, c ? c.name : String(id))),
          pill(meta ? meta.name : 'Europapokal', t.competition === 'cl' ? 'info' : 'gut'));
        }))
      : leer('Noch ist niemand gemeldet. Die Startplätze vergibt die Abschlusstabelle: ' +
        'vier für die Champions League, zwei für die Europa League, einer für die Conference League. ' +
        'Der Pokalsieger fährt ebenfalls mit – und rückt nach, wenn er schon über die Liga dabei ist.')));

  return wrap;
}
