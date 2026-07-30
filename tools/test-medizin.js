/**
 * tools/test-medizin.js — Balancing-Test für club/medical.js
 *
 *   node tools/test-medizin.js [saisons]
 *
 * Simuliert komplette Saisons (Spielplan aus data/leagues.js, Kader prozedural
 * über data/squads/_helper.js) und misst:
 *
 *   • Verletzungen und "nennenswerte" Ausfälle (≥ 7 Tage) je Verein und Saison
 *   • Ausfalltage je Verein und Saison
 *   • Verteilung der Verletzungsarten (inkl. Kreuzbandriss-Quote)
 *   • Wirkung der medizinischen Abteilung (A/B: Spitzenklinik vs. Eimer Eiswasser)
 *   • Sperren, Grippewellen, Fitnessverlauf, Laufzeit
 *
 * Kein Math.random(), kein Date.now() in der Simulation – alles über core/rng.js.
 */

import { CLUBS } from '../src/data/clubs.js';
import { LEAGUES, generateFixtures } from '../src/data/leagues.js';
import { createRng } from '../src/core/rng.js';
import { mk } from '../src/data/squads/_helper.js';
import { clamp } from '../src/core/util.js';
import { DIFFICULTIES, INJURY_TYPES } from '../src/core/constants.js';
import { playerOverall } from '../src/engine/ratings.js';

import {
  tickMedizin, spielNachbereitung, karteVermerken, verletzen, behandeln,
  fitTesten, lazarett, medizinBericht, belastungssteuerung, sperreVerhaengen,
  sperrenPruefen, verletzungsrisiko, medizinIndex, fitnessNachSpiel, regeneration,
  reha, langzeitschaden, KRANKHEITEN
} from '../src/club/medical.js';

const SAISONS = Number(process.argv[2]) || 5;
const KADER_TEMPLATE = [
  'TW', 'TW', 'TW',
  'IV', 'IV', 'IV', 'IV', 'LV', 'LV', 'RV', 'RV',
  'DM', 'DM', 'ZM', 'ZM', 'ZM', 'LM', 'RM', 'OM',
  'LA', 'RA', 'ST', 'ST', 'ST'
];
const VORNAMEN = ['Michael', 'Stefan', 'Andreas', 'Thomas', 'Jens', 'Olaf', 'Marco', 'Kevin', 'Lars', 'Sven', 'Dennis', 'Timo', 'Jonas', 'Bastian', 'Rudi', 'Horst', 'Uli', 'Mehmet', 'Diego', 'Pierre'];
const NACHNAMEN = ['Bauer', 'Krause', 'Wagner', 'Schmitt', 'Hoffmann', 'Zieler', 'Brand', 'Kuntz', 'Reuter', 'Riedle', 'Effenberg', 'Bierhoff', 'Buchwald', 'Kohler', 'Helmer', 'Doll', 'Sammer', 'Basler', 'Nowotny', 'Jeremies', 'Ricken', 'Wosz', 'Rehmer', 'Linke'];

/* ---------------------------------------------------------------- Aufbau */

