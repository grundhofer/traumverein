/**
 * DER EUROPAPOKAL — club/europa.js   (ROADMAP-Stufe 3)
 *
 * Aus dem Datengerüst in data/leagues.js (EURO, EURO_CLUBS, generateEuropeSchedule)
 * wird hier ein Wettbewerb: Qualifikation, Auslosung, Ligaphase, K.-o.-Runden,
 * Prämien, Postfach. Drei Wettbewerbe unter einem Dach — Champions League,
 * Europa League, Conference League.
 *
 * ── DIE VIER ENTSCHEIDUNGEN, DIE MAN KENNEN MUSS ───────────────────────────
 *
 * 1. KEINE AUSWÄRTSTORREGEL.
 *    Die UEFA hat sie 2021 abgeschafft, und zwar aus dem besseren Grund: Sie
 *    bestraft die Mannschaft, die das Rückspiel zu Hause bestreitet, für einen
 *    Umstand, den sie nicht gewählt hat — in der Verlängerung des Rückspiels
 *    zählen die Tore des Gastes doppelt, die des Gastgebers gar nicht. Wer den
 *    Anstoss-Charme vermisst: Der bleibt erhalten, nur an der ehrlicheren
 *    Stelle. Bei Gleichstand nach zwei Spielen gibt es Verlängerung, und wenn
 *    die auch nichts hergibt, wird ausgeschossen (engine/shootout.js). Das ist
 *    dramatischer als eine Rechenregel, die niemand im Stadion mitrechnen kann.
 *
 * 2. FERNERGEBNISSE.
 *    Voll ausgespielt wird nur, was den eigenen Verein betrifft. Alle anderen
 *    Partien — auch die der übrigen deutschen Starter — laufen als
 *    „Fernergebnis": ein Ergebnis aus dem Ruf beider Vereine, ohne dass ein
 *    Kader entstehen muss. Das ist kein Geiz, sondern das Spielstandbudget aus
 *    ROADMAP S3: 66 europäische Kader kosten über eine Megabyte, und
 *    tools/test-europa.js lässt höchstens 40 davon zu. Die Belastung der
 *    deutschen Vereine geht trotzdem nicht verloren — club/medical.js holt sich
 *    jede gespielte Partie am Folgetag selbst (verpassteSpieleNachholen).
 *
 * 3. FELDGRÖSSE 24 STATT 36.
 *    EURO.competitions nennt 36 Vereine je Wettbewerb. Dafür bräuchte es 108
 *    Startplätze; data/leagues.js kennt 66 europäische Vereine, dazu sieben bis
 *    acht deutsche. Also 24 je Wettbewerb (72 von 73 Plätzen belegt — für einen
 *    reicht es jedes Jahr nicht). Der K.-o.-Baum bleibt davon unberührt und
 *    entspricht genau EURO.knockout: 24 überwintern, die besten acht überspringen
 *    die Play-off-Runde, danach Achtelfinale, Viertelfinale, Halbfinale, Endspiel.
 *
 * 4. NACHLOSUNG.
 *    generateEuropeSchedule() zieht die Gegner aus dem gesamten Topf eines
 *    Wettbewerbs, nicht aus dessen Feld — derselbe Verein könnte dienstags in der
 *    Champions League und donnerstags in der Europa League antreten. Termine,
 *    Heimrecht und Spieltagsraster kommen deshalb weiterhin von dort; jeder
 *    Gegner, der in diesem Jahr woanders spielt, wird hier nachgelost.
 *
 * ── SCHEMA ────────────────────────────────────────────────────────────────
 *
 *   state.europa = {
 *     saison,                       Saison, für die das Feld steht
 *     teilnehmer: [{ clubId, competition }],     deutsche Starter (flache Liste)
 *     feld:     { cl:[24 ids], el:[…], conf:[…] },
 *     ko:       { cl:{ runde, gesetzt:[], fertig }, … },   runde = Index in EURO.knockout, -1 = Ligaphase
 *     abschluss:{ cl:[{ clubId, platz, punkte, spiele, tore, gegentore, diff }], … },
 *     abgerechnet:{ cl, el, conf },  Ligaphasenspieltag, bis zu dem Prämien geflossen sind
 *     praemien: { clubId: betrag },  Saisonsumme, wandert in den Saisonbericht
 *     sieger:   { cl, el, conf },
 *     ausgeschieden: [saison, …],    Saisons, in denen der eigene Verein ausschied
 *     runde, paarungen               Altfelder aus core/state.js, bleiben bedient
 *   }
 *
 * Kein Math.random(), kein Date.now(). Aller Zufall hängt an state.seed und an
 * unveränderlichen Schlüsseln (Saison, Wettbewerb, Runde, Fixture-ID) — nie am
 * Tag, an dem gerechnet wird. Sonst verschöbe sich die Auslosung, sobald jemand
 * einen Spielstand an einem anderen Tag lädt.
 *
 * Wie der Rest von club/* importiert dieses Modul weder core/state.js noch
 * core/loop.js (siehe club/finances.js:157) — es bleibt eigenständig prüfbar.
 */

import { clamp, pad } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { SEASON_DAYS } from '../core/constants.js';
import {
  EURO, EURO_CLUBS, LEAGUES, LEAGUE_IDS, CUP, computeTable, generateEuropeSchedule
} from '../data/leagues.js';
import { buchen } from './finances.js';
import { spielNachbereitung } from './medical.js';
import { elfmeterschiessen } from '../engine/shootout.js';
import { playerOverall } from '../engine/ratings.js';

/* ==========================================================================
 * 1. Konstanten
 * ======================================================================== */

/** Die drei Wettbewerbe unter dem Dach „Europapokal". */
export const WB_IDS = ['cl', 'el', 'conf'];

/** Teilnehmer je Wettbewerb. Siehe Entscheidung 3 im Kopf. */
const FELD_GROESSE = 24;

/** Wie viele überspringen die Play-off-Runde? (EURO.knockout: af hat 16 Plätze) */
const GESETZT_AF = 8;

/**
 * Wochentagsversatz der K.-o.-Termine. EURO.knockout nennt nur Basistage
 * (immer ein Dienstag); die Champions League spielt Di/Mi, Europa League und
 * Conference donnerstags — dieselbe Aufteilung wie in der Ligaphase
 * (EURO.competitions[*].dayOffsets).
 */
const KO_VERSATZ = { cl: 0, el: 2, conf: 2 };

/**
 * Prämienschlüssel je K.-o.-Runde (EURO.competitions[*].prizeMoney).
 * Exportiert, weil auch der Europapokal-Bildschirm anzeigen muss, was bei
 * Weiterkommen winkt – zwei Kopien derselben Tabelle laufen sonst auseinander.
 */
export const RUNDEN_PRAEMIE = {
  po: 'playoff', af: 'achtelfinale', vf: 'viertelfinale', hf: 'halbfinale', fin: 'finale'
};

/** Stärkezuschlag für den Gastgeber eines Fernergebnisses (Rufpunkte). */
const HEIMVORTEIL = 6;

/**
 * DOPPELBELASTUNG (ROADMAP Stufe 3, Punkt 6).
 *
 * Ein Europapokalabend ist teurer als ein Ligaspiel, und die Auswärtsfahrt ist
 * das Teuerste daran: Hinflug am Dienstag, Rückflug um vier Uhr morgens, Samstag
 * wieder ran. Abgebildet wird das dreifach, alles über die vorhandenen Regler
 * aus club/medical.js — es gibt kein zweites Verletzungsmodell:
 *   · REISE_*        Fitnesspunkte, die der ganze Kader nach der Partie liegen lässt
 *   · INTENSITAET_*  Multiplikator auf den Fitnessverlust der Einsätze
 *   · HAERTE_ZUSCHLAG  ein bisschen mehr Feuer als sonntags gegen Heidenheim
 *
 * Der Weg zur Verletzung führt über die Fitness: club/medical.js rechnet mit
 * `1 + (100 − Fitness)/100 · 1,7` und schickt jeden, der drei Tage unter 28
 * liegt, mit Erschöpfung ins Lazarett. Wer donnerstags spielt, ist sonntags
 * müder — und irgendwann reißt etwas.
 *
 * GEMESSEN (tools/test-europa.js, Seeds 7 und 2024, je 3 Saisons): Zwölf bis
 * dreizehn Mehrspiele bringen rund eine zusätzliche Verletzung je Verein und
 * Saison. Zusicherung Z11 („mehr Spiele UND mehr Ausfälle") besteht damit in
 * vier von sechs Spielzeiten — die beiden anderen liegen bei −0,4 und −1,7
 * Verletzungen.
 *
 * WARUM NICHT MEHR: Z11 stellt die Europapokalteilnehmer gegen den Rest der
 * 1. Liga, und diese Gruppen unterscheiden sich strukturell. Gemessen über eine
 * Saison: medizinische Abteilung im Schnitt 74 gegen 65 Punkte, dazu ältere und
 * billigere Kader ohne Europapokal. Das ist über ein Jahr mehr wert als zwölf
 * Spiele. Gegenprobe mit dreifach härteren Werten (Reise 12/5, Intensität 1,5,
 * Härte +20): keine Verbesserung, nur mehr Streuung — der Rest ist Rauschen und
 * Gruppenunterschied, nicht Belastung. Die Zahlen oben sind deshalb bewusst die
 * vertretbare Fassung: spürbar, aber ohne die Balance von club/medical.js zu
 * verbiegen. Der eigentliche Ausbau steht als ROADMAP Stufe 3, Punkt 6 an.
 */
