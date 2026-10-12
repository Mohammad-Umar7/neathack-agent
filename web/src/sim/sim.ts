// The digital twin: PLC + conveyor plant + safety monitors, stepped one scan at a time.
// Used both by the scenario runner (scripted tests, parity with agent/plc/sim.py) and by
// Play mode (live, interactive).

import type { Frame, Rung, Scenario, ScenarioEvent, Trace, TraceEvent, Violation } from '../types';
import { OUTPUT_NAMES } from './lang';
import { Monitor } from './monitors';
import { DT, Plc, initialInputs, type Bit } from './plc';
import { CONVENTIONS, Plant, type Sensor } from './plant';

export const round1 = (x: number): number => Math.round(x * 10) / 10;

export interface SimOptions {
  autofeedEvery?: number;
  autopickAfter?: number;
}

export interface StepResult {
  frame: Frame;
  violations: Violation[];
  events: TraceEvent[];
}

const PRESS_LABEL: Record<string, string> = {
  START: 'Operator presses START',
  STOP: 'Operator presses STOP',
  RESET: 'Operator presses RESET',
  ESTOP: 'E-stop pressed',
};

function setLabel(input: string, v: Bit): string {
  if (input === 'ESTOP') return v ? 'E-stop pressed' : 'E-stop released';
  if (input === 'GUARD_CLOSED') return v ? 'Guard door closed' : 'Guard door opened';
  return v ? `Operator holds ${input}` : `Operator releases ${input}`;
}

export class Sim {
  readonly dt = DT;
  plc: Plc;
  plant = new Plant();
  mon = new Monitor();
  inputs: Record<string, Bit> = initialInputs();
  k = 0; // index of the next scan
  opts: SimOptions;
  lastOut: Record<string, Bit> = Object.fromEntries(OUTPUT_NAMES.map((n) => [n, 0 as Bit]));
  pickWait = 0; // scans a box has waited at the pick position with the belt stopped
  private releases: { input: string; at: number }[] = [];
  private lastSpawnT = -Infinity;
  private pending: TraceEvent[] = [];

  constructor(program: Rung[], opts: SimOptions = {}) {
    this.plc = new Plc(program);
    this.opts = { ...opts };
  }

  /** Time of the next scan. */
  get t(): number {
    return round1(this.k * this.dt);
  }

  private ev(kind: TraceEvent['kind'], label: string): void {
    this.pending.push({ t: this.t, kind, label });
  }

  // ---- actions (take effect at the next scan) ----

  /** Momentary press: 1 now, back to 0 at the first scan with t >= from + duration. */
  press(input: string, duration = 0.3, from = this.t): void {
    this.releases = this.releases.filter((r) => r.input !== input);
    this.inputs[input] = 1;
    this.releases.push({ input, at: from + duration });
    this.ev('press', PRESS_LABEL[input] ?? `Operator presses ${input}`);
  }

  /** Hold a button until release() (Play mode). */
  hold(input: string): void {
    this.releases = this.releases.filter((r) => r.input !== input);
    if (this.inputs[input] !== 1) this.ev('press', PRESS_LABEL[input] ?? `Operator presses ${input}`);
    this.inputs[input] = 1;
  }

  /** Release a held button, keeping it pressed for at least `min` seconds after `since`. */
  release(input: string, since: number, min = 0.3): void {
    this.releases = this.releases.filter((r) => r.input !== input);
    this.releases.push({ input, at: Math.max(since + min, this.t) });
  }

  set(input: string, v: Bit): void {
    if (this.inputs[input] === v) return;
    this.inputs[input] = v;
    this.ev('set', setLabel(input, v));
  }

  spawn(scripted = false): boolean {
    const b = this.plant.spawn();
    if (b) this.ev('spawn', 'Box placed on infeed');
    if (b && scripted && CONVENTIONS.explicitSpawnResetsAutofeed) this.lastSpawnT = this.t;
    return !!b;
  }

  pick(): boolean {
    const b = this.plant.pick();
    if (b) this.ev('pick', 'Robot picks box');
    return !!b;
  }

  stick(sensor: Sensor, v: Bit): void {
    this.plant.stuck[sensor] = v;
    this.ev('stick', `${sensor} sensor stuck ${v ? 'ON' : 'OFF'}`);
  }

