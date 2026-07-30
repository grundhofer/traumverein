/**
 * screens/training.js — Der Trainingsplatz.
 * ============================================================================
 *
 * „Meisterschaften werden im Sommer gewonnen." Sagt der Co-Trainer jedenfalls
 * jedes Jahr aufs Neue, während er die Hütchen aufstellt.
 *
 * Dieser Bildschirm bündelt alles, was zwischen zwei Spieltagen passiert:
 * Wochenplan, Intensität, Belastung, Entwicklung, Sonderschichten,
 * Trainingslager und den wöchentlichen Bericht.
 *
 * ZUSTÄNDIGKEIT
 *   Der Screen RECHNET NICHT. Jede Zustandsänderung läuft über die
 *   Aktionsfunktionen aus club/training.js (wochenplanSetzen, schwerpunktSetzen,
 *   intensitaetSetzen, individualtraining, trainingslager). Gelesen wird über
 *   trainingsbericht(), talentEntwicklungsPrognose(), club/medical.js und
 *   club/staff.js. Alles Optionale steckt in try/catch — fehlt ein Modulteil,
 *   erscheint eine deutsche Meldung statt eines weißen Bildschirms.
 *
 * STYLING-HINWEIS (bewusste Abweichung, siehe Bericht)
 *   `bar()` und `slider()` aus render/ui.js kollidieren mit den gleichnamigen
 *   Klassen `.tv-bar` / `.tv-slider` aus styles/main.css (dort feste Höhe 11px
 *   bzw. Flex-Zeile). Da beide Stylesheets unlayered geladen werden und damit
 *   gegen die ui.js-Defaults gewinnen, benutzt dieser Screen für Balken und
 *   Regler die Projekt-Markup-Variante (`balken()` / `regler()` unten).
 *   Panels, Tabellen, Dialoge, Toasts, Pillen, Icons und Kennzahlen kommen
 *   unverändert aus render/ui.js.
 */

import {
  el, panel, button, table, dialog, toast, pill,
  statBox, progressRing, tooltip, clearNode
} from '../render/ui.js';

import {
  ATTRIBUTES, ATTRIBUTE_NAMES, ATTRIBUTE_GROUPS, KEEPER_ATTRIBUTES,
  POSITION_NAMES, POSITION_GROUP, DIFFICULTIES
} from '../core/constants.js';
import { clamp, round, formatMoney, formatDateShort, percent, ratingClass, sortBy } from '../core/util.js';
import { playerOverall } from '../engine/ratings.js';
import { portraitDataURL } from '../render/portraits.js';
import { SAISON_TAGE } from '../data/leagues.js';

import {
  EINHEITEN, EINHEIT_KATEGORIEN, WOCHENTAGE, SCHWERPUNKTE,
  TRAININGSLAGER_ORTE, LAGER_BUDGETS,
  standardplan, wochentagVon, istUrlaub, ausbildungsniveau,
  wochenplanSetzen, schwerpunktSetzen, intensitaetSetzen,
  individualtraining, trainingslager, trainingsbericht, talentEntwicklungsPrognose
} from '../club/training.js';

import { belastung, belastungssteuerung, verletzungsrisiko, dauerText } from '../club/medical.js';
import { stabVon, rolleVon, qualitaetVon, STAFF_ROLES } from '../club/staff.js';

/* Die fünf Minispiele für den Übungsplatz. Sie hängen nur an core/ und data/,
   nicht an der Match-Engine – ein statischer Import ist hier also unbedenklich.
   game/matchday.js wird dagegen erst beim Anpfiff nachgeladen (siehe uebungStarten). */
import { minigame as mgElfmeter } from '../interactive/penalty.js';
import { minigame as mgFreistoss } from '../interactive/freekick.js';
import { minigame as mgEcke } from '../interactive/corner.js';
import { minigame as mgAbschluss } from '../interactive/finish.js';
import { minigame as mgKombination } from '../interactive/combination.js';

/* ==========================================================================
 * 1. Kleinkram
 * ======================================================================== */

/** Kategorie → Farbvariante aus styles/screens.css. */
const KATEGORIE_KLASSE = {
  kondition: 'tv-einheit--kondition',
  technik: 'tv-einheit--technik',
  taktik: 'tv-einheit--taktik',
  spiel: 'tv-einheit--standards',
  spezial: 'tv-einheit--regeneration',
  erholung: 'tv-einheit--frei'
};

/**
 * Spiegel von LAGER_FENSTER aus club/training.js (dort nicht exportiert).
 * Wird NUR für den Hinweistext benutzt — die verbindliche Prüfung macht
 * trainingslager() selbst, die Knöpfe bleiben deshalb bedienbar.
 */
const LAGER_FENSTER = [
  { von: SAISON_TAGE.vorbereitungStart, bis: SAISON_TAGE.ligaStart - 1, name: 'Sommervorbereitung' },
  { von: SAISON_TAGE.trainingslagerWinter[0] - 7, bis: SAISON_TAGE.rueckrundeStart - 1, name: 'Wintervorbereitung' }
];

const PROGNOSE_JAHRE = 5;

function name(p) { return p ? (p.shortName || p.lastName || p.id) : '—'; }

function istLegende(p) { return !!p && p.era === 'legend'; }

/**
 * Goldschimmer für Legenden außerhalb von Tabellenzeilen.
 * (styles/main.css hat nur `tr.zeile--legende` — für Karten und Listen
 * braucht es deshalb die Inline-Variante desselben Verlaufs.)
 */
function legendeStil(p) {
  return istLegende(p)
    ? { background: 'linear-gradient(90deg, rgba(217,165,33,.26), transparent 62%)' }
    : null;
}

