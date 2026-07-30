/**
 * club/sponsors.js — Trikot, Ärmel, Ausrüster, Stadionname, Bande.
 *
 * Wöchentliche Auszahlung der Grundsummen, Bonusprüfung bei sportlichen Erfolgen,
 * auslaufende Verträge, neue Angebote. Reine Logik, kein DOM, kein Math.random().
 *
 * GRÖSSENORDNUNGEN Trikotsponsor pro Saison (Zielbild):
 *   Bayern ~55 Mio · Dortmund ~30 Mio · Mittelfeld Bundesliga 8–14 Mio ·
 *   Aufsteiger 4–6 Mio · 2. Bundesliga 1–4 Mio.
 * Alle übrigen Slots sind feste Anteile davon (siehe SPONSOR_SLOTS.anteil);
 * in Summe ergibt das ~2,8 × Trikotwert, also rund 25 % vom Vereinsumsatz.
 */

import { clamp, formatMoney, sortBy } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { LEAGUES, leagueOfClub, SAISON_TAGE } from '../data/leagues.js';
import { buchen } from './finances.js';

/* ══════════════════════════════════════════════════════════════════════════
 *  BALANCING-KONSTANTEN
 * ══════════════════════════════════════════════════════════════════════════ */

const SAISON_WOCHEN = 52;

/** Sockel und Steilheit je Liga: trikot = sockel + faktor × index^EXP. */
const TRIKOT_LIGA = {
  bl1: { sockel: 3400000, faktor: 3250000 },
  bl2: { sockel: 700000, faktor: 1320000 }
};
const TRIKOT_EXP = 4.2;
const INDEX_REP = 0.62;          // Gewichte des Attraktivitäts-Index
const INDEX_ZUSCHAUER = 0.22;
const INDEX_MITGLIEDER = 0.16;
const INDEX_ZUSCHAUER_REF = 45000;
const INDEX_MITGLIEDER_REF = 150000;
const PLATZ_SPANNE = 0.15;       // Tabellenplatz -> ±15 % auf die Grundsumme

const ANGEBOT_GUELTIG_TAGE = 21;
const ANGEBOT_CHANCE_PRO_WOCHE = 0.35;
/** Vorwarnung, bevor ein Vertrag am Saisonende ausläuft. */
const ABLAUF_WARNUNG_TAGE = 30;
/** Anschlussangebote liegen länger auf dem Tisch — sie zielen auf die neue Saison. */
const ANSCHLUSS_GUELTIG_TAGE = 95;
/** Bis zu diesem Tag der neuen Saison bleiben Anschlussangebote gültig. */
const ANSCHLUSS_FRIST = 28;
/**
 * Tag, ab dem die Vorwarnung verschickt wird. Das Sponsorengeschäft läuft im
 * Wochenrhythmus — die volle Woche Abstand sorgt dafür, dass die Post auch beim
 * ungünstigsten Wochenschnitt mindestens 30 Tage vor dem letzten Spieltag da ist.
 */
const ABLAUF_WARN_TAG = Math.max(0, (SAISON_TAGE.saisonEnde || 319) - ABLAUF_WARNUNG_TAGE - 6);
const VERHANDLUNG_MAX_RUNDEN = 3;
const KUENDIGUNG_STRAFE = 0.25;  // Anteil der Restlaufzeit als Vertragsstrafe
const HANDGELD_ANTEIL = 0.08;    // sofort fällige Anzahlung bei Vertragsschluss
const BANDEN_PLAETZE = 4;

/** Bonusanteile, jeweils bezogen auf die Grundsumme. */
const BONUS_ANTEIL = {
  meister: 0.45, pokalsieg: 0.20, europacup: 0.25,
  platz: 0.15, klassenerhalt: 0.10, aufstieg: 0.30
};

export const SPONSOR_SLOTS = {
  trikot:     { id: 'trikot', name: 'Trikotsponsor', kurz: 'Brust', anteil: 1.00, mehrfach: false, plaetze: 1 },
  aermel:     { id: 'aermel', name: 'Ärmelsponsor', kurz: 'Ärmel', anteil: 0.30, mehrfach: false, plaetze: 1 },
  ausruester: { id: 'ausruester', name: 'Ausrüster', kurz: 'Ausrüster', anteil: 0.55, mehrfach: false, plaetze: 1 },
  stadion:    { id: 'stadion', name: 'Stadionname', kurz: 'Stadion', anteil: 0.32, mehrfach: false, plaetze: 1 },
  bande:      { id: 'bande', name: 'Bandenwerbung', kurz: 'Bande', anteil: 0.16, mehrfach: true, plaetze: BANDEN_PLAETZE }
};

export const SLOT_IDS = ['trikot', 'aermel', 'ausruester', 'stadion', 'bande'];

/** Angebotsprofile: unterschiedliche Charaktere statt reiner Zahlenvarianz. */
const PROFILE = [
  {
    id: 'solide', name: 'Solide', gewicht: 26,
    grund: 1.00, bonus: 0.8, laufzeit: [2, 3], seriositaet: [62, 88], fanEffekt: 0,
    spruch: 'Ein Vertrag ohne Fußnoten. Langweilig, aber verlässlich.'
  },
  {
    id: 'treu', name: 'Langfristig', gewicht: 20,
    grund: 0.88, bonus: 0.6, laufzeit: [4, 5], seriositaet: [65, 92], fanEffekt: 1,
    spruch: 'Wenig Geld, dafür bis zum Sankt-Nimmerleins-Tag.'
  },
  {
    id: 'erfolg', name: 'Erfolgsorientiert', gewicht: 22,
    grund: 0.70, bonus: 2.3, laufzeit: [2, 3], seriositaet: [55, 82], fanEffekt: 0,
    spruch: 'Sie zahlen wenig — es sei denn, wir liefern. Dann zahlen sie fürstlich.'
  },
  {
    id: 'regional', name: 'Regionalpartner', gewicht: 18,
    grund: 0.80, bonus: 0.9, laufzeit: [3, 4], seriositaet: [70, 95], fanEffekt: 3,
    spruch: 'Der Betrieb von nebenan. Die Kurve wird das gern sehen.'
  },
  {
    id: 'dubios', name: 'Zweifelhaft', gewicht: 14,
    grund: 1.45, bonus: 1.4, laufzeit: [1, 2], seriositaet: [8, 34], fanEffekt: -6,
    spruch: 'Viel Geld, kurze Laufzeit, und niemand weiß so genau, wo es herkommt.'
  }
];

