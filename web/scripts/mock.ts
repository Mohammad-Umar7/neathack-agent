// Generates sample data for the web viewer until the real agent export exists.
//   npx --yes tsx@4.19.2 web/scripts/mock.ts
// Writes web/public/data/mock/manifest.json and web/public/data/mock/run-mock.json.
// Every trace and fuzz number here comes from the TypeScript simulator; only the agent's
// steps, tokens and proof statistics are invented.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalSummary, Manifest, ProofResult, Rung, RunFile, Scenario, ScenarioPair, SpecRule, Step, Trace } from '../src/types';
import { parseRung, rungToText } from '../src/sim/lang';
import { runScenario } from '../src/sim/sim';
import { BASELINE_TEXT, SCENARIOS } from '../src/sim/scenarios';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'data', 'mock');

const ids = BASELINE_TEXT.map((_, i) => `R${String(i + 1).padStart(2, '0')}`);
const v0: Rung[] = BASELINE_TEXT.map((t, i) => parseRung(t, ids[i]));

function patch(prog: Rung[], edits: Record<string, string | null>): Rung[] {
  const out: Rung[] = [];
  for (const r of prog) {
    if (!(r.id in edits)) out.push(r);
    else if (edits[r.id] !== null) out.push(parseRung(edits[r.id] as string, r.id));
  }
  return out;
}

const v1 = patch(v0, { R07: null, R08: 'MOTOR = RUN AND GUARD_CLOSED AND NOT PE_END' });
const v2 = patch(v1, { R02: 'RESET ESTOP_LATCH WHEN NOT ESTOP AND RISE(RESET)' });
const v3 = patch(v2, { R03: 'TON T_JAM(PE_IN AND MOTOR, 0.5s)' });
const v4 = patch(v2, { R03: 'TON T_JAM(PE_IN AND MOTOR, 3.0s)' });
const v5 = patch(v4, {
  R06: 'RUN = (RISE(START) OR RUN) AND NOT STOP AND NOT ESTOP AND NOT ESTOP_LATCH AND NOT FAULT AND GUARD_CLOSED',
});
const programs: Record<string, Rung[]> = { v0, v1, v2, v3, v4, v5 };

const spec: SpecRule[] = [
  { id: 'S1', title: 'E-stop stops the belt', text: 'While ESTOP is pressed, MOTOR is off.', kind: 'safety', method: 'proof' },
  { id: 'S2', title: 'Open guard stops the belt', text: 'While the guard door is open, MOTOR is off.', kind: 'safety', method: 'proof' },
  { id: 'S3', title: 'STOP dominates', text: 'While STOP is pressed, MOTOR is off, whatever else is pressed.', kind: 'safety', method: 'proof' },
  { id: 'S4', title: 'No automatic restart', text: 'MOTOR only runs after a START press since the last STOP, E-stop, guard opening or fault.', kind: 'safety', method: 'proof' },
  { id: 'S5', title: 'E-stop needs a reset', text: 'After an E-stop, LAMP_RED stays on and MOTOR stays off until RESET is pressed with the E-stop released.', kind: 'safety', method: 'proof' },
  { id: 'S6', title: 'Stop at the pick position', text: 'MOTOR is off whenever a box is at the pick position (PE_END).', kind: 'safety', method: 'proof' },
  { id: 'S7', title: 'Jam supervision', text: 'If PE_IN stays covered while the belt runs, a fault stops the belt within 3.5 s.', kind: 'safety', method: 'simulation' },
  { id: 'F1', title: 'Start and run', text: 'START with no fault runs the belt and lights LAMP_GREEN.', kind: 'functional', method: 'simulation' },
  { id: 'F2', title: 'Boxes reach the robot', text: 'Every box placed on the infeed reaches the pick position and is picked.', kind: 'functional', method: 'simulation' },
  { id: 'F3', title: 'Fault reset', text: 'RESET clears a jam fault once the infeed is clear.', kind: 'functional', method: 'simulation' },
];

const pairs: (ScenarioPair & { scenario: Scenario })[] = SCENARIOS.map((sc) => ({
  id: sc.id,
  title: sc.title,
  description: sc.description,
  baseline: runScenario(v0, sc),
  repaired: runScenario(v5, sc),
  scenario: sc,
}));

