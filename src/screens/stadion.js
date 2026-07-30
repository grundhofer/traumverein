/**
 * screens/stadion.js — Das Wohnzimmer des Vereins.
 *
 * Stadionansicht, Kennzahlen, Ticketpreise, Ausbau, Zuschauerentwicklung,
 * Nebeneinnahmen und Rasenpflege.
 *
 * Gerechnet wird ausschließlich in club/stadium.js. Dieser Bildschirm zeigt an,
 * fragt nach und ruft die dortigen Aktionsfunktionen auf. Wo eine Zahl hier
 * geschätzt wird (Pflegekosten, Saisonhochrechnung), ist sie als Schätzung
 * ausgewiesen.
 */

import {
  el, panel, button, bar as uiBar, table, toast, pill, statBox,
  slider, confirm as bestaetigen
} from '../render/ui.js';
import { formatMoney, formatMoneyShort, nfmt, clamp, formatDateShort } from '../core/util.js';
import { myClub } from '../core/state.js';
import { drawCrest } from '../render/kits.js';
import {
  stadionState, referenzPreise, raenge, zuschauerBerechnen, preiseSetzen, preisEmpfehlung,
  ausbauAngebot, ausbauStarten, ausbauAbbrechen, rasenPflegen, cateringErtrag,
  stadionWert, betriebskostenJahr, heimvorteil, derbyInfo, rivalenVon
} from '../club/stadium.js';

/**
 * Heimspiele einer Ligasaison — Hochrechnungsfaktor für die Vorschau.
 * Spiegelt HEIMSPIELE_LIGA aus club/stadium.js.
 */
const HEIMSPIELE = 17;

/** Spiegelt RASEN_PFLEGE_KOSTEN_PRO_PUNKT / RASEN_PFLEGE_MAX aus club/stadium.js. */
const RASEN_KOSTEN_PRO_PUNKT = 9500;
const RASEN_MAX_PRO_MASSNAHME = 12;

/* ══════════════════════════════════════════════════════════════════════════
 *  Kleinkram
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Balken aus ui.js. `styles/main.css` belegt `.tv-bar` zusätzlich mit fester
 * Höhe und `overflow:hidden` — die Inline-Regeln heben das für den Wrapper auf,
 * ohne fremde Dateien anzufassen.
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

function sicher(fn, ersatz, wo = '') {
  try {
    const v = fn();
    return v === undefined || v === null ? ersatz : v;
  } catch (err) {
    console.warn(`[stadion] ${wo}:`, err);
    return ersatz;
  }
}

function fehlerPanel(titel, err) {
  return panel(titel,
    el('div.tv-spalte', null,
      el('p', { style: { margin: '0 0 6px' } },
        'Dieser Abschnitt konnte nicht aufgebaut werden. Der Hausmeister sucht schon den passenden Schlüssel.'),
      el('pre', {
        style: {
          whiteSpace: 'pre-wrap', fontSize: '11px', margin: 0,
          background: 'rgba(0,0,0,.14)', padding: '7px', border: '1px solid var(--linie)'
        }
      }, String((err && err.message) || err))));
}

function abschnitt(titel, bauen) {
  try { return bauen(); } catch (err) { return fehlerPanel(titel, err); }
}

/** Kasten mit eigener Kopfzeile (Titel links, Kennzahl rechts). */
function kasten(titel, ...kinder) {
  return el('div.tv-subpanel', { style: { padding: '0' } },
    el('div.tv-subpanel__titel', {
      style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 9px 4px', marginBottom: '0' }
    }, titel),
    el('div', { style: { padding: '7px 9px' } }, ...kinder));
}

function zeile(label, wert) {
  return el('div.tv-bilanz__zeile', null,
    el('span', null, label),
    wert instanceof Node ? wert : el('b.tv-num', null, wert));
}

/** Deterministischer Zufall fürs Zeichnen — kein Math.random(). */
function pseudo(seedText) {
  let t = 2166136261 >>> 0;
  const s = String(seedText || 'stadion');
  for (let i = 0; i < s.length; i++) { t ^= s.charCodeAt(i); t = Math.imul(t, 16777619) >>> 0; }
  return () => {
    t = (Math.imul(t, 1664525) + 1013904223) >>> 0;
    return t / 4294967296;
  };
}

function leinwand(canvas, hoehe) {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const breite = Math.max(360,
    canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 800);
  canvas.width = Math.round(breite * dpr);
  canvas.height = Math.round(hoehe * dpr);
  const c = canvas.getContext('2d');
  if (!c) return null;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, breite, hoehe);
  return { c, b: breite, h: hoehe };
}

function rechteckPfad(c, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr);
  c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr);
  c.quadraticCurveTo(x, y, x + rr, y);
  c.closePath();
}

