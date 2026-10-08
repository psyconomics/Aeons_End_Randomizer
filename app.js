/* Chronik der Feste V2 — app.js
 * Rahmenwerk: Seed/Plan/Marktplatz/Kämpfe. Die eigentliche Story-Generierung
 * bleibt exakt der Copy-&-Paste-Mechanismus aus V1 (Prompt bauen -> in ein
 * Claude-Fenster einfügen -> Antwort zurückkopieren), nur der Prompt-Kontext
 * ist um den vollständigen ExpeditionPlan erweitert.
 */

const SLOTS_KEY = 'chronikDerFeste_v2_slots';
const OPTIONS_KEY = 'chronikDerFeste_v2_options';
const STATS_KEY = 'chronikDerFeste_v2_stats';
const MAX_SLOTS = 3;

const el = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Gemeinsamer Pointer-Events-Drag-Helfer, von renderMageTiers() (Options) und
// bindDeckOverlayInteractions() (Tablet-Kampf-Screen) genutzt — Refactoring 2026-10-06, siehe
// [[aeons_end_tablet_kampf_optimierung]] Punkt 2. Grund für Pointer Events statt natives HTML5
// Drag&Drop: Safari auf dem iPad liefert bei Touch-Interaktion mit draggable-Elementen kein
// zuverlässiges dragstart-Event (fehlender Polyfill) — Pointer Events (pointerdown/-move/-up)
// funktionieren dagegen einheitlich für Maus UND Touch.
//
// Übernimmt das immer gleiche Boilerplate (nur primärer Zeiger, Pointer-Capture, kurzzeitiges
// position:fixed + Maße/Offset während des Drags, Cleanup danach) und ruft bei Bedarf zwei
// Callbacks auf: onMove(e) während des Ziehens (z.B. für Dragover-Highlights) und onEnd(e) beim
// Loslassen (z.B. um die Zielposition zu bestimmen und die eigentliche Aktion auszuführen). Gibt
// false zurück, wenn der Drag gar nicht gestartet wurde (z.B. Rechtsklick), sonst true.
function beginPointerDrag(itemEl, e, { onMove, onEnd } = {}) {
  if (e.button !== undefined && e.button !== 0) return false;
  e.preventDefault();
  const rect = itemEl.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  const offsetY = e.clientY - rect.top;

  itemEl.classList.add('is-dragging');
  itemEl.setPointerCapture(e.pointerId);
  itemEl.style.position = 'fixed';
  itemEl.style.zIndex = 1000;
  itemEl.style.width = `${rect.width}px`;
  itemEl.style.left = `${rect.left}px`;
  itemEl.style.top = `${rect.top}px`;
  itemEl.style.pointerEvents = 'none';

  function handleMove(ev) {
    itemEl.style.left = `${ev.clientX - offsetX}px`;
    itemEl.style.top = `${ev.clientY - offsetY}px`;
    if (onMove) onMove(ev);
  }

  function handleEnd(ev) {
    itemEl.releasePointerCapture(ev.pointerId);
    document.removeEventListener('pointermove', handleMove);
    document.removeEventListener('pointerup', handleEnd);
    document.removeEventListener('pointercancel', handleEnd);
    // WICHTIG: onEnd() läuft, WÄHREND das Element noch position:fixed hat (also aus dem Fluss
    // genommen ist) — bindDeckOverlayInteractions() misst darin die Positionen der Geschwister-
    // Elemente, die sich verschieben würden, sobald die Karte zurück in den normalen Fluss
    // gesetzt wird. Erst danach die Styles zurücksetzen (Bugfix 2026-10-06, siehe
    // [[aeons_end_tablet_kampf_optimierung]] Punkt 2).
    if (onEnd) onEnd(ev);
    itemEl.classList.remove('is-dragging');
    itemEl.style.position = '';
    itemEl.style.zIndex = '';
    itemEl.style.width = '';
    itemEl.style.left = '';
    itemEl.style.top = '';
    itemEl.style.pointerEvents = '';
  }

  document.addEventListener('pointermove', handleMove);
  document.addEventListener('pointerup', handleEnd);
  document.addEventListener('pointercancel', handleEnd);
  return true;
}

// ---------- Aufbau-Fortschrittsanzeige ----------
// Reihenfolge & Labels der 4 Aufbau-Schritte, per Nutzer-Vorgabe. Die `key`-Werte entsprechen
// exakt den goto()-Schrittnamen, damit renderBuildProgress() den aktuellen Fortschritt direkt aus
// dem Schrittnamen ableiten kann, ohne einen eigenen Zähler pflegen zu müssen.
const BUILD_STEPS = [
  { key: 'build-party', label: 'Charakterauswahl' },
  { key: 'build-market', label: 'Marktplatz' },
  { key: 'build-nemesis', label: 'Nemesis-Vorbereitung' },
  { key: 'generate', label: 'Erzählung generieren' },
];

// Rendert die Fortschrittsanzeige in das .build-progress-Element des aktuell sichtbaren Screens.
// Wird von den 4 Aufbau-render...()-Funktionen aufgerufen, jeweils NACH show(), sodass zu diesem
// Zeitpunkt genau ein .screen nicht [hidden] ist (siehe goto()-Dispatcher).
function renderBuildProgress(currentKey) {
  const host = document.querySelector('.screen:not([hidden]) .build-progress');
  if (!host) return;
  const currentIndex = BUILD_STEPS.findIndex((s) => s.key === currentKey);
  host.innerHTML = BUILD_STEPS.map((s, i) => {
    const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'upcoming';
    const circleContent = state === 'done' ? '✓' : String(i + 1);
    const connector = i < BUILD_STEPS.length - 1
      ? `<span class="build-progress__line${i < currentIndex ? ' is-done' : ''}"></span>`
      : '';
    return `
      <div class="build-progress__step build-progress__step--${state}">
        <span class="build-progress__circle">${circleContent}</span>
        <span class="build-progress__label">${escapeHtml(s.label)}</span>
      </div>${connector}`;
  }).join('');
}

// ---------- App-Zustand (nicht persistiert 1:1 — siehe Slots) ----------

let app = {
  step: 'home',
  options: loadOptions(),
  stats: null, // wird unten gesetzt (loadStats() muss nach dessen Definition aufgerufen werden)
  plan: null,
  runtime: null
};
app.stats = loadStats();

function freshOptions() {
  return {
    selectedExpansions: Object.keys(AEONS_DATA.expansions),
    // Standardmäßig sind alle vordefinierten (nicht-versteckten) Marktplatz-Setups aktiv —
    // identisch zum Original-Randomizer, wo jedes Setup initial mit active:true angelegt wird.
    activeMarketSetupIds: (AEONS_DATA.marketSetups || []).filter((s) => !s.hidden).map((s) => s.id),
    // Magier-Tier-Liste: nur benutzerdefinierte Abweichungen von AEONS_DATA.mages[].tier
    // (siehe getMageTier()). Rein informelles Rating für die Charakterauswahl — es hängt
    // bewusst keine Spiellogik daran.
    mageTiers: {},
    // Erweiterte Regeln für den Reihenfolge-Randomizer (Kampf-Detail) — global persistiert,
    // da es Nutzerpräferenzen sind, die für alle Kämpfe/Expeditionen gleich gelten sollen.
    turnOrderRules: { noTriple: true, noFirstTurn: true },
    // Steuert, welcher der beiden Kampf-Detail-Screens angezeigt wird (siehe #screen-options >
    // "Kampf-Detail-Screen — Darstellung"): false = klassische Ansicht (Standard), true = neuer
    // Tablet-optimierter Screen. Beide Screens teilen sich denselben app.runtime.turnOrder-Zustand,
    // nur die Darstellung unterscheidet sich — siehe renderTurnOrder().
    tabletMode: false,
    // Expeditionsregel (siehe #screen-options > "Expeditionsregeln"): ist diese Option aktiv,
    // führt die 3. Niederlage in Folge gegen denselben Erzfeind zum Game-Over-Screen statt zur
    // normalen Übersicht — siehe finalizeLoss(). Default AN (Nutzer-Vorgabe).
    finalDefeat: true
  };
}

function loadOptions() {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    if (raw) {
      const fresh = freshOptions();
      const parsed = JSON.parse(raw);
      const merged = Object.assign(fresh, parsed);
      merged.mageTiers = Object.assign({}, fresh.mageTiers, parsed.mageTiers);
      merged.turnOrderRules = Object.assign({}, fresh.turnOrderRules, parsed.turnOrderRules);
      return merged;
    }
  } catch (e) { /* ignore */ }
  return freshOptions();
}

// Aktuelles Tier eines Magiers: benutzerdefinierte Zuordnung (app.options.mageTiers) hat
// Vorrang vor dem Standard-Tier aus AEONS_DATA.mages[].tier.
function getMageTier(mageId) {
  const override = app.options.mageTiers[mageId];
  if (override) return override;
  const mage = mageByIdPlan(mageId);
  return (mage && mage.tier) || null;
}

function saveOptions() {
  localStorage.setItem(OPTIONS_KEY, JSON.stringify(app.options));
}

// ---------- Slots (FIFO, max 3) ----------

function loadSlots() {
  try {
    const raw = localStorage.getItem(SLOTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return [];
}

function saveSlots(slots) {
  localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
}

// ---------- Statistik-Store (Expeditions-Chronik) ----------
// Eigener, dauerhafter Store — unabhängig von den max. 3 Spielstand-Slots (siehe SLOTS_KEY).
// Grund: Slots werden regelmäßig gelöscht/überschrieben (deleteSlot(),
// startNewExpeditionFromCompletion()), die Statistik soll das überleben. Schreibpunkte für
// künftige Features: finalizeWin(), finishExpedition(), triggerFinalDefeat() — noch nicht verdrahtet,
// dies ist bewusst erstmal nur die leere Grundstruktur (siehe FEATURE_WISHLIST.md > Statistik-Seite).
//
// Geplante Unterstruktur (wird mit den einzelnen Features sukzessive befüllt, siehe Wishlist):
// - achievements: { [achievementId]: { unlockedAt, progress, target } }
// - highscoresByPlayerCount: { 2: [...], 3: [...], 4: [...] } (je Top 3 nach Gesamtspielzeit)
// - nemesisStats: { [nemesisId]: { wins, losses, totalWinDurationMs } } (Versuchsebene)
// - partyCombos: { [comboKey]: { wins, total } } (für Party-Synergie-Hinweise)
// - cardPicks / magePicks: { [id]: count } (für prozentuale Auswahl-Statistiken)
function freshStats() {
  return {
    achievements: {},
    // Errungenschaften (siehe achievements.js): Zähler/Lifetime-Sets, aus denen Fortschritt abgeleitet wird.
    counters: { expeditionsCompleted: 0, expeditionsWon: 0, winStreak: 0, flawlessStreak: 0, lastResult: null },
    nemesesDefeated: [],
    everActive: { zauber: [], kristall: [], relic: [], schatz: [] },
    highscoresByPlayerCount: { 2: [], 3: [], 4: [] },
    nemesisStats: {},
    partyCombos: {},
    cardPicks: {},
    magePicks: {}
  };
}

function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) {
      const fresh = freshStats();
      const parsed = JSON.parse(raw);
      const merged = Object.assign(fresh, parsed);
      merged.highscoresByPlayerCount = Object.assign({}, fresh.highscoresByPlayerCount, parsed.highscoresByPlayerCount);
      // Migration: ältere Stats ohne Errungenschaften-Felder bekommen die Defaults.
      merged.counters = Object.assign({}, fresh.counters, parsed.counters);
      merged.everActive = Object.assign({}, fresh.everActive, parsed.everActive);
      if (!Array.isArray(merged.nemesesDefeated)) merged.nemesesDefeated = [];
      return merged;
    }
  } catch (e) { /* ignore */ }
  return freshStats();
}

function saveStats() {
  localStorage.setItem(STATS_KEY, JSON.stringify(app.stats));
}

function resetStats() {
  app.stats = freshStats();
  saveStats();
  renderChronicle();
}

// Party-Synergie-Hinweise (siehe FEATURE_WISHLIST.md > "Party-Synergie-Hinweise beim Aufbau"):
// Schlüssel = Set der Magier-IDs (reihenfolgeunabhängig, daher sortiert) + Spieleranzahl, damit
// z. B. eine 3er- und eine 4er-Party mit teils gleichen Magiern getrennt gezählt werden.
function partyComboKey(mageIds, playerCount) {
  return `${playerCount}:${mageIds.slice().sort().join(',')}`;
}

// Wird bei jedem Expeditionsabschluss (Sieg ODER finale Niederlage) aufgerufen — "total" zählt
// immer, "wins" nur bei won === true. party = die zum Zeitpunkt des Abschlusses aktive Party
// (app.runtime.chosenParty), playerCount = app.plan.playerCount.
function recordPartyComboResult(mageIds, playerCount, won) {
  if (!mageIds || !mageIds.length || !playerCount) return;
  const key = partyComboKey(mageIds, playerCount);
  const entry = app.stats.partyCombos[key] || { wins: 0, total: 0 };
  entry.total += 1;
  if (won) entry.wins += 1;
  app.stats.partyCombos[key] = entry;
  saveStats();
}

// Highscores (Chronik): Top 3 je Spieleranzahl nach kürzester Gesamtspielzeit, nur gewonnene
// Expeditionen. Voraussetzung: alle 4 Kämpfe wurden gemessen (sonst keine vergleichbare Zeit).
// Die Variante "4 Spieler leicht" zählt als 4 Spieler (plan.playerCount). Pro Expedition (plan.id)
// höchstens ein Eintrag.
function recordHighscore() {
  const plan = app.plan;
  const totalMs = achTotalMs(app.runtime, true);
  if (!plan || totalMs == null) return;
  const key = plan.playerCount;
  if (![2, 3, 4].includes(key)) return;
  const list = app.stats.highscoresByPlayerCount[key] || [];
  if (list.some((e) => e.id === plan.id)) return;
  list.push({
    id: plan.id,
    seed: plan.seed,
    totalMs,
    nemeses: plan.nemesisOrder.slice(),
    party: app.runtime.chosenParty.slice(),
    at: Date.now()
  });
  list.sort((a, b) => a.totalMs - b.totalMs);
  app.stats.highscoresByPlayerCount[key] = list.slice(0, 3);
  saveStats();
}

function renderHighscores() {
  const box = el('highscoreList');
  if (!box) return;
  const medals = ['gold', 'silver', 'bronze'];
  box.innerHTML = [2, 3, 4].map((pc) => {
    const list = app.stats.highscoresByPlayerCount[pc] || [];
    const rows = [0, 1, 2].map((i) => {
      const e = list[i];
      const names = (ids, lookup) => ids.map((id) => { const o = lookup(id); return escapeHtml(o ? o.name : id); }).join(', ');
      return `
        <div class="hs__row${e ? '' : ' hs__row--empty'}">
          <div class="hs__medal hs__medal--${medals[i]}">${i + 1}</div>
          <div class="hs__time">${e ? formatDurationMs(e.totalMs) : '–'}</div>
          <div class="hs__details">
            <div class="hs__line"><span class="hs__lbl">Seed</span><span>${e ? escapeHtml(String(e.seed)) : '–'}</span></div>
            <div class="hs__line"><span class="hs__lbl">Erzfeinde</span><span>${e ? names(e.nemeses, nemesisByIdPlan) : '–'}</span></div>
            <div class="hs__line"><span class="hs__lbl">Gruppe</span><span>${e ? names(e.party, mageByIdPlan) : '–'}</span></div>
          </div>
        </div>`;
    }).join('');
    return `<div class="hs__group"><div class="hs__group-title">${pc} Spieler</div>${rows}</div>`;
  }).join('');
}

// Erzfeind-Ranking (Chronik): Bilanz je Erzfeind auf Versuchsebene. Jede Niederlage (auch nicht-
// finale) zählt als losses, jeder Kampfsieg als wins. Kampfdauer fließt nur bei Siegen ein und nur,
// wenn der Timer tatsächlich gelaufen ist (>= 1 Min.), siehe ACH_MIN_TIMED_MS.
function recordNemesisAttempt(nemesisId, won, durationMs) {
  if (!nemesisId) return;
  const e = app.stats.nemesisStats[nemesisId] || { wins: 0, losses: 0, totalWinDurationMs: 0, timedWins: 0 };
  if (won) {
    e.wins += 1;
    if (durationMs != null && durationMs >= ACH_MIN_TIMED_MS) { e.totalWinDurationMs += durationMs; e.timedWins += 1; }
  } else {
    e.losses += 1;
  }
  app.stats.nemesisStats[nemesisId] = e;
  saveStats();
}

// Bugfix: seed war früher der alleinige Slot-Schlüssel — zwei Expeditionen mit demselben
// (frei eingegebenen) Seed haben sich beim Speichern still gegenseitig überschrieben. Slots
// werden daher über die eigenständige plan.id identifiziert. Ältere Spielstände ohne id
// (vor diesem Fix) erhalten beim ersten Laden/Speichern über ensurePlanId() einmalig eine.
function ensurePlanId(plan) {
  if (!plan.id) plan.id = generateExpeditionId();
  return plan.id;
}

function saveActiveSlot() {
  if (!app.plan || !app.runtime) return;
  const id = ensurePlanId(app.plan);
  let slots = loadSlots();
  const entry = {
    savedAt: new Date().toISOString(),
    name: app.plan.name,
    seed: app.plan.seed,
    id,
    state: { plan: app.plan, runtime: app.runtime }
  };
  const existingIdx = slots.findIndex((s) => s.id === id);
  if (existingIdx >= 0) {
    slots[existingIdx] = entry;
  } else {
    // Volle Slots dürfen NICHT still verdrängt werden (siehe canCreateNewExpedition()) — die
    // Erstellung einer 4. Expedition wird bereits vorher per UI-Sperre verhindert. Dieser Schnitt
    // bleibt nur als Sicherheitsnetz für Altbestände/Inkonsistenzen bestehen.
    slots.push(entry);
    if (slots.length > MAX_SLOTS) slots = slots.slice(slots.length - MAX_SLOTS);
  }
  saveSlots(slots);
}

function loadSlotById(id) {
  const slots = loadSlots();
  const entry = slots.find((s) => s.id === id);
  if (!entry) return;
  app.plan = entry.state.plan;
  app.runtime = entry.state.runtime;
  ensurePlanId(app.plan);
  // Kompatibilität mit älteren Spielständen ohne dieses Feld (Punkt 39).
  if (!app.runtime.nemesisRevealedOnce) {
    app.runtime.nemesisRevealedOnce = app.runtime.nemesisStatus.map((s) => s !== 'locked');
  }
  // Kompatibilität mit älteren Spielständen ohne Feste-/Erzfeind-Zähler (vor dem Tablet-Merge,
  // Stand 2026-09-24) — Erzfeind-Wert wird beim nächsten renderBattle()/ensureTurnOrderFight()-
  // Aufruf ohnehin aus nem.health neu gesetzt, falls sich fightIndex ändert.
  if (!app.runtime.hp) {
    app.runtime.hp = { feste: 30, erzfeind: 0 };
  }
  // Kompatibilität mit älteren Spielständen ohne Spielzeit-Tracking (vor 2026-09-24, siehe
  // freshRuntimeState()) — Anzeige auf der Siegesseite zeigt für diese Kämpfe dann einfach "–".
  if (!app.runtime.fightTimes) {
    app.runtime.fightTimes = [null, null, null, null];
  }
  // Migration auf das Pause/Resume-fähige Zeit-Modell (accumulatedMs/runningSince statt reinem
  // start-Zeitstempel, siehe freshRuntimeState()) — Bugfix 2026-10-05: vorher lief die Zeit beim
  // Laden eines Spielstands als reine Date.now()-Differenz weiter, auch über Standby/Bildschirm-
  // sperre/App-Hintergrund hinweg. Bereits abgeschlossene Kämpfe (end gesetzt) behalten ihre alte
  // start/end-Dauer unverändert (siehe Fallback in fightDurationMs()). Ein zum Ladezeitpunkt noch
  // laufender Kampf (start gesetzt, aber kein end) sollte laut Spielweise des Nutzers gar nicht
  // vorkommen (ein begonnener Kampf wird in einer Sitzung durchgespielt) — als Absicherung wird er
  // dennoch auf 0 zurückgesetzt statt die vermutlich verzerrte Alt-Zeit zu übernehmen. In jedem
  // Fall ist runningSince nach dem Laden immer null — der Timer startet erst wieder aktiv über
  // resumeFightTimer(), wenn tatsächlich der Kampf-Screen betreten wird.
  (app.runtime.fightTimes || []).forEach((entry, i) => {
    if (!entry) return;
    if (entry.end) { entry.runningSince = null; return; }
    app.runtime.fightTimes[i] = { accumulatedMs: 0, runningSince: null, end: null };
  });
  // Migration: Feld hieß früher turnOrder.round, zählte aber tatsächlich Züge (umbenannt
  // 2026-10-05, siehe freshRuntimeState()/advanceTurnOrder()).
  if (app.runtime.turnOrder && app.runtime.turnOrder.round !== undefined && app.runtime.turnOrder.turnNumber === undefined) {
    app.runtime.turnOrder.turnNumber = app.runtime.turnOrder.round;
    delete app.runtime.turnOrder.round;
  }
  routeAfterLoad();
}

function deleteSlot(id) {
  const slots = loadSlots().filter((s) => s.id !== id);
  saveSlots(slots);
  renderHome();
}

// Bugfix: falls die Gruppe mitten in einem Sieg-/Niederlage-Ablauf (Beute/Ausgleich noch nicht
// bestätigt) die Startseite ansteuert und die Kampagne danach neu lädt, vorher landete das immer
// auf der Übersicht — der offene Screen ging verloren und der Kampf blieb als "revealed" stehen,
// obwohl bereits Belohnungen gezogen waren (Duplikat-Risiko bei erneutem Sieg). Jetzt wird der
// passende Zwischenscreen anhand der pending*-Felder wiederhergestellt.
function routeAfterLoad() {
  if (!app.runtime.chosenParty.length) { goto('build-party'); return; }
  if (!app.runtime.setupComplete) { goto('build-nemesis'); return; }

  // Finale Niederlage: der Game-Over-Screen ist ein Endzustand — beim erneuten Laden dieses
  // Spielstands (z.B. Startseite -> Laden) soll wieder direkt dort gelandet werden statt auf der
  // Übersicht, siehe finalizeLoss().
  if (app.runtime.gameOverNemesisId) { goto('game-over'); return; }

  if (app.runtime.pendingLossCategory) {
    if (app.runtime.pendingLossCard && isMarketCategory(app.runtime.pendingLossCategory) && app.runtime.pendingLossRevealed) {
      goto('loss-banish');
    } else {
      goto('loss-reward');
    }
    return;
  }
  if (app.runtime.pendingWinRewards) {
    // Zauber/Kristall/Artefakt zeigen ihr "NEU"-Label direkt auf win-banish, nur die Schätze haben
    // dort noch einen eigenen Aufdeck-Schritt (siehe renderWinBanish()/pendingWinRewardReveal).
    // Archiv-Hintergrund: archive/win-reward-screen.html
    goto('win-banish');
    return;
  }
  goto('overview');
  // Beim Laden eines Spielstands über die Startseite soll die Übersicht sich wie ein
  // "erstmaliges Erreichen" anfühlen — daher hier bewusst start_campaign.wav abspielen,
  // unabhängig vom introSoundPlayed-Flag (das nur den EINMALIGEN Sound bei der allerersten
  // Generierung steuert, siehe playIntroSoundOnce()).
  playSfx('start_campaign');
}

// ---------- Fresh RuntimeState ----------

function freshRuntimeState() {
  return {
    chosenParty: [],
    // Punkt 26: die ursprünglich zur Kampagnenerstellung gewählte Party (Snapshot nach
    // confirmBuildParty()) — bildet zusammen mit barracks.mageIds den gesamten Magier-Pool,
    // aus dem in der Kaserne frei die aktive Party (chosenParty) zusammengestellt wird.
    originalParty: [],
    barracks: { mageIds: [], marketplaceCardIds: [], treasureIds: [] },
    currentMarketplace: [],
    // Punkt 26: aktiv genutzte Schätze (analog zu currentMarketplace) — Teilmenge von
    // barracks.treasureIds, frei editierbar in der Kaserne, OHNE Zuordnung zu Magiern.
    currentTreasures: [],
    fightIndex: 0,
    nemesisStatus: ['revealed', 'locked', 'locked', 'locked'],
    // true, sobald der jeweilige Kampf mindestens einmal geöffnet (enthüllt) wurde — dann zeigt
    // die Übersichtskachel den Erzfeind-Namen statt "Bereit zum Enthüllen" (analog zu "defeated").
    nemesisRevealedOnce: [false, false, false, false],
    triesPerFight: [0, 0, 0, 0],
    score: 0,
    chapters: [],
    setupComplete: false,
    // true, sobald screen-overview zum allerersten Mal für diese Kampagne gezeigt wurde — steuert,
    // ob start_campaign.wav noch abgespielt werden soll (siehe skipStory()/submitGeneration()).
    // Bleibt danach dauerhaft true, damit der Sound bei jedem weiteren Laden/Navigieren zur
    // Übersicht NICHT erneut abspielt.
    introSoundPlayed: false,
    // Punkt 23: true, wenn die Gruppe bewusst auf "Weiter ohne Erzählung" geklickt hat —
    // dann bleiben alle Story-Elemente (Kapiteltexte, Epilog) dauerhaft ausgeblendet und nur
    // die Randomizer-Logik (Marktplatz, Nemesis-Reveal, Belohnungen) wird weiter genutzt.
    storyDisabled: false,
    showBarracks: false,
    // transiente Copy-Paste-Generierungsfelder: genChapterNumber ist bei der Einmal-Generierung
    // immer der String 'mega' (siehe startCampaign()); der Name bleibt aus Kompatibilitätsgründen.
    genLabel: '',
    genChapterNumber: 0,
    genUserMessage: '',
    genBackStep: 'overview',
    // transiente Belohnungs-Auswahl
    pendingLossCategory: null,
    pendingLossCard: null,
    // true, sobald die gezogene Niederlage-Karte aufgedeckt ist (Flip-Animation analog zur
    // Sieg-Beute, siehe drawLossRewardNow()/renderLossReward()).
    pendingLossRevealed: false,
    // bei Markt-Kategorien (Zauber/Kristall/Relic): gewählte Karte (bestehend oder neu gezogen),
    // die auf dem Ausgleichs-Screen wieder in die Kaserne wandert, siehe renderLossBanish().
    pendingLossBanishSelection: null,
    pendingWinRewards: null,
    pendingWinBanishSelection: null,
    pendingTreasureAward: null,
    pendingReconfigMarketplace: null,
    // Punkt 26: transiente Bearbeitungspuffer für die Kaserne (Party/Schätze) — analog zu
    // pendingReconfigMarketplace, siehe renderBarracksPanel()/syncBarracksIfValid().
    pendingReconfigParty: null,
    pendingReconfigTreasures: null,
    // Punkt 27: Beute-Reveal ("Booster Pack") — Aufdeck-Status der beiden Gruppen auf dem
    // Sieg-Beute-Screen. null = noch keine Beute-Runde aktiv; siehe startWinFlow()/renderWinReward().
    pendingWinRewardReveal: null,
    // gewählte (aktiv genutzte) Schätze je Kampf, nur für Story-Kontext — NICHT
    // Charakter-Zuordnung, siehe drawTreasureCandidates()/AUFGABE A
    chosenTreasures: [],
    // Reihenfolge-Randomizer (Kampf-Detail): Zustand des Kartendecks für den aktuell laufenden
    // Kampf. null = noch kein Kampf initialisiert. Wird von ensureTurnOrderFight() gesetzt/
    // zurückgesetzt (Reset nur bei fightIndex-Wechsel, NICHT bei bloßer Re-Navigation zu
    // renderBattle() innerhalb desselben Kampfes — siehe fightIndex-Guard dort).
    turnOrder: null,
    // Tablet-Kampf-Screen: Feste-/Erzfeind-Trefferpunkte (gemergt aus tablet-combat.html,
    // Stand 2026-09-24). Feste startet bei 30 und bleibt über den gesamten Kampfverlauf (auch
    // über mehrere Kämpfe hinweg) erhalten — nur Erzfeind wird bei jedem neuen Kampf auf
    // nem.health zurückgesetzt (siehe startNewTurnOrderFight()).
    hp: { feste: 30, erzfeind: 0 },
    // Spielzeit-Tracking je Erzfeind-Kampf (nur innerhalb der laufenden Sitzung, kein Anspruch
    // auf Genauigkeit über App-Neustarts/Geräte hinweg): je Kampf ein Eintrag
    // { accumulatedMs, runningSince, end } oder null, solange der Kampf noch nicht begonnen wurde.
    // accumulatedMs ist die bereits "sicher" verbuchte Zeit, runningSince (Unix-ms) ist gesetzt,
    // solange der Timer AKTIV läuft (siehe pauseFightTimer()/resumeFightTimer()) — läuft er nicht
    // (Bildschirm gesperrt, Tab/App im Hintergrund, Kampf-Screen verlassen), ist runningSince null
    // und es zählt nur accumulatedMs. end wird erst beim tatsächlichen Sieg über diesen Kampf
    // gesetzt (siehe finalizeWin()/finishExpedition()). Eine Niederlage setzt den Timer dieses
    // Kampfes komplett zurück auf 0 (siehe startNewTurnOrderFight(), das bei jedem Neustart des
    // Kampfes — egal ob erstmalig oder nach Niederlage — einen frischen Eintrag anlegt), da ein
    // erneuter Versuch laut Expeditionsregeln als komplett neuer Kampf gilt. Grundlage für die
    // Spielzeit-Anzeige auf dem Completion-Screen (renderVictory()).
    fightTimes: [null, null, null, null],
    // Erzfeind-id, die die Expedition endgültig beendet hat (siehe finalizeLoss()/
    // renderGameOver()) — null, solange die Expedition noch läuft oder regulär gewonnen wurde.
    // Errungenschaften: Magier, die in dieser Expedition bereits für magePicks gezählt wurden, und
    // ob die Expedition direkt nach einer finalen Niederlage gestartet wurde (siehe achievements.js).
    playedMageIds: [],
    followsDefeat: false,
    // IDs der Meilensteine, die in genau dieser Expedition freigeschaltet wurden (siehe
    // achRecordForExpedition()) — Anzeige auf Completion- und Game-Over-Screen.
    expeditionAchievements: [],
    gameOverNemesisId: null
  };
}

// ---------- Data-Helfer ----------

function partyMages() { return app.runtime.chosenParty.map(mageByIdPlan); }
function currentNemesis() { return nemesisByIdPlan(app.plan.nemesisOrder[app.runtime.fightIndex]); }
function nemesisAt(i) { return nemesisByIdPlan(app.plan.nemesisOrder[i]); }

function genderLabel(m) {
  if (m.gender === 'm') return 'männlich';
  if (m.gender === 'w') return 'weiblich';
  return '';
}
function mageDescriptor(m) {
  const bits = [m.title, genderLabel(m)].filter(Boolean).join(', ');
  return `${m.name}${bits ? ' (' + bits + ')' : ''}`;
}

function currentMarketplaceCards() {
  return app.runtime.currentMarketplace.map(marketplaceCardById).filter(Boolean);
}
function marketplaceCardsBySubtypeCurrent(subtype) {
  return sortByCost(currentMarketplaceCards().filter((c) => c.subtype === subtype));
}

// Marktplatz-/Kaserne-Karten werden überall aufsteigend nach Kosten sortiert (günstig -> teuer),
// damit die Reihenfolge in jeder Ansicht konsistent und leicht überblickbar ist.
function sortByCost(cards) {
  return [...cards].sort((a, b) => (a.cost || 0) - (b.cost || 0));
}

// ---------- Prompt-Bau (Einmal-Generierung der gesamten Erzählung) ----------

