#!/usr/bin/env bash
# The real agent runs for the submission. Needs LLM_API_KEY (and NEATLOGS_API_KEY for traces) in .env.
set -euo pipefail
cd "$(dirname "$0")/.."
uv run python -m agent.run --variant v1 --id v1-naive --manifest
uv run python -m agent.run --variant v2 --id v2-verified --manifest
uv run python -m agent.run --variant v2 --chaos --id v2-recovery --manifest
uv run python -m scripts.traces_report
