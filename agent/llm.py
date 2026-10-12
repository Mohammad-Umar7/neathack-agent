"""LLM access for the agent.

Two backends behind one interface:
- "openai": any OpenAI-compatible endpoint (the neatHack LiteLLM proxy, or Anthropic's), with native
  tool calling. neatlogs instruments these calls automatically.
- "claude-cli": the local Claude Code CLI in print mode, used when no API key is configured. Tools are
  described in the prompt and the model answers with one JSON tool call.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass, field

# USD per million tokens (input, output), for cost estimates when the backend does not report cost.
PRICES = {"claude-sonnet": (3.0, 15.0), "claude-opus": (15.0, 75.0), "claude-haiku": (1.0, 5.0), "nova": (0.8, 3.2)}


def price_for(model: str) -> tuple[float, float]:
    for k, v in PRICES.items():
        if k in model:
            return v
    return PRICES["claude-sonnet"]


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict


@dataclass
class Reply:
    text: str
    calls: list[ToolCall]
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    latency_s: float = 0.0
    raw: dict = field(default_factory=dict)


class OpenAIBackend:
    name = "openai"

    def __init__(self, model: str):
        from openai import OpenAI  # imported late so neatlogs.init() can instrument it first

        self.client = OpenAI(base_url=os.environ.get("LLM_BASE_URL") or None, api_key=os.environ["LLM_API_KEY"])
        self.model = model

    def chat(self, system: str, messages: list[dict], tools: list[dict]) -> Reply:
        t0 = time.time()
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system}, *messages],
            tools=[{"type": "function", "function": t} for t in tools],
            tool_choice="auto",
            temperature=0.2,
            max_tokens=2000,
        )
        msg = resp.choices[0].message
        calls = []
        for tc in msg.tool_calls or []:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {"_raw": tc.function.arguments}
            calls.append(ToolCall(tc.id, tc.function.name, args))
        u = resp.usage
        pin, pout = price_for(self.model)
        cost = (u.prompt_tokens * pin + u.completion_tokens * pout) / 1e6 if u else 0.0
        return Reply(msg.content or "", calls, u.prompt_tokens if u else 0, u.completion_tokens if u else 0, cost, time.time() - t0)

    def assistant_message(self, reply: Reply) -> dict:
        m: dict = {"role": "assistant", "content": reply.text or None}
        if reply.calls:
            m["tool_calls"] = [
                {"id": c.id, "type": "function", "function": {"name": c.name, "arguments": json.dumps(c.args)}} for c in reply.calls
            ]
        return m

    def tool_message(self, call: ToolCall, content: str) -> dict:
        return {"role": "tool", "tool_call_id": call.id, "content": content}


class ClaudeCliBackend:
    """Claude Code in print mode. Stateless: the whole conversation is replayed each call."""

    name = "claude-cli"

    def __init__(self, model: str = "sonnet"):
        self.model = model
        self.workdir = tempfile.mkdtemp(prefix="stopprove-llm-")
        self.n = 0

    def chat(self, system: str, messages: list[dict], tools: list[dict]) -> Reply:
        tool_doc = "\n".join(
            f"- {t['name']}: {t['description']}\n  args schema: {json.dumps(t['parameters'])}" for t in tools
        )
        sys_prompt = (
            system
            + "\n\nYou act only through tools. Available tools:\n"
            + tool_doc
            + "\n\nReply with exactly one JSON object and nothing else:\n"
            + '{"thought": "<one or two sentences of reasoning>", "tool": "<tool name>", "args": {...}}'
        )
        convo = []
        for m in messages:
            if m["role"] == "user":
                convo.append(f"USER:\n{m['content']}")
            elif m["role"] == "assistant":
                convo.append(f"YOU:\n{m['content']}")
            else:
                convo.append(f"TOOL RESULT ({m.get('name', 'tool')}):\n{m['content']}")
        prompt = "\n\n".join(convo) + "\n\nYour next JSON action:"
        t0 = time.time()
        proc = subprocess.run(
            ["claude", "-p", "--output-format", "json", "--model", self.model, "--max-turns", "1",
             "--tools", "", "--strict-mcp-config", "--setting-sources", "user", "--no-session-persistence",
             "--system-prompt", sys_prompt],
            input=prompt, capture_output=True, text=True, encoding="utf-8", cwd=self.workdir, timeout=300,
        )
        latency = time.time() - t0
        if proc.returncode != 0 and not proc.stdout.strip():
            raise RuntimeError(f"claude CLI failed: {proc.stderr.strip()[:500]}")
        data = json.loads(proc.stdout)
        text = data.get("result", "") or ""
        usage = data.get("usage", {}) or {}
        tin = int(usage.get("input_tokens", 0)) + int(usage.get("cache_read_input_tokens", 0)) + int(usage.get("cache_creation_input_tokens", 0))
        tout = int(usage.get("output_tokens", 0))
        cost = float(data.get("total_cost_usd") or 0.0)
        self.n += 1
        calls = []
        thought = text
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            try:
                obj = json.loads(m.group(0))
                thought = obj.get("thought", "")
                if obj.get("tool"):
                    calls.append(ToolCall(f"call_{self.n}", obj["tool"], obj.get("args") or {}))
            except json.JSONDecodeError:
                pass
        return Reply(thought, calls, tin, tout, cost, latency, data)

    def assistant_message(self, reply: Reply) -> dict:
        if reply.calls:
            c = reply.calls[0]
            return {"role": "assistant", "content": json.dumps({"thought": reply.text, "tool": c.name, "args": c.args})}
        return {"role": "assistant", "content": reply.text}

    def tool_message(self, call: ToolCall, content: str) -> dict:
        return {"role": "tool", "name": call.name, "content": content}


def make_backend(prefer: str | None = None):
    """OpenAI-compatible endpoint when a key is configured, otherwise the local Claude CLI."""
    prefer = prefer or os.environ.get("LLM_BACKEND")
    if prefer != "claude-cli" and os.environ.get("LLM_API_KEY"):
        return OpenAIBackend(os.environ.get("LLM_MODEL", "claude-sonnet-4.6"))
    return ClaudeCliBackend(os.environ.get("CLAUDE_CLI_MODEL", "sonnet"))