function toneForNemesis(n) {
  const diff = Number(n.difficulty) || 0;
  const rating = Number(n.expeditionRating) || 0;
  const intensity = Math.max(diff, rating);
  if (intensity >= 7) return 'Dieser Erzfeind ist extrem gefährlich — schreibe düster, angespannt, mit hohem Einsatz und wachsender Verzweiflung.';
  if (intensity >= 4) return 'Dieser Erzfeind ist ernstzunehmend — halte den Ton ernst und zielgerichtet, mit spürbarem Risiko.';
  return 'Dieser Erzfeind ist vergleichsweise überschaubar — der Ton darf leichter und entschlossener wirken als bei den gefährlichsten Gegnern.';
}

// Deterministischer Sieges-Fahrplan: da drawWinRewards()/drawTreasureCandidates() unabhängig
// von der tatsächlichen Versuchsanzahl (attemptNumber ist immer 1) sind, lässt sich der komplette
// Sieges-Pfad der Expedition bereits VOR jeder Generierung exakt vorausberechnen (siehe
// simulateGuaranteedWinCampaign() in plan.js). Das ist die Grundlage der Einmal-Generierung:
// Claude bekommt alle Sieges-Funde/Schatzkandidaten aller 4 Kämpfe vorab mitgeteilt und muss
// sie nur noch konsistent in die Erzählung einbauen — Niederlagen werden dabei bewusst NICHT
// abgebildet (siehe Nutzer-Bestätigung), sie bleiben reine Kaserne-Ereignisse ohne Story-Bezug.
function buildCampaignBriefingBlock() {
  const sim = simulateGuaranteedWinCampaign(app.plan);
  return sim.fights.map((fight) => {
    const nem = nemesisAt(fight.fightIndex);
    const rewardBits = ['Kristall', 'Relic', 'Zauber'].map((s) => {
      const c = fight.winRewards[s];
      const label = categoryLabel(s);
      return c ? `${label} „${c.name}"${c.effect ? ' – ' + c.effect : ''}` : `${label}: (keiner verfügbar)`;
    }).join('; ');
    let treasureLine = '';
    if (fight.treasure) {
      const names = fight.treasure.candidates.map((t) => (
        t.id === fight.treasure.recommendedId ? `„${t.name}" [DAVON WÄHLT DIE GRUPPE TATSÄCHLICH]` : `„${t.name}"`
      )).join(', ');
      treasureLine = `\n  Schatz Stufe ${romanTier(fight.treasure.tier)} — Kandidaten: ${names}.`;
    }
    return `Kampf ${fight.fightIndex + 1}: ${nem.name} (${nem.expansion}, Schwierigkeit ${nem.difficulty})\n  Marktplatzfunde nach dem Sieg: ${rewardBits}${treasureLine}`;
  }).join('\n\n');
}

function buildMegaStorySystemPrompt() {
  const npcPool = AEONS_DATA.mages
    .filter((m) => app.plan.selectedExpansions.includes(m.expansion) && !app.runtime.chosenParty.includes(m.id))
    .map(mageDescriptor);
  const nemesisPoolNames = app.plan.nemesisOrder.map((id) => nemesisByIdPlan(id).name);
  const treasurePoolNote = AEONS_DATA.treasures.some((t) => app.plan.selectedExpansions.includes(t.expansion))
    ? 'In dieser Expedition existieren benannte magische Schätze auf drei Stufen (I, II, III), die die Gruppe im Verlauf erhält, sowie Marktplatzfunde (Kristalle, Zauber, Artefakte).'
    : 'In dieser Expedition gibt es vor allem Marktplatzfunde (Kristalle, Zauber, Artefakte) statt benannter Stufen-Schätze — beschreibe erhaltene Gegenstände konsistent mit der Welt.';
  const toneNotes = app.plan.nemesisOrder
    .map((id, i) => `Kampf ${i + 1} (${nemesisByIdPlan(id).name}): ${toneForNemesis(nemesisByIdPlan(id))}`)
    .join('\n');
  const briefing = buildCampaignBriefingBlock();

  return `Du bist der Erzähler einer Expedition in der Welt von Aeon's End. Schreibe die GESAMTE Erzählung in EINER Antwort: vier kurze Kapitel + Epilog. Ton: offizieller Aeon's-End-Kampagnentext, kein Spielbericht.

FAKTEN DIESER EXPEDITION (nur Faktenbasis, nicht zitieren):
${briefing}

Erzfeinde in Kampfreihenfolge: ${nemesisPoolNames.join(' → ')}.
${toneNotes}

Magier der Gruppe sind die Hauptfiguren. Passende Pronomen nutzen, wo ein Geschlecht angegeben ist.
Verfügbare NPCs: ${npcPool.join(', ') || '(keine – frei erfunden, aber lorekonform)'}
${treasurePoolNote}

STIL UND ERZÄHLWEISE
Schreibe wie ein offiziell lektorierter Kampagnentext aus der Welt von Aeon's End: eine zusammenhängende Fantasy-Erzählung in klarer, natürlicher Prosa — keine Abfolge von Szenen, Stichpunkten oder filmischen Einstellungen. Keine Füllsätze, keine Wiederholungen.
- Absätze: Jeder Absatz entwickelt einen zusammenhängenden Gedanken, eine Handlung oder einen Dialogaustausch über mehrere Sätze. Keine Ein-Satz-Absätze und keine Reihung isolierter Fragmente wie „Dann war es still." / „Nur einmal." / „Sie blieb stehen." / „Niemand antwortete.". Ist so ein Moment erzählerisch wichtig, bette ihn in einen vollständigen Absatz und den Handlungsfluss ein.
- Rhythmus: Satzlängen variieren. Kurze Sätze nur gezielt und selten; sie bestimmen nie den Grundrhythmus.
- Zusammenhang: Verbinde aufeinanderfolgende Ereignisse ursächlich. Zeige, wie die Figuren reagieren und wie daraus der nächste Moment entsteht. Jeder Abschnitt entwickelt sich aus dem vorherigen und führt zum nächsten — schreibe eine Geschichte, keine Folge „cooler" Einzelmomente.
- Spannung: entsteht durch Handlung, Konsequenzen, Wahrnehmung, Dialog und wachsende Bedrohung — nicht durch Satzfragmente oder häufige Absatzumbrüche.
- Figuren: Persönlichkeit zeigt sich in Entscheidungen, Verhalten, Reaktionen und kurzen, glaubwürdigen Dialogen, nicht in direkten Charakterbeschreibungen.
- Orientierung: Der Leser weiß jederzeit, wo die Gruppe ist, was geschieht und warum sie als Nächstes handelt.
- Beschreibung: sparsam, aber konkret. Nur Details, die Atmosphäre, Handlung oder Charakterisierung tragen; keine bedeutungslosen Adjektive, keine austauschbaren Fantasy-Bilder.
- Dialog: natürlich und mit Zweck. Keine kurzen Zeilen, die nur Spannung markieren oder Information künstlich dramatisch zerstückeln.

LÄNGE (hart — eher kürzer)
Kapitel 1–4: je 180–250 Wörter. Epilog: 120–180 Wörter.

AUFBAU JEDES KAPITELS
Beginnt (außer Kapitel 1) mit 1–2 Sätzen Auflösung des vorigen Kampfes. Dann EINE klare Szene, die die Gruppe zum nächsten Erzfeind führt. Kein Kampf und kein Kampfausgang im selben Abschnitt, der zu diesem Kampf hinführt — das kommt erst zu Beginn des nächsten Abschnitts.
Erzfeind-Namen fallen erst in ihrem eigenen Kapitel, vorher höchstens ein vages Vorzeichen.
Sieges-Funde aus den FAKTEN erscheinen im passenden Kapitel beim Namen, max. 1 Satz Herkunft.
Epilog: Auflösung des 4. Kampfes, dann Abschluss. Ton frei wählbar — hoffnungsvoll-rund oder offen/düster mit einem letzten Nachhall —, passend zur Intensität der Expedition.

NIEMALS
Spielregeln, Kartenmechanik, Würfelwürfe. Entscheidungen für die Spieler. Erfundene Nebenhandlungen oder Figuren ohne Bezug zu Gruppe/Fahrplan/NPCs oben.

FORMAT
Nur Deutsch. Genau 5 Abschnitte, jeweils mit exakter Trennzeile:
### KAPITEL 1 ###
### KAPITEL 2 ###
### KAPITEL 3 ###
### KAPITEL 4 ###
### EPILOG ###
Der Epilog ist kein 5. Kapitel — kein "Kapitel 5" in Trennzeile, Titel oder Text.
Nach jeder Trennzeile: "## Titel" (ohne das Wort "Kapitel"), Leerzeile, dann Fließtext. Keine Meta-Kommentare, keine Zusammenfassung am Ende.`;
}

function buildMegaUserMessage() {
  const mages = partyMages().map((m) => `- ${mageDescriptor(m)}`).join('\n');
  return `EINGABE — Schreibe jetzt die gesamte Erzählung dieser Expedition gemäß der Systemanweisung oben (fünf Abschnitte: Kapitel 1–4 + Epilog).\n\nMagier der Gruppe:\n${mages}`;
}

function buildPromptText(userMessageText) {
  return 'SYSTEMANWEISUNG — befolge diese Regeln strikt für deine gesamte Antwort:\n\n' + buildMegaStorySystemPrompt() +
    '\n\n======================\n\n' + userMessageText;
}

function startGeneration(label, chapterNumber, userMessageText, backStep) {
  app.runtime.genLabel = label;
  app.runtime.genChapterNumber = chapterNumber;
  app.runtime.genUserMessage = userMessageText;
  app.runtime.genBackStep = backStep;
  saveActiveSlot();
  playSfx('navigation_forward');
  goto('generate');
}

