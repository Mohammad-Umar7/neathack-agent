// Agent timeline: the run's steps as a vertical timeline, with an auto-play mode that types out
// each step's detail.

import type { RunFile, Step } from '../types';
import { fmtDuration, fmtTokens, h, nodes } from './dom';
import { ICONS, stepIcon } from './icons';

function argsLine(s: Step): string {
  if (s.args === undefined || s.args === null || s.tool === undefined) return '';
  let a: string;
  try {
    a = typeof s.args === 'string' ? s.args : JSON.stringify(s.args);
  } catch {
    return '';
  }
  if (!a || a === '{}') return '';
  return `${s.tool}(${a.length > 160 ? `${a.slice(0, 157)}...` : a})\n\n`;
}

const KIND_LABEL: Record<string, string> = {
  error: 'Failed action',
  rollback: 'Rollback',
  recover: 'Recovered',
  patch: 'Patch',
  submit: 'Submit',
  think: 'Think',
};

export class Timeline {
  readonly el: HTMLDivElement;
  private list: HTMLOListElement;
  private items: HTMLLIElement[] = [];
  private run: RunFile | null = null;
  private active = -1;
  private expanded = new Set<number>();
  private playBtn: HTMLButtonElement;
  private progress: HTMLDivElement;
  private spark: HTMLDivElement;
  private summary: HTMLLIElement | null = null;
  private sparkCursor: SVGLineElement | null = null;
  private sparkW = 300;
  private meta: HTMLDivElement;
  private typing: { el: HTMLElement; text: string; t0: number; i: number } | null = null;
  private typeRaf = 0;
  onSelect: (i: number) => void = () => {};
  onPlayToggle: () => void = () => {};

  constructor() {
    this.playBtn = h('button', { class: 'primary-btn sm' });
    this.playBtn.addEventListener('click', () => this.onPlayToggle());
    this.setPlaying(false);
    this.meta = h('div', { class: 'tl-meta' });
    this.progress = h('div', { class: 'tl-progress' }, h('i'));
    this.spark = h('div', { class: 'tl-spark' });
    this.list = h('ol', { class: 'tl-list' });
    this.el = h(
      'div',
      { class: 'timeline' },
      h('div', { class: 'panel-head' }, h('div', { class: 'ph-title' }, h('span', { class: 'ph-kicker' }, 'Agent run'), h('span', { class: 'ph-name' }, 'Timeline')), this.playBtn),
      this.meta,
      this.spark,
      this.progress,
      this.list,
    );
  }

  setPlaying(p: boolean): void {
    this.playBtn.innerHTML = `${p ? ICONS.pause : ICONS.play}<span>${p ? 'Pause' : 'Play run'}</span>`;
    this.playBtn.classList.toggle('on', p);
  }

  setRun(run: RunFile): void {
    this.run = run;
    this.active = -1;
    this.expanded.clear();
    const errs = run.steps.filter((s) => s.kind === 'error').length;
    const recov = run.steps.filter((s) => s.kind === 'recover' || s.kind === 'rollback').length;
    this.meta.replaceChildren(
      ...nodes(
      h('span', { class: 'chip' }, run.model),
      h('span', { class: 'chip' }, `agent ${run.agent}`),
      h('span', { class: 'chip' }, `${run.steps.length} steps`),
      errs ? h('span', { class: 'chip bad' }, `${errs} failed action${errs > 1 ? 's' : ''}`) : null,
      recov ? h('span', { class: 'chip cy' }, `${recov} recover${recov > 1 ? 'ies' : 'y'}`) : null,
      ),
    );
    this.list.replaceChildren();
    this.items = run.steps.map((s, i) => this.renderStep(s, i));
    this.list.append(...this.items);
    this.summary = this.renderSummary(run);
    this.list.append(this.summary);
    this.setProgress(0);
    this.renderSpark(run);
  }

