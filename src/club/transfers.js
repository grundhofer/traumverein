/**
 * club/transfers.js — Der Transfermarkt.
 * ============================================================================
 *
 * Zuständig für: Marktwerte, Ablösesummen, Angebote, mehrstufige Verhandlungen,
 * Vertragsangebote inkl. Berater, Leihen, Scouting, Transferliste und die
 * komplette KI-Transferlogik der 35 Computervereine.
 *
 * GRUNDSÄTZE
 *   • Reine Logik: kein DOM, kein Math.random(), kein Date.now().
 *     Aller Zufall kommt aus ctx.rng bzw. aus tmRng() (deterministisch aus
 *     Seed + Saison + Tag + Zähler abgeleitet, damit Savegames reproduzierbar
 *     bleiben, auch wenn der Spieler mitten am Tag eine Aktion auslöst).
 *   • Aktionen werfen keine Exceptions bei Fehlbedienung, sondern liefern
 *     { ok:false, text:'…' } zurück.
 *   • Alle Balancing-Zahlen stehen als benannte Konstanten oben.
 *
 * WIRTSCHAFTLICHER ANSPRUCH
 *   Ablösesummen orientieren sich am Marktwert (engine/ratings.js) und werden
 *   über Restlaufzeit, Kaderrolle, Verkaufsbereitschaft und die Reputation des
 *   Käufers moduliert. Ein Bundesligist mittlerer Größe verdient 120–180 Mio €
 *   im Jahr; sein Transferbudget liegt bei rund der Hälfte seines Kontostands.
 *   Wer über seine Verhältnisse einkauft, hat am Monatsende ein Problem —
 *   darum prüft jede Verpflichtung Kasse UND Gehaltsetat.
 *
 * DER DREH DES SPIELS: LEGENDEN
 *   Spieler mit era==='legend' sind Vereinsikonen. Sie kosten das Zweieinhalb-
 *   fache, wechseln fast nie freiwillig und ihr Verkauf kostet den Verein
 *   massiv Fan-Stimmung (club.fans.protest). Wer Beckenbauer verkauft, sollte
 *   sich in München nicht mehr blicken lassen.
 *
 * EIGENE STATE-FELDER (Lazy-Init, siehe tmState()):
 *   state.transfermarkt = { verhandlungen, offeneSpieler, geruechte, … }
 *   club.scoutberichte  = { [playerId]: { tage, seitTag, … } }
 *   Alles andere läuft über bereits in core/state.js angelegte Felder:
 *   club.transferliste, club.beobachtet, club.gerüchte, player.transfer, …
 */

import { POSITIONS, POSITION_GROUP, POSITION_NAMES, NATION_NAMES } from '../core/constants.js';
import { clamp, round, avg, sum, sortBy, formatMoney } from '../core/util.js';
import { createRng, hashString } from '../core/rng.js';
import {
  playerOverall, playerRatingForSlot, bestAffinity, squadDepth, marketValue
} from '../engine/ratings.js';
import { autoLineup } from '../engine/tactics.js';
import { SAISON_TAGE, LEAGUES, leagueOfClub } from '../data/leagues.js';
import { vereinsgehalt } from '../data/squads/_helper.js';

/* ==========================================================================
 * 1. BALANCING — hier und nirgends sonst wird an den Zahlen gedreht
 * ======================================================================== */

/** Transferfenster (dayIndex). Quelle: data/leagues.js — hier nur gespiegelt. */
export const FENSTER = {
  sommer: (SAISON_TAGE.transferfenster && SAISON_TAGE.transferfenster.sommer) || [0, 62],
  winter: (SAISON_TAGE.transferfenster && SAISON_TAGE.transferfenster.winter) || [184, 215]
};

/* --- Marktwert ----------------------------------------------------------- */
const WERT_RASTER = 50000;          // Marktwerte werden auf 50 Tsd gerundet
const WERT_MIN = 50000;
const LEGENDE_WERT_FAKTOR = 1.30;   // Ikonen sind teurer als ihre Zahlen
const STAR_WERT_FAKTOR = 1.12;      // Trait 'weltfussballer'
const WERT_UPDATE_INTERVALL = 30;   // Tage zwischen zwei Marktwert-Aktualisierungen

/* --- Ablöse -------------------------------------------------------------- */
// [maximale Restlaufzeit in Saisons, Faktor] — letztes Vertragsjahr ist billig.
const ABLOSE_RESTLAUFZEIT = [[0, 0.42], [1, 0.74], [2, 0.96], [3, 1.14], [99, 1.26]];
const ABLOSE_ROLLE = {
  star: 1.60, stamm: 1.22, rotation: 1.00, ergaenzung: 0.86, ueberzaehlig: 0.70
};
const ABLOSE_GELISTET = 0.78;         // Verein hat ihn selbst auf die Liste gesetzt
const ABLOSE_WECHSELWUNSCH = 0.84;    // Spieler drängt auf einen Wechsel
const ABLOSE_GELDNOT = 0.86;          // Konto im Minus ⇒ Verein wird weich
const ABLOSE_KAEUFER_REP = 0.0055;    // je Reputationspunkt des Käufers über 55
const ABLOSE_KAEUFER_REP_MAX = 0.30;  // … maximal 30 % Zuschlag
const ABLOSE_LIGA_ABSCHLAG = 0.88;    // Zweitligist kauft beim Erstligisten
const ABLOSE_JUNG_POTENZIAL = 0.020;  // je Punkt Potenzialüberschuss bei U23
const ABLOSE_MIN = 25000;
const LEGENDE_ABLOSE_FAKTOR = 2.35;   // Vereinsikonen gibt man nicht her
const LEGENDE_VERKAUFSDECKEL = 0.18;  // maximale Verkaufsbereitschaft einer Legende

/* --- Verkaufsbereitschaft (0..1) ------------------------------------------ */
const BEREIT_BASIS = 0.40;
const BEREIT_GELISTET = 0.42;
const BEREIT_WECHSELWUNSCH = 0.26;
const BEREIT_ROLLE = { star: -0.32, stamm: -0.16, rotation: 0.02, ergaenzung: 0.16, ueberzaehlig: 0.30 };
const BEREIT_VERTRAGSENDE = 0.30;     // letztes Vertragsjahr
const BEREIT_ALT = 0.18;              // ab 33
const BEREIT_UNZUFRIEDEN = 0.16;      // happiness.spielzeit < 35
const BEREIT_GELDNOT = 0.22;
const BEREIT_UEBERFUELLT = 0.14;      // Kader über Sollgröße

/* --- Angebote & Verhandlungen -------------------------------------------- */
const ANGEBOT_SOFORT_JA = 1.16;       // Gebot/Forderung ab hier: sofortiges Ja
const ANGEBOT_JA_SCHWELLE = 0.99;     // ab hier möglich (mit Verkaufsbereitschaft)
const ANGEBOT_GEGEN_SCHWELLE = 0.68;  // darunter gibt es kein Gegenangebot mehr
const ANGEBOT_FRECHHEIT = 0.50;       // darunter ist es eine Beleidigung
const ANGEBOT_LAUFZEIT_TAGE = 6;      // so lange bleibt ein Angebot liegen
const ANGEBOT_BEDENKZEIT = [1, 3];    // Tage, die ein Verein „überlegt"
const ANGEBOT_MAX_PRO_SPIELER = 4;
const BONUS_ANRECHNUNG = 0.55;        // Boni zählen nur anteilig als Ablöse
const RATEN_AUFSCHLAG = 0.06;         // je Rate über der ersten
const WEITERVERKAUF_ANRECHNUNG = 0.25;// Weiterverkaufsbeteiligung in % → Wert

const VERHANDLUNG_STIMMUNG_START = 55;
const VERHANDLUNG_GEDULD_START = 5;
const VERHANDLUNG_PLATZT_UNTER = 18;  // Stimmung
const VERHANDLUNG_DRUCK_STIMMUNG = -17;
const VERHANDLUNG_DRUCK_RABATT = 0.07;
const VERHANDLUNG_HALTEN_STIMMUNG = -9;
const VERHANDLUNG_BONUS_STIMMUNG = 7;
const VERHANDLUNG_ERHOEHEN_STIMMUNG = 11;
const VERHANDLUNG_MAX_RUNDEN = 8;

/* --- Gehälter & Berater --------------------------------------------------- */
const GEHALT_WERT_ANTEIL = 0.14;      // Anteil des Marktwerts als Jahresgehalt
const GEHALT_BASIS = 900;             // Sockel je (OVR-45)^GEHALT_EXP
const GEHALT_EXP = 2.4;
const GEHALT_FLOOR = 45;
// Das Gehaltsniveau des Vereins liefert vereinsgehalt() aus
// data/squads/_helper.js — dieselbe Skala, nach der die Kader gebaut sind.
const GEHALT_MIN = 60000;
const GEHALT_ALT_FAKTOR = 0.86;       // ab 33
const GEHALT_JUNG_FAKTOR = 0.80;      // bis 21
const GEHALT_RASTER = 10000;
const BERATER_PROZENT = 0.065;        // Provision auf die Ablöse
const BERATER_MIN_GEHALTSANTEIL = 0.45; // … mindestens aber vom Jahresgehalt
const BERATER_GIERIG_FAKTOR = 1.55;   // Persönlichkeit 'geldgierig'
const BERATER_LEGENDE_FAKTOR = 1.25;
const BERATER_MIN = 10000;

/* --- Vertragsentscheidung des Spielers ------------------------------------ */
const V_GEHALT = 115;                 // je 100 % Abweichung vom Wunschgehalt
const V_REPUTATION = 1.15;            // je Punkt Reputationsunterschied
const V_LIGA = 16;                    // Aufstieg/Abstieg in der Ligahierarchie
const V_SPIELZEIT = 15;               // je Stufe versprochener Rolle
const V_HEIMAT = 6;
const V_LANDSLEUTE = 5;
const V_TRAINER = 0.30;               // je Punkt manager.reputation über 40
const V_LOYALITAET = 14;              // Persönlichkeit loyal ⇒ bleibt lieber
const V_AMBITION = 10;
const V_HANDGELD = 9;                 // je Jahresgehalt Handgeld
const V_KLAUSEL = 6;
const V_PRAEMIEN = 5;
const V_LAUFZEIT_PASSEND = 5;
const V_ALTER_SICHERHEIT = 7;         // ab 31 zählt eine lange Laufzeit
const V_STREUUNG = 6;                 // Zufallsanteil (gauss)
const V_JA_SCHWELLE = 0;
const V_GEGEN_SCHWELLE = -22;         // darunter: klares Nein
const LEGENDE_WECHSEL_HUERDE = 38;    // Ikonen wechseln praktisch nie
const V_VERLAENGERUNG_BONUS = 12;     // Heimvorteil bei Vertragsverlängerung

/* --- Kadergrenzen der KI -------------------------------------------------- */
const MIN_KADER = 20;
const SOLL_KADER = 24;
const MAX_KADER = 28;
const MIN_PRO_GRUPPE = { TW: 2, ABW: 6, MIT: 6, STU: 3 };
const MAX_PRO_POSITION = { TW: 3 };   // niemand kauft den vierten Torwart
const MAX_PRO_POSITION_STD = 5;

/* --- KI-Verhalten: wie viele Vereine handeln überhaupt? ------------------- */
const KI_VEREINE_PRO_TAG = 20;        // so viele Vereine handeln pro Tag
const KI_DEADLINE_VEREINE = 36;       // am Deadline Day telefoniert die ganze Liga
/* Im Winter ist der Markt deutlich ruhiger. Der Wert stand auf 0,62, solange die
 * Vereine im Januar ohnehin klamm waren; seit die Fixkosten in club/finances.js
 * zur Vereinsgröße passen, haben sie im Winter Geld — und lagen mit 28/29
 * Wechseln über dem Korridor (8–25) aus tools/test-transfers.js. */
const KI_WINTER_FAKTOR = 0.52;
const KI_WINTER_RUECKLAGE = 0.35;     // so viel des Etats bleibt im Sommer liegen …
const KI_WINTER_RUECKLAGE_MAX = 1200000; // … aber höchstens dieser Betrag
const KI_MAX_ZUGAENGE = 4;            // je Verein und Fenster
const KI_MAX_ABGAENGE = 4;
const KI_MAX_ZUGAENGE_WINTER = 2;
const KI_MAX_ABGAENGE_WINTER = 2;
const KI_HANDELN_CHANCE = 0.58;       // Grundbereitschaft, überhaupt aktiv zu werden
const KI_HANDELN_REP = 0.006;         // je Reputationspunkt über 55 — Große sind rühriger
const KI_HANDLUNGSFAEHIG = 300000;    // darunter kann ein Verein gar nichts kaufen
const KI_DISPO_ANTEIL = 0.55;         // Dispo für Transfers, gemessen am Gehaltsetat
const KI_LUECKE_ABSTAND = 8;          // bester Spieler so weit unter Kaderniveau = Lücke

/* --- KI: ab wann lohnt sich ein Kauf? -------------------------------------
 * Ein Verein kauft nicht nur, wenn der Neue sofort die Startelf verbessert.
 * Er kauft auch Breite, Ersatz für Langzeitverletzte, Nachfolger für
 * auslaufende Verträge und — wenn Geld da ist — einfach einen Star.
 * Negative Werte heißen: der Neue darf schwächer sein als der beste Mann
 * auf dieser Position. Genau das ist eine Kaderergänzung.                  */
const KI_MIN_VERBESSERUNG = {
  luecke: -99,          // gar kein gelernter Spieler vorhanden
  ausfall: -6.0,        // der einzige Mann fällt lange aus
  vertragsende: -2.0,   // Nachfolger für einen auslaufenden Vertrag
  schwachstelle: -0.5,  // Position deutlich unter Kaderniveau
  breite: -3.0,         // zweiter/dritter Mann für die Position
  verstaerkung: -2.0    // muss den Ersatzmann wenigstens unter Druck setzen
};
/* Wogegen sich der Neue messen lassen muss: true = zweiter Mann (Kaderbreite),
 * false = bester Mann der Position (echte Verstärkung). */
const KI_MASSSTAB_ZWEITER = {
  ausfall: false, vertragsende: true, schwachstelle: false, breite: true, verstaerkung: true
};
const KI_ANSPRUCH_SOLL = 1.6;         // Aufschlag ab Sollgröße + 1
const KI_ANSPRUCH_UEBERVOLL = 3.4;    // … und noch einmal ab Sollgröße + 3
const KI_AMBITION_TEILER = 26;        // Reputation → Anspruch (Große kaufen mutiger)
const KI_DEADLINE_NACHLASS = 3.0;     // am Deadline Day wird jeder großzügig
const KI_SPAETPHASE_NACHLASS = 0.6;   // letzte zehn Tage des Fensters
const KI_WINTER_ANSPRUCH = -2.5;      // im Winter nimmt man auch eine Notlösung
const KI_NIVEAU_UNTERGRENZE = 13;     // so weit darf ein Neuzugang unter Kaderniveau liegen
const KI_NIVEAU_UNTERGRENZE_WINTER = 20; // … mitten in der Saison auch deutlich mehr
const KI_LANGZEIT_AUSFALL = 21;       // ab so vielen Ausfalltagen gilt jemand als Ausfall

/* --- KI: Prestigekäufe ----------------------------------------------------
 * Ein Verein mit voller Kasse holt sich auch ohne Not einen großen Namen.
 * Dafür bekommt er einen EIGENEN Anlauf pro Tag — sonst ginge der normale
 * Einkauf dafür drauf und der Kader bliebe löchrig.                       */
const KI_PRESTIGE_CHANCE = 0.85;      // Chance pro Tag auf einen solchen Anlauf
const KI_PRESTIGE_BUDGET = 7500000;   // … ab so viel freiem Budget
const KI_PRESTIGE_ABSTAND = 8;        // so weit unter Kaderniveau darf der Star höchstens liegen
const KI_PRESTIGE_AUFSCHLAG = 1.30;   // für den Wunschspieler zahlt man drauf
const KI_GROSSKAUF_BUDGET = 10000000; // ab so viel Etat greift ein Verein oben ins Regal
const KI_MAX_VERTRAGSLOS = 2;         // so viele Vertragslose holt ein Verein je Fenster

/* --- KI: Verkäufe --------------------------------------------------------- */
const KI_VERKAUF_CHANCE = 0.62;       // Bereitschaft, aktiv einen Spieler anzubieten
const KI_VERKAUF_MIN_KADER = 21;      // darunter wird nicht mehr verkauft
const KI_LISTE_MAX = 4;               // so viele Spieler stellt ein Verein ins Schaufenster
const KI_VERKAUF_GEWICHT = {          // welcher Abgabegrund wiegt wie schwer?
  gelistet: 3.2, wechselwunsch: 2.8, ueberzaehlig: 2.2, unzufrieden: 1.7,
  vertragsende: 1.5, altgedient: 1.1, ohne_spielzeit: 0.9
};
const KI_VERKAUF_INTERESSENTEN = 7;   // so viele mögliche Abnehmer werden geprüft
const KI_VERKAUF_VERSUCHE = 4;        // so viele eigene Spieler werden angeboten
/* Wie viele Reputationspunkte tiefer darf der neue Verein sein? Wer ohnehin
 * weg will, geht auch eine Etage tiefer; ein zufriedener Stammspieler nicht. */
const KI_REP_GEFAELLE = {
  vertragslos: 99, gelistet: 34, wechselwunsch: 34, ueberzaehlig: 30,
  unzufrieden: 30, vertragsende: 26, ohne_spielzeit: 24, altgedient: 22, chance: 8
};

/* --- KI: Bewertung eines Kandidaten --------------------------------------- */
const KI_GEWICHT_VERBESSERUNG = 4.0;
const KI_GEWICHT_POTENZIAL = 0.35;
const KI_GEWICHT_ALTER = 0.30;
const KI_IDEAL_ALTER = 26;
const KI_GEWICHT_DRINGLICHKEIT = 12;
const KI_GEWICHT_PREIS = 7;
const KI_GEWICHT_VERFUEGBAR = 4;      // wer zu haben ist, wird eher gekauft
const KI_KANDIDATEN = 6;              // aus so vielen wird gewürfelt
const KI_ZIELE_PRO_VERSUCH = 5;       // so viele Baustellen verfolgt ein Verein gleichzeitig
const KI_VERSUCHE_PRO_TAG = 1;        // Kaufversuche je Verein und Tag
const KI_VERSUCHE_DEADLINE = 3;
const KI_DEADLINE_QUOTE = 1;          // am letzten Tag darf jeder noch einmal
const KI_GEBOT_BASIS = 1.00;
const KI_GEBOT_REP_TEILER = 260;      // große Vereine überbieten kleine
const KI_DEADLINE_AUFSCHLAG = 1.12;
const KI_WECHSELPRAEMIE_MIN = 1.08;   // Gehaltssprung, den ein Wechsel bringen muss
const KI_WECHSELPRAEMIE_MAX = 1.28;
const KI_HANDGELD_ANTEIL = 0.25;      // Handgeld als Anteil des Jahresgehalts
const KI_GEWICHT_REP_HUERDE = 0.35;   // Reputationsgefälle macht einen Kandidaten unattraktiv
const KI_KASSE_ANTEIL = 0.85;         // so viel des Kontos darf verplant werden
const KI_WIEDERANLAGE = 0.85;         // Anteil einer Ablöse, der ins Budget zurückfließt
const KI_ANGEBOT_MANAGER_CHANCE = 0.90;   // Chance pro Tag, dass beim Manager jemand anruft
const KI_ANGEBOT_MANAGER_DEADLINE = 2.6;
const KI_ANGEBOT_MANAGER_MAX = 16;        // … aber nicht mehr als das pro Fenster
const KI_ANGEBOT_MANAGER_VERSUCHE = 8;    // so viele Spieler werden durchprobiert
const KI_ANGEBOT_MANAGER_ABSTAND = 6;     // so weit darf er unter dem Kaderniveau liegen
const KI_LEGENDE_ANGEBOT_CHANCE = 0.07;
const KI_GERUECHT_CHANCE = 0.55;
const KI_LEIH_CHANCE = 0.22;
const KI_VERLAENGERN_PRO_WOCHE = 3;   // so viele Vereine kümmern sich um Verträge

/* --- Markt-Index: wer ist überhaupt zu haben? ----------------------------- */
const MARKT_ZU_HABEN_JE_POSITION = 60;  // Spieler, die ihr Verein ziehen ließe
const MARKT_STAMM_JE_POSITION = 16;     // Stammkräfte — nur gegen sehr viel Geld
const MARKT_LEGENDEN_JE_POSITION = 3;   // Ikonen, damit sie den Markt nicht zustellen
const MARKT_VERFUEGBAR = {            // Verfügbarkeit 0..1 je Quelle
  vertragslos: 1.00, gelistet: 0.95, wechselwunsch: 0.90, vertragsende: 0.78,
  unzufrieden: 0.70, ueberzaehlig: 0.64, ergaenzung: 0.44, altgedient: 0.36,
  talent: 0.32, stamm: 0.13
};
const MARKT_VERFUEGBAR_GEWICHT = 0.5; // Anteil der Verfügbarkeit an der Marktattraktivität
const MARKT_STAMM_AB_RANG = 11;       // ab hier gilt jemand als Ergänzungsspieler
const MARKT_UEBERZAEHLIG_AB_RANG = 15;

/* --- Leihen ---------------------------------------------------------------- */
const LEIH_RUECKKEHR_TAG = 340;       // Ende der Saison, vor der Sommerpause
const LEIH_GEHALT_STANDARD = 0.6;     // Anteil, den der aufnehmende Verein zahlt
const LEIH_GEBUEHR_ANTEIL = 0.045;    // Leihgebühr in % des Marktwerts
const LEIH_MAX_OVR_ABSTAND = 4;       // so viel besser darf ein Leihspieler sein

/* --- Scouting -------------------------------------------------------------- */
const SCOUT_START_GENAUIGKEIT = 0.20;
const SCOUT_PRO_TAG = 0.017;
const SCOUT_ANLAGE = 0.0024;          // je Punkt club.facilities.scouting
const SCOUT_MAX = 0.97;
const SCOUT_KOSTEN = 12500;           // Reise- und Spesenpauschale
const SCOUT_MAX_BEOBACHTUNGEN = 12;
const SCOUT_RAUSCHEN = 22;            // maximale Abweichung bei Genauigkeit 0