/** Farbe aufhellen/abdunkeln (hex, -1 … +1). */
function tonen(hex, amt) {
  const h = String(hex || '#888888').replace('#', '');
  const v = h.length === 3 ? h.split('').map(x => x + x).join('') : h.padEnd(6, '0');
  const num = parseInt(v.slice(0, 6), 16);
  let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= (1 + amt); g *= (1 + amt); b *= (1 + amt); }
  const z = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${z(r)}${z(g)}${z(b)}`;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  STADIONANSICHT (prozedural)
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Schematische Draufsicht des Stadions aus club.stadium und stadiumState.
 * Ränge, Dach, Flutlicht, Videowand und die Zuschauerdichte kommen direkt
 * aus den Daten; gezeichnet wird in den Vereinsfarben.
 */
function zeichneStadion(canvas, club, s, opts = {}) {
  const setup = leinwand(canvas, opts.hoehe || 340);
  if (!setup) return;
  const { c, b: W, h: H } = setup;

  const st = club.stadium || {};
  const farben = club.colors || {};
  const primaer = farben.primary || '#1c4f8f';
  const sekundaer = farben.secondary || '#ffffff';
  const akzent = farben.accent || sekundaer;
  const raenge = clamp(Math.round(st.tiers || 1), 1, 4);
  const dach = !!st.roof;
  const flut = clamp(Math.round(st.floodlight || 0), 0, 5);
  const auslastung = clamp(opts.auslastung || 0, 0, 1);
  const stehAnteil = clamp(st.standing || 0, 0, 0.45);
  const rnd = pseudo(club.id + ':' + st.capacity);

  /* --- Geometrie ---------------------------------------------------- */
  const rand = 16;
  const ringDicke = Math.min(W, H) * (0.055 + 0.028 * raenge);
  const umlauf = ringDicke * 1.9;             // Gesamttiefe der Tribünenzone
  let pitchH = H - 2 * rand - 2 * umlauf;
  let pitchW = pitchH * (105 / 68);
  const maxW = W - 2 * rand - 2 * umlauf;
  if (pitchW > maxW) { pitchW = maxW; pitchH = pitchW * (68 / 105); }
  pitchH = Math.max(50, pitchH);
  pitchW = Math.max(80, pitchW);
  const px = Math.round((W - pitchW) / 2);
  const py = Math.round((H - pitchH) / 2);

  const aussenX = px - umlauf, aussenY = py - umlauf;
  const aussenW = pitchW + 2 * umlauf, aussenH = pitchH + 2 * umlauf;

  /* --- Umgebung ------------------------------------------------------ */
  const grd = c.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#232b1c');
  grd.addColorStop(1, '#141a11');
  c.fillStyle = grd;
  c.fillRect(0, 0, W, H);
  // Parkplatz-Textur
  c.fillStyle = 'rgba(255,255,255,.035)';
  for (let i = 0; i < 260; i++) {
    c.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 5, 1.5);
  }

  /* --- Außenhülle ---------------------------------------------------- */
  c.save();
  c.shadowColor = 'rgba(0,0,0,.65)';
  c.shadowBlur = 18;
  c.shadowOffsetY = 6;
  rechteckPfad(c, aussenX, aussenY, aussenW, aussenH, umlauf * 0.55);
  c.fillStyle = tonen(primaer, -0.62);
  c.fill();
  c.restore();

  rechteckPfad(c, aussenX, aussenY, aussenW, aussenH, umlauf * 0.55);
  c.strokeStyle = tonen(primaer, 0.18);
  c.lineWidth = 2;
  c.stroke();

  /* --- Ränge (von außen nach innen) ---------------------------------- */
  const tiefeProRang = umlauf / raenge;
  for (let t = 0; t < raenge; t++) {
    const ein = t * tiefeProRang;
    const x = aussenX + ein + 3, y = aussenY + ein + 3;
    const w = aussenW - 2 * (ein + 3), h = aussenH - 2 * (ein + 3);
    rechteckPfad(c, x, y, w, h, Math.max(3, (umlauf - ein) * 0.5));
    c.fillStyle = t % 2 === 0 ? tonen(primaer, -0.34) : tonen(primaer, -0.46);
    c.fill();
    // Sitzreihen andeuten
    c.strokeStyle = 'rgba(255,255,255,.07)';
    c.lineWidth = 1;
    for (let r = 4; r < tiefeProRang; r += 4) {
      rechteckPfad(c, x + r, y + r, w - 2 * r, h - 2 * r, Math.max(2, (umlauf - ein - r) * 0.5));
      c.stroke();
    }
  }

  /* --- Blocktrenner (Sektoren) --------------------------------------- */
  c.strokeStyle = 'rgba(0,0,0,.45)';
  c.lineWidth = 2;
  const sektoren = 9;
  for (let i = 1; i < sektoren; i++) {
    const f = i / sektoren;
    // oben und unten
    c.beginPath();
    c.moveTo(px + pitchW * f, aussenY + 4); c.lineTo(px + pitchW * f, py - 3);
    c.moveTo(px + pitchW * f, py + pitchH + 3); c.lineTo(px + pitchW * f, aussenY + aussenH - 4);
    c.stroke();
  }
  for (let i = 1; i < 6; i++) {
    const f = i / 6;
    c.beginPath();
    c.moveTo(aussenX + 4, py + pitchH * f); c.lineTo(px - 3, py + pitchH * f);
    c.moveTo(px + pitchW + 3, py + pitchH * f); c.lineTo(aussenX + aussenW - 4, py + pitchH * f);
    c.stroke();
  }

  /* --- Kurve (Stehplatzblock) ---------------------------------------- */
  if (stehAnteil > 0.02) {
    const kurveB = pitchW * clamp(0.34 + stehAnteil, 0.34, 0.9);
    const kx = px + (pitchW - kurveB) / 2;
    c.save();
    rechteckPfad(c, kx, aussenY + 5, kurveB, umlauf - 8, 4);
    c.fillStyle = tonen(primaer, -0.12);
    c.fill();
    // Choreo-Streifen in den Vereinsfarben
    const streifen = 7;
    for (let i = 0; i < streifen; i++) {
      c.fillStyle = i % 2 === 0 ? sekundaer : akzent;
      c.globalAlpha = 0.22;
      c.fillRect(kx + (kurveB / streifen) * i, aussenY + 6, kurveB / streifen - 1, 5);
    }
    c.globalAlpha = 1;
    c.restore();
  }

  /* --- Zuschauer ------------------------------------------------------ */
  const punktFarben = ['#f0e2c8', '#e8cfa8', '#c9a07a', '#8d6748', sekundaer, tonen(sekundaer, -0.25)];
  const raster = 5.2;
  const imRing = (x, y) =>
    x > aussenX + 4 && x < aussenX + aussenW - 4 && y > aussenY + 4 && y < aussenY + aussenH - 4 &&
    !(x > px - 4 && x < px + pitchW + 4 && y > py - 4 && y < py + pitchH + 4);

  for (let y = aussenY + 6; y < aussenY + aussenH - 6; y += raster) {
    for (let x = aussenX + 6; x < aussenX + aussenW - 6; x += raster) {
      if (!imRing(x, y)) continue;
      const wurf = rnd();
      // Kurve füllt sich zuerst, Oberränge zuletzt
      const obenKurve = y < py && stehAnteil > 0.02;
      const dichte = clamp(auslastung * (obenKurve ? 1.12 : 1) - (rnd() * 0.10), 0, 1);
      if (wurf > dichte) continue;
      c.fillStyle = punktFarben[Math.floor(rnd() * punktFarben.length)];
      c.globalAlpha = 0.55 + rnd() * 0.45;
      c.fillRect(x + rnd() * 1.6, y + rnd() * 1.6, 2.1, 2.1);
    }
  }
  c.globalAlpha = 1;

  /* --- Dach ------------------------------------------------------------ */
  if (dach) {
    c.save();
    rechteckPfad(c, aussenX + 2, aussenY + 2, aussenW - 4, aussenH - 4, umlauf * 0.5);
    c.clip();
    rechteckPfad(c, aussenX + 2, aussenY + 2, aussenW - 4, aussenH - 4, umlauf * 0.5);
    c.fillStyle = 'rgba(215,225,235,.22)';
    c.fill();
    // Dachkante mit Lichtkante
    c.strokeStyle = 'rgba(255,255,255,.5)';
    c.lineWidth = 2;
    c.stroke();
    // Dachträger
    c.strokeStyle = 'rgba(255,255,255,.16)';
    c.lineWidth = 1;
    for (let i = 1; i < 14; i++) {
      const f = i / 14;
      c.beginPath();
      c.moveTo(aussenX + aussenW * f, aussenY + 2);
      c.lineTo(aussenX + aussenW * f, py - 2);
      c.moveTo(aussenX + aussenW * f, py + pitchH + 2);
      c.lineTo(aussenX + aussenW * f, aussenY + aussenH - 2);
      c.stroke();
    }
    c.restore();
    // Schattenwurf des Daches auf den Rasen
    c.save();
    rechteckPfad(c, px, py, pitchW, pitchH, 3);
    c.clip();
    const sch = c.createLinearGradient(px, py, px, py + pitchH * 0.4);
    sch.addColorStop(0, 'rgba(0,0,0,.30)');
    sch.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = sch;
    c.fillRect(px, py, pitchW, pitchH);
    c.restore();
  }

  /* --- Rasen ----------------------------------------------------------- */
  const zustand = clamp((s && s.rasenZustand) || st.pitch || 80, 0, 99);
  const gruenHell = zustand > 82 ? '#3f9b43' : zustand > 62 ? '#4a8f3f' : '#7d8a44';
  const gruenDunkel = zustand > 82 ? '#2f7d32' : zustand > 62 ? '#3b7530' : '#66743a';
  c.save();
  rechteckPfad(c, px, py, pitchW, pitchH, 3);
  c.clip();
  const streifenBreite = pitchW / 12;
  for (let i = 0; i < 12; i++) {
    c.fillStyle = i % 2 === 0 ? gruenHell : gruenDunkel;
    c.fillRect(px + i * streifenBreite, py, streifenBreite + 1, pitchH);
  }
  // Abnutzung vor den Toren und in der Mitte
  if (zustand < 80) {
    c.fillStyle = `rgba(150,130,80,${clamp((80 - zustand) / 90, 0, 0.5)})`;
    c.fillRect(px, py + pitchH * 0.3, pitchW * 0.12, pitchH * 0.4);
    c.fillRect(px + pitchW * 0.88, py + pitchH * 0.3, pitchW * 0.12, pitchH * 0.4);
    c.fillRect(px + pitchW * 0.44, py, pitchW * 0.12, pitchH);
  }
  c.restore();

  /* --- Linien ----------------------------------------------------------- */
  const m = (v) => v * (pitchW / 105);   // Meter -> Pixel (Längsrichtung)
  const my = (v) => v * (pitchH / 68);
  c.strokeStyle = 'rgba(255,255,255,.85)';
  c.lineWidth = 1.6;
  c.strokeRect(px + 2, py + 2, pitchW - 4, pitchH - 4);
  c.beginPath();
  c.moveTo(px + pitchW / 2, py + 2);
  c.lineTo(px + pitchW / 2, py + pitchH - 2);
  c.stroke();
  c.beginPath();
  c.arc(px + pitchW / 2, py + pitchH / 2, my(9.15), 0, Math.PI * 2);
  c.stroke();
  // Strafräume
  const sr = { w: m(16.5), h: my(40.3) };
  const tr = { w: m(5.5), h: my(18.3) };
  c.strokeRect(px + 2, py + (pitchH - sr.h) / 2, sr.w, sr.h);
  c.strokeRect(px + pitchW - 2 - sr.w, py + (pitchH - sr.h) / 2, sr.w, sr.h);
  c.strokeRect(px + 2, py + (pitchH - tr.h) / 2, tr.w, tr.h);
  c.strokeRect(px + pitchW - 2 - tr.w, py + (pitchH - tr.h) / 2, tr.w, tr.h);
  // Elfmeterpunkte
  c.fillStyle = 'rgba(255,255,255,.85)';
  c.beginPath(); c.arc(px + m(11), py + pitchH / 2, 1.7, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(px + pitchW - m(11), py + pitchH / 2, 1.7, 0, Math.PI * 2); c.fill();
  // Eckviertel
  const eck = my(1.2);
  [[px + 2, py + 2, 0], [px + pitchW - 2, py + 2, Math.PI / 2],
    [px + pitchW - 2, py + pitchH - 2, Math.PI], [px + 2, py + pitchH - 2, -Math.PI / 2]]
    .forEach(([ex, ey, a]) => {
      c.beginPath();
      c.arc(ex, ey, eck, a, a + Math.PI / 2);
      c.stroke();
    });
  // Tore
  c.fillStyle = 'rgba(255,255,255,.92)';
  const torH = my(7.32);
  c.fillRect(px - 4, py + (pitchH - torH) / 2, 4, torH);
  c.fillRect(px + pitchW, py + (pitchH - torH) / 2, 4, torH);

  /* --- Wappen im Mittelkreis -------------------------------------------- */
  sicher(() => {
    const gr = Math.min(my(9.15) * 1.5, pitchH * 0.32);
    c.save();
    c.globalAlpha = 0.9;
    drawCrest(c, club, px + pitchW / 2, py + pitchH / 2, gr);
    c.restore();
  }, null, 'drawCrest');

  /* --- Videowände -------------------------------------------------------- */
  if (s && s.videowand) {
    const vw = pitchW * 0.2, vh = 9;
    [[px + pitchW * 0.5 - vw / 2, aussenY + umlauf * 0.18],
      [px + pitchW * 0.5 - vw / 2, aussenY + aussenH - umlauf * 0.18 - vh]]
      .forEach(([vx, vy]) => {
        c.fillStyle = '#0d0f12';
        c.fillRect(vx - 2, vy - 2, vw + 4, vh + 4);
        const g2 = c.createLinearGradient(vx, vy, vx + vw, vy + vh);
        g2.addColorStop(0, tonen(primaer, 0.35));
        g2.addColorStop(1, tonen(akzent, 0.1));
        c.fillStyle = g2;
        c.fillRect(vx, vy, vw, vh);
      });
  }

  /* --- Flutlicht ---------------------------------------------------------- */
  if (flut > 0) {
    const masten = [
      [aussenX + 6, aussenY + 6, 1, 1], [aussenX + aussenW - 6, aussenY + 6, -1, 1],
      [aussenX + aussenW - 6, aussenY + aussenH - 6, -1, -1], [aussenX + 6, aussenY + aussenH - 6, 1, -1]
    ];
    for (const [mx, myy, dx, dy] of masten) {
      // Lichtkegel
      const rgrad = c.createRadialGradient(mx, myy, 4, mx, myy, Math.max(pitchW, pitchH) * 0.72);
      const staerke = 0.05 + flut * 0.035;
      rgrad.addColorStop(0, `rgba(255,246,200,${clamp(staerke * 2.2, 0, 0.6)})`);
      rgrad.addColorStop(0.45, `rgba(255,246,200,${staerke * 0.55})`);
      rgrad.addColorStop(1, 'rgba(255,246,200,0)');
      c.fillStyle = rgrad;
      c.fillRect(0, 0, W, H);
      // Mast
      c.fillStyle = '#c9c4b4';
      c.fillRect(mx - 3, myy - 3, 6, 6);
      c.fillStyle = '#fff6c8';
      for (let i = 0; i < Math.min(flut, 5); i++) {
        c.fillRect(mx - 3 + dx * (i * 2.2), myy - 3 + dy * (i * 2.2), 2, 2);
      }
    }
  }

  /* --- Beschriftung ------------------------------------------------------- */
  const plakette = (text, x, y, alignRight) => {
    c.font = 'bold 11px "Segoe UI", "Trebuchet MS", sans-serif';
    const bw = c.measureText(text).width + 14;
    const bx = alignRight ? x - bw : x;
    c.fillStyle = 'rgba(20,14,6,.72)';
    rechteckPfad(c, bx, y, bw, 18, 2);
    c.fill();
    c.strokeStyle = 'rgba(240,201,86,.75)';
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = '#f6ead0';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(text, bx + 7, y + 9.5);
  };
  plakette(st.name || 'Unser Stadion', 10, 10, false);
  plakette(
    `${nfmt(st.capacity || 0)} Plätze · ${nfmt(Math.round((st.capacity || 0) * auslastung))} im Haus · ` +
    `${nfmt(auslastung * 100, 1)} %`,
    W - 10, H - 28, true);
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Zuschauerentwicklung
 * ══════════════════════════════════════════════════════════════════════════ */

/** Die letzten (und das nächste) Heimspiele mit erwarteter Zuschauerzahl. */
function heimspielReihe(state, clubId, anzahl = 12) {
  const alle = (state.fixtures || []).filter(f => f && f.homeId === clubId && !f.freilos && f.awayId);
  const gespielt = alle.filter(f => f.played && f.season === state.date.season)
    .sort((a, b) => a.dayIndex - b.dayIndex).slice(-anzahl);
  const naechstes = alle.filter(f => !f.played && f.season === state.date.season)
    .sort((a, b) => a.dayIndex - b.dayIndex)[0];

  const bau = (f, kommend) => {
    const z = sicher(() => zuschauerBerechnen(state, clubId, f), null, 'zuschauerBerechnen');
    const gegner = state.clubs[f.awayId];
    const d = sicher(() => derbyInfo(state, clubId, f.awayId), { name: null }, 'derbyInfo');
    return {
      id: f.id,
      tag: f.dayIndex,
      datum: formatDateShort(f.dayIndex, f.season),
      gegner: gegner ? (gegner.abbr || gegner.shortName) : String(f.awayId || '?').replace(/^am_/, ''),
      gegnerName: gegner ? gegner.name : String(f.awayId || 'Unbekannt'),
      wettbewerb: f.competitionId,
      derby: d && d.name,
      zuschauer: z ? z.gesamt : 0,
      auslastung: z ? z.auslastung : 0,
      einnahmen: z ? z.einnahmen : 0,
      kommend
    };
  };

  const reihe = gespielt.map(f => bau(f, false));
  if (naechstes) reihe.push(bau(naechstes, true));
  return reihe;
}

function zeichneZuschauer(canvas, reihe, kapazitaet, schnitt) {
  const setup = leinwand(canvas, 190);
  if (!setup) return;
  const { c, b: W, h: H } = setup;

  c.fillStyle = '#1b2a1c';
  c.fillRect(0, 0, W, H);

  if (!reihe.length) {
    c.fillStyle = 'rgba(240,232,200,.7)';
    c.font = '12px "Segoe UI", sans-serif';
    c.textAlign = 'center';
    c.fillText('Noch keine Heimspiele in dieser Saison.', W / 2, H / 2);
    return;
  }

  const padL = 52, padR = 10, padO = 12, padU = 30;
  const iw = W - padL - padR, ih = H - padO - padU;
  const max = Math.max(kapazitaet || 1, ...reihe.map(r => r.zuschauer));
  const bw = iw / reihe.length;
  const y = (v) => padO + ih - (v / max) * ih;

  // Gitter
  c.font = '10px "Consolas", monospace';
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const yy = Math.round(y(v)) + 0.5;
    c.strokeStyle = 'rgba(255,255,255,.12)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(padL, yy); c.lineTo(W - padR, yy); c.stroke();
    c.fillStyle = 'rgba(240,232,200,.65)';
    c.fillText(formatMoneyShort(v).replace('T', 'k'), padL - 5, yy);
  }

  // Kapazitätslinie
  const yk = Math.round(y(kapazitaet)) + 0.5;
  c.strokeStyle = '#f0c956';
  c.setLineDash([5, 4]);
  c.beginPath(); c.moveTo(padL, yk); c.lineTo(W - padR, yk); c.stroke();
  c.setLineDash([]);

  reihe.forEach((r, i) => {
    const x = padL + i * bw + bw * 0.16;
    const w = bw * 0.68;
    const top = y(r.zuschauer);
    const g = c.createLinearGradient(0, top, 0, padO + ih);
    if (r.kommend) { g.addColorStop(0, '#8ab6e0'); g.addColorStop(1, '#2c5a86'); }
    else if (r.derby) { g.addColorStop(0, '#f0c956'); g.addColorStop(1, '#9a6f10'); }
    else { g.addColorStop(0, '#57ad55'); g.addColorStop(1, '#27591f'); }
    c.fillStyle = g;
    c.fillRect(x, top, w, padO + ih - top);
    c.strokeStyle = 'rgba(0,0,0,.45)';
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, top + 0.5, w - 1, padO + ih - top - 1);

    c.save();
    c.translate(x + w / 2, padO + ih + 6);
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillStyle = r.kommend ? '#bcd9f5' : 'rgba(240,232,200,.85)';
    c.font = 'bold 10px "Segoe UI", sans-serif';
    c.fillText(r.gegner, 0, 0);
    c.fillStyle = 'rgba(240,232,200,.55)';
    c.font = '9px "Consolas", monospace';
    c.fillText(nfmt(r.zuschauer), 0, 11);
    c.restore();
  });

  if (schnitt > 0) {
    const ys = Math.round(y(schnitt)) + 0.5;
    c.strokeStyle = 'rgba(255,255,255,.55)';
    c.setLineDash([2, 3]);
    c.beginPath(); c.moveTo(padL, ys); c.lineTo(W - padR, ys); c.stroke();
    c.setLineDash([]);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Panels
 * ══════════════════════════════════════════════════════════════════════════ */

function ansichtPanel(ctx, club, s, z) {
  const canvas = el('canvas.tv-stadion__view', { style: { height: '340px' } });
  const auslastung = (s.auslastungSchnitt && s.auslastungSchnitt > 0)
    ? s.auslastungSchnitt
    : (z ? z.auslastung : 0.6);

  const zeichnen = () => {
    if (!canvas.isConnected) return;
    sicher(() => zeichneStadion(canvas, club, s, { auslastung }), null, 'zeichneStadion');
  };
  requestAnimationFrame(zeichnen);
  if (typeof window !== 'undefined') window.addEventListener('resize', zeichnen, { once: true });

  const hv = sicher(() => heimvorteil(ctx.state, club.id), { wert: 0.5, text: '' }, 'heimvorteil');
  const rivalen = sicher(() => rivalenVon(ctx.state, club.id), [], 'rivalenVon').slice(0, 4);

  return panel(el('span', null, club.stadium.name || 'Stadion',
    el('span.tv-panel__extra', null,
      `${nfmt(club.stadium.capacity || 0)} Plätze · ${club.stadium.tiers || 1} Ränge · ` +
      `${club.stadium.roof ? 'überdacht' : 'ohne Dach'} · Flutlicht Stufe ${club.stadium.floodlight || 0}`)),
  canvas,
  el('div.tv-zeile', { style: { marginTop: '8px', flexWrap: 'wrap', gap: '6px' } },
    pill(`${nfmt((s.auslastungSchnitt || 0) * 100, 1)} % Auslastung`, (s.auslastungSchnitt || 0) > 0.85 ? 'gut' : 'warn'),
    s.rasenheizung ? pill('Rasenheizung', 'gut') : pill('ohne Rasenheizung', 'neutral'),
    s.videowand ? pill('Videowand', 'info') : null,
    s.museum ? pill('Museum & Fanshop', 'info') : null,
    club.stadium.roof ? pill('Dach', 'info') : null,
    el('span.tv-mini', { style: { marginLeft: 'auto' } }, hv.text)),
  rivalen.length
    ? el('div.tv-mini', { style: { marginTop: '6px' } },
      'Kassenschlager: ',
      ...rivalen.map((r, i) => {
        const g = ctx.state.clubs[r.clubId];
        return el('span', null, i ? ' · ' : '',
          el('b', null, g ? g.shortName : r.clubId), ` (${r.name})`);
      }))
    : null);
}

function kennzahlenPanel(ctx, club, s, z) {
  const r = sicher(() => raenge(ctx.state, club.id),
    { gesamt: club.stadium.capacity || 0, steh: 0, sitz: 0, vip: 0, stehAnteil: 0, vipAnteil: 0 }, 'raenge');
  const wert = sicher(() => stadionWert(ctx.state, club.id), 0, 'stadionWert');
  const betrieb = sicher(() => betriebskostenJahr(ctx.state, club.id), 0, 'betriebskostenJahr');
  const dauerkarten = (club.fans && club.fans.dauerkarten) || 0;

  const rangZeile = (name, anzahl, gesamt, farbe) => el('div.tv-rang', null,
    el('span', { style: { minWidth: '92px', fontSize: '12px' } }, name),
    el('span.tv-rang__balken', null,
      el('div', { style: { width: `${clamp(gesamt ? anzahl / gesamt * 100 : 0, 0, 100)}%`, background: farbe } })),
    el('b.tv-num', { style: { minWidth: '78px', textAlign: 'right', fontSize: '12px' } }, nfmt(anzahl)));

  return panel('Kennzahlen',
    el('div.tv-grid.tv-grid--3', { style: { gap: '7px', marginBottom: '9px' } },
      statBox('Kapazität', nfmt(r.gesamt), { sub: `${club.stadium.tiers || 1} Ränge` }),
      statBox('Letzte Zuschauer', s.letzteZuschauer ? nfmt(s.letzteZuschauer) : '—', {
        sub: s.heimspiele ? `${s.heimspiele} Heimspiele erfasst` : 'noch kein Heimspiel abgerechnet'
      }),
      statBox('Auslastung im Schnitt', `${nfmt((s.auslastungSchnitt || 0) * 100, 1)} %`, {
        kind: (s.auslastungSchnitt || 0) > 0.85 ? 'gut' : (s.auslastungSchnitt || 0) < 0.6 ? 'schlecht' : 'warn'
      }),
      statBox('Dauerkarten', nfmt(dauerkarten), {
        sub: `${nfmt(r.gesamt ? dauerkarten / r.gesamt * 100 : 0, 0)} % der Plätze`
      }),
      statBox('Buchwert', formatMoney(wert), { sub: 'Immobilie inkl. Grundstück' }),
      statBox('Betriebskosten', formatMoney(betrieb), { sub: 'pro Jahr, ohne Spieltag' })),
    el('div.tv-grid.tv-grid--2', null,
      kasten('Ränge',
        rangZeile('Stehplätze', r.steh, r.gesamt, 'linear-gradient(90deg,#c1272d,#e04b4b)'),
        rangZeile('Sitzplätze', r.sitz, r.gesamt, 'linear-gradient(90deg,#276b2a,#57ad55)'),
        rangZeile('VIP & Logen', r.vip, r.gesamt, 'linear-gradient(90deg,#b8860b,#f0c956)'),
        el('div.tv-mini', { style: { marginTop: '5px' } },
          `Stehplatzanteil ${nfmt(r.stehAnteil * 100, 1)} % · VIP-Anteil ${nfmt(r.vipAnteil * 100, 2)} %`)),
      kasten('Zustand & Technik',
        bar(s.rasenZustand || 0, 99, {
          label: 'Rasen', valueText: `${Math.round(s.rasenZustand || 0)} / 99`, height: 11
        }),
        bar(s.sicherheit || 0, 100, { label: 'Sicherheitstechnik', height: 9 }),
        bar((club.stadium.floodlight || 0) * 20, 100, {
          label: 'Flutlicht', valueText: `Stufe ${club.stadium.floodlight || 0} von 5`, height: 9
        }),
        zeile('Dach', club.stadium.roof ? 'vorhanden' : 'Fehlanzeige'),
        zeile('Rasenheizung', s.rasenheizung ? 'vorhanden' : 'nicht vorhanden'),
        z ? zeile('Erwartete Einnahmen je Heimspiel', formatMoney(z.einnahmen)) : null)));
}

/* ── Ticketpreise ───────────────────────────────────────────────────────── */

function preisePanel(ctx, club, s) {
  const ref = sicher(() => referenzPreise(ctx.state, club.id),
    { sitz: 25, steh: 12, vip: 110, dauerkarte: 380 }, 'referenzPreise');
  const start = Object.assign({ sitz: 25, steh: 12, vip: 110, dauerkarte: 380 }, s.preise || {});
  const wahl = Object.assign({}, start);

  const vorschauBox = el('div.tv-grid.tv-grid--4', { style: { gap: '6px' } });
  const hinweis = el('div.tv-mini', { style: { marginTop: '6px' } });

  function neuRechnen() {
    const z = sicher(() => zuschauerBerechnen(ctx.state, club.id, null, {
      neutral: true, preise: { steh: wahl.steh, sitz: wahl.sitz, vip: wahl.vip }
    }), null, 'zuschauerBerechnen(Vorschau)');
    const alt = sicher(() => zuschauerBerechnen(ctx.state, club.id, null, { neutral: true }), null, 'zuschauerBerechnen');

    vorschauBox.innerHTML = '';
    if (!z) {
      vorschauBox.appendChild(el('div.tv-leer', null, 'Vorschau nicht verfügbar.'));
      return;
    }
    const diff = alt ? z.einnahmen - alt.einnahmen : 0;
    vorschauBox.appendChild(statBox('Erwartete Zuschauer', nfmt(z.gesamt), {
      sub: `Steh ${nfmt(z.steh)} · Sitz ${nfmt(z.sitz)} · VIP ${nfmt(z.vip)}`
    }));
    vorschauBox.appendChild(statBox('Auslastung', `${nfmt(z.auslastung * 100, 1)} %`, {
      kind: z.auslastung > 0.9 ? 'gut' : z.auslastung < 0.65 ? 'schlecht' : 'warn'
    }));
    vorschauBox.appendChild(statBox('Tageskasse je Heimspiel', formatMoney(z.einnahmen), {
      sub: diff ? `${diff > 0 ? '+' : ''}${formatMoney(diff)} gegenüber jetzt` : 'unverändert'
    }));
    vorschauBox.appendChild(statBox('Hochrechnung Saison', formatMoney(z.einnahmen * HEIMSPIELE), {
      sub: `${HEIMSPIELE} Heimspiele, geschätzt`
    }));

    // Stimmungswirkung grob nach dem Muster aus club/stadium.js
    const schnitt = (wahl.steh / Math.max(1, start.steh) + wahl.sitz / Math.max(1, start.sitz)) / 2;
    hinweis.textContent = schnitt > 1.25
      ? 'Diese Erhöhung reißt die Südkurve vom Sitz — im schlechten Sinn. Mit Transparenten ist zu rechnen.'
      : schnitt > 1.08
        ? 'Über acht Prozent teurer: Auf den Rängen wird gemurrt, aber gezahlt.'
        : schnitt < 0.9
          ? 'Deutlich günstiger. Die Fans werden Sie lieben, der Kassenwart weniger.'
          : 'Moderate Anpassung. Niemand wird deshalb ein Transparent malen.';
  }

  const regler = (key, label, min, max, schritt) => slider(label, wahl[key], {
    min, max, step: schritt,
    left: `${min} €`, right: `${max} €`,
    onInput: (v) => { wahl[key] = v; neuRechnen(); }
  });

  const empf = sicher(() => preisEmpfehlung(ctx.state, club.id), null, 'preisEmpfehlung');

  const knoepfe = el('div.tv-zeile', { style: { marginTop: '8px', flexWrap: 'wrap' } },
    button('Preise übernehmen', () => {
      const r = sicher(() => preiseSetzen(ctx.state, club.id, wahl),
        { ok: false, text: 'Die Preise ließen sich nicht setzen.' }, 'preiseSetzen');
      toast(r.text, r.ok ? 'gut' : 'schlecht');
      if (r.ok) { ctx.aktualisiere(); ctx.refresh(); }
    }, { kind: 'primary' }),
    empf && empf.ok
      ? button('Empfehlung übernehmen', () => {
        const r = sicher(() => preiseSetzen(ctx.state, club.id, empf.preise),
          { ok: false, text: 'Die Empfehlung ließ sich nicht übernehmen.' }, 'preiseSetzen');
        toast(r.text, r.ok ? 'gut' : 'schlecht');
        if (r.ok) { ctx.aktualisiere(); ctx.refresh(); }
      }, { kind: 'gold' })
      : null,
    button('Zurücksetzen', () => ctx.refresh(), { kind: 'ghost' }));

  const empfehlungBox = empf && empf.ok
    ? kasten(el('span.tv-zeile', { style: { width: '100%' } },
      el('span', null, 'Empfehlung der Geschäftsstelle'),
      el('span', { style: { marginLeft: 'auto', fontFamily: 'var(--font-num)', fontWeight: '400' } },
        `Steh ${empf.preise.steh} € · Sitz ${empf.preise.sitz} € · VIP ${empf.preise.vip} € · DK ${empf.preise.dauerkarte} €`)),
    ...(empf.begruendung || []).map(t => el('div.tv-bilanz__zeile', null, el('span', null, t))),
    el('div.tv-bilanz__zeile.tv-bilanz__summe', null,
      el('span', null, 'Mehrerlös über die Saison'),
      el('b', { class: empf.mehrerloes >= 0 ? 'tv-gut' : 'tv-schlecht' },
        `${empf.mehrerloes >= 0 ? '+' : ''}${formatMoney(empf.mehrerloes)}`)))
    : el('div.tv-leer', null, 'Die Geschäftsstelle hat gerade keine Empfehlung parat.');

  const panelNode = panel(el('span', null, 'Ticketpreise',
    el('span.tv-panel__extra', null,
      `marktüblich: Steh ${ref.steh} € · Sitz ${ref.sitz} € · VIP ${ref.vip} € · Dauerkarte ${ref.dauerkarte} €`)),
  el('div.tv-grid.tv-grid--2', null,
    el('div', null,
      regler('steh', 'Stehplatz', 4, Math.max(10, Math.round(ref.steh * 4)), 1),
      regler('sitz', 'Sitzplatz', 8, Math.max(20, Math.round(ref.sitz * 4)), 1),
      regler('vip', 'VIP-Loge', 25, Math.max(60, Math.round(ref.vip * 4)), 5),
      regler('dauerkarte', 'Dauerkarte', 50, Math.max(120, Math.round(ref.dauerkarte * 4)), 10),
      el('div.tv-mini', null,
        'Die Dauerkarte wirkt erst beim nächsten Saisonverkauf — die Vorschau rechts zeigt das Tagesgeschäft.')),
    el('div', null, vorschauBox, hinweis, knoepfe)),
  el('div', { style: { marginTop: '9px' } }, empfehlungBox));

  neuRechnen();
  return panelNode;
}

/* ── Ausbau ─────────────────────────────────────────────────────────────── */

const KATEGORIE_NAME = {
  kapazitaet: 'Kapazität', komfort: 'Komfort', technik: 'Technik',
  platz: 'Spielfeld', erloes: 'Erlöse'
};

/** Effekt einer Ausbaustufe in Klartext. */
function effektText(e = {}) {
  const t = [];
  if (e.plaetze) t.push(`${e.plaetze > 0 ? '+' : ''}${nfmt(e.plaetze)} Plätze`);
  if (e.stehDelta) t.push(`Stehplatzanteil ${e.stehDelta > 0 ? '+' : ''}${nfmt(e.stehDelta * 100, 1)} Punkte`);
  if (e.vipDelta) t.push(`VIP-Anteil +${nfmt(e.vipDelta * 100, 2)} Punkte`);
  if (e.tiers) t.push(`+${e.tiers} Rang`);
  if (e.floodlight) t.push(`Flutlicht +${e.floodlight} Stufe`);
  if (e.roof !== undefined) t.push('Überdachung');
  if (e.pitch) t.push(`Rasen +${e.pitch}`);
  if (e.rasenheizung) t.push('Rasenheizung');
  if (e.videowand) t.push('Videowand');
  if (e.museum) t.push('Museum & Fanshop');
  if (e.catering) t.push(`Gastronomie +${e.catering}`);
  if (e.parkplaetze) t.push(`Parkplätze +${e.parkplaetze}`);
  if (e.sicherheit) t.push(`Sicherheit +${e.sicherheit}`);
  if (e.moodDelta) t.push(`Fanstimmung ${e.moodDelta > 0 ? '+' : ''}${e.moodDelta}`);
  return t;
}

function ausbauPanel(ctx, club, s) {
  const angebot = sicher(() => ausbauAngebot(ctx.state, club.id), [], 'ausbauAngebot');

  const laufend = s.ausbau
    ? (() => {
      const a = s.ausbau;
      const fortschritt = clamp(100 * (1 - (a.restTage || 0) / Math.max(1, a.tageGesamt || 1)), 0, 100);
      return kasten(el('span.tv-zeile', { style: { width: '100%' } },
        el('span', null, `Baustelle: ${a.name}`),
        el('span', { style: { marginLeft: 'auto', fontFamily: 'var(--font-num)', fontWeight: '400' } },
          `noch ${a.restTage} Tage`)),
      bar(fortschritt, 100, { label: 'Baufortschritt', valueText: `${nfmt(fortschritt, 0)} %`, height: 14 }),
      zeile('Gesamtkosten', formatMoney(a.kostenGesamt || 0)),
      zeile('Bereits bezahlt', formatMoney(a.gezahlt || 0)),
      zeile('Wochenrate', formatMoney(a.rateProWoche || 0)),
      a.plaetzeNeu ? zeile('Neue Plätze nach Fertigstellung', nfmt(a.plaetzeNeu)) : null,
      el('div.tv-zeile', { style: { marginTop: '7px' } },
        button('Bauvorhaben abbrechen', async () => {
          const offen = Math.max(0, (a.kostenGesamt || 0) - (a.gezahlt || 0));
          const ja = await bestaetigen('Bau abbrechen?',
            `Abbruch kostet rund ${formatMoney(Math.round(offen * 0.12))} Vertragsstrafe, und ` +
            `${formatMoney(a.gezahlt || 0)} sind ohnehin verbaut. Wirklich abbrechen?`);
          if (!ja) return;
          const r = sicher(() => ausbauAbbrechen(ctx.state, club.id),
            { ok: false, text: 'Der Abbruch ließ sich nicht durchführen.' }, 'ausbauAbbrechen');
          toast(r.text, r.ok ? 'warn' : 'schlecht');
          ctx.aktualisiere();
          ctx.refresh();
        }, { kind: 'danger' })));
    })()
    : null;

  const karten = el('div.tv-grid.tv-grid--3');
  for (const a of angebot) {
    const eff = effektText(a.effekt);
    const machbar = a.moeglich && a.bezahlbar;
    karten.appendChild(el('div.tv-subpanel', {
      style: {
        padding: '0',
        opacity: a.moeglich ? '1' : '.62',
        borderColor: machbar ? 'var(--gruen-600)' : 'var(--linie)'
      }
    },
    el('div.tv-subpanel__titel', {
      style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 9px 4px', marginBottom: '0' }
    },
    el('span', null, a.name),
    el('span', { style: { marginLeft: 'auto' } }, pill(KATEGORIE_NAME[a.kategorie] || a.kategorie, 'info'))),
    el('div', { style: { padding: '7px 9px' } },
      el('div', { style: { fontSize: '11.5px', lineHeight: '1.4', minHeight: '48px' } }, a.desc),
      el('div.tv-zeile', { style: { flexWrap: 'wrap', gap: '3px', margin: '6px 0' } },
        ...eff.map(t => pill(t, 'gut'))),
      zeile('Kosten', formatMoney(a.kosten)),
      zeile('Anzahlung sofort', formatMoney(a.anzahlung)),
      zeile('Bauzeit', `${a.dauerTage} Tage`),
      a.grund ? el('div.tv-mini', { style: { marginTop: '5px', color: 'var(--rot)' } }, a.grund) : null,
      !a.bezahlbar && a.moeglich
        ? el('div.tv-mini', { style: { marginTop: '5px', color: 'var(--rot)' } },
          'Die Anzahlung ist nicht gedeckt.')
        : null,
      el('div.tv-zeile', { style: { marginTop: '7px' } },
        button('Beauftragen', async () => {
          const ja = await bestaetigen(a.name,
            `„${a.name}" kostet ${formatMoney(a.kosten)}, davon ${formatMoney(a.anzahlung)} sofort. ` +
            `Bauzeit ${a.dauerTage} Tage. Auftrag erteilen?`);
          if (!ja) return;
          const r = sicher(() => ausbauStarten(ctx.state, club.id, a.id),
            { ok: false, text: 'Der Auftrag ließ sich nicht erteilen.' }, 'ausbauStarten');
          toast(r.text, r.ok ? 'gut' : 'schlecht');
          if (r.ok) { ctx.aktualisiere(); ctx.refresh(); }
        }, { kind: machbar ? 'primary' : 'ghost', disabled: !machbar, size: 'klein' })))));
  }

  return panel(el('span', null, 'Ausbau',
    el('span.tv-panel__extra', null,
      s.ausbau ? 'Es wird gebaut — solange läuft nichts anderes' : `${angebot.filter(a => a.moeglich).length} Vorhaben möglich`)),
  laufend,
  angebot.length ? karten : el('div.tv-leer', null, 'Der Bauausschuss hat nichts im Katalog.'));
}

