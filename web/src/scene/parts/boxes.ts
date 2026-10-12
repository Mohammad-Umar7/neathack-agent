// Cardboard boxes: placed from frame data while on the belt, handed to the gantry when
// picked, and given a short rigid-body-looking tumble off the discharge end when dropped.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Kit } from '../materials';
import { BELT_LEN, BELT_TOP, BOX_H, BOX_L, BOX_W } from '../dims';
import type { Gantry } from './gantry';
import { rng } from '../textures';

type VisState = 'belt' | 'carried' | 'placed' | 'falling' | 'floor' | 'hidden';

interface BoxVis {
  id: number;
  group: THREE.Group;
  state: VisState;
  seen: boolean;
  t: number; // animation clock (s)
  // drop animation data
  x0: number;
  rest: THREE.Vector3;
  restQ: THREE.Quaternion;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  pop: number;
  linger: number;
}

const G = 9.81;
const TIP_T = 0.32;
const PIVOT = new THREE.Vector3(BELT_LEN + 0.03, BELT_TOP, 0);

export class BoxField {
  readonly group = new THREE.Group();
  private readonly boxes = new Map<number, BoxVis>();
  private readonly geo: THREE.BufferGeometry;
  private readonly ringGeo: THREE.PlaneGeometry;
  private slot = 0;
  private readonly placed: BoxVis[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly kit: Kit,
    private readonly gantry: Gantry,
  ) {
    this.geo = new RoundedBoxGeometry(BOX_L, BOX_H, BOX_W, 3, 0.012);
    this.ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  }

