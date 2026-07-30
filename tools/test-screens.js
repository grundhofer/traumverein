/**
 * tools/test-screens.js — Der Bildschirm-Prüfstand.
 *
 * Dieser Harnisch ist viermal gebaut worden (Roadmap-Stufen 2, 3, 4 und 6) und
 * viermal weggeworfen. Drei dieser vier Male hat er einen Fehler gefunden, den
 * kein anderes Prüfskript des Projekts sehen konnte — zuletzt zwei in Stufe 6,
 * beide in Code, den einundzwanzig grüne Skripte für in Ordnung hielten. Der
 * Aufwand war also längst bezahlt; gefehlt hat nur die Entscheidung, ihn zu
 * behalten. Hier ist sie.
 *
 * Aufruf:
 *   node tools/test-screens.js                 alles (Standard)
 *   node tools/test-screens.js --schnell       nur Tag 1, ohne die drei Saisons
 *   node tools/test-screens.js --saisons=5     längerer Vorlauf
 *   node tools/test-screens.js --laut          jede Meldung im Klartext
 *
 * Was er tut:
 *   1. Baut einen Spielstand — einmal an Tag 1, einmal nach drei komplett
 *      durchgespielten Saisons. Erst dann hat die Chronik Inhalt, stehen
 *      Spieler in der Ruhmeshalle und ist die ewige Tabelle keine leere Seite.
 *      Der zweite Stand steht zudem unmittelbar vor einer eigenen Partie, damit
 *      der Spieltagsbildschirm seinen Vorbericht zeigt und nicht „Kein Spiel
 *      in Sicht".
 *   2. Fährt den echten Spielrahmen hoch: main.boot() → Startbildschirm →
 *      „Spielstand laden" → Ladedialog. Kein Nachbau, der echte Weg.
 *   3. Ruft alle 19 Bildschirme auf, betätigt jedes Bedienelement einmal,
 *      öffnet jeden Reiter, öffnet Dialoge und schließt sie wieder.
 *   4. Läuft die Escape-Kette aus jedem Bildschirm ab — mit Dialog, mit zwei
 *      gestapelten Dialogen, mit Fokus in einem Eingabefeld und ohne alles.
 *   5. Zählt die Fokusringe: Welches Bedienelement ist per Tastatur erreichbar,
 *      welches trifft eine :focus-visible-Regel aus styles/ bzw. render/ui.js?
 *   6. Prüft, dass jeder Bildschirm ein gültiges screen-Objekt exportiert —
 *      nicht per Regex, sondern indem das Modul wirklich geladen wird.
 *
 * Rückgabe: Exit-Code 1, sobald etwas wirft, ein console.error fällt, ein
 * screen-Objekt fehlt oder die Escape-Kette den Benutzer einsperrt.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WAS DIESES SKRIPT NICHT PRÜFT
 * ════════════════════════════════════════════════════════════════════════
 *
 * Die DOM-Attrappe in Teil 1 ist eine Attrappe und keine Layoutmaschine. Sie
 * kann sagen „nichts wirft". Sie kann NICHT sagen „nichts läuft aus dem
 * Container". Wer das hier grün sieht und daraus schließt, die Oberfläche sei
 * abgedeckt, irrt sich in genau diesen Punkten:
 *
 *   • LAYOUT. Es wird nichts gemessen. `getBoundingClientRect()` liefert eine
 *     erfundene Zahl, jedes Element ist 800×400 Pixel groß, `scrollHeight` ist
 *     geraten. Überlauf, Umbruch, abgeschnittene Beschriftungen, zu schmale
 *     Spalten, ein Panel, das aus dem Fenster ragt: alles unsichtbar. Die
 *     Breitenprüfung des Projekts ist deshalb statisch gerechnet
 *     (tools/check-screens.js) und bleibt es.
 *   • AUSSEHEN. Es gibt keinen Kaskadenrechner. `getComputedStyle()` gibt den
 *     leeren String zurück. Ob eine Schrift lesbar ist, ob zwei Farben
 *     genügend Kontrast haben, ob der Fokusring auf dem Hintergrund überhaupt
 *     zu sehen ist — nicht prüfbar. Von den Fokusringen weiß dieses Skript
 *     nur, ob eine Regel auf den Selektor PASST, nicht, ob sie etwas bewirkt.
 *   • ZEICHNUNGEN. Der Canvas-2D-Kontext ist wirkungslos: Jeder Aufruf kehrt
 *     sofort zurück, es entsteht kein Bild. Ein Wappen, das falsch gezeichnet
 *     wird, fällt hier nicht auf — nur eines, das beim Zeichnen wirft.
 *   • ECHTE EINGABE. Klicks, Tasten und Zeigerereignisse werden nachgespielt,
 *     aber ohne die Folgen, die ein Browser von sich aus daraus zieht: Ein
 *     Klick auf ein <label> aktiviert hier kein Eingabefeld, ein <form> sendet
 *     nichts ab, die Pfeiltasten blättern kein <select> durch, Ziehen und
 *     Ablegen gibt es nicht. Wo ein Bildschirm sich darauf verlässt, prüft
 *     dieses Skript ins Leere.
 *   • NEBENLÄUFIGKEIT. Animationsbilder laufen nur, wenn dieses Skript sie
 *     einzeln antreibt (`laufeBilder`). Ein Fehler, der erst im dreihundertsten
 *     Bild auftritt, wird hier nie erreicht.
 *   • WARTEZEITEN. Zwischen zwei Klicks vergehen Mikrosekunden statt Sekunden.
 *     Was von einer Frist lebt — die Standzeit eines Meldungszettels, eine
 *     Ausblendanimation, die Zeitgrenze eines Minispiels —, wird nicht
 *     abgewartet, sondern übersprungen (`zeitVergehenLassen`). Ein Fehler, der
 *     nur in dieser Frist steckt, bleibt unentdeckt.
 *   • DAUERLAST. Jeder Bildschirm wird zweimal aufgebaut, nicht zweitausendmal.
 *     Speicherlecks in der Oberfläche findet dieses Skript nicht.
 *   • DIE MATCH-ENGINE. Der Anpfiff wird gedrückt und das Ergebnis verbucht,
 *     aber ob es ein plausibles Ergebnis ist, entscheidet tools/test-match.js.
 *     Hier zählt nur, dass der Bildschirm dabei nicht auseinanderfällt.
 *
 * Wer wissen will, ob die Oberfläche AUSSIEHT wie gedacht, braucht einen
 * echten Browser. Den will dieses Projekt zu Recht nicht in tools/ haben
 * (CONTRACTS.md §0: keine Abhängigkeiten, kein Build-Schritt). Dieses Skript
 * ersetzt ihn nicht — es kommt ihm nur so nahe, wie man ohne ihn kommt.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const src = (p) => pathToFileURL(resolve(WURZEL, 'src', p)).href;

/* ══════════════════════════════════════════════════════════════════════════ *
 *
 *  TEIL 1 — DIE DOM-ATTRAPPE
 *
 *  Nur so viel Browser, wie TRAUMVEREIN wirklich anfasst. Keine Abhängigkeit,
 *  keine Zeile, die nicht von einem echten Aufruf im Projekt verlangt wird.
 *  Wer hier etwas ergänzt, sollte im Kommentar dazuschreiben, wer es braucht —
 *  sonst wächst die Attrappe zu einem halben Browser heran, und dann ist es
 *  günstiger, einen ganzen zu benutzen.
 *
 * ══════════════════════════════════════════════════════════════════════════ */

/** Gemeinsames Merkheft der Attrappe: Fehler, Bildwarteschlange, Uhr. */
const attrappe = {
  fehler: [],        // was in einem Ereignis- oder Bildaufruf geworfen hat
  bilder: [],        // requestAnimationFrame-Warteschlange
  zeit: 0            // künstliche Uhr in Millisekunden
};

/* ------------------------------------------------------------------ *
 *  1.1  Selektoren
 *
 *  Ein kleiner Selektor: Tag, Klasse, Id, Attribut, :not(), und die
 *  Nachfahrenkombination (Leerzeichen). Das deckt alles ab, was das Projekt
 *  benutzt. Nicht unterstützt sind >, +, ~ und Pseudoklassen mit Zustand
 *  (:hover, :nth-child) — sie werden weggeworfen statt falsch beantwortet.
 * ------------------------------------------------------------------ */

const selektorCache = new Map();

function selektorLesen(sel) {
  const fertig = selektorCache.get(sel);
  if (fertig) return fertig;

  const ketten = String(sel).split(',').map(s => s.trim()).filter(Boolean).map(teil => {
    // Eine Kette: „.tv-panel button" → [ {.tv-panel}, {button} ]
    return teil.split(/\s+/).filter(Boolean).map(glied => {
      const m = { tag: null, klassen: [], id: null, attrs: [], nicht: [] };
      let rest = glied;
      rest = rest.replace(/:not\(([^)]*)\)/g, (_, innen) => { m.nicht.push(innen); return ''; });
      rest = rest.replace(/:[a-z-]+(\([^)]*\))?/gi, '');          // Zustands-Pseudoklassen: raus
      rest = rest.replace(/\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]/g, (_, k, v) => {
        m.attrs.push([k.trim().toLowerCase(), v === undefined ? null : v]);
        return '';
      });
      for (const t of rest.match(/([.#]?[^.#]+)/g) || []) {
        if (t.startsWith('.')) m.klassen.push(t.slice(1));
        else if (t.startsWith('#')) m.id = t.slice(1);
        else if (t) m.tag = t.toLowerCase();
      }
      return m;
    });
  });

  selektorCache.set(sel, ketten);
  return ketten;
}

/** Passt ein einzelnes Glied auf diesen Knoten? */
function passtGlied(knoten, m) {
  if (knoten.nodeType !== 1) return false;
  if (m.tag && m.tag !== '*' && knoten.localName !== m.tag) return false;
  if (m.id && knoten.id !== m.id) return false;
  for (const k of m.klassen) if (!knoten.classList.contains(k)) return false;
  for (const [k, v] of m.attrs) {
    if (!knoten.hasAttribute(k)) return false;
    if (v !== null && knoten.getAttribute(k) !== v) return false;
  }
  for (const n of m.nicht) if (passt(knoten, selektorLesen(n))) return false;
  return true;
}

