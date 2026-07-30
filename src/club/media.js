/**
 * club/media.js — DIE MEDIEN
 *
 * Zuständig für: Schlagzeilen, Vorberichte, Analysen, Wochenzeitung,
 * Pressekonferenzen mit echten Abwägungen, Spielerinterviews, gestreute
 * Gerüchte, Mediendruck und den großen Saisonrückblick.
 *
 * Reine Logik: kein DOM, kein Math.random(), kein Date.now().
 *
 * ZUSTÄNDIGKEIT (CONTRACTS.md §11): `state.presse.*` gehört diesem Modul.
 * Die im Auftrag vorgeschriebene Wirkung von Presseantworten greift bewusst
 * über die Modulgrenze hinaus — sie verändert in kleinen, geklemmten Schritten
 * `club.moral`, `club.fans.mood`, `club.board.zufriedenheit/vertrauen` und
 * `player.morale`. Das ist der einzige Schreibzugriff nach außen und immer
 * Folge einer bewussten Manager-Entscheidung.
 *
 * Speicherbarkeit: Fragen werden als reine Daten in `state.presse.offeneFragen`
 * abgelegt (Texte bereits aufgelöst), damit `antwortGeben()` auch nach
 * Speichern/Laden funktioniert.
 */

import { clamp, formatMoney, round, uid, sortBy } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { LEAGUES, computeTable, leagueOfClub, qualificationFor, SAISON_TAGE } from '../data/leagues.js';

/* ================================================================== *
 *  BALANCING
 * ================================================================== */

/** Wie viele Schlagzeilen an einem gewöhnlichen Tag gedruckt werden. */
const SCHLAGZEILEN_ALLTAG = 1;
const SCHLAGZEILEN_NACH_SPIEL = 3;
const SCHLAGZEILEN_WOCHENZEITUNG = 5;

/** Mediendruck: Grundwert und Gewichte (Ergebnis 0..100). */
const DRUCK_BASIS = 42;
const DRUCK_GEWICHT_SERIE = 26;      // Niederlagenserien
const DRUCK_GEWICHT_ZIEL = 20;       // Abstand zum Saisonziel
const DRUCK_GEWICHT_FANS = 14;       // Fanstimmung
const DRUCK_GEWICHT_VORSTAND = 12;   // Vorstandszufriedenheit
const DRUCK_GEWICHT_REPUTATION = 8;  // große Vereine stehen stärker im Feuer
/** Wie schnell sich der gespeicherte Druckwert dem Zielwert annähert (pro Tag). */
const DRUCK_TRAEGHEIT = 0.25;

/** Wirkungsgrenzen einer einzelnen Presseantwort. */
const WIRKUNG_MAX_MORAL = 8;
const WIRKUNG_MAX_FANS = 8;
const WIRKUNG_MAX_VORSTAND = 7;
const WIRKUNG_MAX_SPIELER = 14;
/** Wenn ein Risiko eintritt, kehrt sich die Wirkung mit diesem Faktor um. */
const RISIKO_UMKEHR = 1.35;

/** Fragen je Pressekonferenz. */
const FRAGEN_PRO_PK = 4;
/** Eine großspurige Ankündigung erhöht die Erwartung für so viele Tage. */
const ANKUENDIGUNG_TAGE = 21;

/** Gerüchte streuen: Erfolgs- und Auffliegwahrscheinlichkeit. */
const GERUECHT_GRUNDCHANCE = 0.55;
const GERUECHT_AUFFLIEG_BASIS = 0.28;

/**
 * ENGLISCHE WOCHE (ROADMAP Stufe 3, Punkt 6).
 *
 * Drei Pflichtspiele in acht Tagen — das ist der Terminplan, den man dem
 * Trainer vorhält und der den Physiotherapeuten das Wochenende kostet. Acht
 * Tage sind bewusst nicht sieben: Samstag – Mittwoch – Samstag sind sieben
 * Tage Abstand und acht Tage Zeitraum, und genau diese Folge ist gemeint.
 *
 * Der Wert ist die Bedingung der Schlagzeile `doppelbelastung` und wird
 * zusätzlich auf dem Büroplan und im Spieltags-Vorbericht angezeigt. Er hat
 * bewusst NICHTS mit club/medical.js:BELASTUNG_FENSTER (15 Tage, je Spieler)
 * zu tun: Dort geht es um die Beine eines einzelnen Mannes, hier um den
 * Kalender der ganzen Mannschaft.
 */
const ENGLISCH_FENSTER = 8;      // Tage, einschließlich des ersten
const ENGLISCH_SPIELE = 3;       // Pflichtspiele in diesem Fenster
/**
 * Ab wann die englische Woche eine Nachricht ist und keine Kalenderzeile.
 *
 * Für einen Champions-League-Starter ist der Sa–Mi–Sa-Takt von September bis
 * Mai der Normalfall: `englisch` trifft an rund der Hälfte aller Tage zu
 * (gemessen mit Seed 7, Bayern, eine Saison: 179 von 320 Tagen; ein
 * Zweitligist ohne Europapokal kommt auf 64). Ein Hinweis, der ständig
 * dasteht, wird zur Tapete — Büroplan und Vorbericht zeigen ihn deshalb erst,
 * wenn es losgeht.
 */
const ENGLISCH_AKUT_TAGE = 3;

/* ================================================================== *
 *  DIE BLÄTTER
 * ================================================================== */

/**
 * Sechs erfundene Medien mit eigenem Charakter.
 * `stil` steuert die Formulierung, `schaerfe` (0..100) die Gnadenlosigkeit,
 * `reichweite` (0..100) wie stark eine Meldung auf Fans und Vorstand wirkt.
 */
export const BLAETTER = [
  {
    id: 'kicker_bote', name: 'Der Kicker-Bote', kuerzel: 'KB',
    stil: 'serioes', tonfall: 'seriös', schaerfe: 30, reichweite: 78,
    beschreibung: 'Fachblatt mit Notenspiegel. Erklärt lieber, als zu urteilen — und urteilt dann doch.'
  },
  {
    id: 'sport_kurier', name: 'Sport-Kurier', kuerzel: 'SK',
    stil: 'serioes', tonfall: 'analytisch', schaerfe: 48, reichweite: 66,
    beschreibung: 'Zahlen, Grafiken, Zweikampfquoten. Wer hier zerlegt wird, wurde vorher vermessen.'
  },
  {
    id: 'bildschirm', name: 'BILDSCHIRM', kuerzel: 'BS',
    stil: 'boulevard', tonfall: 'boulevardesk', schaerfe: 96, reichweite: 100,
    beschreibung: 'Große Buchstaben, kurze Wörter, keine Gefangenen. Weiß alles zuerst, manchmal sogar richtig.'
  },
  {
    id: 'fussball_woche', name: 'Fußball-Woche', kuerzel: 'FW',
    stil: 'serioes', tonfall: 'seriös', schaerfe: 38, reichweite: 60,
    beschreibung: 'Erscheint montags, denkt in Halbserien und hat für alles ein historisches Beispiel.'
  },
  {
    id: 'lokalanzeiger', name: 'Lokalanzeiger', kuerzel: 'LA',
    stil: 'vereinsnah', tonfall: 'vereinsnah', schaerfe: 18, reichweite: 44,
    beschreibung: 'Steht zum Verein wie die Familie zum missratenen Onkel. Kritik nur unter Tränen.'
  },
  {
    id: 'radio_liga_live', name: 'Radio Liga Live', kuerzel: 'RLL',
    stil: 'haemisch', tonfall: 'hämisch', schaerfe: 74, reichweite: 82,
    beschreibung: 'Konferenzschaltung mit Grinsen in der Stimme. Lebt von fremdem Unglück.'
  }
];

export const BLAETTER_BY_ID = BLAETTER.reduce((o, b) => { o[b.id] = b; return o; }, {});

/* ================================================================== *
 *  Infrastruktur
 * ================================================================== */

function presseState(state) {
  if (!state.presse) {
    state.presse = {
      druck: DRUCK_BASIS,
      offeneFragen: [],
      beantwortet: [],
      geruechte: [],
      ankuendigungen: [],
      letztePk: -99,
      glaubwuerdigkeit: 60,
      archiv: []
    };
  }
  const p = state.presse;
  if (typeof p.druck !== 'number') p.druck = DRUCK_BASIS;
  if (!Array.isArray(p.offeneFragen)) p.offeneFragen = [];
  if (!Array.isArray(p.beantwortet)) p.beantwortet = [];
  if (!Array.isArray(p.geruechte)) p.geruechte = [];
  if (!Array.isArray(p.ankuendigungen)) p.ankuendigungen = [];
  if (!Array.isArray(p.archiv)) p.archiv = [];
  if (typeof p.glaubwuerdigkeit !== 'number') p.glaubwuerdigkeit = 60;
  if (typeof p.letztePk !== 'number') p.letztePk = -99;
  return p;
}

function istManagerClub(state, clubId) { return state.managerClubId === clubId; }

function post(state, ctx, clubId, msg) {
  if (!istManagerClub(state, clubId)) return null;
  const kind = msg.kind || 'presse';
  if (ctx && typeof ctx.log === 'function') {
    return ctx.log(msg.body, kind, {
      from: msg.from || 'Presseabteilung', subject: msg.subject,
      wichtig: !!msg.wichtig, aktionen: msg.aktionen || null
    });
  }
  const m = {
    id: uid('msg'), day: state.date.day, season: state.date.season, kind,
    from: msg.from || 'Presseabteilung', subject: msg.subject || '', body: msg.body || '',
    gelesen: false, wichtig: !!msg.wichtig, aktionen: msg.aktionen || null
  };
  if (!Array.isArray(state.inbox)) state.inbox = [];
  state.inbox.unshift(m);
  if (state.inbox.length > 300) state.inbox.length = 300;
  return m;
}

function ticker(state, ctx, clubId, text, kind = 'presse') {
  if (!istManagerClub(state, clubId)) return;
  if (ctx && typeof ctx.news === 'function') { ctx.news(text, kind); return; }
  if (!Array.isArray(state.news)) state.news = [];
  state.news.unshift({ id: uid('news'), day: state.date.day, season: state.date.season, text, kind });
  if (state.news.length > 200) state.news.length = 200;
}

function rngFuer(state, label) {
  return createRng(`media:${state.seed}:${state.date.season}:${state.date.day}:${label}`);
}

function toreAus(fixture) {
  const res = fixture && fixture.result;
  if (!res) return null;
  if (Array.isArray(res) && res.length >= 2) return [res[0], res[1]];
  if (Array.isArray(res.score) && res.score.length >= 2) return [res.score[0], res.score[1]];
  if (typeof res.home === 'number' && typeof res.away === 'number') return [res.home, res.away];
  if (typeof res.heim === 'number' && typeof res.gast === 'number') return [res.heim, res.gast];
  if (typeof res.homeGoals === 'number' && typeof res.awayGoals === 'number') return [res.homeGoals, res.awayGoals];
  return null;
}

const _tabCache = { key: '', tabellen: {} };

function tabelleVon(state, ligaId) {
  const vorhanden = state.tables && state.tables[ligaId];
  if (Array.isArray(vorhanden) && vorhanden.length) return vorhanden;
  const liga = LEAGUES[ligaId];
  if (!liga) return [];
  const key = `${state.date.season}:${state.date.day}:${state.tick || 0}`;
  if (_tabCache.key !== key) { _tabCache.key = key; _tabCache.tabellen = {}; }
  if (!_tabCache.tabellen[ligaId]) {
    _tabCache.tabellen[ligaId] = computeTable(state.fixtures || [], liga.clubIds, { competitionId: ligaId });
  }
  return _tabCache.tabellen[ligaId];
}

function lageVon(state, clubId) {
  const club = state.clubs[clubId];
  const ligaId = (club && club.leagueId) || leagueOfClub(clubId) || 'bl1';
  const zeile = tabelleVon(state, ligaId).find(z => z.clubId === clubId);
  const teams = LEAGUES[ligaId] ? LEAGUES[ligaId].clubIds.length : 18;
  if (!zeile) return { platz: Math.ceil(teams / 2), punkte: 0, spiele: 0, tore: 0, gegentore: 0, diff: 0, teams, ligaId };
  return {
    platz: zeile.platz, punkte: zeile.punkte, spiele: zeile.spiele,
    tore: zeile.tore, gegentore: zeile.gegentore, diff: zeile.diff, teams, ligaId
  };
}

/** Letzte Spiele eines Vereins, chronologisch (ältestes zuerst). */
function letzteSpiele(state, clubId, n = 5) {
  const alle = (state.fixtures || []).filter(f =>
    f && f.played && (f.homeId === clubId || f.awayId === clubId) &&
    f.season === state.date.season && toreAus(f) !== null);
  const sortiert = alle.sort((a, b) => a.dayIndex - b.dayIndex).slice(-n);
  return sortiert.map(f => {
    const [h, a] = toreAus(f);
    const heim = f.homeId === clubId;
    const eigen = heim ? h : a;
    const fremd = heim ? a : h;
    return {
      fixture: f, heim, tore: eigen, gegentore: fremd,
      gegnerId: heim ? f.awayId : f.homeId,
      ergebnis: eigen > fremd ? 'S' : eigen < fremd ? 'N' : 'U',
      wettbewerb: f.competitionId, tag: f.dayIndex
    };
  });
}

function naechstesSpiel(state, clubId) {
  const kommend = (state.fixtures || []).filter(f =>
    f && !f.played && (f.homeId === clubId || f.awayId === clubId) &&
    f.season === state.date.season && f.dayIndex >= state.date.day)
    .sort((a, b) => a.dayIndex - b.dayIndex);
  const f = kommend[0];
  if (!f) return null;
  const heim = f.homeId === clubId;
  return {
    fixture: f, heim, tag: f.dayIndex, wettbewerb: f.competitionId,
    gegnerId: heim ? f.awayId : f.homeId
  };
}

/**
 * Steht eine englische Woche an? Drei Pflichtspiele in acht Tagen.
 *
 * Gesucht wird das erste Acht-Tage-Fenster, das noch nicht vorbei ist und in
 * dem mindestens drei Pflichtspiele liegen — Liga, Pokal und Europapokal
 * zählen gleich, Freilose zählen nicht (wer nicht spielt, ermüdet nicht).
 * Angesehen wird ein Korridor von zwei Wochen um den Stichtag; weiter voraus
 * interessiert es niemanden, und Rückschau braucht es nicht: Ein Fenster, das
 * gestern endete, ist keine Belastung mehr, sondern eine Erinnerung.
 *
 * Rein lesend, ohne Zufall — dieselbe Lage ergibt immer dieselbe Antwort.
 *
 * @param {object} state
 * @param {string} clubId
 * @param {object} [opts]  { tag, saison } — Stichtag, Vorgabe: heute
 * @returns {{ englisch:boolean, spiele:number, von:number, bis:number,
 *             tageBisStart:number, laufend:boolean, akut:boolean,
 *             partien:Array<{ fixture, tag, heim, gegnerId, wettbewerb }> }}
 *   `akut` heißt: läuft bereits oder beginnt binnen drei Tagen — das ist die
 *   Schwelle, ab der Büroplan und Vorbericht den Hinweis zeigen.
 */