const REISE_AUSWAERTS = 8;
const REISE_HEIM = 3;
const INTENSITAET_AUSWAERTS = 1.4;
const INTENSITAET_HEIM = 1.25;
const HAERTE_ZUSCHLAG = 12;

/**
 * Tage, an denen deutsche Vereine ohnehin gebunden sind: alle Ligaspieltage und
 * alle Pokalrunden — auch die, die erst im Laufe der Saison gelost werden und
 * deshalb noch in keinem Spielplan stehen.
 */
const GESPERRTE_TAGE = (() => {
  const s = new Set();
  for (const id of LEAGUE_IDS) for (const t of (LEAGUES[id].spieltage || [])) s.add(t);
  for (const r of CUP.rounds) for (const t of (r.days || [])) s.add(t);
  return s;
})();

const LEER = new Set();

/* ==========================================================================
 * 2. Kleine Helfer
 * ======================================================================== */

const clubOf = (state, id) => (state && state.clubs) ? state.clubs[id] : null;

function kurz(state, clubId) {
  const c = clubOf(state, clubId);
  return c ? (c.shortName || c.name || clubId) : String(clubId || '–');
}

const liste = (state, ids) => (ids && ids.length) ? ids.map(id => kurz(state, id)).join(', ') : '–';

/** Land eines Vereins. Die Bundesliga steht in data/clubs.js ohne Länderkennung. */
const landVon = (state, clubId) => {
  const c = clubOf(state, clubId);
  return (c && c.country) || 'DE';
};

const istEuroVerein = (state, clubId) => {
  const c = clubOf(state, clubId);
  return !!(c && c.istEuropaeisch);
};

/** Ergebnis einer Partie, tolerant gelesen (wie data/leagues.js:toreAus). */
function toreAus(f) {
  const res = f && f.result;
  if (!res) return null;
  if (Array.isArray(res) && res.length >= 2) return [res[0], res[1]];
  if (Array.isArray(res.score) && res.score.length >= 2) return [res.score[0], res.score[1]];
  if (typeof res.home === 'number' && typeof res.away === 'number') return [res.home, res.away];
  return null;
}

/** Alle Partien eines Wettbewerbs in der laufenden Saison. */
function wbFixtures(state, wb, saison) {
  const s = saison === undefined ? state.date.season : saison;
  return state.fixtures.filter(f => f && f.competitionId === wb && f.season === s);
}

const ligaphaseFixtures = (state, wb, saison) => wbFixtures(state, wb, saison).filter(f => !f.round);
const koFixtures = (state, wb, rundeId, saison) => wbFixtures(state, wb, saison).filter(f => f.round === rundeId);

/**
 * Spielstärke für Fernergebnisse. Grundlage ist der Ruf — er liegt bei
 * deutschen (52–95) und europäischen Vereinen (57–98) auf derselben Skala und
 * ist das Einzige, was ein Fernschreiber über einen fremden Verein weiß. Wer
 * einen Kader hat, bekommt einen kleinen Zu- oder Abschlag darauf: Ein Verein,
 * der seine Elf verkauft hat, spielt auch in Europa schlechter, als sein Name
 * verspricht.
 */
function staerkeVon(state, clubId) {
  const club = clubOf(state, clubId);
  if (!club) return 55;
  const ruf = clamp(club.reputation === undefined ? 50 : club.reputation, 20, 100);
  const ids = club.playerIds || [];
  if (ids.length < 11) return ruf;
  const werte = ids.map(id => state.players[id])
    .filter(p => p && !p.injury)
    .map(playerOverall)
    .sort((a, b) => b - a)
    .slice(0, 11);
  if (werte.length < 11) return ruf;
  const kader = werte.reduce((s, v) => s + v, 0) / werte.length;
  return clamp(ruf + clamp((kader - 72) * 0.8, -8, 8), 20, 100);
}

/** Poisson-Ziehung (Knuth). Notbremse bei 12 Toren – mehr ist kein Fußball mehr. */
function poisson(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > L && k < 13);
  return k - 1;
}

/**
 * Ein Ergebnis vom Fernschreiber. Zielkorridor wie die Engine: rund 2,8 Tore
 * je Partie, Heimvorteil eingerechnet.
 */
function fernergebnis(rng, sHeim, sGast) {
  const d = clamp((sHeim + HEIMVORTEIL) - sGast, -45, 45);
  return [
    poisson(rng, clamp(1.50 + d * 0.030, 0.30, 4.0)),
    poisson(rng, clamp(1.28 - d * 0.026, 0.25, 3.6))
  ];
}

/**
 * Ergebnis eintragen.
 *
 * Spiegelt den Teil von core/loop.js:applyResult, den ein Fernergebnis braucht:
 * Partie abhaken, Vereinsform fortschreiben. Spielerstatistik gibt es keine
 * (niemand hat gespielt, den wir kennen), Belastung und Verletzungswürfe holt
 * club/medical.js am Folgetag selbst nach. Bewusst ohne Import von
 * core/loop.js — club/* bleibt eigenständig (vgl. club/finances.js:157).
 */
function ergebnisEintragen(state, fx, score) {
  fx.played = true;
  fx.result = { score: [score[0], score[1]], stats: null };

  const [h, a] = score;
  const home = clubOf(state, fx.homeId);
  const away = clubOf(state, fx.awayId);
  for (const [club, tore, gegentore, gegner] of [[home, h, a, away], [away, a, h, home]]) {
    if (!club || !club.season) continue;
    const s = club.season;
    s.tore += tore;
    s.gegentore += gegentore;
    const zeichen = tore > gegentore ? 'S' : tore === gegentore ? 'U' : 'N';
    s.form.push(zeichen);
    if (s.form.length > 8) s.form.shift();
    s.letzteErgebnisse.unshift({
      gegner: gegner ? (gegner.shortName || gegner.id) : '–',
      tore, gegentore, heim: club === home, day: fx.dayIndex
    });
    if (s.letzteErgebnisse.length > 12) s.letzteErgebnisse.pop();
    s.serie = zeichen === 'S' ? Math.max(0, s.serie) + 1
      : zeichen === 'N' ? Math.min(0, s.serie) - 1 : 0;
  }
}

/* --------------------------------------------------------------------------
 *  Doppelbelastung
 * ------------------------------------------------------------------------ */

/**
 * Die Elf, die an einem Europapokalabend aufläuft.
 *
 * Erste Wahl ist die aufgestellte Elf des Vereins – und genau das ist der Punkt:
 * In Europa spielen die Stammkräfte, nicht die Frischesten. club/medical.js
 * würde im Notfall (verpassteSpieleNachholen) die elf fittesten schicken und die
 * Last damit sauber verteilen; so entsteht keine Doppelbelastung, sondern eine
 * ausgeruhte Rotation.
 */
function europaElf(state, club) {
  const verfuegbar = (club.playerIds || [])
    .map(id => state.players[id])
    .filter(p => p && !p.injury && !(p.cards && p.cards.ban > 0));
  if (verfuegbar.length < 11) return null;

  const gesetzt = (club.tactics && club.tactics.lineup)
    ? Object.values(club.tactics.lineup).filter(Boolean) : [];
  const elf = [];
  for (const id of gesetzt) {
    const p = verfuegbar.find(x => x.id === id);
    if (p && !elf.includes(p) && elf.length < 11) elf.push(p);
  }
  const rest = verfuegbar.filter(p => !elf.includes(p))
    .sort((a, b) => playerOverall(b) - playerOverall(a) || (a.id < b.id ? -1 : 1));
  while (elf.length < 11 && rest.length) elf.push(rest.shift());

  const einsaetze = elf.map(p => ({ playerId: p.id, minuten: 90 }));
  // Drei Wechsel: Wer aufholen muss, bringt frische Beine – die Stammkräfte
  // gehen dafür ein paar Minuten früher runter.
  for (let i = 0; i < 3 && rest.length; i++) {
    einsaetze[i].minuten = 72;
    einsaetze.push({ playerId: rest.shift().id, minuten: 18 });
  }
  return einsaetze;
}

/**
 * Was ein Europapokalabend kostet. Wird für jede gespielte Partie genau einmal
 * gebucht (`fixture.belastet`), für beide deutschen Beteiligten getrennt.
 *
 * Bei einem Fernergebnis übernimmt diese Funktion zugleich die Spielnachbereitung
 * (Belastung, Verletzungswürfe, Sperren). Bei einer echten Partie hat
 * core/loop.js:applyResult das längst erledigt — dann bleibt nur die Reise.
 */
