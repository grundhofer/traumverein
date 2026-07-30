/**
 * club/morale.js — Die Kabine.
 * ============================================================================
 *
 * Hier wohnt der Teil des Spiels, den man nicht auf dem Trainingsplatz sieht:
 * Moral, Hackordnung, Freundschaften, Zickereien, Cliquen und der ganz normale
 * Wahnsinn einer Profimannschaft, in der ein 22-jähriger Millionär neben einer
 * lebenden Legende auf der Bank sitzt und beide finden, der andere sei das
 * Problem.
 *
 * GRUNDSATZ (ausdrücklicher Wunsch): Motivation hat GROSSEN Einfluss auf die
 * Leistung. `moralEffektAufLeistung()` liefert einen Faktor von 0,85 bis 1,12 —
 * zwischen einer verzankten und einer brennenden Mannschaft liegen also gut
 * 30 % Leistung. Das ist bewusst mehr, als jeder Transfer je bringen kann.
 *
 * Abgrenzung zu engine/ratings.js:
 *   ratings.effectiveRating() rechnet die Moral bereits mit rund 10 % Bandbreite
 *   in die Einzelbewertung ein (WEIGHTS.moralInd). DIESES Modul liefert mit
 *   moralEffektAufLeistung() den ZUSÄTZLICHEN Kabinen-Faktor (Konflikte, Streik,
 *   Teamgeist, Kapitänsbonus), den die Match-Engine obendrauf multipliziert.
 *   Doppelt gezählt wird nichts: ratings kennt nur `player.morale`,
 *   morale.js liefert das soziale Drumherum.
 *
 * Zuständigkeit laut CONTRACTS.md §11:
 *   Moral, Spielerpersönlichkeit, Kabinen-Hierarchie, Konflikte, Gespräche.
 *   NICHT: Verletzungen (medical), Training (training), Transfers (transfers).
 *
 * Kein DOM. Kein Math.random(). Kein Date.now().
 * Alle Balancing-Zahlen stehen als benannte Konstanten oben.
 */

import { clamp, round, avg, sortBy } from '../core/util.js';
import { createRng, hashString } from '../core/rng.js';
import { POSITION_NAMES, POSITION_GROUP, NATION_NAMES, TRAITS } from '../core/constants.js';
import { playerOverall } from '../engine/ratings.js';

/* ==========================================================================
 * 1. BALANCING — alle Stellschrauben an einem Ort
 * ======================================================================== */

/** Wertebereich der Moral. 62 ist der "zufriedene Normalzustand". */
export const MORAL_MIN = 1;
export const MORAL_MAX = 99;
export const MORAL_NEUTRAL = 62;

/** Tagesdynamik: Wie schnell nähert sich die Moral ihrem Zielwert? */
const MORAL_SCHRITT = 0.20;        // Anteil der Differenz pro Tag
const MORAL_SCHRITT_MAX = 5.5;     // harte Obergrenze pro Tag (ohne Ereignisse)
const MORAL_TRAEGHEIT = 0.35;      // Mindestbewegung, damit nichts einfriert

/** Gewichte der vier Zufriedenheits-Dimensionen (Summe = 1,0). */
const W_SPIELZEIT = 0.34;
const W_GEHALT = 0.20;
const W_AMBITION = 0.22;
const W_TRAINER = 0.24;
/** Übersetzung der Dimensionen (0..100, Bezug 60) in Moralpunkte. */
const DIM_GAIN = 0.72;

/** Zusatz-Modifikatoren auf die Zielmoral (in Moralpunkten). */
const MOD_VERTRAG_AUSLAUFEND = -13;
const MOD_VERTRAG_LETZTES_JAHR = -5;
const MOD_VERTRAG_LANG = 3;
const MOD_TRANSFERLISTE = -16;
const MOD_WECHSELWUNSCH = -9;
const MOD_ANGEBOT_JE = 4;          // Angebote schmeicheln (Ehrgeizige mehr)
const MOD_ANGEBOT_MAX = 9;
const MOD_VERLETZT_JE_SCHWERE = -3.2;
const MOD_VERLETZT_BASIS = -5;
const MOD_KONFLIKT_JE_SCHWERE = -5.5;
const MOD_KONFLIKT_MAX = -18;
const MOD_HEIMWEH_MAX = -9;
const MOD_FREUND_JE = 1.8;
const MOD_FREUND_MAX = 5.5;
const MOD_KAPITAEN = 4;
const MOD_STREIK = -8;

/** Erfolg der Mannschaft (Serie der letzten fünf Spiele). */
const W_SERIE = 11;                // volle Punktausbeute = +11, null Punkte = -11
const W_TABELLE = 7;               // Ziel klar übertroffen/verfehlt

/** Ergebnis-Impuls direkt nach einem Spiel (auf die Moral, nicht das Ziel). */
const IMPULS_SIEG = 5.0;
const IMPULS_REMIS = 0.4;
const IMPULS_NIEDERLAGE = -5.0;
const IMPULS_TORDIFF = 0.9;        // je Tor Unterschied
const IMPULS_TORDIFF_MAX = 3.5;
const IMPULS_BANK = 0.55;          // Reservisten erleben alles gedämpfter
const IMPULS_DERBY = 1.4;

/** Spielzeit-Erwartung nach Rang im Kader (Anteil der möglichen Minuten). */
const ERWARTUNG_STAMM = 0.82;      // Kaderrang 1–11
const ERWARTUNG_ROTATION = 0.48;   // Rang 12–16
const ERWARTUNG_ERGAENZUNG = 0.22; // Rang 17+
const ERWARTUNG_JUGENDBONUS = -0.18; // unter 21 wird geduldiger gewartet
const ERWARTUNG_ALTSTAR = 0.06;    // ab 32 will man beweisen, dass es noch geht

/**
 * Konflikte.
 *
 * WIE OFT SICH DIE ÄRA-FRAGE STELLT — die zweite Hälfte der Ära-Balance. Die
 * Abnahme zu ROADMAP 8.3 kam beim Verein des Spielers auf 0,38 ära-übergreifende
 * Konflikte je Spielzeit: einer alle zweieinhalb Jahre. Damit ist es kein
 * Spielprinzip, sondern eine Anekdote. Die URSACHE war nicht die Gewichtung und
 * nicht die Grundrate, sondern KONFLIKT_VERJAEHRUNG_TAGE — die es nicht gab:
 *
 *   Ein Streit, den niemand beantwortet, eskalierte bis Schwere 3 und blieb dann
 *   FÜR IMMER offen. Nach vier davon verbot KONFLIKT_MAX_OFFEN jeden weiteren —
 *   dauerhaft. Das traf jeden KI-Verein (dort antwortet nie jemand) und jeden
 *   Prüfstand, der die Post nicht liest. Nach ein paar Wochen war die halbe
 *   Spielwelt versiegelt, und danach entstand nirgends mehr Streit. Wer aussitzt,
 *   zahlt jetzt Schwere 3 für gut zehn Wochen — und danach ist Gras drüber
 *   gewachsen, mit einer Narbe in der Chronik.
 *
 * KONFLIKT_CHANCE_SPIELER stand dazu auf 0,055 und war damit doppelt zu hoch:
 * Sobald die Sperre gelöst war, standen beim Verein des Spielers 17 Konflikte je
 * Spielzeit in den Büchern (alle drei Wochen einer, jeder mit einem Dialog) —
 * mehr, als eine Frage verkraftet, die etwas kosten soll. Auf 0,018 sind es rund
 * neun. Zum Vergleich, dieselbe Messung im Stand davor (0,055 je Tag, keine
 * Verjährung): 27,4 Konflikte und 6,4 Ära-Konflikte je Spielzeit, wenn der
 * Manager antwortet — und 1,0 bzw. 0,19, wenn er es nicht tut. Das war der
 * eigentliche Fehler: nicht „zu selten", sondern „zweimal falsch", je nachdem,
 * ob man hingeht.
 *
 * DIE ZWEITE URSACHE, gefunden erst in der Abnahme, und die schwerere: Die
 * Schranke, die einen „jungen Star" definiert, hat `legende_star` — laut
 * Kommentar das Herzstück dieses Spiels — ab der dritten Spielzeit RECHNERISCH
 * UNMÖGLICH gemacht. Sie stand auf `leistungPct > 0,45`, dem Rang im ganzen
 * Kader, und ein Legendenverein hat zehn Legenden in einem 20-Mann-Kader: Die
 * belegen die obere Hälfte vollständig. Die Folge war ein Verlauf, der genau den
 * Befund von 8.3 wiederholte, nur zwei Jahre später (Seeds 3/7/11/23, Ära-Streit
 * je Spielzeit S1…S5): 5·2·0·0·0 · 6·3·2·1·1 · 7·4·2·3·1 · 1·3·3·0·1. Gemessen
 * wird die Schranke jetzt IM MODERNEN LAGER (siehe bauKonfliktKandidaten).
 *
 * Danach, gemessen am echten Spiel (HSV, Profi, acht Seeds
 * 3/7/11/23/42/101/555/999, je fünf Spielzeiten, Manager beantwortet jeden
 * Streit — unabhängig nachgemessen in der Abnahme, nicht im Prüfstand):
 *
 *   Ära-Konflikte beim eigenen Verein je Spielzeit:  3,2 · 3,2 · 4,8 · 4,2 ·
 *                                                    1,6 · 2,0 · 3,4 · 2,2
 *   Im Mittel: 3,08 (vor der Schranken-Reparatur 2,2 über die ersten vier Seeds)
 *   Konflikte insgesamt je Spielzeit:                9,03 (vorher 8,85)
 *   Anteil Ära daran:                                20 % bis 55 %, im Mittel 34 %
 *   KI-Vereine:                                      1,08 je Verein und Spielzeit
 *                                                    (vorher 1,08 — unverändert)
 *   Laufzeit einer Spielzeit im Tagesablauf:         10,2 s (vorher 10,3 s)
 *
 * Wer aussitzt, bekommt sie trotzdem: dieselben Seeds ohne eine einzige Antwort
 * liefern 2,55 je Spielzeit, und dort hält der Korridor über ALLE acht Seeds
 * (2,0 bis 3,6). OFFEN GEBLIEBEN: Wer antwortet, bekommt eine Spanne von 1,6 bis
 * 4,8, und die reißt den Korridor 1,5–4 nach oben bei zwei von acht Seeds. Sie
 * hängt daran, wie sich der Kader über die Jahre entwickelt (Alter, Transfers),
 * und ließe sich nur mit einer Rückkopplung glätten — die es hier nicht gibt.
 *
 * Nachgemessen wird das in tools/test-moral.js, Gruppe 4d — dort steht auch, mit
 * welchem Faktor ein Prüfstand ohne Spielbetrieb auf diese Zahlen hochrechnet.
 */
const KONFLIKT_CHANCE_SPIELER = 0.018;   // pro Tag, Verein des Managers
const KONFLIKT_CHANCE_KI = 0.003;        // pro Tag, KI-Verein (billig halten!)
const KONFLIKT_CHANCE_MAX = 0.30;
const KONFLIKT_MAX_OFFEN = 4;
const KONFLIKT_SCHWELT_TAGE = 21;        // danach eskaliert ein ignorierter Streit
const KONFLIKT_VERJAEHRUNG_TAGE = 30;    // … und danach schläft er ein, statt die Kabine zu sperren
const KONFLIKT_TEAMGEIST_JE = 6;         // Abzug auf den Teamgeist je Schwere

/**
 * Ära-Konflikte — die zwei Wege, die es nur gibt, wenn eine Legende und ein
 * moderner Spieler aneinandergeraten (KONFLIKT_ARTEN mit `aera: true`).
 *
 * Der Sinn dieser beiden Wege ist ausdrücklich NICHT, dass einer der bessere
 * wäre. Beide beenden den Streit — eine Entscheidung ist eine Entscheidung —
 * und beide schicken eine Rechnung über RUND DIESELBE SUMME an eine andere
 * Adresse. Was sich unterscheidet, ist der Zuschnitt:
 *
 *   „Der Alte hat recht"             → BREIT und KURZ. Jeder moderne Spieler
 *       zahlt einen kleinen Betrag, alle am selben Tag. Die Delle sitzt sofort
 *       und ist nach zwei, drei Wochen weitgehend aufgeholt. Wer am Samstag ein
 *       wichtiges Spiel hat, zahlt hier am meisten — und behält seine Hierarchie.
 *
 *   „Die Zeiten haben sich geändert" → SCHMAL und LANG. Eine Person zahlt fast
 *       alles, dafür monatelang: Laune, Ansehen in der Hackordnung (120 Tage
 *       Nachhall) und Vertrauen in den Trainer. Dazu kommt, was der andere Weg
 *       NICHT hat, weil eine Legende mehr ist als ein Spieler:
 *         · ihre Vertrauten in der Kabine nehmen es ihr ab (`beziehungen()`),
 *         · ein Talent, das sie großzieht, verliert seinen Mentor
 *           (die Bögen aus `club/chemie.js` — Felder, nicht Import: chemie.js
 *           liest seinerseits `hierarchie()` aus dieser Datei),
 *         · und eine gekränkte Vereinsikone kann ihren Abschied verlangen.
 *
 * Die Bilanz ist damit ausgeglichen, ohne gleich zu sein. Zwei UNABHÄNGIGE
 * Messaufbauten, jeweils echte, im Spielverlauf von selbst entstandene
 * Ära-Konflikte, Kosten über 120 Tage als Verlust gegenüber einem Zwilling, in
 * dem derselbe Streit ohne Preis endet:
 *
 *   (a) 121 Fälle BEIM VEREIN DES SPIELERS (HSV, Profi, Seeds
 *       3/7/11/23/42/101/555/999, je fünf Spielzeiten):
 *                                  Kadermoral  Trainervertr.  Teamgeist  Summe
 *       Der Alte hat recht              29,7        14,2         16,5      60,4
 *       Die Zeiten haben sich geändert  27,5        34,5         15,1      77,2
 *       Verhältnis 1,28 (Median 1,08). Je Fall billiger: 58 : 63.
 *
 *   (b) 113 Läufe des Prüfstands (tools/test-moral.js 4c — Ernte über ALLE
 *       Vereine plus zwei künstlich ausgedünnte Kaderbilder):
 *       Der Alte hat recht              37,7        17,5         21,6      76,8
 *       Die Zeiten haben sich geändert  14,8        33,0         12,5      60,2
 *       Verhältnis 1,28 (Median 1,36). Je Fall billiger: 39 : 74.
 *
 * Beide Aufbauten liegen im 40-%-Korridor, beide kommen auf dasselbe Verhältnis
 * 1,28, und beide sagen dasselbe über den ZUSCHNITT: „Der Alte hat recht" ist
 * teurer in Laune und Teamgeist, „Die Zeiten …" im Trainervertrauen und im
 * Ansehen der Legende (−34 gegen +6 Punkte). Sofortige Delle 3,6 bzw. 4,2 gegen
 * 0,3 bzw. 0,5 Launepunkte je Kopf, halb aufgeholt nach 4 gegen 23 bis 29 Tagen
 * — breit und kurz gegen schmal und lang.
 *
 * WORIN SIE SICH NICHT EINIG SIND, und das ist ehrlich zu sagen: Aufbau (a)
 * sieht „Die Zeiten …" als den etwas teureren Weg, Aufbau (b) „Der Alte hat
 * recht". Die Konstanten sind der Punkt, an dem beide gerade noch im Korridor
 * liegen; er ist eng. Offen bleibt eine Teilmenge: beim Verein des Spielers mit
 * INTAKTER Kabine (Ø Laune ≥ 46, 48 der 121 Fälle) steht es 69,5 : 100,7, also
 * 1,45 — dort ist das Machtwort für die Legende der spürbar billigere Weg. Der
 * Grund ist strukturell und nicht wegzudrehen: Laune kehrt mit ~20 % je Tag
 * zurück (Integral über 120 Tage: Faktor 5), Trainervertrauen mit 6 %
 * (Faktor 16,7). Wer über ein Vierteljahr summiert, vergleicht damit immer auch
 * eine schnelle mit einer langsamen Währung. In einer intakten Kabine, in der
 * der Boden AERA_LAUNE_BODEN nichts abfängt, gewinnt die langsame.
 *
 * DREI ZAHLEN, an denen diese Balance dreimal gescheitert ist, und warum:
 *
 * 1. AERA_MODERN_TRAINER stand auf −5 je Kopf. Bei dreizehn Modernen hing das
 *    über den langsamen Kanal ein halbes Jahr nach: −112 Punkte in der ersten
 *    Abnahme zu ROADMAP 8.3, gegen −10 beim anderen Weg.
 *
 * 2. AERA_MODERN_LAUNE stand auf −7,0 OHNE BODEN. Das sah kurz aus und war es
 *    nicht: Ein echter Kader steht bei Ø Laune 43, nicht bei 66 wie ein
 *    Kunstkader. Sieben Punkte auf dreizehn Köpfe schoben dort im Schnitt 1,19
 *    Spieler je Entscheidung unter SCHWELLE_WECHSELWUNSCH — und ein
 *    Wechselwunsch heilt nicht, er kostet über MOD_WECHSELWUNSCH bis zum
 *    Saisonende weiter. „Breit und kurz" war in Wahrheit „breit und für immer".
 *    Behoben nicht mit einer kleineren Zahl, sondern mit AERA_LAUNE_BODEN: Der
 *    Abzug trifft jeden, stürzt aber niemanden ab (siehe aeraStossMitBoden).
 *    Gemessen jetzt 0,0 zusätzliche Wechselwünsche je Entscheidung statt 1,19.
 *
 * 3. Der Anlauf, der Nummer 1 beheben wollte, drückte AERA_MODERN_TRAINER auf
 *    −1,0 und kippte damit ins andere Extrem: „Die Zeiten haben sich geändert"
 *    kostete danach das Doppelte (42,9 : 87,0, Verhältnis 2,03) und war auf
 *    ALLEN vier Achsen der teurere Weg. Dieselbe Formalie wie vorher, nur mit
 *    umgekehrtem Vorzeichen. Die Lehre: Nicht „welche Währung gehört zu welchem
 *    Weg", sondern „beide Wege tragen beide Währungen, in umgekehrter Mischung".
 *
 * Die Lehre für jeden, der hier weiterdreht: Diese Kosten sind NICHT linear in
 * den Konstanten, und sie hängen am Messaufbau. Zwischen Laune 30 und Laune 22
 * liegt eine Schwelle, hinter der ein Abzug nicht mehr abklingt. Wer die Wirkung
 * eines Machtworts wissen will, misst sie an einem echten Kader (Gruppe 4c fährt
 * dafür das ganze Spiel hoch), an mindestens zwei Grundgesamtheiten — und
 * berichtet beide, auch wenn sie sich widersprechen.
 *
 * Warum überhaupt eine Frage und keine Zahl: Die Chemie allein kostet über ihre
 * ganze Spanne 0,03 Notenpunkte je Spiel — zu wenig für eine Entscheidung. Eine
 * Frage, die man beantworten MUSS und die in beiden Antworten etwas kostet, ist
 * der billigere und ehrlichere Weg.
 */

/* --- „Der Alte hat recht": breit und kurz ---------------------------------- *
 * Die Hauptwährung ist die LAUNE (kehrt mit MORAL_SCHRITT, also ~20 % je Tag,
 * zur Zielmoral zurück). Dazu ein KLEINER, aber echter Kratzer im
 * Trainervertrauen — und dieses Maß ist der Punkt, an dem die Balance beim
 * dritten Anlauf hing:
 *
 *   Trainervertrauen driftet nur 6 % je Tag zurück. Über 120 Tage summiert sich
 *   ein Punkt Vertrauen damit auf 16,7 Punkte, ein Punkt Laune nur auf 5. Wer
 *   beide Wege über 120 Tage vergleicht, vergleicht deshalb NICHT „viele zahlen
 *   wenig" gegen „einer zahlt viel", sondern eine schnelle gegen eine langsame
 *   Währung — und die langsame gewinnt immer. Anlauf 2 hat AERA_MODERN_TRAINER
 *   deswegen von −5 auf −1,0 gedrückt und damit ins andere Extrem gekippt:
 *   „Die Zeiten haben sich geändert" kostete danach das Doppelte und war auf
 *   ALLEN vier Achsen der teurere Weg (Abnahme: 42,9 : 87,0, Verhältnis 2,03).
 *   Das war dieselbe Formalie wie vorher, nur mit umgekehrtem Vorzeichen.
 *
 * Jetzt tragen BEIDE Wege beide Währungen, nur in umgekehrter Mischung: hier
 * viel Laune und wenig Vertrauen, dort wenig Laune und viel Vertrauen. */
const AERA_MODERN_LAUNE = -8.0;          // je moderner Spieler, sofort spürbar
const AERA_MODERN_JUNGSTAR = -16.0;      //   … den öffentlich Überstimmten härter
const AERA_LAUNE_BODEN = 24;             //   … aber keiner fällt unter diese Laune (siehe aeraStossMitBoden)
const AERA_MODERN_TRAINER = -1.45;       //   … ein Kratzer im Vertrauen, keine Wunde
const AERA_MODERN_TRAINER_HART = 3.6;    //   … Faktor davon für den Jungstar
const AERA_LEGENDE_LOB = 6.0;            //   … die Legende fühlt sich bestätigt
const AERA_LEGENDE_RUECKEN = 7;          //   … und steht in der Hackordnung fester

/* --- „Die Zeiten haben sich geändert": schmal und lang --------------------- *
 * Hier trägt EINE Person fast alles, dafür monatelang: Ansehen klingt über
 * ANSEHEN_DAUER_TAGE ab, Trainervertrauen mit 6 % je Tag. Halb aufgeholt ist
 * diese Delle erst nach 33 Tagen — fast zehnmal so lange wie beim anderen Weg.
 *
 * Die Kränkung ist bewusst kleiner als der Vertrauensverlust: Eine öffentlich
 * zurückgepfiffene Ikone ist nicht in erster Linie schlecht gelaunt, sie hat
 * das Vertrauen verloren. Und weil dimTrainer über DIM_GAIN × W_TRAINER in die
 * Zielmoral eingeht, zieht der Vertrauensverlust die Laune ohnehin monatelang
 * mit — wer hier beides groß macht, zahlt zweimal für dieselbe Sache. */
const AERA_LEGENDE_KRAENKUNG = -13.5;    // die Kränkung der Legende
const AERA_LEGENDE_ANSEHEN = -28;        //   … ihr Einflussverlust in der Hackordnung
const AERA_LEGENDE_TRAINER = -25;        //   … und ihr Vertrauen in Sie, monatelang
const AERA_GEFOLGE_MAX = 3;              // mehr Vertraute hat niemand, die ihn deckten
const AERA_GEFOLGE_LAUNE = -3.0;         //   … seine Vertrauten in der Kabine
const AERA_GEFOLGE_TRAINER = -5.9;       //   … und ihr Vertrauen in Sie
const AERA_LEGENDE_ABGANG = 0.10;        // Chance, dass die Ikone gehen will (auch bei Zustimmung)
const AERA_MODERN_AUFATMEN = 0.5;        //   … die Jungen atmen auf, mehr nicht
const AERA_MODERN_JUNGSTAR_PLUS = 4.5;

const AERA_FEHLSCHLAG = 1.55;            // Aufschlag auf den Preis, wenn die Kabine nicht mitgeht
const ANSEHEN_DAUER_TAGE = 120;          // so lange wirkt ein Machtwort in der Hackordnung nach
const ANSEHEN_MIN = -40;                 // Grenzen des Nachhalls, damit nichts davonläuft
const ANSEHEN_MAX = 20;

