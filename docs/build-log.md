# Build log (#neatHack)

Public log of the build. Times are IST.

| When (Oct 12) | Update | Post |
|---|---|---|
| 12:00 | Repo and tooling set up: neatlogs SDK, Entire checkpoints for Claude Code, Python + uv. | |
| 16:00 | Idea locked: **STOP/PROVE**, an agent that commissions PLC logic for a conveyor cell and proves the safety rules before the logic reaches a machine. | |
| 16:15 | Data contract between the Python agent and the web viewer (`web/src/types.ts`). Three parallel Claude Code subagents start: the 3D digital twin, the viewer UI with an in-browser simulator, and the business plan. | |
| 17:00–18:15 | High-poly three.js cell: T-slot conveyor, photo-eyes with live beams, interlocked guard door, operator panel, stack light, pick gantry, Poly Haven HDRI and textures. Viewer: agent timeline, ladder-logic view with diffs and live power flow, logic analyzer, Before/After twin mode, Play mode. | |
| 18:20 | Python core: restricted control language, scan engine, conveyor plant, safety monitors. It produces identical traces to the TypeScript simulator on all 10 golden scenarios. | |
| 18:35 | Test suites (8 visible, 16 held-out, randomized fuzzing) and a model checker with timer abstraction. Program as delivered: 2/16 held-out, 3/6 rules proven. Reference repair: 16/16, 6/6, in 0.5 s. | |
| 18:50 | Agent loop with 9 tools, v1 (naive) and v2 (verified) configurations, injected-failure mode, context trimming, held-out evaluation and export to the viewer. Tested offline with a scripted backend and a mock OpenAI-compatible server. | |
| 19:00 | GitHub Pages workflow, demo-video recorder (headless Chrome screencast), Kokoro voice-over test. | |
| 19:25 | cfo.ai: Ari rebuilt the business plan as a 36-month model (ARR $223k / $1.36M / $3.37M at months 12/24/36, gross margin 62% / 67% / 71%, ~24 months of pre-seed runway) with base, upside, downside and no-seed scenarios. | |
| 19:35 | First real agent run (claude-sonnet-4.6 via LiteLLM): 16/16 held-out, 6/6 proven, 4/4 faults fixed in 39 s for $0.14. Its first patch passed all 8 tests but the model checker found S4 still violated, so it patched again. | |
| 19:45 | Official runs exported to the viewer (v1 naive, v2 verified, v2 with an injected model-checker crash). Live at https://mohammad-umar7.github.io/neathack-agent/ | |
| 19:50 | Traces showed failed actions (comments in rungs, too many edits, 0 s timers). Fixed the tool interface; failed actions per v2 run fell from 1.17 to 0.00 over six trials, cost from $0.190 to $0.169. | |

## Problems hit (and what we did)

- **Entire's `prepare-commit-msg` hook hangs** in this setup (Claude Code running in a git worktree with background subagents). Commits stall until the hook process is stopped. Entire also registered the session against the main checkout, so it reports "no files modified" and records no checkpoints for work done in the worktree. Plan: move the final commits to a session opened in the main checkout.
- **No model access while the team lead was away**: the LiteLLM key needs every teammate's web check-in, and the local Claude CLI's login had expired. The agent was built and tested offline (scripted backend, mock OpenAI server) so the real runs take minutes once a key is in place.
