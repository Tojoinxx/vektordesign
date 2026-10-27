import type { ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Copy, FileImage, FileCode2, Grid3x3, Maximize, Palette, Ruler, Sparkles, Trash2, Eye, EyeOff, Magnet } from 'lucide-react';
import type { ConstraintKind } from '../model/types';
import { CONSTRAINT_LABELS } from '../solver/analysis';
import type { ToolId } from '../store/state';
import { useApp, useAppState } from './hooks';
import {
  ConstraintIcon,
  CONSTRAINT_ORDER,
  IconCircle,
  IconConstruction,
  IconDimension,
  IconGradient,
  IconLine,
  IconPoint,
  IconRect,
  IconRectCenter,
  IconSelect,
  IconText,
} from './icons';

function Big({ icon, label, kbd, active, onClick, testId }: { icon: ReactNode; label: string; kbd?: string; active?: boolean; onClick: () => void; testId?: string }) {
  return (
    <button className={`rb-big ${active ? 'on' : ''}`} onClick={onClick} title={kbd ? `${label} (${kbd})` : label} aria-pressed={active} data-testid={testId}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Small({ icon, label, kbd, active, onClick, testId }: { icon: ReactNode; label: string; kbd?: string; active?: boolean; onClick: () => void; testId?: string }) {
  return (
    <button className={`rb-small ${active ? 'on' : ''}`} onClick={onClick} title={kbd ? `${label} (${kbd})` : label} aria-label={label} aria-pressed={active} data-testid={testId}>
      {icon}
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rb-group" role="group" aria-label={title}>
      <div className="rb-items">{children}</div>
      <div className="rb-title">{title}</div>
    </div>
  );
}

export function Ribbon() {
  const app = useApp();
  const tool = useAppState((s) => s.tool);
  const rectMode = useAppState((s) => s.rectMode);
  const construction = useAppState((s) => s.constructionMode);
  const settings = useAppState((s) => s.settings);
  const hasSel = useAppState((s) => s.selection.length > 0);
  const set = (id: ToolId) => app.setTool(id);
  const toggleSetting = (k: keyof typeof settings) => app.store.setState({ settings: { ...settings, [k]: !settings[k] } });

  return (
    <nav className="ribbon" aria-label="Werkzeuge">
      <Group title="Zeichnen">
        <Big icon={<IconSelect />} label="Auswahl" kbd="Esc" active={tool === 'select'} onClick={() => set('select')} testId="tool-select" />
        <Big icon={<IconLine />} label="Linie" kbd="L" active={tool === 'line'} onClick={() => set('line')} testId="tool-line" />
        <div className="rb-split">
          <Big icon={rectMode === 'center' ? <IconRectCenter /> : <IconRect />} label="Rechteck" kbd="R" active={tool === 'rect'} onClick={() => set('rect')} testId="tool-rect" />
          <div className="rb-split-modes">
            <Small
              icon={<IconRect size={16} />}
              label="Rechteck über 2 Punkte"
              active={rectMode === 'corner'}
              onClick={() => {
                app.store.setState({ rectMode: 'corner' });
                set('rect');
              }}
              testId="rect-mode-corner"
            />
            <Small
              icon={<IconRectCenter size={16} />}
              label="Rechteck vom Mittelpunkt"
              active={rectMode === 'center'}
              onClick={() => {
                app.store.setState({ rectMode: 'center' });
                set('rect');
              }}
              testId="rect-mode-center"
            />
          </div>
        </div>
        <Big icon={<IconCircle />} label="Kreis" kbd="C" active={tool === 'circle'} onClick={() => set('circle')} testId="tool-circle" />
        <Big icon={<IconText />} label="Text" kbd="T" active={tool === 'text'} onClick={() => set('text')} testId="tool-text" />
        <div className="rb-col">
          <Small icon={<IconPoint size={18} />} label="Punkt" kbd="P" active={tool === 'point'} onClick={() => set('point')} />
          <Small icon={<IconConstruction size={18} />} label="Neue Geometrie als Konstruktion (gestrichelt, nicht exportiert)" active={construction} onClick={() => app.store.setState({ constructionMode: !construction })} />
        </div>
      </Group>

      <Group title="Bemaßung">
        <Big icon={<IconDimension />} label="Bemaßung" kbd="D" active={tool === 'dimension'} onClick={() => set('dimension')} testId="tool-dimension" />
      </Group>

      <Group title="Abhängigkeiten">
        <div className="rb-grid">
          {CONSTRAINT_ORDER.map((k) => (
            <Small
              key={k}
              icon={<ConstraintIcon kind={k as ConstraintKind} size={18} />}
              label={CONSTRAINT_LABELS[k]}
              active={tool === `constraint:${k}`}
              onClick={() => app.constraintCommand(k as ConstraintKind)}
              testId={`constraint-${k}`}
            />
          ))}
        </div>
        <div className="rb-col">
          <Small icon={<Eye size={17} />} label="Alle Abhängigkeiten anzeigen" kbd="F8" active={settings.showGlyphs} onClick={() => app.store.setState({ settings: { ...settings, showGlyphs: true } })} />
          <Small icon={<EyeOff size={17} />} label="Abhängigkeiten ausblenden" kbd="F9" active={!settings.showGlyphs} onClick={() => app.store.setState({ settings: { ...settings, showGlyphs: false } })} />
        </div>
      </Group>

      <Group title="Gestalten">
        <Big icon={<IconGradient />} label="Verlauf" kbd="G" active={tool === 'gradient'} onClick={() => set('gradient')} testId="tool-gradient" />
        <Big
          icon={<Palette size={24} strokeWidth={1.75} />}
          label="Vorschläge"
          onClick={() => {
            app.ui.setState({ side: 'props', sideOpen: true });
            app.showTutorialFor('suggestions');
            setTimeout(() => document.getElementById('stilvorschlaege')?.scrollIntoView({ behavior: 'smooth' }), 50);
          }}
        />
        <div className="rb-col">
          <Small icon={<ArrowUpToLine size={17} />} label="Ganz nach vorne" kbd="Strg+Umschalt+]" onClick={() => app.editor.arrange(app.editor.s.selection, 'front')} />
          <Small icon={<ArrowDownToLine size={17} />} label="Ganz nach hinten" kbd="Strg+Umschalt+[" onClick={() => app.editor.arrange(app.editor.s.selection, 'back')} />
        </div>
        <div className="rb-col">
          <Small icon={<ChevronUp size={17} />} label="Nach vorne" kbd="Strg+]" onClick={() => app.editor.arrange(app.editor.s.selection, 'forward')} />
          <Small icon={<ChevronDown size={17} />} label="Nach hinten" kbd="Strg+[" onClick={() => app.editor.arrange(app.editor.s.selection, 'backward')} />
        </div>
        <div className="rb-col">
          <Small icon={<Copy size={17} />} label="Duplizieren" kbd="Strg+D" onClick={() => app.editor.duplicate()} />
          <Small
            icon={<Trash2 size={17} />}
            label="Löschen"
            kbd="Entf"
            onClick={() => {
              if (hasSel) app.editor.deleteSelection();
            }}
          />
        </div>
      </Group>

      <Group title="Ansicht">
        <Big icon={<Maximize size={24} strokeWidth={1.75} />} label="Alles" kbd="F" onClick={() => app.editor.zoomToFit()} testId="view-fit" />
        <div className="rb-col">
          <Small icon={<Grid3x3 size={17} />} label="Raster" active={settings.grid} onClick={() => toggleSetting('grid')} />
          <Small icon={<Magnet size={17} />} label="Am Raster fangen" active={settings.gridSnap} onClick={() => toggleSetting('gridSnap')} />
        </div>
        <div className="rb-col">
          <Small icon={<Ruler size={17} />} label="Bemaßungen anzeigen" active={settings.showDims} onClick={() => toggleSetting('showDims')} />
          <Small icon={<IconLine size={17} />} label="Skizzenlinien anzeigen (aus = reine Designvorschau)" active={settings.showOverlay} onClick={() => toggleSetting('showOverlay')} />
        </div>
      </Group>

      <Group title="Export">
        <Big icon={<FileCode2 size={24} strokeWidth={1.75} />} label="SVG" onClick={() => app.openExport('svg')} testId="export-svg" />
        <Big icon={<FileImage size={24} strokeWidth={1.75} />} label="PNG" onClick={() => app.openExport('png', 300)} testId="export-png" />
      </Group>

      <Group title="KI">
        <Big
          icon={<Sparkles size={24} strokeWidth={1.75} />}
          label="Claude"
          kbd="Strg+I"
          onClick={() => {
            app.ui.setState({ side: 'claude', sideOpen: true });
            app.showTutorialFor('claude');
          }}
          testId="open-claude"
        />
      </Group>
    </nav>
  );
}