/** Gespräche & Ansprachen. */
const GESPRAECH_SPERRE_TAGE = 5;         // pro Spieler und Thema
const MOTIVATION_GEWICHT = 0.65;         // Anteil der Managerskills am Erfolg
const RUF_GEWICHT = 0.20;
const ANSPRACHE_MAX_DELTA = 9;
const ANSPRACHE_RISIKO_BASIS = 0.22;

/** Teamgeist. */
const TG_MORAL = 0.55;
const TG_HIERARCHIE = 0.14;
const TG_KONFLIKT = 0.20;
const TG_CLIQUEN = 0.11;

/**
 * Cliquen — die Gruppenebene über den Beziehungen (Roadmap-Stufe 4, Punkt 3).
 *
 * Eine Clique ist keine Liste von Landsleuten, sondern eine Gruppe, die sich
 * auch WIRKLICH mag: Kandidat wird man über ein gemeinsames Merkmal
 * (Nationalität, Ära, Jahrgang, gemeinsame Vereinsjahre), aufgenommen wird nur,
 * wer innerhalb der Gruppe mindestens eine Freundschaft aus `beziehungen()` hat.
 */
const CLIQUE_MIN = 2;
const CLIQUE_MAX = 8;                    // größere Gruppen sind keine Clique mehr, sondern der Kader
const CLIQUE_MAX_JE_SPIELER = 3;         // niemand gehört überall dazu
const CLIQUE_ANTEIL_MAX = 0.62;          // wer die Mehrheit stellt, bildet keine Clique
const CLIQUE_DICHTE = 0.55;              // Gewicht der Freundschaftsdichte in der Stärke
const CLIQUE_GROESSE = 0.30;             // Gewicht des Kaderanteils
const CLIQUE_SPALTUNG = 0.15;            // Gewicht des Moralunterschieds zum Rest
const CLIQUE_SPALTUNG_SKALA = 25;        // ab so vielen Moralpunkten Unterschied voll gewertet
const CLIQUE_MINDESTSTAERKE = 18;        // darunter ist es kein Grüppchen, sondern Zufall

/** Wirkung der Cliquen. */
const CLIQUE_ANSTECKUNG = 0.05;          // Anteil der Moraldifferenz zum Cliquenführer, je Tag
const CLIQUE_ANSTECKUNG_MAX = 1.2;       // Moralpunkte je Spieler und Tag
/**
 * Lagerbildung. Absichtlich hoch angesetzt: Bei Schwelle 58 hätten 24 von 36
 * Vereinen zwei „starke" Cliquen und das Konfliktrisiko wäre flächendeckend
 * erhöht — dann ist es kein Ereignis mehr, sondern eine neue Grundrate.
 * Bei 66 sind es 5 von 36, und gezählt werden nur Lager, die sich KEINEN
 * Spieler teilen: Zwei Gruppen mit gemeinsamen Köpfen sind kein Grabenkampf,
 * sondern derselbe Freundeskreis von zwei Seiten betrachtet.
 */
const CLIQUE_LAGER_SCHWELLE = 66;        // ab dieser Stärke gilt eine Clique als Lager
const CLIQUE_LAGER_JE = 0.45;            // Konfliktrisiko je zusätzlichem getrennten Lagerpaar
const CLIQUE_LAGER_MAX = 2.0;

/** Mentoren (club/chemie.js): Wer Talente erzieht, gewinnt in der Kabine Ansehen. */
const MENTOR_EINFLUSS_JE = 5;

/** Leistungswirkung — DER zentrale Hebel dieses Moduls. */
const LEISTUNG_GAIN = 0.26;          // Moral 1 vs. 99 ≈ 26 %
const LEISTUNG_TEAMGEIST = 0.10;     // Teamgeist 10 vs. 100 ≈ 9 %
const LEISTUNG_KONFLIKT_JE = -0.020;
const LEISTUNG_KONFLIKT_MAX = -0.055;
const LEISTUNG_STREIK = -0.045;
const LEISTUNG_KAPITAEN = 0.010;
const LEISTUNG_LEADER = 0.008;
const LEISTUNG_MIMOSE = 1.28;        // Verstärkung der Abweichung
const LEISTUNG_MIN = 0.85;
const LEISTUNG_MAX = 1.12;

/** Schwellen für Ereignisse. */
const SCHWELLE_BESCHWERDE = 34;
const SCHWELLE_WECHSELWUNSCH = 22;
const SCHWELLE_STREIK = 15;
const SCHWELLE_LOB = 88;
const SCHWELLE_ANSPRACHE_NOETIG = 40;   // Teamgeist

/* ==========================================================================
 * 2. Lazy-Init & kleine Helfer
 * ======================================================================== */

/** Kabinen-Datensatz eines Vereins. Wird beim ersten Zugriff angelegt. */
function kabine(club) {
  if (!club.kabine) {
    club.kabine = {
      konflikte: [],           // siehe konflikt()
      beziehungen: null,       // Cache
      beziehungenTag: -999,
      hierarchie: null,        // Cache
      hierarchieTag: -999,
      ansehen: {},             // { playerId: { wert, tag } } — Nachhall von Machtworten
      mannschaftsrat: [],
      letzteAnsprache: null,
      teamgeist: 60,
      streikTage: 0,
      chronik: [],             // [{ tag, saison, text }]
      letzterErgebnisTag: -1,
      zaehler: 0,
      konfliktNr: 0
    };
  }
  return club.kabine;
}

/** Zufriedenheits-Datensatz eines Spielers (state.js legt happiness bereits an). */
function hp(p) {
  if (!p.happiness) p.happiness = { spielzeit: 60, gehalt: 60, ambition: 60, trainer: 60, beschwerden: [] };
  const h = p.happiness;
  if (!Array.isArray(h.beschwerden)) h.beschwerden = [];
  if (h.trend === undefined) h.trend = 0;
  if (h.zielMoral === undefined) h.zielMoral = p.morale !== undefined ? p.morale : MORAL_NEUTRAL;
  if (!h.gruende) h.gruende = [];
  if (!h.gespraeche) h.gespraeche = {};     // { thema: tag }
  return h;
}

function persona(p) {
  return p.personality || { id: 'profi', name: 'Musterprofi', moraleSwing: 1, loyalty: 1, ambition: 1 };
}

function squadOf(state, club) {
  const out = [];
  for (const id of club.playerIds || []) {
    const p = state.players[id];
    if (p) out.push(p);
  }
  return out;
}

/** Deterministische Rng ohne Umweg über core/state.js (keine Zyklen, kein Math.random). */
function localRng(state, club, label) {
  const k = club ? kabine(club) : null;
  const n = k ? (k.zaehler = (k.zaehler | 0) + 1) : 0;
  const seed = hashString(
    String(label) + '|' + (state.seed | 0) + '|' + (state.tick | 0) + '|' +
    (state.date ? state.date.day : 0) + '|' + (state.date ? state.date.season : 1) + '|' + n
  );
  return createRng(seed);
}

function name(p) { return p ? (p.shortName || p.lastName || 'Der Spieler') : 'Der Spieler'; }
function vollName(p) { return p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() : 'Der Spieler'; }
function nation(p) { return NATION_NAMES[p && p.nationality] || 'Ausland'; }
function posName(p) { return POSITION_NAMES[p && p.position] || 'Feldspieler'; }

/** Stabiler Paar-Schlüssel für die Beziehungsmatrix. */
function paarKey(a, b) { return a < b ? a + '~' + b : b + '~' + a; }

/** Kaderrang nach Stärke (0 = bester). */
function kaderRaenge(spieler) {
  const sortiert = sortBy(spieler, p => ({ key: playerOverall(p), desc: true }));
  const rang = {};
  sortiert.forEach((p, i) => { rang[p.id] = i; });
  return rang;
}

/** Punkte der letzten fünf Spiele → -1 … +1. */
function serieWert(club) {
  const s = club.season || {};
  let liste = Array.isArray(s.letzteErgebnisse) && s.letzteErgebnisse.length
    ? s.letzteErgebnisse
    : (Array.isArray(s.form) ? s.form : []);
  liste = liste.slice(-5);
  if (!liste.length) return 0;
  let punkte = 0;
  for (const e of liste) {
    const z = typeof e === 'string' ? e.toUpperCase() : (e && e.ergebnis ? String(e.ergebnis).toUpperCase() : '');
    if (z === 'S' || z === 'W') punkte += 3;
    else if (z === 'U' || z === 'D') punkte += 1;
    else if (typeof e === 'number') punkte += clamp(e, 0, 3);
  }
  const max = liste.length * 3;
  return max ? (punkte / max) * 2 - 1 : 0;
}

/** Tabellenplatz gegen Saisonziel → -1 (weit verfehlt) … +1 (weit übertroffen). */
function zielWert(club) {
  const platz = club.season && club.season.platz ? club.season.platz : 0;
  const ziel = club.board && club.board.erwartung ? club.board.erwartung.platz : 0;
  if (!platz || !ziel) return 0;
  return clamp((ziel - platz) / 6, -1, 1);
}

/** Anteil an den möglichen Einsatzminuten (0..1), grob über den Kadervergleich. */
function spielzeitAnteil(p, maxMinuten) {
  const m = p.stats && p.stats.season ? (p.stats.season.minuten || 0) : 0;
  if (maxMinuten <= 0) return 0.5;         // Saisonstart: noch niemand hat gespielt
  return clamp(m / maxMinuten, 0, 1);
}

/** Erwartete Spielzeit aus Kaderrang, Alter und Ehrgeiz. */
function spielzeitErwartung(p, rang, ambition) {
  let e = rang <= 10 ? ERWARTUNG_STAMM : rang <= 15 ? ERWARTUNG_ROTATION : ERWARTUNG_ERGAENZUNG;
  if ((p.age || 26) <= 20) e += ERWARTUNG_JUGENDBONUS;
  if ((p.age || 26) >= 32) e += ERWARTUNG_ALTSTAR;
  e *= 0.75 + 0.25 * (ambition || 1) * 1.0;
  return clamp(e, 0.05, 0.95);
}

/** Anteil der Landsleute im Kader (ohne den Spieler selbst). */
function landsleute(spieler, p) {
  let n = 0;
  for (const q of spieler) if (q !== p && q.nationality === p.nationality) n++;
  return n;
}

/** Offene Konflikte, an denen der Spieler beteiligt ist. */
function konflikteVon(club, playerId) {
  const k = kabine(club);
  return k.konflikte.filter(c => c.status === 'offen' && c.playerIds.includes(playerId));
}

/**
 * Nachhall eines Machtworts in der Hackordnung (Ära-Konflikte, siehe unten).
 * Wer vor versammelter Mannschaft zurückgepfiffen wird, hat am Tag darauf am
 * wenigsten zu sagen; nach ANSEHEN_DAUER_TAGE ist es vergessen, dazwischen
 * verblasst es gleichmäßig. `heute` ist der absolute Tag (Tag + Saison × 365),
 * genau wie in hierarchie().
 */
function ansehenNachhall(k, playerId, heute) {
  const e = k.ansehen && k.ansehen[playerId];
  if (!e) return 0;
  const alter = heute - (e.tag || 0);
  if (alter < 0 || alter >= ANSEHEN_DAUER_TAGE) return 0;
  return e.wert * (1 - alter / ANSEHEN_DAUER_TAGE);
}

/** Setzt einen Nachhall — was noch offen ist, wird verrechnet, nicht überschrieben. */
function ansehenSetzen(k, playerId, wert, heute) {
  if (!k.ansehen) k.ansehen = {};
  const rest = ansehenNachhall(k, playerId, heute);
  k.ansehen[playerId] = { wert: round(clamp(rest + wert, ANSEHEN_MIN, ANSEHEN_MAX), 1), tag: heute };
  /* Zurück kommt, was WIRKLICH in den Büchern steht. Ohne das rechnete der
   * Ausgangstext von konfliktLoesen() die Absicht vor (−28 × 1,55 = 43 Punkte)
   * und das Spiel buchte die Grenze (ANSEHEN_MIN = −40). Wer eine Zahl nennt,
   * nennt die gebuchte. */
  return k.ansehen[playerId].wert - rest;
}

/* ==========================================================================
 * 3. Zielmoral & Gründe — das Herz der Moralrechnung
 * ======================================================================== */

/**
 * Berechnet Zielmoral, Zufriedenheits-Dimensionen und die deutschen
 * Begründungen für einen Spieler. Reine Rechnung, keine Mutation.
 */
function faktoren(state, club, p, kontext) {
  const k = kontext || clubKontext(state, club);
  const h = hp(p);
  const pers = persona(p);
  const gruende = [];
  const saison = state.date ? state.date.season : 1;

  /* --- Dimension 1: Spielzeit -------------------------------------------- */
  const rang = k.rang[p.id] !== undefined ? k.rang[p.id] : 20;
  const anteil = spielzeitAnteil(p, k.maxMinuten);
  const erwartet = spielzeitErwartung(p, rang, pers.ambition);
  const diff = anteil - erwartet;
  const dimSpielzeit = clamp(60 + diff * 120, 0, 100);
  if (diff < -0.30) gruende.push(`Sitzt viel zu oft draußen — ${name(p)} sieht sich als ${rang <= 10 ? 'Stammkraft' : 'mehr als Zaungast'}.`);
  else if (diff < -0.12) gruende.push('Hätte gern mehr Einsatzminuten.');
  else if (diff > 0.20) gruende.push('Spielt praktisch immer — genau so hatte er sich das vorgestellt.');

  /* --- Dimension 2: Gehalt im Kadervergleich ------------------------------ */
  const gehaltPct = k.gehaltPct[p.id] !== undefined ? k.gehaltPct[p.id] : 0.5;
  const leistungPct = k.leistungPct[p.id] !== undefined ? k.leistungPct[p.id] : 0.5;
  let gehaltDiff = gehaltPct - leistungPct;
  if (gehaltDiff < 0) gehaltDiff *= (pers.id === 'geldgierig' ? 2.0 : pers.id === 'loyal' ? 0.55 : 1.0);
  const dimGehalt = clamp(60 + gehaltDiff * 85, 0, 100);
  if (gehaltDiff < -0.28) gruende.push(`Findet sein Gehalt unangemessen — im Kader verdienen Schwächere deutlich mehr.`);
  else if (gehaltDiff > 0.30) gruende.push('Verdient blendend und weiß das auch.');

  /* --- Dimension 3: Ambition (Verein & Erfolg) ---------------------------- */
  const repDiff = ((club.reputation || 50) - k.spielerRuf[p.id]) / 30;
  const dimAmbition = clamp(60 + repDiff * 22 + k.serie * 14 + k.ziel * 10, 0, 100);
  if (repDiff < -0.5) gruende.push('Hält sich für zu gut für diesen Verein.');
  if (k.serie < -0.4) gruende.push('Die Ergebnisse der letzten Wochen drücken auf die Stimmung.');
  else if (k.serie > 0.5) gruende.push('Der Lauf der Mannschaft trägt ihn.');

  /* --- Dimension 4: Behandlung durch den Trainer -------------------------- */
  const dimTrainer = clamp(h.trainer !== undefined ? h.trainer : 60, 0, 100);
  if (dimTrainer < 40) gruende.push('Fühlt sich vom Trainer stiefmütterlich behandelt.');
  else if (dimTrainer > 78) gruende.push('Der Trainer hat ihn auf seiner Seite.');

  /* --- Grundwert aus den vier Dimensionen --------------------------------- */
  let ziel = MORAL_NEUTRAL + DIM_GAIN * (
    W_SPIELZEIT * (dimSpielzeit - 60) +
    W_GEHALT * (dimGehalt - 60) +
    W_AMBITION * (dimAmbition - 60) +
    W_TRAINER * (dimTrainer - 60)
  );

  /* --- Teamerfolg (wirkt zusätzlich auf alle gleich) ---------------------- */
  ziel += k.serie * W_SERIE + k.ziel * W_TABELLE;

  /* --- Vertragssituation --------------------------------------------------- */
  const rest = (p.contract ? p.contract.until : saison + 2) - saison;
  const treue = pers.loyalty || 1;
  if (rest <= 0) { ziel += MOD_VERTRAG_AUSLAUFEND / treue; gruende.push('Sein Vertrag läuft aus — die Zukunft ist ungeklärt.'); }
  else if (rest === 1) { ziel += MOD_VERTRAG_LETZTES_JAHR / treue; gruende.push('Letztes Vertragsjahr. Der Berater telefoniert bereits.'); }
  else if (rest >= 3) ziel += MOD_VERTRAG_LANG;

  /* --- Transfergerüchte ----------------------------------------------------- */
  const tr = p.transfer || {};
  if (tr.listed) { ziel += MOD_TRANSFERLISTE; gruende.push('Steht auf der Transferliste und weiß es.'); }
  if (tr.wunschWechsel) { ziel += MOD_WECHSELWUNSCH; gruende.push('Will den Verein verlassen.'); }
  const angebote = Array.isArray(tr.angebote) ? tr.angebote.length : 0;
  if (angebote > 0) {
    const schmeichel = clamp(angebote * MOD_ANGEBOT_JE * (pers.ambition || 1), 0, MOD_ANGEBOT_MAX);
    ziel += tr.wunschWechsel ? -schmeichel : schmeichel;
    gruende.push(`Es gibt ${angebote === 1 ? 'ein Angebot' : angebote + ' Angebote'} für ihn — die Zeitungen schreiben täglich darüber.`);
  }

  /* --- Verletzung ----------------------------------------------------------- */
  if (p.injury) {
    const sev = p.injury.severity || p.injury.schwere || 2;
    ziel += MOD_VERLETZT_BASIS + sev * MOD_VERLETZT_JE_SCHWERE;
    gruende.push(`Verletzt (${p.injury.name || p.injury.typ || 'Blessur'}) — Reha statt Rasen.`);
  }

  /* --- Konflikte ------------------------------------------------------------ */
  const meine = konflikteVon(club, p.id);
  if (meine.length) {
    let mod = 0;
    for (const c of meine) mod += MOD_KONFLIKT_JE_SCHWERE * (c.schwere || 1);
    ziel += Math.max(MOD_KONFLIKT_MAX, -mod);
    gruende.push(meine.length === 1
      ? `Steckt mitten in einem Kabinenstreit: ${meine[0].titel}.`
      : `Ist an ${meine.length} Kabinenstreitigkeiten beteiligt — das zehrt.`);
  }

  /* --- Heimweh -------------------------------------------------------------- */
  if (p.nationality && p.nationality !== 'DE') {
    const seitSaisons = saison - ((p.joined && p.joined.season) || 1);
    const kumpel = landsleute(k.spieler, p);
    const roh = (2 - clamp(seitSaisons, 0, 2)) / 2;          // 1 im ersten Jahr, 0 ab dem dritten
    const trost = clamp(kumpel / 3, 0, 1);
    const heimweh = MOD_HEIMWEH_MAX * roh * (1 - trost * 0.8) / (pers.loyalty || 1);
    if (heimweh < -1.5) {
      ziel += heimweh;
      gruende.push(kumpel === 0
        ? `Kein einziger Landsmann im Kader — ${nation(p)} ist weit weg.`
        : `Braucht noch Zeit, um in Deutschland anzukommen.`);
    }
  }

  /* --- Freundschaften -------------------------------------------------------- */
  const bez = beziehungenCache(state, club);
  const meineB = bez.byPlayer[p.id];
  if (meineB) {
    const freunde = meineB.freunde.length;
    if (freunde) {
      ziel += clamp(freunde * MOD_FREUND_JE, 0, MOD_FREUND_MAX);
      if (freunde >= 3) gruende.push('Hat sich in der Kabine bestens eingelebt.');
    }
    if (meineB.rivalen.length >= 2) {
      ziel -= 3;
      gruende.push('Kommt mit mehreren Mitspielern schlicht nicht klar.');
    }
  }

  /* --- Kapitänsamt ----------------------------------------------------------- */
  if (p.captain) { ziel += MOD_KAPITAEN; gruende.push('Trägt die Binde — das macht ihn stolz.'); }

  /* --- Trainingsstreik -------------------------------------------------------- */
  if (kabine(club).streikTage > 0) ziel += MOD_STREIK;

  return {
    ziel: clamp(ziel, MORAL_MIN, MORAL_MAX),
    dims: { spielzeit: dimSpielzeit, gehalt: dimGehalt, ambition: dimAmbition, trainer: dimTrainer },
    gruende
  };
}

/** Einmal pro Verein und Tag berechneter Kontext — hält tickMoral() billig. */
function clubKontext(state, club) {
  const spieler = squadOf(state, club);
  const rang = kaderRaenge(spieler);
  let maxMinuten = 0;
  for (const p of spieler) {
    const m = p.stats && p.stats.season ? (p.stats.season.minuten || 0) : 0;
    if (m > maxMinuten) maxMinuten = m;
  }
  // Perzentile für Gehalt und Leistung
  const nachGehalt = sortBy(spieler, p => (p.contract ? p.contract.salary : 0));
  const nachLeistung = sortBy(spieler, p => playerOverall(p));
  const gehaltPct = {}, leistungPct = {}, spielerRuf = {};
  const n = Math.max(1, spieler.length - 1);
  nachGehalt.forEach((p, i) => { gehaltPct[p.id] = i / n; });
  nachLeistung.forEach((p, i) => { leistungPct[p.id] = i / n; });
  for (const p of spieler) {
    // Persönlicher "Marktruf" auf der 1..100-Skala der Vereinsreputation
    spielerRuf[p.id] = clamp(playerOverall(p) * 1.05 - 8, 5, 99);
  }
  return {
    spieler, rang, maxMinuten, gehaltPct, leistungPct, spielerRuf,
    serie: serieWert(club), ziel: zielWert(club)
  };
}

/* ==========================================================================
 * 4. tickMoral — der Tagesablauf
 * ======================================================================== */

/**
 * Tägliche Moralentwicklung für ALLE Vereine.
 * log()/news() nur für den Verein des Managers.
 */
export function tickMoral(state, ctx) {
  const c = ctx || {};
  const rng = c.rng || createRng(hashString('moral:' + (state.seed | 0) + ':' + (state.tick | 0)));
  const meinClub = state.managerClubId;
  const heute = c.day !== undefined ? c.day : (state.date ? state.date.day : 0);

  // Ein einziger Fixture-Scan pro Tag statt 36 einzelner Suchläufe.
  const ergebnisse = ergebnisseDesTages(state, heute);

  for (const clubId in state.clubs) {
    const club = state.clubs[clubId];
    if (!club || !club.playerIds) continue;
    const istMein = clubId === meinClub;
    tickClub(state, club, c, rng, ergebnisse[clubId] || null, istMein, heute);
  }
}

/** Ergebnisse des Tages (und des Vortags, falls die Spiele nachts verbucht wurden). */
function ergebnisseDesTages(state, tag) {
  const out = {};
  const fixtures = state.fixtures || [];
  for (const f of fixtures) {
    if (!f || !f.played) continue;
    if (f.dayIndex !== tag && f.dayIndex !== tag - 1) continue;
    if (f.season !== undefined && state.date && f.season !== state.date.season) continue;
    const tore = toreAus(f);
    if (!tore) continue;
    out[f.homeId] = { tag: f.dayIndex, eigene: tore[0], fremde: tore[1], heim: true, gegnerId: f.awayId, wettbewerb: f.competitionId };
    out[f.awayId] = { tag: f.dayIndex, eigene: tore[1], fremde: tore[0], heim: false, gegnerId: f.homeId, wettbewerb: f.competitionId };
  }
  return out;
}

function toreAus(f) {
  const r = f && f.result;
  if (!r) return null;
  if (Array.isArray(r) && r.length >= 2) return [r[0], r[1]];
  if (Array.isArray(r.score) && r.score.length >= 2) return [r.score[0], r.score[1]];
  if (typeof r.home === 'number' && typeof r.away === 'number') return [r.home, r.away];
  if (typeof r.heim === 'number' && typeof r.gast === 'number') return [r.heim, r.gast];
  return null;
}

