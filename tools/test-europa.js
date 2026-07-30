/**
 * tools/test-europa.js – Der Prüfstand für den Europapokal (Roadmap-Stufe 3).
 *
 *   node tools/test-europa.js                  # Standard: Seeds 7 und 2024, je 3 Saisons
 *   node tools/test-europa.js 11 42 1899       # eigene Seeds
 *   node tools/test-europa.js --schnell        # nur der erste Seed, nur 1 Saison
 *   node tools/test-europa.js --saisons=5      # längerer Lauf
 *   node tools/test-europa.js --ohne-determinismus   # spart einen zweiten Durchlauf
 *
 * AUSGANGSLAGE (Stand: vor Stufe 3). `data/leagues.js` hat EURO, EURO_CLUBS und
 * generateEuropeSchedule() – aufgerufen wird nichts davon. `state.europa` bleibt
 * `{ teilnehmer: [], runde: 0, paarungen: [] }`, es gibt null Europapokal-Partien.
 * Dieses Skript wird BEWUSST vorher geschrieben: Es stürzt nicht ab, wenn die
 * Bausteine fehlen, sondern meldet für jede Zusicherung den Ist-Wert. Die
 * Fehlerliste am Ende ist die Arbeitsliste.
 *
 * ── DER VERTRAG, GEGEN DEN HIER GEPRÜFT WIRD ─────────────────────────────────
 *
 * 1. Startfeld. Nach `createNewGame()` steht das Feld der ersten Saison bereits:
 *    `state.europa.teilnehmer` ist gefüllt und für Saison 1 liegen Ligaphasen-
 *    Partien in `state.fixtures`. Ohne das gäbe es im ersten Jahr keinen
 *    Europapokal – und Z07 kann für Saison 1 nie bestehen.
 *
 * 2. Teilnehmerfeld. `state.europa.teilnehmer` wird gelesen als
 *    `{ cl:[clubId], el:[clubId], conf:[clubId] }` ODER als flache Liste
 *    `[{ clubId, competition }]` – beides wird akzeptiert (siehe
 *    `normalisiereTeilnehmer` in data/leagues.js, das genau diese zwei Formen kennt).
 *
 * 3. Europäische Vereine stehen in `state.clubs` mit `lazySquad: true` und ohne
 *    einen einzigen Spielerdatensatz. Der Kader entsteht erst beim ersten Spiel
 *    gegen sie (`state.js:ensureSquad`, wie bei den Amateuren). 66 volle Kader
 *    kosten rund 1,2 MB Spielstand, die niemand braucht.
 *
 * 4. Partien. `fixture.competitionId` ist 'cl' | 'el' | 'conf' (so erzeugt es
 *    generateEuropeSchedule heute). Ein Sammel-Wettbewerb 'europa' mit
 *    `fixture.wettbewerb` wird ebenfalls gelesen.
 *      · Ligaphase: `matchday` 1..8, kein `round` (oder `round === 'lp'`).
 *      · K.-o.-Runde: `round` aus EURO.knockout ('po','af','vf','hf','fin'),
 *        `leg` 1 oder 2 bei Hin- und Rückspiel.
 *
 * 5. Entschiedene K.-o.-Duelle. Ein Duell gilt als entschieden, wenn eines
 *    davon zutrifft: Gesamtscore ungleich · `fixture.sieger` gesetzt ·
 *    `fixture.elfmeter` / `fixture.penalties` ([heim, gast]) · `fixture.verlaengerung`
 *    hat den Endstand bereits verschoben (so macht es loop.js:pokalFinaleEntscheiden).
 *    Ob es eine Auswärtstorregel gibt, prüft dieses Skript NICHT – nur, dass am
 *    Ende genau einer weiterkommt.
 *
 * 6. Prämien. Verbucht über `finances.js:praemieErhalten` (Kategorie 'praemien').
 *    Als Quelle für Z08 wird zuerst `bericht.europa.praemien = { clubId: betrag }`
 *    aus dem Rückgabewert von `saisonWechsel()` gelesen. Fehlt das Feld, rechnet
 *    der Prüfstand die Summe selbst aus `EURO.competitions[*].prizeMoney` und den
 *    tatsächlichen Ergebnissen nach – dann OHNE Platzprämie, was in der Meldung
 *    steht. (Ohne Platzprämie liegt ein sieglos ausgeschiedener CL-Teilnehmer bei
 *    genau 18,6 Mio Startgeld und damit unter dem 20-Mio-Korridor. Das ist kein
 *    Messfehler, sondern die Stelle, an der die Platzprämie gebraucht wird.)
 *
 * 7. Weiterlosen. Exportiert `core/loop.js` eine Funktion `europaWeiterlosen(state, ctx)`
 *    (oder `europaAuslosen` / `europapokalWeiterlosen`), ruft dieses Skript sie nach
 *    jedem Tag auf – analog zu `pokalWeiterlosen`. Erledigt `advanceDay()` das
 *    intern, ist das genauso recht: dann findet der Prüfstand einfach keine
 *    Funktion und misst am Ergebnis, ob die K.-o.-Runden zustande kamen.
 *
 * Gespielt wird ohne DOM: `advanceDay()` treibt die Welt, eigene Partien laufen
 * über `simulateAiFixture()` + `applyResult()`.
 *
 * Rückgabe: Exit-Code 1, sobald eine Zusicherung fehlschlägt, mangels vorhandener
 * Funktion nicht prüfbar ist oder ein Baustein fehlt.
 */

import { createNewGame, serialize } from '../src/core/state.js';
import * as loop from '../src/core/loop.js';
import { advanceDay, makeCtx, simulateAiFixture, applyResult, pokalWeiterlosen } from '../src/core/loop.js';
import { LEAGUES, LEAGUE_IDS, CUP, EURO, EURO_CLUBS } from '../src/data/leagues.js';
import { round } from '../src/core/util.js';

/* ------------------------------------------------------------------ *
 *  Argumente
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const SCHNELL = args.includes('--schnell');
const OHNE_DET = args.includes('--ohne-determinismus');
const saisonArg = args.find(a => a.startsWith('--saisons='));
const EIGENE_SEEDS = args.filter(a => /^\d+$/.test(a)).map(Number);

const SEEDS = EIGENE_SEEDS.length ? EIGENE_SEEDS : [7, 2024];
const seeds = SCHNELL ? SEEDS.slice(0, 1) : SEEDS;
const SAISONS = saisonArg ? Math.max(1, parseInt(saisonArg.split('=')[1], 10) || 3) : (SCHNELL ? 1 : 3);
const DET_SAISONS = Math.min(2, SAISONS);

const EIGENER_VEREIN = 'hsv';
const TAGE_NOTBREMSE = 3000;

/* --- Die Zahlen, gegen die geprüft wird ----------------------------------- */

const WB_IDS = ['cl', 'el', 'conf'];
const SPOTS = LEAGUES.bl1.europeSpots;                       // { cl: 4, el: 2, conf: 1 }
const LIGA_PLAETZE = (SPOTS.cl || 0) + (SPOTS.el || 0) + (SPOTS.conf || 0);   // 7
const LIGAPHASE_SPIELE = EURO.leaguePhase.matchdays;         // 8
const LIGAPHASE_HEIM = LIGAPHASE_SPIELE / 2;                 // 4
const KO_RUNDEN = EURO.knockout.map(r => r.id);              // po, af, vf, hf, fin
const KO_NAMEN = new Map(EURO.knockout.map(r => [r.id, r.name]));
const EURO_IDS = new Set(EURO_CLUBS.map(c => c.id));
const EURO_ANZAHL = EURO_CLUBS.length;

const PRAEMIE_KORRIDOR = {
  cl:   { min: 20e6, max: 140e6 },
  conf: { min: 3e6, max: 25e6 }
  // Für die EL ist im Auftrag kein Korridor genannt – sie wird gemessen und
  // als Hinweis ausgegeben, damit die Zahl beim Balancing nicht fehlt.
};

const SPIELSTAND_MAX = 15 * 1024 * 1024;
const EU_KADER_MAX = 40;             // von EURO_ANZAHL nach drei Saisons
const PROFIS_IM_MINUS_MAX = 12;      // von 36
const KONTO_MIN = -60e6;

/* ------------------------------------------------------------------ *
 *  Mini-Testgerüst (Stil wie tools/test-saison.js)
 * ------------------------------------------------------------------ */

