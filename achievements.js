/* Chronik der Feste V2 — achievements.js
 *
 * Errungenschaften/Meilensteine (40 Stück, Quelle der Wahrheit: Meilensteine_Review.xlsx).
 * Wird VOR app.js geladen; greift nur zur Laufzeit (nicht beim Laden) auf app/AEONS_DATA zu.
 *
 * Persistenz: app.stats (siehe freshStats() in app.js):
 *   achievements        { [id]: { unlockedAt } }
 *   counters            { expeditionsCompleted, expeditionsWon, winStreak, flawlessStreak, lastResult }
 *   nemesesDefeated     [nemesisId, ...]  (lifetime)
 *   everActive          { zauber, kristall, relic, schatz: [id, ...] }  (lifetime, siehe
 *                       trackEverActive() — Trackingpunkt = Commit in der Kaserne, syncBarracksIfValid())
 *   magePicks           { [mageId]: Anzahl Expeditionen, in denen der Magier gespielt wurde }
 *
 * Auswertung: evaluateAchievements(ctx) wird an den Trigger-Punkten in app.js aufgerufen.
 * ctx.event ∈ 'state' | 'fightWon' | 'expeditionEnd'. Zustandsbasierte Achievements (progress)
 * werden bei JEDEM Aufruf geprüft, ereignisbasierte (event) nur beim passenden Ereignis.
 */

