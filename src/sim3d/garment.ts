import type { PatternMaterial, PieceRole } from '../model/types';
import type { ExchangePiece, PatternExchange } from '../pattern/exchange';
import { bodyContact, buildMannequin, sectionAt, type Contact, type Mannequin } from './body';
import { meshPiece, type PieceMesh } from './mesh';
import { humanMannequin, type HumanMesh } from './human';
import { buildSdf, type Sdf } from './sdf';
import { BONE_COUNT, boneWeights, buildRig, identityBones, invertBones, poseBones, posedSegments, type Motion, type Rig } from './rig';

/** Abstandsfelder zwischenspeichern: dieselbe Puppe wird bei jeder Schnittänderung wiederverwendet. */
const sdfCache: { key: Float32Array | null; sdf: Sdf | null; sum: number } = { key: null, sdf: null, sum: 0 };
function sdfFor(h: HumanMesh): Sdf {
  let sum = 0;
  for (let i = 0; i < h.positions.length; i += 97) sum += h.positions[i] * (i + 1);
  if (sdfCache.sdf && sdfCache.sum === sum && sdfCache.key?.length === h.positions.length) return sdfCache.sdf;
  const sdf = buildSdf(h.positions, h.body);
  sdfCache.key = h.positions;
  sdfCache.sdf = sdf;
  sdfCache.sum = sum;
  return sdf;
}

/**
 * Stoffsimulation (XPBD, „Small Steps“): Schnittteile werden um die Puppe angeordnet, an den Nähten
 * zusammengezogen („genäht“), dann fällt der Stoff unter Schwerkraft auf den Körper.
 *
 * Einheiten: mm, Sekunden, Gramm. Reines TypeScript ohne DOM – läuft im Browser und in Tests.
 */

export interface FabricPhysics {
  /** Nachgiebigkeit gegen Dehnung (relativ, 0 = undehnbar) */
  stretch: number;
  /** Nachgiebigkeit gegen Biegung (relativ, größer = weicher) */
  bend: number;
  /** Dämpfung je Schritt */
  damping: number;
  friction: number;
}

export const FABRIC_PHYSICS: Record<PatternMaterial['fabric'], FabricPhysics> = {
  jersey: { stretch: 0.02, bend: 0.7, damping: 0.02, friction: 0.35 },
  sweat: { stretch: 0.012, bend: 0.2, damping: 0.025, friction: 0.45 },
  fleece: { stretch: 0.015, bend: 0.25, damping: 0.03, friction: 0.5 },
  rib: { stretch: 0.3, bend: 0.4, damping: 0.03, friction: 0.5 },
  woven: { stretch: 0.002, bend: 0.5, damping: 0.02, friction: 0.35 },
  denim: { stretch: 0.001, bend: 0.08, damping: 0.03, friction: 0.45 },
  nylon: { stretch: 0.002, bend: 2.5, damping: 0.015, friction: 0.2 },
  mesh: { stretch: 0.04, bend: 1.6, damping: 0.02, friction: 0.35 },
};

export interface SimOptions {
  /** Kantenlänge der Dreiecke in mm (kleiner = feiner, langsamer) */
  resolution?: number;
  substeps?: number;
  /** Dauer des Nähens (s) */
  sewTime?: number;
  /** Stoffdicke / Abstand zur Puppe (mm) */
  thickness?: number;
  /** Realistisches Menschen-Netz (MakeHuman); fehlt = einfache Schneiderpuppe */
  human?: HumanMesh;
  /** Stoff stößt an sich selbst (Lagen gleiten aufeinander statt durcheinander). Standard: an */
  selfCollision?: boolean;
  /** Kapuze aufgesetzt oder auf dem Rücken abgelegt (Standard: abgelegt, wie auf Produktfotos) */
  hood?: 'up' | 'down';
}

/** Ein Teil in 3D (bei gegengleichen Teilen zwei Instanzen). */
export interface GarmentPart {
  key: string;
  piece: ExchangePiece;
  copy: 0 | 1;
  mesh: PieceMesh;
  /** Erster Partikel dieses Teils im gemeinsamen Puffer */
  offset: number;
  count: number;
  /** Dreiecke mit globalen Indizes, für die Darstellung bei Kopie 1 umgedreht */
  tris: Uint32Array;
  material: PatternMaterial | null;
}

interface SeamLink {
  i: number;
  j: number;
  k: number;
  w: number;
}

export interface SimStats {
  time: number;
  /** größter Abstand an einer Naht (mm) */
  seamGap: number;
  /** mittlere Geschwindigkeit (mm/s) */
  speed: number;
  /** Partikel im Körper (tiefer als 2 mm) */
  inside: number;
  /** Stellen, an denen Stofflagen ineinander stecken (nur bei Eigenkollision gezählt) */
  overlaps?: number;
  settled: boolean;
  /** Live-Physik läuft: der Stoff liegt, wird aber in Echtzeit weitergerechnet */
  live?: boolean;
}

const G = 9810;
const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
/** Bezugsgewicht (g/m²), auf das die Stoffwerte abgestimmt sind */
const REF_GSM = 200;

export class GarmentSim {
  readonly mq: Mannequin;
  readonly parts: GarmentPart[] = [];
  pos: Float32Array;
  prev: Float32Array;
  invMass: Float32Array;
  /** Abstand zur Puppe je Partikel (für die Passform-Karte) */
  gap: Float32Array;
  /** Dehnung je Partikel (Mittel über die Kanten, 0 = entspannt) */
  strain: Float32Array;
  private restPos: Float32Array;
  private edges: Uint32Array;
  private edgeRest: Float32Array;
  private edgeComp: Float32Array;
  private bends: Uint32Array;
  private bendRest: Float32Array;
  private bendComp: Float32Array;
  private links: SeamLink[] = [];
  private linkRest0: Float32Array;
  private pinned: Uint8Array;
  private friction: Float32Array;
  /** Haftreibung am Körper (Bund, Beinbündchen): der Gummizug hält das Kleidungsstück, statt langsam zu rutschen */
  private grip: Float32Array;
  /** Luftwiderstand je Partikel (leichte Stoffe schweben länger) */
  private drag: Float32Array;
  /** Stoffdicke je Partikel (mm): schwere Stoffe tragen dicker auf */
  private thick: Float32Array;
  readonly n: number;
  t = 0;
  private settledFor = 0;
  readonly substeps: number;
  readonly sewTime: number;
  readonly thickness: number;
  readonly selfCollision: boolean;
  readonly hood: 'up' | 'down';
  /** Kollisionsradius je Partikel für die Eigenkollision (mm) */
  private selfR: Float32Array;
  /** Nachbarn im Netz (bis 3 Kanten/Nähte entfernt) – berühren sich ohnehin, nicht abstoßen. CSR, sortiert */
  private exStart: Uint32Array = new Uint32Array(1);
  private exList: Uint32Array = new Uint32Array(0);
  stats: SimStats = { time: 0, seamGap: Infinity, speed: 0, inside: 0, settled: false };

  // --- Live-Physik: Stoff rechnet in Echtzeit weiter, Puppe bewegt sich, Stoff lässt sich anfassen ---
  /** Live-Physik gewünscht (beginnt, sobald der Stoff zum ersten Mal liegt) */
  live = false;
  /** Skelett der realistischen Puppe; null bei der einfachen Schneiderpuppe (keine Bewegung möglich) */
  readonly rig: Rig | null;
  motion: Motion = 'stand';
  private motionFrom: Motion = 'stand';
  private motionBlend = 1;
  private motionT = 0;
  /** Knochenmatrizen der aktuellen Haltung (Ruhehaltung → Haltung) */
  bones = identityBones();
  /** Puppe steht nicht in Ruhehaltung: Kollision rechnet Partikel über das Skelett zurück */
  posed = false;
  private invBones = new Float32Array(BONE_COUNT * 12);
  private segs = new Float32Array(BONE_COUNT * 6);
  private boneW = new Float32Array(BONE_COUNT);
  /** je Partikel: Abbildung Haltung → Ruhehaltung am Anfang und am Ende des Bildschritts */
  private inv0 = new Float32Array(0);
  private inv1 = new Float32Array(0);
  private liveNow = false;
  private subIndex = 0;
  private subCount = 0;
  /** ab wann nach dem Fallen stärker gedämpft wird / frühestens Ruhe gilt / spätestens Ruhe gilt */
  private lateFrom: number;
  private calmFrom: number;
  private forceAt = 8;
  /** Wind (0 … 1) und seine Beschleunigung je Partikel in x für diesen Bildschritt (mm/s²) */
  wind = 0;
  private windAcc = new Float32Array(0);
  private windGain = new Float32Array(0);
  /** Angefasste Partikel mit Gewicht und Versatz zum Griffpunkt */
  private grabIdx: number[] = [];
  private grabW: number[] = [];
  private grabOff: number[] = [];
  private grabTarget: [number, number, number] = [0, 0, 0];
  /**
   * Bund hält an der Taille: sobald er nach dem Nähen sitzt, merkt sich jeder Bund-Partikel seine Stelle am Körper
   * (in Ruhehaltung, mit Knochengewichten) und wird wie von einem Gummizug dorthin zurückgezogen – auch wenn sich
   * die Puppe bewegt. Ohne das rutscht ein schwerer Rock langsam über die Hüfte.
   */
  private anchorIdx: Int32Array | null = null;
  private anchorRest = new Float32Array(0);
  private anchorW = new Float32Array(0);
  private anchorFrom = new Float32Array(0);
  private anchorTo = new Float32Array(0);
  private adjStart: Uint32Array | null = null;
  private adjList = new Uint32Array(0);

