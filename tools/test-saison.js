/**
 * tools/test-saison.js – Der Prüfstand für den Saisonwechsel (Roadmap-Stufe 1).
 *
 *   node tools/test-saison.js                 # Standard: Seeds 7 und 2024, je 3 Saisons
 *   node tools/test-saison.js 11 42 1899      # eigene Seeds
 *   node tools/test-saison.js --schnell       # nur der erste Seed, nur 1 Saison
 *   node tools/test-saison.js --saisons=5     # längerer Lauf
 *
 * Alle bisherigen Prüfskripte hören spätestens am Tag 120 der ersten Saison auf.
 * Alles, was danach passiert – Auf- und Abstieg, neue Spielpläne, eine frische
 * Pokalauslosung, Karriereenden, die Manager-Bilanz – ist heute von keinem Test
 * erreichbar. Dieses Skript spielt deshalb DREI komplette Saisons durch und
 * sichert die fünfzehn Aussagen zu, ohne die eine Karriere über zehn Jahre
 * unweigerlich auseinanderfällt.
 *
 * Es wird bewusst VOR der Umsetzung von Stufe 1 geschrieben. Solange
 * `core/loop.js` kein `saisonWechsel()` exportiert, meldet es sauber, was fehlt,
 * statt abzustürzen – die Fehlerliste ist die Arbeitsliste.
 *
 * Gespielt wird ohne DOM: `advanceDay()` treibt die Welt, eigene Partien werden
 * über `simulateAiFixture()` + `applyResult()` abgehandelt (kein `simulateMatch`,
 * das wäre für 2.000 Partien zu langsam).
 *
 * Rückgabe: Exit-Code 1, sobald eine Zusicherung fehlschlägt oder mangels
 * vorhandener Funktion nicht prüfbar ist.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createNewGame, serialize } from '../src/core/state.js';
import * as loop from '../src/core/loop.js';
import { advanceDay, makeCtx, simulateAiFixture, applyResult, pokalWeiterlosen } from '../src/core/loop.js';
import { LEAGUES, LEAGUE_IDS, CUP } from '../src/data/leagues.js';
import { playerOverall } from '../src/engine/ratings.js';
import { round } from '../src/core/util.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');

/* ------------------------------------------------------------------ *
 *  Argumente
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const SCHNELL = args.includes('--schnell');
const saisonArg = args.find(a => a.startsWith('--saisons='));
const EIGENE_SEEDS = args.filter(a => /^\d+$/.test(a)).map(Number);

const SEEDS = EIGENE_SEEDS.length ? EIGENE_SEEDS : [7, 2024];
const seeds = SCHNELL ? SEEDS.slice(0, 1) : SEEDS;
const SAISONS = saisonArg ? Math.max(1, parseInt(saisonArg.split('=')[1], 10) || 3) : (SCHNELL ? 1 : 3);

const EIGENER_VEREIN = 'hsv';
const LIGA_GROESSE = 18;
const SPIELE_JE_LIGA = LIGA_GROESSE * (LIGA_GROESSE - 1);   // 306
const POKAL_FELD = CUP.teams;                               // 64
const KADER_MIN = 18, KADER_MAX = 32;
const ALTER_MAX = 42;
const SPIELSTAND_MAX = 15 * 1024 * 1024;
const OVR_VERFALL_MAX = 4;
const TORJAEGER_MIN = 10;
const TAGE_NOTBREMSE = 3000;

/* ------------------------------------------------------------------ *
 *  Mini-Testgerüst (Stil wie tools/test-transfers.js)
 * ------------------------------------------------------------------ */

