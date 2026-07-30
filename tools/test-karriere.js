/**
 * tools/test-karriere.js — Zehn Jahre Karriere ohne einen einzigen Anpfiff.
 *
 *   node tools/test-karriere.js                # Standard: Seed 7, 10 Saisons
 *   node tools/test-karriere.js 42             # eigener Seed
 *   node tools/test-karriere.js --saisons=15   # längerer Lauf
 *   node tools/test-karriere.js --schnell      # 5 Saisons, ohne Determinismusprobe
 *
 * Geprüft wird ausschließlich `src/club/karriere.js` (Roadmap-Stufe 1, Punkte
 * 6–9) plus die Alterung. Es wird KEIN Spiel simuliert: Der Prüfstand erfindet
 * je Saison eine plausible Statistik (Einsätze, Tore, Noten), lässt danach die
 * Karriereenden laufen, regeneriert, schreibt Trainerlaufbahn und Chronik fort
 * und altert die Welt um ein Jahr. Genau dieser Kreislauf entscheidet darüber,
 * ob eine Karriere über zehn Jahre trägt oder ob die Kader ausbluten.
 *
 * GERÜST STATT ECHTEM SPIELBETRIEB — bewusst und benannt:
 *   · Statistik je Saison wird gewürfelt, nicht gespielt.
 *   · club/youth.js läuft hier nicht im Tagestakt. Der Prüfstand ersetzt seine
 *     Entwicklungskurve durch eine grobe Näherung (talentEntwickeln) und zieht
 *     Talente ab 20 über das echte `befoerdern()` in den Profikader.
 *   · club/transfers.js läuft nicht. Der Prüfstand bildet nur den einen Teil
 *     nach, ohne den die Bevölkerung nicht im Gleichgewicht bleibt: auslaufende
 *     Verträge, Verlängerungen und ein rudimentärer Markt für vertragslose
 *     Spieler (vertraegeUndMarkt) — nachgebaut nach transfers.js:MIN_KADER
 *     und saisonEndeVertraege().
 *
 * Rückgabe: Exit-Code 1, sobald eine Zusicherung fehlschlägt.
 */

import { createNewGame, serialize } from '../src/core/state.js';
import { createRng } from '../src/core/rng.js';
import { clamp, round } from '../src/core/util.js';
import { POSITION_GROUP, ATTRIBUTES } from '../src/core/constants.js';
import { playerOverall } from '../src/engine/ratings.js';
import { LEAGUE_IDS } from '../src/data/leagues.js';
import { befoerdern } from '../src/club/youth.js';

import {
  karriereenden, regenerieren, managerSaison, titelChronik,
  elfDerSaison, spielerDerSaison, torschuetzenkoenig, abschiedsbericht,
  ruecktrittsChance, SKILL_KEYS
} from '../src/club/karriere.js';

/* ------------------------------------------------------------------ *
 *  Argumente
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const SCHNELL = args.includes('--schnell');
const saisonArg = args.find(a => a.startsWith('--saisons='));
const seedArg = args.filter(a => /^\d+$/.test(a)).map(Number);

const SEED = seedArg.length ? seedArg[0] : 7;
/* Zwanzig Saisons, nicht zehn.
 *
 * Der Startkader ist von Hand geschrieben, und seit Roadmap-Stufe 5 gilt das für
 * ALLE 864 Profis — jeder Verein tritt mit seinen Legenden in Bestform an, also
 * mit einem Jahrgangsberg um die 27. Der wandert als Welle durch die Spielwelt:
 * Der Anteil der Spieler ab 33 steigt von 4 % auf 46 % (Saison 8), fällt dann
 * wieder und ist ab Saison 14 bei 13–17 %. Erst dort steht das Gleichgewicht,
 * das die Rücktrittskurve vorgibt (⌀ 27,0 Jahre).
 *
 * Zehn Saisons enden mitten in dieser Welle und messen deshalb ihren Scheitel
 * statt des Gleichgewichts. Zwanzig kosten 0,3 Sekunden mehr und messen, was
 * Z2 zu messen behauptet. */
const SAISONS = saisonArg ? Math.max(2, parseInt(saisonArg.split('=')[1], 10) || 20) : (SCHNELL ? 14 : 20);
const EIGENER_VEREIN = 'hsv';

/* --- Korridore ---------------------------------------------------- */
const ALTER_MAX = 42;
const ALTER_SCHNITT_MIN = 24.0, ALTER_SCHNITT_MAX = 30.0;
const ALTER_EINSCHWINGEN_MAX = 1.0;      // Drift im letzten Drittel des Laufs
const ALTER_ANTEIL_ALT_MAX = 0.40;       // höchstens so viele ab 33
const KADER_MIN = 18, KADER_MAX = 32;
const SKILL_DECKE = 92;
const KORRIDOR_SAISON = 8;               // „acht erfolgreiche Saisons"
const KORRIDOR_MIN = 70, KORRIDOR_MAX = 80;
const PASSIV_ABSTAND_MIN = 8;            // so viel muss ein aktiver Trainer vorn liegen
const RUECKTRITTSQUOTE_MIN = 0.015, RUECKTRITTSQUOTE_MAX = 0.13;
const TORJAEGER_MIN = 10;
const OVR_VERFALL_MAX = 6;

/* ------------------------------------------------------------------ *
 *  Mini-Testgerüst (Stil wie tools/test-saison.js)
 * ------------------------------------------------------------------ */

const ZTITEL = {
  1: 'Kein Spieler älter als 42 unter Vertrag',
  2: 'Altersverteilung bleibt stabil',
  3: 'Für jeden Abgang entsteht Ersatz',
  4: 'Kadergrößen bleiben zwischen 18 und 32',
  5: 'Keine Geisterspieler in Aufstellung, Bank und Standards',
  6: 'Manager-Fähigkeiten wachsen monoton und bleiben unter der Decke',
  7: 'Trainerbonus nach 8 erfolgreichen Saisons im Korridor 70–80',
  8: 'Ein untätiger Trainer wächst deutlich langsamer',
  9: 'Rücktrittsquote bleibt plausibel',
  10: 'history.titel und history.rekorde werden fortgeschrieben',
  11: 'Elf der Saison ist vollständig und positionsgerecht',
  12: 'Torschützenkönig existiert und hat mindestens 10 Tore',
  13: 'Gleicher Seed, gleiches Ergebnis (Determinismus)',
  14: 'Die Ligastärke der 1. Liga tropft nicht weg'
};

const zstat = {};
for (const nr of Object.keys(ZTITEL)) zstat[nr] = { ok: 0, fehl: 0, meldungen: [] };

function z(nr, bedingung, ist) {
  const e = zstat[nr];
  const txt = `Z${String(nr).padStart(2)}  ${ZTITEL[nr]}`;
  if (bedingung) { e.ok++; console.log(`    [ok]   ${txt}  (ist: ${ist})`); }
  else { e.fehl++; e.meldungen.push(ist); console.log(`    [FEHL] ${txt}  -> ist: ${ist}`); }
}

