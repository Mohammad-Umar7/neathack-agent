// PLC scan engine. Mirrors agent/plc: rungs run top to bottom every scan, expressions read the
// current memory (so a coil written by an earlier rung this scan is already updated), RISE(X)
// compares against the memory snapshot taken at the end of the previous scan.

import type { Expr, Rung } from '../types';
import { INPUT_NAMES, OUTPUT_NAMES, exprRefs, isInput, isOutput } from './lang';

export type Bit = 0 | 1;

export interface TimerState {
  et: number; // elapsed seconds
  q: boolean;
  pt: number; // preset seconds
}

export const DT = 0.1;

/** Initial input values: everything released, guard door closed. */
export function initialInputs(): Record<string, Bit> {
  const m: Record<string, Bit> = {};
  for (const n of INPUT_NAMES) m[n] = 0;
  m.GUARD_CLOSED = 1;
  return m;
}

/** Read-only view of PLC memory, used by the evaluator and by the ladder power-flow view. */
export interface MemoryView {
  get(name: string): Bit;
  prev(name: string): Bit;
  timerQ(name: string): boolean;
}

export function evalExpr(e: Expr, m: MemoryView): boolean {
  switch (e.op) {
    case 'var':
      return m.get(e.name) === 1;
    case 'timer':
      return m.timerQ(e.name);
    case 'rise':
      return m.get(e.name) === 1 && m.prev(e.name) !== 1;
    case 'const':
      return e.value;
    case 'not':
      return !evalExpr(e.arg, m);
    case 'and':
      for (const a of e.args) if (!evalExpr(a, m)) return false;
      return true;
    case 'or':
      for (const a of e.args) if (evalExpr(a, m)) return true;
      return false;
  }
}

/** Internal coils of a program (not inputs, not outputs, not timers), in order of first appearance. */
export function programCoils(rungs: Rung[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (n: string): void => {
    if (isInput(n) || isOutput(n) || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };
  for (const r of rungs) if (r.kind !== 'ton') add(r.target);
  for (const r of rungs) exprRefs(r.expr).vars.forEach(add);
  return out;
}

export function programTimers(rungs: Rung[]): { name: string; pt: number }[] {
  const out: { name: string; pt: number }[] = [];
  for (const r of rungs) if (r.kind === 'ton' && !out.some((t) => t.name === r.target)) out.push({ name: r.target, pt: r.pt ?? 0 });
  return out;
}

export class Plc implements MemoryView {
  rungs: Rung[] = [];
  sig: Record<string, Bit> = {};
  prevSig: Record<string, Bit> = {};
  timers: Record<string, TimerState> = {};
  coils: string[] = [];
  timerNames: string[] = [];

  constructor(rungs: Rung[]) {
    this.load(rungs, true);
  }

  /** Load a program. With reset=false the memory is kept (an "online change"); new names start at 0. */
  load(rungs: Rung[], reset: boolean): void {
    this.rungs = rungs;
    this.coils = programCoils(rungs);
    const timers = programTimers(rungs);
    this.timerNames = timers.map((t) => t.name);
    if (reset) {
      this.sig = { ...initialInputs() };
      this.prevSig = { ...initialInputs() };
      for (const n of OUTPUT_NAMES) this.sig[n] = this.prevSig[n] = 0;
      this.timers = {};
    }
    for (const n of this.coils) {
      if (this.sig[n] === undefined) this.sig[n] = 0;
      if (this.prevSig[n] === undefined) this.prevSig[n] = 0;
    }
    const next: Record<string, TimerState> = {};
    for (const t of timers) {
      const old = this.timers[t.name];
      next[t.name] = old ? { et: Math.min(old.et, t.pt), q: old.et >= t.pt - 1e-9, pt: t.pt } : { et: 0, q: false, pt: t.pt };
    }
    this.timers = next;
  }

  get(name: string): Bit {
    return this.sig[name] === 1 ? 1 : 0;
  }
  prev(name: string): Bit {
    return this.prevSig[name] === 1 ? 1 : 0;
  }
  timerQ(name: string): boolean {
    return this.timers[name]?.q ?? false;
  }

  /** One scan: latch the inputs, execute every rung in order, then snapshot memory for RISE(). */
  scan(inputs: Record<string, Bit>, dt = DT): void {
    for (const n of INPUT_NAMES) this.sig[n] = inputs[n] === 1 ? 1 : 0;
    for (const r of this.rungs) {
      const v = evalExpr(r.expr, this);
      switch (r.kind) {
        case 'assign':
          this.sig[r.target] = v ? 1 : 0;
          break;
        case 'set':
          if (v) this.sig[r.target] = 1;
          break;
        case 'reset':
          if (v) this.sig[r.target] = 0;
          break;
        case 'ton': {
          const tm = this.timers[r.target];
          const pt = r.pt ?? 0;
          if (v) tm.et = Math.min(tm.et + dt, pt);
          else tm.et = 0;
          tm.q = tm.et >= pt - 1e-9;
          break;
        }
      }
    }
    this.prevSig = { ...this.sig };
  }

  outputs(): Record<string, Bit> {
    const o: Record<string, Bit> = {};
    for (const n of OUTPUT_NAMES) o[n] = this.get(n);
    return o;
  }

  coilValues(): Record<string, Bit> {
    const o: Record<string, Bit> = {};
    for (const n of this.coils) o[n] = this.get(n);
    return o;
  }

  timerValues(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const n of this.timerNames) o[n] = this.timers[n].et;
    return o;
  }
}
