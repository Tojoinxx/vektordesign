import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { seamPairs, smoothAttr, smoothFill, smoothTopology, vertexNormals, type SmoothTopology } from './smooth';
import type { PatternMaterial, SketchDoc, Variant } from '../model/types';
import { patternExchange, type ExchangePiece, type PatternExchange } from '../pattern/exchange';
import { applyVariant, motifDoc, motifSize, productionOf } from '../model/production';
import { drawDesign } from '../render/drawDesign';
import type { SimOptions, SimStats } from '../sim3d/garment';
import { buildMannequin, mannequinMesh, type Mannequin } from '../sim3d/body';
import { buildHuman, humanMannequin, type HumanData, type HumanMesh } from '../sim3d/human';
import { loadHumanData } from '../sim3d/humanLoader';
import type { FromWorker, LayoutPart, ToWorker } from '../sim3d/protocol';
import { SimRunner } from '../sim3d/runner';
import { avatarBody, genderOfSize } from '../sim3d/avatar';
import { bodyForSize } from '../pattern/body';
import { fabricLook, fabricNormalMap, fabricTileMm } from './textures';

/**
 * 3D-Ansicht: Puppe aus den Körpermaßen, simuliertes Kleidungsstück mit Stoffart, Farbe je Teil und
 * Motiven an ihrer Druckposition, optional als Passform-Karte. Die Stoffsimulation läuft in einem Worker
 * (Rückfall: Hauptthread in Zeitscheiben). Wird vom Hauptprogramm (Vorschau rechts) und von
 * „Vektordesign 3D“ benutzt.
 */

export type ViewMode = 'look' | 'fit';
export type CameraView = 'front' | 'back' | 'left' | 'right' | 'free';

export interface ViewerOptions {
  mode: ViewMode;
  showBody: boolean;
  /** Farbvariante aus der Produktion (null = Originalfarben) */
  variantId: string | null;
  quality: 'preview' | 'high';
  dark: boolean;
  /** Kapuze aufgesetzt (sonst auf dem Rücken abgelegt) */
  hoodUp?: boolean;
}

export interface ViewerEvents {
  onPick?: (pieceId: string | null) => void;
  onStatus?: (s: ViewerStatus) => void;
}

export interface ViewerStatus {
  state: 'empty' | 'simulating' | 'ready' | 'error';
  stats: SimStats | null;
  message?: string;
  parts: number;
  vertices: number;
}

interface ViewPart extends LayoutPart {
  piece: ExchangePiece;
  material: PatternMaterial | null;
  box: { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number; cx: number };
  /** Glatte Darstellung (vierfach unterteilt) */
  topo: SmoothTopology;
  /** Farbe je grobem Partikel (Passform-Karte bzw. Nahtschatten) */
  colors: Float32Array;
}

const BODY_COLOR = '#d8d2c8';
export const DEFAULT_SKIN = '#d9a283';
const UNDERWEAR = '#2b2f36';

