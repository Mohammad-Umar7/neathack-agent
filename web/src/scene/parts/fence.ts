// Safety fence: yellow posts, black-framed welded-mesh panels, an infeed tunnel and the
// interlocked hinged guard door on the operator side.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Kit } from '../materials';
import { put, tiledPlane } from '../geom';
import { DOOR_X0, DOOR_X1, FENCE_BOTTOM, FENCE_TOP, FX0, FX1, FZ0, FZ1, POST } from '../dims';
import { FONT, makeCanvas, toTexture } from '../textures';

const FRAME = 0.024;
const MESH_TILE = 0.05;

function post(root: THREE.Object3D, kit: Kit, x: number, z: number, h = FENCE_TOP + 0.05): void {
  put(root, new RoundedBoxGeometry(POST, h, POST, 2, 0.006), kit.yellow, x, h / 2, z);
  put(root, new RoundedBoxGeometry(0.15, 0.012, 0.15, 2, 0.004), kit.yellow, x, 0.006, z);
  put(root, new THREE.BoxGeometry(POST + 0.006, 0.012, POST + 0.006), kit.blackPlastic, x, h + 0.006, z);
  for (const [dx, dz] of [
    [-0.055, -0.055],
    [0.055, 0.055],
    [-0.055, 0.055],
    [0.055, -0.055],
  ]) {
    put(root, new THREE.CylinderGeometry(0.009, 0.009, 0.012, 6), kit.zinc, x + dx, 0.016, z + dz);
  }
}

/** Mesh panel between two points on the floor plan (frame + wire mesh). */
export function meshPanel(root: THREE.Object3D, kit: Kit, a: THREE.Vector2, b: THREE.Vector2, y0 = FENCE_BOTTOM, y1 = FENCE_TOP): THREE.Group {
  const g = new THREE.Group();
  const len = a.distanceTo(b) - POST - 0.012;
  const h = y1 - y0;
  const mid = new THREE.Vector2().addVectors(a, b).multiplyScalar(0.5);
  g.position.set(mid.x, y0 + h / 2, mid.y);
  g.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
  root.add(g);
  const horiz = new THREE.BoxGeometry(len, FRAME, FRAME);
  const vert = new THREE.BoxGeometry(FRAME, h, FRAME);
  put(g, horiz, kit.fenceFrame, 0, h / 2 - FRAME / 2, 0);
  put(g, horiz, kit.fenceFrame, 0, -h / 2 + FRAME / 2, 0);
  put(g, vert, kit.fenceFrame, -len / 2 + FRAME / 2, 0, 0);
  put(g, vert, kit.fenceFrame, len / 2 - FRAME / 2, 0, 0);
  // mid rail
  put(g, new THREE.BoxGeometry(len, 0.02, 0.012), kit.fenceFrame, 0, -h / 2 + 0.55, 0);
  const mesh = put(g, tiledPlane(len - FRAME, h - FRAME, MESH_TILE), kit.fenceMesh, 0, 0, 0);
  mesh.userData.noShadow = true;
  // clamp brackets onto the posts
  for (const sx of [-1, 1]) {
    for (const y of [-h / 2 + 0.2, h / 2 - 0.2]) {
      put(g, new THREE.BoxGeometry(0.03, 0.05, 0.05), kit.zinc, sx * (len / 2 + 0.008), y, 0);
    }
  }
  return g;
}