const hinweise = [];
const H = t => { hinweise.push(t); console.log(`    [hinw] ${t}`); };
const abschnitt = t => console.log('\n=== ' + t + ' ===');
const unterpunkt = t => console.log('  ' + t);
const nz = (v, n = 1) => round(v, n).toFixed(n).replace('.', ',');
const mb = b => (b / 1048576).toFixed(2).replace('.', ',') + ' MB';

/* ------------------------------------------------------------------ *
 *  Gerüst: Statistik, Entwicklung, Alterung
 * ------------------------------------------------------------------ */

/** Torneigung je Position – grob an einer echten Ligasaison orientiert. */
const TOR_FAKTOR = {
  ST: 1.00, LA: 0.68, RA: 0.68, OM: 0.52, ZM: 0.28, LM: 0.32, RM: 0.32,
  DM: 0.12, IV: 0.12, LV: 0.08, RV: 0.08, TW: 0
};

/** Profikader eines Vereins, nach Stärke sortiert. */
function kaderSortiert(state, club) {
  return club.playerIds
    .map(id => state.players[id])
    .filter(p => p && !p.retired)
    .map(p => ({ p, ovr: playerOverall(p) }))
    .sort((a, b) => b.ovr - a.ovr);
}

/**
 * Erfindet für eine Saison eine plausible Statistik: Stammelf spielt fast
 * durch, Rotation die Hälfte, der Rest kaum. Ohne diese Zahlen hätten
 * elfDerSaison(), spielerDerSaison() und torschuetzenkoenig() nichts zu tun.
 */
function statistikErfinden(state, rng) {
  for (const clubId of Object.keys(state.clubs).sort()) {
    const club = state.clubs[clubId];
    if (!club.playerIds || !club.playerIds.length) continue;
    const rang = kaderSortiert(state, club);

    for (let i = 0; i < rang.length; i++) {
      const { p, ovr } = rang[i];
      const r = rng.fork('stat:' + p.id);
      const rolle = i < 11 ? 0 : i < 18 ? 1 : 2;
      const spiele = clamp(Math.round(r.gauss(rolle === 0 ? 29 : rolle === 1 ? 16 : 5, 4)), 0, 34);
      const minuten = Math.round(spiele * r.float(62, 90));
      const tf = TOR_FAKTOR[p.position] !== undefined ? TOR_FAKTOR[p.position] : 0.2;
      const tore = Math.max(0, Math.round(
        r.gauss(tf * Math.max(0, ovr - 45) * 0.52, 2.4) * (spiele / 30)));
      const vorlagen = Math.max(0, Math.round(r.gauss(tf * 6 + 1.5, 1.8) * (spiele / 30)));

      const s = p.stats.season;
      s.spiele = spiele;
      s.startelf = rolle === 0 ? spiele : Math.round(spiele * 0.5);
      s.minuten = minuten;
      s.tore = tore;
      s.vorlagen = vorlagen;
      s.motm = Math.max(0, Math.round(r.gauss((ovr - 68) * 0.12 + tore * 0.12, 0.9)));
      s.notenAnzahl = spiele;
      s.notenSumme = spiele
        ? spiele * clamp(r.gauss(5.6 + (ovr - 62) * 0.035, 0.35), 3.2, 9.4)
        : 0;
      if (p.position === 'TW') s.zuNull = Math.round(spiele * r.float(0.15, 0.4));
    }
  }
}

/**
 * Ersatz für die Wochenentwicklung aus club/youth.js und club/training.js, die
 * hier beide nicht laufen. Skaliert die Attribute um den Faktor, der die
 * Gesamtstärke ein Stück Richtung Potenzial schiebt.
 */
function talentEntwickeln(p, rng) {
  const ovr = playerOverall(p);
  const pot = p.potential || ovr;
  if (pot <= ovr) return;
  const ziel = Math.min(pot, ovr + clamp((pot - ovr) * 0.32, 0, 12) * rng.float(0.7, 1.25));
  const f = ziel / Math.max(1, ovr);
  for (const k of ATTRIBUTES) {
    if (typeof p.attributes[k] !== 'number') continue;
    p.attributes[k] = clamp(Math.round(p.attributes[k] * f), 3, 99);
  }
}

/** Ein Jahr weiter: altern, Nachwuchs entwickeln und befördern, Statistik umbuchen. */
function jahreswechsel(state, rng) {
  const bilanz = { befoerdert: 0, ausgemustert: 0 };

  for (const pid of Object.keys(state.players).sort()) {
    const p = state.players[pid];
    if (!p || p.retired) continue;
    p.age++;
    // Junge Profis entwickeln sich in Wirklichkeit über club/training.js
    // weiter. Ohne diesen Ersatz käme jeder Aufsteiger aus der Jugend auf
    // ewig unter seinem Potenzial an und die Ligastärke sänke künstlich.
    if (p.age <= 23 && !p.jugend) talentEntwickeln(p, rng.fork('reifen:' + pid));
    p.stats.history.push(Object.assign({ season: state.date.season, clubId: p.clubId }, p.stats.season));
    if (p.stats.history.length > 12) p.stats.history.shift();
    for (const k in p.stats.season) p.stats.career[k] = (p.stats.career[k] || 0) + p.stats.season[k];
    for (const k in p.stats.season) p.stats.season[k] = 0;
  }

  // Nachwuchs: entwickeln, ab 20 in den Profikader oder weg (wie club/youth.js).
  for (const clubId of Object.keys(state.clubs).sort()) {
    const club = state.clubs[clubId];
    const y = club.youth;
    if (!y || !Array.isArray(y.talente)) continue;
    for (const tid of y.talente.slice()) {
      const p = state.players[tid];
      if (!p || p.retired) { y.talente = y.talente.filter(id => id !== tid); continue; }
      talentEntwickeln(p, rng.fork('entw:' + tid));
      if (p.age < 20) continue;
      const res = befoerdern(state, tid);
      if (res.ok) bilanz.befoerdert++;
      else {
        y.talente = y.talente.filter(id => id !== tid);
        p.clubId = null;
        p.jugend = false;
        state.freeAgents.push(p.id);
        bilanz.ausgemustert++;
      }
    }
  }

  state.date.season++;
  state.date.day = 0;
  state.tick++;
  return bilanz;
}

/* ------------------------------------------------------------------ *
 *  Gerüst: Verträge und ein rudimentärer Markt
 *
 *  Ohne diesen Teil altert die Welt unaufhaltsam: Es kämen jede Saison
 *  Nachwuchsspieler dazu, aber außer den Rücktritten verließe niemand mehr
 *  einen Kader. Nachgebaut ist genau das, was club/transfers.js am Saisonende
 *  tut (saisonEndeVertraege, MIN_KADER = 20) — nicht mehr.
 * ------------------------------------------------------------------ */

const MARKT_MIN_KADER = 20;
const MARKT_SOLL_KADER = 24;

