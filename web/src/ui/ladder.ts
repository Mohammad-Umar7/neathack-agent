// Ladder-logic view: renders rungs as real ladder diagrams in SVG (contacts in series for AND,
// parallel branches for OR, NC contacts for NOT, |P| for RISE, TON as a function block), with a
// version diff and live power-flow highlighting driven by simulator frames.

import type { Expr, Frame, Rung } from '../types';
import { evalExpr, type MemoryView } from '../sim/plc';
import { formatPt, isInput, isOutput, rungEqual, rungToText } from '../sim/lang';
import { h, svgEl } from './dom';
import { ICONS } from './icons';

export interface LadderMemory extends MemoryView {
  et(name: string): number;
}

/** Memory view built from a recorded frame (and the one before it, for RISE). */
export function frameMemory(f: Frame, prev: Frame | undefined, pts: Record<string, number>): LadderMemory {
  const val = (fr: Frame, n: string): 0 | 1 => (fr.in[n] ?? fr.out[n] ?? fr.coil[n] ?? 0) as 0 | 1;
  return {
    get: (n) => val(f, n),
    prev: (n) => (prev ? val(prev, n) : n === 'GUARD_CLOSED' ? 1 : 0),
    timerQ: (n) => (f.timer[n] ?? 0) >= (pts[n] ?? Infinity) - 1e-9,
    et: (n) => f.timer[n] ?? 0,
  };
}

export function presets(rungs: Rung[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const r of rungs) if (r.kind === 'ton') o[r.target] = r.pt ?? 0;
  return o;
}

// ---------- expression -> network ----------

interface Lit {
  kind: 'no' | 'nc' | 'p' | 'pn' | 'true' | 'false';
  label: string;
  cls: string; // label colour class
  expr: Expr;
  neg: boolean;
}
type Net = { k: 'lit'; lit: Lit } | { k: 'ser'; items: Net[] } | { k: 'par'; items: Net[] };

function nameClass(n: string): string {
  if (isInput(n)) return 'in';
  if (isOutput(n)) return 'out';
  return 'cl'; // internal coil (not 'coil': that class styles the coil symbol)
}

function toNet(e: Expr, neg = false): Net {
  switch (e.op) {
    case 'var':
      return { k: 'lit', lit: { kind: neg ? 'nc' : 'no', label: e.name, cls: nameClass(e.name), expr: e, neg } };
    case 'timer':
      return { k: 'lit', lit: { kind: neg ? 'nc' : 'no', label: `${e.name}.Q`, cls: 'tmr', expr: e, neg } };
    case 'rise':
      return { k: 'lit', lit: { kind: neg ? 'pn' : 'p', label: e.name, cls: nameClass(e.name), expr: e, neg } };
    case 'const': {
      const v = e.value !== neg;
      return { k: 'lit', lit: { kind: v ? 'true' : 'false', label: v ? '' : 'FALSE', cls: 'k', expr: e, neg: false } };
    }
    case 'not':
      return toNet(e.arg, !neg);
    case 'and':
    case 'or': {
      const items = e.args.map((a) => toNet(a, neg));
      const series = (e.op === 'and') !== neg; // De Morgan under NOT
      return series ? group('ser', items) : group('par', items);
    }
  }
}

function group(k: 'ser' | 'par', items: Net[]): Net {
  const flat: Net[] = [];
  for (const it of items) if (it.k === k) flat.push(...it.items);
  else flat.push(it);
  return flat.length === 1 ? flat[0] : { k, items: flat };
}

const sizeCache = new WeakMap<Net, { cols: number; rows: number }>();
function size(n: Net): { cols: number; rows: number } {
  const c = sizeCache.get(n);
  if (c) return c;
  let s: { cols: number; rows: number };
  if (n.k === 'lit') s = { cols: 1, rows: 1 };
  else if (n.k === 'ser') {
    const ss = n.items.map(size);
    s = { cols: ss.reduce((a, b) => a + b.cols, 0), rows: Math.max(...ss.map((x) => x.rows)) };
  } else {
    const ss = n.items.map(size);
    s = { cols: Math.max(...ss.map((x) => x.cols)), rows: ss.reduce((a, b) => a + b.rows, 0) };
  }
  sizeCache.set(n, s);
  return s;
}

