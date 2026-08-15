/**
 * TRAUMVEREIN – Einstieg, Rahmen und Bildschirmverwaltung.
 */

import { GAME_TITLE, GAME_SUBTITLE, DIFFICULTIES, SCREEN_ORDER, MATCH_VIEW, MATCH_VIEW_NAMES } from './core/constants.js';
import { formatMoney, formatDate, clamp } from './core/util.js';
import { emit, on, EV } from './core/events.js';
import {
  createNewGame, saveGame, loadGame, listSaves, deleteSave, exportSave, importSave,
  myClub, unreadCount, nextFixtureFor, squadOf, difficultyOf
} from './core/state.js';
import { advanceDay, aktualisiereTabellen, saisonWechsel, pokalWeiterlosen, makeCtx } from './core/loop.js';
import { CLUBS } from './data/clubs.js';
import {
  el, panel, button, dialog, toast, confirm as uiConfirm, setBestaetigungen,
  ueberlagerungenSchliessen
} from './render/ui.js';
import { drawCrest } from './render/kits.js';

/* ------------------------------------------------------------------ */

const SCREENS = {
  buero: { titel: 'Büro', icon: '🗂️' },
  kader: { titel: 'Kader', icon: '👥' },
  taktik: { titel: 'Taktik', icon: '📋' },
  training: { titel: 'Training', icon: '🏃' },
  spieltag: { titel: 'Spieltag', icon: '⚽' },
  tabelle: { titel: 'Tabelle', icon: '📊' },
  europa: { titel: 'Europapokal', icon: '🌍' },
  transfer: { titel: 'Transfermarkt', icon: '💼' },
  finanzen: { titel: 'Finanzen', icon: '💰' },
  stadion: { titel: 'Stadion', icon: '🏟️' },
  jugend: { titel: 'Jugend', icon: '🌱' },
  medizin: { titel: 'Medizin', icon: '🩺' },
  stab: { titel: 'Trainerstab', icon: '🎓' },
  presse: { titel: 'Presse', icon: '📰' },
  verein: { titel: 'Verein', icon: '🏛️' },
  chronik: { titel: 'Chronik', icon: '📜' },
  einstellungen: { titel: 'Einstellungen', icon: '⚙️' },
  // Bewusst NICHT in SCREEN_ORDER: Der Saisonabschluss ist kein Reiter, den man
  // im Februar anklickt. Er kommt einmal im Jahr von selbst – und geht wieder.
  saison: { titel: 'Saisonabschluss', icon: '🏆' },
  // Ebenfalls ohne Reiter: Der Editor (Roadmap-Stufe 6) schreibt Vereine und
  // Kader um. Als Aktenreiter zwischen „Verein" und „Chronik" wäre er der
  // Knopf, den man im dritten Rückstand drückt und danach kein Spiel mehr
  // hat. Er braucht zwei Hände (Strg + Umschalt + E) oder den Umweg über die
  // Einstellungen – siehe die Begründung im Kopf von screens/editor.js.
  editor: { titel: 'Editor', icon: '✏️' }
};

/* ------------------------------------------------------------------ *
 *  Tastenkürzel der Navigation
 *
 *  Vorher lagen nur 1–9 auf den ersten neun Reitern; jugend, medizin, stab,
 *  presse und verein waren per Tastatur überhaupt nicht erreichbar (ROADMAP S5).
 *  Jetzt läuft die Belegung einmal quer über die Tastatur, in der Reihenfolge
 *  der Navigationsleiste: erst die Zahlenreihe 1…9 und 0, dann die Buchstaben-
 *  reihe darunter Q W E R T Z U I O P. Damit ist jeder Bildschirm mit einem
 *  Anschlag erreichbar – der Europapokal seit Stufe 3 über 7, die Chronik seit
 *  Stufe 6 über Z, die Einstellungen als letzter Reiter über U. Die Zuordnung
 *  entsteht aus SCREEN_ORDER, nicht von Hand: Wer dort einen Bildschirm
 *  einschiebt, verschiebt alle Kürzel dahinter – und diesen Kommentar gleich mit.
 *
 *  Die Kürzel stehen in der Navigationsleiste und noch einmal als Tabelle im
 *  Einstellungsbildschirm (er bekommt sie über ctx.tasten, nicht als zweite
 *  Wahrheit im Quelltext).
 * ------------------------------------------------------------------ */

const TASTEN_FOLGE = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
  'q', 'w', 'e', 'r', 't', 'z', 'u', 'i', 'o', 'p'];

/** Bildschirm-Id → Taste. */
export const TASTEN = Object.freeze(SCREEN_ORDER.reduce((map, id, i) => {
  if (TASTEN_FOLGE[i]) map[id] = TASTEN_FOLGE[i];
  return map;
}, {}));

/** Taste → Bildschirm-Id. */
const SCREEN_VON_TASTE = Object.freeze(Object.keys(TASTEN).reduce((map, id) => {
  map[TASTEN[id]] = id;
  return map;
}, {}));

if (SCREEN_ORDER.length > TASTEN_FOLGE.length) {
  console.warn(`[main] ${SCREEN_ORDER.length} Bildschirme, aber nur ${TASTEN_FOLGE.length} Tasten – ` +
    `ohne Kürzel bleiben: ${SCREEN_ORDER.slice(TASTEN_FOLGE.length).join(', ')}`);
}

/** Beschriftung eines Kürzels für die Anzeige. */
export function tastenLabel(id) {
  const t = TASTEN[id];
  return t ? t.toUpperCase() : '';
}

