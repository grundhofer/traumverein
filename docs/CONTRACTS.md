# ANSTOSS-LIKE — Technische Verträge (Single Source of Truth)

**Projekt:** „Traumverein" — ein Fußballmanager im Geist von Anstoss 1/2.
**Stack:** Vanilla JavaScript (ES-Module), kein Build-Step, keine Dependencies, Canvas 2D.
**Sprache im Code:** Bezeichner englisch/deutsch gemischt wie hier spezifiziert — **exakt** an diese Verträge halten.
**Alle sichtbaren Texte: DEUTSCH.**

---

## 0. Harte Regeln für alle Module

1. **Keine externen Abhängigkeiten.** Kein npm, kein CDN, kein `fetch()` auf fremde Hosts.
2. **Nur ES-Module.** `export function ...` / `import { x } from '../core/rng.js'` — immer mit `.js`-Endung, immer relative Pfade.
3. **Kein Zufall außerhalb der RNG.** `Math.random()` ist **verboten**. Immer `rng` aus `core/rng.js` benutzen (deterministische Savegames).
4. **Kein `Date.now()`** in Simulationslogik. Spielzeit kommt aus `state.date`.
5. **Jede Datei exportiert nur, was der Vertrag nennt** — plus frei wählbare Hilfsfunktionen.
6. **Keine DOM-Zugriffe in `engine/`, `club/`, `data/`, `core/`.** Diese Schichten sind rein funktional/testbar.
7. **Nur die eigene(n) Datei(en) anlegen.** Niemals fremde Module überschreiben.
8. Werte in **Euro** (Zahl, keine Strings), Prozentwerte als `0..100`, Wahrscheinlichkeiten als `0..1`.
9. Am Ende jeder Datei: `node --check <datei>` muss sauber laufen.

---

## 1. Koordinatensysteme

- **Taktikbrett / Formationen:** `x` = 0 (linker Rand) … 100 (rechter Rand), `y` = 0 (eigenes Tor) … 100 (gegnerisches Tor).
- **Spielfeld-Rendering & Match-Engine:** Meter. `x` = 0 … 105 (Heim greift Richtung +x an), `y` = 0 … 68. Mittelpunkt `(52.5, 34)`. Heim-Tor bei `x=0`, Gäste-Tor bei `x=105`. Strafraum: `x<16.5` bzw. `x>88.5`, `y` 13.84…54.16.

---

## 2. `core/rng.js` (EXISTIERT BEREITS — nur benutzen)

```js
export function createRng(seed)         // -> Rng
// Rng-API:
rng.next()                    // float [0,1)
rng.int(minIncl, maxIncl)     // ganze Zahl
rng.float(min, max)
rng.chance(p)                 // bool, p in 0..1
rng.pick(array)               // Element
rng.pickWeighted(items, wFn)  // Element, wFn(item)->number
rng.shuffle(array)            // neues Array
rng.gauss(mean, sd)           // normalverteilt
rng.fork(label)               // -> neue, unabhängige Rng (deterministisch abgeleitet)
rng.state() / rng.setState(s) // für Savegames
```

## 3. `core/util.js` (EXISTIERT BEREITS)

```js
export const clamp(v,min,max)
export const lerp(a,b,t)
export const round(v,decimals=0)
export const sum(arr, fn?)
export const avg(arr, fn?)
export const groupBy(arr, keyFn)
export const sortBy(arr, ...keyFns)       // aufsteigend; keyFn kann {key, desc:true} zurückgeben — siehe Datei
export const formatMoney(v)               // "1,25 Mio €" / "850 Tsd €" / "12.500 €"
export const formatDate(dayIndex, season) // "Sa, 12. August 2025"
export const slug(str)
export const deepClone(obj)
export const uid(prefix, rng)
```

## 4. `core/constants.js` (EXISTIERT BEREITS)

Enthält u. a.:
```js
export const POSITIONS      // ['TW','IV','LV','RV','DM','ZM','LM','RM','OM','LA','RA','ST']
export const POSITION_NAMES // { TW:'Torwart', IV:'Innenverteidiger', ... }
export const POSITION_GROUP // { TW:'TW', IV:'ABW', ..., ST:'STU' }
export const ATTRIBUTES     // Liste aller Attribut-Keys (siehe Player unten)
export const ATTRIBUTE_NAMES// deutsche Labels
export const DIFFICULTIES   // { amateur:{...}, profi:{...}, weltklasse:{...}, legende:{...} }
export const MATCH_VIEW     // { TEXT:'text', HIGHLIGHTS:'highlights', FULL:'full' }
export const TRAITS         // { elfmeterkiller:{ name, desc, effect }, ... }
export const SEASON_DAYS    // 365
```

---

## 5. Datenmodell

### 5.1 Player

