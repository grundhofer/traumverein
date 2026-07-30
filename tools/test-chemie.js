/**
 * tools/test-chemie.js – Der Prüfstand für „Kabine und Karriere" (Roadmap-Stufe 4).
 *
 *   node tools/test-chemie.js                 # Standardlauf, Seed 7, 3 Saisons
 *   node tools/test-chemie.js 11 42           # eigene Seeds (nur der erste treibt die Saisonläufe)
 *   node tools/test-chemie.js --schnell       # nur 1 Saison, weniger Partien im Engine-Test
 *   node tools/test-chemie.js --saisons=5     # längerer Lauf
 *
 * ---------------------------------------------------------------------------
 *  WOZU
 * ---------------------------------------------------------------------------
 * TRAUMVEREIN hat einen Einfall, den kein anderer Manager hat: Vereinslegenden
 * und aktuelle Spieler in einer Elf, mit Chemie als Preis dafür. Bis Stufe 3 ist
 * das eine Startaufstellung. Erst wenn die Eingespieltheit WÄCHST, wenn Zugänge
 * sie KOSTEN, wenn Mentoren die Entwicklung HEBEN und wenn all das in der Engine
 * ANKOMMT, wird daraus ein Spielprinzip.
 *
 * Dieser Prüfstand entsteht bewusst VOR der Mechanik. Er stürzt nicht ab, wenn
 * ein Modul fehlt – er meldet, WAS fehlt. Die Fehlerliste ist die Arbeitsliste.
 *
 * ---------------------------------------------------------------------------
 *  DER VERTRAG, GEGEN DEN HIER GEPRÜFT WIRD
 * ---------------------------------------------------------------------------
 * Die Bauagenten dürfen sich auf genau diese Namen verlassen. Wo der Prüfstand
 * beides akzeptiert (neu ODER Rückfall auf heute), steht es dabei.
 *
 * NEUES MODUL  `src/club/chemie.js`
 * ---------------------------------
 *   export function tickChemie(state, ctx)
 *        Tagesroutine im Muster der übrigen club/-Module
 *        (ctx = { rng, day, isMatchday, log }). Lässt die Eingespieltheit
 *        wachsen, verrechnet Fluktuation, Konflikte und die Sommerpause.
 *
 *   export function chemieWert(state, clubId, playerIds = null) -> 0..100
 *        Eingespieltheit eines Vereins bzw. – mit playerIds – einer Elf.
 *        MUSS für JEDEN Verein einen Wert liefern (KI-Vereine über den
 *        Vereinsmittelwert, kein paarweises Gitter).
 *
 *   export function paarChemie(state, aId, bId) -> 0..100
 *        Paarweise Eingespieltheit. Nur für den Verein des Spielers gepflegt
 *        (Spielstandbudget!), für alle anderen aus dem Vereinsmittel abgeleitet.
 *
 *   export function einsatzVerbuchen(state, clubId, playerIds, minuten, ctx)
 *        Gemeinsame Einsatzminuten einer Startelf verbuchen. Aufrufer:
 *        core/loop.js:applyResult().
 *
 *   export function mentorPaareBilden(state, clubId, ctx) -> [Mentorenpaar]
 *        Deterministisch aus ctx.rng. Paarung nach Position, Nationalität,
 *        Persönlichkeit und Hierarchie (morale.js:hierarchie/beziehungen).
 *   export function mentorPaare(state, clubId) -> [Mentorenpaar]
 *        Mentorenpaar = { mentorId, talentId, staerke: 0..100, text }
 *   export function mentorSetzen(state, talentId, mentorId) -> { ok, text }
 *
 *   export function cliquen(state, clubId) -> [Clique]
 *        Clique = { id, art: 'nation'|'aera'|'alter'|'vergangenheit',
 *                   playerIds: [..], staerke: 0..100, text }
 *        Größe 2..8, kein Spieler in mehr als 3 Cliquen, deterministisch.
 *
 *   export function chemieBericht(state, clubId) -> { text, zeilen }
 *        Deutscher Kabinentext für den Kaderbildschirm.
 *
 * SPIELSTAND-FELDER
 * -----------------
 *   club.chemistryHistory : 0..100
 *        BLEIBT der Leitwert. `core/loop.js:buildMatchTeam` reicht ihn als
 *        `matchTeam.chemistryHistory` durch, `engine/ratings.js:chemistry()`
 *        liest ihn über `tactics.chemistryHistory`. Die Engine muss NICHT
 *        angefasst werden – aber der Wert muss sich endlich bewegen.
 *   club.chemie = { paare: { "pidA|pidB": 0..100 },   // nur state.managerClubId
 *                   mentoren: [Mentorenpaar],
 *                   cliquen: [Clique],
 *                   stand: { saison, tag } }
 *   player.mentor  = { mentorId, seit: { season, day } } | null
 *   player.mentees = [playerId]
 *
 * ERWEITERUNG  `src/club/training.js`
 * -----------------------------------
 *   entwicklung(state, playerId, ctx) muss einen Mentorenfaktor anwenden und
 *   ihn in `.faktoren.mentor` ausweisen (1 = kein Mentor, >1 = gefördert).
 *
 * OPTIONALES MODUL  `src/club/national.js`  (Roadmap-Stufe 4, Punkt 4)
 * --------------------------------------------------------------------
 *   export function nationalkader(state, nation) -> [playerId]
 *   export function berufungen(state, ctx) -> [{ nation, playerIds }]
 *   export function tickNational(state, ctx)
 *   state.national = { kader: { [nation]: [playerId] }, ... }
 *   Fehlt das Modul, meldet Z09 „nicht prüfbar" – kein Absturz.
 *
 * ---------------------------------------------------------------------------
 * Rückgabe: Exit-Code 1, sobald eine Zusicherung fehlschlägt oder mangels
 * vorhandener Funktion nicht prüfbar ist.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createNewGame, serialize, squadOf } from '../src/core/state.js';
import * as loop from '../src/core/loop.js';
import { advanceDay, makeCtx, simulateAiFixture, applyResult, pokalWeiterlosen, buildMatchTeam } from '../src/core/loop.js';
import { quickSimulate } from '../src/engine/match.js';
import { chemistry, teamStrength, playerOverall } from '../src/engine/ratings.js';
import { autoLineup, FORMATIONS } from '../src/engine/tactics.js';
import { entwicklung } from '../src/club/training.js';
import { spielerVerpflichten, spielerVerkaufen, marktGehalt } from '../src/club/transfers.js';
import { hierarchie, beziehungen } from '../src/club/morale.js';
import { createRng } from '../src/core/rng.js';
import { round, deepClone, clamp } from '../src/core/util.js';

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
const SEED = SEEDS[0];
const ZWEITSEED = SEEDS[1] !== undefined ? SEEDS[1] : SEED + 1;
const SAISONS = saisonArg ? Math.max(1, parseInt(saisonArg.split('=')[1], 10) || 3) : (SCHNELL ? 1 : 3);

const EIGENER_VEREIN = 'hsv';
const TAGE_NOTBREMSE = 3000;

/* --- Schwellen, gegen die gemessen wird ---------------------------- */
const ANSTIEG_MIN        = 10;      // Z01 unveränderte Elf, eine Saison
const ZUGANG_ABSTAND_MIN = 8;       // Z02 Kontrollverein minus Zugangsverein
const NEUZUGAENGE        = 5;       // Z02
const MENTOR_OVR_MIN     = 1.0;     // Z03 Overall-Vorsprung nach zwei Saisons
const AERA_ABSTAND_MIN   = 2;       // Z04 gemischt schlechter als homogen
const AERA_AUFHOLEN_MIN  = 4;       // Z04 Aufholen über Eingespieltheit
const CLIQUE_MIN         = 2;       // Z05
const CLIQUE_MAX         = 8;       // Z05
const CLIQUEN_JE_SPIELER = 3;       // Z05
const SPIELSTAND_MAX     = 15 * 1024 * 1024;
const SPIELSTAND_BASIS   = 12.5 * 1024 * 1024;   // heutiger Stand nach drei Saisons
const ENGINE_PARTIEN     = SCHNELL ? 250 : 800;  // je Chemie-Stufe
// Kalibriert am heutigen Stand: gegen einen gleich starken Gegner ist ein
// Chemiepunkt rund 0,013 Punkte je Spiel wert (der Lauf rechnet es unten
// nochmals vor). 12 Chemiepunkte zwischen „fremd" und „eingespielt" sind das
// Mindestmaß, damit die Eingespieltheit über 34 Spieltage einen Platz bewegt.
const ENGINE_PUNKTE_MIN  = 0.08;    // Z08 Punkte je Spiel
const ENGINE_CHEMIE_MIN  = 12;      // Z08 Chemiepunkte zwischen Eingespieltheit 5 und 95
const TRAININGSWOCHEN    = 44;      // eine Saison Training

