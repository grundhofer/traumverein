/**
 * club/karriere.js — Karriereenden, Regenerierung, Trainerlaufbahn, Chronik.
 * ============================================================================
 *
 * Das Modul, das eine Karriere über zehn Jahre erst möglich macht (Roadmap-
 * Stufe 1, Punkte 6–9). Es wird genau EINMAL pro Saison aufgerufen, aus
 * `core/loop.js:saisonWechsel()` heraus — nicht im Tagestakt. Es gibt deshalb
 * bewusst kein `tickKarriere()`: hier passiert nichts täglich.
 *
 * Die fünf Aufgaben:
 *
 *   1. Karriereenden    Wer hört auf? `p.retired` setzen, den Spieler sauber
 *                       aus Kader, Aufstellung und allen Listen entfernen.
 *   2. Regenerierung    Für jeden Abgang kommt jemand nach, sonst tropft die
 *                       Ligastärke über die Jahre weg.
 *   2b. Ausverkauf      Der Absteiger verliert seine Besten an den Aufsteiger.
 *                       Ohne das gleichen sich die beiden Ligen binnen weniger
 *                       Jahre an.
 *   3. Trainerlaufbahn  `manager.skills` wachsen zielgerichtet, `erfahrung`,
 *                       `level`, `reputation` und `titel` werden fortgeschrieben.
 *   4. Chronik          `history.titel[saison]` und `history.rekorde`.
 *
 * ZUSTÄNDIGKEIT (CONTRACTS.md §11 — dieses Modul ist der einzige Schreiber):
 *   player.retired                     Karriereende eines Spielers
 *   state.manager.skills/erfahrung/    Trainerentwicklung nach Saisonende
 *     level/titel/reputation/saisonstand
 *   state.history.titel                Titelchronik je Saison
 *   state.history.rekorde              Bestenlisten (Grundlage für Stufe 6)
 *
 * Fremde Felder werden nur dort angefasst, wo ein Rücktritt oder ein
 * Ligawechsel es erzwingt: `club.playerIds`, `club.tactics` (Aufstellung),
 * `club.youth.talente`, `club.transferliste`, `club.beobachtet`,
 * `club.gerüchte`, `club.kabine.mannschaftsrat`, `state.freeAgents` und die
 * Listen in `state.transfermarkt` (geruechte, offeneSpieler, verhandlungen) —
 * ein Spieler, der aufgehört hat, darf nirgendwo mehr als Geisterspieler
 * herumstehen.
 *
 * KEIN DOM, kein Math.random(), kein Date.now().
 *
 * ---------------------------------------------------------------------------
 * ANNAHMEN ÜBER FREMDE MODULE (weich angebunden, Fallback jeweils vorhanden —
 * dieselbe Bauweise wie in club/youth.js):
 *   data/generator.js  -> generateYouthProspect, generateFreeAgent, ovrForClub
 *   core/state.js      -> initPlayerRuntime(player, rng)
 * ---------------------------------------------------------------------------
 */

import { clamp, round, sortBy, formatMoney } from '../core/util.js';
import { createRng, hashString } from '../core/rng.js';
import { POSITION_NAMES, POSITION_GROUP } from '../core/constants.js';
import { playerOverall, marketValue } from '../engine/ratings.js';
import { LEAGUES, LEAGUE_IDS } from '../data/leagues.js';
import { deriveSalary } from '../data/squads/_helper.js';
import { buchen } from './finances.js';

/* ==========================================================================
 * 0. Weiche Anbindung an fremde Module
 * ======================================================================== */

let _gen = null, _stateMod = null;
try { _gen = await import('../data/generator.js'); } catch (e) { _gen = null; }
try { _stateMod = await import('../core/state.js'); } catch (e) { _stateMod = null; }

/** Ergänzt die Laufzeitfelder eines frisch erzeugten Spielers. */
function laufzeitfelder(p, rng) {
  if (_stateMod && typeof _stateMod.initPlayerRuntime === 'function') {
    return _stateMod.initPlayerRuntime(p, rng);
  }
  // Notfallpfad: nur so viel, dass kein anderes Modul über undefined stolpert.
  p.form = p.form !== undefined ? p.form : 50;
  p.morale = p.morale !== undefined ? p.morale : 68;
  p.fitness = 100;
  p.sharpness = 55;
  p.injury = null;
  p.cards = { yellow: 0, red: 0, ban: 0, seasonYellow: 0 };
  p.happiness = { spielzeit: 60, gehalt: 60, ambition: 60, trainer: 60, beschwerden: [] };
  p.training = { focus: null, gains: {}, intensitaet: 50, woche: 0 };
  p.stats = { season: leereStatzeile(), career: leereStatzeile(), history: [] };
  p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
  p.joined = { season: 1, day: 0 };
  p.captain = false;
  return p;
}

/** Spiegelt emptyStatLine() aus core/state.js (nur für den Notfallpfad). */
function leereStatzeile() {
  return {
    spiele: 0, startelf: 0, minuten: 0, tore: 0, vorlagen: 0, schuesse: 0,
    paraden: 0, gegentore: 0, zuNull: 0, zweikaempfe: 0, zweikaempfeGewonnen: 0,
    gelb: 0, gelbrot: 0, rot: 0, notenSumme: 0, notenAnzahl: 0, motm: 0
  };
}

/** Zielstärke eines Kaders aus der Vereinsreputation. */
function niveauVon(club) {
  if (_gen && typeof _gen.ovrForClub === 'function') return _gen.ovrForClub(club);
  const rep = clamp((club && club.reputation) || 50, 1, 100);
  return clamp(42 + rep * 0.38, 42, 86);
}

/* ==========================================================================
 * 1. BALANCING
 * ======================================================================== */

/**
 * Grundrisiko eines Karriereendes nach Alter (Wahrscheinlichkeit je Saison,
 * vor allen Modifikatoren). Bis 30 hört praktisch niemand auf, ab 38 wird es
 * eng, ab HART_SCHLUSS ist Feierabend — egal, wie gut einer noch ist.
 */
const ALTERSRISIKO = {
  30: 0.010, 31: 0.020, 32: 0.040, 33: 0.075, 34: 0.125,
  35: 0.200, 36: 0.300, 37: 0.420, 38: 0.580, 39: 0.750, 40: 0.900
};
const RUECKTRITT_AB = 30;      // darunter nur nach schwerem Dauerschaden
const HART_SCHLUSS = 41;       // mit 41 ist Schluss – ohne Ausnahme
const VERLETZUNGS_ENDE_AB = 27;// ab hier kann ein Körper auch früher aufgeben

/** Modifikatoren (multiplikativ auf das Grundrisiko). */
const M_QUALI_SOCKEL = 1.90;   // 1,90 − 0,016 × Gesamtstärke  ->  Weltklasse hört später auf
const M_QUALI_FAKTOR = 0.016;
const M_QUALI_MIN = 0.50, M_QUALI_MAX = 1.45;
const M_POTENZIAL = 0.85;      // wer noch Luft nach oben hat, macht weiter
const M_EINSATZ_SOCKEL = 1.65; // 1,65 − Minuten/1600  ->  wer nicht spielt, hört auf
const M_EINSATZ_MIN = 0.70, M_EINSATZ_MAX = 1.70;
const M_ANFAELLIGKEIT = 0.55;  // je Punkt medizin.anfaelligkeit (0..1)
const M_AUSFALLTAGE = 0.60;    // voll bei 200 Ausfalltagen in der Saison
const M_LANGZEIT = 0.14;       // je Langzeitschaden
const M_VERTRAG_AUS = 1.35;    // Vertrag läuft aus
const M_VERTRAG_LANG = 0.82;   // noch zwei Jahre oder mehr
const M_OHNE_VEREIN = 1.75;    // vertragslos
const M_LEGENDE = 0.80;        // Vereinslegenden machen länger

/** Abschiedsspiel: ab wann ist ein Spieler „verdient"? */
const ABSCHIED_JAHRE = 4;      // Jahre im Verein
const ABSCHIED_SPIELE = 110;   // Karrierespiele
const ABSCHIED_OVR = 76;       // oder schlicht: er war richtig gut

/** Regenerierung. */
const JUGEND_ANTEIL = 0.70;    // 70 % in die eigene Jugend, 30 % auf den Markt
const JUGEND_MAX = 14;         // Obergrenze des Nachwuchskaders (wie club/youth.js)
const KADER_MIN_PROFI = 20;    // darunter wird direkt nachverpflichtet (= MIN_KADER in club/transfers.js)
const KADER_MIN_AMATEUR = 18;  // Amateurkader entstehen mit 18 Mann (state.js:ensureSquad)
const KADER_MAX = 30;          // nie über diese Grenze auffüllen

/** Ausverkauf beim Absteiger: wie viele Spieler je Positionsgruppe tauschen. */
const TAUSCH_REIHENFOLGE = ['TW', 'ABW', 'MIT', 'STU'];
const TAUSCH_QUOTE = { TW: 1, ABW: 3, MIT: 3, STU: 2 };   // höchstens 9 je Paarung
const TAUSCH_MINDESTABSTAND = 2;   // darunter lohnt der Wechsel für niemanden

/** Trainerentwicklung. */
const SKILL_KEYS = ['training', 'taktik', 'motivation', 'verhandlung', 'jugend', 'medien'];
const SKILL_DECKE = 92;        // niemand wird perfekt
const SKILL_SOCKEL = 40;       // Bezugspunkt der Lernkurve
const SKILL_TEMPO = 6.8;       // Punkte je Saison bei voller Nutzung und vollem Erfolg
const SKILL_GEWICHT_SOCKEL = 0.30;
const SKILL_GEWICHT_NUTZUNG = 0.45;
const SKILL_GEWICHT_ERFOLG = 0.35;
const SKILL_GEWICHT_MIN = 0.22, SKILL_GEWICHT_MAX = 1.12;

const LEVEL_SCHWELLEN = [0, 150, 380, 700, 1120, 1650, 2300, 3080, 4000, 5100];
const LEVEL_NAMEN = [
  'Trainerneuling', 'Cheftrainer', 'Erfahrener Coach', 'Etablierter Trainer',
  'Ligagröße', 'Meistertrainer', 'Trainerfuchs', 'Grandseigneur',
  'Lebende Legende', 'Denkmal mit Trainingsanzug'
];

/**
 * Die Lizenzstufen des Verbands (Roadmap-Stufe 4, Punkt 5).
 *
 * Der Manager startet laut core/state.js mit der A-Lizenz — das ist Stufe 3.
 * Nach oben geht es über den Fußball-Lehrer, nach unten gar nicht: Eine Lizenz
 * ist kein Tabellenplatz, die nimmt einem niemand wieder weg.
 *
 * Die Stufe wird am Saisonende automatisch fortgeschrieben, sobald Erfahrung,
 * Stufe und Titel reichen. Sie kostet BEWUSST keine Fähigkeitspunkte: Der
 * Trainerbonus (loop.js:coachBonusOf) hat in tools/test-karriere.js Z07 einen
 * engen Korridor, und eine Urkunde macht keinen besseren Trainer. Wer schneller
 * besser werden will, belegt eine Fortbildung — die kostet Geld und ist
 * freiwillig.
 */
const LIZENZEN = [
  { stufe: 1, name: 'C-Lizenz', erfahrung: 0, level: 1, titel: 0,
    text: 'Kreisliga-Grundkurs. Man lernt, wie man Hütchen aufstellt.' },
  { stufe: 2, name: 'B-Lizenz', erfahrung: 200, level: 2, titel: 0,
    text: 'Zwei Wochen Sportschule, eine Prüfung, ein Zertifikat für den Flur.' },
  { stufe: 3, name: 'A-Lizenz', erfahrung: 500, level: 2, titel: 0,
    text: 'Damit darf man im Profibereich arbeiten. Damit fangen Sie an.' },
  { stufe: 4, name: 'Fußball-Lehrer', erfahrung: 1400, level: 4, titel: 0,
    text: 'Zehn Monate Köln, eine Abschlussarbeit und ein Titel, den man ein Leben lang trägt.' },
  { stufe: 5, name: 'Fußball-Lehrer mit Auszeichnung', erfahrung: 3200, level: 6, titel: 3,
    text: 'Der Verband lädt Sie inzwischen ein, damit SIE etwas erzählen.' }
];

