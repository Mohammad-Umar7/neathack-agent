// Shared PBR materials and textures. One Kit per stage; cells share it (per-cell state
// such as lamp glow or belt scroll lives in per-cell material clones created in cell.ts).
import * as THREE from 'three';
import {
  beltCanvases,
  blobCanvas,
  brushedCanvas,
  cardboardEndCanvas,
  cardboardSideCanvas,
  cardboardTopCanvases,
  estopDiscCanvas,
  glowCanvas,
  grilleCanvas,
  hazardCanvas,
  ringCanvas,
  toTexture,
  wireMeshCanvas,
  woodCanvas,
} from './textures';

export class Kit {
  readonly textures: THREE.Texture[] = [];
  readonly materials: THREE.Material[] = [];

  // textures
  readonly brushed: THREE.Texture;
  readonly beltMap: THREE.Texture;
  readonly beltBump: THREE.Texture;
  readonly hazard: THREE.Texture;
  readonly wire: THREE.Texture;
  readonly glow: THREE.Texture;
  readonly blob: THREE.Texture;
  readonly ring: THREE.Texture;
  readonly grille: THREE.Texture;

  // metals
  readonly alu: THREE.MeshStandardMaterial;
  readonly aluDark: THREE.MeshStandardMaterial;
  readonly steel: THREE.MeshStandardMaterial;
  readonly steelDark: THREE.MeshStandardMaterial;
  readonly chrome: THREE.MeshStandardMaterial;
  readonly zinc: THREE.MeshStandardMaterial;
  // paints / plastics / rubber
  readonly belt: THREE.MeshStandardMaterial;
  readonly rubber: THREE.MeshStandardMaterial;
  readonly yellow: THREE.MeshStandardMaterial;
  readonly motorBlue: THREE.MeshStandardMaterial;
  readonly panelGrey: THREE.MeshStandardMaterial;
  readonly anthracite: THREE.MeshStandardMaterial;
  readonly blackPlastic: THREE.MeshStandardMaterial;
  readonly fenceFrame: THREE.MeshStandardMaterial;
  readonly fenceMesh: THREE.MeshStandardMaterial;
  readonly guardMesh: THREE.MeshStandardMaterial;
  readonly grilleMat: THREE.MeshStandardMaterial;
  readonly wood: THREE.MeshStandardMaterial;
  readonly hazardMat: THREE.MeshStandardMaterial;
  readonly floorYellow: THREE.MeshStandardMaterial;
  readonly floorWhite: THREE.MeshStandardMaterial;
  readonly reflector: THREE.MeshStandardMaterial;
  readonly duct: THREE.MeshStandardMaterial;
  readonly cable: THREE.MeshStandardMaterial;
  readonly cableOrange: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshStandardMaterial;
  readonly blobMat: THREE.MeshBasicMaterial;
  readonly estopDisc: THREE.MeshStandardMaterial;
  // cardboard
  readonly cardTop: THREE.MeshStandardMaterial;
  readonly cardEnd: THREE.MeshStandardMaterial;
  readonly cardBottom: THREE.MeshStandardMaterial;
  private readonly cardSides = new Map<number, THREE.MeshStandardMaterial>();