```js
{
  id: 'p_bayern_beckenbauer',      // stabil, kebab, eindeutig über das ganze Spiel
  firstName: 'Franz',
  lastName: 'Beckenbauer',
  shortName: 'Beckenbauer',        // Anzeige im Spielbericht
  clubId: 'bayern',
  nationality: 'DE',               // ISO-2
  age: 27,                         // Alter zum Startzeitpunkt (Saison 1)
  era: 'legend' | 'modern',        // Legende (historisch) oder aktueller/jüngst aktiver Spieler
  eraLabel: 'Ära 1974',            // nur bei era:'legend', sonst null
  position: 'IV',                  // Hauptposition
  altPositions: ['DM','ZM'],       // 0..3 Nebenpositionen (ohne Hauptposition)
  attributes: {                    // ALLE Keys, jeweils 1..99
    schuss, technik, passspiel, dribbling, kopfball, standards,
    tempo, ausdauer, koerper, sprungkraft,
    uebersicht, positionsspiel, zweikampf, aggressivitaet, nervenstaerke, fuehrung,
    reflexe, stellungsspiel, strafraumbeherrschung, abschlag   // Torwart-Attribute; bei Feldspielern 5..25
  },
  potential: 88,                   // 1..99, >= aktuelles Overall
  foot: 'rechts' | 'links' | 'beidfüßig',
  traits: ['leader','elfmeterkiller'],  // Keys aus TRAITS, 0..3
  appearance: {                    // siehe render/portraits.js
    skin: 0..5, hair: 'kurz'|'mittel'|'lang'|'glatze'|'afro'|'vokuhila'|'zopf'|'undercut'|'locken'|'irokese',
    hairColor: '#2b1d14', beard: 'keiner'|'stoppeln'|'schnauzer'|'vollbart'|'kinnbart'|'koteletten',
    build: 'schlank'|'normal'|'kraeftig', height: 178,
    eyes: '#3a2a1a', accessory: 'keiner'|'stirnband'|'brille'|'handschuhe'|'kapitaensbinde',
    face: 0..7                     // Gesichtsform-Variante
  },
  number: 5,                       // Rückennummer, im Verein eindeutig
  contract: { salary: 4200000, until: 3, signOn: 0, releaseClause: null },  // salary = JAHRESgehalt €, until = Saisonnummer
  value: 45000000,                 // Marktwert €
  // Laufzeit-Felder (werden von core/state.js initialisiert, NICHT in data/ setzen):
  form: 50, morale: 70, fitness: 100, sharpness: 60,
  injury: null, cards: { yellow:0, red:0, ban:0 },
  stats: { season:{}, career:{} }, training: { focus:null, gains:{} }
}
```

**In `data/` NUR die Felder bis inkl. `value` angeben.** Laufzeitfelder ergänzt `core/state.js`.

### 5.2 Club

```js
{
  id: 'bayern',
  name: 'FC Bayern München',
  shortName: 'Bayern',
  abbr: 'FCB',                     // 3 Zeichen
  city: 'München',
  founded: 1900,
  colors: { primary:'#dc052d', secondary:'#ffffff', accent:'#0066b2' },
  kit: { pattern: 'plain'|'stripes'|'hoops'|'sash'|'halves'|'chest', shorts:'#dc052d', socks:'#dc052d' },
  awayKit: { primary:'#ffffff', secondary:'#dc052d', pattern:'plain' },
  crest: { shape:'round'|'shield'|'diamond'|'classic', motif:'star'|'lion'|'eagle'|'ball'|'anchor'|'wheel'|'letters'|'goat'|'horse'|'bull', bg:'#dc052d', fg:'#ffffff' },
  stadium: { name:'Allianz Arena', capacity: 75000, standing: 0.18, roof: true, floodlight: 4, pitch: 92, tiers: 3 },
  reputation: 95,                  // 1..100
  finances: { balance: 60000000, debt: 0, ticketBase: 38 },  // ticketBase = Basispreis Sitzplatz €
  fanbase: { members: 320000, ultras: 65, mood: 70, potential: 95 },  // potential = max. Zuschauerpotenzial-Index
  facilities: { training: 90, medical: 88, youth: 85, scouting: 90 },  // 1..100
  boardName: 'Herbert Hainer',
  leagueId: 'bl1',
  history: { titles: 33, lastTitle: 2025, honours: ['33× Deutscher Meister','...'] }
}
```

### 5.3 Formation / Taktik

```js
Formation = { id:'4-4-2', name:'4-4-2 Flach', slots:[{ id:'s1', pos:'TW', x:50, y:5 }, ...] }  // genau 11 Slots
Tactics = {
  formation: '4-4-2',
  style: 'ballbesitz'|'konter'|'pressing'|'kick_and_rush'|'ausgeglichen'|'defensiv'|'offensiv',
  lineup: { s1:'p_...', s2:'p_...', ... },   // slotId -> playerId
  bench: ['p_...'],                          // max 9
  roles: { 'p_...': 'spielmacher' },         // playerId -> Rollen-Key (optional)
  sliders: { tempo:50, breite:50, pressinghoehe:50, risiko:50, haerte:50, offensivdrang:50 },  // je 0..100
  setPieces: { elfmeter:'p_...', freistoss:'p_...', ecke:'p_...', kapitaen:'p_...' },
  offsideTrap: false, manMarking: null,
  instructions: { zeitspiel:false, langeBaelle:false, flankenSpiel:false, abseitsfalle:false }
}
```