function ausKader(state, club, p) {
  club.playerIds = club.playerIds.filter(id => id !== p.id);
  const t = club.tactics;
  if (t) {
    if (t.lineup) for (const slot in t.lineup) if (t.lineup[slot] === p.id) delete t.lineup[slot];
    if (Array.isArray(t.bench)) t.bench = t.bench.filter(id => id !== p.id);
    if (t.setPieces) for (const k in t.setPieces) if (t.setPieces[k] === p.id) t.setPieces[k] = null;
    if (t.roles && t.roles[p.id]) delete t.roles[p.id];
  }
  p.clubId = null;
  p.captain = false;
}

function vertraegeUndMarkt(state, rng) {
  const saison = state.date.season;
  const bilanz = { verlaengert: 0, abgaenge: 0, verpflichtet: 0 };
  const clubIds = Object.keys(state.clubs)
    .filter(id => !state.clubs[id].lazySquad && state.clubs[id].playerIds.length)
    .sort();

  /* --- 1. Verlängern oder gehen lassen --------------------------------- */
  for (const clubId of clubIds) {
    const club = state.clubs[clubId];
    const r = rng.fork('vertrag:' + clubId);
    const rang = kaderSortiert(state, club);

    for (let i = 0; i < rang.length; i++) {
      const p = rang[i].p;
      if (!p.contract || p.contract.until > saison) continue;
      // Bedingung und Wahrscheinlichkeit exakt wie kiVertraegeVerlaengern()
      // in club/transfers.js: Leistungsträger und Junge, sonst nicht.
      const wichtig = i < 15 || p.age <= 23;
      if (wichtig && r.chance(0.5)) {
        p.contract.until = saison + r.int(2, 4);
        bilanz.verlaengert++;
      }
    }
    for (let i = rang.length - 1; i >= 0; i--) {
      const p = rang[i].p;
      if (!p.contract || p.contract.until > saison) continue;
      if (club.playerIds.length <= MARKT_MIN_KADER) { p.contract.until = saison + 1; continue; }
      ausKader(state, club, p);
      state.freeAgents.push(p.id);
      bilanz.abgaenge++;
    }
  }

  /* --- 2. Vertragslose verteilen (wer stärker ist, greift zuerst zu) ----
   * Die KI in club/transfers.js bewertet nicht nur die Stärke, sondern auch
   * den Wiederverkaufswert (mindestVerbesserung, wechselGrund). Deshalb hier
   * ein Altersabschlag: Ein 33-Jähriger muss deutlich besser sein als ein
   * 24-Jähriger, um genommen zu werden. Wer übrig bleibt, bleibt vereinslos —
   * und genau dort greift der Modifikator M_OHNE_VEREIN aus karriere.js.
   */
  const pool = state.freeAgents
    .map(id => state.players[id])
    .filter(p => p && !p.retired && !p.clubId)
    .map(p => ({
      p,
      wert: playerOverall(p) - Math.max(0, p.age - 27) * 2.2 + Math.max(0, 24 - p.age) * 0.8
    }))
    .sort((a, b) => b.wert - a.wert);
  let cursor = 0;

  const nachRuf = clubIds.slice().sort((a, b) =>
    (state.clubs[b].reputation || 50) - (state.clubs[a].reputation || 50));
  for (const clubId of nachRuf) {
    const club = state.clubs[clubId];
    const r = rng.fork('markt:' + clubId);
    // Wie mindestVerbesserung() in club/transfers.js: Ein Zugang muss den
    // Kader besser machen. Nur bei akuter Not wird jeder genommen.
    let schwaechster = kaderSortiert(state, club);
    let schwelle = schwaechster.length ? schwaechster[schwaechster.length - 1].ovr : 0;
    while (club.playerIds.length < MARKT_SOLL_KADER && cursor < pool.length) {
      const { p } = pool[cursor];
      if (p.clubId || p.retired) { cursor++; continue; }
      const not = club.playerIds.length < MARKT_MIN_KADER;
      if (!not && (p.age > 33 || playerOverall(p) <= schwelle)) break;
      cursor++;
      p.clubId = clubId;
      p.contract = Object.assign({}, p.contract, { until: saison + r.int(2, 4) });
      club.playerIds.push(p.id);
      bilanz.verpflichtet++;
      schwaechster = kaderSortiert(state, club);
      schwelle = schwaechster.length ? schwaechster[schwaechster.length - 1].ovr : 0;
    }
  }
  state.freeAgents = state.freeAgents.filter(id => {
    const p = state.players[id];
    return p && !p.retired && !p.clubId;
  });

  return bilanz;
}

/* ------------------------------------------------------------------ *
 *  Gerüst: Ergebnisse und Tabellen (nur damit die Chronik etwas findet)
 * ------------------------------------------------------------------ */

function ergebnisseErfinden(state, saison, rng) {
  // Alte Kunstergebnisse wegwerfen – der Spielstand soll nicht anschwellen.
  state.fixtures = state.fixtures.filter(f => f.season === saison && f.kunst !== true);
  const neue = [];
  for (const ligaId of LEAGUE_IDS) {
    const ids = Object.keys(state.clubs).filter(id => state.clubs[id].leagueId === ligaId);
    if (ids.length < 2) continue;
    for (let spieltag = 1; spieltag <= 34; spieltag++) {
      const misch = rng.shuffle(ids);
      for (let i = 0; i + 1 < misch.length; i += 2) {
        const h = rng.int(0, 5), a = rng.int(0, 4);
        neue.push({
          id: `kf_${ligaId}_${saison}_${spieltag}_${i}`, kunst: true,
          competitionId: ligaId, season: saison, matchday: spieltag,
          dayIndex: spieltag * 7, homeId: misch[i], awayId: misch[i + 1],
          played: true, result: { score: [h, a], stats: null }
        });
      }
    }
  }
  state.fixtures.push(...neue);
}

function tabellenErfinden(state, saison) {
  for (const ligaId of LEAGUE_IDS) {
    const ids = Object.keys(state.clubs).filter(id => state.clubs[id].leagueId === ligaId);
    const zeilen = ids
      .map(id => ({ clubId: id, ruf: state.clubs[id].reputation || 50 }))
      .sort((a, b) => b.ruf - a.ruf)
      .map((e, i) => ({
        clubId: e.clubId, platz: i + 1, punkte: 80 - i * 3,
        tore: 70 - i * 2, gegentore: 30 + i * 2, diff: 40 - i * 4
      }));
    state.tables[ligaId] = zeilen;
  }
}

/* ------------------------------------------------------------------ *
 *  Gerüst: ein aktiver, erfolgreicher Trainer
 * ------------------------------------------------------------------ */

