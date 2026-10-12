import type { Manifest } from './types';

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const res = await fetch('./data/manifest.json');
  const manifest: Manifest | null = res.ok ? await res.json() : null;
  app.textContent = manifest ? `STOP/PROVE: ${manifest.runs.length} runs` : 'STOP/PROVE';
}

boot();
