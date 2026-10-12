"""Verification: scripted tests, randomized fuzzing, and a model checker that proves safety rules.

The model checker explores every reachable state of the PLC program under every possible input in
every scan (all 7 inputs are free, so stuck sensors and any operator behaviour are covered). Timers are
abstracted: a running timer may finish at any later scan. That over-approximates real timing, so a
rule proven here holds for every input sequence of any length and every timer preset."""

from __future__ import annotations

import itertools
from collections import deque

from .engine import DT, compile_expr, initial_inputs, monitor_conditions, program_coils, program_timers
from .lang import INPUTS, OUTPUTS, expr_refs
from .sim import run_scenario

SAFETY_RULES = ("S1", "S2", "S3", "S4", "S5", "S6", "S7")
PROOF_RULES = ("S1", "S2", "S3", "S4", "S5", "S6")


# ---------------------------------------------------------------- scripted tests

def run_test(program: list[dict], test: dict) -> dict:
    trace = run_scenario(program, test)
    frames = trace["frames"]
    failures = []
    for ex in test["expect"]:
        k = min(range(len(frames)), key=lambda i: abs(frames[i]["t"] - ex["t"]))
        f = frames[k]
        got = f["in"].get(ex["sig"], f["out"].get(ex["sig"], f["coil"].get(ex["sig"])))
        if got != ex["val"]:
            failures.append({"t": ex["t"], "kind": "expect", "message": f"expected {ex['sig']}={ex['val']} at t={ex['t']}s, got {got}"})
    for v in trace["violations"]:
        failures.append({"t": v["t"], "kind": "violation", "rule": v["rule"], "message": f"{v['rule']} violated at t={v['t']}s: {v['message']}"})
    picked = sum(1 for b in (frames[-1]["boxes"] if frames else []) if b["state"] == "picked")
    if picked < test.get("min_picked", 0):
        failures.append({"t": test["duration"], "kind": "expect", "message": f"expected at least {test['min_picked']} box(es) picked, got {picked}"})
    failures.sort(key=lambda x: x["t"])
    return {"id": test["id"], "title": test["title"], "passed": not failures, "failures": failures, "trace": trace}


def run_suite(program: list[dict], tests: list[dict]) -> list[dict]:
    return [run_test(program, t) for t in tests]


def fuzz(program: list[dict], scenarios: list[dict]) -> dict:
    by_rule: dict[str, int] = {}
    bad_episodes = 0
    first: dict[str, dict] = {}
    for sc in scenarios:
        tr = run_scenario(program, sc)
        rules = {v["rule"] for v in tr["violations"]}
        if rules:
            bad_episodes += 1
        for v in tr["violations"]:
            by_rule[v["rule"]] = by_rule.get(v["rule"], 0) + 1
            first.setdefault(v["rule"], {"scenario": sc["id"], "t": v["t"], "message": v["message"]})
    return {"episodes": len(scenarios), "violations": bad_episodes, "by_rule": by_rule, "examples": first}


def trace_window(trace: dict, t_from: float, t_to: float, signals: list[str] | None = None) -> str:
    """A compact scan table for the agent: one line per scan in [t_from, t_to]."""
    frames = [f for f in trace["frames"] if t_from - 1e-9 <= f["t"] <= t_to + 1e-9]
    if not frames:
        return "(no scans in that window)"
    default = list(INPUTS) + list(OUTPUTS)
    coils = list(frames[0]["coil"].keys())
    timers = list(frames[0]["timer"].keys())
    cols = signals or (default + coils)
    head = "t     " + " ".join(f"{c[:8]:>8}" for c in cols) + "".join(f" {tn:>8}" for tn in timers) + "  boxes(x m)"
    lines = [head]
    for f in frames:
        vals = []
        for c in cols:
            v = f["in"].get(c, f["out"].get(c, f["coil"].get(c, "?")))
            vals.append(f"{v:>8}")
        tv = "".join(f" {f['timer'][tn]:>8.1f}" for tn in timers)
        boxes = ",".join(f"{b['x']:.2f}{'' if b['state'] == 'belt' else '(' + b['state'] + ')'}" for b in f["boxes"]) or "-"
        lines.append(f"{f['t']:<5.1f} " + " ".join(vals) + tv + f"  {boxes}")
    return "\n".join(lines)


# ---------------------------------------------------------------- model checker

OFF, RUNNING, DONE = 0, 1, 2


class _Mem:
    __slots__ = ("sig", "prev", "tq")

    def __init__(self, sig, prev, tq):
        self.sig = sig
        self.prev = prev
        self.tq = tq

    def timer_q(self, name):
        return self.tq.get(name, OFF) == DONE