/* ── Zuschauerentwicklung ───────────────────────────────────────────────── */

function entwicklungPanel(ctx, club, s) {
  const reihe = sicher(() => heimspielReihe(ctx.state, club.id, 12), [], 'heimspielReihe');
  const kapazitaet = club.stadium.capacity || 0;
  const schnitt = s.heimspiele > 0 ? Math.round(s.zuschauerSumme / s.heimspiele) : 0;

  const canvas = el('canvas.tv-chart', { style: { height: '190px' } });
  const zeichnen = () => {
    if (!canvas.isConnected) return;
    sicher(() => zeichneZuschauer(canvas, reihe, kapazitaet, schnitt), null, 'zeichneZuschauer');
  };
  requestAnimationFrame(zeichnen);
  if (typeof window !== 'undefined') window.addEventListener('resize', zeichnen, { once: true });

  const tab = table([
    { key: 'datum', label: 'Tag', width: 92 },
    {
      key: 'gegnerName', label: 'Gegner',
      render: r => el('span', null, r.gegnerName,
        r.derby ? pill(r.derby, 'warn') : null,
        r.kommend ? pill('kommt noch', 'info') : null)
    },
    { key: 'zuschauer', label: 'Zuschauer', numeric: true, render: r => nfmt(r.zuschauer) },
    {
      key: 'auslastung', label: 'Auslastung', numeric: true, width: 100,
      render: r => `${nfmt(r.auslastung * 100, 1)} %`
    },
    { key: 'einnahmen', label: 'Tageskasse', numeric: true, render: r => formatMoney(r.einnahmen) }
  ], reihe.slice().reverse(), {
    compact: true, maxHeight: 220,
    emptyText: 'In dieser Saison stand noch kein Heimspiel an.'
  });

  return panel(el('span', null, 'Zuschauerentwicklung',
    el('span.tv-panel__extra', null,
      schnitt ? `Schnitt ${nfmt(schnitt)} aus ${s.heimspiele} Heimspielen` : 'noch kein abgerechnetes Heimspiel')),
  canvas,
  el('div.tv-mini', { style: { margin: '6px 0' } },
    'Gelbe Balken sind Derbys, blau ist das nächste Heimspiel. Die gestrichelte Linie oben ist die Kapazität. ' +
    (schnitt ? '' : 'Die Werte sind auf heutiger Datenbasis berechnet, solange keine Spieltagsabrechnung vorliegt.')),
  tab);
}

