// Belt conveyor: T-slot frame, legs and braces, rollers, belt loop, drums and the
// coaxial gear-motor drive at the discharge end.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Kit } from '../materials';
import { barBetween, beltLoopGeometry, mergeLocal, profileBar, put } from '../geom';
import {
  BELT_HALF_W,
  BELT_LEN,
  BELT_THK,
  BELT_TOP,
  DRUM_R,
  DRUM_Y,
  FX0,
  RAIL_TOP,
  RAIL_X0,
  RAIL_X1,
  RAIL_Y,
  RAIL_Z,
  ROLLER_HALF_LEN,
  ROLLER_R,
  ROLLER_Y,
} from '../dims';
import { makeCanvas, rng, toTexture } from '../textures';

export const LEG_X = [0.22, 2.0, 3.78];
export const ROLLER_COUNT = 24;
export const ROLLER_XS = Array.from({ length: ROLLER_COUNT }, (_, i) => 0.16 + (i * (BELT_LEN - 0.32)) / (ROLLER_COUNT - 1));
export const RETURN_XS = [1.05, 2.0, 2.95];
const RETURN_R = 0.02;
const RAIL_OUT = RAIL_Z + 0.0225; // outer face of the rail
const RAIL_BOTTOM = RAIL_TOP - 0.09;
const RETURN_STRAND_Y = DRUM_Y - DRUM_R - BELT_THK; // underside of the return strand
export const DRIVE_Z0 = RAIL_OUT; // drive starts at the outer face of the +z rail