---

## 6. Match-Engine — `engine/match.js`

```js
export function simulateMatch(setup) : Promise<MatchResult>
```

`setup`:
```js
{
  home: MatchTeam, away: MatchTeam,
  rng,                       // Rng-Instanz
  venue: { capacity, attendance, stadiumName, pitch, weather:'sonnig'|'regen'|'schnee'|'wind'|'bewoelkt', temperature },
  referee: { name, strictness:0..100, homeBias:0..100 },
  difficulty,                // DIFFICULTIES-Eintrag
  competition: { id:'bl1', name:'1. Bundesliga', matchday: 7, neutral:false },
  interactive: false,
  onKeyMoment: async (moment) => resolution | null,   // siehe unten
  onEvent: (event) => void,         // Live-Callback, synchron
  // --- optionale Live-Hooks (die Engine MUSS sie unterstützen, Aufrufer dürfen sie weglassen) ---
  onPhase: (phase) => void,         // synchron, direkt nachdem eine Phase erzeugt wurde
  onHalftime: async (info) => void, // await vor Beginn der 2. Halbzeit; info = { score, stats, ratings }
  onMinute: (minute, info) => void  // synchron, nach jeder Spielminute
}
```

`MatchTeam`:
```js
{ club: Club, players: [Player], tactics: Tactics, morale: 0..100, tiredness: 0..100, coachBonus: 0..100 }
```

`MatchResult`:
```js
{
  score: [2,1],
  events: [MatchEvent],
  phases: [Phase],                 // vollständiger Spielverlauf für Rendering
  stats: { home:TeamStats, away:TeamStats },
  ratings: { [playerId]: 1..10 },
  playerStats: { [playerId]: { goals, assists, shots, passes, tackles, saves, minutes, distance } },
  motm: playerId,
  attendance: 74800,
  summaryText: ['...'],            // deutsche Textzusammenfassung, 6-12 Zeilen
}
TeamStats = { possession, shots, shotsOnTarget, xg, corners, fouls, offsides, passes, passAccuracy, tackles, yellow, red }
```

`MatchEvent`:
```js
{
  minute: 37, addedTime: 0,
  type: 'anpfiff'|'tor'|'chance'|'grosschance'|'parade'|'latte'|'pfosten'|'abseits'|'foul'|'gelb'|'gelbrot'|'rot'|
        'ecke'|'freistoss'|'elfmeter'|'wechsel'|'verletzung'|'halbzeit'|'abpfiff'|'kombination'|'konter'|'ballverlust',
  team: 'home'|'away',
  playerId, secondPlayerId,        // z. B. Vorlagengeber / gefoulter Spieler
  text: 'Beckenbauer schickt Kane steil …',   // DEUTSCH, Reporterstil
  xg: 0.34,
  at: { x: 88.2, y: 31.5 },        // Meter-Koordinaten
  score: [1,0],                    // Stand NACH dem Event
  keyMoment: null | KeyMoment
}
```

`Phase` (für die Spielfeld-Animation):
```js
{
  minute: 37, team:'home', kind:'aufbau'|'angriff'|'konter'|'standard'|'abwehr',
  ball: [ { x, y, t } ],           // Ballweg, t = 0..1 relative Zeit in der Phase
  actors: [ { playerId, x, y, action:'pass'|'dribbling'|'schuss'|'tackling'|'parade'|'lauf'|'kopfball' } ],
  duration: 4.5,                   // Sekunden Animationszeit
  eventIndex: 12 | null            // Index in events[], falls die Phase ein Event auslöst
}
```

**Dieser Altblock bleibt in voller Länge gültig und PFLICHT.** `ball[]`, `actors[]`,
`duration` und `eventIndex` werden von der Engine immer befüllt. Ein Renderer, der die unten
beschriebenen `segments` nicht kennt, läuft unverändert weiter.

#### 6.2 Phase v2 — Segmente (additiv, alle neuen Felder optional)

Seit dem Umbau „Phase v2" schreibt die Engine den Spielverlauf als **Segmente** mit. `ball[]`,
`actors[]` und `duration` werden daraus **abgeleitet** – die dargestellten Spieler sind damit
dieselben, die die Simulation gerechnet hat (vorher wurden sie gewürfelt).

