import type { PatternExchange } from '../pattern/exchange';
import { GarmentSim, type SimOptions } from './garment';
import type { FromWorker, LayoutPart, ToWorker } from './protocol';
import type { Motion } from './rig';

/**
 * Treibt eine Simulation in Zeitscheiben voran – unabhängig von der Bildwiederholrate, damit der Stoff
 * auch auf langsamen Grafikkarten zügig fällt. Läuft im Worker oder (Rückfall) im Hauptthread.
 */
const STEP_MS = 1000 / 60;

export class SimRunner {
  private sim: GarmentSim | null = null;
  private id = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Live-Zustand überlebt einen Neustart der Simulation (z. B. nach einer Schnittänderung) */
  private live = false;
  private motion: Motion = 'stand';
  private wind = 0;
  private clock = 0;

  constructor(
    private emit: (m: FromWorker, transfer?: Transferable[]) => void,
    private slice = 24,
  ) {}

  start(id: number, ex: PatternExchange, opts: SimOptions): void {
    this.stop();
    this.id = id;
    try {
      this.sim = new GarmentSim(ex, opts);
    } catch (e) {
      this.emit({ type: 'error', id, message: e instanceof Error ? e.message : String(e) });
      return;
    }
    const sim = this.sim;
    this.applyLive();
    const parts: LayoutPart[] = sim.parts.map((p) => ({ key: p.key, pieceId: p.piece.id, copy: p.copy, offset: p.offset, count: p.count, uv: p.mesh.uv.slice(), tris: p.tris.slice() }));
    this.emit({ type: 'layout', id, parts, n: sim.n });
    this.frame();
    this.loop();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.sim = null;
  }

  /** Nachrichten der Ansicht (alles außer start/stop). */
  handle(m: ToWorker): void {
    const sim = this.sim;
    if (m.type === 'live') {
      this.live = m.on;
      this.motion = m.motion;
      this.wind = m.wind;
      this.applyLive();
      // läuft gerade keine Schleife (Stoff lag), wieder anwerfen
      if (sim && !this.timer) {
        this.clock = performance.now();
        this.timer = setTimeout(this.loop, 0);
      }
    } else if (m.type === 'grab') sim?.grab(m.index, m.x, m.y, m.z);
    else if (m.type === 'drag') sim?.dragTo(m.x, m.y, m.z);
    else if (m.type === 'release') sim?.release();
  }

  private applyLive(): void {
    const sim = this.sim;
    if (!sim) return;
    sim.setLive(this.live);
    if (this.live) {
      sim.setMotion(this.motion);
      sim.wind = this.wind;
    }
  }

  private frame(): void {
    const sim = this.sim;
    if (!sim) return;
    const pos = sim.pos.slice();
    if (sim.stats.live || sim.posed) {
      const bones = sim.posed ? sim.bones.slice() : undefined;
      this.emit({ type: 'frame', id: this.id, pos, stats: { ...sim.stats }, bones }, bones ? [pos.buffer, bones.buffer] : [pos.buffer]);
    } else if (sim.stats.settled) {
      sim.computeStrain();
      const gap = sim.gap.slice();
      const strain = sim.strain.slice();
      this.emit({ type: 'frame', id: this.id, pos, stats: { ...sim.stats }, gap, strain }, [pos.buffer, gap.buffer, strain.buffer]);
    } else this.emit({ type: 'frame', id: this.id, pos, stats: { ...sim.stats } }, [pos.buffer]);
  }

  private loop = (): void => {
    this.timer = null;
    const sim = this.sim;
    if (!sim) return;
    const t0 = performance.now();
    if (sim.stats.settled && sim.live) {
      // Live: in Echtzeit, 60 Schritte je Sekunde. Kommt der Rechner nicht mit, läuft der Stoff etwas langsamer
      // statt zu ruckeln (höchstens zwei Schritte je Bild).
      let due = Math.floor((t0 - this.clock) / STEP_MS);
      if (due >= 1) {
        if (due > 2) {
          due = 2;
          this.clock = t0;
        } else this.clock += due * STEP_MS;
        for (let i = 0; i < due; i++) sim.step();
        this.frame();
      }
      this.timer = setTimeout(this.loop, Math.max(0, Math.min(STEP_MS, this.clock + STEP_MS - performance.now())));
      return;
    }
    if (sim.stats.settled) return;
    do sim.step();
    while (!sim.stats.settled && performance.now() - t0 < this.slice);
    this.frame();
    if (!sim.stats.settled || sim.live) {
      this.clock = performance.now();
      this.timer = setTimeout(this.loop, 0);
    }
  };
}
