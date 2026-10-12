"""Run the STOP/PROVE agent on Cell 01, evaluate its repair on the held-out suite, and export the run.

    uv run python -m agent.run --variant v2                 # verified agent
    uv run python -m agent.run --variant v1                 # naive first version (the "before")
    uv run python -m agent.run --variant v2 --chaos         # inject a tool failure to show recovery
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent


def load_env() -> None:
    load_dotenv(ROOT / ".env")
    # In a git worktree, fall back to the main checkout's .env for keys that are still empty.
    try:
        common = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        main_env = (ROOT / common).resolve().parent / ".env"
        if main_env.exists():
            from dotenv import dotenv_values

            for k, v in dotenv_values(main_env).items():
                if v and not os.environ.get(k):
                    os.environ[k] = v
    except OSError:
        pass


load_env()

NEATLOGS = bool(os.environ.get("NEATLOGS_API_KEY"))
if NEATLOGS:
    import neatlogs  # noqa: E402  (must initialise before openai is imported)

    neatlogs.init(
        api_key=os.environ["NEATLOGS_API_KEY"],
        workflow_name="stop-prove",
        tags=["neathack", "stop-prove"],
        instrumentations=["openai"],
    )
    from neatlogs import span  # noqa: E402
else:
    def span(**_kw):  # no-op when neatlogs is not configured
        return lambda f: f

from .evaluate import export_run, write_manifest  # noqa: E402
from .llm import make_backend  # noqa: E402
from .loop import run_agent  # noqa: E402


def tool_tracer(name: str, args: dict, fn):
    @span(kind="TOOL", name=f"tool.{name}", tool_name=name)
    def _call(tool_args: dict):
        return fn()

    return _call(args)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", choices=["v1", "v2"], default="v2")
    ap.add_argument("--chaos", action="store_true", help="inject a model-checker crash to exercise recovery")
    ap.add_argument("--id", default=None)
    ap.add_argument("--label", default=None)
    ap.add_argument("--max-steps", type=int, default=None)
    ap.add_argument("--backend", default=None, help="openai | claude-cli (default: openai when LLM_API_KEY is set)")
    ap.add_argument("--manifest", action="store_true", help="add this run to web/public/data/manifest.json")
    args = ap.parse_args()

    backend = make_backend(args.backend)
    model = getattr(backend, "model", "?")
    run_id = args.id or f"{args.variant}{'-chaos' if args.chaos else ''}-{datetime.now().strftime('%H%M')}"
    label = args.label or {
        "v1": "Agent v1 — naive (before)",
        "v2": "Agent v2 — verified (after)",
    }[args.variant] + (" + injected failure" if args.chaos else "")
    print(f"STOP/PROVE {args.variant} | backend={backend.name} model={model} | neatlogs={'on' if NEATLOGS else 'off'}")

    @span(kind="WORKFLOW", name=f"stop-prove.{args.variant}", tags=[args.variant] + (["chaos"] if args.chaos else []),
          capture_output=False, session_id=run_id)
    def workflow(variant: str, chaos: bool) -> dict:
        return run_agent(variant, backend, chaos=chaos, max_steps=args.max_steps, tracer=tool_tracer)

    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        run = workflow(args.variant, args.chaos)
    finally:
        if NEATLOGS:
            neatlogs.flush()
    run["started_at"] = started
    doc = export_run(run, run_id, label, model, backend.name, os.environ.get("NEATLOGS_PROJECT_URL"))
    ev = doc["eval"]["repaired"]
    summary = {
        "id": run_id, "variant": args.variant, "chaos": args.chaos, "model": model, "backend": backend.name,
        "steps": len(run["steps"]), "llm_calls": run["llm_calls"], "duration_s": run["duration_s"],
        "tokens": run["tokens"], "cost_usd": run["cost_usd"],
        "visible": ev["visible"], "heldout": ev["heldout"], "faults_fixed": ev["faults_fixed"],
        "proven": sum(p["status"] == "proven" for p in ev["proofs"]), "fuzz_bad_episodes": ev["fuzz"]["violations"],
        "errors": sum(1 for s in run["steps"] if s["kind"] == "error"),
        "recoveries": sum(1 for s in run["steps"] if s["kind"] == "recover"),
        "rollbacks": sum(1 for s in run["steps"] if s["kind"] == "rollback"),
    }
    out = ROOT / "docs" / "traces" / f"{run_id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    if args.manifest:
        man = ROOT / "web" / "public" / "data" / "manifest.json"
        runs = json.loads(man.read_text())["runs"] if man.exists() else []
        runs = [(r["id"], r["label"]) for r in runs if r["id"] != run_id] + [(run_id, label)]
        write_manifest(runs, default=run_id if args.variant == "v2" and not args.chaos else (runs[0][0]))
    if NEATLOGS:
        neatlogs.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
