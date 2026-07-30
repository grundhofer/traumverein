/**
 * tools/test-spielstand.js – Der Prüfstand für die Spielstandbremse (ROADMAP 8.1).
 *
 *   node tools/test-spielstand.js                # acht Spielzeiten, ein Seed
 *   node tools/test-spielstand.js --referenz     # zusätzlich derselbe Lauf OHNE Bremse
 *   node tools/test-spielstand.js --saisons=3    # kürzer, für die Fehlersuche
 *   node tools/test-spielstand.js 2024           # eigener Seed
 *
 * WARUM ES DAS GIBT
 *
 * Gemessen ohne Bremse (Seed 7, HSV, Profi): 9,51 MB nach einer Spielzeit,
 * 13,05 MB nach dreien, 20,56 MB nach achten – rund anderthalb Megabyte im
 * Jahr, und nichts wird je einen Datensatz los. Kein Prüfskript des Projekts
 * ist je über drei Spielzeiten hinausgekommen; test-saison.js prüft die Grenze
 * bei 15 MB nach drei Saisons und wäre in Saison vier rot geworden. Dieses
 * Skript geht acht Spielzeiten weit – deshalb dauert es auch so lange.
 *
 * WAS ES ZUSICHERT
 *
 * Die Bremse darf sparen, was sie will, solange sie nichts wegnimmt, das noch
 * jemand liest. Der strengste Leser ist die Chronik (screens/chronik.js). Sie
 * braucht einen DOM und ist von hier aus nicht aufrufbar – ihre vier Auswertungen
 * sind deshalb unten NACHGEBAUT, Zeile für Zeile aus derselben Datei, und werden
 * bei jedem Saisonwechsel VOR und NACH der Verdichtung gerechnet und verglichen:
 * Ruhmeshalle, ewige Tabelle, Titelchronik, Rekordbuch.
 *
 * WAS ES NICHT PRÜFT
 *
 *   • Ob die Chronik hübsch aussieht. Verglichen werden Werte, keine Pixel.
 *   • Ob `portraitDataURL()` dasselbe Bild malt – das braucht eine Leinwand.
 *     Verglichen wird stattdessen alles, woraus das Bild entsteht (appearance,
 *     Position, Nation, Ära, Rückennummer).
 *   • Die Laufzeit des Spiels. Die Bremse kostet je Saisonwechsel einen
 *     Durchgang durch Spieler und Vereine; gemessen sind das Bruchteile einer
 *     Sekunde gegen die zehn Sekunden, die eine Saison sowieso braucht.
 *
 * Rückgabe: Exit-Code 1, sobald eine Zusicherung fehlschlägt.
 */

import { createNewGame, serialize, deserialize, verdichteVergangenheit, VERDICHTUNG }
  from '../src/core/state.js';
import {
  advanceDay, makeCtx, simulateAiFixture, applyResult, pokalWeiterlosen, saisonWechsel
} from '../src/core/loop.js';
import { SAVE_VERSION, POSITION_NAMES } from '../src/core/constants.js';
import { LEAGUES, LEAGUE_IDS } from '../src/data/leagues.js';
import { playerOverall } from '../src/engine/ratings.js';
import { sortBy, nfmt, formatMoney } from '../src/core/util.js';
import { chronikText } from '../src/club/karriere.js';

/* ------------------------------------------------------------------ *
 *  Argumente
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const MIT_REFERENZ = args.includes('--referenz');
const saisonArg = args.find(a => a.startsWith('--saisons='));
const eigeneSeeds = args.filter(a => /^\d+$/.test(a)).map(Number);

const SEED = eigeneSeeds.length ? eigeneSeeds[0] : 7;
const SAISONS = saisonArg ? Math.max(1, parseInt(saisonArg.split('=')[1], 10) || 8) : 8;
const EIGENER_VEREIN = 'hsv';

const GRENZE = 25 * 1024 * 1024;      // die Prüfschwelle aus ROADMAP 8.1
const ALT_SAISONS = 2;                // Vorlauf für den Spielstand der alten Fassung
const TAGE_NOTBREMSE = 3000;

/* ------------------------------------------------------------------ *
 *  Mini-Testgerüst (Stil wie tools/test-saison.js)
 * ------------------------------------------------------------------ */

const ZTITEL = {
  1: `Spielstand bleibt nach ${SAISONS} Spielzeiten unter 25 MB`,
  2: 'Das Wachstum je Spielzeit sinkt, statt zu steigen',
  3: 'Jede Verdichtung macht den Spielstand kleiner',
  4: 'Die Ruhmeshalle zeigt danach dasselbe wie davor',
  5: 'Die ewige Tabelle steht danach unverändert da',
  6: 'Die Titelchronik steht danach unverändert da',
  7: 'Das Rekordbuch steht danach unverändert da',
  8: 'Zurückgetretene Spieler tragen nur noch die Felder der Ruhmeshalle',
  9: 'Kein Verweis zeigt auf einen gestrichenen Spieler',
  10: 'Ein Spielstand der Fassung 3 lädt, wächst mit und lässt sich weiterspielen',
  11: 'Der Saisonwechsel des Spiels verdichtet von selbst'
};

const zstat = {};
for (const nr of Object.keys(ZTITEL)) zstat[nr] = { ok: 0, fehl: 0, offen: 0, meldungen: [] };

function z(nr, bedingung, ist) {
  const e = zstat[nr];
  const txt = `Z${String(nr).padStart(2)}  ${ZTITEL[nr]}`;
  if (bedingung) { e.ok++; console.log(`    [ok]   ${txt}  (ist: ${ist})`); }
  else { e.fehl++; e.meldungen.push(ist); console.log(`    [FEHL] ${txt}  -> ist: ${ist}`); }
}

function zoffen(nr, grund) {
  const e = zstat[nr];
  e.offen++; e.meldungen.push('nicht prüfbar: ' + grund);
  console.log(`    [ ?  ] Z${String(nr).padStart(2)}  ${ZTITEL[nr]}  -> nicht prüfbar: ${grund}`);
}

const hinweise = [];
function H(text) { hinweise.push(text); console.log(`    [hinw] ${text}`); }
function OK(text) { console.log(`    [ok]   ${text}`); }
function abschnitt(t) { console.log('\n=== ' + t + ' ==='); }
function unterpunkt(t) { console.log('  ' + t); }

const mb = b => (b / 1048576).toFixed(2).replace('.', ',') + ' MB';
const kb = b => (b / 1024).toFixed(0) + ' kB';
const sek = ms => (ms / 1000).toFixed(1).replace('.', ',') + ' s';

