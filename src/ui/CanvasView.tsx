import { useCallback, useEffect, useRef } from 'react';
import type { Vec2 } from '../model/types';
import { renderScene, type SceneLayout } from '../render/renderer';
import { toWorld, type Viewport } from '../render/viewport';
import { computeSnap } from '../tools/snap';
import type { ToolPointer } from '../tools/types';
import { clampZoom } from '../store/editor';
import { useApp, useAppState } from './hooks';
import { DimensionEditor, DynamicInput, TextEditor } from './Overlays';
import { MarkingMenu, markingDirectionCommand } from './MarkingMenu';

const DRAW_TOOLS = new Set(['line', 'rect', 'circle', 'point', 'text']);

export function CanvasView() {
  const app = useApp();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<SceneLayout | null>(null);
  const size = useRef({ w: 800, h: 600, dpr: 1 });
  const frame = useRef(0);
  const pan = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const touches = useRef(new Map<number, Vec2>());
  const pinch = useRef<{ d: number; mid: Vec2; zoom: number; cx: number; cy: number } | null>(null);
  const space = useRef(false);
  const right = useRef<{ x: number; y: number } | null>(null);
  const tool = useAppState((s) => s.tool);
  const textEdit = useRef<string | null>(null);

  const vp = useCallback((): Viewport => {
    const v = app.store.getState().view;
    return { ...v, width: size.current.w, height: size.current.h };
  }, [app]);

  const draw = useCallback(() => {
    frame.current = 0;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const { dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = app.store.getState();
    const ui = app.ui.getState();
    const skip = ui.textEdit?.id ? new Set([ui.textEdit.id]) : undefined;
    textEdit.current = ui.textEdit?.id ?? null;
    layoutRef.current = renderScene(
      ctx,
      {
        doc: s.doc,
        analysis: s.analysis,
        selection: new Set(s.selection),
        hover: s.hover,
        settings: s.settings,
        vp: vp(),
        skip,
        cursor: ui.cursorWorld,
      },
      (cx, v) => app.current.drawOverlay?.(cx, v),
    );
  }, [app, vp]);

  const requestRender = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  // Brücke für Werkzeuge und Controller
  useEffect(() => {
    app.canvas = { vp, layout: () => layoutRef.current, requestRender };
    const u1 = app.store.subscribe(requestRender);
    const u2 = app.ui.subscribe((s, p) => {
      if (s.cursorWorld !== p.cursorWorld || s.dynValues !== p.dynValues || s.textEdit !== p.textEdit) requestRender();
    });
    // Schriften geladen → neu zeichnen
    void document.fonts?.ready.then(requestRender);
    return () => {
      u1();
      u2();
    };
  }, [app, vp, requestRender]);

  // Größe
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      size.current = { w: Math.max(1, r.width), h: Math.max(1, r.height), dpr };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      app.editor.viewport = { width: r.width, height: r.height };
      if (first) {
        first = false;
        const doc = app.store.getState().doc;
        if (Object.keys(doc.entities).length) app.editor.zoomToFit();
        else app.editor.setView({ cx: 0, cy: 0, zoom: clampZoom(Math.min(r.width, r.height) / 160) });
      }
      draw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [app, draw]);

  const toPointer = useCallback(
    (e: { clientX: number; clientY: number; button: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; pointerType?: string }): ToolPointer => {
      const r = canvasRef.current!.getBoundingClientRect();
      const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
      const v = vp();
      const world = toWorld(v, screen);
      const s = app.store.getState();
      const snap = app.current.snaps ? computeSnap(s.doc, v, s.settings, screen, { off: e.altKey }) : { pos: world, kind: null, ref: null };
      return {
        screen,
        world,
        snap,
        button: e.button,
        shift: e.shiftKey,
        ctrl: e.ctrlKey || e.metaKey,
        alt: e.altKey,
        pointerType: e.pointerType ?? 'mouse',
      };
    },
    [app, vp],
  );

  // Mausrad: Zoom zur Mausposition (nicht passiv, damit die Seite nicht scrollt)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const s = { x: e.clientX - r.left, y: e.clientY - r.top };
      const v = vp();
      const before = toWorld(v, s);
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0018));
      const zoom = clampZoom(v.zoom * factor);
      // Punkt unter der Maus bleibt stehen
      const cx = before.x - (s.x - v.width / 2) / zoom;
      const cy = before.y + (s.y - v.height / 2) / zoom;
      app.editor.setView({ zoom, cx, cy });
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [app, vp]);

  // Leertaste = Verschieben
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        space.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        space.current = false;
        if (canvasRef.current) canvasRef.current.style.cursor = '';
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    // Kein mousedown-Standardverhalten: sonst holt sich die Fläche den Fokus zurück, nachdem
    // ein Werkzeug gerade ein Eingabefeld (Maß, Text) geöffnet und fokussiert hat.
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== wrapRef.current) document.activeElement.blur();
    wrapRef.current?.focus({ preventScroll: true });
    if (app.ui.getState().marking) app.ui.setState({ marking: null });
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        // Zwei Finger: Zoom/Verschieben, laufende Aktion abbrechen
        app.current.cancel?.();
        const [a, b] = [...touches.current.values()];
        const v = app.store.getState().view;
        pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom: v.zoom, cx: v.cx, cy: v.cy };
        return;
      }
    }
    c.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault();
      const v = app.store.getState().view;
      pan.current = { sx: e.clientX, sy: e.clientY, cx: v.cx, cy: v.cy };
      c.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 2) {
      right.current = { x: e.clientX, y: e.clientY };
      return;
    }
    app.current.pointerDown?.(toPointer(e));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const p = pinch.current;
        const r = canvasRef.current!.getBoundingClientRect();
        const m0 = { x: p.mid.x - r.left, y: p.mid.y - r.top };
        const m1 = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
        const { w, h } = size.current;
        // Weltpunkt unter der Anfangsmitte bleibt unter den Fingern
        const W = toWorld({ cx: p.cx, cy: p.cy, zoom: p.zoom, width: w, height: h }, m0);
        const zoom = clampZoom((p.zoom * d) / Math.max(p.d, 1));
        app.editor.setView({ zoom, cx: W.x - (m1.x - w / 2) / zoom, cy: W.y + (m1.y - h / 2) / zoom });
        return;
      }
    }
    if (pan.current) {
      const p = pan.current;
      const z = app.store.getState().view.zoom;
      app.editor.setView({ cx: p.cx - (e.clientX - p.sx) / z, cy: p.cy + (e.clientY - p.sy) / z });
      return;
    }
    if (right.current) return;
    const p = toPointer(e);
    app.ui.setState({ cursorWorld: p.snap.pos });
    app.current.pointerMove?.(p);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      if (pinch.current) {
        if (touches.current.size < 2) pinch.current = null;
        return;
      }
    }
    if (pan.current) {
      pan.current = null;
      canvasRef.current!.style.cursor = '';
      return;
    }
    if (e.button === 2 && right.current) {
      const start = right.current;
      right.current = null;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 40) {
        // Markierungsmenü-Geste: Richtung entscheidet
        markingDirectionCommand(app, dx, dy);
      } else {
        const r = wrapRef.current!.getBoundingClientRect();
        app.ui.setState({ marking: { x: start.x - r.left, y: start.y - r.top } });
      }
      return;
    }
    app.current.pointerUp?.(toPointer(e));
  };

  const onLeave = () => {
    if (!pan.current) {
      app.ui.setState({ cursorWorld: null });
      if (app.store.getState().hover) app.store.setState({ hover: null });
    }
  };

  const cursor = tool === 'select' ? 'default' : DRAW_TOOLS.has(tool) ? 'crosshair' : tool === 'gradient' ? 'crosshair' : 'pointer';

  return (
    <div className="canvas-wrap" ref={wrapRef} tabIndex={-1} data-testid="canvas-wrap">
      <canvas
        ref={canvasRef}
        className="sketch-canvas"
        data-testid="canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onLeave}
        onDoubleClick={(e) => app.current.doubleClick?.(toPointer(e))}
        onContextMenu={(e) => e.preventDefault()}
      />
      <DynamicInput />
      <DimensionEditor layout={() => layoutRef.current} vp={vp} />
      <TextEditor vp={vp} />
      <MarkingMenu />
    </div>
  );
}
