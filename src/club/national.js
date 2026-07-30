/**
 * club/national.js — Die Nationalmannschaft (Roadmap-Stufe 4, Punkt 4).
 * ============================================================================
 *
 * Was hier passiert:
 *
 *   1. Berufungen      Die Verbände nominieren aus dem gesamten Spielerbestand
 *                      — auch aus den Kadern der KI-Vereine. Nach Leistung,
 *                      Form und Position; wer verletzt ist, bleibt zu Hause.
 *   2. Länderspiel-    Die beiden Pausen im Kalender (data/leagues.js, Termin
 *      pausen          `kind:'laenderspielpause'`, Tag 74 und 137) kosten
 *                      Fitness, tragen ein Verletzungsrisiko und bewegen die
 *                      Moral — nach oben bei den Berufenen, nach unten bei dem,
 *                      der diesmal übersehen wurde.
 *   3. Turniere        Alle zwei Saisons (ungerade Saisonnummer) läuft über die
 *                      Sommerpause ein Turnier: WM in Saison 1, 5, 9 …, EM in
 *                      Saison 3, 7 … Der Spielstand beginnt am 1. Juli, also
 *                      mitten drin — die Vorrunde ist gespielt, es geht ab dem
 *                      Achtelfinale weiter, das Endspiel steigt am 13. Juli.
 *                      Genau deshalb kommen die Nationalspieler platt aus dem
 *                      Urlaub, während die anderen erholt zum Auftakt kommen.
 *   4. Verbandsanfrage Ab genug Ruf klopft der Verband wegen des Amtes als
 *                      Nationaltrainer an (Andockstelle: board.js:jobangebote).
 *
 * ZUSTÄNDIGKEIT (CONTRACTS.md §11 — dieses Modul ist der einzige Schreiber):
 *   state.national                     Aufgebote, Perioden, Turnierstand
 *   player.national                    Länderspiele, Tore, Turnierbilanz
 * Fremde Felder werden nur über die dafür vorgesehenen Nebeneingänge angefasst:
 *   medical.js:fitnessNachSpiel/verletzen   Belastung und Blessuren
 *   morale.js:moralAendern                  Moralwirkung der (Nicht-)Berufung
 * Vereinsstatistik wird NICHT angefasst: Ein Tor im Länderspiel zählt in
 * `player.national.tore` und nirgendwo sonst — sonst stünde am Saisonende ein
 * Torschützenkönig in der Liste, der seine Tore in Bukarest geschossen hat.
 *
 * Aufgerufen wird das Modul aus core/loop.js:advanceDay — und NICHT aus
 * club/index.js:tickAlleModule. Begründung wie beim Europapokal: Ein Verband
 * ist kein Vereinsmodul.
 *
 * KEIN DOM, kein Math.random(), kein Date.now().
 */

import { clamp, round, sortBy, avg } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { POSITION_GROUP, NATION_NAMES } from '../core/constants.js';
import { playerOverall } from '../engine/ratings.js';
import { SAISON_TAGE } from '../data/leagues.js';
import { fitnessNachSpiel, verletzen } from './medical.js';
import { moralAendern } from './morale.js';

/* ==========================================================================
 * 1. Die Verbände
 * ======================================================================== */

/**
 * Die spielenden Verbände.
 *   staerke  1..100  Spielstärke der Auswahl (Grundlage der Turniersimulation)
 *   ruf      1..100  Renommee — was eine Berufung dem Spieler wert ist
 *   konf              Konföderation; sie bestimmt die Reisebelastung
 *
 * Abgedeckt sind alle Nationalitäten, die in data/squads/* wirklich vorkommen,
 * plus die üblichen Verdächtigen. Ein Verband ohne Eintrag bekommt über
 * nationVon() einen Mittelwert — das Spiel bleibt auch mit eigenen Kadern heil.
 */
export const NATIONEN = [
  { id: 'DE', staerke: 92, ruf: 97, konf: 'europa' },
  { id: 'FR', staerke: 93, ruf: 92, konf: 'europa' },
  { id: 'ES', staerke: 90, ruf: 93, konf: 'europa' },
  { id: 'IT', staerke: 88, ruf: 95, konf: 'europa' },
  { id: 'EN', staerke: 89, ruf: 90, konf: 'europa' },
  { id: 'PT', staerke: 88, ruf: 86, konf: 'europa' },
  { id: 'NL', staerke: 87, ruf: 90, konf: 'europa' },
  { id: 'BE', staerke: 84, ruf: 76, konf: 'europa' },
  { id: 'HR', staerke: 84, ruf: 80, konf: 'europa' },
  { id: 'DK', staerke: 80, ruf: 72, konf: 'europa' },
  { id: 'CH', staerke: 78, ruf: 70, konf: 'europa' },
  { id: 'AT', staerke: 77, ruf: 68, konf: 'europa' },
  { id: 'TR', staerke: 76, ruf: 70, konf: 'europa' },
  { id: 'PL', staerke: 76, ruf: 72, konf: 'europa' },
  { id: 'RS', staerke: 75, ruf: 68, konf: 'europa' },
  { id: 'SE', staerke: 74, ruf: 76, konf: 'europa' },
  { id: 'NO', staerke: 74, ruf: 66, konf: 'europa' },
  { id: 'CZ', staerke: 73, ruf: 74, konf: 'europa' },
  { id: 'UA', staerke: 73, ruf: 66, konf: 'europa' },
  { id: 'GR', staerke: 71, ruf: 70, konf: 'europa' },
  { id: 'SK', staerke: 68, ruf: 56, konf: 'europa' },
  { id: 'BA', staerke: 68, ruf: 58, konf: 'europa' },
  { id: 'HU', staerke: 68, ruf: 66, konf: 'europa' },
  { id: 'RO', staerke: 67, ruf: 64, konf: 'europa' },
  { id: 'SI', staerke: 66, ruf: 56, konf: 'europa' },
  { id: 'IE', staerke: 66, ruf: 60, konf: 'europa' },
  { id: 'GE', staerke: 66, ruf: 46, konf: 'europa' },
  { id: 'BG', staerke: 64, ruf: 60, konf: 'europa' },
  { id: 'FI', staerke: 64, ruf: 50, konf: 'europa' },
  { id: 'AL', staerke: 63, ruf: 50, konf: 'europa' },
  { id: 'IS', staerke: 62, ruf: 50, konf: 'europa' },
  { id: 'MK', staerke: 62, ruf: 44, konf: 'europa' },
  { id: 'XK', staerke: 60, ruf: 40, konf: 'europa' },
  { id: 'IL', staerke: 60, ruf: 42, konf: 'europa' },
  { id: 'LU', staerke: 52, ruf: 32, konf: 'europa' },
  { id: 'BR', staerke: 92, ruf: 99, konf: 'suedamerika' },
  { id: 'AR', staerke: 91, ruf: 95, konf: 'suedamerika' },
  { id: 'UY', staerke: 80, ruf: 82, konf: 'suedamerika' },
  { id: 'CO', staerke: 79, ruf: 70, konf: 'suedamerika' },
  { id: 'CL', staerke: 74, ruf: 72, konf: 'suedamerika' },
  { id: 'EC', staerke: 74, ruf: 56, konf: 'suedamerika' },
  { id: 'PE', staerke: 71, ruf: 58, konf: 'suedamerika' },
  { id: 'PY', staerke: 70, ruf: 56, konf: 'suedamerika' },
  { id: 'VE', staerke: 66, ruf: 44, konf: 'suedamerika' },
  { id: 'MA', staerke: 80, ruf: 68, konf: 'afrika' },
  { id: 'SN', staerke: 79, ruf: 64, konf: 'afrika' },
  { id: 'NG', staerke: 76, ruf: 70, konf: 'afrika' },
  { id: 'DZ', staerke: 76, ruf: 62, konf: 'afrika' },
  { id: 'CI', staerke: 75, ruf: 64, konf: 'afrika' },
  { id: 'CM', staerke: 74, ruf: 68, konf: 'afrika' },
  { id: 'GH', staerke: 74, ruf: 66, konf: 'afrika' },
  { id: 'EG', staerke: 72, ruf: 60, konf: 'afrika' },
  { id: 'TN', staerke: 72, ruf: 58, konf: 'afrika' },
  { id: 'ML', staerke: 70, ruf: 48, konf: 'afrika' },
  { id: 'CD', staerke: 68, ruf: 46, konf: 'afrika' },
  { id: 'BF', staerke: 66, ruf: 44, konf: 'afrika' },
  { id: 'GN', staerke: 66, ruf: 42, konf: 'afrika' },
  { id: 'CV', staerke: 64, ruf: 38, konf: 'afrika' },
  { id: 'ZA', staerke: 66, ruf: 52, konf: 'afrika' },
  { id: 'AO', staerke: 62, ruf: 38, konf: 'afrika' },
  { id: 'TG', staerke: 60, ruf: 34, konf: 'afrika' },
  { id: 'JP', staerke: 79, ruf: 64, konf: 'asien' },
  { id: 'KR', staerke: 77, ruf: 62, konf: 'asien' },
  { id: 'IR', staerke: 72, ruf: 50, konf: 'asien' },
  { id: 'SA', staerke: 68, ruf: 48, konf: 'asien' },
  { id: 'CN', staerke: 60, ruf: 40, konf: 'asien' },
  { id: 'SY', staerke: 56, ruf: 30, konf: 'asien' },
  { id: 'US', staerke: 74, ruf: 60, konf: 'nordamerika' },
  { id: 'MX', staerke: 74, ruf: 64, konf: 'nordamerika' },
  { id: 'CA', staerke: 70, ruf: 48, konf: 'nordamerika' },
  { id: 'AU', staerke: 71, ruf: 56, konf: 'ozeanien' },
  { id: 'NZ', staerke: 58, ruf: 38, konf: 'ozeanien' }
];