/** Static (never moving) conveyor parts, added under `root` for merging. */
export function buildConveyorStatic(root: THREE.Object3D, kit: Kit): void {
  // side rails, 45x90 T-slot
  const rail = profileBar(1, 2, RAIL_X1 - RAIL_X0);
  for (const z of [-RAIL_Z, RAIL_Z]) put(root, rail, kit.alu, RAIL_X0, RAIL_Y, z);

  // legs, ties, braces (45x45)
  const legLen = RAIL_BOTTOM - 0.085;
  for (const x of LEG_X) {
    for (const z of [-RAIL_Z, RAIL_Z]) {
      root.add(barBetween(profileBar(1, 1, legLen), kit.alu, new THREE.Vector3(x, 0.085, z), new THREE.Vector3(x, RAIL_BOTTOM, z)));
      // levelling foot
      put(root, new THREE.CylinderGeometry(0.042, 0.045, 0.016, 32), kit.rubber, x, 0.008, z);
      put(root, new THREE.CylinderGeometry(0.03, 0.034, 0.008, 32), kit.zinc, x, 0.02, z);
      put(root, new THREE.CylinderGeometry(0.008, 0.008, 0.07, 12), kit.zinc, x, 0.055, z);
      put(root, new THREE.CylinderGeometry(0.014, 0.014, 0.012, 6), kit.zinc, x, 0.07, z);
      put(root, new THREE.BoxGeometry(0.062, 0.008, 0.062), kit.aluDark, x, 0.089, z);
    }
    // cross ties between the leg pair (low and high, below the return strand)
    for (const y of [0.24, 0.6]) {
      root.add(
        barBetween(
          profileBar(1, 1, 2 * RAIL_Z - 0.045),
          kit.alu,
          new THREE.Vector3(x, y, -RAIL_Z + 0.0225),
          new THREE.Vector3(x, y, RAIL_Z - 0.0225),
        ),
      );
    }
  }
  for (const z of [-RAIL_Z, RAIL_Z]) {
    // longitudinal tie
    root.add(
      barBetween(
        profileBar(1, 1, LEG_X[2] - LEG_X[0] - 0.045),
        kit.alu,
        new THREE.Vector3(LEG_X[0] + 0.0225, 0.24, z),
        new THREE.Vector3(LEG_X[2] - 0.0225, 0.24, z),
      ),
    );
    // V braces
    root.add(barBetween(profileBar(1, 1, 1.73), kit.alu, new THREE.Vector3(LEG_X[0] + 0.03, 0.29, z), new THREE.Vector3(LEG_X[1] - 0.03, 0.7, z)));
    root.add(barBetween(profileBar(1, 1, 1.73), kit.alu, new THREE.Vector3(LEG_X[1] + 0.03, 0.7, z), new THREE.Vector3(LEG_X[2] - 0.03, 0.29, z)));
    // corner gussets where legs meet rails
    for (const x of LEG_X) {
      for (const dx of [-1, 1]) {
        const g = put(root, new THREE.BoxGeometry(0.05, 0.05, 0.035), kit.aluDark, x + dx * 0.045, RAIL_BOTTOM - 0.022, z);
        g.rotation.z = dx * Math.PI * 0.25;
        g.scale.set(1, 1, 1);
      }
    }
  }

  // roller shaft nuts on the rail outer faces
  const nut = new THREE.CylinderGeometry(0.0085, 0.0085, 0.006, 6);
  nut.rotateX(Math.PI / 2);
  for (const x of ROLLER_XS) {
    for (const s of [-1, 1]) put(root, nut, kit.zinc, x, ROLLER_Y, s * (RAIL_OUT + 0.003));
  }
  // return roller hangers
  for (const x of RETURN_XS) {
    for (const s of [-1, 1]) {
      put(root, new THREE.BoxGeometry(0.04, RAIL_BOTTOM - (RETURN_STRAND_Y - RETURN_R) + 0.03, 0.005), kit.zinc, x, (RAIL_BOTTOM + RETURN_STRAND_Y - RETURN_R - 0.03) / 2, s * (RAIL_Z - 0.019));
    }
  }

  // bearing flanges at both drums, both sides
  for (const x of [0, BELT_LEN]) {
    for (const s of [-1, 1]) {
      const z = s * (RAIL_OUT + 0.006);
      put(root, new RoundedBoxGeometry(0.1, 0.1, 0.012, 2, 0.008), kit.steelDark, x, DRUM_Y, z);
      const housing = put(root, new THREE.CylinderGeometry(0.03, 0.034, 0.03, 32), kit.steelDark, x, DRUM_Y, z + s * 0.02);
      housing.rotation.x = Math.PI / 2;
      for (const [bx, by] of [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ]) {
        const b = put(root, new THREE.CylinderGeometry(0.007, 0.007, 0.008, 6), kit.zinc, x + bx * 0.036, DRUM_Y + by * 0.036, z + s * 0.009);
        b.rotation.x = Math.PI / 2;
      }
      if (!(x === BELT_LEN && s > 0)) {
        const cap = put(root, new THREE.CylinderGeometry(0.016, 0.016, 0.012, 24), kit.zinc, x, DRUM_Y, z + s * 0.04);
        cap.rotation.x = Math.PI / 2;
      }
    }
  }
  // yellow end bumpers at the discharge end
  for (const s of [-1, 1]) {
    const b = put(root, new THREE.CylinderGeometry(0.026, 0.03, 0.035, 32), kit.yellow, RAIL_X1 + 0.017, RAIL_Y - 0.015, s * RAIL_Z);
    b.rotation.z = Math.PI / 2;
    const b2 = put(root, new THREE.SphereGeometry(0.026, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), kit.yellow, RAIL_X1 + 0.034, RAIL_Y - 0.015, s * RAIL_Z);
    b2.rotation.z = -Math.PI / 2;
  }

  // slotted wiring duct under the front rail
  const ductLen = 3.7;
  put(root, new THREE.BoxGeometry(ductLen, 0.05, 0.04), kit.duct, 0.15 + ductLen / 2, RAIL_BOTTOM - 0.03, RAIL_OUT + 0.024);
  put(root, new THREE.BoxGeometry(ductLen + 0.01, 0.006, 0.046), kit.duct, 0.15 + ductLen / 2, RAIL_BOTTOM - 0.002, RAIL_OUT + 0.024);
  for (let x = 0.2; x < 0.15 + ductLen; x += 0.05) {
    put(root, new THREE.BoxGeometry(0.012, 0.03, 0.002), kit.blackPlastic, x, RAIL_BOTTOM - 0.032, RAIL_OUT + 0.045);
  }

  buildDriveStatic(root, kit);
  buildInfeedStub(root, kit);
}

