"""Write docs/traces/README.md: the before/after comparison of agent runs, from docs/traces/*.json."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
runs = {p.stem: json.loads(p.read_text()) for p in sorted((ROOT / "docs" / "traces").glob("*.json")) if not p.stem.startswith("trials")}
order = [k for k in ("v1-naive", "v2-verified", "v2-recovery") if k in runs] + [k for k in runs if k not in ("v1-naive", "v2-verified", "v2-recovery")]
rows = [
    ("Held-out tests passed (never seen by the agent)", lambda r: f"{r['heldout']['pass']}/{r['heldout']['total']}"),
    ("Visible tests passed", lambda r: f"{r['visible']['pass']}/{r['visible']['total']}"),
    ("Safety rules proven (S1-S6)", lambda r: f"{r['proven']}/6"),
    ("Fuzz episodes with a violation (of 300)", lambda r: str(r["fuzz_bad_episodes"])),
    ("Hidden seeded faults fixed", lambda r: f"{r['faults_fixed']['fixed']}/{r['faults_fixed']['total']}"),
    ("Agent steps / LLM calls", lambda r: f"{r['steps']} / {r['llm_calls']}"),
    ("Failed actions / recoveries / rollbacks", lambda r: f"{r['errors']} / {r['recoveries']} / {r['rollbacks']}"),
    ("Tokens (in / out)", lambda r: f"{r['tokens']['input']:,} / {r['tokens']['output']:,}"),
    ("Cost (USD)", lambda r: f"${r['cost_usd']:.2f}"),
    ("Wall time", lambda r: f"{r['duration_s']:.0f} s"),
]
lines = ["# Agent runs: before / after", "",
         "Every run is traced in neatlogs (workflow span, every LLM call, every tool call). The numbers below come from each run's",
         "export (`docs/traces/<run>.json`); the held-out tests, fuzzing and proofs run after the agent submits.", "",
         "| | " + " | ".join(order) + " |", "|---|" + "---|" * len(order)]
for label, fn in rows:
    lines.append(f"| {label} | " + " | ".join(fn(runs[k]) for k in order) + " |")
lines += ["", "- **v1-naive**: minimal prompt, tests only (pass/fail), no failure details, no model checker, no rollback.",
          "- **v2-verified**: commissioning method, failure details and scan tables, experiments on the digital twin, the model checker, regression detection and rollback.",
          "- **v2-recovery**: v2 with an injected failure (the model checker crashes on its first call) to show recovery.", ""]
(ROOT / "docs" / "traces" / "runs.md").write_text("\n".join(lines), encoding="utf-8")
print("\n".join(lines))