/* ------------------------------------------------------------------ *
 *  Mini-Testgerüst (Stil wie tools/test-saison.js)
 * ------------------------------------------------------------------ */

const ZTITEL = {
  1:  'Unveränderte Elf steigert die Eingespieltheit über eine Saison',
  2:  'Fünf Neuzugänge senken sie – gemessen gegen einen Kontrollverein',
  3:  'Mentorenpaare heben die Entwicklungskurve des Talents',
  4:  'Ära-Mischung startet schlechter und holt über Spielzeit auf',
  5:  'Cliquen entstehen und sind plausibel (Größe 2–8, max. 3 je Spieler)',
  6:  'Chemie bleibt in 0..100, keine NaN, kein Weglaufen über drei Saisons',
  7:  'Spielstand bleibt unter 15 MB – mit der neuen Chemie',
  8:  'Die Eingespieltheit ist in der Engine als Punktedifferenz messbar',
  9:  'Nationalmannschaft: Berufungen, Fitnesskosten, keine Verletzten',
  10: 'Deterministisch: gleicher Seed, gleiche Mentoren und Cliquen'
};

const zstat = {};
for (const nr of Object.keys(ZTITEL)) zstat[nr] = { ok: 0, fehl: 0, offen: 0, meldungen: [] };

const strukturFehler = [];
const hinweise = [];

function z(nr, bedingung, ist) {
  const e = zstat[nr];
  const txt = `Z${String(nr).padStart(2)}  ${ZTITEL[nr]}`;
  if (bedingung) { e.ok++; console.log(`    [ok]   ${txt}\n           ist: ${ist}`); }
  else { e.fehl++; e.meldungen.push(ist); console.log(`    [FEHL] ${txt}\n           ist: ${ist}`); }
}

function zoffen(nr, grund) {
  const e = zstat[nr];
  e.offen++; e.meldungen.push('nicht prüfbar: ' + grund);
  console.log(`    [ ?  ] Z${String(nr).padStart(2)}  ${ZTITEL[nr]}\n           nicht prüfbar: ${grund}`);
}

function S(text) { strukturFehler.push(text); console.log(`    [FEHL] ${text}`); }
function H(text) { hinweise.push(text); console.log(`    [hinw] ${text}`); }
function OK(text) { console.log(`    [ok]   ${text}`); }
function I(text) { console.log(`           ${text}`); }

function abschnitt(titel) { console.log('\n=== ' + titel + ' ==='); }
function unterpunkt(titel) { console.log('  ' + titel); }

const mb = b => (b / 1048576).toFixed(2).replace('.', ',') + ' MB';
const nz = (v, n = 1) => (Number.isFinite(v) ? round(v, n).toFixed(n) : String(v)).replace('.', ',');
const kurz = (state, id) => { const c = state.clubs[id]; return c ? (c.shortName || c.name || id) : String(id); };
const spn = p => p ? (p.shortName || p.lastName || p.id) : '–';

/* ------------------------------------------------------------------ *
 *  Anschluss an das (noch zu bauende) Chemie-Modul
 * ------------------------------------------------------------------ */

let chemie = null;             // src/club/chemie.js, falls vorhanden
let national = null;           // src/club/national.js, falls vorhanden
let nationalPfad = null;

/** Eingespieltheit eines Vereins – neuer Weg, sonst Rückfall auf heute. */
function eingespieltheit(state, clubId) {
  if (chemie && typeof chemie.chemieWert === 'function') {
    try {
      const w = chemie.chemieWert(state, clubId);
      if (Number.isFinite(w)) return w;
    } catch (err) { /* Rückfall unten */ }
  }
  const c = state.clubs[clubId];
  return c && Number.isFinite(c.chemistryHistory) ? c.chemistryHistory : NaN;
}

/** Woher der gemessene Wert stammt – gehört in jede Meldung. */
const chemieQuelle = () =>
  (chemie && typeof chemie.chemieWert === 'function') ? 'chemie.chemieWert()' : 'club.chemistryHistory';

/* ------------------------------------------------------------------ *
 *  Eine Saison durchspielen (identisch zu tools/test-saison.js)
 * ------------------------------------------------------------------ */

async function saisonSpielen(state) {
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
    }
  } finally {
    console.error = echtesError;
  }

  protokoll.fehler.push(`Notbremse: ${TAGE_NOTBREMSE} Schritte ohne Saisonende (Tag ${state.date.day})`);
  return protokoll;
}

/* ------------------------------------------------------------------ *
 *  Kleine Helfer
 * ------------------------------------------------------------------ */

const kaderSignatur = (state, clubId) =>
  (state.clubs[clubId].playerIds || []).slice().sort().join(',');

/** Summe aller Attributpunkte – feiner auflösend als der Overall. */
function attrSumme(p) {
  let s = 0;
  for (const k in (p.attributes || {})) s += p.attributes[k];
  return s;
}

/** Alle Chemiewerte eines Spielstands einsammeln (Verein + ggf. Paare). */
function alleChemiewerte(state) {
  const werte = [];
  for (const id in state.clubs) {
    const c = state.clubs[id];
    werte.push({ wo: `${id}.chemistryHistory`, wert: c.chemistryHistory });
    const paare = c.chemie && c.chemie.paare;
    if (paare && typeof paare === 'object') {
      for (const k in paare) werte.push({ wo: `${id}.chemie.paare.${k}`, wert: paare[k] });
    }
  }
  return werte;
}

/** Eine Elf aus einer Spielerliste bauen – Formation 4-4-2, Kapitän gesetzt. */
function elfAufstellen(elf) {
  const t = autoLineup(elf, null, {});
  const gefuellt = t && t.lineup && Object.values(t.lineup).filter(Boolean).length === 11;
  if (gefuellt) {
    t.setPieces = Object.assign({}, t.setPieces, {
      kapitaen: (t.setPieces && t.setPieces.kapitaen) || elf[0].id
    });
    return t;
  }
  // Rückfall: stur der Reihe nach in ein 4-4-2 stellen.
  const f = FORMATIONS['4-4-2'];
  const lineup = {};
  f.slots.forEach((sl, i) => { if (elf[i]) lineup[sl.id] = elf[i].id; });
  return {
    formation: '4-4-2', style: 'ausgeglichen', lineup, bench: [], roles: {},
    sliders: { tempo: 50, breite: 50, pressinghoehe: 50, risiko: 50, haerte: 50, offensivdrang: 50 },
    setPieces: { kapitaen: elf[0].id }, instructions: {}
  };
}

/* ================================================================== *
 *  Los geht's
 * ================================================================== */

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  TRAUMVEREIN – Chemie-Prüfstand (Roadmap-Stufe 4)            ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`  Seed: ${SEED} (Gegenprobe ${ZWEITSEED}) · Saisons: ${SAISONS} · Verein: ${EIGENER_VEREIN}`);
console.log('  „Das ist die Stufe, in der aus dem Einfall ein Spielprinzip wird."');