// Extrahiert Titel ("## Titel") + Fließtext aus einem einzelnen Abschnitt der Mega-Antwort.
function parseChapterText(storyPart) {
  const m = storyPart.match(/^\s*##\s*(.+?)\s*\n+([\s\S]*)$/);
  const title = m ? m[1].trim() : '';
  const body = (m ? m[2] : storyPart).trim();
  return { title, body };
}

// Zerlegt die EINE Antwort auf den Mega-Prompt anhand der Trennzeilen
// "### KAPITEL n ###" / "### EPILOG ###" in ihre 5 Abschnitte.
function parseMegaStory(raw) {
  const sectionRe = /^\s*###\s*(KAPITEL\s*([1-4])|EPILOG)\s*###\s*$/gim;
  const matches = [];
  let m;
  while ((m = sectionRe.exec(raw))) {
    matches.push({ start: sectionRe.lastIndex, matchIndex: m.index, isEpilogue: /EPILOG/i.test(m[1]), chapterNum: m[2] ? Number(m[2]) : null });
  }
  const sections = {};
  matches.forEach((mm, i) => {
    const stop = i + 1 < matches.length ? matches[i + 1].matchIndex : raw.length;
    const chunk = raw.slice(mm.start, stop).trim();
    if (!chunk) return;
    const parsed = parseChapterText(chunk);
    if (mm.isEpilogue) sections.epilogue = parsed;
    else sections['chapter' + mm.chapterNum] = parsed;
  });
  return sections;
}

const WORD_COUNT_TARGETS = { 1: [180, 250], 2: [180, 250], 3: [180, 250], 4: [180, 250], epilogue: [120, 180] };
function countWords(text) { return text.trim().split(/\s+/).filter(Boolean).length; }

// ---------- Soundeffekte ----------
// Läuft über die Web Audio API statt <audio>-Elemente: iOS Safari muss beim Abspielen eines
// HTMLAudioElement den Decoder jedes Mal neu anstoßen, was auf dem iPad zu spürbarer Verzögerung
// führte (auch nach Umstieg von .wav auf kleinere .mp3-Dateien — siehe Memory
// aeons_end_mp3_safari_decode_fix). Der SFX-Manager unten lädt & dekodiert jede Datei einmalig im
// Hintergrund (decodeAudioData) und spielt sie danach nur noch aus dem bereits dekodierten
// AudioBuffer ab — kein erneutes Decodieren pro Klick, dadurch keine Verzögerung mehr.

const SFX_FILES = {
  start_battle: 'soundeffects/start_battle.mp3',
  battle_lost: 'soundeffects/battle_lost.mp3',
  victory: 'soundeffects/battle_won.mp3',
  loot: 'soundeffects/loot.mp3',
  completion: 'soundeffects/completion.mp3',
  start_campaign: 'soundeffects/start_campaign.mp3',
  navigation_hover: 'soundeffects/navigation_hover.mp3',
  navigation_select: 'soundeffects/navigation_select.mp3',
  navigation_deselect: 'soundeffects/navigation_deselect.mp3',
  error: 'soundeffects/error.mp3',
  navigation_confirm: 'soundeffects/navigation_confirm.mp3',
  undo: 'soundeffects/undo.mp3',
  show_barracks: 'soundeffects/showBarraks.mp3',
  hide_barracks: 'soundeffects/hideBarraks.mp3',
  create_expedition: 'soundeffects/create_new_expedition.mp3',
  navigation_backward: 'soundeffects/navigation_backward.mp3',
  navigation_forward: 'soundeffects/navigation_forward.mp3',
  delete: 'soundeffects/delete.mp3',
  back_to_start: 'soundeffects/back_to_start.mp3',
  draw: 'soundeffects/draw.mp3',
  // Datei wurde von "waiting.mp3" zu "gravehold.mp3" umbenannt (Nutzer-Vorgabe 2026-09-26) —
  // die Datei existiert bereits umbenannt im Verzeichnis. Der SFX-Key heißt jetzt ebenfalls
  // "gravehold" (siehe einzigen Aufrufer: Klick auf hpFesteValue im Tablet-Kampf-Screen).
  gravehold: 'soundeffects/gravehold.mp3',
  // Game-Over-Screen (finale Niederlage, siehe finalizeLoss()/renderGameOver()).
  game_over: 'soundeffects/game_over.mp3'
};

// Monster-spezifische Reveal-Sounds (1. Klick auf Erzfeind-Kachel, siehe revealNemesisTile()).
// Key = Nemesis-id aus data.js. Fehlt eine id hier (z.B. bei künftig neu hinzugefügten Erzfeinden),
// bleibt der Reveal stumm statt einen Fehler zu werfen (siehe playNemesisRevealSfx()).
const NEMESIS_SFX_FILES = {
  CarapaceQueen: 'soundeffects/nemesis/carapace_queen.mp3',
  CrookedMask: 'soundeffects/nemesis/crooked_mask.mp3',
  PrinceOfGluttons: 'soundeffects/nemesis/prince_gluttons.mp3',
  Rageborne: 'soundeffects/nemesis/rageborne.mp3',
  Necroswarm: 'soundeffects/nemesis/necroswarm.mp3',
  Bladius: 'soundeffects/nemesis/bladius.mp3',
  Deathmind: 'soundeffects/nemesis/deathmind.mp3',
  FungalMesh: 'soundeffects/nemesis/fungal_mesh.mp3',
  MaelstromRisen: 'soundeffects/nemesis/maelstrom_risen.mp3',
  SpawningHorror: 'soundeffects/nemesis/spawning_horror.mp3',
  XaxosAscended: 'soundeffects/nemesis/xaxos_ascended.mp3',
  HazeFiend: 'soundeffects/nemesis/haze_fiend.mp3',
  ThriceDeadProphet: 'soundeffects/nemesis/thrice_dead_prophet.mp3',
  Wraithmonger: 'soundeffects/nemesis/wraithmonger.mp3',
  TheWailing: 'soundeffects/nemesis/wailing.mp3',
  TheWanderer: 'soundeffects/nemesis/wanderer.mp3',
  HordeCrone: 'soundeffects/nemesis/horde_crone.mp3',
  BlightLord: 'soundeffects/nemesis/blight_lord.mp3',
  WaywardOne: 'soundeffects/nemesis/wayward_one.mp3',
  Maggoth: 'soundeffects/nemesis/maggoth.mp3',
  Arachnos: 'soundeffects/nemesis/arachnos.mp3',
  AgelessWalker: 'soundeffects/nemesis/ageless_walker.mp3',
  Fenrix: 'soundeffects/nemesis/fenrix.mp3',
  KnightOfShackles: 'soundeffects/nemesis/knight_shackles.mp3',
  MaidenOfThorns: 'soundeffects/nemesis/maiden_thorns.mp3',
  GateWitch: 'soundeffects/nemesis/gate_witch.mp3',
  HollowCrown: 'soundeffects/nemesis/hollow_crown.mp3',
  MagusOfCloaks: 'soundeffects/nemesis/magus_cloaks.mp3',
  UmbraTitan: 'soundeffects/nemesis/umbra_titan.mp3'
};

// Einzelne Sounds gezielt leiser abspielen (0.0–1.0). Fehlt ein Eintrag, wird volle Lautstärke
// (1.0) verwendet. navigation_hover spielt bei jedem Kartenüberflug ab, daher deutlich gedämpft,
// damit er beim wiederholten Hovern nicht nervt.
const SFX_VOLUME = {
  navigation_hover: 0.1,
  navigation_forward: 0.1,
  navigation_backward: 0.1,
  delete: 0.1,
  back_to_start: 0.25,
  create_expedition: 0.6,
  navigation_select: 0.15,
  navigation_deselect: 0.15,
  loot: 0.6,
  error: 0.8,
  navigation_confirm: 0.25,
  undo: 0.8,
  hide_barracks: 0.8,
  show_barracks: 0.8,
  draw: 0.8,
  loot: 0.8,
  // Nutzer-Vorgabe 2026-09-26: alle bisher auf voller Lautstärke (100%, = kein Eintrag hier)
  // laufenden Sounds werden auf 80% gedämpft.
  start_battle: 0.8,
  battle_lost: 0.8,
  victory: 0.8,
  completion: 0.8,
  start_campaign: 0.8,
  gravehold: 0.8,
  game_over: 0.8
};

// ---- SFX-Manager: ein AudioContext, alle Dateien werden einmalig geladen+dekodiert und als
// AudioBuffer gecacht. Fehlende/fehlgeschlagene Dateien werden übersprungen (Sound ist rein
// kosmetisch, darf App nie blockieren). ----
let sfxCtx = null;
const sfxBufferCache = new Map(); // src -> AudioBuffer
const sfxLoadPromises = new Map(); // src -> Promise<AudioBuffer|null>

function getSfxCtx() {
  if (!sfxCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    sfxCtx = new Ctor();
  }
  return sfxCtx;
}

// Lädt+dekodiert eine Datei genau einmal (spätere Aufrufe liefern denselben Cache-Eintrag).
function loadSfxBuffer(src) {
  if (sfxBufferCache.has(src)) return Promise.resolve(sfxBufferCache.get(src));
  if (sfxLoadPromises.has(src)) return sfxLoadPromises.get(src);
  const ctx = getSfxCtx();
  if (!ctx) return Promise.resolve(null);
  const p = fetch(src)
    .then((res) => res.arrayBuffer())
    .then((buf) => ctx.decodeAudioData(buf))
    .then((decoded) => { sfxBufferCache.set(src, decoded); return decoded; })
    .catch(() => null); // fehlende/kaputte Datei -> stummer Fallback
  sfxLoadPromises.set(src, p);
  return p;
}

// Lädt alle SFX im Hintergrund vor (nicht blockierend), damit beim ersten Antippen bereits ein
// fertig dekodierter Buffer bereitsteht statt Fetch+Decode zur Klickzeit nachzuholen.
function preloadAllSfx() {
  if (!getSfxCtx()) return;
  Object.values(SFX_FILES).forEach(loadSfxBuffer);
  Object.values(NEMESIS_SFX_FILES).forEach(loadSfxBuffer);
}

// iOS/Safari setzt einen neuen AudioContext zunächst auf "suspended" und erlaubt resume() nur
// innerhalb einer echten Nutzer-Geste. Zusätzlich suspendiert iOS Safari den AudioContext auch
// nachträglich, sobald ein natives blockierendes Dialogfenster (confirm()/alert()) erscheint —
// z.B. "Diese Expedition löschen?". Daher NICHT nur einmalig entsperren, sondern bei jeder
// Nutzer-Geste erneut prüfen/reaktivieren (dauerhafter Listener statt { once: true }).
function unlockSfxCtx() {
  const ctx = getSfxCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}
['pointerdown', 'touchend', 'keydown'].forEach((evt) => {
  document.addEventListener(evt, unlockSfxCtx, { passive: true });
});

function playBuffer(buffer, volume) {
  const ctx = getSfxCtx();
  if (!ctx || !buffer) return;
  try {
    if (ctx.state === 'suspended') {
      // Nach einem nativen confirm()/alert()-Dialog kann der Context auf iOS Safari suspendiert
      // bleiben; hier direkt aus der aktuellen Nutzer-Geste heraus reaktivieren, statt stumm zu
      // bleiben, bis der nächste unlockSfxCtx-Listener greift.
      ctx.resume().catch(() => {});
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);
    source.start(0);
  } catch (e) { /* ignorieren, Sound ist rein kosmetisch */ }
}

// Spielt den zum Erzfeind gehörenden Reveal-Sound ab (Fallback: kein Sound, falls die id
// unbekannt ist oder die Datei noch nicht dekodiert werden konnte).
function playNemesisRevealSfx(nemesisId) {
  const src = NEMESIS_SFX_FILES[nemesisId];
  if (!src) return;
  const cached = sfxBufferCache.get(src);
  if (cached) { playBuffer(cached, 1); return; }
  loadSfxBuffer(src).then((buffer) => playBuffer(buffer, 1));
}

function playSfx(name) {
  const src = SFX_FILES[name];
  if (!src) return;
  const volume = SFX_VOLUME[name] !== undefined ? SFX_VOLUME[name] : 1;
  const cached = sfxBufferCache.get(src);
  if (cached) { playBuffer(cached, volume); return; }
  loadSfxBuffer(src).then((buffer) => playBuffer(buffer, volume));
}

function bindHoverSfx(element) {
  if (!element || element.classList.contains('disabled') || element._hoverSfxBound) return;
  element._hoverSfxBound = true;
  element.addEventListener('mouseenter', () => playSfx('navigation_hover'));
}

function showToast(msg, type) {
  const t = el('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => { t.hidden = true; }, 6000);
  playSfx(type === 'confirm' ? 'navigation_confirm' : 'error');
}

function submitGeneration() {
  const raw = el('genResponseInput').value.trim();
  if (!raw) { showToast('Bitte zuerst die Antwort von Claude hier einfügen.'); return; }

  const sections = parseMegaStory(raw);
  const missing = [1, 2, 3, 4].filter((n) => !sections['chapter' + n]).map((n) => `Kapitel ${n}`);
  if (!sections.epilogue) missing.push('Epilog');
  if (missing.length) {
    showToast('Antwort unvollständig — fehlende Abschnitte: ' + missing.join(', ') + '. Bitte Trennzeilen ("### KAPITEL n ###" / "### EPILOG ###") prüfen und erneut einfügen.');
    return;
  }

  const chapters = [];
  const wordWarnings = [];
  for (let n = 1; n <= 4; n++) {
    const { title, body } = sections['chapter' + n];
    chapters[n - 1] = { chapterLabel: `Kapitel ${n}`, title, body };
    const target = WORD_COUNT_TARGETS[n];
    const wc = countWords(body);
    if (target && (wc < target[0] || wc > target[1])) wordWarnings.push(`Kapitel ${n}: ${wc} Wörter (Vorgabe ${target[0]}–${target[1]})`);
  }
  chapters[4] = { chapterLabel: 'Epilog', title: sections.epilogue.title, body: sections.epilogue.body };
  const epWc = countWords(sections.epilogue.body);
  if (epWc < WORD_COUNT_TARGETS.epilogue[0] || epWc > WORD_COUNT_TARGETS.epilogue[1]) {
    wordWarnings.push(`Epilog: ${epWc} Wörter (Vorgabe ${WORD_COUNT_TARGETS.epilogue[0]}–${WORD_COUNT_TARGETS.epilogue[1]})`);
  }
  if (wordWarnings.length) showToast('Hinweis zu Wortzahlen — ' + wordWarnings.join('; '));

  // Punkt 21: die gesamte Erzählung (Kapitel 1-4 + Epilog) liegt jetzt bereits vollständig vor —
  // die Anzeige einzelner Kapitel/des Epilogs bleibt unverändert klick-/status-getrieben
  // (siehe renderBattle()/renderOverview()/openNextBattle()), nur die Erzeugung ist jetzt einmalig.
  app.runtime.chapters = chapters;
  app.runtime.setupComplete = true;
  playIntroSoundOnce();
  playSfx('navigation_forward');
  saveActiveSlot();
  goto('overview');
}

// Spielt start_campaign.wav genau einmal je Kampagne ab — beim allerersten Erreichen der
// Übersicht (aus submitGeneration() ODER skipStory(), je nachdem ob Erzählung generiert wurde).
// Spätere Aufrufe von goto('overview') (z.B. nach jedem Kampf, oder nach dem Laden eines bereits
// laufenden Spielstands über die Startseite) lösen den Sound NICHT erneut aus, da introSoundPlayed
// dann schon persistiert true ist.
function playIntroSoundOnce() {
  if (app.runtime.introSoundPlayed) return;
  app.runtime.introSoundPlayed = true;
  playSfx('start_campaign');
}

// Punkt 23: Story komplett überspringen — nur Randomizer-Logik (Marktplatz, Nemesis-Reveal,
// Belohnungen) wird weiter verwendet, es wird keine Erzählung generiert oder angezeigt.
function skipStory() {
  app.runtime.storyDisabled = true;
  app.runtime.chapters = [];
  app.runtime.setupComplete = true;
  playIntroSoundOnce();
  playSfx('navigation_forward');
  saveActiveSlot();
  goto('overview');
}

// ---------- Belohnungs-Resolution ----------

// Wandelt eine Schatz-Stufe (1/2/3) in die im UI verwendete römische Schreibweise um
// ("Schatz Stufe I/II/III" statt "Schatz Tier 1/2/3"). Interne Bezeichner wie
// 'Schatz-Tier-1' bleiben davon unberührt — nur die angezeigte Beschriftung ändert sich.
function romanTier(level) {
  return { 1: 'I', 2: 'II', 3: 'III' }[level] || String(level);
}

// Punkt 26: sorgt dafür, dass currentTreasures (die "aktiven" Schätze, analog zu
// currentMarketplace) je Stufe stets bis zum Zielwert aufgefüllt sind — Stufe II genau 1,
// Stufe I/III genau die Spieleranzahl, jeweils begrenzt auf tatsächlich verfügbare Kaserne-
// Schätze. Wird nach jedem Kaserne-Zuwachs aufgerufen (Sieg/Niederlage) sowie defensiv beim
// Öffnen der Kaserne. Nimmt NIE etwas weg — nur Auffüllen, freies Abwählen bleibt Sache der
// Kaserne-Bearbeitung (siehe syncBarracksIfValid()).
// priorityIds: die Schatz-IDs, die der Spieler gerade eben aktiv ausgewählt hat (Sieg-Beute-
// Auswahl bzw. Niederlage-Ziehung) — werden bevorzugt in die freien Aktiv-Slots übernommen,
// statt dass ensureCurrentTreasures() eine beliebige andere (noch nicht aktive) Kaserne-Karte
// derselben Stufe zieht. Ohne das musste man die eigene Auswahl anschließend in der Kaserne
// noch einmal von Hand nachziehen.
function ensureCurrentTreasures(priorityIds) {
  const priority = priorityIds || [];
  const playerCount = app.plan.playerCount || app.runtime.chosenParty.length || 4;
  const pool = app.runtime.barracks.treasureIds.map(treasureByIdPlan).filter(Boolean);
  [1, 2, 3].forEach((level) => {
    const levelPool = pool.filter((t) => t.level === level);
    const target = Math.min(treasureTierTarget(level, playerCount), levelPool.length);
    const active = app.runtime.currentTreasures.filter((id) => {
      const t = treasureByIdPlan(id);
      return t && t.level === level;
    });
    if (active.length < target) {
      const candidates = levelPool.filter((t) => !app.runtime.currentTreasures.includes(t.id));
      const prioritized = candidates.filter((t) => priority.includes(t.id));
      const rest = candidates.filter((t) => !priority.includes(t.id));
      prioritized.concat(rest)
        .slice(0, target - active.length)
        .forEach((t) => app.runtime.currentTreasures.push(t.id));
    }
  });
}

function categoryLabel(cat) {
  const map = { Magier: 'Magier', Kristall: 'Kristall', Relic: 'Artefakt', Zauber: 'Zauber' };
  if (map[cat]) return map[cat];
  if (cat.startsWith('Schatz-Tier-')) return 'Schatz (Stufe ' + romanTier(Number(cat.replace('Schatz-Tier-', ''))) + ')';
  return cat;
}

function availableLossCategories() {
  const cats = ['Magier', 'Kristall', 'Relic', 'Zauber'];
  // Bei Niederlage darf nur ein Schatz einer Stufe gezogen werden, von der die Gruppe
  // bereits Schätze erhalten hat (also aus einem bereits gewonnenen früheren Kampf) —
  // nicht von der Stufe des gerade laufenden (noch nicht gewonnenen) Kampfes.
  const f = app.runtime.fightIndex; // 0-basiert: f = Anzahl bereits gewonnener Kämpfe
  for (let tier = 1; tier <= f && tier <= 3; tier++) {
    const pool = poolForCategory(app.plan, app.runtime, 'Schatz-Tier-' + tier);
    if (pool.length) cats.push('Schatz-Tier-' + tier);
  }
  return cats;
}

function isMarketCategory(category) {
  return category === 'Kristall' || category === 'Relic' || category === 'Zauber';
}

// Punkt 36: Niederlage-Ablauf jetzt analog zum Sieg-Beute-Screen — Ziehen und Aufdecken
// erfolgen mit einem einzigen Klick (kein separater "Aufdecken"-Button nötig, da nur 1 Karte
// betroffen ist), die eigentliche Übernahme (finalizeLoss) folgt erst nach "Weiter" bzw. nach
// dem Marktplatz-Ausgleich (siehe confirmLossBanish()).
function drawLossRewardNow(selectedValue) {
  const cats = availableLossCategories();
  const category = selectedValue === 'Zufall' ? pickRandomLossCategory(app.plan, app.runtime, cats) : selectedValue;
  const card = drawLossReward(app.plan, app.runtime, category);
  app.runtime.pendingLossCategory = category;
  app.runtime.pendingLossCard = card;
  app.runtime.pendingLossRevealed = false;

  if (card) {
    if (category === 'Magier') {
      app.runtime.barracks.mageIds.push(card.id);
    } else if (category.startsWith('Schatz-Tier-')) {
      app.runtime.barracks.treasureIds.push(card.id);
      ensureCurrentTreasures([card.id]);
    } else {
      // Punkt 36: landet jetzt sofort auch im AKTIVEN Marktplatz (analog startWinFlow()) —
      // der Ausgleich auf die Zielverteilung 4/3/2 erfolgt danach explizit auf dem
      // Ausgleichs-Screen (siehe renderLossBanish()/confirmLossBanish()), nicht mehr implizit
      // über den allgemeinen Reconfig-Screen.
      app.runtime.barracks.marketplaceCardIds.push(card.id);
      app.runtime.currentMarketplace.push(card.id);
    }
  }
  saveActiveSlot();
  renderScreen();
  // Kurze Verzögerung, damit die Flip-Animation (siehe flipCardHtml()) tatsächlich von
  // verdeckt -> aufgedeckt übergeht, statt bereits aufgedeckt zu rendern.
  window.setTimeout(() => {
    app.runtime.pendingLossRevealed = true;
    renderScreen();
    playSfx(card ? 'loot' : 'battle_lost');
    if (!card) showToast('Kein Nachschub für diese Kategorie mehr verfügbar.');
  }, 50);
}

// Macht die Niederlage-Entscheidung wieder rückgängig: entfernt eine bereits gezogene/committete
// Karte wieder aus der Kaserne bzw. dem aktiven Marktplatz (falls schon eine Kategorie gewählt
// wurde) und kehrt zum Kampf-Screen zurück, OHNE die Niederlage zu zählen (triesPerFight wird erst
// in finalizeLoss() erhöht, ist also hier noch unberührt). Wird vom "Zurück"-Button auf
// screen-loss-reward aufgerufen — dort jetzt immer sichtbar, nicht mehr nur vor dem ersten Ziehen.
// Dieselbe Funktion hängt auch am "Niederlage zurücknehmen"-Button auf screen-loss-banish
// (analog zu undoWinReward() auf screen-win-banish) — category/card sind zu diesem Zeitpunkt
// bereits gesetzt, der Ablauf ist identisch.
function undoLossReward() {
  const category = app.runtime.pendingLossCategory;
  const card = app.runtime.pendingLossCard;
  if (category && card) {
    if (category === 'Magier') {
      app.runtime.barracks.mageIds = app.runtime.barracks.mageIds.filter((id) => id !== card.id);
    } else if (category.startsWith('Schatz-Tier-')) {
      app.runtime.barracks.treasureIds = app.runtime.barracks.treasureIds.filter((id) => id !== card.id);
      app.runtime.currentTreasures = app.runtime.currentTreasures.filter((id) => id !== card.id);
    } else {
      app.runtime.barracks.marketplaceCardIds = app.runtime.barracks.marketplaceCardIds.filter((id) => id !== card.id);
      app.runtime.currentMarketplace = app.runtime.currentMarketplace.filter((id) => id !== card.id);
    }
  }
  app.runtime.pendingLossCategory = null;
  app.runtime.pendingLossCard = null;
  app.runtime.pendingLossRevealed = false;
  app.runtime.pendingLossBanishSelection = null;
  saveActiveSlot();
  playSfx('undo');
  goto('battle');
}

function continueAfterLossReveal() {
  const category = app.runtime.pendingLossCategory;
  const card = app.runtime.pendingLossCard;
  playSfx('navigation_forward');
  if (card && isMarketCategory(category)) {
    app.runtime.pendingLossBanishSelection = null;
    goto('loss-banish');
  } else {
    finalizeLoss();
  }
}

// Marktplatz-Ausgleich analog zu selectWinBanishCard(), aber nur für den einen betroffenen
// Subtyp (Niederlage zieht immer nur 1 Karte, nie alle drei gleichzeitig wie beim Sieg).
function selectLossBanishCard(cardId) {
  app.runtime.pendingLossBanishSelection = cardId;
  playSfx('navigation_select');
  renderScreen();
}

function confirmLossBanish() {
  const sel = app.runtime.pendingLossBanishSelection;
  if (!sel) {
    showToast('Bitte 1 Karte auswählen, die in die Kaserne wandert.');
    return;
  }
  playSfx('navigation_forward');
  app.runtime.currentMarketplace = app.runtime.currentMarketplace.filter((id) => id !== sel);
  app.runtime.pendingLossBanishSelection = null;
  saveActiveSlot();
  finalizeLoss();
}

// Option "Finale Niederlage nach 3 verlorenen Kämpfen gegen denselben Erzfeind" (siehe
// #screen-options > "Expeditionsregeln", Default AN): wird diese Niederlage zur 3. in Folge
// gegen denselben Erzfeind, endet die Expedition sofort auf screen-game-over — OHNE den
// Beute-Flow ("Unterstützung anfordern", screen-loss-reward/-loss-banish), da es bei der
// endgültigen Niederlage keine Belohnung mehr gibt. Wird direkt von handleBattleLossClick()
// aufgerufen, sobald erkannt wird, dass diese Niederlage die 3. wäre — noch bevor überhaupt
// eine Kategorie gewählt wurde. app.runtime.gameOverNemesisId speichert, WELCHER Erzfeind
// gesiegt hat, damit renderGameOver() den Namen auch nach einem späteren Neuladen noch
// anzeigen kann (siehe routeAfterLoad()).
function triggerFinalDefeat() {
  app.runtime.triesPerFight[app.runtime.fightIndex]++;
  recordNemesisAttempt(app.plan.nemesisOrder[app.runtime.fightIndex], false);
  app.runtime.pendingLossCategory = null;
  app.runtime.pendingLossCard = null;
  app.runtime.pendingLossRevealed = false;
  app.runtime.pendingLossBanishSelection = null;
  app.runtime.gameOverNemesisId = app.plan.nemesisOrder[app.runtime.fightIndex];
  // Party-Synergie-Hinweise: finale Niederlage zählt als abgeschlossene Expedition (ohne Sieg).
  recordPartyComboResult(app.runtime.chosenParty, app.plan.playerCount, false);
  saveActiveSlot();
  onExpeditionEndAchievements(false);
  goto('game-over');
  playSfx('game_over');
}

// Errungenschaften: Expeditionsende (Sieg/finale Niederlage) einmalig verbuchen und auswerten.
// Nutzt nur runtime/plan/fightTimes, ist also unabhängig vom aktuellen fightIndex.
function onExpeditionEndAchievements(won) {
  if (won) recordHighscore();
  const { flawless } = recordExpeditionEnd(won);
  evaluateAchievements({ event: 'expeditionEnd', won, flawless });
  // Die Auswertung kann runtime.expeditionAchievements ergänzt haben (Anzeige auf Completion-/
  // Game-Over-Screen) — der Slot wurde vorher gespeichert, daher hier erneut sichern.
  saveActiveSlot();
}

// Errungenschaften: Kampf wurde gewonnen (direkt nach dem Setzen von fightTimes[f].end, VOR
// fightIndex++). failedTries = Fehlversuche vor diesem Sieg.
function onFightWonAchievements(f) {
  const nemesisId = app.plan.nemesisOrder[f];
  const failedTries = app.runtime.triesPerFight[f] || 0;
  recordNemesisDefeated(nemesisId);
  const durationMs = fightDurationMs(app.runtime.fightTimes && app.runtime.fightTimes[f]);
  recordNemesisAttempt(nemesisId, true, durationMs);
  evaluateAchievements({
    event: 'fightWon',
    nemesisId,
    failedTries,
    durationMs,
    festeFull: app.runtime.hp.feste >= festeStartValue(app.plan)
  });
}

function finalizeLoss() {
  app.runtime.triesPerFight[app.runtime.fightIndex]++;
  recordNemesisAttempt(app.plan.nemesisOrder[app.runtime.fightIndex], false);
  app.runtime.pendingLossCategory = null;
  app.runtime.pendingLossCard = null;
  app.runtime.pendingLossRevealed = false;
  app.runtime.pendingLossBanishSelection = null;
  // Rückkehr zur Übersicht soll immer die Nemesis-Übersicht zeigen, nicht ein aus einer früheren
  // Sitzung noch offenes Kaserne-Panel (showBarracks wird nur explizit über "Zeige Kaserne"
  // gesetzt und blieb sonst über den ganzen Kampf hinweg bestehen).
  app.runtime.showBarracks = false;
  app.runtime.pendingReconfigParty = null;
  app.runtime.pendingReconfigMarketplace = null;
  app.runtime.pendingReconfigTreasures = null;

  // Fallback/Absicherung: der reguläre Weg zur finalen Niederlage läuft seit der Umstellung
  // bereits über triggerFinalDefeat() (direkt beim Niederlage-Klick, vor dem Beute-Flow) — dieser
  // Zweig sollte dadurch normalerweise nicht mehr erreicht werden, bleibt aber als Absicherung
  // bestehen, falls triesPerFight z.B. durch einen anderen Pfad schon bei 2 stand.
  if (app.options.finalDefeat && app.runtime.triesPerFight[app.runtime.fightIndex] >= 3) {
    app.runtime.gameOverNemesisId = app.plan.nemesisOrder[app.runtime.fightIndex];
    // Party-Synergie-Hinweise: finale Niederlage zählt als abgeschlossene Expedition (ohne Sieg).
    recordPartyComboResult(app.runtime.chosenParty, app.plan.playerCount, false);
    saveActiveSlot();
    onExpeditionEndAchievements(false);
    goto('game-over');
    playSfx('game_over');
    return;
  }

  // Expeditionsregeln: ein erneuter Versuch gegen denselben (bereits freigeschalteten) Erzfeind
  // beginnt komplett neu — Feste- und Erzfeind-Zähler zurück auf die Schwierigkeitsgrad-Startwerte,
  // Reihenfolgedeck frisch gemischt. Feste-Zähler wird sonst über die ganze Expedition hinweg
  // fortgeführt (siehe startNewTurnOrderFight()) — nur der Niederlage-Fall ist die Ausnahme.
  app.runtime.hp.feste = clampHp(festeStartValue(app.plan));
  // turnOrder verwerfen statt nur hp.erzfeind zu setzen: ensureTurnOrderFight() erkennt dadurch
  // beim nächsten Kampfstart (gleicher fightIndex) keinen "existing"-Zustand mehr und ruft
  // startNewTurnOrderFight() erneut auf, was Erzfeind-Leben und Deck vollständig neu aufbaut.
  app.runtime.turnOrder = null;
  saveActiveSlot();
  goto('overview');
}

// Macht die Sieg-Entscheidung wieder rückgängig — analog zu undoLossReward(): entfernt die in
// startWinFlow() bereits committeten Beutekarten und Schatzkandidaten wieder aus der Kaserne bzw.
// dem aktiven Marktplatz (ensureCurrentTreasures() für die Schätze läuft erst später in
// confirmWinBanish(), currentTreasures ist an dieser Stelle also noch unberührt) und kehrt zum
// Kampf-Screen zurück. Wird vom "Zurück"-Button auf screen-win-banish aufgerufen (früher
// screen-win-reward, siehe archive/win-reward-screen.html).
function undoWinReward() {
  const rewards = app.runtime.pendingWinRewards;
  if (rewards) {
    Object.values(rewards).forEach((card) => {
      if (!card) return;
      app.runtime.barracks.marketplaceCardIds = app.runtime.barracks.marketplaceCardIds.filter((id) => id !== card.id);
      app.runtime.currentMarketplace = app.runtime.currentMarketplace.filter((id) => id !== card.id);
    });
  }
  const award = app.runtime.pendingTreasureAward;
  if (award) {
    const ids = new Set(award.candidates.map((c) => c.id));
    app.runtime.barracks.treasureIds = app.runtime.barracks.treasureIds.filter((id) => !ids.has(id));
  }
  app.runtime.pendingWinRewards = null;
  app.runtime.pendingWinBanishSelection = null;
  app.runtime.pendingTreasureAward = null;
  app.runtime.pendingWinRewardReveal = null;
  saveActiveSlot();
  playSfx('undo');
  goto('battle');
}

function startWinFlow() {
  app.runtime.pendingWinRewards = drawWinRewards(app.plan, app.runtime);
  Object.values(app.runtime.pendingWinRewards).forEach((card) => {
    if (card) {
      app.runtime.barracks.marketplaceCardIds.push(card.id);
      app.runtime.currentMarketplace.push(card.id);
    }
  });
  app.runtime.pendingWinBanishSelection = { Kristall: null, Relic: null, Zauber: null };

  // Punkt 24: die Schatzkandidaten (falls diese Kampfstufe einen Schatz vergibt) werden bereits
  // hier vollständig deterministisch gezogen — sie werden erst auf der Beute-Vorschau angezeigt
  // und dann auf dem gemergten Marktplatz-&-Schätze-Screen ausgewählt (siehe confirmWinBanish()).
  const f = app.runtime.fightIndex;
  const tier = f + 1;
  app.runtime.pendingTreasureAward = null;
  if (tier <= 3) {
    const candidates = drawTreasureCandidates(app.plan, app.runtime, tier);
    if (candidates.length) {
      const desiredCount = tier === 2 ? 1 : Math.max(1, app.runtime.chosenParty.length);
      const requiredCount = Math.min(desiredCount, candidates.length);
      // Punkt 33: derselbe deterministische "empfohlene" Kandidat wie in plan.js
      // (fight.treasure.recommendedId = candidates[0].id) — hier direkt aus den tatsächlich
      // gezogenen Kandidaten übernommen, damit Story-Prompt und Beute-Reveal-UI garantiert
      // dieselbe Karte als "story-relevant" markieren.
      const recommendedId = candidates.length ? candidates[0].id : null;
      app.runtime.pendingTreasureAward = { tier, candidates, selectedIds: [], requiredCount, recommendedId };
      // Bugfix: analog zu den Marktplatz-Belohnungen oben (und zum Niederlage-Fluss in
      // drawLossRewardNow()) sofort in die Kaserne übernehmen, statt erst in confirmWinBanish().
      // Vorher gingen die Schätze verloren, wenn man den Sieg-Flow verließ (z.B. "Zur Startseite"),
      // bevor man auf dem Ausgleichs-Screen bestätigt hatte — die Marktplatzkarten waren nach einem
      // Reload da, die Schätze nicht. ensureCurrentTreasures() bleibt bewusst in confirmWinBanish(),
      // damit die tatsächliche Auswahl (nicht irgendein Kandidat) die aktiven Slots belegt.
      candidates.forEach((c) => app.runtime.barracks.treasureIds.push(c.id));
    }
  }

  // Beute-Reveal: Zauber/Kristall/Artefakt zeigen ihr "NEU"-Label direkt ohne eigenen
  // Aufdeck-Schritt auf win-banish (siehe renderWinBanish()) — nur die Schätze werden noch
  // gestaffelt aufgedeckt, siehe revealWinRewardTreasure().
  app.runtime.pendingWinRewardReveal = { treasure: false };

  saveActiveSlot();
  goto('win-banish');
}

// Punkt 27/28/32: Versatz zwischen den einzelnen Karten einer gestaffelten Reveal-Gruppe. Muss
// spürbar über der CSS-Flip-Dauer (.flipcard__inner, 0.6s) liegen, damit sich Karte 1 fast fertig
// gedreht hat, bevor Karte 2 sichtbar zu drehen beginnt — kein Überlappen der Animationen mehr.
const WIN_REWARD_REVEAL_STAGGER_MS = 700;

// Schätze (einzige verbliebene Reveal-Gruppe nach dem Ausbau von screen-win-reward, 2026-09-26):
// gemeinsam, aber nacheinander gestaffelt aufdecken (analog zur früheren Beute-Gruppe). Der
// Reveal-Status wird sofort committet, die gestaffelte Flip-Animation läuft rein über CSS
// transition-delay (siehe renderWinBanish()); loot.wav wird nur EINMAL pro Klick abgespielt.
function revealWinRewardTreasure() {
  const reveal = app.runtime.pendingWinRewardReveal;
  if (!reveal || reveal.treasure) return;
  reveal.treasure = true;
  renderScreen();
  playSfx('loot');
}

// Pro Typ (Kristall/Relic/Zauber) genau 1 Karte auswählen (radiobutton-artig):
// entweder eine der bestehenden Karten dieses Typs oder die neu gezogene selbst.
function selectWinBanishCard(subtype, cardId) {
  app.runtime.pendingWinBanishSelection[subtype] = cardId;
  playSfx('navigation_select');
  renderScreen();
}

// Punkt 46: dieselbe Validierungs-Logik/UX wie in der Kaserne (siehe focusBarracksIssue()) —
// bei einer unvollständigen Auswahl wird zur ERSTEN offenen Gruppe (Zauber > Kristall > Artefakt
// > Schätze) gescrollt und diese kurz visuell hervorgehoben (.barracks-group--attention in
// styles.css), statt nur einen Toast ohne weiteren Hinweis zu zeigen.
function focusWinBanishIssue() {
  const sel = app.runtime.pendingWinBanishSelection;
  const subtypes = ['Zauber', 'Kristall', 'Relic'];
  const missingSubtype = subtypes.find((s) => !sel[s]);
  const award = app.runtime.pendingTreasureAward;
  const reveal = app.runtime.pendingWinRewardReveal;
  // Schätze müssen erst aufgedeckt werden, bevor eine Auswahl überhaupt möglich ist (siehe
  // toggleTreasureCandidate()) — daher hier zusätzlich prüfen, sonst würde "Bestätigen" bei
  // noch verdeckten Schätzen fälschlich durchgehen.
  const treasureRevealed = !award || (reveal && reveal.treasure);
  const treasureOk = !award || (treasureRevealed && award.selectedIds.length === award.requiredCount);
  if (!missingSubtype && treasureOk) return true;

  const targetId = missingSubtype ? `winBanishGroup-${missingSubtype}` : 'winBanishGroup-Treasure';
  const targetEl = el(targetId);
  if (targetEl) {
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetEl.classList.add('barracks-group--attention');
    setTimeout(() => targetEl.classList.remove('barracks-group--attention'), 2900);
  }
  showToast(missingSubtype
    ? `Bitte für ${categoryLabel(missingSubtype)} genau 1 Karte auswählen, die in die Kaserne wandert.`
    : (!treasureRevealed ? 'Bitte zuerst die Schätze aufdecken.' : `Bitte genau ${award.requiredCount} Schatz/Schätze auswählen.`));
  return false;
}

function confirmWinBanish() {
  if (!focusWinBanishIssue()) return;

  const sel = app.runtime.pendingWinBanishSelection;
  const subtypes = ['Kristall', 'Relic', 'Zauber'];
  const award = app.runtime.pendingTreasureAward;

  const banishIds = subtypes.map((s) => sel[s]);
  const remaining = app.runtime.currentMarketplace.filter((id) => !banishIds.includes(id));
  if (!marketplaceInvariantOk(remaining)) {
    showToast('Diese Auswahl stellt nicht die Verteilung 4 Zauber / 3 Kristalle / 2 Artefakte wieder her.');
    return;
  }
  playSfx('navigation_forward');
  app.runtime.currentMarketplace = remaining;
  app.runtime.pendingWinBanishSelection = { Kristall: null, Relic: null, Zauber: null };

  // Alle gezogenen Schatzkandidaten (gewaehlte + Rest) sind bereits in startWinFlow() in die
  // Kaserne übernommen worden — hier nur noch die Markierung, welche Karten die Gruppe aktiv
  // gewaehlt hat (fuer den Story-Kontext), plus deren Übernahme in die aktiven Slots.
  if (award) {
    award.selectedIds.forEach((id) => {
      app.runtime.chosenTreasures.push({ fightIndex: app.runtime.fightIndex, tier: award.tier, treasureId: id });
    });
    app.runtime.pendingTreasureAward = null;
    ensureCurrentTreasures(award.selectedIds);
  }

  saveActiveSlot();
  finalizeWin();
}

function toggleTreasureCandidate(cardId) {
  const award = app.runtime.pendingTreasureAward;
  if (!award) return;
  // Schätze müssen erst per "Alle Schätze aufdecken" (revealWinRewardTreasure()) aufgedeckt
  // werden, bevor sie aus-/abgewählt werden können (2026-09-26).
  const reveal = app.runtime.pendingWinRewardReveal;
  if (!reveal || !reveal.treasure) return;
  const idx = award.selectedIds.indexOf(cardId);
  if (idx >= 0) {
    award.selectedIds.splice(idx, 1);
    playSfx('navigation_deselect');
  } else {
    if (award.selectedIds.length >= award.requiredCount) {
      showToast(`Es dürfen genau ${award.requiredCount} Schatz/Schätze ausgewählt werden.`);
      return;
    }
    award.selectedIds.push(cardId);
    playSfx('navigation_select');
  }
  renderScreen();
}

function finalizeWin() {
  const f = app.runtime.fightIndex;
  const tries = (app.runtime.triesPerFight[f] || 0) + 1;
  app.runtime.score += scoreForTries(tries);
  app.runtime.nemesisStatus[f] = 'defeated';
  // Spielzeit-Tracking: zuerst den Timer pausieren (zählt die letzte laufende Spanne noch in
  // accumulatedMs ein), DANN end setzen (siehe freshRuntimeState()) — nur beim tatsächlichen Sieg,
  // nicht bei einer Niederlage (die denselben Kampf komplett neu beginnt, siehe
  // startNewTurnOrderFight()). Muss vor dem Hochzählen von fightIndex weiter unten passieren,
  // sonst würde pauseFightTimer() den falschen (nächsten) Kampf treffen.
  pauseFightTimer();
  if (app.runtime.fightTimes && app.runtime.fightTimes[f]) {
    app.runtime.fightTimes[f].end = Date.now();
  }
  onFightWonAchievements(f);
  app.runtime.pendingWinRewards = null;
  app.runtime.pendingWinRewardReveal = null;
  app.runtime.fightIndex = f + 1;
  if (app.runtime.fightIndex < 4) app.runtime.nemesisStatus[app.runtime.fightIndex] = 'revealed';
  // Rückkehr zur Übersicht soll immer die Nemesis-Übersicht zeigen, nicht ein aus einer früheren
  // Sitzung noch offenes Kaserne-Panel (showBarracks wird nur explizit über "Zeige Kaserne"
  // gesetzt und blieb sonst über den ganzen Kampf hinweg bestehen, inkl. der Beute-/Ausgleichs-
  // Screens nach dem Sieg).
  app.runtime.showBarracks = false;
  app.runtime.pendingReconfigParty = null;
  app.runtime.pendingReconfigMarketplace = null;
  app.runtime.pendingReconfigTreasures = null;
  saveActiveSlot();
  // Punkt 21: der Epilog wurde bereits bei der Einmal-Generierung geschrieben (chapters[4]) —
  // hier ist nach dem letzten Sieg nichts mehr zu generieren, nur noch die Übersicht anzeigen.
  goto('overview');
}

// Punkt 45: der letzte Kampf (Index 3) vergibt laut startWinFlow() (tier <= 3) ohnehin keine
// Beute mehr und braucht daher auch keinen Marktplatzausgleich — "Sieg" führt hier direkt auf
// die separate Siegesseite, statt über den für diesen Kampf leeren Beute-/Ausgleich-Flow.
function finishExpedition() {
  const f = app.runtime.fightIndex;
  const tries = (app.runtime.triesPerFight[f] || 0) + 1;
  app.runtime.score += scoreForTries(tries);
  app.runtime.nemesisStatus[f] = 'defeated';
  // Spielzeit-Tracking: erst pausieren, dann end setzen (siehe finalizeWin() für den identischen
  // Mechanismus bei den ersten drei Kämpfen).
  pauseFightTimer();
  if (app.runtime.fightTimes && app.runtime.fightTimes[f]) {
    app.runtime.fightTimes[f].end = Date.now();
  }
  onFightWonAchievements(f);
  app.runtime.fightIndex = f + 1;
  app.runtime.showBarracks = false;
  app.runtime.pendingReconfigParty = null;
  app.runtime.pendingReconfigMarketplace = null;
  app.runtime.pendingReconfigTreasures = null;
  // Party-Synergie-Hinweise: Expedition gewonnen (letzter Erzfeind besiegt) — zählt als Sieg mit
  // der zu diesem Zeitpunkt aktiven Party (kann durch Kaserne von originalParty abweichen).
  recordPartyComboResult(app.runtime.chosenParty, app.plan.playerCount, true);
  saveActiveSlot();
  onExpeditionEndAchievements(true);
  goto('victory');
  // Der Sound soll erst erklingen, sobald die Siegesseite tatsächlich geladen ist (nicht schon
  // beim Klick auf "Sieg") — goto('victory') rendert renderVictory() synchron, daher reicht es,
  // hier direkt danach abzuspielen (vgl. gleiches Muster in openNextBattle()).
  playSfx('completion');
}

// ---------- Marktplatz-Reconfig ----------

// Punkt 41: umfassendes Sicherheitsnetz (erweitert Punkt 37 von "nur Party" auf Party UND
// Marktplatz UND Schätze) — die Navigation in den nächsten Kampf (Reveal bzw. Wiedereinstieg in
// einen bereits enthüllten Kampf) ist blockiert, solange nicht die aktiven Kaserne-Auswahlen
// exakt den Regeln entsprechen. Greift unabhängig davon, WIE eine ungültige Auswahl entstanden
// ist (z.B. Abwählen in der Kaserne ohne erneutes Bestätigen). Bei Verstoß wird die Kaserne
// geöffnet, zur ERSTEN unvollständigen Gruppe (Party > Marktplatz > Schätze) gescrollt und diese
// kurz visuell hervorgehoben (siehe .barracks-group--attention in styles.css).
function focusBarracksIssue() {
  const playerCount = app.plan.playerCount || app.runtime.chosenParty.length || 4;
  // Punkt 42: solange die Kaserne offen ist, zaehlt die dort sichtbare (noch unbestaetigte)
  // Bearbeitung, nicht der zuletzt bestaetigte Stand — sonst laesst sich die Regelverletzung
  // ("Auswahl unvollstaendig" im Panel) durch Wegscrollen und Klick auf einen Kampf umgehen,
  // ohne dass die Aenderung ueberhaupt via "Kaserne uebernehmen" bestaetigt wurde.
  const effectiveParty = app.runtime.showBarracks && app.runtime.pendingReconfigParty
    ? app.runtime.pendingReconfigParty
    : app.runtime.chosenParty;
  const effectiveMarket = app.runtime.showBarracks && app.runtime.pendingReconfigMarketplace
    ? app.runtime.pendingReconfigMarketplace
    : app.runtime.currentMarketplace;
  const effectiveTreasures = app.runtime.showBarracks && app.runtime.pendingReconfigTreasures
    ? app.runtime.pendingReconfigTreasures
    : app.runtime.currentTreasures;
  const partyOk = effectiveParty.length === playerCount;
  const marketOk = marketplaceInvariantOk(effectiveMarket);
  const treasuresOk = treasuresInvariantOk(effectiveTreasures, app.runtime.barracks.treasureIds, playerCount);
  if (partyOk && marketOk && treasuresOk) return true;

  app.runtime.showBarracks = true;
  renderScreen();

  const targetId = !partyOk ? 'barracksGroupParty' : !marketOk ? 'barracksGroupMarket' : 'barracksGroupTreasures';
  const targetEl = el(targetId);
  if (targetEl) {
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetEl.classList.add('barracks-group--attention');
    setTimeout(() => targetEl.classList.remove('barracks-group--attention'), 2900);
  }
  const missing = !partyOk
    ? `genau ${playerCount} Magier`
    : !marketOk
      ? 'die Verteilung 4/3/2 im Marktplatz'
      : 'die vorgesehene Anzahl je Schatzstufe';
  showToast(`Bitte zuerst in der Kaserne ${missing} aktiv halten, bevor du in den nächsten Kampf ziehst.`);
  return false;
}

// Erzfeind-Kachel, 1. Klick: nur enthüllen (Name/Wave sichtbar machen), noch keine Navigation.
// Monster-spezifische Reveal-Sounds folgen in einer späteren Erweiterung — bewusst noch offen.
function revealNemesisTile() {
  if (!focusBarracksIssue()) return;
  const f = app.runtime.fightIndex;
  app.runtime.nemesisRevealedOnce[f] = true;
  saveActiveSlot();
  playNemesisRevealSfx(app.plan.nemesisOrder[f]);
  renderOverview();
}

function openNextBattle() {
  if (!focusBarracksIssue()) return;

  // Punkt 21: alle Kapitel liegen bereits aus der Einmal-Generierung vor — hier wird nichts
  // mehr generiert. Punkt 44: der frühere separate "Marktplatz vor dem nächsten Kampf"-
  // Zwischenschritt ist entfallen — die Kaserne (inkl. Marktplatz) wird bereits laufend dort
  // gepflegt (siehe syncBarracksIfValid()) und von focusBarracksIssue() vor jedem Kampf
  // verbindlich geprüft, ein zusätzlicher Anpassungsscreen wäre redundant.
  const f = app.runtime.fightIndex;
  app.runtime.nemesisRevealedOnce[f] = true;

  // Wurde eine Erzählung generiert, sitzt vor dem Kampf-Detail-Screen jetzt der Story-Screen
  // mit dem Kapiteltext zu diesem Erzfeind (siehe screen-story in index.html/renderStory()) —
  // "Kampf starten" dort führt erst zu goto('battle') + start_battle-Sound. Ohne Erzählung
  // (storyDisabled, oder kein Kapitel vorhanden) bleibt der bisherige direkte Sprung.
  const chapter = app.runtime.chapters[f];
  if (!app.runtime.storyDisabled && chapter) {
    goto('story');
    return;
  }
  goto('battle');
  // Der Sound soll erst erklingen, sobald die Kampf-Detail-Seite tatsächlich geladen ist
  // (nicht schon beim Klick auf die Erzfeind-Kachel, der bei einer ungültigen Kaserne-Auswahl
  // gar nicht mehr zum Kampf führt) — goto('battle') rendert renderBattle() synchron, daher
  // reicht es, hier direkt danach abzuspielen.
  playSfx('start_battle');
}

// Verhindert Mehrfachauswahl über die 4/3/2-Zielgrenze je Subtyp hinaus: eine noch nicht
// aktive Karte lässt sich erst (an)wählen, wenn zuvor eine andere Karte desselben Subtyps
// wieder abgewählt wurde. Aktive Karten bleiben davon unberührt abwählbar. Wird ausschließlich
// von der Kaserne (Marktplatz-Gruppe) genutzt — der frühere separate Vor-dem-Kampf-Reconfig-
// Screen ist entfallen (Punkt 44).
function reconfigToggleCard(cardId) {
  const list = app.runtime.pendingReconfigMarketplace;
  const idx = list.indexOf(cardId);
  if (idx >= 0) {
    list.splice(idx, 1);
    playSfx('navigation_deselect');
  } else {
    const card = marketplaceCardById(cardId);
    const target = card && MARKETPLACE_TARGET[card.subtype];
    if (target !== undefined) {
      const activeOfSubtype = list.map(marketplaceCardById).filter((c) => c && c.subtype === card.subtype).length;
      if (activeOfSubtype >= target) {
        showToast(`Erst eine ${card.subtype}-Karte abwählen (max. ${target}).`);
        return;
      }
    }
    list.push(cardId);
    playSfx('navigation_select');
  }
  syncBarracksIfValid();
  renderScreen();
}

// ---------- Navigation ----------

function goto(step) {
  // Spielzeit-Tracking (siehe freshRuntimeState()): Timer pausieren, wenn der Kampf-Screen
  // verlassen wird, und fortsetzen, wenn er betreten wird — so wird NUR aktiv im Kampf-Screen
  // verbrachte Zeit gezählt (Bugfix 2026-10-05, siehe pauseFightTimer()/resumeFightTimer()).
  if (app.step === 'battle' && step !== 'battle') pauseFightTimer();
  app.step = step;
  renderScreen();
  if (app.step === 'battle') resumeFightTimer();
  // Jeder Screenwechsel soll oben beginnen, statt die Scroll-Position der vorherigen Ansicht
  // (die ggf. deutlich länger war, z.B. nach langem Kapiteltext) beizubehalten.
  window.scrollTo(0, 0);
}

// Kein confirm() mehr: der Fortschritt ist über saveActiveSlot() bereits laufend persistiert
// (siehe die zahlreichen Aufrufe im gesamten Spielfluss), daher besteht beim Verlassen kein
// tatsächliches Verlustrisiko — die Warnmeldung war rein redundant.
function backToHome() {
  // Spielzeit-Tracking: hier VOR dem Verwerfen von app.runtime pausieren (goto() allein würde das
  // zu spät tun, da runtime schon null wäre) und sichern, sonst ginge die laufende Zeit verloren.
  pauseFightTimer();
  if (app.runtime) saveActiveSlot();
  app.plan = null;
  app.runtime = null;
  playSfx('back_to_start');
  goto('home');
}

// ---------- Rendering: Home ----------

// Zentrale Regel für die Max-3-Sperre: solange 3 Expeditionen gespeichert sind, darf keine
// vierte angelegt werden (weder "Neue Expedition" auf der Startseite noch von der Siegesseite
// aus) — der Nutzer muss vorher eine bestehende löschen. Ersetzt die frühere stille FIFO-
// Verdrängung des ältesten Slots.
function canCreateNewExpedition() {
  return loadSlots().length < MAX_SLOTS;
}

// Überarbeitete Max-3-Regel (Nutzer-Vorgabe 2026-09-26): sind bereits 3 Expeditionen gespeichert,
// aber die AKTUELL geladene Expedition ist bereits abgeschlossen (Sieg -> screen-victory ODER
// finale Niederlage -> screen-game-over), darf trotzdem eine neue Expedition gestartet werden —
// die abgeschlossene wird dafür einfach gelöscht/überschrieben. Nur betroffen sind die beiden
// "Neue Expedition starten"-Buttons auf genau diesen beiden Abschluss-Screens (NICHT der
// Startseiten-Button, der keine "aktuelle" Expedition hat, die man opfern könnte).
function isCurrentExpeditionCompleted() {
  return !!app.plan && (app.step === 'victory' || app.step === 'game-over');
}

function startNewExpeditionFromCompletion() {
  if (!canCreateNewExpedition()) {
    if (!isCurrentExpeditionCompleted()) return;
    // Aktuelle (bereits abgeschlossene) Expedition löschen, um Platz für die neue zu schaffen.
    const slots = loadSlots().filter((s) => s.id !== app.plan.id);
    saveSlots(slots);
  }
  goto('new-expedition');
}

// Setzt disabled-Zustand + Hinweistext auf allen drei "Neue Expedition"-Buttons (Startseite,
// Siegesseite, Game-Over-Screen), abhängig von canCreateNewExpedition(). Wird nach jeder
// Slot-Änderung aufgerufen (renderHome, deleteSlot, renderScreen-Dispatch), damit der Zustand
// immer aktuell ist.
// Ausnahme (Nutzer-Vorgabe 2026-09-26, siehe startNewExpeditionFromCompletion()): auf der
// Siegesseite/Game-Over-Screen bleibt der Button auch bei erreichtem Limit aktiv, wenn die
// aktuell geladene Expedition selbst bereits abgeschlossen ist — sie wird beim Klick einfach
// gelöscht/überschrieben, statt den Nutzer zu blockieren.
function updateNewExpeditionAvailability() {
  const atLimit = !canCreateNewExpedition();
  const hint = 'Du hast bereits 3 Expeditionen gespeichert. Lösche zuerst eine bestehende Kampagne, um eine neue zu starten.';
  const homeBtn = el('btnNewExpedition');
  if (homeBtn) {
    homeBtn.disabled = atLimit;
    homeBtn.title = atLimit ? hint : '';
  }
  const canOverwrite = atLimit && isCurrentExpeditionCompleted();
  [el('btnVictoryNewExpedition'), el('btnGameOverNewExpedition')].forEach((btn) => {
    if (!btn) return;
    btn.disabled = atLimit && !canOverwrite;
    btn.title = atLimit && !canOverwrite ? hint : '';
  });
  const limitHint = el('newExpeditionLimitHint');
  if (limitHint) limitHint.hidden = !atLimit;
}

function renderHome() {
  const slots = loadSlots().slice().reverse();
  const list = el('savedExpeditions');
  list.innerHTML = slots.length ? '' : '<p class="panel__hint">Noch keine gespeicherte Expedition.</p>';
  slots.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'expedition-row';
    const score = s.state.runtime.score || 0;
    const date = new Date(s.savedAt).toLocaleString('de-DE');
    row.innerHTML = `
      <div class="expedition-row__main">
        <div class="expedition-row__name">${escapeHtml(s.name || '(ohne Namen)')}</div>
        <div class="expedition-row__meta">Seed: ${escapeHtml(s.seed)} · ${escapeHtml(playerCountLabel(s.state.plan))} · Score: ${score} · zuletzt gespeichert: ${escapeHtml(date)}</div>
      </div>
      <div class="expedition-row__actions">
        <button class="btn btn--ghost btn--small" data-action="delete">Löschen</button>
        <button class="btn btn--primary btn--small" data-action="load">Laden</button>
      </div>`;
    row.querySelector('[data-action="load"]').onclick = () => { playSfx('create_expedition'); loadSlotById(s.id); };
    row.querySelector('[data-action="delete"]').onclick = () => { if (confirm('Diese Expedition löschen?')) { deleteSlot(s.id); playSfx('delete'); updateNewExpeditionAvailability(); } };
    list.appendChild(row);
  });
  updateNewExpeditionAvailability();
}

