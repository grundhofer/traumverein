/**
 * Smoke-Test für src/club/stadium.js
 *
 *   node tools/test-stadion.js
 *
 * Prüft schwerpunktmäßig:
 *   1. die Nachfragekurve (Preis vs. Auslastung) – monoton fallend, ohne Sprünge
 *   2. den Ausbau – Geld wird abgezogen, Kapazität steigt erst nach Bauende,
 *      die Bauzeit wird eingehalten und die Summe aller Zahlungen stimmt
 *
 * Läuft ohne core/state.js, damit der Test auch bei halb gebautem Projekt
 * durchläuft: der State wird direkt aus data/clubs.js zusammengesetzt.
 */

import { CLUBS } from '../src/data/clubs.js';
import { deepClone, round } from '../src/core/util.js';
import { createRng } from '../src/core/rng.js';
import { DIFFICULTIES } from '../src/core/constants.js';
import { SAISON_TAGE } from '../src/data/leagues.js';
import * as ST from '../src/club/stadium.js';

/* ------------------------------------------------------------------ *
 *  Mini-Testrahmen
 * ------------------------------------------------------------------ */

let bestanden = 0;
const fehler = [];

function test(name, fn) {
  try {
    fn();
    bestanden++;
    console.log('  ok   ' + name);
  } catch (e) {
    fehler.push(name + ': ' + e.message);
    console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}

function assert(bed, msg) {
  if (!bed) throw new Error(msg);
}

function nahe(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg} (${a} vs ${b}, Toleranz ${tol})`);
}

/* ------------------------------------------------------------------ *
 *  Test-State
 * ------------------------------------------------------------------ */

function buildState(managerClubId = 'bremen', day = 100) {
  const state = {
    version: 1, seed: 4711, difficulty: 'profi',
    date: { season: 1, day, startYear: 2025 },
    managerClubId,
    clubs: {}, players: {}, staff: {}, fixtures: [], tables: {},
    inbox: [], news: [], tick: 0
  };
  for (const raw of CLUBS) {
    const c = deepClone(raw);
    c.finances = Object.assign(
      { balance: 0, debt: 0, ticketBase: 25, ledger: [], saison: {}, kredite: [] },
      c.finances
    );
    c.fans = Object.assign({ protest: 0, dauerkarten: 0, erwartung: 55 }, c.fanbase);
    c.season = { form: [], platz: 0, punkte: 0, tore: 0, gegentore: 0 };
    state.clubs[c.id] = c;
  }
  return state;
}

function makeCtx(state, over = {}) {
  const tag = state.date.day;
  return Object.assign({
    rng: createRng('test:' + tag),
    day: tag,
    season: state.date.season,
    weekday: (tag + 1) % 7,
    isMatchday: false,
    isWeekStart: ((tag + 1) % 7) === 0,
    isMonthStart: false,
    isSeasonEnd: false,
    difficulty: DIFFICULTIES.profi,
    log: () => {},
    news: () => {}
  }, over);
}

/** Summe aller Ledger-Beträge einer Kategorie. */
function ledgerSumme(club, kategorie) {
  return club.finances.ledger
    .filter(e => !kategorie || e.kategorie === kategorie)
    .reduce((s, e) => s + e.betrag, 0);
}

console.log('\n=== NACHFRAGEKURVE ===');

test('Preis = Referenz ergibt eine plausible Auslastung', () => {
  const state = buildState();
  for (const id of ['bayern', 'bremen', 'heidenheim', 'muenster']) {
    const ref = ST.referenzPreise(state, id);
    const z = ST.zuschauerBerechnen(state, id, null, { neutral: true, preise: ref });
    assert(z.auslastung > 0.35 && z.auslastung <= 1.0,
      `${id}: Auslastung bei Referenzpreis unplausibel (${round(z.auslastung, 3)})`);
    assert(z.gesamt <= state.clubs[id].stadium.capacity,
      `${id}: mehr Zuschauer als Plätze`);
  }
});

test('Auslastung fällt monoton mit steigendem Preis', () => {
  const state = buildState();
  const club = state.clubs.bremen;
  club.fans.dauerkarten = 0;                 // ohne Dauerkarten-Untergrenze
  const ref = ST.referenzPreise(state, 'bremen');
  let vorher = Infinity;
  for (let skala = 0.2; skala <= 4.0001; skala += 0.05) {
    const z = ST.zuschauerBerechnen(state, 'bremen', null, {
      neutral: true,
      preise: { steh: ref.steh * skala, sitz: ref.sitz * skala, vip: ref.vip * skala }
    });
    assert(z.auslastung <= vorher + 1e-9,
      `Auslastung steigt bei Skala ${round(skala, 2)} (${z.auslastung} > ${vorher})`);
    vorher = z.auslastung;
  }
});

test('Nachfragekurve ist glatt – keine Sprünge', () => {
  const state = buildState();
  state.clubs.bremen.fans.dauerkarten = 0;
  const ref = ST.referenzPreise(state, 'bremen');
  let vorher = null;
  for (let skala = 0.2; skala <= 4.0001; skala += 0.02) {
    const z = ST.zuschauerBerechnen(state, 'bremen', null, {
      neutral: true,
      preise: { steh: ref.steh * skala, sitz: ref.sitz * skala, vip: ref.vip * skala }
    });
    if (vorher !== null) {
      assert(Math.abs(z.auslastung - vorher) < 0.03,
        `Sprung in der Kurve bei Skala ${round(skala, 2)}: ${round(vorher, 4)} -> ${round(z.auslastung, 4)}`);
    }
    vorher = z.auslastung;
  }
});

test('Deutlich überhöhte Preise leeren das Stadion spürbar', () => {
  const state = buildState();
  state.clubs.bremen.fans.dauerkarten = 0;
  const ref = ST.referenzPreise(state, 'bremen');
  const normal = ST.zuschauerBerechnen(state, 'bremen', null, { neutral: true, preise: ref });
  const teuer = ST.zuschauerBerechnen(state, 'bremen', null, {
    neutral: true, preise: { steh: ref.steh * 2, sitz: ref.sitz * 2, vip: ref.vip * 2 }
  });
  const wucher = ST.zuschauerBerechnen(state, 'bremen', null, {
    neutral: true, preise: { steh: ref.steh * 4, sitz: ref.sitz * 4, vip: ref.vip * 4 }
  });
  assert(teuer.auslastung < normal.auslastung * 0.7,
    `Doppelter Preis wirkt zu schwach (${round(normal.auslastung, 3)} -> ${round(teuer.auslastung, 3)})`);
  assert(wucher.auslastung < teuer.auslastung * 0.75,
    `Vierfacher Preis wirkt zu schwach (${round(teuer.auslastung, 3)} -> ${round(wucher.auslastung, 3)})`);
  assert(wucher.auslastung > 0.02, 'Selbst Wucherpreise dürfen nicht auf null führen');
});

test('Billige Karten füllen das Stadion, senken aber den Erlös je Zuschauer', () => {
  const state = buildState();
  state.clubs.bremen.fans.dauerkarten = 0;
  const ref = ST.referenzPreise(state, 'bremen');
  const normal = ST.zuschauerBerechnen(state, 'bremen', null, { neutral: true, preise: ref });
  const billig = ST.zuschauerBerechnen(state, 'bremen', null, {
    neutral: true, preise: { steh: ref.steh * 0.4, sitz: ref.sitz * 0.4, vip: ref.vip * 0.4 }
  });
  assert(billig.auslastung > normal.auslastung, 'Billigere Karten müssen mehr Zuschauer bringen');
  assert(billig.einnahmen / billig.gesamt < normal.einnahmen / normal.gesamt,
    'Erlös je Zuschauer muss bei Billigpreisen sinken');
});

test('Dauerkarteninhaber bilden eine Untergrenze', () => {
  const state = buildState();
  const club = state.clubs.bremen;
  const ref = ST.referenzPreise(state, 'bremen');
  club.fans.dauerkarten = 20000;
  const wucher = ST.zuschauerBerechnen(state, 'bremen', null, {
    neutral: true, preise: { steh: ref.steh * 6, sitz: ref.sitz * 6, vip: ref.vip * 6 }
  });
  assert(wucher.gesamt >= 20000 * 0.84 - 1,
    `Dauerkarteninhaber fehlen im Stadion (${wucher.gesamt} bei 20.000 Dauerkarten)`);
});

test('Bundesliga-Schnitt liegt im realistischen Bereich', () => {
  const state = buildState();
  let summe = 0, auslastung = 0, n = 0;
  for (const c of CLUBS) {
    if (c.leagueId !== 'bl1') continue;
    const z = ST.zuschauerBerechnen(state, c.id, null, {});
    summe += z.gesamt; auslastung += z.auslastung; n++;
  }
  const schnitt = summe / n, ausl = auslastung / n;
  assert(schnitt > 35000 && schnitt < 50000, `BL1-Zuschauerschnitt unrealistisch: ${Math.round(schnitt)}`);
  assert(ausl > 0.85 && ausl <= 1.0, `BL1-Auslastung unrealistisch: ${round(ausl * 100, 1)} %`);
  console.log(`       (BL1: ${Math.round(schnitt)} Zuschauer, ${round(ausl * 100, 1)} % Auslastung)`);
});

console.log('\n=== KONTEXTFAKTOREN ===');

test('Derby zieht mehr Zuschauer als ein Allerweltsspiel', () => {
  const state = buildState('bochum');
  const derby = { id: 'x1', competitionId: 'bl2', season: 1, matchday: 5, dayIndex: 100, homeId: 'bochum', awayId: 'schalke' };
  const normal = { id: 'x2', competitionId: 'bl2', season: 1, matchday: 5, dayIndex: 100, homeId: 'bochum', awayId: 'muenster' };
  const a = ST.zuschauerBerechnen(state, 'bochum', derby);
  const b = ST.zuschauerBerechnen(state, 'bochum', normal);
  assert(a.gesamt > b.gesamt * 1.10, `Derby zu schwach: ${a.gesamt} vs ${b.gesamt}`);
  assert(a.aufschluesselung.derbyName, 'Derbyname fehlt');
});

test('derbyFaktor liegt in 1.0 .. 1.6 und ist symmetrisch', () => {
  const state = buildState();
  const paare = [
    ['dortmund', 'schalke'], ['bayern', 'dortmund'], ['hsv', 'bremen'],
    ['koeln', 'gladbach'], ['bayern', 'am_1860'], ['nuernberg', 'fuerth'],
    ['hertha', 'union'], ['dresden', 'magdeburg'], ['kaiserslautern', 'mainz']
  ];
  for (const [a, b] of paare) {
    const f = ST.derbyFaktor(state, a, b);
    assert(f >= 1.3 && f <= 1.6, `${a}-${b} ist kein Derby (${f})`);
    nahe(f, ST.derbyFaktor(state, b, a), 1e-9, `${a}-${b} nicht symmetrisch`);
  }
  for (const [a, b] of [['bayern', 'heidenheim'], ['bremen', 'freiburg'], ['kiel', 'augsburg']]) {
    nahe(ST.derbyFaktor(state, a, b), 1.0, 1e-9, `${a}-${b} sollte kein Derby sein`);
  }
  nahe(ST.derbyFaktor(state, 'bayern', 'bayern'), 1.0, 1e-9, 'Verein gegen sich selbst');
});

test('Schlechtes Wetter und ungünstige Anstoßzeit kosten Zuschauer', () => {
  const state = buildState();
  const fx = { id: 'y', competitionId: 'bl1', season: 1, matchday: 9, dayIndex: 100, homeId: 'augsburg', awayId: 'mainz' };
  const gut = ST.zuschauerBerechnen(state, 'augsburg', fx, { wetter: 'sonnig', weekday: 5, anstoss: '15:30' });
  const schlecht = ST.zuschauerBerechnen(state, 'augsburg', fx, { wetter: 'schnee', weekday: 0, anstoss: '20:30' });
  assert(schlecht.gesamt < gut.gesamt * 0.95,
    `Wetter/Termin wirken zu schwach: ${gut.gesamt} vs ${schlecht.gesamt}`);
});

test('Tabellenplatz und Form schlagen durch', () => {
  const state = buildState();
  state.tables.bl1 = [{ clubId: 'bremen', platz: 1 }];
  state.clubs.bremen.season.form = ['S', 'S', 'S', 'S', 'S'];
  state.clubs.bremen.fans.dauerkarten = 0;
  const ref = ST.referenzPreise(state, 'bremen');
  const teuer = { steh: ref.steh * 1.6, sitz: ref.sitz * 1.6, vip: ref.vip * 1.6 };
  const fx = { id: 'z', competitionId: 'bl1', season: 1, matchday: 20, dayIndex: 240, homeId: 'bremen', awayId: 'freiburg' };
  const oben = ST.zuschauerBerechnen(state, 'bremen', fx, { preise: teuer });
  state.tables.bl1 = [{ clubId: 'bremen', platz: 17 }];
  state.clubs.bremen.season.form = ['N', 'N', 'N', 'N', 'N'];
  const unten = ST.zuschauerBerechnen(state, 'bremen', fx, { preise: teuer });
  assert(oben.gesamt > unten.gesamt * 1.15,
    `Tabelle/Form wirken zu schwach: ${oben.gesamt} vs ${unten.gesamt}`);
});

console.log('\n=== PREISE ===');

test('preiseSetzen weist Unsinn zurück', () => {
  const state = buildState();
  const alt = Object.assign({}, ST.stadionState(state, 'bremen').preise);
  const r1 = ST.preiseSetzen(state, 'bremen', { steh: 1 });
  assert(!r1.ok, 'Dumpingpreis wurde akzeptiert');
  const r2 = ST.preiseSetzen(state, 'bremen', { sitz: 99999 });
  assert(!r2.ok, 'Mondpreis wurde akzeptiert');
  assert(ST.stadionState(state, 'bremen').preise.steh === alt.steh, 'Preise wurden trotz Fehler geändert');
});

test('Kräftige Preiserhöhung kostet Stimmung, Senkung bringt welche', () => {
  const state = buildState();
  const club = state.clubs.bremen;
  club.fans.mood = 60;
  const ref = ST.referenzPreise(state, 'bremen');
  const hoch = ST.preiseSetzen(state, 'bremen', {
    steh: Math.round(ref.steh * 2), sitz: Math.round(ref.sitz * 2), vip: Math.round(ref.vip * 2)
  });
  assert(hoch.ok, 'Erhöhung wurde abgelehnt: ' + hoch.text);
  assert(hoch.stimmungsEffekt < 0, 'Preiserhöhung ohne Stimmungsverlust');
  assert(club.fans.mood < 60, 'Stimmung nicht gefallen');
  assert(club.fans.protest > 0, 'Kein Protest nach Preisschock');

  const vorher = club.fans.mood;
  const runter = ST.preiseSetzen(state, 'bremen', {
    steh: Math.round(ref.steh * 0.7), sitz: Math.round(ref.sitz * 0.7), vip: Math.round(ref.vip * 0.7)
  });
  assert(runter.ok, 'Senkung wurde abgelehnt: ' + runter.text);
  assert(club.fans.mood > vorher, 'Preissenkung ohne Stimmungsgewinn');
});

test('preisEmpfehlung liefert plausible Preise und eine Begründung', () => {
  const state = buildState();
  for (const id of ['bayern', 'bremen', 'heidenheim', 'muenster']) {
    const e = ST.preisEmpfehlung(state, id);
    assert(e.ok, `${id}: keine Empfehlung`);
    assert(e.preise.steh >= 4 && e.preise.steh <= 40, `${id}: Stehplatzempfehlung ${e.preise.steh} €`);
    assert(e.preise.sitz > e.preise.steh, `${id}: Sitzplatz muss teurer sein als Stehplatz`);
    assert(e.preise.vip > e.preise.sitz, `${id}: VIP muss teurer sein als Sitzplatz`);
    assert(e.preise.dauerkarte > e.preise.sitz * 8, `${id}: Dauerkarte zu billig`);
    assert(Array.isArray(e.begruendung) && e.begruendung.length >= 3, `${id}: Begründung fehlt`);
    const gesetzt = ST.preiseSetzen(state, id, e.preise);
    assert(gesetzt.ok, `${id}: eigene Empfehlung nicht setzbar – ${gesetzt.text}`);
  }
});

console.log('\n=== AUSBAU ===');

test('Ausbau zieht Geld ab, braucht Zeit und erhöht dann die Kapazität', () => {
  const state = buildState('bremen', 60);
  const club = state.clubs.bremen;
  club.finances.balance = 200000000;

  const stufe = ST.AUSBAUSTUFEN.find(s => s.id === 'tribuene_mittel');
  const kapVorher = club.stadium.capacity;
  const geldVorher = club.finances.balance;

  const start = ST.ausbauStarten(state, 'bremen', 'tribuene_mittel');
  assert(start.ok, 'Ausbau konnte nicht gestartet werden: ' + start.text);

  // 1. Anzahlung sofort fällig
  assert(club.finances.balance < geldVorher, 'Es wurde kein Geld abgezogen');
  nahe(geldVorher - club.finances.balance, start.anzahlung, 1,
    'Sofort abgezogener Betrag entspricht nicht der Anzahlung');
  assert(start.anzahlung > 0 && start.anzahlung < start.kosten, 'Anzahlung unplausibel');

  // 2. Kapazität bleibt während der Bauzeit unverändert
  assert(club.stadium.capacity === kapVorher, 'Kapazität stieg schon vor Baubeginn');
  const sb = ST.stadionState(state, 'bremen');
  assert(sb.ausbau, 'Kein Bauvorhaben im State');
  assert(sb.ausbau.restTage === stufe.dauerTage, 'Restdauer falsch initialisiert');

  // 3. Bauzeit abarbeiten
  let fertigNach = null;
  for (let i = 1; i <= stufe.dauerTage + 5; i++) {
    state.date.day = 60 + i;
    ST.tickStadion(state, makeCtx(state));
    if (!sb.ausbau && fertigNach === null) fertigNach = i;
    if (fertigNach === null) {
      assert(club.stadium.capacity === kapVorher,
        `Kapazität stieg schon an Tag ${i} von ${stufe.dauerTage}`);
    }
  }
  assert(fertigNach === stufe.dauerTage,
    `Bauzeit falsch: fertig nach ${fertigNach} statt ${stufe.dauerTage} Tagen`);

  // 4. Kapazität erhöht
  assert(club.stadium.capacity === kapVorher + stufe.effekt.plaetze,
    `Kapazität falsch: ${club.stadium.capacity} statt ${kapVorher + stufe.effekt.plaetze}`);

  // 5. Summe aller Baubuchungen entspricht den Gesamtkosten
  const gebucht = club.finances.ledger
    .filter(e => /Bauvorhaben|Baurate|Schlussrechnung/.test(e.text))
    .reduce((s, e) => s + e.betrag, 0);
  nahe(-gebucht, start.kosten, 2, 'Summe der Baubuchungen weicht von den Gesamtkosten ab');
  nahe(geldVorher - club.finances.balance, start.kosten, 2,
    'Insgesamt abgezogenes Geld weicht von den Gesamtkosten ab');

  // 6. Historie gepflegt
  assert(sb.ausbauHistorie.some(h => h.stufe === 'tribuene_mittel' && !h.abgebrochen),
    'Ausbau fehlt in der Historie');
  console.log(`       (Kosten ${start.kosten} €, ${stufe.dauerTage} Tage, +${stufe.effekt.plaetze} Plätze)`);
});

test('Mehr Plätze bringen mehr Zuschauer und mehr Geld', () => {
  const a = buildState('union', 60);
  const b = buildState('union', 60);
  a.clubs.union.finances.balance = 200000000;
  ST.ausbauStarten(a, 'union', 'tribuene_klein');
  const stufe = ST.AUSBAUSTUFEN.find(s => s.id === 'tribuene_klein');
  for (let i = 1; i <= stufe.dauerTage; i++) {
    a.date.day = 60 + i;
    ST.tickStadion(a, makeCtx(a));
  }
  a.date.day = 100;
  const vorher = ST.zuschauerBerechnen(b, 'union', null, {});
  const nachher = ST.zuschauerBerechnen(a, 'union', null, {});
  assert(nachher.gesamt > vorher.gesamt, `Ausbau bringt keine Zuschauer (${vorher.gesamt} -> ${nachher.gesamt})`);
  assert(nachher.einnahmen > vorher.einnahmen, 'Ausbau bringt keine Mehreinnahmen');
});

test('Ausbau ohne Geld wird abgelehnt', () => {
  const state = buildState('heidenheim', 60);
  state.clubs.heidenheim.finances.balance = 1000;
  const r = ST.ausbauStarten(state, 'heidenheim', 'tribuene_gross');
  assert(!r.ok, 'Bau wurde trotz leerer Kasse genehmigt');
  assert(!ST.stadionState(state, 'heidenheim').ausbau, 'Baustelle trotz Ablehnung angelegt');
});

test('Voraussetzungen werden geprüft', () => {
  const state = buildState('bayern', 60);
  state.clubs.bayern.finances.balance = 500000000;
  const r = ST.ausbauStarten(state, 'bayern', 'dach');   // Allianz Arena hat bereits ein Dach
  assert(!r.ok, 'Dach auf ein überdachtes Stadion genehmigt');
  const r2 = ST.ausbauStarten(state, 'heidenheim', 'tribuene_gross'); // Ruf 52 < 70
  assert(!r2.ok, 'Großausbau ohne den nötigen Ruf genehmigt');
});

test('Zwei Baustellen gleichzeitig sind nicht erlaubt', () => {
  const state = buildState('bremen', 60);
  state.clubs.bremen.finances.balance = 300000000;
  assert(ST.ausbauStarten(state, 'bremen', 'flutlicht').ok, 'Erster Bau abgelehnt');
  const zweiter = ST.ausbauStarten(state, 'bremen', 'videowand');
  assert(!zweiter.ok, 'Zweite Baustelle wurde genehmigt');
});

test('Ausbauabbruch kostet Vertragsstrafe und räumt die Baustelle', () => {
  const state = buildState('bremen', 60);
  const club = state.clubs.bremen;
  club.finances.balance = 300000000;
  ST.ausbauStarten(state, 'bremen', 'tribuene_mittel');
  const vorher = club.finances.balance;
  const kapVorher = club.stadium.capacity;
  const ab = ST.ausbauAbbrechen(state, 'bremen');
  assert(ab.ok, 'Abbruch nicht möglich');
  assert(ab.stornokosten > 0, 'Keine Vertragsstrafe');
  nahe(vorher - club.finances.balance, ab.stornokosten, 1, 'Vertragsstrafe nicht gebucht');
  assert(!ST.stadionState(state, 'bremen').ausbau, 'Baustelle nicht geräumt');
  assert(club.stadium.capacity === kapVorher, 'Kapazität nach Abbruch verändert');
  assert(!ST.ausbauAbbrechen(state, 'bremen').ok, 'Abbruch ohne Baustelle möglich');
});

test('AUSBAUSTUFEN sind vollständig und plausibel', () => {
  assert(ST.AUSBAUSTUFEN.length >= 11, 'Zu wenige Ausbaustufen');
  const ids = new Set();
  for (const s of ST.AUSBAUSTUFEN) {
    assert(s.id && !ids.has(s.id), `Doppelte oder fehlende id: ${s.id}`);
    ids.add(s.id);
    assert(typeof s.name === 'string' && s.name.length > 2, `${s.id}: kein Name`);
    assert(typeof s.desc === 'string' && s.desc.length > 15, `${s.id}: keine Beschreibung`);
    assert(s.kosten > 0 && s.kosten < 200000000, `${s.id}: Kosten unplausibel (${s.kosten})`);
    assert(s.dauerTage >= 20 && s.dauerTage <= 500, `${s.id}: Bauzeit unplausibel (${s.dauerTage})`);
    assert(s.effekt && typeof s.effekt === 'object', `${s.id}: kein Effekt`);
    assert(s.voraussetzung && typeof s.voraussetzung.pruef === 'function', `${s.id}: keine Voraussetzung`);
  }
  // Referenzvorgabe: 10.000 Plätze für 35–55 Mio in 250–400 Tagen
  const gross = ST.AUSBAUSTUFEN.find(s => s.effekt.plaetze === 10000);
  assert(gross, 'Keine Stufe mit +10.000 Plätzen');
  assert(gross.kosten >= 35000000 && gross.kosten <= 55000000, `10.000 Plätze kosten ${gross.kosten} €`);
  assert(gross.dauerTage >= 250 && gross.dauerTage <= 400, `10.000 Plätze dauern ${gross.dauerTage} Tage`);
});

console.log('\n=== DAUERKARTEN, CATERING, RASEN ===');

test('Dauerkartenverkauf setzt Anzahl und bucht den Erlös', () => {
  const state = buildState();
  const club = state.clubs.bremen;
  const geld = club.finances.balance;
  const r = ST.dauerkartenVerkauf(state, 'bremen', createRng('dk'));
  assert(r.ok && r.anzahl > 0, 'Kein Dauerkartenverkauf');
  assert(club.fans.dauerkarten === r.anzahl, 'club.fans.dauerkarten nicht gesetzt');
  assert(r.anzahl <= club.stadium.capacity, 'Mehr Dauerkarten als Plätze');
  nahe(club.finances.balance - geld, r.einnahmen, 1, 'Erlös nicht gebucht');
  assert(ledgerSumme(club, 'zuschauer') === r.einnahmen, 'Falsche Ledger-Kategorie');
});

test('Teure Dauerkarten verkaufen sich schlechter', () => {
  const a = buildState(), b = buildState();
  ST.stadionState(a, 'bremen').preise.dauerkarte = 300;
  ST.stadionState(b, 'bremen').preise.dauerkarte = 900;
  const ra = ST.dauerkartenVerkauf(a, 'bremen', null);
  const rb = ST.dauerkartenVerkauf(b, 'bremen', null);
  assert(rb.anzahl < ra.anzahl, `Preis wirkt nicht (${ra.anzahl} vs ${rb.anzahl})`);
});

test('cateringErtrag skaliert mit Zuschauern und Ausbaustand', () => {
  const state = buildState();
  const wenig = ST.cateringErtrag(state, 'bremen', 10000);
  const viel = ST.cateringErtrag(state, 'bremen', 40000);
  nahe(viel.gesamt / wenig.gesamt, 4, 0.05, 'Catering skaliert nicht linear mit den Zuschauern');
  assert(wenig.proKopf > 4 && wenig.proKopf < 20, `Pro-Kopf-Umsatz unplausibel: ${wenig.proKopf} €`);
  ST.stadionState(state, 'bremen').catering = 100;
  const besser = ST.cateringErtrag(state, 'bremen', 10000);
  assert(besser.gesamt > wenig.gesamt, 'Gastronomieausbau bringt nichts');
  const mitVip = ST.cateringErtrag(state, 'bremen', { gesamt: 10000, vip: 800 });
  assert(mitVip.gesamt > besser.gesamt, 'VIP-Gäste bringen keinen Zuschlag');
});

test('rasenPflegen kostet Geld und hebt den Rasenwert', () => {
  const state = buildState();
  const club = state.clubs.bremen;
  club.finances.balance = 5000000;
  const s = ST.stadionState(state, 'bremen');
  s.rasenZustand = 60;
  const geld = club.finances.balance;
  const r = ST.rasenPflegen(state, 'bremen', 100);
  assert(r.ok, 'Pflege abgelehnt: ' + r.text);
  assert(s.rasenZustand > 60, 'Rasen nicht besser');
  assert(club.stadium.pitch === Math.round(s.rasenZustand), 'stadium.pitch nicht mitgeführt');
  nahe(geld - club.finances.balance, r.kosten, 1, 'Kosten nicht gebucht');
  club.finances.balance = 100;
  assert(!ST.rasenPflegen(state, 'bremen', 100).ok, 'Pflege trotz leerer Kasse');
});

test('Rasen verschleißt über die Saison und regeneriert', () => {
  const state = buildState('bremen', 60);
  const club = state.clubs.bremen;
  const s = ST.stadionState(state, 'bremen');
  s.rasenZustand = 90;
  for (let i = 0; i < 30; i++) {
    state.date.day = 60 + i;
    state.fixtures = (i % 7 === 0)
      ? [{ id: 'f' + i, competitionId: 'bl1', season: 1, dayIndex: 60 + i, homeId: 'bremen', awayId: 'freiburg' }]
      : [];
    ST.tickStadion(state, makeCtx(state));
  }
  assert(s.rasenZustand < 90, 'Rasen nutzt sich durch Spiele nicht ab');
  assert(s.rasenZustand > 40, 'Rasen verfällt zu schnell');
});

console.log('\n=== TICK, WIRTSCHAFT, BERICHT ===');

test('tickStadion läuft für alle 36 Vereine und bucht Betriebskosten', () => {
  const state = buildState('bremen', 60);
  const salden = {};
  for (const id of Object.keys(state.clubs)) salden[id] = state.clubs[id].finances.balance;
  ST.tickStadion(state, makeCtx(state, { isMonthStart: true }));
  for (const id of Object.keys(state.clubs)) {
    assert(state.clubs[id].finances.balance < salden[id], `${id}: keine Betriebskosten gebucht`);
  }
  const bayern = ST.betriebskostenJahr(state, 'bayern');
  assert(bayern > 6000000 && bayern < 25000000, `Bayern-Betriebskosten unplausibel: ${bayern}`);
  const heiden = ST.betriebskostenJahr(state, 'heidenheim');
  assert(heiden > 800000 && heiden < 5000000, `Heidenheim-Betriebskosten unplausibel: ${heiden}`);
});

test('Eine Saison Ticks ist bezahlbar schnell', () => {
  const state = buildState('bremen', 0);
  const t0 = process.hrtime.bigint();
  for (let d = 0; d < 365; d++) {
    state.date.day = d;
    ST.tickStadion(state, makeCtx(state, { isMonthStart: d % 30 === 0 }));
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert(ms < 2500, `365 Tage × 36 Vereine dauern ${Math.round(ms)} ms – zu langsam`);
  console.log(`       (365 Tage × 36 Vereine: ${Math.round(ms)} ms)`);
});

test('spieltagAbrechnen bucht Tickets, Catering und Spieltagskosten', () => {
  const state = buildState('bremen', 100);
  const club = state.clubs.bremen;
  ST.dauerkartenVerkauf(state, 'bremen', createRng('dk2'));
  club.finances.ledger.length = 0;
  const fx = { id: 'f1', competitionId: 'bl1', season: 1, matchday: 10, dayIndex: 100, homeId: 'bremen', awayId: 'hsv' };
  const z = ST.spieltagAbrechnen(state, 'bremen', fx);
  assert(z.gesamt > 0, 'Keine Zuschauer');
  assert(ledgerSumme(club, 'zuschauer') === z.einnahmen, 'Zuschauererlös nicht als "zuschauer" gebucht');
  assert(ledgerSumme(club, 'merch') > 0, 'Catering nicht als "merch" gebucht');
  assert(ledgerSumme(club, 'stadion') < 0, 'Spieltagskosten nicht gebucht');
  const sz = ST.stadionState(state, 'bremen');
  assert(sz.letzteZuschauer === z.gesamt, 'letzteZuschauer nicht gesetzt');
  assert(sz.auslastungSchnitt > 0, 'auslastungSchnitt nicht gepflegt');
});

test('Zuschauereinnahmen einer Saison liegen im Zielkorridor', () => {
  const state = buildState('bremen', 100);
  for (const id of ['bayern', 'bremen', 'heidenheim']) {
    ST.dauerkartenVerkauf(state, id, createRng('dk:' + id));
    const z = ST.zuschauerBerechnen(state, id, null, {});
    const cat = ST.cateringErtrag(state, id, z);
    const saison = (z.einnahmen + cat.gesamt) * 17 + ST.stadionState(state, id).dauerkartenErloes;
    if (id === 'bayern') assert(saison > 50e6 && saison < 140e6, `Bayern-Spieltagserlös: ${Math.round(saison / 1e6)} Mio`);
    if (id === 'bremen') assert(saison > 12e6 && saison < 50e6, `Bremen-Spieltagserlös: ${Math.round(saison / 1e6)} Mio`);
    if (id === 'heidenheim') assert(saison > 2e6 && saison < 15e6, `Heidenheim-Spieltagserlös: ${Math.round(saison / 1e6)} Mio`);
  }
});

test('stadionWert und heimvorteil sind plausibel', () => {
  const state = buildState();
  const wBayern = ST.stadionWert(state, 'bayern');
  const wMuenster = ST.stadionWert(state, 'muenster');
  assert(wBayern > 200e6 && wBayern < 700e6, `Allianz Arena: ${Math.round(wBayern / 1e6)} Mio`);
  assert(wMuenster > 10e6 && wMuenster < 80e6, `Preußenstadion: ${Math.round(wMuenster / 1e6)} Mio`);
  assert(wBayern > wMuenster * 4, 'Wertspanne zu klein');

  const voll = ST.heimvorteil(state, 'dortmund', { auslastung: 1.0 });
  const leer = ST.heimvorteil(state, 'dortmund', { auslastung: 0.15 });
  assert(voll.wert > leer.wert + 0.3, 'Auslastung dominiert den Heimvorteil nicht');
  assert(voll.wert <= 1 && leer.wert >= 0, 'Heimvorteil außerhalb 0..1');
  assert(typeof voll.text === 'string' && voll.text.length > 10, 'Kein Text zum Heimvorteil');
});

test('stadionBericht liefert deutschen Fließtext', () => {
  const state = buildState();
  ST.dauerkartenVerkauf(state, 'bremen', createRng('dk3'));
  const t = ST.stadionBericht(state, 'bremen');
  assert(typeof t === 'string' && t.length > 300, 'Bericht zu kurz');
  assert(t.includes('Weserstadion'), 'Stadionname fehlt');
  assert(/Rasen/.test(t) && /Preise/.test(t) && /Auslastung/.test(t), 'Bericht unvollständig');
  assert(!/undefined|NaN/.test(t), 'Bericht enthält undefined/NaN');
});

test('Aktionen werfen keine Exceptions bei Unfug-Eingaben', () => {
  const state = buildState();
  const proben = [
    () => ST.zuschauerBerechnen(state, 'gibtsnicht', null, {}),
    () => ST.preiseSetzen(state, 'gibtsnicht', { sitz: 20 }),
    () => ST.preiseSetzen(state, 'bremen', {}),
    () => ST.preiseSetzen(state, 'bremen', { sitz: 'viel' }),
    () => ST.preisEmpfehlung(state, 'gibtsnicht'),
    () => ST.ausbauStarten(state, 'bremen', 'raumschiff'),
    () => ST.ausbauAbbrechen(state, 'gibtsnicht'),
    () => ST.stadionWert(state, 'gibtsnicht'),
    () => ST.cateringErtrag(state, 'gibtsnicht', 1000),
    () => ST.dauerkartenVerkauf(state, 'gibtsnicht', null),
    () => ST.rasenPflegen(state, 'bremen', -5),
    () => ST.derbyFaktor(state, null, undefined)
  ];
  for (const p of proben) {
    const r = p();
    assert(r !== undefined, 'Aktion lieferte undefined');
  }
});

/* ------------------------------------------------------------------ */

console.log('');
if (fehler.length) {
  console.log(`FEHLGESCHLAGEN: ${fehler.length} von ${bestanden + fehler.length} Tests`);
  for (const f of fehler) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log(`Alle ${bestanden} Tests bestanden. Das Stadion steht.`);
  console.log(`(Saisonanker geprüft: Ligastart Tag ${SAISON_TAGE.ligaStart})`);
}