const NATION_MAP = {};
for (const n of NATIONEN) NATION_MAP[n.id] = n;

/** Reisebelastung je Konföderation: Europa ist ein Katzensprung, Südamerika nicht. */
const REISE = {
  europa: 1.0, nordamerika: 1.4, afrika: 1.45, asien: 1.5,
  suedamerika: 1.6, ozeanien: 1.7
};
const KONF_ZIEL = {
  europa: 'quer durch Europa', nordamerika: 'nach Nordamerika', afrika: 'nach Afrika',
  asien: 'nach Asien', suedamerika: 'nach Südamerika', ozeanien: 'ans andere Ende der Welt'
};

/* ==========================================================================
 * 2. Stellschrauben
 * ======================================================================== */

const KADER_SOLL = 23;          // so groß ist ein Aufgebot auf dem Papier
const KADER_MIN = 9;            // weniger als das ruft dieses Spiel nicht auf
const POOL_FAKTOR = 2;          // nominiert wird nur aus den besten (2 × Soll)
const KADER_PLAN = { TW: 3, ABW: 8, MIT: 7, STU: 5 };

// Das Turnierfenster IST die Sommerpause: Tag 0 = 1. Juli, Tag 13 = 14. Juli.
// Wer je ein Endspiel gesehen hat, weiß, dass es genau dann stattfindet.
const TURNIER_VON = SAISON_TAGE.sommerurlaub[0];
const TURNIER_BIS = SAISON_TAGE.sommerurlaub[1];
const TURNIER_RUNDEN = [
  { tag: 2, name: 'Achtelfinale', teams: 16 },
  { tag: 5, name: 'Viertelfinale', teams: 8 },
  { tag: 8, name: 'Halbfinale', teams: 4 },
  { tag: 12, name: 'Endspiel', teams: 2 }
];
const TURNIER_FELD = 16;
const TURNIER_EUROPA_MAX = 8;   // bei der WM: mehr als acht Europäer sind es nie

const PAUSE_DAUER = 4;          // Anreise (Tag 0), Spiele an Tag 1 und 3, Rückreise Tag 4
const PAUSE_SPIELTAGE = [1, 3];

const REISE_FITNESS_TAG = 1.15; // Fitnessverlust je Tag im Verbandsdienst
const SPIEL_MINUTEN_ELF = 90;
const SPIEL_MINUTEN_WECHSEL = 26;
const EINSATZ_ELF = 11;
const EINSATZ_WECHSEL = 3;
const VERLETZUNG_JE_SPIEL = 0.011;   // je eingesetztem Spieler und Spiel
const MORAL_BERUFUNG = 3.2;
const MORAL_NICHT_BERUFEN = -2.4;
const MORAL_TURNIERSIEG = 6;
const NATIONALSPIELER_AB = 4;        // ab so vielen Länderspielen kränkt eine Nichtberufung

/** Ab diesem Ruf will der Verband mit dem Manager reden. */
const VERBAND_RUF = 78;
const VERBAND_MIN_TITEL = 1;
const VERBAND_MAX_ANFRAGEN = 3;
const VERBAND_LIZENZ = 4;       // ohne Fußball-Lehrer sitzt niemand auf dieser Bank

/* ==========================================================================
 * 3. Kleine Helfer
 * ======================================================================== */

const spn = p => (p ? (p.shortName || p.lastName || p.id) : '—');
const nationName = code => NATION_NAMES[code] || String(code || '???');

/** Deterministische Rng — bewusst unabhängig vom ctx, damit zwei Aufrufe am
 *  selben Tag garantiert dasselbe Aufgebot liefern. */
function nrng(state, label) {
  return createRng(`national:${state.seed}:${state.date.season}:${label}`);
}

export function nationVon(code) {
  return NATION_MAP[code] || { id: code, staerke: 55, ruf: 40, konf: 'europa' };
}