const ZTITEL = {
  1: 'Jede Liga hat genau 18 Vereine',
  2: 'Kein Verein in zwei Ligen; club.leagueId == state.leagues',
  3: 'Auf- und Abstieg sind spiegelbildlich',
  4: 'Pokalfeld umfasst 64 Mannschaften, frisch ausgelost',
  5: 'Der Pokal erreicht das Finale (genau 1 Sieger)',
  6: 'Kein Spielplan wiederholt sich zwischen zwei Saisons',
  7: 'Alle Ligaspiele gespielt (306 je Liga), keine Altlasten',
  8: 'Kein Spieler älter als 42 unter Vertrag',
  9: 'Kadergrößen zwischen 18 und 32',
  10: 'Manager-Bilanz stimmt mit den eigenen Partien überein',
  11: 'Spielstand bleibt unter 15 MB',
  12: 'history.seasons und history.titel je ein Eintrag pro Saison',
  13: 'Keine NaN in Konten, Punkten, Attributen, Alter',
  14: 'Die Ligastärke der 1. Liga tropft nicht weg (max. −4)',
  15: 'Torschützenkönig existiert und hat mindestens 10 Tore'
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

/* ------------------------------------------------------------------ *
 *  Zugriffshelfer, die auch ohne state.leagues noch etwas liefern
 * ------------------------------------------------------------------ */

/** Vereine einer Liga – bevorzugt aus state.leagues, sonst aus club.leagueId. */
function ligaClubIds(state, ligaId) {
  const eintrag = state.leagues && state.leagues[ligaId];
  if (eintrag && Array.isArray(eintrag.clubIds) && eintrag.clubIds.length) return eintrag.clubIds.slice();
  const ausClubs = Object.values(state.clubs).filter(c => c.leagueId === ligaId).map(c => c.id);
  if (ausClubs.length) return ausClubs;
  return LEAGUES[ligaId].clubIds.slice();
}

const quelleDerWahrheit = state =>
  (state.leagues && state.leagues.bl1 && Array.isArray(state.leagues.bl1.clubIds))
    ? 'state.leagues' : 'club.leagueId (Rückfall)';

const kurz = (state, clubId) => {
  const c = state.clubs[clubId];
  return c ? (c.shortName || c.name || clubId) : String(clubId);
};

const liste = (state, ids) => (ids && ids.length) ? ids.map(id => kurz(state, id)).join(', ') : '–';

/** Alle Vereine, die einen echten Kader führen müssen (Profis + erweckte Amateure). */
const kaderpflichtig = state => Object.values(state.clubs).filter(c => !c.lazySquad);

function ligaOverall(state, ligaId) {
  const ids = ligaClubIds(state, ligaId);
  const werte = [];
  for (const cid of ids) {
    const club = state.clubs[cid];
    if (!club) continue;
    for (const pid of club.playerIds) {
      const p = state.players[pid];
      if (p && !p.retired) werte.push(playerOverall(p));
    }
  }
  return werte.length ? werte.reduce((a, b) => a + b, 0) / werte.length : 0;
}

/** Fingerabdruck eines Ligaspielplans: Reihenfolge der Paarungen je Spieltag. */
function spielplanSignatur(state, ligaId, saison) {
  return state.fixtures
    .filter(f => f.competitionId === ligaId && f.season === saison)
    .sort((a, b) => (a.matchday - b.matchday) || (a.id < b.id ? -1 : 1))
    .map(f => `${f.matchday}:${f.homeId}>${f.awayId}`)
    .join('|');
}

/** Fingerabdruck der Pokalauslosung (1. Runde). */
function pokalSignatur(state, saison) {
  const r1 = CUP.rounds[0].id;
  return state.fixtures
    .filter(f => f.competitionId === CUP.id && f.season === saison && f.round === r1)
    .map(f => `${f.homeId}>${f.awayId || 'freilos'}`)
    .sort()
    .join('|');
}

function pokalFeldGroesse(state, saison) {
  const r1 = CUP.rounds[0].id;
  const teams = new Set();
  let partien = 0;
  for (const f of state.fixtures) {
    if (f.competitionId !== CUP.id || f.season !== saison || f.round !== r1) continue;
    partien++;
    if (f.homeId) teams.add(f.homeId);
    if (f.awayId) teams.add(f.awayId);
  }
  return { teams: teams.size, partien };
}

function pokalFinale(state, saison) {
  const letzte = CUP.rounds[CUP.rounds.length - 1].id;
  const finals = state.fixtures.filter(
    f => f.competitionId === CUP.id && f.season === saison && f.round === letzte);
  if (finals.length !== 1) return { anzahl: finals.length, sieger: null, text: `${finals.length} Endspiele` };
  const f = finals[0];
  if (!f.played || !f.result || !Array.isArray(f.result.score)) {
    return { anzahl: 1, sieger: null, text: 'Finale nicht ausgetragen' };
  }
  const [h, a] = f.result.score;
  const sieger = h > a ? f.homeId : a > h ? f.awayId : null;
  return {
    anzahl: 1, sieger,
    text: sieger ? `${kurz(state, f.homeId)} ${h}:${a} ${kurz(state, f.awayId)}`
      : `Unentschieden ${h}:${a} – kein Sieger ermittelt`
  };
}

/** Der beste Torjäger der beiden Profiligen – vor dem Zurücksetzen der Statistik. */
function torjaegerMessen(state) {
  const ids = new Set([...ligaClubIds(state, 'bl1'), ...ligaClubIds(state, 'bl2')]);
  let best = null;
  for (const p of Object.values(state.players)) {
    if (!p.clubId || !ids.has(p.clubId)) continue;
    const tore = (p.stats && p.stats.season && p.stats.season.tore) || 0;
    if (!best || tore > best.tore) best = { playerId: p.id, name: p.name || p.id, tore };
  }
  return best || { playerId: null, name: '–', tore: 0 };
}

/* ------------------------------------------------------------------ *
 *  Die Zusicherungen, die zu jedem Zeitpunkt gelten müssen
 * ------------------------------------------------------------------ */

function pruefeLigastruktur(state, wann) {
  /* --- Z1: Ligagröße ---------------------------------------------------- */
  const groessen = LEAGUE_IDS.map(id => `${id} ${ligaClubIds(state, id).length}`).join(', ');
  const alleAchtzehn = LEAGUE_IDS.every(id => ligaClubIds(state, id).length === LIGA_GROESSE);
  z(1, alleAchtzehn, `${wann}: ${groessen} (Quelle: ${quelleDerWahrheit(state)})`);

  /* --- Z2: eine Wahrheit über die Zugehörigkeit ------------------------- */
  const probleme = [];
  if (!state.leagues) {
    probleme.push('state.leagues fehlt im Spielstand');
  } else {
    for (const id of LEAGUE_IDS) {
      const e = state.leagues[id];
      if (!e || !Array.isArray(e.clubIds)) { probleme.push(`state.leagues.${id} fehlt`); continue; }
      if (e.id !== undefined && e.id !== id) probleme.push(`state.leagues.${id}.id ist "${e.id}"`);
    }
  }

  const zuordnung = new Map();
  for (const id of LEAGUE_IDS) {
    for (const cid of ligaClubIds(state, id)) {
      if (zuordnung.has(cid)) {
        probleme.push(zuordnung.get(cid) === id
          ? `${cid} steht doppelt in ${id}`
          : `${cid} steht gleichzeitig in ${zuordnung.get(cid)} und ${id}`);
      } else zuordnung.set(cid, id);
      const club = state.clubs[cid];
      if (!club) probleme.push(`${cid} steht in ${id}, existiert aber nicht`);
      else if (club.leagueId !== id) probleme.push(`${cid}: club.leagueId="${club.leagueId}", Liga="${id}"`);
    }
  }
  for (const club of Object.values(state.clubs)) {
    if (!LEAGUE_IDS.includes(club.leagueId)) continue;
    if (zuordnung.get(club.id) !== club.leagueId) {
      probleme.push(`${club.id} trägt leagueId="${club.leagueId}", steht dort aber nicht im Kreis`);
    }
  }

  z(2, probleme.length === 0,
    probleme.length ? `${wann}: ${probleme.length} Widerspruch/Widersprüche – ${probleme.slice(0, 3).join(' · ')}`
      : `${wann}: ${zuordnung.size} Vereine eindeutig zugeordnet`);
}

function pruefeAlterUndKader(state, wann) {
  /* --- Z8: Altersgrenze -------------------------------------------------- */
  const zuAlt = [];
  let aeltester = { alter: 0, name: '–' };
  for (const p of Object.values(state.players)) {
    if (!p.clubId || p.retired) continue;
    const alter = p.age;
    if (typeof alter === 'number' && alter > aeltester.alter) aeltester = { alter, name: p.name || p.id };
    if (typeof alter === 'number' && alter > ALTER_MAX) zuAlt.push(`${p.name || p.id} (${alter})`);
  }
  z(8, zuAlt.length === 0,
    zuAlt.length ? `${wann}: ${zuAlt.length} über ${ALTER_MAX} – ${zuAlt.slice(0, 3).join(', ')}`
      : `${wann}: ältester Profi ${aeltester.name}, ${aeltester.alter} Jahre`);

  /* --- Z9: Kadergrößen --------------------------------------------------- */
  const vereine = kaderpflichtig(state);
  let min = Infinity, max = 0;
  const ausreisser = [];
  for (const c of vereine) {
    const n = c.playerIds.length;
    if (n < min) min = n;
    if (n > max) max = n;
    if (n < KADER_MIN || n > KADER_MAX) ausreisser.push(`${c.id} ${n}`);
  }
  if (!vereine.length) { min = 0; max = 0; }
  z(9, ausreisser.length === 0,
    ausreisser.length ? `${wann}: Spanne ${min}–${max}, ${ausreisser.length} Ausreißer – ${ausreisser.slice(0, 4).join(', ')}`
      : `${wann}: Spanne ${min}–${max} bei ${vereine.length} Vereinen`);

  return { kaderMin: min, kaderMax: max };
}

const ZAHL_OK = v => typeof v !== 'number' || Number.isFinite(v);

function pruefeKeineNaN(state, wann) {
  const treffer = [];
  const pruef = (wert, wo) => { if (!ZAHL_OK(wert)) treffer.push(wo); };

  for (const c of Object.values(state.clubs)) {
    const f = c.finances || {};
    pruef(f.balance, `${c.id}.finances.balance`);
    pruef(f.debt, `${c.id}.finances.debt`);
    pruef(f.transferBudget, `${c.id}.finances.transferBudget`);
    pruef(f.wageBudget, `${c.id}.finances.wageBudget`);
    const s = c.season || {};
    pruef(s.punkte, `${c.id}.season.punkte`);
    pruef(s.tore, `${c.id}.season.tore`);
    pruef(s.gegentore, `${c.id}.season.gegentore`);
    pruef(c.reputation, `${c.id}.reputation`);
  }

  for (const ligaId of Object.keys(state.tables || {})) {
    for (const zeile of state.tables[ligaId] || []) {
      pruef(zeile.punkte, `tables.${ligaId}.${zeile.clubId}.punkte`);
      pruef(zeile.tore, `tables.${ligaId}.${zeile.clubId}.tore`);
      pruef(zeile.gegentore, `tables.${ligaId}.${zeile.clubId}.gegentore`);
      pruef(zeile.diff, `tables.${ligaId}.${zeile.clubId}.diff`);
    }
  }

  for (const p of Object.values(state.players)) {
    pruef(p.age, `${p.id}.age`);
    pruef(p.form, `${p.id}.form`);
    pruef(p.morale, `${p.id}.morale`);
    pruef(p.fitness, `${p.id}.fitness`);
    if (p.attributes) {
      for (const k in p.attributes) pruef(p.attributes[k], `${p.id}.attributes.${k}`);
    }
    if (p.contract) {
      pruef(p.contract.salary, `${p.id}.contract.salary`);
      pruef(p.contract.bis, `${p.id}.contract.bis`);
    }
  }

  const m = state.manager || {};
  for (const k in (m.bilanz || {})) pruef(m.bilanz[k], `manager.bilanz.${k}`);
  for (const k in (m.skills || {})) pruef(m.skills[k], `manager.skills.${k}`);
  pruef(m.erfahrung, 'manager.erfahrung');
  pruef(m.level, 'manager.level');
  pruef(m.reputation, 'manager.reputation');

  z(13, treffer.length === 0,
    treffer.length ? `${wann}: ${treffer.length} NaN/Infinity – ${treffer.slice(0, 4).join(', ')}`
      : `${wann}: alle geprüften Zahlenfelder endlich`);
}

/**
 * Alle Zusicherungen, die zu jedem beliebigen Zeitpunkt gelten müssen – am
 * Anpfiff, am Saisonende und nach jedem Wechsel. Bewusst auch dann aufgerufen,
 * wenn saisonWechsel() noch fehlt: sonst stünden Z8, Z9 und Z13 ungeprüft da.
 */
function zustandspruefung(state, wann) {
  pruefeLigastruktur(state, wann);
  const kader = pruefeAlterUndKader(state, wann);
  pruefeKeineNaN(state, wann);
  return kader;
}

/* ------------------------------------------------------------------ *
 *  Eine Saison durchspielen
 * ------------------------------------------------------------------ */

async function saisonSpielen(state) {
  const protokoll = { eigeneSpiele: 0, entlassungen: 0, schritte: 0, fehler: [] };

  // Modulfehler einsammeln, statt sie im Rauschen der Konsole zu verlieren.
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
        // Ein Rauswurf beendet im Spiel die Karriere. Der Prüfstand braucht aber
        // drei volle Saisons – also weitermachen und den Vorfall melden.
        protokoll.entlassungen++;
        state.flags.entlassen = false;
      } else if (res.stop === 'post') {
        for (const m of state.inbox) if (!m.gelesen && m.day === state.date.day) m.gelesen = true;
      }

      try { pokalWeiterlosen(state, makeCtx(state)); }
      catch (err) { protokoll.fehler.push(`Pokalauslosung: ${err && err.message}`); }
    }
  } finally {
    console.error = echtesError;
  }

  protokoll.fehler.push(`Notbremse: ${TAGE_NOTBREMSE} Schritte ohne Saisonende (Tag ${state.date.day})`);
  return protokoll;
}