const ZTITEL = {
  1: 'Europapokalplätze vergeben: 4 CL, 2 EL, 1 Conference + Pokalsieger (7 oder 8)',
  2: 'Nachrückregel greift; kein Verein hat zwei Startplätze',
  3: 'Ligaphase: 8 Spiele gegen 8 verschiedene Gegner, 4 Heim / 4 Auswärts',
  4: 'Kein Verein spielt zweimal am selben Tag (Liga, Pokal, Europapokal)',
  5: 'Terminkollisionen mit Liga und Pokal: 0',
  6: 'Kein K.-o.-Duell endet unentschieden',
  7: 'Jede Saison ein Finale mit genau einem Sieger, je Wettbewerb',
  8: 'Prämien im Korridor (CL 20–140 Mio, Conference 3–25 Mio)',
  9: `Europäische Vereine lazy; höchstens ${EU_KADER_MAX} von ${EURO_ANZAHL} mit Kader`,
  10: 'Spielstand bleibt unter 15 MB',
  11: 'Doppelbelastung: mehr Spiele und mehr Belastungsspitzen, über den Lauf mehr Verletzungen',
  12: 'Keine NaN in Konten, Tabellen, Prämien',
  13: `Höchstens ${PROFIS_IM_MINUS_MAX} von 36 Profivereinen im Minus, keiner unter −60 Mio`,
  14: 'Deterministisch: gleicher Seed → gleiche Teilnehmer, Auslosung, Sieger'
};

const zstat = {};
for (const nr of Object.keys(ZTITEL)) zstat[nr] = { ok: 0, fehl: 0, offen: 0, meldungen: [] };

const strukturFehler = [];
const hinweise = [];

function z(nr, bedingung, ist) {
  const e = zstat[nr];
  const txt = `Z${String(nr).padStart(2)}  ${ZTITEL[nr]}`;
  if (bedingung) { e.ok++; console.log(`    [ok]   ${txt}  (ist: ${ist})`); }
  else { e.fehl++; e.meldungen.push(ist); console.log(`    [FEHL] ${txt}  -> ist: ${ist}`); }
}

function zoffen(nr, grund) {
  const e = zstat[nr];
  e.offen++; e.meldungen.push('nicht prüfbar: ' + grund);
  console.log(`    [ ?  ] Z${String(nr).padStart(2)}  ${ZTITEL[nr]}  -> nicht prüfbar: ${grund}`);
}

function S(text) { strukturFehler.push(text); console.log(`    [FEHL] ${text}`); }
function H(text) { hinweise.push(text); console.log(`    [hinw] ${text}`); }
function OK(text) { console.log(`    [ok]   ${text}`); }

function abschnitt(titel) { console.log('\n=== ' + titel + ' ==='); }
function unterpunkt(titel) { console.log('  ' + titel); }

const mb = b => (b / 1048576).toFixed(2).replace('.', ',') + ' MB';
const nz = (v, n = 1) => round(v, n).toFixed(n).replace('.', ',');
const mio = v => (v / 1e6).toFixed(2).replace('.', ',') + ' Mio';

/* ------------------------------------------------------------------ *
 *  Zugriffshelfer
 * ------------------------------------------------------------------ */

const kurz = (state, clubId) => {
  const c = state.clubs[clubId];
  return c ? (c.shortName || c.name || clubId) : String(clubId);
};

const liste = (state, ids) => (ids && ids.length) ? ids.map(id => kurz(state, id)).join(', ') : '–';

const istEuroVerein = clubId => EURO_IDS.has(clubId) || /^eu_/.test(String(clubId));

/** Alle Vereine der beiden Profiligen – die 36, um die es wirtschaftlich geht. */
function profiVereine(state) {
  const ids = [];
  for (const ligaId of LEAGUE_IDS) {
    const e = state.leagues && state.leagues[ligaId];
    const clubIds = (e && Array.isArray(e.clubIds) && e.clubIds.length)
      ? e.clubIds : LEAGUES[ligaId].clubIds;
    for (const cid of clubIds) if (state.clubs[cid]) ids.push(cid);
  }
  return ids;
}

/** Zu welchem Europapokal-Wettbewerb gehört diese Partie? -> 'cl'|'el'|'conf'|null */
function euroWettbewerb(f) {
  if (!f) return null;
  if (WB_IDS.includes(f.competitionId)) return f.competitionId;
  if (f.competitionId === EURO.id || f.competitionId === 'europapokal') {
    const w = f.wettbewerb || f.competition || f.subCompetitionId || f.wb;
    return WB_IDS.includes(w) ? w : null;
  }
  return null;
}

/** K.-o.-Runde einer Partie ('po'|'af'|'vf'|'hf'|'fin') oder null für die Ligaphase. */
function koRunde(f) {
  const r = f && (f.round || f.runde);
  return KO_RUNDEN.includes(r) ? r : null;
}

/** Alle Europapokal-Partien einer Saison. */
function euroFixtures(state, saison) {
  return state.fixtures.filter(f => f && f.season === saison && euroWettbewerb(f));
}

/** Tore einer Partie, tolerant gelesen (wie leagues.js:toreAus). */
function toreAus(f) {
  const res = f && f.result;
  if (!res) return null;
  if (Array.isArray(res) && res.length >= 2) return [res[0], res[1]];
  if (Array.isArray(res.score) && res.score.length >= 2) return [res.score[0], res.score[1]];
  if (typeof res.home === 'number' && typeof res.away === 'number') return [res.home, res.away];
  return null;
}

/**
 * Teilnehmerfeld aus dem Spielstand – akzeptiert beide vereinbarten Formen.
 * -> { cl:[], el:[], conf:[] }
 */
function teilnehmerAusState(state) {
  const out = { cl: [], el: [], conf: [] };
  const t = state.europa && state.europa.teilnehmer;
  if (!t) return out;
  if (Array.isArray(t)) {
    for (const p of t) {
      if (typeof p === 'string') { out.cl.push(p); continue; }
      if (!p) continue;
      const wb = p.competition || p.wettbewerb || p.competitionId || 'cl';
      const id = p.clubId || p.id;
      if (id && out[wb]) out[wb].push(id);
      else if (id) out.cl.push(id);
    }
  } else if (typeof t === 'object') {
    for (const k of WB_IDS) if (Array.isArray(t[k])) out[k] = t[k].filter(Boolean).slice();
  }
  return out;
}

/** Deutsche Teilnehmer, aus den tatsächlich angesetzten Partien abgeleitet. */
function teilnehmerAusFixtures(state, saison) {
  const out = { cl: new Set(), el: new Set(), conf: new Set() };
  for (const f of euroFixtures(state, saison)) {
    const wb = euroWettbewerb(f);
    for (const cid of [f.homeId, f.awayId]) {
      if (cid && !istEuroVerein(cid)) out[wb].add(cid);
    }
  }
  return out;
}

const alleTeilnehmer = t => WB_IDS.reduce((a, k) => a.concat(Array.from(t[k] || [])), []);

/* ------------------------------------------------------------------ *
 *  K.-o.-Duelle
 * ------------------------------------------------------------------ */

/** Elfmeterschießen einer Partie, tolerant gelesen -> [heim, gast] | null */
function elfmeterAus(f) {
  const e = f && (f.elfmeter || f.penalties || f.elfmeterschiessen);
  if (!e) return null;
  if (Array.isArray(e) && e.length >= 2) return [e[0], e[1]];
  if (typeof e.heim === 'number' && typeof e.gast === 'number') return [e.heim, e.gast];
  if (typeof e.home === 'number' && typeof e.away === 'number') return [e.home, e.away];
  return null;
}

/**
 * Fasst die K.-o.-Partien einer Saison zu Duellen zusammen.
 * -> [{ wb, round, a, b, legs, gespielt, sieger, aggregat, grund }]
 */
