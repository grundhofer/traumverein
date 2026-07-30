/**
 * Bildschirm „Einstellungen" — der Schalterkasten des Managerbüros.
 *
 * Hier liegt alles, was das Spiel *anfühlt*, aber nichts, was es *entscheidet*:
 * Darstellung, Eingreifen, Ton, Tempo, Bequemlichkeit. Kein Schalter auf dieser
 * Seite verändert eine einzige Zahl in der Simulation — wer sich hier bedient,
 * bekommt keinen Vorteil, nur weniger Klicks oder mehr Kino.
 *
 * Vier Einstellungen (autoAufstellung, textTempo, animationen, bestaetigungen)
 * standen seit jeher im Spielstand und wurden von keiner Zeile gelesen
 * (ROADMAP S5). Sie sind jetzt angeschlossen; wo, steht bei jedem Schalter dabei.
 *
 * Die Tonschicht wird bewusst NUR dynamisch geladen: Ist src/render/sound.js
 * nicht vorhanden oder meldet sie `verfuegbar === false` (Node, alter Browser,
 * gesperrter AudioContext), funktioniert dieser Bildschirm unverändert weiter —
 * er sagt dann nur ehrlich, warum es still bleibt.
 */

import { el, panel, subpanel, button, slider, toast, setBestaetigungen } from '../render/ui.js';
import { myClub } from '../core/state.js';
import { MATCH_VIEW, MATCH_VIEW_NAMES } from '../core/constants.js';
import { nfmt } from '../core/util.js';

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Vorgaben
 *
 * Alte Spielstände kennen die Tonfelder noch nicht. Statt state.js:migrate()
 * dafür zu bemühen, füllt der Bildschirm die Lücken beim Öffnen auf — dieselbe
 * Stelle, an der sie auch verändert werden.
 * ════════════════════════════════════════════════════════════════════════ */

const VORGABE = {
  matchView: MATCH_VIEW.HIGHLIGHTS,
  speed: 2,
  animationen: true,
  interactive: true,
  lautstaerke: 0.7,
  atmosphaere: true,
  klaenge: true,
  textTempo: 'normal',
  bestaetigungen: true,
  autoAufstellung: false
};

const MINISPIELE = [
  ['elfmeter', 'Elfmeter', 'Elf Meter, zwei Ausgänge, eine Legende.'],
  ['freistoss', 'Freistoß', 'Mauer stellen lassen und trotzdem drüberzirkeln.'],
  ['ecke', 'Ecke', 'Reinbringen. Der Rest ist Volksglaube.'],
  ['abschluss', 'Abschluss', 'Allein vor dem Tor — die einsamste Sekunde des Sports.'],
  ['kombination', 'Kombination', 'Den letzten Pass spielen Sie selbst.']
];

const TEMPO_STUFEN = [
  [0.5, 'Gemächlich (½×)'], [1, 'Normal (1×)'], [2, 'Zügig (2×)'],
  [4, 'Schnell (4×)'], [8, 'Zeitraffer (8×)']
];

/** Muss zu TEXT_TEMPO in game/matchday.js passen — dort wirken die Faktoren. */
const TEXT_TEMPI = [
  ['langsam', 'Langsam', 'Zum Mitlesen. Der Ticker lässt sich Zeit.'],
  ['normal', 'Normal', 'So war es gedacht.'],
  ['schnell', 'Schnell', 'Sie wollen das Ergebnis, nicht die Prosa.']
];

/** Klangproben — Namen aus dem Vertrag von render/sound.js. */
const PROBEN = [
  ['anpfiff', 'Anpfiff'], ['tor', 'Tor'], ['parade', 'Parade'],
  ['pfosten', 'Pfosten'], ['pfeifkonzert', 'Pfeifkonzert'], ['klick', 'Klick']
];

