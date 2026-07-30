/**
 * screens/kader.js — Der Kaderbildschirm.
 * ============================================================================
 *
 * Links die Kaderliste in fünf Ansichten (Übersicht, Attribute, Statistik,
 * Verträge, Entwicklung), rechts die Spielerakte mit Portrait, Attributen,
 * Zufriedenheit, Entwicklung und allen Maßnahmen des Trainers.
 *
 * Der Bildschirm RECHNET NICHTS SELBST: Stärken kommen aus engine/ratings.js,
 * Marktwerte, Gespräche, Verträge, Training und Fitness ausschließlich aus den
 * club/*-Modulen. Hier wird nur angezeigt und geklickt.
 *
 * Bewusste Entscheidungen (Konflikte zwischen ui.js-Defaults und styles/*.css):
 *  - bar() wird immer mit { showValue:false } benutzt. styles/main.css setzt
 *    .tv-bar auf feste 11px Höhe mit overflow:hidden; die Kopfzeile von ui.js
 *    würde darin abgeschnitten. Beschriftung und Zahl stehen deshalb daneben
 *    (z. B. im Raster .tv-attr: Name | Balken | Wert).
 *  - tabs() bekommt display:block, weil .tv-tabs in main.css ein Flex-Container
 *    für eine ANDERE Reiterstruktur ist; zusätzlich wird die Projektklasse
 *    "aktiv" mit ui.js' "tv-tab--aktiv" synchron gehalten.
 *  - Knopfgrößen heißen im Projekt 'klein'/'gross' (main.css, main.js), nicht
 *    'sm'/'lg' wie im JSDoc von ui.js.
 */

import {
  el, panel, button, bar, table, tabs, dialog, toast, tooltip, pill,
  statBox, clearNode
} from '../render/ui.js';

import {
  avg, sum, formatMoney, formatMoneyShort, nfmt, ratingClass
} from '../core/util.js';

import {
  ATTRIBUTE_GROUPS, ATTRIBUTE_NAMES, KEEPER_ATTRIBUTES,
  POSITIONS, POSITION_NAMES, POSITION_GROUP, POSITION_WEIGHTS, TRAITS
} from '../core/constants.js';

import { myClub, squadOf } from '../core/state.js';

import {
  playerOverall, squadDepth, formGuide, playerRole
} from '../engine/ratings.js';

import { drawPortrait, portraitDataURL } from '../render/portraits.js';
import { drawCrest, drawFlag, nationName } from '../render/kits.js';

import {
  moralText, gespraech, gespraechFuehren, kapitaenBestimmen, GESPRAECHS_THEMEN,
  hierarchie, RANG_NAMEN, offeneKonflikte
} from '../club/morale.js';
import { marktwert, marktGehalt, beraterProvision, kaderRolle, vertragVerlaengern, transferlisteSetzen, auslaufendeVertraege } from '../club/transfers.js';
import { individualtraining } from '../club/training.js';
import { fitTesten, dauerText } from '../club/medical.js';
import { mentorPaare, mentorVorschlaege, mentorSetzen, mentorLoesen, cliquen } from '../club/chemie.js';
import { nationalBericht, nationalStand } from '../club/national.js';

/* ==========================================================================
 * 1. Beschriftungen
 * ======================================================================== */

/** Kurzkürzel für die Attributtabelle. */
const ATTR_KURZ = {
  schuss: 'SCH', technik: 'TEC', passspiel: 'PAS', dribbling: 'DRI', kopfball: 'KOP',
  standards: 'STD', tempo: 'TEM', ausdauer: 'AUS', koerper: 'KÖR', sprungkraft: 'SPR',
  uebersicht: 'ÜBE', positionsspiel: 'POS', zweikampf: 'ZWK', aggressivitaet: 'AGG',
  nervenstaerke: 'NER', fuehrung: 'FÜH', reflexe: 'REF', stellungsspiel: 'STE',
  strafraumbeherrschung: 'STR', abschlag: 'ABS'
};

/** Feldspieler-Attribute in Tabellenreihenfolge. */
const FELD_ATTRS = [].concat(ATTRIBUTE_GROUPS.Technik, ATTRIBUTE_GROUPS.Physis, ATTRIBUTE_GROUPS.Mental);

/** Rollen, die kaderRolle() zurückgibt. */
const KADER_ROLLEN = {
  star: 'Star', stamm: 'Stammspieler', rotation: 'Rotation',
  ergaenzung: 'Ergänzung', ueberzaehlig: 'Überzählig'
};

/** Rollen, die ein Vertragsangebot kennt (Schlüssel aus club/transfers.js). */
const ANGEBOTS_ROLLEN = {
  stammspieler: 'Stammspieler — spielt immer',
  rotation: 'Rotation — regelmäßige Einsätze',
  talent: 'Talent — wird aufgebaut',
  ergaenzung: 'Ergänzung — Bank und Pokal'
};

/** Zufriedenheits-Dimensionen aus player.happiness. */
const HAPPY_DIMS = [
  ['spielzeit', 'Spielzeit'],
  ['gehalt', 'Gehalt'],
  ['ambition', 'Ehrgeiz & Perspektive'],
  ['trainer', 'Verhältnis zum Trainer']
];

const ANSICHTEN = [
  { id: 'uebersicht', label: 'Übersicht' },
  { id: 'attribute', label: 'Attribute' },
  { id: 'statistik', label: 'Statistik' },
  { id: 'vertraege', label: 'Verträge' },
  { id: 'entwicklung', label: 'Entwicklung' },
  { id: 'kabine', label: 'Kabine' }
];

const SORTIERUNGEN = [
  { key: 'ovr', desc: true, label: 'Stärke' },
  { key: 'nr', desc: false, label: 'Rückennummer' },
  { key: 'name', desc: false, label: 'Name' },
  { key: 'pos', desc: false, label: 'Position' },
  { key: 'alter', desc: false, label: 'Alter (jung zuerst)' },
  { key: 'pot', desc: true, label: 'Potenzial' },
  { key: 'form', desc: true, label: 'Form' },
  { key: 'moral', desc: true, label: 'Moral' },
  { key: 'fitness', desc: false, label: 'Fitness (schwächste zuerst)' },
  { key: 'wert', desc: true, label: 'Marktwert' },
  { key: 'gehalt', desc: true, label: 'Gehalt' },
  { key: 'rest', desc: false, label: 'Restlaufzeit' }
];

/* ==========================================================================
 * 2. Bildschirm-Zustand (überlebt den Wechsel auf andere Bildschirme)
 * ======================================================================== */

const zustand = {
  ansicht: 'uebersicht',
  gewaehlt: null,
  sort: { key: 'ovr', desc: true },
  filter: { position: 'alle', startelf: false, ausfaelle: false, vertrag: false, suche: '' }
};

/* ==========================================================================
 * 3. Kleine Helfer
 * ======================================================================== */

/** Führt eine optionale Modulfunktion aus; bei Fehlern gibt es den Ersatzwert. */
function sicher(fn, ersatz, was) {
  try {
    const r = fn();
    return r === undefined ? ersatz : r;
  } catch (err) {
    if (was) console.warn(`[kader] ${was} nicht verfügbar:`, err);
    return ersatz;
  }
}

/** Kleiner Fehlerkasten statt eines Absturzes. */
function fehlerBox(titel, meldung) {
  return el('div', { class: 'tv-leer', style: { color: '#8b2020', fontStyle: 'normal' } },
    el('b', {}, titel), el('div', { class: 'tv-mini', style: { marginTop: '4px' } }, String(meldung || '')));
}

function ratingFarbe(v) {
  return `var(--${ratingClass(v)})`;
}

function wertSpan(v, decimals = 0) {
  const n = Number(v) || 0;
  return el('span', { class: ratingClass(n) + '-text' }, nfmt(n, decimals));
}

function posPille(pos) {
  const p = pos || '??';
  return el('span', { class: 'tv-pos tv-pos--' + (POSITION_GROUP[p] || 'MIT'), title: POSITION_NAMES[p] || p }, p);
}

/** Flaggen werden einmal je Nation gezeichnet und danach als Bild wiederverwendet. */
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
  } catch (err) { url = ''; }
  flaggenCache.set(key, url);
  return url;
}

function flagge(code, groesse = 18) {
  const name = sicher(() => nationName(code), code, 'Nationsname');
  const url = flaggeURL(code);
  if (!url) return el('span', { class: 'tv-mini', title: name }, String(code || '–'));
  const img = el('img', {
    src: url, width: groesse, height: Math.round(groesse * 2 / 3), alt: String(code || ''),
    style: { display: 'block', border: '1px solid rgba(0,0,0,.4)' }
  });
  tooltip(img, name);
  return img;
}

function portraitBild(p, club, groesse = 28) {
  const url = sicher(() => portraitDataURL(p, groesse * 2, { club }), '', 'Portrait');
  if (!url) return el('div', { style: { width: groesse + 'px', height: groesse + 'px', background: 'rgba(0,0,0,.2)' } });
  return el('img', {
    class: 'tv-portrait', src: url, width: groesse, height: groesse,
    alt: p.shortName || p.lastName || '', style: { borderWidth: '1px' }
  });
}

/** Der große tv-ovr-Kreis. */
function ovrKreis(wert, unterschrift, farbe) {
  return el('div', {
    class: 'tv-ovr',
    style: { background: farbe || ratingFarbe(wert) }
  }, el('b', {}, String(Math.round(wert))), el('small', {}, unterschrift));
}

/** Attributzeile im Raster Name | Balken | Wert. */
function attrZeile(key, wert, wichtig, delta) {
  const name = el('span', { class: 'tv-attr__name' }, ATTRIBUTE_NAMES[key] || key);
  if (wichtig) {
    name.style.fontWeight = '700';
    name.style.color = 'var(--tinte)';
  }
  const balken = bar(wert, 99, { showValue: false });
  if (wichtig) balken.style.boxShadow = '0 0 0 1px var(--gold)';
  const zahl = el('span', { class: 'tv-num tv-rechts', style: { fontWeight: wichtig ? '700' : '400' } }, String(Math.round(wert)));
  const zeile = el('div', { class: 'tv-attr' }, name, balken, zahl);
  if (delta) {
    zeile.appendChild(el('span', {
      class: 'tv-entwicklung ' + (delta > 0 ? 'plus' : 'minus'),
      style: { gridColumn: '1 / -1', marginTop: '-2px', paddingLeft: '92px' }
    }, `${delta > 0 ? '+' : ''}${delta} in dieser Saison`));
  }
  return zeile;
}

/** Beschriftete Kennzahl für die Spielerakte. */
function fakt(label, wert, klasse) {
  return el('div', { class: 'tv-zeile tv-zeile--verteilt', style: { fontSize: '11.5px', padding: '1px 0' } },
    el('span', { style: { color: 'var(--tinte-weich)' } }, label),
    el('b', { class: 'tv-num ' + (klasse || '') }, wert));
}

function formPfeil(g) {
  if (!g) return el('span', {}, '–');
  const auf = g.stufe >= 4, ab = g.stufe <= 2;
  return el('span', { class: auf ? 'tv-gut' : ab ? 'tv-schlecht' : '' },
    (auf ? '▲ ' : ab ? '▼ ' : '▬ ') + Math.round(g.form));
}

function statusPille(p) {
  if (p.injury) {
    const rest = sicher(() => dauerText(p.injury.tageRest), (Math.ceil(p.injury.tageRest || 0) + ' Tage'), 'Ausfalldauer');
    const el0 = pill(`${p.injury.name || 'Verletzt'} · ${rest}`, 'schlecht');
    tooltip(el0, `${p.injury.name || 'Verletzung'}${p.injury.koerperteil ? ' (' + p.injury.koerperteil + ')' : ''} — noch ${rest}.`);
    return el0;
  }
  const ban = p.cards && p.cards.ban ? p.cards.ban : 0;
  if (ban > 0) return pill(`Gesperrt: ${ban} ${ban === 1 ? 'Spiel' : 'Spiele'}`, 'warn');
  const fit = p.fitness !== undefined ? p.fitness : 100;
  if (fit < 70) return pill('Angeschlagen', 'warn');
  if ((p.sharpness || 60) < 45) return pill('Ohne Rhythmus', 'warn');
  return pill('Fit', 'gut');
}

function legendenPille(p) {
  if (p.era !== 'legend') return null;
  return pill(p.eraLabel || 'Legende', 'legende');
}

function saisonNote(p) {
  const s = p.stats && p.stats.season;
  if (!s || !s.notenAnzahl) return null;
  return s.notenSumme / s.notenAnzahl;
}

function karriereNote(p) {
  const s = p.stats && p.stats.career;
  if (!s || !s.notenAnzahl) return null;
  return s.notenSumme / s.notenAnzahl;
}

function notenSpan(n) {
  if (n === null || n === undefined) return el('span', { class: 'tv-gedaempft' }, '–');
  const klasse = n >= 7.6 ? 'tv-gut' : n < 5.6 ? 'tv-schlecht' : '';
  return el('span', { class: 'tv-num ' + klasse }, nfmt(n, 2));
}

function gainsSumme(p) {
  const g = p.training && p.training.gains ? p.training.gains : {};
  let s = 0;
  for (const k in g) s += g[k];
  return s;
}

function gainsListe(p) {
  const g = p.training && p.training.gains ? p.training.gains : {};
  return Object.keys(g)
    .filter(k => g[k] !== 0)
    .sort((a, b) => Math.abs(g[b]) - Math.abs(g[a]))
    .map(k => ({ key: k, delta: g[k] }));
}

/* ==========================================================================
 * 4. Datenaufbereitung — einmal je Zeichnung
 * ======================================================================== */