/** Panelkopf mit rechtsbündiger Zusatzinfo — funktioniert in beiden Panel-Varianten. */
function panelTitel(titel, extra) {
  return el('span', { style: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%' } },
    el('span', null, titel),
    extra ? el('span.tv-panel__extra', {
      style: {
        marginLeft: 'auto', fontWeight: '400', textTransform: 'none',
        letterSpacing: '.3px', fontSize: '11px', opacity: '.85'
      }
    }, extra) : null);
}

/** Balken im Projekt-Look (styles/main.css: .tv-bar / .tv-bar__fill / .tv-bar__label). */
function balken(wert, max = 100, opts = {}) {
  const v = clamp(Number(wert) || 0, 0, max);
  const pct = max > 0 ? (v / max) * 100 : 0;
  const klasse = opts.farbe ? null : (opts.klasse || ratingClass((v / (max || 1)) * 99));
  const kinder = [
    el('div.tv-bar__fill', {
      class: klasse,
      style: { width: pct.toFixed(1) + '%', background: opts.farbe || null }
    })
  ];
  if (opts.text !== false) {
    kinder.push(el('div.tv-bar__label', null, opts.text != null ? opts.text : String(Math.round(v))));
  }
  const wrap = el('div.tv-bar', { class: opts.gross ? 'tv-bar--gross' : null }, ...kinder);
  if (opts.tooltip) tooltip(wrap, opts.tooltip);
  return wrap;
}

/** Regler im Projekt-Look (styles/main.css: .tv-slider). */
function regler(label, wert, opts = {}) {
  const anzeige = el('span.tv-slider__wert', null, String(Math.round(wert)));
  const input = el('input', {
    type: 'range',
    min: String(opts.min != null ? opts.min : 0),
    max: String(opts.max != null ? opts.max : 100),
    step: String(opts.step || 1),
    value: String(Math.round(wert)),
    oninput: (e) => {
      anzeige.textContent = e.target.value;
      if (opts.onInput) opts.onInput(Number(e.target.value));
    },
    onchange: (e) => { if (opts.onChange) opts.onChange(Number(e.target.value)); }
  });
  const box = el('div', null,
    el('div.tv-slider', null, el('label', null, label), input, anzeige),
    opts.enden
      ? el('div.tv-slider__enden', null, el('span', null, opts.enden[0]), el('span', null, opts.enden[1]))
      : null);
  box.tvWert = () => Number(input.value);
  return box;
}

/** Spielerporträt als Bild — Gesichter sind Kernfeature, also überall zeigen. */
function portraitBild(p, groesse = 30) {
  try {
    const url = portraitDataURL(p, groesse * 2);
    return el('img.tv-portrait', {
      src: url, alt: '', width: groesse, height: groesse,
      style: { width: groesse + 'px', height: groesse + 'px', flex: '0 0 ' + groesse + 'px' }
    });
  } catch (e) {
    return el('span', { style: { fontSize: groesse * 0.7 + 'px' } }, '👤');
  }
}

function posPille(p) {
  const g = POSITION_GROUP[p.position] || 'MIT';
  const s = el('span.tv-pos', { class: 'tv-pos--' + g }, p.position);
  tooltip(s, POSITION_NAMES[p.position] || p.position);
  return s;
}

/** Name + Porträt + Legendenhervorhebung — die Standardzelle dieses Screens. */
function spielerZelle(p, opts = {}) {
  const zeile = el('div.tv-zeile', { style: { gap: '7px', minWidth: 0 } },
    opts.portrait === false ? null : portraitBild(p, opts.groesse || 26),
    el('div', { style: { minWidth: 0, lineHeight: '1.25' } },
      el('div', { style: { fontWeight: istLegende(p) ? '700' : '600' } },
        name(p),
        istLegende(p) ? ' ' : null,
        istLegende(p) ? pill(p.eraLabel || 'Legende', 'legende') : null),
      opts.unter ? el('div.tv-mini', null, opts.unter) : null));
  return zeile;
}

function zeilenKlasse(p) {
  const k = [];
  if (istLegende(p)) k.push('zeile--legende');
  if (p.injury) k.push('zeile--verletzt');
  else if (p.cards && p.cards.ban > 0) k.push('zeile--gesperrt');
  return k.join(' ');
}

function hinweis(text) { return el('div.tv-leer', null, text); }

/** Baut ein Panel und fängt alles ab, was schiefgehen kann. */
function sicher(titel, bauer) {
  try {
    return bauer();
  } catch (err) {
    console.error(`[training] Panel „${titel}" ist gescheitert:`, err);
    return panel(titel,
      el('div.tv-spalte', null,
        el('div.tv-warnung', null, 'Dieser Bereich ist gerade nicht ansprechbar.'),
        el('pre', {
          style: {
            whiteSpace: 'pre-wrap', fontSize: '11px', margin: 0,
            background: 'rgba(0,0,0,.12)', padding: '7px'
          }
        }, String((err && err.message) || err))));
  }
}

/** Kader des Vereins, robust gegen Lücken im State. */
function kaderVon(state, club) {
  return (club.playerIds || []).map(id => state.players[id]).filter(Boolean);
}

/** Wochenplan normalisieren: immer 0..6, immer Arrays, immer max. 2 Einheiten. */
function normPlan(roh) {
  const out = {};
  for (let d = 0; d < 7; d++) {
    const liste = (roh && (roh[d] || roh[String(d)])) || [];
    out[d] = (Array.isArray(liste) ? liste : []).filter(id => EINHEITEN[id]).slice(0, 2);
  }
  return out;
}

/** Kennzahlen eines Wochenplans — reine Anzeige, keine Spiellogik. */
function planStatistik(plan) {
  const s = { einheiten: 0, ermuedung: 0, risiko: 0, moral: 0, minuten: 0, freieTage: 0, kategorien: {} };
  for (let d = 0; d < 7; d++) {
    const liste = plan[d] || [];
    let arbeit = 0;
    for (const id of liste) {
      const e = EINHEITEN[id];
      if (!e) continue;
      s.einheiten++;
      s.ermuedung += Math.max(0, e.ermuedung);
      s.risiko += e.risiko;
      s.moral += e.moralEffekt;
      s.minuten += e.dauer;
      s.kategorien[e.kategorie] = (s.kategorien[e.kategorie] || 0) + 1;
      if (e.id !== 'frei') arbeit++;
    }
    if (!arbeit) s.freieTage++;
  }
  return s;
}

/* ==========================================================================
 * 2. Kennzahlenleiste
 * ======================================================================== */

function kennzahlen(state, club, bericht, lagerAktiv) {
  const b = bericht || {};
  const frische = b.frische != null ? b.frische : 100;
  const niveau = b.niveau != null ? b.niveau : 50;

  const kachel = (label, wert, opts) => statBox(label, wert, opts);

  return el('div.tv-grid.tv-grid--4', null,
    kachel('Frische', Math.round(frische), {
      sub: 'Ø Fitness der Mannschaft',
      kind: frische >= 88 ? 'gut' : frische >= 76 ? null : frische >= 66 ? 'warn' : 'schlecht',
      tooltip: 'Unter 78 wird es zäh: müde Beine lernen nichts und verletzen sich schneller.'
    }),
    kachel('Form', Math.round(b.form != null ? b.form : 50), {
      sub: 'Tagesform im Schnitt',
      kind: (b.form || 50) >= 60 ? 'gut' : (b.form || 50) < 42 ? 'schlecht' : null
    }),
    kachel('Spielrhythmus', Math.round(b.sharpness != null ? b.sharpness : 60), {
      sub: 'Wettkampfhärte',
      kind: (b.sharpness || 60) >= 70 ? 'gut' : (b.sharpness || 60) < 45 ? 'warn' : null,
      tooltip: 'Wer nur trainiert, bleibt stumpf. Rhythmus gibt es nur im Spiel.'
    }),
    kachel('Ausbildungsniveau', Math.round(niveau) + ' / 100', {
      sub: niveau >= 78 ? 'Spitzenklasse' : niveau >= 60 ? 'ordentlich' : niveau >= 45 ? 'Mittelmaß' : 'ausbaufähig',
      kind: niveau >= 72 ? 'gut' : niveau < 45 ? 'schlecht' : null,
      tooltip: 'Co-Trainer, Athletikabteilung, Trainingsanlagen und Ihr eigenes Können.'
    }),
    kachel('Intensität', Math.round(b.intensitaet != null ? b.intensitaet : 55), {
      sub: 'Belastungsregler',
      kind: (b.intensitaet || 0) >= 85 ? 'warn' : null
    }),
    kachel('Schwerpunkt', SCHWERPUNKTE[b.schwerpunkt] ? SCHWERPUNKTE[b.schwerpunkt].name : '—', {
      sub: 'aus dem Wochenplan abgeleitet'
    }),
    kachel('Im Lazarett', b.verletzte != null ? b.verletzte : 0, {
      sub: b.verletzte ? 'Spieler in Behandlung' : 'alle einsatzbereit',
      kind: b.verletzte >= 4 ? 'schlecht' : b.verletzte >= 2 ? 'warn' : 'gut'
    }),
    kachel('Trainingslager', lagerAktiv ? lagerAktiv.name : 'keines gebucht', {
      sub: lagerAktiv ? `noch ${lagerAktiv.restTage} Tage · ${formatMoney(lagerAktiv.kosten || 0)}` : 'nur in der Vorbereitung',
      kind: lagerAktiv ? 'gold' : null
    }));
}

/* ==========================================================================
 * 3. Wochenplan
 * ======================================================================== */

function einheitChip(e, opts = {}) {
  const chip = el('div.tv-einheit', {
    class: KATEGORIE_KLASSE[e.kategorie] || null,
    draggable: opts.draggable ? 'true' : null,
    style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  }, (e.nurTorwart ? '🧤 ' : '') + e.name);

  tooltip(chip,
    `${e.name} · ${EINHEIT_KATEGORIEN[e.kategorie] || e.kategorie}\n${e.desc}\n` +
    `Dauer ${e.dauer} min · Belastung ${e.ermuedung >= 0 ? '+' + e.ermuedung : e.ermuedung} · ` +
    `Risiko ${e.risiko} · Laune ${e.moralEffekt > 0 ? '+' : ''}${e.moralEffekt}`);

  if (opts.onClick) chip.addEventListener('click', opts.onClick);
  if (opts.draggable) {
    chip.style.cursor = 'grab';
    chip.addEventListener('dragstart', (ev) => {
      try { ev.dataTransfer.setData('text/plain', e.id); ev.dataTransfer.effectAllowed = 'copy'; } catch (x) { /* egal */ }
      if (opts.onDragStart) opts.onDragStart(e.id);
    });
  }
  return chip;
}

function wochenplanPanel(ctx, state, club) {
  const clubId = club.id;
  let plan = normPlan(club.training && club.training.wochenplan
    ? club.training.wochenplan
    : standardplan((club.training && club.training.schwerpunkt) || 'ausgeglichen'));

  let gewaehlt = null;              // aus der Palette gewählte Einheit
  let letzteWarnungen = [];

  const tageBox = el('div.tv-wochenplan');
  const statusBox = el('div.tv-spalte', { style: { gap: '4px' } });
  const paletteBox = el('div.tv-spalte', { style: { gap: '6px' } });

  /* --- Spieltage der laufenden Woche ermitteln --------------------------- */
  const heute = state.date.day;
  const montag = heute - wochentagVon(heute);
  const spieltage = {};
  try {
    for (const f of state.fixtures || []) {
      if (f.season !== state.date.season) continue;
      if (f.homeId !== clubId && f.awayId !== clubId) continue;
      const d = f.dayIndex - montag;
      if (d < 0 || d > 6) continue;
      const gegnerId = f.homeId === clubId ? f.awayId : f.homeId;
      const gegner = state.clubs[gegnerId];
      spieltage[d] = {
        heim: f.homeId === clubId,
        gegner: gegner ? (gegner.abbr || gegner.shortName) : '???'
      };
    }
  } catch (e) { /* ohne Spielplan eben ohne Spieltagsmarkierung */ }

  /* --- Speichern über die Modul-Aktion ---------------------------------- */
  function speichern() {
    let res;
    try {
      res = wochenplanSetzen(state, clubId, plan);
    } catch (err) {
      toast('Der Wochenplan ließ sich nicht übernehmen: ' + ((err && err.message) || err), 'schlecht');
      return;
    }
    if (!res || !res.ok) {
      toast((res && res.text) || 'Der Wochenplan wurde abgelehnt.', 'schlecht');
      return;
    }
    plan = normPlan(res.plan);
    letzteWarnungen = res.warnungen || [];
    ctx.aktualisiere();
    zeichne();
  }

  function setzeEinheit(tag, id) {
    const e = EINHEITEN[id];
    if (!e) return;
    const liste = plan[tag] || (plan[tag] = []);
    if (liste.length >= 2) {
      toast(`${WOCHENTAGE[tag]} ist voll — zwei Einheiten am Tag sind das Maximum.`, 'warn');
      return;
    }
    liste.push(id);
    speichern();
  }

  function entferneEinheit(tag, index) {
    const liste = plan[tag] || [];
    liste.splice(index, 1);
    speichern();
  }

  /* --- Zeichnen ---------------------------------------------------------- */
  function zeichne() {
    clearNode(tageBox);
    for (let d = 0; d < 7; d++) {
      const spiel = spieltage[d];
      const tagId = montag + d;
      const urlaub = istUrlaub(tagId);
      const karte = el('div.tv-wochenplan__tag', { class: spiel ? 'spieltag' : null });

      karte.appendChild(el('b', null,
        WOCHENTAGE[d].slice(0, 2),
        el('span', { style: { float: 'right', opacity: '.7', fontWeight: '400' } },
          formatDateShort(tagId, state.date.season).slice(0, 6))));

      if (spiel) {
        karte.appendChild(el('div.tv-mini', { style: { color: 'var(--rot)', fontWeight: '700' } },
          `⚽ ${spiel.heim ? 'H' : 'A'} ${spiel.gegner}`));
        karte.appendChild(el('div.tv-mini', null, 'Gespielt wird, nicht trainiert.'));
      } else if (urlaub) {
        karte.appendChild(el('div.tv-mini', { style: { fontStyle: 'italic' } }, 'Urlaub'));
      }

      const liste = plan[d] || [];
      liste.forEach((id, i) => {
        const e = EINHEITEN[id];
        if (!e) return;
        const chip = einheitChip(e, { onClick: () => entferneEinheit(d, i) });
        if (spiel) chip.style.opacity = '.45';
        karte.appendChild(chip);
      });

      for (let leer = liste.length; leer < 2; leer++) {
        const platz = el('div.tv-einheit.tv-einheit--frei', {
          style: {
            opacity: '.4', textAlign: 'center', border: '1px dashed rgba(0,0,0,.35)',
            background: 'transparent', color: 'var(--tinte-weich)'
          },
          onclick: () => {
            if (!gewaehlt) { toast('Erst links eine Einheit auswählen, dann auf den Tag klicken.', 'info'); return; }
            setzeEinheit(d, gewaehlt);
          }
        }, '+');
        karte.appendChild(platz);
      }

      karte.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        karte.style.boxShadow = 'inset 0 0 0 2px var(--gold)';
      });
      karte.addEventListener('dragleave', () => { karte.style.boxShadow = ''; });
      karte.addEventListener('drop', (ev) => {
        ev.preventDefault();
        karte.style.boxShadow = '';
        let id = '';
        try { id = ev.dataTransfer.getData('text/plain'); } catch (x) { id = gewaehlt || ''; }
        if (id) setzeEinheit(d, id);
      });

      tageBox.appendChild(karte);
    }

    /* Statuszeile + Warnungen */
    clearNode(statusBox);
    const s = planStatistik(plan);
    const kategorieText = Object.keys(s.kategorien)
      .map(k => `${EINHEIT_KATEGORIEN[k] || k} ${s.kategorien[k]}`).join(' · ') || 'nichts';
    statusBox.appendChild(el('div.tv-zeile', { style: { flexWrap: 'wrap', gap: '6px' } },
      pill(`${s.einheiten} Einheiten`, 'info'),
      pill(`${Math.round(s.minuten / 60 * 10) / 10} Std. auf dem Platz`, 'neutral'),
      pill(`Belastung ${s.ermuedung}`, s.ermuedung >= 42 ? 'schlecht' : s.ermuedung >= 30 ? 'warn' : 'gut'),
      pill(`Risiko ${round(s.risiko, 1)}`, s.risiko >= 9 ? 'schlecht' : s.risiko >= 6 ? 'warn' : 'gut'),
      pill(`Laune ${s.moral > 0 ? '+' : ''}${round(s.moral, 1)}`, s.moral >= 0.5 ? 'gut' : s.moral <= -0.5 ? 'schlecht' : 'neutral'),
      pill(`${s.freieTage} freie Tage`, s.freieTage === 0 ? 'schlecht' : 'neutral')));
    statusBox.appendChild(el('div.tv-mini', null, 'Verteilung: ' + kategorieText));
    for (const w of letzteWarnungen) {
      statusBox.appendChild(el('div.tv-warnung', { style: { fontSize: '11.5px' } }, '⚠ ' + w));
    }
  }

  /* --- Palette ----------------------------------------------------------- */
  function zeichnePalette() {
    clearNode(paletteBox);
    const gruppen = {};
    for (const id in EINHEITEN) {
      const e = EINHEITEN[id];
      (gruppen[e.kategorie] || (gruppen[e.kategorie] = [])).push(e);
    }
    for (const kat in EINHEIT_KATEGORIEN) {
      const liste = gruppen[kat];
      if (!liste || !liste.length) continue;
      const chips = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } });
      for (const e of liste) {
        const chip = einheitChip(e, {
          draggable: true,
          onDragStart: (id) => { gewaehlt = id; markiere(); },
          onClick: () => { gewaehlt = gewaehlt === e.id ? null : e.id; markiere(); }
        });
        chip.dataset.einheit = e.id;
        chips.appendChild(chip);
      }
      paletteBox.appendChild(el('div', null,
        el('div.tv-subpanel__titel', { style: { marginBottom: '4px' } }, EINHEIT_KATEGORIEN[kat]),
        chips));
    }
    markiere();
  }

  function markiere() {
    paletteBox.querySelectorAll('.tv-einheit').forEach(c => {
      const an = c.dataset.einheit === gewaehlt;
      c.style.outline = an ? '2px solid var(--gold)' : '';
      c.style.transform = an ? 'translateY(-1px)' : '';
    });
  }

  /* --- Standardpläne ------------------------------------------------------ */
  const vorlagen = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px' } });
  for (const id in SCHWERPUNKTE) {
    const s = SCHWERPUNKTE[id];
    vorlagen.appendChild(button(s.name, () => {
      let res;
      try {
        res = schwerpunktSetzen(state, clubId, id);
      } catch (err) {
        toast('Vorlage nicht verfügbar: ' + ((err && err.message) || err), 'schlecht');
        return;
      }
      if (!res || !res.ok) { toast((res && res.text) || 'Vorlage abgelehnt.', 'schlecht'); return; }
      plan = normPlan(club.training.wochenplan);
      letzteWarnungen = [];
      toast(res.text, 'gut');
      ctx.aktualisiere();
      zeichne();
    }, { size: 'klein', tooltip: s.desc }));
  }
  vorlagen.appendChild(button('Alles leeren', () => {
    for (let d = 0; d < 7; d++) plan[d] = [];
    speichern();
  }, { size: 'klein', kind: 'ghost', tooltip: 'Sieben Tage Nichtstun. Die Spieler werden Sie lieben, die Fans nicht.' }));

  zeichne();
  zeichnePalette();

  return panel(
    panelTitel('Wochenplan',
      `Woche ab ${formatDateShort(montag, state.date.season)} · max. 2 Einheiten pro Tag`),
    el('div.tv-spalte', null,
      el('div.tv-subpanel', null,
        el('div.tv-subpanel__titel', null, 'Standardpläne'),
        vorlagen),
      tageBox,
      statusBox,
      el('div.tv-subpanel', null,
        el('div.tv-subpanel__titel', null,
          'Einheiten — anklicken und auf einen Tag setzen oder direkt hineinziehen'),
        paletteBox),
      el('div.tv-mini', null,
        'Eine Einheit im Plan anklicken entfernt sie wieder. An Spieltagen fällt das Training aus — ',
        'die Mannschaft läuft dann nur aus.')));
}