// ---------- Icons (inline SVG, viewBox 0 0 24 24) — aus archive/badge-component-preview.html ----------
const ACHIEVEMENT_ICONS = {
  sword: '<path d="M14.5 2.5 21 9l-9.5 9.5-3-3L17 7l-2.5-2.5Z"/><path d="M8.5 15.5 3 21"/><path d="M6 17l2 2"/><path d="M5 19.5l-.8.8"/>',
  shieldCheck: '<path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6l-8-3Z"/><path d="M9 12.5l2 2 4-4.5"/>',
  phoenix: '<path d="M12 3c2 2 2 4 0 6-2-2-2-4 0-6Z"/><path d="M12 9c3 1 6 3 7 7-3 0-6-1-7-3-1 2-4 3-7 3 1-4 4-6 7-7Z"/><path d="M12 16v5"/><path d="M9 19l3 2 3-2"/>',
  chainBreak: '<path d="M9 7a3 3 0 1 1 4.2 4.3"/><path d="M15 17a3 3 0 1 1-4.2-4.3"/><path d="M4 13l3 3"/><path d="M17 8l3 3"/><path d="M11 11l2 2"/>',
  flame: '<path d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c0-1-.5-1.8-1-2.5.6 2 .2 3-1 4"/><path d="M9 10a5 5 0 1 0 7 5c0-2-1-3-2-4"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v13"/><path d="M7 13H3a9 7 0 0 0 9 6 9 7 0 0 0 9-6h-4"/>',
  star: '<path d="M12 3l2.3 5.1 5.6.6-4.2 3.8 1.2 5.5L12 15.8 6.9 18l1.3-5.5-4.2-3.8 5.6-.6Z"/>',
  slingshot: '<path d="M4 20 15 9"/><path d="M14 5l5 5"/><circle cx="18" cy="6" r="2"/><path d="M9 14l2 2"/>',
  puzzlePiece: '<path d="M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4v-4a2 2 0 1 0 0-4Z"/>',
  crown: '<path d="M4 18h16l-1-9-4 3-3-6-3 6-4-3Z"/><path d="M4 20h16"/>',
  crossedSwords: '<path d="M4 4l16 16"/><path d="M20 4 4 20"/><path d="M4 4l3 .5.5 3"/><path d="M20 4l-3 .5-.5 3"/><path d="M4 20l3-.5.5-3"/><path d="M20 20l-3-.5-.5-3"/>',
  skull: '<path d="M12 3a7 7 0 0 0-5 11.9V17h2v2h2v-2h2v2h2v-2h2v-2.1A7 7 0 0 0 12 3Z"/><circle cx="9.5" cy="11" r="1"/><circle cx="14.5" cy="11" r="1"/>',
  gem: '<path d="M4 9l4-6h8l4 6-8 11Z"/><path d="M4 9h16"/><path d="M9 3l1.5 6L12 20"/><path d="M15 3l-1.5 6L12 20"/>',
  gemCrown: '<path d="M4 18h16l-1.4-7-3.6 2.5-3-5-3 5-3.6-2.5Z"/><path d="M9 18l1 3h4l1-3"/>',
  stairs: '<path d="M3 20V17H7V14h4V11h4V8h4V5"/><path d="M3 20h18"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6Z"/>',
  hourglass: '<path d="M6 3h12"/><path d="M6 21h12"/><path d="M7 3c0 4 3 5.5 5 6.3C9 10 7 11.6 7 15.6"/><path d="M17 3c0 4-3 5.5-5 6.3 3 .7 5 2.3 5 6.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  stopwatch: '<circle cx="12" cy="13" r="8"/><path d="M9 2h6"/><path d="M12 2v3"/><path d="M12 9v4l3 2"/>',
  spellbook: '<path d="M4 5c3-1.5 6-1.5 8 0v14c-2-1.5-5-1.5-8 0Z"/><path d="M20 5c-3-1.5-6-1.5-8 0v14c2-1.5 5-1.5 8 0Z"/><path d="M12 9l1.3 2.6L16 12l-2.7.4L12 15l-1.3-2.6L8 12l2.7-.4Z"/>',
  crystals: '<path d="M8 3 5 9l3 7 3-7Z"/><path d="M16 7l-2.5 4.5L16 16l2.5-4.5Z"/>',
  relicUrn: '<path d="M9 3h6"/><path d="M10 3v3c0 1.3-2 2-2 5.5S9 18 12 18s4-2.7 4-6.5S14 7.3 14 6V3"/><path d="M8 18h8l-1 3H9Z"/>',
  moneyBag: '<path d="M9 3h6l-1.5 3h-3Z"/><path d="M10.5 6C6 9 4 12 4 15.5 4 19 7.5 21 12 21s8-2 8-5.5C20 12 18 9 13.5 6"/><path d="M12 10v10"/><path d="M14.3 12.8c0-1-1-1.6-2.3-1.6s-2.3.6-2.3 1.7 1 1.4 2.3 1.8 2.3.7 2.3 1.8-1 1.7-2.3 1.7-2.3-.6-2.3-1.7"/>',
  pulse: '<path d="M2 12h4l2-6 4 12 2-6h8"/>',
  echo: '<circle cx="12" cy="12" r="2.2"/><path d="M8.5 12a3.5 3.5 0 0 1 7 0"/><path d="M5.8 12a6.2 6.2 0 0 1 12.4 0"/><path d="M3 12a9 9 0 0 1 18 0"/>',
  treasureMap: '<path d="M4 5l5-2 6 2 5-2v16l-5 2-6-2-5 2Z"/><path d="M9 3v16"/><path d="M15 5v16"/><path d="M12 9l1.6 1.6M13.6 9 12 10.6"/>',
  fourFigures: '<circle cx="3.75" cy="8" r="1.8"/><circle cx="9.25" cy="8" r="1.8"/><circle cx="14.75" cy="8" r="1.8"/><circle cx="20.25" cy="8" r="1.8"/><path d="M1.0 19c0-2.8 1.2-4.8 2.75-4.8s2.75 2 2.75 4.8"/><path d="M6.5 19c0-2.8 1.2-4.8 2.75-4.8s2.75 2 2.75 4.8"/><path d="M12.0 19c0-2.8 1.2-4.8 2.75-4.8s2.75 2 2.75 4.8"/><path d="M17.5 19c0-2.8 1.2-4.8 2.75-4.8s2.75 2 2.75 4.8"/>',
  fist: '<path d="M7 11V8a2 2 0 1 1 4 0v3"/><path d="M11 10.5V7.5a2 2 0 1 1 4 0v3.5"/><path d="M15 11V8.5a1.8 1.8 0 1 1 3.6 0V14c0 3.5-2.3 6-6.1 6-3.3 0-5-1.3-6.5-3.3L4 13.5c-.6-.8-.3-1.8.6-2.1.7-.3 1.4 0 1.8.6L7 13"/>',
  fortress: '<path d="M5 21V10h3V8h2v2h4V8h2v2h3v11Z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/><path d="M12 8V2.5"/><path d="M12 2.5l4 1.5-4 1.5"/>',
  rank: '<path d="M5 9l7-5 7 5"/><path d="M5 14l7-5 7 5"/><path d="M5 19l7-5 7 5"/>',
  grid4: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M5.8 7l1.2 1.2L9 5.8"/>',
  sunburst: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  gate: '<path d="M5 21V10a7 7 0 0 1 14 0v11"/><path d="M9 21v-8a3 3 0 0 1 6 0v8"/><path d="M3 21h18"/>',
  heartShield: '<path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6l-8-3Z"/><path d="M12 16.5s-3.5-2.2-3.5-4.6A1.9 1.9 0 0 1 12 10.8a1.9 1.9 0 0 1 3.5 1.1c0 2.4-3.5 4.6-3.5 4.6Z"/>',
  waves: '<path d="M2 8q2.5-3 5 0t5 0 5 0 5 0"/><path d="M2 13q2.5-3 5 0t5 0 5 0 5 0"/><path d="M2 18q2.5-3 5 0t5 0 5 0 5 0"/>',
  priceTag: '<path d="M3 12V4h8l10 10-8 8Z"/><circle cx="7.5" cy="8.5" r="1.3"/><path d="M12 16l3-3"/>',
  mageHat: '<path d="M12 2 7 16h10Z"/><ellipse cx="12" cy="18" rx="9" ry="2.5"/><path d="M12 7.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3Z"/>',
  twoFigures: '<circle cx="8" cy="7" r="2.5"/><circle cx="16" cy="7" r="2.5"/><path d="M3.5 20c0-3.6 2-6 4.5-6s4.5 2.4 4.5 6"/><path d="M11.5 20c0-3.6 2-6 4.5-6s4.5 2.4 4.5 6"/>',
  threeFigures: '<circle cx="7" cy="8" r="2.3"/><circle cx="17" cy="8" r="2.3"/><circle cx="12" cy="7" r="2.6"/><path d="M3.5 19c0-3 2-5 4.3-5"/><path d="M20.5 19c0-3-2-5-4.3-5"/><path d="M7.5 19c0-3.3 2-5.5 4.5-5.5s4.5 2.2 4.5 5.5"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 5H4v2a3 3 0 0 0 3 3"/><path d="M17 5h3v2a3 3 0 0 1-3 3"/><path d="M10 18h4"/><path d="M12 14v4"/><path d="M8 21h8"/>'
};

