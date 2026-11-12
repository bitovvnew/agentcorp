// Regenerates docs/img/* from a synthetic demo league (fictional companies, never real data).
//   npm run screenshots        (needs Chrome or Edge; set CHROME_PATH to override)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'img');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcorp-shots-'));
fs.mkdirSync(OUT, { recursive: true });

const { createSimulation, DEMO_LEAGUE } = await import(pathToFileURL(path.join(ROOT, 'dist', 'index.js')).href);
const { exportHtml } = await import(pathToFileURL(path.join(ROOT, 'dist', 'server.js')).href);

const BROWSER = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find((p) => fs.existsSync(p));
if (!BROWSER) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');

const sim = createSimulation(DEMO_LEAGUE);
const replay = await sim.runToEnd();
fs.writeFileSync(path.join(ROOT, 'examples', 'demo-replay.json'), JSON.stringify(replay));
const html = path.join(TMP, 'demo.html');
fs.writeFileSync(html, exportHtml(replay));
const url = pathToFileURL(html).href;

function shot(hash, file, w, h) {
  execFileSync(BROWSER, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${w},${h}`, '--virtual-time-budget=4000', `--user-data-dir=${path.join(TMP, 'profile')}`,
    `--screenshot=${path.join(OUT, file)}`, `${url}#${hash}`], { stdio: 'ignore' });
  console.log('  ✓', file);
}

const top = sim.league()[0].id;
const second = sim.league()[1].id;
shot(`week=end&company=${top}`, 'dashboard.png', 1440, 1500);
shot(`week=52&company=${second}`, 'midseason.png', 1440, 1500);
shot(`week=end&company=${second}`, 'mobile.png', 390, 1400);
console.log(`Screenshots in ${path.relative(ROOT, OUT)}; demo replay in examples/demo-replay.json`);
