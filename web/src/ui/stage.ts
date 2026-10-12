/// <reference types="vite/client" />
// The 3D stage lives in ../scene (owned by the scene module). This file mirrors its interface and
// loads it lazily: import.meta.glob resolves to {} while ../scene/index.ts does not exist, so the
// build never breaks and the real stage takes over automatically as soon as it lands.

import type { Frame, Violation } from '../types';
import { createStubStage } from './stageStub';

export type CellId = 'A' | 'B';
export type PanelControl = 'START' | 'STOP' | 'RESET' | 'ESTOP' | 'GUARD';
export type FocusTarget = 'overview' | 'infeed' | 'pick' | 'panel' | 'guard' | 'auto';

export interface Stage {
  setLayout(layout: 'single' | 'twin', labels?: { A: string; B: string }): void;
  applyFrame(cell: CellId, frame: Frame, prev?: Frame): void;
  flashViolation(cell: CellId, v: Violation): void;
  focus(target: FocusTarget): void;
  onControl(cb: (c: PanelControl) => void): void;
  setInteractive(on: boolean): void;
  resize(): void;
  dispose(): void;
}

type StageFactory = (container: HTMLElement, opts?: { quality?: 'high' | 'low' }) => Stage;

const sceneModules = import.meta.glob('../scene/index.ts');

/** Wrap a stage so an exception inside the scene never takes the UI down with it. */
function guarded(stage: Stage): Stage {
  const warned = new Set<string>();
  const wrap =
    <A extends unknown[]>(name: string, fn: (...a: A) => void) =>
    (...a: A): void => {
      try {
        fn(...a);
      } catch (e) {
        if (!warned.has(name)) {
          warned.add(name);
          console.warn(`[stage] ${name} failed`, e);
        }
      }
    };
  return {
    setLayout: wrap('setLayout', (l, labels) => stage.setLayout(l, labels)),
    applyFrame: wrap('applyFrame', (c, f, p) => stage.applyFrame(c, f, p)),
    flashViolation: wrap('flashViolation', (c, v) => stage.flashViolation(c, v)),
    focus: wrap('focus', (t) => stage.focus(t)),
    onControl: wrap('onControl', (cb) => stage.onControl(cb)),
    setInteractive: wrap('setInteractive', (on) => stage.setInteractive(on)),
    resize: wrap('resize', () => stage.resize()),
    dispose: wrap('dispose', () => stage.dispose()),
  };
}

export async function loadStage(
  container: HTMLElement,
  opts: { quality?: 'high' | 'low'; force2d?: boolean } = {},
): Promise<{ stage: Stage; real: boolean }> {
  const loader = sceneModules['../scene/index.ts'];
  if (loader && !opts.force2d) {
    try {
      const mod = (await loader()) as { createStage?: StageFactory };
      if (typeof mod.createStage === 'function') {
        const stage = mod.createStage(container, { quality: opts.quality ?? 'high' });
        return { stage: guarded(stage), real: true };
      }
    } catch (e) {
      console.warn('[stage] 3D scene failed to load, using the 2D schematic', e);
      container.replaceChildren();
    }
  }
  return { stage: guarded(createStubStage(container)), real: false };
}