function tickClub(state, club, ctx, rng, ergebnis, istMein, heute) {
  const k = kabine(club);
  const kontext = clubKontext(state, club);
  const spieler = kontext.spieler;
  if (!spieler.length) return;

  const startelf = new Set();
  if (club.tactics && club.tactics.lineup) {
    for (const slot in club.tactics.lineup) startelf.add(club.tactics.lineup[slot]);
  }

  /* --- 1. Ergebnis-Impuls (einmal je Spiel) ------------------------------- */
  let impuls = 0;
  if (ergebnis && ergebnis.tag !== k.letzterErgebnisTag) {
    k.letzterErgebnisTag = ergebnis.tag;
    const d = ergebnis.eigene - ergebnis.fremde;
    impuls = d > 0 ? IMPULS_SIEG : d < 0 ? IMPULS_NIEDERLAGE : IMPULS_REMIS;
    impuls += clamp(d * IMPULS_TORDIFF, -IMPULS_TORDIFF_MAX, IMPULS_TORDIFF_MAX);
    const gegner = state.clubs[ergebnis.gegnerId];
    if (gegner && Math.abs((gegner.reputation || 50) - (club.reputation || 50)) < 8) {
      impuls *= IMPULS_DERBY;   // Duelle auf Augenhöhe brennen länger nach
    }
  }

  /* --- 2. Jeder Spieler --------------------------------------------------- */
  let summe = 0;
  for (const p of spieler) {
    const h = hp(p);
    const pers = persona(p);
    const f = faktoren(state, club, p, kontext);

    h.spielzeit = round(f.dims.spielzeit, 1);
    h.gehalt = round(f.dims.gehalt, 1);
    h.ambition = round(f.dims.ambition, 1);
    h.zielMoral = round(f.ziel, 1);
    h.gruende = f.gruende;

    // Behandlung durch den Trainer driftet langsam zurück zum Normalmaß.
    const trainerRuhe = istMein
      ? 52 + (state.manager.reputation || 40) * 0.16 + (state.manager.skills ? state.manager.skills.motivation : 45) * 0.10
      : 60;
    h.trainer = round(h.trainer + (trainerRuhe - h.trainer) * 0.06, 1);

    let vor = p.morale !== undefined ? p.morale : MORAL_NEUTRAL;
    const swing = pers.moraleSwing || 1;

    // Annäherung an die Zielmoral
    let schritt = (f.ziel - vor) * MORAL_SCHRITT * swing;
    schritt = clamp(schritt, -MORAL_SCHRITT_MAX, MORAL_SCHRITT_MAX);
    if (Math.abs(f.ziel - vor) > 1 && Math.abs(schritt) < MORAL_TRAEGHEIT) {
      schritt = f.ziel > vor ? MORAL_TRAEGHEIT : -MORAL_TRAEGHEIT;
    }

    // Ergebnis-Impuls: wer gespielt hat, erlebt Sieg und Pleite intensiver.
    if (impuls) {
      const beteiligt = startelf.has(p.id) ? 1 : IMPULS_BANK;
      schritt += impuls * beteiligt * swing;
    }

    let neu = clamp(vor + schritt, MORAL_MIN, MORAL_MAX);
    h.trend = round(neu - vor, 2);
    p.morale = round(neu, 1);
    summe += p.morale;

    if (istMein) spielerEreignis(state, club, p, vor, p.morale, ctx, rng);
  }

  /* --- 2b. Cliquen: die Laune des Anführers steckt an ---------------------- *
   * Stimmung verbreitet sich nicht gleichmäßig über die Kabine, sondern über
   * die Gruppen. Wer neben einem gut gelaunten Wortführer sitzt, geht besser
   * gelaunt nach Hause — und umgekehrt. Bewusst klein gehalten (höchstens
   * 1,4 Punkte je Tag): Es soll die Moralrechnung färben, nicht ersetzen.     */
  const gruppen = cliquenGruppen(state, club.id);
  if (gruppen.length) {
    const stoss = {};
    for (const g of gruppen) {
      const fuehrer = g.fuehrerId ? state.players[g.fuehrerId] : null;
      if (!fuehrer) continue;
      const ziel = fuehrer.morale !== undefined ? fuehrer.morale : MORAL_NEUTRAL;
      const kraft = CLIQUE_ANSTECKUNG * (g.staerke / 100);
      for (const pid of g.playerIds) {
        if (pid === fuehrer.id) continue;
        const q = state.players[pid];
        if (!q) continue;
        const ist = q.morale !== undefined ? q.morale : MORAL_NEUTRAL;
        stoss[pid] = (stoss[pid] || 0) + clamp((ziel - ist) * kraft, -CLIQUE_ANSTECKUNG_MAX, CLIQUE_ANSTECKUNG_MAX);
      }
    }
    summe = 0;
    for (const p of spieler) {
      if (stoss[p.id]) {
        p.morale = clamp(round((p.morale !== undefined ? p.morale : MORAL_NEUTRAL) + stoss[p.id], 1), MORAL_MIN, MORAL_MAX);
      }
      summe += p.morale !== undefined ? p.morale : MORAL_NEUTRAL;
    }
  }

  /* --- 3. Vereinsmoral & Teamgeist ---------------------------------------- */
  club.moral = round(summe / spieler.length, 1);
  k.teamgeist = teamGeist(state, club.id).wert;

  /* --- 4. Konflikte: schwelen, eskalieren, entstehen ----------------------- */
  const saison = state.date ? state.date.season : 1;
  const imKader = new Set(spieler.map(p => p.id));

  // Verjährte Machtworte aus der Hackordnung räumen. Das Objekt ist bei 35 von
  // 36 Vereinen leer — die Schleife kostet dort nichts.
  if (k.ansehen) {
    const jetzt = heute + saison * 365;
    for (const id in k.ansehen) {
      const e = k.ansehen[id];
      if (!e || !imKader.has(id) || jetzt - (e.tag || 0) >= ANSEHEN_DAUER_TAGE) delete k.ansehen[id];
    }
  }

  for (const c of k.konflikte) {
    if (c.status !== 'offen') continue;
    // Wer weg ist, streitet nicht mehr: verkauft, ausgelaufen, zurückgetreten.
    // Ohne diese Zeile schwelt der Streit auf ewig weiter, drückt den Teamgeist
    // und blockiert über KONFLIKT_MAX_OFFEN sogar neue Konflikte.
    if (Array.isArray(c.playerIds) && !c.playerIds.every(id => imKader.has(id))) {
      c.status = 'geloest';
      if (Array.isArray(c.verlauf)) c.verlauf.push('Erledigt — einer der beiden ist nicht mehr im Verein.');
      continue;
    }
    const alter = (heute - c.tag) + (saison - c.saison) * 365;
    if (alter > KONFLIKT_SCHWELT_TAGE && c.schwere < 3) {
      c.schwere++;
      c.tag = heute; c.saison = saison;
      c.verlauf.push('Nichts passiert — der Streit hat sich verschärft.');
      if (istMein && ctx.log) {
        ctx.log(`Der Ärger um "${c.titel}" ist nicht kleiner geworden. Im Gegenteil: In der Kabine wird inzwischen offen gestichelt.`,
          'kabine', { subject: 'Der Streit eskaliert', from: 'Co-Trainer', wichtig: true });
      }
    } else if (alter > KONFLIKT_VERJAEHRUNG_TAGE && c.schwere >= 3) {
      /* Ein Streit auf der höchsten Stufe hatte bisher kein Ende. Er blieb offen,
       * bis einer der Beteiligten den Verein verließ — und sperrte in der
       * Zwischenzeit über KONFLIKT_MAX_OFFEN alles Weitere. Bei einem KI-Verein,
       * wo nie jemand antwortet, hieß das: vier Streitigkeiten in den ersten
       * Wochen und danach nie wieder eine. Jetzt schläft er ein. Billig ist das
       * nicht: Bis dahin standen gut zehn Wochen Schwere 3 in den Büchern. */
      c.status = 'geloest';
      c.verlauf.push('Niemand hat mehr davon geredet. Irgendwann war Gras darüber gewachsen.');
      if (istMein && ctx.log) {
        ctx.log(`Der Streit um "${c.titel}" ist eingeschlafen. Geklärt hat ihn niemand — die Beteiligten haben ` +
          `sich schlicht daran gewöhnt, dass der andere auch noch da ist. Das ist keine Lösung, das ist eine Narbe.`,
          'kabine', { subject: 'Ein Streit schläft ein', from: 'Co-Trainer' });
      }
      continue;
    }
  }

  const offen = k.konflikte.filter(c => c.status === 'offen').length;
  if (offen < KONFLIKT_MAX_OFFEN) {
    const basis = istMein ? KONFLIKT_CHANCE_SPIELER : KONFLIKT_CHANCE_KI;
    const stimmungsFaktor = clamp(1 + (60 - k.teamgeist) / 40, 0.25, 3.0);
    // Lagerbildung: Eine starke Clique ist Folklore. Zwei, die keinen einzigen
    // Spieler gemeinsam haben, sind zwei Lager — und die reiben sich.
    const lagerFaktor = clamp(1 + getrennteLager(gruppen) * CLIQUE_LAGER_JE, 1, CLIQUE_LAGER_MAX);
    const p = Math.min(KONFLIKT_CHANCE_MAX, basis * stimmungsFaktor * lagerFaktor);
    if (rng.chance(p)) konflikt(state, club.id, ctx);
  }

  /* --- 5. Trainingsstreik ------------------------------------------------- */
  if (k.streikTage > 0) {
    k.streikTage--;
    if (k.streikTage === 0 && istMein && ctx.log) {
      ctx.log('Die Mannschaft hat sich wieder eingekriegt. Heute wurde normal trainiert — mit hängenden Köpfen, aber immerhin.',
        'kabine', { subject: 'Streik beendet', from: 'Co-Trainer' });
    }
  } else if (istMein && k.teamgeist < SCHWELLE_STREIK + 8 && club.moral < SCHWELLE_STREIK + 5 && rng.chance(0.08)) {
    k.streikTage = rng.int(1, 3);
    if (ctx.log) {
      ctx.log(`Die Spieler haben das Training abgebrochen. Wortführer war ${name(rng.pick(spieler))}. ` +
        `Der Platzwart hat die Hütchen wieder eingesammelt, bevor jemand Fotos machen konnte.`,
        'kabine', { subject: 'Trainingsstreik!', from: 'Co-Trainer', wichtig: true });
    }
    if (ctx.news) ctx.news(`${club.shortName || club.name}: Mannschaft bricht das Training ab.`, 'skandal');
  }

  /* --- 6. Ansprache nötig? ------------------------------------------------- */
  if (istMein && k.teamgeist < SCHWELLE_ANSPRACHE_NOETIG && ctx.isWeekStart && ctx.log) {
    ctx.log(`Chef, wir müssen reden. Die Stimmung in der Kabine ist im Keller (Teamgeist ${Math.round(k.teamgeist)}). ` +
      `Eine Ansprache wäre jetzt keine schlechte Idee — oder wir warten, bis es die Zeitung schreibt.`,
      'kabine', { subject: 'Die Kabine kippt', from: 'Co-Trainer', wichtig: true });
  }
}

/** Ereignisse aus dem Moralverlauf eines einzelnen Spielers (nur Manager-Verein). */
function spielerEreignis(state, club, p, vor, nach, ctx, rng) {
  const h = hp(p);
  const pers = persona(p);
  if (!ctx || !ctx.log) return;

  // Beschwerde: einmal je Anlass, nicht jeden Tag aufs Neue.
  if (nach < SCHWELLE_BESCHWERDE && vor >= SCHWELLE_BESCHWERDE) {
    const anlass = h.gruende && h.gruende.length ? h.gruende[0] : 'Er ist unzufrieden, sagt aber nicht womit.';
    h.beschwerden.push({ tag: state.date.day, saison: state.date.season, text: anlass });
    if (h.beschwerden.length > 8) h.beschwerden.shift();
    ctx.log(`${vollName(p)} hat um ein Gespräch gebeten. Sein Anliegen: ${anlass}\n\n` +
      `(${pers.name}. Wer ihn ignoriert, muss sich über den Rest nicht wundern.)`,
      'kabine', { subject: `Beschwerde von ${name(p)}`, from: 'Mannschaftsbetreuer', wichtig: true });
  }

  // Wechselwunsch
  if (nach < SCHWELLE_WECHSELWUNSCH && !(p.transfer && p.transfer.wunschWechsel)) {
    if (rng.chance(0.35 * (pers.moraleSwing || 1) / (pers.loyalty || 1))) {
      if (!p.transfer) p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
      p.transfer.wunschWechsel = true;
      ctx.log(`${vollName(p)} hat offiziell um seine Freigabe gebeten. Sein Berater hat bereits ` +
        `"Gespräche mit mehreren Vereinen" bestätigt — was in der Branche heißt: Er hat einmal telefoniert.\n\n` +
        `Sie können ihn umstimmen (Gespräch), verkaufen oder aussitzen.`,
        'kabine', { subject: `${name(p)} will weg`, from: 'Sportlicher Leiter', wichtig: true });
      if (ctx.news) ctx.news(`${vollName(p)} drängt auf einen Wechsel.`, 'transfer');
    }
  }

  // Lob / Hochstimmung
  if (nach > SCHWELLE_LOB && vor <= SCHWELLE_LOB) {
    ctx.log(`${vollName(p)} ist derzeit nicht zu bremsen. Er kommt als Erster, geht als Letzter und ` +
      `zieht die halbe Mannschaft mit. Solche Phasen sollte man nutzen.`,
      'kabine', { subject: `${name(p)} brennt`, from: 'Co-Trainer' });
  }
}

/* ==========================================================================
 * 5. Abfragen
 * ======================================================================== */

/** Moralwert eines Spielers samt Trend und deutschen Begründungen. */
export function moralWert(state, playerId) {
  const p = state.players[playerId];
  if (!p) return { wert: MORAL_NEUTRAL, trend: 0, gruende: ['Spieler unbekannt.'] };
  const club = p.clubId ? state.clubs[p.clubId] : null;
  const h = hp(p);
  if (!club) {
    return { wert: round(p.morale !== undefined ? p.morale : MORAL_NEUTRAL, 1), trend: h.trend || 0,
      gruende: ['Vereinslos — er wartet auf ein Angebot und wird von Tag zu Tag nervöser.'] };
  }
  const f = faktoren(state, club, p, clubKontext(state, club));
  const gruende = f.gruende.slice();
  if (!gruende.length) gruende.push('Alles im Lot. Er macht seine Arbeit und hält den Mund.');
  return {
    wert: round(p.morale !== undefined ? p.morale : MORAL_NEUTRAL, 1),
    trend: round(h.trend || 0, 2),
    zielMoral: round(f.ziel, 1),
    dims: f.dims,
    gruende,
    text: moralText(p.morale !== undefined ? p.morale : MORAL_NEUTRAL)
  };
}

/** Deutsche Kurzbeschreibung einer Moralhöhe. */
export function moralText(w) {
  if (w >= 88) return 'Brennt lichterloh';
  if (w >= 76) return 'Bestens gelaunt';
  if (w >= 64) return 'Zufrieden';
  if (w >= 52) return 'Geht so';
  if (w >= 40) return 'Angefressen';
  if (w >= 28) return 'Unzufrieden';
  if (w >= 16) return 'Aufsässig';
  return 'Innerlich gekündigt';
}

/**
 * Teamgeist eines Vereins.
 * -> { wert 0..100, cliquen:[{art, label, playerIds, staerke}], text, moralSchnitt }
 */
export function teamGeist(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { wert: 50, cliquen: [], text: 'Verein unbekannt.', moralSchnitt: 50 };
  const spieler = squadOf(state, club);
  if (!spieler.length) return { wert: 50, cliquen: [], text: 'Kein Kader vorhanden.', moralSchnitt: 50 };

  const moralSchnitt = avg(spieler, p => (p.morale !== undefined ? p.morale : MORAL_NEUTRAL));

  // Hierarchie: klare Rangordnung mit einem echten Kapitän ist Gold wert.
  const hier = hierarchie(state, clubId);
  const hatKapitaen = hier.some(e => e.rang === 'kapitaen');
  const fuehrung = hier.filter(e => e.rang === 'kapitaen' || e.rang === 'fuehrungsspieler').length;
  const aussenseiter = hier.filter(e => e.rang === 'aussenseiter').length;
  const hierWert = clamp(
    45 + (hatKapitaen ? 22 : -14) + clamp(fuehrung, 0, 5) * 7 - aussenseiter * 4, 0, 100);

  // Konflikte
  const k = kabine(club);
  const offen = k.konflikte.filter(c => c.status === 'offen');
  let konfliktLast = 0;
  for (const c of offen) konfliktLast += (c.schwere || 1) * KONFLIKT_TEAMGEIST_JE;
  const konfliktWert = clamp(100 - konfliktLast, 0, 100);

  // Cliquen
  const cliquen = cliquenVon(state, spieler, clubId);
  let cliqueLast = 0;
  for (const c of cliquen) cliqueLast += c.staerke * (c.art === 'nation' ? 9 : c.art === 'aera' ? 7 : 5);
  const cliqueWert = clamp(100 - cliqueLast, 0, 100);

  const wert = clamp(
    TG_MORAL * moralSchnitt + TG_HIERARCHIE * hierWert + TG_KONFLIKT * konfliktWert + TG_CLIQUEN * cliqueWert,
    0, 100);

  const text = teamGeistText(wert, offen.length, cliquen, hatKapitaen);
  return { wert: round(wert, 1), cliquen, text, moralSchnitt: round(moralSchnitt, 1), offeneKonflikte: offen.length };
}

function teamGeistText(w, konflikte, cliquen, hatKapitaen) {
  const zeilen = [];
  if (w >= 85) zeilen.push('Diese Mannschaft würde füreinander durch die Wand gehen.');
  else if (w >= 72) zeilen.push('Die Kabine funktioniert. Man lacht zusammen, man ärgert sich zusammen.');
  else if (w >= 58) zeilen.push('Ein normaler Profibetrieb: höflich, professionell, nicht mehr.');
  else if (w >= 44) zeilen.push('Es knirscht. Nach dem Training geht jeder schnell nach Hause.');
  else if (w >= 30) zeilen.push('In der Kabine ist es unangenehm still, wenn der Trainer reinkommt.');
  else zeilen.push('Diese Kabine ist ein Pulverfass. Ein falsches Wort und es fliegt Ihnen um die Ohren.');
  if (konflikte === 1) zeilen.push('Ein Streit ist offen und wartet auf eine Entscheidung.');
  else if (konflikte > 1) zeilen.push(`${konflikte} ungelöste Konflikte schwelen vor sich hin.`);
  if (!hatKapitaen) zeilen.push('Es gibt keinen anerkannten Kapitän — niemand räumt auf, wenn es eng wird.');
  const stark = cliquen.filter(c => c.staerke > 0.6);
  if (stark.length) zeilen.push(`Deutliche Grüppchenbildung: ${stark.map(c => c.label).join(', ')}.`);
  return zeilen.join(' ');
}

/* --------------------------------------------------------------------------
 * Cliquen — die Gruppenebene über den Beziehungen
 *
 * Bis Stufe 3 waren Cliquen reine Abzählungen ("sechs Franzosen im Kader").
 * Seit Stufe 4 sind sie VERDICHTETE BEZIEHUNGEN: Kandidat wird eine Gruppe über
 * ein gemeinsames Merkmal, aufgenommen wird nur, wer innerhalb der Gruppe
 * mindestens eine Freundschaft aus `beziehungenCache()` hat. Dadurch stehen in
 * einer Clique nur Spieler, die sich tatsächlich mögen — und ein
 * Nationalitätenblock ohne innere Bindung entsteht gar nicht erst.
 *
 * Der Cache liegt bewusst NICHT im Spielstand: Cliquen sind vollständig aus
 * Kader, Moral und Beziehungen ableitbar. Eine WeakMap über den State kostet
 * kein Byte im Savegame und kann sich zwischen zwei Spielständen nicht
 * verwechseln (der Prüfstand hält mehrere gleichzeitig offen).
 * ------------------------------------------------------------------------ */

export const CLIQUEN_ARTEN = {
  nation: { name: 'Landsleute', desc: 'Gleiche Sprache, gleicher Tisch, gleiche Musik im Bus.' },
  aera: { name: 'Ära', desc: 'Legenden unter sich — oder die Jungen unter sich.' },
  alter: { name: 'Jahrgang', desc: 'Wer gleich alt ist, geht abends gemeinsam nichts trinken.' },
  vergangenheit: { name: 'Gemeinsame Jahre', desc: 'Zusammen gekommen, zusammen geblieben.' }
};

const ALTERSGRUPPEN = [
  { id: 'kueken', von: 16, bis: 21, label: 'Das Küken-Tischchen' },
  { id: 'jung', von: 22, bis: 26, label: 'Die Mittzwanziger' },
  { id: 'reif', von: 27, bis: 31, label: 'Die besten Jahre' },
  { id: 'alt', von: 32, bis: 45, label: 'Die Altherrenrunde' }
];

const cliquenCache = new WeakMap();      // state -> Map(clubId -> { tag, liste })

/**
 * Cliquen eines Vereins.
 * -> [{ id, art:'nation'|'aera'|'alter'|'vergangenheit', playerIds, label,
 *       staerke: 0..100, stimmung: 0..100, fuehrerId, text }]
 *
 * Größe 2..8, kein Spieler in mehr als drei Cliquen, absteigend nach Stärke,
 * vollständig deterministisch (kein Rng).
 */
export function cliquenGruppen(state, clubId) {
  const club = state && state.clubs ? state.clubs[clubId] : null;
  if (!club || !Array.isArray(club.playerIds)) return [];

  const heute = state.date ? state.date.day + state.date.season * 365 : 0;
  let proState = cliquenCache.get(state);
  if (!proState) { proState = new Map(); cliquenCache.set(state, proState); }
  const treffer = proState.get(clubId);
  if (treffer && treffer.tag === heute) return treffer.liste;

  const liste = cliquenBerechnen(state, club);
  proState.set(clubId, { tag: heute, liste });
  return liste;
}

