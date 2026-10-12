// The STOP/PROVE viewer: layout, modes (Agent run / Before-After / Play), playback and wiring.

import type { Frame, Rung, RunFile, Scenario, Step, Trace, Violation } from '../types';
import { runScenario } from '../sim/sim';
import { rungEqual } from '../sim/lang';
import { RULE_SCENARIO, SCENARIOS } from '../sim/scenarios';
import { RULE_TITLES } from '../sim/monitors';
import { Analyzer, violationLine, type AnalyzerView } from './analyzer';
import { loadRun, type LoadedManifest, type ScenarioPairX } from './data';
import { clamp, fmtDuration, fmtTokens, h, nodes } from './dom';
import { ICONS } from './icons';
import { LadderView, diffSummary, frameMemory, presets } from './ladder';
import { EvidenceDrawer, ScenarioPicker, heroDismissed, showHero, wordmark, type RunSummary } from './overlays';
import { CustomProgram, LiveSim, PlayPanel, liveRuleStatuses, programFor, type ProgramChoice } from './play';
import { Player, crossed, frameIndex, interpolate } from './player';
import type { FocusTarget, Stage } from './stage';
import { Timeline } from './timeline';
import { RulesList, Scoreboard, Toasts, statusesFromEval, type Card, type RuleStatus } from './widgets';

export type Mode = 'agent' | 'compare' | 'play';

export interface Params {
  mode: Mode | null;
  run: string | null;
  scenario: string | null;
  autoplay: boolean;
  clean: boolean;
  speed: number;
  stage2d: boolean;
  quality: 'high' | 'low';
  mock: boolean;
  theater: boolean;
}

export function readParams(): Params {
  const q = new URLSearchParams(location.search);
  const m = q.get('mode');
  const mode: Mode | null = m === 'agent' || m === 'compare' || m === 'play' ? m : m === 'before-after' || m === 'ba' ? 'compare' : null;
  const sp = Number(q.get('speed'));
  return {
    mode,
    run: q.get('run'),
    scenario: q.get('scenario'),
    autoplay: q.get('autoplay') === '1' || q.get('autoplay') === 'true',
    clean: q.get('clean') === '1' || q.get('clean') === 'true',
    speed: Number.isFinite(sp) && sp > 0 ? clamp(sp, 0.25, 8) : 1,
    stage2d: q.get('stage') === '2d',
    quality: q.get('quality') === 'low' ? 'low' : 'high',
    mock: q.get('mock') === '1',
    theater: q.get('theater') === '1',
  };
}

const NULL_STAGE: Stage = {
  setLayout() {},
  applyFrame() {},
  flashViolation() {},
  focus() {},
  onControl() {},
  setInteractive() {},
  resize() {},
  dispose() {},
};

/** Where the camera looks while the agent investigates each built-in scenario. */
const SCENARIO_FOCUS: Record<string, FocusTarget> = {
  'pick-overrun': 'pick',
  'estop-no-reset': 'panel',
  'guard-restart': 'guard',
  'stuck-infeed': 'infeed',
  production: 'overview',
};

const MODE_LABEL: Record<Mode, string> = { agent: 'Agent run', compare: 'Before / After', play: 'Play' };

export class App {
  readonly root: HTMLDivElement;
  readonly stageHost: HTMLDivElement;
  private stage: Stage = NULL_STAGE;
  private run!: RunFile;
  private mode: Mode | null = null;

  private timeline = new Timeline();
  private ladder = new LadderView();
  private rules = new RulesList();
  private scoreboard = new Scoreboard();
  private toasts = new Toasts();
  private drawer = new EvidenceDrawer();
  private picker = new ScenarioPicker();
  private analyzer: Analyzer;
  private player = new Player();

  private left: HTMLElement;
  private right: HTMLElement;
  private bottom: HTMLElement;
  private caption: HTMLDivElement;
  private tabs: Record<Mode, HTMLButtonElement> = {} as Record<Mode, HTMLButtonElement>;
  private runSelect: HTMLSelectElement;
  private ladderTitle: HTMLSpanElement;
  private ladderChips: HTMLDivElement;
  private progSeg: HTMLDivElement;
  private dataBadge: HTMLSpanElement;
  private stageBadge: HTMLSpanElement;

  // agent mode
  private stepIdx = 0;
  private runPlaying = false;
  private runTimer = 0;
  private shownLadderKey = '';
  private focusScenario = 'production';
  private simCache = new Map<string, Trace>();
  private traceKey = '';

  // compare mode
  private scenarioId = '';

  // play mode
  private live: LiveSim | null = null;
  private playPanel: PlayPanel;
  private progChoice: ProgramChoice = 'repaired';
  private custom: CustomProgram | null = null;
  private liveLadderKey = '';

  // render state
  private lastNow = performance.now();
  private lastApplied: { A?: Frame; B?: Frame } = {};
  private ladderFrameKey = '';

