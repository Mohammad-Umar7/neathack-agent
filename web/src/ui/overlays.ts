// Hero intro overlay, Evidence drawer and the Before/After scenario picker.

import type { RunFile, ScenarioPair } from '../types';
import { RULE_TITLES } from '../sim/monitors';
import { h, nodes, storage } from './dom';
import { ICONS } from './icons';

export const REPO_URL = 'https://github.com/Mohammad-Umar7/neathack-agent';
const HERO_KEY = 'stopprove.hero.dismissed.v1';

export function heroDismissed(): boolean {
  return storage.get(HERO_KEY) === '1';
}

export function wordmark(cls = 'wordmark'): HTMLSpanElement {
  return h('span', { class: cls }, 'STOP', h('span', { class: 'slash' }, '/'), 'PROVE');
}

export interface HeroStats {
  faults: string;
  proven: string;
  heldout: string;
}

export function heroStats(run: RunFile): HeroStats {
  const b = run.eval.baseline;
  const r = run.eval.repaired;
  const pct = (p: { pass: number; total: number }): string => `${Math.round((100 * p.pass) / Math.max(1, p.total))}%`;
  const proven = r.proofs.filter((p) => p.status === 'proven').length;
  return {
    faults: `${r.faults_fixed.fixed}/${r.faults_fixed.total}`,
    proven: `${proven}/${r.proofs.length}`,
    heldout: `${pct(b.heldout)} → ${pct(r.heldout)}`,
  };
}