function cliquenBerechnen(state, club) {
  const spieler = squadOf(state, club);
  const n = spieler.length;
  if (n < 4) return [];

  const bez = beziehungenCache(state, club);
  const freundeVon = id => ((bez.byPlayer && bez.byPlayer[id]) || {}).freunde || [];
  const gesamtMoral = avg(spieler, p => (p.morale !== undefined ? p.morale : MORAL_NEUTRAL));

  /* --- 1. Kandidatengruppen aus gemeinsamen Merkmalen -------------------- */
  const kandidaten = [];
  const nachSchluessel = (fn) => {
    const map = new Map();
    for (const p of spieler) {
      const k = fn(p);
      if (k === null || k === undefined) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    }
    return map;
  };

  for (const [nat, g] of nachSchluessel(p => p.nationality || null)) {
    kandidaten.push({ art: 'nation', schluessel: nat, mitglieder: g, label: `${NATION_NAMES[nat] || nat}-Fraktion` });
  }

  const legenden = spieler.filter(p => p.era === 'legend');
  const moderne = spieler.filter(p => p.era !== 'legend');
  if (legenden.length >= CLIQUE_MIN && moderne.length >= CLIQUE_MIN) {
    kandidaten.push({ art: 'aera', schluessel: 'legend', mitglieder: legenden, label: 'Die alte Garde' });
    kandidaten.push({ art: 'aera', schluessel: 'modern', mitglieder: moderne, label: 'Die Jungen' });
  }

  for (const gruppe of ALTERSGRUPPEN) {
    const g = spieler.filter(p => { const a = p.age || 26; return a >= gruppe.von && a <= gruppe.bis; });
    if (g.length >= CLIQUE_MIN) kandidaten.push({ art: 'alter', schluessel: gruppe.id, mitglieder: g, label: gruppe.label });
  }

  const saisonJetzt = state.date ? state.date.season : 1;
  for (const [s, g] of nachSchluessel(p => (p.joined && p.joined.season) || null)) {
    if (s >= saisonJetzt) continue;                 // wer diese Saison kam, hat noch keine gemeinsame Vergangenheit
    kandidaten.push({ art: 'vergangenheit', schluessel: String(s), mitglieder: g, label: `Der Jahrgang ${s}` });
  }

  /* --- 2. Verdichten: nur wer drinnen einen Freund hat, gehört dazu ------ */
  const roh = [];
  for (const k of kandidaten) {
    if (k.mitglieder.length < CLIQUE_MIN) continue;
    if (k.mitglieder.length > n * CLIQUE_ANTEIL_MAX) continue;

    const drin = new Set(k.mitglieder.map(p => p.id));
    let kern = k.mitglieder.filter(p => freundeVon(p.id).some(f => drin.has(f)));
    if (kern.length < CLIQUE_MIN) continue;

    // Zu große Kerne auf die am besten vernetzten Köpfe eindampfen.
    const kernIds = new Set(kern.map(p => p.id));
    const grad = p => freundeVon(p.id).filter(f => kernIds.has(f)).length;
    if (kern.length > CLIQUE_MAX) {
      kern = sortBy(kern, p => ({ key: grad(p) * 1000 + (p.morale || 0), desc: true })).slice(0, CLIQUE_MAX);
    }
    // Altersgruppen dürfen nach dem Eindampfen keine Spanne über sechs Jahren haben.
    if (k.art === 'alter' && kern.length >= CLIQUE_MIN) {
      const alter = kern.map(p => p.age || 26);
      if (Math.max(...alter) - Math.min(...alter) > 6) {
        kern = sortBy(kern, p => (p.age || 26)).slice(0, CLIQUE_MAX);
      }
    }

    const ids = kern.map(p => p.id).sort();
    const idSet = new Set(ids);
    let kanten = 0;
    for (const p of kern) kanten += freundeVon(p.id).filter(f => idSet.has(f)).length;
    kanten /= 2;
    const moeglich = Math.max(1, (ids.length * (ids.length - 1)) / 2);
    const dichte = clamp(kanten / moeglich, 0, 1);

    const stimmung = avg(kern, p => (p.morale !== undefined ? p.morale : MORAL_NEUTRAL));
    const rest = spieler.filter(p => !idSet.has(p.id));
    const restMoral = rest.length ? avg(rest, p => (p.morale !== undefined ? p.morale : MORAL_NEUTRAL)) : gesamtMoral;
    const spaltung = clamp(Math.abs(stimmung - restMoral) / CLIQUE_SPALTUNG_SKALA, 0, 1);

    const staerke = clamp(round(100 * (
      CLIQUE_DICHTE * dichte +
      CLIQUE_GROESSE * clamp(ids.length / (n * 0.35), 0, 1) +
      CLIQUE_SPALTUNG * spaltung), 1), 0, 100);
    if (staerke < CLIQUE_MINDESTSTAERKE) continue;

    roh.push({
      id: `${k.art}:${k.schluessel}`,
      art: k.art, label: `${k.label} (${ids.length})`,
      playerIds: ids, staerke,
      stimmung: round(stimmung, 1),
      dichte: round(dichte, 2)
    });
  }

  /* --- 3. Höchstens drei Cliquen je Spieler ------------------------------ */
  const sortiert = sortBy(roh, c => ({ key: c.staerke * 1000 + hashString(c.id) % 997, desc: true }));
  const zaehler = {};
  const out = [];
  for (const c of sortiert) {
    const behalten = c.playerIds.filter(id => (zaehler[id] || 0) < CLIQUE_MAX_JE_SPIELER);
    if (behalten.length < CLIQUE_MIN) continue;
    for (const id of behalten) zaehler[id] = (zaehler[id] || 0) + 1;
    c.playerIds = behalten;
    c.label = c.label.replace(/\(\d+\)$/, `(${behalten.length})`);
    c.fuehrerId = cliquenFuehrer(state, club, behalten);
    c.text = cliqueText(state, c);
    out.push(c);
  }
  return out;
}

/** Wie viele Paare starker Cliquen stehen sich ohne gemeinsamen Kopf gegenüber? */
function getrennteLager(gruppen) {
  const stark = gruppen.filter(g => g.staerke >= CLIQUE_LAGER_SCHWELLE);
  let paare = 0;
  for (let i = 0; i < stark.length; i++) {
    const a = new Set(stark[i].playerIds);
    for (let j = i + 1; j < stark.length; j++) {
      if (!stark[j].playerIds.some(id => a.has(id))) paare++;
    }
  }
  return paare;
}

/** Wer in einer Clique das Sagen hat — die Hackordnung entscheidet, nicht die Moral. */
function cliquenFuehrer(state, club, ids) {
  let besterId = ids[0], bester = -1;
  const rang = hierarchie(state, club.id);
  const einfluss = {};
  for (const r of rang) einfluss[r.playerId] = r.einfluss;
  for (const id of ids) {
    const e = einfluss[id] !== undefined ? einfluss[id] : 0;
    if (e > bester) { bester = e; besterId = id; }
  }
  return besterId;
}

function cliqueText(state, c) {
  const koepfe = c.playerIds.slice(0, 3).map(id => name(state.players[id])).join(', ');
  const laune = c.stimmung >= 74 ? 'bester Laune' : c.stimmung >= 55 ? 'guter Dinge' : c.stimmung >= 40 ? 'mäßig gelaunt' : 'schwer angefressen';
  if (c.art === 'nation') {
    return `${koepfe} sitzen im Bus zusammen, essen zusammen und lachen über Dinge, die sonst niemand versteht. ` +
      `Die Gruppe ist ${laune}.`;
  }
  if (c.art === 'aera') {
    return c.id.endsWith('legend')
      ? `${koepfe} haben zusammen einen eigenen Tisch, an dem über Fußball von früher geredet wird — laut und ${laune}.`
      : `${koepfe} machen ihr eigenes Ding: Kopfhörer auf, Handy raus, ${laune}.`;
  }
  if (c.art === 'alter') {
    return `${koepfe} sind gleich alt und dementsprechend unzertrennlich. Zurzeit ${laune}.`;
  }
  return `${koepfe} sind gemeinsam gekommen und gemeinsam geblieben. Solche Grüppchen halten am längsten — zurzeit ${laune}.`;
}

/**
 * Alte Aufrufform für Teamgeist und Konfliktlogik: dieselben Gruppen, aber mit
 * `staerke` als 0..1. Es gibt bewusst nur EINE Cliquen-Erkennung.
 */
function cliquenVon(state, spieler, clubId) {
  const id = clubId || (spieler && spieler.length ? spieler[0].clubId : null);
  if (!id) return [];
  return cliquenGruppen(state, id).map(c => ({
    art: c.art, label: c.label, playerIds: c.playerIds,
    staerke: round(c.staerke / 100, 2), stimmung: c.stimmung, fuehrerId: c.fuehrerId, text: c.text
  }));
}

/**
 * Hackordnung der Kabine.
 * -> [{ playerId, name, rang, einfluss, gruende:[] }] — absteigend nach Einfluss.
 * rang: 'kapitaen' | 'fuehrungsspieler' | 'mitlaeufer' | 'aussenseiter'
 */
export function hierarchie(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return [];
  const k = kabine(club);
  const heute = state.date ? state.date.day + state.date.season * 365 : 0;
  if (k.hierarchie && k.hierarchieTag === heute) return k.hierarchie;

  const spieler = squadOf(state, club);
  if (!spieler.length) return [];
  const kontext = clubKontext(state, club);
  const saison = state.date ? state.date.season : 1;
  const kapitaenId = (club.tactics && club.tactics.setPieces && club.tactics.setPieces.kapitaen) || null;

  const liste = spieler.map(p => {
    const a = p.attributes || {};
    const gruende = [];
    let e = 0;

    const alter = clamp(((p.age || 26) - 18) / 16, 0, 1);
    e += alter * 18;
    if ((p.age || 26) >= 31) gruende.push('Erfahrung');

    const jahre = clamp(saison - ((p.joined && p.joined.season) || 1), 0, 8);
    e += (jahre / 8) * 16;
    if (jahre >= 4) gruende.push('Langjähriger Vereinsspieler');

    const lp = kontext.leistungPct[p.id] !== undefined ? kontext.leistungPct[p.id] : 0.5;
    e += lp * 22;
    if (lp > 0.85) gruende.push('Sportliche Autorität');

    e += clamp(((a.fuehrung || 45) - 45) / 55, -0.5, 1) * 14;

    const traits = p.traits || [];
    if (traits.includes('leader')) { e += 14; gruende.push(TRAITS.leader.name); }
    if (traits.includes('kabinenleader')) { e += 12; gruende.push(TRAITS.kabinenleader.name); }
    if (traits.includes('weltfussballer')) { e += 8; gruende.push('Weltstar'); }
    if (traits.includes('fanliebling')) { e += 5; gruende.push('Liebling der Kurve'); }
    if (traits.includes('querulant')) { e -= 6; gruende.push('Unruhestifter'); }
    if (traits.includes('mimose')) { e -= 5; }

    const kumpel = landsleute(spieler, p);
    e += clamp(kumpel / 4, 0, 1) * 8;
    if (kumpel >= 4) gruende.push(`${nation(p)}-Block im Rücken`);

    const ruf = kontext.spielerRuf[p.id] || 50;
    e += clamp((ruf - 55) / 45, 0, 1) * 10;

    const anteil = spielzeitAnteil(p, kontext.maxMinuten);
    e += anteil * 10;

    if (p.era === 'legend') { e += 6; gruende.push('Legendenstatus'); }
    if (p.id === kapitaenId || p.captain) { e += 12; gruende.push('Trägt die Binde'); }

    // Ein Machtwort des Trainers im Ära-Streit wirkt monatelang nach — nach oben
    // wie nach unten. Das ist der Preis (bzw. der Ertrag) von „Die Zeiten haben
    // sich geändert" und „Der Alte hat recht".
    const nachhall = ansehenNachhall(k, p.id, heute);
    if (nachhall <= -1) { e += nachhall; gruende.push('Vor der Mannschaft zurückgepfiffen'); }
    else if (nachhall >= 1) { e += nachhall; gruende.push('Vom Trainer öffentlich bestätigt'); }

    // Wer Talente unter die Fittiche nimmt, gewinnt in der Kabine Gewicht
    // (club/chemie.js pflegt p.mentees — gelesen wird es hier, ohne Import,
    // damit die beiden Module nicht im Kreis voneinander abhängen).
    const zoeglinge = Array.isArray(p.mentees)
      ? p.mentees.filter(id => { const q = state.players[id]; return q && q.clubId === clubId && q.mentor && q.mentor.mentorId === p.id; }).length
      : 0;
    if (zoeglinge > 0) {
      e += MENTOR_EINFLUSS_JE * zoeglinge;
      gruende.push(zoeglinge === 1 ? 'Nimmt ein Talent unter die Fittiche' : `Zieht ${zoeglinge} Talente groß`);
    }

    return { playerId: p.id, name: name(p), einfluss: clamp(round(e, 1), 0, 100), gruende, _p: p };
  });

  const sortiert = sortBy(liste, x => ({ key: x.einfluss, desc: true }));
  const kapIdx = sortiert.findIndex(x => x.playerId === kapitaenId || x._p.captain);
  sortiert.forEach((x, i) => {
    if (i === kapIdx) x.rang = 'kapitaen';
    else if (x.einfluss < 30) x.rang = 'aussenseiter';
    else if (i < (kapIdx >= 0 ? 5 : 4)) x.rang = 'fuehrungsspieler';
    else x.rang = 'mitlaeufer';
    delete x._p;
  });

  k.hierarchie = sortiert;
  k.hierarchieTag = heute;
  return sortiert;
}

export const RANG_NAMEN = {
  kapitaen: 'Kapitän', fuehrungsspieler: 'Führungsspieler',
  mitlaeufer: 'Mitläufer', aussenseiter: 'Außenseiter'
};

/**
 * Beziehungsmatrix eines Kaders.
 * -> { paare:[{a,b,wert,art,text}], byPlayer:{ id:{freunde:[],rivalen:[]} } }
 * wert: -100 (verfeindet) … +100 (dicke Freunde). Deterministisch, ohne Rng.
 */
export function beziehungen(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { paare: [], byPlayer: {} };
  const k = kabine(club);
  k.beziehungenTag = -999;   // erzwingt Neuberechnung bei explizitem Aufruf
  return beziehungenCache(state, club);
}

function beziehungenCache(state, club) {
  const k = kabine(club);
  const heute = state.date ? state.date.day + state.date.season * 365 : 0;
  if (k.beziehungen && k.beziehungenTag === heute) return k.beziehungen;

  const spieler = squadOf(state, club);
  const paare = [];
  const byPlayer = {};
  for (const p of spieler) byPlayer[p.id] = { freunde: [], rivalen: [] };

  const offeneKonflikte = k.konflikte.filter(c => c.status === 'offen');

  for (let i = 0; i < spieler.length; i++) {
    for (let j = i + 1; j < spieler.length; j++) {
      const a = spieler[i], b = spieler[j];
      // Grundsympathie: stabil pro Paar, aber nicht vorhersehbar.
      let w = (hashString(paarKey(a.id, b.id)) % 1000) / 1000 * 60 - 30;

      if (a.nationality === b.nationality) w += 26;
      if (a.era === b.era) w += 8; else w -= 10;
      const dAlter = Math.abs((a.age || 26) - (b.age || 26));
      w -= clamp(dAlter - 4, 0, 14) * 1.6;
      if (a.position === b.position) w -= 16;                       // direkte Konkurrenz
      else if (POSITION_GROUP[a.position] === POSITION_GROUP[b.position]) w += 8;  // Mannschaftsteil
      const gA = a.contract ? a.contract.salary : 0;
      const gB = b.contract ? b.contract.salary : 0;
      const hoch = Math.max(gA, gB), tief = Math.min(gA, gB);
      if (hoch > 0 && tief > 0 && hoch / tief > 3.5) w -= 12;       // Gehaltsneid
      const tA = a.traits || [], tB = b.traits || [];
      if (tA.includes('kabinenleader') || tB.includes('kabinenleader')) w += 10;
      if (tA.includes('querulant') || tB.includes('querulant')) w -= 12;
      if ((a.joined && b.joined) && a.joined.season === b.joined.season) w += 6;

      for (const c of offeneKonflikte) {
        if (c.playerIds.includes(a.id) && c.playerIds.includes(b.id)) w -= 30 * (c.schwere || 1);
      }

      w = clamp(round(w, 0), -100, 100);
      let art = 'neutral';
      if (w >= 42) art = 'freundschaft';
      else if (w <= -35) art = 'konflikt';
      if (art !== 'neutral') {
        paare.push({ a: a.id, b: b.id, wert: w, art, text: beziehungText(a, b, w, art) });
        if (art === 'freundschaft') { byPlayer[a.id].freunde.push(b.id); byPlayer[b.id].freunde.push(a.id); }
        else { byPlayer[a.id].rivalen.push(b.id); byPlayer[b.id].rivalen.push(a.id); }
      }
    }
  }

  const res = { paare: sortBy(paare, x => ({ key: Math.abs(x.wert), desc: true })), byPlayer };
  k.beziehungen = res;
  k.beziehungenTag = heute;
  return res;
}

function beziehungText(a, b, w, art) {
  if (art === 'freundschaft') {
    if (a.nationality === b.nationality && a.nationality !== 'DE') {
      return `${name(a)} und ${name(b)} sitzen im Bus immer zusammen — zwei ${nation(a)}er unter sich.`;
    }
    if (w > 70) return `${name(a)} und ${name(b)} sind unzertrennlich. Wer den einen kritisiert, kriegt es mit dem anderen zu tun.`;
    return `${name(a)} und ${name(b)} verstehen sich blendend.`;
  }
  if (a.position === b.position) {
    return `${name(a)} und ${name(b)} kämpfen um dieselbe Position — und grüßen sich entsprechend herzlich.`;
  }
  return `Zwischen ${name(a)} und ${name(b)} herrscht Eiszeit.`;
}

/* ==========================================================================
 * 6. Konflikte
 * ======================================================================== */

/**
 * `aera: true` markiert die beiden Streitarten, in denen zwei Fußballzeitalter
 * aufeinandertreffen. Nur dort gibt es die Wege „Der Alte hat recht" und
 * „Die Zeiten haben sich geändert" — und nur dort stellt der Streit eine Frage,
 * die der Trainer beantworten muss (`frage`).
 */
export const KONFLIKT_ARTEN = {
  elfmeter: { name: 'Streit ums Elfmeterrecht', schwere: 1 },
  taktik: { name: 'Kritik an der Taktik', schwere: 2 },
  neid_gehalt: { name: 'Neid auf ein Gehalt', schwere: 2 },
  position: { name: 'Rivalität um eine Position', schwere: 1 },
  clique: { name: 'Cliquenbildung', schwere: 2 },
  kapitaensbinde: { name: 'Ärger um die Kapitänsbinde', schwere: 2 },
  legende_star: {
    name: 'Legende gegen jungen Star', schwere: 3, aera: true,
    frage: 'Wer hat in dieser Kabine recht — der Mann mit den Titeln oder der Mann mit der Zukunft?'
  },
  generation: {
    name: 'Generationskonflikt', schwere: 2, aera: true,
    frage: 'Trainiert dieser Verein wie früher oder wie heute?'
  },
  disziplin: { name: 'Disziplinloser Auftritt', schwere: 1 },
  presse: { name: 'Interview gegen die Mannschaft', schwere: 2 }
};

/**
 * Ist das ein Streit über die Ära-Grenze hinweg?
 *
 * Zwei Bedingungen, beide nötig: Die Art muss den Streit als Kulturkampf führen
 * (`KONFLIKT_ARTEN[…].aera`) UND es müssen tatsächlich beide Lager am Tisch
 * sitzen. Zwei Legenden, die um dieselbe Position streiten, sind kein
 * Generationenkonflikt, sondern zwei Legenden, die um dieselbe Position streiten.
 */
export function istAeraKonflikt(state, konflikt) {
  const c = konflikt;
  if (!c || !KONFLIKT_ARTEN[c.art] || !KONFLIKT_ARTEN[c.art].aera) return false;
  let legende = false, modern = false;
  for (const id of c.playerIds || []) {
    const p = state.players[id];
    if (!p) continue;
    if (p.era === 'legend') legende = true; else modern = true;
  }
  return legende && modern;
}

/**
 * Erzeugt einen Kabinenkonflikt. Wird von tickMoral() aufgerufen, kann aber
 * auch direkt getriggert werden (z. B. aus club/media.js heraus).
 * -> { ok, konflikt } | { ok:false, text }
 */
export function konflikt(state, clubId, ctx) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Verein unbekannt.' };
  const k = kabine(club);
  const spieler = squadOf(state, club);
  if (spieler.length < 4) return { ok: false, text: 'Zu wenig Kader für eine ordentliche Zickerei.' };
  const rng = (ctx && ctx.rng) ? ctx.rng.fork('konflikt:' + clubId + ':' + k.zaehler++) : localRng(state, club, 'konflikt');
  const istMein = clubId === state.managerClubId;

  const kandidaten = bauKonfliktKandidaten(state, club, spieler, rng);
  if (!kandidaten.length) return { ok: false, text: 'Heute ist ausnahmsweise Frieden.' };

  const gewaehlt = rng.pickWeighted(kandidaten, c => c.gewicht);
  const tag = state.date ? state.date.day : 0;
  const saison = state.date ? state.date.season : 1;

  const c = {
    id: `kf_${clubId}_${saison}_${tag}_${k.konfliktNr = (k.konfliktNr | 0) + 1}`,
    clubId,
    art: gewaehlt.art,
    titel: gewaehlt.titel,
    text: gewaehlt.text,
    playerIds: gewaehlt.playerIds,
    schwere: gewaehlt.schwere,
    tag, saison,
    status: 'offen',
    versuche: 0,
    verlauf: [gewaehlt.text]
  };
  k.konflikte.push(c);
  if (k.konflikte.length > 30) k.konflikte.shift();
  k.chronik.push({ tag, saison, text: gewaehlt.titel });
  if (k.chronik.length > 60) k.chronik.shift();
  k.beziehungenTag = -999;   // Beziehungen neu bewerten

  // Sofortiger Moralschaden bei den Beteiligten
  for (const id of c.playerIds) {
    const p = state.players[id];
    if (!p) continue;
    p.morale = clamp(round((p.morale || MORAL_NEUTRAL) - 3 * c.schwere * (persona(p).moraleSwing || 1), 1), MORAL_MIN, MORAL_MAX);
  }

  if (istMein && ctx && ctx.log) {
    const aera = istAeraKonflikt(state, c);
    /* Bei einem Ära-Streit steht der Preis beider Antworten schon in dieser
     * Nachricht — mit Namen und Stückzahlen, gebaut aus derselben Besetzung, die
     * konfliktLoesen() anschließend abrechnet. Wer abwägen soll, muss wissen,
     * wen es trifft, und zwar vorher. */
    const wege = aera ? loesungsWege(state, c).filter(w => w.nurAera) : [];
    ctx.log(`${gewaehlt.text}\n\n` + (aera
      ? `${KONFLIKT_ARTEN[c.art].frage} Diese Frage können Sie nicht moderieren, Sie müssen sie beantworten — ` +
        `und beide Antworten kosten etwa dasselbe, nur an verschiedenen Adressen:\n` +
        wege.map(w => `• „${w.name}": ${w.folge}`).join('\n') + '\n' +
        `Die üblichen Wege (Einzelgespräch, Mannschaftsrat, Aussprache, harte Hand) stehen auch offen. ` +
        `Sie klären dann allerdings nur den Ton, nicht die Frage.`
      : `Sie können den Streit per Einzelgespräch, Mannschaftsrat, Aussprache oder ` +
        `mit harter Hand klären. Aussitzen geht auch — dann eskaliert er, und irgendwann schläft er ein. ` +
        `Bis dahin kostet er Punkte.`),
      'kabine', { subject: gewaehlt.titel, from: 'Co-Trainer', wichtig: c.schwere >= 2 });
  }
  if (istMein && ctx && ctx.news && c.schwere >= 2) {
    ctx.news(`Unruhe bei ${club.shortName || club.name}: ${gewaehlt.titel}.`, 'kabine');
  }
  return { ok: true, text: gewaehlt.text, konflikt: c };
}

/**
 * Wählt eine Textvariante, ohne den Zufallsstrom anzufassen: Paar, Tag und
 * Saison bestimmen den Text. Zwei Streitereien desselben Paares am selben Tag
 * lesen sich gleich — das kommt nicht vor. Alles andere liest sich verschieden.
 */
function variante(liste, schluessel, state, saison) {
  const tag = state.date ? state.date.day : 0;
  return liste[Math.abs(hashString(`${schluessel}|${tag}|${saison}`)) % liste.length];
}