/** Legt state.national an und hält es aktuell. */
function sicherState(state) {
  if (!state.national || typeof state.national !== 'object') {
    state.national = {
      saison: 0, letzterTag: -1, letzteSaison: 0,
      pausen: [], periode: null, aufgebote: {}, aktiv: {},
      turnier: null,
      verband: { anfragen: 0, letzteSaison: 0 }
    };
  }
  const n = state.national;
  if (!Array.isArray(n.pausen)) n.pausen = [];
  if (!n.aufgebote) n.aufgebote = {};
  if (!n.aktiv) n.aktiv = {};
  if (!n.verband) n.verband = { anfragen: 0, letzteSaison: 0 };
  if (n.saison !== state.date.season) saisonAufschlagen(state, n);
  return n;
}

/** Akte eines Spielers beim Verband. Entsteht erst mit der ersten Berufung. */
function akte(p) {
  if (!p.national) {
    p.national = {
      nation: p.nationality || null, spiele: 0, tore: 0,
      debuet: null, letzte: null, turniere: [], berufen: false
    };
  }
  return p.national;
}

/* ==========================================================================
 * 4. Der Kalender des Verbands
 * ======================================================================== */

/** Ist in dieser Saison ein Turnier? Jede zweite — WM zuerst, dann EM. */
export function turnierSaison(season) {
  return season % 2 === 1;
}
function turnierArt(season) {
  return ((season - 1) / 2) % 2 === 0 ? 'wm' : 'em';
}
const TURNIER_NAMEN = { wm: 'Weltmeisterschaft', em: 'Europameisterschaft' };

/** Neue Saison: Termine einsammeln, Aufgebote und Turnier zurücksetzen. */
function saisonAufschlagen(state, n) {
  n.saison = state.date.season;
  n.pausen = laenderspielTage(state);
  n.periode = null;
  n.aufgebote = {};
  n.aktiv = {};
  n.turnier = turnierSaison(state.date.season) ? turnierAufsetzen(state) : null;
}

/** Die Länderspielpausen dieser Saison aus dem Kalender. */
function laenderspielTage(state) {
  const tage = [];
  const cal = state.kalender || {};
  for (const key of Object.keys(cal)) {
    const eintraege = cal[key];
    if (!Array.isArray(eintraege)) continue;
    for (const e of eintraege) {
      if (e && e.type === 'termin' && e.kind === 'laenderspielpause') {
        const t = Number(key);
        if (Number.isFinite(t) && !tage.includes(t)) tage.push(t);
      }
    }
  }
  return tage.sort((a, b) => a - b);
}

/**
 * Die Verbandsperiode eines Tages.
 * @returns {null|{ art:'turnier'|'pause', id:string, von:number, bis:number, spieltage:number[] }}
 */
export function periodeAn(state, tag) {
  const n = sicherState(state);
  if (turnierSaison(state.date.season) && tag >= TURNIER_VON && tag <= TURNIER_BIS) {
    return {
      art: 'turnier', id: 'turnier', von: TURNIER_VON, bis: TURNIER_BIS,
      spieltage: TURNIER_RUNDEN.map(r => r.tag)
    };
  }
  for (const t of n.pausen) {
    if (tag >= t && tag <= t + PAUSE_DAUER) {
      return {
        art: 'pause', id: 'pause' + t, von: t, bis: t + PAUSE_DAUER,
        spieltage: PAUSE_SPIELTAGE.map(d => t + d)
      };
    }
  }
  return null;
}

/** Die nächste Periode ab einem Tag — für Vorschauen und Bildschirme. */
export function naechstePeriode(state, tag) {
  const n = sicherState(state);
  if (turnierSaison(state.date.season) && tag < TURNIER_VON) return periodeAn(state, TURNIER_VON);
  for (const t of n.pausen) if (tag < t) return periodeAn(state, t);
  return null;
}

/* ==========================================================================
 * 5. Berufungen
 * ======================================================================== */

/** Alle einsatzfähigen Spieler einer Nation, absteigend nach Können. */
function spielerDerNation(state, nation) {
  const out = [];
  for (const id in state.players) {
    const p = state.players[id];
    if (!p || p.nationality !== nation) continue;
    if (!p.clubId || p.retired || p.injury) continue;
    out.push(p);
  }
  return sortBy(out, p => ({ key: playerOverall(p), desc: true }), p => p.id);
}

/**
 * Nominierungswert: Können zuerst, dann Form, Frische und Spielpraxis.
 * Die Spanne bleibt bewusst eng — ein Verband beruft keinen Zweitligisten in
 * Form vor einem Weltklassemann in einem Formtief, und die Prüfung in
 * tools/test-chemie.js:Z09 misst genau das.
 */
function nominierungswert(state, p, rng) {
  const ovr = playerOverall(p);
  const form = typeof p.form === 'number' ? p.form : 50;
  const fit = typeof p.fitness === 'number' ? p.fitness : 100;
  const s = (p.stats && p.stats.season) || null;
  const noten = s && s.notenAnzahl ? s.notenSumme / s.notenAnzahl : 0;
  // Bewusst NICHT akte(): Wer nur bewertet wird, bekommt noch keine Verbandsakte.
  // 600 leere Akten je Nominierungsrunde wären reine Spielstandslast.
  const a = p.national || { spiele: 0 };

  let w = ovr;
  w += (form - 50) * 0.10;
  w += (fit - 85) * 0.04;
  if (noten) w += (noten - 6.2) * 1.6;
  if (s && s.tore) w += Math.min(4, s.tore * 0.35);
  // Wer schon dabei war, bleibt eher dabei. Kontinuität ist die halbe Miete.
  if (a.spiele >= NATIONALSPIELER_AB) w += 1.6;
  // Alter: der Verband schaut auf die nächsten zwei Jahre, nicht auf die letzten.
  if ((p.age || 26) >= 34) w -= 2.2;
  if ((p.age || 26) <= 20) w += 0.8;
  w += rng.float(-0.9, 0.9);      // der Rest ist Geschmack des Trainers
  return w;
}

/**
 * Das Aufgebot einer Nation.
 *
 * Nominiert wird ausschließlich aus den besten (2 × KADER_SOLL) Spielern der
 * Nation. Das ist keine Bequemlichkeit, sondern die Zusicherung: Kein Berufener
 * liegt je unter der Leistungsschwelle, auch dann nicht, wenn eine Position
 * dünn besetzt ist. Fehlt der dritte Torwart, fährt eben nur einer mit.
 *
 * @returns {null|{ nation, name, playerIds, kaderSoll, ausserhalb, ruf, staerke, konf }}
 */