function duelleVon(state, saison) {
  const gruppen = new Map();
  for (const f of euroFixtures(state, saison)) {
    const r = koRunde(f);
    if (!r) continue;
    const wb = euroWettbewerb(f);
    const paar = [f.homeId, f.awayId].filter(Boolean).slice().sort();
    const key = `${wb}|${r}|${paar.join('|')}`;
    if (!gruppen.has(key)) gruppen.set(key, { wb, round: r, a: paar[0], b: paar[1], legs: [] });
    gruppen.get(key).legs.push(f);
  }

  const out = [];
  for (const g of gruppen.values()) {
    g.legs.sort((x, y) => (x.dayIndex || 0) - (y.dayIndex || 0));
    const tore = { [g.a]: 0, [g.b]: 0 };
    let gespielt = true;
    for (const f of g.legs) {
      const t = toreAus(f);
      if (!f.played || !t) { gespielt = false; continue; }
      tore[f.homeId] = (tore[f.homeId] || 0) + t[0];
      tore[f.awayId] = (tore[f.awayId] || 0) + t[1];
    }

    let sieger = null, grund = '';
    if (!g.b) {
      // Nur ein Verein im Duell: Freilos oder halbe Paarung. Kein Remis, aber
      // auch kein echtes Spiel – wird gemeldet, damit es nicht durchrutscht.
      sieger = g.a; grund = 'Freilos (nur ein Verein in der Paarung)';
    } else if (gespielt) {
      if (tore[g.a] > tore[g.b]) { sieger = g.a; grund = 'Gesamtscore'; }
      else if (tore[g.b] > tore[g.a]) { sieger = g.b; grund = 'Gesamtscore'; }
      else {
        const letzte = g.legs[g.legs.length - 1];
        const explizit = letzte && (letzte.sieger || letzte.winnerId || letzte.gewinner);
        const elf = elfmeterAus(letzte);
        if (explizit && (explizit === g.a || explizit === g.b)) { sieger = explizit; grund = 'fixture.sieger'; }
        else if (elf && elf[0] !== elf[1]) {
          sieger = elf[0] > elf[1] ? letzte.homeId : letzte.awayId;
          grund = `Elfmeterschießen ${elf[0]}:${elf[1]}`;
        }
      }
    }
    out.push(Object.assign(g, { gespielt, sieger, grund, aggregat: [tore[g.a], tore[g.b]] }));
  }
  return out;
}

const RUNDEN_RANG = new Map(KO_RUNDEN.map((r, i) => [r, i + 1]));

/** Wie weit ist dieser Verein gekommen? -> Text */
function weitesteRunde(state, saison, clubId, duelle) {
  const eigene = duelle.filter(d => d.a === clubId || d.b === clubId);
  if (!eigene.length) {
    const lp = euroFixtures(state, saison).filter(
      f => !koRunde(f) && (f.homeId === clubId || f.awayId === clubId));
    return lp.length ? 'Ligaphase' : '–';
  }
  eigene.sort((x, y) => (RUNDEN_RANG.get(x.round) || 0) - (RUNDEN_RANG.get(y.round) || 0));
  const letzte = eigene[eigene.length - 1];
  if (letzte.round === 'fin' && letzte.sieger === clubId) return 'SIEGER';
  if (letzte.sieger === clubId) return `${KO_NAMEN.get(letzte.round)} gewonnen`;
  return KO_NAMEN.get(letzte.round) || letzte.round;
}

/* ------------------------------------------------------------------ *
 *  Prämien
 * ------------------------------------------------------------------ */

const EU_LEDGER = /europ|champions|conference|uefa|uecl|königsklasse|koenigsklasse/i;

/** Europapokal-Prämien des Vereins aus seinem Kassenbuch (Saison-genau). */
function praemienAusKassenbuch(state, clubId, saison) {
  const club = state.clubs[clubId];
  const ledger = club && club.finances && Array.isArray(club.finances.ledger) ? club.finances.ledger : null;
  if (!ledger) return null;
  let summe = 0, treffer = 0;
  for (const e of ledger) {
    if (!e || e.kategorie !== 'praemien' || e.season !== saison) continue;
    if (!EU_LEDGER.test(String(e.text || ''))) continue;
    summe += e.betrag || 0; treffer++;
  }
  return treffer ? summe : null;
}

/**
 * Prämiensumme aus dem Prämienkatalog und den echten Ergebnissen nachgerechnet.
 * OHNE Platzprämie – die braucht eine Ligaphasentabelle über 36 Vereine, und die
 * gibt es nicht, solange nur Partien mit deutscher Beteiligung simuliert werden.
 */
function praemienGerechnet(state, saison, clubId, wb, duelle) {
  const p = EURO.competitions[wb] && EURO.competitions[wb].prizeMoney;
  if (!p) return null;
  let summe = p.start || 0;

  for (const f of euroFixtures(state, saison)) {
    if (koRunde(f) || euroWettbewerb(f) !== wb) continue;
    if (f.homeId !== clubId && f.awayId !== clubId) continue;
    const t = toreAus(f);
    if (!f.played || !t) continue;
    const eigene = f.homeId === clubId ? t[0] : t[1];
    const fremde = f.homeId === clubId ? t[1] : t[0];
    if (eigene > fremde) summe += p.sieg || 0;
    else if (eigene === fremde) summe += p.remis || 0;
  }

  const bonus = { po: p.playoff, af: p.achtelfinale, vf: p.viertelfinale, hf: p.halbfinale, fin: p.finale };
  for (const d of duelle) {
    if (d.wb !== wb || (d.a !== clubId && d.b !== clubId)) continue;
    summe += bonus[d.round] || 0;
    if (d.round === 'fin' && d.sieger === clubId) summe += p.titel || 0;
  }
  return summe;
}

/* ------------------------------------------------------------------ *
 *  Z01 / Z02 – Qualifikation und Nachrückregel
 * ------------------------------------------------------------------ */

/**
 * Prüft das Feld, das nach dem Saisonwechsel im Spielstand steht, gegen die
 * Abschlusstabelle und den Pokalsieger der abgelaufenen Saison.
 */
function pruefeQualifikation(state, bericht, alteSaison) {
  const tabelle = (bericht && bericht.tabellen && bericht.tabellen.bl1) || [];
  const feld = teilnehmerAusState(state);
  const alle = alleTeilnehmer(feld);
  const gesamt = alle.length;
  const wann = `Saison ${alteSaison}→${alteSaison + 1}`;

  if (!tabelle.length) {
    zoffen(1, `${wann}: keine Abschlusstabelle der 1. Liga im Bericht`);
    zoffen(2, `${wann}: keine Abschlusstabelle der 1. Liga im Bericht`);
    return feld;
  }
  if (!gesamt) {
    z(1, false, `${wann}: state.europa.teilnehmer ist leer – es wurde kein Startplatz vergeben`);
    z(2, false, `${wann}: state.europa.teilnehmer ist leer – Nachrückregel nicht anwendbar`);
    return feld;
  }

  const nachPlatz = tabelle.slice().sort((a, b) => (a.platz || 99) - (b.platz || 99)).map(zl => zl.clubId);
  const platzVon = new Map(nachPlatz.map((id, i) => [id, i + 1]));
  const basis = nachPlatz.slice(0, LIGA_PLAETZE);            // Plätze 1–7
  const pokalsieger = bericht.pokalsieger || null;
  const sollCl = nachPlatz.slice(0, SPOTS.cl || 0);

  /* --- Z01: Anzahl und Aufteilung -------------------------------------- */
  const psInBasis = !!(pokalsieger && basis.includes(pokalsieger));
  const clOk = feld.cl.length === (SPOTS.cl || 0) &&
    sollCl.every(id => feld.cl.includes(id));
  const gesamtOk = gesamt === 7 || gesamt === 8;
  const aufteilung = WB_IDS.map(k => `${k.toUpperCase()} ${feld[k].length}`).join(' / ');

  z(1, clOk && gesamtOk,
    `${wann}: ${gesamt} deutsche Teilnehmer (${aufteilung}), Pokalsieger ` +
    `${pokalsieger ? kurz(state, pokalsieger) + (psInBasis ? ` (schon über Platz ${platzVon.get(pokalsieger)} qualifiziert)` : ' (neu)') : 'unbekannt'}` +
    `; CL soll ${liste(state, sollCl)}, ist ${liste(state, feld.cl)}`);

  /* --- Z02: Nachrückregel, keine Doppelplätze --------------------------- */
  const zaehler = new Map();
  for (const id of alle) zaehler.set(id, (zaehler.get(id) || 0) + 1);
  const doppelt = Array.from(zaehler.entries()).filter(([, n]) => n > 1).map(([id]) => kurz(state, id));

  // Sollmenge: Plätze 1–7 plus Pokalsieger. Ist der schon über die Liga dabei,
  // sind BEIDE Auflösungen zulässig – Platz verfällt (7 Teilnehmer) oder der
  // nächste Ligaplatz rückt nach (8 Teilnehmer, Platz 8 dabei).
  let sollMenge, variante;
  if (pokalsieger && !psInBasis) {
    sollMenge = new Set(basis.concat([pokalsieger]));
    variante = `Pokalsieger als 8. Starter, EL erwartet: ${feld.el.includes(pokalsieger) ? 'ja' : 'NEIN'}`;
  } else if (gesamt === 8) {
    sollMenge = new Set(nachPlatz.slice(0, LIGA_PLAETZE + 1));
    variante = `nachgerückt: Platz ${LIGA_PLAETZE + 1} (${kurz(state, nachPlatz[LIGA_PLAETZE])})`;
  } else {
    sollMenge = new Set(basis);
    variante = 'Platz des Pokalsiegers verfällt (7 Starter)';
  }

  const zuviel = alle.filter(id => !sollMenge.has(id)).map(id =>
    `${kurz(state, id)}${platzVon.has(id) ? ` (Platz ${platzVon.get(id)})` : ' (nicht in der 1. Liga)'}`);
  const fehlt = Array.from(sollMenge).filter(id => !alle.includes(id)).map(id =>
    `${kurz(state, id)} (Platz ${platzVon.get(id) || '?'})`);
  const elOk = !pokalsieger || psInBasis || feld.el.includes(pokalsieger);

  z(2, doppelt.length === 0 && zuviel.length === 0 && fehlt.length === 0 && elOk,
    `${wann}: ${variante}` +
    (doppelt.length ? ` · DOPPELT: ${doppelt.join(', ')}` : ' · keine Doppelplätze') +
    (zuviel.length ? ` · zu viel: ${zuviel.join(', ')}` : '') +
    (fehlt.length ? ` · fehlt: ${fehlt.join(', ')}` : ''));

  return feld;
}