/* ==========================================================================
 * 4. Intensität
 * ======================================================================== */

function intensitaetPanel(ctx, state, club) {
  const aktuell = clamp(Math.round((club.training && club.training.intensitaet) || 55), 0, 100);
  const anzeige = el('div.tv-spalte', { style: { gap: '4px' } });

  /* Richtwerte — reine Anzeige, die verbindliche Rechnung steht in club/training.js. */
  function beschreibe(i) {
    clearNode(anzeige);
    const fortschritt = clamp(0.55 + i / 90, 0.55, 1.35);
    const risiko = 0.5 + i / 55;
    const laune = 0.7 + (100 - i) / 200;

    anzeige.appendChild(el('div.tv-zeile', { style: { gap: '10px', alignItems: 'stretch' } },
      el('div', { style: { flex: '1' } },
        el('div.tv-mini', null, 'Entwicklung'),
        balken(fortschritt * 74, 100, { text: '×' + fortschritt.toFixed(2), klasse: 'rat-elite' })),
      el('div', { style: { flex: '1' } },
        el('div.tv-mini', null, 'Verletzungsrisiko'),
        balken(risiko * 45, 100, { text: '×' + risiko.toFixed(2), klasse: risiko >= 1.4 ? 'rat-mies' : risiko >= 1.05 ? 'rat-ok' : 'rat-stark' })),
      el('div', { style: { flex: '1' } },
        el('div.tv-mini', null, 'Stimmung'),
        balken(laune * 70, 100, { text: '×' + laune.toFixed(2), klasse: laune >= 1.05 ? 'rat-stark' : 'rat-ok' }))));

    anzeige.appendChild(el('div.tv-mini', null,
      i >= 85 ? 'Volle Pulle. Die Physios sollten Überstunden anmelden.'
        : i >= 60 ? 'Zügig. So entsteht Entwicklung, solange die Frische stimmt.'
          : i >= 35 ? 'Gemäßigt. Die Beine bleiben frisch, die Fortschritte klein.'
            : 'Schongang. Entwicklung findet dann woanders statt.'));
  }

  const schieber = regler('Intensität', aktuell, {
    enden: ['Schongang', 'Vollgas'],
    onInput: (v) => beschreibe(v),
    onChange: (v) => {
      let res;
      try {
        res = intensitaetSetzen(state, club.id, v);
      } catch (err) {
        toast('Intensität nicht änderbar: ' + ((err && err.message) || err), 'schlecht');
        return;
      }
      if (!res || !res.ok) { toast((res && res.text) || 'Abgelehnt.', 'schlecht'); return; }
      toast(res.text, v >= 90 ? 'warn' : 'gut');
      ctx.aktualisiere();
    }
  });
  beschreibe(aktuell);

  const schnell = el('div.tv-zeile', { style: { flexWrap: 'wrap', gap: '5px' } });
  for (const [label, wert] of [['Erholung 25', 25], ['Normal 55', 55], ['Ambitioniert 75', 75], ['Knüppelhart 92', 92]]) {
    schnell.appendChild(button(label, () => {
      try {
        const res = intensitaetSetzen(state, club.id, wert);
        toast((res && res.text) || 'Intensität gesetzt.', 'gut');
      } catch (err) {
        toast('Intensität nicht änderbar: ' + ((err && err.message) || err), 'schlecht');
        return;
      }
      ctx.aktualisiere();
      ctx.refresh();
    }, { size: 'klein', kind: 'ghost' }));
  }

  return panel(
    panelTitel('Intensität', 'Zielkonflikt: Fortschritt gegen Frische'),
    el('div.tv-spalte', null,
      schieber,
      anzeige,
      schnell,
      el('div.tv-mini', { style: { lineHeight: '1.5' } },
        'Je härter Sie ziehen, desto schneller entwickeln sich die Spieler — und desto schneller ',
        'liegen sie auf der Massagebank. Hohe Intensität bei niedriger Frische ist der zuverlässigste ',
        'Weg ins Lazarett. Bei englischen Wochen lohnt sich der Griff nach unten.')));
}

/* ==========================================================================
 * 5. Belastung
 * ======================================================================== */

function belastungPanel(ctx, state, club) {
  const kader = kaderVon(state, club);
  if (!kader.length) return panel('Belastung', hinweis('Dieser Verein hat keinen Kader. Das erklärt einiges.'));

  const zeilen = kader.map(p => {
    let bel = { spiele: 0, minuten: 0, fenster: 15 };
    let risiko = 0;
    try { bel = belastung(state, p.id) || bel; } catch (e) { /* ohne Akte eben ohne Zahlen */ }
    try { risiko = verletzungsrisiko(state, p.id, { art: 'spiel' }) || 0; } catch (e) { risiko = 0; }
    return {
      id: p.id, p,
      fitness: Math.round(p.fitness != null ? p.fitness : 100),
      sharp: Math.round(p.sharpness != null ? p.sharpness : 60),
      form: Math.round(p.form != null ? p.form : 50),
      spiele: bel.spiele, minuten: bel.minuten,
      risiko, risikoIndex: clamp(Math.round((risiko / 0.0052) * 38), 0, 100)
    };
  });

  let warnungen = [];
  try {
    const w = belastungssteuerung(state, club.id);
    warnungen = (w && w.warnungen) || [];
  } catch (e) { warnungen = []; }

  const warnBox = el('div.tv-spalte', { style: { gap: '3px' } });
  if (warnungen.length) {
    for (const w of warnungen.slice(0, 8)) {
      warnBox.appendChild(el('div.tv-lazarett__zeile', {
        style: { gridTemplateColumns: '1fr 90px 70px', cursor: 'default' }
      },
      el('span', null, w.text),
      pill(w.stufe === 2 ? 'Akut' : 'Beobachten', w.stufe === 2 ? 'schlecht' : 'warn'),
      el('span.tv-num', { class: 'tv-rechts' }, `${w.spiele} Spiele`)));
    }
  } else {
    warnBox.appendChild(el('div.tv-mini', { style: { padding: '4px' } },
      '✔ Die Belastungssteuerung meldet: alles im grünen Bereich. Genießen Sie es, es hält nie lange.'));
  }

  const tab = table([
    {
      key: 'name', label: 'Spieler', width: 210,
      sort: (a, b) => name(a.p).localeCompare(name(b.p), 'de'),
      render: (r) => spielerZelle(r.p, {
        unter: r.p.injury
          ? `${r.p.injury.name || 'verletzt'} — noch ${dauerTextSicher(r.p.injury)}`
          : `${r.p.age} Jahre`
      })
    },
    { key: 'pos', label: 'Pos', width: 46, align: 'center', sort: (a, b) => a.p.position.localeCompare(b.p.position), render: (r) => posPille(r.p) },
    {
      key: 'fitness', label: 'Fitness', width: 96, numeric: true,
      render: (r) => balken(r.fitness, 100, { text: r.fitness + ' %' })
    },
    {
      key: 'sharp', label: 'Rhythmus', width: 96, numeric: true,
      render: (r) => balken(r.sharp, 100, { text: String(r.sharp) })
    },
    {
      key: 'form', label: 'Form', width: 96, numeric: true,
      render: (r) => balken(r.form, 99, { text: String(r.form) })
    },
    { key: 'spiele', label: 'Spiele 15 T.', width: 78, numeric: true },
    { key: 'minuten', label: 'Minuten', width: 74, numeric: true },
    {
      key: 'risikoIndex', label: 'Verletzungsrisiko', width: 120, numeric: true,
      render: (r) => balken(r.risikoIndex, 100, {
        text: percent(r.risiko * 100, 1),
        klasse: r.risikoIndex >= 70 ? 'rat-mies' : r.risikoIndex >= 48 ? 'rat-schwach' : r.risikoIndex >= 32 ? 'rat-ok' : 'rat-stark',
        tooltip: 'Wahrscheinlichkeit, sich in einem vollen Spiel zu verletzen.'
      })
    },
    {
      key: 'status', label: 'Status', width: 92,
      render: (r) => r.p.injury
        ? pill('Lazarett', 'schlecht')
        : (r.p.cards && r.p.cards.ban > 0) ? pill('gesperrt', 'warn')
          : r.fitness < 60 ? pill('ausgelaugt', 'warn') : pill('einsatzbereit', 'gut')
    }
  ], zeilen, {
    compact: true,
    maxHeight: 430,
    sort: { key: 'risikoIndex', desc: true },
    rowClass: (r) => zeilenKlasse(r.p),
    emptyText: 'Kein Spieler im Kader.',
    onRowClick: (r) => ctx.navigate('kader', { playerId: r.id })
  });

  return panel(
    panelTitel('Belastung',
      `${warnungen.length} Warnung${warnungen.length === 1 ? '' : 'en'} des Physios`),
    el('div.tv-spalte', null,
      el('div.tv-subpanel', null,
        el('div.tv-subpanel__titel', null, 'Der Physio bittet um ein Wort'),
        warnBox),
      tab));
}

