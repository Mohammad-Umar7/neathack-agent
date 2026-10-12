// One conveyor cell (the digital twin). Static parts are merged once per stage and shared
// between cells; this class owns the moving parts and maps simulation frames onto them.
import * as THREE from 'three';
import type { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Frame, Violation } from '../types';
import type { CellId, PanelControl } from './types3d';
import { Kit, additiveMaterial } from './materials';
import { mergeStatic, type MergedPart } from './geom';
import { buildConveyorStatic, ConveyorDynamic, ConveyorShared } from './parts/conveyor';
import { buildSensorStatic, PhotoEye } from './parts/sensors';
import { buildPanelStatic, PanelDynamic } from './parts/panel';
import { buildFenceStatic, GuardDoor } from './parts/fence';
import { buildGantryStatic, Gantry } from './parts/gantry';
import { BoxField } from './parts/boxes';
import { buildFloorStatic } from './parts/floor';
import {
  BELT_SPEED,
  CELL_CENTER_X,
  CELL_CENTER_Z,
  DOOR_X0,
  DOOR_X1,
  FZ1,
  PANEL_BASE_Y,
  PANEL_X,
  PANEL_Z,
  PE_END_X,
  PE_IN_X,
  PICK_X,
  RAIL_Y,
  RAIL_Z,
  BELT_LEN,
} from './dims';
import { escapeHtml, makeLabel } from './labels';
import { stencilCanvas, toTexture } from './textures';

export class CellAssets {
  readonly merged: MergedPart[];
  readonly conveyor: ConveyorShared;
  constructor(readonly kit: Kit) {
    const root = new THREE.Group();
    buildConveyorStatic(root, kit);
    buildSensorStatic(root, kit, PE_IN_X);
    buildSensorStatic(root, kit, PE_END_X);
    buildPanelStatic(root, kit);
    buildFenceStatic(root, kit);
    buildGantryStatic(root, kit);
    buildFloorStatic(root, kit);
    this.merged = mergeStatic(root);
    this.conveyor = new ConveyorShared(kit);
  }
  dispose(): void {
    for (const p of this.merged) p.geometry.dispose();
    this.conveyor.dispose();
  }
}

/** Named spots in plant coordinates (focus targets, violation tags). */
export const SPOTS = {
  infeed: new THREE.Vector3(PE_IN_X, 1.12, 0),
  pick: new THREE.Vector3(PICK_X + 0.2, 1.25, 0),
  panel: new THREE.Vector3(PANEL_X, PANEL_BASE_Y + 0.42, PANEL_Z),
  guard: new THREE.Vector3((DOOR_X0 + DOOR_X1) / 2, 1.55, FZ1),
  center: new THREE.Vector3(2.0, 1.7, 0),
};

function spotFor(rule: string): THREE.Vector3 {
  const r = rule.toUpperCase();
  if (r === 'S6' || r === 'DROP') return SPOTS.pick;
  if (r === 'S1' || r === 'S3' || r === 'S5') return SPOTS.panel;
  if (r === 'S2' || r === 'S4') return SPOTS.guard;
  if (r === 'S7') return SPOTS.infeed;
  return SPOTS.center;
}

interface ViolationFx {
  tag: CSS2DObject;
  age: number;
  spot: THREE.Vector3;
}

export class Cell {
  /** Positioned at the layout anchor (world). */
  readonly root = new THREE.Group();
  /** Plant coordinates (x along the belt as in the simulation). */
  readonly content = new THREE.Group();
  readonly pickables: THREE.Object3D[] = [];
  readonly title: CSS2DObject;
  private readonly conveyor: ConveyorDynamic;
  private readonly sensors: PhotoEye[];
  private readonly panel: PanelDynamic;
  private readonly door: GuardDoor;
  private readonly gantry: Gantry;
  private readonly boxes: BoxField;
  private readonly violLight: THREE.PointLight;
  private readonly violGlow: THREE.Sprite;
  private readonly violGlowMat: THREE.SpriteMaterial;
  private readonly shock: THREE.Mesh;
  private readonly shockMat: THREE.MeshBasicMaterial;
  private readonly stencilMat: THREE.MeshStandardMaterial;
  private readonly fx: ViolationFx[] = [];
  private readonly stripMat: THREE.MeshBasicMaterial;
  private readonly underMat: THREE.MeshBasicMaterial;
  private readonly stateColor = new THREE.Color();
  private readonly stateTarget = new THREE.Color(0.4, 0.42, 0.45);
  private statePulse = false;
  private violAge = 99;
  private travel = 0;
  private lastT = NaN;
  private active = true;
  private titleWanted = false;

