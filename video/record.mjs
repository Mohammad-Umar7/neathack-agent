// Screen-record the STOP/PROVE viewer with Chrome (a fresh temporary profile) via the DevTools
// screencast, then encode a constant-frame-rate MP4 with ffmpeg.
//
//   node record.mjs <url> <seconds> <out.mp4> [--width 1920 --height 1080 --wait 4]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [url, seconds = '10', out = 'clip.mp4', ...rest] = process.argv.slice(2);
const opt = (name, d) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : d;
};
const width = Number(opt('width', 1920));
const height = Number(opt('height', 1080));
const wait = Number(opt('wait', 4));
const fps = 30;

const chrome = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'stopprove-rec-'));
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  userDataDir: profile,
  defaultViewport: { width, height, deviceScaleFactor: 1 },
  args: [`--window-size=${width},${height}`, '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, wait * 1000));

const frames = [];
const cdp = await page.createCDPSession();
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  frames.push({ t: metadata.timestamp, buf: Buffer.from(data, 'base64') });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
// --actions "1.0:s,2.5:b,6:k" presses keys at those seconds after recording starts (Play-mode hotkeys).
const actions = String(opt('actions', ''))
  .split(',')
  .filter(Boolean)
  .map((a) => { const [t, key] = a.split(':'); return { t: Number(t), key }; });
const t0rec = Date.now();
for (const a of actions.sort((x, y) => x.t - y.t)) {
  const dt = a.t * 1000 - (Date.now() - t0rec);
  if (dt > 0) await new Promise((r) => setTimeout(r, dt));
  await page.keyboard.press(a.key);
}
const left = Number(seconds) * 1000 - (Date.now() - t0rec);
if (left > 0) await new Promise((r) => setTimeout(r, left));
await cdp.send('Page.stopScreencast');
await browser.close();
fs.rmSync(profile, { recursive: true, force: true });

if (!frames.length) throw new Error('no frames captured');
// Resample the variable-rate screencast to a constant frame rate.
const t0 = frames[0].t;
const total = Math.round(Number(seconds) * fps);
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
  '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', out], { stdio: ['pipe', 'inherit', 'inherit'] });
let j = 0;
for (let k = 0; k < total; k++) {
  const tk = t0 + k / fps;
  while (j + 1 < frames.length && frames[j + 1].t <= tk) j++;
  if (!ff.stdin.write(frames[j].buf)) await new Promise((r) => ff.stdin.once('drain', r));
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
console.log(`recorded ${frames.length} screencast frames -> ${total} frames @${fps}fps -> ${out}`);
