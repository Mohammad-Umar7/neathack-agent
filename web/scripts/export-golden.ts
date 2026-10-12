// Reverse parity fixtures: golden traces produced by the TypeScript simulator, in the GoldenTrace
// format, for checking a Python port of the simulator against the browser one.
//   npx --yes tsx@4.19.2 web/scripts/export-golden.ts
// Writes web/scripts/golden-ts/<scenario>__<program>.json (kept out of public/, so they do not ship
// with the site) for the baseline and repaired programs on every built-in scenario.
// The forward check, Python -> TS, is scripts/parity.ts; GOLDEN_DIR=web/scripts/golden-ts runs it on these.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GoldenTrace, Rung } from '../src/types';
import { parseRung } from '../src/sim/lang';
import { runScenario } from '../src/sim/sim';
import { BASELINE_TEXT, SCENARIOS } from '../src/sim/scenarios';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'golden-ts');

const ids = BASELINE_TEXT.map((_, i) => `R${String(i + 1).padStart(2, '0')}`);
const baseline: Rung[] = BASELINE_TEXT.map((t, i) => parseRung(t, ids[i]));
const edits: Record<string, string | null> = {
  R02: 'RESET ESTOP_LATCH WHEN NOT ESTOP AND RISE(RESET)',
  R03: 'TON T_JAM(PE_IN AND MOTOR, 3.0s)',
  R06: 'RUN = (RISE(START) OR RUN) AND NOT STOP AND NOT ESTOP AND NOT ESTOP_LATCH AND NOT FAULT AND GUARD_CLOSED',
  R07: null,
  R08: 'MOTOR = RUN AND GUARD_CLOSED AND NOT PE_END',
};
const repaired: Rung[] = baseline.flatMap((r) => (r.id in edits ? (edits[r.id] === null ? [] : [parseRung(edits[r.id] as string, r.id)]) : [r]));

mkdirSync(outDir, { recursive: true });
let n = 0;
for (const sc of SCENARIOS) {
  for (const [name, program] of [
    ['baseline', baseline],
    ['repaired', repaired],
  ] as const) {
    const g: GoldenTrace = { program, scenario: sc, trace: runScenario(program, sc) };
    writeFileSync(join(outDir, `${sc.id}__${name}.json`), JSON.stringify(g));
    n++;
  }
}
console.log(`wrote ${n} TS golden traces to ${outDir}`);