function dauerTextSicher(injury) {
  const tage = injury.restTage != null ? injury.restTage : (injury.daysLeft != null ? injury.daysLeft : injury.tage || 0);
  try { return dauerText(tage); } catch (e) { return `${tage} Tage`; }
}

/* ==========================================================================
 * 6. Entwicklung
 * ======================================================================== */

/** Kleines Balkendiagramm der Prognose — ohne Canvas, ohne Abhängigkeiten. */
function prognoseKurve(prog) {
  const jahre = (prog && prog.jahre) || [];
  if (!jahre.length) return hinweis('Keine Prognose möglich.');
  const werte = jahre.map(j => j.ovr);
  const max = Math.max(...werte, prog.potenzial || 0) + 3;
  const min = Math.max(1, Math.min(...werte) - 5);
  const spanne = Math.max(1, max - min);

  const saeulen = jahre.map((j) => {
    const h = clamp(((j.ovr - min) / spanne) * 100, 4, 100);
    const farbe = j.prognose ? 'linear-gradient(180deg, var(--blau-hell), var(--blau))'
      : 'linear-gradient(180deg, var(--gold-hell), var(--gold))';
    const saeule = el('div', {
      style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', flex: '1', minWidth: 0 }
    },
    el('div.tv-num', { style: { fontSize: '11px', fontWeight: '700' } }, String(j.ovr)),
    el('div', { style: { width: '100%', height: '84px', display: 'flex', alignItems: 'flex-end' } },
      el('div', {
        style: {
          width: '100%', height: h.toFixed(1) + '%', background: farbe,
          border: '1px solid rgba(0,0,0,.4)', borderRadius: '2px 2px 0 0'
        }
      })),
    el('div.tv-mini', { style: { fontSize: '9.5px' } }, `${j.alter} J.`));
    tooltip(saeule, j.prognose
      ? `Saison ${j.saison}, Alter ${j.alter}: erwartet ${j.ovr} (${j.min}–${j.max})`
      : `Saison ${j.saison}, Alter ${j.alter}: heute ${j.ovr}`);
    return saeule;
  });

  return el('div.tv-spalte', { style: { gap: '5px' } },
    el('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '4px' } }, ...saeulen),
    el('div.tv-mini', null, prog.text || ''),
    el('div.tv-zeile', { style: { gap: '6px', flexWrap: 'wrap' } },
      pill(`Potenzial ${prog.potenzial}`, 'gold'),
      pill(`Ausschöpfung ${prog.potenzialAusschoepfung} %`,
        prog.potenzialAusschoepfung >= 92 ? 'gut' : prog.potenzialAusschoepfung >= 80 ? 'warn' : 'schlecht')));
}

function zeigePrognose(state, p) {
  let prog = null;
  try {
    prog = talentEntwicklungsPrognose(state, p.id, PROGNOSE_JAHRE);
  } catch (err) {
    prog = null;
  }
  const inhalt = (prog && prog.ok)
    ? el('div.tv-spalte', null,
      el('div.tv-zeile', null, portraitBild(p, 56),
        el('div', null,
          el('div.tv-spielerkarte__name', null, `${p.firstName || ''} ${p.lastName || ''}`.trim() || name(p)),
          el('div.tv-spielerkarte__meta', null,
            `${POSITION_NAMES[p.position] || p.position} · ${p.age} Jahre · Stärke ${playerOverall(p)}`),
          istLegende(p) ? pill(p.eraLabel || 'Legende', 'legende') : null)),
      prognoseKurve(prog))
    : hinweis('Für diesen Spieler lässt sich derzeit keine Prognose erstellen.');

  return dialog(`Entwicklungsprognose — ${name(p)}`, inhalt,
    [{ label: 'Schließen', value: null, kind: 'ghost' }], { size: 'lg' });
}

function entwicklungPanel(ctx, state, club) {
  const kader = kaderVon(state, club);
  if (!kader.length) return panel('Entwicklung', hinweis('Ohne Spieler entwickelt sich hier gar nichts.'));

  const bewertung = (club.training && club.training.letzteBewertung) || null;
  const wocheAuf = new Map();
  const wocheAb = new Map();
  if (bewertung) {
    for (const a of bewertung.aufsteiger || []) wocheAuf.set(a.playerId, a.attribute || []);
    for (const a of bewertung.absteiger || []) wocheAb.set(a.playerId, a.attribute || []);
  }

  const zeilen = kader.map(p => {
    const gains = (p.training && p.training.gains) || {};
    let summe = 0;
    const einzeln = [];
    for (const k in gains) {
      if (!gains[k]) continue;
      summe += gains[k];
      einzeln.push({ attribut: k, delta: gains[k] });
    }
    const ovr = playerOverall(p);
    const pot = p.potential || ovr;
    return {
      id: p.id, p, ovr, pot,
      summe,
      einzeln: sortBy(einzeln, e => ({ key: Math.abs(e.delta), desc: true })),
      ausschoepfung: pot > 0 ? Math.round((ovr / pot) * 100) : 100,
      luft: Math.max(0, pot - ovr),
      woche: (wocheAuf.get(p.id) || []).concat(wocheAb.get(p.id) || [])
    };
  });

  const talente = sortBy(
    zeilen.filter(r => r.p.age <= 23 && r.luft >= 4),
    r => ({ key: r.luft + (24 - r.p.age), desc: true })
  ).slice(0, 3);

  const tab = table([
    {
      key: 'name', label: 'Spieler', width: 210,
      sort: (a, b) => name(a.p).localeCompare(name(b.p), 'de'),
      render: (r) => spielerZelle(r.p, { unter: `${r.p.age} Jahre · ${POSITION_NAMES[r.p.position] || r.p.position}` })
    },
    { key: 'pos', label: 'Pos', width: 46, align: 'center', sort: (a, b) => a.p.position.localeCompare(b.p.position), render: (r) => posPille(r.p) },
    { key: 'ovr', label: 'Stärke', width: 58, numeric: true, render: (r) => el('span.tv-wert', { class: ratingClass(r.ovr) + '-text' }, String(r.ovr)) },
    { key: 'pot', label: 'Potenzial', width: 64, numeric: true, render: (r) => el('span.tv-wert', null, String(r.pot)) },
    {
      key: 'ausschoepfung', label: 'Ausschöpfung', width: 116, numeric: true,
      render: (r) => balken(r.ausschoepfung, 100, {
        text: r.ausschoepfung + ' %',
        tooltip: r.luft > 0 ? `Noch ${r.luft} Punkte Luft nach oben.` : 'Ausentwickelt — mehr kommt da nicht.'
      })
    },
    {
      key: 'summe', label: 'Saison', width: 82, numeric: true,
      render: (r) => {
        if (!r.summe) return el('span.tv-mini', null, '—');
        const s = el('span.tv-entwicklung', {
          class: r.summe > 0 ? 'plus' : 'minus'
        }, `${r.summe > 0 ? '+' : ''}${r.summe}`);
        tooltip(s, r.einzeln.slice(0, 8)
          .map(e => `${ATTRIBUTE_NAMES[e.attribut] || e.attribut} ${e.delta > 0 ? '+' : ''}${e.delta}`)
          .join('\n'));
        return s;
      }
    },
    {
      key: 'woche', label: 'Letzte Woche', width: 210, sortable: false,
      render: (r) => r.woche.length
        ? el('span.tv-mini', null, r.woche.join(', '))
        : el('span.tv-mini', { class: 'tv-gedaempft' }, 'keine Veränderung')
    },
    {
      key: 'prognose', label: '', width: 92, sortable: false, align: 'center',
      render: (r) => button('Prognose', (ev) => {
        ev.stopPropagation();
        zeigePrognose(state, r.p);
      }, { size: 'klein', kind: 'ghost' })
    }
  ], zeilen, {
    compact: true,
    maxHeight: 440,
    sort: { key: 'summe', desc: true },
    rowClass: (r) => zeilenKlasse(r.p),
    emptyText: 'Keine Spieler vorhanden.',
    onRowClick: (r) => ctx.navigate('kader', { playerId: r.id })
  });

  const talentBox = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '8px' } });
  if (talente.length) {
    for (const r of talente) {
      let prog = null;
      try { prog = talentEntwicklungsPrognose(state, r.p.id, PROGNOSE_JAHRE); } catch (e) { prog = null; }
      talentBox.appendChild(el('div.tv-subpanel', { style: legendeStil(r.p) },
        el('div.tv-zeile', { style: { marginBottom: '5px' } },
          portraitBild(r.p, 34),
          el('div', null,
            el('div', { style: { fontWeight: '700', fontSize: '12.5px' } }, name(r.p)),
            el('div.tv-mini', null, `${r.p.age} Jahre · ${r.ovr} → Potenzial ${r.pot}`))),
        (prog && prog.ok) ? prognoseKurve(prog) : el('div.tv-mini', null, 'Prognose derzeit nicht möglich.')));
    }
  } else {
    talentBox.appendChild(hinweis(
      'Kein Spieler unter 24 mit nennenswerter Luft nach oben. Ein Blick in die Jugendabteilung könnte helfen.'));
  }

  return panel(
    panelTitel('Entwicklung',
      bewertung ? `Letzte Auswertung: Saison ${bewertung.saison}, Tag ${bewertung.tag}` : 'noch keine Wochenauswertung'),
    el('div.tv-spalte', null,
      tab,
      el('div.tv-subpanel', null,
        el('div.tv-subpanel__titel', null, 'Prognose für die Talente (5 Jahre, ohne Zufall hochgerechnet)'),
        talentBox)));
}

/* ==========================================================================
 * 7. Individualtraining
 * ======================================================================== */

function attributAuswahl(p) {
  const sel = el('select', {
    style: { padding: '4px 6px', width: '100%', border: '1px solid var(--linie)', background: 'var(--papier)' }
  });
  const istTW = p.position === 'TW';
  for (const gruppe in ATTRIBUTE_GROUPS) {
    const liste = ATTRIBUTE_GROUPS[gruppe].filter(a => ATTRIBUTES.includes(a));
    const erlaubt = liste.filter(a => istTW || !KEEPER_ATTRIBUTES.includes(a));
    if (!erlaubt.length) continue;
    const og = el('optgroup', { label: gruppe });
    for (const a of erlaubt) {
      const wert = (p.attributes && p.attributes[a]) || 0;
      og.appendChild(el('option', { value: a }, `${ATTRIBUTE_NAMES[a] || a} (${wert})`));
    }
    sel.appendChild(og);
  }
  return sel;
}

