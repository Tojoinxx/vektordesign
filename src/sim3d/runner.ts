import type { PatternExchange } from '../pattern/exchange';
import { GarmentSim, type SimOptions } from './garment';
import type { FromWorker, LayoutPart } from './protocol';

/**
 * Treibt eine Simulation in Zeitscheiben voran – unabhängig von der Bildwiederholrate, damit der Stoff
 * auch auf langsamen Grafikkarten zügig fällt. Läuft im Worker oder (Rückfall) im Hauptthread.
 */
export class SimRunner {
  private sim: GarmentSim | null = null;
  private id = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

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

  private frame(): void {
    const sim = this.sim;
    if (!sim) return;
    const pos = sim.pos.slice();
    if (sim.stats.settled) {
      sim.computeStrain();
      const gap = sim.gap.slice();
      const strain = sim.strain.slice();
      this.emit({ type: 'frame', id: this.id, pos, stats: { ...sim.stats }, gap, strain }, [pos.buffer, gap.buffer, strain.buffer]);
    } else this.emit({ type: 'frame', id: this.id, pos, stats: { ...sim.stats } }, [pos.buffer]);
  }

  private loop = (): void => {
    const sim = this.sim;
    if (!sim) return;
    const t0 = performance.now();
    do sim.step();
    while (!sim.stats.settled && performance.now() - t0 < this.slice);
    this.frame();
    if (!sim.stats.settled) this.timer = setTimeout(this.loop, 0);
  };
}
