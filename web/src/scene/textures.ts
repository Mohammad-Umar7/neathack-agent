// Procedural CanvasTextures for the digital twin: belt rubber, cardboard, hazard tape,
// wire mesh, glows and text plates. Everything here is generated at runtime, so no
// licensing questions and no extra downloads.
import * as THREE from 'three';

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  return [c, g];
}

/** Small deterministic PRNG (mulberry32) so textures look the same on every load. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function toTexture(c: HTMLCanvasElement, srgb = true, repeat = true, aniso = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

export const FONT = '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

/** Rough-top rubber conveyor belt. Canvas x = along the belt (1 m), canvas y = across the belt. */
export function beltCanvases(): { color: HTMLCanvasElement; bump: HTMLCanvasElement } {
  const W = 1024;
  const H = 256;
  const [c, g] = makeCanvas(W, H);
  const [b, bg] = makeCanvas(W, H);
  const r = rng(11);
  g.fillStyle = '#25272a';
  g.fillRect(0, 0, W, H);
  bg.fillStyle = '#404040';
  bg.fillRect(0, 0, W, H);
  // fine diamond rough-top pattern
  for (let y = 0; y < H; y += 8) {
    const off = ((y / 8) % 2) * 4;
    for (let x = -8; x < W + 8; x += 8) {
      const a = 0.05 + r() * 0.035;
      g.fillStyle = `rgba(200,205,215,${a})`;
      bg.fillStyle = `rgba(255,255,255,${0.55 + r() * 0.2})`;
      for (const ctx of [g, bg]) {
        ctx.beginPath();
        ctx.moveTo(x + off, y + 1);
        ctx.lineTo(x + off + 3, y + 4);
        ctx.lineTo(x + off, y + 7);
        ctx.lineTo(x + off - 3, y + 4);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  // lengthwise wear streaks where boxes ride
  for (let i = 0; i < 70; i++) {
    const y = H * 0.2 + r() * H * 0.6;
    g.fillStyle = `rgba(150,150,160,${r() * 0.035})`;
    g.fillRect(0, y, W, 1 + r() * 4);
  }
  // scuffs and dust
  for (let i = 0; i < 900; i++) {
    g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${r() * 0.05})` : `rgba(0,0,0,${r() * 0.12})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 6, 1 + r() * 2);
  }
  // finger splice (one per metre), makes the travel direction readable
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  bg.strokeStyle = 'rgba(0,0,0,0.9)';
  for (const ctx of [g, bg]) {
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const y = (i / 16) * H;
      const x = 640 + (i / 16) * 60 + (i % 2 === 0 ? -9 : 9);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // yellow tracking marks near both edges (a common maintenance marking)
  g.fillStyle = 'rgba(230,180,40,0.85)';
  g.fillRect(200, 6, 34, 10);
  g.fillRect(200, H - 16, 34, 10);
  // darker belt edges
  const eg = g.createLinearGradient(0, 0, 0, H);
  eg.addColorStop(0, 'rgba(0,0,0,0.55)');
  eg.addColorStop(0.06, 'rgba(0,0,0,0)');
  eg.addColorStop(0.94, 'rgba(0,0,0,0)');
  eg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = eg;
  g.fillRect(0, 0, W, H);
  return { color: c, bump: b };
}

function kraftBase(g: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const r = rng(seed);
  g.fillStyle = '#b4875a';
  g.fillRect(0, 0, w, h);
  // large-scale tone variation
  for (let i = 0; i < 30; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = 40 + r() * 120;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() > 0.5;
    gr.addColorStop(0, dark ? 'rgba(90,60,30,0.10)' : 'rgba(230,190,140,0.10)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  // fibres
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = r() > 0.5 ? `rgba(70,45,20,${r() * 0.12})` : `rgba(240,210,170,${r() * 0.12})`;
    g.fillRect(r() * w, r() * h, 2 + r() * 10, 1);
  }
  // corrugation flutes (very faint vertical bands)
  for (let x = 0; x < w; x += 7) {
    g.fillStyle = 'rgba(60,40,20,0.035)';
    g.fillRect(x, 0, 3, h);
  }
  // edge darkening / handling grime
  const e = 0.08;
  const lg = g.createLinearGradient(0, 0, w, 0);
  lg.addColorStop(0, 'rgba(60,35,15,0.35)');
  lg.addColorStop(e, 'rgba(0,0,0,0)');
  lg.addColorStop(1 - e, 'rgba(0,0,0,0)');
  lg.addColorStop(1, 'rgba(60,35,15,0.35)');
  g.fillStyle = lg;
  g.fillRect(0, 0, w, h);
  const vg = g.createLinearGradient(0, 0, 0, h);
  vg.addColorStop(0, 'rgba(60,35,15,0.3)');
  vg.addColorStop(e, 'rgba(0,0,0,0)');
  vg.addColorStop(1 - e, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(60,35,15,0.3)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
}

function upArrows(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.save();
  g.fillStyle = 'rgba(45,28,18,0.85)';
  for (const dx of [0, s * 0.55]) {
    g.beginPath();
    g.moveTo(x + dx, y);
    g.lineTo(x + dx + s * 0.22, y + s * 0.35);
    g.lineTo(x + dx + s * 0.08, y + s * 0.35);
    g.lineTo(x + dx + s * 0.08, y + s);
    g.lineTo(x + dx - s * 0.08, y + s);
    g.lineTo(x + dx - s * 0.08, y + s * 0.35);
    g.lineTo(x + dx - s * 0.22, y + s * 0.35);
    g.closePath();
    g.fill();
  }
  g.fillRect(x - s * 0.25, y + s * 1.08, s * 1.05, s * 0.07);
  g.restore();
}

/** Side face (0.4 m x 0.25 m) with a shipping label carrying the box id. */
export function cardboardSideCanvas(id: number): HTMLCanvasElement {
  const W = 512;
  const H = 320;
  const [c, g] = makeCanvas(W, H);
  kraftBase(g, W, H, 100 + (id % 7));
  upArrows(g, 46, 40, 58);
  g.fillStyle = 'rgba(45,28,18,0.8)';
  g.font = `700 20px ${FONT}`;
  g.fillText('THIS SIDE UP', 26, 150);
  g.font = `600 15px ${FONT}`;
  g.fillText('HANDLE WITH CARE', 26, 172);
  // recycle-ish stamp
  g.strokeStyle = 'rgba(45,28,18,0.6)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(70, 245, 28, 0, Math.PI * 2);
  g.stroke();
  g.font = `700 13px ${FONT}`;
  g.fillText('BOX', 57, 250);
  // shipping label
  const lx = 238;
  const ly = 52;
  const lw = 236;
  const lh = 214;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.25)';
  g.shadowBlur = 6;
  g.fillStyle = '#f4f2ec';
  g.fillRect(lx, ly, lw, lh);
  g.restore();
  g.fillStyle = '#111';
  g.fillRect(lx, ly, lw, 34);
  g.fillStyle = '#f4f2ec';
  g.font = `800 18px ${FONT}`;
  g.fillText('STOP/PROVE', lx + 12, ly + 24);
  g.font = `600 12px ${FONT}`;
  g.fillText('LINE 01', lx + lw - 62, ly + 23);
  g.fillStyle = '#111';
  g.font = `800 64px ${FONT}`;
  const label = `#${String(id).padStart(2, '0')}`;
  g.fillText(label, lx + 12, ly + 100);
  g.font = `600 12px ${FONT}`;
  g.fillText('DEST  PICK-01  >  PALLET A', lx + 12, ly + 122);
  // barcode
  const r = rng(900 + id);
  let x = lx + 12;
  while (x < lx + lw - 14) {
    const bw = 1 + Math.floor(r() * 4);
    if (r() > 0.4) g.fillRect(x, ly + 134, bw, 52);
    x += bw + 1;
  }
  g.font = `500 11px "Consolas", monospace`;
  g.fillText(`0 42${String(id).padStart(4, '0')} 77310 ${(id * 7) % 10}`, lx + 14, ly + 202);
  return c;
}

/** End face (0.3 m x 0.25 m) with the tape strip folding down from the top. */
export function cardboardEndCanvas(): HTMLCanvasElement {
  const W = 384;
  const H = 320;
  const [c, g] = makeCanvas(W, H);
  kraftBase(g, W, H, 42);
  tapeBand(g, W / 2 - 34, 0, 68, H * 0.32, false);
  g.fillStyle = 'rgba(45,28,18,0.7)';
  g.font = `700 22px ${FONT}`;
  g.fillText('FRAGILE', 130, 230);
  return c;
}

/** Top face (0.4 m x 0.3 m): flap seam plus a tape strip along the box. */
export function cardboardTopCanvases(): { color: HTMLCanvasElement; rough: HTMLCanvasElement } {
  const W = 512;
  const H = 384;
  const [c, g] = makeCanvas(W, H);
  const [rc, rg] = makeCanvas(W, H);
  kraftBase(g, W, H, 77);
  g.fillStyle = 'rgba(40,25,10,0.55)';
  g.fillRect(0, H / 2 - 1.5, W, 3);
  tapeBand(g, 0, H / 2 - 40, W, 80, true);
  rg.fillStyle = '#e0e0e0';
  rg.fillRect(0, 0, W, H);
  rg.fillStyle = '#5a5a5a';
  rg.fillRect(0, H / 2 - 40, W, 80);
  return { color: c, rough: rc };
}

function tapeBand(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, horizontal: boolean): void {
  g.save();
  g.fillStyle = 'rgba(196,150,92,0.85)';
  g.fillRect(x, y, w, h);
  const r = rng(5);
  // wrinkles and a specular streak
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(255,235,200,${r() * 0.18})`;
    if (horizontal) g.fillRect(x + r() * w, y, 2 + r() * 6, h);
    else g.fillRect(x, y + r() * h, w, 2 + r() * 5);
  }
  g.fillStyle = 'rgba(255,245,225,0.25)';
  if (horizontal) g.fillRect(x, y + h * 0.3, w, h * 0.12);
  else g.fillRect(x + w * 0.3, y, w * 0.12, h);
  g.fillStyle = 'rgba(80,50,20,0.35)';
  if (horizontal) {
    g.fillRect(x, y, w, 2);
    g.fillRect(x, y + h - 2, w, 2);
  } else {
    g.fillRect(x, y, 2, h);
    g.fillRect(x + w - 2, y, 2, h);
  }
  g.restore();
}

/** Yellow/black diagonal hazard stripes. */
export function hazardCanvas(): HTMLCanvasElement {
  const W = 256;
  const H = 64;
  const [c, g] = makeCanvas(W, H);
  g.fillStyle = '#f2b311';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#121212';
  for (let x = -H; x < W + H; x += 64) {
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(x + 32, H);
    g.lineTo(x + 32 + H, 0);
    g.lineTo(x + H, 0);
    g.closePath();
    g.fill();
  }
  const r = rng(3);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.15})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 2);
  }
  return c;
}

/** Welded wire mesh alpha (one 50 mm cell per tile). */
export function wireMeshCanvas(): HTMLCanvasElement {
  const S = 128;
  const [c, g] = makeCanvas(S, S);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff';
  const t = 6;
  g.fillRect(0, 0, S, t);
  g.fillRect(0, 0, t, S);
  return c;
}

/** Soft radial glow (white centre, transparent edge). */
export function glowCanvas(core = 0.15): HTMLCanvasElement {
  const S = 128;
  const [c, g] = makeCanvas(S, S);
  // grayscale on black: works both as an alphaMap (green channel) and as an additive map
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgb(255,255,255)');
  gr.addColorStop(core, 'rgb(204,204,204)');
  gr.addColorStop(0.45, 'rgb(56,56,56)');
  gr.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return c;
}

/** Contact-shadow blob used under legs, posts and the conveyor. */
export function blobCanvas(): HTMLCanvasElement {
  const S = 128;
  const [c, g] = makeCanvas(S, S);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgb(255,255,255)');
  gr.addColorStop(0.35, 'rgb(190,190,190)');
  gr.addColorStop(0.7, 'rgb(60,60,60)');
  gr.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return c;
}

/** Thin ring (for floor pulses). */
export function ringCanvas(): HTMLCanvasElement {
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgb(0,0,0)');
  gr.addColorStop(0.55, 'rgb(14,14,14)');
  gr.addColorStop(0.8, 'rgb(255,255,255)');
  gr.addColorStop(0.88, 'rgb(90,90,90)');
  gr.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return c;
}

/** Brushed-metal roughness variation, streaks along canvas x. */
export function brushedCanvas(): HTMLCanvasElement {
  const W = 512;
  const H = 128;
  const [c, g] = makeCanvas(W, H);
  const r = rng(21);
  g.fillStyle = '#d6d6d6';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 700; i++) {
    const v = 170 + Math.floor(r() * 85);
    g.fillStyle = `rgba(${v},${v},${v},${0.15 + r() * 0.25})`;
    g.fillRect(r() * W, r() * H, 30 + r() * 200, 1);
  }
  return c;
}

/** Plain text plate (legend plates, nameplates, signs). */
export function textPlateCanvas(
  lines: string[],
  opts: { w?: number; h?: number; bg?: string; fg?: string; size?: number; weight?: number; border?: string } = {},
): HTMLCanvasElement {
  const W = opts.w ?? 256;
  const H = opts.h ?? 64;
  const [c, g] = makeCanvas(W, H);
  g.fillStyle = opts.bg ?? '#1b1c1e';
  g.fillRect(0, 0, W, H);
  if (opts.border) {
    g.strokeStyle = opts.border;
    g.lineWidth = Math.max(2, H * 0.06);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth);
  }
  g.fillStyle = opts.fg ?? '#f2f2f2';
  const size = opts.size ?? Math.floor(H * 0.55);
  g.font = `${opts.weight ?? 700} ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lh = H / (lines.length + 0.2);
  lines.forEach((ln, i) => g.fillText(ln, W / 2, lh * (i + 0.6)));
  return c;
}

/** Yellow E-stop backing disc with "EMERGENCY STOP" around the rim. */
export function estopDiscCanvas(): HTMLCanvasElement {
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  g.fillStyle = '#f5c400';
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#141414';
  g.font = `800 46px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = 'EMERGENCY  STOP  •  EMERGENCY  STOP  •  ';
  const rad = S / 2 - 52;
  const step = (Math.PI * 2) / text.length;
  for (let i = 0; i < text.length; i++) {
    const a = -Math.PI / 2 + i * step;
    g.save();
    g.translate(S / 2 + Math.cos(a) * rad, S / 2 + Math.sin(a) * rad);
    g.rotate(a + Math.PI / 2);
    g.fillText(text[i], 0, 0);
    g.restore();
  }
  return c;
}

/** Pallet wood. */
export function woodCanvas(): HTMLCanvasElement {
  const W = 512;
  const H = 128;
  const [c, g] = makeCanvas(W, H);
  const r = rng(55);
  g.fillStyle = '#b08a5c';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 140; i++) {
    const y = r() * H;
    g.strokeStyle = `rgba(${r() > 0.5 ? '90,60,30' : '210,170,120'},${0.1 + r() * 0.2})`;
    g.lineWidth = 1 + r() * 2;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
    g.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const x = r() * W;
    const y = r() * H;
    g.fillStyle = 'rgba(70,45,20,0.45)';
    g.beginPath();
    g.ellipse(x, y, 8 + r() * 6, 4 + r() * 3, 0, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** Fan-cover grille alpha: concentric slots with radial spokes. */
export function grilleCanvas(): HTMLCanvasElement {
  const S = 256;
  const [c, g] = makeCanvas(S, S);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#fff';
  g.lineWidth = 7;
  for (let rad = 18; rad < S / 2; rad += 16) {
    g.beginPath();
    g.arc(S / 2, S / 2, rad, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 9;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    g.lineTo(S / 2 + Math.cos(a) * S, S / 2 + Math.sin(a) * S);
    g.stroke();
  }
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(S / 2, S / 2, 14, 0, Math.PI * 2);
  g.fill();
  // clear outside the circle
  g.globalCompositeOperation = 'destination-in';
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
  g.fill();
  return c;
}

/** Floor stencil (cell letter + project name). */
export function stencilCanvas(letter: string): HTMLCanvasElement {
  const W = 512;
  const H = 256;
  const [c, g] = makeCanvas(W, H);
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,1)';
  g.font = `900 190px ${FONT}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText(letter, 20, H / 2 + 8);
  g.font = `800 50px ${FONT}`;
  g.fillText('CELL', 190, H / 2 - 34);
  g.font = `600 34px ${FONT}`;
  g.fillText('STOP/PROVE', 190, H / 2 + 30);
  g.fillText('LINE 01', 190, H / 2 + 70);
  return c;
}