function baueState(seed, medizinModus) {
  const rng = createRng(seed);
  const state = {
    seed, difficulty: 'profi',
    date: { season: 1, day: 0, startYear: 2025 },
    managerClubId: 'bayern',
    clubs: {}, players: {}, staff: {}, fixtures: [],
    inbox: [], news: [], tick: 0
  };

  CLUBS.forEach((raw, idx) => {
    const club = JSON.parse(JSON.stringify(raw));
    club.playerIds = [];
    club.staffIds = [];
    club.finances = Object.assign({ balance: 0, debt: 0, ticketBase: 25, ledger: [], saison: {} }, club.finances);
    club.training = { intensitaet: 55, schwerpunkt: 'ausgeglichen' };
    club.stadiumState = { rasenZustand: club.stadium ? club.stadium.pitch : 80 };

    // Medizinische Ausstattung je Testmodus
    let stabQ;
    if (medizinModus === 'ab') {
      const gut = idx % 2 === 0;
      club.facilities.medical = gut ? 95 : 20;
      stabQ = gut ? 92 : 22;
      club.testGruppe = gut ? 'gut' : 'schlecht';
    } else {
      stabQ = clamp(Math.round((club.reputation || 50) * 0.9), 20, 95);
      club.testGruppe = 'daten';
    }

    // Kader
    const crng = rng.fork('kader:' + club.id);
    const basis = clamp(Math.round(38 + (club.reputation || 50) * 0.42), 45, 82);
    KADER_TEMPLATE.forEach((pos, i) => {
      const age = crng.int(18, 35);
      const ovr = clamp(Math.round(basis + crng.gauss(i < 14 ? 4 : -4, 5)), 30, 92);
      const traits = [];
      if (crng.chance(0.05)) traits.push('glasknochen');
      if (crng.chance(0.06)) traits.push('laufwunder');
      const p = mk({
        club: club.id, vn: crng.pick(VORNAMEN), nn: crng.pick(NACHNAMEN),
        pos, ovr, age, nr: i + 1, traits, idSuffix: String(i)
      });
      p.id = `p_${club.id}_${i}`;
      p.form = 50; p.morale = 70; p.fitness = 100; p.sharpness = 60;
      p.injury = null;
      p.cards = { yellow: 0, red: 0, ban: 0, seasonYellow: 0 };
      p.stats = { season: {}, career: {}, history: [] };
      state.players[p.id] = p;
      club.playerIds.push(p.id);
    });

    // Stab
    for (const role of ['cotrainer', 'torwarttrainer', 'athletik', 'arzt', 'physio', 'scout', 'jugendtrainer']) {
      const s = { id: `st_${club.id}_${role}`, clubId: club.id, role, name: role, quality: stabQ };
      state.staff[s.id] = s;
      club.staffIds.push(s.id);
    }
    state.clubs[club.id] = club;
  });

  spielplan(state, 1, rng);
  return state;
}

function spielplan(state, season, rng) {
  state.fixtures = [];
  for (const liga of Object.values(LEAGUES)) {
    state.fixtures.push(...generateFixtures(liga.clubIds, {
      rng: rng.fork('fx:' + liga.id + ':' + season), competitionId: liga.id, season
    }));
  }
  // Grober Pokal: 5 Runden unter der Woche (Tage ohne Ligaspiel: %7 ∉ {4,5})
  const pokalTage = [43, 92, 162, 227, 287];
  const ids = [...LEAGUES.bl1.clubIds, ...LEAGUES.bl2.clubIds];
  let feld = rng.shuffle(ids);
  pokalTage.forEach((tag, r) => {
    const naechste = [];
    for (let i = 0; i + 1 < feld.length; i += 2) {
      state.fixtures.push({
        id: `pokal_s${season}_r${r}_${feld[i]}_${feld[i + 1]}`,
        competitionId: 'pokal', season, matchday: r + 1, dayIndex: tag,
        homeId: feld[i], awayId: feld[i + 1], played: false, result: null
      });
      naechste.push(rng.chance(0.5) ? feld[i] : feld[i + 1]);
    }
    feld = naechste;
  });
}

/* -------------------------------------------------------------- Spieltag */

function aufstellung(state, club, rng) {
  const kader = club.playerIds.map(id => state.players[id])
    .filter(p => p && !p.injury && !(p.cards && p.cards.ban > 0));
  const nachPos = {};
  for (const p of kader) (nachPos[p.position] || (nachPos[p.position] = [])).push(p);
  for (const k in nachPos) nachPos[k].sort((a, b) => bewertung(b) - bewertung(a));

  const gebraucht = ['TW', 'IV', 'IV', 'LV', 'RV', 'DM', 'ZM', 'ZM', 'LA', 'RA', 'ST'];
  const elf = [];
  const genommen = new Set();
  for (const pos of gebraucht) {
    const kand = (nachPos[pos] || []).find(p => !genommen.has(p.id));
    if (kand) { elf.push(kand); genommen.add(kand.id); }
  }
  const rest = kader.filter(p => !genommen.has(p.id)).sort((a, b) => bewertung(b) - bewertung(a));
  while (elf.length < 11 && rest.length) { const p = rest.shift(); elf.push(p); genommen.add(p.id); }

  const einsaetze = elf.map(p => ({ playerId: p.id, minuten: 90 }));
  // Drei Wechsel
  const bank = rest.slice(0, 3);
  bank.forEach((p, i) => {
    const raus = einsaetze[10 - i];
    const min = rng.int(10, 35);
    if (raus) raus.minuten = 90 - min;
    einsaetze.push({ playerId: p.id, minuten: min });
  });
  return einsaetze;
}

