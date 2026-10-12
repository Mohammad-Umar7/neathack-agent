"""Held-out evaluation and export of runs for the web viewer (web/public/data)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .plc.cell import HELDOUT_TESTS, SPEC, VISIBLE_TESTS, baseline_program, fuzz_scenarios
from .plc.hidden import FAULTS
from .plc.sim import run_scenario
from .plc.verify import fuzz, prove, run_suite

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
HELDOUT_FUZZ_SEED = 2026
HELDOUT_FUZZ_EPISODES = 300

# Before/After showcase scenarios (ids match the viewer's built-in ones).
SHOWCASE = [
    ("pick-overrun", "Box at the pick position", "A box rides to the robot. The belt must stop at PE_END instead of pushing it off the end.", "V05"),
    ("estop-no-reset", "E-stop, then START without RESET", "After the E-stop is released, START alone must not run the belt.", "V03"),
    ("guard-restart", "Guard door opened and closed", "Closing the guard must not restart the belt on its own.", "V04"),
    ("stuck-infeed", "Stuck infeed sensor", "PE_IN sticks on while running. The jam must be caught within 3 s.", "V06"),
    ("production", "One minute of production", "Continuous feeding and picking for 60 s.", "H06"),
]


def evaluate(program: list[dict]) -> dict:
    vis = run_suite(program, VISIBLE_TESTS)
    held = run_suite(program, HELDOUT_TESTS)
    pr = prove(program)
    fz = fuzz(program, fuzz_scenarios(HELDOUT_FUZZ_SEED, HELDOUT_FUZZ_EPISODES))
    passed = {r["id"] for r in vis + held if r["passed"]}
    proven = {r["rule"] for r in pr["results"] if r["status"] == "proven"}
    fixed = [f["id"] for f in FAULTS if all(t in passed for t in f["tests"]) and (f["rule"] not in [r["rule"] for r in pr["results"]] or f["rule"] in proven)]
    return {
        "visible": {"pass": sum(r["passed"] for r in vis), "total": len(vis)},
        "heldout": {"pass": sum(r["passed"] for r in held), "total": len(held)},
        "heldout_failed": [{"id": r["id"], "title": r["title"], "why": r["failures"][0]["message"]} for r in held if not r["passed"]],
        "proofs": [
            {k: v for k, v in r.items() if k in ("rule", "status", "states_explored", "counterexample")} for r in pr["results"]
        ],
        "motor_reachable": pr["motor_reachable"],
        "fuzz": {"episodes": fz["episodes"], "violations": fz["violations"], "by_rule": fz["by_rule"]},
        "faults_fixed": {"fixed": len(fixed), "total": len(FAULTS), "ids": fixed},
    }


def _scenario_of(test_id: str) -> dict:
    t = next(x for x in VISIBLE_TESTS + HELDOUT_TESTS if x["id"] == test_id)
    return {"id": t["id"], "title": t["title"], "description": t["description"], "duration": t["duration"],
            "options": t["options"], "events": t["events"]}


def showcase_pairs(repaired: list[dict]) -> list[dict]:
    base = baseline_program()
    out = []
    for sid, title, desc, test_id in SHOWCASE:
        sc = _scenario_of(test_id)
        if sid == "production":
            sc["duration"] = 40
        sc = {**sc, "id": sid, "title": title, "description": desc}
        out.append({"id": sid, "title": title, "description": desc, "scenario": sc,
                    "baseline": run_scenario(base, sc), "repaired": run_scenario(repaired, sc)})
    return out


def export_run(run: dict, run_id: str, label: str, model: str, provider: str, neatlogs_url: str | None = None) -> dict:
    wb = run["workbench"]
    final = wb.versions[run["final_version"]]
    doc = {
        "id": run_id,
        "label": label,
        "agent": run["variant"],
        "model": model,
        "provider": provider,
        "started_at": run.get("started_at") or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "duration_s": run["duration_s"],
        "tokens": run["tokens"],
        "cost_usd": run["cost_usd"],
        "llm_calls": run["llm_calls"],
        "spec": SPEC,
        "programs": {v: wb.versions[v] for v in wb.order},
        "final_version": run["final_version"],
        "summary": run["summary"],
        "steps": run["steps"],
        "eval": {"baseline": evaluate(baseline_program()), "repaired": evaluate(final)},
        "scenarios": showcase_pairs(final),
    }
    if neatlogs_url:
        doc["neatlogs_url"] = neatlogs_url
    (DATA / "runs").mkdir(parents=True, exist_ok=True)
    (DATA / "runs" / f"{run_id}.json").write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    return doc


def write_manifest(runs: list[tuple[str, str]], default: str) -> None:
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "default_run": default,
        "runs": [{"id": rid, "label": label, "file": f"runs/{rid}.json"} for rid, label in runs],
    }
    (DATA / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