// Expeditions-Chronik: leere Grundstruktur (Panels ohne Inhalt), siehe FEATURE_WISHLIST.md >
// Statistik-Seite. Rendert aktuell nur statische Platzhalter — die drei Panels
// (Errungenschaften/Bestleistungen/Erzfeind-Bilanz) werden Feature für Feature befüllt,
// sobald app.stats entsprechende Daten enthält.
function renderChronicle() {
  renderHighscores();
  renderAchievements();
  renderNemesisRanking();
}

// Ampel aus der Siegquote (Versuchsebene): niedrige Quote = schwerer Erzfeind.
function nemesisDifficultyLevel(rate) {
  if (rate < 0.4) return { key: 'hard', label: 'Schwer' };
  if (rate < 0.7) return { key: 'mid', label: 'Mittel' };
  return { key: 'easy', label: 'Leicht' };
}

// Mindestanzahl an Versuchen (Siege + Niederlagen), ab der die Ampel eines Erzfeindes als
// aussagekräftig gilt — z. B. für die Anzeige auf der Erzfeind-Kachel der Übersicht.
const NEMESIS_LAMP_MIN_ATTEMPTS = 5;

// Kleine Ampel-Anzeige für die Erzfeind-Kachel; leerer String, solange zu wenige Versuche vorliegen.
function nemesisLampHtml(nemesisId) {
  const s = app.stats.nemesisStats[nemesisId];
  if (!s) return '';
  const total = s.wins + s.losses;
  if (total < NEMESIS_LAMP_MIN_ATTEMPTS) return '';
  const rate = s.wins / total;
  const lvl = nemesisDifficultyLevel(rate);
  return `<div class="nemesis-lamp nemesis-lamp--${lvl.key}" title="${s.wins} Siege · ${s.losses} Niederlagen">
    <span class="nemesis-lamp__dot"></span>
    <span class="nemesis-lamp__label">${lvl.label}</span>
    <span class="nemesis-lamp__meta">Siegquote ${Math.round(rate * 100)} % · ${total} Versuche</span>
  </div>`;
}

// Erzfeind-Ranking: alle Erzfeinde mit Bilanz, schwerste (niedrigste Siegquote) zuerst, danach
// noch nicht gespielte (nach Basis-Schwierigkeit). Rein lesend aus app.stats.nemesisStats.
function renderNemesisRanking() {
  const list = el('nemesisRankingList');
  const summary = el('nemesisRankingSummary');
  if (!list) return;
  const rows = AEONS_DATA.nemeses.map((n) => {
    const s = app.stats.nemesisStats[n.id] || { wins: 0, losses: 0, totalWinDurationMs: 0, timedWins: 0 };
    const total = s.wins + s.losses;
    return { n, s, total, rate: total ? s.wins / total : null,
      avgMs: s.timedWins ? s.totalWinDurationMs / s.timedWins : null };
  });
  rows.sort((a, b) => {
    if ((a.rate === null) !== (b.rate === null)) return a.rate === null ? 1 : -1;
    if (a.rate !== null && a.rate !== b.rate) return a.rate - b.rate;
    if (a.total !== b.total) return b.total - a.total;
    return b.n.difficulty - a.n.difficulty;
  });
  const played = rows.filter((r) => r.total).length;
  if (summary) summary.textContent = `${played} / ${rows.length} gespielt`;
  list.innerHTML = rows.map((r, i) => {
    // Ampel erst ab NEMESIS_LAMP_MIN_ATTEMPTS Versuchen (analog Erzfeind-Kachel); davor "Offen".
    // 'none' = noch nie gespielt (Zeile gedimmt), 'open' = Daten vorhanden, aber zu wenige für die Ampel.
    const lvl = r.total === 0 ? { key: 'none', label: 'Offen' }
      : (r.total < NEMESIS_LAMP_MIN_ATTEMPTS ? { key: 'open', label: 'Offen' } : nemesisDifficultyLevel(r.rate));
    const pct = r.rate === null ? null : Math.round(r.rate * 100);
    const winW = r.total ? (r.s.wins / r.total) * 100 : 0;
    const exp = AEONS_DATA.expansions[r.n.expansion];
    return `
      <div class="nrank__row nrank__row--${lvl.key}">
        <div class="nrank__pos">${i + 1}</div>
        <div class="nrank__name">
          <span class="nrank__title">${escapeHtml(r.n.name)}</span>
          <span class="nrank__sub">${escapeHtml(exp ? exp.name : r.n.expansion)} · Stufe ${r.n.difficulty}</span>
        </div>
        <div class="nrank__bar" title="${r.s.wins} Siege · ${r.s.losses} Niederlagen">
          <div class="nrank__track">${r.total ? `<div class="nrank__win" style="width:${winW}%"></div>` : ''}</div>
          <div class="nrank__label">${r.total ? `${r.s.wins} S · ${r.s.losses} N · ${pct} %` : 'Noch nicht gespielt'}</div>
        </div>
        <div class="nrank__time"><span class="nrank__time-val">${r.avgMs ? formatDurationMs(r.avgMs) : '–'}</span><span class="nrank__time-lbl">Ø Dauer</span></div>
        <div class="nrank__lamp"><span class="nrank__dot"></span><span class="nrank__lamp-lbl">${lvl.label}</span></div>
      </div>`;
  }).join('');
}

function renderOptions() {
  const groupsEl = el('optionsExpansionGroups');
  groupsEl.innerHTML = '';
  const all = Object.values(AEONS_DATA.expansions);
  const waves = [...new Set(all.map((e) => e.wave))].sort((a, b) => a - b);

  const makeChip = (exp, listKey, invert) => {
    const chip = document.createElement('div');
    const active = invert ? !app.options[listKey].includes(exp.code) : app.options[listKey].includes(exp.code);
    chip.className = 'chip' + (active ? ' selected' : '');
    chip.textContent = exp.name;
    chip.onclick = () => {
      const list = app.options[listKey];
      const i = list.indexOf(exp.code);
      if (invert) {
        // Für Ausschluss-Listen: Klick togglet Mitgliedschaft in der Exclude-Liste
        if (i >= 0) { list.splice(i, 1); playSfx('navigation_select'); } else { list.push(exp.code); playSfx('navigation_deselect'); }
      } else {
        if (i >= 0) { list.splice(i, 1); playSfx('navigation_deselect'); } else { list.push(exp.code); playSfx('navigation_select'); }
      }
      saveOptions();
      renderOptions();
    };
    bindHoverSfx(chip);
    return chip;
  };

  waves.forEach((wave) => {
    const inWave = all.filter((e) => e.wave === wave);
    const label = document.createElement('h3');
    label.className = 'group-label';
    label.textContent = wave === 0 ? 'Sonstiges' : `Welle ${wave}`;
    groupsEl.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'chipgrid';
    inWave.forEach((exp) => grid.appendChild(makeChip(exp, 'selectedExpansions', false)));
    groupsEl.appendChild(grid);
  });

  renderMarketSetups();
  renderMageTiers();
  renderTurnOrderRuleOptions();
  renderTabletModeOption();
  renderFinalDefeatOption();
}

// ---------- Rendering: Optionen — Magier-Tier-Liste ----------
// Rein informelles Rating als Einschätzungshilfe bei der Charakterauswahl (renderBuildParty()) —
// per Drag & Drop änderbar, persistiert in app.options.mageTiers. Keine Spiellogik hängt daran.
const MAGE_TIER_ORDER = ['S', 'A', 'B', 'C', 'D'];

// Drag&Drop läuft über den gemeinsamen beginPointerDrag()-Helfer (siehe Kopf der Datei) statt
// nativem HTML5 Drag&Drop — Safari auf dem iPad liefert bei Touch-Interaktion mit draggable-
// Elementen kein zuverlässiges dragstart-Event, Pointer Events funktionieren dagegen einheitlich
// für Maus UND Touch. Siehe auch bindDeckOverlayInteractions() weiter unten, die denselben Helfer
// nutzt.
function renderMageTiers() {
  const board = el('optionsMageTiers');
  board.innerHTML = '';

  const zones = {};
  MAGE_TIER_ORDER.forEach((tier) => {
    const row = document.createElement('div');
    row.className = `tierrow tierrow--${tier}`;
    const label = document.createElement('div');
    label.className = 'tierrow__label';
    label.textContent = tier;
    const drop = document.createElement('div');
    drop.className = 'tierrow__drop';
    drop.dataset.tier = tier;
    row.appendChild(label);
    row.appendChild(drop);
    board.appendChild(row);
    zones[tier] = drop;
  });

  function clearDragoverHighlight() {
    board.querySelectorAll('.tierrow__drop.is-dragover').forEach((z) => z.classList.remove('is-dragover'));
  }

  function zoneUnderPoint(x, y) {
    // Der Chip selbst hat während des Drags pointer-events:none (siehe beginPointerDrag()), daher
    // liefert elementFromPoint zuverlässig die darunterliegende Drop-Zone statt des Chips.
    const under = document.elementFromPoint(x, y);
    return under && under.closest('.tierrow__drop');
  }

  AEONS_DATA.mages.forEach((m) => {
    const tier = getMageTier(m.id) || 'D';
    const chip = document.createElement('div');
    chip.className = 'chip chip--tier';
    chip.dataset.id = m.id;
    chip.dataset.tier = tier;
    chip.innerHTML = `<span class="chip__tier chip__tier--${tier}">${tier}</span><span class="chip__name">${escapeHtml(m.name)}</span><span class="chip__sub">${escapeHtml(m.title || m.expansion)}</span>`;
    chip.addEventListener('pointerdown', (e) => {
      beginPointerDrag(chip, e, {
        onMove: (ev) => {
          clearDragoverHighlight();
          const zone = zoneUnderPoint(ev.clientX, ev.clientY);
          if (zone) zone.classList.add('is-dragover');
        },
        onEnd: (ev) => {
          clearDragoverHighlight();
          const zone = zoneUnderPoint(ev.clientX, ev.clientY);
          if (zone) {
            const newTier = zone.dataset.tier;
            app.options.mageTiers[m.id] = newTier;
            saveOptions();
            chip.dataset.tier = newTier;
            const badge = chip.querySelector('.chip__tier');
            badge.className = `chip__tier chip__tier--${newTier}`;
            badge.textContent = newTier;
            zone.appendChild(chip);
          }
        },
      });
    });
    (zones[tier] || zones.D).appendChild(chip);
  });
}

// ---------- Rendering: Optionen — Marktplatz-Setup ----------
// Zeigt die vordefinierten Marktplatz-Setups (1:1 aus dem Original-Randomizer, siehe data.js
// AEONS_DATA.marketSetups) als Checkbox-Zeile mit 9 farbigen Constraint-Chips. Mehrere Setups
// können gleichzeitig aktiv sein; welches davon pro Expedition tatsächlich verwendet wird,
// entscheidet generateExpeditionPlan() deterministisch über den Seed (siehe plan.js,
// pickActiveMarketSetup — Vereinfachung ggü. dem manuellen Picker im Original, siehe Fazit).
function renderMarketSetups() {
  const container = el('optionsMarketSetups');
  container.innerHTML = '';

  const legend = document.createElement('div');
  legend.className = 'setup-legend';
  legend.innerHTML = `
    <span><span class="setup-legend__dot setup-legend__dot--kristall"></span>Kristall</span>
    <span><span class="setup-legend__dot setup-legend__dot--relic"></span>Artefakt</span>
    <span><span class="setup-legend__dot setup-legend__dot--zauber"></span>Zauber</span>`;
  container.appendChild(legend);

  const setups = (AEONS_DATA.marketSetups || []).filter((s) => !s.hidden);
  setups.forEach((setup) => {
    const active = app.options.activeMarketSetupIds.includes(setup.id);
    const row = document.createElement('div');
    row.className = 'setup-row' + (active ? '' : ' setup-row--inactive');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'setup-row__checkbox';
    checkbox.checked = active;
    checkbox.title = 'Setup aktivieren/deaktivieren';
    checkbox.onchange = () => {
      const list = app.options.activeMarketSetupIds;
      const i = list.indexOf(setup.id);
      if (i >= 0) { list.splice(i, 1); playSfx('navigation_deselect'); }
      else { list.push(setup.id); playSfx('navigation_select'); }
      saveOptions();
      renderMarketSetups();
    };

    const body = document.createElement('div');
    body.className = 'setup-row__body';
    const name = document.createElement('div');
    name.className = 'setup-row__name';
    name.textContent = setup.name;
    const tiles = document.createElement('ul');
    tiles.className = 'setup-tiles';
    setup.tiles.forEach((tile) => {
      const li = document.createElement('li');
      li.className = 'setup-tile setup-tile--' + tile.subtype.toLowerCase();
      li.textContent = marketSetupTileLabel(tile);
      tiles.appendChild(li);
    });
    body.appendChild(name);
    body.appendChild(tiles);

    row.appendChild(checkbox);
    row.appendChild(body);
    container.appendChild(row);
  });
}

// ---------- Rendering: Neue Expedition ----------

