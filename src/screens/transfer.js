/**
 * screens/transfer.js — Der Transfermarkt.
 * ============================================================================
 *
 * Sechs Reiter (Spielersuche, Meine Angebote, Angebote für meine Spieler,
 * Verträge, Scouting, Leihen), rechts die Spielerakte mit Gesicht und
 * Preisschild, oben die Kasse und der Countdown bis zum Deadline Day.
 *
 * GRUNDSÄTZE
 *   • Der Bildschirm rechnet NICHTS selbst. Jede Zahl kommt aus
 *     club/transfers.js bzw. engine/ratings.js, jede Zustandsänderung läuft
 *     über eine exportierte Aktionsfunktion des Moduls.
 *   • Der Modulimport ist bewusst ein Namensraum-Import (`import * as TM`).
 *     Fehlt eine Funktion, stürzt der Bildschirm nicht ab, sondern zeigt eine
 *     lesbare deutsche Fehlermeldung im Panel (siehe `braucht()`/`sicher()`).
 *   • Ungescoutete Spieler werden UNSCHARF angezeigt: statt „82" steht dort
 *     „78–86". Wer genaue Zahlen will, schickt seinen Späher los.
 *   • Legenden (era === 'legend') sind überall optisch hervorgehoben und
 *     lassen sich nur nach einer sehr deutlichen Warnung verkaufen.
 *
 * BEKANNTE ABWEICHUNG
 *   Die „Merkliste" ist reine Oberfläche und lebt nur, solange das Spiel im
 *   Browser offen ist — im State-Schema (core/state.js) gibt es dafür kein
 *   Feld, und fremde Dateien fasst dieser Bildschirm nicht an.
 */

import {
  el, panel, subpanel, button, bar, statBox, table, tabs, dialog, toast, pill,
  progressRing, newsItem, bestaetigungenAktiv
} from '../render/ui.js';
import { portraitDataURL } from '../render/portraits.js';
import { crestDataURL } from '../render/kits.js';
import {
  POSITIONS, POSITION_NAMES, POSITION_GROUP, NATION_NAMES,
  ATTRIBUTE_NAMES, ATTRIBUTE_GROUPS, TRAITS
} from '../core/constants.js';
import { formatMoney, formatMoneyShort, clamp, sortBy, ratingClass } from '../core/util.js';
import { LEAGUES, LEAGUE_IDS, leagueOfClub } from '../data/leagues.js';
import { playerOverall } from '../engine/ratings.js';
import * as TM from '../club/transfers.js';

/* ==========================================================================
 * 0. Anzeigekonstanten
 *
 * Diese Zahlen dienen AUSSCHLIESSLICH der Anzeige und Vorwarnung. Die
 * verbindliche Prüfung macht immer club/transfers.js — dort stehen die
 * Originale (MAX_KADER, MIN_KADER, KI_KASSE_ANTEIL, SCOUT_KOSTEN).
 * ======================================================================== */

const KADER_MAX = 28;
const KADER_MIN = 20;
const KASSE_ANTEIL = 0.85;      // so viel des Kontostands gilt als verplanbar
const SCOUT_SPESEN = 12500;     // Reisepauschale je Beobachtung

const ROLLEN_TEXT = {
  star: 'Aushängeschild', stamm: 'Stammspieler', rotation: 'Rotationsspieler',
  ergaenzung: 'Ergänzungsspieler', ueberzaehlig: 'Überzählig'
};

const ROLLEN_VERSPRECHEN = [
  ['stammspieler', 'Stammspieler — er spielt, Punkt.'],
  ['rotation', 'Rotationsspieler — regelmäßig, aber nicht immer.'],
  ['talent', 'Talent — er soll reifen, nicht tragen.'],
  ['ergaenzung', 'Ergänzungsspieler — Bank, Tribüne, Trainingsfleiß.']
];

const ABLOSE_STUFEN = [
  ['', 'Ablöse egal'], ['0', 'nur ablösefrei'], ['500000', 'bis 500 Tsd'],
  ['1000000', 'bis 1 Mio'], ['2500000', 'bis 2,5 Mio'], ['5000000', 'bis 5 Mio'],
  ['10000000', 'bis 10 Mio'], ['25000000', 'bis 25 Mio'], ['60000000', 'bis 60 Mio']
];

const STAERKE_STUFEN = [
  ['', 'Stärke egal'], ['55', 'ab 55'], ['62', 'ab 62'], ['68', 'ab 68'],
  ['74', 'ab 74'], ['80', 'ab 80'], ['86', 'ab 86']
];

const SORTIERUNGEN = [
  ['wert', 'Marktwert'], ['ovr', 'Stärke'], ['potenzial', 'Potenzial'],
  ['ablose', 'Ablöse'], ['alter', 'Alter'], ['name', 'Name']
];

/* ==========================================================================
 * 1. Bildschirm-eigener Zustand (überlebt Reiterwechsel und ctx.refresh())
 * ======================================================================== */

const zustand = {
  reiter: 'suche',
  gewaehlt: null,
  merkliste: new Set(),
  filter: leererFilter(),
  leihRichtung: 'ausleihen'
};

function leererFilter() {
  return {
    position: '', altVon: '', altBis: '', maxAblose: '', minOvr: '',
    nation: '', liga: '', status: '', suche: '',
    nurBeobachtet: false, nurMerkliste: false,
    sortierung: 'wert', limit: '60'
  };
}

/* ==========================================================================
 * 2. Kleine Helfer
 * ======================================================================== */

/** Wirft eine lesbare deutsche Meldung, wenn eine Modulfunktion fehlt. */
function braucht(name) {
  const fn = TM[name];
  if (typeof fn !== 'function') {
    throw new Error(`Die Funktion „${name}()" fehlt in src/club/transfers.js. ` +
      'Ohne sie kann dieser Teil des Transfermarkts nichts anzeigen.');
  }
  return fn;
}

/** Führt einen optionalen Modulaufruf aus; im Fehlerfall gibt es den Ersatzwert. */
function sicher(fn, ersatz) {
  try {
    const v = fn();
    return v === undefined || v === null ? ersatz : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[transfer] ' + (err && err.message), err);
    return ersatz;
  }
}

/** Fehlerkasten statt Absturz. */
function fehlerKasten(titel, err) {
  return subpanel(titel,
    el('p.tv-warnung', null, 'Hier ist etwas schiefgegangen — der Rest des Bildschirms läuft weiter.'),
    el('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '11px', margin: '6px 0 0', lineHeight: '1.45' } },
      String((err && err.message) || err)));
}

/** Baut einen Reiterinhalt und fängt alles ab, was dabei schiefgeht. */
function sicherBauen(titel, bauer) {
  try { return bauer(); } catch (err) { return fehlerKasten(titel, err); }
}

const kaderVon = (state, clubId) => {
  const c = state.clubs[clubId];
  if (!c || !Array.isArray(c.playerIds)) return [];
  return c.playerIds.map(id => state.players[id]).filter(Boolean);
};

const vollerName = (p) => (p ? `${p.firstName} ${p.lastName}` : 'Unbekannt');
const kurzName = (p) => (p ? (p.shortName || p.lastName || 'Unbekannt') : 'Unbekannt');
const istLegende = (p) => !!p && p.era === 'legend';
const nationText = (code) => NATION_NAMES[code] || code || '—';

function vereinsName(state, clubId) {
  const c = clubId ? state.clubs[clubId] : null;
  return c ? (c.shortName || c.name) : 'vereinslos';
}

function ligaText(clubId) {
  if (!clubId) return 'ohne Verein';
  const l = leagueOfClub(clubId);
  return l && LEAGUES[l] ? LEAGUES[l].short : 'Amateur';
}

function restlaufzeit(state, p) {
  if (!p || !p.contract) return 0;
  return (p.contract.until || 0) - state.date.season;
}

/** Jahresgehaltssumme des Kaders. */
function gehaltssumme(state, clubId) {
  return kaderVon(state, clubId).reduce((s, p) => s + ((p.contract && p.contract.salary) || 0), 0);
}

/**
 * Was die Geschäftsstelle heute wirklich ausgeben kann. Spiegelt die
 * Deckelung aus club/transfers.js — die endgültige Prüfung macht das Modul.
 */
function verplanbar(club) {
  const f = club.finances || {};
  return Math.max(0, Math.min(Math.max(0, f.transferBudget || 0), Math.max(0, (f.balance || 0) * KASSE_ANTEIL)));
}

