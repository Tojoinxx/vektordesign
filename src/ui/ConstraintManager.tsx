import { memo, useMemo, useState } from 'react';
import { AlertTriangle, Crosshair, Ruler, Trash2 } from 'lucide-react';
import type { Id, SketchDoc } from '../model/types';
import { CONSTRAINT_LABELS } from '../solver/analysis';
import { DIM_KIND_LABELS } from '../store/editor';
import { formatNumber } from '../params/expr';
import { entityBBox } from '../model/bounds';
import { bboxAddPoint, bboxUnion, bboxValid, emptyBBox } from '../model/geometry';
import { ConstraintIcon } from './icons';
import { useApp, useAppState } from './hooks';

/**
 * Abhängigkeits-Manager (wie der Constraint Manager in Onshape): alle Abhängigkeiten und Bemaßungen der Skizze als
 * Liste mit Filter. Überfahren hebt die beteiligte Geometrie hervor, Klick wählt aus, Fadenkreuz zeigt sie,
 * Papierkorb löscht. Konflikte (Überbestimmung) stehen oben und sind rot markiert.
 */

type Filter = 'all' | 'problems' | 'constraints' | 'dims';

const REF_NAMES: Record<string, string> = { line: 'Linie', circle: 'Kreis', arc: 'Bogen', path: 'Fläche', text: 'Text', shape: 'Form', image: 'Bild' };

function refText(doc: SketchDoc, refs: Id[]): string {
  const parts = refs.map((r) => {
    if (doc.points[r]) return r === 'origin' ? 'Ursprung' : 'Punkt';
    const e = doc.entities[r];
    return e ? (REF_NAMES[e.kind] ?? e.kind) : '?';
  });
  return parts.join(' · ');
}

function refsBox(doc: SketchDoc, refs: Id[]) {
  let b = emptyBBox();
  for (const r of refs) {
    const p = doc.points[r];
    if (p) bboxAddPoint(b, p);
    const e = doc.entities[r];
    if (e) {
      const eb = entityBBox(doc, e);
      if (bboxValid(eb)) b = bboxUnion(b, eb);
    }
  }
  return bboxValid(b) ? b : null;
}

export const ConstraintManager = memo(function ConstraintManager() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const analysis = useAppState((s) => s.analysis);
  const selection = useAppState((s) => s.selection);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => {
    const bad = new Set(analysis.conflicting);
    const red = new Set(analysis.redundant);
    const out: { id: Id; kind: 'c' | 'd'; label: string; detail: string; problem: 'conflict' | 'redundant' | null; icon: string }[] = [];
    for (const c of Object.values(doc.constraints)) {
      if (c.quiet) continue;
      out.push({
        id: c.id,
        kind: 'c',
        label: CONSTRAINT_LABELS[c.kind] ?? c.kind,
        detail: refText(doc, c.refs),
        problem: bad.has(c.id) ? 'conflict' : red.has(c.id) ? 'redundant' : null,
        icon: c.kind,
      });
    }
    for (const d of Object.values(doc.dims)) {
      const unit = d.kind === 'angle' || d.kind === 'angleX' ? '°' : ' mm';
      const v = `${formatNumber(d.value, 2)}${unit}`;
      out.push({
        id: d.id,
        kind: 'd',
        label: `${d.name} = ${d.driven ? `(${v})` : v}`,
        detail: `${DIM_KIND_LABELS[d.kind] ?? d.kind}${d.driven ? ' · getrieben' : ''}`,
        problem: bad.has(d.id) ? 'conflict' : red.has(d.id) ? 'redundant' : null,
        icon: '',
      });
    }
    const rank = (r: (typeof out)[number]) => (r.problem === 'conflict' ? 0 : r.problem === 'redundant' ? 1 : 2);
    return out.sort((a, b) => rank(a) - rank(b));
  }, [doc, analysis]);

  const problems = rows.filter((r) => r.problem).length;
  const shown = rows.filter((r) => (filter === 'all' ? true : filter === 'problems' ? !!r.problem : filter === 'constraints' ? r.kind === 'c' : r.kind === 'd'));
  if (!rows.length) return null;

  const hover = (id: Id | null) => app.editor.store.setState({ hover: id });
  const zoomTo = (id: Id) => {
    const c = doc.constraints[id];
    const d = doc.dims[id];
    const box = refsBox(doc, c?.refs ?? d?.refs ?? []);
    if (!box) return;
    const v = app.store.getState().view;
    const w = Math.max(box.maxX - box.minX, box.maxY - box.minY, 10);
    app.editor.setView({ cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, zoom: Math.min(v.zoom * 4, Math.max(v.zoom, 300 / w)) });
    app.editor.select([id]);
  };
  const MAX = 250;

  return (
    <div className="cmgr" data-testid="constraint-manager">
      <button className="disclosure" aria-expanded={open || problems > 0} onClick={() => setOpen((o) => !o)} data-testid="cmgr-toggle">
        Abhängigkeits-Manager <span className="muted">({rows.length})</span>
        {problems > 0 && (
          <span className="cmgr-badge" title="Konflikte bzw. überflüssige Abhängigkeiten">
            <AlertTriangle size={12} /> {problems}
          </span>
        )}
      </button>
      {(open || problems > 0) && (
        <>
          <div className="segmented cmgr-filter" role="group" aria-label="Filter">
            {(
              [
                ['all', 'Alle'],
                ['problems', `Probleme${problems ? ` (${problems})` : ''}`],
                ['constraints', 'Abhängigk.'],
                ['dims', 'Maße'],
              ] as [Filter, string][]
            ).map(([k, l]) => (
              <button key={k} className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
          <ul className="cmgr-list" onMouseLeave={() => hover(null)}>
            {shown.slice(0, MAX).map((r) => (
              <li key={r.id} className={`${r.problem ? `cmgr-${r.problem}` : ''} ${selection.includes(r.id) ? 'sel' : ''}`} onMouseEnter={() => hover(r.id)} data-testid={`cmgr-row-${r.id}`}>
                <button
                  className="cmgr-main"
                  onClick={() => app.editor.select([r.id])}
                  onDoubleClick={() => zoomTo(r.id)}
                  title={
                    r.problem === 'conflict'
                      ? 'Widerspricht anderen Vorgaben – löschen oder als getrieben setzen'
                      : r.problem === 'redundant'
                        ? 'Überflüssig – folgt schon aus anderen Vorgaben'
                        : 'Klick wählt aus, Doppelklick zeigt'
                  }
                >
                  <span className="cmgr-icon">{r.kind === 'c' ? <ConstraintIcon kind={r.icon as never} size={16} /> : <Ruler size={15} />}</span>
                  <span className="cmgr-text">
                    <span>{r.label}</span>
                    <span className="muted small">{r.detail}</span>
                  </span>
                </button>
                <button className="icon-btn" title="Zeigen" aria-label="Zeigen" onClick={() => zoomTo(r.id)}>
                  <Crosshair size={14} />
                </button>
                <button
                  className="icon-btn"
                  title="Löschen"
                  aria-label={`${r.label} löschen`}
                  onClick={() => {
                    hover(null);
                    app.editor.deleteIds([r.id]);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
          {shown.length > MAX && <p className="muted small">… und {shown.length - MAX} weitere</p>}
          {!shown.length && <p className="muted small">Keine Einträge für diesen Filter.</p>}
        </>
      )}
    </div>
  );
});
