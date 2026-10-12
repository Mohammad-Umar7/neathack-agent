// Loading the agent export (web/public/data) with a fallback to the generated mock data,
// plus defensive normalisation so a partial export never crashes the viewer.

import type { EvalSummary, Manifest, Rung, RunFile, Scenario, ScenarioPair, SpecRule } from '../types';
import { baselineProgram } from '../sim/scenarios';

export interface ScenarioPairX extends ScenarioPair {
  scenario?: Scenario; // optional: the scripted scenario, lets the viewer re-simulate it
}

export interface LoadedManifest {
  manifest: Manifest;
  url: string;
  isMock: boolean;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) return null; // dev-server SPA fallback for a missing file
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export function dataBase(): string {
  return new URL('./data/', document.baseURI).href;
}

export async function loadManifest(forceMock = false): Promise<LoadedManifest | null> {
  const base = dataBase();
  if (!forceMock) {
    const url = new URL('manifest.json', base).href;
    const m = await fetchJson<Manifest>(url);
    if (m && Array.isArray(m.runs) && m.runs.length) return { manifest: m, url, isMock: false };
  }
  const url = new URL('mock/manifest.json', base).href;
  const m = await fetchJson<Manifest>(url);
  if (m && Array.isArray(m.runs) && m.runs.length) return { manifest: m, url, isMock: true };
  return null;
}

export async function loadRun(lm: LoadedManifest, id: string): Promise<RunFile | null> {
  const entry = lm.manifest.runs.find((r) => r.id === id) ?? lm.manifest.runs[0];
  if (!entry) return null;
  const candidates = [new URL(entry.file, lm.url).href, new URL(entry.file, dataBase()).href, new URL(entry.file, document.baseURI).href];
  for (const url of Array.from(new Set(candidates))) {
    const run = await fetchJson<RunFile>(url);
    if (run) return normalizeRun(run, entry.label);
  }
  return null;
}

const DEFAULT_SPEC: SpecRule[] = [
  { id: 'S1', title: 'E-stop stops the belt', text: 'While ESTOP is pressed, MOTOR is off.', kind: 'safety', method: 'proof' },
  { id: 'S2', title: 'Open guard stops the belt', text: 'While the guard door is open, MOTOR is off.', kind: 'safety', method: 'proof' },
  { id: 'S3', title: 'STOP dominates', text: 'While STOP is pressed, MOTOR is off.', kind: 'safety', method: 'proof' },
  { id: 'S4', title: 'No automatic restart', text: 'MOTOR only runs after a START press since the last stop condition.', kind: 'safety', method: 'proof' },
  { id: 'S5', title: 'E-stop needs a reset', text: 'After an E-stop, LAMP_RED stays on and MOTOR off until RESET.', kind: 'safety', method: 'proof' },
  { id: 'S6', title: 'Stop at the pick position', text: 'MOTOR is off whenever a box is at PE_END.', kind: 'safety', method: 'proof' },
  { id: 'S7', title: 'Jam supervision', text: 'A covered PE_IN while running trips a fault within 3.5 s.', kind: 'safety', method: 'simulation' },
];

function emptyEval(): EvalSummary {
  return { visible: { pass: 0, total: 0 }, heldout: { pass: 0, total: 0 }, proofs: [], fuzz: { episodes: 0, violations: 0, by_rule: {} }, faults_fixed: { fixed: 0, total: 0 } };
}

function normEval(e: Partial<EvalSummary> | undefined): EvalSummary {
  const d = emptyEval();
  if (!e) return d;
  return {
    visible: e.visible ?? d.visible,
    heldout: e.heldout ?? d.heldout,
    proofs: Array.isArray(e.proofs) ? e.proofs : [],
    fuzz: { ...d.fuzz, ...(e.fuzz ?? {}), by_rule: e.fuzz?.by_rule ?? {} },
    faults_fixed: e.faults_fixed ?? d.faults_fixed,
  };
}

export function normalizeRun(r: RunFile, label?: string): RunFile {
  const programs: Record<string, Rung[]> = r.programs && Object.keys(r.programs).length ? r.programs : { v0: baselineProgram() };
  const versions = Object.keys(programs);
  const final = r.final_version && programs[r.final_version] ? r.final_version : versions[versions.length - 1];
  return {
    ...r,
    id: r.id ?? 'run',
    label: r.label ?? label ?? r.id,
    agent: r.agent ?? 'v2',
    model: r.model ?? 'unknown model',
    provider: r.provider ?? '',
    duration_s: r.duration_s ?? (r.steps?.length ? r.steps[r.steps.length - 1].t : 0),
    tokens: r.tokens ?? { input: 0, output: 0 },
    cost_usd: r.cost_usd ?? 0,
    spec: Array.isArray(r.spec) && r.spec.length ? r.spec : DEFAULT_SPEC,
    programs,
    final_version: final,
    steps: Array.isArray(r.steps) ? r.steps.map((s, i) => ({ ...s, i: s.i ?? i, t: s.t ?? 0, title: s.title ?? s.kind })) : [],
    eval: { baseline: normEval(r.eval?.baseline), repaired: normEval(r.eval?.repaired) },
    scenarios: Array.isArray(r.scenarios) ? r.scenarios.filter((s) => s && s.baseline?.frames && s.repaired?.frames) : [],
  };
}
