/**
 * club/chemie.js — Eingespieltheit, Mentoren, Cliquen. Die Kabine als Spielprinzip.
 * ============================================================================
 *
 * TRAUMVEREIN hat einen Einfall, den kein anderer Manager hat: Vereinslegenden
 * und aktuelle Profis in einer Elf. Bis Stufe 3 war das eine Startaufstellung —
 * `club.chemistryHistory` stand bei 30, wurde von `engine/ratings.js` brav
 * gelesen und hat sich nie bewegt. Dieses Modul macht daraus eine Mechanik:
 *
 *   1. EINGESPIELTHEIT WÄCHST mit gemeinsamen Einsatzminuten und fällt bei
 *      Fluktuation, Streit und in der Sommerpause.
 *   2. MENTOREN — eine Legende nimmt ein Talent unter die Fittiche.
 *   3. CLIQUEN — die Gruppenebene über den Beziehungen aus `club/morale.js`.
 *
 * ---------------------------------------------------------------------------
 * DER KOMPROMISS BEIM SPIELSTAND (Roadmap Stufe 4, Punkt 1)
 * ---------------------------------------------------------------------------
 * Paarweise Eingespieltheit für alle 1.100 Spieler wäre quadratisch: rund
 * 600.000 Paare, ein Vielfaches des heutigen Spielstands. Deshalb:
 *
 *   • PAARWEISE nur für den Verein des Managers  →  `club.chemie.paare`
 *     28 Mann ergeben höchstens 378 Paare; gespeichert wird nur, was wirklich
 *     zusammen gespielt hat (typisch 150–300 Einträge, rund 15 kB).
 *   • VEREINSMITTELWERT für alle KI-Vereine      →  `club.chemistryHistory`
 *     Eine Zahl je Verein, fortgeschrieben nach demselben Gesetz.
 *   • Wechselt der Manager den Verein, wird `club.chemie` beim alten Verein
 *     GELÖSCHT (`aufraeumenFremdeVereine`) — die Paare wandern nicht mit.
 *
 * Warum die Paare als 0..100-Werte gespeichert werden und nicht als
 * Minutenzähler: Ein Zähler wäre kompakter, würde aber nach zwei Saisons über
 * 100 laufen und jede Wertebereichsprüfung (`tools/test-chemie.js` Z06) zu
 * Recht anschlagen. Ein Wert je Paar ist dieselbe Größe und direkt lesbar.
 *
 * ---------------------------------------------------------------------------
 * DIE ÄRA-MISCHUNG IST DER KERN
 * ---------------------------------------------------------------------------
 * Zwei Legenden derselben Ära verstehen sich vom ersten Tag an (Basis ~46),
 * zwei moderne Profis fast genauso gut (~40). Eine Legende neben einem
 * 22-jährigen Instagram-Profi startet bei ~11 — und holt über gemeinsame
 * Spielzeit deutlich schneller auf (Tempo 0,048 statt 0,030), ohne die
 * homogene Elf je ganz einzuholen (Deckel 87 statt 96).
 *
 * Das ist der Preis des Konzepts: Wer Netzer und Beckenbauer neben zwei
 * Zwanzigjährige stellt, zahlt eine halbe Saison lang dafür — und wird dann
 * belohnt.
 *
 * ---------------------------------------------------------------------------
 * ZUSTÄNDIGKEIT (CONTRACTS.md §11)
 * ---------------------------------------------------------------------------
 * Dieses Modul schreibt: `club.chemistryHistory`, `club.chemie.*`,
 * `player.mentor`, `player.mentees`, `player.personality` (Abfärbung durch den
 * Mentor), `player.number` (Erbe der Rückennummer beim Karriereende).
 * Es fasst NICHT an: Moral (morale.js), Attribute (training.js), Kader
 * (transfers.js). Die Gruppenbildung selbst wohnt in `morale.js`
 * (`cliquenGruppen`) — dort liegen die Beziehungen, auf denen sie aufsetzt;
 * hier steht nur die Aufbereitung für Vertrag und Bildschirm.
 *
 * Kein DOM, kein Math.random(), kein Date.now().
 */

import { clamp, round, avg, sortBy } from '../core/util.js';
import { createRng, hashString } from '../core/rng.js';
import { POSITION_GROUP, POSITION_NAMES, NATION_NAMES } from '../core/constants.js';
import { playerOverall } from '../engine/ratings.js';
import { hierarchie, beziehungen, offeneKonflikte, cliquenGruppen, CLIQUEN_ARTEN } from './morale.js';
import { istUrlaub } from './training.js';

/* ==========================================================================
 * 1. BALANCING — alle Stellschrauben an einem Ort
 * ======================================================================== */

/** Startniveau eines Paares. Deckt sich mit `club.chemistryHistory = 30` aus core/state.js. */
const PAAR_NIVEAU = 30;

/** Ära-Zuschläge auf das Startniveau. Der Kern des Spiels steht in diesen vier Zahlen. */
const AERA_GLEICHE_AERA = 16;    // zwei Legenden desselben Jahrgangs — die kennen sich
const AERA_LEGENDEN = 8;         // zwei Legenden verschiedener Ären
const AERA_MODERN = 10;          // zwei aktuelle Profis
const AERA_GEMISCHT = -19;       // Legende neben Moderne — hier wird es teuer

/** Weitere Paarmerkmale. */
const NATION_BONUS = 6;          // gleiche Nationalität
const MANNSCHAFTSTEIL = 4;       // gleiche Positionsgruppe (Abwehr, Mittelfeld, Sturm)
const POSITION_KONKURRENZ = -4;  // exakt dieselbe Position — Konkurrenz statt Freundschaft
const ALTER_JE = -0.7;           // je Jahr Altersunterschied über 5
const ALTER_MAX = 14;            // mehr als 14 Jahre Unterschied ändern nichts mehr
const FREUND_BONUS = 7;          // Freundschaft aus morale.js:beziehungen()
const RIVALEN_MALUS = -9;        // Rivalität ebendaher

/** Wachstum je gemeinsamem Spiel (Anteil der verbleibenden Spanne zum Deckel). */
const TEMPO_HOMOGEN = 0.030;
const TEMPO_GEMISCHT = 0.048;    // die Mischung holt auf …
const DECKEL_HOMOGEN = 96;
const DECKEL_GEMISCHT = 87;      // … kommt aber nie ganz heran

/** Untere und obere Schranke jedes gespeicherten Paarwerts. */
const PAAR_MIN = 0;
const PAAR_MAX = 100;

/** Fluktuation, Streit, Sommerpause. */
const OFFSET_HEILUNG = 0.0012;   // je Tag; ein Umbruch verliert in einer Saison ~35 % Schrecken
const OFFSET_MIN = -45;
const OFFSET_MAX = 12;
const KONFLIKT_JE_TAG = -0.45;   // je Tag und Schwerestufe auf das zerstrittene Paar
const SOMMER_ZERFALL = 0.006;    // je Urlaubstag Richtung Basiswert

/** Vereinsmittelwert der KI-Vereine. */
const KI_TEMPO = 0.045;          // je ausgetragenem Spiel
const KI_ZIEL_MAX = 86;          // Kader aus einem Guss
const KI_ZIEL_MIN = 66;          // hälftig gemischter Kader
const KI_SOMMER = -0.05;         // je Urlaubstag

/** Wie viele Spieler den Vereinswert tragen (die Stammelf plus Rotation). */
const STAMM_GROESSE = 14;

/* --- Mentoren ------------------------------------------------------------- */

