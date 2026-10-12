// Trace playback clock with smooth (interpolated) frames for the stage.

import type { Frame, Trace, Violation } from '../types';

export class Player {
  A: Trace | null = null;
  B: Trace | null = null;
  pos = 0;
  playing = false;
  speed = 1;
  loop = true;

  load(A: Trace | null, B: Trace | null = null, keepPos = false): void {
    this.A = A;
    this.B = B;
    if (!keepPos) this.pos = 0;
    this.pos = Math.min(this.pos, Math.max(0, this.duration - 0.1));
  }

  get duration(): number {
    const d = (t: Trace | null): number => (t ? t.frames.length * t.dt : 0);
    return Math.max(d(this.A), d(this.B));
  }

  /** Advance by real seconds. Returns true if the clock wrapped around. */
  advance(realDt: number): boolean {
    if (!this.playing || !this.A) return false;
    this.pos += realDt * this.speed;
    const dur = this.duration;
    if (this.pos >= dur) {
      if (this.loop) {
        this.pos = 0;
        return true;
      }
      this.pos = Math.max(0, dur - 1e-6);
      this.playing = false;
    }
    return false;
  }
}

export function frameIndex(tr: Trace, pos: number): number {
  return Math.max(0, Math.min(tr.frames.length - 1, Math.floor((pos + 1e-6) / tr.dt)));
}

/** Frame at a fractional time: discrete values of scan k, box positions eased toward scan k+1. */
export function interpolate(tr: Trace, pos: number): { frame: Frame; k: number } {
  const k = frameIndex(tr, pos);
  const f = tr.frames[k];
  const n = tr.frames[k + 1];
  const frac = Math.max(0, Math.min(1, pos / tr.dt - k));
  if (!n || frac <= 0) return { frame: f, k };
  const boxes = f.boxes.map((b) => {
    if (b.state !== 'belt') return b;
    const nb = n.boxes.find((x) => x.id === b.id);
    if (!nb || nb.x === b.x) return b;
    return { ...b, x: b.x + (nb.x - b.x) * frac };
  });
  return { frame: { ...f, t: Math.round((f.t + frac * tr.dt) * 1000) / 1000, boxes }, k };
}

/** Violations whose time lies in [from, to). */
export function crossed(tr: Trace | null, from: number, to: number): Violation[] {
  if (!tr || to <= from) return [];
  return tr.violations.filter((v) => v.t >= from - 1e-9 && v.t < to - 1e-9);
}
