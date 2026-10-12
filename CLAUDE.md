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
- Python 3.11 with uv. Run modules with `uv run python -m agent.<module>`.
- Secrets live in `.env` (gitignored); `.env.example` lists them.
- LLM calls go through any OpenAI-compatible endpoint (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`).
