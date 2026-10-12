// Retro-reflective photo-eyes PE_IN / PE_END: bracket, housing, reflector and a live beam.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Kit } from '../materials';
import { additiveMaterial } from '../materials';
import { put } from '../geom';
import { BOX_L, BOX_W, PE_Y, PE_Z_REFLECTOR, PE_Z_SENSOR, RAIL_TOP, RAIL_Y, RAIL_Z } from '../dims';
import { makeLabel } from '../labels';

const RAIL_OUT = RAIL_Z + 0.0225;
const HOUSING_D = 0.045;
const LENS_Z = PE_Z_SENSOR - HOUSING_D / 2;
const REFLECTOR_FACE = PE_Z_REFLECTOR + 0.006;
const CLEAR_LEN = LENS_Z - REFLECTOR_FACE;

export function buildSensorStatic(root: THREE.Object3D, kit: Kit, x: number): void {
  // bracket on the operator-side rail
  put(root, new THREE.BoxGeometry(0.032, PE_Y - RAIL_Y + 0.03, 0.003), kit.zinc, x, (PE_Y + RAIL_Y) / 2 + 0.015 - 0.015, RAIL_OUT + 0.0015);
  put(root, new THREE.BoxGeometry(0.032, 0.003, PE_Z_SENSOR - RAIL_OUT), kit.zinc, x, PE_Y - 0.034, (PE_Z_SENSOR + RAIL_OUT) / 2);
  for (const dy of [-0.025, 0.012]) {
    const b = put(root, new THREE.CylinderGeometry(0.005, 0.005, 0.006, 6), kit.zinc, x, RAIL_Y + dy, RAIL_OUT + 0.005);
    b.rotation.x = Math.PI / 2;
  }
  // M12 connector + cable down into the duct
  put(root, new THREE.CylinderGeometry(0.0065, 0.0065, 0.022, 16), kit.steelDark, x, PE_Y - 0.04, PE_Z_SENSOR + 0.008);
  const cable = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x, PE_Y - 0.05, PE_Z_SENSOR + 0.008),
    new THREE.Vector3(x + 0.01, PE_Y - 0.1, PE_Z_SENSOR + 0.02),
    new THREE.Vector3(x + 0.03, RAIL_TOP - 0.06, RAIL_OUT + 0.05),
    new THREE.Vector3(x + 0.06, RAIL_TOP - 0.12, RAIL_OUT + 0.03),
  ]);
  put(root, new THREE.TubeGeometry(cable, 24, 0.0035, 8, false), kit.cable);
  // reflector bracket + reflector on the far rail
  put(root, new THREE.BoxGeometry(0.032, PE_Y - RAIL_Y + 0.03, 0.003), kit.zinc, x, (PE_Y + RAIL_Y) / 2, -RAIL_OUT - 0.0015);
  const ref = put(root, new THREE.CylinderGeometry(0.026, 0.026, 0.008, 40), kit.reflector, x, PE_Y, PE_Z_REFLECTOR);
  ref.rotation.x = Math.PI / 2;
  const rim = put(root, new THREE.TorusGeometry(0.026, 0.0025, 8, 40), kit.blackPlastic, x, PE_Y, PE_Z_REFLECTOR + 0.004);
  rim.rotation.set(0, 0, 0);
  put(root, new THREE.BoxGeometry(0.032, 0.05, 0.003), kit.zinc, x, PE_Y - 0.01, PE_Z_REFLECTOR - 0.006);
}

const C_CLEAR = new THREE.Color(0.25, 2.6, 0.9);
const C_BLOCK = new THREE.Color(3.2, 0.7, 0.12);
const C_STUCK = new THREE.Color(2.8, 0.25, 2.6);

export class PhotoEye {
  readonly group = new THREE.Group();
  readonly tag: CSS2DObject;
  readonly sig: CSS2DObject;
  private readonly sigValue: HTMLElement;
  private sigShown = -1;
  private readonly housingMat: THREE.MeshStandardMaterial;
  private readonly ledPower: THREE.MeshStandardMaterial;
  private readonly ledOut: THREE.MeshStandardMaterial;
  private readonly beamCore: THREE.Mesh;
  private readonly beamGlow: THREE.Mesh;
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly hit: THREE.Sprite;
  private readonly hitMat: THREE.SpriteMaterial;
  private blocked = false;
  private stuck = false;
  private beamLen = CLEAR_LEN;
  wantTag = false;

