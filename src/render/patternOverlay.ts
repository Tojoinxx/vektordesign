import type { SketchDoc, Vec2 } from '../model/types';
import { isHidden } from '../model/layers';
import { checkSeams, grainLine, pieceGeom, seamAllowanceOutline, type PieceGeom } from '../pattern/geometry';
import { THEME } from './theme';
import { hasStripes, stripeBands } from '../pattern/stripes';
import { toScreen, type Viewport } from './viewport';

/**
 * Bildschirm-Anzeige der Schnittteile (wird nie exportiert): Nahtzugabe gestrichelt, Fadenlauf-Pfeil,
 * Beschriftung, Nähte farbig mit Nummer (grün = passt, violett = Bündchen gedehnt, rot = Längen passen nicht).
 */
/** Geometrie, Nahtzugaben und Nahtprüfung je Zeichnung zwischenspeichern (Zoomen/Verschieben ändern sie nicht). */
const memo = new WeakMap<SketchDoc, { geoms: Map<string, PieceGeom>; allowances: Map<string, Vec2[][]>; checks: ReturnType<typeof checkSeams> }>();
function patternData(doc: SketchDoc) {
  let m = memo.get(doc);
  if (!m) {
    const geoms = new Map<string, PieceGeom>();
    const allowances = new Map<string, Vec2[][]>();
    for (const p of doc.pattern?.pieces ?? []) {
      if (isHidden(doc, p.outline)) continue;
      const g = pieceGeom(doc, p);
      if (g) {
        geoms.set(p.id, g);
        allowances.set(p.id, seamAllowanceOutline(g));
      }
    }
    m = { geoms, allowances, checks: geoms.size ? checkSeams(doc) : [] };
    memo.set(doc, m);
  }
  return m;
}

export function drawPatternOverlay(ctx: CanvasRenderingContext2D, vp: Viewport, doc: SketchDoc): void {
  const pat = doc.pattern;
  if (!pat?.pieces.length) return;
  const T = (p: Vec2) => toScreen(vp, p);
  const { geoms, allowances, checks } = patternData(doc);
  if (!geoms.size) return;
  ctx.save();
  const poly = (pts: Vec2[], closed: boolean) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = T(p);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    if (closed) ctx.closePath();
  };

  // Streifenstoff: Streifen im Teil zeigen (Lage beim Zuschnitt)
  for (const g of geoms.values()) {
    const pc = g.piece;
    const m = pat.materials.find((x) => x.id === pc.material);
    if (pc.color || !hasStripes(m)) continue;
    const top = g.box.maxY;
    const shift = pc.stripeShift ?? 0;
    const bands = stripeBands(m.stripes, shift, top - g.box.minY + shift);
    if (!bands.length) continue;
    ctx.save();
    poly(g.polygon, true);
    ctx.clip();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = m.stripes.stripe;
    const x0 = T({ x: g.box.minX, y: 0 }).x;
    const x1 = T({ x: g.box.maxX, y: 0 }).x;
    for (const [d0, d1] of bands) {
      const y0 = T({ x: 0, y: top - (d0 - shift) }).y;
      const y1 = T({ x: 0, y: top - (d1 - shift) }).y;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.restore();
  }

  // Nahtzugabe und Fadenlauf
  for (const [pid, g] of geoms) {
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = THEME.pattern;
    ctx.lineWidth = 1;
    for (const sa of allowances.get(pid) ?? []) {
      poly(sa, true);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const [a, b] = grainLine(g);
    const sa = T(a);
    const sb = T(b);
    const len = Math.hypot(sb.x - sa.x, sb.y - sa.y);
    if (len > 24) {
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      const dx = (sb.x - sa.x) / len;
      const dy = (sb.y - sa.y) / len;
      for (const [tip, sgn] of [
        [sb, 1],
        [sa, -1],
      ] as [Vec2, number][]) {
        ctx.moveTo(tip.x - sgn * dx * 9 + dy * 4, tip.y - sgn * dy * 9 - dx * 4);
        ctx.lineTo(tip.x, tip.y);
        ctx.lineTo(tip.x - sgn * dx * 9 - dy * 4, tip.y - sgn * dy * 9 + dx * 4);
      }
      ctx.strokeStyle = THEME.pattern;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  // Nähte
  const tags = new Map<string, { at: Vec2; dir: Vec2; labels: string[]; color: string }>();
  checks.forEach((c, i) => {
    const color = !c.ok ? THEME.conflict : c.ribbed && Math.abs(c.diff) > 2 ? THEME.seamRib : THEME.seamOk;
    for (const ref of [c.seam.a, c.seam.b]) {
      const g = geoms.get(ref.piece);
      const e = g?.edges[ref.edge];
      if (!g || !e) continue;
      poly(e.pts, false);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // Nummern nur, wenn die Kante auf dem Bildschirm lang genug ist
      const a0 = T(e.pts[0]);
      const a1 = T(e.pts[e.pts.length - 1]);
      if (Math.hypot(a1.x - a0.x, a1.y - a0.y) < 46) continue;
      const key = `${ref.piece}:${ref.edge}`;
      const t = tags.get(key);
      const label = `${i + 1}${ref.copy ? '′' : ''}`;
      if (t) {
        t.labels.push(label);
        if (color === THEME.conflict) t.color = color;
      } else {
        const mid = e.pts[Math.floor(e.pts.length / 2)];
        const m0 = e.pts[Math.max(0, Math.floor(e.pts.length / 2) - 1)];
        const m1 = e.pts[Math.min(e.pts.length - 1, Math.floor(e.pts.length / 2) + 1)];
        // Etikett leicht nach innen versetzt (Innenseite: links der Laufrichtung bei CCW)
        const dx = m1.x - m0.x;
        const dy = m1.y - m0.y;
        const l = Math.hypot(dx, dy) || 1;
        const inward = g.ccw ? { x: -dy / l, y: dx / l } : { x: dy / l, y: -dx / l };
        tags.set(key, { at: mid, dir: inward, labels: [label], color });
      }
    }
  });
  ctx.font = `600 10.5px ${THEME.uiFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of tags.values()) {
    const s = T(t.at);
    const text = t.labels.join('·');
    const w = ctx.measureText(text).width + 8;
    const x = s.x + t.dir.x * 11;
    const y = s.y - t.dir.y * 11;
    ctx.fillStyle = t.color;
    roundRect(ctx, x - w / 2, y - 8, w, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, y + 0.5);
  }

  // Beschriftung
  for (const g of geoms.values()) {
    const w = (g.box.maxX - g.box.minX) * vp.zoom;
    if (w < 50) continue;
    const c = T(g.center);
    const name = g.piece.name;
    const sub = g.piece.cut === 2 ? '2× gegengleich' : '1×';
    ctx.font = `600 12.5px ${THEME.uiFont}`;
    const w1 = ctx.measureText(name).width;
    ctx.font = `500 11px ${THEME.uiFont}`;
    const w2 = ctx.measureText(sub).width;
    const bw = Math.max(w1, w2) + 12;
    // rechts neben dem Fadenlauf-Pfeil
    const x = c.x + bw / 2 + 8;
    const y = c.y - 8;
    ctx.fillStyle = THEME.labelBg;
    ctx.globalAlpha = 0.86;
    roundRect(ctx, x - bw / 2, y - 10, bw, 34, 6);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = THEME.ink;
    ctx.font = `600 12.5px ${THEME.uiFont}`;
    ctx.fillText(name, x, y + 1);
    ctx.fillStyle = THEME.pattern;
    ctx.font = `500 11px ${THEME.uiFont}`;
    ctx.fillText(sub, x, y + 16);
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
