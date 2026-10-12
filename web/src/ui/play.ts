// Play mode: the live digital twin. The TypeScript simulator runs in real time (10 scans/s);
// the operator panel, plant actions and 3D clicks drive it; the waveform, ladder power flow and
// rule monitors update live.

import type { Frame, Rung, RunFile, Scenario, Trace } from '../types';
import { Sim, type StepResult } from '../sim/sim';
import { DT } from '../sim/plc';
import { parseRung, ParseError, lintProgram } from '../sim/lang';
import { RULE_IDS } from '../sim/monitors';
import { SCENARIOS } from '../sim/scenarios';
import { h } from './dom';
import { ICONS } from './icons';
import type { PanelControl } from './stage';

export type ProgramChoice = 'baseline' | 'repaired' | 'custom';

const MAX_FRAMES = 900;

export class LiveSim {
  sim: Sim;
  trace: Trace = { dt: DT, frames: [], violations: [], events: [] };
  running = true;
  speed = 1;
  private acc = 0;
  stats = { picked: 0, dropped: 0, spawned: 0, violations: 0 };
  byRule: Record<string, number> = {};
  script: { sc: Scenario; applied: boolean[]; k0: number } | null = null;
  lastFrame: Frame | null = null;
  prevFrame: Frame | null = null;
  onScan: (r: StepResult) => void = () => {};
  autofeed = 3;
  autopick = 1;

  constructor(program: Rung[]) {
    this.sim = new Sim(program, { autofeedEvery: this.autofeed, autopickAfter: this.autopick });
  }

  reset(program: Rung[], script: Scenario | null = null): void {
    const opts = script
      ? { autofeedEvery: script.options?.autofeed_every, autopickAfter: script.options?.autopick_after }
      : { autofeedEvery: this.autofeed || undefined, autopickAfter: this.autopick >= 0 ? this.autopick : undefined };
    this.sim = new Sim(program, opts);
    this.trace = { dt: DT, frames: [], violations: [], events: [] };
    this.stats = { picked: 0, dropped: 0, spawned: 0, violations: 0 };
    this.byRule = {};
    this.lastFrame = this.prevFrame = null;
    this.acc = 0;
    this.script = script ? { sc: script, applied: script.events.map(() => false), k0: 0 } : null;
  }

  setAuto(feed: number, pick: number): void {
    this.autofeed = feed;
    this.autopick = pick;
    if (!this.script) this.sim.opts = { autofeedEvery: feed || undefined, autopickAfter: pick >= 0 ? pick : undefined };
  }

  /** Run as many scans as real time allows. */
  tick(realDt: number): number {
    if (!this.running) return 0;
    this.acc += Math.min(0.25, realDt) * this.speed;
    let n = 0;
    while (this.acc >= DT - 1e-9) {
      this.acc -= DT;
      this.stepOnce();
      n++;
    }
    return n;
  }

  /** Fraction of the way to the next scan, for smooth box motion. */
  get frac(): number {
    return this.running ? Math.max(0, Math.min(1, this.acc / DT)) : 0;
  }

  stepOnce(): StepResult {
    const script = this.script;
    const r = this.sim.step(
      script
        ? (s, t) => {
            script.sc.events.forEach((e, i) => {
              if (!script.applied[i] && e.t <= t + 1e-9) {
                script.applied[i] = true;
                s.applyEvent(e);
              }
            });
          }
        : undefined,
    );
    if (script && this.sim.t >= script.sc.duration) {
      // keep running freely once the script is over
      this.script = null;
    }
    this.prevFrame = this.lastFrame;
    this.lastFrame = r.frame;
    this.trace.frames.push(r.frame);
    this.trace.violations.push(...r.violations);
    this.trace.events.push(...r.events);
    for (const e of r.events) {
      if (e.kind === 'pick') this.stats.picked++;
      if (e.kind === 'spawn') this.stats.spawned++;
    }
    for (const v of r.violations) {
      if (v.rule === 'DROP') this.stats.dropped++;
      else this.stats.violations++;
      this.byRule[v.rule] = (this.byRule[v.rule] ?? 0) + 1;
    }
    if (this.trace.frames.length > MAX_FRAMES) {
      const cut = this.trace.frames.length - MAX_FRAMES + 100;
      this.trace.frames.splice(0, cut);
      const t0 = this.trace.frames[0].t;
      this.trace.violations = this.trace.violations.filter((v) => v.t >= t0);
      this.trace.events = this.trace.events.filter((e) => e.t >= t0);
    }
    this.onScan(r);
    return r;
  }

