/**
 * render/ui.js — die Bausteinbibliothek im Anstoß-Look.
 *
 * Reines DOM, kein Framework, keine Abhängigkeiten. Jede Funktion liefert ein
 * fertiges HTMLElement zurück, das der aufrufende Screen irgendwo einhängt.
 *
 * Konventionen:
 *  - Alle CSS-Klassen tragen das Präfix `tv-`.
 *  - Alle sichtbaren Texte sind deutsch.
 *  - Das Stylesheet wird einmalig beim ersten Aufruf injiziert (siehe
 *    `ensureStyles`). Es liegt in der CSS-Kaskadenschicht `tv-ui`; ein späteres,
 *    schichtloses Projekt-Stylesheet gewinnt damit IMMER gegen diese Defaults.
 *    So bleiben die Bausteine allein lauffähig, ohne ein Theme zu überschreiben.
 *  - Reine Anzeige-Logik: kein Zugriff auf `state`, kein Zufall, kein Date.now()
 *    in Spiellogik (Animationen benutzen erlaubterweise performance.now()).
 *
 * Erweiterte APIs an zurückgegebenen Elementen sind mit `tv…` benannt
 * (z. B. `tabelle.tvSetRows(...)`), damit sie nicht mit DOM-Eigenschaften kollidieren.
 */

import { clamp, ratingClass } from '../core/util.js';

// ═══════════════════════════════════════════════════════════════════════════
// STIL-KONSTANTEN — zentrale Stellschrauben für das gesamte Interface
// ═══════════════════════════════════════════════════════════════════════════

export const UI_STYLE_ID = 'tv-ui-stil';

/** Anzeigedauer eines Toasts in Millisekunden, je Art. */
const TOAST_MS = { info: 3600, gut: 3600, warn: 5000, schlecht: 6000 };
/** Maximal gleichzeitig sichtbare Toasts – ältere fallen raus. */
const TOAST_MAX = 5;

/** Verzögerung, bis ein Tooltip erscheint (ms). */
const TOOLTIP_DELAY = 260;

/** Standardgeschwindigkeit des Laufbands in Pixeln pro Sekunde. */
const TICKER_SPEED = 55;

/** Tabelle: ab dieser Zeilenzahl wird auf `content-visibility` umgestellt. */
const TABLE_VIRTUAL_HINT = 120;

/** Basisgröße eines Inline-Icons in Pixeln. */
const ICON_SIZE = 16;

const hatDOM = () => typeof document !== 'undefined';

// ═══════════════════════════════════════════════════════════════════════════
// HYPERSCRIPT
// ═══════════════════════════════════════════════════════════════════════════

/** Hängt beliebige Kinder (Node, String, Zahl, Array, null) an einen Knoten. */
function appendChild(parent, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) { for (const c of child) appendChild(parent, c); return; }
  if (child instanceof Node) { parent.appendChild(child); return; }
  parent.appendChild(document.createTextNode(String(child)));
}

function applyClass(node, value) {
  if (!value) return;
  if (typeof value === 'string') { node.className = node.className ? node.className + ' ' + value : value; return; }
  if (Array.isArray(value)) { for (const v of value) applyClass(node, v); return; }
  if (typeof value === 'object') {
    for (const k in value) if (value[k]) applyClass(node, k);
  }
}

function applyStyle(node, value) {
  if (!value) return;
  if (typeof value === 'string') { node.style.cssText += ';' + value; return; }
  for (const k in value) {
    const v = value[k];
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('--')) node.style.setProperty(k, String(v));
    else node.style[k] = typeof v === 'number' && !CSS_UNITLESS.has(k) ? v + 'px' : v;
  }
}

/** CSS-Eigenschaften, die Zahlen ohne Einheit erwarten. */
const CSS_UNITLESS = new Set(['opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink',
  'order', 'fontWeight', 'lineHeight', 'gridColumn', 'gridRow', 'zoom']);

/** Eigenschaften, die als Property (nicht als Attribut) gesetzt werden müssen. */
const DIRECT_PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'indeterminate', 'tabIndex']);

/**
 * Mini-Hyperscript.
 *
 *   el('div.tv-reihe#kopf', { onClick: f, style:{ gap: 8 }, dataset:{ id:'x' } }, 'Text', kindNode)
 *
 * `tag` erlaubt die Kurzschreibweise `tag.klasse.klasse2#id`.
 * `props` kennt: class/className, style (Objekt oder String), dataset, attrs,
 * html (innerHTML), text, ref (Callback mit dem Knoten), on*-Handler
 * (`onClick`, `onclick`, `onPointerDown`, …; Wert darf `[handler, options]` sein).
 * Alles Übrige wird als Attribut bzw. – wenn sinnvoll – als Property gesetzt.
 */
export function el(tag, props, ...children) {
  ensureStyles();
  let name = 'div', cls = '', id = '';
  if (typeof tag === 'string') {
    const hash = tag.indexOf('#');
    let rest = tag;
    if (hash >= 0) { id = tag.slice(hash + 1).split('.')[0]; rest = tag.slice(0, hash) + tag.slice(hash + 1 + id.length); }
    const parts = rest.split('.');
    name = parts[0] || 'div';
    cls = parts.slice(1).join(' ');
  }
  const node = document.createElement(name);
  if (cls) node.className = cls;
  if (id) node.id = id;

  // Zweites Argument darf auch schon ein Kind sein.
  if (props !== null && props !== undefined &&
      (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }

  if (props) {
    for (const key in props) {
      const v = props[key];
      if (v === null || v === undefined || v === false) continue;
      if (key === 'class' || key === 'className') { applyClass(node, v); continue; }
      if (key === 'style') { applyStyle(node, v); continue; }
      if (key === 'dataset') { for (const d in v) if (v[d] !== null && v[d] !== undefined) node.dataset[d] = String(v[d]); continue; }
      if (key === 'attrs') { for (const a in v) if (v[a] !== null && v[a] !== undefined && v[a] !== false) node.setAttribute(a, v[a] === true ? '' : String(v[a])); continue; }
      if (key === 'html' || key === 'innerHTML') { node.innerHTML = String(v); continue; }
      if (key === 'text' || key === 'textContent') { node.textContent = String(v); continue; }
      if (key === 'ref') { if (typeof v === 'function') v(node); continue; }
      if (key.length > 2 && key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 /* "on" */ &&
          (key[2] === key[2].toUpperCase() || typeof v === 'function' || Array.isArray(v))) {
        const type = key.slice(2).toLowerCase();
        if (Array.isArray(v)) node.addEventListener(type, v[0], v[1]);
        else node.addEventListener(type, v);
        continue;
      }
      if (DIRECT_PROPS.has(key)) { node[key] = v; continue; }
      if (key === 'htmlFor') { node.setAttribute('for', String(v)); continue; }
      node.setAttribute(key, v === true ? '' : String(v));
    }
  }

  for (const c of children) appendChild(node, c);
  return node;
}

/** Sammelt mehrere Knoten in einem DocumentFragment. */
export function frag(...children) {
  const f = document.createDocumentFragment();
  for (const c of children) appendChild(f, c);
  return f;
}

/** Leert einen Knoten (schneller und GC-freundlicher als innerHTML = ''). */
export function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// ═══════════════════════════════════════════════════════════════════════════
// PANELS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Bevel-Panel mit Titelleiste – das Grundelement des Managerbüros.
 * `title` darf null sein (dann ohne Kopfleiste) oder ein Node (z. B. Titel + Knöpfe).
 */
export function panel(title, ...children) {
  const kopf = title === null || title === undefined || title === ''
    ? null
    : el('header.tv-panel-kopf', null, title);
  return el('section.tv-panel', null, kopf, el('div.tv-panel-korpus', null, ...children));
}

/** Untergeordneter Kasten innerhalb eines Panels. */
export function subpanel(title, ...children) {
  const kopf = title === null || title === undefined || title === ''
    ? null
    : el('header.tv-subpanel-kopf', null, title);
  return el('section.tv-subpanel', null, kopf, el('div.tv-subpanel-korpus', null, ...children));
}

// ═══════════════════════════════════════════════════════════════════════════
// KNÖPFE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {string|Node} label
 * @param {function} [onClick]
 * @param {object} [opts]
 *   kind: 'primary'|'ghost'|'danger'|'gold'|'default'
 *   icon: Icon-Name (siehe `icon()`) oder Node
 *   disabled: bool, tooltip: string, size: 'sm'|'md'|'lg',
 *   wide: bool (volle Breite), type: 'button'|'submit', badge: string|number
 */
/**
 * Größenangaben gibt es historisch in zwei Schreibweisen. Verbindlich ist die
 * deutsche ('klein' / 'gross'), weil sie im Projekt weit überwiegt; die kurzen
 * englischen Kürzel werden darauf abgebildet, damit auch die Icon-Skalierung
 * greift und nicht ein 16px-Symbol in einem 11px-Knopf sitzt.
 */
const BUTTON_SIZES = { sm: 'klein', klein: 'klein', md: 'md', lg: 'gross', gross: 'gross' };
const BUTTON_ICON_PX = { klein: 13, md: null, gross: 20 };

export function button(label, onClick, opts = {}) {
  const kind = opts.kind || 'default';
  const size = BUTTON_SIZES[opts.size] || 'md';
  const b = el('button.tv-btn', {
    class: [`tv-btn--${kind}`, size !== 'md' ? `tv-btn--${size}` : null, opts.wide ? 'tv-btn--breit' : null,
      opts.class],
    type: opts.type || 'button',
    disabled: !!opts.disabled
  });
  if (opts.icon) {
    b.appendChild(typeof opts.icon === 'string'
      ? icon(opts.icon, BUTTON_ICON_PX[size] || ICON_SIZE)
      : opts.icon);
  }
  if (label !== null && label !== undefined && label !== '') {
    b.appendChild(el('span.tv-btn-text', null, label));
  }
  if (opts.badge !== undefined && opts.badge !== null && opts.badge !== '') {
    b.appendChild(el('span.tv-btn-badge', null, opts.badge));
  }
  if (onClick) b.addEventListener('click', onClick);
  if (opts.tooltip) tooltip(b, opts.tooltip);
  return b;
}

// ═══════════════════════════════════════════════════════════════════════════
// BALKEN & KENNZAHLEN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Attributbalken. Färbt sich standardmäßig nach `ratingClass()` (rat-elite …
 * rat-mies), damit ein Blick auf die Kaderliste genügt.
 *
 * @param {number} value
 * @param {number} [max=99]
 * @param {object} [opts]
 *   label: string, showValue: bool (Default true, wenn label gesetzt),
 *   valueText: string (statt der Zahl), color: fixe Farbe statt Rating-Klasse,
 *   compact: bool, delta: number (kleiner Trendpfeil), tooltip: string,
 *   height: number (px), potential: number (Geisterbalken für das Potenzial)
 */