/* ------------------------------------------------------------------ *
 *  Vorprüfung: Existiert überhaupt, was Stufe 1 verspricht?
 * ------------------------------------------------------------------ */

const KARRIERE_EXPORTE = [
  'karriereenden', 'regenerieren', 'managerSaison', 'titelChronik', 'elfDerSaison', 'spielerDerSaison'
];

const BERICHT_FELDER = [
  'season', 'tabellen', 'meister', 'pokalsieger', 'aufsteiger', 'absteiger', 'relegation',
  'torschuetzenkoenig', 'elfDerSaison', 'eigenerPlatz', 'eigeneLiga', 'ruecktritte',
  'neueTalente', 'manager', 'vorstandsurteil', 'praemien'
];

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  TRAUMVEREIN – Saisonwechsel-Prüfstand (Roadmap-Stufe 1)     ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`  Seeds: ${seeds.join(', ')} · Saisons je Seed: ${SAISONS} · Verein: ${EIGENER_VEREIN}`);

abschnitt('A) Vorprüfung: sind die vereinbarten Schnittstellen da?');

const saisonWechsel = typeof loop.saisonWechsel === 'function' ? loop.saisonWechsel : null;
if (saisonWechsel) OK('core/loop.js exportiert saisonWechsel(state, ctx)');
else S('core/loop.js exportiert kein saisonWechsel(state, ctx) – der Saisonwechsel steht noch in main.js');