function zahlAus(node, ersatz = 0) {
  if (!node) return ersatz;
  const roh = String(node.value === undefined ? '' : node.value).replace(/\./g, '').replace(',', '.');
  const v = Number(roh.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(v) ? v : ersatz;
}

function auf50k(v) { return Math.max(0, Math.round(v / 50000) * 50000); }

/* --- Bausteine, die die alte Schreibweise in styles/main.css umschiffen ----
 *
 * main.css kennt `.tv-bar` und `.tv-tabs` noch als fertige Einzelelemente
 * (11 px hoher Balken bzw. waagerechte Reiterleiste), während render/ui.js
 * daraus zusammengesetzte Bausteine macht. Da main.css ohne @layer geladen
 * wird, gewinnt es gegen die Vorgaben von ui.js. Zwei Inline-Stile setzen die
 * betroffenen Eigenschaften zurück — Inline schlägt jedes Stylesheet.
 * Konflikt bewusst so gelöst; sauber wäre eine Angleichung in main.css.
 */

function balken(value, max, opts = {}) {
  const b = bar(value, max, opts);
  b.style.height = 'auto';
  b.style.background = 'none';
  b.style.border = '0';
  b.style.borderRadius = '0';
  b.style.overflow = 'visible';
  return b;
}

function reiterLeiste(items, opts = {}) {
  let node = null;
  const angleichen = () => {
    if (!node) return;
    node.querySelectorAll('.tv-tab').forEach(b =>
      b.classList.toggle('aktiv', b.classList.contains('tv-tab--aktiv')));
  };
  node = tabs(items, Object.assign({}, opts, {
    onChange: (id) => { if (opts.onChange) opts.onChange(id); angleichen(); }
  }));
  node.style.display = 'block';
  node.style.padding = '0';
  node.style.background = 'none';
  node.style.border = '0';
  angleichen();
  return node;
}

/* --- Wappen, Portraits, Pillen -------------------------------------------- */

function wappen(state, clubId, groesse = 18) {
  const c = clubId ? state.clubs[clubId] : null;
  if (!c) return el('span', { style: { display: 'inline-block', width: groesse + 'px' } }, '');
  const url = sicher(() => crestDataURL(c, groesse), '');
  if (!url) return el('span', null, '');
  return el('img', {
    src: url, width: groesse, height: groesse, alt: c.shortName || c.name,
    style: { verticalAlign: 'middle', display: 'inline-block' }
  });
}

function portrait(state, p, groesse = 32, gross = false) {
  const heim = p && p.clubId ? state.clubs[p.clubId] : null;
  const url = sicher(() => portraitDataURL(p, groesse, { club: heim }), '');
  if (!url) {
    return el('div.tv-portrait', {
      style: { width: groesse + 'px', height: groesse + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px' }
    }, '?');
  }
  return el('img', {
    class: 'tv-portrait' + (gross ? ' tv-portrait--gross' : ''),
    src: url, width: groesse, height: groesse, alt: vollerName(p),
    style: { width: groesse + 'px', height: groesse + 'px' }
  });
}

function positionsPille(pos) {
  const gruppe = POSITION_GROUP[pos] || 'MIT';
  return el('span', { class: 'tv-pos tv-pos--' + gruppe, title: POSITION_NAMES[pos] || pos }, pos);
}

function legendenPille(p) {
  if (!istLegende(p)) return null;
  return pill(p.eraLabel || 'Legende', 'legende');
}

/* --- Unschärfe: was weiß unser Scout wirklich? ---------------------------- */

/**
 * Halbe Breite der Stärke-Schätzung. Abgeleitet aus `potenzialSpanne` des
 * Scoutberichts, damit hier keine Balancing-Konstante doppelt gepflegt wird:
 * Das Rauschen auf dem Potenzial ist rund 1,4×, das auf der Stärke rund 0,8×
 * der Grundunschärfe — also gut 57 % davon.
 */
function schaetzSpanne(bericht) {
  if (!bericht || !Array.isArray(bericht.potenzialSpanne)) return 0;
  const halb = (bericht.potenzialSpanne[1] - bericht.potenzialSpanne[0]) / 2;
  return Math.max(0, Math.round(halb * 0.57));
}

function istScharf(bericht, p, eigenerClub) {
  return eigenerClub || !bericht || (bericht.genauigkeit || 0) >= 0.95;
}

/** „82" bei bekannten, „78–86" bei ungescouteten Spielern. */
function staerkeText(bericht, p, eigenerClub) {
  if (istScharf(bericht, p, eigenerClub)) return String(playerOverall(p));
  const s = schaetzSpanne(bericht);
  const m = bericht.geschaetzteStaerke;
  if (s <= 0) return String(m);
  return `${clamp(m - s, 1, 99)}–${clamp(m + s, 1, 99)}`;
}

function potenzialText(bericht, p, eigenerClub) {
  if (istScharf(bericht, p, eigenerClub)) return String(p.potential);
  const sp = bericht.potenzialSpanne;
  if (!Array.isArray(sp) || sp[0] === sp[1]) return String(bericht.geschaetztesPotenzial);
  return `${sp[0]}–${sp[1]}`;
}

/** Vergleichszahl für Sortierung und Farbe — immer die Schätzung. */
function staerkeZahl(bericht, p, eigenerClub) {
  if (istScharf(bericht, p, eigenerClub)) return playerOverall(p);
  return bericht.geschaetzteStaerke;
}

function berichtFuer(state, clubId, playerId) {
  return sicher(() => TM.scoutbericht(state, clubId, playerId), null);
}

/* ==========================================================================
 * 3. Aktionen: einheitlich melden und neu zeichnen
 * ======================================================================== */

function meldeErgebnis(res, ctx, opts = {}) {
  if (!res) {
    toast('Keine Antwort aus der Geschäftsstelle. Merkwürdig.', 'warn');
    return false;
  }
  const gut = res.ok !== false;
  const art = opts.art || (gut ? 'gut' : 'schlecht');
  if (res.text) toast(res.text, art, { ms: res.text.length > 120 ? 7000 : undefined });
  if (opts.stillNeuzeichnen !== true) {
    try { ctx.aktualisiere(); } catch (e) { /* Kopfleiste ist optional */ }
    ctx.refresh();
  }
  return gut;
}

/* ==========================================================================
 * 4. Der Bildschirm
 * ======================================================================== */

export const screen = {
  id: 'transfer',
  title: 'Transfermarkt',
  icon: '💼',

  async render(root, ctx) {
    const state = ctx.state;
    const club = state && state.clubs ? state.clubs[state.managerClubId] : null;

    if (!club) {
      root.appendChild(panel('Transfermarkt',
        el('div.tv-leer', null, 'Es ist kein Verein gesetzt — ohne Verein kein Transfermarkt.')));
      return;
    }

    // Auswahl aus einer früheren Sitzung könnte längst weg sein.
    if (zustand.gewaehlt && !state.players[zustand.gewaehlt]) zustand.gewaehlt = null;
    if (ctx.params && ctx.params.playerId && state.players[ctx.params.playerId]) {
      zustand.gewaehlt = ctx.params.playerId;
    }
    if (ctx.params && ctx.params.reiter) zustand.reiter = ctx.params.reiter;

    const seite = el('div.tv-seite');
    root.appendChild(seite);

    seite.appendChild(kopfzeile(state, club));
    seite.appendChild(sicherBauen('Kassensturz', () => kennzahlen(state, club, ctx)));

    const links = el('div.tv-spalte');
    const rechts = el('div.tv-spalte');
    seite.appendChild(el('div.tv-transfer', null, links, rechts));

    links.appendChild(marktPanel(state, club, ctx));
    rechts.appendChild(sicherBauen('Spielerakte', () => aktePanel(state, club, ctx)));
    rechts.appendChild(sicherBauen('Transfermarkt-Nachrichten', () => nachrichtenPanel(state, club, ctx)));
  },

  onLeave() {
    // Nichts aufzuräumen: keine Timer, keine Listener außerhalb des Baums.
  }
};

/* ==========================================================================
 * 5. Kopfzeile und Kennzahlen
 * ======================================================================== */

function kopfzeile(state, club) {
  const info = sicher(() => TM.fensterInfo(state), { offen: false, name: 'Transferfenster' });
  const unter = info.offen
    ? `${info.name} — noch ${info.tageBisSchluss} Tag(e) bis zum Deadline Day.`
    : `Fenster geschlossen — in ${info.tageBisOeffnung || '?'} Tagen wird wieder telefoniert.`;
  return el('div.tv-seite__kopf', null,
    el('h1.tv-seite__titel', null, 'Transfermarkt'),
    el('div.tv-seite__unter', null,
      `${club.name} · ${unter} Vertragslose dürfen Sie immer holen.`));
}

function kennzahlen(state, club, ctx) {
  const f = club.finances || {};
  const info = sicher(() => TM.fensterInfo(state), { offen: false });
  const bilanz = sicher(() => TM.transferbilanz(state, club.id),
    { einnahmen: 0, ausgaben: 0, saldo: 0, zugaenge: 0, abgaenge: 0, text: 'Noch keine Bewegung auf dem Markt.' });

  const gehaltIst = gehaltssumme(state, club.id);
  const gehaltEtat = Math.max(1, f.wageBudget || Math.round(gehaltIst * 1.15));
  const auslastung = clamp((gehaltIst / gehaltEtat) * 100, 0, 140);
  const kader = club.playerIds ? club.playerIds.length : 0;
  const frei = verplanbar(club);

  const kacheln = el('div.tv-grid.tv-grid--4', null,
    statBox('Transferbudget', formatMoney(f.transferBudget || 0), {
      sub: `verplanbar: ${formatMoney(frei)}`,
      kind: frei <= 0 ? 'schlecht' : frei < 1000000 ? 'warn' : 'gut',
      tooltip: 'Gedeckelt durch den Kontostand — mehr als die Kasse hergibt, gibt niemand frei.'
    }),
    statBox('Kontostand', formatMoney(f.balance || 0), {
      sub: (f.debt || 0) > 0 ? `Schulden: ${formatMoney(f.debt)}` : 'schuldenfrei',
      kind: (f.balance || 0) < 0 ? 'schlecht' : 'gut'
    }),
    statBox('Kadergröße', `${kader}`, {
      sub: `erlaubt: ${KADER_MIN}–${KADER_MAX} Profis`,
      kind: kader >= KADER_MAX ? 'schlecht' : kader <= KADER_MIN ? 'warn' : undefined,
      tooltip: kader >= KADER_MAX
        ? 'Voll. Erst ausmisten, dann einkaufen.'
        : kader <= KADER_MIN ? 'Dünn. Ein Muskelfaserriss und die Jugend spielt.' : 'Solide besetzt.'
    }),
    statBox('Transferbilanz', formatMoney(bilanz.saldo), {
      sub: `${bilanz.zugaenge} Zugänge / ${bilanz.abgaenge} Abgänge`,
      kind: bilanz.saldo >= 0 ? 'gut' : 'warn',
      tooltip: bilanz.text
    })
  );

  const gehaltsBlock = el('div', { style: { marginTop: '8px' } },
    balken(gehaltIst, gehaltEtat, {
      label: 'Gehaltsetat (Jahresgehälter)',
      valueText: `${formatMoney(gehaltIst)} von ${formatMoney(gehaltEtat)}`,
      color: auslastung >= 100 ? 'var(--rot)' : auslastung >= 88 ? 'var(--gold)' : 'var(--gruen-600)',
      height: 14,
      tooltip: 'Wer über dem Etat liegt, bekommt vom Vorstand Post — und keinen neuen Spieler.'
    }),
    el('div.tv-mini', { style: { marginTop: '3px' } },
      auslastung >= 100
        ? '⚠ Der Etat ist gesprengt. Neue Verträge muss der Vorstand einzeln absegnen — mit Betonung auf „muss nicht".'
        : `Luft für neue Gehälter: ${formatMoney(Math.max(0, gehaltEtat - gehaltIst))} pro Jahr.`)
  );

  const fensterBlock = fensterAnzeige(state, info);

  const kopf = el('span', null, '💰 Kassensturz & Transferfenster');
  return panel(kopf, kacheln, gehaltsBlock, fensterBlock);
}

function fensterAnzeige(state, info) {
  const wrap = el('div.tv-subpanel', { style: { marginTop: '8px' } });
  const kopf = el('div.tv-zeile.tv-zeile--verteilt');

  if (info.offen) {
    const tage = info.tageBisSchluss;
    const art = tage <= 0 ? 'schlecht' : tage <= 7 ? 'warn' : 'gut';
    kopf.appendChild(el('div.tv-zeile', null,
      pill(info.name || 'Transferfenster', 'gut'),
      el('b', null, tage <= 0 ? 'DEADLINE DAY — heute um Mitternacht ist Schluss!' : `Noch ${tage} Tag(e) bis zum Deadline Day`),
      pill(tage <= 0 ? 'letzte Chance' : tage <= 7 ? 'Endspurt' : 'in Ruhe', art)));
    // Fensterlänge grob: Sommer 63, Winter 32 Tage — hier nur als Fortschritt.
    const gesamt = info.art === 'winter' ? 32 : 63;
    const verbraucht = clamp(gesamt - tage, 0, gesamt);
    wrap.appendChild(kopf);
    wrap.appendChild(balken(verbraucht, gesamt, {
      label: 'Fensterfortschritt', valueText: `${verbraucht} von ${gesamt} Tagen`, height: 12,
      color: tage <= 7 ? 'var(--rot)' : 'var(--blau)'
    }));
    wrap.appendChild(el('div.tv-mini', { style: { marginTop: '4px' } },
      tage <= 0
        ? 'Am Deadline Day werden Ablösen teurer und Berater unverschämter. Willkommen im Zirkus.'
        : 'Achtung: Nach Fensterschluss geht nur noch die Verpflichtung vertragsloser Spieler.'));
  } else {
    kopf.appendChild(el('div.tv-zeile', null,
      pill('Fenster geschlossen', 'schlecht'),
      el('b', null, `Noch ${info.tageBisOeffnung !== undefined ? info.tageBisOeffnung : '?'} Tag(e) bis zur Öffnung`)));
    wrap.appendChild(kopf);
    wrap.appendChild(el('div.tv-mini', { style: { marginTop: '4px' } },
      'Beobachten, verhandeln und Verträge verlängern dürfen Sie trotzdem. ' +
      'Und wer vertragslos ist, unterschreibt auch im Februar.'));
  }
  return wrap;
}

/* ==========================================================================
 * 6. Das Reiterpanel
 * ======================================================================== */

function marktPanel(state, club, ctx) {
  const ausgehend = sicher(() => TM.offeneAngebote(state, club.id, 'ausgehend'), []);
  const eingehend = sicher(() => TM.offeneAngebote(state, club.id, 'eingehend'), []);
  const verhandlungen = sicher(() => TM.laufendeVerhandlungen(state, club.id), []);
  const auslaufend = sicher(() => TM.auslaufendeVertraege(state, club.id, { jahre: 1 }), []);
  const beobachtet = sicher(() => TM.beobachteteSpieler(state, club.id), []);

  const badge = (n) => (n > 0 ? String(n) : '');

  const liste = [
    {
      id: 'suche', label: 'Spielersuche',
      render: () => sicherBauen('Spielersuche', () => tabSuche(state, club, ctx))
    },
    {
      id: 'angebote', label: 'Meine Angebote', badge: badge(ausgehend.length + verhandlungen.filter(v => v.kaeuferId === club.id).length),
      render: () => sicherBauen('Meine Angebote', () => tabMeineAngebote(state, club, ctx))
    },
    {
      id: 'eingehend', label: 'Angebote für meine Spieler', badge: badge(eingehend.length),
      render: () => sicherBauen('Eingehende Angebote', () => tabEingehend(state, club, ctx))
    },
    {
      id: 'vertraege', label: 'Verträge', badge: badge(auslaufend.filter(e => e.laeuftAus).length),
      render: () => sicherBauen('Verträge', () => tabVertraege(state, club, ctx))
    },
    {
      id: 'scouting', label: 'Scouting', badge: badge(beobachtet.length),
      render: () => sicherBauen('Scouting', () => tabScouting(state, club, ctx))
    },
    {
      id: 'leihen', label: 'Leihen',
      render: () => sicherBauen('Leihen', () => tabLeihen(state, club, ctx))
    }
  ];

  const t = reiterLeiste(liste, {
    active: zustand.reiter,
    keepAlive: false,
    onChange: (id) => { zustand.reiter = id; }
  });

  const kopf = el('span', null, '🗃️ Transferabteilung',
    el('span', { style: { marginLeft: 'auto', fontWeight: '400', letterSpacing: '.3px', textTransform: 'none', opacity: '.9' } },
      `${Object.keys(state.players || {}).length} Spieler in der Kartei`));
  kopf.style.display = 'flex';
  kopf.style.width = '100%';
  kopf.style.alignItems = 'center';
  kopf.style.gap = '8px';

  return panel(kopf, t);
}

/* ==========================================================================
 * 7. Reiter 1 — Spielersuche
 * ======================================================================== */

function tabSuche(state, club, ctx) {
  braucht('transferliste');

  const wrap = el('div.tv-spalte');
  const ergebnisHuelle = el('div');

  const neuLaden = () => {
    ergebnisHuelle.replaceChildren(sicherBauen('Ergebnisliste', () => ergebnisTabelle(state, club, ctx)));
  };

  wrap.appendChild(filterLeiste(state, club, neuLaden));
  wrap.appendChild(ergebnisHuelle);
  neuLaden();
  return wrap;
}

function filterLeiste(state, club, neuLaden) {
  const f = zustand.filter;

  const setzen = (feld) => (ev) => {
    f[feld] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
    neuLaden();
  };

  const auswahl = (feld, eintraege, titel) => el('select', {
    title: titel || '', onChange: setzen(feld)
  }, ...eintraege.map(([v, t]) => el('option', { value: v, selected: String(f[feld]) === String(v) }, t)));

  // Positionen mit Gruppenüberschrift
  const posSelect = el('select', { title: 'Position', onChange: setzen('position') },
    el('option', { value: '', selected: !f.position }, 'Alle Positionen'),
    ...POSITIONS.map(p => el('option', { value: p, selected: f.position === p },
      `${p} — ${POSITION_NAMES[p] || p}`)));

  // Nationen: nur die, die es im Spiel wirklich gibt.
  const nationen = new Set();
  for (const id in state.players) {
    const p = state.players[id];
    if (p && p.nationality) nationen.add(p.nationality);
  }
  const nationsListe = sortBy(Array.from(nationen), c => nationText(c))
    .map(c => [c, nationText(c)]);

  const ligen = [['', 'Alle Ligen'], ...LEAGUE_IDS.map(id => [id, LEAGUES[id].name]), ['frei', 'Ohne Verein / vertragslos']];

  const status = [
    ['', 'Vertragsstatus egal'],
    ['vertragslos', 'vertragslos'],
    ['auslaufend', 'Vertrag läuft aus'],
    ['gelistet', 'auf der Transferliste'],
    ['wechselwunsch', 'mit Wechselwunsch'],
    ['langfristig', 'langfristig gebunden']
  ];

  const zahlFeld = (feld, platzhalter, breite) => el('input', {
    type: 'number', min: '15', max: '45', placeholder: platzhalter,
    value: f[feld] || '', style: { width: breite || '58px' },
    onChange: setzen(feld)
  });

  const suchFeld = el('input', {
    type: 'search', placeholder: 'Name suchen …', value: f.suche || '',
    style: { width: '150px' }
  });
  let tippTimer = null;
  suchFeld.addEventListener('input', () => {
    f.suche = suchFeld.value;
    if (tippTimer) clearTimeout(tippTimer);
    tippTimer = setTimeout(neuLaden, 260);
  });

  const haken = (feld, text, titel) => el('label', {
    class: 'tv-zeile', title: titel || '', style: { fontSize: '11.5px', gap: '4px', cursor: 'pointer' }
  }, el('input', { type: 'checkbox', checked: !!f[feld], onChange: setzen(feld) }), text);

  const leiste = el('div.tv-filter', null,
    posSelect,
    el('span.tv-mini', null, 'Alter'),
    zahlFeld('altVon', 'von'),
    el('span.tv-mini', null, '–'),
    zahlFeld('altBis', 'bis'),
    auswahl('maxAblose', ABLOSE_STUFEN, 'Maximale Ablöse'),
    auswahl('minOvr', STAERKE_STUFEN, 'Mindeststärke (nach unserer Einschätzung)'),
    auswahl('nation', [['', 'Alle Nationen'], ...nationsListe], 'Nationalität'),
    auswahl('liga', ligen, 'Liga'),
    auswahl('status', status, 'Vertragsstatus'),
    suchFeld,
    haken('nurBeobachtet', 'nur beobachtete', 'Nur Spieler, auf die unser Späher schon angesetzt ist'),
    haken('nurMerkliste', 'nur Merkliste', 'Nur der Merkzettel dieser Sitzung'),
    el('span.tv-mini', null, 'Sortierung'),
    auswahl('sortierung', SORTIERUNGEN, 'Sortierung'),
    auswahl('limit', [['30', '30 Treffer'], ['60', '60 Treffer'], ['120', '120 Treffer'], ['200', '200 Treffer']], 'Trefferzahl'),
    button('Zurücksetzen', () => {
      zustand.filter = leererFilter();
      neuLaden();
      // Die Leiste selbst wird beim nächsten Reiteraufbau neu gezeichnet;
      // damit die Felder sofort stimmen, hier direkt austauschen.
      const neu = filterLeiste(state, club, neuLaden);
      if (leiste.parentNode) leiste.parentNode.replaceChild(neu, leiste);
    }, { kind: 'ghost', class: 'tv-btn--klein' })
  );
  return leiste;
}

function suchErgebnisse(state, club) {
  const f = zustand.filter;
  const opts = {
    kaeuferId: club.id,
    limit: Math.max(10, Number(f.limit) || 60),
    sortierung: f.sortierung || 'wert'
  };
  if (f.position) opts.position = f.position;
  if (f.altVon) opts.minAlter = Number(f.altVon);
  if (f.altBis) opts.maxAlter = Number(f.altBis);
  if (f.maxAblose !== '') opts.maxAblose = Number(f.maxAblose);
  if (f.minOvr) opts.minOvr = Number(f.minOvr);
  if (f.nation) opts.nation = f.nation;
  if (f.suche) opts.suche = f.suche;
  if (f.liga === 'frei') opts.vertragslos = true;
  else if (f.liga) opts.liga = f.liga;
  if (f.status === 'vertragslos') opts.vertragslos = true;
  if (f.status === 'gelistet') opts.nurGelistet = true;

  let rows = TM.transferliste(state, opts);

  if (f.status === 'auslaufend') rows = rows.filter(e => e.restlaufzeit <= 0 && !e.vertragslos);
  if (f.status === 'wechselwunsch') rows = rows.filter(e => e.wechselwunsch);
  if (f.status === 'langfristig') rows = rows.filter(e => e.restlaufzeit >= 2);
  if (f.nurBeobachtet) rows = rows.filter(e => e.beobachtet);
  if (f.nurMerkliste) rows = rows.filter(e => zustand.merkliste.has(e.playerId));

  // Scoutwissen einmal je Zeile besorgen — Tabelle und Sortierung nutzen es.
  for (const e of rows) {
    e.bericht = berichtFuer(state, club.id, e.playerId);
    e.eigen = e.clubId === club.id;
    e.anzeigeStaerke = staerkeZahl(e.bericht, e.player, e.eigen);
  }
  return rows;
}

function ergebnisTabelle(state, club, ctx) {
  const rows = suchErgebnisse(state, club);

  const spalten = [
    {
      key: 'bild', label: '', width: 40, sortable: false,
      render: (r) => portrait(state, r.player, 30)
    },
    {
      key: 'name', label: 'Spieler', width: 190,
      sort: (a, b) => a.player.lastName.localeCompare(b.player.lastName, 'de'),
      render: (r) => el('div', { style: { lineHeight: '1.25' } },
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '5px' } },
          el('b', null, kurzName(r.player)),
          istLegende(r.player) ? legendenPille(r.player) : null),
        el('div.tv-mini', null,
          `${nationText(r.player.nationality)} · ${r.player.foot || 'rechts'}`,
          r.wechselwunsch ? ' · will weg' : '',
          r.gelistet ? ' · gelistet' : ''))
    },
    {
      key: 'verein', label: 'Verein', width: 130,
      sort: (a, b) => String(a.clubName).localeCompare(String(b.clubName), 'de'),
      render: (r) => el('div.tv-zeile', { style: { gap: '5px' } },
        wappen(state, r.clubId, 18),
        el('span', null, r.clubName),
        el('span.tv-mini', null, ligaText(r.clubId)))
    },
    { key: 'position', label: 'Pos', width: 44, align: 'center', render: (r) => positionsPille(r.position) },
    { key: 'alter', label: 'Alt', width: 40, numeric: true },
    {
      key: 'anzeigeStaerke', label: 'Stärke', width: 74, numeric: true,
      render: (r) => {
        const txt = staerkeText(r.bericht, r.player, r.eigen);
        const scharf = istScharf(r.bericht, r.player, r.eigen);
        const s = el('span', {
          class: ratingClass(r.anzeigeStaerke) + '-text',
          title: scharf ? 'Gesicherte Einschätzung.' : 'Geschätzt — der Scout war noch nicht oft genug da.'
        }, txt);
        if (!scharf) s.appendChild(el('span.tv-mini', { style: { marginLeft: '3px' } }, '≈'));
        return s;
      }
    },
    {
      key: 'potenzial', label: 'Pot', width: 66, numeric: true,
      render: (r) => el('span', { class: 'tv-mini' }, potenzialText(r.bericht, r.player, r.eigen))
    },
    { key: 'marktwert', label: 'Marktwert', width: 88, numeric: true, render: (r) => formatMoneyShort(r.marktwert) },
    {
      key: 'ablose', label: 'Ablöse', width: 92, numeric: true,
      render: (r) => r.vertragslos
        ? el('span.tv-gut', null, 'ablösefrei')
        : el('span', { class: r.ablose > verplanbar(club) ? 'tv-schlecht' : '' }, formatMoneyShort(r.ablose))
    },
    { key: 'gehalt', label: 'Gehalt/J', width: 82, numeric: true, render: (r) => formatMoneyShort(r.gehalt) },
    {
      key: 'restlaufzeit', label: 'Vertrag', width: 86, numeric: true,
      render: (r) => r.vertragslos
        ? el('span.tv-mini', null, '—')
        : el('span', { class: r.restlaufzeit <= 0 ? 'tv-warnung' : '' },
          r.restlaufzeit <= 0 ? 'läuft aus' : `bis ${state.date.season + r.restlaufzeit}`)
    },
    {
      key: 'bereit', label: 'Chance', width: 74, sortable: false,
      render: (r) => balken(Math.round((r.verkaufsbereit || 0) * 100), 100, {
        showValue: false, compact: true, height: 8,
        tooltip: `Verkaufsbereitschaft von ${r.clubName}: ${Math.round((r.verkaufsbereit || 0) * 100)} %`
      })
    },
    {
      key: 'merk', label: '', width: 30, align: 'center', sortable: false,
      render: (r) => zustand.merkliste.has(r.playerId) ? el('span', { title: 'Auf der Merkliste' }, '📌') : ''
    }
  ];

  const tab = table(spalten, rows, {
    idKey: 'playerId',
    selectedId: zustand.gewaehlt,
    compact: true,
    maxHeight: 430,
    sort: { key: 'marktwert', desc: true },
    emptyText: 'Kein Spieler passt zu diesen Filtern. Entweder sind Sie zu wählerisch — oder zu arm.',
    rowClass: (r) => {
      const k = [];
      if (istLegende(r.player)) k.push('zeile--legende');
      if (r.beobachtet) k.push('tv-fett');
      return k.join(' ');
    },
    onRowClick: (r) => waehleSpieler(r.playerId, ctx)
  });

  const fuss = el('div.tv-zeile.tv-zeile--verteilt', { style: { marginTop: '6px' } },
    el('span.tv-mini', null,
      `${rows.length} Treffer · Stärken mit „≈" sind Schätzungen unseres Scoutings ` +
      `(Anlage: ${club.facilities ? club.facilities.scouting : '?'} / 100).`),
    el('div.tv-zeile', null,
      button('Merkliste leeren', () => {
        zustand.merkliste.clear();
        toast('Der Merkzettel ist wieder leer. Papierkorb dankt.', 'info');
        ctx.refresh();
      }, { kind: 'ghost', class: 'tv-btn--klein', disabled: zustand.merkliste.size === 0 })));

  return el('div', null, tab, fuss);
}