function spielerDaten(state, club, spieler) {
  const saison = state.date ? state.date.season : 1;
  const lineup = club.tactics && club.tactics.lineup ? Object.values(club.tactics.lineup) : [];
  const bank = club.tactics && Array.isArray(club.tactics.bench) ? club.tactics.bench : [];
  const startelf = new Set(lineup.filter(Boolean));
  const ersatz = new Set(bank.filter(Boolean));

  const daten = new Map();
  for (const p of spieler) {
    const ovr = sicher(() => playerOverall(p), 1, 'Gesamtstärke');
    const wert = sicher(() => marktwert(state, p.id), p.value || 0, 'Marktwert');
    const rest = (p.contract ? (p.contract.until || 0) : 0) - saison;
    const st = p.stats && p.stats.season ? p.stats.season : {};
    daten.set(p.id, {
      ovr,
      pot: Math.max(ovr, p.potential || ovr),
      luft: Math.max(0, (p.potential || ovr) - ovr),
      wert,
      gehalt: p.contract ? (p.contract.salary || 0) : 0,
      rest,
      startelf: startelf.has(p.id),
      bank: ersatz.has(p.id),
      form: sicher(() => formGuide(p), null, 'Formhinweis'),
      note: saisonNote(p),
      gains: gainsSumme(p),
      rolle: sicher(() => kaderRolle(state, p.id), 'ergaenzung', 'Kaderrolle'),
      stat: st
    });
  }
  return daten;
}

/**
 * Alles, was die Kabine über den Kader weiß — genau einmal je Zeichnung.
 *
 * Hierarchie, Cliquen, Mentorenpaare, Konflikte und Berufungen sind
 * Vereinsauskünfte: sie einzeln je Spieler zu erfragen, würde denselben
 * Rundgang durch den Kader achtundzwanzigmal machen. Gerechnet wird nichts —
 * club/morale.js, club/chemie.js und club/national.js liefern fertig.
 */
function kabineDaten(state, club) {
  const rang = sicher(() => hierarchie(state, club.id) || [], [], 'Hackordnung');
  const rangKarte = new Map();
  rang.forEach((r, i) => rangKarte.set(r.playerId, Object.assign({ platz: i + 1 }, r)));

  const gruppen = sicher(() => cliquen(state, club.id) || [], [], 'Cliquen');
  const cliqueKarte = new Map();
  for (const c of gruppen) {
    for (const id of (c.playerIds || [])) {
      if (!cliqueKarte.has(id)) cliqueKarte.set(id, []);
      cliqueKarte.get(id).push(c);
    }
  }

  const paare = sicher(() => mentorPaare(state, club.id) || [], [], 'Mentorenpaare');
  const alsTalent = new Map();
  const alsMentor = new Map();
  for (const m of paare) {
    alsTalent.set(m.talentId, m);
    if (!alsMentor.has(m.mentorId)) alsMentor.set(m.mentorId, []);
    alsMentor.get(m.mentorId).push(m);
  }

  const streit = sicher(() => offeneKonflikte(state, club.id) || [], [], 'Konflikte');
  const streitKarte = new Map();
  for (const k of streit) {
    for (const id of (k.playerIds || [])) {
      if (!streitKarte.has(id)) streitKarte.set(id, []);
      streitKarte.get(id).push(k);
    }
  }

  const stand = sicher(() => nationalStand(state), null, 'Verbandslage');
  const beimVerband = new Map();
  for (const e of (stand && stand.eigene) || []) beimVerband.set(e.playerId, e);

  return {
    rang, rangKarte, gruppen, cliqueKarte,
    paare, alsTalent, alsMentor,
    streit, streitKarte, stand, beimVerband
  };
}

/** Marke mit eigener Farbe — schmaler als pill(), für Cliquen, Ränge, Verband. */
function marke(text, art, titel) {
  const m = el('span', { class: 'tv-marke' + (art ? ' tv-marke--' + art : '') }, text);
  if (titel) tooltip(m, titel);
  return m;
}

/**
 * Warum ausgerechnet dieser Mentor zu diesem Talent passt — in Klartext.
 *
 * Es wird nichts nachgerechnet: `club/chemie.js:passung()` hat die Zahl längst
 * gebildet. Hier stehen nur die Merkmale, aus denen sie entstanden ist, damit
 * der Manager nicht raten muss, was „Passung 78" bedeutet.
 */
function mentorBegruendung(mentor, talent, rangEintrag) {
  const g = [];
  if (mentor.position === talent.position) g.push(`gleiche Position (${POSITION_NAMES[mentor.position] || mentor.position})`);
  else if (POSITION_GROUP[mentor.position] && POSITION_GROUP[mentor.position] === POSITION_GROUP[talent.position]) g.push('derselbe Mannschaftsteil');
  if (mentor.nationality && mentor.nationality === talent.nationality) {
    g.push(`gleiche Nation (${sicher(() => nationName(mentor.nationality), mentor.nationality, 'Nation')})`);
  }
  if (rangEintrag && rangEintrag.rang === 'kapitaen') g.push('er trägt die Binde');
  else if (rangEintrag && rangEintrag.einfluss >= 70) g.push('er genießt in der Kabine hohes Ansehen');
  else if (rangEintrag && rangEintrag.einfluss < 35) g.push('sein Wort wiegt in der Kabine allerdings wenig');
  if (mentor.era === 'legend') g.push(`Legendenstatus${mentor.eraLabel ? ' (' + mentor.eraLabel + ')' : ''}`);
  const mp = mentor.personality && mentor.personality.id;
  if (mp === 'fuehrungstyp') g.push('ein geborener Anführer');
  else if (mp === 'profi' || mp === 'loyal') g.push('vorbildliche Einstellung');
  else if (mp === 'schwierig' || mp === 'geldgierig') g.push('sein Charakter ist allerdings kein Vorbild');
  if ((mentor.traits || []).includes('kabinenleader')) g.push('Wortführer der Kabine');
  if ((mentor.age || 26) >= 34) g.push(`${mentor.age} Jahre Erfahrung`);
  if (!g.length) g.push('schlicht der Älteste, der noch zuhört');
  return g.join(', ').replace(/^./, c => c.toUpperCase()) + '.';
}

/* ==========================================================================
 * 5. Kaderübersicht (Kopfbereich)
 * ======================================================================== */

function kopfbereich(ctx, state, club, spieler, daten) {
  const anzahl = spieler.length;
  const legenden = spieler.filter(p => p.era === 'legend').length;
  const verletzte = spieler.filter(p => p.injury).length;
  const gesperrte = spieler.filter(p => p.cards && p.cards.ban > 0).length;
  const alter = anzahl ? avg(spieler, p => p.age || 26) : 0;
  const kaderwert = sum(spieler, p => daten.get(p.id).wert);
  const gehaelter = sum(spieler, p => daten.get(p.id).gehalt);
  const budget = club.finances && club.finances.wageBudget ? club.finances.wageBudget : Math.round(gehaelter * 1.1);
  const beste = spieler.slice().sort((a, b) => daten.get(b.id).ovr - daten.get(a.id).ovr);
  const elfSchnitt = beste.length ? avg(beste.slice(0, 11), p => daten.get(p.id).ovr) : 0;
  const juengster = anzahl ? spieler.reduce((a, b) => ((a.age || 99) <= (b.age || 99) ? a : b)) : null;
  const aeltester = anzahl ? spieler.reduce((a, b) => ((a.age || 0) >= (b.age || 0) ? a : b)) : null;
  const teuerster = beste.length ? spieler.slice().sort((a, b) => daten.get(b.id).wert - daten.get(a.id).wert)[0] : null;
  const auslaufend = spieler.filter(p => daten.get(p.id).rest <= 0).length;

  const kacheln = el('div', { class: 'tv-grid tv-grid--4', style: { gap: '7px' } },
    statBox('Kadergröße', `${anzahl}`, {
      sub: `${legenden} Legenden · ${anzahl - legenden} Moderne`,
      tooltip: 'Profikader ohne die Jugendabteilung.'
    }),
    statBox('Durchschnittsalter', nfmt(alter, 1) + ' J.', {
      sub: juengster && aeltester ? `${juengster.shortName || juengster.lastName} (${juengster.age}) … ${aeltester.shortName || aeltester.lastName} (${aeltester.age})` : '–',
      kind: alter >= 30 ? 'warn' : alter <= 24 ? 'gut' : null
    }),
    statBox('Stärke der besten Elf', nfmt(elfSchnitt, 1), {
      sub: `Kaderschnitt ${nfmt(anzahl ? avg(spieler, p => daten.get(p.id).ovr) : 0, 1)}`,
      kind: elfSchnitt >= 78 ? 'gut' : elfSchnitt < 62 ? 'warn' : null
    }),
    statBox('Kaderwert', formatMoney(kaderwert), {
      sub: teuerster ? `Teuerster: ${teuerster.shortName || teuerster.lastName} (${formatMoneyShort(daten.get(teuerster.id).wert)})` : '–',
      kind: 'gold'
    }),
    statBox('Gehaltssumme (Jahr)', formatMoney(gehaelter), {
      sub: `Etat ${formatMoney(budget)}`,
      kind: gehaelter > budget ? 'schlecht' : 'gut'
    }),
    statBox('Ausfälle', `${verletzte + gesperrte}`, {
      sub: `${verletzte} verletzt · ${gesperrte} gesperrt`,
      kind: (verletzte + gesperrte) >= 4 ? 'schlecht' : (verletzte + gesperrte) > 0 ? 'warn' : 'gut',
      tooltip: 'Anklicken: die Liste zeigt nur noch Verletzte und Gesperrte.',
      onClick: () => { zustand.filter.ausfaelle = !zustand.filter.ausfaelle; ctx.refresh(); }
    }),
    statBox('Auslaufende Verträge', `${auslaufend}`, {
      sub: auslaufend ? 'Der Berater wartet auf Ihren Anruf' : 'Alles langfristig gebunden',
      kind: auslaufend >= 3 ? 'schlecht' : auslaufend ? 'warn' : 'gut',
      tooltip: 'Anklicken: nur Spieler mit auslaufendem Vertrag.',
      onClick: () => { zustand.filter.vertrag = !zustand.filter.vertrag; ctx.refresh(); }
    }),
    statBox('Konto des Vereins', formatMoney(club.finances ? club.finances.balance : 0), {
      sub: `Transferbudget ${formatMoney(club.finances ? (club.finances.transferBudget || 0) : 0)}`,
      kind: (club.finances && club.finances.balance < 0) ? 'schlecht' : null
    })
  );

  // --- Gehaltsbalken -------------------------------------------------------
  const anteil = budget > 0 ? (gehaelter / budget) * 100 : 100;
  const gehaltsBox = el('div', { class: 'tv-subpanel' },
    el('div', { class: 'tv-subpanel__titel' }, 'Gehaltsetat'),
    el('div', { class: 'tv-zeile tv-zeile--verteilt', style: { fontSize: '11.5px', marginBottom: '3px' } },
      el('span', {}, `${formatMoney(gehaelter)} von ${formatMoney(budget)}`),
      el('b', { class: 'tv-num ' + (anteil > 100 ? 'tv-schlecht' : anteil > 90 ? 'tv-warnung' : 'tv-gut') }, nfmt(anteil, 0) + ' %')),
    bar(Math.min(anteil, 100), 100, { showValue: false, color: anteil > 100 ? 'var(--rot)' : anteil > 90 ? 'var(--gold)' : 'var(--gruen-500)' }),
    el('div', { class: 'tv-mini', style: { marginTop: '4px' } },
      anteil > 100
        ? 'Sie zahlen mehr Gehalt, als der Vorstand bewilligt hat. Solche Zahlen liest man dort ungern.'
        : anteil > 90
          ? 'Der Etat ist fast ausgereizt. Für Neuzugänge müsste erst jemand gehen.'
          : 'Im Etat ist noch Luft. Der Vorstand schläft ruhig.'));

  // --- Positionsabdeckung --------------------------------------------------
  const tiefe = sicher(() => squadDepth(spieler), null, 'Kadertiefe');
  let abdeckung;
  if (!tiefe) {
    abdeckung = fehlerBox('Positionsabdeckung nicht berechenbar', 'engine/ratings.js: squadDepth() lieferte kein Ergebnis.');
  } else {
    const kacheln2 = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '5px' } });
    const luecken = [];
    for (const pos of POSITIONS) {
      const t = tiefe[pos];
      if (!t) continue;
      if (t.luecke) luecken.push(pos);
      const kachel = el('div', {
        style: {
          background: 'rgba(255,255,255,.28)',
          border: '1px solid ' + (t.luecke ? 'var(--rot)' : 'var(--linie)'),
          borderRadius: '2px', padding: '4px 5px'
        }
      },
      el('div', { class: 'tv-zeile tv-zeile--verteilt', style: { gap: '4px' } },
        posPille(pos),
        el('b', { class: 'tv-num', style: { fontSize: '12px' } }, t.anzahl ? nfmt(t.bester, 0) : '–')),
      bar(t.bester || 0, 99, { showValue: false }),
      el('div', { class: 'tv-mini', style: { marginTop: '2px' } }, `${t.anzahl} Spieler`));
      tooltip(kachel, `${POSITION_NAMES[pos]}: ${t.bewertung}. Bester ${nfmt(t.bester, 1)}, Schnitt der Top 3 ${nfmt(t.schnitt, 1)}.`);
      kacheln2.appendChild(kachel);
    }
    abdeckung = el('div', {},
      kacheln2,
      el('div', { class: 'tv-mini', style: { marginTop: '6px' } },
        luecken.length
          ? el('span', { class: 'tv-warnung' },
            `⚠ Baustellen im Kader: ${luecken.map(p => POSITION_NAMES[p] || p).join(', ')}. ` +
            'Auf diesen Positionen fehlt gelerntes Personal — der Transfermarkt hat geöffnet.')
          : 'Jede Position ist gelernt besetzt. Der Kader hat keine offensichtlichen Löcher.'));
  }

  return panel('Kaderübersicht',
    kacheln,
    el('div', { class: 'tv-grid tv-grid--seiten', style: { marginTop: '9px' } },
      gehaltsBox,
      el('div', { class: 'tv-subpanel' },
        el('div', { class: 'tv-subpanel__titel' }, 'Positionsabdeckung'),
        abdeckung)));
}

/* ==========================================================================
 * 6. Filterleiste
 * ======================================================================== */

