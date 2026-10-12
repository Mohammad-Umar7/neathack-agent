// Standalone dev harness for the 3D stage (web/scene-test.html). Generates a mock trace
// (motor on, boxes flowing, a pick, an overrun drop, an E-stop, a guard opening and a stuck
// sensor) and replays it with keyboard shortcuts.
import type { Frame, Violation } from '../types';
import { createStage, type CellId, type Stage } from './index';

interface MockTrace {
  frames: Frame[];
  violations: Violation[];
}

type B = { id: number; x: number; state: 'belt' | 'picked' | 'dropped'; gone?: number };

function makeTrace(repaired: boolean): MockTrace {
  const dt = 0.1;
  const T = 66;
  const frames: Frame[] = [];
  const violations: Violation[] = [];
  let run = false;
  let estopLatched = false;
  let boxes: B[] = [];
  let nextId = 1;
  let nextSpawn = 1.6;
  let hold = 0; // pick dwell timer
  let holdId = -1;
  let guardWasOpenWhileRunning = false;
  for (let i = 0; i <= Math.round(T / dt); i++) {
    const t = Math.round(i * dt * 10) / 10;
    const win = (a: number, b: number) => t >= a && t < b;
    const START = win(1.0, 1.4) || win(34.6, 35.0) || (repaired && win(45.2, 45.6)) ? 1 : 0;
    const STOP = win(62, 62.4) ? 1 : 0;
    const RESET = win(33.4, 33.8) ? 1 : 0;
    const ESTOP = win(28.6, 31.8) ? 1 : 0;
    const GUARD_CLOSED = win(39.5, 43.5) ? 0 : 1;
    const stuckIn = win(49, 56);

    if (ESTOP) {
      estopLatched = true;
      run = false;
    }
    if (estopLatched && RESET && !ESTOP) estopLatched = false;
    if (STOP) run = false;
    if (!GUARD_CLOSED) {
      if (run) guardWasOpenWhileRunning = true;
      run = false;
    }
    if (GUARD_CLOSED && guardWasOpenWhileRunning) {
      guardWasOpenWhileRunning = false;
      if (!repaired) {
        run = true; // seeded fault: auto-restart after the guard closes
        violations.push({ rule: 'S4', t, message: 'Motor restarted on guard close without a new START command' });
      }
    }
    if (START && !estopLatched && GUARD_CLOSED) run = true;

    // pick station: stop the belt while the gantry takes the box
    const atEnd = boxes.find((b) => b.state === 'belt' && b.x >= 3.7 - 1e-6);
    const raceBox = !repaired && atEnd?.id === 3; // seeded timing race
    if (atEnd && !raceBox && hold <= 0 && holdId !== atEnd.id) {
      hold = 1.0;
      holdId = atEnd.id;
      atEnd.x = 3.7;
    }
    if (hold > 0) {
      hold -= dt;
      if (hold <= 0) {
        const b = boxes.find((bb) => bb.id === holdId);
        if (b) {
          b.state = 'picked';
          b.gone = t + 3;
        }
      }
    }
    const motor = run && hold <= 0 && !stuckIn ? 1 : 0;
    const motorOn = stuckIn ? (run ? 1 : 0) : motor; // baseline keeps running blind with a stuck sensor
    if (motorOn) {
      for (const b of boxes) if (b.state === 'belt' && !(hold > 0 && b.id === holdId)) b.x = Math.round((b.x + 0.5 * dt) * 1000) / 1000;
    }
    for (const b of boxes) {
      if (b.state === 'belt' && b.x > 3.9) {
        b.state = 'dropped';
        violations.push({ rule: 'DROP', t, message: `Box #${b.id} ran past PE_END and fell off the discharge end` });
      }
    }
    boxes = boxes.filter((b) => !(b.state === 'picked' && b.gone !== undefined && t > b.gone));
    if (motorOn && t >= nextSpawn && !boxes.some((b) => b.state === 'belt' && b.x < 0.75)) {
      boxes.push({ id: nextId++, x: 0.2, state: 'belt' });
      nextSpawn = t + 2.2;
    }
    const covered = (x: number) => boxes.some((b) => b.state === 'belt' && Math.abs(b.x - x) <= 0.2);
    const peIn = stuckIn ? 1 : covered(0.3) ? 1 : 0;
    const peEnd = covered(3.7) ? 1 : 0;
    const fault = estopLatched || !GUARD_CLOSED;
    frames.push({
      t,
      in: { START, STOP, ESTOP, RESET, GUARD_CLOSED, PE_IN: peIn as 0 | 1, PE_END: peEnd as 0 | 1 },
      out: {
        MOTOR: motorOn as 0 | 1,
        LAMP_GREEN: motorOn as 0 | 1,
        LAMP_AMBER: (!motorOn && !fault ? 1 : 0) as 0 | 1,
        LAMP_RED: (fault || (stuckIn && repaired) ? 1 : 0) as 0 | 1,
      },
      coil: {},
      timer: {},
      boxes: boxes.map((b) => ({ id: b.id, x: b.x, state: b.state })),
      ...(stuckIn ? { stuck: { PE_IN: 1 as const } } : {}),
    });
    if (t === 49.5 && !repaired) violations.push({ rule: 'S7', t, message: 'PE_IN stuck ON is not supervised; infeed keeps running blind' });
    if (t === 29.0 && !repaired) violations.push({ rule: 'S1', t, message: 'E-stop latched, but RESET alone re-arms the line' });
  }
  return { frames, violations };
}

