/**
 * club/medical.js — Lazarett, Reha, Fitness, Sperren.
 *
 * Zuständigkeitsbereich (CONTRACTS.md §11): Verletzungen, Reha, Fitness, Sperren.
 * Reine Logik, kein DOM, kein Math.random(), kein Date.now().
 *
 * ANBINDUNG AN DEN TAGESABLAUF
 *   tickMedizin(state, ctx)          — einmal pro Spieltag für ALLE Vereine.
 *   spielNachbereitung(state, clubId, einsaetze, ctx)
 *                                    — nach jedem Spiel (Belastung, Verletzungswürfe,
 *                                      Kartenauswertung). Wird das vergessen, holt
 *                                      tickMedizin es am Folgetag selbst nach, damit
 *                                      Fitness und Lazarett nie „einschlafen".
 *   verletzen(...) / karteVermerken(...) — direkte Haken für die Match-Engine.
 *
 * DATENHALTUNG
 *   player.injury    — { typ, name, art, schwere, ursache, tageGesamt, tageRest, … }
 *                      Nur dieses Modul schreibt hier hinein. `null` = fit.
 *   player.cards     — { yellow, red, ban, seasonYellow } aus core/state.js;
 *                      zusätzliche Sperrbuchhaltung wird lazy ergänzt.
 *   player.medizin   — lazy: Historie, Ausfalltage, Einsatzbelastung, Anfälligkeit.
 *   club.medizin     — lazy: Grippewelle, Kosten, Ausfalltage, Verarbeitungs-Cursor.
 *
 * BALANCING-ZIEL (Schwierigkeit 'profi')
 *   ca. 2–4 nennenswerte Ausfälle (≥ 7 Tage) je Verein und Saison, dazu ein paar
 *   Blessuren und eine Grippewelle im Winter. Kreuzbandrisse bleiben die absolute
 *   Ausnahme. Eine gute medizinische Abteilung senkt die Ausfalltage spürbar
 *   (Prävention ~1,8× und Heiltempo ~1,4× zwischen Katastrophen- und Spitzenklinik).
 */

import { INJURY_TYPES, DIFFICULTIES, WEATHER, POSITION_NAMES } from '../core/constants.js';
import { clamp, round, dateFromDayIndex, formatDate } from '../core/util.js';
import { createRng, hashString } from '../core/rng.js';
import { SAISON_TAGE, LEAGUES } from '../data/leagues.js';

/* ==========================================================================
 * 1. Balancing-Konstanten
 * ======================================================================== */

/** Grundrisiko einer Verletzung pro Spieleinsatz (90 Minuten, Normalspieler). */
const BASIS_RISIKO_SPIEL = 0.0052;
/** Grundrisiko pro Spieler und Trainingstag. */
const BASIS_RISIKO_TRAINING = 0.00011;
/** Risiko, dass ein Spieler außerhalb des Platzes etwas anstellt (pro Tag). */
const BASIS_RISIKO_PRIVAT = 0.000018;

/** Obergrenze für das ausgewiesene Einzelrisiko (nie „sicher verletzt"). */
const RISIKO_MAX = 0.28;

/** Fitness/Frische. */
const FITNESS_VERLUST_90MIN = 27;     // Punkte Fitness bei 90 Minuten Volllast
const FITNESS_REGEN_BASIS = 5.6;      // Punkte Regeneration pro Ruhetag
const FITNESS_REGEN_SPIELTAG = 0.35;  // Anteil der Regeneration an Spieltagen
const SCHAERFE_GEWINN_90MIN = 9;      // Spielpraxis pro vollem Spiel
const SCHAERFE_VERFALL = 0.42;        // Verfall pro Tag ohne Einsatz
const SCHAERFE_VERFALL_VERLETZT = 1.1;
const FITNESS_VERLETZT_BODEN = 42;    // dorthin sackt die Fitness im Lazarett
const FITNESS_ERSCHOEPFT = 28;        // darunter droht Erschöpfung

/** Reha. */
const HEIL_BASIS = 1.0;               // „Heiltage" pro Kalendertag
const RUECKSCHLAG_BASIS = 0.0055;     // Grundrisiko pro Rehatag
const RUECKSCHLAG_ANTEIL = [0.2, 0.55]; // Verlängerung als Anteil der Gesamtdauer

/** Medizinische Abteilung: Spannweite der Wirkung (Index 0 → 100). */
const MED_PRAEVENTION = [1.30, 0.72];   // Verletzungsrisiko-Faktor
const MED_HEILTEMPO = [0.88, 1.28];     // Heilgeschwindigkeit
const MED_DAUER = [1.13, 0.88];         // Erstprognose (Dauer der Verletzung)
const MED_RUECKSCHLAG = [1.5, 0.6];     // Rückschlagrisiko
const MED_SCHWERE = [1.12, 0.82];       // Gewicht schwerer Verletzungsarten

/** Gewichtung Anlagen vs. Personal für den Medizin-Index. */
const MED_ANTEIL_ANLAGE = 0.55;
const MED_ANTEIL_STAB = 0.45;

/** Belastungssteuerung. */
const BELASTUNG_FENSTER = 15;         // Tage
const BELASTUNG_SPIELE_WARNUNG = 4;   // ab so vielen Spielen im Fenster wird gewarnt
const BELASTUNG_RISIKO_PRO_SPIEL = 0.13; // Risikoaufschlag je Spiel über der Schwelle

/** Sperren. */
const GELB_SPERRE_SCHWELLE = 5;       // 5 Gelbe = 1 Spiel
const GELBROT_SPERRE = 1;
const ROT_SPERRE = [1, 3];            // je nach Schwere

/** Behandlungskosten (Euro). */
const KOSTEN = {
  konservativ: 0,
  intensiv: 2200,        // pro Rehatag
  operation: 48000,
  spezialist: 135000,
  spritze: 9000
};

/** Grippewelle: rund jede zweite Saison eine, dann liegen 3–5 Mann flach. */
const WELLE_CHANCE_WINTER = 0.0042;   // pro Verein und Tag im Winterfenster
const WELLE_CHANCE_SONST = 0.0002;
const WELLE_FENSTER = [140, 250];     // dayIndex: Ende November bis Anfang März
const WELLE_DAUER = [5, 12];
const WELLE_ANSTECKUNG = 0.016;       // pro Spieler und Tag während der Welle

/** Schmerzspritze. */
const SPRITZE_MAX_SCHWERE = 2;
const SPRITZE_MAX_TAGE = 12;
const SPRITZE_RISIKO_FAKTOR = 3.4;
const SPRITZE_FOLGE_DAUER = 1.65;

/** Langzeitschaden. */
const LANGZEIT_AB_SCHWERE = 4;
const LANGZEIT_GRUNDCHANCE = 0.34;

/* ==========================================================================
 * 2. Kataloge
 * ======================================================================== */

const TYP_BY_ID = Object.fromEntries(INJURY_TYPES.map(t => [t.id, t]));

/**
 * Auftrittsgewichte und Flair je Verletzungsart. Die Gewichte ergeben ca. 55 %
 * „nennenswerte" Ausfälle (≥ 7 Tage); Kreuzbandriss liegt bei 0,7 % aller Fälle.
 */
const KATALOG = {
  prellung: { gewicht: 34, op: false, teile: ['Knöchel', 'Rippe', 'Oberschenkel', 'Fuß', 'Schulter', 'Hüfte'] },
  erschoepfung: { gewicht: 9, op: false, teile: ['Muskulatur', 'Kreislauf'] },
  zerrung: { gewicht: 27, op: false, teile: ['Oberschenkel', 'Wade', 'Adduktoren', 'Leiste'] },
  gehirn: { gewicht: 4, op: false, teile: ['Kopf'] },
  faserriss: { gewicht: 12, op: false, teile: ['Oberschenkel', 'Wade', 'Adduktoren'] },
  baenderriss: { gewicht: 5, op: true, teile: ['Sprunggelenk', 'Knie'] },
  meniskus: { gewicht: 3, op: true, teile: ['Knie'] },
  knochenbruch: { gewicht: 2.2, op: true, teile: ['Mittelfuß', 'Wadenbein', 'Schlüsselbein', 'Handwurzel', 'Nase'] },
  sehne: { gewicht: 1.3, op: true, teile: ['Achillessehne', 'Patellasehne'] },
  kreuzband: { gewicht: 0.7, op: true, teile: ['Knie'] }
};

/** Krankheiten laufen als eigene „Verletzungsart" (art:'krankheit'). */
const KRANKHEITEN = [
  { id: 'grippe', name: 'Grippaler Infekt', min: 4, max: 10, severity: 1, gewicht: 40 },
  { id: 'magendarm', name: 'Magen-Darm-Infekt', min: 2, max: 6, severity: 1, gewicht: 32 },
  { id: 'fieber', name: 'Fieberhafter Infekt', min: 3, max: 8, severity: 1, gewicht: 21 },
  { id: 'angina', name: 'Mandelentzündung', min: 6, max: 14, severity: 2, gewicht: 7 }
];

export const BEHANDLUNGEN = {
  konservativ: {
    id: 'konservativ', name: 'Konservativ', tempo: 1.0, rueckfall: 1.0, kosten: 0,
    desc: 'Eis, Geduld und Physiotherapie. Dauert, hält aber.'
  },
  intensiv: {
    id: 'intensiv', name: 'Intensivreha', tempo: 1.34, rueckfall: 2.1, kosten: KOSTEN.intensiv,
    desc: 'Doppelschichten auf der Behandlungsliege. Schneller zurück – und schneller wieder weg.'
  },
  operation: {
    id: 'operation', name: 'Operation', tempo: 0.82, rueckfall: 0.35, kosten: KOSTEN.operation,
    desc: 'Einmal richtig aufmachen. Lange Pause, danach ist die Sache erledigt.'
  },
  spezialist: {
    id: 'spezialist', name: 'Spezialist', tempo: 1.2, rueckfall: 0.45, kosten: KOSTEN.spezialist,
    desc: 'Der Professor aus Innsbruck. Kostet ein Vermögen, liefert die beste Prognose.'
  },
  spritze: {
    id: 'spritze', name: 'Schmerzspritze', tempo: 1.0, rueckfall: SPRITZE_RISIKO_FAKTOR, kosten: KOSTEN.spritze,
    desc: 'Sofort einsatzfähig, dafür Roulette mit dem Bein des Spielers.'
  }
};

/* ==========================================================================
 * 3. Kleine Helfer
 * ======================================================================== */

function P(state, playerId) { return state && state.players ? state.players[playerId] || null : null; }
function C(state, clubId) { return state && state.clubs ? state.clubs[clubId] || null : null; }