```js
const phase = {
  /* ---------- ALT, weiterhin PFLICHT (siehe oben) ---------- */
  minute: 37, team: 'home', kind: 'aufbau',
  ball: [ { x: 34.0, y: 21.0, t: 0 }, { x: 61.5, y: 18.4, t: 0.41 } ],
  actors: [ { playerId: 'p12', x: 33.0, y: 21.4, action: 'pass',
              /* --- neu, optional --- */
              role: 'passgeber',       // 'passgeber'|'empfaenger'|'dribbler'|'schuetze'|'vorlage'|
                                       // 'verteidiger'|'blocker'|'torwart'|'mitlaeufer'
              from: { x: 30.2, y: 22.0 },   // Startposition; fehlt sie, gilt die aktuelle
              t0: 0, t1: 0.41 } ],          // Zeitfenster DIESES Akteurs
  duration: 3.8,                // Σ Segmentdauern, nicht mehr gewürfelt
  eventIndex: 12,

  /* ---------- NEU, alles optional ---------- */
  v: 2,                         // Schemaversion. Fehlt sie ⇒ alte Phase ⇒ ball/actors sind Wahrheit
  startedFrom: 'ballgewinn',    // 'anstoss'|'abstoss'|'einwurf'|'ecke'|'freistoss'|'elfmeter'|
                                // 'ballgewinn'|'weiter'
  possessionStart: { x: 30.2, y: 22.0 },  // wo der Ball zu Beginn LIEGT — gegen den Sprungschnitt
  lane: 'halblinks',            // 'links'|'halblinks'|'zentrum'|'halbrechts'|'rechts'
  formationId: '4-4-2',         // Grundordnung der angreifenden Seite

  segments: [{
    type: 'steilpass',          // 'pass_flach'|'steilpass'|'flanke'|'schuss'|'dribbling'|
                                // 'kopfball'|'klaerung'|'abpraller'|'abstoss'|'einwurf'|'ruecklage'
    from: { x: 30.2, y: 22.0 }, // Weltmeter, §1
    to:   { x: 61.5, y: 18.4 },
    t0: 0, t1: 0.41,            // Zeitfenster in der Phase, aus dist/segTempo berechnet
    speed: 18,                  // m/s, informativ (der Renderer rechnet mit t0/t1)
    height: 6.9,                // OPTIONAL, Scheitelhöhe in Metern — drei Aussagen,
                                // „Feld fehlt" und „0" sind NICHT dasselbe (siehe unten)
    by: 'p12',                  // wer den Ball spielt (echte playerId aus der Simulation)
    target: 'p19',              // vorgesehener Empfänger (null bei Schuss/Klärung)
    against: 'p04',             // direkter Gegenspieler/Verteidiger/Torwart (oder null)
    outcome: 'angekommen',      // 'angekommen'|'abgefangen'|'geblockt'|'gehalten'|'tor'|'aus'|
                                // 'abgewehrt'|'gefoult'|'abgeprallt'|'abseits'
    zone: 1,                    // 0..3 aus Sicht der angreifenden Seite
    lane: 'halblinks'           // Kanal DIESES Segments (macht Verlagerung sichtbar)
  }]
};
```

**Ableitungsregeln** (in `bauePhase()`, damit jeder Aufrufer sie umsonst bekommt):

* `ball[0] = { ...segments[0].from, t: 0 }`, danach je Segment `{ ...seg.to, t: seg.t1 }`;
  identische aufeinanderfolgende Punkte werden zusammengefasst, der letzte Punkt hat `t === 1`.
* `actors` über die Rollen-Map, je `playerId` genau **ein** Eintrag; Rollenpriorität
  `schuetze > vorlage > passgeber/dribbler > empfaenger > verteidiger/blocker > torwart >
  mitlaeufer`. Die Aktion kommt aus `LEGACY_ACTION[seg.type]`
  (`pass_flach|steilpass|flanke|abstoss|einwurf|ruecklage` → `'pass'`, `dribbling` →
  `'dribbling'`, `schuss` → `'schuss'`, `kopfball` → `'kopfball'`, `klaerung` → `'tackling'`,
  `abpraller` → `'lauf'`); Torwart bekommt `'parade'`, Verteidiger/Blocker `'tackling'`,
  Mitläufer `'lauf'`.
* `duration = Σ (dist/segTempo[type] + segKontakt)`, geklemmt auf **0,6–9 s**.
* Der Ballspieler steht auf `seg.from`, der Empfänger auf `seg.to` minus 1,2 m Ballvorlage,
  der Torwart auf der Torlinie mit Auslauf `x = torX ∓ (0.8 + 1.6·(1 − dist/25))`.
  **Kein Akteur steht im Netz:** `x` liegt immer in `[0.5, 104.5]`.
* Jeder Schuss läuft bis zur Torlinie – auch bei Parade (1,2 m davor), Latte/Pfosten
  (`y = 34 ∓ 3.66`) und „daneben". Nur `outcome: 'geblockt'` endet früher, denn genau das
  ist seine Aussage. Danach folgt in der Regel ein `abpraller`-Segment.

**Ballhöhe (`height`) — verbindlich:**

`height` hat **drei** Zustände, und ein Renderer muss alle drei unterscheiden:

