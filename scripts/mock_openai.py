"""Local OpenAI-compatible mock (scripted tool calls) to test the openai backend path offline."""
import json, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from scripts.pipeline_test import plan

STATE = {"i": 0, "errors": []}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        msgs = body["messages"]
        # every assistant tool call must be answered by a tool message with the same id
        for k, m in enumerate(msgs):
            for tc in (m.get("tool_calls") or []):
                if not any(x.get("role") == "tool" and x.get("tool_call_id") == tc["id"] for x in msgs[k + 1:]):
                    STATE["errors"].append(f"unanswered tool call {tc['id']}")
        name, args = plan[min(STATE["i"], len(plan) - 1)]
        STATE["i"] += 1
        resp = {"id": "x", "object": "chat.completion", "created": 0, "model": body["model"],
                "choices": [{"index": 0, "finish_reason": "tool_calls", "message": {"role": "assistant", "content": f"step {STATE['i']}",
                    "tool_calls": [{"id": f"call_{STATE['i']}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}}],
                "usage": {"prompt_tokens": 1000 + 100 * STATE["i"], "completion_tokens": 50, "total_tokens": 1050 + 100 * STATE["i"]}}
        data = json.dumps(resp).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

def serve(port=8765):
    srv = HTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

if __name__ == "__main__":
    import os
    srv = serve()
    os.environ.update({"LLM_BASE_URL": "http://127.0.0.1:8765/v1", "LLM_API_KEY": "test", "LLM_MODEL": "claude-sonnet-4.6"})
    from agent.llm import OpenAIBackend
    from agent.loop import run_agent
    run = run_agent("v2", OpenAIBackend("claude-sonnet-4.6"), chaos=True, log=lambda s: None)
    print("steps", len(run["steps"]), "final", run["final_version"], "tokens", run["tokens"], "cost", run["cost_usd"], "errors", STATE["errors"][:3])
    srv.shutdown()