export function bar(value, max = 99, opts = {}) {
  const v = clamp(Number(value) || 0, 0, max);
  const pct = max > 0 ? (v / max) * 100 : 0;
  const klasse = opts.color ? null : ratingClass((v / (max || 1)) * 99);

  const spur = el('div.tv-bar-spur');
  if (opts.potential !== undefined && opts.potential !== null) {
    const pPct = clamp((Number(opts.potential) / (max || 1)) * 100, 0, 100);
    spur.appendChild(el('div.tv-bar-potenzial', { style: { width: pPct + '%' } }));
  }
  const fuell = el('div.tv-bar-fuellung', {
    class: klasse,
    style: { width: pct + '%', background: opts.color || null }
  });
  spur.appendChild(fuell);
  if (opts.height) spur.style.height = opts.height + 'px';

  const kinder = [];
  if (opts.label || opts.showValue !== false) {
    const kopf = el('div.tv-bar-kopf');
    if (opts.label) kopf.appendChild(el('span.tv-bar-label', null, opts.label));
    if (opts.showValue !== false) {
      const wert = el('span.tv-bar-wert', null, opts.valueText !== undefined ? opts.valueText : Math.round(v));
      if (opts.delta) {
        wert.appendChild(el('span.tv-bar-delta', {
          class: opts.delta > 0 ? 'tv-gut' : 'tv-schlecht'
        }, (opts.delta > 0 ? '▲' : '▼') + Math.abs(Math.round(opts.delta * 10) / 10)));
      }
      kopf.appendChild(wert);
    }
    if (opts.label || opts.showValue !== false) kinder.push(kopf);
  }
  kinder.push(spur);

  const wrap = el('div.tv-bar', { class: opts.compact ? 'tv-bar--kompakt' : null }, ...kinder);
  if (opts.tooltip) tooltip(wrap, opts.tooltip);
  return wrap;
}

/**
 * Kennzahlenkachel (Kontostand, Zuschauerschnitt, Tabellenplatz …).
 * opts: sub, kind:'gut'|'warn'|'schlecht'|'gold', icon, tooltip, onClick, align
 */
export function statBox(label, value, opts = {}) {
  const box = el('div.tv-stat', {
    class: [opts.kind ? `tv-stat--${opts.kind}` : null, opts.onClick ? 'tv-stat--klickbar' : null],
    style: opts.align ? { textAlign: opts.align } : null
  });
  if (opts.icon) box.appendChild(el('div.tv-stat-icon', null, typeof opts.icon === 'string' ? icon(opts.icon, 18) : opts.icon));
  const text = el('div.tv-stat-text', null,
    el('div.tv-stat-label', null, label),
    el('div.tv-stat-wert', null, value),
    opts.sub ? el('div.tv-stat-sub', null, opts.sub) : null);
  box.appendChild(text);
  if (opts.tooltip) tooltip(box, opts.tooltip);
  if (opts.onClick) {
    box.tabIndex = 0;
    box.addEventListener('click', opts.onClick);
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onClick(e); } });
  }
  return box;
}

// ═══════════════════════════════════════════════════════════════════════════
// TABELLE
// ═══════════════════════════════════════════════════════════════════════════

function defaultCompare(a, b, key, numeric) {
  const va = a === null || a === undefined ? '' : a[key];
  const vb = b === null || b === undefined ? '' : b[key];
  if (va === vb) return 0;
  if (va === undefined || va === null || va === '') return 1;
  if (vb === undefined || vb === null || vb === '') return -1;
  if (numeric || (typeof va === 'number' && typeof vb === 'number')) return Number(va) - Number(vb);
  return String(va).localeCompare(String(vb), 'de');
}

/**
 * Sortierbare Tabelle.
 *
 * @param {Array} columns  [{ key, label, width, align, render(row, i), sort(a,b), numeric,
 *                            title, cellClass(row), headClass, sortable:false }]
 * @param {Array} rows
 * @param {object} [opts]
 *   onRowClick(row, i, ev), selectedId, idKey ('id'), rowClass(row, i),
 *   compact, emptyText, maxHeight (px oder CSS-String), striped (Default true),
 *   sort: { key, desc } (Startsortierung), onSort(key, desc), footer: [zellen]|Node,
 *   caption, zebra
 *
 * Performance: Zeilen werden in ein DocumentFragment gebaut und in einem Rutsch
 * eingehängt; Klicks laufen über EINEN delegierten Listener am <tbody>.
 * 500 Zeilen sind damit unproblematisch.
 */
export function table(columns, rows, opts = {}) {
  const cols = (columns || []).filter(Boolean);
  const idKey = opts.idKey || 'id';
  let data = Array.isArray(rows) ? rows.slice() : [];
  let sortKey = opts.sort && opts.sort.key ? opts.sort.key : null;
  let sortDesc = !!(opts.sort && opts.sort.desc);
  let selectedId = opts.selectedId !== undefined ? opts.selectedId : null;

  const thead = el('thead');
  const kopfReihe = el('tr');
  const kopfZellen = {};

  for (const c of cols) {
    const sortierbar = c.sortable !== false && (c.sort || c.key);
    const th = el('th', {
      class: [c.align ? `tv-a-${c.align}` : (c.numeric ? 'tv-a-right' : null),
        sortierbar ? 'tv-sortierbar' : null, c.headClass],
      style: c.width ? { width: typeof c.width === 'number' ? c.width + 'px' : c.width } : null,
      title: c.title || null,
      scope: 'col'
    }, el('span.tv-th-text', null, c.label !== undefined ? c.label : c.key));
    if (sortierbar) {
      th.appendChild(el('span.tv-sort-pfeil'));
      th.tabIndex = 0;
      const los = () => sortieren(c.key || c.label, c);
      th.addEventListener('click', los);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); los(); } });
    }
    kopfZellen[c.key || c.label] = th;
    kopfReihe.appendChild(th);
  }
  thead.appendChild(kopfReihe);

  const tbody = el('tbody');
  const tab = el('table.tv-tabelle', {
    class: [opts.compact ? 'tv-tabelle--kompakt' : null, opts.striped === false ? null : 'tv-tabelle--zebra']
  },
  opts.caption ? el('caption', null, opts.caption) : null,
  thead, tbody);

  const huelle = el('div.tv-tabelle-huelle', {
    style: opts.maxHeight ? { maxHeight: typeof opts.maxHeight === 'number' ? opts.maxHeight + 'px' : opts.maxHeight } : null
  }, tab);

  if (opts.footer) {
    const tfoot = el('tfoot');
    if (Array.isArray(opts.footer)) {
      const tr = el('tr');
      opts.footer.forEach((z, i) => tr.appendChild(el('td', {
        class: cols[i] && (cols[i].align ? `tv-a-${cols[i].align}` : (cols[i].numeric ? 'tv-a-right' : null))
      }, z)));
      tfoot.appendChild(tr);
    } else {
      tfoot.appendChild(el('tr', null, el('td', { colspan: cols.length }, opts.footer)));
    }
    tab.appendChild(tfoot);
  }

  // ── Zeilen zeichnen
  function zeichne() {
    const f = document.createDocumentFragment();
    if (!data.length) {
      const tr = el('tr.tv-leer-reihe', null,
        el('td', { colspan: Math.max(1, cols.length) },
          el('div.tv-leer', null, opts.emptyText || 'Keine Einträge vorhanden.')));
      f.appendChild(tr);
    } else {
      const langeListe = data.length >= TABLE_VIRTUAL_HINT;
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const tr = document.createElement('tr');
        tr.dataset.i = String(i);
        if (langeListe) tr.style.contentVisibility = 'auto';
        let klassen = '';
        if (opts.onRowClick) { klassen += 'tv-reihe-klickbar '; tr.tabIndex = -1; }
        if (selectedId !== null && row && row[idKey] === selectedId) klassen += 'tv-gewaehlt ';
        const extra = opts.rowClass ? opts.rowClass(row, i) : null;
        if (extra) klassen += extra;
        if (klassen) tr.className = klassen.trim();

        for (const c of cols) {
          const td = document.createElement('td');
          const kls = [];
          if (c.align) kls.push('tv-a-' + c.align);
          else if (c.numeric) kls.push('tv-a-right');
          if (c.numeric) kls.push('tv-num');
          if (c.cellClass) { const cc = c.cellClass(row, i); if (cc) kls.push(cc); }
          if (kls.length) td.className = kls.join(' ');
          const inhalt = c.render ? c.render(row, i) : (row ? row[c.key] : '');
          if (inhalt instanceof Node) td.appendChild(inhalt);
          else if (inhalt !== null && inhalt !== undefined) td.textContent = String(inhalt);
          tr.appendChild(td);
        }
        f.appendChild(tr);
      }
    }
    tbody.replaceChildren(f);
    tabstoppSetzen();
  }

  /* ── Klickbare Zeilen an der Tastatur (Stufe 6) ────────────────────────
     Eine klickbare Zeile war bisher nur mit der Maus erreichbar und konnte
     deshalb auch keinen Fokusring zeigen. Jetzt trägt die Tabelle genau
     EINEN Tabstopp (wanderndes tabindex); innerhalb der Tabelle führen
     Pfeiltasten, Enter und Leertaste. Ein Tabstopp je Zeile wäre bei 800
     Transferkandidaten kein Fortschritt, sondern eine Strafe. */
  let fokusIndex = 0;

  function zeilenListe() {
    return Array.from(tbody.querySelectorAll('tr:not(.tv-leer-reihe)'));
  }

  function tabstoppSetzen() {
    if (!opts.onRowClick) return;
    const zeilen = zeilenListe();
    if (!zeilen.length) return;
    fokusIndex = Math.min(Math.max(0, fokusIndex), zeilen.length - 1);
    zeilen.forEach((tr, i) => { tr.tabIndex = i === fokusIndex ? 0 : -1; });
  }

  function sortieren(key, col) {
    const c = col || cols.find((x) => (x.key || x.label) === key);
    if (!c) return;
    if (sortKey === key) sortDesc = !sortDesc;
    else { sortKey = key; sortDesc = !!c.numeric; }   // Zahlen starten absteigend
    anwendenSortierung();
    aktualisiereKopf();
    zeichne();
    if (opts.onSort) opts.onSort(sortKey, sortDesc);
  }

  function anwendenSortierung() {
    if (!sortKey) return;
    const c = cols.find((x) => (x.key || x.label) === sortKey);
    if (!c) return;
    const cmp = c.sort ? c.sort : (a, b) => defaultCompare(a, b, c.key, c.numeric);
    // stabile Sortierung über den Index als Tiebreaker
    const idx = new Map();
    data.forEach((r, i) => idx.set(r, i));
    data.sort((a, b) => {
      const r = cmp(a, b);
      if (r !== 0) return sortDesc ? -r : r;
      return idx.get(a) - idx.get(b);
    });
  }

  function aktualisiereKopf() {
    for (const k in kopfZellen) {
      const th = kopfZellen[k];
      th.classList.toggle('tv-sort-aktiv', k === sortKey);
      th.classList.toggle('tv-sort-ab', k === sortKey && sortDesc);
      if (k === sortKey) th.setAttribute('aria-sort', sortDesc ? 'descending' : 'ascending');
      else th.removeAttribute('aria-sort');
    }
  }

  if (opts.onRowClick) {
    tbody.addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr');
      if (!tr || !tr.dataset.i) return;
      const i = Number(tr.dataset.i);
      opts.onRowClick(data[i], i, ev);
    });

    tbody.addEventListener('focusin', (ev) => {
      const tr = ev.target.closest && ev.target.closest('tr');
      if (!tr) return;
      const i = zeilenListe().indexOf(tr);
      if (i >= 0 && i !== fokusIndex) { fokusIndex = i; tabstoppSetzen(); }
    });

    tbody.addEventListener('keydown', (ev) => {
      if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) return;
      const tr = ev.target.closest && ev.target.closest('tr');
      if (!tr || !tr.dataset.i) return;

      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        const i = Number(tr.dataset.i);
        opts.onRowClick(data[i], i, ev);
        return;
      }
      const zeilen = zeilenListe();
      const hier = zeilen.indexOf(tr);
      if (hier < 0) return;
      let ziel = null;
      if (ev.key === 'ArrowDown') ziel = zeilen[Math.min(hier + 1, zeilen.length - 1)];
      else if (ev.key === 'ArrowUp') ziel = zeilen[Math.max(hier - 1, 0)];
      else if (ev.key === 'Home') ziel = zeilen[0];
      else if (ev.key === 'End') ziel = zeilen[zeilen.length - 1];
      if (!ziel || ziel === tr) { if (ziel) ev.preventDefault(); return; }
      ev.preventDefault();
      fokusIndex = zeilen.indexOf(ziel);
      tabstoppSetzen();
      ziel.focus();
    });
  }

  if (sortKey) { anwendenSortierung(); aktualisiereKopf(); }
  zeichne();

  // ── Öffentliche Zusatz-API am Wurzelelement
  huelle.tvSetRows = (neu) => {
    data = Array.isArray(neu) ? neu.slice() : [];
    anwendenSortierung();
    zeichne();
  };
  huelle.tvSetSelected = (id) => {
    selectedId = id;
    const alt = tbody.querySelector('.tv-gewaehlt');
    if (alt) alt.classList.remove('tv-gewaehlt');
    if (id === null || id === undefined) return;
    const i = data.findIndex((r) => r && r[idKey] === id);
    if (i >= 0) {
      const tr = tbody.children[i];
      if (tr) { tr.classList.add('tv-gewaehlt'); }
    }
  };
  huelle.tvSort = (key, desc) => { sortKey = key; sortDesc = !!desc; anwendenSortierung(); aktualisiereKopf(); zeichne(); };
  huelle.tvRows = () => data.slice();
  huelle.tvTable = tab;

  return huelle;
}