export function englischeWoche(state, clubId, opts = {}) {
  const tag = opts.tag !== undefined ? opts.tag : state.date.day;
  const saison = opts.saison !== undefined ? opts.saison : state.date.season;
  const leer = {
    englisch: false, spiele: 0, von: 0, bis: 0,
    tageBisStart: 0, laufend: false, akut: false, partien: []
  };
  if (!state || !state.fixtures || !clubId) return leer;

  // Gesammelt wird großzügig (sonst zählt das letzte Fenster zu wenig Spiele),
  // gemeldet aber nur ein Fenster, das läuft oder binnen acht Tagen beginnt.
  // Eine Terminfalle in drei Wochen ist keine Nachricht, sondern ein Kalender.
  const partien = state.fixtures.filter(f =>
    f && f.season === saison && !f.freilos &&
    (f.homeId === clubId || f.awayId === clubId) &&
    f.dayIndex > tag - ENGLISCH_FENSTER && f.dayIndex <= tag + 2 * ENGLISCH_FENSTER)
    .sort((a, b) => a.dayIndex - b.dayIndex);
  if (partien.length < ENGLISCH_SPIELE) return leer;

  for (let i = 0; i + ENGLISCH_SPIELE - 1 < partien.length; i++) {
    const von = partien[i].dayIndex;
    const bis = von + ENGLISCH_FENSTER - 1;
    if (bis < tag) continue;                       // längst abgehakt
    if (von > tag + ENGLISCH_FENSTER) break;       // noch zu weit weg
    const fenster = partien.filter(f => f.dayIndex >= von && f.dayIndex <= bis);
    if (fenster.length < ENGLISCH_SPIELE) continue;
    return {
      englisch: true,
      spiele: fenster.length,
      von, bis,
      tageBisStart: Math.max(0, von - tag),
      laufend: von <= tag,
      akut: von - tag <= ENGLISCH_AKUT_TAGE,
      partien: fenster.map(f => ({
        fixture: f, tag: f.dayIndex, heim: f.homeId === clubId,
        gegnerId: f.homeId === clubId ? f.awayId : f.homeId,
        wettbewerb: f.competitionId
      }))
    };
  }
  return leer;
}

function clubName(state, id, kurz = true) {
  const c = state.clubs[id];
  if (c) return kurz ? (c.shortName || c.name) : c.name;
  return 'dem Gegner';
}

function kader(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return [];
  return (club.playerIds || []).map(id => state.players[id]).filter(Boolean);
}

function schnittNote(p) {
  const s = p.stats && p.stats.season;
  if (!s || !s.notenAnzahl) return null;
  return s.notenSumme / s.notenAnzahl;
}

/* ================================================================== *
 *  SCHLAGZEILEN
 * ================================================================== */

/**
 * Anlass-Katalog. Jeder Eintrag liefert Titel und Text je Stilrichtung.
 * k = Kontextobjekt (siehe schlagzeilenKontext).
 */
const ANLAESSE = [
  {
    id: 'kantersieg', gewicht: 10,
    wenn: k => k.letztes && k.letztes.ergebnis === 'S' && k.letztes.tore - k.letztes.gegentore >= 3,
    varianten: {
      serioes: k => ({ titel: `${k.name} demontiert ${clubName(k.state, k.letztes.gegnerId)}`, text: `Ein reifer Auftritt: ${k.tore}:${k.gegentore} gegen ${clubName(k.state, k.letztes.gegnerId)}. Die Mannschaft von ${k.trainer} kombinierte über weite Strecken wie aus einem Guss.` }),
      boulevard: k => ({ titel: `${k.tore}:${k.gegentore}! DIESE ELF MACHT SÜCHTIG`, text: `Was für ein Fest! ${k.name} zerlegt ${clubName(k.state, k.letztes.gegnerId)} nach Strich und Faden. Die Fans singen schon vom nächsten Titel — und wir singen mit.` }),
      vereinsnah: k => ({ titel: `Ein Nachmittag zum Einrahmen`, text: `${k.tore}:${k.gegentore} — so hat man das hier lange nicht gesehen. Im Vereinsheim hat der Wirt nach Abpfiff eine Runde ausgegeben.` }),
      haemisch: k => ({ titel: `${clubName(k.state, k.letztes.gegnerId)} beim Nachmittagsspaziergang zugesehen`, text: `${k.tore}:${k.gegentore}. Mehr muss man über die Gästeabwehr eigentlich nicht sagen. Wir tun es trotzdem: sie war nicht da.` })
    }
  },
  {
    id: 'sieg', gewicht: 8,
    wenn: k => k.letztes && k.letztes.ergebnis === 'S',
    varianten: {
      serioes: k => ({ titel: `${k.name} gewinnt ${k.letztes.tore}:${k.letztes.gegentore}`, text: `Ein Arbeitssieg gegen ${clubName(k.state, k.letztes.gegnerId)}. ${k.name} steht damit auf Platz ${k.platz}.` }),
      boulevard: k => ({ titel: `DREIER! Und plötzlich träumen alle wieder`, text: `${k.letztes.tore}:${k.letztes.gegentore} — und die Rechnerei geht los. Platz ${k.platz}, und der Trainer tut so, als wäre das alles ganz normal.` }),
      vereinsnah: k => ({ titel: `Verdienter Sieg vor treuer Kulisse`, text: `Die Mannschaft hat gekämpft, das Publikum hat getragen. ${k.letztes.tore}:${k.letztes.gegentore} gegen ${clubName(k.state, k.letztes.gegnerId)}.` }),
      haemisch: k => ({ titel: `Sieg — man höre und staune`, text: `${k.letztes.tore}:${k.letztes.gegentore}. Ob das der Anfang von etwas ist oder nur ein Betriebsunfall, klären wir kommende Woche.` })
    }
  },
  {
    id: 'niederlage', gewicht: 9,
    wenn: k => k.letztes && k.letztes.ergebnis === 'N',
    varianten: {
      serioes: k => ({ titel: `${k.name} unterliegt ${clubName(k.state, k.letztes.gegnerId)}`, text: `${k.letztes.tore}:${k.letztes.gegentore} — zu wenig Zug zum Tor, zu viele einfache Ballverluste. Platz ${k.platz} nach ${k.spiele} Spielen.` }),
      boulevard: k => ({ titel: `PLEITE! Wie lange geht das noch gut?`, text: `${k.letztes.tore}:${k.letztes.gegentore}. Auf der Tribüne wurde gepfiffen, in der Kabine geschwiegen. Fragen an ${k.trainer} gab es reichlich, Antworten weniger.` }),
      vereinsnah: k => ({ titel: `Kopf hoch — aber bitte bald besser`, text: `Auch dieser Verein hat schon schwierigere Zeiten überstanden. Das ${k.letztes.tore}:${k.letztes.gegentore} tut trotzdem weh.` }),
      haemisch: k => ({ titel: `Und wieder nichts`, text: `${k.letztes.tore}:${k.letztes.gegentore}. Unser Kollege im Stadion meldet: Die Bratwurst war gut.` })
    }
  },
  {
    id: 'niederlagenserie', gewicht: 16,
    wenn: k => k.pleitenSerie >= 3,
    varianten: {
      serioes: k => ({ titel: `${k.pleitenSerie} Niederlagen in Folge — ${k.name} in der Krise`, text: `Die Zahlen sind eindeutig: kein Sieg seit ${k.pleitenSerie} Spielen, Platz ${k.platz}. Der Aufsichtsrat beobachtet die Lage nach eigenen Angaben „mit Interesse".` }),
      boulevard: k => ({ titel: `${k.pleitenSerie} PLEITEN! WANN KRACHT ES?`, text: `Der freie Fall geht weiter. Wie lange hält der Vorstand noch still? In der Geschäftsstelle brennt seit Tagen abends Licht.` }),
      vereinsnah: k => ({ titel: `Schwere Wochen für unsere Elf`, text: `${k.pleitenSerie} Niederlagen nacheinander. Wer jetzt ins Stadion kommt, zeigt Charakter — und davon gibt es hier reichlich.` }),
      haemisch: k => ({ titel: `Serie! Aber leider die falsche`, text: `${k.pleitenSerie} Niederlagen am Stück. In dieser Disziplin ist ${k.name} derzeit ligaweit führend.` })
    }
  },
  {
    id: 'siegesserie', gewicht: 14,
    wenn: k => k.siegSerie >= 3,
    varianten: {
      serioes: k => ({ titel: `${k.siegSerie} Siege in Folge — ${k.name} kommt ins Rollen`, text: `Was zunächst nach Zufall aussah, hat System bekommen: ${k.siegSerie} Erfolge nacheinander, Platz ${k.platz}.` }),
      boulevard: k => ({ titel: `NICHT ZU STOPPEN! ${k.siegSerie} SIEGE AM STÜCK`, text: `Ganz Fußballdeutschland schaut auf ${k.name}. Wer soll die aufhalten? Wir hätten da ein paar Ideen, behalten sie aber für uns.` }),
      vereinsnah: k => ({ titel: `Eine Serie, die Freude macht`, text: `${k.siegSerie} Siege — die Dauerkarteninhaber kommen aus dem Grinsen nicht heraus.` }),
      haemisch: k => ({ titel: `${k.siegSerie} Siege — jetzt wird es gefährlich`, text: `Denn nichts fällt in diesem Geschäft so tief wie eine Mannschaft, die sich für gut hält.` })
    }
  },
  {
    id: 'vorbericht', gewicht: 12,
    wenn: k => k.naechstes && k.naechstes.tag - k.tag <= 2 && k.naechstes.tag >= k.tag,
    varianten: {
      serioes: k => ({ titel: `${k.name} empfängt Prüfung: ${clubName(k.state, k.naechstes.gegnerId)}`, text: `${k.naechstes.heim ? 'Heimspiel' : 'Auswärtsaufgabe'} gegen ${clubName(k.state, k.naechstes.gegnerId, false)}. Personell ${k.verletzte >= 3 ? 'angespannt' : 'weitgehend entspannt'}.` }),
      boulevard: k => ({ titel: `JETZT GILT'S! ${clubName(k.state, k.naechstes.gegnerId)} kommt`, text: `Alles oder nichts, sagt der Boulevard. Alles oder nichts, sagen wir auch. Anpfiff ist trotzdem erst am Samstag.` }),
      vereinsnah: k => ({ titel: `Aufruf an alle: Kommt ins Stadion`, text: `Gegen ${clubName(k.state, k.naechstes.gegnerId)} braucht die Mannschaft jede Stimme. Der Fanbus fährt zwei Stunden vor Anpfiff.` }),
      haemisch: k => ({ titel: `Duell zweier Formkurven`, text: `Die eine zeigt nach unten, die andere auch. Man darf sich also auf Fußball freuen — oder auf das, was davon übrig ist.` })
    }
  },
  {
    id: 'torflaute', gewicht: 11,
    wenn: k => k.spiele >= 5 && k.tore / Math.max(1, k.spiele) < 0.9,
    varianten: {
      serioes: k => ({ titel: `Offensivprobleme: nur ${k.tore} Treffer in ${k.spiele} Spielen`, text: `Die Chancenverwertung bleibt das Hauptproblem. Im Ligavergleich ist das die schwächste Ausbeute im vorderen Tabellendrittel.` }),
      boulevard: k => ({ titel: `WO SIND DIE TORE?`, text: `${k.tore} Treffer in ${k.spiele} Spielen. Ein Stürmer, der nicht trifft, ist wie ein Bäcker ohne Mehl. Nur teurer.` }),
      vereinsnah: k => ({ titel: `Das Glück fehlt im Abschluss`, text: `Die Chancen sind da. Es fehlt nur noch die Kleinigkeit, die man Tor nennt.` }),
      haemisch: k => ({ titel: `Torflaute mit Ansage`, text: `${k.tore} Tore in ${k.spiele} Spielen. Der Rasenmäher hat mehr Kontakt zum Strafraum gehabt als der Angriff.` })
    }
  },
  {
    id: 'abwehr', gewicht: 10,
    wenn: k => k.spiele >= 5 && k.gegentore / Math.max(1, k.spiele) > 1.9,
    varianten: {
      serioes: k => ({ titel: `${k.gegentore} Gegentore — die Defensive bleibt Baustelle`, text: `Zu große Abstände zwischen den Ketten, zu wenig Zugriff im Zentrum. Daran wird auch das beste Sturmduo nichts ändern.` }),
      boulevard: k => ({ titel: `SCHEUNENTOR! ${k.gegentore} GEGENTREFFER`, text: `Wer hinten so verteidigt, muss vorne dreimal treffen. Tut die Mannschaft aber nicht.` }),
      vereinsnah: k => ({ titel: `Die Abwehr braucht Zeit`, text: `Eine neu zusammengestellte Kette findet nicht in vier Wochen zueinander. Geduld, bitte.` }),
      haemisch: k => ({ titel: `Gastfreundlichste Abwehr der Liga`, text: `${k.gegentore} Gegentore. Man kommt hier gern zu Besuch und geht selten mit leeren Händen.` })
    }
  },
  {
    id: 'krise_vorstand', gewicht: 15,
    wenn: k => k.board && k.board.warnungen >= 1,
    varianten: {
      serioes: k => ({ titel: `Vorstand erhöht den Druck auf ${k.trainer}`, text: `Nach der jüngsten Entwicklung wurde intern über die sportliche Leitung gesprochen. Eine Bestandsgarantie gab es nicht.` }),
      boulevard: k => ({ titel: `WACKELT DER TRAINERSTUHL?`, text: `Unsere Informationen sind eindeutig: In der Chefetage wird bereits über Alternativen gesprochen. Namen nennen wir morgen.` }),
      vereinsnah: k => ({ titel: `Diskussion um die sportliche Führung`, text: `Der Verein hat in der Vergangenheit oft von Kontinuität profitiert. Man sollte das nicht leichtfertig aufgeben.` }),
      haemisch: k => ({ titel: `Rückendeckung — das gefährlichste Wort im Fußball`, text: `Der Vorstand stellt sich hinter den Trainer. Erfahrungsgemäß ist das der vorletzte Schritt.` })
    }
  },
  {
    id: 'fanprotest', gewicht: 12,
    wenn: k => (k.fans.protest || 0) > 35 || (k.fans.mood || 60) < 32,
    varianten: {
      serioes: k => ({ titel: `Protest auf den Rängen`, text: `Spruchbänder in der Kurve, Pfiffe nach Abpfiff. Die Fanszene fordert ein klares Bekenntnis der Verantwortlichen.` }),
      boulevard: k => ({ titel: `ULTRAS MACHEN MOBIL`, text: `„Uns reicht's" stand auf dem Banner. Kürzer kann man eine Saisonbilanz nicht formulieren.` }),
      vereinsnah: k => ({ titel: `Sorgen in der Kurve`, text: `Die aktive Fanszene sucht das Gespräch mit der Führung. Man kennt sich hier — das hilft.` }),
      haemisch: k => ({ titel: `Die Kurve dichtet wieder`, text: `Die Verse sind nicht druckreif, die Botschaft ist es dafür umso mehr.` })
    }
  },
  {
    id: 'jubilaeum', gewicht: 7,
    wenn: k => !!k.jubilar,
    varianten: {
      serioes: k => ({ titel: `${k.jubilar.name}: ${k.jubilar.zahl} Pflichtspiele`, text: `Eine Zahl, die in dieser Branche Seltenheitswert hat. Der Verein plant eine Ehrung vor dem nächsten Heimspiel.` }),
      boulevard: k => ({ titel: `${k.jubilar.zahl}! UNSER MANN FÜR ALLE FÄLLE`, text: `${k.jubilar.name} hat mehr Spiele bestritten als mancher Kollege Trainingsanzüge besitzt.` }),
      vereinsnah: k => ({ titel: `Ein Jubiläum, das der Verein feiert`, text: `${k.jubilar.zahl} Einsätze von ${k.jubilar.name}. Solche Spieler werden hier nicht vergessen.` }),
      haemisch: k => ({ titel: `${k.jubilar.zahl} Spiele — und kein bisschen schneller`, text: `Respekt ist trotzdem angebracht. Sagen wir ungern, aber es stimmt.` })
    }
  },
  {
    id: 'aufsteiger_traum', gewicht: 8,
    wenn: k => k.platz <= 3 && k.spiele >= 8 && k.ziel && k.ziel.platz >= 8,
    varianten: {
      serioes: k => ({ titel: `${k.name} überrascht die Liga`, text: `Platz ${k.platz} nach ${k.spiele} Spieltagen — deutlich über den Erwartungen. Fachleute streiten, ob das trägt.` }),
      boulevard: k => ({ titel: `WAHNSINN! WER STOPPT DIESEN KLUB?`, text: `Platz ${k.platz}! Und der Trainer sagt allen Ernstes, man rede über nichts anderes als Klassenerhalt.` }),
      vereinsnah: k => ({ titel: `Man darf ruhig einmal träumen`, text: `Platz ${k.platz}. Die Vernunft sagt: bleib ruhig. Das Herz sagt etwas anderes.` }),
      haemisch: k => ({ titel: `Höhenluft für Anfänger`, text: `Platz ${k.platz}. Es gibt Vereine, die das schon nach drei Wochen nicht mehr ausgehalten haben.` })
    }
  },
  {
    id: 'abstiegskampf', gewicht: 14,
    wenn: k => k.qual === 'abstieg' || k.qual === 'relegation',
    varianten: {
      serioes: k => ({ titel: `${k.name} auf einem Abstiegsplatz`, text: `Platz ${k.platz} nach ${k.spiele} Spielen. Der Restspielplan verspricht keine Erleichterung.` }),
      boulevard: k => ({ titel: `ABSTIEGSANGST!`, text: `Platz ${k.platz}. In der Geschäftsstelle rechnet man längst mit dem Taschenrechner statt mit dem Herzen.` }),
      vereinsnah: k => ({ titel: `Jetzt zusammenstehen`, text: `Platz ${k.platz} ist kein Beinbruch, wenn alle mitziehen. Aber alle heißt alle.` }),
      haemisch: k => ({ titel: `Willkommen im Tabellenkeller`, text: `Die Beleuchtung ist schlecht, die Gesellschaft auch. Man gewöhnt sich dran.` })
    }
  },
  {
    id: 'pokal_aus', gewicht: 13,
    wenn: k => k.pokalAus,
    varianten: {
      serioes: k => ({ titel: `Pokal-Aus für ${k.name}`, text: `Das frühe Ausscheiden kostet Einnahmen und eine realistische Titelchance. Der sportliche Leiter sprach von einem „bitteren Abend".` }),
      boulevard: k => ({ titel: `POKAL-BLAMAGE!`, text: `Rausgeflogen. Der Bus stand schon eine Stunde nach Abpfiff bereit — gesprochen hat trotzdem niemand.` }),
      vereinsnah: k => ({ titel: `Der Pokal bleibt ein Traum`, text: `Schade um die Chance. Berlin wäre schön gewesen.` }),
      haemisch: k => ({ titel: `Berlin fällt aus`, text: `Wieder einmal. Der Reisebus wird umgebucht — Ziel: Trainingsplatz.` })
    }
  },
  {
    id: 'transfer', gewicht: 12,
    wenn: k => !!k.letzterTransfer,
    varianten: {
      serioes: k => ({ titel: `${k.name} verpflichtet ${k.letzterTransfer.name}`, text: `Der Wechsel ist perfekt. Über die Ablöse wurde Stillschweigen vereinbart — Insider sprechen von ${formatMoney(k.letzterTransfer.betrag || 0)}.` }),
      boulevard: k => ({ titel: `ER KOMMT! ${k.letzterTransfer.name.toUpperCase()}`, text: `Medizincheck bestanden, Foto gemacht, Schal hochgehalten. Jetzt muss er nur noch spielen.` }),
      vereinsnah: k => ({ titel: `Neuzugang vorgestellt`, text: `${k.letzterTransfer.name} trägt künftig unser Trikot. Willkommen — und viel Erfolg.` }),
      haemisch: k => ({ titel: `Neuer Mann, altes Problem?`, text: `${k.letzterTransfer.name} soll es richten. Das haben vor ihm schon einige sollen.` })
    }
  },
  {
    id: 'zuschauer', gewicht: 6,
    wenn: k => k.auslastung > 0 && k.auslastung < 62,
    varianten: {
      serioes: k => ({ titel: `Zuschauerschwund: nur ${Math.round(k.auslastung)} % Auslastung`, text: `Die Ränge bleiben leerer als geplant. Der Verein prüft die Preisstruktur.` }),
      boulevard: k => ({ titel: `LEERE RÄNGE — KEINER WILL DAS SEHEN`, text: `${Math.round(k.auslastung)} Prozent. Selbst die Ordner wirkten unterbeschäftigt.` }),
      vereinsnah: k => ({ titel: `Bitte kommt wieder`, text: `${Math.round(k.auslastung)} Prozent Auslastung. Dieses Stadion lebt von euch, nicht vom Fernsehen.` }),
      haemisch: k => ({ titel: `Viel Platz für alle`, text: `Bei ${Math.round(k.auslastung)} Prozent Auslastung findet man endlich wieder einen guten Sitzplatz.` })
    }
  },
  {
    id: 'finanzen', gewicht: 7,
    wenn: k => (k.club.finances && (k.club.finances.balance || 0) < 0),
    varianten: {
      serioes: k => ({ titel: `Finanzielle Schieflage bei ${k.name}`, text: `Das Konto ist im Minus (${formatMoney(k.club.finances.balance)}). Der Verein verweist auf laufende Gespräche mit der Bank.` }),
      boulevard: k => ({ titel: `MINUS! WER ZAHLT DIE GEHÄLTER?`, text: `${formatMoney(k.club.finances.balance)} stehen unter dem Strich. Der Schatzmeister war für uns nicht zu sprechen.` }),
      vereinsnah: k => ({ titel: `Sparkurs unvermeidlich`, text: `Die Zahlen zwingen zur Zurückhaltung. Der Verein hat schon anderes überstanden.` }),
      haemisch: k => ({ titel: `Rote Zahlen, rote Köpfe`, text: `Man erklärt uns, das sei „strukturell bedingt". Klingt gut. Ändert nichts.` })
    }
  }
];