/**
 * Trainerfortbildung — gebaut wie club/staff.js:KURSE, nur für den Manager.
 *
 * Unterschied zum Stab: Ein Lehrgang läuft hier über die ganze Saison und wird
 * beim Saisonwechsel abgeschlossen. Das passt zur Bauweise dieses Moduls (es
 * gibt bewusst kein tickKarriere) und zur Wirklichkeit — der Fußball-Lehrer
 * dauert zehn Monate, nicht zehn Tage.
 */
const FORTBILDUNGEN = [
  { id: 'trainingslehre', name: 'Trainingslehre-Seminar', skill: 'training', plus: 3, kosten: 22000,
    desc: 'Periodisierung, Belastungssteuerung, und warum Waldläufe im Juli niemandem helfen.' },
  { id: 'taktikseminar', name: 'Taktikseminar des Verbands', skill: 'taktik', plus: 3, kosten: 26000,
    desc: 'Drei Tage Videoraum. Kaffee schlecht, Erkenntnisse gut.' },
  { id: 'menschenfuehrung', name: 'Führungsseminar', skill: 'motivation', plus: 3, kosten: 24000,
    desc: 'Man lernt, wann man schreit — und dass es fast nie ist.' },
  { id: 'verhandlungsfuehrung', name: 'Verhandlungstraining', skill: 'verhandlung', plus: 3, kosten: 20000,
    desc: 'Beraterdeutsch für Fortgeschrittene, inklusive Vokabelliste.' },
  { id: 'nachwuchskonzept', name: 'Nachwuchskonzept-Werkstatt', skill: 'jugend', plus: 3, kosten: 18000,
    desc: 'Wie aus einem Talent ein Profi wird und aus zwanzig keiner.' },
  { id: 'medientraining', name: 'Medientraining', skill: 'medien', plus: 3, kosten: 16000,
    desc: 'Sie üben, dreißig Sekunden lang nichts zu sagen. Mit Kamera.' },
  { id: 'fussballlehrer', name: 'Fußball-Lehrer-Lehrgang', skill: 'taktik', plus: 5, kosten: 120000,
    lizenz: 4, desc: 'Zehn Monate Hennes-Weisweiler-Akademie. Danach heißen Sie anders.' },
  { id: 'hospitanz', name: 'Auslandshospitanz', skill: 'training', plus: 4, kosten: 45000,
    desc: 'Zwei Wochen zuschauen, mitschreiben und feststellen, dass die auch nur mit Wasser kochen.' }
];

/** Elf der Saison. */
const ELF_PLAN = { TW: 1, ABW: 4, MIT: 4, STU: 2 };
const ELF_MIN_SPIELE = 8;

/* ==========================================================================
 * 2. Kleine Helfer
 * ======================================================================== */

const nameVon = p => p ? `${p.firstName || ''} ${p.lastName || p.id}`.trim() : 'Unbekannt';
const kurzVon = p => p ? (p.shortName || p.lastName || p.id) : 'Unbekannt';
const vereinName = (state, id) => {
  const c = state.clubs[id];
  return c ? (c.name || c.shortName || id) : String(id);
};
const vereinKurz = (state, id) => {
  const c = state.clubs[id];
  return c ? (c.shortName || c.name || id) : String(id);
};

/** Deterministische Rng, auch wenn kein ctx mitkommt. */
function karriereRng(state, ctx, label) {
  if (ctx && ctx.rng && typeof ctx.rng.fork === 'function') return ctx.rng.fork('karriere:' + label);
  return createRng(hashString('karriere:' + label + ':' + state.seed + ':' + state.date.season));
}

/** Postfach — nur für den Verein des Spielers, wie in allen club/-Modulen. */
function log(state, ctx, clubId, text, kind, opts) {
  if (!ctx || typeof ctx.log !== 'function') return;
  if (clubId && clubId !== state.managerClubId) return;
  ctx.log(text, kind || 'karriere', opts || {});
}

/** Nachrichtenticker — der gilt bundesweit, nicht nur für den eigenen Verein. */
function news(state, ctx, text, kind) {
  if (!ctx || typeof ctx.news !== 'function') return;
  ctx.news(text, kind || 'karriere');
}

/**
 * Vereine einer Liga. Ab Stufe 1 ist `state.leagues` die Wahrheit; solange die
 * fehlt, wird über `club.leagueId` und zuletzt über die Vorlage aus
 * data/leagues.js zurückgefallen.
 */
export function ligaVereine(state, leagueId) {
  const eintrag = state.leagues && state.leagues[leagueId];
  if (eintrag && Array.isArray(eintrag.clubIds) && eintrag.clubIds.length) return eintrag.clubIds.slice();
  const ausClubs = Object.keys(state.clubs).filter(id => state.clubs[id].leagueId === leagueId);
  if (ausClubs.length) return ausClubs;
  return LEAGUES[leagueId] ? LEAGUES[leagueId].clubIds.slice() : [];
}

/** Alle Spieler einer oder mehrerer Ligen (nur Profikader, kein Nachwuchs). */
function ligaSpieler(state, leagueId) {
  const ligen = Array.isArray(leagueId) ? leagueId
    : (!leagueId || leagueId === 'alle') ? LEAGUE_IDS : [leagueId];
  const out = [];
  for (const lid of ligen) {
    for (const clubId of ligaVereine(state, lid)) {
      const club = state.clubs[clubId];
      if (!club || !Array.isArray(club.playerIds)) continue;
      for (const pid of club.playerIds) {
        const p = state.players[pid];
        if (p && !p.retired) out.push(p);
      }
    }
  }
  return out;
}

/** Statistikzeile der abgelaufenen Saison – immer vollständig, nie undefined. */
function saisonstat(p) {
  const s = (p.stats && p.stats.season) || {};
  return {
    spiele: s.spiele || 0, minuten: s.minuten || 0, tore: s.tore || 0,
    vorlagen: s.vorlagen || 0, motm: s.motm || 0, zuNull: s.zuNull || 0,
    notenSumme: s.notenSumme || 0, notenAnzahl: s.notenAnzahl || 0
  };
}

const durchschnittsnote = s => s.notenAnzahl ? s.notenSumme / s.notenAnzahl : 0;

/* ==========================================================================
 * 3. KARRIEREENDEN
 * ======================================================================== */

/**
 * Wahrscheinlichkeit, dass dieser Spieler nach der Saison aufhört (0..1).
 * Exportiert, weil der Kaderbildschirm sie später anzeigen soll („denkt ans
 * Aufhören") und weil sich so testen lässt, was sonst im Zufall verschwindet.
 */
export function ruecktrittsChance(state, p, saison) {
  if (!p || p.retired) return 0;
  const jahr = saison !== undefined ? saison : state.date.season;
  const alter = p.age || 0;
  if (alter >= HART_SCHLUSS) return 1;

  const med = p.medizin || {};
  const anfaellig = clamp(med.anfaelligkeit || 0, 0, 1);
  const ausfalltage = (med.ausfalltage && med.ausfalltage.saison) || 0;
  const langzeit = Array.isArray(med.langzeitschaeden) ? med.langzeitschaeden.length : 0;

  // Der Körper kann auch vor der Zeit aufgeben – aber nur nach echtem Schaden.
  if (alter < RUECKTRITT_AB) {
    if (alter < VERLETZUNGS_ENDE_AB || langzeit < 2 || anfaellig < 0.55) return 0;
    return clamp((anfaellig - 0.5) * 0.22 + langzeit * 0.02, 0, 0.28);
  }

  let p0 = ALTERSRISIKO[Math.min(40, alter)] || 0;
  if (!p0) return 0;

  const ovr = playerOverall(p);
  p0 *= clamp(M_QUALI_SOCKEL - ovr * M_QUALI_FAKTOR, M_QUALI_MIN, M_QUALI_MAX);
  if ((p.potential || ovr) - ovr >= 4) p0 *= M_POTENZIAL;

  const st = saisonstat(p);
  p0 *= clamp(M_EINSATZ_SOCKEL - st.minuten / 1600, M_EINSATZ_MIN, M_EINSATZ_MAX);

  p0 *= 1 + anfaellig * M_ANFAELLIGKEIT
    + clamp(ausfalltage / 200, 0, 1) * M_AUSFALLTAGE
    + langzeit * M_LANGZEIT;

  const rest = p.clubId && p.contract ? (p.contract.until || 0) - jahr : -1;
  if (!p.clubId) p0 *= M_OHNE_VEREIN;
  else if (rest <= 0) p0 *= M_VERTRAG_AUS;
  else if (rest >= 2) p0 *= M_VERTRAG_LANG;

  // Persönlichkeit: Vereinstreue hängen dran, Geschäftsleute gehen früher.
  const pers = p.personality || {};
  p0 *= clamp(1.18 - (pers.loyalty !== undefined ? pers.loyalty : 1) * 0.16, 0.82, 1.22);
  p0 *= clamp(0.94 + (pers.ambition !== undefined ? pers.ambition : 1) * 0.06, 0.94, 1.12);

  if (p.era === 'legend') p0 *= M_LEGENDE;

  return clamp(p0, 0, 1);
}

const GRUND_TEXTE = {
  alter: 'Alter',
  koerper: 'Der Körper macht nicht mehr mit',
  verletzung: 'Dauerverletzung',
  ohne_einsatz: 'Keine Spielzeit mehr',
  ohne_verein: 'Kein Verein mehr',
  schluss: 'Endgültig Schluss'
};

function grundFuer(state, p) {
  const alter = p.age || 0;
  const med = p.medizin || {};
  const langzeit = Array.isArray(med.langzeitschaeden) ? med.langzeitschaeden.length : 0;
  const ausfall = (med.ausfalltage && med.ausfalltage.saison) || 0;
  const st = saisonstat(p);

  if (alter >= HART_SCHLUSS) return 'schluss';
  if (langzeit >= 2 || ausfall >= 120 || (med.anfaelligkeit || 0) >= 0.6) {
    return alter < RUECKTRITT_AB ? 'verletzung' : 'koerper';
  }
  if (!p.clubId) return 'ohne_verein';
  if (st.minuten < 300 && alter >= 33) return 'ohne_einsatz';
  return 'alter';
}

/** Ist der Spieler eine verdiente Größe seines Vereins? */
function verdient(state, p) {
  if (p.era === 'legend') return true;
  const carr = (p.stats && p.stats.career) || {};
  const jahre = p.joined ? Math.max(0, state.date.season - (p.joined.season || state.date.season)) : 0;
  if (jahre >= ABSCHIED_JAHRE && (carr.spiele || 0) >= 60) return true;
  if ((carr.spiele || 0) >= ABSCHIED_SPIELE) return true;
  return playerOverall(p) >= ABSCHIED_OVR;
}