function belastungBuchen(state, ctx, fx) {
  if (fx.belastet) return;
  fx.belastet = true;

  for (const clubId of [fx.homeId, fx.awayId]) {
    const club = clubOf(state, clubId);
    if (!club || club.istEuropaeisch || !(club.playerIds || []).length) continue;
    const auswaerts = clubId === fx.awayId && !fx.neutral;

    if (!fx.result || !fx.result.stats) {
      const einsaetze = europaElf(state, club);
      if (einsaetze) {
        const haerte = clamp(((club.tactics && club.tactics.sliders && club.tactics.sliders.haerte) || 50)
          + HAERTE_ZUSCHLAG, 0, 100);
        spielNachbereitung(state, clubId, einsaetze, {
          rng: createRng(`${state.seed}:europa:belastung:${fx.id}:${clubId}`),
          competitionId: fx.competitionId,
          fixtureId: fx.id,
          haerte,
          intensitaet: auswaerts ? INTENSITAET_AUSWAERTS : INTENSITAET_HEIM,
          log: ctx && ctx.log, news: ctx && ctx.news, difficulty: ctx && ctx.difficulty
        });
      }
    }

    // Die Reise trifft alle, auch die, die nur auf der Bank saßen.
    const abzug = auswaerts ? REISE_AUSWAERTS : REISE_HEIM;
    for (const pid of club.playerIds) {
      const p = state.players[pid];
      if (!p || p.injury) continue;
      p.fitness = clamp((p.fitness === undefined ? 100 : p.fitness) - abzug, 5, 100);
    }
  }
}

/** Das Grundgerüst von state.europa – auch für Altspielstände. */
function europaState(state) {
  const eu = state.europa || (state.europa = {});
  if (!Array.isArray(eu.teilnehmer)) eu.teilnehmer = [];
  if (!Array.isArray(eu.paarungen)) eu.paarungen = [];
  if (typeof eu.runde !== 'number') eu.runde = 0;
  if (!eu.feld) eu.feld = null;
  if (!eu.ko) eu.ko = {};
  if (!eu.abschluss) eu.abschluss = {};
  if (!eu.abgerechnet) eu.abgerechnet = {};
  if (!eu.praemien) eu.praemien = {};
  if (!eu.sieger) eu.sieger = {};
  if (!Array.isArray(eu.ausgeschieden)) eu.ausgeschieden = [];
  return eu;
}

/** Steht für diese Saison ein Feld? */
function feldSteht(state) {
  const eu = state.europa;
  return !!(eu && eu.feld && eu.saison === state.date.season);
}

const log = (ctx, text, opts) => {
  if (ctx && typeof ctx.log === 'function') ctx.log(text, 'international', opts || {});
};
const news = (ctx, text, kind) => {
  if (ctx && typeof ctx.news === 'function') ctx.news(text, kind || 'info');
};

/* ==========================================================================
 * 3. QUALIFIKATION  (ROADMAP Stufe 3, Punkt 1)
 * ======================================================================== */

/**
 * Die Startplätze für die kommende Saison vergeben.
 *
 * Grundlage ist die Abschlusstabelle der 1. Bundesliga (LEAGUES.bl1.europeSpots:
 * vier Champions League, zwei Europa League, eine Conference League) plus der
 * Pokalsieger, der laut CUP.europaPlatz in die Europa League fährt.
 *
 * NACHRÜCKREGEL: Ist der Pokalsieger über die Liga bereits qualifiziert, verfällt
 * sein Startplatz nicht — er wandert an den bestplatzierten Verein, der noch
 * keinen hat (in aller Regel Platz 8). Kein Verein bekommt zwei Startplätze.
 *
 * ERSTE SAISON: Es gibt keine Vorsaison. Dann entscheidet der Ruf — Bayern fährt
 * in die Champions League, weil Bayern Bayern ist, und nicht, weil sie letztes
 * Jahr etwas gewonnen hätten.
 *
 * @param {object} state
 * @param {object} bericht  Saisonbericht aus loop.js:saisonWechsel (optional)
 * @returns {{ cl:string[], el:string[], conf:string[], nachgerueckt:string[],
 *             pokalsieger:string|null, grundlage:'tabelle'|'ruf' }}
 */
export function qualifikationErmitteln(state, bericht) {
  const spots = LEAGUES.bl1.europeSpots || { cl: 0, el: 0, conf: 0 };
  const tabelle = (bericht && bericht.tabellen && bericht.tabellen.bl1) || [];

  let reihe;
  let grundlage;
  if (tabelle.length) {
    reihe = tabelle.slice().sort((a, b) => (a.platz || 99) - (b.platz || 99)).map(z => z.clubId);
    grundlage = 'tabelle';
  } else {
    const bl1 = (state.leagues && state.leagues.bl1 && state.leagues.bl1.clubIds) || LEAGUES.bl1.clubIds;
    reihe = bl1.slice().sort((a, b) => {
      const ra = (clubOf(state, a) || {}).reputation || 0;
      const rb = (clubOf(state, b) || {}).reputation || 0;
      return (rb - ra) || (a < b ? -1 : 1);
    });
    grundlage = 'ruf';
  }

  const feld = { cl: [], el: [], conf: [], nachgerueckt: [], pokalsieger: null, grundlage };
  const vergeben = new Set();
  const platzVon = new Map(reihe.map((id, i) => [id, i + 1]));

  const zuteilen = (wb, clubId) => {
    if (!clubId || vergeben.has(clubId)) return false;
    vergeben.add(clubId);
    feld[wb].push(clubId);
    return true;
  };

  // Die Ligaplätze der Reihe nach: 1–4 Champions League, 5–6 Europa League, 7 Conference.
  let i = 0;
  for (const wb of WB_IDS) {
    for (let n = 0; n < (spots[wb] || 0); n++) {
      while (i < reihe.length && vergeben.has(reihe[i])) i++;
      if (i < reihe.length) zuteilen(wb, reihe[i++]);
    }
  }

  // Der Pokalsieger. Ein Amateur- oder Zweitligist im Endspiel fährt genauso mit —
  // so steht es im Regelwerk und so ist es 1997 auch gewesen.
  const pokalsieger = (bericht && bericht.pokalsieger) || null;
  const pokalWb = CUP.europaPlatz && feld[CUP.europaPlatz] ? CUP.europaPlatz : 'el';
  if (pokalsieger) {
    feld.pokalsieger = pokalsieger;
    if (!zuteilen(pokalWb, pokalsieger)) {
      // Schon über die Liga dabei: Der Platz verfällt nicht, er rückt nach.
      while (i < reihe.length && vergeben.has(reihe[i])) i++;
      if (i < reihe.length) {
        const nachruecker = reihe[i++];
        zuteilen(pokalWb, nachruecker);
        feld.nachgerueckt.push(nachruecker);
      }
    }
  }

  // Wer nicht mehr existiert (fehlender Verein im Spielstand), fliegt still raus –
  // besser sieben Starter als eine Auslosung mit einem Geist.
  for (const wb of WB_IDS) feld[wb] = feld[wb].filter(id => clubOf(state, id));

  return feld;
}

/* ==========================================================================
 * 4. AUSLOSUNG DER LIGAPHASE  (ROADMAP Stufe 3, Punkt 3)
 * ======================================================================== */

/**
 * Das Teilnehmerfeld je Wettbewerb füllen.
 *
 * Die Reihenfolge ist Absicht: Erst greift die Champions League zu, dann die
 * Europa League, den Rest sammelt die Conference ein. Gewichtet wird nach Ruf
 * über der Mindestreputation des Wettbewerbs (EURO.competitions[*].minReputation),
 * damit Real Madrid nicht in der Conference League landet, ohne dass die
 * Auslosung Jahr für Jahr dasselbe Feld ausspuckt.
 */
function feldAufteilen(rng, teilnehmer, state) {
  const feld = { cl: [], el: [], conf: [] };
  const vergeben = new Set();
  for (const wb of WB_IDS) {
    for (const id of (teilnehmer[wb] || [])) {
      if (!vergeben.has(id)) { vergeben.add(id); feld[wb].push(id); }
    }
  }

  for (const wb of WB_IDS) {
    const min = (EURO.competitions[wb] && EURO.competitions[wb].minReputation) || 0;
    while (feld[wb].length < FELD_GROESSE) {
      let kandidaten = EURO_CLUBS.filter(c => !vergeben.has(c.id) && c.pot.includes(wb) && clubOf(state, c.id));
      // Reicht der eigene Topf nicht mehr, wird aus allem gezogen, was übrig ist.
      // Das trifft in aller Regel die Conference League – und trifft dort die
      // Richtigen, weil oben schon die Besten weggeschnappt wurden.
      if (!kandidaten.length) {
        kandidaten = EURO_CLUBS.filter(c => !vergeben.has(c.id) && clubOf(state, c.id));
      }
      if (!kandidaten.length) break;
      const gezogen = rng.pickWeighted(kandidaten, c => Math.max(1, (c.reputation || 50) - min + 6));
      vergeben.add(gezogen.id);
      feld[wb].push(gezogen.id);
    }
  }
  return feld;
}

/**
 * Einen Termin finden, an dem keiner der beiden Vereine schon spielt.
 *
 * Geprüft wird gegen ALLES, was im Spielplan steht, und zusätzlich gegen die
 * Pokalrunden, die erst später gelost werden (GESPERRTE_TAGE). Notfalls wird auf
 * den Nachbartag ausgewichen; da die Termine in data/leagues.js sauber gesetzt
 * sind, passiert das heute nie — die Prüfung steht hier für den Tag, an dem
 * jemand einen Spieltag verschiebt.
 */
function freierTermin(belegt, wunsch, clubIds) {
  for (const versatz of [0, 1, -1, 2, -2, 3]) {
    const tag = wunsch + versatz;
    if (tag < 0 || tag >= SEASON_DAYS) continue;
    if (GESPERRTE_TAGE.has(tag)) continue;
    if (clubIds.some(id => (belegt.get(id) || LEER).has(tag))) continue;
    return tag;
  }
  return wunsch;
}