function schlagzeilenKontext(state, clubId) {
  const club = state.clubs[clubId];
  const lage = lageVon(state, clubId);
  const letzte = letzteSpiele(state, clubId, 6);
  const letztes = letzte[letzte.length - 1] || null;
  const b = club.board || {};
  let siegSerie = 0, pleitenSerie = 0;
  for (let i = letzte.length - 1; i >= 0; i--) {
    if (letzte[i].ergebnis === 'S') { if (pleitenSerie) break; siegSerie++; }
    else if (letzte[i].ergebnis === 'N') { if (siegSerie) break; pleitenSerie++; }
    else break;
  }
  const st = club.stadiumState || {};
  const verletzte = kader(state, clubId).filter(p => p.injury).length;

  // Jubiläum: 50/100/150/200/250/300 Pflichtspiele
  let jubilar = null;
  for (const p of kader(state, clubId)) {
    const c = (p.stats && p.stats.career && p.stats.career.spiele) || 0;
    if (c > 0 && c % 50 === 0) { jubilar = { name: p.shortName || p.lastName, zahl: c }; break; }
  }

  const transfers = (state.history && state.history.transfers) || [];
  const jung = transfers.filter(t => t && t.season === state.date.season &&
    (t.zuId === clubId || t.toClubId === clubId) &&
    Math.abs((t.day !== undefined ? t.day : t.tag) - state.date.day) <= 3);
  const lt = jung[jung.length - 1];
  const letzterTransfer = lt ? {
    name: (lt.spielerName || lt.name || (state.players[lt.playerId] && state.players[lt.playerId].shortName) || 'der Neue'),
    betrag: lt.betrag || lt.ablose || lt.fee || 0
  } : null;

  const pokalSpiele = (state.fixtures || []).filter(f => f.competitionId === 'pokal' &&
    f.season === state.date.season && (f.homeId === clubId || f.awayId === clubId) && f.played);
  const letzterPokal = pokalSpiele.sort((a, b2) => b2.dayIndex - a.dayIndex)[0];
  let pokalAus = false;
  if (letzterPokal && !letzterPokal.freilos && state.date.day - letzterPokal.dayIndex <= 3) {
    const t = toreAus(letzterPokal);
    if (t) {
      const eigen = letzterPokal.homeId === clubId ? t[0] : t[1];
      const fremd = letzterPokal.homeId === clubId ? t[1] : t[0];
      pokalAus = eigen < fremd;
    }
  }

  return {
    state, club, name: club.shortName || club.name, voll: club.name,
    trainer: istManagerClub(state, clubId) ? state.manager.name : (club.manager || 'dem Trainer'),
    tag: state.date.day, platz: lage.platz, spiele: lage.spiele, tore: lage.tore,
    gegentore: lage.gegentore, lage, letzte, letztes, siegSerie, pleitenSerie,
    board: b, ziel: b.saisonziel || b.erwartung || null, fans: club.fans || {},
    qual: qualificationFor(lage.ligaId, lage.platz),
    naechstes: naechstesSpiel(state, clubId),
    auslastung: st.auslastungSchnitt || 0,
    englischeWoche: englischeWoche(state, clubId),
    verletzte, jubilar, letzterTransfer, pokalAus
  };
}

function blattFuer(anlassId, rng, stil) {
  const passend = BLAETTER.filter(b => b.stil === stil);
  return rng.pick(passend.length ? passend : BLAETTER);
}

/**
 * Erzeugt Schlagzeilen zum aktuellen Zustand.
 * @returns {Array<{blatt:string, blattId:string, titel:string, text:string, tonfall:string, betrifft:string}>}
 */
export function schlagzeilen(state, ctx, anzahl = 3) {
  const clubId = state.managerClubId;
  const club = state.clubs[clubId];
  if (!club) return [];
  const rng = (ctx && ctx.rng) ? ctx.rng.fork('schlagzeilen') : rngFuer(state, 'schlagzeilen');
  const k = schlagzeilenKontext(state, clubId);

  const moeglich = ANLAESSE.filter(a => { try { return a.wenn(k); } catch (e) { return false; } });
  if (!moeglich.length) return [];

  const out = [];
  const benutzt = new Set();
  for (let i = 0; i < anzahl; i++) {
    const rest = moeglich.filter(a => !benutzt.has(a.id));
    if (!rest.length) break;
    const anlass = rng.pickWeighted(rest, a => a.gewicht);
    benutzt.add(anlass.id);

    // Stil wählen: bei Krisen greifen Boulevard und Häme häufiger zu
    const krise = k.pleitenSerie >= 2 || k.qual === 'abstieg' || (k.board.warnungen || 0) >= 1;
    const stile = krise
      ? ['boulevard', 'boulevard', 'haemisch', 'serioes', 'vereinsnah']
      : ['serioes', 'serioes', 'boulevard', 'vereinsnah', 'haemisch'];
    let stil = rng.pick(stile);
    if (!anlass.varianten[stil]) stil = Object.keys(anlass.varianten)[0];
    const blatt = blattFuer(anlass.id, rng, stil);
    const v = anlass.varianten[stil](k);
    out.push({
      id: uid('news', rng),
      blatt: blatt.name, blattId: blatt.id, kuerzel: blatt.kuerzel,
      titel: v.titel, text: v.text, tonfall: blatt.tonfall,
      stil, betrifft: anlass.id, schaerfe: blatt.schaerfe,
      tag: state.date.day, season: state.date.season
    });
  }
  return out;
}

/* ================================================================== *
 *  MEDIENDRUCK
 * ================================================================== */

/**
 * Mediendruck 0..100. Beeinflusst die Geduld des Vorstands (board.js liest
 * state.presse.druck) und die Schärfe der Berichterstattung.
 */
export function medienDruck(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return 50;
  const k = schlagzeilenKontext(state, clubId);
  const b = club.board || {};
  const ziel = b.saisonziel || b.erwartung || { platz: 10 };

  let druck = DRUCK_BASIS;
  druck += clamp(k.pleitenSerie / 5, 0, 1) * DRUCK_GEWICHT_SERIE;
  druck -= clamp(k.siegSerie / 5, 0, 1) * DRUCK_GEWICHT_SERIE * 0.7;
  const abstand = k.lage.spiele > 0 ? (k.platz - ziel.platz) : 0;
  druck += clamp(abstand / 8, -1, 1) * DRUCK_GEWICHT_ZIEL;
  druck += clamp((55 - (club.fans.mood || 60)) / 40, -1, 1) * DRUCK_GEWICHT_FANS;
  druck += clamp((55 - (b.zufriedenheit === undefined ? 60 : b.zufriedenheit)) / 40, -1, 1) * DRUCK_GEWICHT_VORSTAND;
  druck += clamp(((club.reputation || 50) - 55) / 45, -1, 1) * DRUCK_GEWICHT_REPUTATION;

  const p = state.presse;
  if (p) {
    const offene = (p.ankuendigungen || []).filter(a =>
      a.season === state.date.season && a.bisTag >= state.date.day);
    druck += offene.length * 5;
    druck += clamp((50 - p.glaubwuerdigkeit) / 10, -5, 8);
  }
  return clamp(Math.round(druck), 0, 100);
}

/* ================================================================== *
 *  PRESSEKONFERENZ — Fragenkatalog
 * ================================================================== */

/** Kurzschreibweise für eine Antwortmöglichkeit. */
function A(text, w, risiko = 0) {
  return {
    text,
    wirkung: {
      moral: w.m || 0, fans: w.f || 0, vorstand: w.v || 0, medien: w.me || 0,
      spieler: w.sp || 0, ankuendigung: !!w.ank, ziel: w.spielerRolle || null
    },
    risiko
  };
}

/**
 * Der Fragenkatalog. 44 Typen, jeder mit drei bis vier echten Abwägungen.
 *  m  = Mannschaftsmoral, f = Fans, v = Vorstand, me = Mediengunst (senkt Druck),
 *  sp = Moral des betroffenen Spielers, ank = großspurige Ankündigung.
 */
