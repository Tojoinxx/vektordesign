import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  BookOpenText,
  Box,
  ClipboardPaste,
  Table2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Plus,
  Ruler,
  Scissors,
  Spline,
  Trash2,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import type { BodyMeasures, PatternBlock, PatternMaterial, PieceRole } from '../model/types';
import { BLOCK_KINDS, FIT_NAMES, defaultBlock, generateBlock } from '../pattern/blocks';
import { POMS, blockPoms, pomsFor, specDeviations } from '../techpack/measure';
import { chartToSpecs, parseSizeChart } from '../pattern/sizeChart';
import { Modal } from './Chrome';
import { BODY_FIELDS, DEFAULT_SIZE, SIZE_TABLE, bodyForSize, checkBody } from '../pattern/body';
import { canBePiece, checkSeams, fabricArea, freeEdges, pieceById, pieceGeom } from '../pattern/geometry';
import { FABRICS, ROLE_NAMES, addMaterial, generatePattern, makePieces, removePiece, removeSeam, setBody, setPieceLook, updateMaterial, updatePiece, updateSeam } from '../store/patternOps';
import { formatNumber } from '../params/expr';
import { ColorButton } from './ColorPicker';
import { Field } from './ProductionPanel';
import { useApp, useAppState } from './hooks';

/**
 * Seitenleiste „Schnitt“: Grundschnitt aus Körpermaßen, eigene Schnittteile, Nähte mit Längenprüfung,
 * Stoffe – die Grundlage für die 3D-Passform in „Vektordesign 3D“.
 */

