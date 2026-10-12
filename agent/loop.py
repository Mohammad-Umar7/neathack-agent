"""The STOP/PROVE agent loop: plan, act through tools, verify, recover, submit.

v1 is the naive first version (tests only, pass/fail answers, no verification). v2 adds failure
details, experiments on the digital twin, the model checker, regression detection and rollback."""

from __future__ import annotations

import json
import time

from .tools import TOOL_DEFS, V1_TOOLS, V2_TOOLS, ToolFailure, Workbench

TASK = (
    "You are commissioning the control program for Cell 01, an infeed conveyor, before it is loaded into the real PLC. "
    "The program was written by a contractor and has not been verified. Make it satisfy every operating rule. "
    "Start by reading the spec and the program."
)

SYSTEM_V1 = (
    "You are a PLC programmer. Fix the program so that the tests pass, using the tools. "
    "Submit when you are done."
)

SYSTEM_V2 = """You are STOP/PROVE, a careful controls engineer agent. You commission PLC logic on a digital twin before it
touches a real machine. The program you are given has an unknown number of defects. Nobody will tell you what
they are: find them from evidence.

Method:
1. Read the spec (machine, language, operating rules) and the program.
2. Run the tests. For each failure, read the details (scan tables) and form a root-cause hypothesis that names
   the rung(s) responsible. Use prove() to get the shortest counterexample for each violated safety rule.
   Use simulate() to confirm a hypothesis when the evidence is ambiguous.
3. Fix root causes with the smallest change that satisfies the rule as written. Batch related edits into one
   patch (max 4 edits). Never special-case test timings and never weaken a safety rule to make a test pass.
   The belt must stay useful: it has to run, deliver boxes and resume after a pick.
4. After every patch, read the test and proof results. If anything that passed before now fails, roll back
   and try a different fix.
5. Submit only when every visible test passes AND prove() reports S1-S6 PROVEN. In the summary, list each
   defect you found (rung, symptom, root cause) and the fix.
Be efficient: every tool call costs time and money."""


KEEP_FULL = 6  # most recent tool results kept verbatim; older ones are trimmed
TRIM_TO = 700


def compact(messages: list[dict]) -> list[dict]:
    """Context management: keep the task and the latest tool results whole, trim stale ones.
    The spec and the current program can always be re-read with a tool call."""
    tool_idx = [i for i, m in enumerate(messages) if m["role"] == "tool"]
    stale = set(tool_idx[:-KEEP_FULL])
    out = []
    for i, m in enumerate(messages):
        if i in stale and len(m.get("content") or "") > TRIM_TO:
            m = {**m, "content": m["content"][:TRIM_TO] + "\n...(older result trimmed; call the tool again if you need it)"}
        out.append(m)
    return out


def _title(name: str, args: dict, result: str, ok: bool) -> str:
    first = result.splitlines()[0] if result else ""
    if not ok:
        return f"{name} failed: {result.removeprefix('ERROR: ')[:120]}"
    if name == "run_tests":
        return f"Run visible tests: {first.split(': ', 1)[-1]}"
    if name == "propose_patch":
        return first.replace("Patch applied as", "Patch applied:")
    if name == "prove":
        viol = [ln.split(":")[0] for ln in result.splitlines() if "VIOLATED" in ln]
        return "Prove S1-S6: " + ("all proven" if not viol else f"{', '.join(viol)} violated")
    if name == "get_test_details":
        return f"Inspect failing test {args.get('test_id', '')}"
    if name == "simulate":
        return f"Experiment on the digital twin ({len(args.get('events', []))} events)"
    if name == "rollback":
        return f"Roll back to {args.get('version', '')}"
    if name == "submit":
        return "Submit repaired program"
    if name == "read_spec":
        return "Read machine spec and operating rules"
    if name == "read_program":
        return "Read the program"
    return name


def _kind(name: str, ok: bool, prev_failed: bool) -> str:
    if not ok:
        return "error"
    if prev_failed:
        return "recover"
    return {"propose_patch": "patch", "rollback": "rollback", "submit": "submit"}.get(name, "tool")