function bauKonfliktKandidaten(state, club, spieler, rng) {
  const out = [];
  const kontext = clubKontext(state, club);
  const hier = hierarchie(state, club.id);
  const saison = state.date ? state.date.season : 1;
  const top = sortBy(spieler, p => ({ key: playerOverall(p), desc: true }));

  const push = (art, titel, text, playerIds, gewicht, schwere) => {
    if (playerIds.filter(Boolean).length < 1) return;
    out.push({ art, titel, text, playerIds: playerIds.filter(Boolean), gewicht, schwere: schwere || KONFLIKT_ARTEN[art].schwere });
  };

  /* --- Elfmeterrecht ------------------------------------------------------ */
  const schuetze = club.tactics && club.tactics.setPieces ? state.players[club.tactics.setPieces.elfmeter] : null;
  const stuermer = top.filter(p => POSITION_GROUP[p.position] === 'STU');
  if (schuetze && stuermer.length && stuermer[0].id !== schuetze.id) {
    push('elfmeter', 'Zoff um den Elfmeterpunkt',
      `${vollName(stuermer[0])} hat sich im Training den Ball geschnappt und gesagt, er schieße die Dinger jetzt. ` +
      `${name(schuetze)}, laut Aufstellung der designierte Schütze, hat ihn wortlos wieder abgelegt. Die Stimmung: frostig.`,
      [stuermer[0].id, schuetze.id], 1.0);
  } else if (stuermer.length >= 2) {
    push('elfmeter', 'Zoff um den Elfmeterpunkt',
      `${vollName(stuermer[0])} und ${vollName(stuermer[1])} streiten darüber, wer die Elfmeter schießt. ` +
      `Beide führen Statistiken an. Beide haben unrecht.`,
      [stuermer[0].id, stuermer[1].id], 0.8);
  }

  /* --- Kritik an der Taktik ------------------------------------------------ */
  const kritiker = hier.filter(h => h.rang === 'fuehrungsspieler' || h.rang === 'kapitaen')
    .map(h => state.players[h.playerId]).filter(Boolean);
  if (kritiker.length && kontext.serie < 0.1) {
    const kp = rng.pick(kritiker);
    const stil = club.tactics ? club.tactics.style : 'ausgeglichen';
    push('taktik', 'Kritik an der Spielweise',
      `${vollName(kp)} hat in der Kabine laut gefragt, ob man "wirklich weiter so spielen" wolle. ` +
      `Gemeint war Ihr ${stil}-Ansatz. Zwei Mitspieler haben genickt, der Rest hat auf den Boden geschaut.`,
      [kp.id], kontext.serie < -0.4 ? 1.6 : 0.7);
  }

  /* --- Neid auf ein Neuzugangsgehalt --------------------------------------- */
  const neuzugaenge = spieler.filter(p => p.joined && p.joined.season === saison);
  if (neuzugaenge.length) {
    const teuer = sortBy(neuzugaenge, p => ({ key: p.contract ? p.contract.salary : 0, desc: true }))[0];
    const benachteiligt = spieler.filter(p =>
      p !== teuer && (kontext.leistungPct[p.id] || 0) > 0.6 &&
      (p.contract ? p.contract.salary : 0) < (teuer.contract ? teuer.contract.salary : 0) * 0.6);
    if (benachteiligt.length) {
      const n = rng.pick(benachteiligt);
      push('neid_gehalt', 'Neid auf das Neuzugangsgehalt',
        `Irgendjemand hat geplaudert: Der Kader kennt jetzt das Gehalt von ${vollName(teuer)}. ` +
        `${vollName(n)} — seit Jahren im Verein, seit Jahren Stammspieler — hat daraufhin nur gesagt: ` +
        `"Interessant." Das war das Lauteste, was er je gesagt hat.`,
        [n.id, teuer.id], 1.4);
    }
  }

  /* --- Positionsrivalität --------------------------------------------------- */
  const nachPos = {};
  for (const p of spieler) (nachPos[p.position] || (nachPos[p.position] = [])).push(p);
  const rivalPos = Object.keys(nachPos).filter(pos => nachPos[pos].length >= 2 && pos !== 'TW');
  if (rivalPos.length) {
    const pos = rng.pick(rivalPos);
    const beide = sortBy(nachPos[pos], p => ({ key: playerOverall(p), desc: true })).slice(0, 2);
    push('position', `Zweikampf um die ${POSITION_NAMES[pos] || pos}-Position`,
      `${vollName(beide[0])} und ${vollName(beide[1])} beharken sich im Training, als ginge es um den Pokalfinalplatz. ` +
      `Beim letzten Trainingsspiel musste der Co-Trainer dazwischen. Auf der Position ${POSITION_NAMES[pos] || pos} ist Platz für einen.`,
      [beide[0].id, beide[1].id], 1.0);
  }
  const tw = nachPos.TW || [];
  if (tw.length >= 2) {
    const beide = sortBy(tw, p => ({ key: playerOverall(p), desc: true })).slice(0, 2);
    push('position', 'Torwartdiskussion',
      `${vollName(beide[1])} hat dem Sportchef mitgeteilt, dass er "nicht ewig hinter ${name(beide[0])} verschimmeln" werde. ` +
      `Torwarttrainer sind für so etwas nicht ausgebildet. Sie schon.`,
      [beide[0].id, beide[1].id], 0.7);
  }

  /* --- Cliquenbildung nach Nationalität -------------------------------------- */
  const cliquen = cliquenVon(state, spieler, club.id).filter(c => c.art === 'nation' && c.staerke > 0.35);
  if (cliquen.length) {
    const cl = cliquen[0];
    const kern = cl.playerIds.slice(0, 3).map(id => state.players[id]).filter(Boolean);
    push('clique', 'Grüppchen in der Kabine',
      `Beim Mannschaftsessen saßen ${kern.map(vollName).join(', ')} wieder komplett unter sich und haben den ganzen Abend ` +
      `kein deutsches Wort gesprochen. Die anderen finden das inzwischen weniger charmant als am Anfang.`,
      cl.playerIds.slice(0, 4), 0.9);
  }

  /* --- Ärger über die Kapitänsbinde ------------------------------------------- */
  const kap = hier.find(h => h.rang === 'kapitaen');
  const vize = hier.filter(h => h.rang === 'fuehrungsspieler')[0];
  if (kap && vize) {
    const kp = state.players[kap.playerId], vp = state.players[vize.playerId];
    if (kp && vp && vize.einfluss > kap.einfluss - 4) {
      push('kapitaensbinde', 'Machtkampf um die Binde',
        `${vollName(vp)} hat in einem Interview betont, er "würde die Verantwortung sofort übernehmen". ` +
        `${vollName(kp)} trägt die Binde seit dem ersten Spieltag und hat das Interview gelesen. Zweimal.`,
        [vp.id, kp.id], 1.1);
    }
  } else if (!kap && hier.length) {
    const a = state.players[hier[0].playerId], b = state.players[(hier[1] || hier[0]).playerId];
    push('kapitaensbinde', 'Wer führt diese Mannschaft?',
      `Ohne festen Kapitän reißen ${vollName(a)} und ${vollName(b)} die Führung abwechselnd an sich — meistens gleichzeitig, ` +
      `meistens mit unterschiedlichen Ansagen. Die Mannschaft weiß nicht mehr, auf wen sie hören soll.`,
      [a.id, b.id], 1.5);
  }

  /* --- Legende gegen jungen Star (das Herzstück dieses Spiels) ----------------
   * Mehrere Varianten, damit sich der sichtbarste Streit des Spiels nicht in der
   * dritten Saison wortgleich wiederholt. Jede Variante nennt beide Namen.
   *
   * Gewählt wird über `variante()` (hashString) und NICHT über rng.pick: Jeder
   * zusätzliche Würfel hier verschiebt den ganzen Konflikt-Zufallsstrom und
   * damit den Verlauf der Liga — beim ersten Anlauf sind daran prompt drei
   * Zusicherungen in test-transfers.js zerbrochen. Vorbild ist
   * gespraechsAusgang(), das seine Varianten seit jeher genauso zieht. */
  const legenden = spieler.filter(p => p.era === 'legend');
  const moderne = spieler.filter(p => p.era !== 'legend');
  /* WER IST HIER EIN „JUNGER STAR"? Die Schranke hat diesen Streit zweimal
   * abgewürgt, und beim zweiten Mal war die Zahl nicht der Fehler, sondern der
   * Bezugsrahmen:
   *
   *   Sie stand auf `leistungPct > 0.45` — dem Rang IM GESAMTEN KADER. Ein
   *   Legendenverein hat 10 Legenden in einem 20-Mann-Kader, und Legenden sind
   *   die besten Spieler. Damit belegen sie die obere Hälfte vollständig, und
   *   KEIN moderner Spieler kann diese Schranke überhaupt erreichen. Gemessen
   *   (HSV, Seeds 3/7/11/23): Spielzeit 1 genau ein Kandidat, ab Spielzeit 3
   *   null — auch bei Altersgrenze 28. „Legende gegen jungen Star", laut
   *   Kommentar das Herzstück dieses Spiels, war ab dem dritten Jahr rechnerisch
   *   unmöglich, und die Ära-Frage versickerte auf 0 je Spielzeit. Genau der
   *   Befund, der diese Arbeit ausgelöst hat, nur zwei Jahre später.
   *
   * Gemessen wird deshalb der Rang IM MODERNEN LAGER: Wer unter den Jungen und
   * Modernen zur besseren Hälfte gehört, ist der Mann mit der Zukunft — egal wie
   * viele Ikonen über ihm stehen. Genau darum geht der Streit ja: Er stellt sich,
   * WEIL die Ikonen oben stehen. */
  const modernRang = {};
  sortBy(moderne, p => playerOverall(p)).forEach((p, i) => {
    modernRang[p.id] = i / Math.max(1, moderne.length - 1);
  });
  const jungeStars = moderne.filter(p => (p.age || 26) <= 26 && (modernRang[p.id] || 0) >= 0.5);
  if (legenden.length && jungeStars.length) {
    const l = sortBy(legenden, p => ({ key: playerOverall(p), desc: true }))[0];
    const j = sortBy(jungeStars, p => ({ key: playerOverall(p), desc: true }))[0];
    const ikone = l.eraLabel || 'eine Ikone dieses Vereins';
    const varianten = [
      { titel: `${name(l)} gegen ${name(j)}`,
        text: `Es ist passiert. ${vollName(l)}, ${ikone}, hat ${vollName(j)} vor versammelter ` +
          `Mannschaft erklärt, wie man diesen Sport spielt: "Zu meiner Zeit hätte man dich nach zehn Minuten ausgewechselt — ` +
          `und zwar für immer." ${name(j)} hat geantwortet, er habe die Zeit nicht miterlebt, aber die Videos gesehen, ` +
          `und da sei der Rasen deutlich langsamer gewesen. Die halbe Kabine hat gelacht. Die andere Hälfte nicht.` },
      { titel: 'Standpauke nach dem Training',
        text: `${vollName(l)} hat sich im Abschlusstraining den Ball geschnappt, ihn ${vollName(j)} vor die Füße gelegt ` +
          `und gefragt, ob er "auch mal mit dem Kopf denken" könne. ${name(j)} hat zurückgefragt, ob man früher deshalb ` +
          `so viel gelaufen sei. Der Zeugwart hat die Kabinentür zugezogen. Zu spät, die Journalisten standen schon draußen.` },
      { titel: 'Der Platz im Mannschaftsbus',
        text: `Seit Jahren sitzt ${vollName(l)} in Reihe zwei am Fenster. Gestern saß dort ${vollName(j)}, Kopfhörer auf, ` +
          `und hat ihn schlicht nicht gesehen. ${name(l)} hat nichts gesagt, sich nach hinten gesetzt und seitdem kein Wort ` +
          `mehr mit ihm gewechselt. In dieser Kabine geht es nie um den Sitzplatz.` },
      { titel: 'Zwei Interviews, ein Thema',
        text: `${vollName(j)} hat einer Jugendzeitschrift erklärt, moderner Fußball sei "schneller als das, was die Älteren ` +
          `gewohnt sind". ${vollName(l)} hat den Artikel gelesen, ausgeschnitten und im Kabinengang aufgehängt. ` +
          `Ohne Kommentar. Der Kommentar kommt noch.` }
    ];
    const v = variante(varianten, l.id + j.id, state, saison);
    push('legende_star', v.titel, v.text, [l.id, j.id], 2.6, 3);
  }

  /* --- Generationskonflikt legend vs. modern ---------------------------------- */
  if (legenden.length >= 3 && spieler.length - legenden.length >= 3) {
    const l = rng.pick(legenden);
    const m = rng.pick(spieler.filter(p => p.era !== 'legend'));
    const varianten = [
      { titel: 'Alte Schule gegen neue Schule',
        text: `Streit über die Trainingsmethoden: ${vollName(l)} hält Laktattests, Schlafuhren und Gemüsesäfte für Aberglauben ` +
          `und Waldläufe für die Lösung. ${vollName(m)} hält ${name(l)} für ein Museumsstück. Beide haben Anhänger. ` +
          `Der Athletiktrainer hat sich krankgemeldet.` },
      { titel: 'Streit um die Trainingszeit',
        text: `${vollName(m)} und die halbe Ersatzbank wollen die Einheit auf halb elf legen — "Regeneration". ` +
          `${vollName(l)} trainiert seit jeher um neun und hält alles andere für einen Schlafsaal mit Vereinswappen. ` +
          `Der Athletiktrainer hat beide Pläne ausgedruckt und wartet auf ein Machtwort.` },
      { titel: 'Der Mannschaftsabend, der keiner war',
        text: `${vollName(l)} hatte zum Kegeln geladen, mit Anwesenheitsliste. ${vollName(m)} ist stattdessen mit den ` +
          `Jüngeren essen gegangen; die Bilder davon standen am nächsten Morgen in der Zeitung. Seitdem sind es zwei ` +
          `Mannschaften, die zufällig dasselbe Trikot tragen.` },
      { titel: 'Kopfhörer in der Kabine',
        text: `${vollName(m)} hört sich vor dem Anpfiff mit Kopfhörern warm. ${vollName(l)} nennt das "Kindergarten mit ` +
          `Bassbox" und hat gestern kommentarlos den Stecker gezogen. Die Kabine war danach sehr still — auf die ` +
          `unangenehme Art.` }
    ];
    const v = variante(varianten, l.id + m.id, state, saison);
    push('generation', v.titel, v.text, [l.id, m.id], 1.7);
  }

  /* --- Disziplin ---------------------------------------------------------------- */
  const schwierige = spieler.filter(p => ['schwierig', 'geldgierig'].includes(persona(p).id) || (p.traits || []).includes('querulant'));
  if (schwierige.length) {
    const s = rng.pick(schwierige);
    push('disziplin', 'Nächtlicher Ausflug',
      `${vollName(s)} wurde um halb drei nachts vor einer Diskothek fotografiert. Er sagt, er habe nur einen Freund abgeholt. ` +
      `Der Freund war laut Bildunterschrift eine Flasche Wodka.`,
      [s.id], 0.8);
  }

  /* --- Presse ------------------------------------------------------------------- */
  const unzufrieden = spieler.filter(p => (p.morale || 60) < 38);
  if (unzufrieden.length) {
    const u = sortBy(unzufrieden, p => (p.morale || 60))[0];
    push('presse', 'Nadelstich in der Zeitung',
      `${vollName(u)} hat einem Reporter gesagt, er wolle "nichts Falsches sagen" — und dann vierzig Minuten lang ` +
      `genau das getan. Der Artikel erscheint morgen. Die Überschrift kennen Sie schon.`,
      [u.id], 1.2);
  }

  return out;
}

export const LOESUNGS_METHODEN = {
  einzelgespraech: { name: 'Einzelgespräche', desc: 'Jeden Beteiligten unter vier Augen abholen.', basis: 0.55, risiko: 0.10, skill: 'motivation' },
  mannschaftsrat: { name: 'Mannschaftsrat einschalten', desc: 'Die Führungsspieler klären das intern.', basis: 0.60, risiko: 0.14, skill: 'motivation' },
  aussprache: { name: 'Aussprache vor der Mannschaft', desc: 'Alles auf den Tisch — vor allen.', basis: 0.50, risiko: 0.30, skill: 'medien' },
  bestrafen: { name: 'Bestrafen', desc: 'Geldstrafe, Tribüne, Ansage. Wirkt sofort — oder gar nicht.', basis: 0.52, risiko: 0.38, skill: 'taktik' },
  ignorieren: { name: 'Aussitzen', desc: 'Nichts tun und hoffen, dass Gras drüber wächst.', basis: 0.22, risiko: 0.20, skill: null },
  verkaufen: { name: 'Störenfried abgeben', desc: 'Auf die Transferliste. Radikal, aber endgültig.', basis: 0.88, risiko: 0.45, skill: 'verhandlung' },
  kapitaenswechsel: { name: 'Kapitän wechseln', desc: 'Neue Binde, neue Ordnung.', basis: 0.62, risiko: 0.40, skill: 'motivation' },

  /* Nur bei Ära-Konflikten (istAeraKonflikt). Beide beenden den Streit immer —
   * und beide kosten immer, über 120 Tage gerechnet ungefähr dasselbe.
   *
   * `folge` ist die Andeutung VOR der Entscheidung. `folgeText(besetzung)` macht
   * daraus den konkreten Satz mit Namen und Stückzahlen — das ist die sichtbarste
   * Stelle des ganzen Spielprinzips, und wer abwägen soll, muss wissen, wen es
   * trifft. `folge` bleibt als Rückfall stehen, wenn die Besetzung fehlt.
   * Hinterher steht dieselbe Rechnung im Ausgangstext noch einmal im Klartext.
   *
   * Drei Fassungen je Weg, gewählt über die Kennung des Streits (`folgeSatz`) und
   * damit stabil: Der Bildschirm baut diesen Text bei jedem Neuzeichnen neu auf —
   * ein Würfel an dieser Stelle würde die Andeutung unter der Hand austauschen,
   * während man noch abwägt. Über eine Karriere hinweg liest man trotzdem nicht
   * zwölfmal denselben Satz. */
  alte_schule: {
    name: 'Der Alte hat recht',
    desc: 'Sie stellen sich vor die Legende — im Mannschaftskreis, für alle hörbar.',
    folge: 'Beendet den Streit. Kostet auf einen Schlag die Laune aller modernen Spieler — ' +
      'breit, sofort, in zwei bis drei Wochen aufgeholt. Wer am Wochenende spielt, spielt schlechter.',
    folgeText: b => {
      const n = b.modern.length;
      const nL = b.legende ? name(b.legende) : 'Die Legende';
      const nJ = b.jung ? name(b.jung) : null;
      return folgeSatz(b, [
        `Beendet den Streit. ${n} moderne Spieler verlieren auf einen Schlag Laune` +
          `${nJ ? `, ${nJ} als Überstimmter am meisten` : ''} — breit, sofort, in zwei bis drei Wochen ` +
          `aufgeholt. Wer am Wochenende ein wichtiges Spiel hat, zahlt hier am meisten. ` +
          `${nL} gewinnt Laune und ${AERA_LEGENDE_RUECKEN} Punkte Ansehen; die Hackordnung dieser Kabine ` +
          `bleibt, wie sie ist. Wer vorher schon am Boden war, den trifft es nicht mehr — abstürzen lässt ` +
          `Sie hier niemanden, das ist der Unterschied zum anderen Weg.`,
        `Beendet den Streit — mit einer Rechnung an ${n} Adressen: Jeder moderne Spieler geht mit ` +
          `schlechterer Laune nach Hause${nJ ? `, ${nJ} als der öffentlich Überstimmte deutlich mehr` : ''}. ` +
          `Die Delle sitzt heute und ist in zwei bis drei Wochen aufgeholt; bis zum nächsten Spiel ` +
          `allerdings nicht. Dafür steht ${nL} um ${AERA_LEGENDE_RUECKEN} Punkte fester in der ` +
          `Hackordnung, und oben bleibt oben. Wer ohnehin schon unten war, verliert dabei nichts mehr.`,
        `Beendet den Streit und bestätigt die Rangordnung. Preis: die Laune von ${n} modernen Spielern, ` +
          `alle am selben Tag${nJ ? `, ${nJ} am härtesten` : ''} — kurz, aber genau jetzt. ` +
          `${nL} gewinnt ${AERA_LEGENDE_RUECKEN} Punkte Ansehen. Niemand verlässt deswegen den Verein — ` +
          `es ist eine Ansage, kein Rausschmiss.`
      ]);
    },
    basis: 0.72, risiko: 0.28, skill: 'motivation', nurAera: true
  },
  neue_zeit: {
    name: 'Die Zeiten haben sich geändert',
    desc: 'Sie geben dem Jungen recht — und der Legende einen Platz weiter hinten.',
    folge: 'Beendet den Streit. Kostet fast alles bei einem Einzigen, dafür monatelang: Laune, ' +
      'Ansehen in der Hackordnung und das Vertrauen der Legende in Sie. Ihre Vertrauten in der ' +
      'Kabine nehmen es ihr ab, und gehen will sie danach womöglich auch.',
    folgeText: b => {
      const nL = b.legende ? name(b.legende) : 'Die Legende';
      /* NICHT Math.abs(AERA_LEGENDE_ANSEHEN), sondern was WIRKLICH gebucht würde.
       * Steht die Legende schon in der Kreide (zwei Ära-Streits kurz hintereinander,
       * derselbe Mann), greift in ansehenSetzen() die Grenze ANSEHEN_MIN, und die
       * Andeutung versprach 28 Punkte, während 12 gebucht wurden. Wer eine Zahl
       * nennt, nennt die gebuchte — dieselbe Regel wie im Ausgangstext. */
      const ansehen = Math.abs(Math.round(b.ansehen));
      const kopf = folgeSatz(b, [
        `Beendet den Streit. ${nL} zahlt fast alles allein, dafür monatelang: Laune, ` +
          `${ansehen} Punkte Ansehen in der Hackordnung (${ANSEHEN_DAUER_TAGE} Tage Nachhall) und sein ` +
          `Vertrauen in Sie — das wächst über Monate nach, nicht über Tage.`,
        `Beendet den Streit, und die Rechnung geht an eine einzige Adresse: ${nL} verliert Laune, ` +
          `${ansehen} Punkte Ansehen in der Kabinenordnung und sein Vertrauen in den Trainer. ` +
          `Der Nachhall läuft ${ANSEHEN_DAUER_TAGE} Tage, nicht zwei Wochen.`,
        `Beendet den Streit — schmal und lang. ${nL} trägt es fast allein: Laune weg, ${ansehen} Punkte ` +
          `Ansehen weg, Vertrauen weg. Vergessen ist das nach einem Vierteljahr, nicht nach einem Spieltag.`
      ]);
      const teile = [kopf];
      if (b.gefolge.length) {
        teile.push(`${b.gefolge.length === 1 ? 'Sein Vertrauter' : `Seine ${b.gefolge.length} Vertrauten`} in der Kabine ` +
          `(${b.gefolge.map(name).join(', ')}) ${b.gefolge.length === 1 ? 'nimmt' : 'nehmen'} es Ihnen ab.`);
      }
      if (b.zoeglinge.length) {
        teile.push(`${b.zoeglinge.map(name).join(' und ')} ${b.zoeglinge.length === 1 ? 'verliert' : 'verlieren'} ` +
          `den Mentor — ${nL} zieht ${b.zoeglinge.length === 1 ? 'ihn' : 'sie'} nicht mehr groß.`);
      }
      teile.push(`Und eine gekränkte Ikone verlangt danach manchmal ihren Abschied.`);
      return teile.join(' ');
    },
    basis: 0.72, risiko: 0.28, skill: 'motivation', nurAera: true
  }
};

/**
 * Wählt eine Fassung der angedeuteten Folge — ohne Würfel, damit derselbe Streit
 * beim Neuzeichnen dieselbe Andeutung zeigt (siehe Kommentar in
 * LOESUNGS_METHODEN). Vorbild ist `variante()` weiter oben.
 */
function folgeSatz(besetzung, fassungen) {
  const schluessel = 'folge|' + (besetzung && besetzung.id ? besetzung.id : 'ohne');
  return fassungen[Math.abs(hashString(schluessel)) % fassungen.length];
}

