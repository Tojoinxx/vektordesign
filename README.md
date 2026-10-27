# Vektordesign

Maßgenaues 2D-Vektorgrafikprogramm für Textil-Designs. Die Bedienung folgt dem 2D-Skizzenmodus von Autodesk Inventor: **erst grob zeichnen, dann über Bemaßungen und Abhängigkeiten exakt festlegen** – die Geometrie passt sich automatisch an. Exportiert wird so, dass die Dateien direkt in der Bekleidungsproduktion (LabwearOS), auf Plottern (Cricut, Silhouette), für DTF und Siebdruck nutzbar sind.

[![CI](https://github.com/Tojoinxx/vektordesign/actions/workflows/ci.yml/badge.svg)](https://github.com/Tojoinxx/vektordesign/actions/workflows/ci.yml)

![Rechteck mit Farbverlauf und Verblassen, Bemaßungen und Abhängigkeiten](docs/screenshot-verlauf.png)

**Stand: Meilenstein 1 (MVP Desktop)** – Linie, Rechteck, Kreis, Punkt, Text, Bemaßung mit Ausdrücken, zwölf Abhängigkeiten, Statusanzeige (unter-/voll-/überbestimmt), Füllung, Kontur und Farbverläufe, Zoom/Pan, Rückgängig, SVG- und PNG-Export, Windows-Installer über GitHub Actions. Dazu: Claude als Design-Agent in der App (auch mit Bildern), Stilvorschläge und kurze Tutorials beim ersten Benutzen eines Werkzeugs.

## Installation

### Windows (Desktop-App)

1. Unter [Releases](https://github.com/Tojoinxx/vektordesign/releases/latest) die Datei `Vektordesign_<Version>_x64-setup.exe` herunterladen und starten. Das Setup braucht keine Administratorrechte.
2. Das Programm ist noch nicht signiert. Zeigt Windows SmartScreen eine Warnung: „Weitere Informationen“ → „Trotzdem ausführen“.

Die App läuft komplett offline. Sie nutzt die in Windows 10/11 eingebaute WebView2-Laufzeit; fehlt sie, installiert das Setup sie nach. Für die Verteilung über die IT liegt zusätzlich ein `.msi`-Paket bei.

Jeder Push baut außerdem einen Test-Installer: im Reiter **Actions** → Lauf „CI“ → Artefakt **Vektordesign-Windows**.

### Web-Version

Läuft ohne Installation im Browser (Chrome, Edge, Safari): <https://tojoinxx.github.io/vektordesign/>. Die installierbare iPad-Version mit Offline-Betrieb, Touch- und Pencil-Bedienung folgt in Meilenstein 4.

### Aus dem Quellcode

Voraussetzungen: [Node.js](https://nodejs.org) 22 oder neuer; für die Desktop-App zusätzlich [Rust](https://rustup.rs) und unter Windows die „Visual Studio Build Tools“ mit „Desktopentwicklung mit C++“.

```bash
npm install
npm run dev            # Web-Version unter http://localhost:5173
npm run desktop:dev    # Desktop-Fenster mit Live-Neuladen
npm run desktop:build  # Installer unter src-tauri/target/release/bundle/
```

## Bedienung

### Grundprinzip

1. **Grob zeichnen** – Linie (`L`), Rechteck (`R`), Kreis (`C`), Text (`T`). Beim Zeichnen entstehen automatisch Abhängigkeiten (z. B. horizontal, vertikal, koinzident), erkennbar an kleinen Symbolen (Glyphen).
2. **Bemaßen** – `D`, dann eine Linie, zwei Punkte, einen Kreis oder zwei Linien (Winkel) anklicken, das Maß platzieren und den Wert eintippen. Erlaubt sind Ausdrücke wie `20+5`, `d0/2`, `12,5`, `(d0-10)/2`, `max(d1; 20)` und Einheiten (`cm`, `in`, `°`). Doppelklick auf eine Bemaßung ändert sie.
3. **Abhängigkeiten setzen** – Koinzident, horizontal, vertikal, parallel, rechtwinklig, kollinear, tangential, konzentrisch, gleich, symmetrisch, Mittelpunkt, fixiert. Objekte vorher auswählen oder das Werkzeug wählen und nacheinander anklicken.
4. **Status prüfen** – unten rechts: blau *Unterbestimmt – noch X Bemaßungen nötig*, grün *Vollständig bestimmt*, rot *Überbestimmt* mit verständlicher Meldung. Ein Klick auf den Status zeigt, was noch frei ist. Würde ein Maß die Skizze überbestimmen, bietet die App an, es als getriebene Bemaßung (Referenz, in Klammern) anzulegen.

Während des Zeichnens lassen sich Länge, Winkel, Breite, Höhe oder Durchmesser direkt eintippen: einfach Zahlen tippen, `Tab` wechselt das Feld, `Enter` übernimmt.

### Abnahmetest Meilenstein 1 (in einer Minute)

![Rechteck vom Mittelpunkt mit direkter Werteingabe](docs/screenshot-werteingabe.png)

1. Rechteck-Werkzeug `R`, daneben die Variante „Rechteck vom Mittelpunkt“ wählen.
2. Auf den Ursprung (Achsenkreuz) klicken, die Maus etwas zur Seite bewegen, `80` tippen, `Tab`, `40`, `Enter`.
3. Kreis `C`, auf die Rechteckmitte klicken, Maus etwas wegbewegen, `10` tippen, `Enter`. Status unten rechts: **Vollständig bestimmt**.
4. Export → **SVG**: Der Dialog zeigt 80 × 40 mm, die Datei hat `width="80mm" height="40mm"`.

Inventor-Weg: Rechteck irgendwo grob aufziehen, mit `D` die Breite (80) und Höhe (`d0/2`) bemaßen, Abhängigkeit „Koinzident“ zwischen Rechteckmitte und Ursprung, Kreis grob zeichnen, „Konzentrisch“ zur Rechteckmitte, Durchmesser mit `D` auf 10.

### Gestalten

- **Füllung und Kontur** im Bereich *Eigenschaften*: Farbwähler mit HEX, RGB, HSV und CMYK, Pipette, zuletzt benutzte Farben; Konturstärke in mm, Linienenden und Linientyp; Deckkraft pro Objekt.
- **Farbverlauf**: Füllung „Verlauf“ wählen oder mit `G` einen Strich durch die Form ziehen (`Umschalt` rastet auf 45°). Richtungen links→rechts, rechts→links, oben→unten, unten→oben und kreisförmig; „Verblassen“ lässt den Verlauf in Transparenz auslaufen.
- **Stilvorschläge**: Objekt auswählen – im Bereich *Stilvorschläge* erscheinen zehn Varianten als Vorschau, ein Klick übernimmt (`Strg+Z` nimmt zurück). Mit Claude-Schlüssel gibt es zusätzlich KI-Vorschläge zu einem Stichwort („Vintage“, „Neon“, „Vereinsfarben Blau-Weiß“).
- **Konstruktionslinien** (`Q`) sind gestrichelt und werden nie exportiert; Bemaßungen und Glyphen ebenso nicht.

### Claude in der App

![Claude-Tab mit Beispielaufträgen](docs/screenshot-claude.png)

Im Tab **Claude** (`Strg+I`) beschreibst du, was entstehen soll – Claude zeichnet, bemaßt, setzt Abhängigkeiten und Farben direkt in der Zeichnung und prüft das Ergebnis anhand einer Vorschau. Bilder (Logo, Skizze, Foto) lassen sich per Schaltfläche, Drag & Drop oder `Strg+V` anhängen, z. B. zwei Bilder mit dem Auftrag „das erste in den Vordergrund, das zweite als Hintergrund mit Verblassen“. Alle Änderungen eines Auftrags sind ein einziger Schritt – `Strg+Z` macht alles rückgängig.

Einrichtung: Unter [console.anthropic.com](https://console.anthropic.com) einen API-Schlüssel erstellen und im Claude-Tab einfügen. Der Schlüssel wird nur auf diesem Gerät gespeichert und nur an die Anthropic-API gesendet; die Kosten pro Auftrag rechnet Anthropic nach Verbrauch ab. Nur der Assistent braucht Internet.

### Export

| Format | Eigenschaften |
| --- | --- |
| SVG | Maße in mm (`width`/`height` in mm, `viewBox` in mm), benannte Ebene „Motiv“, ohne Bemaßungen, Glyphen und Konstruktionslinien – passt für Illustrator, Inkscape, Cricut Design Space und Silhouette Studio |
| PNG | 300, 360, 600, 720 oder 1200 dpi, transparenter Hintergrund, Auflösung im Dateikopf (pHYs) |
| Projekt (`.vdp`) | Geometrie, Bemaßungen, Abhängigkeiten und Stile; wird zusätzlich automatisch zwischengespeichert |

Optional beim Export: Rand inklusive Konturstärke und horizontal spiegeln (Flexfolie).

## Tastenkürzel

| Taste | Befehl | | Taste | Befehl |
| --- | --- | --- | --- | --- |
| `L` | Linie (Kettenmodus) | | `Strg+Z` / `Strg+Y` | Rückgängig / Wiederholen |
| `R` | Rechteck | | `Strg+C` / `Strg+V` | Kopieren / Einfügen |
| `C` | Kreis | | `Strg+D` | Duplizieren |
| `T` | Text | | `Entf` | Löschen |
| `P` | Punkt | | `Strg+A` | Alles auswählen |
| `D` | Bemaßung | | `Strg+N` / `Strg+O` | Neu / Öffnen |
| `G` | Farbverlauf ziehen | | `Strg+S` / `Strg+Umschalt+S` | Speichern / Speichern unter |
| `Q` | Konstruktionsgeometrie ein/aus | | `Strg+E` | Exportieren |
| `F` | Alles anzeigen | | `Strg+K` | Befehlssuche |
| `+` / `−` | Vergrößern / Verkleinern | | `Strg+I` | Claude-Assistent |
| `F8` / `F9` | Abhängigkeiten ein-/ausblenden | | `Strg+]` / `Strg+[` | Nach vorne / nach hinten |
| `Esc` | Abbrechen, zurück zur Auswahl | | `Strg+Umschalt+]` / `[` | Ganz nach vorne / hinten |

Maus: Mausrad zoomt zur Mausposition, mittlere Maustaste oder `Leertaste` + Ziehen verschiebt die Ansicht, Rechtsklick öffnet das Markierungsmenü (wie in Inventor; Rechtsklick gedrückt halten und in eine Richtung ziehen startet den Befehl direkt). Fang an Endpunkt, Mitte, Schnittpunkt, Kreismittelpunkt, Kurve und Raster lässt sich unten in der Statusleiste umschalten.

## Entwicklung

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver (Browser) |
| `npm run build` | Typprüfung und Produktionsbuild nach `dist/` |
| `npm test` | Unit-Tests: Ausdrücke, Solver, Abnahme M1, Export, Claude-Werkzeuge |
| `npm run test:e2e` | Bedienung im echten Browser inkl. Abnahme M1 (`CHROME_PATH` auf Chrome/Chromium setzen) |
| `npm run test:desktop` | Startet die Desktop-App und prüft Solver, Export und Dateibefehle im echten Fenster |
| `npm run desktop:build` | Windows-Installer (NSIS-Setup und MSI) |
| `npm run version:set -- 0.2.0` | Versionsnummer überall gleich setzen |

### Aufbau

Datenmodell, Solver und Darstellung sind strikt getrennt. Werkzeuge, Oberfläche und der Claude-Assistent ändern die Zeichnung ausschließlich über dieselben Editor-Befehle – dadurch ist alles rückgängig zu machen und testbar.

```
src/
  model/      Datenmodell in mm (Punkte, Linien, Kreise, Text, Pfade), Farben, Verläufe, Projektdatei
  params/     Ausdrücke und Parameter der Bemaßungen (d0, d1 …)
  solver/     planegcs (FreeCAD-Solver als WebAssembly): Zerlegung in Teilsysteme, Freiheitsgrade, Konflikte
  store/      Zustand und Editor-Befehle mit Rückgängig/Wiederholen
  render/     Canvas-Darstellung: Raster, Maßband-Lineale, Bemaßungen, Glyphen
  tools/      Werkzeuge: Auswahl, Zeichnen, Bemaßung, Abhängigkeiten, Verlauf, Fang
  export/     SVG und PNG
  assistant/  Claude-Anbindung (Messages-API mit Werkzeugen und Bildern)
  design/     Stilvorschläge
  platform/   Dateien, Schriftarten, Zwischenspeicher (Desktop und Browser)
  ui/         React-Oberfläche
src-tauri/    Desktop-Hülle (Tauri 2, Rust): Dateizugriff und Schriftarten
tests/        Unit-, Browser- und Desktop-Tests
```

**Warum Tauri statt Electron?** Der Installer ist nur wenige MB groß statt rund 100 MB, die App braucht deutlich weniger Arbeitsspeicher, weil sie die in Windows eingebaute WebView2 nutzt statt einen eigenen Chromium mitzubringen, und Tauri erzeugt NSIS- und MSI-Installer direkt. Dieselbe Oberfläche läuft unverändert als Web-Version für das iPad.

### Release veröffentlichen

```bash
git tag v0.2.0
git push origin v0.2.0
```

Der Workflow „Release“ übernimmt die Version aus dem Tag, testet, baut den Installer und hängt `.exe` und `.msi` an ein GitHub-Release. Versionsnummern bestehen nur aus Zahlen (`v1.2.3`), weil der MSI-Installer nichts anderes erlaubt.

### GitHub einrichten (einmalig)

- **Settings → Pages → Build and deployment → Source: „GitHub Actions“**, damit der Workflow „Web-Version“ die App veröffentlichen kann.
- Die Workflows nutzen nur das automatische `GITHUB_TOKEN`; weitere Geheimnisse sind nicht nötig.

## Fahrplan

1. ✅ MVP Desktop
2. Gestaltung und Bearbeiten: Ebenen, Gruppen, Ausrichten, boolesche Operationen, Stutzen/Dehnen/Abrunden/Versatz, Muster, Messen, Text in Pfade, PDF/EPS/DXF
3. LabwearOS-Export: Vorlagen-Import, Platzierung auf dem Kleidungsstück, Artwork-Blatt, Export-Profile, ZIP-Paket
4. iPad: installierbare Web-App, Touch- und Apple-Pencil-Bedienung, Formerkennung, Sync über iCloud Drive/OneDrive
5. Textil- und Komfortfunktionen: Mockups, Farbseparation, Plotter-Prüfung, Rapport, Größenstaffel, Kostenschätzung

## Lizenz

MIT – siehe [LICENSE](LICENSE). Verwendete Bibliotheken und ihre Lizenzen: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Pantone-Codes werden (ab Meilenstein 3) nur als Freitext erfasst; eine Pantone-Bibliothek ist lizenzpflichtig und wird bewusst nicht eingebaut.
