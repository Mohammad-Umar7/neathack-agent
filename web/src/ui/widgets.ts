// Scoreboard cards, safety-rule list, toasts.

import type { EvalSummary, ProofResult, SpecRule } from '../types';
import { countUp, fmtInt, h } from './dom';
import { ICONS } from './icons';

// ---------- scoreboard ----------

export interface Card {
  id: string;
  label: string;
  from?: number | null; // baseline value (shown dim, before the arrow)
  to: number | null; // current value (null: unknown yet)
  total?: number; // "x / total"
  fmt?: (x: number) => string;
  tone?: 'good' | 'bad' | 'warn' | 'neutral' | 'cy';
  sub?: string;
  big?: boolean;
}

export class Scoreboard {
  readonly el: HTMLDivElement;
  private cards = new Map<string, { root: HTMLElement; val: HTMLElement; from: HTMLElement; sub: HTMLElement; last: number | null }>();

  constructor() {
    this.el = h('div', { class: 'scoreboard' });
  }

  set(cards: Card[], animate = true): void {
    const ids = cards.map((c) => c.id).join(',');
    if (ids !== Array.from(this.cards.keys()).join(',')) {
      this.el.replaceChildren();
      this.cards.clear();
      for (const c of cards) {
        const val = h('span', { class: 'sc-val' });
        const from = h('span', { class: 'sc-from' });
        const sub = h('div', { class: 'sc-sub' });
        const root = h('div', { class: `sc-card${c.big ? ' big' : ''}`, 'data-id': c.id }, h('div', { class: 'sc-label' }, c.label), h('div', { class: 'sc-row' }, from, val), sub);
        this.el.append(root);
        this.cards.set(c.id, { root, val, from, sub, last: null });
      }
    }
    for (const c of cards) {
      const x = this.cards.get(c.id)!;
      const fmt = c.fmt ?? ((n: number) => fmtInt(n));
      x.root.className = `sc-card${c.big ? ' big' : ''} tone-${c.tone ?? 'neutral'}`;
      x.from.innerHTML = c.from !== undefined && c.from !== null ? `${fmt(c.from)}${c.total !== undefined ? `<small>/${c.total}</small>` : ''}<i>→</i>` : '';
      const totalSuffix = c.total !== undefined ? `/${c.total}` : '';
      if (c.to === null) {
        x.val.textContent = '—';
        x.last = null;
      } else if (animate && x.last !== c.to) {
        const start = x.last ?? c.from ?? 0;
        countUp(x.val, start, c.to, x.last === null ? 1100 : 600, (n) => `${fmt(n)}${totalSuffix}`);
        if (x.last !== null) {
          x.root.classList.remove('bump');
          void x.root.offsetWidth;
          x.root.classList.add('bump');
        }
        x.last = c.to;
      } else {
        x.val.textContent = `${fmt(c.to)}${totalSuffix}`;
        x.last = c.to;
      }
      x.sub.textContent = c.sub ?? '';
    }
  }
}

// ---------- safety rules ----------

export type RuleStatus = { status: 'proven' | 'violated' | 'tested' | 'failed' | 'pending' | 'live-ok' | 'live-bad'; note?: string };

export class RulesList {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private rows = new Map<string, { root: HTMLElement; chip: HTMLElement; note: HTMLElement }>();
  private heading: HTMLSpanElement;

  constructor() {
    this.heading = h('span', { class: 'rl-sub' });
    this.body = h('div', { class: 'rl-body' });
    this.el = h('div', { class: 'rules' }, h('div', { class: 'rl-head' }, h('span', { class: 'rl-title', html: `${ICONS.prove}<span>Safety rules</span>` }), this.heading), this.body);
  }

  setSpec(spec: SpecRule[]): void {
    this.body.replaceChildren();
    this.rows.clear();
    const ordered = [...spec.filter((s) => s.kind === 'safety'), ...spec.filter((s) => s.kind !== 'safety')];
    for (const r of ordered) {
      const chip = h('span', { class: 'rl-chip' });
      const note = h('span', { class: 'rl-note' });
      const root = h(
        'div',
        { class: `rl-row ${r.kind}`, title: r.text },
        h('span', { class: 'rl-id' }, r.id),
        h('div', { class: 'rl-text' }, h('div', { class: 'rl-name' }, r.title), h('div', { class: 'rl-desc' }, r.text)),
        h('div', { class: 'rl-status' }, chip, note),
      );
      this.body.append(root);
      this.rows.set(r.id, { root, chip, note });
    }
  }

  setHeading(s: string): void {
    this.heading.textContent = s;
  }

  setStatuses(st: Record<string, RuleStatus>): void {
    for (const [id, row] of this.rows) {
      const s = st[id] ?? { status: 'pending' };
      const label: Record<RuleStatus['status'], string> = {
        proven: 'PROVEN',
        violated: 'VIOLATED',
        tested: 'TESTED',
        failed: 'FAILED',
        pending: '—',
        'live-ok': 'OK',
        'live-bad': 'VIOLATED',
      };
      const changed = row.chip.textContent !== label[s.status];
      row.chip.textContent = label[s.status];
      row.chip.className = `rl-chip ${s.status}`;
      row.note.textContent = s.note ?? '';
      row.root.classList.toggle('bad', s.status === 'violated' || s.status === 'failed' || s.status === 'live-bad');
      if (changed && s.status !== 'pending') {
        row.chip.classList.remove('pop');
        void row.chip.offsetWidth;
        row.chip.classList.add('pop');
      }
    }
  }
}

/** Rule statuses from an evaluation summary. */
export function statusesFromEval(spec: SpecRule[], ev: EvalSummary): Record<string, RuleStatus> {
  const out: Record<string, RuleStatus> = {};
  const proofs = new Map<string, ProofResult>(ev.proofs.map((p) => [p.rule, p]));
  for (const r of spec) {
    const p = proofs.get(r.id);
    if (p) {
      out[r.id] =
        p.status === 'proven'
          ? { status: 'proven', note: `${fmtInt(p.states_explored)} states` }
          : { status: 'violated', note: p.counterexample ? `cex ${p.counterexample.length} scans` : `${fmtInt(p.states_explored)} states` };
    } else {
      const n = ev.fuzz.by_rule[r.id] ?? 0;
      out[r.id] = n > 0 ? { status: 'failed', note: `${n}/${ev.fuzz.episodes} fuzz runs` } : { status: 'tested', note: r.kind === 'safety' ? `${ev.fuzz.episodes} fuzz runs` : 'simulation' };
    }
  }
  return out;
}

// ---------- toasts ----------

export class Toasts {
  readonly el: HTMLDivElement;
  constructor() {
    this.el = h('div', { class: 'toasts', 'aria-live': 'polite' });
  }
  show(text: string, tone: 'bad' | 'good' | 'info' | 'cy' = 'info', ms = 4200, title?: string): void {
    const t = h(
      'div',
      { class: `toast ${tone}` },
      h('span', { class: 'toast-ico', html: tone === 'bad' ? ICONS.error : tone === 'good' ? ICONS.prove : ICONS.info }),
      h('div', { class: 'toast-body' }, title ? h('div', { class: 'toast-title' }, title) : null, h('div', null, text)),
    );
    this.el.prepend(t);
    while (this.el.children.length > 4) this.el.lastElementChild?.remove();
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => {
      t.classList.remove('in');
      t.classList.add('out');
      setTimeout(() => t.remove(), 400);
    }, ms);
  }
  clear(): void {
    this.el.replaceChildren();
  }
}