/**
 * Die Belegung in Anzeigeform – Reihenfolge der Navigationsleiste, mit Namen und
 * Symbol. Geht als `ctx.tasten` an die Bildschirme, damit der Einstellungs-
 * bildschirm die Tabelle zeigen kann, ohne sie ein zweites Mal zu pflegen.
 */
export function tastenTabelle() {
  return SCREEN_ORDER.map(id => {
    const meta = SCREENS[id] || {};
    return { id, taste: TASTEN[id] || '', titel: meta.titel || id, icon: meta.icon || '' };
  });
}

const app = {
  root: null,
  state: null,
  aktuellerScreen: null,
  screenModule: {},
  inhaltEl: null,
  navEl: null,
  kopfEl: null,
  fussEl: null,
  laeuft: false
};

export async function boot(root) {
  app.root = root;
  root.innerHTML = '';
  bewacheSchliessen();
  await zeigeStartbildschirm();
}

/* ------------------------------------------------------------------ *
 *  Startbildschirm
 * ------------------------------------------------------------------ */

async function zeigeStartbildschirm() {
  const auswahl = { clubId: 'hsv', difficulty: 'profi', name: '', view: MATCH_VIEW.HIGHLIGHTS, interactive: true };

  const vereinsGrid = el('div', { class: 'tv-start__vereine' });
  const sortiert = CLUBS.slice().sort((a, b) => (b.reputation || 0) - (a.reputation || 0));
  for (const club of sortiert) {
    const cv = el('canvas', { width: 30, height: 30, style: { width: '30px', height: '30px' } });
    try { drawCrest(cv.getContext('2d'), club, 15, 15, 28); } catch (e) { /* Wappen optional */ }
    const btn = el('button', {
      class: 'tv-start__verein' + (club.id === auswahl.clubId ? ' gewaehlt' : ''),
      dataset: { club: club.id },
      onclick: () => {
        auswahl.clubId = club.id;
        vereinsGrid.querySelectorAll('.tv-start__verein').forEach(b => b.classList.toggle('gewaehlt', b.dataset.club === club.id));
        aktualisiereVorschau();
      }
    }, cv, el('span', {}, club.shortName, el('small', {}, `${club.leagueId === 'bl1' ? '1. Liga' : '2. Liga'} · Ruf ${club.reputation}`)));
    vereinsGrid.appendChild(btn);
  }

  const schwierigkeitGrid = el('div', { class: 'tv-schwierigkeit' });
  for (const d of Object.values(DIFFICULTIES)) {
    schwierigkeitGrid.appendChild(el('button', {
      class: d.id === auswahl.difficulty ? 'gewaehlt' : '',
      dataset: { d: d.id },
      onclick: () => {
        auswahl.difficulty = d.id;
        schwierigkeitGrid.querySelectorAll('button').forEach(b => b.classList.toggle('gewaehlt', b.dataset.d === d.id));
      }
    }, el('b', {}, d.name), el('small', {}, d.desc)));
  }

  const nameInput = el('input', {
    type: 'text', placeholder: 'Ihr Trainername', maxlength: 24,
    style: { padding: '6px 9px', width: '100%', border: '1px solid var(--linie)', background: 'var(--papier)', fontSize: '14px' },
    oninput: e => { auswahl.name = e.target.value; }
  });

  const viewSelect = el('select', {
    style: { padding: '5px', width: '100%' },
    onchange: e => { auswahl.view = e.target.value; }
  }, ...Object.entries(MATCH_VIEW_NAMES).map(([k, v]) => el('option', { value: k, selected: k === auswahl.view }, v)));

  const interaktivCheck = el('input', { type: 'checkbox', checked: true, onchange: e => { auswahl.interactive = e.target.checked; } });

  const vorschau = el('div', { class: 'tv-mini', style: { minHeight: '54px', lineHeight: '1.5' } });
  function aktualisiereVorschau() {
    const c = CLUBS.find(x => x.id === auswahl.clubId);
    vorschau.innerHTML = '';
    vorschau.appendChild(el('div', {},
      el('b', {}, c.name), ' · gegründet ', String(c.founded), ' · ', c.city));
    vorschau.appendChild(el('div', {}, `${c.stadium.name} (${c.stadium.capacity.toLocaleString('de-DE')} Plätze) · Kontostand ${formatMoney(c.finances.balance)}`));
    vorschau.appendChild(el('div', {}, c.history.honours.slice(0, 2).join(' · ')));
  }
  aktualisiereVorschau();

  const saves = listSaves();

  const box = panel('Neues Spiel',
    el('div', { class: 'tv-spalte' },
      el('div', { class: 'tv-subpanel' },
        el('div', { class: 'tv-subpanel__titel' }, 'Wählen Sie Ihren Verein'),
        vereinsGrid,
        el('div', { style: { marginTop: '7px' } }, vorschau)),
      el('div', { class: 'tv-subpanel' },
        el('div', { class: 'tv-subpanel__titel' }, 'Schwierigkeitsgrad'),
        schwierigkeitGrid),
      el('div', { class: 'tv-grid tv-grid--3' },
        el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Trainername'), nameInput),
        el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Spieldarstellung'), viewSelect),
        el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Eingreifen'),
          el('label', { class: 'tv-zeile', style: { fontSize: '12px' } }, interaktivCheck,
            ' Schlüsselszenen selbst spielen'))),
      el('div', { class: 'tv-zeile', style: { justifyContent: 'center', marginTop: '4px' } },
        button('SPIEL STARTEN', async () => {
          if (!auswahl.name.trim()) { toast('Bitte geben Sie einen Trainernamen ein.', 'warn'); nameInput.focus(); return; }
          await spielStarten(auswahl);
        }, { kind: 'primary', size: 'gross' }),
        saves.length ? button('Spielstand laden', () => zeigeLadedialog(), { kind: 'ghost' }) : null)
    ));
  box.classList.add('tv-start__box');

  const screen = el('div', { class: 'tv-start' },
    el('h1', { class: 'tv-start__logo' }, GAME_TITLE),
    el('div', { class: 'tv-start__unter' }, GAME_SUBTITLE),
    box,
    el('div', { class: 'tv-mini', style: { color: 'var(--papier-tief)', textAlign: 'center', maxWidth: '760px' } },
      'Jede Mannschaft tritt mit ihren größten Spielern aller Zeiten an – Seite an Seite mit dem aktuellen Kader. ',
      'Beckenbauer und Kane in einer Elf: Der Rest ist Ihre Aufgabe.'),
    // Die Geschichtsseite liegt neben dem Spiel und nicht in ihm: In der
    // heruntergeladenen Einzeldatei gibt es sie nicht, deshalb zeigt der Verweis
    // ins Netz statt auf eine Nachbardatei, die dort fehlen würde.
    el('div', { class: 'tv-mini', style: { textAlign: 'center', marginTop: '10px' } },
      el('a', {
        href: 'https://grundhofer.github.io/traumverein/geschichte.html',
        target: '_blank', rel: 'noopener',
        style: { color: 'var(--gold-hell)' }
      }, 'Wie dieses Spiel entstanden ist')));

  app.root.innerHTML = '';
  app.root.appendChild(screen);
  // `preventScroll`: Das Feld steht weit unten. Ohne diesen Zusatz rollt der
  // Browser es beim Fokussieren ins Bild und schiebt dabei den Schriftzug aus
  // dem Fenster – man landet auf einem Startbildschirm mit abgeschnittenem Kopf.
  nameInput.focus({ preventScroll: true });
}