  private renderStep(s: Step, i: number): HTMLLIElement {
    const kindCls = `k-${s.kind}${s.ok === false && s.kind !== 'error' ? ' notok' : ''}`;
    const ic = h('span', { class: 'tl-ico', html: stepIcon(s.kind, s.tool) });
    const badge = KIND_LABEL[s.kind] && s.kind !== 'think' ? h('span', { class: `tl-badge ${s.kind}` }, KIND_LABEL[s.kind]) : null;
    const tool = s.tool && s.kind !== 'error' ? h('span', { class: 'tl-tool' }, s.tool) : s.tool ? h('span', { class: 'tl-tool' }, s.tool) : null;
    const metaBits = [`+${fmtDuration(s.t)}`];
    if (s.tokens) metaBits.push(`${fmtTokens(s.tokens)} tok`);
    if (s.program_version) metaBits.push(s.program_version);
    const detail = h('pre', { class: 'tl-detail' });
    const li = h(
      'li',
      { class: `tl-item ${kindCls}`, 'data-i': i },
      ic,
      h('div', { class: 'tl-body' }, h('div', { class: 'tl-top' }, badge, tool, h('span', { class: 'tl-time' }, metaBits.join(' · '))), h('div', { class: 'tl-title' }, s.title), detail),
    );
    li.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.tl-detail')) return;
      if (this.active === i) {
        if (this.expanded.has(i)) this.expanded.delete(i);
        else this.expanded.add(i);
        this.applyExpanded(i, false);
      } else this.onSelect(i);
    });
    return li;
  }

  private applyExpanded(i: number, typing: boolean): void {
    const li = this.items[i];
    if (!li || !this.run) return;
    const s = this.run.steps[i];
    const open = this.expanded.has(i) && !!s.detail;
    li.classList.toggle('open', open);
    const pre = li.querySelector('.tl-detail') as HTMLElement;
    if (!open) {
      pre.textContent = '';
      return;
    }
    const text = `${argsLine(s)}${s.detail ?? ''}`;
    if (typing) this.typeInto(pre, text);
    else pre.textContent = text;
  }

  private typeInto(el: HTMLElement, text: string): void {
    cancelAnimationFrame(this.typeRaf);
    this.typing = { el, text, t0: performance.now(), i: 0 };
    el.textContent = '';
    const cps = Math.max(260, text.length / 1.1); // finish long details in about a second
    const tick = (): void => {
      if (!this.typing) return;
      const n = Math.min(text.length, Math.floor(((performance.now() - this.typing.t0) / 1000) * cps));
      el.textContent = text.slice(0, n);
      el.classList.toggle('typing', n < text.length);
      if (n < text.length) this.typeRaf = requestAnimationFrame(tick);
      else this.typing = null;
    };
    tick();
  }

  /** Highlight step i (and everything before it as done). */
  setActive(i: number, opts: { typing?: boolean; scroll?: boolean } = {}): void {
    if (!this.run) return;
    const prev = this.active;
    this.active = i;
    this.items.forEach((li, k) => {
      li.classList.toggle('active', k === i);
      li.classList.toggle('done', k < i);
      li.classList.toggle('future', k > i);
    });
    this.summary?.classList.toggle('shown', i >= this.items.length - 1);
    if (prev !== i) {
      if (prev >= 0 && this.expanded.has(prev)) {
        this.expanded.delete(prev);
        this.applyExpanded(prev, false);
      }
      if (i >= 0) {
        this.expanded.add(i);
        this.applyExpanded(i, !!opts.typing);
      }
    }
    if (opts.scroll !== false && i >= 0) {
      const li = this.items[i];
      const top = li.offsetTop - this.list.clientHeight * 0.3;
      this.list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
    this.setProgress(this.run.steps.length ? (i + 1) / this.run.steps.length : 0);
  }

  private setProgress(k: number): void {
    (this.progress.firstChild as HTMLElement).style.width = `${Math.round(k * 100)}%`;
    if (this.sparkCursor && this.run) {
      const n = Math.max(1, this.run.steps.length - 1);
      const x = 4 + ((this.active < 0 ? 0 : this.active) / n) * (this.sparkW - 8);
      this.sparkCursor.setAttribute('x1', String(x));
      this.sparkCursor.setAttribute('x2', String(x));
    }
  }

  /** Closing card: what the submitted program scored. Revealed when the last step is reached. */
  private renderSummary(run: RunFile): HTMLLIElement {
    const r = run.eval.repaired;
    const b = run.eval.baseline;
    const proven = r.proofs.filter((p) => p.status === 'proven').length;
    const stat = (v: string, l: string): HTMLElement => h('div', { class: 'tls-stat' }, h('b', null, v), h('span', null, l));
    return h(
      'li',
      { class: 'tl-summary' },
      h('div', { class: 'tls-title', html: `${ICONS.prove}<span>Run complete · ${run.final_version} submitted</span>` }),
      h(
        'div',
        { class: 'tls-grid' },
        r.heldout.total ? stat(`${r.heldout.pass}/${r.heldout.total}`, `held-out tests (was ${b.heldout.pass})`) : null,
        r.proofs.length ? stat(`${proven}/${r.proofs.length}`, 'safety rules proven') : null,
        r.faults_fixed.total ? stat(`${r.faults_fixed.fixed}/${r.faults_fixed.total}`, 'seeded faults fixed') : null,
        stat(String(r.fuzz.violations), `fuzz violations (was ${b.fuzz.violations})`),
      ),
      h('div', { class: 'tls-meta' }, `${run.steps.length} steps · ${fmtTokens(run.tokens.input + run.tokens.output)} tokens · $${run.cost_usd.toFixed(3)} · ${fmtDuration(run.duration_s)}`),
    );
  }

  /** Visible tests and proven rules across the run: the dip is the failed patch, the climb is the recovery. */
  private renderSpark(run: RunFile): void {
    const pts = run.steps.map((s) => s.metrics);
    if (!pts.some(Boolean)) {
      this.spark.replaceChildren();
      this.sparkCursor = null;
      return;
    }
    const W = this.sparkW;
    const H = 34;
    const n = Math.max(1, run.steps.length - 1);
    const X = (i: number): number => 4 + (i / n) * (W - 8);
    const Y = (v: number): number => H - 4 - v * (H - 10);
    const series = (get: (m: NonNullable<Step['metrics']>) => number): string => {
      let last: number | null = null;
      const out: string[] = [];
      run.steps.forEach((s, i) => {
        if (s.metrics) last = get(s.metrics);
        if (last !== null) out.push(`${X(i).toFixed(1)},${Y(last).toFixed(1)}`);
      });
      return out.join(' ');
    };
    const vis = series((m) => (m.visible_total ? m.visible_pass / m.visible_total : 0));
    const prv = series((m) => (m.proof_total ? m.proven / m.proof_total : 0));
    const errs = run.steps.map((s, i) => (s.kind === 'error' ? `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="3" y2="${H - 3}" class="sp-err"/>` : '')).join('');
    this.spark.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="4" x2="${W - 4}" y1="${Y(1)}" y2="${Y(1)}" class="sp-top"/><polyline points="${prv}" class="sp-prv"/><polyline points="${vis}" class="sp-vis"/>${errs}<line class="sp-cur" x1="4" x2="4" y1="2" y2="${H - 2}"/></svg><div class="sp-legend"><span class="v">visible tests</span><span class="p">rules proven</span>${errs ? '<span class="e">failed action</span>' : ''}</div>`;
    this.sparkCursor = this.spark.querySelector('.sp-cur');
  }
}
