"""The agent's workbench: tools over the digital twin, and the program versions it creates.

The agent never sees the seeded fault labels or the held-out tests. It sees the operating rules, the
program, the visible tests, and (in v2) counterexamples, custom simulations and the model checker."""

from __future__ import annotations

import json
import time

from .plc.cell import LANGUAGE_DOC, SIGNALS_DOC, SPEC, VISIBLE_TESTS
from .plc.lang import Edit, ParseError, apply_edits, program_to_text, validate_program
from .plc.sim import run_scenario
from .plc.verify import counterexample_text, prove, run_suite, trace_window

MAX_EDITS = 4


def _schema(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


TOOL_DEFS = {
    "read_spec": {
        "name": "read_spec",
        "description": "Read the machine description, the control language and the operating rules (safety and functional) the program must satisfy.",
        "parameters": _schema({}),
    },
    "read_program": {
        "name": "read_program",
        "description": "Read the current version of the PLC program (rungs with ids).",
        "parameters": _schema({}),
    },
    "run_tests": {
        "name": "run_tests",
        "description": "Run the visible test suite on the current program. Returns pass/fail per test.",
        "parameters": _schema({}),
    },
    "get_test_details": {
        "name": "get_test_details",
        "description": "Show why a test failed: the failed expectations and rule violations, plus a scan-by-scan table around the first failure.",
        "parameters": _schema({"test_id": {"type": "string"}, "t_from": {"type": "number"}, "t_to": {"type": "number"}}, ["test_id"]),
    },
    "simulate": {
        "name": "simulate",
        "description": (
            "Run your own experiment on the digital twin with the current program and get a scan table. events: list of "
            "{t, kind: press|set|spawn|pick|stick|unstick, input?, value?, duration?, sensor?}. press = momentary button "
            "(START/STOP/RESET), set = maintained input (ESTOP, GUARD_CLOSED), stick/unstick = force a photo-eye (PE_IN/PE_END)."
        ),
        "parameters": _schema(
            {
                "events": {"type": "array", "items": {"type": "object"}},
                "duration": {"type": "number"},
                "t_from": {"type": "number"},
                "t_to": {"type": "number"},
                "autopick_after": {"type": "number"},
            },
            ["events", "duration"],
        ),
    },
    "prove": {
        "name": "prove",
        "description": "Model-check the safety rules S1-S6 over every reachable state and every possible input sequence. Returns PROVEN or the shortest counterexample per rule.",
        "parameters": _schema({}),
    },
    "propose_patch": {
        "name": "propose_patch",
        "description": (
            f"Change the program with up to {MAX_EDITS} edits: {{op: replace|insert_after|delete, id, text}}. "
            "replace rewrites rung `id` with `text`; insert_after adds a new rung after `id` (use id START for the top); "
            "delete removes rung `id`. The patch is parsed and checked against the language limits, then the tests run on it."
        ),
        "parameters": _schema(
            {"edits": {"type": "array", "items": {"type": "object"}}, "rationale": {"type": "string"}}, ["edits", "rationale"]
        ),
    },
    "rollback": {
        "name": "rollback",
        "description": "Go back to an earlier program version (v0 is the program as delivered).",
        "parameters": _schema({"version": {"type": "string"}}, ["version"]),
    },
    "submit": {
        "name": "submit",
        "description": "Submit the current program as your repair, with a short summary of what was wrong and what you changed. Ends the job.",
        "parameters": _schema({"summary": {"type": "string"}}, ["summary"]),
    },
}

V1_TOOLS = ["read_spec", "read_program", "run_tests", "propose_patch", "submit"]
V2_TOOLS = ["read_spec", "read_program", "run_tests", "get_test_details", "simulate", "prove", "propose_patch", "rollback", "submit"]


class ToolFailure(Exception):
    """An action that failed. The agent sees the error and must recover."""


class Workbench:
    def __init__(self, program: list[dict], verbose_results: bool, chaos: bool = False):
        self.versions: dict[str, list[dict]] = {"v0": program}
        self.order = ["v0"]
        self.current = "v0"
        self.verbose = verbose_results
        self.chaos = chaos
        self._chaos_fired: set[str] = set()
        self.submitted: str | None = None
        self.summary = ""
        self._tests_cache: dict[str, list[dict]] = {}
        self._proof_cache: dict[str, dict] = {}

    @property
    def program(self) -> list[dict]:
        return self.versions[self.current]

    # ---- shared results (cached per version)

    def tests(self, version: str | None = None) -> list[dict]:
        v = version or self.current
        if v not in self._tests_cache:
            self._tests_cache[v] = run_suite(self.versions[v], VISIBLE_TESTS)
        return self._tests_cache[v]

    def proof(self, version: str | None = None) -> dict:
        v = version or self.current
        if v not in self._proof_cache:
            self._proof_cache[v] = prove(self.versions[v])
        return self._proof_cache[v]

    def metrics(self) -> dict:
        res = self.tests()
        pr = self.proof()
        return {
            "visible_pass": sum(r["passed"] for r in res),
            "visible_total": len(res),
            "proven": sum(r["status"] == "proven" for r in pr["results"]),
            "proof_total": len(pr["results"]),
        }

    # ---- tools

    def call(self, name: str, args: dict) -> str:
        fn = getattr(self, f"t_{name}", None)
        if fn is None:
            raise ToolFailure(f"unknown tool {name!r}")
        return fn(**args)

    def t_read_spec(self) -> str:
        rules = "\n".join(f"{r['id']} {r['title']} [{r['kind']}]: {r['text']}" for r in SPEC)
        return f"MACHINE\n{SIGNALS_DOC}\n\nCONTROL LANGUAGE\n{LANGUAGE_DOC}\n\nOPERATING RULES\n{rules}"

    def t_read_program(self) -> str:
        return f"Program {self.current}:\n{program_to_text(self.program)}"

    def _summary_lines(self, res: list[dict]) -> list[str]:
        lines = []
        for r in res:
            line = f"{r['id']} {'PASS' if r['passed'] else 'FAIL'}  {r['title']}"
            if self.verbose and not r["passed"]:
                line += "\n      " + "\n      ".join(f["message"] for f in r["failures"][:4])
            lines.append(line)
        return lines

    def t_run_tests(self) -> str:
        res = self.tests()
        n = sum(r["passed"] for r in res)
        return f"Program {self.current}: {n}/{len(res)} visible tests pass\n" + "\n".join(self._summary_lines(res))

    def t_get_test_details(self, test_id: str, t_from: float | None = None, t_to: float | None = None) -> str:
        r = next((x for x in self.tests() if x["id"] == test_id), None)
        if r is None:
            raise ToolFailure(f"no visible test {test_id!r}")
        test = next(t for t in VISIBLE_TESTS if t["id"] == test_id)
        script = "; ".join(_event_text(e) for e in test["events"]) or "(no events)"
        opts = f" options={json.dumps(test['options'])}" if test["options"] else ""
        head = f"{test_id} {test['title']}: {'PASS' if r['passed'] else 'FAIL'}\nScript: {script}{opts}\n"
        if r["passed"]:
            return head + "No failures."
        first = r["failures"][0]["t"]
        lo = t_from if t_from is not None else max(0.0, first - 1.0)
        hi = t_to if t_to is not None else first + 1.0
        if hi - lo > 4.0:
            hi = lo + 4.0
        fails = "\n".join(f["message"] for f in r["failures"])
        return head + f"Failures:\n{fails}\n\nScans {lo:.1f}-{hi:.1f}s:\n{trace_window(r['trace'], lo, hi)}"

    def t_simulate(self, events: list[dict], duration: float, t_from: float = 0.0, t_to: float | None = None,
                   autopick_after: float | None = None) -> str:
        duration = min(float(duration), 30.0)
        sc = {"id": "experiment", "duration": duration, "events": events, "options": {}}
        if autopick_after is not None:
            sc["options"]["autopick_after"] = autopick_after
        try:
            tr = run_scenario(self.program, sc)
        except Exception as e:  # malformed events from the model
            raise ToolFailure(f"simulation rejected the events: {e}") from e
        hi = t_to if t_to is not None else min(duration, t_from + 4.0)
        if hi - t_from > 4.0:
            hi = t_from + 4.0
        viol = "; ".join(f"{v['rule']} at t={v['t']}s ({v['message']})" for v in tr["violations"]) or "none"
        return f"Violations: {viol}\nScans {t_from:.1f}-{hi:.1f}s:\n{trace_window(tr, t_from, hi)}"

    def t_prove(self) -> str:
        if self.chaos and "prove" not in self._chaos_fired:
            self._chaos_fired.add("prove")
            time.sleep(0.5)
            raise ToolFailure("model checker worker crashed (exit code 137, out of memory) - no result")
        pr = self.proof()
        lines = [f"Program {self.current}: explored {pr['states']} reachable states ({'complete' if pr['complete'] else 'bounded'})."]
        if not pr["motor_reachable"]:
            lines.append("WARNING: MOTOR can never turn on - the program is safe but useless.")
        for r in pr["results"]:
            if r["status"] == "violated":
                lines.append(f"{r['rule']}: VIOLATED. Shortest counterexample ({len(r['counterexample'])} scans):\n{counterexample_text(r['counterexample'])}")
            else:
                lines.append(f"{r['rule']}: PROVEN")
        return "\n".join(lines)

    def t_propose_patch(self, edits: list[dict], rationale: str = "") -> str:
        if isinstance(edits, str):  # some models send the list JSON-encoded
            try:
                edits = json.loads(edits)
            except json.JSONDecodeError as e:
                raise ToolFailure(f"edits is not valid JSON: {e}") from e
        if isinstance(edits, dict):
            edits = [edits]
        ops = {"insert": "insert_after", "add": "insert_after", "insert_after": "insert_after", "remove": "delete",
               "delete": "delete", "modify": "replace", "update": "replace", "edit": "replace", "replace": "replace"}
        if isinstance(edits, list):
            edits = [{**e, "op": ops.get(str(e.get("op", "")).lower(), e.get("op", ""))} if isinstance(e, dict) else e for e in edits]
        if not isinstance(edits, list) or not edits or not all(isinstance(e, dict) for e in edits):
            raise ToolFailure("edits must be a non-empty list")
        if len(edits) > MAX_EDITS:
            raise ToolFailure(f"patch rejected: {len(edits)} edits, the limit is {MAX_EDITS} per patch")
        try:
            parsed = [Edit(e.get("op", ""), str(e.get("id", "")), e.get("text", "")) for e in edits]
            new = apply_edits(self.program, parsed)
        except ParseError as e:
            raise ToolFailure(f"patch rejected by the parser: {e}") from e
        problems = validate_program(new)
        if problems:
            raise ToolFailure("patch rejected by the validator: " + "; ".join(problems))
        before = {r["id"]: r["passed"] for r in self.tests()}
        before_proven = {r["rule"] for r in self.proof()["results"] if r["status"] == "proven"} if self.verbose else set()
        v = f"v{len(self.order)}"
        self.versions[v] = new
        self.order.append(v)
        prev = self.current
        self.current = v
        res = self.tests()
        n = sum(r["passed"] for r in res)
        regress = [r["id"] for r in res if before.get(r["id"]) and not r["passed"]]
        out = [f"Patch applied as {v} (was {prev}). Visible tests: {n}/{len(res)}"]
        out += self._summary_lines(res)
        if self.verbose:
            pr = self.proof()
            proven = {r["rule"] for r in pr["results"] if r["status"] == "proven"}
            out.append("Proofs: " + ", ".join(f"{r['rule']} {'PROVEN' if r['status'] == 'proven' else 'VIOLATED'}" for r in pr["results"]))
            lost = sorted(before_proven - proven)
            if lost:
                regress += [f"proof {x}" for x in lost]
        if regress:
            out.append(f"REGRESSION: {', '.join(regress)} passed before this patch and fail now. Consider rollback to {prev}.")
        return "\n".join(out)

    def t_rollback(self, version: str) -> str:
        if version not in self.versions:
            raise ToolFailure(f"no version {version!r}; versions: {', '.join(self.order)}")
        self.current = version
        return f"Rolled back to {version}.\n{program_to_text(self.program)}"

    def t_submit(self, summary: str) -> str:
        self.submitted = self.current
        self.summary = summary
        return f"Submitted {self.current}."


def _event_text(e: dict) -> str:
    k = e["kind"]
    if k == "press":
        return f"t={e['t']} press {e['input']}"
    if k == "set":
        return f"t={e['t']} {e['input']}={e['value']}"
    if k in ("stick", "unstick"):
        return f"t={e['t']} {k} {e['sensor']}" + (f"={e.get('value', 1)}" if k == "stick" else "")
    return f"t={e['t']} {k}"