const MENTOR_MIN_ALTER = 28;         // darunter ist niemand Mentor
const TALENT_MAX_ALTER = 23;         // darüber braucht niemand mehr einen
const TALENT_MIN_LUFT = 5;           // Potenzial minus Overall
const MENTOR_MAX_TALENTE = 2;        // mehr schafft niemand
const MENTOR_MIN_STAERKE = 34;       // schwächere Paarungen werden nicht von selbst geschlossen
const MENTOR_BILDUNG_CHANCE = 0.55;  // Würfel je Vorschlag, wenn ein Platz frei ist
const MENTOR_PRUEFTAGE = 30;         // alle 30 Tage schaut der Co-Trainer nach neuen Paaren

/** Abfärbung der Persönlichkeit: Anteil je Monat, ab wann der Typ kippt. */
const ABFAERBUNG_JE_MONAT = 0.115;
const ABFAERBUNG_UEBERNAHME = 0.72;

/** Erzählung (Roadmap: „die billigste Idee mit der größten Wirkung"). */
const ERZAEHLUNG_ZWISCHEN = 12;      // Overall-Gewinn unter dem Mentor
const ERZAEHLUNG_GROSS = 30;         // die Schwelle aus der Roadmap

/* --- Cliquen -------------------------------------------------------------- */

const CLIQUE_MAX_JE_SPIELER = 3;
const CLIQUE_MIN = 2;
const CLIQUE_MAX = 8;

/* ==========================================================================
 * 2. Lazy-Init & kleine Helfer
 * ======================================================================== */

const tag = state => (state && state.date ? state.date.day : 0);
const saison = state => (state && state.date ? state.date.season : 1);
const zeitpunkt = state => ({ season: saison(state), day: tag(state) });

function spielerName(p) { return p ? (p.shortName || p.lastName || p.id) : 'Der Spieler'; }
function vollName(p) { return p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() || spielerName(p) : 'Der Spieler'; }
function nationName(p) { return NATION_NAMES[p && p.nationality] || 'Ausland'; }
function posName(p) { return POSITION_NAMES[p && p.position] || 'Feldspieler'; }
function vereinKurz(state, clubId) {
  const c = state.clubs[clubId];
  return c ? (c.shortName || c.name || clubId) : String(clubId);
}

/** Stabiler Paarschlüssel — die Reihenfolge der beiden IDs darf nichts ändern. */
export function paarKey(aId, bId) { return aId < bId ? aId + '|' + bId : bId + '|' + aId; }

/** Deterministische Rng ohne Math.random. Nutzt die übergebene, wenn vorhanden. */
function chemieRng(state, ctx, label) {
  if (ctx && ctx.rng && typeof ctx.rng.fork === 'function') return ctx.rng.fork('chemie:' + label);
  return createRng(hashString('chemie:' + label + '|' + ((state && state.seed) | 0) + '|' + saison(state)));
}

function kaderVon(state, clubId) {
  const club = state.clubs[clubId];
  if (!club || !Array.isArray(club.playerIds)) return [];
  const out = [];
  for (const id of club.playerIds) {
    const p = state.players[id];
    if (p && !p.retired) out.push(p);
  }
  return out;
}

/**
 * Der Chemie-Datensatz eines Vereins. Wird NUR für den Verein des Managers
 * angelegt — alle anderen kommen mit `club.chemistryHistory` aus.
 *
 * Der Versatz `offset` ist das Gedächtnis für Fluktuation: `transfers.js` und
 * `karriere.js` ziehen bei jedem Zugang 4 Punkte von `chemistryHistory` ab.
 * Dieses Modul erkennt den Abzug daran, dass der Wert unter dem selbst zuletzt
 * geschriebenen `leitwert` liegt, und verrechnet ihn auf alle Paare. So bleibt
 * die vorhandene Konvention gültig, ohne dass transfers.js angefasst wird.
 */
function chemieAkte(club) {
  if (!club.chemie) {
    club.chemie = {
      paare: {},
      offset: 0,
      leitwert: null,
      mentoren: [],
      gebucht: [],
      stand: { saison: 1, tag: -1 },
      mentorPruefung: -999
    };
  }
  const c = club.chemie;
  if (!c.paare) c.paare = {};
  if (!Array.isArray(c.mentoren)) c.mentoren = [];
  if (!Array.isArray(c.gebucht)) c.gebucht = [];
  if (!c.stand) c.stand = { saison: 1, tag: -1 };
  if (c.offset === undefined || !Number.isFinite(c.offset)) c.offset = 0;
  if (c.mentorPruefung === undefined) c.mentorPruefung = -999;
  return c;
}

/** Hat dieser Verein ein eigenes Paargitter? (Nur der Verein des Managers.) */
function hatGitter(state, clubId) {
  const club = state.clubs[clubId];
  return !!(club && club.chemie && club.chemie.paare && clubId === state.managerClubId);
}

/* ==========================================================================
 * 3. Paarwerte — hier steckt die Ära-Mischung
 * ======================================================================== */

/** Sind die beiden aus verschiedenen Welten? */
function gemischt(a, b) {
  return (a.era === 'legend') !== (b.era === 'legend');
}

/** Startwert eines Paares, bevor auch nur eine Minute zusammen gespielt wurde. */
export function paarBasis(a, b) {
  if (!a || !b) return PAAR_NIVEAU;
  let w = PAAR_NIVEAU;

  if (a.era === 'legend' && b.era === 'legend') {
    w += (a.eraLabel && a.eraLabel === b.eraLabel) ? AERA_GLEICHE_AERA : AERA_LEGENDEN;
  } else if (a.era !== 'legend' && b.era !== 'legend') {
    w += AERA_MODERN;
  } else {
    w += AERA_GEMISCHT;
  }

  if (a.nationality && a.nationality === b.nationality) w += NATION_BONUS;
  if (a.position && a.position === b.position) w += POSITION_KONKURRENZ;
  else if (POSITION_GROUP[a.position] && POSITION_GROUP[a.position] === POSITION_GROUP[b.position]) w += MANNSCHAFTSTEIL;

  const dAlter = Math.abs((a.age || 26) - (b.age || 26));
  w += clamp(dAlter - 5, 0, ALTER_MAX) * ALTER_JE;

  return clamp(w, 2, 96);
}

function paarDeckel(a, b) { return gemischt(a, b) ? DECKEL_GEMISCHT : DECKEL_HOMOGEN; }
function paarTempo(a, b) { return gemischt(a, b) ? TEMPO_GEMISCHT : TEMPO_HOMOGEN; }

/**
 * Paarweise Eingespieltheit zweier Spieler, 0..100.
 *
 * Für den Verein des Managers aus dem gepflegten Gitter, für alle anderen aus
 * dem Vereinsmittelwert plus der Paar-Eigenart (Ära, Nation, Alter). So
 * reagiert auch ein KI-Verein plausibel auf seine Kadermischung, ohne dass
 * dafür ein einziges Byte im Spielstand liegt.
 */
export function paarChemie(state, aId, bId) {
  const a = state.players[aId], b = state.players[bId];
  if (!a || !b || aId === bId) return PAAR_NIVEAU;
  const clubId = a.clubId;
  if (!clubId || clubId !== b.clubId) {
    // Zwei Spieler aus verschiedenen Vereinen kennen sich schlicht nicht.
    return clamp(round(paarBasis(a, b) * 0.6, 1), PAAR_MIN, PAAR_MAX);
  }
  const club = state.clubs[clubId];
  if (!club) return PAAR_NIVEAU;

  if (hatGitter(state, clubId)) {
    const gespeichert = club.chemie.paare[paarKey(aId, bId)];
    if (Number.isFinite(gespeichert)) return gespeichert;
    return clamp(round(paarBasis(a, b) + (club.chemie.offset || 0), 1), PAAR_MIN, PAAR_MAX);
  }

  // KI-Verein: der Vereinswert trägt das Niveau, die Paar-Eigenart moduliert.
  const niveau = Number.isFinite(club.chemistryHistory) ? club.chemistryHistory : PAAR_NIVEAU;
  return clamp(round(niveau + (paarBasis(a, b) - PAAR_NIVEAU) * 0.8, 1), PAAR_MIN, PAAR_MAX);
}