function fail(text) { return { ok: false, text }; }

function name(p) { return p ? (p.shortName || p.lastName || p.id) : 'Unbekannt'; }

/** Lazy-Init der medizinischen Spielerakte. */
function akte(p) {
  if (!p.medizin) {
    p.medizin = {
      historie: [],            // [{ saison, tag, typ, name, tage, ursache, schwere }]
      ausfalltage: { saison: 0, gesamt: 0 },
      einsaetze: [],           // [{ saison, tag, minuten }] – letzte 14
      anfaelligkeit: 0,        // 0..1, wächst mit jeder schweren Verletzung
      gespritzt: null,
      langzeitschaeden: [],
      letzteVerletzung: null,
      tageKritisch: 0
    };
  }
  return p.medizin;
}

/** Lazy-Init der Vereinsakte. */
function klinik(c) {
  if (!c.medizin) {
    c.medizin = {
      saison: null,            // Saisonstempel des letzten saisonReset()
      grippewelle: null,       // { restTage, staerke }
      kosten: { saison: 0, gesamt: 0 },
      ausfalltage: { saison: 0, gesamt: 0 },
      verletzungenSaison: 0,
      spieleVerarbeitet: [],   // letzte Fixture-IDs (Doppelbuchungs-Schutz)
      letzterEinsatzTag: -1,
      sperrCursor: -1,
      letzteWarnung: -99
    };
  }
  return c.medizin;
}

/** Lazy-Init der Sperrbuchhaltung auf player.cards. */
function karten(p) {
  if (!p.cards) p.cards = { yellow: 0, red: 0, ban: 0, seasonYellow: 0 };
  const k = p.cards;
  if (k.compYellow === undefined) k.compYellow = {};
  if (k.gelbSperren === undefined) k.gelbSperren = {};   // comp -> Anzahl bereits verhängter Gelbsperren
  if (k.gelbrotVerbucht === undefined) k.gelbrotVerbucht = 0;
  if (k.rotVerbucht === undefined) k.rotVerbucht = 0;
  if (k.banComp === undefined) k.banComp = null;
  if (k.gelbrot === undefined) k.gelbrot = 0;
  return k;
}

/** Deterministische Ersatz-Rng, wenn eine Aktion ohne ctx aufgerufen wird. */
function detRng(state, ...parts) {
  const s = state && state.date ? `${state.seed || 0}:${state.date.season}:${state.date.day}` : '0';
  return createRng(hashString(s + ':' + parts.join(':')));
}

function ctxRng(state, ctx, ...parts) {
  if (ctx && ctx.rng && typeof ctx.rng.next === 'function') return ctx.rng;
  return detRng(state, ...parts);
}

function diffOf(state, ctx) {
  if (ctx && ctx.difficulty && typeof ctx.difficulty.injuryRate === 'number') return ctx.difficulty;
  return DIFFICULTIES[state && state.difficulty] || DIFFICULTIES.profi;
}

function lerp2(range, t) { return range[0] + (range[1] - range[0]) * clamp(t, 0, 1); }

/** „3 Wochen", „5 Tage", „gut vier Monate" – deutsche Ausfallprognose. */
export function dauerText(tage) {
  const t = Math.max(0, Math.round(tage));
  if (t <= 0) return 'einsatzbereit';
  if (t === 1) return 'einen Tag';
  if (t < 11) return `${t} Tage`;
  if (t < 60) {
    const w = Math.round(t / 7);
    return w === 1 ? 'eine Woche' : `rund ${w} Wochen`;
  }
  const m = Math.round(t / 30);
  return m === 1 ? 'gut einen Monat' : `rund ${m} Monate`;
}

function tagPlusOffset(state, tage) {
  const d = state.date || { day: 0, season: 1 };
  let tag = d.day + Math.round(tage);
  let saison = d.season;
  while (tag >= 365) { tag -= 365; saison++; }
  return { tag, saison };
}

function rueckkehrText(state, injury) {
  const r = tagPlusOffset(state, injury.tageRest);
  const startYear = (state.date && state.date.startYear) || 2025;
  if (r.saison !== state.date.season) return `Rückkehr erst in der nächsten Saison (${dauerText(injury.tageRest)})`;
  return `zurück voraussichtlich ${formatDate(r.tag, r.saison, startYear)} (${dauerText(injury.tageRest)})`;
}

function log(ctx, clubId, state, text, kind, opts) {
  if (!ctx || typeof ctx.log !== 'function') return;
  if (clubId !== state.managerClubId) return;
  ctx.log(text, kind || 'medizin', opts || {});
}

function news(ctx, clubId, state, text, kind) {
  if (!ctx || typeof ctx.news !== 'function') return;
  if (clubId !== state.managerClubId) return;
  ctx.news(text, kind || 'medizin');
}

/** Kleine Buchung – Ledger-Format wie in core/state.js dokumentiert. */
function buchen(state, club, betrag, text) {
  if (!club || !club.finances || !betrag) return;
  club.finances.balance = Math.round((club.finances.balance || 0) - betrag);
  if (Array.isArray(club.finances.ledger)) {
    club.finances.ledger.push({
      day: state.date.day, season: state.date.season,
      betrag: -Math.round(betrag), kategorie: 'medizin', text
    });
    if (club.finances.ledger.length > 4000) club.finances.ledger.splice(0, 500);
  }
  if (club.finances.saison) {
    club.finances.saison.ausgabenSonstige = Math.round((club.finances.saison.ausgabenSonstige || 0) + betrag);
  }
  const k = klinik(club);
  k.kosten.saison += Math.round(betrag);
  k.kosten.gesamt += Math.round(betrag);
}

function squad(state, club) {
  const out = [];
  for (const id of club.playerIds || []) {
    const p = state.players[id];
    if (p) out.push(p);
  }
  return out;
}

/* ==========================================================================
 * 4. Medizinische Abteilung
 * ======================================================================== */

/** Liest die Qualität eines Stab-Datensatzes tolerant aus (staff.js definiert das Schema). */
function stabQualitaet(s) {
  if (!s) return null;
  const cand = [s.quality, s.qualitaet, s.faehigkeit, s.koennen, s.skill, s.rating, s.staerke, s.ovr];
  for (const v of cand) if (typeof v === 'number' && v > 0) return clamp(v, 1, 100);
  if (s.attributes && typeof s.attributes.medizin === 'number') return clamp(s.attributes.medizin, 1, 100);
  return null;
}

function stabRolle(s) {
  return String((s && (s.role || s.rolle || s.typ || s.job)) || '').toLowerCase();
}

/**
 * Güte der medizinischen Abteilung, 1..100.
 * 55 % Anlagen (club.facilities.medical), 45 % Personal (Arzt, Physio, Athletik).
 */
export function medizinIndex(state, clubId) {
  const club = C(state, clubId);
  if (!club) return 50;
  const anlage = clamp((club.facilities && club.facilities.medical) || 50, 1, 100);

  let summe = 0, gewicht = 0;
  for (const sid of club.staffIds || []) {
    const s = state.staff ? state.staff[sid] : null;
    const q = stabQualitaet(s);
    if (q === null) continue;
    const r = stabRolle(s);
    let w = 0;
    if (r.includes('arzt') && !r.includes('zahn')) w = 1.0;
    else if (r.includes('physio')) w = 0.9;
    else if (r.includes('athletik') || r.includes('reha')) w = 0.55;
    if (w > 0) { summe += q * w; gewicht += w; }
  }
  const stab = gewicht > 0 ? summe / gewicht : anlage;
  return clamp(Math.round(anlage * MED_ANTEIL_ANLAGE + stab * MED_ANTEIL_STAB), 1, 100);
}

/** Alle abgeleiteten Faktoren der Abteilung auf einen Blick. */
function medFaktoren(state, clubId) {
  const idx = medizinIndex(state, clubId);
  const t = idx / 100;
  return {
    index: idx,
    praevention: lerp2(MED_PRAEVENTION, t),
    heiltempo: lerp2(MED_HEILTEMPO, t),
    dauer: lerp2(MED_DAUER, t),
    rueckschlag: lerp2(MED_RUECKSCHLAG, t),
    schwere: lerp2(MED_SCHWERE, t)
  };
}

export function medizinNote(index) {
  if (index >= 88) return 'Universitätsklinik';
  if (index >= 78) return 'erstklassig';
  if (index >= 66) return 'solide Bundesliga-Norm';
  if (index >= 54) return 'ausbaufähig';
  if (index >= 42) return 'Kreisliga-Niveau';
  return 'Eimer mit Eiswasser';
}

/* ==========================================================================
 * 5. Risiko
 * ======================================================================== */

function altersFaktorRisiko(age) {
  if (age <= 20) return 0.95;
  if (age <= 24) return 0.92;
  if (age <= 28) return 1.0;
  if (age <= 31) return 1.18;
  if (age <= 33) return 1.38;
  return 1.6;
}

/** Spiele in den letzten `BELASTUNG_FENSTER` Tagen (nur Einsätze ab 20 Minuten). */
export function belastung(state, playerId) {
  const p = P(state, playerId);
  if (!p) return { spiele: 0, minuten: 0, fenster: BELASTUNG_FENSTER };
  const m = akte(p);
  const d = state.date;
  let spiele = 0, minuten = 0;
  for (const e of m.einsaetze) {
    const abstand = (d.season - e.saison) * 365 + (d.day - e.tag);
    if (abstand < 0 || abstand > BELASTUNG_FENSTER) continue;
    minuten += e.minuten;
    if (e.minuten >= 20) spiele++;
  }
  return { spiele, minuten, fenster: BELASTUNG_FENSTER };
}

/**
 * Alle Risikofaktoren eines Spielers inkl. Klartextbegründung.
 * Rückgabe: { faktor, gruende:[{ text, faktor }] }
 */
