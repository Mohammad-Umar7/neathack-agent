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
      const meta = h('div', { class: 'sc-meta' });
      for (const c of cards) {
        const val = h('span', { class: 'sc-val' });
        const from = h('span', { class: 'sc-from' });
        const sub = h('div', { class: 'sc-sub' });
        const root = c.big
          ? h('div', { class: 'sc-card big', 'data-id': c.id }, h('div', { class: 'sc-label' }, c.label), h('div', { class: 'sc-row' }, from, val), sub)
          : h('div', { class: 'sc-mi', 'data-id': c.id }, h('span', { class: 'sc-label' }, c.label), h('span', { class: 'sc-row' }, from, val));
        (c.big ? this.el : meta).append(root);
        this.cards.set(c.id, { root, val, from, sub, last: null });
      }
      if (meta.children.length) this.el.append(meta);
    }
    for (const c of cards) {
      const x = this.cards.get(c.id)!;
      const fmt = c.fmt ?? ((n: number) => fmtInt(n));
      const keep = x.root.classList.contains('reveal') ? ' reveal' : '';
      x.root.className = `${c.big ? 'sc-card big' : 'sc-mi'} tone-${c.tone ?? 'neutral'}${keep}`;
      x.from.innerHTML = c.from !== undefined && c.from !== null ? `${fmt(c.from)}${c.total !== undefined ? `<small>/${c.total}</small>` : ''}<i>→</i>` : '';
      const totalSuffix = c.total !== undefined ? `/${c.total}` : '';
      if (c.to === null) {
        x.val.textContent = '—';
        x.last = null;
      } else if (animate && x.last !== c.to) {
        if (x.last === null && x.root.dataset.seen === '1') {
          x.root.classList.remove('reveal');
          void x.root.offsetWidth;
          x.root.classList.add('reveal');
        }
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
      x.root.dataset.seen = '1';
    }
  }
}

// ---------- safety rules ----------

export type RuleStatus = {
  status: 'proven' | 'violated' | 'tested' | 'failed' | 'pending' | 'live-ok' | 'live-bad';
  note?: string;
  cex?: ProofResult['counterexample']; // the model checker's counterexample, shown on click
  cexLabel?: string;
};

interface CexRow {
  id: string;
  root: HTMLElement;
  chip: HTMLElement;
  note: HTMLElement;
  cexEl: HTMLElement;
  cex?: ProofResult['counterexample'];
  cexLabel: string;
}

export class RulesList {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private rows = new Map<string, CexRow>();
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
      const cexEl = h('div', { class: 'rl-cex' });
      const root = h(
        'div',
        { class: `rl-row ${r.kind}`, title: r.text },
        h('span', { class: 'rl-id' }, r.id),
        h('div', { class: 'rl-text' }, h('div', { class: 'rl-name' }, r.title), h('div', { class: 'rl-desc' }, r.text)),
        h('div', { class: 'rl-status' }, chip, note),
      );
      this.body.append(root, cexEl);
      const row: CexRow = { id: r.id, root, chip, note, cexEl, cexLabel: 'Counterexample' };
      root.addEventListener('click', () => {
        if (!row.cex) return;
        if (row.cexEl.childElementCount) row.cexEl.replaceChildren();
        else this.fillCex(row);
      });
      this.rows.set(r.id, row);
    }
  }

  /** The counterexample as a scan table: which inputs and outputs were on, the last scan breaks the rule. */
  private fillCex(row: CexRow): void {
    const cex = row.cex ?? [];
    const on = (m: Record<string, number>): string => Object.entries(m).filter(([, v]) => v).map(([k]) => k).join(' ') || '·';
    const rows = cex.map((s, i) =>
      h('tr', { class: i === cex.length - 1 ? 'last' : '' }, h('td', null, `${Number(s.t).toFixed(1)}`), h('td', null, on(s.in)), h('td', null, on(s.out))),
    );
    row.cexEl.replaceChildren(
      h('div', { class: 'cex-head' }, `${row.cexLabel} for ${row.id}: ${cex.length} scans, the last one breaks the rule`),
      h('table', { class: 'cex-table' }, h('thead', null, h('tr', null, h('th', null, 't'), h('th', null, 'inputs on'), h('th', null, 'outputs on'))), h('tbody', null, ...rows)),
    );
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
      row.cex = s.cex?.length ? s.cex : undefined;
      row.cexLabel = s.cexLabel ?? 'Counterexample';
      row.root.classList.toggle('has-cex', !!row.cex);
      if (!row.cex) row.cexEl.replaceChildren();
      else if (row.cexEl.childElementCount) this.fillCex(row);
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
          : { status: 'violated', note: p.counterexample ? `cex ${p.counterexample.length} scans` : `${fmtInt(p.states_explored)} states`, cex: p.counterexample };
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