const karrierePfad = resolve(WURZEL, 'src/club/karriere.js');
let karriere = null;
if (!existsSync(karrierePfad)) {
  S('src/club/karriere.js fehlt (Karriereenden, Regenerierung, Managerkarriere, Titelchronik)');
} else {
  try {
    karriere = await import(pathToFileURL(karrierePfad).href);
    const fehlend = KARRIERE_EXPORTE.filter(n => typeof karriere[n] !== 'function');
    if (fehlend.length) S(`src/club/karriere.js: es fehlen die Exporte ${fehlend.join(', ')}`);
    else OK('src/club/karriere.js exportiert alle sechs vereinbarten Funktionen');
  } catch (err) {
    S(`src/club/karriere.js lässt sich nicht laden: ${err && err.message}`);
  }
}

{
  const quelle = readFileSync(resolve(WURZEL, 'src/core/state.js'), 'utf8');
  if (/\bstate\.leagues\b|\bleagues\s*:/.test(quelle)) OK('core/state.js kennt das Feld leagues');
  else S('core/state.js legt kein state.leagues an – die Ligazugehörigkeit hängt noch an data/leagues.js');
}

/* ------------------------------------------------------------------ *
 *  Der eigentliche Lauf
 * ------------------------------------------------------------------ */

const uebersicht = [];
const gestartet = Date.now();

