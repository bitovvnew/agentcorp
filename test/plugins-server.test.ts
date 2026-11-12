import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createSimulation, DEMO_LEAGUE, registerPlugin, loadPluginFile, getScenario, getTemplate, listTemplates, listScenarios, validateReplay,
} from '../src/index.js';
import { serve, exportHtml } from '../src/server.js';
import { parseArgs } from '../src/cli.js';

describe('plugins', () => {
  it('ships built-in templates and scenarios', () => {
    expect(listTemplates().map((t) => t.id)).toEqual(expect.arrayContaining(['saas', 'enterprise', 'consumer', 'devtools', 'ai-wrapper']));
    expect(listScenarios().map((s) => s.id)).toEqual(expect.arrayContaining(['baseline', 'ai-winter', 'bull-run', 'recession', 'black-swan']));
    expect(() => getTemplate('nope')).toThrow(/Available/);
    expect(() => getScenario('nope')).toThrow(/Available/);
  });

  it('registers custom scenarios and templates', async () => {
    registerPlugin({
      kind: 'scenario', id: 'test-crash', name: 'Test crash', description: 'crash at week 2',
      onWeek(ctx) { if (ctx.week === 2) { ctx.market.climate = 0.3; ctx.headline('crash!', 3); } },
    });
    registerPlugin({ ...getTemplate('saas'), id: 'test-rich', name: 'Rich', cash: 50_000_000 });
    const sim = createSimulation({ ...DEMO_LEAGUE, weeks: 3, scenario: 'test-crash', companies: [{ template: 'test-rich', brain: 'balanced' }] });
    await sim.runToEnd();
    expect(sim.frames[2].market.climate).toBeLessThan(0.5);
    expect(sim.events.some((e) => e.text === 'crash!')).toBe(true);
    expect(sim.companies[0].cash).toBeGreaterThan(40_000_000);
    expect(() => registerPlugin({ kind: 'template', id: 'bad', team: [] } as never)).toThrow();
  });

  it('loads plugin files from disk (the bundled examples)', async () => {
    const loaded = await loadPluginFile(path.resolve('examples/plugins/hype-cycle.mjs'));
    expect(loaded[0].kind).toBe('scenario');
    const tpl = await loadPluginFile(path.resolve('examples/plugins/robotics.mjs'));
    expect(tpl[0].kind).toBe('template');
    const sim = createSimulation({ ...DEMO_LEAGUE, weeks: 10, scenario: 'hype-cycle', companies: [{ template: 'robotics', brain: 'visionary' }] });
    await sim.runToEnd();
    expect(sim.finished).toBe(true);
  });
});

describe('replays', () => {
  it('validates', async () => {
    const sim = createSimulation({ ...DEMO_LEAGUE, weeks: 5 });
    await sim.runToEnd();
    const r = validateReplay(JSON.parse(JSON.stringify(sim.toReplay())));
    expect(r.frames.length).toBe(6);
    expect(r.league?.length).toBe(4);
    expect(() => validateReplay({})).toThrow();
    expect(() => validateReplay({ format: 'agentcorp-replay', version: 2 })).toThrow(/version/);
  });

  it('exports a self-contained HTML file with the replay embedded', async () => {
    const sim = createSimulation({ ...DEMO_LEAGUE, weeks: 5 });
    const html = exportHtml(await sim.runToEnd());
    expect(html).toContain('window.__AGENTCORP_REPLAY__');
    expect(html).not.toContain('src="app.js"');
    expect(html).not.toContain('href="styles.css"');
    const file = path.join(os.tmpdir(), `agentcorp-test-${process.pid}.html`);
    fs.writeFileSync(file, html);
    expect(fs.statSync(file).size).toBeGreaterThan(10_000);
    fs.unlinkSync(file);
  });
});

describe('server', () => {
  it('serves the dashboard, the replay and accepts controls', async () => {
    const sim = createSimulation({ ...DEMO_LEAGUE, weeks: 6 });
    const server = await serve({ sim, port: 0, paused: true, speed: 0, quiet: true });
    try {
      const html = await (await fetch(server.url)).text();
      expect(html).toContain('AgentCorp');
      const status = await (await fetch(`${server.url}/api/status`)).json();
      expect(status).toMatchObject({ mode: 'live', paused: true });
      const replay = await (await fetch(`${server.url}/api/replay`)).json();
      expect(replay.format).toBe('agentcorp-replay');
      const headers = { 'x-agentcorp': '1' };
      const res = await fetch(`${server.url}/api/control`, { method: 'POST', headers, body: JSON.stringify({ action: 'resume' }) });
      expect((await res.json()).paused).toBe(false);
      const done = await server.done;
      expect(done?.finished).toBe(true);
      expect((await fetch(`${server.url}/../package.json`)).status).toBe(404);
      const denied = await fetch(`${server.url}/api/control`, { method: 'POST', body: JSON.stringify({ action: 'pause' }) });
      expect(denied.status).toBe(403);
      const bad = await fetch(`${server.url}/api/control`, { method: 'POST', headers, body: JSON.stringify({ action: 'explode' }) });
      expect(bad.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it('saves the browser setup only when a valid league starts', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcorp-setup-test-'));
    vi.stubEnv('AGENTCORP_HOME', home);
    const server = await serve({ startLeague: createSimulation, port: 0, speed: 0, quiet: true });
    try {
      const save = (league: unknown) => fetch(`${server.url}/api/setup/start`, {
        method: 'POST', headers: { 'x-agentcorp': '1' }, body: JSON.stringify({ league }),
      });
      const configPath = path.join(home, 'config.json');
      expect((await save({ ...DEMO_LEAGUE, companies: [] })).status).toBe(400);
      expect(fs.existsSync(configPath)).toBe(false);
      expect((await save({ ...DEMO_LEAGUE, companies: [{ brain: 'invalid', template: 'saas' }] })).status).toBe(400);
      expect(fs.existsSync(configPath)).toBe(false);
      const start = await save({ ...DEMO_LEAGUE, weeks: 8 });
      expect(await start.json()).toMatchObject({ mode: 'live' });
      expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).league.weeks).toBe(8);
      expect((await save(DEMO_LEAGUE)).status).toBe(409);
      expect((await server.done)?.finished).toBe(true);
    } finally {
      await server.close();
      vi.unstubAllEnvs();
      fs.rmSync(path.join(home, 'config.json'), { force: true });
      fs.rmSync(path.join(home, '.gitignore'), { force: true });
      fs.rmdirSync(home);
    }
  });
});

describe('cli args', () => {
  it('parses flags, values and repeated plugins', () => {
    const a = parseArgs(['league', '--brains', 'a,b', '--weeks=10', '--headless', '--no-open', '--plugin', 'x.js', '--plugin', 'y.js']);
    expect(a._).toEqual(['league']);
    expect(a.brains).toBe('a,b');
    expect(a.weeks).toBe('10');
    expect(a.headless).toBe(true);
    expect(a.open).toBe(false);
    expect(a.plugin).toEqual(['x.js', 'y.js']);
  });
});
