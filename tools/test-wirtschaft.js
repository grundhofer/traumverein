/**
 * tools/test-wirtschaft.js – Der Prüfstand für die Gehaltsskala.
 *
 *   node tools/test-wirtschaft.js               # Standard: Seeds 7 und 2024
 *   node tools/test-wirtschaft.js 11 42         # eigene Seeds
 *   node tools/test-wirtschaft.js --schnell     # nur der erste Seed
 *   node tools/test-wirtschaft.js --tabelle     # Tabelle auch bei Seed 2+
 *
 * WOZU
 *   Die Einnahmenseite der 36 Profivereine ist geeicht (siehe tools/test-finanzen.js):
 *   Bayern rund 490 Mio, Heidenheim rund 50 Mio. Die Ausgabenseite hing lange
 *   allein an Marktwert, Stärke und Alter des Spielers — und da in diesem Spiel
 *   JEDER Erstligist zehn Legenden im Kader hat, zahlte Heidenheim Weltmarkt-
 *   gehälter bei Drittligaeinnahmen. Dieses Skript misst nach, ob die Gehalts-
 *   skala zur wirtschaftlichen Größe des Vereins passt.
 *
 * WIE
 *   Ein frisches Spiel, eine komplette Saison über advanceDay() (eigene Partien
 *   über simulateAiFixture/applyResult, wie in tools/test-saison.js), danach
 *   saisonWechsel() — erst dort fließt die TV-Schlussabrechnung. Gemessen wird
 *   die Saisonzeile finances.saison, die zu diesem Zeitpunkt noch der
 *   abgelaufenen Saison gehört (club/finances.js rollt sie erst beim ersten
 *   Tick der neuen Saison weiter).
 *
 * ZIELKORRIDORE (K1–K6, siehe KORRIDOR unten)
 *   K1  Gehaltsquote im Ligaschnitt: 1. Liga 48–62 %, 2. Liga 43–60 %
 *   K2  Höchstens 4 Vereine über 72 %, keiner über 110 %
 *   K3  Tragbare Gehaltsquote: kein Verein unter 30 %,
 *       Ligaschnitt 1. Liga ≥ 72 %, 2. Liga ≥ 50 %
 *   K4  Betriebsergebnis (ohne Transfers): höchstens 15 von 36 negativ
 *   K5  Kein Betriebsergebnis schlechter als −32 Mio
 *   K6  Kein Konto am Saisonende unter −35 Mio
 *   H1  Hackordnung: Bayern zahlt am meisten, Heidenheim am wenigsten (1. Liga)
 *
 * WARUM NICHT DIE GEHALTSQUOTE JEDES EINZELNEN VEREINS?
 *   Die ersten Fassungen dieses Prüfstands verlangten von JEDEM Erstligisten
 *   45–65 %. Das ist nicht erreichbar, und zwar aus einem Grund, der nichts mit
 *   der Gehaltsskala zu tun hat: Der Nenner schwankt. Die Einnahmen einer Saison
 *   enthalten Fernsehgeld nach Platzierung, Prämien und Transfererlöse und
 *   bewegen sich dadurch um ±35 %, während die Lohnsumme durch laufende Verträge
 *   festliegt. Ein Verein, der Neunter statt Vierter wird, springt allein davon
 *   um zehn Prozentpunkte. Gemessen: Bei jeder denkbaren Einstellung der Skala
 *   (Parametersuche über GEHALT_NIVEAU, GEHALT_SPITZE_EXP und GEHALT_STAUCHUNG)
 *   blieben 7–9 der 36 Vereine außerhalb des Korridors — verschoben wurde nur,
 *   WELCHE.
 *
 *   Deshalb misst K1 den Ligaschnitt (der ist über Seeds hinweg auf ±1 Punkt
 *   stabil) und K2 die Ausreißer nach oben. Den eigentlichen Konstruktionsfehler
 *   fängt K3: die tragbare Quote sagt, wie viel vom Umsatz nach den Fixkosten
 *   überhaupt für Gehälter übrig bleibt. Sie hängt kaum am Tabellenplatz und lag
 *   im kaputten Zustand in der 2. Liga bei 8–42 % (Schnitt 32 %) — daran wäre
 *   auch die beste Gehaltsskala gescheitert.
 *
 * Exitcode 1, sobald ein Korridor verletzt ist oder die Saison nicht durchläuft.
 */

