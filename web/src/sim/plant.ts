// Conveyor plant in integer millimetres (exact parity with agent/plc/plant.py).

import type { Bit } from './plc';

export type BoxState = 'belt' | 'picked' | 'dropped';
export interface PlantBox {
  id: number;
  x: number; // centre, mm
  state: BoxState;
}

export const GEO = {
  beltEnd: 4000,
  step: 50, // mm per scan while MOTOR = 1 (0.5 m/s at dt = 0.1 s)
  boxLen: 400,
  spawnX: 200,
  peIn: 300,
  peEnd: 3700,
  sense: 200, // a photo-eye sees a box whose centre is within this distance
  dropX: 3900,
  pickX: 3700,
  pickHalf: 250,
} as const;

export type Sensor = 'PE_IN' | 'PE_END';

/**
 * Details the written spec leaves open. The defaults are our best reading of agent/plc;
 * scripts/parity.ts tries the alternatives when a golden trace disagrees and reports which one matches.
 */
export const CONVENTIONS = {
  firstBoxId: 1, // id of the first box spawned
  autopickExtraScans: 0, // autopick fires after round(N / dt) + this many waiting scans
  explicitSpawnResetsAutofeed: false, // does a scripted spawn restart the autofeed interval?
};

export class Plant {
  boxes: PlantBox[] = [];
  nextId = CONVENTIONS.firstBoxId;
  stuck: Partial<Record<Sensor, Bit>> = {};

  infeedClear(): boolean {
    return !this.boxes.some((b) => b.state === 'belt' && Math.abs(b.x - GEO.spawnX) < GEO.boxLen);
  }

  spawn(): PlantBox | null {
    if (!this.infeedClear()) return null;
    const b: PlantBox = { id: this.nextId++, x: GEO.spawnX, state: 'belt' };
    this.boxes.push(b);
    return b;
  }

  /** The belt box at the pick position (the leading one if two qualify). */
  atPick(): PlantBox | undefined {
    let best: PlantBox | undefined;
    for (const b of this.boxes)
      if (b.state === 'belt' && Math.abs(b.x - GEO.pickX) <= GEO.pickHalf && (!best || b.x > best.x)) best = b;
    return best;
  }

  pick(): PlantBox | null {
    const b = this.atPick();
    if (!b) return null;
    b.state = 'picked';
    return b;
  }

  sees(pos: number): Bit {
    return this.boxes.some((b) => b.state === 'belt' && Math.abs(b.x - pos) <= GEO.sense) ? 1 : 0;
  }

  sensors(): Record<Sensor, Bit> {
    return {
      PE_IN: this.stuck.PE_IN ?? this.sees(GEO.peIn),
      PE_END: this.stuck.PE_END ?? this.sees(GEO.peEnd),
    };
  }

  /** Move every belt box one scan forward. Returns the boxes that fell off the end. */
  move(): PlantBox[] {
    const belt = this.boxes.filter((b) => b.state === 'belt').sort((a, b) => b.x - a.x);
    const dropped: PlantBox[] = [];
    let ahead: PlantBox | null = null;
    for (const b of belt) {
      let nx = b.x + GEO.step;
      if (ahead) nx = Math.min(nx, ahead.x - GEO.boxLen);
      b.x = nx;
      if (b.x > GEO.dropX) {
        b.state = 'dropped';
        dropped.push(b);
      }
      ahead = b;
    }
    return dropped;
  }

  snapshot(): { id: number; x: number; state: BoxState }[] {
    return this.boxes.map((b) => ({ id: b.id, x: b.x / 1000, state: b.state }));
  }
}