function waehleSpieler(playerId, ctx) {
  zustand.gewaehlt = playerId;
  ctx.refresh();
}

/* ==========================================================================
 * 8. Reiter 2 — Meine Angebote & Verhandlungen
 * ======================================================================== */

function tabMeineAngebote(state, club, ctx) {
  const wrap = el('div.tv-spalte');
  const verhandlungen = sicher(() => TM.laufendeVerhandlungen(state, club.id), [])
    .filter(v => v.kaeuferId === club.id);
  const angebote = sicher(() => TM.offeneAngebote(state, club.id, 'ausgehend'), []);

  if (!verhandlungen.length && !angebote.length) {
    wrap.appendChild(el('div.tv-leer', null,
      'Kein einziges Angebot draußen. Der Kader gewinnt sich nicht von allein — ' +
      'schauen Sie in der Spielersuche vorbei.'));
    return wrap;
  }

  if (verhandlungen.length) {
    const box = el('div.tv-spalte');
    for (const v of verhandlungen) box.appendChild(verhandlungsKarte(state, club, ctx, v));
    wrap.appendChild(subpanel(`Laufende Verhandlungen (${verhandlungen.length})`, box));
  }

  const offen = angebote.filter(a => !a.angebot.verhandlungId || a.angebot.status !== 'verhandlung');
  if (offen.length) {
    wrap.appendChild(subpanel(`Abgegebene Angebote (${offen.length})`, angebotsTabelle(state, club, ctx, offen)));
  }

  return wrap;
}

const STATUS_TEXT = {
  offen: ['liegt auf dem Tisch', 'info'],
  ueberlegt: ['der Vorstand berät', 'warn'],
  verhandlung: ['in Verhandlung', 'warn'],
  angenommen: ['angenommen — Spieler fehlt noch', 'gut'],
  abgelehnt: ['abgelehnt', 'schlecht'],
  geplatzt: ['geplatzt', 'schlecht'],
  verfallen: ['verfallen', 'schlecht'],
  abgebrochen: ['abgebrochen', 'schlecht'],
  vollzogen: ['vollzogen', 'gut']
};

/**
 * Aus Sicht des eingehenden Angebots heißt „angenommen" etwas anderes: Dort hat
 * die Verkäuferlogik des Moduls bereits selbst zugestimmt, bevor der Manager
 * gefragt wurde — annehmen lässt sich so ein Angebot dann nicht mehr.
 * Deshalb ist die Beschriftung richtungsabhängig.
 */
function statusInfo(status, richtung) {
  if (richtung === 'eingehend' && status === 'angenommen') {
    return ['bereits abgehakt — nicht mehr entscheidbar', 'warn'];
  }
  return STATUS_TEXT[status] || [status, 'neutral'];
}

function statusPille(status, richtung) {
  const [text, art] = statusInfo(status, richtung);
  return pill(text, art);
}

function angebotsTabelle(state, club, ctx, eintraege) {
  const spalten = [
    { key: 'bild', label: '', width: 38, sortable: false, render: (r) => portrait(state, r.player, 28) },
    {
      key: 'name', label: 'Spieler', width: 170,
      render: (r) => el('div', null,
        el('div.tv-zeile', { style: { gap: '5px' } }, el('b', null, kurzName(r.player)), legendenPille(r.player)),
        el('div.tv-mini', null, `${POSITION_NAMES[r.player.position] || r.player.position}, ${r.player.age} Jahre`))
    },
    {
      key: 'gegner', label: 'Verein', width: 140,
      render: (r) => el('div.tv-zeile', { style: { gap: '5px' } }, wappen(state, r.gegner, 18), vereinsName(state, r.gegner))
    },
    { key: 'gebot', label: 'Unser Gebot', width: 100, numeric: true, render: (r) => formatMoney(r.angebot.ablose) },
    { key: 'marktwert', label: 'Marktwert', width: 96, numeric: true, render: (r) => formatMoney(r.marktwert) },
    { key: 'status', label: 'Stand', width: 150, sortable: false, render: (r) => statusPille(r.angebot.status, 'ausgehend') },
    {
      key: 'frist', label: 'Frist', width: 70, sortable: false,
      render: (r) => {
        const tage = (r.angebot.ablaufTag || 0) - state.date.day;
        return el('span', { class: tage <= 1 ? 'tv-warnung' : 'tv-mini' }, tage > 0 ? `${tage} Tg.` : 'heute');
      }
    },
    {
      key: 'aktion', label: '', width: 150, sortable: false,
      render: (r) => aktionsKnoepfeAusgehend(state, club, ctx, r)
    }
  ];

  return table(spalten, eintraege, {
    idKey: 'playerId', compact: true, selectedId: zustand.gewaehlt,
    rowClass: (r) => (istLegende(r.player) ? 'zeile--legende' : ''),
    emptyText: 'Keine offenen Angebote.',
    onRowClick: (r, i, ev) => { if (!ev.target.closest('button')) waehleSpieler(r.playerId, ctx); }
  });
}

function aktionsKnoepfeAusgehend(state, club, ctx, r) {
  const reihe = el('div.tv-zeile', { style: { gap: '4px' } });
  if (r.angebot.status === 'angenommen') {
    reihe.appendChild(button('Vertrag!', () => dlgVertrag(state, club, ctx, r.player, {
      modus: 'verpflichten', ablose: r.angebot.ablose
    }), { kind: 'primary', class: 'tv-btn--klein', tooltip: 'Der Verein ist einverstanden — jetzt muss der Spieler unterschreiben.' }));
  }
  if (r.angebot.status === 'verhandlung' && r.angebot.verhandlungId) {
    reihe.appendChild(button('Verhandeln', () => { zustand.reiter = 'angebote'; ctx.refresh(); },
      { kind: 'ghost', class: 'tv-btn--klein' }));
  }
  reihe.appendChild(button('Akte', () => waehleSpieler(r.playerId, ctx), { kind: 'ghost', class: 'tv-btn--klein' }));
  return reihe;
}

/** Eine Verhandlung mit Stimmungsanzeige und Verhandlungsknöpfen. */
function verhandlungsKarte(state, club, ctx, v) {
  const p = state.players[v.playerId];
  const gegner = vereinsName(state, v.verkaeuferId);
  const stimmung = clamp(Math.round(v.stimmung || 50), 0, 100);

  const zeiger = el('div.tv-verhandlung__zeiger', { style: { left: `calc(${stimmung}% - 2px)` } });
  const skala = el('div.tv-verhandlung__stimmung', null, zeiger);

  const stimmungsWort = stimmung >= 80 ? 'bestens gelaunt'
    : stimmung >= 62 ? 'aufgeschlossen'
      : stimmung >= 45 ? 'sachlich'
        : stimmung >= 30 ? 'zugeknöpft'
          : stimmung >= 18 ? 'sichtlich genervt' : 'kurz vor dem Türknallen';

  const luecke = Math.max(0, (v.forderung || 0) - (v.gebot || 0));

  const kopf = el('div.tv-zeile', { style: { gap: '9px', alignItems: 'flex-start' } },
    portrait(state, p, 46),
    el('div', { style: { flex: '1', minWidth: '0' } },
      el('div.tv-zeile', { style: { gap: '6px' } },
        el('b', { style: { fontSize: '15px' } }, vollerName(p)),
        legendenPille(p),
        p ? positionsPille(p.position) : null),
      el('div.tv-mini', null,
        `${gegner} · ${p ? p.age : '?'} Jahre · Runde ${v.runde || 0} von 8 · Geduld ${Math.max(0, Math.round((v.geduld || 0) * 10) / 10)}`)),
    el('div', { style: { textAlign: 'right' } },
      el('div.tv-mini', null, 'Forderung'),
      el('b.tv-num', { style: { fontSize: '15px' } }, formatMoney(v.forderung || 0))));

  const zahlen = el('div.tv-grid.tv-grid--3', { style: { gap: '6px', marginTop: '6px' } },
    statBox('Unser Gebot', formatMoney(v.gebot || 0), { sub: v.raten > 1 ? `in ${v.raten} Raten` : 'sofort fällig' }),
    statBox('Differenz', formatMoney(luecke), { kind: luecke > 0 ? 'warn' : 'gut', sub: luecke > 0 ? 'so weit auseinander' : 'praktisch einig' }),
    statBox('Boni obendrauf', formatMoney(v.bonus || 0), { sub: 'zählen nur anteilig' }));

  const knoepfe = el('div.tv-zeile', { style: { flexWrap: 'wrap', gap: '5px', marginTop: '8px' } },
    button('Gebot erhöhen', () => dlgErhoehen(state, club, ctx, v),
      { kind: 'primary', class: 'tv-btn--klein', tooltip: 'Kostet Geld, hebt aber die Stimmung.' }),
    button('Hart bleiben', () => runde(state, ctx, v, 'halten'),
      { kind: 'ghost', class: 'tv-btn--klein', tooltip: 'Nichts nachlegen. Kann den Gegner weichkochen — oder die Stimmung ruinieren.' }),
    button('Druck machen', () => runde(state, ctx, v, 'druck'),
      { kind: 'ghost', class: 'tv-btn--klein', tooltip: 'Auf die Vertragslage hinweisen. Wirkt — oder knallt.' }),
    button('Bonus anbieten', () => dlgBonus(state, club, ctx, v),
      { kind: 'ghost', class: 'tv-btn--klein', tooltip: 'Erfolgsabhängige Zahlungen. Der Gegner nickt anerkennend.' }),
    button('Ratenzahlung', () => dlgRaten(state, club, ctx, v),
      { kind: 'ghost', class: 'tv-btn--klein', tooltip: 'Schont die Kasse, erhöht aber die Forderung.' }),
    button('Abbrechen', async () => {
      const ja = await dialog('Verhandlung abbrechen?',
        el('p', null, `Wir legen bei ${gegner} auf. ${kurzName(p)} ist damit vorerst vom Tisch.`),
        [{ label: 'Weiterreden', value: false, kind: 'ghost' }, { label: 'Auflegen', value: true, kind: 'danger' }],
        { escValue: false, size: 'sm' });
      if (ja) runde(state, ctx, v, 'abbrechen');
    }, { kind: 'danger', class: 'tv-btn--klein' })
  );

  const verlauf = Array.isArray(v.historie) && v.historie.length
    ? el('div.tv-mini', { style: { marginTop: '6px' } },
      'Verlauf: ' + v.historie.slice(-4).map(h =>
        `R${h.runde} ${h.aktion} → ${formatMoneyShort(h.gebot)} (Stimmung ${h.stimmung})`).join('  ·  '))
    : null;

  return el('div.tv-subpanel.tv-verhandlung', { style: { marginBottom: '8px' } },
    kopf,
    el('div', { style: { marginTop: '8px' } },
      el('div.tv-zeile.tv-zeile--verteilt', { style: { marginBottom: '3px' } },
        el('span.tv-mini', null, 'Stimmung am Verhandlungstisch'),
        el('b', { class: stimmung >= 45 ? 'tv-gut' : 'tv-schlecht' }, stimmungsWort)),
      skala),
    zahlen, knoepfe, verlauf);
}