/* ================================================================== *
 *  1. Eine Saison durchspielen (ohne Bildschirme, ohne simulateMatch)
 * ================================================================== */

async function saisonSpielen(state, protokoll) {
  const echtesError = console.error;
  console.error = (...a) => protokoll.fehler.push(a.map(String).join(' '));
  try {
    for (let i = 0; i < TAGE_NOTBREMSE; i++) {
      const res = await advanceDay(state);
      if (res.stop === 'saisonende') return protokoll;

      if (res.stop === 'spieltag') {
        const fx = res.fixture;
        if (fx.freilos) { fx.played = true; }
        else {
          const ctx = makeCtx(state);
          try {
            applyResult(state, fx, simulateAiFixture(state, fx, ctx), ctx);
            protokoll.eigeneSpiele++;
          } catch (err) {
            protokoll.fehler.push(`Eigene Partie ${fx.id}: ${err && err.message}`);
            fx.played = true; fx.result = { score: [0, 0], stats: null };
          }
        }
      } else if (res.stop === 'entlassung') {
        // Wie in test-saison.js: Der Prüfstand braucht acht volle Spielzeiten.
        protokoll.entlassungen++;
        state.flags.entlassen = false;
      } else if (res.stop === 'post') {
        for (const m of state.inbox) if (!m.gelesen && m.day === state.date.day) m.gelesen = true;
      }

      try { pokalWeiterlosen(state, makeCtx(state)); }
      catch (err) { protokoll.fehler.push(`Pokalauslosung: ${err && err.message}`); }
    }
  } finally {
    console.error = echtesError;
  }
  protokoll.fehler.push(`Notbremse: ${TAGE_NOTBREMSE} Schritte ohne Saisonende (Tag ${state.date.day})`);
  return protokoll;
}

function neuesProtokoll() { return { eigeneSpiele: 0, entlassungen: 0, fehler: [] }; }

/* ================================================================== *
 *  2. Die Chronik, nachgebaut
 *
 *  Alles zwischen hier und Abschnitt 3 ist die Übersetzung von
 *  src/screens/chronik.js in Werte statt Bildschirmelemente. Wer dort etwas
 *  ändert, ändert es hier mit – sonst prüft dieses Skript eine Chronik, die
 *  es nicht mehr gibt.
 * ================================================================== */

const istLegende = p => !!(p && p.era === 'legend');

function spielerName(p, ersatz = 'Unbekannt') {
  if (!p) return ersatz;
  return p.shortName || p.lastName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || ersatz;
}

function vereinVon(state, ref) {
  if (!ref) return null;
  const id = typeof ref === 'string' ? ref : (ref.clubId || ref.id || null);
  if (!id) return null;
  return (state.clubs && state.clubs[id]) || null;
}

function vereinName(state, clubId, ersatz = 'unbekannt') {
  const c = vereinVon(state, clubId);
  return c ? (c.name || c.shortName || ersatz) : ersatz;
}

function vereinKurz(state, clubId, ersatz = '–') {
  const c = vereinVon(state, clubId);
  return c ? (c.shortName || c.abbr || c.name || ersatz) : ersatz;
}

function spielerVon(state, ref) {
  if (!ref) return null;
  const id = typeof ref === 'string' ? ref : (ref.playerId || ref.id || null);
  if (!id) return null;
  return (state.players && state.players[id]) || null;
}

function komma(v, stellen = 2) {
  const n = Number(v);
  if (!isFinite(n)) return '–';
  return n.toFixed(stellen).replace('.', ',');
}

function archiv(state) {
  const h = (state && state.history) || {};
  return {
    seasons: Array.isArray(h.seasons) ? h.seasons.filter(Boolean) : [],
    titel: (h.titel && typeof h.titel === 'object') ? h.titel : {},
    rekorde: (h.rekorde && typeof h.rekorde === 'object') ? h.rekorde : {},
    transfers: Array.isArray(h.transfers) ? h.transfers.filter(Boolean) : []
  };
}

function titelSaisons(state) {
  return Object.keys(archiv(state).titel).map(Number).filter(n => isFinite(n)).sort((a, b) => a - b);
}

/* ---- 2a. Ewige Tabelle (chronik.js:ewigeTabelle) ------------------- */

function neuesKonto(clubId) {
  return {
    id: clubId, clubId, saisons: 0, spiele: 0, punkte: 0, diff: 0,
    s: 0, u: 0, n: 0, tore: 0, gegentore: 0,
    detailErgebnisse: 0, detailTore: 0, beste: null, schlechteste: null, meister: 0, pokal: 0
  };
}

function ewigeTabelle(state, ligaId) {
  const a = archiv(state);
  const konten = new Map();
  const konto = (clubId) => {
    let k = konten.get(clubId);
    if (!k) { k = neuesKonto(clubId); konten.set(clubId, k); }
    return k;
  };

  let saisons = 0, mitErgebnissen = 0, mitToren = 0;
  for (const b of a.seasons) {
    const zeilen = (b.tabellen && b.tabellen[ligaId]) || [];
    if (!zeilen.length) continue;
    saisons++;
    const spieleVoll = Math.max(0, (zeilen.length - 1) * 2);
    let hatErgebnisse = false, hatTore = false;
    for (const zl of zeilen) {
      if (!zl || !zl.clubId) continue;
      const k = konto(zl.clubId);
      k.saisons++;
      k.punkte += Number(zl.punkte) || 0;
      k.diff += Number(zl.diff) || 0;
      k.spiele += Number.isFinite(zl.spiele) ? zl.spiele : spieleVoll;
      if (Number.isFinite(zl.s) && Number.isFinite(zl.u) && Number.isFinite(zl.n)) {
        k.s += zl.s; k.u += zl.u; k.n += zl.n; k.detailErgebnisse++; hatErgebnisse = true;
      }
      if (Number.isFinite(zl.tore) && Number.isFinite(zl.gegentore)) {
        k.tore += zl.tore; k.gegentore += zl.gegentore; k.detailTore++; hatTore = true;
      }
      const platz = Number(zl.platz) || 0;
      if (platz > 0) {
        if (k.beste === null || platz < k.beste) k.beste = platz;
        if (k.schlechteste === null || platz > k.schlechteste) k.schlechteste = platz;
        if (platz === 1) k.meister++;
      }
    }
    if (hatErgebnisse) mitErgebnissen++;
    if (hatTore) mitToren++;
  }

  for (const s of titelSaisons(state)) {
    const e = a.titel[s];
    if (e && e.pokalsieger && konten.has(e.pokalsieger)) konten.get(e.pokalsieger).pokal++;
  }

  const zeilen = sortBy(Array.from(konten.values()),
    k => ({ key: k.punkte, desc: true }),
    k => ({ key: k.diff, desc: true }),
    k => ({ key: k.tore, desc: true }),
    k => k.clubId);
  zeilen.forEach((k, i) => {
    k.rang = i + 1;
    k.schnitt = k.spiele > 0 ? k.punkte / k.spiele : 0;
  });

  return {
    zeilen, saisons,
    vollErgebnisse: saisons > 0 && mitErgebnissen === saisons,
    vollTore: saisons > 0 && mitToren === saisons
  };
}

