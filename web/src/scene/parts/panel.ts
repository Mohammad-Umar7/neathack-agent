// Operator control panel on a pedestal (START / STOP / RESET / E-STOP, status HMI)
// with the stack light (signal tower) on top.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Kit } from '../materials';
import { lathe, put, roundedRect } from '../geom';
import { PANEL_BASE_Y, PANEL_X, PANEL_Z } from '../dims';
import { FONT, makeCanvas, textPlateCanvas, toTexture } from '../textures';
import type { PanelControl } from '../types3d';

// enclosure profile (z, y) relative to the enclosure base; top strip at the back for the tower
const P_FRONT_Z = 0.13;
const P_BACK_Z = -0.13;
const P_FRONT_Y = 0.12;
const P_TOP_Y = 0.3;
const P_TOP_FRONT_Z = -0.07;
const SLANT_DZ = P_TOP_FRONT_Z - P_FRONT_Z;
const SLANT_DY = P_TOP_Y - P_FRONT_Y;
const SLANT_LEN = Math.hypot(SLANT_DZ, SLANT_DY);
const FACE_ROT = -Math.atan2(-SLANT_DZ, SLANT_DY); // rotation.x so local +z = outward normal
const BEVEL = 0.012;
const WIDTH = 0.52;

/** Face-local frame (u right, v up-slope, n out) → panel-local position. */
function facePoint(u: number, v: number, n: number): THREE.Vector3 {
  const dirUp = new THREE.Vector3(0, SLANT_DY / SLANT_LEN, SLANT_DZ / SLANT_LEN);
  const normal = new THREE.Vector3(0, -SLANT_DZ / SLANT_LEN, SLANT_DY / SLANT_LEN);
  const c = new THREE.Vector3(0, PANEL_BASE_Y + (P_FRONT_Y + P_TOP_Y) / 2, (P_FRONT_Z + P_TOP_FRONT_Z) / 2);
  return c.add(new THREE.Vector3(u, 0, 0)).addScaledVector(dirUp, v).addScaledVector(normal, 0.002 + n);
}

const BTN = { START: { u: -0.17, v: -0.045 }, STOP: { u: -0.085, v: -0.045 }, RESET: { u: 0.0, v: -0.045 } } as const;
const ESTOP_UV = { u: 0.155, v: -0.002 };
const HMI_UV = { u: -0.085, v: 0.058 };