| Zustand | Bedeutung | Renderer |
|---|---|---|
| Feld **fehlt** (`!('height' in seg)`) | Die Engine macht **keine** Vorgabe. | `ballistik.segmentFlug()` bestimmt die Bahn aus dem Segmenttyp (`SEGMENT_TYPEN[typ].loft`). |
| `height === 0` | **Ausdrücklich flach.** | Bodenball. Ein *getretener* Bodenball darf dabei sichtbar hoppeln (≤ 65 cm) — das ist die Darstellung von „flach", keine Höhenvorgabe. |
| `height > 0` | Genau diese **Scheitelhöhe** in Metern. | Übernehmen, in `[0,15; 24]` m klemmen. |

`height: 0` und ein fehlendes Feld sind daher **nicht** austauschbar. Ein Schreiber, der das
Feld immer setzt (`height: o.height || 0`), macht den ersten Zustand unerreichbar und liefert
jeden Ball ohne eigene Vorgabe flach aus.

Was die Engine heute vorgibt (`MATCH_CONSTANTS.scheitel`, Scheitel = `basis + je·Distanz`,
geklemmt): `flanke` 3,0 + 0,14·d auf 3,0…9,0 m bis 45 m Segmentlänge · `klaerung` 1,6 + 0,20·d
auf 1,6…9,0 m bis 38 m · `dribbling` fest 0. Grund: der Typ-Loft allein trägt gemessen nur
2,23 m bei einer 30-m-Flanke und 3,05 m bei einer 30-m-Klärung — beides zu flach. Jenseits der
genannten Längen ist es keine Flanke und kein Befreiungsschlag mehr, sondern ein weiter
Verlagerungsball; dort gibt die Engine nichts vor. Schuss, Kopfball, Latte und „drüber"
setzen ihre Höhe fallweise selbst (auch die 0). Alle übrigen Typen lassen das Feld weg.
Die Vorgabe ist reine Geometrie und zieht **keinen** rng-Zug — `state.rngState` wird
serialisiert, eine Höhenvorgabe darf den Spielverlauf nicht verschieben.

**Abwärtskompatibilität — verbindlich:**

1. `ball[]` und `actors[]` bleiben **Pflicht** und werden immer befüllt.
2. `pitch.js` verzweigt genau einmal:
   `const nutzeSegmente = phase && phase.v >= 2 && Array.isArray(phase.segments) && phase.segments.length;`
   Sonst exakt der heutige Pfad.
3. Kein Zweig darf werfen, wenn `segments` unvollständig ist: fehlt `to`, wird das Segment
   übersprungen.
4. Phasen werden **nie** serialisiert – es gibt keine Savegame-Migration. Der Vertrag ist
   trotzdem öffentlich, weil `render/pitch.js` als eigenständig benutzbare API dokumentiert ist;
   deshalb ist die additive Form Pflicht.

**Balancehinweis:** `stats.passes` und `stats.tackles` sind reine Zählwerke. Sie liegen bei
**850–1.000 Pässen** und **95–115 Zweikämpfen** je Partie (beide Mannschaften zusammen) und
werden von `tools/test-match.js` als Korridor geprüft.

### 6.0a Eingriffe während des Spiels

Die Engine liest **zu Beginn jeder Minute** die folgenden Felder ihrer `MatchTeam`-Objekte neu ein.
So kann die Oberfläche (in `onHalftime`, `onKeyMoment` oder aus einem Pause-Dialog heraus)
eingreifen, ohne dass die Engine eine eigene API dafür braucht:

```js
matchTeam.tactics            // darf jederzeit ersetzt werden (Formation, Stil, Slider, Rollen)
matchTeam.pendingSubs        // [{ raus: playerId, rein: playerId }] – Engine führt sie aus,
                             // erzeugt ein 'wechsel'-Event und leert das Array.
                             // Max. 5 Wechsel pro Team, Bank muss den Spieler enthalten.
matchTeam.ansprache          // { art, wirkung: { [playerId]: moralDelta } } – einmalig angewendet,
                             // danach von der Engine auf null gesetzt.
```

### 6.1 Key Moments (interaktive Eingriffe)

Wenn `interactive === true` und die Engine eine Schlüsselszene für das **Manager-Team** erzeugt, ruft sie
`await onKeyMoment(moment)` auf:

```js
KeyMoment = {
  kind: 'abschluss'|'kombination'|'elfmeter'|'freistoss'|'ecke',
  minute, team:'home'|'away',
  actor: Player,                   // Schütze/Passgeber
  keeper: Player | null,
  defenders: [Player],
  targets: [Player],               // Anspielstationen (bei 'kombination'/'ecke')
  at: { x, y },
  baseChance: 0.28,                // Trefferwahrscheinlichkeit ohne Eingriff (Sim-Baseline)
  pressure: 0..100,                // Gegnerdruck
  context: { score:[1,1], minute:88, competition:'1. Bundesliga' }
}
```

