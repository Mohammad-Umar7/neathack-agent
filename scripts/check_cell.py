import time
from agent.plc.cell import baseline_program, VISIBLE_TESTS, HELDOUT_TESTS, fuzz_scenarios
from agent.plc.hidden import reference_program
from agent.plc.verify import run_suite, fuzz, prove

for name, prog in [("baseline", baseline_program()), ("reference", reference_program())]:
    print(f"== {name}")
    for label, tests in [("visible", VISIBLE_TESTS), ("heldout", HELDOUT_TESTS)]:
        res = run_suite(prog, tests)
        print(f"  {label}: {sum(r['passed'] for r in res)}/{len(res)}")
        for r in res:
            if not r["passed"]:
                print(f"    {r['id']} FAIL: " + " | ".join(f["message"] for f in r["failures"][:3]))
    t0 = time.time(); fz = fuzz(prog, fuzz_scenarios(7, 100)); print(f"  fuzz: {fz['violations']}/{fz['episodes']} bad episodes {fz['by_rule']} ({time.time()-t0:.1f}s)")
    t0 = time.time(); pr = prove(prog); print(f"  prove: complete={pr['complete']} states={pr['states']} motor={pr['motor_reachable']} ({time.time()-t0:.1f}s)")
    for r in pr["results"]:
        print(f"    {r['rule']}: {r['status']}" + (f" (cex {len(r['counterexample'])} scans)" if r.get("counterexample") else ""))