/** Setzt genau die Felder, aus denen karriere.js die „Nutzung" abliest. */
function trainerAktivitaet(state, aktiv) {
  const club = state.clubs[state.managerClubId];
  if (!club) return;

  club.training = club.training || {};
  club.training.intensitaet = aktiv ? 78 : 42;
  club.training.schwerpunkt = aktiv ? 'offensiv' : 'ausgeglichen';
  club.training.wochenplan = aktiv ? { tage: [] } : null;

  club.moral = aktiv ? 74 : 52;
  club.kabine = club.kabine || {};
  club.kabine.teamgeist = aktiv ? 72 : 55;
  club.kabine.letzteAnsprache = aktiv ? { tag: 300, art: 'lob' } : null;

  club.tactics = club.tactics || {};
  if (aktiv) {
    const ersterId = (club.playerIds || [])[0];
    club.tactics.roles = ersterId ? { [ersterId]: 'spielmacher' } : {};
    club.tactics.instructions = { zeitspiel: false, langeBaelle: false, flankenSpiel: true, abseitsfalle: false };
    club.tactics.sliders = { tempo: 68, breite: 55, pressinghoehe: 65, risiko: 60, haerte: 50, offensivdrang: 70 };
  } else {
    club.tactics.roles = {};
    club.tactics.instructions = { zeitspiel: false, langeBaelle: false, flankenSpiel: false, abseitsfalle: false };
    club.tactics.sliders = { tempo: 50, breite: 50, pressinghoehe: 50, risiko: 50, haerte: 50, offensivdrang: 50 };
  }

  club.youth = club.youth || { akademie: 50, talente: [], scoutingRegionen: [], naechsteSichtung: 0, jahrgang: [] };
  club.youth.akademie = aktiv ? 78 : 40;
}

/** Fügt die Spuren einer Saison hinzu, aus denen die Nutzung berechnet wird. */
function saisonSpurenLegen(state, aktiv, saison) {
  const m = state.manager;
  const spiele = aktiv ? 40 : 34;
  m.bilanz.spiele += spiele;
  m.bilanz.siege += aktiv ? 24 : 10;
  m.bilanz.unentschieden += aktiv ? 8 : 10;
  m.bilanz.niederlagen += spiele - (aktiv ? 32 : 20);

  state.history.transfers = state.history.transfers || [];
  for (let i = 0; i < (aktiv ? 6 : 1); i++) {
    state.history.transfers.push({
      season: saison, day: 30, playerId: `kunst_${saison}_${i}`, name: 'Kunstfigur',
      vonId: null, zuId: state.managerClubId, ablose: 1000000, gehalt: 500000, typ: 'transfer'
    });
  }

  state.presse = state.presse || { druck: 50, offeneFragen: [], beantwortet: [], geruechte: [], ankuendigungen: [], letztePk: -99, glaubwuerdigkeit: 60, archiv: [] };
  for (let i = 0; i < (aktiv ? 10 : 1); i++) {
    state.presse.beantwortet.push({ saison, frage: 'kunst', antwort: 'kunst' });
  }
  state.presse.glaubwuerdigkeit = aktiv ? 74 : 52;
}

/** Bericht, wie ihn loop.js:saisonWechsel liefern wird. */
function berichtBauen(state, saison, aktiv, elf, tk, sds) {
  const meineId = state.managerClubId;
  const meineLiga = state.clubs[meineId].leagueId;
  const bl1 = state.tables.bl1 || [];
  const platz = aktiv ? (saison % 3 === 0 ? 1 : saison % 3 === 1 ? 2 : 3) : 13;
  return {
    season: saison,
    tabellen: { bl1: state.tables.bl1, bl2: state.tables.bl2 },
    meister: aktiv && platz === 1 ? meineId : (bl1[0] ? bl1[0].clubId : null),
    pokalsieger: aktiv && saison % 4 === 0 ? meineId : (bl1[1] ? bl1[1].clubId : null),
    aufsteiger: [], absteiger: [],
    relegation: null,
    torschuetzenkoenig: tk,
    elfDerSaison: elf,
    spielerDerSaison: sds,
    eigenerPlatz: platz,
    eigeneLiga: meineLiga,
    ruecktritte: [], neueTalente: [],
    manager: null,
    vorstandsurteil: { note: aktiv ? 1.5 : 3.8, text: '', entlassen: false },
    praemien: {}
  };
}

/* ------------------------------------------------------------------ *
 *  Messungen
 * ------------------------------------------------------------------ */

function profis(state) {
  const out = [];
  for (const clubId of Object.keys(state.clubs)) {
    const club = state.clubs[clubId];
    if (!Array.isArray(club.playerIds)) continue;
    for (const pid of club.playerIds) {
      const p = state.players[pid];
      if (p && !p.retired) out.push(p);
    }
  }
  return out;
}

function altersbild(state) {
  const alle = profis(state).map(p => p.age).sort((a, b) => a - b);
  if (!alle.length) return { n: 0, schnitt: 0, median: 0, min: 0, max: 0, anteilAlt: 0, anteilJung: 0 };
  return {
    n: alle.length,
    schnitt: alle.reduce((a, b) => a + b, 0) / alle.length,
    median: alle[Math.floor(alle.length / 2)],
    min: alle[0],
    max: alle[alle.length - 1],
    anteilAlt: alle.filter(a => a >= 33).length / alle.length,
    anteilJung: alle.filter(a => a <= 21).length / alle.length
  };
}

function ligaOverall(state, ligaId) {
  const werte = [];
  for (const clubId of Object.keys(state.clubs)) {
    if (state.clubs[clubId].leagueId !== ligaId) continue;
    for (const pid of state.clubs[clubId].playerIds) {
      const p = state.players[pid];
      if (p && !p.retired) werte.push(playerOverall(p));
    }
  }
  return werte.length ? werte.reduce((a, b) => a + b, 0) / werte.length : 0;
}

function geisterspieler(state) {
  const treffer = [];
  for (const clubId of Object.keys(state.clubs).sort()) {
    const club = state.clubs[clubId];
    const t = club.tactics;
    if (!t) continue;
    const kader = new Set(club.playerIds || []);
    const pruef = (id, wo) => {
      if (!id) return;
      const p = state.players[id];
      if (!p) treffer.push(`${clubId}.${wo}: ${id} existiert nicht`);
      else if (p.retired) treffer.push(`${clubId}.${wo}: ${id} hat aufgehört`);
      else if (!kader.has(id)) treffer.push(`${clubId}.${wo}: ${id} gehört nicht zum Kader`);
    };
    if (t.lineup) for (const slot in t.lineup) pruef(t.lineup[slot], 'lineup.' + slot);
    if (Array.isArray(t.bench)) t.bench.forEach((id, i) => pruef(id, 'bench[' + i + ']'));
    if (t.setPieces) for (const k in t.setPieces) pruef(t.setPieces[k], 'setPieces.' + k);
    if (t.roles) for (const id in t.roles) pruef(id, 'roles');
  }
  return treffer;
}