/* ── Firmennamen ──────────────────────────────────────────────────────────
 * Bevorzugt aus data/names.js (SPONSOR_NAMES). Solange die Datei nicht
 * existiert, greift diese Notliste — der Import ist deshalb abgesichert.
 * ──────────────────────────────────────────────────────────────────────── */

const FALLBACK_SPONSOR_NAMES = [
  { name: 'Nordheim Versicherung', branche: 'Versicherung', seriositaet: 85 },
  { name: 'Elbtaler Sparkasse', branche: 'Bank', seriositaet: 88 },
  { name: 'Vogtland Energie', branche: 'Energie', seriositaet: 80 },
  { name: 'Wagner Fenstertechnik', branche: 'Handwerk', seriositaet: 78 },
  { name: 'Bruns Baustoffe', branche: 'Baustoffe', seriositaet: 74 },
  { name: 'Kaltenbach Maschinenbau', branche: 'Industrie', seriositaet: 82 },
  { name: 'Rheinperle Mineralwasser', branche: 'Getränke', seriositaet: 76 },
  { name: 'Störtebeker Pilsener', branche: 'Brauerei', seriositaet: 72 },
  { name: 'Grünewald Möbelhäuser', branche: 'Einzelhandel', seriositaet: 70 },
  { name: 'Autohaus Zangenberg', branche: 'Automobil', seriositaet: 68 },
  { name: 'Pfennigpfeiffer Discount', branche: 'Discounter', seriositaet: 66 },
  { name: 'Teuto Logistik', branche: 'Logistik', seriositaet: 71 },
  { name: 'Meyer & Söhne Fleischwaren', branche: 'Lebensmittel', seriositaet: 69 },
  { name: 'Isartal Pharma', branche: 'Pharma', seriositaet: 83 },
  { name: 'Hanseatic Reederei', branche: 'Schifffahrt', seriositaet: 79 },
  { name: 'Silberdistel Tiefkühlkost', branche: 'Lebensmittel', seriositaet: 67 },
  { name: 'Kobalt Softwarehaus', branche: 'Technologie', seriositaet: 73 },
  { name: 'Freiberger Werkzeugbau', branche: 'Industrie', seriositaet: 77 },
  { name: 'Alpenkrone Molkerei', branche: 'Molkerei', seriositaet: 75 },
  { name: 'Kranich Fluggesellschaft', branche: 'Luftfahrt', seriositaet: 84 },
  { name: 'Sportartikel Duvenstedt', branche: 'Ausrüster', seriositaet: 76 },
  { name: 'Trikotwerk Solingen', branche: 'Ausrüster', seriositaet: 72 },
  { name: 'Adlerhorst Sportmode', branche: 'Ausrüster', seriositaet: 74 },
  { name: 'Volltreffer Sportswear', branche: 'Ausrüster', seriositaet: 64 },
  { name: 'BetHansa Sportwetten', branche: 'Wettanbieter', seriositaet: 22 },
  { name: 'Goldesel Wetten', branche: 'Wettanbieter', seriositaet: 15 },
  { name: 'Tipp3000', branche: 'Wettanbieter', seriositaet: 18 },
  { name: 'CoinFuchs Digitalwerte', branche: 'Kryptowährung', seriositaet: 12 },
  { name: 'Sofortkredit Blitzbank', branche: 'Kreditvermittlung', seriositaet: 20 },
  { name: 'Dr. Ohlsens Kräuterkur', branche: 'Nahrungsergänzung', seriositaet: 24 },
  { name: 'Perlmutt Schönheitsklinik', branche: 'Klinik', seriositaet: 31 },
  { name: 'Wüstenperle Airlines', branche: 'Luftfahrt', seriositaet: 34 }
];

let SPONSOR_NAMES = FALLBACK_SPONSOR_NAMES;
try {
  const mod = await import('../data/names.js');
  if (mod && Array.isArray(mod.SPONSOR_NAMES) && mod.SPONSOR_NAMES.length) {
    SPONSOR_NAMES = mod.SPONSOR_NAMES.map(normalisiereFirma);
  }
} catch (e) {
  /* data/names.js liegt noch nicht vor – Notliste bleibt aktiv. */
}