const gestartet = Date.now();

/* ------------------------------------------------------------------ *
 *  A) Vorprüfung: existiert, was der Vertrag oben verspricht?
 * ------------------------------------------------------------------ */

abschnitt('A) Vorprüfung: sind die vereinbarten Schnittstellen da?');

const CHEMIE_EXPORTE = [
  'tickChemie', 'chemieWert', 'paarChemie', 'einsatzVerbuchen',
  'mentorPaareBilden', 'mentorPaare', 'mentorSetzen', 'cliquen', 'chemieBericht'
];

const chemiePfad = resolve(WURZEL, 'src/club/chemie.js');
if (!existsSync(chemiePfad)) {
  S('src/club/chemie.js fehlt – Eingespieltheit, Mentoren und Cliquen haben noch kein Zuhause');
} else {
  try {
    chemie = await import(pathToFileURL(chemiePfad).href);
    const fehlend = CHEMIE_EXPORTE.filter(n => typeof chemie[n] !== 'function');
    if (fehlend.length) S(`src/club/chemie.js: es fehlen die Exporte ${fehlend.join(', ')}`);
    else OK('src/club/chemie.js exportiert alle neun vereinbarten Funktionen');
  } catch (err) {
    S(`src/club/chemie.js lässt sich nicht laden: ${err && err.message}`);
    chemie = null;
  }
}

for (const kandidat of ['src/club/national.js', 'src/club/nationalelf.js']) {
  const p = resolve(WURZEL, kandidat);
  if (!existsSync(p)) continue;
  nationalPfad = kandidat;
  try {
    national = await import(pathToFileURL(p).href);
    const fehlend = ['nationalkader', 'berufungen', 'tickNational'].filter(n => typeof national[n] !== 'function');
    if (fehlend.length) S(`${kandidat}: es fehlen die Exporte ${fehlend.join(', ')}`);
    else OK(`${kandidat} exportiert nationalkader, berufungen und tickNational`);
  } catch (err) {
    S(`${kandidat} lässt sich nicht laden: ${err && err.message}`);
    national = null;
  }
  break;
}
if (!nationalPfad) {
  H('src/club/national.js fehlt – die Nationalmannschaft ist noch nicht gebaut (Z09 bleibt offen)');
}

if (typeof loop.saisonWechsel === 'function') OK('core/loop.js exportiert saisonWechsel(state, ctx)');
else S('core/loop.js exportiert kein saisonWechsel(state, ctx) – der Dreisaisonlauf ist nicht möglich');

/* Vorprobe: reagiert entwicklung() überhaupt auf einen Mentor? */
{
  const probe = createNewGame({ clubId: EIGENER_VEREIN, managerName: 'Vorprobe', difficulty: 'profi', seed: SEED });
  const irgendwer = squadOf(probe, EIGENER_VEREIN)[0];
  const res = entwicklung(probe, irgendwer.id, { tage: 5, intensitaet: 60 });
  if (res && res.faktoren && res.faktoren.mentor !== undefined) {
    OK('training.js:entwicklung() weist faktoren.mentor aus');
  } else {
    S('training.js:entwicklung() kennt keinen faktoren.mentor – die Mentorenwirkung ist nicht verdrahtet');
  }
}

/* ------------------------------------------------------------------ *
 *  B) Der Kontrolllauf: unveränderte Elf über bis zu drei Saisons
 * ------------------------------------------------------------------ */

abschnitt(`B) Kontrolllauf – ${EIGENER_VEREIN} ohne einen einzigen Zugang`);

const kontrolle = createNewGame({
  clubId: EIGENER_VEREIN, managerName: 'Testtrainer', difficulty: 'profi', seed: SEED
});

const startKader = kaderSignatur(kontrolle, EIGENER_VEREIN);
const startChemie = eingespieltheit(kontrolle, EIGENER_VEREIN);
const startGroesse = serialize(kontrolle).length;

unterpunkt(`Anpfiff: Eingespieltheit ${nz(startChemie)} (${chemieQuelle()}), ` +
  `Kader ${kontrolle.clubs[EIGENER_VEREIN].playerIds.length} Mann, Spielstand ${mb(startGroesse)}`);

const chemieVerlauf = [{ wann: 'Anpfiff', wert: startChemie }];
let chemieNachSaison1 = NaN;
let kaderNachSaison1 = '';
let letzteSaison = 0;
let abbruch = null;
const grenzverstoesse = [];
const nanTreffer = [];

/** Alle Chemiewerte des Spielstands auf Wertebereich und NaN abklopfen. */
function chemieGrenzenPruefen(state, wann) {
  for (const e of alleChemiewerte(state)) {
    if (!Number.isFinite(e.wert)) { nanTreffer.push(`${wann}: ${e.wo} = ${e.wert}`); continue; }
    if (e.wert < 0 || e.wert > 100) grenzverstoesse.push(`${wann}: ${e.wo} = ${nz(e.wert)}`);
  }
}

chemieGrenzenPruefen(kontrolle, 'Anpfiff');