/** Passt eine der Ketten auf diesen Knoten? Von hinten nach vorn gelesen. */
function passt(knoten, ketten) {
  for (const kette of ketten) {
    if (!passtGlied(knoten, kette[kette.length - 1])) continue;
    let ok = true;
    let cur = knoten.parentNode;
    for (let i = kette.length - 2; i >= 0; i--) {
      let gefunden = false;
      while (cur && cur.nodeType === 1) {
        if (passtGlied(cur, kette[i])) { gefunden = true; cur = cur.parentNode; break; }
        cur = cur.parentNode;
      }
      if (!gefunden) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function* nachfahren(wurzel) {
  for (const k of wurzel.childNodes) {
    if (k.nodeType !== 1) continue;
    yield k;
    yield* nachfahren(k);
  }
}

function sucheEins(wurzel, sel) {
  const ketten = selektorLesen(sel);
  for (const n of nachfahren(wurzel)) if (passt(n, ketten)) return n;
  return null;
}

function sucheAlle(wurzel, sel) {
  const ketten = selektorLesen(sel);
  const treffer = [];
  for (const n of nachfahren(wurzel)) if (passt(n, ketten)) treffer.push(n);
  // NodeList-Anmutung: Der Rest ist ohnehin ein Array, das reicht dem Projekt.
  treffer.item = (i) => treffer[i] || null;
  return treffer;
}

/* ------------------------------------------------------------------ *
 *  1.2  Ereignisse
 *
 *  Ein Ereignis mit Erfassungs- und Blasenphase, weil render/ui.js beides
 *  benutzt: die Dialogtasten hängen mit `capture:true` am Dokument, alles
 *  andere blubbert.
 * ------------------------------------------------------------------ */

class Ereignis {
  constructor(typ, init = {}) {
    this.type = typ;
    this.bubbles = init.bubbles !== false;
    this.cancelable = init.cancelable !== false;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.immediateStopped = false;
    this.target = null;
    this.currentTarget = null;
    this.shiftKey = false; this.ctrlKey = false; this.altKey = false; this.metaKey = false;
    Object.assign(this, init);
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
  stopImmediatePropagation() { this.propagationStopped = true; this.immediateStopped = true; }
  composedPath() { const p = []; let n = this.target; while (n) { p.push(n); n = n.parentNode; } return p; }
}

class EigenesEreignis extends Ereignis {
  constructor(typ, init = {}) { super(typ, init); this.detail = init.detail; }
}

/* ------------------------------------------------------------------ *
 *  1.3  Knoten
 * ------------------------------------------------------------------ */

/**
 * Kinder abhängen — und dabei ihre Elternzeiger löschen.
 *
 * Wer nur `childNodes.length = 0` setzt, lässt jedes weggeworfene Kind mit
 * einem Elternzeiger zurück. `isConnected` läuft diesen Zeiger hinauf und
 * antwortet dann „ja, ich hänge im Dokument" — für einen Knoten, den längst
 * niemand mehr sieht. render/ui.js verlässt sich an zwei Stellen auf diese
 * Antwort (Meldungsschacht, Fokusrückgabe eines Dialogs); eine Attrappe, die
 * hier lügt, verschiebt den Fehler in den Prüfstand statt ihn zu finden.
 */
function kinderRaeumen(knoten) {
  for (const k of knoten.childNodes) k.parentNode = null;
  knoten.childNodes.length = 0;
}

class Knoten {
  constructor(nodeType, nodeName) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.childNodes = [];
    this.parentNode = null;
    this.ownerDocument = null;
    this._hoerer = new Map();
  }

  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
  get childElementCount() { return this.children.length; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[i + 1] || null;
  }
  get previousSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[i - 1] || null;
  }
  get nextElementSibling() { let n = this.nextSibling; while (n && n.nodeType !== 1) n = n.nextSibling; return n; }
  get previousElementSibling() { let n = this.previousSibling; while (n && n.nodeType !== 1) n = n.previousSibling; return n; }

  appendChild(kind) {
    if (!kind) throw new TypeError('appendChild(null)');
    if (kind.nodeType === 11) {                       // DocumentFragment: auflösen
      for (const k of kind.childNodes.slice()) this.appendChild(k);
      kind.childNodes.length = 0;
      return kind;
    }
    if (kind.parentNode) kind.parentNode.removeChild(kind);
    kind.parentNode = this;
    kind.ownerDocument = this.ownerDocument;
    this.childNodes.push(kind);
    return kind;
  }
  append(...kinder) {
    for (const k of kinder) {
      if (k === null || k === undefined) continue;
      this.appendChild(k && k.nodeType ? k : dokument.createTextNode(String(k)));
    }
  }
  prepend(...kinder) {
    const erstes = this.firstChild;
    for (const k of kinder) this.insertBefore(k && k.nodeType ? k : dokument.createTextNode(String(k)), erstes);
  }
  removeChild(kind) {
    const i = this.childNodes.indexOf(kind);
    if (i < 0) throw new Error('removeChild: der Knoten ist kein Kind dieses Knotens');
    this.childNodes.splice(i, 1);
    kind.parentNode = null;
    return kind;
  }
  insertBefore(neu, bezug) {
    if (!bezug) return this.appendChild(neu);
    if (neu.nodeType === 11) {
      for (const k of neu.childNodes.slice()) this.insertBefore(k, bezug);
      neu.childNodes.length = 0;
      return neu;
    }
    if (neu.parentNode) neu.parentNode.removeChild(neu);
    const i = this.childNodes.indexOf(bezug);
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, neu);
    neu.parentNode = this;
    neu.ownerDocument = this.ownerDocument;
    return neu;
  }
  replaceChild(neu, alt) { this.insertBefore(neu, alt); this.removeChild(alt); return alt; }
  replaceChildren(...kinder) { kinderRaeumen(this); this.append(...kinder); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  cloneNode(tief) {
    if (this.nodeType === 3) return dokument.createTextNode(this.data);
    const k = dokument.createElement(this.localName);
    for (const [a, v] of this._attrs) k.setAttribute(a, v);
    if (tief) for (const c of this.childNodes) k.appendChild(c.cloneNode(true));
    return k;
  }

  addEventListener(typ, fn, opts) {
    if (typeof fn !== 'function' && !(fn && typeof fn.handleEvent === 'function')) return;
    const erfassen = !!(opts === true || (opts && opts.capture));
    if (!this._hoerer.has(typ)) this._hoerer.set(typ, []);
    const liste = this._hoerer.get(typ);
    if (liste.some(l => l.fn === fn && l.erfassen === erfassen)) return;   // wie im Browser: Doppelte fallen weg
    liste.push({ fn, erfassen, einmal: !!(opts && opts.once) });
  }
  removeEventListener(typ, fn, opts) {
    const erfassen = !!(opts === true || (opts && opts.capture));
    const liste = this._hoerer.get(typ);
    if (!liste) return;
    const i = liste.findIndex(l => l.fn === fn && l.erfassen === erfassen);
    if (i >= 0) liste.splice(i, 1);
  }

  /**
   * Ruft die Zuhörer einer Phase. Ein Fehler in einem Zuhörer beendet hier
   * NICHT den Lauf — er wandert ins Merkheft. Sonst stünde der Prüfstand
   * beim ersten kaputten Knopf still, statt die übrigen achtzehn Bildschirme
   * auch noch anzusehen.
   */
  _rufen(ev, erfassen) {
    const liste = this._hoerer.get(ev.type);
    if (!liste) return;
    ev.currentTarget = this;
    for (const l of liste.slice()) {
      if (l.erfassen !== erfassen) continue;
      if (l.einmal) this.removeEventListener(ev.type, l.fn, l.erfassen);
      try {
        const r = typeof l.fn === 'function' ? l.fn.call(this, ev) : l.fn.handleEvent(ev);
        if (r && typeof r.catch === 'function') {
          r.catch(err => attrappe.fehler.push({ wo: `${ev.type} (nachgereicht)`, err }));
        }
      } catch (err) {
        attrappe.fehler.push({ wo: `Ereignis „${ev.type}"`, err });
      }
      if (ev.immediateStopped) return;
    }
  }

  dispatchEvent(ev) {
    ev.target = this;
    const pfad = [];
    let n = this.parentNode;
    while (n) { pfad.push(n); n = n.parentNode; }
    // `window` ist der äußerste Halt des Ereignisweges — nicht bloß ein
    // Namensraum. Die Minispiele aus interactive/ hängen ihre Tastatur dort
    // auf (`window.addEventListener('keydown', …)`); ohne diesen Schritt
    // erreicht sie kein einziger Anschlag, und ein geöffnetes Minispiel ließe
    // sich nie wieder schließen.
    pfad.push(fenster);
    for (let i = pfad.length - 1; i >= 0; i--) {          // Erfassung: von außen nach innen
      pfad[i]._rufen(ev, true);
      if (ev.propagationStopped) return !ev.defaultPrevented;
    }
    this._rufen(ev, true);
    this._rufen(ev, false);
    if (ev.propagationStopped) return !ev.defaultPrevented;
    if (ev.bubbles) {                                     // Blase: von innen nach außen
      for (const p of pfad) { p._rufen(ev, false); if (ev.propagationStopped) break; }
    }
    return !ev.defaultPrevented;
  }
}

class TextKnoten extends Knoten {
  constructor(daten) { super(3, '#text'); this.data = String(daten); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  get nodeValue() { return this.data; }
  set nodeValue(v) { this.data = String(v); }
}

class Fragment extends Knoten {
  constructor() { super(11, '#document-fragment'); }
  get textContent() { return this.childNodes.map(n => n.textContent || '').join(''); }
  querySelector(s) { return sucheEins(this, s); }
  querySelectorAll(s) { return sucheAlle(this, s); }
}

/* ------------------------------------------------------------------ *
 *  1.4  classList, style, dataset
 * ------------------------------------------------------------------ */

const kebab = (s) => s.replace(/([A-Z])/g, '-$1').toLowerCase();

/**
 * `style` als Proxy: `node.style.marginTop = 8` genauso wie
 * `node.style.setProperty('--tv-rot', '#c1272d')`. Gespeichert wird, gelesen
 * wird — gerechnet wird nichts. Wer hier eine Kaskade erwartet, siehe Dateikopf.
 */
function stilAttrappe() {
  const werte = new Map();
  const ziel = {
    setProperty(k, v) { werte.set(k, String(v)); },
    getPropertyValue(k) { return werte.get(k) ?? werte.get(kebab(k)) ?? ''; },
    removeProperty(k) { werte.delete(k); werte.delete(kebab(k)); },
    get cssText() { return [...werte].map(([k, v]) => `${k}:${v}`).join(';'); },
    set cssText(v) {
      for (const teil of String(v).split(';')) {
        const i = teil.indexOf(':');
        if (i > 0) werte.set(teil.slice(0, i).trim(), teil.slice(i + 1).trim());
      }
    },
    _werte: werte
  };
  return new Proxy(ziel, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p !== 'string') return undefined;
      return werte.get(kebab(p)) ?? '';
    },
    set(t, p, v) {
      if (p === 'cssText') { t.cssText = v; return true; }
      if (typeof p === 'string') werte.set(kebab(p), v === null || v === undefined ? '' : String(v));
      return true;
    },
    has(t, p) { return p in t || werte.has(kebab(String(p))); }
  });
}

class Klassenliste {
  constructor(el) { this._el = el; }
  get _liste() { return (this._el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  _setzen(l) { this._el.setAttribute('class', [...new Set(l)].join(' ')); }
  add(...n) { this._setzen(this._liste.concat(n.filter(Boolean))); }
  remove(...n) { this._setzen(this._liste.filter(c => !n.includes(c))); }
  contains(n) { return this._liste.includes(n); }
  toggle(n, erzwinge) {
    const soll = erzwinge === undefined ? !this.contains(n) : !!erzwinge;
    if (soll) this.add(n); else this.remove(n);
    return soll;
  }
  item(i) { return this._liste[i] || null; }
  get length() { return this._liste.length; }
  get value() { return this._liste.join(' '); }
  forEach(fn) { this._liste.forEach(fn); }
  [Symbol.iterator]() { return this._liste[Symbol.iterator](); }
}

/* ------------------------------------------------------------------ *
 *  1.5  Element
 * ------------------------------------------------------------------ */

class Element extends Knoten {
  constructor(tag, ns) {
    super(1, String(tag).toUpperCase());
    this.tagName = String(tag).toUpperCase();
    this.localName = String(tag).toLowerCase();
    this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml';
    this._attrs = new Map();
    this.style = stilAttrappe();
    this.classList = new Klassenliste(this);

    const selbst = this;
    this.dataset = new Proxy({}, {
      get: (t, p) => selbst._attrs.get('data-' + kebab(String(p))),
      set: (t, p, v) => { selbst._attrs.set('data-' + kebab(String(p)), String(v)); return true; },
      has: (t, p) => selbst._attrs.has('data-' + kebab(String(p))),
      deleteProperty: (t, p) => { selbst._attrs.delete('data-' + kebab(String(p))); return true; },
      ownKeys: () => [...selbst._attrs.keys()].filter(k => k.startsWith('data-'))
        .map(k => k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true, value: undefined })
    });

    // Erfundene Maße. Siehe Dateikopf: Dieses Skript misst nichts.
    this.scrollTop = 0; this.scrollLeft = 0;
    this.scrollHeight = 400; this.scrollWidth = 800;
    this.clientHeight = 400; this.clientWidth = 800;
    this.offsetHeight = 400; this.offsetWidth = 800;
    this.offsetTop = 0; this.offsetLeft = 0;
  }

  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', String(v)); }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', String(v)); }
  get title() { return this.getAttribute('title') || ''; }
  set title(v) { this.setAttribute('title', String(v)); }
  get tabIndex() { const t = this.getAttribute('tabindex'); return t === null ? -1 : Number(t); }
  set tabIndex(v) { this.setAttribute('tabindex', String(v)); }

  getAttribute(n) { const v = this._attrs.get(String(n).toLowerCase()); return v === undefined ? null : v; }
  setAttribute(n, v) { this._attrs.set(String(n).toLowerCase(), String(v)); }
  removeAttribute(n) { this._attrs.delete(String(n).toLowerCase()); }
  hasAttribute(n) { return this._attrs.has(String(n).toLowerCase()); }
  setAttributeNS(ns, n, v) { this.setAttribute(n, v); }
  getAttributeNS(ns, n) { return this.getAttribute(n); }
  get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }

  get textContent() {
    return this.childNodes.map(n => (n.nodeType === 3 ? n.data : n.textContent || '')).join('');
  }
  set textContent(v) {
    kinderRaeumen(this);
    if (v !== '' && v !== null && v !== undefined) this.appendChild(dokument.createTextNode(v));
  }

  get innerHTML() { return this.childNodes.map(schreibeHtml).join(''); }
  set innerHTML(v) {
    kinderRaeumen(this);
    const s = String(v);
    if (s) for (const k of leseHtml(s)) this.appendChild(k);
  }
  get outerHTML() { return schreibeHtml(this); }

  querySelector(s) { return sucheEins(this, s); }
  querySelectorAll(s) { return sucheAlle(this, s); }
  getElementsByClassName(c) { return sucheAlle(this, '.' + c); }
  getElementsByTagName(t) { return sucheAlle(this, t); }
  matches(s) { return passt(this, selektorLesen(s)); }
  closest(s) {
    const ketten = selektorLesen(s);
    let n = this;
    while (n && n.nodeType === 1) { if (passt(n, ketten)) return n; n = n.parentNode; }
    return null;
  }

  focus() { dokument.activeElement = this; this.dispatchEvent(new Ereignis('focus', { bubbles: false })); }
  blur() { if (dokument.activeElement === this) dokument.activeElement = dokument.body; }
  click() { this.dispatchEvent(new Ereignis('click', { bubbles: true, cancelable: true })); }

  scrollIntoView() { }
  scrollTo() { }
  scrollBy() { }
  animate() { return { cancel() { }, finish() { }, addEventListener() { }, finished: Promise.resolve() }; }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 400, width: 800, height: 400 }; }
  getClientRects() { return [this.getBoundingClientRect()]; }
  setPointerCapture() { } releasePointerCapture() { } hasPointerCapture() { return false; }

  insertAdjacentElement(pos, knoten) {
    if (pos === 'beforeend') this.appendChild(knoten);
    else if (pos === 'afterbegin') this.insertBefore(knoten, this.firstChild);
    else if (pos === 'beforebegin' && this.parentNode) this.parentNode.insertBefore(knoten, this);
    else if (pos === 'afterend' && this.parentNode) this.parentNode.insertBefore(knoten, this.nextSibling);
    return knoten;
  }

  get isContentEditable() { return this.getAttribute('contenteditable') === 'true'; }
  get offsetParent() { return this.parentElement; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === dokument; }
}