export const FRAGEN_KATALOG = [
  {
    id: 'niederlagenserie', kat: 'krise', gewicht: 20,
    wenn: k => k.pleitenSerie >= 2,
    frage: k => `Herr ${k.trainerNachname}, ${k.pleitenSerie} Niederlagen in Serie. Was läuft schief?`,
    kontext: k => `Letzte Ergebnisse: ${k.formText}`,
    antworten: () => [
      A('„Die Verantwortung trage ich. Punkt."', { m: 4, f: 3, v: -3, me: 4 }, 0.1),
      A('„Wir haben individuelle Fehler gemacht, die auf diesem Niveau bestraft werden."', { m: -3, f: 0, v: 2, me: 1 }, 0.15),
      A('„Ehrlich? Die Einstellung einiger Spieler war nicht bundesligatauglich."', { m: -7, f: 2, v: 3, me: 3 }, 0.35),
      A('„Ab nächster Woche gewinnen wir wieder. Verlassen Sie sich drauf."', { m: 3, f: 5, v: 1, me: 2, ank: true }, 0.4)
    ]
  },
  {
    id: 'torwartdiskussion', kat: 'personal', gewicht: 14,
    wenn: k => !!k.torwart,
    frage: k => `${k.torwart.name} sah zuletzt nicht gut aus. Bleibt er die Nummer eins?`,
    kontext: k => `${k.torwart.name}, ${k.torwart.age} Jahre, Notenschnitt ${k.torwart.note || '—'}`,
    antworten: k => [
      A('„Er ist unsere Nummer eins. Ohne Diskussion."', { m: 2, f: 0, v: -1, me: 0, sp: 8, spielerRolle: 'torwart' }, 0.1),
      A('„Jede Position wird jede Woche neu vergeben. Auch die im Tor."', { m: 2, f: 2, v: 2, me: 1, sp: -6, spielerRolle: 'torwart' }, 0.15),
      A('„Zwei Gegentore, die keiner halten muss. Das war zu wenig."', { m: -2, f: 3, v: 3, me: 3, sp: -12, spielerRolle: 'torwart' }, 0.3),
      A('„Ich bespreche Personal nicht auf Pressekonferenzen."', { m: 1, f: -2, v: 0, me: -4 }, 0.05)
    ]
  },
  {
    id: 'transfergeruecht_abgang', kat: 'transfer', gewicht: 14,
    wenn: k => !!k.star,
    frage: k => `Es heißt, ein Spitzenklub habe für ${k.star.name} angefragt. Ist da etwas dran?`,
    kontext: k => `Marktwert ${formatMoney(k.star.value)}, Vertrag bis Saison ${k.star.until}`,
    antworten: k => [
      A('„Er hat einen Vertrag. Damit ist alles gesagt."', { m: 2, f: 4, v: 1, me: 0, sp: 4, spielerRolle: 'star' }, 0.1),
      A('„Bei einem entsprechenden Angebot muss jeder Verein nachdenken."', { m: -2, f: -5, v: 4, me: 2, sp: -3, spielerRolle: 'star' }, 0.2),
      A('„Unverkäuflich. Für keine Summe der Welt."', { m: 3, f: 7, v: -5, me: 3, sp: 6, spielerRolle: 'star', ank: true }, 0.3),
      A('„Dazu sage ich nichts."', { m: 0, f: -1, v: 0, me: -3 }, 0.05)
    ]
  },
  {
    id: 'transfergeruecht_zugang', kat: 'transfer', gewicht: 11,
    wenn: k => k.transferfenster,
    frage: () => 'Kommt noch ein Spieler? Die Fans warten auf ein Zeichen.',
    kontext: k => `Transferbudget: ${formatMoney(k.budget)}`,
    antworten: () => [
      A('„Wir sind an mehreren Spielern dran. Mehr sage ich nicht."', { m: 1, f: 3, v: 0, me: 2 }, 0.1),
      A('„Dieser Kader kann die Ziele erreichen. So, wie er ist."', { m: 4, f: -3, v: 5, me: 0 }, 0.15),
      A('„Es wird noch ein Transfer kommen, der alle überrascht."', { m: 2, f: 7, v: -3, me: 4, ank: true }, 0.45)
    ]
  },
  {
    id: 'spielerkritik', kat: 'personal', gewicht: 13,
    wenn: k => !!k.schwaechster,
    frage: k => `${k.schwaechster.name} enttäuscht seit Wochen. Wie lange geben Sie ihm noch?`,
    kontext: k => `Notenschnitt ${k.schwaechster.note || '—'} bei ${k.schwaechster.spiele} Einsätzen`,
    antworten: k => [
      A('„Er braucht Rückendeckung, keine Schlagzeilen. Er bekommt sie von mir."', { m: 3, f: -2, v: -2, me: 0, sp: 10, spielerRolle: 'schwaechster' }, 0.1),
      A('„Er weiß selbst, dass das zu wenig war. Wir haben deutlich gesprochen."', { m: 0, f: 2, v: 2, me: 2, sp: -5, spielerRolle: 'schwaechster' }, 0.2),
      A('„Wenn er so weitermacht, sitzt er am Samstag draußen."', { m: -3, f: 4, v: 3, me: 4, sp: -13, spielerRolle: 'schwaechster' }, 0.35)
    ]
  },
  {
    id: 'vorstandsdruck', kat: 'vorstand', gewicht: 16,
    wenn: k => (k.board.warnungen || 0) >= 1 || (k.board.zufriedenheit || 60) < 40,
    frage: () => 'Der Aufsichtsrat hat Ihnen nur „vorläufig" das Vertrauen ausgesprochen. Wie sicher fühlen Sie sich?',
    kontext: k => `Vorstandszufriedenheit: ${Math.round(k.board.zufriedenheit || 0)} von 100`,
    antworten: () => [
      A('„Ich mache meine Arbeit. Über meinen Stuhl entscheiden andere."', { m: 1, f: 1, v: 1, me: 2 }, 0.05),
      A('„Ich habe volles Vertrauen in die Führung — und sie in mich."', { m: 1, f: 0, v: 4, me: 0 }, 0.15),
      A('„Wer meint, ein anderer macht es besser, soll es sagen."', { m: 2, f: 4, v: -8, me: 5 }, 0.4),
      A('„Der Verein steht über allem. Auch über mir."', { m: 3, f: 5, v: 3, me: 1 }, 0.1)
    ]
  },
  {
    id: 'derby', kat: 'spiel', gewicht: 18,
    wenn: k => k.derby,
    frage: k => `Am Wochenende das Derby gegen ${k.gegnerName}. Was bedeutet Ihnen dieses Spiel?`,
    kontext: () => 'Ausverkauftes Haus, geteilte Stadt, alte Rechnungen.',
    antworten: k => [
      A('„Drei Punkte wie in jedem anderen Spiel auch."', { m: 0, f: -6, v: 2, me: -2 }, 0.1),
      A('„Für die Stadt ist das mehr als ein Spiel. Wir wissen, was auf dem Spiel steht."', { m: 4, f: 8, v: 1, me: 3 }, 0.1),
      A(`„${k.gegnerName} fährt am Sonntag ohne Punkte nach Hause. Versprochen."`, { m: 3, f: 9, v: -2, me: 5, ank: true }, 0.45)
    ]
  },
  {
    id: 'fanproteste', kat: 'fans', gewicht: 14,
    wenn: k => (k.fans.protest || 0) > 25 || (k.fans.mood || 60) < 38,
    frage: () => 'In der Kurve hingen Spruchbänder gegen die Vereinsführung. Verstehen Sie den Protest?',
    kontext: k => `Fanstimmung: ${Math.round(k.fans.mood || 0)} von 100`,
    antworten: () => [
      A('„Absolut. Die Fans haben ein Recht auf ihre Meinung — und auf bessere Leistungen."', { m: 1, f: 8, v: -4, me: 3 }, 0.1),
      A('„Pfiffe gehören dazu. Die Antwort geben wir auf dem Platz."', { m: 2, f: 2, v: 2, me: 1 }, 0.1),
      A('„Solche Banner helfen der Mannschaft überhaupt nicht."', { m: 1, f: -8, v: 3, me: -1 }, 0.25)
    ]
  },
  {
    id: 'schiedsrichter', kat: 'spiel', gewicht: 12,
    wenn: k => !!k.letztes && k.letztes.ergebnis !== 'S',
    frage: () => 'Die strittige Szene vor dem Gegentor — war das ein Foul?',
    kontext: () => 'Die Fernsehbilder sind nicht eindeutig. Die Zeitlupe auch nicht.',
    antworten: () => [
      A('„Der Schiedsrichter hat viele Entscheidungen zu treffen. Das war eine davon."', { m: 1, f: 0, v: 1, me: 3 }, 0.05),
      A('„Das war ein klarer Fehlentscheid. Punkt."', { m: 4, f: 5, v: -2, me: -6 }, 0.35),
      A('„Wir haben das Spiel selbst verloren, nicht der Unparteiische."', { m: -2, f: 1, v: 4, me: 4 }, 0.1)
    ]
  },
  {
    id: 'eigenlob', kat: 'sonstiges', gewicht: 9,
    wenn: k => k.siegSerie >= 2,
    frage: k => `${k.siegSerie} Siege in Folge. Ist das Ihr Verdienst?`,
    kontext: () => 'Die Frage klingt nach Falle. Sie ist auch eine.',
    antworten: () => [
      A('„Das ist der Verdienst der Mannschaft. Ich stelle nur auf."', { m: 6, f: 3, v: 2, me: 2 }, 0.05),
      A('„Wir haben im Trainerteam sehr viel richtig gemacht, ja."', { m: -3, f: 0, v: 1, me: 1 }, 0.2),
      A('„Fragen Sie mich das am Saisonende noch mal."', { m: 1, f: 1, v: 2, me: 3 }, 0.05)
    ]
  },
  {
    id: 'verletzungssorgen', kat: 'personal', gewicht: 12,
    wenn: k => k.verletzte >= 2,
    frage: k => `${k.verletzte} Ausfälle. Ist der Kader zu dünn?`,
    kontext: k => `Aktuell verletzt: ${k.verletzteNamen}`,
    antworten: () => [
      A('„Jeder, der spielt, ist gut genug. Ausreden gibt es keine."', { m: 3, f: 3, v: 3, me: 1 }, 0.1),
      A('„Wir haben im Sommer davor gewarnt. Jetzt sehen Sie das Ergebnis."', { m: 0, f: 1, v: -6, me: 3 }, 0.25),
      A('„Das ist eine Chance für die Jungen aus der eigenen Jugend."', { m: 2, f: 4, v: 4, me: 2 }, 0.1)
    ]
  },
  {
    id: 'jugenddebut', kat: 'jugend', gewicht: 10,
    wenn: k => !!k.talent,
    frage: k => `${k.talent.name} ist erst ${k.talent.age}. Ist er schon so weit?`,
    kontext: k => `Potenzial: ${k.talent.potential}, bisher ${k.talent.spiele} Einsätze`,
    antworten: k => [
      A('„Er trainiert wie ein Profi. Alter ist für mich keine Kategorie."', { m: 2, f: 4, v: 3, me: 2, sp: 9, spielerRolle: 'talent' }, 0.1),
      A('„Wir lassen ihn in Ruhe wachsen. Bitte schreiben Sie ihn nicht groß."', { m: 1, f: 0, v: 2, me: -1, sp: 3, spielerRolle: 'talent' }, 0.05),
      A('„Der Junge wird in zwei Jahren Nationalspieler sein."', { m: 1, f: 6, v: 0, me: 4, sp: -2, spielerRolle: 'talent', ank: true }, 0.4)
    ]
  },
  {
    id: 'gehaltsdebatte', kat: 'wirtschaft', gewicht: 10,
    wenn: k => k.gehaltsquote > 0.5,
    frage: () => 'Die Gehälter im Profifußball explodieren. Verdienen Ihre Spieler zu viel?',
    kontext: k => `Gehaltslast: ${formatMoney(k.gehaltssumme)} im Jahr`,
    antworten: () => [
      A('„Der Markt macht die Preise, nicht wir."', { m: 1, f: -1, v: 1, me: 0 }, 0.05),
      A('„Wir zahlen, was leistbar ist. Keinen Cent mehr."', { m: -2, f: 5, v: 5, me: 2 }, 0.15),
      A('„Manch einer bei uns verdient mehr, als er auf dem Platz zurückzahlt."', { m: -8, f: 6, v: 4, me: 5 }, 0.4)
    ]
  },
  {
    id: 'trainerentlassung_gegner', kat: 'liga', gewicht: 9,
    wenn: k => !!k.gegnerName,
    frage: k => `Bei ${k.gegnerName} wurde der Trainer entlassen. Wie bewerten Sie das?`,
    kontext: () => 'Trainerentlassungen sind in dieser Liga ein Saisonzyklus.',
    antworten: () => [
      A('„Das tut mir für den Kollegen leid. Wir kennen alle die Spielregeln."', { m: 2, f: 2, v: 0, me: 3 }, 0.05),
      A('„Der Trainerwechsel-Effekt ist ein Mythos. Wir bereiten uns normal vor."', { m: 1, f: 0, v: 1, me: 2 }, 0.1),
      A('„Vielleicht sollte man dort mal die Kaderplanung hinterfragen."', { m: 0, f: 2, v: -1, me: 1 }, 0.25)
    ]
  },
  {
    id: 'ruecktrittsgeruecht', kat: 'krise', gewicht: 15,
    wenn: k => (k.board.warnungen || 0) >= 2 || k.druck > 72,
    frage: () => 'Denken Sie über einen Rücktritt nach?',
    kontext: () => 'Der Kollege vom Boulevard hat die Frage schon dreimal gestellt.',
    antworten: () => [
      A('„Nein. Ich laufe nicht weg."', { m: 4, f: 5, v: 2, me: 2 }, 0.1),
      A('„Ich habe einen Vertrag und einen Auftrag. Beides erfülle ich."', { m: 2, f: 1, v: 3, me: 1 }, 0.05),
      A('„Wenn der Verein einen anderen Weg will, stehe ich dem nicht im Weg."', { m: -5, f: -3, v: -4, me: 4 }, 0.3)
    ]
  },
  {
    id: 'tabellenfuehrung', kat: 'spiel', gewicht: 12,
    wenn: k => k.platz === 1 && k.spiele >= 5,
    frage: () => 'Tabellenführung. Reden wir jetzt über den Titel?',
    kontext: k => `${k.punkte} Punkte nach ${k.spiele} Spielen.`,
    antworten: () => [
      A('„Wir reden über das nächste Spiel. Sonst nichts."', { m: 3, f: 0, v: 3, me: 0 }, 0.05),
      A('„Wer oben steht, darf auch träumen. Die Fans dürfen es sowieso."', { m: 2, f: 7, v: 0, me: 3 }, 0.15),
      A('„Wir holen den Titel. So einfach ist das."', { m: 4, f: 9, v: -2, me: 5, ank: true }, 0.5)
    ]
  },
  {
    id: 'abstiegsangst', kat: 'krise', gewicht: 16,
    wenn: k => k.qual === 'abstieg' || k.qual === 'relegation',
    frage: k => `Platz ${k.platz}. Müssen die Fans sich auf den Abstieg einstellen?`,
    kontext: k => `${k.punkte} Punkte, ${k.spiele} Spiele, Tordifferenz ${k.lage.diff >= 0 ? '+' : ''}${k.lage.diff}`,
    antworten: () => [
      A('„Wir bleiben drin. Ich weiß, was diese Mannschaft kann."', { m: 5, f: 6, v: 1, me: 2, ank: true }, 0.35),
      A('„Die Tabelle lügt nicht. Wir stecken im Abstiegskampf, und wir nehmen ihn an."', { m: 3, f: 4, v: 4, me: 4 }, 0.1),
      A('„Mit diesem Kader wäre alles andere als der Abstieg ein Wunder."', { m: -9, f: -6, v: -8, me: 5 }, 0.3)
    ]
  },
  {
    id: 'pokal_vorschau', kat: 'pokal', gewicht: 11,
    wenn: k => k.naechstes && k.naechstes.wettbewerb === 'pokal',
    frage: k => `Pokal gegen ${k.gegnerName}. Volle Kapelle oder Rotation?`,
    kontext: () => 'Der Pokal hat bekanntlich eigene Gesetze — meistens gegen die Favoriten.',
    antworten: () => [
      A('„Wir spielen mit der besten Elf. Der Pokal ist eine Chance auf einen Titel."', { m: 3, f: 6, v: 3, me: 2 }, 0.15),
      A('„Die Liga hat Priorität. Einige bekommen eine Pause."', { m: -2, f: -4, v: 2, me: 0 }, 0.2),
      A('„Wir fahren nach Berlin. Alles andere wäre keine Zielsetzung."', { m: 3, f: 7, v: -1, me: 4, ank: true }, 0.5)
    ]
  },
  {
    id: 'pokal_blamage', kat: 'pokal', gewicht: 14,
    wenn: k => k.pokalAus,
    frage: () => 'Ausgeschieden gegen einen Unterklassigen. Wie erklären Sie das den Fans?',
    kontext: () => 'Der Bus stand lange im Parkverbot. Gesprochen hat trotzdem niemand.',
    antworten: () => [
      A('„Gar nicht. Das war beschämend, und dafür entschuldige ich mich."', { m: -2, f: 6, v: 2, me: 5 }, 0.1),
      A('„Der Platz war eine Katastrophe, die Bedingungen ebenso."', { m: 2, f: -6, v: -3, me: -5 }, 0.35),
      A('„Wir haben die Aufgabe unterschätzt. Das darf uns nicht passieren."', { m: -3, f: 3, v: 3, me: 3 }, 0.1)
    ]
  },
  {
    id: 'europapokal', kat: 'europa', gewicht: 10,
    wenn: k => k.europa,
    frage: () => 'Donnerstagabend Europa, sonntags Liga. Wird die Doppelbelastung zum Problem?',
    kontext: () => 'Der Terminkalender kennt keine Gnade.',
    antworten: () => [
      A('„Dafür haben wir einen breiten Kader. Genau dafür."', { m: 3, f: 3, v: 2, me: 1 }, 0.1),
      A('„Europa ist ein Bonus. Die Liga ernährt uns."', { m: 0, f: -3, v: 5, me: 1 }, 0.15),
      A('„Wir wollen in beiden Wettbewerben so weit kommen wie möglich."', { m: 2, f: 5, v: 0, me: 2, ank: true }, 0.3)
    ]
  },
  {
    id: 'torflaute', kat: 'spiel', gewicht: 11,
    wenn: k => k.spiele >= 4 && k.tore / Math.max(1, k.spiele) < 1.0,
    frage: k => `Nur ${k.tore} Tore in ${k.spiele} Spielen. Fehlt ein echter Stürmer?`,
    kontext: () => 'Die Statistik ist unbarmherzig und liegt auf jedem Redaktionstisch.',
    antworten: () => [
      A('„Wir erspielen uns genug. Es fehlt die Kaltschnäuzigkeit."', { m: 0, f: 0, v: 1, me: 2 }, 0.1),
      A('„Ja. Und das habe ich im Sommer auch so gesagt."', { m: 1, f: 4, v: -7, me: 4 }, 0.3),
      A('„Tore sind Kopfsache. Daran arbeiten wir jeden Tag."', { m: 3, f: 1, v: 2, me: 0 }, 0.05)
    ]
  },
  {
    id: 'abwehrschwaeche', kat: 'spiel', gewicht: 10,
    wenn: k => k.spiele >= 4 && k.gegentore / Math.max(1, k.spiele) > 1.8,
    frage: k => `${k.gegentore} Gegentore. Wird bei Ihnen die Defensive vernachlässigt?`,
    kontext: () => 'Der Kollege vom Fachblatt hat eine Grafik mitgebracht.',
    antworten: () => [
      A('„Verteidigen ist Aufgabe aller elf. Das gilt auch für die Offensive."', { m: 1, f: 1, v: 2, me: 2 }, 0.1),
      A('„Wir spielen mutig nach vorn. Das hat einen Preis, den ich zu zahlen bereit bin."', { m: 3, f: 4, v: -3, me: 3 }, 0.2),
      A('„Ab sofort wird hinten dichtgemacht. Wir werden hässlicher gewinnen."', { m: -2, f: -3, v: 4, me: 1 }, 0.15)
    ]
  },
  {
    id: 'kapitaensfrage', kat: 'personal', gewicht: 9,
    wenn: k => !!k.kapitaen,
    frage: k => `Ist ${k.kapitaen.name} noch der richtige Kapitän?`,
    kontext: k => `${k.kapitaen.age} Jahre, ${k.kapitaen.spiele} Saisoneinsätze`,
    antworten: k => [
      A('„Er ist mein Kapitän. Diese Debatte führe ich nicht."', { m: 3, f: 1, v: 0, me: 0, sp: 9, spielerRolle: 'kapitaen' }, 0.05),
      A('„Die Binde muss man sich jede Woche neu verdienen."', { m: 0, f: 2, v: 2, me: 2, sp: -8, spielerRolle: 'kapitaen' }, 0.25),
      A('„Wir haben in der Kabine mehrere Führungsspieler. Das ist ein gutes Zeichen."', { m: 2, f: 1, v: 1, me: 1, sp: -2, spielerRolle: 'kapitaen' }, 0.1)
    ]
  },
  {
    id: 'rotation', kat: 'taktik', gewicht: 9,
    wenn: () => true,
    frage: () => 'Sie haben zuletzt viel rotiert. Findet die Mannschaft so einen Rhythmus?',
    kontext: () => 'Vier Wechsel in der Startelf sind vier Schlagzeilen.',
    antworten: () => [
      A('„Frische Beine gewinnen Spiele. Gewohnheit gewinnt gar nichts."', { m: 1, f: 1, v: 1, me: 2 }, 0.1),
      A('„Wer gut trainiert, spielt. So einfach ist mein System."', { m: 4, f: 2, v: 1, me: 1 }, 0.05),
      A('„Ich rotiere, weil die Leistungen dazu zwingen."', { m: -5, f: 1, v: 2, me: 2 }, 0.25)
    ]
  },
  {
    id: 'taktikkritik', kat: 'taktik', gewicht: 10,
    wenn: k => k.pleitenSerie >= 1,
    frage: () => 'Ihr System wirkt durchschaubar. Denken Sie über eine Umstellung nach?',
    kontext: k => `Aktuelles System: ${k.formation}`,
    antworten: () => [
      A('„Das System ist nicht das Problem. Die Umsetzung war es."', { m: -2, f: 0, v: 1, me: 1 }, 0.15),
      A('„Wir werden anders auftreten. Sie werden es am Samstag sehen."', { m: 2, f: 3, v: 1, me: 3 }, 0.2),
      A('„Ich bin seit zwanzig Jahren von diesem System überzeugt. Das ändert sich nicht."', { m: 1, f: -2, v: -2, me: -1 }, 0.2)
    ]
  },
  {
    id: 'altersstruktur', kat: 'kader', gewicht: 8,
    wenn: k => k.durchschnittsalter >= 28.5 || k.durchschnittsalter <= 23.5,
    frage: k => `Ihr Kaderdurchschnitt liegt bei ${k.durchschnittsalter} Jahren. Passt das zusammen?`,
    kontext: () => 'Zu alt heißt langsam, zu jung heißt naiv. Sagt man.',
    antworten: () => [
      A('„Erfahrung und Frische — die Mischung stimmt für mich."', { m: 2, f: 1, v: 2, me: 1 }, 0.05),
      A('„Wir müssen den Kader verjüngen. Das ist eine Aufgabe für mehrere Jahre."', { m: -3, f: 2, v: 3, me: 2 }, 0.15),
      A('„Alter interessiert mich nicht. Leistung schon."', { m: 2, f: 2, v: 0, me: 2 }, 0.1)
    ]
  },
  {
    id: 'ticketpreise', kat: 'wirtschaft', gewicht: 8,
    wenn: () => true,
    frage: () => 'Die Fans klagen über die Ticketpreise. Was sagen Sie denen?',
    kontext: k => `Sitzplatz aktuell: ${formatMoney(k.ticketpreis)}`,
    antworten: () => [
      A('„Ich bin Trainer, nicht Kaufmann. Aber ich verstehe den Ärger."', { m: 0, f: 6, v: -4, me: 3 }, 0.15),
      A('„Fußball auf diesem Niveau kostet Geld. Das wissen die Leute."', { m: 0, f: -6, v: 5, me: 0 }, 0.2),
      A('„Wir müssen den Preis auf dem Platz zurückzahlen. Zuletzt haben wir das nicht."', { m: -2, f: 5, v: 2, me: 4 }, 0.1)
    ]
  },
  {
    id: 'sponsoren', kat: 'wirtschaft', gewicht: 7,
    wenn: () => true,
    frage: () => 'Ein Sponsor soll unzufrieden sein. Spüren Sie wirtschaftlichen Druck?',
    kontext: () => 'Die Werbebande hat keine Meinung. Ihr Eigentümer schon.',
    antworten: () => [
      A('„Sponsoren wollen Erfolg. Damit stehen sie nicht allein."', { m: 1, f: 1, v: 2, me: 2 }, 0.05),
      A('„Über Verträge sprechen andere. Ich spreche über Fußball."', { m: 1, f: 2, v: 0, me: -1 }, 0.05),
      A('„Wer zahlt, darf auch fordern. Solange er sich nicht in die Aufstellung einmischt."', { m: 2, f: 5, v: -5, me: 5 }, 0.3)
    ]
  },
  {
    id: 'eigener_wechsel', kat: 'krise', gewicht: 9,
    wenn: k => k.jobangebote > 0,
    frage: () => 'Ihr Name fällt bei einem anderen Klub. Haben Sie mit dort gesprochen?',
    kontext: () => 'Der Reporter tippt schon, bevor Sie antworten.',
    antworten: () => [
      A('„Ich habe hier einen Vertrag und fühle mich wohl."', { m: 2, f: 4, v: 3, me: 1 }, 0.15),
      A('„Ich kommentiere Gerüchte grundsätzlich nicht."', { m: 0, f: -3, v: -2, me: -3 }, 0.2),
      A('„Jeder Trainer freut sich, wenn seine Arbeit anderswo geschätzt wird."', { m: -1, f: -5, v: -5, me: 3 }, 0.3)
    ]
  },
  {
    id: 'exverein', kat: 'sonstiges', gewicht: 7,
    wenn: k => k.exVerein,
    frage: k => `Am Wochenende geht es gegen Ihren früheren Verein ${k.gegnerName}. Besonderes Spiel?`,
    kontext: () => 'Man vergisst nie den ersten Verein. Und selten den letzten.',
    antworten: () => [
      A('„Ein Spiel wie jedes andere. Wirklich."', { m: 0, f: 0, v: 1, me: -1 }, 0.05),
      A('„Ich habe dort schöne Jahre erlebt. Gewinnen will ich trotzdem."', { m: 2, f: 4, v: 1, me: 3 }, 0.05),
      A('„Ich habe dort noch eine Rechnung offen."', { m: 3, f: 5, v: -2, me: 4, ank: true }, 0.35)
    ]
  },
  {
    id: 'jubilaeum_frage', kat: 'sonstiges', gewicht: 6,
    wenn: k => !!k.jubilar,
    frage: k => `${k.jubilar.name} bestreitet sein ${k.jubilar.zahl}. Pflichtspiel. Was bedeutet er Ihnen?`,
    kontext: () => 'Solche Zahlen gibt es in dieser Branche kaum noch.',
    antworten: () => [
      A('„Er ist das Gesicht dieses Vereins. So einer kommt nicht wieder."', { m: 4, f: 7, v: 2, me: 3 }, 0.05),
      A('„Eine tolle Zahl. Jetzt zählt trotzdem nur das Spiel."', { m: 1, f: 0, v: 1, me: 0 }, 0.05)
    ]
  },
  {
    id: 'winterbilanz', kat: 'saison', gewicht: 10,
    wenn: k => k.tag >= SAISON_TAGE.winterpause[0] && k.tag <= SAISON_TAGE.winterpause[1],
    frage: k => `Halbzeit der Saison, Platz ${k.platz}. Ihre Bilanz?`,
    kontext: k => `${k.punkte} Punkte aus ${k.spiele} Spielen`,
    antworten: () => [
      A('„Ordentlich, mehr nicht. In der Rückrunde muss deutlich mehr kommen."', { m: 1, f: 1, v: 3, me: 2 }, 0.05),
      A('„Ich bin zufrieden. Wir haben eine Entwicklung genommen."', { m: 3, f: 1, v: 1, me: 0 }, 0.15),
      A('„In der Rückrunde werden wir die beste Mannschaft der Liga sein."', { m: 3, f: 6, v: 0, me: 4, ank: true }, 0.5)
    ]
  },
  {
    id: 'transferschluss', kat: 'transfer', gewicht: 9,
    wenn: k => k.transferfenster && k.tageBisSchluss <= 7,
    frage: k => `Noch ${k.tageBisSchluss} Tage Transferfrist. Passiert noch etwas?`,
    kontext: k => `Budget: ${formatMoney(k.budget)}`,
    antworten: () => [
      A('„Wenn sich eine sinnvolle Möglichkeit ergibt, handeln wir."', { m: 1, f: 2, v: 1, me: 1 }, 0.05),
      A('„Der Kader steht. Ich bin mit dem, was ich habe, sehr zufrieden."', { m: 4, f: -2, v: 4, me: 0 }, 0.1),
      A('„Ohne Verstärkung wird es schwierig. Das habe ich intern deutlich gemacht."', { m: -2, f: 3, v: -6, me: 3 }, 0.3)
    ]
  },
  {
    id: 'karriereende', kat: 'personal', gewicht: 7,
    wenn: k => !!k.veteran,
    frage: k => `${k.veteran.name} ist ${k.veteran.age}. Wie lange geht das noch?`,
    kontext: k => `Vertrag bis Saison ${k.veteran.until}`,
    antworten: k => [
      A('„Solange er so trainiert, spielt er bei mir."', { m: 2, f: 3, v: 0, me: 1, sp: 10, spielerRolle: 'veteran' }, 0.05),
      A('„Wir werden im Frühjahr in Ruhe darüber sprechen."', { m: 0, f: 0, v: 2, me: 1, sp: -4, spielerRolle: 'veteran' }, 0.1),
      A('„Irgendwann fordert das Alter seinen Tribut. Bei ihm ist es so weit."', { m: -3, f: -5, v: 3, me: 3, sp: -14, spielerRolle: 'veteran' }, 0.35)
    ]
  },
  {
    id: 'nationalspieler', kat: 'personal', gewicht: 7,
    wenn: k => !!k.star,
    frage: k => `${k.star.name} wurde für die Nationalmannschaft nominiert. Freut Sie das?`,
    kontext: () => 'Länderspielreisen sind Ehre und Risiko zugleich.',
    antworten: k => [
      A('„Eine Auszeichnung für ihn und für unsere Arbeit."', { m: 2, f: 3, v: 2, me: 2, sp: 7, spielerRolle: 'star' }, 0.05),
      A('„Ich hätte ihn lieber hier behalten. Wir haben genug Baustellen."', { m: 0, f: -2, v: 0, me: 0, sp: -6, spielerRolle: 'star' }, 0.2),
      A('„Solange er gesund zurückkommt, freue ich mich mit ihm."', { m: 1, f: 2, v: 1, me: 2, sp: 3, spielerRolle: 'star' }, 0.05)
    ]
  },
  {
    id: 'platzverhaeltnisse', kat: 'sonstiges', gewicht: 6,
    wenn: () => true,
    frage: () => 'Der Rasen war zuletzt in schlechtem Zustand. Eine Ausrede?',
    kontext: k => `Rasenzustand: ${Math.round(k.rasen)} von 100`,
    antworten: () => [
      A('„Beide Mannschaften spielen auf demselben Acker."', { m: 1, f: 2, v: 2, me: 3 }, 0.05),
      A('„Auf so einem Platz kann man keinen Kombinationsfußball spielen."', { m: 1, f: -2, v: -4, me: -2 }, 0.25),
      A('„Der Verein arbeitet daran. Das dauert eben."', { m: 0, f: 0, v: 2, me: 0 }, 0.05)
    ]
  },
  {
    id: 'zuschauerschwund', kat: 'fans', gewicht: 8,
    wenn: k => k.auslastung > 0 && k.auslastung < 65,
    frage: k => `Nur ${Math.round(k.auslastung)} Prozent Auslastung. Verlieren Sie die Stadt?`,
    kontext: () => 'Leere Sitzschalen sind das ehrlichste Publikum.',
    antworten: () => [
      A('„Wir müssen die Leute zurückholen. Mit Leistung, nicht mit Marketing."', { m: 2, f: 6, v: 1, me: 3 }, 0.05),
      A('„Die Menschen haben andere Sorgen. Das respektiere ich."', { m: 0, f: 3, v: 0, me: 1 }, 0.1),
      A('„Wer nicht kommt, verpasst etwas. Das ist deren Entscheidung."', { m: 1, f: -8, v: 0, me: -2 }, 0.3)
    ]
  },
  {
    id: 'ultras', kat: 'fans', gewicht: 8,
    wenn: k => (k.fans.ultras || 0) > 45,
    frage: () => 'In der Kurve wurde Pyrotechnik gezündet. Der Verein zahlt die Strafe. Ihre Meinung?',
    kontext: () => 'Ein Thema ohne richtige Antwort — nur mit unterschiedlich falschen.',
    antworten: () => [
      A('„Die Stimmung ist unser Kapital. Über die Mittel muss man reden."', { m: 1, f: 6, v: -4, me: 1 }, 0.15),
      A('„Das gehört nicht ins Stadion. Punkt."', { m: 1, f: -7, v: 6, me: 3 }, 0.2),
      A('„Ich bin Trainer, kein Sicherheitsbeauftragter."', { m: 0, f: 0, v: 0, me: -3 }, 0.1)
    ]
  },
  {
    id: 'videobeweis', kat: 'liga', gewicht: 6,
    wenn: () => true,
    frage: () => 'Der Videobeweis — Segen oder Fluch?',
    kontext: () => 'Eine Frage, die jede Pressekonferenz überlebt.',
    antworten: () => [
      A('„Wenn er richtig eingesetzt wird, hilft er dem Fußball."', { m: 0, f: 0, v: 1, me: 2 }, 0.05),
      A('„Er nimmt den Fans die Emotion. Das kriegt man nicht zurück."', { m: 0, f: 4, v: 0, me: 2 }, 0.1),
      A('„Gegen uns entscheidet er auffällig oft."', { m: 2, f: 3, v: -2, me: -5 }, 0.3)
    ]
  },
  {
    id: 'gegner_star', kat: 'spiel', gewicht: 8,
    wenn: k => !!k.gegnerStar,
    frage: k => `${k.gegnerStar} ist in Topform. Bekommt er einen Manndecker?`,
    kontext: k => `Gegner: ${k.gegnerName}`,
    antworten: () => [
      A('„Wir verteidigen als Mannschaft, nicht als Einzelkämpfer."', { m: 2, f: 1, v: 1, me: 2 }, 0.05),
      A('„Er wird sich wundern, wie eng es für ihn wird."', { m: 3, f: 4, v: 0, me: 2, ank: true }, 0.3),
      A('„Ein überragender Fußballer. Wir müssen die Räume eng machen."', { m: 0, f: 0, v: 1, me: 3 }, 0.05)
    ]
  },
  {
    id: 'formkrise_star', kat: 'personal', gewicht: 10,
    wenn: k => !!k.star && k.star.form < 42,
    frage: k => `${k.star.name} ist außer Form. Sollte er eine Pause bekommen?`,
    kontext: k => `Form: ${Math.round(k.star.form)} von 100`,
    antworten: k => [
      A('„Klasse setzt sich durch. Er spielt."', { m: 1, f: 0, v: 0, me: 1, sp: 8, spielerRolle: 'star' }, 0.15),
      A('„Eine Pause kann helfen. Das entscheide ich mit ihm gemeinsam."', { m: 2, f: 1, v: 2, me: 2, sp: 2, spielerRolle: 'star' }, 0.05),
      A('„Er hat zuletzt seine Leistung nicht gebracht. Das weiß er."', { m: -1, f: 2, v: 2, me: 3, sp: -11, spielerRolle: 'star' }, 0.3)
    ]
  },
  {
    id: 'kabinenstreit', kat: 'krise', gewicht: 11,
    wenn: k => k.moral < 48,
    frage: () => 'Aus der Kabine dringt Unruhe. Gibt es interne Probleme?',
    kontext: k => `Mannschaftsmoral: ${Math.round(k.moral)} von 100`,
    antworten: () => [
      A('„Was in der Kabine passiert, bleibt in der Kabine."', { m: 4, f: 0, v: 1, me: -3 }, 0.1),
      A('„Es wird diskutiert. Das ist in einer Umkleide völlig normal."', { m: 1, f: 1, v: 1, me: 2 }, 0.1),
      A('„Ja, es gibt zwei, drei, die sich für wichtiger halten, als sie sind."', { m: -8, f: 3, v: 1, me: 5 }, 0.4)
    ]
  },
  {
    id: 'saisonziel_frage', kat: 'vorstand', gewicht: 10,
    wenn: k => !!k.ziel,
    frage: k => `Das Vereinsziel lautet „${k.ziel.text}". Ist das realistisch?`,
    kontext: k => `Aktuell Platz ${k.platz} von ${k.lage.teams}`,
    antworten: () => [
      A('„Das Ziel gilt. Daran messe ich mich."', { m: 2, f: 3, v: 5, me: 1 }, 0.15),
      A('„Ziele werden im Sommer formuliert und im Mai bewertet."', { m: 1, f: 0, v: 1, me: 2 }, 0.05),
      A('„Ehrlich gesagt: Dieser Kader gibt mehr nicht her."', { m: -6, f: -4, v: -9, me: 4 }, 0.25)
    ]
  },
  {
    id: 'standards', kat: 'taktik', gewicht: 7,
    wenn: () => true,
    frage: () => 'Bei Standards wirkt Ihre Mannschaft harmlos. Wird das trainiert?',
    kontext: () => 'Ein Drittel aller Tore fällt nach ruhenden Bällen. Sagt die Statistik.',
    antworten: () => [
      A('„Jede Woche, zwanzig Minuten. Es fehlt die Präzision."', { m: 0, f: 0, v: 1, me: 2 }, 0.05),
      A('„Standards sind Handwerk. Da werden wir besser."', { m: 2, f: 1, v: 1, me: 1 }, 0.05),
      A('„Wenn die Flanken nicht ankommen, hilft auch das beste Training nicht."', { m: -3, f: 0, v: 0, me: 1 }, 0.2)
    ]
  },
  {
    id: 'trainingslager', kat: 'sonstiges', gewicht: 6,
    wenn: k => k.tag >= SAISON_TAGE.trainingslagerWinter[0] - 3 && k.tag <= SAISON_TAGE.trainingslagerWinter[1] + 3,
    frage: () => 'Wie fällt Ihr Fazit zum Trainingslager aus?',
    kontext: () => 'Zwölf Einheiten, zwei Testspiele, ein Ausflug ins Nichts.',
    antworten: () => [
      A('„Wir haben hart gearbeitet. Das zahlt sich im Frühjahr aus."', { m: 3, f: 2, v: 2, me: 1 }, 0.05),
      A('„Die Mannschaft ist zusammengerückt. Das war mir wichtiger als Taktik."', { m: 5, f: 2, v: 0, me: 1 }, 0.05),
      A('„Zufrieden bin ich nicht. Einige kamen nicht in Form aus dem Urlaub."', { m: -6, f: 1, v: 2, me: 3 }, 0.25)
    ]
  },
  {
    id: 'medienkritik', kat: 'medien', gewicht: 8,
    wenn: k => k.druck > 60,
    frage: () => 'Ihnen wird nachgesagt, Sie hätten ein schwieriges Verhältnis zur Presse. Stimmt das?',
    kontext: () => 'Die Frage stellt ausgerechnet der Kollege vom Boulevard.',
    antworten: () => [
      A('„Sie machen Ihre Arbeit, ich meine. Das funktioniert doch."', { m: 0, f: 0, v: 1, me: 5 }, 0.05),
      A('„Wenn aus zwei Sätzen von mir eine Schlagzeile wird, ja, dann ist es schwierig."', { m: 2, f: 3, v: -1, me: -7 }, 0.3),
      A('„Ich lese das alles nicht. Ehrlich."', { m: 1, f: 1, v: 0, me: -2 }, 0.15)
    ]
  },
  {
    id: 'aufstellung_verraten', kat: 'taktik', gewicht: 7,
    wenn: k => !!k.naechstes,
    frage: () => 'Verraten Sie uns die Aufstellung für Samstag?',
    kontext: () => 'Der Versuch ist so alt wie der Beruf.',
    antworten: () => [
      A('„Netter Versuch. Nein."', { m: 1, f: 1, v: 1, me: 1 }, 0.05),
      A('„Eine Umstellung wird es geben. Mehr sage ich nicht."', { m: 0, f: 2, v: 0, me: 3 }, 0.15),
      A('„Wir spielen wie immer. Das ist kein Geheimnis, sondern Überzeugung."', { m: 2, f: 0, v: 1, me: 0 }, 0.1)
    ]
  },
  {
    id: 'jugendarbeit', kat: 'jugend', gewicht: 8,
    wenn: () => true,
    frage: () => 'Der Verein investiert viel in die Jugend. Sehen wir davon bald etwas in der Startelf?',
    kontext: k => `Akademie-Ausbau: ${Math.round(k.akademie)} von 100`,
    antworten: () => [
      A('„Wer gut genug ist, ist alt genug. Das ist bei mir keine Floskel."', { m: 2, f: 5, v: 4, me: 2 }, 0.15),
      A('„Der Sprung von der A-Jugend in die Bundesliga ist riesig. Wir überstürzen nichts."', { m: 1, f: -2, v: 1, me: 1 }, 0.05),
      A('„In dieser Saison brauchen wir Erfahrung. Die Jugend kommt später."', { m: 0, f: -4, v: -3, me: 0 }, 0.15)
    ]
  },
  {
    id: 'punkteziel', kat: 'vorstand', gewicht: 8,
    wenn: k => k.spiele >= 3,
    frage: k => `${k.punkte} Punkte nach ${k.spiele} Spielen. Wo stehen Sie am Saisonende?`,
    kontext: k => `Saisonziel: ${k.ziel ? k.ziel.text : 'nicht kommuniziert'}`,
    antworten: () => [
      A('„Ich mache keine Prognosen. Ich mache Punkte."', { m: 1, f: 1, v: 2, me: 2 }, 0.05),
      A('„Wir haben Luft nach oben. Das sage ich der Mannschaft auch."', { m: -1, f: 1, v: 2, me: 1 }, 0.1),
      A('„Wir werden am Ende deutlich über dem Ziel stehen."', { m: 2, f: 6, v: 1, me: 3, ank: true }, 0.5)
    ]
  },
  {
    // Scharfgeschaltet (ROADMAP Stufe 3, Punkt 6): Die Frage kommt genau dann,
    // wenn der Terminplan sie hergibt — drei Pflichtspiele in acht Tagen. Vorher
    // hing sie an `spieleInWoche >= 2`, gezählt über ±8 Tage: ein Fenster von 17
    // Tagen, in dem zwei Spiele der Normalfall sind. Die Frage wurde also fast
    // jede Woche gestellt und behauptete dabei etwas, das nicht stimmte.
    id: 'doppelbelastung', kat: 'europa', gewicht: 7,
    wenn: k => !!(k.englischeWoche && k.englischeWoche.englisch),
    frage: k => `${k.englischeWoche.spiele} Spiele in acht Tagen. Ist der Terminplan noch zumutbar?`,
    kontext: () => 'Die Antwort steht schon fest. Die Frage wird trotzdem gestellt.',
    antworten: () => [
      A('„Wir werden dafür bezahlt. Beschweren wäre unangebracht."', { m: -1, f: 3, v: 3, me: 2 }, 0.05),
      A('„Irgendwann ist die Grenze erreicht. Für die Spieler, nicht für die Vermarkter."', { m: 4, f: 4, v: -2, me: 1 }, 0.2),
      A('„Dafür haben wir einen Kader mit mehr als elf Spielern."', { m: 2, f: 1, v: 2, me: 1 }, 0.05)
    ]
  },
  {
    id: 'gegner_unterschaetzt', kat: 'spiel', gewicht: 8,
    wenn: k => !!k.naechstes && k.gegnerSchwach,
    frage: k => `${k.gegnerName} steht auf einem der letzten Plätze. Ein Pflichtsieg?`,
    kontext: () => 'Das Wort „Pflichtsieg" hat schon Karrieren beendet.',
    antworten: () => [
      A('„Es gibt keine Pflichtsiege. Nur Spiele, die man gewinnen will."', { m: 2, f: 1, v: 2, me: 2 }, 0.05),
      A('„Ja. Wenn wir das nicht gewinnen, ist etwas faul."', { m: -2, f: 3, v: 1, me: 3, ank: true }, 0.4),
      A('„Der Gegner steht zu Unrecht dort unten. Vorsicht ist geboten."', { m: 1, f: -1, v: 1, me: 1 }, 0.05)
    ]
  },
  {
    id: 'geruecht_dementieren', kat: 'medien', gewicht: 8,
    wenn: k => k.geruechte > 0,
    frage: () => 'In der Stadt kursiert ein hartnäckiges Gerücht. Wollen Sie das kommentieren?',
    kontext: () => 'Woher es kommt, weiß angeblich niemand.',
    antworten: () => [
      A('„Ich dementiere das in aller Deutlichkeit."', { m: 1, f: 2, v: 2, me: 1 }, 0.2),
      A('„Gerüchte gehören zu diesem Geschäft wie Regen zum November."', { m: 1, f: 1, v: 1, me: 3 }, 0.05),
      A('„Fragen Sie den, der es gestreut hat. Ich vermute, Sie kennen ihn."', { m: 1, f: 3, v: -1, me: -5 }, 0.3)
    ]
  },
  {
    id: 'vertragsverlaengerung', kat: 'personal', gewicht: 8,
    wenn: k => !!k.auslaufend,
    frage: k => `Der Vertrag von ${k.auslaufend.name} läuft aus. Wird verlängert?`,
    kontext: k => `Vertrag bis Saison ${k.auslaufend.until}, ${k.auslaufend.age} Jahre`,
    antworten: k => [
      A('„Wir wollen mit ihm weitermachen. Das ist kein Geheimnis."', { m: 2, f: 3, v: -1, me: 2, sp: 9, spielerRolle: 'auslaufend' }, 0.1),
      A('„Es gibt Gespräche. Alles Weitere entscheidet die sportliche Leitung."', { m: 0, f: 0, v: 2, me: 1, sp: -2, spielerRolle: 'auslaufend' }, 0.05),
      A('„Er muss sich einen neuen Vertrag verdienen. So läuft das."', { m: -1, f: 1, v: 4, me: 3, sp: -10, spielerRolle: 'auslaufend' }, 0.3)
    ]
  },
  {
    id: 'saisonende_bilanz', kat: 'saison', gewicht: 12,
    wenn: k => k.tag >= SAISON_TAGE.saisonEnde - 7,
    frage: k => `Die Saison endet auf Platz ${k.platz}. Zufrieden?`,
    kontext: k => `Ziel war: ${k.ziel ? k.ziel.text : '—'}`,
    antworten: () => [
      A('„Wir haben unser Ziel erreicht. Das war die Arbeit wert."', { m: 3, f: 3, v: 3, me: 1 }, 0.1),
      A('„Nein. Und das habe ich der Mannschaft auch so gesagt."', { m: -4, f: 2, v: 4, me: 3 }, 0.15),
      A('„Nächste Saison greifen wir richtig an."', { m: 3, f: 5, v: 1, me: 2, ank: true }, 0.4)
    ]
  }
];