function filterLeiste(beiAenderung, anzahlEl) {
  const f = zustand.filter;

  const posSelect = el('select', {
    title: 'Position',
    onChange: e => { f.position = e.target.value; beiAenderung(); }
  },
  el('option', { value: 'alle', selected: f.position === 'alle' }, 'Alle Positionen'),
  el('optgroup', { label: 'Mannschaftsteile' },
    el('option', { value: 'g:TW', selected: f.position === 'g:TW' }, 'Tor'),
    el('option', { value: 'g:ABW', selected: f.position === 'g:ABW' }, 'Abwehr'),
    el('option', { value: 'g:MIT', selected: f.position === 'g:MIT' }, 'Mittelfeld'),
    el('option', { value: 'g:STU', selected: f.position === 'g:STU' }, 'Sturm')),
  el('optgroup', { label: 'Einzelpositionen' },
    ...POSITIONS.map(p => el('option', { value: p, selected: f.position === p }, `${p} – ${POSITION_NAMES[p]}`))));

  const suche = el('input', {
    type: 'search', placeholder: 'Name suchen …', value: f.suche, size: 14,
    onInput: e => { f.suche = e.target.value; beiAenderung(); }
  });

  const schalter = (label, feld, titel) => {
    const box = el('input', {
      type: 'checkbox', checked: !!f[feld],
      onChange: e => { f[feld] = e.target.checked; beiAenderung(); }
    });
    const l = el('label', { class: 'tv-zeile', style: { fontSize: '11.5px', gap: '4px', cursor: 'pointer' } }, box, label);
    if (titel) tooltip(l, titel);
    return l;
  };

  const sortSelect = el('select', {
    title: 'Sortierung',
    onChange: e => {
      const s = SORTIERUNGEN.find(x => x.key === e.target.value);
      if (!s) return;
      zustand.sort = { key: s.key, desc: s.desc };
      beiAenderung(true);
    }
  }, ...SORTIERUNGEN.map(s => el('option', { value: s.key, selected: zustand.sort.key === s.key }, 'Sortieren: ' + s.label)));

  return el('div', { class: 'tv-filter' },
    posSelect,
    suche,
    schalter('Nur Startelf', 'startelf', 'Zeigt nur die elf Spieler aus der aktuellen Aufstellung.'),
    schalter('Nur Ausfälle', 'ausfaelle', 'Verletzte und gesperrte Spieler.'),
    schalter('Verträge laufen aus', 'vertrag', 'Spieler, deren Vertrag am Saisonende endet.'),
    sortSelect,
    button('Filter zurücksetzen', () => {
      zustand.filter = { position: 'alle', startelf: false, ausfaelle: false, vertrag: false, suche: '' };
      beiAenderung(true);
    }, { kind: 'ghost', size: 'klein' }),
    anzahlEl);
}

function filtern(spieler, daten) {
  const f = zustand.filter;
  const such = f.suche.trim().toLowerCase();
  return spieler.filter(p => {
    const d = daten.get(p.id);
    if (f.position !== 'alle') {
      if (f.position.startsWith('g:')) {
        if (POSITION_GROUP[p.position] !== f.position.slice(2)) return false;
      } else if (p.position !== f.position && !(p.altPositions || []).includes(f.position)) {
        return false;
      }
    }
    if (f.startelf && !d.startelf) return false;
    if (f.ausfaelle && !p.injury && !(p.cards && p.cards.ban > 0)) return false;
    if (f.vertrag && d.rest > 0) return false;
    if (such) {
      const hay = `${p.firstName || ''} ${p.lastName || ''} ${p.shortName || ''} ${p.number || ''}`.toLowerCase();
      if (!hay.includes(such)) return false;
    }
    return true;
  });
}

/* ==========================================================================
 * 7. Spaltensätze der fünf Ansichten
 * ======================================================================== */

function grundSpalten(club, daten) {
  const D = id => daten.get(id);
  return [
    {
      key: 'nr', label: 'Nr', width: 34, numeric: true, title: 'Rückennummer',
      sort: (a, b) => (a.number || 99) - (b.number || 99),
      render: p => el('span', { class: 'tv-num' }, String(p.number || '–'))
    },
    {
      key: 'bild', label: '', width: 34, sortable: false,
      render: p => portraitBild(p, club, 28)
    },
    {
      key: 'name', label: 'Name', sort: (a, b) => String(a.lastName || '').localeCompare(String(b.lastName || ''), 'de'),
      render: p => {
        const zeile = el('div', { class: 'tv-zeile', style: { gap: '5px' } },
          el('span', { style: { fontWeight: p.era === 'legend' ? '700' : '600' } },
            `${(p.firstName || '').charAt(0)}. ${p.lastName || p.shortName || '?'}`));
        if (p.captain) {
          const k = el('span', { class: 'tv-pill tv-pill--warn' }, 'C');
          tooltip(k, 'Mannschaftskapitän');
          zeile.appendChild(k);
        }
        const leg = legendenPille(p);
        if (leg) zeile.appendChild(leg);
        if (p.transfer && p.transfer.listed) zeile.appendChild(pill('Liste', 'info'));
        if (p.transfer && p.transfer.wunschWechsel) zeile.appendChild(pill('will weg', 'schlecht'));
        if (D(p.id).startelf) {
          const s = el('span', { class: 'tv-mini', style: { color: 'var(--gruen-700)', fontWeight: '700' } }, '●');
          tooltip(s, 'Steht in der aktuellen Startelf.');
          zeile.appendChild(s);
        }
        return zeile;
      }
    },
    {
      key: 'pos', label: 'Pos', width: 78, sort: (a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position),
      render: p => {
        const box = el('div', { class: 'tv-zeile', style: { gap: '3px' } }, posPille(p.position));
        const alt = (p.altPositions || []).slice(0, 2);
        if (alt.length) {
          const s = el('span', { class: 'tv-mini' }, alt.join('/'));
          tooltip(s, 'Nebenpositionen: ' + alt.map(x => POSITION_NAMES[x] || x).join(', '));
          box.appendChild(s);
        }
        return box;
      }
    },
    {
      key: 'alter', label: 'Alt', width: 34, numeric: true, cellClass: () => 'num',
      sort: (a, b) => (a.age || 0) - (b.age || 0),
      render: p => el('span', {
        class: (p.age || 0) >= 33 ? 'tv-schlecht' : (p.age || 0) <= 21 ? 'tv-gut' : ''
      }, String(p.age || '–'))
    },
    {
      key: 'nat', label: 'Nat', width: 30, align: 'center',
      sort: (a, b) => String(a.nationality || '').localeCompare(String(b.nationality || '')),
      render: p => flagge(p.nationality, 20)
    }
  ];
}

function spaltenUebersicht(state, club, daten) {
  const D = id => daten.get(id);
  return [
    {
      key: 'ovr', label: 'GES', width: 40, numeric: true, cellClass: () => 'num',
      title: 'Gesamtstärke auf der gelernten Position',
      sort: (a, b) => D(a.id).ovr - D(b.id).ovr,
      render: p => wertSpan(D(p.id).ovr)
    },
    {
      key: 'pot', label: 'POT', width: 40, numeric: true, cellClass: () => 'num',
      title: 'Potenzial – so gut kann er noch werden',
      sort: (a, b) => D(a.id).pot - D(b.id).pot,
      render: p => {
        const d = D(p.id);
        if (d.luft <= 0) return el('span', { class: 'tv-gedaempft' }, '–');
        return el('span', { class: 'tv-num', title: `Noch ${d.luft} Punkte Luft nach oben.` },
          nfmt(d.pot, 0), el('span', { class: 'tv-gut', style: { fontSize: '10px' } }, ` +${d.luft}`));
      }
    },
    {
      key: 'form', label: 'Form', width: 60, numeric: true,
      sort: (a, b) => (a.form || 0) - (b.form || 0),
      render: p => {
        const g = D(p.id).form;
        const s = formPfeil(g);
        if (g) tooltip(s, `${g.text} (${g.delta > 0 ? '+' : ''}${g.delta} Stärkepunkte)`);
        return s;
      }
    },
    {
      key: 'moral', label: 'Moral', width: 84, numeric: true,
      sort: (a, b) => (a.morale || 0) - (b.morale || 0),
      render: p => {
        const m = p.morale !== undefined ? p.morale : 60;
        const b = bar(m, 100, { showValue: false });
        tooltip(b, sicher(() => moralText(m), 'Stimmung ' + Math.round(m), 'Moraltext') + ` (${Math.round(m)})`);
        return b;
      }
    },
    {
      key: 'fitness', label: 'Fitness', width: 84, numeric: true,
      sort: (a, b) => (a.fitness || 0) - (b.fitness || 0),
      render: p => {
        const v = p.fitness !== undefined ? p.fitness : 100;
        const b = bar(v, 100, { showValue: false });
        tooltip(b, `Fitness ${Math.round(v)} %`);
        return b;
      }
    },
    {
      key: 'praxis', label: 'Praxis', width: 84, numeric: true,
      title: 'Spielpraxis / Wettkampfrhythmus',
      sort: (a, b) => (a.sharpness || 0) - (b.sharpness || 0),
      render: p => {
        const v = p.sharpness !== undefined ? p.sharpness : 60;
        const quote = p.training && p.training.einsatzquote != null ? p.training.einsatzquote : null;
        const b = bar(v, 100, { showValue: false });
        tooltip(b, `Spielrhythmus ${Math.round(v)}` + (quote != null ? ` · Einsatzquote ${nfmt(quote * 100, 0)} %` : ''));
        return b;
      }
    },
    {
      key: 'spiele', label: 'Sp', width: 32, numeric: true, cellClass: () => 'num',
      sort: (a, b) => (D(a.id).stat.spiele || 0) - (D(b.id).stat.spiele || 0),
      render: p => String(D(p.id).stat.spiele || 0)
    },
    {
      key: 'tore', label: 'Tore', width: 36, numeric: true, cellClass: () => 'num',
      sort: (a, b) => (D(a.id).stat.tore || 0) - (D(b.id).stat.tore || 0),
      render: p => String(D(p.id).stat.tore || 0)
    },
    {
      key: 'vorlagen', label: 'Vor', width: 34, numeric: true, cellClass: () => 'num',
      sort: (a, b) => (D(a.id).stat.vorlagen || 0) - (D(b.id).stat.vorlagen || 0),
      render: p => String(D(p.id).stat.vorlagen || 0)
    },
    {
      key: 'note', label: 'Note', width: 44, numeric: true,
      sort: (a, b) => (D(a.id).note || 0) - (D(b.id).note || 0),
      render: p => notenSpan(D(p.id).note)
    },
    {
      key: 'wert', label: 'Marktwert', width: 82, numeric: true, cellClass: () => 'num',
      sort: (a, b) => D(a.id).wert - D(b.id).wert,
      render: p => formatMoneyShort(D(p.id).wert)
    },
    {
      key: 'gehalt', label: 'Gehalt', width: 76, numeric: true, cellClass: () => 'num',
      title: 'Jahresgehalt',
      sort: (a, b) => D(a.id).gehalt - D(b.id).gehalt,
      render: p => formatMoneyShort(D(p.id).gehalt)
    },
    {
      key: 'bis', label: 'bis', width: 44, numeric: true, cellClass: () => 'num',
      title: 'Vertrag läuft bis Saisonende …',
      sort: (a, b) => D(a.id).rest - D(b.id).rest,
      render: p => {
        const d = D(p.id);
        return el('span', { class: d.rest <= 0 ? 'tv-schlecht' : d.rest === 1 ? 'tv-warnung' : '' },
          String(p.contract ? p.contract.until : '–'));
      }
    },
    {
      key: 'status', label: 'Status', width: 130, sortable: false,
      render: p => statusPille(p)
    }
  ];
}

function spaltenAttribute(state, club, daten) {
  const D = id => daten.get(id);
  const attrSpalte = (key, nurTW) => ({
    key: 'a_' + key, label: ATTR_KURZ[key] || key, width: 34, numeric: true,
    title: ATTRIBUTE_NAMES[key] || key,
    sort: (a, b) => ((a.attributes || {})[key] || 0) - ((b.attributes || {})[key] || 0),
    cellClass: p => ((p.position === 'TW') === !!nurTW ? 'num' : 'num tv-gedaempft'),
    render: p => wertSpan((p.attributes || {})[key] || 0)
  });
  return [
    {
      key: 'ovr', label: 'GES', width: 40, numeric: true, cellClass: () => 'num',
      sort: (a, b) => D(a.id).ovr - D(b.id).ovr,
      render: p => wertSpan(D(p.id).ovr)
    },
    {
      key: 'rolle_auto', label: 'Spielertyp', width: 104, sortable: false,
      render: p => el('span', { class: 'tv-mini' }, rollenName(sicher(() => playerRole(p), null, 'Spielertyp')))
    },
    ...FELD_ATTRS.map(k => attrSpalte(k, false)),
    ...KEEPER_ATTRIBUTES.map(k => attrSpalte(k, true))
  ];
}

function spaltenStatistik(state, club, daten) {
  const D = id => daten.get(id);
  const zahl = (key, label, titel, breite) => ({
    key: 's_' + key, label, width: breite || 36, numeric: true, cellClass: () => 'num', title: titel,
    sort: (a, b) => (D(a.id).stat[key] || 0) - (D(b.id).stat[key] || 0),
    render: p => {
      const v = D(p.id).stat[key] || 0;
      return v ? String(v) : el('span', { class: 'tv-gedaempft' }, '0');
    }
  });
  return [
    zahl('spiele', 'Sp', 'Einsätze in dieser Saison'),
    zahl('startelf', 'Elf', 'Davon von Beginn an'),
    zahl('minuten', 'Min', 'Gespielte Minuten', 46),
    zahl('tore', 'Tore', 'Erzielte Tore'),
    zahl('vorlagen', 'Vor', 'Torvorlagen'),
    zahl('schuesse', 'Sch', 'Torschüsse'),
    {
      key: 's_quote', label: 'Quote', width: 52, numeric: true, cellClass: () => 'num',
      title: 'Tore je Einsatz',
      sort: (a, b) => torQuote(D(a.id).stat) - torQuote(D(b.id).stat),
      render: p => {
        const q = torQuote(D(p.id).stat);
        return q ? nfmt(q, 2) : el('span', { class: 'tv-gedaempft' }, '–');
      }
    },
    {
      key: 's_zk', label: 'ZK %', width: 50, numeric: true, cellClass: () => 'num',
      title: 'Gewonnene Zweikämpfe',
      sort: (a, b) => zkQuote(D(a.id).stat) - zkQuote(D(b.id).stat),
      render: p => {
        const s = D(p.id).stat;
        if (!s.zweikaempfe) return el('span', { class: 'tv-gedaempft' }, '–');
        return wertSpan(zkQuote(s) * 100, 0);
      }
    },
    zahl('paraden', 'Par', 'Paraden (Torhüter)'),
    zahl('gegentore', 'GT', 'Gegentore (Torhüter)'),
    zahl('zuNull', 'ZuNull', 'Spiele ohne Gegentor', 52),
    zahl('gelb', 'G', 'Gelbe Karten', 30),
    zahl('gelbrot', 'GR', 'Gelb-Rote Karten', 30),
    zahl('rot', 'R', 'Rote Karten', 30),
    zahl('motm', 'MdS', 'Mann des Spiels', 40),
    {
      key: 's_note', label: 'Ø-Note', width: 54, numeric: true,
      title: 'Durchschnittsnote dieser Saison (1 = grottig, 10 = Weltklasse)',
      sort: (a, b) => (D(a.id).note || 0) - (D(b.id).note || 0),
      render: p => notenSpan(D(p.id).note)
    },
    {
      key: 's_karriere', label: 'Karriere', width: 118, sortable: false,
      title: 'Spiele / Tore / Vorlagen über die gesamte Karriere',
      render: p => {
        const c = p.stats && p.stats.career ? p.stats.career : {};
        return el('span', { class: 'tv-num tv-mini' }, `${c.spiele || 0} / ${c.tore || 0} / ${c.vorlagen || 0}`);
      }
    }
  ];
}