import { createNewGame } from '../src/core/state.js';
import { advanceDay, makeCtx, simulateAiFixture, applyResult, pokalWeiterlosen, saisonWechsel } from '../src/core/loop.js';
import { CLUBS } from '../src/data/clubs.js';
import { round } from '../src/core/util.js';

/* ------------------------------------------------------------------ *
 *  Argumente
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const SCHNELL = args.includes('--schnell');
const ALLE_TABELLEN = args.includes('--tabelle');
const POSTEN = args.includes('--posten');
const EIGENE_SEEDS = args.filter(a => /^\d+$/.test(a)).map(Number);

const SEEDS = EIGENE_SEEDS.length ? EIGENE_SEEDS : [7, 2024];
const seeds = SCHNELL ? SEEDS.slice(0, 1) : SEEDS;

const EIGENER_VEREIN = 'hsv';
const TAGE_NOTBREMSE = 3000;

/**
 * Zielkorridore. Ein Verstoß ist ein harter Fehler (Exitcode 1).
 * Alle Grenzen sind an Messungen über sieben Seeds gesetzt (siehe Kopf):
 * Ligaschnitt 1. Liga 52,6–54,6 %, 2. Liga 49,2–52,0 % · über 72 %: 0–2 Vereine ·
 * tragbar 1. Liga min 73,6 / Schnitt 83 %, 2. Liga min 35,4 / Schnitt 58–62 % ·
 * Betriebsergebnis negativ bei 7–12 Vereinen, tiefstens −27,7 Mio ·
 * tiefstes Konto −28,4 Mio.
 */
const KORRIDOR = {
  schnittBl1: [48, 62],
  schnittBl2: [43, 60],
  quoteHart: 72,
  maxUeberHart: 4,
  quoteAbsurd: 110,
  tragbarMin: 30,
  tragbarSchnittBl1: 72,
  tragbarSchnittBl2: 50,
  maxNegativBetrieb: 15,
  minBetriebsergebnis: -32e6,
  minKonto: -35e6
};

/** Die 36 Profivereine in Startreihenfolge (Amateure des Pokals zählen nicht). */
const PROFI_IDS = CLUBS.map(c => c.id);
const START_LIGA = {};
for (const c of CLUBS) START_LIGA[c.id] = c.leagueId;

/* ------------------------------------------------------------------ *
 *  Testgerüst (Stil wie tools/test-saison.js)
 * ------------------------------------------------------------------ */

const fehler = [];
const warnungen = [];

function FEHL(text) { fehler.push(text); console.log(`    [FEHL] ${text}`); }
function WARN(text) { warnungen.push(text); console.log(`    [warn] ${text}`); }
function OK(text) { console.log(`    [ok]   ${text}`); }
function abschnitt(titel) { console.log('\n=== ' + titel + ' ==='); }

const mio = v => (v / 1e6).toFixed(1).replace('.', ',');
const proz = v => round(v, 1).toFixed(1).replace('.', ',');

/* ------------------------------------------------------------------ *
 *  Eine Saison durchspielen (Vorlage: tools/test-saison.js)
 * ------------------------------------------------------------------ */