function belegen(belegt, clubIds, tag) {
  for (const id of clubIds) {
    let s = belegt.get(id);
    if (!s) { s = new Set(); belegt.set(id, s); }
    s.add(tag);
  }
}

/** Belegungsplan aller Vereine für eine Saison aus dem vorhandenen Spielplan. */
function belegungsplan(state, saison) {
  const belegt = new Map();
  for (const f of state.fixtures) {
    if (!f || f.season !== saison || typeof f.dayIndex !== 'number') continue;
    belegen(belegt, [f.homeId, f.awayId].filter(Boolean), f.dayIndex);
  }
  return belegt;
}

const ligaphaseId = (wb, saison, md, homeId, awayId) =>
  `${wb}_s${saison}_st${pad(md, 2)}_${homeId}_${awayId}`;

/**
 * Die Ligaphase auslosen und ansetzen.
 *
 * generateEuropeSchedule() liefert Spieltagsraster, Heimrecht und Termine für
 * die deutschen Starter — genau acht Spiele, vier daheim, vier auswärts, acht
 * verschiedene Gegner. Was von dort kommt und nicht ins Feld dieses Wettbewerbs
 * gehört, wird nachgelost (siehe Entscheidung 4 im Kopf). Anschließend werden
 * die übrigen Vereine des Feldes an jedem Spieltag untereinander verpaart, damit
 * am Ende jeder seine acht Partien hat und die Tabelle über 24 Vereine steht.
 */
function ligaphaseAnsetzen(state, rng, teilnehmer, feld, saison) {
  const plan = generateEuropeSchedule(rng.fork('ligaphase'), teilnehmer, saison);
  const belegt = belegungsplan(state, saison);
  const fixtures = [];
  const spieltage = EURO.leaguePhase.matchdays;

  for (const wb of WB_IDS) {
    const feldMenge = new Set(feld[wb]);
    const deutsche = (teilnehmer[wb] || []).slice().sort();
    const deutscheMenge = new Set(deutsche);
    const eigene = new Map(deutsche.map(id => [id, []]));
    for (const f of plan.fixtures) {
      if (f.competitionId !== wb) continue;
      const clubId = eigene.has(f.homeId) ? f.homeId : f.awayId;
      if (!eigene.has(clubId)) continue;
      eigene.get(clubId).push(f);
    }

    const heimspiele = new Map(feld[wb].map(id => [id, 0]));
    const begegnet = new Map(feld[wb].map(id => [id, new Set()]));
    // Wer spielt an welchem Spieltag schon? Ohne diese Sperre könnte ein Verein
    // an einem Spieltag zweimal gelost werden (an zwei verschiedenen Tagen, weil
    // die Champions League Di UND Mi spielt) und käme am Ende auf neun Partien.
    const proSpieltag = [];
    for (let i = 0; i <= spieltage; i++) proSpieltag.push(new Set());

    const eintragen = (md, homeId, awayId, wunschTag) => {
      const tag = freierTermin(belegt, wunschTag, [homeId, awayId]);
      belegen(belegt, [homeId, awayId], tag);
      proSpieltag[md].add(homeId);
      proSpieltag[md].add(awayId);
      if (begegnet.has(homeId)) begegnet.get(homeId).add(awayId);
      if (begegnet.has(awayId)) begegnet.get(awayId).add(homeId);
      heimspiele.set(homeId, (heimspiele.get(homeId) || 0) + 1);
      fixtures.push({
        id: ligaphaseId(wb, saison, md, homeId, awayId),
        competitionId: wb, season: saison, matchday: md, dayIndex: tag,
        homeId, awayId, played: false, result: null
      });
    };

    /* --- a) Die Partien der deutschen Starter, nötigenfalls nachgelost ---- */
    for (const clubId of deutsche) {
      const partien = eigene.get(clubId).slice().sort((a, b) => a.matchday - b.matchday);
      for (const f of partien) {
        const md = clamp(f.matchday, 1, spieltage);
        const daheim = f.homeId === clubId;
        const original = daheim ? f.awayId : f.homeId;

        // Drei Stufen, von streng nach nachsichtig. Aufgeben ist keine davon:
        // acht Spiele müssen es sein, sonst reißt die Zusicherung Z03.
        const grund = g => feldMenge.has(g) && g !== clubId && !deutscheMenge.has(g) &&
          !begegnet.get(clubId).has(g);
        const stufen = [
          g => grund(g) && !proSpieltag[md].has(g) && !(belegt.get(g) || LEER).has(f.dayIndex),
          g => grund(g) && !proSpieltag[md].has(g),
          g => grund(g)
        ];

        let gegner = null;
        for (const passt of stufen) {
          if (passt(original)) { gegner = original; break; }
          const kandidaten = feld[wb].filter(passt);
          if (kandidaten.length) {
            gegner = rng.pickWeighted(kandidaten,
              g => Math.max(1, (clubOf(state, g) || {}).reputation || 50));
            break;
          }
        }
        if (!gegner) continue;

        eintragen(md, daheim ? clubId : gegner, daheim ? gegner : clubId, f.dayIndex);
      }
    }

    /* --- b) Der Rest des Feldes: Spieltag für Spieltag verpaaren ---------- */
    const versaetze = (EURO.competitions[wb] && EURO.competitions[wb].dayOffsets) || [0];
    for (let md = 1; md <= spieltage; md++) {
      const wunschTage = versaetze.map(v => EURO.leaguePhase.days[md - 1] + v);
      const frei = rng.shuffle(feld[wb].filter(id => !proSpieltag[md].has(id)));
      let n = 0;
      while (frei.length >= 2) {
        const a = frei.shift();
        let k = frei.findIndex(b => !begegnet.get(a).has(b));
        if (k < 0) k = 0;
        const b = frei.splice(k, 1)[0];
        const [homeId, awayId] = (heimspiele.get(a) || 0) <= (heimspiele.get(b) || 0) ? [a, b] : [b, a];
        eintragen(md, homeId, awayId, wunschTage[n % wunschTage.length]);
        n++;
      }
    }
  }

  return fixtures;
}

/**
 * Der Europapokal einer Saison: Feld aufteilen, Ligaphase auslosen, ansetzen.
 *
 * @param {object} state
 * @param {object} ctx        aus loop.js:makeCtx – nur fürs Postfach, darf fehlen
 * @param {object} teilnehmer { cl:[ids], el:[ids], conf:[ids] } aus qualifikationErmitteln
 * @param {number} saison     Saison, für die gelost wird (Default: laufende)
 * @returns {object} state.europa
 */
export function europaAuslosen(state, ctx, teilnehmer, saison) {
  const jahr = saison === undefined ? state.date.season : saison;
  const eu = europaState(state);
  const t = {
    cl: (teilnehmer && teilnehmer.cl) || [],
    el: (teilnehmer && teilnehmer.el) || [],
    conf: (teilnehmer && teilnehmer.conf) || []
  };

  // Die Auslosung hängt am Spielstand-Seed und an der Saison, nie am Tag: Ein
  // Spielstand, der am 3. Juli geladen wird, muss dieselben Gegner bekommen wie
  // einer, der am 1. Juli weiterläuft.
  const rng = createRng(`${state.seed}:europa:${jahr}`);

  const feld = feldAufteilen(rng.fork('feld'), t, state);
  const fixtures = ligaphaseAnsetzen(state, rng, t, feld, jahr);
  state.fixtures.push(...fixtures);

  eu.saison = jahr;
  eu.feld = feld;
  eu.teilnehmer = WB_IDS.reduce((acc, wb) =>
    acc.concat(t[wb].map(clubId => ({ clubId, competition: wb }))), []);
  eu.ko = {};
  for (const wb of WB_IDS) eu.ko[wb] = { runde: -1, gesetzt: [], fertig: false };
  eu.abschluss = {};
  eu.abgerechnet = { cl: 0, el: 0, conf: 0 };
  eu.praemien = {};
  eu.sieger = { cl: null, el: null, conf: null };
  eu.runde = 0;
  eu.paarungen = [];
  // Gemeldet wird nicht hier, sondern beim ersten Tick der neuen Saison: Beim
  // Saisonwechsel steht der Kalender noch auf dem 30. Juni, und eine Nachricht
  // mit falschem Datum liest sich wie ein Fehler, weil sie einer ist.
  eu.gemeldet = false;

  return eu;
}

/**
 * Der Europapokal der ERSTEN Saison.
 *
 * Wird aus core/state.js:createNewGame gerufen. Ohne Vorsaison gibt es keine
 * Abschlusstabelle — qualifikationErmitteln() fällt dann auf den Ruf zurück.
 * Ohne diesen Aufruf liefe im ersten Jahr kein Europapokal, und der Spieler
 * müsste eine ganze Saison warten, bis das halbe Spiel anfängt.
 */
export function europaStart(state) {
  const quali = qualifikationErmitteln(state, null);
  return europaAuslosen(state, null, quali, state.date.season);
}

/* ==========================================================================
 * 5. PRÄMIEN  (ROADMAP Stufe 3, Punkt 5)
 * ======================================================================== */