/** Entfernt den Spieler aus jeder Liste, in der er noch stehen könnte. */
function ausAllenListen(state, p) {
  const club = p.clubId ? state.clubs[p.clubId] : null;

  if (club) {
    if (Array.isArray(club.playerIds)) club.playerIds = club.playerIds.filter(id => id !== p.id);
    if (club.youth && Array.isArray(club.youth.talente)) {
      club.youth.talente = club.youth.talente.filter(id => id !== p.id);
    }
    if (club.youth && Array.isArray(club.youth.jahrgang)) {
      club.youth.jahrgang = club.youth.jahrgang.filter(id => id !== p.id);
    }
    if (Array.isArray(club.transferliste)) club.transferliste = club.transferliste.filter(id => id !== p.id);
    if (Array.isArray(club.beobachtet)) {
      club.beobachtet = club.beobachtet.filter(e => (e && e.playerId ? e.playerId : e) !== p.id);
    }
    if (club.kabine && Array.isArray(club.kabine.mannschaftsrat)) {
      club.kabine.mannschaftsrat = club.kabine.mannschaftsrat.filter(id => id !== p.id);
    }
    aufstellungBereinigen(club, p.id);
  }

  // Auch jeder fremde Verein könnte ihn beobachten oder auf der Liste haben.
  for (const id in state.clubs) {
    const c = state.clubs[id];
    if (Array.isArray(c.beobachtet) && c.beobachtet.length) {
      c.beobachtet = c.beobachtet.filter(e => (e && e.playerId ? e.playerId : e) !== p.id);
    }
    // Gerüchteküche: club/transfers.js legt jeden Eintrag doppelt ab, einmal
    // beim Verein und einmal im Markt. Beide Kopien müssen weg – sonst steht
    // wochenlang ein Wechselgerücht über einen Spieler in der Zeitung, der
    // längst aufgehört hat.
    if (Array.isArray(c['gerüchte']) && c['gerüchte'].length) {
      c['gerüchte'] = c['gerüchte'].filter(e => !e || e.playerId !== p.id);
    }
  }

  const tm = state.transfermarkt;
  if (tm) {
    if (Array.isArray(tm.geruechte)) tm.geruechte = tm.geruechte.filter(e => !e || e.playerId !== p.id);
    if (Array.isArray(tm.offeneSpieler)) tm.offeneSpieler = tm.offeneSpieler.filter(id => id !== p.id);
    if (Array.isArray(tm.verhandlungen)) tm.verhandlungen = tm.verhandlungen.filter(v => !v || v.playerId !== p.id);
  }

  if (Array.isArray(state.freeAgents)) state.freeAgents = state.freeAgents.filter(id => id !== p.id);

  // Mentorenbindung (club/chemie.js): Wer aufhört, wird von niemandem mehr
  // erzogen. Der Eintrag muss HIER weg — club/chemie.js:mentorenPflegen läuft
  // über club.playerIds, und da steht er ab jetzt nicht mehr drin.
  // `p.mentees` bleibt absichtlich stehen: Der Zögling löst das Paar beim
  // nächsten Tageslauf selbst und erbt dabei die Rückennummer (erbeAntreten).
  if (p.mentor && p.mentor.mentorId) {
    const lehrer = state.players[p.mentor.mentorId];
    if (lehrer && Array.isArray(lehrer.mentees)) {
      lehrer.mentees = lehrer.mentees.filter(id => id !== p.id);
    }
    p.mentor = null;
  }

  p.clubId = null;
  p.captain = false;
  if (p.transfer) p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
  p.jugend = false;
}

/**
 * Streicht einen Spieler aus Aufstellung, Bank, Standards und Rollen.
 * Ohne das stünde er als Geisterspieler in der Elf und die Engine bekäme
 * beim nächsten Anpfiff zehn Feldspieler und ein Loch.
 */
export function aufstellungBereinigen(club, playerId) {
  const t = club && club.tactics;
  if (!t) return false;
  let getroffen = false;

  if (t.lineup && typeof t.lineup === 'object') {
    for (const slot in t.lineup) {
      if (t.lineup[slot] === playerId) { delete t.lineup[slot]; getroffen = true; }
    }
  }
  if (Array.isArray(t.bench) && t.bench.includes(playerId)) {
    t.bench = t.bench.filter(id => id !== playerId);
    getroffen = true;
  }
  if (t.setPieces && typeof t.setPieces === 'object') {
    for (const k in t.setPieces) {
      if (t.setPieces[k] === playerId) { t.setPieces[k] = null; getroffen = true; }
    }
  }
  if (t.roles && typeof t.roles === 'object' && t.roles[playerId] !== undefined) {
    delete t.roles[playerId];
    getroffen = true;
  }
  if (t.manMarking) {
    if (t.manMarking === playerId) { t.manMarking = null; getroffen = true; }
    else if (typeof t.manMarking === 'object') {
      for (const k in t.manMarking) {
        if (k === playerId || t.manMarking[k] === playerId) { delete t.manMarking[k]; getroffen = true; }
      }
    }
  }
  return getroffen;
}

/**
 * Verdichtet den Datensatz eines Spielers, der aufgehört hat: Protokolle raus,
 * Identität und Karrierezahlen bleiben. Siehe ROADMAP 5.7 — ein Spieler, der
 * 2015 aufgehört hat, gehört als Zeile in die Chronik, nicht als vollständiger
 * Datensatz mit zwanzig Attributen in den Spielstand.
 */
function verdichten(p) {
  if (p.medizin) {
    p.medizin.historie = [];
    p.medizin.einsaetze = [];
    p.medizin.langzeitschaeden = [];
    p.medizin.gespritzt = null;
  }
  if (p.happiness) { p.happiness.beschwerden = []; p.happiness.gruende = []; p.happiness.gespraeche = {}; }
  if (p.training) { p.training.gains = {}; p.training.fortschritt = null; p.training.focus = null; }
  if (p.stats && Array.isArray(p.stats.history) && p.stats.history.length > 3) {
    p.stats.history = p.stats.history.slice(-3);
  }
  p.nachwuchs = null;
  p.injury = null;
  if (p.cards) p.cards = { yellow: 0, red: 0, ban: 0, seasonYellow: 0 };
}

/**
 * Karriereenden einer Saison.
 *
 * @param {object} state
 * @param {object} ctx    { rng, season, log, news } — alles optional
 * @returns {{ ruecktritte: Array }}
 */
export function karriereenden(state, ctx) {
  const saison = (ctx && ctx.season !== undefined) ? ctx.season : state.date.season;
  const meineId = state.managerClubId;
  const ruecktritte = [];

  // Stabile Reihenfolge: der Spielstand darf nach dem Laden nicht anders
  // würfeln als vor dem Speichern.
  const ids = Object.keys(state.players).sort();
  const vertragslos = new Set(state.freeAgents || []);

  for (const pid of ids) {
    const p = state.players[pid];
    if (!p || p.retired) continue;
    if (p.jugend) continue;                        // Nachwuchs hört nicht auf, er wächst
    if (!p.clubId && !vertragslos.has(p.id)) continue;

    const chance = ruecktrittsChance(state, p, saison);
    if (chance <= 0) continue;
    const rng = karriereRng(state, ctx, 'ende:' + saison + ':' + p.id);
    if (chance < 1 && !rng.chance(chance)) continue;

    const clubId = p.clubId || null;
    const grundKey = grundFuer(state, p);
    const legende = p.era === 'legend';
    const eigen = clubId === meineId;
    const ehrenvoll = legende || (eigen && verdient(state, p));

    const eintrag = {
      playerId: p.id,
      name: nameVon(p),
      kurzName: kurzVon(p),
      clubId,
      clubName: clubId ? vereinName(state, clubId) : null,
      alter: p.age,
      position: p.position,
      ovr: playerOverall(p),
      spiele: (p.stats && p.stats.career && p.stats.career.spiele) || 0,
      tore: (p.stats && p.stats.career && p.stats.career.tore) || 0,
      grund: GRUND_TEXTE[grundKey],
      grundKey,
      legende,
      abschiedsspiel: ehrenvoll,
      text: ''
    };

    p.retired = { season: saison, alter: p.age, grund: GRUND_TEXTE[grundKey], grundKey, clubId, legende };

    ausAllenListen(state, p);
    verdichten(p);

    eintrag.text = abschiedsbericht(state, eintrag);
    ruecktritte.push(eintrag);

    // --- Öffentlichkeit -----------------------------------------------------
    //
    // Ins Postfach kommt nur, was den eigenen Verein betrifft — sonst läge nach
    // der Saison des großen Generationswechsels dreißigmal dieselbe Nachricht
    // im Eingang. Fremde Legenden laufen über den Ticker.
    if (eigen) {
      log(state, ctx, meineId, eintrag.text, 'karriere', {
        from: 'Geschäftsstelle',
        subject: ehrenvoll ? `Abschiedsspiel: ${eintrag.kurzName}` : `Karriereende: ${eintrag.kurzName}`,
        wichtig: ehrenvoll
      });
      news(state, ctx,
        `${eintrag.kurzName} (${eintrag.alter}) beendet seine Karriere` +
        (ehrenvoll && clubId ? ` — ${vereinKurz(state, clubId)} plant ein Abschiedsspiel.` : '.'), 'info');
    } else if (legende) {
      news(state, ctx,
        `Ende einer Ära: ${eintrag.kurzName} (${eintrag.alter}) hört auf. ` +
        (clubId ? `${vereinKurz(state, clubId)} plant ein Abschiedsspiel.` : ''), 'info');
    }
  }

  return { ruecktritte };
}

/* ==========================================================================
 * 3b. Der Text fürs Postfach
 * ======================================================================== */

const ABSCHIED_LEGENDE = [
  'Es gibt Spieler, die man vermisst, und es gibt Spieler, bei denen man das Stadion vermisst, sobald sie nicht mehr drin stehen.',
  'Man wird noch in zwanzig Jahren an der Theke von ihm erzählen — und die Geschichten werden jedes Jahr besser.',
  'Die Kurve hat schon angekündigt, dass sie das Abschiedsspiel ausverkauft. Wir glauben ihr aufs Wort.'
];
const ABSCHIED_VERDIENT = [
  'Kein Weltstar, aber einer, auf den man sich verlassen konnte. Davon gibt es zu wenige.',
  'Er hat hier mehr Wochenenden verbracht als zu Hause. Das darf man ruhig einmal sagen.',
  'Die Mannschaft hat sich in der Kabine erhoben. So etwas kann man nicht anordnen.'
];
const ABSCHIED_NORMAL = [
  'Ein Profileben, das niemand in der Sportschau zusammenfassen wird — aber eines, das sich gelohnt hat.',
  'Er geht ohne großes Aufheben. Genau so, wie er die letzten Jahre gespielt hat.',
  'Von hier aus: alles Gute. Der Platz an der Bande ist übrigens noch frei.'
];
const ABSCHIED_KOERPER = [
  'Der Körper hatte das letzte Wort. Er hat es lange genug hinausgezögert.',
  'Zwei Knie, ein Rücken, elf Jahre. Die Rechnung geht irgendwann nicht mehr auf.',
  'Die Ärzte haben genickt, er hat genickt. Mehr gab es dazu nicht zu sagen.'
];
const ABSCHIED_OHNE_VEREIN = [
  'Sechs Monate lang hat das Telefon nicht geklingelt. Irgendwann versteht man den Wink.',
  'Er wartet nicht länger auf ein Angebot, das ohnehin niemand mehr schreiben wollte.',
  'Ohne Verein, ohne Vorbereitung, ohne Aussicht — da hört man lieber selbst auf.'
];

/**
 * Deutscher Text fürs Postfach zu einem Karriereende.
 * @param {object} ruecktritt  Eintrag aus karriereenden()
 */