function risikoFaktoren(state, p, club, opts = {}) {
  const gruende = [];
  let f = 1;
  const add = (v, text) => { if (Math.abs(v - 1) > 0.02) gruende.push({ text, faktor: round(v, 2) }); f *= v; };

  const a = p.attributes || {};
  add(altersFaktorRisiko(p.age || 26), p.age >= 32 ? 'Das Alter fordert Tribut' : 'Alter');

  const fit = clamp(p.fitness !== undefined ? p.fitness : 100, 0, 100);
  add(1 + ((100 - fit) / 100) * 1.7, fit < 70 ? 'Läuft auf dem Zahnfleisch' : 'Fitness');

  const koerper = clamp(a.koerper || 50, 1, 99);
  add(1 + (55 - koerper) / 300, koerper >= 75 ? 'Robuster Körperbau' : 'Körperliche Robustheit');

  const traits = p.traits || [];
  if (traits.includes('glasknochen')) add(1.75, 'Glasknochen – der Betriebsarzt kennt ihn beim Vornamen');
  if (traits.includes('laufwunder')) add(0.88, 'Laufwunder');
  if (traits.includes('eisenfuss')) add(1.08, 'Geht rustikal zur Sache');

  const m = akte(p);
  const hist = m.historie.filter(h => (state.date.season - h.saison) <= 2).length;
  if (hist > 0) add(clamp(1 + hist * 0.06, 1, 1.55), `${hist} Verletzung${hist === 1 ? '' : 'en'} in den letzten zwei Jahren`);
  if (m.anfaelligkeit > 0.02) add(1 + m.anfaelligkeit * 0.8, 'Chronisch anfällig');

  const bel = belastung(state, p.id);
  if (bel.spiele > BELASTUNG_SPIELE_WARNUNG - 1) {
    const ueber = bel.spiele - (BELASTUNG_SPIELE_WARNUNG - 1);
    add(1 + ueber * BELASTUNG_RISIKO_PRO_SPIEL, `${bel.spiele} Spiele in ${BELASTUNG_FENSTER} Tagen`);
  }

  if (m.gespritzt) add(SPRITZE_RISIKO_FAKTOR, 'Steht unter Schmerzmitteln');

  const med = opts.med || medFaktoren(state, club ? club.id : null);
  add(med.praevention, `Medizinische Abteilung (${medizinNote(med.index)})`);

  if (club && club.stadiumState && typeof club.stadiumState.rasenZustand === 'number') {
    const rasen = clamp(club.stadiumState.rasenZustand, 1, 100);
    add(1 + (78 - rasen) / 320, rasen < 60 ? 'Der Acker von einem Rasen' : 'Platzverhältnisse');
  }

  if (opts.weather && WEATHER[opts.weather]) add(WEATHER[opts.weather].injuryMod, `Wetter: ${WEATHER[opts.weather].name}`);

  if (typeof opts.haerte === 'number') add(1 + (opts.haerte - 50) / 260, 'Zweikampfhärte auf dem Platz');

  if (club && club.training && typeof club.training.intensitaet === 'number' && opts.art === 'training') {
    add(1 + (club.training.intensitaet - 50) / 190, 'Trainingsintensität');
  }

  const diff = diffOf(state, opts.ctx);
  add(diff.injuryRate || 1, `Schwierigkeit: ${diff.name}`);

  return { faktor: f, gruende, med };
}

/**
 * Verletzungswahrscheinlichkeit für einen Einsatz bzw. einen Trainingstag.
 * @param {object} ctx { art:'spiel'|'training', weather, minuten, haerte, rng }
 * @returns {number} 0..1
 */
export function verletzungsrisiko(state, playerId, ctx = {}) {
  const p = P(state, playerId);
  if (!p) return 0;
  if (p.injury) return 0;
  const club = C(state, p.clubId);
  const art = ctx.art || (ctx.isMatchday ? 'spiel' : 'spiel');
  const basis = art === 'training' ? BASIS_RISIKO_TRAINING
    : art === 'privat' ? BASIS_RISIKO_PRIVAT
      : BASIS_RISIKO_SPIEL;
  const minutenAnteil = art === 'spiel' && typeof ctx.minuten === 'number'
    ? clamp(ctx.minuten, 0, 120) / 90 : 1;
  const { faktor } = risikoFaktoren(state, p, club, Object.assign({ art, ctx }, ctx));
  return clamp(basis * faktor * minutenAnteil, 0, RISIKO_MAX);
}

/* ==========================================================================
 * 6. Verletzung zufügen
 * ======================================================================== */

function waehleTyp(rng, ursache, medSchwere, opts = {}) {
  if (opts.typ && TYP_BY_ID[opts.typ]) return TYP_BY_ID[opts.typ];
  const kandidaten = INJURY_TYPES.filter(t => KATALOG[t.id]);
  return rng.pickWeighted(kandidaten, (t) => {
    const k = KATALOG[t.id];
    let w = k.gewicht;
    // Schwere Verletzungen sind im Training deutlich seltener, privat noch seltener.
    if (ursache === 'training' && t.severity >= 4) w *= 0.45;
    if (ursache === 'training' && t.id === 'gehirn') w *= 0.35;
    if (ursache === 'privat') w = t.severity >= 4 ? w * 0.7 : w;
    if (t.severity >= 3) w *= medSchwere;
    if (opts.schwere) w *= (t.severity === opts.schwere ? 6 : t.severity >= opts.schwere ? 1 : 0.2);
    return w;
  });
}

function koerperteil(rng, typId) {
  const k = KATALOG[typId];
  return k && k.teile ? rng.pick(k.teile) : 'Bein';
}

const URSACHE_TEXT = {
  spiel: ['bleibt im Zweikampf liegen', 'verdreht sich das Standbein', 'muss vom Feld getragen werden', 'greift sich an den Oberschenkel'],
  training: ['erwischt es im Abschlusstraining', 'bleibt beim Sprintprogramm hängen', 'geht im Trainingsspiel zu Boden'],
  privat: ['hat sich beim Möbelrücken verhoben', 'ist im heimischen Garten umgeknickt', 'hatte eine unglückliche Begegnung mit der Kellertreppe']
};

/**
 * Verletzt einen Spieler. Nutzt INJURY_TYPES aus core/constants.js.
 *
 * @param {object} opts { typ, schwere, ursache:'spiel'|'training'|'privat', minute, rng, ctx, dauer }
 * @returns {{ ok:boolean, text:string, injury?:object, tage?:number }}
 */
export function verletzen(state, playerId, opts = {}) {
  const p = P(state, playerId);
  if (!p) return fail('Unbekannter Spieler.');
  if (p.injury) return fail(`${name(p)} liegt bereits im Lazarett.`);

  const club = C(state, p.clubId);
  const rng = opts.rng || (opts.ctx && opts.ctx.rng) || detRng(state, 'verletzen', playerId);
  const ursache = opts.ursache || 'spiel';
  const med = medFaktoren(state, club ? club.id : null);
  const m = akte(p);

  const typ = waehleTyp(rng, ursache, med.schwere, opts);
  const k = KATALOG[typ.id] || { op: false };

  // Dauer: Verteilung mit Schwerpunkt am unteren Rand, dann Modifikatoren.
  let tage = typ.min + (typ.max - typ.min) * Math.pow(rng.next(), 1.55);
  tage *= med.dauer;
  tage *= 1 + clamp(((p.age || 26) - 27) * 0.016, -0.12, 0.22);
  tage *= 1 + m.anfaelligkeit * 0.35;
  if ((p.traits || []).includes('glasknochen')) tage *= 1.12;
  if (m.gespritzt) tage *= SPRITZE_FOLGE_DAUER;
  if (typeof opts.dauer === 'number') tage = opts.dauer;
  tage = clamp(Math.round(tage), 1, 420);

  const injury = {
    typ: typ.id,
    name: typ.name,
    art: 'verletzung',
    schwere: typ.severity,
    ursache,
    minute: opts.minute !== undefined ? opts.minute : null,
    koerperteil: koerperteil(rng, typ.id),
    startSaison: state.date.season,
    startTag: state.date.day,
    tageGesamt: tage,
    tageRest: tage,
    behandlung: 'konservativ',
    opMoeglich: !!k.op,
    opDurchgefuehrt: false,
    rueckfaelle: 0,
    gespritztVorher: !!m.gespritzt
  };
  p.injury = injury;
  m.letzteVerletzung = { saison: state.date.season, tag: state.date.day, typ: typ.id };
  m.gespritzt = null;
  if (typ.severity >= 3) m.anfaelligkeit = clamp(m.anfaelligkeit + (typ.severity - 2) * 0.05, 0, 0.6);
  p.fitness = clamp((p.fitness !== undefined ? p.fitness : 100) - 8 - typ.severity * 3, 5, 100);
  if (club) klinik(club).verletzungenSaison++;

  const flavour = rng.pick(URSACHE_TEXT[ursache] || URSACHE_TEXT.spiel);
  const minuteTxt = injury.minute ? ` in der ${injury.minute}. Minute` : '';
  const text = `${name(p)} ${flavour}${minuteTxt}. Diagnose: ${typ.name} (${injury.koerperteil}). ` +
    `Ausfall: ${dauerText(tage)}.`;

  if (club) {
    const ctx = opts.ctx;
    const dringend = typ.severity >= 4;
    log(ctx, club.id, state, textBefund(state, p, injury, med), dringend ? 'medizin' : 'medizin', {
      subject: `${dringend ? 'Schwere Verletzung' : 'Verletzung'}: ${name(p)}`,
      from: 'Mannschaftsarzt',
      wichtig: dringend
    });
    news(ctx, club.id, state, `${name(p)}: ${typ.name}, ${dauerText(tage)} raus.`, 'medizin');
  }

  return { ok: true, text, injury, tage };
}

function textBefund(state, p, injury, med) {
  const pos = POSITION_NAMES[p.position] || p.position;
  const lines = [
    `Befund aus der Kabine: ${p.firstName ? p.firstName + ' ' : ''}${p.lastName || name(p)} (${pos}) hat sich ` +
    `${artikel(injury.name)} ${injury.name} ${amTeil(injury.koerperteil)} zugezogen.`,
    ``,
    `Ursache: ${injury.ursache === 'spiel' ? 'Spielverletzung' : injury.ursache === 'training' ? 'Trainingsunfall' : 'privates Missgeschick'}` +
    `${injury.minute ? `, ${injury.minute}. Minute` : ''}.`,
    `Prognose: ${dauerText(injury.tageRest)} – ${rueckkehrText(state, injury)}.`,
    `Behandlung: vorerst konservativ.` + (injury.opMoeglich ? ' Eine Operation wäre eine Option.' : ''),
    ``,
    med.index >= 78
      ? 'Unsere Abteilung hat die Sache im Griff. Er wird bestens versorgt.'
      : med.index >= 55
        ? 'Wir tun, was wir können. Mit einer besseren Ausstattung wäre er schneller zurück.'
        : 'Ehrlich gesagt: Mit unserer Ausstattung ist das eher Handauflegen als Sportmedizin.'
  ];
  return lines.join('\n');
}

/** Akkusativ-Artikel: „einen Muskelfaserriss", aber „eine Muskelzerrung". */
function artikel(n) {
  return /(riss|bruch|schaden|infekt)$/i.test(String(n)) ? 'einen' : 'eine';
}