  constructor(
    private lm: LoadedManifest,
    private params: Params,
  ) {
    this.analyzer = new Analyzer({
      onPlayPause: () => this.togglePlay(),
      onStep: (d) => this.stepFrame(d),
      onSpeed: (s) => this.setSpeed(s),
      onSeek: (t) => this.seek(t),
      onView: (v: AnalyzerView) => void v,
      onRestart: () => this.restart(),
    });
    this.playPanel = new PlayPanel({
      control: (c) => this.live?.control(c),
      spawn: () => this.live?.sim.spawn(),
      pick: () => this.live?.sim.pick(),
      stick: (s) => this.live?.sim.stick(s, 1),
      unstick: () => {
        this.live?.sim.unstick('PE_IN');
        this.live?.sim.unstick('PE_END');
      },
      setAuto: (f, p) => this.live?.setAuto(f, p),
      runScenario: (sc) => this.runLiveScript(sc),
      resetSim: () => this.resetLive(),
    });

    // ---- top bar ----
    this.runSelect = h('select', { class: 'run-select', 'aria-label': 'Run' }) as HTMLSelectElement;
    for (const r of lm.manifest.runs) this.runSelect.append(h('option', { value: r.id }, r.label));
    this.runSelect.addEventListener('change', () => void this.switchRun(this.runSelect.value));
    const modes = h('nav', { class: 'modes', role: 'tablist' });
    (['agent', 'compare', 'play'] as Mode[]).forEach((m, i) => {
      const b = h('button', { role: 'tab', 'data-mode': m }, h('span', null, MODE_LABEL[m]), h('span', { class: 'kbd sm' }, String(i + 1)));
      b.addEventListener('click', () => this.setMode(m));
      this.tabs[m] = b;
      modes.append(b);
    });
    const evBtn = h('button', { class: 'ghost-btn sm evidence-btn' });
    evBtn.innerHTML = `${ICONS.layers}<span>Evidence</span>`;
    evBtn.addEventListener('click', () => this.drawer.toggle());
    this.dataBadge = h('span', { class: 'data-badge' });
    this.stageBadge = h('span', { class: 'data-badge stage-badge' });
    const topbar = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, wordmark(), h('span', { class: 'tagline' }, 'An agent that commissions PLC logic — and proves it’s safe.')),
      modes,
      h('div', { class: 'top-right' }, this.dataBadge, this.stageBadge, this.runSelect, evBtn),
    );

    // ---- panels ----
    this.left = h('aside', { class: 'panel left', 'data-panel': 'left' });
    this.ladderTitle = h('span', { class: 'ph-name' }, 'Ladder logic');
    this.ladderChips = h('div', { class: 'lh-chips' });
    this.progSeg = h('div', { class: 'seg sm prog-seg' });
    for (const [v, l] of [
      ['baseline', 'Baseline'],
      ['repaired', 'Repaired'],
      ['custom', 'Custom'],
    ] as const) {
      const b = h('button', { 'data-v': v }, l);
      b.addEventListener('click', () => this.setProgramChoice(v));
      this.progSeg.append(b);
    }
    this.right = h(
      'aside',
      { class: 'panel right', 'data-panel': 'right' },
      h('div', { class: 'panel-head' }, h('div', { class: 'ph-title' }, h('span', { class: 'ph-kicker' }, 'Program'), this.ladderTitle), this.progSeg),
      this.ladderChips,
      this.ladder.el,
      h(
        'div',
        { class: 'ladder-legend', title: 'Ladder symbols' },
        h('span', null, h('code', null, '┤ ├'), 'contact'),
        h('span', null, h('code', null, '┤/├'), 'NOT'),
        h('span', null, h('code', null, '┤P├'), 'rising edge'),
        h('span', null, h('code', null, '( )'), 'coil'),
        h('span', null, h('code', null, '(S)(R)'), 'latch'),
        h('span', { class: 'lg-live' }, h('i'), 'energised'),
      ),
      this.rules.el,
    );
    this.bottom = h('section', { class: 'panel bottom', 'data-panel': 'bottom' }, this.analyzer.el);
    this.caption = h('div', { class: 'stage-caption' });
    this.stageHost = h('div', { class: 'stage-host' });
    const mobileTabs = h('nav', { class: 'mobile-tabs' });
    for (const [p, l] of [
      ['left', 'Steps'],
      ['stage', 'Cell'],
      ['right', 'Ladder'],
      ['bottom', 'Signals'],
    ] as const) {
      const b = h('button', { 'data-p': p }, l);
      b.addEventListener('click', () => {
        this.root.dataset.mpanel = p;
        for (const x of Array.from(mobileTabs.children) as HTMLElement[]) x.classList.toggle('on', x === b);
        requestAnimationFrame(() => this.stage?.resize());
      });
      mobileTabs.append(b);
    }
    (mobileTabs.children[1] as HTMLElement).classList.add('on');

    this.root = h(
      'div',
      { class: `app${params.clean ? ' clean' : ''}${params.theater ? ' theater' : ''}`, 'data-mpanel': 'stage' },
      h('div', { class: 'bg' }),
      this.stageHost,
      h('div', { class: 'stage-vignette' }),
      topbar,
      h('div', { class: 'center-top' }, this.scoreboard.el, this.caption),
      this.left,
      this.right,
      this.bottom,
      this.toasts.el,
      mobileTabs,
      this.drawer.el,
    );

    this.timeline.onSelect = (i) => {
      this.stopRunPlay();
      this.selectStep(i, { typing: true });
    };
    this.timeline.onPlayToggle = () => this.toggleRunPlay();
    this.picker.onPick = (id) => this.selectScenario(id, true);

    this.setSpeed(params.speed);
    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Attach the 3D (or 2D) stage once it has loaded; the UI is already running by then. */
  setStage(stage: Stage, real: boolean): void {
    this.stage = stage;
    this.stageBadge.textContent = real ? '3D' : '2D schematic';
    this.stageBadge.title = real ? 'three.js digital twin' : 'The 3D scene is not available; showing the 2D schematic';
    this.root.classList.add('stage-ready');
    stage.onControl((c) => {
      if (this.mode === 'play') this.live?.control(c);
    });
    if (this.mode === 'compare') stage.setLayout('twin', { A: 'BASELINE — as delivered', B: 'REPAIRED — by the agent' });
    else stage.setLayout('single');
    stage.setInteractive(this.mode === 'play');
    stage.focus(this.mode === 'play' ? 'auto' : this.mode === 'agent' ? SCENARIO_FOCUS[this.focusScenario] ?? 'overview' : 'overview');
    this.lastApplied = {};
    stage.resize();
  }

  start(run: RunFile): void {
    const ro = new ResizeObserver(() => this.stage.resize());
    ro.observe(this.stageHost);
    this.setRun(run);
    const mode = this.params.mode ?? 'agent';
    this.setMode(mode);
    if (this.params.autoplay) {
      if (mode === 'agent') this.startRunPlay();
      else if (mode === 'compare') this.setPlaying(true);
    }
    if (!this.params.clean && !this.params.autoplay && !heroDismissed()) {
      showHero(
        run,
        () => {
          this.setMode('agent');
          this.selectStep(0, { typing: false });
          this.startRunPlay();
        },
        () => this.setMode('play'),
      );
    }
    requestAnimationFrame(this.loop);
  }

  // ---------------- run ----------------

  private setRun(run: RunFile): void {
    this.run = run;
    this.runSelect.value = run.id;
    this.dataBadge.textContent = this.lm.isMock ? 'sample data' : run.agent ? `agent ${run.agent}` : '';
    this.dataBadge.classList.toggle('mock', this.lm.isMock);
    this.dataBadge.title = this.lm.isMock ? 'web/public/data/manifest.json not found: showing generated sample data' : run.label;
    this.simCache.clear();
    this.timeline.setRun(run);
    this.rules.setSpec(run.spec);
    this.picker.setScenarios(run.scenarios);
    this.drawer.setRun(run, this.lm.isMock);
    this.drawer.onFirstOpen = () => void this.loadRunSummaries();
    this.stepIdx = 0;
    this.shownLadderKey = '';
    this.custom = null;
    this.live = null;
    this.scenarioId = this.params.scenario && run.scenarios.some((s) => s.id === this.params.scenario) ? this.params.scenario : run.scenarios[0]?.id ?? '';
    document.title = `STOP/PROVE — ${run.label}`;
  }

  private async loadRunSummaries(): Promise<void> {
    const rows: RunSummary[] = [];
    for (const entry of this.lm.manifest.runs) {
      const r = entry.id === this.run.id ? this.run : await loadRun(this.lm, entry.id);
      if (!r) continue;
      const pr = r.eval.repaired;
      rows.push({
        id: r.id,
        label: r.label,
        agent: r.agent,
        model: r.model,
        steps: r.steps.length,
        failed: r.steps.filter((s) => s.kind === 'error').length,
        tokens: r.tokens.input + r.tokens.output,
        cost: r.cost_usd,
        wall: r.duration_s,
        heldout: pr.heldout.total ? `${pr.heldout.pass}/${pr.heldout.total}` : '—',
        proven: pr.proofs.length ? `${pr.proofs.filter((p) => p.status === 'proven').length}/${pr.proofs.length}` : '—',
        current: r.id === this.run.id,
      });
    }
    this.drawer.setRuns(rows);
  }

  private async switchRun(id: string): Promise<void> {
    const run = await loadRun(this.lm, id);
    if (!run) {
      this.toasts.show(`Could not load run "${id}"`, 'bad');
      return;
    }
    this.stopRunPlay();
    const m = this.mode ?? 'agent';
    this.mode = null;
    this.setRun(run);
    this.setMode(m);
  }

  private get baseline(): Rung[] {
    return this.run.programs.v0 ?? Object.values(this.run.programs)[0];
  }
  private get final(): Rung[] {
    return this.run.programs[this.run.final_version] ?? this.baseline;
  }

  // ---------------- modes ----------------

  setMode(m: Mode): void {
    if (this.mode === m) return;
    const prev = this.mode;
    if (prev === 'agent') this.stopRunPlay();
    if (prev === 'play' && this.live) this.live.running = false;
    this.mode = m;
    this.root.dataset.mode = m;
    for (const [k, b] of Object.entries(this.tabs)) b.classList.toggle('on', k === m);
    const leftTab = this.root.querySelector('.mobile-tabs [data-p="left"]');
    if (leftTab) leftTab.textContent = m === 'agent' ? 'Steps' : m === 'compare' ? 'Scenarios' : 'Controls';
    this.stage.setInteractive(m === 'play');
    this.lastApplied = {};
    this.ladderFrameKey = '';
    this.toasts.clear();
    if (m === 'agent') this.enterAgent();
    else if (m === 'compare') this.enterCompare();
    else this.enterPlay();
    this.updateUrl();
    requestAnimationFrame(() => this.stage.resize());
  }

  private updateUrl(): void {
    if (this.params.clean) return;
    try {
      const q = new URLSearchParams(location.search);
      q.set('mode', this.mode ?? 'agent');
      if (this.mode === 'compare' && this.scenarioId) q.set('scenario', this.scenarioId);
      else q.delete('scenario');
      history.replaceState(null, '', `${location.pathname}?${q.toString()}${location.hash}`);
    } catch {
      /* file:// or sandboxed */
    }
  }

  // ---------------- Agent run ----------------

  private enterAgent(): void {
    this.left.replaceChildren(this.timeline.el);
    this.stage.setLayout('single');
    this.stage.focus('overview');
    this.analyzer.setView('both');
    this.shownLadderKey = '';
    this.traceKey = '';
    this.player.loop = true;
    this.player.playing = true;
    this.analyzer.setPlaying(true);
    if (this.run.steps.length) this.selectStep(this.stepIdx, { typing: false, scroll: true });
    else this.showNoSteps();
  }

  private showNoSteps(): void {
    this.ladder.render(this.final, { base: this.baseline });
    this.rules.setStatuses(statusesFromEval(this.run.spec, this.run.eval.repaired));
  }

  private versionAt(i: number): string {
    let v = 'v0';
    for (let k = 0; k <= i && k < this.run.steps.length; k++) {
      const pv = this.run.steps[k].program_version;
      if (pv && this.run.programs[pv]) v = pv;
    }
    return v;
  }

  /** Version in force just before the most recent program change at or before step i. */
  private baseVersionAt(i: number): string | null {
    let cur = 'v0';
    let base: string | null = null;
    for (let k = 0; k <= i && k < this.run.steps.length; k++) {
      const pv = this.run.steps[k].program_version;
      if (pv && this.run.programs[pv] && pv !== cur) {
        base = cur;
        cur = pv;
      }
    }
    return base;
  }

  private scenarioDefs(): Map<string, Scenario> {
    const m = new Map<string, Scenario>(SCENARIOS.map((s) => [s.id, s]));
    for (const p of this.run.scenarios as ScenarioPairX[]) if (p.scenario?.events) m.set(p.id, p.scenario);
    return m;
  }

  private scenarioForStep(s: Step): string | null {
    const defs = this.scenarioDefs();
    const a = (s.args && typeof s.args === 'object' ? s.args : {}) as Record<string, unknown>;
    if (typeof a.scenario === 'string' && defs.has(a.scenario)) return a.scenario;
    const rule = typeof a.rule === 'string' ? a.rule : null;
    if (rule && RULE_SCENARIO[rule]) return RULE_SCENARIO[rule];
    // a rule named in the title, unless the step is a bulk proof/test run
    const m = /\b(S[1-7])\b/.exec(s.title);
    if (m && (s.kind !== 'tool' || s.tool === 'get_counterexample' || s.tool === 'simulate')) return RULE_SCENARIO[m[1]];
    if (s.kind === 'error' || s.kind === 'submit') return 'production';
    return null;
  }

  private simulate(ver: string, scId: string): Trace | null {
    const key = `${ver}|${scId}`;
    const hit = this.simCache.get(key);
    if (hit) return hit;
    const sc = this.scenarioDefs().get(scId);
    const prog = this.run.programs[ver];
    if (!sc || !prog) return null;
    try {
      const tr = runScenario(prog, sc);
      this.simCache.set(key, tr);
      return tr;
    } catch (e) {
      console.warn('simulation failed', e);
      return null;
    }
  }

  private selectStep(i: number, opts: { typing?: boolean; scroll?: boolean } = {}): void {
    const steps = this.run.steps;
    if (!steps.length) return;
    i = clamp(i, 0, steps.length - 1);
    const prevIdx = this.stepIdx;
    this.stepIdx = i;
    const s = steps[i];
    this.timeline.setActive(i, { typing: opts.typing, scroll: opts.scroll });

    // ladder: version in force + diff against the version before the latest patch
    const ver = this.versionAt(i);
    const base = this.baseVersionAt(i);
    const key = `${ver}|${base}`;
    if (key !== this.shownLadderKey) {
      this.shownLadderKey = key;
      const prog = this.run.programs[ver];
      const baseProg = base ? this.run.programs[base] : null;
      const changed = baseProg ? prog.filter((r) => !baseProg.some((b) => b.id === r.id && rungEqual(b, r))).map((r) => r.id) : [];
      this.ladder.render(prog, { base: baseProg, highlight: changed });
      this.ladderFrameKey = '';
      if (baseProg) requestAnimationFrame(() => this.ladder.revealChanges());
      this.setLadderHead(ver, prog, baseProg, base);
    }

    this.rules.setStatuses(this.ruleStatusesAt(i));
    this.rules.setHeading(i >= steps.length - 1 || s.kind === 'submit' ? 'submitted program' : `at step ${i + 1}`);
    this.scoreboard.set(this.agentCards(i));

    // the cell re-simulates the program version in force on the scenario this step is about
    const sc = this.scenarioForStep(s);
    if (sc) this.focusScenario = sc;
    const tr = this.simulate(ver, this.focusScenario);
    const tkey = `${ver}|${this.focusScenario}`;
    if (tr && tkey !== this.traceKey) {
      const firstV = tr.violations[0];
      const keepPos = this.traceKey.endsWith(`|${this.focusScenario}`);
      this.traceKey = tkey;
      this.player.load(tr, null, keepPos);
      if (!keepPos) this.player.pos = firstV ? Math.max(0, firstV.t - 3) : 0;
      this.lastApplied = {};
      this.analyzer.setSources([{ trace: tr, label: ver, tone: 'b', pts: presets(this.run.programs[ver]) }]);
      const def = this.scenarioDefs().get(this.focusScenario);
      const nV = tr.violations.length;
      this.caption.replaceChildren(
        h('span', { class: 'cap-dot' }),
        h('span', { class: 'cap-k' }, 'Re-simulating'),
        h('b', null, `program ${ver}`),
        h('span', { class: 'cap-sep' }, '·'),
        h('span', null, def?.title ?? this.focusScenario),
        h('span', { class: `cap-chip ${nV ? 'bad' : 'good'}` }, nV ? `${nV} violation${nV > 1 ? 's' : ''}` : 'no violations'),
      );
      this.analyzer.setTitle(`${def?.title ?? 'Scenario'} · ${ver}`, []);
      this.stage.focus(SCENARIO_FOCUS[this.focusScenario] ?? 'overview');
    }

    // narrate the recovery story
    if (opts.typing && i !== prevIdx) {
      if (s.kind === 'error') this.toasts.show(s.title, 'bad', 5200, 'Action failed');
      else if (s.kind === 'rollback') this.toasts.show(s.title, 'cy', 4200, 'Rollback');
      else if (s.kind === 'recover') this.toasts.show(s.title, 'cy', 4600, 'Recovered');
      else if (s.kind === 'submit') {
        const r = this.run.eval.repaired;
        this.toasts.show(`Held-out tests ${r.heldout.pass}/${r.heldout.total} · ${r.proofs.filter((p) => p.status === 'proven').length}/${r.proofs.length} rules proven`, 'good', 6000, 'Submitted');
      }
    }
  }

  private setLadderHead(ver: string, prog: Rung[], baseProg: Rung[] | null, base: string | null): void {
    this.ladderTitle.textContent = `Ladder logic · ${ver}`;
    const chips: HTMLElement[] = [h('span', { class: 'chip' }, `${prog.length} rungs`)];
    if (baseProg && base) {
      const d = diffSummary(prog, baseProg);
      chips.push(h('span', { class: 'chip' }, `diff vs ${base}`));
      if (d.changed) chips.push(h('span', { class: 'chip cy' }, `${d.changed} changed`));
      if (d.added) chips.push(h('span', { class: 'chip good' }, `${d.added} added`));
      if (d.deleted) chips.push(h('span', { class: 'chip bad' }, `${d.deleted} deleted`));
    }
    this.ladderChips.replaceChildren(...chips);
  }

  private ruleStatusesAt(i: number): Record<string, RuleStatus> {
    const steps = this.run.steps;
    const submitted = steps.slice(0, i + 1).some((s) => s.kind === 'submit');
    if (submitted || i >= steps.length - 1) return statusesFromEval(this.run.spec, this.run.eval.repaired);
    // before the first proof: unknown; afterwards, baseline results updated by later proofs
    const firstProof = steps.findIndex((s) => s.tool === 'prove' || s.tool === 'run_tests');
    if (firstProof < 0 || i < firstProof) {
      const out: Record<string, RuleStatus> = {};
      for (const r of this.run.spec) out[r.id] = { status: 'pending', note: 'not checked yet' };
      return out;
    }
    const st = statusesFromEval(this.run.spec, this.run.eval.baseline);
    const repaired = statusesFromEval(this.run.spec, this.run.eval.repaired);
    for (let k = firstProof; k <= i; k++) {
      const s = steps[k];
      const a = (s.args && typeof s.args === 'object' ? s.args : {}) as Record<string, unknown>;
      const rules = new Set<string>();
      if (typeof a.rule === 'string') rules.add(a.rule);
      if (Array.isArray(a.rules)) for (const r of a.rules) if (typeof r === 'string') rules.add(r);
      if (!s.ok || (s.tool !== 'prove' && s.tool !== 'simulate')) continue;
      // a successful proof/simulation settles the rules it names (a bare prove settles every proof rule)
      for (const r of this.run.spec) {
        const named = rules.has(r.id);
        if (named || (s.tool === 'prove' && rules.size === 0 && r.method === 'proof')) st[r.id] = repaired[r.id];
      }
    }
    return st;
  }

  private agentCards(i: number): Card[] {
    const steps = this.run.steps;
    const upto = steps.slice(0, i + 1);
    let metrics = upto.filter((s) => s.metrics).slice(-1)[0]?.metrics;
    const first = steps.find((s) => s.metrics)?.metrics;
    const submitted = upto.some((s) => s.kind === 'submit') || i >= steps.length - 1;
    const b = this.run.eval.baseline;
    const r = this.run.eval.repaired;
    if (submitted && !metrics) metrics = { visible_pass: r.visible.pass, visible_total: r.visible.total, proven: r.proofs.filter((p) => p.status === 'proven').length, proof_total: r.proofs.length };
    const tokens = upto.reduce((a, s) => a + (s.tokens ?? 0), 0);
    const cost = upto.reduce((a, s) => a + (s.cost_usd ?? 0), 0);
    const anyTok = steps.some((s) => s.tokens);
    const anyCost = steps.some((s) => s.cost_usd);
    const totalTok = this.run.tokens.input + this.run.tokens.output;
    const proofTotal = metrics?.proof_total ?? r.proofs.length;
    return [
      { id: 'heldout', label: 'Held-out tests', big: true, from: b.heldout.pass, to: submitted ? r.heldout.pass : null, total: r.heldout.total || b.heldout.total, tone: submitted ? 'good' : 'neutral', sub: submitted ? 'never seen by the agent' : 'revealed on submit' },
      { id: 'visible', label: 'Visible tests', big: true, from: first ? first.visible_pass : null, to: metrics ? metrics.visible_pass : null, total: metrics?.visible_total ?? r.visible.total, tone: metrics && metrics.visible_pass === metrics.visible_total ? 'good' : 'warn' },
      { id: 'proven', label: 'Safety rules proven', big: true, to: metrics ? metrics.proven : null, total: proofTotal, tone: metrics && metrics.proven === proofTotal ? 'good' : 'warn', sub: 'model checker' },
      { id: 'faults', label: 'Seeded faults fixed', big: true, to: submitted ? r.faults_fixed.fixed : null, total: r.faults_fixed.total, tone: submitted ? 'good' : 'neutral', sub: submitted ? 'hidden from the agent' : 'scored after submit' },
      { id: 'steps', label: 'Steps', to: i + 1, total: steps.length },
      { id: 'tokens', label: 'Tokens', to: anyTok ? tokens : submitted ? totalTok : 0, fmt: fmtTokens },
      { id: 'cost', label: 'Cost', to: anyCost ? cost : submitted ? this.run.cost_usd : 0, fmt: (x) => `$${x.toFixed(3)}` },
      { id: 'wall', label: 'Wall time', to: steps[i]?.t ?? 0, fmt: (x) => fmtDuration(x) },
    ];
  }

  private toggleRunPlay(): void {
    if (this.runPlaying) this.stopRunPlay();
    else this.startRunPlay();
  }

  private startRunPlay(): void {
    if (!this.run.steps.length) return;
    if (this.stepIdx >= this.run.steps.length - 1) this.selectStep(0, { typing: true });
    this.runPlaying = true;
    this.timeline.setPlaying(true);
    this.scheduleRunStep();
  }

  private stopRunPlay(): void {
    this.runPlaying = false;
    clearTimeout(this.runTimer);
    this.timeline.setPlaying(false);
  }

  private scheduleRunStep(): void {
    clearTimeout(this.runTimer);
    if (!this.runPlaying) return;
    const s = this.run.steps[this.stepIdx];
    const special = s.kind === 'error' || s.kind === 'recover' || s.kind === 'submit';
    const dwell = clamp(1.5 + (s.detail?.length ?? 0) / 900 + (special ? 0.8 : 0), 1.5, 3.8) / this.player.speed;
    this.runTimer = window.setTimeout(() => {
      if (!this.runPlaying) return;
      if (this.stepIdx >= this.run.steps.length - 1) {
        this.stopRunPlay();
        return;
      }
      this.selectStep(this.stepIdx + 1, { typing: true });
      this.scheduleRunStep();
    }, dwell * 1000);
  }

  // ---------------- Before / After ----------------

  private enterCompare(): void {
    this.left.replaceChildren(this.picker.el);
    this.stage.setLayout('twin', { A: 'BASELINE — as delivered', B: 'REPAIRED — by the agent' });
    this.stage.focus('overview');
    const d = diffSummary(this.final, this.baseline);
    this.ladderTitle.textContent = `Ladder logic · v0 → ${this.run.final_version}`;
    this.ladderChips.replaceChildren(
      ...nodes(
      h('span', { class: 'chip' }, `${this.final.length} rungs`),
      d.changed ? h('span', { class: 'chip cy' }, `${d.changed} changed`) : null,
      d.added ? h('span', { class: 'chip good' }, `${d.added} added`) : null,
      d.deleted ? h('span', { class: 'chip bad' }, `${d.deleted} deleted`) : null,
      h('span', { class: 'chip' }, 'power flow: B'),
      ),
    );
    this.ladder.render(this.final, { base: this.baseline });
    requestAnimationFrame(() => this.ladder.revealChanges());
    const rb = statusesFromEval(this.run.spec, this.run.eval.baseline);
    const rr = statusesFromEval(this.run.spec, this.run.eval.repaired);
    for (const id of Object.keys(rr))
      if (rb[id] && rb[id].status !== rr[id].status) rr[id] = { ...rr[id], note: `was ${rb[id].status.toUpperCase()}`, cex: rb[id].cex, cexLabel: 'Baseline counterexample' };
    this.rules.setStatuses(rr);
    this.rules.setHeading('repaired vs baseline');
    this.scoreboard.set(this.finalCards());
    this.player.loop = true;
    if (this.run.scenarios.length) this.selectScenario(this.scenarioId || this.run.scenarios[0].id, false);
    else {
      this.caption.replaceChildren(h('span', null, 'No scenario traces in this run'));
      this.player.load(null);
    }
    this.setPlaying(true);
  }

  private finalCards(): Card[] {
    const b = this.run.eval.baseline;
    const r = this.run.eval.repaired;
    const proven = (e: typeof b): number => e.proofs.filter((p) => p.status === 'proven').length;
    return [
      { id: 'heldout', label: 'Held-out tests', big: true, from: b.heldout.pass, to: r.heldout.pass, total: r.heldout.total, tone: 'good', sub: 'never seen by the agent' },
      { id: 'proven', label: 'Safety rules proven', big: true, from: proven(b), to: proven(r), total: r.proofs.length, tone: 'good', sub: 'model checker' },
      { id: 'fuzz', label: 'Fuzz violations', big: true, from: b.fuzz.violations, to: r.fuzz.violations, tone: r.fuzz.violations ? 'bad' : 'good', sub: `of ${r.fuzz.episodes || b.fuzz.episodes} random episodes` },
      { id: 'faults', label: 'Seeded faults fixed', big: true, to: r.faults_fixed.fixed, total: r.faults_fixed.total, tone: 'good', sub: 'hidden from the agent' },
      { id: 'steps', label: 'Agent steps', to: this.run.steps.length },
      { id: 'tokens', label: 'Tokens', to: this.run.tokens.input + this.run.tokens.output, fmt: fmtTokens },
      { id: 'cost', label: 'Cost', to: this.run.cost_usd, fmt: (x) => `$${x.toFixed(3)}` },
      { id: 'wall', label: 'Wall time', to: this.run.duration_s, fmt: (x) => fmtDuration(x) },
    ];
  }

  private selectScenario(id: string, userPick: boolean): void {
    const p = this.run.scenarios.find((s) => s.id === id) ?? this.run.scenarios[0];
    if (!p) return;
    this.scenarioId = p.id;
    this.picker.setActive(p.id);
    this.player.load(p.baseline, p.repaired);
    this.lastApplied = {};
    this.ladderFrameKey = '';
    this.analyzer.setSources([
      { trace: p.baseline, label: 'Baseline', tone: 'a', pts: presets(this.baseline) },
      { trace: p.repaired, label: 'Repaired', tone: 'b', pts: presets(this.final) },
    ]);
    this.analyzer.setTitle(p.title, [
      { label: 'A baseline', color: '#fb7185' },
      { label: 'B repaired', color: '#34d399' },
    ]);
    const nA = p.baseline.violations.length;
    const nB = p.repaired.violations.length;
    this.caption.replaceChildren(
      h('span', { class: 'cap-k' }, 'Scenario'),
      h('b', null, p.title),
      h('span', { class: `cap-chip ${nA ? 'bad' : 'good'}` }, `A: ${nA ? `${nA} violation${nA > 1 ? 's' : ''}` : 'clean'}`),
      h('span', { class: `cap-chip ${nB ? 'bad' : 'good'}` }, `B: ${nB ? `${nB} violation${nB > 1 ? 's' : ''}` : 'clean'}`),
    );
    if (userPick) this.setPlaying(true);
    this.updateUrl();
  }

  // ---------------- Play ----------------

  private enterPlay(): void {
    this.left.replaceChildren(this.playPanel.el);
    this.stage.setLayout('single');
    this.stage.focus('auto');
    this.player.playing = false;
    if (!this.live) {
      this.live = new LiveSim(this.playProgram());
      this.live.onScan = (r) => this.onLiveScan(r.violations);
      this.playPanel.setAutoValues(this.live.autofeed, this.live.autopick);
      if (this.params.scenario) {
        const sc = SCENARIOS.find((s) => s.id === this.params.scenario);
        if (sc) this.runLiveScript(sc);
      }
    }
    this.live.running = true;
    this.live.speed = this.player.speed;
    this.liveLadderKey = '';
    this.renderPlayLadder();
    this.caption.replaceChildren(h('span', { class: 'cap-dot live' }), h('span', { class: 'cap-k' }, 'Live'), h('b', null, 'digital twin'), h('span', { class: 'cap-sep' }, '·'), h('span', null, 'click the panel buttons, here or in the cell'));
    this.analyzer.setTitle('Live signals', []);
    this.analyzer.setPlaying(true);
    this.updatePlayChrome();
  }

  private playProgram(): Rung[] {
    return programFor(this.run, this.progChoice, this.custom);
  }

  private setProgramChoice(c: ProgramChoice): void {
    if (c === 'custom' && !this.custom) this.custom = new CustomProgram(this.progChoice === 'baseline' ? this.baseline : this.final);
    this.progChoice = c;
    if (this.live) this.live.sim.loadProgram(this.playProgram(), false);
    this.liveLadderKey = '';
    this.renderPlayLadder();
    this.toasts.show(c === 'custom' ? 'Custom program loaded. Edit any rung and press Enter: the twin keeps running (online change).' : `${c === 'baseline' ? 'Baseline (as delivered)' : 'Repaired (by the agent)'} program loaded into the running twin.`, 'cy', 3200);
  }

  private renderPlayLadder(): void {
    const prog = this.playProgram();
    for (const b of Array.from(this.progSeg.children) as HTMLElement[]) b.classList.toggle('on', b.dataset.v === this.progChoice);
    const editable = this.progChoice === 'custom';
    this.ladder.render(prog, {
      editable,
      errors: this.custom?.errors,
      onEdit: (id, text) => {
        if (!this.custom) return;
        const err = this.custom.edit(id, text);
        if (err) this.toasts.show(`${id}: ${err}`, 'bad', 4200, 'Rung not changed');
        else {
          this.live?.sim.loadProgram(this.custom.rungs, false);
          const w = this.custom.warnings();
          this.toasts.show(w.length ? w[0] : `${id} updated and downloaded to the running twin`, w.length ? 'info' : 'good', 2600);
        }
        this.renderPlayLadder();
      },
      onDelete: (id) => {
        if (!this.custom) return;
        this.custom.remove(id);
        this.live?.sim.loadProgram(this.custom.rungs, false);
        this.renderPlayLadder();
      },
      onAdd: () => {
        if (!this.custom) return;
        this.custom.add();
        this.live?.sim.loadProgram(this.custom.rungs, false);
        this.renderPlayLadder();
      },
    });
    this.ladderFrameKey = '';
    this.ladderTitle.textContent = `Ladder logic · ${this.progChoice}`;
    this.ladderChips.replaceChildren(...nodes(h('span', { class: 'chip' }, `${prog.length} rungs`), h('span', { class: 'chip good' }, 'live power flow'), editable ? h('span', { class: 'chip cy' }, 'editable · Enter to download') : null));
  }

  private runLiveScript(sc: Scenario | null): void {
    if (!this.live) return;
    this.live.reset(this.playProgram(), sc);
    this.live.running = true;
    this.lastApplied = {};
    if (sc) this.toasts.show(sc.description, 'cy', 4000, `Script: ${sc.title}`);
  }

  private resetLive(): void {
    if (!this.live) return;
    this.live.reset(this.playProgram(), null);
    this.live.running = true;
    this.lastApplied = {};
    this.toasts.show('Cell reset: belt empty, all inputs released.', 'info', 2200);
  }

  private onLiveScan(vs: Violation[]): void {
    for (const v of vs) {
      this.stage.flashViolation('A', v);
      this.toasts.show(violationLine(v), 'bad', 4200, v.rule === 'DROP' ? 'Box dropped' : `${v.rule} · ${RULE_TITLES[v.rule] ?? ''}`);
    }
  }

  private updatePlayChrome(): void {
    const live = this.live;
    if (!live) return;
    const f = live.lastFrame;
    this.playPanel.update(f, live);
    this.rules.setStatuses(liveRuleStatuses(live));
    this.rules.setHeading('live monitors');
    this.scoreboard.set(
      [
        { id: 'picked', label: 'Boxes picked', big: true, to: live.stats.picked, tone: 'good' },
        { id: 'dropped', label: 'Boxes dropped', big: true, to: live.stats.dropped, tone: live.stats.dropped ? 'bad' : 'neutral' },
        { id: 'viol', label: 'Safety violations', big: true, to: live.stats.violations, tone: live.stats.violations ? 'bad' : 'good' },
        { id: 'simt', label: 'Sim time', big: true, to: f?.t ?? 0, fmt: (x) => `${x.toFixed(1)}s` },
      ],
      false,
    );
    this.analyzer.setPlaying(live.running);
  }

  // ---------------- transport ----------------

  private togglePlay(): void {
    if (this.mode === 'play') {
      if (this.live) this.live.running = !this.live.running;
      this.updatePlayChrome();
      return;
    }
    if (this.mode === 'agent') {
      this.toggleRunPlay();
      return;
    }
    this.setPlaying(!this.player.playing);
  }

  private setPlaying(p: boolean): void {
    if (p && this.player.pos >= this.player.duration - 0.05) this.player.pos = 0;
    this.player.playing = p;
    this.analyzer.setPlaying(p);
  }

  private stepFrame(d: -1 | 1): void {
    if (this.mode === 'play') {
      if (!this.live) return;
      this.live.running = false;
      if (d > 0) this.live.stepOnce();
      this.updatePlayChrome();
      return;
    }
    this.setPlaying(false);
    const dt = this.player.A?.dt ?? 0.1;
    const k = Math.round(this.player.pos / dt) + d;
    this.seek(clamp(k * dt, 0, Math.max(0, this.player.duration - dt)));
  }

  private seek(t: number): void {
    if (this.mode === 'play') return;
    this.player.pos = t;
    this.renderPlayer();
  }

  private restart(): void {
    if (this.mode === 'play') {
      this.resetLive();
      return;
    }
    this.player.pos = 0;
    this.setPlaying(true);
  }

  private setSpeed(s: number): void {
    this.player.speed = s;
    if (this.live) this.live.speed = s;
    this.analyzer.setSpeed(s);
  }

  // ---------------- frame loop ----------------

  private loop = (now: number): void => {
    const dt = Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    try {
      if (this.mode === 'play') this.tickPlay(dt);
      else this.tickPlayer(dt);
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(this.loop);
  };

  private tickPlayer(dt: number): void {
    const p = this.player;
    if (!p.A) return;
    const before = p.pos;
    const wrapped = p.advance(dt);
    if (!wrapped && p.pos > before) this.fireViolations(before, p.pos);
    if (wrapped) this.fireViolations(0, p.pos);
    if (!p.playing) this.analyzer.setPlaying(false);
    this.renderPlayer();
  }

  private fireViolations(from: number, to: number): void {
    const p = this.player;
    for (const [cell, tr] of [
      ['A', p.A],
      ['B', p.B],
    ] as const) {
      for (const v of crossed(tr, from, to)) {
        this.stage.flashViolation(cell, v);
        if (this.mode === 'compare') {
          this.toasts.show(violationLine(v), 'bad', 4200, `${cell === 'A' ? 'Baseline' : 'Repaired'} · ${v.rule === 'DROP' ? 'box dropped' : RULE_TITLES[v.rule] ?? v.rule}`);
        }
      }
    }
  }

  private renderPlayer(): void {
    const p = this.player;
    if (!p.A) return;
    const a = interpolate(p.A, p.pos);
    this.stage.applyFrame('A', a.frame, this.lastApplied.A);
    this.lastApplied.A = a.frame;
    if (p.B) {
      const b = interpolate(p.B, p.pos);
      this.stage.applyFrame('B', b.frame, this.lastApplied.B);
      this.lastApplied.B = b.frame;
    }
    this.analyzer.setTime(p.pos);
    // ladder power flow follows the program shown: B (repaired) in compare mode, A otherwise
    const tr = this.mode === 'compare' && p.B ? p.B : p.A;
    const k = frameIndex(tr, p.pos);
    const key = `${this.mode}|${k}|${tr.frames.length}|${this.shownLadderKey}`;
    if (key !== this.ladderFrameKey) {
      this.ladderFrameKey = key;
      const prog = this.mode === 'compare' ? this.final : this.run.programs[this.versionAt(this.stepIdx)] ?? this.final;
      this.ladder.setMemory(frameMemory(tr.frames[k], tr.frames[k - 1], presets(prog)));
    }
  }

  private tickPlay(dt: number): void {
    const live = this.live;
    if (!live) return;
    const n = live.tick(dt);
    const f = live.smoothFrame();
    if (f) {
      this.stage.applyFrame('A', f, this.lastApplied.A);
      this.lastApplied.A = f;
    }
    if (n > 0 || !this.liveLadderKey) {
      this.liveLadderKey = 'x';
      const lf = live.lastFrame;
      if (lf) this.ladder.setMemory(frameMemory(lf, live.prevFrame ?? undefined, presets(this.playProgram())));
      this.analyzer.setLive(live.trace, presets(this.playProgram()));
      this.updatePlayChrome();
    }
  }

  // ---------------- keyboard ----------------

  /** Play mode: S start, X stop, R reset, K e-stop, G guard, B box, P pick, J jam PE_IN. */
  private playHotkey(k: string): void {
    const live = this.live;
    if (!live) return;
    const map: Record<string, () => void> = {
      s: () => live.control('START'),
      x: () => live.control('STOP'),
      r: () => live.control('RESET'),
      k: () => live.control('ESTOP'),
      g: () => live.control('GUARD'),
      b: () => live.sim.spawn(),
      p: () => live.sim.pick(),
      j: () => (live.sim.plant.stuck.PE_IN !== undefined ? live.sim.unstick('PE_IN') : live.sim.stick('PE_IN', 1)),
    };
    map[k]?.();
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.hero')) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        this.togglePlay();
        break;
      case 'ArrowRight':
      case 'ArrowLeft': {
        e.preventDefault();
        const d = e.key === 'ArrowRight' ? 1 : -1;
        if (this.mode === 'agent') {
          this.stopRunPlay();
          this.selectStep(this.stepIdx + d, { typing: true });
        } else this.stepFrame(d as 1 | -1);
        break;
      }
      case '1':
        this.setMode('agent');
        break;
      case '2':
        this.setMode('compare');
        break;
      case '3':
        this.setMode('play');
        break;
      case 'e':
      case 'E':
        this.drawer.toggle();
        break;
      case 'f':
      case 'F':
        this.root.classList.toggle('theater');
        break;
      case '?':
        this.toasts.show('Space play/pause · ←/→ step · 1/2/3 modes · F theater · E evidence. Play mode: S start · X stop · R reset · K e-stop · G guard · B box · P pick · J jam', 'info', 7000, 'Keyboard');
        break;
      default:
        if (this.mode === 'play' && this.live) this.playHotkey(e.key.toLowerCase());
        break;
      case 'Escape':
        this.drawer.close();
        break;
    }
  }
}
