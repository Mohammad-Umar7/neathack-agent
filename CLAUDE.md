# neathack-agent: neatHack 2026

Build for neatHack (online, Oct 10–12, 2026). One track, "Build an agent that works (literally)": an agent, or a team of agents, that completes a substantial task from start to finish.

## Deadline
Submissions are open Oct 12, 7:00–11:55 PM IST (the final cutoff is confirmed on Discord). Submit by quote-tweeting the official neatlogs post on X with the team, name, project, public repo, demo video and the cfo.ai business plan.

## Required tools (25% of the score)
- **neatlogs**: trace every agent run. Call `neatlogs.init(...)` before importing the libraries it instruments, put `@span(kind="WORKFLOW")` on entry points, and call `neatlogs.flush()` then `neatlogs.shutdown()` at exit. Keep before/after numbers.
- **Entire**: checkpoints are enabled for Claude Code in this repo. Commit often so each commit carries an `Entire-Checkpoint:` trailer.
- **cfo.ai**: business plan covering pricing, costs, revenue and runway, saved in `docs/business-plan/`.

## Evidence to collect while building
- Before/after neatlogs traces with compared numbers (`docs/traces/`)
- A run where an action failed and the agent recovered
- #neatHack posts on X, logged in `docs/build-log.md`

## Conventions
- Python 3.11 with uv. Run modules with `uv run python -m agent.<module>`. neatlogs does not support Python 3.14, so keep the 3.11 pin.
- Secrets live in `.env` (gitignored); `.env.example` lists them.
- LLM calls go through any OpenAI-compatible endpoint (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`), including Anthropic's (`https://api.anthropic.com/v1/`) if the neatHack LiteLLM key is late.

## Safety
Entire pushes session transcripts to this public repo. Never ask for keys in chat and never print `.env`. Entire's secret redaction is best-effort.

## Status (Oct 12, 12:25 PM IST)
Done:
- Public repo: https://github.com/Mohammad-Umar7/neathack-agent
- uv environment on Python 3.11, the neatlogs SDK, and `agent/smoke.py`
- Entire enabled for Claude Code (git-refs checkpoints, telemetry off, checkpoints push to origin). Its hooks only load when a session starts, so build in a session opened in this folder.

Waiting on the user:
- Finish web check-in (the team step), then verify the check-in email to get the LiteLLM key (Claude, Nova and others, $20 budget)
- neatlogs: sign up at app.neatlogs.com, create a project, put the key in `.env`
- cfo.ai: sign up (a card is required; the neatHack page says to cancel the subscription right away in Settings → Billing, and credits come from the neatHack team)
- First #neatHack post on X

Idea shortlist (not locked yet):
1. **Issue-to-PR agent (recommended).** Takes a GitHub issue, reproduces the bug with a failing test, fixes it, runs the full test suite, and opens a PR only when everything passes. The PR body links the run's neatlogs trace. Matches the page's "Fix a GitHub issue" example and all eight focus areas, and the judges work on coding agents (Entire, Orchestrator.inc, neatlogs).
2. **On-call agent.** Watches a running service, catches an incident, finds the cause in the logs, rolls back or patches, verifies the fix, and writes the postmortem.
3. **Research agent.** Answers a company or market question using Crustdata (5,000 free credits) and the web, cites every claim, and re-checks its sources before answering.

Plan for the day (IST):
- Until ~4:30 PM: build the agent, committing often
- 4:30–6:00 PM: v1 vs v2 runs for before/after neatlogs numbers, one failed-action recovery run, and the cfo.ai plan
- 6:00–7:00 PM: record the demo video
- 7:00 PM: submit early (neatlogs and cfo.ai engage with the first 50 quote tweets). Hard cutoff 11:55 PM.