export function showHero(run: RunFile, onWatch: () => void, onPlay: () => void): HTMLElement {
  const s = heroStats(run);
  const close = (): void => {
    storage.set(HERO_KEY, '1');
    root.classList.add('out');
    setTimeout(() => root.remove(), 500);
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  const stat = (v: string, l: string, i: number): HTMLElement => h('div', { class: 'hero-stat', style: `--i:${i}` }, h('div', { class: 'hs-v' }, v), h('div', { class: 'hs-l' }, l));
  const watch = h('button', { class: 'primary-btn lg' });
  watch.innerHTML = `${ICONS.play}<span>Watch the agent</span>`;
  watch.addEventListener('click', () => {
    close();
    onWatch();
  });
  const play = h('button', { class: 'ghost-btn lg' });
  play.innerHTML = `${ICONS.bolt}<span>Try to break it</span>`;
  play.addEventListener('click', () => {
    close();
    onPlay();
  });
  const x = h('button', { class: 'icon-btn hero-x', title: 'Close (Esc)', 'aria-label': 'Close' });
  x.innerHTML = ICONS.close;
  x.addEventListener('click', close);
  const root = h(
    'div',
    { class: 'hero', role: 'dialog', 'aria-label': 'STOP/PROVE introduction' },
    h('div', { class: 'hero-glow' }),
    h(
      'div',
      { class: 'hero-card' },
      x,
      h('div', { class: 'hero-kicker' }, h('span', { class: 'dot' }), 'neatHack 2026 · Build an agent that works'),
      wordmark('wordmark hero-mark'),
      h('p', { class: 'hero-tag' }, 'An agent that commissions PLC logic — and proves it’s safe.'),
      h('p', { class: 'hero-sub' }, 'It receives a buggy control program for a conveyor cell, finds the hidden faults in simulation, patches the ladder logic, model-checks every safety rule, and only then submits.'),
      h('div', { class: 'hero-stats' }, stat(s.faults, 'hidden faults fixed', 0), stat(s.proven, 'safety rules proven', 1), stat(s.heldout, 'held-out tests', 2)),
      h('div', { class: 'hero-cta' }, watch, play),
      h('div', { class: 'hero-foot' }, h('span', { class: 'kbd' }, 'Space'), ' play / pause  ', h('span', { class: 'kbd' }, '1'), h('span', { class: 'kbd' }, '2'), h('span', { class: 'kbd' }, '3'), ' modes  ', h('span', { class: 'kbd' }, 'Esc'), ' close'),
    ),
  );
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  document.body.append(root);
  return root;
}

// ---------- Evidence drawer ----------

export class EvidenceDrawer {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  constructor() {
    const x = h('button', { class: 'icon-btn', 'aria-label': 'Close' });
    x.innerHTML = ICONS.close;
    x.addEventListener('click', () => this.close());
    this.body = h('div', { class: 'drawer-body' });
    this.el = h('div', { class: 'drawer', 'aria-hidden': 'true' }, h('div', { class: 'drawer-scrim' }), h('aside', { class: 'drawer-panel' }, h('div', { class: 'drawer-head' }, h('span', null, 'Evidence'), x), this.body));
    this.el.querySelector('.drawer-scrim')!.addEventListener('click', () => this.close());
  }
  open(): void {
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
  }
  close(): void {
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
  }
  toggle(): void {
    if (this.el.classList.contains('open')) this.close();
    else this.open();
  }
  setRun(run: RunFile | null, isMock: boolean): void {
    const link = (href: string | undefined, svg: string, title: string, sub: string): HTMLElement =>
      href
        ? h('a', { class: 'ev-link', href, target: '_blank', rel: 'noopener' }, h('span', { class: 'ev-ico', html: svg }), h('span', { class: 'ev-txt' }, h('b', null, title), h('small', null, sub)), h('span', { class: 'ev-ext', html: ICONS.external }))
        : h('div', { class: 'ev-link disabled' }, h('span', { class: 'ev-ico', html: svg }), h('span', { class: 'ev-txt' }, h('b', null, title), h('small', null, sub)));
    const step = (n: string, t: string, d: string): HTMLElement => h('li', null, h('span', { class: 'hw-n' }, n), h('div', null, h('b', null, t), h('p', null, d)));
    this.body.replaceChildren(
      ...nodes(
      isMock ? h('div', { class: 'ev-note' }, 'Showing sample data generated by the in-browser simulator. The real agent run replaces it automatically once exported.') : null,
      link(REPO_URL, ICONS.github, 'GitHub repository', 'Code, commit history and Entire checkpoints'),
      link(run?.neatlogs_url, ICONS.trace, 'neatlogs trace', run?.neatlogs_url ? 'Every LLM and tool call of this run' : 'Trace link appears with the real run'),
      link(`${REPO_URL}/tree/main/docs/business-plan`, ICONS.chart, 'Business plan (cfo.ai)', 'Pricing, costs, revenue and runway'),
      link(`${REPO_URL}#readme`, ICONS.book, 'README', 'Setup and how to reproduce the run'),
      h('h3', { class: 'hw-title' }, 'How it works'),
      h(
        'ol',
        { class: 'hw' },
        step('1', 'Receive', 'A conveyor-cell control program with seeded faults the agent is not told about, plus a written safety spec.'),
        step('2', 'Simulate', 'Run the program in a scan-accurate PLC + plant simulator against the visible tests and read the failures.'),
        step('3', 'Counterexample', 'A model checker explores every reachable state and returns the shortest input sequence that breaks a rule.'),
        step('4', 'Patch', 'Propose a minimal edit in a restricted rung language. Bad patches are caught and rolled back.'),
        step('5', 'Prove', 'Re-check every safety rule on the patched program. Submit only when all are proven.'),
        step('6', 'Score', 'The submission is graded on a held-out test suite it never saw.'),
      ),
      h('p', { class: 'hw-foot' }, 'The browser twin re-implements the Python simulator scan for scan; a parity check compares both on golden traces.'),
      ),
    );
  }
}

// ---------- Before / After scenario picker ----------

export class ScenarioPicker {
  readonly el: HTMLDivElement;
  private list: HTMLDivElement;
  private cards = new Map<string, HTMLElement>();
  onPick: (id: string) => void = () => {};

  constructor() {
    this.list = h('div', { class: 'scn-list' });
    this.el = h(
      'div',
      { class: 'scn-picker' },
      h('div', { class: 'panel-head' }, h('div', { class: 'ph-title' }, h('span', { class: 'ph-kicker' }, 'Before / After'), h('span', { class: 'ph-name' }, 'Scenarios'))),
      h('p', { class: 'scn-intro' }, 'The same scripted situation, run on the program as delivered (A) and as repaired by the agent (B).'),
      this.list,
    );
  }

  setScenarios(pairs: ScenarioPair[]): void {
    this.list.replaceChildren();
    this.cards.clear();
    for (const p of pairs) {
      const rulesA = Array.from(new Set(p.baseline.violations.map((v) => v.rule)));
      const rulesB = Array.from(new Set(p.repaired.violations.map((v) => v.rule)));
      const chips = (rules: string[], n: number, tone: 'a' | 'b'): HTMLElement =>
        h(
          'div',
          { class: `scn-res ${n ? 'bad' : 'ok'}` },
          h('span', { class: `scn-tag ${tone}` }, tone.toUpperCase()),
          n ? h('span', null, `${n} violation${n > 1 ? 's' : ''}`) : h('span', null, 'no violations'),
          ...rules.slice(0, 4).map((r) => h('span', { class: 'rule-pill', title: RULE_TITLES[r] ?? r }, r)),
        );
      const card = h(
        'button',
        { class: 'scn-card', 'data-id': p.id },
        h('div', { class: 'scn-title' }, p.title),
        h('div', { class: 'scn-desc' }, p.description),
        chips(rulesA, p.baseline.violations.length, 'a'),
        chips(rulesB, p.repaired.violations.length, 'b'),
      );
      card.addEventListener('click', () => this.onPick(p.id));
      this.cards.set(p.id, card);
      this.list.append(card);
    }
  }

  setActive(id: string): void {
    for (const [k, c] of this.cards) c.classList.toggle('active', k === id);
    this.cards.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