export function nationalkader(state, nation, ctx) {
  const alle = spielerDerNation(state, nation);
  if (alle.length < KADER_MIN) return null;

  const soll = Math.min(KADER_SOLL, alle.length);
  const pool = alle.slice(0, Math.min(alle.length, KADER_SOLL * POOL_FAKTOR));
  const rng = (ctx && ctx.nationRng) || nrng(state, 'kader:' + nation + ':' + periodenId(state));

  const bewertet = sortBy(
    pool.map(p => ({ p, w: nominierungswert(state, p, rng) })),
    e => ({ key: e.w, desc: true }), e => e.p.id);

  const gewaehlt = [];
  const drin = new Set();
  // Erst die Positionsgruppen abdecken, dann nach Wert auffüllen.
  for (const gruppe of ['TW', 'ABW', 'MIT', 'STU']) {
    let offen = KADER_PLAN[gruppe];
    for (const e of bewertet) {
      if (offen <= 0 || gewaehlt.length >= soll) break;
      if (drin.has(e.p.id)) continue;
      if ((POSITION_GROUP[e.p.position] || 'MIT') !== gruppe) continue;
      gewaehlt.push(e.p); drin.add(e.p.id); offen--;
    }
  }
  for (const e of bewertet) {
    if (gewaehlt.length >= soll) break;
    if (drin.has(e.p.id)) continue;
    gewaehlt.push(e.p); drin.add(e.p.id);
  }

  const verband = nationVon(nation);
  return {
    nation,
    name: nationName(nation),
    playerIds: sortBy(gewaehlt, p => ({ key: playerOverall(p), desc: true }), p => p.id).map(p => p.id),
    kaderSoll: KADER_SOLL,
    // Was dieses Spiel nicht führt, holt der Verband anderswo her. Ehrlicher,
    // als so zu tun, als bestünde die Auswahl Portugals aus elf Bundesligisten.
    ausserhalb: Math.max(0, KADER_SOLL - gewaehlt.length),
    ruf: verband.ruf, staerke: verband.staerke, konf: verband.konf
  };
}

function periodenId(state) {
  const p = periodeAn(state, state.date.day) || naechstePeriode(state, state.date.day);
  return p ? p.id : 'ohne';
}

/**
 * Die Aufgebote der laufenden (oder nächsten) Periode.
 *
 * @param {object} state
 * @param {string|object|null} nation  Länderkürzel — oder der ctx, dann alle
 * @param {object} [ctx]
 * @returns {Array<{nation, name, playerIds, ...}>}
 */
export function berufungen(state, nation = null, ctx = null) {
  if (nation && typeof nation === 'object') { ctx = nation; nation = null; }
  const n = sicherState(state);
  const periode = periodeAn(state, state.date.day) || naechstePeriode(state, state.date.day);

  // Steht das Aufgebot der laufenden Periode schon, gilt es. Sonst wüsste der
  // Kaderbildschirm etwas anderes als die Belastungsrechnung.
  if (n.periode && periode && n.periode.id === periode.id && Object.keys(n.aufgebote).length) {
    const fertig = Object.keys(n.aufgebote).map(nat => n.aufgebote[nat]);
    return nation ? fertig.filter(a => a.nation === nation) : fertig;
  }

  const nationen = nation ? [nation] : nationenDerPeriode(state, periode);
  const out = [];
  for (const nat of nationen) {
    const kader = nationalkader(state, nat, ctx);
    if (kader) out.push(kader);
  }
  return out;
}

/** Welche Verbände spielen in dieser Periode? */
function nationenDerPeriode(state, periode) {
  const n = sicherState(state);
  if (periode && periode.art === 'turnier' && n.turnier) return n.turnier.teilnehmer.slice();
  // In der Länderspielpause spielt jeder Verband, den dieses Spiel besetzen kann.
  const gezaehlt = {};
  for (const id in state.players) {
    const p = state.players[id];
    if (!p || !p.clubId || p.retired) continue;
    gezaehlt[p.nationality] = (gezaehlt[p.nationality] || 0) + 1;
  }
  return Object.keys(gezaehlt)
    .filter(nat => gezaehlt[nat] >= KADER_MIN)
    .sort((a, b) => nationVon(b).staerke - nationVon(a).staerke);
}

/* ==========================================================================
 * 6. Ein Länderspiel
 * ======================================================================== */

/** Spielstärke einer Auswahl: halb Verbandsruf, halb das, was dieses Spiel führt. */
function nationStaerke(state, nation) {
  const kader = (state.national && state.national.aufgebote && state.national.aufgebote[nation]) || null;
  const verband = nationVon(nation);
  if (!kader || !kader.playerIds.length) return verband.staerke;
  const elf = kader.playerIds.slice(0, 11).map(id => state.players[id]).filter(Boolean);
  if (!elf.length) return verband.staerke;
  const eigen = avg(elf, p => playerOverall(p));
  return clamp(verband.staerke * 0.55 + eigen * 0.45, 30, 99);
}

function poisson(rng, lambda) {
  const L = Math.exp(-clamp(lambda, 0.05, 6));
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > L && k < 12);
  return k - 1;
}

/** Wer im Aufgebot spielt heute? Elf plus drei Einwechslungen. */
function einsatzliste(state, kader, rng) {
  const verfuegbar = kader.playerIds
    .map(id => state.players[id])
    .filter(p => p && !p.injury && !p.retired);
  // Die Frische wiegt schwer: Wer am Donnerstag 90 Minuten hatte, sitzt am
  // Sonntag draußen. Ohne diese Rotation liefen im Verbandsdienst immer
  // dieselben elf Mann, und der Verein bekäme sie als Wracks zurück.
  const sortiert = sortBy(verfuegbar,
    p => ({ key: playerOverall(p) + (typeof p.fitness === 'number' ? (p.fitness - 80) * 0.18 : 0), desc: true }),
    p => p.id);
  const elf = sortiert.slice(0, EINSATZ_ELF);
  const bank = rng.shuffle(sortiert.slice(EINSATZ_ELF)).slice(0, EINSATZ_WECHSEL);
  return { elf, bank };
}

/**
 * Ein Länderspiel: Ergebnis, Belastung, Torschützen, Blessuren.
 * @returns {{ heim, gast, tore:[number,number], sieger:string|null, elfmeter:boolean, torschuetzen:[] }}
 */
function laenderspiel(state, ctx, natA, natB, rng, opts = {}) {
  const sa = nationStaerke(state, natA);
  const sb = nationStaerke(state, natB);
  const diff = (sa - sb) / 100;
  let toreA = poisson(rng, clamp(1.32 + diff * 2.4, 0.2, 5));
  let toreB = poisson(rng, clamp(1.32 - diff * 2.4, 0.2, 5));

  let elfmeter = false, sieger = null;
  if (opts.koPhase && toreA === toreB) {
    elfmeter = true;
    sieger = rng.chance(clamp(0.5 + diff * 0.35, 0.2, 0.8)) ? natA : natB;
  } else if (toreA > toreB) sieger = natA;
  else if (toreB > toreA) sieger = natB;

  const torschuetzen = [];
  for (const [nat, tore] of [[natA, toreA], [natB, toreB]]) {
    const kader = state.national.aufgebote[nat];
    if (!kader) continue;
    const { elf, bank } = einsatzliste(state, kader, rng);
    belasten(state, ctx, nat, elf, bank, rng, opts);
    for (let i = 0; i < tore; i++) {
      const schuetze = torschuetze(elf.concat(bank), rng);
      if (!schuetze) continue;
      akte(schuetze).tore++;
      torschuetzen.push({ nation: nat, playerId: schuetze.id, name: spn(schuetze) });
    }
  }
  return { heim: natA, gast: natB, tore: [toreA, toreB], sieger, elfmeter, torschuetzen };
}

