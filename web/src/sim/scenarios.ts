// Built-in scenario library. Used to generate the mock run, to animate the agent replay
// (each program version is re-simulated in the browser), and as presets in Play mode.

import type { Rung, Scenario } from '../types';
import { parseRung } from './lang';

export const BASELINE_TEXT = [
  'SET ESTOP_LATCH WHEN ESTOP',
  'RESET ESTOP_LATCH WHEN NOT ESTOP',
  'TON T_JAM(PE_IN AND NOT MOTOR, 3.0s)',
  'SET FAULT WHEN T_JAM.Q',
  'RESET FAULT WHEN RISE(RESET) AND NOT PE_IN',
  'RUN = (RISE(START) OR RUN) AND NOT STOP AND NOT ESTOP AND NOT ESTOP_LATCH AND NOT FAULT',
  'TON T_END(PE_END, 1.2s)',
  'MOTOR = RUN AND GUARD_CLOSED AND NOT T_END.Q',
  'LAMP_GREEN = MOTOR',
  'LAMP_AMBER = RUN AND NOT MOTOR',
  'LAMP_RED = ESTOP_LATCH OR FAULT',
];

export function programFromLines(lines: [string, string][]): Rung[] {
  return lines.map(([id, text]) => parseRung(text, id));
}

export function baselineProgram(): Rung[] {
  return BASELINE_TEXT.map((t, i) => parseRung(t, `R${String(i + 1).padStart(2, '0')}`));
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'pick-overrun',
    title: 'Pick-position overrun',
    description: 'One box, START, and the robot waiting at the end of the belt. Does the belt stop in time?',
    duration: 12,
    options: { autopick_after: 1.0 },
    events: [
      { t: 0, kind: 'spawn' },
      { t: 1.0, kind: 'press', input: 'START' },
    ],
  },
  {
    id: 'estop-no-reset',
    title: 'E-stop, then START without RESET',
    description: 'E-stop mid-run, release it, and press START without acknowledging with RESET first.',
    duration: 18,
    options: { autopick_after: 1.0 },
    events: [
      { t: 0, kind: 'spawn' },
      { t: 1.0, kind: 'press', input: 'START' },
      { t: 4.0, kind: 'set', input: 'ESTOP', value: 1 },
      { t: 6.0, kind: 'set', input: 'ESTOP', value: 0 },
      { t: 8.0, kind: 'press', input: 'START' },
      { t: 11.0, kind: 'press', input: 'RESET' },
      { t: 12.0, kind: 'press', input: 'START' },
    ],
  },
  {
    id: 'guard-restart',
    title: 'Guard door reopened',
    description: 'A technician opens the guard door while the belt runs, then closes it again.',
    duration: 12,
    options: { autofeed_every: 4, autopick_after: 1.0 },
    events: [
      { t: 1.0, kind: 'press', input: 'START' },
      { t: 4.0, kind: 'set', input: 'GUARD_CLOSED', value: 0 },
      { t: 6.0, kind: 'set', input: 'GUARD_CLOSED', value: 1 },
      { t: 9.0, kind: 'press', input: 'START' },
    ],
  },
  {
    id: 'stuck-infeed',
    title: 'Stuck infeed sensor',
    description: 'PE_IN sticks ON while the belt runs, as if a box jammed at the infeed.',
    duration: 14,
    options: { autopick_after: 1.0 },
    events: [
      { t: 0, kind: 'spawn' },
      { t: 1.0, kind: 'press', input: 'START' },
      { t: 3.0, kind: 'stick', sensor: 'PE_IN', value: 1 },
      { t: 10.0, kind: 'unstick', sensor: 'PE_IN' },
      { t: 10.5, kind: 'press', input: 'RESET' },
      { t: 11.0, kind: 'press', input: 'START' },
    ],
  },
  {
    id: 'production',
    title: 'Normal production',
    description: 'A box every 3 s, the robot picks each one at the end, STOP at the end of the shift.',
    duration: 30,
    options: { autofeed_every: 3, autopick_after: 0.8 },
    events: [
      { t: 0.5, kind: 'press', input: 'START' },
      { t: 27.0, kind: 'press', input: 'STOP' },
    ],
  },
];

/** Which built-in scenario best demonstrates each rule. */
export const RULE_SCENARIO: Record<string, string> = {
  S1: 'estop-no-reset',
  S2: 'guard-restart',
  S3: 'production',
  S4: 'guard-restart',
  S5: 'estop-no-reset',
  S6: 'pick-overrun',
  S7: 'stuck-infeed',
  DROP: 'pick-overrun',
};
