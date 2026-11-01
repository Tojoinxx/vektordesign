import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Box, FileSpreadsheet, FileText, ImagePlus, Plus, Trash2 } from 'lucide-react';
import type { TechPack, TechReference } from '../model/types';
import { productionOf } from '../model/production';
import { measureTable } from '../techpack/measure';
import { STITCHES, constructionRows } from '../techpack/construction';
import { FABRICS } from '../store/patternOps';
import { REF_CATEGORIES, TRIM_PRESETS, addReferences, addTrim, techPackOf, updateTechPack } from '../store/techpackOps';
import { Modal } from './Chrome';
import { Field } from './ProductionPanel';
import { useApp, useAppState, useUi } from './hooks';

/**
 * Tech-Pack-Dialog: Angaben, Maßtabelle mit Toleranzen, Material und Zutaten, Verarbeitung und
 * Referenzbilder (Ziehen und Ablegen, Einfügen oder Auswählen). Export als PDF und Maßtabelle als CSV –
 * als Ergänzung zum Tech-Pack in LabwearOS.
 */

type Tab = 'info' | 'measures' | 'materials' | 'construction' | 'refs';
const TABS: { id: Tab; label: string }[] = [
  { id: 'info', label: 'Angaben' },
  { id: 'measures', label: 'Maße' },
  { id: 'materials', label: 'Material & Zutaten' },
  { id: 'construction', label: 'Verarbeitung' },
  { id: 'refs', label: 'Referenzen' },
];

const cm = (mm: number | null) => (mm == null ? '–' : (Math.round(mm) / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

/** Bilddatei verkleinern (max. 1600 px) und als Data-URL liefern. */
export async function imageToRef(file: Blob, name: string): Promise<Omit<TechReference, 'id'> | null> {
  if (!file.type.startsWith('image/')) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * k));
    const h = Math.max(1, Math.round(img.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { name: name.replace(/\.[^.]+$/, ''), image: c.toDataURL('image/jpeg', 0.86), w, h, category: 'Inspiration', note: '' };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function TechPackView() {
  const open = useUi((s) => s.techPack);
  if (!open) return null;
  return <TechPackInner />;
}

function TechPackInner() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const busy = useUi((s) => s.busy);
  const [tab, setTab] = useState<Tab>('info');
  const tp = techPackOf(doc.techPack);
  const ed = app.editor;
  const upd = (label: string, fn: (t: TechPack) => void) => {
    const out = updateTechPack(ed, label, fn);
    if (!out.ok && out.message) ed.toast(out.message, 'error');
  };
  const close = () => app.ui.setState({ techPack: false });
  return (
    <Modal title="Tech-Pack" onClose={close} wide testId="techpack">
      <p className="muted small">
        Ergänzung zum Tech-Pack in LabwearOS: Maße mit Größenstaffel, Schnittteile, Material, Verarbeitung, Artwork und Referenzen in einem PDF. Bei Abweichungen gelten die Angaben in LabwearOS.
      </p>
      <div className="tp-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} data-testid={`tp-tab-${t.id}`}>
            {t.label}
            {t.id === 'refs' && tp.references.length ? <span className="tp-count">{tp.references.length}</span> : null}
          </button>
        ))}
      </div>
      <div className="tp-body">
        {tab === 'info' && <InfoTab tp={tp} upd={upd} />}
        {tab === 'measures' && <MeasuresTab tp={tp} upd={upd} />}
        {tab === 'materials' && <MaterialsTab tp={tp} upd={upd} />}
        {tab === 'construction' && <ConstructionTab tp={tp} upd={upd} />}
        {tab === 'refs' && <RefsTab tp={tp} upd={upd} />}
      </div>
      <div className="row end tp-foot">
        {busy && <span className="muted small spacer">{busy}</span>}
        <button className="btn" onClick={() => void app.exportMeasureCsv()} disabled={!doc.pattern?.pieces.length} data-testid="tp-csv">
          <FileSpreadsheet size={16} /> Maßtabelle (CSV)
        </button>
        <button className="btn accent" onClick={() => void app.exportTechPack()} disabled={!!busy} data-testid="tp-pdf">
          <FileText size={16} /> Tech-Pack als PDF
        </button>
      </div>
    </Modal>
  );
}

