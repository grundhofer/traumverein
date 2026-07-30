/**
 * club/finances.js — Das Konto des Vereins.
 *
 * Zuständig für: Buchungen, Betriebskosten, Gehälter, Kredite, Dispo, Bilanz,
 * Prognose, TV-Geld, Prämien, Insolvenz. Reine Logik, kein DOM, kein Math.random(),
 * kein Date.now(). Alle Beträge in Euro.
 *
 * GRÖSSENORDNUNGEN (Zielbild laut Briefing, Saison-Umsatz):
 *   Bayern ~750 Mio · Mittelfeld Bundesliga 120–180 Mio · Heidenheim ~65 Mio ·
 *   Zweitligist 20–45 Mio. Verteilung: TV 40 %, Sponsoring 25 %, Spieltag 15 %,
 *   Merchandising 10 %, Transfers/Sonstiges 10 %. Gehälter 50–60 % vom Umsatz.
 *
 * Die TV-Gelder kommen unverändert aus data/leagues.js (prizeMoneyFor) und passen
 * exakt in dieses Bild: Platz 9 der 1. Liga = 60,3 Mio = 40 % von 150 Mio.
 *
 * GEHÄLTER: Die Lohnsumme entsteht nicht mehr allein aus Marktwert und Stärke.
 *   data/squads/_helper.js koppelt sie über `wirtschaftskraft()` an die Größe des
 *   Vereins — sonst zahlte Heidenheim Weltmarktgehälter bei Voith-Arena-Einnahmen
 *   (gemessen: 92 Mio Lohnsumme, Gehaltsquote 180 %). Gemessen wird das mit
 *   tools/test-wirtschaft.js; dort steht auch, welche Gehaltsquote die Fixkosten
 *   eines Vereins überhaupt tragen.
 */

import { clamp, round, formatMoney, dateFromDayIndex, sortBy } from '../core/util.js';
import { SEASON_DAYS } from '../core/constants.js';
import { LEAGUES, prizeMoneyFor, leagueOfClub } from '../data/leagues.js';
import { wirtschaftskraft, kostenSkala } from '../data/squads/_helper.js';

/* ══════════════════════════════════════════════════════════════════════════
 *  BALANCING-KONSTANTEN
 * ══════════════════════════════════════════════════════════════════════════ */

const SAISON_WOCHEN = 52;
const HEIMSPIELE_PRO_SAISON = 19;          // 17 Liga + Pokal/Testspiele

/* -- Betriebskosten (täglich) ------------------------------------------- *
 *
 * Dieselbe Frage wie bei den Gehältern, nur auf der Kostenseite: Ein Zweit-
 * ligist unterhält keine kleine Ausgabe eines Spitzenvereins, er unterhält
 * einen kleinen Verein. Geschäftsstelle und Verwaltung wachsen deshalb mit
 * derselben `wirtschaftskraft()` aus data/squads/_helper.js, die auch die
 * Gehaltsskala trägt (FC Bayern = 1).
 *
 * Vorher hingen diese Posten an flachen Pauschalen. Elversberg zahlte damit
 * 79 % seines Umsatzes für Fixkosten, der FC Bayern 13 % — beides falsch, und
 * zusammen ergaben sie genau die Schere, die tools/test-wirtschaft.js misst.
 */
const BETRIEB_FIX_PRO_TAG = 700;           // Geschäftsstelle, unabhängig von der Größe
const BETRIEB_PRO_MITGLIED = 0.05;         // Mitgliederbetreuung
const BETRIEB_KRAFT_PRO_TAG = 92000;       // Apparat des Bezugsvereins (Kraft = 1)
/* Die Liga zählt mit, wie schon beim Merchandising: Eine Geschäftsstelle in der
 * 2. Liga hat weniger Abteilungen, weniger Personal und weniger Reisen. Ohne
 * diesen Faktor bezahlte Lautern (49.780 Plätze, 43 Mio Umsatz) den Verwaltungs-
 * apparat eines Erstligisten — `wirtschaftskraft()` sieht nur das Stadion. */
const BETRIEB_LIGA = { bl1: 1.0, bl2: 0.62 };
const BETRIEB_LIGA_SONST = 0.45;
/* Der frühere Posten `cap * 0,28` je Tag entfällt: Den Stadionunterhalt bucht
 * club/stadium.js (betriebskostenJahr) bereits vollständig — er stand doppelt
 * in den Büchern und traf ausgerechnet Vereine mit großem Stadion in kleiner
 * Liga (Lautern, Hertha, Fortuna) doppelt hart. */

/* -- Trainerstab (Fallback, falls staff.js noch keine Gehälter liefert) --- */
const STAB_GEHALT_BASIS = 120000;
const STAB_GEHALT_PRO_REP = 9000;

/* -- Merchandising (monatlich) ------------------------------------------- */
const MERCH_REP_BASIS = 5000000;           // Jahreswert bei Reputation 50
const MERCH_REP_EXP = 3.0;
const MERCH_PRO_MITGLIED = 35;             // je Mitglied und Jahr
const MERCH_STIMMUNG_SPANNE = 0.25;        // Fanstimmung -> ±25 %
const MERCH_ERFOLG_SPANNE = 0.20;          // Tabellenplatz -> ±20 %

/* -- Abschreibungen (monatlich) ------------------------------------------ */
const ABSCHREIBUNG_PRO_PLATZ_JAHR = 45;
const ABSCHREIBUNG_ANLAGEN_JAHR = 900000;  // Trainingsgelände, Medizin, Jugend

/* -- TV-Geld ------------------------------------------------------------- */
const TV_VORSCHUSS_ANTEIL = 0.75;          // Anteil, der monatlich vorab fließt
const TV_VORSCHUSS_RATEN = 10;             // 10 Monatsabschläge (Aug–Mai)

/* -- Kredite & Dispo ----------------------------------------------------- */
const DISPO_ZINS = 0.115;                  // p. a. auf ein überzogenes Konto
const KREDIT_ZINS_BASIS = 0.042;
const KREDIT_ZINS_MAX = 0.155;
const KREDIT_MAX_UMSATZ_ANTEIL = 0.80;     // Gesamtschulden max. 80 % vom Jahresumsatz
const KREDIT_MIN = 250000;
const KREDIT_LAUFZEIT_MIN = 26;            // Wochen
const KREDIT_LAUFZEIT_MAX = 312;           // 6 Jahre
const ALTLAST_LAUFZEIT = 624;              // Altschulden aus data/clubs.js: 12 Jahre
const ALTLAST_ZINS = 0.055;

/* -- Vorstand & Insolvenz ------------------------------------------------ */
const NEGATIV_TAGE_WARNUNG = 21;
const NEGATIV_TAGE_SPERRE = 56;
const NEGATIV_TAGE_ZWANGSVERKAUF = 84;
const NEGATIV_TAGE_PUNKTABZUG = 140;
const PUNKTABZUG_HOEHE = 3;
const SCHULDENQUOTE_KRITISCH = 1.10;       // Schulden / Jahresumsatz
const ZWANGSVERKAUF_ZIEL_WOCHEN = 12;      // so viele Wochen Liquidität herstellen

/* -- Sanierungstarif (letzte Stufe, siehe sanierungPruefen) -------------- */
const SANIERUNG_NEGATIV_TAGE = 130;        // erst nach einem guten Vierteljahr im Minus
const SANIERUNG_KONTO_ANTEIL = 0.28;       // Konto unter −28 % vom Jahresumsatz
const SANIERUNG_GEHALTSSCHNITT = 0.22;     // so viel gibt die Mannschaft ab
const GEHALT_UNTERGRENZE = 60000;          // wie in data/squads/_helper.js

/* -- Budgets ------------------------------------------------------------- */
const GEHALTSBUDGET_UMSATZ_ANTEIL = 0.62;  // Obergrenze, die der Vorstand gutheißt
const TRANSFERBUDGET_MAX_ANTEIL = 0.85;    // vom frei verfügbaren Spielraum
/* Etat, den der Vorstand zu jeder neuen Saison freigibt. Ohne ihn wurde das
 * Transferbudget nur einmal beim Spielstart vergeben und danach ausgegeben —
 * ab Saison 2 stand der Markt still. */
