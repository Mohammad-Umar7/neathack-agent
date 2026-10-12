"""Write an offline scripted run into web/public/data for checking the viewer locally (never committed)."""
from agent.loop import run_agent, ScriptedBackend
from agent.evaluate import export_run, write_manifest
from scripts.pipeline_test import plan
run = run_agent("v2", ScriptedBackend(plan), chaos=True, log=lambda s: None)
export_run(run, "pipeline-test", "Pipeline test (scripted, not a real run)", "scripted", "scripted-test")
write_manifest([("pipeline-test", "Pipeline test (scripted, not a real run)")], "pipeline-test")
print("ok")