/* ================================================================== *
 *  Pressekonferenz-Kontext
 * ================================================================== */

function pkKontext(state, ctx) {
  const clubId = state.managerClubId;
  const club = state.clubs[clubId];
  const k = schlagzeilenKontext(state, clubId);
  const spieler = kader(state, clubId);
  const p = presseState(state);

  const feld = spieler.filter(s => !s.jugend);
  const torwart = sortBy(feld.filter(s => s.position === 'TW'),
    s => ({ key: (s.stats && s.stats.season && s.stats.season.spiele) || 0, desc: true }))[0] || null;
  const star = sortBy(feld, s => ({ key: s.value || 0, desc: true }))[0] || null;
  const kapitaen = feld.find(s => s.captain) ||
    sortBy(feld, s => ({ key: (s.attributes && s.attributes.fuehrung) || 0, desc: true }))[0] || null;
  const talent = sortBy(feld.filter(s => s.age <= 20), s => ({ key: s.potential || 0, desc: true }))[0] || null;
  const veteran = sortBy(feld.filter(s => s.age >= 33), s => ({ key: s.age, desc: true }))[0] || null;
  const auslaufend = feld.find(s => s.contract && s.contract.until <= state.date.season) || null;
  const mitNoten = feld.filter(s => schnittNote(s) !== null && (s.stats.season.spiele || 0) >= 3);
  const schwaechster = sortBy(mitNoten, s => ({ key: schnittNote(s), desc: true }))[0] || null;

  const naechstes = k.naechstes;
  const gegner = naechstes ? state.clubs[naechstes.gegnerId] : null;
  const derby = !!(gegner && club.city && gegner.city === club.city);
  const gegnerLage = gegner ? lageVon(state, gegner.id) : null;
  const gegnerStar = gegner
    ? (sortBy(kader(state, gegner.id), s => ({ key: s.value || 0, desc: true }))[0] || null)
    : null;

  const gehaltssumme = feld.reduce((s, x) => s + ((x.contract && x.contract.salary) || 0), 0);
  const durchschnittsalter = feld.length ? round(feld.reduce((s, x) => s + x.age, 0) / feld.length, 1) : 26;
  const st = club.stadiumState || {};
  const fensterEnde = state.date.day <= SAISON_TAGE.transferfenster.sommer[1]
    ? SAISON_TAGE.transferfenster.sommer[1] : SAISON_TAGE.transferfenster.winter[1];
  const imFenster =
    (state.date.day >= SAISON_TAGE.transferfenster.sommer[0] && state.date.day <= SAISON_TAGE.transferfenster.sommer[1]) ||
    (state.date.day >= SAISON_TAGE.transferfenster.winter[0] && state.date.day <= SAISON_TAGE.transferfenster.winter[1]);

  // Die Spieldichte kommt jetzt als `englischeWoche` aus schlagzeilenKontext()
  // und wird hier nicht mehr ein zweites Mal (und falsch) gezählt.

  const namensteile = String(state.manager.name || 'Trainer').split(' ');

  const kurz = (s) => s ? {
    id: s.id, name: s.shortName || s.lastName, age: s.age, form: s.form || 50,
    value: s.value || 0, potential: s.potential || 0,
    until: (s.contract && s.contract.until) || state.date.season,
    spiele: (s.stats && s.stats.season && s.stats.season.spiele) || 0,
    note: schnittNote(s) ? round(schnittNote(s), 2) : null
  } : null;

  return Object.assign({}, k, {
    trainerNachname: namensteile[namensteile.length - 1],
    punkte: k.lage.punkte,
    formText: k.letzte.map(x => x.ergebnis).join('-') || 'noch keine Spiele',
    torwart: kurz(torwart), star: kurz(star), kapitaen: kurz(kapitaen),
    talent: kurz(talent), veteran: kurz(veteran), auslaufend: kurz(auslaufend),
    schwaechster: kurz(schwaechster),
    verletzteNamen: spieler.filter(s => s.injury).slice(0, 3).map(s => s.shortName || s.lastName).join(', ') || 'niemand',
    gegnerName: gegner ? (gegner.shortName || gegner.name) : '',
    gegnerStar: gegnerStar ? (gegnerStar.shortName || gegnerStar.lastName) : null,
    gegnerSchwach: !!(gegnerLage && gegnerLage.platz >= gegnerLage.teams - 4 && gegnerLage.spiele >= 3),
    derby,
    exVerein: !!(gegner && (state.manager.karriere || []).some(kk => kk.clubId === gegner.id)),
    europa: (state.fixtures || []).some(f => ['cl', 'el', 'conf'].includes(f.competitionId) &&
      f.season === state.date.season && (f.homeId === clubId || f.awayId === clubId)),
    transferfenster: imFenster,
    tageBisSchluss: Math.max(0, fensterEnde - state.date.day),
    budget: (club.finances && club.finances.transferBudget) || 0,
    gehaltssumme,
    gehaltsquote: gehaltssumme / Math.max(1, (club.reputation || 50) * 1500000),
    durchschnittsalter,
    moral: club.moral === undefined ? 60 : club.moral,
    formation: (club.tactics && club.tactics.formation) || '4-4-2',
    ticketpreis: (st.preise && st.preise.sitz) || (club.finances && club.finances.ticketBase) || 25,
    rasen: st.rasenZustand || (club.stadium && club.stadium.pitch) || 80,
    akademie: (club.youth && club.youth.akademie) || 50,
    jobangebote: ((state.manager && state.manager.angebote) || []).length,
    geruechte: (p.geruechte || []).filter(g => g.season === state.date.season).length,
    druck: p.druck
  });
}