/* --- Fans & Vorstand ------------------------------------------------------- */
const LEGENDE_PROTEST = 26;           // club.fans.protest bei Verkauf einer Ikone
const LEGENDE_PROTEST_STIMMUNG = -14;
const LEGENDE_PROTEST_VORSTAND = -7;
const FANLIEBLING_PROTEST = 12;
const STAMM_PROTEST = 5;              // Verkauf eines Stammspielers
const REKORD_JUBEL = 6;               // Fanstimmung bei einem Toptransfer
const LEGENDE_ZUGANG_JUBEL = 9;
const PROTEST_ZERFALL = 1;            // Abbau pro Woche (Rest macht club/fans.js)
const GROSSTRANSFER = 12000000;       // ab dieser Ablöse berichtet die Presse

/* ==========================================================================
 * 2. Modul-State, Zufall, kleine Helfer
 * ======================================================================== */

/** Lazy-Init des eigenen Zustandsblocks. */
function tmState(state) {
  let tm = state.transfermarkt;
  if (!tm) {
    tm = state.transfermarkt = {
      verhandlungen: [],      // laufende Verhandlungen
      offeneSpieler: [],      // playerIds mit offenen Angeboten
      geruechte: [],          // [{ playerId, clubId, tag, season, text }]
      naechsteId: 1,
      rngZaehler: 0,
      werteTag: -99,
      statSaison: 0,
      saison: { zugaenge: 0, abgaenge: 0, transfers: 0, volumen: 0, leihen: 0 },
      ki: {}                  // clubId -> { zugaenge, abgaenge, saison }
    };
  }
  if (!tm.ki) tm.ki = {};
  return tm;
}

/**
 * Zu- und Abgänge eines KI-Vereins — getrennt nach Transferfenster, damit im
 * Winter nicht die Sommerquote weiterläuft.
 */
function kiKonto(state, clubId) {
  const tm = tmState(state);
  let k = tm.ki[clubId];
  const saison = state.date.season;
  const fenster = fensterInfo(state).art || 'zu';
  if (!k || k.saison !== saison || k.fenster !== fenster) {
    const club = state.clubs[clubId];
    k = tm.ki[clubId] = {
      saison, fenster, zugaenge: 0, abgaenge: 0, vertragslos: 0,
      // Etat zu Fensterbeginn — Grundlage für die Winterrücklage.
      budgetStart: club && club.finances ? Math.max(0, club.finances.transferBudget || 0) : 0
    };
  }
  return k;
}

/**
 * Wie tief darf ein Verein für einen Transfer ins Minus gehen? club/finances.js
 * verzinst den Dispo, verbietet ihn aber nicht — der Riegel heißt dort
 * `finances.transfersperre`. Als Sicherheit dient der Gehaltsetat als Maß für
 * die Größe des Vereins.
 */
function dispoRahmen(club) {
  const f = club.finances || {};
  return Math.max(0, Math.round((f.wageBudget || 0) * KI_DISPO_ANTEIL));
}

/**
 * Verfügbares Budget eines KI-Vereins. Drei Dinge gehen ein:
 *   • die Transfersperre der Lizenzabteilung (dann ist Schluss),
 *   • Etat und Kassenlage inklusive Dispo,
 *   • eine Rücklage für das Winterfenster — wer im August alles verpulvert,
 *     steht im Januar mit leeren Taschen da.
 */
function kiVerfuegbaresBudget(state, club) {
  const f = club.finances || {};
  if (f.transfersperre) return 0;
  const budget = Math.max(0, f.transferBudget || 0);
  const kasse = Math.max(0, (f.balance || 0) + dispoRahmen(club));
  let frei = Math.min(budget, kasse);
  if (fensterInfo(state).art === 'sommer') {
    const ruecklage = Math.min(
      kiKonto(state, club.id).budgetStart * KI_WINTER_RUECKLAGE, KI_WINTER_RUECKLAGE_MAX);
    frei = Math.max(0, frei - ruecklage);
  }
  return frei;
}

/** Laufende Zwangsverkaufsanordnung der Finanzabteilung, sonst null. */
function zwangsverkauf(club) {
  const z = club.finances && club.finances.zwangsverkauf;
  return z && z.aktiv ? z : null;
}

/** Obergrenzen für Zu-/Abgänge im aktuellen Fenster. */
function kiQuote(art, deadline) {
  const extra = deadline ? KI_DEADLINE_QUOTE : 0;
  return art === 'winter'
    ? { zugaenge: KI_MAX_ZUGAENGE_WINTER + extra, abgaenge: KI_MAX_ABGAENGE_WINTER + extra }
    : { zugaenge: KI_MAX_ZUGAENGE + extra, abgaenge: KI_MAX_ABGAENGE + extra };
}

function neueId(state, prefix) {
  const tm = tmState(state);
  return prefix + '_' + (tm.naechsteId++).toString(36);
}

/**
 * Deterministischer Zufall für Aktionen, die der Spieler auslöst (kein ctx).
 * Aus Seed, Datum und einem mitgespeicherten Zähler abgeleitet — dadurch
 * reproduzierbar und savegame-fest, ohne core/state.js importieren zu müssen.
 */
function tmRng(state, label) {
  const tm = tmState(state);
  tm.rngZaehler = (tm.rngZaehler || 0) + 1;
  return createRng(hashString(
    `tm:${state.seed}:${label}:${state.date.season}:${state.date.day}:${tm.rngZaehler}`));
}

const sp = (state, id) => (typeof id === 'object' && id ? id : state.players[id]);
const cl = (state, id) => (typeof id === 'object' && id ? id : state.clubs[id]);

function kaderOf(state, clubId) {
  const c = cl(state, clubId);
  if (!c) return [];
  return c.playerIds.map(id => state.players[id]).filter(Boolean);
}

function restlaufzeit(state, p) {
  if (!p || !p.contract) return 0;
  return (p.contract.until || 0) - state.date.season;
}

function istVertragslos(state, p) {
  return !p.clubId || restlaufzeit(state, p) < 0;
}

/**
 * Restliche Ausfalltage. club/medical.js schreibt `tageRest`; ältere Stände und
 * engine/ratings.js kennen `daysLeft`/`tage` — hier werden alle akzeptiert.
 */
function ausfallTage(p) {
  const i = p && p.injury;
  if (!i) return 0;
  const tage = i.tageRest != null ? i.tageRest
    : i.daysLeft != null ? i.daysLeft
      : i.restTage != null ? i.restTage : (i.tage || 0);
  return Math.max(0, Math.round(tage));
}

/** Fällt der Mann so lange aus, dass der Verein Ersatz braucht? */
function langfristigAus(p) {
  if (ausfallTage(p) >= KI_LANGZEIT_AUSFALL) return true;
  return !!(p && p.cards && (p.cards.ban || 0) > 3);
}

function ovr(p) { return playerOverall(p); }

function name(p) { return p ? (p.shortName || p.lastName || 'Unbekannt') : 'Unbekannt'; }

function clubName(state, clubId) {
  const c = cl(state, clubId);
  return c ? (c.shortName || c.name) : 'einem anderen Verein';
}

function ligaTier(clubId) {
  const l = leagueOfClub(clubId);
  return l && LEAGUES[l] ? LEAGUES[l].tier : 3;
}

function meldung(ctx, text, kind, opts) {
  if (ctx && typeof ctx.log === 'function') ctx.log(text, kind || 'transfer', opts);
}

function ticker(ctx, text, kind) {
  if (ctx && typeof ctx.news === 'function') ctx.news(text, kind || 'transfer');
}

/** Rangliste eines Kaders nach Stärke — pro Verein und Tag zwischengespeichert. */
const RANG_CACHE = new WeakMap();
function kaderRangliste(state, clubId) {
  const c = cl(state, clubId);
  if (!c) return [];
  const cached = RANG_CACHE.get(c);
  if (cached && cached.day === state.date.day && cached.season === state.date.season
    && cached.size === c.playerIds.length) return cached.liste;
  const liste = sortBy(kaderOf(state, clubId), p => ({ key: playerRatingForSlot(p, p.position), desc: true }));
  RANG_CACHE.set(c, { day: state.date.day, season: state.date.season, size: c.playerIds.length, liste });
  return liste;
}

/** Kadertiefe je Position (squadDepth), zwischengespeichert. */
const TIEFE_CACHE = new WeakMap();
function kaderTiefe(state, clubId) {
  const c = cl(state, clubId);
  if (!c) return {};
  const cached = TIEFE_CACHE.get(c);
  if (cached && cached.day === state.date.day && cached.season === state.date.season
    && cached.size === c.playerIds.length) return cached.depth;
  const depth = squadDepth(kaderOf(state, clubId));
  TIEFE_CACHE.set(c, { day: state.date.day, season: state.date.season, size: c.playerIds.length, depth });
  return depth;
}

/** Niveau der elf besten Spieler — Bezugsgröße für „Lücke im Kader". */
function referenzNiveau(kader) {
  if (!kader.length) return 50;
  const top = sortBy(kader, p => ({ key: ovr(p), desc: true })).slice(0, 11);
  return avg(top, ovr);
}

/**
 * Rolle eines Spielers in seinem Kader: 'star' | 'stamm' | 'rotation' |
 * 'ergaenzung' | 'ueberzaehlig'.
 */
export function kaderRolle(state, playerId) {
  const p = sp(state, playerId);
  if (!p || !p.clubId) return 'ueberzaehlig';
  const liste = kaderRangliste(state, p.clubId);
  let i = -1;
  for (let k = 0; k < liste.length; k++) if (liste[k].id === p.id) { i = k; break; }
  if (i < 0) return 'ergaenzung';
  if (i <= 2) return 'star';
  if (i <= 10) return 'stamm';
  if (i <= 15) return 'rotation';
  if (i <= 19) return 'ergaenzung';
  return 'ueberzaehlig';
}

/** Freie Rückennummer im Zielverein. */
function freieNummer(state, club, p) {
  const belegt = new Set(kaderOf(state, club.id).map(x => x.number));
  if (p.number && !belegt.has(p.number)) return p.number;
  let n = p.position === 'TW' ? 1 : 2;
  while (belegt.has(n) && n < 99) n++;
  return n;
}

/** Verfügbares Transferbudget: Budget, aber gedeckelt durch die Kasse. */
function verfuegbaresBudget(state, club) {
  const f = club.finances || {};
  const budget = Math.max(0, f.transferBudget || 0);
  const kasse = Math.max(0, (f.balance || 0) * KI_KASSE_ANTEIL);
  return Math.min(budget, kasse);
}

/** Luft im Gehaltsetat (Jahresgehalt). */
function gehaltsspielraum(state, club) {
  const kader = kaderOf(state, club.id);
  const ist = sum(kader, p => (p.contract && p.contract.salary) || 0);
  const budget = club.finances && club.finances.wageBudget ? club.finances.wageBudget : ist * 1.15;
  return Math.max(0, budget - ist);
}

/** Buchung im Vereinskonto — Kategorie 'transfer'. */
function buche(state, club, betrag, text, ctx) {
  const f = club.finances;
  f.balance = Math.round((f.balance || 0) + betrag);
  if (!Array.isArray(f.ledger)) f.ledger = [];
  f.ledger.push({
    day: state.date.day, season: state.date.season,
    betrag: Math.round(betrag), kategorie: 'transfer', text
  });
  if (f.ledger.length > 800) f.ledger.splice(0, f.ledger.length - 800);
  if (f.saison) {
    if (betrag < 0) f.saison.ausgabenTransfer = (f.saison.ausgabenTransfer || 0) - betrag;
    else f.saison.einnahmenTransfer = (f.saison.einnahmenTransfer || 0) + betrag;
  }
}

/* ==========================================================================
 * 3. Transferfenster
 * ======================================================================== */

/** Ist heute das Transferfenster geöffnet? */
export function transferFensterOffen(state, day) {
  const d = day !== undefined ? day : state.date.day;
  return (d >= FENSTER.sommer[0] && d <= FENSTER.sommer[1])
    || (d >= FENSTER.winter[0] && d <= FENSTER.winter[1]);
}

/** Detailauskunft zum Fenster — für Anzeige und KI. */
export function fensterInfo(state, day) {
  const d = day !== undefined ? day : state.date.day;
  if (d >= FENSTER.sommer[0] && d <= FENSTER.sommer[1]) {
    return {
      offen: true, art: 'sommer', name: 'Sommer-Transferfenster',
      schluss: FENSTER.sommer[1], tageBisSchluss: FENSTER.sommer[1] - d,
      deadline: d === FENSTER.sommer[1]
    };
  }
  if (d >= FENSTER.winter[0] && d <= FENSTER.winter[1]) {
    return {
      offen: true, art: 'winter', name: 'Winter-Transferfenster',
      schluss: FENSTER.winter[1], tageBisSchluss: FENSTER.winter[1] - d,
      deadline: d === FENSTER.winter[1]
    };
  }
  const naechstes = d < FENSTER.winter[0] ? FENSTER.winter[0] : FENSTER.sommer[0] + 365;
  return {
    offen: false, art: null, name: 'Transferfenster geschlossen',
    schluss: null, tageBisSchluss: null, tageBisOeffnung: naechstes - d, deadline: false
  };
}

/* ==========================================================================
 * 4. Marktwert, Ablöse, Gehalt, Berater
 * ======================================================================== */

/** Durchschnittsnote der laufenden Saison (0 = noch keine Bewertung). */
function saisonNote(p) {
  const s = p.stats && p.stats.season;
  if (!s || !s.notenAnzahl) return 0;
  return s.notenSumme / s.notenAnzahl;
}

/**
 * Aktueller Marktwert in Euro — inklusive Form, Moral, Alter, Potenzial,
 * Restlaufzeit, Verletzung und Saisonleistung.
 */
export function marktwert(state, playerId) {
  const p = sp(state, playerId);
  if (!p) return 0;
  const note = saisonNote(p);
  const proxy = Object.assign({}, p, {
    contractSeasonsLeft: clamp(restlaufzeit(state, p), 0, 9),
    stats: { season: note ? { avgRating: note } : {} }
  });
  let v = marketValue(proxy);
  if (p.era === 'legend') v *= LEGENDE_WERT_FAKTOR;
  if ((p.traits || []).includes('weltfussballer')) v *= STAR_WERT_FAKTOR;
  return Math.max(WERT_MIN, Math.round(v / WERT_RASTER) * WERT_RASTER);
}

/** Verkaufsbereitschaft des abgebenden Vereins, 0..1. */
export function verkaufsbereitschaft(state, playerId) {
  const p = sp(state, playerId);
  if (!p) return 0;
  if (!p.clubId) return 1;
  const club = cl(state, p.clubId);
  let b = BEREIT_BASIS;
  const rolle = kaderRolle(state, p);
  b += BEREIT_ROLLE[rolle] || 0;
  if (p.transfer && p.transfer.listed) b += BEREIT_GELISTET;
  if (p.transfer && p.transfer.wunschWechsel) b += BEREIT_WECHSELWUNSCH;
  const rest = restlaufzeit(state, p);
  if (rest <= 0) b += BEREIT_VERTRAGSENDE;
  else if (rest === 1) b += BEREIT_VERTRAGSENDE * 0.45;
  if (p.age >= 33) b += BEREIT_ALT;
  else if (p.age >= 31) b += BEREIT_ALT * 0.5;
  if (p.happiness && p.happiness.spielzeit < 35) b += BEREIT_UNZUFRIEDEN;
  if (club) {
    if ((club.finances.balance || 0) < 0) b += BEREIT_GELDNOT;
    if (club.playerIds.length > SOLL_KADER) b += BEREIT_UEBERFUELLT;
  }
  if (p.era === 'legend') b = Math.min(b, LEGENDE_VERKAUFSDECKEL);
  if ((p.traits || []).includes('fanliebling')) b -= 0.08;
  return clamp(round(b, 3), 0.01, 0.98);
}

function restlaufzeitFaktor(rest) {
  for (const [max, f] of ABLOSE_RESTLAUFZEIT) if (rest <= max) return f;
  return 1;
}

/**
 * Verhandlungsbasis für eine Ablöse (Euro). Kaufinteressent optional —
 * große Vereine zahlen mehr, Zweitligisten bekommen Rabatt.
 */
export function abloseforderung(state, playerId, kaeuferId) {
  return abloseDetails(state, playerId, kaeuferId).forderung;
}

/** Wie abloseforderung(), aber mit aufgeschlüsselten Faktoren für die Anzeige. */
export function abloseDetails(state, playerId, kaeuferId) {
  const p = sp(state, playerId);
  if (!p) return { forderung: 0, wert: 0, faktoren: [], ablosefrei: true, text: 'Spieler unbekannt.' };

  const wert = marktwert(state, p);
  const faktoren = [];

  if (istVertragslos(state, p)) {
    return {
      forderung: 0, wert, faktoren: [{ name: 'Vertragslos', wert: 0 }],
      ablosefrei: true, verkaufsbereit: 1, unverkaeuflich: false,
      text: `${name(p)} ist vertragslos — es wird keine Ablöse fällig, nur der Berater hält die Hand auf.`
    };
  }

  const rest = restlaufzeit(state, p);
  let f = restlaufzeitFaktor(rest);
  faktoren.push({ name: rest <= 0 ? 'Vertrag läuft aus' : `Restlaufzeit ${rest} Jahr(e)`, wert: f });

  const rolle = kaderRolle(state, p);
  const rf = ABLOSE_ROLLE[rolle] || 1;
  f *= rf;
  faktoren.push({ name: 'Kaderrolle: ' + ROLLEN_TEXT[rolle], wert: rf });

  if (p.transfer && p.transfer.listed) { f *= ABLOSE_GELISTET; faktoren.push({ name: 'Auf der Transferliste', wert: ABLOSE_GELISTET }); }
  if (p.transfer && p.transfer.wunschWechsel) { f *= ABLOSE_WECHSELWUNSCH; faktoren.push({ name: 'Wechselwunsch', wert: ABLOSE_WECHSELWUNSCH }); }

  const verkaeufer = cl(state, p.clubId);
  if (verkaeufer && (verkaeufer.finances.balance || 0) < 0) {
    f *= ABLOSE_GELDNOT;
    faktoren.push({ name: 'Verein braucht Geld', wert: ABLOSE_GELDNOT });
  }

  if (p.age <= 23 && p.potential > ovr(p)) {
    const pf = 1 + (p.potential - ovr(p)) * ABLOSE_JUNG_POTENZIAL;
    f *= pf;
    faktoren.push({ name: 'Zukunftshoffnung', wert: round(pf, 3) });
  }

  if (p.era === 'legend') {
    f *= LEGENDE_ABLOSE_FAKTOR;
    faktoren.push({ name: 'Vereinsikone', wert: LEGENDE_ABLOSE_FAKTOR });
  }

  const kaeufer = kaeuferId ? cl(state, kaeuferId) : null;
  if (kaeufer && verkaeufer) {
    const rep = kaeufer.reputation || 50;
    const zuschlag = clamp((rep - 55) * ABLOSE_KAEUFER_REP, -0.10, ABLOSE_KAEUFER_REP_MAX);
    f *= 1 + zuschlag;
    if (Math.abs(zuschlag) > 0.01) {
      faktoren.push({ name: zuschlag > 0 ? 'Zahlungskräftiger Interessent' : 'Kleiner Interessent', wert: round(1 + zuschlag, 3) });
    }
    if (ligaTier(kaeufer.id) > ligaTier(verkaeufer.id)) {
      f *= ABLOSE_LIGA_ABSCHLAG;
      faktoren.push({ name: 'Wechsel eine Liga tiefer', wert: ABLOSE_LIGA_ABSCHLAG });
    }
  }

  let forderung = Math.max(ABLOSE_MIN, Math.round(wert * f / WERT_RASTER) * WERT_RASTER);

  const klausel = p.contract && p.contract.releaseClause;
  let klauselAktiv = false;
  if (klausel && klausel > 0 && klausel < forderung) {
    forderung = klausel;
    klauselAktiv = true;
    faktoren.push({ name: 'Ausstiegsklausel', wert: klausel });
  }

  const bereit = verkaufsbereitschaft(state, p);
  const unverkaeuflich = !klauselAktiv && bereit < 0.10;

  return {
    forderung, wert, faktoren, ablosefrei: false, verkaufsbereit: bereit,
    unverkaeuflich, klausel: klauselAktiv ? klausel : null, rolle,
    text: forderungsText(state, p, forderung, bereit, klauselAktiv)
  };
}

const ROLLEN_TEXT = {
  star: 'Aushängeschild', stamm: 'Stammspieler', rotation: 'Rotationsspieler',
  ergaenzung: 'Ergänzungsspieler', ueberzaehlig: 'überzählig'
};

function forderungsText(state, p, forderung, bereit, klausel) {
  const v = clubName(state, p.clubId);
  if (klausel) return `${v} muss ihn für die Ausstiegsklausel von ${formatMoney(forderung)} ziehen lassen. Punkt.`;
  if (p.era === 'legend') return `${v} lässt ausrichten: „${name(p)} ist unverkäuflich." Unter ${formatMoney(forderung)} braucht man gar nicht erst anzurufen.`;
  if (bereit >= 0.7) return `${v} würde ${name(p)} gern loswerden. Verhandlungsbasis: ${formatMoney(forderung)}.`;
  if (bereit >= 0.4) return `${v} nennt ${formatMoney(forderung)} — und lässt durchblicken, dass man über alles reden kann.`;
  return `${v} beziffert die Schmerzgrenze auf ${formatMoney(forderung)} und klingt dabei wenig verhandlungsbereit.`;
}

/**
 * Marktübliches Jahresgehalt für diesen Spieler bei diesem Verein.
 *
 * Die Vereinsgröße kommt aus derselben Gehaltsskala wie die Kaderdaten
 * (data/squads/_helper.js). Ohne sie liefe die Reparatur der Gehälter beim
 * ersten Transfer wieder aus dem Ruder: Der Kader wäre auf Vereinsniveau
 * gerechnet, jede Neuverpflichtung dagegen auf Weltmarktniveau.
 */