  constructor(private readonly maxAniso: number) {
    this.brushed = this.t(toTexture(brushedCanvas(), false));
    const belt = beltCanvases();
    this.beltMap = this.t(toTexture(belt.color));
    this.beltBump = this.t(toTexture(belt.bump, false));
    this.hazard = this.t(toTexture(hazardCanvas()));
    this.wire = this.t(toTexture(wireMeshCanvas(), false));
    this.glow = this.t(toTexture(glowCanvas(), false, false));
    this.blob = this.t(toTexture(blobCanvas(), false, false));
    this.ring = this.t(toTexture(ringCanvas(), false, false));
    this.grille = this.t(toTexture(grilleCanvas(), false, false));

    this.alu = this.m(
      new THREE.MeshStandardMaterial({
        color: 0xc4c8ce,
        metalness: 1,
        roughness: 0.48,
        roughnessMap: this.brushed,
        envMapIntensity: 1.15,
      }),
    );
    this.aluDark = this.m(new THREE.MeshStandardMaterial({ color: 0x2c2f34, metalness: 0.75, roughness: 0.38 }));
    this.steel = this.m(
      new THREE.MeshStandardMaterial({ color: 0xd2d5da, metalness: 1, roughness: 0.36, roughnessMap: this.brushed }),
    );
    this.steelDark = this.m(new THREE.MeshStandardMaterial({ color: 0x5d6168, metalness: 1, roughness: 0.42 }));
    this.chrome = this.m(new THREE.MeshStandardMaterial({ color: 0xe8eaee, metalness: 1, roughness: 0.16 }));
    this.zinc = this.m(new THREE.MeshStandardMaterial({ color: 0xaeb2b8, metalness: 1, roughness: 0.42 }));

    this.belt = this.m(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: this.beltMap,
        bumpMap: this.beltBump,
        bumpScale: 1.2,
        roughness: 0.78,
        metalness: 0,
      }),
    );
    this.rubber = this.m(new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.65, metalness: 0 }));
    this.yellow = this.m(new THREE.MeshStandardMaterial({ color: 0xe9a90c, roughness: 0.48, metalness: 0.1 }));
    this.motorBlue = this.m(new THREE.MeshStandardMaterial({ color: 0x1d4f86, roughness: 0.36, metalness: 0.35 }));
    this.panelGrey = this.m(new THREE.MeshStandardMaterial({ color: 0xc9cbc7, roughness: 0.48, metalness: 0.05 }));
    this.anthracite = this.m(new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.55, metalness: 0.1 }));
    this.blackPlastic = this.m(new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.42, metalness: 0 }));
    this.fenceFrame = this.m(new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.5, metalness: 0.45 }));
    this.fenceMesh = this.m(
      new THREE.MeshStandardMaterial({
        color: 0x5a616a,
        roughness: 0.4,
        metalness: 0.7,
        alphaMap: this.wire,
        transparent: true,
        opacity: 0.62,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.guardMesh = this.m(
      new THREE.MeshStandardMaterial({
        color: 0xf2b10f,
        roughness: 0.4,
        metalness: 0.2,
        alphaMap: this.wire,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.grilleMat = this.m(
      new THREE.MeshStandardMaterial({
        color: 0x1d4f86,
        roughness: 0.4,
        metalness: 0.35,
        alphaMap: this.grille,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      }),
    );
    this.wood = this.m(
      new THREE.MeshStandardMaterial({ map: this.t(toTexture(woodCanvas())), roughness: 0.85, metalness: 0 }),
    );
    this.hazardMat = this.m(
      new THREE.MeshStandardMaterial({
        map: this.hazard,
        roughness: 0.55,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.floorYellow = this.m(
      new THREE.MeshStandardMaterial({
        color: 0xe8a90e,
        roughness: 0.5,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.floorWhite = this.m(
      new THREE.MeshStandardMaterial({
        color: 0xd8d8d2,
        roughness: 0.6,
        metalness: 0,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    this.reflector = this.m(
      new THREE.MeshStandardMaterial({ color: 0xc8141a, roughness: 0.18, metalness: 0.1, emissive: 0x400004 }),
    );
    this.duct = this.m(new THREE.MeshStandardMaterial({ color: 0x8b8f93, roughness: 0.6, metalness: 0 }));
    this.cable = this.m(new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.5, metalness: 0 }));
    this.cableOrange = this.m(new THREE.MeshStandardMaterial({ color: 0xd8641c, roughness: 0.5, metalness: 0 }));
    this.glass = this.m(
      new THREE.MeshStandardMaterial({
        color: 0x0b0d10,
        roughness: 0.05,
        metalness: 0.2,
        envMapIntensity: 1.5,
      }),
    );
    this.blobMat = this.m(
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        alphaMap: this.blob,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.estopDisc = this.m(
      new THREE.MeshStandardMaterial({
        map: this.t(toTexture(estopDiscCanvas(), true, false)),
        roughness: 0.35,
        metalness: 0,
      }),
    );

    const top = cardboardTopCanvases();
    this.cardTop = this.m(
      new THREE.MeshStandardMaterial({
        map: this.t(toTexture(top.color, true, false)),
        roughnessMap: this.t(toTexture(top.rough, false, false)),
        roughness: 1,
        metalness: 0,
      }),
    );
    this.cardEnd = this.m(
      new THREE.MeshStandardMaterial({
        map: this.t(toTexture(cardboardEndCanvas(), true, false)),
        roughness: 0.88,
        metalness: 0,
      }),
    );
    this.cardBottom = this.m(new THREE.MeshStandardMaterial({ color: 0x9c7349, roughness: 0.92, metalness: 0 }));

    for (const tx of this.textures) tx.anisotropy = Math.min(tx.anisotropy, this.maxAniso);
  }

  /** Per-box side material carrying the box id on its shipping label (cached). */
  cardSide(id: number): THREE.MeshStandardMaterial {
    const key = id % 100;
    let m = this.cardSides.get(key);
    if (!m) {
      const tx = this.t(toTexture(cardboardSideCanvas(key), true, false));
      tx.anisotropy = Math.min(8, this.maxAniso);
      m = this.m(new THREE.MeshStandardMaterial({ map: tx, roughness: 0.86, metalness: 0 }));
      this.cardSides.set(key, m);
    }
    return m;
  }

  /** Box material array in BoxGeometry group order: +x, -x, +y, -y, +z, -z. */
  boxMaterials(id: number): THREE.Material[] {
    const side = this.cardSide(id);
    return [this.cardEnd, this.cardEnd, this.cardTop, this.cardBottom, side, side];
  }

  t<T extends THREE.Texture>(tx: T): T {
    this.textures.push(tx);
    return tx;
  }

  m<T extends THREE.Material>(mat: T): T {
    this.materials.push(mat);
    return mat;
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}

/** Emissive "lamp" material that can be driven between off and on. */
export function lampMaterial(color: number, offColor = 0x15171a): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: offColor,
    emissive: color,
    emissiveIntensity: 0,
    roughness: 0.25,
    metalness: 0.1,
  });
}

/** Additive glow material (beams, halos). Colour values above 1 feed the bloom pass. */
export function additiveMaterial(color: THREE.ColorRepresentation, map?: THREE.Texture, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    map: map ?? null,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: true,
    fog: false,
  });
}