function runde(state, ctx, v, aktion, wert) {
  const fn = TM.verhandlungRunde;
  if (typeof fn !== 'function') {
    toast('verhandlungRunde() fehlt in club/transfers.js — Verhandeln ist derzeit nicht möglich.', 'schlecht');
    return;
  }
  const res = sicher(() => fn(state, v.id, aktion, wert), null);
  if (!res) { toast('Die Verhandlung antwortet nicht mehr.', 'schlecht'); return; }
  const art = res.status === 'einig' ? 'gut'
    : res.status === 'geplatzt' ? 'schlecht'
      : res.status === 'abgebrochen' ? 'warn' : 'info';
  meldeErgebnis(Object.assign({ ok: true }, res), ctx, { art });
}

async function dlgErhoehen(state, club, ctx, v) {
  const p = state.players[v.playerId];
  const frei = verplanbar(club);
  const provision = sicher(() => TM.beraterProvision(state, v.playerId, v.forderung || 0), 0);
  let feld = null;
  const hinweis = el('div.tv-mini', { style: { marginTop: '6px' } });

  const pruefe = () => {
    const b = auf50k(zahlAus(feld, 0));
    const gesamt = b + provision;
    hinweis.className = gesamt > frei ? 'tv-schlecht' : 'tv-mini';
    hinweis.textContent = gesamt > frei
      ? `⚠ ${formatMoney(gesamt)} inklusive Beraterprovision — verplanbar sind nur ${formatMoney(frei)}.`
      : `Gesamtbelastung inklusive Beraterprovision: ${formatMoney(gesamt)} von ${formatMoney(frei)}.`;
  };

  const wert = await dialog(`Gebot für ${kurzName(p)} erhöhen`,
    el('div.tv-spalte', null,
      el('p', null, `Aktuell bieten wir ${formatMoney(v.gebot || 0)}, gefordert werden ${formatMoney(v.forderung || 0)}.`),
      el('label.tv-zeile', null, el('span', { style: { width: '130px' } }, 'Neues Gebot'),
        (feld = el('input', {
          type: 'number', step: '50000', min: String(v.gebot || 0),
          value: String(v.forderung || v.gebot || 0), style: { width: '160px' },
          onInput: () => pruefe()
        }))),
      el('div.tv-zeile', { style: { gap: '5px', flexWrap: 'wrap' } },
        button('= Forderung', () => { feld.value = String(v.forderung || 0); pruefe(); }, { kind: 'ghost', class: 'tv-btn--klein' }),
        button('Mitte', () => { feld.value = String(auf50k(((v.gebot || 0) + (v.forderung || 0)) / 2)); pruefe(); }, { kind: 'ghost', class: 'tv-btn--klein' }),
        button('+ 5 %', () => { feld.value = String(auf50k((v.gebot || 0) * 1.05)); pruefe(); }, { kind: 'ghost', class: 'tv-btn--klein' })),
      hinweis,
      el('div.tv-mini', null, 'Ein spürbarer Sprung hebt die Stimmung deutlich stärker als ein Trostpflaster.')),
    [
      { label: 'Abbrechen', value: null, kind: 'ghost' },
      { label: 'Gebot abgeben', kind: 'primary', onClick: () => auf50k(zahlAus(feld, 0)) }
    ], { escValue: null, size: 'sm', onOpen: () => pruefe() });

  if (wert !== null && wert !== undefined) runde(state, ctx, v, 'erhoehen', wert);
}

async function dlgBonus(state, club, ctx, v) {
  const p = state.players[v.playerId];
  let feld = null;
  const wert = await dialog(`Bonus für ${kurzName(p)}`,
    el('div.tv-spalte', null,
      el('p', null, 'Erfolgsabhängige Zahlungen kosten heute nichts und machen den Gegner milde. ' +
        'Angerechnet werden sie allerdings nur zu gut der Hälfte.'),
      el('label.tv-zeile', null, el('span', { style: { width: '130px' } }, 'Bonussumme'),
        (feld = el('input', { type: 'number', step: '50000', min: '0', value: String(auf50k((v.forderung || 0) * 0.1)), style: { width: '160px' } })))),
    [
      { label: 'Abbrechen', value: null, kind: 'ghost' },
      { label: 'Bonus anbieten', kind: 'primary', onClick: () => auf50k(zahlAus(feld, 0)) }
    ], { escValue: null, size: 'sm' });
  if (wert !== null && wert !== undefined && wert > 0) runde(state, ctx, v, 'bonus', wert);
}

async function dlgRaten(state, club, ctx, v) {
  let feld = null;
  const wert = await dialog('Zahlung in Raten',
    el('div.tv-spalte', null,
      el('p', null, 'Ratenzahlung schont die Kasse — der Gegner schlägt dafür pro Rate rund 6 % auf die Forderung auf.'),
      el('label.tv-zeile', null, el('span', { style: { width: '130px' } }, 'Anzahl Raten'),
        (feld = el('select', { style: { width: '160px' } },
          ...[1, 2, 3, 4, 5].map(n => el('option', { value: String(n), selected: n === (v.raten || 1) },
            n === 1 ? '1 — sofort in einer Summe' : `${n} Raten`)))))),
    [
      { label: 'Abbrechen', value: null, kind: 'ghost' },
      { label: 'Übernehmen', kind: 'primary', onClick: () => Number(feld.value) }
    ], { escValue: null, size: 'sm' });
  if (wert) runde(state, ctx, v, 'raten', wert);
}

/* ==========================================================================
 * 9. Reiter 3 — Angebote für meine Spieler
 * ======================================================================== */

function tabEingehend(state, club, ctx) {
  const eintraege = sicher(() => TM.offeneAngebote(state, club.id, 'eingehend'), []);
  const wrap = el('div.tv-spalte');

  if (!eintraege.length) {
    wrap.appendChild(el('div.tv-leer', null,
      'Niemand will unsere Spieler. Das ist entweder ein Kompliment an die Vertragslage — ' +
      'oder ein vernichtendes Urteil über den Kader.'));
    wrap.appendChild(el('div.tv-mini', { style: { textAlign: 'center' } },
      'Tipp: Wer verkaufen will, setzt Spieler in der Akte auf die Transferliste. Das spricht sich herum.'));
    return wrap;
  }

  const legenden = eintraege.filter(e => istLegende(e.player));
  if (legenden.length) {
    wrap.appendChild(el('div.tv-subpanel', {
      style: { borderLeft: '5px solid var(--gold)', background: 'rgba(217,165,33,.18)' }
    },
    el('b', null, '⚠ Achtung: Es liegen Angebote für Vereinsikonen vor'),
    el('div.tv-mini', { style: { marginTop: '3px' } },
      `Betroffen: ${legenden.map(e => kurzName(e.player)).join(', ')}. ` +
      'Wer eine Legende verkauft, kann sich den Weihnachtsempfang der Fanabteilung sparen.')));
  }

  for (const e of eintraege) wrap.appendChild(eingehendeKarte(state, club, ctx, e));
  return wrap;
}

function eingehendeKarte(state, club, ctx, e) {
  const p = e.player;
  const kaeufer = state.clubs[e.gegner];
  const details = sicher(() => TM.abloseDetails(state, p.id, e.gegner), null);
  const forderung = details ? details.forderung : e.marktwert;
  const rolle = sicher(() => TM.kaderRolle(state, p.id), 'rotation');
  const verhaeltnis = forderung > 0 ? e.angebot.ablose / forderung : 1;
  const bewertung = verhaeltnis >= 1.15 ? ['sehr gutes Angebot', 'gut']
    : verhaeltnis >= 0.95 ? ['faires Angebot', 'gut']
      : verhaeltnis >= 0.75 ? ['unter Wert', 'warn'] : ['eine Frechheit', 'schlecht'];

  const entscheidbar = e.angebot.status === 'offen' || e.angebot.status === 'verhandlung';

  const kopf = el('div.tv-zeile', { style: { gap: '10px', alignItems: 'flex-start' } },
    portrait(state, p, 52),
    el('div', { style: { flex: '1', minWidth: '0' } },
      el('div.tv-zeile', { style: { gap: '6px', flexWrap: 'wrap' } },
        el('b', { style: { fontSize: '15px' } }, vollerName(p)),
        legendenPille(p), positionsPille(p.position),
        pill(ROLLEN_TEXT[rolle] || rolle, rolle === 'star' ? 'warn' : 'neutral')),
      el('div.tv-mini', null,
        `${p.age} Jahre · Stärke ${playerOverall(p)} · Marktwert ${formatMoney(e.marktwert)} · ` +
        `Vertrag bis Saison ${p.contract ? p.contract.until : '?'} · Gehalt ${formatMoney(p.contract ? p.contract.salary : 0)}`)),
    el('div', { style: { textAlign: 'right' } },
      el('div.tv-mini', null, 'Gebot von ' + vereinsName(state, e.gegner)),
      el('b.tv-num', { style: { fontSize: '18px' } }, formatMoney(e.angebot.ablose)),
      el('div', null, pill(bewertung[0], bewertung[1]))));

  const zahlen = el('div.tv-grid.tv-grid--3', { style: { gap: '6px', marginTop: '7px' } },
    statBox('Unsere Verhandlungsbasis', formatMoney(forderung), { sub: details ? ROLLEN_TEXT[details.rolle] || '' : '' }),
    statBox('Stand', statusInfo(e.angebot.status, 'eingehend')[0], {
      sub: `Frist: noch ${Math.max(0, (e.angebot.ablaufTag || 0) - state.date.day)} Tag(e)`,
      kind: entscheidbar ? undefined : 'warn'
    }),
    statBox('Interessent', vereinsName(state, e.gegner), {
      sub: kaeufer ? `Ruf ${kaeufer.reputation || '?'} · ${ligaText(kaeufer.id)}` : ''
    }));

  const hinweise = el('div.tv-mini', { style: { marginTop: '6px', lineHeight: '1.5' } });
  const zeilen = [];
  if (details && details.text) zeilen.push(details.text);
  if (istLegende(p)) zeilen.push('⚠ Vereinsikone: Ein Verkauf treibt die Ultras auf die Barrikaden und kostet massiv Fanstimmung.');
  if ((p.traits || []).includes('fanliebling')) zeilen.push('⚠ Fanliebling: Auf den Rängen wird man das nicht verstehen.');
  if (rolle === 'star' || rolle === 'stamm') zeilen.push('Er ist Stammpersonal — ohne Ersatz wird die Elf schmaler.');
  if (!entscheidbar) {
    zeilen.push('Hinweis: Dieses Angebot hat die Geschäftsstelle bereits selbst abgehakt — ' +
      'annehmen oder ablehnen lässt es sich nicht mehr. Es verfällt von allein.');
  }
  hinweise.textContent = zeilen.join(' ');

  const knoepfe = el('div.tv-zeile', { style: { gap: '5px', marginTop: '8px', flexWrap: 'wrap' } },
    button('Annehmen', () => angebotAnnehmenMitWarnung(state, club, ctx, e),
      { kind: 'primary', class: 'tv-btn--klein', disabled: !entscheidbar }),
    button('Ablehnen', async () => {
      const ja = await dialog('Angebot ablehnen?',
        el('p', null, `${vereinsName(state, e.gegner)} bekommt eine Absage für ${kurzName(p)}. Das war's dann fürs Erste.`),
        [{ label: 'Doch nicht', value: false, kind: 'ghost' }, { label: 'Ablehnen', value: true, kind: 'danger' }],
        { escValue: false, size: 'sm' });
      if (!ja) return;
      meldeErgebnis(sicher(() => TM.angebotAblehnen(state, e.angebot.id), null), ctx, { art: 'info' });
    }, { kind: 'danger', class: 'tv-btn--klein', disabled: !entscheidbar }),
    button('Nachverhandeln', () => dlgNachverhandeln(state, club, ctx, e, forderung),
      { kind: 'ghost', class: 'tv-btn--klein', disabled: !entscheidbar }),
    button('Akte öffnen', () => waehleSpieler(p.id, ctx), { kind: 'ghost', class: 'tv-btn--klein' }));

  return el('div.tv-subpanel', {
    style: istLegende(p)
      ? { marginBottom: '8px', borderLeft: '5px solid var(--gold)', background: 'linear-gradient(90deg, rgba(217,165,33,.22), rgba(255,255,255,.35) 55%)' }
      : { marginBottom: '8px' }
  }, kopf, zahlen, hinweise, knoepfe);
}

async function angebotAnnehmenMitWarnung(state, club, ctx, e) {
  const p = e.player;
  // Wer die Bestätigungen abgeschaltet hat (Einstellungen), will auch beim
  // Verkauf einer Legende nicht gefragt werden. Die Folgen bleiben dieselben.
  if (!bestaetigungenAktiv()) {
    meldeErgebnis(sicher(() => TM.angebotAnnehmen(state, e.angebot.id), null), ctx);
    return;
  }
  if (istLegende(p)) {
    const ja = await dialog('Eine Legende verkaufen?',
      el('div.tv-spalte', null,
        el('div.tv-zeile', { style: { gap: '10px' } },
          portrait(state, p, 64, true),
          el('div', null,
            el('b', { style: { fontSize: '16px' } }, vollerName(p)),
            el('div', null, pill(p.eraLabel || 'Legende', 'legende')),
            el('div.tv-mini', { style: { marginTop: '4px' } },
              `${POSITION_NAMES[p.position] || p.position} · Stärke ${playerOverall(p)} · Marktwert ${formatMoney(e.marktwert)}`))),
        el('p', { style: { fontWeight: '700', color: 'var(--rot)' } },
          'Das ist keine Personalie, das ist ein Denkmalsturz.'),
        el('p', null,
          `Wenn ${vollerName(p)} für ${formatMoney(e.angebot.ablose)} geht, brennen vor der Geschäftsstelle ` +
          'Transparente. Die Fanstimmung stürzt ab, der Protestpegel schnellt hoch, und der Vorstand ' +
          'erinnert sich beim nächsten Fehlstart sehr genau daran, wer das unterschrieben hat.'),
        el('p.tv-mini', null, 'Sie können das tun. Sie sollten sich nur sicher sein.')),
      [
        { label: 'Bloß nicht', value: false, kind: 'primary' },
        { label: 'Trotzdem verkaufen', value: true, kind: 'danger' }
      ], { escValue: false, size: 'md' });
    if (!ja) { toast('Vernünftig. Die Kurve dankt.', 'gut'); return; }
  } else if ((p.traits || []).includes('fanliebling')) {
    const ja = await dialog('Fanliebling abgeben?',
      el('p', null, `${vollerName(p)} ist auf den Rängen beliebt. Ein Verkauf kostet Stimmung. Trotzdem machen?`),
      [{ label: 'Nein', value: false, kind: 'ghost' }, { label: 'Verkaufen', value: true, kind: 'danger' }],
      { escValue: false, size: 'sm' });
    if (!ja) return;
  }
  meldeErgebnis(sicher(() => TM.angebotAnnehmen(state, e.angebot.id), null), ctx);
}

