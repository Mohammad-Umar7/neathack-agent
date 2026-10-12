"""Smoke test: one traced LLM call. If it shows up in neatlogs, the setup works.

Run: uv run python -m agent.smoke
"""

import os

from dotenv import load_dotenv

load_dotenv()

# neatlogs must be initialised before the libraries it instruments are imported.
import neatlogs  # noqa: E402

neatlogs.init(
    api_key=os.environ["NEATLOGS_API_KEY"],
    workflow_name="neathack-smoke",
    instrumentations=["openai"],
)

from neatlogs import span  # noqa: E402
from openai import OpenAI  # noqa: E402


@span(kind="WORKFLOW", name="smoke-test")
def main() -> None:
    client = OpenAI(
        base_url=os.environ.get("LLM_BASE_URL") or None,
        api_key=os.environ["LLM_API_KEY"],
    )
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "user", "content": "Reply with exactly: neatHack setup OK"}],
    )
    print(resp.choices[0].message.content)


if __name__ == "__main__":
    try:
        main()
    finally:
        neatlogs.flush()
        neatlogs.shutdown()