def prove(program: list[dict], max_states: int = 250_000) -> dict:
    coils = program_coils(program)
    timers = program_timers(program)
    pts = dict(timers)
    tnames = [t for t, _ in timers]
    state_sigs = list(OUTPUTS) + coils
    rise_inputs = sorted({n for r in program for n in _rise_names(r["expr"]) if n in INPUTS} | {"START", "RESET"})
    rungs = [(r["kind"], r["target"], compile_expr(r["expr"])) for r in program]
    init_in = initial_inputs()

    init = (tuple(0 for _ in state_sigs), tuple(init_in[n] for n in rise_inputs), tuple(OFF for _ in tnames), (0, 0))
    vectors = [dict(zip(INPUTS, bits)) for bits in itertools.product((0, 1), repeat=len(INPUTS))]

    def successors(state, inp):
        sig_bits, prev_bits, tstates, mon = state
        sig = dict(zip(state_sigs, sig_bits))
        prev = dict(zip(state_sigs, sig_bits))
        prev.update(zip(rise_inputs, prev_bits))
        for n in INPUTS:
            prev.setdefault(n, init_in[n])
        sig.update(inp)
        results = []

        def run(i, sig, tq):
            while i < len(rungs):
                kind, target, f = rungs[i]
                v = f(_Mem(sig, prev, tq))
                if kind == "assign":
                    sig[target] = 1 if v else 0
                elif kind == "set":
                    if v:
                        sig[target] = 1
                elif kind == "reset":
                    if v:
                        sig[target] = 0
                else:
                    cur = tq[target]
                    if not v:
                        tq[target] = OFF
                    elif cur == OFF:
                        tq[target] = DONE if pts[target] <= DT + 1e-9 else RUNNING
                    elif cur == RUNNING:
                        # Abstract time: the timer may still be running, or may have just finished.
                        sig2, tq2 = dict(sig), dict(tq)
                        tq2[target] = DONE
                        run(i + 1, sig2, tq2)
                        tq[target] = RUNNING
                i += 1
            results.append((sig, tq))

        run(0, sig, dict(zip(tnames, tstates)))
        out = []
        for sig2, tq2 in results:
            outs = {n: sig2.get(n, 0) for n in OUTPUTS}
            mstate, cond = monitor_conditions((mon[0], mon[1], 0, prev.get("START", 0), prev.get("RESET", 0)), inp, outs)
            nxt = (tuple(sig2.get(n, 0) for n in state_sigs), tuple(inp[n] for n in rise_inputs), tuple(tq2[t] for t in tnames), (mstate[0], mstate[1]))
            out.append((nxt, outs, cond))
        return out

    parent: dict = {init: None}
    queue = deque([init])
    found: dict[str, tuple] = {}
    motor_reachable = False
    explored = 0
    while queue and len(parent) < max_states:
        s = queue.popleft()
        explored += 1
        for inp in vectors:
            for nxt, outs, cond in successors(s, inp):
                if outs["MOTOR"]:
                    motor_reachable = True
                for rid in PROOF_RULES:
                    if cond[rid] and rid not in found:
                        found[rid] = (s, inp, outs)
                if nxt not in parent:
                    parent[nxt] = (s, inp, outs)
                    queue.append(nxt)
    complete = not queue

    def path_to(s, last_inp, last_out):
        steps = []
        while parent[s] is not None:
            ps, pinp, pout = parent[s]
            steps.append((pinp, pout))
            s = ps
        steps.reverse()
        steps.append((last_inp, last_out))
        return [{"t": round(i * DT, 1), "in": dict(inp), "out": dict(out)} for i, (inp, out) in enumerate(steps)]

    results = []
    for rid in PROOF_RULES:
        if rid in found:
            s, inp, outs = found[rid]
            results.append({"rule": rid, "status": "violated", "states_explored": len(parent), "counterexample": path_to(s, inp, outs)})
        else:
            results.append({"rule": rid, "status": "proven" if complete else "bounded", "states_explored": len(parent)})
    return {"complete": complete, "states": len(parent), "motor_reachable": motor_reachable, "results": results}


def _rise_names(e: dict) -> list[str]:
    if e["op"] == "rise":
        return [e["name"]]
    if e["op"] == "not":
        return _rise_names(e["arg"])
    if e["op"] in ("and", "or"):
        return [n for a in e["args"] for n in _rise_names(a)]
    return []


def counterexample_text(cex: list[dict]) -> str:
    cols = list(INPUTS) + ["MOTOR", "LAMP_RED"]
    lines = ["scan " + " ".join(f"{c[:8]:>8}" for c in cols)]
    for i, st in enumerate(cex):
        vals = [st["in"].get(c, st["out"].get(c)) for c in cols]
        lines.append(f"{i:<4} " + " ".join(f"{v:>8}" for v in vals))
    return "\n".join(lines)