function ewigAbbild(state) {
  const out = {};
  for (const ligaId of LEAGUE_IDS) {
    const erg = ewigeTabelle(state, ligaId);
    out[ligaId] = {
      saisons: erg.saisons,
      vollErgebnisse: erg.vollErgebnisse,
      vollTore: erg.vollTore,
      zeilen: erg.zeilen.map(k => [
        k.rang, vereinName(state, k.clubId, k.clubId), k.saisons, k.spiele, k.s, k.u, k.n,
        `${nfmt(k.tore)}:${nfmt(k.gegentore)}`,
        (k.diff > 0 ? '+' : '') + nfmt(k.diff), k.punkte, komma(k.schnitt),
        k.beste ? `${k.beste}.` : '–', k.schlechteste ? `${k.schlechteste}.` : '–',
        k.meister, k.pokal
      ])
    };
  }
  return out;
}

/* ---- 2b. Titelchronik (chronik.js:jahresKarte) --------------------- */

function europaSieger(state, saison) {
  const namen = { cl: 'Champions League', el: 'Europa League', conf: 'Conference League' };
  const gefunden = new Map();
  const eu = state.europa || {};
  if (eu.sieger && Number(eu.saison) === Number(saison)) {
    for (const wb of ['cl', 'el', 'conf']) {
      if (eu.sieger[wb]) gefunden.set(namen[wb], { wettbewerb: namen[wb], clubId: eu.sieger[wb] });
    }
  }
  const titel = (state.manager && Array.isArray(state.manager.titel)) ? state.manager.titel : [];
  for (const t of titel) {
    if (!t || typeof t !== 'object' || Number(t.season) !== Number(saison)) continue;
    const name = String(t.name || '');
    if (!/League-Sieger$/.test(name)) continue;
    const wb = name.replace('-Sieger', '').replace('-', ' ');
    gefunden.set(wb, { wettbewerb: wb, clubId: t.clubId || null });
  }
  return Array.from(gefunden.values());
}

function titelAbbild(state) {
  const a = archiv(state);
  const out = [];
  for (const saison of titelSaisons(state)) {
    const e = a.titel[saison] || {};
    const tk = e.torschuetzenkoenig;
    const meineTitel = (state.manager && Array.isArray(state.manager.titel) ? state.manager.titel : [])
      .filter(t => t && typeof t === 'object' && Number(t.season) === Number(saison))
      .map(t => `🏆 ${t.name}`);
    let satz = '';
    try { satz = chronikText(state, saison) || ''; } catch (err) { satz = '[chronikText wirft: ' + (err && err.message) + ']'; }
    out.push({
      saison,
      kopf: e.managerPlatz
        ? `${vereinKurz(state, e.managerVerein)} · ${e.managerPlatz}. in der ${(LEAGUES[e.managerLiga] || {}).name || e.managerLiga}`
        : null,
      meister: e.meister ? vereinName(state, e.meister) : 'nicht vergeben',
      pokalsieger: e.pokalsieger ? vereinName(state, e.pokalsieger) : 'kein Endspiel entschieden',
      europa: europaSieger(state, saison).map(x => `${x.wettbewerb}: ${x.clubId ? vereinKurz(state, x.clubId) : '–'}`),
      torschuetzenkrone: (tk && tk.tore)
        ? `${tk.name || spielerName(spielerVon(state, tk))} · ${vereinKurz(state, tk.clubId)} · ` +
          `${tk.tore} Tore in ${tk.spiele || '?'} Spielen`
        : 'niemand hat getroffen',
      aufsteiger: (Array.isArray(e.aufsteiger) ? e.aufsteiger : []).map(id => vereinKurz(state, id)),
      absteiger: (Array.isArray(e.absteiger) ? e.absteiger : []).map(id => vereinKurz(state, id)),
      vitrine: meineTitel,
      satz
    });
  }
  return out;
}

/* ---- 2c. Rekordbuch (chronik.js:rekordeTab) ------------------------ */

function teuersterTransfer(state) {
  const t = archiv(state).transfers;
  let best = null;
  for (const e of t) {
    const ablose = Number(e.ablose) || 0;
    if (ablose <= 0) continue;
    if (!best || ablose > best.ablose ||
      (ablose === best.ablose && String(e.playerId) < String(best.playerId))) best = e;
  }
  return best;
}

function juengsterDebuetant(state) {
  const heute = Number(state.date.season) || 1;
  let best = null;
  for (const pid of Object.keys(state.players || {}).sort()) {
    const p = state.players[pid];
    if (!p || p.retired || !p.stats) continue;
    const hist = Array.isArray(p.stats.history) ? p.stats.history : [];
    if (hist.length >= 12) continue;
    let saison = null;
    if (hist.length) saison = Number(hist[0].season);
    else if ((p.stats.season && p.stats.season.spiele) > 0) saison = heute;
    if (!isFinite(saison) || saison <= 0) continue;
    const alter = (Number(p.age) || 0) - (heute - saison);
    if (!isFinite(alter) || alter <= 12 || alter > 45) continue;
    const clubId = (hist.length ? hist[0].clubId : null) || p.clubId || null;
    if (!best || alter < best.alter || (alter === best.alter && saison < best.season)) {
      best = { player: p, alter, season: saison, clubId };
    }
  }
  return best;
}