function bewertung(p) {
  return playerOverall(p) * (0.6 + (p.fitness !== undefined ? p.fitness : 100) / 250);
}

function spieleTag(state, day, rng, stat) {
  for (const f of state.fixtures) {
    if (f.played || f.dayIndex !== day || f.season !== state.date.season) continue;
    f.played = true;
    f.result = [rng.int(0, 4), rng.int(0, 3)];
    for (const clubId of [f.homeId, f.awayId]) {
      const club = state.clubs[clubId];
      if (!club) continue;
      const einsaetze = aufstellung(state, club, rng);
      if (einsaetze.length) {
        const startelf = einsaetze.slice(0, 11);
        stat.anpfiffFitness.push(
          startelf.reduce((s, e) => s + (state.players[e.playerId].fitness || 0), 0) / startelf.length);
        stat.kaderEng += einsaetze.length < 14 ? 1 : 0;
      }

      // Karten wie im echten Leben: knapp 2 Gelbe je Team, selten Platzverweise
      for (const e of einsaetze) {
        if (rng.chance(0.13)) karteVermerken(state, e.playerId, 'gelb', f.competitionId);
        else if (rng.chance(0.006)) karteVermerken(state, e.playerId, 'gelbrot', f.competitionId);
        else if (rng.chance(0.003)) karteVermerken(state, e.playerId, 'rot', f.competitionId);
      }

      const res = spielNachbereitung(state, clubId, einsaetze, {
        rng: rng.fork('spiel:' + f.id + ':' + clubId),
        competitionId: f.competitionId,
        fixtureId: f.id,
        weather: rng.pickWeighted(['sonnig', 'bewoelkt', 'regen', 'wind', 'schnee'],
          w => (w === 'schnee' ? (day > 150 && day < 220 ? 8 : 0) : w === 'regen' ? 22 : w === 'wind' ? 12 : 30)),
        intensitaet: f.competitionId === 'pokal' ? 1.1 : 1,
        log: stat.log, news: () => { }, difficulty: stat.difficulty
      });
      stat.spiele++;
      stat.sperrenNeu += res.sperren.length;
    }
  }
}

/* ------------------------------------------------------------ Simulation */

