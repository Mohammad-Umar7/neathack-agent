// Stage implementation: renderer + post-processing, layout of one or two cells, camera
// presets, picking on the operator panel and the render loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Frame, Violation } from '../types';
import type { CellId, PanelControl, Stage, StageOptions } from './types3d';
import { Kit } from './materials';
import { Cell, CellAssets } from './cell';
import { Environment } from './env';
import { CameraRig, easeOutCubic } from './camera';
import { ensureStyles, makeLabel } from './labels';
import { clearGeomCache } from './geom';

type FocusTarget = 'overview' | 'infeed' | 'pick' | 'panel' | 'guard' | 'auto';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Camera presets in cell-A plant coordinates: [position, target]. */
const PRESETS: Record<'infeed' | 'pick' | 'panel' | 'guard', [THREE.Vector3, THREE.Vector3]> = {
  infeed: [V(1.75, 1.95, 1.05), V(0.2, 0.92, -0.12)],
  pick: [V(2.25, 2.2, 1.05), V(3.85, 1.12, -0.4)],
  panel: [V(1.6, 2.0, 3.7), V(0.82, 1.38, 1.9)],
  guard: [V(5.0, 2.05, 4.7), V(3.25, 1.05, 1.3)],
};

const TWIN_OFFSET = 3.95;
const HOVER_TEXT: Record<PanelControl, string> = {
  START: 'START<small>push button</small>',
  STOP: 'STOP<small>push button</small>',
  RESET: 'RESET<small>push button</small>',
  ESTOP: 'E-STOP<small>emergency stop</small>',
  GUARD: 'GUARD DOOR<small>open / close</small>',
};