const TRANSFERBUDGET_UMSATZ_ANTEIL = 0.06; // laufender Etat aus dem Umsatz
const TRANSFERBUDGET_KONTO_ANTEIL = 0.12;  // dazu ein Teil des Guthabens
const TRANSFERBUDGET_SCHULDEN_ABZUG = 0.15;
const TRANSFERBUDGET_DECKEL = 0.18;        // niemals mehr als ein Sechstel des Umsatzes

/* -- Ledger -------------------------------------------------------------- */
const LEDGER_MAX_MANAGER = 800;
const LEDGER_MAX_KI = 60;

/** Kategorien -> Feld in finances.saison (siehe emptyFinanceLine() in core/state.js). */
export const KATEGORIEN = {
  zuschauer:       { label: 'Zuschauereinnahmen', feld: 'einnahmenZuschauer', ein: true },
  tv:              { label: 'TV-Gelder', feld: 'einnahmenTv', ein: true },
  sponsoren:       { label: 'Sponsoren', feld: 'einnahmenSponsoren', ein: true },
  transfer:        { label: 'Transfererlöse', feld: 'einnahmenTransfer', ein: true, gegenFeld: 'ausgabenTransfer' },
  merch:           { label: 'Merchandising', feld: 'einnahmenMerch', ein: true },
  praemien:        { label: 'Prämien', feld: 'einnahmenPraemien', ein: true },
  sonstige:        { label: 'Sonstiges', feld: 'einnahmenSonstige', ein: true, gegenFeld: 'ausgabenSonstige' },
  gehaelter:       { label: 'Gehälter', feld: 'ausgabenGehaelter', ein: false },
  transferAusgabe: { label: 'Transferausgaben', feld: 'ausgabenTransfer', ein: false },
  stadion:         { label: 'Stadion', feld: 'ausgabenStadion', ein: false },
  stab:            { label: 'Trainerstab', feld: 'ausgabenStab', ein: false },
  jugend:          { label: 'Jugend', feld: 'ausgabenJugend', ein: false },
  betrieb:         { label: 'Betriebskosten', feld: 'ausgabenBetrieb', ein: false },
  zinsen:          { label: 'Zinsen', feld: 'ausgabenZinsen', ein: false }
};

const EINNAHME_FELDER = [
  ['einnahmenTv', 'TV-Gelder'], ['einnahmenSponsoren', 'Sponsoren'],
  ['einnahmenZuschauer', 'Zuschauer'], ['einnahmenMerch', 'Merchandising'],
  ['einnahmenTransfer', 'Transfererlöse'], ['einnahmenPraemien', 'Prämien'],
  ['einnahmenSonstige', 'Sonstiges']
];
const AUSGABE_FELDER = [
  ['ausgabenGehaelter', 'Spielergehälter'], ['ausgabenTransfer', 'Transfers'],
  ['ausgabenStab', 'Trainerstab'], ['ausgabenBetrieb', 'Betrieb'],
  ['ausgabenStadion', 'Stadion'], ['ausgabenJugend', 'Jugend'],
  ['ausgabenZinsen', 'Zinsen'], ['ausgabenSonstige', 'Sonstiges']
];

/* ══════════════════════════════════════════════════════════════════════════
 *  Interne Helfer
 * ══════════════════════════════════════════════════════════════════════════ */

/** Spiegelt emptyFinanceLine() aus core/state.js (bewusst ohne Import: club/* bleibt eigenständig testbar). */
function leereFinanzzeile() {
  return {
    einnahmenZuschauer: 0, einnahmenTv: 0, einnahmenSponsoren: 0, einnahmenTransfer: 0,
    einnahmenMerch: 0, einnahmenPraemien: 0, einnahmenSonstige: 0,
    ausgabenGehaelter: 0, ausgabenTransfer: 0, ausgabenStadion: 0, ausgabenStab: 0,
    ausgabenJugend: 0, ausgabenBetrieb: 0, ausgabenZinsen: 0, ausgabenSonstige: 0
  };
}

/** Stellt sicher, dass alle Finanzfelder existieren (Lazy-Init, siehe Projektregeln). */
function fin(club) {
  const f = club.finances || (club.finances = {});
  if (typeof f.balance !== 'number') f.balance = 0;
  if (typeof f.debt !== 'number') f.debt = 0;
  if (!Array.isArray(f.ledger)) f.ledger = [];
  if (!f.saison) f.saison = leereFinanzzeile();
  if (f.letzteSaison === undefined) f.letzteSaison = null;
  if (!Array.isArray(f.kredite)) f.kredite = [];
  if (typeof f.negativTage !== 'number') f.negativTage = 0;
  if (typeof f.gebuchtGesamt !== 'number') f.gebuchtGesamt = 0;
  if (typeof f.ledgerGekuerzt !== 'number') f.ledgerGekuerzt = 0;
  if (typeof f.tvVorschussGezahlt !== 'number') f.tvVorschussGezahlt = 0;
  if (typeof f.tvVorschussRaten !== 'number') f.tvVorschussRaten = 0;
  if (typeof f.transfersperre !== 'boolean') f.transfersperre = false;
  if (typeof f.punktabzug !== 'number') f.punktabzug = 0;
  if (!f.zwangsverkauf) f.zwangsverkauf = null;
  if (typeof f.warnstufe !== 'number') f.warnstufe = 0;
  if (!Array.isArray(f.historie)) f.historie = [];   // [{ season, umsatz, ergebnis, balance }]
  if (typeof f.transferBudget !== 'number') f.transferBudget = 0;
  if (typeof f.wageBudget !== 'number') f.wageBudget = 0;
  if (typeof f.sanierungSaison !== 'number') f.sanierungSaison = 0;   // siehe sanierungPruefen
  return f;
}

const clubOf = (state, clubId) => state.clubs[clubId];
const istManager = (state, clubId) => state.managerClubId === clubId;

/** Postfach nur für den Verein des Spielers. */
function melde(state, ctx, clubId, text, kind = 'finanzen', opts = null) {
  if (!ctx || !ctx.log || !istManager(state, clubId)) return;
  ctx.log(text, kind, opts);
}

function meldeTicker(state, ctx, clubId, text, kind = 'finanzen') {
  if (!ctx || !ctx.news || !istManager(state, clubId)) return;
  ctx.news(text, kind);
}

/** 0 = Mo … 6 = So (dayIndex 0 ist ein Dienstag, vgl. data/leagues.js). */
function wochentag(day) { return (day + 1) % 7; }

function tagInfo(state, ctx) {
  const day = ctx && ctx.day !== undefined ? ctx.day : state.date.day;
  const season = ctx && ctx.season !== undefined ? ctx.season : state.date.season;
  const wt = ctx && ctx.weekday !== undefined ? ctx.weekday : wochentag(day);
  const datum = dateFromDayIndex(day, season, state.date.startYear || 2025);
  return {
    day, season, weekday: wt,
    isWeekStart: ctx && ctx.isWeekStart !== undefined ? !!ctx.isWeekStart : wt === 0,
    isMonthStart: ctx && ctx.isMonthStart !== undefined ? !!ctx.isMonthStart : datum.day === 1,
    isSeasonEnd: ctx && ctx.isSeasonEnd !== undefined ? !!ctx.isSeasonEnd : day >= SEASON_DAYS - 1,
    datum
  };
}

/** Summe der Jahresgehälter aller Profis (ohne Jugend – die steckt in club.youth). */
export function gehaltssumme(state, clubId) {
  const club = clubOf(state, clubId);
  if (!club) return 0;
  let s = 0;
  for (const id of club.playerIds || []) {
    const p = state.players[id];
    if (!p || !p.contract) continue;
    if (p.transfer && p.transfer.leihe && p.transfer.leihe.gehaltZahltGegner) continue;
    s += p.contract.salary || 0;
  }
  return s;
}