  unstick(sensor: Sensor): void {
    if (this.plant.stuck[sensor] === undefined) return;
    delete this.plant.stuck[sensor];
    this.ev('unstick', `${sensor} sensor repaired`);
  }

  applyEvent(e: ScenarioEvent): void {
    switch (e.kind) {
      case 'press':
        if (e.input) this.press(e.input, e.duration ?? 0.3, e.t);
        break;
      case 'set':
        if (e.input) this.set(e.input, (e.value ?? 1) as Bit);
        break;
      case 'spawn':
        this.spawn(true);
        break;
      case 'pick':
        this.pick();
        break;
      case 'stick':
        if (e.sensor) this.stick(e.sensor, (e.value ?? 1) as Bit);
        break;
      case 'unstick':
        if (e.sensor) this.unstick(e.sensor);
        break;
    }
  }

  /** Swap the program, keeping plant and memory ("online change"). */
  loadProgram(program: Rung[], reset = false): void {
    this.plc.load(program, reset);
  }

  // ---- one scan ----

  step(applyEvents?: (sim: Sim, t: number) => void): StepResult {
    const t = this.t;
    const dt = this.dt;

    // 1. operator / plant events
    this.releases = this.releases.filter((r) => {
      if (t >= r.at) {
        this.inputs[r.input] = 0;
        this.ev('release', `${r.input} released`);
        return false;
      }
      return true;
    });
    applyEvents?.(this, t);
    const feed = this.opts.autofeedEvery;
    if (feed != null && feed > 0 && t - this.lastSpawnT >= feed && this.plant.infeedClear()) {
      if (this.spawn()) this.lastSpawnT = t;
    }
    const pickAfter = this.opts.autopickAfter;
    if (pickAfter != null && pickAfter >= 0) {
      const b = this.plant.atPick();
      if (b && this.lastOut.MOTOR === 0) {
        this.pickWait++;
        if (this.pickWait >= Math.round(pickAfter / dt) + CONVENTIONS.autopickExtraScans) {
          this.pick();
          this.pickWait = 0;
        }
      } else this.pickWait = 0;
    }

    // 2. sensors from box positions (start of scan) and forcing
    const s = this.plant.sensors();
    this.inputs.PE_IN = s.PE_IN;
    this.inputs.PE_END = s.PE_END;

    // 3. PLC scan
    this.plc.scan(this.inputs, dt);
    const out = this.plc.outputs();

    // 4. monitors
    const violations = this.mon.check(t, this.inputs, out);

    // 5. record
    const frame: Frame = {
      t,
      in: { ...this.inputs },
      out,
      coil: this.plc.coilValues(),
      timer: this.plc.timerValues(),
      boxes: this.plant.snapshot(),
    };
    if (Object.keys(this.plant.stuck).length) frame.stuck = { ...this.plant.stuck };

    // 6. move the belt
    if (out.MOTOR === 1) {
      for (const b of this.plant.move()) {
        violations.push({ rule: 'DROP', t, message: `Box #${b.id} pushed off the end of the belt` });
        this.ev('drop', `Box #${b.id} falls off the end`);
      }
    }
    this.lastOut = out;
    this.k++;
    const events = this.pending;
    this.pending = [];
    return { frame, violations, events };
  }
}

/** Run a scripted scenario and record its full trace. */
export function runScenario(program: Rung[], sc: Scenario): Trace {
  const sim = new Sim(program, { autofeedEvery: sc.options?.autofeed_every, autopickAfter: sc.options?.autopick_after });
  const n = Math.round(sc.duration / DT);
  const applied = sc.events.map(() => false);
  const trace: Trace = { dt: DT, frames: [], violations: [], events: [] };
  const apply = (s: Sim, t: number): void => {
    sc.events.forEach((e, i) => {
      if (!applied[i] && e.t <= t + 1e-9) {
        applied[i] = true;
        s.applyEvent(e);
      }
    });
  };
  for (let k = 0; k < n; k++) {
    const r = sim.step(apply);
    trace.frames.push(r.frame);
    trace.violations.push(...r.violations);
    trace.events.push(...r.events);
  }
  return trace;
}

