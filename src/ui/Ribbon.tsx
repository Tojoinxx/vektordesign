import type { ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Copy, FileImage, FileCode2, FileText, FileDown, Grid3x3, Maximize, Palette, Ruler, Sparkles, Trash2, Eye, EyeOff, Magnet } from 'lucide-react';
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
  IconTrim,
  IconExtend,
  IconMeasure,
  IconMove,
  IconRotate,
  IconScale,
  IconMirror,
  IconPatternRect,
  IconPatternCirc,
  IconOffset,
  IconFillet,
  IconChamfer,
  IconTextToPaths,
  IconToShape,
  IconUnion,
  IconSubtract,
  IconIntersect,
  IconExclude,
} from './icons';
import type { EditCommand } from './controller';
import { useUi } from './hooks';

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
  const tab = useUi((s) => s.ribbonTab);
  return (
    <div className="ribbon-wrap">
      <div className="ribbon-tabs" role="tablist" aria-label="Werkzeugleisten">
        <button role="tab" aria-selected={tab === 'sketch'} className={tab === 'sketch' ? 'on' : ''} onClick={() => app.ui.setState({ ribbonTab: 'sketch' })} data-testid="ribbon-sketch">
          Skizze
        </button>
        <button role="tab" aria-selected={tab === 'edit'} className={tab === 'edit' ? 'on' : ''} onClick={() => app.ui.setState({ ribbonTab: 'edit' })} data-testid="ribbon-edit">
          Bearbeiten
        </button>
      </div>
      {tab === 'sketch' ? <SketchRibbon /> : <EditRibbon />}
    </div>
  );
}

function EditRibbon() {
  const app = useApp();
  const tool = useAppState((s) => s.tool);
  const cmd = (c: EditCommand) => () => app.editCommand(c);
  return (
    <nav className="ribbon" aria-label="Bearbeiten">
      <Group title="Ändern">
        <Big icon={<IconMove />} label="Verschieben" onClick={cmd('move')} testId="edit-move" />
        <Big icon={<IconRotate />} label="Drehen" onClick={cmd('rotate')} testId="edit-rotate" />
        <Big icon={<IconScale />} label="Skalieren" onClick={cmd('scale')} testId="edit-scale" />
        <Big icon={<IconMirror />} label="Spiegeln" onClick={cmd('mirror')} testId="edit-mirror" />
        <div className="rb-col">
          <Small icon={<IconPatternRect size={18} />} label="Rechteckiges Muster" onClick={cmd('pattern-rect')} testId="edit-pattern-rect" />
          <Small icon={<IconPatternCirc size={18} />} label="Kreisförmiges Muster" onClick={cmd('pattern-circ')} testId="edit-pattern-circ" />
        </div>
      </Group>
      <Group title="Skizze">
        <Big icon={<IconTrim />} label="Stutzen" kbd="X" active={tool === 'trim'} onClick={() => app.setTool('trim')} testId="tool-trim" />
        <Big icon={<IconExtend />} label="Dehnen" kbd="E" active={tool === 'extend'} onClick={() => app.setTool('extend')} testId="tool-extend" />
      </Group>
      <Group title="Form">
        <Big icon={<IconTextToPaths />} label="Text in Pfade" onClick={cmd('text-to-paths')} testId="edit-text-to-paths" />
        <Big icon={<IconOffset />} label="Versatz" kbd="O" onClick={cmd('offset')} testId="edit-offset" />
        <div className="rb-col">
          <Small icon={<IconFillet size={18} />} label="Abrunden" onClick={cmd('fillet')} testId="edit-fillet" />
          <Small icon={<IconChamfer size={18} />} label="Fase" onClick={cmd('chamfer')} testId="edit-chamfer" />
        </div>
        <div className="rb-col">
          <Small icon={<IconToShape size={18} />} label="In Form umwandeln (Skizze → freie Form)" onClick={cmd('to-shape')} testId="edit-to-shape" />
        </div>
      </Group>
      <Group title="Kombinieren">
        <Big icon={<IconUnion />} label="Vereinigen" onClick={cmd('union')} testId="bool-union" />
        <Big icon={<IconSubtract />} label="Subtrahieren" onClick={cmd('subtract')} testId="bool-subtract" />
        <div className="rb-col">
          <Small icon={<IconIntersect size={18} />} label="Schnittmenge" onClick={cmd('intersect')} testId="bool-intersect" />
          <Small icon={<IconExclude size={18} />} label="Ausschließen" onClick={cmd('exclude')} testId="bool-exclude" />
        </div>
      </Group>
      <Group title="Messen">
        <Big icon={<IconMeasure />} label="Messen" kbd="M" active={tool === 'measure'} onClick={() => app.setTool('measure')} testId="tool-measure" />
      </Group>
      <Group title="Export">
        <Big icon={<FileCode2 size={24} strokeWidth={1.75} />} label="SVG" onClick={() => app.openExport('svg')} />
        <Big icon={<FileText size={24} strokeWidth={1.75} />} label="PDF" onClick={() => app.openExport('pdf')} testId="export-pdf" />
        <div className="rb-col">
          <Small icon={<FileDown size={17} />} label="EPS" onClick={() => app.openExport('eps')} />
          <Small icon={<FileDown size={17} />} label="DXF" onClick={() => app.openExport('dxf')} />
        </div>
        <Big icon={<FileImage size={24} strokeWidth={1.75} />} label="PNG" onClick={() => app.openExport('png', 300)} />
      </Group>
    </nav>
  );
}

function SketchRibbon() {
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
        <Big icon={<FileText size={24} strokeWidth={1.75} />} label="PDF" onClick={() => app.openExport('pdf')} />
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