/** Summe der Stabsgehälter; Fallback, solange staff.js keine Gehälter setzt. */
export function stabsumme(state, clubId) {
  const club = clubOf(state, clubId);
  if (!club) return 0;
  const ids = club.staffIds || [];
  let s = 0, gefunden = 0;
  for (const id of ids) {
    const m = state.staff && state.staff[id];
    if (!m) continue;
    const g = m.salary !== undefined ? m.salary : (m.gehalt !== undefined ? m.gehalt : null);
    if (g !== null) { s += g; gefunden++; }
  }
  if (gefunden === ids.length && gefunden > 0) return s;
  const rep = club.reputation || 50;
  const fehlend = Math.max(0, ids.length - gefunden) || 7;
  return s + fehlend * (STAB_GEHALT_BASIS + rep * STAB_GEHALT_PRO_REP);
}

/** Tabellenplatz aus state.tables, sonst Schätzung über die Reputation. */
export function tabellenplatz(state, clubId) {
  const club = clubOf(state, clubId);
  if (!club) return 10;
  const ligaId = club.leagueId || leagueOfClub(clubId);
  const liga = LEAGUES[ligaId];
  if (!liga) return 10;
  const tabelle = state.tables && state.tables[ligaId];
  if (Array.isArray(tabelle) && tabelle.length) {
    for (let i = 0; i < tabelle.length; i++) {
      const z = tabelle[i];
      if (z && z.clubId === clubId) return z.platz || (i + 1);
    }
  }
  // Kein Spiel gespielt: Rangfolge nach Reputation.
  const rang = sortBy(liga.clubIds.map(id => ({
    id, rep: (state.clubs[id] && state.clubs[id].reputation) || 50
  })), c => ({ key: c.rep, desc: true })).findIndex(c => c.id === clubId);
  return rang >= 0 ? rang + 1 : Math.round(liga.clubIds.length / 2);
}

/** Erwartetes TV-Geld dieser Saison (Grundlage für die Monatsabschläge). */
function tvErwartung(state, clubId) {
  const club = clubOf(state, clubId);
  const ligaId = club.leagueId || leagueOfClub(clubId);
  if (!LEAGUES[ligaId]) return 0;
  return prizeMoneyFor(ligaId, tabellenplatz(state, clubId));
}

/** Merchandising-Jahresumsatz. */
export function merchandisingJahr(state, clubId) {
  const club = clubOf(state, clubId);
  const rep = club.reputation || 50;
  const fans = club.fans || club.fanbase || {};
  const mitglieder = fans.members || 5000;
  const stimmung = clamp(fans.mood !== undefined ? fans.mood : 60, 0, 100);
  const basis = MERCH_REP_BASIS * Math.pow(rep / 50, MERCH_REP_EXP) + mitglieder * MERCH_PRO_MITGLIED;
  const fStimmung = 1 + (stimmung - 60) / 40 * MERCH_STIMMUNG_SPANNE;
  const ligaId = club.leagueId || leagueOfClub(clubId) || 'bl2';
  const n = (LEAGUES[ligaId] && LEAGUES[ligaId].clubIds.length) || 18;
  const platz = tabellenplatz(state, clubId);
  const fErfolg = 1 + ((n - platz) / (n - 1) - 0.5) * 2 * MERCH_ERFOLG_SPANNE;
  const fLiga = ligaId === 'bl1' ? 1 : 0.55;
  return Math.max(0, basis * fStimmung * fErfolg * fLiga);
}

/** Grobe Schätzung der Zuschauereinnahmen einer Saison (stadium.js bucht die echten). */
function zuschauerSchaetzung(state, clubId) {
  const club = clubOf(state, clubId);
  const st = club.stadium || { capacity: 20000, standing: 0.25 };
  const preise = (club.stadiumState && club.stadiumState.preise) || {};
  const sitz = preise.sitz || (club.finances && club.finances.ticketBase) || 20;
  const steh = preise.steh || Math.round(sitz * 0.45);
  const steAnteil = clamp(st.standing || 0.25, 0, 0.4);
  const schnitt = sitz * (1 - steAnteil) + steh * steAnteil;
  const auslastung = clamp(
    (club.stadiumState && club.stadiumState.auslastungSchnitt) || (0.62 + (club.reputation || 50) / 400),
    0.35, 1
  );
  // +18 % für VIP, Catering und Parkplätze
  return st.capacity * auslastung * schnitt * 1.18 * HEIMSPIELE_PRO_SAISON;
}

/** Sponsorengrundsummen aus club.sponsors (ohne Boni) – sponsors.js pflegt die Verträge. */
function sponsorGrundsummen(club) {
  const sp = club.sponsors || {};
  let s = 0;
  for (const slot of ['trikot', 'aermel', 'ausruester', 'stadion']) {
    if (sp[slot] && sp[slot].grundsumme) s += sp[slot].grundsumme;
  }
  if (Array.isArray(sp.bande)) for (const v of sp.bande) if (v && v.grundsumme) s += v.grundsumme;
  return s;
}

/**
 * Struktureller Jahresumsatz – Bezugsgröße für Budgets, Kreditrahmen und Insolvenz.
 * Bewusst OHNE Transfererlöse: davon darf kein Verein dauerhaft leben.
 *
 * Solange keine Bücher vorliegen, wird geschätzt. Sobald eine Saison abge-
 * schlossen ist, zählt die echte Abrechnung — die Schätzung kennt weder das
 * Catering am Spieltag (stadium.js bucht es unter Merchandising) noch Prämien
 * und lag beim FC Bayern um die Hälfte daneben (260 statt 516 Mio). Aus dieser
 * zu kleinen Bezugsgröße kamen Gehaltsetats unterhalb der eigenen Lohnsumme:
 * Ab der zweiten Saison hatte kein großer Verein mehr Luft für einen Transfer,
 * und der Transfermarkt fiel von 102 auf 2 Wechsel pro Saison.
 *
 * Das TV-Geld wird dabei neu angesetzt statt fortgeschrieben — sonst plante ein
 * Absteiger mit Bundesligageldern weiter.
 */
export function umsatzSchaetzung(state, clubId) {
  const club = clubOf(state, clubId);
  if (!club) return 0;
  const tv = tvErwartung(state, clubId);
  const letzte = club.finances && club.finances.letzteSaison;
  if (letzte) {
    let gebucht = 0;
    for (const [k] of EINNAHME_FELDER) {
      if (k === 'einnahmenTransfer' || k === 'einnahmenTv') continue;
      gebucht += letzte[k] || 0;
    }
    if (gebucht > 0) return gebucht + tv;
  }
  const sponsoren = sponsorGrundsummen(club) || tv * 0.55;   // Fallback vor dem ersten Sponsor
  const merch = merchandisingJahr(state, clubId);
  const zuschauer = zuschauerSchaetzung(state, clubId);
  return tv + sponsoren + merch + zuschauer;
}

/** Betriebskosten pro Tag. */
function betriebProTag(club) {
  const fans = club.fans || club.fanbase || {};
  const liga = club.leagueId || leagueOfClub(club.id);
  const fLiga = BETRIEB_LIGA[liga] !== undefined ? BETRIEB_LIGA[liga] : BETRIEB_LIGA_SONST;
  return BETRIEB_FIX_PRO_TAG
    + (fans.members || 3000) * BETRIEB_PRO_MITGLIED
    + BETRIEB_KRAFT_PRO_TAG * wirtschaftskraft(club) * fLiga;
}