def run_agent(variant: str, backend, *, chaos: bool = False, max_steps: int | None = None, tracer=None, log=print) -> dict:
    from .plc.cell import baseline_program

    v2 = variant == "v2"
    wb = Workbench(baseline_program(), verbose_results=v2, chaos=chaos)
    tools = [TOOL_DEFS[n] for n in (V2_TOOLS if v2 else V1_TOOLS)]
    system = SYSTEM_V2 if v2 else SYSTEM_V1
    max_steps = max_steps or (24 if v2 else 10)
    messages: list[dict] = [{"role": "user", "content": TASK}]
    steps: list[dict] = []
    t0 = time.time()
    tokens_in = tokens_out = 0
    cost = 0.0
    prev_failed = False
    llm_calls = 0

    def add_step(**kw) -> None:
        kw.setdefault("program_version", wb.current)
        kw["i"] = len(steps) + 1
        kw["t"] = round(time.time() - t0, 2)
        steps.append(kw)

    for _ in range(max_steps):
        reply = backend.chat(system, compact(messages), tools)
        llm_calls += 1
        tokens_in += reply.input_tokens
        tokens_out += reply.output_tokens
        cost += reply.cost_usd
        step_tokens = reply.input_tokens + reply.output_tokens
        if reply.text.strip():
            add_step(kind="think", title=reply.text.strip().splitlines()[0][:140], detail=reply.text.strip(),
                     tokens=step_tokens, cost_usd=round(reply.cost_usd, 5))
            step_tokens = 0
        if not reply.calls:
            messages.append(backend.assistant_message(reply))
            messages.append({"role": "user", "content": "Act through exactly one tool call."})
            continue
        messages.append(backend.assistant_message(reply))
        for call in reply.calls:
            ok = True
            try:
                if tracer:
                    result = tracer(call.name, call.args, lambda: wb.call(call.name, call.args))
                else:
                    result = wb.call(call.name, call.args)
            except ToolFailure as e:
                ok, result = False, f"ERROR: {e}"
            except TypeError as e:  # wrong argument names from the model
                ok, result = False, f"ERROR: bad arguments for {call.name}: {e}"
            metrics = wb.metrics()
            add_step(kind=_kind(call.name, ok, prev_failed), tool=call.name, title=_title(call.name, call.args, result, ok),
                     detail=result[:4000], args=call.args, ok=ok, tokens=step_tokens or None, metrics=metrics)
            log(f"  [{variant}] {steps[-1]['title']}")
            step_tokens = 0
            prev_failed = not ok
            messages.append(backend.tool_message(call, result))
            if wb.submitted:
                break
        if wb.submitted:
            break

    if not wb.submitted:
        wb.submitted = wb.current
        wb.summary = "Step budget exhausted; the current version was submitted automatically."
        add_step(kind="submit", tool="submit", title="Step budget exhausted: auto-submit", detail=wb.summary, ok=False, metrics=wb.metrics())

    return {
        "variant": variant,
        "workbench": wb,
        "steps": steps,
        "summary": wb.summary,
        "final_version": wb.submitted,
        "duration_s": round(time.time() - t0, 1),
        "tokens": {"input": tokens_in, "output": tokens_out},
        "cost_usd": round(cost, 4),
        "llm_calls": llm_calls,
    }


class ScriptedBackend:
    """Test double that replays a fixed plan. Used only to test the pipeline offline; never published."""

    name = "scripted-test"
    model = "scripted"

    def __init__(self, plan: list[tuple[str, dict]]):
        self.plan = list(plan)
        self.i = 0

    def chat(self, system, messages, tools):
        from .llm import Reply, ToolCall

        name, args = self.plan[min(self.i, len(self.plan) - 1)]
        self.i += 1
        return Reply(f"(scripted) step {self.i}", [ToolCall(f"s{self.i}", name, args)], 0, 0, 0.0, 0.0)

    def assistant_message(self, reply):
        return {"role": "assistant", "content": json.dumps({"tool": reply.calls[0].name})}

    def tool_message(self, call, content):
        return {"role": "tool", "name": call.name, "content": content}