export function marktGehalt(state, playerId, clubId) {
  const p = sp(state, playerId);
  if (!p) return GEHALT_MIN;
  const o = ovr(p);
  const wert = marktwert(state, p);
  const weltmarkt = wert * GEHALT_WERT_ANTEIL + Math.pow(Math.max(1, o - GEHALT_FLOOR), GEHALT_EXP) * GEHALT_BASIS;
  const club = clubId ? cl(state, clubId) : (p.clubId ? cl(state, p.clubId) : null);
  let g = vereinsgehalt(weltmarkt, club);
  if (p.age >= 33) g *= GEHALT_ALT_FAKTOR;
  else if (p.age <= 21) g *= GEHALT_JUNG_FAKTOR;
  return Math.max(GEHALT_MIN, Math.round(g / GEHALT_RASTER) * GEHALT_RASTER);
}

/** Provision des Spielerberaters in Euro. */
export function beraterProvision(state, playerId, ablose) {
  const p = sp(state, playerId);
  if (!p) return 0;
  const gehalt = p.contract ? (p.contract.salary || marktGehalt(state, p)) : marktGehalt(state, p);
  let prov = Math.max((ablose || 0) * BERATER_PROZENT, gehalt * BERATER_MIN_GEHALTSANTEIL);
  const pers = p.personality || {};
  if (pers.id === 'geldgierig') prov *= BERATER_GIERIG_FAKTOR;
  if (p.era === 'legend') prov *= BERATER_LEGENDE_FAKTOR;
  return Math.max(BERATER_MIN, Math.round(prov / 10000) * 10000);
}

/* ==========================================================================
 * 5. Scouting
 * ======================================================================== */

function scoutStore(club) {
  if (!club.scoutberichte) club.scoutberichte = {};
  if (!Array.isArray(club.beobachtet)) club.beobachtet = [];
  return club.scoutberichte;
}

function beobachtungsEintrag(club, playerId) {
  const store = scoutStore(club);
  return store[playerId] || null;
}

/**
 * Einen Spieler beobachten lassen. Jeder Tag Beobachtung macht den Bericht
 * genauer. Kostet eine einmalige Spesenpauschale.
 */
export function scouten(state, clubId, playerId, opts = {}) {
  const club = cl(state, clubId);
  const p = sp(state, playerId);
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  if (!p) return { ok: false, text: 'Diesen Spieler kennt nicht einmal unser Scout.' };
  if (p.clubId === clubId) return { ok: false, text: `${name(p)} spielt bereits bei uns — den kennen wir.` };

  const store = scoutStore(club);
  if (store[playerId]) {
    return {
      ok: true, bereits: true,
      text: `${name(p)} wird bereits seit ${store[playerId].tage} Tag(en) beobachtet.`,
      bericht: scoutbericht(state, clubId, playerId)
    };
  }
  const aktive = Object.keys(store).length;
  if (aktive >= SCOUT_MAX_BEOBACHTUNGEN) {
    return { ok: false, text: `Unsere Späher sind ausgebucht — maximal ${SCOUT_MAX_BEOBACHTUNGEN} Spieler gleichzeitig.` };
  }
  const kosten = opts.kostenlos ? 0 : SCOUT_KOSTEN;
  if (kosten && (club.finances.balance || 0) < kosten) {
    return { ok: false, text: 'Für die Reisekosten reicht die Kasse nicht einmal bis zur Autobahnauffahrt.' };
  }
  if (kosten) buche(state, club, -kosten, `Scoutingreise: ${name(p)}`);

  store[playerId] = {
    playerId, tage: 1, seitTag: state.date.day, seitSaison: state.date.season,
    spiele: 0, seed: hashString(clubId + ':' + playerId)
  };
  if (!club.beobachtet.some(e => (e && e.playerId ? e.playerId : e) === playerId)) {
    club.beobachtet.push({ playerId, seitTag: state.date.day, seitSaison: state.date.season });
  }
  return {
    ok: true, kosten,
    text: `Unser Scout setzt sich in den Bus. ${name(p)} steht ab sofort unter Beobachtung.`,
    bericht: scoutbericht(state, clubId, playerId)
  };
}

/** Beobachtung beenden. */
export function scoutingBeenden(state, clubId, playerId) {
  const club = cl(state, clubId);
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  const store = scoutStore(club);
  if (!store[playerId]) return { ok: false, text: 'Dieser Spieler wird gar nicht beobachtet.' };
  delete store[playerId];
  club.beobachtet = club.beobachtet.filter(e => (e && e.playerId ? e.playerId : e) !== playerId);
  return { ok: true, text: 'Der Scout darf wieder nach Hause.' };
}

/** Alle beobachteten Spieler eines Vereins mit Kurzbericht. */
export function beobachteteSpieler(state, clubId) {
  const club = cl(state, clubId);
  if (!club) return [];
  const store = scoutStore(club);
  return Object.keys(store)
    .map(pid => state.players[pid] ? { player: state.players[pid], bericht: scoutbericht(state, clubId, pid) } : null)
    .filter(Boolean);
}

/** Deterministisches Rauschen aus Seed + Kanal, Ergebnis -1..1. */
function rauschen(seed, kanal) {
  const h = hashString(seed + ':' + kanal);
  return ((h % 20011) / 20011) * 2 - 1;
}

/**
 * Scoutbericht. Je länger beobachtet und je besser die Scoutingabteilung,
 * desto genauer. Bei niedriger Genauigkeit sind die Zahlen bewusst verrauscht.
 */
export function scoutbericht(state, clubId, playerId) {
  const club = cl(state, clubId);
  const p = sp(state, playerId);
  if (!p) return null;
  const eintrag = club ? beobachtungsEintrag(club, playerId) : null;
  const anlage = club && club.facilities ? (club.facilities.scouting || 50) : 50;

  const tage = eintrag ? eintrag.tage : 0;
  let genauigkeit = eintrag
    ? clamp(SCOUT_START_GENAUIGKEIT + tage * SCOUT_PRO_TAG + anlage * SCOUT_ANLAGE, 0, SCOUT_MAX)
    : clamp(0.10 + anlage * SCOUT_ANLAGE * 0.5, 0, 0.45);
  // Eigene Spieler kennt man in- und auswendig.
  if (p.clubId === clubId) genauigkeit = 1;
  genauigkeit = round(genauigkeit, 3);

  const seed = (eintrag && eintrag.seed) || hashString(clubId + ':' + playerId);
  const staerke = (1 - genauigkeit) * SCOUT_RAUSCHEN;
  const geschaetzteAttribute = {};
  for (const k in p.attributes) {
    geschaetzteAttribute[k] = clamp(Math.round(p.attributes[k] + rauschen(String(seed), k) * staerke), 1, 99);
  }
  const potNoise = rauschen(String(seed), 'potenzial') * staerke * 1.2;
  const geschaetztesPotenzial = clamp(Math.round(p.potential + potNoise), 1, 99);
  const geschaetztesOvr = clamp(Math.round(ovr(p) + rauschen(String(seed), 'ovr') * staerke * 0.8), 1, 99);
  const spanne = Math.round(staerke * 1.4);

  return {
    playerId: p.id,
    genauigkeit,
    tageBeobachtet: tage,
    geschaetzteAttribute,
    geschaetztesPotenzial,
    potenzialSpanne: [clamp(geschaetztesPotenzial - spanne, 1, 99), clamp(geschaetztesPotenzial + spanne, 1, 99)],
    geschaetzteStaerke: geschaetztesOvr,
    geschaetzterWert: Math.round(marktwert(state, p) * (1 + rauschen(String(seed), 'wert') * (1 - genauigkeit) * 0.4) / WERT_RASTER) * WERT_RASTER,
    einschaetzung: einschaetzungsText(state, p, genauigkeit, geschaetztesOvr, geschaetztesPotenzial)
  };
}

function einschaetzungsText(state, p, genauigkeit, geschaetztesOvr, pot) {
  const pos = POSITION_NAMES[p.position] || p.position;
  const nation = NATION_NAMES[p.nationality] || p.nationality;
  const teile = [];

  if (genauigkeit < 0.35) {
    teile.push(`Wir haben ${name(p)} bisher kaum gesehen — was hier steht, ist halb geraten.`);
  } else if (genauigkeit < 0.6) {
    teile.push(`Zwei, drei Spiele reichen für ein Bild, aber nicht für einen Eid.`);
  } else if (genauigkeit < 0.85) {
    teile.push(`Unser Späher hat ${name(p)} gründlich unter die Lupe genommen.`);
  } else {
    teile.push(`Über ${name(p)} wissen wir inzwischen mehr als seine Mutter.`);
  }

  const a = p.attributes || {};
  const staerken = sortBy(Object.keys(a), k => ({ key: a[k], desc: true })).slice(0, 3);
  const lob = {
    tempo: 'antritt wie ein geölter Blitz', schuss: 'ein Schuss wie ein Kanonenschlag',
    passspiel: 'Pässe wie mit dem Lineal gezogen', technik: 'Technik aus dem Bilderbuch',
    kopfball: 'in der Luft kaum zu haben', zweikampf: 'ein Zweikämpfer alter Schule',
    uebersicht: 'sieht Räume, bevor es sie gibt', dribbling: 'geht gern durch die halbe Abwehr',
    ausdauer: 'läuft, bis die Bandagen glühen', koerper: 'ein Schrank mit Beinen',
    nervenstaerke: 'Nerven wie Drahtseile', fuehrung: 'redet auf dem Platz, und alle hören zu',
    reflexe: 'Reflexe wie eine Katze', stellungsspiel: 'steht immer schon da, wo der Ball hinsoll',
    positionsspiel: 'ein Stellungsspiel wie mit dem Zirkel',
    aggressivitaet: 'geht rustikal zur Sache', sprungkraft: 'steigt hoch wie ein Hubschrauber',
    standards: 'gefährlich bei jedem ruhenden Ball', strafraumbeherrschung: 'pflügt seinen Strafraum um',
    abschlag: 'schlägt den Ball bis zur Mittellinie'
  };
  teile.push(`${pos}, ${p.age} Jahre, ${nation}: ${lob[staerken[0]] || 'solide ausgebildet'}.`);

  if (pot > geschaetztesOvr + 8) teile.push('Da ist noch reichlich Luft nach oben.');
  else if (p.age >= 32) teile.push('Die besten Jahre hat er hinter sich — dafür weiß er, wo das Tor steht.');
  if (p.era === 'legend') teile.push('Und ja: Das ist eine echte Legende. Der Preis wird entsprechend sein.');
  if ((p.traits || []).includes('glasknochen')) teile.push('Der Mannschaftsarzt hat beim Namen kurz geschluckt.');
  if ((p.traits || []).includes('querulant')) teile.push('Charakterlich ist er, sagen wir, eine Herausforderung.');

  return teile.join(' ');
}

/* ==========================================================================
 * 6. Angebote
 * ======================================================================== */

function offeneAngebotslisteZu(state, p) {
  if (!p.transfer) p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
  if (!Array.isArray(p.transfer.angebote)) p.transfer.angebote = [];
  return p.transfer.angebote;
}

function merkeOffenenSpieler(state, playerId) {
  const tm = tmState(state);
  if (!tm.offeneSpieler.includes(playerId)) tm.offeneSpieler.push(playerId);
}

/** Gesamtwert eines Angebots inkl. Boni, Raten und Weiterverkaufsanteil. */
function angebotsWert(ablose, opts = {}) {
  let w = Math.max(0, ablose || 0);
  const boni = opts.boni || {};
  const bonusSumme = (boni.einsaetze || 0) + (boni.tore || 0) + (boni.titel || 0) + (opts.bonus || 0);
  w += bonusSumme * BONUS_ANRECHNUNG;
  if (opts.weiterverkauf) w += (ablose || 0) * clamp(opts.weiterverkauf / 100, 0, 0.5) * WEITERVERKAUF_ANRECHNUNG;
  const raten = Math.max(1, opts.raten || 1);
  if (raten > 1) w *= 1 - (raten - 1) * RATEN_AUFSCHLAG;
  return Math.round(w);
}

/**
 * Angebot für einen Spieler abgeben.
 * @returns {{ok, status:'angenommen'|'abgelehnt'|'gegenangebot'|'ueberlegt',
 *            gegenforderung, text, forderung, verhandlungId, angebotId}}
 */
export function angebotAbgeben(state, kaeuferId, playerId, ablose, opts = {}) {
  const kaeufer = cl(state, kaeuferId);
  const p = sp(state, playerId);
  const nein = (text) => ({ ok: false, status: 'abgelehnt', gegenforderung: 0, text });

  if (!kaeufer) return nein('Unbekannter Verein.');
  if (!p) return nein('Diesen Spieler gibt es nicht.');
  if (p.clubId === kaeuferId) return nein(`${name(p)} spielt bereits bei uns.`);
  if (p.jugend) return nein('Nachwuchsspieler anderer Vereine sind tabu.');
  if (!transferFensterOffen(state) && !istVertragslos(state, p)) {
    return nein('Das Transferfenster ist geschlossen — da geht gar nichts.');
  }
  if (kaeufer.playerIds.length >= MAX_KADER) {
    return nein(`Der Kader ist mit ${kaeufer.playerIds.length} Mann voll. Erst ausmisten, dann einkaufen.`);
  }
  if (p.transfer && p.transfer.leihe && p.transfer.leihe.stammvereinId) {
    return nein(`${name(p)} ist nur ausgeliehen — er gehört ${clubName(state, p.transfer.leihe.stammvereinId)}.`);
  }

  ablose = Math.max(0, Math.round(ablose || 0));
  const details = abloseDetails(state, p.id, kaeuferId);
  const forderung = details.forderung;
  const provision = beraterProvision(state, p.id, ablose);

  // Kasse prüfen (die Ablöse muss zusammen mit der Provision gedeckt sein).
  const budget = verfuegbaresBudget(state, kaeufer);
  if (!opts.ki && ablose + provision > budget) {
    return nein(`Dafür fehlt das Geld. Verfügbar sind ${formatMoney(budget)}, nötig wären ${formatMoney(ablose + provision)} inklusive Beraterprovision.`);
  }

  const bestehende = offeneAngebotslisteZu(state, p);
  if (bestehende.some(a => a.kaeuferId === kaeuferId && a.status === 'offen')) {
    return nein('Für diesen Spieler liegt bereits ein Angebot von uns auf dem Tisch.');
  }
  if (bestehende.filter(a => a.status === 'offen').length >= ANGEBOT_MAX_PRO_SPIELER) {
    return nein('Der Verein wird bereits von Angeboten überrannt — später noch einmal versuchen.');
  }

  const rng = opts.rng || tmRng(state, 'angebot');
  const wert = angebotsWert(ablose, opts);
  const ratio = forderung > 0 ? wert / forderung : (wert > 0 ? 2 : 1);
  const bereit = details.verkaufsbereit;

  const angebot = {
    id: neueId(state, 'ang'),
    playerId: p.id,
    kaeuferId,
    verkaeuferId: p.clubId || null,
    ablose,
    wert,
    boni: opts.boni || null,
    weiterverkauf: opts.weiterverkauf || 0,
    raten: Math.max(1, opts.raten || 1),
    tag: state.date.day,
    season: state.date.season,
    ablaufTag: state.date.day + (opts.laufzeit || ANGEBOT_LAUFZEIT_TAGE),
    status: 'offen',
    ki: !!opts.ki
  };

  // --- Vertragslose: kein Verein, der Nein sagen könnte ---------------------
  if (details.ablosefrei) {
    angebot.status = 'angenommen';
    bestehende.push(angebot);
    merkeOffenenSpieler(state, p.id);
    return {
      ok: true, status: 'angenommen', gegenforderung: 0, forderung: 0,
      angebotId: angebot.id, verhandlungId: null,
      text: `${name(p)} ist vertragslos. Jetzt muss ihn nur noch das Vertragsangebot überzeugen.`
    };
  }

  // --- Ausstiegsklausel bedient: der Verein hat nichts mitzureden -----------
  if (details.klausel && ablose >= details.klausel) {
    angebot.status = 'angenommen';
    bestehende.push(angebot);
    merkeOffenenSpieler(state, p.id);
    return {
      ok: true, status: 'angenommen', gegenforderung: 0, forderung,
      angebotId: angebot.id, verhandlungId: null,
      text: `Die Ausstiegsklausel ist bedient — ${clubName(state, p.clubId)} kann nur noch zusehen.`
    };
  }

  // --- Ikonen: da hilft auch viel Geld selten ------------------------------
  if (p.era === 'legend' && ratio < 1.8) {
    angebot.status = 'abgelehnt';
    return {
      ok: true, status: 'abgelehnt', gegenforderung: Math.round(forderung * 1.8), forderung,
      angebotId: null, verhandlungId: null,
      text: `„${name(p)} ist kein Spieler, das ist ein Vereinsdenkmal." ${clubName(state, p.clubId)} legt auf.`
    };
  }

  if (ratio < ANGEBOT_FRECHHEIT) {
    return {
      ok: true, status: 'abgelehnt', gegenforderung: forderung, forderung,
      angebotId: null, verhandlungId: null,
      text: `${clubName(state, p.clubId)} lässt ausrichten, für das Geld bekomme man nicht einmal den Balljungen.`
    };
  }

  bestehende.push(angebot);
  merkeOffenenSpieler(state, p.id);

  // --- Sofortige Annahme ---------------------------------------------------
  const jaSchwelle = ANGEBOT_JA_SCHWELLE - (bereit - 0.5) * 0.22;
  if (ratio >= ANGEBOT_SOFORT_JA || (ratio >= jaSchwelle && rng.chance(0.35 + bereit * 0.55))) {
    angebot.status = 'angenommen';
    return {
      ok: true, status: 'angenommen', gegenforderung: 0, forderung,
      angebotId: angebot.id, verhandlungId: null,
      text: `${clubName(state, p.clubId)} nimmt an: ${formatMoney(ablose)} für ${name(p)}. Jetzt fehlt nur noch die Unterschrift des Spielers.`
    };
  }

  // --- Gegenangebot --------------------------------------------------------
  if (ratio >= ANGEBOT_GEGEN_SCHWELLE) {
    const nachlass = clamp(bereit * 0.16, 0.02, 0.14);
    const gegenforderung = Math.max(ablose + WERT_RASTER,
      Math.round(forderung * (1 + 0.10 - nachlass) / WERT_RASTER) * WERT_RASTER);
    const v = verhandlungAnlegen(state, angebot, gegenforderung, bereit);
    angebot.status = 'verhandlung';
    angebot.verhandlungId = v.id;
    return {
      ok: true, status: 'gegenangebot', gegenforderung, forderung,
      angebotId: angebot.id, verhandlungId: v.id, stimmung: v.stimmung,
      text: `${clubName(state, p.clubId)} winkt ab, bleibt aber am Apparat: ${formatMoney(gegenforderung)}, dann könne man reden.`
    };
  }

  // --- Der Verein denkt darüber nach ---------------------------------------
  angebot.status = 'ueberlegt';
  angebot.entscheidungTag = state.date.day + rng.int(ANGEBOT_BEDENKZEIT[0], ANGEBOT_BEDENKZEIT[1]);
  return {
    ok: true, status: 'ueberlegt', gegenforderung: forderung, forderung,
    angebotId: angebot.id, verhandlungId: null,
    text: `${clubName(state, p.clubId)} will die Sache im Vorstand besprechen. Antwort in ein bis drei Tagen.`
  };
}

/** Alle offenen Angebote, die einen Verein betreffen. */
export function offeneAngebote(state, clubId, richtung = 'alle') {
  const tm = tmState(state);
  const out = [];
  for (const pid of tm.offeneSpieler) {
    const p = state.players[pid];
    if (!p || !p.transfer || !Array.isArray(p.transfer.angebote)) continue;
    for (const a of p.transfer.angebote) {
      if (a.status !== 'offen' && a.status !== 'ueberlegt' && a.status !== 'verhandlung' && a.status !== 'angenommen') continue;
      const eingehend = a.verkaeuferId === clubId;
      const ausgehend = a.kaeuferId === clubId;
      if (!eingehend && !ausgehend) continue;
      if (richtung === 'eingehend' && !eingehend) continue;
      if (richtung === 'ausgehend' && !ausgehend) continue;
      out.push({
        angebot: a, player: p, richtung: eingehend ? 'eingehend' : 'ausgehend',
        gegner: eingehend ? a.kaeuferId : a.verkaeuferId,
        marktwert: marktwert(state, p)
      });
    }
  }
  return sortBy(out, e => ({ key: e.angebot.ablose, desc: true }));
}

function findeAngebot(state, angebotId) {
  const tm = tmState(state);
  for (const pid of tm.offeneSpieler) {
    const p = state.players[pid];
    if (!p || !p.transfer || !Array.isArray(p.transfer.angebote)) continue;
    const a = p.transfer.angebote.find(x => x.id === angebotId);
    if (a) return { angebot: a, player: p };
  }
  return null;
}

/** Eingegangenes Angebot annehmen — der Spieler muss dann noch zusagen. */
export function angebotAnnehmen(state, angebotId) {
  const found = findeAngebot(state, angebotId);
  if (!found) return { ok: false, text: 'Dieses Angebot liegt nicht mehr vor.' };
  const { angebot, player } = found;
  if (angebot.status !== 'offen' && angebot.status !== 'verhandlung') {
    return { ok: false, text: 'Dieses Angebot ist bereits erledigt.' };
  }
  angebot.status = 'angenommen';
  const kaeufer = cl(state, angebot.kaeuferId);
  const vertrag = kiVertragsangebot(state, kaeufer, player, tmRng(state, 'annahme:' + angebotId));
  const zusage = vertragAnbieten(state, angebot.kaeuferId, player.id, vertrag);
  if (!zusage.ok || zusage.status !== 'angenommen') {
    angebot.status = 'geplatzt';
    return {
      ok: false, status: 'spieler_lehnt_ab',
      text: `${clubName(state, angebot.kaeuferId)} und wir wären uns einig — aber ${name(player)} winkt ab. ${zusage.text}`
    };
  }
  const res = vollzieheTransfer(state, {
    playerId: player.id, kaeuferId: angebot.kaeuferId,
    ablose: angebot.ablose, vertrag: Object.assign({}, vertrag, { zugesagt: true }), typ: 'transfer'
  });
  if (res.ok) angebot.status = 'vollzogen';
  return res;
}