// ---------- SVG drawing ----------

const CW = 74; // cell width
const RH = 50; // row height
const RAIL = 12;
const COIL_W = 92;
const TON_W = 132;
const wireY = (rowTop: number): number => rowTop + 32;

type Upd = (pin: boolean, m: LadderMemory | null) => boolean;

function live(el: Element, on: boolean): void {
  el.classList.toggle('live', on);
}

function line(g: SVGGElement, x1: number, y1: number, x2: number, y2: number, cls = 'w'): SVGLineElement {
  const l = svgEl('line', { x1, y1, x2, y2, class: cls });
  g.appendChild(l);
  return l;
}

function text(g: SVGGElement, x: number, y: number, s: string, cls: string, anchor = 'middle'): SVGTextElement {
  const t = svgEl('text', { x, y, class: cls, 'text-anchor': anchor });
  t.textContent = s;
  g.appendChild(t);
  return t;
}

function drawLit(g: SVGGElement, lit: Lit, x: number, rowTop: number): Upd {
  const wy = wireY(rowTop);
  const cx = x + CW / 2;
  if (lit.kind === 'true') {
    const w = line(g, x, wy, x + CW, wy);
    return (pin) => {
      live(w, pin);
      return pin;
    };
  }
  const grp = svgEl('g', { class: `contact ${lit.kind}` });
  g.appendChild(grp);
  const wl = line(grp, x, wy, cx - 8, wy);
  const wr = line(grp, cx + 8, wy, x + CW, wy);
  line(grp, cx - 8, wy - 10, cx - 8, wy + 10, 'bar');
  line(grp, cx + 8, wy - 10, cx + 8, wy + 10, 'bar');
  if (lit.kind === 'nc' || lit.kind === 'pn') line(grp, cx - 6, wy + 9, cx + 6, wy - 9, 'slash');
  if (lit.kind === 'p' || lit.kind === 'pn') text(grp, cx, wy + 3.5, 'P', 'pmark');
  const lbl = lit.label;
  text(grp, cx, wy - 16, lbl, `lbl ${lit.cls}${lbl.length > 10 ? ' sm' : ''}`);
  const title = svgEl('title');
  title.textContent =
    lit.kind === 'nc' ? `NOT ${lbl} (normally closed)` : lit.kind === 'p' ? `RISE(${lbl}) (rising edge)` : lit.kind === 'pn' ? `NOT RISE(${lbl})` : lit.kind === 'false' ? 'FALSE' : `${lbl} (normally open)`;
  grp.appendChild(title);
  return (pin, m) => {
    if (!m) {
      grp.classList.remove('closed');
      live(wl, false);
      live(wr, false);
      return false;
    }
    let c = lit.kind === 'false' ? false : evalExpr(lit.expr, m);
    if (lit.neg) c = !c;
    const out = pin && c;
    grp.classList.toggle('closed', c);
    live(wl, pin);
    live(wr, out);
    return out;
  };
}

