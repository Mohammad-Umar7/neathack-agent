from agent.llm import ClaudeCliBackend
b = ClaudeCliBackend()
r = b.chat("You are a test agent.", [{"role": "user", "content": "Call the tool ping with args {\"n\": 1}."}],
           [{"name": "ping", "description": "Ping.", "parameters": {"type": "object", "properties": {"n": {"type": "integer"}}}}])
print("text:", r.text[:200]); print("calls:", r.calls); print("tokens:", r.input_tokens, r.output_tokens, "cost:", r.cost_usd, "latency:", round(r.latency_s, 1))
print("model:", list((r.raw.get("modelUsage") or {}).keys()))