async function zeigeLadedialog() {
  const saves = listSaves();
  const liste = el('div', { class: 'tv-spalte' });
  for (const s of saves) {
    liste.appendChild(el('div', { class: 'tv-zeile tv-zeile--verteilt', style: { padding: '6px', borderBottom: '1px solid var(--linie)' } },
      el('div', {}, el('b', {}, s.label), el('div', { class: 'tv-mini' }, `${s.manager} · Saison ${s.season} · Tag ${s.day} · ${DIFFICULTIES[s.difficulty] ? DIFFICULTIES[s.difficulty].name : s.difficulty}`)),
      el('div', { class: 'tv-zeile' },
        button('Laden', async () => {
          try {
            const state = await loadGame(s.slot);
            if (!state) { toast('Spielstand nicht lesbar.', 'schlecht'); return; }
            schliesseDialoge();
            await spielAufbauen(state);
          } catch (err) {
            toast('Laden fehlgeschlagen: ' + err.message, 'schlecht');
          }
        }, { kind: 'primary', size: 'klein' }),
        button('Löschen', async () => {
          // `immer: true`: Ein Spielstand ist keine Spielentscheidung, sondern eine
          // Datei. Die Rückfrage bleibt, auch wenn Bestätigungen abgeschaltet sind.
          if (await uiConfirm('Löschen?', `Spielstand „${s.label}" wirklich löschen?`, { immer: true })) {
            await deleteSave(s.slot);
            schliesseDialoge();
            zeigeLadedialog();
          }
        }, { kind: 'danger', size: 'klein' }))));
  }
  if (!saves.length) liste.appendChild(el('div', { class: 'tv-leer' }, 'Keine Spielstände vorhanden.'));
  liste.appendChild(el('div', { class: 'tv-zeile', style: { marginTop: '10px', justifyContent: 'center' } },
    button('Aus Datei laden', () => ausDateiLaden(), { kind: 'ghost', size: 'klein' })));
  await dialog('Spielstand laden', liste, [{ label: 'Schließen', value: null }]);
}

function schliesseDialoge() {
  document.querySelectorAll('.tv-overlay').forEach(o => o.remove());
}

async function spielStarten(auswahl) {
  app.root.innerHTML = '';
  app.root.appendChild(el('div', { class: 'tv-lade' }, 'Die Liga wird zusammengestellt …'));
  await new Promise(r => setTimeout(r, 30));
  const state = createNewGame({
    clubId: auswahl.clubId,
    managerName: auswahl.name.trim(),
    difficulty: auswahl.difficulty,
    settings: { matchView: auswahl.view, interactive: auswahl.interactive }
  });
  aktualisiereTabellen(state);
  await spielAufbauen(state);
}

/* ------------------------------------------------------------------ *
 *  Spielrahmen
 * ------------------------------------------------------------------ */

async function spielAufbauen(state) {
  app.state = state;
  app.root.innerHTML = '';

  // Ein frisch geladener oder neu begonnener Stand gilt als gesichert – sonst
  // warnte das Schließen sofort, obwohl noch kein Tag vergangen ist.
  gesichertBis = state.tick;
  letzterAutosave = state.tick;

  // Rückfragen sind eine Einstellung (state.settings.bestaetigungen), render/ui.js
  // hat aber keinen Zugriff auf den Spielstand – also einmal beim Aufbau setzen.
  // Der Einstellungsbildschirm schaltet danach live nach.
  setBestaetigungen(!state.settings || state.settings.bestaetigungen !== false);

  app.kopfEl = el('header', { class: 'tv-kopf' });
  app.navEl = el('nav', { class: 'tv-nav' });
  app.inhaltEl = el('main', { class: 'tv-inhalt' });
  app.fussEl = el('footer', { class: 'tv-fuss' });

  app.root.appendChild(el('div', { class: 'tv-shell' }, app.kopfEl, app.navEl, app.inhaltEl, app.fussEl));

  zeichneNav();
  zeichneKopf();
  zeichneFuss();

  on(EV.STATE_CHANGED, () => { zeichneKopf(); zeichneNav(); });

  // Der AudioContext wartet auf die erste Geste – vorher lässt ihn kein
  // Browser laufen. Ab hier steht die Bank für alle Bildschirme bereit.
  tonWecken();

  document.addEventListener('keydown', tastatur);
  await navigate('buero');
}