function drawNet(g: SVGGElement, n: Net, x: number, rowTop: number, cols: number): Upd {
  const nat = size(n).cols;
  let upd: Upd;
  if (n.k === 'lit') upd = drawLit(g, n.lit, x, rowTop);
  else if (n.k === 'ser') {
    let cx = x;
    const ups: Upd[] = [];
    for (const it of n.items) {
      const w = size(it).cols;
      ups.push(drawNet(g, it, cx, rowTop, w));
      cx += w * CW;
    }
    upd = (pin, m) => ups.reduce((p, u) => u(p, m), pin);
  } else {
    let top = rowTop;
    const ups: Upd[] = [];
    const wys: number[] = [];
    for (const it of n.items) {
      ups.push(drawNet(g, it, x, top, nat));
      wys.push(wireY(top));
      top += size(it).rows * RH;
    }
    const left = line(g, x, wys[0], x, wys[wys.length - 1]);
    const right = line(g, x + nat * CW, wys[0], x + nat * CW, wys[wys.length - 1]);
    upd = (pin, m) => {
      let out = false;
      for (const u of ups) out = u(pin, m) || out;
      live(left, !!m && pin);
      live(right, out);
      return out;
    };
  }
  if (cols > nat) {
    const fill = line(g, x + nat * CW, wireY(rowTop), x + cols * CW, wireY(rowTop));
    const inner = upd;
    upd = (pin, m) => {
      const o = inner(pin, m);
      live(fill, o);
      return o;
    };
  }
  return upd;
}

interface RenderedRung {
  el: SVGSVGElement;
  update: (m: LadderMemory | null) => void;
}

function renderRungSvg(r: Rung, minWidth: number): RenderedRung {
  const net = toNet(r.expr);
  const sz = size(net);
  const outW = r.kind === 'ton' ? TON_W : COIL_W;
  const netX = RAIL + 10;
  const need = netX + sz.cols * CW + 18 + outW + RAIL + 8;
  const W = Math.max(minWidth, need);
  const H = Math.max(1, sz.rows) * RH + 10;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'rung-svg', width: W, height: H });
  svg.style.maxWidth = '100%';
  svg.style.height = 'auto';
  const g = svgEl('g');
  svg.appendChild(g);
  const rail1 = line(g, RAIL, 4, RAIL, H - 4, 'rail');
  line(g, W - RAIL, 4, W - RAIL, H - 4, 'rail');
  const wy = wireY(0);
  const stub = line(g, RAIL, wy, netX, wy);
  const netUpd = drawNet(g, net, netX, 0, sz.cols);
  const netEnd = netX + sz.cols * CW;
  const outX = W - RAIL - 8 - outW;
  const toOut = line(g, netEnd, wy, outX, wy);
  let outUpd: (p: boolean, m: LadderMemory | null) => void;

  if (r.kind === 'ton') {
    const fb = svgEl('g', { class: 'fb' });
    g.appendChild(fb);
    const bx = outX + 8;
    const bw = outW - 16;
    fb.appendChild(svgEl('rect', { x: bx, y: wy - 18, width: bw, height: 40, rx: 5, class: 'fb-box' }));
    text(fb, bx + bw / 2, wy - 23, r.target, 'lbl tmr');
    text(fb, bx + 7, wy - 5, 'TON', 'fb-title', 'start');
    text(fb, bx + bw - 7, wy - 5, `PT ${formatPt(r.pt ?? 0)}s`, 'fb-pt', 'end');
    fb.appendChild(svgEl('rect', { x: bx + 7, y: wy + 6, width: bw - 14, height: 6, rx: 3, class: 'fb-track' }));
    const bar = svgEl('rect', { x: bx + 7, y: wy + 6, width: 0, height: 6, rx: 3, class: 'fb-et' });
    fb.appendChild(bar);
    const etText = text(fb, bx + bw - 7, wy + 4, '', 'fb-etv', 'end');
    const pinIn = line(fb, outX, wy, bx, wy);
    const q = svgEl('circle', { cx: bx + bw + 4, cy: wy, r: 3.5, class: 'fb-q' });
    fb.appendChild(q);
    line(g, bx + bw + 8, wy, W - RAIL, wy, 'w dim');
    const title = svgEl('title');
    title.textContent = `On-delay timer ${r.target}: Q turns on after the input has been on for ${formatPt(r.pt ?? 0)} s`;
    fb.appendChild(title);
    outUpd = (p, m) => {
      live(toOut, !!m && p);
      live(pinIn, !!m && p);
      const et = m ? m.et(r.target) : 0;
      const pt = r.pt ?? 1;
      bar.setAttribute('width', String(Math.max(0, Math.min(1, et / pt)) * (bw - 14)));
      etText.textContent = m && et > 0 ? `${et.toFixed(1)}s` : '';
      const qOn = !!m && m.timerQ(r.target);
      fb.classList.toggle('q', qOn);
      fb.classList.toggle('running', !!m && et > 0 && !qOn);
    };
  } else {
    const cg = svgEl('g', { class: `coilg ${r.kind}` });
    g.appendChild(cg);
    const cx = outX + outW / 2;
    line(cg, outX, wy, cx - 12, wy, 'w');
    cg.appendChild(svgEl('circle', { cx, cy: wy, r: 10, class: 'coil-fill' }));
    cg.appendChild(svgEl('path', { d: `M ${cx - 6} ${wy - 12} A 14 14 0 0 0 ${cx - 6} ${wy + 12}`, class: 'coil' }));
    cg.appendChild(svgEl('path', { d: `M ${cx + 6} ${wy - 12} A 14 14 0 0 1 ${cx + 6} ${wy + 12}`, class: 'coil' }));
    if (r.kind !== 'assign') text(cg, cx, wy + 4, r.kind === 'set' ? 'S' : 'R', 'coil-mark');
    text(cg, cx, wy - 18, r.target, `lbl ${nameClass(r.target)}${r.target.length > 10 ? ' sm' : ''}`);
    line(cg, cx + 12, wy, W - RAIL, wy, 'w dim');
    const title = svgEl('title');
    title.textContent = r.kind === 'assign' ? `${r.target} := rung condition` : r.kind === 'set' ? `Set (latch) ${r.target} when the rung is true` : `Reset (unlatch) ${r.target} when the rung is true`;
    cg.appendChild(title);
    outUpd = (p, m) => {
      live(toOut, !!m && p);
      cg.classList.toggle('energized', !!m && p);
      cg.classList.toggle('on', !!m && m.get(r.target) === 1);
    };
  }

  return {
    el: svg,
    update: (m) => {
      live(rail1, !!m);
      live(stub, !!m);
      const p = netUpd(!!m, m);
      outUpd(p, m);
    },
  };
}