// ---------- Hilfsfunktionen (Stats-Zugriff) ----------

const ACH_MIN_TIMED_MS = 60 * 1000; // Kämpfe unter 1 Min. gelten als "nicht gemessen" (Timer nie gelaufen)
const ACH_MIN = 60 * 1000;

function achStats() { return app.stats; }

function achEverActiveCardIds() {
  const e = achStats().everActive;
  return [...e.zauber, ...e.kristall, ...e.relic];
}

function achCountKeyword(kw) {
  return achEverActiveCardIds().filter((id) => {
    const c = marketplaceCardById(id);
    return c && (c.keywords || []).includes(kw);
  }).length;
}

function achNemesisWave(nemesisId) {
  const n = nemesisByIdPlan(nemesisId);
  const exp = n && AEONS_DATA.expansions[n.expansion];
  return exp ? exp.wave : null;
}

function achDefeatedCount(filterFn) {
  return achStats().nemesesDefeated.filter((id) => {
    const n = nemesisByIdPlan(id);
    return n && (!filterFn || filterFn(n));
  }).length;
}

function achTreasureTotal(level) {
  return AEONS_DATA.treasures.filter((t) => !t.disabled && (!level || t.level === level)).length;
}

function achTreasureEverCount(level) {
  return achStats().everActive.schatz.filter((id) => {
    const t = treasureByIdPlan(id);
    return t && (!level || t.level === level);
  }).length;
}

function achMarketTotalTarget(subtype) { return AEONS_DATA.marketplaceCards.filter((c) => !c.disabled && c.subtype === subtype).length; }

function achTierCount(party, tier) {
  return (party || []).filter((id) => getMageTier(id) === tier).length;
}

