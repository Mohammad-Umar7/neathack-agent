"""Offline pipeline test with a scripted backend (not a real agent run; never published)."""
import json, time
from agent.loop import run_agent, ScriptedBackend
from agent.evaluate import export_run, DATA
plan = [
    ("read_spec", {}), ("read_program", {}), ("run_tests", {}), ("get_test_details", {"test_id": "V03"}),
    ("prove", {}),
    ("propose_patch", {"edits": [{"op": "replace", "id": "R02", "text": "RESET ESTOP_LATCH WHEN NOT ESTOP AND RISE(RESET"}], "rationale": "typo"}),
    ("propose_patch", {"edits": [{"op": "replace", "id": "R02", "text": "RESET ESTOP_LATCH WHEN NOT ESTOP AND RISE(RESET)"},
                                  {"op": "replace", "id": "R03", "text": "TON T_JAM(PE_IN AND MOTOR, 3.0s)"},
                                  {"op": "replace", "id": "R06", "text": "RUN = (RISE(START) OR RUN) AND NOT STOP AND NOT ESTOP AND NOT ESTOP_LATCH AND NOT FAULT AND GUARD_CLOSED"},
                                  {"op": "replace", "id": "R08", "text": "MOTOR = RUN AND GUARD_CLOSED AND NOT PE_END"}], "rationale": "fix"}),
    ("propose_patch", {"edits": [{"op": "delete", "id": "R07"}], "rationale": "remove unused debounce timer"}),
    ("simulate", {"events": [{"t": 0.5, "kind": "press", "input": "START"}, {"t": 1.0, "kind": "spawn"}], "duration": 10, "t_from": 7.0}),
    ("prove", {}), ("submit", {"summary": "test"}),
]
if __name__ == "__main__":
    t0 = time.time()
    run = run_agent("v2", ScriptedBackend(plan), chaos=True, log=lambda s: print(s))
    print("steps:", len(run["steps"]), "final:", run["final_version"], f"{time.time()-t0:.1f}s")
    for s in run["steps"]:
        if s["kind"] != "think": print(f"  {s['i']:>2} {s['kind']:<8} {s['title'][:110]}  m={s.get('metrics')}")
    doc = export_run(run, "pipeline-test", "pipeline test", "scripted", "scripted-test")
    print("eval baseline:", {k: doc['eval']['baseline'][k] for k in ('visible','heldout','faults_fixed')}, doc['eval']['baseline']['fuzz'])
    print("eval repaired:", {k: doc['eval']['repaired'][k] for k in ('visible','heldout','faults_fixed')}, doc['eval']['repaired']['fuzz'])
    p = DATA / "runs" / "pipeline-test.json"; print("size KB:", p.stat().st_size // 1024); p.unlink()
    print(run["steps"][5]["detail"][:300])