/** Eingegangenes Angebot ablehnen. */
export function angebotAblehnen(state, angebotId) {
  const found = findeAngebot(state, angebotId);
  if (!found) return { ok: false, text: 'Dieses Angebot liegt nicht mehr vor.' };
  found.angebot.status = 'abgelehnt';
  return { ok: true, text: `Abgelehnt. ${clubName(state, found.angebot.kaeuferId)} darf gern mit mehr Geld wiederkommen.` };
}

/**
 * Angebote ablaufen lassen, Bedenkzeiten auflösen, tote Verhandlungen räumen.
 * Wird von tickTransfers() aufgerufen, kann aber auch einzeln laufen.
 */
export function ablaufendeAngebote(state, ctx) {
  const tm = tmState(state);
  const tag = ctx && ctx.day !== undefined ? ctx.day : state.date.day;
  const meineId = state.managerClubId;
  const uebrig = [];

  for (const pid of tm.offeneSpieler) {
    const p = state.players[pid];
    if (!p || !p.transfer || !Array.isArray(p.transfer.angebote)) continue;
    let offenGeblieben = false;

    for (const a of p.transfer.angebote) {
      if (a.status === 'ueberlegt' && a.entscheidungTag !== undefined && tag >= a.entscheidungTag) {
        const rng = ctx && ctx.rng ? ctx.rng.fork('ueberlegt:' + a.id) : tmRng(state, 'ueberlegt');
        const details = abloseDetails(state, p.id, a.kaeuferId);
        const ratio = details.forderung > 0 ? a.wert / details.forderung : 2;
        if (rng.chance(clamp((ratio - 0.75) * 1.6 + details.verkaufsbereit * 0.4, 0.02, 0.9))) {
          a.status = 'angenommen';
          if (a.kaeuferId === meineId) {
            meldung(ctx, `${clubName(state, a.verkaeuferId)} hat unser Angebot über ${formatMoney(a.ablose)} für ${name(p)} angenommen. Jetzt liegt es am Spieler.`,
              'transfer', { from: 'Geschäftsstelle', subject: `Angebot angenommen: ${name(p)}`, wichtig: true });
          }
        } else {
          a.status = 'abgelehnt';
          if (a.kaeuferId === meineId) {
            meldung(ctx, `${clubName(state, a.verkaeuferId)} hat unser Angebot für ${name(p)} abgelehnt. Man wolle „mittelfristig planen" — was auch immer das heißt.`,
              'transfer', { from: 'Geschäftsstelle', subject: `Absage: ${name(p)}` });
          }
        }
      }

      if ((a.status === 'offen' || a.status === 'angenommen' || a.status === 'verhandlung') && tag > a.ablaufTag) {
        if (a.status === 'offen' && a.verkaeuferId === meineId) {
          meldung(ctx, `Das Angebot von ${clubName(state, a.kaeuferId)} für ${name(p)} über ${formatMoney(a.ablose)} ist verfallen. Man hat sich anderweitig orientiert.`,
            'transfer', { from: 'Geschäftsstelle', subject: `Angebot verfallen: ${name(p)}` });
        }
        a.status = 'verfallen';
      }
      if (a.status === 'offen' || a.status === 'ueberlegt' || a.status === 'verhandlung' || a.status === 'angenommen') {
        offenGeblieben = true;
      }
    }

    p.transfer.angebote = p.transfer.angebote.filter(
      a => a.status === 'offen' || a.status === 'ueberlegt' || a.status === 'verhandlung' || a.status === 'angenommen');
    if (offenGeblieben) uebrig.push(pid);
  }
  tm.offeneSpieler = uebrig;

  // Verhandlungen, die niemand mehr anfasst, sterben leise.
  tm.verhandlungen = tm.verhandlungen.filter(v => {
    if (v.status !== 'laufend') return false;
    if (tag - v.letzterTag > ANGEBOT_LAUFZEIT_TAGE) {
      if (v.kaeuferId === meineId) {
        meldung(ctx, `Die Verhandlungen um ${name(state.players[v.playerId])} sind eingeschlafen. ${clubName(state, v.verkaeuferId)} geht nicht mehr ans Telefon.`,
          'transfer', { from: 'Geschäftsstelle', subject: 'Verhandlung beendet' });
      }
      return false;
    }
    return true;
  });
  return { offen: tm.offeneSpieler.length, verhandlungen: tm.verhandlungen.length };
}

/* ==========================================================================
 * 7. Mehrstufige Verhandlung
 * ======================================================================== */

function verhandlungAnlegen(state, angebot, forderung, bereit) {
  const tm = tmState(state);
  const v = {
    id: neueId(state, 'vh'),
    angebotId: angebot.id,
    playerId: angebot.playerId,
    kaeuferId: angebot.kaeuferId,
    verkaeuferId: angebot.verkaeuferId,
    forderung,
    gebot: angebot.ablose,
    bonus: 0,
    raten: angebot.raten || 1,
    stimmung: clamp(Math.round(VERHANDLUNG_STIMMUNG_START + (bereit - 0.5) * 30), 10, 90),
    geduld: VERHANDLUNG_GEDULD_START,
    runde: 0,
    status: 'laufend',
    letzterTag: state.date.day,
    verkaufsbereit: bereit,
    historie: []
  };
  tm.verhandlungen.push(v);
  return v;
}

export function verhandlung(state, verhandlungId) {
  return tmState(state).verhandlungen.find(v => v.id === verhandlungId) || null;
}

export function laufendeVerhandlungen(state, clubId) {
  return tmState(state).verhandlungen.filter(
    v => v.status === 'laufend' && (v.kaeuferId === clubId || v.verkaeuferId === clubId));
}

function stimmungsText(s) {
  if (s >= 80) return 'bestens gelaunt';
  if (s >= 62) return 'aufgeschlossen';
  if (s >= 45) return 'sachlich';
  if (s >= 30) return 'zugeknöpft';
  if (s >= VERHANDLUNG_PLATZT_UNTER) return 'sichtlich genervt';
  return 'kurz vor dem Türknallen';
}

/**
 * Eine Runde in einer laufenden Verhandlung.
 * @param aktion 'erhoehen' | 'halten' | 'druck' | 'raten' | 'bonus' | 'abbrechen'
 * @param wert   je nach Aktion: neues Gebot, Anzahl Raten, Bonushöhe
 */
export function verhandlungRunde(state, verhandlungId, aktion, wert) {
  const v = verhandlung(state, verhandlungId);
  if (!v) return { ok: false, status: 'unbekannt', text: 'Diese Verhandlung gibt es nicht mehr.' };
  if (v.status !== 'laufend') return { ok: false, status: v.status, text: 'Diese Verhandlung ist abgeschlossen.' };

  const p = state.players[v.playerId];
  const gegner = clubName(state, v.verkaeuferId);
  const rng = tmRng(state, 'verhandlung:' + v.id);
  v.runde++;
  v.letzterTag = state.date.day;
  let text = '';

  const abschluss = () => {
    v.status = 'einig';
    return {
      ok: true, status: 'einig', stimmung: v.stimmung, stimmungText: stimmungsText(v.stimmung),
      forderung: v.forderung, gebot: v.gebot, runde: v.runde, verhandlung: v,
      text: `Handschlag! ${gegner} gibt ${name(p)} für ${formatMoney(v.gebot)} frei. Fehlt nur noch die Unterschrift des Spielers.`
    };
  };
  const platzen = (grund) => {
    v.status = 'geplatzt';
    const ang = findeAngebot(state, v.angebotId);
    if (ang) ang.angebot.status = 'geplatzt';
    return {
      ok: false, status: 'geplatzt', stimmung: v.stimmung, stimmungText: stimmungsText(v.stimmung),
      forderung: v.forderung, gebot: v.gebot, runde: v.runde, verhandlung: v, text: grund
    };
  };

  switch (aktion) {
    case 'abbrechen': {
      v.status = 'abgebrochen';
      const ang = findeAngebot(state, v.angebotId);
      if (ang) ang.angebot.status = 'abgebrochen';
      return {
        ok: true, status: 'abgebrochen', stimmung: v.stimmung, stimmungText: stimmungsText(v.stimmung),
        forderung: v.forderung, gebot: v.gebot, runde: v.runde, verhandlung: v,
        text: 'Wir legen auf. Manchmal ist das die beste Verhandlungstaktik — manchmal auch nicht.'
      };
    }
    case 'erhoehen': {
      const neu = Math.max(v.gebot, Math.round((wert || v.gebot) / WERT_RASTER) * WERT_RASTER);
      const delta = neu - v.gebot;
      if (delta <= 0) {
        v.stimmung -= 6; v.geduld -= 1;
        text = `„Das war doch schon Ihr letztes Angebot." ${gegner} ist ${stimmungsText(v.stimmung)}.`;
      } else {
        v.gebot = neu;
        const anteil = clamp(delta / Math.max(1, v.forderung), 0, 0.5);
        v.stimmung = clamp(v.stimmung + VERHANDLUNG_ERHOEHEN_STIMMUNG * (0.4 + anteil * 4), 0, 100);
        v.geduld -= 0.5;
        text = `Wir gehen auf ${formatMoney(neu)}. ${gegner} rechnet nach und wirkt ${stimmungsText(v.stimmung)}.`;
      }
      break;
    }
    case 'halten': {
      v.stimmung = clamp(v.stimmung + VERHANDLUNG_HALTEN_STIMMUNG, 0, 100);
      v.geduld -= 1;
      // Wer hart bleibt, kann den Gegner weichkochen — wenn der verkaufen will.
      if (rng.chance(clamp(v.verkaufsbereit * 0.55, 0.05, 0.5))) {
        v.forderung = Math.round(v.forderung * 0.96 / WERT_RASTER) * WERT_RASTER;
        text = `Wir bleiben stur. Nach langem Schweigen rutscht ${gegner} auf ${formatMoney(v.forderung)} herunter.`;
      } else {
        text = `Wir bleiben stur. ${gegner} auch. Das Telefon knistert.`;
      }
      break;
    }
    case 'druck': {
      v.stimmung = clamp(v.stimmung + VERHANDLUNG_DRUCK_STIMMUNG, 0, 100);
      v.geduld -= 1.5;
      const wirkung = clamp(v.verkaufsbereit * 0.7 + (p && restlaufzeit(state, p) <= 0 ? 0.25 : 0), 0.05, 0.75);
      if (rng.chance(wirkung)) {
        v.forderung = Math.round(v.forderung * (1 - VERHANDLUNG_DRUCK_RABATT) / WERT_RASTER) * WERT_RASTER;
        text = `Wir erinnern höflich daran, dass der Vertrag ausläuft. ${gegner} zuckt: ${formatMoney(v.forderung)}.`;
      } else {
        text = `Unser Druckversuch verpufft. ${gegner} ist jetzt ${stimmungsText(v.stimmung)}.`;
      }
      break;
    }
    case 'raten': {
      const raten = clamp(Math.round(wert || 2), 1, 5);
      v.raten = raten;
      v.forderung = Math.round(v.forderung * (1 + (raten - 1) * RATEN_AUFSCHLAG) / WERT_RASTER) * WERT_RASTER;
      v.stimmung = clamp(v.stimmung - 3 * (raten - 1), 0, 100);
      v.geduld -= 0.5;
      text = raten > 1
        ? `Zahlung in ${raten} Raten. ${gegner} akzeptiert — verlangt dafür aber ${formatMoney(v.forderung)}.`
        : 'Wir bieten sofortige Zahlung an. Das kommt gut an.';
      if (raten === 1) v.stimmung = clamp(v.stimmung + 6, 0, 100);
      break;
    }
    case 'bonus': {
      const bonus = Math.max(0, Math.round(wert || 0));
      v.bonus += bonus;
      v.stimmung = clamp(v.stimmung + VERHANDLUNG_BONUS_STIMMUNG, 0, 100);
      v.geduld -= 0.5;
      text = `Wir legen Bonuszahlungen über ${formatMoney(bonus)} obendrauf. ${gegner} nickt anerkennend.`;
      break;
    }
    default:
      return { ok: false, status: 'laufend', text: 'Unbekannte Verhandlungsaktion.' };
  }

  v.historie.push({ runde: v.runde, aktion, gebot: v.gebot, forderung: v.forderung, stimmung: Math.round(v.stimmung) });

  if (v.stimmung < VERHANDLUNG_PLATZT_UNTER) {
    return platzen(`${gegner} knallt den Hörer auf. „Mit Ihnen rede ich nicht mehr." Die Verhandlung ist geplatzt.`);
  }
  if (v.geduld <= 0) {
    return platzen(`${gegner} hat die Geduld verloren und den Spieler vom Markt genommen.`);
  }
  if (v.runde >= VERHANDLUNG_MAX_RUNDEN) {
    return platzen('Nach acht Runden Feilschen bricht der Gegner entnervt ab. So kommen wir nicht weiter.');
  }

  const gesamt = angebotsWert(v.gebot, { bonus: v.bonus, raten: v.raten });
  const schwelle = v.forderung * (1 - clamp((v.stimmung - 50) / 500, -0.03, 0.06));
  if (gesamt >= schwelle) {
    const ang = findeAngebot(state, v.angebotId);
    if (ang) { ang.angebot.status = 'angenommen'; ang.angebot.ablose = v.gebot; ang.angebot.wert = gesamt; }
    return abschluss();
  }

  return {
    ok: true, status: 'laufend', stimmung: Math.round(v.stimmung), stimmungText: stimmungsText(v.stimmung),
    forderung: v.forderung, gebot: v.gebot, runde: v.runde, geduld: Math.max(0, round(v.geduld, 1)),
    verhandlung: v, text
  };
}

/* ==========================================================================
 * 8. Vertragsangebot an den Spieler
 * ======================================================================== */

const ROLLEN_RANG = { stammspieler: 3, rotation: 2, talent: 1.5, ergaenzung: 1 };

/** Welche Rolle darf der Spieler in diesem Kader realistisch erwarten? */
function erwarteteRolle(state, club, p) {
  const kader = kaderOf(state, club.id).filter(x => x.id !== p.id);
  const wert = playerRatingForSlot(p, p.position);
  let besser = 0;
  for (const x of kader) if (playerRatingForSlot(x, x.position) > wert) besser++;
  if (besser <= 10) return 'stammspieler';
  if (besser <= 15) return 'rotation';
  return p.age <= 21 ? 'talent' : 'ergaenzung';
}

/** Anspruch des Spielers an seine Rolle — abgeleitet aus seiner aktuellen Stellung. */
function rollenAnspruch(state, p) {
  if (!p.clubId) return p.age >= 30 ? 2 : 2.2;
  const rolle = kaderRolle(state, p);
  if (rolle === 'star') return 3.2;
  if (rolle === 'stamm') return 2.8;
  if (rolle === 'rotation') return 2.1;
  return 1.6;
}

/**
 * Vertragsangebot an einen Spieler.
 * @param angebot { gehalt, laufzeit, handgeld, ausstiegsklausel,
 *                  praemien:{tor,einsatz,titel}, rolle }
 * @returns {{ok, status:'angenommen'|'abgelehnt'|'gegenforderung'|'ueberlegt',
 *            forderung, text, provision}}
 */
export function vertragAnbieten(state, clubId, playerId, angebot = {}) {
  const club = cl(state, clubId);
  const p = sp(state, playerId);
  if (!club) return { ok: false, status: 'abgelehnt', forderung: null, text: 'Unbekannter Verein.' };
  if (!p) return { ok: false, status: 'abgelehnt', forderung: null, text: 'Unbekannter Spieler.' };

  const rng = angebot.rng || tmRng(state, 'vertrag:' + playerId);
  const verlaengerung = p.clubId === clubId;
  const wunschGehalt = wunschgehalt(state, p, club, verlaengerung);
  const gehalt = Math.max(0, Math.round(angebot.gehalt || 0));
  const laufzeit = clamp(Math.round(angebot.laufzeit || 3), 1, 6);
  const handgeld = Math.max(0, Math.round(angebot.handgeld || 0));
  const rolle = ROLLEN_RANG[angebot.rolle] ? angebot.rolle : 'rotation';
  const pers = p.personality || {};

  let score = 0;
  const gruende = [];

  /* --- Geld --------------------------------------------------------------- */
  const gehaltRatio = wunschGehalt > 0 ? gehalt / wunschGehalt : 1;
  const geldScore = clamp((gehaltRatio - 1), -0.6, 0.8) * V_GEHALT;
  score += geldScore;
  if (geldScore < -12) gruende.push('Das Gehalt ist deutlich unter seinen Vorstellungen.');
  else if (geldScore > 12) gruende.push('Das Gehaltsangebot ist üppig.');

  score += clamp(handgeld / Math.max(1, wunschGehalt), 0, 1.2) * V_HANDGELD;
  if (angebot.ausstiegsklausel && angebot.ausstiegsklausel > 0) score += V_KLAUSEL;
  const pr = angebot.praemien || {};
  if ((pr.tor || 0) + (pr.einsatz || 0) + (pr.titel || 0) > 0) score += V_PRAEMIEN;

  /* --- Verein & Perspektive ------------------------------------------------ */
  if (!verlaengerung) {
    const alt = p.clubId ? cl(state, p.clubId) : null;
    const repNeu = club.reputation || 50;
    const repAlt = alt ? (alt.reputation || 50) : 38;
    const diff = repNeu - repAlt;
    score += diff * V_REPUTATION * (pers.ambition || 1);
    if (diff < -8) gruende.push(`${club.shortName || club.name} ist sportlich ein Rückschritt.`);
    if (diff > 8) gruende.push('Der Verein ist eine klare Verbesserung.');

    if (alt) {
      const tierNeu = ligaTier(club.id), tierAlt = ligaTier(alt.id);
      if (tierNeu < tierAlt) { score += V_LIGA; gruende.push('Eine Liga höher — das reizt.'); }
      else if (tierNeu > tierAlt) { score -= V_LIGA; gruende.push('Zweite Liga? Da muss schon etwas anderes stimmen.'); }
      score -= V_LOYALITAET * clamp((pers.loyalty || 1) - 0.9, -0.4, 0.8);
    }
    if (p.era === 'legend' && p.clubId) {
      score -= LEGENDE_WECHSEL_HUERDE;
      gruende.push(`${name(p)} ist mit diesem Verein verwachsen. Ein Wechsel wäre ein Bruch.`);
    }
  } else {
    score += V_VERLAENGERUNG_BONUS * clamp(pers.loyalty || 1, 0.5, 1.6);
    if (p.era === 'legend') score += 10;
  }

  /* --- Spielzeit ----------------------------------------------------------- */
  const real = erwarteteRolle(state, club, p);
  const versprechen = ROLLEN_RANG[rolle];
  const realWert = ROLLEN_RANG[real];
  const glaubwuerdig = clamp(1 - Math.max(0, versprechen - realWert) * 0.32, 0.25, 1);
  const anspruch = rollenAnspruch(state, p);
  const spielzeit = (versprechen * glaubwuerdig - anspruch) * V_SPIELZEIT;
  score += spielzeit;
  if (spielzeit < -10) gruende.push('Er sieht sich in diesem Kader nur auf der Bank.');
  else if (spielzeit > 8) gruende.push('Die Aussicht auf Spielzeit gefällt ihm.');

  /* --- Heimat, Landsleute, Trainer ---------------------------------------- */
  if (p.nationality === 'DE') score += V_HEIMAT * 0.5;
  const landsleute = kaderOf(state, club.id).filter(x => x.nationality === p.nationality && x.id !== p.id).length;
  if (landsleute >= 2) { score += V_LANDSLEUTE; gruende.push('Er hätte hier Landsleute in der Kabine.'); }
  if (clubId === state.managerClubId && state.manager) {
    const rep = state.manager.reputation || 40;
    score += (rep - 40) * V_TRAINER;
    if (rep >= 70) gruende.push('Ihr Ruf als Trainer öffnet Türen.');
    else if (rep < 25) gruende.push('Von Ihnen als Trainer hat er noch nie gehört.');
  }

  /* --- Laufzeit & Alter ---------------------------------------------------- */
  const wunschLaufzeit = p.age >= 33 ? 1 : p.age >= 30 ? 2 : p.age <= 22 ? 4 : 3;
  score -= Math.abs(laufzeit - wunschLaufzeit) * V_LAUFZEIT_PASSEND * 0.5;
  if (laufzeit >= wunschLaufzeit && p.age >= 31) score += V_ALTER_SICHERHEIT;

  /* --- Charakter & Zufall --------------------------------------------------- */
  if (pers.id === 'geldgierig') score += geldScore * 0.5;
  if (pers.id === 'ehrgeizig') score += spielzeit * 0.35;
  if (pers.id === 'loyal' && verlaengerung) score += 8;
  score += rng.gauss(0, V_STREUUNG);

  const provision = beraterProvision(state, p.id, 0);
  const forderung = {
    gehalt: Math.round(wunschGehalt / GEHALT_RASTER) * GEHALT_RASTER,
    laufzeit: wunschLaufzeit,
    handgeld: Math.round(wunschGehalt * 0.3 / GEHALT_RASTER) * GEHALT_RASTER,
    provision,
    rolle: real
  };

  if (score >= V_JA_SCHWELLE) {
    return {
      ok: true, status: 'angenommen', forderung, provision, score: round(score, 1), gruende,
      text: `${name(p)} sagt zu. Der Berater will ${formatMoney(provision)} Provision — natürlich sofort.`
    };
  }
  if (score >= V_GEGEN_SCHWELLE) {
    const aufschlag = clamp(1 + (V_JA_SCHWELLE - score) / 160, 1.03, 1.45);
    forderung.gehalt = Math.round(wunschGehalt * aufschlag / GEHALT_RASTER) * GEHALT_RASTER;
    return {
      ok: true, status: 'gegenforderung', forderung, provision, score: round(score, 1), gruende,
      text: `${name(p)} zögert. Sein Berater nennt eine Zahl: ${formatMoney(forderung.gehalt)} pro Jahr, ${forderung.laufzeit} Jahre.` +
        (gruende.length ? ' ' + gruende[0] : '')
    };
  }
  return {
    ok: true, status: 'abgelehnt', forderung, provision, score: round(score, 1), gruende,
    text: `${name(p)} lehnt ab. ${gruende[0] || 'Er hat andere Pläne.'}`
  };
}