export function abschiedsbericht(state, ruecktritt) {
  if (!ruecktritt) return '';
  const r = ruecktritt;
  const rng = createRng(hashString('abschied:' + r.playerId + ':' + (r.alter || 0)));
  const pos = POSITION_NAMES[r.position] || 'Fußballer';
  const verein = r.clubName || 'seinem letzten Verein';

  const zahlen = r.spiele
    ? `${r.spiele} Pflichtspiel${r.spiele === 1 ? '' : 'e'}, ${r.tore} Tor${r.tore === 1 ? '' : 'e'}`
    : 'eine Karriere, die die Statistik nur unvollständig abbildet';

  let schluss;
  if (r.grundKey === 'koerper' || r.grundKey === 'verletzung') schluss = rng.pick(ABSCHIED_KOERPER);
  else if (r.grundKey === 'ohne_verein') schluss = rng.pick(ABSCHIED_OHNE_VEREIN);
  else if (r.legende) schluss = rng.pick(ABSCHIED_LEGENDE);
  else if (r.abschiedsspiel) schluss = rng.pick(ABSCHIED_VERDIENT);
  else schluss = rng.pick(ABSCHIED_NORMAL);

  const kopf = r.legende
    ? `${r.name} (${r.alter}) hängt die Schuhe an den Nagel.`
    : `${r.name} (${r.alter}), ${pos}, beendet seine Laufbahn.`;

  const mitte = r.clubId
    ? `Zuletzt stand er bei ${verein} unter Vertrag. Unterm Strich: ${zahlen}.`
    : `Er war zuletzt ohne Verein. Unterm Strich: ${zahlen}.`;

  const abschied = r.abschiedsspiel
    ? `\n\nEin Abschiedsspiel ist beschlossene Sache: Der Verein lädt zum Benefizkick, ` +
    `die alten Kollegen kommen mit Bauch und Erinnerungen, und am Ende weint die Kurve mehr als er.`
    : '';

  return `${kopf}\n\n${mitte} ${schluss}${abschied}`;
}

/* ==========================================================================
 * 4. REGENERIERUNG
 * ======================================================================== */

/** Positionsgruppe, in der dem Verein am meisten fehlt. */
function positionsBedarf(state, club, rng) {
  const soll = { TW: 3, ABW: 8, MIT: 8, STU: 5 };
  const ist = { TW: 0, ABW: 0, MIT: 0, STU: 0 };
  for (const pid of club.playerIds || []) {
    const p = state.players[pid];
    if (!p || p.retired) continue;
    const g = POSITION_GROUP[p.position] || 'MIT';
    ist[g]++;
  }
  const gruppen = ['TW', 'ABW', 'MIT', 'STU'];
  const luecken = gruppen.map(g => ({ g, fehlt: soll[g] - ist[g] }));
  const maxFehlt = Math.max(...luecken.map(l => l.fehlt));
  const kandidaten = luecken.filter(l => l.fehlt >= Math.max(0, maxFehlt));
  const gruppe = (kandidaten.length ? rng.pick(kandidaten) : rng.pick(luecken)).g;

  const positionen = {
    TW: ['TW'],
    ABW: ['IV', 'IV', 'LV', 'RV'],
    MIT: ['ZM', 'DM', 'OM', 'LM', 'RM'],
    STU: ['ST', 'ST', 'LA', 'RA']
  };
  return rng.pick(positionen[gruppe]);
}

/** Nachwuchsspieler auf dem Niveau des Vereins. */
function talentFuer(state, club, rng) {
  const niveau = niveauVon(club);
  const position = positionsBedarf(state, club, rng);
  const alter = rng.int(15, 17);
  const ovr = clamp(Math.round(niveau * 0.52 + rng.gauss(4, 3.2)), 22, 54);
  const pot = clamp(Math.round(niveau + rng.gauss(3, 6.5)), ovr + 8, 92);

  let p;
  if (_gen && typeof _gen.generateYouthProspect === 'function') {
    p = _gen.generateYouthProspect(rng, club, {
      age: alter, ovr, pot, position,
      until: state.date.season + rng.int(2, 4)
    });
  } else {
    return null;
  }
  p.clubId = club.id;
  eindeutigeId(state, p);
  laufzeitfelder(p, rng);
  p.jugend = true;
  p.eigengewaechs = true;
  p.joined = { season: state.date.season, day: 0 };
  p.regeneriert = { season: state.date.season, herkunft: 'jugend' };
  return p;
}

/** Vertragsloser Spieler, der auf dem Markt landet. */
function freierSpielerFuer(state, club, rng) {
  const niveau = club ? niveauVon(club) : 58;
  const alter = rng.chance(0.65) ? rng.int(19, 25) : rng.int(26, 30);
  const ovr = clamp(Math.round(niveau - rng.float(3, 11)), 34, 78);

  let p;
  if (_gen && typeof _gen.generateFreeAgent === 'function') {
    p = _gen.generateFreeAgent(rng, { age: alter, ovr });
  } else {
    return null;
  }
  p.clubId = null;
  eindeutigeId(state, p);
  laufzeitfelder(p, rng);
  p.regeneriert = { season: state.date.season, herkunft: 'markt' };
  return p;
}

/**
 * Sichert zu, dass die Spieler-ID im Spielstand noch frei ist. Die Suffixe aus
 * data/generator.js sind kurz; über zehn Saisons kommt sonst irgendwann eine
 * Dublette – und die überschriebe lautlos einen bestehenden Spieler.
 */
function eindeutigeId(state, p) {
  if (!state.players[p.id]) return p;
  const basis = p.id;
  let n = 2;
  while (state.players[`${basis}_${n}`] && n < 500) n++;
  p.id = `${basis}_${n}`;
  return p;
}

/** Freie Rückennummer im Verein. */
function freieNummer(state, club, position) {
  const belegt = new Set();
  for (const pid of club.playerIds || []) {
    const p = state.players[pid];
    if (p && p.number) belegt.add(p.number);
  }
  let n = position === 'TW' ? 12 : 17;
  while (belegt.has(n) && n < 60) n++;
  return n;
}

/**
 * Direkte Nachverpflichtung: kommt nur zum Zug, wenn ein Kader unter die
 * Mindestgröße rutscht. Ohne diesen Notnagel würden Kader über zehn Saisons
 * ausbluten — die 70 % Jugendspieler brauchen drei bis fünf Jahre, bis sie
 * club/youth.js in den Profikader hochzieht.
 */
function nachverpflichten(state, club, rng) {
  const p = freierSpielerFuer(state, club, rng);
  if (!p) return null;
  const ovr = playerOverall(p);
  p.clubId = club.id;
  p.value = marketValue(p);
  p.contract = {
    // Mit `club`: Nachverpflichtungen folgen derselben Gehaltsskala wie die
    // Kaderdaten (data/squads/_helper.js) – sonst importiert der Notnagel jede
    // Saison wieder Weltmarktgehälter in kleine Vereine.
    salary: Math.max(60000, Math.round(deriveSalary(ovr, p.value, p.age, club) / 10000) * 10000),
    until: state.date.season + rng.int(2, 4),
    signOn: 0,
    releaseClause: null
  };
  p.number = freieNummer(state, club, p.position);
  p.joined = { season: state.date.season, day: 0 };
  p.regeneriert = { season: state.date.season, herkunft: 'nachverpflichtet' };
  state.players[p.id] = p;
  club.playerIds.push(p.id);
  return p;
}

/**
 * Regenerierung nach den Karriereenden.
 *
 * @param {object} state
 * @param {object} ctx    { rng, season, log, news }
 * @param {object} opts   { ruecktritte, jugendAnteil, auffuellen, kaderMin }
 * @returns {{ neu: string[], jugend: number, freieSpieler: number, nachverpflichtet: number }}
 */
export function regenerieren(state, ctx, opts = {}) {
  const o = opts || {};
  const saison = (ctx && ctx.season !== undefined) ? ctx.season : state.date.season;
  const jugendAnteil = o.jugendAnteil !== undefined ? clamp(o.jugendAnteil, 0, 1) : JUGEND_ANTEIL;
  const auffuellen = o.auffuellen !== false;

  // Abgänge: entweder übergeben oder aus den Rücktritten dieser Saison gelesen.
  let abgaenge = Array.isArray(o.ruecktritte) ? o.ruecktritte
    : Array.isArray(o.abgaenge) ? o.abgaenge : null;
  if (!abgaenge) {
    abgaenge = [];
    for (const pid of Object.keys(state.players).sort()) {
      const p = state.players[pid];
      if (p && p.retired && p.retired.season === saison) {
        abgaenge.push({ playerId: p.id, clubId: p.retired.clubId || null });
      }
    }
  }

  const ergebnis = { neu: [], jugend: 0, freieSpieler: 0, nachverpflichtet: 0 };
  const profiClubs = Object.keys(state.clubs)
    .filter(id => !state.clubs[id].lazySquad)
    .sort();

  /* --- 1. Ein Nachrücker je Abgang -------------------------------------- */
  let i = 0;
  for (const ab of abgaenge) {
    const rng = karriereRng(state, ctx, 'regen:' + saison + ':' + (ab.playerId || i));
    i++;
    let club = ab.clubId ? state.clubs[ab.clubId] : null;
    if (club && club.lazySquad) club = null;
    // Vereinslose Abgänge: der Markt füllt sich beim nächstbesten Ausbilder auf.
    if (!club && profiClubs.length) club = state.clubs[rng.pick(profiClubs)];
    if (!club) continue;

    const y = club.youth || (club.youth = { akademie: 50, talente: [], scoutingRegionen: [], naechsteSichtung: 0, jahrgang: [] });
    if (!Array.isArray(y.talente)) y.talente = [];

    const inJugend = rng.chance(jugendAnteil) && y.talente.length < JUGEND_MAX;
    const p = inJugend ? talentFuer(state, club, rng) : freierSpielerFuer(state, club, rng);
    if (!p) continue;

    state.players[p.id] = p;
    if (inJugend) {
      y.talente.push(p.id);
      ergebnis.jugend++;
    } else {
      state.freeAgents = state.freeAgents || [];
      state.freeAgents.push(p.id);
      ergebnis.freieSpieler++;
    }
    ergebnis.neu.push(p.id);
  }

  /* --- 2. Notnagel: kein Kader darf unter die Mindestgröße fallen -------- */
  if (auffuellen) {
    for (const clubId of profiClubs) {
      const club = state.clubs[clubId];
      if (!Array.isArray(club.playerIds)) continue;
      const min = o.kaderMin !== undefined ? o.kaderMin
        : (club.istAmateur ? KADER_MIN_AMATEUR : KADER_MIN_PROFI);
      let versuche = 0, geholt = 0;
      while (club.playerIds.length < Math.min(min, KADER_MAX) && versuche < 14) {
        const rng = karriereRng(state, ctx, 'auffuellen:' + saison + ':' + clubId + ':' + versuche);
        versuche++;
        const p = nachverpflichten(state, club, rng);
        if (!p) break;
        ergebnis.neu.push(p.id);
        ergebnis.nachverpflichtet++;
        geholt++;
      }
      if (geholt && clubId === state.managerClubId) {
        log(state, ctx, clubId,
          `Der Kader war nach den Karriereenden zu dünn für einen geordneten Spielbetrieb. ` +
          `Die Geschäftsstelle hat ${geholt} vertragslose${geholt === 1 ? 'n Spieler' : ' Spieler'} verpflichtet — ` +
          `keine Weltstars, aber elf Mann müssen nun einmal auf dem Platz stehen.`,
          'transfer', { from: 'Geschäftsstelle', subject: 'Kader aufgefüllt' });
      }
    }
  }

  return ergebnis;
}

/* ==========================================================================
 * 4b. KADERFOLGEN DES LIGAWECHSELS
 * ======================================================================== */