for (let saison = 1; saison <= SAISONS; saison++) {
  const t0 = Date.now();
  const lauf = await saisonSpielen(kontrolle);
  letzteSaison = saison;

  if (lauf.entlassungen) H(`Kontrolllauf Saison ${saison}: ${lauf.entlassungen}× entlassen – für den Prüflauf ignoriert`);
  for (const f of lauf.fehler.slice(0, 3)) H(`Kontrolllauf Saison ${saison}: ${f}`);
  if (lauf.fehler.length > 3) H(`Kontrolllauf Saison ${saison}: … und ${lauf.fehler.length - 3} weitere Modulfehler`);

  const wert = eingespieltheit(kontrolle, EIGENER_VEREIN);
  chemieVerlauf.push({ wann: `Ende S${saison}`, wert });
  chemieGrenzenPruefen(kontrolle, `Ende Saison ${saison}`);

  if (saison === 1) {
    chemieNachSaison1 = wert;
    kaderNachSaison1 = kaderSignatur(kontrolle, EIGENER_VEREIN);
  }

  unterpunkt(`Saison ${saison}: Eingespieltheit ${nz(wert)} · ${lauf.eigeneSpiele} eigene Partien · ` +
    `Spielstand ${mb(serialize(kontrolle).length)} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  if (saison < SAISONS) {
    if (typeof loop.saisonWechsel !== 'function') {
      abbruch = 'core/loop.js exportiert kein saisonWechsel() – weitere Saisons nicht spielbar';
      break;
    }
    try {
      await loop.saisonWechsel(kontrolle, makeCtx(kontrolle));
      chemieVerlauf.push({ wann: `nach Wechsel ${saison}→${saison + 1}`, wert: eingespieltheit(kontrolle, EIGENER_VEREIN) });
      chemieGrenzenPruefen(kontrolle, `nach dem Wechsel ${saison}→${saison + 1}`);
    } catch (err) {
      abbruch = `saisonWechsel() wirft: ${err && err.message}`;
      break;
    }
  }
}

if (abbruch) H(`Kontrolllauf abgebrochen: ${abbruch}`);

/* --- Z01: die unveränderte Elf ------------------------------------- */
unterpunkt('— Z01: wächst die Eingespieltheit? —');
{
  const gleicherKader = startKader === kaderNachSaison1;
  if (!gleicherKader) {
    H('Der Kader hat sich während Saison 1 verändert – Z01 misst dann keine reine Standelf mehr.');
  }
  const delta = chemieNachSaison1 - startChemie;
  if (!Number.isFinite(delta)) {
    zoffen(1, `Eingespieltheit ist nicht messbar (${chemieQuelle()} lieferte ${chemieNachSaison1})`);
  } else {
    z(1, delta >= ANSTIEG_MIN,
      `${nz(startChemie)} → ${nz(chemieNachSaison1)} nach einer Saison (Zuwachs ${nz(delta, 2)}, ` +
      `gefordert +${ANSTIEG_MIN}), Kader ${gleicherKader ? 'unverändert' : 'VERÄNDERT'}, Quelle ${chemieQuelle()}`);
  }
  I('Verlauf: ' + chemieVerlauf.map(e => `${e.wann} ${nz(e.wert)}`).join('  ·  '));
}

/* --- Z06/Z07: Wertebereich und Spielstand -------------------------- */
unterpunkt('— Z06/Z07: Wertebereich und Spielstandbudget —');
{
  const werte = alleChemiewerte(kontrolle);
  const zahlen = werte.map(e => e.wert).filter(Number.isFinite);
  const min = zahlen.length ? Math.min(...zahlen) : NaN;
  const max = zahlen.length ? Math.max(...zahlen) : NaN;
  const schnitt = zahlen.length ? zahlen.reduce((a, b) => a + b, 0) / zahlen.length : NaN;

  z(6, grenzverstoesse.length === 0 && nanTreffer.length === 0 && zahlen.length > 0,
    `${werte.length} Chemiewerte über ${letzteSaison} Saison(s): Spanne ${nz(min)}–${nz(max)}, ` +
    `Schnitt ${nz(schnitt)}` +
    (grenzverstoesse.length ? `, ${grenzverstoesse.length} außerhalb 0..100 (${grenzverstoesse.slice(0, 2).join('; ')})` : '') +
    (nanTreffer.length ? `, ${nanTreffer.length} NaN (${nanTreffer.slice(0, 2).join('; ')})` : ''));

  if (Number.isFinite(max) && max <= startChemie) {
    H(`Kein einziger Verein liegt über dem Startwert ${nz(startChemie)} – die Eingespieltheit kennt ` +
      'heute nur eine Richtung: abwärts (transfers.js:1833 und karriere.js:886 ziehen je 4 Punkte ab, ' +
      'aufgebaut wird nichts). Genau das ist die Lücke von Stufe 4.');
  }

  const groesse = serialize(kontrolle).length;
  const zuwachs = groesse - SPIELSTAND_BASIS;
  const chemieFelder = Object.values(kontrolle.clubs).filter(c => c.chemie).length;
  z(7, groesse < SPIELSTAND_MAX,
    `${mb(groesse)} nach ${letzteSaison} Saison(s), Grenze ${mb(SPIELSTAND_MAX)} · ` +
    `gegenüber dem heutigen Stand (${mb(SPIELSTAND_BASIS)}): ${zuwachs >= 0 ? '+' : '−'}${mb(Math.abs(zuwachs))} · ` +
    `noch frei bis zur Grenze: ${mb(SPIELSTAND_MAX - groesse)} · ` +
    `${chemieFelder} Vereine führen ein club.chemie-Feld`);
  I(`Budgethinweis: ${(kontrolle.clubs[EIGENER_VEREIN].playerIds || []).length} Spieler im eigenen Kader ergeben ` +
    `${Math.round((kontrolle.clubs[EIGENER_VEREIN].playerIds || []).length * ((kontrolle.clubs[EIGENER_VEREIN].playerIds || []).length - 1) / 2)} Paare – ` +
    'paarweise Chemie ist NUR für den eigenen Verein tragbar, für alle 1100 Spieler wäre sie quadratisch.');
  if (letzteSaison < 3) {
    H(`Z07 wurde nur über ${letzteSaison} Saison(s) gemessen – die 15-MB-Grenze gilt für drei.`);
  }
}

/* ------------------------------------------------------------------ *
 *  C) Der Zugangslauf: fünf Neuzugänge gegen den Kontrollverein
 * ------------------------------------------------------------------ */

abschnitt(`C) Zugangslauf – derselbe Seed, aber ${NEUZUGAENGE} Neuzugänge`);

{
  const zugang = createNewGame({
    clubId: EIGENER_VEREIN, managerName: 'Testtrainer', difficulty: 'profi', seed: SEED
  });
  const club = zugang.clubs[EIGENER_VEREIN];

  // Platz schaffen: der billigste Mann geht (MAX_KADER = 28 in transfers.js).
  const abgaben = [];
  const platzBedarf = Math.max(0, (club.playerIds.length + NEUZUGAENGE) - 28);
  const billigste = squadOf(zugang, EIGENER_VEREIN)
    .slice().sort((a, b) => (a.value || 0) - (b.value || 0));
  const kaeuferId = Object.keys(zugang.clubs).find(id => id !== EIGENER_VEREIN && zugang.clubs[id].leagueId === 'bl1');
  for (let i = 0; i < platzBedarf && i < billigste.length; i++) {
    const r = spielerVerkaufen(zugang, billigste[i].id, kaeuferId, 0, {});
    if (r && r.ok) abgaben.push(spn(billigste[i]));
  }

  // Fünf Neuzugänge einkaufen – billig, damit die Kasse nicht die Probe kippt.
  const kandidaten = Object.values(zugang.players)
    .filter(p => p.clubId && p.clubId !== EIGENER_VEREIN && !p.retired && !p.injury)
    .sort((a, b) => (a.value || 0) - (b.value || 0));
  const geholt = [];
  const abgelehnt = [];
  for (const p of kandidaten) {
    if (geholt.length >= NEUZUGAENGE) break;
    const r = spielerVerpflichten(zugang, EIGENER_VEREIN, p.id, 0, {
      zugesagt: true, ignoriereEtat: true, laufzeit: 3,
      gehalt: Math.min(p.contract ? p.contract.salary : 200000, 300000)
    });
    if (r && r.ok) geholt.push(spn(p));
    else if (abgelehnt.length < 3) abgelehnt.push((r && r.text) || 'ohne Begründung');
  }

  unterpunkt(`Abgänge: ${abgaben.length ? abgaben.join(', ') : 'keine'} · ` +
    `Zugänge: ${geholt.length ? geholt.join(', ') : 'keine'}`);
  if (abgelehnt.length) I('Abgelehnt: ' + abgelehnt.join(' | '));

  const nachTransfer = eingespieltheit(zugang, EIGENER_VEREIN);
  I(`Eingespieltheit direkt nach den Transfers: ${nz(startChemie)} → ${nz(nachTransfer)}`);

  if (geholt.length < NEUZUGAENGE) {
    zoffen(2, `nur ${geholt.length} von ${NEUZUGAENGE} Neuzugängen ließen sich verpflichten ` +
      `(${abgelehnt[0] || 'kein Grund gemeldet'})`);
  } else {
    const t0 = Date.now();
    const lauf = await saisonSpielen(zugang);
    for (const f of lauf.fehler.slice(0, 3)) H(`Zugangslauf: ${f}`);

    const endeZugang = eingespieltheit(zugang, EIGENER_VEREIN);
    const abstand = chemieNachSaison1 - endeZugang;
    unterpunkt(`Nach einer Saison: Kontrollverein ${nz(chemieNachSaison1)} · ` +
      `Zugangsverein ${nz(endeZugang)} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);

    if (!Number.isFinite(abstand)) {
      zoffen(2, `Eingespieltheit nicht messbar (${chemieQuelle()})`);
    } else {
      z(2, abstand >= ZUGANG_ABSTAND_MIN,
        `${NEUZUGAENGE} Zugänge kosten ${nz(abstand, 2)} Punkte gegenüber dem Kontrollverein ` +
        `(gefordert ${ZUGANG_ABSTAND_MIN}) · Kontrolle ${nz(chemieNachSaison1)} vs. Zugang ${nz(endeZugang)}`);
    }
    chemieGrenzenPruefen(zugang, 'Zugangslauf');
  }
}