function kaderSpanne(state) {
  let min = Infinity, max = 0;
  const ausreisser = [];
  for (const clubId of Object.keys(state.clubs).sort()) {
    const club = state.clubs[clubId];
    if (club.lazySquad) continue;
    const n = club.playerIds.length;
    if (n < min) min = n;
    if (n > max) max = n;
    if (n < KADER_MIN || n > KADER_MAX) ausreisser.push(`${clubId} ${n}`);
  }
  if (min === Infinity) min = 0;
  return { min, max, ausreisser };
}

const coachBonus = m => (m.skills.training + m.skills.taktik + m.skills.motivation) / 3;

/* ------------------------------------------------------------------ *
 *  Ein kompletter Lauf
 * ------------------------------------------------------------------ */

function laufen(seed, saisons, opts = {}) {
  const still = !!opts.still;
  const aktiv = opts.aktiv !== false;
  const state = createNewGame({
    clubId: EIGENER_VEREIN, managerName: 'Testtrainer', difficulty: 'profi', seed
  });
  const rng = createRng(seed * 31 + 17);

  const protokoll = [];
  const startOvr = ligaOverall(state, 'bl1');
  const startAlter = altersbild(state);
  const bonusVerlauf = [round(coachBonus(state.manager), 2)];
  const fingerabdruck = [];

  for (let saison = 1; saison <= saisons; saison++) {
    const srng = rng.fork('saison:' + saison);

    trainerAktivitaet(state, aktiv);
    statistikErfinden(state, srng.fork('stats'));
    ergebnisseErfinden(state, saison, srng.fork('ergebnisse'));
    tabellenErfinden(state, saison);
    saisonSpurenLegen(state, aktiv, saison);

    // --- Auszeichnungen (vor jedem Zurücksetzen) --------------------------
    const elf = elfDerSaison(state, 'bl1');
    const tk = torschuetzenkoenig(state, 'bl1');
    const sds = spielerDerSaison(state, 'bl1');
    const bericht = berichtBauen(state, saison, aktiv, elf, tk, sds);

    // --- Der eigentliche Prüfgegenstand ------------------------------------
    const ctx = {
      rng: srng.fork('karriere'), season: saison, day: 364,
      log: () => { }, news: () => { }
    };
    const vorher = profis(state).length;
    const enden = karriereenden(state, ctx);
    bericht.ruecktritte = enden.ruecktritte;
    const regen = regenerieren(state, ctx, { ruecktritte: enden.ruecktritte });
    bericht.neueTalente = regen.neu;
    const mgr = managerSaison(state, bericht);
    const chronik = titelChronik(state, bericht);

    const jw = jahreswechsel(state, srng.fork('jahr'));
    const markt = vertraegeUndMarkt(state, srng.fork('markt'));
    const alter = altersbild(state);
    const kader = kaderSpanne(state);

    const zeile = {
      saison, vorher,
      ruecktritte: enden.ruecktritte.length,
      legenden: enden.ruecktritte.filter(r => r.legende).length,
      abschiedsspiele: enden.ruecktritte.filter(r => r.abschiedsspiel).length,
      aeltesterRuecktritt: enden.ruecktritte.reduce((a, r) => Math.max(a, r.alter), 0),
      neu: regen.neu.length, jugend: regen.jugend,
      freieSpieler: regen.freieSpieler, nachverpflichtet: regen.nachverpflichtet,
      befoerdert: jw.befoerdert, ausgemustert: jw.ausgemustert,
      markt,
      alter, kader,
      elf: elf.length, elfListe: elf, tkTore: tk.tore, tkName: tk.kurzName,
      sds: sds ? (state.players[sds] ? state.players[sds].shortName : sds) : null,
      bonus: coachBonus(state.manager),
      level: mgr.level, erfahrung: state.manager.erfahrung,
      reputation: state.manager.reputation,
      titel: state.manager.titel.length,
      chronikSaison: chronik.saison,
      geister: geisterspieler(state),
      ovrBl1: ligaOverall(state, 'bl1')
    };
    protokoll.push(zeile);
    bonusVerlauf.push(round(zeile.bonus, 2));
    fingerabdruck.push(
      `${saison}|${zeile.ruecktritte}|${zeile.neu}|${round(zeile.bonus, 2)}|${zeile.tkTore}|${round(alter.schnitt, 3)}`);

    if (!still) {
      unterpunkt(
        `Saison ${String(saison).padStart(2)}: ${String(zeile.ruecktritte).padStart(3)} Rücktritte ` +
        `(ältester ${zeile.aeltesterRuecktritt}, ${zeile.legenden} Legenden, ${zeile.abschiedsspiele} Abschiedsspiele) · ` +
        `Ersatz ${String(zeile.neu).padStart(3)} (${zeile.jugend} Jugend / ${zeile.freieSpieler} Markt / ${zeile.nachverpflichtet} nachverpflichtet)`);
      unterpunkt(
        `            Gerüst: ${zeile.befoerdert} befördert, ${markt.verlaengert} verlängert, ` +
        `${markt.abgaenge} Verträge ausgelaufen, ${markt.verpflichtet} vertragslos verpflichtet`);
      unterpunkt(
        `            Alter ⌀ ${nz(alter.schnitt, 2)} (Median ${alter.median}, ${alter.min}–${alter.max}, ` +
        `${nz(alter.anteilAlt * 100)} % ab 33) · Kader ${kader.min}–${kader.max} · ` +
        `Torjäger ${zeile.tkName} ${zeile.tkTore} · Trainerbonus ${nz(zeile.bonus, 1)} (Stufe ${zeile.level})`);
    }
  }

  return {
    state, protokoll, startOvr, startAlter, bonusVerlauf,
    fingerabdruck: fingerabdruck.join(';')
  };
}

/* ------------------------------------------------------------------ *
 *  Lauf 1: die volle Karriere
 * ------------------------------------------------------------------ */

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  TRAUMVEREIN – Karriere-Prüfstand (club/karriere.js)         ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`  Seed ${SEED} · ${SAISONS} Saisons · Verein ${EIGENER_VEREIN} · keine Spiele, nur Alterung`);

const t0 = Date.now();

abschnitt('A) Zehn Jahre im Zeitraffer (aktiver Trainer)');
const lauf = laufen(SEED, SAISONS, { aktiv: true });
const p = lauf.protokoll;
const state = lauf.state;

abschnitt('B) Zusicherungen');

/* --- Z1: Altersgrenze ------------------------------------------------- */
{
  const zuAlt = profis(state).filter(x => x.age > ALTER_MAX);
  const maxAlter = Math.max(...p.map(e => e.alter.max));
  z(1, zuAlt.length === 0,
    zuAlt.length ? `${zuAlt.length} über ${ALTER_MAX}: ${zuAlt.slice(0, 3).map(x => `${x.lastName} (${x.age})`).join(', ')}`
      : `ältester Profi über alle ${SAISONS} Saisons: ${maxAlter} Jahre`);
}

