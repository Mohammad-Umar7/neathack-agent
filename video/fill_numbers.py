"""Fill the result scenes (s5, s6) of video/scenes.json from the real runs in docs/traces/*.json.

    uv run python video/fill_numbers.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORDS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split()


def w(n: int) -> str:
    if n < len(WORDS):
        return WORDS[n]
    tens = {20: "twenty", 30: "thirty", 40: "forty", 50: "fifty", 60: "sixty", 70: "seventy", 80: "eighty", 90: "ninety"}
    if n < 100:
        t, u = divmod(n, 10)
        return tens[t * 10] + (f"-{WORDS[u]}" if u else "")
    if n < 1000:
        h, r = divmod(n, 100)
        return f"{WORDS[h]} hundred" + (f" and {w(r)}" if r else "")
    return str(n)


def money(x: float) -> str:
    cents = round(x * 100)
    if cents < 100:
        return f"{w(cents)} cents"
    d, c = divmod(cents, 100)
    return f"{w(d)} dollar{'s' if d != 1 else ''}" + (f" and {w(c)} cents" if c else "")


def main() -> None:
    tr = ROOT / "docs" / "traces"
    v1 = json.loads((tr / "v1-naive.json").read_text())
    v2 = json.loads((tr / "v2-verified.json").read_text())
    rec = json.loads((tr / "v2-recovery.json").read_text()) if (tr / "v2-recovery.json").exists() else None
    h2 = f"{w(v2['heldout']['pass'])} of {w(v2['heldout']['total'])}"
    s5 = (
        "Then we grade it on things it never saw: sixteen held-out tests, three hundred random fuzz runs, and the proofs. "
        f"The program as delivered passed two of sixteen. The agent's repair passes {h2}, "
        f"with {w(v2['fuzz_bad_episodes'])} fuzz violations, proves {w(v2['proven'])} of six safety rules, "
        f"and fixes {w(v2['faults_fixed']['fixed'])} of the four hidden faults."
    )
    s6 = (
        "Every run is traced in neatlogs. We initialise neatlogs before the OpenAI client, so every model call is captured, "
        "then wrap the run in a workflow span and every tool call in a tool span, with tokens, latency and cost. "
        "The traces showed why our first agent struggled: it only saw pass or fail, so it guessed. "
        "Version two reads counterexamples and proves its work. "
        f"Same task: held-out tests went from {w(v1['heldout']['pass'])} to {w(v2['heldout']['pass'])} of sixteen, "
        f"for {money(v2['cost_usd'])} a run."
    )
    if rec and rec.get("recoveries"):
        s6 += " And when we crashed its model checker on purpose, it noticed, retried, and still finished."
    spec_path = ROOT / "video" / "scenes.json"
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    scenes = {s["id"]: s for s in spec["scenes"]}
    scenes.setdefault("s5-results", {"id": "s5-results", "media": "out/compare-production.mp4"})["narration"] = s5
    scenes.setdefault("s6-neatlogs", {"id": "s6-neatlogs", "media": "out/neatlogs-trace.png"})["narration"] = s6
    order = ["s1-hook", "s2-problem", "s3-intro", "s4-agent", "s5-results", "s6-neatlogs", "s7-entire", "s8-cfo", "s9-outro"]
    spec["scenes"] = [scenes[k] for k in order if k in scenes] + [s for k, s in scenes.items() if k not in order]
    spec_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")
    print(s5)
    print(s6)


if __name__ == "__main__":
    main()
