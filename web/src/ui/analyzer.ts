// Logic analyzer: canvas waveform view of a trace (or two, stacked A/B) with timer ramps, a box
// space-time lane, event and violation markers, a draggable playhead and a transport bar.

import type { Frame, Trace, TraceEvent, Violation } from '../types';
import { INPUT_NAMES, OUTPUT_NAMES } from '../sim/lang';
import { RULE_CONSEQUENCE, RULE_TITLES } from '../sim/monitors';
import { h } from './dom';
import { ICONS } from './icons';

export type AnalyzerView = 'both' | 'A' | 'B';

interface Lane {
  kind: 'bit' | 'timer' | 'boxes';
  name: string;
  group: 'in' | 'out' | 'coil' | 'timer' | 'boxes';
  pt?: number;
  h: number;
  y: number;
}

export interface AnalyzerSource {
  trace: Trace;
  label: string;
  tone: 'a' | 'b';
  pts?: Record<string, number>;
}

const LW = 118; // label column
const RULER = 18;
const EVENTS = 22;

const SIG_COLOR: Record<string, string> = {
  MOTOR: '#4ade80',
  LAMP_GREEN: '#4ade80',
  LAMP_AMBER: '#fbbf24',
  LAMP_RED: '#f87171',
  ESTOP: '#f87171',
  STOP: '#e5e7eb',
  START: '#86efac',
  RESET: '#93c5fd',
  GUARD_CLOSED: '#fcd34d',
  PE_IN: '#67e8f9',
  PE_END: '#67e8f9',
};
const GROUP_COLOR: Record<string, string> = { in: '#67e8f9', out: '#4ade80', coil: '#fcd34d', timer: '#c4b5fd', boxes: '#c9995b' };
const TONE = { a: '#fb7185', b: '#34d399' };

export interface TransportHandlers {
  onPlayPause(): void;
  onStep(dir: -1 | 1): void;
  onSpeed(s: number): void;
  onSeek(t: number, final: boolean): void;
  onView?(v: AnalyzerView): void;
  onRestart?(): void;
}

export class Analyzer {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private wrap: HTMLDivElement;
  private tip: HTMLDivElement;
  private sources: AnalyzerSource[] = [];
  private view: AnalyzerView = 'both';
  private lanes: Lane[] = [];
  private t = 0;
  private t0 = 0;
  private t1 = 10;
  private live = false;
  private dirtyLayer = true;
  private raf = 0;
  private hoverX: number | null = null;
  private hoverY = 0;
  private scrubbing = false;
  private w = 0;
  private hgt = 0;
  private dpr = 1;
  private playBtn: HTMLButtonElement;
  private timeEl: HTMLSpanElement;
  private speedBtns: HTMLButtonElement[] = [];
  private viewSeg: HTMLDivElement;
  private titleEl: HTMLSpanElement;
  private legendEl: HTMLDivElement;
  private handlers: TransportHandlers;

