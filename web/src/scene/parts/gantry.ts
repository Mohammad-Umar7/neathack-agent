// Overhead pick gantry (linear Z/Y axes) with a 4-cup vacuum head, plus the outfeed pallet.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Kit } from '../materials';
import { barBetween, lathe, mergeLocal, profileBar, put } from '../geom';
import {
  BELT_TOP,
  BOX_H,
  GANTRY_BEAM_Y,
  GANTRY_Z_BACK,
  GANTRY_Z_FRONT,
  HEAD_PARK_Y,
  PALLET_SLOTS_Z,
  PALLET_TOP,
  PALLET_X,
  PALLET_Z,
  PICK_X,
} from '../dims';

const BEAM_X = PICK_X - 0.12;
const CUP_H = 0.05;
const LIFT_Y = 1.82;

export function buildGantryStatic(root: THREE.Object3D, kit: Kit): void {
  const postTop = GANTRY_BEAM_Y + 0.045;
  for (const z of [GANTRY_Z_FRONT, GANTRY_Z_BACK]) {
    root.add(barBetween(profileBar(2, 2, postTop - 0.02), kit.alu, new THREE.Vector3(BEAM_X, 0.02, z), new THREE.Vector3(BEAM_X, postTop, z)));
    put(root, new RoundedBoxGeometry(0.22, 0.02, 0.22, 2, 0.005), kit.aluDark, BEAM_X, 0.01, z);
    for (const [dx, dz] of [
      [-0.08, -0.08],
      [0.08, 0.08],
      [-0.08, 0.08],
      [0.08, -0.08],
    ]) {
      put(root, new THREE.CylinderGeometry(0.01, 0.01, 0.014, 6), kit.zinc, BEAM_X + dx, 0.025, z + dz);
    }
    // knee brace
    const dir = z > 0 ? -1 : 1;
    root.add(
      barBetween(
        profileBar(1, 1, 0.42),
        kit.alu,
        new THREE.Vector3(BEAM_X, GANTRY_BEAM_Y - 0.33, z + dir * 0.04),
        new THREE.Vector3(BEAM_X, GANTRY_BEAM_Y - 0.04, z + dir * 0.33),
      ),
    );
  }
  // beam with end caps
  const zf = GANTRY_Z_FRONT + 0.045;
  const zb = GANTRY_Z_BACK - 0.045;
  root.add(barBetween(profileBar(2, 2, zf - zb), kit.alu, new THREE.Vector3(BEAM_X, GANTRY_BEAM_Y, zf), new THREE.Vector3(BEAM_X, GANTRY_BEAM_Y, zb)));
  for (const z of [zf, zb]) put(root, new RoundedBoxGeometry(0.1, 0.1, 0.012, 2, 0.004), kit.aluDark, BEAM_X, GANTRY_BEAM_Y, z + Math.sign(z) * 0.006);
  // linear guide rail on the +x face
  put(root, new THREE.BoxGeometry(0.012, 0.022, zf - zb - 0.06), kit.steel, BEAM_X + 0.051, GANTRY_BEAM_Y, (zf + zb) / 2);
  // servo motor at the front end of the beam
  put(root, new RoundedBoxGeometry(0.09, 0.09, 0.16, 3, 0.012), kit.blackPlastic, BEAM_X, GANTRY_BEAM_Y, zf + 0.09);
  put(root, new THREE.CylinderGeometry(0.03, 0.03, 0.02, 24).rotateX(Math.PI / 2), kit.aluDark, BEAM_X, GANTRY_BEAM_Y, zf + 0.18);
  // energy chain lying on the beam
  const link = new RoundedBoxGeometry(0.06, 0.03, 0.028, 2, 0.004);
  for (let z = zf - 0.05; z > -0.55; z -= 0.032) put(root, link, kit.blackPlastic, BEAM_X, GANTRY_BEAM_Y + 0.062, z);
  const tray = new THREE.BoxGeometry(0.08, 0.004, zf - zb);
  put(root, tray, kit.zinc, BEAM_X, GANTRY_BEAM_Y + 0.047, (zf + zb) / 2);

  // outfeed pallet (0.8 x 1.0)
  const px = PALLET_X;
  const pz = PALLET_Z;
  for (let i = 0; i < 5; i++) {
    put(root, new THREE.BoxGeometry(0.14, 0.022, 1.0), kit.wood, px - 0.33 + i * 0.165, PALLET_TOP - 0.011, pz);
  }
  for (const dx of [-0.33, 0, 0.33]) {
    for (const dz of [-0.42, 0, 0.42]) put(root, new THREE.BoxGeometry(0.14, 0.078, 0.14), kit.wood, px + dx, 0.061, pz + dz);
  }
  for (const dz of [-0.42, 0, 0.42]) put(root, new THREE.BoxGeometry(0.8, 0.022, 0.14), kit.wood, px, 0.011, pz + dz);
  for (const dz of [-0.42, 0, 0.42]) put(root, new THREE.BoxGeometry(0.8, 0.022, 0.14), kit.wood, px, 0.111, pz + dz);
}

