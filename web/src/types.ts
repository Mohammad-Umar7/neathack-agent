// Data contract between the Python agent (agent/export.py) and the web viewer.
// The Python side writes these files into web/public/data/. Keep both sides in sync.

/** web/public/data/manifest.json */
export interface Manifest {
  generated_at: string;
  default_run: string;
  runs: { id: string; label: string; file: string }[];
}

/** Signals. Inputs come from the operator panel and the plant; outputs and coils from the PLC program. */
export const INPUTS = ['START', 'STOP', 'ESTOP', 'RESET', 'GUARD_CLOSED', 'PE_IN', 'PE_END'] as const;
export const OUTPUTS = ['MOTOR', 'LAMP_GREEN', 'LAMP_AMBER', 'LAMP_RED'] as const;
export type InputName = (typeof INPUTS)[number];
export type OutputName = (typeof OUTPUTS)[number];

/** Plant geometry, in metres and seconds. Mirrors agent/plc/plant.py. */
export const PLANT = {
  dt: 0.1, // scan time
  beltLength: 4.0, // belt runs from x=0 (infeed) to x=4.0 (discharge end)
  beltSpeed: 0.5, // m/s while MOTOR=1
  boxLength: 0.4,
  peIn: 0.3, // photo-eye at the infeed
  peEnd: 3.7, // photo-eye at the pick position
  dropX: 3.9, // a box whose centre passes this falls off the end
} as const;

/** One rung of the restricted control language ("ladder-lite"). */
export type Expr =
  | { op: 'var'; name: string }
  | { op: 'timer'; name: string } // T_NAME.Q
  | { op: 'rise'; name: string } // RISE(X): rising edge since the previous scan
  | { op: 'const'; value: boolean }
  | { op: 'not'; arg: Expr }
  | { op: 'and'; args: Expr[] }
  | { op: 'or'; args: Expr[] };

export interface Rung {
  id: string; // stable id, e.g. "R06"
  text: string; // source text, e.g. "RUN = (RISE(START) OR RUN) AND NOT STOP"
  kind: 'assign' | 'set' | 'reset' | 'ton';
  target: string; // coil or timer name
  expr: Expr; // for 'ton' this is the timer's IN condition
  pt?: number; // timer preset in seconds ('ton' only)
  comment?: string;
}

export interface SpecRule {
  id: string; // "S1".."S7", "F1".."F6"
  title: string;
  text: string;
  kind: 'safety' | 'functional';
  method: 'proof' | 'simulation';
}

/** One scan of a simulated scenario. Values are 0/1 so the JSON stays small. */
export interface Frame {
  t: number;
  in: Record<string, 0 | 1>;
  out: Record<string, 0 | 1>;
  coil: Record<string, 0 | 1>;
  timer: Record<string, number>; // elapsed seconds
  boxes: { id: number; x: number; state: 'belt' | 'picked' | 'dropped' }[];
  stuck?: { PE_IN?: 0 | 1; PE_END?: 0 | 1 }; // present while a sensor is forced
}

export interface Violation {
  rule: string; // spec rule id, or "DROP" when a box falls off the end
  t: number;
  message: string;
}

export interface TraceEvent {
  t: number;
  kind: 'press' | 'release' | 'set' | 'spawn' | 'pick' | 'stick' | 'unstick' | 'drop';
  label: string; // human text, e.g. "Operator presses START"
}

export interface Trace {
  dt: number;
  frames: Frame[];
  violations: Violation[];
  events: TraceEvent[];
}

export interface ScenarioPair {
  id: string;
  title: string;
  description: string;
  baseline: Trace; // the program the agent was given
  repaired: Trace; // the program the agent submitted
}

export interface ProofResult {
  rule: string;
  status: 'proven' | 'violated';
  states_explored: number;
  counterexample?: { t: number; in: Record<string, 0 | 1>; out: Record<string, 0 | 1> }[];
}

export interface EvalSummary {
  visible: { pass: number; total: number };
  heldout: { pass: number; total: number };
  proofs: ProofResult[];
  fuzz: { episodes: number; violations: number; by_rule: Record<string, number> };
  faults_fixed: { fixed: number; total: number };
}

export interface StepMetrics {
  visible_pass: number;
  visible_total: number;
  proven: number;
  proof_total: number;
}

export interface Step {
  i: number;
  t: number; // seconds since the run started
  kind: 'think' | 'tool' | 'patch' | 'rollback' | 'submit' | 'error' | 'recover';
  tool?: string;
  title: string; // one line, shown in the timeline
  detail?: string; // longer text: the agent's reasoning or the tool result
  args?: unknown;
  ok?: boolean;
  program_version?: string; // program version in force after this step
  tokens?: number;
  cost_usd?: number;
  metrics?: StepMetrics;
}

/** web/public/data/runs/<id>.json */
export interface RunFile {
  id: string;
  label: string;
  agent: 'v1' | 'v2';
  model: string;
  provider: string;
  started_at: string;
  duration_s: number;
  tokens: { input: number; output: number };
  cost_usd: number;
  neatlogs_url?: string;
  spec: SpecRule[];
  programs: Record<string, Rung[]>; // "v0" is the baseline, then one version per accepted patch
  final_version: string;
  steps: Step[];
  eval: { baseline: EvalSummary; repaired: EvalSummary };
  scenarios: ScenarioPair[];
}