function todayDateString() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function renderNewExpedition() {
  el('newExpeditionName').value = todayDateString();
  el('newExpeditionSeed').value = '';
  // Default ist "4 Spieler: einfaches Spiel" (Nutzer-Vorgabe) — siehe auch das
  // "selected"-Attribut der Option in index.html.
  const playerCountSelect = el('newExpeditionPlayerCount');
  if (playerCountSelect) playerCountSelect.value = '4-easy';
  const difficultySelect = el('newExpeditionDifficulty');
  if (difficultySelect) difficultySelect.value = 'leicht';

  const select = el('newExpeditionMarketSetup');
  if (select) {
    const activeSetups = (AEONS_DATA.marketSetups || []).filter(
      (s) => !s.hidden && app.options.activeMarketSetupIds.includes(s.id)
    );
    select.innerHTML = activeSetups
      .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`)
      .join('');
    if (!activeSetups.length) {
      select.innerHTML = '<option value="">(kein Setup aktiv — Zufalls-Setup wird verwendet)</option>';
    }
  }
}

// Anzeige-Text für die bei der Kampagnenerstellung gewählte Spieleranzahl — wird überall gezeigt,
// wo bisher der Seed stand (Party-Aufbau, Übersicht, Home-Liste), damit die Wahl jederzeit
// erkennbar bleibt. "easyMode" (Option "4 Spieler: einfaches Spiel") ist dabei rein informativ —
// keine eigene Spiellogik, siehe generateExpeditionPlan()/createExpedition().
function playerCountLabel(plan) {
  const count = plan.playerCount || 4;
  return plan.easyMode ? `${count} Spieler (einfaches Spiel)` : `${count} Spieler`;
}

function createExpedition() {
  // Sicherheitsnetz: die Max-3-Sperre greift bereits an den Einstiegspunkten (btnNewExpedition,
  // btnVictoryNewExpedition), hier trotzdem nochmal geprüft, falls der Screen anders erreicht wurde.
  if (!canCreateNewExpedition()) {
    showToast('Du hast bereits 3 Expeditionen gespeichert. Lösche zuerst eine bestehende Kampagne.');
    goto('home');
    return;
  }
  const name = el('newExpeditionName').value.trim() || todayDateString();
  const seedInput = el('newExpeditionSeed').value.trim();
  const setupSelect = el('newExpeditionMarketSetup');
  const marketSetupId = setupSelect ? setupSelect.value : '';
  // Punkt 26: Spieleranzahl ist Pflichtfeld (Default 4) — steuert Magier-Vorschläge
  // (Spieleranzahl + 1) sowie die spätere geforderte Party-Größe.
  // "4-easy" = Variante "4 Spieler: einfaches Spiel": zählt für ALLE Validierungen (Party-Größe,
  // Magier-Vorschläge, Schatz-Ziele) UND für den Nemesis-A/V-Kartenaufbau exakt wie die normale
  // Option "4" (keine eigene Spiellogik) — easyMode ist nur eine informative Markierung der
  // Expedition (siehe playerCountLabel()).
  const playerCountSelect = el('newExpeditionPlayerCount');
  const playerCountRaw = playerCountSelect ? playerCountSelect.value : '4';
  const easyMode = playerCountRaw === '4-easy';
  const playerCount = easyMode ? 4 : Number(playerCountRaw);
  // Neue, von der Spieleranzahl-Option losgelöste Schwierigkeit ("Leicht"/"Normal") — steuert
  // ausschließlich die Start-Werte der Feste-/Erzfeind-Zähler, siehe festeStartValue()/
  // nemesisStartHealth() weiter unten und freshRuntimeState()/startNewTurnOrderFight().
  const difficultySelect = el('newExpeditionDifficulty');
  const difficulty = !difficultySelect || difficultySelect.value === 'leicht' ? 'leicht' : 'normal';
  const plan = generateExpeditionPlan({
    name,
    seed: seedInput,
    selectedExpansions: app.options.selectedExpansions,
    activeMarketSetupIds: app.options.activeMarketSetupIds,
    marketSetupId,
    playerCount,
    easyMode,
    difficulty
  });
  app.plan = plan;
  app.runtime = freshRuntimeState();
  app.runtime.hp.feste = festeStartValue(plan);
  app.runtime.currentMarketplace = plan.initialMarketplace.slice();
  app.runtime.barracks.marketplaceCardIds = plan.initialMarketplace.slice();
  // Errungenschaften "Hartnäckig": Expedition wurde direkt nach einer finalen Niederlage gestartet.
  app.runtime.followsDefeat = app.stats.counters.lastResult === 'lost';
  saveActiveSlot();
  evaluateAchievements({ event: 'state' }); // Start-Marktplatz zählt als aktiv
  playSfx('create_expedition');
  goto('build-party');
}

// ---------- Rendering: Aufbau 3a/3b/3c ----------

function renderBuildParty() {
  renderBuildProgress('build-party');
  el('buildPartySeed').textContent = `Seed: ${app.plan.seed} · ${playerCountLabel(app.plan)}`;
  // Punkt 26: es muss GENAU die bei der Kampagnenerstellung festgelegte Spieleranzahl an
  // Magiern gewählt werden (nicht mehr "bis zu 4").
  const target = app.plan.playerCount || 4;
  const mEl = el('buildPartyChoices');
  mEl.innerHTML = '';
  app.plan.mageProposals.map(mageByIdPlan).forEach((m) => {
    const card = document.createElement('div');
    const selected = app.runtime.chosenParty.includes(m.id);
    const disabled = !selected && app.runtime.chosenParty.length >= target;
    card.className = ['card', 'card--mage', selected ? 'selected' : '', disabled ? 'disabled' : ''].filter(Boolean).join(' ');
    card.style.cssText = cardAccentStyle('Magier');
    // Lange Kartenkomponente (analog Zauber/Kristall/Relic) inkl. Tier-Rating als reine
    // Einschätzungshilfe bei der Charakterauswahl (aus den Optionen, keine Spiellogik daran
    // gebunden — siehe getMageTier()).
    card.innerHTML = mageCardHtml(m);
    card.onclick = () => {
      if (selected) { app.runtime.chosenParty = app.runtime.chosenParty.filter((id) => id !== m.id); playSfx('navigation_deselect'); }
      else if (app.runtime.chosenParty.length < target) { app.runtime.chosenParty.push(m.id); playSfx('navigation_select'); }
      saveActiveSlot();
      renderBuildParty();
    };
    bindHoverSfx(card);
    mEl.appendChild(card);
  });
  el('buildPartyCount').textContent = `${app.runtime.chosenParty.length} / ${target}`;
  el('buildPartyHint').textContent = `Wähle genau ${target} Magier für deine Gruppe.`;
  el('btnBuildPartyNext').disabled = app.runtime.chosenParty.length !== target;
  renderPartySynergyHint(target);
}

// Party-Synergie-Hinweise (siehe FEATURE_WISHLIST.md): sobald die valide Party-Größe erreicht
// ist, Siegwahrscheinlichkeit dieser exakten Magier-Kombination (Set + Spieleranzahl) aus
// app.stats.partyCombos anzeigen — oder den Hinweis, dass die Kombination neu ist.
function renderPartySynergyHint(target) {
  const hintEl = el('buildPartySynergyHint');
  if (app.runtime.chosenParty.length !== target) {
    hintEl.hidden = true;
    return;
  }
  const key = partyComboKey(app.runtime.chosenParty, target);
  const entry = app.stats.partyCombos[key];
  if (!entry || !entry.total) {
    hintEl.className = 'synergy-hint synergy-hint--new';
    hintEl.innerHTML = '<div class="synergy-hint__title">Neue Kombination</div><div class="synergy-hint__text">Diese Magierkombination hast du noch nie gespielt.</div>';
  } else {
    const pct = Math.round((entry.wins / entry.total) * 100);
    const tone = pct >= 70 ? 'good' : (pct >= 40 ? 'mid' : 'bad');
    hintEl.className = `synergy-hint synergy-hint--${tone}`;
    hintEl.innerHTML = `<div class="synergy-hint__title">Siegwahrscheinlichkeit: ${pct} %</div><div class="synergy-hint__text">${entry.wins} von ${entry.total} Expeditionen mit dieser Kombination gewonnen.</div>`;
  }
  hintEl.hidden = false;
}

// Punkt 26: bestätigt die Charakterauswahl und merkt sich die ursprüngliche Party als
// originalParty — Grundlage für den späteren Magier-Pool in der Kaserne (originalParty ∪
// barracks.mageIds), aus dem die aktive Party dort frei zusammengestellt werden kann.
function confirmBuildParty() {
  const target = app.plan.playerCount || 4;
  if (app.runtime.chosenParty.length !== target) {
    showToast(`Bitte genau ${target} Magier auswählen.`);
    return;
  }
  app.runtime.originalParty = app.runtime.chosenParty.slice();
  trackPlayedMages();
  saveActiveSlot();
  evaluateAchievements({ event: 'state' });
  playSfx('navigation_forward');
  goto('build-market');
}

// Farb-/Symbol-Zuordnung für die große Karten-Darstellung (Punkt 3/5/6). Ein Kartentyp bekommt
// über Inline-Style zwei CSS-Variablen (--accent/--accent-dim) gesetzt, die von .card in
// styles.css konsumiert werden — so bleiben Marktplatz-, Schatz- und Nemesis-Karten farblich
// konsistent, ohne dutzende Modifier-Klassen zu benötigen.
const CARD_TYPE_COLOR_VARS = {
  Zauber: ['--color-zauber', '--color-zauber-dim'],
  Kristall: ['--color-kristall', '--color-kristall-dim'],
  Relic: ['--color-relic', '--color-relic-dim'],
  'schatz-1': ['--color-schatz-1', '--color-schatz-1-dim'],
  'schatz-1-shard': ['--color-schatz-1-shard', '--color-schatz-1-shard-dim'],
  'schatz-1-spell': ['--color-schatz-1-spell', '--color-schatz-1-spell-dim'],
  'schatz-2': ['--color-schatz-2', '--color-schatz-2-dim'],
  'schatz-3': ['--color-schatz-3', '--color-schatz-3-dim'],
  Angriff: ['--color-angriff', '--color-angriff-dim'],
  Plan: ['--color-plan', '--color-plan-dim'],
  Monster: ['--color-monster', '--color-monster-dim'],
  Magier: ['--color-magier', '--color-magier-dim']
};
// Bug-Fix (iPad, 2026-09-25): Hintergrund-Symbole waren bisher Unicode-Textzeichen (✦◆❖★▲◐●).
// Diese Zeichen existieren in keiner unserer Web-Fonts (--serif-display) — der Browser weicht daher
// pro Zeichen auf eine System-Symbolschrift aus, und macOS/iPadOS Safari nutzen dafür UNTERSCHIEDLICHE
// Symbolschriften mit unterschiedlichen Glyphen-Metriken. Das führte dazu, dass z.B. Kristall auf dem
// iPad viel zu groß und der Stern (Schatz) oben abgeschnitten war, obwohl beide am Desktop korrekt
// aussahen — ein reiner Font-Stack-Fix (z.B. 'Apple Symbols' voranstellen) blieb geräteabhängig instabil.
// (Zwischenlösung war CSS-clip-path; inzwischen abgelöst durch Inline-SVG, siehe CARD_TYPE_ICON_SVG unten.) Lösung: reine Formen statt Text-Glyphen —
// dieselbe Bounding-Box (96×96px) für jeden Typ, plattformunabhängig pixelgleich groß/positioniert.
// Symbol-Update (released aus card-component-preview.html, 2026-09-25, AC „Karten-Symbole"):
// - Relic/Artefakt: octagon → shield (Achteck war eine volle Fläche und dadurch kaum als „❖"
//   erkennbar; Schild-Umriss ist das klassische Relikt-/Artefakt-Symbol).
// - Magier: hex → triangle-down (◈ ist jetzt dem Kristall zugeordnet, s.u.; ▽ steht für Magier).
const CARD_TYPE_ICON_SVG = {
  Zauber: '<path d="M4 5c3-1.5 6-1.5 8 0v14c-2-1.5-5-1.5-8 0Z"/><path d="M20 5c-3-1.5-6-1.5-8 0v14c2-1.5 5-1.5 8 0Z"/><path d="M12 9l1.3 2.6L16 12l-2.7.4L12 15l-1.3-2.6L8 12l2.7-.4Z"/>',
  Kristall: '<path d="M4 9l4-6h8l4 6-8 11Z"/><path d="M4 9h16"/><path d="M9 3l1.5 6L12 20"/><path d="M15 3l-1.5 6L12 20"/>',
  Relic: '<path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6l-8-3Z"/>',
  // Schätze: Symbol wächst mit der Stufe — I Rissscherbe, II Augen-Amulett, III Riss-Krone.
  'schatz-1': '<path d="M12 2.5 17.5 8.5 15.5 17 12 21.5 7.5 15 6.5 8Z"/><path d="M12 2.5 11 9.5 15.5 17"/><path d="M11 9.5 6.5 8"/>',
  'schatz-2': '<path d="M8.5 2.5 12 7.5l3.5-5"/><circle cx="12" cy="14.5" r="6.5"/><path d="M7.2 14.5c1.3-2.2 2.9-3.3 4.8-3.3s3.5 1.1 4.8 3.3c-1.3 2.2-2.9 3.3-4.8 3.3s-3.5-1.1-4.8-3.3Z"/><circle cx="12" cy="14.5" r="1.3"/>',
  'schatz-3': '<path d="M5 19 4.5 9.5 9 13l3-6.5 3 6.5 4.5-3.5L19 19Z"/><path d="M5 21.5h14"/><circle cx="4.5" cy="7.5" r="1"/><circle cx="12" cy="4" r="1"/><circle cx="19.5" cy="7.5" r="1"/><path d="M12 14l1.4 1.8-1.4 1.8-1.4-1.8Z"/>',
  Magier: '<g transform="rotate(30 12 12)"><path d="M12 22V12"/><path d="M8 6c0 4 1.5 6 4 6s4-2 4-6"/><path d="M8 6 7 3.5M16 6l1-2.5"/><circle cx="12" cy="6.5" r="2.2"/><path d="M10.5 17h3M10.8 19.5h2.4"/></g>',
  // Nemesis-Karten (Chips) zeigen aktuell kein Hintergrund-Symbol; die SVGs sind für den Fall hinterlegt.
  Angriff: '<path d="M14.5 2.5 21 9l-9.5 9.5-3-3L17 7l-2.5-2.5Z"/><path d="M8.5 15.5 3 21"/><path d="M6 17l2 2"/><path d="M5 19.5l-.8.8"/>',
  Plan: '<path d="M6 3h12"/><path d="M6 21h12"/><path d="M7 3c0 4 3 5.5 5 6.3C9 10 7 11.6 7 15.6"/><path d="M17 3c0 4-3 5.5-5 6.3 3 .7 5 2.3 5 6.3"/>',
  Monster: '<path d="M12 3a7 7 0 0 0-5 11.9V17h2v2h2v-2h2v2h2v-2h2v-2.1A7 7 0 0 0 12 3Z"/><circle cx="9.5" cy="11" r="1"/><circle cx="14.5" cy="11" r="1"/>'
};

function cardAccentStyle(type) {
  const pair = CARD_TYPE_COLOR_VARS[type] || ['--parchment-dim', null];
  const dim = pair[1] ? `var(${pair[1]})` : 'rgba(255,255,255,0.04)';
  return `--accent:var(${pair[0]});--accent-dim:${dim};`;
}

// Kartentags (released aus card-component-preview.html): das "keywords"-Feld aus dem Original-
// Randomizer (github.com/on3iro/aeons-end-randomizer), begrenzt auf die 7 Werte, die in unseren
// tatsächlich verfügbaren Spielen/Erweiterungen vorkommen (44 von 179 Marktplatzkarten, siehe
// data.js). "weak"/"strong" sind die Legacy-Kampagnen-Auf-/Abwertungsstufe einer Karte, alle
// anderen sind reine Mechanik-Marker.
const KEYWORD_LABELS = {
  weak: 'Schwach',
  strong: 'Stark',
  pulse: 'Impuls',
  echo: 'Echo',
  attach: 'Anhängen',
  link: 'Verknüpfbar',
  silence: 'Betäuben'
};
// Nur weak/strong bekommen die Tier-Farben (--tier-d/--tier-s), da sie eine Wertung transportieren
// (Auf-/Abwertungsstufe) — alle anderen Keywords sind reine Mechanik-Marker und bleiben neutral.
function cardKeywordTagsHtml(keywords) {
  if (!keywords || !keywords.length) return '';
  return keywords.map((kw) => {
    const label = KEYWORD_LABELS[kw] || kw;
    const modifier = (kw === 'weak' || kw === 'strong') ? ` card__tag--${kw}` : '';
    return `<span class="card__tag${modifier}">${escapeHtml(label)}</span>`;
  }).join('');
}

// Released aus card-component-preview.html: das Hintergrund-Symbol sitzt in einem festen,
// zentrierenden Rahmen (.card__icon-bg, siehe styles.css) unten rechts, damit alle Kartentypen
// optisch gleich positioniert/groß wirken. Bug-Fix (iPad, 2026-09-25): früher eine Unicode-Glyphe
// (✦◆❖★▲◐●) per font-size — plattformabhängig unterschiedlich groß/verschoben, siehe Kommentar
// bei CARD_TYPE_ICON_SHAPE oben. Jetzt ein Inline-SVG (CARD_TYPE_ICON_SVG, Linien-Icons wie bei den Meilensteinen) in
// fester 96×96px-Bounding-Box je Typ — für ALLE Typen exakt gleiche Größe/Position, ohne
// Sonderfall/Ausgleich mehr nötig (CARD_ICON_BG_ADJUST entfällt komplett).
function cardIconBgHtml(type, pathsOverride) {
  const paths = pathsOverride || CARD_TYPE_ICON_SVG[type] || CARD_TYPE_ICON_SVG.Zauber;
  return `<span class="card__icon-bg"><svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg></span>`;
}

// Wave-Kürzel (Punkt 8/9): AEONS_DATA.expansions[code].wave enthält bereits die Release-Wellen-
// Nummer (1-4, Promos = 0) aus dem Original-Randomizer — wird hier nur noch zu "W<n>" formatiert.
function waveLabelForExpansion(expansionCode) {
  const exp = AEONS_DATA.expansions[expansionCode];
  const wave = exp && typeof exp.wave === 'number' ? exp.wave : null;
  return wave !== null ? `W${wave}` : '';
}

// Große, informative Marktplatz-Karte (Punkt 4/5): Name, Kosten mit Æther-Icon, Effekttext aus
// data.js. Der Kartentyp (Zauber/Kristall/Relic) wird NICHT mehr als Text-Chip wiederholt, da er
// bereits aus der umgebenden Rubriküberschrift hervorgeht (Punkt 4) — stattdessen nur noch als
// dezentes Hintergrundsymbol + Randfarbe angedeutet (Punkt 5).
function marketplaceCardChipHtml(c) {
  const effect = c.effect ? `<span class="card__effect">${escapeHtml(c.effect)}</span>` : '';
  // Released aus card-component-preview.html: Kartentags (Punkt 39) aus c.keywords — nur 44 von
  // 179 Karten tragen mind. 1 Keyword (siehe cardKeywordTagsHtml()), daher .card__meta hier nur
  // rendern, wenn tatsächlich Tags vorhanden sind (leere Zeile bei den übrigen Karten vermeiden).
  const tags = cardKeywordTagsHtml(c.keywords);
  const meta = tags ? `<span class="card__meta">${tags}</span>` : '';
  // Released aus card-component-preview.html: Kosten jetzt oben rechts (eigene Zeile), Titel
  // direkt darunter (nie abgekürzt) — statt Titel oben + Kosten als separate Meta-Zeile.
  return `
    ${cardIconBgHtml(c.subtype)}
    <span class="card__cost"><img src="icons/svg/aether.svg" alt="Æther">${c.cost}</span>
    <span class="card__name">${escapeHtml(c.name)}</span>
    ${effect}
    ${meta}`;
}

// Punkt 28: Schatz-Karte, jetzt mit Effekttext analog zu Zauber/Kristall/Relic (siehe
// marketplaceCardChipHtml()). Der Effekttext kommt aus data.js (aus dem Original-Randomizer
// übernommen) und enthält bereits einfaches HTML-Markup (<b>, <br/>, <span class="aether">, ...)
// — daher bewusst NICHT escapeHtml(), sondern direkt eingebettet (vertrauenswürdige Datenquelle,
// keine Nutzereingabe).
// Magier "lang" (Charakterauswahl, Kaserne): volle Kartenkomponente analog Zauber/Kristall/Relic/
// Schatz. Effekt-Zeile zeigt die Fähigkeit des Magiers (Name + Ladungen), da data.js für Magiere
// keinen separaten Fließtext führt. Tier-Badge rein informell zur Charakterauswahl — keine
// Spiellogik daran gebunden (siehe getMageTier()).
function mageCardHtml(m) {
  const tier = getMageTier(m.id);
  const tierBadge = tier ? `<span class="card__tier card__tier--${tier}">${tier}</span>` : '';
  const effect = m.abilityEffect
    ? escapeHtml(m.abilityEffect)
    : (m.abilityName && m.abilityName !== 'Custom'
        ? `Fähigkeit: ${escapeHtml(m.abilityName)}${m.charges ? ` (${m.charges} Ladungen)` : ''}`
        : 'Eigene Fähigkeit (frei wählbar, Legacy-Kampagne).');
  return `
    ${cardIconBgHtml('Magier')}
    ${tierBadge}
    <span class="card__name">${escapeHtml(m.name)}</span>
    <span class="card__title">${escapeHtml(m.title || m.expansion || '')}</span>
    <span class="card__effect">${effect}</span>
    <span class="card__meta">Magier</span>`;
}

function treasureCardHtml(t) {
  const effect = t.effect ? `<span class="card__effect">${t.effect}</span>` : '';
  return `
    ${cardIconBgHtml('schatz-' + t.level, treasureIconPaths(t))}
    <span class="card__name">${escapeHtml(t.name)}</span>
    ${effect}
    <span class="card__meta">Schatz Stufe ${romanTier(t.level)}</span>`;
}

function renderBuildMarket() {
  renderBuildProgress('build-market');
  const nameEl = el('buildMarketSetupName');
  if (nameEl) nameEl.textContent = app.plan.marketSetupName ? `(Marktplatz-Setup: „${app.plan.marketSetupName}“)` : '';
  const container = el('buildMarketGroups');
  container.innerHTML = '';
  ['Zauber', 'Kristall', 'Relic'].forEach((subtype) => {
    const label = document.createElement('h3');
    label.className = 'group-label';
    label.textContent = categoryLabel(subtype);
    container.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'chipgrid market-grid';
    sortByCost(app.plan.initialMarketplace.map(marketplaceCardById).filter((c) => c.subtype === subtype)).forEach((c) => {
      const chip = document.createElement('div');
      // card--slim (siehe styles.css): nur Zauber/Kristall/Relic werden hier gerendert, daher
      // immer die etwas kürzere Kartenhöhe.
      chip.className = 'card card--slim';
      chip.style.cssText = cardAccentStyle(c.subtype);
      chip.innerHTML = marketplaceCardChipHtml(c);
      grid.appendChild(chip);
    });
    container.appendChild(grid);
  });
}

// Nemesis-Vorbereitung (Aufbau 3c): bewusst SPOILERFREI. Zeigt weder Name, noch Erweiterung,
// Schwierigkeit oder Leben eines Erzfeindes. Da ALLE "Verbesserten" (V) Nemesis-Karten vorab aus
// der Kiste geholt werden müssen (unabhängig von der Kampfnummer), zeigt dieser Screen die
// vollständige Entnahme-Liste für die GESAMTE Kampagne — in der seed-bestimmten Reihenfolge aus
// plan.improvedCardOrder. Der Name der einzelnen Erzfeinde wird erst beim tatsächlichen Reveal im
// Nemesis-Overlay (renderBattle) sichtbar.
function renderBuildNemesis() {
  renderBuildProgress('build-nemesis');
  const list = el('buildNemesisList');
  const order = app.plan.improvedCardOrder;
  const levels = [
    { key: 'level1', heading: 'Level 1' },
    { key: 'level2', heading: 'Level 2' },
    { key: 'level3', heading: 'Level 3' }
  ];
  list.innerHTML = levels.map((lvl) => {
    const names = order[lvl.key];
    const chips = names.map((name) => {
      const type = nemesisCardType(name);
      return `<div class="chip chip--nemesis" style="${cardAccentStyle(type)}">
        <span class="chip__name">${escapeHtml(name)}</span>
        <span class="chip__sub">${escapeHtml(type)}</span>
      </div>`;
    }).join('');
    return `
      <h3 class="group-label">${lvl.heading} <span class="count-badge">${names.length}</span></h3>
      <div class="chipgrid">${chips}</div>`;
  }).join('');
}

function startCampaign() {
  // Punkt 21: keine separate Fahrplan-Generierung mehr — ein einziger Mega-Prompt liefert
  // sofort die gesamte Erzählung (Kapitel 1-4 + Epilog) in einer Antwort.
  startGeneration('Erzählung (gesamte Kampagne)', 'mega', buildMegaUserMessage(), 'build-nemesis');
}

// ---------- Rendering: Übersicht ----------

// "Verbessert:"-Block je Nemesis-Kachel (nur sobald status 'revealed'/'defeated', nicht 'locked'):
// zeigt zuerst je Level die aktiven Kartennamen (getImprovedCardsForFight), danach je Level die
// V+A-Zusammenfassung (kumulative V-Zahl + getACountForFight anhand der Partygröße).
// "4 Spieler: einfaches Spiel" (plan.easyMode) ändert NICHTS am A/V-Kartenaufbau — das ist keine
// offizielle Regel-Variante, sondern nur eine informative Markierung der Expedition (siehe
// playerCountLabel()). A/V-Aufbau bleibt identisch zur normalen 4-Spieler-Logik.
function improvedBlockHtml(fightIndex) {
  const playerCount = app.runtime.chosenParty.length;
  const levels = [1, 2, 3];
  const levelSections = levels.map((lvl) => {
    const cards = getImprovedCardsForFight(app.plan, lvl, fightIndex);
    const v = (CUMULATIVE_IMPROVED_COUNTS['level' + lvl] || [0, 0, 0, 0])[fightIndex] || 0;
    const a = getACountForFight(playerCount, lvl, fightIndex);
    // Punkt 31: kein Platzhalter-Chip mehr, wenn es für diese Stufe/diesen Kampf keine
    // verbesserten Karten gibt — einfach keine Chips rendern statt "(noch keine)" anzuzeigen.
    const chips = cards.length
      ? cards.map((name) => {
          const type = nemesisCardType(name);
          return `<span class="nemesis-tile__level-chip" style="${cardAccentStyle(type)}">${escapeHtml(name)}</span>`;
        }).join('')
      : '';
    return `
      <div class="nemesis-tile__level-heading">Level ${lvl} — ${v}V + ${a}A</div>
      <div class="nemesis-tile__level-chips">${chips}</div>`;
  }).join('');
  return `<div class="nemesis-tile__improved">
    <div class="nemesis-tile__divider"></div>
    ${levelSections}
  </div>`;
}

function renderOverview() {
  el('overviewName').textContent = app.plan.name;
  el('overviewSeed').textContent = `Seed: ${app.plan.seed} · ${playerCountLabel(app.plan)}`;
  el('overviewScore').textContent = `Score: ${app.runtime.score}`;

  // Reveal-Reihenfolge (Aufgabe 3): 'locked' = neutraler, nicht-interaktiver Platzhalter ohne
  // jede Information; 'revealed' (= naechster/aktiver Kampf) ist klickbar/hervorgehoben, zeigt
  // aber VOR dem Klick ebenfalls noch keinen Nemesis-Namen — der Name erscheint erst im
  // Nemesis-Overlay (renderBattle) nach dem tatsächlichen Reveal; 'defeated' darf den Namen
  // zeigen, da der Kampf bereits geschlagen und enthüllt wurde.
  // Punkt 25: besiegte Kacheln zeigen nur noch den Header-Block (oberhalb der Trennlinie) —
  // die Verbessert-Tags (Level/V+A) sind für abgeschlossene Kämpfe nicht mehr relevant und
  // stattdessen jetzt vor dem jeweiligen Kampf in der "Vor dem Kampf"-Box zu sehen.
  const tiles = el('nemesisTiles');
  tiles.innerHTML = '';
  app.plan.nemesisOrder.map(nemesisByIdPlan).forEach((n, i) => {
    const status = app.runtime.nemesisStatus[i];
    const tile = document.createElement('div');
    // Punkt 22: alle 4 Kämpfe als einheitlich gestapelte, rechteckige Kacheln (keine Sonderbreite mehr).
    tile.className = `nemesis-tile nemesis-tile--${status}`;
    const triesNote = app.runtime.triesPerFight[i] ? `<div class="nemesis-tile__tries">${app.runtime.triesPerFight[i]} Niederlage(n)</div>` : '';

    if (status === 'defeated') {
      tile.innerHTML = `
        <div class="nemesis-tile__header">
          <div class="nemesis-tile__num">${i + 1}</div>
          <div class="nemesis-tile__main">
            <div class="nemesis-tile__name">${escapeHtml(n.name)} <span class="nemesis-tile__wave">(${waveLabelForExpansion(n.expansion)})</span></div>
            ${triesNote}
          </div>
          <div class="nemesis-tile__status nemesis-tile__status--defeated">Besiegt</div>
        </div>`;
    } else if (status === 'locked') {
      tile.innerHTML = `
        <div class="nemesis-tile__header">
          <div class="nemesis-tile__num">${i + 1}</div>
          <div class="nemesis-tile__main">
            <div class="nemesis-tile__name nemesis-tile__name--hidden">Unbekannt</div>
          </div>
          <div class="nemesis-tile__status">Noch nicht enthüllt</div>
        </div>`;
    } else {
      // Punkt 39: sobald dieser Kampf mindestens einmal geöffnet wurde (auch bei Niederlage und
      // Rückkehr zur Übersicht), zeigt die Kachel den echten Namen statt "Bereit zum Enthüllen".
      const revealedOnce = !!(app.runtime.nemesisRevealedOnce && app.runtime.nemesisRevealedOnce[i]);
      const nameHtml = revealedOnce
        ? `<div class="nemesis-tile__name">${escapeHtml(n.name)} <span class="nemesis-tile__wave">(${waveLabelForExpansion(n.expansion)})</span></div>`
        : `<div class="nemesis-tile__name nemesis-tile__name--hidden">Bereit zum Enthüllen</div>`;
      const statusText = revealedOnce ? 'Klicken, um zum Kampf zu wechseln' : 'Klicken, um diesen Erzfeind zu enthüllen';
      tile.innerHTML = `
        <div class="nemesis-tile__header">
          <div class="nemesis-tile__num">${i + 1}</div>
          <div class="nemesis-tile__main">
            ${nameHtml}
            ${triesNote}
            ${revealedOnce ? nemesisLampHtml(n.id) : ''}
          </div>
          <div class="nemesis-tile__status">${statusText}</div>
        </div>
        ${improvedBlockHtml(i)}`;
      // Aufgabe 7: 1. Klick enthüllt nur die Kachel (Name/Wave), 2. Klick (auf die dann
      // bereits enthüllte Kachel) navigiert erst zum Story-/Kampf-Detail-Screen.
      tile.onclick = revealedOnce ? (() => { openNextBattle(); }) : (() => { revealNemesisTile(); });
      bindHoverSfx(tile);
    }
    tiles.appendChild(tile);
  });

  el('btnShowBarracks').onclick = () => {
    app.runtime.showBarracks = !app.runtime.showBarracks;
    // Punkt 26: unbestätigte (ungültige) Kaserne-Bearbeitungen verwerfen, wenn das Panel
    // geschlossen wird — gültige Kombinationen sind zu diesem Zeitpunkt bereits über
    // syncBarracksIfValid() übernommen, hier fällt nur ein angefangener, nicht abgeschlossener
    // Zwischenstand weg.
    if (!app.runtime.showBarracks) {
      app.runtime.pendingReconfigParty = null;
      app.runtime.pendingReconfigMarketplace = null;
      app.runtime.pendingReconfigTreasures = null;
    }
    playSfx(app.runtime.showBarracks ? 'show_barracks' : 'hide_barracks');
    renderOverview();
  };
  const barracksPanel = el('barracksPanel');
  barracksPanel.hidden = !app.runtime.showBarracks;
  el('btnShowBarracks').textContent = app.runtime.showBarracks ? 'Kaserne schließen' : 'Kaserne öffnen';
  if (app.runtime.showBarracks) renderBarracksPanel();

  const epilogue = app.runtime.storyDisabled ? null : app.runtime.chapters[4];
  const epiloguePanel = el('epiloguePanel');
  if (epilogue) {
    epiloguePanel.hidden = false;
    el('epilogueTitle').textContent = epilogue.title || 'Epilog';
    el('epilogueBody').innerHTML = escapeHtml(epilogue.body).replace(/\n\n+/g, '</p><p>').replace(/^/, '<p>').replace(/$/, '</p>');
  } else {
    epiloguePanel.hidden = true;
  }
}

// Punkt 45: Siegesseite — nur über finishExpedition() (Sieg im letzten/4. Kampf) erreichbar,
// zeigt alle 4 besiegten Erzfeinde samt Niederlagen-Zahl (analog renderOverview()), den finalen
// Score und (falls vorhanden) den Epilog.
// Formatiert eine Dauer in Millisekunden als "Xh Ymin" (bzw. nur "Ymin" unter 1h, "<1min" bei
// sehr kurzen Kämpfen) für die Spielzeit-Anzeige auf der Siegesseite (siehe renderVictory()).
function formatDurationMs(ms) {
  if (!ms || ms < 0) return '<1min';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return '<1min';
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return h > 0 ? `${h}h ${min}min` : `${min}min`;
}

// Pausiert den Spielzeit-Timer des aktuell aktiven Kampfes (siehe freshRuntimeState()): die seit
// runningSince verstrichene Zeit wird in accumulatedMs aufaddiert und runningSince auf null
// gesetzt. Läuft der Timer bereits nicht (runningSince ist schon null), passiert nichts — die
// Funktion ist also beliebig oft hintereinander aufrufbar. Wird aufgerufen, sobald der Kampf-
// Screen verlassen wird (siehe goto()) oder die Seite unsichtbar wird (siehe visibilitychange-
// Listener weiter unten), damit NUR aktiv im Kampf-Screen verbrachte Zeit gezählt wird (Bugfix
// 2026-10-05: vorher lief die Zeit auch bei gesperrtem Bildschirm/App im Hintergrund weiter).
function pauseFightTimer() {
  if (!app.runtime || !app.runtime.fightTimes) return;
  const f = app.runtime.fightIndex;
  const entry = app.runtime.fightTimes[f];
  if (!entry || !entry.runningSince) return;
  entry.accumulatedMs = (entry.accumulatedMs || 0) + Math.max(0, Date.now() - entry.runningSince);
  entry.runningSince = null;
}

// Setzt den Spielzeit-Timer des aktuellen Kampfes fort (bzw. startet ihn, falls der Eintrag noch
// fehlt — siehe startNewTurnOrderFight()). Läuft NUR an, wenn tatsächlich aktiv im Kampf-Screen
// (app.step === 'battle'), die Seite sichtbar ist (nicht gesperrt/im Hintergrund) und der Kampf
// noch nicht gewonnen wurde (entry.end ist leer) — sonst passiert nichts. Läuft der Timer schon
// (runningSince bereits gesetzt), wird NICHT erneut gestartet, damit wiederholte renderScreen()-
// Aufrufe innerhalb desselben Kampfes (Peek, Overlays, Zähler, …) die Messung nicht verfälschen.
function resumeFightTimer() {
  if (!app.runtime || app.step !== 'battle' || document.hidden) return;
  if (!app.runtime.fightTimes) app.runtime.fightTimes = [null, null, null, null];
  const f = app.runtime.fightIndex;
  let entry = app.runtime.fightTimes[f];
  if (!entry) {
    entry = { accumulatedMs: 0, runningSince: null, end: null };
    app.runtime.fightTimes[f] = entry;
  }
  if (entry.end || entry.runningSince) return;
  entry.runningSince = Date.now();
}

// Liefert die Spielzeit (ms) eines einzelnen Kampfes — Summe aus bereits aufaddierter Zeit
// (accumulatedMs) und, falls der Timer gerade läuft, dem seit runningSince verstrichenen Anteil
// (siehe pauseFightTimer()/resumeFightTimer()). Fallback auf das alte start/end-Modell für
// Altbestände, die noch nicht migriert wurden (siehe loadSlotById()). Liefert null, falls der
// Kampf noch nicht begonnen hat.
function fightDurationMs(entry) {
  if (!entry) return null;
  if (typeof entry.accumulatedMs === 'number') {
    const running = entry.runningSince ? Math.max(0, Date.now() - entry.runningSince) : 0;
    return entry.accumulatedMs + running;
  }
  // Alt-Format (nur noch theoretisch relevant, falls irgendwo ein nicht migrierter Eintrag
  // durchrutscht): reine start/end-Differenz.
  if (!entry.start || !entry.end) return null;
  return Math.max(0, entry.end - entry.start);
}

function renderVictory() {
  updateNewExpeditionAvailability();
  el('victoryScore').textContent = `Score: ${app.runtime.score}`;
  renderExpeditionAchievements('victoryAchievementsPanel', 'victoryAchievementsGrid');

  // Party-Recap: reine Info-Chips (nicht klickbar), analog zur Tier-Chip-Optik aus den Optionen
  // (chip__tier/chip__name/chip__sub), aber mit .chip--static statt .chip--tier, da hier weder
  // Drag&Drop noch eine Auswahl-Interaktion stattfindet.
  const partyChips = el('victoryPartyChips');
  partyChips.innerHTML = '';
  partyMages().forEach((m) => {
    const tier = getMageTier(m.id) || 'D';
    const chip = document.createElement('div');
    chip.className = 'chip chip--static';
    chip.innerHTML = `<span class="chip__tier chip__tier--${tier}">${tier}</span><span class="chip__name">${escapeHtml(m.name)}</span><span class="chip__sub">${escapeHtml(m.title || m.expansion)}</span>`;
    partyChips.appendChild(chip);
  });

  launchConfetti();

  const tiles = el('victoryNemesisTiles');
  tiles.innerHTML = '';
  const fightTimes = app.runtime.fightTimes || [];
  let totalMs = 0;
  let anyDuration = false;
  app.plan.nemesisOrder.map(nemesisByIdPlan).forEach((n, i) => {
    const tile = document.createElement('div');
    tile.className = 'nemesis-tile nemesis-tile--defeated';
    const triesNote = app.runtime.triesPerFight[i] ? `<div class="nemesis-tile__tries">${app.runtime.triesPerFight[i]} Niederlage(n)</div>` : '';
    const durationMs = fightDurationMs(fightTimes[i]);
    if (durationMs !== null) { totalMs += durationMs; anyDuration = true; }
    const durationNote = `<div class="nemesis-tile__duration">Spielzeit: ${durationMs !== null ? formatDurationMs(durationMs) : '–'}</div>`;
    tile.innerHTML = `
      <div class="nemesis-tile__header">
        <div class="nemesis-tile__num">${i + 1}</div>
        <div class="nemesis-tile__main">
          <div class="nemesis-tile__name">${escapeHtml(n.name)} <span class="nemesis-tile__wave">(${waveLabelForExpansion(n.expansion)})</span></div>
          ${triesNote}
          ${durationNote}
        </div>
        <div class="nemesis-tile__status nemesis-tile__status--defeated">Besiegt</div>
      </div>`;
    tiles.appendChild(tile);
  });
  el('victoryTotalDuration').textContent = anyDuration
    ? `Gesamtspielzeit: ${formatDurationMs(totalMs)}`
    : '';

  const epilogue = app.runtime.storyDisabled ? null : app.runtime.chapters[4];
  const epiloguePanel = el('victoryEpiloguePanel');
  if (epilogue) {
    epiloguePanel.hidden = false;
    el('victoryEpilogueTitle').textContent = epilogue.title || 'Epilog';
    el('victoryEpilogueBody').innerHTML = escapeHtml(epilogue.body).replace(/\n\n+/g, '</p><p>').replace(/^/, '<p>').replace(/$/, '</p>');
  } else {
    epiloguePanel.hidden = true;
  }
}

// Rein dekorativer Einmal-Effekt beim Erreichen der Siegesseite: erzeugt ~70 fallende Partikel in
// #victoryConfetti (liegt außerhalb der .screen-Sections, siehe index.html, damit "position: fixed"
// über den gesamten Viewport funktioniert) und räumt sie nach Ablauf der Animation wieder ab, damit
// #victoryConfetti bei einer erneuten Siegesseite (z.B. nächste Expedition) wieder leer startet.
// Respektiert prefers-reduced-motion (siehe styles.css) durch einen zusätzlichen JS-Guard, damit gar
// nicht erst Partikel erzeugt werden statt sie nur per CSS unsichtbar zu machen.
function launchConfetti() {
  const host = el('victoryConfetti');
  if (!host) return;
  host.innerHTML = '';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const colors = ['var(--tier-s)', 'var(--verdant)', 'var(--breach)', 'var(--aetherium)', 'var(--ember)'];
  const count = 70;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti__piece';
    const left = Math.random() * 100;
    const duration = 2.6 + Math.random() * 1.6;
    const delay = Math.random() * 0.5;
    const color = colors[i % colors.length];
    const rotateStart = Math.random() * 360;
    piece.style.left = `${left}vw`;
    piece.style.background = color;
    piece.style.animationDuration = `${duration}s`;
    piece.style.animationDelay = `${delay}s`;
    piece.style.transform = `rotate(${rotateStart}deg)`;
    host.appendChild(piece);
  }
  clearTimeout(launchConfetti._cleanup);
  launchConfetti._cleanup = setTimeout(() => { host.innerHTML = ''; }, 4600);
}

// Game-Over-Screen (finale Niederlage) — siehe finalizeLoss(). Zeigt nur Namen des siegreichen
// Erzfeindes; kein Score/keine Party-Übersicht, da die Expedition hier bewusst nicht "gewürdigt"
// wird wie auf der Siegesseite.
function renderGameOver() {
  updateNewExpeditionAvailability();
  const nem = nemesisByIdPlan(app.runtime.gameOverNemesisId);
  const nemName = nem ? nem.name : 'der Erzfeind';
  renderExpeditionAchievements('gameOverAchievementsPanel', 'gameOverAchievementsGrid');
  el('gameOverText').textContent =
    `Die Feste der Letzten Ruhe ist endgültig verloren. Jede Hoffnung ist geschwunden und ${nemName} hat gesiegt.`;
}

// Punkt 44: der frühere separate "Marktplatz vor dem nächsten Kampf"-Zwischenscreen ist entfallen
// — reconfigToggleCard() wird jetzt ausschließlich von der Kaserne genutzt.
// Party frei editierbar: Toggle ohne sofortige Grenzprüfung — die Exakt-N-Prüfung erfolgt
// automatisch in syncBarracksIfValid(), analog zu reconfigToggleCard().
function partyReconfigToggle(mageId) {
  const list = app.runtime.pendingReconfigParty;
  const idx = list.indexOf(mageId);
  if (idx >= 0) { list.splice(idx, 1); playSfx('navigation_deselect'); }
  else { list.push(mageId); playSfx('navigation_select'); }
  syncBarracksIfValid();
  renderScreen();
}

// Schätze frei editierbar, analog zum Marktplatz — KEINE Zuordnung zu einzelnen Magiern
// (ausdrücklicher Nutzerwunsch), nur ein globaler An/Aus-Zustand je Schatz.
function treasureReconfigToggle(treasureId) {
  const list = app.runtime.pendingReconfigTreasures;
  const idx = list.indexOf(treasureId);
  if (idx >= 0) { list.splice(idx, 1); playSfx('navigation_deselect'); }
  else { list.push(treasureId); playSfx('navigation_select'); }
  syncBarracksIfValid();
  renderScreen();
}

// Punkt 43: kein eigener "Kaserne übernehmen"-Button mehr — der war redundant, sobald jede
// Änderung ohnehin nur zwei Ausgänge kennt: gültig -> wird übernommen, ungültig -> Hinweistext
// ("Auswahl unvollständig") bleibt sichtbar und muss ohnehin korrigiert werden. Diese Funktion
// prüft nach JEDEM Toggle (Party/Marktplatz/Schätze) automatisch, ob die volle Kombination
// bereits allen drei Regeln entspricht (genau Spieleranzahl Magier; 4/3/2-Marktplatz-Invariante;
// je Schatzstufe die vorgesehene Ziel-Anzahl) und übernimmt sie in diesem Fall sofort und leise
// (kein Toast bei jedem Klick) in den aktiven Zustand. Ist die Kombination (noch) ungültig, bleibt
// der zuletzt gültige aktive Zustand unverändert — der Warnhinweis im Panel zeigt das an, und
// focusBarracksIssue() blockiert währenddessen weiterhin die Navigation in den nächsten Kampf.
function syncBarracksIfValid() {
  // reconfigToggleCard() wird sowohl von der Kaserne als auch vom separaten Vor-dem-Kampf-
  // Reconfig-Screen genutzt (gemeinsamer pendingReconfigMarketplace-Puffer) — Auto-Übernahme
  // darf ausschließlich greifen, wenn die Kaserne tatsächlich offen ist, sonst würde ein noch
  // von einer früheren Kaserne-Sitzung übrig gebliebener pendingReconfigParty/-Treasures-Wert
  // fälschlich mit übernommen.
  if (!app.runtime.showBarracks) return;
  const playerCount = app.plan.playerCount || 4;
  const party = app.runtime.pendingReconfigParty;
  const market = app.runtime.pendingReconfigMarketplace;
  const treasures = app.runtime.pendingReconfigTreasures;
  if (!party || !market || !treasures) return;

  const ok = party.length === playerCount &&
    marketplaceInvariantOk(market) &&
    treasuresInvariantOk(treasures, app.runtime.barracks.treasureIds, playerCount);
  if (!ok) return;

  app.runtime.chosenParty = party.slice();
  app.runtime.currentMarketplace = market.slice();
  app.runtime.currentTreasures = treasures.slice();
  saveActiveSlot();
  // Errungenschaften: erfolgreicher Kaserne-Commit = Trackingpunkt für "jemals aktiv im Marktplatz".
  trackPlayedMages();
  evaluateAchievements({ event: 'state' });
}

function renderBarracksPanel() {
  // Punkt 26: Auffangnetz — sorgt dafür, dass currentTreasures nie unter das Zielminimum fällt,
  // auch wenn eine ältere gespeicherte Expedition das Feld noch nicht kennt.
  ensureCurrentTreasures();

  const b = app.runtime.barracks;
  const playerCount = app.plan.playerCount || app.runtime.chosenParty.length || 4;

  if (!app.runtime.pendingReconfigParty) app.runtime.pendingReconfigParty = app.runtime.chosenParty.slice();
  if (!app.runtime.pendingReconfigMarketplace) app.runtime.pendingReconfigMarketplace = app.runtime.currentMarketplace.slice();
  if (!app.runtime.pendingReconfigTreasures) app.runtime.pendingReconfigTreasures = app.runtime.currentTreasures.slice();

  const pendingParty = app.runtime.pendingReconfigParty;
  const pendingMarket = app.runtime.pendingReconfigMarketplace;
  const pendingTreasures = app.runtime.pendingReconfigTreasures;

  const html = [];

  // --- Party (Punkt 26): Pool = ursprüngliche Party ∪ alle bisher rekrutierten Magier;
  // aktiv müssen exakt so viele sein, wie bei der Kampagnenerstellung als Spieleranzahl
  // festgelegt wurde. ---
  const originalPartyIds = app.runtime.originalParty && app.runtime.originalParty.length
    ? app.runtime.originalParty
    : app.runtime.chosenParty;
  const partyPoolIds = Array.from(new Set([...originalPartyIds, ...b.mageIds]));
  const partyOk = pendingParty.length === playerCount;
  // Punkt 41: jede Kaserne-Gruppe (Party/Marktplatz/Schätze) bekommt eine eigene ID, damit
  // focusBarracksIssue() gezielt zur ersten noch unvollständigen Gruppe scrollen und sie
  // per .barracks-group--attention visuell markieren kann.
  html.push(`<div class="barracks-group" id="barracksGroupParty">`);
  html.push(`<h3 class="group-label">Party (${pendingParty.length} / ${playerCount} aktiv)${partyOk ? '' : '<span class="barracks-group__warn">Auswahl unvollständig</span>'}</h3>`);
  html.push(`<div class="chipgrid" id="barracksPartyGrid">${partyPoolIds.map(mageByIdPlan).filter(Boolean).map((m) => {
    const active = pendingParty.includes(m.id);
    return `<div class="card card--mage${active ? ' selected' : ''}" style="${cardAccentStyle('Magier')}" data-mage-id="${escapeHtml(m.id)}">${mageCardHtml(m)}</div>`;
  }).join('')}</div>`);
  html.push(`</div>`);

  // --- Marktplatz (Punkt 26): nutzt dieselbe Toggle-/Invarianten-Logik wie der Marktplatz-Ausgleich
  // nach Sieg/Niederlage. ---
  const allBarracksCards = b.marketplaceCardIds.map(marketplaceCardById).filter(Boolean);
  const marketOk = marketplaceInvariantOk(pendingMarket);
  html.push(`<div class="barracks-group" id="barracksGroupMarket">`);
  html.push(`<h3 class="group-label">Marktplatz${marketOk ? '' : '<span class="barracks-group__warn">Auswahl unvollständig</span>'}</h3>`);
  ['Zauber', 'Kristall', 'Relic'].forEach((subtype) => {
    const target = { Zauber: 4, Kristall: 3, Relic: 2 }[subtype];
    const countActive = pendingMarket.map(marketplaceCardById).filter((c) => c && c.subtype === subtype).length;
    html.push(`<h4 class="group-label group-label--sub">${categoryLabel(subtype)} (${countActive} / ${target})</h4>`);
    const seen = new Set();
    const chips = sortByCost(allBarracksCards.filter((c) => c.subtype === subtype)).filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    }).map((c) => {
      const active = pendingMarket.includes(c.id);
      // Zielanzahl je Subtyp erreicht + Karte selbst nicht aktiv -> Auswahl gesperrt, bis
      // erst eine andere Karte desselben Subtyps abgewählt wird (siehe reconfigToggleCard()).
      const locked = !active && countActive >= target;
      const cls = ['card', 'card--slim', active ? 'selected' : '', locked ? 'disabled' : ''].filter(Boolean).join(' ');
      return `<div class="${cls}" style="${cardAccentStyle(c.subtype)}" data-market-card-id="${escapeHtml(c.id)}">${marketplaceCardChipHtml(c)}</div>`;
    }).join('');
    html.push(`<div class="chipgrid market-grid">${chips}</div>`);
  });
  html.push(`</div>`);

  // --- Schätze (Punkt 26): frei An/Aus-schaltbar analog zum Marktplatz, je Stufe I/II/III nach
  // den gegebenen Regeln (Stufe II genau 1, Stufe I/III genau Spieleranzahl) — ausdrücklich OHNE
  // Zuordnung zu einzelnen Magiern. ---
  const treasurePool = b.treasureIds.map(treasureByIdPlan).filter(Boolean);
  if (treasurePool.length) {
    const treasuresOkGroup = treasuresInvariantOk(pendingTreasures, b.treasureIds, playerCount);
    html.push(`<div class="barracks-group" id="barracksGroupTreasures">`);
    html.push(`<h3 class="group-label">Schätze${treasuresOkGroup ? '' : '<span class="barracks-group__warn">Auswahl unvollständig</span>'}</h3>`);
    [1, 2, 3].forEach((level) => {
      const levelPool = treasurePool.filter((t) => t.level === level);
      if (!levelPool.length) return;
      const target = Math.min(treasureTierTarget(level, playerCount), levelPool.length);
      const activeCount = pendingTreasures.filter((id) => {
        const t = treasureByIdPlan(id);
        return t && t.level === level;
      }).length;
      html.push(`<h4 class="group-label group-label--sub">Stufe ${romanTier(level)} (${activeCount} / ${target})</h4>`);
      const chips = levelPool.map((t) => {
        const active = pendingTreasures.includes(t.id);
        // Bug-Fix (Nutzer-Report): hier stand fälschlich .card--compact (Nemesis-Vorbereitungs-
        // Kachel, 190×220) statt der regulären Kartengröße — dadurch wirkten Schätze in der
        // Kaserne kleiner als Zauber/Kristall/Relic direkt darüber. .card--slim-treasure ist
        // exakt so groß wie .card--slim (siehe styles.css).
        return `<div class="card card--slim-treasure${active ? ' selected' : ''}" style="${cardAccentStyle(treasureAccentKey(t))}" data-treasure-select-id="${escapeHtml(t.id)}">${treasureCardHtml(t)}</div>`;
      }).join('');
      html.push(`<div class="chipgrid">${chips}</div>`);
    });
    html.push(`</div>`);
  }

  el('barracksContent').innerHTML = html.join('');

  el('barracksContent').querySelectorAll('[data-mage-id]').forEach((chipEl) => {
    chipEl.onclick = () => partyReconfigToggle(chipEl.getAttribute('data-mage-id'));
    bindHoverSfx(chipEl);
  });
  el('barracksContent').querySelectorAll('[data-market-card-id]').forEach((chipEl) => {
    chipEl.onclick = () => reconfigToggleCard(chipEl.getAttribute('data-market-card-id'));
    bindHoverSfx(chipEl);
  });
  el('barracksContent').querySelectorAll('[data-treasure-select-id]').forEach((chipEl) => {
    chipEl.onclick = () => treasureReconfigToggle(chipEl.getAttribute('data-treasure-select-id'));
    bindHoverSfx(chipEl);
  });

  const treasuresOk = treasuresInvariantOk(pendingTreasures, b.treasureIds, playerCount);
  const ok = pendingParty.length === playerCount && marketplaceInvariantOk(pendingMarket) && treasuresOk;
  el('barracksHint').textContent = ok
    ? 'Alle Vorgaben erfüllt — Auswahl übernommen.'
    : `Bitte genau ${playerCount} Magier, die Verteilung 4/3/2 im Marktplatz und je Schatzstufe die vorgesehene Anzahl aktiv halten.`;
}

// ---------- Rendering: Story-Zwischenscreen ----------

// Zeigt den Kapiteltext zum aktuellen Kampf, bevor es weiter zum Kampf-Detail-Screen geht.
// Wird von openNextBattle() nur angesteuert, wenn tatsächlich eine Erzählung generiert wurde
// (siehe dort) — dieselbe Kapitel-Aufbereitung wie zuvor in renderBattle().
function renderStory() {
  const f = app.runtime.fightIndex;
  const nem = nemesisAt(f);
  const chapter = app.runtime.chapters[f];
  el('storyHeading').textContent = `Kampf ${f + 1} von 4 — ${nem.name} (${waveLabelForExpansion(nem.expansion)})`;

  const chapterEl = el('storyChapter');
  if (chapter) {
    chapterEl.innerHTML = `<div class="chapter__eyebrow">${escapeHtml(chapter.chapterLabel)}</div>
      <h2 class="chapter__title">${escapeHtml(chapter.title || chapter.chapterLabel)}</h2>
      <div class="chapter__body">${escapeHtml(chapter.body).replace(/\n\n+/g, '</p><p>').replace(/^/, '<p>').replace(/$/, '</p>')}</div>`;
  } else {
    chapterEl.innerHTML = '<p class="panel__hint">Noch kein Kapitel erzeugt.</p>';
  }
}

// ---------- Rendering: Kampf-Overlay ----------

function renderBattle() {
  const f = app.runtime.fightIndex;
  const nem = nemesisAt(f);
  // Der Seitentitel "Kampf x von 4 — Erzfeindname (WA)" soll im Tablet-Modus nicht angezeigt
  // werden (User-Wunsch, 2026-09-24) — im 3-Spalten-Grid steht der Erzfeindname bereits über
  // #tabletNemesisName, der Titel wäre dort redundant und nimmt unnötig Platz weg. Im klassischen
  // Layout bleibt er wie bisher sichtbar.
  el('battleHeading').hidden = app.options.tabletMode;
  el('battleHeading').textContent = `Kampf ${f + 1} von 4 — ${nem.name} (${waveLabelForExpansion(nem.expansion)})`;
  // Erzfeind-Name im Tablet-Layout (rechte Spalte, neben dem Erzfeind-Zähler).
  el('tabletNemesisName').textContent = nem ? nem.name : '—';

  // Punkt 8: die Vor-dem-Kampf-Infobox erscheint für JEDEN Kampf, inkl. Kampf 1 (vorher nur ab
  // Kampf 2) — ABER nur im klassischen Layout. Im Tablet-Modus ist dafür kein Platz vorgesehen
  // (3-Spalten-Grid ist bereits voll ausgenutzt), daher dort ausgeblendet.
  const beforeFight = el('beforeFightPanel');
  beforeFight.hidden = app.options.tabletMode;
  // Punkt 25: dieselben "Verbessert"-Tags wie in der Übersicht (sortiert nach Stufe, mit
  // V+A-Verteilung) werden hier unten in der Box zusätzlich angezeigt.
  el('beforeFightInfo').innerHTML = `
    <div class="before-fight-grid">
      <div><span>Welle</span>${waveLabelForExpansion(nem.expansion)} · ${escapeHtml(AEONS_DATA.expansions[nem.expansion] ? AEONS_DATA.expansions[nem.expansion].name : nem.expansion)}</div>
      <div><span>Schwierigkeit</span>${nem.difficulty}</div>
      <div><span>Leben</span>${nem.health}</div>
      <div><span>Expedition Rating</span>${nem.expeditionRating}</div>
    </div>
    ${improvedBlockHtml(f)}`;
  // Die Erzählung wird nicht mehr hier angezeigt, sondern auf dem vorgeschalteten Story-Screen
  // (siehe renderStory() / screen-story) — openNextBattle() navigiert dorthin, wenn eine
  // Erzählung generiert wurde, und erst von dort per "Kampf starten" auf diesen Screen.

  // Umschalten zwischen klassischem und Tablet-Kampf-Detail-Screen je nach Options-Toggle
  // "Tablet-Modus" (app.options.tabletMode, siehe #screen-options). Beide Container existieren
  // dauerhaft im DOM — nur die Sichtbarkeit wechselt.
  el('combatClassicView').hidden = app.options.tabletMode;
  el('combatTabletView').hidden = !app.options.tabletMode;

  // Reihenfolge-Randomizer: initialisiert (oder bestätigt) das Kartendeck für diesen Kampf.
  // renderBattle() feuert bei JEDER Navigation zum Kampf-Screen, nicht nur beim Kampfstart —
  // ensureTurnOrderFight() erkennt per fightIndex-Guard, ob wirklich ein neuer Kampf beginnt.
  ensureTurnOrderFight();
  renderHpCounters();
}

/* ================================================================================================
   Reihenfolge-Randomizer (Kampf-Detail) — gemergt aus turn-order-randomizer-prototype.html.
   ------------------------------------------------------------------------------------------------
   Offizielle Regel (Aeon's End, Reihenfolgedeck):
     "Locate the turn order cards based on selected number of players. Shuffle and place facedown
      on the table. This is the turn order deck."
     "At the start of each turn, flip the top card of the turn order deck over into a discard pile
      of turn order cards."
     "The revealed player or nemesis now takes their turn."
     "When the turn order deck is empty and a new card must be drawn or revealed, shuffle the
      discard pile to form a new turn order deck and draw the top card."
     "Do not shuffle the discard pile until you need to draw or reveal a new card."

   Randomisierung ist hier bewusst NICHT seed-deterministisch (anders als der Rest der App via
   seededRng/seededShuffle in plan.js) — komplett frische Zufälligkeit bei jedem Mischvorgang,
   ohne Bias/Gedächtnis, analog zum physischen Kartenmischen am Tisch.

   Zustand lebt in app.runtime.turnOrder (siehe freshRuntimeState()) und wird damit automatisch
   über saveActiveSlot()/saveSlots() persistiert. Ein fightIndex-Guard in ensureTurnOrderFight()
   unterscheidet "neuer Kampf, Deck neu aufbauen" von "gleicher Kampf, nur Re-Navigation" — nötig,
   weil renderBattle() bei JEDER Navigation zum Kampf-Screen feuert, nicht nur beim Kampfstart.

   Alle Bezeichner sind mit "TurnOrder"/"TORD_" präfixiert (Kollisionsschutz + Klarheit), auch wenn
   ein Grep von app.js/plan.js keine tatsächlichen Namenskonflikte mit den Original-Bezeichnern
   des Prototyps ergeben hat.
   ================================================================================================ */

// ---- Deck-Zusammensetzung je Spieleranzahl (immer exakt 6 Karten: 4 Spieler-Slots + 2 Nemesis-Slots) ----
const TORD_PLAYER_COUNT_DECKS = {
  '2':      ['1', '1', '2', '2', 'nemesis', 'nemesis'],
  '3':      ['1', '2', '3', 'wild', 'nemesis', 'nemesis'],
  '4':      ['1', '2', '3', '4', 'nemesis', 'nemesis'],
  '4-easy': ['1-2', '1-2', '3-4', '3-4', 'nemesis', 'nemesis'],
};

// ---- Kartentyp-Metadaten (deutsche Beschriftung; Referenzkarten sind englisch — Mapping:
//      "Eure Wahl" = Wild, "Erzfeind" = Nemesis, "Sturmangriff" = Malstrom) ----
const TORD_CARD_META = {
  '1':        { label: '1',      cls: 't1',      turnText: 'Spieler 1 ist an der Reihe',              isNemesis: false },
  '2':        { label: '2',      cls: 't2',      turnText: 'Spieler 2 ist an der Reihe',              isNemesis: false },
  '3':        { label: '3',      cls: 't3',      turnText: 'Spieler 3 ist an der Reihe',              isNemesis: false },
  '4':        { label: '4',      cls: 't4',      turnText: 'Spieler 4 ist an der Reihe',              isNemesis: false },
  '1-2':      { label: '1/2',    cls: 't12',     turnText: 'Spieler 1 oder 2 ist an der Reihe',       isNemesis: false },
  '3-4':      { label: '3/4',    cls: 't34',     turnText: 'Spieler 3 oder 4 ist an der Reihe',       isNemesis: false },
  'wild':     { label: 'Eure Wahl', cls: 'wild', turnText: 'Ein Spieler eurer Wahl ist an der Reihe', isNemesis: false },
  'nemesis':  { label: 'Erzfeind', icon: 'nemesis', cls: 'nemesis', turnText: 'Der Erzfeind ist an der Reihe',         isNemesis: true },
  'malstrom_assault': {
    // Kurzes Label statt "Sturmangriff", damit es analog zu "Erzfeind" gut auf das Kartenoval
    // passt. Der Sonderregel-Effekt (Schaden je Marker) wird bewusst NICHT hier abgebildet — die
    // Karte ist im Kern nur eine spezielle Erzfeind-Karte, deren Regeltext am Tisch nachgeschlagen
    // wird, nicht im Randomizer.
    label: 'Malstrom', cls: 'malstrom', turnText: 'Sturmangriff — Malstrom-Wiederkehrer ist an der Reihe',
    isNemesis: true,
  },
};

// Reale Spieleranzahl-Ableitung (identisch zu playerCountLabel()): "4-easy" ist rein informativ
// markiert (app.plan.easyMode) und nutzt das Deck mit "1/2"-/"3/4"-Sammel-Slots.
function turnOrderPlayerCountKey() {
  return app.plan.easyMode ? '4-easy' : String(app.plan.playerCount || 4);
}

function buildTurnOrderDeckList() {
  const t = app.runtime.turnOrder;
  const base = TORD_PLAYER_COUNT_DECKS[t.playerCountKey].slice();
  if (t.malstromActive) {
    // Ersetzt genau eine der 2 "nemesis"-Karten durch die Sturmangriff-Sonderkarte.
    const idx = base.indexOf('nemesis');
    if (idx !== -1) base[idx] = 'malstrom_assault';
  }
  return base;
}

function isTurnOrderNemesisType(cardKey) {
  const meta = TORD_CARD_META[cardKey];
  return !!(meta && meta.isNemesis);
}

function shuffleTurnOrderFresh(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Regel-konformes Mischen per Rejection Sampling: mischt so lange neu, bis die aktiven Erweiterten
// Regeln (app.options.turnOrderRules) erfüllt sind. `carriedStreak` = Nemesis-Streak, der über den
// Mischvorgang hinweg weiterzählt (Regeln gelten ÜBER Misch-Grenzen hinweg: "2x Erzfeind am
// Rundenende -> mischen -> 2x Erzfeind am Rundenanfang" darf NICHT als 4 in Folge gelten).
function shuffleTurnOrderRespectingRules(cards, { carriedStreak, isFightStart }) {
  const rules = app.options.turnOrderRules;
  const MAX_TRIES = 1000;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const candidate = shuffleTurnOrderFresh(cards);

    if (rules.noFirstTurn && isFightStart && isTurnOrderNemesisType(candidate[0])) continue;

    if (rules.noTriple) {
      let streak = carriedStreak;
      let violated = false;
      for (const cardKey of candidate) {
        if (isTurnOrderNemesisType(cardKey)) {
          streak++;
          if (streak > 2) { violated = true; break; }
        } else {
          streak = 0;
        }
      }
      if (violated) continue;
    }

    return candidate;
  }
  // Fallback (sollte praktisch nie erreicht werden, da immer erfüllbare Anordnungen existieren):
  return shuffleTurnOrderFresh(cards);
}

// Baut einen komplett frischen Reihenfolge-Zustand für den angegebenen Kampf auf. malstromActive
// wird aus dem realen Erzfeind dieses Kampfes abgeleitet (Malstrom-Wiederkehrer, id "MaelstromRisen").
function startNewTurnOrderFight(fightIndex) {
  const nem = nemesisAt(fightIndex);
  const t = {
    fightIndex,
    playerCountKey: turnOrderPlayerCountKey(),
    malstromActive: !!(nem && nem.id === 'MaelstromRisen'),
    deck: [],
    currentCycleDiscard: [],
    currentCard: null,
    turnNumber: 0,
    nemesisStreak: 0,
    isFirstDeckOfFight: true,
    peekOpen: false,
    revealOpen: false,
    specialOpen: false,
    specialPickerMode: null,
  };
  app.runtime.turnOrder = t;
  // Spielzeit-Tracking (siehe freshRuntimeState()/renderVictory()): diese Funktion läuft bei
  // JEDEM Beginn dieses Kampfes — sowohl beim allerersten Start als auch nach einer Niederlage
  // (finalizeLoss() verwirft turnOrder, wodurch ensureTurnOrderFight() hier erneut hineinspringt).
  // Laut Expeditionsregeln beginnt ein Wiederholungsversuch komplett neu — daher wird der Timer
  // hier bewusst IMMER frisch auf 0 angelegt (anders als früher, wo ein bereits gesetzter Start
  // bei Niederlage NICHT überschrieben wurde). Der Timer selbst läuft noch nicht (runningSince ist
  // null) — das aktive Zählen startet erst über resumeFightTimer(), das goto() beim tatsächlichen
  // Betreten des Kampf-Screens aufruft.
  if (!app.runtime.fightTimes) app.runtime.fightTimes = [null, null, null, null];
  app.runtime.fightTimes[fightIndex] = { accumulatedMs: 0, runningSince: null, end: null };
  t.deck = shuffleTurnOrderRespectingRules(buildTurnOrderDeckList(), { carriedStreak: 0, isFightStart: true });
  // Erzfeind-Zähler auf die Basis-Leben des jeweiligen Kampfes zurücksetzen (Feste-Zähler bleibt
  // dagegen über mehrere Kämpfe hinweg erhalten — nur eine komplett neue Expedition setzt ihn via
  // freshRuntimeState()/festeStartValue() zurück). Startwert abhängig von der Schwierigkeit
  // (plan.difficulty) — siehe nemesisStartHealth().
  app.runtime.hp.erzfeind = clampHp(nemesisStartHealth(nem, app.plan));
  // Direkt die erste Karte aufdecken, statt einen leeren "Kampf noch nicht gestartet"-Zustand
  // anzuzeigen — advanceTurnOrder() zieht hier einfach die oberste Karte des frisch gemischten Decks.
  advanceTurnOrder();
}

// Wird am Ende von renderBattle() aufgerufen — bei JEDER Navigation zum Kampf-Screen. Baut das
// Deck nur neu auf, wenn wirklich ein neuer Kampf beginnt (fightIndex-Wechsel); bei bloßer
// Re-Navigation zum bereits aktiven Kampf wird nur die bestehende Anzeige neu gerendert.
function ensureTurnOrderFight() {
  const f = app.runtime.fightIndex;
  const existing = app.runtime.turnOrder;
  if (existing && existing.fightIndex === f) {
    renderTurnOrder();
    return;
  }
  startNewTurnOrderFight(f);
}

// Zieht (bzw. deckt auf) die nächste Karte. Mischt NUR hier lazily nach, wenn das Deck leer ist —
// Peek/Deck-aufdecken dürfen laut Regel ("Do not shuffle the discard pile until you need to draw
// or reveal a new card") niemals selbst einen Mischvorgang auslösen.
function advanceTurnOrder() {
  const t = app.runtime.turnOrder;
  const justFinishedCard = t.currentCard;

  if (t.deck.length === 0) {
    // Die Runde ist komplett aufgedeckt -> für die Folgerunde neu mischen. Der Pool sind alle
    // Karten dieser Runde: der bisherige Ablagestapel + die gerade aktive letzte Karte (die
    // physisch ebenfalls im Ablagestapel liegt, exakt wie die offizielle Regel).
    const pool = t.currentCycleDiscard.concat(justFinishedCard !== null ? [justFinishedCard] : []);
    t.deck = shuffleTurnOrderRespectingRules(pool, {
      carriedStreak: t.nemesisStreak,
      isFightStart: false, // die "kein Start"-Regel gilt nur für die ALLERERSTE Karte des Kampfes
    });
    // Ablagestapel-Anzeige: zurücksetzen, da die neue Runde bei 0 aufgedeckten Karten beginnt.
    t.currentCycleDiscard = [];
  } else if (justFinishedCard !== null) {
    t.currentCycleDiscard.push(justFinishedCard);
  }

  t.currentCard = t.deck.shift();
  t.turnNumber++;
  t.isFirstDeckOfFight = false;
  t.peekOpen = false;
  t.revealOpen = false;
  // Der Ablagestapel dieser Runde hat sich gerade verändert — ein noch offener Sonderfunktionen-
  // Picker würde sonst eine Karte zeigen, die es so nicht mehr gibt.
  t.specialPickerMode = null;

  if (isTurnOrderNemesisType(t.currentCard)) {
    t.nemesisStreak++;
  } else {
    t.nemesisStreak = 0;
  }

  // Universeller "neue Karte aufgedeckt"-Sound (draw.wav), unabhängig vom Kartentyp.
  playSfx('draw');
  saveActiveSlot();
  renderTurnOrder(/* justDrawn */ true);
}

// Peek = rein lesend, löst NIE ein Mischen aus. Wenn das Deck gerade leer ist (letzte Karte wurde
// bereits aufgedeckt, aktueller Zug aber noch nicht beendet), gibt es laut Regel keine "nächste
// Karte" — das Mischen darf erst beim nächsten tatsächlichen Zug-Ende passieren.
function peekNextTurnOrderCard() {
  const t = app.runtime.turnOrder;
  return t.deck.length > 0 ? t.deck[0] : null;
}

function toggleTurnOrderPeek() {
  const t = app.runtime.turnOrder;
  t.peekOpen = !t.peekOpen;
  playSfx(t.peekOpen ? 'navigation_forward' : 'navigation_backward');
  saveActiveSlot();
  renderTurnOrder();
}

function moveTurnOrderRevealCard(fromIndex, toIndex) {
  const t = app.runtime.turnOrder;
  if (toIndex < 0 || toIndex >= t.deck.length || fromIndex === toIndex) return;
  const [moved] = t.deck.splice(fromIndex, 1);
  t.deck.splice(toIndex, 0, moved);
  saveActiveSlot();
  renderTurnOrder();
}

// Peek-Fenster ist selbst als Button klickbar (Tablet + Classic): schließt die Vorschau und
// sortiert die dort eingesehene nächste Karte ganz nach unten ins Deck — Nutzerwunsch 2026-09-25,
// z.B. um eine ungünstige nächste Karte zurückzustellen, ohne das Deck komplett aufdecken zu
// müssen. moveTurnOrderRevealCard() übernimmt bereits saveActiveSlot()+renderTurnOrder(), daher
// hier keine doppelte Speicherung/Render.
function sortNextTurnOrderCardToBottom() {
  const t = app.runtime.turnOrder;
  if (t.deck.length === 0) return;
  t.peekOpen = false;
  playSfx('draw');
  moveTurnOrderRevealCard(0, t.deck.length - 1);
}

// Nur von der CLASSIC-Ansicht genutzt (btnRevealDeckClassic/btnHideRevealClassic) — die Tablet-
// Ansicht nutzt stattdessen das Overlay-Konzept (openTabletOverlay/renderDeckOverlay).
function toggleTurnOrderRevealClassic() {
  const t = app.runtime.turnOrder;
  t.revealOpen = !t.revealOpen;
  playSfx(t.revealOpen ? 'navigation_forward' : 'navigation_backward');
  saveActiveSlot();
  renderTurnOrder();
}

// ---- Sonderfunktionen: seltene Ausnahmefälle, in denen eine Karte im Ablagestapel dieser Runde
//      — inklusive der aktuell aktiven Karte, die physisch bereits zuoberst dort liegt — durch
//      einen Karten- oder Nemesis-Effekt zurück ins Deck gemischt wird. ----
function isTurnOrderPlayerCardType(typeKey) {
  return !TORD_CARD_META[typeKey].isNemesis;
}
function isTurnOrderGeneralNemesisType(typeKey) {
  // Bewusst NUR die reguläre "Erzfeind"-Karte, nicht die Malstrom-Sonderkarte — die zählt als
  // eigener Spezialfall und ist hier nicht gemeint ("1 allgemeine Erzfeindkarte").
  return typeKey === 'nemesis';
}

// Rückmisch-Pool dieser Runde: die aktuell aktive Karte liegt laut offizieller Regel physisch
// bereits im Ablagestapel (siehe Kommentar in advanceTurnOrder()) und muss daher für Rückmisch-
// Effekte (Sonderfunktionen-Picker + Overlay-Verlauf) wählbar sein. Die Stapel-VORSCHAU (Layer auf
// dem Tablet) und die Classic-Ablagestapel-Zeile zeigen die aktive Karte dagegen bewusst NICHT
// zusätzlich an — sie steht dort ja bereits sichtbar in der Kartenbühne; eine doppelte Anzeige
// derselben Karte wirkte verwirrend (Nutzerwunsch, 2026-09-26, nach vorheriger Nachbesserung
// zurückgenommen). Die zugrundeliegende Datenstruktur (t.currentCycleDiscard) bleibt unberührt —
// sie wächst weiterhin erst beim nächsten advanceTurnOrder().
function turnOrderDiscardForDisplay() {
  const t = app.runtime.turnOrder;
  return t.currentCard !== null ? t.currentCycleDiscard.concat([t.currentCard]) : t.currentCycleDiscard;
}

// Liefert die im Ablagestapel dieser Runde vorhandenen Kartentypen, die zum Filter passen —
// dedupliziert mit Anzahl (z.B. bei 2 Spielern kann "1" zweimal im Ablagestapel liegen). Inklusive
// der aktuell aktiven Karte (siehe turnOrderDiscardForDisplay()) — die liegt physisch bereits
// zuoberst im Ablagestapel und muss daher ebenfalls zurückmischbar sein. Nutzerwunsch, 2026-09-26.
function distinctTurnOrderDiscardTypes(filterFn) {
  const counts = new Map();
  turnOrderDiscardForDisplay().forEach((typeKey) => {
    if (!filterFn(typeKey)) return;
    counts.set(typeKey, (counts.get(typeKey) || 0) + 1);
  });
  return counts;
}

function toggleTurnOrderSpecial() {
  const t = app.runtime.turnOrder;
  t.specialOpen = !t.specialOpen;
  if (!t.specialOpen) t.specialPickerMode = null;
  saveActiveSlot();
  renderTurnOrder();
}

function setTurnOrderSpecialPickerMode(mode) {
  const t = app.runtime.turnOrder;
  t.specialPickerMode = t.specialPickerMode === mode ? null : mode;
  playSfx('navigation_forward');
  saveActiveSlot();
  renderTurnOrder();
}

// Nimmt genau EIN Exemplar von typeKey aus dem Ablagestapel dieser Runde und mischt es zurück ins
// aktuelle Deck — unter Beachtung der Erweiterten Regeln, analog zum normalen Neu-Mischen.
// Der Picker (distinctTurnOrderDiscardTypes()) zeigt inkl. der aktuell aktiven Karte an, da sie
// physisch bereits zuoberst im Ablagestapel liegt — daher hier zwei Fälle: bereits abgeschlossene
// Karte (Standardfall, unten) ODER die gerade aktive Karte selbst (Sonderfall, siehe unten).
// Nutzerwunsch, 2026-09-26.
function returnTurnOrderDiscardCardToDeck(typeKey) {
  const t = app.runtime.turnOrder;
  const idx = t.currentCycleDiscard.indexOf(typeKey);
  if (idx === -1) {
    returnTurnOrderActiveCardToDeck(typeKey);
    return;
  }
  t.currentCycleDiscard.splice(idx, 1);
  t.deck = shuffleTurnOrderRespectingRules(t.deck.concat([typeKey]), {
    carriedStreak: t.nemesisStreak,
    isFightStart: false,
  });
  t.specialPickerMode = null;
  playSfx('draw');
  saveActiveSlot();
  renderTurnOrder();
}

// Sonderfall von returnTurnOrderDiscardCardToDeck(): die gerade aktive Karte (t.currentCard)
// selbst wird zurück ins Deck gemischt, da sie physisch bereits zuoberst im Ablagestapel liegt und
// laut Regel ebenfalls für Rückmisch-Effekte wählbar sein muss. Im Unterschied zum Standardfall
// gibt es danach sofort KEINE aktive Karte mehr — es wird direkt die nächste Karte gezogen (wie
// bei advanceTurnOrder()), aber ohne die zurückgemischte Karte zusätzlich in currentCycleDiscard
// einzutragen. Nutzerwunsch, 2026-09-26.
function returnTurnOrderActiveCardToDeck(typeKey) {
  const t = app.runtime.turnOrder;
  if (t.currentCard !== typeKey) return;
  // Streak-Rückrechnung nur bestmöglich: war die zurückgemischte Karte eine Erzfeindkarte, wird
  // der Streak wieder um 1 verringert; war sie keine, hatte sie den Streak ohnehin schon auf 0
  // zurückgesetzt — der exakte Vorwert davor ist in diesem seltenen Sonderfall nicht mehr bekannt.
  if (isTurnOrderNemesisType(typeKey)) {
    t.nemesisStreak = Math.max(0, t.nemesisStreak - 1);
  }
  if (t.deck.length === 0) {
    // Analog zum Nachziehen bei leerem Deck (advanceTurnOrder()): Pool = bisheriger Ablagestapel
    // dieser Runde + die zurückgemischte Karte (statt der sonst hier eingefügten "gerade aktiven
    // letzten Karte" — die WIRD ja gerade zurückgemischt, landet also nicht im Ablagestapel).
    t.deck = shuffleTurnOrderRespectingRules(t.currentCycleDiscard.concat([typeKey]), {
      carriedStreak: t.nemesisStreak,
      isFightStart: false,
    });
    t.currentCycleDiscard = [];
  } else {
    t.deck = shuffleTurnOrderRespectingRules(t.deck.concat([typeKey]), {
      carriedStreak: t.nemesisStreak,
      isFightStart: false,
    });
  }
  t.currentCard = t.deck.shift();
  // Bugfix: deckt wie advanceTurnOrder() eine neue aktive Karte auf, muss den Zugzähler also
  // ebenfalls erhöhen — sonst zeigt die Zug-Anzeige (renderTurnOrderStatusClassic()) einen zu
  // niedrigen Wert, sobald dieser Rückmisch-Sonderfall genutzt wurde.
  t.turnNumber++;
  if (isTurnOrderNemesisType(t.currentCard)) {
    t.nemesisStreak++;
  } else {
    t.nemesisStreak = 0;
  }
  t.specialPickerMode = null;
  playSfx('draw');
  saveActiveSlot();
  renderTurnOrder(/* justDrawn */ true);
}

// ---- Rendering ----
function turnCardEl({ typeKey, size, faceDown }) {
  if (faceDown) {
    return `<div class="turn-card turn-card--${size} turn-card--facedown"><div class="turn-card__oval"><span class="turn-card__label">?</span></div></div>`;
  }
  if (!typeKey) {
    return `<div class="turn-card turn-card--${size} turn-card--empty"></div>`;
  }
  const meta = TORD_CARD_META[typeKey];
  const splitLabel = meta.label.includes('/') ? meta.label.split('/') : null;
  const inner = meta.icon
    ? `<img class="turn-card__icon" src="icons/svg/${meta.icon}.svg" alt="${escapeHtml(meta.label)}">`
    : splitLabel
    ? `<span class="turn-card__label turn-card__label--split">
         <span class="turn-card__label-half">${escapeHtml(splitLabel[0])}</span>
         <span class="turn-card__label-divider"></span>
         <span class="turn-card__label-half">${escapeHtml(splitLabel[1])}</span>
       </span>`
    : `<span class="turn-card__label">${escapeHtml(meta.label)}</span>`;
  return `<div class="turn-card turn-card--${size} turn-card--${meta.cls}"><div class="turn-card__oval">${inner}</div></div>`;
}

// Dispatcher: rendert je nach app.options.tabletMode ("Tablet-Modus"-Option, siehe #screen-options)
// entweder den klassischen oder den tablet-optimierten Kampf-Detail-Screen. Beide Varianten teilen
// sich denselben Zustand app.runtime.turnOrder — nur die Darstellung unterscheidet sich.
function renderTurnOrder(justDrawn) {
  if (app.options.tabletMode) {
    renderTurnOrderTablet(justDrawn);
  } else {
    renderTurnOrderClassic(justDrawn);
  }
}

// Rendering des TABLET-Kampf-Detail-Screens (gemergt aus tablet-combat.html, Stand 2026-09-24).
// justDrawn steuert die kurze Blitz-Animation (.turn-card--justdrawn) auf der aktiven Karte — nur
// beim tatsächlichen Ziehen einer neuen Karte (advanceTurnOrder()), nicht bei bloßer Re-Navigation
// (ensureTurnOrderFight()) oder Zustandsänderungen wie Peek/Overlay-Öffnen.
function renderTurnOrderTablet(justDrawn) {
  renderTurnOrderStageTablet(justDrawn);
  renderTurnOrderPeekTablet();
  renderDeckStack();
  renderDiscardTop();
  if (!el('overlayDeck').hidden) renderDeckOverlay();
  if (!el('overlayDiscard').hidden) { renderDiscardOverlay(); renderTurnOrderSpecialTablet(); }
}

function renderTurnOrderStageTablet(justDrawn) {
  const t = app.runtime.turnOrder;
  const btn = el('tabletActiveCard');

  if (t.currentCard === null) {
    // Praktisch unerreichbar in Produktion (startNewTurnOrderFight() deckt sofort die erste Karte
    // auf) — als defensiver Fallback beibehalten, analog zum Prototyp.
    btn.innerHTML = turnCardEl({ typeKey: null, size: 'lg', faceDown: false });
    btn.title = 'Karte tippen, um zu beginnen.';
    return;
  }

  btn.innerHTML = turnCardEl({ typeKey: t.currentCard, size: 'lg', faceDown: false });
  btn.title = 'Zug beenden & nächste Karte (Leertaste)';

  if (justDrawn) {
    const cardEl = btn.querySelector('.turn-card');
    if (cardEl) {
      cardEl.classList.add('turn-card--justdrawn');
      setTimeout(() => cardEl.classList.remove('turn-card--justdrawn'), 650);
    }
  }
}

// Gemeinsamer Helfer für die "Nächste Karte einsehen"-Vorschau, von Tablet- und Classic-Ansicht
// genutzt (identisches Markup/Verhalten, nur unterschiedliche DOM-IDs) — Refactoring 2026-10-05,
// siehe [[aeons_end_tablet_kampf_optimierung]] Punkt 1.
function renderTurnOrderPeekInto(slotId, btnId, sortBtnId) {
  const t = app.runtime.turnOrder;
  const slot = el(slotId);
  const btn = el(btnId);
  btn.textContent = t.peekOpen ? 'Vorschau schließen' : 'Nächste Karte einsehen';

  if (!t.peekOpen) { slot.innerHTML = ''; return; }

  const next = peekNextTurnOrderCard();
  if (next === null) {
    slot.innerHTML = `
      <div class="tord-peek">
        ${turnCardEl({ typeKey: null, size: 'sm', faceDown: false })}
        <p class="tord-peek-text">Keine nächste Karte verfügbar — das Deck ist leer und wird erst beim nächsten Zugende neu gemischt.</p>
      </div>`;
    return;
  }
  const meta = TORD_CARD_META[next];
  slot.innerHTML = `
    <button type="button" class="tord-peek tord-peek--action" id="${sortBtnId}">
      ${turnCardEl({ typeKey: next, size: 'sm', faceDown: false })}
      <span class="tord-peek-text-wrap">
        <span class="tord-peek-text tord-peek-text--main">Als Nächstes <strong>${escapeHtml(meta.label)}</strong></span>
        <span class="tord-peek-text tord-peek-text--hint">Klicken, um Karte nach unten zu sortieren</span>
      </span>
    </button>`;
  el(sortBtnId).addEventListener('click', sortNextTurnOrderCardToBottom);
}

function renderTurnOrderPeekTablet() {
  renderTurnOrderPeekInto('tabletPeekSlot', 'btnTabletPeek', 'btnTabletPeekSortDown');
}

// Deck-Stapel-Vorschau. Bei 0 Karten (Deck komplett aufgedeckt, wird erst beim nächsten
// Zugende neu gemischt) exakt dieselbe "leer"-Darstellung wie der Ablagestapel bei 0 Karten
// (turnCardEl({typeKey: null, ...}) -> .turn-card--empty), statt des sonst üblichen
// Stapel-Looks mit Rückseiten-Oval — Nutzerwunsch, 2026-09-24.
// Bei >0 Karten entspricht die Anzahl der überlappenden Layer der Anzahl noch verfügbarer
// Karten im Deck (t.deck.length) — Nutzerwunsch, 2026-09-24 (vorher immer fix 3 Layer). Nur
// der oberste (letzte) Layer zeigt das Rückseiten-Oval + Label, alle darunter sind reine
// Füll-Layer. TORD_DECK_MAX_LAYERS begrenzt das nach oben (Deck hat laut buildTurnOrderDeckList()
// ohnehin nie mehr als 6 Karten, die Deckelung ist rein defensiv gegen visuelles Zumüllen).
const TORD_DECK_MAX_LAYERS = 6;
const TORD_DECK_LAYER_STEP_PX = 3.5;
// Der hinterste Layer eines vollen Stapels sitzt immer bei diesem Offset (unabhängig von
// layerCount, siehe Offset-Formel unten). Die leere ("gestrichelt") Darstellung wird auf
// denselben Offset gesetzt, damit sie unten mit dem untersten Layer des GEGENÜBERLIEGENDEN,
// vollen Stapels bündig ist (Deck<->Ablage) — Nutzerwunsch, 2026-09-24.
const TORD_DECK_BACK_OFFSET_PX = (TORD_DECK_MAX_LAYERS - 1) * TORD_DECK_LAYER_STEP_PX;
function renderDeckStack() {
  const t = app.runtime.turnOrder;
  const stack = el('tabletDeckStack');
  if (t.deck.length === 0) {
    stack.innerHTML = `<div style="transform:translate(${TORD_DECK_BACK_OFFSET_PX}px,${TORD_DECK_BACK_OFFSET_PX}px)">${turnCardEl({ typeKey: null, size: 'sm', faceDown: false })}</div>`;
    return;
  }
  const layerCount = Math.min(t.deck.length, TORD_DECK_MAX_LAYERS);
  // Offsets sind an einer festen Rückseiten-Referenz (TORD_DECK_MAX_LAYERS) verankert, nicht
  // an 0 — so verschwindet beim Kartenziehen immer der VORDERSTE (kleinster Offset) Layer,
  // nicht der hinterste. Physisch wird ja von oben/vorne gezogen. Nutzerwunsch, 2026-09-24.
  const layers = [];
  for (let i = 0; i < layerCount; i++) {
    const isFront = i === 0;
    const offset = (TORD_DECK_MAX_LAYERS - layerCount + i) * TORD_DECK_LAYER_STEP_PX;
    const content = isFront
      ? '<div class="tord-deckback-oval"><span>Reihen</span><span>folge</span><span>Deck</span></div>'
      : '';
    layers.push(`<div class="tord-deckstack__layer${isFront ? ' tord-deckstack__layer--front' : ''}" style="transform:translate(${offset}px,${offset}px)">${content}</div>`);
  }
  layers.reverse(); // Front-Layer (kleinster Offset) muss zuletzt im DOM stehen, um oben zu liegen.
  stack.innerHTML = `${layers.join('')}<span class="tord-deckstack__count" id="tabletDeckCount"></span>`;
  el('tabletDeckCount').textContent = `${t.deck.length}`;
}

// Ablagestapel-Vorschau (nur die zuletzt abgelegte Karte der AKTUELLEN Runde, nicht die gerade
// aktive Karte selbst, die ja noch in der Kartenbühne steht — 2 Anzeigen derselben Karte
// gleichzeitig wirkten verwirrend, daher wieder zurückgenommen, Nutzerwunsch 2026-09-26). Sobald
// für die Folgerunde neu gemischt wird, wird currentCycleDiscard in advanceTurnOrder() geleert.
// Analog zum Reihenfolgedeck (renderDeckStack()) wächst der Stapel visuell mit jeder abgelegten
// Karte um einen Layer; der oberste (vorderste) Layer zeigt immer die zuletzt abgelegte Karte.
// Bei 0 Karten exakt dieselbe "leer"-Darstellung wie zuvor. Nutzerwunsch, 2026-09-24.
function renderDiscardTop() {
  const t = app.runtime.turnOrder;
  const discard = t.currentCycleDiscard;
  const slot = el('tabletDiscardSlot');
  if (discard.length === 0) {
    // Auf Rückseiten-Offset ausgerichtet, damit "unten" bündig mit dem untersten Layer des
    // vollen Deckstapels ist (und umgekehrt) — Nutzerwunsch, 2026-09-24.
    slot.innerHTML = `<div style="transform:translate(${TORD_DECK_BACK_OFFSET_PX}px,${TORD_DECK_BACK_OFFSET_PX}px)">${turnCardEl({ typeKey: null, size: 'sm', faceDown: false })}</div>`;
    return;
  }
  const layerCount = Math.min(discard.length, TORD_DECK_MAX_LAYERS);
  const top = discard[discard.length - 1];
  const layers = [];
  for (let i = 0; i < layerCount; i++) {
    const isFront = i === 0;
    const offset = (TORD_DECK_MAX_LAYERS - layerCount + i) * TORD_DECK_LAYER_STEP_PX;
    const content = isFront ? turnCardEl({ typeKey: top, size: 'sm', faceDown: false }) : '';
    layers.push(`<div class="tord-discard-slot__layer${isFront ? ' tord-discard-slot__layer--front' : ''}" style="transform:translate(${offset}px,${offset}px)">${content}</div>`);
  }
  layers.reverse(); // Front-Layer (zuletzt abgelegte Karte) muss zuletzt im DOM stehen, um oben zu liegen.
  slot.innerHTML = layers.join('');
}

/* ---------- Overlay: Deck aufdecken / neu ordnen ----------
   Drag&Drop läuft über den gemeinsamen beginPointerDrag()-Helfer (siehe Kopf der Datei, auch von
   renderMageTiers() genutzt) statt nativem HTML5 Drag&Drop, das auf Touch-Tablets nicht
   zuverlässig funktioniert. Die zuvor zusätzlich vorhandenen ◂▸-Pfeil-Buttons sind entfernt, da
   Drag&Drop per Pointer Events zuverlässig funktioniert (Nutzerbestätigung 2026-09-25) — kein
   Fallback mehr nötig. ---------- */
function renderDeckOverlay() {
  const t = app.runtime.turnOrder;
  const row = el('tordRevealRow');
  row.innerHTML = t.deck.map((typeKey, i) => `
      <div class="tord-reveal-item" data-reveal-index="${i}">
        <span class="tord-reveal-item__pos">${i === 0 ? 'als nächstes' : `Position ${i + 1}`}</span>
        ${turnCardEl({ typeKey, size: 'md', faceDown: false })}
      </div>`).join('');
  bindDeckOverlayInteractions(row);
}

function bindDeckOverlayInteractions(row) {
  // Ziel-Index = Anzahl der übrigen Karten (ohne die gerade gezogene, die per position:fixed aus
  // dem Fluss der Zeile genommen ist), deren Mittelpunkt links vom Zeiger liegt. Das entspricht
  // exakt dem toIndex, den moveTurnOrderRevealCard() erwartet (Einfügeposition NACH Entfernen der
  // Quellkarte aus dem Array).
  function computeTargetIndex(itemEl, clientX) {
    const siblings = Array.from(row.querySelectorAll('.tord-reveal-item')).filter((it) => it !== itemEl);
    let count = 0;
    siblings.forEach((sib) => {
      const rect = sib.getBoundingClientRect();
      if (clientX >= rect.left + rect.width / 2) count++;
    });
    return count;
  }

  row.querySelectorAll('[data-reveal-index]').forEach((itemEl) => {
    itemEl.addEventListener('pointerdown', (e) => {
      const fromIndex = Number(itemEl.dataset.revealIndex);
      beginPointerDrag(itemEl, e, {
        onEnd: (ev) => {
          const toIndex = computeTargetIndex(itemEl, ev.clientX);
          // moveTurnOrderRevealCard() ruft bereits renderTurnOrder() → renderDeckOverlay() auf
          // (wenn das Overlay offen ist), kein zusätzlicher Re-Render hier nötig.
          if (fromIndex !== toIndex) moveTurnOrderRevealCard(fromIndex, toIndex);
        },
      });
    });
  });
}

/* ---------- Overlay: Ablagestapel-Verlauf + Sonderfunktionen ---------- */
// Zeigt inkl. der aktuell aktiven Karte als letzten (zuletzt abgelegten) Eintrag — siehe
// turnOrderDiscardForDisplay(). Nutzerwunsch, 2026-09-26.
// Gemeinsamer Helfer für die Ablage-Verlauf-Liste, von Tablet-Overlay und Classic-Historie-Zeile
// genutzt (identisches Markup, nur unterschiedliche Datenquelle/Ziel-ID — siehe Kommentare an den
// jeweiligen Aufrufstellen) — Refactoring 2026-10-05, siehe [[aeons_end_tablet_kampf_optimierung]]
// Punkt 1.
function renderTurnOrderDiscardListInto(rowId, discard) {
  const row = el(rowId);
  if (discard.length === 0) {
    row.innerHTML = '<span class="tord-history-empty">Noch keine Karten in dieser Runde abgelegt.</span>';
    return;
  }
  row.innerHTML = discard.map((typeKey, i) => `
      <div class="tord-history-item">
        <span class="tord-history-item__idx">${i + 1}</span>
        ${turnCardEl({ typeKey, size: 'sm', faceDown: false })}
      </div>`).join('');
}

function renderDiscardOverlay() {
  renderTurnOrderDiscardListInto('tordHistoryRow', turnOrderDiscardForDisplay());
}

// Gemeinsamer Helfer für den Sonderfunktionen-Picker (Spieler-/Nemesis-Karte aus Ablage zurück
// ins Deck mischen), von Tablet- und Classic-Ansicht genutzt (identisches Markup/Verhalten, nur
// unterschiedliche DOM-IDs) — Refactoring 2026-10-05, siehe [[aeons_end_tablet_kampf_optimierung]]
// Punkt 1.
function renderTurnOrderSpecialPickerInto(playerBtnId, nemesisBtnId, rowId) {
  const t = app.runtime.turnOrder;
  const playerBtn = el(playerBtnId);
  const nemesisBtn = el(nemesisBtnId);
  playerBtn.classList.toggle('is-active', t.specialPickerMode === 'player');
  nemesisBtn.classList.toggle('is-active', t.specialPickerMode === 'nemesis');

  const row = el(rowId);
  if (t.specialPickerMode === null) { row.innerHTML = ''; return; }

  const filterFn = t.specialPickerMode === 'player' ? isTurnOrderPlayerCardType : isTurnOrderGeneralNemesisType;
  const counts = distinctTurnOrderDiscardTypes(filterFn);

  if (counts.size === 0) {
    row.innerHTML = '<p class="tord-history-empty" style="margin-top:10px;">Keine passende Karte im Ablagestapel dieser Runde.</p>';
    return;
  }

  const items = [];
  counts.forEach((count, typeKey) => {
    const meta = TORD_CARD_META[typeKey];
    items.push(`
      <button class="tord-special-pick" type="button" data-return-type="${typeKey}" title="Zurück ins Deck mischen">
        ${turnCardEl({ typeKey, size: 'sm', faceDown: false })}
        <span class="tord-special-pick__label">${escapeHtml(meta.label)}${count > 1 ? ` ×${count}` : ''}</span>
      </button>`);
  });
  row.innerHTML = `<div class="tord-special-picker-row">${items.join('')}</div>`;

  row.querySelectorAll('[data-return-type]').forEach((btn) => {
    btn.addEventListener('click', () => returnTurnOrderDiscardCardToDeck(btn.dataset.returnType));
  });
}

function renderTurnOrderSpecialTablet() {
  renderTurnOrderSpecialPickerInto('btnSpecialPlayer', 'btnSpecialNemesis', 'tordSpecialPickerRow');
}

/* ---------- CLASSIC-Ansicht (Wiederherstellung des ursprünglichen Kampf-Detail-Screens aus
   turn-order-randomizer-prototype.html — siehe Options-Toggle "Tablet-Modus", Standard = aus).
   Teilt sich app.runtime.turnOrder mit der Tablet-Ansicht, hat aber eigene DOM-IDs (Suffix
   "Classic") und ein eigenes Reveal-UI mit Pfeil-Buttons statt reiner Drag&Drop-Steuerung. ---------- */
function renderTurnOrderClassic(justDrawn) {
  renderTurnOrderStatusClassic();
  renderTurnOrderStageClassic(justDrawn);
  renderTurnOrderPeekClassic();
  renderTurnOrderRevealClassic();
  renderTurnOrderHistoryClassic();
  renderTurnOrderSpecialClassic();
}

function renderTurnOrderStatusClassic() {
  const t = app.runtime.turnOrder;
  const statusEl = el('tordStatusClassic');
  const turnBadge = el('tordTurnBadgeClassic');
  turnBadge.textContent = t.turnNumber > 0 ? `Zug ${t.turnNumber}` : '';
  statusEl.innerHTML = `
    <span>Deck: <strong>${t.deck.length}</strong> Karte(n)</span>
    <span>Ablagestapel: <strong>${t.currentCycleDiscard.length}</strong> Karte(n)</span>
    <span>Nemesis-Serie: <strong>${t.nemesisStreak}</strong></span>
  `;
}

function renderTurnOrderStageClassic(justDrawn) {
  const t = app.runtime.turnOrder;
  const slot = el('tordCurrentCardSlotClassic');
  const label = el('tordCurrentLabelClassic');
  const turnText = el('tordCurrentTurnTextClassic');
  const hint = el('tordCurrentHintClassic');

  if (t.currentCard === null) {
    slot.innerHTML = turnCardEl({ typeKey: null, size: 'lg', faceDown: false });
    label.textContent = 'Noch kein Zug';
    turnText.textContent = 'Kampf noch nicht gestartet';
    hint.textContent = 'Klicke unten auf "Zug beenden & nächste Karte" (oder Leertaste), um den Kampf zu beginnen.';
    return;
  }

  const meta = TORD_CARD_META[t.currentCard];
  slot.innerHTML = turnCardEl({ typeKey: t.currentCard, size: 'lg', faceDown: false });
  label.textContent = 'Aktuell an der Reihe';
  turnText.textContent = meta.turnText;
  hint.textContent = meta.isNemesis
    ? 'Der Erzfeind führt seinen Zug gemäß seiner Karte aus.'
    : 'Dieser Spieler führt seinen Zug aus.';

  if (justDrawn) {
    const cardEl = slot.querySelector('.turn-card');
    if (cardEl) {
      cardEl.classList.add('turn-card--justdrawn');
      setTimeout(() => cardEl.classList.remove('turn-card--justdrawn'), 650);
    }
  }
}

function renderTurnOrderPeekClassic() {
  renderTurnOrderPeekInto('tordPeekSlotClassic', 'btnPeekClassic', 'btnPeekClassicSortDown');
}

function renderTurnOrderRevealClassic() {
  const t = app.runtime.turnOrder;
  const section = el('tordRevealSectionClassic');
  const row = el('tordRevealRowClassic');
  const btn = el('btnRevealDeckClassic');
  btn.textContent = t.revealOpen ? 'Deck wieder verdecken' : 'Restliches Deck aufdecken';
  section.hidden = !t.revealOpen;
  if (!t.revealOpen) { row.innerHTML = ''; return; }

  row.innerHTML = t.deck.map((typeKey, i) => `
      <div class="tord-reveal-item" draggable="true" data-reveal-index="${i}">
        <span class="tord-reveal-item__pos">${i === 0 ? 'als nächstes' : `Position ${i + 1}`}</span>
        ${turnCardEl({ typeKey, size: 'md', faceDown: false })}
        <div class="tord-reveal-item__nudge">
          <button class="tord-nudge-btn" data-action="move-left" data-index="${i}" ${i === 0 ? 'disabled' : ''} title="Nach links (früher)">◂</button>
          <button class="tord-nudge-btn" data-action="move-right" data-index="${i}" ${i === t.deck.length - 1 ? 'disabled' : ''} title="Nach rechts (später)">▸</button>
        </div>
      </div>`).join('');

  bindTurnOrderRevealInteractionsClassic(row);
}

function bindTurnOrderRevealInteractionsClassic(row) {
  let dragSrcIndex = null;
  row.querySelectorAll('[data-reveal-index]').forEach((itemEl) => {
    itemEl.addEventListener('dragstart', () => {
      dragSrcIndex = Number(itemEl.dataset.revealIndex);
      itemEl.classList.add('is-dragging');
    });
    itemEl.addEventListener('dragend', () => itemEl.classList.remove('is-dragging'));
    itemEl.addEventListener('dragover', (e) => e.preventDefault());
    itemEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetIndex = Number(itemEl.dataset.revealIndex);
      if (dragSrcIndex !== null) moveTurnOrderRevealCard(dragSrcIndex, targetIndex);
      dragSrcIndex = null;
    });
  });
  row.querySelectorAll('[data-action="move-left"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.index);
      moveTurnOrderRevealCard(i, i - 1);
    });
  });
  row.querySelectorAll('[data-action="move-right"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.index);
      moveTurnOrderRevealCard(i, i + 1);
    });
  });
}

// Ablagestapel zeigt bewusst NUR die bereits aufgedeckten Karten der AKTUELLEN Runde (nicht die
// gerade aktive Karte selbst, die ja noch oben in der "Aktuell an der Reihe"-Bühne steht — die
// Classic-Historie-Zeile entspricht der Tablet-Stapel-VORSCHAU, nicht deren Overlay-Verlauf, daher
// hier wieder ausgeschlossen; Nutzerwunsch, 2026-09-26).
function renderTurnOrderHistoryClassic() {
  renderTurnOrderDiscardListInto('tordHistoryRowClassic', app.runtime.turnOrder.currentCycleDiscard);
}

function renderTurnOrderSpecialClassic() {
  const t = app.runtime.turnOrder;
  const body = el('tordSpecialBodyClassic');
  const toggleBtn = el('btnToggleSpecialClassic');
  toggleBtn.textContent = t.specialOpen ? 'Sonderfunktionen ▴' : 'Sonderfunktionen ▾';
  body.hidden = !t.specialOpen;
  if (!t.specialOpen) return;

  renderTurnOrderSpecialPickerInto('btnSpecialPlayerClassic', 'btnSpecialNemesisClassic', 'tordSpecialPickerRowClassic');
}

/* ================================================================================================
   Feste-/Erzfeind-Zähler (0–99, Schritt 1, an den Grenzen deaktiviert). Zustand liegt in
   app.runtime.hp (siehe freshRuntimeState()) und wird damit automatisch über saveActiveSlot()
   persistiert — kein eigener Modul-State wie noch im Test-Prototyp.
   ================================================================================================ */
function clampHp(v) { return Math.max(0, Math.min(99, v)); }

// Schwierigkeit ("Leicht"/"Normal", plan.difficulty) — steuert ausschließlich die Start-Werte der
// Feste-/Erzfeind-Zähler, siehe createExpedition() (Kampagnenerstellung) und
// startNewTurnOrderFight() (Kampfstart). Kein Einfluss auf sonstige Spiellogik (Party-Größe,
// Kartenaufbau etc.) — analog zu "easyMode" bewusst als reine Zähler-Markierung gehalten.
// Alte Spielstände ohne dieses Feld gelten als "normal" (Default, siehe generateExpeditionPlan()).
function festeStartValue(plan) {
  return plan.difficulty === 'leicht' ? 35 : 30;
}

// X = Erzfeind-Leben - 10 bei "Leicht"; ergäbe das < 0, wird stattdessen das im Code definierte
// Erzfeind-Leben (nem.health) unverändert genutzt (Nutzer-Vorgabe).
function nemesisStartHealth(nem, plan) {
  const baseHealth = nem ? Number(nem.health) || 0 : 0;
  if (plan && plan.difficulty === 'leicht') {
    const reduced = baseHealth - 10;
    return reduced < 0 ? baseHealth : reduced;
  }
  return baseHealth;
}

function renderHpCounters() {
  const hp = app.runtime.hp;
  el('hpFesteValue').textContent = String(hp.feste);
  el('hpErzfeindValue').textContent = String(hp.erzfeind);
  el('btnFesteMinus').disabled = hp.feste <= 0;
  el('btnFestePlus').disabled = hp.feste >= 99;
  el('btnErzfeindMinus').disabled = hp.erzfeind <= 0;
  el('btnErzfeindPlus').disabled = hp.erzfeind >= 99;
}

function bumpHp(key, delta) {
  const hp = app.runtime.hp;
  hp[key] = clampHp(hp[key] + delta);
  playSfx(delta > 0 ? 'navigation_forward' : 'navigation_backward');
  renderHpCounters();
  saveActiveSlot();
}

/* Scroll-Lock: Zähler statt einfachem Boolean, da zwei Overlays theoretisch unabhängig geöffnet/
   geschlossen werden könnten (aktuell nicht gleichzeitig genutzt, aber so bleibt es robust). */
let tabletOverlayOpenCount = 0;
function openTabletOverlay(overlayEl) {
  overlayEl.hidden = false;
  tabletOverlayOpenCount++;
  document.body.classList.add('tablet-scroll-lock');
}
function closeTabletOverlay(overlayEl) {
  overlayEl.hidden = true;
  tabletOverlayOpenCount = Math.max(0, tabletOverlayOpenCount - 1);
  if (tabletOverlayOpenCount === 0) document.body.classList.remove('tablet-scroll-lock');
}

// ---- Rendering: Optionen — Reihenfolge-Randomizer, Erweiterte Regeln ----
// Checkbox-Wiring folgt demselben Muster wie renderMarketSetups() (onchange direkt im Render
// zugewiesen, statt einer separaten Event-Wiring-Registrierung) — idempotent bei jedem erneuten
// Aufruf von renderOptions().
function renderTurnOrderRuleOptions() {
  const noTriple = el('optRuleNoTriple');
  const noFirstTurn = el('optRuleNoFirstTurn');
  if (!noTriple || !noFirstTurn) return;
  noTriple.checked = app.options.turnOrderRules.noTriple;
  noFirstTurn.checked = app.options.turnOrderRules.noFirstTurn;
  noTriple.onchange = () => {
    app.options.turnOrderRules.noTriple = noTriple.checked;
    playSfx(noTriple.checked ? 'navigation_select' : 'navigation_deselect');
    saveOptions();
  };
  noFirstTurn.onchange = () => {
    app.options.turnOrderRules.noFirstTurn = noFirstTurn.checked;
    playSfx(noFirstTurn.checked ? 'navigation_select' : 'navigation_deselect');
    saveOptions();
  };
}

// Toggle zwischen klassischem und Tablet-Kampf-Detail-Screen (siehe renderTurnOrder()).
// Ändert die Anzeige NICHT sofort live (der Options-Screen zeigt ja nicht den Kampf-Screen) —
// wirkt erst beim nächsten Aufruf von renderBattle().
function renderTabletModeOption() {
  const cb = el('optTabletMode');
  if (!cb) return;
  cb.checked = app.options.tabletMode;
  cb.onchange = () => {
    app.options.tabletMode = cb.checked;
    playSfx(cb.checked ? 'navigation_select' : 'navigation_deselect');
    saveOptions();
  };
}

// Checkbox "Finale Niederlage nach 3 verlorenen Kämpfen gegen denselben Erzfeind" (siehe
// finalizeLoss()). Default AN — Nutzer-Vorgabe.
function renderFinalDefeatOption() {
  const cb = el('optFinalDefeat');
  if (!cb) return;
  cb.checked = app.options.finalDefeat;
  cb.onchange = () => {
    app.options.finalDefeat = cb.checked;
    playSfx(cb.checked ? 'navigation_select' : 'navigation_deselect');
    saveOptions();
  };
}

// ---------- Rendering: Niederlage/Sieg-Screens ----------

// Baut die Kartenvorderseite passend zur gezogenen Kategorie (Magier/Markt-Karte/Schatz) —
// wiederverwendet dieselben Bausteine wie die übrigen Kartenansichten (mageCardHtml() etc.),
// damit die gezogene Karte optisch identisch zu ihrer späteren Darstellung wirkt.
function lossRewardCardFrontHtml(category, card) {
  if (category === 'Magier') return mageCardHtml(card);
  if (category.startsWith('Schatz-Tier-')) return treasureCardHtml(card);
  return marketplaceCardChipHtml(card);
}
function lossRewardAccentStyle(category, card) {
  if (category === 'Magier') return cardAccentStyle('Magier');
  if (category.startsWith('Schatz-Tier-')) return cardAccentStyle(treasureAccentKey(card));
  return cardAccentStyle(card.subtype);
}

function renderLossReward() {
  const nem = currentNemesis();
  const defeatText = nem && AEONS_DATA.nemesisDefeatTexts ? AEONS_DATA.nemesisDefeatTexts[nem.id] : '';
  el('lossDefeatText').textContent = defeatText || 'Die Feste der Letzten Ruhe ist auf 0 Trefferpunkte gefallen.';

  // "Zurück" bleibt durchgängig sichtbar/klickbar — auch nach dem Ziehen einer Karte macht
  // undoLossReward() die Kategorie-Wahl inkl. bereits committeter Kaserne-Karte wieder ungeschehen
  // (analog zum Sieg-Flow, siehe undoWinReward()).
  const category = app.runtime.pendingLossCategory;
  const drawn = !!category;

  const select = el('lossCategorySelect');
  // Punkt 37: "Zufall" steht zuerst in der Liste und ist die Vorbelegung — wer einfach nur
  // schnell weiterspielen will, muss die Kategorie nicht erst bewusst wählen.
  if (!drawn) {
    // "Zufall" bleibt fest an erster Stelle und Vorbelegung (siehe Kommentar oben) — nur die
    // übrigen Kategorien werden alphabetisch nach ihrem angezeigten Label sortiert.
    const sortedCats = availableLossCategories()
      .slice()
      .sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), 'de'));
    select.innerHTML = `<option value="Zufall">Zufall</option>`
      + sortedCats.map((c) => `<option value="${c}">${categoryLabel(c)}</option>`).join('');
  }
  select.disabled = drawn;

  const revealed = app.runtime.pendingLossRevealed;
  const card = app.runtime.pendingLossCard;
  const area = el('lossRewardCardArea');
  if (!drawn) {
    // Punkt 37: "Unterstützung anfordern" sitzt jetzt oberhalb der (noch verdeckten) Karte,
    // innerhalb desselben Panels — analog zum "Beute aufdecken"-Button auf dem Sieg-Screen
    // (siehe renderWinReward()).
    area.innerHTML = `
      <div class="actions actions--start"><button class="btn btn--primary btn--small" id="btnLossRewardDraw">Unterstützung anfordern</button></div>
      <div class="chipgrid market-grid">${flipCardHtml('', '', false, 0, false)}</div>`;
    const btnDraw = el('btnLossRewardDraw');
    if (btnDraw) btnDraw.addEventListener('click', () => drawLossRewardNow(select.value));
  } else if (!card) {
    area.innerHTML = `<div class="chip">Kein Nachschub für ${categoryLabel(category)} mehr verfügbar.</div>`;
  } else {
    const frontHtml = lossRewardCardFrontHtml(category, card);
    const accent = lossRewardAccentStyle(category, card);
    // sizeVariant (siehe styles.css): Magier bleibt unslim, Schatz-Tier-* bekommt die
    // Schatz-Variante, alles andere (Zauber/Kristall/Relic) die Markt-Variante.
    const sizeVariant = category === 'Magier' ? undefined : (category.startsWith('Schatz-Tier-') ? 'slim-treasure' : 'slim');
    area.innerHTML = `<div class="chipgrid market-grid">${flipCardHtml(frontHtml, accent, revealed, 0, false, sizeVariant, category === 'Magier')}</div>`;
  }

  // Punkt 37: "Weiter" bleibt dauerhaft rechts unten sichtbar (an derselben Stelle, an der zuvor
  // "Unterstützung anfordern" stand) und wird erst klickbar, sobald die Karte aufgedeckt ist.
  el('btnLossRewardNext').disabled = !revealed;
}

// Punkt 27: Rückseite einer verdeckten Beute-Karte (Booster-Pack-Optik).
function flipCardBackHtml() {
  return `<div class="flipcard__face flipcard__face--back"><span class="flipcard__sigil">✺</span></div>`;
}

// Punkt 27/28/32/33: eine einzelne Flip-Karte — verdeckt oder aufgedeckt, optional mit
// Stagger-Delay (delayIndex) für die gestaffelte Gruppen-Animation (WIN_REWARD_REVEAL_STAGGER_MS).
// loot.wav läuft nur einmal pro Klick (siehe revealWinRewardMarket/Treasure), nicht mehr je Karte.
// storyRelevant (Punkt 33) ersetzt das vorherige, hart auf JEDE Karte gesetzte "selected"-Häkchen:
// nur wenn true, bekommt die Karte die eigene Markierung .card--story-relevant (siehe styles.css).
// sizeVariant (Nutzer-Wunsch, siehe .card--slim/.card--slim-treasure in styles.css): 'slim' für
// Zauber/Kristall/Relic-Beute, 'slim-treasure' für Schatz-Beute (beide dieselbe --card-h, damit
// keine Kartenart größer wirkt als die andere) — Magier behält die volle Kartenhöhe (kein
// sizeVariant). --card-h ist eine vererbte Custom Property, daher muss die Größen-Klasse
// zusätzlich am äußeren .flipcard-Wrapper sitzen (nicht nur an der Vorderseite), sonst würden
// Rück- und Vorderseite während der Flip-Animation unterschiedlich hoch sein.
// Bug-Fix (Niederlage-Screen, 2026-09-25): Bei sizeVariant === undefined (Magier-Ziehung) fehlte
// bislang die Klasse .card--mage auf der Kartenvorderseite — mageCardHtml() rendert aber
// card__title (Untertitel, z.B. "Riss-Magier-Soldatin") nur dann korrekt in eigener Grid-Zeile 2,
// wenn .card--mage .card__name (Grid-Zeile 1) aktiv ist (siehe styles.css). Ohne diese Klasse
// rutschte card__name in die globale Zeile 2 und überlappte dort mit card__title/dem
// Hintergrund-Symbol. Fix: isMage-Flag setzt .card--mage explizit, unabhängig von sizeVariant.
function flipCardHtml(frontHtml, accentStyle, revealed, delayIndex, storyRelevant, sizeVariant, isMage) {
  const delay = revealed ? ` style="transition-delay:${delayIndex * WIN_REWARD_REVEAL_STAGGER_MS}ms"` : '';
  const frontClass = `flipcard__face flipcard__face--front card${isMage ? ' card--mage' : ''}${sizeVariant ? ` card--${sizeVariant}` : ''}${storyRelevant ? ' card--story-relevant' : ''}`;
  return `<div class="flipcard${revealed ? ' flipcard--revealed' : ''}${sizeVariant ? ` flipcard--${sizeVariant}` : ''}">
    <div class="flipcard__inner"${delay}>
      ${flipCardBackHtml()}
      <div class="${frontClass}" style="${accentStyle}">${frontHtml}</div>
    </div>
  </div>`;
}

function renderWinBanish() {
  if (!app.runtime.pendingWinRewardReveal) app.runtime.pendingWinRewardReveal = { treasure: false };
  const grid = el('winBanishGrid');
  grid.innerHTML = '';
  const sel = app.runtime.pendingWinBanishSelection;
  const newCards = Object.values(app.runtime.pendingWinRewards || {}).filter(Boolean);
  const newCardIds = new Set(newCards.map((c) => c.id));

  // Punkt 46: dieselbe Gruppen-/Warnhinweis-Struktur wie in der Kaserne (siehe
  // renderBarracksPanel()) — jeder Typ bekommt eine eigene .barracks-group mit fester ID, damit
  // focusWinBanishIssue() bei einer unvollständigen Auswahl gezielt dorthin scrollen und sie
  // per .barracks-group--attention visuell hervorheben kann (statt nur den Bestätigen-Button
  // zu sperren).
  ['Zauber', 'Kristall', 'Relic'].forEach((subtype) => {
    const candidates = marketplaceCardsBySubtypeCurrent(subtype);
    const target = { Zauber: 4, Kristall: 3, Relic: 2 }[subtype];
    const done = Boolean(sel[subtype]);

    const group = document.createElement('div');
    group.className = 'barracks-group';
    group.id = `winBanishGroup-${subtype}`;
    grid.appendChild(group);

    const label = document.createElement('h3');
    label.className = 'group-label';
    label.innerHTML = `${categoryLabel(subtype)} — 1 von ${candidates.length} Karten auswählen, die in die Kaserne wandert (aktiv bleiben ${target})`
      + (done ? '' : '<span class="barracks-group__warn">Auswahl unvollständig</span>');
    group.appendChild(label);

    const row = document.createElement('div');
    row.className = 'chipgrid market-grid';
    candidates.forEach((c) => {
      const chip = document.createElement('div');
      const active = sel[subtype] === c.id;
      // Punkt 35: roter Rahmen + "×" statt grün/✓ — die ausgewählte Karte verlässt hier den
      // aktiven Marktplatz (siehe confirmWinBanish()), ein Häkchen würde das Gegenteil suggerieren.
      chip.className = 'card card--slim' + (active ? ' card--banish-pick' : '') + (newCardIds.has(c.id) ? ' new-card' : '');
      chip.style.cssText = cardAccentStyle(c.subtype);
      chip.innerHTML = marketplaceCardChipHtml(c) + (newCardIds.has(c.id) ? '<span class="card__sublabel">NEU</span>' : '');
      chip.onclick = () => selectWinBanishCard(subtype, c.id);
      bindHoverSfx(chip);
      row.appendChild(chip);
    });
    group.appendChild(row);
  });

  const subtypes = ['Kristall', 'Relic', 'Zauber'];
  const banishDoneCount = subtypes.filter((s) => sel[s]).length;

  // Punkt 24: Schatzauswahl (falls diese Kampfstufe einen Schatz vergibt) ist jetzt Teil
  // desselben Screens wie der Marktplatzausgleich.
  const award = app.runtime.pendingTreasureAward;
  const treasureGrid = el('winTreasureGrid');
  const reveal = app.runtime.pendingWinRewardReveal;
  let treasureDone = true;
  if (award) {
    treasureGrid.hidden = false;
    const treasureRevealed = reveal.treasure;
    treasureDone = treasureRevealed && award.selectedIds.length === award.requiredCount;
    const drawCount = award.tier === 2 ? 3 : 5;
    const hint = award.tier === 2
      ? `Die Gruppe hat ${drawCount} Kandidaten der Stufe II gezogen. Wähle genau 1 davon als gemeinsamen Gruppen-Schatz — der Rest geht ungenutzt in die Kaserne.`
      : `Die Gruppe hat ${drawCount} Kandidaten der Stufe ${romanTier(award.tier)} gezogen. Jeder Spieler wählt genau 1 (${award.requiredCount} von ${award.candidates.length}) — der Rest geht ungenutzt in die Kaserne.`;
    // Schätze werden (im Unterschied zu Zauber/Kristall/Artefakt, die direkt mit "NEU" gezeigt
    // werden) weiterhin verdeckt gezogen und erst per Button gemeinsam aufgedeckt — das einzige
    // verbliebene Reveal-Feature aus dem ausgebauten screen-win-reward (siehe
    // archive/win-reward-screen.html). "NEU" wird hier bewusst NICHT angezeigt (Nutzerwunsch).
    const revealBtn = treasureRevealed ? '' : `<button class="btn btn--primary btn--small" id="btnRevealWinRewardTreasure">Alle Schätze aufdecken</button>`;
    treasureGrid.innerHTML = `
      <div class="barracks-group" id="winBanishGroup-Treasure">
        <h3 class="group-label">Schätze Stufe ${romanTier(award.tier)}${(!treasureDone && treasureRevealed) ? '<span class="barracks-group__warn">Auswahl unvollständig</span>' : ''}</h3>
        <p class="panel__hint">${hint}</p>
        <div class="actions actions--start">${revealBtn}</div>
        <div class="chipgrid market-grid">${award.candidates.map((t, i) => {
          const selected = award.selectedIds.includes(t.id);
          // card--slim-treasure (siehe styles.css): dieser Screen zeigt Schätze zusammen mit den
          // (jetzt slimmen) Zauber/Kristall/Relic-Ausgleichsgruppen — ohne die Schatz-Variante
          // wären sie hier 20px höher als die Nachbarkarten. flipCardHtml() übernimmt die
          // gestaffelte Aufdeck-Animation (siehe WIN_REWARD_REVEAL_STAGGER_MS); Klick zum
          // Aus-/Abwählen (data-treasure-id auf dem Wrapper) greift erst nach dem Reveal
          // (siehe toggleTreasureCandidate()). ".selected" auf dem Wrapper statt auf .card, da die
          // Vorderseite hinter der Flip-Rückseite versteckt ist — siehe styles.css für das Mapping.
          return `<div class="flipcard-treasure-slot${selected ? ' selected' : ''}" data-treasure-id="${escapeHtml(t.id)}">${flipCardHtml(treasureCardHtml(t), cardAccentStyle(treasureAccentKey(t)), treasureRevealed, i, false, 'slim-treasure')}</div>`;
        }).join('')}</div>
      </div>`;
    const btnRevealTreasure = el('btnRevealWinRewardTreasure');
    if (btnRevealTreasure) btnRevealTreasure.addEventListener('click', revealWinRewardTreasure);
    if (treasureRevealed) {
      treasureGrid.querySelectorAll('[data-treasure-id]').forEach((chipEl) => {
        chipEl.onclick = () => toggleTreasureCandidate(chipEl.getAttribute('data-treasure-id'));
        bindHoverSfx(chipEl);
      });
    }
  } else {
    treasureGrid.hidden = true;
    treasureGrid.innerHTML = '';
  }

  // Punkt 46: kein Fortschrittszähler mehr — der Bestätigen-Button bleibt (wie in der Kaserne)
  // aktiv, unvollständige Auswahlen werden erst beim Klick über focusWinBanishIssue() abgefangen.
  const ok = banishDoneCount === 3 && treasureDone;
  el('winBanishHint').textContent = ok
    ? 'Alle Vorgaben erfüllt — bereit zum Bestätigen.'
    : 'Bitte für jeden Typ (Zauber, Kristall, Artefakt) genau 1 Karte sowie, falls vorhanden, die Schatzauswahl vervollständigen.';
}

// Punkt 36: Marktplatz-Ausgleich nach einer Niederlage — analog zu renderWinBanish(), aber nur
// für den einen betroffenen Subtyp (Niederlage zieht immer nur 1 Karte einer Kategorie, nie alle
// drei Markt-Subtypen gleichzeitig wie beim Sieg).
function renderLossBanish() {
  const subtype = app.runtime.pendingLossCategory;
  const newCard = app.runtime.pendingLossCard;
  const candidates = marketplaceCardsBySubtypeCurrent(subtype);
  const target = { Zauber: 4, Kristall: 3, Relic: 2 }[subtype];
  const sel = app.runtime.pendingLossBanishSelection;

  const grid = el('lossBanishGrid');
  grid.innerHTML = '';
  const label = document.createElement('h3');
  label.className = 'group-label';
  label.textContent = `${categoryLabel(subtype)} — 1 von ${candidates.length} Karten auswählen, die in die Kaserne wandert (aktiv bleiben ${target})`;
  grid.appendChild(label);

  const row = document.createElement('div');
  row.className = 'chipgrid market-grid';
  candidates.forEach((c) => {
    const chip = document.createElement('div');
    const active = sel === c.id;
    const isNew = !!newCard && c.id === newCard.id;
    // Punkt 35 (siehe renderWinBanish()): roter Rahmen + "×" statt grün/✓ — die ausgewählte
    // Karte verlässt hier den aktiven Marktplatz (siehe confirmLossBanish()).
    chip.className = 'card card--slim' + (active ? ' card--banish-pick' : '') + (isNew ? ' new-card' : '');
    chip.style.cssText = cardAccentStyle(c.subtype);
    chip.innerHTML = marketplaceCardChipHtml(c) + (isNew ? '<span class="card__sublabel">NEU</span>' : '');
    chip.onclick = () => selectLossBanishCard(c.id);
    bindHoverSfx(chip);
    row.appendChild(chip);
  });
  grid.appendChild(row);

  el('lossBanishHint').textContent = sel
    ? 'Auswahl getroffen — bereit zum Bestätigen.'
    : 'Wähle genau 1 Karte (bestehende oder die neu gezogene), die in die Kaserne wandert — nichts wird dauerhaft verbannt.';
  el('btnConfirmLossBanish').disabled = !sel;
}

// ---------- Rendering: Generate-Screen (Copy&Paste) ----------

function renderGenerate() {
  renderBuildProgress('generate');
  el('genPromptText').value = buildPromptText(app.runtime.genUserMessage);
  el('genResponseInput').value = '';
}

// ---------- Main dispatcher ----------

function renderScreen() {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = true; });
  // Die Kampf-Overlays (#overlayDeck/#overlayDiscard) liegen als Geschwister von #screen-battle
  // außerhalb von .screen und werden daher von obiger Zeile NICHT automatisch geschlossen — ohne
  // diesen Guard könnten sie beim Verlassen des Kampf-Screens (z.B. "Zurück zur Übersicht" bei
  // offenem Deck-Overlay) sichtbar über dem neuen Screen liegen bleiben.
  if (app.step !== 'battle') {
    const deckOv = el('overlayDeck');
    const discardOv = el('overlayDiscard');
    if (deckOv && !deckOv.hidden) closeTabletOverlay(deckOv);
    if (discardOv && !discardOv.hidden) closeTabletOverlay(discardOv);
  }
  const topbar = el('topbar');
  // Topbar ausgeblendet auf der Startseite und im Kampf-Screen des Tablet-Modus (dort hat der Screen
  // eigene Navigation, "Zurück"; der Platz wird für das 3-Spalten-Layout gebraucht).
  topbar.hidden = app.step === 'home' || (app.step === 'battle' && !!app.options.tabletMode);

  // Expeditions-Info (Name · Seed · Score) nur auf Screens der laufenden Expedition — nicht auf
  // Startseite, Optionen, Chronik und "Neue Expedition", auch wenn app.plan dort noch gesetzt ist
  // (z. B. nach "Zurück" aus dem Aufbau, ohne backToHome()).
  const NO_EXPEDITION_INFO_STEPS = ['home', 'options', 'chronicle', 'new-expedition'];
  if (app.plan && !NO_EXPEDITION_INFO_STEPS.includes(app.step)) {
    el('topbarInfo').textContent = `${app.plan.name} · Seed ${app.plan.seed} · Score ${app.runtime ? app.runtime.score : 0}`;
  } else {
    el('topbarInfo').textContent = '';
  }

  const show = (id) => { el(id).hidden = false; };

  switch (app.step) {
    case 'home': show('screen-home'); renderHome(); break;
    case 'options': show('screen-options'); renderOptions(); break;
    case 'chronicle': show('screen-chronicle'); renderChronicle(); break;
    case 'new-expedition': show('screen-new-expedition'); renderNewExpedition(); break;
    case 'build-party': show('screen-build-party'); renderBuildParty(); break;
    case 'build-market': show('screen-build-market'); renderBuildMarket(); break;
    case 'build-nemesis': show('screen-build-nemesis'); renderBuildNemesis(); break;
    case 'generate': show('screen-generate'); renderGenerate(); break;
    case 'overview': show('screen-overview'); renderOverview(); break;
    case 'story': show('screen-story'); renderStory(); break;
    case 'battle': show('screen-battle'); renderBattle(); break;
    case 'loss-reward': show('screen-loss-reward'); renderLossReward(); break;
    case 'loss-banish': show('screen-loss-banish'); renderLossBanish(); break;
    case 'win-banish': show('screen-win-banish'); renderWinBanish(); break;
    case 'victory': show('screen-victory'); renderVictory(); break;
    case 'game-over': show('screen-game-over'); renderGameOver(); break;
    default: show('screen-home'); renderHome();
  }
}

// ---------- Event-Wiring ----------

el('btnNewExpedition').addEventListener('click', () => {
  if (!canCreateNewExpedition()) return;
  playSfx('create_expedition');
  goto('new-expedition');
});
el('btnOptions').addEventListener('click', () => { playSfx('navigation_forward'); goto('options'); });
el('btnOptionsBack').addEventListener('click', () => { playSfx('navigation_backward'); goto('home'); });
el('btnChronicle').addEventListener('click', () => { playSfx('navigation_forward'); goto('chronicle'); });
el('btnChronicleBack').addEventListener('click', () => { playSfx('navigation_backward'); goto('home'); });
el('btnChronicleReset').addEventListener('click', () => {
  if (confirm('Legenden der Feste wirklich zurücksetzen? Alle Errungenschaften, Bestleistungen und das Erzfeind-Ranking werden gelöscht.')) {
    resetStats();
    playSfx('delete');
  }
});
el('btnResetMageTiers').addEventListener('click', () => {
  app.options.mageTiers = {};
  saveOptions();
  renderMageTiers();
});
el('btnNewExpeditionBack').addEventListener('click', () => { playSfx('navigation_backward'); goto('home'); });
el('btnCreateExpedition').addEventListener('click', createExpedition);
el('btnTopbarHome').addEventListener('click', backToHome);

el('btnBuildPartyNext').addEventListener('click', confirmBuildParty);
el('btnBuildPartyBack').addEventListener('click', () => { playSfx('navigation_backward'); goto('home'); });
el('btnBuildMarketNext').addEventListener('click', () => { playSfx('navigation_forward'); goto('build-nemesis'); });
el('btnBuildMarketBack').addEventListener('click', () => { playSfx('navigation_backward'); goto('build-party'); });
el('btnBuildNemesisNext').addEventListener('click', startCampaign);
el('btnBuildNemesisBack').addEventListener('click', () => { playSfx('navigation_backward'); goto('build-market'); });
// Punkt 40: "Weiter ohne Erzählung" bereits hier anbieten, damit der Generierungs-Screen
// komplett übersprungen werden kann — nutzt dieselbe skipStory()-Logik wie bisher.
el('btnBuildNemesisSkipStory').addEventListener('click', skipStory);

el('btnGenerateBack').addEventListener('click', () => { playSfx('navigation_backward'); goto(app.runtime.genBackStep); });
el('btnSubmitGeneration').addEventListener('click', submitGeneration);
el('btnSkipStory').addEventListener('click', skipStory);
el('btnCopyPrompt').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(el('genPromptText').value);
    showToast('Prompt in die Zwischenablage kopiert.', 'confirm');
  } catch (e) {
    // Auf manchen Tablets (z.B. iPad Safari ohne Nutzergeste-Kontext) schlägt die Clipboard-API
    // fehl. Der Prompt steht bereits sichtbar im Vorschaukasten (siehe screen-generate) — hier
    // nur noch markieren und auf die manuelle Kopie per Kontextmenü/Strg+C hinweisen.
    const box = el('genPromptText');
    box.focus();
    box.select();
    showToast('Automatisches Kopieren nicht möglich — Text oben ist markiert, kopiere ihn manuell (Kontextmenü oder Strg/Cmd+C).');
  }
});

// Story-Zwischenscreen (siehe renderStory()/openNextBattle()): "Zurück" verwirft den Reveal-
// Zwischenstand nicht (nemesisRevealedOnce bleibt gesetzt) und führt einfach zur Übersicht
// zurück; "Kampf starten" navigiert wie der bisherige direkte Sprung zum Kampf-Detail-Screen
// inkl. start_battle-Sound.
el('btnStoryBack').addEventListener('click', () => { playSfx('navigation_backward'); goto('overview'); });
el('btnStoryStart').addEventListener('click', () => {
  goto('battle');
  playSfx('start_battle');
});

// Als benannte Handler ausgelagert, damit sowohl die Tablet- als auch die Classic-Ansicht
// (btnBattle*Classic, siehe Tablet-Modus-Toggle) dieselbe Logik nutzen können.
function handleBattleBackOverviewClick() { playSfx('navigation_backward'); goto('overview'); }
function handleBattleLossClick() {
  // Ist die Option "Finale Niederlage..." aktiv und wird diese Niederlage die 3. in Folge gegen
  // denselben Erzfeind, entfällt der übliche Beute-Flow ("Unterstützung anfordern",
  // screen-loss-reward) komplett — die Gruppe erhält bei einer endgültigen Niederlage keine
  // Belohnung mehr, daher direkt auf den Game-Over-Screen (siehe triggerFinalDefeat()), statt
  // erst noch eine Kategorie wählen zu lassen.
  const willBeFinalDefeat = app.options.finalDefeat && (app.runtime.triesPerFight[app.runtime.fightIndex] + 1) >= 3;
  if (willBeFinalDefeat) { triggerFinalDefeat(); return; }
  playSfx('battle_lost');
  goto('loss-reward');
}
function handleBattleWinClick() {
  // Punkt 45: der letzte Kampf (Index 3) führt direkt auf die Siegesseite (finishExpedition())
  // statt in den Beute-Flow — "completion" erklingt dort erst nach dem Laden, nicht hier beim Klick.
  if (app.runtime.fightIndex === 3) {
    finishExpedition();
  } else {
    playSfx('victory');
    startWinFlow();
  }
}

el('btnBattleBackOverview').addEventListener('click', handleBattleBackOverviewClick);
el('btnBattleLoss').addEventListener('click', handleBattleLossClick);
el('btnBattleWin').addEventListener('click', handleBattleWinClick);
el('btnVictoryHome').addEventListener('click', backToHome);
el('btnGameOverHome').addEventListener('click', backToHome);
// createExpedition() überschreibt app.plan/app.runtime beim Absenden ohnehin vollständig
// (siehe dort) — daher genügt hier ein direkter goto(), ohne Reset-Logik. Die Max-3-Sperre wird
// über startNewExpeditionFromCompletion() geprüft, inkl. der Ausnahme für bereits abgeschlossene
// Expeditionen (siehe dort).
el('btnVictoryNewExpedition').addEventListener('click', startNewExpeditionFromCompletion);
el('btnGameOverNewExpedition').addEventListener('click', () => {
  // AC: derselbe Soundeffekt wie auf der Siegesseite (create_expedition), NICHT battle_lost/
  // game_over — dieser Klick verlässt den Game-Over-Zustand bereits wieder.
  playSfx('create_expedition');
  startNewExpeditionFromCompletion();
});

el('btnLossRewardBack').addEventListener('click', undoLossReward);
el('btnLossRewardNext').addEventListener('click', continueAfterLossReveal);
el('btnConfirmLossBanish').addEventListener('click', confirmLossBanish);
el('btnLossBanishBack').addEventListener('click', undoLossReward);

el('btnWinBanishBack').addEventListener('click', undoWinReward);
el('btnConfirmWinBanish').addEventListener('click', confirmWinBanish);

// ---- Reihenfolge-Randomizer (Kampf-Detail) — Tablet-Layout, gemergt aus tablet-combat.html ----
el('tabletActiveCard').addEventListener('click', advanceTurnOrder);
el('btnTabletPeek').addEventListener('click', toggleTurnOrderPeek);

el('tabletDeckStack').addEventListener('click', () => {
  playSfx('navigation_forward');
  openTabletOverlay(el('overlayDeck'));
  renderDeckOverlay();
});
el('btnCloseDeckOverlay').addEventListener('click', () => { playSfx('navigation_backward'); closeTabletOverlay(el('overlayDeck')); });
el('overlayDeck').addEventListener('click', (e) => { if (e.target === e.currentTarget) { playSfx('navigation_backward'); closeTabletOverlay(e.currentTarget); } });

el('tabletDiscardSlot').addEventListener('click', () => {
  playSfx('navigation_forward');
  openTabletOverlay(el('overlayDiscard'));
  renderDiscardOverlay();
  renderTurnOrderSpecialTablet();
});
el('btnCloseDiscardOverlay').addEventListener('click', () => { playSfx('navigation_backward'); closeTabletOverlay(el('overlayDiscard')); });
el('overlayDiscard').addEventListener('click', (e) => { if (e.target === e.currentTarget) { playSfx('navigation_backward'); closeTabletOverlay(e.currentTarget); } });

el('btnSpecialPlayer').addEventListener('click', () => setTurnOrderSpecialPickerMode('player'));
el('btnSpecialNemesis').addEventListener('click', () => setTurnOrderSpecialPickerMode('nemesis'));

el('btnFesteMinus').addEventListener('click', () => bumpHp('feste', -1));
el('btnFestePlus').addEventListener('click', () => bumpHp('feste', 1));
el('btnErzfeindMinus').addEventListener('click', () => bumpHp('erzfeind', -1));
el('btnErzfeindPlus').addEventListener('click', () => bumpHp('erzfeind', 1));

// Klick auf den Zahlen-Kreis im Erzfeind-Counter (Tablet-Kampf-Screen): spielt den zum aktuell
// aktiven Erzfeind passenden Nemesis-Sound (dieselbe Sound-Quelle wie beim Enthüllen der
// Erzfeind-Kachel, siehe revealNemesisTile()/NEMESIS_SFX_FILES). Rein kosmetisch, verändert
// keinen Zähler-Zustand.
el('hpErzfeindValue').addEventListener('click', () => {
  playNemesisRevealSfx(app.plan.nemesisOrder[app.runtime.fightIndex]);
});

// Klick auf den Zahlen-Kreis im Feste-Counter (Tablet-Kampf-Screen): spielt "gravehold.mp3" ab
// (Nutzerwunsch, 2026-09-26; Datei ehemals "waiting.mp3") — analog zum Erzfeind-Zahlen-Kreis
// oben, aber mit fixem Sound statt nemesisabhängigem. Rein kosmetisch, verändert keinen
// Zähler-Zustand.
el('hpFesteValue').addEventListener('click', () => {
  playSfx('gravehold');
});

// ---- Reihenfolge-Randomizer (Kampf-Detail) — CLASSIC-Layout, wiederherstellt aus
// turn-order-randomizer-prototype.html (siehe Options-Toggle "Tablet-Modus", Standard = aus). ----
el('btnAdvanceTurnClassic').addEventListener('click', advanceTurnOrder);
el('btnPeekClassic').addEventListener('click', toggleTurnOrderPeek);
el('btnRevealDeckClassic').addEventListener('click', toggleTurnOrderRevealClassic);
el('btnHideRevealClassic').addEventListener('click', toggleTurnOrderRevealClassic);
el('btnToggleSpecialClassic').addEventListener('click', toggleTurnOrderSpecial);
el('btnSpecialPlayerClassic').addEventListener('click', () => setTurnOrderSpecialPickerMode('player'));
el('btnSpecialNemesisClassic').addEventListener('click', () => setTurnOrderSpecialPickerMode('nemesis'));

el('btnBattleBackOverviewClassic').addEventListener('click', handleBattleBackOverviewClick);
el('btnBattleLossClassic').addEventListener('click', handleBattleLossClick);
el('btnBattleWinClassic').addEventListener('click', handleBattleWinClick);

// Leertaste = Zug beenden & nächste Karte, außer der Fokus liegt gerade auf einem Formularelement
// (Checkbox/Select/Button etc.) — dort soll Leertaste ihr natives Verhalten behalten. Zusätzlich
// (Abweichung vom Prototyp, der nur eine einzelne Standalone-Seite war): nur aktiv, während der
// Kampf-Screen tatsächlich sichtbar ist, damit Leertaste auf anderen Screens nicht ungewollt einen
// Zug im Hintergrund weiterschaltet.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  if (app.step !== 'battle') return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'select', 'textarea', 'button'].includes(tag)) return;
  e.preventDefault();
  advanceTurnOrder();
});

// Spielzeit-Tracking (Bugfix 2026-10-05, siehe freshRuntimeState()): Bildschirmsperre, App im
// Hintergrund oder Tab-Wechsel dürfen die Spielzeit NICHT weiterzählen lassen, auch wenn der
// Kampf-Screen aktiv bleibt. visibilitychange ist der Standardweg dafür; pagehide/pageshow decken
// zusätzlich Fälle ab, in denen iOS Safari (v.a. als Home-Screen-Web-App) visibilitychange beim
// Sperren nicht zuverlässig meldet. app.runtime kann hier null sein (z.B. auf der Startseite) —
// pauseFightTimer()/resumeFightTimer() prüfen das selbst und tun in dem Fall nichts.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseFightTimer();
    if (app.runtime) saveActiveSlot();
  } else {
    resumeFightTimer();
  }
});
window.addEventListener('pagehide', () => {
  pauseFightTimer();
  if (app.runtime) saveActiveSlot();
});
window.addEventListener('pageshow', () => {
  resumeFightTimer();
});

init();

function init() {
  renderScreen();
  preloadAllSfx();
}