Rückgabe (`resolution`) — oder `null`, wenn der Spieler abbricht (dann simuliert die Engine normal):
```js
{
  outcome: 'tor'|'parade'|'daneben'|'geblockt'|'latte'|'pfosten'|'abgeschlossen'|'abgefangen'|'kopfball_tor',
  quality: 0..1,                   // Ausführungsgüte des Spielers (Skill)
  targetPlayerId: 'p_...' | null,  // bei Kombination/Ecke: wer wurde angespielt
  xgDelta: -0.1..+0.4              // Einfluss auf die Torchance
}
```
**Wichtig:** Die Engine entscheidet final. `quality` moduliert `baseChance`; die Attribute des Spielers bleiben
maßgeblich (Geschick × Können). Formel-Empfehlung:
`p = clamp(baseChance * (0.45 + 0.9*quality) * skillFactor * difficultyFactor, 0.02, 0.97)`

---

## 7. `engine/ratings.js`

```js
export function playerOverall(player)                     // 1..99, positionsgewichtet
export function playerRatingForSlot(player, slotPos)      // 1..99 inkl. Positions-Malus
export function positionPenalty(player, pos)              // 1.0 = perfekt, 0.55 = völlig fremd
export function effectiveRating(player, slotPos, ctx)     // inkl. Form/Moral/Fitness/Verletzung
export function teamStrength(matchTeam)                   // -> { tw, abwehr, mittelfeld, angriff, gesamt, chemie, taktikBonus, breakdown }
export function tacticMatchup(aTactics, bTactics)         // -> { homeMod:0.85..1.15, awayMod, reasons:[string] }
```
`teamStrength` muss **spürbar** auf Formation, Stil, Slider, Positionsbesetzung, Moral, Form, Fitness und
Spieler-Chemie (Nationalität/Ära/Zusammenspiel) reagieren. Dokumentiere die Gewichte als Kommentar.

## 8. `engine/tactics.js`

```js
export const FORMATIONS      // { '4-4-2': Formation, ... } — mind. 12 Formationen
export const STYLES          // { ballbesitz:{ name, desc, mods:{...} }, ... }
export const ROLES           // { spielmacher:{ name, desc, positions:[...], mods }, ... } — mind. 14 Rollen
export function autoLineup(players, tactics, opts)   // -> Tactics (beste Elf automatisch)
export function validateTactics(tactics, players)    // -> { ok, errors:[string], warnings:[string] }
export function formationCounter(formation)          // -> { strongVs:[ids], weakVs:[ids] }
```

---

## 9. Interaktive Minispiele — `interactive/*.js`

Jedes Modul exportiert **exakt** dieses Objekt:

```js
export const minigame = {
  id: 'elfmeter',
  kind: 'elfmeter',                       // passt zu KeyMoment.kind
  title: 'Elfmeter',
  instructions: 'Ziele mit der Maus, halte gedrückt für Kraft, loslassen zum Schuss.',
  async play(host, moment) { ... return resolution }   // resolution siehe 6.1
}
```

`host`:
```js
{
  canvas,            // HTMLCanvasElement, 960×600, bereits im DOM
  ctx,               // 2D-Kontext
  root,              // HTMLElement für Overlays/HUD (Position: relativ zum Canvas)
  difficulty,        // DIFFICULTIES-Eintrag: nutze difficulty.minigame (0.6=leicht … 1.6=knallhart)
  rng,
  drawPlayer(ctx, player, x, y, scale, opts),   // aus render/players.js
  drawPitchSection(ctx, section),               // 'strafraum'|'halbfeld'|'flanke'|'ecke'
  sound(name),       // no-op-fähig
  finish(resolution) // optionale Alternative zum return
}
```

**Zusätzlicher Prüfexport `modell` (additiv, optional, aber empfohlen):**

Ein Minispiel darf neben `minigame` einen zweiten, benannten Export `modell` anbieten. Er macht
die Physik- und Trefferentscheidung von außen messbar, ohne das Spiel zu starten:

```js
export const modell = { /* reine Funktionen, z. B.: */
  flugzeit(power, schuss),                  // Sekunden
  twReichweiteBei(tFlug, hoehe, keeper),    // Meter
  parade(schuss, keeper, rng)               // -> { gehalten, ... }
}
```

Harte Auflagen:
- **DOM-frei.** Kein `document`, kein `canvas`, kein Listener – der Export muss unter Node laufen.
- **`rng` immer als Parameter**, nie als Modulzustand. `Math.random()` bleibt verboten (§0.3).
- **Rein additiv.** Weder Signatur noch Verhalten von `minigame` dürfen sich dadurch ändern.
- Dient ausschließlich der Prüfung (`tools/test-*.js`); das Spiel selbst nutzt weiterhin `minigame`.