/**
 * Eingabefelder. `value`, `checked` und `disabled` sind Eigenschaften (so setzt
 * render/ui.js sie über DIRECT_PROPS), `type`, `min`, `max` und `step` liegen
 * als Attribute und werden hier als Eigenschaft nachgereicht — der Durchlauf
 * unten liest `e.type` und `e.min`, um einen Schieberegler von einem
 * Kontrollkästchen zu unterscheiden.
 */
class EingabeElement extends Element {
  constructor(tag) {
    super(tag);
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.indeterminate = false;
    this.files = [];
  }
  get type() { return this.getAttribute('type') || (this.localName === 'input' ? 'text' : this.localName); }
  set type(v) { this.setAttribute('type', v); }
  get min() { return this.getAttribute('min'); }
  get max() { return this.getAttribute('max'); }
  get step() { return this.getAttribute('step'); }
  get name() { return this.getAttribute('name') || ''; }
  get placeholder() { return this.getAttribute('placeholder') || ''; }
  select() { }
  setSelectionRange() { }
}

class OptionElement extends Element {
  constructor() { super('option'); this.selected = false; this.disabled = false; }
  get value() { return this.hasAttribute('value') ? this.getAttribute('value') : this.textContent; }
  set value(v) { this.setAttribute('value', v); }
  get label() { return this.getAttribute('label') || this.textContent; }
}

/**
 * Auswahlfeld. Wichtig für den Durchlauf: Wer `selectedIndex = 1` setzt, muss
 * anschließend über `select.value` den Wert dieser Option lesen können — sonst
 * bekommt der onchange-Zuhörer des Bildschirms den alten Wert und die Prüfung
 * geht am eigentlichen Verhalten vorbei.
 */
class AuswahlElement extends Element {
  constructor() { super('select'); this.disabled = false; }
  get options() { return this.querySelectorAll('option'); }
  get selectedIndex() {
    const o = this.options;
    const i = o.findIndex(x => x.selected);
    return i >= 0 ? i : (o.length ? 0 : -1);
  }
  set selectedIndex(i) {
    const o = this.options;
    o.forEach((x, j) => { x.selected = j === Number(i); });
  }
  get value() {
    const o = this.options;
    const gewaehlt = o.find(x => x.selected) || o[0];
    return gewaehlt ? gewaehlt.value : '';
  }
  set value(v) {
    const o = this.options;
    let getroffen = false;
    for (const x of o) { x.selected = !getroffen && String(x.value) === String(v); if (x.selected) getroffen = true; }
    if (!getroffen && o.length) o[0].selected = true;
  }
  get length() { return this.options.length; }
}

/* ------------------------------------------------------------------ *
 *  1.6  Canvas — wirkungslos, aber vollzählig
 *
 *  Jede Methode kehrt sofort zurück, jede Eigenschaft lässt sich setzen und
 *  lesen. Damit läuft render/pitch.js, render/portraits.js und render/kits.js
 *  durch, ohne dass ein Bild entsteht. Das ist Absicht: Geprüft wird, ob das
 *  Zeichnen wirft — nicht, was es zeichnet (siehe Dateikopf).
 * ------------------------------------------------------------------ */

const CTX_METHODEN = [
  'save', 'restore', 'scale', 'rotate', 'translate', 'transform', 'setTransform', 'resetTransform',
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
  'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect',
  'fill', 'stroke', 'clip', 'drawImage', 'fillText', 'strokeText', 'setLineDash',
  'putImageData', 'drawFocusIfNeeded', 'reset'
];

class Kontext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000'; this.strokeStyle = '#000';
    this.lineWidth = 1; this.lineCap = 'butt'; this.lineJoin = 'miter'; this.miterLimit = 10;
    this.globalAlpha = 1; this.globalCompositeOperation = 'source-over';
    this.font = '10px sans-serif'; this.textAlign = 'start'; this.textBaseline = 'alphabetic';
    this.imageSmoothingEnabled = true; this.imageSmoothingQuality = 'low';
    this.letterSpacing = '0px'; this.wordSpacing = '0px'; this.filter = 'none';
    this.shadowBlur = 0; this.shadowColor = 'transparent';
    this.shadowOffsetX = 0; this.shadowOffsetY = 0;
    this.lineDashOffset = 0;
    for (const m of CTX_METHODEN) this[m] = () => { };
  }
  getLineDash() { return []; }
  isPointInPath() { return false; }
  isPointInStroke() { return false; }
  /** Sechs Pixel je Zeichen — genug, damit Umbruchrechnungen im Code nicht durch null teilen. */
  measureText(t) {
    const b = String(t).length * 6;
    return {
      width: b,
      actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2,
      actualBoundingBoxLeft: 0, actualBoundingBoxRight: b,
      fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3,
      emHeightAscent: 8, emHeightDescent: 2
    };
  }
  createLinearGradient() { return { addColorStop() { } }; }
  createRadialGradient() { return { addColorStop() { } }; }
  createConicGradient() { return { addColorStop() { } }; }
  createPattern() { return { setTransform() { } }; }
  createImageData(w, h) {
    const W = Math.max(1, w | 0), H = Math.max(1, h | 0);
    return { width: W, height: H, data: new Uint8ClampedArray(W * H * 4), colorSpace: 'srgb' };
  }
  getImageData(x, y, w, h) { return this.createImageData(w, h); }
  getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
}

class LeinwandElement extends Element {
  constructor() { super('canvas'); this.width = 300; this.height = 150; this._ctx = null; }
  getContext(art) {
    if (art !== '2d') return null;
    if (!this._ctx) this._ctx = new Kontext2D(this);
    return this._ctx;
  }
  toDataURL() { return 'data:image/png;base64,'; }
  toBlob(rueckruf) { if (rueckruf) rueckruf(null); }
}

/* ------------------------------------------------------------------ *
 *  1.7  Ein sehr kleiner HTML-Leser
 *
 *  Gebraucht wird er von `innerHTML = ...` — im Projekt fast nur für die
 *  Inline-SVG-Symbole aus render/ui.js und ein paar kurze Textbausteine.
 *  Er kann Tags, Attribute, selbstschließende Elemente und Text. Mehr nicht,
 *  und mehr soll er auch nicht können.
 * ------------------------------------------------------------------ */

const LEERE_TAGS = /^(br|hr|img|input|meta|link|source|path|circle|rect|line|polygon|polyline|ellipse|use|stop|area|col)$/i;

function leseHtml(html) {
  const wurzel = [];
  const stapel = [];
  const anhaengen = (n) => { if (stapel.length) stapel[stapel.length - 1].appendChild(n); else wurzel.push(n); };
  const re = /<\/?([A-Za-z][\w:-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {                       // Text
      if (m[4].trim()) anhaengen(new TextKnoten(entzeichne(m[4])));
      continue;
    }
    const tag = m[1];
    if (m[0].startsWith('</')) { if (stapel.length) stapel.pop(); continue; }
    const e = dokument.createElement(tag);
    const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = attrRe.exec(m[2] || ''))) e.setAttribute(a[1], entzeichne(a[2] ?? a[3] ?? a[4] ?? ''));
    anhaengen(e);
    if (!m[3] && !LEERE_TAGS.test(tag)) stapel.push(e);
  }
  return wurzel;
}

const entzeichne = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const zeichne = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function schreibeHtml(n) {
  if (n.nodeType === 3) return zeichne(n.data);
  if (n.nodeType === 8) return `<!--${n.data}-->`;
  if (n.nodeType === 11) return n.childNodes.map(schreibeHtml).join('');
  const attrs = [...n._attrs].map(([k, v]) => ` ${k}="${zeichne(v)}"`).join('');
  const innen = n.childNodes.map(schreibeHtml).join('');
  return LEERE_TAGS.test(n.localName) ? `<${n.localName}${attrs}>` : `<${n.localName}${attrs}>${innen}</${n.localName}>`;
}

class VorlageElement extends Element {
  constructor() { super('template'); this.content = new Fragment(); }
  get innerHTML() { return this.content.childNodes.map(schreibeHtml).join(''); }
  set innerHTML(v) {
    kinderRaeumen(this.content);
    for (const k of leseHtml(String(v))) this.content.appendChild(k);
  }
}

/* ------------------------------------------------------------------ *
 *  1.8  Das Dokument
 * ------------------------------------------------------------------ */

class Dokument extends Knoten {
  constructor() {
    super(9, '#document');
    this.ownerDocument = this;
    this.documentElement = new Element('html');
    this.head = new Element('head');
    this.body = new Element('body');
    for (const e of [this.documentElement, this.head, this.body]) e.ownerDocument = this;
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
    this.scrollingElement = this.documentElement;
    this.hidden = false;
    this.visibilityState = 'visible';
    this.readyState = 'complete';
    this.title = 'TRAUMVEREIN';
  }

  createElement(tag) {
    const t = String(tag).toLowerCase();
    let e;
    if (t === 'canvas') e = new LeinwandElement();
    else if (t === 'template') e = new VorlageElement();
    else if (t === 'select') e = new AuswahlElement();
    else if (t === 'option') e = new OptionElement();
    else if (t === 'input' || t === 'textarea') e = new EingabeElement(t);
    else e = new Element(t);
    e.ownerDocument = this;
    if (t === 'button') e.disabled = false;
    if (t === 'a') { e.href = ''; e.download = ''; }
    return e;
  }
  createElementNS(ns, tag) { const e = this.createElement(tag); e.namespaceURI = ns; return e; }
  createTextNode(t) { const n = new TextKnoten(t); n.ownerDocument = this; return n; }
  createDocumentFragment() { const f = new Fragment(); f.ownerDocument = this; return f; }
  createComment(t) { const n = new TextKnoten(''); n.nodeType = 8; n.data = String(t); return n; }

  querySelector(s) { return sucheEins(this, s); }
  querySelectorAll(s) { return sucheAlle(this, s); }
  getElementById(id) { return sucheEins(this, '#' + id); }
  getElementsByClassName(c) { return sucheAlle(this, '.' + c); }
  getElementsByTagName(t) { return sucheAlle(this, t); }
  elementFromPoint() { return null; }
  execCommand() { return false; }
}

const dokument = new Dokument();

