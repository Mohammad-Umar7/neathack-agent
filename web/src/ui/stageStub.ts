// 2D schematic of the conveyor cell. Stands in for the 3D stage until ../scene lands (and is the
// fallback if WebGL is unavailable or ?stage=2d). Implements the same Stage interface.

import type { Frame, Violation } from '../types';
import type { CellId, PanelControl, Stage } from './stage';

interface CellState {
  frame?: Frame;
  flash?: { t0: number; v: Violation };
  tread: number;
  lastX: Map<number, number>;
  pickFx: { t0: number; x: number }[];
}

const COLORS = {
  belt: '#1a1f27',
  beltEdge: '#2b323d',
  tread: 'rgba(255,255,255,0.05)',
  box: '#c9995b',
  boxEdge: '#8a6232',
  tape: 'rgba(240,220,170,0.55)',
  text: '#9aa3b2',
  dim: '#5d6676',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  cyan: '#22d3ee',
  brand: '#f5c518',
};

export function createStubStage(container: HTMLElement): Stage {
  const canvas = document.createElement('canvas');
  canvas.className = 'stage-2d';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  let layout: 'single' | 'twin' = 'single';
  let labels = { A: '', B: '' };
  let interactive = false;
  let controlCb: ((c: PanelControl) => void) | null = null;
  const cells: Record<CellId, CellState> = {
    A: { tread: 0, lastX: new Map(), pickFx: [] },
    B: { tread: 0, lastX: new Map(), pickFx: [] },
  };
  let hit: { x: number; y: number; w: number; h: number; c: PanelControl }[] = [];
  let raf = 0;
  let disposed = false;

  const resize = (): void => {
    const r = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    schedule();
  };

  function schedule(): void {
    if (!raf && !disposed) raf = requestAnimationFrame(draw);
  }

  function rr(x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function drawCell(id: CellId, x0: number, y0: number, w: number, h: number): void {
    const st = cells[id];
    const f = st.frame;
    const now = performance.now();
    const pad = Math.max(16, w * 0.05);
    const bx0 = x0 + pad + Math.min(130, w * 0.14);
    const bx1 = x0 + w - pad - Math.min(70, w * 0.08);
    const scale = (bx1 - bx0) / 4.0;
    const bh = Math.max(22, Math.min(54, h * 0.2));
    const by = y0 + h * 0.56 - bh / 2;
    const X = (m: number): number => bx0 + m * scale;

    if (layout === 'twin' && labels[id]) {
      ctx.font = '600 12px Inter, sans-serif';
      ctx.fillStyle = id === 'A' ? COLORS.red : COLORS.green;
      ctx.fillText(labels[id], x0 + pad, y0 + 22);
    }

    // guard fence around the pick area
    const guardOpen = f ? f.in.GUARD_CLOSED === 0 : false;
    ctx.save();
    ctx.strokeStyle = guardOpen ? COLORS.amber : 'rgba(255,255,255,0.12)';
    ctx.setLineDash(guardOpen ? [6, 5] : []);
    ctx.lineWidth = 1.5;
    rr(X(2.9), by - bh * 1.6, X(4.0) - X(2.9) + 18, bh * 4.2, 8);
    ctx.stroke();
    ctx.restore();
    if (guardOpen) {
      ctx.font = '600 10px JetBrains Mono, monospace';
      ctx.fillStyle = COLORS.amber;
      ctx.fillText('GUARD OPEN', X(2.95), by - bh * 1.6 - 6);
    }

    // belt
    ctx.fillStyle = COLORS.belt;
    rr(bx0 - 8, by, bx1 - bx0 + 16, bh, bh / 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.beltEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    // tread
    ctx.save();
    rr(bx0 - 8, by, bx1 - bx0 + 16, bh, bh / 2);
    ctx.clip();
    ctx.strokeStyle = COLORS.tread;
    const step = 18;
    const off = (st.tread * scale) % step;
    for (let x = bx0 - 8 + off; x < bx1 + 8; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, by + 3);
      ctx.lineTo(x - 6, by + bh - 3);
      ctx.stroke();
    }
    ctx.restore();
    // rollers
    for (const rx of [bx0 - 8 + bh / 2, bx1 + 8 - bh / 2]) {
      ctx.beginPath();
      ctx.arc(rx, by + bh / 2, bh * 0.32, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.stroke();
    }

    // photo-eyes
    for (const [name, m] of [
      ['PE_IN', 0.3],
      ['PE_END', 3.7],
    ] as const) {
      const on = f ? f.in[name] === 1 : false;
      const forced = f?.stuck?.[name] !== undefined;
      const sx = X(m);
      ctx.strokeStyle = on ? COLORS.amber : 'rgba(34,211,238,0.35)';
      ctx.lineWidth = on ? 2 : 1;
      ctx.setLineDash(on ? [] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(sx, by - 14);
      ctx.lineTo(sx, by + bh + 14);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = on ? COLORS.amber : '#2b323d';
      ctx.fillRect(sx - 5, by - 22, 10, 8);
      ctx.fillRect(sx - 5, by + bh + 14, 10, 8);
      ctx.font = '600 10px JetBrains Mono, monospace';
      ctx.fillStyle = forced ? '#e879f9' : on ? COLORS.amber : COLORS.dim;
      ctx.textAlign = 'center';
      ctx.fillText(forced ? `${name} FORCED` : name, sx, by + bh + 36);
      ctx.textAlign = 'left';
    }

    // boxes
    const boxW = 0.4 * scale;
    const boxH = bh * 0.86;
    if (f) {
      for (const b of f.boxes) {
        if (b.state === 'picked') continue;
        let cx = X(b.x);
        let cy = by + bh / 2;
        let rot = 0;
        let alpha = 1;
        if (b.state === 'dropped') {
          cx = Math.min(X(b.x), bx1 + 30);
          cy = by + bh + 26;
          rot = 0.5;
          alpha = 0.75;
        }
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.fillStyle = COLORS.box;
        rr(-boxW / 2, -boxH / 2, boxW, boxH, 3);
        ctx.fill();
        ctx.strokeStyle = b.state === 'dropped' ? COLORS.red : COLORS.boxEdge;
        ctx.lineWidth = b.state === 'dropped' ? 2 : 1;
        ctx.stroke();
        ctx.fillStyle = COLORS.tape;
        ctx.fillRect(-boxW / 2, -2, boxW, 4);
        ctx.restore();
      }
    }

    // robot at the pick position
    const rx = X(3.7);
    const ry = by - bh * 1.15;
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rx + 34, ry - 6);
    ctx.lineTo(rx + 10, ry - 16);
    ctx.lineTo(rx, ry + 2);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(rx - 7, ry + 2, 14, 5);
    st.pickFx = st.pickFx.filter((p) => now - p.t0 < 900);
    for (const p of st.pickFx) {
      const k = (now - p.t0) / 900;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = COLORS.box;
      rr(X(p.x) - boxW / 2, by - k * bh * 1.4, boxW, boxH, 3);
      ctx.fill();
      ctx.restore();
    }

    // stack light
    const tx = bx1 + Math.min(44, w * 0.04);
    const ty = by - bh * 1.7;
    ctx.fillStyle = '#20252e';
    rr(tx - 9, ty - 4, 18, 62, 5);
    ctx.fill();
    const lamps: [string, string][] = [
      ['LAMP_RED', COLORS.red],
      ['LAMP_AMBER', COLORS.amber],
      ['LAMP_GREEN', COLORS.green],
    ];
    lamps.forEach(([n, c], i) => {
      const on = f ? f.out[n] === 1 : false;
      ctx.beginPath();
      ctx.arc(tx, ty + 8 + i * 19, 7, 0, Math.PI * 2);
      ctx.fillStyle = on ? c : 'rgba(255,255,255,0.06)';
      if (on) {
        ctx.shadowColor = c;
        ctx.shadowBlur = 16;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // operator panel
    const px = x0 + pad;
    const py = by - 6;
    const pw = Math.min(120, w * 0.13);
    ctx.fillStyle = '#151a22';
    rr(px, py - 34, pw, bh + 74, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.stroke();
    const btn = (c: PanelControl, label: string, bx: number, byy: number, color: string, on: boolean): void => {
      ctx.beginPath();
      ctx.arc(bx, byy, 10, 0, Math.PI * 2);
      ctx.fillStyle = on ? color : `${color}55`;
      if (on) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = '600 8px JetBrains Mono, monospace';
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'center';
      ctx.fillText(label, bx, byy + 21);
      ctx.textAlign = 'left';
      if (id === 'A') hit.push({ x: bx - 13, y: byy - 13, w: 26, h: 26, c });
    };
    const c1 = px + pw * 0.25;
    const c2 = px + pw * 0.5;
    const c3 = px + pw * 0.75;
    btn('START', 'START', c1, py - 12, COLORS.green, f?.in.START === 1);
    btn('STOP', 'STOP', c2, py - 12, '#e5e7eb', f?.in.STOP === 1);
    btn('RESET', 'RESET', c3, py - 12, '#60a5fa', f?.in.RESET === 1);
    // e-stop mushroom
    ctx.beginPath();
    ctx.arc(c1 + 4, py + 30, 14, 0, Math.PI * 2);
    ctx.fillStyle = f?.in.ESTOP === 1 ? COLORS.red : '#7f1d1d';
    ctx.fill();
    ctx.strokeStyle = COLORS.brand;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.font = '600 8px JetBrains Mono, monospace';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.fillText('E-STOP', c1 + 4, py + 56);
    if (id === 'A') hit.push({ x: c1 - 12, y: py + 14, w: 32, h: 32, c: 'ESTOP' });
    // guard key
    rr(c3 - 14, py + 18, 28, 24, 4);
    ctx.fillStyle = guardOpen ? `${COLORS.amber}` : '#2b323d';
    ctx.fill();
    ctx.fillStyle = guardOpen ? '#111' : COLORS.text;
    ctx.fillText('DOOR', c3, py + 34);
    ctx.fillStyle = COLORS.text;
    ctx.fillText('GUARD', c3, py + 56);
    ctx.textAlign = 'left';
    if (id === 'A') hit.push({ x: c3 - 14, y: py + 18, w: 28, h: 24, c: 'GUARD' });

    // motor chip and time
    const motor = f?.out.MOTOR === 1;
    ctx.font = '600 11px JetBrains Mono, monospace';
    ctx.fillStyle = motor ? COLORS.green : COLORS.dim;
    ctx.fillText(motor ? '● MOTOR ON' : '○ MOTOR OFF', bx0, by + bh + 58);
    if (f) {
      ctx.fillStyle = COLORS.dim;
      ctx.fillText(`t = ${f.t.toFixed(1)} s`, bx0 + 120, by + bh + 58);
    }

    // violation flash
    if (st.flash) {
      const k = (now - st.flash.t0) / 1600;
      if (k >= 1) st.flash = undefined;
      else {
        ctx.save();
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.strokeStyle = COLORS.red;
        ctx.lineWidth = 3;
        rr(x0 + 4, y0 + 4, w - 8, h - 8, 12);
        ctx.stroke();
        ctx.fillStyle = 'rgba(239,68,68,0.08)';
        ctx.fill();
        ctx.font = '700 13px Inter, sans-serif';
        ctx.fillStyle = COLORS.red;
        ctx.textAlign = 'right';
        ctx.fillText(`${st.flash.v.rule} VIOLATED`, x0 + w - pad, y0 + 24);
        ctx.restore();
      }
    }
  }

  function draw(): void {
    raf = 0;
    if (disposed) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    hit = [];
    if (layout === 'single') drawCell('A', 0, 0, w, h);
    else {
      drawCell('A', 0, 0, w, h / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(24, h / 2);
      ctx.lineTo(w - 24, h / 2);
      ctx.stroke();
      drawCell('B', 0, h / 2, w, h / 2);
    }
    if (cells.A.flash || cells.B.flash || cells.A.pickFx.length || cells.B.pickFx.length) schedule();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!interactive || !controlCb) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const target = hit.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (target) controlCb(target.c);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!interactive) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    canvas.style.cursor = hit.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) ? 'pointer' : '';
  });

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  return {
    setLayout(l, lb) {
      layout = l;
      if (lb) labels = lb;
      schedule();
    },
    applyFrame(cell, frame, prev) {
      const st = cells[cell];
      if (frame.out.MOTOR === 1 && prev) st.tread += Math.max(0, frame.t - prev.t) * 0.5;
      if (prev) {
        for (const b of frame.boxes) {
          const pb = prev.boxes.find((p) => p.id === b.id);
          if (b.state === 'picked' && pb && pb.state === 'belt') st.pickFx.push({ t0: performance.now(), x: pb.x });
        }
      }
      st.frame = frame;
      schedule();
    },
    flashViolation(cell, v) {
      cells[cell].flash = { t0: performance.now(), v };
      schedule();
    },
    focus() {},
    onControl(cb) {
      controlCb = cb;
    },
    setInteractive(on) {
      interactive = on;
    },
    resize,
    dispose() {
      disposed = true;
      ro.disconnect();
      cancelAnimationFrame(raf);
      canvas.remove();
    },
  };
}
