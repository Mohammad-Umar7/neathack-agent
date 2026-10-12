// Geometry helpers: aluminium T-slot profiles, the closed belt loop, lathe parts and a
// static batcher that merges everything that never moves into one mesh per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const MM = 0.001;

/**
 * Outline of a T-slot aluminium extrusion built from square 45 mm modules
 * (cols x rows), with a T-slot in the middle of every module face and a core bore.
 */
export function tSlotShape(cols: number, rows: number, module = 45): THREE.Shape {
  const w = cols * module;
  const h = rows * module;
  const pts: THREE.Vector2[] = [];
  // slot notch in local (u along face, d inward) coordinates, mm
  const notch: [number, number][] = [
    [-5, 0],
    [-5, 4],
    [-10, 4],
    [-10, 7.5],
    [-4.5, 12.5],
    [4.5, 12.5],
    [10, 7.5],
    [10, 4],
    [5, 4],
    [5, 0],
  ];
  const corner = 2.5;
  // Walk CCW: bottom edge (left->right), right edge (bottom->top), top (right->left), left (top->bottom)
  const faces: { start: [number, number]; dir: [number, number]; inward: [number, number]; len: number; n: number }[] = [
    { start: [-w / 2, -h / 2], dir: [1, 0], inward: [0, 1], len: w, n: cols },
    { start: [w / 2, -h / 2], dir: [0, 1], inward: [-1, 0], len: h, n: rows },
    { start: [w / 2, h / 2], dir: [-1, 0], inward: [0, -1], len: w, n: cols },
    { start: [-w / 2, h / 2], dir: [0, -1], inward: [1, 0], len: h, n: rows },
  ];
  for (const f of faces) {
    const at = (u: number, d: number) =>
      new THREE.Vector2((f.start[0] + f.dir[0] * u + f.inward[0] * d) * MM, (f.start[1] + f.dir[1] * u + f.inward[1] * d) * MM);
    // chamfered corner at the start of the face
    pts.push(at(corner, 0));
    for (let i = 0; i < f.n; i++) {
      const c = module * (i + 0.5);
      for (const [u, d] of notch) pts.push(at(c + u, d));
    }
    pts.push(at(f.len - corner, 0));
    // the corner chamfer point that starts the next face is added by the next face
  }
  const shape = new THREE.Shape(pts);
  for (let cx = 0; cx < cols; cx++) {
    for (let cy = 0; cy < rows; cy++) {
      const hole = new THREE.Path();
      const x = (-w / 2 + module * (cx + 0.5)) * MM;
      const y = (-h / 2 + module * (cy + 0.5)) * MM;
      hole.absarc(x, y, 4.2 * MM, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }
  return shape;
}

const profileCache = new Map<string, THREE.BufferGeometry>();

/**
 * T-slot bar along +X from x=0 to x=length, profile centred on the axis.
 * The profile's first dimension (cols) maps to Z, the second (rows) to Y.
 */
export function profileBar(cols: number, rows: number, length: number): THREE.BufferGeometry {
  const key = `${cols}x${rows}:${length.toFixed(4)}`;
  const hit = profileCache.get(key);
  if (hit) return hit;
  const g = new THREE.ExtrudeGeometry(tSlotShape(cols, rows), {
    depth: length - 0.0016,
    bevelEnabled: true,
    bevelThickness: 0.0008,
    bevelSize: 0.0007,
    bevelSegments: 1,
    curveSegments: 8,
    steps: 1,
  });
  g.translate(0, 0, 0.0008);
  g.rotateY(Math.PI / 2); // extrusion z -> +x, profile x -> -z
  // UVs along the bar for the brushed roughness map
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) * 1.5, (pos.getY(i) + pos.getZ(i)) * 6);
  }
  g.computeVertexNormals();
  profileCache.set(key, g);
  return g;
}

export function clearGeomCache(): void {
  for (const g of profileCache.values()) g.dispose();
  profileCache.clear();
}

/** Orient a +X bar so it runs from a to b. */
export function barBetween(geo: THREE.BufferGeometry, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, roll = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll));
  m.quaternion.copy(q);
  m.position.copy(a);
  return m;
}

/**
 * Closed conveyor belt loop around two drums at x=0 and x=length (axes at y=0),
 * width along Z. u runs along the direction of travel (metres / tile), so scrolling
 * the texture offset moves the top strand toward +x and the return strand toward -x.
 */