/**
 * Baut die Pressekonferenz vor dem Spiel.
 * @returns {{ fragen: Array }}
 */
export function pressekonferenz(state, ctx) {
  const clubId = state.managerClubId;
  const club = state.clubs[clubId];
  if (!club) return { fragen: [] };
  const p = presseState(state);
  const rng = (ctx && ctx.rng) ? ctx.rng.fork('pk') : rngFuer(state, 'pk');
  const k = pkKontext(state, ctx);

  const moeglich = FRAGEN_KATALOG.filter(f => {
    try { return f.wenn(k); } catch (e) { return false; }
  });
  const pool = moeglich.length >= FRAGEN_PRO_PK ? moeglich : FRAGEN_KATALOG.filter(f => {
    try { return f.wenn === undefined || f.wenn(k) || f.gewicht >= 6; } catch (e) { return false; }
  });

  const gewaehlt = [];
  const benutzt = new Set();
  for (let i = 0; i < FRAGEN_PRO_PK && pool.length; i++) {
    const rest = pool.filter(f => !benutzt.has(f.id));
    if (!rest.length) break;
    const f = rng.pickWeighted(rest, x => x.gewicht);
    benutzt.add(f.id);
    const blatt = rng.pickWeighted(BLAETTER, b => b.reichweite);
    let antworten;
    try { antworten = f.antworten(k); } catch (e) { continue; }
    gewaehlt.push({
      id: uid('frage', rng),
      typ: f.id,
      kategorie: f.kat,
      blatt: blatt.name,
      blattId: blatt.id,
      tonfall: blatt.tonfall,
      text: typeof f.frage === 'function' ? f.frage(k) : String(f.frage),
      kontext: typeof f.kontext === 'function' ? f.kontext(k) : (f.kontext || ''),
      antworten: antworten.map(a => ({
        text: a.text,
        wirkung: Object.assign({}, a.wirkung, { spielerId: a.wirkung.ziel ? (k[a.wirkung.ziel] ? k[a.wirkung.ziel].id : null) : null }),
        risiko: a.risiko
      })),
      beantwortet: false,
      tag: state.date.day,
      season: state.date.season
    });
  }

  p.offeneFragen = gewaehlt;
  p.letztePk = state.date.day;
  return { fragen: gewaehlt, blattAuswahl: BLAETTER.map(b => b.name) };
}

