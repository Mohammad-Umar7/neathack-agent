/// <reference types="vite/client" />
// Environment: HDRI reflections, moody gradient backdrop + fog, polished concrete floor,
// key / rim / high-bay lighting with fake volumetric cones and floating dust.
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const BASE = import.meta.env.BASE_URL ?? './';
export const ASSET = (p: string) => `${BASE}assets/${p}`;

const BG_TOP = new THREE.Color(0x05070b);
const BG_HORIZON = new THREE.Color(0x1a2130);
const BG_BOTTOM = new THREE.Color(0x0b0e14);
export const FOG_COLOR = new THREE.Color(0x10141c);

class Bay {
  readonly group = new THREE.Group();
  readonly spot: THREE.SpotLight;
  private readonly dust: THREE.Points;
  private readonly dustPos: Float32Array;
  private readonly dustSeed: Float32Array;
  private readonly coneMat: THREE.ShaderMaterial;

  constructor(glow: THREE.Texture, coneMat: THREE.ShaderMaterial, highQuality: boolean) {
    const LAMP_Y = 5.4;
    this.coneMat = coneMat;
    this.spot = new THREE.SpotLight(0xffe2bd, 105, 0, 0.7, 0.85, 2);
    this.spot.position.set(0, LAMP_Y, 0.3);
    this.spot.target.position.set(0, 0, 0.2);
    this.group.add(this.spot, this.spot.target);
    // fixture: reflector bell + glowing diffuser + suspension
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.36, 0.26, 48, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }),
    );
    housing.position.set(0, LAMP_Y + 0.13, 0.3);
    this.group.add(housing);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 32), housing.material);
    cap.position.set(0, LAMP_Y + 0.3, 0.3);
    this.group.add(cap);
    const diffuser = new THREE.Mesh(
      new THREE.CircleGeometry(0.34, 48).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.2, 4.2), fog: false }),
    );
    diffuser.position.set(0, LAMP_Y + 0.005, 0.3);
    this.group.add(diffuser);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 4, 6), housing.material);
    rod.position.set(0, LAMP_Y + 2.35, 0.3);
    this.group.add(rod);
    // cone of light
    const H = LAMP_Y - 0.05;
    const coneGeo = new THREE.CylinderGeometry(0.33, 2.7, H, 64, 1, true);
    coneGeo.translate(0, -H / 2, 0);
    const cone = new THREE.Mesh(coneGeo, this.coneMat);
    cone.position.set(0, LAMP_Y, 0.3);
    cone.renderOrder = 20;
    this.group.add(cone);
    // dust motes inside the cone
    const N = highQuality ? 420 : 160;
    this.dustPos = new Float32Array(N * 3);
    this.dustSeed = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const y = 0.3 + Math.random() * (LAMP_Y - 0.6);
      const rr = (0.33 + ((LAMP_Y - y) / H) * 2.3) * Math.sqrt(Math.random()) * 0.9;
      const a = Math.random() * Math.PI * 2;
      this.dustSeed.set([Math.cos(a) * rr, y, Math.sin(a) * rr + 0.3, Math.random() * 100], i * 4);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    this.dust = new THREE.Points(
      dg,
      new THREE.PointsMaterial({
        map: glow,
        color: new THREE.Color(1.6, 1.4, 1.1),
        size: 0.028,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  update(time: number): void {
    const n = this.dustPos.length / 3;
    for (let i = 0; i < n; i++) {
      const s = i * 4;
      const ph = this.dustSeed[s + 3];
      const y0 = this.dustSeed[s + 1];
      const y = 0.3 + ((y0 - 0.3 + time * 0.035 + ph) % 4.6);
      this.dustPos[i * 3] = this.dustSeed[s] + Math.sin(time * 0.21 + ph) * 0.12;
      this.dustPos[i * 3 + 1] = y;
      this.dustPos[i * 3 + 2] = this.dustSeed[s + 2] + Math.cos(time * 0.17 + ph * 1.3) * 0.12;
    }
    (this.dust.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Points).isPoints) {
        m.geometry.dispose();
        const mat = m.material as THREE.Material;
        if (mat !== this.coneMat) mat.dispose();
      }
    });
    this.spot.dispose();
  }
}