for (const p of pairs) {
  const fmt = (tr: Trace): string => tr.violations.map((v) => `${v.rule}@${v.t}`).join(' ') || 'none';
  console.log(`${p.id.padEnd(16)} baseline: ${fmt(p.baseline)}\n${''.padEnd(16)} repaired: ${fmt(p.repaired)}`);
}

// ---- fuzzing with the real simulator ----
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomScenario(r: () => number, i: number): Scenario {
  const events: Scenario['events'] = [];
  const dur = 24;
  const at = (): number => Math.round(r() * (dur - 2) * 10) / 10;
  events.push({ t: Math.round(r() * 20) / 10, kind: 'press', input: 'START' });
  const n = 3 + Math.floor(r() * 6);
  for (let k = 0; k < n; k++) {
    const x = r();
    const t = at();
    if (x < 0.25) events.push({ t, kind: 'press', input: 'START' });
    else if (x < 0.35) events.push({ t, kind: 'press', input: 'STOP' });
    else if (x < 0.5) events.push({ t, kind: 'press', input: 'RESET' });
    else if (x < 0.62) {
      events.push({ t, kind: 'set', input: 'ESTOP', value: 1 });
      events.push({ t: Math.round((t + 0.5 + r() * 3) * 10) / 10, kind: 'set', input: 'ESTOP', value: 0 });
    } else if (x < 0.76) {
      events.push({ t, kind: 'set', input: 'GUARD_CLOSED', value: 0 });
      events.push({ t: Math.round((t + 0.5 + r() * 3) * 10) / 10, kind: 'set', input: 'GUARD_CLOSED', value: 1 });
    } else if (x < 0.86) {
      const sensor = r() < 0.6 ? 'PE_IN' : 'PE_END';
      events.push({ t, kind: 'stick', sensor, value: 1 });
      events.push({ t: Math.round((t + 2 + r() * 5) * 10) / 10, kind: 'unstick', sensor });
    } else events.push({ t, kind: 'spawn' });
  }
  events.sort((a, b) => a.t - b.t);
  return {
    id: `fuzz-${i}`,
    title: `Fuzz ${i}`,
    description: 'random',
    duration: dur,
    options: { autofeed_every: 2 + Math.round(r() * 30) / 10, autopick_after: 0.5 + Math.round(r() * 10) / 10 },
    events,
  };
}

function fuzz(prog: Rung[], episodes: number): EvalSummary['fuzz'] {
  const r = rng(20261012);
  let violations = 0;
  const by_rule: Record<string, number> = {};
  for (let i = 0; i < episodes; i++) {
    const tr = runScenario(prog, randomScenario(r, i));
    const rules = new Set(tr.violations.map((v) => v.rule));
    if (rules.size) violations++;
    for (const id of rules) by_rule[id] = (by_rule[id] ?? 0) + 1;
  }
  return { episodes, violations, by_rule };
}

const EPISODES = 400;
const fuzzBase = fuzz(v0, EPISODES);
const fuzzRep = fuzz(v5, EPISODES);
console.log('fuzz baseline', fuzzBase, '\nfuzz repaired', fuzzRep);

// Counterexamples: the last few scans of the first violating stretch in the baseline traces.
function counterexample(rule: string, len: number): ProofResult['counterexample'] {
  for (const p of pairs) {
    const v = p.baseline.violations.find((x) => x.rule === rule);
    if (!v) continue;
    const k = p.baseline.frames.findIndex((f) => f.t === v.t);
    return p.baseline.frames.slice(Math.max(0, k - len + 1), k + 1).map((f) => ({ t: f.t, in: f.in, out: f.out }));
  }
  return undefined;
}

