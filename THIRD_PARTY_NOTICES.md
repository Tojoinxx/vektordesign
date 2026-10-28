# Verwendete Bibliotheken

Vektordesign selbst steht unter der MIT-Lizenz (siehe [LICENSE](LICENSE)). In der App sind folgende Bibliotheken enthalten:

| Bibliothek | Zweck | Lizenz |
| --- | --- | --- |
| [planegcs](https://github.com/Salusoft89/planegcs) – Constraint-Solver aus [FreeCAD](https://github.com/FreeCAD/FreeCAD) als WebAssembly | Bemaßungen und Abhängigkeiten lösen | GNU LGPL 2.0 oder neuer |
| [React](https://react.dev), React DOM | Oberfläche | MIT |
| [zustand](https://github.com/pmndrs/zustand) | Zustandsverwaltung | MIT |
| [Immer](https://github.com/immerjs/immer) | Unveränderliche Daten für Rückgängig/Wiederholen | MIT |
| [Lucide](https://lucide.dev) | Symbole | ISC |
| [Clipper](https://sourceforge.net/projects/jsclipper/) (clipper-lib, JavaScript-Port von Angus Johnsons Clipper) | Boolesche Operationen, Versatz, Abrunden | Boost Software License 1.0 |
| [opentype.js](https://github.com/opentypejs/opentype.js) | Schriftumrisse für „Text in Pfade“ | MIT |
| [PDF.js](https://github.com/mozilla/pdf.js) (pdfjs-dist) | Import von PDF-/AI-Vorlagen | Apache-2.0 |
| [fflate](https://github.com/101arrowz/fflate) | ZIP-Paket, PDF-Kompression | MIT |
| [ImageTracer.js](https://github.com/jankovicsandras/imagetracerjs) | Bilder vektorisieren | Unlicense (gemeinfrei) |
| [IBM Plex Sans](https://github.com/IBM/plex) über Fontsource | Schrift der Oberfläche; Ersatzschrift für „Text in Pfade“, wenn eine Schrift nicht verfügbar ist | SIL Open Font License 1.1 |
| [Tauri](https://tauri.app), tauri-plugin-dialog | Desktop-App, Datei-Dialoge | MIT oder Apache-2.0 |
| [fontdb](https://github.com/RazrFalcon/fontdb) | Liste der installierten Schriftarten | MIT |
| serde, serde_json, percent-encoding | Datenaustausch zwischen Oberfläche und Rust | MIT oder Apache-2.0 |

Dazu kommen die Abhängigkeiten dieser Bibliotheken (überwiegend MIT und Apache-2.0); die vollständige Liste zeigen `npm ls --omit=dev --all` und `cargo tree` im Ordner `src-tauri`.

**planegcs (LGPL):** Der Solver wird als eigenständige WebAssembly-Datei (`assets/planegcs-*.wasm`) geladen und kann durch eine eigene Version ersetzt werden. Der Quellcode ist unter <https://github.com/Salusoft89/planegcs> und <https://github.com/FreeCAD/FreeCAD> verfügbar.

**WebView2:** Das Windows-Setup enthält den WebView2-Bootstrapper von Microsoft. Er installiert die WebView2-Laufzeit nur, falls sie auf dem Rechner fehlt; es gelten die Lizenzbedingungen von Microsoft.

**Pantone:** Pantone-Codes werden nur als Freitext erfasst (Artwork-Angaben ab Meilenstein 3). Eine Pantone-Farbbibliothek ist lizenzpflichtig und deshalb nicht enthalten.