// ---------- the panel ----------

export interface LadderOptions {
  base?: Rung[] | null; // previous version: changed / added / deleted rungs are highlighted
  editable?: boolean;
  errors?: Record<string, string>;
  onEdit?: (id: string, text: string) => void;
  onDelete?: (id: string) => void;
  onAdd?: () => void;
  highlight?: string[]; // rung ids to pulse (e.g. the rungs a patch touched)
}

interface Row {
  rung: Rung;
  status: 'same' | 'changed' | 'added' | 'deleted';
  old?: Rung;
}

export class LadderView {
  readonly el: HTMLDivElement;
  private list: HTMLDivElement;
  private rendered: { id: string; r: RenderedRung }[] = [];
  private program: Rung[] = [];
  private opts: LadderOptions = {};
  private lastWidth = 0;
  private mem: LadderMemory | null = null;

  constructor() {
    this.list = h('div', { class: 'ladder-list' });
    this.el = h('div', { class: 'ladder' }, this.list);
    const ro = new ResizeObserver(() => {
      const w = this.list.clientWidth;
      if (Math.abs(w - this.lastWidth) > 24 && this.program.length) this.render(this.program, this.opts);
    });
    ro.observe(this.list);
  }

  render(program: Rung[], opts: LadderOptions = {}): void {
    this.program = program;
    this.opts = opts;
    const width = this.list.clientWidth || 440;
    this.lastWidth = width;
    const base = opts.base ?? null;
    const rows = diffRows(program, base);
    const scrollTop = this.list.scrollTop;
    this.list.replaceChildren();
    this.rendered = [];
    let firstChanged: HTMLElement | null = null;
    for (const row of rows) {
      const r = row.rung;
      const cls = `rung ${row.status}${opts.highlight?.includes(r.id) ? ' pulse' : ''}`;
      const head = h('div', { class: 'rung-head' }, h('span', { class: 'rung-id' }, r.id));
      if (opts.editable && row.status !== 'deleted') {
        const input = h('input', {
          class: `rung-input${opts.errors?.[r.id] ? ' err' : ''}`,
          value: r.text || rungToText(r),
          spellcheck: 'false',
          autocomplete: 'off',
          'aria-label': `Rung ${r.id}`,
        }) as HTMLInputElement;
        let sent = false;
        const commit = (): void => {
          if (sent || input.value.trim() === (r.text || rungToText(r))) return;
          sent = true;
          opts.onEdit?.(r.id, input.value);
        };
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            input.value = r.text || rungToText(r);
            input.blur();
          }
        });
        input.addEventListener('blur', commit);
        head.append(input);
        const del = h('button', { class: 'icon-btn sm', title: 'Delete rung', 'aria-label': `Delete ${r.id}` });
        del.innerHTML = ICONS.trash;
        del.addEventListener('click', () => opts.onDelete?.(r.id));
        head.append(del);
      } else {
        head.append(h('code', { class: 'rung-text' }, r.text || rungToText(r)));
        if (row.status !== 'same') head.append(h('span', { class: `rung-badge ${row.status}` }, row.status));
      }
      const box = h('div', { class: cls, 'data-id': r.id }, head);
      if (row.status === 'changed' && row.old) box.append(h('div', { class: 'rung-old' }, h('code', null, row.old.text || rungToText(row.old))));
      if (opts.errors?.[r.id]) box.append(h('div', { class: 'rung-err' }, opts.errors[r.id]));
      const rr = renderRungSvg(r, width - 2);
      box.append(rr.el);
      this.list.append(box);
      if (row.status !== 'deleted') this.rendered.push({ id: r.id, r: rr });
      if (!firstChanged && row.status !== 'same') firstChanged = box;
    }
    if (opts.editable) {
      const add = h('button', { class: 'ghost-btn add-rung' });
      add.innerHTML = `${ICONS.plus}<span>Add rung</span>`;
      add.addEventListener('click', () => opts.onAdd?.());
      this.list.append(add);
    }
    this.list.scrollTop = scrollTop;
    this.setMemory(this.mem);
  }

  /** Scroll the first changed rung into view. */
  revealChanges(): void {
    const el = this.list.querySelector('.rung.changed, .rung.added, .rung.deleted') as HTMLElement | null;
    if (el) this.list.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' });
  }

  setMemory(m: LadderMemory | null): void {
    this.mem = m;
    this.el.classList.toggle('powered', !!m);
    for (const x of this.rendered) x.r.update(m);
  }
}