function serieOhneGegentor(state) {
  const saison = Number(state.date.season);
  const partien = (state.fixtures || []).filter(f =>
    f && f.played && f.season === saison && f.result && Array.isArray(f.result.score) &&
    typeof f.result.score[0] === 'number' && typeof f.result.score[1] === 'number');
  const nachTag = sortBy(partien, f => Number(f.dayIndex) || 0, f => String(f.id || ''));
  const stand = new Map();
  let best = null;
  for (const f of nachTag) {
    const [h, a] = f.result.score;
    for (const [clubId, kassiert] of [[f.homeId, a], [f.awayId, h]]) {
      if (!clubId) continue;
      const laenge = kassiert === 0 ? (stand.get(clubId) || 0) + 1 : 0;
      stand.set(clubId, laenge);
      if (laenge > 0 && (!best || laenge > best.laenge ||
        (laenge === best.laenge && String(clubId) < String(best.clubId)))) {
        best = { clubId, laenge, saison };
      }
    }
  }
  return best;
}

function spielerBestenlisten(state) {
  const alle = [];
  for (const pid of Object.keys(state.players || {}).sort()) {
    const p = state.players[pid];
    const c = p && p.stats && p.stats.career;
    if (!c || !(c.spiele > 0)) continue;
    alle.push({
      id: p.id, player: p, spiele: c.spiele || 0, tore: c.tore || 0,
      vorlagen: c.vorlagen || 0, zuNull: c.zuNull || 0,
      clubId: p.clubId || (p.retired && p.retired.clubId) || null,
      raus: !!p.retired
    });
  }
  return {
    spiele: sortBy(alle, e => ({ key: e.spiele, desc: true }), e => e.id).slice(0, 10),
    tore: sortBy(alle.filter(e => e.tore > 0), e => ({ key: e.tore, desc: true }), e => e.id).slice(0, 10)
  };
}

function rekordAbbild(state) {
  const r = archiv(state).rekorde;
  const teuer = teuersterTransfer(state);
  const debuet = juengsterDebuetant(state);
  const weiss = serieOhneGegentor(state);
  const listen = spielerBestenlisten(state);
  const eintrag = e => e ? [
    spielerName(e.player), vereinKurz(state, e.clubId), e.spiele, e.tore, e.vorlagen, e.zuNull,
    e.raus, istLegende(e.player)
  ] : null;

  return {
    hoechsterSieg: r.hoechsterSieg
      ? [r.hoechsterSieg.text || '–', r.hoechsterSieg.season,
        (LEAGUES[r.hoechsterSieg.wettbewerb] || {}).name || 'Pokal', r.hoechsterSieg.differenz] : null,
    meisteToreSaison: r.meisteToreSaison
      ? [r.meisteToreSaison.tore, r.meisteToreSaison.name || spielerName(spielerVon(state, r.meisteToreSaison)),
        vereinKurz(state, r.meisteToreSaison.clubId), r.meisteToreSaison.season] : null,
    meistePunkteSaison: r.meistePunkteSaison
      ? [r.meistePunkteSaison.punkte,
        r.meistePunkteSaison.name || vereinName(state, r.meistePunkteSaison.clubId),
        r.meistePunkteSaison.season] : null,
    laengsteSerie: r.laengsteSerie
      ? [r.laengsteSerie.laenge, r.laengsteSerie.name || vereinName(state, r.laengsteSerie.clubId),
        r.laengsteSerie.season] : null,
    meisteTitel: r.meisteTitel
      ? [r.meisteTitel.anzahl, r.meisteTitel.name || vereinName(state, r.meisteTitel.clubId),
        r.meisteTitel.meister || 0, r.meisteTitel.pokal || 0] : null,
    teuersterTransfer: teuer
      ? [formatMoney(teuer.ablose), teuer.name || spielerName(spielerVon(state, teuer)),
        teuer.vonId ? vereinKurz(state, teuer.vonId) : 'ablösefrei', vereinKurz(state, teuer.zuId),
        teuer.season] : null,
    juengsterDebuetant: debuet
      ? [komma(debuet.alter, 0), spielerName(debuet.player), vereinKurz(state, debuet.clubId), debuet.season] : null,
    serieOhneGegentor: weiss ? [weiss.laenge, vereinName(state, weiss.clubId), weiss.saison] : null,
    bestenlisteSpiele: listen.spiele.map(eintrag),
    bestenlisteTore: listen.tore.map(eintrag)
  };
}

/* ---- 2d. Ruhmeshalle (chronik.js:ruhmTab, ruhmKarte, abschiedsText) - */

function abschiedsText(state, p) {
  const name = spielerName(p);
  const inbox = Array.isArray(state.inbox) ? state.inbox : [];
  for (const m of inbox) {
    if (!m || m.kind !== 'karriere' || !m.subject || !m.body) continue;
    const teile = String(m.subject).split(':');
    if (teile.length < 2) continue;
    if (teile[teile.length - 1].trim() !== name) continue;
    return m.body;
  }
  return null;
}

/** Alles, woraus render/portraits.js das Gesicht baut. Ein Bild geht hier nicht. */
function portraitAbdruck(p) {
  return JSON.stringify([p.appearance || null, p.position || null, p.nationality || null,
    p.era || null, p.number || null]);
}

function ruhmKarte(state, p) {
  const c = vereinVon(state, (p.retired && p.retired.clubId) || p.clubId);
  const legende = istLegende(p);
  const st = (p.stats && p.stats.career) || {};
  let ovr = 0;
  try { ovr = playerOverall(p); } catch (err) { ovr = -1; }
  const brief = abschiedsText(state, p);
  return [
    `${p.firstName || ''} ${p.lastName || ''}`.trim() || spielerName(p),
    legende ? (p.eraLabel || 'Vereinslegende') : null,
    [POSITION_NAMES[p.position] || p.position || '?',
      c ? c.name : 'vereinslos',
      p.retired ? `Karriereende Saison ${p.retired.season} mit ${p.retired.alter} Jahren` : null
    ].filter(Boolean).join(' · '),
    (p.retired && p.retired.grund) ? `Grund: ${p.retired.grund}` : '',
    [nfmt(st.spiele || 0), nfmt(st.tore || 0), nfmt(st.vorlagen || 0), nfmt(st.zuNull || 0), String(ovr || '–')],
    brief || (legende
      ? 'Er hängt die Schuhe an den Nagel. Beim nächsten Anpfiff wird das Stadion eine Sekunde stiller sein.'
      : 'Ein Profileben, das niemand in der Sportschau zusammenfassen wird — aber eines, das sich gelohnt hat.'),
    portraitAbdruck(p)
  ];
}