Regeln für Minispiele:
- Laufen komplett auf `requestAnimationFrame`, sauberes Aufräumen (Listener entfernen!) vor dem Auflösen.
- **Timeout:** nach 20 s automatisch mit einer plausiblen `resolution` auflösen — nie hängen bleiben.
- ESC ⇒ `null` zurückgeben (Simulation übernimmt).
- Schwierigkeit skaliert: Torwartreflexe/Zielfenster/Zeitfenster über `difficulty.minigame` **und**
  die Attribute von `moment.actor` (besserer Spieler ⇒ größeres Zielfenster / langsamerer Balken).
- Optik: Retro-Anstoß-Look, kräftige Farben, dicke Outlines, gut lesbar.

## 10. Render-Schicht

### `render/portraits.js`
```js
export function drawPortrait(ctx, player, x, y, size, opts)   // Kopf+Schultern, deterministisch aus appearance
export function portraitDataURL(player, size)                 // gecached
export function drawFace(ctx, appearance, x, y, size, opts)
```
Muss **klar wiedererkennbare, deutlich unterschiedliche** Gesichter erzeugen (Hautton, Frisur, Bart,
Gesichtsform, Augen, Accessoires, Alterung ab 30: Falten/Geheimratsecken).

### `render/players.js`
```js
export function drawPlayer(ctx, player, x, y, scale, opts)  // Ganzkörper, Trikot des Vereins, opts:{club, away, pose:'stand'|'lauf'|'schuss'|'jubel'|'grätsche'|'parade', dir:-1|1, frame:0..1}
export function drawKeeper(ctx, player, x, y, scale, opts)
```

### `render/kits.js`
```js
export function drawKit(ctx, club, x, y, scale, opts)   // Trikot-Icon
export function drawCrest(ctx, club, x, y, size)        // prozedurales Wappen aus club.crest
export function kitColors(club, away)
```

### `render/pitch.js`
```js
export function createPitchView(canvas, opts)  // -> view
view.setTeams(homeTeam, awayTeam)              // MatchTeam-Objekte
view.setFormationPositions()                   // aus tactics
view.playPhase(phase)                          // -> Promise<void>, animiert Ballweg + Spieler
view.renderStatic()                            // Standbild
view.setSpeed(1|2|4)
view.showBanner(text, ms)                      // Torjubel-Banner etc.
view.destroy()
```
Vollperspektive: Draufsicht, ganzes Feld, 105×68 m skaliert auf Canvas. Schöne Details: Rasenstreifen,
Linien, Tornetze, Eckfahnen, Zuschauerränge am Rand, Schatten, Ball mit Schatten.

### `render/ui.js`
```js
export function el(tag, props, ...children)     // Mini-Hyperscript -> HTMLElement
export function panel(title, ...children)       // Anstoß-Panel mit Beveled Border
export function button(label, onClick, opts)
export function bar(value, max, opts)           // Attributbalken
export function table(columns, rows, opts)      // sortierbare Tabelle
export function tabs(items)                     // Reiter
export function dialog(title, body, actions)    // -> Promise<result>
export function toast(text, kind)
export function tooltip(target, text)
```

---

## 11. Vereins- & Wirtschaftsschicht — `club/*.js`

Alle Module arbeiten **rein funktional** auf `state`. Jedes Modul exportiert:
```js
export function tick<Modul>(state, ctx)   // ctx = { rng, day, isMatchday, log(msg, kind) }
```
plus modulspezifische Aktionen. `log` schreibt in den Post-Eingang. Alle Rückgaben sind neue Werte,
Mutation von `state` ist erlaubt (kein Immutability-Zwang), aber **nur im eigenen Zuständigkeitsbereich**.

Details siehe die jeweilige Aufgabenbeschreibung. Zuständigkeitsbereiche (keine Überschneidung!):

| Modul | Zuständig für |
|---|---|
| `club/finances.js` | Konto, Kredite, Bilanz, Gehälter, Prämien, Steuern, Insolvenz |
| `club/sponsors.js` | Trikot-/Ausrüster-/Bandensponsoren, Verhandlungen, Boni |
| `club/stadium.js` | Ausbau, Ränge, Ticketpreise, Zuschauer, Catering, Parkplätze |
| `club/board.js` | Vorstand, Erwartungen, Geduld, Entlassung, Jobangebote |
| `club/fans.js` | Stimmung, Mitglieder, Ultras, Choreos, Fanproteste |
| `club/media.js` | Presse, Interviews, Schlagzeilen, Gerüchte, Reporterfragen |
| `club/staff.js` | Co-Trainer, Ärzte, Physios, Scouts, Torwarttrainer — Einstellung/Gehalt |
| `club/youth.js` | Jugendakademie, Talente, Nachwuchs-Beförderung |
| `club/medical.js` | Verletzungen, Reha, Fitness, Sperren |
| `club/transfers.js` | Transfermarkt, Angebote, KI-Vereine, Leihen, Berater, Vertragsverhandlung |
| `club/training.js` | Trainingswoche, Einheiten, Attribut-Entwicklung, Form, Frische |
| `club/morale.js` | Moral, Spielerpersönlichkeit, Kabinen-Hierarchie, Konflikte, Gespräche |