/**
 * Der Ausverkauf beim Absteiger.
 *
 * Ohne diese Regel gleichen sich die beiden Ligen binnen weniger Jahre an: Der
 * Aufsteiger bringt seinen Zweitligakader mit nach oben, der Absteiger nimmt
 * seinen Erstligakader mit nach unten, und nach zehn Jahren ist die 1. Liga
 * genauso stark wie die 2. — messbar in tools/test-saison.js (Z14).
 *
 * In Wirklichkeit hält das Geld die Klassen auseinander: Wer absteigt, kann
 * seine Erstligagehälter nicht mehr zahlen und verliert seine Besten; wer
 * aufsteigt, bedient sich genau dort. Das bildet diese Funktion nach — als
 * Tauschgeschäft zwischen Aufsteiger und Absteiger, Position gegen Position.
 * Die hohen Gehälter wandern dabei mit nach oben, die billigen nach unten;
 * das ist der eigentliche Grund, warum der Tausch für beide Seiten aufgeht.
 *
 * AUSGENOMMEN sind Vereinslegenden (era === 'legend'). Sie sind der Kern des
 * Spiels: Jeder Verein tritt mit seiner eigenen Geschichte an. Ein Uwe Seeler,
 * der beim Abstieg automatisch zum Aufsteiger wechselt, wäre das Gegenteil
 * davon — und seit Roadmap-Stufe 5 hätte es beide Richtungen getroffen, weil
 * auch die 2. Liga handgepflegte Legendenkader hat. Gemessen vor der Reparatur:
 * 13 von 50 Wechseln je Saison waren Legenden, darunter Mattuschka (Union),
 * Klasnic (St. Pauli) und Schnatterer (Heidenheim). Der Tausch findet deshalb
 * nur noch unter den aktuellen Spielern statt; das reicht, um die Ligastärken
 * auseinanderzuhalten (test-saison.js Z14, test-karriere.js Z14).
 *
 * Bewusst fließt kein Geld: Es ist ein Tausch, und die Wirtschaftsbalance
 * gehört club/finances.js, nicht diesem Modul.
 *
 * @param {object} state
 * @param {object} ctx      { rng, season, log, news } — alles optional
 * @param {object} bericht  { aufsteiger:[clubId], absteiger:[clubId] }
 * @returns {{ wechsel: Array }}
 */
export function ligawechselKader(state, ctx, bericht) {
  const ergebnis = { wechsel: [] };
  const b = bericht || {};
  const auf = Array.isArray(b.aufsteiger) ? b.aufsteiger : [];
  const ab = Array.isArray(b.absteiger) ? b.absteiger : [];
  const saison = (ctx && ctx.season !== undefined) ? ctx.season : state.date.season;

  for (let i = 0; i < Math.min(auf.length, ab.length); i++) {
    const oben = state.clubs[auf[i]];      // frisch aufgestiegen
    const unten = state.clubs[ab[i]];      // frisch abgestiegen
    if (!oben || !unten || oben.lazySquad || unten.lazySquad) continue;
    if (!Array.isArray(oben.playerIds) || !Array.isArray(unten.playerIds)) continue;

    const getauscht = [];
    for (const gruppe of TAUSCH_REIHENFOLGE) {
      // Der Absteiger gibt seine Besten ab, der Aufsteiger seine Schwächsten —
      // je Positionsgruppe, damit hinterher beide Kader ausgewogen bleiben und
      // niemand ohne Torhüter dasteht.
      const gehen = gruppeSortiert(state, unten, gruppe, true);
      const kommen = gruppeSortiert(state, oben, gruppe, false);
      const anzahl = Math.min(TAUSCH_QUOTE[gruppe], gehen.length - 1, kommen.length - 1);
      for (let j = 0; j < anzahl; j++) {
        const stark = gehen[j], schwach = kommen[j];
        if (playerOverall(stark) <= playerOverall(schwach) + TAUSCH_MINDESTABSTAND) break;
        vereinWechseln(state, stark, unten, oben, saison);
        vereinWechseln(state, schwach, oben, unten, saison);
        getauscht.push({ rauf: stark, runter: schwach });
        ergebnis.wechsel.push(
          { playerId: stark.id, von: unten.id, nach: oben.id, richtung: 'rauf' },
          { playerId: schwach.id, von: oben.id, nach: unten.id, richtung: 'runter' });
      }
    }
    if (!getauscht.length) continue;

    oben.chemistryHistory = clamp((oben.chemistryHistory || 30) - 4, 0, 100);
    unten.chemistryHistory = clamp((unten.chemistryHistory || 30) - 4, 0, 100);

    const besterRauf = sortBy(getauscht.map(t => t.rauf), p => ({ key: playerOverall(p), desc: true }))[0];
    news(state, ctx,
      `Aufsteiger ${vereinKurz(state, oben.id)} bedient sich beim Absteiger: ` +
      `${getauscht.length} Spieler wechseln von ${vereinKurz(state, unten.id)} nach oben, ` +
      `${getauscht.length} den umgekehrten Weg. Prominentester Name: ${nameVon(besterRauf)}.`,
      'transfer');

    if (unten.id === state.managerClubId) {
      log(state, ctx, unten.id,
        `Der Abstieg kostet uns nicht nur die Fernsehgelder, sondern auch den halben Kader.\n\n` +
        `${getauscht.map(t => `${nameVon(t.rauf)} → ${vereinKurz(state, oben.id)}`).join('\n')}\n\n` +
        `Im Gegenzug kommen ${getauscht.length} Spieler, die oben keine Rolle mehr gespielt haben. ` +
        `Die Gehaltsliste sieht danach deutlich freundlicher aus. Die Aufstellung leider nicht.`,
        'transfer', { from: 'Geschäftsstelle', subject: 'Ausverkauf nach dem Abstieg', wichtig: true });
    } else if (oben.id === state.managerClubId) {
      log(state, ctx, oben.id,
        `Erste Liga heißt erste Liga — und das gilt auch für den Kader.\n\n` +
        `${getauscht.map(t => `${nameVon(t.rauf)} ← ${vereinKurz(state, unten.id)}`).join('\n')}\n\n` +
        `Bezahlt wird das mit ${getauscht.length} Spielern, die den Weg nach unten antreten, ` +
        `und mit einer Gehaltsliste, die jetzt aussieht wie die eines Erstligisten. Ist ja auch einer.`,
        'transfer', { from: 'Geschäftsstelle', subject: 'Verstärkung für die 1. Liga', wichtig: true });
    }
  }

  return ergebnis;
}

/**
 * Spieler einer Positionsgruppe, nach Stärke sortiert (absteigend oder aufsteigend).
 * Vereinslegenden bleiben außen vor — sie gehören zum Verein, nicht zur Liga
 * (siehe ligawechselKader).
 */
function gruppeSortiert(state, club, gruppe, beste) {
  const out = [];
  for (const pid of club.playerIds) {
    const p = state.players[pid];
    if (!p || p.retired) continue;
    if (p.era === 'legend') continue;
    if ((POSITION_GROUP[p.position] || 'MIT') !== gruppe) continue;
    out.push(p);
  }
  return sortBy(out, p => beste ? ({ key: playerOverall(p), desc: true }) : playerOverall(p), p => p.id);
}

/** Vereinswechsel ohne Ablöse: aus allen Listen des alten Vereins, in den neuen. */
function vereinWechseln(state, p, alt, neu, saison) {
  alt.playerIds = alt.playerIds.filter(id => id !== p.id);
  if (Array.isArray(alt.transferliste)) alt.transferliste = alt.transferliste.filter(id => id !== p.id);
  if (alt.kabine && Array.isArray(alt.kabine.mannschaftsrat)) {
    alt.kabine.mannschaftsrat = alt.kabine.mannschaftsrat.filter(id => id !== p.id);
  }
  // Beobachtungslisten bleiben absichtlich unangetastet: Wer einen Spieler
  // scoutet, verliert ihn nicht aus den Augen, nur weil er den Verein wechselt.
  aufstellungBereinigen(alt, p.id);

  p.number = freieNummer(state, neu, p.position);   // vor dem Einreihen, sonst zählt die alte Nummer mit
  neu.playerIds.push(p.id);
  p.clubId = neu.id;
  p.captain = false;
  p.joined = { season: saison + 1, day: 0 };
  p.seasonsAtClub = 0;
  p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
  // Der Vertrag zieht mit um — samt Gehalt. Nur auslaufen darf er nicht sofort,
  // sonst löst core/loop.js:vertraegeFortschreiben ihn im nächsten Sommer auf,
  // bevor der Spieler ein einziges Mal aufgelaufen ist.
  if (!p.contract) p.contract = { salary: 120000, until: saison + 2, signOn: 0, releaseClause: null };
  else if ((p.contract.until || 0) <= saison + 1) p.contract.until = saison + 2;
}

/* ==========================================================================
 * 5. TRAINERLAUFBAHN
 * ======================================================================== */

function ensureManager(state) {
  if (!state.manager) {
    state.manager = {
      name: 'Der Trainer', age: 42, nationality: 'DE', reputation: 40, lizenz: 'A-Lizenz',
      skills: {}, erfahrung: 0, level: 1,
      bilanz: { spiele: 0, siege: 0, unentschieden: 0, niederlagen: 0, tore: 0, gegentore: 0 },
      karriere: [], titel: [], appearance: null
    };
  }
  const m = state.manager;
  if (!m.skills || typeof m.skills !== 'object') m.skills = {};
  for (const k of SKILL_KEYS) if (typeof m.skills[k] !== 'number') m.skills[k] = 45;
  if (typeof m.erfahrung !== 'number') m.erfahrung = 0;
  if (typeof m.level !== 'number') m.level = 1;
  if (typeof m.reputation !== 'number') m.reputation = 40;
  if (!Array.isArray(m.titel)) m.titel = [];
  if (!Array.isArray(m.karriere)) m.karriere = [];
  if (!m.bilanz) m.bilanz = { spiele: 0, siege: 0, unentschieden: 0, niederlagen: 0, tore: 0, gegentore: 0 };
  // Eigene Buchhaltung: Ständestand am Ende der Vorsaison, um Deltas zu bilden.
  if (!m.saisonstand || typeof m.saisonstand !== 'object') {
    m.saisonstand = { season: 0, spiele: 0, transfers: 0, jugend: 0, medien: 0 };
  }
  // Lizenz: Der Name stand schon immer im Spielstand (core/state.js), die Stufe
  // dazu ist neu. Aus einem alten Spielstand wird sie über den Namen abgeleitet.
  if (typeof m.lizenzStufe !== 'number') {
    const gefunden = LIZENZEN.find(l => l.name === m.lizenz);
    m.lizenzStufe = gefunden ? gefunden.stufe : 3;
  }
  m.lizenzStufe = clamp(Math.round(m.lizenzStufe), 1, LIZENZEN.length);
  if (!m.lizenz) m.lizenz = LIZENZEN[m.lizenzStufe - 1].name;
  if (m.fortbildung === undefined) m.fortbildung = null;
  return m;
}

/* --------------------------------------------------------------------------
 * 5a. Lizenz und Fortbildung
 * ------------------------------------------------------------------------ */

/** Die Lizenzstufen des Verbands (Lesezugriff für Bildschirme). */
export { LIZENZEN, FORTBILDUNGEN };

/**
 * Wo steht der Trainer im Lizenzwesen?
 * @returns {{ stufe, name, text, naechste, fehlt:string[]|null }}
 */
export function lizenzStand(state) {
  const m = ensureManager(state);
  const aktuell = LIZENZEN[m.lizenzStufe - 1];
  const naechste = LIZENZEN[m.lizenzStufe] || null;
  let fehlt = null;
  if (naechste) {
    fehlt = [];
    if (m.erfahrung < naechste.erfahrung) fehlt.push(`${naechste.erfahrung - Math.round(m.erfahrung)} Erfahrung`);
    if (m.level < naechste.level) fehlt.push(`Stufe ${naechste.level}`);
    if ((m.titel || []).length < naechste.titel) fehlt.push(`${naechste.titel - m.titel.length} Titel`);
  }
  return {
    stufe: m.lizenzStufe, name: aktuell.name, text: aktuell.text,
    naechste: naechste ? { stufe: naechste.stufe, name: naechste.name, text: naechste.text } : null,
    fehlt: fehlt && fehlt.length ? fehlt : (naechste ? [] : null)
  };
}

