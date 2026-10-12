# Repeated trials: v1 vs v2

6 independent runs per variant on Cell 01 (claude-sonnet-4.6 via the neatHack LiteLLM proxy).

| | v1 (naive) | v2 (verified) |
|---|---|---|
| fully correct submissions (held-out 16/16, 6/6 proven, 0 fuzz violations) | 6/6 | 6/6 |
| mean held-out tests passed | 16.0/16 | 16.0/16 |
| mean safety rules proven | 6.0/6 | 6.0/6 |
| mean hidden faults fixed | 4.0/4 | 4.0/4 |
| runs with a patch that passed every test but still violated a safety rule | 0/6 | 3/6 |
| mean steps / LLM calls | 15.0 / 7.0 | 17.3 / 7.2 |
| mean cost per run | $0.119 | $0.169 |
| mean wall time | 66 s | 64 s |
