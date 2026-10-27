import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import { layerIdOf, layersOf } from '../model/layers';
import { useApp, useAppState } from './hooks';

/** Ebenen: oben in der Liste = vorne in der Zeichnung. */
export function LayersPanel() {
  const app = useApp();
  const ed = app.editor;
  const doc = useAppState((s) => s.doc);
  const selection = useAppState((s) => s.selection);
  useAppState((s) => s.activeLayer);
  const [editing, setEditing] = useState<string | null>(null);
  const layers = layersOf(doc);
  const active = ed.targetLayer(doc);
  const counts = new Map<string, number>();
  for (const id of doc.order) {
    const e = doc.entities[id];
    if (e) counts.set(layerIdOf(doc, e), (counts.get(layerIdOf(doc, e)) ?? 0) + 1);
  }
  const report = (out: { ok: boolean; message?: string }) => {
    if (!out.ok && out.message) ed.toast(out.message, 'error');
  };

  return (
    <div className="layers" data-testid="layers">
      <section className="props-section">
        <div className="row">
          <h3 className="spacer">Ebenen</h3>
          <button className="btn" onClick={() => ed.addLayer()} data-testid="layer-add">
            <Plus size={15} /> Neue Ebene
          </button>
        </div>
        <p className="muted small">Oben in der Liste liegt vorne. Neue Objekte kommen auf die markierte Ebene; beim Export bleiben die Namen erhalten.</p>
        <ul className="layer-list">
          {[...layers].reverse().map((l) => {
            const i = layers.indexOf(l);
            return (
              <li key={l.id} className={`layer-row ${l.id === active ? 'on' : ''} ${l.visible ? '' : 'off'}`} data-testid={`layer-${l.id}`}>
                <button className="icon-btn" onClick={() => report(ed.updateLayer(l.id, { visible: !l.visible }))} title={l.visible ? 'Ausblenden' : 'Einblenden'} aria-label={l.visible ? `${l.name} ausblenden` : `${l.name} einblenden`}>
                  {l.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <button className="icon-btn" onClick={() => report(ed.updateLayer(l.id, { locked: !l.locked }))} title={l.locked ? 'Entsperren' : 'Sperren'} aria-label={l.locked ? `${l.name} entsperren` : `${l.name} sperren`}>
                  {l.locked ? <Lock size={15} /> : <LockOpen size={15} />}
                </button>
                {editing === l.id ? (
                  <input
                    className="layer-name-input"
                    defaultValue={l.name}
                    autoFocus
                    onBlur={(e) => {
                      const v = e.currentTarget.value.trim();
                      if (v && v !== l.name) report(ed.updateLayer(l.id, { name: v }));
                      setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setEditing(null);
                      e.stopPropagation();
                    }}
                    aria-label="Ebenenname"
                  />
                ) : (
                  <button className="layer-name" onClick={() => ed.setActiveLayer(l.id)} onDoubleClick={() => setEditing(l.id)} title="Klicken: neue Objekte hierhin · Doppelklick: umbenennen">
                    {l.name}
                    <span className="muted small"> {counts.get(l.id) ?? 0}</span>
                  </button>
                )}
                <button className="icon-btn" disabled={i === layers.length - 1} onClick={() => report(ed.moveLayer(l.id, 1))} title="Nach vorne" aria-label="Ebene nach vorne">
                  <ArrowUp size={14} />
                </button>
                <button className="icon-btn" disabled={i === 0} onClick={() => report(ed.moveLayer(l.id, -1))} title="Nach hinten" aria-label="Ebene nach hinten">
                  <ArrowDown size={14} />
                </button>
                <button
                  className="icon-btn"
                  disabled={layers.length < 2}
                  onClick={() =>
                    ed.confirm({
                      title: `Ebene „${l.name}“ löschen?`,
                      text: 'Die Objekte der Ebene bleiben erhalten und wandern auf die Ebene darunter.',
                      confirm: 'Ebene löschen',
                      onConfirm: () => report(ed.deleteLayer(l.id)),
                    })
                  }
                  title="Ebene löschen"
                  aria-label="Ebene löschen"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
        {selection.length > 0 && (
          <div className="row wrap">
            <button className="btn" onClick={() => report(ed.moveToLayer(selection, active))} data-testid="to-layer">
              Auswahl auf „{layers.find((l) => l.id === active)?.name}“
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