// Gesamtspielzeit der Expedition (Summe der Kampfzeiten); null, falls ein Kampf ohne Messung ist.
function achTotalMs(runtime, requireAllFourTimed) {
  const times = runtime.fightTimes || [];
  let sum = 0;
  let timed = 0;
  times.forEach((e) => {
    const d = fightDurationMs(e);
    if (d != null && d >= ACH_MIN_TIMED_MS) { sum += d; timed++; }
  });
  if (requireAllFourTimed && timed < 4) return null;
  return sum;
}

// ---------- Definition der 40 Achievements ----------
// progress(): { cur, target } für zählbare Achievements (zustandsbasiert, bei jedem evaluate geprüft).
// event(ctx): true, wenn das Ereignis die Bedingung erfüllt (nur bei ctx.event === on geprüft).

const ACHIEVEMENTS = [
  { id: 1, icon: 'fortress', name: 'Frieden für die Feste', desc: 'Erste Expedition erfolgreich abgeschlossen',
    on: 'expeditionEnd', event: (c) => c.won },
  { id: 2, icon: 'sword', name: 'Die erste Schlacht', desc: 'Ersten Erzfeind besiegt',
    progress: () => ({ cur: Math.min(1, achDefeatedCount()), target: 1 }), binary: true },
  { id: 3, icon: 'shieldCheck', name: 'Sauber gelöst', desc: 'Expedition ohne eine einzige Niederlage gewonnen',
    on: 'expeditionEnd', event: (c) => c.won && c.flawless },
  { id: 4, icon: 'phoenix', name: 'Comeback', desc: 'Erzfeind nach mindestens 3 gescheiterten Versuchen besiegt',
    on: 'fightWon', event: (c) => c.failedTries >= 3 },
  { id: 5, icon: 'chainBreak', name: 'Hartnäckig', desc: 'Nach einer finalen Niederlage direkt eine neue Expedition gestartet und gewonnen',
    on: 'expeditionEnd', event: (c) => c.won && !!c.runtime.followsDefeat },
  { id: 6, icon: 'rank', name: 'Veteran', desc: 'Insgesamt 50 abgeschlossene Expeditionen (Sieg oder Niederlage)',
    progress: () => ({ cur: achStats().counters.expeditionsCompleted, target: 50 }) },
  { id: 7, icon: 'flame', name: 'Serientäter', desc: '2 Expeditionen in Folge siegreich abgeschlossen',
    progress: () => ({ cur: achStats().counters.winStreak, target: 2 }),
    sticky: true },
  { id: 8, icon: 'grid4', name: 'Vollständige Besetzung', desc: 'Alle 41 Magier mindestens einmal in einer Party gespielt',
    progress: () => ({ cur: AEONS_DATA.mages.filter((m) => (achStats().magePicks[m.id] || 0) > 0).length, target: AEONS_DATA.mages.length }) },
  { id: 9, icon: 'anchor', name: 'Stammspieler', desc: 'Denselben Magier in 10 Expeditionen gespielt',
    progress: () => ({ cur: Math.max(0, ...Object.values(achStats().magePicks)), target: 10 }) },
  { id: 10, icon: 'star', name: 'S-Tier-Elite', desc: 'Expedition mit mind. 2 Magiern der Tier-Stufe "S" gewonnen',
    on: 'expeditionEnd', event: (c) => c.won && achTierCount(c.runtime.chosenParty, 'S') >= 2 },
  { id: 11, icon: 'slingshot', name: 'Underdog', desc: 'Expedition mit mind. 2 Magiern der Tier-Stufe "D" gewonnen',
    on: 'expeditionEnd', event: (c) => c.won && achTierCount(c.runtime.chosenParty, 'D') >= 2 },
  { id: 12, icon: 'puzzlePiece', name: 'Gemischtes Team', desc: 'Expedition mit vier Magiern aus vier unterschiedlichen Tier-Stufen gewonnen',
    on: 'expeditionEnd', event: (c) => c.won && c.runtime.chosenParty.length === 4 &&
      new Set(c.runtime.chosenParty.map(getMageTier)).size === 4 },
  { id: 13, icon: 'crown', name: 'Nemesis-Bezwinger', desc: 'Jeden Erzfeind mindestens einmal besiegt',
    progress: () => ({ cur: achDefeatedCount(), target: AEONS_DATA.nemeses.length }) },
  { id: 14, icon: 'crossedSwords', name: 'Großmeister', desc: '3 Expeditionen nacheinander gewonnen ohne Niederlage',
    progress: () => ({ cur: achStats().counters.flawlessStreak, target: 3 }), sticky: true },
  { id: 15, icon: 'sunburst', name: 'Absolute Erlösung', desc: 'Erzfeind Xaxos ohne Fehlversuch besiegt',
    on: 'fightWon', event: (c) => c.nemesisId === 'XaxosAscended' && c.failedTries === 0 },
  { id: 16, icon: 'gate', name: 'Einstieg gemeistert', desc: 'Erzfeind Bladius ohne Fehlversuch besiegt',
    on: 'fightWon', event: (c) => c.nemesisId === 'Bladius' && c.failedTries === 0 },
  { id: 17, icon: 'treasureMap', name: 'Schatzsucher', desc: 'Alle 68 Schätze mindestens einmal aktiv im Marktplatz (via Kaserne-Auswahl) gehabt',
    progress: () => ({ cur: achTreasureEverCount(), target: achTreasureTotal() }) },
  { id: 18, icon: 'skull', name: 'Härtetest', desc: 'Alle Erzfeinde mit Schwierigkeit ≥ 6 besiegt',
    progress: () => ({ cur: achDefeatedCount((n) => n.difficulty >= 6), target: AEONS_DATA.nemeses.filter((n) => n.difficulty >= 6).length }) },
  { id: 19, icon: 'gem', name: 'Perfektionist', desc: '5 Expeditionen nacheinander gewonnen ohne Niederlage',
    progress: () => ({ cur: achStats().counters.flawlessStreak, target: 5 }), sticky: true },
  { id: 20, icon: 'heartShield', name: 'Unzerstörbar', desc: 'Sieg mit vollen Lebenspunkten der Feste der Letzten Ruhe',
    on: 'fightWon', event: (c) => c.festeFull },
  { id: 21, icon: 'gemCrown', name: 'Kronjuwel', desc: 'Alle 25 Schätze der Stufe 3 mindestens einmal aktiv im Marktplatz (via Kaserne-Auswahl) gehabt',
    progress: () => ({ cur: achTreasureEverCount(3), target: achTreasureTotal(3) }) },
  { id: 22, icon: 'stairs', name: 'Alle Schwierigkeitsgrade', desc: 'Mindestens einen Erzfeind aus jeder Schwierigkeitsstufe (1–9) besiegt',
    progress: () => {
      const set = new Set();
      achStats().nemesesDefeated.forEach((id) => { const n = nemesisByIdPlan(id); if (n) set.add(n.difficulty); });
      return { cur: [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => set.has(d)).length, target: 9 };
    } },
  { id: 23, icon: 'bolt', name: 'Blitzsieg', desc: 'Erzfeind in unter 30 Minuten besiegt',
    on: 'fightWon', event: (c) => c.durationMs != null && c.durationMs >= ACH_MIN_TIMED_MS && c.durationMs < 30 * ACH_MIN },
  { id: 24, icon: 'hourglass', name: 'Ausdauer', desc: 'Einzelner Kampf dauert länger als 75 Minuten und wird gewonnen',
    on: 'fightWon', event: (c) => c.durationMs != null && c.durationMs > 75 * ACH_MIN },
  { id: 25, icon: 'clock', name: 'Marathon', desc: 'Gesamtspielzeit einer Expedition über 3 Stunden',
    on: 'expeditionEnd', event: (c) => { const t = achTotalMs(c.runtime, false); return t != null && t > 180 * ACH_MIN; } },
  { id: 26, icon: 'stopwatch', name: 'Speedrun', desc: 'Komplette Expedition (4 Erzfeinde) in unter 120 Minuten Gesamtspielzeit gewonnen',
    on: 'expeditionEnd', event: (c) => { if (!c.won) return false; const t = achTotalMs(c.runtime, true); return t != null && t < 120 * ACH_MIN; } },
  { id: 27, icon: 'spellbook', name: 'Erzmagier', desc: '60 verschiedene Zauber mindestens einmal aktiv im Marktplatz (via Kaserne-Auswahl) gehabt',
    progress: () => ({ cur: achStats().everActive.zauber.length, target: 60 }) },
  { id: 28, icon: 'crystals', name: 'Kristalljäger', desc: '25 verschiedene Kristalle mindestens einmal aktiv im Marktplatz (via Kaserne-Auswahl) gehabt',
    progress: () => ({ cur: achStats().everActive.kristall.length, target: 25 }) },
  { id: 29, icon: 'relicUrn', name: 'Tüftler', desc: '25 verschiedene Artefakte (Relic) mindestens einmal aktiv im Marktplatz (via Kaserne-Auswahl) gehabt',
    progress: () => ({ cur: achStats().everActive.relic.length, target: 25 }) },
  { id: 30, icon: 'waves', name: 'Wellenreiter', desc: 'Expedition mit einem Erzfeind aus jeder Welle (1-4) gewonnen',
    on: 'expeditionEnd', event: (c) => {
      if (!c.won) return false;
      const waves = new Set(c.plan.nemesisOrder.map(achNemesisWave));
      return [1, 2, 3, 4].every((w) => waves.has(w));
    } },
  { id: 31, icon: 'priceTag', name: 'Schnäppchenjäger', desc: 'Expedition gewonnen, bei der der aktive Marktplatz zum Siegzeitpunkt nur Karten mit Kostenstufe ≤ 4 enthielt',
    on: 'expeditionEnd', event: (c) => {
      if (!c.won) return false;
      const cards = c.runtime.currentMarketplace.map(marketplaceCardById).filter(Boolean);
      return cards.length > 0 && cards.every((card) => card.cost <= 4);
    } },
  { id: 32, icon: 'moneyBag', name: 'Großinvestor', desc: 'Karte SphereOfInversion (Kostenstufe 9) mindestens einmal aktiv im Marktplatz (via Kaserne-Auswahl) gehabt',
    progress: () => ({ cur: achEverActiveCardIds().includes('SphereOfInversion') ? 1 : 0, target: 1 }), binary: true },
  { id: 33, icon: 'pulse', name: 'Impuls-Spezialist', desc: '5 verschiedene Karten mit Keyword IMPULS (pulse) mindestens einmal aktiv im Marktplatz (via Kaserne-Auswahl) gehabt',
    progress: () => ({ cur: achCountKeyword('pulse'), target: 5 }) },
  { id: 34, icon: 'echo', name: 'Echo-Meister', desc: '5 verschiedene Karten mit Keyword ECHO mindestens einmal aktiv im Marktplatz (via Kaserne-Auswahl) gehabt',
    progress: () => ({ cur: achCountKeyword('echo'), target: 5 }) },
  { id: 35, icon: 'mageHat', name: 'Magier des Monats', desc: 'Ein Magier wurde 20 Mal gewählt',
    progress: () => ({ cur: Math.max(0, ...Object.values(achStats().magePicks)), target: 20 }) },
  { id: 36, icon: 'threeFigures', name: 'Trio', desc: 'Expedition mit Spieleranzahl 3 gewonnen',
    on: 'expeditionEnd', event: (c) => c.won && c.plan.playerCount === 3 },
  { id: 37, icon: 'twoFigures', name: 'Duett', desc: 'Expedition mit Spieleranzahl 2 gewonnen',
    on: 'expeditionEnd', event: (c) => c.won && c.plan.playerCount === 2 },
  { id: 38, icon: 'fourFigures', name: 'Quartett', desc: 'Expedition mit Spieleranzahl 4 gewonnen (auch Variante "leicht")',
    on: 'expeditionEnd', event: (c) => c.won && c.plan.playerCount === 4 },
  { id: 39, icon: 'fist', name: 'Ohne Erleichterung', desc: 'Expedition mit Schwierigkeitsgrad "normal" gewonnen',
    on: 'expeditionEnd', event: (c) => c.won && c.plan.difficulty !== 'leicht' },
  { id: 40, icon: 'trophy', name: 'Meister der Riss-Magie', desc: 'Alle Meilensteine abgeschlossen',
    meta: true,
    progress: () => ({ cur: ACHIEVEMENTS.filter((a) => !a.meta && achIsUnlocked(a.id)).length, target: 39 }) }
];