/**
 * Der Marktanteil: was jeder Teilnehmer zusätzlich zur Platzprämie bekommt.
 *
 * Die UEFA schüttet neben der Rangprämie einen Marktpool aus, den alle teilen.
 * Statt dafür eine neue Zahl zu erfinden, wird der Durchschnitt der Rangprämie
 * des Feldes genommen (platzPraemie × Feld ÷ 2) — der Sockel, den ein
 * Mittelfeldplatz einbringt, steht damit jedem zu.
 *
 * WARUM ÜBERHAUPT: Ohne ihn läge ein sieglos abgeschlagener Champions-League-
 * Starter bei 18,6 Mio Startgeld plus 0,3 Mio Platzprämie und damit unter dem
 * 20-Mio-Korridor aus tools/test-europa.js. Mit ihm ist die Untergrenze
 * 22,2 Mio — und der Bestfall (Titel ohne Play-off) 108,8 Mio, gut im Korridor.
 */
function marktanteil(prize, feldGroesse) {
  return Math.round((prize.platzPraemie || 0) * feldGroesse / 2);
}

/**
 * Eine Europapokal-Prämie verbuchen (club/finances.js, Kategorie 'praemien').
 *
 * @param {string} anlass  'start' | 'sieg' | 'remis' | 'platz' | 'runde' | 'titel'
 * @param {object} daten   { wettbewerb, platz, feld, runde, gegner }
 * @returns {{ ok:boolean, betrag:number, text:string }}
 */
export function europaPraemien(state, clubId, anlass, daten = {}) {
  const wb = daten.wettbewerb || daten.wb;
  const wettbewerb = EURO.competitions[wb];
  const club = clubOf(state, clubId);
  if (!wettbewerb || !club) return { ok: false, betrag: 0, text: 'Unbekannter Wettbewerb oder Verein.' };
  // Europäische Vereine führen wir nicht wirtschaftlich – was Real Madrid
  // verdient, geht die Buchhaltung dieses Spiels nichts an.
  if (club.istEuropaeisch) return { ok: false, betrag: 0, text: 'Kein Konto für europäische Gegner.' };

  const p = wettbewerb.prizeMoney || {};
  const feld = daten.feld || FELD_GROESSE;
  let betrag = 0;
  let zusatz = '';

  switch (anlass) {
    case 'start':
      betrag = p.start || 0; zusatz = 'Startgeld'; break;
    case 'sieg':
      betrag = p.sieg || 0; zusatz = `Siegprämie (Spieltag ${daten.spieltag || '?'})`; break;
    case 'remis':
      betrag = p.remis || 0; zusatz = `Remisprämie (Spieltag ${daten.spieltag || '?'})`; break;
    case 'platz': {
      const platz = clamp(Math.round(daten.platz || feld), 1, feld);
      betrag = (p.platzPraemie || 0) * (feld + 1 - platz) + marktanteil(p, feld);
      zusatz = `Platzprämie (Platz ${platz} von ${feld}) und Marktanteil`;
      break;
    }
    case 'runde': {
      const schluessel = RUNDEN_PRAEMIE[daten.runde];
      betrag = (schluessel && p[schluessel]) || 0;
      const rd = EURO.knockout.find(r => r.id === daten.runde);
      zusatz = `Rundenprämie ${rd ? rd.name : daten.runde}`;
      break;
    }
    case 'titel':
      betrag = p.titel || 0; zusatz = 'Siegprämie für den Titel'; break;
    default:
      return { ok: false, betrag: 0, text: `Unbekannter Anlass "${anlass}".` };
  }

  betrag = Math.round(betrag);
  if (betrag <= 0) return { ok: false, betrag: 0, text: 'Kein Betrag.' };

  // Der Buchungstext trägt immer den Wettbewerbsnamen ("UEFA Champions League"),
  // damit sich Europapokalgeld im Kassenbuch von TV-Geld unterscheiden lässt.
  buchen(state, clubId, betrag, 'praemien', `${wettbewerb.name} – ${zusatz}`);

  const eu = europaState(state);
  eu.praemien[clubId] = (eu.praemien[clubId] || 0) + betrag;
  return { ok: true, betrag, text: `${wettbewerb.short}: ${zusatz}` };
}

/* ==========================================================================
 * 6. LIGAPHASE AUSWERTEN
 * ======================================================================== */

/** Tabelle eines Wettbewerbs aus den bisher gespielten Partien. */
function tabelleVon(state, wb, saison) {
  const eu = state.europa;
  const feld = (eu && eu.feld && eu.feld[wb]) || [];
  if (!feld.length) return [];
  return computeTable(ligaphaseFixtures(state, wb, saison), feld, { competitionId: wb });
}

const ligaphaseFertig = (state, wb) =>
  ligaphaseFixtures(state, wb).every(f => f.played);

/**
 * Die Ligaphase abrechnen: Startgeld, Sieg- und Remisprämien, Platzprämie und
 * Marktanteil in einem Zug.
 *
 * WARUM ERST HIER UND NICHT IM JULI: Die UEFA zahlt in Abschlägen und rechnet
 * nach der Ligaphase ab – und der Spielstand dankt es. club/finances.js hebt je
 * Verein nur die letzten 800 (eigener Verein) bzw. 60 (KI) Kassenbuchzeilen auf.
 * Ein Startgeld, das am 1. Juli gebucht wird, ist im Mai längst aus dem Buch
 * gefallen; in der Jahresabrechnung fehlten dann 18,6 Mio, die tatsächlich
 * geflossen sind (tools/test-europa.js Z08 liest genau dieses Kassenbuch).
 */
function ligaphaseAbrechnen(state, wb, tabelle) {
  const eu = state.europa;
  if ((eu.abgerechnet[wb] || 0) >= EURO.leaguePhase.matchdays) return;
  eu.abgerechnet[wb] = EURO.leaguePhase.matchdays;

  const feld = tabelle.length || FELD_GROESSE;
  const partien = ligaphaseFixtures(state, wb);
  for (const t of eu.teilnehmer) {
    if (t.competition !== wb) continue;
    europaPraemien(state, t.clubId, 'start', { wettbewerb: wb });
    for (const f of partien) {
      if (f.homeId !== t.clubId && f.awayId !== t.clubId) continue;
      const tore = toreAus(f);
      if (!f.played || !tore) continue;
      const eigene = f.homeId === t.clubId ? tore[0] : tore[1];
      const fremde = f.homeId === t.clubId ? tore[1] : tore[0];
      if (eigene > fremde) europaPraemien(state, t.clubId, 'sieg', { wettbewerb: wb, spieltag: f.matchday });
      else if (eigene === fremde) europaPraemien(state, t.clubId, 'remis', { wettbewerb: wb, spieltag: f.matchday });
    }
    const zeile = tabelle.find(z => z.clubId === t.clubId);
    europaPraemien(state, t.clubId, 'platz', { wettbewerb: wb, platz: zeile ? zeile.platz : feld, feld });
  }
}

/**
 * Die Ligaphase abschließen: Tabelle festschreiben, abrechnen, die
 * Play-off-Runde auslosen. Die besten acht warten im Achtelfinale.
 */
function ligaphaseAbschliessen(state, ctx, wb) {
  const eu = state.europa;
  const tabelle = tabelleVon(state, wb);
  eu.abschluss[wb] = tabelle.map(z => ({
    clubId: z.clubId, platz: z.platz, punkte: z.punkte, spiele: z.spiele,
    tore: z.tore, gegentore: z.gegentore, diff: z.diff
  }));

  ligaphaseAbrechnen(state, wb, tabelle);

  const reihe = tabelle.map(z => z.clubId);
  eu.ko[wb].gesetzt = reihe.slice(0, GESETZT_AF);
  const playoff = reihe.slice(GESETZT_AF, Math.min(reihe.length, FELD_GROESSE));
  eu.ko[wb].runde = 0;

  if (playoff.length >= 2) {
    koAnsetzen(state, ctx, wb, 'po', playoff.slice(0, Math.floor(playoff.length / 2)),
      playoff.slice(Math.floor(playoff.length / 2)));
  } else {
    // Kein Play-off nötig (kann nur bei einem winzigen Feld passieren):
    // dann geht es direkt ins Achtelfinale.
    eu.ko[wb].runde = 1;
    koAnsetzen(state, ctx, wb, 'af',
      eu.ko[wb].gesetzt.slice(0, Math.floor(eu.ko[wb].gesetzt.length / 2)),
      eu.ko[wb].gesetzt.slice(Math.floor(eu.ko[wb].gesetzt.length / 2)));
    eu.ko[wb].gesetzt = [];
  }
  meldeRunde(state, ctx, wb, eu.ko[wb].runde === 0 ? 'po' : 'af', tabelle);
}

/* ==========================================================================
 * 7. K.-O.-RUNDEN  (ROADMAP Stufe 3, Punkt 4)
 * ======================================================================== */

/**
 * Eine K.-o.-Runde auslosen und ansetzen.
 *
 * Zwei Töpfe: gesetzte Vereine (die besser platzierten) gegen ungesetzte. Der
 * gesetzte Verein hat im Rückspiel Heimrecht — der Vorteil, den man sich in der
 * Ligaphase erspielt hat.
 *
 * LANDESSCHUTZ in den ersten beiden Runden: Zwei Vereine aus demselben Land
 * werden nicht gegeneinander gelost, solange sich ein anderer Gegner findet. Ab
 * dem Viertelfinale fällt der Schutz — genau wie bei der UEFA, und aus demselben
 * Grund: Bei acht Vereinen wird jede Zusatzregel zur Zwangsauslosung.
 */