function ruhmAbbild(state) {
  const club = state.clubs[state.managerClubId];
  const alle = [];
  for (const pid of Object.keys(state.players || {}).sort()) {
    const p = state.players[pid];
    if (p && p.retired) alle.push(p);
  }
  if (!alle.length) return { anzahl: 0, legenden: [], eigene: [], rest: [] };

  const sortiert = sortBy(alle,
    p => ({ key: istLegende(p) ? 1 : 0, desc: true }),
    p => ({ key: (p.retired && p.retired.season) || 0, desc: true }),
    p => ({ key: (p.stats && p.stats.career && p.stats.career.spiele) || 0, desc: true }),
    p => p.id);

  const legenden = sortiert.filter(p => istLegende(p));
  const eigene = sortiert.filter(p => !istLegende(p) && club && ((p.retired && p.retired.clubId) === club.id));
  const eigeneIds = new Set(eigene.map(p => p.id));
  const rest = sortiert.filter(p => !istLegende(p) && !eigeneIds.has(p.id));

  return {
    anzahl: sortiert.length,
    legenden: legenden.map(p => ruhmKarte(state, p)),
    eigene: eigene.map(p => ruhmKarte(state, p)),
    rest: rest.map(p => {
      const st = (p.stats && p.stats.career) || {};
      return [
        spielerName(p),
        POSITION_NAMES[p.position] || p.position || '–',
        vereinKurz(state, (p.retired && p.retired.clubId) || p.clubId),
        (p.retired && p.retired.season) || null,
        (p.retired && p.retired.alter) || p.age || null,
        st.spiele || 0, st.tore || 0
      ];
    })
  };
}

/** Die vier Auswertungen der Chronik als ein vergleichbarer Abdruck. */
function chronikAbbild(state) {
  return {
    halle: JSON.stringify(ruhmAbbild(state)),
    ewig: JSON.stringify(ewigAbbild(state)),
    titel: JSON.stringify(titelAbbild(state)),
    rekorde: JSON.stringify(rekordAbbild(state))
  };
}

/** Die erste Stelle, an der sich zwei Abdrücke unterscheiden – Zeichen für Zeichen. */
function ersteAbweichung(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  const von = Math.max(0, i - 60);
  return `ab Zeichen ${i} (Länge ${a.length} statt ${b.length}):\n` +
    `            vorher : …${a.slice(von, i + 90)}…\n` +
    `            nachher: …${b.slice(von, i + 90)}…`;
}

/* ================================================================== *
 *  3. Zusicherungen am Spielstand selbst
 * ================================================================== */

const ERLAUBTE_RUECKTRITTSFELDER = new Set([
  'id', 'firstName', 'lastName', 'shortName', 'clubId',
  'nationality', 'age', 'position', 'era', 'eraLabel', 'number',
  'appearance', 'attributes', 'retired', 'stats'
]);

function ruecktritteVermessen(state) {
  let anzahl = 0, byte = 0, ueberfluessig = new Map();
  for (const pid in state.players) {
    const p = state.players[pid];
    if (!p || !p.retired) continue;
    anzahl++;
    byte += JSON.stringify(p).length;
    for (const feld in p) {
      if (ERLAUBTE_RUECKTRITTSFELDER.has(feld)) continue;
      ueberfluessig.set(feld, (ueberfluessig.get(feld) || 0) + 1);
    }
    if (p.stats) {
      for (const feld in p.stats) {
        if (feld === 'career') continue;
        ueberfluessig.set('stats.' + feld, (ueberfluessig.get('stats.' + feld) || 0) + 1);
      }
    }
  }
  return { anzahl, byte, ueberfluessig };
}

/**
 * Verweise ins Leere.
 *
 * `state.history.transfers` bleibt bewusst draußen: Das ist ein Ereignisarchiv,
 * kein Verweis – die Einträge tragen den Namen selbst mit sich und überleben
 * den Spieler mit Absicht (chronik.js zeigt „Teuerster Transfer" daraus).
 */
function verwaisteVerweise(state) {
  const treffer = [];
  const kennt = id => !!(id && state.players[id]);
  const pruef = (id, wo) => { if (id && !kennt(id)) treffer.push(`${wo} -> ${id}`); };

  for (const id of state.freeAgents || []) pruef(id, 'freeAgents');
  for (const clubId in state.clubs) {
    const c = state.clubs[clubId];
    if (!c) continue;
    for (const id of c.playerIds || []) pruef(id, `${clubId}.playerIds`);
    for (const id of c.transferliste || []) pruef(id, `${clubId}.transferliste`);
    for (const e of c.beobachtet || []) pruef(typeof e === 'string' ? e : (e && e.playerId), `${clubId}.beobachtet`);
    for (const e of c['gerüchte'] || []) pruef(e && e.playerId, `${clubId}.gerüchte`);
    const y = c.youth || {};
    for (const id of y.talente || []) pruef(id, `${clubId}.youth.talente`);
    const t = c.tactics || {};
    for (const slot in (t.lineup || {})) pruef(t.lineup[slot], `${clubId}.tactics.lineup.${slot}`);
    for (const id of t.bench || []) pruef(id, `${clubId}.tactics.bench`);
    for (const k in (t.setPieces || {})) pruef(t.setPieces[k], `${clubId}.tactics.setPieces.${k}`);
    const kab = c.kabine || {};
    for (const id of kab.mannschaftsrat || []) pruef(id, `${clubId}.kabine.mannschaftsrat`);
    for (const kf of kab.konflikte || []) {
      for (const id of (kf && kf.playerIds) || []) pruef(id, `${clubId}.kabine.konflikte`);
    }
  }
  for (const pid in state.players) {
    const p = state.players[pid];
    if (!p) continue;
    if (p.mentor && p.mentor.mentorId) pruef(p.mentor.mentorId, `${pid}.mentor`);
    for (const id of p.mentees || []) pruef(id, `${pid}.mentees`);
  }
  return treffer;
}

/* ================================================================== *
 *  4. Der Lauf
 * ================================================================== */

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  TRAUMVEREIN – Spielstandbremse (ROADMAP 8.1)                ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log(`  Seed ${SEED} · ${SAISONS} Spielzeiten · Verein ${EIGENER_VEREIN} · Grenze ${mb(GRENZE)}`);
console.log(`  Verdichtung: Postfach ${VERDICHTUNG.postfach}, Meldungen ${VERDICHTUNG.meldungen}, ` +
  `Kassenbuch ${VERDICHTUNG.ledgerEigen}/${VERDICHTUNG.ledgerKi}, Verletzungsakte ` +
  `${VERDICHTUNG.verletzungsJahre} Jahre, Nachwuchsabschied ab ${VERDICHTUNG.jugendAbschiedAlter}`);