async function sonderschichtDialog(ctx, state, club, vorgabe) {
  const kader = kaderVon(state, club).filter(p => !p.injury);
  if (!kader.length) {
    toast('Kein einsatzfähiger Spieler für Sonderschichten.', 'warn');
    return;
  }

  const spielerSel = el('select', {
    style: { padding: '4px 6px', width: '100%', border: '1px solid var(--linie)', background: 'var(--papier)' }
  }, ...sortBy(kader, p => name(p)).map(p => el('option', {
    value: p.id, selected: vorgabe && vorgabe.id === p.id
  }, `${name(p)} — ${p.position}, ${p.age} J., Stärke ${playerOverall(p)}`)));

  const attrBox = el('div');
  const kopfBox = el('div');
  let intensitaet = 60;
  const intensBox = el('div');

  function baueFuer(p) {
    clearNode(attrBox);
    attrBox.appendChild(attributAuswahl(p));
    clearNode(kopfBox);
    kopfBox.appendChild(el('div.tv-zeile', null,
      portraitBild(p, 48),
      el('div', null,
        el('div.tv-spielerkarte__name', null, name(p)),
        el('div.tv-spielerkarte__meta', null,
          `${POSITION_NAMES[p.position] || p.position} · ${p.age} Jahre · Potenzial ${p.potential || '?'}`),
        istLegende(p) ? pill(p.eraLabel || 'Legende', 'legende') : null)));
  }
  baueFuer(state.players[spielerSel.value] || kader[0]);
  spielerSel.addEventListener('change', () => {
    const p = state.players[spielerSel.value];
    if (p) baueFuer(p);
  });

  intensBox.appendChild(regler('Härte der Sonderschicht', intensitaet, {
    enden: ['locker', 'kompromisslos'],
    onInput: (v) => { intensitaet = v; },
    onChange: (v) => { intensitaet = v; }
  }));

  const body = el('div.tv-spalte', null,
    kopfBox,
    el('div', null, el('div.tv-subpanel__titel', null, 'Spieler'), spielerSel),
    el('div', null, el('div.tv-subpanel__titel', null, 'Woran soll er arbeiten?'), attrBox),
    intensBox,
    el('div.tv-mini', { style: { lineHeight: '1.5' } },
      'Je härter die Sonderschicht, desto größer der Anteil am Fortschritt — und desto mehr leidet ',
      'der Rest seiner Entwicklung. Dazu kommen müde Beine. Ein Kompromiss um die 60 hat sich bewährt.'));

  const ergebnis = await dialog('Sonderschicht ansetzen', body, [
    { label: 'Abbrechen', value: null, kind: 'ghost' },
    {
      label: 'Anordnen', kind: 'primary',
      onClick: () => {
        const pid = spielerSel.value;
        const attribut = attrBox.querySelector('select') ? attrBox.querySelector('select').value : null;
        try {
          return individualtraining(state, pid, attribut, intensitaet);
        } catch (err) {
          return { ok: false, text: 'Individualtraining nicht verfügbar: ' + ((err && err.message) || err) };
        }
      }
    }
  ], { size: 'md' });

  if (ergebnis) {
    toast(ergebnis.text, ergebnis.ok ? 'gut' : 'schlecht');
    if (ergebnis.ok) { ctx.aktualisiere(); ctx.refresh(); }
  }
}

function individualPanel(ctx, state, club) {
  const kader = kaderVon(state, club);
  const mitFokus = kader.filter(p => p.training && p.training.focus);

  const liste = el('div.tv-spalte', { style: { gap: '0' } });
  if (mitFokus.length) {
    for (const p of mitFokus) {
      const attribut = p.training.focus;
      const wert = (p.attributes && p.attributes[attribut]) || 0;
      const inten = clamp(Math.round(p.training.intensitaet != null ? p.training.intensitaet : 60), 0, 100);
      liste.appendChild(el('div.tv-talent', { style: legendeStil(p) },
        portraitBild(p, 32),
        el('div', { style: { flex: '1', minWidth: 0 } },
          el('div', { style: { fontWeight: '700', fontSize: '12.5px' } },
            name(p), ' ', istLegende(p) ? pill(p.eraLabel || 'Legende', 'legende') : null),
          el('div.tv-mini', null,
            `${ATTRIBUTE_NAMES[attribut] || attribut} · aktuell ${wert} · Härte ${inten}`),
          balken(wert, 99, { text: false, tooltip: `${ATTRIBUTE_NAMES[attribut] || attribut}: ${wert}` })),
        el('div.tv-zeile', { style: { gap: '4px' } },
          button('Ändern', () => sonderschichtDialog(ctx, state, club, p), { size: 'klein', kind: 'ghost' }),
          button('Beenden', () => {
            let res;
            try {
              res = individualtraining(state, p.id, null);
            } catch (err) {
              toast('Ließ sich nicht beenden: ' + ((err && err.message) || err), 'schlecht');
              return;
            }
            toast((res && res.text) || 'Sonderschicht beendet.', 'info');
            ctx.aktualisiere();
            ctx.refresh();
          }, { size: 'klein', kind: 'danger' }))));
    }
  } else {
    liste.appendChild(hinweis(
      'Niemand hängt derzeit Sonderschichten an. Für junge Spieler mit einer offensichtlichen Schwäche ' +
      'ist das die schnellste Abkürzung nach oben.'));
  }

  /* Vorschläge: junge Spieler mit einem auffällig schwachen Attribut. */
  const vorschlaege = [];
  for (const p of kader) {
    if (p.injury || (p.training && p.training.focus)) continue;
    if (p.age > 26) continue;
    const attrs = p.attributes || {};
    const relevant = ATTRIBUTES.filter(a => p.position === 'TW'
      ? true
      : !KEEPER_ATTRIBUTES.includes(a));
    let schwaechste = null;
    for (const a of relevant) {
      const v = attrs[a];
      if (v == null) continue;
      if (!schwaechste || v < schwaechste.wert) schwaechste = { attribut: a, wert: v };
    }
    if (schwaechste && (p.potential || 0) - playerOverall(p) >= 5) {
      vorschlaege.push({ p, ...schwaechste });
    }
  }
  const top = sortBy(vorschlaege, v => ({ key: (v.p.potential || 0) - playerOverall(v.p), desc: true })).slice(0, 4);

  const vorschlagBox = el('div.tv-spalte', { style: { gap: '4px' } });
  if (top.length) {
    for (const v of top) {
      vorschlagBox.appendChild(el('div.tv-zeile.tv-zeile--verteilt', { style: { fontSize: '11.5px' } },
        el('span', null, `${name(v.p)} (${v.p.age}) — schwächster Wert: ${ATTRIBUTE_NAMES[v.attribut]} ${v.wert}`),
        button('Ansetzen', () => sonderschichtDialog(ctx, state, club, v.p), { size: 'klein' })));
    }
  } else {
    vorschlagBox.appendChild(el('div.tv-mini', null, 'Der Co-Trainer hat gerade keine Empfehlung.'));
  }

  return panel(
    panelTitel('Individualtraining', `${mitFokus.length} Sonderprogramm${mitFokus.length === 1 ? '' : 'e'}`),
    el('div.tv-spalte', null,
      liste,
      button('Sonderschicht ansetzen', () => sonderschichtDialog(ctx, state, club, null), { kind: 'primary', wide: true }),
      el('div.tv-subpanel', null,
        el('div.tv-subpanel__titel', null, 'Vorschläge des Co-Trainers'),
        vorschlagBox)));
}

/* ==========================================================================
 * 8. Torwarttraining
 * ======================================================================== */

function torwartPanel(ctx, state, club) {
  const einheit = EINHEITEN.torwarttraining;
  if (!einheit) {
    return panel('Torwarttraining',
      hinweis('Dieses Trainingsmodul kennt keine eigene Torwarteinheit. Die Keeper trainieren mit der Mannschaft mit.'));
  }

  const keeper = kaderVon(state, club).filter(p => p.position === 'TW');
  const plan = normPlan(club.training && club.training.wochenplan
    ? club.training.wochenplan
    : standardplan((club.training && club.training.schwerpunkt) || 'ausgeglichen'));

  let imPlan = 0;
  for (let d = 0; d < 7; d++) for (const id of plan[d] || []) if (id === 'torwarttraining') imPlan++;

  /* Torwarttrainer aus dem Stab — optional, deshalb defensiv. */
  let trainerText = 'Kein Torwarttrainer im Stab. Die Keeper üben, was sie selbst für richtig halten.';
  let trainerGuete = 0;
  try {
    const stab = stabVon(state, club.id) || [];
    const tw = stab.filter(s => rolleVon(s) === 'torwarttrainer');
    if (tw.length) {
      const bester = sortBy(tw, s => ({ key: qualitaetVon(s), desc: true }))[0];
      trainerGuete = qualitaetVon(bester);
      trainerText = `${bester.name || (STAFF_ROLES.torwarttrainer && STAFF_ROLES.torwarttrainer.name) || 'Torwarttrainer'} ` +
        `· Güte ${trainerGuete} von 99`;
    }
  } catch (e) {
    trainerText = 'Der Trainerstab meldet sich nicht — Angaben zum Torwarttrainer fehlen.';
  }

  const keeperBox = el('div.tv-spalte', { style: { gap: '8px' } });
  if (keeper.length) {
    for (const p of sortBy(keeper, p => ({ key: playerOverall(p), desc: true }))) {
      const attrBox = el('div', null, ...KEEPER_ATTRIBUTES.map(a => {
        const wert = (p.attributes && p.attributes[a]) || 0;
        return el('div.tv-attr', null,
          el('span.tv-attr__name', null, ATTRIBUTE_NAMES[a] || a),
          balken(wert, 99, { text: false }),
          el('span.tv-wert', { class: ratingClass(wert) + '-text' }, String(wert)));
      }));
      keeperBox.appendChild(el('div.tv-subpanel', { style: legendeStil(p) },
        el('div.tv-zeile', { style: { marginBottom: '5px' } },
          portraitBild(p, 40),
          el('div', { style: { flex: '1' } },
            el('div', { style: { fontWeight: '700' } },
              name(p), ' ', istLegende(p) ? pill(p.eraLabel || 'Legende', 'legende') : null),
            el('div.tv-mini', null,
              `${p.age} Jahre · Stärke ${playerOverall(p)} · Potenzial ${p.potential || '?'} · ` +
              `Fitness ${Math.round(p.fitness != null ? p.fitness : 100)} %`)),
          button('Sonderschicht', () => sonderschichtDialog(ctx, state, club, p), { size: 'klein', kind: 'ghost' })),
        attrBox));
    }
  } else {
    keeperBox.appendChild(hinweis('Kein Torwart im Kader. Das wird am Samstag lustig.'));
  }

  function planeEin() {
    const p = normPlan(club.training.wochenplan || standardplan(club.training.schwerpunkt));
    for (let d = 0; d < 5; d++) {
      if ((p[d] || []).length < 2 && !(p[d] || []).includes('torwarttraining')) {
        p[d].push('torwarttraining');
        try {
          const res = wochenplanSetzen(state, club.id, p);
          toast(res && res.ok
            ? `Torwarttraining am ${WOCHENTAGE[d]} eingeplant.`
            : ((res && res.text) || 'Abgelehnt.'), res && res.ok ? 'gut' : 'schlecht');
        } catch (err) {
          toast('Nicht möglich: ' + ((err && err.message) || err), 'schlecht');
          return;
        }
        ctx.aktualisiere();
        ctx.refresh();
        return;
      }
    }
    toast('Die Woche ist voll. Erst einen Platz freiräumen.', 'warn');
  }

  return panel(
    panelTitel('Torwarttraining', `${imPlan}× in dieser Woche`),
    el('div.tv-spalte', null,
      el('div.tv-subpanel', null,
        el('div.tv-subpanel__titel', null, 'Zuständig'),
        el('div.tv-mini', null, trainerText),
        trainerGuete ? balken(trainerGuete, 99, { text: String(trainerGuete) }) : null,
        el('div.tv-mini', { style: { marginTop: '4px' } }, einheit.desc)),
      keeperBox,
      el('div.tv-zeile', { style: { gap: '6px' } },
        button('Einheit einplanen', planeEin, { kind: 'primary', size: 'klein' }),
        el('span.tv-mini', null,
          'Feldspieler machen währenddessen Spielformen — verschenkt ist die Einheit also nicht.'))));
}

