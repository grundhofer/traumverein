/**
 * screens/saison.js — Der Saisonabschluss.
 *
 * Ersetzt den früheren Drei-Absatz-Dialog aus main.js. Der Bildschirm zeigt
 * ausschließlich an, was `core/loop.js:saisonWechsel(state, ctx)` bereits
 * entschieden hat; er rechnet nichts nach und ändert nichts am Spielzustand.
 *
 * Der Bericht kommt über `ctx.params.bericht`:
 *   { season, tabellen, meister, pokalsieger, aufsteiger, absteiger, relegation,
 *     torschuetzenkoenig, elfDerSaison, eigenerPlatz, eigeneLiga, ruecktritte,
 *     neueTalente, manager, vorstandsurteil, praemien }
 *
 * Grundsatz: Fehlt ein Feld, steht dort ein Platzhalter. Ein Saisonrückblick,
 * der wegen einer fehlenden Torschützenkrone abstürzt, wäre eine Zumutung.
 */

import { POSITION_NAMES, POSITION_GROUP } from '../core/constants.js';
import { clamp, round, nfmt, formatMoney, ratingClass } from '../core/util.js';
import { myClub } from '../core/state.js';
import { LEAGUES, CUP } from '../data/leagues.js';
import { el, panel, subpanel, button, bar, table, statBox, pill } from '../render/ui.js';
import { drawCrest, crestDataURL } from '../render/kits.js';
import { portraitDataURL } from '../render/portraits.js';
import { NOTEN_TEXT } from '../club/board.js';

/* ================================================================== *
 *  Kleinkram
 * ================================================================== */

function sicher(fn, ersatz, label) {
  try {
    return fn();
  } catch (err) {
    if (label) console.warn(`[saison] ${label} fehlgeschlagen:`, err);
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
    el('span.tv-panel__extra', {
      style: { marginLeft: 'auto', fontWeight: '400', letterSpacing: '.3px', textTransform: 'none', opacity: '.9' }
    }, extra)
  ];
}