function spaltenVertraege(state, club, daten) {
  const D = id => daten.get(id);
  const gesamtGehalt = Math.max(1, sum(Array.from(daten.values()), d => d.gehalt));
  return [
    {
      key: 'v_rolle', label: 'Rolle', width: 96,
      sort: (a, b) => String(D(a.id).rolle).localeCompare(String(D(b.id).rolle)),
      render: p => el('span', { class: 'tv-mini' }, KADER_ROLLEN[D(p.id).rolle] || D(p.id).rolle)
    },
    {
      key: 'gehalt', label: 'Gehalt/Jahr', width: 88, numeric: true, cellClass: () => 'num',
      sort: (a, b) => D(a.id).gehalt - D(b.id).gehalt,
      render: p => formatMoneyShort(D(p.id).gehalt)
    },
    {
      key: 'v_anteil', label: 'Anteil', width: 78, numeric: true,
      title: 'Anteil an der Gehaltssumme des Kaders',
      sort: (a, b) => D(a.id).gehalt - D(b.id).gehalt,
      render: p => {
        const a = (D(p.id).gehalt / gesamtGehalt) * 100;
        const b = bar(a, 25, { showValue: false, color: a > 12 ? 'var(--rot)' : 'var(--blau)' });
        tooltip(b, `${nfmt(a, 1)} % der Gehaltssumme`);
        return b;
      }
    },
    {
      key: 'bis', label: 'Vertrag bis', width: 84, numeric: true, cellClass: () => 'num',
      sort: (a, b) => D(a.id).rest - D(b.id).rest,
      render: p => el('span', { class: D(p.id).rest <= 0 ? 'tv-schlecht' : D(p.id).rest === 1 ? 'tv-warnung' : '' },
        'Saison ' + (p.contract ? p.contract.until : '?'))
    },
    {
      key: 'rest', label: 'Rest', width: 88, numeric: true,
      sort: (a, b) => D(a.id).rest - D(b.id).rest,
      render: p => {
        const r = D(p.id).rest;
        if (r <= 0) return pill('läuft aus', 'schlecht');
        if (r === 1) return pill('1 Jahr', 'warn');
        return el('span', { class: 'tv-num' }, `${r} Jahre`);
      }
    },
    {
      key: 'wert', label: 'Marktwert', width: 84, numeric: true, cellClass: () => 'num',
      sort: (a, b) => D(a.id).wert - D(b.id).wert,
      render: p => formatMoneyShort(D(p.id).wert)
    },
    {
      key: 'v_handgeld', label: 'Handgeld', width: 78, numeric: true, cellClass: () => 'num',
      sort: (a, b) => ((a.contract || {}).signOn || 0) - ((b.contract || {}).signOn || 0),
      render: p => (p.contract && p.contract.signOn)
        ? formatMoneyShort(p.contract.signOn) : el('span', { class: 'tv-gedaempft' }, '–')
    },
    {
      key: 'v_klausel', label: 'Ausstiegsklausel', width: 116, numeric: true, cellClass: () => 'num',
      sort: (a, b) => ((a.contract || {}).releaseClause || 0) - ((b.contract || {}).releaseClause || 0),
      render: p => (p.contract && p.contract.releaseClause)
        ? el('span', { class: 'tv-warnung' }, formatMoneyShort(p.contract.releaseClause))
        : el('span', { class: 'tv-gedaempft' }, 'keine')
    },
    {
      key: 'v_status', label: 'Transferstatus', width: 150, sortable: false,
      render: p => {
        const box = el('div', { class: 'tv-zeile', style: { gap: '3px' } });
        if (p.transfer && p.transfer.listed) box.appendChild(pill('Transferliste', 'info'));
        if (p.transfer && p.transfer.wunschWechsel) box.appendChild(pill('Wechselwunsch', 'schlecht'));
        if (p.transfer && p.transfer.leihe) box.appendChild(pill('verliehen', 'warn'));
        if (!box.children.length) box.appendChild(el('span', { class: 'tv-gedaempft tv-mini' }, 'unverkäuflich gemeldet'));
        return box;
      }
    }
  ];
}

function spaltenEntwicklung(state, club, daten) {
  const D = id => daten.get(id);
  return [
    {
      key: 'ovr', label: 'GES', width: 40, numeric: true, cellClass: () => 'num',
      sort: (a, b) => D(a.id).ovr - D(b.id).ovr,
      render: p => wertSpan(D(p.id).ovr)
    },
    {
      key: 'pot', label: 'POT', width: 40, numeric: true, cellClass: () => 'num',
      sort: (a, b) => D(a.id).pot - D(b.id).pot,
      render: p => wertSpan(D(p.id).pot)
    },
    {
      key: 'e_luft', label: 'Luft nach oben', width: 116, numeric: true,
      sort: (a, b) => D(a.id).luft - D(b.id).luft,
      render: p => {
        const d = D(p.id);
        if (d.luft <= 0) return el('span', { class: 'tv-gedaempft' }, 'ausgereift');
        const b = bar(d.ovr, 99, { showValue: false, potential: d.pot });
        tooltip(b, `Noch ${d.luft} Punkte bis zum Potenzial ${d.pot}.`);
        return b;
      }
    },
    {
      key: 'e_gains', label: 'Saison', width: 62, numeric: true,
      title: 'Attributpunkte, die er in dieser Saison gewonnen oder verloren hat',
      sort: (a, b) => D(a.id).gains - D(b.id).gains,
      render: p => {
        const g = D(p.id).gains;
        if (!g) return el('span', { class: 'tv-gedaempft' }, '±0');
        return el('span', { class: 'tv-entwicklung ' + (g > 0 ? 'plus' : 'minus') }, String(Math.abs(g)));
      }
    },
    {
      key: 'e_details', label: 'Veränderungen', width: 190, sortable: false,
      render: p => {
        const liste = gainsListe(p).slice(0, 3);
        if (!liste.length) return el('span', { class: 'tv-gedaempft tv-mini' }, 'noch nichts Messbares');
        return el('span', { class: 'tv-mini' }, liste.map(g =>
          `${ATTR_KURZ[g.key] || g.key} ${g.delta > 0 ? '+' : ''}${g.delta}`).join(' · '));
      }
    },
    {
      key: 'e_fokus', label: 'Individualtraining', width: 130, sortable: false,
      render: p => {
        const fokus = p.training && p.training.focus;
        if (!fokus) return el('span', { class: 'tv-gedaempft tv-mini' }, '–');
        return pill(`${ATTRIBUTE_NAMES[fokus] || fokus} (${Math.round((p.training.intensitaet != null ? p.training.intensitaet : 50))})`, 'info');
      }
    },
    {
      key: 'e_praxis', label: 'Einsatzquote', width: 92, numeric: true,
      sort: (a, b) => quoteVon(a) - quoteVon(b),
      render: p => {
        const q = quoteVon(p);
        const b = bar(q * 100, 100, { showValue: false, color: q < 0.25 ? 'var(--rot)' : null });
        tooltip(b, `${nfmt(q * 100, 0)} % der möglichen Spielminuten`);
        return b;
      }
    },
    {
      key: 'e_urteil', label: 'Einschätzung', width: 210, sortable: false,
      render: p => el('span', { class: 'tv-mini' }, entwicklungsUrteil(p, D(p.id)))
    }
  ];
}

/**
 * Die Ansicht „Kabine" — was zwischen Dusche und Massagebank passiert.
 * Sie rechnet nichts: alles steht fertig in `kab` (siehe kabineDaten()).
 */
function spaltenKabine(state, club, daten, kab) {
  const einfluss = id => {
    const r = kab.rangKarte.get(id);
    return r ? r.einfluss : 0;
  };
  return [
    {
      key: 'k_moral', label: 'Moral', width: 92, numeric: true,
      title: 'Wie zufrieden er gerade ist',
      sort: (a, b) => (a.morale || 0) - (b.morale || 0),
      render: p => {
        const w = p.morale !== undefined ? p.morale : 60;
        const balken = bar(w, 100, { showValue: false });
        balken.style.flex = '1';
        const zeile = el('div', { class: 'tv-zeile', style: { gap: '4px' } },
          balken,
          el('span', { class: 'tv-num tv-mini' }, String(Math.round(w))));
        tooltip(zeile, `Moral ${Math.round(w)} — ${sicher(() => moralText(w), '', 'Moraltext')}`);
        return zeile;
      }
    },
    {
      key: 'k_person', label: 'Charakter', width: 120,
      sort: (a, b) => String((a.personality || {}).name || '').localeCompare(String((b.personality || {}).name || ''), 'de'),
      render: p => {
        if (!p.personality) return el('span', { class: 'tv-gedaempft tv-mini' }, 'unauffällig');
        const s = el('span', { class: 'tv-mini', style: { cursor: 'help' } }, p.personality.name);
        tooltip(s, p.personality.desc || p.personality.name);
        return s;
      }
    },
    {
      key: 'k_rang', label: 'Hackordnung', width: 138,
      title: 'Rang in der Kabine und Einfluss von 0 bis 100',
      sort: (a, b) => einfluss(a.id) - einfluss(b.id),
      render: p => {
        const r = kab.rangKarte.get(p.id);
        if (!r) return el('span', { class: 'tv-gedaempft tv-mini' }, '–');
        const art = r.rang === 'kapitaen' ? 'warn' : r.rang === 'fuehrungsspieler' ? 'gut'
          : r.rang === 'aussenseiter' ? 'schlecht' : 'info';
        const zeile = el('div', { class: 'tv-zeile', style: { gap: '4px' } },
          pill(RANG_NAMEN[r.rang] || r.rang, art),
          el('span', { class: 'tv-num tv-mini' }, String(Math.round(r.einfluss))));
        tooltip(zeile, `Platz ${r.platz} von ${kab.rang.length} · Einfluss ${Math.round(r.einfluss)}` +
          ((r.gruende || []).length ? '\n' + r.gruende.join(', ') : ''));
        return zeile;
      }
    },
    {
      key: 'k_clique', label: 'Grüppchen', width: 150, sortable: false,
      render: p => {
        const liste = kab.cliqueKarte.get(p.id) || [];
        if (!liste.length) return el('span', { class: 'tv-gedaempft tv-mini' }, 'Einzelgänger');
        const box = el('div', { class: 'tv-zeile', style: { gap: '3px', flexWrap: 'wrap' } });
        for (const c of liste.slice(0, 2)) {
          box.appendChild(marke(c.label, 'clique',
            `${c.label} — ${c.mitglieder.join(', ')}\nZusammenhalt ${Math.round(c.staerke)} · Stimmung ${Math.round(c.stimmung)}`));
        }
        return box;
      }
    },
    {
      key: 'k_mentor', label: 'Mentor / Schützling', width: 168, sortable: false,
      render: p => {
        const box = el('div', { class: 'tv-zeile', style: { gap: '3px', flexWrap: 'wrap' } });
        const alsT = kab.alsTalent.get(p.id);
        if (alsT) {
          box.appendChild(marke('lernt bei ' + alsT.mentor, 'mentor',
            `${alsT.text}\nPassung ${Math.round(alsT.staerke)}${alsT.gewinn > 0 ? ` · ${Math.round(alsT.gewinn)} Punkte Zuwachs` : ''}`));
        }
        for (const m of (kab.alsMentor.get(p.id) || [])) {
          box.appendChild(marke('betreut ' + m.talent, 'mentor',
            `${m.text}\nPassung ${Math.round(m.staerke)}${m.gewinn > 0 ? ` · ${Math.round(m.gewinn)} Punkte Zuwachs` : ''}`));
        }
        if (!box.childNodes.length) return el('span', { class: 'tv-gedaempft tv-mini' }, '–');
        return box;
      }
    },
    {
      key: 'k_streit', label: 'Offene Konflikte', width: 178, sortable: false,
      render: p => {
        const liste = kab.streitKarte.get(p.id) || [];
        if (!liste.length) return el('span', { class: 'tv-gedaempft tv-mini' }, 'nichts aktenkundig');
        const box = el('div', { class: 'tv-zeile', style: { gap: '3px', flexWrap: 'wrap' } });
        for (const k of liste.slice(0, 2)) {
          box.appendChild(marke(k.titel, 'streit',
            `${k.titel} (Schwere ${k.schwere} von 3)\n${k.text || ''}`));
        }
        return box;
      }
    },
    {
      key: 'k_verband', label: 'Verband', width: 96, sortable: false,
      render: p => {
        const weg = kab.beimVerband.get(p.id);
        const a = p.national;
        const box = el('div', { class: 'tv-zeile', style: { gap: '3px', flexWrap: 'wrap' } });
        if (weg) {
          box.appendChild(marke(weg.unterwegs ? 'abgestellt' : 'nominiert', 'national',
            `${weg.nationName} — ${weg.unterwegs ? 'gerade beim Verband' : 'im Aufgebot'}`));
        }
        if (a && a.spiele) {
          const zahl = el('span', { class: 'tv-num tv-mini' }, `${a.spiele}/${a.tore || 0}`);
          tooltip(zahl, `${a.spiele} ${a.spiele === 1 ? 'Länderspiel' : 'Länderspiele'}, ${a.tore || 0} Tore`);
          box.appendChild(zahl);
        }
        if (!box.childNodes.length) return el('span', { class: 'tv-gedaempft tv-mini' }, '–');
        return box;
      }
    }
  ];
}