function buildDriveStatic(root: THREE.Object3D, kit: Kit): void {
  const x = BELT_LEN;
  const y = DRUM_Y;
  const z0 = DRIVE_Z0 + 0.03;
  // coupling guard: yellow wire cage with rings
  const cage = new THREE.CylinderGeometry(0.056, 0.056, 0.085, 40, 1, true);
  cage.rotateX(Math.PI / 2);
  const uv = cage.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 7, uv.getY(i) * 1.7);
  const c = put(root, cage, kit.guardMesh, x, y, z0 + 0.0425);
  c.userData.noShadow = true;
  for (const dz of [0, 0.085]) {
    put(root, new THREE.TorusGeometry(0.056, 0.004, 8, 48), kit.yellow, x, y, z0 + dz);
  }
  // gearbox
  const gz = z0 + 0.085;
  put(root, new THREE.CylinderGeometry(0.075, 0.075, 0.014, 48).rotateX(Math.PI / 2), kit.motorBlue, x, y, gz + 0.007);
  put(root, new RoundedBoxGeometry(0.19, 0.22, 0.15, 4, 0.03), kit.motorBlue, x, y - 0.015, gz + 0.09);
  for (const dx of [-0.07, -0.035, 0, 0.035, 0.07]) {
    put(root, new THREE.BoxGeometry(0.006, 0.2, 0.12), kit.motorBlue, x + dx, y - 0.015, gz + 0.09);
  }
  put(root, new THREE.CylinderGeometry(0.012, 0.012, 0.02, 16), kit.zinc, x + 0.04, y + 0.105, gz + 0.09);
  put(root, new THREE.CylinderGeometry(0.009, 0.009, 0.01, 6), kit.zinc, x - 0.06, y - 0.13, gz + 0.09);
  // torque arm down to the leg
  root.add(
    barBetween(new THREE.BoxGeometry(1, 0.03, 0.01).translate(0.5, 0, 0), kit.zinc, new THREE.Vector3(x - 0.02, y - 0.11, gz + 0.03), new THREE.Vector3(3.8, 0.5, RAIL_Z + 0.03)),
  );
  // motor body with cooling fins
  const mz = gz + 0.165;
  const mlen = 0.24;
  put(root, new THREE.CylinderGeometry(0.078, 0.078, 0.02, 48).rotateX(Math.PI / 2), kit.motorBlue, x, y, mz + 0.01);
  put(root, new THREE.CylinderGeometry(0.066, 0.066, mlen, 48).rotateX(Math.PI / 2), kit.motorBlue, x, y, mz + mlen / 2);
  const fin = new THREE.BoxGeometry(0.016, 0.004, mlen - 0.03);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    if (Math.abs(a - Math.PI / 2) < 0.35) continue; // terminal box sits on top
    const f = put(root, fin, kit.motorBlue, x + Math.cos(a) * 0.072, y + Math.sin(a) * 0.072, mz + mlen / 2);
    f.rotation.z = a;
  }
  put(root, new THREE.CylinderGeometry(0.076, 0.076, 0.018, 48).rotateX(Math.PI / 2), kit.motorBlue, x, y, mz + mlen - 0.009);
  // terminal box + gland + cable into the duct
  put(root, new RoundedBoxGeometry(0.1, 0.06, 0.11, 3, 0.01), kit.motorBlue, x, y + 0.095, mz + 0.1);
  put(root, new RoundedBoxGeometry(0.104, 0.012, 0.114, 2, 0.005), kit.motorBlue, x, y + 0.128, mz + 0.1);
  put(root, new THREE.CylinderGeometry(0.011, 0.011, 0.025, 16).rotateZ(Math.PI / 2), kit.blackPlastic, x - 0.06, y + 0.095, mz + 0.1);
  const cable = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x - 0.07, y + 0.095, mz + 0.1),
    new THREE.Vector3(x - 0.14, y + 0.08, mz + 0.06),
    new THREE.Vector3(x - 0.2, y - 0.02, RAIL_OUT + 0.1),
    new THREE.Vector3(x - 0.24, RAIL_BOTTOM - 0.03, RAIL_OUT + 0.03),
  ]);
  put(root, new THREE.TubeGeometry(cable, 32, 0.007, 10, false), kit.cableOrange);
  // fan cover with grille
  const fz = mz + mlen;
  put(root, new THREE.CylinderGeometry(0.074, 0.07, 0.08, 48, 1, true).rotateX(Math.PI / 2), kit.motorBlue, x, y, fz + 0.04);
  const gr = put(root, new THREE.CircleGeometry(0.071, 48), kit.grilleMat, x, y, fz + 0.079);
  gr.userData.noShadow = true;
  put(root, new THREE.TorusGeometry(0.071, 0.005, 8, 48), kit.motorBlue, x, y, fz + 0.08);
  // nameplate
  const [pc, pg] = makeCanvas(256, 128);
  pg.fillStyle = '#d9dbde';
  pg.fillRect(0, 0, 256, 128);
  pg.fillStyle = '#1a1a1a';
  pg.font = '700 22px Arial';
  pg.fillText('DRIVE M1  0.75 kW', 14, 34);
  pg.font = '500 16px Arial';
  pg.fillText('400 V  50 Hz  1400 rpm', 14, 62);
  pg.fillText('i = 28.6   IP65', 14, 86);
  pg.fillText('S/N 0426-STOP-PROVE', 14, 110);
  const plateMat = kit.m(new THREE.MeshStandardMaterial({ map: kit.t(toTexture(pc, true, false)), metalness: 0.6, roughness: 0.4 }));
  const plate = put(root, new THREE.PlaneGeometry(0.09, 0.045), plateMat, x + 0.0675, y + 0.01, mz + 0.12);
  plate.rotation.y = Math.PI / 2;
}