/** Dativ: „bei einem Muskelfaserriss", „bei einer Prellung". */
function artikelDat(n) {
  return /(riss|bruch|schaden|infekt)$/i.test(String(n)) ? 'einem' : 'einer';
}

/** Nominativ: „ein Bänderriss", „eine Zerrung". */
function artikelNom(n) {
  return /(riss|bruch|schaden|infekt)$/i.test(String(n)) ? 'ein' : 'eine';
}

/** Weibliche bzw. pluralische Körperteile für die Dativ-Angabe. */
const TEIL_WEIBLICH = new Set(['Rippe', 'Schulter', 'Hüfte', 'Muskulatur', 'Wade', 'Leiste',
  'Handwurzel', 'Nase', 'Achillessehne', 'Patellasehne']);
const TEIL_PLURAL = new Set(['Adduktoren']);

/** „am Knöchel", „an der Wade", „an den Adduktoren". */
function amTeil(teil) {
  if (!teil) return '';
  if (TEIL_PLURAL.has(teil)) return `an den ${teil}`;
  if (TEIL_WEIBLICH.has(teil)) return `an der ${teil}`;
  return `am ${teil}`;
}

/**
 * Krankheit (Grippewelle & Co.) – eigener Weg, weil INJURY_TYPES nur Blessuren kennt.
 */
export function erkranken(state, playerId, opts = {}) {
  const p = P(state, playerId);
  if (!p) return fail('Unbekannter Spieler.');
  if (p.injury) return fail(`${name(p)} ist bereits außer Gefecht.`);
  const club = C(state, p.clubId);
  const rng = opts.rng || detRng(state, 'krank', playerId);
  const kr = (opts.typ && KRANKHEITEN.find(k => k.id === opts.typ)) ||
    rng.pickWeighted(KRANKHEITEN, k => k.gewicht);
  const med = medFaktoren(state, club ? club.id : null);
  let tage = kr.min + (kr.max - kr.min) * Math.pow(rng.next(), 1.3);
  tage = clamp(Math.round(tage * med.dauer), 2, 30);

  p.injury = {
    typ: kr.id, name: kr.name, art: 'krankheit', schwere: kr.severity, ursache: 'infekt',
    minute: null, koerperteil: 'Allgemeinzustand',
    startSaison: state.date.season, startTag: state.date.day,
    tageGesamt: tage, tageRest: tage, behandlung: 'konservativ',
    opMoeglich: false, opDurchgefuehrt: false, rueckfaelle: 0
  };
  akte(p).letzteVerletzung = { saison: state.date.season, tag: state.date.day, typ: kr.id };
  p.fitness = clamp((p.fitness !== undefined ? p.fitness : 100) - 12, 5, 100);
  return { ok: true, text: `${name(p)} liegt mit ${kr.name} flach (${dauerText(tage)}).`, tage };
}

/* ==========================================================================
 * 7. Behandlung
 * ======================================================================== */

/**
 * Legt die Behandlungsmethode fest.
 * 'konservativ' | 'intensiv' | 'operation' | 'spezialist' | 'spritze'
 */
export function behandeln(state, playerId, methode) {
  const p = P(state, playerId);
  if (!p) return fail('Unbekannter Spieler.');
  const b = BEHANDLUNGEN[methode];
  if (!b) return fail(`Unbekannte Behandlungsmethode „${methode}".`);
  if (!p.injury) return fail(`${name(p)} ist kerngesund. Sparen Sie sich das Geld.`);

  const inj = p.injury;
  const club = C(state, p.clubId);
  const med = medFaktoren(state, club ? club.id : null);
  const rng = detRng(state, 'behandeln', playerId, methode, inj.rueckfaelle);
  const m = akte(p);

  if (methode === 'spritze') {
    if (inj.art === 'krankheit') return fail('Gegen einen Infekt hilft keine Spritze. Nur Tee und Geduld.');
    if (inj.schwere > SPRITZE_MAX_SCHWERE || inj.tageRest > SPRITZE_MAX_TAGE) {
      return fail(`${name(p)} kann man nicht einfach zusammenflicken – ${artikelNom(inj.name)} ${inj.name} lässt sich nicht wegspritzen.`);
    }
    const risiko = clamp(0.3 + inj.tageRest * 0.035 + inj.schwere * 0.05, 0.2, 0.8);
    m.gespritzt = { restTage: Math.max(3, Math.round(inj.tageRest * 1.5)), risiko, typ: inj.typ };
    m.historie.push({
      saison: inj.startSaison, tag: inj.startTag, typ: inj.typ, name: inj.name,
      tage: inj.tageGesamt - inj.tageRest, ursache: inj.ursache, schwere: inj.schwere, gespritzt: true
    });
    p.injury = null;
    p.fitness = clamp((p.fitness || 60) - 6, 5, 100);
    buchen(state, club, KOSTEN.spritze, `Schmerzbehandlung ${name(p)}`);
    return {
      ok: true, kosten: KOSTEN.spritze, risiko: round(risiko, 2), tageRest: 0,
      text: `${name(p)} bekommt die Spritze und beißt die Zähne zusammen. Er ist einsatzfähig – ` +
        `das Risiko eines Folgeschadens liegt bei rund ${Math.round(risiko * 100)} %. Der Doc schaut demonstrativ weg.`
    };
  }

  if (methode === 'operation') {
    if (!inj.opMoeglich) return fail(`Bei ${artikelDat(inj.name)} ${inj.name} schneidet niemand. Das heilt von selbst.`);
    if (inj.opDurchgefuehrt) return fail(`${name(p)} wurde bereits operiert.`);
    inj.opDurchgefuehrt = true;
    inj.behandlung = 'operation';
    inj.tageRest = Math.round(inj.tageRest * 1.18 + 7);
    inj.tageGesamt = Math.max(inj.tageGesamt, Math.round(inj.tageGesamt * 1.1 + 7));
    inj.opSauber = true;
    buchen(state, club, KOSTEN.operation, `Operation ${name(p)} (${inj.name})`);
    return {
      ok: true, kosten: KOSTEN.operation, tageRest: inj.tageRest,
      prognose: rueckkehrText(state, inj),
      text: `${name(p)} wird operiert. Der Eingriff verlängert die Pause auf ${dauerText(inj.tageRest)}, ` +
        `dafür kommt er danach ohne Altlasten zurück.`
    };
  }

  if (methode === 'spezialist') {
    if (inj.behandlung === 'spezialist') return fail('Der Spezialist behandelt ihn bereits.');
    const bonus = 0.9 + rng.next() * 0.2;
    inj.behandlung = 'spezialist';
    inj.tageRest = Math.max(1, Math.round(inj.tageRest * bonus * (1.02 - med.heiltempo * 0.08)));
    buchen(state, club, KOSTEN.spezialist, `Spezialistenbehandlung ${name(p)}`);
    return {
      ok: true, kosten: KOSTEN.spezialist, tageRest: inj.tageRest,
      prognose: rueckkehrText(state, inj),
      text: `Der Spezialist übernimmt ${name(p)}. Neue Prognose: ${dauerText(inj.tageRest)}. ` +
        `Die Rechnung geht an die Geschäftsstelle, dort wird jetzt geschluckt.`
    };
  }

  inj.behandlung = methode;
  const kosten = methode === 'intensiv' ? Math.round(KOSTEN.intensiv * inj.tageRest) : 0;
  if (kosten) buchen(state, club, kosten, `Intensivreha ${name(p)}`);
  return {
    ok: true, kosten, tageRest: inj.tageRest, prognose: rueckkehrText(state, inj),
    text: methode === 'intensiv'
      ? `${name(p)} geht in die Intensivreha. Schneller zurück – aber jeder Physio schaut skeptisch.`
      : `${name(p)} wird konservativ behandelt. Langsam, aber sicher.`
  };
}

/* ==========================================================================
 * 8. Reha
 * ======================================================================== */

/**
 * Ein Rehatag für einen verletzten Spieler.
 * @returns {{ ok, fertig, tageRest, fortschritt, rueckschlag, text }}
 */
export function reha(state, playerId, ctx = {}) {
  const p = P(state, playerId);
  if (!p) return { ok: false, fertig: false, tageRest: 0, fortschritt: 0, rueckschlag: false, text: 'Unbekannter Spieler.' };
  if (!p.injury) return { ok: false, fertig: true, tageRest: 0, fortschritt: 0, rueckschlag: false, text: `${name(p)} ist fit.` };

  const inj = p.injury;
  const club = C(state, p.clubId);
  const med = ctx.med || medFaktoren(state, club ? club.id : null);
  const b = BEHANDLUNGEN[inj.behandlung] || BEHANDLUNGEN.konservativ;
  const rng = ctxRng(state, ctx, 'reha', playerId);

  const alter = p.age || 26;
  const altersTempo = alter <= 23 ? 1.08 : alter <= 29 ? 1.0 : alter <= 32 ? 0.93 : 0.86;
  const heilAttr = 1 + (clamp((p.attributes && p.attributes.koerper) || 50, 1, 99) - 50) / 500;
  let fortschritt = HEIL_BASIS * med.heiltempo * b.tempo * altersTempo * heilAttr;
  if (inj.art === 'krankheit') fortschritt = HEIL_BASIS * (0.95 + med.heiltempo * 0.12);

  let rueckschlag = false;
  let text = '';

  // Rückschlagrisiko: nur im ersten Rehadrittel und nur bei echten Verletzungen.
  if (inj.art === 'verletzung' && inj.tageRest > 2 && inj.tageGesamt > 5) {
    const pRueck = RUECKSCHLAG_BASIS * b.rueckfall * med.rueckschlag *
      (1 + inj.schwere * 0.08) * (1 + akte(p).anfaelligkeit);
    if (rng.chance(clamp(pRueck, 0, 0.2))) {
      rueckschlag = true;
      inj.rueckfaelle++;
      const plus = Math.max(2, Math.round(inj.tageGesamt * (RUECKSCHLAG_ANTEIL[0] + rng.next() * (RUECKSCHLAG_ANTEIL[1] - RUECKSCHLAG_ANTEIL[0]))));
      inj.tageRest += plus;
      inj.tageGesamt += plus;
      akte(p).anfaelligkeit = clamp(akte(p).anfaelligkeit + 0.04, 0, 0.6);
      text = `Rückschlag bei ${name(p)}: ${inj.name} macht erneut Probleme. ${plus} Tage mehr – ` +
        `neue Prognose ${dauerText(inj.tageRest)}.`;
    }
  }

  inj.tageRest = Math.max(0, inj.tageRest - fortschritt);
  const m = akte(p);
  m.ausfalltage.saison++;
  m.ausfalltage.gesamt++;
  if (club) { const k = klinik(club); k.ausfalltage.saison++; k.ausfalltage.gesamt++; }

  if (inj.tageRest <= 0) {
    const genesen = genesen_(state, p, club, ctx);
    return { ok: true, fertig: true, tageRest: 0, fortschritt: round(fortschritt, 2), rueckschlag, text: genesen.text };
  }
  return { ok: true, fertig: false, tageRest: round(inj.tageRest, 1), fortschritt: round(fortschritt, 2), rueckschlag, text };
}