// ═══════════════════════════════════════════════════════════════════════════
// REITER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {Array} items [{ id, label, icon, render(), disabled, badge }]
 * @param {object} [opts] active, onChange(id), keepAlive (Default true),
 *                        vertical, className
 */
export function tabs(items, opts = {}) {
  const liste = (items || []).filter(Boolean);
  const keepAlive = opts.keepAlive !== false;
  const leiste = el('div.tv-tab-leiste', { role: 'tablist' });
  const inhalt = el('div.tv-tab-inhalt');
  const wrap = el('div.tv-tabs', {
    class: [opts.vertical ? 'tv-tabs--vertikal' : null, opts.class]
  }, leiste, inhalt);

  const cache = new Map();
  const knoepfe = new Map();
  let aktiv = null;

  function waehle(id, fokus) {
    const it = liste.find((x) => x.id === id);
    if (!it || it.disabled) return;
    aktiv = id;
    for (const [k, b] of knoepfe) {
      const an = k === id;
      b.classList.toggle('tv-tab--aktiv', an);
      b.setAttribute('aria-selected', an ? 'true' : 'false');
      b.tabIndex = an ? 0 : -1;
    }
    let node = keepAlive ? cache.get(id) : null;
    if (!node) {
      node = it.render ? it.render() : null;
      if (keepAlive && node) cache.set(id, node);
    }
    clearNode(inhalt);
    if (node) appendChild(inhalt, node);
    if (fokus) { const b = knoepfe.get(id); if (b) b.focus(); }
    if (opts.onChange) opts.onChange(id);
  }

  liste.forEach((it) => {
    const b = el('button.tv-tab', {
      type: 'button', role: 'tab', tabIndex: -1, disabled: !!it.disabled,
      'aria-selected': 'false'
    });
    if (it.icon) b.appendChild(typeof it.icon === 'string' ? icon(it.icon, ICON_SIZE) : it.icon);
    b.appendChild(el('span', null, it.label));
    if (it.badge !== undefined && it.badge !== null && it.badge !== '') {
      b.appendChild(el('span.tv-tab-badge', null, it.badge));
    }
    b.addEventListener('click', () => waehle(it.id));
    b.addEventListener('keydown', (e) => {
      const i = liste.indexOf(it);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); waehle(liste[(i + 1) % liste.length].id, true); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); waehle(liste[(i - 1 + liste.length) % liste.length].id, true); }
    });
    knoepfe.set(it.id, b);
    leiste.appendChild(b);
  });

  const start = opts.active && knoepfe.has(opts.active) ? opts.active : (liste[0] && liste[0].id);
  if (start) waehle(start);

  wrap.tvSelect = (id) => waehle(id);
  wrap.tvActive = () => aktiv;
  wrap.tvInvalidate = (id) => { if (id === undefined) cache.clear(); else cache.delete(id); if (aktiv) waehle(aktiv); };
  return wrap;
}

// ═══════════════════════════════════════════════════════════════════════════
// DIALOGE (stapelbar)
// ═══════════════════════════════════════════════════════════════════════════

const dialogStapel = [];
let dialogTastenListener = false;

function fokussierbare(root) {
  return Array.from(root.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter((n) => !n.disabled && n.offsetParent !== null);
}

function dialogTasten(ev) {
  if (!dialogStapel.length) return;
  const oben = dialogStapel[dialogStapel.length - 1];
  if (ev.key === 'Escape') {
    if (oben.dismissable === false) return;
    ev.preventDefault();
    // Der Anschlag ist hier verbraucht und darf main.js:tastatur() nicht mehr
    // erreichen: Dieser Zuhörer hängt in der Einfangphase am Dokument, der von
    // main.js in der Blasenphase am selben Dokument. Ohne den Stopp erledigt
    // EIN Druck zwei Dinge – Dialog zu UND zurück ins Büro. main.js kann das
    // nicht mehr an der Hülle erkennen, weil die beim Ausblenden noch eine
    // Viertelsekunde im Dokument steht.
    ev.stopPropagation();
    oben.close(oben.escValue);
    return;
  }
  if (ev.key === 'Tab') {
    // Fokusfalle: der Fokus bleibt im obersten Dialog.
    const f = fokussierbare(oben.box);
    if (!f.length) return;
    const erste = f[0], letzte = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === erste) { ev.preventDefault(); letzte.focus(); }
    else if (!ev.shiftKey && document.activeElement === letzte) { ev.preventDefault(); erste.focus(); }
    else if (!oben.box.contains(document.activeElement)) { ev.preventDefault(); erste.focus(); }
  }
}

/**
 * Modaler Dialog. Mehrere Dialoge dürfen sich stapeln; ESC schließt immer nur
 * den obersten und gibt den Fokus an das Element zurück, das ihn vorher hatte.
 *
 * @param {string|Node} title
 * @param {string|Node|function} body  Funktion erhält `{ close(v) }`
 * @param {Array} [actions] [{ label, value, kind, icon, disabled, keepOpen, onClick(api) }]
 * @param {object} [opts] size:'sm'|'md'|'lg'|'xl', escValue, dismissable, className, onOpen(api)
 * @returns {Promise<any>}
 */
export function dialog(title, body, actions, opts = {}) {
  ensureStyles();
  return new Promise((resolve) => {
    const vorherFokus = document.activeElement;
    const overlay = el('div.tv-overlay', { style: { zIndex: 900 + dialogStapel.length * 10 } });
    const box = el('div.tv-dialog', {
      class: [`tv-dialog--${opts.size || 'md'}`, opts.class],
      role: 'dialog', 'aria-modal': 'true'
    });

    const eintrag = {
      box, overlay,
      escValue: opts.escValue !== undefined ? opts.escValue : null,
      dismissable: opts.dismissable !== false,
      close: schliesse
    };

    const api = { close: schliesse, box, overlay };

    if (title) {
      const kopf = el('header.tv-dialog-kopf', null, el('h2.tv-dialog-titel', null, title));
      if (eintrag.dismissable) {
        kopf.appendChild(el('button.tv-dialog-x', {
          type: 'button', title: 'Schließen', 'aria-label': 'Schließen',
          onClick: () => schliesse(eintrag.escValue)
        }, '✕'));
      }
      box.appendChild(kopf);
    }

    const korpus = el('div.tv-dialog-korpus');
    const inhalt = typeof body === 'function' ? body(api) : body;
    appendChild(korpus, inhalt);
    box.appendChild(korpus);

    const aktionen = Array.isArray(actions) && actions.length
      ? actions
      : [{ label: 'Schließen', value: eintrag.escValue, kind: 'ghost' }];
    const fuss = el('footer.tv-dialog-fuss');
    for (const a of aktionen) {
      if (!a) continue;
      const b = button(a.label, async (ev) => {
        let ergebnis = a.value;
        if (a.onClick) {
          const r = await a.onClick(api, ev);
          if (r !== undefined) ergebnis = r;
        }
        if (!a.keepOpen) schliesse(ergebnis);
      }, { kind: a.kind || 'default', icon: a.icon, disabled: a.disabled, size: a.size || 'md' });
      fuss.appendChild(b);
    }
    box.appendChild(fuss);

    overlay.appendChild(box);
    if (eintrag.dismissable) {
      overlay.addEventListener('mousedown', (ev) => { if (ev.target === overlay) schliesse(eintrag.escValue); });
    }

    document.body.appendChild(overlay);
    dialogStapel.push(eintrag);
    if (!dialogTastenListener) { document.addEventListener('keydown', dialogTasten, true); dialogTastenListener = true; }
    document.body.classList.add('tv-modal-offen');

    // Fokus auf den ersten sinnvollen Knopf (bevorzugt 'primary')
    const primaer = fuss.querySelector('.tv-btn--primary') || fuss.querySelector('.tv-btn');
    const zuerst = box.querySelector('[autofocus]') || primaer;
    if (zuerst) zuerst.focus();

    if (opts.onOpen) opts.onOpen(api);

    let geschlossen = false;
    function schliesse(wert) {
      if (geschlossen) return;
      geschlossen = true;
      const i = dialogStapel.indexOf(eintrag);
      if (i >= 0) dialogStapel.splice(i, 1);
      overlay.classList.add('tv-overlay--zu');
      const weg = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
      // Kurze Ausblendzeit; falls die Animation nicht feuert, greift der Timer.
      overlay.addEventListener('animationend', weg, { once: true });
      setTimeout(weg, 260);
      if (!dialogStapel.length) document.body.classList.remove('tv-modal-offen');
      if (vorherFokus && vorherFokus.focus && vorherFokus.isConnected) vorherFokus.focus();
      resolve(wert);
    }
  });
}