  constructor(
    readonly id: CellId,
    readonly assets: CellAssets,
  ) {
    const kit = assets.kit;
    this.root.add(this.content);
    this.content.position.set(-CELL_CENTER_X, 0, -CELL_CENTER_Z);
    for (const p of assets.merged) {
      const m = new THREE.Mesh(p.geometry, p.material);
      m.castShadow = p.castShadow;
      m.receiveShadow = p.receiveShadow;
      m.renderOrder = p.renderOrder;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.content.add(m);
    }
    this.conveyor = new ConveyorDynamic(kit, assets.conveyor);
    this.content.add(this.conveyor.group);
    this.sensors = [new PhotoEye(kit, PE_IN_X, 'PE_IN'), new PhotoEye(kit, PE_END_X, 'PE_END')];
    for (const s of this.sensors) this.content.add(s.group);
    this.panel = new PanelDynamic(kit);
    this.panel.setCellName(id);
    this.content.add(this.panel.group);
    this.door = new GuardDoor(kit);
    this.content.add(this.door.group);
    this.content.add(this.door.switchGroup);
    this.gantry = new Gantry(kit);
    this.content.add(this.gantry.group);
    this.boxes = new BoxField(kit, this.gantry);
    this.content.add(this.boxes.group);
    this.pickables.push(...this.panel.pickables, ...this.door.pickables);
    for (const o of [this.conveyor.group, this.panel.group, this.door.group, this.door.switchGroup, this.gantry.group]) {
      o.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = !(mesh.material as THREE.Material).transparent;
          mesh.receiveShadow = true;
        }
      });
    }
    for (const s of this.sensors) {
      s.group.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh && !(mesh.material as THREE.Material).transparent) mesh.castShadow = true;
      });
    }

    // floor stencil with the cell letter
    this.stencilMat = new THREE.MeshStandardMaterial({
      color: 0xd9d6cc,
      alphaMap: toTexture(stencilCanvas(id), false, false),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const st = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65).rotateX(-Math.PI / 2), this.stencilMat);
    st.position.set(1.75, 0.003, 2.15);
    st.receiveShadow = true;
    this.content.add(st);

    // violation effects
    this.violLight = new THREE.PointLight(0xff2a1a, 0, 5, 2);
    this.content.add(this.violLight);
    this.violGlowMat = new THREE.SpriteMaterial({
      map: kit.glow,
      color: new THREE.Color(4, 0.35, 0.25),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
      fog: false,
    });
    this.violGlow = new THREE.Sprite(this.violGlowMat);
    this.violGlow.renderOrder = 8;
    this.content.add(this.violGlow);
    this.shockMat = additiveMaterial(new THREE.Color(3, 0.2, 0.15), undefined, 0);
    this.shockMat.alphaMap = kit.ring;
    this.shock = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.shockMat);
    this.shock.renderOrder = 7;
    this.content.add(this.shock);

    // state accent: LED strips in the lower T-slot of both rails + a soft underglow
    this.stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true, fog: false });
    const stripGeo = new THREE.BoxGeometry(BELT_LEN + 0.1, 0.007, 0.004);
    for (const sgn of [-1, 1]) {
      const strip = new THREE.Mesh(stripGeo, this.stripMat);
      strip.position.set(BELT_LEN / 2, RAIL_Y - 0.0225, sgn * (RAIL_Z + 0.0235));
      this.content.add(strip);
    }
    this.underMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      alphaMap: kit.blob,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const under = new THREE.Mesh(new THREE.PlaneGeometry(BELT_LEN + 1.4, 1.9).rotateX(-Math.PI / 2), this.underMat);
    under.position.set(BELT_LEN / 2, 0.005, 0);
    under.renderOrder = 3;
    this.content.add(under);
    this.stateColor.copy(this.stateTarget);

    this.title = makeLabel(`sp3d-cell ${id === 'A' ? 'a' : 'b'}`, '');
    this.title.position.set(CELL_CENTER_X, 2.95, CELL_CENTER_Z);
    this.title.visible = false;
    this.content.add(this.title);
  }

  setTitle(text: string | null): void {
    this.titleWanted = !!text;
    if (text) {
      const [head, ...rest] = text.split(/\s+[—–-]\s+/);
      const tail = rest.join(' — ');
      this.title.element.innerHTML = `<i></i><span><b>${escapeHtml(head)}</b>${tail ? ` <span style="opacity:.7;font-weight:500">— ${escapeHtml(tail)}</span>` : ''}</span>`;
    }
  }

  setActive(on: boolean): void {
    this.active = on;
    this.root.visible = on;
  }

  /** Map one simulation frame onto the twin. */
  applyFrame(frame: Frame, prev?: Frame): void {
    const t = frame.t;
    const motor = (frame.out?.MOTOR ?? 0) === 1;
    if (Number.isFinite(this.lastT)) {
      const dt = t - this.lastT;
      if (dt < -0.25) {
        // replay jumped backwards: restart one-shot animations
        this.boxes.reset();
        this.gantry.reset();
      } else if (dt > 0 && dt < 1.5) {
        const wasMotor = prev ? (prev.out?.MOTOR ?? 0) === 1 : motor;
        if (motor || wasMotor) this.travel += dt * BELT_SPEED;
      } else if (dt < 0 && dt >= -0.25 && motor) {
        this.travel += dt * BELT_SPEED;
      }
    }
    this.lastT = t;
    this.conveyor.setTravel(this.travel);
    const beltXs = this.boxes.apply(frame.boxes ?? []);
    const inp = frame.in ?? {};
    const stuck = frame.stuck ?? {};
    const stuckIn = stuck.PE_IN !== undefined;
    const stuckEnd = stuck.PE_END !== undefined;
    this.sensors[0].apply(inp.PE_IN === 1, stuckIn, beltXs);
    this.sensors[1].apply(inp.PE_END === 1, stuckEnd, beltXs);
    this.panel.apply(inp, frame.out ?? {}, [stuckIn ? 'PE_IN' : '', stuckEnd ? 'PE_END' : ''].filter(Boolean).join(' + '));
    this.door.setClosed(inp.GUARD_CLOSED !== 0);
    const out = frame.out ?? {};
    const fault = out.LAMP_RED === 1 || inp.ESTOP === 1 || stuckIn || stuckEnd;
    this.statePulse = fault;
    if (fault) this.stateTarget.setRGB(2.6, 0.12, 0.08);
    else if (motor) this.stateTarget.setRGB(0.12, 1.9, 1.05);
    else if (out.LAMP_AMBER === 1) this.stateTarget.setRGB(1.7, 0.75, 0.05);
    else this.stateTarget.setRGB(0.35, 0.38, 0.42);
  }

  flashViolation(v: Violation): void {
    const spot = spotFor(v.rule);
    const stack = this.fx.filter((f) => f.spot === spot && f.age < 3).length;
    const rule = escapeHtml(v.rule);
    const kind = v.rule.toUpperCase() === 'DROP' ? 'BOX DROPPED' : 'SAFETY VIOLATION';
    const tag = makeLabel(
      'sp3d-viol-wrap',
      `<div class="sp3d-viol"><span class="k">${kind} · t=${v.t.toFixed(1)}s</span><span class="r">${rule}</span>${escapeHtml(v.message)}</div>`,
    );
    tag.element.style.opacity = '0';
    tag.position.copy(spot).add(new THREE.Vector3(0, 0.32 + stack * 0.32, 0));
    this.content.add(tag);
    this.fx.push({ tag, age: 0, spot });
    this.violAge = 0;
    this.violLight.position.copy(spot).add(new THREE.Vector3(0, 0.45, 0.6));
    this.violGlow.position.copy(spot);
    this.shock.position.set(spot.x, 0.006, spot.z);
  }

  setHover(control: PanelControl | null): void {
    this.panel.setHover(control);
    this.door.setHover(control === 'GUARD');
  }

  clickFeedback(control: PanelControl): void {
    this.panel.clickFeedback(control);
  }

  update(dt: number, time: number): void {
    for (const s of this.sensors) {
      s.update(time);
      s.tag.visible = this.active && s.wantTag;
    }
    this.panel.update(dt, time);
    this.door.update(dt);
    this.gantry.update(dt);
    this.boxes.update(dt, time);
    this.title.visible = this.active && this.titleWanted;
    this.stateColor.lerp(this.stateTarget, 1 - Math.exp(-dt * 6));
    const pulse = this.statePulse ? 0.55 + 0.45 * Math.sin(time * 7) : 1;
    this.stripMat.color.copy(this.stateColor).multiplyScalar(pulse);
    this.underMat.color.copy(this.stateColor).multiplyScalar(0.045 * pulse);

    // violation pulse: three red flashes fading over ~3 s
    this.violAge += dt;
    const a = this.violAge;
    if (a < 3.2) {
      const env = Math.max(0, 1 - a / 3.2);
      const pulse = Math.pow(Math.max(0, Math.sin(a * Math.PI * 2.4)), 2);
      this.violLight.intensity = 14 * pulse * env + 2 * env;
      this.violGlowMat.opacity = Math.min(1, (0.25 + 0.75 * pulse) * env);
      this.violGlow.scale.setScalar(0.5 + 0.5 * pulse);
      const sk = (a % 1.2) / 1.2;
      this.shock.scale.set(0.4 + sk * 2.6, 1, 0.4 + sk * 2.6);
      this.shockMat.opacity = (1 - sk) * env;
    } else {
      this.violLight.intensity = 0;
      this.violGlowMat.opacity = 0;
      this.shockMat.opacity = 0;
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.age += dt;
      f.tag.visible = this.active;
      // fade in, hold, fade out (driven here so it also works in throttled / recorded tabs)
      const fin = Math.min(1, f.age / 0.3);
      const fout = 1 - Math.min(1, Math.max(0, (f.age - 2.8) / 0.6));
      const o = fin * fout;
      const child = f.tag.element.firstElementChild as HTMLElement | null;
      f.tag.element.style.opacity = o.toFixed(3);
      if (child) child.style.transform = `translateY(${((1 - fin) * 8 - (1 - fout) * 10).toFixed(1)}px)`;
      if (f.age > 3.5) {
        f.tag.removeFromParent();
        f.tag.element.remove();
        this.fx.splice(i, 1);
      }
    }
  }

  /** Distance-based label fading (called by the stage with the camera position). */
  updateLabels(camera: THREE.Vector3): void {
    for (const s of this.sensors) {
      s.sig.getWorldPosition(this.tmpW);
      s.setLabelProximity(this.tmpW.distanceTo(camera), this.active);
    }
  }

  private readonly tmpW = new THREE.Vector3();

  /** World position of a named spot. */
  spotWorld(name: keyof typeof SPOTS, out = new THREE.Vector3()): THREE.Vector3 {
    this.content.updateWorldMatrix(true, false);
    return out.copy(SPOTS[name]).applyMatrix4(this.content.matrixWorld);
  }

  toWorld(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    this.content.updateWorldMatrix(true, false);
    return out.copy(p).applyMatrix4(this.content.matrixWorld);
  }

  dispose(): void {
    this.conveyor.dispose();
    for (const s of this.sensors) s.dispose();
    this.panel.dispose();
    this.door.dispose();
    this.gantry.dispose();
    this.boxes.dispose();
    this.violGlowMat.dispose();
    this.stripMat.dispose();
    this.underMat.dispose();
    this.shockMat.dispose();
    this.shock.geometry.dispose();
    this.stencilMat.alphaMap?.dispose();
    this.stencilMat.dispose();
    for (const f of this.fx) f.tag.element.remove();
    this.title.element.remove();
    for (const s of this.sensors) {
      s.tag.element.remove();
      s.sig.element.remove();
    }
  }
}