/* ------------------------------------------------------------------ *
 *  Z03 – Ligaphase
 * ------------------------------------------------------------------ */

function pruefeLigaphase(state, saison) {
  const teilnehmer = teilnehmerAusFixtures(state, saison);
  const alle = alleTeilnehmer(teilnehmer);
  if (!alle.length) {
    z(3, false, `Saison ${saison}: keine einzige Ligaphasen-Partie mit deutscher Beteiligung`);
    return;
  }

  const probleme = [];
  let geprueft = 0;
  for (const wb of WB_IDS) {
    for (const clubId of teilnehmer[wb]) {
      const spiele = euroFixtures(state, saison).filter(
        f => !koRunde(f) && euroWettbewerb(f) === wb && (f.homeId === clubId || f.awayId === clubId));
      const gegner = new Set();
      let heim = 0;
      for (const f of spiele) {
        const g = f.homeId === clubId ? f.awayId : f.homeId;
        gegner.add(g);
        if (f.homeId === clubId) heim++;
      }
      geprueft++;
      const mangel = [];
      if (spiele.length !== LIGAPHASE_SPIELE) mangel.push(`${spiele.length} Spiele`);
      if (gegner.size !== LIGAPHASE_SPIELE) mangel.push(`${gegner.size} verschiedene Gegner`);
      if (heim !== LIGAPHASE_HEIM || spiele.length - heim !== LIGAPHASE_HEIM) {
        mangel.push(`${heim} Heim / ${spiele.length - heim} Auswärts`);
      }
      if (mangel.length) probleme.push(`${kurz(state, clubId)} [${wb.toUpperCase()}]: ${mangel.join(', ')}`);
    }
  }

  z(3, probleme.length === 0,
    `Saison ${saison}: ${geprueft} Teilnehmer geprüft (Soll je ${LIGAPHASE_SPIELE} Spiele, ` +
    `${LIGAPHASE_SPIELE} Gegner, ${LIGAPHASE_HEIM}/${LIGAPHASE_HEIM})` +
    (probleme.length ? ` – ${probleme.length} Abweichung(en): ${probleme.slice(0, 3).join(' · ')}` : ' – alle sauber'));
}

/* ------------------------------------------------------------------ *
 *  Z04 / Z05 – Termine
 * ------------------------------------------------------------------ */

function pruefeTermine(state, saison) {
  // Wettbewerbsart jeder Partie: 'liga' | 'pokal' | 'europa'
  const art = f => {
    if (euroWettbewerb(f)) return 'europa';
    if (f.competitionId === CUP.id) return 'pokal';
    if (LEAGUE_IDS.includes(f.competitionId)) return 'liga';
    return null;
  };

  const belegung = new Map();      // clubId|day -> [{art, id}]
  for (const f of state.fixtures) {
    if (!f || f.season !== saison || f.freilos) continue;
    const a = art(f);
    if (!a) continue;
    for (const cid of [f.homeId, f.awayId]) {
      if (!cid) continue;
      const key = `${cid}|${f.dayIndex}`;
      if (!belegung.has(key)) belegung.set(key, []);
      belegung.get(key).push({ art: a, id: f.id, day: f.dayIndex, clubId: cid });
    }
  }

  const doppelt = [];
  const kollisionen = [];
  for (const [key, eintraege] of belegung) {
    if (eintraege.length < 2) continue;
    const [clubId, day] = key.split('|');
    const arten = eintraege.map(e => e.art);
    doppelt.push(`${kurz(state, clubId)} an Tag ${day} (${arten.join(' + ')})`);
    if (arten.includes('europa') && (arten.includes('liga') || arten.includes('pokal'))) {
      kollisionen.push(`${kurz(state, clubId)} Tag ${day}: ${arten.join(' + ')}`);
    }
  }

  z(4, doppelt.length === 0,
    `Saison ${saison}: ${doppelt.length} Doppelansetzung(en) bei ${belegung.size} Verein-Tag-Kombinationen` +
    (doppelt.length ? ` – ${doppelt.slice(0, 3).join(' · ')}` : ''));

  z(5, kollisionen.length === 0,
    `Saison ${saison}: ${kollisionen.length} Kollision(en) Europapokal ↔ Liga/Pokal` +
    (kollisionen.length ? ` – ${kollisionen.slice(0, 3).join(' · ')}` : ''));
}

/* ------------------------------------------------------------------ *
 *  Z06 / Z07 – K.-o.-Runden und Finale
 * ------------------------------------------------------------------ */

function pruefeKo(state, saison, duelle) {
  /* --- Z06: kein Duell endet unentschieden ----------------------------- */
  if (!duelle.length) {
    z(6, false, `Saison ${saison}: keine einzige K.-o.-Partie im Spielstand – ` +
      `die Runden ${KO_RUNDEN.join(', ')} wurden nie ausgelost`);
  } else {
    const offen = duelle.filter(d => !d.gespielt);
    const remis = duelle.filter(d => d.gespielt && !d.sieger);
    z(6, offen.length === 0 && remis.length === 0,
      `Saison ${saison}: ${duelle.length} Duelle, ${offen.length} ungespielt, ${remis.length} ohne Sieger` +
      (remis.length
        ? ` – ${remis.slice(0, 3).map(d => `${d.wb.toUpperCase()}/${d.round} ${kurz(state, d.a)} ${d.aggregat[0]}:${d.aggregat[1]} ${kurz(state, d.b)}`).join(' · ')}`
        : (duelle.length ? ` (entschieden über: ${Array.from(new Set(duelle.filter(d => d.grund).map(d => d.grund.split(' ')[0]))).join(', ')})` : '')));
  }

  /* --- Z07: ein Finale, ein Sieger, je Wettbewerb ----------------------- */
  const teile = [];
  let alleOk = true;
  const sieger = {};
  for (const wb of WB_IDS) {
    const finals = duelle.filter(d => d.wb === wb && d.round === 'fin');
    if (finals.length !== 1) {
      alleOk = false;
      // Auch ein Endspiel ohne deutsche Beteiligung muss stattfinden – sonst
      // hat der Wettbewerb in dieser Saison keinen Sieger und die Chronik
      // bekommt eine Lücke, die nie wieder zugeht.
      teile.push(`${wb.toUpperCase()}: ${finals.length} Endspiele` +
        (finals.length === 0 ? ' (auch ohne deutsche Beteiligung fällig)' : ''));
      continue;
    }
    const f = finals[0];
    if (!f.sieger) { alleOk = false; teile.push(`${wb.toUpperCase()}: Endspiel ohne Sieger (${f.aggregat[0]}:${f.aggregat[1]})`); continue; }
    sieger[wb] = f.sieger;
    teile.push(`${wb.toUpperCase()}: ${kurz(state, f.sieger)}`);
  }
  z(7, alleOk, `Saison ${saison}: ${teile.join(' · ') || 'kein Wettbewerb ausgetragen'}`);
  return sieger;
}