function torschuetze(spieler, rng) {
  if (!spieler.length) return null;
  return rng.pickWeighted(spieler, p => {
    const g = POSITION_GROUP[p.position] || 'MIT';
    const basis = g === 'STU' ? 10 : g === 'MIT' ? 5 : g === 'ABW' ? 1.4 : 0.1;
    const a = p.attributes || {};
    return Math.max(0.05, basis * (0.6 + ((a.schuss || 50) + (a.technik || 50)) / 200));
  });
}

/** Minuten in die Knochen, Statistik in die Akte, gelegentlich eine Blessur. */
function belasten(state, ctx, nation, elf, bank, rng, opts = {}) {
  const faktor = REISE[nationVon(nation).konf] || 1;
  for (const p of elf.concat(bank)) {
    const minuten = elf.includes(p) ? SPIEL_MINUTEN_ELF : SPIEL_MINUTEN_WECHSEL;
    const a = akte(p);
    a.spiele++;
    if (!a.debuet) a.debuet = { season: state.date.season, day: state.date.day };
    a.letzte = { season: state.date.season, day: state.date.day };
    try {
      fitnessNachSpiel(state, p.id, minuten, opts.intensitaet || 1);
    } catch (err) { /* die Medizin hat das letzte Wort, nicht der Verband */ }

    const risiko = VERLETZUNG_JE_SPIEL * faktor * (minuten / 90) * (opts.risiko || 1);
    if (rng.chance(risiko)) {
      try {
        const res = verletzen(state, p.id, { rng, ursache: 'spiel' });
        if (res && res.ok && p.clubId === state.managerClubId && ctx && ctx.log) {
          ctx.log(
            `${spn(p)} hat sich im Trikot ${nationName(nation)}s verletzt: ${res.injury ? res.injury.name : 'Blessur'}.\n\n` +
            `Der Verband bedauert das sehr. Bezahlt wird der Mann trotzdem von uns.`,
            'medizin', { from: 'Medizinische Abteilung', subject: `${spn(p)} verletzt zurück`, wichtig: true });
        }
      } catch (err) { /* siehe oben */ }
    }
  }
}

/* ==========================================================================
 * 7. Länderspielpause
 * ======================================================================== */

/**
 * Führt den heutigen Tag der laufenden Länderspielpause aus.
 * Ohne laufende Pause passiert nichts.
 * @returns {{ aktiv:boolean, tag?:number, spiele?:Array, text?:string }}
 */
export function laenderspielpause(state, ctx) {
  const n = sicherState(state);
  const periode = periodeAn(state, state.date.day);
  if (!periode || periode.art !== 'pause') return { aktiv: false };

  periodeStarten(state, ctx, periode);
  const tag = state.date.day;
  reisebelastung(state, periode);

  // Auch hier: höchstens ein Spieltag je Tag, egal wie oft jemand anklopft.
  if (!periode.spieltage.includes(tag)) return { aktiv: true, tag, spiele: [] };
  if (n.gespieltTag === tag && n.gespieltSaison === state.date.season) return { aktiv: true, tag, spiele: [] };
  n.gespieltTag = tag;
  n.gespieltSaison = state.date.season;

  const rng = nrng(state, 'pause:' + periode.id + ':' + tag);
  const nationen = Object.keys(n.aufgebote);
  const gemischt = rng.shuffle(nationen);
  const spiele = [];
  for (let i = 0; i + 1 < gemischt.length; i += 2) {
    spiele.push(laenderspiel(state, ctx, gemischt[i], gemischt[i + 1], rng, { intensitaet: 0.92 }));
  }
  // Ungerade Zahl: Wer übrig bleibt, hat testspielfrei. Kommt vor.
  meldungSpieltag(state, ctx, spiele, 'Länderspiele');
  return { aktiv: true, tag, spiele };
}

/* ==========================================================================
 * 8. Turnier
 * ======================================================================== */

/** Setzt das Turnier der Saison auf: Teilnehmerfeld und leerer Baum. */
function turnierAufsetzen(state) {
  const art = turnierArt(state.date.season);
  const rng = nrng(state, 'turnierfeld');
  const jahr = (state.date.startYear || 2025) + state.date.season - 1;

  const kandidaten = NATIONEN.filter(v => art === 'em' ? v.konf === 'europa' : true);
  const bewertet = sortBy(
    kandidaten.map(v => ({ v, w: v.staerke + weltbeitrag(state, v.id) + rng.float(-3, 3) })),
    e => ({ key: e.w, desc: true }), e => e.v.id);

  const feld = [];
  let europaeer = 0;
  for (const e of bewertet) {
    if (feld.length >= TURNIER_FELD) break;
    if (art === 'wm' && e.v.konf === 'europa') {
      if (europaeer >= TURNIER_EUROPA_MAX) continue;
      europaeer++;
    }
    feld.push(e.v.id);
  }

  return {
    art, name: TURNIER_NAMEN[art], jahr,
    teilnehmer: feld,
    paarungen: rng.shuffle(feld.slice()),   // die Auslosung des Achtelfinales
    runde: 0, ergebnisse: [], sieger: null, finalist: null, halbfinalisten: [],
    aus: {}                                 // Nation -> gespielte Turnierpartien
  };
}

/** Wie stark macht der Spielerbestand dieses Spiels eine Auswahl? 0..8 Punkte. */
function weltbeitrag(state, nation) {
  const alle = spielerDerNation(state, nation).slice(0, 11);
  if (alle.length < 5) return 0;
  return clamp((avg(alle, p => playerOverall(p)) - 70) * 0.35, -4, 8);
}

/**
 * Führt den heutigen Turniertag aus — und liefert den Turnierstand.
 * Außerhalb eines Turniers ist das ein reiner Lesezugriff.
 */
export function turnier(state, ctx) {
  const n = sicherState(state);
  if (!n.turnier) return null;
  const periode = periodeAn(state, state.date.day);
  if (!periode || periode.art !== 'turnier') return n.turnier;

  periodeStarten(state, ctx, periode);
  reisebelastung(state, periode);

  const t = n.turnier;
  const runde = TURNIER_RUNDEN.find(r => r.tag === state.date.day);
  if (!runde || t.runde >= TURNIER_RUNDEN.indexOf(runde) + 1) return t;

  const rng = nrng(state, 'turnier:' + runde.name);
  const nummer = TURNIER_RUNDEN.indexOf(runde) + 1;
  const feld = t.paarungen.slice(0, runde.teams);
  const weiter = [];
  const spiele = [];
  for (let i = 0; i + 1 < feld.length; i += 2) {
    const s = laenderspiel(state, ctx, feld[i], feld[i + 1], rng, { koPhase: true, intensitaet: 1.05 });
    spiele.push(Object.assign({ runde: runde.name }, s));
    const sieger = s.sieger || feld[i];
    weiter.push(sieger);
    const raus = sieger === feld[i] ? feld[i + 1] : feld[i];
    t.aus[raus] = nummer;
    n.aktiv[raus] = false;
    heimreise(state, ctx, raus, runde.name, nummer);
  }
  t.runde = nummer;
  t.paarungen = weiter;
  t.ergebnisse = t.ergebnisse.concat(spiele);
  if (runde.name === 'Halbfinale') t.halbfinalisten = feld.slice();
  if (runde.name === 'Endspiel') {
    t.sieger = weiter[0] || null;
    t.finalist = feld.find(x => x !== t.sieger) || null;
    if (t.sieger) { t.aus[t.sieger] = nummer; heimreise(state, ctx, t.sieger, 'Endspiel', nummer); }
    turniersiegVerbuchen(state, ctx, t);
  }
  meldungSpieltag(state, ctx, spiele, `${t.name} ${t.jahr} — ${runde.name}`);
  return t;
}