/** Rückkehr aus dem Lazarett inkl. Langzeitschaden-Prüfung. */
function genesen_(state, p, club, ctx) {
  const inj = p.injury;
  const m = akte(p);
  m.historie.push({
    saison: inj.startSaison, tag: inj.startTag, typ: inj.typ, name: inj.name,
    tage: inj.tageGesamt, ursache: inj.ursache, schwere: inj.schwere, art: inj.art
  });
  if (m.historie.length > 40) m.historie.shift();

  p.injury = null;
  // Nach langer Pause fehlt Spielpraxis und Grundlagenausdauer.
  const lang = clamp(inj.tageGesamt / 120, 0, 1);
  p.fitness = clamp(Math.round(72 - lang * 22), 30, 92);
  p.sharpness = clamp(Math.round((p.sharpness !== undefined ? p.sharpness : 60) - 12 - lang * 30), 5, 100);
  p.form = clamp(Math.round((p.form !== undefined ? p.form : 50) - 6 - lang * 12), 10, 90);

  let schaden = null;
  if (inj.art === 'verletzung' && inj.schwere >= LANGZEIT_AB_SCHWERE && !inj.opSauber) {
    schaden = langzeitschaden(state, p.id, { injury: inj });
    if (!schaden.ok) schaden = null;
  }

  const txt = `${name(p)} ist zurück im Mannschaftstraining. ${inj.name} überstanden, ` +
    `${inj.tageGesamt} Tage Pause${inj.rueckfaelle ? ` inklusive ${inj.rueckfaelle} Rückschlag/Rückschlägen` : ''}. ` +
    (inj.tageGesamt > 60 ? 'Spielpraxis: keine. Das dauert noch.' : 'Die Fitness kommt in den nächsten Tagen.') +
    (schaden ? `\n\n${schaden.text}` : '');

  if (club) {
    log(ctx, club.id, state, txt, 'medizin', { subject: `Zurück im Training: ${name(p)}`, from: 'Mannschaftsarzt' });
    news(ctx, club.id, state, `${name(p)} ist wieder fit.`, 'medizin');
  }
  return { text: txt, schaden };
}

/* ==========================================================================
 * 9. Fitness, Regeneration, Belastung
 * ======================================================================== */

/**
 * Belastung nach einem Spiel: Fitness runter, Spielpraxis rauf, Einsatz protokollieren.
 * @param {number} minuten 0..120
 * @param {number} intensitaet 0.6 (Freundschaftsspiel) … 1.25 (Pokalschlacht)
 */
export function fitnessNachSpiel(state, playerId, minuten, intensitaet = 1) {
  const p = P(state, playerId);
  if (!p) return fail('Unbekannter Spieler.');
  const min = clamp(minuten || 0, 0, 130);
  if (min <= 0) return { ok: true, text: `${name(p)} hat nicht gespielt.`, fitness: p.fitness, sharpness: p.sharpness };

  const a = p.attributes || {};
  const ausdauer = clamp(a.ausdauer || 50, 1, 99);
  const alter = p.age || 26;
  const altersFaktor = alter <= 23 ? 0.94 : alter <= 29 ? 1.0 : alter <= 32 ? 1.09 : 1.2;
  const laufwunder = (p.traits || []).includes('laufwunder') ? 0.82 : 1;
  const anteil = min / 90;

  const verlust = FITNESS_VERLUST_90MIN * anteil * clamp(intensitaet, 0.4, 1.5) *
    (1.42 - ausdauer / 140) * altersFaktor * laufwunder;

  p.fitness = clamp(round((p.fitness !== undefined ? p.fitness : 100) - verlust, 1), 5, 100);
  const s = p.sharpness !== undefined ? p.sharpness : 60;
  p.sharpness = clamp(round(s + SCHAERFE_GEWINN_90MIN * anteil * (1 - s / 130), 1), 5, 100);

  const m = akte(p);
  m.einsaetze.push({ saison: state.date.season, tag: state.date.day, minuten: Math.round(min) });
  if (m.einsaetze.length > 14) m.einsaetze.shift();

  const club = C(state, p.clubId);
  if (club) klinik(club).letzterEinsatzTag = state.date.day;

  return { ok: true, text: `${name(p)}: ${Math.round(min)} Minuten in den Knochen.`, fitness: p.fitness, sharpness: p.sharpness };
}

/**
 * Tägliche Regeneration von Fitness und Spielpraxis.
 */
export function regeneration(state, playerId, ctx = {}) {
  const p = P(state, playerId);
  if (!p) return fail('Unbekannter Spieler.');
  const club = C(state, p.clubId);
  const med = ctx.med || medFaktoren(state, club ? club.id : null);
  const a = p.attributes || {};
  const alter = p.age || 26;
  const altersFaktor = alter <= 23 ? 1.1 : alter <= 29 ? 1.0 : alter <= 32 ? 0.9 : 0.8;

  if (p.injury) {
    // Im Lazarett verliert man Wettkampfhärte, egal wie gut die Abteilung ist.
    const ziel = p.injury.art === 'krankheit' ? 60 : FITNESS_VERLETZT_BODEN;
    const f = p.fitness !== undefined ? p.fitness : 100;
    p.fitness = round(f + (ziel - f) * 0.16, 1);
    p.sharpness = clamp(round((p.sharpness !== undefined ? p.sharpness : 60) - SCHAERFE_VERFALL_VERLETZT, 1), 3, 100);
    return { ok: true, fitness: p.fitness, sharpness: p.sharpness, text: '' };
  }

  let regen = FITNESS_REGEN_BASIS * med.heiltempo * altersFaktor * (0.86 + clamp(a.ausdauer || 50, 1, 99) / 350);
  if (ctx.isMatchdayFuerVerein) regen *= FITNESS_REGEN_SPIELTAG;
  if (ctx.urlaub) regen *= 1.5;
  if (club && club.training && typeof club.training.intensitaet === 'number' && !ctx.urlaub) {
    regen *= clamp(1.18 - club.training.intensitaet / 260, 0.72, 1.2);
  }

  const vorher = p.fitness !== undefined ? p.fitness : 100;
  p.fitness = clamp(round(vorher + regen, 1), 5, 100);

  let sh = p.sharpness !== undefined ? p.sharpness : 60;
  const letzterEinsatz = letzterEinsatzAbstand(state, p);
  if (letzterEinsatz > 4) sh -= SCHAERFE_VERFALL * (ctx.urlaub ? 1.6 : 1);
  p.sharpness = clamp(round(sh, 1), 3, 100);

  return { ok: true, fitness: p.fitness, sharpness: p.sharpness, text: '' };
}

function letzterEinsatzAbstand(state, p) {
  const m = akte(p);
  if (!m.einsaetze.length) return 99;
  const e = m.einsaetze[m.einsaetze.length - 1];
  return (state.date.season - e.saison) * 365 + (state.date.day - e.tag);
}

/**
 * Warnt vor überlasteten Spielern.
 * @returns {{ ok, warnungen:[{ playerId, name, spiele, minuten, risiko, stufe, text }], text }}
 */
export function belastungssteuerung(state, clubId) {
  const club = C(state, clubId);
  if (!club) return { ok: false, warnungen: [], text: 'Unbekannter Verein.' };
  const warnungen = [];
  for (const p of squad(state, club)) {
    if (p.injury) continue;
    const bel = belastung(state, p.id);
    const fit = p.fitness !== undefined ? p.fitness : 100;
    const risiko = verletzungsrisiko(state, p.id, { art: 'spiel' });
    let stufe = 0;
    if (bel.spiele >= BELASTUNG_SPIELE_WARNUNG + 1 || (bel.spiele >= BELASTUNG_SPIELE_WARNUNG && fit < 68)) stufe = 2;
    else if (bel.spiele >= BELASTUNG_SPIELE_WARNUNG || fit < 60) stufe = 1;
    if (fit < 45) stufe = 2;
    if (!stufe) continue;

    const text = stufe === 2
      ? `${name(p)} hat ${bel.spiele} Spiele in ${BELASTUNG_FENSTER} Tagen absolviert (Fitness ${Math.round(fit)} %) – ` +
        `Verletzungsrisiko deutlich erhöht. Setzen Sie ihn auf die Bank, bevor es der Arzt tut.`
      : `${name(p)}: ${bel.spiele} Spiele in ${BELASTUNG_FENSTER} Tagen, Fitness ${Math.round(fit)} %. ` +
        `Eine Pause wäre kein Luxus.`;
    warnungen.push({
      playerId: p.id, name: name(p), spiele: bel.spiele, minuten: bel.minuten,
      fitness: Math.round(fit), risiko: round(risiko, 4), stufe, text
    });
  }
  warnungen.sort((a, b) => (b.stufe - a.stufe) || (b.spiele - a.spiele) || (a.fitness - b.fitness));
  return {
    ok: true, warnungen,
    text: warnungen.length
      ? `${warnungen.length} Spieler am Limit.`
      : 'Die Belastungssteuerung meldet: alles im grünen Bereich.'
  };
}

/* ==========================================================================
 * 10. Sperren
 * ======================================================================== */

function istLiga(competitionId) { return !!LEAGUES[competitionId]; }

/**
 * Verhängt eine Sperre über `spiele` Pflichtspiele.
 */
export function sperreVerhaengen(state, playerId, spiele, grund = 'Sperre', competitionId = null) {
  const p = P(state, playerId);
  if (!p) return fail('Unbekannter Spieler.');
  const n = Math.max(1, Math.round(spiele || 1));
  const k = karten(p);
  k.ban = (k.ban || 0) + n;
  if (competitionId) k.banComp = competitionId;
  k.sperrGrund = grund;
  // Tag der Verhängung. Das Spiel, das die Sperre ausgelöst hat, darf sie nicht
  // gleich wieder abbauen – sonst wäre jede Gelbsperre nach einer Sekunde vorbei.
  k.banAbTag = state.date.day;
  return {
    ok: true, spiele: n, ban: k.ban,
    text: `${name(p)} ist für ${n} ${n === 1 ? 'Spiel' : 'Spiele'} gesperrt (${grund}).`
  };
}