async function dlgNachverhandeln(state, club, ctx, e, forderung) {
  const p = e.player;
  const differenz = Math.max(0, forderung - e.angebot.ablose);
  const ja = await dialog(`Nachverhandeln: ${kurzName(p)}`,
    el('div.tv-spalte', null,
      el('div.tv-grid.tv-grid--3', { style: { gap: '6px' } },
        statBox('Ihr Gebot', formatMoney(e.angebot.ablose)),
        statBox('Unsere Forderung', formatMoney(forderung), { kind: 'warn' }),
        statBox('Differenz', formatMoney(differenz), { kind: differenz > 0 ? 'schlecht' : 'gut' })),
      el('p', null,
        `Wir lehnen ab und lassen ausrichten, dass unter ${formatMoney(forderung)} nichts läuft. ` +
        `Ob ${vereinsName(state, e.gegner)} noch einmal anruft, entscheidet der Verein selbst — ` +
        'ein Nachschlag ist wahrscheinlicher, wenn der Bedarf dort wirklich drückt.'),
      el('p.tv-mini', null,
        'Ehrlich gesagt: Aus Sicht der Regeln ist das eine Ablehnung mit Preisschild. ' +
        'Ein Gegenangebot erzwingen kann die Geschäftsstelle nicht.')),
    [
      { label: 'Abbrechen', value: false, kind: 'ghost' },
      { label: 'Forderung ausrichten', value: true, kind: 'primary' }
    ], { escValue: false, size: 'sm' });
  if (!ja) return;
  const res = sicher(() => TM.angebotAblehnen(state, e.angebot.id), null);
  if (res && res.ok) {
    res.text = `Abgelehnt. Wir haben ${vereinsName(state, e.gegner)} ausrichten lassen: ` +
      `unter ${formatMoney(forderung)} braucht man gar nicht erst anzurufen.`;
  }
  meldeErgebnis(res, ctx, { art: 'info' });
}

/* ==========================================================================
 * 10. Reiter 4 — Verträge
 * ======================================================================== */

function tabVertraege(state, club, ctx) {
  braucht('auslaufendeVertraege');
  const alle = TM.auslaufendeVertraege(state, club.id, { jahre: 1 });
  const wrap = el('div.tv-spalte');

  const kritisch = alle.filter(e => e.laeuftAus);
  const unruhe = kaderVon(state, club.id).filter(p =>
    (p.transfer && p.transfer.wunschWechsel) ||
    (p.happiness && p.happiness.spielzeit < 35));

  if (kritisch.length || unruhe.length) {
    const punkte = el('div.tv-spalte', { style: { gap: '3px' } });
    if (kritisch.length) {
      punkte.appendChild(el('div', null,
        el('b.tv-schlecht', null, `⚠ ${kritisch.length} Vertrag/Verträge laufen zum Saisonende aus. `),
        `Wer nicht verlängert, verliert ${kritisch.map(e => kurzName(e.player)).slice(0, 4).join(', ')}` +
        `${kritisch.length > 4 ? ' und weitere' : ''} ablösefrei — und der Berater grinst.`));
    }
    if (unruhe.length) {
      punkte.appendChild(el('div', null,
        el('b.tv-warnung', null, '⚠ Unruhe in der Kabine: '),
        `${unruhe.map(p => kurzName(p)).slice(0, 5).join(', ')} ` +
        'denken laut über einen Wechsel nach — oder darüber, ob die zweite Mannschaft nicht ehrlicher wäre. ' +
        'Ein neuer Vertrag mit Rollenversprechen beruhigt erstaunlich zuverlässig.'));
    }
    wrap.appendChild(el('div.tv-subpanel', {
      style: { borderLeft: '5px solid var(--rot)', background: 'rgba(193,39,45,.12)' }
    }, punkte));
  }

  const spalten = [
    { key: 'bild', label: '', width: 38, sortable: false, render: (r) => portrait(state, r.player, 28) },
    {
      key: 'name', label: 'Spieler', width: 175,
      sort: (a, b) => a.player.lastName.localeCompare(b.player.lastName, 'de'),
      render: (r) => el('div', null,
        el('div.tv-zeile', { style: { gap: '5px' } }, el('b', null, kurzName(r.player)), legendenPille(r.player)),
        el('div.tv-mini', null, `${POSITION_NAMES[r.player.position] || r.player.position} · ${r.player.age} Jahre · ${ROLLEN_TEXT[r.rolle] || r.rolle}`))
    },
    {
      key: 'restlaufzeit', label: 'Laufzeit', width: 96, numeric: true,
      render: (r) => r.laeuftAus
        ? el('b.tv-schlecht', null, 'läuft aus!')
        : el('span', null, `noch ${r.restlaufzeit} Jahr(e)`)
    },
    { key: 'gehalt', label: 'Gehalt/J', width: 92, numeric: true, render: (r) => formatMoney(r.gehalt) },
    {
      key: 'forderung', label: 'Wunschgehalt', width: 104, numeric: true,
      render: (r) => el('span', { class: r.forderung.gehalt > r.gehalt * 1.3 ? 'tv-warnung' : '' },
        formatMoney(r.forderung.gehalt))
    },
    { key: 'marktwert', label: 'Marktwert', width: 92, numeric: true, render: (r) => formatMoney(r.marktwert) },
    {
      key: 'stimmung', label: 'Laune', width: 74, sortable: false,
      render: (r) => balken(r.player.morale || 0, 100, { showValue: false, compact: true, height: 8,
        tooltip: `Moral ${Math.round(r.player.morale || 0)} · Spielzeit-Zufriedenheit ${Math.round((r.player.happiness && r.player.happiness.spielzeit) || 0)}` })
    },
    {
      key: 'aktion', label: '', width: 122, sortable: false,
      render: (r) => el('div.tv-zeile', { style: { gap: '4px' } },
        button('Verlängern', () => dlgVertrag(state, club, ctx, r.player, { modus: 'verlaengern', vorschlag: r.forderung }),
          { kind: 'primary', class: 'tv-btn--klein' }),
        button('Akte', () => waehleSpieler(r.playerId, ctx), { kind: 'ghost', class: 'tv-btn--klein' }))
    }
  ];

  wrap.appendChild(table(spalten, alle, {
    idKey: 'playerId', compact: true, selectedId: zustand.gewaehlt, maxHeight: 380,
    sort: { key: 'restlaufzeit', desc: false },
    emptyText: 'Alle Verträge laufen noch mindestens zwei Jahre. Beruhigend langweilig.',
    rowClass: (r) => {
      const k = [];
      if (istLegende(r.player)) k.push('zeile--legende');
      if (r.laeuftAus) k.push('tv-fett');
      return k.join(' ');
    },
    onRowClick: (r, i, ev) => { if (!ev.target.closest('button')) waehleSpieler(r.playerId, ctx); }
  }));

  wrap.appendChild(el('div.tv-mini', null,
    'Ein Handgeld überzeugt schneller als ein hohes Gehalt, eine Ausstiegsklausel schneller als beides. ' +
    'Beides bezahlt allerdings der Verein — nicht der Berater.'));

  return wrap;
}

/**
 * Vertragsdialog. modus: 'verlaengern' (eigener Spieler) oder
 * 'verpflichten' (fremder/vertragsloser Spieler, ggf. mit bereits
 * ausgehandelter Ablöse).
 */
async function dlgVertrag(state, club, ctx, p, opts = {}) {
  const modus = opts.modus === 'verlaengern' ? 'verlaengern' : 'verpflichten';
  const marktGehalt = sicher(() => TM.marktGehalt(state, p.id, club.id), 500000);
  const provision = sicher(() => TM.beraterProvision(state, p.id, opts.ablose || 0), 0);
  const vorschlag = opts.vorschlag || {};
  const startGehalt = Math.round((vorschlag.gehalt || marktGehalt * 1.08) / 10000) * 10000;
  const startLaufzeit = vorschlag.laufzeit || (p.age >= 33 ? 1 : p.age >= 30 ? 2 : p.age <= 22 ? 4 : 3);

  const gehaltIst = gehaltssumme(state, club.id);
  const etat = Math.max(1, (club.finances && club.finances.wageBudget) || Math.round(gehaltIst * 1.15));
  const luft = Math.max(0, etat - gehaltIst + (modus === 'verlaengern' ? ((p.contract && p.contract.salary) || 0) : 0));

  let fGehalt = null, fLaufzeit = null, fHandgeld = null, fKlausel = null, fRolle = null;
  let fPrTor = null, fPrEinsatz = null, fPrTitel = null;
  const warnung = el('div.tv-mini', { style: { marginTop: '6px', lineHeight: '1.5' } });

  const pruefe = () => {
    const g = zahlAus(fGehalt, 0);
    const h = zahlAus(fHandgeld, 0);
    const teile = [];
    if (g > luft) teile.push(`⚠ Der Gehaltsetat gibt nur ${formatMoney(luft)} her — gefordert sind ${formatMoney(g)}.`);
    if (h + provision > (club.finances.balance || 0)) {
      teile.push(`⚠ Handgeld und Beraterprovision (${formatMoney(h + provision)}) übersteigen den Kontostand.`);
    }
    if (!teile.length) {
      teile.push(`Sofort fällig: ${formatMoney(h + provision)} (Handgeld + Provision). ` +
        `Jährlich: ${formatMoney(g)} von ${formatMoney(luft)} freier Etatluft.`);
    }
    warnung.className = teile[0].startsWith('⚠') ? 'tv-schlecht' : 'tv-mini';
    warnung.textContent = teile.join(' ');
  };

  const zeile = (beschriftung, feld, hinweis) => el('div', { style: { marginBottom: '5px' } },
    el('label.tv-zeile', null,
      el('span', { style: { width: '150px', fontSize: '12px' } }, beschriftung), feld),
    hinweis ? el('div.tv-mini', { style: { marginLeft: '150px' } }, hinweis) : null);

  const geld = (start, schritt) => el('input', {
    type: 'number', step: String(schritt || 10000), min: '0', value: String(start),
    style: { width: '170px' }, onInput: () => pruefe()
  });

  const koerper = el('div.tv-spalte', null,
    el('div.tv-zeile', { style: { gap: '10px', alignItems: 'flex-start' } },
      portrait(state, p, 64, true),
      el('div', null,
        el('div.tv-zeile', { style: { gap: '6px' } },
          el('b', { style: { fontSize: '16px' } }, vollerName(p)), legendenPille(p), positionsPille(p.position)),
        el('div.tv-mini', { style: { marginTop: '3px', lineHeight: '1.5' } },
          `${p.age} Jahre · ${nationText(p.nationality)} · Stärke ${playerOverall(p)} (Potenzial ${p.potential})`,
          el('br'),
          modus === 'verlaengern'
            ? `Aktuell ${formatMoney((p.contract && p.contract.salary) || 0)} pro Jahr bis Saison ${p.contract ? p.contract.until : '?'}.`
            : `Marktübliches Gehalt hier: ${formatMoney(marktGehalt)}. Beraterprovision: ${formatMoney(provision)}.`,
          opts.ablose ? el('br') : null,
          opts.ablose ? `Ausgehandelte Ablöse: ${formatMoney(opts.ablose)}.` : null))),

    zeile('Jahresgehalt', (fGehalt = geld(startGehalt, 10000)),
      `Wunsch des Spielers: ${formatMoney(vorschlag.gehalt || Math.round(marktGehalt * 1.08))}`),
    zeile('Laufzeit', (fLaufzeit = el('select', { style: { width: '170px' } },
      ...[1, 2, 3, 4, 5, 6].map(n => el('option', { value: String(n), selected: n === startLaufzeit }, `${n} Jahr(e)`)))),
    p.age >= 31 ? 'Ältere Spieler wollen Sicherheit — kurze Verträge kränken.' : 'Junge Spieler unterschreiben gern lang.'),
    zeile('Handgeld', (fHandgeld = geld(Math.round(startGehalt * 0.25 / 10000) * 10000, 10000)),
      'Wirkt stärker als jede Gehaltserhöhung, kostet aber sofort Bargeld.'),
    zeile('Ausstiegsklausel', (fKlausel = geld(0, 100000)),
      '0 = keine Klausel. Eine Klausel überzeugt den Spieler — und macht ihn später bezahlbar für andere.'),
    zeile('Rollenversprechen', (fRolle = el('select', { style: { width: '170px' } },
      ...ROLLEN_VERSPRECHEN.map(([v, t]) => el('option', { value: v, selected: v === (vorschlag.rolle || 'rotation') }, t.split(' — ')[0]))))),
    el('div.tv-mini', { style: { marginLeft: '150px', marginTop: '-3px' } },
      'Ein zu großes Versprechen glaubt er Ihnen nicht — und er merkt es spätestens im September.'),

    subpanel('Prämien (je Ereignis)',
      el('div.tv-grid.tv-grid--3', { style: { gap: '6px' } },
        el('label', null, el('div.tv-mini', null, 'pro Tor'),
          (fPrTor = el('input', { type: 'number', step: '1000', min: '0', value: String(Math.round(startGehalt * 0.012 / 1000) * 1000), style: { width: '100%' } }))),
        el('label', null, el('div.tv-mini', null, 'pro Einsatz'),
          (fPrEinsatz = el('input', { type: 'number', step: '1000', min: '0', value: String(Math.round(startGehalt * 0.006 / 1000) * 1000), style: { width: '100%' } }))),
        el('label', null, el('div.tv-mini', null, 'pro Titel'),
          (fPrTitel = el('input', { type: 'number', step: '1000', min: '0', value: String(Math.round(startGehalt * 0.15 / 1000) * 1000), style: { width: '100%' } }))))),

    warnung);

  const bauAngebot = () => ({
    gehalt: zahlAus(fGehalt, 0),
    laufzeit: Number(fLaufzeit.value) || 3,
    handgeld: zahlAus(fHandgeld, 0),
    ausstiegsklausel: zahlAus(fKlausel, 0) || null,
    rolle: fRolle.value,
    praemien: {
      tor: zahlAus(fPrTor, 0), einsatz: zahlAus(fPrEinsatz, 0), titel: zahlAus(fPrTitel, 0)
    }
  });

  const titel = modus === 'verlaengern' ? `Vertrag verlängern: ${kurzName(p)}` : `Vertrag anbieten: ${kurzName(p)}`;
  const angebot = await dialog(titel, koerper, [
    { label: 'Abbrechen', value: null, kind: 'ghost' },
    { label: modus === 'verlaengern' ? 'Verlängerung anbieten' : 'Vertrag anbieten', kind: 'primary', onClick: () => bauAngebot() }
  ], { escValue: null, size: 'lg', onOpen: () => pruefe() });

  if (!angebot) return;

  let res;
  if (modus === 'verlaengern') {
    res = sicher(() => TM.vertragVerlaengern(state, p.id, angebot), null);
  } else {
    res = sicher(() => TM.spielerVerpflichten(state, club.id, p.id, opts.ablose || 0, angebot), null);
  }
  if (!res) { toast('Die Vertragsabteilung antwortet nicht. Sehr professionell.', 'schlecht'); return; }

  // Gegenforderung: gleich noch einmal mit den Wünschen des Beraters anbieten.
  if (res.status === 'gegenforderung' && res.forderung) {
    const nochmal = await dialog('Der Berater hat eine Zahl',
      el('div.tv-spalte', null,
        el('p', null, res.text),
        el('div.tv-grid.tv-grid--3', { style: { gap: '6px' } },
          statBox('Gefordertes Gehalt', formatMoney(res.forderung.gehalt), { kind: 'warn' }),
          statBox('Laufzeit', `${res.forderung.laufzeit} Jahr(e)`),
          statBox('Provision', formatMoney(res.forderung.provision || res.provision || 0))),
        (res.gruende && res.gruende.length)
          ? el('ul', { style: { margin: '6px 0 0 16px', fontSize: '12px', lineHeight: '1.5' } },
            ...res.gruende.slice(0, 3).map(g => el('li', null, g)))
          : null),
      [
        { label: 'Zu teuer', value: false, kind: 'ghost' },
        { label: 'Forderung erfüllen', value: true, kind: 'primary' }
      ], { escValue: false, size: 'sm' });
    if (nochmal) {
      const zweit = Object.assign({}, angebot, {
        gehalt: res.forderung.gehalt, laufzeit: res.forderung.laufzeit
      });
      res = modus === 'verlaengern'
        ? sicher(() => TM.vertragVerlaengern(state, p.id, zweit), null)
        : sicher(() => TM.spielerVerpflichten(state, club.id, p.id, opts.ablose || 0, zweit), null);
    }
  }

  meldeErgebnis(res, ctx, { art: res && res.status === 'angenommen' ? 'gut' : 'warn' });
}