/**
 * Eingespieltheit einer Elf (oder eines ganzen Vereins), 0..100.
 *
 * Ohne `playerIds` ist es der Leitwert des Vereins — genau die Zahl, die
 * `core/loop.js:buildMatchTeam` als `matchTeam.chemistryHistory` an die Engine
 * durchreicht. Mit `playerIds` das Mittel über alle Paare dieser Aufstellung;
 * dort wird die Ära-Mischung unmittelbar sichtbar.
 */
export function chemieWert(state, clubId, playerIds = null) {
  const club = state && state.clubs ? state.clubs[clubId] : null;
  if (!club) return PAAR_NIVEAU;

  if (!playerIds) {
    return clamp(round(Number.isFinite(club.chemistryHistory) ? club.chemistryHistory : PAAR_NIVEAU, 1), 0, 100);
  }

  const ids = playerIds.filter(id => state.players[id]);
  if (ids.length < 2) return clamp(round(Number.isFinite(club.chemistryHistory) ? club.chemistryHistory : PAAR_NIVEAU, 1), 0, 100);

  let summe = 0, n = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) { summe += paarChemie(state, ids[i], ids[j]); n++; }
  }
  return n ? clamp(round(summe / n, 1), 0, 100) : PAAR_NIVEAU;
}

/**
 * Eingespieltheit einer konkreten Elf — der sprechende Name derselben Sache.
 * (Roadmap-Stufe 4 nennt sie `eingespieltheit`, der Prüfstand `chemieWert`.)
 */
export function eingespieltheit(state, clubId, spielerIds = null) {
  return chemieWert(state, clubId, spielerIds);
}

/** Die Spieler, die den Vereinswert tragen: meiste Saisonminuten, sonst die Aufstellung. */
function stammKader(state, clubId) {
  const kader = kaderVon(state, clubId);
  if (kader.length < 2) return kader.map(p => p.id);
  const mitMinuten = kader.filter(p => p.stats && p.stats.season && (p.stats.season.minuten || 0) > 0);
  if (mitMinuten.length >= 11) {
    return sortBy(mitMinuten, p => ({ key: p.stats.season.minuten || 0, desc: true }))
      .slice(0, STAMM_GROESSE).map(p => p.id);
  }
  const club = state.clubs[clubId];
  const elf = [];
  if (club.tactics && club.tactics.lineup) {
    for (const slot in club.tactics.lineup) {
      const id = club.tactics.lineup[slot];
      if (id && state.players[id] && state.players[id].clubId === clubId) elf.push(id);
    }
  }
  if (elf.length >= 7) return elf;
  return sortBy(kader, p => ({ key: playerOverall(p), desc: true })).slice(0, STAMM_GROESSE).map(p => p.id);
}

/* ==========================================================================
 * 4. Einsatzminuten verbuchen
 * ======================================================================== */

/**
 * Normalisiert die verschiedenen Formen, in denen Einsatzminuten hereinkommen:
 * `[{playerId, minuten}]`, `{ pid: minuten }` oder eine ID-Liste plus eine Zahl.
 */
function minutenKarte(playerIds, minuten) {
  const out = {};
  if (Array.isArray(playerIds)) {
    for (const e of playerIds) {
      if (typeof e === 'string') out[e] = Number.isFinite(minuten) ? minuten : 90;
      else if (e && e.playerId) out[e.playerId] = Number.isFinite(e.minuten) ? e.minuten : 90;
    }
  } else if (playerIds && typeof playerIds === 'object') {
    for (const k in playerIds) if (Number.isFinite(playerIds[k])) out[k] = playerIds[k];
  }
  if (minuten && typeof minuten === 'object' && !Array.isArray(minuten)) {
    for (const k in minuten) if (Number.isFinite(minuten[k])) out[k] = minuten[k];
  }
  return out;
}

/**
 * Gemeinsame Einsatzminuten einer Aufstellung verbuchen.
 *
 * Aufrufer: `tickChemie()` selbst (aus dem Spielplan) und — sobald verdrahtet —
 * `core/loop.js:applyResult()`. Doppelbuchungen verhindert `ctx.fixtureId`.
 *
 * @returns {{ ok:boolean, paare:number, wert:number, text:string }}
 */
export function einsatzVerbuchen(state, clubId, playerIds, minuten, ctx = {}) {
  const club = state && state.clubs ? state.clubs[clubId] : null;
  if (!club) return { ok: false, paare: 0, wert: PAAR_NIVEAU, text: 'Verein unbekannt.' };

  const karte = minutenKarte(playerIds, minuten);
  const ids = Object.keys(karte).filter(id => {
    const p = state.players[id];
    return p && p.clubId === clubId && (karte[id] || 0) > 0;
  });

  const eigen = clubId === state.managerClubId;

  if (eigen) {
    const c = chemieAkte(club);
    if (ctx.fixtureId) {
      if (c.gebucht.includes(ctx.fixtureId)) {
        return { ok: false, paare: 0, wert: chemieWert(state, clubId), text: 'Diese Partie ist bereits verbucht.' };
      }
      c.gebucht.push(ctx.fixtureId);
      while (c.gebucht.length > 8) c.gebucht.shift();
    }
    let n = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        paarWachsen(state, club, c, ids[i], ids[j], Math.min(karte[ids[i]], karte[ids[j]]) / 90);
        n++;
      }
    }
    leitwertSchreiben(state, club, c);
    return { ok: true, paare: n, wert: club.chemistryHistory, text: `${ids.length} Spieler, ${n} Paare fortgeschrieben.` };
  }

  // KI-Verein: nur der Mittelwert. Eine Zahl, kein Gitter.
  kiMittelSchritt(state, club, ids.length);
  return { ok: true, paare: 0, wert: club.chemistryHistory, text: 'Vereinsmittelwert fortgeschrieben.' };
}

/**
 * Die Fassung aus der Roadmap: „Chemie nach einem Spiel".
 * `einsatzminuten` darf `{ pid: minuten }` oder `[{ playerId, minuten }]` sein.
 */
export function chemieNachSpiel(state, clubId, einsatzminuten, ctx = {}) {
  return einsatzVerbuchen(state, clubId, einsatzminuten, null, ctx);
}

/** Ein Paar um den Anteil eines gemeinsamen Spiels heben. */
function paarWachsen(state, club, c, aId, bId, anteil) {
  const a = state.players[aId], b = state.players[bId];
  if (!a || !b) return;
  const k = paarKey(aId, bId);
  const alt = Number.isFinite(c.paare[k]) ? c.paare[k] : (paarBasis(a, b) + (c.offset || 0));
  const deckel = clamp(paarDeckel(a, b) + (c.offset || 0), 5, PAAR_MAX);
  const schritt = paarTempo(a, b) * clamp(anteil, 0, 1.2);
  const neu = alt + (deckel - alt) * schritt;
  c.paare[k] = clamp(round(neu, 1), PAAR_MIN, PAAR_MAX);
}