function koAnsetzen(state, ctx, wb, rundeId, gesetzt, ungesetzt) {
  const eu = state.europa;
  const runde = EURO.knockout.find(r => r.id === rundeId);
  if (!runde) return [];
  const saison = state.date.season;
  const rng = createRng(`${state.seed}:europa:${saison}:${wb}:${rundeId}`);
  const belegt = belegungsplan(state, saison);
  const schutz = rundeId === 'po' || rundeId === 'af';

  const frei = rng.shuffle(ungesetzt.slice());
  const paare = [];
  for (const a of rng.shuffle(gesetzt.slice())) {
    if (!frei.length) break;
    let k = schutz ? frei.findIndex(b => landVon(state, b) !== landVon(state, a)) : -1;
    if (k < 0) k = 0;
    paare.push([a, frei.splice(k, 1)[0]]);
  }
  // Ungerade Töpfe (nur bei kaputten Feldern denkbar): Der Rest wird untereinander verlost.
  while (frei.length >= 2) paare.push([frei.shift(), frei.shift()]);

  const versatz = KO_VERSATZ[wb] || 0;
  const fixtures = [];
  paare.forEach(([gesetzterId, gegnerId], i) => {
    const legs = runde.legs || 1;
    for (let leg = 1; leg <= legs; leg++) {
      // Hinspiel beim Ungesetzten, Rückspiel beim Gesetzten. Ein Endspiel hat
      // nur ein Spiel und findet auf neutralem Boden statt.
      const heimIstGesetzt = legs === 1 ? true : leg === legs;
      const homeId = heimIstGesetzt ? gesetzterId : gegnerId;
      const awayId = heimIstGesetzt ? gegnerId : gesetzterId;
      const basis = legs === 1
        ? (EURO.finalDays[wb] !== undefined ? EURO.finalDays[wb] : (runde.days[0] || 316))
        : runde.days[leg - 1] + versatz + (wb === 'cl' ? (i % 2) : 0);
      const tag = freierTermin(belegt, basis, [homeId, awayId]);
      belegen(belegt, [homeId, awayId], tag);
      fixtures.push({
        id: `${wb}_s${saison}_${rundeId}_l${leg}_${homeId}_${awayId}`,
        competitionId: wb, season: saison, round: rundeId, roundName: runde.name,
        matchday: EURO.leaguePhase.matchdays + EURO.knockout.findIndex(r => r.id === rundeId) + 1,
        leg, dayIndex: tag, homeId, awayId,
        neutral: legs === 1 && !!runde.neutral,
        played: false, result: null
      });
    }
  });

  state.fixtures.push(...fixtures);
  // state.europa.paarungen führt je Wettbewerb die aktuelle Runde – das Altfeld
  // aus core/state.js, das die Oberfläche ohne Umweg über europaStand() liest.
  eu.paarungen = (eu.paarungen || []).filter(p => p.wettbewerb !== wb)
    .concat(paare.map(([a, b]) => ({ wettbewerb: wb, runde: rundeId, a, b })));
  eu.runde = Math.max(eu.runde || 0, EURO.knockout.findIndex(r => r.id === rundeId));

  // Rundenprämie: Wer dabei ist, hat sie verdient – nicht erst, wer gewinnt.
  const dabei = new Set(paare.reduce((a, p) => a.concat(p), []));
  for (const t of eu.teilnehmer) {
    if (t.competition === wb && dabei.has(t.clubId)) {
      europaPraemien(state, t.clubId, 'runde', { wettbewerb: wb, runde: rundeId });
    }
  }
  return fixtures;
}

/** Die Duelle einer Runde: Paarungen mit ihren ein oder zwei Partien. */
function duelleDerRunde(state, wb, rundeId) {
  const gruppen = new Map();
  for (const f of koFixtures(state, wb, rundeId)) {
    const paar = [f.homeId, f.awayId].slice().sort();
    const key = paar.join('|');
    if (!gruppen.has(key)) gruppen.set(key, { a: paar[0], b: paar[1], legs: [] });
    gruppen.get(key).legs.push(f);
  }
  const out = Array.from(gruppen.values());
  for (const d of out) d.legs.sort((x, y) => (x.leg || 0) - (y.leg || 0) || (x.dayIndex - y.dayIndex));
  out.sort((x, y) => (x.legs[0].dayIndex - y.legs[0].dayIndex) || (x.a < y.a ? -1 : 1));
  return out;
}

/** Elfmeterschießen einer Partie – mit echten Schützen, wenn es welche gibt. */
function elfmeterAustragen(state, ctx, fx, rundenName) {
  const rng = createRng(`${state.seed}:europa:elfmeter:${fx.id}`);
  const heim = clubOf(state, fx.homeId);
  const gast = clubOf(state, fx.awayId);
  const kaderH = (heim && heim.playerIds || []).map(id => state.players[id]).filter(Boolean);
  const kaderG = (gast && gast.playerIds || []).map(id => state.players[id]).filter(Boolean);

  if (kaderH.length >= 11 && kaderG.length >= 11) {
    const erg = elfmeterschiessen({
      heim: { club: heim, players: kaderH, tactics: heim.tactics },
      gast: { club: gast, players: kaderG, tactics: gast.tactics },
      rng, difficulty: ctx && ctx.difficulty, interactive: false,
      competition: { id: fx.competitionId, name: rundenName }
    });
    return { tore: [erg.tore[0], erg.tore[1]], sieger: erg.sieger === 'home' ? fx.homeId : fx.awayId };
  }

  // Fernschießen: Wo kein Kader ist, gibt es auch keine Schützenliste. Getroffen
  // wird mit rund 76 %, wie im echten Leben, leicht verschoben nach Stärke.
  const d = clamp(staerkeVon(state, fx.homeId) - staerkeVon(state, fx.awayId), -40, 40);
  const pH = clamp(0.76 + d * 0.0016, 0.62, 0.88);
  const pG = clamp(0.76 - d * 0.0016, 0.62, 0.88);
  let h = 0, g = 0;
  for (let i = 0; i < 5; i++) { if (rng.chance(pH)) h++; if (rng.chance(pG)) g++; }
  for (let i = 0; i < 20 && h === g; i++) {
    if (rng.chance(pH)) h++;
    if (rng.chance(pG)) g++;
  }
  if (h === g) h++;                       // irgendwann muss auch mal Schluss sein
  return { tore: [h, g], sieger: h > g ? fx.homeId : fx.awayId };
}

/**
 * Ein K.-o.-Duell entscheiden.
 *
 * Zusammengezählt werden beide Spiele — OHNE Auswärtstorregel (Entscheidung 1
 * im Kopf). Steht es gleich, gibt es im Rückspiel Verlängerung; die Tore daraus
 * wandern in den Endstand, so wie es core/loop.js:pokalFinaleEntscheiden für das
 * Pokalendspiel schon macht. Bleibt es auch dann gleich, wird ausgeschossen.
 */
function duellEntscheiden(state, ctx, wb, runde, duell) {
  const tore = { [duell.a]: 0, [duell.b]: 0 };
  for (const f of duell.legs) {
    const t = toreAus(f);
    if (!t) continue;
    tore[f.homeId] = (tore[f.homeId] || 0) + t[0];
    tore[f.awayId] = (tore[f.awayId] || 0) + t[1];
  }
  const letzte = duell.legs[duell.legs.length - 1];
  let sieger = null;
  let grund = 'Gesamtscore';

  if (tore[duell.a] > tore[duell.b]) sieger = duell.a;
  else if (tore[duell.b] > tore[duell.a]) sieger = duell.b;

  if (!sieger) {
    const rng = createRng(`${state.seed}:europa:verlaengerung:${letzte.id}`);
    if (!letzte.result || !Array.isArray(letzte.result.score)) letzte.result = { score: [0, 0], stats: null };
    const [h, a] = toreAus(letzte) || [0, 0];
    const d = clamp((staerkeVon(state, letzte.homeId) + HEIMVORTEIL) - staerkeVon(state, letzte.awayId), -45, 45);
    // Dreißig Minuten sind ein Drittel eines Spiels – und in der Verlängerung
    // spielt niemand mehr auf Sieg, das drückt die Torerwartung zusätzlich.
    const vh = poisson(rng, clamp(0.40 + d * 0.010, 0.08, 1.2));
    const vg = poisson(rng, clamp(0.34 - d * 0.009, 0.06, 1.1));
    letzte.result.score = [h + vh, a + vg];
    letzte.verlaengerung = { regulaer: [h, a], tore: [vh, vg] };
    tore[letzte.homeId] += vh;
    tore[letzte.awayId] += vg;

    if (tore[duell.a] > tore[duell.b]) { sieger = duell.a; grund = 'Verlängerung'; }
    else if (tore[duell.b] > tore[duell.a]) { sieger = duell.b; grund = 'Verlängerung'; }
    else {
      const erg = elfmeterAustragen(state, ctx, letzte, runde.name);
      letzte.elfmeter = erg.tore;
      sieger = erg.sieger;
      grund = `Elfmeterschießen ${erg.tore[0]}:${erg.tore[1]}`;
    }
  }

  // Immer eintragen, nicht nur im Zweifel: Wer den Spielstand liest, soll den
  // Sieger sehen und ihn nicht aus zwei Ergebnissen zusammenrechnen müssen.
  letzte.sieger = sieger;
  const verlierer = sieger === duell.a ? duell.b : duell.a;
  return { sieger, verlierer, grund, aggregat: [tore[duell.a], tore[duell.b]] };
}