export function buildPanelStatic(root: THREE.Object3D, kit: Kit): void {
  const g = new THREE.Group();
  g.position.set(PANEL_X, 0, PANEL_Z);
  root.add(g);
  // pedestal: base plate, anchor bolts, square post, mounting head
  put(g, new RoundedBoxGeometry(0.36, 0.02, 0.36, 2, 0.006), kit.aluDark, 0, 0.01, 0);
  for (const [x, z] of [
    [-0.14, -0.14],
    [-0.14, 0.14],
    [0.14, -0.14],
    [0.14, 0.14],
  ]) {
    put(g, new THREE.CylinderGeometry(0.012, 0.012, 0.01, 6), kit.zinc, x, 0.025, z);
    put(g, new THREE.CylinderGeometry(0.005, 0.005, 0.03, 8), kit.zinc, x, 0.03, z);
  }
  put(g, new RoundedBoxGeometry(0.08, PANEL_BASE_Y - 0.02, 0.08, 2, 0.008), kit.panelGrey, 0, (PANEL_BASE_Y - 0.02) / 2 + 0.02, -0.03);
  put(g, new RoundedBoxGeometry(0.2, 0.02, 0.16, 2, 0.005), kit.aluDark, 0, PANEL_BASE_Y - 0.01, -0.03);
  // enclosure (desk console)
  const shape = new THREE.Shape();
  shape.moveTo(P_BACK_Z + BEVEL, BEVEL);
  shape.lineTo(P_FRONT_Z - BEVEL, BEVEL);
  shape.lineTo(P_FRONT_Z - BEVEL, P_FRONT_Y - BEVEL * 0.4);
  shape.lineTo(P_TOP_FRONT_Z, P_TOP_Y - BEVEL);
  shape.lineTo(P_BACK_Z + BEVEL, P_TOP_Y - BEVEL);
  shape.closePath();
  const enc = new THREE.ExtrudeGeometry(shape, {
    depth: WIDTH - 2 * BEVEL,
    bevelEnabled: true,
    bevelSize: BEVEL,
    bevelThickness: BEVEL,
    bevelSegments: 4,
    curveSegments: 4,
  });
  enc.rotateY(-Math.PI / 2);
  enc.translate((WIDTH - 2 * BEVEL) / 2, PANEL_BASE_Y, 0);
  put(g, enc, kit.panelGrey);
  // hinge pins on the back
  for (const y of [0.07, 0.22]) put(g, new THREE.CylinderGeometry(0.007, 0.007, 0.05, 12), kit.zinc, -WIDTH / 2 + 0.02, PANEL_BASE_Y + y, P_BACK_Z - 0.006);
  // face plate
  const face = new THREE.Group();
  const c = facePoint(0, 0, 0.0015);
  face.position.copy(c);
  face.rotation.x = FACE_ROT;
  g.add(face);
  put(face, new THREE.ShapeGeometry(roundedRect(WIDTH - 0.05, SLANT_LEN - 0.04, 0.012)), kit.anthracite);
  // legend plates
  for (const [name, p] of Object.entries(BTN)) {
    const tex = kit.t(toTexture(textPlateCanvas([name], { w: 256, h: 64, bg: '#e9e9e4', fg: '#111', size: 34, weight: 800 }), true, false));
    const mat = kit.m(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }));
    put(face, new THREE.PlaneGeometry(0.066, 0.0165), mat, p.u, p.v - 0.042, 0.0012);
  }
  // HMI bezel
  put(face, new RoundedBoxGeometry(0.2, 0.088, 0.012, 2, 0.004), kit.blackPlastic, HMI_UV.u, HMI_UV.v, 0.004);
  // pushbutton bezels (chrome)
  const bezel = lathe(
    [
      [0.0165, 0],
      [0.0225, 0],
      [0.0228, 0.003],
      [0.021, 0.0075],
      [0.0168, 0.0078],
    ],
    48,
  ).rotateX(Math.PI / 2);
  for (const p of Object.values(BTN)) put(face, bezel, kit.chrome, p.u, p.v, 0);
  // E-stop: yellow legend disc + black housing
  const disc = new THREE.CylinderGeometry(0.058, 0.058, 0.003, 64);
  disc.rotateX(Math.PI / 2);
  put(face, disc, [kit.yellow, kit.estopDisc, kit.yellow], ESTOP_UV.u, ESTOP_UV.v, 0.0016);
  put(face, new THREE.CylinderGeometry(0.03, 0.032, 0.02, 48).rotateX(Math.PI / 2), kit.blackPlastic, ESTOP_UV.u, ESTOP_UV.v, 0.011);

  // stack light (signal tower): base, pole, separators, cap — built in a scaled tower frame
  const tower = new THREE.Group();
  tower.position.copy(TOWER_POS);
  tower.scale.setScalar(TOWER_SCALE);
  g.add(tower);
  put(tower, new THREE.CylinderGeometry(0.032, 0.036, 0.03, 40), kit.blackPlastic, 0, 0.015, 0);
  put(tower, new THREE.CylinderGeometry(0.012, 0.012, 0.2, 24), kit.alu, 0, 0.13, 0);
  const t0 = TOWER_T0;
  for (let i = 0; i <= 3; i++) {
    put(tower, new THREE.CylinderGeometry(0.0365, 0.0365, 0.008, 48), kit.blackPlastic, 0, t0 + i * (STACK_SEG + 0.008) + 0.004, 0);
  }
  const capY = t0 + 3 * (STACK_SEG + 0.008) + 0.008;
  put(tower, lathe([[0.0365, 0], [0.0365, 0.008], [0.033, 0.02], [0.02, 0.028], [0, 0.03]], 48), kit.blackPlastic, 0, capY, 0);
  // buzzer grille ring on the cap
  put(tower, new THREE.TorusGeometry(0.03, 0.002, 6, 40).rotateX(Math.PI / 2), kit.zinc, 0, capY + 0.012, 0);
}