/* ------------------------------------------------------------------ *
 *  1.9  localStorage, IndexedDB, Beobachter
 *
 *  core/state.js legt das kleine Spielstandverzeichnis in localStorage und die
 *  großen Spielstände in IndexedDB. Beides gibt es hier — im Arbeitsspeicher,
 *  ohne Datei, ohne Rest nach dem Lauf.
 * ------------------------------------------------------------------ */

class SpeicherAttrappe {
  constructor() { this._m = new Map(); }
  getItem(k) { return this._m.has(String(k)) ? this._m.get(String(k)) : null; }
  setItem(k, v) { this._m.set(String(k), String(v)); }
  removeItem(k) { this._m.delete(String(k)); }
  clear() { this._m.clear(); }
  key(i) { return [...this._m.keys()][i] || null; }
  get length() { return this._m.size; }
}

class BeobachterAttrappe {
  constructor(rueckruf) { this._cb = rueckruf; }
  observe() { } unobserve() { } disconnect() { } takeRecords() { return []; }
}

/** Ein Mikrotask später — so verhält sich eine IndexedDB-Anfrage im Browser auch. */
const spaeter = (fn) => { Promise.resolve().then(fn); };

class IdbLager {
  constructor(daten) { this._d = daten; }
  _anfrage(wert) {
    const r = { result: wert, error: null, onsuccess: null, onerror: null };
    spaeter(() => r.onsuccess && r.onsuccess({ target: r }));
    return r;
  }
  // Mehr als diese drei benutzt core/state.js nicht — und mehr soll hier auch
  // nicht stehen, sonst wächst die Attrappe an Stellen, die niemand prüft.
  put(wert, schluessel) { this._d.set(String(schluessel), wert); return this._anfrage(schluessel); }
  get(schluessel) { return this._anfrage(this._d.get(String(schluessel))); }
  delete(schluessel) { this._d.delete(String(schluessel)); return this._anfrage(undefined); }
}

class IdbDatenbank {
  constructor() { this._lager = new Map(); }
  get objectStoreNames() {
    const namen = [...this._lager.keys()];
    namen.contains = (s) => namen.includes(s);
    return namen;
  }
  createObjectStore(name) {
    if (!this._lager.has(name)) this._lager.set(name, new Map());
    return new IdbLager(this._lager.get(name));
  }
  transaction(name) {
    const tx = { error: null, oncomplete: null, onerror: null, onabort: null, abort() { } };
    tx.objectStore = (n) => new IdbLager(this._lager.get(Array.isArray(n) ? n[0] : n) || new Map());
    // Drei Mikrotasks später als die Lageranfragen: erst das Ergebnis, dann
    // `complete`. Andersherum liefe core/state.js:dbTx() ins Leere.
    spaeter(() => spaeter(() => spaeter(() => tx.oncomplete && tx.oncomplete())));
    return tx;
  }
  close() { }
}

const idbBestand = new Map();

