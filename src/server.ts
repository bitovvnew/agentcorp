// Zero-dependency HTTP server: dashboard, onboarding, SSE stream, controls.
// Binds to 127.0.0.1, rejects foreign Host headers (DNS rebinding) and requires a custom header on
// every POST (blocks cross-site requests), because the setup endpoints handle API keys.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOCKS, type ShockKind, type Simulation } from './engine.js';
import { listScenarios, listTemplates } from './plugins/index.js';
import { PERSONALITIES } from './brains/index.js';
import { PROVIDERS, detectEnv, probe, type ProviderId } from './providers.js';
import { applyConfig, loadConfig, saveConfig, type AgentCorpConfig, type LeagueSetup } from './config.js';
import { maskKey, redact } from './security.js';
import type { Replay } from './types.js';

export const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

export interface ServeOptions {
  port: number;
  host?: string;
  sim?: Simulation;
  replay?: Replay;
  /** Onboarding mode: called when the user presses Start in the web wizard. */
  startLeague?: (league: LeagueSetup) => Simulation;
  speed?: number;
  paused?: boolean;
  onFinish?: (replay: Replay) => void;
  quiet?: boolean;
}

export interface RunningServer {
  url: string;
  close(): Promise<void>;
  done: Promise<Replay | undefined>;
}

export async function serve(opts: ServeOptions): Promise<RunningServer> {
  let sim = opts.sim;
  const clients = new Set<http.ServerResponse>();
  let speed = opts.speed ?? 2;
  let paused = !!opts.paused;
  let stopped = false;
  let resolveDone!: (r: Replay | undefined) => void;
  const done = new Promise<Replay | undefined>((r) => (resolveDone = r));

  const send = (res: http.ServerResponse, event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (event: string, data: unknown) => { for (const c of clients) send(c, event, data); };
  const mode = () => (sim ? 'live' : opts.replay ? 'replay' : 'setup');
  const status = () => ({ mode: mode(), paused, speed, week: sim?.week ?? 0, finished: sim ? sim.finished : !!opts.replay });

  const attach = (s: Simulation) => {
    sim = s;
    s.onFrame((frame, events) => {
      broadcast('tick', { frame, events });
      if (s.finished) broadcast('done', { league: s.league() });
    });
    (async () => {
      while (!stopped && !s.finished) {
        if (paused) { await sleep(120); continue; }
        await s.step();
        await sleep(speed > 0 ? 1000 / speed : 0);
      }
      if (!stopped) {
        const r = s.toReplay();
        opts.onFinish?.(r);
        resolveDone(r);
      }
    })().catch((err) => {
      broadcast('error', { message: redact(err) });
      if (!opts.quiet) console.error(redact(err));
      resolveDone(undefined);
    });
    broadcast('status', status());
  };

  const server = http.createServer(async (req, res) => {
    try {
      const host = (req.headers.host ?? '').toLowerCase();
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return json(res, { error: 'forbidden host' }, 403);
      if (req.method === 'POST' && req.headers['x-agentcorp'] !== '1') return json(res, { error: 'missing x-agentcorp header' }, 403);
      const url = new URL(req.url ?? '/', 'http://localhost');
      const p = url.pathname;

      if (p === '/api/replay') return json(res, sim ? sim.toReplay() : opts.replay ?? null);
      if (p === '/api/status') return json(res, status());
      if (p === '/api/shocks') return json(res, SHOCKS);
      if (p === '/api/download') {
        const r = sim ? sim.toReplay() : opts.replay;
        res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': `attachment; filename="agentcorp-replay-${r?.config.seed ?? 'run'}.json"` });
        return res.end(JSON.stringify(r));
      }
      if (p === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        send(res, 'status', status());
        req.on('close', () => clients.delete(res));
        return;
      }
      if (p === '/api/control' && req.method === 'POST') {
        const body = await readBody(req);
        const action = String(body.action ?? '');
        if (action === 'pause') paused = true;
        else if (action === 'resume') paused = false;
        else if (action === 'speed') speed = Math.max(0, Math.min(60, Number(body.value) || 0));
        else if (action === 'shock' && sim) sim.queueShock(String(body.value) as ShockKind, body.companyId ? String(body.companyId) : undefined);
        else return json(res, { error: `unknown action ${action}` }, 400);
        broadcast('status', status());
        return json(res, status());
      }

      // ── onboarding ──
      if (p === '/api/setup' && req.method === 'GET') {
        const cfg = loadConfig();
        return json(res, {
          configured: !!cfg?.league,
          lang: cfg?.lang,
          env: detectEnv(),
          ollamaURL: cfg?.ollamaURL,
          saved: Object.fromEntries(Object.entries(cfg?.keys ?? {}).map(([k, v]) => [k, maskKey(v)])),
          league: cfg?.league,
          providers: PROVIDERS,
          templates: listTemplates().map((t) => ({ id: t.id, name: t.name, segment: t.segment, cash: t.cash, team: t.team.length, description: t.description })),
          scenarios: listScenarios().map((s) => ({ id: s.id, name: s.name, description: s.description })),
          personalities: Object.values(PERSONALITIES).map((x) => ({ id: x.id, label: x.label, blurb: x.blurb })),
        });
      }
      if (p === '/api/setup/models' && req.method === 'POST') {
        if (!opts.startLeague || sim) return json(res, { error: 'not in setup mode' }, 409);
        const body = await readBody(req);
        const provider = String(body.provider) as ProviderId;
        if (!PROVIDERS.some((x) => x.id === provider)) return json(res, { error: 'unknown provider' }, 400);
        const key = typeof body.key === 'string' && body.key.trim() ? body.key.trim() : loadConfig()?.keys[provider];
        const baseURL = provider === 'ollama' && typeof body.baseURL === 'string' ? body.baseURL : undefined;
        return json(res, await probe(provider, key, baseURL));
      }
      if (p === '/api/setup/start' && req.method === 'POST') {
        if (!opts.startLeague) return json(res, { error: 'not in setup mode' }, 409);
        const body = await readBody(req);
        if (sim) return json(res, { error: 'already running' }, 409);
        const prev: AgentCorpConfig = loadConfig() ?? { version: 1, keys: {} };
        const keys = { ...prev.keys };
        for (const { id, needsKey } of PROVIDERS) {
          const value = (body.keys as Record<string, unknown> | undefined)?.[id];
          if (!needsKey) continue;
          if (typeof value === 'string' && value.trim()) keys[id] = value.trim();
          if (value === null) delete keys[id];
        }
        const league = readLeague(body.league);
        const next: AgentCorpConfig = {
          ...prev, version: 1, keys,
          lang: typeof body.lang === 'string' ? body.lang : prev.lang,
          league,
          ollamaURL: typeof body.ollamaURL === 'string' ? body.ollamaURL : prev.ollamaURL,
        };
        applyConfig(next);
        try {
          const nextSim = opts.startLeague(league);
          saveConfig(next);
          attach(nextSim);
        } catch (err) {
          applyConfig(prev);
          return json(res, { error: redact(err) }, 400);
        }
        return json(res, status());
      }
      return serveStatic(res, p);
    } catch (err) {
      json(res, { error: redact(err) }, 400);
    }
  });

  const host = opts.host ?? '127.0.0.1';
  const port = await listen(server, opts.port, host);
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
  if (sim) attach(sim);
  else if (opts.replay) resolveDone(opts.replay);

  return {
    url,
    done,
    close: () => new Promise<void>((resolve) => {
      stopped = true;
      for (const c of clients) c.end();
      server.close(() => resolve());
    }),
  };
}

function readLeague(input: unknown): LeagueSetup {
  const league = input as LeagueSetup | undefined;
  if (!league || !Array.isArray(league.companies) || league.companies.length < 1 || league.companies.length > 8
    || typeof league.scenario !== 'string' || !Number.isSafeInteger(league.seed)
    || !Number.isInteger(league.weeks) || league.weeks < 8 || league.weeks > 260
    || league.companies.some((c) => !c || typeof c.brain !== 'string' || typeof c.template !== 'string'
      || (c.name !== undefined && typeof c.name !== 'string'))) {
    throw new Error('Invalid league configuration');
  }
  return {
    companies: league.companies.map(({ brain, template, name }) => ({ brain, template, name })),
    scenario: league.scenario,
    seed: league.seed,
    weeks: league.weeks,
    decideEvery: 4,
  };
}

function serveStatic(res: http.ServerResponse, p: string) {
  const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
  const file = path.resolve(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  fs.createReadStream(file).pipe(res);
}

function json(res: http.ServerResponse, data: unknown, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data ?? null));
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2e5) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid JSON')); }
    });
  });
}

