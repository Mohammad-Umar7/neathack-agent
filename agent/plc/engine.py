"""PLC scan engine, conveyor plant and safety monitors. Mirrors web/src/sim (plc.ts, plant.ts,
monitors.ts); scripts/parity checks both sides produce identical traces.

Scan semantics: rungs run top to bottom every scan; an expression reads the current memory (a coil
written by an earlier rung this scan is already updated); RISE(X) compares against the memory
snapshot taken at the end of the previous scan.
"""

from __future__ import annotations

from .lang import INPUTS, OUTPUTS, expr_refs

DT = 0.1


def initial_inputs() -> dict[str, int]:
    m = {n: 0 for n in INPUTS}
    m["GUARD_CLOSED"] = 1
    return m


def compile_expr(e: dict):
    """Compile an expression AST into a function of the PLC (fast enough for model checking)."""
    op = e["op"]
    if op == "var":
        n = e["name"]
        return lambda m: m.sig.get(n, 0) == 1
    if op == "timer":
        n = e["name"]
        return lambda m: m.timer_q(n)
    if op == "rise":
        n = e["name"]
        return lambda m: m.sig.get(n, 0) == 1 and m.prev.get(n, 0) != 1
    if op == "const":
        v = bool(e["value"])
        return lambda m: v
    if op == "not":
        f = compile_expr(e["arg"])
        return lambda m: not f(m)
    fs = [compile_expr(a) for a in e["args"]]
    if op == "and":
        return lambda m: all(f(m) for f in fs)
    return lambda m: any(f(m) for f in fs)


def program_coils(rungs: list[dict]) -> list[str]:
    """Internal coils (not inputs, outputs or timers), in order of first appearance."""
    out: list[str] = []

    def add(n: str) -> None:
        if n not in INPUTS and n not in OUTPUTS and n not in out:
            out.append(n)

    for r in rungs:
        if r["kind"] != "ton":
            add(r["target"])
    for r in rungs:
        for n in expr_refs(r["expr"])[0]:
            add(n)
    return out


def program_timers(rungs: list[dict]) -> list[tuple[str, float]]:
    out: list[tuple[str, float]] = []
    for r in rungs:
        if r["kind"] == "ton" and all(t[0] != r["target"] for t in out):
            out.append((r["target"], float(r.get("pt", 0.0))))
    return out


class Plc:
    def __init__(self, rungs: list[dict]):
        self.rungs = rungs
        self.coils = program_coils(rungs)
        self.timer_defs = program_timers(rungs)
        self.compiled = [(r["kind"], r["target"], compile_expr(r["expr"]), float(r.get("pt", 0.0))) for r in rungs]
        self.sig: dict[str, int] = dict(initial_inputs())
        self.prev: dict[str, int] = dict(initial_inputs())
        for n in OUTPUTS:
            self.sig[n] = self.prev[n] = 0
        for n in self.coils:
            self.sig[n] = self.prev[n] = 0
        # timer name -> [et, q]
        self.timers: dict[str, list] = {n: [0.0, False] for n, _ in self.timer_defs}

    def timer_q(self, name: str) -> bool:
        t = self.timers.get(name)
        return bool(t and t[1])

    def scan(self, inputs: dict[str, int], dt: float = DT) -> None:
        for n in INPUTS:
            self.sig[n] = 1 if inputs.get(n) == 1 else 0
        for kind, target, f, pt in self.compiled:
            v = f(self)
            if kind == "assign":
                self.sig[target] = 1 if v else 0
            elif kind == "set":
                if v:
                    self.sig[target] = 1
            elif kind == "reset":
                if v:
                    self.sig[target] = 0
            else:  # ton
                tm = self.timers[target]
                tm[0] = min(tm[0] + dt, pt) if v else 0
                tm[1] = tm[0] >= pt - 1e-9
        self.prev = dict(self.sig)

    def outputs(self) -> dict[str, int]:
        return {n: (1 if self.sig.get(n) == 1 else 0) for n in OUTPUTS}

    def coil_values(self) -> dict[str, int]:
        return {n: (1 if self.sig.get(n) == 1 else 0) for n in self.coils}

    def timer_values(self) -> dict[str, float]:
        return {n: self.timers[n][0] for n, _ in self.timer_defs}


# ---------------------------------------------------------------- plant (integer millimetres)

GEO = {
    "belt_end": 4000,
    "step": 50,  # mm per scan while MOTOR = 1 (0.5 m/s at dt = 0.1 s)
    "box_len": 400,
    "spawn_x": 200,
    "pe_in": 300,
    "pe_end": 3700,
    "sense": 200,  # a photo-eye sees a box whose centre is within this distance
    "drop_x": 3900,
    "pick_x": 3700,
    "pick_half": 250,
}


