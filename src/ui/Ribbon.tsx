import type { ReactNode } from 'react';
import { garmentOf } from '../model/garments';
import { productionOf } from '../model/production';
import {
  ShieldCheck,
  ImagePlus,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Copy,
  FileImage,
  FileCode2,
  FileText,
  FileDown,
  Grid3x3,
  Maximize,
  Palette,
  Paintbrush,
  Ruler,
  Sparkles,
  Trash2,
  Eye,
  EyeOff,
  Magnet,
} from 'lucide-react';
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
  IconSketch,
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
  IconHalftone,
  IconSymmetry,
  IconTextCircle,
  IconShadow,
  IconReduce,
  IconBadge,
  IconGrunge,
  IconRapport,
  IconArc3,
  IconArcCenter,
  IconEllipse,
  IconPolygon,
  IconStar,
  IconPen,
  IconProfile,
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
  const collapsed = useUi((s) => s.ribbonCollapsed);
  const setCollapsed = (v: boolean) => {
    app.ui.setState({ ribbonCollapsed: v });
    try {
      localStorage.setItem('vd.ribbon', v ? 'collapsed' : 'open');
    } catch {
      /* kein Speicher */
    }
  };
  const pick = (t: 'sketch' | 'edit') => {
    app.ui.setState({ ribbonTab: t });
    if (collapsed) setCollapsed(false);
  };
  return (
    <div className="ribbon-wrap">
      <div className="ribbon-tabs" role="tablist" aria-label="Werkzeugleisten">
        <button role="tab" aria-selected={tab === 'sketch'} className={tab === 'sketch' ? 'on' : ''} onClick={() => pick('sketch')} data-testid="ribbon-sketch">
          Skizze
        </button>
        <button role="tab" aria-selected={tab === 'edit'} className={tab === 'edit' ? 'on' : ''} onClick={() => pick('edit')} data-testid="ribbon-edit">
          Bearbeiten
        </button>
        <span className="spacer" />
        <button
          className="ribbon-collapse"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Werkzeugband einblenden' : 'Werkzeugband einklappen (mehr Platz zum Zeichnen)'}
          aria-label={collapsed ? 'Werkzeugband einblenden' : 'Werkzeugband einklappen'}
          data-testid="ribbon-collapse"
        >
          {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
      </div>
      {collapsed ? null : tab === 'sketch' ? <SketchRibbon /> : <EditRibbon />}
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
      <Group title="Textil">
        <Big icon={<IconHalftone />} label="Halbton" onClick={cmd('halftone')} testId="edit-halftone" />
        <Big icon={<IconGrunge />} label="Used-Look" onClick={cmd('grunge')} testId="edit-grunge" />
        <Big icon={<IconRapport />} label="Rapport" onClick={cmd('rapport')} testId="edit-rapport" />
        <Big icon={<IconTextCircle />} label="Text auf Kreis" onClick={cmd('text-circle')} testId="edit-text-circle" />
        <div className="rb-col">
          <Small icon={<IconShadow size={18} />} label="Schatten" onClick={cmd('shadow')} testId="edit-shadow" />
          <Small icon={<IconReduce size={18} />} label="Farben reduzieren" onClick={cmd('reduce-colors')} testId="edit-reduce" />
        </div>
      </Group>
      <Group title="Messen und Prüfen">
        <Big icon={<IconMeasure />} label="Messen" kbd="M" active={tool === 'measure'} onClick={() => app.setTool('measure')} testId="tool-measure" />
        <Big icon={<ShieldCheck size={24} strokeWidth={1.75} />} label="Prüfen" onClick={() => void app.preflight()} testId="preflight-open" />
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

/** Druckbereich des gewählten Kleidungsstücks als Rahmen auf der Arbeitsfläche. */
function PrintAreaSelect() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const area = useUi((s) => s.printArea);
  const g = garmentOf(productionOf(doc).garment);
  return (
    <label className="rb-select" title="Druckbereich in echten Maßen als Rahmen anzeigen (wird nicht exportiert)">
      <span>Druckbereich</span>
      <select value={area ?? ''} onChange={(e) => app.ui.setState({ printArea: e.target.value || null })} data-testid="print-area">
        <option value="">keiner</option>
        {g.areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.w} × {a.h})
          </option>
        ))}
      </select>
    </label>
  );
}

const SYM_LABELS = { off: 'aus', v: 'senkrechte Achse', h: 'waagrechte Achse', vh: 'beide Achsen (4-fach)' } as const;
const SYM_NEXT = { off: 'v', v: 'h', h: 'vh', vh: 'off' } as const;