/* --- Z2: Altersverteilung ---------------------------------------------
 *
 * „Stabil" heißt hier NICHT „bleibt bei 25,8". Der Startkader ist von Hand
 * geschrieben und keine Gleichgewichtslage: In einer geschlossenen Welt, aus
 * der man nur durch ein Karriereende verschwindet (ins Ausland wechselt hier
 * niemand), legt allein die Rücktrittskurve fest, wo sich das Durchschnitts-
 * alter einpendelt. Geprüft wird deshalb, dass es sich EINPENDELT statt
 * davonzulaufen, in einem plausiblen Korridor bleibt und die Liga nicht
 * vergreist.
 *
 * Gemessen wird das im eingeschwungenen Teil des Laufs (letztes Drittel) —
 * nicht über den ganzen Lauf. Davor liegt die Startwelle: Der von Hand
 * geschriebene Kader ist ein einziger Jahrgangsberg um die 27, der geschlossen
 * altert. Sein Scheitel (Saison 8) sagt nichts über die Spielwelt aus, sondern
 * über die Kaderdateien. Er wird als Hinweis ausgewiesen, nicht als Fehler.
 */
{
  const schnitte = p.map(e => e.alter.schnitt);
  const letzte = schnitte[schnitte.length - 1];
  const drittel = Math.max(1, Math.floor(schnitte.length / 3));
  const ruhe = p.slice(p.length - drittel);          // eingeschwungener Teil
  const ruheSchnitte = ruhe.map(e => e.alter.schnitt);
  const min = Math.min(...ruheSchnitte), max = Math.max(...ruheSchnitte);
  const einschwingen = Math.abs(letzte - schnitte[schnitte.length - 1 - drittel]);
  const anteilAltMax = Math.max(...ruhe.map(e => e.alter.anteilAlt));
  const ohneJunge = p.filter(e => e.alter.anteilJung <= 0).length;

  const imKorridor = min >= ALTER_SCHNITT_MIN && max <= ALTER_SCHNITT_MAX;
  const eingependelt = einschwingen <= ALTER_EINSCHWINGEN_MAX;
  const nichtVergreist = anteilAltMax <= ALTER_ANTEIL_ALT_MAX && ohneJunge === 0;

  z(2, imKorridor && eingependelt && nichtVergreist,
    `Start ⌀ ${nz(lauf.startAlter.schnitt, 2)} (von Hand gesetzt) → Gleichgewicht ⌀ ${nz(letzte, 2)}; ` +
    `Spanne im eingeschwungenen Teil ${nz(min, 2)}–${nz(max, 2)} (Korridor ${ALTER_SCHNITT_MIN}–${ALTER_SCHNITT_MAX}); ` +
    `Einschwingen über die letzten ${drittel} Saisons ${nz(einschwingen, 2)} (erlaubt ${ALTER_EINSCHWINGEN_MAX}); ` +
    `höchstens ${nz(anteilAltMax * 100)} % ab 33; ` +
    `${ohneJunge} Saison(s) ganz ohne Spieler bis 21`);

  H(`Altersgleichgewicht: Ohne Wechsel ins Ausland ist das Karriereende der einzige Ausgang aus der Spielwelt. ` +
    `Die Rücktrittskurve (ab 33 steigend, mit 41 Schluss) legt das Gleichgewicht bei ⌀ ${nz(letzte, 2)} Jahren fest — ` +
    `rund ${nz(letzte - lauf.startAlter.schnitt, 1)} Jahre über dem von Hand gesetzten Startwert.`);

  /* Die Startwelle sichtbar machen: Ab Roadmap-Stufe 5 sind alle 864 Profis von
   * Hand geschrieben, und alle sind zum Start in Bestform. Das ist der Preis des
   * Spielprinzips — er wird gemeldet, nicht wegdefiniert. */
  {
    const gipfel = p.reduce((b, e, i) => e.alter.anteilAlt > b.wert ? { wert: e.alter.anteilAlt, saison: i + 1 } : b,
      { wert: 0, saison: 0 });
    if (gipfel.saison && gipfel.wert > ALTER_ANTEIL_ALT_MAX) {
      H(`Startwelle: Der von Hand gesetzte Kader ist ein Jahrgangsberg (⌀ ${nz(lauf.startAlter.schnitt, 2)}) und altert ` +
        `geschlossen. Der Anteil ab 33 erreicht in Saison ${gipfel.saison} seinen Scheitel bei ${nz(gipfel.wert * 100)} % ` +
        `und ist ab Saison ${Math.max(1, p.length - drittel + 1)} wieder bei ${nz(anteilAltMax * 100)} % oder darunter. ` +
        `Wer zehn Saisons am Stück spielt, sieht diese Welle — sie ist kein Fehler in club/karriere.js, ` +
        `sondern die Folge davon, dass jeder Verein mit seinen Legenden in Bestform startet.`);
    }
  }

  const rmin = Math.min(...p.map(e => e.ruecktritte)), rmax = Math.max(...p.map(e => e.ruecktritte));
  if (rmax > rmin * 4) {
    H(`Kohorteneffekt: Die Zahl der Rücktritte schwankt zwischen ${rmin} und ${rmax} je Saison. ` +
      `Ursache ist der von Hand geschriebene Startkader, dessen Jahrgänge gemeinsam altern — ` +
      `nach etwa zwei Spielerkarrieren läuft sich das aus.`);
  }
}

/* --- Z3: Ersatz je Abgang --------------------------------------------- */
{
  const fehl = p.filter(e => e.neu < e.ruecktritte);
  const summeAb = p.reduce((s, e) => s + e.ruecktritte, 0);
  const summeNeu = p.reduce((s, e) => s + e.neu, 0);
  z(3, fehl.length === 0 && summeNeu >= summeAb,
    fehl.length ? `${fehl.length} Saison(s) mit zu wenig Ersatz, erste: Saison ${fehl[0].saison} (${fehl[0].ruecktritte} raus, ${fehl[0].neu} rein)`
      : `${summeAb} Rücktritte, ${summeNeu} neue Spieler (Verhältnis ${nz(summeNeu / Math.max(1, summeAb), 2)})`);
}

/* --- Z4: Kadergrößen --------------------------------------------------- */
{
  const schlimm = p.filter(e => e.kader.ausreisser.length);
  const min = Math.min(...p.map(e => e.kader.min)), max = Math.max(...p.map(e => e.kader.max));
  z(4, schlimm.length === 0,
    schlimm.length ? `Saison ${schlimm[0].saison}: ${schlimm[0].kader.ausreisser.slice(0, 4).join(', ')}`
      : `Spanne über alle Saisons: ${min}–${max} (erlaubt ${KADER_MIN}–${KADER_MAX})`);
}

/* --- Z5: Geisterspieler ------------------------------------------------ */
{
  const alle = p.reduce((s, e) => s + e.geister.length, 0);
  const erste = p.find(e => e.geister.length);
  z(5, alle === 0,
    alle ? `${alle} Treffer, erster in Saison ${erste.saison}: ${erste.geister.slice(0, 3).join(' · ')}`
      : `${SAISONS} Saisons ohne einen einzigen verwaisten Verweis in tactics`);
}