class Plant:
    def __init__(self) -> None:
        self.boxes: list[dict] = []
        self.next_id = 1
        self.stuck: dict[str, int] = {}

    def infeed_clear(self) -> bool:
        return not any(b["state"] == "belt" and abs(b["x"] - GEO["spawn_x"]) < GEO["box_len"] for b in self.boxes)

    def spawn(self) -> dict | None:
        if not self.infeed_clear():
            return None
        b = {"id": self.next_id, "x": GEO["spawn_x"], "state": "belt"}
        self.next_id += 1
        self.boxes.append(b)
        return b

    def at_pick(self) -> dict | None:
        best = None
        for b in self.boxes:
            if b["state"] == "belt" and abs(b["x"] - GEO["pick_x"]) <= GEO["pick_half"] and (best is None or b["x"] > best["x"]):
                best = b
        return best

    def pick(self) -> dict | None:
        b = self.at_pick()
        if b:
            b["state"] = "picked"
        return b

    def sees(self, pos: int) -> int:
        return 1 if any(b["state"] == "belt" and abs(b["x"] - pos) <= GEO["sense"] for b in self.boxes) else 0

    def sensors(self) -> dict[str, int]:
        return {
            "PE_IN": self.stuck.get("PE_IN", self.sees(GEO["pe_in"])),
            "PE_END": self.stuck.get("PE_END", self.sees(GEO["pe_end"])),
        }

    def move(self) -> list[dict]:
        belt = sorted((b for b in self.boxes if b["state"] == "belt"), key=lambda b: -b["x"])
        dropped = []
        ahead = None
        for b in belt:
            nx = b["x"] + GEO["step"]
            if ahead is not None:
                nx = min(nx, ahead["x"] - GEO["box_len"])
            b["x"] = nx
            if b["x"] > GEO["drop_x"]:
                b["state"] = "dropped"
                dropped.append(b)
            ahead = b
        return dropped

    def snapshot(self) -> list[dict]:
        return [{"id": b["id"], "x": b["x"] / 1000, "state": b["state"]} for b in self.boxes]


# ---------------------------------------------------------------- safety monitors

RULE_IDS = ("S1", "S2", "S3", "S4", "S5", "S6", "S7")
RULE_MESSAGES = {
    "S1": "Motor running while the E-stop is pressed",
    "S2": "Motor running with the guard door open",
    "S3": "Motor running while STOP is pressed",
    "S4": "Motor restarted without a START press",
    "S5": "E-stop cleared without RESET",
    "S6": "Motor running with a box at the pick position",
    "S7": "Infeed jam not detected within 3.5 s",
}


def monitor_conditions(state: tuple, inp: dict, out: dict) -> tuple[tuple, dict[str, bool]]:
    """Pure observer step shared by the simulator and the model checker.

    state = (armed, lock, jam, prev_start, prev_reset). Returns (new_state, rule -> violated)."""
    armed, lock, jam, prev_start, prev_reset = state
    START = inp["START"] == 1
    STOP = inp["STOP"] == 1
    ESTOP = inp["ESTOP"] == 1
    RESET = inp["RESET"] == 1
    GUARD = inp["GUARD_CLOSED"] == 1
    PE_IN = inp["PE_IN"] == 1
    PE_END = inp["PE_END"] == 1
    MOTOR = out["MOTOR"] == 1
    RED = out["LAMP_RED"] == 1
    rise_start = START and prev_start == 0
    rise_reset = RESET and prev_reset == 0
    lock_b = (lock == 1 or ESTOP) and not ((not ESTOP) and rise_reset)
    armed_b = (armed == 1 or (rise_start and not lock_b)) and not STOP and not ESTOP and GUARD and not RED
    jam = jam + 1 if (MOTOR and PE_IN) else 0
    cond = {
        "S1": ESTOP and MOTOR,
        "S2": (not GUARD) and MOTOR,
        "S3": STOP and MOTOR,
        "S4": MOTOR and not armed_b,
        "S5": lock_b and (MOTOR or not RED),
        "S6": PE_END and MOTOR,
        "S7": jam > 35,
    }
    return (1 if armed_b else 0, 1 if lock_b else 0, jam, 1 if START else 0, 1 if RESET else 0), cond


class Monitor:
    def __init__(self) -> None:
        self.state = (0, 0, 0, 0, 0)
        self.active: dict[str, bool] = {}

    def check(self, t: float, inp: dict, out: dict) -> list[dict]:
        self.state, cond = monitor_conditions(self.state, inp, out)
        found = []
        for rid in RULE_IDS:
            v = cond[rid]
            if v and not self.active.get(rid):
                found.append({"rule": rid, "t": t, "message": RULE_MESSAGES[rid]})
            self.active[rid] = v
        return found