/** Vereinsmittelwert eines KI-Vereins fortschreiben (ein Spiel). */
function kiMittelSchritt(state, club, eingesetzt) {
  const kader = kaderVon(state, club.id);
  if (kader.length < 5) return;
  const legenden = kader.filter(p => p.era === 'legend').length;
  const minderheit = Math.min(legenden, kader.length - legenden) / kader.length;   // 0 … 0,5
  const ziel = KI_ZIEL_MAX - (KI_ZIEL_MAX - KI_ZIEL_MIN) * clamp(minderheit / 0.5, 0, 1);
  const alt = Number.isFinite(club.chemistryHistory) ? club.chemistryHistory : PAAR_NIVEAU;
  const anteil = clamp((eingesetzt || 11) / 11, 0.4, 1.2);
  club.chemistryHistory = clamp(round(alt + (ziel - alt) * KI_TEMPO * anteil, 1), 0, 100);
}

/** Den Leitwert aus dem Paargitter zurück nach `club.chemistryHistory` schreiben. */
function leitwertSchreiben(state, club, c) {
  const stamm = stammKader(state, club.id);
  if (stamm.length < 2) return;
  let summe = 0, n = 0;
  for (let i = 0; i < stamm.length; i++) {
    for (let j = i + 1; j < stamm.length; j++) { summe += paarChemie(state, stamm[i], stamm[j]); n++; }
  }
  if (!n) return;
  club.chemistryHistory = clamp(round(summe / n, 1), 0, 100);
  c.leitwert = club.chemistryHistory;
}

/* ==========================================================================
 * 5. tickChemie — der Tagesablauf
 * ======================================================================== */

/**
 * Tagesroutine im Muster der übrigen `club/`-Module.
 * ctx = { rng, day, isMatchday, log, news }
 *
 * Reihenfolge innerhalb des Tages:
 *   1. Fremde Paargitter wegräumen (der Manager hat den Verein gewechselt)
 *   2. Fluktuation aus `transfers.js`/`karriere.js` übernehmen
 *   3. Partien seit der letzten Buchung verbuchen
 *   4. Streit und Sommerpause abziehen, Umbruch heilen
 *   5. Mentoren pflegen: lösen, abfärben, erzählen, neue Paare bilden
 */
export function tickChemie(state, ctx = {}) {
  if (!state || !state.clubs) return;
  const heute = ctx.day !== undefined ? ctx.day : tag(state);
  const meinId = state.managerClubId;

  aufraeumenFremdeVereine(state);

  const club = meinId ? state.clubs[meinId] : null;
  if (club && Array.isArray(club.playerIds)) {
    const c = chemieAkte(club);
    const erstesMal = c.leitwert === null || c.leitwert === undefined;

    if (erstesMal) {
      // Startaufnahme: Der Verein bringt sein Niveau mit. Liegt es unter 30,
      // hat jemand vor dem ersten Anpfiff schon eingekauft (transfers.js:−4).
      c.offset = clamp(round((Number.isFinite(club.chemistryHistory) ? club.chemistryHistory : PAAR_NIVEAU) - PAAR_NIVEAU, 2),
        OFFSET_MIN, OFFSET_MAX);
    } else {
      fluktuationUebernehmen(club, c);
    }

    spieleVerbuchen(state, club, c, heute);
    paareAbnutzen(state, club, c, heute);
    paareBereinigen(state, club, c);
    leitwertSchreiben(state, club, c);
    c.stand = { saison: saison(state), tag: heute };
  }

  // KI-Vereine: Der Mittelwert folgt den Partien von gestern.
  const gestern = heute - 1;
  const aktuell = saison(state);
  for (const fx of state.fixtures || []) {
    if (!fx || !fx.played || fx.dayIndex !== gestern) continue;
    if (fx.season !== undefined && fx.season !== aktuell) continue;
    for (const cid of [fx.homeId, fx.awayId]) {
      if (!cid || cid === meinId) continue;
      const k = state.clubs[cid];
      if (!k || k.lazySquad || !Array.isArray(k.playerIds) || k.playerIds.length < 11) continue;
      kiMittelSchritt(state, k, 11);
    }
  }

  if (istUrlaub(heute)) {
    for (const cid in state.clubs) {
      if (cid === meinId) continue;
      const k = state.clubs[cid];
      if (!k || !Number.isFinite(k.chemistryHistory)) continue;
      k.chemistryHistory = clamp(round(k.chemistryHistory + KI_SOMMER, 1), 0, 100);
    }
  }

  mentorenPflegen(state, ctx, heute);
}

/** Die von der Roadmap gewünschte Schreibweise desselben Ticks. */
export function tickKabine(state, ctx = {}) { return tickChemie(state, ctx); }

/**
 * Wechselt der Manager den Verein, verschwinden die alten Paare.
 * Der Leitwert bleibt — der neue Trainer erbt eine Mannschaft, keine Akte.
 */
function aufraeumenFremdeVereine(state) {
  const meinId = state.managerClubId;
  for (const cid in state.clubs) {
    if (cid === meinId) continue;
    const k = state.clubs[cid];
    if (k && k.chemie) delete k.chemie;
  }
}

/**
 * `transfers.js:1833` und `karriere.js:886` ziehen bei Zugängen 4 Punkte von
 * `chemistryHistory` ab. Dieses Modul erkennt den Abzug am Vergleich mit dem
 * selbst zuletzt geschriebenen Leitwert und verrechnet ihn auf alle Paare —
 * so bleibt die vorhandene Konvention gültig und niemand muss transfers.js
 * anfassen.
 */
function fluktuationUebernehmen(club, c) {
  const ist = Number.isFinite(club.chemistryHistory) ? club.chemistryHistory : PAAR_NIVEAU;
  const delta = ist - c.leitwert;
  if (delta >= -0.4) return;                     // nichts passiert (oder jemand hat erhöht)
  c.offset = clamp(round(c.offset + delta, 2), OFFSET_MIN, OFFSET_MAX);
  for (const k in c.paare) {
    c.paare[k] = clamp(round(c.paare[k] + delta, 1), PAAR_MIN, PAAR_MAX);
  }
}

/** Alle seit der letzten Buchung ausgetragenen eigenen Partien nachtragen. */
function spieleVerbuchen(state, club, c, heute) {
  const aktuell = saison(state);
  const offen = [];
  for (const fx of state.fixtures || []) {
    if (!fx || !fx.played) continue;
    if (fx.season !== undefined && fx.season !== aktuell) continue;
    if (fx.homeId !== club.id && fx.awayId !== club.id) continue;
    if (fx.dayIndex > heute || fx.dayIndex < heute - 30) continue;
    if (c.gebucht.includes(fx.id)) continue;
    offen.push(fx);
  }
  if (!offen.length) return;
  offen.sort((a, b) => (a.dayIndex || 0) - (b.dayIndex || 0));

  for (const fx of offen) {
    const minuten = einsatzAusFixture(state, club, fx);
    einsatzVerbuchen(state, club.id, minuten, null, { fixtureId: fx.id });
  }
}

/**
 * Wer hat in dieser Partie gespielt? Bevorzugt die tatsächlichen Minuten aus
 * der Statistik; wo die Engine nichts geliefert hat (Freilose, abgebrochene
 * Partien), fällt es auf die Aufstellung zurück.
 */
function einsatzAusFixture(state, club, fx) {
  const karte = {};
  const einsaetze = fx.einsaetze && (fx.einsaetze[club.id] || null);
  if (Array.isArray(einsaetze) && einsaetze.length) {
    for (const e of einsaetze) if (e && e.playerId) karte[e.playerId] = e.minuten || 90;
    return karte;
  }
  if (club.tactics && club.tactics.lineup) {
    for (const slot in club.tactics.lineup) {
      const id = club.tactics.lineup[slot];
      const p = id && state.players[id];
      if (p && p.clubId === club.id) karte[id] = 90;
    }
  }
  return karte;
}