/**
 * Meldet eine Karte an die Sperrverwaltung. Von der Match-Engine aufzurufen.
 * @param {'gelb'|'gelbrot'|'rot'} art
 */
export function karteVermerken(state, playerId, art, competitionId = 'bl1', opts = {}) {
  const p = P(state, playerId);
  if (!p) return fail('Unbekannter Spieler.');
  const k = karten(p);
  if (art === 'gelb') {
    k.yellow = (k.yellow || 0) + 1;
    k.seasonYellow = (k.seasonYellow || 0) + 1;
    k.compYellow[competitionId] = (k.compYellow[competitionId] || 0) + 1;
    return { ok: true, text: `Gelb für ${name(p)}.` };
  }
  if (art === 'gelbrot') {
    k.gelbrot = (k.gelbrot || 0) + 1;
    k.compYellow[competitionId] = (k.compYellow[competitionId] || 0) + 1;
    return { ok: true, text: `Gelb-Rot für ${name(p)}.` };
  }
  if (art === 'rot') {
    k.red = (k.red || 0) + 1;
    k.rotSchwere = opts.schwere || null;
    return { ok: true, text: `Rote Karte für ${name(p)}.` };
  }
  return fail('Unbekannte Kartenart.');
}

/**
 * Wertet die Karten eines Vereins in einem Wettbewerb aus und verhängt Sperren.
 * 5 Gelbe = 1 Spiel, Gelb-Rot = 1 Spiel, Rot = 1–3 Spiele je nach Schwere.
 */
export function sperrenPruefen(state, clubId, competitionId = 'bl1', opts = {}) {
  const club = C(state, clubId);
  if (!club) return { ok: false, sperren: [], text: 'Unbekannter Verein.' };
  const sperren = [];

  for (const p of squad(state, club)) {
    const k = karten(p);

    // --- Gelbe Karten: Sperre bei 5, 10, 15 …
    let gelb = k.compYellow[competitionId] || 0;
    if (!gelb && istLiga(competitionId)) gelb = k.seasonYellow || 0;
    const faellig = Math.floor(gelb / GELB_SPERRE_SCHWELLE);
    const erteilt = k.gelbSperren[competitionId] || 0;
    if (faellig > erteilt) {
      const n = faellig - erteilt;
      k.gelbSperren[competitionId] = faellig;
      sperreVerhaengen(state, p.id, n, `${gelb}. Gelbe Karte`, competitionId);
      sperren.push({ playerId: p.id, name: name(p), spiele: n, grund: 'Gelbsperre', text: `${name(p)} hat die ${gelb}. Gelbe gesehen und fehlt im nächsten Spiel.` });
    }

    // --- Gelb-Rot
    const gr = k.gelbrot || 0;
    if (gr > (k.gelbrotVerbucht || 0)) {
      const n = (gr - k.gelbrotVerbucht) * GELBROT_SPERRE;
      k.gelbrotVerbucht = gr;
      sperreVerhaengen(state, p.id, n, 'Gelb-Rote Karte', competitionId);
      sperren.push({ playerId: p.id, name: name(p), spiele: n, grund: 'Gelb-Rot', text: `${name(p)} flog mit Gelb-Rot vom Platz: ein Spiel Sperre.` });
    }

    // --- Rot: Schwere entscheidet über 1–3 Spiele
    const rot = k.red || 0;
    if (rot > (k.rotVerbucht || 0)) {
      const neue = rot - k.rotVerbucht;
      k.rotVerbucht = rot;
      const rng = opts.rng || detRng(state, 'rot', p.id, rot);
      let gesamt = 0;
      for (let i = 0; i < neue; i++) {
        const schwere = opts.schwere || k.rotSchwere ||
          rng.pickWeighted([1, 2, 3], (s) => (s === 1 ? 60 : s === 2 ? 30 : 10));
        gesamt += clamp(schwere, ROT_SPERRE[0], ROT_SPERRE[1]);
      }
      k.rotSchwere = null;
      sperreVerhaengen(state, p.id, gesamt, 'Rote Karte', competitionId);
      const grundText = gesamt >= 3 ? 'Das Sportgericht kannte kein Erbarmen' : gesamt === 2 ? 'Das Sportgericht legte nach' : 'Der Kontrollausschuss zeigte Milde';
      sperren.push({
        playerId: p.id, name: name(p), spiele: gesamt, grund: 'Rote Karte',
        text: `${name(p)}: Platzverweis, ${gesamt} ${gesamt === 1 ? 'Spiel' : 'Spiele'} Sperre. ${grundText}.`
      });
    }
  }

  if (sperren.length) {
    const body = sperren.map(s => '• ' + s.text).join('\n');
    log(opts.ctx, clubId, state, `Vom Sportgericht:\n\n${body}\n\nWer den Kader plant, plant jetzt neu.`,
      'sperre', { subject: 'Sperren', from: 'Geschäftsstelle', wichtig: true });
  }
  return { ok: true, sperren, text: sperren.length ? `${sperren.length} neue Sperre(n).` : 'Keine neuen Sperren.' };
}

/** Baut Sperren nach gespielten Partien ab. Intern von tickMedizin genutzt. */
function sperrenAbbauen(state, club, competitionId, ctx, spieltag = null) {
  for (const p of squad(state, club)) {
    const k = p.cards;
    if (!k || !k.ban) continue;
    if (k.banComp && k.banComp !== competitionId && istLiga(k.banComp) !== istLiga(competitionId)) continue;
    // Die Sperre gilt erst ab dem NÄCHSTEN Spiel.
    if (spieltag !== null && k.banAbTag !== undefined && k.banAbTag >= spieltag) continue;
    k.ban = Math.max(0, k.ban - 1);
    if (k.ban === 0) {
      k.banComp = null;
      k.banAbTag = undefined;
      log(ctx, club.id, state, `${name(p)} hat seine Sperre abgesessen und steht wieder zur Verfügung.`,
        'sperre', { subject: `Sperre abgelaufen: ${name(p)}`, from: 'Geschäftsstelle' });
    }
  }
}

/* ==========================================================================
 * 11. Berichte
 * ======================================================================== */

/**
 * Fitness-Test vor dem Spiel.
 * @returns {{ einsatzfaehig, risiko, empfehlung, text, fitness, stufe }}
 */
export function fitTesten(state, playerId) {
  const p = P(state, playerId);
  if (!p) return { einsatzfaehig: false, risiko: 1, empfehlung: 'Spieler unbekannt.', text: '', fitness: 0, stufe: 0 };

  const k = p.cards || {};
  if (k.ban > 0) {
    return {
      einsatzfaehig: false, risiko: 0, fitness: p.fitness || 0, stufe: 0,
      empfehlung: `Gesperrt für ${k.ban} ${k.ban === 1 ? 'Spiel' : 'Spiele'}.`,
      text: `${name(p)} sitzt eine Sperre ab. Der beste Fitnesstest hilft da nichts.`
    };
  }
  if (p.injury) {
    const inj = p.injury;
    return {
      einsatzfaehig: false, risiko: 1, fitness: p.fitness || 0, stufe: 0,
      empfehlung: `Nicht einsatzfähig – ${inj.name}, ${dauerText(inj.tageRest)}.`,
      text: `${name(p)} hat den Test abgebrochen. ${inj.name} ${amTeil(inj.koerperteil)}, ${rueckkehrText(state, inj)}.`
    };
  }

  const club = C(state, p.clubId);
  const { faktor, gruende } = risikoFaktoren(state, p, club, { art: 'spiel' });
  const risiko = clamp(BASIS_RISIKO_SPIEL * faktor, 0, RISIKO_MAX);
  const fit = p.fitness !== undefined ? p.fitness : 100;
  const m = akte(p);

  let stufe, empfehlung;
  if (m.gespritzt) {
    stufe = 1;
    empfehlung = `Spielt nur auf Schmerzmittel. Rückfallrisiko rund ${Math.round(m.gespritzt.risiko * 100)} %.`;
  } else if (risiko > BASIS_RISIKO_SPIEL * 2.4 || fit < 55) {
    stufe = 1;
    empfehlung = 'Von einem Einsatz über 90 Minuten wird dringend abgeraten.';
  } else if (risiko > BASIS_RISIKO_SPIEL * 1.5 || fit < 75) {
    stufe = 2;
    empfehlung = 'Einsatz möglich, aber besser mit Wechseloption planen.';
  } else {
    stufe = 3;
    empfehlung = 'Grünes Licht. Der Mann brennt.';
  }

  const top = gruende.filter(g => g.faktor > 1.05).sort((a, b) => b.faktor - a.faktor).slice(0, 2);
  const text = `${name(p)}: Fitness ${Math.round(fit)} %, Frische ${Math.round(p.sharpness || 60)}. ` +
    `Verletzungsrisiko ${(risiko * 100).toFixed(1)} % pro Einsatz.` +
    (top.length ? ` Auffällig: ${top.map(g => g.text).join(', ')}.` : '') + ` ${empfehlung}`;

  return { einsatzfaehig: true, risiko: round(risiko, 4), empfehlung, text, fitness: Math.round(fit), stufe };
}

/**
 * Alle Ausfälle eines Vereins mit Prognose.
 */
export function lazarett(state, clubId) {
  const club = C(state, clubId);
  if (!club) return [];
  const out = [];
  for (const p of squad(state, club)) {
    if (p.injury) {
      const inj = p.injury;
      out.push({
        playerId: p.id, name: name(p), position: p.position,
        art: inj.art, typ: inj.typ, diagnose: inj.name, koerperteil: inj.koerperteil,
        schwere: inj.schwere, ursache: inj.ursache,
        tageGesamt: inj.tageGesamt, tageRest: Math.ceil(inj.tageRest),
        behandlung: (BEHANDLUNGEN[inj.behandlung] || BEHANDLUNGEN.konservativ).name,
        rueckfaelle: inj.rueckfaelle,
        prognose: dauerText(inj.tageRest),
        prognoseText: rueckkehrText(state, inj),
        status: 'verletzt'
      });
    } else if (p.cards && p.cards.ban > 0) {
      out.push({
        playerId: p.id, name: name(p), position: p.position,
        art: 'sperre', typ: 'sperre', diagnose: p.cards.sperrGrund || 'Sperre', koerperteil: null,
        schwere: 0, ursache: 'sportgericht',
        tageGesamt: 0, tageRest: 0, spiele: p.cards.ban,
        behandlung: '–', rueckfaelle: 0,
        prognose: `${p.cards.ban} ${p.cards.ban === 1 ? 'Spiel' : 'Spiele'}`,
        prognoseText: `gesperrt für ${p.cards.ban} ${p.cards.ban === 1 ? 'Spiel' : 'Spiele'}`,
        status: 'gesperrt'
      });
    }
  }
  out.sort((a, b) => (b.schwere - a.schwere) || (b.tageRest - a.tageRest));
  return out;
}