/** Treiber der Simulation: Worker, sonst Hauptthread. */
class Driver {
  private worker: Worker | null = null;
  private local: SimRunner | null = null;
  constructor(private onMessage: (m: FromWorker) => void) {
    try {
      this.worker = new Worker(new URL('../sim3d/worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
      this.worker.onerror = (e) => {
        e.preventDefault();
        this.fallback();
      };
    } catch {
      this.fallback();
    }
  }
  private lastStart: ToWorker | null = null;
  private fallback(): void {
    this.worker?.terminate();
    this.worker = null;
    if (!this.local) this.local = new SimRunner((m) => this.onMessage(m), 14);
    if (this.lastStart?.type === 'start') this.local.start(this.lastStart.id, this.lastStart.ex, this.lastStart.opts);
  }
  start(id: number, ex: PatternExchange, opts: SimOptions): void {
    this.lastStart = { type: 'start', id, ex, opts };
    if (this.worker) this.worker.postMessage(this.lastStart);
    else this.local?.start(id, ex, opts);
  }
  stop(): void {
    this.worker?.postMessage({ type: 'stop' } satisfies ToWorker);
    this.local?.stop();
  }
  dispose(): void {
    this.stop();
    this.worker?.terminate();
  }
}

export class GarmentViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private bodyMesh: THREE.Mesh | null = null;
  private garment = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh>();
  private parts: ViewPart[] = [];
  private mq: Mannequin | null = null;
  private driver: Driver;
  private runId = 0;
  private simKey = '';
  private doc: SketchDoc | null = null;
  private ex: PatternExchange | null = null;
  private frame = 0;
  private dirty = true;
  private selected: string | null = null;
  private ro: ResizeObserver;
  private floor: THREE.Mesh;
  private motifTextures: THREE.Texture[] = [];
  private pending: Float32Array | null = null;
  private gap: Float32Array | null = null;
  private strain: Float32Array | null = null;
  private n = 0;
  /** Normalen aller Partikel (grob), über Nähte gemittelt */
  private normals = new Float32Array(0);
  /** Nahtpaare (global), erst wenn der Stoff liegt */
  private seams: Uint32Array | null = null;
  private composer: EffectComposer | null = null;
  private aoPass: GTAOPass | null = null;
  /** Umgebungsverdeckung in Falten – nur im Ruhezustand (spart Rechenzeit während der Stoff fällt) */
  private aoOn = false;
  stats: SimStats | null = null;
  /** Menschen-Modell: undefined = lädt noch, null = nicht verfügbar (einfache Puppe) */
  private humanData: HumanData | null | undefined = undefined;
  private human: HumanMesh | null = null;
  private bodyKey = '';
  private eyesMesh: THREE.Mesh | null = null;
  opts: ViewerOptions = { mode: 'look', showBody: true, variantId: null, quality: 'preview', dark: false };

  constructor(
    readonly container: HTMLElement,
    private events: ViewerEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const el = this.renderer.domElement;
    el.style.display = 'block';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.touchAction = 'none';
    container.appendChild(el);
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new THREE.PerspectiveCamera(28, 1, 20, 30000);
    this.camera.position.set(0, 1250, 3600);
    this.controls = new OrbitControls(this.camera, el);
    this.controls.target.set(0, 1150, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 400;
    this.controls.maxDistance = 9000;
    this.controls.maxPolarAngle = Math.PI * 0.53;
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.controls.addEventListener('start', () => (this.userMoved = true));

    // Licht wie im Fotostudio: Studio-Umgebung (weiche Reflexe von allen Seiten), Hauptlicht schräg vorne,
    // Kante von hinten
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.55;
      pmrem.dispose();
    } catch {
      /* ohne Umgebung: nur Lichter */
    }
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(-1400, 2600, 2200);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -1100, right: 1100, top: 2200, bottom: -400, near: 500, far: 7000 });
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 7;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 1.1);
    rim.position.set(1800, 1800, -2400);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(2200, 900, 1500);
    this.scene.add(fill);

    this.floor = new THREE.Mesh(new THREE.CircleGeometry(1100, 64), new THREE.ShadowMaterial({ opacity: 0.16 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    this.scene.add(this.garment);
    this.applyTheme();
    try {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.aoPass = new GTAOPass(this.scene, this.camera, 1, 1);
      // Radius in Weltmaß (mm): Falten und Achseln, nicht der ganze Körper
      this.aoPass.updateGtaoMaterial({ radius: 60, distanceExponent: 1.5, thickness: 8, scale: 1.1, samples: 16 });
      this.aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.aoPass.blendIntensity = 0.85;
      this.composer.addPass(this.aoPass);
      this.composer.addPass(new OutputPass());
    } catch {
      this.composer = null;
      this.aoPass = null;
    }

    this.driver = new Driver((m) => this.onSim(m));
    void loadHumanData().then((d) => {
      this.humanData = d;
      if (this.doc) {
        this.simKey = '';
        this.bodyKey = '';
        this.setDoc(this.doc, true);
      }
    });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.bindPicking();
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      this.tick();
    };
    this.frame = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.driver.dispose();
    this.ro.disconnect();
    this.controls.dispose();
    this.clearGarment();
    this.composer?.dispose();
    this.aoPass?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  setOptions(p: Partial<ViewerOptions>): void {
    const prev = this.opts;
    this.opts = { ...prev, ...p };
    if (p.dark !== undefined && p.dark !== prev.dark) this.applyTheme();
    if (p.showBody !== undefined) for (const m of [this.bodyMesh, this.eyesMesh]) if (m) m.visible = this.opts.showBody;
    const qualityChanged = (p.quality !== undefined && p.quality !== prev.quality) || (p.hoodUp !== undefined && p.hoodUp !== prev.hoodUp);
    if (qualityChanged) this.simKey = '';
    if (this.doc && (qualityChanged || (p.mode !== undefined && p.mode !== prev.mode) || (p.variantId !== undefined && p.variantId !== prev.variantId))) this.setDoc(this.doc, true);
    this.dirty = true;
  }

  select(pieceId: string | null): void {
    if (pieceId === this.selected) return;
    this.selected = pieceId;
    this.updateMaterials();
  }

  private applyTheme(): void {
    this.scene.background = new THREE.Color(this.opts.dark ? '#1d2126' : '#eceef0');
    this.dirty = true;
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
    const before = this.camera.aspect;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved && Math.abs(before - this.camera.aspect) > 0.05) this.frameCamera();
    this.dirty = true;
  }
  private userMoved = false;

  /** Neuer Stand der Zeichnung. Simuliert nur neu, wenn sich Schnitt, Nähte, Maße oder Stoffart geändert haben. */
  setDoc(doc: SketchDoc, force = false): void {
    if (doc === this.doc && !force) return;
    this.doc = doc;
    if (this.humanData === undefined) {
      this.status({ state: 'simulating', stats: null, parts: 0, vertices: 0, message: 'Puppe wird geladen …' });
      return;
    }
    const ex = patternExchange(doc);
    this.ex = ex;
    const skin = doc.pattern?.avatar?.skin ?? DEFAULT_SKIN;
    if (!ex) {
      this.driver.stop();
      this.clearGarment();
      this.parts = [];
      this.simKey = '';
      this.stats = null;
      const av = doc.pattern?.avatar;
      this.setBody(av ? avatarBody(av) : (doc.pattern?.body ?? bodyForSize('H-M')), av?.gender ?? genderOfSize(doc.pattern?.bodySize ?? 'H-M'), av?.build ?? 0, skin);
      this.status({ state: 'empty', stats: null, parts: 0, vertices: 0, message: 'Noch keine Schnittteile. Im Tab „Schnitt“ einen Grundschnitt erzeugen oder Teile anlegen.' });
      return;
    }
    const key = JSON.stringify([
      ex.body,
      ex.gender,
      ex.pieces.map((p) => [p.id, p.role, p.cut, p.material, p.polygon, p.edges.map((e) => [e.from, e.to])]),
      ex.seams.map((s) => [s.a, s.b, s.reversed]),
      ex.materials.map((m) => [m.id, m.fabric, m.gsm]),
      this.opts.quality,
      !!this.opts.hoodUp,
    ]);
    if (key !== this.simKey) {
      this.simKey = key;
      const bodyChanged = !this.bodyKey.startsWith(JSON.stringify([ex.body, ex.gender, ex.build, !!this.humanData]).slice(0, -1));
      this.setBody(ex.body, ex.gender, ex.build, skin);
      this.stats = null;
      this.gap = this.strain = null;
      this.runId++;
      const human = this.human ?? undefined;
      const hood = this.opts.hoodUp ? 'up' : 'down';
      this.driver.start(this.runId, ex, this.opts.quality === 'high' ? { resolution: 15, substeps: 12, human, hood } : { resolution: 22, substeps: 9, human, hood });
      this.status({ state: 'simulating', stats: null, parts: this.parts.length, vertices: this.n });
      if (bodyChanged || !this.parts.length) this.frameCamera();
    } else {
      // Nur Aussehen geändert: Teile behalten ihre Lage
      this.setBody(ex.body, ex.gender, ex.build, skin);
      for (const part of this.parts) this.bindPart(part);
      this.updateMaterials();
    }
    this.dirty = true;
  }

  /** Simulation neu starten (gleiche Teile). */
  resimulate(): void {
    this.simKey = '';
    if (this.doc) this.setDoc(this.doc, true);
  }

  private bindPart(part: ViewPart): void {
    const ex = this.ex;
    if (!ex) return;
    const fresh = ex.pieces.find((p) => p.id === part.pieceId);
    if (fresh) part.piece = fresh;
    part.material = ex.materials.find((m) => m.id === part.piece.material) ?? ex.materials[0] ?? null;
  }

  private onSim(m: FromWorker): void {
    if (m.id !== this.runId) return;
    if (m.type === 'error') {
      this.status({ state: 'error', stats: null, parts: 0, vertices: 0, message: m.message });
      return;
    }
    if (m.type === 'layout') {
      this.n = m.n;
      this.seams = null;
      this.aoOn = false;
      this.normals = new Float32Array(m.n * 3);
      this.parts = m.parts.map((lp) => {
        const local = new Uint32Array(lp.tris.length);
        for (let t = 0; t < local.length; t++) local[t] = lp.tris[t] - lp.offset;
        const part = {
          ...lp,
          piece: null as unknown as ExchangePiece,
          material: null,
          box: uvBox(lp.uv, lp.count),
          topo: smoothTopology(local, lp.count),
          colors: new Float32Array(lp.count * 3).fill(1),
        } as ViewPart;
        this.bindPart(part);
        return part;
      });
      this.buildMeshes();
      this.updateMaterials();
      return;
    }
    this.pending = m.pos;
    this.stats = m.stats;
    if (m.gap) this.gap = m.gap;
    if (m.strain) this.strain = m.strain;
    this.status({ state: m.stats.settled ? 'ready' : 'simulating', stats: m.stats, parts: this.parts.length, vertices: this.n });
    if (m.stats.settled) {
      // Nähte erkennen (Randpartikel verschiedener Teile, die aufeinander liegen): Normalen mitteln, Nahtschatten
      this.seams = seamPairs(
        m.pos,
        this.parts.map((p) => ({ offset: p.offset, count: p.count, boundary: p.topo.boundary })),
        12,
      );
      this.aoOn = true;
      this.updateLookColors();
    }
    if (m.stats.settled && this.opts.mode === 'fit') this.updateFitColors();
  }

  private setBody(body: PatternExchange['body'] | null, gender: 'male' | 'female' = 'male', build = 0, skin = DEFAULT_SKIN): void {
    const key = JSON.stringify([body, gender, build, !!this.humanData, skin]);
    if (key === this.bodyKey && this.bodyMesh) return;
    this.bodyKey = key;
    for (const m of [this.bodyMesh, this.eyesMesh]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.bodyMesh = this.eyesMesh = null;
    this.human = null;
    this.mq = null;
    if (!body) return;
    if (this.humanData) {
      this.human = buildHuman(this.humanData, body, gender, build);
      this.mq = humanMannequin(body, gender, this.human);
      this.buildHumanMeshes(this.human, this.mq, skin);
    } else {
      this.mq = buildMannequin(body, gender);
      // Etwas kleiner zeichnen als die Kollision: Stoff liegt sichtbar auf, nichts sticht durch
      const data = mannequinMesh(this.mq, 4);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      g.setIndex(data.indices);
      g.computeVertexNormals();
      this.bodyMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.55, metalness: 0 }));
    }
    for (const m of [this.bodyMesh, this.eyesMesh]) {
      if (!m) continue;
      m.castShadow = true;
      m.receiveShadow = true;
      m.visible = this.opts.showBody;
      this.scene.add(m);
    }
    this.dirty = true;
  }

  /** Menschen-Netz mit Haut, schlichter Unterwäsche (wie bei Anprobe-Avataren) und Augen. */
  private buildHumanMeshes(h: HumanMesh, mq: Mannequin, skin: string): void {
    const g = new THREE.BufferGeometry();
    const pos = Float32Array.from(h.positions);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(h.body, 1));
    g.computeVertexNormals();
    // 5 mm nach innen versetzt zeichnen: der Stoff liegt sichtbar auf, kleine Formen stechen nicht durch
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < pos.length / 3; i++) {
      pos[3 * i] -= nrm.getX(i) * 5;
      pos[3 * i + 1] -= nrm.getY(i) * 5;
      pos[3 * i + 2] -= nrm.getZ(i) * 5;
    }
    // Unterwäsche als Vertex-Farbe (Weiß = Haut, Dunkel = Stoff)
    const m = mq.measures;
    const neckBase = mq.neckBaseY;
    const waistY = neckBase - m.backLength;
    const hipY = waistY - m.height * (mq.gender === 'female' ? 0.11 : 0.105);
    const chestY = neckBase - m.backLength * (mq.gender === 'female' ? 0.52 : 0.5);
    const shX = Math.abs(h.joints['l-shoulder'][0]) * 0.92;
    const col = new Float32Array(pos.length).fill(1);
    const cloth = new THREE.Color(UNDERWEAR).convertSRGBToLinear();
    const skinC = new THREE.Color(skin).convertSRGBToLinear();
    const k = (c: number, s: number) => c / Math.max(0.02, s);
    for (let i = 0; i < pos.length / 3; i++) {
      const x = h.positions[3 * i];
      const y = h.positions[3 * i + 1];
      // weiche Kanten (über ca. 12 mm), damit die Ränder nicht ausfransen
      const band = (lo: number, hi: number) => Math.max(0, Math.min(1, (y - lo) / 12 + 0.5, (hi - y) / 12 + 0.5));
      const briefs = Math.abs(x) < shX * 1.3 ? band(mq.crotchY - 70, hipY + (waistY - hipY) * 0.35) : 0;
      const top = mq.gender === 'female' && Math.abs(x) < shX ? band(chestY - 85, chestY + 55) : 0;
      const w = Math.max(briefs, top);
      if (w > 0) {
        col[3 * i] = 1 + (k(cloth.r, skinC.r) - 1) * w;
        col[3 * i + 1] = 1 + (k(cloth.g, skinC.g) - 1) * w;
        col[3 * i + 2] = 1 + (k(cloth.b, skinC.b) - 1) * w;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    this.bodyMesh = new THREE.Mesh(
      g,
      new THREE.MeshPhysicalMaterial({ color: skin, vertexColors: true, roughness: 0.58, metalness: 0, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(skin), clearcoat: 0.04 }),
    );
    // Augen: weiß mit dunkler Iris nach vorne
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(h.positions, 3));
    eg.setIndex(new THREE.BufferAttribute(h.eyes, 1));
    const ec = new Float32Array(h.positions.length).fill(0.92);
    const ids = new Set(h.eyes);
    let maxZ = -Infinity;
    for (const i of ids) maxZ = Math.max(maxZ, h.positions[3 * i + 2]);
    for (const i of ids) if (h.positions[3 * i + 2] > maxZ - 6) ec[3 * i] = ec[3 * i + 1] = ec[3 * i + 2] = 0.06;
    eg.setAttribute('color', new THREE.BufferAttribute(ec, 3));
    eg.computeVertexNormals();
    this.eyesMesh = new THREE.Mesh(eg, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.15, clearcoat: 1 }));
  }

  private clearGarment(): void {
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.garment.remove(m);
    }
    this.meshes.clear();
    for (const t of this.motifTextures) t.dispose();
    this.motifTextures = [];
  }

  private buildMeshes(): void {
    this.clearGarment();
    for (const part of this.parts) {
      const g = new THREE.BufferGeometry();
      const fineN = part.count + part.topo.edges.length / 2;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fineN * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(fineN * 3), 3));
      const uv0 = new Float32Array(part.count * 2);
      const b = part.box;
      for (let i = 0; i < part.count; i++) {
        uv0[2 * i] = (part.uv[2 * i] - b.minX) / b.w;
        uv0[2 * i + 1] = (part.uv[2 * i + 1] - b.minY) / b.h;
      }
      const uv = new Float32Array(fineN * 2);
      smoothAttr(part.topo, uv0, uv, 2);
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      // Passform-Farben erst, wenn der Stoff liegt – bis dahin neutrales Grau
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(fineN * 3).fill(1), 3));
      g.setIndex(new THREE.BufferAttribute(part.topo.tris, 1));
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.userData = { key: part.key, pieceId: part.pieceId };
      this.meshes.set(part.key, mesh);
      this.garment.add(mesh);
    }
  }

  private variant(): Variant | null {
    if (!this.doc || !this.opts.variantId) return null;
    return productionOf(this.doc).variants.find((v) => v.id === this.opts.variantId) ?? null;
  }

  /** Farben, Stoffe und Motive (ohne neu zu simulieren). */
  private updateMaterials(): void {
    if (!this.doc || !this.parts.length) return;
    for (const t of this.motifTextures) t.dispose();
    this.motifTextures = [];
    const variant = this.variant();
    const mainId = this.ex?.materials[0]?.id;
    for (const part of this.parts) {
      const mesh = this.meshes.get(part.key);
      if (!mesh) continue;
      (mesh.material as THREE.Material).dispose();
      const fabric = part.material?.fabric ?? 'jersey';
      let color = part.piece.color ?? part.material?.color ?? '#8a8f98';
      // Variante: Teile ohne eigene Farbe in der Stofffarbe der Variante (Hauptstoff und Bündchen)
      if (variant && !part.piece.color && (!part.material || part.material.id === mainId || part.material.fabric === 'rib')) color = variant.fabric;
      const isSel = this.selected === part.pieceId;
      const emissive = new THREE.Color(isSel ? '#e8590c' : '#000000');
      if (this.opts.mode === 'fit') {
        mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, emissive, emissiveIntensity: isSel ? 0.25 : 0 });
        continue;
      }
      const look = fabricLook(fabric);
      const b = part.box;
      const normal = fabricNormalMap(fabric).clone();
      normal.needsUpdate = true;
      const tile = fabricTileMm(fabric);
      normal.repeat.set(b.w / tile, b.h / tile);
      const motif = this.motifTexture(part, color, variant) ?? this.buttonTexture(part, color);
      const mat = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        color: new THREE.Color(motif ? '#ffffff' : color),
        map: motif,
        roughness: look.roughness,
        metalness: 0,
        sheen: look.sheen,
        sheenRoughness: look.sheenRoughness,
        sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35),
        normalMap: normal,
        normalScale: new THREE.Vector2(look.normalScale, look.normalScale),
        clearcoat: look.clearcoat ?? 0,
        side: THREE.DoubleSide,
        emissive,
        emissiveIntensity: isSel ? 0.22 : 0,
        envMapIntensity: 0.7,
      });
      // Innenseite dunkler (liegt im Schatten des Körpers, Stoffrückseite)
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n\tif (!gl_FrontFacing) diffuseColor.rgb *= 0.62;');
      };
      mat.customProgramCacheKey = () => 'fabric-inside';
      mesh.material = mat;
    }
    if (this.opts.mode === 'fit') this.updateFitColors();
    else this.updateLookColors();
    this.dirty = true;
  }

  /** Knöpfe auf der oberen Knopfleiste (Polo): zwei, drei Knöpfe je nach Länge, in Stofffarbe abgesetzt. */
  private buttonTexture(part: ViewPart, color: string): THREE.Texture | null {
    if (part.piece.role !== 'placket' || !/oben|top/i.test(part.piece.name)) return null;
    const b = part.box;
    const k = 8;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(b.w * k);
    cv.height = Math.ceil(b.h * k);
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, cv.width, cv.height);
    const n = b.h > 120 ? 3 : 2;
    const r = Math.min(b.w * 0.24, 7) * k;
    for (let i = 0; i < n; i++) {
      const y = b.h * (0.2 + (0.65 * i) / Math.max(1, n - 1)) * k;
      const x = (b.w / 2) * k;
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, '#f4f1ea');
      g.addColorStop(1, '#cfc9bc');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(60,55,50,0.55)';
      for (const [dx, dy] of [
        [-0.28, -0.28],
        [0.28, -0.28],
        [-0.28, 0.28],
        [0.28, 0.28],
      ]) {
        ctx.beginPath();
        ctx.arc(x + dx * r, y + dy * r, r * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.motifTextures.push(tex);
    return tex;
  }

  /** Motive aus dem Tab „Produktion“ als Textur auf Vorder- und Rückenteil. */
  private motifTexture(part: ViewPart, color: string, variant: Variant | null): THREE.Texture | null {
    const doc = this.doc;
    if (!doc || part.copy || (part.piece.role !== 'front' && part.piece.role !== 'back')) return null;
    const prod = doc.production;
    if (!prod?.motifs.length) return null;
    const motifs = prod.motifs.filter((m) => m.placement.view === part.piece.role);
    if (!motifs.length) return null;
    const b = part.box;
    const ref = necklineCenter(part.piece.polygon, b.cx);
    if (!ref) return null;
    const k = Math.min(3, 2048 / Math.max(b.w, b.h));
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(b.w * k);
    cv.height = Math.ceil(b.h * k);
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, cv.width, cv.height);
    const v = variant ?? prod.variants[0];
    let drawn = false;
    for (const m of motifs) {
      const size = motifSize(doc, m);
      if (!size) continue;
      const md = v ? applyVariant(motifDoc(doc, m), v) : motifDoc(doc, m);
      const left = m.placement.x - size.w / 2;
      const toScreen = (w: { x: number; y: number }) => {
        const px = ref.x + left + (w.x - size.box.minX);
        const py = ref.y - m.placement.y - (size.box.maxY - w.y);
        return { x: (px - b.minX) * k, y: (b.maxY - py) * k };
      };
      drawDesign({ ctx, scale: k, minStrokePx: 0.5, design: true, toScreen }, md);
      drawn = true;
    }
    if (!drawn) return null;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.motifTextures.push(tex);
    return tex;
  }

  private pushColors(part: ViewPart, mesh: THREE.Mesh): void {
    const attr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    smoothAttr(part.topo, part.colors, attr.array as Float32Array, 3);
    attr.needsUpdate = true;
  }

  /**
   * Aussehen: Nähte leicht abgedunkelt (Nahtschatten wie bei echter Steppnaht), freie Kanten (Saum, Ärmelende)
   * minimal heller – wirkt plastischer als eine glatte Fläche.
   */
  private updateLookColors(): void {
    if (this.opts.mode === 'fit') return;
    const onSeam = new Uint8Array(this.n);
    if (this.seams) for (const g of this.seams) onSeam[g] = 1;
    for (const part of this.parts) {
      const mesh = this.meshes.get(part.key);
      if (!mesh) continue;
      const col = part.colors;
      for (let i = 0; i < part.count; i++) {
        const v = onSeam[part.offset + i] ? 0.8 : part.topo.boundary[i] ? 0.93 : 1;
        col[3 * i] = col[3 * i + 1] = col[3 * i + 2] = v;
      }
      this.pushColors(part, mesh);
    }
    this.dirty = true;
  }

  /** Passform-Karte: rot = gedehnt (eng), grün = liegt an, blau = locker. */
  private updateFitColors(): void {
    if (!this.strain || !this.gap) return;
    const c = new THREE.Color();
    const tight = new THREE.Color('#d7263d');
    const warn = new THREE.Color('#f4c430');
    const snug = new THREE.Color('#3aa76d');
    const loose = new THREE.Color('#3d7bd9');
    for (const part of this.parts) {
      const mesh = this.meshes.get(part.key);
      if (!mesh) continue;
      const col = part.colors;
      for (let i = 0; i < part.count; i++) {
        const g = part.offset + i;
        const s = this.strain[g];
        const gap = this.gap[g];
        if (s > 0.02) c.copy(warn).lerp(tight, Math.min(1, (s - 0.02) / 0.08));
        else c.copy(snug).lerp(loose, Math.min(1, Math.max(0, (gap - 6) / 45)));
        col[3 * i] = c.r;
        col[3 * i + 1] = c.g;
        col[3 * i + 2] = c.b;
      }
      this.pushColors(part, mesh);
    }
    this.dirty = true;
  }

  private frameCamera(): void {
    const mq = this.mq;
    const ex = this.ex;
    if (!mq || !ex) return;
    const hasHood = ex.pieces.some((p) => p.role === 'hood');
    const top = hasHood ? mq.measures.height + 40 : mq.neckBaseY + 140;
    const bottom = mq.crotchY - 120;
    const cy = (top + bottom) / 2;
    const span = top - bottom + 200;
    const vHalf = Math.tan((this.camera.fov * Math.PI) / 360);
    // Breite: Arme in A-Haltung (bis zu den Händen)
    const half = mq.shoulderJoint[0] + Math.sin(mq.armAngle) * mq.measures.arm * 0.9 + 60;
    const dist = Math.max((span / 2 / vHalf) * 1.08, (half / (vHalf * Math.max(0.3, this.camera.aspect))) * 1.05);
    this.controls.target.set(0, cy, 0);
    this.camera.position.set(dist * 0.36, cy + 140, dist * 0.93);
    this.controls.update();
    this.dirty = true;
  }

  /** Kamera auf eine Ansicht setzen. */
  view(v: CameraView): void {
    const t = this.controls.target;
    const d = this.camera.position.distanceTo(t);
    const dir = v === 'front' ? [0, 0.06, 1] : v === 'back' ? [0, 0.06, -1] : v === 'left' ? [1, 0.06, 0] : v === 'right' ? [-1, 0.06, 0] : [0.36, 0.14, 0.93];
    const l = Math.hypot(dir[0], dir[1], dir[2]);
    this.camera.position.set(t.x + (dir[0] / l) * d, t.y + (dir[1] / l) * d, t.z + (dir[2] / l) * d);
    this.controls.update();
    this.dirty = true;
  }

  private tick(): void {
    const pos = this.pending;
    if (pos && pos.length >= this.n * 3) {
      this.pending = null;
      const N = this.normals;
      for (const part of this.parts)
        vertexNormals(pos.subarray(part.offset * 3, (part.offset + part.count) * 3), part.topo.tris.length ? localTris(part) : [], part.count, N.subarray(part.offset * 3));
      // über Nähte mitteln: die Teile gehen ohne Knick ineinander über
      const S = this.seams;
      if (S) {
        const acc = Float32Array.from(N);
        for (let q = 0; q < S.length; q += 2) {
          const a = 3 * S[q];
          const b = 3 * S[q + 1];
          if (N[a] * N[b] + N[a + 1] * N[b + 1] + N[a + 2] * N[b + 2] < 0.2) continue;
          for (let c = 0; c < 3; c++) {
            acc[a + c] += N[b + c];
            acc[b + c] += N[a + c];
          }
        }
        for (let i = 0; i < this.n; i++) {
          const k = 3 * i;
          const l = Math.hypot(acc[k], acc[k + 1], acc[k + 2]) || 1;
          N[k] = acc[k] / l;
          N[k + 1] = acc[k + 1] / l;
          N[k + 2] = acc[k + 2] / l;
        }
      }
      for (const part of this.parts) {
        const mesh = this.meshes.get(part.key);
        if (!mesh) continue;
        const pa = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        const na = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
        smoothFill(
          part.topo,
          pos.subarray(part.offset * 3, (part.offset + part.count) * 3),
          N.subarray(part.offset * 3, (part.offset + part.count) * 3),
          pa.array as Float32Array,
          na.array as Float32Array,
        );
        pa.needsUpdate = true;
        na.needsUpdate = true;
        mesh.geometry.computeBoundingSphere();
        mesh.visible = true;
      }
      this.dirty = true;
    }
    this.controls.update();
    if (this.dirty) {
      this.dirty = false;
      this.render();
    }
  }

  private render(): void {
    if (this.composer && this.aoPass && this.aoOn) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private lastStatus = '';
  private status(s: ViewerStatus): void {
    const key = `${s.state}:${s.message ?? ''}:${s.stats ? Math.round(s.stats.time * 4) : ''}`;
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.events.onStatus?.(s);
  }

  /** Bild der aktuellen Ansicht als PNG (Data-URL), optional in höherer Auflösung. */
  snapshot(scale = 2): string {
    this.tick();
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const pr = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(scale);
    this.composer?.setSize(w, h);
    this.render();
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(w, h);
    this.dirty = true;
    return url;
  }

  /** Abstand der Kamera zum Mittelpunkt (mm). */
  get distance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  set distance(d: number) {
    const t = this.controls.target;
    this.camera.position.sub(t).setLength(d).add(t);
    this.controls.update();
    this.dirty = true;
  }

  /** Bildschirmpunkt (Client-Koordinaten) auf einem Teil – für Tests und Hilfen. */
  screenPointOf(pieceId: string): { x: number; y: number } | null {
    const part = this.parts.find((p) => p.pieceId === pieceId && p.copy === 0);
    const mesh = part && this.meshes.get(part.key);
    if (!part || !mesh) return null;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    // Vertex nahe der Mitte des Teils (im 2D-Schnitt)
    let best = 0;
    let bd = Infinity;
    const cx = part.box.cx;
    const cy = part.box.minY + part.box.h * 0.4;
    for (let i = 0; i < part.count; i++) {
      const d = Math.hypot(part.uv[2 * i] - cx, part.uv[2 * i + 1] - cy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const v = new THREE.Vector3(pos.getX(best), pos.getY(best), pos.getZ(best)).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  private bindPicking(): void {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      down = null;
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const hit = ray.intersectObjects(
        [...this.meshes.values()].filter((m) => m.visible),
        false,
      )[0];
      this.events.onPick?.((hit?.object.userData.pieceId as string | undefined) ?? null);
    });
  }
}

function uvBox(uv: Float64Array, count: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    minX = Math.min(minX, uv[2 * i]);
    maxX = Math.max(maxX, uv[2 * i]);
    minY = Math.min(minY, uv[2 * i + 1]);
    maxY = Math.max(maxY, uv[2 * i + 1]);
  }
  return { minX, minY, maxX, maxY, w: Math.max(1e-6, maxX - minX), h: Math.max(1e-6, maxY - minY), cx: (minX + maxX) / 2 };
}

/** Bezugspunkt „Kragennaht Mitte“: höchster Schnittpunkt der senkrechten Mittellinie mit dem Umriss. */
export function necklineCenter(poly: [number, number][], cx: number): { x: number; y: number } | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    if ((ax <= cx && bx > cx) || (bx <= cx && ax > cx)) {
      const y = ay + ((cx - ax) / (bx - ax)) * (by - ay);
      if (best === null || y > best) best = y;
    }
  }
  return best === null ? null : { x: cx, y: best };
}

/** Grobe Dreiecke eines Teils mit lokalen Indizes (zwischengespeichert). */
const localCache = new WeakMap<object, Uint32Array>();
function localTris(part: { tris: Uint32Array; offset: number }): Uint32Array {
  let t = localCache.get(part);
  if (!t) {
    t = new Uint32Array(part.tris.length);
    for (let i = 0; i < t.length; i++) t[i] = part.tris[i] - part.offset;
    localCache.set(part, t);
  }
  return t;
}