export function buildFenceStatic(root: THREE.Object3D, kit: Kit): void {
  const V = (x: number, z: number) => new THREE.Vector2(x, z);
  // front side (operator, +z) with the door opening
  const front = [FX0, 1.0, DOOR_X0, DOOR_X1, FX1];
  for (const x of front) post(root, kit, x, FZ1);
  meshPanel(root, kit, V(FX0, FZ1), V(1.0, FZ1));
  meshPanel(root, kit, V(1.0, FZ1), V(DOOR_X0, FZ1));
  meshPanel(root, kit, V(DOOR_X1, FZ1), V(FX1, FZ1));
  // back side
  const back = [FX0, 0.75, 2.25, 3.75, FX1];
  for (const x of back) post(root, kit, x, FZ0);
  for (let i = 0; i < back.length - 1; i++) meshPanel(root, kit, V(back[i], FZ0), V(back[i + 1], FZ0));
  // discharge end
  post(root, kit, FX1, -0.3);
  meshPanel(root, kit, V(FX1, FZ0), V(FX1, -0.3));
  meshPanel(root, kit, V(FX1, -0.3), V(FX1, FZ1));
  // infeed end with an opening for the belt + tunnel guard
  post(root, kit, FX0, -0.5);
  post(root, kit, FX0, 0.5);
  meshPanel(root, kit, V(FX0, FZ0), V(FX0, -0.5));
  meshPanel(root, kit, V(FX0, 0.5), V(FX0, FZ1));
  meshPanel(root, kit, V(FX0, -0.5), V(FX0, 0.5), 1.25, FENCE_TOP);
  // tunnel hood (sheet metal) around the infeed opening, outside the fence
  const tx0 = FX0 - 0.55;
  const tl = 0.55;
  put(root, new THREE.BoxGeometry(tl, 0.012, 0.86), kit.yellow, tx0 + tl / 2, 1.25, 0);
  for (const s of [-1, 1]) put(root, new THREE.BoxGeometry(tl, 0.42, 0.012), kit.yellow, tx0 + tl / 2, 1.04, s * 0.43);
  put(root, new THREE.BoxGeometry(0.02, 0.03, 0.88), kit.blackPlastic, tx0, 1.24, 0);
  // warning sign on the door's latch-side panel
  const [c, g] = makeCanvas(256, 320);
  g.fillStyle = '#f5c400';
  g.fillRect(0, 0, 256, 320);
  g.fillStyle = '#111';
  g.beginPath();
  g.moveTo(128, 28);
  g.lineTo(226, 196);
  g.lineTo(30, 196);
  g.closePath();
  g.fill();
  g.fillStyle = '#f5c400';
  g.beginPath();
  g.moveTo(128, 58);
  g.lineTo(202, 182);
  g.lineTo(54, 182);
  g.closePath();
  g.fill();
  g.fillStyle = '#111';
  g.font = `900 92px ${FONT}`;
  g.textAlign = 'center';
  g.fillText('!', 128, 172);
  g.font = `800 30px ${FONT}`;
  g.fillText('AUTOMATIC', 128, 238);
  g.fillText('MACHINE', 128, 272);
  g.font = `600 18px ${FONT}`;
  g.fillText('KEEP DOOR CLOSED', 128, 302);
  const signMat = kit.m(new THREE.MeshStandardMaterial({ map: kit.t(toTexture(c, true, false)), roughness: 0.5 }));
  put(root, new THREE.PlaneGeometry(0.24, 0.3), signMat, (DOOR_X1 + FX1) / 2, 1.35, FZ1 + 0.02);
}

/** Interlocked hinged guard door. Opening angle eases toward the target. */
export class GuardDoor {
  readonly group = new THREE.Group();
  readonly pickables: THREE.Object3D[] = [];
  private readonly ledMat: THREE.MeshStandardMaterial;
  private readonly frameMat: THREE.MeshStandardMaterial;
  private angle = 0;
  private target = 0;
  private hover = false;