/**
 * Wochenbericht der medizinischen Abteilung.
 */
export function medizinBericht(state, clubId) {
  const club = C(state, clubId);
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  const med = medFaktoren(state, clubId);
  const k = klinik(club);
  const liste = lazarett(state, clubId);
  const verletzte = liste.filter(e => e.status === 'verletzt');
  const gesperrte = liste.filter(e => e.status === 'gesperrt');
  const kranke = verletzte.filter(e => e.art === 'krankheit');
  const bel = belastungssteuerung(state, clubId);

  const kader = squad(state, club);
  const schnittFitness = kader.length
    ? Math.round(kader.reduce((s, p) => s + (p.fitness !== undefined ? p.fitness : 100), 0) / kader.length) : 100;

  const empfehlungen = [];
  if (med.index < 55) empfehlungen.push('Die medizinische Abteilung ist unterbesetzt – jeder investierte Euro zahlt sich in Ausfalltagen aus.');
  if (schnittFitness < 74) empfehlungen.push('Die Mannschaft ist platt. Trainingsintensität senken oder rotieren.');
  if (bel.warnungen.filter(w => w.stufe === 2).length >= 2) empfehlungen.push('Mindestens zwei Spieler gehören dringend geschont.');
  if (verletzte.filter(v => v.schwere >= 4).length) empfehlungen.push('Für die Langzeitverletzten lohnt sich ein Blick auf Operation oder Spezialist.');
  if (!empfehlungen.length) empfehlungen.push('Nichts zu beanstanden. Der Physio darf mal Kaffee trinken.');

  const text = [
    `Medizinischer Bericht – ${club.name}`,
    `Abteilung: ${med.index}/100 (${medizinNote(med.index)})`,
    `Im Lazarett: ${verletzte.length}${kranke.length ? ` (davon ${kranke.length} krank)` : ''}, gesperrt: ${gesperrte.length}`,
    `Ausfalltage diese Saison: ${k.ausfalltage.saison}, Verletzungen: ${k.verletzungenSaison}`,
    `Durchschnittliche Fitness: ${schnittFitness} %`,
    `Behandlungskosten diese Saison: ${Math.round(k.kosten.saison).toLocaleString('de-DE')} €`,
    ...empfehlungen.map(e => '• ' + e)
  ].join('\n');

  return {
    ok: true,
    medizinIndex: med.index,
    note: medizinNote(med.index),
    verletzte, gesperrte, kranke,
    ausfalltageSaison: k.ausfalltage.saison,
    verletzungenSaison: k.verletzungenSaison,
    kostenSaison: Math.round(k.kosten.saison),
    schnittFitness,
    warnungen: bel.warnungen,
    empfehlungen,
    text
  };
}

/* ==========================================================================
 * 12. Langzeitschaden
 * ======================================================================== */

const SCHADEN_ATTRIBUTE = {
  kreuzband: ['tempo', 'sprungkraft', 'dribbling'],
  meniskus: ['tempo', 'sprungkraft', 'zweikampf'],
  baenderriss: ['tempo', 'sprungkraft'],
  sehne: ['tempo', 'ausdauer', 'sprungkraft'],
  knochenbruch: ['koerper', 'zweikampf', 'ausdauer'],
  faserriss: ['ausdauer', 'tempo'],
  gehirn: ['nervenstaerke', 'uebersicht']
};

/**
 * Prüft und verhängt einen bleibenden Schaden nach schwerer Verletzung.
 * @returns {{ ok, text, verluste:{}, potentialVerlust:number }}
 */
export function langzeitschaden(state, playerId, opts = {}) {
  const p = P(state, playerId);
  if (!p) return fail('Unbekannter Spieler.');
  const m = akte(p);
  const inj = opts.injury || (m.historie.length ? m.historie[m.historie.length - 1] : null);
  if (!inj) return fail('Keine Verletzung in der Akte.');
  const schwere = inj.schwere || 0;
  if (schwere < LANGZEIT_AB_SCHWERE) return fail('Kein Langzeitschaden zu befürchten.');

  const club = C(state, p.clubId);
  const med = medFaktoren(state, club ? club.id : null);
  const rng = opts.rng || detRng(state, 'langzeit', playerId, m.historie.length);

  const alter = p.age || 26;
  const altersRisiko = alter <= 23 ? 0.6 : alter <= 28 ? 0.9 : alter <= 31 ? 1.2 : 1.5;
  const chance = clamp(
    LANGZEIT_GRUNDCHANCE * (schwere - 3) * altersRisiko * (1.35 - med.index / 145) * (1 + m.anfaelligkeit),
    0.03, 0.85
  );
  if (!rng.chance(chance)) {
    return { ok: false, text: `${name(p)} kommt ohne bleibenden Schaden davon.`, verluste: {}, potentialVerlust: 0 };
  }

  const attrs = SCHADEN_ATTRIBUTE[inj.typ] || ['tempo', 'ausdauer'];
  const staerke = (schwere - 3) * (0.9 + rng.next() * 0.8) * (1.25 - med.index / 260);
  const verluste = {};
  for (const key of attrs) {
    const alt = (p.attributes && p.attributes[key]) || 50;
    const minus = Math.max(1, Math.round(staerke * (0.8 + rng.next() * 0.7)));
    p.attributes[key] = clamp(alt - minus, 3, 99);
    verluste[key] = -minus;
  }
  const potMinus = Math.max(0, Math.round((schwere - 3) * (0.8 + rng.next())));
  if (potMinus && p.potential) p.potential = clamp(p.potential - potMinus, 20, 99);
  m.anfaelligkeit = clamp(m.anfaelligkeit + 0.08 * (schwere - 3), 0, 0.7);
  m.langzeitschaeden.push({ saison: state.date.season, typ: inj.typ, verluste, potentialVerlust: potMinus });

  const liste = Object.entries(verluste).map(([k, v]) => `${k} ${v}`).join(', ');
  const text = `Bittere Nachricht: ${name(p)} kommt nicht mehr so zurück, wie er gegangen ist. ` +
    `Die Ärzte sprechen von einem bleibenden Defizit (${liste}).` +
    (med.index < 60 ? ' Mit einer besseren Abteilung wäre das womöglich zu verhindern gewesen.' : '');

  return { ok: true, text, verluste, potentialVerlust: potMinus };
}

/* ==========================================================================
 * 13. Spielnachbereitung (Haken für Match-Engine / Tagesablauf)
 * ======================================================================== */

/**
 * Nach dem Spiel: Belastung buchen, Verletzungen würfeln, Sperren auswerten.
 *
 * @param {Array} einsaetze [{ playerId, minuten, intensitaet }]
 * @param {object} ctx { rng, weather, competitionId, haerte, fixtureId, log, news, difficulty }
 */
export function spielNachbereitung(state, clubId, einsaetze, ctx = {}) {
  const club = C(state, clubId);
  if (!club) return fail('Unbekannter Verein.');
  const k = klinik(club);
  const rng = ctxRng(state, ctx, 'spiel', clubId);
  const competitionId = ctx.competitionId || 'bl1';
  const med = medFaktoren(state, clubId);
  const verletzungen = [];

  for (const e of einsaetze || []) {
    const p = P(state, e.playerId);
    if (!p || p.injury) continue;
    const minuten = clamp(e.minuten || 0, 0, 130);
    if (minuten <= 0) continue;
    fitnessNachSpiel(state, p.id, minuten, e.intensitaet !== undefined ? e.intensitaet : (ctx.intensitaet || 1));

    const risiko = verletzungsrisiko(state, p.id, {
      art: 'spiel', minuten, weather: ctx.weather, haerte: ctx.haerte, med, ctx
    });
    if (rng.chance(risiko)) {
      const minute = e.verletztMinute || rng.int(4, Math.max(5, Math.round(minuten)));
      const res = verletzen(state, p.id, { ursache: 'spiel', minute, rng, ctx });
      if (res.ok) verletzungen.push(res);
    }
  }

  // Schmerzmittel-Roulette: wer gespritzt gespielt hat, riskiert den Folgeschaden.
  for (const e of einsaetze || []) {
    const p = P(state, e.playerId);
    if (!p || p.injury) continue;
    const m = akte(p);
    if (!m.gespritzt) continue;
    if (rng.chance(m.gespritzt.risiko * 0.55)) {
      const res = verletzen(state, p.id, {
        ursache: 'spiel', typ: m.gespritzt.typ, schwere: null, rng, ctx,
        minute: rng.int(30, 90)
      });
      if (res.ok) {
        verletzungen.push(res);
        log(ctx, clubId, state,
          `Das war zu erwarten: ${name(p)} spielte auf Schmerzmittel – jetzt ist es schlimmer als vorher. ` +
          `${res.injury.name}, ${dauerText(res.injury.tageRest)}. Der Mannschaftsarzt sagt nichts. Sein Blick reicht.`,
          'medizin', { subject: `Folgeschaden: ${name(p)}`, from: 'Mannschaftsarzt', wichtig: true });
      }
    }
  }

  const sperren = sperrenPruefen(state, clubId, competitionId, { rng, ctx });

  k.letzterEinsatzTag = state.date.day;
  if (ctx.fixtureId) {
    k.spieleVerarbeitet.push(ctx.fixtureId);
    if (k.spieleVerarbeitet.length > 12) k.spieleVerarbeitet.shift();
  }

  return { ok: true, verletzungen, sperren: sperren.sperren, text: `${verletzungen.length} Verletzung(en), ${sperren.sperren.length} Sperre(n).` };
}

/* ==========================================================================
 * 14. Täglicher Tick
 * ======================================================================== */

function inFenster(day, fenster) { return day >= fenster[0] && day <= fenster[1]; }

function istUrlaub(day) {
  return inFenster(day, SAISON_TAGE.sommerurlaub) || inFenster(day, SAISON_TAGE.winterurlaub);
}

function wochentag(state, ctx) {
  if (ctx && typeof ctx.weekday === 'number') return ctx.weekday;
  return dateFromDayIndex(state.date.day, state.date.season, state.date.startYear || 2025).weekday;
}

/** Spiele eines Vereins an einem bestimmten Tag. */
function spieleAmTag(state, clubId, day) {
  const out = [];
  for (const f of state.fixtures || []) {
    if (f.dayIndex === day && f.season === state.date.season && (f.homeId === clubId || f.awayId === clubId)) out.push(f);
  }
  return out;
}