/** Streit und Sommerpause. Beides zieht — leise, aber jeden Tag. */
function paareAbnutzen(state, club, c, heute) {
  // Umbruch heilt: Nach zwei Saisons redet niemand mehr vom großen Umbau.
  if (c.offset < 0) c.offset = clamp(round(c.offset * (1 - OFFSET_HEILUNG), 3), OFFSET_MIN, OFFSET_MAX);

  const streit = offeneKonflikte(state, club.id);
  for (const k of streit) {
    const ids = Array.isArray(k.playerIds) ? k.playerIds : [];
    const schwere = clamp(k.schwere || 1, 1, 3);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = paarKey(ids[i], ids[j]);
        if (!Number.isFinite(c.paare[key])) continue;
        c.paare[key] = clamp(round(c.paare[key] + KONFLIKT_JE_TAG * schwere, 1), PAAR_MIN, PAAR_MAX);
      }
    }
  }

  if (!istUrlaub(heute)) return;
  for (const key in c.paare) {
    const [aId, bId] = key.split('|');
    const a = state.players[aId], b = state.players[bId];
    const basis = clamp((a && b ? paarBasis(a, b) : PAAR_NIVEAU) + c.offset, PAAR_MIN, PAAR_MAX);
    const wert = c.paare[key];
    if (wert <= basis) continue;
    c.paare[key] = clamp(round(wert - (wert - basis) * SOMMER_ZERFALL, 1), PAAR_MIN, PAAR_MAX);
  }
}

/** Paare, an denen ein Spieler beteiligt ist, der nicht mehr im Verein steht, fliegen raus. */
function paareBereinigen(state, club, c) {
  const drin = new Set(club.playerIds || []);
  for (const key in c.paare) {
    const i = key.indexOf('|');
    if (i < 0) { delete c.paare[key]; continue; }
    if (!drin.has(key.slice(0, i)) || !drin.has(key.slice(i + 1))) delete c.paare[key];
  }
}

/* ==========================================================================
 * 6. Mentoren — die beste Idee der Roadmap
 * ======================================================================== */

/**
 * Wie gut passen Legende und Talent zueinander? 0..100.
 * Position, Nationalität, Persönlichkeit und Hackordnung — die Hackordnung
 * kommt aus `morale.js:hierarchie()`, gebaut wird hier nichts doppelt.
 */
function passung(state, mentor, talent, einfluss, freundschaft) {
  if (!mentor || !talent) return 0;
  let w = 20;

  // Position: derselbe Mannschaftsteil zählt, dieselbe Position zählt doppelt.
  if (mentor.position === talent.position) w += 22;
  else if (POSITION_GROUP[mentor.position] && POSITION_GROUP[mentor.position] === POSITION_GROUP[talent.position]) w += 12;
  else w -= 4;

  if (mentor.nationality && mentor.nationality === talent.nationality) w += 12;

  // Hackordnung: Wer nichts zu sagen hat, kann auch niemanden erziehen.
  w += clamp((einfluss - 35) / 65, 0, 1) * 22;

  // Persönlichkeit: Musterprofis und Führungstypen taugen, Querulanten nicht.
  const mp = (mentor.personality && mentor.personality.id) || 'profi';
  const tp = (talent.personality && talent.personality.id) || 'profi';
  if (mp === 'fuehrungstyp') w += 12;
  else if (mp === 'profi' || mp === 'loyal') w += 8;
  else if (mp === 'schwierig' || mp === 'geldgierig') w -= 14;
  if (tp === 'schwierig') w -= 6;
  if ((mentor.traits || []).includes('leader') || (mentor.traits || []).includes('kabinenleader')) w += 8;
  if ((mentor.traits || []).includes('querulant')) w -= 10;

  // Legendenstatus ist kein Muss, aber der halbe Reiz.
  if (mentor.era === 'legend') w += 10;

  // Führungsattribut und Erfahrung
  const a = mentor.attributes || {};
  w += clamp(((a.fuehrung || 45) - 45) / 55, 0, 1) * 10;
  w += clamp(((mentor.age || 28) - 27) / 8, 0, 1) * 6;

  // Sie müssen sich riechen können.
  if (freundschaft > 0) w += 8;
  else if (freundschaft < 0) w -= 16;

  return clamp(round(w, 1), 0, 100);
}

function mentorText(mentor, talent, staerke) {
  const wo = mentor.position === talent.position
    ? `auf der ${posName(talent)}-Position`
    : `im ${POSITION_GROUP[mentor.position] === POSITION_GROUP[talent.position] ? 'selben Mannschaftsteil' : 'Training'}`;
  if (staerke >= 70) {
    return `${vollName(mentor)} hat ${spielerName(talent)} ${wo} unter die Fittiche genommen. ` +
      `Der Junge hört zu, der Alte redet — das ist die günstigste Trainingsmaßnahme, die es gibt.`;
  }
  if (staerke >= 50) {
    return `${vollName(mentor)} kümmert sich ${wo} um ${spielerName(talent)}. ` +
      `Noch mehr Anweisung als Freundschaft, aber es trägt.`;
  }
  return `${vollName(mentor)} und ${spielerName(talent)} arbeiten ${wo} zusammen. ` +
    `Ob daraus etwas wird, entscheidet sich in den nächsten Monaten.`;
}

/**
 * Passende Paarungen für einen Verein — deterministisch, ohne etwas zu setzen.
 * -> [{ mentorId, talentId, staerke, text, mentor, talent, seit }]
 */
export function mentorPaareBilden(state, clubId, ctx = {}) {
  const club = state && state.clubs ? state.clubs[clubId] : null;
  if (!club || !Array.isArray(club.playerIds)) return [];
  const kader = kaderVon(state, clubId);
  if (kader.length < 4) return [];

  let rang = [];
  try { rang = hierarchie(state, clubId) || []; } catch (err) { rang = []; }
  const einflussVon = {};
  for (const r of rang) einflussVon[r.playerId] = r.einfluss;

  let bez = { byPlayer: {} };
  try { bez = beziehungen(state, clubId) || { byPlayer: {} }; } catch (err) { bez = { byPlayer: {} }; }

  const mentoren = kader.filter(p =>
    (p.age || 26) >= MENTOR_MIN_ALTER &&
    (p.mentees || []).length < MENTOR_MAX_TALENTE);
  const talente = kader.filter(p =>
    (p.age || 26) <= TALENT_MAX_ALTER &&
    ((p.potential || 0) - playerOverall(p)) >= TALENT_MIN_LUFT &&
    !(p.mentor && p.mentor.mentorId));

  const vorschlaege = [];
  for (const m of mentoren) {
    for (const t of talente) {
      if (m.id === t.id) continue;
      const eintrag = bez.byPlayer[m.id] || { freunde: [], rivalen: [] };
      const freundschaft = (eintrag.freunde || []).includes(t.id) ? 1
        : (eintrag.rivalen || []).includes(t.id) ? -1 : 0;
      const staerke = passung(state, m, t, einflussVon[m.id] || 35, freundschaft);
      if (staerke < MENTOR_MIN_STAERKE) continue;
      vorschlaege.push({
        mentorId: m.id, talentId: t.id, staerke,
        mentor: spielerName(m), talent: spielerName(t),
        seit: null, text: mentorText(m, t, staerke)
      });
    }
  }

  // Beste Paarungen zuerst, dann greedy: ein Talent nur einmal, ein Mentor zweimal.
  const sortiert = sortBy(vorschlaege, v => ({ key: v.staerke * 1000 + hashString(v.mentorId + v.talentId) % 1000, desc: true }));
  const belegtTalent = new Set();
  const zaehlerMentor = {};
  for (const p of kader) zaehlerMentor[p.id] = (p.mentees || []).length;

  const out = [];
  for (const v of sortiert) {
    if (belegtTalent.has(v.talentId)) continue;
    if ((zaehlerMentor[v.mentorId] || 0) >= MENTOR_MAX_TALENTE) continue;
    belegtTalent.add(v.talentId);
    zaehlerMentor[v.mentorId] = (zaehlerMentor[v.mentorId] || 0) + 1;
    out.push(v);
  }
  return out;
}