const proofsBase: ProofResult[] = [
  { rule: 'S1', status: 'proven', states_explored: 1184 },
  { rule: 'S2', status: 'proven', states_explored: 1184 },
  { rule: 'S3', status: 'proven', states_explored: 1184 },
  { rule: 'S4', status: 'violated', states_explored: 412, counterexample: counterexample('S4', 7) },
  { rule: 'S5', status: 'violated', states_explored: 236, counterexample: counterexample('S5', 5) },
  { rule: 'S6', status: 'violated', states_explored: 318, counterexample: counterexample('S6', 9) },
];
const proofsRep: ProofResult[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map((rule, i) => ({
  rule,
  status: 'proven' as const,
  states_explored: [2310, 2310, 2310, 2296, 2302, 2288][i],
}));

const text = (p: Rung[]): string => p.map((r) => `${r.id}  ${rungToText(r)}`).join('\n');

let clock = 0;
const steps: Step[] = [];
function step(s: Omit<Step, 'i' | 't'> & { dt: number }): void {
  clock += s.dt;
  const { dt: _dt, ...rest } = s;
  steps.push({ i: steps.length, t: Math.round(clock * 10) / 10, ...rest });
}
const m = (vp: number, pr: number) => ({ visible_pass: vp, visible_total: 10, proven: pr, proof_total: 6 });

step({ dt: 0, kind: 'think', title: 'Plan: read the program and the spec, then test before touching anything', detail: 'Goal: commission the conveyor cell. I do not trust the delivered program.\n1. read_program and the spec (S1–S7, F1–F3)\n2. run the visible tests and model-check every safety rule\n3. fix one violated rule at a time, re-proving after every patch\n4. submit only when every rule is proven and every visible test passes', tokens: 1840, cost_usd: 0.006, program_version: 'v0' });
step({ dt: 2.1, kind: 'tool', tool: 'read_program', title: 'Read the delivered program: 11 rungs, 2 timers, 4 coils', detail: text(v0), ok: true, tokens: 2210, cost_usd: 0.007, program_version: 'v0', args: { version: 'v0' } });
step({ dt: 3.4, kind: 'tool', tool: 'run_tests', title: 'Visible tests: 4 of 10 pass', detail: 'PASS  start_and_run\nPASS  stop_dominates\nPASS  estop_stops_belt\nPASS  guard_stops_belt\nFAIL  box_reaches_robot      box #1 fell off the end at t=8.4s\nFAIL  estop_needs_reset       LAMP_RED off at t=6.0s with no RESET\nFAIL  no_auto_restart_guard   MOTOR on at t=6.0s after guard closed\nFAIL  jam_trips_fault         PE_IN covered 3.6s while running, no fault\nFAIL  production_30s          0 of 9 boxes picked\nFAIL  fault_reset             FAULT never set', ok: false, tokens: 3020, cost_usd: 0.01, program_version: 'v0', metrics: m(4, 3), args: { suite: 'visible' } });
step({ dt: 4.2, kind: 'tool', tool: 'prove', title: 'Model-check S1–S6: 3 proven, 3 violated', detail: 'S1  PROVEN    1,184 states\nS2  PROVEN    1,184 states\nS3  PROVEN    1,184 states\nS4  VIOLATED  counterexample: 7 scans\nS5  VIOLATED  counterexample: 5 scans\nS6  VIOLATED  counterexample: 9 scans\nS7  (simulation) jam not detected in stuck-infeed run', ok: false, tokens: 2650, cost_usd: 0.009, program_version: 'v0', metrics: m(4, 3), args: { rules: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] } });
step({ dt: 2.6, kind: 'tool', tool: 'get_counterexample', title: 'S6 counterexample: belt keeps running 1.2 s after PE_END', detail: 't=7.6  PE_END=1  T_END.et=0.1  MOTOR=1   <- S6 violated\nt=8.0  PE_END=1  T_END.et=0.5  MOTOR=1\nt=8.4  box centre 3.95 m > 3.90 m: box falls off the end\n\nR07 delays the stop by 1.2 s, but the box reaches the end of the belt in 0.8 s.', ok: true, tokens: 2480, cost_usd: 0.008, program_version: 'v0', args: { rule: 'S6' } });
step({ dt: 5.8, kind: 'patch', tool: 'propose_patch', title: 'Patch R07/R08: stop the belt the moment PE_END sees a box', detail: '- R07  TON T_END(PE_END, 1.2s)\n- R08  MOTOR = RUN AND GUARD_CLOSED AND NOT T_END.Q\n+ R08  MOTOR = RUN AND GUARD_CLOSED AND NOT PE_END', ok: true, tokens: 3110, cost_usd: 0.011, program_version: 'v1', metrics: m(6, 4), args: { rule: 'S6', rungs: ['R07', 'R08'] } });
step({ dt: 3.1, kind: 'tool', tool: 'prove', title: 'S6 proven (318 → 2,288 states); visible tests 6/10', detail: 'S6  PROVEN  2,288 states explored, no counterexample', ok: true, tokens: 1920, cost_usd: 0.006, program_version: 'v1', metrics: m(6, 4), args: { rule: 'S6' } });
step({ dt: 2.9, kind: 'tool', tool: 'get_counterexample', title: 'S5 counterexample: releasing the E-stop clears the latch', detail: 't=4.0  ESTOP=1  ESTOP_LATCH=1  LAMP_RED=1\nt=6.0  ESTOP=0  ESTOP_LATCH=0  LAMP_RED=0   <- S5 violated\n\nR02 resets the latch as soon as the E-stop is released. The spec needs a RESET press first.', ok: true, tokens: 2390, cost_usd: 0.008, program_version: 'v1', args: { rule: 'S5' } });
step({ dt: 4.7, kind: 'patch', tool: 'propose_patch', title: 'Patch R02: the E-stop latch only clears on RESET', detail: '- R02  RESET ESTOP_LATCH WHEN NOT ESTOP\n+ R02  RESET ESTOP_LATCH WHEN NOT ESTOP AND RISE(RESET)', ok: true, tokens: 2760, cost_usd: 0.009, program_version: 'v2', metrics: m(8, 5), args: { rule: 'S5', rungs: ['R02'] } });
step({ dt: 3.6, kind: 'patch', tool: 'propose_patch', title: 'Patch R03: jam timer watches PE_IN while the belt runs (0.5 s)', detail: '- R03  TON T_JAM(PE_IN AND NOT MOTOR, 3.0s)\n+ R03  TON T_JAM(PE_IN AND MOTOR, 0.5s)\n\nShorter preset so jams trip quickly.', ok: true, tokens: 2980, cost_usd: 0.01, program_version: 'v3', args: { rule: 'S7', rungs: ['R03'] } });
step({ dt: 6.2, kind: 'error', tool: 'run_tests', title: 'Regression: every box now trips a false jam fault (8/10 → 5/10)', detail: 'FAIL  start_and_run        FAULT set at t=1.9s, belt stopped\nFAIL  box_reaches_robot    FAULT set at t=1.9s\nFAIL  production_30s       0 of 9 boxes picked, LAMP_RED on\n\nA box covers PE_IN for 0.7 s while it passes at 0.5 m/s, so a 0.5 s preset trips on every box.', ok: false, tokens: 3340, cost_usd: 0.011, program_version: 'v3', metrics: m(5, 5), args: { suite: 'visible' } });
step({ dt: 1.4, kind: 'rollback', tool: 'rollback', title: 'Roll back to v2: the patch made things worse', detail: 'Restored v2 (S5 and S6 fixes kept). Visible tests back to 8/10.', ok: true, tokens: 640, cost_usd: 0.002, program_version: 'v2', metrics: m(8, 5), args: { to: 'v2' } });
step({ dt: 4.3, kind: 'recover', title: 'Recover: derive the preset from the plant instead of guessing', detail: 'A 0.4 m box passes PE_IN in (0.4 + 2 x 0.2) / 0.5 = 1.6 s worst case.\nS7 allows 3.5 s. Keep the original 3.0 s preset: above 1.6 s with margin, below 3.5 s.\nOnly the condition was wrong: it must be PE_IN AND MOTOR.', ok: true, tokens: 2870, cost_usd: 0.009, program_version: 'v2' });
step({ dt: 3.9, kind: 'patch', tool: 'propose_patch', title: 'Patch R03: TON T_JAM(PE_IN AND MOTOR, 3.0s)', detail: '- R03  TON T_JAM(PE_IN AND NOT MOTOR, 3.0s)\n+ R03  TON T_JAM(PE_IN AND MOTOR, 3.0s)', ok: true, tokens: 2540, cost_usd: 0.008, program_version: 'v4', metrics: m(9, 5), args: { rule: 'S7', rungs: ['R03'] } });
step({ dt: 3.3, kind: 'tool', tool: 'simulate', title: 'Stuck-infeed run: fault trips after 3.0 s, belt stops (S7 passes)', detail: 't=3.0  PE_IN stuck ON\nt=6.0  T_JAM.Q=1  FAULT=1  MOTOR=0  LAMP_RED=1\nmax jam stretch 3.0 s < 3.5 s', ok: true, tokens: 2110, cost_usd: 0.007, program_version: 'v4', args: { scenario: 'stuck-infeed', rule: 'S7' } });
step({ dt: 2.8, kind: 'tool', tool: 'get_counterexample', title: 'S4 counterexample: closing the guard restarts the belt', detail: 't=4.0  GUARD_CLOSED=0  RUN=1  MOTOR=0\nt=6.0  GUARD_CLOSED=1  RUN=1  MOTOR=1   <- S4 violated\n\nRUN survives the guard opening, so MOTOR comes back on its own.', ok: true, tokens: 2290, cost_usd: 0.008, program_version: 'v4', args: { rule: 'S4' } });
step({ dt: 4.1, kind: 'patch', tool: 'propose_patch', title: 'Patch R06: opening the guard drops RUN', detail: '- R06  RUN = (RISE(START) OR RUN) AND NOT STOP AND NOT ESTOP AND NOT ESTOP_LATCH AND NOT FAULT\n+ R06  RUN = (RISE(START) OR RUN) AND NOT STOP AND NOT ESTOP AND NOT ESTOP_LATCH AND NOT FAULT AND GUARD_CLOSED', ok: true, tokens: 2650, cost_usd: 0.009, program_version: 'v5', metrics: m(10, 6), args: { rule: 'S4', rungs: ['R06'] } });
step({ dt: 5.2, kind: 'tool', tool: 'prove', title: 'All 6 safety rules proven; visible tests 10/10', detail: 'S1  PROVEN  2,310 states\nS2  PROVEN  2,310 states\nS3  PROVEN  2,310 states\nS4  PROVEN  2,296 states\nS5  PROVEN  2,302 states\nS6  PROVEN  2,288 states\nfuzz: 400 random episodes, 0 violations', ok: true, tokens: 2930, cost_usd: 0.01, program_version: 'v5', metrics: m(10, 6), args: { rules: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] } });
step({ dt: 2.2, kind: 'submit', tool: 'submit', title: 'Submit v5: held-out suite 24/24', detail: 'Submitted v5 (10 rungs, 4 rungs changed, 1 deleted).\nHeld-out tests: 24/24 (baseline 5/24).\nSeeded faults fixed: 4/4.', ok: true, tokens: 1420, cost_usd: 0.005, program_version: 'v5', metrics: m(10, 6) });

