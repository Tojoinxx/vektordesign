import { useState } from 'react';
import { BookmarkPlus, Download, FolderOpen, ImageIcon, Palette as PaletteIcon, Sparkles, Trash2 } from 'lucide-react';
import { docColors, harmony, HARMONY_LABELS, libraryFromJson, libraryToJson, loadLibrary, makeElement, mergeLibrary, newPalette, saveLibrary, type Harmony, type Library } from '../model/library';
import { drawableTargets } from '../store/editor';
import { renderPreviewPng } from '../export/png';
import { quantize } from '../model/vectorize';
import { rgbToHex } from '../model/color';
import { decodeImage } from '../platform/pdfImport';
import { readImageFile } from '../model/image';
import { IMAGE_JPG_TYPE, IMAGE_PNG_TYPE, IMAGE_WEBP_TYPE, LIBRARY_TYPE, openFile, saveFile } from '../platform/files';
import { ColorButton } from './ColorPicker';
import { useApp, useAppState } from './hooks';

/**
 * Bibliothek: Elemente/Logos und Farbpaletten für alle Projekte. Farbfeld anklicken = Füllung der
 * Auswahl, mit Alt bzw. Rechtsklick = Kontur.
 */
export function LibraryPanel() {
  const app = useApp();
  const ed = app.editor;
  const doc = useAppState((s) => s.doc);
  const selection = useAppState((s) => s.selection);
  const [lib, setLib] = useState<Library>(loadLibrary);
  const [name, setName] = useState('');
  const [base, setBase] = useState('#1f3a93');
  const [kind, setKind] = useState<Harmony>('complementary');
  const update = (next: Library) => {
    const err = saveLibrary(next);
    if (err) {
      ed.toast(err, 'error', 7000);
      return;
    }
    setLib(next);
  };
  const targets = drawableTargets(doc, selection);

  const saveElement = async () => {
    if (!targets.length) {
      ed.toast('Zuerst die Objekte auswählen, die in die Bibliothek sollen.', 'info');
      return;
    }
    const el = makeElement(doc, targets, name || `Element ${lib.elements.length + 1}`);
    if (!el) return;
    const prev = await renderPreviewPng(el.doc, 160, null).catch(() => null);
    if (prev) el.thumb = `data:image/png;base64,${prev.base64}`;
    update({ ...lib, elements: [el, ...lib.elements] });
    setName('');
    ed.toast(`„${el.name}“ in der Bibliothek gespeichert`, 'success');
  };

  const applyColor = (c: string, stroke: boolean) => {
    if (!targets.length) {
      ed.toast('Zuerst Objekte auswählen, dann ein Farbfeld anklicken (Alt = Kontur).', 'info');
      return;
    }
    const out = ed.setStyle(targets, stroke ? { stroke: c } : { fill: c });
    if (!out.ok) ed.toast(out.message, 'error');
  };

  const paletteFromImage = async () => {
    const f = await openFile([IMAGE_PNG_TYPE, IMAGE_JPG_TYPE, IMAGE_WEBP_TYPE]);
    if (!f) return;
    const mime = f.name.toLowerCase().endsWith('.png') ? 'image/png' : f.name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    const img = await readImageFile(f.data, mime, 400);
    const px = await decodeImage(img.src, 200);
    if (!px) {
      ed.toast('Das Bild ließ sich nicht lesen.', 'error');
      return;
    }
    const pal = quantize({ width: px.width, height: px.height, data: px.rgba }, 6)
      .filter((c) => c.a > 128)
      .map((c) => rgbToHex({ r: c.r, g: c.g, b: c.b }));
    update({ ...lib, palettes: [newPalette(`Aus ${f.name.replace(/\.[^.]+$/, '')}`, pal), ...lib.palettes] });
  };

  const exportLib = async () => {
    const saved = await saveFile(libraryToJson(lib), 'Vektordesign-Bibliothek.vdlib', LIBRARY_TYPE);
    if (saved) ed.toast('Bibliothek gesichert', 'success');
  };
  const importLib = async () => {
    const f = await openFile([LIBRARY_TYPE]);
    if (!f) return;
    try {
      const other = libraryFromJson(new TextDecoder().decode(f.data));
      update(mergeLibrary(lib, other));
      ed.toast(`${other.elements.length} Elemente und ${other.palettes.length} Paletten übernommen`, 'success');
    } catch (e) {
      ed.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };
  const preview = harmony(base, kind);

  return (
    <div className="library" data-testid="library">
      <section className="props-section">
        <h3>Elemente und Logos</h3>
        <div className="row">
          <input type="text" value={name} placeholder="Name, z. B. Vereinslogo" onChange={(e) => setName(e.target.value)} aria-label="Name des Elements" onKeyDown={(e) => e.stopPropagation()} />
          <button className="btn" onClick={() => void saveElement()} disabled={!targets.length} data-testid="lib-save" title="Auswahl in die Bibliothek speichern">
            <BookmarkPlus size={15} /> Speichern
          </button>
        </div>
        {lib.elements.length ? (
          <div className="lib-grid" data-testid="lib-elements">
            {lib.elements.map((el) => (
              <figure key={el.id} className="lib-item">
                <button
                  className="lib-thumb"
                  onClick={() => {
                    const v = ed.s.view;
                    const out = ed.insertDoc(el.doc, `„${el.name}“ einfügen`, { x: v.cx, y: v.cy });
                    if (!out.ok) ed.toast(out.message, 'error');
                  }}
                  title={`„${el.name}“ einfügen (${el.w.toFixed(0)} × ${el.h.toFixed(0)} mm)`}
                  data-testid="lib-insert"
                >
                  {el.thumb ? <img src={el.thumb} alt="" /> : <span>{el.name}</span>}
                </button>
                <figcaption>
                  <span title={el.name}>{el.name}</span>
                  <button className="icon-btn" aria-label={`${el.name} löschen`} onClick={() => update({ ...lib, elements: lib.elements.filter((x) => x.id !== el.id) })}>
                    <Trash2 size={13} />
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="muted small">Noch leer. Logo oder Element auswählen und speichern – es steht dann in jedem Projekt per Klick bereit.</p>
        )}
      </section>

      <section className="props-section">
        <h3>Farbpaletten</h3>
        <p className="muted small">Farbfeld anklicken färbt die Auswahl, mit Alt oder Rechtsklick die Kontur.</p>
        <div className="row wrap">
          <button
            className="btn small"
            onClick={() => update({ ...lib, palettes: [newPalette(doc.name && doc.name !== 'Unbenannt' ? doc.name : 'Aus der Zeichnung', docColors(doc)), ...lib.palettes] })}
            disabled={!docColors(doc).length}
            data-testid="lib-pal-doc"
          >
            <PaletteIcon size={14} /> Aus der Zeichnung
          </button>
          <button className="btn small" onClick={() => void paletteFromImage()} data-testid="lib-pal-image">
            <ImageIcon size={14} /> Aus einem Bild …
          </button>
        </div>
        <div className="harmony">
          <ColorButton value={base} label="Grundfarbe" onChange={setBase} />
          <select value={kind} onChange={(e) => setKind(e.target.value as Harmony)} aria-label="Harmonie">
            {(Object.keys(HARMONY_LABELS) as Harmony[]).map((k) => (
              <option key={k} value={k}>
                {HARMONY_LABELS[k]}
              </option>
            ))}
          </select>
          <span className="swatches">
            {preview.map((c, i) => (
              <span key={i} className="swatch big" style={{ background: c }} title={c} />
            ))}
          </span>
          <button
            className="btn small"
            onClick={() => update({ ...lib, palettes: [newPalette(`${HARMONY_LABELS[kind]} ${base.toUpperCase()}`, preview), ...lib.palettes] })}
            data-testid="lib-pal-harmony"
          >
            <Sparkles size={14} /> Übernehmen
          </button>
        </div>
        {lib.palettes.map((p) => (
          <div key={p.id} className="lib-palette" data-testid="lib-palette">
            <div className="row">
              <strong className="spacer small">{p.name}</strong>
              <button className="icon-btn" aria-label={`Palette ${p.name} löschen`} onClick={() => update({ ...lib, palettes: lib.palettes.filter((x) => x.id !== p.id) })}>
                <Trash2 size={13} />
              </button>
            </div>
            <div className="swatches">
              {p.colors.map((c) => (
                <button
                  key={c}
                  className="swatch big"
                  style={{ background: c }}
                  title={`${c.toUpperCase()} – Klick: Füllung, Alt/Rechtsklick: Kontur`}
                  aria-label={`Farbe ${c}`}
                  onClick={(e) => applyColor(c, e.altKey)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    applyColor(c, true);
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="props-section">
        <h3>Sichern und übertragen</h3>
        <p className="muted small">Die Bibliothek liegt in diesem Browser bzw. dieser App. Als Datei gesichert lässt sie sich auf andere Geräte übertragen (z. B. über iCloud Drive oder OneDrive).</p>
        <div className="row wrap">
          <button className="btn small" onClick={() => void exportLib()}>
            <Download size={14} /> Als Datei sichern
          </button>
          <button className="btn small" onClick={() => void importLib()}>
            <FolderOpen size={14} /> Datei laden
          </button>
        </div>
      </section>
    </div>
  );
}