function diffRows(program: Rung[], base: Rung[] | null): Row[] {
  if (!base) return program.map((rung) => ({ rung, status: 'same' }));
  const baseMap = new Map(base.map((r) => [r.id, r]));
  const newIds = new Set(program.map((r) => r.id));
  const rows: Row[] = [];
  let bi = 0;
  for (const r of program) {
    const pos = base.findIndex((b) => b.id === r.id);
    if (pos >= 0) {
      while (bi < pos) {
        if (!newIds.has(base[bi].id)) rows.push({ rung: base[bi], status: 'deleted' });
        bi++;
      }
      bi = Math.max(bi, pos + 1);
    }
    const old = baseMap.get(r.id);
    rows.push({ rung: r, status: !old ? 'added' : rungEqual(old, r) ? 'same' : 'changed', old });
  }
  while (bi < base.length) {
    if (!newIds.has(base[bi].id)) rows.push({ rung: base[bi], status: 'deleted' });
    bi++;
  }
  return rows;
}

export function diffSummary(program: Rung[], base: Rung[]): { changed: number; added: number; deleted: number } {
  const rows = diffRows(program, base);
  return {
    changed: rows.filter((r) => r.status === 'changed').length,
    added: rows.filter((r) => r.status === 'added').length,
    deleted: rows.filter((r) => r.status === 'deleted').length,
  };
}
