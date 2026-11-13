import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const home = await mkdtemp(path.join(os.tmpdir(), 'agentcorp-setup-'));
const bin = fileURLToPath(new URL('../bin/agentcorp.js', import.meta.url));
const child = spawn(process.execPath, [bin, '--no-open', '--port', '0'], {
  cwd: home,
  env: { ...process.env, AGENTCORP_HOME: home, NO_COLOR: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
  windowsHide: true,
});
const closed = new Promise((resolve) => child.once('close', resolve));
let timer;
try {
  const url = await new Promise((resolve, reject) => {
    let output = '';
    timer = setTimeout(() => reject(new Error('First-run setup did not start')), 15_000);
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`AgentCorp exited (${code})`)));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0]);
    });
  });
  const get = async (route) => {
    const response = await fetch(url + route, { signal: AbortSignal.timeout(3000) });
    assert.ok(response.ok, `${route}: HTTP ${response.status}`);
    return response.json();
  };
  assert.equal((await get('/api/status')).mode, 'setup');
  assert.equal((await get('/api/setup')).configured, false);
  for (const [locale, name] of [['zh', '简体中文'], ['ko', '한국어'], ['es', 'Español'], ['ja', '日本語']]) {
    assert.equal((await get(`/locales/${locale}.json`))['lang.name'], name);
  }
  console.log('First-run browser setup and new locales are available.');
} finally {
  clearTimeout(timer);
  child.kill();
  await closed;
  await rm(home, { recursive: true, force: true });
}