function tastatur(e) {
  if (typeof e.key !== 'string') return;
  // Dialoge (ui.js:dialogTasten) und Minispiele bringen ihren eigenen ESC-Weg
  // mit und behalten Vorrang – auch für alles andere auf dieser Tastatur.
  // `:not(.tv-overlay--zu)` ist kein Schönheitsfehler: ui.js nimmt eine
  // geschlossene Hülle erst 260 ms später aus dem Dokument (Ausblendanimation).
  // Ohne diesen Zusatz wäre die gesamte Tastatur für eine Viertelsekunde stumm –
  // ESC, alle Reiter-Kürzel und Strg+S. Gefunden beim Bau von test-screens.js.
  if (document.querySelector('.tv-overlay:not(.tv-overlay--zu)') || document.querySelector('.tv-minispiel')) return;

  // ESC kommt vor der Eingabefeld-Sperre: Wer in einem Filterfeld steht, soll
  // mit ESC herauskommen, statt gefangen zu bleiben.
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) { escapeKette(e); return; }

  if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.target && e.target.isContentEditable) return;

  // Strg/Cmd gehört dem Browser – bis auf Strg+S. Alt bleibt unangetastet,
  // sonst würde Alt+T (Menüzugriff) plötzlich Bildschirme wechseln.
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); speichern(); return; }
    // Der Schalter, hinter dem der Editor steht. Drei Tasten, damit er kein
    // Versehen sein kann; „E" wie Editor. Der zweite Weg hinein ist der Knopf
    // im Einstellungsbildschirm.
    if (e.shiftKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); navigate('editor'); return; }
    return;
  }
  if (e.altKey) return;

  const id = SCREEN_VON_TASTE[e.key.toLowerCase()];
  if (id) { navigate(id); return; }

  if (e.key === ' ' || e.key === 'Enter') {
    // Leertaste und Enter heißen „Weiter" – aber nur, wenn kein Bedienelement
    // den Anschlag selbst braucht. Sonst löst ein Druck zwei Dinge aus:
    // Gemessen am Prüfstand von Stufe 6 wählte Enter auf einer Kaderzeile den
    // Spieler aus UND schaltete gleichzeitig Tage vor, bis der Bildschirm
    // wechselte. Dasselbe galt still schon vorher für jeden fokussierten Knopf.
    if (istBedienelement(e.target)) return;
    e.preventDefault();
    weiter();
  }
}

/** Tags und Rollen, die Leertaste/Enter selbst auswerten. */
const BEDIEN_TAGS = /^(button|a|tr|th|td|summary|label|option|details)$/i;