/** Der laufende Lehrgang, falls einer läuft. */
export function fortbildungStand(state) {
  const m = ensureManager(state);
  return m.fortbildung ? Object.assign({}, m.fortbildung) : null;
}

/**
 * Das Lehrgangsangebot des Verbands, jeweils mit Begründung, falls es nicht geht.
 * @returns {Array<{id,name,desc,kosten,skill,plus,moeglich,grund}>}
 */
export function fortbildungen(state) {
  const m = ensureManager(state);
  const club = state.clubs[state.managerClubId] || null;
  const belegt = Array.isArray(m.lehrgaenge) ? m.lehrgaenge : [];
  return FORTBILDUNGEN.map(k => {
    let grund = null;
    if (m.fortbildung) grund = `Sie sitzen bereits im Lehrgang „${m.fortbildung.name}“.`;
    else if (belegt.includes(k.id)) grund = 'Diesen Lehrgang haben Sie bereits abgeschlossen.';
    else if (k.lizenz && m.lizenzStufe >= k.lizenz) grund = 'Diese Lizenz haben Sie bereits.';
    else if (k.lizenz && m.level < (LIZENZEN[k.lizenz - 1] || {}).level) {
      grund = `Zum ${k.name} lässt der Verband erst ab Trainerstufe ${(LIZENZEN[k.lizenz - 1] || {}).level} zu.`;
    } else if (club && club.finances.balance < k.kosten && club.finances.balance < 0) {
      grund = `${formatMoney(k.kosten)} bei dieser Kontolage — das erklären Sie dem Schatzmeister.`;
    }
    return Object.assign({}, k, { moeglich: !grund, grund });
  });
}

/**
 * Einen Lehrgang belegen. Er läuft die Saison über und wird beim Saisonwechsel
 * in managerSaison() abgeschlossen.
 * @returns {{ ok:boolean, text:string }}
 */
export function fortbildungBelegen(state, kursId) {
  const m = ensureManager(state);
  const angebot = fortbildungen(state).find(k => k.id === kursId);
  if (!angebot) return { ok: false, text: 'Diesen Lehrgang gibt es im Programm des Verbands nicht.' };
  if (!angebot.moeglich) return { ok: false, text: angebot.grund };

  const club = state.clubs[state.managerClubId] || null;
  if (club) buchen(state, club.id, -angebot.kosten, 'stab', `Trainerfortbildung ${angebot.name}`);
  m.fortbildung = {
    id: angebot.id, name: angebot.name, skill: angebot.skill, plus: angebot.plus,
    lizenz: angebot.lizenz || null, kosten: angebot.kosten, season: state.date.season
  };
  return {
    ok: true,
    text: `Sie sind angemeldet: „${angebot.name}“, ${formatMoney(angebot.kosten)}. ` +
      `Der Lehrgang läuft über die Saison; das Zeugnis kommt im Sommer. ` +
      `Bis dahin sitzen Sie abends über Unterlagen statt vor Videos vom nächsten Gegner.`
  };
}

/** Schließt den laufenden Lehrgang ab. Nur aus managerSaison(). */
function fortbildungAbschliessen(state, m) {
  const f = m.fortbildung;
  if (!f) return null;
  m.fortbildung = null;
  if (!Array.isArray(m.lehrgaenge)) m.lehrgaenge = [];
  m.lehrgaenge.push(f.id);
  const key = SKILL_KEYS.includes(f.skill) ? f.skill : 'taktik';
  const alt = m.skills[key];
  m.skills[key] = round(clamp(alt + f.plus, 1, SKILL_DECKE), 1);
  return { id: f.id, name: f.name, skill: key, plus: round(m.skills[key] - alt, 1), lizenz: f.lizenz || null };
}

/**
 * Lizenzaufstieg am Saisonende.
 * Der Lehrgang ist die Abkürzung, nicht die Bedingung: Wer lange genug gut
 * arbeitet, wird vom Verband ohnehin eingeladen. Sonst hinge die ganze Stufe
 * an einem Knopf, den es auf keinem Bildschirm gibt.
 */
function lizenzFortschreiben(state, m, abschluss) {
  // Ein Lehrgang mit Lizenzstufe hebt sofort, sofern er wirklich höher liegt.
  if (abschluss && abschluss.lizenz && abschluss.lizenz > m.lizenzStufe) {
    m.lizenzStufe = abschluss.lizenz;
    m.lizenz = LIZENZEN[m.lizenzStufe - 1].name;
    return LIZENZEN[m.lizenzStufe - 1];
  }
  const naechste = LIZENZEN[m.lizenzStufe];
  if (!naechste) return null;
  if (m.erfahrung < naechste.erfahrung) return null;
  if (m.level < naechste.level) return null;
  if ((m.titel || []).length < naechste.titel) return null;
  m.lizenzStufe = naechste.stufe;
  m.lizenz = naechste.name;
  return naechste;
}

/** Erfolgsmaß der abgelaufenen Saison, 0..1. */
function erfolgsWert(state, bericht) {
  const b = bericht || {};
  const meineId = state.managerClubId;
  const liga = b.eigeneLiga || (state.clubs[meineId] && state.clubs[meineId].leagueId) || 'bl1';
  const groesse = (LEAGUES[liga] && LEAGUES[liga].clubIds.length) || 18;
  const platz = typeof b.eigenerPlatz === 'number' && b.eigenerPlatz > 0 ? b.eigenerPlatz : Math.round(groesse / 2);

  const relativ = clamp((groesse - platz) / Math.max(1, groesse - 1), 0, 1);
  const meister = b.meister === meineId;
  const pokal = b.pokalsieger === meineId;
  const aufstieg = Array.isArray(b.aufsteiger) && b.aufsteiger.includes(meineId);
  const abstieg = Array.isArray(b.absteiger) && b.absteiger.includes(meineId);

  let e = relativ * 0.72;
  if (liga === 'bl1') e += 0.10;
  if (meister) e += 0.22;
  if (pokal) e += 0.13;
  if (aufstieg) e += 0.18;
  if (abstieg) e -= 0.32;
  if (b.vorstandsurteil && b.vorstandsurteil.entlassen) e -= 0.20;

  return { wert: clamp(e, 0, 1), relativ, platz, liga, groesse, meister, pokal, aufstieg, abstieg };
}

/**
 * Wie stark hat der Trainer die einzelnen Fähigkeiten diese Saison beansprucht?
 * Alles 0..1 und ausschließlich aus Feldern gelesen, die andere Module ohnehin
 * schon führen — deshalb wird hier nichts geschrieben außer den Ständen in
 * `manager.saisonstand`, mit denen sich die Deltas bilden lassen.
 */
function nutzungswerte(state, club, m) {
  const stand = m.saisonstand;
  const n = { training: 0.4, taktik: 0.4, motivation: 0.4, verhandlung: 0.3, jugend: 0.3, medien: 0.3 };
  if (!club) return { werte: n, neuerStand: stand };

  /* --- Training: Intensität und Schwerpunkt der Trainingswoche ---------- */
  const tr = club.training || {};
  const intensitaet = typeof tr.intensitaet === 'number' ? tr.intensitaet : 55;
  n.training = clamp((intensitaet - 30) / 50, 0, 1) * 0.85
    + (tr.schwerpunkt && tr.schwerpunkt !== 'ausgeglichen' ? 0.15 : 0)
    + (tr.wochenplan ? 0.05 : 0);

  /* --- Taktik: Spiele der Saison plus Arbeit am Taktikbrett -------------- */
  const spieleGesamt = (m.bilanz && m.bilanz.spiele) || 0;
  const spieleSaison = Math.max(0, spieleGesamt - (stand.spiele || 0));
  const t = club.tactics || {};
  const rollen = t.roles && Object.keys(t.roles).length ? 0.14 : 0;
  const anweisungen = t.instructions && Object.values(t.instructions).some(Boolean) ? 0.08 : 0;
  const regler = t.sliders && Object.values(t.sliders).some(v => Math.abs((v || 50) - 50) >= 10) ? 0.10 : 0;
  n.taktik = clamp(spieleSaison / 34, 0, 1) * 0.68 + rollen + anweisungen + regler;

  /* --- Motivation: Zustand der Kabine und geführte Ansprachen ------------ */
  const moral = typeof club.moral === 'number' ? club.moral : 60;
  const kab = club.kabine || {};
  n.motivation = clamp((moral - 42) / 42, 0, 1) * 0.70
    + (kab.letzteAnsprache ? 0.18 : 0)
    + clamp(((kab.teamgeist || 60) - 50) / 45, 0, 1) * 0.12;

  /* --- Verhandlung: eigene Transfers dieser Saison ----------------------- */
  const alleTransfers = Array.isArray(state.history && state.history.transfers) ? state.history.transfers : [];
  const eigene = alleTransfers.filter(e =>
    e && (e.zuId === club.id || e.vonId === club.id)).length;
  const eigeneSaison = Math.max(0, eigene - (stand.transfers || 0));
  const budget = (club.finances && club.finances.transferBudget) || 0;
  n.verhandlung = clamp(eigeneSaison / 6, 0, 1) * 0.80 + (budget > 0 ? 0.10 : 0);

  /* --- Jugend: Beförderungen, Durchbrüche, Ausbaustufe ------------------- */
  const y = club.youth || {};
  const jugendZaehler = (y.befoerdert || 0) + (y.durchbrueche || 0);
  const jugendSaison = Math.max(0, jugendZaehler - (stand.jugend || 0));
  n.jugend = clamp(jugendSaison / 3, 0, 1) * 0.62
    + clamp(((y.akademie || 50) - 30) / 60, 0, 1) * 0.38;

  /* --- Medien: beantwortete Pressefragen und Glaubwürdigkeit ------------- */
  const presse = state.presse || {};
  const beantwortet = Array.isArray(presse.beantwortet) ? presse.beantwortet.length : 0;
  const medienSaison = Math.max(0, beantwortet - (stand.medien || 0));
  n.medien = clamp(medienSaison / 8, 0, 1) * 0.70
    + clamp(((presse.glaubwuerdigkeit || 60) - 35) / 55, 0, 1) * 0.30;

  for (const k of SKILL_KEYS) n[k] = clamp(n[k], 0, 1);

  return {
    werte: n,
    neuerStand: {
      season: state.date.season,
      spiele: spieleGesamt,
      transfers: eigene,
      jugend: jugendZaehler,
      medien: beantwortet
    }
  };
}

/**
 * Zuwachs einer Fähigkeit. Lernkurve: Von 45 aus geht es zügig, ab 75 wird
 * jeder Punkt teuer, über SKILL_DECKE kommt niemand.
 *
 * Korridor laut ROADMAP: (training + taktik + motivation)/3 — also der Wert,
 * den loop.js:coachBonusOf liest — soll über acht erfolgreiche Saisons von 45
 * auf etwa 75 wandern. Mit voller Nutzung und vollem Erfolg ergibt die Formel
 * genau diese Kurve; wer sich nicht kümmert, bleibt bei 50 stehen.
 */
function skillZuwachs(wert, nutzung, erfolg) {
  const lernkurve = clamp((SKILL_DECKE - wert) / (SKILL_DECKE - SKILL_SOCKEL), 0.05, 1);
  const gewicht = clamp(
    SKILL_GEWICHT_SOCKEL + SKILL_GEWICHT_NUTZUNG * nutzung + SKILL_GEWICHT_ERFOLG * erfolg,
    SKILL_GEWICHT_MIN, SKILL_GEWICHT_MAX);
  return SKILL_TEMPO * lernkurve * gewicht;
}

function levelVon(erfahrung) {
  let lvl = 1;
  for (let i = 0; i < LEVEL_SCHWELLEN.length; i++) if (erfahrung >= LEVEL_SCHWELLEN[i]) lvl = i + 1;
  return lvl;
}

export function levelName(level) {
  return LEVEL_NAMEN[clamp(Math.round(level), 1, LEVEL_NAMEN.length) - 1];
}