const gestartet = Date.now();
const alleFehler = [];

/* ---- 4a. Referenzlauf ohne Bremse (nur mit --referenz) ------------- */

const referenz = [];
if (MIT_REFERENZ) {
  abschnitt('A) Referenzlauf OHNE Bremse');
  const state = createNewGame({
    clubId: EIGENER_VEREIN, managerName: 'Testtrainer', difficulty: 'profi', seed: SEED
  });
  referenz.push({ saison: 0, groesse: serialize(state).length });
  for (let s = 1; s <= SAISONS; s++) {
    const p = neuesProtokoll();
    await saisonSpielen(state, p);
    await saisonWechsel(state, makeCtx(state), { bremse: false });
    const groesse = serialize(state).length;
    referenz.push({ saison: s, groesse });
    console.log(`    Saison ${s}: ${mb(groesse)}` +
      (s > 1 ? ` (+${mb(groesse - referenz[s - 1].groesse)})` : ''));
    alleFehler.push(...p.fehler);
  }
} else {
  abschnitt('A) Referenzlauf OHNE Bremse');
  console.log('    übersprungen – mit --referenz spielt dieses Skript acht weitere');
  console.log('    Spielzeiten ohne Verdichtung und stellt beide Kurven nebeneinander.');
  console.log('    Ohne ihn steht in Spalte „vorher" der Stand unmittelbar vor der');
  console.log('    Verdichtung DIESER Saison – nicht der einer nie gebremsten Karriere.');
}

/* ---- 4b. Der gebremste Lauf ---------------------------------------- */

abschnitt('B) Lauf MIT Bremse');

const state = createNewGame({
  clubId: EIGENER_VEREIN, managerName: 'Testtrainer', difficulty: 'profi', seed: SEED
});

const anpfiff = serialize(state).length;
const kurve = [{ saison: 0, vorher: anpfiff, nachher: anpfiff }];
const abbildDiff = { halle: 0, ewig: 0, titel: 0, rekorde: 0 };
const abbildErste = {};
let verdichtungenKleiner = 0, verdichtungenGroesser = 0;
let ruecktritteGesamt = 0, jugendGesamt = 0, fixturesGesamt = 0;
/** Z11: was der ungeschaltete, echte Saisonwechsel aus derselben Lage macht. */
let echterWeg = null;

unterpunkt(`Anpfiff: ${mb(kurve[0].nachher)}`);

for (let saison = 1; saison <= SAISONS; saison++) {
  const t0 = Date.now();
  const p = neuesProtokoll();
  await saisonSpielen(state, p);
  alleFehler.push(...p.fehler);
  if (p.entlassungen) H(`Saison ${saison}: ${p.entlassungen}× entlassen – für den Prüflauf ignoriert`);

  /* --- Z11: einmal derselbe Wechsel, wie ihn das Spiel geht ---------- *
   * Ein Zwilling aus derselben Lage, durch das UNGESCHALTETE
   * saisonWechsel() – also mit der Bremse an ihrem echten Platz. Das ist
   * die Zusicherung, die gefehlt hat: Bis zu dieser Abnahme war die
   * Verdichtung vollständig gebaut, vollständig geprüft und im Spiel nie
   * aufgerufen, weil jeder Prüfstand sie selbst angestoßen hat.
   * Einmal reicht; ein Saisonwechsel kostet 20 ms, aber ein Zwilling
   * kostet zwei Serialisierungen. */
  const rohVorWechsel = saison === 1 ? serialize(state) : null;

  await saisonWechsel(state, makeCtx(state), { bremse: false });

  /* --- Die Chronik VOR der Verdichtung ------------------------------ */
  const vorher = chronikAbbild(state);

  /* --- Die Verdichtung. Im Spiel macht das core/loop.js:saisonWechsel() *
   * --- selbst; hier von Hand, damit beide Seiten sichtbar sind. ------ */
  const b = verdichteVergangenheit(state, { messen: true });

  if (rohVorWechsel) {
    const zwilling = deserialize(rohVorWechsel);
    await saisonWechsel(zwilling, makeCtx(zwilling));
    echterWeg = {
      groesse: serialize(zwilling).length,
      ungebremst: b.vorher,
      ueberfluessig: Array.from(ruecktritteVermessen(zwilling).ueberfluessig.keys())
    };
  }

  /* --- Die Chronik NACH der Verdichtung ----------------------------- */
  const nachher = chronikAbbild(state);
  for (const teil of ['halle', 'ewig', 'titel', 'rekorde']) {
    if (vorher[teil] === nachher[teil]) continue;
    abbildDiff[teil]++;
    if (!abbildErste[teil]) abbildErste[teil] = `Saison ${saison}: ` + ersteAbweichung(vorher[teil], nachher[teil]);
  }

  if (b.gespart > 0) verdichtungenKleiner++;
  else verdichtungenGroesser++;
  ruecktritteGesamt += b.ruecktritte;
  jugendGesamt += b.jugendGeloescht;
  fixturesGesamt += b.fixtures;

  kurve.push({ saison, vorher: b.vorher, nachher: b.nachher });

  const vor = kurve[saison - 1].nachher;
  console.log(`    Saison ${saison}: vorher ${mb(b.vorher)} → nachher ${mb(b.nachher)} ` +
    `(−${kb(b.gespart)}, Zuwachs gegenüber Vorjahr ${mb(b.nachher - vor)}) · ${sek(Date.now() - t0)}`);
  // „verdichtet", nicht „neu eingedampft": loop.js:spielerFortschreiben hängt
  // auch einem längst zurückgetretenen Spieler jede Saison eine frische
  // Statistikzeile an. Die Bremse nimmt sie ihm jedes Jahr wieder ab.
  console.log(`               ${b.ruecktritte} Karriereenden verdichtet · ` +
    `${b.jugendGeloescht} Nachwuchsspieler gestrichen · ${b.fixtures} Partien gekürzt · ` +
    `${b.postfach} Nachrichten, ${b.meldungen} Meldungen weg · ` +
    `${b.spieler} Spieler / ${b.vereine} Vereine durchgesehen`);
}

/* ---- 4c. Zusicherungen zum Spielstand ------------------------------ */

abschnitt('C) Zusicherungen');

const ende = kurve[kurve.length - 1];
z(1, ende.nachher < GRENZE,
  `${mb(ende.nachher)} nach ${SAISONS} Spielzeiten (Grenze ${mb(GRENZE)})`);

