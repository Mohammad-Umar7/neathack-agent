import json, glob, math, sys
from agent.plc.sim import run_scenario
bad = 0
for f in sorted(glob.glob("web/scripts/golden-ts/*.json")):
    g = json.load(open(f))
    tr = run_scenario(g["program"], g["scenario"])
    gt = g["trace"]
    problems = []
    if len(tr["frames"]) != len(gt["frames"]):
        problems.append(f"frame count {len(tr['frames'])} vs {len(gt['frames'])}")
    for a, b in zip(tr["frames"], gt["frames"]):
        for key in ("in", "out", "coil", "boxes"):
            if a[key] != b[key]:
                problems.append(f"t={a['t']} {key}: py={a[key]} ts={b[key]}"); break
        for k2, v in b["timer"].items():
            if abs(a["timer"].get(k2, -1) - v) > 1e-9:
                problems.append(f"t={a['t']} timer {k2}: py={a['timer'].get(k2)} ts={v}"); break
        if a.get("stuck") != b.get("stuck"):
            problems.append(f"t={a['t']} stuck py={a.get('stuck')} ts={b.get('stuck')}")
        if a["t"] != b["t"]:
            problems.append(f"t mismatch {a['t']} {b['t']}")
        if problems: break
    va = [(v["rule"], v["t"]) for v in tr["violations"]]; vb = [(v["rule"], v["t"]) for v in gt["violations"]]
    if va != vb: problems.append(f"violations py={va} ts={vb}")
    ea = [(e["t"], e["kind"], e["label"]) for e in tr["events"]]; eb = [(e["t"], e["kind"], e["label"]) for e in gt["events"]]
    if ea != eb: problems.append(f"events differ: first py={[x for x in ea if x not in eb][:3]} ts={[x for x in eb if x not in ea][:3]}")
    print(("PASS " if not problems else "FAIL ") + f.split("/")[-1], "; ".join(problems[:3]))
    bad += bool(problems)
sys.exit(1 if bad else 0)