// ---------- Zustand ----------

function achIsUnlocked(id) {
  return !!(app.stats.achievements && app.stats.achievements[id]);
}

// Fortschritt für die Anzeige: { cur, target } oder null (rein ereignisbasiert / binär).
function achProgress(a) {
  if (!a.progress) return null;
  try { return a.progress(); } catch (e) { return null; }
}

// ---------- Lifetime-Tracking (Trackingpunkt = Kaserne-Commit) ----------

// Trägt die aktuell AKTIVEN Marktplatzkarten/Schätze in die Lifetime-Sets ein. Aufgerufen aus
// syncBarracksIfValid() (jeder gültige Kaserne-Commit), beim Anlegen der Expedition (Start-
// Marktplatz) sowie vor jeder Auswertung als Absicherung (z. B. neue Schätze nach einem Sieg).
function trackEverActive() {
  if (!app.runtime || !app.stats) return;
  const e = app.stats.everActive;
  const bucketFor = { Zauber: 'zauber', Kristall: 'kristall', Relic: 'relic' };
  let changed = false;
  (app.runtime.currentMarketplace || []).forEach((id) => {
    const c = marketplaceCardById(id);
    const b = c && bucketFor[c.subtype];
    if (b && !e[b].includes(id)) { e[b].push(id); changed = true; }
  });
  (app.runtime.currentTreasures || []).forEach((id) => {
    if (treasureByIdPlan(id) && !e.schatz.includes(id)) { e.schatz.push(id); changed = true; }
  });
  return changed;
}

