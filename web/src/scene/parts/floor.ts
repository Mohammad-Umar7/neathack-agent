// Floor markings around a cell (hazard tape, door swing zone, walkway) and soft contact
// shadows (AO blobs) under the heavy parts.
import * as THREE from 'three';
import type { Kit } from '../materials';
import { put } from '../geom';
import { DOOR_X0, DOOR_X1, FX0, FX1, FZ0, FZ1, PANEL_X, PANEL_Z, PALLET_X, PALLET_Z, GANTRY_Z_BACK, GANTRY_Z_FRONT, PICK_X } from '../dims';
import { LEG_X } from './conveyor';
import { makeCanvas, toTexture } from '../textures';

const Y = 0.0025;

function strip(root: THREE.Object3D, mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, width: number, tile: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const g = new THREE.PlaneGeometry(len, width);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len) / tile, uv.getY(i));
  g.rotateX(-Math.PI / 2);
  const m = put(root, g, mat, (x0 + x1) / 2, Y, (z0 + z1) / 2);
  m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
  m.userData.noShadow = true;
  m.receiveShadow = true;
}

function blob(root: THREE.Object3D, kit: Kit, x: number, z: number, sx: number, sz: number, opacity = 1): void {
  const g = new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2);
  const m = put(root, g, opacity < 1 ? kit.blobMat : kit.blobMat, x, Y - 0.001, z);
  m.userData.noShadow = true;
  m.renderOrder = 1;
}

export function buildFloorStatic(root: THREE.Object3D, kit: Kit): void {
  // hazard tape just outside the fence line
  const o = 0.16;
  const w = 0.08;
  const tile = 0.32;
  strip(root, kit.hazardMat, FX0 - o, FZ1 + o, FX1 + o, FZ1 + o, w, tile);
  strip(root, kit.hazardMat, FX0 - o, FZ0 - o, FX1 + o, FZ0 - o, w, tile);
  strip(root, kit.hazardMat, FX0 - o, FZ0 - o, FX0 - o, -0.62, w, tile);
  strip(root, kit.hazardMat, FX0 - o, 0.62, FX0 - o, FZ1 + o, w, tile);
  strip(root, kit.hazardMat, FX1 + o, FZ0 - o, FX1 + o, FZ1 + o, w, tile);
  // walkway edge line in front of the cell
  strip(root, kit.floorYellow, FX0 - 1.9, FZ1 + 1.55, FX1 + 1.9, FZ1 + 1.55, 0.07, 1);
  strip(root, kit.floorYellow, FX0 - 1.9, FZ0 - 0.75, FX1 + 1.9, FZ0 - 0.75, 0.07, 1);

  // door swing zone: hatched yellow rectangle
  const zw = DOOR_X1 - DOOR_X0;
  const zd = 1.15;
  const [c, g] = makeCanvas(512, 512);
  g.clearRect(0, 0, 512, 512);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 22;
  g.strokeRect(11, 11, 490, 490);
  g.lineWidth = 16;
  for (let x = -512; x < 1024; x += 72) {
    g.beginPath();
    g.moveTo(x, 512);
    g.lineTo(x + 512, 0);
    g.stroke();
  }
  const hatchMat = kit.m(
    new THREE.MeshStandardMaterial({
      color: 0xe6a70f,
      alphaMap: kit.t(toTexture(c, false, false)),
      transparent: true,
      depthWrite: false,
      roughness: 0.55,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  const hz = put(root, new THREE.PlaneGeometry(zw, zd).rotateX(-Math.PI / 2), hatchMat, (DOOR_X0 + DOOR_X1) / 2, Y, FZ1 + 0.24 + zd / 2);
  hz.userData.noShadow = true;
  // operator standing mat in front of the panel
  const mat = kit.m(new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const pm = put(root, new THREE.BoxGeometry(0.9, 0.012, 0.6), mat, PANEL_X, 0.006, PANEL_Z + 0.55);
  pm.userData.noShadow = true;
  strip(root, kit.hazardMat, PANEL_X - 0.45, PANEL_Z + 0.25, PANEL_X + 0.45, PANEL_Z + 0.25, 0.035, 0.2);

  // cable protector ramp from the console pedestal under the fence to the infeed leg
  const ramp = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const shape = new THREE.Shape();
    shape.moveTo(-0.07, 0);
    shape.lineTo(0.07, 0);
    shape.lineTo(0.035, 0.022);
    shape.lineTo(-0.035, 0.022);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getZ(i) / 0.3, pos.getX(i) * 4 + 0.5);
    const m = put(root, g, kit.hazardMat, x0, 0, z0);
    m.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    m.userData.noShadow = true;
  };
  ramp(PANEL_X - 0.02, PANEL_Z - 0.2, PANEL_X - 0.02, FZ1 - 0.15);
  ramp(PANEL_X - 0.02, FZ1 - 0.15, LEG_X[0] + 0.06, 0.42);

  // contact shadows
  blob(root, kit, 2.0, 0, 5.2, 1.5);
  for (const x of LEG_X) for (const z of [-0.33, 0.33]) blob(root, kit, x, z, 0.32, 0.32);
  blob(root, kit, PALLET_X, PALLET_Z, 1.2, 1.4);
  blob(root, kit, PANEL_X, PANEL_Z - 0.03, 0.7, 0.7);
  blob(root, kit, PICK_X - 0.12, GANTRY_Z_FRONT, 0.5, 0.5);
  blob(root, kit, PICK_X - 0.12, GANTRY_Z_BACK, 0.5, 0.5);
  blob(root, kit, FX0 - 0.5, 0, 1.6, 0.9);
}