const STACK_SEG = 0.072;
const TOWER_SCALE = 1.35;
const TOWER_T0 = 0.23; // first lens segment above the tower base (tower-local)
const TOWER_POS = new THREE.Vector3(WIDTH / 2 - 0.07, PANEL_BASE_Y + P_TOP_Y, (P_BACK_Z + P_TOP_FRONT_Z) / 2);
const PROXY_GEO = new THREE.CylinderGeometry(1, 1, 0.05, 20).rotateX(Math.PI / 2);
const PROXY_MAT = new THREE.MeshBasicMaterial({ visible: false });

export interface PanelHit {
  control: PanelControl;
  object: THREE.Object3D;
}

interface Button {
  cap: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  base: number; // emissive when idle
  pressed: number;
  click: number; // remaining click animation
  hover: boolean;
}

export class PanelDynamic {
  readonly group = new THREE.Group();
  readonly pickables: THREE.Object3D[] = [];
  readonly stackLight: THREE.PointLight;
  private readonly buttons = new Map<PanelControl, Button>();
  private readonly estopHead: THREE.Group;
  private readonly estopMat: THREE.MeshStandardMaterial;
  private estopIn = false;
  private estopAnim = 0;
  private estopHover = false;
  private estopClick = 0;
  private readonly lamps: { mat: THREE.MeshStandardMaterial; color: THREE.Color; on: boolean; level: number }[] = [];
  private readonly hmiCanvas: HTMLCanvasElement;
  private readonly hmiCtx: CanvasRenderingContext2D;
  private readonly hmiTex: THREE.CanvasTexture;
  private readonly hmiMat: THREE.MeshStandardMaterial;
  private hmiKey = '';
  private motor = false;
  private cellName = 'CELL A';

  constructor(kit: Kit) {
    this.group.position.set(PANEL_X, 0, PANEL_Z);
    const face = new THREE.Group();
    face.position.copy(facePoint(0, 0, 0.0015));
    face.rotation.x = FACE_ROT;
    this.group.add(face);

    const capGeo = lathe(
      [
        [0.0162, 0.0],
        [0.016, 0.0095],
        [0.0145, 0.0118],
        [0.009, 0.0132],
        [0, 0.0135],
      ],
      48,
    ).rotateX(Math.PI / 2);
    const colors: Record<'START' | 'STOP' | 'RESET', number> = { START: 0x19b34a, STOP: 0xd3201f, RESET: 0x1f63d8 };
    for (const name of ['START', 'STOP', 'RESET'] as const) {
      const p = BTN[name];
      const mat = new THREE.MeshStandardMaterial({
        color: colors[name],
        emissive: colors[name],
        emissiveIntensity: 0.06,
        roughness: 0.22,
        metalness: 0,
      });
      const cap = put(face, capGeo, mat, p.u, p.v, 0.0);
      cap.userData.control = name;
      this.pickables.push(cap);
      this.addProxy(face, name, p.u, p.v, 0.038);
      this.buttons.set(name, { cap, mat, base: 0.06, pressed: 0, click: 0, hover: false });
    }

    // E-stop mushroom head
    this.estopHead = new THREE.Group();
    this.estopHead.position.set(ESTOP_UV.u, ESTOP_UV.v, 0.021);
    face.add(this.estopHead);
    this.estopMat = new THREE.MeshStandardMaterial({ color: 0xd0141a, roughness: 0.18, metalness: 0, emissive: 0xff1010, emissiveIntensity: 0.0 });
    put(this.estopHead, new THREE.CylinderGeometry(0.013, 0.013, 0.02, 32).rotateX(Math.PI / 2), kit.blackPlastic, 0, 0, 0.0);
    const head = put(
      this.estopHead,
      lathe(
        [
          [0.012, 0.0],
          [0.016, 0.003],
          [0.031, 0.0045],
          [0.0365, 0.008],
          [0.037, 0.0135],
          [0.033, 0.021],
          [0.024, 0.027],
          [0.012, 0.0295],
          [0, 0.03],
        ],
        64,
      ).rotateX(Math.PI / 2),
      this.estopMat,
      0,
      0,
      0.006,
    );
    head.userData.control = 'ESTOP';
    this.pickables.push(head);
    this.addProxy(face, 'ESTOP', ESTOP_UV.u, ESTOP_UV.v, 0.064);

    // HMI
    [this.hmiCanvas, this.hmiCtx] = makeCanvas(512, 224);
    this.hmiTex = toTexture(this.hmiCanvas, true, false);
    this.hmiMat = new THREE.MeshStandardMaterial({
      color: 0x050607,
      emissive: 0xffffff,
      emissiveMap: this.hmiTex,
      emissiveIntensity: 1.35,
      roughness: 0.12,
      metalness: 0.1,
    });
    put(face, new THREE.PlaneGeometry(0.184, 0.0805), this.hmiMat, HMI_UV.u, HMI_UV.v, 0.0105);

    // stack light lenses (Fresnel-ribbed)
    const ribs: [number, number][] = [];
    for (let i = 0; i <= 14; i++) ribs.push([i % 2 === 0 ? 0.0345 : 0.0358, (i / 14) * STACK_SEG]);
    const lensGeo = lathe(ribs, 48);
    const tower = new THREE.Group();
    tower.position.copy(TOWER_POS);
    tower.scale.setScalar(TOWER_SCALE);
    this.group.add(tower);
    const t0 = TOWER_T0;
    const defs: [number, number][] = [
      [0x2bff6a, 0x0b2412],
      [0xffa21a, 0x2a1a06],
      [0xff2a1f, 0x2a0707],
    ];
    defs.forEach(([on, off], i) => {
      const mat = new THREE.MeshStandardMaterial({ color: off, emissive: on, emissiveIntensity: 0, roughness: 0.12, metalness: 0.05 });
      put(tower, lensGeo, mat, 0, t0 + 0.008 + i * (STACK_SEG + 0.008), 0);
      put(tower, new THREE.CylinderGeometry(0.02, 0.02, STACK_SEG * 0.8, 24), mat, 0, t0 + 0.008 + i * (STACK_SEG + 0.008) + STACK_SEG / 2, 0);
      this.lamps.push({ mat, color: new THREE.Color(on), on: false, level: 0 });
    });
    // keep the light well clear of the glossy lenses (fp16 overflow otherwise)
    this.stackLight = new THREE.PointLight(0xffffff, 0, 3.0, 2);
    this.stackLight.position.set(TOWER_POS.x, TOWER_POS.y + (t0 + 0.16) * TOWER_SCALE, TOWER_POS.z + 0.34);
    this.group.add(this.stackLight);
    this.drawHmi({ motor: false, estop: false, guardOpen: false, stuck: '', red: false, amber: false });
  }