/** Was der Spieler verdienen möchte. */
function wunschgehalt(state, p, club, verlaengerung) {
  let g = marktGehalt(state, p, club.id);
  const pers = p.personality || {};
  g *= 1 + clamp((pers.ambition || 1) - 1, -0.3, 0.5) * 0.12;
  if (pers.id === 'geldgierig') g *= 1.18;
  if (pers.id === 'loyal' && verlaengerung) g *= 0.94;
  // Wer schon gut verdient, geht nicht freiwillig runter.
  const ist = p.contract ? p.contract.salary || 0 : 0;
  if (ist > g) g = ist * (verlaengerung ? 1.06 : 1.12);
  else if (!verlaengerung) g *= 1.08;   // Wechselprämie
  return Math.max(GEHALT_MIN, Math.round(g / GEHALT_RASTER) * GEHALT_RASTER);
}

/** Vertragsverlängerung mit einem eigenen Spieler — wird bei Zusage sofort wirksam. */
export function vertragVerlaengern(state, playerId, angebot = {}) {
  const p = sp(state, playerId);
  if (!p) return { ok: false, status: 'abgelehnt', text: 'Unbekannter Spieler.' };
  if (!p.clubId) return { ok: false, status: 'abgelehnt', text: `${name(p)} hat gar keinen Verein — das wäre eine Verpflichtung, keine Verlängerung.` };
  const club = cl(state, p.clubId);
  const antwort = vertragAnbieten(state, p.clubId, playerId, angebot);
  if (antwort.status !== 'angenommen') return antwort;

  const provision = antwort.provision;
  const handgeld = Math.max(0, Math.round(angebot.handgeld || 0));
  const kosten = provision + handgeld;
  if ((club.finances.balance || 0) < kosten) {
    return { ok: false, status: 'abgelehnt', forderung: antwort.forderung,
      text: `${name(p)} würde unterschreiben — aber Handgeld und Provision (${formatMoney(kosten)}) sind nicht in der Kasse.` };
  }
  if (kosten > 0) buche(state, club, -kosten, `Vertragsverlängerung ${name(p)}`);

  const laufzeit = clamp(Math.round(angebot.laufzeit || 3), 1, 6);
  p.contract.salary = Math.round(angebot.gehalt || p.contract.salary);
  p.contract.until = state.date.season + laufzeit;
  p.contract.signOn = handgeld;
  if (angebot.ausstiegsklausel !== undefined) p.contract.releaseClause = angebot.ausstiegsklausel || null;
  if (angebot.praemien) p.contract.praemien = angebot.praemien;
  if (angebot.rolle) p.contract.rolle = angebot.rolle;
  p.morale = clamp((p.morale || 70) + 6, 0, 100);
  if (p.happiness) p.happiness.gehalt = clamp(p.happiness.gehalt + 15, 0, 100);
  if (p.transfer) { p.transfer.wunschWechsel = false; }

  return {
    ok: true, status: 'angenommen', forderung: antwort.forderung, provision,
    text: `${name(p)} verlängert bis Saison ${p.contract.until}. ${formatMoney(provision)} Provision für den Berater — der Mann hat gut lachen.`
  };
}

/** Alle Spieler eines Vereins, deren Vertrag ausläuft. */
export function auslaufendeVertraege(state, clubId, opts = {}) {
  const jahre = opts.jahre !== undefined ? opts.jahre : 0;
  const club = cl(state, clubId);
  if (!club) return [];
  const out = kaderOf(state, clubId)
    .filter(p => restlaufzeit(state, p) <= jahre)
    .map(p => {
      const wunsch = wunschgehalt(state, p, club, true);
      return {
        playerId: p.id, player: p,
        restlaufzeit: restlaufzeit(state, p),
        laeuftAus: restlaufzeit(state, p) <= 0,
        rolle: kaderRolle(state, p),
        marktwert: marktwert(state, p),
        gehalt: p.contract.salary,
        forderung: { gehalt: wunsch, laufzeit: p.age >= 33 ? 1 : p.age >= 30 ? 2 : 3, provision: beraterProvision(state, p.id, 0) },
        ablosefreiAb: `Saison ${p.contract.until + 1}`
      };
    });
  return sortBy(out, e => e.restlaufzeit, e => ({ key: e.marktwert, desc: true }));
}

/* ==========================================================================
 * 9. Transfervollzug
 * ======================================================================== */

/** Räumt einen abgegebenen Spieler aus Aufstellung, Liste und Beobachtung. */
function entferneAusVerein(state, club, p) {
  club.playerIds = club.playerIds.filter(id => id !== p.id);
  if (Array.isArray(club.transferliste)) club.transferliste = club.transferliste.filter(id => id !== p.id);

  const t = club.tactics;
  let warAufgestellt = false;
  if (t) {
    if (t.lineup) {
      for (const slot in t.lineup) if (t.lineup[slot] === p.id) { delete t.lineup[slot]; warAufgestellt = true; }
    }
    if (Array.isArray(t.bench) && t.bench.includes(p.id)) {
      t.bench = t.bench.filter(id => id !== p.id);
      warAufgestellt = true;
    }
    if (t.roles && t.roles[p.id]) delete t.roles[p.id];
    if (t.setPieces) {
      for (const k in t.setPieces) if (t.setPieces[k] === p.id) t.setPieces[k] = null;
    }
    if (t.manMarking === p.id) t.manMarking = null;
  }
  // KI-Vereine stellen sich sofort neu auf; die Elf des Managers rührt niemand an.
  if (warAufgestellt && club.id !== state.managerClubId) {
    club.tactics = autoLineup(kaderOf(state, club.id), club.tactics || {});
  }
  return warAufgestellt;
}

/** Fan- und Vorstandsreaktion auf einen Abgang. */
function abgangsReaktion(state, club, p, ablose, ctx) {
  const istManager = club.id === state.managerClubId;
  const rolle = kaderRolle(state, p);
  let protest = 0;
  let stimmung = 0;

  if (p.era === 'legend') {
    protest += LEGENDE_PROTEST;
    stimmung += LEGENDE_PROTEST_STIMMUNG;
    club.board.zufriedenheit = clamp((club.board.zufriedenheit || 60) + LEGENDE_PROTEST_VORSTAND, 0, 100);
  }
  if ((p.traits || []).includes('fanliebling')) { protest += FANLIEBLING_PROTEST; stimmung -= 5; }
  if (rolle === 'star' || rolle === 'stamm') { protest += STAMM_PROTEST; stimmung -= 3; }
  // Viel Geld beruhigt die Gemüter ein wenig.
  const trost = clamp(ablose / Math.max(1, marktwert(state, p)) - 1, 0, 1) * 6;
  protest = Math.max(0, protest - trost);
  stimmung += trost * 0.5;

  if (protest > 0 || stimmung !== 0) {
    club.fans.protest = clamp((club.fans.protest || 0) + Math.round(protest), 0, 100);
    club.fans.mood = clamp((club.fans.mood || 60) + Math.round(stimmung), 0, 100);
  }

  if (p.era === 'legend') {
    const txt = `${name(p)} verlässt ${club.shortName || club.name}. Vor der Geschäftsstelle brennen Transparente: „Ihr verkauft unsere Seele."`;
    if (istManager) {
      meldung(ctx, txt + ` Der Fanbeauftragte bittet dringend um einen Rückruf. Protestpegel: ${club.fans.protest}.`,
        'fans', { from: 'Fanbeauftragter', subject: `Aufruhr: Verkauf von ${name(p)}`, wichtig: true });
    }
    ticker(ctx, txt, 'transfer');
  } else if (istManager && (rolle === 'star' || rolle === 'stamm')) {
    meldung(ctx, `${name(p)} ist weg. Auf der Tribüne wird gefragt, wer das jetzt spielen soll.`,
      'fans', { from: 'Fanbeauftragter', subject: `Abgang: ${name(p)}` });
  }
}

/** Fanreaktion auf einen Zugang. */
function zugangsReaktion(state, club, p, ablose, ctx) {
  let stimmung = 0;
  if (p.era === 'legend') stimmung += LEGENDE_ZUGANG_JUBEL;
  if (ablose >= GROSSTRANSFER) stimmung += REKORD_JUBEL;
  else if (ablose >= GROSSTRANSFER / 3) stimmung += 2;
  if (stimmung > 0) {
    club.fans.mood = clamp((club.fans.mood || 60) + stimmung, 0, 100);
    club.fans.protest = clamp((club.fans.protest || 0) - stimmung * 0.6, 0, 100);
  }
}

/**
 * Kern des Transfers: Geld, Kader, Vertrag, Historie, Stimmung.
 * Wird von spielerVerpflichten() und spielerVerkaufen() benutzt.
 */
function vollzieheTransfer(state, o) {
  const p = sp(state, o.playerId);
  const kaeufer = cl(state, o.kaeuferId);
  if (!p || !kaeufer) return { ok: false, text: 'Transfer nicht möglich: unbekannte Beteiligte.' };
  const verkaeufer = p.clubId ? cl(state, p.clubId) : null;
  const ctx = o.ctx || null;
  const ablose = Math.max(0, Math.round(o.ablose || 0));
  const vertrag = o.vertrag || {};
  const provision = beraterProvision(state, p.id, ablose);
  const handgeld = Math.max(0, Math.round(vertrag.handgeld || 0));
  const kosten = ablose + provision + handgeld;

  if (kaeufer.playerIds.length >= MAX_KADER) {
    return { ok: false, text: `Der Kader ist voll (${MAX_KADER} Spieler). Erst muss jemand gehen.` };
  }
  // KI-Vereine dürfen den Dispo nutzen (club/finances.js verzinst ihn und
  // verhängt bei echter Schieflage eine Transfersperre). Der Manager nicht:
  // sein Konto muss den Transfer wirklich hergeben.
  const kassenrahmen = (kaeufer.finances.balance || 0) + (o.ki ? dispoRahmen(kaeufer) : 0);
  if (kassenrahmen < kosten) {
    return { ok: false, text: `Die Kasse gibt das nicht her: ${formatMoney(kosten)} nötig, ${formatMoney(kaeufer.finances.balance || 0)} vorhanden.` };
  }
  if (kaeufer.finances.transfersperre) {
    return { ok: false, text: `${kaeufer.shortName || kaeufer.name} hat eine Transfersperre — da unterschreibt niemand.` };
  }

  // --- Geld ---------------------------------------------------------------
  buche(state, kaeufer, -kosten, `Verpflichtung ${name(p)}` + (verkaeufer ? ` von ${verkaeufer.shortName || verkaeufer.name}` : ' (ablösefrei)'), ctx);
  kaeufer.finances.transferBudget = Math.max(0, Math.round((kaeufer.finances.transferBudget || 0) - kosten));
  if (verkaeufer && ablose > 0) {
    buche(state, verkaeufer, ablose, `Verkauf ${name(p)} an ${kaeufer.shortName || kaeufer.name}`, ctx);
    verkaeufer.finances.transferBudget = Math.round((verkaeufer.finances.transferBudget || 0) + ablose * KI_WIEDERANLAGE);
  }

  // --- Kader --------------------------------------------------------------
  if (verkaeufer) {
    entferneAusVerein(state, verkaeufer, p);
    abgangsReaktion(state, verkaeufer, p, ablose, ctx);
  } else {
    state.freeAgents = (state.freeAgents || []).filter(id => id !== p.id);
  }

  kaeufer.playerIds.push(p.id);
  const altClubId = p.clubId;
  p.clubId = kaeufer.id;
  p.number = freieNummer(state, kaeufer, p);
  p.contract = {
    salary: Math.round(vertrag.gehalt || marktGehalt(state, p, kaeufer.id)),
    until: state.date.season + clamp(Math.round(vertrag.laufzeit || 3), 1, 6),
    signOn: handgeld,
    releaseClause: vertrag.ausstiegsklausel || null,
    praemien: vertrag.praemien || null,
    rolle: vertrag.rolle || 'rotation'
  };
  p.joined = { season: state.date.season, day: state.date.day };
  p.seasonsAtClub = 0;
  p.captain = false;
  p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
  p.morale = clamp((p.morale || 70) + 8, 0, 100);
  if (p.happiness) {
    p.happiness.spielzeit = 60;
    p.happiness.gehalt = clamp(60 + (p.contract.salary / Math.max(1, marktGehalt(state, p, kaeufer.id)) - 1) * 60, 10, 99);
    p.happiness.beschwerden = [];
  }
  // Neuzugänge müssen sich erst einfügen — das kostet Chemie.
  kaeufer.chemistryHistory = clamp((kaeufer.chemistryHistory || 30) - 4, 0, 100);
  if (kaeufer.id !== state.managerClubId) {
    kaeufer.tactics = autoLineup(kaderOf(state, kaeufer.id), kaeufer.tactics || {});
  }
  zugangsReaktion(state, kaeufer, p, ablose, ctx);

  // --- Buchhaltung des Marktes ---------------------------------------------
  const tm = tmState(state);
  tm.saison.transfers++;
  tm.saison.volumen += ablose;
  kiKonto(state, kaeufer.id).zugaenge++;
  if (verkaeufer) kiKonto(state, verkaeufer.id).abgaenge++;

  if (!state.history) state.history = { seasons: [], transfers: [], titel: {} };
  if (!Array.isArray(state.history.transfers)) state.history.transfers = [];
  const eintrag = {
    season: state.date.season, day: state.date.day,
    playerId: p.id, name: `${p.firstName} ${p.lastName}`,
    vonId: altClubId || null, zuId: kaeufer.id,
    ablose, gehalt: p.contract.salary, typ: o.typ || 'transfer', era: p.era,
    grund: o.grund || null
  };
  state.history.transfers.push(eintrag);
  if (state.history.transfers.length > 1200) state.history.transfers.shift();

  // --- Öffentlichkeit -------------------------------------------------------
  const meineId = state.managerClubId;
  const vonTxt = altClubId ? clubName(state, altClubId) : 'ablösefrei';
  if (kaeufer.id === meineId) {
    meldung(ctx, `${p.firstName} ${p.lastName} (${POSITION_NAMES[p.position]}, ${p.age}) unterschreibt bis Saison ${p.contract.until}. ` +
      `Ablöse ${formatMoney(ablose)}, Gehalt ${formatMoney(p.contract.salary)} pro Jahr, Beraterprovision ${formatMoney(provision)}.`,
      'transfer', { from: 'Geschäftsstelle', subject: `Zugang: ${name(p)}`, wichtig: true });
  } else if (verkaeufer && verkaeufer.id === meineId) {
    meldung(ctx, `${p.firstName} ${p.lastName} wechselt für ${formatMoney(ablose)} zu ${kaeufer.shortName || kaeufer.name}. Das Geld ist auf dem Konto.`,
      'transfer', { from: 'Geschäftsstelle', subject: `Abgang: ${name(p)}`, wichtig: true });
  }
  if (ablose >= GROSSTRANSFER || p.era === 'legend' || kaeufer.id === meineId || (verkaeufer && verkaeufer.id === meineId)) {
    ticker(ctx, `${p.firstName} ${p.lastName} wechselt von ${vonTxt} zu ${kaeufer.shortName || kaeufer.name}` +
      (ablose > 0 ? ` — ${formatMoney(ablose)}.` : ' — ablösefrei.'), 'transfer');
  }

  return {
    ok: true, status: 'vollzogen', playerId: p.id, kaeuferId: kaeufer.id,
    verkaeuferId: altClubId || null, ablose, provision, kosten,
    text: `${p.firstName} ${p.lastName} wechselt zu ${kaeufer.shortName || kaeufer.name}. Ablöse ${formatMoney(ablose)}, Provision ${formatMoney(provision)}.`
  };
}

/**
 * Spieler verpflichten. Prüft Fenster, Kasse, Gehaltsetat und — falls nicht
 * über vertrag.zugesagt bestätigt — auch die Zusage des Spielers.
 */
export function spielerVerpflichten(state, clubId, playerId, ablose, vertrag = {}) {
  const club = cl(state, clubId);
  const p = sp(state, playerId);
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  if (!p) return { ok: false, text: 'Unbekannter Spieler.' };
  if (p.clubId === clubId) return { ok: false, text: `${name(p)} spielt bereits bei uns.` };
  if (!transferFensterOffen(state) && !istVertragslos(state, p)) {
    return { ok: false, text: 'Das Transferfenster ist zu. Vertragslose Spieler dürfen Sie trotzdem holen.' };
  }
  if (club.playerIds.length >= MAX_KADER) {
    return { ok: false, text: `Mit ${club.playerIds.length} Spielern ist der Kader voll.` };
  }
  if (club.finances && club.finances.transfersperre) {
    return { ok: false, text: 'Die Lizenzabteilung hat uns eine Transfersperre erteilt. Zugänge sind bis auf Weiteres nicht möglich.' };
  }
  const gehalt = Math.round(vertrag.gehalt || marktGehalt(state, p, clubId));
  const spielraum = gehaltsspielraum(state, club);
  if (gehalt > spielraum && !vertrag.ignoriereEtat) {
    return { ok: false, text: `Der Gehaltsetat lässt nur noch ${formatMoney(spielraum)} zu — gefordert sind ${formatMoney(gehalt)}.` };
  }
  if (!vertrag.zugesagt) {
    const zusage = vertragAnbieten(state, clubId, playerId, Object.assign({ gehalt }, vertrag));
    if (zusage.status !== 'angenommen') {
      return { ok: false, status: zusage.status, forderung: zusage.forderung, text: zusage.text };
    }
  }
  return vollzieheTransfer(state, {
    playerId, kaeuferId: clubId, ablose,
    vertrag: Object.assign({}, vertrag, { gehalt }), typ: 'transfer', ctx: vertrag.ctx
  });
}

/**
 * Einen eigenen Spieler verkaufen. Der Käufer muss zahlen können und der
 * Spieler muss mitspielen — Legenden kosten obendrein die Fanstimmung.
 */
export function spielerVerkaufen(state, playerId, kaeuferId, ablose, opts = {}) {
  const p = sp(state, playerId);
  if (!p) return { ok: false, text: 'Unbekannter Spieler.' };
  if (!p.clubId) return { ok: false, text: `${name(p)} gehört gar keinem Verein.` };
  const verkaeufer = cl(state, p.clubId);
  const kaeufer = cl(state, kaeuferId);
  if (!kaeufer) return { ok: false, text: 'Unbekannter Käufer.' };
  if (!transferFensterOffen(state)) return { ok: false, text: 'Außerhalb des Transferfensters wird kein Spieler verkauft.' };
  if (verkaeufer.playerIds.length <= MIN_KADER && !opts.egal) {
    return { ok: false, text: `Mit nur ${verkaeufer.playerIds.length} Spielern im Kader wäre das grob fahrlässig.` };
  }
  if (p.transfer && p.transfer.leihe && p.transfer.leihe.stammvereinId) {
    return { ok: false, text: `${name(p)} ist nur ausgeliehen. Verkaufen kann ihn nur ${clubName(state, p.transfer.leihe.stammvereinId)}.` };
  }

  ablose = Math.max(0, Math.round(ablose || 0));
  const provision = beraterProvision(state, p.id, ablose);
  if ((kaeufer.finances.balance || 0) < ablose + provision) {
    return { ok: false, text: `${kaeufer.shortName || kaeufer.name} kann das nicht bezahlen.` };
  }
  const vertrag = opts.vertrag || kiVertragsangebot(state, kaeufer, p, tmRng(state, 'verkauf:' + playerId));
  if (!opts.ohnePruefung) {
    const zusage = vertragAnbieten(state, kaeuferId, playerId, vertrag);
    if (zusage.status !== 'angenommen') {
      return { ok: false, status: 'spieler_lehnt_ab', text: `${name(p)} weigert sich zu wechseln. ${zusage.text}` };
    }
  }
  const warnung = hinterlaesstLuecke(state, verkaeufer, p)
    ? ` Achtung: Auf seiner Position steht danach niemand mehr.` : '';
  const res = vollzieheTransfer(state, {
    playerId, kaeuferId, ablose,
    vertrag: Object.assign({}, vertrag, { zugesagt: true }), typ: 'transfer', ctx: opts.ctx
  });
  if (res.ok && warnung) res.text += warnung;
  return res;
}

/** Spieler auf die Transferliste setzen bzw. herunternehmen. */
export function transferlisteSetzen(state, playerId, gelistet = true) {
  const p = sp(state, playerId);
  if (!p) return { ok: false, text: 'Unbekannter Spieler.' };
  if (!p.clubId) return { ok: false, text: 'Vertragslose Spieler stehen ohnehin allen offen.' };
  const club = cl(state, p.clubId);
  if (!p.transfer) p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
  p.transfer.listed = !!gelistet;
  if (!Array.isArray(club.transferliste)) club.transferliste = [];
  if (gelistet) {
    if (!club.transferliste.includes(p.id)) club.transferliste.push(p.id);
    p.morale = clamp((p.morale || 70) - 8, 0, 100);
    return { ok: true, text: `${name(p)} steht auf der Transferliste. Er hat es aus der Zeitung erfahren und ist entsprechend gut gelaunt.` };
  }
  club.transferliste = club.transferliste.filter(id => id !== p.id);
  return { ok: true, text: `${name(p)} ist wieder von der Liste.` };
}

/* ==========================================================================
 * 10. Leihen
 * ======================================================================== */

/**
 * Leihe anfragen. clubId ist der aufnehmende Verein.
 * @param opts { dauer:'saison'|'halbsaison', gehaltsanteil:0..1, kaufoption:Euro|null, pflichtkauf:bool }
 */