const SAISON_LOB = [
  'Der Aufsichtsrat hat Ihnen nach der Sitzung sogar die Hand geschüttelt. Zweimal.',
  'Man merkt: Sie wissen inzwischen, wo im Trainingszentrum die Lichtschalter sind.',
  'Ihr Co-Trainer sagt, Sie hätten sich verändert. Er meint es als Kompliment.'
];
const SAISON_TADEL = [
  'Der Aufsichtsrat spricht von einem „Übergangsjahr". So nennt man das, wenn niemand hinsehen will.',
  'Gelernt haben Sie trotzdem etwas. Meistens lernt man aus so etwas mehr als aus einem Titel.',
  'Die Presse hat Ihnen eine Sondersendung gewidmet. Leider keine schöne.'
];

/**
 * Trainerentwicklung nach Saisonende.
 * @returns {{ level, aufstieg, text, veraenderungen, erfahrung, reputation, erfolg, nutzung }}
 */
export function managerSaison(state, bericht) {
  const m = ensureManager(state);
  const b = bericht || {};
  const saison = b.season !== undefined ? b.season : state.date.season;
  const club = state.clubs[state.managerClubId] || null;

  const erf = erfolgsWert(state, b);
  const nz = nutzungswerte(state, club, m);
  const nutzung = nz.werte;

  /* --- 1. Fähigkeiten ---------------------------------------------------- */
  const veraenderungen = {};
  for (const k of SKILL_KEYS) {
    const alt = m.skills[k];
    const neu = clamp(alt + skillZuwachs(alt, nutzung[k], erf.wert), 1, SKILL_DECKE);
    m.skills[k] = round(neu, 1);
    veraenderungen[k] = round(m.skills[k] - alt, 1);
  }

  /* --- 2. Erfahrung und Level -------------------------------------------- */
  const spieleSaison = Math.max(0, ((m.bilanz && m.bilanz.spiele) || 0) - (m.saisonstand.spiele || 0));
  let erfahrungPlus = spieleSaison * 2;
  erfahrungPlus += clamp((erf.groesse + 1 - erf.platz) * (erf.liga === 'bl1' ? 4 : 2.2), 0, 80);
  if (erf.meister) erfahrungPlus += 120;
  if (erf.pokal) erfahrungPlus += 70;
  if (erf.aufstieg) erfahrungPlus += 60;
  if (erf.abstieg) erfahrungPlus -= 40;
  erfahrungPlus = Math.max(10, Math.round(erfahrungPlus));

  const levelVorher = m.level;
  m.erfahrung = Math.round(m.erfahrung + erfahrungPlus);
  m.level = levelVon(m.erfahrung);
  const aufstieg = m.level > levelVorher;
  veraenderungen.erfahrung = erfahrungPlus;

  /* --- 3. Ruf ------------------------------------------------------------ */
  // Europapokalsiege: Sie standen bisher weder im Ruf noch in der Titelliste.
  // Wer die Champions League gewinnt und hinterher liest, er habe „Platz 2 in
  // der Bundesliga" erreicht, legt das Spiel zu Recht weg.
  const euro = europaTitelVon(b, state.managerClubId);
  let dRep = (erf.relativ - 0.5) * 6;
  if (erf.liga === 'bl1') dRep += 1.0;
  if (erf.meister) dRep += 5;
  if (erf.pokal) dRep += 3;
  if (erf.aufstieg) dRep += 4;
  if (erf.abstieg) dRep -= 6;
  for (const t of euro) dRep += t.ruf;
  // Wer schon berühmt ist, wird durch einen weiteren guten Platz kaum berühmter.
  if (dRep > 0) dRep *= clamp((100 - m.reputation) / 60, 0.12, 1);
  const repVorher = m.reputation;
  m.reputation = clamp(round(m.reputation + dRep, 1), 1, 100);
  veraenderungen.reputation = round(m.reputation - repVorher, 1);

  /* --- 4. Titelsammlung -------------------------------------------------- */
  const neueTitel = [];
  const titelHinzu = (name) => {
    if (m.titel.some(t => t && typeof t === 'object' && t.season === saison && t.name === name)) return;
    const eintrag = { name, season: saison, clubId: state.managerClubId, club: club ? club.shortName : null };
    m.titel.push(eintrag);
    neueTitel.push(eintrag);
  };
  if (erf.meister) titelHinzu((LEAGUES[erf.liga] && LEAGUES[erf.liga].meisterTitel) || 'Meister');
  if (erf.pokal) titelHinzu('DFB-Pokalsieger');
  if (erf.aufstieg) titelHinzu('Aufstieg in die 1. Bundesliga');
  for (const t of euro) titelHinzu(t.name);

  /* --- 4b. Lizenz und Fortbildung ---------------------------------------- */
  const abschluss = fortbildungAbschliessen(state, m);
  if (abschluss) veraenderungen[abschluss.skill] = round((veraenderungen[abschluss.skill] || 0) + abschluss.plus, 1);
  const neueLizenz = lizenzFortschreiben(state, m, abschluss);

  /* --- 5. Stand für die nächste Saison merken ---------------------------- */
  m.saisonstand = nz.neuerStand;

  /* --- 6. Der Text ------------------------------------------------------- */
  const rng = createRng(hashString('managersaison:' + state.seed + ':' + saison));
  const beste = sortBy(SKILL_KEYS.map(k => ({ k, d: veraenderungen[k] })), e => ({ key: e.d, desc: true }))[0];
  const skillNamen = {
    training: 'Trainingsarbeit', taktik: 'Taktik', motivation: 'Menschenführung',
    verhandlung: 'Verhandlungsgeschick', jugend: 'Nachwuchsarbeit', medien: 'Umgang mit der Presse'
  };

  const teile = [];
  teile.push(neueTitel.length
    ? `Saison ${saison}: ${neueTitel.map(t => t.name).join(' und ')}. Das steht jetzt für immer in der Akte.`
    : `Saison ${saison} abgeschlossen — Platz ${erf.platz} in der ${(LEAGUES[erf.liga] && LEAGUES[erf.liga].name) || erf.liga}.`);
  const komma = v => String(v).replace('.', ',');
  const dRepText = (m.reputation >= repVorher ? '+' : '') + komma(round(m.reputation - repVorher, 1));
  teile.push(`Erfahrung +${erfahrungPlus} (Stand ${m.erfahrung}), Ruf ${dRepText}.`);
  if (beste && beste.d > 0.3) {
    teile.push(`Am meisten zugelegt haben Sie in der ${skillNamen[beste.k]} (+${komma(beste.d)}).`);
  }
  if (aufstieg) {
    teile.push(`Sie sind auf Stufe ${m.level} aufgestiegen: ${levelName(m.level)}.`);
  }
  if (abschluss) {
    teile.push(`Der Lehrgang „${abschluss.name}“ ist bestanden ` +
      `(${skillNamen[abschluss.skill]} +${komma(abschluss.plus)}).`);
  }
  if (neueLizenz) {
    teile.push(`Der Verband hat Ihnen die ${neueLizenz.name} ausgestellt. ${neueLizenz.text}`);
  }
  teile.push(erf.wert >= 0.55 ? rng.pick(SAISON_LOB) : rng.pick(SAISON_TADEL));

  return {
    level: m.level,
    aufstieg,
    text: teile.join(' '),
    veraenderungen,
    erfahrung: m.erfahrung,
    reputation: m.reputation,
    titel: neueTitel,
    lizenz: m.lizenz,
    lizenzStufe: m.lizenzStufe,
    lizenzAufstieg: neueLizenz ? neueLizenz.name : null,
    fortbildung: abschluss,
    erfolg: round(erf.wert, 2),
    nutzung
  };
}

/**
 * Europapokalsiege des eigenen Vereins aus dem Saisonbericht.
 * Der Bericht führt sie unter `europa.sieger` (siehe club/europa.js); ältere
 * Aufrufer ohne dieses Feld bekommen eine leere Liste und merken nichts.
 */
function europaTitelVon(bericht, meineId) {
  const sieger = (bericht && bericht.europa && bericht.europa.sieger) || null;
  if (!sieger || !meineId) return [];
  const namen = {
    cl: { name: 'Champions-League-Sieger', ruf: 8 },
    el: { name: 'Europa-League-Sieger', ruf: 4 },
    conf: { name: 'Conference-League-Sieger', ruf: 2 }
  };
  const out = [];
  for (const wb of ['cl', 'el', 'conf']) {
    if (sieger[wb] && sieger[wb] === meineId) out.push(namen[wb]);
  }
  return out;
}

/* ==========================================================================
 * 6. AUSZEICHNUNGEN
 * ======================================================================== */

/** Torschützenkönig einer Liga (vor dem Zurücksetzen der Saisonstatistik). */
export function torschuetzenkoenig(state, leagueId = 'bl1') {
  let best = null;
  for (const p of ligaSpieler(state, leagueId)) {
    const s = saisonstat(p);
    if (!s.tore) continue;
    if (!best || s.tore > best.tore || (s.tore === best.tore && s.spiele < best.spiele)) {
      best = {
        playerId: p.id, name: nameVon(p), kurzName: kurzVon(p),
        clubId: p.clubId, tore: s.tore, spiele: s.spiele, vorlagen: s.vorlagen
      };
    }
  }
  return best || { playerId: null, name: '–', kurzName: '–', clubId: null, tore: 0, spiele: 0, vorlagen: 0 };
}

/** Bewertungspunkte eines Spielers für die Elf der Saison. */
function elfPunkte(p, s, gruppe) {
  const note = durchschnittsnote(s);
  const einsatz = clamp(s.spiele / 24, 0, 1.15);
  let wert = note * einsatz * 10;
  wert += s.tore * (gruppe === 'STU' ? 1.6 : gruppe === 'MIT' ? 2.3 : 3.2);
  wert += s.vorlagen * 1.7;
  wert += s.motm * 1.3;
  if (gruppe === 'TW') wert += s.zuNull * 1.4;
  return wert;
}

/**
 * Beste Elf der abgelaufenen Saison — 1 TW, 4 ABW, 4 MIT, 2 STU.
 * @returns {Array<{ playerId, pos, note }>}
 */
export function elfDerSaison(state, leagueId = 'bl1') {
  const kandidaten = [];
  for (const p of ligaSpieler(state, leagueId)) {
    const s = saisonstat(p);
    if (!s.notenAnzahl) continue;
    const gruppe = POSITION_GROUP[p.position] || 'MIT';
    kandidaten.push({
      playerId: p.id, pos: p.position, gruppe,
      name: nameVon(p), kurzName: kurzVon(p), clubId: p.clubId,
      note: round(durchschnittsnote(s), 2),
      spiele: s.spiele, tore: s.tore, vorlagen: s.vorlagen,
      wert: elfPunkte(p, s, gruppe)
    });
  }
  if (!kandidaten.length) return [];

  const waehle = (gruppe, anzahl, minSpiele) => {
    const pool = sortBy(
      kandidaten.filter(k => k.gruppe === gruppe && k.spiele >= minSpiele && !k.gewaehlt),
      k => ({ key: k.wert, desc: true }), k => k.playerId);
    const out = pool.slice(0, anzahl);
    for (const k of out) k.gewaehlt = true;
    return out;
  };

  const elf = [];
  for (const gruppe of ['TW', 'ABW', 'MIT', 'STU']) {
    let teil = waehle(gruppe, ELF_PLAN[gruppe], ELF_MIN_SPIELE);
    // Zu dünne Liga (oder eine Saison ohne genug Einsätze): Anspruch senken,
    // statt eine unvollständige Elf zu melden.
    if (teil.length < ELF_PLAN[gruppe]) {
      teil = teil.concat(waehle(gruppe, ELF_PLAN[gruppe] - teil.length, 1));
    }
    elf.push(...teil);
  }

  // Bleiben Lücken (etwa weil kein Torwart Noten hat), mit den Besten auffüllen.
  if (elf.length < 11) {
    const rest = sortBy(kandidaten.filter(k => !k.gewaehlt), k => ({ key: k.wert, desc: true }), k => k.playerId);
    for (const k of rest) {
      if (elf.length >= 11) break;
      k.gewaehlt = true;
      elf.push(k);
    }
  }

  return elf.map(k => ({
    playerId: k.playerId, pos: k.pos, note: k.note,
    name: k.name, kurzName: k.kurzName, clubId: k.clubId,
    spiele: k.spiele, tore: k.tore, vorlagen: k.vorlagen
  }));
}