/**
 * Wer ausscheidet, fährt heim — mit der Turniermüdigkeit im Gepäck.
 *
 * Warum ein einmaliger Abzug und nicht nur die Tagesbelastung: Die Regeneration
 * in medical.js läuft im Urlaub mit Faktor 1,5 (rund 8 Punkte je Tag) und die
 * Fitness ist bei 100 gedeckelt. Ohne diesen Abzug käme ein Weltmeister genauso
 * erholt zum Trainingsauftakt wie der Kollege, der drei Wochen am Strand lag —
 * und das ist der eine Satz, den ein Fußballmanager nicht sagen darf.
 */
function heimreise(state, ctx, nation, runde, spiele = 1) {
  const kader = state.national.aufgebote[nation];
  if (!kader) return;
  const abzug = 8 + spiele * 9;      // ein Achtelfinale kostet 17, ein Finale 44
  for (const id of kader.playerIds) {
    const p = state.players[id];
    if (!p || p.injury) continue;
    const fit = typeof p.fitness === 'number' ? p.fitness : 100;
    p.fitness = clamp(round(Math.min(fit, 100 - abzug), 1), 5, 100);
  }
  const eigene = kader.playerIds
    .map(id => state.players[id])
    .filter(p => p && p.clubId === state.managerClubId);
  if (!eigene.length || !ctx || !ctx.log) return;
  ctx.log(
    `${nationName(nation)} ist im ${runde} ausgeschieden. Für uns heißt das: ` +
    `${eigene.map(spn).join(', ')} ${eigene.length === 1 ? 'ist' : 'sind'} früher zurück als geplant.\n\n` +
    `Erholt sieht anders aus — ${spiele} Turnierspiele stecken in den Beinen. ` +
    `Trauern kann man aber auch auf dem Trainingsplatz.`,
    'info', { from: 'Geschäftsstelle', subject: `Rückkehrer aus ${nationName(nation)}` });
}

function turniersiegVerbuchen(state, ctx, t) {
  const platzierung = {};
  if (t.sieger) platzierung[t.sieger] = 'Sieger';
  if (t.finalist) platzierung[t.finalist] = 'Finalist';
  for (const nat of t.halbfinalisten) if (!platzierung[nat]) platzierung[nat] = 'Halbfinale';

  for (const nat of Object.keys(platzierung)) {
    const kader = state.national.aufgebote[nat];
    if (!kader) continue;
    for (const id of kader.playerIds) {
      const p = state.players[id];
      if (!p) continue;
      const a = akte(p);
      a.turniere.push({ s: t.jahr, art: t.art, platz: platzierung[nat] });
      if (a.turniere.length > 6) a.turniere.shift();
      if (platzierung[nat] === 'Sieger') {
        try { moralAendern(state, id, MORAL_TURNIERSIEG, `${t.name}ssieger mit ${nationName(nat)}`); } catch (err) { /* egal */ }
      }
    }
  }

  if (!ctx || !ctx.log || !t.sieger) return;
  const kader = state.national.aufgebote[t.sieger];
  const eigene = kader
    ? kader.playerIds.map(id => state.players[id]).filter(p => p && p.clubId === state.managerClubId)
    : [];
  ctx.log(
    `${nationName(t.sieger)} gewinnt die ${t.name} ${t.jahr}.` +
    (t.finalist ? ` Im Endspiel gegen ${nationName(t.finalist)}.` : '') + '\n\n' +
    (eigene.length
      ? `Mit dabei: ${eigene.map(spn).join(', ')}. Der Pokal steht jetzt in einer Vitrine, ` +
        `die uns nicht gehört — der Mann steht ab Montag wieder bei uns auf dem Platz. Vermutlich müde.`
      : `Von uns war niemand dabei. Man kann es auch als Vorteil sehen: Unsere Leute sind ausgeruht.`),
    'info', { from: 'Sportredaktion', subject: `${t.name} ${t.jahr}: ${nationName(t.sieger)}`, wichtig: eigene.length > 0 });
}

/* ==========================================================================
 * 9. Periodenlogik: Nominierung, Reise, Rückkehr
 * ======================================================================== */

/** Beginnt eine Periode: nominieren, Moral bewegen, Postfach füllen. */
function periodeStarten(state, ctx, periode) {
  const n = sicherState(state);
  if (n.periode && n.periode.id === periode.id) return;

  n.periode = { art: periode.art, id: periode.id, von: periode.von, bis: periode.bis };
  n.aufgebote = {};
  n.aktiv = {};

  const berufen = new Set();
  for (const nat of nationenDerPeriode(state, periode)) {
    const kader = nationalkader(state, nat, null);
    if (!kader) continue;
    n.aufgebote[nat] = kader;
    n.aktiv[nat] = true;
    for (const id of kader.playerIds) berufen.add(id);
  }

  // Moral: Die Berufung freut, die Nichtberufung kränkt — aber nur den, der
  // schon einmal dabei war. Wer nie berufen wurde, erwartet es auch nicht.
  //
  // Der Grund wird nur bei den eigenen Spielern mitgegeben: moralAendern legt
  // daraus eine Beschwerde in `happiness.beschwerden` an, und acht Zeilen mal
  // 1.100 Spieler mal drei Perioden je Saison wären ein halbes Megabyte
  // Spielstand für einen Satz, den niemand je liest.
  for (const id in state.players) {
    const p = state.players[id];
    if (!p || !p.clubId || p.retired) continue;
    const eigen = p.clubId === state.managerClubId;
    const dabei = berufen.has(id);
    const a = p.national || null;
    if (dabei) {
      const erst = !a || !a.spiele;
      akte(p).berufen = true;
      try {
        moralAendern(state, id, MORAL_BERUFUNG * (erst ? 1.6 : 1),
          eigen ? (erst ? 'Erste Berufung in die Nationalmannschaft' : 'Für die Nationalmannschaft nominiert') : null);
      } catch (err) { /* Moral ist Sache der Kabine */ }
    } else {
      if (a) a.berufen = false;
      if (a && a.spiele >= NATIONALSPIELER_AB && n.aufgebote[p.nationality]) {
        try {
          moralAendern(state, id, MORAL_NICHT_BERUFEN, eigen ? 'Diesmal nicht nominiert' : null);
        } catch (err) { /* s. o. */ }
      }
    }
  }

  meldungBerufungen(state, ctx, periode);
}

