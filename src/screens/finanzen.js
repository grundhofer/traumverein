/**
 * screens/finanzen.js — Der Schreibtisch des Schatzmeisters.
 *
 * Kontostand, Bilanz, Kontoverlauf, Buchungen, Kredite, Sponsoren,
 * Gehaltsstruktur und die stets etwas ungnädige Vorstandsbewertung.
 *
 * Der Bildschirm rechnet nichts selbst: alle Zahlen und alle Zustandsänderungen
 * laufen über club/finances.js und club/sponsors.js. Wo hier doch eine Formel
 * steht (Zinsschätzung im Kreditdialog), ist sie als Schätzung ausgewiesen und
 * spiegelt lediglich die Konstanten aus finances.js für die Vorschau.
 */

import {
  el, panel, subpanel, button, bar as uiBar, table, dialog, toast, pill, statBox,
  slider, confirm as bestaetigen
} from '../render/ui.js';
import {
  formatMoney, formatMoneyShort, nfmt, clamp, formatDateShort, sortBy
} from '../core/util.js';
import { myClub, squadOf, stateRng } from '../core/state.js';
import { POSITION_GROUP, GROUP_NAMES, POSITION_NAMES } from '../core/constants.js';
import { portraitDataURL } from '../render/portraits.js';
import {
  KATEGORIEN, bilanz, prognose, wochenSaldo, gehaltsbudget,
  insolvenzCheck, kreditAufnehmen, kreditTilgen, kreditrahmen, bonitaet,
  umsatzSchaetzung, transferbudgetSetzen
} from '../club/finances.js';
import {
  SPONSOR_SLOTS, SLOT_IDS, slotwert, angeboteGenerieren, verhandeln,
  sponsorAnnehmen, sponsorKuendigen, sponsorEinnahmenProSaison, angebotswert
} from '../club/sponsors.js';

/* ══════════════════════════════════════════════════════════════════════════
 *  Kleinkram
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Balken aus ui.js. `styles/main.css` belegt die Klasse `.tv-bar` zusätzlich mit
 * einer festen Höhe samt `overflow:hidden` (dort ist `.tv-bar` die Spur selbst).
 * Der Wrapper aus ui.js würde damit abgeschnitten — die drei Inline-Regeln
 * heben genau das auf, ohne fremde Dateien anzufassen.
 */
function bar(value, max, opts) {
  const n = uiBar(value, max, opts);
  n.style.height = 'auto';
  n.style.background = 'none';
  n.style.border = '0';
  n.style.borderRadius = '0';
  n.style.overflow = 'visible';
  return n;
}

/** Ruft `fn` ab und liefert bei Fehlern einen Ersatzwert statt eines Absturzes. */
function sicher(fn, ersatz, wo = '') {
  try {
    const v = fn();
    return v === undefined || v === null ? ersatz : v;
  } catch (err) {
    console.warn(`[finanzen] ${wo}:`, err);
    return ersatz;
  }
}

/** Panel mit klarer deutscher Fehlermeldung statt eines weißen Lochs. */
function fehlerPanel(titel, err) {
  return panel(titel,
    el('div.tv-spalte', null,
      el('p', { style: { margin: '0 0 6px' } },
        'Dieser Abschnitt konnte nicht aufgebaut werden. Die Geschäftsstelle sucht bereits nach dem Aktenordner.'),
      el('pre', {
        style: {
          whiteSpace: 'pre-wrap', fontSize: '11px', margin: 0,
          background: 'rgba(0,0,0,.14)', padding: '7px', border: '1px solid var(--linie)'
        }
      }, String((err && err.message) || err))));
}

/** Baut einen Abschnitt gekapselt: ein Fehler reißt nicht den ganzen Bildschirm mit. */
function abschnitt(titel, bauen) {
  try { return bauen(); } catch (err) { return fehlerPanel(titel, err); }
}

const geldKlasse = (v) => (v > 0 ? 'tv-gut' : v < 0 ? 'tv-schlecht' : '');

/** Kasten mit eigener Kopfzeile (linksbündiger Titel, rechtsbündige Kennzahl). */
function kasten(titel, ...kinder) {
  return el('div.tv-subpanel', { style: { padding: '0' } },
    el('div.tv-subpanel__titel', {
      style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 9px 4px', marginBottom: '0' }
    }, titel),
    el('div', { style: { padding: '7px 9px' } }, ...kinder));
}

/** Betrag mit Vorzeichen und Farbe. */
function geld(v, opts = {}) {
  const n = Math.round(v || 0);
  const txt = (opts.vorzeichen && n > 0 ? '+' : '') + formatMoney(n);
  return el('b', { class: geldKlasse(n), style: { fontFamily: 'var(--font-num)' } }, txt);
}

/** Prozent-Pfeil für den Vergleich zur Vorsaison. */
function trend(neu, alt) {
  if (!alt) return el('span.tv-mini', null, '—');
  const d = (neu - alt) / Math.abs(alt) * 100;
  if (!isFinite(d)) return el('span.tv-mini', null, '—');
  const gut = d >= 0;
  return el('span', {
    class: gut ? 'tv-gut' : 'tv-schlecht',
    style: { fontSize: '11px', fontFamily: 'var(--font-num)' }
  }, `${gut ? '▲' : '▼'} ${nfmt(Math.abs(d), 0)} %`);
}

/** Canvas auf Gerätepixel skalieren; liefert den vorbereiteten 2D-Kontext. */
function leinwand(canvas, hoehe) {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const breite = Math.max(320, canvas.clientWidth || canvas.parentElement && canvas.parentElement.clientWidth || 640);
  canvas.width = Math.round(breite * dpr);
  canvas.height = Math.round(hoehe * dpr);
  const c = canvas.getContext('2d');
  if (!c) return null;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, breite, hoehe);
  return { c, b: breite, h: hoehe };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Kontoverlauf
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Rekonstruiert den Kontostand je Buchungstag aus dem Ledger.
 * Der Startwert ergibt sich rückwärts aus dem heutigen Stand — so passt die
 * Kurve auch dann, wenn ältere Buchungen bereits gekürzt wurden.
 */
function kontoVerlauf(club) {
  const f = club.finances || {};
  const ledger = Array.isArray(f.ledger) ? f.ledger : [];
  const summe = ledger.reduce((s, e) => s + (e.betrag || 0), 0);
  let stand = Math.round((f.balance || 0) - summe);
  const map = new Map();
  for (const e of ledger) {
    stand += e.betrag || 0;
    map.set(`${e.season}:${e.day}`, { season: e.season, day: e.day, stand: Math.round(stand) });
  }
  const punkte = Array.from(map.values());
  if (!punkte.length) punkte.push({ season: 1, day: 0, stand: Math.round(f.balance || 0) });
  return punkte;
}