function wappenBild(club, groesse = 22) {
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

/** Großes Wappen auf Leinwand – für den Kopf des Rückblicks. */
function wappenGross(club, groesse) {
  const cv = el('canvas', {
    width: groesse * 2, height: groesse * 2,
    style: { width: groesse + 'px', height: groesse + 'px', flex: `0 0 ${groesse}px` }
  });
  if (club) sicher(() => drawCrest(cv.getContext('2d'), club, groesse, groesse, groesse * 2), null, 'drawCrest');
  return cv;
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

function spielerVon(state, ref) {
  if (!ref) return null;
  const id = typeof ref === 'string' ? ref : (ref.playerId || ref.id || null);
  if (!id) return null;
  return (state.players && state.players[id]) || null;
}

function vereinVon(state, ref) {
  if (!ref) return null;
  const id = typeof ref === 'string' ? ref : (ref.clubId || ref.id || null);
  if (!id) return null;
  return (state.clubs && state.clubs[id]) || null;
}

function spielerName(p, ersatz = 'Unbekannt') {
  if (!p) return ersatz;
  return p.shortName || p.lastName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || ersatz;
}

function istLegende(p) {
  return !!(p && p.era === 'legend');
}

function ligaName(ligaId) {
  const l = LEAGUES[ligaId];
  return l ? l.name : (ligaId || 'Liga');
}

/** Note im Sportreporter-Format: 7,84 statt 7.84. */
function noteText(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return '–';
  return round(v, 2).toFixed(2).replace('.', ',');
}

/* ================================================================== *
 *  Bericht absichern
 * ================================================================== */

/**
 * Baut aus einem (möglicherweise lückenhaften) Bericht ein Objekt, auf dessen
 * Felder man sich verlassen kann. Fehlt der Bericht ganz — etwa weil jemand den
 * Bildschirm direkt aufruft —, wird aus dem Spielstand ein Notbericht gebaut.
 */
function berichtAbsichern(state, roh) {
  const b = (roh && typeof roh === 'object') ? roh : {};
  const club = myClub(state);
  const season = Number.isFinite(b.season)
    ? b.season
    : Math.max(1, ((state.date && state.date.season) || 1) - 1);

  const tabellen = (b.tabellen && typeof b.tabellen === 'object')
    ? b.tabellen
    : (state.tables || {});

  const eigeneLiga = b.eigeneLiga || (club && club.leagueId) || 'bl1';
  let eigenerPlatz = b.eigenerPlatz || null;
  if (!eigenerPlatz && club) {
    const zeile = (tabellen[eigeneLiga] || []).find(z => z && z.clubId === club.id);
    if (zeile) eigenerPlatz = zeile.platz;
  }

  return {
    season,
    tabellen,
    meister: b.meister || null,
    pokalsieger: b.pokalsieger || null,
    aufsteiger: Array.isArray(b.aufsteiger) ? b.aufsteiger : [],
    absteiger: Array.isArray(b.absteiger) ? b.absteiger : [],
    relegation: b.relegation || null,
    torschuetzenkoenig: b.torschuetzenkoenig || null,
    elfDerSaison: Array.isArray(b.elfDerSaison) ? b.elfDerSaison : [],
    spielerDerSaison: b.spielerDerSaison || null,
    eigenerPlatz,
    eigeneLiga,
    ruecktritte: Array.isArray(b.ruecktritte) ? b.ruecktritte : [],
    neueTalente: Array.isArray(b.neueTalente) ? b.neueTalente : [],
    manager: b.manager || null,
    vorstandsurteil: b.vorstandsurteil || null,
    praemien: (b.praemien && typeof b.praemien === 'object') ? b.praemien : {},
    unvollstaendig: !roh || typeof roh !== 'object'
  };
}

/* ================================================================== *
 *  1. Kopf — wer ist Meister?
 * ================================================================== */

function kopfPanel(state, b) {
  const club = myClub(state);

  // bericht.meister ist per Definition der Erstliga-Meister (loop.js setzt ihn nur
  // für 'bl1'). Spielt der Manager in Liga zwei, interessiert ihn zuerst der Meister
  // SEINER Liga – den holen wir aus der Abschlusstabelle statt aus der Vorlage in
  // data/leagues.js, die nach dem ersten Aufstieg die Vorsaison zeigen würde.
  const eigeneTabelle = b.tabellen && b.tabellen[b.eigeneLiga];
  const eigenerMeisterId = eigeneTabelle && eigeneTabelle[0] && eigeneTabelle[0].clubId;
  const zweitliga = b.eigeneLiga === 'bl2' && !!eigenerMeisterId;

  const meister = vereinVon(state, zweitliga ? eigenerMeisterId : b.meister);
  const titel = meister
    ? (zweitliga ? `${meister.name} ist Zweitliga-Meister` : `${meister.name} ist Deutscher Meister`)
    : 'Meister: noch nicht ermittelt';

  const eigen = b.eigenerPlatz
    ? `${club ? club.name : 'Ihr Verein'} beendet die Spielzeit auf Platz ${b.eigenerPlatz} der ${ligaName(b.eigeneLiga)}.`
    : `${club ? club.name : 'Ihr Verein'} — kein Tabellenplatz überliefert. Der Chronist hat geschlafen.`;

  const kopf = el('div.tv-saison__kopf',
    wappenGross(meister || club, 104),
    el('div.tv-saison__kopfText',
      el('div.tv-saison__jahr', null, `Saison ${b.season}`),
      el('h2.tv-saison__titel', null, titel),
      el('div.tv-saison__unter', null, eigen),
      el('div.tv-zeile', { style: { gap: '6px', flexWrap: 'wrap', marginTop: '8px' } },
        b.pokalsieger ? pill(`${CUP.siegerTitel}: ${(vereinVon(state, b.pokalsieger) || {}).shortName || b.pokalsieger}`, 'gold') : null,
        b.torschuetzenkoenig && b.torschuetzenkoenig.tore
          ? pill(`Torschützenkrone: ${b.torschuetzenkoenig.tore} Treffer`, 'info') : null,
        b.ruecktritte.length ? pill(`${b.ruecktritte.length} Abschiede`, 'warn') : null,
        b.neueTalente.length ? pill(`${b.neueTalente.length} neue Talente`, 'gut') : null)));

  return panel(panelKopf('🏆 Saisonrückblick', `Abgelaufene Spielzeit ${b.season}`),
    kopf,
    b.unvollstaendig
      ? el('div.tv-mini', { style: { marginTop: '8px', color: 'var(--rot)' } },
        'Es liegt kein Saisonbericht vor – angezeigt wird der letzte bekannte Stand aus dem Spielstand.')
      : null);
}

/* ================================================================== *
 *  2. Abschlusstabelle der eigenen Liga
 * ================================================================== */

/** Zonenfärbung. Bewusst aus dem Bericht abgeleitet, nicht neu berechnet. */
function zonenKlasse(b, ligaId, platz) {
  const liga = LEAGUES[ligaId];
  const anzahl = (b.tabellen[ligaId] || []).length || (liga ? liga.clubIds.length : 18);
  if (platz === 1) return 'platz-meister';
  if (b.absteiger.length || b.aufsteiger.length) {
    const zeile = (b.tabellen[ligaId] || []).find(z => z && z.platz === platz);
    const clubId = zeile ? zeile.clubId : null;
    if (clubId && b.absteiger.includes(clubId)) return 'platz-abstieg';
    if (clubId && b.aufsteiger.includes(clubId)) return 'platz-cl';
  }
  if (!liga) return null;
  if (liga.tier === 1) {
    const cl = (liga.europeSpots && liga.europeSpots.cl) || 0;
    const eu = (liga.europeSpots && liga.europeSpots.el) || 0;
    const co = (liga.europeSpots && liga.europeSpots.conf) || 0;
    if (platz <= cl) return 'platz-cl';
    if (platz <= cl + eu) return 'platz-el';
    if (platz <= cl + eu + co) return 'platz-conf';
    if (platz > anzahl - (liga.relegation || 0)) return 'platz-abstieg';
    if (platz > anzahl - (liga.relegation || 0) - (liga.relegationPlayoff || 0)) return 'platz-relegation';
    return null;
  }
  if (platz <= (liga.promotion || 0)) return 'platz-cl';
  if (platz <= (liga.promotion || 0) + (liga.promotionPlayoff || 0)) return 'platz-relegation';
  if (platz > anzahl - (liga.relegation || 0)) return 'platz-abstieg';
  return null;
}

function tabellenPanel(state, b) {
  const club = myClub(state);
  const zeilen = (b.tabellen[b.eigeneLiga] || []).slice();

  if (!zeilen.length) {
    return panel(panelKopf('Abschlusstabelle', ligaName(b.eigeneLiga)),
      leer('Für diese Saison liegt keine Abschlusstabelle vor.'));
  }

  const t = table([
    {
      key: 'platz', label: '#', width: 34, numeric: true, sortable: false,
      render: z => el('b.tv-num', null, String(z.platz || ''))
    },
    {
      key: 'verein', label: 'Verein', sortable: false,
      render: z => {
        const c = vereinVon(state, z.clubId);
        return el('span.tv-zeile', { style: { gap: '7px', minWidth: '0' } },
          wappenBild(c, 22),
          el('span', { style: { minWidth: '0' } },
            el('div', null, c ? c.name : z.clubId),
            el('div.tv-mini', null, c ? `${c.city || ''}` : '')));
      }
    },
    { key: 'spiele', label: 'Sp', width: 34, numeric: true, sortable: false },
    { key: 's', label: 'S', width: 30, numeric: true, sortable: false },
    { key: 'u', label: 'U', width: 30, numeric: true, sortable: false },
    { key: 'n', label: 'N', width: 30, numeric: true, sortable: false },
    {
      key: 'tore', label: 'Tore', width: 62, align: 'center', sortable: false,
      render: z => el('span.tv-num', null, `${z.tore || 0}:${z.gegentore || 0}`)
    },
    {
      key: 'diff', label: 'Diff', width: 44, numeric: true, sortable: false,
      render: z => {
        const d = Number(z.diff) || ((z.tore || 0) - (z.gegentore || 0));
        return el('span.tv-num', { class: d > 0 ? 'tv-gut' : d < 0 ? 'tv-schlecht' : null },
          (d > 0 ? '+' : '') + d);
      }
    },
    {
      key: 'punkte', label: 'Pkt', width: 42, numeric: true, sortable: false,
      render: z => el('b.tv-num', { style: { fontSize: '13.5px' } }, String(z.punkte || 0))
    },
    {
      key: 'praemie', label: 'Prämie', width: 96, numeric: true, sortable: false,
      render: z => {
        const p = b.praemien[z.clubId];
        return el('span.tv-num', null, (p || p === 0) ? formatMoney(p) : '–');
      }
    }
  ], zeilen, {
    compact: true,
    emptyText: 'Keine Tabelle überliefert.',
    rowClass: z => {
      const k = [];
      const zone = sicher(() => zonenKlasse(b, b.eigeneLiga, z.platz), null, 'zonenKlasse');
      if (zone) k.push(zone);
      if (club && z.clubId === club.id) k.push('eigen');
      return k.join(' ') || null;
    }
  });
  t.classList.add('tv-liga');

  return panel(panelKopf('Abschlusstabelle', `${ligaName(b.eigeneLiga)} · Saison ${b.season}`),
    el('div', null, t, zonenLegende(b.eigeneLiga)));
}

function zonenLegende(ligaId) {
  const liga = LEAGUES[ligaId];
  const farbe = {
    'platz-meister': 'var(--gold)',
    'platz-cl': 'var(--blau)',
    'platz-el': 'var(--tuerkis)',
    'platz-conf': '#7bc043',
    'platz-relegation': 'var(--orange)',
    'platz-abstieg': 'var(--rot)'
  };
  const eintrag = (klasse, text) => el('span.tv-zeile', { style: { gap: '5px' } },
    el('span', {
      style: {
        width: '13px', height: '13px', display: 'inline-block', borderRadius: '2px',
        border: '1px solid rgba(0,0,0,.4)', background: farbe[klasse]
      }
    }),
    el('span.tv-mini', null, text));

  const teile = (liga && liga.tier === 2)
    ? [eintrag('platz-meister', 'Meister & Aufstieg'), eintrag('platz-cl', 'Direkter Aufstieg'),
      eintrag('platz-relegation', 'Relegation'), eintrag('platz-abstieg', 'Abstieg')]
    : [eintrag('platz-meister', 'Deutscher Meister'), eintrag('platz-cl', 'Champions League'),
      eintrag('platz-el', 'Europa League'), eintrag('platz-conf', 'Conference League'),
      eintrag('platz-relegation', 'Relegation'), eintrag('platz-abstieg', 'Abstieg')];

  return el('div.tv-zeile', {
    style: {
      flexWrap: 'wrap', gap: '12px', marginTop: '8px',
      paddingTop: '6px', borderTop: '1px solid var(--linie)'
    }
  }, ...teile);
}

/* ================================================================== *
 *  3. Auf- und Absteiger, Relegation
 * ================================================================== */

function wechselZeile(state, clubId, richtung) {
  const c = vereinVon(state, clubId);
  const rauf = richtung === 'auf';
  return el('div.tv-saison__wechsel', { class: rauf ? 'tv-saison__wechsel--auf' : 'tv-saison__wechsel--ab' },
    el('span.tv-saison__pfeil', null, rauf ? '▲' : '▼'),
    wappenBild(c, 22),
    el('span', { style: { minWidth: '0', flex: '1' } },
      el('b', null, c ? c.name : String(clubId)),
      el('div.tv-mini', null, c ? `${c.city || ''} · jetzt ${ligaName(c.leagueId)}` : 'Verein unbekannt')),
    pill(rauf ? 'Aufstieg' : 'Abstieg', rauf ? 'gut' : 'schlecht'));
}

function aufAbPanel(state, b) {
  const inhalt = el('div.tv-spalte');

  if (b.aufsteiger.length) {
    inhalt.appendChild(subpanel('Aufsteiger',
      el('div.tv-spalte', { style: { gap: '4px' } },
        ...b.aufsteiger.map(id => wechselZeile(state, id, 'auf')))));
  }
  if (b.absteiger.length) {
    inhalt.appendChild(subpanel('Absteiger',
      el('div.tv-spalte', { style: { gap: '4px' } },
        ...b.absteiger.map(id => wechselZeile(state, id, 'ab')))));
  }
  if (!b.aufsteiger.length && !b.absteiger.length) {
    inhalt.appendChild(leer('Kein Verein wechselt die Spielklasse. Ein ruhiger Sommer.'));
  }

  return panel(panelKopf('Auf und ab', 'Beide Ligen'), inhalt);
}

/** Ein Relegationsspiel robust auf { heim, gast, tore } herunterbrechen. */
function relegationsSpiel(spiel) {
  if (!spiel || typeof spiel !== 'object') return null;
  const score = Array.isArray(spiel.score) ? spiel.score
    : (spiel.result && Array.isArray(spiel.result.score) ? spiel.result.score : null);
  return {
    heim: spiel.homeId || spiel.heimId || spiel.heim || null,
    gast: spiel.awayId || spiel.gastId || spiel.gast || null,
    tore: score
  };
}

function relegationPanel(state, b) {
  const r = b.relegation;
  if (!r) {
    return panel(panelKopf('Relegation', 'Hin- und Rückspiel'),
      leer('Die Relegation war in dieser Saison nicht nötig – oder niemand hat mitgeschrieben.'));
  }

  const zeile = (label, spiel) => {
    const s = relegationsSpiel(spiel);
    if (!s) return el('div.tv-mini', null, `${label}: nicht überliefert`);
    const h = vereinVon(state, s.heim);
    const a = vereinVon(state, s.gast);
    return el('div.tv-saison__duell',
      el('span.tv-mini', { style: { flex: '0 0 74px' } }, label),
      el('span.tv-zeile', { style: { gap: '6px', minWidth: '0', flex: '1' } },
        wappenBild(h, 20), el('span', null, h ? h.shortName : (s.heim || '?'))),
      el('b.tv-num.tv-mittig', { style: { flex: '0 0 62px' } },
        s.tore ? `${s.tore[0]} : ${s.tore[1]}` : '– : –'),
      el('span.tv-zeile', { style: { gap: '6px', minWidth: '0', flex: '1', justifyContent: 'flex-end' } },
        el('span', null, a ? a.shortName : (s.gast || '?')), wappenBild(a, 20)));
  };

  const sieger = vereinVon(state, r.sieger);

  return panel(panelKopf('Relegation', 'Hin- und Rückspiel'),
    el('div.tv-spalte', { style: { gap: '5px' } },
      zeile('Hinspiel', r.hinspiel),
      zeile('Rückspiel', r.rueckspiel),
      el('div.tv-zeile', { style: { gap: '8px', marginTop: '4px' } },
        el('span.tv-mini', null, 'Es bleibt bzw. steigt auf:'),
        sieger ? wappenBild(sieger, 20) : null,
        el('b', null, sieger ? sieger.name : 'unentschieden – ein Skandal'))));
}

/* ================================================================== *
 *  4. Pokalsieger
 * ================================================================== */

function pokalPanel(state, b) {
  const sieger = vereinVon(state, b.pokalsieger);
  if (!sieger) {
    return panel(panelKopf(CUP.name, CUP.finalOrt),
      leer('Der Pokal ist in dieser Saison offenbar niemandem überreicht worden.'));
  }
  return panel(panelKopf(CUP.name, CUP.finalOrt),
    el('div.tv-zeile', { style: { gap: '14px', alignItems: 'center' } },
      wappenGross(sieger, 68),
      el('div', { style: { minWidth: '0' } },
        el('div.tv-mini', null, CUP.siegerTitel),
        el('div', { style: { fontFamily: 'var(--font-titel)', fontSize: '22px', letterSpacing: '1px', lineHeight: '1.1' } },
          sieger.name),
        el('div.tv-mini', { style: { marginTop: '3px' } },
          `${sieger.city || ''} · Siegprämie ${formatMoney(CUP.siegPraemie)} · Startplatz im Europapokal`))));
}

/* ================================================================== *
 *  5. Torschützenkönig
 * ================================================================== */

function torjaegerPanel(state, b) {
  const tk = b.torschuetzenkoenig;
  const p = spielerVon(state, tk);
  if (!p) {
    return panel(panelKopf('Torschützenkrone', `Saison ${b.season}`),
      leer('Kein Torschützenkönig überliefert. Vermutlich hat keiner getroffen.'));
  }
  const c = vereinVon(state, p.clubId);
  const tore = (tk && tk.tore) || (p.stats && p.stats.season && p.stats.season.tore) || 0;
  const spiele = (p.stats && p.stats.season && p.stats.season.spiele) || 0;

  return panel(panelKopf('Torschützenkrone', `Saison ${b.season}`),
    el('div.tv-saison__krone',
      portraitBild(p, 96, c),
      el('div', { style: { minWidth: '0', flex: '1' } },
        el('div.tv-zeile', { style: { gap: '6px', flexWrap: 'wrap' } },
          el('b', { style: { fontSize: '18px' } }, `${p.firstName || ''} ${p.lastName || spielerName(p)}`.trim()),
          istLegende(p) ? pill(p.eraLabel || 'Legende', 'legende') : null),
        el('div.tv-mini', { style: { marginTop: '2px' } },
          `${POSITION_NAMES[p.position] || p.position || '?'} · ${p.age || '?'} Jahre · ${c ? c.name : 'vereinslos'}`),
        el('div.tv-zeile', { style: { gap: '8px', marginTop: '8px', flexWrap: 'wrap' } },
          statBox('Tore', String(tore), { kind: 'gold', sub: 'in dieser Saison' }),
          statBox('Spiele', String(spiele), { sub: 'gewertet' }),
          statBox('Quote', spiele ? noteText(tore / spiele) : '–', { sub: 'Tore je Spiel' }))),
      el('div.tv-saison__kroneZahl', null, String(tore))));
}

/* ================================================================== *
 *  6. Elf der Saison — als Taktikbrett
 * ================================================================== */

/** Grobe Reihenhöhe je Position (0 = eigenes Tor, 100 = gegnerisches). */
const ELF_Y = {
  TW: 8,
  IV: 25, LV: 25, RV: 25,
  DM: 40,
  ZM: 53, LM: 53, RM: 53,
  OM: 66,
  LA: 79, RA: 79,
  ST: 86
};

/** Links, Mitte oder rechts – für die Anordnung innerhalb einer Reihe. */
function seiteVon(pos) {
  if (/^L/.test(pos || '')) return 0;
  if (/^R/.test(pos || '')) return 2;
  return 1;
}

/**
 * Verteilt die elf Spieler auf das Brett: gleiche Höhe = eine Reihe,
 * innerhalb der Reihe von links nach rechts gleichmäßig verteilt.
 */
function elfPositionen(eintraege) {
  const mit = eintraege.map((e, i) => {
    const pos = (e && e.pos) || 'ZM';
    return { e, pos, y: ELF_Y[pos] !== undefined ? ELF_Y[pos] : 53, seite: seiteVon(pos), i };
  });
  const reihen = new Map();
  for (const m of mit) {
    if (!reihen.has(m.y)) reihen.set(m.y, []);
    reihen.get(m.y).push(m);
  }
  const out = [];
  for (const [y, gruppe] of reihen) {
    gruppe.sort((a, b) => (a.seite - b.seite) || (a.i - b.i));
    const n = gruppe.length;
    // Je mehr Spieler in einer Reihe, desto breiter wird sie gezogen – zwei
    // Stürmer stehen nebeneinander, keine fünfzig Meter auseinander.
    const breite = clamp(n * 17, 24, 76);
    gruppe.forEach((m, k) => {
      const x = n === 1 ? 50 : clamp(50 + (k - (n - 1) / 2) * (breite / (n - 1)), 10, 90);
      out.push({ eintrag: m.e, pos: m.pos, x: round(x, 2), y });
    });
  }
  return out;
}

function elfPanel(state, b) {
  const club = myClub(state);
  if (!b.elfDerSaison.length) {
    return panel(panelKopf('Elf der Saison', ligaName(b.eigeneLiga)),
      leer('Die Journalisten konnten sich auf keine Elf einigen.'));
  }

  const brett = el('div.tv-brett.tv-saison__brett');

  // Feldzeichnung: Mittellinie, Kreis, Strafräume – dieselben Maße wie im Taktikbrett.
  const strafraumB = (40.32 / 68) * 100;
  const strafraumH = (16.5 / 92) * 100;
  const torraumB = (18.32 / 68) * 100;
  const torraumH = (5.5 / 92) * 100;
  const kreisB = (18.3 / 68) * 100;
  const kreisH = (18.3 / 92) * 100;

  brett.appendChild(el('div.tv-brett__linie', { style: { left: '0', right: '0', top: '50%', height: '2px' } }));
  brett.appendChild(el('div.tv-brett__kreis', {
    style: {
      left: (50 - kreisB / 2) + '%', top: (50 - kreisH / 2) + '%',
      width: kreisB + '%', height: kreisH + '%'
    }
  }));
  for (const unten of [true, false]) {
    const y = unten ? { bottom: '0' } : { top: '0' };
    brett.appendChild(el('div.tv-brett__raum', {
      style: Object.assign({ left: (50 - strafraumB / 2) + '%', width: strafraumB + '%', height: strafraumH + '%' }, y)
    }));
    brett.appendChild(el('div.tv-brett__raum', {
      style: Object.assign({ left: (50 - torraumB / 2) + '%', width: torraumB + '%', height: torraumH + '%' }, y)
    }));
  }

  for (const platz of elfPositionen(b.elfDerSaison)) {
    const e = platz.eintrag || {};
    const p = spielerVon(state, e);
    const c = p ? vereinVon(state, p.clubId) : null;
    const eigen = !!(club && p && p.clubId === club.id);

    const knoten = el('div.tv-slot', {
      style: { left: platz.x + '%', bottom: platz.y + '%' },
      class: [p ? null : 'leer', eigen ? 'tv-saison__slot--eigen' : null,
        istLegende(p) ? 'tv-saison__slot--legende' : null]
    });

    const trikot = el('div.tv-slot__trikot', {
      style: { background: 'rgba(0,0,0,.35)', color: '#fff', overflow: 'visible', position: 'relative' }
    });
    if (p) {
      const url = sicher(() => portraitDataURL(p, 72, c ? { club: c } : {}), '', 'portraitDataURL');
      if (url) trikot.appendChild(el('img.tv-saison__foto', { src: url, alt: spielerName(p) }));
      else trikot.appendChild(el('span', null, String(p.number === undefined || p.number === null ? '–' : p.number)));
      if (e.note) {
        trikot.appendChild(el('span.tv-saison__note', { class: ratingClass(clamp(Number(e.note) * 10, 1, 99)) },
          noteText(e.note)));
      }
      if (istLegende(p)) trikot.appendChild(el('span.tv-saison__stern', null, '★'));
    }

    knoten.appendChild(trikot);
    knoten.appendChild(el('div.tv-slot__name', null, p ? spielerName(p, '?') : 'frei'));
    knoten.appendChild(el('div.tv-slot__pos', null, platz.pos));
    brett.appendChild(knoten);
  }

  // Namensliste neben dem Brett – lesbar auch ohne Zoom.
  const liste = el('div.tv-spalte', { style: { gap: '2px' } },
    ...b.elfDerSaison.map(e => {
      const p = spielerVon(state, e);
      const c = p ? vereinVon(state, p.clubId) : null;
      const eigen = !!(club && p && p.clubId === club.id);
      return el('div.tv-zeile.tv-zeile--verteilt', {
        class: istLegende(p) ? 'zeile--legende' : null,
        style: {
          gap: '7px', fontSize: '12px', padding: '3px 4px',
          borderBottom: '1px dotted rgba(0,0,0,.16)',
          background: eigen ? 'rgba(217,165,33,.28)' : null
        }
      },
      el('span.tv-zeile', { style: { gap: '6px', minWidth: '0' } },
        el('span.tv-mini', { style: { width: '26px' } }, (e && e.pos) || '–'),
        portraitBild(p, 22, c),
        el('span', { style: { minWidth: '0' } },
          el('b', null, spielerName(p, 'unbekannt')),
          el('div.tv-mini', null, c ? c.shortName : '–'))),
      el('b.tv-num', null, noteText(e && e.note)));
    }));

  const sds = spielerVon(state, b.spielerDerSaison);

  return panel(panelKopf('Elf der Saison', ligaName(b.eigeneLiga)),
    el('div.tv-saison__elf',
      brett,
      el('div.tv-spalte',
        sds
          ? subpanel('Spieler der Saison',
            el('div.tv-zeile', { style: { gap: '10px' } },
              portraitBild(sds, 52, vereinVon(state, sds.clubId)),
              el('div', { style: { minWidth: '0' } },
                el('b', { style: { fontSize: '15px' } }, spielerName(sds)),
                el('div.tv-mini', null,
                  `${POSITION_NAMES[sds.position] || sds.position || '?'} · ` +
                  `${(vereinVon(state, sds.clubId) || {}).shortName || '–'}`))))
          : null,
        subpanel('Die Auswahl der Presse', liste))));
}

/* ================================================================== *
 *  7. Rücktritte
 * ================================================================== */

function abschiedsKarte(state, r) {
  const p = spielerVon(state, r);
  const c = p ? vereinVon(state, p.clubId) : null;
  const legende = istLegende(p);
  const name = r.name || spielerName(p, 'Ein Spieler');
  const alter = r.alter || (p && p.age) || null;

  return el('div.tv-saison__abschied', { class: legende ? 'tv-saison__abschied--legende' : null },
    portraitBild(p, 64, c),
    el('div', { style: { minWidth: '0', flex: '1' } },
      el('div.tv-zeile', { style: { gap: '6px', flexWrap: 'wrap' } },
        el('b', { style: { fontSize: '15px' } }, name),
        legende ? pill((p && p.eraLabel) || 'Vereinslegende', 'legende') : null,
        alter ? pill(`${alter} Jahre`, 'neutral') : null),
      el('div.tv-mini', { style: { marginTop: '2px' } },
        [p ? (POSITION_NAMES[p.position] || p.position) : null,
          c ? c.name : null,
          r.grund || null].filter(Boolean).join(' · ') || 'Karriereende'),
      el('div.tv-saison__nachruf', null,
        r.text || (legende
          ? 'Er hängt die Schuhe an den Nagel. Das Stadion wird beim nächsten Anpfiff eine Sekunde stiller sein.'
          : 'Karriereende. Danke für die Jahre, viel Glück im echten Leben.'))));
}

function ruecktrittePanel(state, b) {
  if (!b.ruecktritte.length && !b.neueTalente.length) {
    return panel(panelKopf('Abschiede & Nachwuchs', `Saison ${b.season}`),
      leer('Niemand hört auf, niemand fängt an. Ein Sommer ohne Bewegung.'));
  }

  const legenden = b.ruecktritte.filter(r => istLegende(spielerVon(state, r)));
  const rest = b.ruecktritte.filter(r => !istLegende(spielerVon(state, r)));

  const inhalt = el('div.tv-spalte');

  if (legenden.length) {
    inhalt.appendChild(subpanel(`Die Legenden treten ab (${legenden.length})`,
      el('div.tv-spalte', { style: { gap: '6px' } },
        ...legenden.map(r => abschiedsKarte(state, r)))));
  }
  if (rest.length) {
    inhalt.appendChild(subpanel(`Weitere Karriereenden (${rest.length})`,
      el('div.tv-spalte', { style: { gap: '6px' } },
        ...rest.map(r => abschiedsKarte(state, r)))));
  }
  if (!b.ruecktritte.length) {
    inhalt.appendChild(leer('Kein einziger Rücktritt. Die Ärzte haben ganze Arbeit geleistet.'));
  }

  if (b.neueTalente.length) {
    inhalt.appendChild(subpanel(`Nachrücker (${b.neueTalente.length})`,
      el('div.tv-saison__talente',
        ...b.neueTalente.map(ref => {
          const p = spielerVon(state, ref);
          const c = p ? vereinVon(state, p.clubId) : null;
          return el('div.tv-zeile', {
            style: {
              gap: '6px', fontSize: '11.5px', padding: '3px 5px', minWidth: '0',
              background: 'rgba(255,255,255,.3)', border: '1px solid var(--linie)', borderRadius: '2px'
            }
          },
          portraitBild(p, 26, c),
          el('span', { style: { minWidth: '0' } },
            el('b', null, spielerName(p, 'Neuzugang')),
            el('div.tv-mini', null,
              `${p ? (p.age || '?') + ' J.' : ''} ${p ? (POSITION_NAMES[p.position] || p.position || '') : ''} · ` +
              `${c ? c.shortName : '–'}`)));
        }))));
  }

  return panel(panelKopf('Abschiede & Nachwuchs', `Saison ${b.season}`), inhalt);
}

/* ================================================================== *
 *  8. Vorstandsurteil
 * ================================================================== */

function urteilPanel(state, b) {
  const u = b.vorstandsurteil;
  const club = myClub(state);
  if (!u) {
    return panel(panelKopf('Der Vorstand', club ? club.boardName || club.name : ''),
      leer('Der Vorstand hat sich zu dieser Saison nicht geäußert. Das ist selten ein gutes Zeichen.'));
  }

  const note = clamp(Math.round(Number(u.note) || 4), 1, 6);
  const entlassen = !!u.entlassen;
  const stimmung = NOTEN_TEXT[note] || 'sprachlos';

  const kasten = el('div.tv-saison__urteil', { class: entlassen ? 'tv-saison__urteil--entlassen' : null },
    el('div.tv-saison__urteilNote',
      el('b', null, String(note)),
      el('small', null, 'NOTE')),
    el('div', { style: { minWidth: '0', flex: '1' } },
      el('div.tv-zeile', { style: { gap: '8px', flexWrap: 'wrap' } },
        el('b', { style: { fontSize: '15px' } }, `Der Vorstand ist ${stimmung}.`),
        entlassen ? pill('Freistellung', 'schlecht') : pill('Vertrag läuft weiter', 'gut')),
      el('div.tv-saison__urteilText', null,
        u.text || 'Man werde die Entwicklung im Auge behalten, heißt es aus der Geschäftsstelle.')));

  const inhalt = el('div.tv-spalte', kasten);

  if (entlassen) {
    inhalt.appendChild(el('div.tv-saison__entlassung',
      el('div.tv-saison__entlassungTitel', null, 'SIE SIND ENTLASSEN'),
      el('div', null,
        'Der Aufsichtsrat hat Sie mit sofortiger Wirkung von Ihren Aufgaben entbunden. ' +
        'Der Dienstwagen bleibt bitte auf dem Vereinsgelände.')));
  }

  return panel(panelKopf('Der Vorstand', club ? (club.boardName || club.name) : ''), inhalt);
}

/* ================================================================== *
 *  9. Manager-Entwicklung
 * ================================================================== */

const SKILL_NAMEN = {
  training: 'Trainingslehre', taktik: 'Taktik', motivation: 'Motivation',
  verhandlung: 'Verhandlung', jugend: 'Nachwuchsarbeit', medien: 'Medienarbeit'
};

/** Sucht die Vorher-Werte an den Stellen, an denen sie plausiblerweise liegen. */
function skillsVorher(m) {
  if (!m) return {};
  const kandidat = m.skillsVorher || m.vorher || m.skillsAlt || (m.skills && m.skills.vorher);
  return (kandidat && typeof kandidat === 'object') ? kandidat : {};
}

function managerPanel(state, b) {
  const m = state.manager || {};
  const bm = b.manager || {};
  const jetzt = m.skills || {};
  const vorher = skillsVorher(bm);
  const level = bm.level !== undefined && bm.level !== null ? bm.level : (m.level || 1);
  const aufstieg = !!bm.aufstieg;

  const balken = el('div.tv-spalte', { style: { gap: '3px' } },
    ...Object.keys(SKILL_NAMEN).map(k => {
      const neu = clamp(Math.round(Number(jetzt[k]) || 0), 0, 100);
      const alt = vorher[k] !== undefined ? clamp(Math.round(Number(vorher[k]) || 0), 0, 100) : null;
      return bar(neu, 100, {
        label: SKILL_NAMEN[k],
        delta: alt !== null && alt !== neu ? neu - alt : null,
        tooltip: alt !== null ? `Vor der Saison: ${alt} · jetzt: ${neu}` : `Aktuell: ${neu}`
      });
    }));

  const titel = Array.isArray(m.titel) && m.titel.length
    ? el('div.tv-spalte', { style: { gap: '2px' } }, ...m.titel.slice(-8).reverse().map(t => {
      const text = typeof t === 'string' ? t : `${t.name || 'Titel'}${t.season ? ` (Saison ${t.season})` : ''}`;
      const frisch = typeof t === 'object' && t && t.season === b.season;
      return el('div', { style: { fontSize: '12px', fontWeight: frisch ? '700' : '400' } },
        '🏆 ', text, frisch ? ' ' : null, frisch ? pill('neu', 'gold') : null);
    }))
    : el('div.tv-mini', null, 'Noch kein Titel. Aber der Pokal ist ja nicht angeschraubt.');

  const bil = m.bilanz || {};

  return panel(panelKopf('🎓 Ihre Entwicklung', m.name || 'Der Trainer'),
    el('div.tv-spalte',
      el('div.tv-grid.tv-grid--3', { style: { gap: '6px' } },
        statBox('Trainerstufe', String(level), {
          sub: aufstieg ? 'aufgestiegen!' : 'unverändert',
          kind: aufstieg ? 'gold' : null
        }),
        statBox('Ruf', String(Math.round(m.reputation || 0)), { sub: m.lizenz || 'ohne Lizenz' }),
        statBox('Erfahrung', String(Math.round(m.erfahrung || 0)), { sub: 'Punkte' }),
        statBox('Spiele', String(bil.spiele || 0), {
          sub: `${bil.siege || 0}S ${bil.unentschieden || 0}U ${bil.niederlagen || 0}N`
        })),
      bm.text ? el('p', { style: { margin: '0', fontSize: '12.5px', lineHeight: '1.45' } }, bm.text) : null,
      el('div.tv-grid.tv-grid--2', { style: { gap: '8px' } },
        subpanel('Fähigkeiten', balken),
        subpanel('Titelsammlung', titel))));
}

/* ================================================================== *
 *  10. Prämien und Finanzen
 * ================================================================== */

function finanzPanel(state, b) {
  const club = myClub(state);
  const eigenePraemie = club ? b.praemien[club.id] : null;
  const f = (club && club.finances) || {};

  const beste = Object.keys(b.praemien)
    .map(id => ({ id, betrag: Number(b.praemien[id]) || 0 }))
    .sort((x, y) => y.betrag - x.betrag)
    .slice(0, 6);

  return panel(panelKopf('Saisonprämie', club ? club.name : ''),
    el('div.tv-spalte',
      el('div.tv-grid.tv-grid--3', { style: { gap: '6px' } },
        statBox('Prämie', (eigenePraemie || eigenePraemie === 0) ? formatMoney(eigenePraemie) : '–', {
          kind: 'gold', sub: `Platz ${b.eigenerPlatz || '?'} · ${ligaName(b.eigeneLiga)}`
        }),
        statBox('Kontostand', formatMoney(f.balance || 0), {
          kind: (f.balance || 0) < 0 ? 'schlecht' : 'gut', sub: 'nach Abrechnung'
        }),
        statBox('Verbindlichkeiten', formatMoney(f.debt || 0), {
          kind: (f.debt || 0) > 0 ? 'warn' : null, sub: 'offene Kredite'
        })),
      beste.length
        ? subpanel('Die dicksten Schecks',
          el('div.tv-spalte', { style: { gap: '2px' } },
            ...beste.map(x => {
              const c = vereinVon(state, x.id);
              return el('div.tv-zeile.tv-zeile--verteilt', {
                style: {
                  fontSize: '12px', padding: '3px 4px',
                  borderBottom: '1px dotted rgba(0,0,0,.16)',
                  background: club && x.id === club.id ? 'rgba(217,165,33,.28)' : null
                }
              },
              el('span.tv-zeile', { style: { gap: '6px', minWidth: '0' } },
                wappenBild(c, 18), el('span', null, c ? c.name : x.id)),
              el('b.tv-num', null, formatMoney(x.betrag)));
            })))
        : el('div.tv-mini', null, 'Für diese Saison sind keine Prämien verbucht worden.'),
      el('div.tv-mini', null,
        `Zuschauerschnitt, Sponsorenboni und Gehälter stehen wie gewohnt im Finanzbüro. ` +
        `Die Fernsehgelder der ${ligaName(b.eigeneLiga)} sind hier bereits enthalten.`)));
}

/* ================================================================== *
 *  Bildschirm
 * ================================================================== */

export const screen = {
  id: 'saison',
  title: 'Saisonabschluss',
  icon: '🏆',

  render(root, ctx) {
    const state = ctx && ctx.state;
    if (!state || !state.clubs) {
      root.appendChild(panel('Saisonabschluss', leer('Kein Spielstand geladen.')));
      return;
    }

    const b = berichtAbsichern(state, ctx.params && ctx.params.bericht);

    const seite = el('div.tv-seite.tv-saison');
    seite.appendChild(el('div.tv-seite__kopf',
      el('h1.tv-seite__titel', null, `Saison ${b.season} — Abpfiff`),
      el('div.tv-seite__unter', null,
        'Der Rasen ist gemäht, die Bilanz gezogen. Was bleibt, steht auf diesen Seiten.')));

    const bauen = (fn, titel) => {
      try {
        return fn(state, b);
      } catch (err) {
        console.error(`[saison] ${titel} fehlgeschlagen:`, err);
        return panel(titel, el('div.tv-leer', { style: { color: 'var(--rot)', fontStyle: 'normal' } },
          `Dieser Abschnitt konnte nicht gezeichnet werden: ${(err && err.message) || err}`));
      }
    };

    seite.appendChild(bauen(kopfPanel, 'Saisonrückblick'));
    seite.appendChild(bauen(tabellenPanel, 'Abschlusstabelle'));
    seite.appendChild(el('div.tv-grid.tv-grid--2',
      bauen(aufAbPanel, 'Auf und ab'),
      el('div.tv-spalte',
        bauen(relegationPanel, 'Relegation'),
        bauen(pokalPanel, 'Pokal'))));
    seite.appendChild(bauen(torjaegerPanel, 'Torschützenkrone'));
    seite.appendChild(bauen(elfPanel, 'Elf der Saison'));
    seite.appendChild(bauen(ruecktrittePanel, 'Abschiede'));
    seite.appendChild(bauen(urteilPanel, 'Der Vorstand'));
    seite.appendChild(el('div.tv-grid.tv-grid--2',
      bauen(managerPanel, 'Ihre Entwicklung'),
      bauen(finanzPanel, 'Saisonprämie')));

    const entlassen = !!(b.vorstandsurteil && b.vorstandsurteil.entlassen);
    seite.appendChild(el('div.tv-saison__abschluss',
      el('div.tv-mini', null, entlassen
        ? 'Der Schreibtisch ist geräumt. Irgendwo wartet der nächste Verein.'
        : 'Die Vorbereitung beginnt. Neue Spielpläne, neue Ausreden.'),
      button(entlassen ? 'Weiter' : 'Auf in die neue Saison',
        () => ctx.navigate('buero'),
        { kind: entlassen ? 'danger' : 'primary', size: 'gross' })));

    root.appendChild(seite);
  }
};

export default screen;
