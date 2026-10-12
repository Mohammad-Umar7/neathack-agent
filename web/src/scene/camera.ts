// Camera rig: OrbitControls with damping, eased preset transitions, a slow cinematic
// orbit ('auto'), an intro dolly and a barely-there idle drift.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface Tween {
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPos: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  dur: number;
  ease: (t: number) => number;
  then?: () => void;
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutQuint = (t: number) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2);

export class CameraRig {
  readonly controls: OrbitControls;
  private tween: Tween | null = null;
  private auto = false;
  private idle = 0;
  private time = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    const c = new OrbitControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.065;
    c.minDistance = 1.0;
    c.maxDistance = 38;
    c.maxPolarAngle = Math.PI * 0.485;
    c.minPolarAngle = 0.12;
    c.screenSpacePanning = true;
    c.rotateSpeed = 0.7;
    c.zoomSpeed = 0.9;
    c.panSpeed = 0.8;
    c.autoRotateSpeed = 0.45;
    c.addEventListener('start', () => {
      this.tween = null;
      this.auto = false;
      c.autoRotate = false;
      this.idle = -1e9; // user is driving
    });
    c.addEventListener('end', () => {
      this.idle = 0;
    });
    this.controls = c;
  }

  get isAuto(): boolean {
    return this.auto;
  }

  /** Jump without animation. */
  set(pos: THREE.Vector3, target: THREE.Vector3): void {
    this.tween = null;
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    this.controls.update();
  }

  goTo(pos: THREE.Vector3, target: THREE.Vector3, dur = 1.9, ease: (t: number) => number = easeInOutCubic, then?: () => void): void {
    this.auto = false;
    this.controls.autoRotate = false;
    this.tween = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: pos.clone(),
      toTarget: target.clone(),
      t: 0,
      dur,
      ease,
      then,
    };
    this.idle = 0;
  }

  /** Slow cinematic orbit around `center`, entered with an eased move. */
  startAuto(center: THREE.Vector3, radius: number, height: number): void {
    const off = new THREE.Vector3().subVectors(this.camera.position, center);
    off.y = 0;
    if (off.lengthSq() < 1e-4) off.set(0, 0, 1);
    off.normalize().multiplyScalar(radius);
    const pos = center.clone().add(off).setY(height);
    this.goTo(pos, center, 2.2, easeInOutQuint, () => {
      this.auto = true;
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 0.45;
    });
  }

  update(dt: number): void {
    this.time += dt;
    const tw = this.tween;
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = tw.ease(tw.t);
      // arc slightly upward mid-flight for a crane-like move
      const lift = Math.sin(Math.PI * k) * Math.min(1.2, tw.fromPos.distanceTo(tw.toPos) * 0.08);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      this.camera.position.y += lift;
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      if (tw.t >= 1) {
        this.tween = null;
        tw.then?.();
      }
    } else if (!this.auto) {
      // idle drift: a very slow, small sway once nobody has touched the camera for a while
      this.idle += dt;
      if (this.idle > 5) {
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.06 * Math.sin(this.time * 0.11);
      } else {
        this.controls.autoRotate = false;
      }
    }
    // keep the orbit target near the cells so panning can never lose the scene
    const t = this.controls.target;
    const cx = THREE.MathUtils.clamp(t.x, -11, 11);
    const cy = THREE.MathUtils.clamp(t.y, 0, 3.5);
    const cz = THREE.MathUtils.clamp(t.z, -7, 7);
    if (cx !== t.x || cy !== t.y || cz !== t.z) {
      const dx = cx - t.x;
      const dy = cy - t.y;
      const dz = cz - t.z;
      t.set(cx, cy, cz);
      this.camera.position.x += dx;
      this.camera.position.y += dy;
      this.camera.position.z += dz;
    }
    this.controls.update(dt);
  }

  dispose(): void {
    this.controls.dispose();
  }
}