/* --- Z2: Wachstum je Spielzeit -------------------------------------- */
const zuwachs = [];
for (let i = 2; i < kurve.length; i++) zuwachs.push(kurve[i].nachher - kurve[i - 1].nachher);
// Saison 1 bleibt draußen: Da entstehen Kader, Nachwuchs und Statistik erst –
// das ist Aufbau, kein Wachstum. Verglichen wird die erste Hälfte der übrigen
// Spielzeiten mit der zweiten; einzelne Jahre schwanken zu stark für einen
// Vergleich von Nachbar zu Nachbar (Aufstieg, Pokallauf, Generationswechsel).
const haelfte = Math.floor(zuwachs.length / 2);
const frueh = zuwachs.slice(0, haelfte);
const spaet = zuwachs.slice(zuwachs.length - haelfte);
const mittel = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
if (haelfte < 1) {
  zoffen(2, `zu wenige Spielzeiten (${SAISONS}) für einen Trend – mindestens 4 nötig`);
} else {
  z(2, mittel(spaet) <= mittel(frueh),
    `Zuwachs je Saison ${zuwachs.map(v => mb(v)).join(' · ')} — ` +
    `erste Hälfte ⌀ ${mb(mittel(frueh))}, zweite Hälfte ⌀ ${mb(mittel(spaet))}`);
}

z(3, verdichtungenGroesser === 0,
  `${verdichtungenKleiner}× kleiner, ${verdichtungenGroesser}× nicht kleiner ` +
  `(insgesamt ${ruecktritteGesamt} Karriereenden, ${jugendGesamt} Nachwuchsspieler, ${fixturesGesamt} Partien)`);

z(4, abbildDiff.halle === 0,
  abbildDiff.halle ? `${abbildDiff.halle}× abweichend — ${abbildErste.halle}`
    : `${SAISONS}× identisch, zuletzt ${ruhmAbbild(state).anzahl} Karriereenden in der Halle`);
z(5, abbildDiff.ewig === 0,
  abbildDiff.ewig ? `${abbildDiff.ewig}× abweichend — ${abbildErste.ewig}`
    : `${SAISONS}× identisch (${LEAGUE_IDS.join(', ')})`);
z(6, abbildDiff.titel === 0,
  abbildDiff.titel ? `${abbildDiff.titel}× abweichend — ${abbildErste.titel}`
    : `${SAISONS}× identisch, ${titelSaisons(state).length} Spielzeiten in der Chronik`);
z(7, abbildDiff.rekorde === 0,
  abbildDiff.rekorde ? `${abbildDiff.rekorde}× abweichend — ${abbildErste.rekorde}`
    : `${SAISONS}× identisch (acht Rekordkarten und zwei Bestenlisten)`);

const rt = ruecktritteVermessen(state);
const zuviel = Array.from(rt.ueberfluessig.entries()).map(([f, n]) => `${f} (${n}×)`);
z(8, zuviel.length === 0,
  zuviel.length ? `${zuviel.length} überflüssige Felder: ${zuviel.slice(0, 6).join(', ')}`
    : `${rt.anzahl} Karriereenden, ⌀ ${rt.anzahl ? Math.round(rt.byte / rt.anzahl) : 0} Byte je Datensatz`);

const verwaist = verwaisteVerweise(state);
z(9, verwaist.length === 0,
  verwaist.length ? `${verwaist.length} Verweise ins Leere – ${verwaist.slice(0, 4).join(', ')}`
    : `${Object.keys(state.players).length} Spieler, kein Verweis ohne Datensatz`);

/* ---- 4d. Z10: ein Spielstand der alten Fassung ---------------------- */

abschnitt('D) Ein Spielstand der Fassung 3');

try {
  const alt = createNewGame({
    clubId: EIGENER_VEREIN, managerName: 'Altmanager', difficulty: 'profi', seed: SEED + 1
  });
  for (let s = 1; s <= ALT_SAISONS; s++) {
    const p = neuesProtokoll();
    await saisonSpielen(alt, p);
    // Ohne Bremse, denn genau so sah ein Spielstand der Fassung 3 aus: Die
    // Fassung 4 lässt einen ungebremsten Stand gar nicht mehr entstehen.
    await saisonWechsel(alt, makeCtx(alt), { bremse: false });
    alleFehler.push(...p.fehler);
  }
  // So lag er in der Datei: nie verdichtet, mit der Versionsnummer von damals.
  const roh = JSON.parse(serialize(alt));
  // Zweimal dieselbe Datei, nur die Versionsnummer unterscheidet sich: Mit der
  // aktuellen läuft deserialize() an migrate() vorbei und liefert den Stand
  // ungekürzt – das ist der Vergleichsmaßstab für die Chronik nach der Migration.
  const alsNeu = JSON.stringify(Object.assign({}, roh, { version: SAVE_VERSION }));
  roh.version = 3;
  const datei = JSON.stringify(roh);
  unterpunkt(`${ALT_SAISONS} Spielzeiten ohne Bremse gespielt: ${mb(datei.length)}, Version 3`);

  const vorMigration = chronikAbbild(deserialize(alsNeu));

  const meldungen = [];
  const echtesWarn = console.warn;
  console.warn = (...a) => meldungen.push(a.map(String).join(' '));
  let geladen = null;
  try {
    geladen = deserialize(datei);
  } finally {
    console.warn = echtesWarn;
  }

  const nachMigrationAbbild = chronikAbbild(geladen);
  const abweichend = ['halle', 'ewig', 'titel', 'rekorde'].filter(t => vorMigration[t] !== nachMigrationAbbild[t]);
  if (abweichend.length) {
    console.log(`        Die Migration hat die Chronik verändert: ${abweichend.join(', ')}`);
    console.log('        ' + ersteAbweichung(vorMigration[abweichend[0]], nachMigrationAbbild[abweichend[0]]));
  }

  const nachMigration = serialize(geladen).length;
  for (const m of meldungen) if (m.indexOf('[state]') === 0) OK(m.replace(/^\[state\] /, 'migrate: '));

  const p = neuesProtokoll();
  await saisonSpielen(geladen, p);
  // Ohne Schalter: Der Wechsel verdichtet hier selbst, wie im Spiel.
  const bericht = await saisonWechsel(geladen, makeCtx(geladen));
  alleFehler.push(...p.fehler);

  const rtAlt = ruecktritteVermessen(geladen);
  const zuvielAlt = Array.from(rtAlt.ueberfluessig.keys());
  const weitergespielt = p.eigeneSpiele > 0 && bericht && typeof bericht === 'object' &&
    Array.isArray(bericht.aufsteiger) && geladen.date.season === ALT_SAISONS + 2;

  z(10, geladen.version === SAVE_VERSION && nachMigration < datei.length &&
    weitergespielt && zuvielAlt.length === 0 && abweichend.length === 0 && rtAlt.anzahl > 0,
    `Version ${geladen.version}, beim Laden ${mb(datei.length)} → ${mb(nachMigration)} ` +
    `(−${kb(datei.length - nachMigration)}), ${rtAlt.anzahl} Karriereenden in der Halle, ` +
    `Chronik ${abweichend.length ? 'ABWEICHEND (' + abweichend.join(', ') + ')' : 'unverändert'}, ` +
    `danach ${p.eigeneSpiele} eigene Partien und ein Saisonwechsel nach Saison ${geladen.date.season}` +
    (zuvielAlt.length ? `, ABER ${zuvielAlt.length} überflüssige Felder` : ''));
} catch (err) {
  z(10, false, `Der alte Spielstand ist unterwegs gescheitert: ${err && err.message}`);
  if (err && err.stack) console.log('        ' + String(err.stack).split('\n').slice(1, 4).join('\n        '));
}