export class Environment {
  readonly group = new THREE.Group();
  readonly key: THREE.DirectionalLight;
  private readonly bays: Bay[] = [];
  private readonly floorMat: THREE.MeshStandardMaterial;
  private readonly floor: THREE.Mesh;
  private readonly bg: THREE.Mesh;
  private readonly coneMat: THREE.ShaderMaterial;
  private envTex: THREE.Texture | null = null;
  private disposed = false;
  private readonly textures: THREE.Texture[] = [];

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly glow: THREE.Texture,
    private readonly high: boolean,
  ) {
    scene.background = FOG_COLOR.clone();
    scene.fog = new THREE.Fog(FOG_COLOR, 18, 52);

    // gradient backdrop
    const bgMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: BG_TOP },
        horizon: { value: BG_HORIZON },
        bottom: { value: BG_BOTTOM },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(max(smoothstep(0.0, 0.65, h), 1e-4), 0.8)) : mix(horizon, bottom, smoothstep(0.0, 0.2, -h));
          // faint vignette band so the horizon glows behind the cell
          c += vec3(0.020, 0.026, 0.036) * exp(-abs(h) * 9.0);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.bg = new THREE.Mesh(new THREE.SphereGeometry(95, 48, 24), bgMat);
    this.bg.renderOrder = -10;
    this.bg.frustumCulled = false;
    this.group.add(this.bg);

    // polished concrete floor
    const loader = new THREE.TextureLoader();
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const load = (p: string, srgb: boolean) => {
      const t = loader.load(ASSET(p));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(36, 36);
      t.anisotropy = aniso;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      this.textures.push(t);
      return t;
    };
    this.floorMat = new THREE.MeshStandardMaterial({
      color: 0x9da2a9,
      map: load('textures/hangar_concrete_floor_diff_1k.jpg', true),
      normalMap: load('textures/hangar_concrete_floor_nor_gl_1k.jpg', false),
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: load('textures/hangar_concrete_floor_rough_1k.jpg', false),
      roughness: 0.5,
      metalness: 0.0,
      envMapIntensity: 1.0,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2), this.floorMat);
    this.floor.receiveShadow = true;
    this.floor.renderOrder = -5;
    this.group.add(this.floor);

    // lights
    const hemi = new THREE.HemisphereLight(0xa8bddc, 0x2a2420, 0.18);
    this.group.add(hemi);
    this.key = new THREE.DirectionalLight(0xfff1de, 1.0);
    this.key.position.set(6, 10, 7);
    this.key.castShadow = high;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.00025;
    this.key.shadow.normalBias = 0.025;
    this.group.add(this.key, this.key.target);
    const rimA = new THREE.DirectionalLight(0x86aaff, 1.3);
    rimA.position.set(-8, 5, -9);
    const rimB = new THREE.DirectionalLight(0xffc896, 0.7);
    rimB.position.set(10, 3.5, -5);
    this.group.add(rimA, rimB);

    this.coneMat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(1.0, 0.84, 0.62) }, strength: { value: 0.027 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW; varying float vH;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          vH = clamp(-position.y / 5.35, 0.0, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color; uniform float strength;
        varying vec3 vN; varying vec3 vW; varying float vH;
        void main() {
          vec3 v = normalize(cameraPosition - vW);
          float facing = abs(dot(normalize(vN), v));
          float edge = smoothstep(0.15, 0.85, facing);
          float h = clamp(vH, 0.0, 1.0);
          float along = pow(max(1.0 - h, 0.0), 1.6) * smoothstep(0.0, 0.08, h);
          float a = edge * edge * along * strength;
          gl_FragColor = vec4(color * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });

    this.loadHdri();
  }

  private loadHdri(): void {
    new RGBELoader().load(
      ASSET('hdri/empty_warehouse_01_1k.hdr'),
      (tex) => {
        if (this.disposed) {
          tex.dispose();
          return;
        }
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.envTex = pmrem.fromEquirectangular(tex).texture;
        pmrem.dispose();
        tex.dispose();
        this.scene.environment = this.envTex;
        this.scene.environmentIntensity = 0.55;
        this.scene.environmentRotation.set(0, 1.9, 0);
      },
      undefined,
      () => {
        // fall back to a neutral room environment if the HDRI is missing
        import('three/examples/jsm/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
          if (this.disposed) return;
          const pmrem = new THREE.PMREMGenerator(this.renderer);
          this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
          pmrem.dispose();
          this.scene.environment = this.envTex;
          this.scene.environmentIntensity = 0.4;
        });
      },
    );
  }

  /** Place one high-bay lamp over each cell anchor and fit the key light's shadow box. */
  setAnchors(anchors: THREE.Vector3[]): void {
    while (this.bays.length < anchors.length) {
      const b = new Bay(this.glow, this.coneMat, this.high);
      this.bays.push(b);
      this.group.add(b.group);
    }
    this.bays.forEach((b, i) => {
      const a = anchors[i];
      b.group.visible = !!a;
      if (a) b.group.position.set(a.x, 0, a.z);
    });
    const minX = Math.min(...anchors.map((a) => a.x)) - 4.6;
    const maxX = Math.max(...anchors.map((a) => a.x)) + 4.6;
    const cx = (minX + maxX) / 2;
    const half = (maxX - minX) / 2;
    this.key.target.position.set(cx, 0, 0);
    this.key.position.set(cx + 6, 10, 7);
    const cam = this.key.shadow.camera;
    cam.left = -half - 1;
    cam.right = half + 1;
    cam.top = 5.5;
    cam.bottom = -5.5;
    cam.near = 2;
    cam.far = 30;
    cam.updateProjectionMatrix();
    this.key.shadow.needsUpdate = true;
  }

  update(time: number): void {
    for (const b of this.bays) if (b.group.visible) b.update(time);
  }

  dispose(): void {
    this.disposed = true;
    for (const b of this.bays) b.dispose();
    this.coneMat.dispose();
    this.floor.geometry.dispose();
    this.floorMat.dispose();
    for (const t of this.textures) t.dispose();
    this.bg.geometry.dispose();
    (this.bg.material as THREE.Material).dispose();
    this.envTex?.dispose();
  }
}