/* ---------------------------------------------------------------------------
 * Rückfragen ein- und ausschalten (state.settings.bestaetigungen).
 *
 * render/ui.js kennt den Spielstand nicht und soll ihn auch nicht kennen.
 * Deshalb setzt main.js den Schalter beim Spielaufbau und der Einstellungs-
 * bildschirm danach live. Wer erfahren genug ist, sich das Nachfragen
 * abzustellen, bekommt es auch abgestellt – nur nicht bei Dingen, die keine
 * Spielentscheidung sind (Spielstand löschen: `{ immer: true }`).
 * ------------------------------------------------------------------------- */

let rueckfragenAn = true;

/** Schaltet alle confirm()-Rückfragen an oder aus. @returns {boolean} neuer Stand */
export function setBestaetigungen(an) {
  rueckfragenAn = an !== false;
  return rueckfragenAn;
}

/**
 * Fragt das Spiel gerade nach? Für Bildschirme, die statt confirm() einen eigenen
 * ausführlichen Warndialog zeigen (z. B. „Eine Legende verkaufen?").
 */
export function bestaetigungenAktiv() { return rueckfragenAn; }

/**
 * Ja/Nein-Rückfrage.
 * @param {object} [opts] `immer: true` fragt auch bei abgeschalteten Bestätigungen.
 */
export function confirm(title, text, opts = {}) {
  if (!rueckfragenAn && !opts.immer) return Promise.resolve(true);
  return dialog(title, el('p.tv-dialog-text', null, text), [
    { label: 'Abbrechen', value: false, kind: 'ghost' },
    { label: 'Ja, machen', value: true, kind: 'primary' }
  ], { escValue: false, size: 'sm' });
}

/** Schließt alle offenen Dialoge (z. B. beim Screenwechsel). */
export function closeAllDialogs(wert = null) {
  while (dialogStapel.length) dialogStapel[dialogStapel.length - 1].close(wert);
}

/**
 * Räumt die Überlagerungen weg, die *kein* Dialog sind: den Kurzhinweis und
 * die Meldungszettel. Erste Stufe der ESC-Kette in main.js – Dialoge und
 * Minispiele fangen ESC schon vorher ab und kommen hier nie an.
 *
 * @returns {boolean} true, wenn tatsächlich etwas geschlossen wurde.
 */