// Zählt jeden Magier einmal pro Expedition (runtime.playedMageIds), sobald er in der aktiven
// Party steht (confirmBuildParty() und Kaserne-Commit).
function trackPlayedMages() {
  if (!app.runtime || !app.stats) return;
  if (!app.runtime.playedMageIds) app.runtime.playedMageIds = [];
  (app.runtime.chosenParty || []).forEach((id) => {
    if (!app.runtime.playedMageIds.includes(id)) {
      app.runtime.playedMageIds.push(id);
      app.stats.magePicks[id] = (app.stats.magePicks[id] || 0) + 1;
    }
  });
}

// Wird einmal pro abgeschlossener Expedition aufgerufen (Sieg ODER finale Niederlage).
// Gibt { flawless } zurück.
function recordExpeditionEnd(won) {
  const c = app.stats.counters;
  const flawless = won && (app.runtime.triesPerFight || []).every((t) => !t);
  c.expeditionsCompleted++;
  if (won) {
    c.expeditionsWon++;
    c.winStreak++;
    c.flawlessStreak = flawless ? c.flawlessStreak + 1 : 0;
  } else {
    c.winStreak = 0;
    c.flawlessStreak = 0;
  }
  c.lastResult = won ? 'won' : 'lost';
  return { flawless };
}