/** Dieselbe Liste unter dem Namen aus der Roadmap. */
export function mentorVorschlaege(state, clubId, ctx = {}) {
  return mentorPaareBilden(state, clubId, ctx);
}

/**
 * Die tatsächlich bestehenden Mentorenpaare eines Vereins.
 * -> [{ mentorId, talentId, seit, staerke, text, mentor, talent, gewinn }]
 */
export function mentorPaare(state, clubId) {
  const club = state && state.clubs ? state.clubs[clubId] : null;
  if (!club || !Array.isArray(club.playerIds)) return [];
  const out = [];
  for (const id of club.playerIds) {
    const t = state.players[id];
    if (!t || !t.mentor || !t.mentor.mentorId) continue;
    const m = state.players[t.mentor.mentorId];
    if (!m) continue;
    out.push({
      mentorId: m.id,
      talentId: t.id,
      mentor: spielerName(m),
      talent: spielerName(t),
      seit: t.mentor.seit || null,
      staerke: Number.isFinite(t.mentor.staerke) ? t.mentor.staerke : 50,
      gewinn: Number.isFinite(t.mentor.ovrStart) ? playerOverall(t) - t.mentor.ovrStart : 0,
      abfaerbung: round(t.mentor.abfaerbung || 0, 2),
      text: t.mentor.text || mentorText(m, t, t.mentor.staerke || 50)
    });
  }
  return sortBy(out, e => ({ key: e.staerke, desc: true }));
}

/** Die Fassung aus der Roadmap. */
export function mentorenPaare(state, clubId) { return mentorPaare(state, clubId); }

/**
 * Mentor zuweisen.
 *
 * ACHTUNG, zwei Namen mit VERTAUSCHTER Argumentreihenfolge — beide stehen so
 * in den Vorgaben und beide werden gebraucht:
 *   mentorSetzen(state, talentId, mentorId)     ← tools/test-chemie.js
 *
 * @returns {{ ok:boolean, text:string, paar? }}
 */
export function mentorSetzen(state, talentId, mentorId) {
  const t = state && state.players ? state.players[talentId] : null;
  const m = state && state.players ? state.players[mentorId] : null;
  if (!t || !m) return { ok: false, text: 'Diesen Spieler gibt es nicht.' };
  if (t.id === m.id) return { ok: false, text: 'Sich selbst kann niemand erziehen.' };
  if (!t.clubId || t.clubId !== m.clubId) {
    return { ok: false, text: `${spielerName(m)} und ${spielerName(t)} spielen nicht im selben Verein.` };
  }
  if (t.mentor && t.mentor.mentorId && t.mentor.mentorId !== m.id) {
    return { ok: false, text: `${spielerName(t)} hat schon einen Mentor — zwei Meinungen sind eine zu viel.` };
  }
  if (!Array.isArray(m.mentees)) m.mentees = [];
  if (m.mentees.length >= MENTOR_MAX_TALENTE && !m.mentees.includes(t.id)) {
    return { ok: false, text: `${spielerName(m)} betreut bereits ${m.mentees.length} Talente. Mehr wird niemand gerecht.` };
  }

  let einfluss = 35, freundschaft = 0;
  try {
    const rang = hierarchie(state, t.clubId) || [];
    const e = rang.find(r => r.playerId === m.id);
    if (e) einfluss = e.einfluss;
    const bez = beziehungen(state, t.clubId);
    const eintrag = (bez.byPlayer || {})[m.id] || {};
    freundschaft = (eintrag.freunde || []).includes(t.id) ? 1 : (eintrag.rivalen || []).includes(t.id) ? -1 : 0;
  } catch (err) { /* Rückfall auf die Vorgabewerte */ }

  const staerke = passung(state, m, t, einfluss, freundschaft);
  t.mentor = {
    mentorId: m.id,
    seit: zeitpunkt(state),
    staerke,
    ovrStart: playerOverall(t),
    abfaerbung: 0,
    gemeldet: 0,
    text: mentorText(m, t, staerke)
  };
  if (!m.mentees.includes(t.id)) m.mentees.push(t.id);

  return { ok: true, text: t.mentor.text, paar: { mentorId: m.id, talentId: t.id, staerke, text: t.mentor.text } };
}

/** Roadmap-Reihenfolge: erst der Mentor, dann das Talent. */

/**
 * Ein Paar auflösen. `paarId` darf die Talent-ID sein oder `mentorId>talentId`.
 */
export function mentorLoesen(state, paarId, grund) {
  if (!paarId || !state || !state.players) return { ok: false, text: 'Unbekanntes Paar.' };
  const talentId = String(paarId).includes('>') ? String(paarId).split('>')[1] : String(paarId);
  const t = state.players[talentId];
  if (!t || !t.mentor || !t.mentor.mentorId) return { ok: false, text: 'Zu diesem Spieler ist kein Mentor eingetragen.' };
  const m = state.players[t.mentor.mentorId];
  if (m && Array.isArray(m.mentees)) m.mentees = m.mentees.filter(id => id !== t.id);
  t.mentor = null;
  return {
    ok: true,
    text: grund || `${spielerName(m)} und ${spielerName(t)} gehen wieder getrennte Wege. Der Junge kann jetzt selbst laufen.`
  };
}

/* --- Die tägliche Pflege --------------------------------------------------- */

function mentorenPflegen(state, ctx, heute) {
  const meinId = state.managerClubId;
  for (const clubId in state.clubs) {
    const club = state.clubs[clubId];
    if (!club || club.lazySquad || !Array.isArray(club.playerIds) || club.playerIds.length < 6) continue;
    const eigen = clubId === meinId;

    for (const id of club.playerIds.slice()) {
      const t = state.players[id];
      if (!t || !t.mentor || !t.mentor.mentorId) continue;
      const m = state.players[t.mentor.mentorId];

      // Der Mentor ist weg: zurückgetreten, verkauft oder ausgelaufen.
      if (!m || m.clubId !== t.clubId) {
        if (m && m.retired) erbeAntreten(state, ctx, club, m, t, eigen);
        else mentorLoesen(state, t.id);
        continue;
      }
      if (t.retired) { mentorLoesen(state, t.id); continue; }

      // Einmal im Monat: abfärben und nachschauen, ob es etwas zu erzählen gibt.
      if (heute % 30 === 0) {
        abfaerben(state, ctx, t, m, eigen);
        erzaehlen(state, ctx, t, m, eigen);
      }
    }

    // Neue Paare bildet der Co-Trainer alle 30 Tage — nicht jeden Morgen.
    if (!eigen && !club.chemie) {
      if (((heute + hashString(clubId) % 30) % MENTOR_PRUEFTAGE) !== 0) continue;
    } else {
      const c = chemieAkte(club);
      // `heute` ist der Tag INNERHALB der Saison und springt beim Saisonwechsel
      // auf 0 zurück. Ein reiner Abstandsvergleich stünde danach für immer auf
      // „noch nicht fällig": Der eigene Verein hätte ab Saison 2 nie wieder ein
      // neues Mentorenpaar gebildet, während alle KI-Vereine weitermachen.
      // Ein Rücksprung zählt deshalb selbst als Fälligkeit.
      if (heute >= c.mentorPruefung && heute - c.mentorPruefung < MENTOR_PRUEFTAGE) continue;
      c.mentorPruefung = heute;
    }
    neuePaareBilden(state, ctx, club, eigen, heute);
  }
}

