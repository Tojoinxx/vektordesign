import { useCallback, useEffect, useRef } from 'react';
import type { Vec2 } from '../model/types';
import { renderScene, type SceneLayout } from '../render/renderer';
import { toScreen, toWorld, type Viewport } from '../render/viewport';
import type { PreflightResult } from '../model/preflight';
import { computeSnap } from '../tools/snap';
import type { ToolPointer } from '../tools/types';
import { clampZoom } from '../store/editor';
import { useApp, useAppState } from './hooks';
import { DimensionEditor, DynamicInput, TextEditor } from './Overlays';
import { MarkingMenu, markingDirectionCommand } from './MarkingMenu';

const DRAW_TOOLS = new Set(['line', 'rect', 'circle', 'point', 'text', 'sketch']);

/** Problemzonen der Prüfung rot markieren. */
function drawPreflightMarks(ctx: CanvasRenderingContext2D, v: Viewport, r: PreflightResult | null): void {
  if (!r) return;
  ctx.save();
  for (const i of r.issues) {
    if (!i.regions?.length) continue;
    const col = i.severity === 'error' ? 'rgba(214,69,69,' : 'rgba(232,140,12,';
    ctx.beginPath();
    for (const poly of i.regions) {
      poly.forEach((p, k) => {
        const s = toScreen(v, p);
        if (k) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.closePath();
    }
    ctx.fillStyle = `${col}0.45)`;
    ctx.fill('evenodd');
    ctx.strokeStyle = `${col}1)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // kleine Bereiche zusätzlich umkreisen, damit man sie findet
    for (const poly of i.regions) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of poly) {
        const s = toScreen(v, p);
        minX = Math.min(minX, s.x);
        minY = Math.min(minY, s.y);
        maxX = Math.max(maxX, s.x);
        maxY = Math.max(maxY, s.y);
      }
      if (maxX - minX < 14 && maxY - minY < 14) {
        ctx.beginPath();
        ctx.arc((minX + maxX) / 2, (minY + maxY) / 2, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

interface PointerLike {
  clientX: number;
  clientY: number;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  pointerType?: string;
}

export function CanvasView() {
  const app = useApp();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<SceneLayout | null>(null);
  const size = useRef({ w: 800, h: 600, dpr: 1 });
  const frame = useRef(0);
  const pan = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  /**
   * Touch und Apple Pencil (iPad):
   * - Stift zeichnet immer; sobald ein Stift benutzt wurde, zeichnen Finger nicht mehr
   *   (Handballen-Erkennung) – ein Finger verschiebt dann, Tipp mit dem Finger öffnet das Menü.
   * - Ohne Stift: ein Finger zeichnet (kurz verzögert, um Mehrfinger-Gesten zu erkennen).
   * - Zwei Finger: Zoom und Verschieben; Zwei-Finger-Tipp = Rückgängig, Drei-Finger-Tipp = Wiederholen.
   * - Langes Drücken = Kontextmenü (Markierungsmenü).
   */
  const touches = useRef(new Map<number, { x: number; y: number; sx: number; sy: number }>());
  const pinch = useRef<{
    d: number;
    mid: Vec2;
    zoom: number;
    cx: number;
    cy: number;
    active: boolean;
  } | null>(null);
  const gesture = useRef<'none' | 'pending' | 'tool' | 'pinch' | 'pan1' | 'menu' | 'done'>('none');
  const pending = useRef<{ id: number; ev: PointerLike } | null>(null);
  const timers = useRef<{ start?: number; long?: number }>({});
  const tap = useRef<{
    max: number;
    t0: number;
    moved: boolean;
    x: number;
    y: number;
  }>({ max: 0, t0: 0, moved: false, x: 0, y: 0 });
  const penSeen = useRef(0);
  const penDown = useRef(false);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const lastTouchEnd = useRef(0);
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
      (cx, v) => {
        app.current.drawOverlay?.(cx, v);
        drawPreflightMarks(cx, v, ui.preflight?.result ?? null);
      },
    );
  }, [app, vp]);

  const requestRender = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  // Brücke für Werkzeuge und Controller
  useEffect(() => {
    app.canvas = { vp, layout: () => layoutRef.current, requestRender };
    // Für Leistungsmessungen in Tests: sofort zeichnen
    (window as unknown as { __vdRenderNow?: () => void }).__vdRenderNow = draw;
    const u1 = app.store.subscribe(requestRender);
    const u2 = app.ui.subscribe((s, p) => {
      if (s.cursorWorld !== p.cursorWorld || s.dynValues !== p.dynValues || s.textEdit !== p.textEdit || s.preflight !== p.preflight) requestRender();
    });
    // Schriften geladen → neu zeichnen
    void document.fonts?.ready.then(requestRender);
    return () => {
      u1();
      u2();
    };
  }, [app, vp, requestRender, draw]);

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
        else
          app.editor.setView({
            cx: 0,
            cy: 0,
            zoom: clampZoom(Math.min(r.width, r.height) / 160),
          });
      }
      draw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [app, draw]);

  const toPointer = useCallback(
    (e: PointerLike): ToolPointer => {
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

  // ------------------------------------------------------------------ Touch-Gesten
  const penMode = () => Date.now() - penSeen.current < 5 * 60 * 1000;
  const clearTimers = () => {
    if (timers.current.start) clearTimeout(timers.current.start);
    if (timers.current.long) clearTimeout(timers.current.long);
    timers.current = {};
  };
  const resetTouch = () => {
    clearTimers();
    pending.current = null;
    pinch.current = null;
    gesture.current = 'done';
  };
  const startPinch = () => {
    const pts = [...touches.current.values()];
    const [a, b] = pts;
    const v = app.store.getState().view;
    pinch.current = {
      d: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      zoom: v.zoom,
      cx: v.cx,
      cy: v.cy,
      active: false,
    };
  };
  const startTool = () => {
    const p = pending.current;
    clearTimers();
    if (!p) return;
    pending.current = null;
    gesture.current = 'tool';
    try {
      canvasRef.current?.setPointerCapture(p.id);
    } catch {
      /* Zeiger schon weg */
    }
    app.current.pointerDown?.(toPointer(p.ev));
  };
  const openMenuAt = (x: number, y: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    app.ui.setState({ marking: { x: x - r.left, y: y - r.top } });
  };
  const snapshot = (e: React.PointerEvent): PointerLike => ({
    clientX: e.clientX,
    clientY: e.clientY,
    button: 0,
    shiftKey: e.shiftKey,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    altKey: e.altKey,
    pointerType: e.pointerType,
  });

  const touchDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (penDown.current) return; // Handballen, während der Stift zeichnet
    touches.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      sx: e.clientX,
      sy: e.clientY,
    });
    const n = touches.current.size;
    if (n === 1) {
      tap.current = {
        max: 1,
        t0: Date.now(),
        moved: false,
        x: e.clientX,
        y: e.clientY,
      };
      if (penMode()) {
        // Mit Stift: Finger verschiebt nur
        const v = app.store.getState().view;
        pan.current = { sx: e.clientX, sy: e.clientY, cx: v.cx, cy: v.cy };
        gesture.current = 'pan1';
        return;
      }
      gesture.current = 'pending';
      pending.current = { id: e.pointerId, ev: snapshot(e) };
      timers.current.start = window.setTimeout(() => {
        if (gesture.current === 'pending' && !tap.current.moved) {
          // Finger liegt still: erst Langdruck abwarten, wenn das Werkzeug nichts zieht
          if (app.store.getState().tool !== 'select') startTool();
        }
      }, 140);
      timers.current.long = window.setTimeout(() => {
        if ((gesture.current === 'pending' || gesture.current === 'tool') && !tap.current.moved && touches.current.size === 1) {
          if (gesture.current === 'tool') app.current.cancel?.();
          pending.current = null;
          gesture.current = 'menu';
          openMenuAt(tap.current.x, tap.current.y);
        }
      }, 550);
      return;
    }
    // Zwei oder drei Finger
    tap.current.max = Math.max(tap.current.max, n);
    if (gesture.current === 'tool') app.current.cancel?.();
    pan.current = null;
    clearTimers();
    pending.current = null;
    gesture.current = 'pinch';
    if (n === 2) startPinch();
  };

  const touchMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const t = touches.current.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX;
    t.y = e.clientY;
    if (Math.hypot(t.x - t.sx, t.y - t.sy) > 10) tap.current.moved = true;
    switch (gesture.current) {
      case 'pending':
        if (tap.current.moved) {
          startTool();
          app.current.pointerMove?.(toPointer(snapshot(e)));
        }
        return;
      case 'tool': {
        const p = toPointer(snapshot(e));
        app.ui.setState({ cursorWorld: p.snap.pos });
        app.current.pointerMove?.(p);
        return;
      }
      case 'pan1': {
        const p = pan.current;
        if (!p) return;
        const z = app.store.getState().view.zoom;
        app.editor.setView({
          cx: p.cx - (e.clientX - p.sx) / z,
          cy: p.cy + (e.clientY - p.sy) / z,
        });
        return;
      }
      case 'pinch': {
        const pc = pinch.current;
        if (!pc || touches.current.size < 2) return;
        const [a, b] = [...touches.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (!pc.active && Math.abs(d - pc.d) < 8 && Math.hypot(mid.x - pc.mid.x, mid.y - pc.mid.y) < 8) return;
        pc.active = true;
        const r = canvasRef.current!.getBoundingClientRect();
        const m0 = { x: pc.mid.x - r.left, y: pc.mid.y - r.top };
        const m1 = { x: mid.x - r.left, y: mid.y - r.top };
        const { w, h } = size.current;
        // Weltpunkt unter der Anfangsmitte bleibt unter den Fingern
        const W = toWorld({ cx: pc.cx, cy: pc.cy, zoom: pc.zoom, width: w, height: h }, m0);
        const zoom = clampZoom((pc.zoom * d) / Math.max(pc.d, 1));
        app.editor.setView({
          zoom,
          cx: W.x - (m1.x - w / 2) / zoom,
          cy: W.y + (m1.y - h / 2) / zoom,
        });
        return;
      }
    }
  };

  const touchUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!touches.current.has(e.pointerId)) return;
    touches.current.delete(e.pointerId);
    const g = gesture.current;
    if (g === 'pending' || (g === 'tool' && !tap.current.moved && Date.now() - tap.current.t0 < 400)) {
      // Kurzer Tipp: wie ein Klick; zwei Tipps kurz nacheinander = Doppelklick
      if (g === 'pending') startTool();
      const pe = toPointer(snapshot(e));
      app.current.pointerUp?.(pe);
      const lt = lastTap.current;
      const now = Date.now();
      if (lt && now - lt.t < 350 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 24) {
        lastTap.current = null;
        app.current.doubleClick?.(pe);
      } else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
      gesture.current = 'done';
    } else if (g === 'tool') {
      app.current.pointerUp?.(toPointer(snapshot(e)));
      gesture.current = 'done';
    } else if (g === 'pinch' && touches.current.size === 2 && !pinch.current?.active) {
      // von drei auf zwei Finger: Zoom neu ansetzen
      startPinch();
    }
    if (touches.current.size > 0) return;
    // Alle Finger weg: Tipp-Gesten auswerten
    const quick = !tap.current.moved && Date.now() - tap.current.t0 < 400 && !pinch.current?.active;
    if (quick && tap.current.max === 2) void app.editor.undo();
    else if (quick && tap.current.max === 3) void app.editor.redo();
    else if (quick && g === 'pan1') openMenuAt(tap.current.x, tap.current.y);
    clearTimers();
    pan.current = null;
    pinch.current = null;
    pending.current = null;
    gesture.current = 'none';
    lastTouchEnd.current = Date.now();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    // Kein mousedown-Standardverhalten: sonst holt sich die Fläche den Fokus zurück, nachdem
    // ein Werkzeug gerade ein Eingabefeld (Maß, Text) geöffnet und fokussiert hat.
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== wrapRef.current) document.activeElement.blur();
    wrapRef.current?.focus({ preventScroll: true });
    if (app.ui.getState().marking) app.ui.setState({ marking: null });
    if (e.pointerType === 'pen') {
      penSeen.current = Date.now();
      penDown.current = true;
      // Stift hat Vorrang: laufende Finger-Gesten beenden
      if (gesture.current === 'pending' || gesture.current === 'pan1') resetTouch();
    }
    if (e.pointerType === 'touch') {
      touchDown(e);
      return;
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
    if (e.pointerType === 'touch') {
      touchMove(e);
      return;
    }
    if (pan.current) {
      const p = pan.current;
      const z = app.store.getState().view.zoom;
      app.editor.setView({
        cx: p.cx - (e.clientX - p.sx) / z,
        cy: p.cy + (e.clientY - p.sy) / z,
      });
      return;
    }
    if (right.current) return;
    const p = toPointer(e);
    app.ui.setState({ cursorWorld: p.snap.pos });
    app.current.pointerMove?.(p);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') penDown.current = false;
    if (e.pointerType === 'touch') {
      touchUp(e);
      return;
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
        app.ui.setState({
          marking: { x: start.x - r.left, y: start.y - r.top },
        });
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
    <div
      className="canvas-wrap"
      ref={wrapRef}
      tabIndex={-1}
      data-testid="canvas-wrap"
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault();
      }}
      onDrop={(e) => {
        const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
        if (!f) return;
        e.preventDefault();
        const r = canvasRef.current!.getBoundingClientRect();
        const at = toWorld(vp(), {
          x: e.clientX - r.left,
          y: e.clientY - r.top,
        });
        void f.arrayBuffer().then((b) => app.insertImage({ name: f.name, data: new Uint8Array(b), mime: f.type }, at));
      }}
    >
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
        onDoubleClick={(e) => {
          // Bei Touch erkennt touchUp den Doppeltipp selbst
          if (Date.now() - lastTouchEnd.current < 800) return;
          app.current.doubleClick?.(toPointer(e));
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <DynamicInput />
      <DimensionEditor layout={() => layoutRef.current} vp={vp} />
      <TextEditor vp={vp} />
      <MarkingMenu />
    </div>
  );
}