export function leiheAnbieten(state, clubId, playerId, opts = {}) {
  const club = cl(state, clubId);
  const p = sp(state, playerId);
  if (!club) return { ok: false, status: 'abgelehnt', text: 'Unbekannter Verein.' };
  if (!p) return { ok: false, status: 'abgelehnt', text: 'Unbekannter Spieler.' };
  if (!p.clubId) return { ok: false, status: 'abgelehnt', text: `${name(p)} ist vertragslos — den kann man verpflichten, nicht ausleihen.` };
  if (p.clubId === clubId) return { ok: false, status: 'abgelehnt', text: 'Der Spieler gehört bereits uns.' };
  if (!transferFensterOffen(state)) return { ok: false, status: 'abgelehnt', text: 'Leihgeschäfte gehen nur im Transferfenster.' };
  if (club.playerIds.length >= MAX_KADER) return { ok: false, status: 'abgelehnt', text: 'Der Kader ist voll.' };
  if (p.transfer && p.transfer.leihe && p.transfer.leihe.stammvereinId) {
    return { ok: false, status: 'abgelehnt', text: 'Weiterverleihen ist nicht erlaubt.' };
  }

  const geber = cl(state, p.clubId);
  const rng = opts.rng || tmRng(state, 'leihe:' + playerId);
  const anteil = clamp(opts.gehaltsanteil !== undefined ? opts.gehaltsanteil : LEIH_GEHALT_STANDARD, 0, 1);
  const gebuehr = Math.round(marktwert(state, p) * LEIH_GEBUEHR_ANTEIL * (opts.gebuehrFaktor || 1) / 10000) * 10000;

  // --- Will der abgebende Verein? ------------------------------------------
  const rolle = kaderRolle(state, p);
  let bereitschaft = 0.15;
  if (rolle === 'ueberzaehlig') bereitschaft += 0.5;
  else if (rolle === 'ergaenzung') bereitschaft += 0.35;
  else if (rolle === 'rotation') bereitschaft += 0.12;
  else bereitschaft -= 0.25;
  if (p.age <= 22) bereitschaft += 0.25;         // Talente sollen spielen
  if (p.era === 'legend') bereitschaft -= 0.5;
  bereitschaft += anteil * 0.2;
  if (opts.kaufoption) bereitschaft += 0.08;
  if (hinterlaesstLuecke(state, geber, p)) bereitschaft -= 0.6;
  if (geber.playerIds.length <= MIN_KADER) bereitschaft -= 0.5;
  // Ein Leihspieler soll den Aufnehmenden nicht sofort zum Titelkandidaten machen.
  if ((club.reputation || 50) - (geber.reputation || 50) > 10 && ovr(p) > referenzNiveau(kaderOf(state, geber.id)) - LEIH_MAX_OVR_ABSTAND) {
    bereitschaft -= 0.3;
  }

  if (!rng.chance(clamp(bereitschaft, 0.02, 0.95))) {
    return { ok: false, status: 'abgelehnt',
      text: `${geber.shortName || geber.name} lehnt ab: „${name(p)} wird bei uns gebraucht."` };
  }

  // --- Will der Spieler? ----------------------------------------------------
  const spielzeit = erwarteteRolle(state, club, p);
  if (spielzeit === 'ergaenzung' && rolle !== 'ueberzaehlig') {
    return { ok: false, status: 'abgelehnt',
      text: `${name(p)} winkt ab — er will spielen, nicht die Bank wechseln.` };
  }

  const gehalt = p.contract.salary || marktGehalt(state, p, clubId);
  const kosten = gebuehr + Math.round(gehalt * anteil * 0.5); // halbe Saison Vorleistung
  if ((club.finances.balance || 0) < kosten) {
    return { ok: false, status: 'abgelehnt', text: `Leihgebühr und Gehaltsanteil (${formatMoney(kosten)}) sprengen die Kasse.` };
  }
  if (gehalt * anteil > gehaltsspielraum(state, club)) {
    return { ok: false, status: 'abgelehnt', text: 'Der Gehaltsetat gibt den Gehaltsanteil nicht her.' };
  }

  // --- Vollzug ---------------------------------------------------------------
  if (gebuehr > 0) {
    buche(state, club, -gebuehr, `Leihgebühr ${name(p)}`);
    buche(state, geber, gebuehr, `Leihgebühr ${name(p)}`);
  }
  entferneAusVerein(state, geber, p);
  club.playerIds.push(p.id);
  p.clubId = club.id;
  p.number = freieNummer(state, club, p);
  p.seasonsAtClub = 0;
  p.joined = { season: state.date.season, day: state.date.day };
  p.transfer = {
    listed: false, wunschWechsel: false, angebote: [],
    leihe: {
      stammvereinId: geber.id, gehaltsanteil: anteil,
      kaufoption: opts.kaufoption || null, pflichtkauf: !!opts.pflichtkauf,
      bisTag: LEIH_RUECKKEHR_TAG, bisSaison: state.date.season,
      gebuehr, seitTag: state.date.day
    }
  };
  p.morale = clamp((p.morale || 70) + 5, 0, 100);
  if (club.id !== state.managerClubId) club.tactics = autoLineup(kaderOf(state, club.id), club.tactics || {});

  const tm = tmState(state);
  tm.saison.leihen++;

  return {
    ok: true, status: 'angenommen', gebuehr, gehaltsanteil: anteil, kaufoption: opts.kaufoption || null,
    text: `${name(p)} kommt bis Saisonende von ${geber.shortName || geber.name}. Leihgebühr ${formatMoney(gebuehr)}, ` +
      `wir zahlen ${Math.round(anteil * 100)} % des Gehalts.` + (opts.kaufoption ? ` Kaufoption: ${formatMoney(opts.kaufoption)}.` : '')
  };
}

/** Leihspieler zum Stammverein zurückschicken. */
function leiheBeenden(state, p, ctx, kaufoptionZiehen = false) {
  const leihe = p.transfer && p.transfer.leihe;
  if (!leihe || !leihe.stammvereinId) return false;
  const aktuell = cl(state, p.clubId);
  const stamm = cl(state, leihe.stammvereinId);
  if (!stamm || !aktuell) return false;

  if (kaufoptionZiehen && leihe.kaufoption) {
    p.transfer.leihe = null;
    // Spieler gehört formal noch dem Stammverein: kurz zurückbuchen, dann kaufen.
    aktuell.playerIds = aktuell.playerIds.filter(id => id !== p.id);
    stamm.playerIds.push(p.id);
    p.clubId = stamm.id;
    const res = vollzieheTransfer(state, {
      playerId: p.id, kaeuferId: aktuell.id, ablose: leihe.kaufoption,
      vertrag: kiVertragsangebot(state, aktuell, p, tmRng(state, 'kaufoption:' + p.id)),
      typ: 'kaufoption', ctx
    });
    return res.ok;
  }

  entferneAusVerein(state, aktuell, p);
  stamm.playerIds.push(p.id);
  p.clubId = stamm.id;
  p.number = freieNummer(state, stamm, p);
  p.transfer.leihe = null;
  p.seasonsAtClub = 0;
  if (stamm.id !== state.managerClubId) stamm.tactics = autoLineup(kaderOf(state, stamm.id), stamm.tactics || {});
  if (stamm.id === state.managerClubId) {
    meldung(ctx, `${name(p)} ist aus der Leihe bei ${aktuell.shortName || aktuell.name} zurück. Der Kader wächst wieder.`,
      'transfer', { from: 'Geschäftsstelle', subject: `Rückkehr: ${name(p)}` });
  }
  return true;
}

/* ==========================================================================
 * 11. Transferliste / Marktübersicht
 * ======================================================================== */

/**
 * Durchsuchbare Marktübersicht.
 * @param opts { position, positionsgruppe, maxAblose, minOvr, maxOvr, maxAlter,
 *               minAlter, nation, liga, vertragslos, nurGelistet, kaeuferId,
 *               suche, maxGehalt, era, limit, sortierung }
 */
export function transferliste(state, opts = {}) {
  const limit = opts.limit || 200;
  const kaeuferId = opts.kaeuferId || null;
  const posFilter = opts.position
    ? (Array.isArray(opts.position) ? opts.position : [opts.position]) : null;

  const kandidaten = [];
  const pruefe = (p) => {
    if (!p || p.jugend) return;
    if (kaeuferId && p.clubId === kaeuferId) return;
    if (p.transfer && p.transfer.leihe && p.transfer.leihe.stammvereinId) return;
    const frei = istVertragslos(state, p);
    if (opts.vertragslos && !frei) return;
    if (opts.nurGelistet && !(p.transfer && p.transfer.listed)) return;
    if (posFilter && !posFilter.includes(p.position)
      && !(p.altPositions || []).some(a => posFilter.includes(a))) return;
    if (opts.positionsgruppe && POSITION_GROUP[p.position] !== opts.positionsgruppe) return;
    if (opts.maxAlter && p.age > opts.maxAlter) return;
    if (opts.minAlter && p.age < opts.minAlter) return;
    if (opts.nation && p.nationality !== opts.nation) return;
    if (opts.era && p.era !== opts.era) return;
    if (opts.liga && p.clubId && leagueOfClub(p.clubId) !== opts.liga) return;
    if (opts.liga && !p.clubId) return;
    const o = ovr(p);
    if (opts.minOvr && o < opts.minOvr) return;
    if (opts.maxOvr && o > opts.maxOvr) return;
    if (opts.suche) {
      const s = String(opts.suche).toLowerCase();
      if (!(`${p.firstName} ${p.lastName}`.toLowerCase().includes(s))) return;
    }
    kandidaten.push({ p, o, frei });
  };

  for (const id in state.players) pruefe(state.players[id]);

  const eintraege = [];
  for (const k of kandidaten) {
    const p = k.p;
    const ablose = k.frei ? 0 : abloseforderung(state, p.id, kaeuferId);
    if (opts.maxAblose !== undefined && opts.maxAblose !== null && ablose > opts.maxAblose) continue;
    const gehalt = marktGehalt(state, p, kaeuferId || p.clubId);
    if (opts.maxGehalt && gehalt > opts.maxGehalt) continue;
    eintraege.push({
      playerId: p.id, player: p, clubId: p.clubId,
      clubName: p.clubId ? clubName(state, p.clubId) : 'vereinslos',
      position: p.position, alter: p.age, ovr: k.o, potenzial: p.potential,
      marktwert: marktwert(state, p), ablose, gehalt,
      gelistet: !!(p.transfer && p.transfer.listed),
      wechselwunsch: !!(p.transfer && p.transfer.wunschWechsel),
      vertragslos: k.frei, restlaufzeit: restlaufzeit(state, p),
      era: p.era, verkaufsbereit: p.clubId ? verkaufsbereitschaft(state, p) : 1,
      beobachtet: !!(kaeuferId && cl(state, kaeuferId) && beobachtungsEintrag(cl(state, kaeuferId), p.id))
    });
  }

  const sortierung = opts.sortierung || 'wert';
  let sortiert;
  if (sortierung === 'ovr') sortiert = sortBy(eintraege, e => ({ key: e.ovr, desc: true }));
  else if (sortierung === 'ablose') sortiert = sortBy(eintraege, e => e.ablose);
  else if (sortierung === 'alter') sortiert = sortBy(eintraege, e => e.alter);
  else if (sortierung === 'name') sortiert = sortBy(eintraege, e => e.player.lastName);
  else if (sortierung === 'potenzial') sortiert = sortBy(eintraege, e => ({ key: e.potenzial, desc: true }));
  else sortiert = sortBy(eintraege, e => ({ key: e.marktwert, desc: true }));

  return sortiert.slice(0, limit);
}

/* ==========================================================================
 * 12. KI: Bedarf, Einkauf, Verkauf
 * ======================================================================== */

/** Fehlt nach einem Abgang auf irgendeiner Position jeder gelernte Spieler? */
function hinterlaesstLuecke(state, club, p) {
  const rest = kaderOf(state, club.id).filter(x => x.id !== p.id);
  if (rest.length < MIN_KADER) return true;
  for (const pos of POSITIONS) {
    let da = 0;
    for (const x of rest) if (bestAffinity(x, pos) >= 0.7) { da++; if (da >= 1) break; }
    if (da === 0) return true;
  }
  const gruppe = POSITION_GROUP[p.position];
  const inGruppe = rest.filter(x => POSITION_GROUP[x.position] === gruppe).length;
  if (inGruppe < (MIN_PRO_GRUPPE[gruppe] || 2)) return true;
  return false;
}

/** Darf dieser Verein diesen Spieler überhaupt abgeben? */
function darfAbgeben(state, club, p) {
  if (p.transfer && p.transfer.leihe && p.transfer.leihe.stammvereinId) return false;
  if (club.playerIds.length <= MIN_KADER) return false;
  return !hinterlaesstLuecke(state, club, p);
}

/**
 * Wo drückt der Schuh? Liste nach Dringlichkeit sortiert.
 * Neben der reinen Qualität zählen Kadertiefe, Langzeitverletzte und
 * auslaufende Verträge — das sind die drei Gründe, aus denen echte Vereine
 * einkaufen, ohne dass die Startelf sofort besser wird.
 * `motiv` benennt den Grund und steuert über KI_MIN_VERBESSERUNG, wie
 * anspruchsvoll der Verein bei diesem Kauf ist.
 */
function bedarfsanalyse(state, club) {
  const cached = BEDARF_CACHE.get(club);
  if (cached && cached.day === state.date.day && cached.season === state.date.season
    && cached.size === club.playerIds.length) return cached.liste;

  const kader = kaderOf(state, club.id);
  const tiefe = kaderTiefe(state, club.id);
  const ref = referenzNiveau(kader);
  const out = [];
  for (const pos of POSITIONS) {
    const d = tiefe[pos];
    if (!d) continue;
    const gelernt = kader.filter(x => x.position === pos).length;
    const maxHier = MAX_PRO_POSITION[pos] || MAX_PRO_POSITION_STD;
    if (gelernt >= maxHier) continue;           // niemand kauft den vierten Torwart

    const passende = kader.filter(x => bestAffinity(x, pos) >= 0.7);
    const einsatzbereit = passende.filter(x => !langfristigAus(x)).length;
    const bleiben = passende.filter(x => restlaufzeit(state, x) > 0).length;
    // Maßstab für einen Ergänzungsspieler ist nicht der Stammspieler, sondern
    // der Mann, den er von seinem Platz verdrängen müsste: bei dünn besetzten
    // Positionen der zweite, bei gut besetzten der dritte.
    const mann = (n, ersatz) => {
      const id = d.spieler && d.spieler[n];
      return id && state.players[id] ? playerRatingForSlot(state.players[id], pos) : d.bester - ersatz;
    };
    const zweiter = d.anzahl >= 4 ? mann(2, 9) : mann(1, 5);

    let dringend, motiv;
    if (d.anzahl === 0) { dringend = 1.00; motiv = 'luecke'; }
    else if (einsatzbereit === 0) { dringend = 0.94; motiv = 'ausfall'; }
    else if (d.anzahl === 1) { dringend = 0.70; motiv = 'luecke'; }
    else if (einsatzbereit === 1) { dringend = 0.62; motiv = 'ausfall'; }
    else if (bleiben <= 1) { dringend = 0.52; motiv = 'vertragsende'; }
    else if (d.bester < ref - KI_LUECKE_ABSTAND) { dringend = 0.50; motiv = 'schwachstelle'; }
    else if (d.bester < ref - 4) { dringend = 0.32; motiv = 'schwachstelle'; }
    else if (d.anzahl === 2) { dringend = 0.24; motiv = 'breite'; }
    else { dringend = 0.10; motiv = 'verstaerkung'; }

    out.push({ pos, dringend, motiv, bester: d.bester, zweiter, anzahl: d.anzahl, einsatzbereit, ref });
  }
  const liste = sortBy(out, b => ({ key: b.dringend, desc: true }));
  BEDARF_CACHE.set(club, { day: state.date.day, season: state.date.season, size: club.playerIds.length, liste });
  return liste;
}
const BEDARF_CACHE = new WeakMap();

/**
 * Wie viel besser muss ein Neuzugang mindestens sein, damit dieser Verein
 * zugreift? Ergebnis in Stärkepunkten, darf negativ sein (= Kaderbreite).
 */
function mindestVerbesserung(state, club, kaderGroesse, ziel, info) {
  let m = KI_MIN_VERBESSERUNG[ziel.motiv];
  if (m === undefined) m = KI_MIN_VERBESSERUNG.verstaerkung;
  if (m <= -90) return m;                       // echte Lücke: Hauptsache ein gelernter Mann
  // Gegen wen muss sich der Neue durchsetzen? Bei Kaderbreite reicht der
  // zweite Mann, bei einer echten Verstärkung muss es der beste sein.
  m += (KI_MASSSTAB_ZWEITER[ziel.motiv] ? ziel.zweiter : ziel.bester) - ziel.bester;

  if (kaderGroesse >= SOLL_KADER + 3) m += KI_ANSPRUCH_UEBERVOLL;
  else if (kaderGroesse >= SOLL_KADER + 1) m += KI_ANSPRUCH_SOLL;

  // Ehrgeiz: ein Spitzenverein greift schneller zu als ein Abstiegskandidat.
  m -= ((club.reputation || 50) - 60) / KI_AMBITION_TEILER;

  if (info.art === 'winter') m += KI_WINTER_ANSPRUCH;
  if (info.deadline) m -= KI_DEADLINE_NACHLASS;
  else if (info.tageBisSchluss <= 10) m -= KI_SPAETPHASE_NACHLASS;
  return m;
}

/**
 * Markt-Index: wer ist überhaupt zu haben? Wird einmal pro Tag gebaut und an
 * alle handelnden KI-Vereine weitergereicht.
 */
/**
 * Zieht aus einer nach Stärke sortierbaren Liste `n` Einträge, die gleichmäßig
 * über das gesamte Leistungsspektrum verteilt sind (Bester immer dabei).
 */
function querschnitt(liste, n) {
  const sortiert = sortBy(liste, e => ({ key: e.wert, desc: true }));
  if (sortiert.length <= n) return sortiert;
  const out = [];
  const schritt = sortiert.length / n;
  for (let i = 0; i < n; i++) out.push(sortiert[Math.floor(i * schritt)]);
  return out;
}

const MARKT_CACHE = new WeakMap();
function marktIndex(state) {
  const cached = MARKT_CACHE.get(state);
  if (cached && cached.day === state.date.day && cached.season === state.date.season) return cached.index;

  const byPos = {};
  for (const pos of POSITIONS) byPos[pos] = [];
  const add = (p, quelle) => {
    if (!p || p.jugend) return;
    if (p.transfer && p.transfer.leihe && p.transfer.leihe.stammvereinId) return;
    const verf = MARKT_VERFUEGBAR[quelle] !== undefined ? MARKT_VERFUEGBAR[quelle] : 0.2;
    const manager = p.clubId === state.managerClubId;
    const legende = p.era === 'legend';
    const ziele = new Set([p.position, ...(p.altPositions || [])]);
    for (const pos of ziele) {
      if (!byPos[pos]) continue;
      // Die Stärke wird gleich FÜR DIESE POSITION gespeichert — die KI fragt
      // sie pro Kandidat mehrfach ab, und playerRatingForSlot ist nicht billig.
      const wert = playerRatingForSlot(p, pos);
      byPos[pos].push({
        p, clubId: p.clubId, quelle, verf, wert, manager, legende,
        // Marktattraktivität: halb Klasse, halb „ist überhaupt zu haben".
        reiz: wert * (1 - MARKT_VERFUEGBAR_GEWICHT + MARKT_VERFUEGBAR_GEWICHT * verf)
      });
    }
  };

  for (const id of state.freeAgents || []) add(state.players[id], 'vertragslos');

  for (const clubId in state.clubs) {
    const club = state.clubs[clubId];
    if (club.lazySquad) continue;               // Pokal-Amateure haben noch keinen Kader
    const liste = kaderRangliste(state, clubId);
    const gross = liste.length;
    for (let i = 0; i < gross; i++) {
      const p = liste[i];
      if (langfristigAus(p)) continue;          // wer monatelang ausfällt, interessiert niemanden
      // Reihenfolge = Rangfolge der Gründe. Der erste passende gewinnt.
      if (p.transfer && p.transfer.listed) { add(p, 'gelistet'); continue; }
      if (p.transfer && p.transfer.wunschWechsel) { add(p, 'wechselwunsch'); continue; }
      if (restlaufzeit(state, p) <= 0) { add(p, 'vertragsende'); continue; }
      if (p.happiness && p.happiness.spielzeit < 38) { add(p, 'unzufrieden'); continue; }
      if (gross > MIN_KADER && i >= MARKT_UEBERZAEHLIG_AB_RANG) { add(p, 'ueberzaehlig'); continue; }
      if (gross > MIN_KADER && i >= MARKT_STAMM_AB_RANG) { add(p, 'ergaenzung'); continue; }
      if (p.age >= 32 && i >= 6) { add(p, 'altgedient'); continue; }
      if (p.age <= 21 && i >= 8) { add(p, 'talent'); continue; }
      // Auch Stammspieler haben ihren Preis — nur eben einen sehr hohen.
      add(p, 'stamm');
    }
  }

  // Drei Töpfe je Position, damit die Ikonen und Stars nicht sämtliche Plätze
  // belegen und der Markt aus lauter Unverkäuflichen besteht. Gezogen wird
  // gleichmäßig über das ganze Leistungsspektrum — sonst sähe ein Zweitligist
  // nur die Ersatzbank des Meisters und fände nie einen Spieler für sich.
  // Das Ergebnis ist absteigend sortiert: die KI steigt oben ein und bricht
  // ab, sobald das Niveau unter ihre Schmerzgrenze fällt.
  for (const pos of POSITIONS) {
    const alle = byPos[pos];
    byPos[pos] = sortBy([].concat(
      querschnitt(alle.filter(e => !e.legende && e.verf >= 0.30), MARKT_ZU_HABEN_JE_POSITION),
      querschnitt(alle.filter(e => !e.legende && e.verf < 0.30), MARKT_STAMM_JE_POSITION),
      querschnitt(alle.filter(e => e.legende), MARKT_LEGENDEN_JE_POSITION)
    ), e => ({ key: e.wert, desc: true }));
  }
  const index = { byPos, tag: state.date.day };
  MARKT_CACHE.set(state, { day: state.date.day, season: state.date.season, index });
  return index;
}

/**
 * Warum sollte dieser Spieler seinen Verein verlassen? Ohne einen solchen
 * Grund wechselt niemand freiwillig zu einer kleineren Adresse.
 * @returns {{ id, text, gewicht } | null}
 */
function wechselGrund(state, p, rang, kaderGroesse) {
  const g = (id, text) => ({ id, text, gewicht: KI_VERKAUF_GEWICHT[id] || 1 });
  if (p.transfer && p.transfer.listed) return g('gelistet', 'steht auf der Transferliste');
  if (p.transfer && p.transfer.wunschWechsel) return g('wechselwunsch', 'drängt auf einen Wechsel');
  if (rang >= MARKT_UEBERZAEHLIG_AB_RANG && kaderGroesse > MIN_KADER) return g('ueberzaehlig', 'ist im Kader überzählig');
  if (p.happiness && p.happiness.spielzeit < 38) return g('unzufrieden', 'sitzt zu oft auf der Bank');
  if (restlaufzeit(state, p) <= 0) return g('vertragsende', 'hat einen auslaufenden Vertrag');
  if (p.age >= 32 && rang >= 8) return g('altgedient', 'ist über den Zenit');
  if (rang >= MARKT_STAMM_AB_RANG && kaderGroesse > MIN_KADER) return g('ohne_spielzeit', 'kommt hier kaum zum Zug');
  return null;
}

