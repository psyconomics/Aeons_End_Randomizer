# Chronik der Feste — (Expeditions-Generator)

/                        (Repo-Root = dieses Verzeichnis)
  index.html             — alle Screens als <section>
  styles.css             — gesamtes Styling
  data.js                — AEONS_DATA: Erweiterungen, Magier, Erzfeinde, Schätze, Marktplatzkarten
  plan.js                — deterministischer Seed-PRNG, ExpeditionPlan-Generator, Draw-Funktionen, Score-Formel
  achievements.js        — 40 Errungenschaften, Tracking-/Auswertungslogik, Badge-Rendering
  treasure-icons.js      — individuelle SVG-Icons und Akzentfarben der Schätze
  app.js                 — Zustand, Persistenz, alle Screens, Kampf-Logik, Story-Copy&Paste-Mechanik
  manifest.json          — PWA-Manifest ("Zum Home-Bildschirm hinzufügen")
  icons/                 — App-Icons, SVG-Marker (Æther etc.)
  soundeffects/          — Sound-Dateien (inkl. soundeffects/nemesis/)
  archive/               — Prototypen, Style-Guides, Review-Seiten, QA-Tabellen (nicht Teil der App)
```

Ladereihenfolge der Skripte (siehe `index.html`): `data.js` → `plan.js` → `achievements.js` →
`treasure-icons.js` → `app.js`.


## Archiv

`archive/` enthält alte Prototypen und Review-Seiten (z. B. `card-component-preview.html` als
lebender Karten-Style-Guide, `badge-component-preview.html`, `treasure-overview.html`,
`card-colors-compare.html`). Die Seiten verweisen per `../` auf `styles.css`, `data.js`, `plan.js`
und `icons/` und funktionieren daher nur, solange sie im Archiv-Ordner dieses Repos liegen und
über denselben Server geöffnet werden. `archive/qa/` enthält Review-Tabellen (Übersetzung,
Meilensteine).


## Seed-Mechanik

Jede Expedition hat einen `rngSeed` (String). Wird beim Erzeugen kein eigener
Seed eingegeben, wird ein zufälliger Seed erzeugt und angezeigt. Ab dann ist
**alles** deterministisch: Magier-Vorschläge, Erzfeind-Reihenfolge, Start-
Marktplatz, sowie jede spätere Sieg-/Niederlage-/Schatz-Ziehung. Grundlage ist
ein `mulberry32`-PRNG, dessen Startzustand aus `(rngSeed, fightIndex, kind,
attemptNumber)` per String-Hash abgeleitet wird (`plan.js`). `Math.random()`
wird nirgends zur Spiellogik verwendet — einzige Ausnahme ist die Erzeugung
eines neuen zufälligen Seed-*Strings*, wenn der Nutzer das Seed-Feld leer
lässt (das ist die Wurzel des Seeds, kein abgeleiteter Zug).

Das bedeutet: Zwei Expeditionen mit demselben Seed und denselben
Erweiterungs-Einstellungen laufen identisch ab (gleiche Magier-Vorschläge,
gleiche Erzfeinde in gleicher Reihenfolge, gleicher Start-Marktplatz, gleiche
Belohnungs-Ziehungen bei gleichen Entscheidungen).

## Aufbau-Flow

1. **Startseite** — Neue Expedition, bis zu 3 gespeicherte Expeditionen, Optionen.
2. **Optionen** — Erweiterungen für Magier/Erzfeinde/Schätze; zusätzlich
   können einzelne Erweiterungen speziell für den Marktplatz ausgeschlossen
   werden (z. B. wenn man die Marktplatzkarten einer Erweiterung nicht besitzt).
3. **Neue Expedition** — Name (Standard: heutiges Datum) + optionaler Seed.
   "Expedition erzeugen" ruft `generateExpeditionPlan()` auf und friert den
   `ExpeditionPlan` ein (5 Magier-Vorschläge, 4 Erzfeinde in aufsteigender
   Schwierigkeit, Start-Marktplatz 4 Zauber/3 Kristalle/2 Relics).
4. **Aufbau 3a–3c**: Charakterauswahl (bis zu 4 von 5) → Marktplatz-Vorschau
   (read-only) → Nemesis-Vorbereitung (informativ, alle 4 Erzfeinde in
   Reihenfolge zum physischen Bereitlegen).
5. Direkt danach: Kampagnen-Fahrplan (Copy&Paste mit Claude, wie V1) und
   anschließend Kapitel 1 (Prolog) — danach beginnt die eigentliche Expedition
   in der Übersicht.

## Kampf-Auflösung

- **Erzfeind-Kacheln**: `locked` (noch nicht erreicht), `revealed` (aktueller,
  klickbarer Kampf), `defeated`. Nur die `revealed`-Kachel ist klickbar.
- **Vor Kampf 2–4**: beim Öffnen der nächsten Kachel erscheint zuerst der
  Marktplatz-Reconfig-Screen — freie Neuzusammenstellung aus dem gesamten
  Vorrat, der zuletzt aktive Marktplatz ist vorausgewählt ("So übernehmen &
  weiter" spielt 1:1 mit dem bisherigen Marktplatz weiter). Erst danach wird
  das nächste Kapitel erzeugt (Copy&Paste) und der Kampf-Screen gezeigt.
- **Kampf-Screen**: zeigt (ab Kampf 2) Vor-dem-Kampf-Infos (Erweiterung,
  Schwierigkeit, Leben, Expedition Rating) sowie das aktuelle Kapitel, dann
  "Niederlage" / "Sieg".
- **Niederlage**: Kategorie wählen (Magier/Kristall/Relic/Zauber/ggf.
  Schatz-Tier passend zum aktuellen Kampf) → 1 Karte wird deterministisch
  gezogen. Bei Kristall/Relic/Zauber muss zusätzlich 1 Karte desselben Typs
  aus dem aktuellen Marktplatz gebannt werden (Invariante 4/3/2 bleibt
  erhalten). Der Kampf wird mit demselben Kapitel wiederholt; `triesPerFight`
  wird erhöht.
- **Sieg**: automatisch je 1 Kristall + 1 Relic + 1 Zauber gezogen, danach
  müssen genau 3 Karten aus dem kompletten aktuellen Marktplatz gebannt werden
  (Invariante 4/3/2 wird wiederhergestellt). Nach Kampf 1–3 zusätzlich eine
  Schatz-Kandidaten-Auswahl (Tier 1 & 3: bis zu 5 Kandidaten, Tier 2: bis zu 3).
  Nach Kampf 4 (Finale) gibt es keine weitere Schatzauswahl mehr, nur den
  Epilog.

## Score

Punktevergabe beim Bezwingen eines Erzfeindes, basierend auf der Anzahl der
Versuche (`tries`, 1 = im ersten Versuch gewonnen) — 1:1 aus dem
Original-Randomizer:

| Versuche | Punkte |
|---|---|
| 1 | 6 |
| 2 | 4 |
| 3 | 2 |
| ≥4 | 0 |

Die Summe über alle 4 Kämpfe ist der Gesamt-Score der Expedition.

## Story-Generierung (Copy & Paste)

Unverändert aus V1 übernommen: Die App baut einen vollständigen Prompt
(Systemanweisung + bisheriger Verlauf + neue Eingabe), der Nutzer kopiert ihn
in ein Claude-Fenster und fügt die Antwort zurück ein. Die App parst Titel,
Fließtext und den internen Kontinuitäts-Ledger-Block und übernimmt sie ins
Kapitel bzw. den Zustand. Wortzahl-Feedback wie in V1.

Neu in V2: Der Story-Prompt bekommt zusätzlich den **kompletten
ExpeditionPlan** als verdeckten Kontext (alle 4 Erzfeinde in Reihenfolge,
aktueller Marktplatz/Vorrat) — dadurch kann Claude von Kapitel 1 an konsistent
vorausdeuten. Sichtbar im Kapiteltext dürfen aber nur Erzfeinde bis zur
`storyRevealBoundary` (= aktueller `fightIndex`) beim Namen genannt werden;
alle späteren Erzfeinde dürfen nur vage angedeutet werden (Gerücht, Vorzeichen).

## Persistenz

Bis zu 3 Expeditionen werden komplett (ExpeditionPlan + RuntimeState) unter
dem `localStorage`-Schlüssel `chronikDerFeste_v2_slots` gespeichert. Jeder
Slot wird über eine eigenständige `plan.id` identifiziert (nicht über den
Seed — zwei Expeditionen können denselben, frei gewählten Seed haben, ohne
sich zu überschreiben). Sind bereits 3 Expeditionen gespeichert, ist "Neue
Expedition" (Startseite wie Siegesseite) gesperrt; der Nutzer muss zuerst eine
bestehende Kampagne löschen — es gibt keine stille FIFO-Verdrängung mehr. Die
Erweiterungs-Optionen liegen separat unter `chronikDerFeste_v2_options`; die dauerhafte Statistik (Errungenschaften,
Bestleistungen, Erzfeind-Ranking, Party-Kombinationen) separat unter `chronikDerFeste_v2_stats`.