  /** Invisible, generous hit target so small buttons stay clickable from afar. */
  private addProxy(face: THREE.Object3D, control: PanelControl, u: number, v: number, r: number): void {
    const proxy = new THREE.Mesh(PROXY_GEO, PROXY_MAT);
    proxy.scale.set(r, r, 1);
    proxy.position.set(u, v, 0.02);
    proxy.visible = false;
    proxy.userData.control = control;
    face.add(proxy);
    this.pickables.push(proxy);
  }

  setCellName(name: string): void {
    if (name === this.cellName) return;
    this.cellName = name;
    this.hmiKey = '';
    this.drawHmi(this.hmiState);
  }

  private hmiState = { motor: false, estop: false, guardOpen: false, stuck: '', red: false, amber: false };

  apply(inp: Record<string, 0 | 1>, out: Record<string, 0 | 1>, stuck: string): void {
    this.motor = out.MOTOR === 1;
    for (const name of ['START', 'STOP', 'RESET'] as const) this.buttons.get(name)!.pressed = inp[name] === 1 ? 1 : 0;
    this.estopIn = inp.ESTOP === 1;
    this.lamps[0].on = out.LAMP_GREEN === 1;
    this.lamps[1].on = out.LAMP_AMBER === 1;
    this.lamps[2].on = out.LAMP_RED === 1;
    this.drawHmi({
      motor: this.motor,
      estop: this.estopIn,
      guardOpen: inp.GUARD_CLOSED === 0,
      stuck,
      red: out.LAMP_RED === 1,
      amber: out.LAMP_AMBER === 1,
    });
  }

  setHover(control: PanelControl | null): void {
    for (const [name, b] of this.buttons) b.hover = name === control;
    this.estopHover = control === 'ESTOP';
  }

  clickFeedback(control: PanelControl): void {
    const b = this.buttons.get(control);
    if (b) b.click = 0.18;
    if (control === 'ESTOP') this.estopClick = 0.25;
  }