  private create(id: number): BoxVis {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(this.geo, this.kit.boxMaterials(id));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    this.group.add(group);
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3, 0.25, 0.15),
      alphaMap: this.kit.ring,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.visible = false;
    ring.renderOrder = 4;
    this.group.add(ring);
    const r = rng(id * 97 + 13);
    const rest = new THREE.Vector3(BELT_LEN + 0.42 + r() * 0.22, BOX_L / 2, (r() - 0.5) * 0.5);
    const yaw = (r() - 0.5) * 1.2;
    const restQ = new THREE.Quaternion()
      .setFromAxisAngle(this.yAxis, yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(this.zAxis, -Math.PI / 2));
    const vis: BoxVis = { id, group, state: 'hidden', seen: false, t: 0, x0: 0, rest, restQ, ring, ringMat, pop: 0, linger: 0 };
    this.boxes.set(id, vis);
    return vis;
  }

  /** Reset all animations (replay jumped backwards). */
  reset(): void {
    for (const b of this.boxes.values()) this.hide(b);
    this.placed.length = 0;
    this.slot = 0;
  }

  apply(frameBoxes: { id: number; x: number; state: 'belt' | 'picked' | 'dropped' }[]): number[] {
    const beltXs: number[] = [];
    for (const b of this.boxes.values()) b.seen = false;
    for (const fb of frameBoxes) {
      let vis = this.boxes.get(fb.id);
      const isNew = !vis || vis.state === 'hidden';
      if (!vis) vis = this.create(fb.id);
      vis.seen = true;
      if (fb.state === 'belt') {
        beltXs.push(fb.x);
        if (vis.state !== 'belt') {
          // (re)appear on the belt; scrubbing backwards also lands here
          if (vis.state === 'placed') this.unplace(vis);
          if (vis.state === 'carried') this.cancelCarried();
          vis.state = 'belt';
          vis.group.visible = true;
          vis.ring.visible = false;
          vis.group.quaternion.identity();
          vis.pop = isNew ? 0.0001 : 1;
        }
        vis.group.position.set(fb.x, BELT_TOP + BOX_H / 2, 0);
        vis.x0 = fb.x;
      } else if (fb.state === 'picked') {
        if (vis.state === 'belt') {
          vis.state = 'carried';
          const slot = this.slot++;
          this.gantry.requestPick(vis.group, vis.x0, slot, () => {
            vis!.state = 'placed';
            this.placed.push(vis!);
            // pallet holds 9; recycle the oldest
            if (this.placed.length > 9) this.hide(this.placed.shift()!);
          });
        } else if (vis.state === 'hidden') {
          // first seen already picked (e.g. after a seek): nothing to show
        }
      } else if (fb.state === 'dropped') {
        if (vis.state === 'belt') {
          vis.state = 'falling';
          vis.t = 0;
          vis.x0 = Math.min(fb.x, BELT_LEN);
          vis.ring.visible = false;
        } else if (vis.state === 'hidden') {
          this.toFloor(vis);
        }
      }
    }
    for (const b of this.boxes.values()) {
      if (!b.seen && b.state === 'belt') this.hide(b);
      if (!b.seen && b.state === 'floor' && b.linger <= 0) b.linger = 3;
      if (b.seen && b.state === 'floor') b.linger = 0;
    }
    return beltXs;
  }

  /** Abort the gantry and drop any box it was holding (replay moved backwards). */
  private cancelCarried(): void {
    this.gantry.reset();
    for (const b of this.boxes.values()) if (b.state === 'carried') this.hide(b);
  }

  private unplace(b: BoxVis): void {
    const i = this.placed.indexOf(b);
    if (i >= 0) this.placed.splice(i, 1);
  }

  private hide(b: BoxVis): void {
    b.state = 'hidden';
    b.group.visible = false;
    b.ring.visible = false;
    b.linger = 0;
  }

  private toFloor(b: BoxVis): void {
    b.state = 'floor';
    b.group.visible = true;
    b.group.position.copy(b.rest);
    b.group.quaternion.copy(b.restQ);
    b.ring.visible = true;
    b.ring.position.set(b.rest.x, 0.004, b.rest.z);
  }

  update(dt: number, time: number): void {
    for (const b of this.boxes.values()) {
      if (b.pop > 0 && b.pop < 1) {
        b.pop = Math.min(1, b.pop + dt * 5);
        const s = 0.85 + 0.15 * (1 - Math.pow(1 - b.pop, 3));
        b.group.scale.setScalar(s);
      } else if (b.group.scale.x !== 1 && b.state !== 'falling') {
        b.group.scale.setScalar(1);
      }
      if (b.state === 'falling') this.animateFall(b, dt);
      if (b.state === 'floor') {
        const p = (time * 1.4 + b.id * 0.37) % 1;
        const s = 0.75 + p * 0.65;
        b.ring.scale.set(s, 1, s);
        b.ringMat.opacity = 0.9 * (1 - p) + 0.1;
        if (b.linger > 0) {
          b.linger -= dt;
          if (b.linger <= 0) this.hide(b);
        }
      }
    }
  }

  private animateFall(b: BoxVis, dt: number): void {
    b.t += dt;
    const t = b.t;
    const c0 = new THREE.Vector3(b.x0, BELT_TOP + BOX_H / 2, 0);
    // phase 1: slide to the lip and tip around the head drum
    const slide = Math.max(0, PIVOT.x + BOX_L * 0.08 - c0.x);
    if (t < TIP_T) {
      const k = t / TIP_T;
      const ang = -0.75 * k * k;
      const pos = new THREE.Vector3(c0.x + slide * k, c0.y, 0);
      this.v.copy(pos).sub(PIVOT).applyAxisAngle(this.zAxis, ang).add(PIVOT);
      b.group.position.copy(this.v);
      b.group.quaternion.setFromAxisAngle(this.zAxis, ang);
      return;
    }
    // phase 2: ballistic fall with spin
    const startPos = new THREE.Vector3(c0.x + slide, c0.y, 0).sub(PIVOT).applyAxisAngle(this.zAxis, -0.75).add(PIVOT);
    const vx = 0.75;
    const vy = 0.15;
    const omega = -4.2;
    const tauHit = (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0.01, startPos.y - b.rest.y))) / G;
    const tau = t - TIP_T;
    if (tau < tauHit) {
      const x = startPos.x + vx * tau;
      const y = startPos.y + vy * tau - 0.5 * G * tau * tau;
      const zDrift = (b.rest.z - startPos.z) * (tau / tauHit) * 0.6;
      b.group.position.set(x, y, zDrift);
      b.group.quaternion.setFromAxisAngle(this.zAxis, -0.75 + omega * tau);
      return;
    }
    // phase 3: bounce and settle into the resting pose
    const s = tau - tauHit;
    const SETTLE = 0.55;
    if (s < SETTLE) {
      const k = s / SETTLE;
      const hitPos = new THREE.Vector3(startPos.x + vx * tauHit, b.rest.y, (b.rest.z - startPos.z) * 0.6);
      const e = 1 - Math.pow(1 - k, 3);
      b.group.position.lerpVectors(hitPos, b.rest, e);
      b.group.position.y = b.rest.y + Math.abs(Math.sin(k * Math.PI * 2)) * 0.07 * (1 - k);
      const hitQ = this.q.setFromAxisAngle(this.zAxis, -0.75 + omega * tauHit);
      b.group.quaternion.slerpQuaternions(hitQ, b.restQ, Math.min(1, e * 1.08));
      if (!b.ring.visible) {
        b.ring.visible = true;
      }
      b.ring.position.set(b.rest.x, 0.004, b.rest.z);
      return;
    }
    this.toFloor(b);
  }

  /** Centre of the most recent dropped box (for focusing / tags). */
  lastDropPosition(out: THREE.Vector3): THREE.Vector3 | null {
    let best: BoxVis | null = null;
    for (const b of this.boxes.values()) if (b.state === 'falling' || b.state === 'floor') best = b;
    return best ? out.copy(best.rest) : null;
  }

  dispose(): void {
    this.geo.dispose();
    this.ringGeo.dispose();
    for (const b of this.boxes.values()) b.ringMat.dispose();
  }
}

export const DROP_ANCHOR = new THREE.Vector3(BELT_LEN + 0.45, 0.6, 0);