/** Findet einen Konflikt über alle Vereine hinweg. -> { club, konflikt } | null */
function konfliktFinden(state, konfliktId) {
  for (const id in state.clubs) {
    const k = kabine(state.clubs[id]);
    const treffer = k.konflikte.find(x => x.id === konfliktId);
    if (treffer) return { club: state.clubs[id], konflikt: treffer };
  }
  return null;
}

/**
 * Welche Wege stehen bei DIESEM Streit offen?
 * Ära-Wege zuerst — sie sind die Frage, die dieser Streit stellt.
 *
 * @param {object|string} konflikt Konfliktobjekt (aus offeneKonflikte) oder dessen id
 * -> [{ id, name, desc, folge, nurAera }]
 */
export function loesungsWege(state, konflikt) {
  const c = typeof konflikt === 'string'
    ? ((konfliktFinden(state, konflikt) || {}).konflikt || null)
    : konflikt;
  const aera = istAeraKonflikt(state, c);
  const besetzung = aera ? aeraBesetzung(state, c) : null;
  const bau = id => {
    const m = LOESUNGS_METHODEN[id];
    let folge = (besetzung && m.nurAera && m.folgeText)
      ? m.folgeText(besetzung)
      : (m.folge || m.desc);
    /* DER VORBEHALT, der in der Abnahme gefehlt hat. Beide Ära-Wege rechnen mit
     * AERA_FEHLSCHLAG ab, wenn die Kabine nicht mitgeht — bei einem Streit der
     * Schwere 3 war das in der Messung 31 von 72 Entscheidungen, also fast jede
     * zweite. Die Andeutung nannte trotzdem immer nur den Preis für den guten
     * Fall: Sie versprach 28 Punkte Ansehen und das Spiel buchte 40. Wer abwägen
     * soll, muss auch die Spanne kennen, nicht nur die Untergrenze.
     *
     * Er hängt hier und nicht in den Fassungen von `folgeText`: So steht er
     * garantiert an JEDER Fassung beider Wege, und zwar genau einmal. */
    if (m.nurAera && aera) {
      folge += ` Ob die Kabine mitgeht, ist nicht ausgemacht — bei einem Streit dieser Größe ` +
        `etwa jedes zweite Mal nicht. Dann wird alles davon um gut die Hälfte teurer.`;
    }
    return { id, name: m.name, desc: m.desc, nurAera: !!m.nurAera, folge };
  };
  const out = [];
  for (const id in LOESUNGS_METHODEN) if (LOESUNGS_METHODEN[id].nurAera && aera) out.push(bau(id));
  for (const id in LOESUNGS_METHODEN) if (!LOESUNGS_METHODEN[id].nurAera) out.push(bau(id));
  return out;
}

/**
 * Wer steht bei DIESEM Ära-Streit auf welcher Seite — und wen trifft es
 * mittelbar? Einmal gerechnet, zweimal gebraucht: `loesungsWege()` schreibt
 * daraus die Folge, die VOR der Entscheidung dasteht, `konfliktLoesen()`
 * verbucht danach genau dieselbe Rechnung. Wäre das zweimal gerechnet, würde
 * die Andeutung eines Tages von der Buchung abweichen.
 *
 * -> { club, legende, jung, modern, gefolge, zoeglinge, id, ansehen }
 */
function aeraBesetzung(state, c) {
  const club = c && c.clubId ? state.clubs[c.clubId] : null;
  const leer = { club: null, legende: null, jung: null, modern: [], gefolge: [], zoeglinge: [], id: '', ansehen: AERA_LEGENDE_ANSEHEN };
  if (!club || !c) return leer;
  const beteiligte = (c.playerIds || []).map(id => state.players[id]).filter(Boolean);
  const legende = beteiligte.find(x => x.era === 'legend') || beteiligte[0] || null;
  const jung = beteiligte.find(x => x.era !== 'legend') || null;
  const kader = squadOf(state, club);
  const modern = kader.filter(x => x.era !== 'legend');

  /* Die Gefolgschaft: wer in dieser Kabine zur Legende hält. Genommen wird, was
   * `beziehungen()` ohnehin schon weiß — keine zweite Beziehungsebene. Der
   * öffentlich bevorzugte Jungstar zählt nicht dazu, auch wenn er sie mag. */
  const gefolge = [];
  if (legende) {
    const bez = beziehungenCache(state, club);
    const eintrag = bez.byPlayer[legende.id];
    const freunde = eintrag ? eintrag.freunde : [];
    const nachNaehe = sortBy(freunde, id => {
      const paar = bez.paare.find(x => (x.a === id && x.b === legende.id) || (x.b === id && x.a === legende.id));
      return { key: paar ? paar.wert : 0, desc: true };
    });
    for (const id of nachNaehe) {
      if (gefolge.length >= AERA_GEFOLGE_MAX) break;
      const q = state.players[id];
      if (!q || (jung && q.id === jung.id)) continue;
      gefolge.push(q);
    }
  }

  /* Die Mentorenbögen der Legende (club/chemie.js pflegt sie, hier werden nur
   * dieselben Felder gelesen — ein Import wäre ein Zyklus). */
  const zoeglinge = [];
  if (legende && Array.isArray(legende.mentees)) {
    for (const id of legende.mentees) {
      const q = state.players[id];
      if (q && q.clubId === club.id && q.mentor && q.mentor.mentorId === legende.id) zoeglinge.push(q);
    }
  }
  /* Wie viel Ansehen bei DIESEM Stand überhaupt noch zu verlieren ist. Dieselbe
   * Rechnung wie in ansehenSetzen(), nur ohne zu buchen: Wer schon bei −34 steht,
   * verliert bei ANSEHEN_MIN = −40 keine 28 Punkte mehr, sondern 6. */
  let ansehen = AERA_LEGENDE_ANSEHEN;
  if (legende) {
    const k = kabine(club);
    const heuteAbs = state.date ? state.date.day + state.date.season * 365 : 0;
    const rest = ansehenNachhall(k, legende.id, heuteAbs);
    ansehen = clamp(rest + AERA_LEGENDE_ANSEHEN, ANSEHEN_MIN, ANSEHEN_MAX) - rest;
  }
  return { club, legende, jung, modern, gefolge, zoeglinge, id: c.id || '', ansehen };
}

/** Moralstoß mit Persönlichkeitsfaktor — Kurzweg für die Ära-Entscheidungen. */
function aeraStoss(p, delta) {
  p.morale = clamp(round((p.morale !== undefined ? p.morale : MORAL_NEUTRAL) +
    delta * (persona(p).moraleSwing || 1), 1), MORAL_MIN, MORAL_MAX);
}

/**
 * Derselbe Stoß, aber mit Boden — und das ist der Unterschied zwischen „breit und
 * kurz" und „breit und für immer".
 *
 * Ein Machtwort im Mannschaftskreis kostet Laune. Es ist aber nicht der Grund,
 * aus dem einer den Verein verlässt: Wer nach einer Ansage seinen Berater anruft,
 * wollte schon vorher weg. Ohne diesen Boden schob der Abzug auf dreizehn Köpfe
 * in einer angeschlagenen Kabine im Schnitt 1,19 Spieler je Entscheidung unter
 * SCHWELLE_WECHSELWUNSCH — und ein Wechselwunsch heilt nie von selbst, er kostet
 * über MOD_WECHSELWUNSCH bis zum Saisonende weiter. Damit hing der Preis dieses
 * Weges nicht an der Entscheidung, sondern daran, wie viele Spieler zufällig
 * knapp über der Schwelle standen: In einer intakten Kabine kostete er 60, in
 * einer schlechten 190 (tools/test-moral.js 4c, beide Bänder).
 *
 * Mit Boden bleibt der Zuschnitt und verschwindet der Zufall: Der Abzug trifft
 * jeden, aber er stürzt niemanden ab. Wer schon UNTER dem Boden steht, verliert
 * gar nichts mehr — der hat innerlich abgeschlossen, den kränkt kein Machtwort.
 */
function aeraStossMitBoden(p, delta, boden) {
  const vor = p.morale !== undefined ? p.morale : MORAL_NEUTRAL;
  if (vor <= boden) return;
  const ziel = vor + delta * (persona(p).moraleSwing || 1);
  p.morale = clamp(round(delta < 0 ? Math.max(boden, ziel) : ziel, 1), MORAL_MIN, MORAL_MAX);
}

/**
 * Löst (oder verschlimmert) einen Konflikt.
 * -> { ok, text, erfolg, schaden, konflikt }
 */
export function konfliktLoesen(state, konfliktId, methode) {
  const m = LOESUNGS_METHODEN[methode];
  if (!m) return { ok: false, text: `Unbekannte Methode "${methode}".` };

  const treffer = konfliktFinden(state, konfliktId);
  if (!treffer) return { ok: false, text: 'Diesen Konflikt gibt es nicht (mehr).' };
  const club = treffer.club, c = treffer.konflikt;
  if (c.status !== 'offen') return { ok: false, text: 'Der Streit ist längst erledigt.' };
  if (m.nurAera && !istAeraKonflikt(state, c)) {
    return { ok: false, text: `„${m.name}" hilft hier nicht weiter: In diesem Streit stehen sich nicht zwei Fußballzeitalter gegenüber.` };
  }

  const rng = localRng(state, club, 'loesen:' + konfliktId + ':' + methode);
  const skills = state.manager.skills || {};
  const skillWert = m.skill ? (skills[m.skill] || 45) : 50;
  const ruf = state.manager.reputation || 40;
  const beteiligte = c.playerIds.map(id => state.players[id]).filter(Boolean);

  // Erfolgschance: Methode + Managerskill + Ruf − Schwere − Wiederholung
  let p = m.basis
    + (skillWert - 50) / 100 * MOTIVATION_GEWICHT
    + (ruf - 45) / 100 * RUF_GEWICHT
    - (c.schwere - 1) * 0.11
    - c.versuche * 0.12;

  // Die Kabine hilft mit, wenn ein Kabinenleader dabei ist.
  const hier = hierarchie(state, club.id);
  const rat = mannschaftsrat(state, club.id);
  if (methode === 'mannschaftsrat') {
    const staerke = rat.mitglieder.length ? avg(rat.mitglieder, x => x.einfluss) : 30;
    p += (staerke - 45) / 100;
    if (!rat.mitglieder.length) p -= 0.25;
  }
  if (beteiligte.some(x => (x.traits || []).includes('kabinenleader'))) p += 0.08;
  if (beteiligte.some(x => persona(x).id === 'schwierig')) p -= 0.10;
  if (methode === 'ignorieren') p -= (c.schwere - 1) * 0.10;
  p = clamp(p, 0.04, 0.96);

  const gelungen = rng.chance(p);
  const risiko = clamp(m.risiko * (gelungen ? 0.35 : 1.4), 0, 0.95);
  const nebenwirkung = rng.chance(risiko);
  c.versuche++;

  let text = '', schaden = 0;
  const nA = beteiligte[0] ? vollName(beteiligte[0]) : 'Der Spieler';
  const nB = beteiligte[1] ? vollName(beteiligte[1]) : null;

  if (methode === 'verkaufen') {
    // Sonderweg: der Unruhestifter wird auf die Liste gesetzt.
    const opfer = sortBy(beteiligte, x => (x.morale || 60))[0] || beteiligte[0];
    if (opfer) {
      if (!opfer.transfer) opfer.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
      opfer.transfer.listed = true;
      opfer.morale = clamp((opfer.morale || 60) - 18, MORAL_MIN, MORAL_MAX);
    }
    c.status = 'geloest';
    text = `${opfer ? vollName(opfer) : 'Der Störenfried'} steht auf der Transferliste. Der Streit ist beendet — ` +
      `auf die unelegante Art. In der Kabine hat man verstanden, wer hier entscheidet.`;
    if (nebenwirkung) {
      schaden = -6;
      text += ' Allerdings: Ein Teil der Mannschaft findet das eine Nummer zu hart und lässt es Sie spüren.';
    }
  } else if (methode === 'kapitaenswechsel') {
    const neu = hier.find(h => !c.playerIds.includes(h.playerId) && h.einfluss > 40);
    if (neu) {
      kapitaenBestimmen(state, club.id, neu.playerId);
      c.status = gelungen ? 'geloest' : 'offen';
      text = gelungen
        ? `${vollName(state.players[neu.playerId])} trägt ab sofort die Binde. Die Rangordnung ist geklärt, der Streit erledigt.`
        : `${vollName(state.players[neu.playerId])} trägt jetzt die Binde. Gelöst hat das gar nichts — jetzt sind alle beleidigt.`;
    } else {
      text = 'Es gibt schlicht keinen glaubwürdigen neuen Kapitän im Kader. Der Versuch versandet.';
      c.status = 'offen';
    }
  } else if (m.nurAera) {
    /* Die beiden Ära-Wege. Sie beantworten die Streitfrage, statt sie zu
     * moderieren: Der Streit ist danach IMMER beendet. Bezahlt wird trotzdem —
     * und wenn die Kabine nicht mitgeht (gelungen === false), teurer.
     *
     * Gebucht wird genau die Rechnung, die `loesungsWege()` vorher angedeutet
     * hat; beide lesen dieselbe `aeraBesetzung()`. */
    const b = aeraBesetzung(state, c);
    const legende = b.legende, jung = b.jung, modern = b.modern;
    const kab = kabine(club);
    const heuteAbs = state.date ? state.date.day + state.date.season * 365 : 0;
    const mal = gelungen ? 1 : AERA_FEHLSCHLAG;
    const nL = legende ? vollName(legende) : 'der Altmeister';
    const nJ = jung ? vollName(jung) : 'der Junge';
    let unterlegen = null, abgangChance = 0;

    c.status = 'geloest';
    c.verlauf.push(`Entschieden: ${m.name}.`);

    if (methode === 'alte_schule') {
      /* BREIT und KURZ: alle Modernen, viel Laune, kaum Trainervertrauen. Die
       * Laune kehrt mit ~20 % je Tag zur Zielmoral zurück — nach zwei bis drei
       * Wochen ist die Delle weg. Teuer ist das für den, der am Samstag spielt. */
      if (legende) {
        aeraStoss(legende, AERA_LEGENDE_LOB);
        ansehenSetzen(kab, legende.id, AERA_LEGENDE_RUECKEN, heuteAbs);
      }
      for (const x of modern) {
        const hart = !!(jung && x.id === jung.id);
        /* Mit Boden: breit ja, abstürzen nein — siehe aeraStossMitBoden(). */
        aeraStossMitBoden(x, (hart ? AERA_MODERN_JUNGSTAR : AERA_MODERN_LAUNE) * mal, AERA_LAUNE_BODEN);
        const hx = hp(x);
        hx.trainer = clamp(round(hx.trainer +
          AERA_MODERN_TRAINER * (hart ? AERA_MODERN_TRAINER_HART : 1) * mal, 1), 0, 100);
      }
      unterlegen = jung;
      abgangChance = gelungen ? 0 : m.risiko;

      text = rng.pick([
        `Sie stellen sich in den Mannschaftskreis und erledigen die Sache in einem Satz: „${nL} hat recht." ` +
          `${nJ} hat genickt, wie man nickt, wenn der Chef fertig geredet hat. Überzeugt sieht anders aus.`,
        `„Der Mann hat Titel geholt, da haben andere hier noch Panini-Bilder getauscht." Mehr Begründung gab es nicht. ` +
          `${nL} stand danach zwei Zentimeter größer in der Kabine, ${nJ} zwei Zentimeter kleiner.`,
        `Sie geben ${nL} recht — öffentlich, ohne Weichspüler, mit Blick auf die Uhr. Der Streit ist damit vom Tisch. ` +
          `Die jüngere Hälfte des Kaders hat jedes Wort mitgeschrieben. Im Kopf.`,
        `Sie lassen ${nJ} ausreden und antworten mit einem Satz, den jeder in der Kabine versteht: ` +
          `„Solange ich hier sitze, gilt, was ${nL} sagt." Danach war es sehr still und sehr klar.`
      ]) + ' ' + (gelungen
        ? 'Die Kabine trägt es mit: Wer vier Jahrzehnte Fußball gesehen hat, darf laut werden.'
        : 'Die Kabine trägt es NICHT mit. In der Kraftkammer lief anschließend sehr laute Musik und sehr wenig Gespräch.');
      /* Der Nachsatz benennt, was gemessen ist und was man sonst erst drei Wochen
       * später im Postfach findet: Bei 0,69 Entscheidungen von zehn bittet danach
       * einer der Übergangenen um seine Freigabe (test-moral.js 4c). Genannt wird
       * der, den es am ehesten trifft — der unzufriedenste Moderne. */
      const wackelt = sortBy(modern.filter(x => !jung || x.id !== jung.id), x => (x.morale || 60))[0];
      const wackelSatz = wackelt && (wackelt.morale || 60) <= AERA_LAUNE_BODEN + 1
        ? ` Behalten Sie ${vollName(wackelt)} im Auge: Tiefer geht es bei ihm nicht mehr, und genau das ist das Problem.`
        : (wackelt && (wackelt.morale || 60) < 40
          ? ` ${vollName(wackelt)} war schon vorher schlecht gelaunt und heute nicht gemeint — getroffen hat es ihn trotzdem.`
          : '');
      text += '\n\n' + rng.pick([
        `Unterm Strich: Der Streit ist beendet, die Hackordnung steht. ${modern.length} moderne Spieler verlieren ` +
          `heute Laune${jung ? `, ${name(jung)} deutlich mehr als der Rest` : ''} — das holen sie in zwei bis drei ` +
          `Wochen auf, aber nicht bis zum Wochenende. ${legende ? name(legende) : 'Die Legende'} gewinnt ` +
          `${AERA_LEGENDE_RUECKEN} Punkte Ansehen.${wackelSatz}`,
        `Unterm Strich: Sie haben die Rangordnung dieser Kabine bezahlt, und zwar in Laune — ${modern.length} moderne ` +
          `Spieler auf einen Schlag${jung ? `, ${name(jung)} am härtesten` : ''}. Kurzfristig kostet das Punkte auf ` +
          `dem Platz; in drei Wochen redet keiner mehr davon. ${legende ? name(legende) : 'Die Legende'} steht ` +
          `fester denn je.${wackelSatz}`,
        `Unterm Strich: Der Streit ist vom Tisch — auf Kosten der Stimmung. Alle ${modern.length} modernen Spieler ` +
          `gehen heute schlechter gelaunt nach Hause${jung ? ` als ${name(jung)}, und der am schlechtesten` : ''}. ` +
          `Dafür weiß jeder in dieser Kabine wieder, wo oben ist: bei ${legende ? name(legende) : 'der Legende'}.${wackelSatz}`,
        `Unterm Strich: Eine Ansage, ${modern.length} Rechnungen. Die Laune der Modernen ist heute im Keller` +
          `${jung ? `, bei ${name(jung)} im Untergeschoss` : ''}, in zwei bis drei Wochen wieder oben — und ` +
          `${legende ? name(legende) : 'die Legende'} hat ${AERA_LEGENDE_RUECKEN} Punkte Ansehen mehr als ` +
          `heute Morgen.${wackelSatz}`
      ]);
    } else {
      /* SCHMAL und LANG: fast alles bei einem Einzigen — und weil eine Legende
       * mehr ist als ein Spieler, hat es Folgen, die der andere Weg nicht hat. */
      let ansehenGebucht = AERA_LEGENDE_ANSEHEN * mal;
      if (legende) {
        /* Auch hier mit Boden, und aus demselben Grund: Der Preis dieses Weges
         * sind Ansehen und Vertrauen über Monate — nicht ein Absturz, der die
         * Legende zufällig unter SCHWELLE_WECHSELWUNSCH schiebt. Gehen WILL sie
         * trotzdem manchmal, das steht ausdrücklich als AERA_LEGENDE_ABGANG
         * daneben und ist eine Entscheidung des Spiels, keine Nebenwirkung einer
         * Schwelle. */
        aeraStossMitBoden(legende, AERA_LEGENDE_KRAENKUNG * mal, AERA_LAUNE_BODEN);
        ansehenGebucht = ansehenSetzen(kab, legende.id, AERA_LEGENDE_ANSEHEN * mal, heuteAbs);
        const hl = hp(legende);
        hl.trainer = clamp(round(hl.trainer + AERA_LEGENDE_TRAINER * mal, 1), 0, 100);
      }
      // Die Gefolgschaft: wer zur Legende hielt, verliert Laune und Vertrauen.
      for (const x of b.gefolge) {
        aeraStossMitBoden(x, AERA_GEFOLGE_LAUNE * mal, AERA_LAUNE_BODEN);
        const hx = hp(x);
        hx.trainer = clamp(round(hx.trainer + AERA_GEFOLGE_TRAINER * mal, 1), 0, 100);
      }
      const imGefolge = new Set(b.gefolge.map(x => x.id));
      for (const x of modern) {
        if (imGefolge.has(x.id)) continue;   // wer zu ihm hält, atmet nicht auf
        aeraStoss(x, jung && x.id === jung.id ? AERA_MODERN_JUNGSTAR_PLUS : AERA_MODERN_AUFATMEN);
      }

      /* Der Mentorenbogen reißt. Gepflegt werden diese Felder von
       * club/chemie.js:mentorLoesen(); hier steht dieselbe Buchung von Hand, weil
       * ein Import ein Zyklus wäre (chemie.js liest hierarchie() aus dieser
       * Datei). Wer öffentlich zurückgepfiffen wird, zieht keinen Jungen mehr groß. */
      const fallengelassen = [];
      for (const t of b.zoeglinge) {
        t.mentor = null;
        fallengelassen.push(t);
      }
      if (fallengelassen.length && legende && Array.isArray(legende.mentees)) {
        const weg = new Set(fallengelassen.map(t => t.id));
        legende.mentees = legende.mentees.filter(id => !weg.has(id));
      }

      unterlegen = legende;
      abgangChance = AERA_LEGENDE_ABGANG * mal;

      text = rng.pick([
        `Sie sagen es ruhig und ohne Häme, dafür vor allen: „Das war früher richtig. Heute ist es falsch." ` +
          `${nL} hat nichts erwidert, seine Tasche genommen und ist gegangen.`,
        `Sie legen ${nL} die Videoanalyse hin, drei Minuten, kein Kommentar nötig — und stellen sich anschließend ` +
          `vor ${nJ}. Zwölf Augenpaare haben genau verstanden, wem hier gerade die Zukunft gehört.`,
        `„Wir spielen den Fußball von heute, und der wird nicht schlechter, weil er neu ist." ${nL} hat den Satz ` +
          `gehört, genickt und drei Tage lang mit niemandem geredet. ${nJ} trainiert seitdem wie ein Besessener.`,
        `Sie brauchen zwei Sätze: „Danke für alles, was war. Gespielt wird, was heute funktioniert." ` +
          `${nL} hat den Kabinengang hinuntergesehen, als suche er dort jemanden, der ihm widerspricht. Da war niemand.`
      ]) + ' ' + (gelungen
        ? 'Die Kabine hat es akzeptiert — respektvoll, aber unmissverständlich.'
        : 'Die Kabine fand die Art unnötig. Man demontiert keine Legende vor versammelter Mannschaft.');

      const nachhall = Math.abs(Math.round(ansehenGebucht));
      const gefolgeSatz = b.gefolge.length
        ? ` ${b.gefolge.length === 1 ? `${name(b.gefolge[0])}, sein Vertrauter in der Kabine, nimmt` : `${b.gefolge.map(name).join(', ')} — seine Vertrauten — nehmen`} es Ihnen ab.`
        : '';
      const mentorSatz = fallengelassen.length
        ? ` Und er lässt ${fallengelassen.map(vollName).join(' und ')} fallen: Der Mentorenbogen ist beendet, ` +
          `${fallengelassen.length === 1 ? 'der Junge macht' : 'die Jungen machen'} das ab jetzt allein.`
        : '';
      /* Wenn die zurückgepfiffene Ikone die Binde trägt, ist das die eigentliche
       * Nachricht des Tages — und die Abnahme hat sie vermisst: In 30 von 72
       * gemessenen Ära-Streits war die Legende Kapitän, und die Abrechnung verlor
       * darüber kein Wort. Genommen wird sie ihm nicht; das wäre eine zweite
       * Entscheidung (LOESUNGS_METHODEN.kapitaenswechsel) und nicht diese. */
      const kapitaenId = (club.tactics && club.tactics.setPieces && club.tactics.setPieces.kapitaen) || null;
      const bindeSatz = (legende && (legende.id === kapitaenId || legende.captain))
        ? ` Und er trägt weiter die Binde: Sie haben Ihren eigenen Kapitän vor der Mannschaft überstimmt und ihm ` +
          `anschließend die Binde gelassen. Beides zusammen muss er jetzt irgendwie tragen.`
        : '';
      text += '\n\n' + rng.pick([
        `Unterm Strich: Der Streit ist beendet, die Zukunft hat gewonnen. Die Rechnung geht fast vollständig an einen: ` +
          `${nL} verliert Laune, ${nachhall} Punkte Ansehen in der Hackordnung und sein Vertrauen in Sie — das wächst ` +
          `über Monate nach, nicht über Tage.${gefolgeSatz}${mentorSatz}${bindeSatz}`,
        `Unterm Strich: Der Kader atmet auf${jung ? `, ${name(jung)} spürbar` : ''} — und ein Einzelner zahlt dafür ` +
          `ein halbes Jahr. ${nL} steht ${nachhall} Punkte tiefer in der Hackordnung und redet anders mit Ihnen als ` +
          `letzte Woche.${gefolgeSatz}${mentorSatz}${bindeSatz}`,
        `Unterm Strich: Sie haben eine Entscheidung getroffen und eine Ikone dafür bezahlt. ${nL}: Laune weg, ` +
          `${nachhall} Punkte Ansehen weg, Vertrauen weg. Das ist kein Wochenendproblem, das ist ein ` +
          `Vierteljahresproblem.${gefolgeSatz}${mentorSatz}${bindeSatz}`
      ]);
    }

    kab.hierarchieTag = -999;   // die Rangordnung hat sich verschoben

    /* Wer öffentlich verliert, ruft manchmal seinen Berater an. Eine gekränkte
     * Vereinsikone tut das auch dann, wenn die Kabine mitgegangen ist — genau
     * das ist der Preis, den „Die Zeiten haben sich geändert" allein trägt. */
    if (unterlegen && abgangChance > 0 && rng.chance(abgangChance)) {
      if (!unterlegen.transfer) unterlegen.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
      if (!unterlegen.transfer.wunschWechsel) {
        unterlegen.transfer.wunschWechsel = true;
        text += ' ' + rng.pick([
          `Zwei Tage später lag die Bitte um Freigabe auf dem Schreibtisch: ${vollName(unterlegen)} möchte gehen.`,
          `Am Freitag stand der Berater von ${vollName(unterlegen)} in der Geschäftsstelle. Er möchte gehen, ` +
            `und er möchte, dass Sie das schriftlich haben.`,
          `${vollName(unterlegen)} hat um ein Gespräch gebeten und darin genau einen Satz gesagt: ` +
            `„Ich würde gern gehen." Mehr war nicht nötig.`
        ]);
      }
    }
  } else if (gelungen) {
    c.status = 'geloest';
    c.verlauf.push(`Geklärt per ${m.name}.`);
    if (methode === 'einzelgespraech') {
      text = `Nacheinander, in Ruhe, ohne Zuschauer. ${nA} hat zugehört${nB ? `, ${nB} auch` : ''}. ` +
        `Am Ende gaben sich beide die Hand — mehr aus Pflichtgefühl als aus Herzlichkeit, aber es reicht.`;
    } else if (methode === 'mannschaftsrat') {
      const w = rat.mitglieder[0];
      text = `${w ? vollName(state.players[w.playerId]) : 'Der Mannschaftsrat'} hat die Sache intern geregelt. ` +
        `Was genau in der Kabine gesagt wurde, wird Ihnen niemand erzählen. Es hat gewirkt.`;
    } else if (methode === 'aussprache') {
      text = `Alle im Kreis, jeder sagt, was ihn stört. Nach zwanzig zähen Minuten hat ${nA} den Anfang gemacht. ` +
        `Danach ging es schnell. Die Mannschaft steht enger zusammen als vorher.`;
      schaden = 4;
    } else if (methode === 'bestrafen') {
      text = `Geldstrafe, Ansage, fertig. ${nA} hat die Zähne zusammengebissen und sich entschuldigt. ` +
        `Die Mannschaft weiß jetzt, wo die Grenze verläuft.`;
    } else {
      text = `Sie haben nichts unternommen — und ausnahmsweise hat sich das Problem von selbst erledigt. ` +
        `Machen Sie das nicht zur Gewohnheit.`;
    }
  } else {
    c.schwere = Math.min(3, c.schwere + (methode === 'ignorieren' ? 0 : 1));
    c.verlauf.push(`Versuch per ${m.name} gescheitert.`);
    schaden = -4 - c.schwere * 2;
    if (methode === 'aussprache') {
      text = `Die Aussprache ist entgleist. Nach fünf Minuten schrien sich ${nA}${nB ? ` und ${nB}` : ''} an, ` +
        `nach zehn stand die halbe Mannschaft dabei und filmte mit. Das war keine gute Idee.`;
    } else if (methode === 'bestrafen') {
      text = `${nA} hat die Strafe akzeptiert — und seitdem kein Wort mehr mit Ihnen gesprochen. ` +
        `Die Mannschaft findet die Härte übertrieben.`;
    } else if (methode === 'ignorieren') {
      text = `Sie haben es ausgesessen. Der Streit auch. Er ist immer noch da, nur größer.`;
    } else {
      text = `Der Versuch ist verpufft. ${nA} nickt höflich und denkt sich seinen Teil.`;
    }
  }

  // Moralauswirkung — die Ära-Wege haben ihre eigene, gezielte Rechnung schon
  // aufgemacht und werden hier nicht ein zweites Mal verbucht.
  if (!m.nurAera) {
    for (const x of beteiligte) {
      const d = gelungen ? 9 - c.schwere * 1.5 : -6;
      x.morale = clamp(round((x.morale || MORAL_NEUTRAL) + d * (persona(x).moraleSwing || 1), 1), MORAL_MIN, MORAL_MAX);
      if (gelungen) hp(x).trainer = clamp(hp(x).trainer + 6, 0, 100);
      else hp(x).trainer = clamp(hp(x).trainer - 5, 0, 100);
    }
  }
  if (schaden) {
    for (const p2 of squadOf(state, club)) {
      p2.morale = clamp(round((p2.morale || MORAL_NEUTRAL) + schaden * 0.35, 1), MORAL_MIN, MORAL_MAX);
    }
  }
  kabine(club).beziehungenTag = -999;

  return { ok: true, erfolg: gelungen, text, schaden, chance: round(p, 2), konflikt: c };
}