  update(dt: number, time: number): void {
    for (const [name, b] of this.buttons) {
      if (b.click > 0) b.click = Math.max(0, b.click - dt);
      const down = Math.max(b.pressed, b.click > 0 ? 1 : 0);
      b.cap.position.z = THREE.MathUtils.lerp(b.cap.position.z, -0.0045 * down, 1 - Math.exp(-dt * 30));
      let e = b.base + down * 1.6;
      if (name === 'START' && this.motor) e = 2.4 + down * 1.2;
      if (b.hover) e += 0.9;
      b.mat.emissiveIntensity = e;
    }
    if (this.estopClick > 0) this.estopClick = Math.max(0, this.estopClick - dt);
    const target = this.estopIn || this.estopClick > 0 ? 1 : 0;
    this.estopAnim = THREE.MathUtils.lerp(this.estopAnim, target, 1 - Math.exp(-dt * 22));
    this.estopHead.position.z = 0.021 - 0.009 * this.estopAnim;
    this.estopMat.emissiveIntensity = (this.estopIn ? 0.35 + 0.25 * Math.sin(time * 8) : 0) + (this.estopHover ? 0.6 : 0);
    // lamps: quick incandescent-like ramp
    let r = 0;
    let gc = 0;
    let bc = 0;
    let n = 0;
    for (const l of this.lamps) {
      l.level = THREE.MathUtils.lerp(l.level, l.on ? 1 : 0, 1 - Math.exp(-dt * 18));
      l.mat.emissiveIntensity = l.level * 2.1;
      if (l.level > 0.01) {
        r += l.color.r * l.level;
        gc += l.color.g * l.level;
        bc += l.color.b * l.level;
        n += l.level;
      }
    }
    if (n > 0.01) this.stackLight.color.setRGB(r / n, gc / n, bc / n);
    this.stackLight.intensity = Math.min(n, 1.5) * 0.9;
  }

  private drawHmi(s: { motor: boolean; estop: boolean; guardOpen: boolean; stuck: string; red: boolean; amber: boolean }): void {
    this.hmiState = s;
    const key = JSON.stringify(s) + this.cellName;
    if (key === this.hmiKey) return;
    this.hmiKey = key;
    const g = this.hmiCtx;
    const W = this.hmiCanvas.width;
    const H = this.hmiCanvas.height;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0d1a26');
    bg.addColorStop(1, '#06090d');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1d3347';
    g.fillRect(0, 0, W, 40);
    g.fillStyle = '#9fd3ff';
    g.font = `700 22px ${FONT}`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(`STOP/PROVE · ${this.cellName}`, 14, 21);
    let status = 'STOPPED';
    let col = '#c9d1d9';
    if (s.motor) {
      status = 'RUNNING';
      col = '#3dff8a';
    }
    if (s.guardOpen) {
      status = 'GUARD OPEN';
      col = '#ffb020';
    }
    if (s.estop) {
      status = 'E-STOP';
      col = '#ff4036';
    }
    if (s.stuck) {
      status = 'SENSOR FAULT';
      col = '#ff4df0';
    }
    g.fillStyle = col;
    g.font = `800 64px ${FONT}`;
    g.fillText(status, 14, 98);
    g.font = `600 20px ${FONT}`;
    g.fillStyle = '#7f93a6';
    const extra = s.stuck ? `${s.stuck} forced` : s.red ? 'Alarm active' : s.amber ? 'Attention' : 'Line ready';
    g.fillText(`MOTOR ${s.motor ? 'ON ' : 'OFF'}  ·  ${extra}`, 14, 158);
    // little bar graph decoration
    for (let i = 0; i < 18; i++) {
      g.fillStyle = s.motor ? `rgba(61,255,138,${0.25 + (i % 5) * 0.12})` : 'rgba(127,147,166,0.25)';
      g.fillRect(14 + i * 27, 186, 20, 20);
    }
    this.hmiTex.needsUpdate = true;
  }

  dispose(): void {
    for (const b of this.buttons.values()) b.mat.dispose();
    this.estopMat.dispose();
    for (const l of this.lamps) l.mat.dispose();
    this.hmiTex.dispose();
    this.hmiMat.dispose();
  }
}

/** World-ish anchor points (plant coordinates) for focus and violation tags. */
export const PANEL_ANCHOR = new THREE.Vector3(PANEL_X, PANEL_BASE_Y + 0.25, PANEL_Z);