  /** Current frame with boxes eased toward their next positions. */
  smoothFrame(): Frame | null {
    const f = this.lastFrame;
    if (!f) return null;
    const k = this.frac;
    if (k <= 0) return f;
    const next = this.sim.plant.snapshot();
    const boxes = f.boxes.map((b) => {
      if (b.state !== 'belt') return b;
      const nb = next.find((x) => x.id === b.id);
      return nb && nb.x !== b.x ? { ...b, x: b.x + (nb.x - b.x) * k } : b;
    });
    return { ...f, t: Math.round((f.t + k * DT) * 1000) / 1000, boxes };
  }

  control(c: PanelControl): void {
    const s = this.sim;
    switch (c) {
      case 'START':
      case 'STOP':
      case 'RESET':
        s.press(c, 0.3);
        break;
      case 'ESTOP':
        s.set('ESTOP', s.inputs.ESTOP ? 0 : 1);
        break;
      case 'GUARD':
        s.set('GUARD_CLOSED', s.inputs.GUARD_CLOSED ? 0 : 1);
        break;
    }
  }
}

// ---------- custom program editing ----------

export class CustomProgram {
  rungs: Rung[];
  errors: Record<string, string> = {};
  constructor(from: Rung[]) {
    this.rungs = from.map((r) => ({ ...r }));
  }
  edit(id: string, text: string): string | null {
    const i = this.rungs.findIndex((r) => r.id === id);
    if (i < 0) return null;
    try {
      this.rungs[i] = parseRung(text, id);
      delete this.errors[id];
      return null;
    } catch (e) {
      const msg = e instanceof ParseError ? `${e.message} (col ${e.pos + 1})` : String(e);
      this.errors[id] = msg;
      return msg;
    }
  }
  remove(id: string): void {
    this.rungs = this.rungs.filter((r) => r.id !== id);
    delete this.errors[id];
  }
  add(): string {
    const n = Math.max(0, ...this.rungs.map((r) => parseInt(r.id.replace(/\D/g, ''), 10) || 0)) + 1;
    const id = `R${String(n).padStart(2, '0')}`;
    this.rungs.push(parseRung('HORN = ESTOP OR FAULT', id));
    return id;
  }
  warnings(): string[] {
    return lintProgram(this.rungs);
  }
}

// ---------- the control panel ----------

export interface PlayPanelHandlers {
  control(c: PanelControl): void;
  spawn(): void;
  pick(): void;
  stick(sensor: 'PE_IN' | 'PE_END'): void;
  unstick(): void;
  setAuto(feed: number, pick: number): void;
  runScenario(sc: Scenario | null): void;
  resetSim(): void;
}

export class PlayPanel {
  readonly el: HTMLDivElement;
  private estopBtn: HTMLButtonElement;
  private guardBtn: HTMLButtonElement;
  private btns: Record<string, HTMLButtonElement> = {};
  private feedSel: HTMLSelectElement;
  private pickSel: HTMLSelectElement;
  private scenarioBtns: HTMLButtonElement[] = [];
  private status: HTMLDivElement;
  private guardShown: boolean | null = null;