/**
 * Wendet die gewählte Antwort an.
 * @returns {{ok:boolean, text:string, wirkung?:object, risikoEingetreten?:boolean}}
 */
export function antwortGeben(state, frageId, antwortIndex) {
  const p = presseState(state);
  const frage = p.offeneFragen.find(f => f.id === frageId);
  if (!frage) return { ok: false, text: 'Diese Frage wurde nicht gestellt — oder liegt schon in der Ablage.' };
  if (frage.beantwortet) return { ok: false, text: 'Sie haben darauf bereits geantwortet. Zweimal wirkt unsicher.' };
  const antwort = frage.antworten[antwortIndex];
  if (!antwort) return { ok: false, text: 'Diese Antwort steht nicht zur Auswahl.' };

  const club = state.clubs[state.managerClubId];
  if (!club) return { ok: false, text: 'Kein Verein, keine Pressekonferenz.' };

  const rng = rngFuer(state, 'antwort:' + frageId + ':' + antwortIndex);
  const medienSkill = (state.manager.skills && state.manager.skills.medien) || 45;
  const risiko = clamp((antwort.risiko || 0) * (1.25 - medienSkill / 180), 0, 0.85);
  const eingetreten = rng.chance(risiko);
  const faktor = eingetreten ? -RISIKO_UMKEHR : 1;

  const w = antwort.wirkung;
  const moral = clamp((w.moral || 0) * faktor, -WIRKUNG_MAX_MORAL, WIRKUNG_MAX_MORAL);
  const fans = clamp((w.fans || 0) * faktor, -WIRKUNG_MAX_FANS, WIRKUNG_MAX_FANS);
  const vorstand = clamp((w.vorstand || 0) * faktor, -WIRKUNG_MAX_VORSTAND, WIRKUNG_MAX_VORSTAND);
  const medien = (w.medien || 0) * faktor;
  const spielerWirkung = clamp((w.spieler || 0) * faktor, -WIRKUNG_MAX_SPIELER, WIRKUNG_MAX_SPIELER);

  club.moral = clamp((club.moral === undefined ? 60 : club.moral) + moral, 0, 100);
  if (!club.fans) club.fans = { mood: 60 };
  club.fans.mood = clamp((club.fans.mood || 60) + fans, 0, 100);
  if (club.board) {
    club.board.zufriedenheit = clamp((club.board.zufriedenheit || 60) + vorstand, 0, 100);
    club.board.vertrauen = clamp((club.board.vertrauen || 60) + vorstand * 0.6, 0, 100);
  }
  p.druck = clamp(p.druck - medien * 1.6, 0, 100);
  p.glaubwuerdigkeit = clamp(p.glaubwuerdigkeit + (eingetreten ? -4 : 1), 0, 100);

  let spielerName = null;
  if (w.spielerId && state.players[w.spielerId]) {
    const sp = state.players[w.spielerId];
    const schwung = (sp.personality && sp.personality.moraleSwing) || 1;
    sp.morale = clamp((sp.morale || 60) + spielerWirkung * schwung, 0, 100);
    spielerName = sp.shortName || sp.lastName;
    if (spielerWirkung < -6 && sp.happiness) {
      if (!Array.isArray(sp.happiness.beschwerden)) sp.happiness.beschwerden = [];
      sp.happiness.beschwerden.push({
        grund: 'oeffentliche_kritik', tag: state.date.day, season: state.date.season,
        text: 'Öffentlich vom Trainer kritisiert worden.'
      });
      if (sp.happiness.beschwerden.length > 8) sp.happiness.beschwerden.shift();
    }
  }

  if (w.ankuendigung && !eingetreten) {
    p.ankuendigungen.push({
      id: uid('ank', rng), typ: frage.typ, text: antwort.text,
      tag: state.date.day, bisTag: state.date.day + ANKUENDIGUNG_TAGE, season: state.date.season
    });
    if (club.board) {
      // Große Worte erhöhen die Erwartung: der Vorstand nimmt sie beim Wort.
      club.board.zufriedenheit = clamp(club.board.zufriedenheit - 1, 0, 100);
    }
  }

  frage.beantwortet = true;
  frage.gewaehlt = antwortIndex;
  frage.risikoEingetreten = eingetreten;
  p.beantwortet.unshift({
    id: frage.id, typ: frage.typ, blatt: frage.blatt, frage: frage.text,
    antwort: antwort.text, tag: state.date.day, season: state.date.season, eingetreten
  });
  if (p.beantwortet.length > 40) p.beantwortet.length = 40;

  const text = eingetreten
    ? `Am nächsten Morgen steht es verdreht in der Zeitung: „${kurzzitat(antwort.text)}" — und plötzlich reden alle über etwas anderes als Fußball.`
    : `Ihre Antwort kommt an. ${frage.blatt} zitiert Sie mit: „${kurzzitat(antwort.text)}"`;

  return {
    ok: true, text, risikoEingetreten: eingetreten, spieler: spielerName,
    wirkung: { moral, fans, vorstand, medien, spieler: spielerWirkung, spielerId: w.spielerId || null }
  };
}

function kurzzitat(t) {
  const s = String(t).replace(/^„|"$/g, '').replace(/[„"]/g, '');
  return s.length > 88 ? s.slice(0, 85) + '…' : s;
}

/* ================================================================== *
 *  INTERVIEWS & GERÜCHTE
 * ================================================================== */

export const INTERVIEW_THEMEN = {
  lob: { name: 'Öffentlich loben', moral: 9, fans: 2, vorstand: -1, risiko: 0.12 },
  kritik: { name: 'Öffentlich kritisieren', moral: -13, fans: 3, vorstand: 3, risiko: 0.3 },
  zukunft: { name: 'Über die Zukunft sprechen', moral: 4, fans: 2, vorstand: 0, risiko: 0.2 },
  form: { name: 'Formkrise ansprechen', moral: -5, fans: 1, vorstand: 2, risiko: 0.22 },
  einsatzzeit: { name: 'Einsatzzeiten erklären', moral: 6, fans: 0, vorstand: 0, risiko: 0.15 },
  geruecht: { name: 'Wechselgerücht dementieren', moral: 5, fans: 5, vorstand: -2, risiko: 0.25 }
};

/**
 * Schickt einen Spieler vor die Mikrofone (bzw. spricht über ihn).
 * @returns {{ok:boolean, text:string, wirkung?:object}}
 */
export function interviewSpieler(state, playerId, thema) {
  const sp = state.players[playerId];
  if (!sp) return { ok: false, text: 'Diesen Spieler gibt es nicht.' };
  const club = state.clubs[sp.clubId];
  if (!club) return { ok: false, text: 'Der Spieler gehört keinem Verein an.' };
  const t = INTERVIEW_THEMEN[thema] || INTERVIEW_THEMEN.lob;
  const p = presseState(state);

  const rng = rngFuer(state, 'interview:' + playerId + ':' + thema);
  const medienSkill = (state.manager.skills && state.manager.skills.medien) || 45;
  const eingetreten = rng.chance(clamp(t.risiko * (1.25 - medienSkill / 180), 0, 0.8));
  const faktor = eingetreten ? -1.2 : 1;
  const schwung = (sp.personality && sp.personality.moraleSwing) || 1;

  sp.morale = clamp((sp.morale || 60) + t.moral * faktor * schwung, 0, 100);
  club.fans.mood = clamp((club.fans.mood || 60) + t.fans * faktor * 0.5, 0, 100);
  if (club.board) club.board.zufriedenheit = clamp((club.board.zufriedenheit || 60) + t.vorstand * faktor * 0.5, 0, 100);
  p.druck = clamp(p.druck + (eingetreten ? 5 : -2), 0, 100);

  const name = sp.shortName || sp.lastName;
  const blatt = rng.pickWeighted(BLAETTER, b => b.reichweite);
  const texte = {
    lob: eingetreten
      ? `${blatt.name} macht aus Ihrem Lob eine Schlagzeile: „${name} unantastbar?" — im Kabinentrakt schmunzeln jetzt einige.`
      : `${blatt.name} druckt Ihr Lob in voller Länge. ${name} liest es zweimal und geht mit breiter Brust ins Training.`,
    kritik: eingetreten
      ? `Ihre Kritik an ${name} steht am nächsten Morgen in Großbuchstaben. Der Spieler lässt über seinen Berater ausrichten, er fühle sich vorgeführt.`
      : `Sie nehmen ${name} öffentlich in die Pflicht. Unangenehm für ihn, aber der Vorstand nickt anerkennend.`,
    zukunft: eingetreten
      ? `Aus Ihren Andeutungen über ${name} wird eine Abschiedsmeldung. Sie dürfen morgen dementieren.`
      : `Sie skizzieren ${name} eine Perspektive. Solche Sätze bleiben in einer Kabine hängen.`,
    form: eingetreten
      ? `„Trainer zweifelt an ${name}" — so hatten Sie das nicht gemeint. So steht es jetzt trotzdem da.`
      : `Sie sprechen die Formkrise von ${name} sachlich an. Er nickt, sagt nichts und trainiert am Nachmittag doppelt.`,
    einsatzzeit: eingetreten
      ? `Ihre Erklärung zu den Einsatzzeiten wird als Absage gelesen. ${name} war anschließend nicht zu sprechen.`
      : `Sie erklären öffentlich, warum ${name} zuletzt draußen saß. Das schafft Klarheit — in beide Richtungen.`,
    geruecht: eingetreten
      ? `Ihr Dementi zum Wechselgerücht um ${name} klingt in der Zeitung wie eine Bestätigung. Danke auch.`
      : `Sie stellen sich vor ${name} und räumen das Gerücht ab. Die Kurve dankt es Ihnen.`
  };
  return {
    ok: true, text: texte[thema] || texte.lob,
    wirkung: { spielerId: playerId, moral: t.moral * faktor, fans: t.fans * faktor },
    risikoEingetreten: eingetreten
  };
}

export const GERUECHT_THEMEN = {
  transferinteresse: { name: 'Eigenes Interesse an einem Star streuen', ziel: 'eigen', fans: 5, druck: -3, risiko: 0.3 },
  gegner_krise: { name: 'Krisengerücht über den nächsten Gegner', ziel: 'gegner', fans: 1, druck: -2, risiko: 0.35 },
  gegner_trainer: { name: 'Trainerwechsel beim Gegner andeuten', ziel: 'gegner', fans: 1, druck: -1, risiko: 0.4 },
  eigene_staerke: { name: 'Aufbruchstimmung im eigenen Verein verbreiten', ziel: 'eigen', fans: 6, druck: -6, risiko: 0.28 },
  geldsorgen_gegner: { name: 'Geldsorgen beim Konkurrenten andeuten', ziel: 'gegner', fans: 0, druck: -1, risiko: 0.45 }
};

/**
 * Streut ein Gerücht über die Hintertür der Presse.
 * @returns {{ok:boolean, text:string}}
 */