  constructor(
    kit: Kit,
    readonly x: number,
    readonly name: string,
  ) {
    this.housingMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.1, emissive: 0xff2ee6, emissiveIntensity: 0 });
    put(this.group, new RoundedBoxGeometry(0.028, 0.062, HOUSING_D, 3, 0.004), this.housingMat, x, PE_Y, PE_Z_SENSOR);
    // lens (dark glass) facing the reflector
    const lens = put(this.group, new THREE.PlaneGeometry(0.02, 0.026), kit.glass, x, PE_Y + 0.008, LENS_Z - 0.0006);
    lens.rotation.y = Math.PI;
    // status LEDs on top
    this.ledPower = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0x33ff66, emissiveIntensity: 2.2 });
    this.ledOut = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0xff8a1a, emissiveIntensity: 0 });
    put(this.group, new THREE.BoxGeometry(0.007, 0.003, 0.008), this.ledPower, x - 0.006, PE_Y + 0.0315, PE_Z_SENSOR + 0.01);
    put(this.group, new THREE.BoxGeometry(0.007, 0.003, 0.008), this.ledOut, x + 0.006, PE_Y + 0.0315, PE_Z_SENSOR + 0.01);

    // beam: unit length along -z from the lens, scaled per frame
    const coreGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 1, 8, 1, true);
    coreGeo.rotateX(Math.PI / 2).translate(0, 0, -0.5);
    const glowGeo = new THREE.CylinderGeometry(0.011, 0.011, 1, 16, 1, true);
    glowGeo.rotateX(Math.PI / 2).translate(0, 0, -0.5);
    this.coreMat = additiveMaterial(C_CLEAR, undefined, 0.95);
    this.glowMat = additiveMaterial(C_CLEAR, undefined, 0.16);
    this.beamCore = put(this.group, coreGeo, this.coreMat, x, PE_Y + 0.008, LENS_Z);
    this.beamGlow = put(this.group, glowGeo, this.glowMat, x, PE_Y + 0.008, LENS_Z);
    this.beamCore.renderOrder = 5;
    this.beamGlow.renderOrder = 5;
    this.hitMat = new THREE.SpriteMaterial({ map: kit.glow, color: C_CLEAR, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9, fog: false });
    this.hit = new THREE.Sprite(this.hitMat);
    this.hit.scale.setScalar(0.06);
    this.hit.renderOrder = 6;
    this.group.add(this.hit);

    this.sig = makeLabel('sp3d-sig', `${name}<b>0</b>`);
    this.sig.position.set(x, PE_Y + 0.085, PE_Z_SENSOR + 0.02);
    this.sig.visible = false;
    this.group.add(this.sig);
    this.sigValue = this.sig.element.querySelector('b') as HTMLElement;

    this.tag = makeLabel('sp3d-stuck', `${name} STUCK`);
    this.tag.position.set(x, PE_Y + 0.13, PE_Z_SENSOR);
    this.tag.visible = false;
    this.group.add(this.tag);
    this.setBeam(false, undefined);
  }

  /** blocked = PE input is 1. boxXs: centres of boxes on the belt (to end the beam at the box face). */
  apply(blocked: boolean, stuck: boolean, boxXs: number[]): void {
    this.blocked = blocked;
    this.stuck = stuck;
    this.wantTag = stuck;
    let len = CLEAR_LEN;
    if (blocked) {
      for (const bx of boxXs) {
        if (Math.abs(bx - this.x) <= BOX_L / 2 + 0.005) {
          len = LENS_Z - BOX_W / 2;
          break;
        }
      }
    }
    this.beamLen = len;
    this.ledOut.emissiveIntensity = blocked ? 3.0 : 0;
    const v = blocked ? 1 : 0;
    if (v !== this.sigShown) {
      this.sigShown = v;
      this.sigValue.textContent = String(v);
      this.sigValue.className = v ? 'on' : '';
    }
  }

  /** Fade the signal label in when the camera is close (distance in metres). */
  setLabelProximity(distance: number, active: boolean): void {
    const o = Math.max(0, Math.min(1, (4.4 - distance) / 1.4));
    const show = active && o > 0.02 && !this.stuck;
    this.sig.visible = show;
    if (show) this.sig.element.style.opacity = o.toFixed(2);
  }

  private setBeam(_flicker: boolean, color?: THREE.Color): void {
    const c = color ?? (this.blocked ? C_BLOCK : C_CLEAR);
    this.coreMat.color.copy(c);
    this.glowMat.color.copy(c);
    this.hitMat.color.copy(c);
  }

  update(time: number): void {
    this.beamCore.scale.z = this.beamLen;
    this.beamGlow.scale.z = this.beamLen;
    this.hit.position.set(this.x, PE_Y + 0.008, LENS_Z - this.beamLen + 0.004);
    if (this.stuck) {
      // erratic magenta flicker
      const f = Math.sin(time * 37) * Math.sin(time * 11.3) > -0.2 ? 1 : 0.15;
      const c = f > 0.5 ? C_STUCK : this.blocked ? C_BLOCK : C_CLEAR;
      this.setBeam(true, c);
      this.coreMat.opacity = 0.5 + 0.5 * f;
      this.housingMat.emissiveIntensity = 0.35 + 0.65 * f;
      this.ledPower.emissive.setRGB(1, 0.15, 0.9);
      this.ledPower.emissiveIntensity = 3.5 * f;
    } else {
      this.setBeam(false);
      const pulse = 0.85 + 0.15 * Math.sin(time * 6 + this.x * 3);
      this.coreMat.opacity = 0.95 * pulse;
      this.housingMat.emissiveIntensity = 0;
      this.ledPower.emissive.setRGB(0.2, 1, 0.4);
      this.ledPower.emissiveIntensity = 2.2;
    }
  }

  dispose(): void {
    this.housingMat.dispose();
    this.ledPower.dispose();
    this.ledOut.dispose();
    this.coreMat.dispose();
    this.glowMat.dispose();
    this.hitMat.dispose();
    this.beamCore.geometry.dispose();
    this.beamGlow.geometry.dispose();
  }
}