/** Rang eines Spielers in der Kaderrangliste seines Vereins (0 = bester). */
function rangImKader(state, p) {
  if (!p.clubId) return 99;
  const liste = kaderRangliste(state, p.clubId);
  for (let i = 0; i < liste.length; i++) if (liste[i].id === p.id) return i;
  return 99;
}

/**
 * Darf dieser Wechsel überhaupt stattfinden? Ein Spieler geht nicht ohne Not
 * zu einem deutlich kleineren Verein — es sei denn, er hat dort keine Zukunft.
 * @returns {{ id, text, gewicht } | null} Grund oder null (= kein Wechsel)
 */
function wechselPlausibel(state, p, kaeufer) {
  const geber = p.clubId ? cl(state, p.clubId) : null;
  if (!geber) return { id: 'vertragslos', text: 'ist vertragslos', gewicht: 3 };
  const grund = wechselGrund(state, p, rangImKader(state, p), geber.playerIds.length)
    || { id: 'chance', text: 'reizt der größere Verein', gewicht: 1 };
  // Wie weit runter geht er? Wer weg will, nimmt einen Abstieg in Kauf;
  // ein zufriedener Stammspieler wechselt nur nach oben oder auf Augenhöhe.
  const grenze = KI_REP_GEFAELLE[grund.id] !== undefined ? KI_REP_GEFAELLE[grund.id] : KI_REP_GEFAELLE.chance;
  if ((geber.reputation || 50) - (kaeufer.reputation || 50) > grenze) return null;
  return grund;
}

/**
 * Was ein KI-Verein diesem Spieler zahlen müsste. Wer den Verein wechselt,
 * will mehr verdienen als bisher — sonst bleibt er einfach sitzen. Diese
 * Obergrenze geht in die Kaufkalkulation ein, damit der Verein nicht erst
 * verhandelt und dann am eigenen Gehaltsetat scheitert.
 */
function kiGehaltsbedarf(state, club, p) {
  const markt = marktGehalt(state, p, club.id);
  const ist = (p.contract && p.contract.salary) || 0;
  const wechsel = p.clubId !== club.id;
  return Math.round(Math.max(markt * 1.16, wechsel ? ist * KI_WECHSELPRAEMIE_MAX : 0));
}

/**
 * Höchste Ablöse, die dieser Verein für diesen Spieler noch stemmen kann —
 * Beraterprovision und Handgeld sind darin schon eingerechnet. Ohne diese
 * Rechnung bietet die KI eine Summe, die sie am Ende nicht bezahlen kann,
 * und der ganze Anlauf verpufft an der Kasse.
 */
function maximalGebot(state, club, p, budget) {
  const handgeld = Math.round(kiGehaltsbedarf(state, club, p) * KI_HANDGELD_ANTEIL);
  const rest = Math.max(0, budget - handgeld);
  const sockel = beraterProvision(state, p.id, 0);   // gehaltsabhängiger Mindestbetrag
  let a = rest / (1 + BERATER_PROZENT);
  if (a * BERATER_PROZENT < sockel) a = rest - sockel;
  return Math.max(0, Math.floor(a / WERT_RASTER) * WERT_RASTER);
}

/** Standard-Vertragsangebot eines KI-Vereins. */
function kiVertragsangebot(state, club, p, rng) {
  if (!club) club = cl(state, p.clubId);
  const markt = marktGehalt(state, p, club.id);
  const aufschlag = 1 + (rng ? rng.float(0.02, 0.16) : 0.09);
  const laufzeit = p.age >= 33 ? 1 : p.age >= 30 ? 2 : p.age <= 22 ? 4 : 3;
  let roh = markt * aufschlag;
  // Ein Wechsel muss sich lohnen: unter dem alten Gehalt unterschreibt niemand.
  const ist = (p.contract && p.contract.salary) || 0;
  if (ist > 0 && p.clubId !== club.id) {
    const praemie = rng ? rng.float(KI_WECHSELPRAEMIE_MIN, KI_WECHSELPRAEMIE_MAX) : 1.15;
    roh = Math.max(roh, ist * praemie);
  }
  const gehalt = Math.round(roh / GEHALT_RASTER) * GEHALT_RASTER;
  const rolle = erwarteteRolle(state, club, p);
  return {
    gehalt, laufzeit,
    handgeld: Math.round(gehalt * KI_HANDGELD_ANTEIL / GEHALT_RASTER) * GEHALT_RASTER,
    ausstiegsklausel: null,
    praemien: {
      tor: Math.round(gehalt * 0.012 / 1000) * 1000,
      einsatz: Math.round(gehalt * 0.006 / 1000) * 1000,
      titel: Math.round(gehalt * 0.15 / 1000) * 1000
    },
    rolle
  };
}

/**
 * Der gemeinsame Weg jedes KI-Kaufs: Angebot → ggf. eine Verhandlungsrunde →
 * Vertrag mit dem Spieler → Vollzug. Gibt das Transferergebnis oder null.
 */
function kiAbschluss(state, ctx, club, p, gebot, budget, lohnLuft, rng, typ, grund) {
  const provision = beraterProvision(state, p.id, gebot);
  const antwort = angebotAbgeben(state, club.id, p.id, gebot, { ki: true, rng });
  if (antwort.status !== 'angenommen') {
    // Ein zäher Verkäufer: einmal nachlegen, wenn das Budget es hergibt.
    if (antwort.status === 'gegenangebot' && antwort.gegenforderung + provision <= budget && rng.chance(0.62)) {
      const v = verhandlung(state, antwort.verhandlungId);
      if (!v) return null;
      const runde = verhandlungRunde(state, v.id, 'erhoehen', antwort.gegenforderung);
      if (runde.status !== 'einig') {
        if (v.status === 'laufend') verhandlungRunde(state, v.id, 'abbrechen');
        return null;
      }
      gebot = v.gebot;
    } else {
      if (antwort.verhandlungId) verhandlungRunde(state, antwort.verhandlungId, 'abbrechen');
      return null;
    }
  }

  const vertrag = kiVertragsangebot(state, club, p, rng);
  if (vertrag.gehalt > lohnLuft) return null;
  const zusage = vertragAnbieten(state, club.id, p.id, Object.assign({ rng }, vertrag));
  if (zusage.status !== 'angenommen') {
    if (zusage.status === 'gegenforderung' && zusage.forderung.gehalt <= lohnLuft && rng.chance(0.65)) {
      vertrag.gehalt = zusage.forderung.gehalt;
      vertrag.laufzeit = zusage.forderung.laufzeit;
      const zweiter = vertragAnbieten(state, club.id, p.id, Object.assign({ rng }, vertrag));
      if (zweiter.status !== 'angenommen') return null;
    } else return null;
  }

  // Letzte Kassenprüfung: Ablöse, Provision und Handgeld zusammen.
  const kosten = gebot + beraterProvision(state, p.id, gebot) + (vertrag.handgeld || 0);
  if (kosten > budget) return null;

  const res = vollzieheTransfer(state, {
    playerId: p.id, kaeuferId: club.id, ablose: gebot, ki: true,
    grund: grund ? grund.id : null,
    vertrag: Object.assign({}, vertrag, { zugesagt: true }), typ: typ || 'transfer', ctx
  });
  return res.ok ? res : null;
}

/** Gebotshöhe eines KI-Vereins auf eine Forderung. */
function kiGebot(state, club, forderung, deadline, rng) {
  const repFaktor = KI_GEBOT_BASIS + (club.reputation || 50) / KI_GEBOT_REP_TEILER;
  const streuung = rng ? rng.float(0.97, 1.06) : 1;
  return Math.round(forderung * repFaktor * streuung * (deadline ? KI_DEADLINE_AUFSCHLAG : 1)
    / WERT_RASTER) * WERT_RASTER;
}

/**
 * Der Einkauf eines KI-Vereins. Höchstens ein Abschluss pro Aufruf.
 *
 * Gekauft wird aus fünf Gründen: eine Position ist unbesetzt, jemand fällt
 * lange aus, ein Vertrag läuft aus, der Kader ist zu dünn — oder der Verein
 * hat schlicht Geld übrig und holt sich einen Star (`prestige`).
 */
function kiEinkauf(state, ctx, club, markt, rng, opts = {}) {
  const info = fensterInfo(state);
  const konto = kiKonto(state, club.id);
  if (konto.zugaenge >= kiQuote(info.art, info.deadline).zugaenge) return null;
  const kader = kaderOf(state, club.id);
  if (kader.length >= MAX_KADER) return null;

  const budget = kiVerfuegbaresBudget(state, club);
  const lohnLuft = gehaltsspielraum(state, club);
  if (lohnLuft <= GEHALT_MIN) return null;

  const bedarf = bedarfsanalyse(state, club);
  if (!bedarf.length) return null;

  // Ein Verein mit voller Kasse und wenig Bedarf gönnt sich trotzdem etwas.
  const prestige = !!opts.prestige && budget >= KI_PRESTIGE_BUDGET && kader.length < MAX_KADER - 1;

  // Ein Sportdirektor schaut nicht nur auf eine Position, sondern verfolgt
  // mehrere Baustellen gleichzeitig — sonst wäre jeder zweite Anlauf umsonst.
  // Beim Prestigekauf ist ihm die Position egal, Hauptsache ein großer Name.
  const niveauAbstand = info.art === 'winter' ? KI_NIVEAU_UNTERGRENZE_WINTER : KI_NIVEAU_UNTERGRENZE;
  const ziele = prestige ? bedarf : bedarf.slice(0, KI_ZIELE_PRO_VERSUCH);
  const gesehen = new Set();
  const kandidaten = [];

  for (const ziel of ziele) {
    // Untergrenze: absolutes Mindestniveau UND die geforderte Verbesserung.
    const untergrenze = prestige
      ? ziel.ref - KI_PRESTIGE_ABSTAND
      : Math.max(
        ziel.ref - niveauAbstand,
        ziel.anzahl > 0 ? ziel.bester + mindestVerbesserung(state, club, kader.length, ziel, info) : -99);

    for (const e of (markt.byPos[ziel.pos] || [])) {
      const p = e.p;
      // Die Liste ist absteigend sortiert — ab hier lohnt sich niemand mehr.
      if (e.wert < untergrenze) break;
      if (p.clubId === club.id) continue;
      if (e.manager) continue;                  // Manager-Spieler laufen über Angebote
      if (gesehen.has(p.id)) continue;          // steht schon für eine andere Position drin
      if (langfristigAus(p)) continue;
      // Ein Kader aus Vertragslosen ist keine Mannschaft, sondern ein Casting.
      if (!p.clubId && (konto.vertragslos || 0) >= KI_MAX_VERTRAGSLOS) continue;

      const verbesserung = e.wert - ziel.bester;
      let grund = null;
      let gefaelle = 0;
      if (p.clubId) {
        const geber = cl(state, p.clubId);
        if (!geber || !darfAbgeben(state, geber, p)) continue;
        if (p.era === 'legend' && !rng.chance(KI_LEGENDE_ANGEBOT_CHANCE)) continue;
        grund = wechselPlausibel(state, p, club);
        if (!grund) continue;                     // ohne Grund kein Abstieg in der Hierarchie
        gefaelle = (geber.reputation || 50) - (club.reputation || 50);
      }
      const gehalt = kiGehaltsbedarf(state, club, p);
      if (gehalt > lohnLuft) continue;
      const preis = abloseforderung(state, p.id, club.id);
      const dach = maximalGebot(state, club, p, budget);
      if (preis > dach) continue;                 // die Forderung ist nicht zu stemmen
      const provision = beraterProvision(state, p.id, preis);

      gesehen.add(p.id);
      const score = verbesserung * KI_GEWICHT_VERBESSERUNG
        + Math.max(0, p.potential - ovr(p)) * KI_GEWICHT_POTENZIAL
        - Math.abs(p.age - KI_IDEAL_ALTER) * KI_GEWICHT_ALTER
        + ziel.dringend * KI_GEWICHT_DRINGLICHKEIT
        + e.verf * KI_GEWICHT_VERFUEGBAR
        - Math.max(0, gefaelle) * KI_GEWICHT_REP_HUERDE
        - ((preis + provision) / Math.max(1, budget)) * KI_GEWICHT_PREIS;
      kandidaten.push({ p, preis, provision, dach, score, verbesserung, grund });
    }
  }
  if (!kandidaten.length) return null;

  // Beim Prestigekauf zählt nicht der beste Gegenwert, sondern der größte Name.
  // Und ein Verein mit dickem Etat greift auch sonst lieber oben ins Regal.
  const reich = budget >= KI_GROSSKAUF_BUDGET;
  const wahl = prestige
    ? sortBy(kandidaten, k => ({ key: k.preis, desc: true }))[0]
    : rng.pickWeighted(
      sortBy(kandidaten, k => ({ key: k.score, desc: true })).slice(0, KI_KANDIDATEN),
      k => Math.max(0.1, k.score + 14) * (reich ? 1 + k.preis / budget : 1));
  if (!wahl) return null;

  // Nie über die eigene Schmerzgrenze bieten — sonst platzt der Deal an der Kasse.
  // Beim Wunschspieler legt man dafür gern noch etwas obendrauf.
  const roh = kiGebot(state, club, wahl.preis, info.deadline, rng);
  const gebot = Math.min(wahl.dach,
    prestige ? Math.round(roh * KI_PRESTIGE_AUFSCHLAG / WERT_RASTER) * WERT_RASTER : roh);
  const warVertragslos = !wahl.p.clubId;
  const res = kiAbschluss(state, ctx, club, wahl.p, gebot, budget, lohnLuft, rng, 'transfer', wahl.grund);
  if (res && warVertragslos) konto.vertragslos = (konto.vertragslos || 0) + 1;
  return res;
}

/**
 * Der Verkauf eines KI-Vereins: Überzählige, Unzufriedene, Alternde und
 * Vertragslose-in-spe werden aktiv angeboten. Der Erlös landet über
 * KI_WIEDERANLAGE wieder im Transferbudget — Verkäufe finanzieren Käufe.
 */
function kiVerkauf(state, ctx, club, rng) {
  const info = fensterInfo(state);
  const konto = kiKonto(state, club.id);
  // Zwangsverkäufe ordnet club/finances.js an — die gehen vor jeder Quote.
  const zwang = zwangsverkauf(club);
  if (!zwang && konto.abgaenge >= kiQuote(info.art, info.deadline).abgaenge) return null;
  const liste = kaderRangliste(state, club.id);
  if (liste.length <= (zwang ? MIN_KADER : KI_VERKAUF_MIN_KADER)) return null;

  /* --- 1. Wen will der Verein loswerden? --------------------------------- */
  const angebotene = [];
  for (let i = 0; i < liste.length; i++) {
    const p = liste[i];
    if (p.era === 'legend') continue;           // Ikonen bietet die KI niemals von sich aus an
    if (langfristigAus(p)) continue;
    if (!darfAbgeben(state, club, p)) continue;
    const grund = wechselGrund(state, p, i, liste.length);
    if (zwang) {
      // „Nicht die, die Sie loswerden wollen — die, für die es Geld gibt."
      angebotene.push({
        p, rang: i, gewicht: Math.max(1, marktwert(state, p) / 1e6),
        grund: grund || { id: 'geldnot', text: 'muss aus finanzieller Not gehen', gewicht: 3 }
      });
      continue;
    }
    if (!grund) continue;
    // Klasse zählt mit: den 20. Mann will niemand, den 12. schon eher.
    angebotene.push({ p, grund, rang: i, gewicht: grund.gewicht * (liste.length - i) });
  }
  if (!angebotene.length) return null;

  /* --- 2. Wer hätte Verwendung für ihn? ---------------------------------- */
  const abnehmerFuer = (p) => {
    const interessenten = [];
    for (const clubId in state.clubs) {
      if (clubId === club.id || clubId === state.managerClubId) continue;
      const kaeufer = state.clubs[clubId];
      if (kaeufer.istAmateur || kaeufer.lazySquad) continue;
      if (kaeufer.playerIds.length >= MAX_KADER) continue;
      if (kiKonto(state, clubId).zugaenge >= kiQuote(info.art, info.deadline).zugaenge) continue;
      if (!wechselPlausibel(state, p, kaeufer)) continue;

      // Nicht die dringendste Baustelle zählt, sondern die, auf die er passt.
      let ziel = null, beste = -Infinity;
      for (const b of bedarfsanalyse(state, kaeufer)) {
        if (bestAffinity(p, b.pos) < 0.7) continue;
        const s = playerRatingForSlot(p, b.pos) - b.zweiter + b.dringend * 6;
        if (s > beste) { beste = s; ziel = b; }
      }
      if (!ziel) continue;

      const wertHier = playerRatingForSlot(p, ziel.pos);
      if (wertHier < ziel.ref - (info.art === 'winter' ? KI_NIVEAU_UNTERGRENZE_WINTER : KI_NIVEAU_UNTERGRENZE)) continue;
      const min = mindestVerbesserung(state, kaeufer, kaeufer.playerIds.length, ziel, info);
      if (ziel.anzahl > 0 && wertHier - ziel.bester < min) continue;

      const lohn = gehaltsspielraum(state, kaeufer);
      const gehalt = kiGehaltsbedarf(state, kaeufer, p);
      if (gehalt > lohn) continue;
      const preis = abloseforderung(state, p.id, clubId);
      const budget = kiVerfuegbaresBudget(state, kaeufer);
      const dach = maximalGebot(state, kaeufer, p, budget);
      if (preis > dach) continue;

      interessenten.push({
        kaeufer, ziel, budget, preis, lohn, dach,
        gewicht: Math.max(0.2, ziel.dringend * 8 + (wertHier - ziel.bester) + (kaeufer.reputation || 50) / 25)
      });
    }
    if (!interessenten.length) return null;
    const top = sortBy(interessenten, i => ({ key: i.gewicht, desc: true })).slice(0, KI_VERKAUF_INTERESSENTEN);
    return rng.pickWeighted(top, i => i.gewicht);
  };

  // Mehrere Kandidaten durchtelefonieren — beim ersten Nein legt kein
  // Sportdirektor auf.
  let p = null, kaeufer = null;
  const rest = angebotene.slice();
  for (let versuch = 0; versuch < KI_VERKAUF_VERSUCHE && rest.length; versuch++) {
    const k = rng.pickWeighted(rest, x => x.gewicht);
    if (!k) break;
    rest.splice(rest.indexOf(k), 1);
    kaeufer = abnehmerFuer(k.p);
    if (kaeufer) { p = k.p; break; }
  }
  if (!p || !kaeufer) return null;

  const gebot = Math.min(kiGebot(state, kaeufer.kaeufer, kaeufer.preis, info.deadline, rng), kaeufer.dach);
  return kiAbschluss(state, ctx, kaeufer.kaeufer, p, gebot, kaeufer.budget, kaeufer.lohn, rng,
    'transfer', wechselPlausibel(state, p, kaeufer.kaeufer));
}

/** Einen Spieler auf die vereinseigene Transferliste setzen (KI-intern). */
function listeAufnehmen(state, club, p) {
  if (!p.transfer) p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
  if (p.transfer.listed) return false;
  p.transfer.listed = true;
  if (!Array.isArray(club.transferliste)) club.transferliste = [];
  if (!club.transferliste.includes(p.id)) club.transferliste.push(p.id);
  return true;
}

/**
 * Ausmisten: Überzählige, dauerhaft Unzufriedene und alternde Spieler mit
 * auslaufendem Vertrag kommen auf die Liste. Das ist das Angebot, aus dem
 * die anderen Vereine ihre Zugänge holen.
 */
function kiAufraeumen(state, ctx, club, rng) {
  const liste = kaderRangliste(state, club.id);
  if (liste.length <= MIN_KADER + 1) return;
  const ueberfuellt = liste.length > SOLL_KADER;

  // Erst ausräumen: Wer inzwischen wieder gebraucht wird, kommt von der Liste.
  let gelistet = 0;
  for (const p of liste) {
    if (!(p.transfer && p.transfer.listed)) continue;
    if (wechselGrund(state, p, liste.indexOf(p), liste.length)) { gelistet++; continue; }
    p.transfer.listed = false;
    if (Array.isArray(club.transferliste)) club.transferliste = club.transferliste.filter(id => id !== p.id);
  }

  for (let i = liste.length - 1; i >= 10; i--) {
    if (gelistet >= KI_LISTE_MAX) return;       // niemand verkauft den halben Kader
    const p = liste[i];
    if (!p || (p.transfer && p.transfer.listed)) continue;
    if (p.era === 'legend') continue;           // Ikonen stellt niemand ins Schaufenster
    if (!darfAbgeben(state, club, p)) continue;

    let chance = 0;
    if (ueberfuellt && i >= 16) chance = 0.55;
    else if (i >= MARKT_UEBERZAEHLIG_AB_RANG) chance = 0.30;
    if (p.happiness && p.happiness.spielzeit < 32) chance = Math.max(chance, 0.35);
    if (restlaufzeit(state, p) <= 0 && i >= 11) chance = Math.max(chance, 0.40);
    if (p.age >= 33 && i >= 10) chance = Math.max(chance, 0.28);
    if (chance > 0 && rng.chance(chance) && listeAufnehmen(state, club, p)) gelistet++;
  }
}

/**
 * Ein KI-Verein gibt ein Angebot für einen Spieler des Managers ab.
 * Der Verein wird passend zum Kandidaten gesucht, nicht umgekehrt — sonst
 * käme nie ein Angebot zustande, wenn gerade kein Bedarf ausgewürfelt wird.
 */
