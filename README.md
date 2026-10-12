# neathack-agent

> Built live during **[neatHack](https://neatlogs.com/hackathon)**, Oct 10–12, 2026. Follow along: **#neatHack**

An AI agent that finishes a substantial task from start to finish, the kind you'd trust to run without watching it.

_The pitch goes here once the idea is locked in._

## Built with

| Tool | How it's used |
|---|---|
| [neatlogs](https://neatlogs.com) | Traces every agent run: LLM and tool calls, retries, latency, tokens and cost. Used to find failures and to prove before/after improvements. |
| [Entire](https://entire.io) | Records the coding-agent session behind every commit in this repo as a checkpoint (see the `Entire-Checkpoint:` commit trailers). |
| [cfo.ai](https://cfo.ai) | The business plan around the agent: pricing, costs, revenue and runway. |
| Python 3.11 + [uv](https://docs.astral.sh/uv/) | Agent runtime. |

## Quickstart

```bash
uv sync
cp .env.example .env              # fill in the keys
uv run python -m agent.smoke      # one traced LLM call; check it in neatlogs
```

## Hackathon evidence

| Requirement | Where |
|---|---|
| Agent improved (before/after neatlogs numbers) | _coming_ |
| neatlogs traces | _coming_ |
| Entire checkpoints | commit trailers + `entire checkpoint list` |
| cfo.ai business plan (pricing, costs, revenue, runway) | _coming_ |
| A failed action and the agent's recovery | _coming_ |
| Built in public (#neatHack posts) | [docs/build-log.md](docs/build-log.md) |
| Code written during the event | this repo's commit history |

## License

[MIT](LICENSE)