function quoteVon(p) {
  return p.training && p.training.einsatzquote != null ? p.training.einsatzquote : 0;
}

function torQuote(stat) {
  return stat && stat.spiele ? (stat.tore || 0) / stat.spiele : 0;
}

function zkQuote(stat) {
  return stat && stat.zweikaempfe ? (stat.zweikaempfeGewonnen || 0) / stat.zweikaempfe : 0;
}

function rollenName(key) {
  if (!key) return '–';
  return String(key).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

function entwicklungsUrteil(p, d) {
  const alter = p.age || 26;
  const quote = quoteVon(p);
  if (d.luft >= 12 && alter <= 22 && quote < 0.25) return 'Großes Talent ohne Spielpraxis — so verpufft es.';
  if (d.luft >= 12 && alter <= 23) return 'Entwickelt sich. Jede Minute auf dem Platz zahlt sich aus.';
  if (d.luft >= 6 && alter <= 26) return 'Da ist noch Luft nach oben, wenn er dranbleibt.';
  if (alter >= 33) return 'Der Zenit ist überschritten. Routine muss jetzt reichen.';
  if (alter >= 30 && d.gains < 0) return 'Baut ab. Das Alter fordert seinen Tribut.';
  if (d.luft <= 1) return 'Fertig ausgebildet. Mehr wird da nicht mehr.';
  return 'Solide Entwicklung, keine Überraschungen.';
}

function spaltenFuer(ansicht, state, club, daten, kab) {
  const grund = grundSpalten(club, daten);
  switch (ansicht) {
    case 'attribute': return grund.concat(spaltenAttribute(state, club, daten));
    case 'statistik': return grund.concat(spaltenStatistik(state, club, daten));
    case 'vertraege': return grund.concat(spaltenVertraege(state, club, daten));
    case 'entwicklung': return grund.concat(spaltenEntwicklung(state, club, daten));
    case 'kabine': return grund.concat(spaltenKabine(state, club, daten, kab));
    default: return grund.concat(spaltenUebersicht(state, club, daten));
  }
}

/* ==========================================================================
 * 8. Spielerakte
 * ======================================================================== */

function akteKopf(p, club, d) {
  const cv = el('canvas', {
    class: 'tv-portrait tv-portrait--gross', width: 240, height: 240,
    style: { width: '120px', height: '120px', flex: '0 0 120px' }
  });
  sicher(() => drawPortrait(cv.getContext('2d'), p, 120, 120, 240, { club }), null, 'Portrait');

  const namensZeile = el('div', { class: 'tv-spielerkarte__name' },
    `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.shortName || 'Unbekannt');

  const marken = el('div', { class: 'tv-zeile', style: { gap: '4px', flexWrap: 'wrap', margin: '3px 0' } });
  const leg = legendenPille(p);
  if (leg) marken.appendChild(leg);
  if (p.captain) marken.appendChild(pill('Kapitän', 'warn'));
  marken.appendChild(posPille(p.position));
  for (const alt of (p.altPositions || [])) marken.appendChild(posPille(alt));

  const meta = el('div', { class: 'tv-spielerkarte__meta' },
    el('div', { class: 'tv-zeile', style: { gap: '5px' } },
      flagge(p.nationality, 20),
      el('span', {}, sicher(() => nationName(p.nationality), p.nationality, 'Nation')),
      el('span', {}, '·'),
      el('span', {}, `${p.age || '?'} Jahre`)),
    el('div', {}, `${POSITION_NAMES[p.position] || p.position} · ${p.foot || 'rechts'}er Fuß · ` +
      `${p.appearance && p.appearance.height ? p.appearance.height + ' cm' : 'Größe unbekannt'} · Nr. ${p.number || '–'}`),
    el('div', {}, p.personality ? `${p.personality.name}: ${p.personality.desc}` : 'Charakter unauffällig.'));

  const potKreis = d.pot > d.ovr
    ? ovrKreis(d.pot, 'POT', 'linear-gradient(180deg, var(--blau-hell), var(--blau))')
    : null;
  if (potKreis) tooltip(potKreis, `Potenzial ${d.pot} — noch ${d.luft} Punkte Luft nach oben.`);
  const staerkeKreis = ovrKreis(d.ovr, 'STÄRKE');
  tooltip(staerkeKreis, `Gesamtstärke ${d.ovr} auf seiner gelernten Position.`);

  const kreise = el('div', {
    class: 'tv-zeile',
    style: { gap: '6px', marginTop: '6px', justifyContent: potKreis ? 'space-between' : 'center' }
  }, staerkeKreis, potKreis);

  return el('div', { class: 'tv-spielerkarte__kopf' },
    el('div', { style: { flex: '0 0 120px' } }, cv, kreise),
    el('div', { style: { minWidth: '0', flex: '1' } }, namensZeile, marken, meta));
}

function akteTraits(p) {
  const traits = p.traits || [];
  const box = el('div', { class: 'tv-zeile', style: { gap: '4px', flexWrap: 'wrap' } });
  if (!traits.length) {
    box.appendChild(el('span', { class: 'tv-mini tv-gedaempft' }, 'Keine besonderen Eigenschaften — ein Arbeiter.'));
    return box;
  }
  for (const t of traits) {
    const def = TRAITS[t];
    const marke = el('span', { class: 'tv-pill tv-pill--info', style: { cursor: 'help' } },
      (def && def.icon ? def.icon + ' ' : '') + (def ? def.name : t));
    tooltip(marke, def ? def.desc : `Eigenschaft „${t}" — im Regelwerk nicht beschrieben.`);
    box.appendChild(marke);
  }
  return box;
}

function akteZustand(p, d) {
  const g = d.form;
  const moral = p.morale !== undefined ? p.morale : 60;
  const zeile = (label, wert, max, text, farbe) => el('div', { style: { marginBottom: '5px' } },
    el('div', { class: 'tv-zeile tv-zeile--verteilt', style: { fontSize: '11.5px' } },
      el('span', { style: { color: 'var(--tinte-weich)' } }, label),
      el('b', { class: 'tv-num' }, String(Math.round(wert)))),
    bar(wert, max, { showValue: false, color: farbe || null }),
    text ? el('div', { class: 'tv-mini' }, text) : null);

  return el('div', {},
    zeile('Form', g ? g.form : 50, 100, g ? `${g.text} (${g.delta > 0 ? '+' : ''}${g.delta} Stärkepunkte)` : ''),
    zeile('Moral', moral, 100, sicher(() => moralText(moral), '', 'Moraltext')),
    zeile('Fitness', p.fitness !== undefined ? p.fitness : 100, 100,
      (p.fitness || 100) >= 92 ? 'Frisch und bereit.' : (p.fitness || 100) >= 75 ? 'Leichte Müdigkeit in den Beinen.' : 'Deutlich überspielt — Regeneration wäre klug.'),
    zeile('Spielpraxis', p.sharpness !== undefined ? p.sharpness : 60, 100,
      (p.sharpness || 60) >= 80 ? 'Im vollen Wettkampfrhythmus.' : (p.sharpness || 60) >= 55 ? 'Braucht noch ein, zwei Spiele.' : 'Ihm fehlt der Rhythmus — im Training top, im Spiel eine Bremse.'),
    el('div', { style: { marginTop: '4px' } }, statusPille(p)));
}

function akteAttribute(p) {
  const relevant = POSITION_WEIGHTS[p.position] || {};
  const gains = p.training && p.training.gains ? p.training.gains : {};
  const istTW = p.position === 'TW';
  const box = el('div', {});

  for (const gruppe of Object.keys(ATTRIBUTE_GROUPS)) {
    const keys = ATTRIBUTE_GROUPS[gruppe];
    const inhalt = el('div', {});
    for (const k of keys) {
      inhalt.appendChild(attrZeile(k, (p.attributes || {})[k] || 0, !!relevant[k], gains[k] || 0));
    }
    if (gruppe === 'Torwart' && !istTW) {
      box.appendChild(el('details', { style: { marginTop: '4px' } },
        el('summary', { class: 'tv-mini', style: { cursor: 'pointer' } }, 'Torwartattribute (für Feldspieler bedeutungslos)'),
        inhalt));
    } else {
      const kopf = el('div', { class: 'tv-subpanel__titel', style: { display: 'flex', justifyContent: 'space-between' } },
        el('span', {}, gruppe),
        el('span', { class: 'tv-num' }, nfmt(avg(keys, k => (p.attributes || {})[k] || 0), 0)));
      box.appendChild(el('div', { class: 'tv-subpanel', style: { marginTop: '5px' } }, kopf, inhalt));
    }
  }
  box.appendChild(el('div', { class: 'tv-mini', style: { marginTop: '4px' } },
    'Gold umrandet: Attribute, auf die es auf seiner Position wirklich ankommt.'));
  return box;
}

function akteVertrag(state, p, d, club) {
  const provision = sicher(() => beraterProvision(state, p.id, 0), 0, 'Beraterprovision');
  const markt = sicher(() => marktGehalt(state, p.id, club.id), 0, 'Marktgehalt');
  const box = el('div', {});
  box.appendChild(fakt('Jahresgehalt', formatMoney(d.gehalt)));
  box.appendChild(fakt('Marktübliches Gehalt', formatMoney(markt), markt > d.gehalt * 1.15 ? 'tv-warnung' : ''));
  box.appendChild(fakt('Vertrag bis', 'Saison ' + (p.contract ? p.contract.until : '?'),
    d.rest <= 0 ? 'tv-schlecht' : d.rest === 1 ? 'tv-warnung' : ''));
  box.appendChild(fakt('Restlaufzeit', d.rest <= 0 ? 'läuft am Saisonende aus' : `${d.rest} ${d.rest === 1 ? 'Jahr' : 'Jahre'}`));
  box.appendChild(fakt('Handgeld', p.contract && p.contract.signOn ? formatMoney(p.contract.signOn) : '–'));
  box.appendChild(fakt('Ausstiegsklausel', p.contract && p.contract.releaseClause ? formatMoney(p.contract.releaseClause) : 'keine'));
  box.appendChild(fakt('Marktwert', formatMoney(d.wert)));
  box.appendChild(fakt('Rolle im Kader', KADER_ROLLEN[d.rolle] || d.rolle));
  box.appendChild(fakt('Provision seines Beraters', formatMoney(provision)));
  if (p.transfer && p.transfer.listed) {
    box.appendChild(el('div', { class: 'tv-mini tv-warnung', style: { marginTop: '4px' } },
      'Steht auf der Transferliste. Andere Vereine dürfen sich melden.'));
  }
  if (p.transfer && p.transfer.wunschWechsel) {
    box.appendChild(el('div', { class: 'tv-mini tv-schlecht', style: { marginTop: '4px' } },
      'Hat einen Wechselwunsch hinterlegt. Ein Gespräch könnte helfen — oder alles schlimmer machen.'));
  }
  return box;
}

function akteStatistik(p) {
  const s = p.stats && p.stats.season ? p.stats.season : {};
  const c = p.stats && p.stats.career ? p.stats.career : {};
  const istTW = p.position === 'TW';

  const zeilen = [
    ['Spiele (davon Startelf)', `${s.spiele || 0} (${s.startelf || 0})`, `${c.spiele || 0} (${c.startelf || 0})`],
    ['Minuten', nfmt(s.minuten || 0), nfmt(c.minuten || 0)],
    ['Tore', String(s.tore || 0), String(c.tore || 0)],
    ['Vorlagen', String(s.vorlagen || 0), String(c.vorlagen || 0)],
    ['Karten (G/GR/R)', `${s.gelb || 0}/${s.gelbrot || 0}/${s.rot || 0}`, `${c.gelb || 0}/${c.gelbrot || 0}/${c.rot || 0}`],
    ['Mann des Spiels', String(s.motm || 0), String(c.motm || 0)]
  ];
  if (istTW) {
    zeilen.push(['Paraden', String(s.paraden || 0), String(c.paraden || 0)]);
    zeilen.push(['Gegentore', String(s.gegentore || 0), String(c.gegentore || 0)]);
    zeilen.push(['Weiße Weste', String(s.zuNull || 0), String(c.zuNull || 0)]);
  }

  const t = el('table', { class: 'tv-tabelle tv-tabelle--kompakt', style: { width: '100%' } },
    el('thead', {}, el('tr', {},
      el('th', {}, ''), el('th', { class: 'mitte' }, 'Saison'), el('th', { class: 'mitte' }, 'Karriere'))),
    el('tbody', {}, ...zeilen.map(([label, a, b]) => el('tr', {},
      el('td', {}, label),
      el('td', { class: 'num mitte' }, a),
      el('td', { class: 'num mitte' }, b)))));

  const noteS = saisonNote(p), noteC = karriereNote(p);
  return el('div', {},
    t,
    el('div', { class: 'tv-zeile tv-zeile--verteilt', style: { marginTop: '5px' } },
      el('span', { class: 'tv-mini' }, 'Durchschnittsnote'),
      el('span', { class: 'tv-zeile', style: { gap: '8px' } },
        el('span', { class: 'tv-mini' }, 'Saison'), notenSpan(noteS),
        el('span', { class: 'tv-mini' }, 'Karriere'), notenSpan(noteC))));
}

function akteZufriedenheit(state, p) {
  const h = p.happiness;
  if (!h) {
    return fehlerBox('Keine Zufriedenheitsdaten', 'player.happiness fehlt — core/state.js legt das Feld normalerweise beim Spielstart an.');
  }
  const box = el('div', {});
  for (const [key, label] of HAPPY_DIMS) {
    const v = h[key] !== undefined ? h[key] : 60;
    box.appendChild(el('div', { class: 'tv-attr', style: { gridTemplateColumns: '108px 1fr 26px' } },
      el('span', { class: 'tv-attr__name' }, label),
      bar(v, 100, { showValue: false }),
      el('span', { class: 'tv-num tv-rechts' }, String(Math.round(v)))));
    box.appendChild(el('div', { class: 'tv-mini', style: { margin: '-1px 0 4px' } }, zufriedenheitsText(key, v)));
  }

  const beschwerden = Array.isArray(h.beschwerden) ? h.beschwerden.slice().reverse() : [];
  box.appendChild(el('div', { class: 'tv-subpanel__titel', style: { marginTop: '6px' } }, 'Beschwerden'));
  if (!beschwerden.length) {
    box.appendChild(el('div', { class: 'tv-mini' }, 'Nichts aktenkundig. Er macht seine Arbeit und hält den Mund.'));
  } else {
    for (const b of beschwerden.slice(0, 6)) {
      box.appendChild(el('div', { class: 'tv-zettel', style: { transform: 'none', margin: '0 0 4px', fontSize: '11px' } },
        el('b', {}, `Saison ${b.saison || '?'}, Tag ${b.tag !== undefined ? b.tag : '?'}`),
        b.text || 'Er hat sich beschwert, aber niemand hat mitgeschrieben.'));
    }
  }
  return box;
}

function zufriedenheitsText(key, v) {
  const hoch = v >= 75, mittel = v >= 50, tief = v < 30;
  switch (key) {
    case 'spielzeit':
      return hoch ? 'Er spielt so viel, wie er es erwartet.'
        : mittel ? 'Mit seiner Einsatzzeit kann er gerade so leben.'
          : tief ? 'Er sitzt zu oft draußen und macht daraus kein Geheimnis.' : 'Er hätte gern mehr Spielzeit.';
    case 'gehalt':
      return hoch ? 'Mit seinem Gehalt ist er rundum zufrieden.'
        : mittel ? 'Das Gehalt geht in Ordnung — Luft nach oben sieht er trotzdem.'
          : tief ? 'Er fühlt sich massiv unterbezahlt. Der Berater telefoniert bereits.' : 'Er findet, er verdiene mehr.';
    case 'ambition':
      return hoch ? 'Die sportliche Perspektive des Vereins begeistert ihn.'
        : mittel ? 'Er wartet ab, wohin die Reise mit diesem Verein geht.'
          : tief ? 'Er glaubt nicht mehr an die Ziele dieses Vereins.' : 'Er hätte gern größere Ziele.';
    default:
      return hoch ? 'Er würde für Sie durchs Feuer gehen.'
        : mittel ? 'Das Verhältnis zum Trainer ist sachlich.'
          : tief ? 'Zwischen Ihnen und ihm ist das Tischtuch zerschnitten.' : 'Er ist nicht überzeugt von Ihrer Arbeit.';
  }
}

function akteEntwicklung(p, d) {
  const box = el('div', {});
  box.appendChild(fakt('Aktuelle Stärke', String(d.ovr)));
  box.appendChild(fakt('Potenzial', String(d.pot), d.luft > 0 ? 'tv-gut' : ''));
  box.appendChild(fakt('Luft nach oben', d.luft > 0 ? `+${d.luft} Punkte` : 'ausgereift'));
  box.appendChild(fakt('Einsatzquote', nfmt(quoteVon(p) * 100, 0) + ' %'));

  const fokus = p.training && p.training.focus;
  box.appendChild(fakt('Individualtraining',
    fokus ? `${ATTRIBUTE_NAMES[fokus] || fokus} (Intensität ${Math.round(p.training.intensitaet != null ? p.training.intensitaet : 50)})` : 'keines'));

  box.appendChild(el('div', { class: 'tv-subpanel__titel', style: { marginTop: '6px' } }, 'Veränderungen dieser Saison'));
  const liste = gainsListe(p);
  if (!liste.length) {
    box.appendChild(el('div', { class: 'tv-mini' }, 'Noch keine messbare Veränderung. Training braucht Wochen, keine Tage.'));
  } else {
    for (const g of liste.slice(0, 12)) {
      box.appendChild(el('div', {
        class: 'tv-zeile tv-zeile--verteilt',
        style: { fontSize: '11.5px', borderBottom: '1px dotted rgba(0,0,0,.16)', padding: '1px 0' }
      },
      el('span', {}, ATTRIBUTE_NAMES[g.key] || g.key),
      el('span', { class: 'tv-entwicklung ' + (g.delta > 0 ? 'plus' : 'minus') }, String(Math.abs(g.delta)))));
    }
  }
  box.appendChild(el('div', { class: 'tv-mini', style: { marginTop: '6px' } }, entwicklungsUrteil(p, d)));
  return box;
}

/* --------------------------------------------------------------------------
 * Die Kabine in der Spielerakte
 * ------------------------------------------------------------------------ */

/** Eine Mentorenpaarung als Kasten: zwei Gesichter, ein Pfeil, der Fortschritt. */
function mentorKasten(ctx, club, paar) {
  const state = ctx.state;
  const m = state.players[paar.mentorId];
  const t = state.players[paar.talentId];
  const seite = (q, rolle) => el('div', { class: 'tv-mentor__seite' },
    q ? portraitBild(q, club, 30) : null,
    el('div', { style: { minWidth: '0' } },
      el('div', { class: 'tv-mentor__rolle' }, rolle),
      el('div', { class: 'tv-mentor__name' }, q ? spielerName(q) : '—')));

  const kopf = el('div', { class: 'tv-mentor' },
    seite(m, 'Mentor'),
    el('span', { class: 'tv-mentor__pfeil' }, '→'),
    seite(t, 'Schützling'),
    el('div', { class: 'tv-mentor__zahlen' },
      el('div', { class: 'tv-num', style: { fontWeight: '700', fontSize: '13px' } }, String(Math.round(paar.staerke))),
      el('div', { class: 'tv-mini' }, 'Passung')));

  const zeilen = el('div', {});
  const gewinn = Math.round(paar.gewinn || 0);
  zeilen.appendChild(el('div', { class: 'tv-mentor__text' },
    gewinn > 0
      ? `${paar.talent} hat unter ${paar.mentor} ${gewinn} ${gewinn === 1 ? 'Potenzialpunkt' : 'Potenzialpunkte'} ausgeschöpft.`
      : `Unter ${paar.mentor} ist ${paar.talent} bisher keinen Punkt gewachsen. Erziehung dauert Monate, nicht Wochen.`));
  if (paar.abfaerbung > 0) {
    zeilen.appendChild(el('div', { class: 'tv-mini' },
      `Die Art des Alten färbt ab (${nfmt(paar.abfaerbung, 2)}). Irgendwann steht der Junge genauso in der Kabine.`));
  }
  if (paar.seit && paar.seit.season) {
    zeilen.appendChild(el('div', { class: 'tv-mini' }, `Zusammen seit Saison ${paar.seit.season}, Tag ${paar.seit.day}.`));
  }
  zeilen.appendChild(el('div', { class: 'tv-mini', style: { fontStyle: 'italic' } }, paar.text || ''));
  zeilen.appendChild(button('Diese Mentorschaft beenden', () => {
    const erg = sicher(() => mentorLoesen(state, paar.talentId, null), null, 'Mentorschaft lösen');
    melde(erg, 'warn');
    ctx.aktualisiere();
    ctx.refresh();
  }, { kind: 'ghost', size: 'klein' }));

  return el('div', {}, kopf, zeilen);
}

function akteKabine(ctx, p, club, kab) {
  const box = el('div', {});

  /* --- Hackordnung ------------------------------------------------------- */
  const r = kab.rangKarte.get(p.id);
  if (r) {
    const art = r.rang === 'kapitaen' ? 'warn' : r.rang === 'fuehrungsspieler' ? 'gut'
      : r.rang === 'aussenseiter' ? 'schlecht' : 'info';
    box.appendChild(el('div', { class: 'tv-zeile', style: { gap: '6px', flexWrap: 'wrap' } },
      pill(RANG_NAMEN[r.rang] || r.rang, art),
      el('span', { class: 'tv-mini' }, `Platz ${r.platz} von ${kab.rang.length} in der Hackordnung`)));
    box.appendChild(el('div', { class: 'tv-attr', style: { gridTemplateColumns: '58px 1fr 26px', marginTop: '3px' } },
      el('span', { class: 'tv-attr__name' }, 'Einfluss'),
      bar(r.einfluss, 100, { showValue: false }),
      el('span', { class: 'tv-num tv-rechts' }, String(Math.round(r.einfluss)))));
    if ((r.gruende || []).length) {
      box.appendChild(el('div', { class: 'tv-mini' }, 'Weil: ' + r.gruende.join(', ') + '.'));
    }
  } else {
    box.appendChild(el('div', { class: 'tv-mini' }, 'Für die Hackordnung liegen keine Angaben vor.'));
  }

  /* --- Cliquen ----------------------------------------------------------- */
  box.appendChild(el('div', { class: 'tv-subpanel__titel', style: { marginTop: '7px' } }, 'Grüppchen'));
  const gruppen = kab.cliqueKarte.get(p.id) || [];
  if (!gruppen.length) {
    box.appendChild(el('div', { class: 'tv-mini' },
      'Er gehört zu keiner Gruppe. Kommt allein, geht allein, redet mit allen gleich viel.'));
  } else {
    for (const c of gruppen) {
      const kasten = el('div', { class: 'tv-clique' + (c.staerke >= 60 ? ' tv-clique--heiss' : '') },
        el('div', { class: 'tv-clique__kopf' },
          el('span', { class: 'tv-clique__label' }, c.label),
          el('span', { class: 'tv-clique__zahlen' },
            `Zusammenhalt ${Math.round(c.staerke)} · Stimmung ${Math.round(c.stimmung)}`)),
        el('div', { class: 'tv-mini' }, c.mitglieder.join(', ')),
        el('div', { class: 'tv-clique__text' }, c.text || ''));
      box.appendChild(kasten);
    }
  }

  /* --- Mentor und Schützlinge -------------------------------------------- */
  box.appendChild(el('div', { class: 'tv-subpanel__titel', style: { marginTop: '7px' } }, 'Mentor & Schützlinge'));
  const alsTalent = kab.alsTalent.get(p.id);
  const alsMentor = kab.alsMentor.get(p.id) || [];
  if (alsTalent) box.appendChild(mentorKasten(ctx, club, alsTalent));
  for (const m of alsMentor) box.appendChild(mentorKasten(ctx, club, m));
  if (!alsTalent && !alsMentor.length) {
    box.appendChild(el('div', { class: 'tv-mini' },
      (p.age || 26) <= 23
        ? 'Niemand nimmt ihn unter die Fittiche. Er lernt allein — das geht auch, nur langsamer.'
        : (p.age || 26) >= 28
          ? 'Er gibt nichts weiter. Erfahrung, die in der Kabine bleibt, ist Erfahrung, die mit ihm geht.'
          : 'Zu alt zum Lernen, zu jung zum Lehren. Dazwischen gibt es nichts zu vermelden.'));
  }

  box.appendChild(el('div', { class: 'tv-zeile', style: { gap: '5px', marginTop: '6px' } },
    button('Mentor zuweisen', () => dialogMentor(ctx, p, club, kab), { kind: 'gold', size: 'klein', wide: true })));

  /* --- Offene Konflikte --------------------------------------------------- */
  const streit = kab.streitKarte.get(p.id) || [];
  box.appendChild(el('div', { class: 'tv-subpanel__titel', style: { marginTop: '7px' } },
    `Offene Konflikte (${streit.length})`));
  if (!streit.length) {
    box.appendChild(el('div', { class: 'tv-mini' }, 'Nichts anhängig. Er hält sich raus.'));
  } else {
    for (const k of streit) {
      box.appendChild(el('div', { class: 'tv-streit' },
        el('b', {}, `${k.titel} (Schwere ${k.schwere} von 3)`),
        el('span', {}, k.text || '')));
    }
    box.appendChild(el('div', { class: 'tv-mini' },
      'Gelöst werden Konflikte im Büro — hier steht nur, was anliegt.'));
  }

  return box;
}

/** Die Länderspielbilanz. Ohne eine einzige Berufung bleibt sie kurz. */
function akteNational(state, p, kab) {
  const bericht = sicher(() => nationalBericht(state, p.id), null, 'Länderspielbilanz');
  const box = el('div', {});
  if (!bericht) {
    box.appendChild(el('div', { class: 'tv-mini' }, 'Der Verband führt zu diesem Spieler nichts.'));
    return box;
  }

  const kopf = el('div', { class: 'tv-zeile', style: { gap: '6px', flexWrap: 'wrap' } },
    flagge(bericht.nation, 22),
    el('b', {}, bericht.nationName));
  const weg = kab.beimVerband.get(p.id);
  if (weg) kopf.appendChild(marke(weg.unterwegs ? 'gerade abgestellt' : 'im Aufgebot', 'national'));
  else if (bericht.berufen) kopf.appendChild(marke('im Aufgebot', 'national'));
  box.appendChild(kopf);

  box.appendChild(fakt('Länderspiele', String(bericht.spiele || 0)));
  box.appendChild(fakt('Tore', String(bericht.tore || 0)));
  box.appendChild(fakt('Debüt', bericht.debuet ? `Saison ${bericht.debuet.season}, Tag ${bericht.debuet.day}` : 'steht aus'));
  box.appendChild(fakt('Ruf des Verbands', String(Math.round(bericht.ruf || 0))));

  if ((bericht.turniere || []).length) {
    box.appendChild(el('div', { class: 'tv-subpanel__titel', style: { marginTop: '6px' } }, 'Turniere'));
    for (const t of bericht.turniere.slice(-6).reverse()) {
      box.appendChild(el('div', { class: 'tv-zeile tv-zeile--verteilt', style: { fontSize: '11.5px' } },
        el('span', {}, t.s || (t.art === 'wm' ? 'Weltmeisterschaft' : 'Europameisterschaft')),
        el('b', { class: t.platz === 'Sieger' ? 'tv-gut' : '' }, String(t.platz || '–'))));
    }
  }

  box.appendChild(el('div', { class: 'tv-mini', style: { marginTop: '5px' } }, bericht.text || ''));

  const stand = kab.stand;
  if (stand && stand.periode) {
    box.appendChild(el('div', { class: 'tv-mini' },
      stand.periode.art === 'turnier'
        ? 'Turnierzeit. Wer dabei ist, ist für Sie in dieser Zeit nicht zu haben.'
        : 'Länderspielpause. Die Abgestellten kommen müde zurück, nicht ausgeruht.'));
  } else if (stand && stand.naechste) {
    box.appendChild(el('div', { class: 'tv-mini' },
      `Nächste Länderspielpause: Tag ${stand.naechste.von} bis ${stand.naechste.bis}.`));
  }
  return box;
}

/* ==========================================================================
 * 9. Maßnahmen (Dialoge)
 * ======================================================================== */

function spielerName(p) {
  return `${(p.firstName || '').charAt(0)}. ${p.lastName || p.shortName || ''}`.trim();
}

/** Kleine Hilfsfunktion: Ergebnis eines Modulaufrufs melden. */
function melde(ergebnis, guteArt = 'gut') {
  if (!ergebnis) { toast('Die Aktion hat kein Ergebnis geliefert.', 'warn'); return false; }
  const text = ergebnis.text || 'Erledigt.';
  toast(text, ergebnis.ok === false ? 'warn' : guteArt, { ms: 6000 });
  return ergebnis.ok !== false;
}

async function dialogGespraech(ctx, p) {
  const state = ctx.state;
  const themen = Object.keys(GESPRAECHS_THEMEN || {});
  if (!themen.length) { toast('Die Kabine ist heute stumm — keine Gesprächsthemen verfügbar.', 'warn'); return; }

  const thema = await dialog(`Gespräch mit ${spielerName(p)}`, (api) => {
    const box = el('div', { class: 'tv-spalte' },
      el('p', { class: 'tv-dialog-text' }, `Worüber wollen Sie mit ${spielerName(p)} reden?`));
    for (const key of themen) {
      const t = GESPRAECHS_THEMEN[key];
      box.appendChild(button(t.name, () => api.close(key), { kind: 'ghost', wide: true }));
    }
    return box;
  }, [{ label: 'Abbrechen', value: null, kind: 'ghost' }], { size: 'sm' });
  if (!thema) return;

  const g = sicher(() => gespraech(state, p.id, thema), null, 'Gesprächsvorbereitung');
  if (!g) { toast('Das Gespräch konnte nicht vorbereitet werden.', 'schlecht'); return; }
  if (!g.ok) { toast(g.text, 'warn', { ms: 6000 }); return; }

  const option = await dialog(`${g.name} — ${g.spieler}`, (api) => {
    const box = el('div', { class: 'tv-spalte' },
      el('p', { class: 'tv-dialog-text', style: { fontStyle: 'italic' } }, g.text),
      el('div', { class: 'tv-mini' }, `Stimmung: ${g.stimmung} · Charakter: ${g.persoenlichkeit}`));
    for (const o of g.optionen) {
      const knopf = el('button', {
        class: 'tv-interview__antwort',
        onClick: () => api.close(o.id)
      },
      el('div', {}, o.text),
      el('div', { class: 'tv-mini', style: { marginTop: '3px' } },
        `Erwartete Wirkung ${o.wirkung > 0 ? '+' : ''}${o.wirkung} Moral · Risiko ${Math.round(o.risiko * 100)} %` +
          (o.hinweis ? ` · ${o.hinweis}` : '')));
      box.appendChild(knopf);
    }
    return box;
  }, [{ label: 'Doch nichts sagen', value: null, kind: 'ghost' }], { size: 'lg' });
  if (!option) return;

  const r = sicher(() => gespraechFuehren(state, p.id, thema, option), null, 'Gespräch');
  if (!r) { toast('Das Gespräch ist im Sande verlaufen.', 'schlecht'); return; }

  await dialog('Nach dem Gespräch',
    el('div', { class: 'tv-spalte' },
      el('p', { class: 'tv-dialog-text' }, r.text || ''),
      r.ok !== false
        ? el('div', { class: 'tv-mini' },
          `Moraländerung: ${r.delta > 0 ? '+' : ''}${r.delta} · neue Moral ${Math.round(r.moral || 0)}`)
        : null),
    [{ label: 'Zurück in die Kabine', value: true, kind: 'primary' }], { size: 'sm' });

  ctx.aktualisiere();
  ctx.refresh();
}

async function dialogVertrag(ctx, p, d, club) {
  const state = ctx.state;
  let vorschlag = null;
  const alle = sicher(() => auslaufendeVertraege(state, club.id, { jahre: 99 }), [], 'Vertragsübersicht');
  if (Array.isArray(alle)) vorschlag = alle.find(e => e.playerId === p.id) || null;

  const wunschGehalt = vorschlag && vorschlag.forderung ? vorschlag.forderung.gehalt
    : sicher(() => marktGehalt(state, p.id, club.id), d.gehalt, 'Marktgehalt');
  const wunschLaufzeit = vorschlag && vorschlag.forderung ? vorschlag.forderung.laufzeit : (p.age >= 33 ? 1 : p.age >= 30 ? 2 : 3);
  const provision = vorschlag && vorschlag.forderung ? vorschlag.forderung.provision
    : sicher(() => beraterProvision(state, p.id, 0), 0, 'Provision');

  const angebot = {
    gehalt: Math.round(wunschGehalt),
    laufzeit: wunschLaufzeit,
    handgeld: 0,
    rolle: d.rolle === 'star' || d.rolle === 'stamm' ? 'stammspieler' : d.rolle === 'rotation' ? 'rotation' : 'ergaenzung',
    praemien: { tor: 0, einsatz: 0, titel: 0 }
  };

  const zahlFeld = (label, wert, schritt, beiAenderung, hinweis) => {
    const input = el('input', {
      type: 'number', min: '0', step: String(schritt), value: String(wert),
      style: { width: '100%', padding: '4px 6px', border: '1px solid var(--linie)', background: 'var(--papier)' },
      onInput: e => beiAenderung(Math.max(0, Math.round(Number(e.target.value) || 0)))
    });
    return el('div', {},
      el('div', { class: 'tv-subpanel__titel' }, label),
      input,
      hinweis ? el('div', { class: 'tv-mini' }, hinweis) : null);
  };

  const antwort = await dialog(`Vertragsangebot an ${spielerName(p)}`, (api) => {
    const kopf = el('div', { class: 'tv-subpanel' },
      el('div', { class: 'tv-subpanel__titel' }, 'Aktuelle Lage'),
      fakt('Gehalt heute', formatMoney(d.gehalt)),
      fakt('Vertrag bis', 'Saison ' + (p.contract ? p.contract.until : '?')),
      fakt('Marktwert', formatMoney(d.wert)),
      fakt('Rolle im Kader', KADER_ROLLEN[d.rolle] || d.rolle),
      fakt('Forderung des Beraters', formatMoney(wunschGehalt)),
      fakt('Provision (sofort fällig)', formatMoney(provision)),
      fakt('Kontostand', formatMoney(club.finances ? club.finances.balance : 0)));

    const laufzeit = el('select', {
      style: { width: '100%', padding: '4px' },
      onChange: e => { angebot.laufzeit = Number(e.target.value); }
    }, ...[1, 2, 3, 4, 5, 6].map(j => el('option', { value: String(j), selected: j === angebot.laufzeit },
      `${j} ${j === 1 ? 'Jahr' : 'Jahre'} (bis Saison ${(state.date ? state.date.season : 1) + j})`)));

    const rolle = el('select', {
      style: { width: '100%', padding: '4px' },
      onChange: e => { angebot.rolle = e.target.value; }
    }, ...Object.keys(ANGEBOTS_ROLLEN).map(k =>
      el('option', { value: k, selected: k === angebot.rolle }, ANGEBOTS_ROLLEN[k])));

    return el('div', { class: 'tv-grid tv-grid--2' },
      kopf,
      el('div', { class: 'tv-spalte' },
        zahlFeld('Jahresgehalt (€)', angebot.gehalt, 50000, v => { angebot.gehalt = v; },
          `Der Berater ruft ${formatMoney(wunschGehalt)} auf.`),
        el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Laufzeit'), laufzeit),
        zahlFeld('Handgeld (€)', angebot.handgeld, 50000, v => { angebot.handgeld = v; },
          'Wird sofort vom Konto abgebucht.'),
        el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Versprochene Rolle'), rolle),
        el('div', { class: 'tv-grid tv-grid--3' },
          zahlFeld('Torprämie', 0, 5000, v => { angebot.praemien.tor = v; }),
          zahlFeld('Einsatzprämie', 0, 5000, v => { angebot.praemien.einsatz = v; }),
          zahlFeld('Titelprämie', 0, 25000, v => { angebot.praemien.titel = v; }))));
  }, [
    { label: 'Abbrechen', value: null, kind: 'ghost' },
    { label: 'Angebot vorlegen', value: 'ok', kind: 'primary' }
  ], { size: 'lg' });

  if (antwort !== 'ok') return;

  const r = sicher(() => vertragVerlaengern(state, p.id, angebot), null, 'Vertragsverlängerung');
  if (!r) { toast('Die Verhandlung ist geplatzt, bevor sie begann.', 'schlecht'); return; }

  const gut = r.status === 'angenommen';
  await dialog(gut ? 'Unterschrieben!' : 'Keine Einigung',
    el('div', { class: 'tv-spalte' },
      el('p', { class: 'tv-dialog-text' }, r.text || ''),
      r.forderung
        ? el('div', { class: 'tv-mini' },
          `Seine Vorstellung: ${formatMoney(r.forderung.gehalt)} pro Jahr, ${r.forderung.laufzeit} Jahre` +
          (r.forderung.handgeld ? `, ${formatMoney(r.forderung.handgeld)} Handgeld` : '') + '.')
        : null),
    [{ label: 'Zur Kenntnis genommen', value: true, kind: gut ? 'primary' : 'ghost' }], { size: 'sm' });

  ctx.aktualisiere();
  ctx.refresh();
}

async function dialogTraining(ctx, p) {
  const state = ctx.state;
  const istTW = p.position === 'TW';
  const aktuell = p.training && p.training.focus ? p.training.focus : '';
  const wahl = { attribut: aktuell || (istTW ? 'reflexe' : 'technik'), intensitaet: p.training && p.training.intensitaet != null ? p.training.intensitaet : 60 };

  const antwort = await dialog(`Individualtraining: ${spielerName(p)}`, (api) => {
    const select = el('select', {
      style: { width: '100%', padding: '4px' },
      onChange: e => { wahl.attribut = e.target.value; }
    });
    for (const gruppe of Object.keys(ATTRIBUTE_GROUPS)) {
      if (gruppe === 'Torwart' && !istTW) continue;
      const og = el('optgroup', { label: gruppe });
      for (const k of ATTRIBUTE_GROUPS[gruppe]) {
        if (!istTW && KEEPER_ATTRIBUTES.includes(k)) continue;
        const wert = (p.attributes || {})[k] || 0;
        og.appendChild(el('option', { value: k, selected: k === wahl.attribut },
          `${ATTRIBUTE_NAMES[k] || k} (${wert})`));
      }
      select.appendChild(og);
    }

    const anzeige = el('span', { class: 'tv-slider__wert' }, String(wahl.intensitaet));
    const regler = el('input', {
      type: 'range', min: '20', max: '100', step: '5', value: String(wahl.intensitaet),
      onInput: e => { wahl.intensitaet = Number(e.target.value); anzeige.textContent = e.target.value; }
    });

    return el('div', { class: 'tv-spalte' },
      el('p', { class: 'tv-dialog-text' },
        `An welchem Bereich soll ${spielerName(p)} Sonderschichten schieben? ` +
        'Hohe Intensität bringt schneller Fortschritt, kostet aber Frische — und der Rest seines Spiels leidet.'),
      el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Attribut'), select),
      el('div', { class: 'tv-slider' }, el('label', {}, 'Intensität'), regler, anzeige),
      aktuell ? el('div', { class: 'tv-mini' },
        `Bisher: ${ATTRIBUTE_NAMES[aktuell] || aktuell}.`) : null);
  }, [
    { label: 'Abbrechen', value: null, kind: 'ghost' },
    aktuell ? { label: 'Sonderschichten beenden', value: 'stop', kind: 'danger' } : null,
    { label: 'Anordnen', value: 'ok', kind: 'primary' }
  ].filter(Boolean), { size: 'md' });

  if (!antwort) return;
  const r = antwort === 'stop'
    ? sicher(() => individualtraining(state, p.id, null), null, 'Individualtraining')
    : sicher(() => individualtraining(state, p.id, wahl.attribut, wahl.intensitaet), null, 'Individualtraining');

  melde(r);
  ctx.aktualisiere();
  ctx.refresh();
}

async function dialogKapitaen(ctx, p, club) {
  const ja = await dialog('Kapitänsbinde',
    el('p', { class: 'tv-dialog-text' },
      `Soll ${spielerName(p)} ab sofort die Binde tragen? Der bisherige Kapitän wird das nicht gut finden — ` +
      'und die Kabine hat zu solchen Entscheidungen immer eine Meinung.'),
    [{ label: 'Doch nicht', value: false, kind: 'ghost' }, { label: 'Er führt die Elf', value: true, kind: 'primary' }],
    { size: 'sm', escValue: false });
  if (!ja) return;

  const r = sicher(() => kapitaenBestimmen(ctx.state, club.id, p.id), null, 'Kapitänswahl');
  if (r && r.text) {
    await dialog('In der Kabine', el('p', { class: 'tv-dialog-text' }, r.text),
      [{ label: 'Verstanden', value: true, kind: 'primary' }], { size: 'sm' });
  } else {
    toast('Die Binde ließ sich nicht vergeben.', 'warn');
  }
  ctx.aktualisiere();
  ctx.refresh();
}

/**
 * Mentoren zuweisen.
 *
 * Die Vorschläge kommen fertig aus `club/chemie.js:mentorVorschlaege()` — dort
 * ist jedes Talent höchstens einmal vergeben, damit sich zwei Alte nicht um
 * denselben Jungen streiten. Der Bildschirm sortiert nur den ausgewählten
 * Spieler nach oben und schreibt die Begründung in Klartext daneben.
 */
async function dialogMentor(ctx, p, club, kab) {
  const state = ctx.state;
  const alle = sicher(() => mentorVorschlaege(state, club.id) || [], [], 'Mentorenvorschläge');
  const eigene = alle.filter(v => v.mentorId === p.id || v.talentId === p.id);
  const rest = alle.filter(v => v.mentorId !== p.id && v.talentId !== p.id);
  const liste = eigene.concat(rest);

  const gewaehlt = await dialog(`Mentor zuweisen — ${spielerName(p)}`, (api) => {
    const box = el('div', { class: 'tv-spalte', style: { gap: '4px' } });
    box.appendChild(el('p', { class: 'tv-dialog-text' },
      'Eine Legende nimmt ein Talent unter die Fittiche: Der Junge lernt schneller, ' +
      'die Art des Alten färbt ab, und der Alte gewinnt in der Kabine an Gewicht. ' +
      'Ein Talent hat höchstens einen Mentor — zwei Meinungen sind eine zu viel.'));

    if (!liste.length) {
      box.appendChild(el('div', { class: 'tv-leer' },
        'Der Co-Trainer sieht keine sinnvolle Paarung. Entweder fehlen die Alten, ' +
        'oder die Jungen sind schon so gut, wie sie werden.'));
      return box;
    }

    for (const v of liste) {
      const m = state.players[v.mentorId];
      const t = state.players[v.talentId];
      if (!m || !t) continue;
      const eigen = v.mentorId === p.id || v.talentId === p.id;
      const zeile = el('div', { class: 'tv-mentor__vorschlag' },
        el('div', { style: { minWidth: '0' } },
          el('div', { class: 'tv-zeile', style: { gap: '5px' } },
            portraitBild(m, club, 26),
            el('b', { style: { fontSize: '12px' } }, spielerName(m)),
            el('span', { class: 'tv-mentor__pfeil' }, '→'),
            portraitBild(t, club, 26),
            el('b', { style: { fontSize: '12px' } }, spielerName(t)),
            eigen ? marke('dieser Spieler', 'mentor') : null,
            pill(`Passung ${Math.round(v.staerke)}`, v.staerke >= 70 ? 'gut' : v.staerke >= 50 ? 'info' : 'warn')),
          el('div', { class: 'tv-mini', style: { marginTop: '2px' } },
            mentorBegruendung(m, t, kab.rangKarte.get(m.id)))),
        button('Zuweisen', () => api.close(v), { kind: 'primary', size: 'klein' }));
      box.appendChild(zeile);
    }
    return box;
  }, [{ label: 'Schließen', value: null, kind: 'ghost' }], { size: 'lg' });

  if (!gewaehlt) return;
  const erg = sicher(() => mentorSetzen(state, gewaehlt.talentId, gewaehlt.mentorId), null, 'Mentor zuweisen');
  melde(erg);
  ctx.aktualisiere();
  ctx.refresh();
}

async function dialogFitness(ctx, p) {
  const r = sicher(() => fitTesten(ctx.state, p.id), null, 'Fitnesstest');
  if (!r) { toast('Die medizinische Abteilung meldet sich nicht.', 'schlecht'); return; }
  const art = r.stufe >= 3 ? 'gut' : r.stufe === 2 ? 'warn' : 'schlecht';
  await dialog(`Fitnesstest: ${spielerName(p)}`,
    el('div', { class: 'tv-spalte' },
      el('p', { class: 'tv-dialog-text' }, r.text || r.empfehlung || ''),
      el('div', { class: 'tv-zeile', style: { gap: '6px' } },
        pill(r.einsatzfaehig ? 'einsatzfähig' : 'nicht einsatzfähig', r.einsatzfaehig ? 'gut' : 'schlecht'),
        pill(`Fitness ${Math.round(r.fitness || 0)} %`, art),
        r.risiko ? pill(`Verletzungsrisiko ${nfmt((r.risiko || 0) * 100, 1)} %`, r.risiko > 0.05 ? 'schlecht' : 'info') : null),
      el('div', { class: 'tv-mini' }, r.empfehlung || '')),
    [{ label: 'Danke, Doc', value: true, kind: 'primary' }], { size: 'sm' });
}

function akteAktionen(ctx, p, d, club) {
  const gelistet = !!(p.transfer && p.transfer.listed);
  const box = el('div', { class: 'tv-spalte', style: { gap: '5px' } });

  const reihe = (...knoepfe) => el('div', { class: 'tv-zeile', style: { gap: '5px' } }, ...knoepfe);

  box.appendChild(reihe(
    button('Gespräch führen', () => dialogGespraech(ctx, p), { kind: 'blau', size: 'klein', wide: true }),
    button('Fitness testen', () => dialogFitness(ctx, p), { kind: 'ghost', size: 'klein', wide: true })));

  box.appendChild(reihe(
    button('Vertrag verlängern', () => dialogVertrag(ctx, p, d, club), { kind: 'primary', size: 'klein', wide: true }),
    button('Individualtraining', () => dialogTraining(ctx, p), { kind: 'ghost', size: 'klein', wide: true })));

  box.appendChild(reihe(
    button(gelistet ? 'Von der Liste nehmen' : 'Auf die Transferliste', () => {
      const r = sicher(() => transferlisteSetzen(ctx.state, p.id, !gelistet), null, 'Transferliste');
      melde(r, gelistet ? 'gut' : 'warn');
      ctx.aktualisiere();
      ctx.refresh();
    }, { kind: gelistet ? 'ghost' : 'danger', size: 'klein', wide: true }),
    button('Zum Kapitän machen', () => dialogKapitaen(ctx, p, club), {
      kind: 'gold', size: 'klein', wide: true, disabled: !!p.captain,
      tooltip: p.captain ? 'Er trägt die Binde bereits.' : 'Macht ihn zum Anführer der Mannschaft.'
    })));

  box.appendChild(el('div', { class: 'tv-zeile', style: { gap: '5px' } },
    button('Auf dem Taktikbrett', () => ctx.navigate('taktik', { playerId: p.id }), { kind: 'ghost', size: 'klein', wide: true }),
    button('In der Medizin', () => ctx.navigate('medizin', { playerId: p.id }), { kind: 'ghost', size: 'klein', wide: true })));

  return box;
}

function spielerakte(ctx, p, club, daten, kab) {
  if (!p) {
    return panel('Spielerakte',
      el('div', { class: 'tv-leer' },
        'Kein Spieler ausgewählt.',
        el('div', { class: 'tv-mini', style: { marginTop: '6px', fontStyle: 'normal' } },
          'Klicken Sie links auf eine Zeile — dann liegt die komplette Akte auf dem Schreibtisch.')));
  }
  const d = daten.get(p.id);
  const karte = el('div', { class: 'tv-spielerkarte' },
    akteKopf(p, club, d),
    akteTraits(p),
    el('div', { class: 'tv-trenner' }),
    akteZustand(p, d));

  return el('div', { class: 'tv-spalte' },
    panel('Spielerakte', karte),
    panel('Attribute', akteAttribute(p)),
    panel('Vertrag & Marktwert', akteVertrag(ctx.state, p, d, club)),
    panel('Statistik', akteStatistik(p)),
    panel('Zufriedenheit', akteZufriedenheit(ctx.state, p)),
    panel('Entwicklung', akteEntwicklung(p, d)),
    panel('In der Kabine', akteKabine(ctx, p, club, kab)),
    panel('Nationalmannschaft', akteNational(ctx.state, p, kab)),
    panel('Maßnahmen', akteAktionen(ctx, p, d, club)));
}

/* ==========================================================================
 * 10. Der Bildschirm
 * ======================================================================== */

export const screen = {
  id: 'kader',
  title: 'Kader',
  icon: '👥',

  async render(root, ctx) {
    const state = ctx.state;
    if (!state || !state.clubs) {
      root.appendChild(panel('Kader', fehlerBox('Kein Spielstand geladen', 'ctx.state enthält keine Vereinsdaten.')));
      return;
    }

    const club = sicher(() => myClub(state), null, 'Eigener Verein');
    if (!club) {
      root.appendChild(panel('Kader', fehlerBox('Verein nicht gefunden',
        `state.managerClubId "${state.managerClubId}" verweist auf keinen Verein.`)));
      return;
    }

    const spieler = sicher(() => squadOf(state, club.id).filter(Boolean), [], 'Kaderliste');
    const daten = spielerDaten(state, club, spieler);
    const kab = kabineDaten(state, club);

    // Vorauswahl über Navigationsparameter (z. B. aus der Medizin oder Post).
    const wunsch = ctx.params && (ctx.params.playerId || ctx.params.spieler);
    if (wunsch && daten.has(wunsch)) zustand.gewaehlt = wunsch;
    if (!zustand.gewaehlt || !daten.has(zustand.gewaehlt)) {
      const beste = spieler.slice().sort((a, b) => daten.get(b.id).ovr - daten.get(a.id).ovr)[0];
      zustand.gewaehlt = beste ? beste.id : null;
    }

    /* --- Seitengerüst ---------------------------------------------------- */
    const wappen = el('canvas', { width: 56, height: 56, style: { width: '28px', height: '28px' } });
    sicher(() => drawCrest(wappen.getContext('2d'), club, 28, 28, 54), null, 'Wappen');

    const seite = el('div', { class: 'tv-seite' },
      el('div', { class: 'tv-seite__kopf' },
        wappen,
        el('h1', { class: 'tv-seite__titel' }, 'Kader'),
        el('div', { class: 'tv-seite__unter' },
          `${club.name} · Saison ${state.date ? state.date.season : 1} · ` +
          `${spieler.length} Profis unter Vertrag`)));

    if (!spieler.length) {
      seite.appendChild(panel('Kader',
        el('div', { class: 'tv-leer' },
          'Ihr Kader ist leer. Das ist selbst für einen Traumverein ein sehr sportlicher Ansatz.',
          el('div', { style: { marginTop: '10px' } },
            button('Zum Transfermarkt', () => ctx.navigate('transfer'), { kind: 'primary' })))));
      root.appendChild(seite);
      return;
    }

    seite.appendChild(kopfbereich(ctx, state, club, spieler, daten));

    /* --- Liste ------------------------------------------------------------ */
    const listenBox = el('div');
    const anzahlEl = el('span', { class: 'tv-mini', style: { marginLeft: 'auto' } });
    let tabelle = null;

    const aktualisiereAnzahl = (n) => {
      clearNode(anzahlEl);
      anzahlEl.appendChild(el('span', {}, `${n} von ${spieler.length} Spielern`));
    };

    const waehle = (p) => {
      if (!p) return;
      zustand.gewaehlt = p.id;
      zeichneAkte();
      if (tabelle) tabelle.tvSetRows(filtern(spieler, daten));
    };

    const tabellenOpts = (spalten) => ({
      idKey: 'id',
      compact: true,
      maxHeight: 560,
      emptyText: 'Kein Spieler passt zu diesen Filtern. Der Kader ist groß, aber nicht unendlich.',
      selectedId: zustand.gewaehlt,
      // Eine Sortierung aus einer anderen Ansicht gibt es hier vielleicht gar nicht –
      // dann wird nach Stärke sortiert statt gar nicht.
      sort: spalten.some(s => (s.key || s.label) === zustand.sort.key)
        ? { key: zustand.sort.key, desc: zustand.sort.desc }
        : { key: 'ovr', desc: true },
      onSort: (key, desc) => { zustand.sort = { key, desc }; },
      onRowClick: (p) => waehle(p),
      rowClass: (p) => {
        const k = [];
        if (p.era === 'legend') k.push('zeile--legende');
        if (p.injury) k.push('zeile--verletzt');
        if (p.cards && p.cards.ban > 0) k.push('zeile--gesperrt');
        if (p.id === zustand.gewaehlt) k.push('gewaehlt');
        return k.join(' ');
      }
    });

    const tabelleNeu = () => {
      const zeilen = filtern(spieler, daten);
      const spalten = spaltenFuer(zustand.ansicht, state, club, daten, kab);
      tabelle = table(spalten, zeilen, tabellenOpts(spalten));
      clearNode(listenBox);
      listenBox.appendChild(tabelle);
      aktualisiereAnzahl(zeilen.length);
    };

    const zeilenNeu = (neuAufbauen) => {
      if (neuAufbauen || !tabelle) { tabelleNeu(); return; }
      const zeilen = filtern(spieler, daten);
      tabelle.tvSetRows(zeilen);
      aktualisiereAnzahl(zeilen.length);
    };

    let reiter = null;
    const synchronisiereReiter = () => {
      if (!reiter) return;
      reiter.querySelectorAll('.tv-tab').forEach(b => b.classList.toggle('aktiv', b.classList.contains('tv-tab--aktiv')));
    };

    reiter = tabs(ANSICHTEN.map(a => ({ id: a.id, label: a.label, render: () => listenBox })), {
      active: zustand.ansicht,
      keepAlive: true,
      onChange: (id) => {
        zustand.ansicht = id;
        tabelleNeu();
        synchronisiereReiter();
      }
    });
    // styles/main.css macht .tv-tabs zu einem Flex-Container für eine andere
    // Reiterstruktur — hier muss der Inhalt unter die Leiste.
    reiter.style.display = 'block';
    reiter.style.background = 'transparent';
    reiter.style.padding = '0';
    reiter.style.borderBottom = '0';
    synchronisiereReiter();

    const listenPanel = panel('Mannschaftsliste',
      filterLeiste((neuAufbauen) => zeilenNeu(neuAufbauen), anzahlEl),
      reiter);

    /* --- Akte ------------------------------------------------------------- */
    const akteBox = el('div');
    function zeichneAkte() {
      const p = zustand.gewaehlt ? spieler.find(x => x.id === zustand.gewaehlt) : null;
      clearNode(akteBox);
      try {
        akteBox.appendChild(spielerakte(ctx, p, club, daten, kab));
      } catch (err) {
        console.error('[kader] Spielerakte:', err);
        akteBox.appendChild(panel('Spielerakte',
          fehlerBox('Die Akte lässt sich nicht öffnen', err && err.message)));
      }
    }
    zeichneAkte();

    seite.appendChild(el('div', { class: 'tv-kader' }, listenPanel, akteBox));
    root.appendChild(seite);
  },

  onLeave() {
    // Nichts aufzuräumen: keine Zeitgeber, keine Animationen.
  }
};

export default screen;