/** Spieler der Saison — Note, Tore, Vorlagen, Auszeichnungen und Teamerfolg. */
export function spielerDerSaison(state, leagueId = 'bl1') {
  const tabelle = {};
  const ligen = Array.isArray(leagueId) ? leagueId
    : (!leagueId || leagueId === 'alle') ? LEAGUE_IDS : [leagueId];
  for (const lid of ligen) {
    for (const zeile of (state.tables && state.tables[lid]) || []) tabelle[zeile.clubId] = zeile.platz;
  }

  let best = null;
  for (const p of ligaSpieler(state, leagueId)) {
    const s = saisonstat(p);
    if (s.spiele < ELF_MIN_SPIELE || !s.notenAnzahl) continue;
    const platz = tabelle[p.clubId] || 10;
    const gruppe = POSITION_GROUP[p.position] || 'MIT';
    const wert = elfPunkte(p, s, gruppe) + s.motm * 2.2 + clamp((19 - platz) * 0.55, 0, 10);
    if (!best || wert > best.wert || (wert === best.wert && p.id < best.playerId)) {
      best = { playerId: p.id, wert };
    }
  }
  if (best) return best.playerId;

  // Notfall: die Liga hat keine Noten geliefert – dann eben der Torjäger.
  const tk = torschuetzenkoenig(state, leagueId);
  return tk.playerId;
}

/* ==========================================================================
 * 7. TITELCHRONIK UND REKORDE
 * ======================================================================== */

function ensureHistory(state) {
  if (!state.history || typeof state.history !== 'object') {
    state.history = { seasons: [], transfers: [], titel: {} };
  }
  const h = state.history;
  if (!Array.isArray(h.seasons)) h.seasons = [];
  if (!Array.isArray(h.transfers)) h.transfers = [];
  if (!h.titel || typeof h.titel !== 'object') h.titel = {};
  if (!h.rekorde || typeof h.rekorde !== 'object') {
    h.rekorde = {
      titelJeVerein: {},
      meisteTitel: null,
      hoechsterSieg: null,
      meisteToreSaison: null,
      meistePunkteSaison: null,
      laengsteSerie: null,
      managerTitel: 0
    };
  }
  const r = h.rekorde;
  if (!r.titelJeVerein || typeof r.titelJeVerein !== 'object') r.titelJeVerein = {};
  if (typeof r.managerTitel !== 'number') r.managerTitel = 0;
  return h;
}

/** Höchster Sieg und längste Serie aus den Partien der abgelaufenen Saison. */
function saisonRekordeMessen(state, saison) {
  const partien = state.fixtures.filter(f =>
    f.season === saison && f.played && f.result && Array.isArray(f.result.score));

  let hoechster = null;
  const serienstand = {};      // clubId -> { aktuell, beste }
  const nachTag = sortBy(partien, f => f.dayIndex || 0, f => f.id || '');

  for (const f of nachTag) {
    const [h, a] = f.result.score;
    if (typeof h !== 'number' || typeof a !== 'number') continue;
    const diff = Math.abs(h - a);
    if (diff > 0) {
      const siegerId = h > a ? f.homeId : f.awayId;
      const verliererId = h > a ? f.awayId : f.homeId;
      if (!hoechster || diff > hoechster.differenz ||
        (diff === hoechster.differenz && Math.max(h, a) > hoechster.tore)) {
        hoechster = {
          season: saison, wettbewerb: f.competitionId,
          siegerId, verliererId,
          tore: Math.max(h, a), gegentore: Math.min(h, a), differenz: diff,
          text: `${vereinKurz(state, siegerId)} ${Math.max(h, a)}:${Math.min(h, a)} ${vereinKurz(state, verliererId)}`
        };
      }
    }
    for (const [clubId, tore, gegen] of [[f.homeId, h, a], [f.awayId, a, h]]) {
      if (!clubId) continue;
      const s = serienstand[clubId] || (serienstand[clubId] = { aktuell: 0, beste: 0 });
      if (tore > gegen) { s.aktuell++; if (s.aktuell > s.beste) s.beste = s.aktuell; }
      else s.aktuell = 0;
    }
  }

  let serie = null;
  for (const clubId of Object.keys(serienstand).sort()) {
    const s = serienstand[clubId];
    if (!serie || s.beste > serie.laenge) serie = { season: saison, clubId, laenge: s.beste, art: 'sieg' };
  }

  return { hoechsterSieg: hoechster, laengsteSerie: serie, partien: partien.length };
}

/**
 * Schreibt die Chronik einer abgelaufenen Saison und pflegt die Rekordlisten.
 * Muss VOR dem Zurücksetzen von Statistik und Spielplan aufgerufen werden —
 * was nicht mehr da ist, kann auch nicht mehr in die Chronik.
 *
 * @returns {object} der geschriebene Eintrag
 */
export function titelChronik(state, bericht) {
  const h = ensureHistory(state);
  const b = bericht || {};
  const saison = b.season !== undefined ? b.season : state.date.season;
  const meineId = state.managerClubId;
  const meineLiga = b.eigeneLiga || (state.clubs[meineId] && state.clubs[meineId].leagueId) || null;

  const tk = b.torschuetzenkoenig && b.torschuetzenkoenig.playerId
    ? b.torschuetzenkoenig
    : torschuetzenkoenig(state, 'bl1');
  const elf = Array.isArray(b.elfDerSaison) && b.elfDerSaison.length
    ? b.elfDerSaison
    : elfDerSaison(state, 'bl1');

  const eintrag = {
    saison,
    meister: b.meister || null,
    meisterName: b.meister ? vereinName(state, b.meister) : null,
    pokalsieger: b.pokalsieger || null,
    pokalsiegerName: b.pokalsieger ? vereinName(state, b.pokalsieger) : null,
    absteiger: Array.isArray(b.absteiger) ? b.absteiger.slice() : [],
    aufsteiger: Array.isArray(b.aufsteiger) ? b.aufsteiger.slice() : [],
    torschuetzenkoenig: tk ? {
      playerId: tk.playerId, name: tk.name || null, clubId: tk.clubId || null,
      tore: tk.tore || 0, spiele: tk.spiele || 0
    } : null,
    elfDerSaison: elf.map(e => ({ playerId: e.playerId, pos: e.pos, note: e.note, clubId: e.clubId || null })),
    spielerDerSaison: b.spielerDerSaison || spielerDerSaison(state, 'bl1'),
    managerVerein: meineId || null,
    managerVereinName: meineId ? vereinName(state, meineId) : null,
    managerPlatz: b.eigenerPlatz !== undefined ? b.eigenerPlatz : null,
    managerLiga: meineLiga,
    managerName: state.manager ? state.manager.name : null,
    ruecktritte: Array.isArray(b.ruecktritte) ? b.ruecktritte.length : 0
  };

  h.titel[saison] = eintrag;

  /* --- Rekorde ----------------------------------------------------------- */
  const r = h.rekorde;

  const zaehle = (clubId, feld) => {
    if (!clubId) return;
    const e = r.titelJeVerein[clubId] || (r.titelJeVerein[clubId] = { meister: 0, pokal: 0, gesamt: 0 });
    e[feld]++;
    e.gesamt = e.meister + e.pokal;
  };
  zaehle(eintrag.meister, 'meister');
  zaehle(eintrag.pokalsieger, 'pokal');

  let fuehrend = null;
  for (const clubId of Object.keys(r.titelJeVerein).sort()) {
    const e = r.titelJeVerein[clubId];
    if (!fuehrend || e.gesamt > fuehrend.anzahl) {
      fuehrend = { clubId, name: vereinName(state, clubId), anzahl: e.gesamt, meister: e.meister, pokal: e.pokal };
    }
  }
  r.meisteTitel = fuehrend;

  if (eintrag.torschuetzenkoenig && eintrag.torschuetzenkoenig.tore > 0) {
    if (!r.meisteToreSaison || eintrag.torschuetzenkoenig.tore > r.meisteToreSaison.tore) {
      r.meisteToreSaison = {
        season: saison,
        playerId: eintrag.torschuetzenkoenig.playerId,
        name: eintrag.torschuetzenkoenig.name,
        clubId: eintrag.torschuetzenkoenig.clubId,
        tore: eintrag.torschuetzenkoenig.tore
      };
    }
  }

  const bl1 = (b.tabellen && b.tabellen.bl1) || (state.tables && state.tables.bl1) || [];
  if (bl1.length && bl1[0] && typeof bl1[0].punkte === 'number') {
    if (!r.meistePunkteSaison || bl1[0].punkte > r.meistePunkteSaison.punkte) {
      r.meistePunkteSaison = {
        season: saison, clubId: bl1[0].clubId,
        name: vereinName(state, bl1[0].clubId), punkte: bl1[0].punkte
      };
    }
  }

  const gemessen = saisonRekordeMessen(state, saison);
  if (gemessen.hoechsterSieg) {
    const alt = r.hoechsterSieg;
    const neu = gemessen.hoechsterSieg;
    if (!alt || neu.differenz > alt.differenz || (neu.differenz === alt.differenz && neu.tore > alt.tore)) {
      r.hoechsterSieg = neu;
    }
  }
  if (gemessen.laengsteSerie && gemessen.laengsteSerie.laenge > 0) {
    const alt = r.laengsteSerie;
    if (!alt || gemessen.laengsteSerie.laenge > alt.laenge) {
      r.laengsteSerie = Object.assign({}, gemessen.laengsteSerie, {
        name: vereinName(state, gemessen.laengsteSerie.clubId)
      });
    }
  }

  r.managerTitel = state.manager && Array.isArray(state.manager.titel) ? state.manager.titel.length : r.managerTitel;

  return eintrag;
}

/**
 * Kurzer deutscher Chroniktext für den Saisonabschluss-Bildschirm.
 * (Reine Anzeigehilfe – ändert nichts am Zustand.)
 */
export function chronikText(state, saison) {
  const h = state.history && state.history.titel && state.history.titel[saison];
  if (!h) return `Zur Saison ${saison} liegt nichts in der Chronik.`;
  const teile = [];
  teile.push(h.meisterName ? `Deutscher Meister: ${h.meisterName}.` : 'Ein Meister wurde nicht ermittelt.');
  if (h.pokalsiegerName) teile.push(`Pokalsieger: ${h.pokalsiegerName}.`);
  if (h.torschuetzenkoenig && h.torschuetzenkoenig.tore) {
    teile.push(`Torschützenkrone: ${h.torschuetzenkoenig.name} (${h.torschuetzenkoenig.tore} Tore).`);
  }
  if (h.absteiger && h.absteiger.length) {
    teile.push(`Abgestiegen: ${h.absteiger.map(id => vereinKurz(state, id)).join(', ')}.`);
  }
  const r = state.history.rekorde;
  if (r && r.hoechsterSieg && r.hoechsterSieg.season === saison) {
    teile.push(`Höchster Sieg der Saison: ${r.hoechsterSieg.text}. Darüber redet die Liga noch im Winter.`);
  }
  return teile.join(' ');
}

export { SKILL_KEYS, LEVEL_SCHWELLEN, ALTERSRISIKO, HART_SCHLUSS };