/** Eine Runde ist durch: alle Duelle entscheiden. */
function rundeAuswerten(state, ctx, wb, runde) {
  const duelle = duelleDerRunde(state, wb, runde.id);
  const sieger = [];
  const raus = [];
  for (const d of duelle) {
    const erg = duellEntscheiden(state, ctx, wb, runde, d);
    sieger.push(erg.sieger);
    raus.push(erg.verlierer);
    meldeDuell(state, ctx, wb, runde, d, erg);
  }
  return { sieger, raus, duelle };
}

/**
 * Nächste Runde auslosen, sobald die laufende komplett gespielt ist.
 * Das Gegenstück zu core/loop.js:pokalWeiterlosen — und wie dort gilt: mehrfaches
 * Aufrufen am selben Tag darf nichts kaputt machen.
 *
 * @returns {boolean} ob sich etwas bewegt hat
 */
export function europaWeiterlosen(state, ctx) {
  if (!state || !state.fixtures || !feldSteht(state)) return false;
  let bewegt = false;
  for (const wb of WB_IDS) {
    if (wettbewerbWeiter(state, ctx, wb)) bewegt = true;
  }
  return bewegt;
}

function wettbewerbWeiter(state, ctx, wb) {
  const eu = state.europa;
  const ko = eu.ko && eu.ko[wb];
  if (!ko || ko.fertig) return false;

  /* --- Ligaphase --- */
  if (ko.runde < 0) {
    if (!ligaphaseFixtures(state, wb).length || !ligaphaseFertig(state, wb)) return false;
    ligaphaseAbschliessen(state, ctx, wb);
    return true;
  }

  /* --- Laufende K.-o.-Runde --- */
  const runde = EURO.knockout[ko.runde];
  if (!runde) { ko.fertig = true; return false; }
  const partien = koFixtures(state, wb, runde.id);
  if (!partien.length || partien.some(f => !f.played)) return false;
  // Schon ausgewertet? Entschieden wird immer im letzten Spiel einer Paarung.
  const duelle = duelleDerRunde(state, wb, runde.id);
  if (duelle.every(d => d.legs[d.legs.length - 1].sieger)) return false;

  const { sieger } = rundeAuswerten(state, ctx, wb, runde);

  if (runde.id === 'fin') {
    eu.sieger[wb] = sieger[0] || null;
    ko.fertig = true;
    meldeSieger(state, ctx, wb, eu.sieger[wb]);
    return true;
  }

  ko.runde++;
  const naechste = EURO.knockout[ko.runde];
  // Ins Achtelfinale kommen die acht Gesetzten aus der Ligaphase dazu.
  let feld = sieger.slice();
  if (naechste.id === 'af' && ko.gesetzt.length) {
    feld = ko.gesetzt.concat(sieger);
    ko.gesetzt = [];
  }
  if (feld.length < 2) { ko.fertig = true; return true; }

  // Gesetzt ist, wer in der Abschlusstabelle weiter oben stand.
  const rang = new Map((eu.abschluss[wb] || []).map(z => [z.clubId, z.platz]));
  feld.sort((a, b) => (rang.get(a) || 99) - (rang.get(b) || 99) || (a < b ? -1 : 1));
  const haelfte = Math.floor(feld.length / 2);
  koAnsetzen(state, ctx, wb, naechste.id, feld.slice(0, haelfte), feld.slice(haelfte));
  return true;
}

/* ==========================================================================
 * 8. TAGESABLAUF
 * ======================================================================== */

/**
 * Der tägliche Europapokal.
 *
 * Reihenfolge mit Absicht:
 *   1. Fernergebnisse aller fälligen Partien OHNE eigene Beteiligung
 *   2. Doppelbelastung für jede gespielte Partie deutscher Vereine
 *   3. Runden weiterlosen (dort hängen auch die Prämien)
 *
 * Punkt 1 muss VOR core/loop.js:simulateAiFixtures laufen — sonst schickt der
 * Tagesablauf jede Europapokalpartie durch die Match-Engine, ensureSquad() legt
 * für 66 europäische Vereine Kader an, und der Spielstand sprengt sein Budget
 * (siehe Entscheidung 2 im Kopf). Die eigenen Partien bleiben unangetastet: die
 * spielt der Manager selbst — ihre Reisebelastung holt Punkt 2 am Folgetag nach.
 */
export function tickEuropa(state, ctx) {
  if (!state || !state.fixtures || !feldSteht(state)) return { fern: 0 };
  const eu = state.europa;

  if (!eu.gemeldet && ctx) meldeAuslosung(state, ctx, eu);

  let fern = 0;
  const heute = state.date.day;
  const eigener = state.managerClubId;
  for (const f of state.fixtures) {
    if (!f || f.season !== state.date.season || !EURO.competitions[f.competitionId]) continue;
    if (!f.played) {
      if (f.dayIndex > heute) continue;
      if (f.homeId === eigener || f.awayId === eigener) continue;   // die spielt der Manager
      const rng = createRng(`${state.seed}:europa:fern:${f.id}`);
      ergebnisEintragen(state, f, fernergebnis(rng, staerkeVon(state, f.homeId), staerkeVon(state, f.awayId)));
      fern++;
    }
    belastungBuchen(state, ctx, f);
  }

  europaWeiterlosen(state, ctx);
  return { fern };
}

/**
 * Der Europapokal am Saisonende: alles Liegengebliebene entscheiden, Titel
 * verbuchen und den Jahresertrag melden.
 *
 * Muss laufen, BEVOR core/loop.js die Spielpläne der alten Saison wegräumt —
 * danach gibt es keine Endspiele mehr, die man noch anpfeifen könnte.
 *
 * @returns {{ sieger:{cl,el,conf}, praemien:{clubId:betrag},
 *             teilnehmer:[{clubId,competition}], tabellen:object }}
 *   Alles bezieht sich auf die ABGELAUFENE Saison. Die Startplätze für die neue
 *   kommen aus qualifikationErmitteln(); core/loop.js legt beides im selben
 *   bericht.europa ab.
 */
export function europaSaisonende(state, ctx) {
  const eu = europaState(state);
  if (!feldSteht(state)) {
    return { sieger: {}, praemien: {}, teilnehmer: [], tabellen: {} };
  }

  // Notbremse: Wer den Spielstand vor dem Endspiel zuklappt, bekommt trotzdem
  // einen Sieger. Ein Wettbewerb ohne Sieger reißt ein Loch in die Chronik,
  // das nie wieder zugeht.
  for (let runden = 0; runden < 12; runden++) {
    let offen = 0;
    for (const f of state.fixtures) {
      if (!f || f.played || f.season !== state.date.season) continue;
      if (!EURO.competitions[f.competitionId]) continue;
      const rng = createRng(`${state.seed}:europa:fern:${f.id}`);
      ergebnisEintragen(state, f, fernergebnis(rng, staerkeVon(state, f.homeId), staerkeVon(state, f.awayId)));
      f.belastet = true;                 // am 30. Juni tut keine Reise mehr weh
      offen++;
    }
    const bewegt = europaWeiterlosen(state, ctx);
    if (!offen && !bewegt) break;
  }

  for (const wb of WB_IDS) {
    const sieger = eu.sieger[wb];
    if (sieger && !istEuroVerein(state, sieger)) {
      europaPraemien(state, sieger, 'titel', { wettbewerb: wb });
    }
  }

  const ergebnis = {
    sieger: Object.assign({}, eu.sieger),
    praemien: Object.assign({}, eu.praemien),
    teilnehmer: eu.teilnehmer.map(t => ({ clubId: t.clubId, competition: t.competition })),
    tabellen: Object.assign({}, eu.abschluss)
  };

  const eigen = eu.teilnehmer.find(t => t.clubId === state.managerClubId);
  if (eigen && ctx) {
    const summe = eu.praemien[state.managerClubId] || 0;
    log(ctx,
      `Der Europapokal ist abgerechnet. ${EURO.competitions[eigen.competition].name}: ` +
      `${(summe / 1e6).toFixed(1).replace('.', ',')} Mio € sind geflossen.\n\n` +
      `Die UEFA überweist pünktlich, das muss man ihr lassen. Ob das Geld reicht, ` +
      `um den Kader zusammenzuhalten, entscheidet allerdings jemand anderes.`,
      { subject: 'Abrechnung Europapokal', from: 'Schatzmeister' });
  }
  return ergebnis;
}

/* ==========================================================================
 * 9. POSTFACH
 * ======================================================================== */

function meldeAuslosung(state, ctx, eu) {
  eu.gemeldet = true;
  const eigen = eu.teilnehmer.find(t => t.clubId === state.managerClubId);
  const namen = eu.teilnehmer.map(t =>
    `${kurz(state, t.clubId)} (${EURO.competitions[t.competition].short})`).join(', ');
  news(ctx, `Auslosung in Monaco: ${namen || 'kein deutscher Verein dabei'}.`, 'info');
  if (!eigen) return;

  const wb = EURO.competitions[eigen.competition];
  const gegner = ligaphaseFixtures(state, eigen.competition, eu.saison)
    .filter(f => f.homeId === state.managerClubId || f.awayId === state.managerClubId)
    .sort((a, b) => a.matchday - b.matchday)
    .map(f => `${f.matchday}. Spieltag: ${f.homeId === state.managerClubId ? '' : 'bei '}` +
      `${kurz(state, f.homeId === state.managerClubId ? f.awayId : f.homeId)}`);

  log(ctx,
    `Wir sind dabei: ${wb.name}.\n\n` +
    `Die Ligaphase führt uns über acht Spieltage gegen acht verschiedene Gegner, ` +
    `vier davon zu Hause. Die besten acht überspringen die Play-off-Runde.\n\n` +
    gegner.join('\n') + '\n\n' +
    `Der Geschäftsführer hat beim Anblick des Zettels zweimal geschluckt und dann ` +
    `„sportlich reizvoll" gesagt. Das heißt auf Vereinsdeutsch: teuer und gefährlich.`,
    { subject: `Auslosung ${wb.short}: unsere acht Gegner`, from: 'Geschäftsstelle', wichtig: true });
}