  constructor(private hnd: PlayPanelHandlers) {
    const KEYS: Record<string, string> = { START: 'S', STOP: 'X', RESET: 'R' };
    const press = (c: PanelControl, label: string, cls: string, hint: string): HTMLButtonElement => {
      const b = h('button', { class: `op-btn ${cls}`, title: `${hint} (key ${KEYS[c]})` }, h('span', { class: 'op-cap' }), h('span', { class: 'op-label' }, label, h('span', { class: 'kbd sm op-k' }, KEYS[c])));
      b.addEventListener('click', () => hnd.control(c));
      this.btns[c] = b;
      return b;
    };
    this.estopBtn = h('button', { class: 'op-estop', title: 'E-stop: push to latch, click again to twist-release (key K)' }, h('span', { class: 'mush' }), h('span', { class: 'op-label' }, 'E-STOP', h('span', { class: 'kbd sm op-k' }, 'K')));
    this.estopBtn.addEventListener('click', () => hnd.control('ESTOP'));
    this.guardBtn = h('button', { class: 'op-guard', title: 'Open or close the guard door around the robot (key G)' });
    this.guardBtn.addEventListener('click', () => hnd.control('GUARD'));
    const act = (svg: string, label: string, on: () => void, title: string): HTMLButtonElement => {
      const b = h('button', { class: 'act-btn', title });
      b.innerHTML = `${svg}<span>${label}</span>`;
      b.addEventListener('click', on);
      return b;
    };
    this.feedSel = h('select', { class: 'mini-select', 'aria-label': 'Auto-feed' }) as HTMLSelectElement;
    for (const [v, l] of [
      ['0', 'off'],
      ['2', 'every 2 s'],
      ['3', 'every 3 s'],
      ['5', 'every 5 s'],
    ])
      this.feedSel.append(h('option', { value: v }, l));
    this.feedSel.value = '3';
    this.pickSel = h('select', { class: 'mini-select', 'aria-label': 'Robot auto-pick' }) as HTMLSelectElement;
    for (const [v, l] of [
      ['-1', 'off'],
      ['0.5', 'after 0.5 s'],
      ['1', 'after 1 s'],
      ['2', 'after 2 s'],
    ])
      this.pickSel.append(h('option', { value: v }, l));
    this.pickSel.value = '1';
    const onAuto = (): void => hnd.setAuto(Number(this.feedSel.value), Number(this.pickSel.value));
    this.feedSel.addEventListener('change', onAuto);
    this.pickSel.addEventListener('change', onAuto);

    const scenarioList = h('div', { class: 'sc-mini-list' });
    for (const sc of SCENARIOS) {
      const b = h('button', { class: 'sc-mini', title: sc.description }, h('span', { class: 'sc-mini-t' }, sc.title), h('span', { class: 'sc-mini-d' }, `${sc.duration}s script`));
      b.addEventListener('click', () => hnd.runScenario(sc));
      this.scenarioBtns.push(b);
      scenarioList.append(b);
    }
    this.status = h('div', { class: 'play-status' });
    const resetBtn = h('button', { class: 'ghost-btn sm' });
    resetBtn.innerHTML = `${ICONS.restart}<span>Reset cell</span>`;
    resetBtn.addEventListener('click', () => hnd.resetSim());

    this.el = h(
      'div',
      { class: 'play-panel' },
      h('div', { class: 'panel-head' }, h('div', { class: 'ph-title' }, h('span', { class: 'ph-kicker' }, 'Live digital twin'), h('span', { class: 'ph-name' }, 'Operator panel')), resetBtn),
      this.status,
      h('div', { class: 'op-panel' }, h('div', { class: 'op-row' }, press('START', 'START', 'start', 'Momentary START push-button'), press('STOP', 'STOP', 'stop', 'Momentary STOP push-button'), press('RESET', 'RESET', 'reset', 'Momentary RESET (acknowledge) push-button')), h('div', { class: 'op-row' }, this.estopBtn, this.guardBtn)),
      h('div', { class: 'pp-section' }, h('div', { class: 'pp-title' }, 'Plant'), h('div', { class: 'act-grid' }, act(ICONS.box, 'Place box', () => hnd.spawn(), 'Put a box on the infeed if it is clear (key B)'), act(ICONS.hand, 'Robot pick', () => hnd.pick(), 'Robot picks the box at the pick position (key P)'), act(ICONS.eye, 'Stick PE_IN', () => hnd.stick('PE_IN'), 'Force the infeed photo-eye ON, like a jam (key J toggles)'), act(ICONS.eye, 'Stick PE_END', () => hnd.stick('PE_END'), 'Force the pick-position photo-eye ON'), act(ICONS.restart, 'Unstick sensors', () => hnd.unstick(), 'Release forced sensors'))),
      h('div', { class: 'pp-section' }, h('div', { class: 'pp-title' }, 'Automation'), h('label', { class: 'pp-field' }, h('span', null, 'Auto-feed'), this.feedSel), h('label', { class: 'pp-field' }, h('span', null, 'Robot auto-pick'), this.pickSel)),
      h('div', { class: 'pp-section' }, h('div', { class: 'pp-title' }, 'Scripted scenarios', h('small', null, 'replayed live on the selected program')), scenarioList),
      h('div', { class: 'pp-tip', html: `${ICONS.info}<span><b>Try to break it:</b> run the belt, open the guard door, then close it. Or E-stop, release, and press START. The baseline restarts by itself; the repaired program waits for you.<br><span class="pp-keys">Keys: S start · X stop · R reset · K e-stop · G guard · B box · P pick · J jam</span></span>` }),
    );
  }