for (const seed of seeds) {
  abschnitt(`B) Spielstand Seed ${seed}`);
  const t0 = Date.now();

  const state = createNewGame({
    clubId: EIGENER_VEREIN, managerName: 'Testtrainer', difficulty: 'profi', seed
  });

  const startOvr = ligaOverall(state, 'bl1');
  const spielplaene = {};      // ligaId -> [signatur je Saison]
  const pokalLose = [];
  for (const id of LEAGUE_IDS) spielplaene[id] = [];

  unterpunkt(`Anpfiff: 1. Liga im Schnitt ${nz(startOvr)} Overall, Spielstand ${mb(serialize(state).length)}`);
  zustandspruefung(state, 'Anpfiff');

  let eigeneSpieleGesamt = 0;
  let letzteSaisonGespielt = 0;
  let abbruch = null;

  for (let saison = 1; saison <= SAISONS; saison++) {
    unterpunkt(`— Saison ${saison} —`);

    const lauf = await saisonSpielen(state);
    eigeneSpieleGesamt += lauf.eigeneSpiele;
    letzteSaisonGespielt = saison;

    if (lauf.entlassungen) H(`Saison ${saison}: ${lauf.entlassungen}× entlassen – für den Prüflauf ignoriert`);
    for (const f of lauf.fehler.slice(0, 5)) H(`Saison ${saison}: ${f}`);
    if (lauf.fehler.length > 5) H(`Saison ${saison}: … und ${lauf.fehler.length - 5} weitere Modulfehler`);

    /* --- Z7: Ligaspiele vollständig ------------------------------------ */
    const ligaBericht = [];
    let ligaOk = true;
    for (const id of LEAGUE_IDS) {
      const fx = state.fixtures.filter(f => f.competitionId === id && f.season === saison);
      const offen = fx.filter(f => !f.played).length;
      ligaBericht.push(`${id} ${fx.length - offen}/${fx.length}`);
      if (fx.length !== SPIELE_JE_LIGA || offen !== 0) ligaOk = false;
    }
    const altlasten = state.fixtures.filter(f => !f.played && f.season < saison).length;
    if (altlasten) ligaOk = false;
    z(7, ligaOk, `Saison ${saison}: ${ligaBericht.join(', ')} (Soll ${SPIELE_JE_LIGA}), Altlasten aus Vorsaisons: ${altlasten}`);

    /* --- Z4: Pokalfeld --------------------------------------------------- */
    const feld = pokalFeldGroesse(state, saison);
    const losung = pokalSignatur(state, saison);
    const schonDagewesen = pokalLose.indexOf(losung);
    pokalLose.push(losung);
    z(4, feld.teams === POKAL_FELD && (schonDagewesen === -1 || losung === ''),
      `Saison ${saison}: ${feld.teams} Mannschaften in ${feld.partien} Partien der 1. Runde` +
      (schonDagewesen >= 0 ? `, Auslosung identisch mit Saison ${schonDagewesen + 1}` : ', Auslosung neu'));

    /* --- Z5: Finale ------------------------------------------------------ */
    const finale = pokalFinale(state, saison);
    z(5, finale.anzahl === 1 && !!finale.sieger, `Saison ${saison}: ${finale.text}`);

    /* --- Z6: Spielpläne -------------------------------------------------- */
    let planOk = true;
    const planText = [];
    for (const id of LEAGUE_IDS) {
      const sig = spielplanSignatur(state, id, saison);
      const idx = spielplaene[id].indexOf(sig);
      if (!sig) { planOk = false; planText.push(`${id}: kein Spielplan`); }
      else if (idx >= 0) { planOk = false; planText.push(`${id}: identisch mit Saison ${idx + 1}`); }
      else planText.push(`${id}: neu`);
      spielplaene[id].push(sig);
    }
    if (saison === 1) z(6, planOk, `Saison ${saison}: ${planText.join(', ')} (erster Plan, Vergleich folgt)`);
    else z(6, planOk, `Saison ${saison}: ${planText.join(', ')}`);

    /* --- Zustand am letzten Spieltag ------------------------------------- */
    let kader = zustandspruefung(state, `Ende Saison ${saison}`);

    /* --- Torjäger vor dem Zurücksetzen der Statistik --------------------- */
    const gemessenerTorjaeger = torjaegerMessen(state);

    /* --- Zustand vor dem Wechsel merken ---------------------------------- */
    const ligaVorher = new Map();
    for (const id of LEAGUE_IDS) for (const cid of ligaClubIds(state, id)) ligaVorher.set(cid, id);

    /* --- Der Saisonwechsel ---------------------------------------------- */
    if (!saisonWechsel) {
      zoffen(3, 'saisonWechsel() fehlt');
      zoffen(15, 'saisonWechsel() fehlt – bester Ligatorjäger gemessen: ' +
        `${gemessenerTorjaeger.name}, ${gemessenerTorjaeger.tore} Tore`);
      abbruch = 'core/loop.js exportiert kein saisonWechsel() – weitere Saisons nicht spielbar';
      break;
    }

    let bericht = null;
    try {
      bericht = await saisonWechsel(state, makeCtx(state));
    } catch (err) {
      S(`Saison ${saison}: saisonWechsel() ist gescheitert – ${err && err.message}`);
      abbruch = `saisonWechsel() wirft: ${err && err.message}`;
      zoffen(3, 'saisonWechsel() gescheitert');
      zoffen(15, 'saisonWechsel() gescheitert');
      break;
    }

    if (!bericht || typeof bericht !== 'object') {
      S(`Saison ${saison}: saisonWechsel() liefert keinen Bericht`);
      bericht = {};
    } else {
      const fehlend = BERICHT_FELDER.filter(f => bericht[f] === undefined);
      if (fehlend.length) S(`Saison ${saison}: im Bericht fehlen die Felder ${fehlend.join(', ')}`);
    }

    /* --- Z15: Torschützenkönig ------------------------------------------ */
    const tk = bericht.torschuetzenkoenig;
    const tkTore = tk && typeof tk.tore === 'number' ? tk.tore : -1;
    const tkName = tk && tk.playerId && state.players[tk.playerId]
      ? (state.players[tk.playerId].name || tk.playerId) : (tk && tk.playerId) || '–';
    z(15, !!(tk && tk.playerId) && tkTore >= TORJAEGER_MIN,
      `Saison ${saison}: ${tkName} mit ${tkTore < 0 ? 'ohne Angabe' : tkTore + ' Toren'}` +
      ` (selbst gemessener Bestwert: ${gemessenerTorjaeger.name}, ${gemessenerTorjaeger.tore})`);

    /* --- Z3: Auf- und Abstieg spiegelbildlich ---------------------------- */
    const runter = [], rauf = [];
    for (const [cid, alt] of ligaVorher) {
      const neu = state.clubs[cid] ? state.clubs[cid].leagueId : null;
      if (alt === 'bl1' && neu === 'bl2') runter.push(cid);
      if (alt === 'bl2' && neu === 'bl1') rauf.push(cid);
    }
    const gemeldetAb = Array.isArray(bericht.absteiger) ? bericht.absteiger.length : -1;
    const gemeldetAuf = Array.isArray(bericht.aufsteiger) ? bericht.aufsteiger.length : -1;
    z(3, runter.length > 0 && runter.length === rauf.length && gemeldetAb === gemeldetAuf,
      `Saison ${saison}: ${runter.length} runter (${liste(state, runter)}), ` +
      `${rauf.length} rauf (${liste(state, rauf)}), Bericht meldet ${gemeldetAb} Absteiger / ${gemeldetAuf} Aufsteiger`);

    /* --- Struktur nach dem Wechsel --------------------------------------- */
    kader = zustandspruefung(state, `nach dem Wechsel ${saison}→${saison + 1}`);

    /* --- Kurzübersicht ---------------------------------------------------- */
    const groesse = serialize(state).length;
    const ruecktritte = Array.isArray(bericht.ruecktritte) ? bericht.ruecktritte.length : 0;
    const talente = Array.isArray(bericht.neueTalente) ? bericht.neueTalente.length : 0;
    console.log(
      `      Meister: ${bericht.meister ? kurz(state, bericht.meister) : '?'}` +
      ` · Pokalsieger: ${bericht.pokalsieger ? kurz(state, bericht.pokalsieger) : (finale.sieger ? kurz(state, finale.sieger) + ' (gemessen)' : '?')}` +
      ` · eigener Platz: ${bericht.eigenerPlatz === undefined ? '?' : bericht.eigenerPlatz}` +
      ` in ${bericht.eigeneLiga || state.clubs[EIGENER_VEREIN].leagueId}`);
    console.log(
      `      Aufsteiger: ${liste(state, bericht.aufsteiger)} · Absteiger: ${liste(state, bericht.absteiger)}` +
      ` · Relegation: ${bericht.relegation ? (bericht.relegation.sieger ? kurz(state, bericht.relegation.sieger) : 'ohne Sieger') : '–'}`);
    console.log(
      `      Rücktritte: ${ruecktritte} · neue Talente: ${talente} · Kader ${kader.kaderMin}–${kader.kaderMax}` +
      ` · Spielstand ${mb(groesse)}`);
  }

  /* --- Zusicherungen am Ende des Spielstands --------------------------- */
  unterpunkt('— Bilanz des Spielstands —');

  const gespielteEigene = state.fixtures.filter(
    f => f.played && !f.freilos && (f.homeId === EIGENER_VEREIN || f.awayId === EIGENER_VEREIN)).length;
  const bilanz = (state.manager && state.manager.bilanz) || {};
  const summeErgebnisse = (bilanz.siege || 0) + (bilanz.unentschieden || 0) + (bilanz.niederlagen || 0);
  z(10, bilanz.spiele === eigeneSpieleGesamt && summeErgebnisse === eigeneSpieleGesamt,
    `manager.bilanz.spiele = ${bilanz.spiele}, selbst ausgetragen = ${eigeneSpieleGesamt}` +
    `, S/U/N-Summe = ${summeErgebnisse} (davon noch als Fixture im Spielstand: ${gespielteEigene})`);

  const groesse = serialize(state).length;
  z(11, groesse < SPIELSTAND_MAX, `${mb(groesse)} nach ${letzteSaisonGespielt} Saison(s) (Grenze ${mb(SPIELSTAND_MAX)})`);

  if (abbruch) {
    zoffen(12, abbruch);
    zoffen(14, abbruch);
  } else {
    const seasons = (state.history && Array.isArray(state.history.seasons)) ? state.history.seasons.length : -1;
    const titel = (state.history && state.history.titel && typeof state.history.titel === 'object')
      ? Object.keys(state.history.titel).length : -1;
    z(12, seasons === SAISONS && titel === SAISONS,
      `history.seasons = ${seasons}, history.titel = ${titel} (Soll je ${SAISONS})`);

    const endOvr = ligaOverall(state, 'bl1');
    z(14, (startOvr - endOvr) <= OVR_VERFALL_MAX,
      `1. Liga ${nz(startOvr)} → ${nz(endOvr)} Overall (Verfall ${nz(startOvr - endOvr)}, erlaubt ${OVR_VERFALL_MAX})`);
  }

  const dauer = Date.now() - t0;
  uebersicht.push({ seed, saisons: letzteSaisonGespielt, eigene: eigeneSpieleGesamt, groesse, dauer, abbruch });
  console.log(`    Laufzeit: ${(dauer / 1000).toFixed(1)} s`);

  if (abbruch) {
    console.log(`    Abbruch nach Saison ${letzteSaisonGespielt}: ${abbruch}`);
  }
}

/* ------------------------------------------------------------------ *
 *  Übersicht
 * ------------------------------------------------------------------ */

abschnitt('C) Durchläufe');
for (const u of uebersicht) {
  console.log(`  Seed ${String(u.seed).padStart(5)} · ${u.saisons} Saison(s) · ` +
    `${u.eigene} eigene Partien · ${mb(u.groesse)} · ${(u.dauer / 1000).toFixed(1)} s` +
    (u.abbruch ? '  [abgebrochen]' : ''));
}

abschnitt('D) Zusicherungen');
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

abschnitt('E) Ergebnis');
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
if (!hart) console.log('Die Saison schließt sich. Der Prüfstand ist zufrieden – das kommt selten vor.');
process.exit(hart ? 1 : 0);
