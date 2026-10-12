// Agent timeline: the run's steps as a vertical timeline, with an auto-play mode that types out
// each step's detail.

import type { RunFile, Step } from '../types';
import { fmtDuration, fmtTokens, h, nodes } from './dom';
import { ICONS, stepIcon } from './icons';

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
    this.list = h('ol', { class: 'tl-list' });
    this.el = h(
      'div',
      { class: 'timeline' },
      h('div', { class: 'panel-head' }, h('div', { class: 'ph-title' }, h('span', { class: 'ph-kicker' }, 'Agent run'), h('span', { class: 'ph-name' }, 'Timeline')), this.playBtn),
      this.meta,
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
    this.setProgress(0);
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
    if (typing) this.typeInto(pre, s.detail ?? '');
    else pre.textContent = s.detail ?? '';
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
  }
}
