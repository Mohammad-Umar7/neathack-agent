// Cell dimensions in metres, in "plant" coordinates: x runs along the belt exactly as in
// the simulation (0 = infeed, 4.0 = discharge end), y is up, z is across the belt
// (+z = operator / camera side).
import { PLANT } from '../types';

export const BELT_LEN = PLANT.beltLength; // 4.0
export const BELT_SPEED = PLANT.beltSpeed; // 0.5 m/s
export const BELT_TOP = 0.86; // top surface of the carrying strand
export const BELT_THK = 0.008;
export const BELT_HALF_W = 0.25;
export const DRUM_R = 0.07;
export const DRUM_Y = BELT_TOP - BELT_THK - DRUM_R; // drum axis height
export const ROLLER_R = 0.025;
export const ROLLER_Y = BELT_TOP - BELT_THK - ROLLER_R;
export const ROLLER_HALF_LEN = 0.305;
export const RAIL_Z = 0.3325; // rail centre (45 mm wide profile, inner face at 0.31)
export const RAIL_TOP = ROLLER_Y + 0.006;
export const RAIL_Y = RAIL_TOP - 0.045; // centre of the 45x90 profile
export const RAIL_X0 = -0.12;
export const RAIL_X1 = BELT_LEN + 0.12;

export const BOX_L = PLANT.boxLength; // 0.4 along x
export const BOX_W = 0.3; // across the belt
export const BOX_H = 0.25;

export const PE_IN_X = PLANT.peIn;
export const PE_END_X = PLANT.peEnd;
export const PE_Y = BELT_TOP + 0.11;
export const PE_Z_SENSOR = 0.4;
export const PE_Z_REFLECTOR = -0.385;
export const PICK_X = PLANT.peEnd;

// fence footprint
export const FX0 = -0.75;
export const FX1 = 5.25;
export const FZ0 = -1.95;
export const FZ1 = 1.3;
export const FENCE_BOTTOM = 0.15;
export const FENCE_TOP = 1.95;
export const POST = 0.06;

// guard door (front fence)
export const DOOR_X0 = 2.75; // hinge post centre
export const DOOR_X1 = 3.9; // latch post centre

// operator panel (outside the fence, facing +z)
export const PANEL_X = 0.85;
export const PANEL_Z = 1.95;
export const PANEL_BASE_Y = 0.98;

// gantry
export const GANTRY_Z_FRONT = 0.98;
export const GANTRY_Z_BACK = -1.8;
export const GANTRY_BEAM_Y = 2.25;
export const HEAD_PARK_Y = 1.66; // underside of the suction cups when parked
export const PALLET_X = PICK_X;
export const PALLET_Z = -1.12;
export const PALLET_TOP = 0.144;
export const PALLET_SLOTS_Z = [-0.8, -1.12, -1.44];

/** Centre of the cell footprint in plant coordinates; cell content is offset by this. */
export const CELL_CENTER_X = 2.2;
export const CELL_CENTER_Z = 0.1;
