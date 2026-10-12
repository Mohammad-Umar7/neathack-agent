// Tiny DOM helpers (no framework).

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k === 'html') el.innerHTML = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number | undefined> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, String(v));
  return el;
}

export function icon(svg: string, cls = 'ico'): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.innerHTML = svg;
  return s;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
  return String(Math.round(n));
}

export function fmtDuration(s: number): string {
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m ${String(r).padStart(2, '0')}s`;
}

export function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, v: string): void {
    try {
      window.localStorage.setItem(key, v);
    } catch {
      /* private mode */
    }
  },
};

/** Count a number up from `from` to `to` over `ms`, calling `fmt` on every frame. */
export function countUp(el: HTMLElement, from: number, to: number, ms: number, fmt: (x: number) => string): void {
  const t0 = performance.now();
  const ease = (k: number): number => 1 - Math.pow(1 - k, 3);
  const tick = (): void => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    el.textContent = fmt(from + (to - from) * ease(k));
    if (k < 1) requestAnimationFrame(tick);
  };
  tick();
}

/** Drop empty entries so optional children can be passed to replaceChildren(). */
export function nodes(...xs: (Node | string | null | undefined | false)[]): (Node | string)[] {
  return xs.filter((x): x is Node | string => !!x);
}
