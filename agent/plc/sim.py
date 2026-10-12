"""The digital twin: PLC + conveyor plant + safety monitors, stepped one scan at a time.
Mirrors web/src/sim/sim.ts. A scenario is a script of timed operator actions and plant events."""

from __future__ import annotations

from .engine import DT, Monitor, Plant, Plc, initial_inputs
from .lang import OUTPUTS

PRESS_LABEL = {
    "START": "Operator presses START",
    "STOP": "Operator presses STOP",
    "RESET": "Operator presses RESET",
    "ESTOP": "E-stop pressed",
}


def round1(x: float) -> float:
    # Math.round(x * 10) / 10 in JS (round half up), for parity with the viewer.
    import math

    return math.floor(x * 10 + 0.5) / 10


def _set_label(name: str, v: int) -> str:
    if name == "ESTOP":
        return "E-stop pressed" if v else "E-stop released"
    if name == "GUARD_CLOSED":
        return "Guard door closed" if v else "Guard door opened"
    return f"Operator holds {name}" if v else f"Operator releases {name}"


class Sim:
    def __init__(self, program: list[dict], autofeed_every: float | None = None, autopick_after: float | None = None):
        self.plc = Plc(program)
        self.plant = Plant()
        self.mon = Monitor()
        self.inputs = initial_inputs()
        self.k = 0
        self.autofeed_every = autofeed_every
        self.autopick_after = autopick_after
        self.last_out = {n: 0 for n in OUTPUTS}
        self.pick_wait = 0
        self.releases: list[tuple[str, float]] = []
        self.last_spawn_t = float("-inf")
        self.pending: list[dict] = []

    @property
    def t(self) -> float:
        return round1(self.k * DT)

    def _ev(self, kind: str, label: str) -> None:
        self.pending.append({"t": self.t, "kind": kind, "label": label})

    def press(self, name: str, duration: float = 0.3, start: float | None = None) -> None:
        start = self.t if start is None else start
        self.releases = [r for r in self.releases if r[0] != name]
        self.inputs[name] = 1
        self.releases.append((name, start + duration))
        self._ev("press", PRESS_LABEL.get(name, f"Operator presses {name}"))

    def set(self, name: str, v: int) -> None:
        if self.inputs.get(name) == v:
            return
        self.inputs[name] = v
        self._ev("set", _set_label(name, v))

    def spawn(self) -> bool:
        b = self.plant.spawn()
        if b:
            self._ev("spawn", "Box placed on infeed")
        return b is not None

    def pick(self) -> bool:
        b = self.plant.pick()
        if b:
            self._ev("pick", "Robot picks box")
        return b is not None

    def stick(self, sensor: str, v: int) -> None:
        self.plant.stuck[sensor] = v
        self._ev("stick", f"{sensor} sensor stuck {'ON' if v else 'OFF'}")

    def unstick(self, sensor: str) -> None:
        if sensor not in self.plant.stuck:
            return
        del self.plant.stuck[sensor]
        self._ev("unstick", f"{sensor} sensor repaired")

    def apply_event(self, e: dict) -> None:
        kind = e["kind"]
        if kind == "press" and e.get("input"):
            self.press(e["input"], e.get("duration", 0.3), e["t"])
        elif kind == "set" and e.get("input"):
            self.set(e["input"], e.get("value", 1))
        elif kind == "spawn":
            self.spawn()
        elif kind == "pick":
            self.pick()
        elif kind == "stick" and e.get("sensor"):
            self.stick(e["sensor"], e.get("value", 1))
        elif kind == "unstick" and e.get("sensor"):
            self.unstick(e["sensor"])

    def step(self, apply_events=None) -> tuple[dict, list[dict], list[dict]]:
        t = self.t
        keep = []
        for name, at in self.releases:
            if t >= at:
                self.inputs[name] = 0
                self._ev("release", f"{name} released")
            else:
                keep.append((name, at))
        self.releases = keep
        if apply_events:
            apply_events(self, t)
        feed = self.autofeed_every
        if feed is not None and feed > 0 and t - self.last_spawn_t >= feed and self.plant.infeed_clear():
            if self.spawn():
                self.last_spawn_t = t
        pick_after = self.autopick_after
        if pick_after is not None and pick_after >= 0:
            b = self.plant.at_pick()
            if b and self.last_out["MOTOR"] == 0:
                self.pick_wait += 1
                if self.pick_wait >= round(pick_after / DT):
                    self.pick()
                    self.pick_wait = 0
            else:
                self.pick_wait = 0

        s = self.plant.sensors()
        self.inputs["PE_IN"] = s["PE_IN"]
        self.inputs["PE_END"] = s["PE_END"]

        self.plc.scan(self.inputs, DT)
        out = self.plc.outputs()
        violations = self.mon.check(t, self.inputs, out)

        frame = {
            "t": t,
            "in": dict(self.inputs),
            "out": out,
            "coil": self.plc.coil_values(),
            "timer": self.plc.timer_values(),
            "boxes": self.plant.snapshot(),
        }
        if self.plant.stuck:
            frame["stuck"] = dict(self.plant.stuck)

        if out["MOTOR"] == 1:
            for b in self.plant.move():
                violations.append({"rule": "DROP", "t": t, "message": f"Box #{b['id']} pushed off the end of the belt"})
                self._ev("drop", f"Box #{b['id']} falls off the end")
        self.last_out = out
        self.k += 1
        events, self.pending = self.pending, []
        return frame, violations, events


def run_scenario(program: list[dict], sc: dict) -> dict:
    """Run a scripted scenario and record its full trace (see Trace in web/src/types.ts)."""
    opts = sc.get("options") or {}
    sim = Sim(program, opts.get("autofeed_every"), opts.get("autopick_after"))
    n = round(sc["duration"] / DT)
    applied = [False] * len(sc["events"])

    def apply(s: Sim, t: float) -> None:
        for i, e in enumerate(sc["events"]):
            if not applied[i] and e["t"] <= t + 1e-9:
                applied[i] = True
                s.apply_event(e)

    trace = {"dt": DT, "frames": [], "violations": [], "events": []}
    for _ in range(n):
        frame, violations, events = sim.step(apply)
        trace["frames"].append(frame)
        trace["violations"].extend(violations)
        trace["events"].extend(events)
    return trace