---

## 12. Screens — `screens/*.js`

Jeder Screen exportiert:
```js
export const screen = {
  id: 'kader',
  title: 'Kader',
  icon: '👥',
  render(root, ctx)          // ctx = { state, actions, refresh(), navigate(id, params), params }
  onLeave()                  // optional
  onEscape(): boolean        // optional, seit Stufe 6
}
```
Screens dürfen **nur** über `ctx.actions` (aus `main.js`) den State verändern.

`onEscape()` ist die zweite Stufe der Escape-Kette aus `main.js:escapeKette`. Die Kette
läuft: Überlagerungen des Rahmens → `onEscape()` → Fokus im Inhalt loslassen → zurück ins
Büro. Wer `true` liefert, hat die Taste **verbraucht**; die Kette hört dann auf.

Zwei Regeln, beide bei der Abnahme von Stufe 6 an einem echten Fehler gelernt:

1. **Nur `true` liefern, wenn sich sichtbar etwas ändert.** Ein Screen, der die Taste
   verbraucht und nichts tut, sperrt den Benutzer ein — ESC führt dann nie mehr ins Büro.
2. **Was `onEscape()` zurücksetzt, darf `render()` nicht sofort wieder setzen.** Wer
   „noch nie gewählt" und „bewusst abgewählt" unterscheiden muss, nimmt `undefined` gegen
   `null` (Vorbild: `screens/editor.js:zustand`).

Dialoge und Minispiele bringen ihren eigenen ESC-Weg mit und behalten Vorrang. Wie das
technisch abgesichert ist, wurde bei der Schlussabnahme zweimal korrigiert und steht
deshalb hier ausdrücklich:

* `render/ui.js:dialogTasten` hängt in der **Einfangphase** am Dokument und ruft bei ESC
  `stopPropagation()`. Damit ist der Anschlag verbraucht, bevor `main.js:tastatur` ihn in
  der Blasenphase sieht. Ohne das erledigt **ein** Druck zwei Dinge: Dialog zu und zurück
  ins Büro.
* `main.js:tastatur` prüft zusätzlich auf `.tv-overlay:not(.tv-overlay--zu)` und
  `.tv-minispiel`. Das `:not()` ist Pflicht: Eine geschlossene Dialoghülle bleibt noch
  260 ms im Dokument stehen (Ausblendanimation), und ohne den Zusatz ist in dieser Zeit die
  **gesamte** Tastatur stumm — ESC, alle Reiter-Kürzel und Strg+S.

---

## 13. Savegame

`core/state.js` (existiert bereits) exportiert:
```js
export function createNewGame(opts)   // { clubId, managerName, difficulty, seed, settings }
export function serialize(state) / deserialize(json)
export function saveGame(state, slot) / loadGame(slot) / listSaves()
export function verdichteVergangenheit(state, opts)   // die Spielstandbremse
export const VERDICHTUNG                              // alle Grenzen der Bremse
```

**Die Spielstandbremse.** `verdichteVergangenheit()` verdichtet Vergangenheit, damit ein
Spielstand nicht unbegrenzt wächst. Drei Regeln, alle beim Bau gelernt:

1. **Verdichtet wird ausschließlich VERGANGENHEIT.** Was ein Bildschirm noch zeigt, bleibt
   vollständig. Der strengste Leser ist die Ruhmeshalle in `screens/chronik.js`; nach der
   Bremse muss sie dasselbe zeigen wie davor. `tools/test-spielstand.js` rechnet das nach.
2. **Aufgerufen wird sie an genau einer Stelle:** `core/loop.js:saisonWechsel()`, Abschnitt
   l. `saisonWechsel(state, ctx, { bremse: false })` schaltet sie ab — **das tut nur der
   Prüfstand**, und derselbe Prüfstand geht in Z11 einmal den Weg ohne den Schalter. Wer
   einen Prüfschalter einbaut, baut die Gegenprobe daneben.
3. **Wer die Bremse erweitert, ändert `SAVE_VERSION`** und schreibt einen Migrationsschritt.
   Steht heute auf **4**.

---

## 14. Stil-Leitfaden (Anstoß-Charme)

- **Farben:** Rasengrün `#2f7d32`/`#276b2a`, Holzton `#8b5a2b`, Beige `#e8d9b0`, Signalrot `#c1272d`,
  Blau `#1c4f8f`, Vergilbtes Papier `#f2e8cf`. Panels mit 2px Outset-Bevel (hell oben/links, dunkel unten/rechts).
- **Typo:** System-Sans mit `letter-spacing`, Überschriften in Versalien, Zahlen tabellarisch.
- **Ton:** Trocken-humorvoller Sportreporter-Deutsch, 90er-Jahre-Flair, keine Anglizismen-Flut.
- **UI-Metapher:** Managerbüro mit Schreibtisch, Anrufbeantworter, Post, Pinnwand, Aktenschrank.