function simulieren(seed, modus, saisons, schwierigkeit = 'profi') {
  const state = baueState(seed, modus);
  state.difficulty = schwierigkeit;
  const diff = DIFFICULTIES[schwierigkeit];
  const rng = createRng(seed + 7777);
  const t0 = process.hrtime.bigint();

  const stat = {
    spiele: 0, sperrenNeu: 0, postfach: 0, samples: [],
    log: (text, kind, opts) => {
      stat.postfach++;
      if (stat.samples.length < 60) stat.samples.push({ text, kind, subject: (opts && opts.subject) || '' });
    },
    difficulty: diff,
    typen: {}, ursachen: {}, dauern: [], anpfiffFitness: [], kaderEng: 0,
    proClubSaison: {},     // clubId -> [{ verletzungen, nennenswert, ausfalltage }]
    fitnessProbe: [], grippewellen: 0, sperrenGesamt: 0, langzeit: 0
  };

  // Verletzungen mitzählen: wir vergleichen die Historienlänge vor/nach jedem Tag.
  const gezaehlt = new Set();

  for (let season = 1; season <= saisons; season++) {
    state.date.season = season;
    if (season > 1) {
      spielplan(state, season, rng.fork('season:' + season));
      for (const p of Object.values(state.players)) p.age++;
    }
    for (const c of Object.values(state.clubs)) {
      c.saisonStatAusfall = c.medizin ? c.medizin.ausfalltage.gesamt : 0;
      c.saisonStatVerletzt = 0;
    }

    for (let day = 0; day < 365; day++) {
      state.date.day = day;
      state.tick++;
      const tagRng = rng.fork('tag:' + season + ':' + day);
      spieleTag(state, day, tagRng, stat);

      tickMedizin(state, {
        rng: tagRng.fork('tick'),
        day, season,
        weekday: (day + 1) % 7,
        isMatchday: false,
        isWeekStart: (day + 1) % 7 === 0,
        isMonthStart: day % 30 === 0,
        isSeasonEnd: day === 364,
        log: stat.log,
        news: () => { },
        difficulty: diff
      });

      // laufende Verletzungen erfassen
      for (const p of Object.values(state.players)) {
        if (!p.injury) continue;
        const key = `${p.id}:${p.injury.startSaison}:${p.injury.startTag}:${p.injury.typ}`;
        if (gezaehlt.has(key)) continue;
        gezaehlt.add(key);
        const inj = p.injury;
        stat.typen[inj.typ] = (stat.typen[inj.typ] || 0) + 1;
        stat.ursachen[inj.ursache] = (stat.ursachen[inj.ursache] || 0) + 1;
        stat.dauern.push(inj.tageGesamt);
        const club = state.clubs[p.clubId];
        if (club) {
          if (inj.art === 'krankheit') club.saisonStatKrank = (club.saisonStatKrank || 0) + 1;
          else {
            club.saisonStatVerletzt = (club.saisonStatVerletzt || 0) + 1;
            if (inj.tageGesamt >= 7) club.saisonStatNennenswert = (club.saisonStatNennenswert || 0) + 1;
          }
        }
      }

      if (day % 30 === 0) {
        const alle = Object.values(state.players);
        stat.fitnessProbe.push(alle.reduce((s, p) => s + (p.fitness || 0), 0) / alle.length);
      }
    }

    // Saison abschließen
    for (const c of Object.values(state.clubs)) {
      const med = c.medizin || { ausfalltage: { gesamt: 0 }, verletzungenSaison: 0 };
      const eintrag = {
        saison: season,
        verletzungen: c.saisonStatVerletzt || 0,
        krankheiten: c.saisonStatKrank || 0,
        nennenswert: c.saisonStatNennenswert || 0,
        ausfalltage: med.ausfalltage.gesamt - (c.saisonStatAusfall || 0),
        gruppe: c.testGruppe,
        medIndex: medizinIndex(state, c.id)
      };
      (stat.proClubSaison[c.id] || (stat.proClubSaison[c.id] = [])).push(eintrag);
      c.saisonStatNennenswert = 0;
      c.saisonStatKrank = 0;
    }
    for (const p of Object.values(state.players)) {
      if (p.medizin && p.medizin.langzeitschaeden.length) stat.langzeit += 0;
    }
  }

  stat.langzeit = Object.values(state.players).reduce((s, p) => s + (p.medizin ? p.medizin.langzeitschaeden.length : 0), 0);
  stat.sperrenGesamt = stat.sperrenNeu;
  stat.dauerMs = Number(process.hrtime.bigint() - t0) / 1e6;
  stat.state = state;
  return stat;
}

/* --------------------------------------------------------------- Ausgabe */

const nf = (v, d = 2) => Number(v).toFixed(d).replace('.', ',');