  setAutoValues(feed: number, pick: number): void {
    this.feedSel.value = String(feed);
    this.pickSel.value = String(pick);
  }

  update(f: Frame | null, live: LiveSim): void {
    const inp = f?.in ?? live.sim.inputs;
    const estop = live.sim.inputs.ESTOP === 1;
    const guardOpen = live.sim.inputs.GUARD_CLOSED === 0;
    this.estopBtn.classList.toggle('on', estop);
    this.guardBtn.classList.toggle('open', guardOpen);
    if (this.guardShown !== guardOpen) this.guardBtn.innerHTML = `${ICONS.door}<span class="op-label">${guardOpen ? 'GUARD OPEN' : 'GUARD CLOSED'}<span class="kbd sm op-k">G</span></span>`;
    this.guardShown = guardOpen;
    for (const c of ['START', 'STOP', 'RESET']) this.btns[c].classList.toggle('on', inp[c] === 1);
    const out = f?.out;
    const scriptName = live.script ? `Script: ${live.script.sc.title} · ` : '';
    const state = !out ? 'Idle' : out.LAMP_RED ? 'Fault / E-stop' : out.MOTOR ? 'Running' : out.LAMP_AMBER ? 'Ready (waiting)' : 'Stopped';
    this.status.className = `play-status ${!out ? '' : out.LAMP_RED ? 'bad' : out.MOTOR ? 'good' : out.LAMP_AMBER ? 'warn' : ''}`;
    this.status.textContent = `${scriptName}${state}${live.running ? '' : ' · paused'}`;
    for (const b of this.scenarioBtns) b.classList.toggle('on', !!live.script && b.textContent?.startsWith(live.script.sc.title) === true);
  }
}

export function liveRuleStatuses(live: LiveSim): Record<string, { status: 'live-ok' | 'live-bad'; note?: string }> {
  const active = new Set(live.sim.mon.activeRules());
  const out: Record<string, { status: 'live-ok' | 'live-bad'; note?: string }> = {};
  for (const id of RULE_IDS) {
    const n = live.byRule[id] ?? 0;
    out[id] = active.has(id) ? { status: 'live-bad', note: n > 1 ? `${n}× this session` : 'now' } : { status: 'live-ok', note: n ? `${n}× this session` : 'monitoring' };
  }
  return out;
}

export function programFor(run: RunFile, choice: ProgramChoice, custom: CustomProgram | null): Rung[] {
  if (choice === 'custom' && custom) return custom.rungs;
  if (choice === 'baseline') return run.programs.v0 ?? Object.values(run.programs)[0];
  return run.programs[run.final_version] ?? Object.values(run.programs).slice(-1)[0];
}