function buildInfeedStub(root: THREE.Object3D, kit: Kit): void {
  // short gravity roller conveyor feeding the belt from outside the fence
  const x0 = FX0 - 0.85;
  const x1 = -0.16;
  const topY = BELT_TOP + 0.004;
  const ry = topY - 0.02;
  const len = x1 - x0;
  const chanZ = 0.27;
  for (const s of [-1, 1]) {
    put(root, new THREE.BoxGeometry(len, 0.07, 0.004), kit.zinc, x0 + len / 2, ry - 0.01, s * chanZ);
    put(root, new THREE.BoxGeometry(len, 0.004, 0.03), kit.zinc, x0 + len / 2, ry - 0.045, s * (chanZ - 0.015));
    for (const lx of [x0 + 0.08, x1 - 0.08]) {
      put(root, new THREE.BoxGeometry(0.04, ry - 0.05, 0.04), kit.zinc, lx, (ry - 0.05) / 2, s * (chanZ + 0.022));
      put(root, new THREE.BoxGeometry(0.09, 0.008, 0.09), kit.zinc, lx, 0.004, s * (chanZ + 0.022));
    }
  }
  const roller = new THREE.CylinderGeometry(0.02, 0.02, 2 * chanZ - 0.01, 32).rotateX(Math.PI / 2);
  for (let x = x0 + 0.06; x < x1 - 0.03; x += 0.075) put(root, roller, kit.steel, x, ry, 0);
  for (const lx of [x0 + 0.08, x1 - 0.08]) {
    put(root, new THREE.BoxGeometry(0.03, 0.03, 2 * chanZ), kit.zinc, lx, 0.3, 0);
  }
}