/* ==========================================================================
 * 7. Gespräche
 * ======================================================================== */

/**
 * Gesprächsthemen. `wirkung` = Moraldelta bei Erfolg, `risiko` = Chance,
 * dass es nach hinten losgeht (dann greift `wirkungFail`).
 */
export const GESPRAECHS_THEMEN = {
  leistung_lob: {
    name: 'Leistung loben',
    optionen: [
      { id: 'ehrlich', text: '„Das war ganz große Klasse. Genau so."', wirkung: 7, risiko: 0.08, dim: 'trainer', skill: 'motivation' },
      { id: 'sachlich', text: '„Ordentlich. Aber da geht noch mehr."', wirkung: 4, risiko: 0.18, dim: 'trainer', skill: 'motivation' },
      { id: 'oeffentlich', text: '„Ich werde das der Presse genau so sagen."', wirkung: 9, risiko: 0.30, dim: 'ambition', skill: 'medien' }
    ]
  },
  leistung_kritik: {
    name: 'Leistung kritisieren',
    optionen: [
      { id: 'ruhig', text: '„Wir beide wissen, dass das zu wenig war."', wirkung: 3, risiko: 0.20, dim: 'trainer', skill: 'motivation' },
      { id: 'deutlich', text: '„So spielt hier keiner. Punkt."', wirkung: 5, risiko: 0.42, dim: 'trainer', skill: 'motivation' },
      { id: 'video', text: '„Setz dich hin, wir schauen uns das gemeinsam an."', wirkung: 6, risiko: 0.16, dim: 'trainer', skill: 'training' }
    ]
  },
  spielzeit: {
    name: 'Über die Spielzeit reden',
    optionen: [
      { id: 'versprechen', text: '„Du spielst am Wochenende von Anfang an."', wirkung: 12, risiko: 0.36, dim: 'spielzeit', skill: 'motivation', verspricht: 'einsatz' },
      { id: 'geduld', text: '„Deine Zeit kommt. Arbeite weiter."', wirkung: 5, risiko: 0.22, dim: 'spielzeit', skill: 'motivation' },
      { id: 'ehrlich', text: '„Du bist im Moment die Nummer zwei. So ist es."', wirkung: 2, risiko: 0.30, dim: 'spielzeit', skill: 'medien' }
    ]
  },
  vertrag: {
    name: 'Vertragssituation',
    optionen: [
      { id: 'planen', text: '„Du bist Teil meiner Planung, das kannst du mir glauben."', wirkung: 8, risiko: 0.18, dim: 'ambition', skill: 'verhandlung' },
      { id: 'geld', text: '„Wir reden über eine Verbesserung, sobald die Zahlen es zulassen."', wirkung: 6, risiko: 0.28, dim: 'gehalt', skill: 'verhandlung' },
      { id: 'druck', text: '„Erst Leistung, dann Vertrag."', wirkung: 3, risiko: 0.40, dim: 'gehalt', skill: 'verhandlung' }
    ]
  },
  wechselwunsch: {
    name: 'Wechselwunsch',
    optionen: [
      { id: 'umstimmen', text: '„Ich brauche dich hier. Bleib."', wirkung: 11, risiko: 0.34, dim: 'ambition', skill: 'motivation', hebtWechselwunsch: true },
      { id: 'freigabe', text: '„Wenn ein gutes Angebot kommt, halte ich dich nicht auf."', wirkung: 5, risiko: 0.12, dim: 'trainer', skill: 'verhandlung' },
      { id: 'hart', text: '„Du hast einen Vertrag. Der wird erfüllt."', wirkung: -4, risiko: 0.55, dim: 'trainer', skill: 'verhandlung' }
    ]
  },
  form: {
    name: 'Formkrise ansprechen',
    optionen: [
      { id: 'rueckendeckung', text: '„Ich stelle dich weiter auf. Punkt."', wirkung: 9, risiko: 0.20, dim: 'trainer', skill: 'motivation' },
      { id: 'pause', text: '„Setz zwei Spiele aus, komm zur Ruhe."', wirkung: 4, risiko: 0.26, dim: 'spielzeit', skill: 'training' },
      { id: 'aufruetteln', text: '„Reiß dich zusammen, so verlierst du deinen Platz."', wirkung: 6, risiko: 0.45, dim: 'trainer', skill: 'motivation' }
    ]
  },
  verletzung: {
    name: 'Nach der Verletzung fragen',
    optionen: [
      { id: 'mitgefuehl', text: '„Lass dir alle Zeit, die du brauchst."', wirkung: 8, risiko: 0.06, dim: 'trainer', skill: 'motivation' },
      { id: 'tempo', text: '„Wir brauchen dich schnell zurück."', wirkung: 5, risiko: 0.35, dim: 'trainer', skill: 'training' }
    ]
  },
  kapitaen: {
    name: 'Über die Kapitänsbinde sprechen',
    optionen: [
      { id: 'binde_geben', text: '„Ab sofort trägst du die Binde."', wirkung: 14, risiko: 0.30, dim: 'ambition', skill: 'motivation', machtKapitaen: true },
      { id: 'vertroesten', text: '„Nächste Saison reden wir darüber."', wirkung: 3, risiko: 0.28, dim: 'ambition', skill: 'medien' },
      { id: 'absagen', text: '„Die Binde bleibt, wo sie ist."', wirkung: -3, risiko: 0.35, dim: 'ambition', skill: 'medien' }
    ]
  },
  disziplin: {
    name: 'Disziplin einfordern',
    optionen: [
      { id: 'verwarnung', text: '„Einmal noch, dann wird es teuer."', wirkung: 2, risiko: 0.30, dim: 'trainer', skill: 'motivation' },
      { id: 'strafe', text: '„Zwei Wochengehälter. Nächste Frage."', wirkung: -2, risiko: 0.48, dim: 'trainer', skill: 'taktik' },
      { id: 'verstaendnis', text: '„Erzähl mir, was wirklich los ist."', wirkung: 7, risiko: 0.22, dim: 'trainer', skill: 'motivation' }
    ]
  },
  motivation_vor_spiel: {
    name: 'Motivation vor dem Spiel',
    optionen: [
      { id: 'vertrauen', text: '„Heute zeigst du ihnen, wer du bist."', wirkung: 7, risiko: 0.10, dim: 'trainer', skill: 'motivation' },
      { id: 'auftrag', text: '„Du nimmst dir ihren Zehner. Sonst nichts."', wirkung: 5, risiko: 0.18, dim: 'trainer', skill: 'taktik' },
      { id: 'druck', text: '„Heute musst du liefern, sonst sitzt du nächste Woche."', wirkung: 6, risiko: 0.46, dim: 'trainer', skill: 'motivation' }
    ]
  },
  trost_nach_niederlage: {
    name: 'Trost nach der Niederlage',
    optionen: [
      { id: 'schulter', text: '„Kopf hoch. Das war nicht deine Schuld."', wirkung: 7, risiko: 0.10, dim: 'trainer', skill: 'motivation' },
      { id: 'analyse', text: '„Morgen schauen wir uns die Szene an, ohne Vorwürfe."', wirkung: 6, risiko: 0.14, dim: 'trainer', skill: 'training' },
      { id: 'schweigen', text: 'Nichts sagen, nur kurz die Hand auf die Schulter legen.', wirkung: 4, risiko: 0.08, dim: 'trainer', skill: null }
    ]
  }
};

/**
 * Liefert die Gesprächsoptionen für einen Spieler zu einem Thema —
 * inklusive geschätzter Wirkung und Risiko, angepasst an Persönlichkeit,
 * Moral und den Ruf des Managers.
 */
export function gespraech(state, playerId, thema) {
  const p = state.players[playerId];
  const t = GESPRAECHS_THEMEN[thema];
  if (!p) return { ok: false, text: 'Spieler unbekannt.', optionen: [] };
  if (!t) return { ok: false, text: `Unbekanntes Thema "${thema}".`, optionen: [] };

  const h = hp(p);
  const letzte = h.gespraeche[thema];
  const heute = state.date ? state.date.day + state.date.season * 365 : 0;
  const gesperrt = letzte !== undefined && heute - letzte < GESPRAECH_SPERRE_TAGE;

  const pers = persona(p);
  const optionen = t.optionen.map(o => {
    const mod = optionsMod(p, pers, o);
    return {
      id: o.id,
      text: o.text,
      wirkung: round(o.wirkung * mod.wirkung, 1),
      risiko: round(clamp(o.risiko * mod.risiko - erfolgsBonus(state, p) * 0.35, 0.02, 0.92), 2),
      hinweis: mod.hinweis
    };
  });

  return {
    ok: !gesperrt,
    thema, name: t.name,
    playerId, spieler: vollName(p),
    stimmung: moralText(p.morale !== undefined ? p.morale : MORAL_NEUTRAL),
    persoenlichkeit: pers.name,
    text: gesperrt
      ? `${name(p)} hat erst vor Kurzem mit Ihnen über dieses Thema gesprochen. Zu viel Reden macht das Reden billig.`
      : gespraechsEinstieg(p, thema),
    optionen
  };
}

/** Persönlichkeitsabhängige Anpassung einer Option. */
function optionsMod(p, pers, o) {
  let wirkung = 1, risiko = 1, hinweis = null;
  const hart = ['deutlich', 'hart', 'druck', 'strafe', 'aufruetteln', 'absagen'].includes(o.id);
  const weich = ['schulter', 'mitgefuehl', 'verstaendnis', 'rueckendeckung', 'schweigen', 'geduld'].includes(o.id);

  switch (pers.id) {
    case 'schwierig':
      if (hart) { risiko *= 1.5; wirkung *= 0.7; hinweis = 'Schwieriger Charakter — harte Ansagen gehen oft nach hinten los.'; }
      if (weich) { wirkung *= 1.15; }
      break;
    case 'ehrgeizig':
      if (o.dim === 'spielzeit') { wirkung *= 1.25; risiko *= 1.2; hinweis = 'Ehrgeizig — Spielzeit ist bei ihm das Thema.'; }
      if (hart) wirkung *= 1.15;
      break;
    case 'geldgierig':
      if (o.dim === 'gehalt') { wirkung *= 1.35; hinweis = 'Am Ende entscheidet bei ihm das Geld.'; }
      if (o.dim === 'trainer') wirkung *= 0.8;
      break;
    case 'loyal':
      if (o.id === 'umstimmen' || o.id === 'planen') { wirkung *= 1.4; risiko *= 0.6; hinweis = 'Vereinstreu — er will überzeugt werden.'; }
      break;
    case 'gelassen':
      wirkung *= 0.7; risiko *= 0.55; hinweis = 'Gelassen — bei ihm bewegt sich wenig, in beide Richtungen.';
      break;
    case 'profi':
      if (o.dim === 'trainer' || o.skill === 'training') { wirkung *= 1.2; risiko *= 0.7; hinweis = 'Musterprofi — sachliche Argumente ziehen.'; }
      break;
    case 'fuehrungstyp':
      if (o.machtKapitaen) { wirkung *= 1.5; risiko *= 0.6; hinweis = 'Geborener Anführer.'; }
      break;
  }
  if ((p.traits || []).includes('mimose')) { wirkung *= 1.3; risiko *= 1.35; hinweis = hinweis || 'Mimose — reagiert auf alles doppelt so stark.'; }
  if ((p.traits || []).includes('eisblock')) { risiko *= 0.7; }
  if ((p.morale || 60) < 30 && hart) { risiko *= 1.3; hinweis = hinweis || 'Seine Moral ist am Boden — Druck könnte ihn brechen.'; }
  return { wirkung, risiko, hinweis };
}

function erfolgsBonus(state, p) {
  const s = state.manager.skills || {};
  return clamp(((s.motivation || 45) - 45) / 100 * MOTIVATION_GEWICHT
    + ((state.manager.reputation || 40) - 40) / 100 * RUF_GEWICHT, -0.35, 0.45);
}

function gespraechsEinstieg(p, thema) {
  const n = vollName(p);
  switch (thema) {
    case 'leistung_lob': return `${n} klopft sich noch den Rasen von der Hose, als Sie ihn ins Büro bitten.`;
    case 'leistung_kritik': return `${n} weiß, warum er hier ist. Er setzt sich hin und schaut Sie an.`;
    case 'spielzeit': return `${n} steht in der Tür. „Trainer, wir müssen über meine Situation reden."`;
    case 'vertrag': return `${n} kommt mit seinem Berater. Der Berater lächelt zu viel.`;
    case 'wechselwunsch': return `${n} hat um das Gespräch gebeten. Sein Koffer steht bildlich schon im Flur.`;
    case 'form': return `${n} findet seit Wochen nicht statt und weiß das selbst am besten.`;
    case 'verletzung': return `${n} humpelt herein, Eisbeutel am Knie, und versucht zu grinsen.`;
    case 'kapitaen': return `${n} fragt, wie Sie eigentlich zur Kapitänsfrage stehen.`;
    case 'disziplin': return `${n} kommt zehn Minuten zu spät zum Gespräch über seine Disziplin.`;
    case 'motivation_vor_spiel': return `Zwanzig Minuten vor dem Anpfiff nehmen Sie ${n} kurz beiseite.`;
    case 'trost_nach_niederlage': return `${n} sitzt in der Kabine, das Trikot noch an, und starrt auf den Boden.`;
    default: return `${n} nimmt Platz.`;
  }
}

/**
 * Führt ein Gespräch. -> { ok, text, ergebnis, delta, chance }
 * ergebnis: 'gelungen' | 'neutral' | 'daneben'
 */
export function gespraechFuehren(state, playerId, thema, optionId) {
  const p = state.players[playerId];
  const t = GESPRAECHS_THEMEN[thema];
  if (!p) return { ok: false, text: 'Spieler unbekannt.' };
  if (!t) return { ok: false, text: `Unbekanntes Thema "${thema}".` };
  const o = t.optionen.find(x => x.id === optionId);
  if (!o) return { ok: false, text: 'Diese Option gibt es nicht.' };

  const h = hp(p);
  const heute = state.date ? state.date.day + state.date.season * 365 : 0;
  if (h.gespraeche[thema] !== undefined && heute - h.gespraeche[thema] < GESPRAECH_SPERRE_TAGE) {
    return { ok: false, text: `${name(p)} winkt ab: „Das hatten wir doch gerade erst, Trainer."` };
  }
  h.gespraeche[thema] = heute;

  const club = p.clubId ? state.clubs[p.clubId] : null;
  const pers = persona(p);
  const mod = optionsMod(p, pers, o);
  const rng = localRng(state, club, 'gespraech:' + playerId + ':' + thema + ':' + optionId);

  const risiko = clamp(o.risiko * mod.risiko - erfolgsBonus(state, p) * 0.35, 0.02, 0.92);
  const roll = rng.next();
  let ergebnis, delta;
  if (roll < risiko) {
    ergebnis = 'daneben';
    delta = -Math.abs(o.wirkung * mod.wirkung) * 0.85 - 2;
  } else if (roll < risiko + 0.20) {
    ergebnis = 'neutral';
    delta = o.wirkung * mod.wirkung * 0.30;
  } else {
    ergebnis = 'gelungen';
    delta = o.wirkung * mod.wirkung;
  }
  delta *= (pers.moraleSwing || 1);

  // Anwendung
  p.morale = clamp(round((p.morale !== undefined ? p.morale : MORAL_NEUTRAL) + delta, 1), MORAL_MIN, MORAL_MAX);
  if (o.dim && h[o.dim] !== undefined) h[o.dim] = clamp(round(h[o.dim] + delta * 0.8, 1), 0, 100);
  h.trainer = clamp(round(h.trainer + delta * 0.5, 1), 0, 100);

  // Sonderwirkungen
  let extra = '';
  if (ergebnis !== 'daneben' && o.hebtWechselwunsch && p.transfer) {
    p.transfer.wunschWechsel = false;
    extra = ' Der Wechselwunsch ist vom Tisch — vorerst.';
  }
  if (ergebnis === 'gelungen' && o.machtKapitaen && club) {
    kapitaenBestimmen(state, club.id, p.id);
    extra = ' Die Binde wechselt den Besitzer.';
  }
  if (o.verspricht === 'einsatz') {
    h.versprechen = { art: 'einsatz', tag: heute, eingeloest: false };
    extra += ' Sie haben ihm einen Startelfeinsatz zugesagt. Er wird sich daran erinnern.';
  }

  const text = gespraechsAusgang(p, thema, o, ergebnis) + extra;
  return { ok: true, ergebnis, delta: round(delta, 1), chance: round(1 - risiko, 2), text, moral: p.morale };
}

