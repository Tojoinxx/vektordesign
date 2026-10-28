import { useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { applyVariant, motifDoc, productionOf } from '../model/production';
import { separate, type Separation } from '../model/separation';
import { breakEven, DEFAULT_PRICES, estimateCosts, loadPrices, PRICE_LABELS, savePrices, type Prices } from '../model/costs';
import { textOutlines } from '../export/scene';
import { Modal } from './Chrome';
import { useApp, useAppState, useUi } from './hooks';

/** Kostenschätzung: alle Verfahren nebeneinander für eine Stückzahl, Preise einstellbar. */
export function CostView() {
  const open = useUi((s) => s.costs);
  if (!open) return null;
  return <CostInner />;
}

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

function CostInner() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const p = useMemo(() => productionOf(doc), [doc]);
  const [motifId, setMotifId] = useState(p.motifs[0]?.id ?? '');
  const [variantId, setVariantId] = useState(p.variants[0]?.id ?? '');
  const [qty, setQty] = useState('50');
  const [prices, setPrices] = useState<Prices>(loadPrices);
  const [showPrices, setShowPrices] = useState(false);
  const [sep, setSep] = useState<Separation | null>(null);
  const motif = p.motifs.find((m) => m.id === motifId) ?? p.motifs[0];
  const variant = p.variants.find((v) => v.id === variantId) ?? p.variants[0];
  const close = () => app.ui.setState({ costs: false });

  useEffect(() => {
    if (!motif || !variant) return;
    let alive = true;
    const md = applyVariant(motifDoc(doc, motif), variant);
    void textOutlines(md).then(({ outlines }) => {
      if (alive) setSep(separate(md, { outlines, fabric: variant.fabric, dropFabricColor: true, underbase: 'auto', choke: 0.3, trap: 0 }));
    });
    return () => {
      alive = false;
    };
  }, [doc, motif, variant]);

  const n = Math.max(1, Math.round(Number(qty.replace(',', '.')) || 1));
  const rows = sep ? estimateCosts(sep, n, prices) : [];
  const cheapest = rows.length ? rows.reduce((a, b) => (b.total < a.total ? b : a)) : null;
  const be = rows.length ? breakEven(rows) : null;
  const setPrice = (k: keyof Prices, v: string) => {
    const x = Number(v.replace(',', '.'));
    if (!Number.isFinite(x) || x < 0) return;
    const next = { ...prices, [k]: x };
    setPrices(next);
    savePrices(next);
  };
  const groups = [...new Set(Object.values(PRICE_LABELS).map((l) => l.group))];

  return (
    <Modal title="Kostenschätzung" onClose={close} testId="costs" wide>
      <div className="stack">
        <div className="row wrap">
          {p.motifs.length > 1 && (
            <select value={motif?.id} onChange={(e) => setMotifId(e.target.value)} aria-label="Motiv">
              {p.motifs.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          {p.variants.length > 1 && (
            <select value={variant?.id} onChange={(e) => setVariantId(e.target.value)} aria-label="Farbvariante">
              {p.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
          <label className="field inline">
            <span>Stückzahl</span>
            <input type="text" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 70 }} data-testid="costs-qty" />
          </label>
          {sep?.box && (
            <span className="muted small">
              Motiv {(sep.box.maxX - sep.box.minX).toFixed(0)} × {(sep.box.maxY - sep.box.minY).toFixed(0)} mm · {sep.plates.filter((x) => x.kind === 'color').length} Druckfarben
              {sep.underbase ? ' + Unterlage' : ''}
            </span>
          )}
        </div>
        <table className="cost-table" data-testid="costs-table">
          <thead>
            <tr>
              <th>Verfahren</th>
              <th>einmalig</th>
              <th>je Stück</th>
              <th>gesamt ({n} Stück)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cheapest?.id === r.id ? 'best' : ''}>
                <td>
                  <strong>{r.name}</strong>
                  {r.details.map((d) => (
                    <div key={d} className="muted small">
                      {d}
                    </div>
                  ))}
                </td>
                <td>{r.oneTime ? eur(r.oneTime) : '–'}</td>
                <td>{eur(r.perPiece + r.oneTime / n)}</td>
                <td>
                  <strong>{eur(r.total)}</strong>
                  {cheapest?.id === r.id && <div className="small">günstigste</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          {be ? `Siebdruck wird ab etwa ${be} Stück günstiger als DTF. ` : 'Siebdruck ist bei diesem Motiv je Stück nicht günstiger als DTF. '}
          Die Schätzung ersetzt kein Angebot: Preise sind eigene Richtwerte (unten einstellbar), Textilien, Versand und Mehrwertsteuer sind nicht enthalten.
        </p>
        <button className="link" onClick={() => setShowPrices((v) => !v)} data-testid="costs-prices-toggle">
          {showPrices ? 'Preise ausblenden' : 'Preise anpassen'}
        </button>
        {showPrices && (
          <div className="price-grid">
            {groups.map((g) => (
              <fieldset key={g}>
                <legend>{g}</legend>
                {(Object.keys(PRICE_LABELS) as (keyof Prices)[])
                  .filter((k) => PRICE_LABELS[k].group === g)
                  .map((k) => (
                    <label key={k} className="field inline">
                      <span>{PRICE_LABELS[k].label}</span>
                      <input type="text" inputMode="decimal" defaultValue={String(prices[k]).replace('.', ',')} onBlur={(e) => setPrice(k, e.target.value)} style={{ width: 64 }} />
                      <span className="muted small">{PRICE_LABELS[k].unit}</span>
                    </label>
                  ))}
              </fieldset>
            ))}
            <button
              className="btn small"
              onClick={() => {
                setPrices({ ...DEFAULT_PRICES });
                savePrices({ ...DEFAULT_PRICES });
                setShowPrices(false);
              }}
            >
              <RotateCcw size={14} /> Richtwerte wiederherstellen
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