function normalisiereFirma(eintrag) {
  if (typeof eintrag === 'string') return { name: eintrag, branche: 'Sonstiges', seriositaet: 60 };
  return {
    name: eintrag.name || eintrag.firma || 'Namenlose GmbH',
    branche: eintrag.branche || eintrag.kategorie || 'Sonstiges',
    seriositaet: eintrag.seriositaet !== undefined ? eintrag.seriositaet : 60
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Helfer
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Startbelegung: Wie viele Bandenplätze sind zu Spielbeginn schon verkauft, und
 * wie wahrscheinlich hat der Verein bereits einen Ärmel- bzw. Namenspartner?
 * Der Attraktivitäts-Index (siehe attraktivitaet()) liegt etwa zwischen 0,45
 * (Drittligaformat) und 1,9 (Bayern).
 */
const START_AERMEL_CHANCE = idx => clamp((idx - 0.45) * 0.75, 0.05, 0.92);
const START_STADION_CHANCE = idx => clamp((idx - 0.80) * 0.55, 0, 0.7);
const START_BANDEN = idx => clamp(Math.round(1.6 + idx * 1.5), 2, BANDEN_PLAETZE);
/** Restlaufzeiten der Startverträge in Saisons — bewusst gestaffelt. */
const START_RESTLAUFZEIT = {
  trikot: [1, 3], aermel: [1, 3], ausruester: [1, 4], stadion: [2, 5], bande: [1, 3]
};

function sp(club) {
  const s = club.sponsors || (club.sponsors = {});
  if (s.trikot === undefined) s.trikot = null;
  if (s.aermel === undefined) s.aermel = null;
  if (s.ausruester === undefined) s.ausruester = null;
  if (s.stadion === undefined) s.stadion = null;
  if (!Array.isArray(s.bande)) s.bande = [];
  if (!Array.isArray(s.angebote)) s.angebote = [];
  if (!Array.isArray(s.boniErfuellt)) s.boniErfuellt = [];
  if (!Array.isArray(s.historie)) s.historie = [];
  if (typeof s.dubiosMalus !== 'number') s.dubiosMalus = 0;
  return s;
}

/** Alle laufenden Verträge eines Vereins als flache Liste. */
export function vertraege(club) {
  const s = sp(club);
  const out = [];
  for (const slot of ['trikot', 'aermel', 'ausruester', 'stadion']) if (s[slot]) out.push(s[slot]);
  for (const v of s.bande) if (v) out.push(v);
  return out;
}

function istManager(state, clubId) { return state.managerClubId === clubId; }

function melde(state, ctx, clubId, text, kind = 'sponsor', opts = null) {
  if (!ctx || !ctx.log || !istManager(state, clubId)) return;
  ctx.log(text, kind, opts);
}

function zuschauerSchnitt(club) {
  const st = club.stadium || { capacity: 15000 };
  const ss = club.stadiumState || {};
  if (ss.auslastungSchnitt) return st.capacity * clamp(ss.auslastungSchnitt, 0.2, 1);
  return st.capacity * clamp(0.6 + (club.reputation || 50) / 400, 0.35, 0.98);
}

function tabellenplatzVon(state, clubId) {
  const club = state.clubs[clubId];
  const ligaId = (club && club.leagueId) || leagueOfClub(clubId);
  const tab = state.tables && state.tables[ligaId];
  if (Array.isArray(tab) && tab.length) {
    for (let i = 0; i < tab.length; i++) if (tab[i] && tab[i].clubId === clubId) return tab[i].platz || (i + 1);
  }
  const liga = LEAGUES[ligaId];
  if (!liga) return 9;
  const rang = sortBy(liga.clubIds.map(id => ({
    id, rep: (state.clubs[id] && state.clubs[id].reputation) || 50
  })), c => ({ key: c.rep, desc: true })).findIndex(c => c.id === clubId);
  return rang >= 0 ? rang + 1 : Math.round(liga.clubIds.length / 2);
}

/**
 * Attraktivitäts-Index eines Vereins für Sponsoren.
 * Reputation, Zuschauerschnitt und Mitglieder — genau die drei Zahlen, die ein
 * Marketingchef in seine Präsentation schreibt.
 */
function attraktivitaet(state, clubId) {
  const club = state.clubs[clubId];
  const fans = club.fans || club.fanbase || {};
  return INDEX_REP * ((club.reputation || 50) / 50)
    + INDEX_ZUSCHAUER * (zuschauerSchnitt(club) / INDEX_ZUSCHAUER_REF)
    + INDEX_MITGLIEDER * ((fans.members || 3000) / INDEX_MITGLIEDER_REF);
}

/** Marktwert des Trikotsponsorings pro Saison. */
export function trikotwert(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return 0;
  const ligaId = club.leagueId || leagueOfClub(clubId) || 'bl2';
  const liga = TRIKOT_LIGA[ligaId] || TRIKOT_LIGA.bl2;
  const idx = Math.max(0.05, attraktivitaet(state, clubId));
  const roh = liga.sockel + liga.faktor * Math.pow(idx, TRIKOT_EXP);

  // Tabellenplatz: wer oben steht, bekommt mehr geboten.
  const n = (LEAGUES[ligaId] && LEAGUES[ligaId].clubIds.length) || 18;
  const platz = tabellenplatzVon(state, clubId);
  const fPlatz = 1 + ((n - platz) / (n - 1) - 0.5) * 2 * PLATZ_SPANNE;
  return Math.round(roh * fPlatz);
}

/** Marktwert eines einzelnen Slots pro Saison. */
export function slotwert(state, clubId, slot) {
  const def = SPONSOR_SLOTS[slot];
  if (!def) return 0;
  return Math.round(trikotwert(state, clubId) * def.anteil);
}

function freieSlots(club) {
  const s = sp(club);
  const frei = [];
  for (const slot of ['trikot', 'aermel', 'ausruester', 'stadion']) if (!s[slot]) frei.push(slot);
  if (s.bande.length < BANDEN_PLAETZE) frei.push('bande');
  return frei;
}

function firmaWaehlen(rng, profil, slot) {
  const dubios = profil.id === 'dubios';
  let pool = SPONSOR_NAMES.filter(f => (dubios ? f.seriositaet < 40 : f.seriositaet >= 40));
  if (slot === 'ausruester') {
    const aus = SPONSOR_NAMES.filter(f => f.branche === 'Ausrüster');
    if (aus.length) pool = aus;
  }
  if (!pool.length) pool = SPONSOR_NAMES;
  return rng.pick(pool);
}

/** Bonusstaffel eines Vertrags, bezogen auf Grundsumme und Profil. */
function boniFuer(grundsumme, profil, rng) {
  const bonusBasis = grundsumme * profil.bonus;
  const runde = anteil => Math.round(bonusBasis * anteil / 10000) * 10000;
  return {
    meister: runde(BONUS_ANTEIL.meister),
    pokalsieg: runde(BONUS_ANTEIL.pokalsieg),
    europacup: runde(BONUS_ANTEIL.europacup),
    klassenerhalt: runde(BONUS_ANTEIL.klassenerhalt),
    aufstieg: runde(BONUS_ANTEIL.aufstieg),
    platz: {
      bis: profil.id === 'erfolg' ? rng.int(4, 8) : rng.int(6, 12),
      betrag: runde(BONUS_ANTEIL.platz)
    }
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Angebote
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Erzeugt 3–5 Angebote für einen Slot.
 * @param {object} [opts] { anschluss:true } = Angebot für die kommende Saison,
 *                        liegt deutlich länger auf dem Tisch.
 * @returns {Array<object>} Angebote (auch in club.sponsors.angebote abgelegt)
 */
export function angeboteGenerieren(state, clubId, slot, rng, opts = {}) {
  const club = state.clubs[clubId];
  if (!club || !SPONSOR_SLOTS[slot]) return [];
  const s = sp(club);
  const anschluss = !!opts.anschluss;
  const basis = slotwert(state, clubId, slot);
  const anzahl = rng.int(3, 5);
  const profile = [];
  for (let i = 0; i < anzahl; i++) {
    const p = rng.pickWeighted(PROFILE, x => x.gewicht * (profile.includes(x.id) ? 0.35 : 1));
    profile.push(p.id);
    const firma = firmaWaehlen(rng, p, slot);
    const streuung = rng.float(0.9, 1.12);
    const grundsumme = Math.max(50000, Math.round(basis * p.grund * streuung / 10000) * 10000);
    const laufzeit = rng.int(p.laufzeit[0], p.laufzeit[1]);

    const angebot = {
      id: `sp_${clubId}_${slot}_${state.date.season}_${state.date.day}_${i}`,
      slot,
      firma: firma.name,
      branche: firma.branche,
      profil: p.id,
      profilName: p.name,
      spruch: p.spruch,
      grundsumme,
      laufzeit,
      seriositaet: clamp(Math.round(rng.int(p.seriositaet[0], p.seriositaet[1]) * 0.5 + firma.seriositaet * 0.5), 1, 99),
      dubios: p.id === 'dubios',
      fanEffekt: p.fanEffekt,
      handgeld: Math.round(grundsumme * HANDGELD_ANTEIL),
      boni: boniFuer(grundsumme, p, rng),
      verhandlungsrunden: 0,
      stimmung: 70,
      anschluss,
      erstelltTag: state.date.day,
      erstelltSaison: state.date.season,
      gueltigBis: state.date.day + (anschluss ? ANSCHLUSS_GUELTIG_TAGE : ANGEBOT_GUELTIG_TAGE)
    };
    s.angebote.push(angebot);
  }
  return s.angebote.filter(a => a.slot === slot);
}

/* ══════════════════════════════════════════════════════════════════════════
 *  STARTBELEGUNG
 * ══════════════════════════════════════════════════════════════════════════ */

/** Baut einen bereits laufenden Vertrag mit `rest` verbleibenden Saisons. */
function startVertrag(state, clubId, slot, rng, rest, nummer) {
  const basis = slotwert(state, clubId, slot);
  // Auf Brust, Ärmel, Ausrüster und Stadiondach steht zum Spielstart nichts
  // Zwielichtiges — das darf sich der Manager später selbst einbrocken.
  // An der Bande stand schon immer alles, was zahlt.
  const p = rng.pickWeighted(PROFILE, x => x.id !== 'dubios' ? x.gewicht : (slot === 'bande' ? x.gewicht * 0.4 : 0));
  const firma = firmaWaehlen(rng, p, slot);
  const streuung = rng.float(0.92, 1.08);
  const grundsumme = Math.max(50000, Math.round(basis * p.grund * streuung / 10000) * 10000);
  const laufzeit = Math.max(rest, rng.int(p.laufzeit[0], p.laufzeit[1]));
  const abSaison = state.date.season - (laufzeit - rest);
  return {
    id: `sp_start_${clubId}_${slot}_${nummer}`,
    slot,
    firma: firma.name,
    branche: firma.branche,
    profil: p.id,
    grundsumme,
    boni: boniFuer(grundsumme, p, rng),
    laufzeit,
    abSaison,
    bisSaison: state.date.season + rest - 1,
    seriositaet: clamp(Math.round(rng.int(p.seriositaet[0], p.seriositaet[1]) * 0.5 + firma.seriositaet * 0.5), 1, 99),
    dubios: p.id === 'dubios',
    fanEffekt: p.fanEffekt || 0,
    gezahlt: 0,
    bonusGezahlt: 0,
    unterschrieben: { season: abSaison, day: 0 }
  };
}

/**
 * Stattet einen Verein mit plausiblen laufenden Sponsorverträgen aus.
 *
 * Trikot, Ausrüster und Bande sind immer belegt — kein Profiverein läuft mit
 * blanker Brust auf. Ärmel und Stadionname hängen an der Vereinsgröße: Der
 * Dorfverein hat keinen Namenspartner, und er würde auch keinen finden.
 * Die Restlaufzeiten sind gestaffelt, damit über die Jahre immer wieder
 * Verhandlungen anstehen und nicht alles auf einmal ausläuft.
 *
 * Wird von tickSponsoren beim ersten Tick eines Vereins automatisch nachgeholt.
 *
 * @returns {{ok:boolean, vertraege:Array, summe:number, text:string}}
 */
export function startSponsoren(state, clubId, rng) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, vertraege: [], summe: 0, text: 'Unbekannter Verein.' };
  const s = sp(club);
  s.gestartet = true;

  const r = rng || createRng('sponsorstart:' + (state.seed || 0) + ':' + clubId);
  const idx = attraktivitaet(state, clubId);
  const neu = [];
  let nummer = 0;

  const belegen = (slot, rest) => {
    const v = startVertrag(state, clubId, slot, r, rest, nummer++);
    if (SPONSOR_SLOTS[slot].mehrfach) s.bande.push(v);
    else s[slot] = v;
    if (v.dubios) s.dubiosMalus++;
    neu.push(v);
    s.historie.push({
      season: state.date.season, day: state.date.day, art: 'bestand',
      slot, firma: v.firma, grundsumme: v.grundsumme
    });
  };
  const rest = slot => r.int(START_RESTLAUFZEIT[slot][0], START_RESTLAUFZEIT[slot][1]);

  if (!s.trikot) belegen('trikot', rest('trikot'));
  if (!s.ausruester) belegen('ausruester', rest('ausruester'));
  if (!s.aermel && r.chance(START_AERMEL_CHANCE(idx))) belegen('aermel', rest('aermel'));
  if (!s.stadion && r.chance(START_STADION_CHANCE(idx))) belegen('stadion', rest('stadion'));
  const banden = START_BANDEN(idx);
  while (s.bande.length < banden) belegen('bande', rest('bande'));

  if (s.historie.length > 40) s.historie.splice(0, s.historie.length - 40);
  const summe = neu.reduce((a, v) => a + v.grundsumme, 0);

  return {
    ok: true, vertraege: neu, summe,
    text: neu.length
      ? `${neu.length} laufende Werbeverträge über zusammen ${formatMoney(summe)} pro Saison.`
      : 'Alle Werbeplätze waren bereits vergeben.'
  };
}

/** Erwarteter Gesamtwert eines Angebots (Grundsumme + realistisch erreichbare Boni). */
export function angebotswert(angebot, erwarteterPlatz = 9) {
  const b = angebot.boni || {};
  let boni = 0;
  if (b.platz && erwarteterPlatz <= b.platz.bis) boni += b.platz.betrag;
  if (erwarteterPlatz <= 1) boni += b.meister || 0;
  if (erwarteterPlatz <= 7) boni += (b.europacup || 0) * 0.5;
  boni += (b.klassenerhalt || 0) * 0.6;
  return Math.round((angebot.grundsumme + boni) * angebot.laufzeit);
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Aktionen
 * ══════════════════════════════════════════════════════════════════════════ */

/** Angebot annehmen und Vertrag schließen. */
export function sponsorAnnehmen(state, clubId, slot, angebot) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  const def = SPONSOR_SLOTS[slot];
  if (!def) return { ok: false, text: 'Diesen Werbeplatz gibt es nicht.' };
  const s = sp(club);
  const a = typeof angebot === 'string' ? s.angebote.find(x => x.id === angebot) : angebot;
  if (!a) return { ok: false, text: 'Dieses Angebot liegt nicht mehr auf dem Tisch.' };

  if (def.mehrfach) {
    if (s.bande.length >= def.plaetze) {
      return { ok: false, text: 'Alle Bandenplätze sind vergeben. Erst kündigen, dann unterschreiben.' };
    }
  } else if (s[slot]) {
    return { ok: false, text: `Wir haben bereits einen ${def.name}. Zwei Logos auf derselben Brust sind unseriös.` };
  }

  const vertrag = {
    id: a.id,
    slot,
    firma: a.firma,
    branche: a.branche,
    profil: a.profil,
    grundsumme: a.grundsumme,
    boni: a.boni,
    laufzeit: a.laufzeit,
    abSaison: state.date.season,
    bisSaison: state.date.season + a.laufzeit - 1,
    seriositaet: a.seriositaet,
    dubios: !!a.dubios,
    fanEffekt: a.fanEffekt || 0,
    gezahlt: 0,
    bonusGezahlt: 0,
    unterschrieben: { season: state.date.season, day: state.date.day }
  };

  if (def.mehrfach) s.bande.push(vertrag);
  else s[slot] = vertrag;
  const idx = s.angebote.indexOf(a);
  if (idx >= 0) s.angebote.splice(idx, 1);
  // Konkurrenzangebote für denselben Slot verfallen.
  if (!def.mehrfach) s.angebote = s.angebote.filter(x => x.slot !== slot);

  if (a.handgeld) buchen(state, clubId, a.handgeld, 'sponsoren', `Handgeld ${a.firma} (${def.name})`);

  if (club.fans && vertrag.fanEffekt) {
    club.fans.mood = clamp((club.fans.mood || 60) + vertrag.fanEffekt, 0, 100);
  }
  if (vertrag.dubios) s.dubiosMalus++;

  s.historie.push({ season: state.date.season, day: state.date.day, art: 'abschluss', slot, firma: vertrag.firma, grundsumme: vertrag.grundsumme });

  return {
    ok: true, vertrag,
    text: `${vertrag.firma} ziert ab sofort unseren ${def.kurz}: ${formatMoney(vertrag.grundsumme)} pro Saison, ` +
      `Laufzeit ${vertrag.laufzeit} ${vertrag.laufzeit === 1 ? 'Saison' : 'Saisons'}.` +
      (vertrag.dubios ? ' Die Kurve wird das nicht bejubeln.' : '')
  };
}

/** Vertrag vorzeitig kündigen — kostet eine Strafe. */
export function sponsorKuendigen(state, clubId, slot, index = 0) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  const def = SPONSOR_SLOTS[slot];
  if (!def) return { ok: false, text: 'Diesen Werbeplatz gibt es nicht.' };
  const s = sp(club);
  const vertrag = def.mehrfach ? s.bande[index] : s[slot];
  if (!vertrag) return { ok: false, text: 'Da ist kein Vertrag zu kündigen.' };

  const restSaisons = Math.max(0, vertrag.bisSaison - state.date.season + 1);
  const strafe = Math.round(vertrag.grundsumme * restSaisons * KUENDIGUNG_STRAFE);
  if (strafe > 0) buchen(state, clubId, -strafe, 'sonstige', `Vertragsstrafe ${vertrag.firma}`);

  if (def.mehrfach) s.bande.splice(index, 1);
  else s[slot] = null;
  if (vertrag.dubios) s.dubiosMalus = Math.max(0, s.dubiosMalus - 1);
  s.historie.push({ season: state.date.season, day: state.date.day, art: 'kuendigung', slot, firma: vertrag.firma, strafe });

  return {
    ok: true, strafe,
    text: strafe > 0
      ? `${vertrag.firma} ist Geschichte. Die Anwälte der Gegenseite kosten uns ${formatMoney(strafe)}.`
      : `${vertrag.firma} ist Geschichte. Immerhin ohne Vertragsstrafe.`
  };
}

/**
 * Nachverhandeln.
 * @param {object|number} forderung  { grundsumme, laufzeit } oder gewünschte Grundsumme
 * @returns {{ok:boolean, neuesAngebot:object|null, stimmung:number, text:string}}
 */
export function verhandeln(state, clubId, slot, angebot, forderung, rng) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, neuesAngebot: null, stimmung: 0, text: 'Unbekannter Verein.' };
  const s = sp(club);
  const a = typeof angebot === 'string' ? s.angebote.find(x => x.id === angebot) : angebot;
  if (!a) return { ok: false, neuesAngebot: null, stimmung: 0, text: 'Dieses Angebot existiert nicht mehr.' };

  const f = typeof forderung === 'number' ? { grundsumme: forderung } : (forderung || {});
  const wunsch = Math.max(a.grundsumme, Math.round(f.grundsumme || a.grundsumme));
  const wunschLaufzeit = f.laufzeit ? clamp(Math.round(f.laufzeit), 1, 6) : a.laufzeit;

  if (a.verhandlungsrunden >= VERHANDLUNG_MAX_RUNDEN) {
    return { ok: false, neuesAngebot: a, stimmung: a.stimmung, text: `${a.firma} verhandelt nicht weiter. "Das ist unser letztes Wort."` };
  }

  const gier = wunsch / Math.max(1, a.grundsumme);
  const skill = istManager(state, clubId) && state.manager && state.manager.skills
    ? (state.manager.skills.verhandlung || 45) : 50;
  const laufzeitBonus = wunschLaufzeit > a.laufzeit ? 0.08 : (wunschLaufzeit < a.laufzeit ? -0.06 : 0);

  const chance = clamp(
    1.12 - (gier - 1) * 2.6 + skill / 320 + (club.reputation || 50) / 900
    - a.verhandlungsrunden * 0.18 + laufzeitBonus,
    0.02, 0.94
  );

  a.verhandlungsrunden++;
  const wurf = rng.next();

  if (wurf < chance * 0.55) {
    // Volle Zustimmung
    a.grundsumme = wunsch;
    a.laufzeit = wunschLaufzeit;
    a.handgeld = Math.round(a.grundsumme * HANDGELD_ANTEIL);
    a.stimmung = clamp(a.stimmung - 5, 0, 100);
    return { ok: true, neuesAngebot: a, stimmung: a.stimmung, text: `${a.firma} geht mit: ${formatMoney(a.grundsumme)} pro Saison. Handschlag, fertig.` };
  }
  if (wurf < chance) {
    // Gegenangebot in der Mitte
    const neu = Math.round((a.grundsumme + wunsch) / 2 / 10000) * 10000;
    a.grundsumme = neu;
    a.laufzeit = wunschLaufzeit;
    a.handgeld = Math.round(neu * HANDGELD_ANTEIL);
    a.stimmung = clamp(a.stimmung - 10, 0, 100);
    return { ok: true, neuesAngebot: a, stimmung: a.stimmung, text: `${a.firma} bietet ${formatMoney(neu)} — "mehr gibt der Vorstand nicht her".` };
  }
  if (wurf > 0.90 + chance * 0.05 || gier > 1.9) {
    // Der Sponsor springt ab
    const idx = s.angebote.indexOf(a);
    if (idx >= 0) s.angebote.splice(idx, 1);
    return { ok: false, neuesAngebot: null, stimmung: 0, text: `${a.firma} legt auf. "Dann eben nicht." Das Angebot ist vom Tisch.` };
  }
  a.stimmung = clamp(a.stimmung - 18, 0, 100);
  return { ok: false, neuesAngebot: a, stimmung: a.stimmung, text: `${a.firma} lehnt ab und bleibt bei ${formatMoney(a.grundsumme)}. Die Stimmung ist merklich kühler.` };
}

