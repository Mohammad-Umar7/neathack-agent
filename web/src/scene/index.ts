// Public API of the 3D digital twin. The UI codes against exactly this surface.
import type { Frame, Violation } from '../types';
import { StageImpl } from './stage';

export type CellId = 'A' | 'B';
export type PanelControl = 'START' | 'STOP' | 'RESET' | 'ESTOP' | 'GUARD';
export interface StageOptions {
  quality?: 'high' | 'low';
}
export interface Stage {
  /** Show one cell, or two side-by-side twin cells ("A" = BASELINE, "B" = REPAIRED) with floating labels. */
  setLayout(layout: 'single' | 'twin', labels?: { A: string; B: string }): void;
  /** Apply a simulation frame to a cell. Called every animation frame during replay with interpolated time; must be cheap. prev is the previous frame (for edges). */
  applyFrame(cell: CellId, frame: Frame, prev?: Frame): void;
  /** Visual alarm for a safety violation (red flash/pulse at the relevant spot + floating tag). */
  flashViolation(cell: CellId, v: Violation): void;
  /** Camera presets with smooth easing. 'auto' = slow cinematic orbit. */
  focus(target: 'overview' | 'infeed' | 'pick' | 'panel' | 'guard' | 'auto'): void;
  /** Called when the user clicks a control on the operator panel (or the guard door) in cell A. */
  onControl(cb: (c: PanelControl) => void): void;
  /** Whether panel clicks are enabled (true in interactive "Play" mode). */
  setInteractive(on: boolean): void;
  resize(): void;
  dispose(): void;
}

export function createStage(container: HTMLElement, opts?: StageOptions): Stage {
  return new StageImpl(container, opts ?? {});
}