/**
 * Reisen, Trainingslager, Hotelbetten: jeder Tag im Verbandsdienst kostet.
 * Höchstens einmal je Tag — turnier() und laenderspielpause() sind exportiert
 * und dürfen auch von einem Bildschirm aus gefahrlos aufgerufen werden.
 */
function reisebelastung(state, periode) {
  const n = state.national;
  if (n.belastetTag === state.date.day && n.belastetSaison === state.date.season) return;
  n.belastetTag = state.date.day;
  n.belastetSaison = state.date.season;
  for (const nat of Object.keys(n.aufgebote)) {
    if (n.aktiv[nat] === false) continue;         // ausgeschieden = zu Hause
    const faktor = REISE[nationVon(nat).konf] || 1;
    for (const id of n.aufgebote[nat].playerIds) {
      const p = state.players[id];
      if (!p || p.injury) continue;
      const alt = typeof p.fitness === 'number' ? p.fitness : 100;
      p.fitness = clamp(round(alt - REISE_FITNESS_TAG * faktor, 1), 5, 100);
    }
  }
}

/* ==========================================================================
 * 10. Post für den Managerverein
 * ======================================================================== */

function eigeneBerufene(state) {
  const n = state.national;
  const out = [];
  for (const nat of Object.keys(n.aufgebote)) {
    for (const id of n.aufgebote[nat].playerIds) {
      const p = state.players[id];
      if (p && p.clubId === state.managerClubId) out.push({ p, nation: nat });
    }
  }
  return out;
}

function meldungBerufungen(state, ctx, periode) {
  if (!ctx || typeof ctx.log !== 'function') return;
  const n = state.national;
  const eigene = eigeneBerufene(state);
  const anlass = periode.art === 'turnier'
    ? `${n.turnier ? n.turnier.name : 'Das Turnier'} ${n.turnier ? n.turnier.jahr : ''}`.trim()
    : 'Die Länderspielpause';

  if (!eigene.length) {
    ctx.log(
      `${anlass} beginnt. Aus unserem Kader ist niemand berufen.\n\n` +
      `Das ist ärgerlich für die Spieler und angenehm für uns: Wir trainieren komplett, ` +
      `während anderswo halbe Mannschaften am Flughafen stehen.`,
      'info', { from: 'Geschäftsstelle', subject: 'Keine Berufungen' });
    return;
  }

  const fern = eigene.filter(e => (nationVon(e.nation).konf || 'europa') !== 'europa');
  const zeilen = eigene.map(e =>
    `• ${spn(e.p)} — ${nationName(e.nation)}${(nationVon(e.nation).konf || 'europa') !== 'europa'
      ? ' (' + (KONF_ZIEL[nationVon(e.nation).konf] || 'weit weg') + ')' : ''}`);

  const kopf = eigene.length === 1
    ? `Einer unserer Spieler ist berufen.`
    : `${zahlwort(eigene.length)} unserer Spieler sind berufen` +
      (fern.length ? ` — ${fern.length === 1 ? 'einer davon fliegt' : zahlwort(fern.length).toLowerCase() + ' davon fliegen'} ` +
        `${KONF_ZIEL[nationVon(fern[0].nation).konf] || 'weit weg'}.` : '.');

  ctx.log(
    `${kopf}\n\n${zeilen.join('\n')}\n\n` +
    (periode.art === 'turnier'
      ? `Wir sehen sie zum Trainingsauftakt wieder. Wie sie dann aussehen, entscheidet der Turnierverlauf.`
      : `Zurück sind sie in fünf Tagen. Erfahrungsgemäß nicht frischer als vorher.`),
    'info', {
      from: 'Geschäftsstelle',
      subject: eigene.length === 1
        ? `${spn(eigene[0].p)} ist nominiert`
        : `${eigene.length} Berufungen`,
      wichtig: eigene.length >= 3
    });
}

const ZAHLWORT = ['Keiner', 'Einer', 'Zwei', 'Drei', 'Vier', 'Fünf', 'Sechs', 'Sieben', 'Acht', 'Neun', 'Zehn'];
function zahlwort(n) { return ZAHLWORT[n] || String(n); }

function meldungSpieltag(state, ctx, spiele, titel) {
  if (!ctx || typeof ctx.log !== 'function' || !spiele.length) return;
  const eigene = new Set(eigeneBerufene(state).map(e => e.p.id));
  const treffer = [];
  for (const s of spiele) {
    for (const t of s.torschuetzen || []) if (eigene.has(t.playerId)) treffer.push(t);
  }
  if (!treffer.length) return;
  ctx.log(
    `${titel}: ${treffer.map(t => `${t.name} trifft für ${nationName(t.nation)}`).join(', ')}.\n\n` +
    `Schön für ihn. Wir hätten das Tor lieber am Samstag gesehen.`,
    'info', { from: 'Sportredaktion', subject: `Tor im Nationaltrikot` });
}

/* ==========================================================================
 * 11. Der Taktgeber
 * ======================================================================== */

/**
 * Ein Tag beim Verband. Wird aus core/loop.js:advanceDay gerufen — genau
 * einmal je Tag. Mehrfachaufrufe am selben Tag sind folgenlos.
 */
export function tickNational(state, ctx) {
  const n = sicherState(state);
  const tag = state.date.day;
  if (n.letzterTag === tag && n.letzteSaison === state.date.season) return n;
  n.letzterTag = tag;
  n.letzteSaison = state.date.season;

  const periode = periodeAn(state, tag);
  if (!periode) {
    // Nach der Rückkehr ist Schluss: Das Aufgebot bleibt als Chronik stehen,
    // die Reisebelastung nicht — und niemand ist mehr „aktuell berufen".
    if (n.periode && tag > n.periode.bis) {
      for (const nat of Object.keys(n.aufgebote)) {
        for (const id of n.aufgebote[nat].playerIds) {
          const p = state.players[id];
          if (p && p.national) p.national.berufen = false;
        }
      }
      n.periode = null;
    }
    return n;
  }

  if (periode.art === 'turnier') turnier(state, ctx);
  else laenderspielpause(state, ctx);
  return n;
}

/* ==========================================================================
 * 12. Berichte
 * ======================================================================== */

/**
 * Die Länderspielbilanz eines Spielers.
 * @returns {null|{ nation, nationName, spiele, tore, debuet, turniere, berufen, text }}
 */