/** Notfall-Aufstellung, falls niemand spielNachbereitung() gerufen hat. */
function ersatzEinsaetze(state, club, rng) {
  const verfuegbar = squad(state, club).filter(p => !p.injury && !(p.cards && p.cards.ban > 0));
  verfuegbar.sort((a, b) => (b.fitness || 0) + (b.value || 0) / 1e7 - ((a.fitness || 0) + (a.value || 0) / 1e7));
  const elf = verfuegbar.slice(0, 11).map(p => ({ playerId: p.id, minuten: 90 }));
  const bank = verfuegbar.slice(11, 14).map(p => ({ playerId: p.id, minuten: rng.int(12, 35) }));
  for (let i = 0; i < bank.length && i < elf.length; i++) elf[i].minuten = 90 - bank[i].minuten;
  return elf.concat(bank);
}

/**
 * Täglicher medizinischer Tick für ALLE Vereine.
 * Heilung, Rückschläge, Regeneration, Trainingsverletzungen, Krankheiten, Sperren.
 */
export function tickMedizin(state, ctx = {}) {
  if (!state || !state.clubs) return;
  const day = ctx.day !== undefined ? ctx.day : state.date.day;
  const saison = ctx.season !== undefined ? ctx.season : state.date.season;
  const wd = wochentag(state, ctx);
  const urlaub = istUrlaub(day);
  const trainingstag = !urlaub && wd !== 6;
  const rngBasis = ctxRng(state, ctx, 'medizin', day);

  for (const clubId in state.clubs) {
    const club = state.clubs[clubId];
    if (!club || !club.playerIds) continue;
    const istManager = clubId === state.managerClubId;
    const k = klinik(club);
    const med = medFaktoren(state, clubId);
    const rng = rngBasis.fork('med:' + clubId + ':' + day);

    // --- Saisonwechsel: Zähler zurücksetzen ------------------------------
    //
    // Erkannt wird der Wechsel an der Saisonnummer, NICHT mehr an `day === 0`:
    // core/loop.js:advanceDay zählt den Tag hoch, BEVOR es die Vereinsmodule
    // ruft. Der erste Tick einer Saison sieht deshalb Tag 1 – Tag 0 kam hier
    // nie an, und der Reset lief ab Stufe 1 kein einziges Mal mehr.
    //
    // Was das anrichtete (gemessen über drei Saisons): `sperrCursor` blieb auf
    // 363 stehen, verpassteSpieleNachholen() stieg jeden Tag sofort wieder aus
    // und rief damit sperrenAbbauen() nie – Sperren liefen nie ab. Ende
    // Saison 1: 63 gesperrte Spieler. Ende Saison 2: 596, und 25 der 36 Vereine
    // konnten keine elf Mann mehr aufbieten. In Saison 3 traf das alle 36. Die
    // Match-Engine lieferte für solche Partien keine Spielerstatistik mehr,
    // also gab es auch keine Einsätze, keine Belastung und keine
    // Spielverletzungen. Nebenbei liefen `verletzungenSaison` und
    // `ausfalltage.saison` als Mehrjahressummen weiter.
    //
    // Die Saisonnummer als Stempel ist derselbe Weg, den club/finances.js mit
    // `abrechnungSaison` geht (ROADMAP 5.3).
    if (k.saison !== saison) saisonReset(state, club, saison);

    // --- Nachbereitung verpasster Spiele (Sperren, Belastung) ------------
    verpassteSpieleNachholen(state, club, k, day, rng, ctx);

    const spieleHeute = spieleAmTag(state, clubId, day).length > 0;
    const pCtx = { med, urlaub, isMatchdayFuerVerein: spieleHeute, rng };

    let genesungen = 0;
    for (const pid of club.playerIds) {
      const p = state.players[pid];
      if (!p) continue;

      if (p.injury) {
        const r = reha(state, pid, { rng, med, log: ctx.log, news: ctx.news });
        if (r.fertig) genesungen++;
        else if (r.rueckschlag && istManager) {
          log(ctx, clubId, state, r.text, 'medizin',
            { subject: `Rückschlag: ${name(p)}`, from: 'Mannschaftsarzt', wichtig: true });
        }
        regeneration(state, pid, pCtx);
        continue;
      }

      regeneration(state, pid, pCtx);

      const m = akte(p);
      // Schmerzmittel wirken nicht ewig.
      if (m.gespritzt) {
        m.gespritzt.restTage--;
        if (m.gespritzt.restTage <= 0) m.gespritzt = null;
      }

      // Erschöpfung: wer tagelang im roten Bereich läuft, klappt zusammen.
      if ((p.fitness || 100) < FITNESS_ERSCHOEPFT) {
        m.tageKritisch++;
        if (m.tageKritisch >= 3 && rng.chance(0.12)) {
          const res = verletzen(state, pid, { typ: 'erschoepfung', ursache: 'training', rng, ctx });
          if (res.ok) m.tageKritisch = 0;
          continue;
        }
      } else if (m.tageKritisch) m.tageKritisch = 0;

      // Trainingsverletzung
      if (trainingstag && !spieleHeute) {
        const risiko = verletzungsrisiko(state, pid, { art: 'training', med, ctx });
        if (rng.chance(risiko)) { verletzen(state, pid, { ursache: 'training', rng, ctx }); continue; }
      }

      // Privates Missgeschick
      if (rng.chance(BASIS_RISIKO_PRIVAT * (diffOf(state, ctx).injuryRate || 1))) {
        verletzen(state, pid, { ursache: 'privat', rng, ctx });
        continue;
      }

      // Ansteckung während einer Grippewelle
      if (k.grippewelle && rng.chance(WELLE_ANSTECKUNG * k.grippewelle.staerke * (1.25 - med.index / 320))) {
        const res = erkranken(state, pid, { rng });
        if (res.ok && istManager) {
          log(ctx, clubId, state,
            `${res.text} Er bleibt zu Hause, bevor er die halbe Mannschaft ansteckt.`,
            'medizin', { subject: `Krankmeldung: ${name(p)}`, from: 'Mannschaftsarzt' });
        }
      }
    }

    // --- Grippewelle ------------------------------------------------------
    grippewelle(state, club, k, med, day, rng, ctx);

    // --- Wochenbericht ----------------------------------------------------
    if (istManager && ctx.isWeekStart && day - k.letzteWarnung >= 6) {
      const bel = belastungssteuerung(state, clubId);
      const akut = bel.warnungen.filter(w => w.stufe === 2);
      if (akut.length) {
        k.letzteWarnung = day;
        log(ctx, clubId, state,
          `Belastungssteuerung – die Woche im Überblick:\n\n${akut.map(w => '• ' + w.text).join('\n')}\n\n` +
          `Ein Spieler auf der Bank ist immer noch billiger als ein Spieler im Gips.`,
          'medizin', { subject: 'Warnung: Überlastung', from: 'Athletikabteilung' });
      }
    }

    if (genesungen >= 3 && istManager) {
      news(ctx, clubId, state, `Das Lazarett leert sich: ${genesungen} Rückkehrer im Mannschaftstraining.`, 'medizin');
    }
  }
}

function saisonReset(state, club, saison = state.date.season) {
  const k = klinik(club);
  k.saison = saison;
  k.kosten.saison = 0;
  k.ausfalltage.saison = 0;
  k.verletzungenSaison = 0;
  k.sperrCursor = -1;
  k.spieleVerarbeitet = [];
  k.letzteWarnung = -99;
  for (const pid of club.playerIds || []) {
    const p = state.players[pid];
    if (!p) continue;
    akte(p).ausfalltage.saison = 0;
    const c = karten(p);
    c.yellow = 0; c.red = 0; c.seasonYellow = 0; c.gelbrot = 0;
    c.compYellow = {}; c.gelbSperren = {}; c.gelbrotVerbucht = 0; c.rotVerbucht = 0;
  }
}

/**
 * Holt Belastung und Sperrauswertung für bereits gespielte Partien nach, die
 * niemand über spielNachbereitung() gemeldet hat. Doppelbuchung ausgeschlossen.
 */
function verpassteSpieleNachholen(state, club, k, day, rng, ctx) {
  const von = k.sperrCursor;
  if (von >= day - 1) return;
  for (const f of state.fixtures || []) {
    if (f.season !== state.date.season) continue;
    if (f.dayIndex >= day || f.dayIndex <= von) continue;
    if (f.homeId !== club.id && f.awayId !== club.id) continue;
    if (!f.played) continue;

    const gemeldet = k.spieleVerarbeitet.indexOf(f.id) >= 0 || k.letzterEinsatzTag === f.dayIndex;
    if (!gemeldet) {
      const einsaetze = ersatzEinsaetze(state, club, rng);
      spielNachbereitung(state, club.id, einsaetze, {
        rng, competitionId: f.competitionId, fixtureId: f.id, log: ctx.log, news: ctx.news, difficulty: ctx.difficulty
      });
    }
    sperrenAbbauen(state, club, f.competitionId, ctx, f.dayIndex);
  }
  k.sperrCursor = day - 1;
}

function grippewelle(state, club, k, med, day, rng, ctx) {
  if (k.grippewelle) {
    k.grippewelle.restTage--;
    if (k.grippewelle.restTage <= 0) k.grippewelle = null;
    return;
  }
  const winter = inFenster(day, WELLE_FENSTER);
  const p = (winter ? WELLE_CHANCE_WINTER : WELLE_CHANCE_SONST) * (1.3 - med.index / 260);
  if (!rng.chance(p)) return;
  k.grippewelle = {
    restTage: rng.int(WELLE_DAUER[0], WELLE_DAUER[1]),
    staerke: round(0.7 + rng.next() * 0.8, 2)
  };
  log(ctx, club.id, state,
    `Die Kabine hustet im Kanon. Der Mannschaftsarzt meldet eine Grippewelle und verteilt Tee, ` +
    `Vitamintabletten und schlechte Laune. In den nächsten Tagen wird der eine oder andere ausfallen.\n\n` +
    `Empfehlung: Trainingsintensität herunterfahren, Türklinken desinfizieren, beten.`,
    'medizin', { subject: 'Grippewelle im Verein', from: 'Mannschaftsarzt', wichtig: true });
  news(ctx, club.id, state, 'Grippewelle grassiert in der Kabine.', 'medizin');
}

/* ==========================================================================
 * 15. Zusatz-Exporte für Screens
 * ======================================================================== */

export { INJURY_TYPES, KRANKHEITEN };