/* ==========================================================================
 * 11. Reiter 5 — Scouting
 * ======================================================================== */

function tabScouting(state, club, ctx) {
  braucht('beobachteteSpieler');
  const liste = TM.beobachteteSpieler(state, club.id);
  const wrap = el('div.tv-spalte');

  const anlage = club.facilities ? (club.facilities.scouting || 50) : 50;
  wrap.appendChild(el('div.tv-grid.tv-grid--4', { style: { gap: '6px' } },
    statBox('Scoutingabteilung', `${anlage} / 100`, {
      sub: anlage >= 80 ? 'erstklassig' : anlage >= 60 ? 'ordentlich' : 'ausbaufähig',
      kind: anlage >= 75 ? 'gut' : anlage < 45 ? 'warn' : undefined
    }),
    statBox('Unter Beobachtung', String(liste.length), { sub: 'mehr als ein Dutzend schafft der Späher nicht' }),
    statBox('Kosten je Auftrag', formatMoney(SCOUT_SPESEN), { sub: 'Reise und Spesen, einmalig' }),
    statBox('Ø Berichtsgüte', liste.length
      ? Math.round(liste.reduce((s, e) => s + ((e.bericht && e.bericht.genauigkeit) || 0), 0) / liste.length * 100) + ' %'
      : '—', { sub: 'ab 90 % sind die Zahlen belastbar' })));

  wrap.appendChild(el('div.tv-zeile', { style: { gap: '6px', marginTop: '2px' } },
    button('Neuen Scoutauftrag vergeben', () => dlgScoutauftrag(state, club, ctx), { kind: 'primary', class: 'tv-btn--klein' }),
    el('span.tv-mini', null,
      'Jeder Beobachtungstag macht den Bericht genauer. Nach drei Wochen liegt ein Zwischenbericht in der Post.')));

  if (!liste.length) {
    wrap.appendChild(el('div.tv-leer', null,
      'Niemand unter Beobachtung. Dann kaufen wir eben weiter nach Bauchgefühl — hat ja noch nie jemandem geschadet.'));
    return wrap;
  }

  const sortiert = sortBy(liste, e => ({ key: (e.bericht && e.bericht.genauigkeit) || 0, desc: true }));
  const box = el('div.tv-spalte', { style: { gap: '6px' } });
  for (const e of sortiert) box.appendChild(scoutKarte(state, club, ctx, e));
  wrap.appendChild(subpanel(`Beobachtete Spieler (${liste.length})`, box));
  return wrap;
}

function scoutKarte(state, club, ctx, e) {
  const p = e.player;
  const b = e.bericht || {};
  const genau = Math.round((b.genauigkeit || 0) * 100);
  const eigen = p.clubId === club.id;

  const ring = sicher(() => progressRing(genau, 100, {
    size: 52, label: genau + '%', sub: 'Güte',
    color: genau >= 90 ? 'var(--gruen-500)' : genau >= 55 ? 'var(--gold)' : 'var(--rot)'
  }), el('b', null, genau + ' %'));

  return el('div.tv-talent', {
    style: istLegende(p) ? { background: 'linear-gradient(90deg, rgba(217,165,33,.22), transparent 55%)' } : null
  },
  portrait(state, p, 44),
  el('div', { style: { flex: '1', minWidth: '0' } },
    el('div.tv-zeile', { style: { gap: '6px', flexWrap: 'wrap' } },
      el('b', null, vollerName(p)), legendenPille(p), positionsPille(p.position),
      el('span.tv-mini', null, vereinsName(state, p.clubId))),
    el('div.tv-mini', { style: { margin: '2px 0 3px' } },
      `${p.age} Jahre · ${nationText(p.nationality)} · Stärke ${staerkeText(b, p, eigen)} · ` +
      `Potenzial ${potenzialText(b, p, eigen)} · geschätzter Wert ${formatMoney(b.geschaetzterWert || 0)}`),
    balken(genau, 100, {
      label: `Berichtsgenauigkeit (${b.tageBeobachtet || 0} Tage beobachtet)`,
      valueText: genau + ' %', height: 10,
      color: genau >= 90 ? 'var(--gruen-500)' : genau >= 55 ? 'var(--gold)' : 'var(--rot)'
    })),
  ring,
  el('div.tv-spalte', { style: { gap: '3px' } },
    button('Bericht lesen', () => dlgScoutbericht(state, club, ctx, p, b), { kind: 'ghost', class: 'tv-btn--klein' }),
    button('Akte', () => waehleSpieler(p.id, ctx), { kind: 'ghost', class: 'tv-btn--klein' }),
    button('Abbrechen', () => meldeErgebnis(sicher(() => TM.scoutingBeenden(state, club.id, p.id), null), ctx, { art: 'info' }),
      { kind: 'danger', class: 'tv-btn--klein', tooltip: 'Der Scout darf nach Hause.' })));
}

async function dlgScoutbericht(state, club, ctx, p, b) {
  const eigen = p.clubId === club.id;
  const attr = (b && b.geschaetzteAttribute) || p.attributes || {};
  const gruppen = el('div.tv-grid.tv-grid--2', { style: { gap: '10px' } });

  for (const [name, keys] of Object.entries(ATTRIBUTE_GROUPS)) {
    if (name === 'Torwart' && p.position !== 'TW') continue;
    if (name !== 'Torwart' && p.position === 'TW' && name === 'Technik') { /* Torhüter dürfen auch Technik haben */ }
    const kasten = el('div');
    kasten.appendChild(el('div.tv-subpanel__titel', null, name));
    for (const k of keys) {
      const v = attr[k] !== undefined ? attr[k] : (p.attributes ? p.attributes[k] : 0);
      kasten.appendChild(el('div.tv-attr', null,
        el('span.tv-attr__name', null, ATTRIBUTE_NAMES[k] || k),
        balken(v, 99, { showValue: false, compact: true, height: 9 }),
        el('span.tv-wert', null, String(v))));
    }
    gruppen.appendChild(kasten);
  }

  await dialog(`Scoutbericht: ${vollerName(p)}`,
    el('div.tv-spalte', null,
      el('div.tv-zeile', { style: { gap: '10px', alignItems: 'flex-start' } },
        portrait(state, p, 72, true),
        el('div', null,
          el('div.tv-zeile', { style: { gap: '6px' } },
            el('b', { style: { fontSize: '16px' } }, vollerName(p)), legendenPille(p), positionsPille(p.position)),
          el('div.tv-mini', { style: { marginTop: '3px', lineHeight: '1.55' } },
            `${vereinsName(state, p.clubId)} · ${p.age} Jahre · ${nationText(p.nationality)} · ${p.foot || 'rechts'}er Fuß`,
            el('br'),
            `Eingeschätzte Stärke ${staerkeText(b, p, eigen)} · Potenzial ${potenzialText(b, p, eigen)} · ` +
            `Berichtsgenauigkeit ${Math.round((b.genauigkeit || 0) * 100)} %`))),
      el('div.tv-zettel', { style: { transform: 'none', fontSize: '12.5px', lineHeight: '1.55' } },
        el('b', null, 'Einschätzung des Chefscouts'),
        (b && b.einschaetzung) || 'Zu diesem Spieler liegt noch kein Bericht vor.'),
      istScharf(b, p, eigen) ? null : el('div.tv-mini.tv-warnung', null,
        'Die folgenden Zahlen sind Schätzungen. Je länger beobachtet wird, desto näher liegen sie an der Wahrheit.'),
      gruppen,
      (p.traits && p.traits.length)
        ? el('div.tv-zeile', { style: { flexWrap: 'wrap', gap: '4px' } },
          ...p.traits.map(t => pill(`${(TRAITS[t] && TRAITS[t].icon) || '•'} ${(TRAITS[t] && TRAITS[t].name) || t}`,
            t === 'glasknochen' || t === 'querulant' || t === 'mimose' ? 'schlecht' : 'info')))
        : null),
    [{ label: 'Akte schließen', value: true, kind: 'primary' }], { size: 'lg' });
}

async function dlgScoutauftrag(state, club, ctx) {
  braucht('transferliste');
  const gewaehlt = { id: null };
  const ergebnis = el('div');
  let fPos = null, fMinOvr = null, fMaxAlter = null, fSuche = null;

  const zeichnen = () => {
    const opts = { kaeuferId: club.id, limit: 40, sortierung: 'ovr' };
    if (fPos.value) opts.position = fPos.value;
    if (fMinOvr.value) opts.minOvr = Number(fMinOvr.value);
    if (fMaxAlter.value) opts.maxAlter = Number(fMaxAlter.value);
    if (fSuche.value) opts.suche = fSuche.value;
    const rows = sicher(() => TM.transferliste(state, opts), []).filter(r => !r.beobachtet);

    ergebnis.replaceChildren(table([
      { key: 'bild', label: '', width: 34, sortable: false, render: (r) => portrait(state, r.player, 26) },
      {
        key: 'name', label: 'Spieler', width: 170,
        render: (r) => el('div.tv-zeile', { style: { gap: '5px' } },
          el('b', null, kurzName(r.player)), legendenPille(r.player))
      },
      { key: 'clubName', label: 'Verein', width: 120 },
      { key: 'position', label: 'Pos', width: 42, align: 'center', render: (r) => positionsPille(r.position) },
      { key: 'alter', label: 'Alt', width: 38, numeric: true },
      { key: 'marktwert', label: 'Wert', width: 78, numeric: true, render: (r) => formatMoneyShort(r.marktwert) }
    ], rows, {
      idKey: 'playerId', compact: true, maxHeight: 260, selectedId: gewaehlt.id,
      emptyText: 'Keine passenden Spieler — oder wir beobachten sie längst alle.',
      rowClass: (r) => (istLegende(r.player) ? 'zeile--legende' : ''),
      onRowClick: (r) => { gewaehlt.id = r.playerId; zeichnen(); }
    }));
  };

  const filterZeile = el('div.tv-filter', null,
    (fPos = el('select', { onChange: () => zeichnen() },
      el('option', { value: '' }, 'Alle Positionen'),
      ...POSITIONS.map(p => el('option', { value: p }, `${p} — ${POSITION_NAMES[p] || p}`)))),
    (fMinOvr = el('select', { onChange: () => zeichnen() },
      ...STAERKE_STUFEN.map(([v, t]) => el('option', { value: v }, t)))),
    (fMaxAlter = el('input', { type: 'number', placeholder: 'max. Alter', min: '15', max: '45', style: { width: '90px' }, onChange: () => zeichnen() })),
    (fSuche = el('input', { type: 'search', placeholder: 'Name …', style: { width: '140px' } })));
  fSuche.addEventListener('input', () => zeichnen());

  zeichnen();

  const ja = await dialog('Scoutauftrag vergeben',
    el('div.tv-spalte', null,
      el('p', null,
        `Unser Späher steigt in den Bus. Kosten: ${formatMoney(SCOUT_SPESEN)} Reisepauschale. ` +
        'Je länger er zuschaut, desto genauer wird sein Bericht.'),
      filterZeile, ergebnis),
    [
      { label: 'Abbrechen', value: false, kind: 'ghost' },
      { label: 'Beobachten lassen', value: true, kind: 'primary' }
    ], { escValue: false, size: 'lg' });

  if (!ja) return;
  if (!gewaehlt.id) { toast('Kein Spieler ausgewählt — der Scout bleibt zu Hause.', 'warn'); return; }
  meldeErgebnis(sicher(() => TM.scouten(state, club.id, gewaehlt.id), null), ctx);
}

/* ==========================================================================
 * 12. Reiter 6 — Leihen
 * ======================================================================== */

function tabLeihen(state, club, ctx) {
  const wrap = el('div.tv-spalte');

  // Aktuelle Leihgeschäfte
  const rein = kaderVon(state, club.id).filter(p => p.transfer && p.transfer.leihe && p.transfer.leihe.stammvereinId);
  const raus = [];
  for (const id in state.players) {
    const p = state.players[id];
    if (p && p.transfer && p.transfer.leihe && p.transfer.leihe.stammvereinId === club.id) raus.push(p);
  }

  if (rein.length || raus.length) {
    const box = el('div.tv-spalte', { style: { gap: '4px' } });
    for (const p of rein) box.appendChild(leihZeile(state, ctx, p, 'rein'));
    for (const p of raus) box.appendChild(leihZeile(state, ctx, p, 'raus'));
    wrap.appendChild(subpanel(`Laufende Leihgeschäfte (${rein.length + raus.length})`, box));
  }

  const umschalter = el('div.tv-zeile', { style: { gap: '5px' } },
    button('Spieler ausleihen', () => { zustand.leihRichtung = 'ausleihen'; ctx.refresh(); },
      { kind: zustand.leihRichtung === 'ausleihen' ? 'primary' : 'ghost', class: 'tv-btn--klein' }),
    button('Eigene Spieler verleihen', () => { zustand.leihRichtung = 'verleihen'; ctx.refresh(); },
      { kind: zustand.leihRichtung === 'verleihen' ? 'primary' : 'ghost', class: 'tv-btn--klein' }),
    el('span.tv-mini', null,
      'Leihen gehen nur bei geöffnetem Fenster — und nur, wenn der abgebende Verein den Mann entbehren kann.'));
  wrap.appendChild(umschalter);

  wrap.appendChild(zustand.leihRichtung === 'verleihen'
    ? sicherBauen('Verleihen', () => verleihListe(state, club, ctx))
    : sicherBauen('Ausleihen', () => ausleihListe(state, club, ctx)));

  return wrap;
}

function leihZeile(state, ctx, p, richtung) {
  const l = p.transfer.leihe;
  const partner = richtung === 'rein' ? l.stammvereinId : p.clubId;
  return el('div.tv-zeile.tv-zeile--verteilt', {
    style: { padding: '4px 6px', borderBottom: '1px solid rgba(0,0,0,.14)' }
  },
  el('div.tv-zeile', { style: { gap: '7px' } },
    portrait(state, p, 30),
    el('div', null,
      el('div.tv-zeile', { style: { gap: '5px' } },
        el('b', null, kurzName(p)), legendenPille(p), positionsPille(p.position),
        pill(richtung === 'rein' ? 'ausgeliehen von' : 'verliehen an', richtung === 'rein' ? 'gut' : 'info')),
      el('div.tv-mini', null,
        `${vereinsName(state, partner)} · wir zahlen ${Math.round((l.gehaltsanteil || 0) * 100)} % des Gehalts` +
        (l.kaufoption ? ` · Kaufoption ${formatMoney(l.kaufoption)}${l.pflichtkauf ? ' (Pflicht)' : ''}` : ' · keine Kaufoption')))),
  button('Akte', () => waehleSpieler(p.id, ctx), { kind: 'ghost', class: 'tv-btn--klein' }));
}

