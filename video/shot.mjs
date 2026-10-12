// Screenshot the viewer: node shot.mjs <url> <out.png> [--wait 6] [--width 1920 --height 1080] [--keys "Space"]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [url, out = 'shot.png', ...rest] = process.argv.slice(2);
const opt = (n, d) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : d; };
const width = Number(opt('width', 1920)), height = Number(opt('height', 1080)), wait = Number(opt('wait', 6));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'stopprove-shot-'));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', userDataDir: profile, defaultViewport: { width, height },
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, wait * 1000));
await page.screenshot({ path: out });
await browser.close();
fs.rmSync(profile, { recursive: true, force: true });
console.log(`saved ${out}${errors.length ? ' | errors: ' + errors.slice(0, 3).join(' | ') : ''}`);