/* ------------------------------------------------------------------ *
 *  Z08 – Prämienkorridore
 * ------------------------------------------------------------------ */

function pruefePraemien(state, bericht, saison, duelle) {
  const ausBericht = bericht && bericht.europa && bericht.europa.praemien;
  const teilnehmer = teilnehmerAusFixtures(state, saison);
  const alle = alleTeilnehmer(teilnehmer);
  if (!alle.length) {
    zoffen(8, `Saison ${saison}: kein deutscher Teilnehmer – nichts auszuschütten`);
    return { quelle: '–', werte: new Map() };
  }

  const werte = new Map();     // clubId -> { wb, betrag, quelle }
  const quellen = new Set();
  for (const wb of WB_IDS) {
    for (const clubId of teilnehmer[wb]) {
      let betrag = null, quelle = null;
      if (ausBericht && typeof ausBericht[clubId] === 'number') {
        betrag = ausBericht[clubId]; quelle = 'Bericht';
      }
      if (betrag === null) {
        const kb = praemienAusKassenbuch(state, clubId, saison);
        if (kb !== null) { betrag = kb; quelle = 'Kassenbuch'; }
      }
      if (betrag === null) {
        betrag = praemienGerechnet(state, saison, clubId, wb, duelle);
        quelle = 'gerechnet (ohne Platzprämie)';
      }
      if (betrag === null) continue;
      quellen.add(quelle);
      werte.set(clubId, { wb, betrag, quelle });
    }
  }

  const verstoesse = [];
  const spannen = {};
  for (const wb of WB_IDS) {
    const eintraege = Array.from(werte.entries()).filter(([, v]) => v.wb === wb);
    if (!eintraege.length) continue;
    const betraege = eintraege.map(([, v]) => v.betrag);
    spannen[wb] = `${wb.toUpperCase()} ${mio(Math.min(...betraege))}–${mio(Math.max(...betraege))} (${eintraege.length})`;
    const k = PRAEMIE_KORRIDOR[wb];
    if (!k) continue;
    for (const [clubId, v] of eintraege) {
      if (v.betrag < k.min || v.betrag > k.max) {
        verstoesse.push(`${kurz(state, clubId)} [${wb.toUpperCase()}] ${mio(v.betrag)} ` +
          `(Korridor ${mio(k.min)}–${mio(k.max)})`);
      }
    }
  }

  const quelle = Array.from(quellen).join(' + ') || '–';
  z(8, verstoesse.length === 0,
    `Saison ${saison}: ${Object.values(spannen).join(' · ') || 'keine Werte'} ` +
    `[Quelle: ${quelle}]` +
    (verstoesse.length ? ` – ${verstoesse.length} außerhalb: ${verstoesse.slice(0, 3).join(' · ')}` : ''));

  return { quelle, werte };
}

/* ------------------------------------------------------------------ *
 *  Z09 – Lazy-Kader der europäischen Vereine
 * ------------------------------------------------------------------ */

function euroVereineImState(state) {
  return EURO_CLUBS.map(c => state.clubs[c.id]).filter(Boolean);
}

function pruefeLazyStart(state) {
  const vorhanden = euroVereineImState(state);
  if (vorhanden.length !== EURO_ANZAHL) {
    z(9, false, `Anpfiff: nur ${vorhanden.length} von ${EURO_ANZAHL} europäischen Vereinen stehen in state.clubs`);
    return;
  }
  const mitKader = vorhanden.filter(c => (c.playerIds || []).length > 0);
  const ohneFlagge = vorhanden.filter(c => !c.lazySquad);
  z(9, mitKader.length === 0 && ohneFlagge.length === 0,
    `Anpfiff: ${vorhanden.length} europäische Vereine, ${mitKader.length} mit Kader, ` +
    `${ohneFlagge.length} ohne lazySquad-Flagge`);
}

function pruefeLazyEnde(state, gespieltGegen, saisons) {
  const vorhanden = euroVereineImState(state);
  if (!vorhanden.length) {
    z(9, false, `nach ${saisons} Saison(s): kein einziger europäischer Verein in state.clubs`);
    return;
  }
  const mitKader = vorhanden.filter(c => (c.playerIds || []).length > 0);
  // Ein Kader ohne je ein Spiel ist der teure Fall: dann greift die Lazy-Regel nicht.
  const grundlos = mitKader.filter(c => !gespieltGegen.has(c.id)).map(c => c.shortName || c.id);
  z(9, mitKader.length <= EU_KADER_MAX && grundlos.length === 0,
    `nach ${saisons} Saison(s): ${mitKader.length} von ${vorhanden.length} europäischen Vereinen ` +
    `haben einen Kader (Grenze ${EU_KADER_MAX}), ${gespieltGegen.size} wurden bespielt` +
    (grundlos.length ? ` – ${grundlos.length} Kader ohne Spiel: ${grundlos.slice(0, 4).join(', ')}` : ''));
}

/* ------------------------------------------------------------------ *
 *  Z11 – Doppelbelastung
 *
 *  WAS HIER GEMESSEN WIRD – UND WARUM NICHT MEHR
 *
 *  Die naheliegende Prüfung („Europateilnehmer haben mehr Verletzungen als der
 *  Rest der Liga") ist über eine einzelne Saison NICHT entscheidbar. Die beiden
 *  Gruppen unterscheiden sich strukturell: die Europateilnehmer haben die
 *  bessere medizinische Abteilung (gemessen 82–86 gegen 75–79 Punkte, das sind
 *  über club/medical.js:MED_PRAEVENTION rund 8 % weniger Risiko je Einsatz),
 *  den breiteren Kader und die robusteren Spieler. Gemessen über neun
 *  Spielzeiten (Seeds 2024, 7, 11): der Verletzungsvergleich je Saison ging
 *  7 von 9 Mal in die erwartete Richtung, die Ausfalltage nur 3 von 9 Mal –
 *  bei sieben bis elf Vereinen je Gruppe ist das Rauschen.
 *
 *  Geprüft wird deshalb dreistufig, vom Sicheren zum Wackligen:
 *
 *   (1) je Saison, deterministisch: mehr Pflichtspiele. Folgt direkt aus dem
 *       Spielplan.
 *   (2) je Saison, deterministisch: mehr BELASTUNGSSPITZEN – Spieltage, an
 *       denen im Rückblick auf BELASTUNG_FENSTER (15) Tage mindestens
 *       BELASTUNG_SPIELE_WARNUNG (4) Pflichtspiele liegen. Genau dieser Wert
 *       geht in club/medical.js:risikoFaktoren als Risikoaufschlag ein
 *       (BELASTUNG_RISIKO_PRO_SPIEL). Gemessen 24–27 gegen 2–5 Spieltage,
 *       9 von 9 Spielzeiten. Das ist der Nachweis, dass die Doppelbelastung im
 *       Spielplan ankommt und die Rechnung erreicht.
 *   (3) EINMAL je Lauf, über alle Saisons zusammengefasst: mehr Verletzungen.
 *       Erst dieser größere Stichprobenumfang trägt eine Aussage. Gemessen über
 *       je drei Saisons (23 gegen 31 Vereinssaisons): Seed 7 9,7 gegen 8,0,
 *       Seed 2024 7,8 gegen 7,3. Dasselbe Vorzeichen in allen drei geprüften
 *       Seeds — aber der Abstand ist dünn, und mehr behauptet diese Prüfung
 *       auch nicht.
 *
 *  Punkt 3 ist die Zusicherung, die fällt, wenn club/europa.js:belastungBuchen
 *  aufhört zu arbeiten; Punkt 2 die, die fällt, wenn der Spielplan die Partien
 *  nicht mehr verdichtet.
 * ------------------------------------------------------------------ */

/** = BELASTUNG_FENSTER / BELASTUNG_SPIELE_WARNUNG in src/club/medical.js. */
const BELASTUNG_FENSTER = 15;
const BELASTUNG_SPIELE_WARNUNG = 4;

/** Sammelstelle für Punkt 3 – über alle Saisons eines Laufs. */
let belastungGesamt = null;

function belastungZuruecksetzen() {
  belastungGesamt = { mit: [], ohne: [] };
}