function ausleihListe(state, club, ctx) {
  braucht('transferliste');
  const rows = TM.transferliste(state, {
    kaeuferId: club.id, limit: 60, sortierung: 'ovr', maxAlter: 25
  }).filter(r => !r.vertragslos);

  const spalten = [
    { key: 'bild', label: '', width: 36, sortable: false, render: (r) => portrait(state, r.player, 28) },
    {
      key: 'name', label: 'Spieler', width: 175,
      render: (r) => el('div.tv-zeile', { style: { gap: '5px' } }, el('b', null, kurzName(r.player)), legendenPille(r.player))
    },
    {
      key: 'clubName', label: 'Verein', width: 130,
      render: (r) => el('div.tv-zeile', { style: { gap: '5px' } }, wappen(state, r.clubId, 18), r.clubName)
    },
    { key: 'position', label: 'Pos', width: 42, align: 'center', render: (r) => positionsPille(r.position) },
    { key: 'alter', label: 'Alt', width: 38, numeric: true },
    { key: 'ovr', label: 'Stärke', width: 60, numeric: true },
    { key: 'gehalt', label: 'Gehalt/J', width: 82, numeric: true, render: (r) => formatMoneyShort(r.gehalt) },
    {
      key: 'aktion', label: '', width: 132, sortable: false,
      render: (r) => button('Leihe anfragen', () => dlgLeihe(state, club, ctx, r.player, 'ausleihen'),
        { kind: 'primary', class: 'tv-btn--klein' })
    }
  ];

  return el('div', null,
    el('div.tv-mini', { style: { marginBottom: '4px' } },
      'Junge Spieler (bis 25) anderer Vereine — Leihen funktionieren am besten dort, wo jemand Spielpraxis braucht.'),
    table(spalten, rows, {
      idKey: 'playerId', compact: true, maxHeight: 340, selectedId: zustand.gewaehlt,
      rowClass: (r) => (istLegende(r.player) ? 'zeile--legende' : ''),
      emptyText: 'Keine Leihkandidaten gefunden.',
      onRowClick: (r, i, ev) => { if (!ev.target.closest('button')) waehleSpieler(r.playerId, ctx); }
    }));
}

function verleihListe(state, club, ctx) {
  const kader = kaderVon(state, club.id)
    .filter(p => !(p.transfer && p.transfer.leihe && p.transfer.leihe.stammvereinId))
    .map(p => ({
      playerId: p.id, player: p,
      rolle: sicher(() => TM.kaderRolle(state, p.id), 'rotation'),
      ovr: playerOverall(p),
      gehalt: (p.contract && p.contract.salary) || 0
    }));

  const spalten = [
    { key: 'bild', label: '', width: 36, sortable: false, render: (r) => portrait(state, r.player, 28) },
    {
      key: 'name', label: 'Spieler', width: 175,
      sort: (a, b) => a.player.lastName.localeCompare(b.player.lastName, 'de'),
      render: (r) => el('div.tv-zeile', { style: { gap: '5px' } }, el('b', null, kurzName(r.player)), legendenPille(r.player))
    },
    { key: 'position', label: 'Pos', width: 42, align: 'center', render: (r) => positionsPille(r.player.position) },
    { key: 'alter', label: 'Alt', width: 38, numeric: true, render: (r) => r.player.age },
    { key: 'ovr', label: 'Stärke', width: 60, numeric: true },
    { key: 'rolle', label: 'Rolle', width: 128, render: (r) => ROLLEN_TEXT[r.rolle] || r.rolle },
    { key: 'gehalt', label: 'Gehalt/J', width: 82, numeric: true, render: (r) => formatMoneyShort(r.gehalt) },
    {
      key: 'aktion', label: '', width: 122, sortable: false,
      render: (r) => button('Verleihen', () => dlgLeihe(state, club, ctx, r.player, 'verleihen'),
        { kind: 'primary', class: 'tv-btn--klein', disabled: istLegende(r.player) })
    }
  ];

  return el('div', null,
    el('div.tv-mini', { style: { marginBottom: '4px' } },
      'Wer hier nicht spielt, verliert Form und Laune. Eine Leihe ist oft ehrlicher als die Tribüne. ' +
      'Vereinsikonen verleiht man allerdings nicht — das versteht in der Kurve niemand.'),
    table(spalten, kader, {
      idKey: 'playerId', compact: true, maxHeight: 340, selectedId: zustand.gewaehlt,
      sort: { key: 'ovr', desc: false },
      rowClass: (r) => (istLegende(r.player) ? 'zeile--legende' : ''),
      emptyText: 'Kein Kader vorhanden.',
      onRowClick: (r, i, ev) => { if (!ev.target.closest('button')) waehleSpieler(r.playerId, ctx); }
    }));
}

async function dlgLeihe(state, club, ctx, p, richtung) {
  braucht('leiheAnbieten');
  const marktwert = sicher(() => TM.marktwert(state, p.id), p.value || 0);
  const gehalt = (p.contract && p.contract.salary) || sicher(() => TM.marktGehalt(state, p.id, club.id), 0);

  let fAnteil = null, fKaufoption = null, fPflicht = null, fZiel = null;
  const anzeige = el('div.tv-mini', { style: { marginTop: '6px' } });

  const pruefe = () => {
    const anteil = Number(fAnteil.value) / 100;
    anzeige.textContent =
      `Wir zahlen ${Math.round(anteil * 100)} % des Jahresgehalts (${formatMoney(gehalt * anteil)}). ` +
      `Die Leihgebühr richtet sich nach dem Marktwert (${formatMoney(marktwert)}) und liegt bei rund ` +
      `${formatMoney(marktwert * 0.045)}.`;
  };

  const zielVereine = Object.values(state.clubs)
    .filter(c => c.id !== club.id && !c.istAmateur && Array.isArray(c.playerIds))
    .sort((a, b) => (b.reputation || 0) - (a.reputation || 0));

  const koerper = el('div.tv-spalte', null,
    el('div.tv-zeile', { style: { gap: '10px', alignItems: 'flex-start' } },
      portrait(state, p, 60, true),
      el('div', null,
        el('div.tv-zeile', { style: { gap: '6px' } },
          el('b', { style: { fontSize: '15px' } }, vollerName(p)), legendenPille(p), positionsPille(p.position)),
        el('div.tv-mini', { style: { marginTop: '3px' } },
          `${p.age} Jahre · Stärke ${playerOverall(p)} · ${vereinsName(state, p.clubId)} · ` +
          `Gehalt ${formatMoney(gehalt)} pro Jahr`))),

    richtung === 'verleihen'
      ? el('div', null, el('label.tv-zeile', null,
        el('span', { style: { width: '150px', fontSize: '12px' } }, 'Zielverein'),
        (fZiel = el('select', { style: { width: '230px' } },
          ...zielVereine.map(c => el('option', { value: c.id }, `${c.name} (Ruf ${c.reputation || '?'})`))))),
      el('div.tv-mini', { style: { marginLeft: '150px' } },
        'Der Zielverein muss Gehaltsanteil und Gebühr stemmen können — sonst winkt er ab.'))
      : null,

    el('label.tv-zeile', null,
      el('span', { style: { width: '150px', fontSize: '12px' } },
        richtung === 'verleihen' ? 'Gehaltsanteil dort' : 'Unser Gehaltsanteil'),
      (fAnteil = el('select', { style: { width: '160px' }, onChange: () => pruefe() },
        ...[0, 25, 50, 60, 75, 100].map(v => el('option', { value: String(v), selected: v === 60 }, v + ' %'))))),

    el('label.tv-zeile', null,
      el('span', { style: { width: '150px', fontSize: '12px' } }, 'Kaufoption'),
      (fKaufoption = el('input', {
        type: 'number', step: '100000', min: '0', value: '0', style: { width: '160px' }
      }))),
    el('div.tv-mini', { style: { marginLeft: '150px' } },
      `0 = keine Option. Üblich wären rund ${formatMoney(Math.round(marktwert * 1.05 / 100000) * 100000)}.`),

    el('label.tv-zeile', { style: { gap: '5px' } },
      el('span', { style: { width: '150px', fontSize: '12px' } }, 'Kaufpflicht'),
      (fPflicht = el('input', { type: 'checkbox' })),
      el('span.tv-mini', null, 'Am Saisonende wird die Option zwingend gezogen.')),

    anzeige);

  const ergebnis = await dialog(
    richtung === 'verleihen' ? `Leihe anbieten: ${kurzName(p)}` : `Leihe anfragen: ${kurzName(p)}`,
    koerper,
    [
      { label: 'Abbrechen', value: null, kind: 'ghost' },
      {
        label: richtung === 'verleihen' ? 'Anbieten' : 'Anfragen', kind: 'primary',
        onClick: () => ({
          zielId: fZiel ? fZiel.value : club.id,
          gehaltsanteil: Number(fAnteil.value) / 100,
          kaufoption: zahlAus(fKaufoption, 0) || null,
          pflichtkauf: !!(fPflicht && fPflicht.checked)
        })
      }
    ], { escValue: null, size: 'md', onOpen: () => pruefe() });

  if (!ergebnis) return;
  // leiheAnbieten() erwartet immer den AUFNEHMENDEN Verein.
  const aufnehmer = richtung === 'verleihen' ? ergebnis.zielId : club.id;
  meldeErgebnis(sicher(() => TM.leiheAnbieten(state, aufnehmer, p.id, {
    gehaltsanteil: ergebnis.gehaltsanteil,
    kaufoption: ergebnis.kaufoption,
    pflichtkauf: ergebnis.pflichtkauf
  }), null), ctx);
}

/* ==========================================================================
 * 13. Die Spielerakte (rechte Spalte)
 * ======================================================================== */

function aktePanel(state, club, ctx) {
  const p = zustand.gewaehlt ? state.players[zustand.gewaehlt] : null;
  if (!p) {
    return panel('🗂️ Spielerakte',
      el('div.tv-leer', null,
        'Kein Spieler gewählt. Ein Klick in eine Liste öffnet die Akte — mit Gesicht, Zahlen und Preisschild.'));
  }

  const eigen = p.clubId === club.id;
  const bericht = berichtFuer(state, club.id, p.id);
  const details = eigen ? null : sicher(() => TM.abloseDetails(state, p.id, club.id), null);
  const gehaltHier = sicher(() => TM.marktGehalt(state, p.id, club.id), 0);
  const marktwert = sicher(() => TM.marktwert(state, p.id), p.value || 0);
  const rest = restlaufzeit(state, p);

  const karte = el('div.tv-spielerkarte');

  /* --- Kopf: Gesicht, Name, Stärkekreis --------------------------------- */
  const staerke = staerkeZahl(bericht, p, eigen);
  const kreis = el('div.tv-ovr', {
    style: { background: `linear-gradient(180deg, var(--${ratingClass(staerke).replace('rat-', 'rat-')}) 0%, rgba(0,0,0,.35) 160%)` },
    class: ratingClass(staerke),
    title: istScharf(bericht, p, eigen) ? 'Gesicherte Gesamtstärke' : 'Schätzung des Scoutings'
  }, el('b', null, staerkeText(bericht, p, eigen)), el('small', null, 'STÄRKE'));

  karte.appendChild(el('div.tv-spielerkarte__kopf', null,
    portrait(state, p, 78, true),
    el('div', { style: { flex: '1', minWidth: '0' } },
      el('div.tv-spielerkarte__name', null, vollerName(p)),
      el('div.tv-zeile', { style: { gap: '4px', flexWrap: 'wrap', margin: '3px 0' } },
        positionsPille(p.position),
        ...(p.altPositions || []).slice(0, 3).map(a => pill(a, 'neutral')),
        legendenPille(p)),
      el('div.tv-spielerkarte__meta', null,
        el('div.tv-zeile', { style: { gap: '5px' } }, wappen(state, p.clubId, 16),
          el('span', null, vereinsName(state, p.clubId)), el('span.tv-mini', null, ligaText(p.clubId))),
        `${p.age} Jahre · ${nationText(p.nationality)} · ${p.foot || 'rechts'}er Fuß`,
        p.appearance && p.appearance.height ? ` · ${p.appearance.height} cm` : '',
        p.number ? ` · Nr. ${p.number}` : '')),
    kreis));

  if (p.injury) {
    karte.appendChild(el('div.tv-subpanel', { style: { borderLeft: '4px solid var(--rot)', padding: '5px 7px' } },
      el('b.tv-schlecht', null, '🩹 Verletzt: '),
      `${p.injury.name || 'Blessur'} — noch ${p.injury.daysLeft || '?'} Tage. Ein Kauf wäre Vertrauenssache.`));
  }

  /* --- Preisschild -------------------------------------------------------- */
  const preise = el('div.tv-grid.tv-grid--2', { style: { gap: '5px' } },
    statBox('Marktwert', formatMoney(marktwert)),
    eigen
      ? statBox('Gehalt', formatMoney((p.contract && p.contract.salary) || 0), { sub: rest <= 0 ? 'Vertrag läuft aus!' : `bis Saison ${p.contract.until}` })
      : statBox('Geforderte Ablöse', details ? (details.ablosefrei ? 'ablösefrei' : formatMoney(details.forderung)) : '—', {
        kind: details && details.unverkaeuflich ? 'schlecht' : undefined,
        sub: details && details.klausel ? 'Ausstiegsklausel' : (details ? `Bereitschaft ${Math.round((details.verkaufsbereit || 0) * 100)} %` : '')
      }),
    statBox(eigen ? 'Marktübliches Gehalt' : 'Gehaltsforderung', formatMoney(gehaltHier), {
      sub: eigen && p.contract && p.contract.salary > gehaltHier * 1.2 ? 'wir zahlen über Wert' : 'Richtwert pro Jahr'
    }),
    statBox('Vertrag', rest <= 0 ? 'läuft aus' : `noch ${rest} Jahr(e)`, {
      kind: rest <= 0 ? 'warn' : undefined,
      sub: p.contract && p.contract.releaseClause ? `Klausel ${formatMoneyShort(p.contract.releaseClause)}` : 'ohne Klausel'
    }));
  karte.appendChild(preise);

  if (details && details.text) {
    karte.appendChild(el('div.tv-zettel', { style: { transform: 'none', margin: '0' } },
      el('b', null, 'Aus der Geschäftsstelle'), details.text));
  }

  if (details && Array.isArray(details.faktoren) && details.faktoren.length) {
    const liste = el('div', { style: { fontSize: '11px', lineHeight: '1.55' } });
    for (const f of details.faktoren) {
      liste.appendChild(el('div.tv-zeile.tv-zeile--verteilt', null,
        el('span', null, f.name),
        el('b.tv-num', { class: f.wert >= 1 ? 'tv-schlecht' : 'tv-gut' },
          f.wert > 5 ? formatMoneyShort(f.wert) : '×' + String(Math.round(f.wert * 100) / 100).replace('.', ','))));
    }
    karte.appendChild(subpanel('Wie kommt der Preis zustande?', liste));
  }

  /* --- Attribute ---------------------------------------------------------- */
  const attr = (bericht && bericht.geschaetzteAttribute) || p.attributes || {};
  const attrBox = el('div');
  for (const [name, keys] of Object.entries(ATTRIBUTE_GROUPS)) {
    if (name === 'Torwart' && p.position !== 'TW') continue;
    attrBox.appendChild(el('div.tv-subpanel__titel', { style: { marginTop: '6px' } }, name));
    for (const k of keys) {
      const v = attr[k] !== undefined ? attr[k] : 0;
      attrBox.appendChild(el('div.tv-attr', null,
        el('span.tv-attr__name', null, ATTRIBUTE_NAMES[k] || k),
        balken(v, 99, { showValue: false, compact: true, height: 9 }),
        el('span.tv-wert', null, String(v))));
    }
  }
  karte.appendChild(subpanel(
    istScharf(bericht, p, eigen) ? 'Attribute' : 'Attribute (Schätzung des Scoutings)', attrBox));

  /* --- Zustand & Charakter ------------------------------------------------ */
  if (eigen) {
    karte.appendChild(subpanel('Zustand',
      balken(p.form || 0, 100, { label: 'Form', height: 10 }),
      balken(p.morale || 0, 100, { label: 'Moral', height: 10 }),
      balken(p.fitness || 0, 100, { label: 'Fitness', height: 10 }),
      balken(p.sharpness || 0, 100, { label: 'Spielpraxis', height: 10 })));
  } else if (bericht) {
    karte.appendChild(el('div', null,
      balken(Math.round((bericht.genauigkeit || 0) * 100), 100, {
        label: 'Wie gut kennen wir ihn?', valueText: Math.round((bericht.genauigkeit || 0) * 100) + ' %', height: 10,
        color: (bericht.genauigkeit || 0) >= 0.9 ? 'var(--gruen-500)' : 'var(--gold)'
      }),
      el('div.tv-mini', { style: { marginTop: '3px' } }, bericht.einschaetzung || '')));
  }

  if (p.traits && p.traits.length) {
    karte.appendChild(el('div.tv-zeile', { style: { flexWrap: 'wrap', gap: '4px' } },
      ...p.traits.map(t => pill(`${(TRAITS[t] && TRAITS[t].icon) || '•'} ${(TRAITS[t] && TRAITS[t].name) || t}`,
        t === 'glasknochen' || t === 'querulant' || t === 'mimose' ? 'schlecht' : 'info'))));
  }
  if (p.personality && p.personality.name) {
    karte.appendChild(el('div.tv-mini', null, el('b', null, p.personality.name + ': '), p.personality.desc || ''));
  }

  karte.appendChild(akteAktionen(state, club, ctx, p, { eigen, details, bericht }));

  const kopf = el('span', null, '🗂️ Spielerakte');
  const box = panel(kopf, karte);
  if (istLegende(p)) box.classList.add('tv-panel--gold');
  return box;
}