const tokIn = steps.reduce((a, s) => a + Math.round((s.tokens ?? 0) * 0.82), 0);
const tokOut = steps.reduce((a, s) => a + Math.round((s.tokens ?? 0) * 0.18), 0);
const cost = Math.round(steps.reduce((a, s) => a + (s.cost_usd ?? 0), 0) * 1000) / 1000;

const evalBase: EvalSummary = {
  visible: { pass: 4, total: 10 },
  heldout: { pass: 5, total: 24 },
  proofs: proofsBase,
  fuzz: fuzzBase,
  faults_fixed: { fixed: 0, total: 4 },
};
const evalRep: EvalSummary = {
  visible: { pass: 10, total: 10 },
  heldout: { pass: 24, total: 24 },
  proofs: proofsRep,
  fuzz: fuzzRep,
  faults_fixed: { fixed: 4, total: 4 },
};

const run: RunFile = {
  id: 'mock',
  label: 'Sample run (mock data)',
  agent: 'v2',
  model: 'claude-sonnet-4-5',
  provider: 'neatHack LiteLLM',
  started_at: '2026-10-12T15:30:00+05:30',
  duration_s: Math.round(clock),
  tokens: { input: tokIn, output: tokOut },
  cost_usd: cost,
  spec,
  programs,
  final_version: 'v5',
  steps,
  eval: { baseline: evalBase, repaired: evalRep },
  scenarios: pairs,
};

const manifest: Manifest = {
  generated_at: new Date().toISOString(),
  default_run: 'mock',
  runs: [{ id: 'mock', label: run.label, file: 'run-mock.json' }],
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'run-mock.json'), JSON.stringify(run));
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`wrote ${steps.length} steps, ${pairs.length} scenarios to ${outDir}`);
