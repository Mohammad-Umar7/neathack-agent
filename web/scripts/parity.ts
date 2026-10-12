// Parity check: the browser simulator must reproduce the Python simulator scan for scan.
//   npx --yes tsx@4.19.2 web/scripts/parity.ts [--verbose] [file-filter]
// For every web/public/data/golden/*.json (GoldenTrace: program + scenario + trace exported by
// agent/plc), re-run the scenario in TypeScript and diff frames, violations and events.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Frame, GoldenTrace, Rung, Trace } from '../src/types';
import { parseRung, rungToText } from '../src/sim/lang';
import { runScenario } from '../src/sim/sim';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.env.GOLDEN_DIR ?? join(here, '..', 'public', 'data', 'golden');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const filter = args.find((a) => !a.startsWith('-'));
const EPS = 1e-6;

if (!existsSync(dir)) {
  console.log(`No golden traces yet: ${dir} does not exist.`);
  process.exit(0);
}
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json') && (!filter || f.includes(filter)))
  .sort();
if (!files.length) {
  console.log(`No golden traces in ${dir}.`);
  process.exit(0);
}

type Bits = Record<string, number>;

function diffBits(kind: string, a: Bits | undefined, b: Bits | undefined, out: string[]): void {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    const x = a?.[k];
    const y = b?.[k];
    if (x === undefined || y === undefined) out.push(`${kind}.${k}: ${x === undefined ? 'missing in Python' : x} vs ${y === undefined ? 'missing in TS' : y}`);
    else if (Math.abs(x - y) > EPS) out.push(`${kind}.${k}: py=${x} ts=${y}`);
  }
}

function diffFrame(e: Frame, g: Frame): string[] {
  const d: string[] = [];
  if (Math.abs(e.t - g.t) > EPS) d.push(`t: py=${e.t} ts=${g.t}`);
  diffBits('in', e.in, g.in, d);
  diffBits('out', e.out, g.out, d);
  diffBits('coil', e.coil, g.coil, d);
  diffBits('timer', e.timer, g.timer, d);
  const eb = e.boxes ?? [];
  const gb = g.boxes ?? [];
  if (eb.length !== gb.length) d.push(`boxes: py has ${eb.length}, ts has ${gb.length}`);
  for (let i = 0; i < Math.min(eb.length, gb.length); i++) {
    const a = eb[i];
    const b = gb.find((x) => x.id === a.id) ?? gb[i];
    if (a.id !== b.id) d.push(`box[${i}].id: py=${a.id} ts=${b.id}`);
    if (Math.abs(a.x - b.x) > EPS) d.push(`box#${a.id}.x: py=${a.x} ts=${b.x}`);
    if (a.state !== b.state) d.push(`box#${a.id}.state: py=${a.state} ts=${b.state}`);
  }
  const es = e.stuck && Object.keys(e.stuck).length ? e.stuck : undefined;
  const gs = g.stuck && Object.keys(g.stuck).length ? g.stuck : undefined;
  if (JSON.stringify(es ?? null) !== JSON.stringify(gs ?? null)) d.push(`stuck: py=${JSON.stringify(es ?? null)} ts=${JSON.stringify(gs ?? null)}`);
  return d;
}

function dumpFrame(label: string, f: Frame | undefined): string {
  if (!f) return `${label}: (none)`;
  const on = (m: Bits): string => Object.entries(m).filter(([, v]) => v).map(([k]) => k).join(' ') || '-';
  const tm = Object.entries(f.timer).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ');
  const bx = f.boxes.map((b) => `#${b.id}@${b.x}${b.state === 'belt' ? '' : `(${b.state})`}`).join(' ');
  return `${label} t=${f.t}  in[${on(f.in)}] out[${on(f.out)}] coil[${on(f.coil)}] ${tm} boxes[${bx}]${f.stuck ? ` stuck=${JSON.stringify(f.stuck)}` : ''}`;
}

/** Programs may arrive without an AST (text only): parse the text in that case. */
function ensureAst(prog: Rung[]): Rung[] {
  return prog.map((r, i) => (r.expr ? r : parseRung(r.text, r.id ?? `R${String(i + 1).padStart(2, '0')}`)));
}

let failed = 0;
for (const f of files) {
  const g = JSON.parse(readFileSync(join(dir, f), 'utf8')) as GoldenTrace;
  const exp: Trace = g.trace;
  let got: Trace;
  try {
    got = runScenario(ensureAst(g.program), g.scenario);
  } catch (e) {
    console.log(`FAIL  ${f}  simulator threw: ${String(e)}`);
    failed++;
    continue;
  }
  const problems: string[] = [];
  if (exp.frames.length !== got.frames.length) problems.push(`frame count: py=${exp.frames.length} ts=${got.frames.length}`);
  let firstBad = -1;
  const n = Math.min(exp.frames.length, got.frames.length);
  for (let k = 0; k < n; k++) {
    const d = diffFrame(exp.frames[k], got.frames[k]);
    if (d.length) {
      if (firstBad < 0) firstBad = k;
      if (problems.length < 14) problems.push(`scan ${k} (t=${exp.frames[k].t}): ${d.slice(0, 6).join('; ')}${d.length > 6 ? ` (+${d.length - 6} more)` : ''}`);
    }
  }
  const vk = (t: Trace): string[] => t.violations.map((v) => `${v.rule}@${Number(v.t).toFixed(1)}`);
  const ev = vk(exp);
  const gv = vk(got);
  if (ev.join(',') !== gv.join(',')) problems.push(`violations: py=[${ev.join(', ')}] ts=[${gv.join(', ')}]`);
  const ek = (t: Trace): string => t.events.filter((e) => e.kind !== 'release').map((e) => `${e.kind}@${Number(e.t).toFixed(1)}`).join(',');
  const eventsMatch = ek(exp) === ek(got);

  const ok = problems.length === 0;
  if (!ok) failed++;
  const title = g.scenario?.title ?? g.scenario?.id ?? '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f}  ${title}  (${exp.frames.length} scans, ${exp.violations.length} violations${eventsMatch ? '' : ', event labels/times differ (informational)'})`);
  if (!ok) {
    for (const p of problems) console.log(`      ${p}`);
    if (verbose && firstBad >= 0) {
      console.log('      program:');
      for (const r of ensureAst(g.program)) console.log(`        ${r.id}  ${rungToText(r)}`);
      for (let k = Math.max(0, firstBad - 2); k <= Math.min(n - 1, firstBad + 2); k++) {
        console.log(`      ${dumpFrame('py', exp.frames[k])}`);
        console.log(`      ${dumpFrame('ts', got.frames[k])}`);
      }
    }
  }
}
console.log(`\n${files.length - failed}/${files.length} golden traces match.`);
process.exit(failed ? 1 : 0);