/** Moving conveyor parts for one cell. Driven by belt travel in metres. */
export class ConveyorDynamic {
  readonly group = new THREE.Group();
  private readonly beltMat: THREE.MeshStandardMaterial;
  private readonly rollers: THREE.InstancedMesh;
  private readonly drums: THREE.Object3D[] = [];
  private readonly coupling = new THREE.Group();
  private readonly fan = new THREE.Group();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpS = new THREE.Vector3(1, 1, 1);
  private readonly tmpP = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private lastTravel = NaN;
  private readonly tile = 1.0;

  constructor(kit: Kit, shared: ConveyorShared) {
    // belt loop with its own texture transform (so two cells can scroll independently)
    this.beltMat = kit.belt.clone();
    this.beltMat.map = kit.beltMap.clone();
    this.beltMat.bumpMap = kit.beltBump.clone();
    const belt = new THREE.Mesh(shared.beltGeo, this.beltMat);
    belt.position.set(0, DRUM_Y, 0);
    belt.castShadow = true;
    belt.receiveShadow = true;
    this.group.add(belt);

    this.rollers = new THREE.InstancedMesh(shared.rollerGeo, shared.rollerMat, ROLLER_XS.length + RETURN_XS.length);
    this.rollers.castShadow = true;
    this.rollers.receiveShadow = true;
    this.group.add(this.rollers);

    for (const x of [0, BELT_LEN]) {
      const d = new THREE.Mesh(shared.drumGeo, shared.drumMats);
      d.position.set(x, DRUM_Y, 0);
      d.castShadow = true;
      d.receiveShadow = true;
      this.group.add(d);
      this.drums.push(d);
    }

    // coupling (visible through the guard cage)
    const z0 = DRIVE_Z0 + 0.03;
    this.coupling.position.set(BELT_LEN, DRUM_Y, z0);
    const hub = new THREE.CylinderGeometry(0.032, 0.032, 0.03, 32).rotateX(Math.PI / 2);
    put(this.coupling, hub, kit.steel, 0, 0, 0.018);
    put(this.coupling, hub, kit.steel, 0, 0, 0.067);
    put(this.coupling, new THREE.CylinderGeometry(0.029, 0.029, 0.02, 12).rotateX(Math.PI / 2), shared.spiderMat, 0, 0, 0.0425);
    put(this.coupling, new THREE.BoxGeometry(0.012, 0.012, 0.085), kit.yellow, 0, 0.03, 0.0425);
    put(this.coupling, new THREE.CylinderGeometry(0.012, 0.012, 0.03, 16).rotateX(Math.PI / 2), kit.steel, 0, 0, -0.012);
    this.group.add(this.coupling);

    // cooling fan behind the grille
    const fz = DRIVE_Z0 + 0.03 + 0.085 + 0.165 + 0.24;
    this.fan.position.set(BELT_LEN, DRUM_Y, fz + 0.045);
    put(this.fan, new THREE.CylinderGeometry(0.02, 0.02, 0.025, 24).rotateX(Math.PI / 2), shared.fanMat, 0, 0, 0);
    const blade = new THREE.BoxGeometry(0.05, 0.022, 0.003);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const b = put(this.fan, blade, shared.fanMat, Math.cos(a) * 0.042, Math.sin(a) * 0.042, 0);
      b.rotation.set(0, 0, a);
      b.rotateX(0.5);
    }
    this.group.add(this.fan);
    mergeLocal(this.coupling);
    mergeLocal(this.fan);
    this.setTravel(0);
  }

  /** Apply total belt travel (metres, can go backwards when scrubbing). */
  setTravel(travel: number): void {
    if (travel === this.lastTravel) return;
    this.lastTravel = travel;
    const u = travel / this.tile;
    // u increases along the direction of travel; shifting the texture by -u moves the pattern forward
    this.beltMat.map!.offset.x = -u;
    this.beltMat.bumpMap!.offset.x = -u;
    const aRoll = -travel / ROLLER_R;
    let i = 0;
    for (const x of ROLLER_XS) {
      this.tmpQ.setFromAxisAngle(this.zAxis, aRoll + i * 0.7);
      this.tmpP.set(x, ROLLER_Y, 0);
      this.tmpS.set(1, 1, 1);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      this.rollers.setMatrixAt(i++, this.tmpM);
    }
    const aRet = travel / RETURN_R;
    for (const x of RETURN_XS) {
      this.tmpQ.setFromAxisAngle(this.zAxis, aRet + i);
      this.tmpP.set(x, RETURN_STRAND_Y - RETURN_R, 0);
      this.tmpS.set(RETURN_R / ROLLER_R, RETURN_R / ROLLER_R, 1);
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
      this.rollers.setMatrixAt(i++, this.tmpM);
    }
    this.rollers.instanceMatrix.needsUpdate = true;
    const aDrum = -travel / (DRUM_R + BELT_THK / 2);
    for (const d of this.drums) d.rotation.z = aDrum;
    this.coupling.rotation.z = aDrum;
    this.fan.rotation.z = aDrum * 3.2;
  }

  dispose(): void {
    this.beltMat.map?.dispose();
    this.beltMat.bumpMap?.dispose();
    this.beltMat.dispose();
    this.rollers.dispose();
  }
}

