import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Group,
  Ungroup,
} from 'lucide-react';
import type { Id } from '../model/types';
import { unitTargets } from '../store/editor';
import { useApp, useAppState } from './hooks';

/** Ausrichten, Verteilen und Gruppieren für die Auswahl. */
export function ArrangeSection({ targets }: { targets: Id[] }) {
  const app = useApp();
  const ed = app.editor;
  const doc = useAppState((s) => s.doc);
  const units = unitTargets(doc, targets);
  const grouped = targets.some((id) => doc.entities[id]?.group);
  const report = (out: { ok: boolean; message?: string }) => {
    if (!out.ok && out.message) ed.toast(out.message, 'error');
  };
  if (units.length < 2 && !grouped) return null;
  const btn = (label: string, icon: React.ReactNode, run: () => void, testid: string, disabled = false) => (
    <button className="icon-btn" title={label} aria-label={label} onClick={run} disabled={disabled} data-testid={testid}>
      {icon}
    </button>
  );
  return (
    <section className="props-section" aria-label="Anordnen">
      <h4>Ausrichten und Verteilen</h4>
      <div className="row wrap arrange-row">
        {btn('Links ausrichten', <AlignStartVertical size={17} />, () => report(ed.align('left')), 'align-left', units.length < 2)}
        {btn('Horizontal mittig', <AlignCenterVertical size={17} />, () => report(ed.align('hcenter')), 'align-hcenter', units.length < 2)}
        {btn('Rechts ausrichten', <AlignEndVertical size={17} />, () => report(ed.align('right')), 'align-right', units.length < 2)}
        {btn('Oben ausrichten', <AlignStartHorizontal size={17} />, () => report(ed.align('top')), 'align-top', units.length < 2)}
        {btn('Vertikal mittig', <AlignCenterHorizontal size={17} />, () => report(ed.align('vcenter')), 'align-vcenter', units.length < 2)}
        {btn('Unten ausrichten', <AlignEndHorizontal size={17} />, () => report(ed.align('bottom')), 'align-bottom', units.length < 2)}
        <span className="arrange-sep" />
        {btn('Waagrecht verteilen', <AlignHorizontalDistributeCenter size={17} />, () => report(ed.distribute('x')), 'distribute-x', units.length < 3)}
        {btn('Senkrecht verteilen', <AlignVerticalDistributeCenter size={17} />, () => report(ed.distribute('y')), 'distribute-y', units.length < 3)}
      </div>
      <div className="row wrap">
        {units.length >= 2 && (
          <button className="btn" onClick={() => report(ed.group())} data-testid="group">
            <Group size={15} /> Gruppieren
          </button>
        )}
        {grouped && (
          <button className="btn" onClick={() => report(ed.ungroup())} data-testid="ungroup">
            <Ungroup size={15} /> Gruppierung aufheben
          </button>
        )}
      </div>
    </section>
  );
}