/* ==========================================================================
 * 9. Trainingslager
 * ======================================================================== */

/** Wann geht es wieder? Reiner Hinweistext. */
function naechstesFensterText(tag) {
  const kommend = LAGER_FENSTER.filter(f => f.von > tag).sort((a, b) => a.von - b.von)[0];
  if (kommend) return `Die ${kommend.name} beginnt an Tag ${kommend.von}.`;
  return `Die nächste Gelegenheit ist die ${LAGER_FENSTER[0].name} der kommenden Saison.`;
}

function lagerPanel(ctx, state, club) {
  const t = club.training || {};
  const lager = t.trainingslager;
  const kader = Math.max(1, (club.playerIds || []).length || 24);
  const tag = state.date.day;
  const fenster = LAGER_FENSTER.find(f => tag >= f.von && tag <= f.bis) || null;

  if (lager) {
    const ort = TRAININGSLAGER_ORTE[lager.ortId];
    return panel(
      panelTitel('Trainingslager', 'läuft gerade'),
      el('div.tv-spalte', null,
        el('div.tv-zeile', { style: { gap: '12px' } },
          progressRing(lager.tage - lager.restTage, lager.tage, { size: 74, sub: 'Tage' }),
          el('div', null,
            el('div', { style: { fontSize: '16px', fontWeight: '700' } }, lager.name || (ort && ort.name) || 'Trainingslager'),
            el('div.tv-mini', null,
              `${ort ? ort.land : ''} · ${LAGER_BUDGETS[lager.budget] ? LAGER_BUDGETS[lager.budget].name : lager.budget} · ` +
              `${formatMoney(lager.kosten || 0)}`),
            el('div.tv-mini', null,
              `Noch ${lager.restTage} von ${lager.tage} Tagen · ${lager.verletzungen || 0} Blessuren bisher`))),
        ort ? el('div.tv-mini', { style: { fontStyle: 'italic' } }, ort.desc) : null,
        el('div.tv-mini', null,
          'Zwei Einheiten pro Tag, kein Pardon. Der Wochenplan ruht so lange.')));
  }

  const orte = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '8px' } });
  let tage = 8;
  let budgetId = 'normal';
  const kostenTexte = new Map();

  function kostenFuer(ort) {
    const b = LAGER_BUDGETS[budgetId] || LAGER_BUDGETS.normal;
    return Math.round(ort.kostenProTagUndSpieler * tage * kader * b.faktor);
  }

  function aktualisiereKosten() {
    for (const [ortId, node] of kostenTexte) {
      const ort = TRAININGSLAGER_ORTE[ortId];
      if (ort) node.textContent = formatMoney(kostenFuer(ort));
    }
  }

  async function buchen(ort) {
    const b = LAGER_BUDGETS[budgetId] || LAGER_BUDGETS.normal;
    const ja = await dialog('Trainingslager buchen',
      el('div.tv-spalte', null,
        el('p', null,
          `${tage} Tage ${ort.name} (${ort.land}), Unterbringung „${b.name}".`),
        el('p', null, `Voraussichtliche Kosten: `, el('b', null, formatMoney(kostenFuer(ort)))),
        ort.fanReaktion < 0
          ? el('p.tv-warnung', null,
            'Die Fans halten von diesem Reiseziel wenig. Mit Transparenten ist zu rechnen.')
          : null,
        el('p.tv-mini', null, ort.desc)),
      [
        { label: 'Doch nicht', value: false, kind: 'ghost' },
        { label: 'Buchen', value: true, kind: 'primary' }
      ], { size: 'sm', escValue: false });
    if (!ja) return;

    let res;
    try {
      res = trainingslager(state, club.id, ort.id, tage, budgetId);
    } catch (err) {
      toast('Buchung fehlgeschlagen: ' + ((err && err.message) || err), 'schlecht');
      return;
    }
    toast((res && res.text) || 'Unbekannte Antwort des Reisebüros.', res && res.ok ? 'gut' : 'schlecht');
    if (res && res.ok) { ctx.aktualisiere(); ctx.refresh(); }
  }

  for (const id in TRAININGSLAGER_ORTE) {
    const ort = TRAININGSLAGER_ORTE[id];
    const kostenNode = el('b.tv-num', null, formatMoney(kostenFuer(ort)));
    kostenTexte.set(id, kostenNode);

    const wirkung = el('div', { style: { display: 'grid', gap: '3px', margin: '5px 0' } },
      el('div.tv-attr', null, el('span.tv-attr__name', null, 'Kondition'),
        balken(clamp((ort.kondition - 0.6) / 0.8 * 100, 0, 100), 100, { text: false }),
        el('span.tv-wert', null, '×' + ort.kondition.toFixed(2))),
      el('div.tv-attr', null, el('span.tv-attr__name', null, 'Teamgeist'),
        balken(clamp((ort.teamgeist - 0.4) / 0.8 * 100, 0, 100), 100, { text: false }),
        el('span.tv-wert', null, '×' + ort.teamgeist.toFixed(2))),
      el('div.tv-attr', null, el('span.tv-attr__name', null, 'Technik'),
        balken(clamp((ort.technik - 0.7) / 0.5 * 100, 0, 100), 100, { text: false }),
        el('span.tv-wert', null, '×' + ort.technik.toFixed(2))),
      el('div.tv-attr', null, el('span.tv-attr__name', null, 'Verletzungen'),
        balken(clamp((ort.risiko - 0.7) / 0.6 * 100, 0, 100), 100, {
          text: false, klasse: ort.risiko > 1.02 ? 'rat-schwach' : ort.risiko < 0.9 ? 'rat-elite' : 'rat-ok'
        }),
        el('span.tv-wert', null, '×' + ort.risiko.toFixed(2))));

    orte.appendChild(el('div.tv-subpanel', null,
      el('div.tv-zeile.tv-zeile--verteilt', null,
        el('div', null,
          el('div', { style: { fontWeight: '700', fontSize: '13px' } }, ort.name),
          el('div.tv-mini', null, ort.land)),
        pill(ort.fanReaktion >= 3 ? 'Fans begeistert'
          : ort.fanReaktion >= 1 ? 'Fans zufrieden'
            : ort.fanReaktion >= 0 ? 'Fans neutral' : 'Fanproteste',
        ort.fanReaktion >= 2 ? 'gut' : ort.fanReaktion >= 0 ? 'neutral' : 'schlecht')),
      el('div.tv-mini', { style: { fontStyle: 'italic', margin: '3px 0' } }, ort.desc),
      wirkung,
      el('div.tv-zeile.tv-zeile--verteilt', null,
        el('span.tv-mini', null, 'Kosten: ', kostenNode),
        button('Buchen', () => buchen(ort), { size: 'klein', kind: 'primary' }))));
  }

  const dauerRegler = regler('Dauer (Tage)', tage, {
    min: 4, max: 16, enden: ['4 Tage', '16 Tage'],
    onInput: (v) => { tage = v; aktualisiereKosten(); },
    onChange: (v) => { tage = v; aktualisiereKosten(); }
  });

  const budgetBox = el('div.tv-zeile', { style: { gap: '5px', flexWrap: 'wrap' } });
  const budgetKnoepfe = [];
  for (const id in LAGER_BUDGETS) {
    const b = LAGER_BUDGETS[id];
    const btn = button(b.name, () => {
      budgetId = id;
      budgetKnoepfe.forEach(x => { x.node.style.outline = x.id === budgetId ? '2px solid var(--gold)' : ''; });
      aktualisiereKosten();
    }, { size: 'klein', tooltip: `Kostenfaktor ×${b.faktor} · Wirkung ×${b.wirkung} · Stimmung ${b.moral > 0 ? '+' : ''}${b.moral}` });
    if (id === budgetId) btn.style.outline = '2px solid var(--gold)';
    budgetKnoepfe.push({ id, node: btn });
    budgetBox.appendChild(btn);
  }

  return panel(
    panelTitel('Trainingslager',
      fenster ? fenster.name + ' — Buchung möglich' : 'außerhalb der Vorbereitung'),
    el('div.tv-spalte', null,
      fenster
        ? el('div.tv-mini', null,
          `Sie befinden sich in der ${fenster.name}. Jetzt ist Zeit für Bergluft und lange Läufe.`)
        : el('div.tv-warnung', null,
          '⚠ Der Spielplan lässt gerade kein Trainingslager zu — möglich ist das nur in der ' +
          'Sommer- und in der Wintervorbereitung. ' + naechstesFensterText(tag)),
      el('div.tv-grid.tv-grid--2', null,
        dauerRegler,
        el('div', null, el('div.tv-subpanel__titel', null, 'Unterbringung'), budgetBox)),
      orte,
      el('div.tv-mini', null,
        `Kalkuliert mit ${kader} Spielern. Die Rechnung geht direkt an den Schatzmeister — er wird sich melden.`)));
}

/* ==========================================================================
 * 10. Trainingsbericht
 * ======================================================================== */