/* ── Nebeneinnahmen ─────────────────────────────────────────────────────── */

function nebeneinnahmenPanel(ctx, club, s, z) {
  const zuschauer = z ? z : { gesamt: Math.round((club.stadium.capacity || 0) * 0.7), vip: 0 };
  const cat = sicher(() => cateringErtrag(ctx.state, club.id, zuschauer),
    { gesamt: 0, gastro: 0, fanshop: 0, parken: 0, vipZuschlag: 0, proKopf: 0 }, 'cateringErtrag');

  const angebot = sicher(() => ausbauAngebot(ctx.state, club.id), [], 'ausbauAngebot');
  const investition = (id, label) => {
    const a = angebot.find(x => x.id === id);
    if (!a) return null;
    return button(label, async () => {
      const ja = await bestaetigen(a.name,
        `${a.desc} — Kosten ${formatMoney(a.kosten)}, Anzahlung ${formatMoney(a.anzahlung)}, ` +
        `Bauzeit ${a.dauerTage} Tage. Auftrag erteilen?`);
      if (!ja) return;
      const r = sicher(() => ausbauStarten(ctx.state, club.id, a.id),
        { ok: false, text: 'Der Auftrag ließ sich nicht erteilen.' }, 'ausbauStarten');
      toast(r.text, r.ok ? 'gut' : 'schlecht');
      if (r.ok) { ctx.aktualisiere(); ctx.refresh(); }
    }, {
      size: 'klein',
      kind: a.moeglich && a.bezahlbar ? 'primary' : 'ghost',
      disabled: !(a.moeglich && a.bezahlbar),
      tooltip: a.grund || `${formatMoney(a.kosten)} · ${a.dauerTage} Tage`
    });
  };

  return panel(el('span', null, 'Nebeneinnahmen',
    el('span.tv-panel__extra', null,
      `${formatMoney(cat.proKopf)} pro Kopf und Spieltag`)),
  el('div.tv-grid.tv-grid--2', null,
    kasten('Ausstattung',
      bar(s.catering || 0, 100, { label: 'Gastronomie', height: 10 }),
      bar(s.parkplaetze || 0, 100, { label: 'Parkplätze & Zufahrt', height: 10 }),
      bar(s.sicherheit || 0, 100, { label: 'Sicherheitstechnik', height: 10 }),
      zeile('Fanshop & Museum', s.museum ? 'vorhanden' : 'nicht vorhanden'),
      el('div.tv-mini', { style: { marginTop: '6px' } },
        'Die Stufen lassen sich nicht am Regler drehen — dafür muss der Bauausschuss ran. ' +
        'Jede Investition läuft als reguläres Bauvorhaben.'),
      el('div.tv-zeile', { style: { marginTop: '6px', flexWrap: 'wrap' } },
        investition('gastronomie', 'In Gastronomie investieren'),
        investition('parkplaetze', 'In Parkplätze investieren'),
        investition('museum', 'Museum & Fanshop bauen'))),
    kasten(el('span.tv-zeile', { style: { width: '100%' } },
      el('span', null, 'Erlöse je Heimspiel'),
      el('span', { style: { marginLeft: 'auto', fontFamily: 'var(--font-num)', fontWeight: '400' } },
        `${nfmt(zuschauer.gesamt)} Zuschauer`)),
    zeile('Gastronomie', formatMoney(cat.gastro)),
    zeile('Fanshop', formatMoney(cat.fanshop)),
    zeile('Parken', formatMoney(cat.parken)),
    zeile('VIP-Bewirtung', formatMoney(cat.vipZuschlag)),
    el('div.tv-bilanz__zeile.tv-bilanz__summe', null,
      el('span', null, 'Summe je Heimspiel'), el('b.tv-num', null, formatMoney(cat.gesamt))),
    zeile('Hochrechnung Saison', formatMoney(cat.gesamt * HEIMSPIELE)),
    el('div.tv-mini', { style: { marginTop: '5px' } },
      `Geschätzt auf ${HEIMSPIELE} Heimspiele. Bratwurst und Parkschein sind zusammen erstaunlich viel wert.`))));
}