  constructor(
    readonly ex: PatternExchange,
    opts: SimOptions = {},
  ) {
    const h = opts.resolution ?? 22;
    this.substeps = opts.substeps ?? 12;
    this.sewTime = opts.sewTime ?? 1.4;
    this.thickness = opts.thickness ?? 3;
    this.selfCollision = opts.selfCollision ?? true;
    this.hood = opts.hood ?? 'down';
    this.mq = opts.human ? humanMannequin(ex.body, ex.gender ?? 'male', opts.human) : buildMannequin(ex.body, ex.gender ?? 'male');
    if (opts.human) this.mq.sdf = sdfFor(opts.human);
    this.rig = opts.human ? buildRig(opts.human.joints, ex.body) : null;
    // Teile vernetzen
    let total = 0;
    for (const piece of ex.pieces) {
      if (piece.polygon.length < 3 || piece.edges.length < 2) continue;
      // Schmale Teile (Bündchen) feiner vernetzen, damit sie mindestens drei Dreiecksreihen haben
      const xs = piece.polygon.map((q) => q[0]);
      const ys = piece.polygon.map((q) => q[1]);
      const minDim = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      // Faltenteile feiner: mindestens fünf Dreiecksreihen je Falte, sonst kann der Stoff die Falte nicht legen
      const pleatH = piece.pleats ? Math.max(15, (Math.max(...xs) - Math.min(...xs)) / piece.pleats / 5) : Infinity;
      const mesh = meshPiece(piece, Math.max(6, Math.min(h, minDim / 3.2, pleatH)));
      const material = ex.materials.find((m) => m.id === piece.material) ?? ex.materials[0] ?? null;
      for (const copy of piece.cut === 2 ? ([0, 1] as const) : ([0] as const)) {
        const tris = new Uint32Array(mesh.tris.length);
        for (let t = 0; t < mesh.tris.length; t += 3) {
          const a = mesh.tris[t] + total;
          const b = mesh.tris[t + 1] + total;
          const c = mesh.tris[t + 2] + total;
          if (copy) {
            tris[t] = a;
            tris[t + 1] = c;
            tris[t + 2] = b;
          } else {
            tris[t] = a;
            tris[t + 1] = b;
            tris[t + 2] = c;
          }
        }
        this.parts.push({ key: `${piece.id}:${copy}`, piece, copy, mesh, offset: total, count: mesh.count, tris, material });
        total += mesh.count;
      }
    }
    this.n = total;
    this.pos = new Float32Array(total * 3);
    this.prev = new Float32Array(total * 3);
    this.restPos = new Float32Array(total * 3);
    this.invMass = new Float32Array(total);
    this.gap = new Float32Array(total).fill(1e3);
    this.strain = new Float32Array(total);
    this.pinned = new Uint8Array(total);
    this.friction = new Float32Array(total);
    this.drag = new Float32Array(total);
    this.thick = new Float32Array(total);
    this.windAcc = new Float32Array(total);
    this.windGain = new Float32Array(total);
    this.grip = new Float32Array(total);
    for (const p of this.parts) if (p.piece.role === 'waistband' || p.piece.role === 'legCuff') this.grip.fill(p.piece.role === 'waistband' ? 1.6 : 0.8, p.offset, p.offset + p.count);
    this.place();
    // Massen aus Flächengewicht
    const mass = new Float32Array(total);
    for (const p of this.parts) {
      const gsm = p.material?.gsm ?? 200;
      const uv = p.mesh.uv;
      for (let t = 0; t < p.mesh.tris.length; t += 3) {
        const a = p.mesh.tris[t];
        const b = p.mesh.tris[t + 1];
        const c = p.mesh.tris[t + 2];
        const area = Math.abs((uv[2 * b] - uv[2 * a]) * (uv[2 * c + 1] - uv[2 * a + 1]) - (uv[2 * c] - uv[2 * a]) * (uv[2 * b + 1] - uv[2 * a + 1])) / 2;
        const m = (area / 1e6) * gsm;
        for (const v of [a, b, c]) mass[p.offset + v] += m / 3;
      }
      const phys = FABRIC_PHYSICS[p.material?.fabric ?? 'jersey'];
      const drag = Math.min(0.08, Math.max(0.006, phys.damping + 0.018 * (REF_GSM / gsm - 1)));
      const th = Math.min(7, Math.max(2, 1.4 + gsm / 110)) * (this.thickness / 3);
      for (let v = 0; v < p.count; v++) {
        this.friction[p.offset + v] = phys.friction;
        this.drag[p.offset + v] = drag;
        this.thick[p.offset + v] = th;
        // leichter Stoff fängt mehr Wind
        this.windGain[p.offset + v] = Math.min(2.4, Math.max(0.45, REF_GSM / gsm));
      }
    }
    for (let i = 0; i < total; i++) this.invMass[i] = mass[i] > 0 ? 1 / mass[i] : 0;
    // Teile, die nach dem Nähen in Form gezogen werden: Kapuze (ablegen) und Polokragen (umschlagen)
    this.hoodMask = new Uint8Array(total);
    this.pullAcc = new Float32Array(total * 3);
    const neckZ = sectionAt(this.mq, this.mq.neckBaseY - 1)?.cz ?? 0;
    for (const p of this.parts) {
      const isHood = p.piece.role === 'hood' && this.hood === 'down';
      const isFall = p.piece.role === 'collar' && !/steg|stand/i.test(p.piece.name);
      if (!isHood && !isFall) continue;
      this.hoodMask.fill(1, p.offset, p.offset + p.count);
      for (let i = p.offset; i < p.offset + p.count; i++) {
        if (isHood) this.pullAcc.set([0, -1.2 * G, -3.5 * G], 3 * i);
        else {
          // nach außen und unten: der Kragen klappt über den Steg auf die Schultern
          const dx = this.pos[3 * i];
          const dz = this.pos[3 * i + 2] - neckZ;
          const l = Math.hypot(dx, dz) || 1;
          this.pullAcc.set([(dx / l) * 1.6 * G, -1.4 * G, (dz / l) * 1.6 * G], 3 * i);
        }
      }
    }
    // Kanten (Dehnung) und Biegepaare aus der 2D-Ruhelage
    const edges: number[] = [];
    const eRest: number[] = [];
    const eComp: number[] = [];
    const bends: number[] = [];
    const bRest: number[] = [];
    const bComp: number[] = [];
    const invM = this.invMass;
    for (const p of this.parts) {
      const phys = FABRIC_PHYSICS[p.material?.fabric ?? 'jersey'];
      // Physikalisch: Nachgiebigkeit absolut (nicht relativ zur Masse) – schwerer Stoff zieht stärker an sich
      // selbst und hängt mehr durch; dickerer Stoff ist biegesteifer (große, weiche Falten statt feiner).
      const g = Math.max(30, p.material?.gsm ?? REF_GSM);
      const heavy = g / REF_GSM;
      // Bund: fester Gummizug – dehnt sich beim Anziehen, rutscht aber nicht über die Hüfte
      const stretch = p.piece.role === 'waistband' ? Math.min(phys.stretch, 0.04) : phys.stretch;
      const uv = p.mesh.uv;
      const map = new Map<string, number>();
      const tri = p.mesh.tris;
      const opp = new Map<string, number[]>();
      for (let t = 0; t < tri.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const a = tri[t + e];
          const b = tri[t + ((e + 1) % 3)];
          const c = tri[t + ((e + 2) % 3)];
          const key = a < b ? `${a},${b}` : `${b},${a}`;
          if (!map.has(key)) {
            map.set(key, edges.length / 2);
            edges.push(p.offset + a, p.offset + b);
            eRest.push(Math.hypot(uv[2 * a] - uv[2 * b], uv[2 * a + 1] - uv[2 * b + 1]));
            eComp.push(stretch * ((invM[p.offset + a] + invM[p.offset + b]) / 2) * heavy);
          }
          const o = opp.get(key) ?? [];
          o.push(c);
          opp.set(key, o);
        }
      }
      for (const o of opp.values()) {
        if (o.length !== 2) continue;
        const [c, d] = o;
        bends.push(p.offset + c, p.offset + d);
        bRest.push(Math.hypot(uv[2 * c] - uv[2 * d], uv[2 * c + 1] - uv[2 * d + 1]));
        bComp.push((phys.bend * ((invM[p.offset + c] + invM[p.offset + d]) / 2)) / (heavy * heavy));
      }
    }
    this.edges = Uint32Array.from(edges);
    this.edgeRest = Float32Array.from(eRest);
    this.edgeComp = Float32Array.from(eComp);
    this.bends = Uint32Array.from(bends);
    this.bendRest = Float32Array.from(bRest);
    this.bendComp = Float32Array.from(bComp);
    // Weiche Biegung für die Kapuze, solange sie abgelegt wird: sie klappt zusammen statt als Schale stehen zu bleiben
    this.bendCompSoft = Float32Array.from(bComp);
    for (let b = 0; b < bComp.length; b++) if (this.hoodMask[bends[2 * b]]) this.bendCompSoft[b] *= 40;
    this.buildSeams();
    this.linkRest0 = new Float32Array(this.links.length);
    for (let l = 0; l < this.links.length; l++) this.linkRest0[l] = this.linkDist(this.links[l]);
    this.pinLoosePieces();
    this.orientOutward();
    this.selfR = new Float32Array(total);
    if (this.selfCollision) this.buildSelfExclusion();
    this.prev.set(this.pos);
    const calm = this.hasHoodPull() ? this.hoodPull[1] + 0.6 : this.sewTime + 0.8;
    this.lateFrom = this.sewTime + 1.2;
    this.calmFrom = calm;
  }

  // -------------------------------------------------------------------------
  // Live-Physik: Bewegung, Wind, Anfassen
  // -------------------------------------------------------------------------

  /** Live-Physik ein/aus. Aus: Puppe geht in die Ruhehaltung zurück, der Stoff kommt wieder zur Ruhe. */
  setLive(on: boolean): void {
    if (on === this.live) return;
    this.live = on;
    if (!on) {
      this.release();
      this.wind = 0;
      this.setMotion('stand');
      if (this.stats.settled) {
        this.stats = { ...this.stats, settled: false, live: false };
        this.settledFor = 0;
        this.lateFrom = this.t + 0.3;
        this.calmFrom = this.t + 0.7;
        this.forceAt = this.t + 6;
      }
    }
  }

  /** Bewegung der Puppe (weich übergeblendet). Ohne realistische Puppe wirkungslos. */
  setMotion(m: Motion): void {
    if (m === this.motion || !this.rig) return;
    // Mitten in einer Überblendung: von der Bewegung aus weiter, die gerade überwiegt
    this.motionFrom = this.motionBlend >= 0.5 ? this.motion : this.motionFrom;
    this.motion = m;
    this.motionBlend = 0;
  }

  private buildAdjacency(): void {
    const N = this.n;
    const deg = new Uint32Array(N + 1);
    for (let e = 0; e < this.edges.length; e++) deg[this.edges[e] + 1]++;
    for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
    const list = new Uint32Array(this.edges.length);
    const fill = deg.slice(0, N);
    for (let e = 0; e < this.edges.length; e += 2) {
      const a = this.edges[e];
      const b = this.edges[e + 1];
      list[fill[a]++] = b;
      list[fill[b]++] = a;
    }
    this.adjStart = deg;
    this.adjList = list;
  }

  /** Nächster Partikel zu einem Punkt (für Tests und das Anfassen ohne Treffer-Index). */
  nearest(x: number, y: number, z: number): number {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = (this.pos[3 * i] - x) ** 2 + (this.pos[3 * i + 1] - y) ** 2 + (this.pos[3 * i + 2] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * Stoff anfassen: Partikel `index` und seine Nachbarn (zwei Ringe, nach außen schwächer) folgen dem Griffpunkt.
   * Der Zug ist begrenzt – zieht man zu weit, rutscht der Stoff aus der Hand statt zu reißen.
   */
  grab(index: number, x: number, y: number, z: number): void {
    this.release();
    if (index < 0 || index >= this.n || this.invMass[index] === 0) return;
    if (!this.adjStart) this.buildAdjacency();
    const A = this.adjStart!;
    const ring = new Map<number, number>([[index, 1]]);
    let frontier = [index];
    for (const w of [0.7, 0.4]) {
      const next: number[] = [];
      for (const v of frontier)
        for (let q = A[v]; q < A[v + 1]; q++) {
          const u = this.adjList[q];
          if (ring.has(u) || this.invMass[u] === 0) continue;
          ring.set(u, w);
          next.push(u);
        }
      frontier = next;
    }
    for (const [j, w] of ring) {
      this.grabIdx.push(j);
      this.grabW.push(w);
      this.grabOff.push(this.pos[3 * j] - this.pos[3 * index], this.pos[3 * j + 1] - this.pos[3 * index + 1], this.pos[3 * j + 2] - this.pos[3 * index + 2]);
    }
    this.grabTarget = [x, y, z];
  }

  dragTo(x: number, y: number, z: number): void {
    this.grabTarget = [x, y, z];
  }

  release(): void {
    this.grabIdx = [];
    this.grabW = [];
    this.grabOff = [];
  }

  get grabbing(): boolean {
    return this.grabIdx.length > 0;
  }

  /** Haltung der Puppe für diesen Bildschritt und je Partikel die Rückrechnung in die Ruhehaltung. */
  private updatePose(dt: number): void {
    const rig = this.rig;
    if (!rig) return;
    this.motionT += dt;
    this.motionBlend = Math.min(1, this.motionBlend + dt / 0.45);
    const moving = this.motion !== 'stand' || (this.motionBlend < 1 && this.motionFrom !== 'stand');
    if (!moving && !this.posed) return;
    const N = this.n;
    if (this.inv1.length !== N * 12) {
      this.inv0 = new Float32Array(N * 12);
      this.inv1 = new Float32Array(N * 12);
    }
    if (!this.posed) for (let i = 0; i < N; i++) this.inv1.set(IDENT, 12 * i);
    const sw = this.inv0;
    this.inv0 = this.inv1;
    this.inv1 = sw;
    if (moving) poseBones(rig, this.motion, this.motionT, this.bones, this.motionFrom, this.motionBlend);
    else identityBones(this.bones);
    invertBones(this.bones, this.invBones);
    posedSegments(rig, this.bones, this.segs);
    const { pos, invBones, boneW } = this;
    const out = this.inv1;
    for (let i = 0; i < N; i++) {
      boneWeights(rig, this.segs, pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], boneW);
      const o = 12 * i;
      for (let c = 0; c < 12; c++) out[o + c] = 0;
      for (let b = 0; b < BONE_COUNT; b++) {
        const w = boneW[b];
        if (w === 0) continue;
        const s = 12 * b;
        for (let c = 0; c < 12; c++) out[o + c] += w * invBones[s + c];
      }
    }
    // steht die Puppe wieder, gilt ab dem nächsten Schritt die schnelle Kollision ohne Skelett
    this.posedNext = moving;
    this.posed = true;
  }
  private posedNext = false;

  /** Bund an seiner Stelle am Körper festmachen (einmal, wenn er nach dem Nähen sitzt). */
  private captureAnchors(): void {
    const idx: number[] = [];
    for (const p of this.parts) if (p.piece.role === 'waistband') for (let i = 0; i < p.count; i++) if (this.invMass[p.offset + i] > 0) idx.push(p.offset + i);
    this.anchorIdx = Int32Array.from(idx);
    const n = idx.length;
    this.anchorRest = new Float32Array(n * 3);
    this.anchorW = new Float32Array(n * BONE_COUNT);
    this.anchorFrom = new Float32Array(n * 3);
    this.anchorTo = new Float32Array(n * 3);
    const seg = this.rig ? posedSegments(this.rig, identityBones()) : null;
    for (let q = 0; q < n; q++) {
      const k = 3 * idx[q];
      for (let c = 0; c < 3; c++) this.anchorRest[3 * q + c] = this.anchorFrom[3 * q + c] = this.anchorTo[3 * q + c] = this.pos[k + c];
      if (this.rig && seg) boneWeights(this.rig, seg, this.pos[k], this.pos[k + 1], this.pos[k + 2], this.anchorW.subarray(q * BONE_COUNT, (q + 1) * BONE_COUNT));
    }
  }

  /** Ziel der Bund-Partikel für diesen Bildschritt: ihre Stelle am Körper in der aktuellen Haltung. */
  private updateAnchors(): void {
    const idx = this.anchorIdx;
    if (!idx || !idx.length) return;
    this.anchorFrom.set(this.anchorTo);
    const { anchorRest: R, anchorW: W, anchorTo: T, bones } = this;
    for (let q = 0; q < idx.length; q++) {
      const x = R[3 * q];
      const y = R[3 * q + 1];
      const z = R[3 * q + 2];
      if (!this.posed) {
        T[3 * q] = x;
        T[3 * q + 1] = y;
        T[3 * q + 2] = z;
        continue;
      }
      let tx = 0;
      let ty = 0;
      let tz = 0;
      for (let b = 0; b < BONE_COUNT; b++) {
        const w = W[q * BONE_COUNT + b];
        if (w === 0) continue;
        const o = 12 * b;
        tx += w * (bones[o] * x + bones[o + 1] * y + bones[o + 2] * z + bones[o + 3]);
        ty += w * (bones[o + 4] * x + bones[o + 5] * y + bones[o + 6] * z + bones[o + 7]);
        tz += w * (bones[o + 8] * x + bones[o + 9] * y + bones[o + 10] * z + bones[o + 11]);
      }
      T[3 * q] = tx;
      T[3 * q + 1] = ty;
      T[3 * q + 2] = tz;
    }
  }

  /** Wind: Böen über die Zeit, dazu eine Welle, die durch den Stoff läuft. */
  private updateWind(): void {
    const W = this.wind;
    if (W <= 0) return;
    const t = this.t;
    const gust = 0.55 + 0.45 * Math.sin(1.3 * t) * Math.sin(0.37 * t + 1);
    const base = W * 14000 * gust;
    const { pos, windAcc, windGain } = this;
    for (let i = 0; i < this.n; i++) windAcc[i] = base * windGain[i] * (1 + 0.5 * Math.sin(0.011 * pos[3 * i + 1] + 0.02 * pos[3 * i + 2] - 5 * t));
  }

  // -------------------------------------------------------------------------
  // Eigenkollision
  // -------------------------------------------------------------------------

  /**
   * Nachbarschaft im Netz (über Kanten und Nähte, bis 3 Schritte): diese Partikel liegen ohnehin nah beieinander
   * und werden nicht abgestoßen. Radius je Partikel aus Stoffdicke und Maschenweite – so rutscht keine Lage
   * durch die Lücken der anderen.
   */
  private buildSelfExclusion(): void {
    const N = this.n;
    const adj: number[][] = Array.from({ length: N }, () => []);
    const add = (a: number, b: number) => {
      if (a === b) return;
      adj[a].push(b);
      adj[b].push(a);
    };
    const len = new Float32Array(N);
    const cnt = new Float32Array(N);
    for (let e = 0; e < this.edgeRest.length; e++) {
      const a = this.edges[2 * e];
      const b = this.edges[2 * e + 1];
      add(a, b);
      len[a] += this.edgeRest[e];
      len[b] += this.edgeRest[e];
      cnt[a]++;
      cnt[b]++;
    }
    for (const l of this.links) {
      add(l.i, l.j);
      add(l.i, l.k);
    }
    for (let i = 0; i < N; i++) this.selfR[i] = Math.max(this.thick[i], 0.27 * (cnt[i] ? len[i] / cnt[i] : 20));
    // An Nähten liegen Lagen bestimmungsgemäß aufeinander (Nahtzugabe, Überlappung vorne an der Kapuze):
    // dort nur die echte Stoffdicke als Abstand
    for (const l of this.links) for (const v of [l.i, l.j, l.k]) this.selfR[v] = this.thick[v] * 0.6;
    const start = new Uint32Array(N + 1);
    const list: number[] = [];
    const mark = new Int32Array(N).fill(-1);
    let frontier: number[] = [];
    let next: number[] = [];
    for (let i = 0; i < N; i++) {
      const found: number[] = [];
      mark[i] = i;
      frontier = [i];
      for (let hop = 0; hop < 3; hop++) {
        next = [];
        for (const v of frontier)
          for (const w of adj[v])
            if (mark[w] !== i) {
              mark[w] = i;
              found.push(w);
              next.push(w);
            }
        frontier = next;
      }
      found.sort((a, b) => a - b);
      start[i] = list.length;
      for (const w of found) list.push(w);
    }
    start[N] = list.length;
    this.exStart = start;
    this.exList = Uint32Array.from(list);
    this.hashTable = new Int32Array(1 << Math.ceil(Math.log2(Math.max(64, 2 * N))));
    this.hashNext = new Int32Array(N);
    let maxR = 0;
    for (let i = 0; i < N; i++) maxR = Math.max(maxR, this.selfR[i]);
    this.hashCell = 2 * maxR;
  }

  /** Liegen i und j im Netz nah beieinander (bis 3 Kanten/Nähte)? Für Tests. */
  meshNeighbors(i: number, j: number): boolean {
    if (this.exStart.length === 1) this.buildSelfExclusion();
    return this.excluded(i, j);
  }

  private excluded(i: number, j: number): boolean {
    let lo = this.exStart[i];
    let hi = this.exStart[i + 1] - 1;
    const L = this.exList;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      const v = L[m];
      if (v === j) return true;
      if (v < j) lo = m + 1;
      else hi = m - 1;
    }
    return false;
  }

  private hashTable = new Int32Array(0);
  private hashNext = new Int32Array(0);
  private hashCell = 12;

  private cellHash(ix: number, iy: number, iz: number): number {
    return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (this.hashTable.length - 1);
  }

  /** Räumliches Raster neu aufbauen (verkettete Listen je Zelle). */
  private buildHash(): void {
    const { pos, hashTable, hashNext } = this;
    const c = this.hashCell;
    hashTable.fill(-1);
    for (let i = 0; i < this.n; i++) {
      const h = this.cellHash(Math.floor(pos[3 * i] / c), Math.floor(pos[3 * i + 1] / c), Math.floor(pos[3 * i + 2] / c));
      hashNext[i] = hashTable[h];
      hashTable[h] = i;
    }
  }

  /**
   * Partikel verschiedener Stellen des Stoffs halten Abstand (Summe der Radien). Mit Reibung, damit Lagen
   * nicht wie Eis aufeinander gleiten. Liefert die Zahl der Paare, die deutlich zu nah waren.
   */
  private solveSelf(countOnly = false): number {
    const { pos, prev, invMass, selfR, hashTable, hashNext } = this;
    const c = this.hashCell;
    let overlaps = 0;
    for (let i = 0; i < this.n; i++) {
      const wi = invMass[i];
      const ki = 3 * i;
      const ix = Math.floor(pos[ki] / c);
      const iy = Math.floor(pos[ki + 1] / c);
      const iz = Math.floor(pos[ki + 2] / c);
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            for (let j = hashTable[this.cellHash(ix + dx, iy + dy, iz + dz)]; j >= 0; j = hashNext[j]) {
              if (j <= i) continue;
              const kj = 3 * j;
              const ex = pos[kj] - pos[ki];
              const ey = pos[kj + 1] - pos[ki + 1];
              const ez = pos[kj + 2] - pos[ki + 2];
              const r = selfR[i] + selfR[j];
              const d2 = ex * ex + ey * ey + ez * ez;
              if (d2 >= r * r) continue;
              if (this.excluded(i, j)) continue;
              const d = Math.sqrt(d2);
              if (d < r * 0.5) overlaps++;
              if (countOnly) continue;
              const wj = invMass[j];
              const W = wi + wj;
              if (W === 0 || d < 1e-6) continue;
              const C = (r - d) / W;
              const nx = ex / d;
              const ny = ey / d;
              const nz = ez / d;
              pos[ki] -= nx * C * wi;
              pos[ki + 1] -= ny * C * wi;
              pos[ki + 2] -= nz * C * wi;
              pos[kj] += nx * C * wj;
              pos[kj + 1] += ny * C * wj;
              pos[kj + 2] += nz * C * wj;
              // Reibung: Relativbewegung quer zur Kontaktnormalen bremsen
              const rvx = pos[kj] - prev[kj] - (pos[ki] - prev[ki]);
              const rvy = pos[kj + 1] - prev[kj + 1] - (pos[ki + 1] - prev[ki + 1]);
              const rvz = pos[kj + 2] - prev[kj + 2] - (pos[ki + 2] - prev[ki + 2]);
              const vn = rvx * nx + rvy * ny + rvz * nz;
              const f = 0.3 / W;
              const tx = (rvx - vn * nx) * f;
              const ty = (rvy - vn * ny) * f;
              const tz = (rvz - vn * nz) * f;
              prev[ki] -= tx * wi;
              prev[ki + 1] -= ty * wi;
              prev[ki + 2] -= tz * wi;
              prev[kj] += tx * wj;
              prev[kj + 1] += ty * wj;
              prev[kj + 2] += tz * wj;
            }
          }
    }
    return overlaps;
  }

  /** Wie viele Stellen stecken ineinander (für Tests und Statistik)? */
  selfOverlaps(): number {
    if (this.exStart.length === 1) this.buildSelfExclusion();
    this.buildHash();
    return this.solveSelf(true);
  }

  // -------------------------------------------------------------------------
  // Anordnung um die Puppe
  // -------------------------------------------------------------------------

  private partBox(p: GarmentPart) {
    const uv = p.mesh.uv;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < p.count; i++) {
      minX = Math.min(minX, uv[2 * i]);
      maxX = Math.max(maxX, uv[2 * i]);
      minY = Math.min(minY, uv[2 * i + 1]);
      maxY = Math.max(maxY, uv[2 * i + 1]);
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2 };
  }

  private place(): void {
    const mq = this.mq;
    const roleBox = (role: PieceRole) => {
      const p = this.parts.find((x) => x.piece.role === role);
      return p ? this.partBox(p) : null;
    };
    const fb = roleBox('front');
    const bb = roleBox('back');
    const torsoCirc = (fb?.w ?? 0) + (bb?.w ?? 0) || this.ex.body.chest * 1.1;
    const R = Math.max((torsoCirc / (2 * Math.PI)) * 1.15 + 15, mq.maxR + 35);
    const top = mq.neckBaseY + 12;
    const frontLen = fb?.h ?? bb?.h ?? this.ex.body.backLength * 1.5;
    const sleeveP = this.parts.find((x) => x.piece.role === 'sleeve');
    const sleeveLen = sleeveP ? this.partBox(sleeveP).h : this.ex.body.arm * 0.8;
    const [jx, jy, jz] = mq.shoulderJoint;
    const [dx, dy, dz] = mq.armDir;
    // Orthonormales System um die Armachse: e1 nach oben/außen, e2 nach vorne
    let e1x = -dy;
    let e1y = dx;
    let e1z = 0;
    const dot1 = e1x * dx + e1y * dy + e1z * dz;
    e1x -= dot1 * dx;
    e1y -= dot1 * dy;
    e1z -= dot1 * dz;
    const l1 = Math.hypot(e1x, e1y, e1z) || 1;
    e1x /= l1;
    e1y /= l1;
    e1z /= l1;
    let e2x = dy * e1z - dz * e1y;
    let e2y = dz * e1x - dx * e1z;
    let e2z = dx * e1y - dy * e1x;
    if (e2z < 0) {
      e2x = -e2x;
      e2y = -e2y;
      e2z = -e2z;
    }
    // --- Unterteile: Bundhöhe, Schritthöhe und Beinachse ---
    const [axTop, axKnee, axAnkle] = mq.legAxis;
    const legAt = (y: number): [number, number] => {
      const [a, b] = y >= axKnee[1] ? [axTop, axKnee] : [axKnee, axAnkle];
      const t = Math.min(1, Math.max(0, (a[1] - y) / (a[1] - b[1])));
      return [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t];
    };
    /** Hosenbein: Schrittspitze, Mitte und Breite auf Schritt- und Saumhöhe, vordere/hintere Mitte am Bund */
    const legInfo = (p: GarmentPart) => {
      const uv = p.mesh.uv;
      const b = this.partBox(p);
      const front = p.piece.role === 'legFront';
      let tip = 0;
      let cTop = 0;
      for (let i = 1; i < p.count; i++) {
        if (front ? uv[2 * i] < uv[2 * tip] : uv[2 * i] > uv[2 * tip]) tip = i;
        // vordere Mitte: innerster Punkt der Bundkante; hintere Mitte: höchster Punkt
        const top = uv[2 * i + 1] > b.maxY - 2;
        const best = uv[2 * cTop + 1] > b.maxY - 2;
        if (front ? top && (!best || uv[2 * i] < uv[2 * cTop]) : uv[2 * i + 1] > uv[2 * cTop + 1]) cTop = i;
      }
      const tipU = uv[2 * tip];
      const tipV = uv[2 * tip + 1];
      const range = (lo: number, hi: number) => {
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < p.count; i++) {
          const v = uv[2 * i + 1];
          if (v < lo || v > hi) continue;
          min = Math.min(min, uv[2 * i]);
          max = Math.max(max, uv[2 * i]);
        }
        return min <= max ? [min, max] : [b.minX, b.maxX];
      };
      const c = range(tipV - 12, tipV + 12);
      const h = range(b.minY - 1, b.minY + 6);
      return { b, front, tipV, tipU, centerU: uv[2 * cTop], cMid: (c[0] + c[1]) / 2, cW: c[1] - c[0], hMid: (h[0] + h[1]) / 2, hW: h[1] - h[0] };
    };
    const legParts = this.parts.filter((x) => x.piece.role === 'legFront' || x.piece.role === 'legBack');
    const legInfos = new Map(legParts.map((x) => [x.key, legInfo(x)]));
    const lf = legInfos.get(legParts.find((x) => x.piece.role === 'legFront')?.key ?? '') ?? [...legInfos.values()][0];
    // Hose: Schritt 3 cm unter dem Körper; Rock: Bund knapp unter der Taille
    const crotchLevel = axTop[1] - 30;
    const waistTop = lf ? crotchLevel + (lf.b.maxY - lf.tipV) : mq.waistY - 10;
    const legHemY = lf ? crotchLevel + (lf.b.minY - lf.tipV) : 0;
    // Hüftweite der Hose: je Teil von der vorderen/hinteren Mitte bis zur Seitennaht (beide Kopien zählen mit)
    const hipCirc = legParts.reduce((acc, x) => {
      const L = legInfos.get(x.key)!;
      return acc + (L.front ? L.b.maxX - L.centerU : L.centerU - L.b.minX);
    }, 0);
    const Rhip = Math.max((hipCirc / (2 * Math.PI)) * 1.1 + 15, mq.maxR + 35);
    const skirtW = this.parts.filter((x) => x.piece.role === 'skirtFront' || x.piece.role === 'skirtBack').reduce((a, x) => a + this.partBox(x).w, 0);
    const Rskirt = Math.max((skirtW / (2 * Math.PI)) * 1.12 + 15, mq.maxR + 35);
    const smooth = (t: number) => {
      const k = Math.min(1, Math.max(0, t));
      return k * k * (3 - 2 * k);
    };
    const others = this.parts.filter((p) => p.piece.role === 'other' || p.piece.role === 'pocket');
    let otherX = -others.reduce((s, p) => s + this.partBox(p).w + 30, 0) / 2;

    for (const p of this.parts) {
      const b = this.partBox(p);
      const uv = p.mesh.uv;
      const out = this.pos;
      const set = (i: number, x: number, y: number, z: number) => {
        const k = 3 * (p.offset + i);
        out[k] = p.copy ? -x : x;
        out[k + 1] = y;
        out[k + 2] = z;
      };
      const role = p.piece.role;
      for (let i = 0; i < p.count; i++) {
        const u = uv[2 * i];
        const v = uv[2 * i + 1];
        switch (role) {
          case 'front':
          case 'back': {
            const th = (u - b.cx) / R;
            const y = top - (b.maxY - v);
            if (role === 'front') set(i, R * Math.sin(th), y, R * Math.cos(th));
            else set(i, -R * Math.sin(th), y, -R * Math.cos(th));
            break;
          }
          case 'hem': {
            // Saumbund vorne oder hinten: unterhalb des Körperteils
            const back = /hinten|back|rück/i.test(p.piece.name) || this.parts.filter((x) => x.piece.role === 'hem').indexOf(p) === 1;
            const th = (u - b.cx) / R;
            const y = top - frontLen - (b.maxY - v) - 8;
            if (back) set(i, -R * Math.sin(th), y, -R * Math.cos(th));
            else set(i, R * Math.sin(th), y, R * Math.cos(th));
            break;
          }
          case 'sleeve':
          case 'cuff': {
            const Rs = (b.w / (2 * Math.PI)) * 1.12 + 12;
            const th = (u - b.cx) / Rs;
            const s = role === 'sleeve' ? -8 + (b.maxY - v) : sleeveLen + 6 + (b.maxY - v);
            const cx = jx + dx * s;
            const cy = jy + dy * s;
            const cz = jz + dz * s;
            // Ring um die Armachse: cos → nach oben/außen, sin → nach vorne
            const co = Rs * Math.cos(th);
            const si = Rs * Math.sin(th);
            set(i, cx + co * e1x + si * e2x, cy + co * e1y + si * e2y, cz + co * e1z + si * e2z);
            break;
          }
          case 'neckband': {
            const W = b.w;
            const Rn = W / (2 * Math.PI) + 10;
            const a = ((u - b.minX) / W) * Math.PI * 2;
            const sec = sectionAt(mq, mq.neckBaseY - 1);
            set(i, -Math.sin(a) * Rn, mq.neckBaseY + 8 + (v - b.minY), (sec?.cz ?? 0) - Math.cos(a) * Rn);
            break;
          }
          case 'placket': {
            // vor dem Schlitz in der vorderen Mitte; obere Leiste außen
            const top0 = /oben|top/i.test(p.piece.name);
            const th = (u - b.cx) / R;
            const y = top - 45 - (b.maxY - v);
            set(i, R * Math.sin(th), y, R * Math.cos(th) + (top0 ? 16 : 8));
            break;
          }
          case 'collar': {
            // Ring um den Hals, Anfang und Ende vorne (überlappen über den Leisten); Kragen über dem Steg,
            // leicht nach außen geneigt, damit er beim Umschlagen nach außen fällt
            const stand = /steg|stand/i.test(p.piece.name);
            const W = b.w;
            const sec = sectionAt(mq, mq.neckBaseY - 1);
            const a = ((u - b.minX) / W) * Math.PI * 2;
            const h0 = v - b.minY;
            const Rn = W / (2 * Math.PI) + 10 + (stand ? 0 : 8 + h0 * 0.35);
            const y = mq.neckBaseY + 8 + (stand ? h0 : 34 + h0 * 0.9);
            set(i, Math.sin(a) * Rn, y, (sec?.cz ?? 0) + Math.cos(a) * Rn);
            break;
          }
          case 'skirtFront':
          case 'skirtBack': {
            const sgn = role === 'skirtFront' ? 1 : -1;
            const y = waistTop - (b.maxY - v);
            const N = p.piece.pleats ?? 0;
            if (N > 0) {
              // Faltenrock: Zickzack um die Hüfte – die Falten sind von Anfang an angelegt, der Bund zieht sie zusammen
              const R0 = mq.maxR + 35;
              const th = ((u - b.cx) / (b.w / 2)) * (Math.PI / 2) * 0.96;
              const pitch = b.w / N;
              const arc = (Math.PI * 0.96 * R0) / N;
              const A = Math.sqrt(Math.max(0, (pitch / 2) ** 2 - (arc / 2) ** 2));
              const ph = ((u - b.minX) / pitch) % 1;
              const r = R0 + A * (1 - Math.abs(2 * ph - 1));
              set(i, sgn * r * Math.sin(th), y, sgn * r * Math.cos(th));
            } else {
              const th = (u - b.cx) / Rskirt;
              set(i, sgn * Rskirt * Math.sin(th), y, sgn * Rskirt * Math.cos(th));
            }
            break;
          }
          case 'legFront':
          case 'legBack': {
            const L = legInfos.get(p.key)!;
            const sgn = L.front ? 1 : -1;
            const y = crotchLevel + (v - L.tipV);
            // unterhalb des Schritts: Röhre um das Bein, zum Saum hin enger
            const tHem = Math.min(1, Math.max(0, (L.tipV - v) / Math.max(1, L.tipV - b.minY)));
            const mid = L.cMid + (L.hMid - L.cMid) * tHem;
            const Rl = (((L.cW + (L.hW - L.cW) * tHem) * 2) / (2 * Math.PI)) * 1.08 + 12;
            const [lx, lz] = legAt(Math.min(y, axTop[1]));
            const a = (u - mid) / Rl;
            const tx = lx + sgn * Rl * Math.sin(a);
            const tz = lz + sgn * Rl * Math.cos(a);
            // oberhalb: Viertelbogen um den Rumpf ab der vorderen/hinteren Mitte
            const th = (u - L.centerU) / Rhip;
            const hx = sgn * Rhip * Math.sin(th);
            const hz = sgn * Rhip * Math.cos(th);
            const w = smooth((v - (L.tipV - 50)) / 110);
            set(i, Math.max(6, tx + (hx - tx) * w), y, tz + (hz - tz) * w);
            break;
          }
          case 'waistband': {
            // Ring um die Taille: rechte Seite → vorne → linke Seite → hinten
            const sec = sectionAt(mq, Math.min(waistTop, mq.sections[mq.sections.length - 1].y));
            const Rw = Math.max(b.w / (2 * Math.PI) + 10, (sec ? Math.max(sec.a, sec.bf, sec.bb) : mq.maxR) + 22);
            const a = ((u - b.minX) / b.w) * Math.PI * 2;
            set(i, -Math.cos(a) * Rw, waistTop + 6 + (v - b.minY), (sec?.cz ?? 0) + Math.sin(a) * Rw);
            break;
          }
          case 'legCuff': {
            // Ring um den Knöchel: Innenbein → vorne → außen → hinten
            const y = legHemY - 6 - (b.maxY - v);
            const [lx, lz] = legAt(Math.max(y, axAnkle[1]));
            const Rc = Math.max(b.w / (2 * Math.PI) + 12, 62);
            const a = ((b.maxX - u) / b.w) * Math.PI * 2;
            set(i, Math.max(6, lx - Math.cos(a) * Rc), y, lz + Math.sin(a) * Rc);
            break;
          }
          case 'hood': {
            const headR = this.ex.body.head / (2 * Math.PI);
            // immer aufgesetzt nähen (der Halsrand muss um den Hals); „abgelegt“ zieht sie danach vom Kopf
            const side = headR * 0.86 + 30;
            const zFace = headR * 1.05 + 25;
            set(i, side, mq.neckBaseY + 5 + (v - b.minY), zFace - (u - b.minX));
            break;
          }
          default: {
            // Freie Teile: nebeneinander vor der Puppe auf Brusthöhe
            const x0 = otherX + b.w / 2;
            set(i, x0 + (u - b.cx), mq.chestY + 150 - (b.maxY - v) + b.h / 2 - 150, R + 80);
          }
        }
      }
      if (role === 'other' || role === 'pocket') {
        otherX += b.w + 30;
      }
    }
    this.restPos.set(this.pos);
  }

  // -------------------------------------------------------------------------
  // Nähte
  // -------------------------------------------------------------------------

  private partFor(pieceId: string, copy: 0 | 1): GarmentPart | undefined {
    return this.parts.find((p) => p.piece.id === pieceId && p.copy === copy) ?? (copy ? undefined : this.parts.find((p) => p.piece.id === pieceId));
  }

  private buildSeams(): void {
    const seen = new Set<string>();
    const list: { a: { piece: string; edge: number; copy: 0 | 1 }; b: { piece: string; edge: number; copy: 0 | 1 }; reversed: boolean }[] = [];
    const key = (a: { piece: string; edge: number; copy: 0 | 1 }) => `${a.piece}/${a.edge}/${a.copy}`;
    const pairs = new Set<string>();
    const push = (s: (typeof list)[number], explicit = false) => {
      const k1 = key(s.a);
      const k2 = key(s.b);
      const pk = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      if (pairs.has(pk)) return;
      // Ausdrückliche Nähte dürfen eine Kante mehrfach nutzen (z. B. beide Knopfleisten am Riegel),
      // gespiegelte Ergänzungen nur freie Kanten
      if (!explicit && (seen.has(k1) || seen.has(k2))) return;
      pairs.add(pk);
      seen.add(k1);
      seen.add(k2);
      list.push(s);
    };
    // Zuerst ausdrücklich angegebene Kopien, dann gespiegelte Ergänzungen für gegengleiche Teile
    for (const s of this.ex.seams) push({ a: { piece: s.a.piece, edge: s.a.edge, copy: s.a.copy ?? 0 }, b: { piece: s.b.piece, edge: s.b.edge, copy: s.b.copy ?? 0 }, reversed: s.reversed }, true);
    const cut = (id: string) => this.ex.pieces.find((p) => p.id === id)?.cut ?? 1;
    for (const s of this.ex.seams) {
      if (s.a.copy || s.b.copy) continue;
      const both2 = cut(s.a.piece) === 2 && cut(s.b.piece) === 2;
      if (!both2) continue;
      push({ a: { piece: s.a.piece, edge: s.a.edge, copy: 1 }, b: { piece: s.b.piece, edge: s.b.edge, copy: 1 }, reversed: s.reversed });
    }
    for (const s of list) {
      const pa = this.partFor(s.a.piece, s.a.copy);
      const pb = this.partFor(s.b.piece, s.b.copy);
      if (!pa || !pb) continue;
      const va = pa.mesh.edgeVerts[s.a.edge];
      const ta = pa.mesh.edgeT[s.a.edge];
      const vb = pb.mesh.edgeVerts[s.b.edge];
      const tb = pb.mesh.edgeT[s.b.edge];
      if (!va || !vb) continue;
      const tB = (t: number) => (s.reversed ? 1 - t : t);
      // Vertices von A auf die Polylinie B und umgekehrt
      const link = (verts: number[], ts: number[], offI: number, overVerts: number[], overTs: number[], offJ: number, map: (t: number) => number) => {
        for (let q = 0; q < verts.length; q++) {
          const t = map(ts[q]);
          let m = 0;
          while (m < overTs.length - 2 && overTs[m + 1] < t) m++;
          const t0 = overTs[m];
          const t1 = overTs[m + 1];
          const w = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
          this.links.push({ i: offI + verts[q], j: offJ + overVerts[m], k: offJ + overVerts[m + 1], w });
        }
      };
      link(va, ta, pa.offset, vb, tb, pb.offset, tB);
      link(vb, tb, pb.offset, va, ta, pa.offset, tB);
    }
  }

  /**
   * Dreiecke so drehen, dass die Vorderseite vom Körper weg zeigt (wichtig für Licht und Innen-/Außenseite),
   * egal wie herum ein Teil gezeichnet oder gespiegelt wurde.
   */
  private orientOutward(): void {
    const c: Contact = { d: 0, nx: 0, ny: 0, nz: 0 };
    const analytic = { ...this.mq, sdf: undefined };
    const p = this.pos;
    for (const part of this.parts) {
      let sum = 0;
      const t = part.tris;
      for (let k = 0; k < t.length; k += 3 * Math.max(1, Math.floor(t.length / 3 / 200))) {
        const a = 3 * t[k];
        const b = 3 * t[k + 1];
        const d = 3 * t[k + 2];
        const ux = p[b] - p[a];
        const uy = p[b + 1] - p[a + 1];
        const uz = p[b + 2] - p[a + 2];
        const vx = p[d] - p[a];
        const vy = p[d + 1] - p[a + 1];
        const vz = p[d + 2] - p[a + 2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const cx = (p[a] + p[b] + p[d]) / 3;
        const cy = (p[a + 1] + p[b + 1] + p[d + 1]) / 3;
        const cz = (p[a + 2] + p[b + 2] + p[d + 2]) / 3;
        if (!bodyContact(analytic, cx, cy, cz, 1e5, c)) continue;
        sum += nx * c.nx + ny * c.ny + nz * c.nz;
      }
      if (sum < 0) {
        for (let k = 0; k < t.length; k += 3) {
          const tmp = t[k + 1];
          t[k + 1] = t[k + 2];
          t[k + 2] = tmp;
        }
      }
    }
  }

  /** Freie Teile, die an keinem Körperteil hängen, oben aufhängen (wie auf einer Stange). */
  private pinLoosePieces(): void {
    const bodyRoles = new Set<PieceRole>(['front', 'back', 'sleeve', 'hood', 'cuff', 'hem', 'neckband', 'collar', 'placket', 'skirtFront', 'skirtBack', 'legFront', 'legBack', 'waistband', 'legCuff']);
    const partOf = (i: number) => this.parts.find((p) => i >= p.offset && i < p.offset + p.count)!;
    // Zusammenhängende Gruppen über Nähte
    const parent = this.parts.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const l of this.links) {
      const a = this.parts.indexOf(partOf(l.i));
      const b = this.parts.indexOf(partOf(l.j));
      parent[find(a)] = find(b);
    }
    const groups = new Map<number, GarmentPart[]>();
    this.parts.forEach((p, i) => {
      const g = find(i);
      groups.set(g, [...(groups.get(g) ?? []), p]);
    });
    this.groupCount = groups.size;
    this.looseGroups = [...groups.values()].filter((g) => !g.some((p) => bodyRoles.has(p.piece.role)));
  }

  /** Partikel der Kapuze (nur wenn sie abgelegt wird) */
  private hoodMask = new Uint8Array(0);
  /** Zugbeschleunigung je Partikel (mm/s²) während des Ziehens */
  private pullAcc = new Float32Array(0);
  private bendCompSoft = new Float32Array(0);
  /** Zeitraum, in dem die Kapuze nach hinten gezogen wird (s) */
  private get hoodPull(): [number, number] {
    return [this.sewTime * 0.95, this.sewTime + 1.1];
  }
  private hasHoodPull(): boolean {
    return this.hoodMask.some((v) => v);
  }

  private looseGroups: GarmentPart[][] = [];
  private groupCount = 0;
  private pinnedDone = false;

  /** Freie Gruppen oben festhalten – erst nach dem Nähen, damit die Nähte sich schließen können. */
  private pinNow(): void {
    this.pinnedDone = true;
    for (const g of this.looseGroups) {
      let maxY = -Infinity;
      for (const p of g) for (let i = 0; i < p.count; i++) maxY = Math.max(maxY, this.pos[3 * (p.offset + i) + 1]);
      for (const p of g)
        for (let i = 0; i < p.count; i++) {
          const k = p.offset + i;
          if (this.pos[3 * k + 1] > maxY - 6) {
            this.pinned[k] = 1;
            this.invMass[k] = 0;
          }
        }
    }
  }

  /** Abstand an jeder Nahtstelle (mm), für Tests und Statistik. */
  seamGaps(): Float32Array {
    return Float32Array.from(this.links, (l) => this.linkDist(l));
  }

  private linkDist(l: SeamLink): number {
    const p = this.pos;
    const w = l.w;
    const tx = p[3 * l.j] * (1 - w) + p[3 * l.k] * w;
    const ty = p[3 * l.j + 1] * (1 - w) + p[3 * l.k + 1] * w;
    const tz = p[3 * l.j + 2] * (1 - w) + p[3 * l.k + 2] * w;
    return Math.hypot(p[3 * l.i] - tx, p[3 * l.i + 1] - ty, p[3 * l.i + 2] - tz);
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  /** Simuliert `dt` Sekunden (in `substeps` kleinen Schritten). */
  step(dt = 1 / 60): void {
    if (this.stats.settled && !this.live) return;
    const liveNow = this.live && this.stats.settled;
    this.liveNow = liveNow;
    const n = this.substeps;
    const h = dt / n;
    this.updatePose(dt);
    if (!this.anchorIdx && this.t >= this.sewTime + 0.5 && !this.posed) this.captureAnchors();
    this.updateAnchors();
    if (liveNow) this.updateWind();
    const sew = Math.min(1, this.t / this.sewTime);
    // Schwerkraft erst, wenn die Nähte fast geschlossen sind
    const gFactor =
      this.t < this.sewTime * 0.7
        ? 0
        : Math.min(1, (this.t - this.sewTime * 0.7) / (this.sewTime * 0.6)) * (this.looseGroups.length && !this.pinnedDone && this.looseGroups.length === this.groupCount ? 0 : 1);
    // Nach dem Fallen zunehmend dämpfen (Luftwiderstand), damit der Stoff zur Ruhe kommt
    const late = Math.min(1, Math.max(0, (this.t - this.lateFrom) / 2));
    const damp = this.t < this.sewTime ? -1 : late * 0.12;
    if (sew >= 1 && !this.pinnedDone) this.pinNow();
    if (!this.frameStart || this.frameStart.length !== this.pos.length) this.frameStart = new Float32Array(this.pos.length);
    this.frameStart.set(this.pos);
    // Kapuze abgelegt: kurz nach hinten und unten ziehen, wie wenn man sie vom Kopf streift
    const [p0, p1] = this.hoodPull;
    const pull = this.hasHoodPull() && this.t >= p0 && this.t < p1 ? Math.sin(((this.t - p0) / (p1 - p0)) * Math.PI) : 0;
    this.pull = pull;
    for (let s = 0; s < n; s++) {
      this.subIndex = s;
      this.substep(h, sew, gFactor, damp);
    }
    this.posed = this.posedNext;
    this.t += dt;
    this.updateStats(dt);
  }

  private pull = 0;

  private substep(h: number, sew: number, gFactor: number, damp: number): void {
    const { pos, prev, invMass, drag, hoodMask } = this;
    const N = this.n;
    const gdy = -G * gFactor * h * h;
    const pk = this.pull * h * h;
    const acc = this.pullAcc;
    const live = this.liveNow;
    const wind = live && this.wind > 0 ? h * h : 0;
    const windAcc = this.windAcc;
    for (let i = 0; i < N; i++) {
      if (invMass[i] === 0) continue;
      const k = 3 * i;
      // Während des Nähens kräftig gedämpft, danach Luftwiderstand je Stoff; live nur der echte Luftwiderstand,
      // damit der Stoff nachschwingt
      const f = 1 - (live ? (2.2 + 55 * drag[i]) * h : damp < 0 ? 0.12 : Math.min(0.3, drag[i] + damp));
      const vx = (pos[k] - prev[k]) * f;
      const vy = (pos[k + 1] - prev[k + 1]) * f;
      const vz = (pos[k + 2] - prev[k + 2]) * f;
      prev[k] = pos[k];
      prev[k + 1] = pos[k + 1];
      prev[k + 2] = pos[k + 2];
      pos[k] += vx;
      pos[k + 1] += vy + gdy;
      pos[k + 2] += vz;
      if (this.pull > 0 && hoodMask[i]) {
        pos[k] += acc[k] * pk;
        pos[k + 1] += acc[k + 1] * pk;
        pos[k + 2] += acc[k + 2] * pk;
      }
      if (wind) {
        pos[k] += windAcc[i] * wind;
        pos[k + 2] += windAcc[i] * wind * 0.3;
      }
    }
    // Bund: Gummizug zurück an seine Stelle am Körper (2 mm Spiel)
    const aIdx = this.anchorIdx;
    if (aIdx && aIdx.length) {
      const al = (this.subIndex + 1) / this.substeps;
      const { anchorFrom: A0, anchorTo: A1 } = this;
      for (let q = 0; q < aIdx.length; q++) {
        const k = 3 * aIdx[q];
        const dx = A0[3 * q] + (A1[3 * q] - A0[3 * q]) * al - pos[k];
        const dy = A0[3 * q + 1] + (A1[3 * q + 1] - A0[3 * q + 1]) * al - pos[k + 1];
        const dz = A0[3 * q + 2] + (A1[3 * q + 2] - A0[3 * q + 2]) * al - pos[k + 2];
        const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (L < 2) continue;
        const m = ((L - 2) * 0.25) / L;
        pos[k] += dx * m;
        pos[k + 1] += dy * m;
        pos[k + 2] += dz * m;
      }
    }
    // Angefasster Stoff folgt dem Griffpunkt (begrenzter Zug)
    if (this.grabIdx.length) {
      const [gx, gy, gz] = this.grabTarget;
      for (let q = 0; q < this.grabIdx.length; q++) {
        const k = 3 * this.grabIdx[q];
        const dx = gx + this.grabOff[3 * q] - pos[k];
        const dy = gy + this.grabOff[3 * q + 1] - pos[k + 1];
        const dz = gz + this.grabOff[3 * q + 2] - pos[k + 2];
        const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (L < 1e-6) continue;
        const m = (Math.min(Math.min(L, 90) * 0.08, 3.2) * this.grabW[q]) / L;
        pos[k] += dx * m;
        pos[k + 1] += dy * m;
        pos[k + 2] += dz * m;
      }
    }
    // Dehnung
    this.solveDistance(this.edges, this.edgeRest, this.edgeComp, 0.15);
    // Nähte (Ruhelänge schrumpft während des Nähens auf 0)
    this.solveSeams(sew);
    if (sew >= 1) this.solveSeams(sew);
    // Biegung
    const soft = this.hasHoodPull() && this.t >= this.hoodPull[0] && this.t < this.hoodPull[1] + 0.4;
    this.solveDistance(this.bends, this.bendRest, soft ? this.bendCompSoft : this.bendComp, 1);
    if (sew >= 1) this.solveSeams(sew);
    // Stoff gegen Stoff – erst wenn er fällt (beim Nähen liegen die Kanten absichtlich übereinander)
    // (live nur in jedem dritten Teilschritt: hält die Echtzeit, die Lagen liegen bereits geordnet)
    if (this.selfCollision && gFactor > 0 && (!live || this.subCount++ % 3 === 0)) {
      this.buildHash();
      this.solveSelf();
    }
    // Kollision mit der Puppe und dem Boden
    this.collide();
    // Nähte zum Schluss noch einmal nachziehen (sonst gewinnen Kollision und Stoffspannung an Nahtecken)
    if (sew >= 1) this.solveSeams(sew);
  }

  private solveDistance(idx: Uint32Array, rest: Float32Array, comp: Float32Array, compressK: number): void {
    const { pos, invMass } = this;
    for (let e = 0; e < rest.length; e++) {
      const a = idx[2 * e];
      const b = idx[2 * e + 1];
      const wa = invMass[a];
      const wb = invMass[b];
      const w = wa + wb;
      if (w === 0) continue;
      const ka = 3 * a;
      const kb = 3 * b;
      const dx = pos[kb] - pos[ka];
      const dy = pos[kb + 1] - pos[ka + 1];
      const dz = pos[kb + 2] - pos[ka + 2];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-9) continue;
      const C = L - rest[e];
      // Stauchen fast unnachgiebig (Stoff wirft lieber Falten), Dehnen je nach Stoff
      const alpha = C < 0 ? comp[e] * compressK : comp[e];
      const lambda = -C / (w + alpha);
      const sx = (dx / L) * lambda;
      const sy = (dy / L) * lambda;
      const sz = (dz / L) * lambda;
      pos[ka] -= sx * wa;
      pos[ka + 1] -= sy * wa;
      pos[ka + 2] -= sz * wa;
      pos[kb] += sx * wb;
      pos[kb + 1] += sy * wb;
      pos[kb + 2] += sz * wb;
    }
  }

  private solveSeams(sew: number): void {
    const { pos, invMass } = this;
    const shrink = 1 - sew;
    for (let l = 0; l < this.links.length; l++) {
      const { i, j, k, w } = this.links[l];
      const rest = this.linkRest0[l] * shrink;
      const wi = invMass[i];
      const wj = invMass[j] * (1 - w) * (1 - w);
      const wk = invMass[k] * w * w;
      const W = wi + wj + wk;
      if (W === 0) continue;
      const tx = pos[3 * j] * (1 - w) + pos[3 * k] * w;
      const ty = pos[3 * j + 1] * (1 - w) + pos[3 * k + 1] * w;
      const tz = pos[3 * j + 2] * (1 - w) + pos[3 * k + 2] * w;
      const dx = pos[3 * i] - tx;
      const dy = pos[3 * i + 1] - ty;
      const dz = pos[3 * i + 2] - tz;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-9 || L <= rest) continue;
      const C = L - rest;
      // während des Nähens weich, danach fest
      const stiff = sew < 1 ? 0.35 : 1;
      const lambda = (-C / W) * stiff;
      const nx = dx / L;
      const ny = dy / L;
      const nz = dz / L;
      pos[3 * i] += nx * lambda * wi;
      pos[3 * i + 1] += ny * lambda * wi;
      pos[3 * i + 2] += nz * lambda * wi;
      const fj = -lambda * invMass[j] * (1 - w);
      const fk = -lambda * invMass[k] * w;
      pos[3 * j] += nx * fj;
      pos[3 * j + 1] += ny * fj;
      pos[3 * j + 2] += nz * fj;
      pos[3 * k] += nx * fk;
      pos[3 * k + 1] += ny * fk;
      pos[3 * k + 2] += nz * fk;
    }
  }

  private frameStart: Float32Array | null = null;
  private contact: Contact = { d: 0, nx: 0, ny: 0, nz: 0 };

  private collide(): void {
    const { pos, prev, invMass, gap } = this;
    const c = this.contact;
    if (this.posed) return this.collidePosed();
    for (let i = 0; i < this.n; i++) {
      if (invMass[i] === 0) continue;
      const th = this.thick[i];
      const k = 3 * i;
      const hit = bodyContact(this.mq, pos[k], pos[k + 1], pos[k + 2], 40, c);
      gap[i] = hit ? c.d : 40;
      if (hit && c.d < th) {
        const push = th - c.d;
        pos[k] += c.nx * push;
        pos[k + 1] += c.ny * push;
        pos[k + 2] += c.nz * push;
        // Reibung: Tangentialbewegung bremsen
        const mu = this.friction[i];
        const vx = pos[k] - prev[k];
        const vy = pos[k + 1] - prev[k + 1];
        const vz = pos[k + 2] - prev[k + 2];
        const vn = vx * c.nx + vy * c.ny + vz * c.nz;
        const tx = vx - vn * c.nx;
        const ty = vy - vn * c.ny;
        const tz = vz - vn * c.nz;
        prev[k] += tx * mu;
        prev[k + 1] += ty * mu;
        prev[k + 2] += tz * mu;
        // Haftreibung: drückt der Stoff fest genug an, bleibt er an der Stelle (Coulomb)
        const gr = this.grip[i];
        if (gr > 0 && tx * tx + ty * ty + tz * tz < (gr * push) ** 2) {
          pos[k] -= tx;
          pos[k + 1] -= ty;
          pos[k + 2] -= tz;
          prev[k] += tx * (1 - mu);
          prev[k + 1] += ty * (1 - mu);
          prev[k + 2] += tz * (1 - mu);
        }
        gap[i] = th;
      }
      if (pos[k + 1] < th) pos[k + 1] = th;
    }
  }

  /**
   * Kollision mit der bewegten Puppe: jeder Partikel wird über „seine“ Knochen in die Ruhehaltung zurückgerechnet
   * (zwischen Anfang und Ende des Bildschritts interpoliert), dort gegen das Abstandsfeld geprüft und die Korrektur
   * zurückgedreht. Die Reibung wirkt relativ zur Bewegung des Körpers – der Stoff wird mitgenommen.
   */
  private collidePosed(): void {
    const { pos, prev, invMass, gap, inv0, inv1 } = this;
    const c = this.contact;
    const al = (this.subIndex + 1) / this.substeps;
    const inv = 1 / this.substeps;
    for (let i = 0; i < this.n; i++) {
      if (invMass[i] === 0) continue;
      const th = this.thick[i];
      const k = 3 * i;
      const o = 12 * i;
      const x = pos[k];
      const y = pos[k + 1];
      const z = pos[k + 2];
      const ax = inv0[o] * x + inv0[o + 1] * y + inv0[o + 2] * z + inv0[o + 3];
      const ay = inv0[o + 4] * x + inv0[o + 5] * y + inv0[o + 6] * z + inv0[o + 7];
      const az = inv0[o + 8] * x + inv0[o + 9] * y + inv0[o + 10] * z + inv0[o + 11];
      const bx = inv1[o] * x + inv1[o + 1] * y + inv1[o + 2] * z + inv1[o + 3];
      const by = inv1[o + 4] * x + inv1[o + 5] * y + inv1[o + 6] * z + inv1[o + 7];
      const bz = inv1[o + 8] * x + inv1[o + 9] * y + inv1[o + 10] * z + inv1[o + 11];
      const hit = bodyContact(this.mq, ax + (bx - ax) * al, ay + (by - ay) * al, az + (bz - az) * al, 40, c);
      gap[i] = hit ? c.d : 40;
      if (hit && c.d < th) {
        // Normale zurück in die Haltung drehen (Transponierte des Drehanteils)
        let nx = inv1[o] * c.nx + inv1[o + 4] * c.ny + inv1[o + 8] * c.nz;
        let ny = inv1[o + 1] * c.nx + inv1[o + 5] * c.ny + inv1[o + 9] * c.nz;
        let nz = inv1[o + 2] * c.nx + inv1[o + 6] * c.ny + inv1[o + 10] * c.nz;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const push = th - c.d;
        pos[k] += nx * push;
        pos[k + 1] += ny * push;
        pos[k + 2] += nz * push;
        // Bewegung des Körpers an dieser Stelle in diesem Teilschritt
        const rx = (ax - bx) * inv;
        const ry = (ay - by) * inv;
        const rz = (az - bz) * inv;
        const mx = inv1[o] * rx + inv1[o + 4] * ry + inv1[o + 8] * rz;
        const my = inv1[o + 1] * rx + inv1[o + 5] * ry + inv1[o + 9] * rz;
        const mz = inv1[o + 2] * rx + inv1[o + 6] * ry + inv1[o + 10] * rz;
        const mu = this.friction[i];
        const vx = pos[k] - prev[k] - mx;
        const vy = pos[k + 1] - prev[k + 1] - my;
        const vz = pos[k + 2] - prev[k + 2] - mz;
        const vn = vx * nx + vy * ny + vz * nz;
        const tx = vx - vn * nx;
        const ty = vy - vn * ny;
        const tz = vz - vn * nz;
        prev[k] += tx * mu;
        prev[k + 1] += ty * mu;
        prev[k + 2] += tz * mu;
        // Haftreibung: der Bund geht mit dem Körper mit
        const gr = this.grip[i];
        if (gr > 0 && tx * tx + ty * ty + tz * tz < (gr * push) ** 2) {
          pos[k] -= tx;
          pos[k + 1] -= ty;
          pos[k + 2] -= tz;
          prev[k] += tx * (1 - mu);
          prev[k + 1] += ty * (1 - mu);
          prev[k + 2] += tz * (1 - mu);
        }
        gap[i] = th;
      }
      if (pos[k + 1] < th) pos[k + 1] = th;
    }
  }

  private updateStats(dt: number): void {
    let maxGap = 0;
    if (this.t >= this.sewTime) for (const l of this.links) maxGap = Math.max(maxGap, this.linkDist(l));
    else maxGap = Infinity;
    let v = 0;
    let inside = 0;
    const f0 = this.frameStart!;
    for (let i = 0; i < this.n; i++) {
      const k = 3 * i;
      // Bewegung über den ganzen Bildschritt: Zittern zwischen Teilschritten hebt sich auf
      v += Math.hypot(this.pos[k] - f0[k], this.pos[k + 1] - f0[k + 1], this.pos[k + 2] - f0[k + 2]);
      if (this.gap[i] < -2) inside++;
    }
    const speed = this.n ? v / this.n / dt : 0;
    if (this.liveNow) {
      this.stats = { time: this.t, seamGap: maxGap, speed, inside, settled: true, live: true, overlaps: this.stats.overlaps };
      return;
    }
    if (this.t > this.calmFrom && speed < 6 && !this.posed) this.settledFor += dt;
    else this.settledFor = 0;
    const settled = this.settledFor > 0.4 || this.t > this.forceAt;
    this.stats = { time: this.t, seamGap: maxGap, speed, inside, settled };
    if (settled) {
      this.computeStrain();
      if (this.selfCollision) this.stats.overlaps = this.selfOverlaps();
    }
  }

  /** Dehnung je Partikel (für die Passform-Karte). */
  computeStrain(): void {
    const s = this.strain;
    s.fill(0);
    const cnt = new Float32Array(this.n);
    const p = this.pos;
    for (let e = 0; e < this.edgeRest.length; e++) {
      const a = this.edges[2 * e];
      const b = this.edges[2 * e + 1];
      const L = Math.hypot(p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]);
      const r = L / this.edgeRest[e] - 1;
      s[a] += r;
      s[b] += r;
      cnt[a]++;
      cnt[b]++;
    }
    for (let i = 0; i < this.n; i++) if (cnt[i]) s[i] /= cnt[i];
    // Glätten (zwei Durchgänge über die Kanten), damit einzelne Ausreißer keine Flecken machen
    for (let pass = 0; pass < 2; pass++) {
      const acc = Float32Array.from(s);
      const num = new Float32Array(this.n).fill(1);
      for (let e = 0; e < this.edgeRest.length; e++) {
        const a = this.edges[2 * e];
        const b = this.edges[2 * e + 1];
        acc[a] += s[b];
        acc[b] += s[a];
        num[a]++;
        num[b]++;
      }
      for (let i = 0; i < this.n; i++) s[i] = acc[i] / num[i];
    }
  }

  /** Bis zum Ruhezustand rechnen (für Tests und Bildexport ohne Animation). */
  run(maxTime = 8): SimStats {
    while (!this.stats.settled && this.t < maxTime) this.step();
    this.computeStrain();
    return this.stats;
  }
}