function berichtPanel(state, club, bericht) {
  const zeilen = (bericht && bericht.zeilen) || [];
  const warnungen = (bericht && bericht.warnungen) || [];
  const bewertung = (club.training && club.training.letzteBewertung) || null;

  const zettel = el('div.tv-pinnwand', null,
    el('div.tv-zettel', null,
      el('b', null, 'Notiz des Co-Trainers'),
      bewertung && bewertung.bericht
        ? el('div', { style: { whiteSpace: 'pre-wrap' } }, bewertung.bericht)
        : el('div', null,
          'Noch kein Wochenbericht. Montags früh liegt der erste auf Ihrem Schreibtisch — ',
          'mit allem, was in der Woche gut und schlecht lief.')));

  const fakten = el('div.tv-spalte', { style: { gap: '3px' } },
    ...zeilen
      .filter(z => !warnungen.includes(z))
      .map(z => el('div', { style: { fontSize: '12.5px', lineHeight: '1.45' } }, '▸ ' + z)),
    ...warnungen.map(w => el('div.tv-warnung', { style: { fontSize: '12.5px', lineHeight: '1.45' } }, '⚠ ' + w)));

  const auf = (bewertung && bewertung.aufsteiger) || [];
  const ab = (bewertung && bewertung.absteiger) || [];
  const listen = el('div.tv-grid.tv-grid--2', null,
    el('div.tv-subpanel', null,
      el('div.tv-subpanel__titel', null, 'Aufwärtstrend der Woche'),
      auf.length
        ? el('div.tv-spalte', { style: { gap: '2px' } },
          ...auf.map(a => el('div', { style: { fontSize: '11.5px' } },
            el('b', null, a.name), ' — ', (a.attribute || []).join(', '))))
        : el('div.tv-mini', null, 'Große Sprünge hat zuletzt niemand gemacht.')),
    el('div.tv-subpanel', null,
      el('div.tv-subpanel__titel', null, 'Der Zahn der Zeit'),
      ab.length
        ? el('div.tv-spalte', { style: { gap: '2px' } },
          ...ab.map(a => el('div', { style: { fontSize: '11.5px' } },
            el('b', null, a.name), ' — ', (a.attribute || []).join(', '))))
        : el('div.tv-mini', null, 'Niemand hat zuletzt abgebaut. Genießen Sie den Moment.')));

  return panel(
    panelTitel('Trainingsbericht',
      bewertung ? `${bewertung.tage} Trainingstage · Intensität ${Math.round(bewertung.intensitaet)}` : 'noch keine Auswertung'),
    el('div.tv-spalte', null, zettel, fakten, listen));
}

/* ==========================================================================
 * 11. Übungsplatz — die fünf Minispiele ohne Ernstfall
 *
 * ZWECK
 *   Niemand soll seinen ersten Elfmeter im Pokalfinale schießen. Hier laufen
 *   dieselben Minispiele wie im Spiel, mit echten eigenen Spielern, gegen den
 *   eigenen Torwart und die eigene Abwehr.
 *
 * KEINE SPIELWIRKUNG
 *   Der Übungsplatz schreibt ausschließlich `club.training.uebungsplatz`.
 *   Keine Moral, keine Fitness, keine Spielerstatistik, kein Kartenkonto —
 *   was auf dem Trainingsplatz passiert, bleibt auf dem Trainingsplatz.
 * ======================================================================== */

/** Attributwert mit Vorgabe – Kader aus alten Spielständen haben Lücken. */
function att(p, key, vorgabe = 0) {
  const v = p && p.attributes ? p.attributes[key] : null;
  return typeof v === 'number' ? v : vorgabe;
}

/**
 * Die fünf Szenenarten.
 *
 * `at` sind Meter nach CONTRACTS §1 (Heim greift Richtung +x an, Tor bei x=105).
 * `baseChance` und `pressure` gehören zum KeyMoment-Vertrag (§6.1). Auf dem
 * Übungsplatz entscheidet hinterher niemand mehr über das Ergebnis — die Werte
 * sorgen nur dafür, dass die Minispiele dieselbe Ausgangslage sehen wie im Spiel.
 */
const UEBUNGEN = [
  {
    id: 'elfmeter', mg: mgElfmeter, plural: 'Elfmetern', rolle: 'Schütze',
    beschreibung: 'Elf Meter, ein Torwart, kein Alibi. Wer hier zittert, zittert später vor 60.000 Leuten.',
    at: { x: 94, y: 34 }, baseChance: 0.76, pressure: 58, minute: 88,
    treffer: ['tor'],
    eignung: p => att(p, 'schuss') * 0.45 + att(p, 'nervenstaerke') * 0.45 + att(p, 'technik') * 0.10
  },
  {
    id: 'freistoss', mg: mgFreistoss, plural: 'Freistößen', rolle: 'Schütze',
    beschreibung: '21 Meter, eine Mauer, ein Torwart, der schon weiß, wohin Sie zielen. Meistens jedenfalls.',
    at: { x: 84, y: 30 }, baseChance: 0.09, pressure: 40, minute: 71,
    treffer: ['tor'],
    eignung: p => att(p, 'standards') * 0.55 + att(p, 'technik') * 0.30 + att(p, 'schuss') * 0.15
  },
  {
    id: 'ecke', mg: mgEcke, plural: 'Ecken', rolle: 'Flankengeber',
    beschreibung: 'Reinbringen und beten. Die zweite Hälfte der Übung erledigen die Kopfballstarken.',
    at: { x: 105, y: 68 }, baseChance: 0.13, pressure: 45, minute: 63,
    treffer: ['tor', 'kopfball_tor'],
    eignung: p => att(p, 'standards') * 0.50 + att(p, 'passspiel') * 0.35 + att(p, 'technik') * 0.15
  },
  {
    id: 'abschluss', mg: mgAbschluss, plural: 'Abschlüssen', rolle: 'Stürmer',
    beschreibung: 'Allein vor dem Tor. Der Moment, in dem sich Torjäger und Torwartfreunde trennen.',
    at: { x: 93, y: 34 }, baseChance: 0.30, pressure: 52, minute: 77,
    treffer: ['tor', 'kopfball_tor'],
    eignung: p => att(p, 'schuss') * 0.50 + att(p, 'technik') * 0.28 + att(p, 'nervenstaerke') * 0.22
  },
  {
    id: 'kombination', mg: mgKombination, plural: 'Kombinationen', rolle: 'Ballführender',
    beschreibung: 'Den letzten Pass selbst spielen. Gewertet wird, wer den Angriff bis zum Abschluss bringt.',
    at: { x: 72, y: 34 }, baseChance: 0.28, pressure: 48, minute: 34,
    treffer: ['tor', 'kopfball_tor', 'abgeschlossen'],
    eignung: p => att(p, 'passspiel') * 0.42 + att(p, 'uebersicht') * 0.34 + att(p, 'technik') * 0.24
  }
];

/** Kommentar des Platzwarts zum Ausgang einer Übung. */
const UEBUNG_TEXTE = {
  tor: 'Drin! Der Zeugwart darf den Ball aus dem Netz holen.',
  kopfball_tor: 'Kopfball, Netz, kurzer Applaus von der Trainerbank.',
  parade: 'Gehalten. Ihr Torwart grinst und stellt sich neu hin.',
  daneben: 'Vorbei. Der Ball rollt Richtung Parkplatz.',
  geblockt: 'Abgeblockt. Die eigene Abwehr macht ihre Arbeit leider gut.',
  latte: 'Latte. Ein Zentimeter Unterschied zwischen Held und Statist.',
  pfosten: 'Pfosten. Auch das ist Millimeterarbeit — nur die falsche.',
  abgeschlossen: 'Durchgespielt und abgeschlossen. Genau so war das gedacht.',
  abgefangen: 'Abgefangen. Der Pass war zu gemütlich angesagt.'
};

/** Lazy: die Übungsstatistik des Vereins. */
function uebungsplatzVon(club) {
  if (!club.training) club.training = {};
  if (!club.training.uebungsplatz) club.training.uebungsplatz = {};
  return club.training.uebungsplatz;
}

/** Statistikeintrag einer Szenenart (lesend, ohne anzulegen). */
function uebungsEintrag(club, kind) {
  const platz = (club.training && club.training.uebungsplatz) || {};
  return platz[kind] || null;
}

/**
 * Bucht einen Versuch — die EINZIGE Zustandsänderung des Übungsplatzes.
 * Gezählt wird zweimal: für die Szenenart insgesamt und für den Ausführenden.
 */
function uebungBuchen(club, kind, playerId, treffer) {
  const platz = uebungsplatzVon(club);
  if (!platz[kind]) platz[kind] = { versuche: 0, treffer: 0, serie: 0, besteSerie: 0, spieler: {} };
  const eintrag = platz[kind];
  if (!eintrag.spieler) eintrag.spieler = {};
  if (!eintrag.spieler[playerId]) eintrag.spieler[playerId] = { versuche: 0, treffer: 0, serie: 0, besteSerie: 0 };

  for (const z of [eintrag, eintrag.spieler[playerId]]) {
    z.versuche++;
    if (treffer) {
      z.treffer++;
      z.serie++;
      if (z.serie > z.besteSerie) z.besteSerie = z.serie;
    } else {
      z.serie = 0;
    }
  }
}

/** „12 von 20 Elfmetern · Quote 60 % · bester Lauf 5" */
function uebungsText(eintrag, u) {
  if (!eintrag || !eintrag.versuche) return null;
  const quote = Math.round((eintrag.treffer / eintrag.versuche) * 100);
  return `${eintrag.treffer} von ${eintrag.versuche} ${u.plural} · Quote ${quote} % · bester Lauf ${eintrag.besteSerie}`;
}

/**
 * Vorauswahl des Ausführenden: Was die Taktik für ruhende Bälle vorsieht, gilt
 * auch auf dem Übungsplatz (siehe tactics.setPieces). Für Abschluss und
 * Kombination gibt es dort keinen Eintrag — da entscheidet die Eignung.
 */
function uebungsAuswahl(club, u, kandidaten) {
  const sp = (club.tactics && club.tactics.setPieces) || {};
  const gesetzt = sp[u.id];
  if (gesetzt && kandidaten.some(p => p.id === gesetzt)) return gesetzt;
  const beste = sortBy(kandidaten, p => ({ key: u.eignung(p) - (p.position === 'TW' ? 60 : 0), desc: true }))[0];
  return beste ? beste.id : null;
}

/**
 * Gegner und Anspielstationen — alles aus dem eigenen Kader.
 * Der Ausführende selbst bleibt außen vor, sonst steht er sich im Weg.
 */
function uebungsPersonal(state, club, u, actor) {
  const kader = kaderVon(state, club).filter(p => !p.injury && p.id !== actor.id);
  const keeper = sortBy(kader.filter(p => p.position === 'TW'),
    p => ({ key: playerOverall(p), desc: true }))[0] || null;

  const feld = kader.filter(p => p.position !== 'TW');
  const kopfball = p => att(p, 'kopfball') * 0.6 + att(p, 'sprungkraft') * 0.4;
  const abwehrWert = p => (POSITION_GROUP[p.position] === 'ABW' ? 22 : 0)
    + att(p, 'zweikampf') * 0.5 + att(p, 'positionsspiel') * 0.3 + kopfball(p) * 0.2;

  const defenders = sortBy(feld, p => ({ key: abwehrWert(p), desc: true })).slice(0, 4);
  const rest = feld.filter(p => !defenders.includes(p));

  let targets = [];
  if (u.id === 'ecke') targets = sortBy(rest, p => ({ key: kopfball(p), desc: true })).slice(0, 4);
  else if (u.id === 'kombination') {
    targets = sortBy(rest, p => ({
      key: att(p, 'tempo') * 0.35 + att(p, 'technik') * 0.35 + att(p, 'positionsspiel') * 0.3, desc: true
    })).slice(0, 4);
  }
  return { keeper, defenders, targets };
}