/* ── Rasenpflege ────────────────────────────────────────────────────────── */

function rasenPanel(ctx, club, s) {
  const max = s.rasenheizung ? 99 : 94;
  const luft = Math.max(0, max - (s.rasenZustand || 0));
  let intensitaet = 50;

  const vorschau = el('div.tv-mini', { style: { marginTop: '4px' } });
  function neuRechnen() {
    const gewinn = Math.min(luft, RASEN_MAX_PRO_MASSNAHME * (intensitaet / 100));
    const kosten = Math.round(gewinn * RASEN_KOSTEN_PRO_PUNKT);
    vorschau.textContent = gewinn <= 0.5
      ? 'Der Platz ist bereits in Bestform. Der Greenkeeper bittet um Ruhe.'
      : `Erwarteter Gewinn: rund ${nfmt(gewinn, 1)} Punkte auf ${Math.round((s.rasenZustand || 0) + gewinn)}. ` +
        `Geschätzte Kosten: ${formatMoney(kosten)}.`;
  }

  const regler = slider('Intensität der Pflege', intensitaet, {
    min: 10, max: 100, step: 5,
    left: 'nur mähen', right: 'Komplettsanierung',
    onInput: (v) => { intensitaet = v; neuRechnen(); }
  });
  neuRechnen();

  const pflegen = (stufe) => {
    const r = sicher(() => rasenPflegen(ctx.state, club.id, stufe),
      { ok: false, text: 'Die Platzarbeiten ließen sich nicht beauftragen.' }, 'rasenPflegen');
    toast(r.text, r.ok ? 'gut' : 'warn');
    if (r.ok) { ctx.aktualisiere(); ctx.refresh(); }
  };

  return panel(el('span', null, 'Rasenpflege',
    el('span.tv-panel__extra', null,
      s.rasenheizung ? 'mit Rasenheizung, Maximum 99' : 'ohne Rasenheizung, Maximum 94')),
  bar(s.rasenZustand || 0, 99, {
    label: 'Zustand des Geläufs', valueText: `${Math.round(s.rasenZustand || 0)} / 99`, height: 16
  }),
  el('div.tv-mini', { style: { margin: '5px 0 9px' } },
    (s.rasenZustand || 0) > 88 ? 'Ein Billardtuch. Der Greenkeeper hat sich einen Orden verdient.'
      : (s.rasenZustand || 0) > 70 ? 'Bespielbar, mehr aber auch nicht.'
        : 'Ein Acker. Bei Regen spielt hier niemand freiwillig Kurzpass.'),
  regler, vorschau,
  el('div.tv-zeile', { style: { marginTop: '8px', flexWrap: 'wrap' } },
    button('Pflegen', () => pflegen(intensitaet), { kind: 'primary' }),
    button('Nur mähen (leicht)', () => pflegen(25), { size: 'klein' }),
    button('Gründlich', () => pflegen(60), { size: 'klein' }),
    button('Komplettsanierung', () => pflegen(100), { size: 'klein', kind: 'gold' })),
  el('div.tv-mini', { style: { marginTop: '6px' } },
    'Die endgültige Rechnung stellt der Platzwart — die Vorschau oben ist eine Schätzung.'));
}

