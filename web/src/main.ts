import './styles/main.css';
import { App, readParams } from './ui/app';
import { loadManifest, loadRun } from './ui/data';
import { h } from './ui/dom';
import { loadStage } from './ui/stage';

function fail(root: HTMLElement, msg: string): void {
  root.replaceChildren(h('div', { class: 'boot-error' }, h('b', null, 'STOP/PROVE'), h('p', null, msg)));
}

async function boot(): Promise<void> {
  const root = document.getElementById('app')!;
  const params = readParams();
  const lm = await loadManifest(params.mock);
  if (!lm) return fail(root, 'No run data found in data/manifest.json or data/mock/manifest.json.');
  const runId = params.run && lm.manifest.runs.some((r) => r.id === params.run) ? params.run : lm.manifest.default_run;
  const run = await loadRun(lm, runId);
  if (!run) return fail(root, `Could not load run "${runId}".`);
  const app = new App(lm, params);
  root.replaceChildren(app.root);
  app.start(run);
  (window as unknown as { stopProve: App }).stopProve = app;
  const { stage, real } = await loadStage(app.stageHost, { quality: params.quality, force2d: params.stage2d });
  app.setStage(stage, real);
}

boot().catch((e) => {
  console.error(e);
  fail(document.getElementById('app')!, `Something went wrong while starting: ${String(e)}`);
});