function sample(trace: MockTrace, t: number): { frame: Frame; prev?: Frame } {
  const dt = 0.1;
  const n = trace.frames.length;
  const f = Math.max(0, Math.min(n - 1, Math.floor(t / dt)));
  const a = trace.frames[f];
  const b = trace.frames[Math.min(n - 1, f + 1)];
  const k = Math.max(0, Math.min(1, (t - a.t) / dt));
  const boxes = a.boxes.map((bx) => {
    const nb = b.boxes.find((x) => x.id === bx.id);
    if (nb && nb.state === 'belt' && bx.state === 'belt') return { ...bx, x: bx.x + (nb.x - bx.x) * k };
    return bx;
  });
  return { frame: { ...a, t, boxes }, prev: f > 0 ? trace.frames[f - 1] : undefined };
}

const root = document.getElementById('stage')!;
const params = new URLSearchParams(location.search);
const stage: Stage = createStage(root, { quality: params.get('q') === 'low' ? 'low' : 'high' });
const traces: Record<CellId, MockTrace> = { A: makeTrace(false), B: makeTrace(true) };
let twin = params.get('layout') === 'twin';
stage.setLayout(twin ? 'twin' : 'single', { A: 'BASELINE — as delivered', B: 'REPAIRED — agent v2' });
let t = Number(params.get('t') ?? 0);
let speed = Number(params.get('speed') ?? 1);
let paused = params.get('paused') === '1';
let interactive = false;
const fired = new Set<string>();
stage.onControl((c) => {
  hud(`clicked ${c}`);
});
if (params.get('focus')) stage.focus(params.get('focus') as Parameters<Stage['focus']>[0]);

const hudEl = document.getElementById('hud')!;
let hudMsg = '';
let hudUntil = 0;
function hud(msg: string): void {
  hudMsg = msg;
  hudUntil = performance.now() + 2000;
}

let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;
let fps = 0;
function tick(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 0.5) {
    fps = fpsN / fpsAcc;
    fpsAcc = 0;
    fpsN = 0;
  }
  advance(dt, now);
  requestAnimationFrame(tick);
}

function advance(dt: number, now: number): void {
  const end = traces.A.frames[traces.A.frames.length - 1].t;
  if (!paused) {
    t += dt * speed;
    if (t > end) {
      t = 0;
      fired.clear();
    }
  }
  for (const id of (twin ? ['A', 'B'] : ['A']) as CellId[]) {
    const s = sample(traces[id], t);
    stage.applyFrame(id, s.frame, s.prev);
    for (const v of traces[id].violations) {
      const key = `${id}:${v.rule}:${v.t}`;
      if (t >= v.t && t < v.t + 0.5 && !fired.has(key)) {
        fired.add(key);
        stage.flashViolation(id, v);
      }
    }
  }
  const info = (stage as unknown as { debugInfo?: { calls: number; triangles: number } }).debugInfo;
  hudEl.textContent =
    `t=${t.toFixed(1)}s  x${speed}${paused ? ' (paused)' : ''}  ${fps.toFixed(0)} fps` +
    (info ? `  calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k` : '') +
    `  ${twin ? 'TWIN' : 'SINGLE'}${interactive ? '  INTERACTIVE' : ''}` +
    (now < hudUntil ? `  — ${hudMsg}` : '');
}
requestAnimationFrame(tick);

/** Step the replay and the stage manually (works even when rAF is throttled). */
function devStep(seconds: number, fpsStep = 30): string {
  const n = Math.max(1, Math.round(seconds * fpsStep));
  for (let i = 0; i < n; i++) {
    advance(1 / fpsStep, performance.now());
    (stage as unknown as { debugStep(dt: number): void }).debugStep(1 / fpsStep);
  }
  return hudEl.textContent ?? '';
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  const focusKeys: Record<string, Parameters<Stage['focus']>[0]> = { '1': 'overview', '2': 'infeed', '3': 'pick', '4': 'panel', '5': 'guard', '0': 'auto', a: 'auto' };
  if (focusKeys[k]) {
    stage.focus(focusKeys[k]);
    hud(`focus ${focusKeys[k]}`);
  } else if (k === 't') {
    twin = !twin;
    stage.setLayout(twin ? 'twin' : 'single', { A: 'BASELINE — as delivered', B: 'REPAIRED — agent v2' });
  } else if (k === ' ') {
    paused = !paused;
    e.preventDefault();
  } else if (k === 'i') {
    interactive = !interactive;
    stage.setInteractive(interactive);
  } else if (k === 'arrowright') {
    t += 2;
  } else if (k === 'arrowleft') {
    t = Math.max(0, t - 2);
    fired.clear();
  } else if (k === '+' || k === '=') {
    speed = Math.min(8, speed * 2);
  } else if (k === '-') {
    speed = Math.max(0.25, speed / 2);
  } else if (k === 'r') {
    t = 0;
    fired.clear();
  } else if (k === 'v') {
    stage.flashViolation('A', { rule: 'S6', t, message: 'Box reached the discharge end while the picker was not ready' });
  }
});

Object.assign(window, {
  stage,
  devStep,
  setT: (v: number) => (t = v),
  pause: (p: boolean) => (paused = p),
  setTwin: (v: boolean) => {
    twin = v;
    stage.setLayout(twin ? 'twin' : 'single');
  },
});