function gespraechsAusgang(p, thema, o, ergebnis) {
  const n = name(p);
  if (ergebnis === 'gelungen') {
    const varianten = [
      `${n} nickt, steht auf und geht mit geradem Rücken raus. Das hat gesessen.`,
      `Man sieht ${n} an, dass er das hören musste. „Alles klar, Trainer."`,
      `${n} sagt wenig, aber im Training am nächsten Morgen sagt er umso mehr.`
    ];
    return varianten[Math.abs(hashString(p.id + thema + o.id)) % varianten.length];
  }
  if (ergebnis === 'neutral') {
    return `${n} hört zu, nickt höflich und sagt: „Ja, gut." Ob davon irgendetwas hängen geblieben ist, wird man sehen.`;
  }
  const varianten = [
    `${n} zieht die Augenbrauen hoch. „Ist das Ihr Ernst?" Dann steht er auf und geht, ohne die Tür zu schließen.`,
    `Das war ein Fehler. ${n} lässt Sie ausreden, sagt keinen Ton und ist danach nicht mehr derselbe.`,
    `${n} lacht kurz und freudlos. „Danke für das Gespräch, Trainer." Beim Rausgehen tritt er gegen den Papierkorb.`
  ];
  return varianten[Math.abs(hashString(p.id + thema + o.id + 'x')) % varianten.length];
}

/* ==========================================================================
 * 8. Ansprachen
 * ======================================================================== */

export const ANSPRACHE_ARTEN = {
  aufbauend: { name: 'Aufbauend', desc: 'Mut machen, Rücken stärken.' },
  fordernd: { name: 'Fordernd', desc: 'Mehr verlangen, Erwartung hochhalten.' },
  ruhig: { name: 'Ruhig', desc: 'Sachlich runterkommen, Ordnung halten.' },
  wuetend: { name: 'Wütend', desc: 'Alles rauslassen. Hohe Wirkung, hohes Risiko.' },
  sachlich: { name: 'Sachlich', desc: 'Nur Taktik, keine Emotion.' },
  emotional: { name: 'Emotional', desc: 'Ans Herz gehen, Verein, Fans, Stolz.' }
};

/**
 * Kabinen-Ansprache.
 * @param {string} zeitpunkt 'vorspiel' | 'halbzeit' | 'nachspiel'
 * @param {string} art       Schlüssel aus ANSPRACHE_ARTEN
 * @param {object} [kontext] { stand:[eigene,fremde], gegnerId, heim, minute }
 * -> { ok, wirkung:{ [playerId]: moralDelta }, text, teamMoralDelta }
 */
export function ansprache(state, clubId, zeitpunkt, art, kontext) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Verein unbekannt.', wirkung: {}, teamMoralDelta: 0 };
  if (!ANSPRACHE_ARTEN[art]) return { ok: false, text: `Unbekannte Ansprache "${art}".`, wirkung: {}, teamMoralDelta: 0 };

  const k = kabine(club);
  const spieler = squadOf(state, club);
  if (!spieler.length) return { ok: false, text: 'Kein Kader vorhanden.', wirkung: {}, teamMoralDelta: 0 };

  const ktx = kontext || {};
  const stand = Array.isArray(ktx.stand) ? ktx.stand : [0, 0];
  const diff = stand[0] - stand[1];
  const gegner = ktx.gegnerId ? state.clubs[ktx.gegnerId] : null;
  const repDiff = ((gegner ? gegner.reputation : club.reputation) || 50) - (club.reputation || 50);
  // -1 = klarer Außenseiter uns gegenüber (wir Favorit), +1 = Übermacht
  const gegnerStaerke = clamp(repDiff / 25, -1, 1);
  const teamMoral = avg(spieler, p => (p.morale !== undefined ? p.morale : MORAL_NEUTRAL));

  const passung = anspracheFit(art, zeitpunkt, diff, gegnerStaerke, teamMoral);

  const skills = state.manager.skills || {};
  const skillBonus = ((skills.motivation || 45) - 50) / 100 + ((state.manager.reputation || 40) - 45) / 200;
  const rng = localRng(state, club, 'ansprache:' + zeitpunkt + ':' + art);
  const wuerfel = rng.gauss(0, 0.22);

  const gesamt = clamp(passung + skillBonus + wuerfel, -1.3, 1.3);
  const basisDelta = gesamt * ANSPRACHE_MAX_DELTA;

  const wirkung = {};
  const startelf = new Set();
  if (club.tactics && club.tactics.lineup) for (const s in club.tactics.lineup) startelf.add(club.tactics.lineup[s]);

  for (const p of spieler) {
    const pers = persona(p);
    let f = 1;
    // Persönlichkeiten reagieren unterschiedlich auf dieselben Worte
    if (art === 'wuetend') {
      f *= pers.id === 'schwierig' ? 0.5 : pers.id === 'ehrgeizig' ? 1.25 : pers.id === 'gelassen' ? 0.4 : 1;
      if ((p.traits || []).includes('mimose')) f *= 0.35;
      if ((p.attributes || {}).nervenstaerke > 75) f *= 1.15;
    } else if (art === 'emotional') {
      f *= pers.id === 'loyal' ? 1.4 : pers.id === 'geldgierig' ? 0.45 : 1;
      const jahre = (state.date ? state.date.season : 1) - ((p.joined && p.joined.season) || 1);
      f *= 1 + clamp(jahre / 8, 0, 0.4);
    } else if (art === 'fordernd') {
      f *= pers.id === 'ehrgeizig' ? 1.3 : pers.id === 'profi' ? 1.15 : pers.id === 'gelassen' ? 0.7 : 1;
    } else if (art === 'aufbauend') {
      f *= (p.morale || 60) < 45 ? 1.35 : 0.9;
      if ((p.traits || []).includes('mimose')) f *= 1.3;
    } else if (art === 'sachlich') {
      f *= pers.id === 'profi' ? 1.3 : 0.85;
      f *= 1 + clamp(((p.attributes || {}).uebersicht - 55) / 120, -0.2, 0.3);
    } else if (art === 'ruhig') {
      f *= pers.id === 'gelassen' ? 1.3 : pers.id === 'ehrgeizig' ? 0.75 : 1;
    }
    f *= pers.moraleSwing || 1;
    if (!startelf.size || startelf.has(p.id)) f *= 1; else f *= 0.55;

    const d = round(basisDelta * f, 1);
    wirkung[p.id] = d;
    p.morale = clamp(round((p.morale !== undefined ? p.morale : MORAL_NEUTRAL) + d, 1), MORAL_MIN, MORAL_MAX);
  }

  const teamMoralDelta = round(avg(Object.values(wirkung)), 2);
  club.moral = round(avg(spieler, p => p.morale), 1);
  k.letzteAnsprache = { tag: state.date ? state.date.day : 0, zeitpunkt, art, delta: teamMoralDelta };

  return {
    ok: true,
    wirkung,
    teamMoralDelta,
    passung: round(passung, 2),
    text: anspracheText(state, club, zeitpunkt, art, diff, gegner, gesamt)
  };
}

/**
 * Bewertet, ob die Ansprache zur Lage passt. -> ca. -1 (Katastrophe) … +1 (perfekt)
 * Kernidee: Wütend gegen einen Kleinen bei Rückstand zündet.
 * Wütend bei Führung gegen Bayern zerstört die Nerven.
 */
function anspracheFit(art, zeitpunkt, diff, gegnerStaerke, teamMoral) {
  const rueckstand = diff < 0, fuehrung = diff > 0, remis = diff === 0;
  const klarUnterlegen = gegnerStaerke > 0.35;
  const favorit = gegnerStaerke < -0.35;
  const moralTief = teamMoral < 45, moralHoch = teamMoral > 75;
  let f = 0;

  switch (art) {
    case 'wuetend':
      if (rueckstand && favorit) f = 0.85;                 // 0:1 gegen den Aufsteiger — jetzt darf es knallen
      else if (rueckstand && klarUnterlegen) f = -0.55;    // gegen Bayern hinten: Wut hilft niemandem
      else if (rueckstand) f = 0.25;
      else if (fuehrung) f = -0.60;
      else if (remis && favorit) f = 0.35;
      else f = -0.20;
      if (moralTief) f -= 0.35;                            // eine gebrochene Mannschaft verträgt kein Gebrüll
      if (zeitpunkt === 'vorspiel') f *= 0.6;
      if (zeitpunkt === 'nachspiel' && rueckstand) f *= 0.7;
      break;
    case 'aufbauend':
      if (rueckstand && klarUnterlegen) f = 0.85;
      else if (rueckstand) f = 0.55;
      else if (moralTief) f = 0.65;
      else if (fuehrung) f = 0.15;
      else f = 0.35;
      if (moralHoch) f -= 0.25;                            // wer brennt, braucht kein Streicheln
      break;
    case 'fordernd':
      if (remis && favorit) f = 0.75;
      else if (fuehrung && favorit) f = 0.55;
      else if (remis) f = 0.40;
      else if (rueckstand && klarUnterlegen) f = -0.35;
      else if (rueckstand) f = 0.20;
      else f = 0.15;
      if (moralTief) f -= 0.30;
      break;
    case 'ruhig':
      if (fuehrung) f = 0.70;                              // Vorsprung verwalten
      else if (remis && klarUnterlegen) f = 0.55;
      else if (rueckstand) f = 0.05;
      else f = 0.30;
      if (moralHoch && rueckstand) f -= 0.2;
      break;
    case 'sachlich':
      f = 0.35;                                            // fast nie falsch, nie großartig
      if (zeitpunkt === 'halbzeit') f += 0.20;
      if (moralTief) f -= 0.15;
      break;
    case 'emotional':
      if (rueckstand && klarUnterlegen) f = 0.80;          // David gegen Goliath
      else if (zeitpunkt === 'vorspiel' && klarUnterlegen) f = 0.75;
      else if (fuehrung && favorit) f = -0.30;             // Pathos beim 3:0 gegen den Kleinen wirkt lächerlich
      else if (remis) f = 0.35;
      else f = 0.25;
      if (moralHoch) f += 0.15;
      break;
  }
  if (zeitpunkt === 'nachspiel') f *= 0.75;                // hinterher wirkt alles gedämpfter
  return clamp(f, -1, 1);
}

function anspracheText(state, club, zeitpunkt, art, diff, gegner, gesamt) {
  const gut = gesamt > 0.35, schlecht = gesamt < -0.15;
  const wo = zeitpunkt === 'vorspiel' ? 'Vor dem Anpfiff' : zeitpunkt === 'halbzeit' ? 'In der Halbzeitpause' : 'Nach dem Schlusspfiff';
  const lage = diff > 0 ? 'in Führung' : diff < 0 ? 'im Rückstand' : 'beim Remis';
  const g = gegner ? (gegner.shortName || gegner.name) : 'den Gegner';

  const kern = {
    wuetend: `${wo} fliegt die Taktiktafel. Sie schreien sich die Seele aus dem Leib, ${lage} gegen ${g}.`,
    aufbauend: `${wo} gehen Sie durch die Kabine, klopfen jedem auf die Schulter und reden von Vertrauen.`,
    fordernd: `${wo} stellen Sie sich in die Mitte und fordern mehr. Deutlich mehr.`,
    ruhig: `${wo} sprechen Sie leise. So leise, dass alle sich vorbeugen müssen.`,
    sachlich: `${wo} zeichnen Sie zwei Pfeile auf die Tafel und erklären, was schiefläuft.`,
    emotional: `${wo} reden Sie über den Verein, über die Kurve, über die Leute, die für dieses Trikot bezahlen.`
  }[art];

  const ende = gut
    ? 'Die Mannschaft steht auf, bevor Sie fertig sind. Das hat gezündet.'
    : schlecht
      ? 'Elf Augenpaare schauen an Ihnen vorbei. Das war die falsche Tonlage zur falschen Zeit.'
      : 'Die Mannschaft nickt. Mehr aber auch nicht.';
  return `${kern} ${ende}`;
}

/* ==========================================================================
 * 9. Kapitän & Mannschaftsrat
 * ======================================================================== */

/**
 * Ernennt einen neuen Kapitän. -> { ok, text, alt, neu, wirkung }
 */
export function kapitaenBestimmen(state, clubId, playerId) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Verein unbekannt.' };
  const p = state.players[playerId];
  if (!p || p.clubId !== clubId) return { ok: false, text: 'Dieser Spieler gehört nicht zum Kader.' };

  const spieler = squadOf(state, club);
  const alt = spieler.find(x => x.captain) || null;
  if (alt && alt.id === p.id) return { ok: false, text: `${name(p)} ist bereits Kapitän.` };

  const hier = hierarchie(state, clubId);
  const neuRang = hier.find(h => h.playerId === p.id);
  const einfluss = neuRang ? neuRang.einfluss : 40;

  for (const x of spieler) x.captain = false;
  p.captain = true;
  if (club.tactics) {
    if (!club.tactics.setPieces) club.tactics.setPieces = {};
    club.tactics.setPieces.kapitaen = p.id;
  }
  kabine(club).hierarchieTag = -999;

  // Wirkung: passt der Neue in die Hackordnung?
  const wirkung = {};
  const akzeptanz = clamp((einfluss - 45) / 45, -1, 1);
  p.morale = clamp(round((p.morale || MORAL_NEUTRAL) + 8, 1), MORAL_MIN, MORAL_MAX);
  wirkung[p.id] = 8;
  if (alt) {
    const d = -10 * (persona(alt).moraleSwing || 1);
    alt.morale = clamp(round((alt.morale || MORAL_NEUTRAL) + d, 1), MORAL_MIN, MORAL_MAX);
    wirkung[alt.id] = round(d, 1);
  }
  for (const x of spieler) {
    if (x === p || x === alt) continue;
    const d = akzeptanz * 2.2;
    x.morale = clamp(round((x.morale || MORAL_NEUTRAL) + d, 1), MORAL_MIN, MORAL_MAX);
    wirkung[x.id] = round(d, 1);
  }
  club.moral = round(avg(spieler, x => x.morale), 1);

  const text = akzeptanz > 0.3
    ? `${vollName(p)} ist neuer Kapitän. In der Kabine hat das niemanden überrascht — es war ohnehin längst so.` +
      (alt ? ` ${vollName(alt)} hat die Binde wortlos übergeben und danach zwei Tage lang nichts gesagt.` : '')
    : akzeptanz < -0.3
      ? `${vollName(p)} trägt ab sofort die Binde. Die Mannschaft nimmt es zur Kenntnis — mehrere Spieler mit erkennbarem Unverständnis. ` +
        `Er hat in dieser Kabine schlicht nicht das Standing.`
      : `${vollName(p)} ist neuer Kapitän.` + (alt ? ` ${vollName(alt)} verliert die Binde und wird das nicht vergessen.` : '');

  return { ok: true, text, alt: alt ? alt.id : null, neu: p.id, wirkung, akzeptanz: round(akzeptanz, 2) };
}

/**
 * Der Mannschaftsrat — die vier bis fünf einflussreichsten Spieler.
 * -> { mitglieder:[{playerId,name,rang,einfluss}], staerke, text }
 */
export function mannschaftsrat(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { mitglieder: [], staerke: 0, text: 'Verein unbekannt.' };
  const hier = hierarchie(state, clubId);
  const mitglieder = hier.filter(h => h.rang === 'kapitaen' || h.rang === 'fuehrungsspieler').slice(0, 5);
  const k = kabine(club);
  k.mannschaftsrat = mitglieder.map(m => m.playerId);

  const staerke = mitglieder.length ? round(avg(mitglieder, m => m.einfluss), 1) : 0;
  let text;
  if (!mitglieder.length) {
    text = 'Es gibt keinen Mannschaftsrat. Niemand in diesem Kader traut sich, den Mund aufzumachen.';
  } else if (staerke > 65) {
    text = `Ein starker Mannschaftsrat um ${mitglieder.map(m => m.name).join(', ')}. ` +
      `Diese Männer regeln vieles, bevor es überhaupt bei Ihnen ankommt — im Guten wie im Schlechten.`;
  } else if (staerke > 45) {
    text = `Der Rat (${mitglieder.map(m => m.name).join(', ')}) funktioniert ordentlich, hat aber wenig Durchgriff.`;
  } else {
    text = `Der Mannschaftsrat besteht formal aus ${mitglieder.map(m => m.name).join(', ')}. ` +
      `Gehört wird auf keinen von ihnen richtig.`;
  }
  return { mitglieder, staerke, text };
}

/* ==========================================================================
 * 10. Leistungswirkung
 * ======================================================================== */

/**
 * DER Hebel: Wie stark schlägt die Kabinensituation auf den Platz durch?
 * -> Faktor 0,85 … 1,12 (multiplikativ auf die Spielerleistung).
 *
 * Zusätzlich zu engine/ratings.js — dort steckt die reine Moralzahl bereits
 * mit ±5 % drin. Dieser Faktor bringt Konflikte, Streik, Teamgeist,
 * Kapitänsamt und Persönlichkeit obendrauf.
 */
export function moralEffektAufLeistung(state, playerId) {
  const p = state.players[playerId];
  if (!p) return 1;
  const club = p.clubId ? state.clubs[p.clubId] : null;
  const moral = clamp(p.morale !== undefined ? p.morale : MORAL_NEUTRAL, MORAL_MIN, MORAL_MAX);

  let abweichung = ((moral - MORAL_NEUTRAL) / 100) * LEISTUNG_GAIN;

  if (club) {
    const k = kabine(club);
    const tg = k.teamgeist !== undefined ? k.teamgeist : 60;
    abweichung += ((tg - 60) / 100) * LEISTUNG_TEAMGEIST;

    const meine = konflikteVon(club, p.id);
    if (meine.length) {
      let mal = 0;
      for (const c of meine) mal += LEISTUNG_KONFLIKT_JE * (c.schwere || 1);
      abweichung += Math.max(LEISTUNG_KONFLIKT_MAX, mal);
    }
    if (k.streikTage > 0) abweichung += LEISTUNG_STREIK;
  }

  if (p.captain) abweichung += LEISTUNG_KAPITAEN;
  const traits = p.traits || [];
  if (traits.includes('leader') || traits.includes('kabinenleader')) abweichung += LEISTUNG_LEADER;
  if (traits.includes('mimose')) abweichung *= LEISTUNG_MIMOSE;
  if (traits.includes('eisblock') && abweichung < 0) abweichung *= 0.7;

  return round(clamp(1 + abweichung, LEISTUNG_MIN, LEISTUNG_MAX), 4);
}

/* ==========================================================================
 * 11. Kabinenbericht
 * ======================================================================== */

/**
 * Der Wochenbericht des Co-Trainers: alles, was in der Kabine los ist.
 * -> { teamgeist, moralSchnitt, kapitaen, hierarchie, konflikte, cliquen,
 *      sorgenkinder, stuetzen, freundschaften, zeilen:[deutsche Strings] }
 */
export function kabinenBericht(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { zeilen: ['Verein unbekannt.'] };
  const spieler = squadOf(state, club);
  const tg = teamGeist(state, clubId);
  const hier = hierarchie(state, clubId);
  const bez = beziehungenCache(state, club);
  const k = kabine(club);
  const rat = mannschaftsrat(state, clubId);
  const offen = k.konflikte.filter(c => c.status === 'offen');

  const sorgen = sortBy(spieler.filter(p => (p.morale || 60) < 45), p => (p.morale || 60)).slice(0, 5);
  const stuetzen = sortBy(spieler.filter(p => (p.morale || 60) > 75), p => ({ key: p.morale || 60, desc: true })).slice(0, 5);
  const kap = hier.find(h => h.rang === 'kapitaen');

  const zeilen = [];
  zeilen.push(`Teamgeist: ${Math.round(tg.wert)} von 100. Durchschnittliche Moral: ${Math.round(tg.moralSchnitt)}.`);
  zeilen.push(tg.text);
  zeilen.push(kap
    ? `Kapitän ist ${vollName(state.players[kap.playerId])} (Einfluss ${Math.round(kap.einfluss)}).`
    : 'Diese Mannschaft hat keinen Kapitän. Das sollten Sie ändern.');
  zeilen.push(rat.text);

  if (offen.length) {
    zeilen.push(`Offene Baustellen (${offen.length}):`);
    for (const c of offen.slice(0, 4)) {
      const wer = c.playerIds.map(id => name(state.players[id])).filter(Boolean).join(' / ');
      zeilen.push(`• ${c.titel} — ${wer} (Schwere ${c.schwere}/3, seit ${Math.max(0, (state.date.day - c.tag))} Tagen)`);
    }
  } else {
    zeilen.push('Keine offenen Konflikte. Genießen Sie es, das hält nie lange.');
  }

  if (sorgen.length) {
    zeilen.push('Sorgenkinder: ' + sorgen.map(p => `${name(p)} (${Math.round(p.morale)}, ${moralText(p.morale)})`).join(', ') + '.');
    const erste = moralWert(state, sorgen[0].id);
    if (erste.gruende.length) zeilen.push(`Zu ${name(sorgen[0])}: ${erste.gruende[0]}`);
  }
  if (stuetzen.length) {
    zeilen.push('In Topstimmung: ' + stuetzen.map(p => `${name(p)} (${Math.round(p.morale)})`).join(', ') + '.');
  }
  if (tg.cliquen.length) {
    zeilen.push('Grüppchen: ' + tg.cliquen.map(c => c.label).join(', ') + '.');
  }
  const dickeFreunde = bez.paare.filter(x => x.art === 'freundschaft').slice(0, 2);
  for (const f of dickeFreunde) zeilen.push(f.text);
  const eiszeit = bez.paare.filter(x => x.art === 'konflikt').slice(0, 2);
  for (const f of eiszeit) zeilen.push(f.text);
  if (k.streikTage > 0) zeilen.push(`ACHTUNG: Die Mannschaft streikt noch ${k.streikTage} Tag(e).`);

  return {
    clubId,
    teamgeist: tg.wert,
    moralSchnitt: tg.moralSchnitt,
    kapitaen: kap ? kap.playerId : null,
    hierarchie: hier,
    mannschaftsrat: rat.mitglieder,
    konflikte: offen,
    cliquen: tg.cliquen,
    freundschaften: bez.paare.filter(x => x.art === 'freundschaft'),
    rivalitaeten: bez.paare.filter(x => x.art === 'konflikt'),
    sorgenkinder: sorgen.map(p => p.id),
    stuetzen: stuetzen.map(p => p.id),
    streikTage: k.streikTage,
    zeilen,
    text: zeilen.join('\n')
  };
}

/* ==========================================================================
 * 12. Nebeneingänge für andere Module
 * ======================================================================== */

/** Direkter Moralstoß (z. B. aus medical.js oder board.js). */
export function moralAendern(state, playerId, delta, grund) {
  const p = state.players[playerId];
  if (!p) return { ok: false, text: 'Spieler unbekannt.' };
  const d = delta * (persona(p).moraleSwing || 1);
  p.morale = clamp(round((p.morale !== undefined ? p.morale : MORAL_NEUTRAL) + d, 1), MORAL_MIN, MORAL_MAX);
  if (grund) {
    const h = hp(p);
    h.beschwerden.push({ tag: state.date ? state.date.day : 0, saison: state.date ? state.date.season : 1, text: grund });
    if (h.beschwerden.length > 8) h.beschwerden.shift();
  }
  return { ok: true, moral: p.morale, delta: round(d, 1), text: grund || '' };
}

/** Teamweiter Moralstoß (Meisterschaft, Abstieg, Trainerentlassung …). */
export function teamMoralAendern(state, clubId, delta, grund) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Verein unbekannt.' };
  const spieler = squadOf(state, club);
  for (const p of spieler) {
    p.morale = clamp(round((p.morale !== undefined ? p.morale : MORAL_NEUTRAL) + delta * (persona(p).moraleSwing || 1), 1), MORAL_MIN, MORAL_MAX);
  }
  club.moral = spieler.length ? round(avg(spieler, p => p.morale), 1) : club.moral;
  return { ok: true, moral: club.moral, text: grund || '' };
}

/** Offene Konflikte eines Vereins (für Screens). */
export function offeneKonflikte(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return [];
  return kabine(club).konflikte.filter(c => c.status === 'offen');
}