function listen(server: http.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (p: number) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < 15) { attempt++; tryPort(p + 1); } else reject(err);
      });
      server.listen(p, host, () => {
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : p);
      });
    };
    tryPort(port);
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const read = (rel: string) => fs.readFileSync(path.join(WEB_DIR, rel), 'utf8');

/** One self-contained HTML file: styles, scripts, locales and the replay inlined. Opens anywhere. */
export function exportHtml(replay: Replay): string {
  const html = read('index.html');
  const css = read('styles.css');
  const imports: Record<string, string> = {};
  for (const f of fs.readdirSync(path.join(WEB_DIR, 'lib'))) {
    if (f.endsWith('.js')) imports[`./lib/${f}`] = `data:text/javascript;base64,${Buffer.from(read(`lib/${f}`)).toString('base64')}`;
  }
  const locales: Record<string, unknown> = {};
  for (const f of fs.readdirSync(path.join(WEB_DIR, 'locales'))) locales[f.replace('.json', '')] = JSON.parse(read(`locales/${f}`));
  const data = JSON.stringify(replay).replace(/</g, '\\u003c');
  const loc = JSON.stringify(locales).replace(/</g, '\\u003c');
  return html
    .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script type="module" src="app.js"></script>', () =>
      `<script type="importmap">${JSON.stringify({ imports })}</script>\n<script>window.__AGENTCORP_REPLAY__ = ${data}; window.__AGENTCORP_LOCALES__ = ${loc};</script>\n<script type="module">\n${read('app.js')}\n</script>`);
}