function recordNemesisDefeated(nemesisId) {
  if (nemesisId && !app.stats.nemesesDefeated.includes(nemesisId)) app.stats.nemesesDefeated.push(nemesisId);
}

// ---------- Engine ----------

// Merkt sich in der laufenden Expedition (runtime.expeditionAchievements, wird mit dem Slot
// gespeichert), welche Meilensteine genau in DIESER Expedition freigeschaltet wurden — Grundlage
// für die Anzeige auf Completion- und Game-Over-Screen. Persistiert wird über saveActiveSlot()
// (in onExpeditionEndAchievements() in app.js nach der Auswertung erneut aufgerufen).
function achRecordForExpedition(list) {
  if (!list.length || !app.runtime) return;
  if (!app.runtime.expeditionAchievements) app.runtime.expeditionAchievements = [];
  list.forEach((a) => {
    if (!app.runtime.expeditionAchievements.includes(a.id)) app.runtime.expeditionAchievements.push(a.id);
  });
}

// ctx: { event: 'state'|'fightWon'|'expeditionEnd', runtime, plan, ... } — siehe Aufrufer in app.js.
// Gibt die Liste neu freigeschalteter Achievements zurück (für Toast).
function evaluateAchievements(ctx) {
  if (!app.stats) return [];
  ctx = Object.assign({ event: 'state', runtime: app.runtime, plan: app.plan }, ctx || {});
  const changedTracking = trackEverActive();
  const unlocked = [];
  const now = Date.now();

  ACHIEVEMENTS.filter((a) => !a.meta).forEach((a) => {
    if (achIsUnlocked(a.id)) return;
    let done = false;
    if (a.progress) {
      const p = achProgress(a);
      done = !!p && p.target > 0 && p.cur >= p.target;
    }
    if (!done && a.event && ctx.event === a.on) {
      try { done = !!a.event(ctx); } catch (e) { done = false; }
    }
    if (done) {
      app.stats.achievements[a.id] = { unlockedAt: now };
      unlocked.push(a);
    }
  });
  achRecordForExpedition(unlocked);

  // Meta-Achievement zuletzt: alle ANDEREN 39 (schließt sich selbst aus der eigenen Bedingung aus).
  const meta = ACHIEVEMENTS.find((a) => a.meta);
  if (meta && !achIsUnlocked(meta.id)) {
    const allDone = ACHIEVEMENTS.filter((a) => !a.meta).every((a) => achIsUnlocked(a.id));
    if (allDone) {
      app.stats.achievements[meta.id] = { unlockedAt: now };
      unlocked.push(meta);
      achRecordForExpedition([meta]);
    }
  }

  if (unlocked.length || changedTracking || ctx.event !== 'state') saveStats();
  if (unlocked.length && typeof showToast === 'function') {
    showToast(`Errungenschaft freigeschaltet: ${unlocked.map((a) => a.name).join(', ')}`);
  }
  return unlocked;
}