  constructor(handlers: TransportHandlers) {
    this.handlers = handlers;
    const btn = (svg: string, title: string, on: () => void, cls = 'icon-btn'): HTMLButtonElement => {
      const b = h('button', { class: cls, title, 'aria-label': title });
      b.innerHTML = svg;
      b.addEventListener('click', on);
      return b;
    };
    this.playBtn = btn(ICONS.play, 'Play / pause (space)', () => handlers.onPlayPause(), 'icon-btn play');
    this.timeEl = h('span', { class: 'tp-time' }, '0.0 s');
    const speeds = h('div', { class: 'seg sm' });
    for (const s of [0.5, 1, 2, 4]) {
      const b = h('button', { 'data-v': s }, `${s}×`);
      b.addEventListener('click', () => handlers.onSpeed(s));
      this.speedBtns.push(b);
      speeds.append(b);
    }
    this.viewSeg = h('div', { class: 'seg sm view-seg' });
    for (const [v, label] of [
      ['both', 'A + B'],
      ['A', 'Baseline'],
      ['B', 'Repaired'],
    ] as const) {
      const b = h('button', { 'data-v': v }, label);
      b.addEventListener('click', () => {
        this.setView(v);
        handlers.onView?.(v);
      });
      this.viewSeg.append(b);
    }
    this.titleEl = h('span', { class: 'tp-title' }, 'Logic analyzer');
    this.legendEl = h('div', { class: 'tp-legend' });
    const bar = h(
      'div',
      { class: 'transport' },
      h('div', { class: 'tp-left' }, btn(ICONS.restart, 'Restart', () => handlers.onRestart?.()), btn(ICONS.stepBack, 'Step back (←)', () => handlers.onStep(-1)), this.playBtn, btn(ICONS.stepFwd, 'Step forward (→)', () => handlers.onStep(1)), this.timeEl, speeds),
      h('div', { class: 'tp-mid' }, this.titleEl, this.legendEl),
      h('div', { class: 'tp-right' }, this.viewSeg),
    );
    this.canvas = h('canvas', { class: 'analyzer-canvas' });
    this.ctx = this.canvas.getContext('2d')!;
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d')!;
    this.tip = h('div', { class: 'an-tip' });
    this.wrap = h('div', { class: 'analyzer-wrap' }, this.canvas, this.tip);
    this.el = h('div', { class: 'analyzer' }, bar, this.wrap);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.wrap);
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverX = null;
      this.tip.classList.remove('show');
      this.draw();
    });
  }

  setTitle(title: string, legend: { label: string; color: string }[] = []): void {
    this.titleEl.textContent = title;
    this.legendEl.replaceChildren(...legend.map((l) => h('span', { class: 'lg' }, h('i', { style: `background:${l.color}` }), l.label)));
  }

  setPlaying(p: boolean): void {
    this.playBtn.innerHTML = p ? ICONS.pause : ICONS.play;
    this.playBtn.classList.toggle('on', p);
  }

  setSpeed(s: number): void {
    for (const b of this.speedBtns) b.classList.toggle('on', Number(b.dataset.v) === s);
  }

  setView(v: AnalyzerView): void {
    this.view = v;
    for (const b of Array.from(this.viewSeg.children) as HTMLElement[]) b.classList.toggle('on', b.dataset.v === v);
    this.relayout();
  }

  showViewSwitch(on: boolean): void {
    this.viewSeg.style.display = on ? '' : 'none';
  }

  /** Recorded traces (one, or baseline + repaired). */
  setSources(sources: AnalyzerSource[]): void {
    this.sources = sources;
    this.live = false;
    const dur = Math.max(1, ...sources.map((s) => s.trace.frames.length * s.trace.dt));
    this.t0 = 0;
    this.t1 = dur;
    this.showViewSwitch(sources.length > 1);
    this.relayout();
  }

  /** Live trace (Play mode): a rolling window that follows the newest frame. */
  setLive(trace: Trace, pts: Record<string, number>, windowS = 24): void {
    const firstLive = !this.live || this.sources.length !== 1 || this.sources[0].trace !== trace;
    this.live = true;
    this.sources = [{ trace, label: 'live', tone: 'b', pts }];
    const last = trace.frames.length ? trace.frames[trace.frames.length - 1].t + trace.dt : 0;
    this.t1 = Math.max(windowS, last);
    this.t0 = this.t1 - windowS;
    this.t = Math.max(0, last - trace.dt);
    this.timeEl.textContent = `${this.t.toFixed(1)} s`;
    this.showViewSwitch(false);
    if (firstLive) this.relayout();
    else {
      this.dirtyLayer = true;
      this.relayoutIfLanesChanged();
      this.schedule();
    }
  }

  setTime(t: number): void {
    this.t = t;
    const s = this.sources[0];
    const dur = s ? s.trace.frames.length * s.trace.dt : 0;
    this.timeEl.textContent = this.live ? `${t.toFixed(1)} s` : `${t.toFixed(1)} / ${dur.toFixed(1)} s`;
    this.schedule();
  }

  private laneKey = '';
  private relayoutIfLanesChanged(): void {
    const key = this.computeLaneNames().map((l) => l.name).join(',');
    if (key !== this.laneKey) this.relayout();
  }

  private visibleSources(): AnalyzerSource[] {
    if (this.sources.length < 2 || this.view === 'both') return this.sources;
    return this.sources.filter((s) => (this.view === 'A' ? s.tone === 'a' : s.tone === 'b'));
  }

  private computeLaneNames(): Omit<Lane, 'h' | 'y'>[] {
    const srcs = this.visibleSources();
    const lanes: Omit<Lane, 'h' | 'y'>[] = [];
    const twin = srcs.length > 1;
    const changes = (name: string, field: 'in' | 'out' | 'coil'): boolean =>
      srcs.some((s) => s.trace.frames.some((f) => (f[field][name] ?? 0) !== (s.trace.frames[0]?.[field][name] ?? 0)));
    for (const n of INPUT_NAMES) if (!twin || changes(n, 'in')) lanes.push({ kind: 'bit', name: n, group: 'in' });
    for (const n of OUTPUT_NAMES) lanes.push({ kind: 'bit', name: n, group: 'out' });
    const coils: string[] = [];
    const timers: string[] = [];
    for (const s of srcs) {
      const f = s.trace.frames[s.trace.frames.length - 1] ?? s.trace.frames[0];
      if (!f) continue;
      for (const c of Object.keys(f.coil)) if (!coils.includes(c)) coils.push(c);
      for (const t of Object.keys(f.timer)) if (!timers.includes(t)) timers.push(t);
    }
    if (!twin) {
      for (const c of coils) lanes.push({ kind: 'bit', name: c, group: 'coil' });
      for (const t of timers) lanes.push({ kind: 'timer', name: t, group: 'timer' });
    }
    lanes.push({ kind: 'boxes', name: 'boxes', group: 'boxes' });
    return lanes;
  }

  private relayout(): void {
    const names = this.computeLaneNames();
    this.laneKey = names.map((l) => l.name).join(',');
    const twin = this.visibleSources().length > 1;
    const avail = this.hgt - RULER - EVENTS - 6;
    const nBits = names.filter((l) => l.kind !== 'boxes').length;
    const boxesH = Math.max(34, Math.min(70, avail * 0.2)) * (twin ? 1.4 : 1);
    let laneH = Math.floor((avail - boxesH) / Math.max(1, nBits));
    laneH = Math.max(twin ? 16 : 11, Math.min(twin ? 30 : 22, laneH));
    let y = RULER + EVENTS;
    this.lanes = names.map((l) => {
      const hh = l.kind === 'boxes' ? Math.max(boxesH, Math.min(this.hgt - y - 4, boxesH * 2.4)) : laneH;
      const lane = { ...l, h: hh, y };
      y += hh;
      return lane;
    });
    this.dirtyLayer = true;
    this.schedule();
  }

  private resize(): void {
    const r = this.wrap.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(10, r.width);
    this.hgt = Math.max(10, r.height);
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.hgt * this.dpr);
    }
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.hgt}px`;
    this.relayout();
  }

  private tx(t: number): number {
    return LW + ((t - this.t0) / (this.t1 - this.t0)) * (this.w - LW - 10);
  }
  private xt(x: number): number {
    return this.t0 + ((x - LW) / (this.w - LW - 10)) * (this.t1 - this.t0);
  }

  private schedule(): void {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.draw());
  }

  private drawLayer(): void {
    const c = this.lctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.hgt);
    const srcs = this.visibleSources();
    const twin = srcs.length > 1;
    // ruler
    c.font = '500 9.5px JetBrains Mono, monospace';
    c.textBaseline = 'middle';
    const span = this.t1 - this.t0;
    const stepT = span > 40 ? 5 : span > 16 ? 2 : 1;
    for (let t = Math.ceil(this.t0 / stepT) * stepT; t <= this.t1 + 1e-9; t += stepT) {
      const x = this.tx(t);
      c.strokeStyle = 'rgba(255,255,255,0.045)';
      c.beginPath();
      c.moveTo(x + 0.5, RULER);
      c.lineTo(x + 0.5, this.hgt);
      c.stroke();
      c.fillStyle = '#5d6676';
      c.textAlign = 'center';
      c.fillText(`${t}s`, x, RULER / 2 + 1);
    }
    c.textAlign = 'left';
    // lanes
    this.lanes.forEach((lane, i) => {
      if (i % 2 === 0) {
        c.fillStyle = 'rgba(255,255,255,0.018)';
        c.fillRect(0, lane.y, this.w, lane.h);
      }
      c.fillStyle = lane.group === 'boxes' ? '#9aa3b2' : '#8b94a5';
      c.font = `500 ${lane.h < 14 ? 9 : 10}px JetBrains Mono, monospace`;
      const label = lane.kind === 'boxes' ? 'BOX x(t)' : lane.name;
      c.fillStyle = GROUP_COLOR[lane.group];
      c.globalAlpha = 0.85;
      c.fillRect(8, lane.y + lane.h / 2 - 3, 3, 6);
      c.globalAlpha = 1;
      c.fillStyle = '#aab3c2';
      c.fillText(label, 16, lane.y + lane.h / 2 + 0.5);
      if (lane.kind === 'boxes') this.drawBoxes(c, lane, srcs);
      else
        srcs.forEach((s, si) => {
          const sub = twin ? lane.h / 2 : lane.h;
          const y0 = lane.y + (twin ? si * sub : 0);
          const color = twin ? TONE[s.tone] : SIG_COLOR[lane.name] ?? GROUP_COLOR[lane.group];
          if (lane.kind === 'timer') this.drawTimer(c, s, lane.name, y0, sub, s.pts?.[lane.name], color);
          else this.drawBit(c, s.trace.frames, lane, y0, sub, color);
        });
      if (twin && lane.kind === 'bit') {
        c.font = '600 8px JetBrains Mono, monospace';
        c.fillStyle = TONE.a;
        c.fillText('A', LW - 14, lane.y + lane.h * 0.25 + 0.5);
        c.fillStyle = TONE.b;
        c.fillText('B', LW - 14, lane.y + lane.h * 0.75 + 0.5);
      }
    });
    // label column divider
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.beginPath();
    c.moveTo(LW - 4.5, RULER);
    c.lineTo(LW - 4.5, this.hgt);
    c.stroke();
    // events + violations
    this.drawMarkers(c, srcs);
  }

  private drawBit(c: CanvasRenderingContext2D, frames: Frame[], lane: Lane, y0: number, hh: number, color: string): void {
    const field = lane.group === 'in' ? 'in' : lane.group === 'out' ? 'out' : 'coil';
    const top = y0 + Math.max(2, hh * 0.18);
    const bot = y0 + hh - Math.max(2, hh * 0.18);
    const dt = frames.length > 1 ? frames[1].t - frames[0].t : 0.1;
    c.lineWidth = 1.25;
    let prevV = -1;
    let runStart = 0;
    const flush = (v: number, t0: number, t1: number): void => {
      const x0 = Math.max(LW, this.tx(t0));
      const x1 = Math.min(this.w - 10, this.tx(t1));
      if (x1 <= x0) return;
      if (v) {
        c.fillStyle = color + '2e';
        c.fillRect(x0, top, x1 - x0, bot - top);
        c.strokeStyle = color;
        c.beginPath();
        c.moveTo(x0, top + 0.5);
        c.lineTo(x1, top + 0.5);
        c.stroke();
      } else {
        c.strokeStyle = color + '66';
        c.beginPath();
        c.moveTo(x0, bot - 0.5);
        c.lineTo(x1, bot - 0.5);
        c.stroke();
      }
    };
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.t + dt < this.t0 || f.t > this.t1) continue;
      const v = (f as unknown as Record<string, Record<string, number>>)[field][lane.name] ?? 0;
      if (v !== prevV) {
        if (prevV !== -1) {
          flush(prevV, runStart, f.t);
          const x = this.tx(f.t);
          c.strokeStyle = color;
          c.beginPath();
          c.moveTo(x, top);
          c.lineTo(x, bot);
          c.stroke();
        }
        prevV = v;
        runStart = f.t;
      }
    }
    if (prevV !== -1 && frames.length) flush(prevV, runStart, frames[frames.length - 1].t + dt);
  }

  private drawTimer(c: CanvasRenderingContext2D, s: AnalyzerSource, name: string, y0: number, hh: number, pt: number | undefined, color: string): void {
    const frames = s.trace.frames;
    const max = pt ?? Math.max(0.1, ...frames.map((f) => f.timer[name] ?? 0));
    const top = y0 + 2;
    const bot = y0 + hh - 2;
    c.beginPath();
    c.moveTo(LW, bot);
    for (const f of frames) {
      if (f.t < this.t0 - 0.2 || f.t > this.t1) continue;
      const v = Math.min(1, (f.timer[name] ?? 0) / max);
      c.lineTo(this.tx(f.t), bot - v * (bot - top));
    }
    c.strokeStyle = color;
    c.lineWidth = 1.25;
    c.stroke();
    // q region
    if (pt !== undefined) {
      c.fillStyle = color + '40';
      for (const f of frames) if ((f.timer[name] ?? 0) >= pt - 1e-9 && f.t >= this.t0 && f.t <= this.t1) c.fillRect(this.tx(f.t), top, Math.max(1, this.tx(f.t + s.trace.dt) - this.tx(f.t)), bot - top);
    }
  }

  private drawBoxes(c: CanvasRenderingContext2D, lane: Lane, srcs: AnalyzerSource[]): void {
    const twin = srcs.length > 1;
    srcs.forEach((s, si) => {
      const sub = twin ? lane.h / 2 : lane.h;
      const y0 = lane.y + si * sub;
      const top = y0 + 3;
      const bot = y0 + sub - 3;
      const Y = (x: number): number => bot - (x / 4.0) * (bot - top);
      // reference lines: PE_IN, PE_END, drop
      c.setLineDash([2, 3]);
      c.lineWidth = 1;
      for (const [x, col] of [
        [0.3, 'rgba(103,232,249,0.25)'],
        [3.7, 'rgba(103,232,249,0.25)'],
        [3.9, 'rgba(239,68,68,0.35)'],
      ] as const) {
        c.strokeStyle = col;
        c.beginPath();
        c.moveTo(LW, Y(x) + 0.5);
        c.lineTo(this.w - 10, Y(x) + 0.5);
        c.stroke();
      }
      c.setLineDash([]);
      if (twin) {
        c.font = '600 8px JetBrains Mono, monospace';
        c.fillStyle = TONE[s.tone];
        c.fillText(s.tone.toUpperCase(), LW - 14, y0 + sub / 2);
      }
      const tracks = new Map<number, { t: number; x: number; state: string }[]>();
      for (const f of s.trace.frames) {
        if (f.t < this.t0 - 1 || f.t > this.t1) continue;
        for (const b of f.boxes) {
          let tr = tracks.get(b.id);
          if (!tr) tracks.set(b.id, (tr = []));
          const last = tr[tr.length - 1];
          if (last && last.state !== 'belt') continue;
          tr.push({ t: f.t, x: b.x, state: b.state });
        }
      }
      const color = twin ? TONE[s.tone] : '#d6a867';
      for (const tr of tracks.values()) {
        c.strokeStyle = color;
        c.lineWidth = 1.6;
        c.beginPath();
        tr.forEach((p, i) => (i ? c.lineTo(this.tx(p.t), Y(p.x)) : c.moveTo(this.tx(p.t), Y(p.x))));
        c.stroke();
        const end = tr[tr.length - 1];
        if (end.state === 'picked') {
          c.fillStyle = '#4ade80';
          c.beginPath();
          c.arc(this.tx(end.t), Y(Math.min(end.x, 4)), 3, 0, Math.PI * 2);
          c.fill();
        } else if (end.state === 'dropped') {
          const x = this.tx(end.t);
          const y = Y(Math.min(end.x, 4));
          c.strokeStyle = '#ef4444';
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(x - 4, y - 4);
          c.lineTo(x + 4, y + 4);
          c.moveTo(x + 4, y - 4);
          c.lineTo(x - 4, y + 4);
          c.stroke();
        }
      }
    });
  }

  private markerHits: { x: number; y: number; text: string; kind: 'v' | 'e' }[] = [];

  private drawMarkers(c: CanvasRenderingContext2D, srcs: AnalyzerSource[]): void {
    this.markerHits = [];
    const y = RULER + EVENTS / 2;
    const ev: (TraceEvent & { tone?: string })[] = [];
    const seen = new Set<string>();
    for (const s of srcs)
      for (const e of s.trace.events) {
        if (e.kind === 'release' || e.kind === 'drop') continue;
        const k = `${e.t}|${e.label}`;
        if (seen.has(k)) continue;
        seen.add(k);
        ev.push(e);
      }
    c.font = '500 9.5px Inter, sans-serif';
    let lastEnd = -Infinity;
    for (const e of ev) {
      if (e.t < this.t0 || e.t > this.t1) continue;
      const x = this.tx(e.t);
      c.fillStyle = '#22d3ee';
      c.beginPath();
      c.moveTo(x, y - 4);
      c.lineTo(x + 4, y);
      c.lineTo(x, y + 4);
      c.lineTo(x - 4, y);
      c.closePath();
      c.fill();
      c.strokeStyle = 'rgba(34,211,238,0.12)';
      c.beginPath();
      c.moveTo(x + 0.5, y + 5);
      c.lineTo(x + 0.5, this.hgt);
      c.stroke();
      const label = e.label;
      const w = c.measureText(label).width;
      if (x + 7 > lastEnd + 6 && x + 7 + w < this.w - 6) {
        c.fillStyle = '#8fdcea';
        c.fillText(label, x + 7, y + 0.5);
        lastEnd = x + 7 + w;
      }
      this.markerHits.push({ x, y, text: `t=${e.t.toFixed(1)}s · ${label}`, kind: 'e' });
    }
    // violations
    srcs.forEach((s, si) => {
      for (const v of s.trace.violations) {
        if (v.t < this.t0 || v.t > this.t1) continue;
        const x = this.tx(v.t);
        c.strokeStyle = 'rgba(239,68,68,0.55)';
        c.setLineDash([3, 3]);
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x + 0.5, RULER + EVENTS);
        c.lineTo(x + 0.5, this.hgt);
        c.stroke();
        c.setLineDash([]);
        const yy = RULER + 3 + (srcs.length > 1 ? si * 7 : 0);
        c.fillStyle = '#ef4444';
        c.beginPath();
        c.moveTo(x - 5, yy);
        c.lineTo(x + 5, yy);
        c.lineTo(x, yy + 7);
        c.closePath();
        c.fill();
        const who = srcs.length > 1 ? (s.tone === 'a' ? 'Baseline' : 'Repaired') + ' · ' : '';
        this.markerHits.push({ x, y: yy + 3, text: `${who}${v.rule} ${RULE_TITLES[v.rule] ?? ''} violated at t=${v.t.toFixed(1)}s — ${v.message}`, kind: 'v' });
      }
    });
  }

  private draw(): void {
    this.raf = 0;
    if (this.dirtyLayer) {
      this.drawLayer();
      this.dirtyLayer = false;
    }
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.layer, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // playhead
    if (this.sources.length && this.t >= this.t0 && this.t <= this.t1) {
      const x = this.tx(this.t);
      c.fillStyle = 'rgba(245,197,24,0.06)';
      c.fillRect(LW, RULER, Math.max(0, x - LW), this.hgt - RULER);
      c.strokeStyle = '#f5c518';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x, RULER - 2);
      c.lineTo(x, this.hgt);
      c.stroke();
      c.fillStyle = '#f5c518';
      c.beginPath();
      c.moveTo(x - 5, 2);
      c.lineTo(x + 5, 2);
      c.lineTo(x + 5, RULER - 6);
      c.lineTo(x, RULER - 1);
      c.lineTo(x - 5, RULER - 6);
      c.closePath();
      c.fill();
      // values at the playhead in the label column
      this.drawValues(c);
    }
    if (this.hoverX !== null && this.hoverX > LW && !this.scrubbing) {
      c.strokeStyle = 'rgba(255,255,255,0.25)';
      c.lineWidth = 1;
      c.setLineDash([2, 3]);
      c.beginPath();
      c.moveTo(this.hoverX + 0.5, RULER);
      c.lineTo(this.hoverX + 0.5, this.hgt);
      c.stroke();
      c.setLineDash([]);
    }
  }

  private drawValues(c: CanvasRenderingContext2D): void {
    const srcs = this.visibleSources();
    const twin = srcs.length > 1;
    for (const lane of this.lanes) {
      if (lane.kind === 'boxes') continue;
      srcs.forEach((s, si) => {
        const k = Math.min(s.trace.frames.length - 1, Math.max(0, Math.floor((this.t + 1e-6) / s.trace.dt)));
        const f = s.trace.frames[k];
        if (!f) return;
        let v: number;
        if (lane.kind === 'timer') v = (f.timer[lane.name] ?? 0) > 0 ? 1 : 0;
        else v = (lane.group === 'in' ? f.in : lane.group === 'out' ? f.out : f.coil)[lane.name] ?? 0;
        const sub = twin ? lane.h / 2 : lane.h;
        const yy = lane.y + (twin ? si * sub + sub / 2 : lane.h / 2);
        const color = twin ? TONE[s.tone] : SIG_COLOR[lane.name] ?? GROUP_COLOR[lane.group];
        c.beginPath();
        c.arc(LW - (twin ? 24 : 14), yy, 3, 0, Math.PI * 2);
        c.fillStyle = v ? color : 'rgba(255,255,255,0.1)';
        c.fill();
      });
    }
  }

  private onDown(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < LW || !this.sources.length || this.live) return;
    this.scrubbing = true;
    this.canvas.setPointerCapture(e.pointerId);
    this.handlers.onSeek(this.clampT(this.xt(x)), false);
  }
  private onMove(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    this.hoverX = x;
    this.hoverY = y;
    if (this.scrubbing) {
      this.handlers.onSeek(this.clampT(this.xt(x)), false);
      return;
    }
    const hit = this.markerHits.find((m) => Math.abs(m.x - x) < 7 && Math.abs(m.y - y) < 9);
    if (hit) {
      this.tip.textContent = hit.text;
      this.tip.className = `an-tip show ${hit.kind === 'v' ? 'bad' : ''}`;
      const tw = Math.min(360, this.w - 20);
      this.tip.style.maxWidth = `${tw}px`;
      this.tip.style.left = `${Math.min(Math.max(8, x - 20), this.w - tw - 8)}px`;
      this.tip.style.top = `${y + 14}px`;
    } else this.tip.classList.remove('show');
    this.canvas.style.cursor = x > LW && !this.live ? 'ew-resize' : '';
    this.schedule();
  }
  private onUp(e: PointerEvent): void {
    if (!this.scrubbing) return;
    this.scrubbing = false;
    const r = this.canvas.getBoundingClientRect();
    this.handlers.onSeek(this.clampT(this.xt(e.clientX - r.left)), true);
  }
  private clampT(t: number): number {
    return Math.max(this.t0, Math.min(this.t1 - 0.05, t));
  }
}

/** Short human line for a violation, used in toasts. */
export function violationLine(v: Violation): string {
  const what = RULE_CONSEQUENCE[v.rule];
  return `${v.rule === 'DROP' ? 'Box dropped' : `${v.rule} violated`} at t=${v.t.toFixed(1)}s${what ? ` — ${what}` : ''}`;
}