function SketchRibbon() {
  const app = useApp();
  const tool = useAppState((s) => s.tool);
  const rectMode = useAppState((s) => s.rectMode);
  const arcMode = useAppState((s) => s.arcMode);
  const symmetry = useAppState((s) => s.symmetry);
  const polygonMode = useAppState((s) => s.polygonMode);
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
        <div className="rb-split">
          <Big icon={arcMode === 'center' ? <IconArcCenter /> : <IconArc3 />} label="Bogen" kbd="A" active={tool === 'arc'} onClick={() => set('arc')} testId="tool-arc" />
          <div className="rb-split-modes">
            <Small
              icon={<IconArc3 size={16} />}
              label="Bogen durch 3 Punkte"
              active={arcMode === '3p'}
              onClick={() => {
                app.store.setState({ arcMode: '3p' });
                set('arc');
              }}
              testId="arc-mode-3p"
            />
            <Small
              icon={<IconArcCenter size={16} />}
              label="Bogen vom Mittelpunkt"
              active={arcMode === 'center'}
              onClick={() => {
                app.store.setState({ arcMode: 'center' });
                set('arc');
              }}
              testId="arc-mode-center"
            />
          </div>
        </div>
        <div className="rb-col">
          <Small icon={<IconEllipse size={18} />} label="Ellipse" active={tool === 'ellipse'} onClick={() => set('ellipse')} testId="tool-ellipse" />
          <Small
            icon={<IconPolygon size={18} />}
            label={`Vieleck (${polygonMode === 'inscribed' ? 'Inkreis' : 'Umkreis'}) – erneut klicken wechselt`}
            kbd="N"
            active={tool === 'polygon'}
            onClick={() => {
              if (tool === 'polygon') app.store.setState({ polygonMode: polygonMode === 'inscribed' ? 'circumscribed' : 'inscribed' });
              set('polygon');
            }}
            testId="tool-polygon"
          />
        </div>
        <div className="rb-col">
          <Small icon={<IconStar size={18} />} label="Stern" active={tool === 'star'} onClick={() => set('star')} testId="tool-star" />
          <Small icon={<IconPen size={18} />} label="Zeichenstift (Bézierpfad)" kbd="B" active={tool === 'pen'} onClick={() => set('pen')} testId="tool-pen" />
        </div>
        <Big icon={<IconText />} label="Text" kbd="T" active={tool === 'text'} onClick={() => set('text')} testId="tool-text" />
        <Big icon={<IconSketch />} label="Freihand" kbd="S" active={tool === 'sketch'} onClick={() => set('sketch')} testId="tool-sketch" />
        <Big icon={<ImagePlus size={24} strokeWidth={1.75} />} label="Bild" onClick={() => void app.insertImage()} testId="insert-image" />
        <Big icon={<IconBadge />} label="Vorlagen" onClick={() => app.ui.setState({ generator: true })} testId="insert-generator" />
        <div className="rb-col">
          <Small icon={<IconPoint size={18} />} label="Punkt" kbd="P" active={tool === 'point'} onClick={() => set('point')} />
          <Small
            icon={<IconProfile size={18} />}
            label="Geschlossene Fläche aus gewählten Linien und Bögen"
            onClick={() => {
              const out = app.editor.createProfile(app.editor.s.selection);
              if (!out.ok) app.editor.toast(out.message, 'error', 6000);
              else if (out.pathId) app.editor.select([out.pathId]);
            }}
            testId="draw-profile"
          />
          <Small
            icon={<IconConstruction size={18} />}
            label="Neue Geometrie als Konstruktion (gestrichelt, nicht exportiert)"
            active={construction}
            onClick={() => app.store.setState({ constructionMode: !construction })}
          />
          <Small
            icon={<IconSymmetry size={18} mode={symmetry} />}
            label={`Symmetrie: ${SYM_LABELS[symmetry]} – klicken wechselt (aus → senkrecht → waagrecht → beide)`}
            active={symmetry !== 'off'}
            onClick={() => app.store.setState({ symmetry: SYM_NEXT[symmetry] })}
            testId="symmetry"
          />
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
          <Small
            icon={<Eye size={17} />}
            label="Alle Abhängigkeiten anzeigen"
            kbd="F8"
            active={settings.showGlyphs}
            onClick={() => app.store.setState({ settings: { ...settings, showGlyphs: true } })}
          />
          <Small
            icon={<EyeOff size={17} />}
            label="Abhängigkeiten ausblenden"
            kbd="F9"
            active={!settings.showGlyphs}
            onClick={() => app.store.setState({ settings: { ...settings, showGlyphs: false } })}
          />
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
        <Big icon={<Paintbrush size={24} strokeWidth={1.75} />} label="Format übertragen" active={tool === 'format'} onClick={() => set('format')} testId="tool-format" />
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
        <PrintAreaSelect />
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