function kiAngebotAnManager(state, ctx, rng) {
  const meine = cl(state, state.managerClubId);
  if (!meine) return null;
  const info = fensterInfo(state);
  const liste = kaderRangliste(state, meine.id);
  if (liste.length <= MIN_KADER) return null;

  /* --- 1. Für wen könnte sich jemand interessieren? ---------------------- */
  const kandidaten = [];
  for (let i = 0; i < liste.length; i++) {
    const p = liste[i];
    if (p.transfer && p.transfer.leihe && p.transfer.leihe.stammvereinId) continue;
    if (langfristigAus(p)) continue;
    if (p.transfer && Array.isArray(p.transfer.angebote)
      && p.transfer.angebote.some(a => a.status === 'offen' || a.status === 'verhandlung')) continue;
    if (p.era === 'legend' && !rng.chance(KI_LEGENDE_ANGEBOT_CHANCE)) continue;
    // Interessant sind Klasse-Spieler und alle, die ohnehin gehen wollen.
    let reiz = clamp(playerRatingForSlot(p, p.position) - 56, 1, 18);
    if (p.transfer && p.transfer.listed) reiz *= 2.4;
    if (p.transfer && p.transfer.wunschWechsel) reiz *= 2.0;
    if (i <= 6) reiz *= 1.3;                    // die Besten wecken Begehrlichkeiten
    kandidaten.push({ p, reiz });
  }
  if (!kandidaten.length) return null;

  /* --- 2. Wer bietet? Mehrere Spieler durchprobieren, bis es passt. ------- */
  const suchen = (p) => {
    const bieter = [];
    for (const clubId in state.clubs) {
      if (clubId === meine.id) continue;
      const club = state.clubs[clubId];
      if (club.istAmateur || club.lazySquad) continue;
      if (club.playerIds.length >= MAX_KADER) continue;
      if (kiKonto(state, clubId).zugaenge >= kiQuote(info.art, info.deadline).zugaenge) continue;
      if (!wechselPlausibel(state, p, club)) continue;

      // Nicht die dringendste Baustelle zählt, sondern die, auf die er passt.
      let ziel = null, beste = -Infinity;
      for (const b of bedarfsanalyse(state, club)) {
        if (bestAffinity(p, b.pos) < 0.7) continue;
        const s = playerRatingForSlot(p, b.pos) - b.zweiter + b.dringend * 6;
        if (s > beste) { beste = s; ziel = b; }
      }
      if (!ziel) continue;
      // Für eine Anfrage genügt es, wenn er dem Ersatzmann gefährlich wird.
      if (playerRatingForSlot(p, ziel.pos) < ziel.zweiter - KI_ANGEBOT_MANAGER_ABSTAND) continue;

      const gehalt = kiGehaltsbedarf(state, club, p);
      if (gehalt > gehaltsspielraum(state, club)) continue;
      const preis = abloseforderung(state, p.id, clubId);
      const dach = maximalGebot(state, club, p, kiVerfuegbaresBudget(state, club));
      if (preis > dach) continue;
      bieter.push({ club, ziel, preis, dach, gewicht: ziel.dringend * 6 + (club.reputation || 50) / 20 });
    }
    return bieter.length ? rng.pickWeighted(bieter, b => b.gewicht) : null;
  };

  let p = null, wahl = null;
  const rest = kandidaten.slice();
  for (let versuch = 0; versuch < KI_ANGEBOT_MANAGER_VERSUCHE && rest.length; versuch++) {
    const k = rng.pickWeighted(rest, x => x.reiz);
    if (!k) break;
    rest.splice(rest.indexOf(k), 1);
    wahl = suchen(k.p);
    if (wahl) { p = k.p; break; }
  }
  if (!p || !wahl) return null;

  const club = wahl.club;
  const forderung = wahl.preis;
  const gebot = Math.min(kiGebot(state, club, forderung, info.deadline, rng), wahl.dach);

  const antwort = angebotAbgeben(state, club.id, p.id, gebot, { ki: true, rng });
  if (!antwort.ok || !antwort.angebotId) return null;
  tmState(state).managerAngebote = (tmState(state).managerAngebote || 0) + 1;

  const listed = p.transfer && p.transfer.listed;
  meldung(ctx,
    `${club.name} bietet ${formatMoney(gebot)} für ${p.firstName} ${p.lastName} (${POSITION_NAMES[p.position]}, ${p.age} Jahre).\n\n` +
    `Marktwert: ${formatMoney(marktwert(state, p))}. Unsere Verhandlungsbasis läge bei ${formatMoney(forderung)}.\n` +
    (listed ? 'Er steht ohnehin auf unserer Transferliste.\n' : '') +
    (p.era === 'legend' ? 'Warnung des Fanbeauftragten: Ein Verkauf dieser Ikone wäre das Ende des Burgfriedens.\n' : '') +
    `Das Angebot liegt ${ANGEBOT_LAUFZEIT_TAGE} Tage auf dem Tisch.`,
    'transfer', {
      from: club.boardName || club.name,
      subject: `Angebot für ${name(p)}: ${formatMoney(gebot)}`,
      wichtig: true,
      aktionen: [
        { id: 'angebot_annehmen', label: 'Annehmen', angebotId: antwort.angebotId, playerId: p.id },
        { id: 'angebot_ablehnen', label: 'Ablehnen', angebotId: antwort.angebotId, playerId: p.id }
      ]
    });
  ticker(ctx, `${club.shortName || club.name} bietet für ${name(p)} — ${formatMoney(gebot)} sollen es sein.`, 'transfer');
  return antwort;
}

/**
 * Gerüchteküche. Gestreut wird nur über Spieler, die für diesen Verein
 * tatsächlich in Frage kämen — dann stimmt hinterher wenigstens die Hälfte.
 */
function kiGeruecht(state, ctx, club, markt, rng) {
  const bedarf = rng.pickWeighted(bedarfsanalyse(state, club).slice(0, 4), b => b.dringend + 0.05);
  if (!bedarf) return;
  const pool = (markt.byPos[bedarf.pos] || []).filter(
    e => e.p.clubId && e.p.clubId !== club.id && wechselPlausibel(state, e.p, club));
  if (!pool.length) return;
  const e = rng.pickWeighted(pool, x => x.reiz * (0.4 + x.verf));
  if (!e) return;
  const p = e.p;
  const tm = tmState(state);
  const varianten = [
    `${p.firstName} ${p.lastName} soll bei ${club.name} auf der Liste stehen.`,
    `Angeblich hat sich ${club.name} nach ${name(p)} (${clubName(state, p.clubId)}) erkundigt. Dementiert wird das nur halbherzig.`,
    `Der Berater von ${name(p)} wurde in der Nähe der Geschäftsstelle von ${club.name} gesehen. Reiner Zufall, versteht sich.`,
    `${club.shortName || club.name} sucht einen ${POSITION_NAMES[bedarf.pos]} — und ${name(p)} passt verdächtig gut ins Profil.`,
    `Aus gut unterrichteten Kreisen: ${club.name} soll ${formatMoney(abloseforderung(state, p.id, club.id))} für ${name(p)} geboten haben. Aus schlecht unterrichteten Kreisen auch.`,
    `${clubName(state, p.clubId)} weist „sämtliche Spekulationen" um ${name(p)} zurück. Genannt hatte die Gerüchte bis dahin niemand.`,
    `Ein Sportdirektor, der nicht genannt werden möchte, sagt über ${name(p)}: „Interessant ist er schon." Der Sportdirektor arbeitet bei ${club.name}.`,
    `${name(p)} hat seinen Urlaub angeblich in der Nähe von ${club.city || club.name} verbracht. Die Presse hält das für ein Indiz.`
  ];
  const text = rng.pick(varianten);
  const eintrag = { playerId: p.id, clubId: club.id, tag: state.date.day, season: state.date.season, text };
  tm.geruechte.unshift(eintrag);
  if (tm.geruechte.length > 60) tm.geruechte.length = 60;
  if (!Array.isArray(club.gerüchte)) club.gerüchte = [];
  club.gerüchte.unshift(eintrag);
  if (club.gerüchte.length > 12) club.gerüchte.length = 12;

  if (p.clubId === state.managerClubId || club.id === state.managerClubId) {
    ticker(ctx, text, 'geruecht');
    if (p.clubId === state.managerClubId) {
      meldung(ctx, `Die Presse schreibt: „${text}" Der Spieler hat es natürlich auch gelesen.`,
        'presse', { from: 'Pressestelle', subject: `Gerücht um ${name(p)}` });
    }
  } else if (rng.chance(0.4)) {
    ticker(ctx, text, 'geruecht');
  }
}

/** Ein KI-Verein kümmert sich um auslaufende Verträge. */
function kiVertraegeVerlaengern(state, club, rng) {
  const kandidaten = kaderOf(state, club.id).filter(p => restlaufzeit(state, p) <= 1);
  if (!kandidaten.length) return;
  const liste = kaderRangliste(state, club.id);
  for (const p of kandidaten) {
    let rang = liste.findIndex(x => x.id === p.id);
    if (rang < 0) rang = 99;
    // Nur wer gebraucht wird, bekommt einen neuen Vertrag.
    const wichtig = rang <= 15 || p.age <= 23;
    if (!wichtig || !rng.chance(0.5)) continue;
    const angebot = kiVertragsangebot(state, club, p, rng);
    if (angebot.gehalt - (p.contract.salary || 0) > gehaltsspielraum(state, club)) continue;
    const res = vertragVerlaengern(state, p.id, Object.assign({ rng }, angebot));
    if (!res.ok && res.forderung && res.forderung.gehalt - (p.contract.salary || 0) <= gehaltsspielraum(state, club)) {
      vertragVerlaengern(state, p.id, Object.assign({ rng }, angebot, {
        gehalt: res.forderung.gehalt, laufzeit: res.forderung.laufzeit
      }));
    }
  }
}

/* ==========================================================================
 * 13. Saisonwechsel: auslaufende Verträge, Leihrückkehr
 * ======================================================================== */

function saisonEndeVertraege(state, ctx) {
  const meineId = state.managerClubId;
  const rng = ctx && ctx.rng ? ctx.rng.fork('vertragsende') : tmRng(state, 'vertragsende');
  for (const clubId in state.clubs) {
    const club = state.clubs[clubId];
    const abgaenge = kaderOf(state, clubId).filter(p => restlaufzeit(state, p) < 0);
    for (const p of abgaenge) {
      // Der Kader darf nicht kollabieren: Notverlängerung, wenn es eng wird.
      if (club.playerIds.length <= MIN_KADER || hinterlaesstLuecke(state, club, p)) {
        p.contract.until = state.date.season + 1;
        continue;
      }
      entferneAusVerein(state, club, p);
      p.clubId = null;
      p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
      p.captain = false;
      state.freeAgents = state.freeAgents || [];
      state.freeAgents.push(p.id);
      if (clubId === meineId) {
        meldung(ctx, `${p.firstName} ${p.lastName} verlässt uns ablösefrei — der Vertrag ist ausgelaufen und niemand hat rechtzeitig verlängert.`,
          'transfer', { from: 'Geschäftsstelle', subject: `Ablösefrei weg: ${name(p)}`, wichtig: true });
      }
    }
    if (clubId !== meineId && rng.chance(0.9)) {
      club.tactics = autoLineup(kaderOf(state, clubId), club.tactics || {});
    }
  }
}

function leihenPruefen(state, ctx) {
  const tag = state.date.day;
  for (const id in state.players) {
    const p = state.players[id];
    const leihe = p.transfer && p.transfer.leihe;
    if (!leihe || !leihe.stammvereinId) continue;
    if (state.date.season > leihe.bisSaison || tag >= (leihe.bisTag || LEIH_RUECKKEHR_TAG)) {
      const rng = ctx && ctx.rng ? ctx.rng.fork('leihende:' + id) : tmRng(state, 'leihende');
      const aufnehmer = cl(state, p.clubId);
      const ziehen = !!(leihe.kaufoption && aufnehmer && aufnehmer.id !== state.managerClubId
        && verfuegbaresBudget(state, aufnehmer) >= leihe.kaufoption
        && (leihe.pflichtkauf || rng.chance(0.45)));
      leiheBeenden(state, p, ctx, ziehen);
    }
  }
}

/* ==========================================================================
 * 14. Der Tagesablauf
 * ======================================================================== */

/**
 * Tagesschritt des Transfermarkts.
 * Läuft für ALLE Vereine, meldet aber nur dem Manager-Verein etwas.
 */
export function tickTransfers(state, ctx = {}) {
  const tm = tmState(state);
  const tag = ctx.day !== undefined ? ctx.day : state.date.day;
  const saison = ctx.season !== undefined ? ctx.season : state.date.season;
  const rng = ctx.rng || tmRng(state, 'tick');
  const info = fensterInfo(state, tag);

  if (tm.statSaison !== saison) {
    tm.statSaison = saison;
    tm.saison = { zugaenge: 0, abgaenge: 0, transfers: 0, volumen: 0, leihen: 0 };
  }
  tm.letzterTag = tag;

  /* --- 1. Marktwerte gelegentlich nachführen ----------------------------- */
  if (tag - (tm.werteTag || -99) >= WERT_UPDATE_INTERVALL) {
    tm.werteTag = tag;
    for (const id in state.players) {
      const p = state.players[id];
      if (p && p.attributes) p.value = marktwert(state, p);
    }
  }

  /* --- 2. Beobachtungen laufen weiter ------------------------------------ */
  const meineId = state.managerClubId;
  const meinVerein = cl(state, meineId);
  if (meinVerein && meinVerein.scoutberichte) {
    for (const pid in meinVerein.scoutberichte) {
      const e = meinVerein.scoutberichte[pid];
      e.tage = (e.tage || 0) + 1;
      if (e.tage === 21) {
        const p = state.players[pid];
        if (p) meldung(ctx, `Zwischenbericht zu ${name(p)}: ${scoutbericht(state, meineId, pid).einschaetzung}`,
          'scouting', { from: 'Chefscout', subject: `Scoutbericht: ${name(p)}` });
      }
    }
  }

  /* --- 3. Protestpegel klingt langsam ab ---------------------------------- */
  if (ctx.isWeekStart) {
    for (const clubId in state.clubs) {
      const c = state.clubs[clubId];
      if (c.fans && c.fans.protest > 0) c.fans.protest = Math.max(0, c.fans.protest - PROTEST_ZERFALL);
    }
    let n = 0;
    // Europapokal-Gegner haben keinen Kader (core/state.js:euroClub) und damit
    // keine Verträge. Sie werden VOR dem Mischen aussortiert, nicht danach:
    // sonst fräßen sie die Hälfte des Wochenkontingents auf – und ein Mischen
    // über 130 statt 64 Vereine würde nebenbei den ganzen Zufallsstrom dieses
    // Tages verschieben und damit jede Balancezahl der Prüfstände.
    const verlaengerbar = Object.keys(state.clubs).filter(id => !state.clubs[id].istEuropaeisch);
    for (const clubId of rng.shuffle(verlaengerbar)) {
      if (clubId === meineId) continue;
      if (n++ >= KI_VERLAENGERN_PRO_WOCHE) break;
      kiVertraegeVerlaengern(state, state.clubs[clubId], rng.fork('verlaengern:' + clubId));
    }
  }

  /* --- 4. Leihen und Saisonende ------------------------------------------- */
  if (ctx.isSeasonEnd) {
    leihenPruefen(state, ctx);
    saisonEndeVertraege(state, ctx);
  } else if (tag === LEIH_RUECKKEHR_TAG) {
    leihenPruefen(state, ctx);
  }

  /* --- 5. Angebote pflegen ------------------------------------------------ */
  ablaufendeAngebote(state, ctx);

  /* --- 6. Geschlossenes Fenster: nur noch Papierkram ---------------------- */
  if (!info.offen) {
    if (ctx.isMonthStart && meinVerein) {
      const auslaufend = auslaufendeVertraege(state, meineId).filter(e => e.laeuftAus && e.rolle !== 'ueberzaehlig');
      if (auslaufend.length) {
        meldung(ctx, `${auslaufend.length} Verträge laufen zum Saisonende aus, darunter ` +
          auslaufend.slice(0, 3).map(e => name(e.player)).join(', ') +
          '. Wer nicht verlängert, verliert sie ablösefrei — und der Berater grinst.',
          'vertrag', { from: 'Geschäftsstelle', subject: 'Auslaufende Verträge' });
      }
    }
    return { fenster: false, transfers: tm.saison.transfers };
  }

  /* --- 7. Fenster offen: die KI wird aktiv -------------------------------- */
  if (info.tageBisSchluss === 7 && meinVerein) {
    meldung(ctx, 'Noch eine Woche, dann schließt das Transferfenster. Danach ist der Kader, wie er ist — ob es Ihnen passt oder nicht.',
      'transfer', { from: 'Geschäftsstelle', subject: 'Deadline in Sicht' });
  }
  if (info.deadline && meinVerein) {
    meldung(ctx, 'Deadline Day! Heute klingeln die Telefone heiß. Um Mitternacht ist Schluss.',
      'transfer', { from: 'Geschäftsstelle', subject: 'Deadline Day', wichtig: true });
  }

  const markt = marktIndex(state);
  const winter = info.art === 'winter';
  const alleIds = Object.keys(state.clubs).filter(
    id => id !== meineId && !state.clubs[id].istAmateur && !state.clubs[id].lazySquad);

  let anzahl = info.deadline ? KI_DEADLINE_VEREINE : KI_VEREINE_PRO_TAG;
  if (winter) anzahl = Math.max(2, Math.round(anzahl * KI_WINTER_FAKTOR));
  anzahl = Math.min(alleIds.length, anzahl);

  // Wer Geld hat, telefoniert. Im Winter ist das nur eine Handvoll Vereine —
  // die dürfen dann aber auch wirklich zum Zug kommen.
  const zahlungsfaehig = [], knapp = [];
  for (const id of alleIds) {
    const c = state.clubs[id];
    const dran = zwangsverkauf(c) || kiVerfuegbaresBudget(state, c) >= KI_HANDLUNGSFAEHIG;
    (dran ? zahlungsfaehig : knapp).push(id);
  }
  const aktive = rng.shuffle(zahlungsfaehig).slice(0, anzahl);
  if (aktive.length < anzahl) aktive.push(...rng.shuffle(knapp).slice(0, anzahl - aktive.length));
  // Der Deadline-Day-Rausch gehört zum Sommer. Im Januar wird auch am letzten
  // Tag nicht dreimal je Verein telefoniert — sonst entstand allein dort ein
  // Drittel aller Winterwechsel.
  const versuche = info.deadline
    ? (winter ? Math.max(1, Math.round(KI_VERSUCHE_DEADLINE * KI_WINTER_FAKTOR)) : KI_VERSUCHE_DEADLINE)
    : KI_VERSUCHE_PRO_TAG;

  for (const clubId of aktive) {
    const club = state.clubs[clubId];
    const cRng = rng.fork('ki:' + clubId + ':' + tag);
    // Große Vereine sind das ganze Fenster über rührig, kleine nur gelegentlich.
    const eifer = clamp(KI_HANDELN_CHANCE + ((club.reputation || 50) - 55) * KI_HANDELN_REP, 0.2, 0.95);
    if (!info.deadline && !cRng.chance(eifer)) continue;

    kiAufraeumen(state, ctx, club, cRng);
    // Wer Geld hat, versucht sich zusätzlich an einem großen Namen. Das ist
    // ein EIGENER Anlauf — sonst ginge der normale Einkauf dafür drauf.
    if (kiVerfuegbaresBudget(state, club) >= KI_PRESTIGE_BUDGET
      && cRng.chance(KI_PRESTIGE_CHANCE * (winter ? 0.5 : 1))) {
      kiEinkauf(state, ctx, club, markt, cRng, { prestige: true });
    }
    for (let v = 0; v < versuche; v++) {
      // Erst schauen, wen man loswird — der Erlös finanziert den Einkauf.
      if (zwangsverkauf(club) || cRng.chance(KI_VERKAUF_CHANCE * (winter ? 0.7 : 1))) {
        kiVerkauf(state, ctx, club, cRng);
      }
      kiEinkauf(state, ctx, club, markt, cRng);
    }
    if (cRng.chance(KI_GERUECHT_CHANCE)) kiGeruecht(state, ctx, club, markt, cRng);
  }

  /* --- 8. Beim Manager klingelt das Telefon ------------------------------- */
  if (meinVerein) {
    if (tm.managerFenster !== info.art + ':' + saison) {
      tm.managerFenster = info.art + ':' + saison;
      tm.managerAngebote = 0;
    }
    const chance = clamp(KI_ANGEBOT_MANAGER_CHANCE
      * (info.deadline ? KI_ANGEBOT_MANAGER_DEADLINE : 1)
      * (winter ? KI_WINTER_FAKTOR * 1.6 : 1), 0, 1);
    if ((tm.managerAngebote || 0) < KI_ANGEBOT_MANAGER_MAX && rng.chance(chance)) {
      kiAngebotAnManager(state, ctx, rng.fork('angebot:' + tag));
    }
  }

  return {
    fenster: true, art: info.art, deadline: info.deadline,
    transfers: tm.saison.transfers, volumen: tm.saison.volumen, leihen: tm.saison.leihen
  };
}

/* ==========================================================================
 * 15. Kleine Auskünfte für die Screens
 * ======================================================================== */

/** Die letzten Transfers ligaweit. */
export function letzteTransfers(state, anzahl = 20) {
  const h = (state.history && state.history.transfers) || [];
  return h.slice(-anzahl).reverse().map(t => Object.assign({}, t, {
    von: t.vonId ? clubName(state, t.vonId) : 'vereinslos',
    zu: clubName(state, t.zuId)
  }));
}

/** Aktuelle Gerüchte. */
export function geruechte(state, anzahl = 12) {
  return tmState(state).geruechte.slice(0, anzahl);
}

/** Transferbilanz eines Vereins in dieser Saison. */
export function transferbilanz(state, clubId) {
  const h = (state.history && state.history.transfers) || [];
  let ein = 0, aus = 0, zugaenge = 0, abgaenge = 0;
  for (const t of h) {
    if (t.season !== state.date.season) continue;
    if (t.zuId === clubId) { aus += t.ablose; zugaenge++; }
    if (t.vonId === clubId) { ein += t.ablose; abgaenge++; }
  }
  return {
    einnahmen: ein, ausgaben: aus, saldo: ein - aus, zugaenge, abgaenge,
    text: `${zugaenge} Zugänge für ${formatMoney(aus)}, ${abgaenge} Abgänge für ${formatMoney(ein)} — Saldo ${formatMoney(ein - aus)}.`
  };
}