export function nationalBericht(state, playerId) {
  const p = state.players[playerId];
  if (!p) return null;
  const a = p.national;
  const nation = (a && a.nation) || p.nationality;
  const verband = nationVon(nation);
  if (!a || !a.spiele) {
    return {
      nation, nationName: nationName(nation), spiele: 0, tore: 0,
      debuet: null, turniere: [], berufen: !!(a && a.berufen), ruf: verband.ruf,
      text: (a && a.berufen)
        ? `Erstmals im Aufgebot ${nationName(nation)}s. Sein Debüt steht noch aus.`
        : `Noch kein Länderspiel für ${nationName(nation)}.`
    };
  }
  const titel = a.turniere.filter(t => t.platz === 'Sieger');
  const teile = [`${a.spiele} ${a.spiele === 1 ? 'Länderspiel' : 'Länderspiele'} für ${nationName(nation)}`];
  if (a.tore) teile.push(`${a.tore} ${a.tore === 1 ? 'Tor' : 'Tore'}`);
  if (a.debuet) teile.push(`Debüt in Saison ${a.debuet.season}`);
  let text = teile.join(', ') + '.';
  if (titel.length) {
    text += ` ${titel.length === 1 ? 'Einmal' : titel.length + '-mal'} ` +
      `${titel[0].art === 'wm' ? 'Weltmeister' : 'Europameister'} (${titel.map(t => t.s).join(', ')}).`;
  } else if (a.turniere.length) {
    text += ` Turnierbilanz: ${a.turniere.map(t => `${t.s} ${t.platz}`).join(', ')}.`;
  }
  if (a.berufen) text += ' Aktuell im Aufgebot.';
  return {
    nation, nationName: nationName(nation), spiele: a.spiele, tore: a.tore,
    debuet: a.debuet, turniere: a.turniere.slice(), berufen: !!a.berufen,
    ruf: verband.ruf, text
  };
}

/** Wer aus diesem Verein gerade beim Verband ist — für den Kaderbildschirm. */
export function berufeneSpieler(state, clubId) {
  const n = sicherState(state);
  const out = [];
  if (!n.periode) return out;      // außerhalb der Abstellperioden ist niemand weg
  for (const nat of Object.keys(n.aufgebote)) {
    for (const id of n.aufgebote[nat].playerIds) {
      const p = state.players[id];
      if (p && p.clubId === clubId) {
        out.push({ playerId: id, nation: nat, nationName: nationName(nat), unterwegs: n.aktiv[nat] !== false });
      }
    }
  }
  return out;
}

/** Gesamtlage des Verbandsbetriebs — für Bildschirme und Berichte. */
export function nationalStand(state) {
  const n = sicherState(state);
  const periode = periodeAn(state, state.date.day);
  return {
    periode, naechste: periode ? null : naechstePeriode(state, state.date.day),
    turnier: n.turnier, aufgebote: n.aufgebote,
    eigene: berufeneSpieler(state, state.managerClubId),
    pausen: n.pausen.slice()
  };
}

/* ==========================================================================
 * 13. Das Amt des Nationaltrainers
 * ======================================================================== */

/**
 * Die Anfrage des Verbands. Andockstelle: club/board.js:jobangebote() ruft das
 * hier im selben Rhythmus wie die Vereinsangebote auf.
 *
 * WARUM MAN NICHT ANNEHMEN KANN — und warum trotzdem ein Brief kommt:
 * Das Amt hieße Alltag ohne Verein: kein Training, keine Transfers, kein
 * Vorstand, elf Spieltermine im Jahr. Dieses Spiel hat für jeden dieser
 * Bereiche ein Modul, das einen `state.managerClubId` voraussetzt — ein
 * Nationaltrainer ohne Verein hätte fünfzehn leere Bildschirme. Ein
 * Zusageknopf, der in Wahrheit nichts ändert, wäre eine Lüge; deshalb sagt
 * der Verband hier, was Sache ist, und der Manager sagt ab. Was bleibt, ist
 * echt: Die Anfrage hebt den Ruf, und sie steht in der Akte.
 *
 * @returns {null|object} die Anfrage, falls eine gestellt wurde
 */
export function nationaltrainerAngebot(state, ctx) {
  const n = sicherState(state);
  const m = state.manager;
  if (!m || !state.managerClubId) return null;
  if (state.flags && state.flags.entlassen) return null;

  const v = n.verband;
  if (v.anfragen >= VERBAND_MAX_ANFRAGEN) return null;
  if (v.letzteSaison === state.date.season) return null;
  if ((m.reputation || 0) < VERBAND_RUF) return null;
  if ((m.titel || []).length < VERBAND_MIN_TITEL) return null;
  // Die Lizenzstufe führt club/karriere.js. Fehlt sie (alter Spielstand), zählt
  // die Startlizenz — und die reicht dem Verband nicht.
  if ((m.lizenzStufe || 3) < VERBAND_LIZENZ) return null;

  const rng = (ctx && ctx.rng && ctx.rng.fork) ? ctx.rng.fork('verband') : nrng(state, 'verband');
  if (!rng.chance(clamp(((m.reputation || 0) - VERBAND_RUF) / 40 + 0.25, 0.2, 0.7))) return null;

  v.anfragen++;
  v.letzteSaison = state.date.season;
  const heimat = nationVon(m.nationality || 'DE');
  const club = state.clubs[state.managerClubId];
  m.reputation = clamp(round((m.reputation || 40) + 2, 1), 1, 100);

  const anfrage = {
    art: 'nationaltrainer',
    nation: heimat.id,
    season: state.date.season,
    tag: state.date.day,
    nummer: v.anfragen,
    beantwortet: 'abgelehnt'
  };
  if (!Array.isArray(m.anfragen)) m.anfragen = [];
  m.anfragen.push(anfrage);
  if (m.anfragen.length > 8) m.anfragen.shift();

  const letzte = v.anfragen >= VERBAND_MAX_ANFRAGEN;
  if (ctx && typeof ctx.log === 'function') {
    ctx.log(
      `Sehr geehrter ${m.name},\n\n` +
      `der Verband sucht einen Trainer für die Auswahl ${nationName(heimat.id)}s. Ihr Name ist in ` +
      `unserer Sitzung mehrfach gefallen — bei einigen sogar wohlwollend.\n\n` +
      `Eines vorweg: Wir suchen niemanden im Nebenamt. Wer diese Mannschaft übernimmt, ` +
      `legt sein Vereinsamt nieder. Ihr Büro bei ${club ? club.shortName : 'Ihrem Verein'} bliebe leer.\n\n` +
      `Ihre Antwort haben wir bereits erhalten: Sie bleiben, wo Sie sind. Das respektieren wir. ` +
      (letzte
        ? `Ein viertes Mal fragen wir nicht — wir besetzen die Stelle jetzt anderweitig.`
        : `Wir kommen in ein, zwei Jahren noch einmal auf Sie zu.`) + '\n\n' +
      `(Ein Amt ohne Verein kennt dieses Spiel nicht. Was bleibt, ist das Angebot selbst — ` +
      `und der Ruf, der damit kommt: +2.)`,
      'vorstand', {
        from: `${nationName(heimat.id)} — Verband`,
        subject: `Anfrage: Nationaltrainer ${nationName(heimat.id)}`,
        wichtig: true
      });
  }
  if (ctx && typeof ctx.news === 'function') {
    ctx.news(`Der Verband soll bei ${m.name} angefragt haben. Der Verein dementiert — vorsichtshalber.`, 'geruecht');
  }
  return anfrage;
}