function mittel(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

function gruppenAuswertung(stat, gruppe) {
  const zeilen = [];
  for (const clubId in stat.proClubSaison) {
    for (const e of stat.proClubSaison[clubId]) if (!gruppe || e.gruppe === gruppe) zeilen.push(e);
  }
  return {
    n: zeilen.length,
    medIndex: mittel(zeilen.map(z => z.medIndex)),
    verletzungen: mittel(zeilen.map(z => z.verletzungen)),
    krankheiten: mittel(zeilen.map(z => z.krankheiten)),
    nennenswert: mittel(zeilen.map(z => z.nennenswert)),
    ausfalltage: mittel(zeilen.map(z => z.ausfalltage))
  };
}

function kopf(t) { console.log('\n' + '='.repeat(74) + '\n  ' + t + '\n' + '='.repeat(74)); }

/* ------------------------------------------------------------------ Lauf */

kopf(`MEDIZIN-BALANCING – ${SAISONS} Saisons, 36 Vereine, Schwierigkeit "profi"`);

const echt = simulieren(20250701, 'daten', SAISONS);
const a = gruppenAuswertung(echt);
console.log(`Simulierte Spiele (Teamsichten): ${echt.spiele}`);
console.log(`Rechenzeit gesamt:               ${nf(echt.dauerMs, 0)} ms  (${nf(echt.dauerMs / (SAISONS * 365), 2)} ms je Spieltag)`);
console.log(`Postfach-Nachrichten (Manager):  ${echt.postfach}`);
console.log('');
console.log('Je Verein und Saison (Original-Daten aus data/clubs.js):');
console.log(`  Medizin-Index Ø:      ${nf(a.medIndex, 1)}`);
console.log(`  Verletzungen Ø:       ${nf(a.verletzungen)}`);
console.log(`  davon ≥ 7 Tage Ø:     ${nf(a.nennenswert)}   (Zielkorridor 2–4)`);
console.log(`  Krankheiten Ø:        ${nf(a.krankheiten)}`);
console.log(`  Ausfalltage Ø:        ${nf(a.ausfalltage, 1)}`);
console.log(`  Ø Verletzungsdauer:   ${nf(mittel(echt.dauern), 1)} Tage`);
console.log(`  Sperren gesamt:       ${echt.sperrenGesamt}`);
console.log(`  Langzeitschäden:      ${echt.langzeit}`);
console.log(`  Ø Fitness im Kader:   ${nf(mittel(echt.fitnessProbe), 1)} %`);
console.log(`  Ø Fitness Startelf:   ${nf(mittel(echt.anpfiffFitness), 1)} % bei Anpfiff`);
console.log(`  Partien mit < 14 einsatzfähigen Spielern: ${echt.kaderEng}`);

kopf('VERTEILUNG DER VERLETZUNGSARTEN');
const gesamtV = Object.values(echt.typen).reduce((x, y) => x + y, 0);
const sortiert = Object.entries(echt.typen).sort((x, y) => y[1] - x[1]);
const namen = Object.fromEntries(INJURY_TYPES.map(t => [t.id, t.name]));
for (const k of KRANKHEITEN) namen[k.id] = k.name + ' (Krankheit)';
for (const [typ, n] of sortiert) {
  const anteil = n / gesamtV * 100;
  const proClubSaison = n / (36 * SAISONS);
  console.log(`  ${(namen[typ] || typ).padEnd(22)} ${String(n).padStart(5)}  ${nf(anteil, 1).padStart(5)} %  ` +
    `${nf(proClubSaison, 3)} je Verein+Saison  ${'█'.repeat(Math.max(1, Math.round(anteil / 2)))}`);
}
console.log('\n  Ursachen: ' + Object.entries(echt.ursachen).map(([k, v]) => `${k} ${nf(v / gesamtV * 100, 1)} %`).join(', '));
const kb = echt.typen.kreuzband || 0;
console.log(`  Kreuzbandrisse: ${kb} in ${36 * SAISONS} Vereins-Saisons ` +
  `(≈ alle ${kb ? nf(36 * SAISONS / kb, 1) : '∞'} Vereins-Saisons einer)`);

kopf('A/B-TEST: MEDIZINISCHE ABTEILUNG (95/92 gegen 20/22)');
const ab = simulieren(20250701, 'ab', SAISONS);
const gut = gruppenAuswertung(ab, 'gut');
const schlecht = gruppenAuswertung(ab, 'schlecht');
console.log('                          Spitzenklinik      Eimer Eiswasser     Faktor');
const zeile = (label, g, s, d = 2) =>
  console.log(`  ${label.padEnd(22)} ${nf(g, d).padStart(10)} ${nf(s, d).padStart(18)} ${nf(s / (g || 1), 2).padStart(10)}×`);
zeile('Medizin-Index', gut.medIndex, schlecht.medIndex, 1);
zeile('Verletzungen/Saison', gut.verletzungen, schlecht.verletzungen);
zeile('davon ≥ 7 Tage', gut.nennenswert, schlecht.nennenswert);
zeile('Krankheiten/Saison', gut.krankheiten, schlecht.krankheiten);
zeile('Ausfalltage/Saison', gut.ausfalltage, schlecht.ausfalltage, 1);
console.log(`\n  Stichprobe: je ${gut.n} bzw. ${schlecht.n} Vereins-Saisons.`);

/* ----------------------------------------------------- Funktionstests */

kopf('SCHWIERIGKEITSGRADE (je 2 Saisons, difficulty.injuryRate)');
console.log('  Grad             injuryRate   Verletzungen/Saison   ≥7 Tage   Ausfalltage');
for (const grad of ['amateur', 'profi', 'weltklasse', 'legende']) {
  const s = simulieren(31337, 'daten', 2, grad);
  const g = gruppenAuswertung(s);
  console.log(`  ${DIFFICULTIES[grad].name.padEnd(18)} ${nf(DIFFICULTIES[grad].injuryRate).padStart(5)}` +
    `${nf(g.verletzungen).padStart(18)}${nf(g.nennenswert).padStart(11)}${nf(g.ausfalltage, 1).padStart(14)}`);
}

kopf('FUNKTIONSTEST DER AKTIONEN');
const st = echt.state;
const club = st.clubs.bayern;
const probanden = club.playerIds.map(id => st.players[id]);

let fehler = 0;
function pruef(bedingung, text) {
  console.log(`  [${bedingung ? ' ok ' : 'FEHL'}] ${text}`);
  if (!bedingung) fehler++;
}

// verletzen + behandeln
const opfer = probanden.find(p => !p.injury) || probanden[0];
opfer.injury = null;
const v = verletzen(st, opfer.id, { typ: 'faserriss', ursache: 'training', minute: null });
pruef(v.ok && opfer.injury && opfer.injury.typ === 'faserriss', 'verletzen() setzt Muskelfaserriss: ' + v.text);
const vorher = opfer.injury.tageRest;
const bSpez = behandeln(st, opfer.id, 'spezialist');
pruef(bSpez.ok && opfer.injury.tageRest <= vorher, 'behandeln("spezialist") verkürzt die Prognose: ' + bSpez.text);
pruef(behandeln(st, opfer.id, 'operation').ok === false, 'Operation bei Faserriss wird korrekt abgelehnt');
const r1 = reha(st, opfer.id, { rng: createRng(1) });
pruef(r1.ok && !r1.fertig, `reha() macht Fortschritt (${nf(r1.fortschritt)} Heiltage/Tag)`);
pruef(fitTesten(st, opfer.id).einsatzfaehig === false, 'fitTesten() meldet den Verletzten als nicht einsatzfähig');

// Spritze
const opfer2 = probanden.find(p => !p.injury && p.id !== opfer.id);
verletzen(st, opfer2.id, { typ: 'prellung', ursache: 'spiel', minute: 63 });
const sp = behandeln(st, opfer2.id, 'spritze');
pruef(sp.ok && !opfer2.injury && opfer2.medizin.gespritzt, 'behandeln("spritze") macht sofort einsatzfähig: ' + sp.text);
const risikoMitSpritze = verletzungsrisiko(st, opfer2.id, { art: 'spiel' });
opfer2.medizin.gespritzt = null;
const risikoOhne = verletzungsrisiko(st, opfer2.id, { art: 'spiel' });
pruef(risikoMitSpritze > risikoOhne * 3, `Schmerzspritze verdreifacht das Risiko (${nf(risikoOhne * 100, 2)} % → ${nf(risikoMitSpritze * 100, 2)} %)`);

// Sperren
const suender = probanden.find(p => !p.injury && !p.cards.ban);
suender.cards.compYellow = { bl1: 4 };
suender.cards.gelbSperren = {};
karteVermerken(st, suender.id, 'gelb', 'bl1');
const sperr = sperrenPruefen(st, 'bayern', 'bl1');
pruef(suender.cards.ban === 1 && sperr.sperren.length >= 1, '5. Gelbe ergibt genau ein Spiel Sperre');
const suender2 = probanden.find(p => !p.injury && !p.cards.ban && p.id !== suender.id);
karteVermerken(st, suender2.id, 'rot', 'bl1', { schwere: 3 });
sperrenPruefen(st, 'bayern', 'bl1');
pruef(suender2.cards.ban === 3, 'Rote Karte mit Schwere 3 ergibt drei Spiele Sperre');
pruef(sperreVerhaengen(st, suender2.id, 2, 'Unsportlichkeit').ok && suender2.cards.ban === 5, 'sperreVerhaengen() addiert Sperren');

// Berichte
const laz = lazarett(st, 'bayern');
pruef(Array.isArray(laz) && laz.length > 0 && typeof laz[0].prognoseText === 'string',
  `lazarett() liefert ${laz.length} Einträge, z. B.: ${laz[0].name} – ${laz[0].diagnose}, ${laz[0].prognose}`);
const bel = belastungssteuerung(st, 'bayern');
pruef(bel.ok && Array.isArray(bel.warnungen), `belastungssteuerung(): ${bel.text}`);
const ber = medizinBericht(st, 'bayern');
pruef(ber.ok && ber.text.includes('Medizinischer Bericht'), 'medizinBericht() liefert Klartext');

// Fitness
const laeufer = probanden.find(p => !p.injury && p.cards.ban === 0);
laeufer.fitness = 100;
fitnessNachSpiel(st, laeufer.id, 90, 1);
const nachSpiel = laeufer.fitness;
regeneration(st, laeufer.id, {});
pruef(nachSpiel < 85 && laeufer.fitness > nachSpiel,
  `fitnessNachSpiel(): 100 % → ${nf(nachSpiel, 1)} %, regeneration() → ${nf(laeufer.fitness, 1)} %`);

// Langzeitschaden
const pechvogel = probanden.find(p => !p.injury) || probanden[0];
pechvogel.injury = null;
verletzen(st, pechvogel.id, { typ: 'kreuzband', ursache: 'spiel', minute: 12 });
const tempoVorher = pechvogel.attributes.tempo;
const lz = langzeitschaden(st, pechvogel.id, { rng: createRng(4242), injury: pechvogel.injury });
pruef(typeof lz.ok === 'boolean' && (!lz.ok || pechvogel.attributes.tempo < tempoVorher),
  `langzeitschaden(): ${lz.text}`);

kopf('NACHHOLLAUF: MATCH-ENGINE MELDET NICHTS');
{
  const st2 = baueState(999, 'daten');
  const rngT = createRng(999);
  const fx = st2.fixtures.find(x => x.competitionId === 'bl1' && (x.homeId === 'bayern' || x.awayId === 'bayern'));
  fx.dayIndex = 49; fx.played = true;
  const gesperrt = st2.players[st2.clubs.bayern.playerIds[5]];
  gesperrt.cards = { yellow: 0, red: 0, ban: 1, seasonYellow: 0, banComp: 'bl1' };

  const tick = (day) => {
    st2.date.day = day;
    tickMedizin(st2, { rng: rngT.fork('t' + day), day, season: 1, weekday: (day + 1) % 7, log: () => { }, news: () => { }, difficulty: DIFFICULTIES.profi });
  };
  tick(50);
  const kader = st2.clubs.bayern.playerIds.map(id => st2.players[id]);
  const belastet = kader.filter(p => p.medizin && p.medizin.einsaetze.length).length;
  const summe1 = kader.reduce((s, p) => s + p.fitness, 0);
  pruef(belastet >= 11, `Unbeachtetes Spiel wird nachgeholt: ${belastet} Spieler mit Einsatzminuten`);
  pruef(gesperrt.cards.ban === 0, 'Sperre wird durch das nachgeholte Spiel abgebaut');
  tick(51);
  const summe2 = kader.reduce((s, p) => s + p.fitness, 0);
  pruef(summe2 > summe1, 'Kein zweites Mal gebucht – am Folgetag geht die Fitness wieder hoch');
}

kopf('DETERMINISMUS');
const d1 = simulieren(4711, 'daten', 1);
const d2 = simulieren(4711, 'daten', 1);
const g1 = gruppenAuswertung(d1), g2 = gruppenAuswertung(d2);
pruef(g1.ausfalltage === g2.ausfalltage && g1.verletzungen === g2.verletzungen,
  `Gleicher Seed ⇒ gleiches Ergebnis (${nf(g1.ausfalltage, 1)} Ausfalltage je Verein)`);

kopf('TEXTPROBEN AUS DEM POSTFACH');
for (const s of echt.samples.slice(0, 8)) {
  console.log(`\n  ── ${s.subject} ──\n  ${s.text.split('\n').slice(0, 3).join('\n  ')}`);
}

kopf(fehler === 0 ? 'ALLE FUNKTIONSTESTS BESTANDEN' : `${fehler} FEHLGESCHLAGENE TESTS`);
process.exit(fehler === 0 ? 0 : 1);