const mm = (n: number) => formatNumber(n, 1);
const shortSize = (id: string) => id.replace(/^[HD]-/, '');
const num = (s: string): number | null => {
  const n = Number(s.replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
};

export function PatternPanel() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const selection = useAppState((s) => s.selection);
  const pat = doc.pattern;
  const ed = app.editor;
  const report = (out: { ok: boolean; message?: string }) => {
    if (!out.ok && out.message) ed.toast(out.message, 'error');
    return out.ok;
  };
  const selectedPiece = pat?.pieces.find((p) => selection.includes(p.outline));
  const convertible = selection.filter((id) => canBePiece(doc, id) && !pat?.pieces.some((p) => p.outline === id));

  return (
    <div className="props pattern" data-testid="pattern-panel">
      <BlockSection />

      <section className="props-section">
        <div className="row">
          <h3 className="spacer">Schnittteile</h3>
          <button
            className="btn"
            disabled={!convertible.length}
            title="Ausgewählte geschlossene Kontur(en) als Schnittteil verwenden"
            data-testid="pattern-make-piece"
            onClick={() => {
              const out = makePieces(ed, convertible);
              if (report(out)) ed.toast(out.pieceIds!.length > 1 ? `${out.pieceIds!.length} Schnittteile angelegt` : 'Schnittteil angelegt', 'success');
            }}
          >
            <Plus size={15} /> Aus Auswahl
          </button>
        </div>
        {!pat?.pieces.length ? (
          <p className="muted small">
            Noch keine Teile. Erzeuge oben einen Grundschnitt oder zeichne eine geschlossene Kontur (Linien, Bögen, Zeichenstift), bemaße sie wie gewohnt und mache sie mit „Aus Auswahl“ zum
            Schnittteil.
          </p>
        ) : (
          <ul className="piece-list" data-testid="pattern-pieces">
            {pat.pieces.map((p) => {
              const g = pieceGeom(doc, p);
              const open = selectedPiece?.id === p.id;
              const free = freeEdges(doc, p).length;
              return (
                <li key={p.id} className={open ? 'on' : ''}>
                  <button className="piece-row" onClick={() => ed.select(open ? [] : [p.outline])} data-testid={`piece-${p.name}`}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="swatch" style={{ background: p.color ?? pat.materials.find((m) => m.id === p.material)?.color ?? 'transparent' }} />
                    <span className="spacer">{p.name}</span>
                    <span className="muted small">
                      {p.cut === 2 ? '2× ' : ''}
                      {g ? `${g.edges.length} Kanten` : 'ungültig'}
                      {free ? ` · ${free} offen` : ''}
                    </span>
                  </button>
                  {open && <PieceCard id={p.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SeamSection />
      <MaterialSection />

      <section className="props-section">
        <h3>Ausgabe</h3>
        {pat?.pieces.length ? (
          <p className="muted small" data-testid="pattern-fabric">
            Stoffbedarf (Fläche inkl. Nahtzugabe und Anzahl): {formatNumber(fabricArea(doc), 2)} m²
          </p>
        ) : null}
        <div className="stack">
          <button className="btn wide" onClick={() => app.ui.setState({ techPack: true })} data-testid="pattern-techpack">
            <BookOpenText size={16} /> Tech-Pack (Maße, Verarbeitung, PDF)
          </button>
          <button className="btn wide" onClick={() => void app.exportPatternDxf()} disabled={!pat?.pieces.length} data-testid="pattern-dxf">
            <Download size={16} /> Schnittteile als DXF
          </button>
          <button className="btn accent wide" onClick={() => app.toggle3D(true)} disabled={!pat?.pieces.length} data-testid="pattern-3d">
            <Box size={16} /> In 3D ansehen
          </button>
        </div>
        <p className="muted small">DXF mit Schnittlinie, Nahtlinie, Fadenlauf, Passzeichen und Beschriftung, 1:1 in mm. Schnittteile gehören nie zum Motiv-Export.</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BlockSection() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const ed = app.editor;
  const pat = doc.pattern;
  const existing = pat?.pieces.some((p) => p.block);
  const [kind, setKind] = useState<PatternBlock['kind']>(pat?.block?.kind ?? 'hoodie');
  const [fit, setFit] = useState<PatternBlock['fit']>(pat?.block?.fit ?? 'regular');
  const [size, setSize] = useState<string>(pat?.bodySize ?? DEFAULT_SIZE);
  const [body, setBodyState] = useState<BodyMeasures>(pat?.body ?? bodyForSize(DEFAULT_SIZE));
  const auto = useMemo(() => defaultBlock(kind, body, fit, size), [kind, body, fit, size]);
  const [length, setLength] = useState<number | null>(pat?.block?.length ?? null);
  const [sleeve, setSleeve] = useState<number | null>(pat?.block?.sleeve ?? null);
  const [showBody, setShowBody] = useState(false);
  const [spec, setSpec] = useState<Partial<Record<string, number>>>(pat?.block?.spec ?? {});
  const [showSpec, setShowSpec] = useState(!!pat?.block?.spec && Object.keys(pat.block.spec).length > 0);
  const [sizeSpecs, setSizeSpecs] = useState<PatternBlock['sizeSpecs']>(pat?.block?.sizeSpecs);
  const [chartOpen, setChartOpen] = useState(false);
  const problems = checkBody(body);
  const hasSpec = Object.values(spec).some((v) => v != null);
  const blk: PatternBlock = {
    kind,
    fit,
    size,
    length: length ?? auto.length,
    sleeve: sleeve ?? auto.sleeve,
    ...(hasSpec ? { spec } : {}),
    ...(hasSpec && sizeSpecs && Object.keys(sizeSpecs).length ? { sizeSpecs } : {}),
  };
  // Werte, die der Schnitt ohne bzw. mit den eingetragenen Fertigmaßen ergibt (als Vorgabe im Feld)
  const current = useMemo(() => blockPoms(generateBlock(body, blk)), [body, JSON.stringify(blk)]); // eslint-disable-line react-hooks/exhaustive-deps
  const deviations = useMemo(() => specDeviations(body, blk), [body, JSON.stringify(blk)]); // eslint-disable-line react-hooks/exhaustive-deps
  const poms = useMemo(() => pomsFor(kind), [kind]);

  const pickSize = (id: string) => {
    setSize(id);
    if (id !== 'custom') setBodyState(bodyForSize(id));
  };
  const run = () => {
    if (problems.length) {
      ed.toast(problems[0], 'error');
      return;
    }
    const out = generatePattern(ed, body, size, blk);
    if (!out.ok) ed.toast(out.message ?? 'Grundschnitt konnte nicht erzeugt werden', 'error');
    else {
      ed.zoomToFit();
      ed.toast(existing ? 'Grundschnitt aktualisiert' : 'Grundschnitt erzeugt – Nähte sind schon verbunden', 'success');
    }
  };

  return (
    <section className="props-section">
      {chartOpen && (
        <SizeChartDialog
          kind={kind}
          size={size}
          initial={{ ...(sizeSpecs ?? {}), ...(hasSpec ? { [size]: spec } : {}) }}
          onClose={() => setChartOpen(false)}
          onApply={(base, all) => {
            const b = bodyForSize(base);
            const next: PatternBlock = {
              kind,
              fit,
              size: base,
              length: defaultBlock(kind, b, fit, base).length,
              sleeve: defaultBlock(kind, b, fit, base).sleeve,
              spec: all[base] ?? {},
              sizeSpecs: all,
            };
            setSize(base);
            setBodyState(b);
            setSpec(all[base] ?? {});
            setSizeSpecs(all);
            setLength(null);
            setSleeve(null);
            setShowSpec(true);
            setChartOpen(false);
            const out = generatePattern(ed, b, base, next);
            if (!out.ok) ed.toast('Schnitt konnte nicht erzeugt werden', 'error');
            else {
              ed.zoomToFit();
              ed.toast(`Schnitt aus der Größentabelle erzeugt (${Object.keys(all).length} Größen)`, 'success');
            }
          }}
        />
      )}
      <h3>Grundschnitt aus Maßen</h3>
      <div className="form-grid">
        <span>Kleidungsstück</span>
        <select value={kind} aria-label="Kleidungsstück" data-testid="block-kind" onChange={(e) => setKind(e.target.value as PatternBlock['kind'])}>
          {BLOCK_KINDS.map((k) => (
            <option key={k.id} value={k.id} title={k.hint}>
              {k.name}
            </option>
          ))}
        </select>
        <span>Größe</span>
        <select value={size} aria-label="Größe" data-testid="block-size" onChange={(e) => pickSize(e.target.value)}>
          {(['Herren / Unisex', 'Damen'] as const).map((grp) => (
            <optgroup key={grp} label={grp}>
              {SIZE_TABLE.filter((r) => r.group === grp).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </optgroup>
          ))}
          <option value="custom">Eigene Maße</option>
        </select>
        <span>Passform</span>
        <select value={fit} aria-label="Passform" data-testid="block-fit" onChange={(e) => setFit(e.target.value as PatternBlock['fit'])}>
          {Object.entries(FIT_NAMES).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <span>Länge</span>
        <span className="row">
          <Field
            value={mm(spec.len ?? blk.length)}
            numeric
            width={64}
            label="Gesamtlänge ab Halsansatz in mm"
            testId="block-length"
            onCommit={(v) => (spec.len != null ? setSpec((o) => ({ ...o, len: num(v) ?? o.len })) : setLength(num(v)))}
          />
          <span className="muted">mm</span>
          {spec.len != null && <span className="muted small">Fertigmaß A</span>}
          {length !== null && spec.len == null && (
            <button className="link-btn small" onClick={() => setLength(null)}>
              Standard
            </button>
          )}
        </span>
        <span>{kind === 'tshirt' ? 'Ärmel (kurz)' : 'Ärmel'}</span>
        <span className="row">
          <Field
            value={mm(spec.sleeve ?? blk.sleeve)}
            numeric
            width={64}
            label="Ärmellänge ab Schulterpunkt in mm"
            testId="block-sleeve"
            onCommit={(v) => (spec.sleeve != null ? setSpec((o) => ({ ...o, sleeve: num(v) ?? o.sleeve })) : setSleeve(num(v)))}
          />
          <span className="muted">mm</span>
          {spec.sleeve != null && <span className="muted small">Fertigmaß G</span>}
          {sleeve !== null && spec.sleeve == null && (
            <button className="link-btn small" onClick={() => setSleeve(null)}>
              Standard
            </button>
          )}
        </span>
      </div>
      <button className="disclosure" onClick={() => setShowBody((s) => !s)} aria-expanded={showBody} data-testid="block-body-toggle">
        {showBody ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Körpermaße {size === 'custom' ? '(eigene)' : ''}
      </button>
      {showBody && (
        <div className="form-grid" data-testid="block-body">
          {BODY_FIELDS.map((f) => (
            <FieldRow
              key={f.key}
              label={f.label}
              hint={f.hint}
              value={body[f.key]}
              testId={`body-${f.key}`}
              onChange={(v) => {
                setBodyState({ ...body, [f.key]: v });
                setSize('custom');
              }}
            />
          ))}
        </div>
      )}
      <button className="disclosure" onClick={() => setShowSpec((s) => !s)} aria-expanded={showSpec} data-testid="block-spec-toggle">
        {showSpec ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Maße eines vorhandenen Teils {hasSpec ? `(${Object.values(spec).filter((v) => v != null).length} gesetzt)` : ''}
      </button>
      {showSpec && (
        <div data-testid="block-spec">
          <p className="muted small">
            Fertigmaße aus der Größentabelle oder flach liegend nachgemessen (cm). Eingetragene Werte bestimmen den Schnitt genau, leere Felder kommen aus Körpermaßen und Passform – der Vorschlag
            steht grau im Feld.
          </p>
          <div className="form-grid">
            {poms.map((pom) => (
              <SpecRow
                key={pom.id}
                code={pom.code}
                label={pom.label}
                hint={pom.how}
                value={spec[pom.id]}
                suggestion={current[pom.id] ?? null}
                testId={`spec-${pom.id}`}
                onChange={(v) => setSpec((old) => ({ ...old, [pom.id]: v ?? undefined }))}
              />
            ))}
          </div>
          <div className="row">
            <button className="btn" onClick={() => setChartOpen(true)} data-testid="spec-chart" title="Größentabelle eines Shops einfügen oder je Größe eintragen">
              <Table2 size={15} /> Größentabelle übernehmen …
            </button>
            {hasSpec && (
              <button
                className="link-btn small"
                onClick={() => {
                  setSpec({});
                  setSizeSpecs(undefined);
                }}
                data-testid="spec-clear"
              >
                Alle Fertigmaße löschen
              </button>
            )}
          </div>
          {sizeSpecs && Object.keys(sizeSpecs).length > 1 && hasSpec && (
            <p className="muted small" data-testid="spec-sizes">
              Größentabelle: {Object.keys(sizeSpecs).map(shortSize).join(', ')} – jede Größe trifft ihre Werte genau.
            </p>
          )}
          {deviations.length > 0 && (
            <ul className="warn-list" data-testid="spec-deviations">
              {deviations.map((d) => (
                <li key={d.pom.id}>
                  <TriangleAlert size={14} /> {d.pom.code} {d.pom.label}: {mm(d.want / 10)} cm gewünscht, Schnitt ergibt {mm(d.got / 10)} cm (passt geometrisch nicht zu den übrigen Maßen)
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {problems.length > 0 && (
        <ul className="warn-list">
          {problems.map((p) => (
            <li key={p}>
              <TriangleAlert size={14} /> {p}
            </li>
          ))}
        </ul>
      )}
      <div className="stack">
        <button className="btn accent wide" onClick={run} data-testid="block-generate">
          <Wand2 size={16} /> {existing ? 'Grundschnitt aktualisieren' : 'Grundschnitt erzeugen'}
        </button>
        {pat && (
          <button
            className="btn wide"
            onClick={() => {
              if (!checkBody(body).length && setBody(ed, body, size).ok) ed.toast('Körpermaße für die 3D-Figur übernommen', 'success');
            }}
            title="Nur die Körpermaße speichern (für die 3D-Figur), Teile nicht verändern"
          >
            <Ruler size={16} /> Nur Körpermaße übernehmen
          </button>
        )}
      </div>
      <p className="muted small">
        Erzeugt Vorder- und Rückenteil, Ärmel
        {kind === 'polo' ? ' mit Bündchen, Knopfleisten, Kragensteg und Kragen' : kind === 'sweatshirt' || kind === 'hoodie' ? ', Bündchen' : ', Halsbündchen'}
        {kind === 'hoodie' ? ' und Kapuze' : ''} mit fertig verbundenen Nähten. Beim Aktualisieren werden nur diese Teile ersetzt – eigene Teile bleiben.
      </p>
    </section>
  );
}

/**
 * Größentabelle eines vorhandenen Produkts: aus dem Shop kopierten Text einfügen (cm oder inch, deutsch oder
 * englisch) oder je Größe eintragen. Jede Größe trifft danach ihre Werte genau.
 */
function SizeChartDialog(p: {
  kind: PatternBlock['kind'];
  size: string;
  initial: Record<string, Partial<Record<string, number>>>;
  onClose: () => void;
  onApply: (base: string, all: Record<string, Partial<Record<string, number>>>) => void;
}) {
  const group: 'H' | 'D' = p.size.startsWith('D-') ? 'D' : 'H';
  const [grp, setGrp] = useState<'H' | 'D'>(group);
  const sizes = SIZE_TABLE.filter((r) => r.id.startsWith(`${grp}-`));
  const poms = pomsFor(p.kind);
  const [vals, setVals] = useState<Record<string, Partial<Record<string, number>>>>(p.initial);
  const [base, setBase] = useState(p.size !== 'custom' && p.size.startsWith(`${grp}-`) ? p.size : `${grp}-M`);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const read = () => {
    const c = parseSizeChart(text);
    if (!c) {
      setNote('Keine Tabelle erkannt. Erwartet: eine Zeile mit Größen (z. B. „XS S M L XL“) und darunter je Messpunkt eine Zeile mit Werten.');
      return;
    }
    const specs = chartToSpecs(
      c,
      grp,
      sizes.map((r) => r.id),
    );
    setVals(specs);
    const names = c.rows.map((r) => POMS.find((x) => x.id === r.pom)?.label ?? r.pom);
    const missing = c.sizes.filter((s) => !sizes.some((r) => r.id === `${grp}-${s}`));
    setNote(
      `Erkannt: ${names.join(', ')} · ${Object.keys(specs).length} Größen · Einheit ${c.unit}` +
        (c.unknown.length ? ` · nicht zugeordnet: ${c.unknown.join(', ')}` : '') +
        (missing.length ? ` · Größe(n) ${missing.join(', ')} gibt es in der Maßtabelle nicht` : ''),
    );
    if (!specs[base]) setBase(Object.keys(specs)[Math.floor(Object.keys(specs).length / 2)] ?? base);
  };
  const filled = Object.values(vals).some((v) => Object.values(v).some((x) => x != null));
  const rows = poms;
  return (
    <Modal title="Größentabelle übernehmen" onClose={p.onClose} wide testId="sizechart">
      <p className="muted small">
        Größentabelle aus dem Shop kopieren und hier einfügen – oder die Werte je Größe eintragen (cm, flach gemessen: „Chest width“ = ½ Brustweite). Jede Größe bekommt ihre Werte genau, leere Felder
        kommen aus Körpermaßen und Passform.
      </p>
      <div className="row" style={{ alignItems: 'stretch', gap: 8 }}>
        <textarea
          rows={4}
          style={{ flex: 1 }}
          value={text}
          placeholder={'z. B.\nCM  XS  S  M  L  XL  XXL\nTotal length  65  67  69  71  73  75\nChest width  56  58  60  62  64  66'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Größentabelle einfügen"
          data-testid="sizechart-text"
        />
        <div className="stack">
          <button className="btn accent" onClick={read} disabled={!text.trim()} data-testid="sizechart-read">
            <ClipboardPaste size={15} /> Einlesen
          </button>
          <select value={grp} onChange={(e) => setGrp(e.target.value as 'H' | 'D')} aria-label="Größengruppe" data-testid="sizechart-group">
            <option value="H">Herren / Unisex</option>
            <option value="D">Damen</option>
          </select>
        </div>
      </div>
      {note && (
        <p className="small" data-testid="sizechart-note">
          {note}
        </p>
      )}
      <div style={{ maxHeight: '48vh', overflow: 'auto' }}>
        <table className="tp-table" data-testid="sizechart-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Messpunkt (cm)</th>
              {sizes.map((r) => (
                <th key={r.id} className={`num ${r.id === base ? 'base' : ''}`}>
                  <label title="Basisgröße: auf diese Größe wird der Schnitt gelegt">
                    <input type="radio" name="sc-base" checked={r.id === base} onChange={() => setBase(r.id)} /> {shortSize(r.id)}
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((pom) => (
              <tr key={pom.id} title={pom.how}>
                <td>
                  <b>{pom.code}</b>
                </td>
                <td>{pom.label}</td>
                {sizes.map((r) => {
                  const v = vals[r.id]?.[pom.id];
                  return (
                    <td key={r.id} className={`num ${r.id === base ? 'base' : ''}`}>
                      <Field
                        value={v != null ? mm(v / 10) : ''}
                        numeric
                        width={52}
                        label={`${pom.label} ${shortSize(r.id)} in cm`}
                        testId={`sc-${r.id}-${pom.id}`}
                        onCommit={(t) => {
                          const n = num(t);
                          setVals((o) => {
                            const next = { ...o, [r.id]: { ...(o[r.id] ?? {}) } };
                            if (!t.trim() || n === null || n <= 0) delete next[r.id][pom.id];
                            else next[r.id][pom.id] = Math.round(n * 10);
                            return next;
                          });
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <span className="muted small spacer">Basisgröße: {shortSize(base)} (Spalte markiert)</span>
        <button className="btn" onClick={p.onClose}>
          Abbrechen
        </button>
        <button
          className="btn accent"
          disabled={!filled}
          onClick={() => {
            const all: Record<string, Partial<Record<string, number>>> = {};
            for (const [k, v] of Object.entries(vals)) if (k.startsWith(`${grp}-`) && Object.keys(v).length) all[k] = v;
            p.onApply(base, all);
          }}
          data-testid="sizechart-apply"
        >
          <Wand2 size={15} /> Übernehmen und Schnitt erzeugen
        </button>
      </div>
    </Modal>
  );
}

/** Fertigmaß in cm; leer = automatisch (Vorschlag als Platzhalter). */
function SpecRow(p: { code: string; label: string; hint: string; value: number | undefined; suggestion: number | null; onChange: (v: number | null) => void; testId: string }) {
  return (
    <>
      <span title={p.hint}>
        <span className="muted">{p.code}</span> {p.label}
      </span>
      <span className="row">
        <Field
          value={p.value != null ? mm(p.value / 10) : ''}
          placeholder={p.suggestion != null ? mm(p.suggestion / 10) : ''}
          numeric
          width={64}
          label={`${p.label} in cm (leer = automatisch)`}
          testId={p.testId}
          onCommit={(v) => {
            if (!v.trim()) return p.onChange(null);
            const n = num(v);
            if (n !== null && n > 0) p.onChange(Math.round(n * 10));
          }}
        />
        <span className="muted">cm</span>
      </span>
    </>
  );
}

function FieldRow({ label, hint, value, onChange, testId }: { label: string; hint: string; value: number; onChange: (v: number) => void; testId: string }) {
  return (
    <>
      <span title={hint}>{label}</span>
      <span className="row">
        <Field
          value={mm(value / 10)}
          numeric
          width={64}
          label={`${label} in cm`}
          testId={testId}
          onCommit={(v) => {
            const n = num(v);
            if (n !== null) onChange(Math.round(n * 10));
          }}
        />
        <span className="muted">cm</span>
      </span>
    </>
  );
}

function PieceCard({ id }: { id: string }) {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const ed = app.editor;
  const p = pieceById(doc, id);
  const pat = doc.pattern;
  if (!p || !pat) return null;
  const upd = (patch: Parameters<typeof updatePiece>[2]) => {
    const out = updatePiece(ed, p.id, patch);
    if (!out.ok && out.message) ed.toast(out.message, 'error');
  };
  return (
    <div className="motif-card" data-testid="piece-card">
      <div className="form-grid">
        <span>Name</span>
        <Field value={p.name} label="Name des Schnittteils" testId="piece-name" onCommit={(v) => upd({ name: v.trim() || p.name })} />
        <span>Rolle in 3D</span>
        <select value={p.role} aria-label="Rolle" data-testid="piece-role" onChange={(e) => upd({ role: e.target.value as PieceRole })}>
          {Object.entries(ROLE_NAMES).map(([rid, name]) => (
            <option key={rid} value={rid}>
              {name}
            </option>
          ))}
        </select>
        <span>Zuschnitt</span>
        <select value={p.cut} aria-label="Zuschnitt" data-testid="piece-cut" onChange={(e) => upd({ cut: Number(e.target.value) === 2 ? 2 : 1 })}>
          <option value={1}>1× (einzeln)</option>
          <option value={2}>2× gegengleich</option>
        </select>
        <span>Nahtzugabe</span>
        <span className="row">
          <Field
            value={mm(p.seamAllowance)}
            numeric
            width={56}
            label="Nahtzugabe in mm"
            testId="piece-sa"
            onCommit={(v) => {
              const n = num(v);
              if (n !== null && n >= 0 && n <= 60) upd({ seamAllowance: n });
              else ed.toast('Nahtzugabe: 0 bis 60 mm', 'error');
            }}
          />
          <span className="muted">mm</span>
        </span>
        <span>Fadenlauf</span>
        <span className="row">
          <Field
            value={mm(p.grain)}
            numeric
            width={56}
            label="Fadenlauf in Grad zur Senkrechten"
            onCommit={(v) => {
              const n = num(v);
              if (n !== null) upd({ grain: ((n % 360) + 360) % 360 });
            }}
          />
          <span className="muted">°</span>
        </span>
        <span>Farbe</span>
        <span className="row">
          <ColorButton
            value={p.color ?? pat.materials.find((m) => m.id === p.material)?.color ?? '#888888'}
            label={`Farbe ${p.name}`}
            onChange={(c) => setPieceLook(ed, p.id, { color: c })}
            testId="piece-color"
          />
          {p.color ? (
            <button className="link-btn small" onClick={() => setPieceLook(ed, p.id, { color: null })}>
              wie Stoff
            </button>
          ) : (
            <span className="muted small">vom Stoff</span>
          )}
        </span>
        <span>Stoff</span>
        <select value={p.material ?? ''} aria-label="Stoff" data-testid="piece-material" onChange={(e) => upd({ material: e.target.value })}>
          {pat.materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="row end">
        <button
          className="btn"
          onClick={() => {
            if (removePiece(ed, p.id).ok) ed.toast('Schnittteil aufgelöst – die Kontur bleibt als normale Form erhalten', 'info');
          }}
          title="Nur die Schnitt-Angaben entfernen, Kontur behalten"
        >
          <Trash2 size={15} /> Kein Schnittteil mehr
        </button>
      </div>
    </div>
  );
}

function SeamSection() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const tool = useAppState((s) => s.tool);
  const ed = app.editor;
  const checks = useMemo(() => checkSeams(doc), [doc]);
  const [all, setAll] = useState(false);
  const pat = doc.pattern;
  if (!pat?.pieces.length) return null;
  const bad = checks.filter((c) => !c.ok);
  const shown = all ? checks : bad;
  return (
    <section className="props-section">
      <div className="row">
        <h3 className="spacer">Nähte</h3>
        <button
          className={`btn ${tool === 'seam' ? 'on' : ''}`}
          onClick={() => app.setTool(tool === 'seam' ? 'select' : 'seam')}
          data-testid="seam-tool"
          title="Zwei Kanten nacheinander anklicken (Taste N)"
        >
          <Spline size={15} /> Verbinden
        </button>
      </div>
      <p className={`small ${bad.length ? 'bad-text' : 'ok-text'}`} data-testid="seam-summary">
        {checks.length === 0 ? (
          'Noch keine Nähte. „Verbinden“ wählen und zwei Kanten anklicken.'
        ) : bad.length ? (
          <>
            <TriangleAlert size={14} /> {bad.length} von {checks.length} Nähten passen nicht
          </>
        ) : (
          <>
            <CheckCircle2 size={14} /> Alle {checks.length} Nähte passen
          </>
        )}
      </p>
      {checks.length > 0 && (
        <button className="disclosure" onClick={() => setAll((a) => !a)} aria-expanded={all} data-testid="seam-show-all">
          {all ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {all ? 'Alle Nähte' : bad.length ? 'Nur Probleme' : 'Alle Nähte anzeigen'}
        </button>
      )}
      {shown.length > 0 && (
        <ul className="seam-list" data-testid="seam-list">
          {shown.map((c) => (
            <li key={c.seam.id} className={c.ok ? '' : 'bad'}>
              <span className={`dot ${c.ok ? (c.ribbed && Math.abs(c.diff) > 2 ? 'rib' : 'ok') : 'bad'}`} />
              <span className="spacer">
                <strong>{c.seam.name ?? 'Naht'}</strong>
                <br />
                <span className="muted small">{c.message}</span>
              </span>
              <button
                className={`icon-btn ${c.seam.reversed ? '' : 'on'}`}
                title="Nahtrichtung umkehren (falls die Naht in 3D verdreht ist)"
                aria-label="Nahtrichtung umkehren"
                onClick={() => updateSeam(ed, c.seam.id, { reversed: !c.seam.reversed })}
              >
                <ArrowLeftRight size={15} />
              </button>
              <button className="icon-btn" title="Naht entfernen" aria-label="Naht entfernen" onClick={() => removeSeam(ed, c.seam.id)}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Zwei Kanten derselben Naht sollten gleich lang sein. Bündchen dürfen kürzer sein, sie werden beim Annähen gedehnt.</p>
    </section>
  );
}

function MaterialSection() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const ed = app.editor;
  const pat = doc.pattern;
  if (!pat?.pieces.length) return null;
  const upd = (id: string, patch: Partial<Omit<PatternMaterial, 'id'>>) => updateMaterial(ed, id, patch);
  return (
    <section className="props-section">
      <div className="row">
        <h3 className="spacer">Stoffe</h3>
        <button className="btn" onClick={() => addMaterial(ed)} data-testid="material-add">
          <Plus size={15} /> Stoff
        </button>
      </div>
      {pat.materials.map((m) => (
        <div key={m.id} className="material-row" data-testid={`material-${m.name}`}>
          <ColorButton value={m.color} label={`Farbe ${m.name}`} onChange={(c) => upd(m.id, { color: c })} />
          <Field value={m.name} label="Stoffname" onCommit={(v) => upd(m.id, { name: v.trim() || m.name })} />
          <select
            value={m.fabric}
            aria-label="Stoffart"
            onChange={(e) => {
              const f = FABRICS.find((x) => x.id === e.target.value)!;
              upd(m.id, { fabric: f.id, gsm: f.gsm });
            }}
          >
            {FABRICS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <span className="row gsm-field" title="Flächengewicht: bestimmt in 3D, wie schwer der Stoff fällt">
            <Field
              value={String(m.gsm)}
              numeric
              width={46}
              label={`Flächengewicht ${m.name} in g/m²`}
              onCommit={(v) => {
                const n = Math.round(Number(v.replace(',', '.')));
                if (Number.isFinite(n) && n >= 30 && n <= 1000) upd(m.id, { gsm: n });
                else ed.toast('Flächengewicht: 30 bis 1000 g/m²', 'error');
              }}
            />
            <span className="muted small">g/m²</span>
          </span>
        </div>
      ))}
      <p className="muted small">
        <Scissors size={13} /> Stoffart, Gewicht und Farbe nutzt die 3D-Ansicht: leichter Stoff fällt weich und liegt an, schwerer steht steifer ab und trägt dicker auf. Je Schnittteil wählbar.
      </p>
    </section>
  );
}