/* ---- 4e. Z11: der Weg, den das Spiel wirklich geht ------------------ */

abschnitt('D2) Der Saisonwechsel ohne Schalter');

if (!echterWeg) {
  zoffen(11, 'kein Zwilling gebaut – dazu braucht es mindestens eine Spielzeit');
} else {
  z(11, echterWeg.groesse < echterWeg.ungebremst && echterWeg.ueberfluessig.length === 0,
    `derselbe Wechsel ohne Schalter: ${mb(echterWeg.ungebremst)} → ${mb(echterWeg.groesse)} ` +
    `(−${kb(echterWeg.ungebremst - echterWeg.groesse)})` +
    (echterWeg.ueberfluessig.length
      ? `, ABER ${echterWeg.ueberfluessig.length} überflüssige Felder an Zurückgetretenen: ${echterWeg.ueberfluessig.slice(0, 6).join(', ')}`
      : ', kein überflüssiges Feld an einem Zurückgetretenen'));
}

/* ================================================================== *
 *  5. Bericht
 * ================================================================== */

abschnitt('E) Spielstandgröße je Spielzeit');
const sp = (v, b = 11) => String(v).padStart(b);
if (MIT_REFERENZ) {
  console.log('  Saison │ ohne Bremse │  mit Bremse │   Ersparnis │ Zuwachs ohne │ Zuwachs mit');
  console.log('  ───────┼─────────────┼─────────────┼─────────────┼──────────────┼─────────────');
  for (let i = 0; i < kurve.length; i++) {
    const o = referenz[i] ? referenz[i].groesse : null;
    const m = kurve[i].nachher;
    const zo = (i > 0 && referenz[i] && referenz[i - 1]) ? referenz[i].groesse - referenz[i - 1].groesse : null;
    const zm = i > 0 ? m - kurve[i - 1].nachher : null;
    // Zeile 0 ist der Anpfiff – dort hat noch keine Verdichtung stattgefunden,
    // und die beiden Läufe unterscheiden sich nur um die Länge einer Nachrichten-ID.
    console.log(`  ${sp(kurve[i].saison, 6)} │ ${sp(o === null ? '–' : mb(o))} │ ${sp(mb(m))} │ ` +
      `${sp(o === null || i === 0 ? '–' : mb(o - m))} │ ${sp(zo === null ? '–' : mb(zo), 12)} │ ` +
      `${sp(zm === null ? '–' : mb(zm))}`);
  }
} else {
  console.log('  Saison │ vor der Verdichtung │      danach │   Ersparnis │ Zuwachs zum Vorjahr');
  console.log('  ───────┼─────────────────────┼─────────────┼─────────────┼─────────────────────');
  for (let i = 0; i < kurve.length; i++) {
    const k = kurve[i];
    const zm = i > 0 ? k.nachher - kurve[i - 1].nachher : null;
    console.log(`  ${sp(k.saison, 6)} │ ${sp(mb(k.vorher), 19)} │ ${sp(mb(k.nachher))} │ ` +
      `${sp(kb(k.vorher - k.nachher))} │ ${sp(zm === null ? '–' : mb(zm), 19)}`);
  }
}

abschnitt('F) Zusicherungen');
let fehlgeschlagen = 0, ungeprueft = 0;
for (const nr of Object.keys(ZTITEL).sort((a, b) => a - b)) {
  const e = zstat[nr];
  const status = e.fehl ? 'FEHL' : e.ok ? ' ok ' : ' ?  ';
  if (e.fehl) fehlgeschlagen++;
  else if (!e.ok) { ungeprueft++; if (!e.offen) e.meldungen.push('nie zur Prüfung gekommen'); }
  console.log(`  [${status}] Z${String(nr).padStart(2)}  ${ZTITEL[nr]}`);
  for (const m of e.meldungen.slice(0, 2)) console.log(`          · ${m}`);
}

abschnitt('G) Ergebnis');
const modulFehler = Array.from(new Set(alleFehler));
if (modulFehler.length) {
  console.log(`  Modulmeldungen während des Laufs (${modulFehler.length} verschiedene):`);
  for (const f of modulFehler.slice(0, 8)) console.log('    · ' + f.slice(0, 160));
  if (modulFehler.length > 8) console.log(`    · … und ${modulFehler.length - 8} weitere`);
}
if (hinweise.length) {
  console.log(`  Hinweise (${hinweise.length}):`);
  for (const h of hinweise.slice(0, 8)) console.log('    · ' + h);
}

const gesamt = Object.keys(ZTITEL).length;
const bestanden = gesamt - fehlgeschlagen - ungeprueft;
console.log('\n' + '='.repeat(70));
console.log(`ERGEBNIS: ${bestanden} von ${gesamt} Zusicherungen bestanden, ` +
  `${fehlgeschlagen} fehlgeschlagen, ${ungeprueft} nicht prüfbar  (${sek(Date.now() - gestartet)})`);

const hart = fehlgeschlagen + ungeprueft;
if (!hart) {
  console.log(`${SAISONS} Spielzeiten, ${mb(ende.nachher)} Spielstand, und die Ruhmeshalle hat kein ` +
    'einziges Wort verloren. Der Archivar nickt zufrieden und geht wieder Kaffee holen.');
}
process.exit(hart ? 1 : 0);