function pruefeDoppelbelastung(state, saison) {
  const europaVereine = new Set(alleTeilnehmer(teilnehmerAusFixtures(state, saison)));
  const bl1 = (state.leagues && state.leagues.bl1 && state.leagues.bl1.clubIds) || LEAGUES.bl1.clubIds;

  const mit = [], ohne = [];
  for (const clubId of bl1) {
    const club = state.clubs[clubId];
    if (!club) continue;
    const tage = state.fixtures
      .filter(f => f && f.season === saison && f.played && !f.freilos &&
        (f.homeId === clubId || f.awayId === clubId))
      .map(f => f.dayIndex)
      .sort((a, b) => a - b);
    // Spitzen: Spieltage, an denen die Belastungssteuerung Alarm schlägt.
    const spitzen = tage.filter(t =>
      tage.filter(x => x <= t && x > t - BELASTUNG_FENSTER).length >= BELASTUNG_SPIELE_WARNUNG).length;
    const med = club.medizin || {};
    const eintrag = {
      clubId, saison, spiele: tage.length, spitzen,
      verletzungen: med.verletzungenSaison || 0,
      ausfalltage: (med.ausfalltage && med.ausfalltage.saison) || 0
    };
    (europaVereine.has(clubId) ? mit : ohne).push(eintrag);
  }

  if (!mit.length || !ohne.length) {
    zoffen(11, `Saison ${saison}: ${mit.length} Vereine mit, ${ohne.length} ohne Europapokal – kein Vergleich möglich`);
    return;
  }

  if (belastungGesamt) {
    belastungGesamt.mit.push(...mit);
    belastungGesamt.ohne.push(...ohne);
  }

  const schnitt = (l, feld) => l.reduce((s, e) => s + e[feld], 0) / l.length;
  const sMit = schnitt(mit, 'spiele'), sOhne = schnitt(ohne, 'spiele');
  const pMit = schnitt(mit, 'spitzen'), pOhne = schnitt(ohne, 'spitzen');
  const vMit = schnitt(mit, 'verletzungen'), vOhne = schnitt(ohne, 'verletzungen');
  const aMit = schnitt(mit, 'ausfalltage'), aOhne = schnitt(ohne, 'ausfalltage');

  z(11, sMit > sOhne && pMit > pOhne,
    `Saison ${saison}: mit Europa (${mit.length} Vereine) ${nz(sMit)} Pflichtspiele, ` +
    `${nz(pMit)} Belastungsspitzen · ohne (${ohne.length}) ${nz(sOhne)} / ${nz(pOhne)} · ` +
    `Differenz ${nz(sMit - sOhne)} Spiele, ${nz(pMit - pOhne)} Spitzen ` +
    `[nachrichtlich, je Saison zu verrauscht für eine Zusicherung: ` +
    `${nz(vMit)} gegen ${nz(vOhne)} Verletzungen, ${nz(aMit, 0)} gegen ${nz(aOhne, 0)} Ausfalltage]`);
}

/** Punkt 3: einmal je Lauf, über alle Saisons zusammengefasst. */
function pruefeDoppelbelastungGesamt(seed, saisons) {
  if (!belastungGesamt || !belastungGesamt.mit.length || !belastungGesamt.ohne.length) return;
  const { mit, ohne } = belastungGesamt;
  // Unter vier Vereinssaisons je Gruppe ist der Mittelwert wertlos – dann lieber
  // nichts behaupten als etwas Falsches (--schnell fällt genau hierunter).
  if (mit.length < 4 || ohne.length < 4) {
    H(`Seed ${seed}: Doppelbelastung über den ganzen Lauf nicht bewertet – ` +
      `nur ${mit.length} bzw. ${ohne.length} Vereinssaisons, zu wenig für einen Mittelwert`);
    return;
  }
  const schnitt = (l, feld) => l.reduce((s, e) => s + e[feld], 0) / l.length;
  const vMit = schnitt(mit, 'verletzungen'), vOhne = schnitt(ohne, 'verletzungen');
  const sMit = schnitt(mit, 'spiele'), sOhne = schnitt(ohne, 'spiele');
  z(11, vMit > vOhne,
    `Seed ${seed}, ${saisons} Saison(s) zusammengefasst: mit Europa ${mit.length} Vereinssaisons, ` +
    `${nz(sMit)} Pflichtspiele und ${nz(vMit)} Verletzungen je Verein und Saison · ` +
    `ohne ${ohne.length} Vereinssaisons, ${nz(sOhne)} / ${nz(vOhne)} · ` +
    `Differenz ${nz(sMit - sOhne)} Spiele, ${nz(vMit - vOhne)} Verletzungen`);
}

/* ------------------------------------------------------------------ *
 *  Z12 / Z13 – Zahlenhygiene und Wirtschaftsbalance
 * ------------------------------------------------------------------ */

const ZAHL_OK = v => typeof v !== 'number' || Number.isFinite(v);

function pruefeKeineNaN(state, bericht, wann) {
  const treffer = [];
  const pruef = (wert, wo) => { if (!ZAHL_OK(wert)) treffer.push(wo); };

  for (const c of Object.values(state.clubs)) {
    const f = c.finances || {};
    pruef(f.balance, `${c.id}.finances.balance`);
    pruef(f.debt, `${c.id}.finances.debt`);
    pruef(f.transferBudget, `${c.id}.finances.transferBudget`);
    const s = c.season || {};
    pruef(s.punkte, `${c.id}.season.punkte`);
    pruef(s.tore, `${c.id}.season.tore`);
    pruef(s.gegentore, `${c.id}.season.gegentore`);
    pruef(c.reputation, `${c.id}.reputation`);
  }

  for (const tabId of Object.keys(state.tables || {})) {
    for (const zeile of state.tables[tabId] || []) {
      for (const k of ['punkte', 'tore', 'gegentore', 'diff', 'platz', 'spiele']) {
        pruef(zeile[k], `tables.${tabId}.${zeile.clubId}.${k}`);
      }
    }
  }

  for (const f of state.fixtures) {
    if (!euroWettbewerb(f)) continue;
    pruef(f.dayIndex, `${f.id}.dayIndex`);
    pruef(f.matchday, `${f.id}.matchday`);
    const t = toreAus(f);
    if (t) { pruef(t[0], `${f.id}.result[0]`); pruef(t[1], `${f.id}.result[1]`); }
  }

  const praemien = (bericht && bericht.europa && bericht.europa.praemien) || {};
  for (const id in praemien) pruef(praemien[id], `bericht.europa.praemien.${id}`);
  for (const id in ((bericht && bericht.praemien) || {})) pruef(bericht.praemien[id], `bericht.praemien.${id}`);

  z(12, treffer.length === 0,
    treffer.length ? `${wann}: ${treffer.length} NaN/Infinity – ${treffer.slice(0, 4).join(', ')}`
      : `${wann}: alle geprüften Zahlenfelder endlich`);
}

function pruefeWirtschaft(state, wann) {
  const profis = profiVereine(state).map(id => state.clubs[id]);
  const konten = profis.map(c => ({ id: c.id, saldo: (c.finances && c.finances.balance) || 0 }));
  const minus = konten.filter(k => k.saldo < 0);
  const tief = konten.filter(k => k.saldo < KONTO_MIN);
  minus.sort((a, b) => a.saldo - b.saldo);

  z(13, minus.length <= PROFIS_IM_MINUS_MAX && tief.length === 0,
    `${wann}: ${minus.length} von ${profis.length} Profivereinen im Minus (Grenze ${PROFIS_IM_MINUS_MAX}), ` +
    `tiefstes Konto ${minus.length ? kurz(state, minus[0].id) + ' ' + mio(minus[0].saldo) : '–'}` +
    (tief.length ? ` · ${tief.length} unter ${mio(KONTO_MIN)}` : ''));
}

/* ------------------------------------------------------------------ *
 *  Z14 – Fingerabdruck einer Europapokal-Saison
 * ------------------------------------------------------------------ */

function europaSignatur(state, saison, duelle, sieger) {
  const feld = teilnehmerAusState(state);
  const teile = [];
  teile.push('T:' + WB_IDS.map(k => `${k}=${feld[k].slice().sort().join(',')}`).join(';'));
  teile.push('F:' + euroFixtures(state, saison)
    .map(f => `${euroWettbewerb(f)}|${f.round || 'lp'}|${f.dayIndex}|${f.homeId}>${f.awayId}`)
    .sort().join('~'));
  teile.push('D:' + duelle
    .map(d => `${d.wb}|${d.round}|${d.a}-${d.b}|${d.sieger || '?'}`)
    .sort().join('~'));
  teile.push('S:' + WB_IDS.map(k => `${k}=${sieger[k] || '?'}`).join(';'));
  return teile.join('##');
}