/* ══════════════════════════════════════════════════════════════════════════
 *  SCREEN
 * ══════════════════════════════════════════════════════════════════════════ */

export const screen = {
  id: 'stadion',
  title: 'Stadion',
  icon: '🏟️',

  async render(root, ctx) {
    const club = sicher(() => myClub(ctx.state), null, 'myClub');
    if (!club) {
      root.appendChild(fehlerPanel('Stadion', new Error('Kein Verein im Spielstand gefunden (state.managerClubId).')));
      return;
    }
    if (!club.stadium) {
      root.appendChild(fehlerPanel('Stadion', new Error('Dieser Verein hat kein Stadion (club.stadium fehlt).')));
      return;
    }
    const s = sicher(() => stadionState(ctx.state, club.id), null, 'stadionState');
    if (!s) {
      root.appendChild(fehlerPanel('Stadion',
        new Error('club/stadium.js liefert keinen Stadionzustand (stadionState).')));
      return;
    }

    // Ein neutraler Durchschnittsspieltag als Bezugsgröße für alle Vorschauen.
    const z = sicher(() => zuschauerBerechnen(ctx.state, club.id, null, { neutral: true }), null, 'zuschauerBerechnen');

    const seite = el('div.tv-seite', null,
      el('div.tv-seite__kopf', null,
        el('h1.tv-seite__titel', null, 'Stadion'),
        el('span.tv-seite__unter', null,
          `${club.stadium.name || 'Unser Stadion'} · ${club.city || ''} · ` +
          `Der Platzwart lässt ausrichten, dass er alles im Griff hat.`)),
      el('div.tv-grid.tv-grid--haupt', null,
        abschnitt('Stadionansicht', () => ansichtPanel(ctx, club, s, z)),
        abschnitt('Kennzahlen', () => kennzahlenPanel(ctx, club, s, z))),
      abschnitt('Ticketpreise', () => preisePanel(ctx, club, s)),
      abschnitt('Ausbau', () => ausbauPanel(ctx, club, s)),
      el('div.tv-grid.tv-grid--haupt', null,
        abschnitt('Zuschauerentwicklung', () => entwicklungPanel(ctx, club, s)),
        abschnitt('Rasenpflege', () => rasenPanel(ctx, club, s))),
      abschnitt('Nebeneinnahmen', () => nebeneinnahmenPanel(ctx, club, s, z)));

    root.appendChild(seite);
  }
};

export default screen;