/* --- Z6: Fähigkeiten monoton und unter der Decke ----------------------- */
{
  const m = state.manager;
  const ueber = SKILL_KEYS.filter(k => m.skills[k] > SKILL_DECKE);
  const monoton = lauf.bonusVerlauf.every((v, i) => i === 0 || v >= lauf.bonusVerlauf[i - 1] - 0.001);
  z(6, ueber.length === 0 && monoton,
    ueber.length ? `über der Decke: ${ueber.map(k => `${k} ${m.skills[k]}`).join(', ')}`
      : !monoton ? `Trainerbonus fällt zwischendurch: ${lauf.bonusVerlauf.join(' → ')}`
        : `Endstand ${SKILL_KEYS.map(k => `${k} ${nz(m.skills[k], 1)}`).join(', ')} (Decke ${SKILL_DECKE})`);
}

/* --- Z7: Korridor 45 → 75 über acht erfolgreiche Saisons --------------- */
{
  const idx = Math.min(KORRIDOR_SAISON, p.length) - 1;
  const bonus8 = p[idx].bonus;
  z(7, bonus8 >= KORRIDOR_MIN && bonus8 <= KORRIDOR_MAX,
    `Trainerbonus nach ${idx + 1} Saisons: ${nz(bonus8, 1)} ` +
    `(Start ${nz(lauf.bonusVerlauf[0], 1)}, Soll ${KORRIDOR_MIN}–${KORRIDOR_MAX}) · ` +
    `Verlauf ${lauf.bonusVerlauf.map(v => nz(v, 1)).join(' → ')}`);
}

/* --- Z9: Rücktrittsquote ----------------------------------------------- */
{
  const quoten = p.map(e => e.ruecktritte / Math.max(1, e.vorher));
  const schnitt = quoten.reduce((a, b) => a + b, 0) / quoten.length;
  const leer = p.filter(e => e.ruecktritte === 0).length;
  z(9, schnitt >= RUECKTRITTSQUOTE_MIN && schnitt <= RUECKTRITTSQUOTE_MAX && leer === 0,
    `⌀ ${nz(schnitt * 100, 2)} % der Profis je Saison ` +
    `(Spanne ${nz(Math.min(...quoten) * 100, 2)}–${nz(Math.max(...quoten) * 100, 2)} %, ` +
    `${leer} Saison(s) ohne einen einzigen Rücktritt; Korridor ${RUECKTRITTSQUOTE_MIN * 100}–${RUECKTRITTSQUOTE_MAX * 100} %)`);
}

/* --- Z10: Chronik ------------------------------------------------------ */
{
  const titel = state.history.titel || {};
  const anzahl = Object.keys(titel).length;
  const r = state.history.rekorde || {};
  const fehlend = ['titelJeVerein', 'meisteTitel', 'hoechsterSieg', 'meisteToreSaison', 'laengsteSerie']
    .filter(k => !r[k]);
  const luecken = [];
  for (let s = 1; s <= SAISONS; s++) {
    const e = titel[s];
    if (!e) { luecken.push(`Saison ${s} fehlt`); continue; }
    for (const f of ['meister', 'absteiger', 'aufsteiger', 'torschuetzenkoenig', 'elfDerSaison', 'managerVerein', 'managerPlatz']) {
      if (e[f] === undefined) luecken.push(`Saison ${s}: Feld ${f} fehlt`);
    }
  }
  z(10, anzahl === SAISONS && !fehlend.length && !luecken.length,
    (anzahl !== SAISONS ? `history.titel hat ${anzahl} statt ${SAISONS} Einträge. ` : '') +
    (fehlend.length ? `Rekorde ohne Inhalt: ${fehlend.join(', ')}. ` : '') +
    (luecken.length ? luecken.slice(0, 3).join(' · ') : '') ||
    `${anzahl} Chronikeinträge · Rekordhalter ${r.meisteTitel ? r.meisteTitel.name + ' (' + r.meisteTitel.anzahl + ')' : '–'} · ` +
    `höchster Sieg ${r.hoechsterSieg ? r.hoechsterSieg.text : '–'} · ` +
    `längste Serie ${r.laengsteSerie ? r.laengsteSerie.laenge + ' Siege (' + r.laengsteSerie.name + ')' : '–'} · ` +
    `Torrekord ${r.meisteToreSaison ? r.meisteToreSaison.tore + ' (' + r.meisteToreSaison.name + ')' : '–'}`);
}

/* --- Z11: Elf der Saison ----------------------------------------------- */
{
  // Die Elf der letzten Saison – nach dem Jahreswechsel ist die Statistik leer.
  const elf = p[p.length - 1].elfListe;
  const plan = { TW: 1, ABW: 4, MIT: 4, STU: 2 };
  const ist = { TW: 0, ABW: 0, MIT: 0, STU: 0 };
  for (const e of elf) ist[POSITION_GROUP[e.pos] || 'MIT']++;
  const passt = Object.keys(plan).every(g => ist[g] === plan[g]);
  const dubletten = new Set(elf.map(e => e.playerId)).size !== elf.length;
  const zuKlein = p.filter(e => e.elf !== 11).length;
  z(11, elf.length === 11 && passt && !dubletten && zuKlein === 0,
    `${elf.length} Spieler (${ist.TW} TW / ${ist.ABW} ABW / ${ist.MIT} MIT / ${ist.STU} STU)` +
    (dubletten ? ', mit Dubletten' : '') +
    (zuKlein ? `, ${zuKlein} Saison(s) mit unvollständiger Elf` : '') +
    `, beste Note ${elf.length ? nz(Math.max(...elf.map(e => e.note)), 2) : '–'}`);
}

/* --- Z12: Torschützenkönig --------------------------------------------- */
{
  const schwach = p.filter(e => e.tkTore < TORJAEGER_MIN);
  const min = Math.min(...p.map(e => e.tkTore)), max = Math.max(...p.map(e => e.tkTore));
  z(12, schwach.length === 0,
    schwach.length ? `${schwach.length} Saison(s) unter ${TORJAEGER_MIN} Toren, erste: Saison ${schwach[0].saison} mit ${schwach[0].tkTore}`
      : `Torschützenkrone zwischen ${min} und ${max} Toren über ${SAISONS} Saisons`);
}

/* --- Z14: Ligastärke ---------------------------------------------------- */
{
  const endOvr = ligaOverall(state, 'bl1');
  const verfall = lauf.startOvr - endOvr;
  z(14, verfall <= OVR_VERFALL_MAX,
    `1. Liga ${nz(lauf.startOvr)} → ${nz(endOvr)} Overall über ${SAISONS} Saisons ` +
    `(Verfall ${nz(verfall)}, erlaubt ${OVR_VERFALL_MAX})`);
}

/* ------------------------------------------------------------------ *
 *  Lauf 2: derselbe Trainer, aber untätig
 * ------------------------------------------------------------------ */

