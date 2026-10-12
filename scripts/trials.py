"""Repeated trials of agent v1 (naive) and v2 (verified) on Cell 01, to compare reliability, not one lucky run.

    uv run python -m scripts.trials --n 6

For each run it records what the agent submitted and how that program scores on the evaluation it never saw,
plus whether the agent ever had a patch that passed every visible test while a safety rule was still violated
(the case the model checker exists for). Writes docs/traces/trials.json and docs/traces/trials.md.
"""

from __future__ import annotations

import argparse
import json
import statistics
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from agent.run import load_env  # noqa: F401  (loads .env)
from agent.evaluate import evaluate
from agent.llm import make_backend
from agent.loop import run_agent

ROOT = Path(__file__).resolve().parent.parent


def one(variant: str, i: int) -> dict:
    run = run_agent(variant, make_backend(), log=lambda s: None)
    wb = run["workbench"]
    ev = evaluate(wb.versions[run["final_version"]])
    tests_ok_unproven = False
    for v in wb.order[1:]:
        res = wb.tests(v)
        pr = wb.proof(v)
        if all(r["passed"] for r in res) and any(p["status"] != "proven" for p in pr["results"]):
            tests_ok_unproven = True
    return {
        "variant": variant,
        "trial": i,
        "heldout": ev["heldout"]["pass"],
        "heldout_total": ev["heldout"]["total"],
        "proven": sum(p["status"] == "proven" for p in ev["proofs"]),
        "faults_fixed": ev["faults_fixed"]["fixed"],
        "fuzz_bad": ev["fuzz"]["violations"],
        "fully_correct": ev["heldout"]["pass"] == ev["heldout"]["total"] and all(p["status"] == "proven" for p in ev["proofs"]) and ev["fuzz"]["violations"] == 0,
        "tests_ok_but_unproven_patch_seen": tests_ok_unproven,
        "steps": len(run["steps"]),
        "llm_calls": run["llm_calls"],
        "errors": sum(s["kind"] == "error" for s in run["steps"]),
        "cost_usd": run["cost_usd"],
        "duration_s": run["duration_s"],
        "tokens_in": run["tokens"]["input"],
        "tokens_out": run["tokens"]["output"],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    jobs = [(v, i) for i in range(1, args.n + 1) for v in ("v1", "v2")]
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        results = list(ex.map(lambda j: one(*j), jobs))
    out = ROOT / "docs" / "traces"
    out.mkdir(parents=True, exist_ok=True)
    (out / "trials.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    lines = ["# Repeated trials: v1 vs v2", "", f"{args.n} independent runs per variant on Cell 01 (claude-sonnet-4.6 via the neatHack LiteLLM proxy).", "",
             "| | v1 (naive) | v2 (verified) |", "|---|---|---|"]

    def agg(v: str):
        rs = [r for r in results if r["variant"] == v]
        return {
            "fully correct submissions (held-out 16/16, 6/6 proven, 0 fuzz violations)": f"{sum(r['fully_correct'] for r in rs)}/{len(rs)}",
            "mean held-out tests passed": f"{statistics.mean(r['heldout'] for r in rs):.1f}/16",
            "mean safety rules proven": f"{statistics.mean(r['proven'] for r in rs):.1f}/6",
            "mean hidden faults fixed": f"{statistics.mean(r['faults_fixed'] for r in rs):.1f}/4",
            "runs with a patch that passed every test but still violated a safety rule": f"{sum(r['tests_ok_but_unproven_patch_seen'] for r in rs)}/{len(rs)}",
            "mean steps / LLM calls": f"{statistics.mean(r['steps'] for r in rs):.1f} / {statistics.mean(r['llm_calls'] for r in rs):.1f}",
            "mean cost per run": f"${statistics.mean(r['cost_usd'] for r in rs):.3f}",
            "mean wall time": f"{statistics.mean(r['duration_s'] for r in rs):.0f} s",
        }

    a1, a2 = agg("v1"), agg("v2")
    for k in a1:
        lines.append(f"| {k} | {a1[k]} | {a2[k]} |")
    (out / "trials.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