function meldeRunde(state, ctx, wb, rundeId, tabelle) {
  const eu = state.europa;
  const eigen = eu.teilnehmer.find(t => t.clubId === state.managerClubId && t.competition === wb);
  if (!eigen || !ctx) return;
  const zeile = (tabelle || []).find(z => z.clubId === state.managerClubId);
  const wettbewerb = EURO.competitions[wb];
  const gesetzt = (eu.ko[wb].gesetzt || []).includes(state.managerClubId);
  if (!zeile) return;

  const text = gesetzt
    ? `Platz ${zeile.platz} in der Ligaphase — das reicht für die direkte Runde. ` +
      `Die Play-off-Runde dürfen andere spielen, wir schauen zu und heilen aus.`
    : zeile.platz <= FELD_GROESSE
      ? `Platz ${zeile.platz} in der Ligaphase. Es geht weiter, aber über den Umweg ` +
        `der Play-off-Runde. Zwei Spiele mehr, die niemand eingeplant hatte.`
      : `Platz ${zeile.platz} in der Ligaphase — das war es. Europa ohne uns, ` +
        `dafür ein aufgeräumter Terminkalender. Man muss das Positive sehen.`;

  log(ctx, `${wettbewerb.name}, Ligaphase abgeschlossen.\n\n${text}\n\n` +
    `${zeile.punkte} Punkte aus acht Spielen, ${zeile.tore}:${zeile.gegentore} Tore.`,
    { subject: `${wettbewerb.short}: Ligaphase beendet`, from: 'Geschäftsstelle', wichtig: true });
}

function meldeDuell(state, ctx, wb, runde, duell, erg) {
  if (!ctx) return;
  const eigen = state.managerClubId;
  if (duell.a !== eigen && duell.b !== eigen) return;
  const gegner = duell.a === eigen ? duell.b : duell.a;
  const weiter = erg.sieger === eigen;
  const wettbewerb = EURO.competitions[wb];
  const stand = duell.a === eigen
    ? `${erg.aggregat[0]}:${erg.aggregat[1]}`
    : `${erg.aggregat[1]}:${erg.aggregat[0]}`;

  if (weiter) {
    news(ctx, `${wettbewerb.short}: ${runde.name} überstanden, ${stand} gegen ${kurz(state, gegner)}.`, 'gut');
    log(ctx,
      `${runde.name} gewonnen: ${stand} gegen ${kurz(state, gegner)} (${erg.grund}).\n\n` +
      `Eine Runde weiter. Der Vorstand rechnet bereits die Prämie in Verstärkungen um, ` +
      `der Physiotherapeut in Überstunden.`,
      { subject: `${wettbewerb.short}: weiter nach dem ${runde.name}`, from: 'Geschäftsstelle', wichtig: true });
  } else {
    state.europa.ausgeschieden.push(state.date.season);
    news(ctx, `${wettbewerb.short}: Aus im ${runde.name}, ${stand} gegen ${kurz(state, gegner)}.`, 'schlecht');
    log(ctx,
      `Aus im ${runde.name}: ${stand} gegen ${kurz(state, gegner)} (${erg.grund}).\n\n` +
      `Europa ist vorbei. Was bleibt, sind die Reisekosten, ein paar müde Beine und ` +
      `die Erkenntnis, dass es in der Liga jetzt reichen muss.`,
      { subject: `${wettbewerb.short}: ausgeschieden`, from: 'Geschäftsstelle', wichtig: true });
  }
}

function meldeSieger(state, ctx, wb, siegerId) {
  if (!ctx || !siegerId) return;
  const wettbewerb = EURO.competitions[wb];
  const eigen = siegerId === state.managerClubId;
  news(ctx, `${wettbewerb.name}: ${kurz(state, siegerId)} gewinnt das Endspiel.`, eigen ? 'gut' : 'info');
  if (!eigen) return;
  log(ctx,
    `${wettbewerb.name} gewonnen.\n\n` +
    `Es gibt Abende, nach denen niemand mehr weiß, wie er nach Hause gekommen ist. ` +
    `Das war so einer. Der Pokal steht in der Kabine, jemand hat Bier hineingefüllt, ` +
    `und der Zeugwart weint.`,
    { subject: `${wettbewerb.short}: Wir haben ihn!`, from: 'Der Vorstand', wichtig: true });
}

/* ==========================================================================
 * 10. FÜR DIE OBERFLÄCHE
 * ======================================================================== */

/**
 * In welchem Wettbewerb spielt dieser Verein in der laufenden Saison?
 * @returns {'cl'|'el'|'conf'|null}
 */
export function europaTeilnehmer(state, clubId) {
  if (!feldSteht(state) || !clubId) return null;
  const eu = state.europa;
  const t = eu.teilnehmer.find(x => x.clubId === clubId);
  if (t) return t.competition;
  for (const wb of WB_IDS) if ((eu.feld[wb] || []).includes(clubId)) return wb;
  return null;
}

/**
 * Tabellen und K.-o.-Baum für den Europapokalbildschirm.
 *
 * @returns {{ saison, wettbewerbe: Array, eigener: object|null }}
 *   wettbewerbe: [{ id, name, short, feld, tabelle, abschluss, runde, rundeName,
 *                   baum: [{ id, name, paarungen: [{ a, b, spiele, aggregat, sieger }] }],
 *                   sieger, teilnehmer }]
 */
export function europaStand(state) {
  if (!feldSteht(state)) return { saison: state.date.season, wettbewerbe: [], eigener: null };
  const eu = state.europa;
  const eigener = state.managerClubId;
  const wettbewerbe = [];

  for (const wb of WB_IDS) {
    const def = EURO.competitions[wb];
    const ko = eu.ko[wb] || { runde: -1, fertig: false };
    const baum = [];
    for (const runde of EURO.knockout) {
      const duelle = duelleDerRunde(state, wb, runde.id);
      if (!duelle.length) continue;
      baum.push({
        id: runde.id,
        name: runde.name,
        paarungen: duelle.map(d => {
          const tore = { [d.a]: 0, [d.b]: 0 };
          for (const f of d.legs) {
            const t = toreAus(f);
            if (!t) continue;
            tore[f.homeId] += t[0];
            tore[f.awayId] += t[1];
          }
          const letzte = d.legs[d.legs.length - 1];
          return {
            a: d.a, b: d.b,
            aggregat: [tore[d.a], tore[d.b]],
            elfmeter: letzte.elfmeter || null,
            sieger: letzte.sieger || null,
            spiele: d.legs.map(f => ({
              id: f.id, dayIndex: f.dayIndex, homeId: f.homeId, awayId: f.awayId,
              leg: f.leg || 1, played: !!f.played, score: toreAus(f)
            }))
          };
        })
      });
    }

    const aktuell = ko.runde >= 0 ? EURO.knockout[Math.min(ko.runde, EURO.knockout.length - 1)] : null;
    wettbewerbe.push({
      id: wb,
      name: def.name,
      short: def.short,
      feld: (eu.feld[wb] || []).slice(),
      tabelle: tabelleVon(state, wb),
      abschluss: (eu.abschluss[wb] || []).slice(),
      runde: ko.runde,
      rundeName: ko.fertig ? 'beendet' : (aktuell ? aktuell.name : 'Ligaphase'),
      baum,
      sieger: eu.sieger[wb] || null,
      teilnehmer: eu.teilnehmer.filter(t => t.competition === wb).map(t => t.clubId)
    });
  }

  const meiner = europaTeilnehmer(state, eigener);
  const eigenerStand = meiner ? {
    wettbewerb: meiner,
    name: EURO.competitions[meiner].name,
    tabelle: (wettbewerbe.find(w => w.id === meiner) || {}).tabelle || [],
    platz: (tabelleVon(state, meiner).find(z => z.clubId === eigener) || {}).platz || null,
    praemien: eu.praemien[eigener] || 0,
    naechste: state.fixtures
      .filter(f => f && f.season === state.date.season && f.competitionId === meiner && !f.played &&
        (f.homeId === eigener || f.awayId === eigener))
      .sort((a, b) => a.dayIndex - b.dayIndex)[0] || null
  } : null;

  return { saison: eu.saison, wettbewerbe, eigener: eigenerStand };
}

/** Namensliste der deutschen Starter – für kurze Meldungen. */
export function europaStarterText(state) {
  if (!feldSteht(state)) return '–';
  return liste(state, state.europa.teilnehmer.map(t => t.clubId));
}

export default {
  qualifikationErmitteln, europaAuslosen, europaStart, europaWeiterlosen,
  europaPraemien, tickEuropa, europaSaisonende, europaStand, europaTeilnehmer
};