/* ------------------------------------------------------------------ *
 *  D) Mentoren – der Laborversuch mit Kontrollgruppe
 * ------------------------------------------------------------------ */

abschnitt('D) Mentoren – zwei gleiche Talente, eines mit Legende an der Seite');

{
  const labor = createNewGame({
    clubId: EIGENER_VEREIN, managerName: 'Testtrainer', difficulty: 'profi', seed: SEED
  });
  const club = labor.clubs[EIGENER_VEREIN];
  const kader = squadOf(labor, EIGENER_VEREIN);

  // Vorlage: das größte Talent des Kaders.
  const vorlage = kader
    .filter(p => (p.age || 30) <= 22 && p.potential)
    .sort((a, b) => (b.potential - playerOverall(b)) - (a.potential - playerOverall(a)))[0]
    || kader.slice().sort((a, b) => (a.age || 30) - (b.age || 30))[0];

  // Mentor: die einflussreichste Legende, die nicht der Talentvorlage entspricht.
  const rang = hierarchie(labor, EIGENER_VEREIN);
  const rangVon = {};
  rang.forEach((r, i) => { rangVon[r.playerId] = rang.length - i; });
  const mentor = kader
    .filter(p => p.era === 'legend' && p.id !== vorlage.id && (p.age || 20) >= 28)
    .sort((a, b) => (rangVon[b.id] || 0) - (rangVon[a.id] || 0))[0]
    || kader.filter(p => p.id !== vorlage.id).sort((a, b) => (b.age || 0) - (a.age || 0))[0];

  function klon(suffix) {
    const c = deepClone(vorlage);
    c.id = `${vorlage.id}__${suffix}`;
    c.lastName = `${vorlage.lastName}-${suffix}`;
    c.shortName = c.lastName;
    c.number = 80 + suffix.length;
    c.stats = { season: deepClone(vorlage.stats.season), career: deepClone(vorlage.stats.career), history: [] };
    c.training = { focus: null, gains: {}, intensitaet: 50, woche: 0 };
    c.mentor = null;
    labor.players[c.id] = c;
    club.playerIds.push(c.id);
    return c;
  }

  const zoegling = klon('mentee');
  const kontrollTalent = klon('kontrolle');

  unterpunkt(`Talentvorlage ${spn(vorlage)} (${vorlage.age} J., Overall ${playerOverall(vorlage)}, ` +
    `Potenzial ${vorlage.potential}) · Mentor ${spn(mentor)} (${mentor.age} J., ${mentor.era})`);

  const gleich = playerOverall(zoegling) === playerOverall(kontrollTalent) &&
    attrSumme(zoegling) === attrSumme(kontrollTalent) &&
    zoegling.age === kontrollTalent.age && zoegling.potential === kontrollTalent.potential;

  if (!gleich) {
    zoffen(3, 'die beiden Talentklone sind nicht identisch – der Versuchsaufbau trägt nicht');
  } else {
    /* Mentor zuweisen: über die vereinbarte Funktion, sonst über das Feld. */
    let zuweisung = 'nicht möglich';
    if (chemie && typeof chemie.mentorSetzen === 'function') {
      try {
        const r = chemie.mentorSetzen(labor, zoegling.id, mentor.id);
        zuweisung = (r && r.ok) ? 'chemie.mentorSetzen()' : `chemie.mentorSetzen() lehnte ab: ${(r && r.text) || '?'}`;
      } catch (err) { zuweisung = `chemie.mentorSetzen() wirft: ${err && err.message}`; }
    }
    if (!zoegling.mentor) {
      zoegling.mentor = { mentorId: mentor.id, seit: { season: labor.date.season, day: labor.date.day } };
      mentor.mentees = [zoegling.id];
      if (zuweisung === 'nicht möglich') zuweisung = 'Feld player.mentor direkt gesetzt (Rückfall)';
    }
    I(`Zuweisung: ${zuweisung}`);

    const ovrVor = playerOverall(zoegling);
    const attrVor = attrSumme(zoegling);

    // Zwei Saisons Training. Beide bekommen exakt dieselbe Spielpraxis,
    // dieselbe Fitness und dieselbe Moral – der Mentor ist der einzige Unterschied.
    let mentorFaktor = null;
    for (let w = 0; w < TRAININGSWOCHEN * 2; w++) {
      for (const p of [zoegling, kontrollTalent]) {
        p.training.letzteWoche = { minuten: 90, spiele: 1, note: 7.0 };
        p.fitness = 92; p.morale = 72; p.form = 60;
      }
      const rA = entwicklung(labor, zoegling.id, { tage: 5, intensitaet: 60 });
      entwicklung(labor, kontrollTalent.id, { tage: 5, intensitaet: 60 });
      if (rA && rA.faktoren && rA.faktoren.mentor !== undefined) mentorFaktor = rA.faktoren.mentor;
      if (w % TRAININGSWOCHEN === TRAININGSWOCHEN - 1) { zoegling.age++; kontrollTalent.age++; }
    }

    const ovrMentee = playerOverall(zoegling) - ovrVor;
    const ovrKontroll = playerOverall(kontrollTalent) - ovrVor;
    const attrMentee = attrSumme(zoegling) - attrVor;
    const attrKontroll = attrSumme(kontrollTalent) - attrVor;
    const vorsprung = ovrMentee - ovrKontroll;

    z(3, vorsprung >= MENTOR_OVR_MIN && attrMentee > attrKontroll,
      `nach zwei Saisons: Zögling +${nz(ovrMentee)} Overall (${attrMentee} Attributpunkte), ` +
      `Kontrolle +${nz(ovrKontroll)} Overall (${attrKontroll} Attributpunkte) → ` +
      `Vorsprung ${nz(vorsprung, 2)} (gefordert ${MENTOR_OVR_MIN}) · ` +
      `faktoren.mentor = ${mentorFaktor === null ? 'nicht vorhanden' : nz(mentorFaktor, 3)}`);

    /* Nebenprüfung: färbt die Persönlichkeit ab und gewinnt die Legende Ansehen? */
    if (chemie && typeof chemie.mentorPaare === 'function') {
      let paare = [];
      try { paare = chemie.mentorPaare(labor, EIGENER_VEREIN) || []; } catch (err) { /* egal */ }
      const gefunden = paare.some(pp => pp && pp.talentId === zoegling.id && pp.mentorId === mentor.id);
      if (gefunden) OK(`chemie.mentorPaare() führt das Paar ${spn(mentor)} → ${spn(zoegling)}`);
      else H(`chemie.mentorPaare() kennt das gesetzte Paar ${spn(mentor)} → ${spn(zoegling)} nicht`);
      const mitText = paare.filter(pp => pp && typeof pp.text === 'string' && pp.text.length > 10).length;
      if (paare.length && mitText < paare.length) {
        H(`${paare.length - mitText} von ${paare.length} Mentorenpaaren haben keinen deutschen Begleittext`);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 *  E) Die Ära-Mischung – der Kern des ganzen Spiels
 * ------------------------------------------------------------------ */

abschnitt('E) Ära-Mischung – 9 Legenden und 2 Moderne gegen eine Elf aus einem Guss');

{
  const buehne = createNewGame({
    clubId: EIGENER_VEREIN, managerName: 'Testtrainer', difficulty: 'profi', seed: SEED
  });
  const kader = squadOf(buehne, EIGENER_VEREIN);
  const legenden = kader.filter(p => p.era === 'legend');
  const moderne = kader.filter(p => p.era !== 'legend');

  unterpunkt(`Kader ${kader.length}: ${legenden.length} Legenden, ${moderne.length} Moderne`);

  if (legenden.length < 9 || moderne.length < 11) {
    zoffen(4, `der Kader von ${kurz(buehne, EIGENER_VEREIN)} gibt die Probe nicht her ` +
      `(${legenden.length} Legenden, ${moderne.length} Moderne – nötig 9 bzw. 11)`);
  } else {
    const mischElf = [...legenden.slice(0, 9), ...moderne.slice(0, 2)];
    const homogenModern = moderne.slice(0, 11);
    const homogenLegende = legenden.length >= 11 ? legenden.slice(0, 11) : null;

    const wert = (elf, h) => chemistry(elf, { chemistryHistory: h }).wert;

    const mischNeu = wert(mischElf, 15);
    const mischAlt = wert(mischElf, 90);
    const homModern = wert(homogenModern, 15);
    const homLegende = homogenLegende ? wert(homogenLegende, 15) : NaN;
    const homBest = Math.max(homModern, Number.isFinite(homLegende) ? homLegende : -Infinity);

    I(`gemischt 9:2  Eingespieltheit 15 → ${nz(mischNeu)} · Eingespieltheit 90 → ${nz(mischAlt)}`);
    I(`homogen modern (11:0) → ${nz(homModern)}` +
      (Number.isFinite(homLegende) ? ` · homogen Legenden (0:11) → ${nz(homLegende)}` : ''));

    // Zusatzmessung: ab welcher Mischung greift der Ära-Abzug heute überhaupt?
    const staffel = [];
    for (const anzahlModern of [1, 2, 3, 4, 5]) {
      if (legenden.length < 11 - anzahlModern || moderne.length < anzahlModern) continue;
      const elf = [...legenden.slice(0, 11 - anzahlModern), ...moderne.slice(0, anzahlModern)];
      staffel.push(`${11 - anzahlModern}:${anzahlModern} → ${nz(wert(elf, 15))}/${nz(wert(elf, 90))}`);
    }
    I('Staffel Legenden:Moderne (Eingespieltheit 15/90): ' + staffel.join('  ·  '));

    const schlechterStart = (homBest - mischNeu) >= AERA_ABSTAND_MIN;
    const holtAuf = (mischAlt - mischNeu) >= AERA_AUFHOLEN_MIN;

    z(4, schlechterStart && holtAuf,
      `Start: gemischt ${nz(mischNeu)} vs. homogen ${nz(homBest)} ` +
      `(Abstand ${nz(homBest - mischNeu, 2)}, gefordert ${AERA_ABSTAND_MIN}) · ` +
      `Aufholen über Spielzeit: ${nz(mischAlt - mischNeu, 2)} Punkte (gefordert ${AERA_AUFHOLEN_MIN})`);

    if (!holtAuf) {
      H('engine/ratings.js:CHEMISTRY.eraMixMin = 3 – bei 9:2 ist die Minderheit nur 2, der Ära-Abzug ' +
        'greift gar nicht und die Eingespieltheit hat nichts zu verkleinern. Der Abzug muss stetig ' +
        'über die Größe der Minderheit gestaffelt werden (schon ab 1), sonst bleibt die Standardelf taub.');
    }
  }
}

/* ------------------------------------------------------------------ *
 *  F) Cliquen
 * ------------------------------------------------------------------ */

abschnitt('F) Cliquen – Gruppen nach Nationalität, Ära und Jahrgang');

{
  if (!chemie || typeof chemie.cliquen !== 'function') {
    zoffen(5, 'src/club/chemie.js:cliquen(state, clubId) fehlt');
  } else {
    const buehne = createNewGame({
      clubId: EIGENER_VEREIN, managerName: 'Testtrainer', difficulty: 'profi', seed: SEED
    });
    // Beziehungen einmal anstoßen – Cliquen sollen darauf aufbauen.
    try { beziehungen(buehne, EIGENER_VEREIN); } catch (err) { H(`morale.js:beziehungen() wirft: ${err && err.message}`); }

    const proVerein = [];
    const maengel = [];
    let gesamt = 0;
    const arten = {};

    const vereine = Object.keys(buehne.clubs)
      .filter(id => (buehne.clubs[id].playerIds || []).length >= 11 && !buehne.clubs[id].lazySquad)
      .slice(0, 12);

    for (const cid of vereine) {
      let liste = [];
      try { liste = chemie.cliquen(buehne, cid) || []; }
      catch (err) { maengel.push(`${cid}: cliquen() wirft ${err && err.message}`); continue; }
      if (!Array.isArray(liste)) { maengel.push(`${cid}: cliquen() liefert kein Array`); continue; }

      gesamt += liste.length;
      const zaehler = {};
      const kaderIds = new Set(buehne.clubs[cid].playerIds);

      for (const c of liste) {
        if (!c || !Array.isArray(c.playerIds)) { maengel.push(`${cid}: Clique ohne playerIds`); continue; }
        arten[c.art] = (arten[c.art] || 0) + 1;
        if (c.playerIds.length < CLIQUE_MIN || c.playerIds.length > CLIQUE_MAX) {
          maengel.push(`${cid}: Clique "${c.art}" mit ${c.playerIds.length} Mann (erlaubt ${CLIQUE_MIN}–${CLIQUE_MAX})`);
        }
        for (const pid of c.playerIds) {
          if (!kaderIds.has(pid)) maengel.push(`${cid}: ${pid} steht in einer Clique, aber nicht im Kader`);
          zaehler[pid] = (zaehler[pid] || 0) + 1;
        }
        if (new Set(c.playerIds).size !== c.playerIds.length) {
          maengel.push(`${cid}: Clique "${c.art}" führt einen Spieler doppelt`);
        }
        if (!['nation', 'aera', 'alter', 'vergangenheit'].includes(c.art)) {
          maengel.push(`${cid}: unbekannte Cliquen-Art "${c.art}"`);
        }
        // Plausibilität je Art
        const sp = c.playerIds.map(id => buehne.players[id]).filter(Boolean);
        if (c.art === 'nation' && new Set(sp.map(p => p.nationality)).size > 1) {
          maengel.push(`${cid}: Nationen-Clique mit ${new Set(sp.map(p => p.nationality)).size} Nationen`);
        }
        if (c.art === 'aera' && new Set(sp.map(p => p.era)).size > 1) {
          maengel.push(`${cid}: Ära-Clique mischt Legenden und Moderne`);
        }
        if (c.art === 'alter' && sp.length) {
          const alter = sp.map(p => p.age || 26);
          const spanne = Math.max(...alter) - Math.min(...alter);
          if (spanne > 6) maengel.push(`${cid}: Alters-Clique mit ${spanne} Jahren Spanne`);
        }
        if (typeof c.text !== 'string' || c.text.length < 10) {
          maengel.push(`${cid}: Clique "${c.art}" ohne deutschen Begleittext`);
        }
      }

      const vielfach = Object.entries(zaehler).filter(([, n]) => n > CLIQUEN_JE_SPIELER);
      for (const [pid, n] of vielfach.slice(0, 2)) {
        maengel.push(`${cid}: ${spn(buehne.players[pid])} steht in ${n} Cliquen (erlaubt ${CLIQUEN_JE_SPIELER})`);
      }
      proVerein.push(liste.length);
    }

    const schnitt = proVerein.length ? proVerein.reduce((a, b) => a + b, 0) / proVerein.length : 0;
    I(`Arten: ${Object.entries(arten).map(([a, n]) => `${a} ${n}`).join(', ') || 'keine'}`);
    z(5, gesamt > 0 && maengel.length === 0,
      `${gesamt} Cliquen in ${proVerein.length} Vereinen (${nz(schnitt)} je Verein)` +
      (maengel.length ? `, ${maengel.length} Beanstandungen – ${maengel.slice(0, 3).join(' · ')}` : ', keine Beanstandung'));
  }
}

/* ------------------------------------------------------------------ *
 *  G) Wirkt die Eingespieltheit in der Engine?
 * ------------------------------------------------------------------ */

abschnitt('G) Engine-Wirkung – dieselbe Elf, einmal fremd, einmal eingespielt');

{
  const arena = createNewGame({
    clubId: EIGENER_VEREIN, managerName: 'Testtrainer', difficulty: 'profi', seed: SEED
  });

  // Die Prüfelf: die beste Elf des Kaders, aber mit mindestens drei Modernen.
  // Erst ab drei Spielern der Minderheits-Ära hat die Eingespieltheit im
  // heutigen Stand überhaupt eine Angriffsfläche (CHEMISTRY.eraMixMin = 3).
  const eigen = buildMatchTeam(arena, EIGENER_VEREIN, true);
  let elf = Object.values(eigen.tactics.lineup).map(id => arena.players[id]).filter(Boolean);
  {
    const drin = new Set(elf.map(p => p.id));
    const bank = squadOf(arena, EIGENER_VEREIN)
      .filter(p => !drin.has(p.id) && p.era !== 'legend' && !p.injury)
      .sort((a, b) => playerOverall(b) - playerOverall(a));
    while (elf.filter(p => p.era !== 'legend').length < 3 && bank.length) {
      const legendenInElf = elf.filter(p => p.era === 'legend')
        .sort((a, b) => playerOverall(a) - playerOverall(b));
      if (!legendenInElf.length) break;
      const raus = legendenInElf[0];
      const rein = bank.shift();
      elf = elf.map(p => (p.id === raus.id ? rein : p));
    }
  }
  const tac = elfAufstellen(elf);

  const bau = h => ({
    club: arena.clubs[EIGENER_VEREIN], players: elf, tactics: tac,
    morale: 65, tiredness: 12, coachBonus: 60, chemistryHistory: h, isHome: true
  });

  const chemieNiedrig = teamStrength(bau(5));
  const chemieHoch = teamStrength(bau(95));
  const eigenStaerke = (chemieNiedrig.gesamt + chemieHoch.gesamt) / 2;

  // Gegner: der Verein, dessen Mannschaftsstärke der Prüfelf am nächsten kommt –
  // bei einem ungleichen Duell würde jede Chemiewirkung im Rauschen untergehen.
  let gegnerId = null, bestAbstand = Infinity, gegnerStaerke = NaN;
  for (const id of Object.keys(arena.clubs)) {
    if (id === EIGENER_VEREIN) continue;
    const c = arena.clubs[id];
    if (c.lazySquad || (c.playerIds || []).length < 14 || c.leagueId !== 'bl1') continue;
    let s;
    try { s = teamStrength(buildMatchTeam(arena, id, false)).gesamt; } catch (err) { continue; }
    const d = Math.abs(s - eigenStaerke);
    if (d < bestAbstand) { bestAbstand = d; gegnerId = id; gegnerStaerke = s; }
  }

  if (!gegnerId) {
    zoffen(8, 'kein passender Gegner gefunden');
  } else {
    unterpunkt(`Gegner ${kurz(arena, gegnerId)} (Stärke ${nz(gegnerStaerke)} ` +
      `gegen eigene ${nz(chemieNiedrig.gesamt)}) · Prüfelf ${elf.filter(p => p.era === 'legend').length} Legenden / ` +
      `${elf.filter(p => p.era !== 'legend').length} Moderne`);
    I(`Eingespieltheit 5 → Chemie ${nz(chemieNiedrig.chemie)}, Gesamtstärke ${nz(chemieNiedrig.gesamt)}`);
    I(`Eingespieltheit 95 → Chemie ${nz(chemieHoch.chemie)}, Gesamtstärke ${nz(chemieHoch.gesamt)}`);

    const kapazitaet = arena.clubs[EIGENER_VEREIN].stadium.capacity;
    function serie(h) {
      let punkte = 0, tore = 0, gegentore = 0;
      for (let i = 0; i < ENGINE_PARTIEN; i++) {
        const r = quickSimulate({
          home: bau(h),
          away: buildMatchTeam(arena, gegnerId, false),
          rng: createRng(`chemie:${SEED}:${i}`),
          difficulty: { xpGain: 1, minigame: 1 },
          competition: { id: 'bl1', matchday: 1 },
          venue: { capacity: kapazitaet, attendance: Math.round(kapazitaet * 0.8) }
        });
        const [a, b] = r.score;
        punkte += a > b ? 3 : a === b ? 1 : 0;
        tore += a; gegentore += b;
      }
      return { punkte: punkte / ENGINE_PARTIEN, tore: tore / ENGINE_PARTIEN, gegentore: gegentore / ENGINE_PARTIEN };
    }

    const t0 = Date.now();
    const niedrig = serie(5);
    const hoch = serie(95);
    const delta = hoch.punkte - niedrig.punkte;

    I(`${ENGINE_PARTIEN} Partien je Stufe, identische Zufallsströme, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    I(`Eingespieltheit  5: ${nz(niedrig.punkte, 3)} Punkte/Spiel, ${nz(niedrig.tore, 2)}:${nz(niedrig.gegentore, 2)} Tore`);
    I(`Eingespieltheit 95: ${nz(hoch.punkte, 3)} Punkte/Spiel, ${nz(hoch.tore, 2)}:${nz(hoch.gegentore, 2)} Tore`);

    const chemieSpanne = chemieHoch.chemie - chemieNiedrig.chemie;
    z(8, delta >= ENGINE_PUNKTE_MIN && chemieSpanne >= ENGINE_CHEMIE_MIN,
      `Eingespieltheit 5 → 95 bringt ${nz(delta, 3)} Punkte je Spiel ` +
      `(gefordert ${nz(ENGINE_PUNKTE_MIN, 2)}) bei ${nz(chemieSpanne, 1)} Chemiepunkten Unterschied ` +
      `(gefordert ${ENGINE_CHEMIE_MIN}) · Gesamtstärke ${nz(chemieNiedrig.gesamt)} → ${nz(chemieHoch.gesamt)}`);

    if (chemieSpanne > 0) {
      I(`Umrechnung: ein Chemiepunkt ist hier ${nz(delta / chemieSpanne, 4)} Punkte je Spiel wert – ` +
        `für ${nz(ENGINE_PUNKTE_MIN, 2)} Punkte/Spiel braucht es ${nz(ENGINE_PUNKTE_MIN / (delta / chemieSpanne), 0)} Chemiepunkte.`);
    }
    if (chemieSpanne < ENGINE_CHEMIE_MIN) {
      H('Solange die Eingespieltheit weniger als ' + ENGINE_CHEMIE_MIN + ' Chemiepunkte bewegt, kann sie ' +
        'in der Engine nichts ausrichten – ratings.js:WEIGHTS.chemie = 0,12 macht aus 100 Chemiepunkten ' +
        'nur ±6 % Teamfaktor. Die Chemie ist dann Dekoration.');
    }

    /* Hebelprobe (informativ): wie viel ist ein Chemiepunkt in der Engine wert?
       Einziger Unterschied ist die Kapitänsbinde – sie bewegt nur die Chemie. */
    const ohneKapitaen = Object.assign({}, tac, { setPieces: Object.assign({}, tac.setPieces, { kapitaen: null }) });
    const mitK = teamStrength(bau(50));
    const ohneK = teamStrength(Object.assign(bau(50), { tactics: ohneKapitaen }));
    const hebel = mitK.chemie - ohneK.chemie;
    I(`Hebelprobe: Kapitänsbinde bewegt ${nz(hebel, 1)} Chemiepunkte und ` +
      `${nz(mitK.gesamt - ohneK.gesamt, 2)} Punkte Gesamtstärke.`);
  }
}

/* ------------------------------------------------------------------ *
 *  H) Nationalmannschaft
 * ------------------------------------------------------------------ */

abschnitt('H) Nationalmannschaft – Berufungen, Reisebelastung, Verletzte');

{
  if (!national) {
    zoffen(9, 'src/club/national.js ist nicht vorhanden – Berufungen, Länderspielpausen ' +
      'und Turniere fehlen vollständig (Roadmap-Stufe 4, Punkt 4)');
  } else {
    const buehne = createNewGame({
      clubId: EIGENER_VEREIN, managerName: 'Testtrainer', difficulty: 'profi', seed: SEED
    });
    const ctx = makeCtx(buehne);
    const maengel = [];
    let berufen = [];

    try { berufen = national.berufungen(buehne, ctx) || []; }
    catch (err) { maengel.push(`berufungen() wirft: ${err && err.message}`); }

    if (!Array.isArray(berufen) || !berufen.length) {
      maengel.push('berufungen() liefert keine Aufgebote');
    }

    let geprueft = 0;
    for (const eintrag of (Array.isArray(berufen) ? berufen : [])) {
      if (!eintrag || !Array.isArray(eintrag.playerIds)) { maengel.push('Aufgebot ohne playerIds'); continue; }
      const nation = eintrag.nation;
      const alle = Object.values(buehne.players)
        .filter(p => p.nationality === nation && p.clubId && !p.retired && !p.injury)
        .sort((a, b) => playerOverall(b) - playerOverall(a));
      const grenze = alle[Math.min(alle.length - 1, Math.max(0, eintrag.playerIds.length * 2 - 1))];
      const schwelle = grenze ? playerOverall(grenze) : 0;

      for (const pid of eintrag.playerIds) {
        const p = buehne.players[pid];
        geprueft++;
        if (!p) { maengel.push(`${nation}: unbekannter Spieler ${pid}`); continue; }
        if (p.nationality !== nation) maengel.push(`${nation}: ${spn(p)} ist ${p.nationality}`);
        if (p.injury) maengel.push(`${nation}: ${spn(p)} ist verletzt und trotzdem berufen`);
        if (playerOverall(p) < schwelle - 5) {
          maengel.push(`${nation}: ${spn(p)} (${playerOverall(p)}) liegt deutlich unter der Leistungsschwelle ${schwelle}`);
        }
      }
    }

    // Länderspielpause muss Fitness kosten.
    let fitnessKosten = null;
    if (typeof national.tickNational === 'function') {
      const vorher = {};
      for (const e of (Array.isArray(berufen) ? berufen : [])) {
        for (const pid of (e.playerIds || [])) if (buehne.players[pid]) vorher[pid] = buehne.players[pid].fitness;
      }
      try {
        for (let i = 0; i < 10; i++) national.tickNational(buehne, makeCtx(buehne));
        const ids = Object.keys(vorher);
        if (ids.length) {
          const summe = ids.reduce((s, id) => s + (vorher[id] - buehne.players[id].fitness), 0);
          fitnessKosten = summe / ids.length;
        }
      } catch (err) { maengel.push(`tickNational() wirft: ${err && err.message}`); }
    }
    if (fitnessKosten !== null && fitnessKosten <= 0) {
      maengel.push(`die Länderspielpause kostet keine Fitness (Schnitt ${nz(fitnessKosten, 2)})`);
    }

    z(9, maengel.length === 0 && geprueft > 0,
      `${berufen.length} Aufgebote, ${geprueft} Berufungen geprüft, ` +
      `Fitnesskosten je Spieler ${fitnessKosten === null ? 'nicht gemessen' : nz(fitnessKosten, 2)}` +
      (maengel.length ? ` · ${maengel.length} Beanstandungen – ${maengel.slice(0, 3).join(' · ')}` : ''));
  }
}

/* ------------------------------------------------------------------ *
 *  I) Determinismus
 * ------------------------------------------------------------------ */

abschnitt('I) Determinismus – gleicher Seed, gleiche Kabine');

{
  if (!chemie || typeof chemie.cliquen !== 'function' || typeof chemie.mentorPaareBilden !== 'function') {
    zoffen(10, 'src/club/chemie.js:cliquen() bzw. mentorPaareBilden() fehlen');
  } else {
    function fingerabdruck(seed) {
      const st = createNewGame({
        clubId: EIGENER_VEREIN, managerName: 'Testtrainer', difficulty: 'profi', seed
      });
      const ctx = makeCtx(st);
      const teile = [];
      for (const cid of Object.keys(st.clubs).filter(id => (st.clubs[id].playerIds || []).length >= 11).slice(0, 6)) {
        let m = [], c = [];
        try { m = chemie.mentorPaareBilden(st, cid, ctx) || []; } catch (err) { m = [`fehler:${err && err.message}`]; }
        try { c = chemie.cliquen(st, cid) || []; } catch (err) { c = [`fehler:${err && err.message}`]; }
        teile.push(cid + '|M:' + JSON.stringify(m.map(x => x && [x.mentorId, x.talentId])) +
          '|C:' + JSON.stringify(c.map(x => x && [x.art, (x.playerIds || []).slice().sort()])));
      }
      return teile.join('\n');
    }

    const a = fingerabdruck(SEED);
    const b = fingerabdruck(SEED);
    const anders = fingerabdruck(ZWEITSEED);

    const gleich = a === b;
    const variiert = a !== anders;
    z(10, gleich && variiert,
      `Seed ${SEED} zweimal ${gleich ? 'identisch' : 'UNTERSCHIEDLICH'} · ` +
      `Seed ${ZWEITSEED} ${variiert ? 'liefert eine andere Kabine' : 'liefert dieselbe Kabine (verdächtig)'} · ` +
      `Fingerabdruck ${a.length} Zeichen`);
  }
}

/* ------------------------------------------------------------------ *
 *  J) Zusammenfassung
 * ------------------------------------------------------------------ */

abschnitt('J) Zusicherungen');
let fehlgeschlagen = 0, ungeprueft = 0;
for (const nr of Object.keys(ZTITEL).sort((a, b) => a - b)) {
  const e = zstat[nr];
  const status = e.fehl ? 'FEHL' : e.ok ? ' ok ' : ' ?  ';
  if (e.fehl) fehlgeschlagen++;
  else if (!e.ok) { ungeprueft++; if (!e.offen) e.meldungen.push('nie zur Prüfung gekommen'); }
  console.log(`  [${status}] Z${String(nr).padStart(2)}  ${ZTITEL[nr]}` +
    `   (${e.ok}× bestanden, ${e.fehl}× fehlgeschlagen, ${e.offen}× nicht prüfbar)`);
  for (const m of e.meldungen.slice(0, 2)) console.log(`          · ${m}`);
  if (e.meldungen.length > 2) console.log(`          · … und ${e.meldungen.length - 2} weitere`);
}

abschnitt('K) Ergebnis');
if (strukturFehler.length) {
  console.log(`  Fehlende Bausteine (${strukturFehler.length}):`);
  for (const s of strukturFehler) console.log('    · ' + s);
}
if (hinweise.length) {
  console.log(`  Hinweise (${hinweise.length}):`);
  for (const h of hinweise.slice(0, 14)) console.log('    · ' + h);
  if (hinweise.length > 14) console.log(`    · … und ${hinweise.length - 14} weitere`);
}

const bestanden = Object.keys(ZTITEL).length - fehlgeschlagen - ungeprueft;
console.log('\n' + '='.repeat(70));
console.log(`ERGEBNIS: ${bestanden} von ${Object.keys(ZTITEL).length} Zusicherungen bestanden, ` +
  `${fehlgeschlagen} fehlgeschlagen, ${ungeprueft} nicht prüfbar, ` +
  `${strukturFehler.length} fehlende Bausteine  (${((Date.now() - gestartet) / 1000).toFixed(1)} s)`);

const hart = fehlgeschlagen + ungeprueft + strukturFehler.length;
if (!hart) {
  console.log('Die Kabine stimmt, die Legenden reden mit den Jungen, und die Elf spielt wie eine Elf.');
} else {
  console.log('Aus dem Einfall ist noch kein Spielprinzip geworden. Die Liste oben ist die Arbeit.');
}
process.exit(hart ? 1 : 0);