function neuePaareBilden(state, ctx, club, eigen, heute) {
  let vorschlaege = [];
  try { vorschlaege = mentorPaareBilden(state, club.id, ctx) || []; } catch (err) { return; }
  if (!vorschlaege.length) return;
  const rng = chemieRng(state, ctx, 'paare:' + club.id + ':' + heute);

  for (const v of vorschlaege.slice(0, 2)) {
    const chance = MENTOR_BILDUNG_CHANCE * clamp(v.staerke / 70, 0.3, 1.3);
    if (!rng.chance(clamp(chance, 0, 0.95))) continue;
    const r = mentorSetzen(state, v.talentId, v.mentorId);
    if (!r.ok) continue;
    if (eigen && ctx.log) {
      const m = state.players[v.mentorId], t = state.players[v.talentId];
      ctx.log(
        `${r.text}\n\n` +
        `Der Co-Trainer hat es nicht angeordnet, er hat es nur nicht verhindert. ` +
        `Wenn das ein halbes Jahr hält, sehen wir es an den Werten von ${spielerName(t)} — ` +
        `und an der Miene von ${spielerName(m)}, wenn der Junge zum ersten Mal besser ist als er.`,
        'kabine', { subject: `${spielerName(m)} nimmt ${spielerName(t)} an die Hand`, from: 'Co-Trainer' });
    }
  }
}

/**
 * Die Persönlichkeit färbt ab. Erst wandern die Kennzahlen, irgendwann kippt
 * der Typ ganz — die sieben Typen stehen in `core/state.js:PERSONALITIES`.
 */
function abfaerben(state, ctx, t, m, eigen) {
  const mp = m.personality, tp = t.personality;
  if (!mp || !tp) return;
  const anteil = ABFAERBUNG_JE_MONAT * clamp((t.mentor.staerke || 50) / 70, 0.4, 1.3);

  for (const k of ['moraleSwing', 'loyalty', 'ambition']) {
    const ziel = Number.isFinite(mp[k]) ? mp[k] : 1;
    const ist = Number.isFinite(tp[k]) ? tp[k] : 1;
    tp[k] = round(ist + (ziel - ist) * anteil, 3);
  }

  t.mentor.abfaerbung = clamp(round((t.mentor.abfaerbung || 0) + anteil, 3), 0, 1);

  if (t.mentor.abfaerbung >= ABFAERBUNG_UEBERNAHME && tp.id !== mp.id) {
    const alt = tp.name || tp.id;
    tp.id = mp.id;
    tp.name = mp.name;
    tp.desc = mp.desc;
    if (eigen && ctx.log) {
      ctx.log(
        `${vollName(t)} war einmal "${alt}". Inzwischen redet er wie ${spielerName(m)}, ` +
        `er geht wie ${spielerName(m)}, und beim Auslaufen bleibt er genauso lange stehen wie ${spielerName(m)}. ` +
        `Der Kabinenwart nennt die beiden nur noch "die Zwillinge".\n\n` +
        `Neue Einstufung: ${mp.name}.`,
        'kabine', { subject: `${spielerName(t)} wird zum ${mp.name}`, from: 'Co-Trainer' });
    }
  }
}

/**
 * Die Erzählung aus Abschnitt 4 der Roadmap: Wenn der Junge etwas aus sich
 * macht, sagt die Legende etwas dazu.
 */
function erzaehlen(state, ctx, t, m, eigen) {
  if (!Number.isFinite(t.mentor.ovrStart)) return;
  const gewinn = playerOverall(t) - t.mentor.ovrStart;
  const stufe = t.mentor.gemeldet || 0;

  if (gewinn >= ERZAEHLUNG_GROSS && stufe < 2) {
    t.mentor.gemeldet = 2;
    if (eigen && ctx.log) {
      ctx.log(
        `${vollName(m)} hat sich nach dem Training vor die Kamera gestellt — freiwillig, was bei ihm ` +
        `schon die halbe Nachricht ist:\n\n` +
        `"Als er hier ankam, hat er den Ball angeschaut wie eine Rechnung. Heute schaut er auf, bevor ` +
        `er ihn annimmt. Mehr habe ich nicht gemacht. Den Rest hat er selbst gemacht — und irgendwann ` +
        `wird er behaupten, er hätte es immer gekonnt. Soll er. Ich weiß es besser."\n\n` +
        `${vollName(t)} hat unter ${spielerName(m)} ${Math.round(gewinn)} Punkte zugelegt. ` +
        `So etwas steht in keiner Bilanz und ist trotzdem das Wertvollste, was dieser Verein besitzt.`,
        'kabine', { subject: `${spielerName(m)} über ${spielerName(t)}`, from: 'Pressestelle', wichtig: true });
    }
    if (eigen && ctx.news) {
      ctx.news(`${vollName(m)} adelt seinen Zögling ${spielerName(t)}: "Den Rest hat er selbst gemacht."`, 'info');
    }
    return;
  }

  if (gewinn >= ERZAEHLUNG_ZWISCHEN && stufe < 1) {
    t.mentor.gemeldet = 1;
    if (eigen && ctx.log) {
      ctx.log(
        `Kleine Beobachtung vom Trainingsplatz: ${vollName(t)} macht seit Monaten dieselbe Übung wie ` +
        `${vollName(m)} — dieselbe Reihenfolge, dieselbe Pause dazwischen, dieselbe Grimasse beim letzten Ball. ` +
        `Er hat inzwischen ${Math.round(gewinn)} Punkte zugelegt.\n\n` +
        `${spielerName(m)} sagt dazu nichts. Er schaut nur nicht mehr weg.`,
        'kabine', { subject: `${spielerName(t)} macht Fortschritte`, from: 'Co-Trainer' });
    }
  }
}

/**
 * Hört die Legende auf, übernimmt das Talent ihre Rückennummer.
 * Die billigste Geste im ganzen Spiel und die, über die man am längsten redet.
 */
function erbeAntreten(state, ctx, club, m, t, eigen) {
  const nummer = m.number;
  const alteNummer = t.number;
  const frei = nummer && !(club.playerIds || []).some(id => {
    const q = state.players[id];
    return q && q.id !== t.id && q.number === nummer;
  });

  mentorLoesen(state, t.id, 'Der Mentor hat aufgehört.');

  if (!frei || !nummer || nummer === alteNummer) return;
  t.number = nummer;

  if (eigen && ctx.log) {
    ctx.log(
      `Die ${nummer} bleibt im Verein.\n\n` +
      `${vollName(m)} hat sie ${m.retired && m.retired.season ? 'bis zur letzten Saison ' : ''}getragen, ` +
      `und heute Morgen hing sie am Haken von ${vollName(t)}. Niemand hat das angeordnet. ` +
      `Der Zeugwart sagt, er habe "einfach gewusst, wo sie hingehört".\n\n` +
      `${spielerName(t)} trägt künftig die ${nummer} statt der ${alteNummer}. ` +
      `Er hat versucht, etwas dazu zu sagen, und es dann gelassen. Auch das hat er von ${spielerName(m)}.`,
      'karriere', { subject: `${spielerName(t)} erbt die ${nummer}`, from: 'Zeugwart', wichtig: true });
  }
  if (eigen && ctx.news) {
    ctx.news(`${vereinKurz(state, club.id)}: ${vollName(t)} übernimmt die Rückennummer ${nummer} von ${spielerName(m)}.`, 'info');
  }
}