/** Liniendiagramm: Vergangenheit durchgezogen, Prognose gestrichelt. */
function zeichneKontoverlauf(canvas, verlauf, vorschau, opts = {}) {
  const setup = leinwand(canvas, opts.hoehe || 230);
  if (!setup) return;
  const { c, b, h } = setup;

  const padL = 62, padR = 12, padO = 14, padU = 24;
  const iw = Math.max(10, b - padL - padR);
  const ih = Math.max(10, h - padO - padU);

  const alleWerte = verlauf.map(p => p.stand).concat(vorschau.map(p => p.stand));
  let min = Math.min(...alleWerte, 0);
  let max = Math.max(...alleWerte, 0);
  if (max - min < 1000) { max += 1000; min -= 1000; }
  const luft = (max - min) * 0.08;
  min -= luft; max += luft;

  const n = Math.max(1, verlauf.length - 1);
  const m = vorschau.length;
  const gesamtX = n + m;
  const x = (i) => padL + (gesamtX > 0 ? (i / gesamtX) * iw : 0);
  const y = (v) => padO + ih - ((v - min) / (max - min)) * ih;

  // Hintergrund
  c.fillStyle = '#1b2a1c';
  c.fillRect(0, 0, b, h);
  c.fillStyle = 'rgba(255,255,255,.03)';
  for (let i = 0; i < b; i += 8) c.fillRect(i, 0, 1, h);

  // Gitter
  c.font = '10px "Consolas", monospace';
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = min + (max - min) * (i / 4);
    const yy = Math.round(y(v)) + 0.5;
    c.strokeStyle = 'rgba(255,255,255,.13)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(padL, yy); c.lineTo(b - padR, yy); c.stroke();
    c.fillStyle = 'rgba(240,232,200,.7)';
    c.fillText(formatMoneyShort(v), padL - 6, yy);
  }

  // Nulllinie
  if (min < 0 && max > 0) {
    const y0 = Math.round(y(0)) + 0.5;
    c.strokeStyle = '#e04b4b';
    c.lineWidth = 1.5;
    c.setLineDash([5, 4]);
    c.beginPath(); c.moveTo(padL, y0); c.lineTo(b - padR, y0); c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#ff9a9a';
    c.textAlign = 'left';
    c.fillText('NULL', padL + 3, y0 - 8);
    c.textAlign = 'right';
  }

  // Fläche unter der Verlaufskurve
  if (verlauf.length > 1) {
    const grd = c.createLinearGradient(0, padO, 0, padO + ih);
    grd.addColorStop(0, 'rgba(87,173,85,.45)');
    grd.addColorStop(1, 'rgba(87,173,85,.02)');
    c.beginPath();
    c.moveTo(x(0), y(verlauf[0].stand));
    verlauf.forEach((p, i) => c.lineTo(x(i), y(p.stand)));
    c.lineTo(x(verlauf.length - 1), padO + ih);
    c.lineTo(x(0), padO + ih);
    c.closePath();
    c.fillStyle = grd;
    c.fill();
  }

  // Verlaufskurve
  c.strokeStyle = '#8fe08f';
  c.lineWidth = 2;
  c.lineJoin = 'round';
  c.beginPath();
  verlauf.forEach((p, i) => (i === 0 ? c.moveTo(x(i), y(p.stand)) : c.lineTo(x(i), y(p.stand))));
  c.stroke();

  // Prognose
  if (m) {
    const startX = x(n), startY = y(verlauf[verlauf.length - 1].stand);
    c.strokeStyle = '#f0c956';
    c.lineWidth = 2;
    c.setLineDash([6, 5]);
    c.beginPath();
    c.moveTo(startX, startY);
    vorschau.forEach((p, i) => c.lineTo(x(n + i + 1), y(p.stand)));
    c.stroke();
    c.setLineDash([]);
    // Endpunkt markieren
    const ex = x(gesamtX), ey = y(vorschau[m - 1].stand);
    c.fillStyle = '#f0c956';
    c.beginPath(); c.arc(ex, ey, 3.5, 0, Math.PI * 2); c.fill();
  }

  // Achsenbeschriftung
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = 'rgba(240,232,200,.75)';
  const erster = verlauf[0], letzter = verlauf[verlauf.length - 1];
  c.fillText(formatDateShort(erster.day, erster.season), padL, h - 7);
  c.textAlign = 'center';
  c.fillText(formatDateShort(letzter.day, letzter.season), x(n), h - 7);
  if (m) {
    c.textAlign = 'right';
    c.fillStyle = '#f0c956';
    c.fillText(`Prognose +${m} Wochen`, b - padR, h - 7);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Panels
 * ══════════════════════════════════════════════════════════════════════════ */

function kopfleiste(ctx, club, bil, gb, check) {
  const f = club.finances || {};

  const budgetBalken = bar(clamp(gb.auslastung, 0, 130), 130, {
    label: 'Lohnsumme',
    valueText: `${nfmt(gb.auslastung, 0)} %`,
    color: gb.auslastung > 100 ? '#c1272d' : gb.auslastung > 88 ? '#d9a521' : '#3d9440',
    height: 8
  });

  return el('div.tv-grid.tv-grid--4', { style: { gap: '8px' } },
    statBox('Kontostand', formatMoney(f.balance || 0), {
      icon: 'geld',
      kind: (f.balance || 0) >= 0 ? 'gut' : 'schlecht',
      sub: (f.negativTage || 0) > 0 ? `seit ${f.negativTage} Tagen im Minus` : 'im grünen Bereich',
      tooltip: 'Der Stand, den die Bank heute Morgen gemeldet hat.'
    }),
    statBox('Schulden', formatMoney(bil.schulden || 0), {
      kind: (bil.schulden || 0) > 0 ? 'warn' : 'gut',
      sub: `${(bil.kredite || []).length} Darlehen · Quote ${nfmt(check.schuldenquote * 100, 0)} %`,
      tooltip: 'Restschuld aller laufenden Kredite inklusive Altlasten.'
    }),
    statBox('Transferbudget', formatMoney(f.transferBudget || 0), {
      icon: 'vertrag',
      sub: 'anklicken zum Ändern',
      onClick: () => transferbudgetDialog(ctx, club),
      tooltip: 'Was der Vorstand für Neuzugänge freigegeben hat.'
    }),
    el('div.tv-stat', { style: { flexDirection: 'column', alignItems: 'stretch', gap: '2px' } },
      el('div.tv-stat-label', null, 'Gehaltsbudget'),
      el('div.tv-stat-wert', { style: { fontFamily: 'var(--font-num)' } }, formatMoney(gb.budget)),
      el('div.tv-stat-sub', null,
        `${formatMoney(gb.verbraucht)} verbraucht · ${gb.frei >= 0 ? 'frei' : 'überzogen'} ${formatMoney(Math.abs(gb.frei))}`),
      budgetBalken));
}

async function transferbudgetDialog(ctx, club) {
  const f = club.finances || {};
  const anzeige = el('div', { class: 'tv-num', style: { fontSize: '18px', fontWeight: 700, textAlign: 'center' } },
    formatMoney(f.transferBudget || 0));
  let wunsch = Math.round(f.transferBudget || 0);
  const obergrenze = Math.max(1000000, Math.round((f.balance || 0) + kreditrahmen(ctx.state, club.id) * 0.5));

  const regler = slider('Wunschbudget', clamp(wunsch, 0, obergrenze), {
    min: 0, max: obergrenze, step: 100000,
    left: '0 €', right: formatMoney(obergrenze), showValue: false,
    onInput: (v) => { wunsch = v; anzeige.textContent = formatMoney(v); }
  });

  const res = await dialog('Transferbudget festlegen',
    el('div.tv-spalte', null,
      el('p', { style: { margin: 0 } },
        'Der Vorstand deckelt das Budget nach Kassenlage. Wer zu hoch greift, bekommt eine gekürzte Freigabe ' +
        'und einen Vortrag über kaufmännische Vorsicht.'),
      anzeige, regler,
      el('div.tv-mini', null,
        `Kontostand ${formatMoney(f.balance || 0)} · freier Kreditrahmen ` +
        `${formatMoney(sicher(() => kreditrahmen(ctx.state, club.id), 0, 'kreditrahmen'))}`)),
    [
      { label: 'Abbrechen', value: null, kind: 'ghost' },
      { label: 'Festlegen', value: 'ok', kind: 'primary' }
    ], { size: 'md' });

  if (res !== 'ok') return;
  const r = sicher(() => transferbudgetSetzen(ctx.state, club.id, wunsch), { ok: false, text: 'Das Budget ließ sich nicht setzen.' }, 'transferbudgetSetzen');
  toast(r.text, r.ok ? 'gut' : 'warn');
  ctx.aktualisiere();
  ctx.refresh();
}

function bilanzPanel(ctx, club, bil) {
  const f = club.finances || {};
  const vor = f.letzteSaison
    ? sicher(() => bilanz(ctx.state, club.id, { saison: 'letzte' }), null, 'bilanz(letzte)')
    : null;

  const vorWert = (liste, key) => {
    if (!vor) return 0;
    const p = (liste === 'ein' ? vor.einnahmen : vor.ausgaben).find(x => x.key === key);
    return p ? p.betrag : 0;
  };

  const spalte = (titel, posten, summe, art, farbe) => {
    const korpus = el('div');
    const box = kasten(el('span.tv-zeile', { style: { width: '100%' } },
      el('span', null, titel),
      el('span', { style: { marginLeft: 'auto', fontFamily: 'var(--font-num)' } }, formatMoney(summe))),
    korpus);
    if (!posten.length) {
      korpus.appendChild(el('div.tv-leer', { style: { padding: '14px' } },
        'Noch keine Buchungen in dieser Saison. Die Saison ist jung.'));
    }
    for (const p of posten) {
      const alt = vorWert(art, p.key);
      korpus.appendChild(el('div.tv-bilanz__zeile', null,
        el('span', null, p.label,
          el('span.tv-mini', { style: { marginLeft: '6px' } }, `${nfmt(p.anteil, 1)} %`)),
        el('span', { class: 'tv-zeile', style: { gap: '8px' } },
          vor ? trend(art === 'ein' ? p.betrag : -p.betrag, art === 'ein' ? alt : -alt) : null,
          el('b', { style: { color: farbe } }, formatMoney(p.betrag)))));
      korpus.appendChild(bar(p.anteil, 100, {
        showValue: false, compact: true, color: farbe, height: 4
      }));
    }
    korpus.appendChild(el('div.tv-bilanz__zeile.tv-bilanz__summe', null,
      el('span', null, 'Summe'), el('b', null, formatMoney(summe))));
    return box;
  };

  const ergebnisFarbe = bil.ergebnis >= 0 ? 'var(--gruen-600)' : 'var(--rot)';
  const historie = Array.isArray(bil.historie) ? bil.historie.slice(-4).reverse() : [];

  return panel(el('span', null, `Bilanz Saison ${bil.saison}`,
    el('span.tv-panel__extra', null, vor ? 'mit Vergleich zur Vorsaison' : 'erste Saison – kein Vergleich möglich')),
  el('div.tv-bilanz', null,
    spalte('Einnahmen', bil.einnahmen, bil.summeEinnahmen, 'ein', 'var(--gruen-600)'),
    spalte('Ausgaben', bil.ausgaben, bil.summeAusgaben, 'aus', 'var(--rot)')),
  el('div.tv-zeile.tv-zeile--verteilt', {
    style: {
      marginTop: '8px', padding: '7px 10px', background: 'rgba(0,0,0,.10)',
      border: '1px solid var(--linie)'
    }
  },
  el('div', null,
    el('div.tv-mini', null, 'Saisonergebnis'),
    el('b', { style: { fontSize: '20px', fontFamily: 'var(--font-num)', color: ergebnisFarbe } },
      (bil.ergebnis > 0 ? '+' : '') + formatMoney(bil.ergebnis))),
  el('div', null,
    el('div.tv-mini', null, 'Erwarteter Jahresumsatz'),
    el('b.tv-num', null, formatMoney(bil.umsatzPrognose))),
  el('div', null,
    el('div.tv-mini', null, 'Lohnquote'),
    el('b', {
      class: 'tv-num',
      style: { color: bil.gehaltsquote > 70 ? 'var(--rot)' : bil.gehaltsquote > 58 ? 'var(--gold)' : 'var(--gruen-600)' }
    }, `${nfmt(bil.gehaltsquote, 1)} %`)),
  vor
    ? el('div', null,
      el('div.tv-mini', null, 'Vorsaison'),
      el('b.tv-num', null, formatMoney(vor.ergebnis)))
    : null),
  historie.length
    ? el('div', { style: { marginTop: '8px' } },
      el('div.tv-subpanel__titel', null, 'Abgeschlossene Geschäftsjahre'),
      table([
        { key: 'season', label: 'Saison', width: 70 },
        { key: 'umsatz', label: 'Umsatz', numeric: true, render: r => formatMoney(r.umsatz) },
        { key: 'aufwand', label: 'Aufwand', numeric: true, render: r => formatMoney(r.aufwand) },
        { key: 'ergebnis', label: 'Ergebnis', numeric: true, render: r => geld(r.ergebnis, { vorzeichen: true }) },
        { key: 'balance', label: 'Kontostand', numeric: true, render: r => formatMoney(r.balance) }
      ], historie.map((h, i) => Object.assign({ id: 'h' + i }, h)), { compact: true }))
    : null);
}

function verlaufPanel(ctx, club) {
  const canvas = el('canvas.tv-chart', { style: { height: '230px' } });
  const verlauf = sicher(() => kontoVerlauf(club), [], 'kontoVerlauf');
  const vorschau = sicher(() => prognose(ctx.state, club.id, 16), [], 'prognose');
  const w = sicher(() => wochenSaldo(ctx.state, club.id), { einnahmen: 0, ausgaben: 0, saldo: 0, posten: [] }, 'wochenSaldo');
  const ende = vorschau.length ? vorschau[vorschau.length - 1].stand : (club.finances.balance || 0);

  const zeichnen = () => {
    if (!canvas.isConnected) return;
    sicher(() => zeichneKontoverlauf(canvas, verlauf, vorschau), null, 'zeichneKontoverlauf');
  };
  requestAnimationFrame(zeichnen);
  // Einmalige Nachzeichnung bei Größenänderung; der Screen wird bei jedem
  // Wechsel ohnehin komplett neu gebaut.
  if (typeof window !== 'undefined') window.addEventListener('resize', zeichnen, { once: true });

  const postenListe = el('div', null, ...(w.posten || []).map(p =>
    el('div.tv-bilanz__zeile', null,
      el('span', null, p.label),
      el('b', { class: geldKlasse(p.betrag) }, formatMoney(p.betrag)))));

  return panel(el('span', null, 'Kontoverlauf',
    el('span.tv-panel__extra', null, 'durchgezogen = gebucht · gestrichelt = Prognose')),
  canvas,
  el('div.tv-grid.tv-grid--3', { style: { marginTop: '9px' } },
    statBox('Wocheneinnahmen', formatMoney(w.einnahmen), { kind: 'gut' }),
    statBox('Wochenausgaben', formatMoney(w.ausgaben), { kind: 'schlecht' }),
    statBox('Wochensaldo', (w.saldo > 0 ? '+' : '') + formatMoney(w.saldo), {
      kind: w.saldo >= 0 ? 'gut' : 'schlecht',
      sub: `in 16 Wochen: ${formatMoney(ende)}`
    })),
  subpanel('Wiederkehrende Posten je Woche', postenListe));
}

function buchungenPanel(ctx, club) {
  const ledger = Array.isArray(club.finances && club.finances.ledger) ? club.finances.ledger : [];
  const letzte = ledger.slice(-60).reverse().map((e, i) => ({
    id: 'b' + i,
    tag: formatDateShort(e.day, e.season),
    sortTag: e.season * 1000 + e.day,
    kategorie: e.kategorie,
    katLabel: (KATEGORIEN[e.kategorie] && KATEGORIEN[e.kategorie].label) || e.kategorie,
    text: e.text || '',
    betrag: e.betrag || 0
  }));

  const vorhandene = Array.from(new Set(letzte.map(r => r.kategorie)));
  const auswahl = el('select', {
    style: { padding: '3px 6px', border: '1px solid var(--linie)', background: 'var(--papier)', fontSize: '11.5px' }
  },
  el('option', { value: '' }, 'Alle Kategorien'),
  ...vorhandene.map(k => el('option', { value: k },
    (KATEGORIEN[k] && KATEGORIEN[k].label) || k)));

  const summe = el('span.tv-mini');
  const setzeSumme = (rows) => {
    const ein = rows.filter(r => r.betrag > 0).reduce((s, r) => s + r.betrag, 0);
    const aus = rows.filter(r => r.betrag < 0).reduce((s, r) => s + r.betrag, 0);
    summe.textContent = `${rows.length} Buchungen · Ein ${formatMoney(ein)} · Aus ${formatMoney(aus)}`;
  };

  const tab = table([
    { key: 'sortTag', label: 'Tag', width: 92, numeric: true, align: 'left', render: r => r.tag },
    {
      key: 'katLabel', label: 'Kategorie', width: 140,
      render: r => pill(r.katLabel, r.betrag >= 0 ? 'gut' : 'neutral')
    },
    { key: 'text', label: 'Vorgang' },
    {
      key: 'betrag', label: 'Betrag', numeric: true, width: 120,
      render: r => geld(r.betrag, { vorzeichen: true })
    }
  ], letzte, {
    compact: true, maxHeight: 340,
    emptyText: 'Noch keine Buchungen. Der Kontoauszug ist so leer wie die Pressetribüne im Winter.'
  });
  setzeSumme(letzte);

  auswahl.addEventListener('change', () => {
    const k = auswahl.value;
    const rows = k ? letzte.filter(r => r.kategorie === k) : letzte;
    tab.tvSetRows(rows);
    setzeSumme(rows);
  });

  return panel(el('span', null, 'Buchungen',
    el('span.tv-panel__extra', null, 'die letzten 60 Vorgänge')),
  el('div.tv-filter', null, el('span.tv-mini', null, 'Filter:'), auswahl, summe),
  tab);
}

/* ── Kredite ────────────────────────────────────────────────────────────── */

/**
 * Vorschau des Zinssatzes. Spiegelt die Staffelung aus club/finances.js
 * (Basis 4,2 % bis 15,5 %, Aufschlag mit der Laufzeit) — die verbindliche
 * Zahl legt beim Abschluss ausschließlich kreditAufnehmen() fest.
 */
function zinsSchaetzung(bon, laufzeitWochen) {
  const BASIS = 0.042, MAXI = 0.155, LAUFZEIT_MAX = 312;
  return clamp(MAXI - (bon / 100) * (MAXI - BASIS) + (laufzeitWochen / LAUFZEIT_MAX) * 0.012, BASIS, MAXI);
}

function kreditePanel(ctx, club, bil) {
  const kredite = Array.isArray(bil.kredite) ? bil.kredite : [];
  const rahmen = sicher(() => kreditrahmen(ctx.state, club.id), 0, 'kreditrahmen');
  const bon = sicher(() => bonitaet(ctx.state, club.id), 50, 'bonitaet');

  const tab = table([
    { key: 'bank', label: 'Bank' },
    { key: 'betrag', label: 'Aufgenommen', numeric: true, render: r => formatMoney(r.betrag) },
    { key: 'restschuld', label: 'Restschuld', numeric: true, render: r => formatMoney(r.restschuld) },
    { key: 'zinsSatz', label: 'Zins', numeric: true, width: 66, render: r => `${nfmt(r.zinsSatz * 100, 2)} %` },
    { key: 'rateProWoche', label: 'Rate/Woche', numeric: true, render: r => formatMoney(r.rateProWoche) },
    { key: 'restWochen', label: 'Restlaufzeit', numeric: true, width: 96, render: r => `${r.restWochen || 0} Wochen` },
    {
      key: 'art', label: '', width: 96, sortable: false,
      render: r => r.altlast ? pill('Altlast', 'warn') : pill('laufend', 'info')
    }
  ], kredite.map((k, i) => Object.assign({ id: 'k' + i, idx: i }, k)), {
    compact: true,
    emptyText: 'Keine Kredite. Der Bankberater ruft trotzdem regelmäßig an.'
  });

  return panel(el('span', null, 'Kredite',
    el('span.tv-panel__extra', null, `Bonität ${bon}/100 · freier Rahmen ${formatMoney(rahmen)}`)),
  tab,
  el('div.tv-zeile', { style: { marginTop: '8px' } },
    button('Kredit aufnehmen', () => kreditDialog(ctx, club), { kind: 'primary', icon: 'geld' }),
    button('Sondertilgung', () => tilgungsDialog(ctx, club, kredite), { disabled: !kredite.length }),
    el('span.tv-mini', { style: { marginLeft: 'auto' } },
      bon >= 70 ? 'Die Bank mag uns. Das kann sich schnell ändern.'
        : bon >= 45 ? 'Die Bank prüft genau, aber sie prüft noch.'
          : 'Die Bank verlangt Sicherheiten. Und einen Kaffee.')));
}

async function kreditDialog(ctx, club) {
  const rahmen = sicher(() => kreditrahmen(ctx.state, club.id), 0, 'kreditrahmen');
  const bon = sicher(() => bonitaet(ctx.state, club.id), 50, 'bonitaet');

  if (rahmen < 250000) {
    await dialog('Kredit aufnehmen',
      el('p.tv-dialog-text', null,
        `Die Bank bewilligt derzeit gar nichts mehr — der freie Rahmen liegt bei ${formatMoney(rahmen)}. ` +
        'Erst Schulden abbauen, dann wieder anklopfen.'),
      [{ label: 'Verstanden', value: null, kind: 'ghost' }], { size: 'klein' });
    return;
  }

  let betrag = Math.min(rahmen, Math.max(250000, Math.round(rahmen / 2 / 50000) * 50000));
  let laufzeit = 104;

  const zeile = (label, wert) => el('div.tv-bilanz__zeile', null, el('span', null, label), el('b.tv-num', null, wert));
  const vBetrag = zeile('Kreditsumme', formatMoney(betrag));
  const vLaufzeit = zeile('Laufzeit', `${laufzeit} Wochen (${nfmt(laufzeit / 52, 1)} Jahre)`);
  const vZins = zeile('Zinssatz (voraussichtlich)', '');
  const vRate = zeile('Tilgung je Woche', '');
  const vKosten = zeile('Zinskosten gesamt (grob)', '');

  function neuRechnen() {
    const z = zinsSchaetzung(bon, laufzeit);
    const rate = Math.round(betrag / laufzeit);
    const zinsGesamt = Math.round(betrag * z * (laufzeit / 52) / 2);
    vBetrag.lastChild.textContent = formatMoney(betrag);
    vLaufzeit.lastChild.textContent = `${laufzeit} Wochen (${nfmt(laufzeit / 52, 1)} Jahre)`;
    vZins.lastChild.textContent = `${nfmt(z * 100, 2)} %`;
    vRate.lastChild.textContent = formatMoney(rate);
    vKosten.lastChild.textContent = `≈ ${formatMoney(zinsGesamt)}`;
  }

  const reglerBetrag = slider('Kreditsumme', betrag, {
    min: 250000, max: Math.max(300000, rahmen), step: 50000,
    left: '250 Tsd', right: formatMoneyShort(rahmen), showValue: false,
    onInput: (v) => { betrag = v; neuRechnen(); }
  });
  const reglerLaufzeit = slider('Laufzeit in Wochen', laufzeit, {
    min: 26, max: 312, step: 13,
    left: '26 (½ Jahr)', right: '312 (6 Jahre)', showValue: false,
    onInput: (v) => { laufzeit = v; neuRechnen(); }
  });
  neuRechnen();

  const res = await dialog('Kredit aufnehmen',
    el('div.tv-spalte', null,
      el('p', { style: { margin: 0 } },
        `Bonität ${bon} von 100. Wer gut dasteht, zahlt weniger Zinsen — die Bank ist da erfrischend ehrlich.`),
      reglerBetrag, reglerLaufzeit,
      el('div.tv-subpanel', null,
        el('div.tv-subpanel__titel', null, 'Konditionen'),
        el('div', { style: { padding: '6px 9px' } }, vBetrag, vLaufzeit, vZins, vRate, vKosten)),
      el('div.tv-mini', null,
        'Der endgültige Zinssatz wird beim Abschluss festgesetzt und kann geringfügig abweichen.')),
    [
      { label: 'Abbrechen', value: null, kind: 'ghost' },
      { label: 'Unterschreiben', value: 'ok', kind: 'primary' }
    ], { size: 'md' });

  if (res !== 'ok') return;
  const r = sicher(() => kreditAufnehmen(ctx.state, club.id, betrag, laufzeit),
    { ok: false, text: 'Der Kreditantrag ist im Fax stecken geblieben.' }, 'kreditAufnehmen');
  toast(r.text, r.ok ? 'gut' : 'schlecht');
  ctx.aktualisiere();
  ctx.refresh();
}

async function tilgungsDialog(ctx, club, kredite) {
  if (!kredite.length) return;
  const balance = Math.max(0, Math.round((club.finances && club.finances.balance) || 0));
  let idx = 0;
  let betrag = 0;

  const auswahl = el('select', {
    style: { padding: '4px 6px', width: '100%', border: '1px solid var(--linie)', background: 'var(--papier)' }
  }, ...kredite.map((k, i) => el('option', { value: String(i) },
    `${k.bank} — Restschuld ${formatMoney(k.restschuld)} zu ${nfmt(k.zinsSatz * 100, 2)} %`)));

  const info = el('div.tv-mini');
  const anzeige = el('div', { class: 'tv-num', style: { fontSize: '18px', fontWeight: 700, textAlign: 'center' } });
  const reglerBox = el('div');

  function baueRegler() {
    const k = kredite[idx];
    const max = Math.max(0, Math.min(k.restschuld, balance));
    betrag = Math.round(max / 2);
    reglerBox.innerHTML = '';
    if (max <= 0) {
      anzeige.textContent = '—';
      info.textContent = 'Für eine Sondertilgung fehlt schlicht das Geld auf dem Konto.';
      return;
    }
    anzeige.textContent = formatMoney(betrag);
    info.textContent = `Verfügbar: ${formatMoney(balance)} · Restschuld: ${formatMoney(k.restschuld)}`;
    reglerBox.appendChild(slider('Tilgungsbetrag', betrag, {
      min: 0, max, step: Math.max(10000, Math.round(max / 100 / 10000) * 10000),
      left: '0 €', right: formatMoneyShort(max), showValue: false,
      onInput: (v) => { betrag = v; anzeige.textContent = formatMoney(v); }
    }));
  }
  auswahl.addEventListener('change', () => { idx = Number(auswahl.value); baueRegler(); });
  baueRegler();

  const res = await dialog('Sondertilgung',
    el('div.tv-spalte', null,
      el('p', { style: { margin: 0 } },
        'Vorzeitig tilgen spart Zinsen und beruhigt den Aufsichtsrat. Beides ist selten kostenlos zu haben.'),
      auswahl, anzeige, reglerBox, info),
    [
      { label: 'Abbrechen', value: null, kind: 'ghost' },
      { label: 'Tilgen', value: 'ok', kind: 'primary' }
    ], { size: 'md' });

  if (res !== 'ok') return;
  const r = sicher(() => kreditTilgen(ctx.state, club.id, idx, betrag),
    { ok: false, text: 'Die Tilgung ließ sich nicht buchen.' }, 'kreditTilgen');
  toast(r.text, r.ok ? 'gut' : 'warn');
  ctx.aktualisiere();
  ctx.refresh();
}

/* ── Sponsoren ──────────────────────────────────────────────────────────── */

function sponsorenPanel(ctx, club) {
  const sp = club.sponsors || {};
  const einnahmen = sicher(() => sponsorEinnahmenProSaison(ctx.state, club.id),
    { grund: 0, boniMoeglich: 0, gesamt: 0 }, 'sponsorEinnahmenProSaison');

  const gitter = el('div.tv-grid.tv-grid--2');

  for (const slotId of SLOT_IDS) {
    const def = SPONSOR_SLOTS[slotId];
    const markt = sicher(() => slotwert(ctx.state, club.id, slotId), 0, 'slotwert');
    const angeboteHier = (sp.angebote || []).filter(a => a.slot === slotId);

    const korpus = el('div');
    const box = kasten(el('span.tv-zeile', { style: { width: '100%' } },
      el('span', null, def.name),
      el('span', { style: { marginLeft: 'auto', fontFamily: 'var(--font-num)', fontWeight: '400' } },
        `Marktwert ${formatMoney(markt)}`)),
    korpus);

    const vertraegeHier = def.mehrfach
      ? (Array.isArray(sp.bande) ? sp.bande.filter(Boolean) : [])
      : (sp[slotId] ? [sp[slotId]] : []);

    if (!vertraegeHier.length) {
      korpus.appendChild(el('div.tv-leer', { style: { padding: '10px' } },
        def.mehrfach ? 'Alle Bandenplätze frei. Die Bretter sind blank.' : 'Kein Partner. Der Platz ist frei.'));
    }

    vertraegeHier.forEach((v, i) => {
      const boni = v.boni || {};
      const bonusSumme = (boni.meister || 0) + (boni.pokalsieg || 0) + (boni.europacup || 0) +
        (boni.klassenerhalt || 0) + ((boni.platz && boni.platz.betrag) || 0);
      korpus.appendChild(el('div', {
        style: { padding: '5px 0', borderBottom: '1px dotted rgba(0,0,0,.18)' }
      },
      el('div.tv-zeile.tv-zeile--verteilt', null,
        el('div', null,
          el('b', null, v.firma),
          v.dubios ? pill('zweifelhaft', 'schlecht') : null,
          el('div.tv-mini', null,
            `${v.branche || 'Branche unbekannt'} · bis Saison ${v.bisSaison} · Seriosität ${v.seriositaet || '?'}`)),
        el('div', { style: { textAlign: 'right' } },
          el('b.tv-num', null, formatMoney(v.grundsumme)),
          el('div.tv-mini', null, `Boni bis ${formatMoney(bonusSumme)}`))),
      el('div.tv-zeile', { style: { marginTop: '4px' } },
        button('Kündigen', async () => {
          const rest = Math.max(0, (v.bisSaison || 0) - ctx.state.date.season + 1);
          const strafe = Math.round((v.grundsumme || 0) * rest * 0.25);
          const ja = await bestaetigen('Vertrag kündigen?',
            `${v.firma} vorzeitig loswerden kostet rund ${formatMoney(strafe)} Vertragsstrafe. Trotzdem kündigen?`);
          if (!ja) return;
          const r = sicher(() => sponsorKuendigen(ctx.state, club.id, slotId, i),
            { ok: false, text: 'Die Kündigung ging nicht durch.' }, 'sponsorKuendigen');
          toast(r.text, r.ok ? 'warn' : 'schlecht');
          ctx.aktualisiere();
          ctx.refresh();
        }, { kind: 'danger', size: 'klein' }))));
    });

    const platzFrei = def.mehrfach
      ? vertraegeHier.length < (def.plaetze || 1)
      : vertraegeHier.length === 0;

    korpus.appendChild(el('div.tv-zeile', { style: { marginTop: '6px' } },
      platzFrei
        ? button(angeboteHier.length ? `Angebote ansehen (${angeboteHier.length})` : 'Angebote einholen',
          () => angeboteDialog(ctx, club, slotId), { kind: 'primary', size: 'klein' })
        : el('span.tv-mini', null, 'Platz vergeben. Neue Angebote gibt es erst wieder nach Vertragsende.'),
      def.mehrfach && platzFrei
        ? el('span.tv-mini', { style: { marginLeft: 'auto' } },
          `${vertraegeHier.length} von ${def.plaetze} Plätzen belegt`)
        : null));

    gitter.appendChild(box);
  }

  return panel(el('span', null, 'Sponsoren',
    el('span.tv-panel__extra', null,
      `Grundsummen ${formatMoney(einnahmen.grund)} · mögliche Boni ${formatMoney(einnahmen.boniMoeglich)}`)),
  gitter);
}

/** Vor- und Nachteile eines Angebots in Klartext. */
function angebotsUrteil(a, markt) {
  const gut = [], schlecht = [];
  if (a.grundsumme >= markt * 1.1) gut.push('über Marktwert');
  if (a.grundsumme <= markt * 0.85) schlecht.push('unter Marktwert');
  if (a.laufzeit >= 4) gut.push('lange Planungssicherheit');
  if (a.laufzeit <= 1) schlecht.push('nur eine Saison');
  if (a.seriositaet >= 75) gut.push('tadelloser Ruf');
  if (a.seriositaet < 35) schlecht.push('zweifelhafter Ruf');
  if ((a.fanEffekt || 0) > 0) gut.push(`Fans dafür (+${a.fanEffekt})`);
  if ((a.fanEffekt || 0) < 0) schlecht.push(`Fans dagegen (${a.fanEffekt})`);
  const b = a.boni || {};
  const bonusSumme = (b.meister || 0) + (b.pokalsieg || 0) + (b.europacup || 0) +
    (b.klassenerhalt || 0) + ((b.platz && b.platz.betrag) || 0);
  if (bonusSumme >= a.grundsumme * 1.2) gut.push('fette Erfolgsprämien');
  if (bonusSumme <= a.grundsumme * 0.4) schlecht.push('kaum Prämien');
  return { gut, schlecht, bonusSumme };
}

async function angeboteDialog(ctx, club, slotId) {
  const def = SPONSOR_SLOTS[slotId];
  const sp = club.sponsors || {};
  const markt = sicher(() => slotwert(ctx.state, club.id, slotId), 0, 'slotwert');

  let angebote = (sp.angebote || []).filter(a => a.slot === slotId);
  if (!angebote.length) {
    const rng = stateRng(ctx.state, 'sponsorangebote:' + slotId);
    angebote = sicher(() => angeboteGenerieren(ctx.state, club.id, slotId, rng), [], 'angeboteGenerieren')
      .filter(a => a.slot === slotId);
    if (!angebote.length) {
      await dialog(def.name,
        el('p.tv-dialog-text', null,
          'Kein Unternehmen möchte derzeit auf unser Trikot. Vielleicht nach dem nächsten Heimsieg noch einmal fragen.'),
        [{ label: 'Schade', value: null, kind: 'ghost' }], { size: 'klein' });
      return;
    }
  }

  let neuOeffnen = false;
  let schliessen = () => {};

  const zeilen = angebote.map(a => {
    const u = angebotsUrteil(a, markt);
    const boni = a.boni || {};
    return kasten(
      el('span.tv-zeile', { style: { width: '100%' } },
        el('span', null, a.firma),
        pill(a.profilName || a.profil, a.dubios ? 'schlecht' : 'info'),
        el('span', { style: { marginLeft: 'auto', fontFamily: 'var(--font-num)', fontWeight: '400' } },
          `Gesamtwert ${formatMoney(sicher(() => angebotswert(a), a.grundsumme * a.laufzeit, 'angebotswert'))}`)),
      el('div', null,
        el('div.tv-grid.tv-grid--4', { style: { gap: '6px', marginBottom: '6px' } },
          statBox('Grundsumme', formatMoney(a.grundsumme), { sub: `Markt ${formatMoney(markt)}` }),
          statBox('Laufzeit', `${a.laufzeit} ${a.laufzeit === 1 ? 'Saison' : 'Saisons'}`, {
            sub: `Handgeld ${formatMoney(a.handgeld || 0)}`
          }),
          statBox('Seriosität', String(a.seriositaet), {
            kind: a.seriositaet >= 70 ? 'gut' : a.seriositaet < 35 ? 'schlecht' : 'warn'
          }),
          statBox('Erfolgsboni', formatMoney(u.bonusSumme), {
            sub: boni.platz ? `Platz ≤ ${boni.platz.bis}: ${formatMoney(boni.platz.betrag)}` : ''
          })),
        el('div.tv-mini', { style: { fontStyle: 'italic', marginBottom: '5px' } }, `„${a.spruch}"`),
        el('div.tv-zeile', { style: { flexWrap: 'wrap', gap: '4px', marginBottom: '6px' } },
          ...u.gut.map(t => pill('+ ' + t, 'gut')),
          ...u.schlecht.map(t => pill('− ' + t, 'schlecht'))),
        el('div.tv-bilanz__zeile', null,
          el('span', null, 'Boni: Meister / Pokal / Europa / Klassenerhalt'),
          el('b.tv-num', null,
            `${formatMoneyShort(boni.meister || 0)} · ${formatMoneyShort(boni.pokalsieg || 0)} · ` +
            `${formatMoneyShort(boni.europacup || 0)} · ${formatMoneyShort(boni.klassenerhalt || 0)}`)),
        el('div.tv-zeile', { style: { marginTop: '7px' } },
          button('Unterschreiben', async () => {
            const r = sicher(() => sponsorAnnehmen(ctx.state, club.id, slotId, a),
              { ok: false, text: 'Der Vertrag ließ sich nicht schließen.' }, 'sponsorAnnehmen');
            toast(r.text, r.ok ? 'gut' : 'schlecht');
            if (r.ok) { ctx.aktualisiere(); ctx.refresh(); }
            schliessen(null);
          }, { kind: 'primary', size: 'klein' }),
          button('Nachverhandeln', async () => {
            neuOeffnen = await verhandlungsDialog(ctx, club, slotId, a);
            schliessen(null);
          }, { size: 'klein', disabled: (a.verhandlungsrunden || 0) >= 3 }),
          el('span.tv-mini', { style: { marginLeft: 'auto' } },
            `Verhandlungsrunden: ${a.verhandlungsrunden || 0} von 3 · Stimmung ${a.stimmung || 70}`))));
  });

  await dialog(`${def.name} — ${angebote.length} Angebote`,
    (api) => {
      schliessen = api.close;
      return el('div.tv-spalte', null,
        el('p', { style: { margin: 0 } },
          `Marktwert dieses Werbeplatzes: ${formatMoney(markt)} pro Saison. ` +
          'Vergleichen Sie in Ruhe — die Herren mit den Aktentaschen warten schon länger als Sie denken.'),
        ...zeilen);
    },
    [{ label: 'Später entscheiden', value: null, kind: 'ghost' }], { size: 'xl' });

  if (neuOeffnen) await angeboteDialog(ctx, club, slotId);
}

/** @returns {Promise<boolean>} true, wenn die Angebotsliste erneut geöffnet werden soll */
async function verhandlungsDialog(ctx, club, slotId, a) {
  let wunsch = Math.round(a.grundsumme * 1.15 / 10000) * 10000;
  let laufzeit = a.laufzeit;
  const max = Math.round(a.grundsumme * 1.8 / 10000) * 10000;

  const anzeige = el('div', { class: 'tv-num', style: { fontSize: '18px', fontWeight: 700, textAlign: 'center' } },
    formatMoney(wunsch));
  const risiko = el('div.tv-mini', { style: { textAlign: 'center' } });

  function bewerten() {
    const gier = wunsch / Math.max(1, a.grundsumme);
    risiko.textContent = gier > 1.55
      ? 'Das ist dreist. Gut möglich, dass der Partner das Gespräch beendet.'
      : gier > 1.25
        ? 'Ambitioniert. Der Marketingchef wird tief durchatmen.'
        : gier > 1.05
          ? 'Übliche Nachforderung. Damit kann man arbeiten.'
          : 'Kaum mehr als das Angebot. Das kostet nur Zeit.';
  }
  bewerten();

  const reglerSumme = slider('Geforderte Grundsumme', wunsch, {
    min: a.grundsumme, max, step: 10000,
    left: formatMoneyShort(a.grundsumme), right: formatMoneyShort(max), showValue: false,
    onInput: (v) => { wunsch = v; anzeige.textContent = formatMoney(v); bewerten(); }
  });
  const reglerLaufzeit = slider('Gewünschte Laufzeit (Saisons)', laufzeit, {
    min: 1, max: 6, step: 1, left: '1', right: '6',
    onInput: (v) => { laufzeit = v; }
  });

  const res = await dialog(`Nachverhandeln mit ${a.firma}`,
    el('div.tv-spalte', null,
      el('p', { style: { margin: 0 } },
        `Aktuelles Angebot: ${formatMoney(a.grundsumme)} über ${a.laufzeit} ` +
        `${a.laufzeit === 1 ? 'Saison' : 'Saisons'}. Ihr Verhandlungsgeschick: ` +
        `${(ctx.state.manager && ctx.state.manager.skills && ctx.state.manager.skills.verhandlung) || 45}/100.`),
      anzeige, reglerSumme, reglerLaufzeit, risiko,
      el('div.tv-mini', null, 'Nach drei Runden ist Schluss — und wer zu viel will, steht am Ende ohne Partner da.')),
    [
      { label: 'Doch nicht', value: null, kind: 'ghost' },
      { label: 'Fordern', value: 'ok', kind: 'primary' }
    ], { size: 'md' });

  if (res !== 'ok') return true;

  const rng = stateRng(ctx.state, 'sponsorverhandlung:' + slotId);
  const r = sicher(() => verhandeln(ctx.state, club.id, slotId, a, { grundsumme: wunsch, laufzeit }, rng),
    { ok: false, text: 'Das Telefonat ist zusammengebrochen.', neuesAngebot: a }, 'verhandeln');
  toast(r.text, r.ok ? 'gut' : (r.neuesAngebot ? 'warn' : 'schlecht'));
  ctx.aktualisiere();
  return !!r.neuesAngebot;
}

/* ── Gehaltsstruktur ────────────────────────────────────────────────────── */

function gehaltsPanel(ctx, club, gb) {
  const kader = sicher(() => squadOf(ctx.state, club.id), [], 'squadOf').filter(Boolean);
  const gesamt = Math.max(1, kader.reduce((s, p) => s + ((p.contract && p.contract.salary) || 0), 0));
  const top = sortBy(kader.slice(), p => ({ key: (p.contract && p.contract.salary) || 0, desc: true })).slice(0, 12);
  const maxGehalt = top.length ? (top[0].contract.salary || 1) : 1;

  const zeile = (p) => {
    const salary = (p.contract && p.contract.salary) || 0;
    const anteil = salary / gesamt * 100;
    const legende = p.era === 'legend';
    const bild = sicher(() => portraitDataURL(p, 64), '', 'portraitDataURL');
    return el('div', {
      class: legende ? 'tv-talent zeile--legende' : 'tv-talent',
      style: legende
        ? { background: 'linear-gradient(90deg, rgba(217,165,33,.28), transparent 70%)' }
        : null
    },
    bild
      ? el('img', {
        src: bild, width: 34, height: 34,
        style: { width: '34px', height: '34px', border: '1px solid var(--linie)', background: 'rgba(0,0,0,.15)' }
      })
      : el('div', { style: { width: '34px', height: '34px', background: 'rgba(0,0,0,.2)' } }),
    el('div', { style: { flex: 1, minWidth: 0 } },
      el('div.tv-zeile', { style: { gap: '5px' } },
        el('b', { style: { fontSize: '12.5px' } }, `${p.shortName || p.lastName}`),
        pill(p.position, 'info'),
        legende ? el('span', { class: 'tv-pill tv-pill--legende' }, p.eraLabel || 'Legende') : null),
      el('div.tv-mini', null,
        `${POSITION_NAMES[p.position] || p.position} · ${p.age} Jahre · Vertrag bis Saison ${(p.contract && p.contract.until) || '?'}`),
      bar(salary, maxGehalt, { showValue: false, compact: true, color: legende ? '#d9a521' : '#3d9440', height: 5 })),
    el('div', { style: { textAlign: 'right', minWidth: '108px' } },
      el('b.tv-num', null, formatMoney(salary)),
      el('div.tv-mini', null, `${nfmt(anteil, 1)} % der Lohnsumme`)));
  };

  // Gehälter nach Positionsgruppen
  const gruppen = { TW: 0, ABW: 0, MIT: 0, STU: 0 };
  for (const p of kader) {
    const g = POSITION_GROUP[p.position] || 'MIT';
    gruppen[g] = (gruppen[g] || 0) + ((p.contract && p.contract.salary) || 0);
  }
  const gruppenListe = Object.entries(gruppen).map(([k, v]) => ({ k, v, anteil: v / gesamt * 100 }));

  const warnungen = [];
  if (gb.auslastung > 100) {
    warnungen.push(`Die Lohnsumme sprengt das Budget um ${formatMoney(Math.abs(gb.frei))}. Der Vorstand notiert so etwas.`);
  }
  const spitze = top[0];
  if (spitze && (spitze.contract.salary / gesamt) > 0.16) {
    warnungen.push(`${spitze.shortName || spitze.lastName} allein verschlingt ` +
      `${nfmt(spitze.contract.salary / gesamt * 100, 1)} % der Lohnsumme. Ein Spieler, ein Etat.`);
  }
  const abw = gruppenListe.find(g => g.k === 'ABW');
  const stu = gruppenListe.find(g => g.k === 'STU');
  if (stu && stu.anteil > 45) warnungen.push('Fast die halbe Lohnsumme steckt im Sturm. Hinten spielt die Kreisliga mit.');
  if (abw && abw.anteil > 45) warnungen.push('Die Abwehr kostet mehr als alles andere. Tore schießen andere.');
  if (!warnungen.length) warnungen.push('Die Gehaltsstruktur ist ausgewogen. Genießen Sie den Moment.');

  return panel(el('span', null, 'Gehaltsstruktur',
    el('span.tv-panel__extra', null,
      `Spieler ${formatMoney(gb.spieler)} · Stab ${formatMoney(gb.stab)}`)),
  el('div.tv-grid.tv-grid--seiten', null,
    subpanel('Nach Mannschaftsteilen',
      ...gruppenListe.map(g => el('div', { style: { marginBottom: '6px' } },
        bar(g.anteil, 100, {
          label: `${GROUP_NAMES[g.k] || g.k}`,
          valueText: `${formatMoney(g.v)} (${nfmt(g.anteil, 0)} %)`,
          height: 10
        }))),
      el('div.tv-trenner'),
      el('div.tv-bilanz__zeile', null, el('span', null, 'Lohnsumme Spieler'), el('b.tv-num', null, formatMoney(gb.spieler))),
      el('div.tv-bilanz__zeile', null, el('span', null, 'Trainerstab'), el('b.tv-num', null, formatMoney(gb.stab))),
      el('div.tv-bilanz__zeile.tv-bilanz__summe', null,
        el('span', null, 'Personalaufwand'), el('b.tv-num', null, formatMoney(gb.spieler + gb.stab))),
      el('div', { style: { marginTop: '8px' } },
        ...warnungen.map(w => el('div.tv-zettel', null, el('b', null, 'Notiz'), w)))),
    subpanel(`Top-Verdiener (${Math.min(12, kader.length)} von ${kader.length})`,
      ...(top.length ? top.map(zeile) : [el('div.tv-leer', null, 'Kein Kader vorhanden.')]))));
}

function vorstandsPanel(ctx, club, bil, check) {
  const gefahrFarbe = check.gefahr >= 70 ? '#c1272d' : check.gefahr >= 40 ? '#d9a521' : '#3d9440';
  const p = sicher(() => prognose(ctx.state, club.id, 8), [], 'prognose');
  const inAcht = p.length ? p[p.length - 1].stand : (club.finances.balance || 0);
  const umsatz = sicher(() => umsatzSchaetzung(ctx.state, club.id), 0, 'umsatzSchaetzung');

  const massnahmen = Array.isArray(check.massnahmen) ? check.massnahmen : [];

  return panel(el('span', null, 'Vorstandsbewertung der Finanzen',
    el('span.tv-panel__extra', null, club.board ? club.board.name : 'Der Vorstand')),
  el('div.tv-grid.tv-grid--seiten', null,
    el('div.tv-spalte', null,
      bar(check.gefahr, 100, {
        label: 'Insolvenzgefahr', valueText: `${check.gefahr} / 100`,
        color: gefahrFarbe, height: 14
      }),
      el('div.tv-bilanz__zeile', null, el('span', null, 'Schuldenquote'),
        el('b.tv-num', null, `${nfmt((check.schuldenquote || 0) * 100, 0)} % vom Jahresumsatz`)),
      el('div.tv-bilanz__zeile', null, el('span', null, 'Jahresumsatz (Struktur)'),
        el('b.tv-num', null, formatMoney(umsatz))),
      el('div.tv-bilanz__zeile', null, el('span', null, 'Tage im Minus'),
        el('b.tv-num', null, String(bil.negativTage || 0))),
      el('div.tv-bilanz__zeile', null, el('span', null, 'Kontostand in acht Wochen'),
        geld(inAcht)),
      el('div.tv-zeile', { style: { flexWrap: 'wrap', gap: '4px', marginTop: '6px' } },
        bil.transfersperre ? pill('Transfersperre', 'schlecht') : null,
        bil.punktabzug ? pill(`${bil.punktabzug} Punkte Abzug`, 'schlecht') : null,
        ...massnahmen.map(m => pill(m, 'warn')),
        (!bil.transfersperre && !bil.punktabzug && !massnahmen.length) ? pill('keine Auflagen', 'gut') : null)),
    el('div.tv-spalte', null,
      el('div.tv-zeitung', { style: { columnCount: '1', padding: '10px 12px' } },
        el('div.tv-zeitung__meta', null, 'Bericht des Schatzmeisters'),
        el('div.tv-zeitung__schlagzeile', { style: { fontSize: '17px' } },
          check.gefahr >= 70 ? 'Alarmstufe Rot in der Buchhaltung'
            : check.gefahr >= 40 ? 'Es knirscht im Gebälk'
              : 'Die Kasse stimmt'),
        el('div.tv-zeitung__text', null, check.text),
        el('div.tv-zeitung__text', { style: { marginTop: '6px', fontStyle: 'italic' } }, check.rat || ''),
        el('div.tv-trenner'),
        el('div.tv-zeitung__text', null, bil.bewertung || '')))));
}

/* ══════════════════════════════════════════════════════════════════════════
 *  SCREEN
 * ══════════════════════════════════════════════════════════════════════════ */

export const screen = {
  id: 'finanzen',
  title: 'Finanzen',
  icon: '💰',

  async render(root, ctx) {
    const club = sicher(() => myClub(ctx.state), null, 'myClub');
    if (!club) {
      root.appendChild(fehlerPanel('Finanzen', new Error('Kein Verein im Spielstand gefunden (state.managerClubId).')));
      return;
    }
    if (!club.finances) {
      root.appendChild(fehlerPanel('Finanzen', new Error('Dieser Verein hat keine Finanzdaten (club.finances fehlt).')));
      return;
    }

    const bil = sicher(() => bilanz(ctx.state, club.id), null, 'bilanz');
    if (!bil) {
      root.appendChild(fehlerPanel('Finanzen', new Error('club/finances.js liefert keine Bilanz.')));
      return;
    }
    const gb = sicher(() => gehaltsbudget(ctx.state, club.id),
      { verbraucht: 0, budget: 0, frei: 0, auslastung: 0, spieler: 0, stab: 0 }, 'gehaltsbudget');
    const check = sicher(() => insolvenzCheck(ctx.state, club.id),
      { gefahr: 0, text: '', rat: '', schuldenquote: 0, massnahmen: [] }, 'insolvenzCheck');

    const seite = el('div.tv-seite', null,
      el('div.tv-seite__kopf', null,
        el('h1.tv-seite__titel', null, 'Finanzen'),
        el('span.tv-seite__unter', null,
          `${club.name} · Saison ${ctx.state.date.season} · Schatzmeister-Sprechstunde täglich von neun bis kurz nach neun`)),
      abschnitt('Kennzahlen', () => kopfleiste(ctx, club, bil, gb, check)),
      el('div.tv-grid.tv-grid--haupt', null,
        abschnitt('Bilanz', () => bilanzPanel(ctx, club, bil)),
        abschnitt('Kontoverlauf', () => verlaufPanel(ctx, club))),
      el('div.tv-grid.tv-grid--haupt', null,
        abschnitt('Buchungen', () => buchungenPanel(ctx, club)),
        abschnitt('Kredite', () => kreditePanel(ctx, club, bil))),
      abschnitt('Sponsoren', () => sponsorenPanel(ctx, club)),
      abschnitt('Gehaltsstruktur', () => gehaltsPanel(ctx, club, gb)),
      abschnitt('Vorstandsbewertung', () => vorstandsPanel(ctx, club, bil, check)));

    root.appendChild(seite);
  }
};

export default screen;