/** Synthetischer KeyMoment nach CONTRACTS §6.1 — die Bühne braucht einen. */
function uebungsMoment(u, actor, personal) {
  return {
    kind: u.id,
    minute: u.minute,
    team: 'home',
    actor,
    keeper: personal.keeper,
    defenders: personal.defenders,
    targets: personal.targets,
    at: { x: u.at.x, y: u.at.y },
    baseChance: u.baseChance,
    pressure: u.pressure,
    context: { score: [0, 0], minute: u.minute, competition: 'Übungsplatz' }
  };
}

/** Startet eine Übung. `fertig()` wird nur bei gewerteten Versuchen gerufen. */
async function uebungStarten(state, club, u, actorId, schwierigkeitId, fertig) {
  const actor = state.players[actorId];
  if (!actor) { toast('Dieser Spieler steht nicht mehr im Kader.', 'warn'); return; }
  if (actor.injury) { toast(`${name(actor)} ist verletzt. Der Doktor hätte etwas dagegen.`, 'warn'); return; }

  let minispielStarten;
  try {
    ({ minispielStarten } = await import('../game/matchday.js'));
  } catch (err) {
    console.error('[training] Minispielbühne nicht ladbar:', err);
    toast('Die Minispielbühne lässt sich nicht laden — ohne sie kein Übungsplatz.', 'schlecht');
    return;
  }

  const personal = uebungsPersonal(state, club, u, actor);
  const bisher = uebungsEintrag(club, u.id);

  let res = null;
  try {
    res = await minispielStarten(u.mg, uebungsMoment(u, actor, personal), state, null, {
      // Deterministisch und trotzdem bei jedem Versuch eine neue Szene:
      // der Zähler wandert mit. Kein Math.random, kein Date.now.
      seed: `uebung:${club.id}:${u.id}:${actor.id}:${(bisher && bisher.versuche) || 0}`,
      difficulty: DIFFICULTIES[schwierigkeitId] || DIFFICULTIES.profi,
      abbruchText: 'ESC bricht die Übung ab — gewertet wird sie dann nicht.'
    });
  } catch (err) {
    console.error('[training] Übung fehlgeschlagen:', err);
    toast('Die Übung ist abgestürzt. Der Platzwart sammelt die Scherben ein.', 'schlecht');
    return;
  }

  if (!res || !res.outcome) {
    toast('Abgebrochen. Die Bälle liegen wieder im Netz.', 'info');
    return;
  }

  const treffer = u.treffer.includes(res.outcome);
  uebungBuchen(club, u.id, actor.id, treffer);
  toast(`${name(actor)}: ${UEBUNG_TEXTE[res.outcome] || 'Szene beendet.'}`, treffer ? 'gut' : 'info');
  fertig();
}

function uebungsplatzPanel(ctx, state, club) {
  const kader = kaderVon(state, club).filter(p => !p.injury);
  if (kader.length < 2) {
    return panel(panelTitel('Übungsplatz', 'geschlossen'),
      hinweis('Für eine Übung braucht es mindestens zwei gesunde Spieler. Aktuell reicht es nicht einmal für ein Anspiel.'));
  }

  const schwierigkeitSelect = el('select', {
    style: { padding: '3px 5px', fontSize: '11.5px' }
  }, ...Object.values(DIFFICULTIES).map(d =>
    el('option', { value: d.id, selected: d.id === state.difficulty }, d.name)));
  schwierigkeitSelect.value = DIFFICULTIES[state.difficulty] ? state.difficulty : 'profi';

  const karten = el('div.tv-uebung', null, ...UEBUNGEN.map(u => {
    const kandidaten = sortBy(kader, p => ({ key: u.eignung(p) - (p.position === 'TW' ? 60 : 0), desc: true }));
    const vorauswahl = uebungsAuswahl(club, u, kandidaten);

    const spielerSelect = el('select', {
      style: { flex: '1', minWidth: 0, padding: '3px 5px', fontSize: '11.5px' }
    }, ...kandidaten.map(p => el('option', {
      value: p.id, selected: p.id === vorauswahl
    }, `${name(p)} (${p.position})`)));
    if (vorauswahl) spielerSelect.value = vorauswahl;

    const statZeile = el('div.tv-uebung__stat');
    const zeichneStat = () => {
      clearNode(statZeile);
      const gesamt = uebungsEintrag(club, u.id);
      const text = uebungsText(gesamt, u);
      statZeile.appendChild(el('div', null, text || 'Noch keine Übung. Der Ball liegt bereit.'));
      const eigen = gesamt && gesamt.spieler ? gesamt.spieler[spielerSelect.value] : null;
      if (eigen && eigen.versuche) {
        const p = state.players[spielerSelect.value];
        statZeile.appendChild(el('div.tv-mini', null,
          `${name(p)} persönlich: ${eigen.treffer} von ${eigen.versuche} · bester Lauf ${eigen.besteSerie}`));
      }
    };
    spielerSelect.addEventListener('change', zeichneStat);
    zeichneStat();

    const personalText = () => {
      const p = state.players[spielerSelect.value];
      if (!p) return 'Gegner: steht noch nicht fest.';
      const per = uebungsPersonal(state, club, u, p);
      const abwehr = per.defenders.slice(0, u.id === 'elfmeter' ? 0 : 2).map(d => name(d));
      return 'Gegner: ' + (per.keeper ? `${name(per.keeper)} im Tor` : 'niemand im Tor')
        + (abwehr.length ? `, davor ${abwehr.join(' und ')}` : '') + '.';
    };
    const gegnerZeile = el('div.tv-mini', null, personalText());
    spielerSelect.addEventListener('change', () => { gegnerZeile.textContent = personalText(); });

    const starten = button('Aufs Feld', async (ev) => {
      const knopf = ev.currentTarget;
      knopf.disabled = true;
      try {
        await uebungStarten(state, club, u, spielerSelect.value, schwierigkeitSelect.value, () => {
          zeichneStat();
          ctx.aktualisiere();
        });
      } finally {
        knopf.disabled = false;
      }
    }, { size: 'klein', kind: 'primary', wide: true });

    return el('div.tv-uebung__karte', null,
      el('div.tv-uebung__kopf', null, el('b', null, u.mg.title)),
      el('div.tv-mini', null, u.beschreibung),
      el('div.tv-uebung__steuerung', null, u.mg.instructions || 'Maus und Tastatur.'),
      gegnerZeile,
      el('div.tv-zeile', { style: { gap: '5px' } },
        el('span.tv-mini', { style: { flex: '0 0 82px' } }, u.rolle + ':'),
        spielerSelect),
      statZeile,
      starten);
  }));

  const gesamtVersuche = UEBUNGEN.reduce((s, u) => {
    const e = uebungsEintrag(club, u.id);
    return s + ((e && e.versuche) || 0);
  }, 0);

  const loeschen = button('Statistik löschen', async () => {
    const ok = await dialog('Übungsstatistik löschen',
      el('div.tv-spalte', null,
        el('p', null, 'Alle Trefferquoten und Bestwerte des Übungsplatzes verschwinden. ' +
          'Auf den Spielbetrieb hat das keinerlei Auswirkung — es war ohnehin nur Training.')),
      [{ label: 'Behalten', value: false }, { label: 'Löschen', value: true, kind: 'danger' }]);
    if (!ok) return;
    if (club.training) club.training.uebungsplatz = {};
    toast('Der Übungsplatz ist wieder jungfräulich.', 'info');
    ctx.refresh();
  }, { size: 'klein', kind: 'ghost' });

  return panel(
    panelTitel('Übungsplatz', gesamtVersuche
      ? `${gesamtVersuche} Versuch${gesamtVersuche === 1 ? '' : 'e'} insgesamt`
      : 'noch unbenutzt'),
    el('div.tv-spalte', null,
      el('div.tv-mini', null,
        'Hier laufen dieselben fünf Szenen wie im Spiel — mit Ihren Spielern, gegen Ihren Torwart, ' +
        'ohne jede Folge für Tabelle, Moral oder Statistik. Es zählt nur die eigene Trefferquote.'),
      el('div.tv-zeile.tv-zeile--verteilt', null,
        el('div.tv-zeile', { style: { gap: '6px' } },
          el('span.tv-mini', null, 'Schwierigkeit:'), schwierigkeitSelect,
          el('span.tv-mini', null, '(gilt nur für die Übung)')),
        loeschen),
      karten));
}

/* ==========================================================================
 * 12. Der Bildschirm
 * ======================================================================== */

export const screen = {
  id: 'training',
  title: 'Training',
  icon: '🏃',

  async render(root, ctx) {
    const state = ctx.state;
    const club = state && state.clubs ? state.clubs[state.managerClubId] : null;

    if (!club) {
      root.appendChild(panel('Training',
        hinweis('Kein Verein im Spielstand gefunden. Ohne Mannschaft kein Training.')));
      return;
    }

    let bericht = null;
    try {
      bericht = trainingsbericht(state, club.id);
      if (bericht && bericht.ok === false) bericht = null;
    } catch (err) {
      console.error('[training] trainingsbericht():', err);
      bericht = null;
    }

    let niveau = bericht ? bericht.niveau : null;
    if (niveau == null) {
      try { niveau = round(ausbildungsniveau(state, club.id), 1); } catch (e) { niveau = 50; }
    }

    const lagerAktiv = (club.training && club.training.trainingslager) || null;
    const urlaub = istUrlaub(state.date.day);

    const seite = el('div.tv-seite');

    seite.appendChild(el('div.tv-seite__kopf', null,
      el('h1.tv-seite__titel', null, 'Trainingsplatz'),
      el('div.tv-seite__unter', null,
        urlaub
          ? 'Urlaubszeit — der Platzwart grüßt aus der leeren Kabine.'
          : 'Hier werden Meisterschaften vorbereitet. Oder Verletzungen.'),
      el('div', { style: { marginLeft: 'auto' } },
        progressRing(niveau || 0, 100, { size: 46, sub: 'Niveau' }))));

    seite.appendChild(sicher('Kennzahlen', () => kennzahlen(state, club, bericht || {
      frische: 100, form: 50, sharpness: 60, niveau, intensitaet: (club.training && club.training.intensitaet) || 55,
      schwerpunkt: (club.training && club.training.schwerpunkt) || 'ausgeglichen', verletzte: 0
    }, lagerAktiv)));

    seite.appendChild(el('div.tv-grid.tv-grid--haupt', null,
      sicher('Wochenplan', () => wochenplanPanel(ctx, state, club)),
      el('div.tv-spalte', null,
        sicher('Intensität', () => intensitaetPanel(ctx, state, club)),
        sicher('Trainingsbericht', () => berichtPanel(state, club, bericht)))));

    seite.appendChild(el('div.tv-grid.tv-grid--haupt', null,
      sicher('Entwicklung', () => entwicklungPanel(ctx, state, club)),
      el('div.tv-spalte', null,
        sicher('Individualtraining', () => individualPanel(ctx, state, club)),
        sicher('Torwarttraining', () => torwartPanel(ctx, state, club)))));

    seite.appendChild(sicher('Übungsplatz', () => uebungsplatzPanel(ctx, state, club)));
    seite.appendChild(sicher('Belastung', () => belastungPanel(ctx, state, club)));
    seite.appendChild(sicher('Trainingslager', () => lagerPanel(ctx, state, club)));

    root.appendChild(seite);
  },

  onLeave() {
    /* Der Screen hält keine Timer und keine globalen Listener — nichts aufzuräumen. */
  }
};

export default screen;