/** @returns {{grund:number, boniMoeglich:number, gesamt:number, vertraege:Array}} */
export function sponsorEinnahmenProSaison(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { grund: 0, boniMoeglich: 0, gesamt: 0, vertraege: [] };
  const liste = vertraege(club);
  let grund = 0, boni = 0;
  for (const v of liste) {
    grund += v.grundsumme || 0;
    const b = v.boni || {};
    boni += (b.meister || 0) + (b.pokalsieg || 0) + (b.europacup || 0) +
      (b.klassenerhalt || 0) + ((b.platz && b.platz.betrag) || 0);
  }
  return {
    grund: Math.round(grund),
    boniMoeglich: Math.round(boni),
    gesamt: Math.round(grund + boni),
    vertraege: liste.map(v => ({
      slot: v.slot, firma: v.firma, grundsumme: v.grundsumme,
      bisSaison: v.bisSaison, seriositaet: v.seriositaet, dubios: v.dubios
    }))
  };
}

/**
 * Erfolgsboni auslösen.
 * @param {string} anlass 'meister'|'pokalsieg'|'europacup'|'platzierung'|'klassenerhalt'|'aufstieg'
 * @param {object} daten  z. B. { platz: 4, wettbewerb: 'cl' }
 */
export function bonusPruefen(state, clubId, anlass, daten = {}) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, summe: 0, details: [], text: 'Unbekannter Verein.' };
  const s = sp(club);
  const liste = vertraege(club);
  let summe = 0;
  const details = [];

  for (const v of liste) {
    const b = v.boni || {};
    let betrag = 0, grund = '';
    if (anlass === 'platzierung') {
      if (b.platz && daten.platz && daten.platz <= b.platz.bis) {
        betrag = b.platz.betrag; grund = `Platz ${daten.platz} (Bonus bis Platz ${b.platz.bis})`;
      }
    } else if (b[anlass]) {
      betrag = b[anlass];
      grund = { meister: 'Meisterschaft', pokalsieg: 'Pokalsieg', europacup: 'Europapokal', klassenerhalt: 'Klassenerhalt', aufstieg: 'Aufstieg' }[anlass] || anlass;
    }
    if (betrag > 0) {
      const key = `${v.id}:${anlass}:${state.date.season}`;
      if (s.boniErfuellt.some(e => e.key === key)) continue;
      buchen(state, clubId, betrag, 'sponsoren', `Bonus ${v.firma}: ${grund}`);
      v.bonusGezahlt = (v.bonusGezahlt || 0) + betrag;
      s.boniErfuellt.push({ key, season: state.date.season, firma: v.firma, anlass, betrag });
      summe += betrag;
      details.push({ firma: v.firma, slot: v.slot, betrag, grund });
    }
  }
  if (s.boniErfuellt.length > 60) s.boniErfuellt.splice(0, s.boniErfuellt.length - 60);

  return {
    ok: summe > 0, summe, details,
    text: summe > 0
      ? `Erfolgsboni der Sponsoren: ${formatMoney(summe)} von ${details.length} Partner${details.length === 1 ? '' : 'n'}.`
      : 'Kein Sponsor zahlt für diesen Anlass einen Bonus.'
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  TICK
 * ══════════════════════════════════════════════════════════════════════════ */

export function tickSponsoren(state, ctx) {
  const day = ctx && ctx.day !== undefined ? ctx.day : state.date.day;
  const weekday = ctx && ctx.weekday !== undefined ? ctx.weekday : (day + 1) % 7;
  const isWeekStart = ctx && ctx.isWeekStart !== undefined ? !!ctx.isWeekStart : weekday === 0;
  if (!isWeekStart) return;   // Sponsorengeschäft läuft im Wochenrhythmus

  const rng = ctx && ctx.rng ? ctx.rng : null;
  for (const clubId in state.clubs) {
    tickVerein(state, ctx, clubId, day, rng);
  }
}

function tickVerein(state, ctx, clubId, day, rngBasis) {
  const club = state.clubs[clubId];
  const s = sp(club);
  // Der Tag steckt bewusst im Fork-Label: fork() verändert den Zustand des
  // Basis-RNG nicht — ohne den Tag zöge jede Woche exakt dieselben Lose.
  const rng = rngBasis ? rngBasis.fork('sponsor:' + clubId + ':' + day) : null;

  // --- Lazy-Init: laufende Verträge nachtragen ---------------------------
  // Greift für neue Spielstände genauso wie für alte, in denen die Werbeplätze
  // noch leer stehen. core/state.js muss dafür nichts wissen.
  if (!s.gestartet) {
    const start = startSponsoren(state, clubId, rng);
    if (start.ok && start.vertraege.length && istManager(state, clubId)) {
      melde(state, ctx, clubId,
        `Zur Übersicht die laufenden Werbeverträge, die Sie geerbt haben:\n\n` +
        start.vertraege.map(v =>
          `• ${SPONSOR_SLOTS[v.slot].name}: ${v.firma} — ${formatMoney(v.grundsumme)} pro Saison, ` +
          `noch ${v.bisSaison - state.date.season + 1} ${v.bisSaison === state.date.season ? 'Saison' : 'Saisons'}`
        ).join('\n') +
        `\n\nZusammen ${formatMoney(start.summe)} pro Saison. ` +
        (s.aermel ? '' : 'Der Ärmel ist übrigens noch frei. ') +
        (s.stadion ? '' : 'Und das Stadion heißt noch, wie es immer hieß.'),
        'sponsor', { from: 'Marketingabteilung', subject: 'Unsere Werbepartner' });
    }
  }

  // --- Auszahlung der Grundsummen ---------------------------------------
  for (const v of vertraege(club)) {
    const rate = Math.round((v.grundsumme || 0) / SAISON_WOCHEN);
    if (rate > 0) {
      buchen(state, clubId, rate, 'sponsoren', `${v.firma} (${SPONSOR_SLOTS[v.slot] ? SPONSOR_SLOTS[v.slot].kurz : v.slot})`);
      v.gezahlt = (v.gezahlt || 0) + rate;
    }
  }

  // --- Auslaufende Verträge ---------------------------------------------
  for (const slot of ['trikot', 'aermel', 'ausruester', 'stadion']) {
    const v = s[slot];
    if (v && v.bisSaison < state.date.season) {
      s[slot] = null;
      if (v.dubios) s.dubiosMalus = Math.max(0, s.dubiosMalus - 1);
      s.historie.push({ season: state.date.season, day, art: 'auslauf', slot, firma: v.firma });
      const wartende = s.angebote.filter(a => a.slot === slot).length;
      melde(state, ctx, clubId,
        `Der Vertrag mit ${v.firma} (${SPONSOR_SLOTS[slot].name}) ist ausgelaufen. ` +
        `Der Werbeplatz ist frei — und ein leeres Trikot verdient kein Geld.` +
        (wartende ? `\n\n${wartende} Angebote aus der Vorsaison liegen noch auf dem Tisch. Lange nicht mehr.` : ''),
        'sponsor', { from: 'Marketingabteilung', subject: `${SPONSOR_SLOTS[slot].name} frei`, wichtig: true });
    }
  }
  for (let i = s.bande.length - 1; i >= 0; i--) {
    if (s.bande[i] && s.bande[i].bisSaison < state.date.season) {
      const v = s.bande.splice(i, 1)[0];
      s.historie.push({ season: state.date.season, day, art: 'auslauf', slot: 'bande', firma: v.firma });
    }
  }
  if (s.historie.length > 40) s.historie.splice(0, s.historie.length - 40);

  // --- Ablauf alter Angebote --------------------------------------------
  // Anschlussangebote überleben den Saisonwechsel: Sie zielen ja gerade auf den
  // Werbeplatz, der erst mit dem neuen Spieljahr frei wird.
  if (s.angebote.length) {
    s.angebote = s.angebote.filter(a => (a.erstelltSaison === state.date.season
      ? a.gueltigBis >= day
      : (a.anschluss && day <= ANSCHLUSS_FRIST)));
  }

  // --- Vorwarnung: Vertrag läuft in 30 Tagen aus, samt Anschlussangeboten ---
  if (day >= ABLAUF_WARN_TAG) {
    for (const v of vertraege(club)) {
      if (v.bisSaison !== state.date.season || v.ablaufGemeldet) continue;
      v.ablaufGemeldet = true;
      const def = SPONSOR_SLOTS[v.slot];
      if (!istManager(state, clubId) || !rng) continue;

      const neue = angeboteGenerieren(state, clubId, v.slot, rng, { anschluss: true })
        .filter(a => a.anschluss);
      const beste = neue.length ? sortBy(neue, a => ({ key: a.grundsumme, desc: true }))[0] : null;
      melde(state, ctx, clubId,
        `In gut vier Wochen endet der Vertrag mit ${v.firma} (${def.name}). ` +
        `Man sei "grundsätzlich offen" — im Klartext: Es wird teurer.\n\n` +
        (neue.length
          ? `Die Marketingabteilung hat vorgearbeitet. Das liegt für die neue Saison auf dem Tisch:\n` +
            neue.map(a => `• ${a.firma} (${a.branche}) — ${formatMoney(a.grundsumme)} pro Saison, ` +
              `${a.laufzeit} ${a.laufzeit === 1 ? 'Saison' : 'Saisons'}, Seriosität ${a.seriositaet}\n  ${a.spruch}`).join('\n') +
            `\n\nDas höchste Gebot kommt von ${beste.firma}. Unterschreiben können Sie, sobald der Platz frei ist.`
          : `Angebote liegen noch keine vor. Das kann heiter werden.`),
        'sponsor', {
          from: 'Marketingabteilung',
          subject: `${def.name}: ${v.firma} läuft aus`,
          wichtig: v.slot === 'trikot' || v.slot === 'ausruester'
        });
    }
  }

  // --- Neue Angebote ------------------------------------------------------
  const frei = freieSlots(club);
  if (!rng || !frei.length) return;

  for (const slot of frei) {
    const offen = s.angebote.filter(a => a.slot === slot).length;
    if (offen > 0) continue;
    if (!rng.chance(ANGEBOT_CHANCE_PRO_WOCHE)) continue;
    const neue = angeboteGenerieren(state, clubId, slot, rng);
    if (!neue.length) continue;

    if (istManager(state, clubId)) {
      const beste = sortBy(neue, a => ({ key: a.grundsumme, desc: true }))[0];
      melde(state, ctx, clubId,
        `${neue.length} Firmen interessieren sich für unseren ${SPONSOR_SLOTS[slot].name}.\n\n` +
        neue.map(a => `• ${a.firma} (${a.branche}) — ${formatMoney(a.grundsumme)} pro Saison, ` +
          `${a.laufzeit} ${a.laufzeit === 1 ? 'Saison' : 'Saisons'}, Seriosität ${a.seriositaet}\n  ${a.spruch}`).join('\n') +
        `\n\nDas höchste Gebot kommt von ${beste.firma}.`,
        'sponsor', { from: 'Marketingabteilung', subject: `Angebote für den ${SPONSOR_SLOTS[slot].kurz}`, wichtig: slot === 'trikot' });
    } else {
      // KI: nimmt das wirtschaftlich beste Angebot, meidet aber Schmuddelkram,
      // wenn die Fans ohnehin schon schlecht drauf sind.
      const platz = tabellenplatzVon(state, clubId);
      const moodEmpfindlich = (club.fans && club.fans.mood !== undefined ? club.fans.mood : 60) < 45;
      const kandidaten = neue.filter(a => !(moodEmpfindlich && a.dubios));
      const wahl = sortBy(kandidaten.length ? kandidaten : neue,
        a => ({ key: angebotswert(a, platz), desc: true }))[0];
      sponsorAnnehmen(state, clubId, slot, wahl);
    }
  }
}