export function geruechtStreuen(state, clubId, thema) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  const t = GERUECHT_THEMEN[thema];
  if (!t) return { ok: false, text: 'Über dieses Thema lässt sich nichts streuen.' };
  const p = presseState(state);

  const laufend = p.geruechte.filter(g => g.season === state.date.season && state.date.day - g.tag < 14);
  if (laufend.length >= 2) {
    return { ok: false, text: 'Zwei Gerüchte in zwei Wochen — selbst der Boulevard wird da misstrauisch.' };
  }

  const rng = rngFuer(state, 'geruecht:' + clubId + ':' + thema);
  const medienSkill = (state.manager.skills && state.manager.skills.medien) || 45;
  const erfolg = rng.chance(clamp(GERUECHT_GRUNDCHANCE + (medienSkill - 45) / 200 + (p.glaubwuerdigkeit - 50) / 250, 0.15, 0.9));
  const auffliegen = rng.chance(clamp(GERUECHT_AUFFLIEG_BASIS + t.risiko * 0.5 - medienSkill / 400, 0.05, 0.7));

  const eintrag = {
    id: uid('ger', rng), thema, clubId, tag: state.date.day, season: state.date.season,
    erfolg, aufgeflogen: auffliegen
  };
  p.geruechte.unshift(eintrag);
  if (p.geruechte.length > 20) p.geruechte.length = 20;

  const gegnerInfo = naechstesSpiel(state, clubId);
  const gegner = gegnerInfo ? state.clubs[gegnerInfo.gegnerId] : null;

  if (auffliegen) {
    p.glaubwuerdigkeit = clamp(p.glaubwuerdigkeit - 12, 0, 100);
    p.druck = clamp(p.druck + 9, 0, 100);
    if (club.board) club.board.vertrauen = clamp((club.board.vertrauen || 60) - 6, 0, 100);
    return {
      ok: false,
      text: `Der Kollege von ${rng.pick(BLAETTER).name} hat nachrecherchiert — und die Quelle in Ihrem Büro verortet. ` +
        `Das war teuer: Ihre Glaubwürdigkeit hat gelitten, der Vorstand hat den Artikel ebenfalls gelesen.`
    };
  }
  if (!erfolg) {
    return { ok: false, text: 'Die Redaktionen winken ab. Ohne zweite Quelle druckt das niemand — nicht einmal die BILDSCHIRM.' };
  }

  p.druck = clamp(p.druck + t.druck, 0, 100);
  club.fans.mood = clamp((club.fans.mood || 60) + t.fans * 0.5, 0, 100);
  if (t.ziel === 'gegner' && gegner) {
    if (gegner.fans) gegner.fans.mood = clamp((gegner.fans.mood || 60) - 3, 0, 100);
    if (gegner.board) gegner.board.zufriedenheit = clamp((gegner.board.zufriedenheit || 60) - 2, 0, 100);
  }

  const texte = {
    transferinteresse: `Am Kiosk steht: „Holt ${club.shortName} den Königstransfer?" Niemand weiß, woher es kommt. Sie schon.`,
    gegner_krise: `„Krisensitzung bei ${gegner ? gegner.shortName : 'dem Gegner'}" — die Meldung läuft seit dem Frühstück. Praktisch vor einem Spieltag.`,
    gegner_trainer: `Plötzlich diskutiert die halbe Republik über den Trainerstuhl bei ${gegner ? gegner.shortName : 'dem Gegner'}. Zufälle gibt es.`,
    eigene_staerke: `Die Blätter berichten von einer „Aufbruchstimmung" bei ${club.shortName}. Wer das gestreut hat, bleibt Ihr Geheimnis.`,
    geldsorgen_gegner: `„Zahlungsprobleme beim Konkurrenten?" — der Artikel ist vage genug, um niemanden zu verklagen, und deutlich genug, um zu wirken.`
  };
  return { ok: true, text: texte[thema] || 'Das Gerücht macht seine Runde.' };
}

/* ================================================================== *
 *  SAISONRÜCKBLICK
 * ================================================================== */

/** Langer deutscher Rückblick am Saisonende. */
export function saisonRueckblick(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return '';
  const lage = lageVon(state, clubId);
  const b = club.board || {};
  const ziel = b.saisonziel || b.erwartung || { platz: 10, text: 'ein ordentlicher Platz' };
  const alle = letzteSpiele(state, clubId, 60);
  const siege = alle.filter(x => x.ergebnis === 'S').length;
  const remis = alle.filter(x => x.ergebnis === 'U').length;
  const pleiten = alle.filter(x => x.ergebnis === 'N').length;
  const spieler = kader(state, clubId);
  const torjaeger = sortBy(spieler, s => ({ key: (s.stats && s.stats.season && s.stats.season.tore) || 0, desc: true }))[0];
  const tore = torjaeger ? ((torjaeger.stats.season && torjaeger.stats.season.tore) || 0) : 0;
  const qual = qualificationFor(lage.ligaId, lage.platz);
  const erfuellt = lage.platz <= ziel.platz;
  const knapp = !erfuellt && lage.platz <= (ziel.minPlatz || ziel.platz + 3);

  const kopf = erfuellt
    ? `EINE SAISON, DIE MAN AUFHEBT`
    : knapp
      ? `ZWISCHEN ANSPRUCH UND WIRKLICHKEIT`
      : `EINE SAISON ZUM VERGESSEN`;

  const teile = [];
  teile.push(`${kopf}\n${'-'.repeat(kopf.length)}`);
  teile.push(
    `${club.name} beendet die Spielzeit auf Platz ${lage.platz} mit ${lage.punkte} Punkten ` +
    `(${siege} Siege, ${remis} Unentschieden, ${pleiten} Niederlagen) und einem Torverhältnis von ` +
    `${lage.tore}:${lage.gegentore}. Ausgegeben war: „${ziel.text}".`
  );

  if (qual === 'meister') {
    teile.push(`Am Ende stand der Titel. Die Stadt hat drei Tage nicht geschlafen, der Verein hat drei Wochen gefeiert und der Schatzmeister rechnet noch immer nach, was das gekostet hat. Egal — so etwas erlebt man nicht jedes Jahr.`);
  } else if (qual === 'cl' || qual === 'el' || qual === 'conf') {
    teile.push(`Der internationale Startplatz ist gesichert. Das bedeutet Donnerstag- oder Mittwochabende unter Flutlicht, volle Kassen und einen Kader, der plötzlich zu klein wirkt. Willkommen bei den Sorgen, die man gerne hat.`);
  } else if (qual === 'aufstieg') {
    teile.push(`Der Aufstieg ist geschafft. Ein ganzer Landstrich hat sich vor dem Rathaus versammelt, und der Vorsitzende hat eine Rede gehalten, die zwei Minuten zu lang war und trotzdem alle mitgerissen hat.`);
  } else if (qual === 'abstieg') {
    teile.push(`Der Abstieg ist besiegelt. Nach dem letzten Spiel blieb die Kurve stehen und sang weiter — das macht es nicht besser, aber ein bisschen erträglicher. Nun beginnt die unangenehmste Arbeit im Fußball: der Umbau nach unten.`);
  } else if (qual === 'relegation') {
    teile.push(`Es bleibt die Relegation. Zwei Spiele, in denen eine ganze Saison verhandelt wird. Der Verein hat sich das selbst eingebrockt und wird es selbst auslöffeln müssen.`);
  } else if (erfuellt) {
    teile.push(`Das Ziel wurde erreicht, ohne dass jemand am letzten Spieltag zum Taschenrechner greifen musste. In diesem Geschäft ist das mehr wert, als es sich anhört.`);
  } else {
    teile.push(`Für die ganz großen Sätze reicht diese Saison nicht. Sie war brauchbar, stellenweise ordentlich und über weite Strecken das, was man in dieser Liga eine solide Nummer nennt.`);
  }

  if (torjaeger && tore > 0) {
    teile.push(`Bester Torschütze wurde ${torjaeger.firstName ? torjaeger.firstName + ' ' : ''}${torjaeger.lastName} mit ${tore} Treffern. Ob er im Sommer bleibt, entscheidet weniger sein Herz als der Markt — so ehrlich muss man sein.`);
  }

  const stimmung = club.fans ? club.fans.mood || 60 : 60;
  teile.push(
    stimmung >= 70
      ? `Auf den Rängen war die Stimmung selbst in schwachen Wochen bemerkenswert. Diese Anhängerschaft trägt viel — man sollte das nicht überstrapazieren.`
      : stimmung >= 45
        ? `Das Publikum blieb kritisch, aber loyal. Beifall gab es für Einsatz, Pfiffe für Bequemlichkeit. Ein fairer Handel.`
        : `Zwischen Mannschaft und Kurve ist in dieser Saison etwas zerbrochen. Das repariert kein Transfer, das repariert nur eine Serie.`
  );

  const bilanz = b.zufriedenheit === undefined ? 60 : b.zufriedenheit;
  teile.push(
    bilanz >= 70
      ? `Der Aufsichtsrat äußerte sich anschließend „außerordentlich zufrieden" — ein Satz, den man sich in diesem Verein rahmen lassen kann.`
      : bilanz >= 45
        ? `Der Aufsichtsrat sprach von einer „Saison mit Licht und Schatten" und kündigte an, im Sommer über die Kaderplanung zu sprechen. Man kennt diese Sätze.`
        : `Im Präsidium wird deutlich unfreundlicher über die Saison gesprochen. Wer die Sprache dieses Geschäfts kennt, weiß, was das bedeutet.`
  );

  teile.push(`Die Vorbereitung beginnt am 14. Juli. Bis dahin gilt, was in diesem Sport immer gilt: Es zählt nur die nächste Saison.`);
  return teile.join('\n\n');
}

/* ================================================================== *
 *  TICK
 * ================================================================== */

function istWochenstart(state, ctx) {
  if (ctx && ctx.isWeekStart !== undefined) return !!ctx.isWeekStart;
  if (ctx && ctx.weekday !== undefined) return ctx.weekday === 0;
  return (state.date.day % 7) === 6;   // leagues.js: dayIndex % 7 === 6 ist Montag
}

/**
 * Tagesablauf der Medien. Nur der Verein des Spielers erzeugt Schlagzeilen —
 * KI-Vereine kosten hier bewusst nichts.
 */
export function tickMedien(state, ctx) {
  const clubId = state.managerClubId;
  const club = state.clubs[clubId];
  if (!club) return;
  const p = presseState(state);

  // --- Mediendruck fortschreiben ---------------------------------------
  const ziel = medienDruck(state, clubId);
  p.druck = clamp(p.druck + (ziel - p.druck) * DRUCK_TRAEGHEIT, 0, 100);

  // --- Abgelaufene Ankündigungen abrechnen -----------------------------
  const faellig = p.ankuendigungen.filter(a => a.season === state.date.season && a.bisTag < state.date.day);
  if (faellig.length) {
    p.ankuendigungen = p.ankuendigungen.filter(a => !(a.season === state.date.season && a.bisTag < state.date.day));
    const letzte = letzteSpiele(state, clubId, 4);
    const gutgegangen = letzte.filter(x => x.ers2 === 'S' || x.ergebnis === 'S').length >= 2;
    for (const a of faellig) {
      if (gutgegangen) {
        club.fans.mood = clamp((club.fans.mood || 60) + 3, 0, 100);
        ticker(state, ctx, clubId, `Wort gehalten: Die vollmundige Ankündigung des Trainers hat sich als Versprechen entpuppt.`, 'presse');
      } else {
        club.fans.mood = clamp((club.fans.mood || 60) - 4, 0, 100);
        if (club.board) club.board.zufriedenheit = clamp((club.board.zufriedenheit || 60) - 3, 0, 100);
        p.druck = clamp(p.druck + 7, 0, 100);
        post(state, ctx, clubId, {
          from: 'BILDSCHIRM',
          subject: 'Große Worte, kleine Taten',
          body: `Vor drei Wochen sagten Sie: „${kurzzitat(a.text)}"\n\n` +
            `Wir haben nachgesehen, was daraus geworden ist. Viel war es nicht. ` +
            `Unsere Leser haben ein gutes Gedächtnis — wir helfen ihnen dabei.`,
          kind: 'presse'
        });
      }
    }
  }

  const gestern = (state.fixtures || []).some(f =>
    f.played && f.season === state.date.season && f.dayIndex === state.date.day - 1 &&
    (f.homeId === clubId || f.awayId === clubId));
  const heuteGespielt = (state.fixtures || []).some(f =>
    f.played && f.season === state.date.season && f.dayIndex === state.date.day &&
    (f.homeId === clubId || f.awayId === clubId));

  const rng = (ctx && ctx.rng) ? ctx.rng.fork('medien') : rngFuer(state, 'medien');

  // --- Schlagzeilen ------------------------------------------------------
  let anzahl = 0;
  if (heuteGespielt || gestern) anzahl = SCHLAGZEILEN_NACH_SPIEL;
  else if (rng.chance(0.45 + p.druck / 300)) anzahl = SCHLAGZEILEN_ALLTAG;

  if (anzahl > 0) {
    const zeilen = schlagzeilen(state, ctx, anzahl);
    for (const z of zeilen) {
      ticker(state, ctx, clubId, `${z.kuerzel}: ${z.titel}`, 'presse');
      p.archiv.unshift({ tag: state.date.day, season: state.date.season, blatt: z.blatt, titel: z.titel, betrifft: z.betrifft });
    }
    if (p.archiv.length > 80) p.archiv.length = 80;
  }

  // --- Montag: Wochenzeitung --------------------------------------------
  if (istWochenstart(state, ctx) && state.date.day >= SAISON_TAGE.vorbereitungStart) {
    const zeilen = schlagzeilen(state, ctx, SCHLAGZEILEN_WOCHENZEITUNG);
    if (zeilen.length) {
      const body = zeilen.map(z => `【${z.blatt}】 ${z.titel}\n${z.text}`).join('\n\n') +
        `\n\n— Medienbarometer: ${Math.round(p.druck)} von 100. ` +
        (p.druck > 70 ? 'Sie stehen im Feuer.' : p.druck > 45 ? 'Normales Grundrauschen.' : 'Man lässt Sie in Ruhe arbeiten.');
      post(state, ctx, clubId, {
        from: 'Fußball-Woche',
        subject: `Presseschau — Woche ${Math.floor(state.date.day / 7) + 1}`,
        body,
        kind: 'presse'
      });
    }
  }

  // --- Vor dem Spiel: Pressekonferenz ansetzen ---------------------------
  const naechstes = naechstesSpiel(state, clubId);
  if (naechstes && naechstes.tag - state.date.day === 1 && p.letztePk !== state.date.day) {
    const pk = pressekonferenz(state, ctx);
    if (pk.fragen.length) {
      post(state, ctx, clubId, {
        from: 'Presseabteilung',
        subject: 'Pressekonferenz vor dem Spiel',
        body: `Die Journalisten sitzen bereits im Medienraum. ${pk.fragen.length} Fragen stehen auf dem Zettel — ` +
          `unter anderem von ${pk.fragen.map(f => f.blatt).filter((v, i, arr) => arr.indexOf(v) === i).join(', ')}.\n\n` +
          `Denken Sie daran: Was Sie hier sagen, liest morgen die Mannschaft.`,
        kind: 'presse',
        aktionen: [{ id: 'pressekonferenz_oeffnen', label: 'Zur Pressekonferenz', data: {} }]
      });
    }
  }

  // --- Saisonende: großer Rückblick --------------------------------------
  const saisonEnde = (ctx && ctx.isSeasonEnd) || state.date.day === SAISON_TAGE.abschlussfeier;
  if (saisonEnde && p.rueckblickSaison !== state.date.season) {
    p.rueckblickSaison = state.date.season;
    post(state, ctx, clubId, {
      from: 'Fußball-Woche',
      subject: `Saisonrückblick ${state.date.season}`,
      body: saisonRueckblick(state, clubId),
      kind: 'presse', wichtig: true
    });
  }
}

export default {
  tickMedien, schlagzeilen, BLAETTER, pressekonferenz, antwortGeben,
  interviewSpieler, geruechtStreuen, medienDruck, saisonRueckblick, englischeWoche
};