function istBedienelement(ziel) {
  if (!ziel || !ziel.tagName || ziel === document.body) return false;
  if (BEDIEN_TAGS.test(ziel.tagName)) return true;
  if (typeof ziel.hasAttribute === 'function' && ziel.hasAttribute('tabindex')) return true;
  if (typeof ziel.getAttribute === 'function' && ziel.getAttribute('role')) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 *  Die Escape-Kette (Roadmap-Stufe 6, Punkt 3)
 *
 *  ESC hatte bisher genau eine Bedeutung: „Dialog zu" (ui.js) bzw. „Szene
 *  der Simulation überlassen" (Minispiele). Außerhalb davon passierte nichts –
 *  man kam aus einem Filterfeld nicht mehr heraus und von einem Unterbildschirm
 *  nur über die Maus zurück. Jetzt läuft ESC eine Kette ab, immer in dieser
 *  Reihenfolge, und hört beim ersten Treffer auf:
 *
 *    0. Dialog oder Minispiel offen?  → gehört denen, wir sehen die Taste nie.
 *    1. Überlagerungen des Rahmens    → Kurzhinweis, Meldungszettel (ui.js).
 *    2. Auswahlzustand des Bildschirms → screen.onEscape(), falls vorhanden.
 *    3. Fokus im Inhalt               → loslassen (raus aus dem Eingabefeld).
 *    4. Sonst                         → zurück ins Büro.
 *
 *  Der Vertrag `screen.onEscape(): boolean` ist additiv – wer `true` liefert,
 *  hat die Taste verbraucht. Seit Stufe 6 bedient ihn **ein** Bildschirm:
 *  `screens/editor.js` gibt beim ersten Anschlag das offene Formular frei und
 *  erst beim zweiten den Bildschirm. Die Auswahlzustände der dichten
 *  Bildschirme (`zustand.gewaehlt` in screens/kader.js, transfer.js,
 *  taktik.js) liegen weiterhin ohne Rückweg in den Modulen; dort ist ESC
 *  bewusst der kurze Weg ins Büro, weil eine leere Spielerakte nichts zeigt,
 *  was eine ausgewählte nicht auch zeigt.
 * ------------------------------------------------------------------ */
function escapeKette(e) {
  /* 1. Überlagerungen außerhalb des Dialogstapels. */
  if (ueberlagerungenSchliessen()) { e.preventDefault(); return; }

  /* 2. Auswahlzustand des Bildschirms. */
  const mod = app.screenModule[app.aktuellerScreen];
  const screen = mod && (mod.screen || mod.default);
  if (screen && typeof screen.onEscape === 'function') {
    let verbraucht = false;
    try { verbraucht = screen.onEscape() === true; }
    catch (err) { console.error(`[main] onEscape von "${app.aktuellerScreen}" ist gescheitert:`, err); }
    if (verbraucht) { e.preventDefault(); return; }
  }

  /* 3. Fokus im Inhalt loslassen. */
  const aktiv = document.activeElement;
  if (aktiv && aktiv !== document.body && app.inhaltEl && app.inhaltEl.contains(aktiv)) {
    e.preventDefault();
    if (typeof aktiv.blur === 'function') aktiv.blur();
    return;
  }

  /* 4. Zurück ins Büro. Wer schon dort steht, bleibt dort. */
  if (app.aktuellerScreen !== 'buero') {
    e.preventDefault();
    navigate('buero');
  }
}

function zeichneKopf() {
  const s = app.state;
  const club = myClub(s);
  const k = app.kopfEl;
  k.innerHTML = '';

  const cv = el('canvas', { class: 'tv-kopf__wappen', width: 76, height: 76, style: { width: '38px', height: '38px' } });
  try { drawCrest(cv.getContext('2d'), club, 38, 38, 72); } catch (e) { /* egal */ }

  const naechstes = nextFixtureFor(s, club.id);
  const gegner = naechstes ? s.clubs[naechstes.homeId === club.id ? naechstes.awayId : naechstes.homeId] : null;
  const tabelle = s.tables[club.leagueId] || [];
  const zeile = tabelle.find(z => z.clubId === club.id);

  k.appendChild(cv);
  k.appendChild(el('div', { class: 'tv-kopf__verein' },
    el('b', {}, club.name),
    el('span', {}, `${s.manager.name} · Saison ${s.date.season}`)));
  k.appendChild(el('div', { class: 'tv-kopf__spacer' }));

  const stat = (label, wert, klasse) => el('div', { class: 'tv-kopf__stat' },
    el('label', {}, label), el('b', { class: klasse || '' }, wert));

  k.appendChild(stat('Datum', formatDate(s.date.day, s.date.season)));
  k.appendChild(stat('Tabelle', zeile ? `${zeile.platz}. · ${zeile.punkte} Pkt` : '–'));
  k.appendChild(stat('Konto', formatMoney(club.finances.balance), club.finances.balance >= 0 ? 'plus' : 'minus'));
  k.appendChild(stat('Stimmung', `${Math.round(club.fans.mood)} %`, club.fans.mood >= 60 ? 'plus' : club.fans.mood < 40 ? 'minus' : ''));
  k.appendChild(stat('Nächstes', gegner ? `${naechstes.homeId === club.id ? 'H' : 'A'} ${gegner.abbr}` : '–'));

  k.appendChild(el('div', { style: { marginLeft: '12px' } },
    button('WEITER ▶', () => weiter(), { kind: 'primary' })));
  k.appendChild(el('div', { class: 'tv-zeile' },
    button('💾', () => speichern(), { kind: 'ghost', tooltip: 'Speichern (Strg+S)' }),
    button('⬇', () => alsDateiSichern(), { kind: 'ghost', tooltip: 'Spielstand als Datei sichern' })));
}

/**
 * Der Aktenschrank. Unter 1000 px Fensterbreite schrumpft er per CSS zur
 * Symbolleiste – deshalb steht die Beschriftung seit Stufe 6 in einem eigenen
 * `<span>` statt als nackter Textknoten: Nur so lässt sie sich ausblenden,
 * ohne dass das Symbol mitgeht. `title` und `aria-label` tragen den Namen
 * weiter, wenn er nicht mehr zu sehen ist; die Tastenkürzel liegen ohnehin in
 * main.js:tastatur() und sind von der Darstellung unabhängig.
 */
function zeichneNav() {
  const n = app.navEl;
  const ungelesen = unreadCount(app.state);
  n.innerHTML = '';
  SCREEN_ORDER.forEach((id, i) => {
    const meta = SCREENS[id];
    if (!meta) return;
    const kuerzel = tastenLabel(id);
    const name = kuerzel ? `${meta.titel} (Taste ${kuerzel})` : meta.titel;
    const btn = el('button', {
      class: 'tv-nav__btn' + (app.aktuellerScreen === id ? ' aktiv' : ''),
      title: name,
      'aria-label': name,
      'aria-current': app.aktuellerScreen === id ? 'page' : null,
      onclick: () => navigate(id)
    }, el('span', { class: 'tv-nav__icon' }, meta.icon),
    el('span', { class: 'tv-nav__label' }, meta.titel));
    if (id === 'buero' && ungelesen > 0) btn.appendChild(el('span', { class: 'tv-nav__badge' }, String(ungelesen)));
    if (kuerzel) btn.appendChild(el('span', { class: 'tv-nav__taste' }, kuerzel));
    n.appendChild(btn);
    if (i === 3 || i === 6 || i === 9) n.appendChild(el('div', { class: 'tv-nav__trenner' }));
  });
}

function zeichneFuss() {
  const s = app.state;
  const f = app.fussEl;
  f.innerHTML = '';
  const meldungen = s.news.slice(0, 8).map(n => n.text);
  f.appendChild(el('div', { class: 'tv-fuss__ticker' },
    el('span', {}, meldungen.length ? meldungen.join('   ✦   ') : 'Willkommen im Traumverein.')));
  f.appendChild(el('div', {}, `${GAME_TITLE} · ${difficultyOf(s).name}`));
}

/* ------------------------------------------------------------------ *
 *  Navigation
 * ------------------------------------------------------------------ */

/**
 * Fünf Bildschirme exportieren seit jeher ein `onLeave()` – aufgerufen hat es
 * niemand. Der Höhepunkte-Abspieler des Spieltags lief deshalb im Hintergrund
 * weiter, wenn man während der Wiederholung den Reiter wechselte, und der
 * Einstellungsbildschirm hätte seinen AudioContext nie wieder losbekommen.
 */
function verlasseAktuellenScreen() {
  const alt = app.aktuellerScreen;
  if (!alt) return;
  const mod = app.screenModule[alt];
  const screen = mod && (mod.screen || mod.default);
  if (!screen || typeof screen.onLeave !== 'function') return;
  try { screen.onLeave(); }
  catch (err) { console.error(`[main] onLeave von "${alt}" ist gescheitert:`, err); }
}

export async function navigate(id, params = {}) {
  if (!SCREENS[id]) { toast(`Unbekannter Bildschirm: ${id}`, 'schlecht'); return; }
  verlasseAktuellenScreen();
  app.aktuellerScreen = id;
  zeichneNav();
  app.inhaltEl.innerHTML = '';
  app.inhaltEl.scrollTop = 0;

  let mod = app.screenModule[id];
  if (!mod) {
    try {
      mod = await import(`./screens/${id}.js`);
      app.screenModule[id] = mod;
    } catch (err) {
      console.error(`[main] Bildschirm "${id}" konnte nicht geladen werden:`, err);
      app.inhaltEl.appendChild(panel(`${SCREENS[id].titel} – nicht verfügbar`,
        el('div', { class: 'tv-spalte' },
          el('p', {}, `Das Modul src/screens/${id}.js konnte nicht geladen werden.`),
          el('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '11px', background: 'rgba(0,0,0,.12)', padding: '8px' } },
            String(err && err.message || err)))));
      return;
    }
  }

  const screen = mod.screen || mod.default;
  if (!screen || typeof screen.render !== 'function') {
    app.inhaltEl.appendChild(panel('Fehler', el('p', {}, `src/screens/${id}.js exportiert kein gültiges screen-Objekt.`)));
    return;
  }

  try {
    await screen.render(app.inhaltEl, ctxFuerScreen(params));
  } catch (err) {
    console.error(`[main] Fehler im Bildschirm "${id}":`, err);
    app.inhaltEl.appendChild(panel('Fehler beim Anzeigen',
      el('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '11px' } }, String(err && err.stack || err))));
  }
  // Lautstärke, Stummschaltung und Atmosphäre stehen im Spielstand und dürfen
  // dort auch verändert werden – der Einstellungsbildschirm tut genau das.
  klang.abgleichen();
  emit(EV.SCREEN_CHANGED, id);
}

function ctxFuerScreen(params) {
  return {
    state: app.state,
    params,
    tasten: tastenTabelle(),
    navigate,
    refresh: () => navigate(app.aktuellerScreen, params),
    aktualisiere: () => { zeichneKopf(); zeichneNav(); zeichneFuss(); },
    weiter,
    speichern,
    actions
  };
}

/* ------------------------------------------------------------------ *
 *  Ton
 *
 *  EINE Klangbank für das ganze Spiel. Baute sich jeder Bildschirm seine
 *  eigene, hätte jeder auch seinen eigenen AudioContext – davon erlauben
 *  Browser nur eine Handvoll, danach bleibt es still. Die Bank hängt
 *  deshalb hier im Rahmen und geht als `actions.klang` an alle Bildschirme.
 *
 *  Sie entsteht erst bei der ersten Nutzerinteraktion: Ohne eine solche
 *  Geste sperrt jeder Browser die Tonausgabe, ein früher geöffneter Kontext
 *  läge nur suspendiert herum.
 *
 *  Ohne WebAudio (Node, alter Browser) liefert createSoundBank() eine
 *  vollständige, stumme Attrappe. Deshalb steht hier nirgends eine Abfrage
 *  auf `verfuegbar` – es läuft einfach alles weiter, nur eben lautlos.
 * ------------------------------------------------------------------ */

const TON_VORGABE = { lautstaerke: 0.7 };

let tonBank = null;           // die eine Bank, sobald sie steht
let tonVersprechen = null;    // verhindert, dass zwei Aufrufe zwei Banken bauen
let tonHoerer = null;         // Einmal-Lauscher auf die erste Geste
let atmoGewuenscht = false;   // läuft gerade ein Spiel?
let atmoZustand = null;       // letzter Stadionzustand – überlebt den Bankbau

/** Die Toneinstellungen des laufenden Spielstands, mit Rückfallwerten. */
function tonWerte() {
  const s = (app.state && app.state.settings) || {};
  const l = Number(s.lautstaerke);
  return {
    lautstaerke: Number.isFinite(l) ? clamp(l, 0, 1) : TON_VORGABE.lautstaerke,
    stumm: s.klaenge === false,
    atmosphaere: s.atmosphaere !== false
  };
}

async function tonBauen() {
  let mod;
  try {
    mod = await import('./render/sound.js');
  } catch (err) {
    console.warn('[main] Tonschicht nicht ladbar – es bleibt still:', err);
    return null;
  }
  if (!mod || typeof mod.createSoundBank !== 'function') {
    console.warn('[main] src/render/sound.js kennt kein createSoundBank().');
    return null;
  }
  const w = tonWerte();
  try {
    tonBank = mod.createSoundBank({ lautstaerke: w.lautstaerke, stumm: w.stumm });
  } catch (err) {
    console.warn('[main] Klangbank ließ sich nicht öffnen:', err);
    return null;
  }
  // Wurde während des Bauens schon ein Spiel angepfiffen, holt die Bank das nach.
  if (atmoGewuenscht && tonWerte().atmosphaere) {
    tonBank.atmoStart();
    if (atmoZustand) tonBank.atmo(atmoZustand);
  }
  return tonBank;
}

function tonHolen() {
  if (tonBank) return Promise.resolve(tonBank);
  if (!tonVersprechen) tonVersprechen = tonBauen().catch(() => null);
  return tonVersprechen;
}

/**
 * Hängt sich an die erste Geste und öffnet dann den AudioContext. Danach
 * meldet sich der Lauscher selbst wieder ab – er hat genau eine Aufgabe.
 */
function tonWecken() {
  if (tonBank || tonHoerer || typeof document === 'undefined') return;
  const ereignisse = ['pointerdown', 'touchstart', 'keydown'];
  const hoerer = () => {
    tonAbmelden();
    tonHolen().then(b => { if (b && b.aufwecken) b.aufwecken(); });
  };
  tonHoerer = { ereignisse, hoerer };
  for (const ev of ereignisse) document.addEventListener(ev, hoerer, { capture: true, passive: true });
}

function tonAbmelden() {
  if (!tonHoerer || typeof document === 'undefined') { tonHoerer = null; return; }
  for (const ev of tonHoerer.ereignisse) document.removeEventListener(ev, tonHoerer.hoerer, { capture: true });
  tonHoerer = null;
}

/**
 * Die Klangbank, wie sie der Rest des Spiels sieht. Jeder Aufruf ist
 * gefahrlos, auch bevor die Bank existiert: Was zu früh kommt, wird
 * nachgeholt (Atmosphäre) oder verworfen (ein Klick von vorgestern).
 */
export const klang = {
  get verfuegbar() { return !!(tonBank && tonBank.verfuegbar); },

  /** Promise auf die Bank – für alles, was sie wirklich in die Hand nehmen muss. */
  bereit() { return tonHolen(); },

  play(name, opts) {
    if (tonWerte().stumm) return false;
    if (tonBank) return tonBank.play(name, opts);
    tonHolen().then(b => { if (b && !tonWerte().stumm) b.play(name, opts); });
    return false;
  },

  gong(art) {
    if (tonWerte().stumm) return false;
    if (tonBank) return tonBank.gong(art);
    tonHolen().then(b => { if (b && !tonWerte().stumm) b.gong(art); });
    return false;
  },

  atmoStart() {
    if (!tonWerte().atmosphaere) return false;
    atmoGewuenscht = true;
    if (tonBank) {
      const ok = tonBank.atmoStart();
      if (ok && atmoZustand) tonBank.atmo(atmoZustand);
      return ok;
    }
    tonHolen();
    return false;
  },

  atmo(zustand) {
    if (zustand && typeof zustand === 'object') {
      atmoZustand = Object.assign({}, atmoZustand || {}, zustand);
    }
    if (!tonBank || !atmoGewuenscht) return false;
    return tonBank.atmo(atmoZustand);
  },

  atmoStop(schnell) {
    atmoGewuenscht = false;
    atmoZustand = null;
    if (!tonBank) return false;
    return tonBank.atmoStop(schnell);
  },

  /**
   * Übernimmt Lautstärke, Stummschaltung und Atmosphäre aus den
   * Einstellungen. Wird nach jedem Bildschirmwechsel gerufen – damit wirkt
   * der Regler im Einstellungsbildschirm auf der Stelle, ohne dass der
   * Bildschirm etwas vom Rahmen wissen muss.
   */
  abgleichen() {
    if (!tonBank) return;
    const w = tonWerte();
    tonBank.setLautstaerke(w.lautstaerke);
    tonBank.setStumm(w.stumm);
    if (!w.atmosphaere && atmoGewuenscht) { atmoGewuenscht = false; tonBank.atmoStop(); }
  },

  /** Alles zu – beim Rückweg ins Hauptmenü. */
  schliessen() {
    atmoGewuenscht = false;
    atmoZustand = null;
    tonAbmelden();
    if (tonBank) { try { tonBank.destroy(); } catch (err) { /* egal */ } }
    tonBank = null;
    tonVersprechen = null;
  }
};

/* ------------------------------------------------------------------ *
 *  Aktionen
 * ------------------------------------------------------------------ */

export const actions = {
  navigate,
  weiter,
  speichern,
  get state() { return app.state; },
  aktualisiereTabellen: () => aktualisiereTabellen(app.state),
  redraw: () => { zeichneKopf(); zeichneNav(); zeichneFuss(); },
  toast,
  klang,
  sound: (name, opts) => klang.play(name, opts)
};

async function speichern(slot = 1) {
  try {
    const eintrag = await saveGame(app.state, slot);
    gesichertBis = app.state.tick;
    toast(`Gespeichert: ${eintrag.label}`, 'gut');
  } catch (err) {
    console.error('[main] Speichern fehlgeschlagen:', err);
    toast('Speichern fehlgeschlagen: ' + err.message + ' – nutzen Sie „Als Datei sichern".', 'schlecht');
  }
}

/* ---------------------------------------------------------------------------
 * Automatisches Speichern
 *
 * Eine Karriere über zehn Saisons ist zu viel Arbeit, um sie an ein vergessenes
 * Strg+S zu hängen. `hasAutosave()` in core/state.js sieht den Slot 'auto' seit
 * jeher vor – geschrieben hat ihn nur nie jemand.
 *
 * Zurückhaltend: Ein Spielstand ist rund fünf Megabyte, also nicht bei jedem
 * Tastendruck, sondern höchstens alle AUTOSAVE_ABSTAND Ticks. Und leise – wer
 * spielt, will keine Erfolgsmeldung, sondern seinen Spielstand.
 * ------------------------------------------------------------------------- */

/** So viele Ticks müssen zwischen zwei automatischen Sicherungen liegen. */
const AUTOSAVE_ABSTAND = 7;

/** Bis zu diesem Tick ist der Stand gesichert – Grundlage der Schließen-Warnung. */
let gesichertBis = -1;
let letzterAutosave = -Infinity;
let autosaveKlage = false;

async function autoSpeichern() {
  if (!app.state) return;
  const tick = app.state.tick;
  if (tick - letzterAutosave < AUTOSAVE_ABSTAND) return;
  try {
    await saveGame(app.state, 'auto', `Automatisch – Saison ${app.state.date.season}, Tag ${app.state.date.day}`);
    letzterAutosave = tick;
    gesichertBis = tick;
  } catch (err) {
    // Ohne Datenbank – etwa aus einer lokalen Datei geöffnet – scheitert das
    // jedes Mal. Einmal sagen reicht; danach nur noch ins Protokoll.
    console.warn('[main] Automatisches Speichern fehlgeschlagen:', err);
    if (!autosaveKlage) {
      autosaveKlage = true;
      toast('Automatisches Speichern geht hier nicht: ' + err.message
        + ' Sichern Sie über ⬇ als Datei.', 'warn');
    }
  }
}

/**
 * Warnt, wenn ungesicherte Tage im Spiel stehen. Der Browser zeigt dabei seinen
 * eigenen Text – wir können nur sagen, dass es etwas zu verlieren gibt.
 */
function bewacheSchliessen() {
  window.addEventListener('beforeunload', (e) => {
    if (!app.state || app.state.tick <= gesichertBis) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

/** Spielstand als Datei herunterladen – unabhängig vom Browserspeicher. */
function alsDateiSichern() {
  try {
    const { name, inhalt } = exportSave(app.state);
    const url = URL.createObjectURL(new Blob([inhalt], { type: 'application/json' }));
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Spielstand gesichert: ${name}`, 'gut');
  } catch (err) {
    toast('Sichern fehlgeschlagen: ' + err.message, 'schlecht');
  }
}

/** Spielstand aus einer Datei laden. */
function ausDateiLaden(danach) {
  const input = el('input', {
    type: 'file', accept: '.json,application/json',
    style: { display: 'none' },
    onchange: async (e) => {
      const datei = e.target.files && e.target.files[0];
      if (!datei) return;
      try {
        const state = importSave(await datei.text());
        schliesseDialoge();
        await spielAufbauen(state);
        if (danach) danach();
        toast('Spielstand geladen.', 'gut');
      } catch (err) {
        toast('Datei konnte nicht gelesen werden: ' + err.message, 'schlecht');
      } finally {
        input.remove();
      }
    }
  });
  document.body.appendChild(input);
  input.click();
}

/** Der „Weiter"-Knopf: schaltet Tage vor, bis etwas passiert. */
async function weiter() {
  if (app.laeuft) return;
  app.laeuft = true;
  try {
    for (let i = 0; i < 90; i++) {
      const res = await advanceDay(app.state);
      if (res.stop === 'spieltag') {
        zeichneKopf(); zeichneFuss();
        await navigate('spieltag', { fixture: res.fixture.id });
        return;
      }
      if (res.stop === 'saisonende') {
        await saisonEnde();
        return;
      }
      if (res.stop === 'entlassung') {
        await entlassung();
        return;
      }
      if (res.stop === 'post') {
        zeichneKopf(); zeichneNav(); zeichneFuss();
        if (app.aktuellerScreen !== 'buero') await navigate('buero');
        else await navigate('buero');
        return;
      }
      pokalWeiterlosen(app.state, makeCtx(app.state));
    }
    zeichneKopf(); zeichneNav(); zeichneFuss();
    await navigate(app.aktuellerScreen || 'buero');
  } finally {
    app.laeuft = false;
    // Nach jedem Halt, an dem der Manager wieder am Zug ist – auch nach einem
    // frühen return oben, dafür steht es im finally.
    await autoSpeichern();
  }
}

/**
 * Saisonende: Der Weltzustandsübergang liegt seit Stufe 1 in
 * core/loop.js:saisonWechsel(). Hier wird nur noch aufgerufen und angezeigt.
 */
async function saisonEnde() {
  toast('Der Abschlussbericht wird erstellt …', 'info');
  let bericht;
  try {
    bericht = await saisonWechsel(app.state, makeCtx(app.state));
  } catch (err) {
    console.error('[main] Saisonwechsel fehlgeschlagen:', err);
    await dialog('Der Saisonwechsel ist gescheitert',
      el('div', { class: 'tv-spalte' },
        el('p', {}, 'Beim Übergang in die neue Spielzeit ist etwas schiefgegangen. ' +
          'Der Spielstand bleibt, wie er ist – bitte laden Sie den letzten Stand.'),
        el('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '11px' } }, String(err && err.message || err))),
      [{ label: 'Weiter', value: true, kind: 'danger' }]);
    return;
  }

  zeichneKopf(); zeichneNav(); zeichneFuss();
  await navigate('saison', { bericht });

  if (bericht.vorstandsurteil && bericht.vorstandsurteil.entlassen) {
    await entlassung();
  }
}

async function entlassung() {
  await dialog('Sie sind entlassen',
    el('div', {}, el('p', {}, 'Der Vorstand hat das Vertrauen in Sie verloren. Ihre Zeit bei diesem Verein ist beendet.')),
    [{ label: 'Zum Hauptmenü', value: true, kind: 'danger' }]);
  document.removeEventListener('keydown', tastatur);
  klang.schliessen();
  await boot(app.root);
}

export { app };
