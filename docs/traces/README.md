# Agent runs: before / after

Every run is traced in neatlogs (workflow span, every LLM call, every tool call). The numbers below come from each run's
export (`docs/traces/<run>.json`); the held-out tests, fuzzing and proofs run after the agent submits.

| | v1-naive | v2-verified | v2-recovery | v2-trial |
|---|---|---|---|---|
| Held-out tests passed (never seen by the agent) | 16/16 | 16/16 | 16/16 | 16/16 |
| Visible tests passed | 8/8 | 8/8 | 8/8 | 8/8 |
| Safety rules proven (S1-S6) | 6/6 | 6/6 | 6/6 | 6/6 |
| Fuzz episodes with a violation (of 300) | 0 | 0 | 0 | 0 |
| Hidden seeded faults fixed | 4/4 | 4/4 | 4/4 | 4/4 |
| Agent steps / LLM calls | 15 / 7 | 23 / 9 | 23 / 9 | 16 / 7 |
| Failed actions / recoveries / rollbacks | 2 / 1 / 0 | 1 / 1 / 0 | 3 / 2 / 0 | 0 / 0 / 0 |
| Tokens (in / out) | 23,698 / 3,164 | 64,525 / 3,501 | 61,613 / 3,327 | 31,862 / 2,813 |
| Cost (USD) | $0.12 | $0.25 | $0.23 | $0.14 |
| Wall time | 33 s | 42 s | 38 s | 39 s |

- **v1-naive**: minimal prompt, tests only (pass/fail), no failure details, no model checker, no rollback.
- **v2-verified**: commissioning method, failure details and scan tables, experiments on the digital twin, the model checker, regression detection and rollback.
- **v2-recovery**: v2 with an injected failure (the model checker crashes on its first call) to show recovery.