/** Geometry / materials shared by every cell's moving conveyor parts. */
export class ConveyorShared {
  readonly beltGeo: THREE.BufferGeometry;
  readonly rollerGeo: THREE.BufferGeometry;
  readonly rollerMat: THREE.MeshStandardMaterial;
  readonly drumGeo: THREE.BufferGeometry;
  readonly drumMats: THREE.Material[];
  readonly spiderMat: THREE.MeshStandardMaterial;
  readonly fanMat: THREE.MeshStandardMaterial;

  constructor(kit: Kit) {
    this.beltGeo = beltLoopGeometry(BELT_LEN, DRUM_R, BELT_THK, BELT_HALF_W, 1.0);
    const rg = new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, 2 * ROLLER_HALF_LEN, 48, 1);
    rg.rotateX(Math.PI / 2);
    this.rollerGeo = rg;
    // axial oil streaks so rotation reads on camera
    const [c, g] = makeCanvas(256, 32);
    const r = rng(77);
    g.fillStyle = '#c9ccd0';
    g.fillRect(0, 0, 256, 32);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '40,42,46'},${0.15 + r() * 0.35})`;
      g.fillRect(r() * 256, 0, 1 + r() * 5, 32);
    }
    g.fillStyle = 'rgba(30,30,30,0.6)';
    g.fillRect(40, 0, 6, 32);
    this.rollerMat = kit.m(
      new THREE.MeshStandardMaterial({ map: kit.t(toTexture(c, true, true)), metalness: 0.9, roughness: 0.4 }),
    );
    const dg = new THREE.CylinderGeometry(DRUM_R, DRUM_R, 0.6, 64, 1);
    dg.rotateX(Math.PI / 2);
    this.drumGeo = dg;
    // drum: crowned rubber lagging face (hidden under the belt) + steel end discs
    this.drumMats = [kit.rubber, kit.steel, kit.steel];
    this.spiderMat = kit.m(new THREE.MeshStandardMaterial({ color: 0xd2232a, roughness: 0.5 }));
    this.fanMat = kit.m(new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.5, metalness: 0.2 }));
  }

  dispose(): void {
    this.beltGeo.dispose();
    this.rollerGeo.dispose();
    this.drumGeo.dispose();
  }
}

