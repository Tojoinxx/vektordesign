import { useEffect, useMemo, useState } from 'react';
import { Shirt, LayoutGrid, Copy, FileArchive, FileText, MapPin, Plus, Settings2, Trash2, TriangleAlert } from 'lucide-react';
import type { Motif, Production, Technique, Variant } from '../model/types';
import { GARMENTS, TECHNIQUES, areaOf, garmentOf } from '../model/garments';
import { allColors, cmykOf, cmykText, motifColors, motifSize, motifWarnings, nextListId, productionOf, variantColor } from '../model/production';
import { layersOf } from '../model/layers';
import { normalizeHex } from '../model/color';
import { formatNumber } from '../params/expr';
import { BUILTIN_PROFILES, FORMAT_LABELS, type ExportProfile, type PackageFormat } from '../model/profiles';
import { Modal } from './Chrome';
import { ColorButton } from './ColorPicker';
import { useApp, useAppState, useUi } from './hooks';

/** Textfeld, das erst beim Verlassen (oder Enter) übernimmt – ein Rückgängig-Schritt je Eingabe. */
export function Field({
  value,
  onCommit,
  label,
  testId,
  width,
  placeholder,
  numeric,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  testId?: string;
  width?: number;
  placeholder?: string;
  numeric?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      type="text"
      inputMode={numeric ? 'decimal' : undefined}
      value={v}
      placeholder={placeholder}
      aria-label={label}
      data-testid={testId}
      style={width ? { width } : undefined}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

const mm = (n: number) => formatNumber(n, 1);
const parseMm = (s: string): number | null => {
  const n = Number(s.replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
};

export function ProductionPanel() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const profiles = useUi((s) => s.profiles);
  const busy = useUi((s) => s.busy);
  const p = useMemo(() => productionOf(doc), [doc]);
  const ed = app.editor;
  const upd = (label: string, fn: (p: Production) => void) => {
    const out = ed.updateProduction(label, fn);
    if (!out.ok) ed.toast(out.message, 'error');
  };
  const g = garmentOf(p.garment);
  const profile = profiles.find((x) => x.id === p.profileId) ?? profiles[0];
  const warnings = p.motifs.flatMap((m) => motifWarnings(doc, p, m));

  return (
    <div className="props production" data-testid="production">
      <section className="props-section">
        <h3>Artikel</h3>
        <p className="muted small">Angaben für Dateinamen und Artwork-Blatt. Maße, Stoffe und Etiketten pflegst du weiter in LabwearOS.</p>
        <div className="form-grid">
          <span>Name</span>
          <Field value={p.article} label="Artikelname" testId="prod-article" onCommit={(v) => upd('Artikelname', (q) => void (q.article = v.trim() || 'Artikel'))} />
          <span>Version</span>
          <Field value={p.version} label="Version" testId="prod-version" width={70} onCommit={(v) => upd('Version', (q) => void (q.version = v.trim() || '1'))} />
          <span>Kleidungsstück</span>
          <select
            value={p.garment}
            aria-label="Kleidungsstück"
            data-testid="prod-garment"
            onChange={(e) =>
              upd('Kleidungsstück', (q) => {
                q.garment = e.target.value as Production['garment'];
                const ng = garmentOf(q.garment);
                for (const m of q.motifs) {
                  if (!areaOf(ng, m.placement.area)) {
                    const a = ng.areas[0];
                    m.placement = { view: a.view, area: a.id, x: a.x, y: a.y };
                  }
                }
              })
            }
          >
            {GARMENTS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="props-section">
        <div className="row">
          <h3 className="spacer">Motive</h3>
          <button
            className="btn"
            onClick={() =>
              upd('Motiv hinzufügen', (q) => {
                const id = nextListId('m', q.motifs);
                const a = garmentOf(q.garment).areas.find((x) => !q.motifs.some((m) => m.placement.area === x.id)) ?? garmentOf(q.garment).areas[0];
                q.motifs.push({ id, name: `Motiv ${q.motifs.length + 1}`, layers: [], technique: 'screen', placement: { view: a.view, area: a.id, x: a.x, y: a.y } });
              })
            }
          >
            <Plus size={15} /> Motiv
          </button>
        </div>
        {p.motifs.map((m, i) => (
          <MotifCard key={m.id} m={m} index={i} p={p} upd={upd} />
        ))}
        {warnings.length > 0 && (
          <ul className="warn-list" data-testid="prod-warnings">
            {warnings.map((w) => (
              <li key={w}>
                <TriangleAlert size={14} /> {w}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Ebenen trennen mehrere Motive (z. B. Brust und Rücken). Ohne Auswahl gehören alle sichtbaren Ebenen zum Motiv.</p>
        <p className="muted small">Brust links bedeutet aus Sicht der Trägerin, also im Bild rechts.</p>
        <span className="sr-only">{g.name}</span>
      </section>

      <VariantsSection p={p} upd={upd} />

      <ColorsSection p={p} upd={upd} />

      <section className="props-section">
        <h3>Export für LabwearOS</h3>
        <div className="form-grid">
          <span>Profil</span>
          <div className="row">
            <select value={profile.id} aria-label="Export-Profil" data-testid="prod-profile" onChange={(e) => upd('Export-Profil', (q) => void (q.profileId = e.target.value))}>
              {profiles.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <button className="icon-btn" title="Profil bearbeiten" aria-label="Profil bearbeiten" onClick={() => app.ui.setState({ profileEditor: profile.id })} data-testid="prod-profile-edit">
              <Settings2 size={16} />
            </button>
          </div>
        </div>
        <p className="muted small">
          {profile.purpose}. Enthält: {profile.formats.map((f) => FORMAT_LABELS[f].split(' ')[0]).join(', ')}
          {profile.formats.includes('png') ? ` (${profile.pngDpi} dpi)` : ''}, {profile.colorMode.toUpperCase()}
          {profile.sheet ? ', Artwork-Blatt' : ''}
          {profile.mirror ? ', gespiegelt' : ''}.
        </p>
        <div className="stack">
          <button className="btn accent wide" onClick={() => void app.exportPackage()} disabled={!!busy} data-testid="package-export">
            <FileArchive size={16} /> {busy ?? 'ZIP-Paket exportieren'}
          </button>
          <button className="btn wide" onClick={() => app.ui.setState({ mockup: true })} data-testid="mockup-open">
            <Shirt size={16} /> Mockup-Vorschau
          </button>
          <button className="btn wide" onClick={() => app.ui.setState({ gangSheet: true })} data-testid="gangsheet-open">
            <LayoutGrid size={16} /> DTF-Sammelbogen
          </button>
          <button className="btn wide" onClick={() => void app.exportArtworkSheet()} disabled={!!busy} data-testid="sheet-export">
            <FileText size={16} /> Nur Artwork-Blatt (PDF)
          </button>
        </div>
        <p className="muted small">
          Dateinamen: <code>{`${p.article}_v${p.version}`}</code> … Alle Motive 1:1, Text als Pfade, keine verknüpften Dateien.
        </p>
      </section>
    </div>
  );
}

function MotifCard({ m, index, p, upd }: { m: Motif; index: number; p: Production; upd: (l: string, fn: (p: Production) => void) => void }) {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const g = garmentOf(p.garment);
  const size = motifSize(doc, m);
  const layers = layersOf(doc);
  const setM = (label: string, fn: (mm: Motif) => void) =>
    upd(label, (q) => {
      const t = q.motifs.find((x) => x.id === m.id);
      if (t) fn(t);
    });
  return (
    <div className="motif-card" data-testid={`motif-${index}`}>
      <div className="row">
        <Field value={m.name} label="Motivname" testId={`motif-name-${index}`} onCommit={(v) => setM('Motivname', (t) => void (t.name = v.trim() || t.name))} />
        <span className="spacer" />
        <button className="btn" onClick={() => app.ui.setState({ placement: m.id })} data-testid={`motif-place-${index}`} title="Auf dem Kleidungsstück platzieren">
          <MapPin size={15} /> Platzieren
        </button>
        {p.motifs.length > 1 && (
          <button className="icon-btn" title="Motiv entfernen" aria-label="Motiv entfernen" onClick={() => upd('Motiv entfernen', (q) => void (q.motifs = q.motifs.filter((x) => x.id !== m.id)))}>
            <Trash2 size={15} />
          </button>
        )}
      </div>
      <div className="form-grid">
        <span>Veredelung</span>
        <select value={m.technique} aria-label="Veredelung" data-testid={`motif-technique-${index}`} onChange={(e) => setM('Veredelung', (t) => void (t.technique = e.target.value as Technique))}>
          {TECHNIQUES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span>Druckbereich</span>
        <select
          value={areaOf(g, m.placement.area) ? m.placement.area : 'custom'}
          aria-label="Druckbereich"
          data-testid={`motif-area-${index}`}
          onChange={(e) => {
            const a = areaOf(g, e.target.value);
            if (a) setM('Druckbereich', (t) => void (t.placement = { view: a.view, area: a.id, x: a.x, y: a.y }));
          }}
        >
          {g.areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          <option value="custom" disabled>
            Frei platziert
          </option>
        </select>
        <span>Größe</span>
        <span data-testid={`motif-size-${index}`}>{size ? `${mm(size.w)} × ${mm(size.h)} mm` : '– (keine sichtbaren Objekte)'}</span>
        <span>Unter Kragen</span>
        <span className="row">
          <Field
            value={mm(m.placement.y)}
            numeric
            width={64}
            label="Abstand Oberkante unter dem Bezugspunkt in mm"
            testId={`motif-y-${index}`}
            onCommit={(v) => {
              const n = parseMm(v);
              if (n !== null) setM('Platzierung', (t) => void (t.placement = { ...t.placement, y: n, area: areaMatch(p, t, t.placement.x, n) }));
            }}
          />
          <span className="muted">mm</span>
        </span>
        <span>Von Mitte</span>
        <span className="row">
          <Field
            value={mm(m.placement.x)}
            numeric
            width={64}
            label="Abstand der Motivmitte von der Mittellinie in mm (positiv = im Bild rechts)"
            testId={`motif-x-${index}`}
            onCommit={(v) => {
              const n = parseMm(v);
              if (n !== null) setM('Platzierung', (t) => void (t.placement = { ...t.placement, x: n, area: areaMatch(p, t, n, t.placement.y) }));
            }}
          />
          <span className="muted">mm</span>
        </span>
        <span>Hinweis</span>
        <Field value={m.note ?? ''} label="Hinweis für die Produktion" placeholder="optional" onCommit={(v) => setM('Hinweis', (t) => void (t.note = v.trim() || undefined))} />
      </div>
      {layers.length > 1 && (
        <div className="layer-picks">
          <span className="muted small">Ebenen:</span>
          {layers.map((l) => (
            <label key={l.id} className="check small">
              <input
                type="checkbox"
                checked={m.layers.includes(l.id)}
                onChange={(e) =>
                  setM('Motiv-Ebenen', (t) => {
                    t.layers = e.target.checked ? [...t.layers, l.id] : t.layers.filter((x) => x !== l.id);
                  })
                }
              />
              {l.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Bleibt die Lage auf dem Vorgabewert, gilt der Druckbereich weiter; sonst „frei“. */
function areaMatch(p: Production, m: Motif, x: number, y: number): string {
  const a = areaOf(garmentOf(p.garment), m.placement.area);
  if (a && Math.abs(a.x - x) < 0.01 && Math.abs(a.y - y) < 0.01) return a.id;
  return a ? a.id : 'custom';
}

function VariantsSection({ p, upd }: { p: Production; upd: (l: string, fn: (p: Production) => void) => void }) {
  const doc = useAppState((s) => s.doc);
  const colors = allColors(doc, p);
  const setV = (id: string, label: string, fn: (v: Variant) => void) =>
    upd(label, (q) => {
      const t = q.variants.find((x) => x.id === id);
      if (t) fn(t);
    });
  return (
    <section className="props-section">
      <div className="row">
        <h3 className="spacer">Farbvarianten</h3>
        <button
          className="btn"
          data-testid="variant-add"
          onClick={() =>
            upd('Variante hinzufügen', (q) => {
              const src = q.variants[q.variants.length - 1];
              const id = nextListId('v', q.variants);
              q.variants.push({ ...src, id, name: `Variante ${String.fromCharCode(65 + q.variants.length)}`, colors: { ...src.colors } });
            })
          }
        >
          <Copy size={15} /> Variante
        </button>
      </div>
      {p.variants.map((v, i) => (
        <div key={v.id} className="variant-card" data-testid={`variant-${i}`}>
          <div className="row">
            <Field value={v.name} label="Name der Variante" testId={`variant-name-${i}`} onCommit={(x) => setV(v.id, 'Variantenname', (t) => void (t.name = x.trim() || t.name))} />
            <span className="spacer" />
            {p.variants.length > 1 && (
              <button className="icon-btn" title="Variante entfernen" aria-label="Variante entfernen" onClick={() => upd('Variante entfernen', (q) => void (q.variants = q.variants.filter((x) => x.id !== v.id)))}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
          <div className="row">
            <span className="muted small" style={{ width: 70 }}>
              Stoff
            </span>
            <ColorButton value={v.fabric} label="Stofffarbe" testId={`variant-fabric-${i}`} onChange={(hex) => setV(v.id, 'Stofffarbe', (t) => void (t.fabric = hex))} />
            <Field value={v.fabricName ?? ''} placeholder="Name, z. B. Navy" label="Name der Stofffarbe" width={130} onCommit={(x) => setV(v.id, 'Stofffarbe', (t) => void (t.fabricName = x.trim() || undefined))} />
          </div>
          {colors.map((orig) => {
            const cur = variantColor(v, orig);
            return (
              <div className="row color-map" key={orig}>
                <span className="swatch" style={{ background: orig }} title={`Original ${orig}`} />
                <span className="muted">→</span>
                <ColorButton
                  value={cur}
                  label={`Druckfarbe für ${orig}`}
                  testId={`variant-color-${i}-${orig.slice(1)}`}
                  onChange={(hex) =>
                    setV(v.id, 'Variantenfarbe', (t) => {
                      const k = (normalizeHex(hex) ?? hex).toLowerCase();
                      if (k === orig) delete t.colors[orig];
                      else t.colors[orig] = k;
                    })
                  }
                />
                <code className="small">{cur.toUpperCase()}</code>
              </div>
            );
          })}
        </div>
      ))}
      {!colors.length && <p className="muted small">Noch keine Farben – zuerst Füllung oder Kontur vergeben.</p>}
    </section>
  );
}

function ColorsSection({ p, upd }: { p: Production; upd: (l: string, fn: (p: Production) => void) => void }) {
  const doc = useAppState((s) => s.doc);
  const used = new Set<string>();
  for (const v of p.variants) for (const m of p.motifs) for (const c of motifColors(doc, m)) used.add(variantColor(v, c));
  const list = [...used];
  if (!list.length) return null;
  return (
    <section className="props-section">
      <h3>Farbangaben</h3>
      <p className="muted small">CMYK wird aus der Farbe berechnet und kann überschrieben werden. Pantone-Codes sind Freitext – eine Pantone-Bibliothek ist lizenzpflichtig und daher nicht eingebaut.</p>
      <table className="color-table">
        <thead>
          <tr>
            <th />
            <th>HEX</th>
            <th>CMYK</th>
            <th>Pantone</th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => {
            const spec = p.colorSpecs[c];
            return (
              <tr key={c} data-testid={`colorspec-${c.slice(1)}`}>
                <td>
                  <span className="swatch" style={{ background: c }} />
                </td>
                <td>
                  <code>{c.toUpperCase()}</code>
                </td>
                <td>
                  <Field
                    value={cmykText(cmykOf(c, spec))}
                    width={118}
                    label={`CMYK für ${c}`}
                    onCommit={(v) => {
                      const nums = v.match(/\d+(?:[.,]\d+)?/g)?.map((x) => Math.max(0, Math.min(100, Math.round(Number(x.replace(',', '.'))))));
                      upd('CMYK-Angabe', (q) => {
                        const s = (q.colorSpecs[c] = { ...(q.colorSpecs[c] ?? {}) });
                        if (nums && nums.length === 4) s.cmyk = nums as [number, number, number, number];
                        else delete s.cmyk;
                      });
                    }}
                  />
                </td>
                <td>
                  <Field
                    value={spec?.pantone ?? ''}
                    width={86}
                    placeholder="z. B. 116 C"
                    label={`Pantone für ${c}`}
                    testId={`pantone-${c.slice(1)}`}
                    onCommit={(v) => upd('Pantone-Angabe', (q) => void (q.colorSpecs[c] = { ...(q.colorSpecs[c] ?? {}), pantone: v.trim().replace(/^pantone\s*/i, '') || undefined }))}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Export-Profil bearbeiten (gilt auf diesem Gerät für alle Projekte). */
export function ProfileEditor() {
  const app = useApp();
  const id = useUi((s) => s.profileEditor);
  const profiles = useUi((s) => s.profiles);
  const src = profiles.find((x) => x.id === id);
  const [draft, setDraft] = useState(src);
  useEffect(() => setDraft(src), [src]);
  if (!id || !src || !draft) return null;
  const close = () => app.ui.setState({ profileEditor: null });
  const builtin = BUILTIN_PROFILES.some((b) => b.id === src.id);
  const set = (patch: Partial<ExportProfile>) => setDraft({ ...draft, ...patch });
  const toggle = (f: PackageFormat) => set({ formats: draft.formats.includes(f) ? draft.formats.filter((x) => x !== f) : [...draft.formats, f] });
  return (
    <Modal title={`Export-Profil „${src.name}“`} onClose={close} testId="profile-editor">
      <div className="stack">
        <p className="muted small">{draft.purpose}. Die Werte gelten auf diesem Gerät für alle Projekte. Trage hier die Datei-Anforderungen aus deinem LabwearOS-Konto ein.</p>
        <div>
          <h4>Dateien je Motiv und Variante</h4>
          {(Object.keys(FORMAT_LABELS) as PackageFormat[]).map((f) => (
            <label key={f} className="check">
              <input type="checkbox" checked={draft.formats.includes(f)} onChange={() => toggle(f)} data-testid={`profile-format-${f}`} />
              {FORMAT_LABELS[f]}
            </label>
          ))}
        </div>
        <div className="form-grid">
          <span>Farbmodus</span>
          <div className="segmented">
            {(['cmyk', 'rgb'] as const).map((m) => (
              <button key={m} className={draft.colorMode === m ? 'on' : ''} onClick={() => set({ colorMode: m })}>
                {m.toUpperCase()}
              </button>
            ))}
          </div>
          <span>PNG-Auflösung</span>
          <select value={draft.pngDpi} onChange={(e) => set({ pngDpi: Number(e.target.value) })} aria-label="PNG-Auflösung">
            {[150, 200, 300, 360, 600, 720, 1200].map((d) => (
              <option key={d} value={d}>
                {d} dpi
              </option>
            ))}
          </select>
          <span>Mindestauflösung</span>
          <span className="row">
            <input type="number" min={0} step={50} value={draft.minDpi} onChange={(e) => set({ minDpi: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 80 }} aria-label="Mindestauflösung in dpi" />
            dpi
          </span>
          <span>Rand</span>
          <select value={draft.bounds} onChange={(e) => set({ bounds: e.target.value as ExportProfile['bounds'] })} aria-label="Rand">
            <option value="geometry">exakt die Geometrie</option>
            <option value="stroke">inklusive Konturstärke</option>
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={draft.mirror} onChange={(e) => set({ mirror: e.target.checked })} />
          Motive spiegeln (Flexfolie, Transferdruck)
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.sheet} onChange={(e) => set({ sheet: e.target.checked })} />
          Artwork-Blatt (PDF) beilegen
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.project} onChange={(e) => set({ project: e.target.checked })} />
          Projektdatei (.vdp) beilegen
        </label>
        <label className="field wide column">
          <span>Notizen (z. B. Vorgaben des Produzenten)</span>
          <textarea rows={3} value={draft.note} onChange={(e) => set({ note: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        {!draft.formats.length && <p className="error-text">Mindestens ein Dateiformat wählen.</p>}
        <div className="row end">
          {builtin && (
            <button
              className="btn"
              onClick={() => {
                app.resetProfile(src.id);
                close();
              }}
            >
              Standardwerte
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={close}>
            Abbrechen
          </button>
          <button
            className="btn accent"
            disabled={!draft.formats.length}
            onClick={() => {
              app.saveProfile(draft);
              close();
            }}
            data-testid="profile-save"
          >
            Speichern
          </button>
        </div>
      </div>
    </Modal>
  );
}