/** Abschreibungen pro Monat. */
function abschreibungProMonat(club) {
  const cap = (club.stadium && club.stadium.capacity) || 15000;
  const fac = club.facilities || {};
  const anlagen = ((fac.training || 50) + (fac.medical || 50) + (fac.youth || 50) + (fac.scouting || 50)) / 200;
  // Trainingsgelände, Medizin und Jugend eines Zweitligisten sind nicht nur
  // schlechter, sondern auch kleiner — der Buchwert wächst mit dem Verein.
  return (cap * ABSCHREIBUNG_PRO_PLATZ_JAHR + ABSCHREIBUNG_ANLAGEN_JAHR * anlagen * kostenSkala(club)) / 12;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  BUCHEN — zentrale Buchungsfunktion
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Verbucht einen Betrag auf dem Vereinskonto.
 * @param {number} betrag  > 0 = Einnahme, < 0 = Ausgabe
 * @param {string} kategorie  Schlüssel aus KATEGORIEN
 * @returns {{ok:boolean, text:string, balance:number, betrag:number}}
 */
export function buchen(state, clubId, betrag, kategorie, text = '') {
  const club = clubOf(state, clubId);
  if (!club) return { ok: false, text: 'Unbekannter Verein.', balance: 0, betrag: 0 };
  const kat = KATEGORIEN[kategorie];
  if (!kat) return { ok: false, text: `Unbekannte Buchungskategorie "${kategorie}".`, balance: fin(club).balance, betrag: 0 };

  const b = Math.round(betrag || 0);
  const f = fin(club);
  if (b === 0) return { ok: true, text: 'Nullbuchung.', balance: f.balance, betrag: 0 };

  f.balance = Math.round(f.balance + b);
  f.gebuchtGesamt = Math.round(f.gebuchtGesamt + b);

  const zeile = f.saison;
  if (kat.ein) {
    if (b >= 0) zeile[kat.feld] += b;
    else if (kat.gegenFeld) zeile[kat.gegenFeld] += -b;
    else zeile[kat.feld] += b;
  } else {
    zeile[kat.feld] += -b;
  }

  const eintrag = {
    day: state.date.day, season: state.date.season,
    betrag: b, kategorie, text: text || kat.label
  };
  f.ledger.push(eintrag);
  const max = istManager(state, clubId) ? LEDGER_MAX_MANAGER : LEDGER_MAX_KI;
  if (f.ledger.length > max) {
    const weg = f.ledger.splice(0, f.ledger.length - max);
    for (const e of weg) f.ledgerGekuerzt += e.betrag;
  }

  return { ok: true, text: `${b > 0 ? 'Einnahme' : 'Ausgabe'}: ${formatMoney(Math.abs(b))} (${kat.label})`, balance: f.balance, betrag: b };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  TICK
 * ══════════════════════════════════════════════════════════════════════════ */

export function tickFinanzen(state, ctx) {
  const t = tagInfo(state, ctx);
  for (const clubId in state.clubs) {
    tickVerein(state, ctx, clubId, t);
  }
}

function tickVerein(state, ctx, clubId, t) {
  const club = clubOf(state, clubId);
  const f = fin(club);

  // --- Saisonwechsel / Erstinitialisierung -------------------------------
  if (f.abrechnungSaison === undefined) {
    f.abrechnungSaison = t.season;
    altlastenVerbuchen(state, clubId);
    if (!f.wageBudget) f.wageBudget = Math.round(gehaltssumme(state, clubId) * 1.12);
  } else if (t.season > f.abrechnungSaison) {
    saisonAbschluss(state, ctx, clubId, t);
  }

  // --- Täglich: Betriebskosten -------------------------------------------
  buchen(state, clubId, -Math.round(betriebProTag(club)), 'betrieb', 'Laufender Betrieb');

  // --- Täglich: Dispozinsen ----------------------------------------------
  if (f.balance < 0) {
    const zins = Math.round(-f.balance * DISPO_ZINS / 365);
    if (zins > 0) buchen(state, clubId, -zins, 'zinsen', 'Dispozinsen');
    f.negativTage++;
  } else if (f.negativTage > 0) {
    f.negativTage = Math.max(0, f.negativTage - 2);
  }

  // --- Wöchentlich (Montag): Gehälter, Stab, Kreditraten ------------------
  if (t.isWeekStart) {
    const spieler = Math.round(gehaltssumme(state, clubId) / SAISON_WOCHEN);
    if (spieler > 0) buchen(state, clubId, -spieler, 'gehaelter', 'Spielergehälter (Woche)');
    const stab = Math.round(stabsumme(state, clubId) / SAISON_WOCHEN);
    if (stab > 0) buchen(state, clubId, -stab, 'stab', 'Gehälter Trainerstab');
    kreditratenZahlen(state, ctx, clubId);
    ueberwachung(state, ctx, clubId, t);
  }

  // --- Monatlich: Merchandising, Abschreibungen, TV-Abschlag -------------
  if (t.isMonthStart) {
    const merch = Math.round(merchandisingJahr(state, clubId) / 12);
    if (merch > 0) buchen(state, clubId, merch, 'merch', 'Merchandising & Fanartikel');
    const ab = Math.round(abschreibungProMonat(club));
    if (ab > 0) buchen(state, clubId, -ab, 'sonstige', 'Abschreibungen');
    tvAbschlag(state, ctx, clubId, t);
  }
}

/** Altschulden aus data/clubs.js werden zu einem regulär bedienten Darlehen. */
function altlastenVerbuchen(state, clubId) {
  const club = clubOf(state, clubId);
  const f = fin(club);
  const alt = f.debt || 0;
  if (alt <= 0 || f.kredite.length > 0) { f.debt = summeSchulden(f); return; }
  f.kredite.push({
    id: `kredit_altlast_${clubId}`,
    bank: 'Hausbank (Altlast)',
    betrag: alt, restschuld: alt,
    zinsSatz: ALTLAST_ZINS,
    laufzeitWochen: ALTLAST_LAUFZEIT,
    restWochen: ALTLAST_LAUFZEIT,
    rateProWoche: Math.round(alt / ALTLAST_LAUFZEIT),
    aufgenommen: { season: state.date.season, day: state.date.day },
    altlast: true
  });
  f.debt = summeSchulden(f);
}

function summeSchulden(f) {
  let s = 0;
  for (const k of f.kredite) s += Math.max(0, k.restschuld);
  return Math.round(s);
}

function kreditratenZahlen(state, ctx, clubId) {
  const f = fin(clubOf(state, clubId));
  if (!f.kredite.length) return;
  const erledigt = [];
  for (const k of f.kredite) {
    if (k.restschuld <= 0) { erledigt.push(k); continue; }
    const zins = Math.round(k.restschuld * k.zinsSatz / SAISON_WOCHEN);
    const tilgung = Math.min(k.restschuld, Math.max(0, Math.round(k.rateProWoche)));
    if (zins > 0) buchen(state, clubId, -zins, 'zinsen', `Kreditzinsen ${k.bank}`);
    if (tilgung > 0) {
      buchen(state, clubId, -tilgung, 'sonstige', `Kredittilgung ${k.bank}`);
      k.restschuld = Math.max(0, k.restschuld - tilgung);
    }
    k.restWochen = Math.max(0, (k.restWochen || 0) - 1);
    if (k.restschuld <= 0) erledigt.push(k);
  }
  for (const k of erledigt) {
    const i = f.kredite.indexOf(k);
    if (i >= 0) f.kredite.splice(i, 1);
    if (!k.altlast) {
      melde(state, ctx, clubId,
        `Der Kredit über ${formatMoney(k.betrag)} bei der ${k.bank} ist abbezahlt. ` +
        `Die Bank schickt einen Blumenstrauß, wir schicken eine Rechnung für die Vase.`,
        'finanzen', { from: 'Schatzmeister', subject: 'Kredit getilgt' });
    }
  }
  f.debt = summeSchulden(f);
}

/** Monatlicher TV-Abschlag auf Basis der erwarteten Platzierung. */
function tvAbschlag(state, ctx, clubId, t) {
  const f = fin(clubOf(state, clubId));
  if (f.tvVorschussRaten >= TV_VORSCHUSS_RATEN) return;
  // Erst ab August (dayIndex >= 31), damit im Juli keine Abschläge fließen.
  if (t.day < 31) return;
  const erwartet = tvErwartung(state, clubId);
  if (erwartet <= 0) return;
  const rate = Math.round(erwartet * TV_VORSCHUSS_ANTEIL / TV_VORSCHUSS_RATEN);
  buchen(state, clubId, rate, 'tv', 'TV-Abschlag (Monatsrate)');
  f.tvVorschussGezahlt += rate;
  f.tvVorschussRaten++;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Saisonabschluss
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Transferetat, den der Vorstand zu Saisonbeginn freigibt: ein Anteil vom
 * Umsatz, ein Teil des Guthabens, abzüglich der Schulden — und gedeckelt, damit
 * ein reicher Verein nicht mit einem halben Jahresumsatz einkaufen geht.
 */
function etatVorschlag(state, clubId) {
  const f = fin(clubOf(state, clubId));
  const umsatz = Math.max(0, umsatzSchaetzung(state, clubId));
  const roh = umsatz * TRANSFERBUDGET_UMSATZ_ANTEIL
    + Math.max(0, f.balance) * TRANSFERBUDGET_KONTO_ANTEIL
    - summeSchulden(f) * TRANSFERBUDGET_SCHULDEN_ABZUG;
  return Math.max(0, Math.round(Math.min(roh, umsatz * TRANSFERBUDGET_DECKEL) / 100000) * 100000);
}

function saisonAbschluss(state, ctx, clubId, t) {
  const club = clubOf(state, clubId);
  const f = fin(club);
  const alt = f.saison;
  const ein = EINNAHME_FELDER.reduce((s, [k]) => s + (alt[k] || 0), 0);
  const aus = AUSGABE_FELDER.reduce((s, [k]) => s + (alt[k] || 0), 0);
  f.letzteSaison = alt;
  f.historie.push({ season: f.abrechnungSaison, umsatz: Math.round(ein), aufwand: Math.round(aus), ergebnis: Math.round(ein - aus), balance: f.balance });
  if (f.historie.length > 30) f.historie.shift();
  f.saison = leereFinanzzeile();
  f.abrechnungSaison = t.season;
  f.tvVorschussGezahlt = 0;
  f.tvVorschussRaten = 0;
  f.punktabzug = 0;
  f.wageBudget = Math.round(umsatzSchaetzung(state, clubId) * GEHALTSBUDGET_UMSATZ_ANTEIL);
  f.transferBudget = etatVorschlag(state, clubId);

  melde(state, ctx, clubId,
    `Die Bücher der abgelaufenen Saison sind geschlossen.\n\n` +
    `Umsatz: ${formatMoney(ein)}\nAufwand: ${formatMoney(aus)}\n` +
    `Ergebnis: ${formatMoney(ein - aus)}\nKontostand: ${formatMoney(f.balance)}\n\n` +
    (ein - aus >= 0
      ? 'Der Steuerberater lächelt. Das kommt selten vor.'
      : 'Der Steuerberater hat sich krankgemeldet. Verständlich.'),
    'finanzen', { from: 'Schatzmeister', subject: 'Jahresabschluss', wichtig: true });
}

/**
 * TV-Geld-Ausschüttung am Saisonende.
 * @param {Array} tabelle  Tabellenzeilen (sortiert oder mit .platz), aus computeTable()
 * @returns {{ok:boolean, text:string, zahlungen:Array}}
 */
export function tvGeldAusschuetten(state, leagueId, tabelle) {
  const liga = LEAGUES[leagueId];
  if (!liga) return { ok: false, text: 'Unbekannte Liga.', zahlungen: [] };
  const zeilen = Array.isArray(tabelle) && tabelle.length
    ? tabelle
    : liga.clubIds.map((id, i) => ({ clubId: id, platz: i + 1 }));

  const zahlungen = [];
  zeilen.forEach((z, i) => {
    const clubId = z.clubId || z.id;
    const club = clubOf(state, clubId);
    if (!club) return;
    const platz = z.platz || (i + 1);
    const gesamt = prizeMoneyFor(leagueId, platz);
    const f = fin(club);
    const rest = Math.round(gesamt - f.tvVorschussGezahlt);
    if (rest !== 0) {
      buchen(state, clubId, rest, 'tv',
        `TV-Schlussabrechnung (Platz ${platz}, ${liga.short})`);
    }
    f.tvVorschussGezahlt = gesamt;
    zahlungen.push({ clubId, platz, gesamt, restzahlung: rest });
  });

  return {
    ok: true,
    zahlungen,
    text: `TV-Gelder der ${liga.name} ausgeschüttet: ${formatMoney(zahlungen.reduce((s, z) => s + z.gesamt, 0))} an ${zahlungen.length} Vereine.`
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Überwachung: Vorstand, Sperren, Insolvenz
 * ══════════════════════════════════════════════════════════════════════════ */

function ueberwachung(state, ctx, clubId, t) {
  const club = clubOf(state, clubId);
  const f = fin(club);
  const check = insolvenzCheck(state, clubId);

  // Transfersperre
  const sperreFaellig = f.negativTage >= NEGATIV_TAGE_SPERRE || check.gefahr >= 65;
  if (sperreFaellig && !f.transfersperre) {
    f.transfersperre = true;
    melde(state, ctx, clubId,
      `Die Liga hat uns wegen anhaltender Zahlungsprobleme eine Transfersperre erteilt. ` +
      `Bis das Konto wieder Luft hat, wird hier niemand mehr eingekauft.`,
      'finanzen', { from: 'Lizenzabteilung', subject: 'Transfersperre', wichtig: true });
    meldeTicker(state, ctx, clubId, `${club.shortName}: Transfersperre wegen finanzieller Schieflage.`, 'skandal');
  } else if (!sperreFaellig && f.transfersperre && f.balance > 0 && check.gefahr < 45) {
    f.transfersperre = false;
    melde(state, ctx, clubId, `Die Transfersperre ist aufgehoben. Man darf wieder Geld ausgeben — muss aber nicht.`,
      'finanzen', { from: 'Lizenzabteilung', subject: 'Transfersperre aufgehoben' });
  }

  // Zwangsverkäufe: transfers.js liest dieses Feld und verkauft entsprechend.
  if (f.negativTage >= NEGATIV_TAGE_ZWANGSVERKAUF || check.gefahr >= 80) {
    const wochenkosten = wochenSaldo(state, clubId).ausgaben;
    const ziel = Math.round(Math.max(0, -f.balance) + wochenkosten * ZWANGSVERKAUF_ZIEL_WOCHEN);
    if (!f.zwangsverkauf) {
      melde(state, ctx, clubId,
        `Der Aufsichtsrat hat entschieden: Es werden Spieler verkauft. Nicht die, die Sie loswerden ` +
        `wollen — die, für die es Geld gibt. Zielsumme: ${formatMoney(ziel)}.`,
        'vorstand', { from: club.board ? club.board.name : 'Der Vorstand', subject: 'Zwangsverkäufe angeordnet', wichtig: true });
    }
    f.zwangsverkauf = { aktiv: true, zielSumme: ziel, seitTag: t.day, season: t.season };
  } else if (f.zwangsverkauf && f.balance >= 0 && check.gefahr < 50) {
    f.zwangsverkauf = null;
  }

  // Punktabzug
  if (f.negativTage >= NEGATIV_TAGE_PUNKTABZUG && !f.punktabzugVerhaengt) {
    f.punktabzug = (f.punktabzug || 0) + PUNKTABZUG_HOEHE;
    f.punktabzugVerhaengt = true;
    melde(state, ctx, clubId,
      `Der Lizenzausschuss zieht uns ${PUNKTABZUG_HOEHE} Punkte ab. Begründung: "wirtschaftliche ` +
      `Unzuverlässigkeit". Man hätte es auch freundlicher formulieren können.`,
      'vorstand', { from: 'Lizenzausschuss', subject: `${PUNKTABZUG_HOEHE} Punkte Abzug`, wichtig: true });
    meldeTicker(state, ctx, clubId, `${club.shortName} werden ${PUNKTABZUG_HOEHE} Punkte abgezogen!`, 'skandal');
  }
  if (f.negativTage === 0) f.punktabzugVerhaengt = false;

  sanierungPruefen(state, ctx, clubId, t);

  // Vorstandsstimmung: board.js liest negativTage, wir stupsen die Zufriedenheit nur an.
  if (club.board) {
    if (f.negativTage >= NEGATIV_TAGE_WARNUNG) {
      club.board.zufriedenheit = clamp(club.board.zufriedenheit - (check.gefahr >= 70 ? 2 : 1), 0, 100);
    } else if (f.balance > umsatzSchaetzung(state, clubId) * 0.15 && club.board.zufriedenheit < 70) {
      club.board.zufriedenheit = clamp(club.board.zufriedenheit + 0.4, 0, 100);
    }
  }

  // Warnstufe fürs Postfach
  const stufe = check.gefahr >= 80 ? 3 : check.gefahr >= 55 ? 2 : check.gefahr >= 30 ? 1 : 0;
  if (stufe > f.warnstufe && stufe > 0) {
    melde(state, ctx, clubId, check.text + '\n\n' + (check.rat || ''),
      'finanzen', { from: 'Schatzmeister', subject: ['', 'Das Konto knirscht', 'Ernste Lage', 'Alarmstufe Rot'][stufe], wichtig: stufe >= 2 });
  }
  f.warnstufe = stufe;
}

/**
 * Die letzte Sprosse der Eskalationsleiter: der Sanierungstarif.
 *
 * Transfersperre, Zwangsverkäufe und Punktabzug bremsen einen Verein, sie
 * senken aber keine einzige Gehaltszahlung. Ein Verein wie Hertha BSC —
 * Olympiastadion, 78 Mio Altschulden, Zweitligaeinnahmen — schrieb deshalb
 * Jahr für Jahr dasselbe Minus, und weil Dispozinsen auf Dispozinsen kommen,
 * wurde es größer statt kleiner: gemessen −20 Mio, −42 Mio, −80 Mio Kontostand
 * nach drei Saisons (Seed 42).
 *
 * In Wirklichkeit endet das anders. Kommt die Lizenz in Gefahr, sitzen
 * Mannschaftsrat und Geschäftsführung zusammen und die Mannschaft verzichtet —
 * jeder Bundesligist, der in diese Lage kam, hat genau das getan. Höchstens
 * einmal je Saison, und erst, wenn der Verein seit über vier Monaten im Minus
 * steht und mehr als ein Viertel seines Jahresumsatzes überzogen hat.
 */
function sanierungPruefen(state, ctx, clubId, t) {
  const club = clubOf(state, clubId);
  const f = fin(club);
  if (f.negativTage < SANIERUNG_NEGATIV_TAGE) return;
  if (f.sanierungSaison === t.season) return;
  const umsatz = umsatzSchaetzung(state, clubId);
  if (umsatz <= 0 || f.balance > -umsatz * SANIERUNG_KONTO_ANTEIL) return;

  let vorher = 0, nachher = 0, betroffen = 0;
  for (const pid of club.playerIds || []) {
    const p = state.players[pid];
    if (!p || !p.contract) continue;
    const alt = p.contract.salary || 0;
    if (alt <= GEHALT_UNTERGRENZE) { vorher += alt; nachher += alt; continue; }
    const neu = Math.max(GEHALT_UNTERGRENZE, Math.round(alt * (1 - SANIERUNG_GEHALTSSCHNITT) / 10000) * 10000);
    p.contract.salary = neu;
    vorher += alt; nachher += neu; betroffen++;
    // Kein Freibier: Wer verzichtet, ist unzufriedener und schaut sich um.
    if (p.happiness) p.happiness.gehalt = clamp((p.happiness.gehalt || 60) - 22, 0, 100);
    p.morale = clamp((p.morale || 70) - 4, 0, 100);
  }
  if (!betroffen) return;
  f.sanierungSaison = t.season;

  melde(state, ctx, clubId,
    `Die Lizenzabteilung hat uns eine Auflage erteilt, und die Mannschaft hat sie akzeptiert: ` +
    `${Math.round(SANIERUNG_GEHALTSSCHNITT * 100)} % Gehaltsverzicht für alle.\n\n` +
    `Lohnsumme vorher ${formatMoney(vorher)}, jetzt ${formatMoney(nachher)}. ` +
    `Der Mannschaftsrat hat lange geschwiegen und dann unterschrieben. ` +
    `Begeisterung sieht anders aus — Insolvenz allerdings auch.`,
    'finanzen', { from: 'Geschäftsführung', subject: 'Sanierungstarif beschlossen', wichtig: true });
  meldeTicker(state, ctx, clubId,
    `${club.shortName}: Gehaltsverzicht beschlossen — die Mannschaft trägt die Sanierung mit.`, 'skandal');
}

/**
 * @returns {{gefahr:number, text:string, rat:string, schuldenquote:number, massnahmen:string[]}}
 */
export function insolvenzCheck(state, clubId) {
  const club = clubOf(state, clubId);
  if (!club) return { gefahr: 0, text: '', rat: '', schuldenquote: 0, massnahmen: [] };
  const f = fin(club);
  const umsatz = Math.max(1, umsatzSchaetzung(state, clubId));
  const schulden = summeSchulden(f) + Math.max(0, -f.balance);
  const quote = schulden / umsatz;
  const woche = wochenSaldo(state, clubId);
  const reichweite = woche.saldo < 0 ? f.balance / -woche.saldo : 99;  // Wochen bis zur Null

  let gefahr = 0;
  gefahr += clamp(quote / SCHULDENQUOTE_KRITISCH, 0, 1.2) * 45;
  gefahr += clamp(f.negativTage / NEGATIV_TAGE_PUNKTABZUG, 0, 1) * 35;
  if (reichweite < 26) gefahr += clamp((26 - reichweite) / 26, 0, 1) * 20;
  gefahr = Math.round(clamp(gefahr, 0, 100));

  const massnahmen = [];
  if (f.transfersperre) massnahmen.push('Transfersperre');
  if (f.zwangsverkauf && f.zwangsverkauf.aktiv) massnahmen.push('Zwangsverkäufe');
  if (f.punktabzug > 0) massnahmen.push(`${f.punktabzug} Punkte Abzug`);

  let text, rat;
  if (gefahr < 20) {
    text = `Die Kasse stimmt. Kontostand ${formatMoney(f.balance)}, Schulden ${formatMoney(schulden)}.`;
    rat = 'Weiter so — und bitte nicht übermütig werden.';
  } else if (gefahr < 45) {
    text = `Die Lage ist angespannt: ${formatMoney(schulden)} Schulden bei ${formatMoney(umsatz)} Jahresumsatz.`;
    rat = 'Ein Verkauf im richtigen Moment wäre kein Fehler.';
  } else if (gefahr < 70) {
    text = `Ernst. Wir stehen mit ${formatMoney(schulden)} in der Kreide, das Konto ist seit ${f.negativTage} Tagen im Minus.`;
    rat = 'Gehälter senken, Spieler verkaufen, Sponsoren melken. In dieser Reihenfolge.';
  } else if (gefahr < 88) {
    text = `Die Lizenzabteilung schaut uns auf die Finger. Schuldenquote ${round(quote * 100)} % vom Jahresumsatz.`;
    rat = 'Ohne Verkäufe droht der Punktabzug — und danach kommt die Lizenz dran.';
  } else {
    text = `Insolvenzgefahr. ${formatMoney(schulden)} Schulden, kein Land in Sicht.`;
    rat = 'Jetzt hilft nur noch verkaufen, was nicht niet- und nagelfest ist.';
  }
  return { gefahr, text, rat, schuldenquote: round(quote, 2), massnahmen, schulden, umsatz, reichweite: round(reichweite, 1) };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Auswertung: Bilanz, Prognose, Wochenbericht
 * ══════════════════════════════════════════════════════════════════════════ */

/** Wiederkehrender Wochensaldo (für Prognose, Insolvenzcheck und Bericht). */
export function wochenSaldo(state, clubId) {
  const club = clubOf(state, clubId);
  const f = fin(club);
  const posten = [];
  const tv = tvErwartung(state, clubId) / SAISON_WOCHEN;
  const sponsoren = sponsorGrundsummen(club) / SAISON_WOCHEN;
  const merch = merchandisingJahr(state, clubId) / SAISON_WOCHEN;
  const zuschauer = zuschauerSchaetzung(state, clubId) / SAISON_WOCHEN;
  const gehalt = gehaltssumme(state, clubId) / SAISON_WOCHEN;
  const stab = stabsumme(state, clubId) / SAISON_WOCHEN;
  const betrieb = betriebProTag(club) * 7;
  const abschreibung = abschreibungProMonat(club) * 12 / SAISON_WOCHEN;
  let kredit = 0, zinsen = 0;
  for (const k of f.kredite) {
    kredit += Math.min(k.restschuld, k.rateProWoche);
    zinsen += k.restschuld * k.zinsSatz / SAISON_WOCHEN;
  }
  if (f.balance < 0) zinsen += -f.balance * DISPO_ZINS / SAISON_WOCHEN;

  posten.push({ label: 'TV-Gelder', betrag: tv });
  posten.push({ label: 'Sponsoren', betrag: sponsoren });
  posten.push({ label: 'Zuschauer', betrag: zuschauer });
  posten.push({ label: 'Merchandising', betrag: merch });
  posten.push({ label: 'Spielergehälter', betrag: -gehalt });
  posten.push({ label: 'Trainerstab', betrag: -stab });
  posten.push({ label: 'Betrieb', betrag: -betrieb });
  posten.push({ label: 'Abschreibungen', betrag: -abschreibung });
  posten.push({ label: 'Kredite & Zinsen', betrag: -(kredit + zinsen) });

  const einnahmen = tv + sponsoren + merch + zuschauer;
  const ausgaben = gehalt + stab + betrieb + abschreibung + kredit + zinsen;
  return { einnahmen: Math.round(einnahmen), ausgaben: Math.round(ausgaben), saldo: Math.round(einnahmen - ausgaben), posten };
}

/**
 * Aufbereitete Saisonbilanz für die UI.
 * @param {object} opts { saison:'aktuell'|'letzte' }
 */
export function bilanz(state, clubId, opts = {}) {
  const club = clubOf(state, clubId);
  if (!club) return null;
  const f = fin(club);
  const quelle = opts.saison === 'letzte' && f.letzteSaison ? f.letzteSaison : f.saison;

  const einnahmen = EINNAHME_FELDER
    .map(([key, label]) => ({ key, label, betrag: Math.round(quelle[key] || 0) }))
    .filter(p => p.betrag !== 0);
  const ausgaben = AUSGABE_FELDER
    .map(([key, label]) => ({ key, label, betrag: Math.round(quelle[key] || 0) }))
    .filter(p => p.betrag !== 0);
  const summeEinnahmen = einnahmen.reduce((s, p) => s + p.betrag, 0);
  const summeAusgaben = ausgaben.reduce((s, p) => s + p.betrag, 0);
  const ergebnis = summeEinnahmen - summeAusgaben;
  const gehalt = gehaltssumme(state, clubId);
  const umsatz = Math.max(1, umsatzSchaetzung(state, clubId));

  for (const p of einnahmen) p.anteil = round(p.betrag / Math.max(1, summeEinnahmen) * 100, 1);
  for (const p of ausgaben) p.anteil = round(p.betrag / Math.max(1, summeAusgaben) * 100, 1);

  const gehaltsquote = round(gehalt / umsatz * 100, 1);
  return {
    clubId, saison: opts.saison === 'letzte' ? state.date.season - 1 : state.date.season,
    einnahmen, ausgaben, summeEinnahmen, summeAusgaben, ergebnis,
    balance: f.balance,
    schulden: summeSchulden(f),
    kredite: f.kredite.map(k => Object.assign({}, k)),
    gehaltssumme: gehalt,
    gehaltsquote,
    umsatzPrognose: Math.round(umsatz),
    negativTage: f.negativTage,
    transfersperre: f.transfersperre,
    punktabzug: f.punktabzug,
    historie: f.historie.slice(),
    bewertung: bewertungstext(ergebnis, f.balance, gehaltsquote)
  };
}

function bewertungstext(ergebnis, balance, gehaltsquote) {
  if (balance < 0 && gehaltsquote > 75) return 'Wir leben deutlich über unseren Verhältnissen. Das endet erfahrungsgemäß mit einem Umzug in die 2. Liga.';
  if (balance < 0) return 'Das Konto ist im Minus. Die Bank ruft schon nicht mehr an, sie schreibt.';
  if (gehaltsquote > 70) return 'Die Lohnsumme frisst uns auf. Ein, zwei gut bezahlte Herren dürften gerne wechseln.';
  if (ergebnis > 0 && gehaltsquote < 55) return 'Solide gewirtschaftet. Der Schatzmeister schläft wieder durch.';
  return 'Alles im Rahmen. Nichts, was ein Heimsieg nicht verbessern würde.';
}

/**
 * Kontostand-Prognose.
 * @returns {Array<{woche:number, stand:number, saldo:number}>}
 */
export function prognose(state, clubId, wochen = 12) {
  const club = clubOf(state, clubId);
  if (!club) return [];
  const f = fin(club);
  const w = wochenSaldo(state, clubId);
  const out = [];
  let stand = f.balance;
  const n = clamp(Math.round(wochen), 1, 104);
  for (let i = 1; i <= n; i++) {
    let saldo = w.saldo;
    if (stand < 0) saldo -= Math.round(-stand * DISPO_ZINS / SAISON_WOCHEN);
    stand = Math.round(stand + saldo);
    out.push({ woche: i, stand, saldo: Math.round(saldo) });
  }
  return out;
}

/** Deutscher Wochenbericht fürs Postfach. */
export function wochenbericht(state, clubId) {
  const club = clubOf(state, clubId);
  if (!club) return '';
  const f = fin(club);
  const w = wochenSaldo(state, clubId);
  const check = insolvenzCheck(state, clubId);
  const gb = gehaltsbudget(state, clubId);
  const p = prognose(state, clubId, 8);
  const inAchtWochen = p.length ? p[p.length - 1].stand : f.balance;

  const zeilen = [];
  zeilen.push(`Kontostand: ${formatMoney(f.balance)}${f.balance < 0 ? '  (überzogen)' : ''}`);
  zeilen.push(`Schulden: ${formatMoney(summeSchulden(f))}${f.kredite.length ? ` aus ${f.kredite.length} Darlehen` : ''}`);
  zeilen.push(`Wochensaldo: ${formatMoney(w.saldo)} (Einnahmen ${formatMoney(w.einnahmen)}, Ausgaben ${formatMoney(w.ausgaben)})`);
  zeilen.push(`Lohnsumme: ${formatMoney(gb.verbraucht)} von ${formatMoney(gb.budget)} — ${round(gb.auslastung, 0)} % ausgeschöpft`);
  zeilen.push(`In acht Wochen stünden wir bei ${formatMoney(inAchtWochen)}.`);
  zeilen.push('');
  zeilen.push(check.text);
  if (check.gefahr >= 30) zeilen.push(check.rat);
  if (check.massnahmen.length) zeilen.push(`Laufende Maßnahmen: ${check.massnahmen.join(', ')}.`);
  return zeilen.join('\n');
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Aktionen (von den Screens aufgerufen)
 * ══════════════════════════════════════════════════════════════════════════ */

/** Bonität 0..100 — je höher, desto billiger das Geld. */
export function bonitaet(state, clubId) {
  const club = clubOf(state, clubId);
  const f = fin(club);
  const umsatz = Math.max(1, umsatzSchaetzung(state, clubId));
  const quote = (summeSchulden(f) + Math.max(0, -f.balance)) / umsatz;
  let b = 50;
  b += ((club.reputation || 50) - 50) * 0.55;
  b += clamp(f.balance / umsatz, -0.5, 0.5) * 45;
  b -= clamp(quote, 0, 1.5) * 40;
  b -= clamp(f.negativTage / 30, 0, 4) * 5;
  return Math.round(clamp(b, 1, 100));
}

/** Maximal noch aufnehmbare Kreditsumme. */
export function kreditrahmen(state, clubId) {
  const f = fin(clubOf(state, clubId));
  const umsatz = umsatzSchaetzung(state, clubId);
  const bon = bonitaet(state, clubId);
  const max = umsatz * KREDIT_MAX_UMSATZ_ANTEIL * (0.45 + bon / 100 * 0.75);
  return Math.max(0, Math.round(max - summeSchulden(f)));
}

/**
 * Kredit aufnehmen.
 * @returns {{ok:boolean, text:string, kredit?:object, zinsSatz?:number}}
 */
export function kreditAufnehmen(state, clubId, betrag, laufzeitWochen = 104) {
  const club = clubOf(state, clubId);
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  const f = fin(club);
  const summe = Math.round(betrag || 0);
  const laufzeit = clamp(Math.round(laufzeitWochen || 104), KREDIT_LAUFZEIT_MIN, KREDIT_LAUFZEIT_MAX);

  if (summe < KREDIT_MIN) {
    return { ok: false, text: `Unter ${formatMoney(KREDIT_MIN)} macht die Bank den Schalter gar nicht erst auf.` };
  }
  const rahmen = kreditrahmen(state, clubId);
  if (summe > rahmen) {
    return { ok: false, text: `Die Bank bewilligt höchstens ${formatMoney(rahmen)}. Für mehr müssten Sie das Stadion mitbringen.` };
  }
  const bon = bonitaet(state, clubId);
  const zinsSatz = round(clamp(
    KREDIT_ZINS_MAX - (bon / 100) * (KREDIT_ZINS_MAX - KREDIT_ZINS_BASIS) + (laufzeit / KREDIT_LAUFZEIT_MAX) * 0.012,
    KREDIT_ZINS_BASIS, KREDIT_ZINS_MAX), 4);

  const kredit = {
    id: `kredit_${clubId}_${state.date.season}_${state.date.day}_${f.kredite.length}`,
    bank: bankname(bon),
    betrag: summe, restschuld: summe,
    zinsSatz, laufzeitWochen: laufzeit, restWochen: laufzeit,
    rateProWoche: Math.round(summe / laufzeit),
    aufgenommen: { season: state.date.season, day: state.date.day },
    altlast: false
  };
  f.kredite.push(kredit);
  buchen(state, clubId, summe, 'sonstige', `Kreditauszahlung ${kredit.bank}`);
  f.debt = summeSchulden(f);

  return {
    ok: true, kredit, zinsSatz,
    text: `${formatMoney(summe)} über ${laufzeit} Wochen zu ${round(zinsSatz * 100, 2)} % — ` +
      `Rate ${formatMoney(kredit.rateProWoche)} pro Woche plus Zinsen. Die ${kredit.bank} lässt grüßen.`
  };
}

function bankname(bon) {
  if (bon >= 78) return 'Landesbank';
  if (bon >= 58) return 'Sparkasse';
  if (bon >= 38) return 'Volksbank';
  if (bon >= 22) return 'Regionalbank';
  return 'Finanzierungsgesellschaft Mühlenweg';
}

/** Sondertilgung. */
export function kreditTilgen(state, clubId, kreditIndex, betrag) {
  const club = clubOf(state, clubId);
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  const f = fin(club);
  const k = f.kredite[kreditIndex];
  if (!k) return { ok: false, text: 'Diesen Kredit gibt es nicht.' };
  const wunsch = Math.round(betrag || 0);
  if (wunsch <= 0) return { ok: false, text: 'Für eine Sondertilgung braucht es einen Betrag über null.' };
  if (wunsch > f.balance) {
    return { ok: false, text: `So viel ist nicht auf dem Konto. Verfügbar: ${formatMoney(Math.max(0, f.balance))}.` };
  }
  const summe = Math.min(wunsch, k.restschuld);
  buchen(state, clubId, -summe, 'sonstige', `Sondertilgung ${k.bank}`);
  k.restschuld = Math.max(0, k.restschuld - summe);
  if (k.restschuld <= 0) f.kredite.splice(kreditIndex, 1);
  else k.rateProWoche = Math.round(k.restschuld / Math.max(1, k.restWochen));
  f.debt = summeSchulden(f);
  return {
    ok: true, restschuld: k.restschuld,
    text: k.restschuld <= 0
      ? `Kredit vollständig getilgt. Die ${k.bank} verliert einen guten Kunden.`
      : `${formatMoney(summe)} getilgt, es bleiben ${formatMoney(k.restschuld)}.`
  };
}

/** @returns {{verbraucht:number, budget:number, frei:number, auslastung:number, spieler:number, stab:number}} */
export function gehaltsbudget(state, clubId) {
  const club = clubOf(state, clubId);
  if (!club) return { verbraucht: 0, budget: 0, frei: 0, auslastung: 0, spieler: 0, stab: 0 };
  const f = fin(club);
  const spieler = gehaltssumme(state, clubId);
  const stab = stabsumme(state, clubId);
  const budget = Math.round(f.wageBudget || umsatzSchaetzung(state, clubId) * GEHALTSBUDGET_UMSATZ_ANTEIL);
  const verbraucht = Math.round(spieler);
  return {
    verbraucht, budget,
    frei: Math.round(budget - verbraucht),
    auslastung: round(verbraucht / Math.max(1, budget) * 100, 1),
    spieler: Math.round(spieler),
    stab: Math.round(stab)
  };
}

/** Transferbudget festlegen (durch den Vorstand gedeckelt). */
export function transferbudgetSetzen(state, clubId, betrag) {
  const club = clubOf(state, clubId);
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  const f = fin(club);
  const wunsch = Math.max(0, Math.round(betrag || 0));
  const spielraum = Math.max(0, Math.round((f.balance + kreditrahmen(state, clubId) * 0.5) * TRANSFERBUDGET_MAX_ANTEIL));
  if (wunsch > spielraum) {
    f.transferBudget = spielraum;
    return {
      ok: false, budget: spielraum,
      text: `Der Vorstand gibt maximal ${formatMoney(spielraum)} frei. Mehr wäre "unternehmerisch mutig" — so nennt man das, kurz bevor es schiefgeht.`
    };
  }
  f.transferBudget = wunsch;
  return { ok: true, budget: wunsch, text: `Transferbudget steht bei ${formatMoney(wunsch)}.` };
}

/** Standardprämien (je Spieler und Anlass, in Euro). */
export const PRAEMIEN_SAETZE = {
  sieg: 12000, unentschieden: 4000, pokalrunde: 25000, europapokalrunde: 40000,
  meisterschaft: 400000, pokalsieg: 220000, klassenerhalt: 90000, aufstieg: 160000
};

/**
 * Prämie an die Mannschaft auszahlen (Ausgabe, Kategorie 'gehaelter').
 * Ohne `betrag` wird der Satz aus PRAEMIEN_SAETZE × Kadergröße genommen.
 */
export function praemieZahlen(state, clubId, anlass, betrag) {
  const club = clubOf(state, clubId);
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  const kader = (club.playerIds || []).length || 24;
  const summe = Math.round(betrag !== undefined && betrag !== null
    ? Math.abs(betrag)
    : (PRAEMIEN_SAETZE[anlass] || 0) * Math.min(kader, 24));
  if (summe <= 0) return { ok: false, text: `Für "${anlass}" ist keine Prämie vorgesehen.` };
  const f = fin(club);
  buchen(state, clubId, -summe, 'gehaelter', `Prämie: ${anlass}`);
  return {
    ok: true, betrag: summe, balance: f.balance,
    text: `${formatMoney(summe)} Prämie ausgeschüttet (${anlass}). Die Mannschaft grinst, der Schatzmeister nicht.`
  };
}

/** Einnahme aus Wettbewerbsprämien (Pokal, Europapokal) verbuchen. */
export function praemieErhalten(state, clubId, anlass, betrag) {
  const summe = Math.round(Math.abs(betrag || 0));
  if (summe <= 0) return { ok: false, text: 'Kein Betrag.' };
  buchen(state, clubId, summe, 'praemien', anlass);
  return { ok: true, betrag: summe, text: `${formatMoney(summe)} Prämie gutgeschrieben (${anlass}).` };
}