/* ------------------------------------------------------------------ *
 *  Eine Saison durchspielen
 * ------------------------------------------------------------------ */

/** Nach jedem Tag: Pokal und (falls vorhanden) Europapokal weiterlosen. */
const EUROPA_LOSER = ['europaWeiterlosen', 'europapokalWeiterlosen', 'europaAuslosen', 'europaRundeWeiter'];
const europaWeiterlosen = (() => {
  for (const name of EUROPA_LOSER) if (typeof loop[name] === 'function') return { name, fn: loop[name] };
  return null;
})();

async function saisonSpielen(state, gespieltGegen) {
  const protokoll = { eigeneSpiele: 0, entlassungen: 0, schritte: 0, fehler: [] };

  const echtesError = console.error;
  console.error = (...a) => protokoll.fehler.push(a.map(String).join(' '));

  try {
    for (let i = 0; i < TAGE_NOTBREMSE; i++) {
      protokoll.schritte++;
      const res = await advanceDay(state);

      if (res.stop === 'saisonende') return protokoll;

      if (res.stop === 'spieltag') {
        const fx = res.fixture;
        if (fx.freilos) { fx.played = true; }
        else {
          const ctx = makeCtx(state);
          try {
            applyResult(state, fx, simulateAiFixture(state, fx, ctx), ctx);
            protokoll.eigeneSpiele++;
          } catch (err) {
            protokoll.fehler.push(`Eigene Partie ${fx.id}: ${err && err.message}`);
            fx.played = true; fx.result = { score: [0, 0], stats: null };
          }
        }
      } else if (res.stop === 'entlassung') {
        protokoll.entlassungen++;
        state.flags.entlassen = false;
      } else if (res.stop === 'post') {
        for (const m of state.inbox) if (!m.gelesen && m.day === state.date.day) m.gelesen = true;
      }

      try { pokalWeiterlosen(state, makeCtx(state)); }
      catch (err) { protokoll.fehler.push(`Pokalauslosung: ${err && err.message}`); }

      if (europaWeiterlosen) {
        try { europaWeiterlosen.fn(state, makeCtx(state)); }
        catch (err) { protokoll.fehler.push(`Europapokal-Auslosung: ${err && err.message}`); }
      }

      // Wer schon einmal gegen einen europäischen Verein gespielt hat, darf einen
      // Kader haben – das ist die Gegenprobe zur Lazy-Regel (Z09).
      for (const f of state.fixtures) {
        if (!f.played || f.season !== state.date.season || !euroWettbewerb(f)) continue;
        if (istEuroVerein(f.homeId)) gespieltGegen.add(f.homeId);
        if (istEuroVerein(f.awayId)) gespieltGegen.add(f.awayId);
      }
    }
  } finally {
    console.error = echtesError;
  }

  protokoll.fehler.push(`Notbremse: ${TAGE_NOTBREMSE} Schritte ohne Saisonende (Tag ${state.date.day})`);
  return protokoll;
}

/* ------------------------------------------------------------------ *
 *  Vorprüfung: Existiert überhaupt, was Stufe 3 verspricht?
 * ------------------------------------------------------------------ */

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  TRAUMVEREIN – Europapokal-Prüfstand (Roadmap-Stufe 3)       ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`  Seeds: ${seeds.join(', ')} · Saisons je Seed: ${SAISONS} · Verein: ${EIGENER_VEREIN}`);
console.log(`  Feld: ${EURO_ANZAHL} europäische Vereine, Startplätze bl1 ` +
  `CL ${SPOTS.cl} / EL ${SPOTS.el} / Conf ${SPOTS.conf} + Pokalsieger (${CUP.europaPlatz.toUpperCase()})`);

abschnitt('A) Vorprüfung: sind die vereinbarten Schnittstellen da?');

if (typeof loop.saisonWechsel === 'function') OK('core/loop.js exportiert saisonWechsel(state, ctx)');
else S('core/loop.js exportiert kein saisonWechsel(state, ctx) – ohne Stufe 1 gibt es keine Qualifikation');

if (europaWeiterlosen) OK(`core/loop.js exportiert ${europaWeiterlosen.name}(state, ctx) – wird nach jedem Tag gerufen`);
else H('core/loop.js exportiert kein europaWeiterlosen(state, ctx) – ' +
  'entweder erledigt advanceDay() die K.-o.-Auslosung selbst, oder sie findet nie statt (siehe Z06/Z07)');

{
  const probe = createNewGame({ clubId: EIGENER_VEREIN, managerName: 'Vorprüfer', difficulty: 'profi', seed: 1 });

  const imState = euroVereineImState(probe).length;
  if (imState === EURO_ANZAHL) OK(`state.clubs enthält alle ${EURO_ANZAHL} europäischen Vereine`);
  else S(`state.clubs enthält ${imState} von ${EURO_ANZAHL} europäischen Vereinen – ` +
    'es fehlt ein euroClub() neben amateurClub() in core/state.js');

  const feld = alleTeilnehmer(teilnehmerAusState(probe));
  if (feld.length) OK(`Startfeld für Saison 1 steht: ${feld.length} deutsche Teilnehmer`);
  else S('state.europa.teilnehmer ist nach createNewGame() leer – ' +
    'im ersten Jahr gäbe es keinen Europapokal');

  const partien = euroFixtures(probe, 1).length;
  if (partien) OK(`Saison 1 startet mit ${partien} Europapokal-Partien im Spielplan`);
  else S('Nach createNewGame() liegt keine einzige Europapokal-Partie in state.fixtures – ' +
    'generateEuropeSchedule() wird nach wie vor von niemandem gerufen');

  pruefeLazyStart(probe);
}

/* ------------------------------------------------------------------ *
 *  Der eigentliche Lauf
 * ------------------------------------------------------------------ */

const uebersicht = [];
const gestartet = Date.now();
const signaturen = new Map();       // seed -> [signatur je Saison]