export function beltLoopGeometry(length: number, drumR: number, thickness: number, halfW: number, tile: number): THREE.BufferGeometry {
  const Rc = drumR + thickness / 2;
  // sample the centreline
  const samples: { p: THREE.Vector2; n: THREE.Vector2; s: number }[] = [];
  let s = 0;
  const push = (x: number, y: number, nx: number, ny: number) => {
    const p = new THREE.Vector2(x, y);
    if (samples.length) s += p.distanceTo(samples[samples.length - 1].p);
    samples.push({ p, n: new THREE.Vector2(nx, ny), s });
  };
  const straightSeg = 24;
  const arcSeg = 32;
  for (let i = 0; i <= straightSeg; i++) push((i / straightSeg) * length, Rc, 0, 1);
  for (let i = 1; i <= arcSeg; i++) {
    const a = Math.PI / 2 - (i / arcSeg) * Math.PI;
    push(length + Math.cos(a) * Rc, Math.sin(a) * Rc, Math.cos(a), Math.sin(a));
  }
  for (let i = 1; i <= straightSeg; i++) push(length - (i / straightSeg) * length, -Rc, 0, -1);
  for (let i = 1; i <= arcSeg; i++) {
    const a = -Math.PI / 2 - (i / arcSeg) * Math.PI;
    push(Math.cos(a) * Rc, Math.sin(a) * Rc, Math.cos(a), Math.sin(a));
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const t2 = thickness / 2;
  const N = samples.length;
  // outer surface, inner surface, two edges
  const surfaces: { off: number; flip: boolean }[] = [
    { off: t2, flip: false },
    { off: -t2, flip: true },
  ];
  for (const surf of surfaces) {
    const base = pos.length / 3;
    for (const sm of samples) {
      for (const z of [-halfW, halfW]) {
        pos.push(sm.p.x + sm.n.x * surf.off, sm.p.y + sm.n.y * surf.off, z);
        const sg = surf.flip ? -1 : 1;
        nor.push(sm.n.x * sg, sm.n.y * sg, 0);
        uvs.push(sm.s / tile, (z + halfW) / (2 * halfW));
      }
    }
    for (let i = 0; i < N - 1; i++) {
      const a = base + i * 2;
      const b = a + 2;
      if (!surf.flip) idx.push(a, a + 1, b, b, a + 1, b + 1);
      else idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  for (const z of [-halfW, halfW]) {
    const base = pos.length / 3;
    for (const sm of samples) {
      pos.push(sm.p.x + sm.n.x * t2, sm.p.y + sm.n.y * t2, z);
      pos.push(sm.p.x - sm.n.x * t2, sm.p.y - sm.n.y * t2, z);
      nor.push(0, 0, Math.sign(z), 0, 0, Math.sign(z));
      uvs.push(sm.s / tile, 0, sm.s / tile, 0.02);
    }
    for (let i = 0; i < N - 1; i++) {
      const a = base + i * 2;
      const b = a + 2;
      if (z > 0) idx.push(a, a + 1, b, b, a + 1, b + 1);
      else idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** Lathe from (radius, height) pairs in metres; axis = +Y. */
export function lathe(points: [number, number][], segments = 48): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

/** Rounded rectangle shape centred at the origin. */
export function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Plane with UVs scaled to a world tile size (so shared repeating materials line up). */
export function tiledPlane(w: number, h: number, tile: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  return g;
}

/** Convenience: add a mesh to a parent with position / rotation. */
export function put(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material | THREE.Material[],
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

export interface MergedPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
}

/**
 * Bake every mesh under `root` into world space and merge by material + shadow flags.
 * Meshes with userData.noShadow do not cast shadows.
 */
export function mergeStatic(root: THREE.Object3D): MergedPart[] {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; order: number; geos: THREE.BufferGeometry[] }>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cast = !mesh.userData.noShadow;
    let g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.getAttribute('uv')) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    // split multi-material geometry by groups
    const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
    if (mats.length > 1 && g.groups.length) {
      for (const grp of g.groups) {
        const sub = new THREE.BufferGeometry();
        for (const name of Object.keys(g.attributes)) {
          const attr = g.getAttribute(name) as THREE.BufferAttribute;
          const arr = attr.array.slice(grp.start * attr.itemSize, (grp.start + grp.count) * attr.itemSize);
          sub.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize));
        }
        parts.push({ geo: sub, mat: mats[grp.materialIndex ?? 0] });
      }
      g.dispose();
    } else {
      g.clearGroups();
      parts.push({ geo: g, mat: mats[0] });
    }
    for (const p of parts) {
      const order = mesh.renderOrder;
      const key = `${p.mat.uuid}|${cast}|${order}`;
      let b = buckets.get(key);
      if (!b) {
        b = { mat: p.mat, cast, order, geos: [] };
        buckets.set(key, b);
      }
      b.geos.push(p.geo);
    }
  });
  const out: MergedPart[] = [];
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    out.push({ geometry: merged, material: b.mat, castShadow: b.cast, receiveShadow: true, renderOrder: b.order });
  }
  return out;
}

/**
 * Merge the meshes of a (moving) sub-assembly by material, in the group's local space.
 * Meshes with userData.keep (picking targets, animated materials) are left alone.
 */
export function mergeLocal(group: THREE.Group): void {
  const keep: THREE.Object3D[] = [];
  const tmp = new THREE.Group();
  for (const child of [...group.children]) {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && !mesh.userData.keep && mesh.children.length === 0) tmp.add(mesh);
    else keep.push(child);
  }
  if (tmp.children.length < 2) {
    for (const c of [...tmp.children]) group.add(c);
    return;
  }
  for (const part of mergeStatic(tmp)) {
    const m = new THREE.Mesh(part.geometry, part.material);
    m.castShadow = part.castShadow;
    m.receiveShadow = true;
    group.add(m);
  }
  void keep;
}