export function ueberlagerungenSchliessen() {
  if (tooltipKnoten && tooltipKnoten.classList.contains('tv-tooltip--an')) {
    tooltipVerstecken();
    return true;
  }
  if (toastSchacht && toastSchacht.isConnected) {
    const offen = Array.from(toastSchacht.children).filter(t => !t.classList.contains('tv-toast--zu'));
    if (offen.length) {
      for (const t of offen) { if (typeof t.tvClose === 'function') t.tvClose(); }
      return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOASTS
// ═══════════════════════════════════════════════════════════════════════════

let toastSchacht = null;

function ensureToastSchacht() {
  if (toastSchacht && toastSchacht.isConnected) return toastSchacht;
  toastSchacht = el('div.tv-toast-schacht', { 'aria-live': 'polite' });
  document.body.appendChild(toastSchacht);
  return toastSchacht;
}

/**
 * Kurzmeldung am rechten Rand.
 * @param {string|Node} text
 * @param {'info'|'gut'|'warn'|'schlecht'} [kind='info']
 * @param {object} [opts] ms, icon, onClick, titel
 */
export function toast(text, kind = 'info', opts = {}) {
  ensureStyles();
  const schacht = ensureToastSchacht();
  const art = TOAST_MS[kind] ? kind : 'info';
  const t = el('div.tv-toast', { class: `tv-toast--${art}`, role: 'status' },
    el('span.tv-toast-icon', null, opts.icon
      ? (typeof opts.icon === 'string' ? icon(opts.icon, 18) : opts.icon)
      : icon(art === 'gut' ? 'pfeil-hoch' : art === 'schlecht' ? 'pfeil-runter' : art === 'warn' ? 'pfeif' : 'brief', 18)),
    el('div.tv-toast-text', null,
      opts.titel ? el('div.tv-toast-titel', null, opts.titel) : null,
      el('div', null, text)));

  while (schacht.children.length >= TOAST_MAX) schacht.removeChild(schacht.firstChild);
  schacht.appendChild(t);

  let weg = null;
  const schliesse = () => {
    if (weg) clearTimeout(weg);
    t.classList.add('tv-toast--zu');
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 220);
  };
  weg = setTimeout(schliesse, opts.ms || TOAST_MS[art]);
  t.addEventListener('click', () => { if (opts.onClick) opts.onClick(); schliesse(); });
  t.tvClose = schliesse;
  return t;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOLTIP
// ═══════════════════════════════════════════════════════════════════════════

let tooltipKnoten = null;
let tooltipTimer = null;

function tooltipZeigen(target, text) {
  if (!tooltipKnoten || !tooltipKnoten.isConnected) {
    tooltipKnoten = el('div.tv-tooltip', { role: 'tooltip' });
    document.body.appendChild(tooltipKnoten);
  }
  tooltipKnoten.textContent = '';
  appendChild(tooltipKnoten, text);
  tooltipKnoten.classList.add('tv-tooltip--an');

  const r = target.getBoundingClientRect();
  const tr = tooltipKnoten.getBoundingClientRect();
  let left = r.left + r.width / 2 - tr.width / 2;
  let top = r.top - tr.height - 8;
  let unten = false;
  if (top < 4) { top = r.bottom + 8; unten = true; }
  left = clamp(left, 6, Math.max(6, window.innerWidth - tr.width - 6));
  tooltipKnoten.style.left = Math.round(left) + 'px';
  tooltipKnoten.style.top = Math.round(top) + 'px';
  tooltipKnoten.classList.toggle('tv-tooltip--unten', unten);
}

function tooltipVerstecken() {
  if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = null; }
  if (tooltipKnoten) tooltipKnoten.classList.remove('tv-tooltip--an');
}

/**
 * Hängt einen Tooltip an ein Element. Erneuter Aufruf ersetzt den Text.
 * Gibt das Ziel zurück, damit sich Aufrufe verketten lassen.
 */
export function tooltip(target, text) {
  ensureStyles();
  if (!target) return target;
  target.dataset.tvTip = typeof text === 'string' ? text : '1';
  if (target.tvTipGebunden) { target.tvTipText = text; return target; }
  target.tvTipGebunden = true;
  target.tvTipText = text;

  const rein = () => {
    if (tooltipTimer) clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => tooltipZeigen(target, target.tvTipText), TOOLTIP_DELAY);
  };
  target.addEventListener('mouseenter', rein);
  target.addEventListener('focus', () => tooltipZeigen(target, target.tvTipText));
  target.addEventListener('mouseleave', tooltipVerstecken);
  target.addEventListener('blur', tooltipVerstecken);
  target.addEventListener('click', tooltipVerstecken);
  return target;
}

// ═══════════════════════════════════════════════════════════════════════════
// FORTSCHRITTSRING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ringförmige Fortschrittsanzeige (Fitness, Vertragslaufzeit, Trainingsziel).
 * opts: size (px, Default 64), thickness, label, sub, color, kind ('rating' nutzt ratingClass)
 */
export function progressRing(value, max = 100, opts = {}) {
  ensureStyles();
  const size = opts.size || 64;
  const dicke = opts.thickness || Math.max(4, size * 0.12);
  const r = (size - dicke) / 2;
  const umfang = 2 * Math.PI * r;
  const v = clamp(Number(value) || 0, 0, max);
  const anteil = max > 0 ? v / max : 0;
  const klasse = opts.color ? null : ratingClass(anteil * 99);

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'tv-ring-svg');

  const spur = document.createElementNS(ns, 'circle');
  spur.setAttribute('cx', String(size / 2)); spur.setAttribute('cy', String(size / 2));
  spur.setAttribute('r', String(r)); spur.setAttribute('fill', 'none');
  spur.setAttribute('stroke-width', String(dicke));
  spur.setAttribute('class', 'tv-ring-spur');

  const bogen = document.createElementNS(ns, 'circle');
  bogen.setAttribute('cx', String(size / 2)); bogen.setAttribute('cy', String(size / 2));
  bogen.setAttribute('r', String(r)); bogen.setAttribute('fill', 'none');
  bogen.setAttribute('stroke-width', String(dicke));
  bogen.setAttribute('stroke-linecap', 'round');
  bogen.setAttribute('stroke-dasharray', `${umfang.toFixed(2)}`);
  bogen.setAttribute('stroke-dashoffset', String((umfang * (1 - anteil)).toFixed(2)));
  bogen.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
  bogen.setAttribute('class', 'tv-ring-bogen' + (klasse ? ' ' + klasse : ''));
  if (opts.color) bogen.setAttribute('stroke', opts.color);

  svg.appendChild(spur);
  svg.appendChild(bogen);

  const wrap = el('div.tv-ring', { style: { width: size + 'px', height: size + 'px' } }, svg,
    el('div.tv-ring-text', null,
      el('span.tv-ring-wert', { style: { fontSize: Math.round(size * 0.28) + 'px' } },
        opts.label !== undefined ? opts.label : Math.round(v)),
      opts.sub ? el('span.tv-ring-sub', null, opts.sub) : null));
  if (opts.tooltip) tooltip(wrap, opts.tooltip);
  wrap.tvSetValue = (neu) => {
    const nv = clamp(Number(neu) || 0, 0, max);
    bogen.setAttribute('stroke-dashoffset', String((umfang * (1 - (max > 0 ? nv / max : 0))).toFixed(2)));
    const w = wrap.querySelector('.tv-ring-wert');
    if (w && opts.label === undefined) w.textContent = String(Math.round(nv));
  };
  return wrap;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAKTIK-REGLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 0–100-Regler mit Beschriftung links/rechts – die Taktik-Schieber aus Anstoß.
 * opts: left, right, onChange(v), onInput(v), min, max, step, showValue,
 *       marks:[{v,label}], disabled, tooltip
 */
export function slider(label, value = 50, opts = {}) {
  ensureStyles();
  const min = opts.min !== undefined ? opts.min : 0;
  const max = opts.max !== undefined ? opts.max : 100;
  const wertAnzeige = el('span.tv-slider-wert', null, String(Math.round(value)));

  const input = el('input.tv-slider-input', {
    type: 'range', min: String(min), max: String(max),
    step: String(opts.step || 1), value: String(clamp(value, min, max)),
    disabled: !!opts.disabled,
    'aria-label': typeof label === 'string' ? label : undefined
  });

  input.addEventListener('input', () => {
    const v = Number(input.value);
    wertAnzeige.textContent = String(v);
    if (opts.onInput) opts.onInput(v);
  });
  input.addEventListener('change', () => { if (opts.onChange) opts.onChange(Number(input.value)); });

  const kopf = el('div.tv-slider-kopf', null,
    el('span.tv-slider-label', null, label),
    opts.showValue === false ? null : wertAnzeige);

  const reihe = el('div.tv-slider-reihe', null,
    opts.left ? el('span.tv-slider-pol.tv-slider-pol--links', null, opts.left) : null,
    input,
    opts.right ? el('span.tv-slider-pol.tv-slider-pol--rechts', null, opts.right) : null);

  const marken = opts.marks && opts.marks.length
    ? el('div.tv-slider-marken', null, ...opts.marks.map((m) =>
      el('span.tv-slider-marke', { style: { left: ((m.v - min) / (max - min || 1)) * 100 + '%' } }, m.label)))
    : null;

  const wrap = el('div.tv-slider', null, kopf, reihe, marken);
  if (opts.tooltip) tooltip(wrap, opts.tooltip);
  wrap.tvValue = () => Number(input.value);
  wrap.tvSetValue = (v) => { input.value = String(clamp(v, min, max)); wertAnzeige.textContent = String(Math.round(clamp(v, min, max))); };
  wrap.tvInput = input;
  return wrap;
}

// ═══════════════════════════════════════════════════════════════════════════
// PILLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Kleines Etikett: Position, Status, Vertragsdauer, Trait …
 * kind: 'info'|'gut'|'warn'|'schlecht'|'gold'|'neutral'|'rot'|'blau'
 */
export function pill(text, kind = 'neutral') {
  ensureStyles();
  return el('span.tv-pill', { class: `tv-pill--${kind}` }, text);
}

// ═══════════════════════════════════════════════════════════════════════════
// ICONS (Inline-SVG, 24×24-Raster, currentColor)
// ═══════════════════════════════════════════════════════════════════════════

const ICONS = {
  ball: '<circle cx="12" cy="12" r="9.2" fill="#fff" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M12 6.4 15.7 9.1 14.3 13.5H9.7L8.3 9.1z" fill="currentColor"/>' +
    '<path d="M12 6.4V2.9M15.7 9.1l3.4-1.1M14.3 13.5l2.1 2.9M9.7 13.5l-2.1 2.9M8.3 9.1 4.9 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',

  trikot: '<path d="M8.6 3.2 4 5.6l1.5 4.2 2-0.7V21h9V9.1l2 0.7L20 5.6l-4.6-2.4a3.6 3.6 0 0 1-6.8 0Z" ' +
    'fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',

  pfeif: '<path d="M3 9h9l3.4-2.6v11.2L12 15H3z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M17.6 8.4a5.5 5.5 0 0 1 0 7.2M20 6a9 9 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',

  herz: '<path d="M12 20.6 4.4 13a4.7 4.7 0 1 1 7.6-5.4A4.7 4.7 0 1 1 19.6 13Z" fill="currentColor"/>',

  geld: '<rect x="2.5" y="6" width="19" height="12" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
    '<circle cx="12" cy="12" r="3" fill="currentColor"/>' +
    '<path d="M5.5 9.2h1.2M17.3 14.8h1.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',

  pokal: '<path d="M8 3h8v5.5a4 4 0 0 1-8 0Z" fill="currentColor"/>' +
    '<path d="M8 4.5H5.2v1.6A3.4 3.4 0 0 0 8.6 9.5M16 4.5h2.8v1.6a3.4 3.4 0 0 1-3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path d="M11 12.4h2V16h-2z" fill="currentColor"/><path d="M7.6 20.6h8.8l-1-2.8H8.6z" fill="currentColor"/>',

  'pfeil-hoch': '<path d="M12 4.2 20 15h-5.2v5H9.2v-5H4z" fill="currentColor"/>',
  'pfeil-runter': '<path d="M12 19.8 4 9h5.2V4h5.6v5H20z" fill="currentColor"/>',

  verletzt: '<rect x="2.6" y="8.6" width="18.8" height="6.8" rx="3.4" transform="rotate(-32 12 12)" ' +
    'fill="currentColor"/><circle cx="12" cy="12" r="3.1" fill="#fff"/>' +
    '<path d="M12 10.1v3.8M10.1 12h3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',

  'karte-gelb': '<rect x="6" y="2.8" width="12" height="18.4" rx="1.6" fill="#f2c500" stroke="#8a6d00" stroke-width="1.3"/>',
  'karte-rot': '<rect x="6" y="2.8" width="12" height="18.4" rx="1.6" fill="#d1332e" stroke="#7a1512" stroke-width="1.3"/>',

  stern: '<path d="m12 2.6 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9z" fill="currentColor"/>',

  schloss: '<rect x="4.6" y="10.4" width="14.8" height="10.4" rx="1.8" fill="currentColor"/>' +
    '<path d="M8 10.4V7.8a4 4 0 0 1 8 0v2.6" fill="none" stroke="currentColor" stroke-width="1.9"/>',

  brief: '<rect x="2.4" y="5" width="19.2" height="14" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="m3.2 6.4 8.8 6.4 8.8-6.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',

  stadion: '<ellipse cx="12" cy="13.2" rx="9.6" ry="6" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
    '<ellipse cx="12" cy="13.2" rx="5" ry="2.8" fill="currentColor" opacity=".55"/>' +
    '<path d="M4.4 6.2v3M19.6 6.2v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M2.9 4.4h3v2.4h-3zM18.1 4.4h3v2.4h-3z" fill="currentColor"/>',

  training: '<path d="M11 4.6 6.2 18.2h9.6L11 4.6z" fill="currentColor"/>' +
    '<rect x="3.4" y="18" width="15.2" height="2.4" rx="1.2" fill="currentColor"/>' +
    '<circle cx="19.4" cy="7.4" r="2.8" fill="none" stroke="currentColor" stroke-width="1.6"/>',

  vertrag: '<path d="M5.4 2.8h9.2L19 7.2v14H5.4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
    '<path d="M14.2 3v4.4H19M8 11h8M8 14h8M8 17h4.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',

  scout: '<circle cx="10.6" cy="10.6" r="6.4" fill="none" stroke="currentColor" stroke-width="1.9"/>' +
    '<path d="m15.4 15.4 5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M7.6 10.6a3 3 0 0 1 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',

  arzt: '<rect x="2.6" y="7.4" width="18.8" height="12.4" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M8.6 7.4V5.6a1.6 1.6 0 0 1 1.6-1.6h3.6a1.6 1.6 0 0 1 1.6 1.6v1.8" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M12 10.4v6.4M8.8 13.6h6.4" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>'
};

/** Namen aller verfügbaren Icons. */
export const ICON_NAMES = Object.keys(ICONS);

/**
 * Inline-SVG-Icon.
 * @param {string} name  siehe ICON_NAMES
 * @param {number} [size=16]
 */
export function icon(name, size = ICON_SIZE) {
  ensureStyles();
  const inner = ICONS[name];
  const t = document.createElement('template');
  t.innerHTML = `<svg class="tv-icon tv-icon--${name}" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `aria-hidden="true" focusable="false">${inner || '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/>'}</svg>`;
  return t.content.firstElementChild;
}

// ═══════════════════════════════════════════════════════════════════════════
// LADEANZEIGE
// ═══════════════════════════════════════════════════════════════════════════

/** Rotierender Ball als Ladeanzeige. */
export function spinner(text) {
  ensureStyles();
  return el('div.tv-spinner', { role: 'status' },
    el('div.tv-spinner-ball'),
    text ? el('span.tv-spinner-text', null, text) : null);
}

// ═══════════════════════════════════════════════════════════════════════════
// NACHRICHTEN & LAUFBAND
// ═══════════════════════════════════════════════════════════════════════════

const NEWS_ICON = { info: 'brief', gut: 'pfeil-hoch', warn: 'pfeif', schlecht: 'pfeil-runter' };

/**
 * Eintrag im Post-Eingang / auf der Pinnwand.
 *
 * @param {string|object} msg  Text oder { titel, text, datum, kind, icon, gelesen }
 * @param {object} [opts] kind, icon, titel, datum, unread, onClick, actions:[Node]
 */
export function newsItem(msg, opts = {}) {
  ensureStyles();
  const o = typeof msg === 'object' && msg !== null ? msg : {};
  const titel = opts.titel || o.titel || o.title || null;
  const text = typeof msg === 'string' ? msg : (o.text || o.msg || '');
  const datum = opts.datum || o.datum || o.date || null;
  const art = opts.kind || o.kind || 'info';
  const ungelesen = opts.unread !== undefined ? opts.unread
    : (o.gelesen !== undefined ? !o.gelesen : false);
  const ic = opts.icon || o.icon || NEWS_ICON[art] || 'brief';

  const node = el('article.tv-news', {
    class: [`tv-news--${art}`, ungelesen ? 'tv-news--neu' : null, opts.onClick ? 'tv-news--klickbar' : null]
  },
  el('div.tv-news-icon', null, typeof ic === 'string' ? icon(ic, 18) : ic),
  el('div.tv-news-text', null,
    (titel || datum) ? el('div.tv-news-kopf', null,
      titel ? el('span.tv-news-titel', null, titel) : null,
      datum ? el('span.tv-news-datum', null, datum) : null) : null,
    el('div.tv-news-korpus', null, text),
    opts.actions && opts.actions.length ? el('div.tv-news-aktionen', null, ...opts.actions) : null));

  if (opts.onClick) {
    node.tabIndex = 0;
    node.addEventListener('click', opts.onClick);
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); opts.onClick(e); } });
  }
  return node;
}

/**
 * Laufband für die Live-Konferenz.
 *
 * @param {Array} items  Strings oder Nodes
 * @param {object} [opts] speed (px/s), gap (px), pauseOnHover (Default true),
 *                        kind (Farbakzent), separator
 * Die Animation stoppt automatisch, sobald das Element aus dem DOM fliegt –
 * Screens müssen nichts aufräumen.
 */
export function ticker(items, opts = {}) {
  ensureStyles();
  const band = el('div.tv-ticker-band');
  const wrap = el('div.tv-ticker', { class: opts.kind ? `tv-ticker--${opts.kind}` : null }, band);
  const speed = opts.speed || TICKER_SPEED;
  const gap = opts.gap !== undefined ? opts.gap : 42;
  band.style.gap = gap + 'px';

  let pause = false;
  if (opts.pauseOnHover !== false) {
    wrap.addEventListener('mouseenter', () => { pause = true; });
    wrap.addEventListener('mouseleave', () => { pause = false; });
  }

  function baue(liste) {
    clearNode(band);
    const eintraege = (liste || []).filter((x) => x !== null && x !== undefined && x !== '');
    if (!eintraege.length) { band.appendChild(el('span.tv-ticker-eintrag', null, 'Keine Meldungen.')); return; }
    // Zweifach anlegen, damit der Umlauf nahtlos wirkt.
    const f = document.createDocumentFragment();
    for (let dup = 0; dup < 2; dup++) {
      for (const it of eintraege) {
        const e = el('span.tv-ticker-eintrag');
        appendChild(e, it instanceof Node && dup === 1 ? it.cloneNode(true) : it);
        f.appendChild(e);
        if (opts.separator !== false) f.appendChild(el('span.tv-ticker-trenner', null, opts.separator || '◆'));
      }
    }
    band.replaceChildren(f);
  }
  baue(items);

  let off = 0;
  let letzte = 0;
  let laeuft = true;
  let warVerbunden = false;

  function schritt(now) {
    if (!laeuft) return;
    // Selbstaufräumung: erst aufhören, wenn das Element einmal im DOM war und
    // wieder entfernt wurde. Screens dürfen ihr Laufband also in Ruhe
    // vorbauen und erst später einhängen.
    if (wrap.isConnected) warVerbunden = true;
    else if (warVerbunden) { laeuft = false; return; }
    else { requestAnimationFrame(schritt); return; }
    if (!letzte) letzte = now;
    const dt = Math.min(0.1, (now - letzte) / 1000);
    letzte = now;
    if (!pause) {
      off += speed * dt;
      const halb = band.scrollWidth / 2;
      if (halb > 0 && off >= halb) off -= halb;
      band.style.transform = `translate3d(${-off}px,0,0)`;
    }
    requestAnimationFrame(schritt);
  }
  requestAnimationFrame(schritt);

  wrap.tvSetItems = (neu) => { baue(neu); off = 0; };
  wrap.tvStop = () => { laeuft = false; };
  return wrap;
}

// ═══════════════════════════════════════════════════════════════════════════
// STYLESHEET
// ═══════════════════════════════════════════════════════════════════════════

const CSS = `
@layer tv-ui {
:root{
  --tv-papier:#f2e8cf; --tv-beige:#e8d9b0; --tv-beige-dunkel:#d3c091; --tv-beige-hell:#f7f0dd;
  --tv-holz:#8b5a2b; --tv-holz-dunkel:#5f3d1c; --tv-holz-hell:#a9773f;
  --tv-rasen:#2f7d32; --tv-rasen-dunkel:#276b2a;
  --tv-rot:#c1272d; --tv-blau:#1c4f8f; --tv-gold:#d4a017;
  --tv-tinte:#241a10; --tv-tinte-matt:#6b5a42;
  --tv-bevel-hell:rgba(255,255,255,.72); --tv-bevel-dunkel:rgba(74,52,26,.55);
  --tv-radius:3px;
  --tv-schrift:'Trebuchet MS','Segoe UI',system-ui,-apple-system,sans-serif;
}
.tv-panel,.tv-subpanel,.tv-btn,.tv-tabelle,.tv-dialog,.tv-toast,.tv-tooltip,.tv-news,.tv-pill,.tv-tab{
  font-family:var(--tv-schrift); color:var(--tv-tinte); box-sizing:border-box;
}
.tv-panel *,.tv-dialog *,.tv-subpanel *{box-sizing:border-box}

/* ── Panels ─────────────────────────────────────────────────────────── */
.tv-panel{
  background:var(--tv-beige); border:2px solid; border-radius:var(--tv-radius);
  border-color:var(--tv-bevel-hell) var(--tv-bevel-dunkel) var(--tv-bevel-dunkel) var(--tv-bevel-hell);
  box-shadow:0 2px 6px rgba(40,25,8,.22); margin:0 0 10px;
}
.tv-panel-kopf{
  background:linear-gradient(180deg,var(--tv-holz) 0%,var(--tv-holz-dunkel) 100%);
  color:#fdf3dc; font-weight:700; text-transform:uppercase; letter-spacing:.09em;
  font-size:12px; padding:6px 10px; display:flex; align-items:center; gap:8px;
  flex-wrap:wrap;
  border-bottom:2px solid var(--tv-bevel-dunkel); text-shadow:0 1px 0 rgba(0,0,0,.45);
}
.tv-panel-kopf > :last-child:not(:only-child){margin-left:auto}
.tv-panel-korpus{padding:10px}
.tv-subpanel{
  background:var(--tv-papier); border:2px solid;
  border-color:var(--tv-bevel-dunkel) var(--tv-bevel-hell) var(--tv-bevel-hell) var(--tv-bevel-dunkel);
  border-radius:var(--tv-radius); margin:0 0 8px;
}
.tv-subpanel-kopf{
  font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em;
  color:var(--tv-holz-dunkel); padding:5px 8px; border-bottom:1px dashed var(--tv-beige-dunkel);
  display:flex; align-items:center; gap:6px; flex-wrap:wrap;
}
.tv-subpanel-kopf > :last-child:not(:only-child){margin-left:auto}
.tv-subpanel-korpus{padding:8px}

/* ── Knöpfe ─────────────────────────────────────────────────────────── */
.tv-btn{
  display:inline-flex; align-items:center; justify-content:center; gap:6px;
  padding:5px 12px; font-size:12px; font-weight:700; letter-spacing:.04em;
  background:linear-gradient(180deg,var(--tv-beige-hell),var(--tv-beige-dunkel));
  border:2px solid; border-color:var(--tv-bevel-hell) var(--tv-bevel-dunkel) var(--tv-bevel-dunkel) var(--tv-bevel-hell);
  border-radius:var(--tv-radius); cursor:pointer; user-select:none; line-height:1.5;
  text-transform:uppercase; transition:filter .08s, transform .04s;
}
.tv-btn:hover:not(:disabled){filter:brightness(1.07)}
.tv-btn:active:not(:disabled){
  transform:translateY(1px);
  border-color:var(--tv-bevel-dunkel) var(--tv-bevel-hell) var(--tv-bevel-hell) var(--tv-bevel-dunkel);
}
.tv-btn:focus-visible{outline:2px solid var(--tv-blau); outline-offset:1px}
.tv-btn:disabled{opacity:.5; cursor:not-allowed; filter:grayscale(.5)}
.tv-btn--primary{background:linear-gradient(180deg,#3f9b43,var(--tv-rasen-dunkel)); color:#f4ffe9}
.tv-btn--danger{background:linear-gradient(180deg,#d94a45,#992024); color:#fff2ef}
.tv-btn--gold{background:linear-gradient(180deg,#f2ce5c,#b8860b); color:#2c1d00}
.tv-btn--ghost{background:transparent; border-color:transparent; color:var(--tv-holz-dunkel); box-shadow:none}
.tv-btn--ghost:hover:not(:disabled){background:rgba(139,90,43,.13)}
.tv-btn--sm{padding:2px 7px; font-size:11px}
.tv-btn--lg{padding:9px 18px; font-size:14px}
.tv-btn--breit{width:100%}
.tv-btn-badge{
  background:var(--tv-rot); color:#fff; border-radius:9px; padding:0 5px;
  font-size:10px; min-width:16px; text-align:center;
}

/* ── Balken ─────────────────────────────────────────────────────────── */
.tv-bar{display:block; width:100%}
.tv-bar-kopf{display:flex; justify-content:space-between; align-items:baseline; font-size:11px; margin-bottom:2px}
.tv-bar-label{color:var(--tv-tinte-matt); letter-spacing:.03em}
.tv-bar-wert{font-weight:700; font-variant-numeric:tabular-nums}
.tv-bar-delta{margin-left:4px; font-size:10px}
.tv-bar-spur{
  position:relative; height:9px; background:#c3b593; border-radius:2px; overflow:hidden;
  box-shadow:inset 0 1px 2px rgba(0,0,0,.35);
}
.tv-bar--kompakt .tv-bar-spur{height:6px}
.tv-bar-fuellung{height:100%; background:var(--tv-rasen); transition:width .25s ease}
.tv-bar-potenzial{position:absolute; inset:0 auto 0 0; background:repeating-linear-gradient(45deg,rgba(255,255,255,.4) 0 3px,transparent 3px 6px)}
.tv-bar-fuellung.rat-elite{background:linear-gradient(180deg,#4dd07a,#12833f)}
.tv-bar-fuellung.rat-stark{background:linear-gradient(180deg,#8fd44a,#4c8f1e)}
.tv-bar-fuellung.rat-gut{background:linear-gradient(180deg,#d5d33f,#95960f)}
.tv-bar-fuellung.rat-ok{background:linear-gradient(180deg,#e9b843,#a97a0c)}
.tv-bar-fuellung.rat-schwach{background:linear-gradient(180deg,#e08a3d,#a3520d)}
.tv-bar-fuellung.rat-mies{background:linear-gradient(180deg,#d55450,#94211d)}
.tv-gut{color:#12833f}.tv-schlecht{color:#a3231f}.tv-warn{color:#a97a0c}

/* ── Kennzahlen ─────────────────────────────────────────────────────── */
/* min(96px,100%): Die Kachel wünscht sich 96 px, verlangt aber nie mehr, als
   ihr Kasten hergibt. Vorher sprengte eine Viererreihe von Kennzahlen jede
   schmale Seitenspalte – die Kacheln liefen übereinander und rechts hinaus. */
.tv-stat{
  display:flex; align-items:center; gap:8px; padding:7px 10px; min-width:min(96px,100%);
  background:var(--tv-papier); border:2px solid;
  border-color:var(--tv-bevel-hell) var(--tv-bevel-dunkel) var(--tv-bevel-dunkel) var(--tv-bevel-hell);
  border-radius:var(--tv-radius);
}
/* Wird die Spur wirklich eng (vier Kacheln in einer 320-px-Seitenspalte, wie
   auf Jugend und Trainerstab), muss der Text nachgeben statt die Kachel aus
   dem Panel zu schieben. „anywhere" bricht erst, wenn es ohne nicht geht. */
.tv-stat > *{min-width:0}
.tv-stat-label,.tv-stat-wert,.tv-stat-sub{overflow-wrap:anywhere}
.tv-stat--klickbar{cursor:pointer}
.tv-stat--klickbar:hover{filter:brightness(1.05)}
.tv-stat-icon{color:var(--tv-holz); display:flex}
.tv-stat-label{font-size:10px; text-transform:uppercase; letter-spacing:.09em; color:var(--tv-tinte-matt)}
.tv-stat-wert{font-size:17px; font-weight:700; font-variant-numeric:tabular-nums; line-height:1.15}
.tv-stat-sub{font-size:10px; color:var(--tv-tinte-matt)}
.tv-stat--gut .tv-stat-wert{color:#12833f}
.tv-stat--schlecht .tv-stat-wert{color:#a3231f}
.tv-stat--warn .tv-stat-wert{color:#a97a0c}
.tv-stat--gold{background:linear-gradient(180deg,#fbeec2,#e7d08a)}

/* ── Tabelle ────────────────────────────────────────────────────────── */
/* Die Hülle ist der eigene Scrollbereich der Tabelle: Breite Spaltensätze
   scrollen HIER waagerecht, nie die Seite. max-width:100% hält sie im Kasten,
   overscroll-behavior verhindert, dass am Ende der Tabelle die Seite mitruckt. */
.tv-tabelle-huelle{overflow:auto; max-width:100%; overscroll-behavior-x:contain; border:2px solid;
  border-color:var(--tv-bevel-dunkel) var(--tv-bevel-hell) var(--tv-bevel-hell) var(--tv-bevel-dunkel);
  border-radius:var(--tv-radius); background:var(--tv-papier)}
.tv-tabelle{width:100%; border-collapse:collapse; font-size:12px}
.tv-tabelle caption{font-size:11px; text-align:left; padding:4px 6px; color:var(--tv-tinte-matt)}
.tv-tabelle th{
  position:sticky; top:0; z-index:2; text-align:left; white-space:nowrap;
  background:linear-gradient(180deg,var(--tv-holz),var(--tv-holz-dunkel)); color:#fdf3dc;
  font-size:10px; text-transform:uppercase; letter-spacing:.07em; padding:5px 7px;
  border-right:1px solid rgba(0,0,0,.22); user-select:none;
}
.tv-tabelle th.tv-sortierbar{cursor:pointer}
.tv-tabelle th.tv-sortierbar:hover{filter:brightness(1.12)}
.tv-tabelle th:focus-visible{outline:2px solid #ffd97a; outline-offset:-2px}
.tv-sort-pfeil{display:inline-block; width:0; height:0; margin-left:5px; opacity:.35;
  border-left:4px solid transparent; border-right:4px solid transparent; border-bottom:5px solid currentColor}
.tv-sort-aktiv .tv-sort-pfeil{opacity:1}
.tv-sort-ab .tv-sort-pfeil{border-bottom:0; border-top:5px solid currentColor}
.tv-tabelle td{padding:4px 7px; border-bottom:1px solid rgba(139,90,43,.18); vertical-align:middle}
.tv-tabelle--kompakt td{padding:2px 6px; font-size:11px}
.tv-tabelle--zebra tbody tr:nth-child(even){background:rgba(139,90,43,.07)}
.tv-tabelle tbody tr.tv-reihe-klickbar{cursor:pointer}
.tv-tabelle tbody tr.tv-reihe-klickbar:hover{background:rgba(28,79,143,.14)}
.tv-tabelle tbody tr.tv-gewaehlt{background:rgba(212,160,23,.34); box-shadow:inset 3px 0 0 var(--tv-rot)}
.tv-tabelle tfoot td{font-weight:700; background:var(--tv-beige); border-top:2px solid var(--tv-holz-dunkel)}
.tv-a-right{text-align:right}.tv-a-center{text-align:center}.tv-a-left{text-align:left}
.tv-num{font-variant-numeric:tabular-nums}
.tv-leer{padding:18px; text-align:center; color:var(--tv-tinte-matt); font-style:italic}

/* ── Reiter ─────────────────────────────────────────────────────────── */
.tv-tab-leiste{display:flex; gap:2px; flex-wrap:wrap; border-bottom:2px solid var(--tv-holz-dunkel)}
.tv-tab{
  display:inline-flex; align-items:center; gap:5px; padding:5px 12px; cursor:pointer;
  font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
  background:linear-gradient(180deg,var(--tv-beige),var(--tv-beige-dunkel));
  border:2px solid var(--tv-bevel-dunkel); border-bottom:0;
  border-radius:var(--tv-radius) var(--tv-radius) 0 0; color:var(--tv-holz-dunkel);
  position:relative; top:2px;
}
.tv-tab:hover:not(:disabled){filter:brightness(1.07)}
.tv-tab:disabled{opacity:.45; cursor:not-allowed}
.tv-tab--aktiv{
  background:linear-gradient(180deg,var(--tv-holz),var(--tv-holz-dunkel)); color:#fdf3dc;
  top:0; padding-bottom:7px;
}
.tv-tab-badge{background:var(--tv-rot); color:#fff; border-radius:8px; padding:0 5px; font-size:9px}
.tv-tab-inhalt{padding:10px 0}
.tv-tabs--vertikal{display:flex; gap:10px}
.tv-tabs--vertikal .tv-tab-leiste{flex-direction:column; border-bottom:0; border-right:2px solid var(--tv-holz-dunkel)}
.tv-tabs--vertikal .tv-tab{top:0; border-bottom:2px solid var(--tv-bevel-dunkel); border-right:0;
  border-radius:var(--tv-radius) 0 0 var(--tv-radius)}
.tv-tabs--vertikal .tv-tab-inhalt{flex:1; padding:0}

/* ── Dialog ─────────────────────────────────────────────────────────── */
body.tv-modal-offen{overflow:hidden}
.tv-overlay{
  position:fixed; inset:0; background:rgba(20,12,4,.55); display:flex;
  align-items:center; justify-content:center; padding:20px;
  animation:tv-ein .14s ease-out;
}
.tv-overlay--zu{animation:tv-aus .18s ease-in forwards}
.tv-dialog{
  background:var(--tv-beige); width:100%; max-width:520px; max-height:88vh;
  display:flex; flex-direction:column;
  border:3px solid; border-color:var(--tv-bevel-hell) var(--tv-holz-dunkel) var(--tv-holz-dunkel) var(--tv-bevel-hell);
  border-radius:var(--tv-radius); box-shadow:0 12px 34px rgba(0,0,0,.5);
  animation:tv-hoch .16s ease-out;
}
.tv-dialog--sm{max-width:380px}.tv-dialog--lg{max-width:760px}.tv-dialog--xl{max-width:1000px}
.tv-dialog-kopf{
  display:flex; align-items:center; gap:10px; padding:7px 10px;
  background:linear-gradient(180deg,var(--tv-holz),var(--tv-holz-dunkel)); color:#fdf3dc;
  border-bottom:2px solid var(--tv-bevel-dunkel);
}
.tv-dialog-titel{margin:0; font-size:13px; text-transform:uppercase; letter-spacing:.09em;
  text-shadow:0 1px 0 rgba(0,0,0,.4)}
.tv-dialog-x{margin-left:auto; background:none; border:0; color:#fdf3dc; font-size:15px;
  cursor:pointer; line-height:1; padding:2px 5px; border-radius:2px}
.tv-dialog-x:hover{background:rgba(255,255,255,.2)}
.tv-dialog-korpus{padding:12px; overflow:auto; font-size:13px; line-height:1.5}
.tv-dialog-text{margin:0}
.tv-dialog-fuss{display:flex; justify-content:flex-end; gap:8px; padding:9px 12px;
  border-top:2px solid var(--tv-bevel-dunkel); background:var(--tv-beige-dunkel)}

/* ── Toasts ─────────────────────────────────────────────────────────── */
.tv-toast-schacht{position:fixed; top:14px; right:14px; z-index:1200;
  display:flex; flex-direction:column; gap:7px; pointer-events:none; max-width:340px}
.tv-toast{
  pointer-events:auto; display:flex; gap:9px; align-items:flex-start; cursor:pointer;
  padding:8px 11px; font-size:12px; background:var(--tv-papier);
  border:2px solid; border-color:var(--tv-bevel-hell) var(--tv-bevel-dunkel) var(--tv-bevel-dunkel) var(--tv-bevel-hell);
  border-left:5px solid var(--tv-blau); border-radius:var(--tv-radius);
  box-shadow:0 4px 12px rgba(0,0,0,.35); animation:tv-rein .2s ease-out;
}
.tv-toast--zu{animation:tv-raus .2s ease-in forwards}
.tv-toast--gut{border-left-color:#12833f}
.tv-toast--warn{border-left-color:var(--tv-gold)}
.tv-toast--schlecht{border-left-color:var(--tv-rot)}
.tv-toast-icon{flex:0 0 auto; color:var(--tv-holz); margin-top:1px}
.tv-toast--gut .tv-toast-icon{color:#12833f}
.tv-toast--schlecht .tv-toast-icon{color:var(--tv-rot)}
.tv-toast--warn .tv-toast-icon{color:var(--tv-gold)}
.tv-toast-titel{font-weight:700; text-transform:uppercase; letter-spacing:.05em; font-size:11px}

/* ── Tooltip ────────────────────────────────────────────────────────── */
.tv-tooltip{
  position:fixed; z-index:1400; pointer-events:none; opacity:0; transition:opacity .12s;
  max-width:280px; padding:5px 9px; font-size:11px; line-height:1.4;
  background:#2c1e0e; color:#f6ead0; border:1px solid var(--tv-gold); border-radius:3px;
  box-shadow:0 4px 12px rgba(0,0,0,.45);
}
.tv-tooltip--an{opacity:1}

/* ── Ring ───────────────────────────────────────────────────────────── */
.tv-ring{position:relative; display:inline-grid; place-items:center}
.tv-ring-svg{display:block}
.tv-ring-spur{stroke:#c3b593}
.tv-ring-bogen{stroke:var(--tv-rasen); transition:stroke-dashoffset .3s ease}
.tv-ring-bogen.rat-elite{stroke:#12833f}.tv-ring-bogen.rat-stark{stroke:#4c8f1e}
.tv-ring-bogen.rat-gut{stroke:#95960f}.tv-ring-bogen.rat-ok{stroke:#c58f0c}
.tv-ring-bogen.rat-schwach{stroke:#c2650f}.tv-ring-bogen.rat-mies{stroke:#a3231f}
.tv-ring-text{position:absolute; inset:0; display:grid; place-content:center; text-align:center; line-height:1.1}
.tv-ring-wert{font-weight:700; font-variant-numeric:tabular-nums}
.tv-ring-sub{font-size:9px; text-transform:uppercase; letter-spacing:.06em; color:var(--tv-tinte-matt)}

/* ── Regler ─────────────────────────────────────────────────────────── */
.tv-slider{margin:0 0 10px}
.tv-slider-kopf{display:flex; justify-content:space-between; font-size:11px;
  text-transform:uppercase; letter-spacing:.06em; color:var(--tv-tinte-matt); margin-bottom:2px}
.tv-slider-wert{font-weight:700; color:var(--tv-tinte); font-variant-numeric:tabular-nums}
.tv-slider-reihe{display:flex; align-items:center; gap:7px}
/* Die Pole dürfen umbrechen. Mit white-space:nowrap verlangte
   „Komplettsanierung" 110 px auch dann, wenn die Spalte nur 60 gab – und
   schob den ganzen Regler aus dem Panel. „anywhere" greift erst, wenn es
   ohne nicht geht; breite Bildschirme sehen keinen Unterschied. */
.tv-slider-pol{font-size:10px; color:var(--tv-tinte-matt); min-width:0;
  overflow-wrap:anywhere; hyphens:auto}
.tv-slider-pol--rechts{text-align:right}
.tv-slider-input{flex:1; -webkit-appearance:none; appearance:none; height:8px; border-radius:2px;
  background:linear-gradient(90deg,#b5a684,#d9caa6); box-shadow:inset 0 1px 2px rgba(0,0,0,.4); outline:none}
.tv-slider-input::-webkit-slider-thumb{-webkit-appearance:none; width:14px; height:18px; border-radius:2px;
  background:linear-gradient(180deg,var(--tv-beige-hell),var(--tv-holz)); border:1px solid var(--tv-holz-dunkel); cursor:grab}
.tv-slider-input::-moz-range-thumb{width:14px; height:18px; border-radius:2px;
  background:linear-gradient(180deg,var(--tv-beige-hell),var(--tv-holz)); border:1px solid var(--tv-holz-dunkel); cursor:grab}
.tv-slider-input:focus-visible{outline:2px solid var(--tv-blau); outline-offset:2px}
.tv-slider-marken{position:relative; height:12px; margin-top:1px}
.tv-slider-marke{position:absolute; transform:translateX(-50%); font-size:9px; color:var(--tv-tinte-matt)}

/* ── Pillen ─────────────────────────────────────────────────────────── */
.tv-pill{display:inline-block; padding:1px 7px; border-radius:9px; font-size:10px; font-weight:700;
  text-transform:uppercase; letter-spacing:.05em; border:1px solid rgba(0,0,0,.22);
  background:var(--tv-beige-dunkel); color:var(--tv-tinte)}
.tv-pill--gut{background:#2f9950; color:#f2fff5}
.tv-pill--warn{background:var(--tv-gold); color:#2c1d00}
.tv-pill--schlecht{background:var(--tv-rot); color:#fff}
.tv-pill--info{background:var(--tv-blau); color:#eaf2ff}
.tv-pill--gold{background:linear-gradient(180deg,#f2ce5c,#b8860b); color:#2c1d00}
.tv-pill--rot{background:var(--tv-rot); color:#fff}
.tv-pill--blau{background:var(--tv-blau); color:#eaf2ff}

/* ── Icons, Spinner ─────────────────────────────────────────────────── */
.tv-icon{display:inline-block; vertical-align:-.18em; flex:0 0 auto}
.tv-icon--pfeil-hoch{color:#12833f}.tv-icon--pfeil-runter{color:var(--tv-rot)}
.tv-icon--verletzt{color:var(--tv-rot)}.tv-icon--stern{color:var(--tv-gold)}
.tv-icon--pokal{color:var(--tv-gold)}.tv-icon--herz{color:#c8384a}
.tv-spinner{display:inline-flex; align-items:center; gap:8px; font-size:12px; color:var(--tv-tinte-matt)}
.tv-spinner-ball{width:18px; height:18px; border-radius:50%;
  background:radial-gradient(circle at 34% 30%,#fff 42%,#d8d2c2 43%);
  border:2px solid var(--tv-tinte); animation:tv-dreh .9s linear infinite;
  box-shadow:inset -3px -3px 0 rgba(0,0,0,.18)}

/* ── Nachrichten ────────────────────────────────────────────────────── */
.tv-news{display:flex; gap:9px; padding:8px 10px; margin-bottom:6px; background:var(--tv-papier);
  border:1px solid var(--tv-beige-dunkel); border-left:4px solid var(--tv-blau);
  border-radius:var(--tv-radius); font-size:12px; line-height:1.45}
.tv-news--gut{border-left-color:#2f9950}
.tv-news--warn{border-left-color:var(--tv-gold)}
.tv-news--schlecht{border-left-color:var(--tv-rot)}
.tv-news--neu{background:#fffaeb; box-shadow:0 0 0 1px var(--tv-gold) inset}
.tv-news--klickbar{cursor:pointer}
.tv-news--klickbar:hover{filter:brightness(.98); border-color:var(--tv-holz)}
.tv-news-icon{color:var(--tv-holz); flex:0 0 auto; margin-top:1px}
.tv-news-text{flex:1; min-width:0}
.tv-news-kopf{display:flex; gap:8px; align-items:baseline; margin-bottom:2px}
.tv-news-titel{font-weight:700; text-transform:uppercase; letter-spacing:.05em; font-size:11px}
.tv-news-datum{margin-left:auto; font-size:10px; color:var(--tv-tinte-matt); white-space:nowrap}
.tv-news-aktionen{display:flex; gap:6px; margin-top:6px}

/* ── Laufband ───────────────────────────────────────────────────────── */
.tv-ticker{overflow:hidden; white-space:nowrap; background:#1d1409; color:#f6e6bd;
  border-top:2px solid var(--tv-gold); border-bottom:2px solid var(--tv-holz-dunkel);
  padding:5px 0; font-size:12px; letter-spacing:.03em}
.tv-ticker-band{display:inline-flex; align-items:center; will-change:transform; padding-left:100%}
.tv-ticker-eintrag{flex:0 0 auto}
.tv-ticker-trenner{flex:0 0 auto; color:var(--tv-gold); font-size:9px}
.tv-ticker--gut{color:#bff0c8}.tv-ticker--schlecht{color:#ffc4c0}

/* ── Fokusringe (Stufe 6) ────────────────────────────────────────────
   Bisher trugen nur Knöpfe, Tabellenköpfe und Regler einen Ring. Reiter,
   klickbare Zeilen, Auswahlfelder, Ankreuzfelder und Eingabefelder gingen
   leer aus – wer die Maus weglegte, wusste nicht mehr, wo er steht.
   Durchweg mit :focus-visible, damit ein Mausklick keinen Ring hinterlässt.
   Zwei Farben, weil es zwei Untergründe gibt: Blau auf Papier, Gold auf Holz.

   Zuständigkeit: Diese Regeln gelten für die Bauteile DIESER Bibliothek.
   Alles, was die Bildschirme selbst bauen (nackte <input>, <select>, <label>),
   deckt styles/main.css ab – dieselbe Optik, aber eine Ebene weiter außen. */
.tv-tab:focus-visible,
.tv-toast:focus-visible,
.tv-news--klickbar:focus-visible,
.tv-stat--klickbar:focus-visible{outline:2px solid var(--tv-blau); outline-offset:1px}
.tv-panel :is(input,select,textarea,summary):focus-visible,
.tv-subpanel :is(input,select,textarea,summary):focus-visible,
.tv-dialog :is(input,select,textarea,summary):focus-visible{
  outline:2px solid var(--tv-blau); outline-offset:1px}
.tv-panel input[type=checkbox]:focus-visible,
.tv-panel input[type=radio]:focus-visible,
.tv-dialog input[type=checkbox]:focus-visible,
.tv-dialog input[type=radio]:focus-visible{outline-offset:2px}
/* Auf Holz: heller Ring, sonst verschwindet Blau im Braun. */
.tv-tab--aktiv:focus-visible,
.tv-dialog-x:focus-visible{outline:2px solid #ffd97a; outline-offset:1px}
/* Zeilen: der Ring läuft nach innen, sonst schneidet ihn die Nachbarzeile ab. */
.tv-tabelle tbody tr.tv-reihe-klickbar:focus-visible{
  outline:2px solid var(--tv-blau); outline-offset:-2px; background:rgba(28,79,143,.1)}

/* ── Animationen ────────────────────────────────────────────────────── */
@keyframes tv-ein{from{opacity:0}to{opacity:1}}
@keyframes tv-aus{to{opacity:0}}
@keyframes tv-hoch{from{transform:translateY(14px) scale(.97); opacity:.4}to{transform:none; opacity:1}}
@keyframes tv-rein{from{transform:translateX(28px); opacity:0}to{transform:none; opacity:1}}
@keyframes tv-raus{to{transform:translateX(28px); opacity:0}}
@keyframes tv-dreh{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){
  .tv-overlay,.tv-dialog,.tv-toast,.tv-spinner-ball{animation:none !important}
  .tv-bar-fuellung,.tv-ring-bogen{transition:none}
}
}
`;

let stilGesetzt = false;

/** Injiziert das Stylesheet genau einmal. Ohne DOM (Node-Test) passiert nichts. */
export function ensureStyles() {
  if (stilGesetzt || !hatDOM()) return;
  stilGesetzt = true;
  if (document.getElementById(UI_STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = UI_STYLE_ID;
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
}

if (hatDOM()) ensureStyles();
