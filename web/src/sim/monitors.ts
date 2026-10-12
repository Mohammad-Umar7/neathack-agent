// Runtime safety monitors (observers), evaluated every scan on that scan's inputs and outputs.
// Mirrors agent/plc/monitors.py. A rule is reported once per contiguous violating stretch.

import type { Violation } from '../types';
import type { Bit } from './plc';

export const RULE_IDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'] as const;
export type RuleId = (typeof RULE_IDS)[number];

export const RULE_TITLES: Record<string, string> = {
  S1: 'E-stop stops the belt',
  S2: 'Open guard stops the belt',
  S3: 'STOP dominates',
  S4: 'No automatic restart',
  S5: 'E-stop needs a reset',
  S6: 'Stop at the pick position',
  S7: 'Jam supervision',
  DROP: 'Box dropped',
};

export const RULE_MESSAGES: Record<string, string> = {
  S1: 'Motor running while the E-stop is pressed',
  S2: 'Motor running with the guard door open',
  S3: 'Motor running while STOP is pressed',
  S4: 'Motor restarted without a START press',
  S5: 'E-stop cleared without RESET',
  S6: 'Motor running with a box at the pick position',
  S7: 'Infeed jam not detected within 3.5 s',
};

/** Short "what it looks like on the floor" consequence, used in toasts. */
export const RULE_CONSEQUENCE: Record<string, string> = {
  S1: 'belt kept moving through an E-stop',
  S2: 'belt moving with the guard open',
  S3: 'STOP ignored',
  S4: 'belt restarted by itself',
  S5: 'E-stop lock-out lost',
  S6: 'box carried past the robot',
  S7: 'jam went undetected',
  DROP: 'box pushed off the end',
};

export class Monitor {
  armed: Bit = 0;
  lock: Bit = 0;
  jam = 0;
  private prevStart: Bit = 0;
  private prevReset: Bit = 0;
  private active: Record<string, boolean> = {};

  check(t: number, inp: Record<string, Bit>, out: Record<string, Bit>): Violation[] {
    const START = inp.START === 1;
    const STOP = inp.STOP === 1;
    const ESTOP = inp.ESTOP === 1;
    const RESET = inp.RESET === 1;
    const GUARD = inp.GUARD_CLOSED === 1;
    const PE_IN = inp.PE_IN === 1;
    const PE_END = inp.PE_END === 1;
    const MOTOR = out.MOTOR === 1;
    const RED = out.LAMP_RED === 1;
    const riseStart = START && this.prevStart === 0;
    const riseReset = RESET && this.prevReset === 0;

    const lock = (this.lock === 1 || ESTOP) && !(!ESTOP && riseReset);
    this.lock = lock ? 1 : 0;
    const armed = (this.armed === 1 || (riseStart && !lock)) && !STOP && !ESTOP && GUARD && !RED;
    this.armed = armed ? 1 : 0;
    this.jam = MOTOR && PE_IN ? this.jam + 1 : 0;

    const cond: Record<RuleId, boolean> = {
      S1: ESTOP && MOTOR,
      S2: !GUARD && MOTOR,
      S3: STOP && MOTOR,
      S4: MOTOR && !armed,
      S5: lock && (MOTOR || !RED),
      S6: PE_END && MOTOR,
      S7: this.jam > 35,
    };
    const out_: Violation[] = [];
    for (const id of RULE_IDS) {
      const v = cond[id];
      if (v && !this.active[id]) out_.push({ rule: id, t, message: RULE_MESSAGES[id] });
      this.active[id] = v;
    }
    this.prevStart = START ? 1 : 0;
    this.prevReset = RESET ? 1 : 0;
    return out_;
  }

  /** Rules currently in a violating stretch. */
  activeRules(): string[] {
    return RULE_IDS.filter((id) => this.active[id]);
  }
}