  constructor(kit: Kit) {
    const width = DOOR_X1 - DOOR_X0 - POST - 0.024;
    const h = FENCE_TOP - FENCE_BOTTOM;
    this.group.position.set(DOOR_X0 + POST / 2 + 0.012, FENCE_BOTTOM, FZ1);
    this.frameMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.5, metalness: 0.45, emissive: 0xffc23a, emissiveIntensity: 0 });
    const horiz = new THREE.BoxGeometry(width, FRAME, FRAME);
    const vert = new THREE.BoxGeometry(FRAME, h, FRAME);
    const parts: THREE.Mesh[] = [];
    parts.push(put(this.group, horiz, this.frameMat, width / 2, h - FRAME / 2, 0));
    parts.push(put(this.group, horiz, this.frameMat, width / 2, FRAME / 2, 0));
    parts.push(put(this.group, vert, this.frameMat, FRAME / 2, h / 2, 0));
    parts.push(put(this.group, vert, this.frameMat, width - FRAME / 2, h / 2, 0));
    parts.push(put(this.group, new THREE.BoxGeometry(width, 0.02, 0.012), this.frameMat, width / 2, 0.55, 0));
    const mesh = put(this.group, tiledPlane(width - FRAME, h - FRAME, MESH_TILE), kit.fenceMesh, width / 2, h / 2, 0);
    parts.push(mesh);
    // yellow/black hazard strip along the door's leading edge
    const hz = new THREE.MeshStandardMaterial({ map: kit.hazard, roughness: 0.5 });
    const hg = new THREE.PlaneGeometry(0.05, h - 0.1);
    const huv = hg.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < huv.count; i++) huv.setXY(i, huv.getY(i) * 6, huv.getX(i));
    put(this.group, hg, hz, width - 0.04, h / 2, 0.016);
    put(this.group, hg, hz, width - 0.04, h / 2, -0.016).rotation.y = Math.PI;
    // handle (D-pull) on the outside
    const handle = new THREE.TorusGeometry(0.06, 0.009, 10, 24, Math.PI);
    const hm = put(this.group, handle, kit.chrome, width - 0.09, 1.0, 0.03);
    hm.rotation.set(0, Math.PI / 2, Math.PI / 2);
    parts.push(hm);
    // interlock actuator tongue on the door edge
    put(this.group, new THREE.BoxGeometry(0.03, 0.05, 0.012), kit.zinc, width + 0.008, 1.2, 0.02);
    // hinges
    for (const y of [0.15, h - 0.15]) {
      put(this.group, new THREE.CylinderGeometry(0.014, 0.014, 0.1, 16), kit.zinc, -0.012, y, 0.02);
    }
    for (const p of parts) {
      p.userData.control = 'GUARD';
      this.pickables.push(p);
    }
    // interlock switch body on the latch post (does not swing)
    this.ledMat = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0x33ff66, emissiveIntensity: 2.5 });
    this.switchGroup.position.set(DOOR_X1 - POST / 2 - 0.02, FENCE_BOTTOM + 1.2, FZ1 + 0.04);
    put(this.switchGroup, new RoundedBoxGeometry(0.04, 0.11, 0.04, 2, 0.005), kit.yellow, 0, 0, 0);
    put(this.switchGroup, new RoundedBoxGeometry(0.042, 0.03, 0.042, 2, 0.004), kit.blackPlastic, 0, 0.065, 0);
    put(this.switchGroup, new THREE.BoxGeometry(0.012, 0.012, 0.004), this.ledMat, 0, 0.03, 0.021);
    put(this.switchGroup, new THREE.CylinderGeometry(0.007, 0.007, 0.03, 12), kit.blackPlastic, 0, -0.07, 0);
  }

  readonly switchGroup = new THREE.Group();

  setClosed(closed: boolean): void {
    this.target = closed ? 0 : 1;
  }

  setHover(on: boolean): void {
    this.hover = on;
  }

  get openness(): number {
    return this.angle;
  }

  update(dt: number): void {
    // critically damped swing
    this.angle += (this.target - this.angle) * (1 - Math.exp(-dt * 4.5));
    const e = this.angle;
    this.group.rotation.y = -1.75 * (e * e * (3 - 2 * e));
    const open = this.target > 0.5;
    this.ledMat.emissive.setRGB(open ? 1 : 0.2, open ? 0.12 : 1, open ? 0.08 : 0.4);
    this.frameMat.emissiveIntensity = this.hover ? 0.35 : 0;
  }

  dispose(): void {
    this.ledMat.dispose();
    this.frameMat.dispose();
  }
}