export class StageImpl implements Stage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly css: CSS2DRenderer;
  private readonly composer: EffectComposer | null = null;
  private readonly bloom: UnrealBloomPass | null = null;
  private readonly kit: Kit;
  private readonly assets: CellAssets;
  private readonly env: Environment;
  private readonly rig: CameraRig;
  private readonly cells: Record<CellId, Cell>;
  private readonly ro: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly clock = new THREE.Clock();
  private readonly callbacks: ((c: PanelControl) => void)[] = [];
  private layout: 'single' | 'twin' = 'single';
  private labels = { A: 'BASELINE — as delivered', B: 'REPAIRED — agent v2' };
  private interactive = false;
  private pointerInside = false;
  private pointerDirty = false;
  private hover: PanelControl | null = null;
  private down: { x: number; y: number; t: number } | null = null;
  private raf = 0;
  private time = 0;
  private w = 0;
  private h = 0;
  private disposed = false;
  private lastFocus: FocusTarget = 'overview';
  private readonly high: boolean;

  constructor(
    private readonly container: HTMLElement,
    opts: StageOptions,
  ) {
    ensureStyles();
    this.high = (opts.quality ?? 'high') === 'high';
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.classList.add('sp3d-root');

    this.renderer = new THREE.WebGLRenderer({ antialias: !this.high, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.maxRatio = Math.min(window.devicePixelRatio || 1, this.high ? 1.5 : 1);
    this.renderer.setPixelRatio(this.maxRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = this.high;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    const canvas = this.renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);

    this.css = new CSS2DRenderer();
    this.css.domElement.className = 'sp3d-css';
    this.css.domElement.style.position = 'absolute';
    this.css.domElement.style.inset = '0';
    this.css.domElement.style.pointerEvents = 'none';
    container.appendChild(this.css.domElement);

    this.camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.05, 220);
    this.kit = new Kit(this.renderer.capabilities.getMaxAnisotropy());
    this.env = new Environment(this.renderer, this.scene, this.kit.glow, this.high);
    this.scene.add(this.env.group);
    this.assets = new CellAssets(this.kit);
    this.cells = { A: new Cell('A', this.assets), B: new Cell('B', this.assets) };
    this.scene.add(this.cells.A.root, this.cells.B.root);
    this.rig = new CameraRig(this.camera, canvas);
    this.hoverTag = makeLabel('sp3d-hover', '');
    this.hoverTag.visible = false;
    this.hoverTag.center.set(0.5, 1.9); // float above the pointer hit
    this.scene.add(this.hoverTag);

    if (this.high) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 1.0);
      // Guard the bloom chain against NaN / Inf texels (a single hot fp16 pixel would
      // otherwise smear across the whole frame through the blur mips).
      const hp = this.bloom.materialHighPassFilter;
      const marker = 'vec4 texel = texture2D( tDiffuse, vUv );';
      if (hp.fragmentShader.includes(marker)) {
        hp.fragmentShader = hp.fragmentShader.replace(
          marker,
          `${marker}
			texel = ( any( isnan( texel ) ) || any( isinf( texel ) ) ) ? vec4( 0.0 ) : min( texel, vec4( 24.0 ) );`,
        );
        hp.needsUpdate = true;
      }
      this.composer.addPass(this.bloom);
      const output = new OutputPass();
      this.composer.addPass(output);
      const vignette = new ShaderPass(VignetteShader);
      vignette.uniforms.offset.value = 1.1;
      vignette.uniforms.darkness.value = 1.0;
      this.composer.addPass(vignette);
    }

    this.applyLayout(false);
    this.env.onReady = () => this.precompile();

    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    // the intro pose depends on the aspect ratio, so compute it after the first resize
    const [pos, target] = this.overviewPose();
    const start = pos.clone().sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.75).multiplyScalar(1.75).add(target);
    start.y = pos.y * 1.9;
    this.rig.set(start, target.clone().add(new THREE.Vector3(0, 0.6, 0)));
    this.rig.goTo(pos, target, 3.6, easeOutCubic);
    this.started = true;
    this.loop();
  }

  // ---------------------------------------------------------------- API

  setLayout(layout: 'single' | 'twin', labels?: { A: string; B: string }): void {
    if (labels) this.labels = { ...labels };
    const changed = layout !== this.layout;
    this.layout = layout;
    this.applyLayout(true, changed);
  }

  applyFrame(cell: CellId, frame: Frame, prev?: Frame): void {
    const c = this.cells[cell];
    if (c && frame) c.applyFrame(frame, prev);
  }

  flashViolation(cell: CellId, v: Violation): void {
    this.cells[cell]?.flashViolation(v);
  }

  focus(target: FocusTarget): void {
    this.lastFocus = target;
    if (target === 'auto') {
      const [p, t] = this.overviewPose();
      const off = p.clone().sub(t);
      const radius = Math.hypot(off.x, off.z) * (this.layout === 'twin' ? 1.08 : 0.94);
      this.rig.startAuto(t.clone().setY(t.y + 0.1), radius, t.y + off.y * 0.82);
      return;
    }
    if (target === 'overview') {
      const [p, t] = this.overviewPose();
      this.rig.goTo(p, t, 1.9);
      return;
    }
    const [p, t] = PRESETS[target];
    const a = this.cells.A;
    this.rig.goTo(a.toWorld(p), a.toWorld(t), 1.8);
  }

  onControl(cb: (c: PanelControl) => void): void {
    this.callbacks.push(cb);
  }

  setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) {
      this.setHover(null);
    } else {
      this.pointerDirty = true;
    }
  }

  resize(): void {
    const w = Math.max(0, Math.floor(this.container.clientWidth));
    const h = Math.max(0, Math.floor(this.container.clientHeight));
    if (w === this.w && h === this.h) return;
    this.applySize(w, h);
    if (this.lastFocus === 'overview' && this.started && w > 0 && h > 0) {
      const [p, t] = this.overviewPose();
      this.rig.goTo(p, t, 0.9);
    }
  }

  private applySize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.css.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  private started = false;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.rig.dispose();
    this.cells.A.dispose();
    this.cells.B.dispose();
    this.assets.dispose();
    this.env.dispose();
    this.kit.dispose();
    clearGeomCache();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      this.bloom?.dispose();
    }
    this.renderer.dispose();
    canvas.remove();
    this.css.domElement.remove();
    this.container.classList.remove('sp3d-root');
    this.callbacks.length = 0;
  }

  // ---------------------------------------------------------------- internals

  /** Overview pose fitted to the layout width for the current aspect ratio. */
  private overviewPose(): [THREE.Vector3, THREE.Vector3] {
    const twin = this.layout === 'twin';
    const target = twin ? V(0, 0.45, -1.0) : V(-0.05, 0.7, 0.1);
    const dir = (twin ? V(2.2, 7.6, 16.0) : V(3.3, 5.0, 8.4)).normalize();
    const halfW = twin ? 8.3 : 4.2;
    const halfH = twin ? 2.6 : 2.5;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = this.camera.aspect || 16 / 9;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const dist = Math.max(halfW / Math.tan(hfov / 2), halfH / Math.tan(vfov / 2)) * 1.06;
    return [target.clone().addScaledVector(dir, dist), target];
  }

  private applyLayout(animateCamera: boolean, changed = true): void {
    const twin = this.layout === 'twin';
    const A = this.cells.A;
    const B = this.cells.B;
    A.root.position.set(twin ? -TWIN_OFFSET : 0, 0, 0);
    B.root.position.set(TWIN_OFFSET, 0, 0);
    B.setActive(twin);
    A.setTitle(twin ? this.labels.A : null);
    B.setTitle(twin ? this.labels.B : null);
    this.scene.updateMatrixWorld(true);
    this.env.setAnchors(twin ? [A.root.position, B.root.position] : [A.root.position]);
    if (animateCamera && changed) {
      if (this.lastFocus === 'auto' && this.rig.isAuto) this.focus('auto');
      else this.focus(this.lastFocus === 'auto' ? 'overview' : this.lastFocus);
    }
  }

  private readonly hoverTag: ReturnType<typeof makeLabel>;

  /**
   * Compile the programs for both layouts once the environment map is in place, with the
   * composer's target bound (programs differ for tone-mapped screen output vs. the linear
   * HDR target). Cell B adds lights, so without this the first switch to twin stalls.
   */
  private precompile(): void {
    if (this.disposed) return;
    const prevTarget = this.renderer.getRenderTarget();
    if (this.composer) this.renderer.setRenderTarget(this.composer.renderTarget1);
    const twin = this.layout === 'twin';
    const compileFor = (asTwin: boolean) => {
      this.cells.B.setActive(asTwin);
      this.env.setAnchors(asTwin ? [this.cells.A.root.position, this.cells.B.root.position] : [this.cells.A.root.position]);
      this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined);
    };
    compileFor(!twin);
    compileFor(twin);
    this.renderer.setRenderTarget(prevTarget);
  }

  private setHover(c: PanelControl | null, at?: THREE.Vector3): void {
    if (at && c) this.hoverTag.position.copy(at);
    if (c === this.hover) return;
    this.hover = c;
    this.cells.A.setHover(c);
    this.renderer.domElement.style.cursor = c ? 'pointer' : '';
    this.hoverTag.visible = !!c;
    if (c) this.hoverTag.element.innerHTML = HOVER_TEXT[c];
  }

  private readonly hoverPoint = new THREE.Vector3();

  private pickAt(clientX: number, clientY: number): PanelControl | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.cells.A.pickables, false);
    for (const h of hits) {
      const c = h.object.userData.control as PanelControl | undefined;
      if (c) {
        this.hoverPoint.copy(h.point);
        return c;
      }
    }
    return null;
  }

  private lastPointer = { x: 0, y: 0 };

  private readonly onPointerMove = (e: PointerEvent) => {
    this.pointerInside = true;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.pointerDirty = true;
  };

  private readonly onPointerLeave = () => {
    this.pointerInside = false;
    this.setHover(null);
  };

  private readonly onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!this.interactive || !d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
    const c = this.pickAt(e.clientX, e.clientY);
    if (!c) return;
    this.cells.A.clickFeedback(c);
    for (const cb of this.callbacks) {
      try {
        cb(c);
      } catch (err) {
        console.error(err);
      }
    }
  };

  private readonly loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const raw = this.clock.getDelta();
    this.adaptResolution(raw);
    this.frame(Math.min(0.05, raw));
  };

  // Dynamic resolution: keep ~60 fps on integrated GPUs by trading pixel ratio.
  private perfAcc = 0;
  private perfN = 0;
  private perfT = 0;
  private maxRatio = 1;
  private adaptResolution(dt: number): void {
    if (!this.high || dt <= 0 || dt > 0.25) return; // ignore hidden-tab gaps
    this.perfAcc += dt;
    this.perfN++;
    this.perfT += dt;
    if (this.perfT < 2) return;
    const avg = this.perfAcc / this.perfN;
    this.perfAcc = 0;
    this.perfN = 0;
    this.perfT = 0;
    const cur = this.renderer.getPixelRatio();
    let next = cur;
    if (avg > 1 / 48) next = Math.max(0.7, cur - 0.15);
    else if (avg < 1 / 58 && cur < this.maxRatio) next = Math.min(this.maxRatio, cur + 0.1);
    if (Math.abs(next - cur) > 1e-3) {
      this.renderer.setPixelRatio(next);
      const w = this.w;
      const h = this.h;
      this.w = 0; // force resize() to re-apply sizes
      this.h = 0;
      this.applySize(w, h);
    }
  }

  /** Advance animations by dt seconds and render once (also used by the dev page). */
  debugStep(dt: number): void {
    this.frame(dt);
  }

  private frame(dt: number): void {
    this.time += dt;
    if (this.w === 0 || this.h === 0) return;
    this.renderer.info.reset();
    if (this.interactive && this.pointerInside && this.pointerDirty && !this.down) {
      this.pointerDirty = false;
      const c = this.pickAt(this.lastPointer.x, this.lastPointer.y);
      this.setHover(c, c ? this.hoverPoint : undefined);
    }
    this.cells.A.update(dt, this.time);
    if (this.layout === 'twin') this.cells.B.update(dt, this.time);
    else this.cells.B.update(0, this.time);
    this.env.update(this.time);
    this.rig.update(dt);
    this.cells.A.updateLabels(this.camera.position);
    this.cells.B.updateLabels(this.camera.position);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.css.render(this.scene, this.camera);
  }

  /** Debug helper for the dev page. */
  get debugInfo(): { calls: number; triangles: number; textures: number; geometries: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries };
  }
}