function akteAktionen(state, club, ctx, p, info) {
  const knoepfe = el('div.tv-zeile', { style: { flexWrap: 'wrap', gap: '5px', marginTop: '4px' } });
  const merk = zustand.merkliste.has(p.id);

  if (!info.eigen) {
    const vertragslos = !p.clubId || restlaufzeit(state, p) < 0;
    if (vertragslos) {
      knoepfe.appendChild(button('Vertrag anbieten', () => dlgVertrag(state, club, ctx, p, { modus: 'verpflichten', ablose: 0 }),
        { kind: 'primary', class: 'tv-btn--klein', tooltip: 'Vertragslose Spieler kosten keine Ablöse — nur den Berater.' }));
    } else {
      knoepfe.appendChild(button('Angebot abgeben', () => dlgAngebot(state, club, ctx, p, info.details),
        { kind: 'primary', class: 'tv-btn--klein' }));
    }
    const beobachtet = !!(info.bericht && info.bericht.tageBeobachtet > 0);
    knoepfe.appendChild(button(beobachtet ? 'Beobachtung beenden' : 'Beobachten',
      () => meldeErgebnis(sicher(() => beobachtet
        ? TM.scoutingBeenden(state, club.id, p.id)
        : TM.scouten(state, club.id, p.id), null), ctx, { art: 'info' }),
      { kind: 'ghost', class: 'tv-btn--klein', tooltip: beobachtet ? 'Der Scout darf nach Hause.' : `Kostet ${formatMoney(SCOUT_SPESEN)} Spesen.` }));
    knoepfe.appendChild(button('Leihe anfragen', () => dlgLeihe(state, club, ctx, p, 'ausleihen'),
      { kind: 'ghost', class: 'tv-btn--klein', disabled: vertragslos }));
  } else {
    knoepfe.appendChild(button('Vertrag verlängern', () => dlgVertrag(state, club, ctx, p, { modus: 'verlaengern' }),
      { kind: 'primary', class: 'tv-btn--klein' }));
    const gelistet = !!(p.transfer && p.transfer.listed);
    knoepfe.appendChild(button(gelistet ? 'Von der Liste nehmen' : 'Auf die Transferliste',
      () => transferlisteUmschalten(state, ctx, p, !gelistet),
      { kind: gelistet ? 'ghost' : 'danger', class: 'tv-btn--klein' }));
    knoepfe.appendChild(button('Verleihen', () => dlgLeihe(state, club, ctx, p, 'verleihen'),
      { kind: 'ghost', class: 'tv-btn--klein', disabled: istLegende(p) }));
  }

  knoepfe.appendChild(button(merk ? '📌 Von Merkliste' : '📌 Auf Merkliste', () => {
    if (merk) zustand.merkliste.delete(p.id); else zustand.merkliste.add(p.id);
    toast(merk ? `${kurzName(p)} ist vom Merkzettel.` : `${kurzName(p)} steht auf dem Merkzettel.`, 'info');
    ctx.refresh();
  }, { kind: 'ghost', class: 'tv-btn--klein', tooltip: 'Merkzettel dieser Sitzung — beim Neuladen ist er wieder leer.' }));

  const box = el('div', null, knoepfe);

  if (istLegende(p)) {
    box.appendChild(el('div.tv-subpanel', {
      style: { marginTop: '6px', borderLeft: '5px solid var(--gold)', background: 'rgba(217,165,33,.18)' }
    },
    el('b', null, '👑 Vereinsikone'),
    el('div.tv-mini', { style: { marginTop: '2px', lineHeight: '1.5' } },
      info.eigen
        ? 'Ein Verkauf kostet massiv Fanstimmung, treibt den Protestpegel hoch und der Vorstand vergisst so etwas nie. ' +
          'Ernsthaft: Lassen Sie es.'
        : 'Ikonen wechseln praktisch nie und kosten das Zweieinhalbfache. Unter dem doppelten Marktwert ' +
          'braucht man gar nicht erst anzurufen.')));
  }
  return box;
}

async function transferlisteUmschalten(state, ctx, p, drauf) {
  if (drauf && istLegende(p)) {
    const ja = await dialog('Eine Legende ausschreiben?',
      el('div.tv-spalte', null,
        el('p', { style: { fontWeight: '700', color: 'var(--rot)' } },
          `${vollerName(p)} auf die Transferliste zu setzen, ist ein öffentlicher Affront.`),
        el('p', null,
          'Spätestens morgen steht es in der Zeitung, übermorgen hängt das Transparent. ' +
          'Die Fanstimmung leidet, der Spieler ohnehin.')),
      [{ label: 'Lieber nicht', value: false, kind: 'primary' }, { label: 'Trotzdem', value: true, kind: 'danger' }],
      { escValue: false, size: 'sm' });
    if (!ja) return;
  }
  meldeErgebnis(sicher(() => TM.transferlisteSetzen(state, p.id, drauf), null), ctx, { art: drauf ? 'warn' : 'info' });
}

/* --- Angebotsdialog -------------------------------------------------------- */

async function dlgAngebot(state, club, ctx, p, details) {
  braucht('angebotAbgeben');
  const d = details || sicher(() => TM.abloseDetails(state, p.id, club.id), null);
  const forderung = d ? d.forderung : sicher(() => TM.marktwert(state, p.id), 0);
  const frei = verplanbar(club);
  const empfehlung = auf50k(istLegende(p) ? forderung * 1.85 : forderung * 1.02);

  let fBetrag = null, fRaten = null, fBonus = null, fWeiter = null;
  const hinweis = el('div', { style: { marginTop: '6px', lineHeight: '1.5' } });

  const pruefe = () => {
    const betrag = auf50k(zahlAus(fBetrag, 0));
    const provision = sicher(() => TM.beraterProvision(state, p.id, betrag), 0);
    const gesamt = betrag + provision;
    const teile = [];
    if (gesamt > frei) {
      teile.push(`⚠ Nicht bezahlbar: ${formatMoney(gesamt)} inklusive Beraterprovision, ` +
        `verplanbar sind ${formatMoney(frei)}.`);
    } else {
      teile.push(`Gesamtbelastung: ${formatMoney(gesamt)} (davon ${formatMoney(provision)} Berater) ` +
        `von ${formatMoney(frei)} verplanbarem Budget.`);
    }
    const quote = forderung > 0 ? betrag / forderung : 1;
    if (quote < 0.5) teile.push('Das ist keine Verhandlungsbasis, das ist eine Beleidigung.');
    else if (quote < 0.68) teile.push('Damit wird man Sie auslachen.');
    else if (quote < 0.99) teile.push('Reicht vermutlich für ein Gegenangebot — kein Ja.');
    else if (quote < 1.16) teile.push('Ordentliches Gebot. Mit etwas Glück nickt man ab.');
    else teile.push('Darüber muss niemand nachdenken. Sie zahlen allerdings drauf.');
    if (istLegende(p)) teile.push('Bei einer Ikone gilt: unter dem knapp Doppelten der Forderung legt man auf.');
    hinweis.className = gesamt > frei ? 'tv-schlecht' : 'tv-mini';
    hinweis.textContent = teile.join(' ');
  };

  const koerper = el('div.tv-spalte', null,
    el('div.tv-zeile', { style: { gap: '10px', alignItems: 'flex-start' } },
      portrait(state, p, 64, true),
      el('div', null,
        el('div.tv-zeile', { style: { gap: '6px' } },
          el('b', { style: { fontSize: '16px' } }, vollerName(p)), legendenPille(p), positionsPille(p.position)),
        el('div.tv-mini', { style: { marginTop: '3px' } },
          `${vereinsName(state, p.clubId)} · ${p.age} Jahre · Vertrag bis Saison ${p.contract ? p.contract.until : '?'}`))),

    el('div.tv-grid.tv-grid--3', { style: { gap: '6px' } },
      statBox('Forderung', formatMoney(forderung), { sub: d ? ROLLEN_TEXT[d.rolle] || '' : '' }),
      statBox('Empfehlung', formatMoney(empfehlung), { kind: 'gut', sub: 'so bekommt man ihn' }),
      statBox('Verplanbar', formatMoney(frei), { kind: frei < empfehlung ? 'schlecht' : 'gut', sub: 'Budget & Kasse' })),

    d && d.text ? el('div.tv-zettel', { style: { transform: 'none', margin: '0' } }, d.text) : null,

    el('label.tv-zeile', null, el('span', { style: { width: '150px', fontSize: '12px' } }, 'Unser Gebot'),
      (fBetrag = el('input', {
        type: 'number', step: '50000', min: '0', value: String(empfehlung),
        style: { width: '170px' }, onInput: () => pruefe()
      }))),
    el('div.tv-zeile', { style: { gap: '5px', marginLeft: '150px', flexWrap: 'wrap' } },
      button('Forderung', () => { fBetrag.value = String(forderung); pruefe(); }, { kind: 'ghost', class: 'tv-btn--klein' }),
      button('Empfehlung', () => { fBetrag.value = String(empfehlung); pruefe(); }, { kind: 'ghost', class: 'tv-btn--klein' }),
      button('− 15 %', () => { fBetrag.value = String(auf50k(zahlAus(fBetrag, 0) * 0.85)); pruefe(); }, { kind: 'ghost', class: 'tv-btn--klein' }),
      button('+ 15 %', () => { fBetrag.value = String(auf50k(zahlAus(fBetrag, 0) * 1.15)); pruefe(); }, { kind: 'ghost', class: 'tv-btn--klein' })),

    subpanel('Feinheiten',
      el('div.tv-grid.tv-grid--3', { style: { gap: '6px' } },
        el('label', null, el('div.tv-mini', null, 'Bonuszahlungen'),
          (fBonus = el('input', { type: 'number', step: '50000', min: '0', value: '0', style: { width: '100%' }, onInput: () => pruefe() }))),
        el('label', null, el('div.tv-mini', null, 'Raten'),
          (fRaten = el('select', { style: { width: '100%' } },
            ...[1, 2, 3, 4, 5].map(n => el('option', { value: String(n) }, n === 1 ? 'sofort' : `${n} Raten`))))),
        el('label', null, el('div.tv-mini', null, 'Weiterverkauf %'),
          (fWeiter = el('input', { type: 'number', step: '5', min: '0', max: '50', value: '0', style: { width: '100%' } })))),
      el('div.tv-mini', { style: { marginTop: '4px' } },
        'Boni zählen nur zu gut der Hälfte als Ablöse, Raten machen das Ganze für den Verkäufer teurer.')),

    hinweis);

  const ergebnis = await dialog(`Angebot für ${kurzName(p)}`, koerper, [
    { label: 'Abbrechen', value: null, kind: 'ghost' },
    {
      label: 'Angebot abgeben', kind: 'primary',
      onClick: () => ({
        betrag: auf50k(zahlAus(fBetrag, 0)),
        boni: { einsaetze: 0, tore: 0, titel: zahlAus(fBonus, 0) },
        raten: Number(fRaten.value) || 1,
        weiterverkauf: Math.max(0, Math.min(50, zahlAus(fWeiter, 0)))
      })
    }
  ], { escValue: null, size: 'lg', onOpen: () => pruefe() });

  if (!ergebnis) return;

  const res = sicher(() => TM.angebotAbgeben(state, club.id, p.id, ergebnis.betrag, {
    boni: ergebnis.boni, raten: ergebnis.raten, weiterverkauf: ergebnis.weiterverkauf
  }), null);
  if (!res) { toast('Das Angebot ist auf dem Weg zur Geschäftsstelle verloren gegangen.', 'schlecht'); return; }

  if (res.status === 'gegenangebot' || res.status === 'angenommen' || res.status === 'ueberlegt') {
    zustand.reiter = 'angebote';
  }
  const art = res.status === 'angenommen' ? 'gut'
    : res.status === 'abgelehnt' ? 'schlecht' : 'warn';
  meldeErgebnis(Object.assign({ ok: res.ok !== false }, res), ctx, { art });
}

/* ==========================================================================
 * 14. Transfermarkt-Nachrichten
 * ======================================================================== */

function nachrichtenPanel(state, club, ctx) {
  const transfers = sicher(() => TM.letzteTransfers(state, 12), []);
  const geruechte = sicher(() => TM.geruechte(state, 8), []);

  const box = el('div.tv-spalte', { style: { gap: '6px' } });

  if (!transfers.length && !geruechte.length) {
    box.appendChild(el('div.tv-leer', null,
      'Noch nichts passiert. Der Markt schläft — oder alle warten darauf, dass Sie den Anfang machen.'));
  }

  if (transfers.length) {
    const liste = el('div.tv-spalte', { style: { gap: '4px' } });
    for (const t of transfers) {
      const legende = t.era === 'legend';
      liste.appendChild(newsItem(
        `${t.name} wechselt von ${t.von} zu ${t.zu} — ` +
        (t.ablose > 0 ? formatMoney(t.ablose) : 'ablösefrei') + '.',
        {
          titel: legende ? '👑 Legendentransfer' : (t.typ === 'kaufoption' ? 'Kaufoption gezogen' : 'Vollzug'),
          datum: `Tag ${t.day}`,
          kind: legende ? 'warn' : (t.zuId === club.id ? 'gut' : t.vonId === club.id ? 'schlecht' : 'info'),
          onClick: state.players[t.playerId] ? () => waehleSpieler(t.playerId, ctx) : null
        }));
    }
    box.appendChild(subpanel(`Abgeschlossene Transfers (${transfers.length})`, liste));
  }

  if (geruechte.length) {
    const liste = el('div.tv-spalte', { style: { gap: '4px' } });
    for (const g of geruechte) {
      liste.appendChild(newsItem(g.text, {
        titel: '🗞️ Gerüchteküche', datum: `Tag ${g.tag}`, kind: 'info',
        onClick: state.players[g.playerId] ? () => waehleSpieler(g.playerId, ctx) : null
      }));
    }
    box.appendChild(subpanel('Was man so hört', liste));
  }

  box.appendChild(el('div.tv-mini', { style: { fontStyle: 'italic' } },
    'Gerüchte sind zu 90 % Unfug. Die restlichen 10 % kosten Sie den Wunschspieler.'));

  return panel('📰 Transfermarkt-Nachrichten', box);
}