// ---------- Rendering ----------

function achBadgeHtml(a) {
  const unlocked = achIsUnlocked(a.id);
  const p = achProgress(a);
  let fillPct, label;
  if (unlocked) {
    fillPct = 100;
    label = (p && !a.binary && p.target > 1) ? `${p.target} / ${p.target}` : 'Erfüllt';
  } else if (p && !a.binary) {
    const cur = Math.min(p.cur, p.target);
    fillPct = p.target ? Math.round((cur / p.target) * 100) : 0;
    label = `${cur} / ${p.target}`;
  } else {
    fillPct = 0;
    label = 'Noch nicht erfüllt';
  }
  const svg = `<svg viewBox="0 0 24 24" aria-hidden="true">${ACHIEVEMENT_ICONS[a.icon] || ''}</svg>`;
  return `
    <div class="badge-card ${unlocked ? 'is-complete' : 'is-locked'}">
      <div class="badge-card__icon-wrap">${svg}</div>
      <div class="badge-card__title">${escapeHtml(a.name)}</div>
      <div class="badge-card__condition">${escapeHtml(a.desc)}</div>
      <div class="badge-fillbar">
        <div class="badge-fillbar__track"><div class="badge-fillbar__fill" style="width:${fillPct}%"></div></div>
        <div class="badge-fillbar__label">${label}</div>
      </div>
    </div>`;
}

// Completion-/Game-Over-Screen: zeigt die in dieser Expedition erfüllten Meilensteine, golden
// leuchtend (einmalige Animation). Panel bleibt versteckt, wenn nichts freigeschaltet wurde.
function renderExpeditionAchievements(panelId, gridId) {
  const panel = document.getElementById(panelId);
  const grid = document.getElementById(gridId);
  if (!panel || !grid) return;
  const ids = (app.runtime && app.runtime.expeditionAchievements) || [];
  const list = ACHIEVEMENTS.filter((a) => ids.includes(a.id));
  panel.hidden = list.length === 0;
  grid.innerHTML = list.map((a) => achBadgeHtml(a).replace('badge-card is-complete', 'badge-card is-complete is-new')).join('');
}

function renderAchievements() {
  const grid = document.getElementById('achievementsGrid');
  const summary = document.getElementById('achievementsSummary');
  if (!grid) return;
  const total = ACHIEVEMENTS.length;
  const done = ACHIEVEMENTS.filter((a) => achIsUnlocked(a.id)).length;
  if (summary) summary.textContent = `${done} / ${total} freigeschaltet`;
  grid.innerHTML = ACHIEVEMENTS.map(achBadgeHtml).join('');
}