type Upd = (label: string, fn: (t: TechPack) => void) => void;

function InfoTab({ tp, upd }: { tp: TechPack; upd: Upd }) {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const busy = useUi((s) => s.busy);
  const p = productionOf(doc);
  const text = (k: 'styleNo' | 'season' | 'brand' | 'designer', label: string, ph = '') => (
    <>
      <span>{label}</span>
      <Field value={tp[k]} label={label} placeholder={ph} testId={`tp-${k}`} onCommit={(v) => upd(label, (t) => void (t[k] = v.trim()))} />
    </>
  );
  return (
    <div className="tp-grid2">
      <div>
        <div className="form-grid">
          <span>Artikel</span>
          <span>
            {p.article} · Version {p.version} <span className="muted small">(Tab „Produktion“)</span>
          </span>
          {text('styleNo', 'Style-Nr.', 'z. B. TH-2027-01')}
          {text('season', 'Saison', 'z. B. FS 2027')}
          {text('brand', 'Marke')}
          {text('designer', 'Design')}
          <span>Status</span>
          <select value={tp.status} aria-label="Status" onChange={(e) => upd('Status', (t) => void (t.status = e.target.value as TechPack['status']))}>
            {(['Entwurf', 'Muster', 'Freigegeben'] as const).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <label className="tp-area">
          <span>Beschreibung</span>
          <TextArea value={tp.description} label="Beschreibung" placeholder="Kurzbeschreibung: Schnitt, Stoff, Besonderheiten" onCommit={(v) => upd('Beschreibung', (t) => void (t.description = v))} />
        </label>
      </div>
      <div>
        <div className="row">
          <strong className="spacer">3D-Ansichten fürs Deckblatt</strong>
          <button className="btn" onClick={() => void app.captureTechPackRenders()} disabled={!doc.pattern?.pieces.length || !!busy} data-testid="tp-renders">
            <Box size={15} /> {tp.renders ? 'Neu aufnehmen' : 'Aufnehmen'}
          </button>
        </div>
        {tp.renders ? (
          <div className="tp-renders">{(['front', 'back', 'side'] as const).map((k) => (tp.renders?.[k] ? <img key={k} src={tp.renders[k]} alt={k} /> : null))}</div>
        ) : (
          <p className="muted small">
            {doc.pattern?.pieces.length ? 'Noch nicht aufgenommen – beim PDF-Export passiert das automatisch.' : 'Ohne Schnittteile zeigt das Deckblatt keine 3D-Ansichten.'}
          </p>
        )}
        {tp.renders && <p className="muted small">Aufgenommen am {new Date(tp.renders.at).toLocaleString('de-DE')} mit der aktuellen Puppe. Nach Änderungen am Schnitt neu aufnehmen.</p>}
      </div>
    </div>
  );
}

function TextArea({ value, label, placeholder, onCommit, rows = 4 }: { value: string; label: string; placeholder?: string; onCommit: (v: string) => void; rows?: number }) {
  const [v, setV] = useState(value);
  const last = useRef(value);
  if (last.current !== value) {
    last.current = value;
    setV(value);
  }
  return (
    <textarea
      value={v}
      rows={rows}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

function MeasuresTab({ tp, upd }: { tp: TechPack; upd: Upd }) {
  const doc = useAppState((s) => s.doc);
  const t = useMemo(() => measureTable(doc), [doc]);
  if (!t) return <p className="muted">Die Maßtabelle entsteht aus dem Schnitt. Im Tab „Schnitt“ einen Grundschnitt erzeugen oder Schnittteile anlegen.</p>;
  return (
    <div className="tp-scroll">
      <table className="tp-table" data-testid="tp-measures">
        <thead>
          <tr>
            <th>Code</th>
            <th>Messpunkt</th>
            {t.sizes.map((s) => (
              <th key={s.id} className={`num ${s.base ? 'base' : ''}`}>
                {s.name}
              </th>
            ))}
            <th className="num">Tol. ± cm</th>
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r) => (
            <tr key={r.pom.id} title={r.pom.how}>
              <td>
                <b>{r.pom.code}</b>
              </td>
              <td>{r.pom.label}</td>
              {r.values.map((v, i) => (
                <td key={i} className={`num ${t.sizes[i].base ? 'base' : ''}`}>
                  {cm(v)}
                </td>
              ))}
              <td className="num">
                <Field
                  value={cm(tp.tolerances[r.pom.id] ?? r.pom.tol)}
                  numeric
                  width={52}
                  label={`Toleranz ${r.pom.label}`}
                  onCommit={(s) => {
                    const n = Number(s.replace(',', '.'));
                    if (Number.isFinite(n) && n >= 0) upd('Toleranz', (x) => void (x.tolerances[r.pom.id] = Math.round(n * 10)));
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        {t.kind === 'graded'
          ? 'Hervorgehoben: Basisgröße. Die anderen Größen werden aus dem Grundschnitt neu berechnet (gleiche Passform). Messanleitung als Tooltip und im PDF.'
          : 'Ohne Grundschnitt: Breite und Höhe je Schnittteil. Mit Grundschnitt gibt es die vollständige Maßtabelle mit Größenstaffel.'}
      </p>
    </div>
  );
}

function MaterialsTab({ tp, upd }: { tp: TechPack; upd: Upd }) {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const pat = doc.pattern;
  return (
    <div className="tp-scroll">
      <h4>Stoffe</h4>
      {pat?.materials.length ? (
        <ul className="tp-materials">
          {pat.materials.map((m) => (
            <li key={m.id}>
              <span className="swatch" style={{ background: m.color }} />
              <b>{m.name}</b> · {FABRICS.find((f) => f.id === m.fabric)?.name} · {m.gsm} g/m² · {m.color.toUpperCase()}
              <span className="muted small">
                {' '}
                –{' '}
                {pat.pieces
                  .filter((p) => p.material === m.id)
                  .map((p) => p.name)
                  .join(', ') || 'nicht verwendet'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Stoffe entstehen im Tab „Schnitt“.</p>
      )}
      <div className="row">
        <h4 className="spacer">Zutaten und Etiketten</h4>
        <button className="btn" onClick={() => addTrim(app.editor)} data-testid="tp-trim-add">
          <Plus size={15} /> Zeile
        </button>
      </div>
      <div className="tp-chips">
        {TRIM_PRESETS.filter((t) => !tp.trims.some((x) => x.name === t.name)).map((t) => (
          <button
            key={t.name}
            className="chip"
            onClick={() => upd('Zutat hinzufügen', (x) => void x.trims.push({ id: `tr${Date.now().toString(36)}${x.trims.length}`, name: t.name, spec: t.spec, qty: '1', placement: t.placement }))}
          >
            + {t.name}
          </button>
        ))}
      </div>
      {tp.trims.length > 0 && (
        <table className="tp-table" data-testid="tp-trims">
          <thead>
            <tr>
              <th>Zutat</th>
              <th>Spezifikation</th>
              <th>Menge</th>
              <th>Platzierung</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tp.trims.map((t) => {
              const set = (k: 'name' | 'spec' | 'qty' | 'placement', label: string) => (
                <Field value={t[k]} label={label} onCommit={(v) => upd('Zutat ändern', (x) => void (x.trims.find((y) => y.id === t.id)![k] = v))} />
              );
              return (
                <tr key={t.id}>
                  <td>{set('name', 'Zutat')}</td>
                  <td className="wide">{set('spec', 'Spezifikation')}</td>
                  <td>{set('qty', 'Menge')}</td>
                  <td className="wide">{set('placement', 'Platzierung')}</td>
                  <td>
                    <button className="icon-btn" aria-label="Zutat entfernen" onClick={() => upd('Zutat entfernen', (x) => void (x.trims = x.trims.filter((y) => y.id !== t.id)))}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ConstructionTab({ tp, upd }: { tp: TechPack; upd: Upd }) {
  const doc = useAppState((s) => s.doc);
  const rows = useMemo(() => constructionRows(doc), [doc]);
  return (
    <div className="tp-scroll">
      {rows.length ? (
        <table className="tp-table" data-testid="tp-construction">
          <thead>
            <tr>
              <th>Naht / Kante</th>
              <th>Teile</th>
              <th className="num">Länge</th>
              <th>Verarbeitung</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <b>{r.name}</b>
                  {r.count > 1 ? <span className="muted small"> ({r.count}×)</span> : null}
                </td>
                <td className="small">{r.pieces}</td>
                <td className="num">{cm(r.length)} cm</td>
                <td className="wide">
                  <input
                    type="text"
                    list="tp-stitches"
                    defaultValue={tp.construction[r.key] ?? r.suggestion}
                    key={tp.construction[r.key] ?? r.suggestion}
                    aria-label={`Verarbeitung ${r.name}`}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (tp.construction[r.key] ?? r.suggestion)) upd('Verarbeitung', (x) => void (v && v !== r.suggestion ? (x.construction[r.key] = v) : delete x.construction[r.key]));
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">Noch keine Nähte – im Tab „Schnitt“ Kanten verbinden.</p>
      )}
      <datalist id="tp-stitches">
        {STITCHES.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <label className="tp-area">
        <span>Hinweise zur Verarbeitung</span>
        <TextArea value={tp.notes} label="Hinweise" rows={4} placeholder="z. B. Nahtzugaben zum Rücken bügeln, Kordel nicht im Muster …" onCommit={(v) => upd('Hinweise', (t) => void (t.notes = v))} />
      </label>
    </div>
  );
}

function RefsTab({ tp, upd }: { tp: TechPack; upd: Upd }) {
  const app = useApp();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const ingest = async (files: File[]) => {
    const refs = (await Promise.all(files.map((f) => imageToRef(f, f.name || 'Bild')))).filter((r): r is Omit<TechReference, 'id'> => !!r);
    if (!refs.length) {
      app.editor.toast('Nur Bilder (PNG, JPG, WebP …) können Referenzen sein.', 'info');
      return;
    }
    addReferences(app.editor, refs);
  };
  const move = (id: string, d: -1 | 1) =>
    upd('Referenz verschieben', (t) => {
      const i = t.references.findIndex((r) => r.id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= t.references.length) return;
      const [r] = t.references.splice(i, 1);
      t.references.splice(j, 0, r);
    });
  return (
    <div
      className={`tp-drop ${over ? 'over' : ''}`}
      data-testid="tp-drop"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        void ingest([...e.dataTransfer.files]);
      }}
      onPaste={(e) => {
        const files = [...e.clipboardData.files];
        if (files.length) {
          e.preventDefault();
          e.stopPropagation();
          void ingest(files);
        }
      }}
      tabIndex={0}
    >
      <div className="tp-drop-hint">
        <ImagePlus size={22} />
        <span>
          Bilder hierher ziehen, mit <kbd>Strg+V</kbd> einfügen oder{' '}
          <button className="link-btn" onClick={() => input.current?.click()}>
            auswählen
          </button>
          . Inspiration, Details, Etiketten, Zutaten, Stoffmuster …
        </span>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          data-testid="tp-file"
          onChange={(e) => {
            void ingest([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
      <div className="tp-refs" data-testid="tp-refs">
        {tp.references.map((r, i) => (
          <div key={r.id} className="tp-ref">
            <img src={r.image} alt={r.name} />
            <div className="tp-ref-body">
              <Field value={r.name} label="Titel der Referenz" onCommit={(v) => upd('Referenz ändern', (t) => void (t.references.find((x) => x.id === r.id)!.name = v.trim() || r.name))} />
              <select
                value={r.category}
                aria-label="Kategorie"
                onChange={(e) => upd('Referenz ändern', (t) => void (t.references.find((x) => x.id === r.id)!.category = e.target.value as TechReference['category']))}
              >
                {REF_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <TextArea
                value={r.note}
                label="Notiz"
                rows={2}
                placeholder="Was soll übernommen werden?"
                onCommit={(v) => upd('Referenz ändern', (t) => void (t.references.find((x) => x.id === r.id)!.note = v))}
              />
              <div className="row end">
                <button className="icon-btn" disabled={i === 0} aria-label="Nach vorne" onClick={() => move(r.id, -1)}>
                  <ArrowUp size={15} />
                </button>
                <button className="icon-btn" disabled={i === tp.references.length - 1} aria-label="Nach hinten" onClick={() => move(r.id, 1)}>
                  <ArrowDown size={15} />
                </button>
                <button className="icon-btn" aria-label="Referenz entfernen" onClick={() => upd('Referenz entfernen', (t) => void (t.references = t.references.filter((x) => x.id !== r.id)))}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