interface PickJob {
  box: THREE.Object3D;
  fromX: number;
  slot: number;
  onDone: () => void;
}

const PHASES = [
  ['approach', 0.55],
  ['grip', 0.2],
  ['lift', 0.45],
  ['traverse', 0.75],
  ['lower', 0.45],
  ['release', 0.18],
  ['retract', 0.35],
  ['return', 0.6],
] as const;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function slotPosition(slot: number, out: THREE.Vector3): THREE.Vector3 {
  const s = slot % 9;
  const layer = Math.floor(s / 3);
  const z = PALLET_SLOTS_Z[s % 3];
  return out.set(PALLET_X, PALLET_TOP + BOX_H / 2 + layer * BOX_H, z);
}

export class Gantry {
  readonly group = new THREE.Group();
  private readonly carriage = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly cups: THREE.Mesh[] = [];
  private readonly vacMat: THREE.MeshStandardMaterial;
  private readonly queue: PickJob[] = [];
  private job: PickJob | null = null;
  private phase = 0;
  private phaseT = 0;
  private carZ = 0;
  private cupY = HEAD_PARK_Y;
  private readonly tmp = new THREE.Vector3();

  constructor(kit: Kit) {
    this.group.add(this.carriage);
    this.group.add(this.head);
    // carriage block riding on the guide rail
    put(this.carriage, new RoundedBoxGeometry(0.05, 0.16, 0.2, 2, 0.008), kit.aluDark, BEAM_X + 0.072, GANTRY_BEAM_Y, 0);
    put(this.carriage, new RoundedBoxGeometry(0.06, 0.22, 0.12, 2, 0.008), kit.aluDark, PICK_X - 0.03, GANTRY_BEAM_Y - 0.02, 0);
    put(this.carriage, new THREE.CylinderGeometry(0.028, 0.028, 0.12, 24), kit.blackPlastic, PICK_X - 0.03, GANTRY_BEAM_Y + 0.15, 0);
    // vertical axis (moves with the head)
    const rod = profileBar(1, 1, 1.25);
    const r = barBetween(rod, kit.alu, new THREE.Vector3(PICK_X, CUP_H + 0.02, 0), new THREE.Vector3(PICK_X, CUP_H + 1.27, 0));
    this.head.add(r);
    // head plate, ejector, cups and hoses
    put(this.head, new RoundedBoxGeometry(0.36, 0.018, 0.25, 2, 0.006), kit.aluDark, PICK_X, CUP_H + 0.009, 0);
    put(this.head, new RoundedBoxGeometry(0.09, 0.05, 0.07, 2, 0.006), kit.alu, PICK_X, CUP_H + 0.045, 0.07);
    this.vacMat = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0x2a8bff, emissiveIntensity: 0.15 });
    put(this.head, new THREE.BoxGeometry(0.012, 0.008, 0.004), this.vacMat, PICK_X + 0.02, CUP_H + 0.05, 0.106);
    const bellows: [number, number][] = [
      [0.024, 0],
      [0.026, 0.004],
      [0.02, 0.012],
      [0.022, 0.018],
      [0.016, 0.025],
      [0.018, 0.031],
      [0.012, 0.038],
      [0.011, 0.05],
    ];
    const cupGeo = lathe(bellows, 32);
    const cupMat = kit.m(new THREE.MeshStandardMaterial({ color: 0x1d6fd6, roughness: 0.55 }));
    for (const dx of [-0.13, 0.13]) {
      for (const dz of [-0.085, 0.085]) {
        const c = put(this.head, cupGeo, cupMat, PICK_X + dx, 0, dz);
        this.cups.push(c);
        const hose = new THREE.CatmullRomCurve3([
          new THREE.Vector3(PICK_X + dx, CUP_H + 0.02, dz),
          new THREE.Vector3(PICK_X + dx * 0.7, CUP_H + 0.05, dz * 0.9),
          new THREE.Vector3(PICK_X + dx * 0.3, CUP_H + 0.065, 0.06),
          new THREE.Vector3(PICK_X, CUP_H + 0.055, 0.07),
        ]);
        put(this.head, new THREE.TubeGeometry(hose, 16, 0.004, 8, false), kit.cable);
      }
    }
    mergeLocal(this.carriage);
    mergeLocal(this.head);
    this.applyPose();
  }

  /** Queue a pick. The gantry moves `box` (a sibling in plant coordinates) until it is on the pallet. */
  requestPick(box: THREE.Object3D, fromX: number, slot: number, onDone: () => void): void {
    this.queue.push({ box, fromX, slot, onDone });
  }

  get busy(): boolean {
    return !!this.job || this.queue.length > 0;
  }

  /** Cancel everything and park (used when the replay jumps backwards). */
  reset(): void {
    this.queue.length = 0;
    this.job = null;
    this.carZ = 0;
    this.cupY = HEAD_PARK_Y;
    this.vacMat.emissiveIntensity = 0.15;
    this.applyPose();
  }

  update(dt: number): void {
    if (!this.job && this.queue.length) {
      this.job = this.queue.shift()!;
      this.phase = 0;
      this.phaseT = 0;
    }
    const job = this.job;
    if (!job) {
      // idle: drift back to park
      this.carZ += (0 - this.carZ) * (1 - Math.exp(-dt * 3));
      this.cupY += (HEAD_PARK_Y - this.cupY) * (1 - Math.exp(-dt * 3));
      this.applyPose();
      return;
    }
    const speed = this.queue.length ? 1.8 : 1;
    this.phaseT += dt * speed;
    while (this.job && this.phaseT >= PHASES[this.phase][1]) {
      this.phaseT -= PHASES[this.phase][1];
      this.phase++;
      if (this.phase === 6) {
        // released onto the pallet
        slotPosition(job.slot, this.tmp);
        job.box.position.copy(this.tmp);
        job.box.rotation.set(0, 0, 0);
        job.onDone();
      }
      if (this.phase >= PHASES.length) {
        this.job = null;
        this.phaseT = 0;
      }
    }
    if (!this.job) {
      this.applyPose();
      return;
    }
    const [name, dur] = PHASES[this.phase];
    const k = ease(Math.min(1, this.phaseT / dur));
    const grabY = BELT_TOP + BOX_H + 0.002;
    const slot = slotPosition(job.slot, this.tmp).clone();
    const slotZ = slot.z;
    const placeY = slot.y + BOX_H / 2 + 0.002;
    let carry = false;
    switch (name) {
      case 'approach':
        this.cupY = THREE.MathUtils.lerp(HEAD_PARK_Y, grabY, k);
        this.carZ = THREE.MathUtils.lerp(this.carZ, 0, k);
        this.vacMat.emissiveIntensity = 0.15;
        break;
      case 'grip':
        this.cupY = grabY - 0.006 * Math.sin(k * Math.PI);
        this.vacMat.emissiveIntensity = 0.15 + 3.5 * k;
        carry = true;
        break;
      case 'lift':
        this.cupY = THREE.MathUtils.lerp(grabY, LIFT_Y, k);
        carry = true;
        break;
      case 'traverse':
        this.cupY = LIFT_Y;
        this.carZ = THREE.MathUtils.lerp(0, slotZ, k);
        carry = true;
        break;
      case 'lower':
        this.carZ = slotZ;
        this.cupY = THREE.MathUtils.lerp(LIFT_Y, placeY, k);
        carry = true;
        break;
      case 'release':
        this.cupY = placeY;
        this.vacMat.emissiveIntensity = 3.65 * (1 - k) + 0.15;
        carry = true;
        break;
      case 'retract':
        this.cupY = THREE.MathUtils.lerp(placeY, LIFT_Y, k);
        break;
      case 'return':
        this.carZ = THREE.MathUtils.lerp(slotZ, 0, k);
        this.cupY = THREE.MathUtils.lerp(LIFT_Y, HEAD_PARK_Y, k);
        break;
    }
    if (carry) {
      const settle = name === 'grip' ? 0 : 1;
      const bx = name === 'lift' ? THREE.MathUtils.lerp(job.fromX, PICK_X, k) : name === 'grip' ? job.fromX : PICK_X;
      job.box.position.set(bx, this.cupY - BOX_H / 2 - 0.002 * settle, this.carZ);
      // a little sway while traversing
      job.box.rotation.set(name === 'traverse' ? Math.sin(k * Math.PI) * 0.04 : 0, 0, 0);
    }
    this.applyPose();
  }

  private applyPose(): void {
    this.carriage.position.z = this.carZ;
    this.head.position.set(0, this.cupY, this.carZ);
  }

  dispose(): void {
    this.vacMat.dispose();
  }
}