async function durchlauf(seed, saisons, { still = false } = {}) {
  const state = createNewGame({
    clubId: EIGENER_VEREIN, managerName: 'Testtrainer', difficulty: 'profi', seed
  });

  const gespieltGegen = new Set();
  const sig = [];
  let letzteSaison = 0;
  let abbruch = null;
  let eigeneGesamt = 0;

  if (!still) belastungZuruecksetzen();

  if (!still) {
    unterpunkt(`Anpfiff: Spielstand ${mb(serialize(state).length)}, ` +
      `Startfeld ${alleTeilnehmer(teilnehmerAusState(state)).length} deutsche Teilnehmer`);
  }

  for (let saison = 1; saison <= saisons; saison++) {
    if (!still) unterpunkt(`— Saison ${saison} —`);

    const lauf = await saisonSpielen(state, gespieltGegen);
    eigeneGesamt += lauf.eigeneSpiele;
    letzteSaison = saison;

    if (!still) {
      if (lauf.entlassungen) H(`Saison ${saison}: ${lauf.entlassungen}× entlassen – für den Prüflauf ignoriert`);
      for (const f of lauf.fehler.slice(0, 4)) H(`Saison ${saison}: ${f}`);
      if (lauf.fehler.length > 4) H(`Saison ${saison}: … und ${lauf.fehler.length - 4} weitere Modulfehler`);
    }

    /* --- Alles, was den Spielplan der Saison braucht: VOR dem Wechsel ---- */
    const duelle = duelleVon(state, saison);
    let sieger = {};
    let praemien = { quelle: '–', werte: new Map() };

    if (!still) {
      pruefeLigaphase(state, saison);
      pruefeTermine(state, saison);
      sieger = pruefeKo(state, saison, duelle);
      praemien = pruefePraemien(state, null, saison, duelle);
      pruefeDoppelbelastung(state, saison);
    } else {
      // Für den Determinismuslauf reicht der Fingerabdruck.
      for (const wb of WB_IDS) {
        const f = duelle.find(d => d.wb === wb && d.round === 'fin');
        if (f && f.sieger) sieger[wb] = f.sieger;
      }
    }

    const teilnehmerJetzt = teilnehmerAusFixtures(state, saison);
    sig.push(europaSignatur(state, saison, duelle, sieger));

    /* --- Kurzübersicht der Saison ---------------------------------------- */
    if (!still) {
      for (const wb of WB_IDS) {
        const ids = Array.from(teilnehmerJetzt[wb]);
        if (!ids.length) { console.log(`      ${wb.toUpperCase().padEnd(4)} –`); continue; }
        const text = ids.map(id => {
          const p = praemien.werte.get(id);
          return `${kurz(state, id)} (${weitesteRunde(state, saison, id, duelle)}` +
            `${p ? ', ' + mio(p.betrag) : ''})`;
        }).join(' · ');
        console.log(`      ${wb.toUpperCase().padEnd(4)} ${text}`);
      }
      const eigenePflicht = state.fixtures.filter(f =>
        f && f.season === saison && f.played && !f.freilos &&
        (f.homeId === EIGENER_VEREIN || f.awayId === EIGENER_VEREIN)).length;
      const eigenePraemie = praemien.werte.get(EIGENER_VEREIN);
      console.log(`      Sieger: ${WB_IDS.map(k => `${k.toUpperCase()} ${sieger[k] ? kurz(state, sieger[k]) : '?'}`).join(' · ')}`);
      console.log(`      ${kurz(state, EIGENER_VEREIN)}: ${eigenePflicht} Pflichtspiele, ` +
        `Europa-Prämien ${eigenePraemie ? mio(eigenePraemie.betrag) + ' [' + eigenePraemie.quelle + ']' : 'keine'}`);
    }

    /* --- Der Saisonwechsel ------------------------------------------------ */
    if (typeof loop.saisonWechsel !== 'function') {
      abbruch = 'core/loop.js exportiert kein saisonWechsel() – weitere Saisons nicht spielbar';
      break;
    }

    let bericht = null;
    try {
      bericht = await loop.saisonWechsel(state, makeCtx(state));
    } catch (err) {
      if (!still) S(`Saison ${saison}: saisonWechsel() ist gescheitert – ${err && err.message}`);
      abbruch = `saisonWechsel() wirft: ${err && err.message}`;
      break;
    }

    if (!still) {
      if (!bericht || typeof bericht !== 'object') {
        S(`Saison ${saison}: saisonWechsel() liefert keinen Bericht`);
        bericht = {};
      } else if (!bericht.europa) {
        H(`Saison ${saison}: der Saisonbericht hat kein Feld "europa" ` +
          '{ teilnehmer, sieger, praemien } – die Prämien wurden ersatzweise gerechnet');
      }
      pruefeQualifikation(state, bericht, saison);
      pruefeKeineNaN(state, bericht, `nach dem Wechsel ${saison}→${saison + 1}`);
      pruefeWirtschaft(state, `nach dem Wechsel ${saison}→${saison + 1}`);
      console.log(`      Spielstand ${mb(serialize(state).length)} · ` +
        `europäische Kader: ${euroVereineImState(state).filter(c => (c.playerIds || []).length).length}`);
    }
  }

  return { state, sig, letzteSaison, abbruch, gespieltGegen, eigeneGesamt };
}

for (const seed of seeds) {
  abschnitt(`B) Spielstand Seed ${seed}`);
  const t0 = Date.now();

  const lauf = await durchlauf(seed, SAISONS);
  signaturen.set(seed, lauf.sig);

  unterpunkt('— Bilanz des Spielstands —');
  pruefeLazyEnde(lauf.state, lauf.gespieltGegen, lauf.letzteSaison);
  pruefeDoppelbelastungGesamt(seed, lauf.letzteSaison);

  const groesse = serialize(lauf.state).length;
  z(10, groesse < SPIELSTAND_MAX,
    `${mb(groesse)} nach ${lauf.letzteSaison} Saison(s) (Grenze ${mb(SPIELSTAND_MAX)})`);

  pruefeWirtschaft(lauf.state, `Ende Seed ${seed}`);

  const dauer = Date.now() - t0;
  uebersicht.push({ seed, saisons: lauf.letzteSaison, eigene: lauf.eigeneGesamt, groesse, dauer, abbruch: lauf.abbruch });
  console.log(`    Laufzeit: ${(dauer / 1000).toFixed(1)} s`);
  if (lauf.abbruch) console.log(`    Abbruch nach Saison ${lauf.letzteSaison}: ${lauf.abbruch}`);
}

/* ------------------------------------------------------------------ *
 *  Z14 – Determinismus
 * ------------------------------------------------------------------ */

abschnitt('C) Determinismus');

if (OHNE_DET) {
  zoffen(14, '--ohne-determinismus gesetzt');
} else {
  const seed = seeds[0];
  const soll = (signaturen.get(seed) || []).slice(0, DET_SAISONS);
  if (!soll.length) {
    zoffen(14, `Seed ${seed} hat keine einzige Saison zu Ende gespielt`);
  } else {
    unterpunkt(`Zweiter Durchlauf mit Seed ${seed} über ${DET_SAISONS} Saison(s) …`);
    const t0 = Date.now();
    const wieder = await durchlauf(seed, DET_SAISONS, { still: true });
    const ist = wieder.sig.slice(0, DET_SAISONS);

    const abweichung = [];
    for (let i = 0; i < soll.length; i++) {
      if (soll[i] !== (ist[i] || '')) {
        const a = soll[i].split('##');
        const b = (ist[i] || '').split('##');
        const teile = ['Teilnehmer', 'Auslosung', 'Duelle', 'Sieger'];
        const wo = teile.filter((_, k) => a[k] !== b[k]);
        abweichung.push(`Saison ${i + 1}: ${wo.length ? wo.join(', ') : 'unbekannt'} verschieden`);
      }
    }
    z(14, abweichung.length === 0,
      `Seed ${seed}, ${soll.length} Saison(s) verglichen (Teilnehmer, Auslosung, Duelle, Sieger)` +
      (abweichung.length ? ` – ${abweichung.join(' · ')}` : ' – identisch') +
      ` (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}

/* ------------------------------------------------------------------ *
 *  Übersicht
 * ------------------------------------------------------------------ */

abschnitt('D) Durchläufe');
for (const u of uebersicht) {
  console.log(`  Seed ${String(u.seed).padStart(5)} · ${u.saisons} Saison(s) · ` +
    `${u.eigene} eigene Partien · ${mb(u.groesse)} · ${(u.dauer / 1000).toFixed(1)} s` +
    (u.abbruch ? '  [abgebrochen]' : ''));
}

abschnitt('E) Zusicherungen');
let fehlgeschlagen = 0, ungeprueft = 0;
for (const nr of Object.keys(ZTITEL).sort((a, b) => a - b)) {
  const e = zstat[nr];
  const status = e.fehl ? 'FEHL' : e.ok ? ' ok ' : ' ?  ';
  if (e.fehl) fehlgeschlagen++;
  else if (!e.ok) { ungeprueft++; if (!e.offen) e.meldungen.push('nie zur Prüfung gekommen'); }
  console.log(`  [${status}] Z${String(nr).padStart(2)}  ${ZTITEL[nr]}` +
    `   (${e.ok}× bestanden, ${e.fehl}× fehlgeschlagen, ${e.offen}× nicht prüfbar)`);
  for (const m of e.meldungen.slice(0, 3)) console.log(`          · ${m}`);
  if (e.meldungen.length > 3) console.log(`          · … und ${e.meldungen.length - 3} weitere`);
}

abschnitt('F) Ergebnis');
if (strukturFehler.length) {
  console.log(`  Fehlende Bausteine (${strukturFehler.length}):`);
  for (const s of strukturFehler) console.log('    · ' + s);
}
if (hinweise.length) {
  console.log(`  Hinweise (${hinweise.length}):`);
  for (const h of hinweise.slice(0, 12)) console.log('    · ' + h);
  if (hinweise.length > 12) console.log(`    · … und ${hinweise.length - 12} weitere`);
}

const bestanden = Object.keys(ZTITEL).length - fehlgeschlagen - ungeprueft;
console.log('\n' + '='.repeat(70));
console.log(`ERGEBNIS: ${bestanden} von ${Object.keys(ZTITEL).length} Zusicherungen bestanden, ` +
  `${fehlgeschlagen} fehlgeschlagen, ${ungeprueft} nicht prüfbar, ` +
  `${strukturFehler.length} fehlende Bausteine  (${((Date.now() - gestartet) / 1000).toFixed(1)} s)`);

const hart = fehlgeschlagen + ungeprueft + strukturFehler.length;
if (!hart) console.log('Europa spielt. Der Prüfstand hat nichts zu meckern – notieren Sie das Datum.');
process.exit(hart ? 1 : 0);