const indexedDBAttrappe = {
  open(name) {
    const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    const neu = !idbBestand.has(name);
    if (neu) idbBestand.set(name, new IdbDatenbank());
    req.result = idbBestand.get(name);
    spaeter(() => {
      if (neu && req.onupgradeneeded) req.onupgradeneeded({ target: req });
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  },
  deleteDatabase(name) {
    idbBestand.delete(name);
    const r = { onsuccess: null };
    spaeter(() => r.onsuccess && r.onsuccess());
    return r;
  }
};

/* ------------------------------------------------------------------ *
 *  1.10  Das Fenster
 * ------------------------------------------------------------------ */

const fenster = {
  document: dokument,
  innerWidth: 1440, innerHeight: 900, outerWidth: 1440, outerHeight: 900,
  devicePixelRatio: 1, scrollX: 0, scrollY: 0, pageXOffset: 0, pageYOffset: 0,
  location: {
    href: 'http://localhost:8123/', origin: 'http://localhost:8123', protocol: 'http:',
    host: 'localhost:8123', hostname: 'localhost', port: '8123',
    pathname: '/', search: '', hash: '', reload() { }, assign() { }, replace() { }
  },
  navigator: {
    userAgent: 'traumverein-pruefstand', language: 'de-DE', languages: ['de-DE'],
    onLine: true, maxTouchPoints: 0, clipboard: { writeText: () => Promise.resolve() }
  },
  _hoerer: new Map(),
  addEventListener: Knoten.prototype.addEventListener,
  removeEventListener: Knoten.prototype.removeEventListener,
  _rufen: Knoten.prototype._rufen,
  dispatchEvent(ev) { ev.target = this; this._rufen(ev, true); this._rufen(ev, false); return !ev.defaultPrevented; },
  getComputedStyle() {
    // Leer, und zwar bewusst leer: Ein erfundener Rückgabewert wäre schlimmer
    // als gar keiner, weil er wie eine Messung aussähe. Siehe Dateikopf.
    return new Proxy({ getPropertyValue: () => '', length: 0 }, { get: (t, p) => (p in t ? t[p] : '') });
  },
  matchMedia(q) {
    return { matches: false, media: q, onchange: null, addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } };
  },
  scrollTo() { }, scrollBy() { }, focus() { }, blur() { }, close() { },
  alert() { }, confirm: () => true, prompt: () => null, open: () => null,
  requestAnimationFrame(fn) { attrappe.bilder.push(fn); return attrappe.bilder.length; },
  cancelAnimationFrame(id) { if (id >= 1 && id <= attrappe.bilder.length) attrappe.bilder[id - 1] = null; },
  performance: { now: () => attrappe.zeit, timeOrigin: 0, mark() { }, measure() { } },
  localStorage: new SpeicherAttrappe(),
  sessionStorage: new SpeicherAttrappe(),
  ResizeObserver: BeobachterAttrappe,
  MutationObserver: BeobachterAttrappe,
  IntersectionObserver: BeobachterAttrappe,
  indexedDB: indexedDBAttrappe,
  CSS: { supports: () => false, escape: (s) => String(s) }
};
fenster.window = fenster; fenster.self = fenster; fenster.top = fenster; fenster.parent = fenster;

/**
 * Hängt die Attrappe in die globalen Bezeichner. Muss laufen, BEVOR das erste
 * Projektmodul geladen wird — render/ui.js prüft `typeof document`.
 *
 * Bewusst NICHT gesetzt: `Blob`, `URL`, `performance`, `structuredClone`. Die
 * bringt Node selbst mit, und zwar richtig; eine Attrappe daneben wäre nur eine
 * zweite Wahrheit.
 */
function installiereDom() {
  const g = globalThis;
  g.window = fenster;
  g.document = dokument;
  try { g.navigator = fenster.navigator; } catch (e) { fenster.navigator = g.navigator; }

  g.Node = Knoten;
  g.Element = Element;
  g.HTMLElement = Element;
  g.HTMLCanvasElement = LeinwandElement;
  g.HTMLInputElement = EingabeElement;
  g.HTMLSelectElement = AuswahlElement;
  g.Text = TextKnoten;
  g.DocumentFragment = Fragment;

  g.Event = Ereignis;
  g.CustomEvent = EigenesEreignis;
  g.MouseEvent = Ereignis; g.PointerEvent = Ereignis; g.KeyboardEvent = Ereignis;
  g.TouchEvent = Ereignis; g.WheelEvent = Ereignis; g.FocusEvent = Ereignis; g.InputEvent = Ereignis;

  g.localStorage = fenster.localStorage;
  g.sessionStorage = fenster.sessionStorage;
  g.indexedDB = indexedDBAttrappe;
  g.ResizeObserver = BeobachterAttrappe;
  g.MutationObserver = BeobachterAttrappe;
  g.IntersectionObserver = BeobachterAttrappe;
  g.getComputedStyle = fenster.getComputedStyle;
  g.matchMedia = fenster.matchMedia;
  g.requestAnimationFrame = fenster.requestAnimationFrame;
  g.cancelAnimationFrame = fenster.cancelAnimationFrame;
  g.CSS = fenster.CSS;
  g.devicePixelRatio = 1;
}

/* ------------------------------------------------------------------ *
 *  1.11  Handgriffe für den Durchlauf
 * ------------------------------------------------------------------ */

/** Treibt die Animationsbilder an. Ohne diesen Aufruf steht jede Animation. */
function laufeBilder(runden = 2, dt = 16) {
  for (let i = 0; i < runden; i++) {
    const q = attrappe.bilder;
    attrappe.bilder = [];
    attrappe.zeit += dt;
    for (const fn of q) {
      if (!fn) continue;
      try { fn(attrappe.zeit); }
      catch (err) { attrappe.fehler.push({ wo: 'requestAnimationFrame', err }); }
    }
  }
}

const ZEIGER = {
  bubbles: true, cancelable: true, button: 0, buttons: 1,
  clientX: 40, clientY: 40, offsetX: 40, offsetY: 40,
  pointerId: 1, pointerType: 'mouse', isPrimary: true
};

/** Ein vollständiger Mausklick — so, wie ihn ein Browser schickt. */
function klick(knoten, extra = {}) {
  for (const typ of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    knoten.dispatchEvent(new Ereignis(typ, { ...ZEIGER, ...extra }));
  }
}

/** Ein Tastendruck. Ohne Ziel geht er an den Körper und blubbert zum Dokument. */
function taste(key, ziel, extra = {}) {
  const n = ziel || dokument.body;
  const ev = new Ereignis('keydown', {
    bubbles: true, cancelable: true, key,
    code: key.length === 1 ? 'Key' + key.toUpperCase() : key,
    ...extra
  });
  n.dispatchEvent(ev);
  return ev;
}

/* ══════════════════════════════════════════════════════════════════════════ *
 *
 *  TEIL 2 — DER DURCHLAUF
 *
 * ══════════════════════════════════════════════════════════════════════════ */

installiereDom();

/* ------------------------------------------------------------------ *
 *  2.1  Aufrufparameter
 * ------------------------------------------------------------------ */

const argumente = process.argv.slice(2);
const LAUT = argumente.includes('--laut') || argumente.includes('-l');
const SCHNELL = argumente.includes('--schnell');
const saisonArg = argumente.find(a => a.startsWith('--saisons='));
const SAISONS = SCHNELL ? 0 : (saisonArg ? Math.max(0, parseInt(saisonArg.split('=')[1], 10) || 0) : 3);

/** Obergrenzen, damit ein einzelner Bildschirm den Lauf nicht auffrisst. */
const GRENZE_ELEMENTE = 500;      // Bedienelemente je Bildschirm
const GRENZE_RUNDEN = 30;         // Suchrunden je Bildschirm (nach jedem Klick kann Neues erscheinen)
const GRENZE_MS = 20000;          // Wanduhr je Bildschirm

/* ------------------------------------------------------------------ *
 *  2.2  Ausgabe im Stil der übrigen Prüfskripte
 * ------------------------------------------------------------------ */

const echteAusgabe = console.log.bind(console);
const fehler = [];      // harte Befunde → Exit-Code 1
const hinweise = [];    // weiche Befunde → nur Bericht

/** Meldungen des Spiels, während der Prüfstand läuft. */
const meldungen = { log: [], warn: [], error: [] };
let wo = 'Start';       // wo im Durchlauf sind wir gerade? Für die Zuordnung von console.error
let stille = false;

console.log = (...a) => { if (stille) meldungen.log.push({ wo, text: kurz(a) }); else echteAusgabe(...a); };
console.warn = (...a) => { meldungen.warn.push({ wo, text: kurz(a) }); };
console.error = (...a) => { meldungen.error.push({ wo, text: kurz(a) }); };
console.info = console.log;
console.debug = () => { };

process.on('unhandledRejection', (r) => {
  meldungen.error.push({ wo, text: 'Nicht abgefangenes Versprechen: ' + kurz([r]) });
});

function kurz(argumente) {
  return argumente
    .map(x => (x && x.stack) ? String(x.stack).split('\n').slice(0, 3).map(z => z.replace(WURZEL + '/', '')).join(' | ') : String(x))
    .join(' ').replace(/\s+/g, ' ').replace(/file:\/\/\//g, '').slice(0, 260);
}

const P = (...a) => echteAusgabe(...a);
function abschnitt(titel) { P('\n=== ' + titel + ' ==='); }
function unterpunkt(titel) { P('  ' + titel); }
function OK(text) { P('    [ok]   ' + text); }
function FEHL(text) { fehler.push(text); P('    [FEHL] ' + text); }
function HINW(text) { hinweise.push(text); P('    [hinw] ' + text); }
function pruefe(bedingung, text, ist) {
  if (bedingung) OK(text + (ist ? `  (${ist})` : ''));
  else FEHL(text + (ist ? `  -> ist: ${ist}` : ''));
  return !!bedingung;
}

/** Gleichlautende Meldungen zusammenfassen: [[text, anzahl], …], Reihenfolge bleibt. */
function buendeln(texte) {
  const zaehler = new Map();
  for (const t of texte) zaehler.set(t, (zaehler.get(t) || 0) + 1);
  return [...zaehler];
}

const fuellen = (t, b) => (t.length >= b ? t : t + ' '.repeat(b - t.length));
const sekunden = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' s';
const uhr = () => Number(process.hrtime.bigint()) / 1e6;

/* ------------------------------------------------------------------ *
 *  2.3  Kleine Handgriffe auf dem laufenden Spiel
 * ------------------------------------------------------------------ */

const txt = (n) => (n && n.textContent ? n.textContent.trim() : '');
const schlaf = (ms = 0) => new Promise(r => setTimeout(r, ms));

/** Ein paar Bilder laufen lassen und die Mikrotasks abarbeiten. */
async function ruhe(runden = 3) {
  for (let i = 0; i < runden; i++) { laufeBilder(2); await schlaf(0); }
}

const offeneDialoge = () => dokument.querySelectorAll('.tv-overlay:not(.tv-overlay--zu)');

/**
 * Die Zeit vergehen lassen — von Hand.
 *
 * Ein geschlossener Dialog trägt `.tv-overlay--zu` und wird 260 ms später aus
 * dem Dokument geräumt; ein Toast verschwindet nach 3,6 bis 6 Sekunden. Beide
 * Fristen laufen über setTimeout, und dieser Prüfstand lässt zwischen zwei
 * Klicks nur Mikrosekunden echter Zeit vergehen. Ohne diesen Handgriff bliebe
 * jede Überlagerung für immer stehen — und dann meldet main.js:tastatur() die
 * Escape-Taste an die Dialogschicht, statt sie durch die Kette laufen zu
 * lassen. Der erste Anlauf dieses Skripts hat genau daran alle achtzehn
 * Escape-Prüfungen verloren.
 *
 * Was hier von Hand entfernt wird, wäre im Browser von selbst weg. Was NICHT
 * entfernt wird: eine Überlagerung, die noch offen ist — die gehört geschlossen
 * und nicht weggeräumt.
 */
function zeitVergehenLassen() {
  for (const o of dokument.querySelectorAll('.tv-overlay--zu')) o.remove();
  for (const t of dokument.querySelectorAll('.tv-toast')) t.remove();
  for (const t of dokument.querySelectorAll('.tv-tooltip--an')) t.classList.remove('tv-tooltip--an');
}

/**
 * Minispiele und der Höhepunkte-Abspieler des Spieltags legen sich als
 * `.tv-minispiel` über den ganzen Bildschirm. Beide versprechen dasselbe:
 * ESC gibt die Szene frei (CONTRACTS.md §9). Genau das wird hier benutzt —
 * und damit zugleich geprüft.
 *
 * Wichtig für alles, was danach kommt: Solange ein `.tv-minispiel` im
 * Dokument steht, sieht main.js:tastatur() KEINE Taste mehr. Ein liegen
 * gebliebenes Minispiel legt also die gesamte Tastatur still — die
 * Escape-Kette, alle zwanzig Reiter-Kürzel und Strg+S.
 */
const offeneMinispiele = () => dokument.querySelectorAll('.tv-minispiel');

let minispieleGesehen = 0;
let minispieleGewaltsam = 0;

async function minispieleWeg() {
  if (!offeneMinispiele().length) return;
  minispieleGesehen++;
  for (let i = 0; i < 12 && offeneMinispiele().length; i++) {
    taste('Escape');
    await ruhe(4);
  }
  const rest = offeneMinispiele();
  if (rest.length) {
    minispieleGewaltsam += rest.length;
    for (const o of rest) o.remove();
  }
}

/**
 * Schließt alles, was über dem Bildschirm liegt. Erst mit ESC (der echte Weg),
 * dann über den letzten Knopf des Dialogs, zuletzt mit Gewalt. Der Prüfstand
 * merkt sich, wie oft die Gewalt nötig war — ein Dialog, der sich weder mit
 * ESC noch mit einem seiner eigenen Knöpfe schließen lässt, ist ein Befund.
 */
let dialogeGewaltsam = 0;
async function dialogeWeg() {
  await minispieleWeg();
  for (let i = 0; i < 8 && offeneDialoge().length; i++) {
    taste('Escape');
    await ruhe(2);
    zeitVergehenLassen();
    const offen = offeneDialoge();
    if (!offen.length) break;
    const oberster = offen[offen.length - 1];
    const knoepfe = oberster.querySelectorAll('button');
    if (knoepfe.length) klick(knoepfe[knoepfe.length - 1]);
    else { oberster.remove(); dialogeGewaltsam++; }
    await ruhe(2);
  }
  const rest = offeneDialoge();
  if (rest.length) { dialogeGewaltsam += rest.length; for (const o of rest) o.remove(); }
  zeitVergehenLassen();
  await minispieleWeg();
}

/* ------------------------------------------------------------------ *
 *  2.4  Spielstand bauen
 *
 *  Kein Spielstand aus einer Datei: Der Prüfstand baut ihn selbst, damit er
 *  ohne Beiwerk im Verzeichnis steht und mit jeder Änderung an core/ von
 *  allein mitwandert. Gespielt wird wie in tools/test-saison.js — über
 *  advanceDay(), eigene Partien über simulateAiFixture(), nicht über die
 *  Match-Engine: Zweitausend Partien durch simulateMatch() wären zu langsam.
 * ------------------------------------------------------------------ */

const EIGENER_VEREIN = 'hsv';
const SEED = 4711;

/**
 * Die Einstellungen des Prüfstands weichen bewusst von der Vorgabe ab:
 * `interactive:false` und die Textdarstellung halten den Anpfiff auf dem
 * Spieltagsbildschirm kurz. Die Minispiele haben mit tools/check-all.js einen
 * eigenen Prüfstand; hier ginge es nur um die zwanzig Sekunden Zeitgrenze,
 * die jedes von ihnen mitbringt.
 */
const PRUEF_EINSTELLUNGEN = {
  matchView: 'text',
  interactive: false,
  speed: 4,
  animationen: false,
  bestaetigungen: true
};

async function spielstandBauen(saisons) {
  const St = await import(src('core/state.js'));
  const loop = await import(src('core/loop.js'));

  const state = St.createNewGame({
    clubId: EIGENER_VEREIN,
    managerName: 'Der Prüfstand',
    difficulty: 'profi',
    seed: SEED,
    settings: PRUEF_EINSTELLUNGEN
  });
  loop.aktualisiereTabellen(state);
  if (saisons <= 0) return state;

  for (let s = 0; s < saisons; s++) {
    for (let tag = 0; tag < 3000; tag++) {
      const res = await loop.advanceDay(state);
      if (res.stop === 'saisonende') break;
      if (res.stop === 'spieltag') {
        const fx = res.fixture;
        if (fx.freilos) { fx.played = true; }
        else {
          const ctx = loop.makeCtx(state);
          try { loop.applyResult(state, fx, loop.simulateAiFixture(state, fx, ctx), ctx); }
          catch (err) { fx.played = true; fx.result = { score: [0, 0], stats: null }; }
        }
      } else if (res.stop === 'entlassung') {
        // Ein Rauswurf beendet im Spiel die Karriere. Der Prüfstand braucht
        // aber drei volle Saisons — also weitermachen und den Vorfall melden.
        state.flags.entlassen = false;
        HINW(`Vorlauf: Der Vorstand hat in Saison ${state.date.season} entlassen — der Prüfstand spielt weiter.`);
      } else if (res.stop === 'post') {
        for (const m of state.inbox) if (!m.gelesen && m.day === state.date.day) m.gelesen = true;
      }
      loop.pokalWeiterlosen(state, loop.makeCtx(state));
    }
    await loop.saisonWechsel(state, loop.makeCtx(state));
  }

  // Bis zur nächsten eigenen Partie vorspulen — und dort stehen bleiben.
  //
  // Ohne diesen Schritt steht der Spielstand am Tag 0 einer frischen Saison,
  // und der Spieltagsbildschirm zeigt beide Male dasselbe: „Kein Spiel in
  // Sicht". Vorbericht, Aufstellung, Anpfiff und Nachbericht — der größte
  // Bildschirm des Spiels — bliebe ungeprüft. Die Partie wird bewusst NICHT
  // gespielt: Sie soll offen sein, wenn der Durchlauf sie erreicht.
  for (let tag = 0; tag < 90; tag++) {
    if (loop.offenesEigenesSpiel(state)) break;
    const res = await loop.advanceDay(state);
    if (res.stop === 'spieltag') break;
    if (res.stop === 'saisonende') break;
    if (res.stop === 'entlassung') state.flags.entlassen = false;
    if (res.stop === 'post') {
      for (const m of state.inbox) if (!m.gelesen && m.day === state.date.day) m.gelesen = true;
    }
    loop.pokalWeiterlosen(state, loop.makeCtx(state));
  }
  return state;
}

/* ------------------------------------------------------------------ *
 *  2.5  Den Spielrahmen hochfahren
 *
 *  Über den echten Weg: main.boot() zeigt den Startbildschirm, dort führt der
 *  Knopf „Spielstand laden" in einen Dialog, dort steht „Laden". Genau so
 *  startet ein Spieler nach der Mittagspause auch. Wer stattdessen eine
 *  interne Funktion anspränge, prüfte den Startbildschirm nie.
 * ------------------------------------------------------------------ */

let main = null;

async function rahmenHochfahren(state, marke) {
  wo = 'Start: ' + marke;
  const St = await import(src('core/state.js'));
  if (!main) main = await import(src('main.js'));

  await St.saveGame(state, 1, 'Prüfstand ' + marke);

  kinderRaeumen(dokument.body);
  const wurzel = dokument.createElement('div');
  wurzel.id = 'app';
  dokument.body.appendChild(wurzel);

  await main.boot(wurzel);
  await ruhe();

  const laden = dokument.querySelectorAll('button').find(b => txt(b).includes('Spielstand laden'));
  if (!laden) throw new Error('Der Startbildschirm zeigt keinen Knopf „Spielstand laden".');
  klick(laden);
  await ruhe(4);

  const dialog = offeneDialoge()[0];
  if (!dialog) throw new Error('Der Ladedialog ist nicht aufgegangen.');
  const ladeKnopf = dialog.querySelectorAll('button').find(b => txt(b) === 'Laden');
  if (!ladeKnopf) throw new Error('Im Ladedialog steht kein Knopf „Laden".');
  klick(ladeKnopf);

  for (let i = 0; i < 80 && !dokument.querySelector('.tv-inhalt'); i++) await ruhe(2);
  await dialogeWeg();
  if (!dokument.querySelector('.tv-inhalt')) throw new Error('Der Spielrahmen ist nicht entstanden.');
  return main.app.state;
}

/* ------------------------------------------------------------------ *
 *  2.6  Der Bildschirm-Durchlauf
 * ------------------------------------------------------------------ */

/**
 * Was gilt als Bedienelement?
 *
 * Alles, was ein Benutzer anfassen kann: Knöpfe, Eingaben, Auswahlfelder,
 * Klapptexte, sortierbare Tabellenköpfe, klickbare Tabellenzeilen und alles,
 * was sich per `tabindex` in die Tastaturreihenfolge gestellt hat.
 */
const STEUER = 'button, input, select, textarea, summary, th.tv-sortierbar, tr.tv-reihe-klickbar, [tabindex]';

/**
 * Erkennungsmarke eines Bedienelements. Zwei Elemente mit derselben Marke
 * gelten als dasselbe und werden nur einmal betätigt.
 *
 * Bei Tabellenzeilen und Optionen bleibt der Text bewusst außen vor: Eine
 * Kadertabelle hat dreißig gleichartige Zeilen, und der Zeilenklick ist beim
 * ersten Mal geprüft. Wer alle dreißig anklickt, prüft dreißigmal dasselbe
 * und braucht dafür die halbe Laufzeit.
 */
function marke(e) {
  const grund = `${e.tagName}|${e.className || ''}|${e.getAttribute('aria-label') || ''}|${e.type || ''}`;
  if (e.tagName === 'TR' || e.tagName === 'OPTION') return grund;
  return grund + '|' + txt(e).slice(0, 40);
}

function steuerListe(wurzel) {
  if (!wurzel) return [];
  return wurzel.querySelectorAll(STEUER);
}

/** Ein Element betätigen — je nach Art anders. */
async function betaetige(e) {
  const tag = e.localName;
  const typ = String(e.type || '').toLowerCase();

  if (tag === 'input' && (typ === 'range' || typ === 'number')) {
    const min = Number(e.min ?? 0), max = Number(e.max ?? 100);
    e.value = String(Math.round((min + max) / 2));
    e.dispatchEvent(new Ereignis('input', { bubbles: true }));
    e.dispatchEvent(new Ereignis('change', { bubbles: true }));
  } else if (tag === 'input' && (typ === 'checkbox' || typ === 'radio')) {
    e.checked = !e.checked;
    e.dispatchEvent(new Ereignis('change', { bubbles: true }));
  } else if (tag === 'input' && typ === 'color') {
    e.value = '#123456';
    e.dispatchEvent(new Ereignis('input', { bubbles: true }));
    e.dispatchEvent(new Ereignis('change', { bubbles: true }));
  } else if (tag === 'input' && typ === 'file') {
    // Ohne echten Dateidialog gibt es nichts auszuwählen. Der Rundlauf der
    // Dateiformate steht in tools/check-all.js, nicht hier.
  } else if (tag === 'input' || tag === 'textarea') {
    e.value = 'Prüf';
    e.dispatchEvent(new Ereignis('input', { bubbles: true }));
    e.dispatchEvent(new Ereignis('change', { bubbles: true }));
  } else if (tag === 'select') {
    if (e.options.length > 1) {
      e.selectedIndex = 1;
      e.dispatchEvent(new Ereignis('change', { bubbles: true }));
    }
  } else {
    klick(e);
  }
}

/**
 * „WEITER ▶" gehört dem Rahmen, nicht dem Bildschirm: Der Knopf schaltet Tage
 * vor, bis etwas passiert, wechselt dabei den Bildschirm und verschiebt den
 * Spielstand unter dem laufenden Durchlauf. Er wird an einer eigenen Stelle
 * geprüft (siehe „Der Weiter-Knopf" weiter unten), hier nicht.
 */
const UEBERSPRINGEN = /^WEITER/;

/** So lange darf ein Bildschirm nachhallen, bevor der Durchlauf weiterzieht. */
const NACHLAUF_MS = 8000;
/** So viele stille Runden gelten als „fertig". */
const NACHLAUF_RUHE = 25;

/**
 * Lässt austrudeln, was ein Klick angestoßen hat. Zählt, wie oft dabei noch
 * eine Überlagerung aufging — das ist die Zahl, die im Bericht beim richtigen
 * Bildschirm stehen soll.
 */
async function nachlauf() {
  const start = uhr();
  let still = 0, gefangen = 0;
  while (uhr() - start < NACHLAUF_MS && still < NACHLAUF_RUHE) {
    if (offeneDialoge().length || offeneMinispiele().length) {
      gefangen++;
      await dialogeWeg();
      still = 0;
    } else {
      still++;
    }
    await ruhe(2);
  }
  return { gefangen, ausgetrudelt: still >= NACHLAUF_RUHE };
}

async function begehe(id) {
  wo = id;
  const start = uhr();
  const fehlerVorher = attrappe.fehler.length;
  const meldungVorher = meldungen.error.length;

  await main.navigate(id);
  await ruhe(3);

  // Was hier schon steht, hat niemand auf DIESEM Bildschirm angefasst — es ist
  // vom vorigen übrig geblieben. Bei einer Minispiel-Bühne ist das schwerwiegend:
  // Sie deckt den ganzen Bildschirm ab und main.js:tastatur() nimmt keine Taste
  // mehr an, solange sie steht.
  if (offeneMinispiele().length) {
    FEHL(`${id}: Eine Minispiel-Bühne stand schon beim Aufbau da — sie stammt vom vorigen ` +
      `Bildschirm. Solange sie steht, ist die ganze Tastatur tot.`);
  } else if (offeneDialoge().length) {
    HINW(`${id}: Beim Aufbau war schon ein Dialog offen, ohne dass jemand etwas angefasst hat.`);
  }

  await dialogeWeg();

  const bericht = {
    id, betaetigt: 0, gesperrt: 0, dialoge: 0, minispiele: 0, reiter: 0,
    uebersprungen: 0, weggesprungen: 0, elemente: 0, knoten: 0, grenze: null
  };
  const gesehen = new Set();

  for (let runde = 0; runde < GRENZE_RUNDEN; runde++) {
    const liste = steuerListe(main.app.inhaltEl);
    let neues = false;

    for (const e of liste) {
      const m = marke(e);
      if (gesehen.has(m)) continue;
      gesehen.add(m);
      neues = true;

      if (bericht.betaetigt >= GRENZE_ELEMENTE) { bericht.grenze = 'Elementzahl'; break; }
      if (uhr() - start > GRENZE_MS) { bericht.grenze = 'Zeit'; break; }
      if (e.disabled) { bericht.gesperrt++; continue; }
      if (UEBERSPRINGEN.test(txt(e))) { bericht.uebersprungen++; continue; }

      if (e.classList.contains('tv-tab')) bericht.reiter++;
      try { await betaetige(e); bericht.betaetigt++; }
      catch (err) { meldungen.error.push({ wo: id, text: 'Beim Betätigen: ' + kurz([err]) }); }

      await ruhe(2);
      if (offeneDialoge().length || offeneMinispiele().length) {
        if (offeneDialoge().length) bericht.dialoge++;
        if (offeneMinispiele().length) bericht.minispiele++;
        await dialogeWeg();
      }

      // Ein Knopf, der woanders hinführt, ist kein Fehler — aber der Rest
      // dieses Bildschirms will trotzdem noch angefasst werden.
      if (main.app.aktuellerScreen !== id) {
        bericht.weggesprungen++;
        await main.navigate(id);
        await ruhe(2);
        await dialogeWeg();
        break;
      }
    }

    if (!neues || bericht.grenze) break;
  }

  // Nachlauf. Ein Klick kann etwas anstoßen, das den Bildschirm überlebt: Der
  // Anpfiff auf dem Spieltag lässt die Match-Engine los, und die meldet sich
  // Minuten später mit der nächsten Schlüsselszene zurück. Ohne diesen Nachlauf
  // taucht die Minispiel-Bühne auf dem nächsten Bildschirm auf und steht im
  // Bericht in der falschen Zeile.
  bericht.nachlauf = await nachlauf();

  bericht.elemente = gesehen.size;
  bericht.knoten = main.app.inhaltEl ? main.app.inhaltEl.querySelectorAll('*').length : 0;
  bericht.domFehler = attrappe.fehler.slice(fehlerVorher);
  bericht.meldungen = meldungen.error.slice(meldungVorher);
  bericht.dauer = uhr() - start;
  return bericht;
}

async function durchlauf(titel, screens) {
  abschnitt(titel);
  const berichte = [];
  for (const id of screens) {
    const b = await begehe(id);
    berichte.push(b);

    const kopf = '    ' + fuellen(b.id, 14) +
      fuellen(`${b.betaetigt}/${b.elemente} Bedienelemente`, 26) +
      fuellen(`${b.knoten} Knoten`, 13) +
      fuellen(b.reiter ? `${b.reiter} Reiter` : '', 10) +
      fuellen(`${b.dialoge} Dialoge`, 12) +
      fuellen(b.minispiele ? `${b.minispiele} Minispiele` : '', 14) +
      fuellen(sekunden(b.dauer), 9);
    const schlimm = b.domFehler.length + b.meldungen.length;
    P((schlimm ? '  ✖' : '  ✔') + kopf.slice(2));

    if (b.grenze) HINW(`${b.id}: Obergrenze erreicht (${b.grenze}) — nicht jedes Bedienelement wurde angefasst.`);
    if (b.knoten < 15) {
      HINW(`${b.id}: hinterlässt nur ${b.knoten} Knoten im Inhaltsbereich — das ist keine Seite, das ist eine Lücke.`);
    }
    if (b.nachlauf && !b.nachlauf.ausgetrudelt) {
      HINW(`${b.id}: hallte nach ${sekunden(NACHLAUF_MS)} noch nach (${b.nachlauf.gefangen} Überlagerungen im Nachlauf) — ` +
        `was hier noch läuft, läuft in den nächsten Bildschirm hinein.`);
    }
    if (!b.elemente) HINW(`${b.id}: kein einziges Bedienelement gefunden — ist der Bildschirm leer?`);
    // Ein kaputter Knopf, den der Durchlauf zwölfmal anfasst, ist ein Befund
    // und nicht zwölf. Gleichlautende Meldungen werden deshalb gezählt.
    for (const [text, n] of buendeln(b.domFehler.map(f => `${f.wo} hat geworfen — ${kurz([f.err])}`))) {
      FEHL(`${b.id}: ${text}${n > 1 ? `  (${n}×)` : ''}`);
    }
    for (const [text, n] of buendeln(b.meldungen.map(m => m.text))) {
      FEHL(`${b.id}: console.error — ${text}${n > 1 ? `  (${n}×)` : ''}`);
    }
  }
  return berichte;
}

/* ------------------------------------------------------------------ *
 *  2.7  Der Weiter-Knopf
 *
 *  Einmal, an einer Stelle, kontrolliert: Er ist der meistgedrückte Knopf des
 *  ganzen Spiels und wird im Durchlauf oben übersprungen, weil er den Boden
 *  unter den Füßen wegzieht.
 * ------------------------------------------------------------------ */

async function weiterKnopf() {
  unterpunkt('Der Weiter-Knopf im Rahmen');
  wo = 'weiter';
  await main.navigate('buero');
  await ruhe(3);

  const knopf = main.app.kopfEl.querySelectorAll('button').find(b => /WEITER/.test(txt(b)));
  if (!knopf) { FEHL('Die Kopfleiste zeigt keinen „WEITER"-Knopf.'); return; }

  const vorher = { tag: main.app.state.date.day, saison: main.app.state.date.season };
  const fehlerVorher = attrappe.fehler.length;
  const meldungVorher = meldungen.error.length;

  klick(knopf);
  for (let i = 0; i < 60 && main.app.state.date.day === vorher.tag && main.app.state.date.season === vorher.saison; i++) {
    await ruhe(3);
  }
  await dialogeWeg();

  const nachher = { tag: main.app.state.date.day, saison: main.app.state.date.season };
  pruefe(nachher.tag !== vorher.tag || nachher.saison !== vorher.saison,
    'Der Weiter-Knopf schaltet die Zeit vor',
    `Saison ${vorher.saison} Tag ${vorher.tag} → Saison ${nachher.saison} Tag ${nachher.tag}`);
  pruefe(!!main.app.aktuellerScreen, 'Nach dem Weiter-Knopf steht ein Bildschirm', main.app.aktuellerScreen);

  for (const f of attrappe.fehler.slice(fehlerVorher)) FEHL(`Weiter-Knopf: ${f.wo} hat geworfen — ${kurz([f.err])}`);
  for (const m of meldungen.error.slice(meldungVorher)) FEHL(`Weiter-Knopf: console.error — ${m.text}`);
}

/* ------------------------------------------------------------------ *
 *  2.8  Die Escape-Kette
 *
 *  CONTRACTS.md §12 beschreibt sie: Überlagerungen → screen.onEscape() →
 *  Fokus loslassen → zurück ins Büro. Zwei Regeln stehen dort ausdrücklich,
 *  beide an einem echten Fehler gelernt — und beide werden hier gemessen:
 *
 *    1. Wer die Taste verbraucht, muss sichtbar etwas tun. Sonst sperrt er
 *       den Benutzer ein: ESC führt dann nie mehr ins Büro.
 *    2. Dialoge behalten Vorrang. Solange ein .tv-overlay steht, sieht
 *       main.js die Taste gar nicht.
 * ------------------------------------------------------------------ */

const ESC_MAX = 3;   // so viele Anschläge darf der Rückweg ins Büro höchstens brauchen

async function escapeKette(screens) {
  abschnitt('Die Escape-Kette');
  unterpunkt('Aus jedem Bildschirm zurück ins Büro');

  const verbraucher = [];
  for (const id of screens) {
    wo = 'ESC: ' + id;
    await main.navigate(id);
    await ruhe(3);
    await dialogeWeg();
    dokument.activeElement = dokument.body;
    // Der Bildschirm steht seit ein paar Sekunden: Kurzhinweise und Meldungs-
    // zettel wären längst verschwunden. Sonst frisst Stufe 1 der Kette jeden
    // ersten Anschlag, und gemessen würde etwas anderes als gemeint.
    zeitVergehenLassen();

    const weg = [];
    for (let i = 0; i < ESC_MAX; i++) {
      taste('Escape');
      await ruhe(3);
      zeitVergehenLassen();
      weg.push(main.app.aktuellerScreen);
      if (main.app.aktuellerScreen === 'buero') break;
    }

    if (id === 'buero') {
      pruefe(weg.every(x => x === 'buero'), 'buero: ESC bleibt im Büro', weg.join(' → '));
      continue;
    }
    if (weg[0] === id) verbraucher.push(id);

    pruefe(weg[weg.length - 1] === 'buero',
      `${id}: ESC führt binnen ${ESC_MAX} Anschlägen ins Büro`,
      weg.join(' → ') || 'nichts passiert');
  }

  if (verbraucher.length) {
    // Kein Fehler an sich (screens/editor.js darf das, siehe CONTRACTS.md §12),
    // aber die Stelle, an der die Regel „nur true, wenn sichtbar etwas passiert"
    // bricht. Deshalb namentlich in den Bericht.
    HINW(`onEscape() verbraucht den ersten Anschlag frisch nach dem Aufbau bei: ${verbraucher.join(', ')} ` +
      `— erlaubt, wenn dabei sichtbar etwas zurückgesetzt wird (CONTRACTS.md §12).`);
  }

  const ui = await import(src('render/ui.js'));

  unterpunkt('Mit offenem Dialog');
  wo = 'ESC: Dialog';
  await main.navigate('kader'); await ruhe(3); await dialogeWeg();
  const p1 = ui.dialog('Prüfdialog', 'Bleibt der Bildschirm stehen?', [{ label: 'OK', value: 1 }]);
  p1.catch(() => { });
  await ruhe(3);
  const offenVorher = offeneDialoge().length;
  taste('Escape');
  await ruhe(4);
  pruefe(offenVorher === 1 && offeneDialoge().length === 0,
    'ESC schließt den offenen Dialog', `${offenVorher} offen → ${offeneDialoge().length} offen`);
  pruefe(main.app.aktuellerScreen === 'kader',
    'ESC mit Dialog wechselt nicht zusätzlich den Bildschirm', main.app.aktuellerScreen);
  await dialogeWeg();

  unterpunkt('Mit zwei gestapelten Dialogen');
  wo = 'ESC: Stapel';
  await main.navigate('kader'); await ruhe(3); await dialogeWeg();
  const p2 = ui.dialog('Unten', 'eins', [{ label: 'OK', value: 1 }]); p2.catch(() => { });
  await ruhe(2);
  const p3 = ui.dialog('Oben', 'zwei', [{ label: 'OK', value: 2 }]); p3.catch(() => { });
  await ruhe(2);
  const stapelVorher = offeneDialoge().length;
  taste('Escape');
  await ruhe(4);
  pruefe(stapelVorher === 2 && offeneDialoge().length === 1,
    'ESC schließt nur den obersten von zwei Dialogen', `${stapelVorher} → ${offeneDialoge().length}`);
  pruefe(main.app.aktuellerScreen === 'kader',
    'Der Bildschirm bleibt auch beim Dialogstapel stehen', main.app.aktuellerScreen);
  await dialogeWeg();

  unterpunkt('Unmittelbar nach dem Schließen eines Dialogs');
  wo = 'ESC: Nachwehen';
  await main.navigate('kader'); await ruhe(3); await dialogeWeg();
  const p4 = ui.dialog('Nachwehen', 'zu und gleich noch einmal ESC', [{ label: 'OK', value: 1 }]);
  p4.catch(() => { });
  await ruhe(3);
  taste('Escape');            // schließt den Dialog — er trägt jetzt .tv-overlay--zu
  await ruhe(2);              // absichtlich OHNE zeitVergehenLassen()
  taste('Escape');            // zweiter Anschlag, während die Hülle noch ausblendet
  await ruhe(3);
  if (main.app.aktuellerScreen === 'kader') {
    HINW('Ein zweiter ESC unmittelbar nach dem ersten geht verloren: main.js:tastatur() prüft ' +
      '`.tv-overlay` und trifft dabei auch die schon geschlossene Hülle, die render/ui.js erst ' +
      '260 ms später aus dem Dokument nimmt. Für diese Viertelsekunde ist die gesamte Tastatur ' +
      'stumm — ESC, alle zwanzig Reiter-Kürzel und Strg+S. Vertretbar, solange die Hülle noch ' +
      'zu sehen ist; hier steht es, damit es niemand für einen Zufall hält.');
  } else {
    OK('Ein zweiter ESC greift auch während der Ausblendzeit des Dialogs');
  }
  await dialogeWeg();

  unterpunkt('Mit Fokus in einem Eingabefeld');
  wo = 'ESC: Eingabefeld';
  const TEXTFELD = /^(text|search|)$/;
  let gefunden = null;
  for (const id of screens) {
    await main.navigate(id); await ruhe(3); await dialogeWeg();
    const feld = main.app.inhaltEl.querySelectorAll('input')
      .find(i => !i.disabled && TEXTFELD.test(String(i.type || '').toLowerCase()));
    if (feld) { gefunden = { id, feld }; break; }
  }
  if (!gefunden) {
    HINW('Auf keinem Bildschirm steht ein Textfeld — die dritte Stufe der Kette blieb ungeprüft.');
  } else {
    gefunden.feld.focus();
    pruefe(dokument.activeElement === gefunden.feld, `${gefunden.id}: Das Textfeld nimmt den Fokus an`);
    taste('Escape', gefunden.feld);
    await ruhe(3);
    pruefe(dokument.activeElement !== gefunden.feld,
      `${gefunden.id}: ESC lässt den Fokus im Eingabefeld los`,
      dokument.activeElement === dokument.body ? 'Fokus liegt beim Körper' : 'Fokus liegt noch im Feld');
    pruefe(main.app.aktuellerScreen === gefunden.id,
      `${gefunden.id}: ESC im Eingabefeld verlässt den Bildschirm nicht`, main.app.aktuellerScreen);
  }
}

/* ------------------------------------------------------------------ *
 *  2.9  Fokusringe und Tastaturerreichbarkeit
 *
 *  Zwei verschiedene Fragen, die gern verwechselt werden:
 *
 *    a) Kommt man mit der Tabulatortaste hin?  → tabindex / natürlicher Fokus
 *    b) Sieht man dann, wo man ist?            → eine :focus-visible-Regel
 *
 *  Beides prüft dieses Skript nur auf dem Papier. Ob der Ring auf dem
 *  Hintergrund zu SEHEN ist, weiß nur ein Browser (siehe Dateikopf).
 * ------------------------------------------------------------------ */

/** Sammelt alle Selektoren, die per :focus-visible tatsächlich etwas zeichnen. */
function focusRegeln() {
  const quellen = [];
  for (const datei of ['styles/main.css', 'styles/screens.css']) {
    const abs = resolve(WURZEL, datei);
    if (existsSync(abs)) quellen.push(readFileSync(abs, 'utf8'));
    else HINW(`${datei} fehlt — die Fokusringe daraus konnten nicht gelesen werden.`);
  }
  // render/ui.js bringt sein eigenes Stilblatt als <style> mit.
  for (const s of dokument.querySelectorAll('style')) quellen.push(s.textContent || '');

  const selektoren = new Set();
  for (const css of quellen) {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const kopf = m[1];
      if (!kopf.includes(':focus-visible')) continue;
      if (!/outline|box-shadow|border|background/.test(m[2])) continue;   // Regeln, die nichts zeichnen
      for (const teil of kopf.split(',')) {
        const t = teil.replace(/:focus-visible/g, '').replace(/^\s*:where\(/, '').replace(/\)\s*$/, '').trim();
        if (t) selektoren.add(t);
      }
    }
  }
  return [...selektoren];
}

/**
 * Trifft eine der gesammelten Regeln dieses Element?
 *
 * Absichtlich einfach gehalten: geprüft wird nur das LETZTE Glied des
 * Selektors, dafür mit `:is(...)` aufgelöst. Falsch positiv wäre schlimmer als
 * zu grob — deshalb steht das Ergebnis unten als Kennzahl im Bericht und nicht
 * als Urteil.
 */
function hatFokusring(e, regeln) {
  const tag = e.localName;
  for (const regel of regeln) {
    for (const roh of regel.split(',').map(x => x.trim())) {
      const m = roh.match(/^(.*?):is\(([^)]*)\)$/);
      const kandidaten = m ? m[2].split(',').map(x => (m[1] + x.trim()).trim()) : [roh];
      for (const k of kandidaten) {
        const letztes = k.split(/\s+/).pop();
        if (!letztes) continue;
        if (letztes === tag || letztes === '*') return regel;
        if (letztes.startsWith('.') && e.classList.contains(letztes.slice(1))) return regel;
        if (letztes.startsWith('[')) {
          const name = letztes.slice(1, letztes.indexOf(']')).split('=')[0];
          if (e.hasAttribute(name)) return regel;
        }
        if (/^[a-z]+\./i.test(letztes)) {
          const [t2, ...klassen] = letztes.split('.');
          if (t2 === tag && klassen.every(c => e.classList.contains(c))) return regel;
        }
        if (/^[a-z]+\[/i.test(letztes)) {
          const t2 = letztes.slice(0, letztes.indexOf('['));
          const inhalt = letztes.slice(letztes.indexOf('[') + 1, letztes.indexOf(']')).split('=');
          if (t2 === tag && e.getAttribute(inhalt[0]) === String(inhalt[1] || '').replace(/["']/g, '')) return regel;
        }
      }
    }
  }
  return null;
}

const NATUERLICH_FOKUSSIERBAR = /^(button|input|select|textarea|a|summary)$/;

/**
 * Wandernder Tabstopp: In einer Reitergruppe und in einer Tabelle trägt genau
 * EIN Element `tabindex="0"`, alle Geschwister `-1` (render/ui.js:tabs und
 * table). Das ist richtig so und darf nicht als „nicht erreichbar" gelten.
 */
function hatWandernderTabstopp(e) {
  if (!e.parentNode) return false;
  return e.parentNode.children.some(g =>
    g !== e && g.localName === e.localName && Number(g.getAttribute('tabindex')) >= 0);
}

async function fokusPruefung(screens, regeln) {
  abschnitt('Fokusringe und Tastaturerreichbarkeit');
  pruefe(regeln.length > 0, 'Es gibt überhaupt :focus-visible-Regeln', `${regeln.length} Selektoren`);

  let gesamt = 0, mitRing = 0, unerreichbar = 0;
  const ohneRing = [];
  const ohneTabstopp = [];

  for (const id of screens) {
    wo = 'Fokus: ' + id;
    await main.navigate(id);
    await ruhe(3);
    await dialogeWeg();

    const liste = steuerListe(main.app.inhaltEl).filter(e => !e.disabled);
    let sMit = 0, sOhne = 0, sUnerreichbar = 0;

    for (const e of liste) {
      gesamt++;
      const ti = e.getAttribute('tabindex');
      const erreichbar = (ti !== null && Number(ti) >= 0) ||
        (ti === null && NATUERLICH_FOKUSSIERBAR.test(e.localName));
      if (!erreichbar && !hatWandernderTabstopp(e)) {
        sUnerreichbar++; unerreichbar++;
        if (ohneTabstopp.length < 12) {
          ohneTabstopp.push(`${id}: <${e.localName} class="${String(e.className).slice(0, 40)}"> „${txt(e).slice(0, 24)}"`);
        }
      }
      if (hatFokusring(e, regeln)) { sMit++; mitRing++; }
      else {
        sOhne++;
        if (ohneRing.length < 12) {
          ohneRing.push(`${id}: <${e.localName} class="${String(e.className).slice(0, 40)}"> „${txt(e).slice(0, 24)}"`);
        }
      }
    }

    P('  ' + fuellen(id, 16) + fuellen(`${liste.length} Bedienelemente`, 22) +
      fuellen(`${sMit} mit Ring`, 16) + fuellen(`${sOhne} ohne`, 12) +
      (sUnerreichbar ? `${sUnerreichbar} ohne Tabstopp` : ''));
  }

  const quote = gesamt ? Math.round((mitRing / gesamt) * 100) : 0;
  pruefe(gesamt > 0, 'Bedienelemente insgesamt gefunden', String(gesamt));
  pruefe(quote >= 90, 'Mindestens 90 % der Bedienelemente treffen eine :focus-visible-Regel',
    `${quote} % (${mitRing} von ${gesamt})`);

  if (ohneRing.length) {
    HINW(`${gesamt - mitRing} Bedienelemente ohne passende :focus-visible-Regel. Beispiele:`);
    for (const z of ohneRing) P('             ' + z);
  }
  if (unerreichbar) {
    HINW(`${unerreichbar} Bedienelemente sind per Tastatur nicht erreichbar ` +
      `(kein tabindex ≥ 0, kein wandernder Tabstopp). Beispiele:`);
    for (const z of ohneTabstopp) P('             ' + z);
  } else {
    OK('Jedes Bedienelement ist per Tastatur erreichbar');
  }
}

/* ------------------------------------------------------------------ *
 *  2.10  Der Vertrag der Bildschirme
 *
 *  tools/check-screens.js prüft das statisch per Regex. Hier wird das Modul
 *  wirklich geladen und das Objekt wirklich angesehen — das ist eine andere
 *  Zusage: Ein Bildschirm, der beim Laden wirft oder sein screen-Objekt erst
 *  zur Laufzeit zusammenbaut, fällt nur hier auf.
 * ------------------------------------------------------------------ */

async function screenVertrag(screens) {
  abschnitt('Der Vertrag: exportiert jeder Bildschirm ein gültiges screen-Objekt?');
  for (const id of screens) {
    let mod;
    try { mod = await import(src(`screens/${id}.js`)); }
    catch (err) { FEHL(`screens/${id}.js lässt sich nicht laden: ${kurz([err])}`); continue; }

    const s = mod.screen || mod.default;
    if (!s) { FEHL(`screens/${id}.js exportiert weder screen noch default`); continue; }

    const maengel = [];
    if (s.id !== id) maengel.push(`id ist „${s.id}" statt „${id}"`);
    if (typeof s.title !== 'string' || !s.title) maengel.push('title fehlt');
    if (typeof s.icon !== 'string' || !s.icon) maengel.push('icon fehlt');
    if (typeof s.render !== 'function') maengel.push('render() fehlt');
    if ('onLeave' in s && typeof s.onLeave !== 'function') maengel.push('onLeave ist keine Funktion');
    if ('onEscape' in s && typeof s.onEscape !== 'function') maengel.push('onEscape ist keine Funktion');

    if (maengel.length) FEHL(`screens/${id}.js: ${maengel.join(', ')}`);
    else OK(fuellen(`screens/${id}.js`, 30) + `„${s.title}" ${s.icon}` +
      (typeof s.onEscape === 'function' ? '  · mit onEscape()' : '') +
      (typeof s.onLeave === 'function' ? '  · mit onLeave()' : ''));
  }
}

/* ══════════════════════════════════════════════════════════════════════════ *
 *  Ausführung
 * ══════════════════════════════════════════════════════════════════════════ */

const gesamtStart = uhr();

P('╔══════════════════════════════════════════════════════════════╗');
P('║  TRAUMVEREIN – Bildschirm-Prüfstand                          ║');
P('╚══════════════════════════════════════════════════════════════╝');
P('');
P('  Dieser Prüfstand sagt „nichts wirft". Er sagt NICHT „nichts läuft aus');
P('  dem Container": Die DOM-Attrappe misst kein Layout, rechnet keine');
P('  Kaskade und zeichnet nichts. Die Einzelheiten stehen im Dateikopf.');

const K = await import(src('core/constants.js'));

/**
 * Alle Bildschirme. SCREEN_ORDER kennt die siebzehn Aktenreiter; der
 * Saisonabschluss und der Editor stehen bewusst nicht darin (main.js erklärt,
 * warum) — geprüft werden müssen sie trotzdem.
 */
const ALLE = K.SCREEN_ORDER.concat(['saison', 'editor']);

abschnitt('Vorbereitung');
OK(`${ALLE.length} Bildschirme: ${ALLE.join(', ')}`);
OK(`Vorlauf: ${SAISONS} Saison${SAISONS === 1 ? '' : 's'}` + (SCHNELL ? ' (--schnell)' : ''));

await screenVertrag(ALLE);

/* --- Zeitpunkt 1: Tag 1 ------------------------------------------------- */

abschnitt('Spielstand Tag 1');
stille = true;
let standT1;
try {
  standT1 = await spielstandBauen(0);
} finally { stille = false; }
OK(`Neues Spiel angelegt: ${standT1.clubs[standT1.managerClubId].name}, Saison ${standT1.date.season}, Tag ${standT1.date.day}`);

stille = true;
try {
  await rahmenHochfahren(standT1, 'Tag 1');
} catch (err) {
  stille = false;
  FEHL('Der Spielrahmen ließ sich mit dem frischen Spielstand nicht hochfahren: ' + kurz([err]));
  P('\nOhne Spielrahmen ist nichts weiter zu prüfen.');
  process.exit(1);
} finally { stille = false; }
OK('Spielrahmen steht (Startbildschirm → Spielstand laden → Laden)');

stille = true;
const berichteT1 = await durchlauf('Tag 1: alle Bildschirme, jedes Bedienelement einmal', ALLE);
stille = false;

stille = true;
abschnitt('Tag 1: Rahmen und Tasten');
await weiterKnopf();
stille = false;

stille = true;
await escapeKette(ALLE);
stille = false;

/* --- Zeitpunkt 2: nach drei Saisons ------------------------------------- */

let berichteS4 = [];
if (SAISONS > 0) {
  abschnitt(`Spielstand nach ${SAISONS} Saisons`);
  stille = true;
  let standS4;
  try {
    standS4 = await spielstandBauen(SAISONS);
  } finally { stille = false; }

  const loopMod = await import(src('core/loop.js'));
  const offen = loopMod.offenesEigenesSpiel(standS4);
  const zurueckgetreten = Object.values(standS4.players).filter(p => p && p.retired).length;
  OK(`Saison ${standS4.date.season}, Tag ${standS4.date.day}`);
  pruefe(!!offen, 'Eine eigene Partie steht an (sonst bleibt der Spieltagsbildschirm eine leere Seite)',
    offen ? `${offen.homeId} – ${offen.awayId}, ${offen.competitionName || offen.competitionId}` : 'keine');
  OK(`Chronik: ${standS4.history.seasons.length} Spielzeiten · ` +
    `${Object.keys(standS4.history.titel).length} Titelvergaben · ` +
    `${standS4.history.transfers.length} Transfers · ${zurueckgetreten} Zurückgetretene`);
  pruefe(standS4.history.seasons.length >= SAISONS,
    'Die Chronik hat Inhalt (sonst prüft der zweite Durchlauf dieselbe leere Seite)',
    `${standS4.history.seasons.length} von ${SAISONS} Spielzeiten`);
  pruefe(zurueckgetreten > 0, 'Die Ruhmeshalle hat Namen', `${zurueckgetreten} Zurückgetretene`);

  stille = true;
  try {
    await rahmenHochfahren(standS4, `Saison ${standS4.date.season}`);
  } catch (err) {
    stille = false;
    FEHL('Der Spielrahmen ließ sich mit dem gealterten Spielstand nicht hochfahren: ' + kurz([err]));
  } finally { stille = false; }

  if (main.app.state && main.app.state.date.season > 1) {
    OK('Spielrahmen steht mit dem gealterten Spielstand');
    stille = true;
    berichteS4 = await durchlauf(`Nach ${SAISONS} Saisons: alle Bildschirme, jedes Bedienelement einmal`, ALLE);
    stille = false;
  }
} else {
  HINW('--schnell: Der zweite Zeitpunkt (nach drei Saisons) wurde übersprungen. ' +
    'Chronik, Ruhmeshalle und ewige Tabelle bleiben damit ungeprüft.');
}

/* --- Fokusringe: auf dem gealterten Stand, weil dort mehr steht ---------- */

const regeln = focusRegeln();
await fokusPruefung(ALLE, regeln);

/* --- Nachlese ----------------------------------------------------------- */

abschnitt('Nachlese');

if (dialogeGewaltsam) {
  FEHL(`${dialogeGewaltsam} Dialog(e) ließen sich weder mit ESC noch über einen ` +
    `eigenen Knopf schließen und mussten aus dem Dokument gerissen werden.`);
} else {
  OK('Jeder geöffnete Dialog ließ sich auch wieder schließen');
}

if (minispieleGewaltsam) {
  FEHL(`${minispieleGewaltsam} Minispiel-Bühne(n) gingen mit ESC nicht zu. Das ist der ` +
    `teuerste Befund, den dieser Prüfstand kennt: Solange ein .tv-minispiel im Dokument ` +
    `steht, nimmt main.js:tastatur() keine einzige Taste mehr an — weder ESC noch die ` +
    `zwanzig Reiter-Kürzel noch Strg+S.`);
} else if (minispieleGesehen) {
  OK(`${minispieleGesehen}× wurde eine Minispiel-Bühne geöffnet und mit ESC wieder freigegeben`);
}

pruefe(attrappe.fehler.length === 0, 'Kein Laufzeitfehler in Ereignissen oder Animationsbildern',
  `${attrappe.fehler.length} Fehler`);
pruefe(meldungen.error.length === 0, 'Kein console.error während des Durchlaufs',
  `${meldungen.error.length} Meldungen`);

if (meldungen.warn.length) {
  HINW(`${meldungen.warn.length} console.warn — kein Fehler, aber jemand hat sich beschwert:`);
  const gesehen = new Set();
  for (const m of meldungen.warn) {
    const kern = m.text.slice(0, 90);
    if (gesehen.has(kern)) continue;
    gesehen.add(kern);
    P(`             [${m.wo}] ${m.text.slice(0, 150)}`);
    if (gesehen.size >= 12 && !LAUT) { P('             … (mehr mit --laut)'); break; }
  }
}

if (LAUT && meldungen.log.length) {
  unterpunkt(`Ausgaben des Spiels (${meldungen.log.length})`);
  for (const m of meldungen.log.slice(0, 200)) P(`             [${m.wo}] ${m.text}`);
}

/* --- Zahlenwerk --------------------------------------------------------- */

const alleBerichte = berichteT1.concat(berichteS4);
const summe = (fn) => alleBerichte.reduce((a, b) => a + fn(b), 0);

abschnitt('Zusammenfassung');
P(`  Bildschirmaufrufe:   ${alleBerichte.length}`);
P(`  Bedienelemente:      ${summe(b => b.betaetigt)} betätigt · ${summe(b => b.gesperrt)} gesperrt · ` +
  `${summe(b => b.uebersprungen)} übersprungen (Weiter-Knopf)`);
P(`  Reiter:              ${summe(b => b.reiter)} geöffnet`);
P(`  Dialoge:             ${summe(b => b.dialoge)} geöffnet und geschlossen`);
P(`  Bildschirmwechsel:   ${summe(b => b.weggesprungen)} durch angeklickte Verweise`);
P(`  DOM-Knoten (Spitze): ${alleBerichte.reduce((a, b) => Math.max(a, b.knoten), 0)}`);

const langsamste = alleBerichte.slice().sort((a, b) => b.dauer - a.dauer).slice(0, 3);
P(`  Längste Bildschirme: ${langsamste.map(b => `${b.id} ${sekunden(b.dauer)}`).join(' · ')}`);
P(`  Laufzeit:            ${sekunden(uhr() - gesamtStart)}`);

P('');
P('─'.repeat(64));
if (fehler.length) {
  P(`  ${fehler.length} Befund${fehler.length === 1 ? '' : 'e'} · ${hinweise.length} Hinweis${hinweise.length === 1 ? '' : 'e'}`);
  P('─'.repeat(64));
  for (const f of fehler.slice(0, 60)) P('    • ' + f);
  if (fehler.length > 60) P(`    … und ${fehler.length - 60} weitere.`);
  P('\nDer Platzwart bittet um Nachbesserung.');
  process.exit(1);
}

P(`  0 Befunde · ${hinweise.length} Hinweis${hinweise.length === 1 ? '' : 'e'}`);
P('─'.repeat(64));
P('\nAlle Bildschirme haben gehalten. Was sie dabei ANZEIGEN, weiß nur ein Browser.');
process.exit(0);