function einstellungenAuffuellen(state) {
  if (!state.settings) state.settings = {};
  const s = state.settings;
  for (const key of Object.keys(VORGABE)) {
    if (s[key] === undefined || s[key] === null) s[key] = VORGABE[key];
  }
  if (typeof s.lautstaerke !== 'number' || !isFinite(s.lautstaerke)) s.lautstaerke = VORGABE.lautstaerke;
  s.lautstaerke = Math.min(1, Math.max(0, s.lautstaerke));
  if (!s.minigames || typeof s.minigames !== 'object') {
    s.minigames = { elfmeter: true, freistoss: true, ecke: true, abschluss: true, kombination: true };
  }
  return s;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Die Tonbank — freiwillig, entbehrlich, aufräumbar
 * ════════════════════════════════════════════════════════════════════════ */

let bank = null;            // die laufende Tonbank, nur solange dieser Bildschirm offen ist
let bankVersprechen = null; // verhindert, dass ein zappelnder Regler drei Banken öffnet
let bankGrund = null;       // warum es still bleibt
let atmoTimer = 0;

async function bankBauen(s) {
  let mod;
  try {
    mod = await import('../render/sound.js');
  } catch (err) {
    bankGrund = 'Die Tonschicht (src/render/sound.js) ließ sich nicht laden: ' + (err && err.message);
    return null;
  }
  if (!mod || typeof mod.createSoundBank !== 'function') {
    bankGrund = 'src/render/sound.js kennt kein createSoundBank() — der Ton bleibt aus.';
    return null;
  }
  let neu;
  try {
    neu = mod.createSoundBank({ lautstaerke: s.lautstaerke, stumm: s.klaenge === false });
  } catch (err) {
    bankGrund = 'Die Tonbank ließ sich nicht öffnen: ' + (err && err.message);
    return null;
  }
  if (!neu || neu.verfuegbar === false) {
    bankGrund = 'Kein Ton in diesem Browser' + (neu && neu.grund ? ` (${neu.grund})` : '') + '.';
  } else {
    bankGrund = null;
  }
  bank = neu;
  return neu;
}

/**
 * Liefert die Tonbank und baut sie beim ersten Mal auf. Bewusst erst bei der
 * ersten Bedienung: Browser sperren den AudioContext, bis der Benutzer etwas
 * angefasst hat — und ein stiller, aber offener Kontext auf einem Bildschirm,
 * den man nur zum Nachschlagen aufruft, wäre reine Verschwendung.
 */
function bankHolen(s) {
  if (bank) return Promise.resolve(bank);
  if (!bankVersprechen) bankVersprechen = bankBauen(s).catch(() => null);
  return bankVersprechen;
}

function bankSchliessen() {
  if (atmoTimer) { clearTimeout(atmoTimer); atmoTimer = 0; }
  if (bank) {
    try { bank.destroy(); } catch (err) { console.warn('[einstellungen] Tonbank schließen:', err); }
  }
  bank = null;
  bankVersprechen = null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Bausteine
 * ════════════════════════════════════════════════════════════════════════ */

function zeileText(name, hilfe) {
  return el('div.tv-opt__text', null,
    el('div.tv-opt__name', null, name),
    hilfe ? el('div.tv-opt__hilfe', null, hilfe) : null);
}

/** Ein-/Ausschalter mit Erklärung. `beim(anAus)` wird bei jeder Änderung gerufen. */
function schalter(name, hilfe, an, beim, opts = {}) {
  const box = el('input', {
    type: 'checkbox', checked: !!an, disabled: !!opts.disabled,
    onchange: e => beim(e.target.checked)
  });
  const zeile = el('label.tv-opt', { class: opts.disabled ? 'tv-opt--aus' : null },
    zeileText(name, hilfe),
    el('span.tv-opt__steuer', null, box));
  zeile.tvSetzen = (wert) => { box.checked = !!wert; };
  zeile.tvSperren = (aus) => {
    box.disabled = !!aus;
    zeile.classList.toggle('tv-opt--aus', !!aus);
  };
  return zeile;
}

/** Auswahlliste mit Erklärung. `optionen`: [[wert, Beschriftung], …] */
function auswahl(name, hilfe, optionen, wert, beim) {
  const sel = el('select', { onchange: e => beim(e.target.value) },
    ...optionen.map(([v, t]) => el('option', { value: String(v), selected: String(v) === String(wert) }, t)));
  return el('div.tv-opt', null, zeileText(name, hilfe), el('span.tv-opt__steuer', null, sel));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Die Gruppen
 * ════════════════════════════════════════════════════════════════════════ */

function gruppeDarstellung(s) {
  return panel('Spieldarstellung',
    el('div.tv-spalte', null,
      auswahl('Ansichtsstufe',
        'Wie viel vom Spiel wollen Sie sehen?',
        Object.entries(MATCH_VIEW_NAMES), s.matchView,
        v => { s.matchView = v; }),
      auswahl('Tempo',
        'Der Grundtakt des Spieltags. Lässt sich im Spiel jederzeit umstellen.',
        TEMPO_STUFEN.map(([v, t]) => [v, t]), s.speed,
        v => { s.speed = Number(v); }),
      schalter('Animationen',
        'Aus: kein Spielfeld, nur der Ticker. Für schwache Rechner und für alle, ' +
        'die schon in den Neunzigern die Konferenz dem Bild vorgezogen haben. ' +
        'Am Ergebnis ändert das nichts — die Partie läuft identisch ab, sie wird nur nicht gezeichnet.',
        s.animationen !== false,
        an => {
          s.animationen = an;
          toast(an ? 'Das Stadion wird wieder gezeichnet.' : 'Ab jetzt nur noch Ticker.', 'info');
        })));
}

function gruppeEingreifen(s) {
  const zeilen = MINISPIELE.map(([key, name, hilfe]) => schalter(name, hilfe,
    s.minigames[key] !== false,
    an => { s.minigames[key] = an; },
    { disabled: s.interactive === false }));

  const haupt = schalter('Schlüsselszenen selbst spielen',
    'Elfmeter, Freistöße, Ecken, Abschlüsse und Kombinationen übernehmen Sie höchstpersönlich. ' +
    'Geschick hilft — die Fähigkeiten des Spielers bleiben trotzdem maßgeblich.',
    s.interactive !== false,
    an => {
      s.interactive = an;
      for (const z of zeilen) z.tvSperren(!an);
      toast(an ? 'Sie stehen selbst am Punkt.' : 'Die Simulation macht das schon.', 'info');
    });

  return panel('Eingreifen',
    el('div.tv-spalte', null,
      haupt,
      subpanel('Welche Szenen?',
        el('div.tv-spalte', null, ...zeilen))));
}

function gruppeTon(state, s) {
  const club = myClub(state);
  const statusEl = el('div.tv-tonstatus', null, 'Der Ton meldet sich, sobald Sie hier etwas anfassen.');

  const statusZeigen = (text, art) => {
    statusEl.textContent = text;
    statusEl.classList.toggle('tv-tonstatus--warn', art === 'warn');
  };

  const nachBank = (fn) => {
    bankHolen(s).then(b => {
      if (!b || b.verfuegbar === false) {
        statusZeigen(bankGrund || 'Kein Ton verfügbar.', 'warn');
        return;
      }
      try { fn(b); } catch (err) {
        statusZeigen('Der Ton hat sich verschluckt: ' + (err && err.message), 'warn');
      }
    });
  };

  const regler = slider('Gesamtlautstärke', Math.round(s.lautstaerke * 100), {
    min: 0, max: 100, step: 5, left: 'Aus', right: 'Volle Kurve',
    onInput: v => {
      s.lautstaerke = v / 100;
      nachBank(b => {
        b.setLautstaerke(s.lautstaerke);
        statusZeigen(v === 0
          ? 'Lautstärke null. Auch eine Entscheidung.'
          : `Lautstärke ${v} %.`);
      });
    }
  });

  const klaenge = schalter('Klänge',
    'Anpfiff, Schuss, Netzrascheln, Aluminium. Alles prozedural erzeugt — ' +
    'in diesem Spiel steckt keine einzige Audiodatei.',
    s.klaenge !== false,
    an => {
      s.klaenge = an;
      nachBank(b => {
        b.setStumm(!an);
        statusZeigen(an ? 'Ton an.' : 'Ton aus. Es bleibt beim Lesen.');
      });
    });

  const atmo = schalter('Stadionatmosphäre',
    `Das Grundrauschen der Ränge — es hängt an Zuschauerzahl, Auslastung, Fanstimmung ` +
    `und Spielstand. Ihr Stadion: ${nfmt(club.stadium.capacity)} Plätze, Stimmung ` +
    `${Math.round(club.fans.mood)} %.`,
    s.atmosphaere !== false,
    an => {
      s.atmosphaere = an;
      nachBank(b => {
        if (!an) { b.atmoStop(); statusZeigen('Die Ränge schweigen.'); return; }
        statusZeigen('Die Atmosphäre läuft beim nächsten Spiel mit.');
      });
    });

  const probeKnopf = button('Atmosphäre probehören', () => {
    nachBank(b => {
      if (s.atmosphaere === false) { statusZeigen('Erst die Atmosphäre einschalten.', 'warn'); return; }
      if (atmoTimer) clearTimeout(atmoTimer);
      b.atmoStart();
      b.atmo({
        zuschauer: Math.round(club.stadium.capacity * 0.86),
        kapazitaet: club.stadium.capacity,
        stimmung: club.fans.mood,
        heimFuehrung: 0, minute: 61, druck: 0.55, heimAngriff: true
      });
      statusZeigen('Sechs Sekunden Heimspiel, 86 % Auslastung, 61. Minute.');
      atmoTimer = setTimeout(() => { atmoTimer = 0; try { b.atmoStop(); } catch (err) { /* egal */ } }, 6000);
    });
  }, { size: 'klein', kind: 'blau' });

  const proben = el('div.tv-klangprobe', null,
    ...PROBEN.map(([name, label]) => button(label, () => {
      nachBank(b => {
        if (s.klaenge === false) { statusZeigen('Die Klänge sind abgeschaltet.', 'warn'); return; }
        b.play(name);
        statusZeigen(`Probe: ${label}.`);
      });
    }, { size: 'klein' })),
    button('Gong', () => {
      nachBank(b => {
        if (s.klaenge === false) { statusZeigen('Die Klänge sind abgeschaltet.', 'warn'); return; }
        b.gong('aufstellung');
        statusZeigen('Probe: Stadionsprecher-Gong.');
      });
    }, { size: 'klein' }));

  return panel('Ton',
    el('div.tv-spalte', null,
      regler,
      klaenge,
      atmo,
      subpanel('Hörprobe',
        el('div.tv-spalte', null,
          proben,
          el('div.tv-zeile', null, probeKnopf),
          statusEl,
          el('div.tv-mini', null,
            'Bleibt es still, liegt es fast immer am Browser: Ton wird erst nach der ersten ' +
            'Bedienung erlaubt. Ein Klick auf einen der Knöpfe oben ist genau diese Bedienung.')))));
}

function gruppeTextTempo(s) {
  return panel('Textgeschwindigkeit',
    el('div.tv-spalte', null,
      auswahl('Ticker-Tempo',
        'Wie lange der Live-Ticker eine Meldung stehen lässt, bevor die nächste kommt. ' +
        'Unabhängig vom Spieltempo: Das eine betrifft die Uhr, das andere Ihre Augen.',
        TEXT_TEMPI.map(([v, t]) => [v, t]), s.textTempo,
        v => { s.textTempo = v; }),
      el('div.tv-mini', null,
        ...TEXT_TEMPI.map(([, t, hilfe]) => el('div', null, el('b', null, t + ': '), hilfe)))));
}

function gruppeBequemlichkeit(s) {
  return panel('Handhabung',
    el('div.tv-spalte', null,
      schalter('Rückfragen bei folgenschweren Aktionen',
        'Aus: Verkäufe, Freistellungen und Vertrauensfragen laufen ohne Sicherheitsnetz durch. ' +
        'Nur das Löschen eines Spielstands fragt weiterhin nach — das ist keine Spielentscheidung, ' +
        'sondern eine Datei.',
        s.bestaetigungen !== false,
        an => {
          s.bestaetigungen = an;
          setBestaetigungen(an);
          toast(an ? 'Das Spiel fragt wieder nach.' : 'Ab jetzt ohne Rückfrage. Sie wissen, was Sie tun.',
            an ? 'info' : 'warn');
        }),
      schalter('Automatische Aufstellung',
        'Vor jedem eigenen Spiel stellt der Computer die beste verfügbare Elf auf — ' +
        'Verletzte und Gesperrte bleiben draußen, Fitness wird berücksichtigt. ' +
        'Sie können danach jederzeit selbst umstellen; nach Ihrem Eingriff rührt niemand mehr etwas an.',
        s.autoAufstellung === true,
        an => {
          s.autoAufstellung = an;
          toast(an ? 'Der Co-Trainer stellt auf.' : 'Die Elf ist wieder Ihre Sache.', 'info');
        }),
      el('div.tv-mini', null,
        'Beides wirkt sofort — auch auf das nächste Spiel, das schon auf dem Spieltagsbildschirm wartet.')));
}

function gruppeTastatur(ctx) {
  const liste = Array.isArray(ctx.tasten) ? ctx.tasten : [];
  const zeilen = liste.filter(t => t && t.taste).map(t => el('div.tv-tasten__zeile', null,
    el('span.tv-taste', null, String(t.taste).toUpperCase()),
    el('span', null, `${t.icon || ''} ${t.titel || t.id}`)));

  const fehlend = liste.filter(t => t && !t.taste).map(t => t.titel || t.id);

  const allgemein = [
    ['Leertaste', 'Weiter — schaltet Tage vor, bis etwas passiert'],
    ['Enter', 'dasselbe wie die Leertaste'],
    ['Strg + S', 'Spielstand speichern'],
    ['ESC', 'Dialog schließen · Schlüsselszene der Simulation überlassen']
  ];

  return panel('Tastatur',
    el('div.tv-spalte', null,
      el('div.tv-mini', null,
        'Die Bildschirme liegen in der Reihenfolge der Aktenleiste auf der Tastatur: ' +
        'erst die Zahlenreihe, dann die Buchstabenreihe darunter. Kein Bildschirm ohne Kürzel.'),
      zeilen.length
        ? el('div.tv-tasten', null, ...zeilen)
        : el('div.tv-leer', null, 'Der Rahmen hat keine Tastenbelegung gemeldet.'),
      fehlend.length
        ? el('div.tv-mini', { style: { color: 'var(--rot)' } },
          'Ohne Kürzel und nur mit der Maus erreichbar: ' + fehlend.join(', '))
        : null,
      el('div.tv-trenner'),
      el('div.tv-tasten', null, ...allgemein.map(([k, t]) => el('div.tv-tasten__zeile', null,
        el('span.tv-taste', null, k), el('span', null, t))))));
}


/**
 * Die Werkstatt. Der Editor greift unmittelbar und dauerhaft in den Spielstand –
 * deshalb steht er hier unten und nicht als Reiter in der Navigation, wo man ihn
 * im dritten Rückstand versehentlich anklickt. Die Tastenkombination
 * Strg + Umschalt + E führt zum selben Ziel.
 */
function gruppeWerkstatt(ctx) {
  return panel('Werkstatt',
    el('div.tv-einst__zeile', null,
      el('div.tv-einst__text', null,
        el('b', null, 'Editor öffnen'),
        el('div.tv-mini', null,
          'Vereinsnamen, Farben, Wappen, Stadien, Spielerdaten und Aussehen ändern. ',
          'Änderungen wirken sofort und dauerhaft in diesem Spielstand — es gibt kein Zurück ',
          'außer einem älteren Speicherstand. Stammdaten lassen sich als Datei aus- und ',
          'wieder einlesen, ohne den Spielstand mitzuschicken.')),
      button('Editor öffnen', () => ctx.navigate('editor'), { kind: 'ghost' })),
    el('div.tv-mini', { style: { marginTop: '6px', opacity: '.75' } },
      'Kurzweg: Strg + Umschalt + E'));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Der Bildschirm
 * ════════════════════════════════════════════════════════════════════════ */

export const screen = {
  id: 'einstellungen',
  title: 'Einstellungen',
  icon: '⚙️',

  render(root, ctx) {
    const state = ctx && ctx.state;
    if (!state || !state.clubs || !state.managerClubId || !state.clubs[state.managerClubId]) {
      root.appendChild(panel('Einstellungen',
        el('div.tv-leer', { style: { color: 'var(--rot)', fontStyle: 'normal' } },
          'Kein gültiger Spielstand geladen — ohne Verein gibt es nichts einzustellen.')));
      return;
    }

    const s = einstellungenAuffuellen(state);

    root.appendChild(el('div.tv-einstellungen', null,
      el('div.tv-spalte', null,
        gruppeDarstellung(s),
        gruppeTextTempo(s),
        gruppeBequemlichkeit(s)),
      el('div.tv-spalte', null,
        gruppeEingreifen(s),
        gruppeTon(state, s),
        gruppeTastatur(ctx),
        gruppeWerkstatt(ctx))));

    root.appendChild(el('div.tv-mini', { style: { marginTop: '8px', textAlign: 'center' } },
      'Alle Einstellungen wandern mit dem Spielstand — jede Karriere darf ihre eigenen Vorlieben haben.'));
  },

  /**
   * Beim Verlassen fliegt der AudioContext wieder raus. Ein offener Kontext pro
   * Besuch dieses Bildschirms wäre nach einer Saison eine ansehnliche Sammlung.
   */
  onLeave() {
    bankSchliessen();
  }
};

export default screen;