/* ==========================================================================
 * 7. Cliquen
 * ======================================================================== */

/**
 * Die Gruppen einer Kabine.
 * -> [{ id, art:'nation'|'aera'|'alter'|'vergangenheit', playerIds, mitglieder,
 *       staerke:0..100, stimmung:0..100, label, text }]
 *
 * Erkannt werden sie in `morale.js:cliquenGruppen()` — dort liegen die
 * Beziehungen, auf denen sie aufsetzen, und dort wirken sie auch (Moral-
 * ausbreitung und Konfliktrisiko in `tickMoral`). Hier steht nur die
 * Aufbereitung: stabile IDs, deutscher Begleittext, Vertragsform.
 */
export function cliquen(state, clubId) {
  let gruppen = [];
  try { gruppen = cliquenGruppen(state, clubId) || []; } catch (err) { return []; }

  return gruppen.map(g => ({
    id: g.id,
    art: g.art,
    playerIds: g.playerIds.slice(),
    mitglieder: g.playerIds.map(id => spielerName(state.players[id])),
    staerke: g.staerke,
    stimmung: g.stimmung,
    label: g.label,
    fuehrerId: g.fuehrerId || null,
    text: g.text
  })).filter(c =>
    Array.isArray(c.playerIds) && c.playerIds.length >= CLIQUE_MIN && c.playerIds.length <= CLIQUE_MAX);
}

/* ==========================================================================
 * 8. Der Kabinenbericht
 * ======================================================================== */

const NIVEAU_TEXTE = [
  [82, 'Diese Elf spielt blind. Der Ball ist weg, bevor der Gegner weiß, dass er kommt.'],
  [68, 'Die Abläufe sitzen. Man muss nicht mehr rufen, man schaut nur noch hin.'],
  [54, 'Es läuft ordentlich. Zwei, drei Bälle pro Spiel gehen noch dahin, wo keiner steht.'],
  [40, 'Da ist noch Sand im Getriebe. Die Wege stimmen, das Timing nicht.'],
  [26, 'Elf Einzelspieler. Jeder gut, keiner mit dem anderen.'],
  [0, 'Diese Mannschaft hat sich heute zum ersten Mal gesehen — und das sieht man ihr an.']
];

function niveauText(w) {
  for (const [schwelle, text] of NIVEAU_TEXTE) if (w >= schwelle) return text;
  return NIVEAU_TEXTE[NIVEAU_TEXTE.length - 1][1];
}

/**
 * Deutsche Klartextanalyse der Kabine für den Kaderbildschirm.
 * -> { clubId, wert, zeilen:[string], text, beste, schlechteste, mentoren, cliquen }
 */
export function chemieBericht(state, clubId) {
  const club = state && state.clubs ? state.clubs[clubId] : null;
  if (!club) return { clubId, wert: PAAR_NIVEAU, zeilen: ['Verein unbekannt.'], text: 'Verein unbekannt.' };

  const kader = kaderVon(state, clubId);
  const wert = chemieWert(state, clubId);
  const zeilen = [];

  zeilen.push(`Eingespieltheit: ${Math.round(wert)} von 100.`);
  zeilen.push(niveauText(wert));

  /* --- Ära-Mischung: der Kern des Vereins ---------------------------------- */
  const legenden = kader.filter(p => p.era === 'legend');
  const moderne = kader.filter(p => p.era !== 'legend');
  const minderheit = Math.min(legenden.length, moderne.length);
  if (legenden.length && moderne.length) {
    const aeren = new Set(legenden.map(p => p.eraLabel).filter(Boolean));
    zeilen.push(
      `Der Kader lebt von ${legenden.length} Legenden${aeren.size ? ` (${[...aeren].sort().join(', ')})` : ''} ` +
      `und ${moderne.length} aktuellen Profis. ` +
      (minderheit >= 4
        ? 'Das ist die Mischung, für die dieser Verein bekannt ist — und sie kostet jede Saison aufs Neue Eingewöhnung.'
        : 'Die Minderheit ist klein genug, dass sie sich anpassen muss, nicht die Mannschaft.'));
  } else if (legenden.length) {
    zeilen.push('Ein Kader aus lauter Legenden. Sie verstehen sich vom ersten Tag an — und altern gemeinsam.');
  } else {
    zeilen.push('Ein Kader ohne eine einzige Legende. Sauber eingespielt, aber ohne Geschichte in der Kabine.');
  }

  /* --- Beste und schlechteste Paare ---------------------------------------- */
  const paare = [];
  const stamm = stammKader(state, clubId);
  for (let i = 0; i < stamm.length; i++) {
    for (let j = i + 1; j < stamm.length; j++) {
      const a = state.players[stamm[i]], b = state.players[stamm[j]];
      if (!a || !b) continue;
      paare.push({ a: a.id, b: b.id, wert: paarChemie(state, a.id, b.id), gemischt: gemischt(a, b) });
    }
  }
  const sortiert = sortBy(paare, x => ({ key: x.wert, desc: true }));
  const beste = sortiert.slice(0, 2);
  const schlechteste = sortiert.slice(-2).reverse();

  for (const p of beste) {
    zeilen.push(`Blindes Verständnis: ${spielerName(state.players[p.a])} und ${spielerName(state.players[p.b])} ` +
      `(${Math.round(p.wert)}).`);
  }
  for (const p of schlechteste) {
    const a = state.players[p.a], b = state.players[p.b];
    zeilen.push(`Baustelle: ${spielerName(a)} und ${spielerName(b)} (${Math.round(p.wert)})` +
      (p.gemischt ? ` — ${a.era === 'legend' ? spielerName(a) : spielerName(b)} kommt aus einer anderen Zeit.` : '.'));
  }

  /* --- Mentoren ------------------------------------------------------------ */
  const mentoren = mentorPaare(state, clubId);
  if (mentoren.length) {
    zeilen.push(`Mentoren (${mentoren.length}):`);
    for (const m of mentoren.slice(0, 4)) {
      zeilen.push(`• ${m.mentor} → ${m.talent} (Passung ${Math.round(m.staerke)}` +
        (m.gewinn > 0 ? `, ${Math.round(m.gewinn)} Punkte Zuwachs` : '') + ')');
    }
  } else {
    zeilen.push('Kein einziges Mentorenpaar. Die Alten schweigen, die Jungen lernen es allein — langsamer.');
  }

  /* --- Cliquen ------------------------------------------------------------- */
  const gruppen = cliquen(state, clubId);
  if (gruppen.length) {
    zeilen.push('Grüppchen: ' + gruppen.map(c => `${c.label} (${Math.round(c.staerke)})`).join(', ') + '.');
    const stark = gruppen.filter(c => c.staerke >= 60);
    if (stark.length >= 2) {
      zeilen.push('Zwei feste Lager in einer Kabine sind ein Lager zu viel. Rechnen Sie mit Ärger.');
    }
  }

  const c = club.chemie;
  if (c && c.offset < -6) {
    zeilen.push(`Der Umbruch hängt der Mannschaft noch nach (${Math.round(c.offset)} Punkte). ` +
      `Das wächst sich aus — über Monate, nicht über Wochen.`);
  }

  return {
    clubId,
    wert,
    zeilen,
    text: zeilen.join('\n'),
    beste, schlechteste,
    mentoren,
    cliquen: gruppen,
    paareGespeichert: c && c.paare ? Object.keys(c.paare).length : 0
  };
}

/** Derselbe Bericht unter dem Namen aus der Roadmap. */
export function kabinenChemieBericht(state, clubId) { return chemieBericht(state, clubId); }

export { CLIQUEN_ARTEN, CLIQUE_MAX_JE_SPIELER };