async function saisonSpielen(state) {
  const protokoll = { eigeneSpiele: 0, entlassungen: 0, fehler: [] };
  const echtesError = console.error;
  console.error = (...a) => protokoll.fehler.push(a.map(String).join(' '));

  try {
    for (let i = 0; i < TAGE_NOTBREMSE; i++) {
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
        // Ein Rauswurf beendet im Spiel die Karriere – der Prüfstand braucht die
        // volle Saison und macht weiter.
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
 *  Auswertung
 * ------------------------------------------------------------------ */

const EINNAHME_FELDER = [
  'einnahmenZuschauer', 'einnahmenTv', 'einnahmenSponsoren', 'einnahmenTransfer',
  'einnahmenMerch', 'einnahmenPraemien', 'einnahmenSonstige'
];
const AUSGABE_FELDER = [
  'ausgabenGehaelter', 'ausgabenTransfer', 'ausgabenStadion', 'ausgabenStab',
  'ausgabenJugend', 'ausgabenBetrieb', 'ausgabenZinsen', 'ausgabenSonstige'
];

/**
 * Lohnsumme des Kaders. Muss VOR saisonWechsel abgegriffen werden – danach haben
 * Auf- und Absteiger ihre Kader getauscht (loop.js ligawechselKader) und die Zahl
 * gehört bereits zur neuen Saison.
 */
function lohnsummen(state) {
  const out = {};
  for (const id of PROFI_IDS) {
    const club = state.clubs[id];
    let s = 0, n = 0;
    for (const pid of (club && club.playerIds) || []) {
      const p = state.players[pid];
      if (p && p.contract) { s += p.contract.salary || 0; n++; }
    }
    out[id] = { lohnsumme: s, kader: n };
  }
  return out;
}

/** Liest die Saisonzeile eines Vereins aus (nach saisonWechsel, vor dem ersten Tick). */
function auswerten(state, clubId, lohn) {
  const club = state.clubs[clubId];
  const f = (club && club.finances) || {};
  const z = f.saison || {};
  const einnahmen = EINNAHME_FELDER.reduce((s, k) => s + (z[k] || 0), 0);
  const ausgaben = AUSGABE_FELDER.reduce((s, k) => s + (z[k] || 0), 0);
  const gehaelter = z.ausgabenGehaelter || 0;
  const l = (lohn && lohn[clubId]) || { lohnsumme: 0, kader: 0 };
  // Fixkosten = alles außer Gehältern und Transfers (Stadion, Stab, Jugend,
  // Betrieb, Zinsen, Abschreibungen). Sie entscheiden, welche Gehaltsquote ein
  // Verein überhaupt tragen kann. Transferausgaben bleiben außen vor: die sind
  // eine Entscheidung, keine Grundlast.
  const transferAus = z.ausgabenTransfer || 0;
  const transferEin = z.einnahmenTransfer || 0;
  const fixkosten = ausgaben - gehaelter - transferAus;
  return {
    clubId,
    name: club.shortName || club.name,
    liga: START_LIGA[clubId],
    reputation: club.reputation || 50,
    einnahmen, ausgaben, gehaelter, fixkosten, transferAus, transferEin,
    // Was der Verein aus eigener Kraft erwirtschaftet: ohne gekaufte und ohne
    // verkaufte Spieler. Ein Zukauf ist eine Entscheidung, kein Betriebsergebnis
    // — deshalb misst K4/K5 diese Zahl und nicht den Kassensturz.
    betrieb: einnahmen - transferEin - gehaelter - fixkosten,
    quote: einnahmen > 0 ? gehaelter / einnahmen * 100 : 0,
    // Anteil der Einnahmen, der nach den Fixkosten für Gehälter übrig bleibt.
    // Liegt die Gehaltsquote darüber, schreibt der Verein rote Zahlen, ganz
    // gleich, ob er einen einzigen Spieler kauft.
    tragbar: einnahmen > 0 ? (einnahmen - fixkosten) / einnahmen * 100 : 0,
    ergebnis: einnahmen - ausgaben,
    balance: f.balance || 0,
    lohnsumme: l.lohnsumme,
    kader: l.kader,
    zeile: z
  };
}

/** Einnahmen- und Ausgabenposten einiger Referenzvereine (Diagnose, --posten). */
function postenAusgeben(zeilen) {
  const referenz = ['bayern', 'dortmund', 'hsv', 'freiburg', 'heidenheim', 'schalke', 'elversberg']
    .concat(zeilen.filter(r => r.ergebnis < -8e6).map(r => r.clubId));
  console.log('  Posten der Referenzvereine (Mio EUR)');
  for (const id of new Set(referenz)) {
    const r = zeilen.find(x => x.clubId === id);
    if (!r) continue;
    const ein = EINNAHME_FELDER.filter(k => r.zeile[k]).map(k => `${k.replace('einnahmen', '')} ${mio(r.zeile[k])}`);
    const aus = AUSGABE_FELDER.filter(k => r.zeile[k]).map(k => `${k.replace('ausgaben', '')} ${mio(r.zeile[k])}`);
    console.log(`   ${r.name}:`);
    console.log(`      ein: ${ein.join(' · ')}`);
    console.log(`      aus: ${aus.join(' · ')}`);
  }
}

function tabelleAusgeben(zeilen) {
  const kopf = 'Verein'.padEnd(15) + 'Lg'.padStart(4) + 'Rep'.padStart(5)
    + 'Einn.'.padStart(9) + 'Ausg.'.padStart(9) + 'Gehalt'.padStart(9)
    + 'Quote'.padStart(8) + 'Ergebnis'.padStart(10) + 'Konto'.padStart(10)
    + 'Lohn'.padStart(9) + 'Fixk.'.padStart(8) + 'Zukauf'.padStart(8) + 'tragb.'.padStart(8);
  console.log('  ' + kopf);
  console.log('  ' + '-'.repeat(kopf.length));
  for (const r of zeilen) {
    console.log('  '
      + r.name.slice(0, 14).padEnd(15)
      + (r.liga === 'bl1' ? '1' : '2').padStart(4)
      + String(r.reputation).padStart(5)
      + mio(r.einnahmen).padStart(9)
      + mio(r.ausgaben).padStart(9)
      + mio(r.gehaelter).padStart(9)
      + (proz(r.quote) + '%').padStart(8)
      + mio(r.ergebnis).padStart(10)
      + mio(r.balance).padStart(10)
      + mio(r.lohnsumme).padStart(9)
      + mio(r.fixkosten).padStart(8)
      + mio(r.transferAus).padStart(8)
      + (proz(r.tragbar) + '%').padStart(8));
  }
  console.log('  (Beträge in Mio EUR · Fixk. = Ausgaben ohne Gehälter und Transfers ·');
  console.log('   Zukauf = Transferausgaben · tragb. = Anteil der Einnahmen, der nach den');
  console.log('   Fixkosten für Gehälter bleibt; darüber sind rote Zahlen unvermeidlich)');
}

/** Prüft die Zielkorridore und meldet jede Verletzung namentlich. */
function korridorePruefen(zeilen, seed) {
  const bl1 = zeilen.filter(r => r.liga === 'bl1');
  const bl2 = zeilen.filter(r => r.liga === 'bl2');

  const schnitt = a => a.reduce((s, r) => s + r.quote, 0) / Math.max(1, a.length);
  const tragbarSchnitt = a => a.reduce((s, r) => s + r.tragbar, 0) / Math.max(1, a.length);

  // --- K1: Gehaltsquote im Ligaschnitt -----------------------------------
  for (const [liga, gruppe, korridor] of [['1. Liga', bl1, KORRIDOR.schnittBl1], ['2. Liga', bl2, KORRIDOR.schnittBl2]]) {
    const s = schnitt(gruppe);
    const [min, max] = korridor;
    if (s < min || s > max) {
      FEHL(`K1 Seed ${seed}: ${liga} zahlt im Schnitt ${proz(s)} % vom Umsatz — Korridor ${min}–${max} %`);
    } else {
      OK(`K1 Seed ${seed}: ${liga} im Schnitt ${proz(s)} % `
        + `(Einzelwerte ${proz(Math.min(...gruppe.map(r => r.quote)))}–${proz(Math.max(...gruppe.map(r => r.quote)))} %)`);
    }
  }

  // --- K2: Ausreißer nach oben -------------------------------------------
  const hart = zeilen.filter(r => r.quote > KORRIDOR.quoteHart);
  const absurd = zeilen.filter(r => r.quote > KORRIDOR.quoteAbsurd);
  for (const r of absurd) {
    FEHL(`K2 Seed ${seed}: ${r.name} zahlt ${proz(r.quote)} % vom Umsatz — mehr als ${KORRIDOR.quoteAbsurd} % zahlt kein Verein`);
  }
  if (hart.length > KORRIDOR.maxUeberHart) {
    FEHL(`K2 Seed ${seed}: ${hart.length} Vereine über ${KORRIDOR.quoteHart} % (erlaubt ${KORRIDOR.maxUeberHart}) — `
      + hart.slice(0, 8).map(r => `${r.name} ${proz(r.quote)} %`).join(', '));
  } else if (!absurd.length) {
    OK(`K2 Seed ${seed}: ${hart.length} Verein(e) über ${KORRIDOR.quoteHart} %`
      + (hart.length ? ` (${hart.map(r => `${r.name} ${proz(r.quote)} %`).join(', ')})` : ''));
  }

  // --- K3: tragbare Gehaltsquote (die Fixkostenprobe) ---------------------
  const eng = zeilen.filter(r => r.tragbar < KORRIDOR.tragbarMin);
  for (const r of eng) {
    FEHL(`K3 Seed ${seed}: ${r.name} bleiben nach den Fixkosten nur ${proz(r.tragbar)} % vom Umsatz `
      + `(Grenze ${KORRIDOR.tragbarMin} %) — dort hilft keine Gehaltsskala`);
  }
  for (const [liga, gruppe, grenze] of [['1. Liga', bl1, KORRIDOR.tragbarSchnittBl1], ['2. Liga', bl2, KORRIDOR.tragbarSchnittBl2]]) {
    const s = tragbarSchnitt(gruppe);
    if (s < grenze) FEHL(`K3 Seed ${seed}: ${liga} trägt im Schnitt nur ${proz(s)} % Gehaltsquote (Soll mindestens ${grenze} %)`);
    else if (!eng.length) OK(`K3 Seed ${seed}: ${liga} trägt im Schnitt ${proz(s)} % (schwächster Verein ${proz(Math.min(...gruppe.map(r => r.tragbar)))} %)`);
  }

  // --- K4: wie viele wirtschaften defizitär? ------------------------------
  const negativ = zeilen.filter(r => r.betrieb < 0);
  if (negativ.length > KORRIDOR.maxNegativBetrieb) {
    FEHL(`K4 Seed ${seed}: ${negativ.length} von ${zeilen.length} Vereinen mit negativem Betriebsergebnis `
      + `(erlaubt ${KORRIDOR.maxNegativBetrieb}) — ` + negativ.slice(0, 8).map(r => `${r.name} ${mio(r.betrieb)}`).join(', '));
  } else {
    OK(`K4 Seed ${seed}: ${negativ.length} von ${zeilen.length} Vereinen mit negativem Betriebsergebnis`
      + (negativ.length ? ` (${negativ.slice(0, 6).map(r => `${r.name} ${mio(r.betrieb)}`).join(', ')}${negativ.length > 6 ? ' …' : ''})` : ''));
  }

  // --- K5: wie tief? -----------------------------------------------------
  const tief = zeilen.filter(r => r.betrieb < KORRIDOR.minBetriebsergebnis);
  for (const r of tief) {
    FEHL(`K5 Seed ${seed}: ${r.name} erwirtschaftet ${mio(r.betrieb)} Mio Betriebsverlust (Grenze ${mio(KORRIDOR.minBetriebsergebnis)} Mio)`);
  }
  if (!tief.length) {
    const schlechteste = zeilen.reduce((a, b) => (a.betrieb <= b.betrieb ? a : b));
    OK(`K5 Seed ${seed}: schlechtestes Betriebsergebnis ${mio(schlechteste.betrieb)} Mio (${schlechteste.name})`);
  }

  // --- K6: Kontostand ----------------------------------------------------
  const ueberzogen = zeilen.filter(r => r.balance < KORRIDOR.minKonto);
  for (const r of ueberzogen) {
    FEHL(`K6 Seed ${seed}: ${r.name} steht mit ${mio(r.balance)} Mio im Minus (Grenze ${mio(KORRIDOR.minKonto)} Mio)`);
  }
  if (!ueberzogen.length) {
    const tiefstes = zeilen.reduce((a, b) => (a.balance <= b.balance ? a : b));
    OK(`K6 Seed ${seed}: tiefstes Konto ${mio(tiefstes.balance)} Mio (${tiefstes.name})`);
  }

  // --- H1: Hackordnung ---------------------------------------------------
  const nachLohn = bl1.slice().sort((a, b) => b.lohnsumme - a.lohnsumme);
  const oben = nachLohn[0], unten = nachLohn[nachLohn.length - 1];
  if (oben.clubId !== 'bayern') {
    FEHL(`H1 Seed ${seed}: höchste Lohnsumme der 1. Liga hat ${oben.name} (${mio(oben.lohnsumme)}), nicht Bayern`);
  } else if (unten.clubId !== 'heidenheim') {
    WARN(`H1 Seed ${seed}: niedrigste Lohnsumme der 1. Liga hat ${unten.name} (${mio(unten.lohnsumme)}), nicht Heidenheim`);
    OK(`H1 Seed ${seed}: Bayern führt die Lohntabelle an (${mio(oben.lohnsumme)} Mio)`);
  } else {
    const abstand = oben.lohnsumme / Math.max(1, unten.lohnsumme);
    OK(`H1 Seed ${seed}: Bayern ${mio(oben.lohnsumme)} Mio … Heidenheim ${mio(unten.lohnsumme)} Mio (Faktor ${round(abstand, 1)})`);
  }
}

/* ------------------------------------------------------------------ *
 *  Hauptlauf
 * ------------------------------------------------------------------ */

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  TRAUMVEREIN – Wirtschaftsprüfstand (Gehaltsskala)           ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`  Seeds: ${seeds.join(', ')} · eine komplette Saison je Seed · Verein: ${EIGENER_VEREIN}`);

const gesamt = [];

for (const seed of seeds) {
  abschnitt(`Seed ${seed}`);

  let state;
  try {
    state = createNewGame({ seed, clubId: EIGENER_VEREIN, managerName: 'Prüfstand' });
  } catch (err) {
    FEHL(`Seed ${seed}: createNewGame() ist gescheitert – ${err && err.message}`);
    continue;
  }

  const protokoll = await saisonSpielen(state);
  if (protokoll.fehler.length) {
    for (const t of protokoll.fehler.slice(0, 5)) FEHL(`Seed ${seed}: ${t}`);
  }
  if (state.date.day < 300) {
    FEHL(`Seed ${seed}: Saison endet schon an Tag ${state.date.day} – Messung wertlos`);
    continue;
  }

  const lohn = lohnsummen(state);

  // Erst der Saisonwechsel bucht die TV-Schlussabrechnung. Ohne ihn fehlten
  // jedem Verein rund 25 % seiner TV-Gelder.
  try {
    await saisonWechsel(state, makeCtx(state));
  } catch (err) {
    FEHL(`Seed ${seed}: saisonWechsel() ist gescheitert – ${err && err.message}`);
    continue;
  }

  const zeilen = PROFI_IDS.map(id => auswerten(state, id, lohn))
    .sort((a, b) => b.einnahmen - a.einnahmen);

  if (seed === seeds[0] || ALLE_TABELLEN) {
    console.log('');
    tabelleAusgeben(zeilen);
    if (POSTEN) postenAusgeben(zeilen);
    console.log('');
  }

  korridorePruefen(zeilen, seed);
  gesamt.push({ seed, zeilen });
}

/* ------------------------------------------------------------------ *
 *  Zusammenfassung
 * ------------------------------------------------------------------ */

abschnitt('Zusammenfassung');

if (gesamt.length) {
  const alle = gesamt.flatMap(g => g.zeilen);
  const bl1 = alle.filter(r => r.liga === 'bl1');
  const bl2 = alle.filter(r => r.liga === 'bl2');
  const schnitt = a => a.reduce((s, r) => s + r.quote, 0) / Math.max(1, a.length);
  console.log(`  1. Liga: Gehaltsquote ${proz(Math.min(...bl1.map(r => r.quote)))} – ${proz(Math.max(...bl1.map(r => r.quote)))} %`
    + ` (Schnitt ${proz(schnitt(bl1))} %)`);
  console.log(`  2. Liga: Gehaltsquote ${proz(Math.min(...bl2.map(r => r.quote)))} – ${proz(Math.max(...bl2.map(r => r.quote)))} %`
    + ` (Schnitt ${proz(schnitt(bl2))} %)`);
  console.log(`  Vereine mit negativem Saisonergebnis: ${gesamt.map(g => `Seed ${g.seed}: ${g.zeilen.filter(r => r.ergebnis < 0).length}/36`).join(' · ')}`);
  console.log(`  Vereine mit überzogenem Konto:        ${gesamt.map(g => `Seed ${g.seed}: ${g.zeilen.filter(r => r.balance < 0).length}/36`).join(' · ')}`);

  // Wie viel Gehalt trägt die Kostenstruktur überhaupt? Ohne diese Zahl ist
  // nicht zu unterscheiden, ob ein Verein zu viel zahlt oder zu wenig einnimmt.
  const tragbarSchnitt = a => a.reduce((s, r) => s + r.tragbar, 0) / Math.max(1, a.length);
  console.log(`  Tragbare Gehaltsquote (Einnahmen minus Fixkosten, ohne Transfers):`
    + ` 1. Liga ${proz(tragbarSchnitt(bl1))} % im Schnitt (${proz(Math.min(...bl1.map(r => r.tragbar)))} – ${proz(Math.max(...bl1.map(r => r.tragbar)))} %),`
    + ` 2. Liga ${proz(tragbarSchnitt(bl2))} % (${proz(Math.min(...bl2.map(r => r.tragbar)))} – ${proz(Math.max(...bl2.map(r => r.tragbar)))} %)`);
  const summe = (a, k) => a.reduce((s, r) => s + r[k], 0) / Math.max(1, gesamt.length);
  console.log(`  Ligasumme je Saison: 1. Liga Einnahmen ${mio(summe(bl1, 'einnahmen'))} / Ausgaben ${mio(summe(bl1, 'ausgaben'))},`
    + ` 2. Liga Einnahmen ${mio(summe(bl2, 'einnahmen'))} / Ausgaben ${mio(summe(bl2, 'ausgaben'))} Mio`);
}

console.log('');
if (fehler.length) {
  console.log(`  ${fehler.length} Korridorverletzung(en):`);
  for (const t of fehler) console.log('   · ' + t);
}
if (warnungen.length) {
  console.log(`  ${warnungen.length} Hinweis(e):`);
  for (const t of warnungen) console.log('   · ' + t);
}
if (!fehler.length) console.log('  Alle Zielkorridore eingehalten.');

process.exit(fehler.length ? 1 : 0);