abschnitt('C) Gegenprobe: derselbe Trainer, aber untätig');
const passiv = laufen(SEED, Math.min(KORRIDOR_SAISON, SAISONS), { aktiv: false, still: true });
{
  const idx = Math.min(KORRIDOR_SAISON, passiv.protokoll.length) - 1;
  const bonusPassiv = passiv.protokoll[idx].bonus;
  const bonusAktiv = p[Math.min(KORRIDOR_SAISON, p.length) - 1].bonus;
  const abstand = bonusAktiv - bonusPassiv;
  unterpunkt(`Untätiger Trainer nach ${idx + 1} Saisons: Trainerbonus ${nz(bonusPassiv, 1)} ` +
    `(Verlauf ${passiv.bonusVerlauf.map(v => nz(v, 1)).join(' → ')})`);
  unterpunkt(`Fähigkeiten im Vergleich: ` + SKILL_KEYS.map(k =>
    `${k} ${nz(passiv.state.manager.skills[k], 1)}/${nz(state.manager.skills[k], 1)}`).join(' · '));
  z(8, abstand >= PASSIV_ABSTAND_MIN,
    `aktiv ${nz(bonusAktiv, 1)} gegen untätig ${nz(bonusPassiv, 1)} → Abstand ${nz(abstand, 1)} ` +
    `(gefordert ${PASSIV_ABSTAND_MIN})`);
}

/* ------------------------------------------------------------------ *
 *  Lauf 3: Determinismus
 * ------------------------------------------------------------------ */

abschnitt('D) Determinismus');
if (SCHNELL) {
  z(13, true, 'im Schnelllauf übersprungen (--schnell) – der Vergleichslauf kostet die halbe Laufzeit');
} else {
  const wieder = laufen(SEED, SAISONS, { aktiv: true, still: true });
  const gleich = wieder.fingerabdruck === lauf.fingerabdruck;
  let ersteAbweichung = '';
  if (!gleich) {
    const a = lauf.fingerabdruck.split(';'), b = wieder.fingerabdruck.split(';');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) { ersteAbweichung = ` – erste Abweichung: "${a[i]}" gegen "${b[i]}"`; break; }
    }
  }
  z(13, gleich, gleich
    ? `zwei Läufe mit Seed ${SEED} liefern denselben Fingerabdruck über ${SAISONS} Saisons`
    : `Fingerabdrücke weichen ab${ersteAbweichung}`);
}

/* ------------------------------------------------------------------ *
 *  Stichproben, damit die Texte auch gelesen werden
 * ------------------------------------------------------------------ */

abschnitt('E) Stichproben aus dem Postfach');
{
  const beispiele = [];
  for (const e of p) {
    for (const r of (e.ruecktritteBeispiele || [])) beispiele.push(r);
  }
  // Aus dem letzten Lauf noch einmal ein paar Karriereenden erzeugen, um die
  // Texte zu zeigen – der Prüfstand soll lesbar machen, was er prüft.
  const kandidaten = profis(state)
    .map(x => ({ p: x, chance: ruecktrittsChance(state, x) }))
    .filter(e => e.chance > 0)
    .sort((a, b) => b.chance - a.chance)
    .slice(0, 3);
  for (const k of kandidaten) {
    const text = abschiedsbericht(state, {
      playerId: k.p.id, name: `${k.p.firstName} ${k.p.lastName}`, kurzName: k.p.shortName,
      clubId: k.p.clubId, clubName: state.clubs[k.p.clubId] ? state.clubs[k.p.clubId].name : null,
      alter: k.p.age, position: k.p.position, legende: k.p.era === 'legend',
      abschiedsspiel: k.p.era === 'legend',
      spiele: (k.p.stats.career && k.p.stats.career.spiele) || 0,
      tore: (k.p.stats.career && k.p.stats.career.tore) || 0,
      grundKey: 'alter'
    });
    console.log(`  · Rücktrittsrisiko ${nz(k.chance * 100)} % — ${k.p.lastName} (${k.p.age})`);
    for (const zeile of text.split('\n')) if (zeile.trim()) console.log('      ' + zeile.trim());
  }
  if (!kandidaten.length && !beispiele.length) H('Keine Rücktrittskandidaten für die Stichprobe gefunden.');
}

/* ------------------------------------------------------------------ *
 *  Ergebnis
 * ------------------------------------------------------------------ */

abschnitt('F) Messwerte');
console.log(`  Spielstand am Ende:        ${mb(serialize(state).length)}`);
console.log(`  Spieler im Spielstand:     ${Object.keys(state.players).length} (davon ${Object.values(state.players).filter(x => x.retired).length} im Ruhestand)`);
console.log(`  Profis unter Vertrag:      ${profis(state).length}`);
console.log(`  Rücktritte gesamt:         ${p.reduce((s, e) => s + e.ruecktritte, 0)} · davon Legenden ${p.reduce((s, e) => s + e.legenden, 0)}`);
console.log(`  Neue Spieler gesamt:       ${p.reduce((s, e) => s + e.neu, 0)} (${p.reduce((s, e) => s + e.jugend, 0)} Jugend / ${p.reduce((s, e) => s + e.freieSpieler, 0)} Markt / ${p.reduce((s, e) => s + e.nachverpflichtet, 0)} nachverpflichtet)`);
console.log(`  Beförderungen aus der Jugend: ${p.reduce((s, e) => s + e.befoerdert, 0)}`);
console.log(`  Trainer am Ende:           Stufe ${state.manager.level}, ${state.manager.erfahrung} Erfahrung, Ruf ${nz(state.manager.reputation, 1)}, ${state.manager.titel.length} Titel`);
console.log(`  Trainerbonus (coachBonus): ${nz(lauf.bonusVerlauf[0], 1)} → ${nz(coachBonus(state.manager), 1)}`);

abschnitt('G) Ergebnis');
let fehlgeschlagen = 0;
for (const nr of Object.keys(ZTITEL).sort((a, b) => a - b)) {
  const e = zstat[nr];
  const status = e.fehl ? 'FEHL' : e.ok ? ' ok ' : ' ?  ';
  if (e.fehl || !e.ok) fehlgeschlagen++;
  console.log(`  [${status}] Z${String(nr).padStart(2)}  ${ZTITEL[nr]}`);
  for (const m of e.meldungen.slice(0, 2)) console.log(`          · ${m}`);
}
if (hinweise.length) {
  console.log(`  Hinweise (${hinweise.length}):`);
  for (const h of hinweise.slice(0, 8)) console.log('    · ' + h);
}

const gesamt = Object.keys(ZTITEL).length;
console.log('\n' + '='.repeat(70));
console.log(`ERGEBNIS: ${gesamt - fehlgeschlagen} von ${gesamt} Zusicherungen bestanden, ` +
  `${fehlgeschlagen} offen  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (!fehlgeschlagen) {
  console.log('Zehn Jahre alt geworden, niemand ist übrig geblieben, der nicht sollte. Weitermachen.');
}
process.exit(fehlgeschlagen ? 1 : 0);
